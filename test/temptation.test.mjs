// temptation.test.mjs — a creature that tempts, the office half (src/temptation.mjs;
// src/creatures.mjs § temptingTurn, temptingRows; src/encounter-verbs.mjs § strike,
// encounterTick's resolver, givenToATempter; world2/tools/creature-endings.mjs §
// planTallyEnding; src/creature-tick.mjs § namedSpawns' after).
//
// RULED (the design as settled by Wright under Darko's delegation, 2026-10-21): two
// tallies over one window, the larger picking the ending and a tie going to
// persuasion; a strike +2 (+3 where houses count, three houses within the hour); each
// reaction may carry one temptation, code choosing whom by the phase's rule and Jev
// which; obeyed within 30 min costs 3 more nerve (split with housemates) and mends 1,
// declined adds 1, a plain answer 2 (3 when it fits the phase's echo), help 1 (a shield
// across a house line 2 where houses count); a give to it takes nothing; whisper-lint's
// second check is Jev's, and nothing unchecked is said.
//
// The kind and its menu are TEST FIXTURES with placeholder words, dressed as the
// world's grammar parses them (its PR is creatures/tempting-kind on postmark-world).

import { test as nodeTest } from "node:test";
import assert from "node:assert/strict";

import { LivingSet, loadCreatureLaw, reactTo, sampleWith } from "../src/creatures.mjs";
import { NERVE_ACTION, windowAt } from "../src/encounter.mjs";
import {
  TEMPT_ACTION, TEMPTED_ACTION, TALLY_ACTION, TEMPT_DIALS, outcomeOf, outcomeRows, phaseOf, plainScore, roadOf, strikeDamage, talliesOf,
  temptTarget, jevLints,
} from "../src/temptation.mjs";
import { encounterTick, givenToATempter, worldEncounter, writeTempted, PRIOR_TEMPTED_SQL, __resetEncounterTickForTest } from "../src/encounter-verbs.mjs";
import { planTallyEnding, talliesFrom, roadFrom } from "../world2/tools/creature-endings.mjs";
import { namedSpawns, ENDED_OF_SQL } from "../src/creature-tick.mjs";
import { creatureToYou } from "../src/creatures-read.mjs";
import { NO_WORLD, worldModuleUrl } from "./fixture-paths.mjs";

const test = (name, fn) => nodeTest(name, { skip: NO_WORLD || false }, fn);

const KIND_TEXT = `kind: tempter
name: a test tempter
ring_m: 40
what: >
  A fixture for the temptation's tests.
moods:
  mood: 0..3 = 1 | calm | stirred | eager | wild
reaction notice "it notices": when true says It notices {actor}.
`;
const BASE = NO_WORLD ? null : await loadCreatureLaw({ ref: "the pinned clone", importTool: (f) => import(worldModuleUrl("tools", f)),
  readText: (path) => { if (path !== "WORLD/kinds/tempter.kind") throw new Error(`no fixture at ${path}`); return KIND_TEXT; } });
const WHO = "a-tempter";
const reaction = (name, src, says) => ({ name, sentence: name, when: BASE.kindMod.parseCondition(src), src, effects: [{ do: "nothing" }], says });
const TEMPTER = NO_WORLD ? null : {
  ...BASE.kindOf("tempter"), finishable: true, tempts: "tempter.menu.json", who: WHO, fight_size: 30,
  reactions: [reaction("hum", "true", "It hums at {actor}.")],
};
const W = (id, phase, text, tempts, slots = []) => ({ id, phase, text, tempts, aims_at: null, seen_through: ["names the trick"], slots });
/** The menu as the world's parseMenu answers it. */
const MENU = {
  who: WHO, phaseOrder: ["hush", "recall", "houses"],
  phases: { hush: { aims_at: "loudest", span_m: 15, seen_through: ["names the trick"] }, recall: { aims_at: "longest", seen_through: [] }, houses: { aims_at: "alone", seen_through: [] } },
  whispers: [
    W("h1", "hush", "Step back to the stair, {name}.", { act: "leave" }, ["name"]),
    W("h2", "hush", "Give me one small thing.", { act: "give", to: WHO, what: "any" }),
    W("r1", "recall", "Tell {ally} you promised.", { act: "say", to: "{ally}", gist: "follow it" }, ["ally"]),
    W("o1", "houses", "Strike me once.", { act: "strike", target: WHO }),
  ].map((w) => ({ ...w, aims_at: { hush: "loudest", recall: "longest", houses: "alone" }[w.phase] })),
  lines: {}, endings: { damage: { name: "the fall", text: "It falls." }, persuasion: { name: "the turn", text: "It turns back." } }, quotes: ["wait like everyone else"],
};
const fillWhisper = (text, fill) => String(text).replace(/\{([a-z_]+)\}/g, (all, s) => (fill[s] != null ? String(fill[s]) : all));
const lawWith = ({ checked = true, menu = MENU } = {}) => (NO_WORLD ? null : {
  ...BASE, kindOf: (n) => (n === "tempter" ? TEMPTER : null),
  menuOf: (n) => (n === "tempter" ? menu : null), temptsMod: { fillWhisper },
  lintChecked: new Map(checked ? MENU.whispers.map((w) => [w.id, true]) : []),
  kindMod: { ...BASE.kindMod, ENCOUNTER_VERBS: ["strike", "steady", "shield"],
    scopeOf: (s, a, actor) => BASE.kindMod.scopeOf(s, a, actor) },
});

