// cosign-set-down.test.mjs — a berth that comes ashore is set down where it stood (POS-740).
//
// RULED (Darko, 2026-10-21 08:07 / 08:09): no teleport. The co-sign files the new
// resident's first position, one zero-length departure at the berth's place, and
// the ordinary movement record places them from then on. The 09-17 Origin stays
// for a resident with no position history.
//
//   THE WRITE     setDownWhereItStood files landOnEnter's record (from == toward,
//                 `to` the mark, declared by the town, with its note), and the
//                 kept positions in the same step.
//   THE GUARD     never over a record that already places them; a second run is
//                 a no-op; an unreadable record writes nothing; a failed write is
//                 an answer, never a throw; a dry run writes nothing.
//   THE READERS   over a fixture store (the POS-272 harness), the set-down places
//                 the resident at the quay on both standpoint arms with its note;
//                 orient says the note, not "where your walk arrived"; the first
//                 walk departs from the quay; a resident with no record still
//                 stands at the Origin; a placed resident is unchanged.
//   THE ORDER     the berth's place is read before the declaration: the manifest
//                 file the declaration writes reads as the deck afterwards, and
//                 oauth.mjs asks first.
//
// THE CAN-FAIL FLIPS (run after the commit):
//   1. drop the guard in set-down.mjs: the GUARD tests go red.
//   2. read the place after declareViaOffice in oauth.mjs: THE ORDER goes red.
//   3. drop `note` from the era-5 converter (live-reads.mjs): the note tests go red.
//   4. standCoords back to "where your walk arrived": the orient test goes red.
//
// Run: WORLD_CLONE=<world clone> node --test test/cosign-set-down.test.mjs

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { WORLD_CLONE } from "../src/world-store.mjs";
import { useGuardReader, DEPARTURE_HEAD_SQL, DEPARTURE_NEWEST_SQL } from "../src/world2-guards.mjs";
import { normalizeRow } from "../src/world-journal.mjs";
import { worldToolModule } from "../src/dynamic-entities.mjs";
import { fixtureMarks } from "./movement-fixture.mjs";
import { setDownWhereItStood, setDownDeps, SET_DOWN_BY, SET_DOWN_NOTE } from "../src/set-down.mjs";

const OFFICE = join(dirname(fileURLToPath(import.meta.url)), "..");
const FLAGS = ["WORLD_MOVEMENT_V2", "WORLD2_PG", "WORLD2_PG_URL", "WORLD_POSITIONS"];
const was = Object.fromEntries(FLAGS.map((k) => [k, process.env[k]]));

// ── the fixture store, as `pg` hands acts over (standpoint-from-the-kept-positions' harness) ──
const STORE = [];
let storeDown = false;   // the store does not answer
let restoreReader = null;
before(() => {
  process.env.WORLD_MOVEMENT_V2 = "1";
  process.env.WORLD2_PG = "1";
  process.env.WORLD2_PG_URL = "postgres://cosign-set-down/none";
  delete process.env.WORLD_POSITIONS;
  restoreReader = useGuardReader(async (fn) => fn({
    query: async (sql, params) => {
      if (storeDown) throw new Error("the store is away");
      if (!/FROM acts/i.test(String(sql))) return { rows: [] };
      const actions = params?.[0] ?? [];
      const deps = STORE.filter((r) => actions.includes(r.action));
      if (sql === DEPARTURE_HEAD_SQL) return { rows: deps.filter((r) => r.id > Number(params[1])).map((r) => ({ id: r.id })) };
      if (sql === DEPARTURE_NEWEST_SQL) return { rows: deps.slice(-1).map((r) => ({ id: r.id })) };
      return { rows: deps };
    },
  }));
});
after(() => {
  restoreReader?.();
  for (const k of FLAGS) if (was[k] == null) delete process.env[k]; else process.env[k] = was[k];
});

const haveClone = existsSync(join(WORLD_CLONE, "WORLD", "walk-ledger.md"));
const needsClone = (t) => (haveClone ? false : (t.skip(`needs the world clone at ${WORLD_CLONE}`), true));

