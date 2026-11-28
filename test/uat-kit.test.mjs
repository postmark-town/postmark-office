// uat-kit.test.mjs — deploy/uat/'s scrub, its gate, its readback, its role SQL, its ownership and its migration plan
// (CORE-165, Truey's review of #1206, findings 1, 2, 5 and 7).
//
//   node --import ./test/helpers/sparse-guard.mjs --test --test-concurrency=1 test/uat-kit.test.mjs
//
// THE LAW THIS PINS (scrub.sql's own words): "drop every credential, every household-private word, and anything that
// would let UAT reach a real person or system". The nightly dump is taken as world2_owner so that it CARRIES the drafts
// (deploy/world2-backup.sh), a restore applies no row policy to the superuser, and so every row-policy-private table
// arrives whole. What was missing (finding 1) was a scrub of them, and (finding 5) a readback that could tell a scrub that
// worked from one that read zero lines.
//
// WHAT RUNS HERE, AND WHAT DOES NOT. The scrub, the ownership step and the role SQL run on a REAL Postgres (the suite's
// store, the whole schema), and the shell checks (lib.sh) run under bash. NOTHING here runs on town-rig: not
// store-restore-scrub.sh itself (it needs root, S3, the dump, systemd), not nginx-uat.sh, units.sh or tunnel.sh. For the
// last three the checks below are TEXT PINS and say so in their titles: the weakest instrument, kept where no run reaches.
//
// THE CAN-FAIL FLIPS (each reds the named test; the readback and the AWAITING gate are the two that matter):
//   · scrub.sql: delete the `DELETE FROM claims WHERE status = 'draft';` line. THE SCRUB RUN reds on claims drafts, and
//     THE COVERAGE test reds on the missing statement.
//   · lib.sh § uat_check_readback: make it return 0 whatever it is given (the old `awk` on zero lines). THE READBACK
//     tests red on the empty output, the missing label, and the present_ control.
//   · lib.sh § uat_scrub_gate: drop the AWAITING branch. THE GATE test reds on the real file.
//   · scrub.sql: delete one readback label. THE COVERAGE test reds, and so does the script's own check at the box.

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tempDir } from "./helpers/temp-dir.mjs";
import { startStore } from "./helpers/embedded-store.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const KIT = join(ROOT, "deploy", "uat");
const read = (f) => readFileSync(join(KIT, f), "utf8").replace(/\r\n/g, "\n");
const SCRUB = read("scrub.sql");
const SCRATCH = tempDir("uat-kit-");

const HAS_BASH = spawnSync("bash", ["--version"], { encoding: "utf8" }).status === 0;
const bashTest = (name, fn) => test(name, { skip: HAS_BASH ? false : "needs bash on PATH (CI's Linux has it)" }, fn);
/** lib.sh's functions, under bash, in the kit's own directory; the inputs ride the environment, not the command line. */
const lib = (script, env = {}) => spawnSync("bash", ["-c", `. ./lib.sh; set +e; ${script}`], { cwd: KIT, encoding: "utf8", env: { ...process.env, ...env } });

// ── scrub.sql, read: the classification table, the statements and the readback labels ────────────────────────────
const ROWS = [...SCRUB.matchAll(/^-- \| ([a-z0-9_]+) \| (DELETE|SCRUB|KEEP|UNSURE) \| (reviewed|awaiting|-) \| (.+) \|$/gm)]
  .map(([, table, verdict, status, why]) => ({ table, verdict, status, why }));