const NOW = Date.parse("2026-10-26T08:00:00Z"); // two hours into the window 06:00 → 18:00Z: its first phase
const iso = (ms) => new Date(ms).toISOString();
const ID = "creature:tempter-top";
let n = 5000;
const nextId = () => String(++n);
const spawn = () => ({ id: nextId(), at: iso(NOW - 3600_000), actor: "the-town", action: "spawn", object: ID, payload: { kind: "tempter", at: iso(NOW - 3600_000), stays: true, x: 0, y: 0 } });
const row = (actor, action, object, payload, at = NOW - 60_000) => ({ id: nextId(), at: iso(at), actor, action, object, payload });
const strikeRow = (by, damage = 2, at = NOW - 60_000) => row(by, "strike", ID, { kind: "tempter", cost: 2, damage }, at);
const tally = (on, road, by, why = "plain", at = NOW - 60_000) => row(ID, TALLY_ACTION, on, { road, by, why }, at);
const actCost = (on, at = NOW - 60_000) => row(ID, NERVE_ACTION, on, { by: -1, why: "act", act: "1", creature: ID }, at);
const tempt = (to, payload = {}, at = NOW - 60_000) => row(ID, TEMPT_ACTION, to, { whisper: "h1", phase: "hush", says: "Step back.", tempts: { act: "leave" }, until: iso(at + 30 * 60_000), window: windowAt(at).id, ...payload }, at);
const livingWith = (law = lawWith(), ...rows) => new LivingSet({ law }).fold([spawn()]).fold(rows, { advance: false });
const HOMES = { ana: "hearth", bo: "hearth" };
const lookup = (h) => (HOMES[h] ? { key: "house:hearth", slug: "hearth" } : { key: `solo:${h}`, slug: null });
const houseOf = (h) => lookup(h).key;
const present = (list) => async () => ({ residents: list.map(([handle, distance_m]) => ({ handle, distance_m })) });
const payloadOf = (r) => (typeof r.payload === "string" ? JSON.parse(r.payload) : r.payload);
function recordingWrite() {
  const calls = [];
  return { calls, write: async (rows) => { calls.push(rows); return { prior: false, rows: rows.map((r) => ({ id: nextId(), at: r.written_at, actor: r.actor, action: r.action, object: r.object, payload: r.payload })) }; } };
}
const turnDeps = (living, over = {}) => {
  const w = recordingWrite();
  return { w, d: { living, law: living.law, write: w.write, writeCost: w.write, now: NOW, env: { CREATURE_JUDGE: "code" },
    present: present([["kai", 10], ["ren", 12], ["mo", 20]]), households: async () => lookup, flee: () => {}, sayText: async () => null, ...over } };
};
const act = (over = {}) => ({ actor: "kai", verb: "walk", actId: nextId(), atIso: iso(NOW), point: { x: 10, y: 0 }, ...over });

// ── the tallies, the road, the phase ───────────────────────────────────────

test("two tallies over the window: strikes are damage, tallies move either road; a tie goes to persuasion; both 0 picks nothing; the settlement empties them", () => {
  const living = livingWith(lawWith(), strikeRow("kai", 2), strikeRow("ren", 3), tally("mo", "persuasion", 2), tally("kai", "damage", -1, "obeyed"), tally("ana", "persuasion", 2));
  const c = living.byId.get(ID);
  assert.deepEqual(talliesOf(living, c, NOW), { damage: 4, persuasion: 4 });
  assert.equal(roadOf({ damage: 4, persuasion: 4 }), "persuasion", "a tie to persuasion");
  assert.equal(roadOf({ damage: 5, persuasion: 4 }), "damage");
  assert.equal(roadOf({ damage: 0, persuasion: 0 }), null);
  assert.deepEqual(talliesOf(living, c, windowAt(NOW).ends + 1), { damage: 0, persuasion: 0 });
  assert.deepEqual(TEMPT_DIALS.obey_ms.value, 30 * 60_000);
});

