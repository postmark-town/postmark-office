// dungeon-creatures-only-for-the-entered.test.mjs — WLD-74 part 1 (src/creature-sight.mjs).
//
// RULED (Darko, 2026-10-26 13:44 EDT): "hide the creatures entirely. The only instance where you see the creatures
// is if you are entered in the room that the creature is entered in also. That needs to be the logic for dungeons
// in general, always."
//
// THE BREACH, from the store's acts of that day: a resident exited a dungeon room, then WALKED onto the spot of
// a creature's room without entering it. The creature answered the walk, then a call (counting the resident's
// household); a second creature answered a walk onto a room with no way in, with a tell. Every creature path
// asked "is your point inside its room's outline", never "did you enter the room". The enter record (occupancy)
// is the one meaning of "inside". The fixtures below replay those two sequences with invented names and places.
//
// The occupancy here is the world's own fold (enter-exit.mjs § occupancyAt) over rows in the ledger's shape.

import { test as nodeTest } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { LivingSet, loadCreatureLaw, reactTo, ringRosterNow } from "../src/creatures.mjs";
import { creaturePairs, worldCreature } from "../src/creature-verbs.mjs";
import { creaturesInWho, findCreatures, investigateCreature } from "../src/creatures-read.mjs";
import { enteredBy, sightedFor, __setOccupancyForTest } from "../src/creature-sight.mjs";
import { NO_WORLD, worldClone, worldModuleUrl } from "./fixture-paths.mjs";

const test = (name, fn) => nodeTest(name, { skip: NO_WORLD || false }, fn);

const LAW_DIR = "WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-node/entity/creature";
const lawRecords = async () => {
  const { parseRecord } = await import(worldModuleUrl("tools", "marks-fold.mjs"));
  const root = join(worldClone(), LAW_DIR);
  return readdirSync(root, { recursive: true }).map(String).filter((p) => /(^|[\\/])mark\.md$/.test(p))
    .map((p) => parseRecord(readFileSync(join(root, p), "utf8"), `${LAW_DIR}/${p}`));
};
const LAW = NO_WORLD ? null : await loadCreatureLaw({ ref: "the pinned clone", importTool: (f) => import(worldModuleUrl("tools", f)),
  readText: (path) => readFileSync(join(worldClone(), path), "utf8"), lawRecords });
const { occupancyAt } = NO_WORLD ? {} : await import(worldModuleUrl("tools", "enter-exit.mjs"));

const NOW = Date.parse("2026-10-26T17:40:00Z");
const iso = (ms) => new Date(ms).toISOString();
const WOLF = "creature:wolf-1", RAVEN = "creature:raven-1", CROW = "creature:wolf-2";
// the first room (the wolf's), the second room (the raven's) and a neighbour in the same dungeon; one outdoors
const ROOM_ONE = { id: "dungeon-x/room-one", at: { x: 3300, y: -4200 }, extent: { w: 80, h: 80 } };
const ROOM_TWO = { id: "dungeon-x/room-two", at: { x: 3180, y: -4170 }, extent: { w: 80, h: 80 } };
const YARD = { id: "dungeon-x/yard", at: { x: 3320, y: -4400 }, extent: { w: 80, h: 80 } };
const spawn = (id, kind, x, y, n) => ({ id: String(n), at: iso(NOW - 3600_000), actor: "the-town", action: "spawn", object: id,
  payload: { kind, at: iso(NOW - 3600_000), fades_at: iso(NOW + 12 * 3600_000), x, y } });
function world() {
  const living = new LivingSet({ law: LAW }).fold([spawn(WOLF, "wolf", 3300, -4200, 1), spawn(RAVEN, "raven", 3180, -4170, 2), spawn(CROW, "wolf", 100, 100, 3)]);
  living.byId.get(WOLF).room = ROOM_ONE;
  living.byId.get(RAVEN).room = ROOM_TWO;
  living.byId.get(CROW).room = null; // outdoors
  return living;
}

