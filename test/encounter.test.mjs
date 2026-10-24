// encounter.test.mjs — an encounter with a finishable creature, the office half
// (src/encounter.mjs, src/encounter-verbs.mjs, src/creatures.mjs § creatureTurn).
//
// RULED (Darko 2026-10-20 22:47; 2026-10-21 08:34 and 08:39, shape B with D2 and
// D4): nerve 10 per resident, refilled at each settlement; every act inside a
// finishable creature's ring costs 1; strike costs 2 and wears resolve down, and
// the strike that reaches 0 finishes it; ease full finishes it for the resident
// who filled it; every reaction may press one resident in the ring, Jev choosing
// from a menu code resolves; a shield takes the press first; housemates split it;
// at 0 you flee through the exit lock. Everything resets at the settlement.
//
// The world's grammar for a finishable kind is not at the pinned ref yet (its PR
// is creatures/encounter-verbs on postmark-world), so the kind here is the pinned
// law's own parsed kind dressed as the grammar parses one: `finishable`,
// `resolve`, `strike`, `ease`, and reactions whose effects carry `press` and
// `ease` (the stub mechanic). Its numbers are the fixture's, never a real kind's.
//
// THE CAN-FAIL FLIPS (each reds a case below): charge the act cost on an entry;
// drop the act-cost lookup in writeActCostOnce; let the window swallow the cost;
// read the press menu's `alone` without the household; move a shield's press to
// the target; give the target the smaller half of a split; let Jev judge a reaction
// that fills ease; skip the strike's nerve refusal; let a strike land at resolve 0;
// finish on any strike instead of the one that reaches 0; count strikes from before
// the settlement; forget to flee at 0.

import { test as nodeTest } from "node:test";
import assert from "node:assert/strict";

import { FINISH_ACTION, FINISH_WHY, LivingSet, SLICE_FIELDS, buildSlice, loadCreatureLaw, reactTo, sampleWith, writeReaction, writeCost, PRIOR_ACT_COST_SQL } from "../src/creatures.mjs";
import {
  ENCOUNTER_DIALS, NERVE_ACTION, NERVE_NOTE, applyEase, easeScope, encounterRead, foldNerve, liveShieldOn, nerveOf, nerveRead,
  pressLanding, pressMenu, resolveOf, ringRoster, windowAt, wornBy,
} from "../src/encounter.mjs";
import { encounterEntries, encounterPairs, encounterTick, settleResolve, worldEncounter, __resetEncounterTickForTest } from "../src/encounter-verbs.mjs";
import { whyNot } from "../src/creature-verbs.mjs";
import { NO_WORLD, worldModuleUrl } from "./fixture-paths.mjs";

const test = (name, fn) => nodeTest(name, { skip: NO_WORLD || false }, fn);

const KIND_TEXT = `kind: keeper
name: a test keeper
ring_m: 40
what: >
  A fixture for the encounter's tests.
moods:
  temper: 0..3 = 1 | calm | stirred | angry | wild
reaction notice "it notices": when true says It notices {actor}.
`;
const BASE = NO_WORLD ? null : await loadCreatureLaw({ ref: "the pinned clone", importTool: (f) => import(worldModuleUrl("tools", f)),
  readText: (path) => { if (path !== "WORLD/kinds/keeper.kind") throw new Error(`no fixture kind at ${path}`); return KIND_TEXT; } });
const PRESS_ON = ["actor", "striker", "shielder", "loudest", "alone"];
const reaction = (name, src, effects, says) => ({ name, sentence: name, when: BASE.kindMod.parseCondition(src), src, effects, says });
/** The stub finishable kind, as the grammar parses `finishable: yes`, `resolve: 10`, `strike: 4`, `ease: 2 mine`. */
const KEEPER = NO_WORLD ? null : {
  ...BASE.kindOf("keeper"), finishable: true, resolve: 10, strike: 4, ease: { target: 2, by: "mine" },
  reactions: [
    reaction("bristle", `act.verb == "strike"`, [{ do: "press", n: 2, on: ["striker", "loudest"] }], "It bristles at {actor} and turns on {target}."),
    reaction("glare", `act.verb == "say"`, [{ do: "press", n: 2, on: PRESS_ON }], "It glares at {target}."),
    reaction("regard", `act.verb == "watch"`, [{ do: "ease", by: 1 }], "It regards {actor}."),
    reaction("notice", `act.verb == "walk"`, [{ do: "nothing" }], "It notices {actor}."),
    reaction("startle", `act.verb == "steady" or act.verb == "shield"`, [{ do: "press", n: 1, on: ["shielder", "actor"] }], "It starts, and snaps at {target}."),
  ],
};
/** The same kind as a Mists decoration: none of the encounter's words. */
const PLAIN = NO_WORLD ? null : { ...BASE.kindOf("keeper"), reactions: [reaction("glare", `act.verb == "say"`, [{ do: "nothing" }], "It glares at {actor}.")] };
/** The law as the grammar's world PR makes it: the encounter's verbs, the press's menu, and a scope that reads the window. */
const lawWith = ({ encounter = true, kinds = { keeper: KEEPER, plain: PLAIN } } = {}) => (NO_WORLD ? null : {
  ...BASE, kindOf: (name) => kinds[name] ?? null,
  kindMod: {
    ...BASE.kindMod,
    // a law WITHOUT the encounter's verbs is made by taking them away: the pinned grammar (world#269) carries them
    ...(encounter ? { ENCOUNTER_VERBS: ["strike", "steady", "shield"], PRESS_ON } : { ENCOUNTER_VERBS: undefined }),
    // {target}, as the grammar's voiceLine fills it (the pinned one knows actor, offered and heard)
    voiceLine: (r, words = {}) => BASE.kindMod.voiceLine({ ...r, says: r.says.replaceAll("{target}", String(words.target ?? words.actor)) }, words),
    scopeOf: (state, act, actor, enc = {}) => {
      const s = BASE.kindMod.scopeOf(state, act, actor);
      if (enc.resolve != null) s.self.resolve = enc.resolve;
      s.ease = { mine: enc.ease?.mine ?? 0, all: enc.ease?.all ?? 0, first_m: enc.ease?.first_m ?? 0 };
      return s;
    },
  },
});