test("the phase: the larger tally past a third, then two thirds, of its fight, or 4 h then 8 h into the window; never back", () => {
  const start = windowAt(NOW).start;
  const at = (h) => start + h * 3600_000;
  const quiet = livingWith();
  assert.equal(phaseOf(quiet, quiet.byId.get(ID), TEMPTER, MENU, at(1)).name, "hush");
  assert.equal(phaseOf(quiet, quiet.byId.get(ID), TEMPTER, MENU, at(4.5)).name, "recall", "the clock");
  assert.equal(phaseOf(quiet, quiet.byId.get(ID), TEMPTER, MENU, at(8.5)).name, "houses");
  const busy = livingWith(lawWith(), strikeRow("kai", 11, at(1)));
  assert.equal(phaseOf(busy, busy.byId.get(ID), TEMPTER, MENU, at(1.1)).name, "recall", "11 of 30: past a third");
  const said = livingWith(lawWith(), tempt("kai", { phase: "houses" }, at(1)));
  assert.equal(phaseOf(said, said.byId.get(ID), TEMPTER, MENU, at(1.1)).name, "houses", "a phase reached is never left within its window");
});

test("a strike at it is damage: +2, and +3 where houses count once three households have struck within the hour; it has no resolve to refuse on", async () => {
  const living = livingWith(lawWith(), strikeRow("ana", 2, NOW - 30 * 60_000), strikeRow("mo", 2, NOW - 20 * 60_000));
  const c = living.byId.get(ID);
  assert.equal(strikeDamage({ living, creature: c, echo: "short", actor: "kai", houseOf, now: NOW }), 2);
  assert.equal(strikeDamage({ living, creature: c, echo: "houses", actor: "kai", houseOf, now: NOW }), 3, "hearth, mo, kai: three houses");
  assert.equal(strikeDamage({ living, creature: c, echo: "houses", actor: "bo", houseOf, now: NOW }), 2, "bo is ana's housemate: two houses");
  // through the door
  const written = [];
  const d = { now: () => NOW, clock: () => NOW, env: { CREATURE_JUDGE: "code" }, freeze: () => null,
    creatures: async () => ({ living, law: living.law }), standpoint: async () => ({ x: 10, y: 0 }), houseOf: async () => houseOf,
    write: async (entry, key, { guard }) => { await guard({ query: async () => ({ rows: [] }) }); const id = nextId(); written.push({ id, ...entry }); return { actId: id, written_at: iso(NOW) }; },
    answer: async () => [], answerRing: async () => [], strikes: async () => [], finish: async () => ({ written: false }), flee: () => {} };
  const r = await worldEncounter({ act: "strike", creature: ID }, { handles: new Set(["kai"]) }, d);
  assert.equal(written[0].payload.damage, 2);
  assert.deepEqual(r.tallies.damage, 6, "the two earlier strikes and this one");
  assert.equal(r.resolve, undefined);
});

// ── a temptation rides a reaction ──────────────────────────────────────────

test("a reaction carries one temptation: code aims it by the phase's rule, Jev picks which, its own die samples, and the row keeps the odds", async () => {
  const living = livingWith(lawWith(), actCost("ren", NOW - 5 * 60_000), actCost("ren", NOW - 4 * 60_000), actCost("kai", NOW - 3 * 60_000));
  let asked = null;
  const { w, d } = turnDeps(living, { env: { TYPESAFE_API_KEY: "k" },
    ask: async (state, q) => { asked = { state, q }; return { response: { answers: { reaction: { probabilities: { hum: 1 } }, tempt_with: { probabilities: { h1: 0.9, h2: 0.1, none: 0 } } } } }; } });
  const [answer] = await reactTo(act(), d);
  assert.ok(asked.q.tempt_with, "the question rides the same request");
  assert.deepEqual(Object.keys(asked.q.tempt_with.criteria), ["h1", "h2", "none"]);
  assert.equal(asked.state.tempting.phase, "hush");
  assert.equal(asked.state.tempting.target, "ren", "the loudest of the last 15 min");
  const t = w.calls[0].find((r) => r.action === TEMPT_ACTION);
  const p = payloadOf(t);
  assert.equal(t.object, "ren");
  assert.equal(p.whisper, sampleWith(p.roll, p.odds).picked, "the pick re-derives from the row");
  assert.equal(p.says, p.whisper === "h1" ? "Step back to the stair, ren." : "Give me one small thing.");
  assert.equal(p.until, iso(NOW + 30 * 60_000));
  assert.deepEqual(answer.tempts, { to: "ren", says: p.says, until: p.until });
});