/** An act into the fixture store, as the pen writes it. */
function fileAct(entry) {
  const row = normalizeRow(entry);
  const id = 90_000 + STORE.length;
  STORE.push({ id, at: new Date(row.written_at), crossing: String(row.crossing), actor: row.actor, action: row.action, payload: JSON.parse(row.payload) });
  return { actId: id };
}

/** The office's own deps, with the pen pointed at the fixture store. */
async function storeDeps(walk, atMs) {
  const world = await import("../src/world.mjs");
  return {
    departures: (await setDownDeps()).departures,   // the office's own guard read, both eras or nothing
    walkEntry: world.walkEntry,
    append: async (entry) => fileAct(entry),
    record: () => {},
    crossing: () => walk.fractionalCrossing(atMs),
    pace: () => null,
    now: () => new Date(atMs).toISOString(),
  };
}

const QUAY = { x: -35, y: 12, mark: "the-town/the-quay" };
const ASHORE = {
  marks: [{ id: "the-town/the-quay", at: { x: -35, y: 12 }, extent: { w: 20, h: 20 } }],
  parcels: [], households: {},
};
const WITH_CARRIER = { ...ASHORE, marks: [...ASHORE.marks, ...fixtureMarks()] };
const B = Date.parse("2026-10-21T04:00:00.000Z");

// ── THE WRITE and THE GUARD, on fake deps ────────────────────────────────────

function fakeDeps({ held = [], append = null, departures = null } = {}) {
  const calls = { appended: [], recorded: [] };
  return {
    calls,
    deps: {
      departures: departures ?? (async () => held),
      walkEntry: (e) => ({ ...e, built: true }),
      append: append ?? (async (entry) => { calls.appended.push(entry); return { actId: 7 }; }),
      record: (m, actId) => calls.recorded.push({ m, actId }),
      crossing: () => 261.25, pace: () => 40, now: () => "2026-10-21T04:00:00.000Z",
    },
  };
}

test("THE WRITE: one zero-length departure at the berth's place, to the mark, declared by the town, with its note; the kept position in the same step", async () => {
  const { deps, calls } = fakeDeps();
  const r = await setDownWhereItStood({ handle: "ash", household: "ash-house", place: QUAY }, deps);
  assert.deepEqual(r, { written: true, actId: 7, at: { x: -35, y: 12 }, mark: "the-town/the-quay" });
  assert.equal(calls.appended.length, 1);
  const e = calls.appended[0];
  assert.deepEqual([e.who, e.from, e.toward, e.targetMarkId, e.declaredBy, e.note, e.household, e.crossing],
    ["ash", { x: -35, y: 12 }, { x: -35, y: 12 }, "the-town/the-quay", SET_DOWN_BY, SET_DOWN_NOTE, "ash-house", 261.25]);
  assert.equal(SET_DOWN_BY, "the-town", "nobody walked here: the record is the town's (G2)");
  assert.deepEqual(calls.recorded.map(({ m, actId }) => [m.actor, m.toMark, m.note, actId]), [["ash", "the-town/the-quay", SET_DOWN_NOTE, 7]]);
});

test("THE GUARD: a handle the record already places is never set down, and says why", async () => {
  const { deps, calls } = fakeDeps({ held: [{ handle: "ash", from: { x: 1, y: 1 }, toward: { x: 9, y: 9 } }] });
  const r = await setDownWhereItStood({ handle: "ash", place: QUAY }, deps);
  assert.equal(r.written, false);
  assert.equal(r.already, true);
  assert.match(r.why, /already has a position on record/);
  assert.equal(calls.appended.length, 0, "nothing written over a real move");
  const other = await setDownWhereItStood({ handle: "kiri", place: QUAY }, fakeDeps({ held: [{ handle: "ash" }] }).deps);
  assert.equal(other.written, true, "another resident's record is not this one's");
});

