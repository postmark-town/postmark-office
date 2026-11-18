// pos853-redeclared-mark-through-the-clearing.test.mjs — POS-853: a mark
// re-declared between its window's close and its clearing is photographed by
// that window's write under its NEW act, so the keeper's source check reads the
// version the clearing crossed, and the act it supersedes is left as it was.
//
//   node --import ./test/helpers/sparse-guard.mjs --test --test-concurrency=1 test/pos853-redeclared-mark-through-the-clearing.test.mjs
//
// THE INSTANCE (S145, 2026-11-01). A resident re-declared a published mark at
// 17:51Z, with new words, a new place and a new date. Window 285 had closed at
// 17:45:40Z (the chain's :45) and was cleared at 18:00Z. The clearing folded the
// re-declaration and S145 published it. The photograph written at that clearing
// (world commit 4fefba95e6, 18:00:53Z) stopped at the close, because the writer
// capped it at `closes_at`. The newest crossing value that commit names is
// 285.47006 (17:38:27Z), and the acts filed at 17:59:08Z and 17:59:13Z appear
// only in the next window's photograph (d77f3d7ba7, 06:00:46Z on 11-02). So the
// re-declaration's act was in no retained journal when the keeper checked, and
// the keeper found only the older act it supersedes. Its ledger (2026-11-01,
// fire84): "new 17:51 words/position/date unverified by older 36196 source;
// public act correlation NOT full payload".
//
// THE CLASS FIX IS WLD-137's (office#834). Once a window has cleared, its
// photograph runs to the latest of its close, its clearing, and every act a
// claim filed in it names. This file changes no code. It pins the
// re-declaration case of that class with the shape that held S145: an original
// declaration, published; then its re-declaration, filed after the close and
// folded at the clearing.
//
// LAW (Wright, 2026-10-31, the class fix under SHIPPING § 9; WLD-137): "the
// retained journal covers every act whose claim the clearing folds, including
// acts filed between a window's close and its clearing."
// BOUND (Rivet, POS-853, 2026-11-01): "an already-public declaration must
// resolve to its own act/version, not an older one."
//
// THE RIG. A real Postgres (test/helpers/embedded-store.mjs) with the whole
// schema. The acts are seeded as the pen writes them. Every claim in the window
// is filed by the door's own candle half, `claimTxFromJournal` inside
// `withHousehold` as `office_api`, handed the act's id the way the flipped pen
// hands it (world-journal.mjs § appendActFlipped), so the receipt (`_act_id`)
// is the pen's and not this file's. The clearing's outcome is written as
// `clearing_job` at one fixed instant, to the microsecond: the real clearing job
// stamps its own `now()`, which would date the clearing days after the acts it
// clears and erase the gap this file is about. The photograph is the REAL
// writer, `writeStateLogForWindow` as `office_api`, read back off disk by seq,
// the way the keeper reads it.
//
// FALSIFIERS AND CONTROLS. R1, R3 and R6 are red on 511c2b349 (the commit
// before office#834) and green after it. R2, R4 and R5 are controls, green on
// both: the original act was never at risk, a private draft has no act to leak,
// and the notary's archive groups by ferry and waits for the next one. None of
// them is where S145's gap was.
//
// Synthetic handles only. The original act keeps the keeper's id, 36196; every
// other id, and every second below, is illustrative. The scratch checkouts live
// in one `tempDir` (test/helpers/temp-dir.mjs, POS-479), gone when the file's
// process ends.

import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { startStore } from "./helpers/embedded-store.mjs";
import { tempDir } from "./helpers/temp-dir.mjs";
import { currentCrossing } from "../src/crossings.mjs";
import { boxOf } from "../world2/tools/seed-import.mjs";
import { writeStateLogForWindow } from "../world2/tools/state-log-write.mjs";
import { actsRangeFor, archiveLine, ferryPartition, readActs } from "../world2/tools/snapshot-export.mjs";

const store = await startStore({ db: "pos853_redeclared" });
after(() => store.stop());

const scratch = tempDir("postmark-pos853-");

const LAW = "LAW: \"the retained journal covers every act whose claim the clearing folds, including acts filed between a window's close and its clearing\"";
const BOUND = "BOUND: \"an already-public declaration must resolve to its own act/version, not an older one\"";

