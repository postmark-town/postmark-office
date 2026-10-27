// train-takes-main-reads.test.mjs — the read door covers the train's fight and encounter verbs.
//
// The creature-read door (src/creature-verbs.mjs § readCreatureVerb, the 2026-10-24 hotfix) answers
// `read: "<verb>"` for a creature's afforded actions from the same judgment the act uses (whyNot).
// On the train the act door knows more: a fight's own two (dodge, persuade) and an encounter's
// (strike, steady, shield). The rule stays "anything you can do, you can read; a read never performs",
// so the read door must cover them, and only when the act's own gate does:
//
//   · dodge and persuade are routed to the read only when the blessed law knows them (fightsLive);
//   · strike, steady, shield (and the live line) only when it knows an encounter (encountersLive),
//     so `read: "strike"` keeps its current answer until then;
//   · a creature behind its room's walls reads can:false with the act's reason, never can:true;
//   · persuade is once each per household, so its read judges the household the act does.
//
// The kind and its fight are TEST FIXTURES with placeholder words (the set-pieces tests' own).

import { test as nodeTest, afterEach } from "node:test";
import assert from "node:assert/strict";

import { LivingSet, loadCreatureLaw } from "../src/creatures.mjs";
import { windowAt } from "../src/encounter.mjs";
import { PHASE_ACTION, HURL_ACTION, PERSUADE_ACTION } from "../src/set-pieces.mjs";
import { FIGHT_VERBS, creatureEntries, creaturePairs, worldCreature, readCreatureVerb } from "../src/creature-verbs.mjs";
import { ENCOUNTER_CALLS, classOfVerb, encounterEntries, encounterPairs, readEncounterVerb, worldEncounter, worldSpeakFor } from "../src/encounter-verbs.mjs";
import { __setCreaturesForTest } from "../src/creatures-hook.mjs";
import { __setOccupancyForTest } from "../src/creature-sight.mjs";
import { NO_WORLD, worldModuleUrl } from "./fixture-paths.mjs";

const test = (name, fn) => nodeTest(name, { skip: NO_WORLD || false }, fn);

const KIND_TEXT = `kind: fighter
name: a test fighter
ring_m: 40
what: >
  A fixture for the read door's tests.
moods:
  mood: 0..3 = 1 | calm | stirred | eager | wild
reaction notice "it notices": when true says It notices {actor}.
`;
const BASE = NO_WORLD ? null : await loadCreatureLaw({ ref: "the pinned clone", importTool: (f) => import(worldModuleUrl("tools", f)),
  readText: (path) => { if (path !== "WORLD/kinds/fighter.kind") throw new Error(`no fixture at ${path}`); return KIND_TEXT; } });
const reaction = (name, src, says) => ({ name, sentence: name, when: BASE.kindMod.parseCondition(src), src, effects: [{ do: "nothing" }], says });
const FIGHTER = NO_WORLD ? null : {
  ...BASE.kindOf("fighter"), finishable: true, resolve: 40, strike: 2, fight: "fighter.fight.json", ending: "It is itself again. {names} were there.",
  reactions: [reaction("hum", "true", "It hums at {actor}.")],
};
const FIGHT = {
  sanity_max: 12, order: ["feint", "disguise", "unbreakable"], restores: "snack",
  pieces: [
    { piece: "feint", looks: "It glows with a borrowed light.", throws: "a ball of sparks", aims_at: "loudest", flinch_nerve: 3, held: 2, held_by: { watch: 3 },
      answer_min: 30, ends: { hit_points_at: 0.5, sanity_at: 0.5, after_h: 4 } },
    { piece: "disguise", looks: "It looks entirely ordinary.", surrender: "You won. Go home now.", admits: "Fine. You saw me." },
    { piece: "unbreakable", looks: "It blazes.", persuade: { low: 3, high: 8, nerve: 8, story: ["wait like everyone else"] } },
  ],
};
/** The law as the train's world makes it. `fight` and `encounter` take the fight's two verbs and the encounter's three away when false. */
const lawWith = ({ fight = true, encounter = true, walls = false } = {}) => (NO_WORLD ? null : {
  ...BASE, kindOf: (n) => (n === "fighter" ? FIGHTER : null), fightOf: (n) => (n === "fighter" ? FIGHT : null),
  affordedOf: () => [{ action: "watch", from: "sight", who: "anyone", effect: "You watch it." },
    // declared by the class either way: whether the blessed law KNOWS them (kindMod.AFFORDED_VERBS) is what the apex gates on
    { action: "dodge", from: "ring", who: "anyone", effect: "You step out of the way of what it threw.", from_class: "the-town/creature" },
    { action: "persuade", from: "ring", who: "anyone", effect: "You tell it why it should stop.", from_class: "the-town/creature" }],
  afforded: { fighter: [] },
  // a wall at x = 5: a point beyond it is outside the room the creature stands in
  ...(walls ? { inCreatureRing: (p) => Number(p.x) <= 5 } : {}),
  kindMod: { ...BASE.kindMod,
    ENCOUNTER_VERBS: encounter ? ["strike", "steady", "shield"] : undefined,
    AFFORDED_VERBS: fight ? [...BASE.kindMod.AFFORDED_VERBS, "dodge", "persuade"] : BASE.kindMod.AFFORDED_VERBS },
});