// the ledger's shape: res-a entered the yard and left it; ana entered the first room; kit entered the yard alone
const ledger = (rows) => occupancyAt(rows.map(([handle, act, mark, at]) => ({ handle, act, mark: mark.id, at })), Infinity);
const EXITED = ledger([["res-a", "enters", YARD, 1], ["res-a", "exits", YARD, 2], ["ana", "enters", ROOM_ONE, 1], ["kit", "enters", YARD, 1]]);
const ENTERED = ledger([["res-a", "enters", YARD, 1], ["res-a", "exits", YARD, 2], ["res-a", "enters", ROOM_ONE, 3], ["res-a", "enters", ROOM_TWO, 4], ["ana", "enters", ROOM_ONE, 1]]);
const NEXT_DOOR = ledger([["res-a", "enters", ROOM_TWO, 1]]); // inside the dungeon, in the neighbouring room

const KEY = { handles: new Set(["res-a"]), household: "hh:res-a" };
const ENV = { TYPESAFE_API_KEY: "k" };
const AT_FIRST = { x: 3300, y: -4200 }; // the breach: the first room's spot
const AT_SECOND = { x: 3180, y: -4170 };  // and the second room's

const walkAct = (point, extra = {}) => ({ actor: "res-a", verb: "walk", actId: "7001", atIso: iso(NOW), point, ...extra });
async function reacts(living, occupancy, point) {
  const wrote = [];
  const answers = await reactTo(walkAct(point), { living, law: LAW, env: ENV, now: NOW, clock: () => NOW, occupancy, around: async () => ({}), heardFor: async () => null,
    present: async () => ({ residents: [{ handle: "res-a", distance_m: 0, at: point }] }), households: async () => (h) => ({ key: `solo:${h}`, slug: null }),
    ask: async () => ({ response: { answers: { reaction: { probabilities: { stalk: 1, notice: 1 } } } } }),
    write: async (rows) => { wrote.push(...rows); return { prior: false, rows: rows.map((r, i) => ({ id: String(9000 + i), at: r.written_at, actor: r.actor, action: r.action, object: r.object, payload: r.payload })) }; } });
  return { answers, wrote };
}
function door(living, here) {
  const calls = { write: [], say: [], answer: [] };
  const deps = { now: () => NOW, clock: () => NOW, env: ENV, freeze: () => null, creatures: async () => ({ living, law: LAW }), standpoint: async () => here,
    carryingConsumable: async () => false, write: async (e) => { calls.write.push(e); return { actId: "901", written_at: iso(NOW) }; },
    say: async (a) => { calls.say.push(a); return { spoke: true }; },
    answer: async (act, d2) => { calls.answer.push(act); return reactTo(act, { ...d2, env: ENV, now: NOW, clock: () => NOW, around: async () => ({}), heardFor: async () => null,
      ask: async () => ({ response: { answers: { reaction: { probabilities: { answer: 1 } } } } }),
      write: async (rows) => ({ prior: false, rows: rows.map((r, i) => ({ id: String(5000 + i), at: r.written_at, actor: r.actor, action: r.action, object: r.object, payload: r.payload })) }) }); },
    others: async () => [] };
  return { calls, run: (args) => worldCreature(args, KEY, deps) };
}
const reset = () => __setOccupancyForTest(null);

// ── 1. exited, then walked onto its spot: the creature does not exist ───────

