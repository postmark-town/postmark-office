// set-pieces.test.mjs — a creature whose fight runs in set pieces, the office half
// (src/set-pieces.mjs; src/creatures.mjs § fightTurn, fightRows, advanceFight,
// unmaskFight; src/encounter-verbs.mjs § strike and encounterTick; src/creature-verbs.mjs
// § dodge and persuade; src/creatures-read.mjs § fightRead; world2/tools/creature-endings.mjs
// § planFightEnding).
//
// RULED (WLD-25, 2026-10-22): two shown bars, hit points and sanity, reset at each
// settlement; the set pieces in the fight file's order, the one reached persisting;
// feints answered by the target's next act in the ring (a dodge, a walk or an exit
// flinches, anything else holds, none lapses); a disguise that withholds the bars and is
// broken by the first strike or look from inside the ring; an unbreakable form a strike
// cannot wear, and persuade once per household per settlement, scored by Jev and clamped
// by code; the ending at a settlement where sanity is full, turning the class its fight
// names back on. The office never says anything untrue, and never that the fight is over
// before its ending.
//
// The kind and its fight are TEST FIXTURES with placeholder words, dressed as the world's
// grammar parses them (tools/creature-fight.mjs on postmark-world).

import { test as nodeTest } from "node:test";
import assert from "node:assert/strict";

import { LivingSet, loadCreatureLaw, reactTo, advanceFight, unmaskFight } from "../src/creatures.mjs";
import { NERVE_ACTION, nerveOf, windowAt } from "../src/encounter.mjs";
import {
  PHASE_ACTION, HURL_ACTION, HURLED_ACTION, SANITY_ACTION, UNMASKED_ACTION, PERSUADE_ACTION, LINE_ACTION, GLANCES,
  pieceOf, sanityOf, barsOf, nextPiece, openHurls, answerOf, STRIKE_UNDER_FEINT, persuadeScore, repeats, persuadedThisWindow,
} from "../src/set-pieces.mjs";
import { encounterTick, settleResolve, worldEncounter, __resetEncounterTickForTest } from "../src/encounter-verbs.mjs";
import { whyNot, persuadeGuard, PERSUADED_SQL } from "../src/creature-verbs.mjs";
import { creaturesInWho, creatureToYou, investigateCreature } from "../src/creatures-read.mjs";
import { planFightEnding, fightSanity } from "../world2/tools/creature-endings.mjs";
import { NO_WORLD, worldModuleUrl } from "./fixture-paths.mjs";

const test = (name, fn) => nodeTest(name, { skip: NO_WORLD || false }, fn);