const NOW = Date.parse("2026-10-26T13:00:00Z"); // inside the window 12:00 → 18:00? no: 06:00Z → 18:00Z
const iso = (ms) => new Date(ms).toISOString();
const ID = "creature:keeper-den";
let n = 1000;
const nextId = () => String(++n);
const spawn = (id = ID, kind = "keeper", { x = 0, y = 0 } = {}) =>
  ({ id: nextId(), at: iso(NOW - 3 * 24 * 3600_000), actor: "the-town", action: "spawn", object: id, payload: { kind, at: iso(NOW - 3 * 24 * 3600_000), stays: true, x, y } });
const row = (actor, action, object, payload, at = NOW - 60_000) => ({ id: nextId(), at: iso(at), actor, action, object, payload });
const nerveRowOf = (on, by, why = "act", at = NOW - 60_000, extra = {}) => row(ID, NERVE_ACTION, on, { by, why, act: "1", creature: ID, ...extra }, at);
const strikeRowOf = (by, damage = 4, at = NOW - 60_000) => row(by, "strike", ID, { kind: "keeper", cost: 2, damage }, at);
/** The keeper, spawned, then `rows` folded as the process's own writes are (whatever their ids). */
const livingWith = (...rows) => new LivingSet({ law: lawWith() }).fold([spawn()]).fold(rows, { advance: false });
const act = (over = {}) => ({ actor: "kai", verb: "say", actId: nextId(), atIso: iso(NOW), point: { x: 10, y: 0 }, ...over });

/** Presence at the creature: residents and their distances. Households: ana and bo share one; the rest live alone. */
const HOMES = { ana: "hearth", bo: "hearth" };
const lookup = (h) => (HOMES[h] ? { key: `house:${HOMES[h]}`, slug: HOMES[h], residents: Object.keys(HOMES).filter((k) => HOMES[k] === HOMES[h]) } : { key: `solo:${h}`, slug: null, residents: [h] });
const presentOf = (list) => async () => ({ residents: list.map(([handle, distance_m]) => ({ handle, distance_m })) });

function recordingWrite() {
  const calls = [];
  const write = async (rows) => {
    calls.push(rows);
    return { prior: false, rows: rows.map((r) => ({ id: nextId(), at: r.written_at, actor: r.actor, action: r.action, object: r.object, payload: r.payload })) };
  };
  return { calls, write };
}
const payloadOf = (r) => (typeof r.payload === "string" ? JSON.parse(r.payload) : r.payload);
const deps = (living, over = {}) => {
  const w = recordingWrite(), costs = recordingWrite(), fled = [];
  return { w, costs, fled, d: { living, law: living.law, write: w.write, writeCost: costs.write, now: NOW, env: { CREATURE_JUDGE: "code" },
    present: presentOf([["kai", 10]]), households: async () => lookup, flee: (h) => fled.push(h), ...over } };
};

// ── nerve ──────────────────────────────────────────────────────────────────

test("nerve: 10 a window; every row carries its own numbers; clamped at 0 and 10; full again at the settlement", () => {
  assert.equal(ENCOUNTER_DIALS.nerve_max.value, 10);
  assert.equal(ENCOUNTER_DIALS.strike_cost.value, 2);
  const rows = [
    row("kai", "strike", ID, { cost: 2, damage: 4 }),          // kai -2
    row("kai", "steady", "ren", { creature: ID, cost: 1, gives: 2 }), // kai -1, ren +2
    nerveRowOf("kai", -2, "press"),                           // kai -2
    row("ren", "shield", "kai", { creature: ID, cost: 1 }),   // ren -1
  ];
  assert.equal(foldNerve(rows, "kai"), 5);
  assert.equal(foldNerve(rows, "ren"), 9, "a steady at full is lost (10 + 2 is 10), then the shield costs 1");
  assert.equal(foldNerve([nerveRowOf("mo", -7), nerveRowOf("mo", -7), row("x", "steady", "mo", { cost: 1, gives: 2 })], "mo"), 2, "clamped at 0, then given 2");
  const living = livingWith(nerveRowOf("kai", -3, "press", NOW - 60_000), nerveRowOf("kai", -4, "press", windowAt(NOW).start - 60_000));
  assert.equal(nerveOf(living, "kai", NOW), 7, "a row from before the settlement is spent with that window");
  assert.equal(nerveOf(living, "kai", windowAt(NOW).ends + 1), 10, "the next settlement fills it whole");
});

test("the glance shows your nerve when it is spent or a finishable creature is near, with the one plain line; never otherwise", () => {
  const law = lawWith();
  const living = livingWith(nerveRowOf("kai", -3));
  assert.deepEqual(nerveRead({ living, law }, "kai", { x: 500, y: 0 }, NOW), { left: 7, of: 10, fills_at: iso(windowAt(NOW).ends), note: NERVE_NOTE });
  assert.equal(nerveRead({ living, law }, "ren", { x: 500, y: 0 }, NOW), null, "full and far: nothing");
  assert.equal(nerveRead({ living, law }, "ren", { x: 20, y: 0 }, NOW)?.left, 10, "full but in the ring: shown");
});

