// wld164-flee-read.test.mjs — a zero-nerve forced flee is visible: in the act's answer, and in the resident's happened (WLD-164).
//
// Verified Wright, WLD-164, 2026-11-09 13:36Z: "when a creature's ring takes a resident to 0 nerve and they flee (office
// src/creatures.mjs queueFlee), the flee shows in their happened, and the act that took them to 0 says so in its own answer.
// A line in the read, no new mechanics; WLD-153's per-act cost stays as it is. Add a test that's red on today's code."
// Yew's report (postmark#4289): an exit with no exit act sent. The ring's press is split across a household (encounter.mjs §
// pressLanding), so a resident can be taken to 0 by a housemate's act and put outside without having sent one.
//
// TWO READS, EACH FROM THE RECORD:
//   · the act that took them to 0 (a creature's reaction press, creatures.mjs): its answer's `pressed` entry for that resident
//     says their nerve is gone and that the office puts them outside a dungeon they stand in. It says nothing the record does not
//     hold yet: the exit is queued after the answer goes out, and written only inside a dungeon, so the answer never says they
//     fled or stay out (that is the exit's own record, in their happened). The actor's own nerve is WLD-153's `nerve_said`,
//     unchanged, and never said twice.
//   · their happened (creatures-read.mjs § fleeEventsOf, riding creatureToYou like every creature's effect on you): the office's
//     own exit act, which records `fled: "nerve"` and `fled_by`. A flee not recorded is not claimed.
// Invented creatures, residents and rows throughout; the record is injected, as in test/wld153-per-act-nerve.test.mjs.

import { test as nodeTest } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { LivingSet, loadCreatureLaw } from "../src/creatures.mjs";
import { nerveOf, windowAt } from "../src/encounter.mjs";
import * as creaturesRead from "../src/creatures-read.mjs";
import { __setCreaturesForTest, creaturesAnswer } from "../src/creatures-hook.mjs";
import { toYou } from "../src/world-happened.mjs";
import { NO_WORLD, worldModuleUrl } from "./fixture-paths.mjs";

const test = (name, fn) => nodeTest(name, { skip: NO_WORLD || false }, fn);

// ── the answer: the act whose press takes a housemate to 0 ─────────────────

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
  reactions: [reaction("glare", `act.verb == "say"`, [{ do: "press", n: 2, on: ["actor"] }], "It glares.")],
};
const lawWith = () => ({
  ...BASE, kindOf: (n) => (n === "keeper" ? KEEPER : null), afforded: { keeper: [] },
  kindMod: { ...BASE.kindMod, ENCOUNTER_VERBS: ["strike", "steady", "shield"], PRESS_ON },
});
const NOW = Date.now();
const iso = (ms) => new Date(ms).toISOString();
const ID = "creature:keeper-den";
let n = 50000;
const nextId = () => String(++n);
const spawn = () => ({ id: nextId(), at: iso(NOW - 3600_000), actor: "the-town", action: "spawn", object: ID, payload: { kind: "keeper", at: iso(NOW - 3600_000), stays: true, x: 0, y: 0 } });
const nerveRow = (object, by, why = "act", actId = nextId()) => ({ id: nextId(), at: iso(NOW - 60_000), actor: ID, action: "nerve", object,
  payload: { by, why, act: String(actId), creature: ID, window: windowAt(NOW).id } });
const livingWith = (...rows) => new LivingSet({ law: lawWith() }).fold([spawn()]).fold(rows, { advance: false });
// kai and mo share a household, so a press aimed at kai is split with mo (encounter.mjs § pressLanding); lu is nobody's housemate
const HOMES = { kai: { key: "hh:rookery", slug: "the-rookery", residents: ["kai", "mo"] }, mo: { key: "hh:rookery", slug: "the-rookery", residents: ["kai", "mo"] } };
const lookup = (h) => HOMES[h] ?? { key: `solo:${h}`, slug: null, residents: [h] };
let rowId = 90000;
const store = () => async (rows) => ({ prior: false, rows: rows.map((r) => ({ id: String(++rowId), at: r.written_at, actor: r.actor, action: r.action, object: r.object, payload: r.payload })) });
const sayRow = (actor = "kai") => ({ actor, action: "say", object: null, at_anchor: "the-town/let-there-be-light", at_dx: 10, at_dy: 0, class: "voice",
  payload: JSON.stringify({ text: "hello" }), written_at: iso(NOW), id: nextId() });