const KIND_TEXT = `kind: fighter
name: a test fighter
ring_m: 40
what: >
  A fixture for the set pieces' tests.
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
/** The fight as the world's parseFight answers it. */
const FIGHT = {
  sanity_max: 12, order: ["feint", "disguise", "unbreakable"], restores: "snack",
  pieces: [
    { piece: "feint", looks: "It glows with a borrowed light.", throws: "a ball of sparks", aims_at: "loudest", flinch_nerve: 3, held: 2, held_by: { watch: 3 },
      answer_min: 30, ends: { hit_points_at: 0.5, sanity_at: 0.5, after_h: 4 } },
    { piece: "disguise", looks: "It looks entirely ordinary.", surrender: "You won. Go home now.", admits: "Fine. You saw me." },
    { piece: "unbreakable", looks: "It blazes.", persuade: { low: 3, high: 8, nerve: 8, story: ["wait like everyone else"] } },
  ],
};
const lawWith = (fight = FIGHT) => (NO_WORLD ? null : {
  ...BASE, kindOf: (n) => (n === "fighter" ? FIGHTER : null), fightOf: (n) => (n === "fighter" ? fight : null),
  affordedOf: () => [{ action: "watch", from: "sight" }, { action: "dodge", from: "ring" }, { action: "persuade", from: "ring" }], afforded: { fighter: [] },
  kindMod: { ...BASE.kindMod, ENCOUNTER_VERBS: ["strike", "steady", "shield"], AFFORDED_VERBS: [...BASE.kindMod.AFFORDED_VERBS, "dodge", "persuade"] },
});

const NOW = Date.parse("2026-10-26T08:00:00Z"); // two hours into the window 06:00 → 18:00Z
const W = windowAt(NOW);
const iso = (ms) => new Date(ms).toISOString();
const ID = "creature:fighter-top";
let n = 9000;
const nextId = () => String(++n);
const spawn = () => ({ id: nextId(), at: iso(NOW - 30 * 3600_000), actor: "the-town", action: "spawn", object: ID,
  payload: { kind: "fighter", at: iso(NOW - 30 * 3600_000), stays: true, x: 0, y: 0 } });
const row = (actor, action, object, payload, at = NOW - 60_000) => ({ id: nextId(), at: iso(at), actor, action, object, payload });
const phase = (index, at = NOW - 60_000, extra = {}) => row(ID, PHASE_ACTION, ID, { piece: FIGHT.pieces[index].piece, index, ...extra }, at);
const sanity = (on, by, at = NOW - 60_000) => row(ID, SANITY_ACTION, on, { by, why: "held" }, at);
const strike = (by, damage = 2, at = NOW - 60_000) => row(by, "strike", ID, { cost: 2, damage }, at);
const actCost = (on, at = NOW - 60_000) => row(ID, NERVE_ACTION, on, { by: -1, why: "act", act: "1", creature: ID }, at);
const hurl = (to, at = NOW - 5 * 60_000) => row(ID, HURL_ACTION, to, { piece: "feint", throws: "a ball of sparks", says: `a test fighter hurls a ball of sparks at ${to}.`, until: iso(at + 30 * 60_000), window: windowAt(at).id }, at);
const livingWith = (law = lawWith(), ...rows) => new LivingSet({ law }).fold([spawn()]).fold(rows, { advance: false });
const HOMES = { ana: "hearth", bo: "hearth" };
const lookup = (h) => (HOMES[h] ? { key: "house:hearth", slug: "hearth" } : { key: `solo:${h}`, slug: null });
const present = (list) => async () => ({ residents: list.map(([handle, distance_m]) => ({ handle, distance_m })) });
const payloadOf = (r) => (typeof r.payload === "string" ? JSON.parse(r.payload) : r.payload);
const RING = [["kai", 10], ["ren", 12], ["ana", 14], ["bo", 16]];
const ROSTER = RING.map(([handle, distance_m]) => ({ handle, distance_m, household: lookup(handle).key, slug: lookup(handle).slug, human: `human-of-${lookup(handle).slug ?? handle}`, nerve: 10 }));
function recordingWrite() {
  const calls = [];
  return { calls, write: async (rows) => { calls.push(rows); return { prior: false, rows: rows.map((r) => ({ id: nextId(), at: r.written_at, actor: r.actor, action: r.action, object: r.object, payload: r.payload })) }; } };
}
const onceWrite = () => {
  const calls = [];
  return { calls, write: async (rows) => { calls.push(rows); return { rows: rows.map((r) => ({ id: nextId(), at: r.written_at, actor: r.actor, action: r.action, object: r.object, payload: r.payload })) }; } };
};
const turnDeps = (living, over = {}) => {
  const w = recordingWrite(), o = onceWrite();
  return { w, o, d: { living, law: living.law, write: w.write, writeCost: w.write, writeOnce: o.write, now: NOW, env: { CREATURE_JUDGE: "code" },
    present: present(RING), households: async () => lookup, flee: () => {}, ...over } };
};
const act = (over = {}) => ({ actor: "kai", verb: "walk", actId: nextId(), atIso: iso(NOW), point: { x: 10, y: 0 }, ...over });
const rowsOf = (w, action) => w.calls.flat().filter((r) => r.action === action);

// ── the set piece, the bars ────────────────────────────────────────────────

test("the set piece reached persists across windows; both bars reset at the settlement; sanity starts at 0 when the unbreakable piece begins", () => {
  const yesterday = W.start - 3600_000;
  const living = livingWith(lawWith(), phase(1, yesterday), sanity("kai", 4, yesterday), strike("kai", 2, yesterday));
  const c = living.byId.get(ID);
  assert.equal(pieceOf(c, FIGHT, NOW).piece, "disguise", "the piece reached in an earlier window holds");
  assert.deepEqual(barsOf(living, c, FIGHTER, FIGHT, NOW), { hit_points: { left: 40, of: 40 }, sanity: { now: 0, of: 12 } }, "both bars are this window's");
  const unbreakable = livingWith(lawWith(), sanity("kai", 5, NOW - 50 * 60_000), phase(2, NOW - 40 * 60_000), sanity("ren", 3, NOW - 30 * 60_000));
  const e = unbreakable.byId.get(ID);
  assert.equal(sanityOf(unbreakable, e, FIGHT, NOW), 3, "what came before the unbreakable piece began in this window does not count");
  assert.equal(barsOf(unbreakable, e, FIGHTER, FIGHT, NOW).hit_points.unbreakable, true);
  const full = livingWith(lawWith(), phase(2, NOW - 40 * 60_000), sanity("kai", 20, NOW - 30 * 60_000));
  assert.equal(sanityOf(full, full.byId.get(ID), FIGHT, NOW), 12, "never above its most");
});

test("the feints end at half its hit points, or half its sanity, or 4 h into the window; a disguise when it is broken; the last piece never", () => {
  const at = (h) => W.start + h * 3600_000;
  const quiet = livingWith();
  assert.equal(nextPiece(quiet, quiet.byId.get(ID), FIGHTER, FIGHT, at(2)), null);
  assert.deepEqual(nextPiece(quiet, quiet.byId.get(ID), FIGHTER, FIGHT, at(4.1)), { index: 1, why: "the clock" });
  const worn = livingWith(lawWith(), ...Array.from({ length: 10 }, () => strike("kai", 2, at(1))));
  assert.deepEqual(nextPiece(worn, worn.byId.get(ID), FIGHTER, FIGHT, at(2)), { index: 1, why: "hit points" }, "20 of 40 left");
  const calm = livingWith(lawWith(), sanity("kai", 6, at(1)));
  assert.deepEqual(nextPiece(calm, calm.byId.get(ID), FIGHTER, FIGHT, at(2)), { index: 1, why: "sanity" }, "6 of 12");
  const disguised = livingWith(lawWith(), phase(1, at(1)));
  assert.equal(nextPiece(disguised, disguised.byId.get(ID), FIGHTER, FIGHT, at(20)), null, "a disguise has no clock");
  const broken = livingWith(lawWith(), phase(1, at(1)), row(ID, UNMASKED_ACTION, "ren", { by: "1", verb: "strike" }, at(1.5)));
  assert.deepEqual(nextPiece(broken, broken.byId.get(ID), FIGHTER, FIGHT, at(2)), { index: 2, why: "unmasked", by: "ren" });
  const last = livingWith(lawWith(), phase(2, at(1)));
  assert.equal(nextPiece(last, last.byId.get(ID), FIGHTER, FIGHT, at(11)), null);
});

test("entering the disguise writes its piece once and says its surrender to everyone in the ring; breaking it says its admission to the breaker", async () => {
  const living = livingWith(lawWith(), sanity("kai", 6, NOW - 30 * 60_000));
  const c = living.byId.get(ID);
  const o = onceWrite();
  const moved = await advanceFight(c, FIGHTER, FIGHT, { living, now: NOW, roster: ROSTER, write: o.write });
  assert.equal(moved.piece, "disguise");
  const [rows] = o.calls;
  assert.deepEqual(rows.map((r) => [r.action, r.object]), [[PHASE_ACTION, ID], ...ROSTER.map((r) => [LINE_ACTION, r.handle])]);
  assert.ok(rows.slice(1).every((r) => payloadOf(r).says === "You won. Go home now."), "its own line, said as its own");
  assert.equal(pieceOf(c, FIGHT, NOW).piece, "disguise");
  assert.equal(await advanceFight(c, FIGHTER, FIGHT, { living, now: NOW + 1000, roster: ROSTER, write: o.write }), null, "once");
  const un = await unmaskFight(c, FIGHTER, FIGHT, { by: "ren", verb: "investigate", living, now: NOW + 60_000, roster: ROSTER, write: o.write });
  assert.equal(un.piece, "unbreakable");
  const last = o.calls.at(-1);
  assert.deepEqual(last.map((r) => [r.action, r.object, payloadOf(r).says ?? payloadOf(r).piece]), [[PHASE_ACTION, ID, "unbreakable"], [LINE_ACTION, "ren", "Fine. You saw me."]]);
  assert.equal(o.calls.at(-2)[0].action, UNMASKED_ACTION);
  assert.equal(await unmaskFight(c, FIGHTER, FIGHT, { by: "kai", verb: "strike", living, now: NOW + 120_000, roster: ROSTER, write: o.write }), null, "broken once");
});

// ── feints ──────────────────────────────────────────────────────────────

test("a reaction in the feints carries one feint at the loudest; the office says only that it was hurled; the target's next read says so too", async () => {
  const living = livingWith(lawWith(), actCost("ren", NOW - 5 * 60_000), actCost("ren", NOW - 4 * 60_000), actCost("kai", NOW - 3 * 60_000));
  const { w, d } = turnDeps(living);
  const [answer] = await reactTo(act(), d);
  const h = rowsOf(w, HURL_ACTION);
  assert.equal(h.length, 1);
  assert.equal(h[0].object, "ren", "the loudest this window");
  assert.equal(payloadOf(h[0]).until, iso(NOW + 30 * 60_000));
  assert.deepEqual(answer.hurls, { at: "ren", says: "a test fighter hurls a ball of sparks at ren." });
  assert.doesNotMatch(JSON.stringify(answer), /hurt|harm|damage|burn/i, "never that it will hurt");
  const toRen = creatureToYou({ living, law: living.law }, "ren", { sinceMs: NOW - 60_000, nowMs: NOW + 1000 });
  assert.equal(toRen.events.find((e) => e.hurls)?.hurls, "a test fighter hurls a ball of sparks at ren.");
  // one at a time: ren holds an open one, so the next aims elsewhere
  const second = turnDeps(living, { now: NOW + 20_000 });
  await reactTo(act({ actor: "ana", actId: nextId(), atIso: iso(NOW + 20_000) }), second.d);
  assert.notEqual(rowsOf(second.w, HURL_ACTION)[0]?.object, "ren");
});

test("the target's next act in the ring answers it: dodge, walk or exit flinch (nerve); anything else holds (sanity, watch more); an act before it never does", async () => {
  assert.deepEqual(answerOf("dodge", FIGHT.pieces[0]), { outcome: "flinched", nerve: 3 });
  assert.deepEqual(answerOf("exit", FIGHT.pieces[0]), { outcome: "flinched", nerve: 3 });
  assert.deepEqual(answerOf("say", FIGHT.pieces[0]), { outcome: "held", sanity: 2 });
  assert.deepEqual(answerOf("watch", FIGHT.pieces[0]), { outcome: "held", sanity: 3 });
  // a strike under a feint: "holds" as built; "neither" (WLD-25/m, Darko's call) answers nothing, so it stays open
  assert.equal(STRIKE_UNDER_FEINT, "holds");
  assert.deepEqual(answerOf("strike", FIGHT.pieces[0]), { outcome: "held", sanity: 2 });
  assert.equal(answerOf("strike", FIGHT.pieces[0], undefined, { strike: "neither" }), null);
  const run = async (verb, extra = {}) => {
    const h = hurl("kai");
    const living = livingWith(lawWith(), h);
    const { w, d } = turnDeps(living);
    const [answer] = await reactTo(act({ verb, ...extra }), { ...d, ...(extra.aimed ? { aimed: living.byId.get(ID) } : {}) });
    return { living, w, answer, h };
  };
  const dodged = await run("dodge", { aimed: true });
  const hd = rowsOf(dodged.w, HURLED_ACTION);
  assert.deepEqual([payloadOf(hd[0]).outcome, payloadOf(hd[0]).hurl], ["flinched", dodged.h.id]);
  assert.deepEqual(rowsOf(dodged.w, NERVE_ACTION).filter((r) => payloadOf(r).why === "flinched").map((r) => payloadOf(r).by), [-3]);
  assert.deepEqual(dodged.answer.feint, { outcome: "flinched", nerve: -3 });
  const walked = await run("walk");
  assert.equal(payloadOf(rowsOf(walked.w, HURLED_ACTION)[0]).outcome, "flinched");
  const said = await run("say");
  assert.equal(payloadOf(rowsOf(said.w, HURLED_ACTION)[0]).outcome, "held");
  assert.deepEqual(rowsOf(said.w, SANITY_ACTION).map((r) => payloadOf(r).by), [2]);
  const watched = await run("watch", { aimed: true });
  assert.deepEqual(rowsOf(watched.w, SANITY_ACTION).map((r) => payloadOf(r).by), [3], "watch holds more");
  // an act written before the feint was aimed is not its answer
  const early = livingWith(lawWith());
  const before = act({ actId: "1" });
  early.fold([hurl("kai")], { advance: false });
  const t = turnDeps(early);
  await reactTo(before, t.d);
  assert.equal(rowsOf(t.w, HURLED_ACTION).length, 0);
  assert.equal(openHurls(early, early.byId.get(ID), NOW).filter((h) => h.object === "kai").length, 1, "still open");
});

test("no act within its minutes: the tick lapses it, once; a dodge needs a feint aimed at you", async () => {
  __resetEncounterTickForTest();
  const living = livingWith(lawWith(), hurl("kai", NOW - 40 * 60_000));
  const o = onceWrite();
  const d = { roster: async () => [], writeOnce: o.write, strikes: async () => [], finish: async () => ({}), flee: async () => null,
    creatures: async () => null, standpoint: async () => null, write: async () => null, answer: async () => [], answerRing: async () => [], freeze: () => null,
    actsSince: async () => [], outside: async () => false, gist: async () => false, writeTempted: async () => ({ rows: [] }), jevLint: async () => null };
  const out = await encounterTick({ living, law: living.law }, { now: NOW, deps: d });
  assert.equal(out.lapsed, 1);
  assert.equal(payloadOf(o.calls[0][0]).outcome, "lapsed");
  assert.equal(openHurls(living, living.byId.get(ID), NOW).length, 0);
  const c = living.byId.get(ID);
  assert.match(whyNot("dodge", c, 10, { law: living.law, here: { x: 10, y: 0 }, living, actor: "kai", now: NOW }), /nothing .* is aimed at you to dodge/);
  const aimed = livingWith(lawWith(), hurl("kai"));
  assert.equal(whyNot("dodge", aimed.byId.get(ID), 10, { law: aimed.law, here: { x: 10, y: 0 }, living: aimed, actor: "kai", now: NOW }), null);
});

// ── the disguise ───────────────────────────────────────────────────────────

test("while disguised the office withholds both bars, its part and its moods, and says how it looks; a look from inside its ring breaks it", async () => {
  const living = livingWith(lawWith(), phase(1, NOW - 30 * 60_000));
  const cur = { living, law: living.law };
  const [who] = creaturesInWho(cur, { x: 10, y: 0 }, { nowMs: NOW });
  assert.equal(who.looks, "It looks entirely ordinary.");
  assert.equal(who.bars, undefined);
  assert.equal(who.part, undefined);
  const far = await investigateCreature(ID, { creatures: cur, from: { x: 300, y: 0 }, handle: "kai", nowMs: NOW, unmask: async () => { throw new Error("never from outside its ring"); } });
  assert.deepEqual(far.presence.now.fight, { looks: "It looks entirely ordinary." });
  assert.equal(far.presence.now.moods, undefined, "its moods would say what it hides");
  let broke = null;
  const near = await investigateCreature(ID, { creatures: cur, from: { x: 10, y: 0 }, handle: "kai", nowMs: NOW,
    unmask: async (c, by) => { broke = by; living.fold([row(ID, UNMASKED_ACTION, by, { verb: "investigate" }, NOW), phase(2, NOW)], { advance: false }); return { piece: "unbreakable" }; } });
  assert.equal(broke, "kai");
  assert.equal(near.presence.now.fight.part, "unbreakable", "this look already sees it as it is");
  assert.ok(near.presence.now.fight.bars);
  assert.match(near.presence.now.fight.saw_through, /broke its disguise/);
});

test("a strike breaks the disguise; in the unbreakable piece a strike wears nothing, still costs its nerve, and says it glanced off", async () => {
  const strikeAt = async (living, extra = {}) => {
    const written = [];
    const o = onceWrite();
    const d = { now: () => NOW, clock: () => NOW, env: { CREATURE_JUDGE: "code" }, freeze: () => null, writeOnce: o.write,
      creatures: async () => ({ living, law: living.law }), standpoint: async () => ({ x: 10, y: 0 }), roster: async () => ROSTER,
      write: async (entry, key, { guard }) => { await guard({ query: async () => ({ rows: [] }) }); const id = nextId(); written.push({ id, ...entry }); return { actId: id, written_at: iso(NOW) }; },
      answer: async () => [], answerRing: async () => [], strikes: async () => [], finish: async () => ({ written: false }), flee: () => {}, ...extra };
    const r = await worldEncounter({ act: "strike", creature: ID }, { handles: new Set(["kai"]) }, d);
    return { r, written, o };
  };
  const disguised = livingWith(lawWith(), phase(1, NOW - 30 * 60_000));
  const one = await strikeAt(disguised);
  assert.equal(one.written[0].payload.damage, 2);
  assert.match(one.r.saw_through, /broke its disguise/);
  assert.equal(pieceOf(disguised.byId.get(ID), FIGHT, NOW).piece, "unbreakable");
  const unbreakable = livingWith(lawWith(), phase(2, NOW - 30 * 60_000));
  const two = await strikeAt(unbreakable);
  assert.equal(two.written[0].payload.damage, 0);
  assert.equal(two.written[0].payload.cost, 2, "a strike still costs its nerve");
  assert.equal(two.r.glances, GLANCES);
  assert.equal(two.r.bars.hit_points.left, 40);
  // and force never ends it, however its hit points stand: only its sanity does
  const many = Array.from({ length: 30 }, (_, i) => ({ id: String(100 + i), actor: "kai", at: iso(NOW), payload: { damage: 2 } }));
  assert.equal(await settleResolve(unbreakable.byId.get(ID), FIGHTER, { d: { strikes: async () => many, finish: async () => { throw new Error("never"); } }, now: NOW }), null);
});

// ── persuade ───────────────────────────────────────────────────────────────

test("persuade: only in the unbreakable piece, once per household each settlement (the matrix and the record), costing its nerve", async () => {
  const feints = livingWith();
  const opts = (living, household) => ({ law: living.law, here: { x: 10, y: 0 }, living, actor: "ana", household, now: NOW });
  assert.match(whyNot("persuade", feints.byId.get(ID), 10, opts(feints, "house:hearth")), /cannot be persuaded now/);
  const living = livingWith(lawWith(), phase(2, NOW - 30 * 60_000), row("bo", PERSUADE_ACTION, ID, { words: "come back", household: "house:hearth" }, NOW - 10 * 60_000));
  assert.ok(persuadedThisWindow(living, living.byId.get(ID), "house:hearth", NOW));
  assert.match(whyNot("persuade", living.byId.get(ID), 10, opts(living, "house:hearth")), /your household has persuaded/);
  assert.equal(whyNot("persuade", living.byId.get(ID), 10, opts(living, "solo:kai")), null);
  assert.equal(persuadedThisWindow(living, living.byId.get(ID), "house:hearth", W.ends + 1), false, "the next settlement");
  // the record's half, under its lock
  const seen = [];
  const client = (hit) => ({ query: async (sql, params) => { seen.push(sql); return { rows: sql === PERSUADED_SQL && hit ? [{ hit: 1 }] : [] }; } });
  await assert.rejects(persuadeGuard("ana", ID, "house:hearth", { now: NOW })(client(true)), (e) => e.code === 409 && /once per household/.test(e.hint));
  await persuadeGuard("kai", ID, "solo:kai", { now: NOW })(client(false));
  // the cost and the score
  const { w, d } = turnDeps(living, { env: { TYPESAFE_API_KEY: "k" },
    ask: async (state, q) => ({ response: { answers: { reaction: { probabilities: { hum: 1 } }, persuade_score: { probabilities: { s8: 0.9, s3: 0.1 } } } } }) });
  const [answer] = await reactTo(act({ verb: "persuade", words: "You waited for it once. Wait with us.", actor: "kai" }), { ...d, aimed: living.byId.get(ID) });
  assert.deepEqual(rowsOf(w, NERVE_ACTION).filter((r) => r.object === "kai").map((r) => payloadOf(r).by), [-8], "its nerve, in place of an act's 1");
  assert.deepEqual(rowsOf(w, SANITY_ACTION).map((r) => payloadOf(r).by), [8]);
  assert.equal(answer.persuaded.sanity, 8);
});

test("a persuade's score: Jev's, clamped to the piece's range by code; the low end when Jev has no word or it repeats one made this settlement", () => {
  const def = FIGHT.pieces[2];
  assert.equal(persuadeScore({ s8: 1 }, def), 8);
  assert.equal(persuadeScore({ s5: 0.6, s8: 0.4 }, def), 5);
  assert.equal(persuadeScore({ s99: 1 }, def), 8, "clamped: an answer asking for the most cannot break it");
  assert.equal(persuadeScore({ s0: 1 }, def), 3);
  assert.equal(persuadeScore(null, def), 3);
  assert.equal(persuadeScore({ s8: 1 }, def, { repeated: true }), 3);
  assert.ok(repeats("Wait with us, like everyone else.", ["wait with us like everyone else"]));
  assert.ok(!repeats("You promised your friends you would wait.", ["wait with us like everyone else"]));
});

test("a repeated persuade is never asked of Jev, and counts the low end", async () => {
  const living = livingWith(lawWith(), phase(2, NOW - 30 * 60_000), row("bo", PERSUADE_ACTION, ID, { words: "wait with us like everyone else", household: "house:hearth" }, NOW - 10 * 60_000));
  let asked = null;
  const { w, d } = turnDeps(living, { env: { TYPESAFE_API_KEY: "k" }, ask: async (state, q) => { asked = q; return { response: { answers: { reaction: { probabilities: { hum: 1 } } } } }; } });
  await reactTo(act({ verb: "persuade", words: "Wait with us, like everyone else!", actor: "kai" }), { ...d, aimed: living.byId.get(ID) });
  assert.equal(asked?.persuade_score, undefined);
  assert.deepEqual(rowsOf(w, SANITY_ACTION).map((r) => [payloadOf(r).by, payloadOf(r).repeated]), [[3, true]]);
});

// ── the ending ─────────────────────────────────────────────────────────────

test("the ending: sanity full in its last piece at the settlement; everyone it answered and everyone who raised it named; the class it turns back on", () => {
  const from = iso(W.start), cutoff = iso(W.ends);
  const spawnRow = { object: ID, payload: { kind: "fighter", x: 0, y: 0 } };
  const r = (id, action, object, payload, at) => ({ id, action, object, payload, at: iso(at) });
  const rows = [r("10", "phase", ID, { index: 2 }, W.start + 3600_000), r("9", "sanity", "zed", { by: 9 }, W.start + 1000),
    r("11", "sanity", "kai", { by: 8 }, W.start + 2 * 3600_000), r("12", "sanity", "ana", { by: 5 }, W.start + 3 * 3600_000)];
  assert.deepEqual(fightSanity(rows, FIGHT, { from }), { full: true, sanity: 12, of: 12 }, "zed's 9 came before the unbreakable piece began");
  const plan = planFightEnding({ spawn: spawnRow, rows, answered: [{ act_id: "5", actor: "ren", object: ID }], settlement: 300, cutoff, from, fight: FIGHT, kindFile: FIGHTER });
  assert.deepEqual(plan.took_part, ["ren", "zed", "kai", "ana"], "zed raised it earlier in the window: they took part");
  assert.equal(plan.line, "It is itself again. ren, zed, kai and ana were there.");
  assert.equal(plan.restores, "snack");
  assert.equal(planFightEnding({ spawn: spawnRow, rows: rows.slice(0, 3), answered: [], settlement: 300, cutoff, from, fight: FIGHT, kindFile: FIGHTER }), null, "8 of 12");
  const notLast = [r("10", "phase", ID, { index: 1 }, W.start + 3600_000), r("11", "sanity", "kai", { by: 20 }, W.start + 2 * 3600_000)];
  assert.equal(fightSanity(notLast, FIGHT, { from }).full, false, "only in its last piece");
});

// ── the office never lies ──────────────────────────────────────────────────

test("THE OFFICE NEVER LIES: across every set piece, no office field says the fight is over, and none offers an ending, before its ending", async () => {
  const OVER = /\b(over|ended|finished|defeated|won|beaten|done for|is fixed|restored|you win)\b/i;
  const stages = {
    feint: livingWith(lawWith(), hurl("ren"), sanity("kai", 2)),
    disguise: livingWith(lawWith(), phase(1, NOW - 30 * 60_000)),
    unbreakable: livingWith(lawWith(), phase(1, NOW - 50 * 60_000), phase(2, NOW - 30 * 60_000), sanity("kai", 11)),
  };
  for (const [name, living] of Object.entries(stages)) {
    const cur = { living, law: living.law };
    const c = living.byId.get(ID);
    // every office read and reply: who, investigate, to_you, a reaction's answer, a strike's reply
    const who = creaturesInWho(cur, { x: 10, y: 0 }, { nowMs: NOW });
    const seen = await investigateCreature(ID, { creatures: cur, from: { x: 300, y: 0 }, handle: "kai", nowMs: NOW });
    const toYou = creatureToYou(cur, "ren", { sinceMs: NOW - 3600_000, nowMs: NOW });
    const { d } = turnDeps(living);
    const [answer] = await reactTo(act({ actId: nextId() }), d);
    const office = { who, seen, toYou: toYou.events.filter((e) => !e.says), answer: { ...answer, line: undefined, says_to_the_ring: undefined } };
    // the creature's own lines (its reactions, its surrender) may say anything; the office's own words may not
    const text = JSON.stringify(office, (k, v) => (["line", "says", "doing", "last"].includes(k) ? undefined : v));
    assert.doesNotMatch(text, OVER, `${name}: the office's own words`);
    for (const k of ["finished", "ending", "pending", "owed_at_settlement"]) assert.ok(!text.includes(`"${k}"`), `${name}: no ${k}`);
    assert.equal(c.gone, null, `${name}: it is still here`);
    // and what it shows is true: the bars are the record's, or withheld; never made up
    const bars = who[0].bars;
    if (name === "disguise") assert.equal(bars, undefined);
    else assert.deepEqual({ hit_points: bars.hit_points, sanity: bars.sanity }, barsOf(living, c, FIGHTER, FIGHT, NOW));
  }
});