// ── the act's cost ─────────────────────────────────────────────────────────

test("an act made inside the ring costs 1; a walk's entry is free (D2); an act outside the ring is free; a Mists creature costs nothing", async () => {
  const living = livingWith();
  const { w, d } = deps(living);
  await reactTo(act(), d);
  const nerve = w.calls[0].filter((r) => r.action === NERVE_ACTION).map(payloadOf);
  assert.deepEqual(nerve.find((p) => p.why === "act"), { ...nerve.find((p) => p.why === "act"), by: -1, why: "act", creature: ID });
  assert.equal(w.calls[0].find((r) => r.action === NERVE_ACTION && payloadOf(r).why === "act").object, "kai");

  const entry = deps(livingWith());
  await reactTo(act({ verb: "walk", moment: "entry" }), entry.d);
  assert.equal(entry.w.calls.flat().filter((r) => r.action === NERVE_ACTION).length, 0, "walking into the ring costs nothing");

  const far = deps(livingWith());
  const watcher = far.d.living.byId.get(ID);
  await reactTo(act({ verb: "watch", point: { x: 100, y: 0 } }), { ...far.d, aimed: watcher });
  assert.equal(far.w.calls.flat().filter((r) => r.action === NERVE_ACTION && payloadOf(r).why === "act").length, 0, "watched from sight, outside the ring: free");

  const mists = new LivingSet({ law: lawWith() }).fold([spawn("creature:plain-1", "plain")]);
  const m = deps(mists);
  await reactTo(act(), m.d);
  assert.equal(m.w.calls.flat().filter((r) => r.action === NERVE_ACTION).length, 0);
});

test("an act's cost is written once however many rings hold it: the store's look, under the act's lock", async () => {
  const seen = [];
  let prior = false;
  const client = { query: async (sql, args) => {
    seen.push([sql, args]);
    if (/SELECT 1 AS here FROM acts/.test(sql)) return { rows: [{ here: 1 }] }; // the trigger act is on the record
    return { rows: sql === PRIOR_ACT_COST_SQL && prior ? [{ id: "1" }] : [] };
  } };
  const officeWrite = async (fn) => fn(client);
  let inserted = 0;
  const insertAct = async () => String(++inserted);
  const living = livingWith();
  const { w, d } = deps(living);
  await reactTo(act({ actId: "7001" }), d);
  const rows = w.calls[0];
  await writeReaction(rows, { officeWrite, insertAct });
  assert.ok(seen.some(([sql, a]) => /pg_advisory_xact_lock/.test(sql) && a[0] === "nerve-act:kai:7001"));
  const first = inserted;
  prior = true;
  const again = await writeCost(rows.filter((r) => r.action === NERVE_ACTION && payloadOf(r).why === "act"), { officeWrite, insertAct });
  assert.equal(inserted, first, "a second ring's cost for the same act writes nothing");
  assert.deepEqual(again.rows, []);
});

test("inside the 10 s window an act gets no reaction, and still costs its nerve", async () => {
  const living = livingWith();
  const { w, costs, d } = deps(living);
  await reactTo(act({ actId: "8001", verb: "walk" }), d);
  const answers = await reactTo(act({ actId: "8002", verb: "walk", atIso: iso(NOW + 3000) }), { ...d, now: NOW + 3000 });
  assert.deepEqual(answers, []);
  assert.equal(w.calls.length, 1, "one reaction");
  assert.deepEqual(costs.calls.flat().map((r) => [r.object, payloadOf(r).why, payloadOf(r).by, payloadOf(r).act]), [["kai", "act", -1, "8002"]]);
  assert.equal(nerveOf(living, "kai", NOW + 3000), 8);
});

// ── the press ──────────────────────────────────────────────────────────────

test("the press's menu: code resolves each entry to one resident in the ring who still has nerve; the same resident keeps the first name", () => {
  const living = livingWith(
    strikeRowOf("ren", 4, NOW - 50_000),
    nerveRowOf("mo", -1, "act", NOW - 40_000), nerveRowOf("mo", -1, "act", NOW - 30_000),
    row("bo", "shield", "ana", { creature: ID, cost: 1 }, NOW - 20_000),
    nerveRowOf("zed", -10, "press", NOW - 10_000),
  );
  const roster = ringRoster({ residents: [["kai", 10], ["ren", 12], ["mo", 20], ["ana", 25], ["bo", 30], ["zed", 5]].map(([handle, distance_m]) => ({ handle, distance_m })) },
    { ring: 40, lookup, living, now: NOW });
  const menu = pressMenu(PRESS_ON, { actor: "kai", roster, living, creatureId: ID, now: NOW });
  assert.deepEqual(menu.map((e) => [e.who, e.handle]), [["actor", "kai"], ["striker", "ren"], ["shielder", "bo"], ["loudest", "mo"]],
    "every lone resident (kai, ren, mo) is already named, so alone adds no one; ana and bo share a hearth");
  const alone = pressMenu(["alone"], { actor: "kai", roster, living, creatureId: ID, now: NOW });
  assert.ok(["kai", "ren", "mo"].includes(alone[0].handle), "ana and bo share a hearth, so neither is alone");
  assert.ok(!menu.some((e) => e.handle === "zed"), "zed is spent: no press lands on them");
  assert.deepEqual(pressMenu(["striker"], { actor: "kai", roster: roster.filter((r) => r.handle !== "ren"), living, creatureId: ID, now: NOW }), [], "the striker gone from the ring: no entry");
});