test("1 (the breach): a resident who exited a room and WALKED onto a creature's spot sees nothing of it, gets no reaction, and a call is refused as no creature", async () => {
  __setOccupancyForTest(() => EXITED);
  try {
    const living = world();
    assert.equal(enteredBy(living.byId.get(WOLF), EXITED.get("res-a") ?? []), false);
    // no reaction to the walk, and nothing written (the wolf answered his walk at 16:37:09Z)
    const walk = await reacts(living, undefined, AT_FIRST);
    assert.deepEqual(walk.answers, [], "the wolf does not answer a walk from outside its room");
    assert.deepEqual(walk.wrote, [], "and nothing is written: no reaction row, no cost, no press");
    // the call, refused exactly as for an unknown creature: never a word about a room he has not entered
    const d = door(living, AT_FIRST);
    await assert.rejects(d.run({ act: "call", creature: WOLF, words: "anyone?" }), (e) => e.code === 404 && /no creature/.test(e.defect) && !/room|enter/i.test(`${e.defect} ${e.hint}`));
    const unknown = await door(living, AT_FIRST).run({ act: "call", creature: "creature:wolf-99", words: "anyone?" }).catch((e) => e);
    await assert.rejects(door(living, AT_FIRST).run({ act: "call", creature: WOLF, words: "anyone?" }), (e) => e.code === unknown.code && e.hint === unknown.hint, "the same words as an id that was never there");
    assert.deepEqual([d.calls.write, d.calls.say, d.calls.answer], [[], [], []], "nothing said, nothing written");
    // every read: not listed
    const view = await sightedFor(living, "res-a", { occupancy: EXITED });
    assert.deepEqual(findCreatures({ living: view, law: LAW }, "creature", AT_FIRST, { nowMs: NOW })?.map((h) => h.id) ?? [], [CROW], "find names the outdoor one only");
    assert.deepEqual(creaturesInWho({ living: view, law: LAW }, AT_FIRST, { nowMs: NOW, radiusM: 10_000 }).map((r) => r.id), [CROW]);
    assert.deepEqual(creaturePairs({ here: AT_FIRST, living: view, law: LAW, now: NOW, env: ENV }), [], "the matrix offers nothing at it");
    const looked = await investigateCreature(WOLF, { creatures: { living: view, law: LAW }, from: AT_FIRST, rows: async () => [{ id: "1" }], saved: () => ({ row: { kind: "wolf" } }), nowMs: NOW });
    assert.equal(looked.code, 404, "a look is no creature either, record and save notwithstanding");
    // its ring and pack do not count him; the one who entered stays counted
    const roster = await ringRosterNow(living.byId.get(WOLF), { law: LAW, living, now: NOW,
      present: async () => ({ residents: [{ handle: "res-a", distance_m: 0, at: AT_FIRST }, { handle: "ana", distance_m: 5, at: { x: 3305, y: -4200 } }, { handle: "kit", distance_m: 5, at: { x: 3295, y: -4200 } }] }),
      households: async () => (h) => ({ key: `solo:${h}`, slug: null }) });
    assert.deepEqual(roster.map((r) => r.handle), ["ana"], "res-a and kit (in the yard) are not in its ring; ana, who entered, is");
  } finally { reset(); }
});

test("1b (the raven): the walk onto its second room's spot, a room with no way in, draws no tell", async () => {
  __setOccupancyForTest(() => EXITED);
  try {
    const walk = await reacts(world(), undefined, AT_SECOND);
    assert.deepEqual(walk.answers, []);
    assert.deepEqual(walk.wrote, []);
    const d = door(world(), AT_SECOND);
    await assert.rejects(d.run({ act: "watch", creature: RAVEN }), (e) => e.code === 404 && /no creature/.test(e.defect));
  } finally { reset(); }
});

// ── 2. entered through its portal: it exists ─────────────────────────────────

test("2: the same resident after ENTERING that room sees it, gets the reaction, and the call goes through", async () => {
  __setOccupancyForTest(() => ENTERED);
  try {
    const living = world();
    const walk = await reacts(living, undefined, AT_FIRST);
    assert.equal(walk.answers.length, 1, "the wolf answers the walk");
    assert.equal(walk.answers[0].id, WOLF);
    const d = door(world(), AT_FIRST); // a fresh fold: the walk's own reaction would hold the 10 s window
    const r = await d.run({ act: "call", creature: WOLF, words: "anyone?" });
    assert.equal(r.did, "call");
    assert.equal(d.calls.answer.length, 1);
    const view = await sightedFor(living, "res-a", { occupancy: ENTERED });
    assert.ok(findCreatures({ living: view, law: LAW }, "wolf", AT_FIRST, { nowMs: NOW })?.some((h) => h.id === WOLF));
    assert.ok(creaturePairs({ here: AT_FIRST, living: view, law: LAW, now: NOW, env: ENV }).some((p) => p.object === WOLF));
    // and the ring counts them, with ana
    const roster = await ringRosterNow(living.byId.get(WOLF), { law: LAW, living, now: NOW,
      present: async () => ({ residents: [{ handle: "res-a", distance_m: 0, at: AT_FIRST }, { handle: "ana", distance_m: 5, at: { x: 3305, y: -4200 } }] }),
      households: async () => (h) => ({ key: `solo:${h}`, slug: null }) });
    assert.deepEqual(roster.map((r) => r.handle).sort(), ["ana", "res-a"]);
  } finally { reset(); }
});

