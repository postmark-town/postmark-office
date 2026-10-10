#!/usr/bin/env node
// post-award-plan.mjs — the awards a hand recorded on idea posts, and the reviewed pass that pays them.
//
//   node tools/post-award-plan.mjs --town <town-clone> [--date YYYY-MM-DD]          the plan: writes nothing, needs no key;
//                                                     it ends with its digest and the one command that applies it
//   node tools/post-award-plan.mjs --town <town-clone> --date YYYY-MM-DD --apply --key <pem> --expect <digest>
//
//   env: WORLD2_PG_URL (or PG*), the office's own store — the plan reads the
//        idea class's award acts from it, and nothing else. TOWN_PUSH=1 pulls
//        the clone first and pushes what lands; STAMP_LINES=store records the
//        landed lines in the store (stamp_lines) in the commit's transaction.
//
//   On the box, by hand, as the office user, with the office's env:
//     sudo -u meepo sh -c 'set -a; . /etc/postmark-office.env; cd /srv/postmark-office;
//       node tools/post-award-plan.mjs --town "$TOWN_CLONE"'
//   then, once the plan reads right, the command it printed beneath its digest.
//
// ── WHY IT EXISTS: THE AWARD RECORDS, A REVIEWED PASS WRITES (POS-290) ──────
//
// Darko, 2026-10-09: "Pay by hand: a hands-only act that awards stamps on a post
// to a credited resident with a label. It writes MINT → <who> · N · for:
// post:<id>/<label>, so every award is traceable. It runs as a list Wright
// reviews before it writes, and no formula mints by itself yet." The award act
// (src/idea-store.mjs § awardAtTown) records who, how many and why, and moves no
// stamps. This tool reads those acts, prints one row per award with the reason
// it pays or does not, and — only with --apply, only by hand — writes the
// town's line through its own `stamp-mint.mjs --award-mint`, once per owed row.
//
// THE AMOUNT IS THE ACT'S. Nothing here computes one: the row carries the act's
// `stamps`, the verb is handed that number, and the line says it.
//
// ── NEVER ON THE TICK ───────────────────────────────────────────────────────
//
// It is a fork of bug-stage-plan.mjs's shape, and unlike that pass it is never
// scheduled: deploy/office-keep.sh exports OFFICE_KEEP=1, systemd sets
// INVOCATION_ID for any unit it starts, and this tool refuses to run at all,
// plan or apply, while either is set. Wright runs it by hand.
//
// ── THE APPLY WRITES THE PLAN THAT WAS READ (Wright, 2026-10-09) ────────────
//
// The plan ends with a digest: sha256 over the exact lines it would write, in
// order. Beneath it is the one command that applies it, which carries
// `--expect <digest>`. --apply refuses unless --expect equals the digest of
// the plan it is about to write, with both digests shown. So an award recorded,
// a line paid or a date changed between the reading and the apply refuses the
// apply instead of slipping into it.
//
// ── WHAT DECIDES A ROW ──────────────────────────────────────────────────────
//
//   already paid   a `post:<id>/<label>` award line already in the town's
//                  ledger, read with the town's own classifier. One line per
//                  post and label, ever (the town's law), so it pays never again.
//   meep           the town's meep law (its ledger's `rules:` lines through its
//                  own meepChecker), at the act's date and at the line's: a meep
//                  never receives stamps, and the row pays 0.
//   unresolved     the recipient has no room in the town (the verb's own
//                  householdKeys read): an award needs a resident to receive it.
//   refused        the town's builder would refuse the line (a label that is a
//                  bug stage's name, more than AWARD_MAX, a `by:` that is not a
//                  hand), or a second award act names a (post, label) an earlier
//                  act already holds; the row carries the sentence and pays 0.
//   owed           everything else: the pass writes it.
//
// ── THE PARSE IS BOUND, AND SO IS THE AMOUNT ────────────────────────────────
//
// --apply prints the plan, parses its own printed plan back, and refuses the
// WHOLE apply, writing nothing, when the rows it parsed differ from the plan in
// any field (an amount, a recipient, a label, a hand, a count, the date). The
// money is minted from the plan's own rows, which the printed text has just been
// shown to equal.
//
// ── IT LANDS, WHOLE OR NOTHING, UNDER THE TOWN LOCK ─────────────────────────
//
// The bug stage pass only appends; the tick around it verifies, commits, pushes
// and records the lines in the store. A pass run by hand has no tick around it,
// so it lands on its own, the way a founder gift does (src/gift-exec.mjs):
// under the exclusive town flock the tick and the ferry take (on linux it
// re-runs itself under /usr/bin/flock), inside the pen's transaction, the
// town's verb once per owed row, the town's stamp-verify, then `landStamped`
// (with STAMP_LINES=store, `syncStampLinesVia`: insertStampRowsVia under
// lockStampLinesVia, in the store transaction around the commit and push). Any
// refusal on the way (a verb, the verifier, a push that cannot land) puts the
// ledger back as it stood, and nothing is written. It never catches the
// ledger up: a ledger behind the mail is the tick's to settle, and the verb's
// refusal says so.