const NOW = Date.parse("2026-10-26T08:00:00Z");
const iso = (ms) => new Date(ms).toISOString();
const ID = "creature:fighter-top";
let n = 9000;
const nextId = () => String(++n);
const spawn = () => ({ id: nextId(), at: iso(NOW - 30 * 3600_000), actor: "the-town", action: "spawn", object: ID,
  payload: { kind: "fighter", at: iso(NOW - 30 * 3600_000), stays: true, x: 0, y: 0 } });
const row = (actor, action, object, payload, at = NOW - 60_000) => ({ id: nextId(), at: iso(at), actor, action, object, payload });
const piece = (index) => row(ID, PHASE_ACTION, ID, { piece: FIGHT.pieces[index].piece, index }, NOW - 40 * 60_000);
const hurl = (to) => row(ID, HURL_ACTION, to, { piece: "feint", throws: "a ball of sparks", says: `a test fighter hurls a ball of sparks at ${to}.`,
  until: iso(NOW + 25 * 60_000), window: windowAt(NOW).id }, NOW - 5 * 60_000);
const livingOf = (law, ...rows) => {
  const living = new LivingSet({ law }).fold([spawn()]).fold(rows, { advance: false });
  return living;
};

const ENV = { TYPESAFE_API_KEY: "k" };
const KEY = { handles: new Set(["kai"]), household: "hh:kai" };
const SPOTS = { kai: { x: 10, y: 0 }, ren: { x: 12, y: 0 }, far: { x: 300, y: 0 } };

/** Every collaborator a spy; what any of them was asked to do is on `calls`. */
function seams(law, living, { here = SPOTS.kai } = {}) {
  const calls = { write: [], answer: [], say: [], offer: [], approach: [], others: [] };
  const deps = {
    now: () => NOW, clock: () => NOW, env: ENV, freeze: () => null,
    creatures: async () => ({ living, law }),
    standpoint: async (h) => (h === "kai" ? here : SPOTS[h] ?? null),
    carryingConsumable: async () => false,
    householdOf: async (h) => `solo:${h}`,
    write: async (e) => { calls.write.push(e); return { actId: String(++n), written_at: iso(NOW) }; },
    answer: async (a) => { calls.answer.push(a); return []; },
    say: async (a) => { calls.say.push(a); return { spoke: true }; },
    offer: async (a) => { calls.offer.push(a); return {}; },
    approach: async (a) => { calls.approach.push(a); return {}; },
    others: async (rows) => { calls.others.push(rows); return []; },
    roster: async () => [{ handle: "kai" }, { handle: "ren" }],
  };
  return { deps, calls };
}
const nothingDone = (calls) => Object.values(calls).every((l) => l.length === 0);

/** The apex, with this process's creatures set to `living`, as the gates (fightsLive, encountersLive) read them. */
async function apexWith(living) {
  process.env.WORLD_APEX = "1";
  __setCreaturesForTest(living);
  return import("../src/world-apex.mjs");
}
afterEach(() => __setCreaturesForTest(null));

// ── a fight's own two, when the law knows them ──────────────────────────────