const LABELS = [...SCRUB.matchAll(/^(?:SELECT|UNION ALL SELECT) '([a-z0-9_]+)'/gm)].map((m) => m[1]);
const LABEL_LINES = SCRUB.split("\n").filter((l) => /^(SELECT|UNION ALL SELECT) '/.test(l));
const AWAITING_LINES = SCRUB.split("\n").filter((l) => /^-- AWAITING: /.test(l));
/** The readback query alone: from its first SELECT to the COMMIT. */
const READBACK_SQL = SCRUB.slice(SCRUB.indexOf("SELECT 'zero_oauth_tokens'"), SCRUB.lastIndexOf("COMMIT;"));
/** `label count` lines, as psql -tA -F' ' prints them. */
const asLines = (rows) => rows.map((r) => `${r.t} ${r.count}`).join("\n");

const store = await startStore({ db: "uat_kit_test" });
const su = await store.connect("postgres");
const ROLE = `uat_probe_${process.pid}`;   // a role is cluster-wide on the tree's shared server: dropped in the one teardown below
after(async () => {
  await su.query(`DROP ROLE IF EXISTS ${ROLE}`).catch(() => {});
  await su.end().catch(() => {});
  await store.stop();
});
const q = (sql, params) => su.query(sql, params);
/** The last result of a multi-statement script that has rows. */
const lastRows = (res) => [].concat(res).filter((r) => r.rows.length).pop().rows;

// ── 1. THE COVERAGE: every table the schema creates is classified, and every verdict has its statement ─────────────
test("scrub.sql classifies EVERY base table the office's migrations create, and none that does not exist", async () => {
  const { rows } = await q(`SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') ORDER BY 1`);
  const real = rows.map((r) => r.relname);
  assert.ok(real.length > 90, `the denominator is read from the real schema: ${real.length} base tables`);
  const listed = ROWS.map((r) => r.table);
  assert.deepEqual(real.filter((t) => !listed.includes(t)), [], "a table the migrations create has no row in scrub.sql's classification (add a verdict: DELETE, SCRUB, KEEP or UNSURE)");
  assert.deepEqual(listed.filter((t) => !real.includes(t)), [], "scrub.sql classifies a table the schema does not create");
  assert.equal(new Set(listed).size, listed.length, "a table is classified twice");
});

test("every DELETE row has its delete and its zero_ readback; every SCRUB row has its update and its zero_ readback", () => {
  const stmts = SCRUB.split("\n").filter((l) => !l.startsWith("--"));
  for (const { table, verdict } of ROWS) {
    if (verdict !== "DELETE" && verdict !== "SCRUB") continue;
    const re = verdict === "DELETE" ? new RegExp(`^DELETE FROM ${table}( WHERE .+)?;`) : new RegExp(`^UPDATE ${table} SET `);
    assert.ok(stmts.some((l) => re.test(l)), `${table} is ${verdict} in the table but scrub.sql has no ${verdict === "DELETE" ? "DELETE FROM" : "UPDATE"} ${table} statement`);
    assert.ok(LABEL_LINES.some((l) => /^(SELECT|UNION ALL SELECT) 'zero_/.test(l) && new RegExp(`\\bFROM ${table}\\b`).test(l)),
      `${table} is ${verdict} but the readback has no zero_ label counting it`);
  }
});

test("the readback has zero_ labels (to be 0) and present_ labels (to be above 0), with no label twice", () => {
  assert.equal(new Set(LABELS).size, LABELS.length, "a readback label appears twice");
  assert.ok(LABELS.filter((l) => l.startsWith("zero_")).length >= 20, "the zero_ labels");
  assert.ok(LABELS.filter((l) => l.startsWith("present_")).length >= 3, "the present_ controls");
  assert.deepEqual(LABELS.filter((l) => !/^(zero|present)_/.test(l)), [], "a label that is neither zero_ nor present_ is read as neither");
});

test("every `awaiting` row has its AWAITING line, and an AWAITING line names only an `awaiting` row (nothing is quietly reviewed)", () => {
  const awaiting = ROWS.filter((r) => r.status === "awaiting").map((r) => r.table);
  assert.ok(awaiting.length >= 12, `the new deletes await Darko: ${awaiting.length}`);
  for (const t of awaiting) assert.ok(AWAITING_LINES.some((l) => new RegExp(`^-- AWAITING: ${t}\\b`).test(l)), `${t} awaits Darko's review and has no -- AWAITING: ${t} line`);
  for (const l of AWAITING_LINES.filter((x) => !x.startsWith("-- AWAITING: Darko's review"))) {
    const t = /^-- AWAITING: ([a-z0-9_]+)/.exec(l)[1];
    assert.ok(awaiting.includes(t), `"${l}" names ${t}, which the table does not mark awaiting`);
  }
  // The REVIEWED line is Darko's own words and names two tables; the table must not call more `reviewed` than his ruling covered.
  const reviewed = ROWS.filter((r) => r.status === "reviewed").map((r) => r.table).sort();
  assert.deepEqual(reviewed, ["household_harnesses", "letter_notes", "oauth_berths", "oauth_codes", "oauth_key_claims", "oauth_pending", "oauth_tokens", "resident_notes", "town_pot_receipts"]);
  assert.match(SCRUB, /^-- REVIEWED: Darko, 2026-11-23 16:56 EST "okay go on all"; 17:01 EST "empty both is fine yeah" \(resident_notes, letter_notes\)$/m);
});

// ── 2. THE GATE (lib.sh § uat_scrub_gate): the unreviewed scrub still refuses ─────────────────────────────────────
bashTest("the gate REFUSES the real scrub.sql while any AWAITING line stands, and passes the same file with them removed", () => {
  const real = lib('uat_scrub_gate scrub.sql; echo "rc=$?"');
  assert.match(real.stdout, /AWAITING/, `the refusal names the AWAITING lines: ${real.stdout}`);
  assert.match(real.stdout, /rc=1/, "a refusal returns 1");
  // the control: the same file, AWAITING lines gone, is allowed to run — so the refusal above was the AWAITING lines and nothing else
  const cleared = join(SCRATCH, "scrub-cleared.sql");
  writeFileSync(cleared, SCRUB.split("\n").filter((l) => !/^-- AWAITING:/.test(l)).join("\n"));
  const ok = lib('uat_scrub_gate "$F"; echo "rc=$?"', { F: cleared });
  assert.equal(ok.stdout.trim(), "rc=0", `a reviewed scrub with nothing awaiting may run: ${ok.stdout}`);
});

bashTest("the gate also refuses an unreviewed REVIEWED line, a missing one, and an unreadable file", () => {
  const cleared = SCRUB.split("\n").filter((l) => !/^-- AWAITING:/.test(l));
  const variants = {
    no: cleared.map((l) => (l.startsWith("-- REVIEWED:") ? "-- REVIEWED: no" : l)),
    empty: cleared.map((l) => (l.startsWith("-- REVIEWED:") ? "-- REVIEWED: " : l)),
    absent: cleared.filter((l) => !l.startsWith("-- REVIEWED:")),
  };
  for (const [name, lines] of Object.entries(variants)) {
    const f = join(SCRATCH, `scrub-${name}.sql`);
    writeFileSync(f, lines.join("\n"));
    const r = lib('uat_scrub_gate "$F"; echo "rc=$?"', { F: f });
    assert.match(r.stdout, /rc=1/, `REVIEWED ${name} must refuse: ${r.stdout}`);
  }
  assert.match(lib('uat_scrub_gate /nonexistent/scrub.sql; echo "rc=$?"').stdout, /rc=1/);
});

// ── 3. THE READBACK (lib.sh § uat_check_readback): zero lines, a lost line and an empty copy all fail ──────────────
const goodOutput = () => LABELS.map((l) => `${l} ${l.startsWith("present_") ? 7 : 0}`).join("\n");
const check = (out) => lib('uat_check_readback scrub.sql "$OUT"; echo "rc=$?"', { OUT: out });

bashTest("the readback FAILS on zero lines (the old check passed on them), and passes a full, honest one (the control)", () => {
  const control = check(goodOutput());
  assert.equal(control.stdout.trim(), "rc=0", `a complete readback with zeros and present controls passes: ${control.stdout}`);
  for (const [name, out] of [["empty output", ""], ["only psql noise", "BEGIN\nCOMMIT\nDELETE 72"]]) {
    const r = check(out);
    assert.match(r.stdout, /rc=1/, `${name} must fail: ${r.stdout}`);
    assert.match(r.stdout, /expected one line, got 0/, `and say which labels are missing (${name}): ${r.stdout}`);
  }
});

bashTest("the readback fails on a missing label, a repeated one, a non-zero zero_, a zero present_ and a non-number", () => {
  const lines = goodOutput().split("\n");
  const cases = {
    "a label lost": lines.filter((l) => !l.startsWith("zero_reports ")).join("\n"),
    "a label printed twice": [...lines, "zero_reports 0"].join("\n"),
    "a zero_ that is not 0": lines.map((l) => (l.startsWith("zero_claims_drafts ") ? "zero_claims_drafts 3" : l)).join("\n"),
    "a present_ that is 0 (an empty copy is not a clean one)": lines.map((l) => (l.startsWith("present_acts ") ? "present_acts 0" : l)).join("\n"),
    "a count that is not a number": lines.map((l) => (l.startsWith("zero_mail_blocks ") ? "zero_mail_blocks none" : l)).join("\n"),
  };
  for (const [name, out] of Object.entries(cases)) assert.match(check(out).stdout, /rc=1/, `${name} must fail`);
});

// ── 4. THE SCRUB, RUN on a real store: private rows go, the public record stays ───────────────────────────────────
test("on an EMPTY restored copy the readback reads zeros AND fails its present_ controls (zeros prove nothing)", async () => {
  const rb = lastRows(await q(READBACK_SQL));
  const out = asLines(rb);
  assert.ok(rb.filter((r) => r.t.startsWith("zero_")).every((r) => Number(r.count) === 0), "an empty store counts zero everywhere");
  if (HAS_BASH) {
    const r = check(out);
    assert.match(r.stdout, /rc=1/, `${r.stdout}`);
    assert.match(r.stdout, /present_acts.* is 0/, "the empty copy is named: it holds none of the public record");
  }
});

const SEED = `
  INSERT INTO windows (id, opens_at, closes_at, status) VALUES (1, now() - interval '3 hours', now() - interval '2 hours', 'closed');
  INSERT INTO claims (window_id, class, claimant, household, status, slug) VALUES
    (1, 'mark', 'alpha/bob', 'hh:alpha', 'draft',   'alpha/draft-one'),
    (1, 'mark', 'alpha/bob', 'hh:alpha', 'draft',   'alpha/draft-two'),
    (1, 'mark', 'beta/cy',   'hh:beta',  'pending', 'beta/public-one'),
    (1, 'mark', 'beta/cy',   'hh:beta',  'refused', 'beta/public-two');
  INSERT INTO marks (id, slug, kind, owner, locked_window) VALUES (gen_random_uuid(), 'beta/the-stool', 'stool', 'beta/cy', 1);
  INSERT INTO acts (at, actor, action, class) VALUES (now(), 'beta/cy', 'leave-mark', 'world');
  INSERT INTO households (slug, ord, name, human, accounts, residents, since, declared_by, likeness, likeness_state)
    VALUES ('alpha', 1, 'Alpha House', 'Alpha Human', '[{"login":"alpha-gh","id":1}]', '{alpha}', '2026-08-07', 'declare',
            '{"answer":"yes","at":"2026-10-19T00:00:00Z","by":"alpha-gh","gh_id":1,"words":"v1"}',
            '{"request":{"at":"2026-11-10T00:00:00Z","by":"alpha-gh","gh_id":1,"depicts":["alpha"]},"official":{"version":1,"proof":"p","since":"s","depicts":["alpha"]}}'),
           ('beta', 2, 'Beta House', NULL, '[{"login":"beta-gh","id":2}]', '{beta}', '2026-08-08', 'declare', NULL, '{"request":{"at":"x"}}');
  INSERT INTO oauth_tokens (token_hash, kind, gh_id, gh_login) VALUES ('hash-one', 'household', 1, 'alpha-gh');
  INSERT INTO oauth_codes (code, json, expires) VALUES ('c1', '{}', 1);
  INSERT INTO oauth_pending (id, json, expires) VALUES ('p1', '{}', 1);
  INSERT INTO oauth_key_claims (ask_hash, handle, token_hash, created, expires) VALUES ('ask1', 'alpha', 'hash-two', 1, 2);
  INSERT INTO resident_notes (handle, household, body, written_at) VALUES ('alpha', 'hh:alpha', 'to my returning self', now());
  INSERT INTO letter_notes (household, letter, state, marked_at, marked_by) VALUES ('hh:alpha', 'l1', 'no-reply', now(), 'alpha');
  INSERT INTO reports (id, household, filed_by, about, about_household, body, filed_at, updated_at)
    VALUES ('report/0a1b2c3d', 'hh:alpha', 'alpha', 'beta', 'hh:beta', 'a private report', now(), now());
  INSERT INTO mail_blocks (household, blocked, placed_at, placed_by) VALUES ('hh:alpha', 'hh:beta', now(), 'alpha');
  INSERT INTO invite_holds (household, state, updated_at) VALUES ('beta', 'held', now());
  INSERT INTO letter_opens (handle, letter, household, opened_at, how) VALUES ('alpha', 'l1', 'hh:alpha', now(), 'read');
  INSERT INTO posts (id, title, author, posted_act, last_act, class, state) VALUES ('post-1', 'a feast', 'beta', 1, 1, 'notice', 'announced');
  INSERT INTO earpiece_wakes (event, handle, household, harness, wake_n, sent_at, status, budget_left)
    VALUES ('post-1', 'alpha', 'hh:alpha', 'mail', 0, now(), 'delivered', 0);
  INSERT INTO refused_acts (household, door, act) VALUES ('hh:alpha', 'rest', 'world:give');
  INSERT INTO arrival_heard (handle, household, heard, note, answered_at) VALUES ('alpha', 'alpha', 'friend', 'a note', now());
  INSERT INTO arrival_sources (household, tag, recorded_at) VALUES ('alpha', 'yt', now());
  INSERT INTO arrival_source_pending (gh_id, tag, parked_at) VALUES (1, 'yt', now());
  INSERT INTO berth_heard (slug, heard, note, parked_at) VALUES ('berth-1', 'friend', 'n', now());
  INSERT INTO parcel_room_nonces (household, nonce, handle, nth) VALUES ('alpha', 'buy-parcel-room:n1', 'alpha', 2);
`;
const PRIVATE_TABLES = ["oauth_tokens", "oauth_codes", "oauth_pending", "oauth_key_claims", "resident_notes", "letter_notes", "reports", "mail_blocks",
  "invite_holds", "letter_opens", "earpiece_wakes", "refused_acts", "arrival_heard", "arrival_sources", "arrival_source_pending", "berth_heard", "parcel_room_nonces"];

test("THE SCRUB RUN: seeded with a row in every private table, the scrub removes them all and leaves the public record, and the readback reads it", async () => {
  await q(SEED);
  const counts = async () => Object.fromEntries(await Promise.all(PRIVATE_TABLES.map(async (t) => [t, Number((await q(`SELECT count(*) FROM ${t}`)).rows[0].count)])));
  const before = await counts();
  assert.deepEqual(PRIVATE_TABLES.filter((t) => before[t] === 0), [], "the seed must put a row in every private table, or the zeros below prove nothing");
  assert.equal(Number((await q(`SELECT count(*) FROM claims WHERE status = 'draft'`)).rows[0].count), 2);

  // control: the readback sees what the seed planted (so the zeros after are the scrub's doing)
  const pre = lastRows(await q(READBACK_SQL));
  const nonZero = pre.filter((r) => r.t.startsWith("zero_") && Number(r.count) > 0).map((r) => r.t);
  for (const want of ["zero_claims_drafts", "zero_reports", "zero_mail_blocks", "zero_households_human", "zero_households_likeness_request", "zero_refused_acts", "zero_arrival_heard", "zero_parcel_room_nonces"]) {
    assert.ok(nonZero.includes(want), `before the scrub the readback must count the planted ${want}`);
  }

  const out = lastRows(await q(SCRUB));
  const lines = asLines(out);
  const after = await counts();
  assert.deepEqual(PRIVATE_TABLES.filter((t) => after[t] !== 0), [], "every private table is empty after the scrub");
  assert.ok(out.filter((r) => r.t.startsWith("zero_")).every((r) => Number(r.count) === 0), `every zero_ reads 0: ${lines}`);
  assert.ok(out.filter((r) => r.t.startsWith("present_")).every((r) => Number(r.count) > 0), `every present_ reads above 0: ${lines}`);
  if (HAS_BASH) assert.equal(check(lines).stdout.trim(), "rc=0", `the script's own check passes the real readback: ${check(lines).stdout}`);

  // the public record stays
  const claims = (await q(`SELECT slug, status FROM claims ORDER BY slug`)).rows;
  assert.deepEqual(claims, [{ slug: "beta/public-one", status: "pending" }, { slug: "beta/public-two", status: "refused" }], "the draft rows go, the docket stays whole");
  assert.equal(Number((await q(`SELECT count(*) FROM marks`)).rows[0].count), 1);
  assert.equal(Number((await q(`SELECT count(*) FROM acts`)).rows[0].count), 1);
  const hh = (await q(`SELECT slug, name, human, likeness, likeness_state FROM households ORDER BY ord`)).rows;
  assert.deepEqual(hh.map((h) => [h.slug, h.name, h.human]), [["alpha", "Alpha House", null], ["beta", "Beta House", null]], "the name stays, the human's name goes");
  assert.equal(hh[0].likeness.answer, "yes", "the household's likeness ANSWER is public and stays");
  assert.deepEqual(hh[0].likeness_state, { official: { version: 1, proof: "p", since: "s", depicts: ["alpha"] } }, "the request goes; the official pointer, which the public registry projects, stays");
  assert.equal(hh[1].likeness_state, null, "a likeness_state holding only a request becomes null");
});

// ── 5. THE ROLE SQL (finding 2): a password is data in a pipe, and survives every character ───────────────────────
bashTest("uat_role_sql makes a role whose password is exactly the one given (quote, backslash, dollar, newline-free), and NOLOGIN for none", async () => {
  const { default: pg } = await import("pg");
  const loginWith = async (password) => {
    // a config object, not a URL: a `%` in the password would be read as an escape in a connection string
    const c = new pg.Client({ host: "127.0.0.1", port: Number(new URL(store.url("postgres")).port), user: ROLE, password, database: store.database });
    try { await c.connect(); await c.query("SELECT 1"); return true; } catch { return false; } finally { await c.end().catch(() => {}); }
  };
  const tricky = `a'b"c\\d$e;f--g%h $do$`;
  const r = lib('uat_role_sql "$R" "$PW"', { R: ROLE, PW: tricky });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.stdout.includes(`'a''b"c\\d$e;f--g%h $do$'`), `the literal is single-quote-doubled and nothing else: ${r.stdout}`);
  await q(r.stdout);
  await q(r.stdout); // idempotent: a second run is a no-op that sets the same password
  assert.equal(await loginWith(tricky), true, "the role logs in with exactly the password given");
  assert.equal(await loginWith(tricky + "x"), false, "control: a wrong password is refused, so the line above proves the password and not a trust rule");
  const none = lib('uat_role_sql "$R" ""', { R: ROLE });
  await q(none.stdout);
  assert.equal(await loginWith(tricky), false, "an empty password makes the role NOLOGIN");
  assert.notEqual(lib('uat_role_sql "Bad;Role" x').status, 0, "a role name outside [a-z0-9_] is refused");
});

test("TEXT PIN (weak: reads the script, runs nothing): no psql in store-restore-scrub.sh takes a password as an argument", () => {
  const sh = read("store-restore-scrub.sh").split("\n").filter((l) => !l.trim().startsWith("#")).join("\n");
  assert.ok(!/-v\s+pw=/.test(sh) && !/PASSWORD\s+['"]?\$/.test(sh), "a `-v pw=` or an inline PASSWORD literal is back");
  assert.match(sh, /uat_role_sql "\$1" "\$pw" \| sudo -u postgres psql/, "the role SQL is piped to psql's standard input");
});

// ── 6. THE OWNERS (finding 7): the restored copy is handed to world2_owner, so its migrations can run ──────────────
test("own.sql hands every object in public to world2_owner, and only then can world2_owner run a migration on it", async () => {
  // make the copy look as a postgres-run restore leaves it: everything owned by postgres (a per-object loop; REASSIGN OWNED
  // would also move the DATABASES world2_owner owns on this shared server)
  await q(`DO $x$ DECLARE r record; BEGIN
    FOR r IN SELECT format('ALTER %s %s OWNER TO postgres', CASE c.relkind WHEN 'v' THEN 'VIEW' WHEN 'S' THEN 'SEQUENCE' ELSE 'TABLE' END, format('%I.%I', n.nspname, c.relname)) AS ddl
               FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v')
    LOOP EXECUTE r.ddl; END LOOP;
    FOR r IN SELECT format('ALTER FUNCTION %s OWNER TO postgres', p.oid::regprocedure) AS ddl FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'public' AND p.prokind = 'f'
    LOOP EXECUTE r.ddl; END LOOP;
  END $x$`);
  const notOwned = async () => Number((await q(`SELECT (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v') AND c.relowner <> 'world2_owner'::regrole)
    + (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proowner <> 'world2_owner'::regrole) AS n`)).rows[0].n);
  assert.ok(await notOwned() > 100, "control: the copy is postgres's before own.sql");
  const owner = await store.connect("world2_owner");
  try {
    await assert.rejects(owner.query(`ALTER TABLE households ADD COLUMN uat_probe integer`), /must be owner/, "control: world2_owner cannot migrate what postgres owns");
    const OWN = read("own.sql");
    const out = lastRows(await q(OWN));
    assert.equal(await notOwned(), 0, "every table, view and function is world2_owner's after own.sql");
    assert.deepEqual(out.map((r) => [r.t, Number(r.count)]), [["zero_not_owned_by_world2_owner", 0]]);
    await q(OWN); // idempotent
    await owner.query(`ALTER TABLE households ADD COLUMN uat_probe integer`);
    await owner.query(`ALTER TABLE households DROP COLUMN uat_probe`);
  } finally { await owner.end(); }
  const def = (await q(`SELECT proowner::regrole::text AS o FROM pg_proc WHERE proname = 'mail_block_stands'`)).rows[0];
  assert.equal(def.o, "world2_owner", "the SECURITY DEFINER functions the migrations name world2_owner for are its");
});

// ── 7. THE MIGRATION PLAN (finding 7): the release's migrations the copy lacks are found by the release's own probes ─
test("migrate-plan: a migration the copy lacks is planned (in order), applied as world2_owner, and then reads landed; a file with no probe refuses", async () => {
  const { planMigrations } = await import(pathToFileURL(join(KIT, "migrate-plan.mjs")).href);
  const { landedIn } = await import(pathToFileURL(join(ROOT, "world2", "tools", "migrations-landed.mjs")).href);
  const names = readdirSync(join(ROOT, "world2", "schema"));

  // pure: what the plan does with each state
  assert.deepEqual(planMigrations([{ file: "a.sql", state: "landed" }, { file: "b.sql", state: "missing" }, { file: "c.sql", state: "skip" }, { file: "d.sql", state: "missing" }]), { apply: ["b.sql", "d.sql"], refuse: [] });
  const refused = planMigrations([{ file: "a.sql", state: "missing" }, { file: "z.sql", state: "unknown", detail: "no probe" }]);
  assert.deepEqual(refused.apply, [], "a file with no probe plans nothing: the runner will not guess");
  assert.match(refused.refuse[0], /z\.sql/);

  // real: the restored copy is a week behind. Take 101's column and constraint away (as a prod dump from before it would lack them)
  const owner = await store.connect("world2_owner");
  try {
    const query = async (sql) => { const { rows } = await owner.query(sql); return { rows }; };
    assert.deepEqual(planMigrations(await landedIn(query, names)).apply, [], "control: the full schema has nothing missing");
    await owner.query(`ALTER TABLE households DROP CONSTRAINT households_human_profile_shape; ALTER TABLE households DROP COLUMN human_profile`);
    const plan = planMigrations(await landedIn(query, names));
    assert.deepEqual(plan, { apply: ["101_household_human_profile.sql"], refuse: [] }, "exactly the migration the copy lacks is planned");
    await owner.query(readFileSync(join(ROOT, "world2", "schema", plan.apply[0]), "utf8"));
    assert.deepEqual(planMigrations(await landedIn(query, names)).apply, [], "after applying it, the plan is empty (the script's second ask)");
    const unknown = planMigrations(await landedIn(query, [...names, "999_not_probed.sql"]));
    assert.deepEqual(unknown.apply, [], "a new schema file with no landed-probe refuses the whole plan");
    assert.match(unknown.refuse.join("\n"), /999_not_probed\.sql/);
  } finally { await owner.end(); }
});

// ── 8. TEXT PINS for what runs only on the box (weak: they read the scripts, they run nothing) ─────────────────────
test("TEXT PIN (weak): store-restore-scrub.sh checks the gate before any network call, the swap is one transaction, and a trap restarts the units", () => {
  const sh = read("store-restore-scrub.sh");
  assert.ok(sh.indexOf("uat_scrub_gate") < sh.indexOf("uaws sts get-caller-identity"), "the gate runs before AWS is touched");
  assert.match(sh, /pg_restore --exit-on-error --dbname "\$NEW"/);
  const at = (s) => { const i = sh.indexOf(s); assert.ok(i > 0, `${s} is in the script`); return i; };
  assert.ok(at('pg_restore --exit-on-error') < at('-f "$HERE/own.sql"') && at('-f "$HERE/own.sql"') < at('-f "$HERE/grants.sql"')
    && at('-f "$HERE/grants.sql"') < at('"$HERE/migrate-plan.mjs" --db') && at('"$HERE/migrate-plan.mjs" --db') < at('-f "$HERE/scrub.sql"'),
    "restore, owners, grants, migrations, then the scrub");
  assert.match(sh, /trap finish EXIT/);
  assert.match(sh, /STOPPED=1[\s\S]*systemctl stop[\s\S]*STOPPED=0/, "the units are marked stopped before they are, and cleared only after they start again");
  const swap = sh.slice(sh.indexOf("<<SQL"), sh.indexOf("\nSQL\n"));
  assert.match(swap, /^BEGIN;/m);
  assert.match(swap, /COMMIT;/);
  assert.ok(!/dropdb[^\n]*\$\{UAT_DB\}_prev"/.test(sh), "the previous copy is never dropped: it is renamed to _prev_old inside the transaction and that one is dropped after the commit");
  assert.ok(!/restore into .*owners and grants kept/.test(sh), "finding 12: the comment that claimed the dump's owners are kept is gone");
});

test("TEXT PIN (weak): nginx-uat.sh never chains `nginx -t &&` into a success line, checks the vhost before it is live, and restores on refusal", () => {
  const sh = read("nginx-uat.sh");
  const code = sh.split("\n").filter((l) => !l.trim().startsWith("#")).join("\n");
  assert.ok(!/nginx -t\s*&&/.test(code), "`nginx -t && systemctl reload` under set -e falls through to the success line when nginx -t fails");
  assert.match(code, /if ! nginx -t; then[\s\S]*uat_die/);
  assert.match(code, /systemctl reload nginx \|\| uat_die/);
  assert.ok(code.indexOf('> "$NEWV"') < code.indexOf('cat "$NEWV" > "$OUT"'), "the vhost is generated and checked beside the live one, then put in place");
  assert.ok(code.indexOf("grep -q 'server_name uat.postmark.town;' \"$NEWV\"") < code.indexOf('cat "$NEWV" > "$OUT"'));
});

test("TEXT PIN (weak): units.sh gives /srv/uat-stubs only to units that already write /srv/postmark-office; the sandboxed ones get nothing", () => {
  const sh = read("units.sh");
  assert.match(sh, /if grep -q '\^ReadWritePaths=\/srv\/postmark-office' "\$f"; then echo "ReadWritePaths=-\/srv\/uat-stubs"; fi/);
  // the premise, measured on the unit files this tree carries: the sandboxes have no such line, the pushers do
  const unit = (n) => readFileSync(join(ROOT, "deploy", n), "utf8");
  for (const pusher of ["postmark-office.service", "postmark-ferry.service", "postmark-crossing-save.service"]) assert.match(unit(pusher), /^ReadWritePaths=\/srv\/postmark-office/m, pusher);
  for (const sandbox of ["postmark-town-seal@.service", "postmark-town-tool@.service"]) assert.doesNotMatch(unit(sandbox), /^ReadWritePaths=\/srv\/postmark-office/m, sandbox);
});

test("TEXT PIN (weak): tunnel.sh restarts the connector after enabling it, so a rotated token is read; uat.slice weighs CPU", () => {
  const sh = read("tunnel.sh").split("\n").filter((l) => !l.trim().startsWith("#")).join("\n");
  assert.ok(!/enable --now cloudflared-uat/.test(sh));
  assert.match(sh, /systemctl enable --quiet cloudflared-uat\.service\nsystemctl restart cloudflared-uat\.service/);
  assert.match(read("uat.slice"), /^CPUWeight=500$/m);
});

test("TEXT PIN (weak): the env template carries no comment on PUBLIC_BASE's own line; the README names the GitHub callback URL", () => {
  const env = read("env/office.env.template");
  assert.match(env, /^PUBLIC_BASE=https:\/\/uat\.postmark\.town\/api$/m, "the value's own line ends at the value");
  assert.match(read("README.md"), /https:\/\/uat\.postmark\.town\/api\/oauth\/github\/callback/);
});
