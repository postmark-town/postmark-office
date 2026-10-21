// encounter-round1.test.mjs — the encounter's fixes from its first eval round
// (src/encounter.mjs, src/encounter-verbs.mjs, src/creatures.mjs, src/creature-verbs.mjs,
// src/creatures-read.mjs). Each case names the finding it holds:
//
//   F1  the press's `loudest` and `alone` rank the actor last when anyone else fits
//   F2  the household lookup never keeps a null read
//   F3  the ring an act reads is the one the tick kept, so a shield and a house split
//       land even when presence is too slow for the act's own wait
//   F4  a creature in a room is seen only from inside it: sight verbs, who and find
//   F8  a finish says what it pays at the settlement, to whom, and when; the finisher's
//       glance shows what they are owed
//   F9  investigate names both roads and their costs; `can` shows a strike from sight
//   F10 a reply carries the ease after the act, and says when it did not move
//   and the 10 s window's refusal says when to try again.
//
// The kind is a TEST FIXTURE dressed as the world's grammar parses a finishable one.

import { test as nodeTest } from "node:test";
import assert from "node:assert/strict";

import {
  LivingSet, loadCreatureLaw, reactTo, householdsNow, warmRosters, seesCreature, __resetHouseholdsForTest, __resetRostersForTest,
} from "../src/creatures.mjs";
import { NERVE_ACTION, pressMenu, ringRoster, windowAt, roadsOf, endingSaid, pendingFor, encounterRead } from "../src/encounter.mjs";
import { encounterEntries, encounterPairs, worldEncounter } from "../src/encounter-verbs.mjs";
import { whyNot } from "../src/creature-verbs.mjs";
import { creaturesInWho, findCreatures } from "../src/creatures-read.mjs";
import { NO_WORLD, worldModuleUrl } from "./fixture-paths.mjs";

const test = (name, fn) => nodeTest(name, { skip: NO_WORLD || false }, fn);

const KIND_TEXT = `kind: keeper
name: a test keeper
ring_m: 40
what: >
  A fixture.
moods:
  temper: 0..3 = 1 | calm | stirred | angry | wild
reaction notice "it notices": when true says It notices {actor}.
`;
const BASE = NO_WORLD ? null : await loadCreatureLaw({ ref: "the pinned clone", importTool: (f) => import(worldModuleUrl("tools", f)), readText: () => KIND_TEXT });
const reaction = (name, src, effects, says) => ({ name, sentence: name, when: BASE.kindMod.parseCondition(src), src, effects, says });
const PRESS_ON = ["actor", "striker", "shielder", "loudest", "alone"];
const KEEPER = NO_WORLD ? null : {
  ...BASE.kindOf("keeper"), finishable: true, resolve: 10, strike: 4, ease: { target: 2, by: "mine" },
  reactions: [
    reaction("bristle", `act.verb == "strike"`, [{ do: "press", n: 2, on: ["striker", "loudest"] }], "It bristles."),
    reaction("glare", `act.verb == "say"`, [{ do: "press", n: 2, on: PRESS_ON }], "It glares."),
    reaction("regard", `act.verb == "watch"`, [{ do: "ease", by: 1 }], "It regards {actor}."),
    reaction("notice", `act.verb == "walk"`, [{ do: "nothing" }], "It notices {actor}."),
    reaction("yield", `act.verb == "call"`, [{ do: "finish" }], "It yields to {actor}."),
  ],
};
const ROOM = { id: "a-room", at: { x: 0, y: 0 }, extent: { w: 40, h: 80 } }; // the wall at x = ±20
const walls = {
  ringRoomOf: (p, marks) => marks.find((m) => Math.abs(p.x - m.at.x) <= m.extent.w / 2 && Math.abs(p.y - m.at.y) <= m.extent.h / 2) ?? null,
  inCreatureRing: (p, c, ring, room) => Math.hypot(p.x - c.x, p.y - c.y) <= ring && (!room || Math.abs(p.x - room.at.x) <= room.extent.w / 2),
};
const lawWith = (extra = {}) => (NO_WORLD ? null : {
  ...BASE, kindOf: (n) => (n === "keeper" ? KEEPER : null), ...extra,
  kindMod: { ...BASE.kindMod, ENCOUNTER_VERBS: ["strike", "steady", "shield"], PRESS_ON,
    scopeOf: (s, a, actor, enc = {}) => { const sc = BASE.kindMod.scopeOf(s, a, actor); if (enc.resolve != null) sc.self.resolve = enc.resolve;
      sc.ease = { mine: enc.ease?.mine ?? 0, all: enc.ease?.all ?? 0, first_m: enc.ease?.first_m ?? 0 }; return sc; } },
});
const NOW = Date.parse("2026-10-26T13:00:00Z");
const iso = (ms) => new Date(ms).toISOString();
const ID = "creature:keeper-den";
let n = 20000;
const nextId = () => String(++n);
const spawn = (extra = {}) => ({ id: nextId(), at: iso(NOW - 3600_000), actor: "the-town", action: "spawn", object: ID, payload: { kind: "keeper", at: iso(NOW - 3600_000), stays: true, x: 0, y: 0, ...extra } });
const row = (actor, action, object, payload, at = NOW - 60_000) => ({ id: nextId(), at: iso(at), actor, action, object, payload });
const livingWith = (law = lawWith(), ...rows) => new LivingSet({ law }).fold([spawn()]).fold(rows, { advance: false });
const HOMES = { ana: "hearth", bo: "hearth" };
const lookup = (h) => (HOMES[h] ? { key: "house:hearth", slug: "hearth" } : { key: `solo:${h}`, slug: null });
const payloadOf = (r) => (typeof r.payload === "string" ? JSON.parse(r.payload) : r.payload);
function recordingWrite() {
  const calls = [];
  return { calls, write: async (rows) => { calls.push(rows); return { prior: false, rows: rows.map((r) => ({ id: nextId(), at: r.written_at, actor: r.actor, action: r.action, object: r.object, payload: r.payload })) }; } };
}
const act = (over = {}) => ({ actor: "kai", verb: "say", actId: nextId(), atIso: iso(NOW), point: { x: 10, y: 0 }, ...over });
const presentOf = (list) => async () => ({ residents: list.map(([handle, distance_m]) => ({ handle, distance_m })) });