test("persuade and dodge read through the apex once the law knows them: the card quotes the class, persuade takes words, nothing is done", async () => {
  const law = lawWith();
  const living = livingOf(law, piece(2), hurl("kai"));
  const { worldApex } = await apexWith(living);
  const { deps, calls } = seams(law, living);
  const p = await worldApex({ read: "persuade" }, KEY, { creatureDeps: deps });
  assert.equal(p.error, undefined, p.defect);
  assert.equal(p.card.action, "persuade");
  assert.equal(p.card.blurb, "You tell it why it should stop.");
  assert.equal(p.card.blurb_from, "the-town/creature");
  assert.deepEqual(Object.keys(p.card.fields).sort(), ["creature", "handle", "words"]);
  assert.match(p.card.call, /persuade/);
  assert.deepEqual(p.creatures.map((c) => [c.id, c.can]), [[ID, true]]);
  const d = await worldApex({ read: "dodge" }, KEY, { creatureDeps: deps });
  assert.equal(d.error, undefined, d.defect);
  assert.deepEqual(Object.keys(d.card.fields).sort(), ["creature", "handle"]);
  assert.equal(d.creatures[0].can, true, d.creatures[0].why_not);
  // the act's payload is refused by name, as for the afforded six
  const words = await worldApex({ read: "persuade", args: { creature: ID, words: "please" } }, KEY, { creatureDeps: deps });
  assert.match(words.defect, /a read never performs: words/);
  assert.ok(nothingDone(calls), `a read never performs: ${JSON.stringify(calls)}`);
});

test("a fight verb's read says what the act says: dodge only from a feint aimed at you, persuade only in the unbreakable piece, once per household", async () => {
  const law = lawWith();
  const cases = [
    ["dodge", [], /aimed at you to dodge/],
    ["persuade", [], /cannot be persuaded now/],
    ["persuade", [piece(2), row("kai", PERSUADE_ACTION, ID, { household: "solo:kai", words: "stop", window: windowAt(NOW).id })], /your household has persuaded/],
  ];
  const { worldApex } = await apexWith(livingOf(law));
  for (const [verb, rows, why] of cases) {
    const living = livingOf(law, ...rows);
    __setCreaturesForTest(living);
    const { deps } = seams(law, living);
    const r = await worldApex({ read: verb }, KEY, { creatureDeps: deps });
    assert.equal(r.error, undefined, `${verb}: ${r.defect}`);
    assert.equal(r.creatures[0].can, false);
    assert.match(r.creatures[0].why_not, why);
    // the act refuses for the same reason and does nothing
    const act = seams(law, living);
    await assert.rejects(worldCreature({ act: verb, creature: ID, ...(verb === "persuade" ? { words: "stop" } : {}) }, KEY, act.deps), (e) => why.test(e.defect));
    assert.ok(nothingDone(act.calls));
  }
});

test("persuade's read judges the household the act does: a housemate's persuasion this settlement closes it for the whole house", async () => {
  const law = lawWith();
  const living = livingOf(law, piece(2), row("ana", PERSUADE_ACTION, ID, { household: "house:hearth", words: "stop", window: windowAt(NOW).id }));
  const { worldApex } = await apexWith(living);
  const { deps } = seams(law, living);
  const mine = await worldApex({ read: "persuade" }, KEY, { creatureDeps: { ...deps, householdOf: async () => "house:hearth" } });
  assert.equal(mine.creatures[0].can, false);
  const other = await worldApex({ read: "persuade" }, KEY, { creatureDeps: deps });
  assert.equal(other.creatures[0].can, true, "another household is not closed out");
});

test("the bare read's fight cards carry blurb, class and fields, and every advertised fight pair is readable", async () => {
  const law = lawWith();
  const living = livingOf(law, piece(2), hurl("kai"));
  const pairs = creaturePairs({ here: SPOTS.kai, living, law, now: NOW, env: ENV, actor: "kai", household: "solo:kai" });
  assert.deepEqual([...new Set(pairs.map((p) => p.verb))].sort(), ["dodge", "persuade", "watch"].sort());
  const entries = creatureEntries(pairs, { law, living, now: NOW });
  for (const e of entries.filter((x) => FIGHT_VERBS.includes(x.action))) {
    assert.ok(e.blurb.length > 5, `${e.action}: an empty blurb is the bug`);
    assert.equal(e.blurb_from, "the-town/creature");
    assert.ok("creature" in e.fields);
  }
  assert.ok("words" in entries.find((e) => e.action === "persuade").fields);
  const { worldApex } = await apexWith(living);
  for (const { verb, object } of pairs) {
    const { deps } = seams(law, living);
    const r = await worldApex({ read: verb }, KEY, { creatureDeps: deps });
    assert.equal(r.error, undefined, `${verb} is advertised but ${r.defect}`);
    assert.ok(r.creatures.find((c) => c.id === object)?.can, `${verb} on ${object}`);
  }
});