import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { IDEA_CLASS, ACT_AWARD, AWARD_HANDS, AWARD_MAX } from "../src/ideas.mjs";
import { townDate } from "./bug-stage-plan.mjs";

const LEDGER_REL = join("WHITE_PAGES", "stamp-ledger.md");
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const payloadOf = (a) => (typeof a.payload === "string" ? JSON.parse(a.payload) : (a.payload ?? {}));

/**
 * THE PLAN, PURE. `acts` are the idea class's award acts, oldest first;
 * `isMeep(handle, date)` the town's meep law; `paid` a Map of
 * `<post>/<label>` → `{ handle, n, date }` already in the town's ledger;
 * `hasRoom(handle)` the town's rooms; `lineOf(row)` the town's own line builder
 * (throws its refusal); `date` the date the lines would carry.
 *
 * One row per award act:
 *   { post, label, handle, n, hand, act, date, why, owed, line? }
 * `n` is the act's amount, or 0 for a row that pays nothing; `date` is the
 * act's own (town time); `owed` is true only for a row the pass should write,
 * and an owed row carries `line`, the exact unsigned line the town's builder
 * makes for it.
 */
export function planAwards({ acts, isMeep, paid = new Map(), hasRoom, lineOf, date, tz }) {
  const rows = [];
  const held = new Map();   // `${post}/${label}` -> the act that holds it in this plan
  for (const a of acts) {
    if (a.action !== ACT_AWARD) continue;
    const p = payloadOf(a);
    const post = String(p.post ?? a.object);
    const label = String(p.label ?? "");
    const handle = String(p.to ?? "");
    const hand = String(p.hand ?? a.actor);
    const asked = Number(p.stamps);
    const base = { post, label, handle, hand, act: Number(a.id), date: townDate(a.at, tz) };
    const key = `${post}/${label}`;
    const nothing = (why) => rows.push({ ...base, n: 0, why, owed: false });

    const was = paid.get(key);
    if (was) {
      const same = was.handle === handle && was.n === asked;
      rows.push({ ...base, n: asked, owed: false,
        why: same ? "already paid" : `already paid: the ledger pays post:${key} ${was.n} to ${was.handle} on ${was.date}, not this act's ${asked} to ${handle}` });
      continue;
    }
    if (held.has(key)) { nothing(`refused: post:${key} is already awarded by act ${held.get(key)}; one line per post and label, and the earlier act is the one paid`); continue; }
    held.set(key, base.act);
    if (isMeep(handle, base.date) || isMeep(handle, date)) { nothing("meep: a meep never receives stamps"); continue; }
    if (!hasRoom(handle)) { nothing(`unresolved: ${handle} has no room in the town; an award needs a resident to receive it`); continue; }
    let line;
    try { line = lineOf({ date, handle, n: asked, post, label, by: hand }); }
    catch (e) { nothing(`refused: ${String(e?.message ?? e).split(/\r?\n/)[0]}`); continue; }
    rows.push({ ...base, n: asked, why: "owed", owed: true, line });
  }
  return rows;
}