// ── 3. entered in the neighbouring room: still nothing ───────────────────────

test("3: entered in a NEIGHBOURING room of the same dungeon, a resident still sees nothing of the creature", async () => {
  __setOccupancyForTest(() => NEXT_DOOR);
  try {
    const living = world();
    const walk = await reacts(living, undefined, AT_FIRST); // standing on the wolf's spot, inside the second room
    assert.deepEqual(walk.answers, []);
    await assert.rejects(door(living, AT_FIRST).run({ act: "call", creature: WOLF, words: "hi" }), (e) => e.code === 404);
    const view = await sightedFor(living, "res-a", { occupancy: NEXT_DOOR });
    assert.ok(!view.byId.has(WOLF), "the first room's wolf is not here");
    assert.ok(view.byId.has(RAVEN), "the second room's raven, which he entered, is");
  } finally { reset(); }
});

// ── 4. outdoors: unchanged ───────────────────────────────────────────────────

test("4: an outdoor creature is unchanged: seen, answering, callable by anyone near it, entered nothing", async () => {
  __setOccupancyForTest(() => new Map());
  try {
    const living = world();
    const walk = await reacts(living, undefined, { x: 110, y: 100 });
    assert.equal(walk.answers.length, 1, "the circle, as before");
    assert.equal(walk.answers[0].id, CROW);
    const d = door(world(), { x: 110, y: 100 });
    assert.equal((await d.run({ act: "call", creature: CROW, words: "hi" })).did, "call");
    const view = await sightedFor(living, "nobody-at-all", { occupancy: new Map() });
    assert.ok(view.byId.has(CROW));
  } finally { reset(); }
});

test("the ledger is read once per read, never per creature, and not at all when no creature is in a room", async () => {
  let reads = 0;
  __setOccupancyForTest(() => { reads += 1; return EXITED; });
  try {
    const living = world();
    await reacts(living, undefined, AT_FIRST);
    assert.equal(reads, 1, "one read for the act, whatever the number of creatures");
    reads = 0;
    const outdoors = new LivingSet({ law: LAW }).fold([spawn(CROW, "wolf", 100, 100, 3)]);
    outdoors.byId.get(CROW).room = null;
    await reacts(outdoors, undefined, { x: 110, y: 100 });
    assert.equal(reads, 0, "outdoors creatures need no ledger");
  } finally { reset(); }
});

test("a resident's read (creaturesForRead as: handle) is the sighted set; the law-only read is the whole set", async () => {
  const { creaturesForRead } = await import("../src/creatures-read.mjs");
  const living = world();
  const hook = { living, law: LAW };
  const seen = await creaturesForRead({ hook, as: "res-a", occupancy: EXITED });
  assert.deepEqual([...seen.living.byId.keys()], [CROW]);
  assert.ok(seen.living.hidden.has(WOLF), "what the view leaves out, so a look at its id is no creature");
  assert.equal(living.byId.size, 3, "the real set is untouched");
  const keyless = await creaturesForRead({ hook, as: "", occupancy: EXITED });
  assert.deepEqual([...keyless.living.byId.keys()], [CROW], "a read with no resident has entered nothing");
  assert.equal((await creaturesForRead({ hook })).living.byId.size, 3, "no `as`: the whole set, for the law-only readers");
  // a verb's own row still lands in the real set through the view
  seen.living.fold([{ id: "55", at: iso(NOW), actor: CROW, action: "react", object: "70", payload: { to: "res-a", verb: "walk", reaction: "watch", roll: 3 } }]);
  assert.ok(living.byId.get(CROW).reactions.length >= 1);
});
