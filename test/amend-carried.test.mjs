// amend-carried.test.mjs — the store records which settlement carried each door
// amend (POS-612, migration 075), and the receipt reads it as `last_amended`.
//
//   node --test test/amend-carried.test.mjs      (the store from embedded-postgres)
//
// THE INSTANCE: keith/waiting-room-stool-2026-09-10, first carried at S65, amended
// at the door (claim 08a6b024, candle 244), carried by S104. On 10-14 its receipt
// still read "published at S65 (fc74bf68)" and was misread as an amend that never
// landed. Darko ruled the answer (10-14): `last_amended: { s, sha, at, window }`
// and the sentence "published at S65, last amended at S104".
//
// THE RIG, mark-carried.test.mjs's: a tagged world repo built here (one ANNOTATED
// settlement/S<n> per crossing) and a real Postgres with the whole schema. Every
// mark file carries a frontmatter `date`, and every door amend restamps it, as the
// door does (mark-render.mjs: "Every door amend restamps `date`").
//
//   S1  window 101  keith/the-stool, lupi/the-step, wright/the-lamp added (date D0)
//   S2  window 102  wright/the-gate added; the step's file REWRITTEN BY A MIGRATION
//                   (key order, as a0c779a0 did at S64 and the un-nesting 857dc401
//                   at S99): its bytes change, nobody's amend lands
//   S3  window 104  the stool's first amend lands (window 103 had no settlement)
//   S4  window 105  the step's amend lands, by a hand commit (POS-446's class)
//   S5  window 106  the lamp's file changed by hand (a marks-ingest amend follows)
//   S6  window 107  the stool's second amend lands
//
// THE DOCKET (door amends are locked claims with `supersedes` set):
//   stool-a  candle 103 → S3, whose file holds its date: PROVEN, written
//   step-a   candle 102 → S2, which changed the file but holds D0, not its date:
//            UNPROVEN, no row (review-612 F1: the false-positive class)
//   stool-b  candle 107 → S6: PROVEN; the stool's LAST amend
//   lamp-i   candle 106, `data._ingested_from`: a file-side change, never planned
//   lamp-b   candle 108, past every settled window: UNSETTLED
//   stool-p  pending at candle 107: not a version
//
// THE CAN-FAIL FLIPS:
//   · amend-carried.mjs § proofFrom: return true once the blob changed (the old
//     proof). APPLY reds: step-a is written at S2, which carried no amend.
//   · world2-claims.mjs § lastAmendedRow: ORDER BY a.settlement ASC. THE TWO
//     DOORS reds: both name S3, the first amend, not the last.
//   · settlements-backfill.mjs § amendsOnTick: rethrow in the catch. The
//     throwing-record case and the CLI exit-code case red.
//   · recordAmendsCarried: cap on every door amend with no row. THE CAP reds.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { startStore } from "./helpers/embedded-store.mjs";
import {
  planAmendsCarried, proofFrom, holdsAmend, markFileParts, recordAmendsCarried, verifyAmendsCarried, amendsLine, isDoorAmend,
  HAND_CARRIED, TICK_CAP, proposedLines,
} from "../world2/tools/amend-carried.mjs";
import { amendsOnTick, softStepStatus } from "../world2/tools/settlements-backfill.mjs";
import { SOFT_STEPS, STEPS, buildReceipt, appendReceipt, judgeKeep } from "../deploy/keep-history.mjs";
import { readMarkReceipt } from "../src/mark-receipt.mjs";
import { twinReceipt } from "../src/world2-serve.mjs";
import { __setPoolForTest } from "../src/world2-claims.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OFFICE = join(HERE, "..");
const MIGRATION = join(OFFICE, "world2", "schema", "075_amend_carried.sql");

// ── the world ────────────────────────────────────────────────────────────────

const world = mkdtempSync(join(tmpdir(), "postmark-amend-carried-"));
after(() => rmSync(world, { recursive: true, force: true }));
let clock = Date.parse("2026-09-20T06:00:00Z");
const git = (...a) => execFileSync("git", ["-C", world, ...a], {
  encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, GIT_COMMITTER_DATE: new Date(clock).toISOString(), GIT_AUTHOR_DATE: new Date(clock).toISOString(), TZ: "UTC" },
});
const put = (p, t) => { const f = join(world, p); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, t); };
const markPath = (id) => `WORLD/marks/${id}/mark.md`;
// Each body unlike every other (`--follow` pairs look-alikes), and the date line
// is the amend's own.
const textOf = (id, note) => `${id}: ${note}\n`
  + [...id].map((ch, i) => `${i} ${ch.charCodeAt(0) * (i + 7)} ${id.split("").reverse().join("")}`).join("\n") + "\n";
