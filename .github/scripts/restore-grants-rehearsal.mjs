// restore-grants-rehearsal.mjs — A RESTORED NIGHTLY BACKUP KEEPS ITS GRANTS (POS-1199). CI only.
//
//   node .github/scripts/restore-grants-rehearsal.mjs
//
// Run by .github/workflows/guard-falsifier.yml after its floor, on that job's own throwaway Postgres service with the
// runner's own client tools. It is NOT a suite test (the suite's store has no pg_dump or pg_restore), and it never
// skips: a missing client, an unreadable store or a check that cannot run exits 2, which fails the step.
//
// RULED: Jetto, 2026-11-23: "the nightly dump is --no-acl, so prod's grants never reach a restore … a restore from that
// dump gives every role but the owner 'permission denied'". Wright: "keep the grants alongside every backup … Then
// rehearse a restore that ends with the office answering."
//
// WHAT IT RUNS IS THE LANES' OWN CODE, cut out by their own markers, with world2-lib.sh sourced as the lanes source it:
//   · deploy/world2-backup.sh § 1, the logical dump, exactly as the nightly unit runs it (pg_dump, then pg_restore --list)
//   · deploy/world2-restore-rehearse.sh § restore, then its `grants` and `office-answers` blocks
// against invented databases on the CI service, never a box, a bucket or a real dump:
//   w2_backup_src            the floor (every migration, as world2_owner), so every grant the migrations make, plus one
//                            invented act by an invented resident
//   w2_backup_restored       the night's dump restored, as the rehearsal restores it
//   w2_backup_restored_noacl THE FALSIFIER: the same dump stage with --no-acl put back, restored the same way
//
// WHAT IT ASSERTS, on each restore, with the source as the reference (no expectation of mine is written down here):
//   1. the owner's row counts match the source (the check that passed before POS-1199, grants or none)
//   2. the rehearsal's grants block: every privilege in the catalog restored, none gained
//   3. every pen role ACTUALLY TRIES select, insert, update and delete on every public table, in a transaction rolled
//      back, and is allowed or refused exactly as on the source (a refusal is SQLSTATE 42501 "permission denied")
//   4. the rehearsal's office-answers block: the office's own read, as office_api, answers from the restored store
// The real restore must pass all four. The falsifier must pass 1 and fail 2, 3 and 4: the owner-only check alone would
// have called it a good backup. Either way round otherwise, the step fails.
//
// THE BOUNDARY, said on the receipt: the roles and the database's CONNECT are cluster-wide and never in a dump, so this
// job's roles (its "Roles" step) stand in for the rescue box's hand-made ones. The CI owner has no CREATEDB, so the
// postgres superuser makes each empty scratch database, owned by world2_owner, where the box's rehearsal has the owner
// make its own. S3, the base backup, the WAL, roles.db and the intake files are not exercised here (their own tests
// are test/backup-ships-to-s3-or-fails.test.mjs, roles-db-rides-the-backup and intake-rides-the-backup).

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(new URL("../..", import.meta.url).pathname);
const PW = process.env.W2_PW;
const PGHOST = process.env.PGHOST ?? "127.0.0.1", PGPORT = process.env.PGPORT ?? "5432";
const SRC = "w2_backup_src", RESTORED = "w2_backup_restored", NOACL = "w2_backup_restored_noacl";
const PENS = ["office_api", "clearing_job", "law_ingester", "snapshot_reader", "stance_reader"];
const HANDLE = "ci-wren";   // invented

const cannot = (why) => { console.log(`::error::CANNOT RUN — ${why}`); process.exit(2); };
const say = (s) => console.log(s);

// ── the tools, or a refusal: this entry point never skips ───────────────────
const version = (bin) => {
  const r = spawnSync(bin, ["--version"], { encoding: "utf8" });
  if (r.error || r.status !== 0) cannot(`${bin} is not on this runner (${r.error?.code ?? r.status}): the rehearsal needs the PostgreSQL client tools`);
  return r.stdout.trim();
};
if (!PW) cannot("W2_PW is unset: the job's pen roles have no password to sign in with");
const tools = { pg_dump: version("pg_dump"), pg_restore: version("pg_restore"), psql: version("psql"), bash: version("bash").split("\n")[0] };
let pg;
try { pg = (await import("pg")).default; } catch (e) { cannot(`the pg module is missing (npm ci first): ${e.message}`); }