test("a temptation waits on its target, one at a time; nothing Jev's lint has not passed is ever said (fail closed)", async () => {
  const open = livingWith(lawWith(), actCost("ren", NOW - 5 * 60_000), tempt("ren"));
  const target = temptTarget({ living: open, creature: open.byId.get(ID), menu: MENU, phase: { name: "hush", echo: "short" },
    roster: [{ handle: "ren", nerve: 9, household: "solo:ren", distance_m: 12 }, { handle: "kai", nerve: 9, household: "solo:kai", distance_m: 10 }], actor: "kai", now: NOW });
  assert.equal(target?.handle, "kai", "ren already holds one open: it falls to the actor");
  const unchecked = livingWith(lawWith({ checked: false }), actCost("ren", NOW - 5 * 60_000));
  const { w, d } = turnDeps(unchecked);
  await reactTo(act(), d);
  assert.equal(w.calls[0].filter((r) => r.action === TEMPT_ACTION).length, 0, "unchecked by Jev: never said");
});

// ── a plain answer, help ───────────────────────────────────────────────────

test("a plain answer to an open temptation: +2, +3 when it fits the phase's echo; an insult or an unjudged say counts nothing", async () => {
  assert.deepEqual(plainScore({ verdict: "plain", echo: "short", words: 6, houses: 1 }), { by: 3, why: "plain, and short" });
  assert.deepEqual(plainScore({ verdict: "plain", echo: "short", words: 30, houses: 1 }), { by: 2, why: "plain" });
  assert.deepEqual(plainScore({ verdict: "corrects", echo: "record", words: 30, houses: 1 }), { by: 3, why: "plain, from the record" });
  assert.deepEqual(plainScore({ verdict: "plain", echo: "record", words: 3, houses: 1 }), { by: 2, why: "plain" });
  assert.deepEqual(plainScore({ verdict: "plain", echo: "houses", words: 3, houses: 2 }), { by: 1, why: "plain, alone" });
  assert.deepEqual(plainScore({ verdict: "plain", echo: "houses", words: 3, houses: 3 }), { by: 3, why: "plain, with three houses" });
  assert.equal(plainScore({ verdict: "insult", echo: "short", words: 2, houses: 1 }), null);
  // through a turn: kai says something short while a temptation waits on kai
  const living = livingWith(lawWith(), tempt("kai"));
  const { w, d } = turnDeps(living, { env: { TYPESAFE_API_KEY: "k" }, sayText: async () => "That's retreat, not peace.",
    ask: async (state, q) => ({ response: { answers: { reaction: { probabilities: { hum: 1 } }, answer: { probabilities: { plain: 0.8, other: 0.2 } } } } }) });
  const [answer] = await reactTo(act({ verb: "say" }), d);
  const t = w.calls[0].find((r) => r.action === TALLY_ACTION);
  assert.deepEqual([t.object, payloadOf(t).road, payloadOf(t).by, payloadOf(t).why], ["kai", "persuasion", 3, "plain, and short"]);
  assert.deepEqual(answer.counted, [{ for: "kai", persuasion: 3, why: "plain, and short" }]);
  const quiet = turnDeps(livingWith(lawWith(), tempt("kai")), { sayText: async () => "No." });
  await reactTo(act({ verb: "say" }), quiet.d);
  assert.equal(quiet.w.calls.flat().filter((r) => r.action === TALLY_ACTION).length, 0, "no Jev, no judgment: nothing counted");
});

test("help: a steady or a shield after a temptation was aimed at that friend, +1; where houses count, a shield across a house line, +2", async () => {
  const living = livingWith(lawWith(), tempt("ren"));
  const { w, d } = turnDeps(living);
  await reactTo(act({ verb: "steady", target: "ren" }), d);
  const t = w.calls[0].find((r) => r.action === TALLY_ACTION);
  assert.deepEqual([t.object, payloadOf(t).by, payloadOf(t).why], ["kai", 1, "steadied a tempted friend"]);
  const none = turnDeps(livingWith(lawWith(), tempt("mo")));
  await reactTo(act({ verb: "steady", target: "ren" }), none.d);
  assert.equal(none.w.calls.flat().filter((r) => r.action === TALLY_ACTION).length, 0, "no temptation was aimed at ren: a kindness, not an answer");
  const late = livingWith(lawWith(), tempt("x", { phase: "houses" }));
  const l = turnDeps(late);
  await reactTo(act({ verb: "shield", target: "ana" }), l.d);
  assert.deepEqual(payloadOf(l.w.calls[0].find((r) => r.action === TALLY_ACTION)).why, "a shield across a house line");
});