// ── F1 ─────────────────────────────────────────────────────────────────────

test("F1: the loudest and the one alone rank the actor last when anyone else fits; the actor only when no one else does", () => {
  const living = livingWith(lawWith(), row(ID, NERVE_ACTION, "mo", { by: -1, why: "act", creature: ID }, NOW - 50_000), row(ID, NERVE_ACTION, "kai", { by: -1, why: "act", creature: ID }, NOW - 10_000));
  const roster = ringRoster({ residents: [{ handle: "kai", distance_m: 10 }, { handle: "mo", distance_m: 20 }] }, { ring: 40, lookup, living, now: NOW });
  assert.deepEqual(pressMenu(["alone"], { actor: "kai", roster, living, creatureId: ID, now: NOW }).map((e) => e.handle), ["mo"], "kai just acted, and mo is alone too");
  assert.deepEqual(pressMenu(["loudest"], { actor: "kai", roster, living, creatureId: ID, now: NOW }).map((e) => e.handle), ["mo"]);
  assert.deepEqual(pressMenu(["actor", "alone"], { actor: "kai", roster, living, creatureId: ID, now: NOW }).map((e) => [e.who, e.handle]), [["actor", "kai"], ["alone", "mo"]], "Jev has a choice");
  const solo = ringRoster({ residents: [{ handle: "kai", distance_m: 10 }] }, { ring: 40, lookup, living, now: NOW });
  assert.deepEqual(pressMenu(["alone"], { actor: "kai", roster: solo, living, creatureId: ID, now: NOW }).map((e) => e.handle), ["kai"]);
});

// ── F2 ─────────────────────────────────────────────────────────────────────

test("F2: the household lookup never keeps a null read; a good one is kept, and served stale while a fresh one is read", async () => {
  __resetHouseholdsForTest();
  let calls = 0;
  const nulls = async () => { calls += 1; return null; };
  assert.equal(await householdsNow({ read: nulls, now: NOW }), null);
  assert.equal(await householdsNow({ read: nulls, now: NOW + 1 }), null);
  assert.equal(calls, 2, "a null read is never kept: the next act asks again");
  const good = (h) => ({ key: `k:${h}` });
  assert.equal(await householdsNow({ read: async () => good, now: NOW }), good);
  assert.equal(await householdsNow({ read: nulls, now: NOW + 1000 }), good, "kept while fresh");
  assert.equal(await householdsNow({ read: nulls, now: NOW + 60_000 }), good, "stale but good while the fresh read comes back null");
  await new Promise((r) => setImmediate(r));
  assert.equal(await householdsNow({ read: nulls, now: NOW + 60_001 }), good, "the null read did not replace the good lookup");
  __resetHouseholdsForTest();
});

// ── F3 ─────────────────────────────────────────────────────────────────────