const url = (role, db) => `postgres://${role}:${encodeURIComponent(role === "postgres" ? process.env.PGPASSWORD ?? "" : PW)}@${PGHOST}:${PGPORT}/${db}`;
async function withClient(role, db, fn) {
  const c = new pg.Client({ connectionString: url(role, db) });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}

// ── the lanes' own code, cut by their own markers ───────────────────────────
const BACKUP = readFileSync(join(ROOT, "deploy/world2-backup.sh"), "utf8");
const REHEARSE = readFileSync(join(ROOT, "deploy/world2-restore-rehearse.sh"), "utf8");
const between = (text, from, to, what) => {
  const a = text.indexOf(from), b = text.indexOf(to, a + 1);
  if (a < 0 || b < 0) cannot(`${what}: its markers moved (${JSON.stringify(from)} … ${JSON.stringify(to)}), so this rehearsal would measure nothing`);
  return text.slice(a, b);
};
const line = (text, re, what) => { const m = re.exec(text); if (!m) cannot(`${what} is not in its script any more`); return m[0]; };
const DUMP_STAGE = between(BACKUP, "# ── 1 · the logical dump", "# ── 1b ·", "world2-backup.sh § 1");
const FAIL_FN = line(BACKUP, /\nfail\(\) \{[\s\S]*?\n\}\n/, "world2-backup.sh's fail()");
const RESTORE_STAGE = between(REHEARSE, "# ── restore ─", "# ── counts vs live", "world2-restore-rehearse.sh § restore");
const GRANTS_BLOCK = between(REHEARSE, "# >>> grants", "# <<< grants", "the rehearsal's grants block");
const OFFICE_BLOCK = between(REHEARSE, "# >>> office-answers", "# <<< office-answers", "the rehearsal's office-answers block");
const PSQL_OWNER = line(REHEARSE, /^psql_owner\(\) .*$/m, "the rehearsal's psql_owner()");
const SAY = line(REHEARSE, /^say\(\) .*$/m, "the rehearsal's say()");