// ── what becomes of a temptation ───────────────────────────────────────────

test("obeyed, declined or lapsed, read from the record: the act it asked for within 30 min; else a decline if they acted in its ring", async () => {
  const c = { id: ID };
  const t = (tempts, at = NOW - 40 * 60_000) => ({ id: "77", actor: ID, object: "kai", at, payload: { tempts, until: iso(at + 30 * 60_000) } });
  const base = { creature: c, outside: async () => false, gist: async () => false, now: NOW };
  const A = (action, object, payload = {}, at = NOW - 30 * 60_000) => ({ id: nextId(), actor: "kai", action, object, payload, at });
  assert.deepEqual(await outcomeOf(t({ act: "strike", target: WHO }), { ...base, acts: [A("strike", ID)] }), { outcome: "obeyed", by: n.toString() });
  assert.equal((await outcomeOf(t({ act: "give", to: WHO }), { ...base, acts: [A("give", ID, { to: WHO, nothing_moves: true })] })).outcome, "obeyed");
  assert.equal((await outcomeOf(t({ act: "say", to: "ren", gist: "g" }), { ...base, acts: [A("say", null, { text: "follow it" })], gist: async () => true })).outcome, "obeyed");
  assert.equal((await outcomeOf(t({ act: "leave" }, NOW - 5 * 60_000), { ...base, acts: [], outside: async () => true })).outcome, "obeyed", "out of its ring in time");
  assert.equal(await outcomeOf(t({ act: "leave" }, NOW - 5 * 60_000), { ...base, acts: [] }), null, "still open");
  assert.deepEqual(await outcomeOf(t({ act: "leave" }), { ...base, acts: [{ ...A(NERVE_ACTION, "kai", { why: "act", creature: ID }), actor: ID }] }), { outcome: "declined" });
  assert.deepEqual(await outcomeOf(t({ act: "leave" }), { ...base, acts: [] }), { outcome: "lapsed" });
  // the act that drew it was written with it (a lower id, the same instant): it is neither an answer nor a decline
  assert.deepEqual(await outcomeOf({ ...t({ act: "leave" }), id: "9000" }, { ...base, acts: [{ ...A(NERVE_ACTION, "kai", { why: "act", creature: ID }, NOW - 40 * 60_000), id: "8999", actor: ID }] }), { outcome: "lapsed" });
  assert.equal((await outcomeOf(t({ act: "strike", target: WHO }), { ...base, acts: [A("strike", ID, {}, NOW - 5 * 60_000)] })).outcome, "lapsed", "a strike after its 30 min obeys nothing");
});

test("what an outcome writes: obeyed mends 1 and costs 3 more nerve, split -2 / -1 with a housemate in the ring; declined, +1", () => {
  const tm = { id: "77", actor: ID, object: "ana", payload: {} };
  const roster = [{ handle: "ana", household: "house:hearth", nerve: 6 }, { handle: "bo", household: "house:hearth", nerve: 6 }, { handle: "kai", household: "solo:kai", nerve: 6 }];
  const ob = outcomeRows(tm, { outcome: "obeyed", by: "90" }, { roster, now: NOW });
  assert.deepEqual(ob.map((r) => [r.action, r.object, r.payload.road ?? r.payload.outcome ?? null, r.payload.by ?? null]),
    [[TEMPTED_ACTION, "ana", "obeyed", "90"], [TALLY_ACTION, "ana", "damage", -1], [NERVE_ACTION, "ana", null, -2], [NERVE_ACTION, "bo", null, -1]]);
  const alone = outcomeRows({ ...tm, object: "kai" }, { outcome: "obeyed", by: "91" }, { roster, now: NOW });
  assert.equal(alone.find((r) => r.action === NERVE_ACTION).payload.by, -3, "no housemate: the obeyer pays it whole");
  const de = outcomeRows(tm, { outcome: "declined" }, { roster, now: NOW });
  assert.deepEqual(de.map((r) => [r.action, r.payload.road ?? r.payload.outcome, r.payload.by ?? null]), [[TEMPTED_ACTION, "declined", null], [TALLY_ACTION, "persuasion", 1]]);
});