// ── THE WINDOWS ──────────────────────────────────────────────────────────────

const W281 = { id: 281, opens_at: "2026-10-30T05:45:40.000Z", closes_at: "2026-10-30T17:45:40.000Z", status: "closed", cleared_at: "2026-10-30T18:00:27.513902Z" };
const W284 = { id: 284, opens_at: "2026-10-31T17:45:40.000Z", closes_at: "2026-11-01T05:45:40.000Z", status: "closed", cleared_at: "2026-11-01T06:00:19.330571Z" };
const OPENS = "2026-11-01T05:45:40.000Z";
const CLOSES = "2026-11-01T17:45:40.000Z";          // window 285's recorded close: the chain's :45
const CLEARED = "2026-11-01T18:00:31.208463Z";      // its clearing, as now() stamps it: to the microsecond
const NEXT_CLOSES = "2026-11-02T05:45:40.000Z";
// Open while the door files into it; the clearing closes it and opens 286.
const W285 = { id: 285, opens_at: OPENS, closes_at: CLOSES, status: "open", cleared_at: null };

// ── THE ACTS ─────────────────────────────────────────────────────────────────

const EFFECT_LEAVE = "a draft stands in the live layer; it enters canon at the next crossing that ratifies it";
const EFFECT_AMEND = "the prior declaration is superseded — every version stays in the log; canon shows the latest at the next crossing";

const act = (id, at, actor, action, cls, extra = {}) => ({
  id, at, actor, action, class: cls, object: null, payload: null, effect: null, household: `solo:${actor}`, ...extra,
});
// A declaration as the leave door builds it (world.mjs § journalLeaveMark): its
// words, its place, and the door's own date stamp, put forward.
const declared = (by, slug, body, at, extent, date) => ({ slug, by, kind: "sited", body, at, extent, date, put_forward: true });

const TURRET = "sbx-wren/east-turret";
const ORIGINAL_CLAIM = "36196000-0000-4000-8000-000000000281"; // the claim that locked the original, so the mark's id (001_tables.sql)
// The original declaration, published at window 281's clearing and standing since.
const ORIGINAL = act(36196, "2026-10-30T16:20:07.000Z", "sbx-wren", "leave-mark", "mark", {
  object: TURRET, effect: EFFECT_LEAVE,
  payload: declared("sbx-wren", "east-turret", "A turret on the east wall. Its door is painted blue.",
    { x: 412, y: 188 }, { w: 6, h: 6 }, "2026-10-30") });
// THE RE-DECLARATION, IN THE GAP: after window 285's close and before its
// clearing. New words, a new place, a new date.
const REDECLARED = act(38107, "2026-11-01T17:51:24.000Z", "sbx-wren", "amend", "mark", {
  object: TURRET, effect: EFFECT_AMEND,
  payload: declared("sbx-wren", "east-turret", "A turret on the east wall. Its door is green now, and it leans a little.",
    { x: 418, y: 192 }, { w: 6, h: 6 }, "2026-11-01") });

// R3: a mark declared and re-declared inside window 285, the second word in the gap.
const BARREL = "sbx-oak/rain-barrel";
const FIRST_WORD = act(38020, "2026-11-01T16:12:40.000Z", "sbx-oak", "leave-mark", "mark", {
  object: BARREL, effect: EFFECT_LEAVE,
  payload: declared("sbx-oak", "rain-barrel", "A rain barrel by the steps.", { x: 140, y: 61 }, { w: 2, h: 2 }, "2026-11-01") });
const SECOND_WORD = act(38116, "2026-11-01T17:53:05.000Z", "sbx-oak", "amend", "mark", {
  object: BARREL, effect: EFFECT_AMEND,
  payload: declared("sbx-oak", "rain-barrel", "A rain barrel by the steps, its lid tied down against the wind.",
    { x: 141, y: 63 }, { w: 2, h: 2 }, "2026-11-01") });

// R4: a private compose in the gap. The pen writes no act for it (`act: false`,
// world-journal.mjs § appendActFlipped); its row rides on the draft claim.
const LANTERN = "sbx-pell/lantern-post";
const PRIVATE_BODY = "a private compose: the lantern by the well, not yet put forward";
const { put_forward: _private, ...privatePayload } = declared("sbx-pell", "lantern-post", PRIVATE_BODY, { x: 90, y: 33 }, { w: 1, h: 1 }, "2026-11-01");
const PRIVATE_COMPOSE = act(null, "2026-11-01T17:55:00.000Z", "sbx-pell", "leave-mark", "mark", {
  object: LANTERN, effect: EFFECT_LEAVE, payload: privatePayload });

