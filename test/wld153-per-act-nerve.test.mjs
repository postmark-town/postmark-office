// wld153-per-act-nerve.test.mjs — every act that spends nerve says what it spent and what is left (WLD-153).
//
// Wright 2026-11-06 23:50Z and 23:56:08Z: "one plain-words string at the top of every ring act's answer, saying the
// nerve it spent and the nerve left, for all act kinds. Keep the existing nerve objects, don't change charges, and
// don't fabricate reaction entries." The carrier is `nerve_said`. Three seams carry it, all from encounter.mjs §
// nerveSpentSaid (the actor's own cost rows for that act, and nerveOf after it):
//   · a ring act the hook answers (creatures-hook.mjs § creaturesAnswer): say, take, walk and the rest
//   · an act aimed at a creature (creature-verbs.mjs § aimAt): watch, shoo, call, approach, whisper, offer, dodge
//   · strike, steady and shield (encounter-verbs.mjs)
// Persuade's own cost is driven in test/set-pieces.test.mjs. Invented creatures, residents and things throughout.

import { test as nodeTest } from "node:test";
import assert from "node:assert/strict";

import { LivingSet, loadCreatureLaw, reactTo } from "../src/creatures.mjs";
import { nerveOf, nerveSpentSaid, windowAt } from "../src/encounter.mjs";
import { worldEncounter } from "../src/encounter-verbs.mjs";
import { worldCreature } from "../src/creature-verbs.mjs";
import { __setCreaturesForTest, creaturesAnswer } from "../src/creatures-hook.mjs";
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
  ...BASE.kindOf("keeper"), finishable: true, resolve: 10, strike: 4,
  reactions: [
    reaction("glare", `act.verb == "say"`, [{ do: "press", n: 2, on: ["actor"] }], "It glares."),
    reaction("regard", `act.verb == "watch"`, [{ do: "nothing" }], "It regards {actor}."),
    reaction("bristle", `act.verb == "strike"`, [{ do: "nothing" }], "It bristles."),
  ],
};
const PLAIN = NO_WORLD ? null : { ...BASE.kindOf("keeper"), reactions: [reaction("notice", `act.verb == "say"`, [{ do: "nothing" }], "It notices {actor}.")] };
const lawWith = () => ({
  ...BASE, kindOf: (n) => (n === "keeper" ? KEEPER : n === "plain" ? PLAIN : null),
  afforded: { keeper: [] }, affordedOf: () => [{ action: "watch", from: "ring" }],
  kindMod: { ...BASE.kindMod, ENCOUNTER_VERBS: ["strike", "steady", "shield"], PRESS_ON, AFFORDED_VERBS: [...BASE.kindMod.AFFORDED_VERBS, "watch"] },
});
const NOW = Date.parse("2026-10-26T13:00:00Z");
const iso = (ms) => new Date(ms).toISOString();
const ID = "creature:keeper-den", PLAIN_ID = "creature:plain-den";
let n = 40000;
const nextId = () => String(++n);
const spawn = (id = ID, kind = "keeper", x = 0) => ({ id: nextId(), at: iso(NOW - 3600_000), actor: "the-town", action: "spawn", object: id,
  payload: { kind, at: iso(NOW - 3600_000), stays: true, x, y: 0 } });
const nerveRow = (object, by, why = "act", actId = nextId(), at = NOW - 60_000) => ({ id: nextId(), at: iso(at), actor: ID, action: "nerve", object,
  payload: { by, why, act: String(actId), creature: ID, window: windowAt(NOW).id } });
const livingWith = (...rows) => new LivingSet({ law: lawWith() }).fold([spawn(), spawn(PLAIN_ID, "plain", 5000)]).fold(rows, { advance: false });
const HOMES = {};
const lookup = (h) => (HOMES[h] ? HOMES[h] : { key: `solo:${h}`, slug: null, residents: [h] });
const presentOf = (list) => async () => ({ residents: list.map(([handle, distance_m]) => ({ handle, distance_m })) });
let rowId = 70000;
const store = () => async (rows) => ({ prior: false, rows: rows.map((r) => ({ id: String(++rowId), at: r.written_at, actor: r.actor, action: r.action, object: r.object, payload: r.payload })) });
const penRow = (over = {}) => ({ actor: "kai", action: "say", object: null, at_anchor: "the-town/let-there-be-light", at_dx: 10, at_dy: 0, class: "voice",
  payload: JSON.stringify({ text: "hello" }), written_at: iso(NOW), id: nextId(), ...over });
const hookDeps = (over = {}) => ({ centreOf: () => null, around: async () => ({}), write: store(), writeCost: store(), env: { CREATURE_JUDGE: "code" },
  present: presentOf([["kai", 10]]), households: async () => lookup, flee: () => {}, ...over });