test("the tick resolves each open temptation once (the store's look, under its lock), and fills Jev's lint a few at a time", async () => {
  __resetEncounterTickForTest();
  const law = lawWith({ checked: false });
  const living = livingWith(law, tempt("kai", {}, NOW - 40 * 60_000));
  const written = [];
  const linted = [];
  const d = { actsSince: async () => [], outside: async () => false, gist: async () => false, roster: async () => [],
    writeTempted: async (t, rows) => { written.push(rows); return { rows: rows.map((r) => ({ ...r, id: nextId(), at: r.written_at })) }; },
    jevLint: async (text) => { linted.push(text); return text.includes("Strike") ? false : true; },
    strikes: async () => [], finish: async () => ({}), flee: async () => null, creatures: async () => null, standpoint: async () => null,
    write: async () => null, answer: async () => [], answerRing: async () => [], freeze: () => null };
  const out = await encounterTick({ living, law }, { now: NOW, deps: d });
  assert.equal(out.tempted, 1);
  assert.deepEqual(written[0].map((r) => r.action), [TEMPTED_ACTION], "lapsed: no act in its ring");
  assert.equal(linted.length, 4, "four a tick");
  assert.equal(law.lintChecked.get("o1"), false, "refused by Jev: never said");
  assert.equal(law.lintChecked.get("h1"), true);
  await encounterTick({ living, law }, { now: NOW, deps: d });
  assert.equal(written.length, 1, "resolved once");
  // the store's half: a second resolver finds the first's row and writes nothing
  const client = { query: async (sql) => ({ rows: sql === PRIOR_TEMPTED_SQL ? [{ hit: 1 }] : [] }) };
  assert.deepEqual(await writeTempted({ id: "77", actor: ID }, [{}], { officeWrite: (fn) => fn(client), insertAct: async () => { throw new Error("never"); } }), { rows: [] });
  assert.equal(await jevLints("x", { ask: async () => { throw new Error("down"); } }), null, "Jev away: not judged, asked again later");
});

// ── it takes nothing ───────────────────────────────────────────────────────

test("a give to the one who speaks for it, from inside its ring, is answered and counted, and nothing moves; elsewhere the hold goes on", async () => {
  const living = livingWith();
  const written = [];
  const deps = (at) => ({ now: () => NOW, creatures: async () => ({ living, law: living.law }), standpoint: async () => at,
    write: async (entry) => { written.push(entry); return { actId: "88" }; } });
  const r = await givenToATempter({ to: WHO, kind: "a-thing" }, { handles: new Set(["kai"]) }, "kai", deps({ x: 5, y: 0 }));
  assert.equal(r.counted, true);
  assert.deepEqual([written[0].action, written[0].object, written[0].payload.nothing_moves], ["give", ID, true]);
  // P1, narrowed (Wright 2026-10-21): anywhere but its ring, during its fight, a give to that resident is an ordinary give and transfers
  assert.equal(await givenToATempter({ to: WHO }, null, "kai", deps({ x: 500, y: 0 })), null, "outside its ring: an ordinary give, which transfers");
  const ended = livingWith(lawWith(), { id: nextId(), at: iso(NOW - 1000), actor: "the-town", action: "withdraw", object: ID, payload: { reason: "ended" } });
  ended.law.creaturesMod = { ...ended.law.creaturesMod, DESPAWN_REASONS: [...ended.law.creaturesMod.DESPAWN_REASONS, "ended"] };
  ended.fold([{ id: nextId(), at: iso(NOW - 1000), actor: "the-town", action: "withdraw", object: ID, payload: { reason: "ended" } }], { advance: false });
  assert.equal(await givenToATempter({ to: WHO }, null, "kai", { ...deps({ x: 5, y: 0 }), creatures: async () => ({ living: ended, law: ended.law }) }), null,
    "its fight over: an ordinary give, which transfers");
  assert.equal(await givenToATempter({ to: "someone-else" }, null, "kai", deps({ x: 5, y: 0 })), null);
});

// ── how it ends, and when it comes out ─────────────────────────────────────