test("THE GUARD: an unreadable record writes nothing; a failed write is an answer, never a throw; a dry run writes nothing", async () => {
  const unreadable = fakeDeps({ departures: async () => { throw new Error("store away"); } });
  const a = await setDownWhereItStood({ handle: "ash", place: QUAY }, unreadable.deps);
  assert.equal(a.written, false);
  assert.match(a.why, /could not be read, so nothing is written over it: store away/);
  assert.equal(unreadable.calls.appended.length, 0);

  const refused = fakeDeps({ append: async () => { throw Object.assign(new Error("x"), { defect: "the pen refused" }); } });
  const b = await setDownWhereItStood({ handle: "ash", place: QUAY }, refused.deps);
  assert.deepEqual([b.written, b.why], [false, "the set-down was not written: the pen refused"]);

  const dry = fakeDeps();
  const c = await setDownWhereItStood({ handle: "ash", place: QUAY, dry: true }, dry.deps);
  assert.equal(c.written, false);
  assert.deepEqual(c.would?.at, { x: -35, y: 12 });
  assert.equal(dry.calls.appended.length, 0, "a dry run writes nothing");

  for (const place of [null, { x: "a", y: 1 }])
    assert.equal((await setDownWhereItStood({ handle: "ash", place }, fakeDeps().deps)).written, false, "no place, no write");
});

// ── THE READERS, over the fixture store ──────────────────────────────────────

test("THE READERS: the set-down places the co-signed resident at the quay, on both standpoint arms, with its note; a second run is a no-op", async (t) => {
  if (needsClone(t)) return;
  STORE.length = 0;
  const world = await import("../src/world.mjs");
  const walk = await worldToolModule("walk.mjs", { repo: WORLD_CLONE });
  const deps = await storeDeps(walk, B);
  const r = await setDownWhereItStood({ handle: "ash-at-the-quay", place: QUAY }, deps);
  assert.equal(r.written, true, r.why);
  assert.equal(STORE.length, 1);
  assert.deepEqual([STORE[0].action, STORE[0].payload.from, STORE[0].payload.toward, STORE[0].payload.to, STORE[0].payload.declared_by, STORE[0].payload.note],
    ["walk", { x: -35, y: 12 }, { x: -35, y: 12 }, "the-town/the-quay", "the-town", SET_DOWN_NOTE]);

  for (const [arm, fold] of [["interim (whereIs)", ASHORE], ["frame fold (a carrier world)", WITH_CARRIER]]) {
    const s = await world.residentStandpoint("ash-at-the-quay", fold);
    assert.deepEqual([s.placed, s.x, s.y, s.source, s.moving, s.note], [true, -35, 12, "walk", false, SET_DOWN_NOTE], `${arm}: ${JSON.stringify(s)}`);
  }
  const again = await setDownWhereItStood({ handle: "ash-at-the-quay", place: QUAY }, deps);
  assert.equal(again.already, true, "the second run finds the first and writes nothing");
  assert.equal(STORE.length, 1);
});

test("THE READERS: the first walk departs from the quay; a placed resident is unchanged; a resident with no record still stands at the Origin (09-17)", async (t) => {
  if (needsClone(t)) return;
  STORE.length = 0;
  const world = await import("../src/world.mjs");
  const walk = await worldToolModule("walk.mjs", { repo: WORLD_CLONE });
  const deps = await storeDeps(walk, B);
  await setDownWhereItStood({ handle: "came-ashore", place: QUAY }, deps);
  const governing = (await world.departuresForWalk(WORLD_CLONE)).filter((d) => d.handle === "came-ashore").at(-1);
  assert.deepEqual([governing.toward.x, governing.toward.y], [-35, 12], "the walk door reads its new leg's start from this record");

  fileAct(world.walkEntry({ crossing: walk.fractionalCrossing(B + 60_000), who: "walked-away", targetMarkId: null, stampAt: null, witnesses: null,
    from: { x: 300, y: 300 }, toward: { x: 300, y: 300 }, pace: null, targetExtent: null, household: null, writtenAt: new Date(B + 60_000).toISOString() }));
  const before_ = await world.residentStandpoint("walked-away", ASHORE);
  const refused = await setDownWhereItStood({ handle: "walked-away", place: QUAY }, deps);
  assert.equal(refused.already, true, JSON.stringify(refused));
  assert.deepEqual(await world.residentStandpoint("walked-away", ASHORE), before_, "a placed resident is not moved");
  assert.equal(before_.note, undefined, "a walk the door files carries no note");

  const nobody = await world.residentStandpoint("never-a-berth", ASHORE);
  assert.deepEqual([nobody.x, nobody.y, nobody.source], [0, 0, "origin"], "no position history: the Origin, as ruled 09-17");
});