const record = (id, { date, note, dateFirst = false }) => {
  const front = dateFirst ? `date: ${date}\nby: ${id.split("/")[0]}` : `by: ${id.split("/")[0]}\ndate: ${date}`;
  return `---\n${front}\n---\n\n${textOf(id, note)}`;
};
const ids = new Set();
const SHA = {}, DATE = {};
function settle(n, files = {}) {
  for (const [id, rec] of Object.entries(files)) { put(markPath(id), record(id, rec)); ids.add(id); }
  put("WORLD/world-state.json", JSON.stringify({ marks: [...ids].sort().map((id) => ({ id })) }, null, 1));
  git("add", "-A");
  git("-c", "user.name=crossing", "-c", "user.email=c@t.invalid", "commit", "-q", "--allow-empty", "-m", `settlement: S${n}`);
  git("-c", "user.name=the Worldkeeper", "-c", "user.email=k@t.invalid", "tag", "-a", "-m", `S${n}`, `settlement/S${n}`);
  SHA[n] = git("rev-parse", `settlement/S${n}^{commit}`).trim();
  DATE[n] = new Date(clock);
  clock += 12 * 3600e3;
}
const STOOL = "keith/the-stool", STEP = "lupi/the-step", LAMP = "wright/the-lamp", GATE = "wright/the-gate";
const D0 = "2026-09-20T05:00:00.000Z";
const D_STOOL_A = "2026-09-21T01:00:00.000Z", D_STOOL_B = "2026-09-22T17:00:00.000Z", D_STEP = "2026-09-20T15:00:00.000Z";
git("init", "-q", "-b", "main");
settle(1, { [STOOL]: { date: D0, note: "declared" }, [STEP]: { date: D0, note: "declared" }, [LAMP]: { date: D0, note: "declared" } });
settle(2, { [GATE]: { date: D0, note: "declared" }, [STEP]: { date: D0, note: "declared", dateFirst: true } });
settle(3, { [STOOL]: { date: D_STOOL_A, note: "amended once" } });
settle(4, { [STEP]: { date: D_STEP, note: "stepped" } });
settle(5, { [LAMP]: { date: D0, note: "rewritten by hand" } });
settle(6, { [STOOL]: { date: D_STOOL_B, note: "amended twice" } });
const WINDOW_OF = { 1: 101, 2: 102, 3: 104, 4: 105, 5: 106, 6: 107 };

// The store is started before any test is declared: a top-level await between
// tests lets the root's `after` hooks run early, and the world above would go.
const store = await startStore({ db: "amend_carried_test" });
const skip = store.skip ?? false;
after(async () => { if (!skip) await store.stop(); });

// ── the pure half ────────────────────────────────────────────────────────────

const SETTLED = Object.entries(WINDOW_OF).map(([n, w]) => ({ number: Number(n), window_id: w }));
const amend = (over) => ({ id: "a", slug: STOOL, status: "locked", window_id: 103, supersedes: "s0", ingested: false, ...over });
const proves = (yes) => () => yes;

test("plan: the lowest settlement whose window is at or after the amend's, written only when proven", () => {
  const plan = planAmendsCarried({ amends: [amend()], settlements: SETTLED, proof: proves(true) });
  assert.deepEqual(plan, [{ claim: "a", mark: STOOL, window: 103, state: "new", settlement: 3 }], "window 103 had no settlement; S3 closed 104");
});

test("--list's lines: every proven row, by settlement then mark, with its claim; no other state is listed (POS-579 follow-up)", () => {
  const plan = [
    { claim: "c2", mark: "z/two", window: 103, state: "new", settlement: 6 },
    { claim: "c1", mark: "a/one", window: 102, state: "new", settlement: 3 },
    { claim: "c3", mark: "b/unproven", window: 102, state: "unproven", candidate: 3, prev: 2 },
    { claim: "c4", mark: "c/late", window: 120, state: "unsettled" },
  ];
  assert.deepEqual(proposedLines(plan), [
    "  new        S3  a/one  claim c1  candle 102",
    "  new        S6  z/two  claim c2  candle 103",
  ]);
  assert.deepEqual(proposedLines([]), []);
});

test("plan: an unproven candidate is named with its settlement and gets no row", () => {
  const plan = planAmendsCarried({ amends: [amend()], settlements: SETTLED, proof: proves(false) });
  assert.deepEqual(plan.map((p) => [p.state, p.candidate, p.prev]), [["unproven", 3, 2]]);
});

test("plan: the proof is handed the amend's own date and body", () => {
  const seen = [];
  planAmendsCarried({ amends: [amend({ date: D_STOOL_A, body: "b" })], settlements: SETTLED, proof: (...a) => { seen.push(a); return true; } });
  assert.deepEqual(seen, [[STOOL, 3, 2, { date: D_STOOL_A, body: "b" }]]);
});