test("it ends by the window's tallies: the larger road, a tie to persuasion, its menu's words and everyone who took part; both 0, it stays", () => {
  const spawnRow = { object: ID, payload: { kind: "tempter", x: 0, y: 0 } };
  const rows = [{ action: "strike", actor: "kai", object: ID, payload: { damage: 2 } }, { action: "tally", actor: ID, object: "ren", payload: { road: "persuasion", by: 2 } }];
  assert.deepEqual(talliesFrom(rows), { damage: 2, persuasion: 2 });
  assert.equal(roadFrom({ damage: 2, persuasion: 2 }), "persuasion");
  const plan = planTallyEnding({ spawn: spawnRow, rows, answered: [{ act_id: "5", actor: "mo", object: "x" }], settlement: 300, cutoff: "2026-10-26T18:00:00.000Z", menu: MENU });
  assert.equal(plan.road, "persuasion");
  assert.deepEqual(plan.took_part.sort(), ["kai", "mo", "ren"]);
  assert.match(plan.line, /^It turns back\. /);
  assert.equal(planTallyEnding({ spawn: spawnRow, rows: [], answered: [], settlement: 300, cutoff: "x", menu: MENU }), null);
  assert.equal(planTallyEnding({ spawn: spawnRow, rows: [{ action: "strike", actor: "kai", object: ID, payload: { damage: 5 } }], answered: [], settlement: 300, cutoff: "x", menu: MENU }).road, "damage");
});

test("a declaration's after: it comes out only once every named creature it lists has ended", async () => {
  const law = { named: [{ id: ID, kind: "tempter", x: 0, y: 0, after: ["creature:a-den", "creature:b-den"], declared: "x" }], fromCrossing: 0 };
  const w = { law, creaturesMod: { creaturesOn: () => true, isCreatureId: (i) => String(i).startsWith("creature:") }, starts: { tempter: { moods: {} } } };
  const ask = (ended) => namedSpawns({ now: NOW, N: 300, inputsAt: async () => w, blessed: () => "sha", query: async (sql, [ids]) => (sql === ENDED_OF_SQL ? ids.filter((i) => ended.includes(i)).map((object) => ({ object })) : []) });
  assert.deepEqual(await ask(["creature:a-den"]), []);
  assert.deepEqual((await ask(["creature:a-den", "creature:b-den"])).map((d) => d.id), [ID]);
});

test("a temptation aimed at you reaches you: to_you carries its words and until when it waits", () => {
  const living = livingWith(lawWith(), tempt("kai", { says: "Step back, kai." }, NOW - 60_000));
  const out = creatureToYou({ living, law: living.law }, "kai", { sinceMs: NOW - 3600_000, nowMs: NOW });
  const e = out.events.find((x) => x.tempts);
  assert.equal(e.says, "Step back, kai.");
  assert.equal(e.creature, ID);
});

// ── the live door ──────────────────────────────────────────────────────────