test("Jev picks whom it presses from the menu, its own die samples it, and the row keeps the menu, the odds and the roll", async () => {
  const living = livingWith(strikeRowOf("ren", 4, NOW - 50_000), nerveRowOf("mo", -1, "act", NOW - 40_000), nerveRowOf("mo", -1, "act", NOW - 30_000));
  let asked = null;
  const { w, d } = deps(living, {
    env: { TYPESAFE_API_KEY: "k" },
    present: presentOf([["kai", 10], ["ren", 12], ["mo", 20]]),
    ask: async (state, questions) => { asked = { state, questions }; return { response: { answers: { reaction: { probabilities: { glare: 1 } }, press_on: { probabilities: { kai: 0, ren: 0.9, mo: 0.1 } } } } }; },
  });
  const [answer] = await reactTo(act({ actId: "9101" }), d);
  assert.ok(asked.questions.press_on, "the second question is asked");
  assert.deepEqual(Object.keys(asked.questions.press_on.criteria).sort(), ["kai", "mo", "ren"]);
  const p = payloadOf(w.calls[0][0]);
  assert.equal(p.press.judged_by, "jev");
  assert.deepEqual(p.press.menu.map((e) => e.who), ["actor", "striker", "loudest", "alone"].filter((x) => p.press.menu.some((e) => e.who === x)));
  assert.equal(p.press.on, sampleWith(p.press.roll, p.press.odds).picked, "the pick re-derives from the row");
  assert.equal(p.press.on, "ren");
  assert.deepEqual(p.press.landed, [{ on: "ren", by: -2 }]);
  assert.equal(answer.line, "It glares at ren.");
  assert.deepEqual(answer.pressed, [{ on: "ren", nerve: -2 }]);
  // the creature knows the dyad (D4): the ring in its slice, each with household and human, all on the whitelist
  assert.deepEqual(asked.state.ring.map((r) => [r.name, r.human]), [["kai", "human-of-kai"], ["ren", "human-of-ren"], ["mo", "human-of-mo"]]);
});

test("a shield takes the next press aimed at its friend, once; a new shield of yours replaces your old one", () => {
  const roster = ringRoster({ residents: [{ handle: "kai", distance_m: 10 }, { handle: "ren", distance_m: 12 }, { handle: "mo", distance_m: 14 }] }, { ring: 40, lookup, now: NOW });
  const shield = row("ren", "shield", "kai", { creature: ID, cost: 1 }, NOW - 30_000);
  const living = livingWith(shield);
  assert.deepEqual(pressLanding("kai", 2, { roster, living, now: NOW }), [{ on: "ren", by: -2, shield: shield.id, shielded: "kai" }]);
  living.fold([nerveRowOf("ren", -2, "press", NOW - 10_000, { shield: shield.id, shielded: "kai" })]);
  assert.equal(liveShieldOn(living, "kai", NOW), null, "used up");
  assert.deepEqual(pressLanding("kai", 2, { roster, living, now: NOW }), [{ on: "kai", by: -2 }]);
  const moved = livingWith(row("ren", "shield", "kai", { creature: ID, cost: 1 }, NOW - 30_000), row("ren", "shield", "mo", { creature: ID, cost: 1 }, NOW - 20_000));
  assert.equal(liveShieldOn(moved, "kai", NOW), null, "ren's newer shield is on mo");
  assert.equal(liveShieldOn(moved, "mo", NOW)?.actor, "ren");
});

test("housemates in the ring split a press (D2), the one it was aimed at paying the larger half", () => {
  const H3 = { ...HOMES, cy: "hearth" };
  const lk = (h) => (H3[h] ? { key: "house:hearth", slug: "hearth" } : { key: `solo:${h}`, slug: null });
  const ring = (...hs) => ringRoster({ residents: hs.map((h, i) => ({ handle: h, distance_m: 5 + i })) }, { ring: 40, lookup: lk, now: NOW });
  const living = livingWith();
  assert.deepEqual(pressLanding("ana", 2, { roster: ring("ana", "bo"), living, now: NOW }), [{ on: "ana", by: -1, split_of: 2 }, { on: "bo", by: -1, split_of: 2 }]);
  assert.deepEqual(pressLanding("ana", 1, { roster: ring("ana", "bo"), living, now: NOW }), [{ on: "ana", by: -1, split_of: 1 }]);
  assert.deepEqual(pressLanding("bo", 2, { roster: ring("ana", "bo", "cy"), living, now: NOW }), [{ on: "bo", by: -1, split_of: 2 }, { on: "ana", by: -1, split_of: 2 }]);
  assert.deepEqual(pressLanding("kai", 2, { roster: ring("kai", "ana", "bo"), living, now: NOW }), [{ on: "kai", by: -2 }], "a house of one pays it whole");
});

// ── ease ───────────────────────────────────────────────────────────────────

test("ease: the reaction that fills it finishes, taken by code with no die; it empties at the settlement", async () => {
  const living = livingWith();
  let asked = 0;
  const { w, d } = deps(living, { env: { TYPESAFE_API_KEY: "k" }, ask: async () => { asked += 1; throw new Error("never"); } });
  const c = living.byId.get(ID);
  await reactTo(act({ verb: "watch", actId: "9201" }), { ...d, aimed: c });
  assert.deepEqual(easeScope(c, KEEPER, "kai", "solo:kai", NOW), { mine: 1, all: 1, first_m: 0 });
  assert.ok(!w.calls[0].some((r) => r.action === FINISH_ACTION), "one point of two finishes nothing");
  await reactTo(act({ verb: "watch", actId: "9202", atIso: iso(NOW + 20_000) }), { ...d, aimed: c, now: NOW + 20_000 });
  const second = w.calls[1];
  assert.ok(second.some((r) => r.action === FINISH_ACTION && payloadOf(r).by === "kai"), "full: kai finishes it");
  assert.equal(payloadOf(second[0]).why, FINISH_WHY);
  assert.equal(asked, 0, "an earned finish is never Jev's to judge");
  assert.deepEqual(easeScope(c, KEEPER, "kai", "solo:kai", windowAt(NOW).ends + 1), { mine: 0, all: 0, first_m: 0 }, "the settlement empties it");
});