test("plan: past every settled window is unsettled; a claim with a row is never planned again", () => {
  assert.equal(planAmendsCarried({ amends: [amend({ window_id: 120 })], settlements: SETTLED, proof: proves(true) })[0].state, "unsettled");
  assert.deepEqual(planAmendsCarried({ amends: [amend()], have: new Set(["a"]), settlements: SETTLED, proof: proves(true) }), []);
});

test("plan: only door amends — no marks-ingest row, no seed, no claim that is not locked", () => {
  const rows = [amend({ id: "i", ingested: true }), amend({ id: "s", supersedes: null }), amend({ id: "x", slug: null }),
    ...["pending", "refused", "retracted", "held_review"].map((status) => amend({ id: status, status }))];
  assert.equal(rows.filter(isDoorAmend).length, 0);
  assert.deepEqual(planAmendsCarried({ amends: rows, settlements: SETTLED, proof: proves(true) }), []);
});

test("plan: POS-446's five are 075's to write, never the window rule's", () => {
  for (const h of HAND_CARRIED) {
    const [p] = planAmendsCarried({ amends: [amend({ id: h.mark, slug: h.mark, window_id: h.window })], settlements: SETTLED, proof: proves(true) });
    assert.equal(p.state, "hand", h.mark);
  }
});

test("POS-446 · the tool's five and 075's five are the same five, at the same candles; 075 waits at most 5 s for its locks", () => {
  const sql = readFileSync(MIGRATION, "utf8");
  const inSql = [...sql.matchAll(/ARRAY\['([^']+)', '(\d+)'\]/g)].map((m) => `${m[1]}@${m[2]}`).sort();
  assert.deepEqual(inSql, HAND_CARRIED.map((h) => `${h.mark}@${h.window}`).sort());
  assert.deepEqual(HAND_CARRIED.map((h) => h.mark).sort(), [
    "berthillon/cone-peche-de-vigne-2026-08-27", "berthillon/cone-poire-williams-2026-09-15",
    "lupi/the-unworn-step", "vermillion/pagani-huayra", "vermillion/pagani-zonda"]);
  assert.match(sql, /'10e5b194acffedab9c5a6177ba6dc7f4360fcf96'/, "the hand commit, whole");
  // review-612 F4: the FK takes SHARE ROW EXCLUSIVE on claims and settlements.
  assert.match(sql, /^BEGIN;\s*(?:--[^\n]*\n\s*)*SET LOCAL lock_timeout = '5s';\s*(?:--[^\n]*\n\s*)*CREATE TABLE IF NOT EXISTS amend_carried/m,
    "the lock timeout is the transaction's first statement, before the table and its FKs");
});

test("holdsAmend: a dated amend is proven by its own date, an undated one by its body; nothing else proves", () => {
  const text = record(STOOL, { date: D_STOOL_A, note: "amended once" });
  assert.equal(holdsAmend(text, { date: D_STOOL_A }), true);
  assert.equal(holdsAmend(text, { date: "2026-09-21T01:00:00Z" }), true, "compared as an instant");
  assert.equal(holdsAmend(text, { date: D0 }), false, "another version's date");
  assert.equal(holdsAmend(text, { body: textOf(STOOL, "amended once") }), true);
  assert.equal(holdsAmend(text, { body: "something else" }), false);
  assert.equal(holdsAmend(text, {}), false, "an amend with neither proves nothing");
  assert.equal(holdsAmend("no frontmatter", { body: "no frontmatter" }), false);
  assert.deepEqual(markFileParts(`---\r\nby: keith\r\ndate: "${D0}"\r\n---\r\n\r\nhi\r\n`), { date: D0, body: "\nhi\n" });
});

test("the proof: S<n> must change the file AND hold this amend — a migration's rewrite is no proof (review-612 F1)", () => {
  const prove = proofFrom(world);
  assert.equal(prove(STOOL, 3, 2, { date: D_STOOL_A }), true, "S3 carried stool-a");
  assert.equal(prove(STOOL, 3, 2, { date: D_STOOL_B }), false, "S3 changed the stool, but not to stool-b");
  assert.equal(prove(STOOL, 6, 5, { date: D_STOOL_B }), true, "S6 carried stool-b");
  assert.equal(prove(STEP, 2, 1, { date: D_STEP }), false, "S2 rewrote the step's file (key order) without carrying step-a");
  assert.equal(prove(STEP, 4, 3, { date: D_STEP }), true, "S4 did carry it, by hand");
  assert.equal(prove(STOOL, 2, 1, { date: D0 }), false, "a settlement that did not change the file proves nothing, even when the date matches");
  assert.equal(prove("nobody/never-was", 3, 2, { date: D0 }), false, "no file is no proof");
  assert.equal(prove(STOOL, 99, 3, { date: D_STOOL_A }), false, "no tag is no proof");
});

test("THE TICK STEP NEVER THROWS: a failing record is one non-fatal line (review-612 F2)", async () => {
  const t = await amendsOnTick(null, world, { record: async () => { throw new Error("boom"); } });
  assert.equal(t.verdict, "error");
  assert.equal(t.line, "amends: NOT recorded (non-fatal) — boom");
  const absent = await amendsOnTick(null, world, { record: async () => { throw Object.assign(new Error("no table"), { code: "42P01" }); } });
  assert.equal(absent.verdict, "absent");
  assert.match(absent.line, /075 not applied/);
});

// ── the store ────────────────────────────────────────────────────────────────

async function owner(fn) { const c = await store.connect("world2_owner"); try { return await fn(c); } finally { await c.end(); } }
async function asApi(fn) { const c = await store.connect("office_api"); try { return await fn(c); } finally { await c.end(); } }
const rowsNow = () => owner(async (c) => (await c.query("SELECT mark, settlement, by_hand FROM amend_carried ORDER BY mark, settlement")).rows
  .map((r) => `${r.mark}@S${r.settlement}${r.by_hand ? " by hand" : ""}`));

const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const C = { stool0: uuid(1), stoolA: uuid(2), step0: uuid(3), stepA: uuid(4), lamp0: uuid(5), lampI: uuid(6), lampB: uuid(7), stoolP: uuid(8), stoolB: uuid(9) };

async function seed() {
  await owner(async (c) => {
    for (let w = 101; w <= 108; w++) {
      const closes = new Date(Date.parse("2026-09-20T06:00:00Z") + (w - 101) * 12 * 3600e3);
      await c.query("INSERT INTO windows (id, opens_at, closes_at, status) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING",
        [w, new Date(closes - 12 * 3600e3), closes, w <= 107 ? "closed" : "open"]);
    }
    // The tags' own dates, so a settlements-backfill run over this store agrees.
    for (const [n, w] of Object.entries(WINDOW_OF))
      await c.query("INSERT INTO settlements (number, tag_sha, published_at, window_id, blessed_at) VALUES ($1, $2, $3, $4, $3) ON CONFLICT (number) DO NOTHING",
        [Number(n), SHA[n], DATE[n], w]);
    const claim = (id, slug, w, status, supersedes = null, data = {}, body = "a thing") => c.query(
      `INSERT INTO claims (id, window_id, class, claimant, household, status, decided_at, body, stake, data, slug, supersedes)
       VALUES ($1, $2, 'thing', $3, $4, $5, now(), $9, 1, $6, $7, $8) ON CONFLICT (id) DO NOTHING`,
      [id, w, slug.split("/")[0], `hh:${slug.split("/")[0]}`, status, data, slug, supersedes, body]);
    await claim(C.stool0, STOOL, 101, "locked", null, { date: D0 });
    await claim(C.step0, STEP, 101, "locked", null, { date: D0 });
    await claim(C.lamp0, LAMP, 101, "locked", null, { date: D0 });
    await claim(C.stoolA, STOOL, 103, "locked", C.stool0, { date: D_STOOL_A });
    await claim(C.stepA, STEP, 102, "locked", C.step0, { date: D_STEP });
    await claim(C.stoolB, STOOL, 107, "locked", C.stoolA, { date: D_STOOL_B });
    // lamp-b first: the twin reads the NEWEST claim to decide whether a mark is
    // carried, and a lamp whose newest claim is locked past the settled window
    // would read as locked, not published.
    await claim(C.lampB, LAMP, 108, "locked", C.lamp0, { date: "2026-09-24T00:00:00.000Z" });
    await claim(C.lampI, LAMP, 106, "locked", C.lamp0, { date: D0, _ingested_from: { sha: SHA[5], ref: "settlement/S5" } });
    await claim(C.stoolP, STOOL, 107, "pending", C.stoolB, { date: "2026-09-23T00:00:00.000Z" });
    // the first carriage, as 049 records it
    for (const id of [STOOL, STEP, LAMP])
      await c.query("INSERT INTO mark_carried (mark, settlement, added_sha) VALUES ($1, 1, $2) ON CONFLICT (mark) DO NOTHING", [id, SHA[1]]);
  });
}

test("FRESH STORE: 075 applied on empty claims writes no POS-446 row", { skip }, async () => {
  assert.deepEqual(await rowsNow(), []);
});

test("--list on the dry run names each row --apply would write (settlement, mark, claim) and writes nothing; --list with --verify is refused", { skip }, async () => {
  await seed();
  const cli = (...a) => spawnSync(process.execPath, ["world2/tools/amend-carried.mjs", "--world-repo", world, "--pg-url", store.url("office_api"), ...a],
    { cwd: OFFICE, encoding: "utf8", env: { ...process.env, PGUSER: "", WORLD2_PG_URL: "" }, timeout: 120000 });
  const dry = cli("--list");
  assert.equal(dry.status, 0, dry.stderr);
  const listed = dry.stdout.split("\n").filter((l) => l.startsWith("  new "));
  assert.deepEqual(listed, [`  new        S3  ${STOOL}  claim ${C.stoolA}  candle 103`, `  new        S6  ${STOOL}  claim ${C.stoolB}  candle 107`]);
  assert.match(dry.stdout, /unproven\s+lupi\/the-step candle 102 → S2/, "the rows that get none are still named");
  assert.deepEqual(await rowsNow(), [], "a dry run writes nothing");
  const plain = cli();
  assert.equal(plain.stdout.split("\n").some((l) => l.startsWith("  new ")), false, "without --list the dry run is as it was");
  const asJson = JSON.parse(cli("--list", "--json").stdout);
  assert.deepEqual(asJson.proposed, [{ settlement: 3, mark: STOOL, claim: C.stoolA, window: 103 }, { settlement: 6, mark: STOOL, claim: C.stoolB, window: 107 }]);
  const both = cli("--list", "--verify");
  assert.equal(both.status, 2);
  assert.match(both.stderr, /ask one/);
});

test("APPLY writes the proven amends and nothing else; the migration-touched candidate is named unproven", { skip }, async () => {
  await seed();
  const r = await asApi((c) => recordAmendsCarried(c, world, { apply: true }));
  assert.equal(r.verdict, "ok");
  assert.deepEqual(await rowsNow(), [`${STOOL}@S3`, `${STOOL}@S6`],
    "step-a's candidate S2 changed its file, but by a migration: it holds D0, not step-a's date, so no row");
  assert.deepEqual(r.by_settlement, { 3: 1, 6: 1 });
  assert.deepEqual([r.new, r.unproven, r.unsettled, r.hand], [2, 1, 1, 0]);
  const line = amendsLine(r);
  assert.match(line, /^amends: wrote 2 \(S3: 1, S6: 1\); the table holds 2/);
  assert.match(line, /unproven: lupi\/the-step \(candle 102 → S2\)/);
});

test("a second apply writes nothing, and the pen holds no UPDATE or DELETE", { skip }, async () => {
  const r = await asApi((c) => recordAmendsCarried(c, world, { apply: true }));
  assert.equal(r.wrote, 0);
  assert.deepEqual(await rowsNow(), [`${STOOL}@S3`, `${STOOL}@S6`]);
  await asApi(async (c) => {
    await assert.rejects(c.query("UPDATE amend_carried SET settlement = 4"), (e) => e.code === "42501");
    await assert.rejects(c.query("DELETE FROM amend_carried"), (e) => e.code === "42501");
  });
});

test("VERIFY re-proves every row with the same proof, and reds on a row whose settlement only rewrote the file", { skip }, async () => {
  assert.equal((await asApi((c) => verifyAmendsCarried(c, world))).verdict, "ok");
  await owner((c) => c.query("INSERT INTO amend_carried (claim, mark, settlement) VALUES ($1, $2, 2)", [C.stepA, STEP]));
  const v = await asApi((c) => verifyAmendsCarried(c, world));
  assert.equal(v.verdict, "DRIFT");
  assert.deepEqual(v.disagree.map((d) => d.mark), [STEP]);
  assert.match(v.disagree[0].why[0], /git does not prove S2 carried this amend/);
  await owner((c) => c.query("DELETE FROM amend_carried WHERE claim = $1", [C.stepA]));
});

test("THE TWO DOORS read one row, the LAST amend: both say \"published at S1, last amended at S6\" (review-612 F2)", { skip }, async () => {
  const { default: pg } = await import("pg");
  const p = new pg.Pool({ connectionString: store.url("office_api"), max: 2 });
  const env = { WORLD2_PG: process.env.WORLD2_PG, WORLD2_PG_URL: process.env.WORLD2_PG_URL };
  try {
    const two = await twinReceipt(p, STOOL, { standing: true });
    assert.equal(two.status, "published");
    assert.equal(two.crossing.s, 1, "crossing stays the first carriage");
    assert.deepEqual(two.last_amended, { s: 6, sha: SHA[6], at: DATE[6].toISOString().replace(/\.\d{3}Z$/, "Z"), window: 107 },
      "two amends carried (S3, S6): the field names the later one");
    assert.equal(two.says, "published at S1, last amended at S6");

    process.env.WORLD2_PG = "1"; process.env.WORLD2_PG_URL = store.url("office_api");
    __setPoolForTest(p);
    const one = await readMarkReceipt(STOOL, { repo: world, canon: { id: STOOL }, publishedSha: SHA[6] });
    assert.deepEqual(one.last_amended, two.last_amended);
    assert.equal(one.says, two.says);
    assert.equal(one.crossing.s, 1);

    const lamp = await twinReceipt(p, LAMP, { standing: true });
    assert.equal(lamp.last_amended, null, "an ingested amend and an unsettled one name nothing");
    assert.match(lamp.says, /^published at S1 \([0-9a-f]{8}\)/, "and the sentence is today's");
  } finally {
    __setPoolForTest(null);
    for (const [k, v] of Object.entries(env)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    await p.end();
  }
});

test("THE TICK: settlements-backfill's amends step writes on the keep tick and journals one line", { skip }, async () => {
  await owner((c) => c.query("TRUNCATE amend_carried"));
  const t = await asApi((c) => amendsOnTick(c, world));
  assert.equal(t.verdict, "ok");
  assert.match(t.line, /^amends: wrote 2 \(S3: 1, S6: 1\)/);
  assert.equal(TICK_CAP, 200);
});

test("THE CAP counts the rows a tick would write, not amends that will never get one (review-612 F3)", { skip }, async () => {
  // Left with no row: step-a (unproven) and lamp-b (unsettled). Nothing to write,
  // so a cap of 0 is not reached.
  const quiet = await asApi((c) => recordAmendsCarried(c, world, { apply: true, cap: 0 }));
  assert.equal(quiet.verdict, "ok", "two amends that can never be written must not hold the tick at SKIPPED");
  assert.equal(quiet.wrote, 0);
  // With the stool's two rows gone, two would be written, past a cap of 1.
  await owner((c) => c.query("TRUNCATE amend_carried"));
  const capped = await asApi((c) => recordAmendsCarried(c, world, { apply: true, cap: 1 }));
  assert.equal(capped.verdict, "skipped");
  assert.match(amendsLine(capped), /^amends: SKIPPED — 2 proven amends have no row, more than one tick carries \(cap 1\).*amend-carried\.mjs --apply/);
  assert.deepEqual(await rowsNow(), []);
  await asApi((c) => recordAmendsCarried(c, world, { apply: true }));
  assert.deepEqual(await rowsNow(), [`${STOOL}@S3`, `${STOOL}@S6`]);
});

/** office-keep.sh's own reading of a run's output: `--soft-step <step>` on stdin. */
const softStep = (text, step) => spawnSync(process.execPath, ["world2/tools/settlements-backfill.mjs", "--soft-step", step],
  { cwd: OFFICE, input: text, encoding: "utf8", timeout: 60000 }).stdout.trim();

test("THE KEEP TICK'S EXIT CODE: a broken amends step is one line, settlements-backfill --apply still exits 0, and the step is RECORDED refused", { skip }, async () => {
  await owner((c) => c.query("REVOKE SELECT ON amend_carried FROM office_api"));
  try {
    const run = spawnSync(process.execPath, ["world2/tools/settlements-backfill.mjs", "--apply", "--prod", "--quiet", "--world-repo", world, "--pg-url", store.url("office_api")],
      { cwd: OFFICE, encoding: "utf8", env: { ...process.env, PGUSER: "", WORLD2_PG_URL: "" }, timeout: 120000 });
    const out = `${run.stdout}\n${run.stderr}`;
    assert.match(out, /amends: NOT recorded \(non-fatal\) — permission denied/, out);
    assert.match(out, /carried: /, "the carried step ran before it");
    assert.equal(run.status, 0, `the amends step never changes the tick's verdict: rows written stay written\n${out}`);
    // review-612's re-check: exit 0 and `settlements ok` must not make the
    // failure silent. office-keep.sh records the step from this very output.
    assert.equal(softStep(out, "amends"), "refused write-failed", "the amends step reads refused, which the roll-call alarms on");
    assert.equal(softStep(out, "carried"), "ok", "the carried step beside it wrote, and reads ok");
  } finally {
    await owner((c) => c.query("GRANT SELECT ON amend_carried TO office_api"));
  }
  assert.ok((await owner(async (c) => (await c.query("SELECT mark FROM mark_carried")).rows)).length >= 3, "the carried rows stand");
});

// ── POS-446's five, written by 075 itself (G5, G9) ───────────────────────────

const runMigration = () => owner(async (c) => {
  try { await c.query(readFileSync(MIGRATION, "utf8")); }
  catch (e) { await c.query("ROLLBACK").catch(() => {}); throw e; }
});
const FIVE_WINDOWS = [207, 212, 229, 239];

test("POS-446 · a store holding the five claims but not S100: 075 RAISES and writes nothing", { skip }, async () => {
  await owner(async (c) => {
    for (const w of FIVE_WINDOWS)
      await c.query("INSERT INTO windows (id, opens_at, closes_at, status) VALUES ($1, now(), now(), 'closed') ON CONFLICT (id) DO NOTHING", [w]);
    let i = 100;
    for (const h of HAND_CARRIED) {
      await c.query(`INSERT INTO claims (id, window_id, class, claimant, status, stake, slug, supersedes) VALUES ($1, $2, 'thing', $3, 'locked', 1, $4, NULL)`,
        [uuid(i), h.window, h.mark.split("/")[0], h.mark]);
      await c.query(`INSERT INTO claims (id, window_id, class, claimant, status, stake, slug, supersedes, data) VALUES ($1, $2, 'thing', $3, 'locked', 1, $4, $5, '{}')`,
        [uuid(i + 1), h.window, h.mark.split("/")[0], h.mark, uuid(i)]);
      i += 2;
    }
  });
  await assert.rejects(runMigration(), /settlement 100 is not in settlements/);
  assert.equal((await rowsNow()).filter((r) => r.endsWith("by hand")).length, 0);
});

test("POS-446 · with S100, 075 writes all five at S100 by hand, naming POS-446 and the whole commit", { skip }, async () => {
  await owner((c) => c.query("INSERT INTO settlements (number, tag_sha, published_at, window_id) VALUES (100, $1, '2026-10-09T18:01:11Z', 239)", ["1".repeat(40)]));
  await runMigration();
  const hand = await owner(async (c) => (await c.query("SELECT mark, settlement, by_hand, issue FROM amend_carried WHERE issue = 'POS-446' ORDER BY mark")).rows);
  assert.deepEqual(hand.map((r) => r.mark), HAND_CARRIED.map((h) => h.mark).sort());
  for (const r of hand) {
    assert.equal(r.settlement, 100, r.mark);
    assert.equal(r.by_hand, "10e5b194acffedab9c5a6177ba6dc7f4360fcf96", r.mark);
  }
  await runMigration();   // idempotent
  assert.equal((await rowsNow()).filter((r) => r.endsWith("by hand")).length, 5);
  const v = await asApi((c) => verifyAmendsCarried(c, world));
  assert.equal(v.hand, 5, "hand rows are counted, never re-proved");
});

test("POS-446 · VERIFY reds when a store holds the five's claims and not their rows", { skip }, async () => {
  await owner((c) => c.query("DELETE FROM amend_carried WHERE issue = 'POS-446'"));
  const v = await asApi((c) => verifyAmendsCarried(c, world));
  assert.equal(v.verdict, "DRIFT");
  assert.equal(v.disagree.filter((d) => /075 owes it/.test(d.why[0])).length, 5);
  await runMigration();
  assert.equal((await asApi((c) => verifyAmendsCarried(c, world))).verdict, "ok");
});

test("POS-446 · a doubled amend for one of the five: 075 RAISES", { skip }, async () => {
  const h = HAND_CARRIED[0];
  await owner((c) => c.query(`INSERT INTO claims (id, window_id, class, claimant, status, stake, slug, supersedes) VALUES ($1, $2, 'thing', 'berthillon', 'locked', 1, $3, $4)`,
    [uuid(200), h.window, h.mark, uuid(100)]));
  await assert.rejects(runMigration(), /2 door amends for berthillon\/cone-peche-de-vigne-2026-08-27 at candle 229/);
  // Left in place: a claim the public docket carried is never deleted (the docket's own trigger).
});

test("075 NOT APPLIED: the tick says so in one line, and both doors disclose rather than answer null", { skip }, async () => {
  await owner((c) => c.query("DROP TABLE amend_carried"));
  const t = await asApi((c) => amendsOnTick(c, world));
  assert.equal(t.verdict, "absent");
  const { default: pg } = await import("pg");
  const p = new pg.Pool({ connectionString: store.url("office_api"), max: 2 });
  const env = { WORLD2_PG: process.env.WORLD2_PG, WORLD2_PG_URL: process.env.WORLD2_PG_URL };
  try {
    const two = await twinReceipt(p, STOOL, { standing: true });
    assert.equal(two.last_amended, null);
    assert.equal(two.amends?.readable, false);
    assert.match(two.amends.reason, /075 not applied/);
    assert.match(two.says, /^published at S1 \([0-9a-f]{8}\)/);
    // 1.0 discloses the same way: null is never "never amended" when unread.
    process.env.WORLD2_PG = "1"; process.env.WORLD2_PG_URL = store.url("office_api");
    __setPoolForTest(p);
    const one = await readMarkReceipt(STOOL, { repo: world, canon: { id: STOOL }, publishedSha: SHA[6] });
    assert.equal(one.last_amended, null);
    assert.equal(one.amends?.readable, false);
    assert.match(one.amends.reason, /075 not applied/);
  } finally {
    __setPoolForTest(null);
    for (const [k, v] of Object.entries(env)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    await p.end();
  }
  // and office-keep.sh records the absent table as a refused amends step
  assert.equal(softStep(t.line, "amends"), "refused prereq:migration");
});

// ── THE ONE ALARM ROUTE (review-612's re-check) ─────────────────────────────
//
// carried and amends are non-fatal by design: rows written stay written, the
// run exits 0 and office-keep.sh records `settlements ok`. So each is recorded
// as its own keep step, read from the run's own output, and the roll-call
// alarms on three scheduled ticks that are not ok.

test("softStepStatus: wrote → ok; failed, absent, capped or unknown → refused with a reason the receipt keeps; no line → notrun", () => {
  assert.equal(softStepStatus("amends: wrote 2 (S3: 1, S6: 1); the table holds 2 · no row: …", "amends"), "ok");
  assert.equal(softStepStatus("amends: wrote 0; the table holds 7", "amends"), "ok", "nothing to write is not a failure");
  assert.equal(softStepStatus("amends: NOT recorded (non-fatal) — permission denied", "amends"), "refused write-failed");
  assert.equal(softStepStatus("amends: no `amend_carried` table yet (075 not applied) — nothing recorded", "amends"), "refused prereq:migration");
  assert.equal(softStepStatus("amends: SKIPPED — 300 proven amends have no row", "amends"), "refused prereq:history");
  assert.equal(softStepStatus("amends: something new", "amends"), "refused write-failed", "a line this does not know is never ok");
  assert.equal(softStepStatus("wrote 3 row(s)\ncarried: wrote 1 (S7: 1); the table holds 9", "amends"), "notrun");
  assert.equal(softStepStatus("carried: REFUSED, nothing written — 1 row(s) disagree", "carried"), "refused write-failed");
  assert.equal(softStepStatus("carried: NOT recorded (non-fatal) — boom", "carried"), "refused write-failed");
  assert.equal(softStepStatus("carried: wrote 0; the table holds 9 of 9 published at S6", "carried"), "ok");
  // every reason is one keep-history keeps (REASON_RE), so the receipt names it
  for (const reason of ["write-failed", "prereq:migration", "prereq:history"]) {
    const r = buildReceipt({ stepsText: `amends\trefused\t${reason}`, source: "scheduled", run: "t", started: "2026-10-14T19:07:00Z", at: "2026-10-14T19:08:00Z", exit: 0 });
    assert.deepEqual(r.steps.amends, { s: "refused", r: reason });
  }
});

test("office-keep.sh records carried and amends as their own keep steps, from the run's own output", () => {
  const sh = readFileSync(join(OFFICE, "deploy", "office-keep.sh"), "utf8").replace(/\r\n/g, "\n");
  for (const step of ["carried", "amends"]) {
    const want = `keep_step ${step} $(printf '%s\\n' "$settled" | node world2/tools/settlements-backfill.mjs --soft-step ${step} 2>/dev/null || echo notrun)`;
    assert.ok(sh.split("\n").includes(want), `${step}: ${want}`);
    assert.ok(sh.indexOf(want) > sh.indexOf("keep_step settlements ok"), `${step} is read after the run that printed its line`);
  }
});

test("the roll-call alarms on three scheduled ticks whose amends step was refused, though settlements read ok", () => {
  const manifest = JSON.parse(readFileSync(join(OFFICE, "deploy", "box-rollcall-manifest.json"), "utf8"));
  const keep = (function find(o) {
    if (o && typeof o === "object") {
      // a row's one outcome, or one block of its outcomes[] (the keep row carries two since POS-268 5b)
      const spec = [o.outcome, ...(Array.isArray(o.outcomes) ? o.outcomes : [])].find((x) => x?.kind === "keep_steps");
      if (spec) return { outcome: spec };
      for (const v of Object.values(o)) { const hit = find(v); if (hit) return hit; }
    }
    return null;
  })(manifest);
  for (const step of ["carried", "amends"]) {
    assert.ok(SOFT_STEPS.includes(step), `${step} is a soft step`);
    assert.ok(STEPS.includes(step), `${step} is in the receipt's step list`);
    assert.ok(keep.outcome.steps.includes(step), `the manifest's keep outcome judges ${step}`);
  }
  const T = Date.parse("2026-10-14T19:07:00Z");
  const iso = (ms) => new Date(ms).toISOString().replace(/\.\d+Z$/, "Z");
  let log = "";
  for (let i = 0; i < 3; i++) {
    const okSteps = SOFT_STEPS.filter((s) => s !== "amends").map((s) => `${s}\tok\t`).join("\n");
    log = appendReceipt(log, buildReceipt({
      stepsText: `${okSteps}\namends\trefused\twrite-failed`, source: "scheduled", run: `r${i}`,
      started: iso(T + i * 15 * 60e3), at: iso(T + i * 15 * 60e3 + 60e3), exit: 0 }));
  }
  const alarms = judgeKeep(log, { steps: keep.outcome.steps, n: 3, staleMinutes: 45, now: T + 32 * 60e3 });
  assert.deepEqual(alarms, ["amends has not been ok on the last 3 scheduled ticks (refused, refused, refused)"]);
});