const SAID = /^That cost you (\d+) nerve(?:, and the creature's press took (\d+) more)?; you have (\d+) of 10 left\./;

// ── the helper, from the record ─────────────────────────────────────────────

test("nerveSpentSaid: the actor's own cost rows for that act, apart from a press; nothing for a free act; flee at 0", () => {
  const act = "9001";
  const living = livingWith(nerveRow("kai", -1, "act", act), nerveRow("kai", -2, "press", act), nerveRow("mo", -1, "act", act), nerveRow("kai", -1, "act", "9002"));
  assert.equal(nerveSpentSaid(living, "kai", act, NOW), "That cost you 1 nerve, and the creature's press took 2 more; you have 6 of 10 left.", "left is the whole record's: 10 - 1 - 2 - 1 (another act's cost)");
  assert.equal(nerveSpentSaid(living, "kai", "7777", NOW), null, "an act with no cost row carries no line");
  assert.equal(nerveSpentSaid(livingWith(nerveRow("kai", -2, "press", act)), "kai", act, NOW), null, "a press alone is not the act's own cost");
  const spent = livingWith(nerveRow("kai", -9, "press"), nerveRow("kai", -1, "act", act));
  assert.match(nerveSpentSaid(spent, "kai", act, NOW), /you have 0 of 10 left\. Your nerve is gone: you flee, and stay out until the settlement\.$/);
});

// ── a ring act the hook answers ─────────────────────────────────────────────

test("a say in the ring: the cost and the press it drew, and what is left, beside the creature's line (charges unchanged)", async () => {
  const living = livingWith();
  __setCreaturesForTest(living);
  const out = await creaturesAnswer([penRow()], { did: "say" }, hookDeps());
  assert.equal(out.creatures[0].reaction, "glare");
  assert.equal(Object.keys(out)[0], "nerve_said", "at the top of the answer");
  assert.equal(out.nerve_said, "That cost you 1 nerve, and the creature's press took 2 more; you have 7 of 10 left.");
  assert.equal(nerveOf(living, "kai", Date.now()), 7, "the charges are the record's own: 1 for the act, 2 for the press");
  __setCreaturesForTest(null);
});

test("a charged act with NO creature reaction (a take): the line is there, and no creature entry is made up", async () => {
  const living = livingWith();
  __setCreaturesForTest(living);
  const out = await creaturesAnswer([penRow({ action: "take", class: "holding", payload: "{}" })], { did: "take" }, hookDeps());
  assert.equal(out.creatures, undefined, "nothing answered, and nothing is invented");
  assert.equal(out.nerve_said, "That cost you 1 nerve; you have 9 of 10 left.");
  __setCreaturesForTest(null);
});

test("controls: out of every ring, a creature already gone, a resident already spent, a refused act: no line", async () => {
  __setCreaturesForTest(livingWith());
  const far = await creaturesAnswer([penRow({ at_dx: 900 })], { did: "say" }, hookDeps());
  assert.equal("nerve_said" in far, false, "out of ring");
  const plainLiving = livingWith();
  plainLiving.byId.get(ID).gone = "fled";
  __setCreaturesForTest(plainLiving);
  const gone = await creaturesAnswer([penRow()], { did: "say" }, hookDeps());
  assert.equal("nerve_said" in gone, false, "the only creature in the ring is gone");
  __setCreaturesForTest(livingWith(nerveRow("kai", -10, "press", nextId(), Date.now())));
  const spent = await creaturesAnswer([penRow()], { did: "say" }, hookDeps());
  assert.equal("nerve_said" in spent, false, "already at 0: nothing more to spend");
  __setCreaturesForTest(livingWith());
  const refused = await creaturesAnswer([penRow()], { error: "bounce", defect: "no" }, hookDeps());
  assert.deepEqual(refused, { error: "bounce", defect: "no" }, "a refused act is returned as it was");
  __setCreaturesForTest(null);
});

test("exhaustion: the act that takes the last nerve says so, and the flee is the one the record already makes", async () => {
  const living = livingWith(nerveRow("kai", -8, "press", nextId(), Date.now()));
  __setCreaturesForTest(living);
  const fled = [];
  const out = await creaturesAnswer([penRow({ action: "take", class: "holding", payload: "{}" })], { did: "take" }, hookDeps({ flee: (h) => fled.push(h) }));
  assert.equal(out.nerve_said, "That cost you 1 nerve; you have 1 of 10 left.");
  const last = await creaturesAnswer([penRow({ action: "take", class: "holding", payload: "{}" })], { did: "take" }, hookDeps({ flee: (h) => fled.push(h) }));
  assert.equal(last.nerve_said, "That cost you 1 nerve; you have 0 of 10 left. Your nerve is gone: you flee, and stay out until the settlement.");
  assert.deepEqual(fled, ["kai"]);
  __setCreaturesForTest(null);
});

// ── an act aimed at a creature ──────────────────────────────────────────────

function door(living, here = { x: 10, y: 0 }) {
  let next = 900;
  const deps = {
    now: () => NOW, clock: () => NOW, env: { CREATURE_JUDGE: "code" }, freeze: () => null,
    creatures: async () => ({ living, law: living.law }), standpoint: async () => here,
    householdOf: async () => "hh:kai", carryingConsumable: async () => false,
    write: async () => ({ actId: String(++next + 8000), written_at: iso(NOW) }),
    answer: async (act, d2) => reactTo(act, { ...d2, env: { CREATURE_JUDGE: "code" }, now: NOW, clock: () => NOW, around: async () => ({}), heardFor: async () => null,
      write: store(), writeCost: store(), present: presentOf([["kai", 10]]), households: async () => lookup, flee: () => {} }),
    others: async () => [],
  };
  return (args) => worldCreature(args, { handles: new Set(["kai"]), household: "hh:kai" }, deps);
}

test("a watch aimed at the creature: its cost and what is left, first in the reply, beside the reaction", async () => {
  const living = livingWith();
  const out = await door(living)({ act: "watch", creature: ID });
  assert.equal(out.reaction.reaction, "regard");
  assert.equal(Object.keys(out)[0], "nerve_said");
  assert.equal(out.nerve_said, "That cost you 1 nerve; you have 9 of 10 left.");
  const free = await door(livingWith(nerveRow("kai", -10, "press")))({ act: "watch", creature: ID });
  assert.equal("nerve_said" in free, false, "a resident with nothing left spends nothing");
});

// ── strike, steady, shield ──────────────────────────────────────────────────

function encounterDoor(living) {
  const written = [];
  return { written, run: (args) => worldEncounter(args, { handles: new Set(["kai"]), household: null }, {
    now: () => NOW, clock: () => NOW, env: { CREATURE_JUDGE: "code" }, freeze: () => null,
    creatures: async () => ({ living, law: living.law }),
    standpoint: async (h) => (h === "kai" ? { x: 10, y: 0 } : { x: 12, y: 0 }),
    write: async (entry, key, { guard }) => {
      // the guards' own queries, answered from the living set (as test/encounter.test.mjs § strikeDeps does)
      const client = { query: async (sql) => (/action IN/.test(sql) ? { rows: living.encounter.map((r) => ({ ...r })) } : { rows: [] }) };
      await guard(client);
      const id = nextId();
      written.push({ id, ...entry });
      return { actId: id, written_at: iso(NOW) };
    },
    answer: async () => [], answerRing: async () => [], finish: async () => ({ written: true, id: nextId() }), flee: () => {},
    strikes: async () => [],
  }) };
}

test("strike, steady and shield: each says what it spent and what is left, first in the reply; the nerve objects stay as they were", async () => {
  const living = livingWith(nerveRow("ren", -5, "press"));
  const d = encounterDoor(living);
  const strike = await d.run({ act: "strike", creature: ID });
  assert.equal(Object.keys(strike)[0], "nerve_said");
  assert.equal(strike.nerve_said, "That cost you 2 nerve; you have 8 of 10 left.");
  assert.deepEqual(strike.nerve, { left: 8, of: 10 });
  const steady = await d.run({ act: "steady", resident: "ren" });
  assert.equal(steady.nerve_said, "That cost you 1 nerve; you have 7 of 10 left.");
  assert.deepEqual(steady.nerve, { left: 7, of: 10 });
  const shield = await d.run({ act: "shield", resident: "ren" });
  assert.equal(shield.nerve_said, "That cost you 1 nerve; you have 6 of 10 left.");
  assert.deepEqual(shield.nerve, { left: 6, of: 10 });
  assert.deepEqual(d.written.map((w) => w.payload.cost), [2, 1, 1], "the charges are unchanged");
});

test("a strike that takes the last nerve says so; a refused strike (not enough nerve) carries no line", async () => {
  const d = encounterDoor(livingWith(nerveRow("kai", -8, "press")));
  const last = await d.run({ act: "strike", creature: ID });
  assert.equal(last.nerve_said, "That cost you 2 nerve; you have 0 of 10 left. Your nerve is gone: you flee, and stay out until the settlement.");
  assert.equal(last.fled.length > 0, true);
  const short = encounterDoor(livingWith(nerveRow("kai", -9, "press")));
  await assert.rejects(short.run({ act: "strike", creature: ID }), (e) => e.code === 409 && !("nerve_said" in e));
  assert.equal(short.written.length, 0);
});