// ── a fight's own two, when the law does not ────────────────────────────────

test("until the law knows the fight's verbs, their reads answer exactly as before: not through the creature read door", async () => {
  const law = lawWith({ fight: false });
  const living = livingOf(law, piece(2), hurl("kai"));
  const { worldApex } = await apexWith(living);
  const { deps, calls } = seams(law, living);
  for (const verb of ["dodge", "persuade"]) {
    const r = await worldApex({ read: verb }, KEY, { creatureDeps: deps });
    assert.equal(r.creatures, undefined, `${verb} is not routed to the creature read`);
    assert.equal(r.error, "bounce");
  }
  // the afforded six are unaffected
  const watch = await worldApex({ read: "watch" }, KEY, { creatureDeps: deps });
  assert.equal(watch.error, undefined, watch.defect);
  assert.equal(watch.creatures[0].can, true);
  assert.ok(nothingDone(calls));
});

// ── an encounter's verbs, when the law knows them ───────────────────────────

test("strike, steady and shield read through the apex once the law knows an encounter: their argument shapes, their rows, nothing done", async () => {
  const law = lawWith();
  const living = livingOf(law);
  const { worldApex } = await apexWith(living);
  const { deps, calls } = seams(law, living);
  const strike = await worldApex({ read: "strike" }, KEY, { creatureDeps: deps });
  assert.equal(strike.error, undefined, strike.defect);
  assert.equal(strike.card.action, "strike");
  assert.ok(strike.card.blurb.length > 10);
  assert.equal(strike.card.blurb_from, "encounter-verbs");
  assert.deepEqual(Object.keys(strike.card.fields).sort(), ["creature", "handle"]);
  assert.equal(strike.card.call, ENCOUNTER_CALLS.strike);
  assert.deepEqual(strike.creatures.map((c) => [c.id, c.can]), [[ID, true]], JSON.stringify(strike.creatures));
  assert.equal(strike.nerve.left, 10);
  for (const verb of ["steady", "shield"]) {
    const r = await worldApex({ read: verb }, KEY, { creatureDeps: deps });
    assert.equal(r.error, undefined, `${verb}: ${r.defect}`);
    assert.deepEqual(Object.keys(r.card.fields).sort(), ["handle", "resident"]);
    assert.deepEqual(r.residents.map((x) => [x.resident, x.can]), [["ren", true]], JSON.stringify(r.residents));
    const one = await worldApex({ read: verb, args: { resident: "ren" } }, KEY, { creatureDeps: deps });
    assert.deepEqual(one.residents.map((x) => [x.resident, x.can]), [["ren", true]]);
    const away = await worldApex({ read: verb, args: { resident: "far" } }, KEY, { creatureDeps: deps });
    assert.equal(away.residents[0].can, false);
    assert.match(away.residents[0].why_not, /not in the same ring/);
    const self = await worldApex({ read: verb, args: { resident: "kai" } }, KEY, { creatureDeps: deps });
    assert.match(self.residents[0].why_not, /yourself/);
  }
  assert.ok(nothingDone(calls), `a read never performs: ${JSON.stringify(calls)}`);
});

test("an encounter read takes the door's own fields and refuses the act's payload and every unknown field by name", async () => {
  const law = lawWith();
  const living = livingOf(law);
  const { worldApex } = await apexWith(living);
  const { deps, calls } = seams(law, living);
  for (const [verb, args, re] of [
    ["strike", { creature: ID, nonce: "n1" }, /a read never performs: nonce/],
    ["strike", { resident: "ren" }, /does not take: resident/],
    ["steady", { creature: ID }, /does not take: creature/],
    ["shield", { resident: "ren", words: "hello" }, /a read never performs: words/],
    ["steady", { resident: "ren", bogus: 1 }, /does not take: bogus/],
  ]) {
    const r = await worldApex({ read: verb, args }, KEY, { creatureDeps: deps });
    assert.equal(r.error, "bounce", verb);
    assert.match(r.defect, re, verb);
  }
  const human = await worldApex({ read: "strike", as: "human" }, KEY, { creatureDeps: deps });
  assert.equal(human.error, "bounce");
  assert.ok(nothingDone(calls));
});