// R6: a re-declaration whose act is dated after the clearing began, its claim
// folded there all the same: the door held the candle and the clearing waited
// for it (state-log-write.mjs § THE PHOTOGRAPH ENDS AT THE CLEARING, term 3).
const BELL = "sbx-fen/gate-bell";
// Published at window 284's clearing (06:00Z on 11-01), so dated inside that window.
const BELL_ORIGINAL = act(37650, "2026-11-01T02:10:00.000Z", "sbx-fen", "leave-mark", "mark", {
  object: BELL, effect: EFFECT_LEAVE,
  payload: declared("sbx-fen", "gate-bell", "A bell at the gate.", { x: 220, y: 75 }, { w: 1, h: 1 }, "2026-11-01") });
const BELL_REDECLARED = act(38120, "2026-11-01T18:00:31.251000Z", "sbx-fen", "amend", "mark", {
  object: BELL, effect: EFFECT_AMEND,
  payload: declared("sbx-fen", "gate-bell", "A bell at the gate, rung for the late ferry.", { x: 221, y: 76 }, { w: 1, h: 1 }, "2026-11-01") });

// The rest of the window, so the files hold more than the case.
const AROUND = [
  // Ferry crossing 284, inside window 285: the window writes two files.
  act(37702, "2026-11-01T08:30:12.000Z", "sbx-ana", "say", "voice", { payload: { text: "a morning word at the pier" } }),
  act(37988, "2026-11-01T15:02:11.000Z", "sbx-bo", "say", "voice", { payload: { text: "an afternoon word" } }),
  act(38094, "2026-11-01T17:44:58.000Z", "sbx-ana", "say", "voice", { payload: { text: "forty-two seconds before the close" } }),
  // After the clearing: window 286's act, in the same ferry crossing's file.
  act(38151, "2026-11-01T18:10:00.000Z", "sbx-bo", "say", "voice", { payload: { text: "after the bell" } }),
];

// In filing order. `actId: null` is the private draft: no deed yet.
const FILINGS = [
  { act: FIRST_WORD },
  { act: REDECLARED },
  { act: SECOND_WORD },
  { act: PRIVATE_COMPOSE, actId: null },
];

// ── THE RIG ──────────────────────────────────────────────────────────────────

async function as(role, fn) { const c = await store.connect(role); try { return await fn(c); } finally { await c.end(); } }
const owner = (fn) => as("world2_owner", fn);
const asOffice = (fn) => as("office_api", fn);

const geometryOf = (slug, p) => ({ slug, at: p.at, extent: p.extent });

/** A journal row as world-journal.mjs § normalizeRow hands the candle half one. */
const rowFor = (a) => ({
  crossing: currentCrossing(Date.parse(a.at)), actor: a.actor, household: null, action: a.action, object: a.object,
  written_at: a.at, witnesses: null, class: a.class, payload: JSON.stringify(a.payload), effect: a.effect,
});

/** Each filing through the door's own candle half, in a household transaction, as office_api. */
async function fileThroughTheDoor(filings) {
  const mod = await import("../src/world2-claims.mjs");
  const { default: pg } = await import("pg");
  const pool = new pg.Pool({ connectionString: store.url("office_api"), max: 2 });
  mod.__setPoolForTest(pool);
  try {
    for (const f of filings) {
      const row = rowFor(f.act);
      const household = await mod.householdKeyFor(pool, row.actor);
      const actId = f.actId === undefined ? f.act.id : f.actId;
      await mod.withHousehold(pool, household, (c) => mod.claimTxFromJournal(c, row, null, { household, actId }));
    }
  } finally { mod.__setPoolForTest(null); await pool.end(); }
}

/**
 * THE CLEARING'S OUTCOME, as `clearing_job`, at CLEARED: every pending claim of
 * window 285 locked, each locked claim's mark materialized (the standing mark
 * re-declared, or a new mark under the claim's id), the window closed with its
 * clearing recorded, and window 286 opened.
 */