test("ease by households: one point per household per window, whatever +n says; a reset empties it", () => {
  const kind = { ...KEEPER, ease: { target: 2, by: "households" } };
  const c = { id: ID, ease: null };
  const plus = [{ do: "ease", by: 3 }];
  let r = applyEase(c, kind, plus, "ana", "house:hearth", NOW);
  assert.equal(r.filled, false);
  c.ease = r.ease;
  r = applyEase(c, kind, plus, "bo", "house:hearth", NOW + 60_000);
  assert.equal(r.filled, false, "a housemate adds no second point");
  c.ease = r.ease;
  r = applyEase(c, kind, plus, "kai", "solo:kai", NOW + 120_000);
  assert.equal(r.filled, true, "a second household fills it");
  assert.equal(easeScope({ ease: r.ease }, kind, "mo", "solo:mo", NOW + 180_000).first_m, 3);
  assert.deepEqual(applyEase({ ease: r.ease }, kind, [{ do: "ease", reset: true }], "mo", "solo:mo", NOW).ease.households, {});
});

// ── strike ─────────────────────────────────────────────────────────────────

function strikeDeps(living, { law = lawWith(), at = { x: 10, y: 0 }, nerveGuard = true } = {}) {
  const written = [], finished = [], fled = [], answered = [];
  return {
    written, finished, fled, answered,
    d: {
      now: () => NOW, clock: () => NOW, env: { CREATURE_JUDGE: "code" },
      freeze: () => null,
      creatures: async () => ({ living, law }),
      standpoint: async (h) => (h === "kai" ? at : h === "ren" ? { x: 12, y: 0 } : h === "far" ? { x: 300, y: 0 } : { x: 15, y: 0 }),
      write: async (entry, key, { guard }) => {
        // the guard's own queries, answered from the living set (the store's truth in a sandbox drive)
        const client = { query: async (sql, args) => {
          if (/pg_advisory/.test(sql)) return { rows: [] };
          if (/action = 'strike'/.test(sql)) return { rows: living.encounter.filter((r) => r.action === "strike" && r.object === args[0]).map((r) => ({ ...r })) };
          if (/action IN/.test(sql)) return { rows: nerveGuard ? living.encounter.map((r) => ({ ...r })) : [] };
          return { rows: [] };
        } };
        await guard(client);
        const id = nextId();
        written.push({ id, ...entry });
        return { actId: id, written_at: iso(NOW) };
      },
      answer: async (a) => { answered.push(a); return [{ id: ID, kind: "keeper", line: "It bristles.", reaction: "bristle" }]; },
      answerRing: async (a) => { answered.push(a); return []; },
      strikes: async (id) => living.encounter.filter((r) => r.action === "strike" && r.object === id),
      finish: async (c, a) => { finished.push(a); return { written: true, id: nextId() }; },
      flee: (h) => fled.push(h),
    },
  };
}
const KEY = { handles: new Set(["kai"]), household: null };

test("strike: from inside the ring, it costs 2 and takes its kind's resolve; the strike that reaches 0 finishes, and only that one", async () => {
  const living = livingWith(strikeRowOf("ren", 4, NOW - 50_000), strikeRowOf("mo", 4, NOW - 40_000));
  const s = strikeDeps(living);
  const r = await worldEncounter({ act: "strike", creature: ID }, KEY, s.d);
  assert.deepEqual(s.written[0].payload, { kind: "keeper", cost: 2, damage: 4, window: windowAt(NOW).id });
  assert.equal(r.resolve.left, 0);
  assert.deepEqual(r.nerve, { left: 8, of: 10 });
  assert.deepEqual(s.finished, [{ actor: "kai", actId: s.written[0].id }], "kai's strike took the last of it: kai finished it");
  assert.equal(r.finished, true);
  assert.equal(s.answered[0].verb, "strike", "the reply is the creature's reaction to the strike");
  assert.deepEqual(wornBy(10, [strikeRowOf("a", 6), strikeRowOf("b", 6), strikeRowOf("c", 6)]).actor, "b", "the strike that crossed 0, not the last");
});

test("strike refusals: less nerve than it costs (D1), resolve already 0 this window (D4), outside the ring, a creature that cannot be struck; nothing written", async () => {
  const spent = livingWith(nerveRowOf("kai", -9, "press"));
  const a = strikeDeps(spent);
  await assert.rejects(worldEncounter({ act: "strike", creature: ID }, KEY, a.d), (e) => e.code === 409 && /takes 2 nerve; you have 1/.test(e.defect));
  const worn = livingWith(strikeRowOf("ren", 10));
  const b = strikeDeps(worn);
  await assert.rejects(worldEncounter({ act: "strike", creature: ID }, KEY, b.d), (e) => e.code === 409 && /already worn down/.test(e.defect));
  const c = strikeDeps(livingWith(), { at: { x: 100, y: 0 } });
  await assert.rejects(worldEncounter({ act: "strike", creature: ID }, KEY, c.d), (e) => e.code === 409 && /from inside its ring/.test(e.defect));
  const plain = new LivingSet({ law: lawWith() }).fold([spawn("creature:plain-1", "plain")]);
  await assert.rejects(worldEncounter({ act: "strike", creature: "creature:plain-1" }, KEY, strikeDeps(plain).d), (e) => e.code === 422 && /cannot be struck/.test(e.defect));
  for (const s of [a, b, c]) assert.equal(s.written.length, 0);
  // the guard is the record's word: the RAM says enough nerve, the store says not
  const raced = livingWith();
  const g = strikeDeps(raced);
  g.d.write = async (entry, key, { guard }) => guard({ query: async (sql) => ({ rows: /action IN/.test(sql) ? [nerveRowOf("kai", -9, "press")] : [] }) });
  await assert.rejects(worldEncounter({ act: "strike", creature: ID }, KEY, g.d), (e) => e.code === 409 && /you have 1/.test(e.defect));
});