test("THE GUARD, the office's own read: a store that does not answer is not \"no record\" — nothing is written", async (t) => {
  if (needsClone(t)) return;
  STORE.length = 0;
  const walk = await worldToolModule("walk.mjs", { repo: WORLD_CLONE });
  const deps = await storeDeps(walk, B);
  storeDown = true;
  try {
    const r = await setDownWhereItStood({ handle: "while-the-store-is-away", place: QUAY }, deps);
    assert.equal(r.written, false, JSON.stringify(r));
    assert.match(r.why, /could not be read, so nothing is written over it/);
  } finally { storeDown = false; }
  assert.equal(STORE.length, 0);
});

test("THE READERS: orient says the record's note, not \"where your walk arrived\" (G5)", async (t) => {
  if (needsClone(t)) return;
  STORE.length = 0;
  const world = await import("../src/world.mjs");
  const walk = await worldToolModule("walk.mjs", { repo: WORLD_CLONE });
  await setDownWhereItStood({ handle: "orient-ashore", place: QUAY }, await storeDeps(walk, B));
  const o = await world.worldOrient({ handle: "orient-ashore" }, { handles: new Set(["orient-ashore"]) });
  assert.equal(o?.standpoint?.from, SET_DOWN_NOTE, JSON.stringify(o?.standpoint ?? o));
});

// ── THE ORDER ────────────────────────────────────────────────────────────────

test("THE ORDER: the declaration's manifest file reads as the deck, so the co-sign asks where the berth stood first", async (t) => {
  if (needsClone(t)) return;
  const { berthPlace } = await import("../src/world.mjs");
  const town = mkdtempSync(join(tmpdir(), "cosign-set-down-"));
  try {
    const before_ = await berthPlace("a-keyless-berth", { townClone: town });
    assert.equal(before_.aboard, false, "a keyless berth has no manifest line: the quay stone");
    assert.equal(before_.mark, "the-town/the-quay");
    mkdirSync(join(town, "HARBOR", "berths"), { recursive: true });
    writeFileSync(join(town, "HARBOR", "berths", "a-keyless-berth.md"), "the berth the declaration writes\n");
    const after_ = await berthPlace("a-keyless-berth", { townClone: town });
    assert.notDeepEqual([after_.x, after_.y], [before_.x, before_.y], "after the declaration the same reading answers the deck");
  } finally { rmSync(town, { recursive: true, force: true }); }

  const src = readFileSync(join(OFFICE, "src", "oauth.mjs"), "utf8");
  const block = src.slice(src.indexOf('pending.kind === "berth-cosign"'));
  const asked = block.indexOf("berthPlace(pending.slug"), declared = block.indexOf("declareViaOffice(ctx.clone"), placed = block.indexOf("setDownWhereItStood(");
  assert.ok(asked > 0 && declared > 0 && placed > 0, "the co-sign reads the place, declares, and sets down");
  assert.ok(asked < declared, "the place is read BEFORE the declaration writes the manifest file");
  assert.ok(declared < placed, "and the set-down follows the declaration: never a position for a handle not yet admitted");
});

test("THE DOOR'S WORDS: declare_household no longer says a newcomer lands at the harbour on the map (G4)", async () => {
  const src = readFileSync(join(OFFICE, "src", "declare.mjs"), "utf8");
  assert.doesNotMatch(src, /This lands you at THE HARBOR/);
  assert.match(src, /until you first walk, or the world gives you ground, you stand at the Origin \(0, 0\)/);
});
