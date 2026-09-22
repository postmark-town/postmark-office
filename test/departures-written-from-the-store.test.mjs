// departures-written-from-the-store.test.mjs — POS-196, G1 gate 3 of 3: the
// world repo's departure record, rendered from `acts` instead of from the
// reverse-mirror copy in `dynamic.db/movements`.
//
// ── WHAT IS ON TRIAL ────────────────────────────────────────────────────────
//
// `STATE/log/<N>.jsonl` is the world repo's departure record and the only live
// source its three readers have. `tools/crossing-save.mjs` writes it today from
// `dynamic.db/movements` — measured read-only in the world clone at
// `origin/main` @ `17fa4195`: 2,857 of its 2,870 departure lines carry
// `"source":"dynamic.db/movements"`, the other 13 are era one. G1 removes that
// mirror, so the record needs a store-backed writer or it stops.
//
// `src/world-movement.mjs § storedDepartureEvents` is that renderer, built on
// POS-154's one road (`storedDepartures` → `world2-guards § storeDepartureRows`
// → `live-reads § departureRecords`). This file is its falsifier.
//
// ── THE SUBJECT IS THE REAL RECORD, NOT A RECORD I WROTE ────────────────────
//
// `test/fixtures/pos196-window-204-departures.jsonl` is the 24 departure lines
// of world crossing 204, copied byte for byte out of the clone at `origin/main`
// with nothing edited. The acts behind them are built FROM those same lines, in
// `world.mjs § walkEntry`'s exact payload shape — five keys, `{from, toward,
// pace, within, to}` — because a fixture generous enough to carry fields the
// live pen does not write would prove the renderer equal to a store nobody
// runs. Every field the register genuinely lacks is lacking here too.
//
// ── AND THE VERDICT IS SCOPED TO WHAT IS READ ───────────────────────────────
//
// Finding 4, measured read-only in the world clone: `tools/movement-records.mjs
// § storeRecords` keeps `ev.type === "departure"` and takes `at`, `actor` and
// `payload.{from,toward,crossing,within,to,pace}`. `boarding-flip-disclosure.mjs`
// and `position-seed-manifest.mjs` inherit that through `storeRecords` rather
// than opening the directory themselves. Nothing in that repo reads `seq`,
// `declared_by`, `note` or `source`. So byte-equality is judged on
// `RECORD_READ_FIELDS` — a record is equal when no reader of it can tell.
//
// ── THE STOP ────────────────────────────────────────────────────────────────
//
// `at` has no source in the register, and `at` is the first field every world
// reader reads. The two tests under § THE STOP name the cause rather than
// simulating the symptom, and either half fails on its own.

import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  DEPARTURE_GAPS, RECORD_READ_FIELDS, departureEventOf, storedDepartureEvents,
} from "../src/world-movement.mjs";
import { compareDepartureLine, gapClassOf, pairDepartures, storeEraLines } from "../tools/crossing-save.mjs";
import { normalizeRow } from "../src/world-journal.mjs";
import { useGuardReader } from "../src/world2-guards.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HERE, "fixtures", "pos196-window-204-departures.jsonl");

/** The record as the world holds it: 24 lines of crossing 204, untouched. */
const RECORD = readFileSync(FIXTURE, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));

// The renderer asks `world2Enabled()` before it asks the road anything, so an
// office with no register spends no socket finding that out. These two are the
// price of reaching the renderer at all, and § NOT POINTED AT A REGISTER is the
// case that proves the refusal.
const env = { pg: process.env.WORLD2_PG, url: process.env.WORLD2_PG_URL };
before(() => { process.env.WORLD2_PG = "1"; process.env.WORLD2_PG_URL = "postgres://pos196/none"; });
after(() => {
  if (env.pg == null) delete process.env.WORLD2_PG; else process.env.WORLD2_PG = env.pg;
  if (env.url == null) delete process.env.WORLD2_PG_URL; else process.env.WORLD2_PG_URL = env.url;
});