test("resolve is full again at each settlement; a finish already recorded stays", () => {
  const living = livingWith(strikeRowOf("ren", 10, NOW - 60_000), row(ID, FINISH_ACTION, ID, { by: "ren", act: "1" }));
  const c = living.byId.get(ID);
  assert.equal(resolveOf(living, c, KEEPER, NOW), 0);
  const next = windowAt(NOW).ends + 60_000;
  assert.equal(resolveOf(living, c, KEEPER, next), 10, "one clock: the settlement fills it");
  assert.deepEqual(c.finishes.map((f) => f.by), ["ren"], "the finish is the record's, untouched by the reset");
  assert.deepEqual(encounterRead({ living }, c, KEEPER, { handle: "kai", now: next }).resolve, { left: 10, of: 10, a_strike_takes: 4, fills_at: iso(windowAt(next).ends) });
});

test("fail closed: a blessed law with no encounter verbs refuses every one, and shows none", async () => {
  const living = livingWith();
  const law = lawWith({ encounter: false });
  const s = strikeDeps(living, { law });
  for (const verb of ["strike", "steady", "shield"])
    await assert.rejects(worldEncounter({ act: verb, creature: ID, resident: "ren" }, KEY, s.d), (e) => e.code === 409 && /not law yet/.test(e.defect));
  assert.deepEqual(encounterPairs({ here: { x: 10, y: 0 }, actor: "kai", living, law, residents: [] }), []);
});

// ── steady and shield ──────────────────────────────────────────────────────

test("steady gives a resident in the same ring 2 for your 1; shield is written on them; both are answered as public acts", async () => {
  const living = livingWith(nerveRowOf("ren", -5, "press"));
  const s = strikeDeps(living);
  const r = await worldEncounter({ act: "steady", resident: "ren" }, KEY, s.d);
  assert.deepEqual(s.written[0].payload, { creature: ID, cost: 1, gives: 2, window: windowAt(NOW).id });
  assert.deepEqual(r.nerve, { left: 9, of: 10 });
  assert.deepEqual(r.their_nerve, { left: 7, of: 10 });
  assert.equal(s.answered[0].verb, "steady");
  assert.equal(s.answered[0].target, "ren");
  const sh = await worldEncounter({ act: "shield", resident: "ren" }, KEY, s.d);
  assert.equal(s.written[1].action, "shield");
  assert.match(sh.note, /next press aimed at ren lands on you/);
  assert.equal(liveShieldOn(living, "ren", NOW)?.actor, "kai");
});

test("steady and shield refusals: yourself, a resident not in your ring, a resident with no nerve left", async () => {
  const living = livingWith(nerveRowOf("ren", -10, "press"));
  const s = strikeDeps(living);
  await assert.rejects(worldEncounter({ act: "steady", resident: "kai" }, KEY, s.d), (e) => e.code === 422 && /yourself/.test(e.defect));
  await assert.rejects(worldEncounter({ act: "shield", resident: "far" }, KEY, s.d), (e) => e.code === 409 && /not in the same ring/.test(e.defect));
  await assert.rejects(worldEncounter({ act: "steady", resident: "ren" }, KEY, s.d), (e) => e.code === 409 && /no nerve left/.test(e.defect));
  assert.equal(s.written.length, 0);
});

// ── flee at 0 ──────────────────────────────────────────────────────────────

test("at 0 a resident flees: a press that empties them, and a strike that empties the striker", async () => {
  const living = livingWith(nerveRowOf("ren", -9, "press"));
  const { d, fled } = deps(living, { present: presentOf([["kai", 10], ["ren", 12]]),
    env: { TYPESAFE_API_KEY: "k" }, ask: async () => ({ response: { answers: { reaction: { probabilities: { glare: 1 } }, press_on: { probabilities: { kai: 0, ren: 1 } } } } }) });
  await reactTo(act({ actId: "9301" }), d);
  assert.deepEqual(fled, ["ren"], "ren had 1; the press took it");

  const striker = livingWith(nerveRowOf("kai", -8, "press"));
  const s = strikeDeps(striker);
  const r = await worldEncounter({ act: "strike", creature: ID }, KEY, s.d);
  assert.deepEqual(s.fled, ["kai"]);
  assert.match(r.fled, /you flee, and stay out until the settlement/);
});

test("the tick repairs what a fault stopped: a strike's missing finish, and a resident at 0 not yet outside", async () => {
  __resetEncounterTickForTest();
  const living = livingWith(strikeRowOf("ren", 10), nerveRowOf("mo", -10, "press"));
  const finished = [], fled = [];
  const d = { strikes: async (id) => living.encounter.filter((r) => r.action === "strike" && r.object === id),
    finish: async (c, a) => { finished.push(a); return { written: true, id: nextId() }; }, flee: async (h) => { fled.push(h); return { fled: "nerve" }; },
    creatures: async () => null, standpoint: async () => null, write: async () => null, answer: async () => [], answerRing: async () => [], freeze: () => null };
  const out = await encounterTick({ living, law: lawWith() }, { now: NOW, deps: d });
  assert.equal(finished[0].actor, "ren");
  assert.deepEqual(fled, ["mo"]);
  assert.deepEqual(out, { finished: 1, fled: 1 });
  await encounterTick({ living, law: lawWith() }, { now: NOW, deps: d });
  assert.equal(finished.length, 1, "finished: nothing to repair");
  assert.deepEqual(fled, ["mo"], "one flight per resident per window");
  assert.deepEqual(await settleResolve(living.byId.get(ID), KEEPER, { d: { ...d, living }, now: NOW }), { by: "ren", actId: living.encounter.find((r) => r.action === "strike").id });
});