test("F3: presence too slow for the act's own wait reads the ring as the actor alone; the tick's kept ring lands the shield and the house split", async () => {
  __resetRostersForTest();
  const slow = (list) => () => new Promise((r) => setTimeout(() => r({ residents: list.map(([handle, distance_m]) => ({ handle, distance_m })) }), 600));
  const RING = [["ana", 10], ["bo", 12], ["gale", 14]];
  // the shield gale laid on ana, then ana says something: the creature glares and presses
  const shield = row("gale", "shield", "ana", { creature: ID, cost: 1 }, NOW - 30_000);
  const run = async (opts) => {
    const living = livingWith(lawWith(), shield);
    const w = recordingWrite();
    if (opts.warm) await warmRosters(living, { now: NOW, present: presentOf(RING) });
    const ask = async (s, q) => ({ response: { answers: { reaction: { probabilities: { glare: 1 } }, ...(q.press_on ? { press_on: { probabilities: Object.fromEntries(Object.keys(q.press_on.criteria).map((k) => [k, k === "ana" ? 1 : 0])) } } : {}) } } });
    await reactTo(act({ actor: "ana" }), { living, law: living.law, write: w.write, writeCost: w.write, now: NOW, env: { TYPESAFE_API_KEY: "k" }, ask,
      ...(opts.warm ? {} : { present: slow(RING) }), households: async () => lookup, flee: () => {} });
    return w.calls[0];
  };
  const cold = await run({ warm: false });
  assert.deepEqual(payloadOf(cold[0]).ring, ["ana"], "the record says it: the ring read as the actor alone");
  assert.equal(cold.filter((r) => r.action === NERVE_ACTION && payloadOf(r).shield).length, 0);
  __resetRostersForTest();
  const warm = await run({ warm: true });
  assert.deepEqual(payloadOf(warm[0]).ring, ["ana", "bo", "gale"]);
  const landed = warm.filter((r) => r.action === NERVE_ACTION && payloadOf(r).why === "press").map((r) => [r.object, payloadOf(r).by, payloadOf(r).shield ? "shield" : null]);
  assert.deepEqual(landed, [["gale", -2, "shield"]], "the press aimed at ana lands on gale, who shields her");
  // and a house split, when the press lands on a housemate with no shield
  __resetRostersForTest();
  const living = livingWith(lawWith());
  await warmRosters(living, { now: NOW, present: presentOf([["ana", 10], ["bo", 12]]) });
  const w = recordingWrite();
  const ask = async (s, q) => ({ response: { answers: { reaction: { probabilities: { glare: 1 } }, ...(q.press_on ? { press_on: { probabilities: Object.fromEntries(Object.keys(q.press_on.criteria).map((k) => [k, k === "ana" ? 1 : 0])) } } : {}) } } });
  await reactTo(act({ actor: "ana" }), { living, law: living.law, write: w.write, writeCost: w.write, now: NOW, env: { TYPESAFE_API_KEY: "k" }, ask, households: async () => lookup, flee: () => {} });
  assert.deepEqual(w.calls[0].filter((r) => r.action === NERVE_ACTION && payloadOf(r).why === "press").map((r) => [r.object, payloadOf(r).by, payloadOf(r).split_of]),
    [["ana", -1, 2], ["bo", -1, 2]]);
  __resetRostersForTest();
});

// ── F4 ─────────────────────────────────────────────────────────────────────

test("F4: a creature in a room is seen only from inside it: sight verbs say so, who and find leave it out", () => {
  const law = lawWith(walls);
  const living = livingWith(law);
  living.warmRooms([ROOM], "sha");
  const c = living.byId.get(ID);
  assert.equal(seesCreature(law, c, { x: 15, y: 0 }, 60), true);
  assert.equal(seesCreature(law, c, { x: 30, y: 0 }, 60), false, "30 m off, past the wall");
  const callLaw = { ...law, affordedOf: () => [{ action: "call", from: "sight" }] };
  assert.match(whyNot("call", c, 30, { law: callLaw, here: { x: 30, y: 0 } }), /beyond the walls of the room you stand in, out of sight/);
  assert.equal(whyNot("call", c, 15, { law: callLaw, here: { x: 15, y: 0 } }), null);
  assert.deepEqual(creaturesInWho({ living, law }, { x: 30, y: 0 }, { nowMs: NOW }).map((x) => x.id), [], "who from outside its room");
  assert.deepEqual(creaturesInWho({ living, law }, { x: 15, y: 0 }, { nowMs: NOW }).map((x) => x.id), [ID]);
  assert.equal(findCreatures({ living, law }, "creature", { x: 300, y: 0 }, { nowMs: NOW }), null, "a find never shows it through its walls");
  assert.equal(findCreatures({ living, law }, "creature", { x: 15, y: 0 }, { nowMs: NOW })?.[0]?.id, ID);
});

// ── F8 ─────────────────────────────────────────────────────────────────────