/**
 * One record line → the `acts` row its own walk would have written.
 *
 * ⚑ `payload` IS `walkEntry`'s FIVE KEYS AND NOT ONE MORE. `declared_by`,
 * `note` and the movements rowid are not in it because they are not in the
 * live pen's act either (`world.mjs § walkEntry`) nor in POS-154's backfill
 * (`world2/tools/backfill-departures.mjs § departureRowFrom` SELECTs
 * `declared_by, note` and drops both). Adding them here would be the fixture
 * agreeing with a store that does not exist.
 *
 * ⚑ `at` IS THE RECORD'S OWN INSTANT, which is the BEST case and not today's:
 * see § THE STOP. Holding the best case here is what makes the rest of the
 * equality meaningful — everything else is shown equal on the assumption that
 * the instant is solved, so the instant is the only thing left in the way.
 */
const actFor = (line, id) => ({
  id,
  at: new Date(line.at),
  crossing: String(line.payload.crossing),
  actor: line.actor,
  action: "walk",
  payload: {
    from: line.payload.from,
    toward: line.payload.toward,
    pace: line.payload.pace ?? null,
    within: line.payload.within ?? null,
    to: line.payload.to ?? null,
  },
});

/** The register, answering the departure query the way `pg` would. */
function fixtureRegister(rows) {
  const asked = [];
  return {
    asked,
    query: async (sql, params) => {
      const flat = String(sql).replace(/\s+/g, " ").trim();
      asked.push({ sql: flat, params });
      if (!/FROM acts/i.test(flat)) return { rows: [] };
      const actions = params?.[0] ?? [];
      let out = rows.filter((r) => actions.includes(r.action));
      if (/_ledger' IS NULL/i.test(flat)) out = out.filter((r) => r.payload?._ledger == null);
      // DEPARTURE_ORDER_SQL, in the fixture's own terms: era, then the instant
      // inside the non-ledger era, then the id. `assertDepartureOrder` runs
      // inside the reader and refuses anything else, so a fixture sorting on
      // the id alone would fail the reader rather than test it.
      const era = (r) => (r.payload?._ledger ? 0 : 1);
      const inst = (r) => (r.payload?._ledger ? 0 : new Date(r.at).getTime());
      return { rows: [...out].sort((a, b) => era(a) - era(b) || inst(a) - inst(b) || a.id - b.id) };
    },
  };
}

let restore = null;
const install = (store) => { restore = useGuardReader(async (fn) => fn(store)); return store; };
afterEach(() => { if (restore) { restore(); restore = null; } });

const ACTS = RECORD.map((l, i) => actFor(l, 9000 + i));
const WINDOW_TO = Date.parse("2026-09-22T12:00:00.000Z");

/** The renderer's lines, in the `<N>.jsonl` line shape `buildSave` writes. */
async function renderedLines() {
  const { events, absent } = await storedDepartureEvents({ atMs: WINDOW_TO });
  assert.equal(absent, null, "a readable register discloses nothing");
  return events.map((e) => ({
    at: e.at, type: "departure", actor: e.actor, seq: e.seq,
    payload: typeof e.payload === "string" ? JSON.parse(e.payload) : e.payload,
  }));
}

// ═════════════════════════════════════════════════════════════════════════════
// THE EQUALITY FALSIFIER
// ═════════════════════════════════════════════════════════════════════════════

test("the fixture is the real record and nothing was tidied on the way in", () => {
  assert.equal(RECORD.length, 24, "crossing 204 holds 24 departures in the clone at 17fa4195");
  for (const l of RECORD) {
    assert.equal(l.type, "departure");
    assert.equal(l.payload.source, "dynamic.db/movements",
      "every line of this window was written from the reverse-mirror copy — that is the premise of the lane");
    assert.deepEqual(Object.keys(l), ["at", "type", "actor", "seq", "payload"],
      "finding 1's top-key grammar, in its order");
    assert.deepEqual(Object.keys(l.payload),
      ["from", "toward", "crossing", "within", "to", "pace", "declared_by", "source"],
      "finding 1's payload grammar, in its order");
  }
});

test("EQUALITY: every field the world repo reads is byte-equal, rendered from the register", async () => {
  const store = install(fixtureRegister(ACTS));
  const lines = await renderedLines();
  assert.ok(store.asked.length >= 1, "the renderer asked the register no question — it is not reading the store");
  assert.equal(lines.length, RECORD.length, "the register renders one line per record line");

  const { paired, onlyInFile, onlyInDerived } = pairDepartures(RECORD, lines);
  assert.equal(onlyInFile.length, 0, "a record line the register could not answer for");
  assert.equal(onlyInDerived.length, 0, "a register line the record does not hold");
  assert.equal(paired.length, 24);

  for (const p of paired) {
    const read = compareDepartureLine(p.file, p.derived).filter((c) => c.read);
    assert.deepEqual(read, [], `${p.key} differs on a field the world reads`);
  }
});

test("EQUALITY: `source` is the ONE allowed diff, and every other gap is named", async () => {
  install(fixtureRegister(ACTS));
  const lines = await renderedLines();
  const { paired } = pairDepartures(RECORD, lines);

  const classes = new Set();
  for (const p of paired) for (const c of compareDepartureLine(p.file, p.derived)) classes.add(gapClassOf(c));

  assert.equal(classes.has("unexplained"), false, "a difference in no named class is a finding, never a shrug");
  assert.equal(classes.has("source"), true, "the stamp moves from dynamic.db/movements to acts");
  assert.equal(classes.has("seq"), true, "the movements rowid has no store source; the act id stands in");
  // `declared_by` and `note` are gaps in the GRAMMAR (the register holds
  // neither) and happen not to differ in THIS window, because every one of its
  // 24 lines was declared by its own actor and none carries a note. They are
  // asserted as facts about the window rather than left implied — a window
  // where they DID differ would be a different measurement, not a failure here.
  for (const l of RECORD) {
    assert.equal(l.payload.declared_by, l.actor, "window 204 has no delegated walk");
    assert.equal("note" in l.payload, false, "window 204 carries no note");
  }
  assert.equal(classes.has("declared_by"), false);
  assert.equal(classes.has("note"), false);

  assert.deepEqual([...classes].sort(), ["seq", "source"],
    "with the instant solved, exactly two fields differ and both are named");
});

test("CONTROL: the equality can fail — one mangled read field is caught and named", async () => {
  install(fixtureRegister(ACTS));
  const lines = await renderedLines();
  const { paired } = pairDepartures(RECORD, lines);

  // A probe that cannot fail is an act. Move one walker one metre.
  const victim = paired[0];
  const bent = { ...victim.derived, payload: { ...victim.derived.payload, toward: { x: victim.derived.payload.toward.x + 1, y: victim.derived.payload.toward.y } } };
  const causes = compareDepartureLine(victim.file, bent);
  const read = causes.filter((c) => c.read);
  assert.equal(read.length, 1, "exactly the bent field is caught");
  assert.equal(read[0].field, "payload.toward");
  assert.equal(gapClassOf(read[0]), "unexplained", "a read field has no named gap — every difference in one is a finding");
});

test("CONTROL: a line only the register holds is UNEXPLAINED, never quietly dropped", async () => {
  // The planted walk: in the register, in no file. An answer short by exactly
  // the rows nobody looks for is the one outcome neither store may produce.
  const ghost = {
    id: 9999, at: new Date("2026-09-22T06:00:00.000Z"), crossing: "204.5",
    actor: "ghost-walker", action: "walk",
    payload: { from: { x: 0, y: 0 }, toward: { x: 10, y: 10 }, pace: 60, within: null, to: null },
  };
  install(fixtureRegister([...ACTS, ghost]));
  const lines = await renderedLines();
  const { onlyInDerived } = pairDepartures(RECORD, lines);
  assert.equal(onlyInDerived.length, 1);
  assert.equal(onlyInDerived[0].actor, "ghost-walker");
});

test("the renderer writes finding 1's grammar, key order included", async () => {
  install(fixtureRegister(ACTS));
  const lines = await renderedLines();
  for (const l of lines) {
    assert.deepEqual(Object.keys(l.payload),
      ["from", "toward", "crossing", "within", "to", "pace", "declared_by", "source"],
      "key ORDER is part of the bytes and the record has carried one order across all 2,870 of its lines");
    assert.equal(l.payload.source, "acts");
    assert.equal(l.type, "departure");
  }
});

test("era one is not rendered here — the caller already holds it", async () => {
  // `world.mjs § departuresAcrossEras` and `crossing-save`'s own
  // `readDepartureEvents` both bring the frozen ledger from the world clone.
  // Returning it from the register too would hand `mergedDepartureEvents` one
  // departure twice under two era tags, where latest-wins picks whichever
  // sorted last — a different resident's governing leg, silently.
  const ledgerAct = {
    id: 1001, at: new Date("2026-06-20T12:00:00.000Z"), crossing: "16.5",
    actor: "founding-walker", action: "legacy:departure",
    payload: { _ledger: "walk-ledger.md", handle: "founding-walker", iso: "2026-06-20T12:00:00.000Z", from: { x: 1, y: 1 }, toward: { x: 2, y: 2 }, at: 16.5, line: "founding-walker walked" },
  };
  install(fixtureRegister([ledgerAct, ...ACTS]));
  const lines = await renderedLines();
  assert.equal(lines.some((l) => l.actor === "founding-walker"), false,
    "the founding era arrives by the clone, and only by the clone");
});

// ═════════════════════════════════════════════════════════════════════════════
// THE STOP — the register holds no departure instant
// ═════════════════════════════════════════════════════════════════════════════
//
// Both halves name the CAUSE. Simulating the drift with a hand-picked offset
// would be a probe relying on a number I chose, which proves nothing about the
// office.

test("STOP (cause 1): a walk act is stamped with the MIRROR's clock, not the departure's", () => {
  // `world.mjs § walkEntry` returns `{crossing, actor, action, object, at,
  // witnesses, cls, payload, effect, household}` and passes no `writtenAt` —
  // `at` there is `witnessStampAt`'s PLACE anchor, not an instant. So
  // `normalizeRow` fills `written_at` from its own clock, and that value is
  // what `mirrorAct` / `appendActFlipped` INSERT into `acts.at`.
  const departedAt = "2026-09-22T00:14:40.194Z";
  const before = Date.now();
  const row = normalizeRow({
    crossing: 204.02035324074075, actor: "neth", action: "walk", object: null,
    at: { anchor: null, dx: null, dy: null }, witnesses: null, cls: "move",
    payload: { from: { x: 1306, y: 2093.5 }, toward: { x: 1329, y: 2083 }, pace: 60, within: { w: 4, h: 4 }, to: "neth/little-free-library" },
    effect: "the walk is declared; the record receives it at the save",
  });
  const after = Date.now();

  assert.notEqual(row.written_at, departedAt,
    "if this ever passes, the act has learned the departure's own instant and the STOP is closed");
  const stamped = Date.parse(row.written_at);
  assert.ok(stamped >= before && stamped <= after,
    "the stamp is this process's clock at normalize time — the mirror's, taken after the resident declared");
  assert.equal(Object.prototype.hasOwnProperty.call(row.payload ? JSON.parse(row.payload) : {}, "at"), false,
    "and the payload carries no instant of its own either");
});

test("STOP (cause 2): the act's `crossing` is a DIFFERENT clock read and does not reconstruct the instant", () => {
  // The register's other instant-shaped column. `world.mjs § walkViaOffice`
  // computes `fractionalCrossing()` once, hands it to both pens, and only then
  // does `declareMovement` read the wall clock for `movements.at` — so the two
  // are separated by whatever the door did in between.
  //
  // Measured on this window's own 24 lines, with the world's own constants.
  const CROSSING_EPOCH_UTC = Date.UTC(2026, 5, 12);
  const CROSSING_MS = 12 * 3600 * 1000;
  const deltas = RECORD.map((l) => Math.round(CROSSING_EPOCH_UTC + l.payload.crossing * CROSSING_MS) - Date.parse(l.at));

  assert.equal(deltas.filter((d) => d === 0).length, 0,
    "not one of the 24 reconstructs exactly — if this ever fails, the crossing has become the instant and cause 2 is closed");
  assert.ok(Math.max(...deltas.map(Math.abs)) > 1,
    "and the miss is larger than a rounding of the float");
});

test("the STOP is written down where a reader of the check will find it", () => {
  assert.match(DEPARTURE_GAPS.at, /^STOP:at/, "the instant is the one gap ranked as a STOP");
  assert.match(DEPARTURE_GAPS.seq, /^gap:seq/);
  assert.match(DEPARTURE_GAPS.declared_by, /^gap:declared_by/);
  assert.match(DEPARTURE_GAPS.note, /^gap:note/);
  assert.match(DEPARTURE_GAPS.source, /^gap:source/);
  assert.equal(RECORD_READ_FIELDS.includes("at"), true,
    "and `at` is in the read set, which is why it is a STOP and not a gap");
});

// ═════════════════════════════════════════════════════════════════════════════
// THE CHECK'S OWN MANNERS
// ═════════════════════════════════════════════════════════════════════════════

test("NOT POINTED AT A REGISTER is disclosed, never rendered as an empty record", async () => {
  const pg = process.env.WORLD2_PG;
  delete process.env.WORLD2_PG;
  try {
    const { events, absent } = await storedDepartureEvents({ atMs: WINDOW_TO });
    assert.deepEqual(events, []);
    assert.match(String(absent), /not pointed at the record/,
      "an office with no register must not be readable as a town where nobody has walked");
  } finally { process.env.WORLD2_PG = pg; }
});

test("an unreachable register is disclosed, and the renderer never throws", async () => {
  install({ query: async () => { throw new Error("connection refused"); } });
  const { events, absent } = await storedDepartureEvents({ atMs: WINDOW_TO });
  assert.deepEqual(events, []);
  assert.ok(absent && /connection refused|record cannot be reached/.test(absent),
    "the cause is carried, not swallowed");
});

test("era one lines on disk are not the store's half and are counted, not compared", () => {
  // Windows 118 and 119 hold 13 lines with `line_no` and no `source`: the
  // hydrated ledger, written through `read.events`. They are outside this
  // record's half and pairing them against the register would report 13
  // orphans in a window that is perfectly correct.
  const eraOne = { at: "2026-08-10T04:20:13.309Z", type: "departure", actor: "postmaster", seq: 305, payload: { from: { x: 0, y: 0 }, toward: { x: 1, y: 1 }, crossing: 118.3614, within: null, to: null, pace: null, line_no: 318 } };
  const kept = storeEraLines([eraOne, ...RECORD]);
  assert.equal(kept.length, RECORD.length, "era one is filtered out by its own missing stamp");
  assert.equal(kept.some((l) => l.payload.line_no != null), false);
});

test("the check pairs on (actor, crossing) — the one key neither side is measuring", () => {
  // `at` and `seq` are the quantities under measurement, so pairing on either
  // would report every line as two orphans and drown the real disagreements.
  // `crossing` is safe because ONE variable fills it on both sides.
  const shifted = RECORD.map((l, i) => ({ ...l, at: new Date(Date.parse(l.at) + 900).toISOString(), seq: 50000 + i }));
  const { paired, onlyInFile, onlyInDerived } = pairDepartures(RECORD, shifted);
  assert.equal(paired.length, RECORD.length, "the pairing survives the two gaps it was built to survive");
  assert.equal(onlyInFile.length, 0);
  assert.equal(onlyInDerived.length, 0);
  const causes = compareDepartureLine(paired[0].file, paired[0].derived);
  assert.equal(causes.some((c) => c.field === "at" && c.read), true, "and the drift is still REPORTED, on a read field");
});