// ── the matrix, the slice, a Mists creature ───────────────────────────────

test("the matrix: strike shows while you have the nerve and it has resolve; steady and shield on residents in the same ring", () => {
  const living = livingWith();
  const law = lawWith();
  const residents = [{ handle: "ren", at: { x: 12, y: 0 } }, { handle: "far", at: { x: 300, y: 0 } }];
  const pairs = encounterPairs({ here: { x: 10, y: 0 }, actor: "kai", living, law, residents, now: NOW });
  assert.deepEqual(pairs, [{ verb: "strike", object: ID }, { verb: "steady", object: "ren" }, { verb: "shield", object: "ren" }]);
  assert.deepEqual(encounterEntries(pairs).map((e) => e.action), ["strike", "steady", "shield"]);
  living.fold([nerveRowOf("kai", -9, "press")]);
  assert.deepEqual(encounterPairs({ here: { x: 10, y: 0 }, actor: "kai", living, law, residents, now: NOW }).map((p) => p.verb), ["steady", "shield"], "1 nerve: no strike");
});

test("the slice's encounter fields are on the whitelist", () => {
  const living = livingWith();
  const c = living.byId.get(ID);
  const roster = ringRoster({ residents: [{ handle: "ana", distance_m: 5 }, { handle: "kai", distance_m: 10 }] }, { ring: 40, lookup, living, now: NOW });
  const s = buildSlice(c, KEEPER, { actor: "kai", verb: "steady", distance_m: 10, target: "ana" }, {}, { now: NOW, encounter: { roster, resolve: 6, ease: { mine: 1, all: 1 } } });
  assert.deepEqual(s.ring, [{ name: "ana", household: "hearth", human: "human-of-hearth", m: 5, nerve: 10 }, { name: "kai", household: "a household of one", human: "human-of-kai", m: 10, nerve: 10 }]);
  assert.equal(s.creature.resolve, "6 of 10 left this window");
  assert.equal(s.this_act.target, "ana");
  const allowed = new Set(SLICE_FIELDS);
  const strays = [];
  const walk = (v, path) => {
    if (Array.isArray(v)) { v.forEach((x) => walk(x, `${path}[]`)); return; }
    if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) {
      const p = path ? `${path}.${k}` : k;
      const asMap = path && allowed.has(`${path}.*`) ? `${path}.*` : p;
      if (!allowed.has(asMap)) strays.push(p);
      walk(x, asMap);
    }
  };
  walk(s, "");
  assert.deepEqual(strays, []);
});

test("a Mists creature is untouched: an encounter's verb is not answered, and its reactions press no one", async () => {
  const mists = new LivingSet({ law: lawWith() }).fold([spawn("creature:plain-1", "plain")]);
  const { w, d } = deps(mists);
  assert.deepEqual(await reactTo(act({ verb: "steady", target: "ren" }), d), []);
  await reactTo(act(), d);
  assert.equal(payloadOf(w.calls[0][0]).press, undefined);
  assert.equal(w.calls[0].length, 1, "the reaction alone");
});

// ── the ring stops at its room's walls (world#268) ─────────────────────────

test("a ring stops at its room's walls: the world's own ringRoomOf and inCreatureRing, read at the blessed ref; outdoors the circle", async () => {
  // the room: x from -20 to 20 (the wall at x = 20); the ring is 40 m, so x = 30 is in the circle and past the wall
  const ROOM = { id: "a-room", at: { x: 0, y: 0 }, extent: { w: 40, h: 80 } };
  const walls = {
    ringRoomOf: (p, marks) => marks.find((m) => Math.abs(p.x - m.at.x) <= m.extent.w / 2 && Math.abs(p.y - m.at.y) <= m.extent.h / 2) ?? null,
    inCreatureRing: (p, c, ring, room) => Math.hypot(p.x - c.x, p.y - c.y) <= ring && (!room || Math.abs(p.x - room.at.x) <= room.extent.w / 2),
  };
  const law = { ...lawWith(), ...walls };
  const living = new LivingSet({ law }).fold([spawn()]);
  const c = living.byId.get(ID);
  assert.equal(living.inRing({ x: 30, y: 0 }).length, 1, "before its room is known: the circle");
  assert.equal(living.warmRooms([ROOM], "sha-1"), 1);
  assert.equal(c.room, ROOM);
  assert.equal(living.warmRooms([ROOM], "sha-1"), 0, "once per creature per published sha");
  assert.equal(living.inRing({ x: 30, y: 0 }).length, 0, "past the wall: not heard");
  assert.equal(living.inRing({ x: 15, y: 0 }).length, 1);
  // a strike from beyond the wall is refused, naming the wall; the matrix offers none there
  const s = strikeDeps(living, { law, at: { x: 30, y: 0 } });
  await assert.rejects(worldEncounter({ act: "strike", creature: ID }, KEY, s.d), (e) => e.code === 409 && /beyond the walls of the room/.test(e.defect));
  assert.deepEqual(encounterPairs({ here: { x: 30, y: 0 }, actor: "kai", living, law, residents: [], now: NOW }), []);
  // an afforded action "from its ring" says the wall too (creature-verbs.mjs § whyNot)
  const shooLaw = { ...law, affordedOf: () => [{ action: "shoo", from: "ring" }] };
  assert.match(whyNot("shoo", c, 30, { law: shooLaw, here: { x: 30, y: 0 } }), /beyond the walls of the room/);
  assert.equal(whyNot("shoo", c, 15, { law: shooLaw, here: { x: 15, y: 0 } }), null);
  // an act past the wall costs nothing and wakes nothing
  const { w, d } = deps(living, { law });
  assert.deepEqual(await reactTo(act({ point: { x: 30, y: 0 } }), { ...d, law }), []);
  assert.equal(w.calls.length, 0);
  // outdoors: no room, the circle
  const out = new LivingSet({ law }).fold([spawn()]);
  out.warmRooms([], "sha-1");
  assert.equal(out.byId.get(ID).room, null);
  assert.equal(out.inRing({ x: 30, y: 0 }).length, 1);
});