async function clearWindow285() {
  await as("clearing_job", async (c) => {
    await c.query("BEGIN");
    const { rows: locked } = await c.query(
      `UPDATE claims SET status = 'locked', decided_at = $1 WHERE window_id = 285 AND status = 'pending'
       RETURNING id::text AS id, slug, claimant, household, body, geometry, bbox::text AS bbox`, [CLEARED]);
    for (const k of locked) {
      const { rowCount } = await c.query(
        "UPDATE marks SET body = $2, geometry = $3, bbox = $4::box, locked_window = 285 WHERE slug = $1 AND status = 'standing'",
        [k.slug, k.body, JSON.stringify(k.geometry), k.bbox]);
      if (!rowCount) {
        await c.query(
          `INSERT INTO marks (id, slug, kind, owner, household, body, geometry, bbox, status, locked_window)
           VALUES ($1, $2, 'sited', $3, $4, $5, $6, $7::box, 'standing', 285)`,
          [k.id, k.slug, k.claimant, k.household, k.body, JSON.stringify(k.geometry), k.bbox]);
      }
    }
    await c.query("UPDATE windows SET status = 'closed', cleared_at = $1 WHERE id = 285", [CLEARED]);
    await c.query("INSERT INTO windows (id, opens_at, closes_at, status) VALUES (286, $1, $2, 'open')", [CLOSES, NEXT_CLOSES]);
    await c.query("COMMIT");
  });
}

/** A mark published before window 285: its act, its locking claim, and the standing mark that claim's id names. */
async function publishBefore(c, a, claimId, window) {
  const { slug: _s, at, extent, body, put_forward: _pf, ...rest } = a.payload;
  await c.query(
    `INSERT INTO claims (id, window_id, class, claimant, household, status, decided_at, body, geometry, bbox, stake, slug, data)
     VALUES ($1, $2, 'sited', $3, $4, 'locked', $5, $6, $7, $8, 0, $9, $10)`,
    [claimId, window.id, a.actor, a.household, window.cleared_at, body, JSON.stringify(geometryOf(a.object, a.payload)),
      boxOf(at, extent), a.object, JSON.stringify({ ...rest, _journal_seq: null, _act_id: String(a.id) })]);
  await c.query(
    `INSERT INTO marks (id, slug, kind, owner, household, body, geometry, bbox, status, locked_window, data)
     VALUES ($1, $2, 'sited', $3, $4, $5, $6, $7, 'standing', $8, $9)`,
    [claimId, a.object, a.actor, a.household, body, JSON.stringify(geometryOf(a.object, a.payload)),
      boxOf(at, extent), window.id, JSON.stringify(rest)]);
}