test("F8: a finish says what it pays at the settlement, to whom (the first by record order), and when; the finisher is shown what they are owed", async () => {
  const living = new LivingSet({ law: lawWith() }).fold([spawn({ carries: "the-town/a-thing" })])
    .fold([row(ID, "finish", ID, { by: "ren", act: "900" }), row(ID, "finish", ID, { by: "kai", act: "800" })], { advance: false });
  const c = living.byId.get(ID);
  const e = endingSaid(c, NOW);
  assert.equal(e.first, "kai", "the lowest act id, never the row's order");
  assert.equal(e.at, iso(windowAt(NOW).ends));
  assert.match(e.note, /^At the settlement \(18:00Z\), what it carries \(the-town\/a-thing\) goes to kai, the first to finish it, and everyone it answered is named\.$/);
  assert.deepEqual(pendingFor(living, "kai", NOW).map((p) => p.creature), [ID]);
  assert.deepEqual(pendingFor(living, "ren", NOW), []);
  assert.equal(encounterRead({ living }, c, KEEPER, { handle: "kai", now: NOW }).ending.first, "kai");
  // a reaction that finishes says so in its reply
  const fresh = livingWith();
  const w = recordingWrite();
  const [answer] = await reactTo(act({ verb: "call", actor: "kai" }), { living: fresh, law: fresh.law, write: w.write, writeCost: w.write, now: NOW, env: { CREATURE_JUDGE: "code" },
    present: presentOf([["kai", 10]]), households: async () => lookup, flee: () => {}, aimed: fresh.byId.get(ID) });
  assert.equal(answer.finished, true);
  assert.equal(answer.ending.first, "kai");
});

// ── F9 ─────────────────────────────────────────────────────────────────────

test("F9: investigate names both roads and their costs; can shows a strike from sight, with approach first", () => {
  const roads = roadsOf(KEEPER, { nerve: 7 });
  assert.match(roads.force, /^strike it from inside its ring: 2 nerve a strike, and each takes 4 of its 10 resolve$/);
  assert.match(roads.peace, /its own test, which you fill yourself: 2 points/);
  assert.match(roads.nerve, /costs 1 nerve, a strike 2; you have 7\. At 0 you flee until the settlement$/);
  const living = livingWith();
  assert.ok(encounterRead({ living }, living.byId.get(ID), KEEPER, { handle: "kai", now: NOW }).roads.force);
  const pairs = encounterPairs({ here: { x: 60, y: 0 }, actor: "kai", living, law: living.law, now: NOW });
  assert.deepEqual(pairs, [{ verb: "strike", object: ID, approach_first: true }], "60 m off: in sight, outside its 40 m ring");
  const [entry] = encounterEntries(pairs);
  assert.deepEqual([entry.action, entry.creatures, entry.approach_first], ["strike", [], [ID]]);
  assert.match(entry.note, /approach/);
});

// ── F10 and the window ─────────────────────────────────────────────────────

test("F10: a reply carries the ease after the act, and says when it did not move", async () => {
  const living = livingWith();
  const w = recordingWrite();
  const deps = { living, law: living.law, write: w.write, writeCost: w.write, now: NOW, env: { CREATURE_JUDGE: "code" }, present: presentOf([["kai", 10]]), households: async () => lookup, flee: () => {} };
  const [a] = await reactTo(act({ verb: "watch" }), { ...deps, aimed: living.byId.get(ID) });
  assert.deepEqual(a.ease, { yours: 1, of: 2 });
  const [b] = await reactTo(act({ verb: "walk", atIso: iso(NOW + 20_000) }), { ...deps, now: NOW + 20_000 });
  assert.deepEqual(b.ease, { yours: 1, of: 2, note: "this act did not move it" });
});

test("the 10 s window's refusal says when to try again", async () => {
  const living = livingWith(lawWith(), row(ID, "react", "77", { to: "kai", verb: "say", reaction: "glare" }, NOW - 4000));
  living.byId.get(ID).reactions.push({ act: "77", to: "kai", at: NOW - 4000, instant: NOW - 4000 });
  const d = { now: () => NOW, clock: () => NOW, env: { CREATURE_JUDGE: "code" }, freeze: () => null, creatures: async () => ({ living, law: living.law }),
    standpoint: async () => ({ x: 10, y: 0 }), write: async () => { throw new Error("never"); }, answer: async () => [], answerRing: async () => [],
    strikes: async () => [], finish: async () => ({}), flee: () => {} };
  await assert.rejects(worldEncounter({ act: "strike", creature: ID }, { handles: new Set(["kai"]) }, d),
    (e) => e.code === 429 && e.retry_after_s === 6 && /try again in 6 s/.test(e.hint));
});