const scratch = mkdtempSync(join(tmpdir(), "pos1199-"));
process.on("exit", () => { try { rmSync(scratch, { recursive: true, force: true }); } catch { /* litter in a throwaway runner */ } });
const laneEnv = {
  ...process.env, WORLD2_ENV_FILE: join(scratch, "no-env-file"), WORLD2_LAB: join(scratch, "lab"), WORLD2_STATE_DIR: join(scratch, "state"),
  WORLD2_PGHOST: PGHOST, WORLD2_PGPORT: PGPORT, PG_WORLD2_OWNER_PASSWORD: PW, PG_OFFICE_API_PASSWORD: PW, WORLD2_OFFICE: ROOT,
};
function bash(script, env, what) {
  const f = join(scratch, `${what.replace(/\W+/g, "-")}.sh`);
  writeFileSync(f, script);
  const r = spawnSync("bash", [f], { encoding: "utf8", env, cwd: ROOT });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

/** world2-backup.sh § 1 as the unit runs it, into `dir`. `noAcl` is the falsifier: --no-acl put back on its pg_dump. */
function dumpNight(dir, { noAcl = false } = {}) {
  let stage = DUMP_STAGE;
  if (noAcl) {
    const before = stage;
    stage = stage.replace("--format=custom --no-owner --file", "--format=custom --no-owner --no-acl --file");
    if (stage === before) cannot("the falsifier could not put --no-acl back: the dump's flags moved");
  } else if (/--no-acl/.test(stage.replace(/^#.*$/gm, ""))) cannot("world2-backup.sh § 1 still dumps --no-acl");
  const r = bash(`set -uo pipefail\n. deploy/world2-lib.sh\nDUMPS=${JSON.stringify(dir)}\nSTAMP=20261126T081000Z\nDB="$(w2_db)"\nmkdir -p "$DUMPS"\n${FAIL_FN}${stage}\necho "DUMP=$DUMP TOC=$TOC_ENTRIES BYTES=$DUMP_BYTES"\n`,
    { ...laneEnv, WORLD2_DB: SRC }, noAcl ? "dump-noacl" : "dump");
  const m = /DUMP=(.+?) TOC=(\d+) BYTES=(\d+)$/m.exec(r.out);
  if (r.code !== 0 || !m) cannot(`the backup's dump stage failed (exit ${r.code}): ${r.out.slice(-800)}`);
  return { file: m[1], toc: Number(m[2]), bytes: Number(m[3]) };
}

/** world2-restore-rehearse.sh's restore, grants and office-answers, into `db` (made empty first), with the source as live. */
function restoreNight(dump, db) {
  const r = bash(`set -uo pipefail\n. deploy/world2-lib.sh\nERRF="$(mktemp)"\nPGH=${PGHOST}; PGP=${PGPORT}\nexport PGPASSWORD="$PG_WORLD2_OWNER_PASSWORD"\n${PSQL_OWNER}\n${SAY}\nSCRATCH=${db}\nDB=${SRC}\nDUMP=${JSON.stringify(dump)}\nbad=0; NOTRUN=""\n${RESTORE_STAGE}\n${GRANTS_BLOCK}\n${OFFICE_BLOCK}\necho "RESULT bad=$bad notrun=[\${NOTRUN# }]"\n`,
    laneEnv, `restore-${db}`);
  const m = /RESULT bad=(\d+) notrun=\[([^\]]*)\]/.exec(r.out);
  return { code: r.code, out: r.out, bad: m ? Number(m[1]) : null, notrun: m ? m[2] : null,
    grantsMatch: /^ {3}match: \d+ privileges, every one restored and none gained$/m.test(r.out),
    grantsDiffer: /GRANTS DIFFER: (\d+) lost by the restore, (\d+) gained by it/.exec(r.out),
    answered: /^ {3}answered: (\{.*\})$/m.exec(r.out), refused: /THE OFFICE COULD NOT READ THE RESTORED STORE/.test(r.out) };
}

// ── what each pen may do: tried, not read off a list ────────────────────────
async function tablesOf(db) {
  return withClient("postgres", db, async (c) => (await c.query(`
    SELECT c.relname AS t, (SELECT a.attname FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped ORDER BY a.attnum LIMIT 1) AS col
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') ORDER BY 1`)).rows);
}
const qi = (s) => `"${String(s).replace(/"/g, '""')}"`;
async function tryAll(db, tables) {
  const out = new Map();
  for (const role of PENS) {
    await withClient(role, db, async (c) => {
      await c.query("BEGIN");
      await c.query("SET LOCAL statement_timeout = '5s'");
      for (const { t, col } of tables) {
        const ops = { select: `SELECT 1 FROM ${qi(t)} LIMIT 0`, insert: `INSERT INTO ${qi(t)} DEFAULT VALUES`,
          update: `UPDATE ${qi(t)} SET ${qi(col)} = DEFAULT WHERE false`, delete: `DELETE FROM ${qi(t)} WHERE false` };
        for (const [op, sql] of Object.entries(ops)) {
          await c.query("SAVEPOINT p");
          let v = "allowed";
          try { await c.query(sql); } catch (e) { if (e.code === "42501" && /^permission denied/.test(e.message)) v = "refused"; }
          await c.query("ROLLBACK TO SAVEPOINT p");
          out.set(`${role} ${op} ${t}`, v);
        }
      }
      await c.query("ROLLBACK");
    });
  }
  return out;
}
const compare = (ref, got) => [...ref].filter(([k, v]) => got.get(k) !== v).map(([k, v]) => `${k}: ${v} on the source, ${got.get(k) ?? "absent"} here`);
const tally = (m) => Object.fromEntries(PENS.map((r) => [r, [...m].filter(([k, v]) => k.startsWith(`${r} `) && v === "allowed").length]));
async function counts(db, tables) {
  return withClient("world2_owner", db, async (c) => {
    const o = {};
    for (const { t } of tables) o[t] = Number((await c.query(`SELECT count(*) AS n FROM ${qi(t)}`)).rows[0].n);
    return o;
  });
}

// ── the run ─────────────────────────────────────────────────────────────────
let serverVersion;
try { serverVersion = await withClient("postgres", "postgres", async (c) => (await c.query("SHOW server_version")).rows[0].server_version); }
catch (e) { cannot(`the CI Postgres service could not be reached: ${e.message}`); }
say(`== POS-1199 restore-grants rehearsal · server PostgreSQL ${serverVersion} · ${tools.pg_dump} · ${tools.pg_restore} · ${tools.psql}`);

const floor = spawnSync("bash", [".github/scripts/guard-falsifier-floor.sh", SRC, "--fresh"], { cwd: ROOT, encoding: "utf8", env: process.env });
if (floor.status !== 0) cannot(`the source's floor failed: ${floor.stdout}${floor.stderr}`);
say(`== source ${SRC}: ${floor.stdout.trim()}`);
await withClient("world2_owner", SRC, (c) => c.query(
  `INSERT INTO acts (at, crossing, actor, action, class, payload, household) VALUES (now() - interval '1 hour', 1, $1, 'say', 'voice', '{"words":"an invented line"}', $1)`, [HANDLE]));
const tables = await tablesOf(SRC);
const srcTry = await tryAll(SRC, tables), srcCounts = await counts(SRC, tables);
say(`   ${tables.length} tables; what each pen may do on the source (allowed of ${tables.length * 4}): ${JSON.stringify(tally(srcTry))}`);

const failures = [];
async function night(label, db, { noAcl }) {
  const dump = dumpNight(join(scratch, db), { noAcl });   // a folder named by its database: no spaces in the path
  for (const d of [db]) await withClient("postgres", "postgres", async (c) => {
    await c.query(`DROP DATABASE IF EXISTS ${d}`);
    await c.query(`CREATE DATABASE ${d} OWNER world2_owner`);
  });
  const r = restoreNight(dump.file, db);
  if (r.code !== 0 && r.bad === null) cannot(`${label}: the rehearsal's restore stopped (exit ${r.code}): ${r.out.slice(-1200)}`);
  const got = await tryAll(db, tables), diff = compare(srcTry, got);
  const c = await counts(db, tables), countsDiffer = Object.keys(srcCounts).filter((t) => c[t] !== srcCounts[t]);
  say(`\n== ${label}: dump ${dump.bytes} bytes, ${dump.toc} entries → ${db}`);
  for (const l of r.out.split("\n").filter((l) => /^(==|   )/.test(l))) say(`   ${l}`);
  say(`   owner's row counts: ${countsDiffer.length ? `DIFFER on ${countsDiffer.join(", ")}` : `match on all ${tables.length} tables`}`);
  say(`   each pen tried every table: ${diff.length ? `${diff.length} differ from the source` : "allowed and refused exactly as on the source"} · allowed here: ${JSON.stringify(tally(got))}`);
  for (const d of diff.slice(0, 12)) say(`     ${d}`);
  return { r, diff, countsDiffer };
}

const real = await night("the night's backup", RESTORED, { noAcl: false });
if (real.r.bad !== 0 || real.r.notrun !== "") failures.push(`the rehearsal's own blocks found ${real.r.bad} finding(s), not run: [${real.r.notrun}]`);
if (!real.r.grantsMatch) failures.push("the grants block did not report every privilege restored and none gained");
if (!real.r.answered) failures.push("the office did not answer from the restored store");
else if (!real.r.answered[1].includes(`"handle":"${HANDLE}"`) || /"last_active":null/.test(real.r.answered[1])) failures.push(`the office answered without the invented act: ${real.r.answered[1]}`);
if (real.diff.length) failures.push(`${real.diff.length} pen operations differ from the source`);
if (real.countsDiffer.length) failures.push(`row counts differ: ${real.countsDiffer.join(", ")}`);

const fals = await night("THE FALSIFIER: the same dump stage with --no-acl put back", NOACL, { noAcl: true });
if (fals.countsDiffer.length) failures.push(`falsifier: the owner's counts should still match (they are the check that cannot tell), and differ on ${fals.countsDiffer.join(", ")}`);
if (!fals.r.grantsDiffer) failures.push("falsifier: the grants block did not report the lost grants");
if (!fals.r.refused) failures.push("falsifier: the office answered from a store whose grants were dropped");
if (!fals.diff.some((d) => d.startsWith("office_api select acts: allowed on the source, refused here"))) failures.push("falsifier: office_api could still read acts");
if (!fals.diff.length) failures.push("falsifier: every pen operation matched the source with the grants dropped");

say(`\n== boundary: roles and CONNECT are cluster-wide and never in a dump (this job's Roles step stands in for the box's hand-made ones); the scratch databases are made empty by the postgres superuser (the CI owner has no CREATEDB); S3, the base backup, WAL, roles.db and intake are their own tests'.`);
if (failures.length) { for (const f of failures) console.log(`::error::${f}`); say(`== RED · ${failures.length} failure(s)`); process.exit(1); }
say(`== GREEN · the restore keeps every grant, every pen does on it what it did on the source, the office answers; with --no-acl put back the owner's counts still match and all three of those go red`);