// ── the plan, printed ───────────────────────────────────────────────────────

const HEADER_RE = /^idea award plan — (\d+) award\(s\) recorded, (\d+) already paid, (\d+) pay nothing, (\d+) owed \((\d+) stamps\), dated (\d{4}-\d{2}-\d{2})$/;
const ROW = (r) => `  ${r.post}/${r.label} · ${r.handle} · ${r.n} · by ${r.hand} · ${r.why} · act ${r.act} on ${r.date}`;
const OWED_RE = /^ {2}([a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9-]*)\/([a-z0-9][a-z0-9-]{0,39}) · (\S+) · (\d+) · by (\S+) · owed · act (\d+) on (\d{4}-\d{2}-\d{2})$/;
const alreadyPaid = (r) => !r.owed && r.why.startsWith("already paid");

/** The plan as a person reads it: the header's counts and the lines' date, then OWED, ALREADY PAID and PAYS NOTHING. */
export function renderPlan(rows, { date }) {
  const owed = rows.filter((r) => r.owed);
  const already = rows.filter(alreadyPaid);
  const nothing = rows.filter((r) => !r.owed && !alreadyPaid(r));
  const out = [`idea award plan — ${rows.length} award(s) recorded, ${already.length} already paid, ${nothing.length} pay nothing, ${owed.length} owed (${owed.reduce((s, r) => s + r.n, 0)} stamps), dated ${date}`];
  for (const [title, list] of [["OWED", owed], ["ALREADY PAID", already], ["PAYS NOTHING", nothing]]) {
    if (!list.length) continue;
    out.push("", title, ...list.map(ROW));
  }
  return `${out.join("\n")}\n`;
}

/**
 * THE DIGEST OF WHAT THE PLAN WOULD WRITE. PURE. sha256 over the owed rows'
 * exact lines (the town builder's, unsigned, the date in each), in the plan's
 * order, one per line. The plan prints it; --apply refuses unless `--expect`
 * names it, so the apply writes only the list a person read.
 */
export function planDigest(rows) {
  const lines = rows.filter((r) => r.owed).map((r) => r.line);
  return `sha256:${createHash("sha256").update(lines.join("\n")).digest("hex").slice(0, 16)}`;
}

/** The digest, and beneath it the exact command that applies this plan and no other. */
export const renderApplyHint = (digest, { town, date, keyPath }) =>
  `digest: ${digest}\napply exactly this plan with:\n  node tools/post-award-plan.mjs --town ${town} --date ${date} --apply --key ${keyPath} --expect ${digest}\n`;

/**
 * The plan, read back. PURE. Throws on a plan it cannot account for: the
 * header's owed count and stamps against the rows parsed.
 */
export function parseAwardPlan(text) {
  const lines = String(text ?? "").split(/\r?\n/);
  const header = lines.map((l) => HEADER_RE.exec(l.trim())).find(Boolean);
  if (!header) throw new Error("post-award-plan: the plan printed no header this pass can read — the wording changed, and the parser must be trued to it before the pass runs again");
  const claimed = Number(header[4]);
  const stamps = Number(header[5]);
  const start = lines.indexOf("OWED");
  const owed = [];
  if (start !== -1) {
    for (const line of lines.slice(start + 1)) {
      if (line.trim() === "") break;
      const m = OWED_RE.exec(line);
      if (!m) throw new Error(`post-award-plan: unreadable owed row: ${JSON.stringify(line)}`);
      owed.push({ post: m[1], label: m[2], handle: m[3], n: Number(m[4]), hand: m[5], act: Number(m[6]), date: m[7] });
    }
  }
  if (owed.length !== claimed)
    throw new Error(`post-award-plan: the plan says ${claimed} owed and this pass parsed ${owed.length} — refusing to mint a set it cannot fully account for`);
  const sum = owed.reduce((s, r) => s + r.n, 0);
  if (sum !== stamps)
    throw new Error(`post-award-plan: the plan says ${stamps} stamps owed and its rows add to ${sum} — refusing to mint a set it cannot fully account for`);
  return { owed, claimed, stamps, date: header[6] };
}