const deps = (fled, over = {}) => ({ centreOf: () => null, around: async () => ({}), write: store(), writeCost: store(), env: { CREATURE_JUDGE: "code" },
  present: async () => ({ residents: [{ handle: "kai", distance_m: 10 }, { handle: "mo", distance_m: 12 }, { handle: "lu", distance_m: 14 }] }),
  households: async () => lookup, flee: (h, o) => fled.push({ h, ...o }), ...over });

test("the act whose press takes a HOUSEMATE to 0 says their nerve is gone and what the office does, beside who paid; the actor and the others carry no such line", async () => {
  // mo has 1 nerve left; kai's say costs kai 1 and the glare's 2 is split kai 1 / mo 1 (the payer takes the larger half)
  const living = livingWith(nerveRow("mo", -9, "press"));
  __setCreaturesForTest(living);
  const fled = [];
  const out = await creaturesAnswer([sayRow("kai")], { did: "say" }, deps(fled));
  const pressed = out.creatures[0].pressed;
  assert.deepEqual(pressed.map((p) => p.on).sort(), ["kai", "mo"], "the press landed on both housemates");
  assert.equal(nerveOf(living, "mo", Date.now()), 0, "the control: the record has taken mo to 0");
  const mo = pressed.find((p) => p.on === "mo"), kai = pressed.find((p) => p.on === "kai");
  assert.equal(mo.nerve_gone, "their nerve is gone: if they stand inside a dungeon the office puts them outside it, and their happened says when that is recorded", "the act that took them to 0 says so");
  assert.equal("nerve_gone" in kai, false, "the actor still has nerve: nothing said");
  assert.doesNotMatch(mo.nerve_gone, /\bfled\b|stay out/, "and claims no exit: none is recorded when the answer goes out");
  assert.deepEqual(fled.map((f) => [f.h, f.creature]), [["mo", ID]], "and the flee is the one the record already makes, once, naming the creature");
  assert.match(out.nerve_said, /^That cost you 1 nerve, and the creature's press took 1 more; you have 8 of 10 left\.$/, "WLD-153's per-act line is as it was");
  __setCreaturesForTest(null);
});

test("controls: nobody at 0, and the ACTOR taken to 0 by their own act (nerve_said's, not said twice), carry no pressed.nerve_gone", async () => {
  __setCreaturesForTest(livingWith());
  const none = await creaturesAnswer([sayRow("kai")], { did: "say" }, deps([]));
  assert.equal(none.creatures[0].pressed.some((p) => "nerve_gone" in p), false, "no one is at 0: nothing said");
  __setCreaturesForTest(null);
  // kai at 2: the say costs 1, the press takes 1 of the 2 -> kai at 0 with his own act
  const living = livingWith(nerveRow("kai", -8, "press"));
  __setCreaturesForTest(living);
  const own = await creaturesAnswer([sayRow("kai")], { did: "say" }, deps([]));
  assert.equal(nerveOf(living, "kai", Date.now()), 0);
  assert.match(own.nerve_said, /Your nerve is gone: you flee, and stay out until the settlement\.$/, "the actor's own flee is WLD-153's line");
  assert.equal(own.creatures[0].pressed.some((p) => "nerve_gone" in p), false, "and is not repeated in the pressed entry");
  __setCreaturesForTest(null);
});

test("a flee that does not happen (outside a dungeon, or the exit fails) is never claimed: the answer promises only what is true, and nothing is recorded for their happened", async () => {
  // the office's flee outside a dungeon answers { fled: false, note } and writes nothing (world-crossings.mjs); a failed one is
  // swallowed by queueFlee. Either way the answer to the act has already gone out, so it can only say what the record holds.
  for (const flee of [() => ({ fled: false, note: "not within a dungeon: nothing to flee through" }), async () => null /* queueFlee's own answer to a fault it logged: nothing was recorded */]) {
    const living = livingWith(nerveRow("mo", -9, "press"));
    __setCreaturesForTest(living);
    const out = await creaturesAnswer([sayRow("kai")], { did: "say" }, deps([], { flee }));
    const mo = out.creatures[0].pressed.find((p) => p.on === "mo");
    assert.match(mo.nerve_gone, /^their nerve is gone: if they stand inside a dungeon /, "conditional on the dungeon: true whether or not an exit follows");
    assert.doesNotMatch(JSON.stringify(out), /you flee|they flee|stay out until|\bfled\b/i, "no completed, failed or in-flight exit is claimed anywhere in the answer");
    __setCreaturesForTest(null);
  }
  // and their happened has no event for it: the exit record holds nothing, and nothing is read as a flee
  const cur = { living: livingWith(), law: lawWith() };
  assert.deepEqual(creaturesRead.creatureToYou(cur, "mo", { sinceMs: SINCE, nowMs: NOW, fled: [] }).events.filter((e) => e.kind === "fled"), []);
});

// ── the happened: the flee the record holds ─────────────────────────────────

const SINCE = NOW - 6 * 3600_000;
const LEFT = iso(NOW - 600_000), UNTIL = "2026-11-09T18:00:00.000Z";
// the exit act's row as FLEE_ROWS_SQL answers it (crossing-exec.mjs writes fled and fled_by on the exit; the lock names the dungeon)
const exitRow = (over = {}) => ({ actor: "mo", id: "7001", left_at: LEFT, dungeon: "the-town/the-test-spire", locked_until: UNTIL, fled: "nerve", fled_by: ID, ...over });
/** a fake store that honours the statement's own WHERE: this resident's exits that carry a cause, newest first */
const fleeStore = (all) => async (sql, params) => {
  assert.equal(sql, creaturesRead.FLEE_ROWS_SQL, "the reader asks the one statement");
  return all.filter((r) => r.actor === params[0] && r.fled != null).sort((a, b) => Number(b.id) - Number(a.id));
};

test("their happened says the flee, from the recorded exit: where, until when, and which creature's ring (creatureToYou, as every creature's effect on you)", async () => {
  const rows = await creaturesRead.readFleeRows("mo", fleeStore([exitRow(), exitRow({ actor: "kai", id: "7002" })]));
  assert.deepEqual(rows.map((r) => r.actor), ["mo"], "only this resident's own exit: a housemate's is theirs");
  const cur = { living: livingWith(), law: lawWith() };
  const got = creaturesRead.creatureToYou(cur, "mo", { sinceMs: SINCE, nowMs: NOW, fled: rows });
  const flee = got.events.find((e) => e.kind === "fled");
  assert.ok(flee, "the flee is in mo's happened (red on the code that never read the exit)");
  assert.equal(flee.at, LEFT);
  assert.equal(flee.dungeon, "the-town/the-test-spire");
  assert.equal(flee.until, UNTIL);
  assert.equal(flee.creature, ID, "the creature whose ring took the nerve: the recorded fled_by");
  assert.equal(flee.line, `Your nerve ran out in ${ID}'s ring and the office put you outside the-town/the-test-spire: you fled, and stay out until the settlement at 18:00Z. You sent no exit.`);
  const shelf = toYou({ creatureEffects: got, sinceCrossing: 270, nowCrossing: 272 });
  assert.equal(shelf.events.some((e) => e.kind === "fled" && e.creature === ID), true, "and rides to_you");
  assert.equal(shelf.complete, true);
});

test("controls: no flee recorded, an exit the resident made, one for another cause, one before `since`, and one with no time of its own say nothing", async () => {
  const cur = { living: livingWith(), law: lawWith() };
  const said = (rows) => creaturesRead.creatureToYou(cur, "mo", { sinceMs: SINCE, nowMs: NOW, fled: rows }).events.filter((e) => e.kind === "fled");
  assert.deepEqual(said([]), [], "nothing recorded: nothing said");
  assert.deepEqual(said(await creaturesRead.readFleeRows("mo", fleeStore([exitRow({ fled: null })]))), [], "an exit the resident made carries no cause, so the statement never returns it");
  assert.deepEqual(said([exitRow({ fled: "other" })]), [], "only a flee for nerve");
  assert.deepEqual(said([exitRow({ left_at: iso(SINCE - 60_000) })]), [], "since is since");
  assert.deepEqual(said([exitRow({ left_at: null })]), [], "an event is never given a time it does not have");
  assert.equal(said([exitRow(), exitRow({ id: "7003", fled_by: null, left_at: iso(NOW - 300_000) })]).length, 2, "two recorded flees are two events, the one with no creature naming none");
  assert.equal("creature" in said([exitRow({ fled_by: null })])[0], false);
});

test("an exit record that cannot be read is said so, never read as no flee", async () => {
  await assert.rejects(creaturesRead.readFleeRows("mo", async () => null), /cannot be read/);
});

test("[pin] the apex's happened reads the recorded flee for the caller and hands it to creatureToYou", () => {
  const src = readFileSync(new URL("../src/world-apex.mjs", import.meta.url), "utf8");
  assert.match(src, /readFleeRows\(who, /, "the flee is read for the caller's own handle");
  assert.match(src, /creatureToYou\(cur, who, \{ sinceMs, fled \}\)/, "and handed to the one shelf that carries a creature's effect on you");
});