test("the ending's write: at a settlement where its sanity is full, the town withdraws it, ended, and turns the class back on, in one transaction", async () => {
  const { endCreatures, FIGHT_ROWS_SQL, STAYING_SPAWNS_SQL, NEWEST_SETTLEMENT_SQL, ANSWERED_SQL, PRIOR_WITHDRAW_SQL, RESTORE } = await import("../world2/tools/creature-endings.mjs");
  const settlement = { number: 300, published_at: new Date(W.ends + 41_000) };
  const store = (sanityBy) => {
    const writes = [];
    return { writes, client: { query: async (sql, params = []) => {
      if (sql === STAYING_SPAWNS_SQL) return { rows: [{ id: "1", object: ID, payload: { kind: "fighter", x: 0, y: 0, stays: true } }] };
      if (sql === NEWEST_SETTLEMENT_SQL) return { rows: [settlement] };
      if (sql === FIGHT_ROWS_SQL) return { rows: [{ id: "10", action: "phase", object: ID, payload: { index: 2 }, at: new Date(W.start + 3600_000) },
        { id: "11", action: "sanity", object: "kai", payload: { by: sanityBy }, at: new Date(W.start + 2 * 3600_000) }] };
      if (sql === ANSWERED_SQL) return { rows: [{ act_id: "5", actor: "ren", object: ID }] };
      if (sql === PRIOR_WITHDRAW_SQL) return { rows: [] };
      if (/^\s*INSERT INTO acts/.test(sql) || /^(BEGIN|COMMIT|ROLLBACK)$/.test(sql)) { writes.push([sql.trim().split(/\s+/)[0], params]); return { rows: [] }; }
      return { rows: [] };
    } } };
  };
  const law = { ...lawWith(), creaturesMod: { ...BASE.creaturesMod, DESPAWN_REASONS: [...new Set([...BASE.creaturesMod.DESPAWN_REASONS, "ended"])] } };
  const full = store(12);
  const r = await endCreatures(full.client, { law, now: W.ends + 60_000 });
  assert.equal(r.ended.length, 1);
  assert.deepEqual(full.writes.map(([q]) => q), ["BEGIN", "INSERT", "INSERT", "COMMIT"]);
  const end = full.writes[1][1], restore = full.writes[2][1];
  assert.deepEqual(JSON.parse(end[5]), { reason: "ended", sanity: 12, of: 12, restores: "snack", took_part: ["ren", "kai"], settlement: 300, cutoff: iso(W.ends) });
  assert.equal(end[6], "It is itself again. ren and kai were there.");
  assert.equal(RESTORE, "restore");
  assert.deepEqual([restore[1], JSON.parse(restore[2])], ["snack", { class: "snack", by: ID, settlement: 300, cutoff: iso(W.ends) }]);
  const short = store(11);
  assert.equal((await endCreatures(short.client, { law, now: W.ends + 60_000 })).ended.length, 0);
  assert.deepEqual(short.writes, [], "11 of 12: it stays, and the next window is its fight");
});