const FIELDS = ["post", "label", "handle", "n", "hand", "act", "date"];

/** The printed plan against the plan: null when they agree, else the first difference, in words. PURE. */
export function planDiffers(parsed, rows, date) {
  if (parsed.date !== date) return `the lines' date: printed ${parsed.date}, planned ${date}`;
  const owed = rows.filter((r) => r.owed);
  if (parsed.owed.length !== owed.length) return `owed rows: printed ${parsed.owed.length}, planned ${owed.length}`;
  for (let i = 0; i < owed.length; i++)
    for (const f of FIELDS)
      if (parsed.owed[i][f] !== owed[i][f]) return `owed row ${i + 1} (act ${owed[i].act}), ${f}: printed ${JSON.stringify(parsed.owed[i][f])}, planned ${JSON.stringify(owed[i][f])}`;
  return null;
}

// ── the town's engine, read from its own clone ──────────────────────────────

/** The town's classifier, meep law, rooms and award line, imported from the clone — or a refusal naming what is missing. */
export async function townEngine(town) {
  const tool = join(town, "tools", "stamp-mint.mjs");
  if (!existsSync(tool)) throw new Error(`post-award-plan: no tools/stamp-mint.mjs in ${town} — --town names the town clone`);
  const engine = await import(pathToFileURL(tool).href);
  if (typeof engine.awardMintLine !== "function" || !engine.AWARD_HANDS)
    throw new Error("post-award-plan: this town's stamp-mint.mjs has no award grammar (post:<id>/<label>), so the plan cannot see what is already paid — the town must carry --award-mint first");
  // The award's terms are held twice (the class law here, the money law there); say so if they part.
  const theirs = [...engine.AWARD_HANDS].sort().join(",");
  if (theirs !== [...AWARD_HANDS].sort().join(",") || engine.AWARD_MAX !== AWARD_MAX)
    throw new Error(`post-award-plan: the office's award law (hands ${[...AWARD_HANDS].sort().join(",")}, at most ${AWARD_MAX}) and the town's (hands ${theirs}, at most ${engine.AWARD_MAX}) part — refusing until they agree`);
  const ledgerFile = join(town, LEDGER_REL);
  const entries = existsSync(ledgerFile) ? engine.parseStampLedger(readFileSync(ledgerFile, "utf8")) : [];
  const { laws } = engine.parseLaws(entries);
  const meep = engine.meepChecker(laws);
  const paid = new Map();
  for (const e of entries) {
    const c = engine.classifyEntry(e.canonical);
    if (c.kind === "post-award") paid.set(`${c.post}/${c.label}`, { handle: c.handle, n: c.n, date: c.date });
  }
  const rooms = engine.householdKeys(town);
  return { isMeep: (h, d) => meep(h, d), paid, hasRoom: (h) => rooms.has(h), lineOf: engine.awardMintLine };
}

/** The idea class's award acts, from the office's store, oldest first. */
export async function storeFacts({ env = process.env } = {}) {
  const { officeRead } = await import("../src/world2-pen.mjs");
  return officeRead(async (client) => {
    const { rows } = await client.query(
      "SELECT id, actor, action, object, payload, at FROM acts WHERE class = $1 AND action = $2 ORDER BY id", [IDEA_CLASS, ACT_AWARD]);
    return { acts: rows };
  }, { env });
}

/** The town's own verb, by absolute path, handed --repo explicitly (bug-stage-plan.mjs § stageMintArgv). `--by` is the act's hand. */
export const awardMintArgv = (town, r, { date, keyPath }) => [join(town, "tools", "stamp-mint.mjs"),
  "--award-mint", r.handle, "--post", r.post, "--label", r.label, "--amount", String(r.n), "--by", r.hand,
  "--date", date, "--key", keyPath, "--repo", town];

/** The town's own verifier over the clone. */
export const verifyArgv = (town) => [join(town, "tools", "stamp-verify.mjs"), "--repo", town];