test("the strike read agrees with the door's judgment: out of its ring, short of nerve, or inside the answer window it says can:false", async () => {
  const law = lawWith();
  const { worldApex } = await apexWith(livingOf(law));
  const out = seams(law, livingOf(law), { here: { x: 100, y: 0 } }); // in sight (500 m), outside the 40 m ring
  const far = await worldApex({ read: "strike" }, KEY, { creatureDeps: out.deps });
  assert.equal(far.creatures[0].can, false);
  assert.match(far.creatures[0].why_not, /inside its ring/);
  const spent = livingOf(law, row(ID, "nerve", "kai", { by: -9, why: "press", act: "1", creature: ID }));
  __setCreaturesForTest(spent);
  const weak = await worldApex({ read: "strike" }, KEY, { creatureDeps: seams(law, spent).deps });
  assert.equal(weak.creatures[0].can, false);
  assert.match(weak.creatures[0].why_not, /takes 2 nerve; you have 1/);
});

test("until the law knows an encounter, a read of its verbs answers exactly as before: the closed arena's strike keeps the grant calculus", async () => {
  const law = lawWith({ encounter: false });
  const living = livingOf(law);
  const { worldApex } = await apexWith(living);
  const { deps, calls } = seams(law, living);
  for (const verb of ["strike", "steady", "shield", "speak-for"]) {
    const r = await worldApex({ read: verb }, KEY, { creatureDeps: deps });
    assert.equal(r.error, "bounce", verb);
    assert.equal(r.creatures, undefined, `${verb}: not routed to the encounter read`);
    assert.equal(r.residents, undefined, `${verb}: not routed to the encounter read`);
    assert.doesNotMatch(String(r.defect), /not law yet/, `${verb}: nothing is said of what is coming`);
  }
  // and the door itself, asked directly, is a plain 409 while the law is not blessed
  await assert.rejects(readEncounterVerb("strike", {}, KEY, deps), (e) => e.code === 409);
  // the creature verbs are unaffected
  const watch = await worldApex({ read: "watch" }, KEY, { creatureDeps: deps });
  assert.equal(watch.error, undefined);
  assert.ok(nothingDone(calls));
});

test("the bare read's encounter cards carry blurb, blurb_from, class and fields (the empty-blurb bug stays fixed)", () => {
  const law = lawWith();
  const living = livingOf(law);
  const pairs = encounterPairs({ here: SPOTS.kai, actor: "kai", living, law, residents: [{ handle: "ren", at: SPOTS.ren }], env: ENV });
  const entries = encounterEntries(pairs, { law, living, now: NOW });
  assert.deepEqual(entries.map((e) => e.action), ["strike", "steady", "shield"]);
  for (const e of entries) {
    assert.ok(e.blurb.length > 10, `${e.action}: an empty blurb is the bug`);
    assert.ok(e.blurb_from, e.action);
    assert.equal(e.class, undefined, `${e.action}: no class mark grants it at this law, and a module name is not a class`);
    assert.ok(Object.keys(e.fields).length >= 2, e.action);
  }
  assert.deepEqual(Object.keys(entries[0].fields).sort(), ["creature", "handle"]);
  assert.deepEqual(Object.keys(entries[1].fields).sort(), ["handle", "resident"]);
});

// ── walls ───────────────────────────────────────────────────────────────────