/** Window 285 as its clearing left it, every claim filed through the door. */
async function seedWindow285({ acts = [], filings = [], published = [] } = {}) {
  await owner(async (c) => {
    await c.query("TRUNCATE acts, claims, marks, windows CASCADE");
    for (const w of [W281, W284, W285]) {
      await c.query("INSERT INTO windows (id, opens_at, closes_at, status, cleared_at) VALUES ($1, $2, $3, $4, $5)",
        [w.id, w.opens_at, w.closes_at, w.status, w.cleared_at]);
    }
    for (const a of [ORIGINAL, ...AROUND, FIRST_WORD, REDECLARED, SECOND_WORD, ...acts]) {
      await c.query(
        `INSERT INTO acts (id, at, crossing, actor, action, object, class, payload, effect, household) OVERRIDING SYSTEM VALUE
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [a.id, a.at, currentCrossing(Date.parse(a.at)), a.actor, a.action, a.object, a.class,
          a.payload == null ? null : JSON.stringify(a.payload), a.effect, a.household]);
    }
    await publishBefore(c, ORIGINAL, ORIGINAL_CLAIM, W281);
    for (const p of published) await publishBefore(c, p.act, p.claimId, p.window);
  });
  await fileThroughTheDoor([...FILINGS, ...filings]);
  await clearWindow285();
}

/** A world checkout with a STATE dir, the shape the sweep clone is in. */
function world(name) {
  const repo = join(scratch, name);
  mkdirSync(join(repo, "WORLD"), { recursive: true });
  mkdirSync(join(repo, "STATE", "log"), { recursive: true });
  writeFileSync(join(repo, "WORLD", "households.json"), JSON.stringify({ logins: {} }));
  return repo;
}

const logPath = (repo, name) => join(repo, "STATE", "log", name);
const journalFiles = (repo) => readdirSync(join(repo, "STATE", "log")).filter((n) => n.endsWith(".journal.jsonl")).sort();
const linesOf = (repo, name) => readFileSync(logPath(repo, name), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const retained = (repo) => journalFiles(repo).flatMap((name) => linesOf(repo, name).map((l) => ({ ...l, file: name })));
const lineBySeq = (repo, seq) => retained(repo).find((l) => l.seq === seq) ?? null;
/** The newest retained act for a mark: what a reader pairing a published mark with its latest act would read. */
const newestFor = (repo, object) => retained(repo).filter((l) => l.object === object).sort((a, b) => b.seq - a.seq)[0] ?? null;

const writeWindow = (repo, window) => asOffice((c) => writeStateLogForWindow(c, { world: repo, window, commit: false }));

/**
 * THE KEEPER'S QUESTION, of the version the clearing crossed: is the act the
 * receipt names in the retained journal, by its own id, in its own crossing's
 * file, as THIS declaration and not the one before it?
 */
function assertIsTheVersionCrossed(line, a, prior, why) {
  assert.ok(line, `act ${a.id} (${a.actor} ${a.action} of ${a.object}, at ${a.at}) is in the retained journal: ${why} — ${LAW}`);
  const crossing = currentCrossing(Date.parse(a.at));
  assert.equal(line.seq, a.id, "by its own id");
  assert.equal(line.file, `${crossing}.journal.jsonl`, "in its own ferry crossing's file");
  assert.equal(line.crossing, crossing, "carrying its own crossing");
  assert.equal(line.type, a.action, `as the ${a.action} it was`);
  assert.equal(line.object, a.object, "of the same mark");
  assert.equal(line.class, "mark", "a mark act");
  assert.deepEqual(line.payload, a.payload, `with this declaration's words, place and date — ${BOUND}`);
  for (const field of ["body", "at", "date"]) {
    if (JSON.stringify(a.payload[field]) === JSON.stringify(prior.payload[field])) continue;
    assert.notDeepEqual(line.payload[field], prior.payload[field], `its ${field} is the new one, not the version it supersedes (act ${prior.id})`);
  }
  // Date.parse keeps milliseconds, as the line does (journalInstant).
  assert.equal(Date.parse(line.at), Date.parse(a.at), "dated as the act was");
}

// ── THE FALSIFIERS ───────────────────────────────────────────────────────────

test("R1 · the S145 shape: a published mark re-declared after its window's close and folded at its clearing; the locked receipt names the new act, and the retained journal carries that act by its id, in its crossing, as the version crossed", async () => {
  await seedWindow285();
  const repo = world("r1");
  await writeWindow(repo, 281);
  const out = await writeWindow(repo, 285);
  assert.equal(out.refused, undefined, JSON.stringify(out));

  // The receipt the clearing locked carries the pen's own `_act_id`. The
  // selection was never the defect, so this holds on the base too; the red is below.
  const { rows: [receipt] } = await asOffice((c) => c.query(
    "SELECT data->>'_act_id' AS act_id, supersedes::text AS supersedes FROM claims WHERE window_id = 285 AND slug = $1 AND status = 'locked'",
    [TURRET]));
  assert.equal(receipt?.act_id, String(REDECLARED.id), "the locked claim names the re-declaration's act");
  assert.equal(receipt.supersedes, ORIGINAL_CLAIM, "and supersedes the standing mark the original locked");

  assertIsTheVersionCrossed(lineBySeq(repo, Number(receipt.act_id)), REDECLARED, ORIGINAL,
    `filed after window 285's close (${CLOSES}) and folded at its clearing (${CLEARED})`);
  // A source check that pairs a published mark with the newest act for its
  // object reads the same version. S145's hold read the older one.
  const newest = newestFor(repo, TURRET);
  assert.equal(newest?.seq, REDECLARED.id,
    `the newest retained act for ${TURRET} is the re-declaration, not the older act ${ORIGINAL.id} it supersedes`);
  // The horizon that took it, last, so a red names the behaviour first.
  assert.equal(out.through, CLEARED, "window 285's photograph runs to its clearing, to the microsecond");
  assert.equal(out.through_from, "clearing");
});

test("R3 · re-declared inside one window, the second word in the gap: both versions are in the crossing's file by their own ids, and the locked receipt names the later one; the earlier, retracted as replaced, keeps its own act and words", async () => {
  await seedWindow285();
  const repo = world("r3");
  const out = await writeWindow(repo, 285);
  assert.equal(out.refused, undefined, JSON.stringify(out));

  const { rows } = await asOffice((c) => c.query(
    "SELECT status, refusal_check, data->>'_act_id' AS act_id FROM claims WHERE window_id = 285 AND slug = $1 ORDER BY submitted_at",
    [BARREL]));
  assert.deepEqual(rows.map((r) => [r.status, r.act_id]),
    [["retracted", String(FIRST_WORD.id)], ["locked", String(SECOND_WORD.id)]], JSON.stringify(rows));
  assert.match(rows[0].refusal_check, /^replaced: /);

  assertIsTheVersionCrossed(lineBySeq(repo, SECOND_WORD.id), SECOND_WORD, FIRST_WORD,
    `re-declared after window 285's close (${CLOSES}), replacing the pending word, and folded at its clearing (${CLEARED})`);
  const first = lineBySeq(repo, FIRST_WORD.id);
  assert.ok(first, "the earlier word's act stays in the log: every version does");
  assert.equal(first.type, "leave-mark");
  assert.deepEqual(first.payload, FIRST_WORD.payload, "under its own words, not overwritten by the later version");
  assert.equal(newestFor(repo, BARREL)?.seq, SECOND_WORD.id, "and the newest retained act for the mark is the version the clearing locked");
});

test("R6 · a re-declaration whose act is dated after the clearing began, its claim folded there (the door held the candle): the act the receipt names is in the photograph", async () => {
  // Isolates term 3 for a re-declaration. The act is 43 ms after `cleared_at`,
  // so no instant on the window's row covers it; the locked claim's `_act_id` does.
  await seedWindow285({
    acts: [BELL_ORIGINAL, BELL_REDECLARED],
    published: [{ act: BELL_ORIGINAL, claimId: "37650000-0000-4000-8000-000000000284", window: W284 }],
    filings: [{ act: BELL_REDECLARED }],
  });
  const repo = world("r6");
  const out = await writeWindow(repo, 285);
  assert.equal(out.refused, undefined, JSON.stringify(out));

  const { rows: [receipt] } = await asOffice((c) => c.query(
    "SELECT data->>'_act_id' AS act_id FROM claims WHERE window_id = 285 AND slug = $1 AND status = 'locked'", [BELL]));
  assert.equal(receipt?.act_id, String(BELL_REDECLARED.id), "the locked claim names the late re-declaration's act");
  assertIsTheVersionCrossed(lineBySeq(repo, Number(receipt.act_id)), BELL_REDECLARED, BELL_ORIGINAL,
    `dated 43 ms after window 285's clearing began (${CLEARED}), its claim folded there`);
  assert.equal(out.through, "2026-11-01T18:00:31.251000Z", "the horizon is that act's own instant");
  assert.equal(out.through_from, "claim", "and the receipt says a folded claim's act set it");
  assert.equal(lineBySeq(repo, 38151), null, "an act after it that no folded claim names stays out");
});

// ── THE CONTROLS ─────────────────────────────────────────────────────────────

test("R2 · CONTROL: the version it supersedes is left exactly as it was; its file and meta are byte-identical, its line keeps the old words, place and date, and its act row is unchanged", async () => {
  await seedWindow285();
  const repo = world("r2");
  await writeWindow(repo, 281);
  const name = `${currentCrossing(Date.parse(ORIGINAL.at))}.journal.jsonl`;
  const meta = name.replace(/[.]jsonl$/, ".meta.json");
  const before = { log: readFileSync(logPath(repo, name), "utf8"), meta: readFileSync(logPath(repo, meta), "utf8") };
  assert.ok(before.log.includes(`"seq":${ORIGINAL.id}`), `the original's line was written into ${name} (the presence this control is read against)`);

  await writeWindow(repo, 285);

  assert.equal(readFileSync(logPath(repo, name), "utf8"), before.log, `${name} is byte-identical after window 285's photograph`);
  assert.equal(readFileSync(logPath(repo, meta), "utf8"), before.meta, `and so is ${meta}`);
  const line = lineBySeq(repo, ORIGINAL.id);
  assert.equal(line.file, name);
  assert.equal(line.type, "leave-mark");
  assert.deepEqual(line.payload, ORIGINAL.payload, "the original's line still carries the original declaration");
  assert.equal(linesOf(repo, name).some((l) => l.seq === REDECLARED.id), false, "the re-declaration is filed under its own crossing, not the original's");
  const { rows: [row] } = await owner((c) => c.query("SELECT at, actor, action, object, payload FROM acts WHERE id = $1", [ORIGINAL.id]));
  assert.deepEqual({ at: row.at.toISOString(), actor: row.actor, action: row.action, object: row.object, payload: row.payload },
    { at: ORIGINAL.at, actor: ORIGINAL.actor, action: ORIGINAL.action, object: ORIGINAL.object, payload: ORIGINAL.payload },
    "the original act's row is the row it was");
});

test("R4 · CONTROL: a private compose filed in the gap leaks nothing into the photograph, and an act after the clearing stays out", async () => {
  await seedWindow285();
  const repo = world("r4");
  const out = await writeWindow(repo, 285);
  assert.equal(out.refused, undefined, JSON.stringify(out));

  // The compose is really in the store, as the pen wrote it: a draft that
  // carries its row and names no act. That is the presence this absence is read against.
  const { rows: [draft] } = await owner((c) => c.query(
    "SELECT status, data ? '_act_id' AS names_an_act, data->'_deferred_act'->>'payload' AS held FROM claims WHERE slug = $1", [LANTERN]));
  assert.equal(draft?.status, "draft", "the private compose is a draft");
  assert.equal(draft.names_an_act, false, "it names no act");
  assert.ok(String(draft.held).includes(PRIVATE_BODY), "its words are held on the draft");
  const { rows: [{ n }] } = await owner((c) => c.query("SELECT count(*)::int AS n FROM acts WHERE payload::text LIKE $1", [`%${PRIVATE_BODY}%`]));
  assert.equal(n, 0, "and no act carries them");

  const files = journalFiles(repo);
  assert.deepEqual(files, ["284.journal.jsonl", "285.journal.jsonl"], "window 285 writes its two ferry crossings, and both are read");
  for (const name of files) {
    assert.equal(readFileSync(logPath(repo, name), "utf8").includes(PRIVATE_BODY), false, `${name} carries no word of the private compose`);
  }
  assert.equal(lineBySeq(repo, 38151), null, "act 38151, said after the clearing, is window 286's, not 285's");
});

test("R5 · CONTROL, the notary's archive: its projection of window 285 carries the re-declaration under its own crossing with the new declaration, and at the keeper's 18:29:19Z receipt it was not yet due, because ferry 286 had not sailed", async () => {
  await seedWindow285();
  const lines = (await as("snapshot_reader", (c) => readActs(c, actsRangeFor(285, 284)))).map((r) => JSON.parse(archiveLine(r)));
  const re = lines.find((l) => l.id === REDECLARED.id);
  assert.ok(re, "the re-declaration's act is in window 285's archive projection");
  assert.equal(re.crossing, 285);
  assert.equal(re.action, "amend");
  assert.deepEqual(re.payload, REDECLARED.payload, "with the new declaration");
  assert.equal(lines.some((l) => l.id === ORIGINAL.id), false, "the original is archived under its own window, not this one");
  assert.equal(lines.some((l) => JSON.stringify(l).includes(PRIVATE_BODY)), false, "and no archived line carries the private compose");

  const atHold = ferryPartition([{ id: 285 }], Date.parse("2026-11-01T18:29:19Z"));
  assert.deepEqual(atHold.held.map((h) => [h.id, h.sailsAt]), [[285, "2026-11-02T00:00:00.000Z"]],
    "at the keeper's receipt the archive held window 285 back");
  assert.deepEqual(ferryPartition([{ id: 285 }], Date.parse("2026-11-02T07:22:00Z")).archivable.map((w) => Number(w.id)), [285],
    "and by the next morning's notary run it was due");
});