/** On linux, the apply re-runs itself under the town's exclusive flock: the argv for that, PURE. */
export const lockedArgv = (self, argv, lockPath) => ["/usr/bin/flock", ["-w", "300", lockPath, process.execPath, self, ...argv]];

/**
 * Is this run scheduled rather than by hand? The keeping tick says so with
 * OFFICE_KEEP (deploy/office-keep.sh exports it), and systemd sets
 * INVOCATION_ID for every unit it starts, so a future timer is caught too. A
 * login shell carries neither. The reason in words, or null.
 */
export function scheduled(env) {
  if (env.OFFICE_KEEP) return "OFFICE_KEEP is set, so this is the keeping tick";
  if (env.INVOCATION_ID) return "INVOCATION_ID is set, so systemd started this run as a unit";
  return null;
}

const run = (town, argv) => spawnSync(process.execPath, argv, { cwd: town, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const git = (repo, ...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8" }).trim();
const arg = (name, argv) => { const i = argv.indexOf(name); return i === -1 ? null : argv[i + 1]; };
const firstLine = (out) => (String(out.stderr ?? "").trim() || String(out.stdout ?? "").trim()).split(/\r?\n/)[0] || `exit ${out.status}`;

/**
 * The whole pass, run by a caller that holds the town lock for an --apply (the
 * CLI below takes it). `facts`, `spawn` and `printed` are injectable so a
 * suite drives the same path in-process against a store it made and a
 * synthetic town; `printed` stands for what reaches the screen between print
 * and parse.
 */
export async function main(argv = process.argv.slice(2), { facts = null, spawn = run, printed = (t) => t, log = console.log, err = console.error, env = process.env } = {}) {
  const unit = scheduled(env);
  if (unit) { err(`post-award-plan: refused — ${unit}, and the award pass never runs from the tick or any timer: Wright runs it by hand (POS-290). Nothing read, nothing written.`); return 2; }
  const town = arg("--town", argv);
  const apply = argv.includes("--apply");
  const keyPath = arg("--key", argv);
  const expect = arg("--expect", argv);
  if (!town || !existsSync(town)) { err("post-award-plan: --town <town-clone> is required and must exist"); return 1; }
  if (apply && (!keyPath || !existsSync(keyPath))) { err("post-award-plan: --apply needs --key <ed25519-private-pem>"); return 1; }
  if (apply && !expect) { err("post-award-plan: --apply needs --expect <digest>, the digest the plan printed: run the plan, read it, then apply exactly that one. Nothing written."); return 1; }
  const date = arg("--date", argv) ?? townDate(Date.now());
  if (!DATE_RE.test(date)) { err(`post-award-plan: --date is YYYY-MM-DD, got ${JSON.stringify(date)}`); return 1; }

  if (apply) {
    if (git(town, "status", "--porcelain", "--", LEDGER_REL)) {
      err(`post-award-plan: the clone's ${LEDGER_REL} has changes nobody committed — a pass that writes onto them could not put them back. Nothing written; the tick (or a person) settles them first.`);
      return 1;
    }
  }

  const { penTransaction } = await import("../src/write.mjs");
  const { landStamped } = await import("../src/stamp-lines.mjs");
  const pass = async () => {
    if (apply && env.TOWN_PUSH === "1") git(town, "pull", "--ff-only", "-q");
    let engine, store;
    try {
      engine = await townEngine(town);
      store = facts ?? await storeFacts({ env });
    } catch (e) { return { error: String(e?.message ?? e) }; }
    const rows = planAwards({ acts: store.acts, ...engine, date });
    const digest = planDigest(rows);
    const text = printed(renderPlan(rows, { date }));
    log(text.trimEnd());
    if (!apply) {
      log("");
      log(renderApplyHint(digest, { town, date, keyPath: keyPath ?? env.STAMP_KEY ?? "/srv/postmark-office/stamp-key.pem" }).trimEnd());
      return { planOnly: true };
    }
    log(`digest: ${digest}`);
    // ⚑ THE REVIEWED PLAN. The apply writes only the list a person read: the
    // digest of what this run would write against the one they copied.
    if (expect !== digest)
      return { error: `post-award-plan: this plan is not the one reviewed — --expect ${expect}, and the plan this run would write is ${digest}. Something changed since the plan was printed (an award recorded, a line paid, another date). Nothing written: run the plan again and read it.` };

    let parsed;
    try { parsed = parseAwardPlan(text); } catch (e) { return { error: e.message }; }
    const differs = planDiffers(parsed, rows, date);
    if (differs) return { error: `post-award-plan: the printed plan is not the plan (${differs}) — refusing the whole apply, nothing written` };
    const owed = rows.filter((r) => r.owed);
    if (!owed.length) return { written: [] };

    // ONLY the rows the plan named, one line each, through the town's own verb.
    for (const r of owed) {
      const out = spawn(town, awardMintArgv(town, r, { date, keyPath }));
      if (out.status !== 0) return { error: `post-award-plan: REFUSED post:${r.post}/${r.label} → ${r.handle} — ${firstLine(out)}. The whole apply is put back, nothing written; the row stays owed.` };
    }
    const verified = spawn(town, verifyArgv(town));
    if (verified.status !== 0) return { error: `post-award-plan: the town's stamp-verify is red after the award lines — ${firstLine(verified)}. The whole apply is put back, nothing written.` };
    const message = `mint: the reviewed award pass (POS-290), ${owed.length} award line(s)\n\n${owed.map((r) => `post:${r.post}/${r.label} → ${r.handle} · ${r.n} · by: ${r.hand} (act ${r.act})`).join("\n")}`;
    const landed = await landStamped(town, [join(town, LEDGER_REL)], message, { env });
    if (landed?.error) return { error: `post-award-plan: the award lines could not land (${landed.error.defect ?? landed.error.code}) — ${landed.error.hint ?? ""}. Put back, nothing written.` };
    return { written: owed, commit: landed };
  };

  const out = apply ? await penTransaction(town, pass) : await pass();
  if (out?.error) { err(out.error); return 1; }
  if (out.planOnly) { log("[post-award-plan] the plan only — nothing written, nothing signed. Review it, then --apply."); return 0; }
  if (!out.written.length) { log("[post-award-plan] nothing owed"); return 0; }
  for (const r of out.written) log(`[post-award-plan] minted ${r.n} → ${r.handle} · post:${r.post}/${r.label} · by: ${r.hand}`);
  log(`[post-award-plan] ${out.written.length} award line(s) verified and landed${out.commit ? ` at ${out.commit}` : ""}${env.STAMP_LINES === "store" ? ", recorded in the store's stamp_lines" : ""}`);
  return 0;
}

/**
 * THE COMMAND. An --apply holds the town lock for its whole run: the tick, the
 * ferry and every shared-ledger exec take it exclusively, so the pass never
 * races a mint or a crossing. On linux the command re-runs itself under
 * `/usr/bin/flock -w 300` on the tick's own lock file (src/town-lock.mjs §
 * townLockPath); the child, marked POST_AWARD_LOCKED=1, runs the pass. The plan
 * alone reads, and takes no lock.
 */
export async function cli(argv = process.argv.slice(2), env = process.env) {
  if (argv.includes("--apply") && !scheduled(env) && env.POST_AWARD_LOCKED !== "1") {
    const { useFlock, townLockPath } = await import("../src/town-lock.mjs");
    if (useFlock()) {
      const [file, args] = lockedArgv(fileURLToPath(import.meta.url), argv, townLockPath());
      const out = spawnSync(file, args, { stdio: "inherit", env: { ...env, POST_AWARD_LOCKED: "1" } });
      return out.status ?? 1;
    }
  }
  return main(argv, { env });
}

// Script only when run as one (the realpath compare: deploy/welcome-pass.mjs § entry guard).
const isMain = (() => {
  if (!process.argv[1]) return false;
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return pathToFileURL(process.argv[1]).href === import.meta.url; }
})();
if (isMain) process.exit(await cli());