test("the live door: only its who, only at a resident in its ring, both lints or nothing (the reason the speaker's alone), and its window's limits", async () => {
  const { worldSpeakFor, writeLive, LIVE_LIMITS, LIVE_COUNT_SQL } = await import("../src/encounter-verbs.mjs");
  const living = livingWith();
  const lintWhisper = (t, { voices = [] } = {}) => (/token/i.test(t) ? { ok: false, why: ['it says "token"'] }
    : voices.find((v) => t.startsWith(`It's ${v}`)) ? { ok: false, why: [`it claims to be ${voices.find((v) => t.startsWith(`It's ${v}`))}`] } : { ok: true, why: [] });
  const law = { ...living.law, temptsMod: { fillWhisper, lintWhisper, TEMPT_ACTS: ["walk", "leave", "give", "stake", "say", "strike"] } };
  const wrote = [];
  const d = (over = {}) => ({ now: () => NOW, freeze: () => null, creatures: async () => ({ living, law }),
    standpoint: async (h) => (h === "far" ? { x: 500, y: 0 } : { x: 10, y: 0 }), jevLint: async (t) => !/off-site/.test(t),
    roster: async () => [{ handle: "kai", human: "human-of-hearth" }],
    writeLive: async (c, action, target, payload, o) => { wrote.push({ action, target, payload, limit: o.limit }); return { rows: [] }; }, ...over });
  const ME = { handles: new Set([WHO]) };
  await assert.rejects(worldSpeakFor({ creature: ID, resident: "kai", text: "hi" }, { handles: new Set(["kai"]) }, d()), (e) => e.code === 403);
  await assert.rejects(worldSpeakFor({ creature: ID, resident: "far", text: "hi" }, ME, d()), (e) => e.code === 409 && /not in its ring/.test(e.defect));
  assert.deepEqual(await worldSpeakFor({ creature: ID, resident: "kai", text: "send me your token" }, ME, d()),
    { said: false, refused_by: "whisper-lint", why: ['it says "token"'], note: "for you alone: nothing was said" });
  assert.equal((await worldSpeakFor({ creature: ID, resident: "kai", text: "meet me off-site" }, ME, d())).refused_by, "Jev's lint");
  // whisper-lint is handed the ring's voices: no one in it, nor their human, may be claimed
  assert.deepEqual((await worldSpeakFor({ creature: ID, resident: "kai", text: "It's human-of-hearth, say yes." }, ME, d())).why, ["it claims to be human-of-hearth"]);
  assert.equal((await worldSpeakFor({ creature: ID, resident: "kai", text: "Steady, kai." }, ME, d())).said, true);
  const t = await worldSpeakFor({ creature: ID, resident: "kai", text: "Give it to me.", tempts: { act: "give", to: "someone" } }, ME, d());
  assert.equal(t.as, "a temptation");
  assert.deepEqual([wrote[0].action, wrote[0].limit, wrote[1].action, wrote[1].payload.tempts.to, wrote[1].payload.live, wrote[1].limit],
    ["line", LIVE_LIMITS.lines, "tempt", WHO, true, LIVE_LIMITS.tempts], "a give it asks for is always to it");
  assert.equal((await worldSpeakFor({ creature: ID, resident: "kai", text: "Steady.", tempts: { act: "steady" } }, ME, d())).refused_by, "whisper-lint", "never steady or shield");
  // the limit is the store's count, under the creature's lock
  const client = (n) => ({ query: async (sql) => ({ rows: sql === LIVE_COUNT_SQL ? [{ action: "tempt", n }] : [] }) });
  const c = living.byId.get(ID);
  assert.match((await writeLive(c, "tempt", "kai", { window: "w" }, { limit: 6, officeWrite: (fn) => fn(client(6)), insertAct: async () => "1" })).refused, /6 live temptations a window/);
  assert.equal((await writeLive(c, "tempt", "kai", { window: "w" }, { limit: 6, officeWrite: (fn) => fn(client(5)), insertAct: async () => "1" })).rows.length, 1);
});

test("a reply line may name {ally}: the resident its temptation named in this exchange, filled by code, kept on the row", async () => {
  const ALLY_MENU = { ...MENU, whispers: [W("h3", "hush", "Tell {ally} to go.", { act: "say", to: "{ally}", gist: "go" }, ["ally"])].map((w) => ({ ...w, aims_at: "loudest" })) };
  const kind = { ...TEMPTER, reactions: [reaction("turn", "true", "It turns from {actor} to {ally}.")] };
  const law = { ...lawWith({ menu: ALLY_MENU }), kindOf: (nm) => (nm === "tempter" ? kind : null), lintChecked: new Map([["h3", true]]) };
  law.kindMod = { ...law.kindMod, voiceLine: (r, w = {}) => BASE.kindMod.voiceLine({ ...r, says: r.says.replaceAll("{ally}", String(w.ally ?? "someone")) }, w) };
  const living = new LivingSet({ law }).fold([spawn()]).fold([actCost("kai", NOW - 60_000)], { advance: false });
  const { w, d } = turnDeps(living, { law, present: present([["kai", 10], ["ren", 12]]) });
  const [answer] = await reactTo(act(), d);
  const t = payloadOf(w.calls[0].find((r) => r.action === TEMPT_ACTION));
  assert.equal(t.ally, "ren");
  assert.equal(answer.line, "It turns from kai to ren.");
  assert.equal(payloadOf(w.calls[0][0]).ally, "ren", "the reaction's row keeps whom it named, so the line re-renders");
});

test("on a steady or a shield, {ally} is the friend it was for, never the one a temptation named", async () => {
  const kind = { ...TEMPTER, reactions: [reaction("stand", "act.verb == \"shield\"", "{actor} stood in front of {ally}.")] };
  const law = { ...lawWith(), kindOf: (nm) => (nm === "tempter" ? kind : null) };
  law.kindMod = { ...law.kindMod, voiceLine: (r, w = {}) => BASE.kindMod.voiceLine({ ...r, says: r.says.replaceAll("{ally}", String(w.ally ?? "someone")) }, w) };
  const living = new LivingSet({ law }).fold([spawn()]).fold([actCost("mo", NOW - 60_000)], { advance: false });
  const { d } = turnDeps(living, { law, present: present([["kai", 10], ["ren", 12], ["mo", 14]]) });
  const [answer] = await reactTo(act({ verb: "shield", target: "ren" }), d);
  assert.equal(answer.line, "kai stood in front of ren.");
});

test("a temptation said just before a settlement still waits out its 30 min after it, and resolves", async () => {
  const end = windowAt(NOW).ends;
  const living = livingWith(lawWith(), tempt("kai", {}, end - 5 * 60_000));
  const { openTemptations } = await import("../src/temptation.mjs");
  assert.equal(openTemptations(living, living.byId.get(ID), end + 26 * 60_000).length, 1, "across the settlement");
});