test("a creature behind its room's wall reads can:false with the act's own reason, and the act refuses it: reads and acts agree", async () => {
  const law = lawWith({ walls: true });
  const living = livingOf(law);
  living.byId.get(ID).room = "the-fixture-room"; // what warmRooms sets: it stands inside a room, and its ring stops at the walls
  __setOccupancyForTest(() => new Map([["kai", ["the-fixture-room"]]])); // the resident entered it (WLD-74: a creature in a room exists only for those who did)
  const { worldApex } = await apexWith(living);
  const behind = { x: 30, y: 0 }; // 30 m off, within the 40 m ring as a circle, past the wall at x = 5
  const { deps, calls } = seams(law, living, { here: behind });
  const watch = await worldApex({ read: "watch" }, KEY, { creatureDeps: deps });
  assert.equal(watch.error, undefined, watch.defect);
  assert.equal(watch.creatures[0].can, false);
  assert.match(watch.creatures[0].why_not, /beyond the walls/);
  const act = seams(law, living, { here: behind });
  await assert.rejects(worldCreature({ act: "watch", creature: ID }, KEY, act.deps), (e) => e.code === 409 && /beyond the walls/.test(e.defect));
  assert.ok(nothingDone(act.calls));
  // the same for the fight's and the encounter's verbs
  const living2 = livingOf(law, piece(2));
  living2.byId.get(ID).room = "the-fixture-room";
  __setCreaturesForTest(living2);
  const p = await worldApex({ read: "persuade" }, KEY, { creatureDeps: seams(law, living2, { here: behind }).deps });
  assert.equal(p.creatures[0].can, false);
  assert.match(p.creatures[0].why_not, /beyond the walls/);
  const s = await worldApex({ read: "strike" }, KEY, { creatureDeps: seams(law, living2, { here: behind }).deps });
  assert.equal(s.creatures[0].can, false);
  assert.match(s.creatures[0].why_not, /beyond the walls of the room you stand in, and a strike is from inside its ring/);
  const struck = await worldEncounter({ act: "strike", creature: ID }, KEY, seams(law, living2, { here: behind }).deps).catch((e) => e);
  assert.equal(struck.code, 409);
  assert.equal(s.creatures[0].why_not, struck.defect, "the read says the act's own words");
  // inside the room, the same creature reads can:true
  const inside = await readCreatureVerb("watch", {}, KEY, seams(law, living, { here: { x: 3, y: 0 } }).deps);
  assert.equal(inside.creatures[0].can, true, inside.creatures[0].why_not);
  assert.ok(nothingDone(calls));
  __setOccupancyForTest(null);
});

// ── the strike read and a set piece with no fight file ──────────────────────

test("a strike on a set-piece creature whose fight file is not law reads can:false with the act's reason, and the act refuses it with the same words", async () => {
  const law = { ...lawWith(), fightOf: () => null }; // the kind says fight: but the blessed ref has no such file
  const living = livingOf(law);
  const { worldApex } = await apexWith(living);
  const { deps, calls } = seams(law, living);
  const r = await worldApex({ read: "strike" }, KEY, { creatureDeps: deps });
  assert.equal(r.error, undefined, r.defect);
  assert.equal(r.creatures[0].can, false);
  assert.match(r.creatures[0].why_not, /fight cannot be read here/);
  const act = seams(law, living);
  const refused = await worldEncounter({ act: "strike", creature: ID }, KEY, act.deps).catch((e) => e);
  assert.equal(refused.code, 409);
  assert.equal(r.creatures[0].why_not, refused.defect, "read and act say the same words");
  assert.ok(nothingDone(calls) && nothingDone(act.calls));
  // with its fight file in the law, the same strike reads can:true
  const ok = await readEncounterVerb("strike", {}, KEY, seams(lawWith(), living).deps);
  assert.equal(ok.creatures[0].can, true, ok.creatures[0].why_not);
});

// ── the read cards' class ────────────────────────────────────────────────────

test("an encounter card's class is the class mark that grants the verb, and is left off when no mark does (never a module name)", async () => {
  const law = lawWith();
  const living = livingOf(law);
  assert.equal(classOfVerb(law, "strike"), null);
  const granting = { ...law, afforded: { fighter: [{ action: "strike", from_class: "the-town/creature", who: "anyone", from: "ring", effect: "x" }] } };
  assert.equal(classOfVerb(granting, "strike"), "the-town/creature");
  const pairs = encounterPairs({ here: SPOTS.kai, actor: "kai", living, law, residents: [{ handle: "ren", at: SPOTS.ren }], env: ENV });
  const entries = encounterEntries(pairs, { law: granting, living, now: NOW });
  assert.equal(entries.find((e) => e.action === "strike").class, "the-town/creature");
  assert.equal(entries.find((e) => e.action === "steady").class, undefined, "only the verb a mark grants");
  const read = await readEncounterVerb("strike", {}, KEY, seams(granting, living).deps);
  assert.equal(read.card.class, "the-town/creature");
  assert.equal(read.card.terms.binds.class, "the-town/creature");
  const bare = await readEncounterVerb("strike", {}, KEY, seams(law, living).deps);
  assert.equal(bare.card.class, undefined);
  assert.equal(bare.card.terms.binds.class, undefined);
});