test("the law carries the walls when the blessed ref's portals.mjs has them, and is the circle when it does not", async () => {
  const kindText = (path) => { if (path !== "WORLD/kinds/keeper.kind") throw new Error("no"); return KIND_TEXT; };
  const withWalls = await loadCreatureLaw({ ref: "r", readText: kindText, importTool: (f) => (f === "portals.mjs"
    ? Promise.resolve({ ringRoomOf: () => null, inCreatureRing: () => true }) : import(worldModuleUrl("tools", f))) });
  assert.equal(typeof withWalls.ringRoomOf, "function");
  assert.equal(typeof withWalls.inCreatureRing, "function");
  const without = await loadCreatureLaw({ ref: "r", readText: kindText, importTool: (f) => (f === "portals.mjs"
    ? Promise.reject(new Error("no such file")) : import(worldModuleUrl("tools", f))) });
  assert.equal(without.unavailable, undefined, "the law still loads");
  assert.equal(without.ringRoomOf, undefined);
});

test("\"ease: N mine only watch\": any other act of yours in its ring empties your own ease, even inside the 10 s window with no reaction", async () => {
  const STILL = { ...KEEPER, ease: { target: 3, by: "mine", only: "watch" } };
  const law = lawWith({ kinds: { keeper: STILL } });
  const living = new LivingSet({ law }).fold([spawn()]);
  const c = living.byId.get(ID);
  const { costs, d } = deps(living, { law });
  await reactTo(act({ verb: "watch", actId: "9401" }), { ...d, aimed: c });
  assert.equal(easeScope(c, STILL, "kai", "solo:kai", NOW).mine, 1);
  // a walk 3 s later: inside the window, no reaction, and it still breaks the stillness
  assert.deepEqual(await reactTo(act({ verb: "walk", actId: "9402", atIso: iso(NOW + 3000) }), { ...d, now: NOW + 3000 }), []);
  assert.ok(payloadOf(costs.calls[0][0]).ease_after, "the cost's row carries the emptied ease");
  assert.equal(easeScope(c, STILL, "kai", "solo:kai", NOW + 3000).mine, 0);
  // a fresh living set folds it back from the rows
  const again = new LivingSet({ law }).fold([spawn()]).fold([...living.encounter.map((r) => ({ ...r, at: iso(r.at) })),
    { id: nextId(), at: iso(NOW), actor: ID, action: "react", object: "9401", payload: { to: "kai", verb: "watch", reaction: "regard", ease_after: { window: windowAt(NOW).id, mine: { kai: { n: 1, first_at: NOW } }, households: {} } } }], { advance: false });
  assert.equal(easeScope(again.byId.get(ID), STILL, "kai", "solo:kai", NOW + 3000).mine, 1, "the reaction's own ease, folded");
});

test("a condition reads the ring and the actor in it: residents, households, the actor's housemates, nerve and whether they struck", async () => {
  let seen = null;
  const base = lawWith();
  const law = { ...base, kindMod: { ...base.kindMod, scopeOf: (s, a, actor, enc = {}) => { seen = enc; return base.kindMod.scopeOf(s, a, actor, enc); } } };
  const living = new LivingSet({ law }).fold([spawn()]).fold([strikeRowOf("ana", 4)], { advance: false });
  const { d } = deps(living, { law, present: presentOf([["ana", 10], ["bo", 12], ["kai", 14]]) });
  await reactTo(act({ actor: "ana", point: { x: 10, y: 0 } }), d);
  assert.deepEqual(seen.ring, { residents: 3, households: 2 });
  assert.deepEqual(seen.actor, { housemates: 1, nerve: 8, struck: true });
});

test("steady's and shield's `resident` rides the apex's args, and no tool schema names it before the encounter is published", async () => {
  const { CREATURE_TOOLS } = await import("../src/creature-verbs.mjs");
  assert.equal(Object.hasOwn(CREATURE_TOOLS[0].inputSchema.properties, "resident"), false, "a schema is public text");
  const { dispatchCreatureVerb } = await import("../src/world-apex.mjs");
  const seen = [];
  const door = async (fields) => { seen.push(fields); return { did: fields.act }; };
  const ok = await dispatchCreatureVerb("steady", { do: "steady", args: { resident: "ren" } }, KEY, { door });
  assert.equal(ok.result?.did, "steady");
  assert.equal(seen[0].resident, "ren");
  const no = await dispatchCreatureVerb("watch", { do: "watch", args: { creature: ID, resident: "ren" } }, KEY, { door });
  assert.equal(no.code, 422, "an afforded action takes no resident");
  assert.match(no.defect, /does not take: resident/);
});