// ── speak-for ───────────────────────────────────────────────────────────────

const TEMPTER = NO_WORLD ? null : { ...BASE.kindOf("fighter"), finishable: true, resolve: 40, strike: 2, tempts: "tempter.menu.json", who: "tess" };
const tempterLaw = ({ lint = true } = {}) => (NO_WORLD ? null : { ...lawWith(), kindOf: (n) => (n === "fighter" ? TEMPTER : null), fightOf: () => null,
  temptsMod: lint ? { lintWhisper: () => ({ ok: true }), TEMPT_ACTS: ["walk"] } : {} });
const TESS = { handles: new Set(["tess"]), household: "hh:tess" }; // the one who speaks for it; she has no standpoint, sight or nerve in these seams

test("speak-for reads what the live door judges: who speaks for it, and who stands in its ring; no standpoint, sight or nerve of the speaker", async () => {
  const law = tempterLaw();
  const living = livingOf(law);
  const { deps } = seams(law, living); // tess has no standpoint here: the door never asks for it
  // bare: every creature that tempts, judged by who speaks for it (the ring needs a resident)
  const bare = await readEncounterVerb("speak-for", {}, TESS, deps);
  assert.deepEqual(bare.creatures.map((c) => [c.id, c.can]), [[ID, true]], JSON.stringify(bare.creatures));
  assert.equal(bare.residents, undefined, "not the steady/shield rows");
  assert.equal(bare.card.action, "speak-for");
  assert.deepEqual(Object.keys(bare.card.fields).sort(), ["creature", "handle", "resident", "text"]);
  const notHer = await readEncounterVerb("speak-for", {}, KEY, deps);
  assert.equal(notHer.creatures[0].can, false);
  const act403 = await worldSpeakFor({ creature: ID, resident: "ren", text: "hello" }, KEY, seams(law, living).deps).catch((e) => e);
  assert.equal(act403.code, 403);
  assert.equal(notHer.creatures[0].why_not, act403.defect, "the read says the act's own words");
  // creature + resident: the ring, and the act's own words
  for (const [resident, can] of [["ren", true], ["far", false]]) {
    const r = await readEncounterVerb("speak-for", { creature: ID, resident }, TESS, deps);
    assert.deepEqual(r.creatures.map((c) => [c.id, c.resident, c.can]), [[ID, resident, can]], JSON.stringify(r.creatures));
    const act = seams(law, living);
    const done = await worldSpeakFor({ creature: ID, resident, text: "hello" }, TESS, { ...act.deps, jevLint: async () => true, writeLive: async () => ({ rows: [] }) }).catch((e) => e);
    if (can) assert.equal(done.said, true, "the act agrees: it speaks");
    else { assert.equal(done.code, 409); assert.equal(r.creatures[0].why_not, done.defect); }
  }
  // a resident alone: judged against every creature that tempts
  const one = await readEncounterVerb("speak-for", { resident: "ren" }, TESS, deps);
  assert.deepEqual(one.creatures.map((c) => [c.id, c.resident, c.can]), [[ID, "ren", true]]);
});

test("speak-for reads can:false with the act's words when the law has no whisper-lint, and 404 when no creature that tempts is out", async () => {
  const lawNoLint = tempterLaw({ lint: false });
  const living = livingOf(lawNoLint);
  const r = await readEncounterVerb("speak-for", { creature: ID, resident: "ren" }, TESS, seams(lawNoLint, living).deps);
  assert.equal(r.creatures[0].can, false);
  const act = await worldSpeakFor({ creature: ID, resident: "ren", text: "hello" }, TESS, seams(lawNoLint, living).deps).catch((e) => e);
  assert.equal(act.code, 409);
  assert.equal(r.creatures[0].why_not, act.defect);
  assert.match(act.defect, /not law yet/);
  // a creature that does not tempt: the act says 404, and so does the read
  const plain = lawWith();
  const living2 = livingOf(plain);
  const gone = await readEncounterVerb("speak-for", { creature: ID }, TESS, seams(plain, living2).deps).catch((e) => e);
  assert.equal(gone.code, 404);
  const actGone = await worldSpeakFor({ creature: ID, resident: "ren", text: "hi" }, TESS, seams(plain, living2).deps).catch((e) => e);
  assert.equal(gone.defect, actGone.defect);
});
