// creatures-read.test.mjs — creatures in the world read (POS-637 PR-C;
// src/creatures-read.mjs, world-read-v2.mjs § withCreaturesInWho and happeningBlock,
// world-happened.mjs § toYou).
//
// RULED (Darko, C1–C6, 2026-10-15 12:09 EDT, as recommended): creatures join
// who and find:; a reaction stands in happening_here for 30 min within 500 m;
// one line names the nearest creature within 5 km; the walk's arrival reaches
// the walker's own happened. The fold, the law (the world's own, over a real
// kind file's text) and the engine's bearing words are the real ones; the
// record is injected.

import { test as nodeTest } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { LivingSet, loadCreatureLaw, REFRESH_MS, TO_YOU_REACH_MS, BOOT_SPAN_S, LIVING_BOOT_SQL } from "../src/creatures.mjs";
import {
  EMISSIONS_SHOWN, creatureHappening, creatureToYou, creaturesForRead, creaturesInWho, findCreatures, investigateCreature,
  savedCreatureOf, __resetCreaturesReadForTest, TO_YOU_FOLD,
} from "../src/creatures-read.mjs";
import { ACTIVE_CAP, happeningBlock, shapeV2, whoBlock, withCreaturesInWho } from "../src/world-read-v2.mjs";
import { toYou } from "../src/world-happened.mjs";
import { NO_WORLD, worldModuleUrl } from "./fixture-paths.mjs";

const test = (name, fn) => nodeTest(name, { skip: NO_WORLD || false }, fn);

const levels = (m) => `none | a little ${m} | plain ${m} | overwhelming ${m}`;
const WOLF_TEXT = `kind: wolf
name: a grey wolf
ring_m: 80
what: >
  A grey wolf come out of the Mists. It belongs to no one.
moods:
  fear: 0..3 = 1 | ${levels("fear")}
reaction watch "it stands still and watches": when true says At the edge of the Mists a grey wolf stands perfectly still, watching {actor}.
reaction snarl "it bares its teeth, a warning only": when act.approaching says The wolf's lip curls back. It snarls at {actor}, low and steady.
reaction flee "it turns and is gone": when self.fear >= 3 does flee says The wolf wheels and is gone, a grey shape folding back into the grey.
`;
const LAW = NO_WORLD ? null : await loadCreatureLaw({ ref: "the pinned clone", importTool: (f) => import(worldModuleUrl("tools", f)),
  readText: (path) => { if (path !== "WORLD/kinds/wolf.kind") throw new Error(`no fixture kind at ${path}`); return WOLF_TEXT; } });
const ENGINE = NO_WORLD ? null : await import(worldModuleUrl("tools", "world-engine.mjs"));

const NOW = Date.parse("2026-10-25T13:00:00Z");
const iso = (ms) => new Date(ms).toISOString();
let n = 0;
const spawn = (id, { x = 0, y = 0, at = NOW - 3600_000 } = {}) => ({ id: String(++n), at: iso(at), actor: "the-town", action: "spawn", object: id,
  payload: { kind: "wolf", at: iso(at), fades_at: iso(at + 12 * 3600_000), x, y } });
const react = (creature, { trigger, to = "kai", reaction = "watch", at = NOW - 60_000, moment = null, roll = 7, judged_by = "jev", allowed = null } = {}) =>
  ({ id: String(++n), at: iso(at), actor: creature, action: "react", object: String(trigger ?? 9000 + n),
    payload: { to, verb: "walk", reaction, roll, judged_by, ...(moment ? { moment, arrived_at: iso(at) } : {}), ...(allowed ? { allowed } : {}) } });
const withdraw = (creature, at = NOW - 30_000) => ({ id: String(++n), at: iso(at), actor: creature, action: "withdraw", object: creature, payload: { reason: "fled" } });
const fold = (...rows) => ({ living: new LivingSet({ law: LAW }).fold(rows), law: LAW });

// ── who (C6) ────────────────────────────────────────────────────────────────

test("who: a living creature within presence's radius, nearest first, in the engine's own bearing and band words", () => {
  const cur = fold(spawn("creature:wolf-270-1", { x: 300, y: 0 }), spawn("creature:wolf-270-2", { x: 0, y: 120 }),
    spawn("creature:wolf-270-3", { x: 900, y: 0 }), react("creature:wolf-270-2", { reaction: "snarl", at: NOW - 120_000 }));
  const rows = creaturesInWho(cur, { x: 0, y: 0 }, { nowMs: NOW, engine: ENGINE });
  assert.deepEqual(rows.map((r) => r.id), ["creature:wolf-270-2", "creature:wolf-270-1"], "the one 900 m off is past presence's 500 m");
  assert.deepEqual(rows[0], { kind: "creature", id: "creature:wolf-270-2", name: "a grey wolf", m: 120, bearing: ENGINE.quantizeBearing(ENGINE.bearingDeg(0, 120)),
    band: ENGINE.distanceBand(120), doing: "it bares its teeth, a warning only", last: "answered kai, 2 min ago" });
  assert.equal(rows[1].doing, "out of the Mists", "a creature that has answered nobody yet");
  assert.equal(rows[1].last, undefined);
});

test("who: a creature that fled, faded, or has not come out yet is not in sight", () => {
  const cur = fold(spawn("creature:wolf-270-1", { x: 10 }), withdraw("creature:wolf-270-1"),
    spawn("creature:wolf-270-2", { x: 20, at: NOW - 13 * 3600_000 }), spawn("creature:wolf-270-3", { x: 30, at: NOW + 60_000 }));
  assert.deepEqual(creaturesInWho(cur, { x: 0, y: 0 }, { nowMs: NOW, engine: ENGINE }), []);
});

nodeTest("who: creatures join active by distance; the cap holds and the overflow is counted; no creature, the block is untouched", () => {
  const who = { active: [{ kind: "resident", handle: "a", m: 50 }, { kind: "resident", handle: "b", km: 0.6 }], more_active: 2, around_but_quiet: { count: 1, nearest: [] }, look_closer: "x" };
  const merged = withCreaturesInWho(who, [{ kind: "creature", id: "creature:wolf-270-1", m: 80 }], { cap: 2 });
  assert.deepEqual(merged.active.map((r) => r.handle ?? r.id), ["a", "creature:wolf-270-1"]);
  assert.equal(merged.more_active, 3, "the resident pushed past the cap is counted with the two already over it");
  assert.deepEqual(Object.keys(merged), ["active", "more_active", "around_but_quiet", "look_closer"]);
  assert.equal(withCreaturesInWho(who, []), who);
  assert.equal(withCreaturesInWho(who, null), who);
  assert.equal(ACTIVE_CAP, 8);
});

// ── happening_here (C3, C6) ─────────────────────────────────────────────────

test("happening_here: a reaction stands 30 minutes within 500 m, as the kind's own line, newest first and at most EMISSIONS_SHOWN", () => {
  const W = "creature:wolf-270-1";
  const cur = fold(spawn(W, { x: 400, y: 0 }),
    react(W, { to: "kai", at: NOW - 31 * 60_000 }),                    // past its half hour
    react(W, { to: "mo", reaction: "snarl", at: NOW - 20 * 60_000 }),
    react(W, { to: "lu", at: NOW - 10 * 60_000 }),
    react(W, { to: "bo", at: NOW - 5 * 60_000 }),
    react(W, { to: "ze", reaction: "snarl", at: NOW - 60_000 }));
  const rows = creatureHappening(cur, { x: 0, y: 0 }, { nowMs: NOW, engine: ENGINE });
  const said = rows.filter((r) => r.ago);
  assert.equal(said.length, EMISSIONS_SHOWN);
  assert.deepEqual(said.map((r) => r.what), [
    "The wolf's lip curls back. It snarls at ze, low and steady.",
    "At the edge of the Mists a grey wolf stands perfectly still, watching bo.",
    "At the edge of the Mists a grey wolf stands perfectly still, watching lu.",
  ]);
  assert.deepEqual(said[0], { what: said[0].what, kind: "creature", id: W, ago: "1 min ago" });
  // alone, the reaction 31 minutes old says nothing: only the far line stands
  const stale = fold(spawn(W, { x: 400, y: 0 }), react(W, { to: "kai", at: NOW - 31 * 60_000 }));
  assert.deepEqual(creatureHappening(stale, { x: 0, y: 0 }, { nowMs: NOW, engine: ENGINE }).map((r) => r.ago ?? "far"), ["far"]);
  // 600 m from the creature: out of the emission's reach, but the far line still names it
  const far = creatureHappening(cur, { x: -200, y: 0 }, { nowMs: NOW, engine: ENGINE });
  assert.equal(far.filter((r) => r.ago).length, 0);
  assert.deepEqual(far, [{ what: `a grey wolf is out at the Mists' edge, 600 m ${ENGINE.quantizeBearing(ENGINE.bearingDeg(600, 0))}`, kind: "creature", id: W }]);
});

test("happening_here: a creature that fled is the one that fled for its half hour; the far line names only the living, nearest, within 5 km", () => {
  const cur = fold(spawn("creature:wolf-270-1", { x: 100 }), react("creature:wolf-270-1", { reaction: "flee", to: "kai", at: NOW - 40_000 }), withdraw("creature:wolf-270-1"),
    spawn("creature:wolf-270-2", { x: 3100, y: 0 }), spawn("creature:wolf-270-3", { x: 0, y: 4000 }));
  const rows = creatureHappening(cur, { x: 0, y: 0 }, { nowMs: NOW, engine: ENGINE });
  assert.equal(rows[0].what, "The wolf wheels and is gone, a grey shape folding back into the grey.");
  assert.equal(rows[1].id, "creature:wolf-270-2");
  assert.match(rows[1].what, /^a grey wolf is out at the Mists' edge, 3\.1 km [NESW]+$/);
  assert.deepEqual(creatureHappening(fold(spawn("creature:wolf-270-9", { x: 5100 })), { x: 0, y: 0 }, { nowMs: NOW, engine: ENGINE }), [], "past 5 km, nothing");
});

nodeTest("happening_here: the creatures' rows ride after the block's own; none, and the block is what it was", () => {
  const c = [{ what: "a grey wolf is out at the Mists' edge, 2.1 km NE", kind: "creature", id: "creature:wolf-270-1" }];
  assert.deepEqual(happeningBlock({ creatures: c }), c);
  assert.equal(happeningBlock({}), null);
  assert.equal(happeningBlock({ creatures: [] }), null);
  const mists = { in_wall: false, thickness: 0.4 };
  assert.deepEqual(happeningBlock({ mists, creatures: c }).map((r) => r.kind), ["emission", "creature"]);
});

nodeTest("v2 with no creature is byte-identical to v2 before them", () => {
  const p = { standpoint: { x: 1, y: 2 }, crowd: [], active: new Map(), nowMs: NOW, viewRows: [], entries: [], heard: [] };
  assert.equal(JSON.stringify(shapeV2({ ...p, creatures: null })), JSON.stringify(shapeV2(p)));
  const none = shapeV2(p);
  assert.ok(!("happening_here" in none), "nothing happening, no block");
  assert.deepEqual(none.who, whoBlock([], new Map(), { nowMs: NOW }));
  const withOne = shapeV2({ ...p, creatures: { who: [{ kind: "creature", id: "creature:wolf-270-1", m: 40 }], happening: [{ what: "w", kind: "creature", id: "creature:wolf-270-1" }] } });
  assert.equal(withOne.who.active[0].id, "creature:wolf-270-1");
  assert.equal(withOne.happening_here[0].what, "w");
});

// ── find (C6) ───────────────────────────────────────────────────────────────

test("find: a kind, its name or \"creature\" names the living creatures, nearest first, with distance and bearing", () => {
  const cur = fold(spawn("creature:wolf-270-1", { x: 2000 }), spawn("creature:wolf-270-2", { x: 0, y: -700 }), spawn("creature:wolf-270-3", { x: 50 }), withdraw("creature:wolf-270-3"));
  for (const q of ["wolf", "Wolf", "wolves".replace(/ves$/, "f"), "a grey wolf", "grey wolf", "creature", "creatures"]) {
    const hits = findCreatures(cur, q, { x: 0, y: 0 }, { nowMs: NOW, engine: ENGINE });
    assert.deepEqual(hits?.map((h) => h.id), ["creature:wolf-270-2", "creature:wolf-270-1"], q);
  }
  const [h] = findCreatures(cur, "wolf", { x: 0, y: 0 }, { nowMs: NOW, engine: ENGINE });
  assert.deepEqual(h, { id: "creature:wolf-270-2", kind: "wolf", name: "a grey wolf", at: { x: 0, y: -700 }, distance_m: 700,
    bearing: ENGINE.quantizeBearing(ENGINE.bearingDeg(0, -700)), fades_in: "11h 00m" });
  assert.equal(findCreatures(cur, "snug", { x: 0, y: 0 }, { nowMs: NOW }), null, "a find for a mark names no creature");
});

test("find: with no standpoint (the World page's keyless read), a creature spawned after now is not listed, as from a standpoint", () => {
  const cur = fold(spawn("creature:wolf-270-1", { x: 2000 }), spawn("creature:wolf-270-9", { x: 10, at: NOW + 600_000 }));
  assert.deepEqual(findCreatures(cur, "creature", null, { nowMs: NOW })?.map((h) => h.id), ["creature:wolf-270-1"],
    "the keyless find lists a creature the tick wrote ahead of its arrival");
  assert.deepEqual(findCreatures(cur, "creature", { x: 0, y: 0 }, { nowMs: NOW })?.map((h) => h.id), ["creature:wolf-270-1"],
    "the standpoint find and the keyless one read the same set");
  // ⚑ THE FLIP: restore `living.living(nowMs).map(…)` in findCreatures' no-standpoint branch → the first assert reds.
});

test("happening_here: a creature spawned after now says nothing, even with a reaction on its row", () => {
  const ahead = "creature:wolf-270-9";
  const cur = fold(spawn(ahead, { x: 10, at: NOW + 600_000 }), react(ahead, { at: NOW - 60_000 }));
  assert.ok(cur.living.byId.get(ahead)?.reactions?.length, "the fixture: the ahead row holds a reaction a reader could tell");
  assert.deepEqual(creatureHappening(cur, { x: 0, y: 0 }, { nowMs: NOW, engine: ENGINE }), [],
    "happening_here told a creature the tick wrote ahead of its arrival");
  // ⚑ THE FLIP: drop the `spawned_at <= nowMs` skip in creatureHappening's loop → red.
});

test("investigate: a creature spawned after now is not here to look at (404), as no read lists it", async () => {
  const ahead = "creature:wolf-270-9";
  const cur = fold(spawn("creature:wolf-270-1", { x: 2000 }), spawn(ahead, { x: 10, at: NOW + 600_000 }));
  const r = await investigateCreature(ahead, { creatures: cur, nowMs: NOW });
  assert.equal(r.code, 404, "investigate read a creature the tick wrote ahead of its arrival: " + JSON.stringify(r).slice(0, 200));
  assert.equal((await investigateCreature("creature:wolf-270-1", { creatures: cur, nowMs: NOW })).kind, "creature", "one out by now still reads");
  // ⚑ THE FLIP: read `living.byId.get(id)` unfiltered in investigateCreature → the first assert reds.
});

// ── to_you (C1) ─────────────────────────────────────────────────────────────

test("to_you: a creature's answer to you rides your own happened, the arrival named so, wherever you are now", () => {
  const W = "creature:wolf-270-1", R = "creature:wolf-270-2";
  const cur = fold(spawn(W), react(W, { to: "kai", at: NOW - 3 * 3600_000, moment: "arrival", trigger: 501 }),
    react(W, { to: "mo", at: NOW - 3600_000 }), spawn(R, { x: 50 }), react(R, { to: "kai", reaction: "snarl", at: NOW - 20 * 60_000 }));
  const got = creatureToYou(cur, "kai", { sinceMs: NOW - 6 * 3600_000, nowMs: NOW });
  assert.equal(got.readable, true);
  assert.deepEqual(got.events.map((e) => [e.creature, e.reaction, e.arrival ?? false]), [[W, "watch", true], [R, "snarl", false]]);
  assert.deepEqual(got.events[0], { kind: "creature", creature: W, at: iso(NOW - 3 * 3600_000),
    line: "At the edge of the Mists a grey wolf stands perfectly still, watching kai.", reaction: "watch", roll: 7, judged_by: "jev", arrival: true });
  assert.deepEqual(creatureToYou(cur, "kai", { sinceMs: NOW - 2 * 3600_000, nowMs: NOW }).events.map((e) => e.reaction), ["snarl"], "since is since");
  // a since older than the fold's reach: answered from what it holds, and the shelf says it is not complete
  const old = creatureToYou(cur, "kai", { sinceMs: NOW - TO_YOU_REACH_MS - 60_000, nowMs: NOW });
  assert.equal(old.readable, false);
  const shelf = toYou({ creatureEffects: old, sinceCrossing: 270, nowCrossing: 272 });
  assert.equal(shelf.complete, false);
  assert.match(shelf.note, /older than the last 13 hours are not held here/);
  const whole = toYou({ creatureEffects: got, sinceCrossing: 270, nowCrossing: 272 });
  assert.equal(whole.complete, true);
  assert.equal(whole.count, 2);
  assert.match(whole.note, /so does every hold on a thing of yours or by your own hand, and every creature's answer to you$/);
  assert.doesNotMatch(toYou({ sinceCrossing: 270, nowCrossing: 272 }).note, /creature/, "no creatures read, the sentence it always was");
});

test("C1 (review-574): the reaction an 11 h-old arrival drew from a wolf that FADED is still read, after every prune, and the shelf is whole", () => {
  const W = "creature:wolf-270-1";
  // out 12 h ago, it answered kai's arrival 11 h ago, and faded at its 12 h (now); 1.5 h later (an hour past its
  // end, so A's prune would have dropped it) the reaction is 12.5 h old, and the walker reading since 12.9 h ago gets it
  const later = NOW + 1.5 * 3600_000;
  const cur = fold(spawn(W, { at: NOW - 12 * 3600_000 }), react(W, { to: "kai", at: NOW - 11 * 3600_000, moment: "arrival", trigger: 601 }));
  cur.living.prune(later);
  const got = creatureToYou(cur, "kai", { sinceMs: later - 12.9 * 3600_000, nowMs: later });
  assert.deepEqual(got.events.map((e) => [e.creature, e.arrival]), [[W, true]]);
  assert.equal(got.readable, true);
  assert.equal(toYou({ creatureEffects: got, sinceCrossing: 270, nowCrossing: 272 }).complete, true);
  // past its 13 h the reaction leaves RAM, and a since that old is said incomplete, never whole
  cur.living.prune(NOW - 11 * 3600_000 + TO_YOU_REACH_MS + 1);
  assert.equal(cur.living.byId.size, 0);
});

test("C1 (review-574): the reaction from a wolf that FLED 3 h ago is still read", () => {
  const W = "creature:wolf-270-1";
  const cur = fold(spawn(W, { at: NOW - 5 * 3600_000 }), react(W, { to: "kai", reaction: "flee", at: NOW - 3 * 3600_000, moment: "arrival", trigger: 602 }), withdraw(W, NOW - 3 * 3600_000));
  cur.living.prune(NOW);
  const got = creatureToYou(cur, "kai", { sinceMs: NOW - 12 * 3600_000, nowMs: NOW });
  assert.deepEqual(got.events.map((e) => e.line), ["The wolf wheels and is gone, a grey shape folding back into the grey."]);
  assert.equal(got.readable, true);
});

nodeTest("C1 (review-574): a process boots far enough back to hold every reaction to_you can owe (13 h, from a creature out 12 h before it)", async () => {
  assert.equal(BOOT_SPAN_S, 26 * 3600);
  let asked = null;
  await new LivingSet({ law: LAW }).refresh({ query: async (sql, params) => { if (sql === LIVING_BOOT_SQL) asked = params; return []; } });
  assert.deepEqual(asked, [BOOT_SPAN_S]);
});

test("C2 (review-574; RULED as built, Darko 13:15–13:17): per creature, its reactions to you fold into one event, the newest line and the count", () => {
  assert.equal(TO_YOU_FOLD.ruled, "the to_you cap (review-574 C2), Darko 2026-10-15 13:15–13:17 EDT");
  assert.equal(TO_YOU_FOLD.pending, undefined);
  const W = "creature:wolf-270-1", R = "creature:wolf-270-2";
  const rows = [spawn(W), spawn(R, { x: 50 })];
  for (let i = 0; i < 60; i += 1) rows.push(react(W, { to: "kai", reaction: i === 59 ? "snarl" : "watch", at: NOW - (60 - i) * 60_000 }));
  rows.push(react(R, { to: "kai", at: NOW - 30 * 60_000 }));
  const got = creatureToYou(fold(...rows), "kai", { sinceMs: NOW - 6 * 3600_000, nowMs: NOW });
  assert.equal(got.events.length, 2, "an hour beside one wolf is one row, not sixty");
  const [w] = got.events.filter((e) => e.creature === W);
  assert.equal(w.reaction, "snarl");
  assert.equal(w.at, iso(NOW - 60_000));
  assert.equal(w.and_more, 59);
  assert.equal(w.more, "and 59 more");
  assert.equal(got.events.find((e) => e.creature === R).and_more, undefined, "one reaction: no count");
});

nodeTest("C3 (review-574): read: \"who\" carries the creatures the glance shows, beside the paged residents", () => {
  const creature = { kind: "creature", id: "creature:wolf-270-1", m: 40 };
  const whole = { total: 0, active: 0, shown: 0, offset: 0, rows: [], complete: true };
  assert.deepEqual(withCreaturesInWho(whole, [creature]), { ...whole, creatures: [creature] });
  const p = { standpoint: { x: 1, y: 2 }, crowd: [], active: new Map(), nowMs: NOW, viewRows: [], entries: [], heard: [],
    deep: { block: "who", limit: 50, offset: 0 }, creatures: { who: [creature], happening: [] } };
  assert.deepEqual(shapeV2(p).who.creatures, [creature]);
});

// ── investigate ─────────────────────────────────────────────────────────────

test("investigate: the creature as of now, its newest reactions with their odds (C4: only here), and the crossing save's row", async () => {
  const W = "creature:wolf-270-1";
  const cur = fold(spawn(W, { x: 30, y: 40 }), react(W, { to: "kai" }));
  const asked = [];
  const r = await investigateCreature(W, {
    creatures: cur, from: { x: 0, y: 0 }, nowMs: NOW,
    rows: async (id, k) => { asked.push([id, k]); return [{ id: "77", at: new Date(NOW - 60_000), object: "9001",
      payload: { to: "kai", verb: "walk", reaction: "snarl", roll: 15, judged_by: "code", why: "timeout", allowed: { watch: 0.5, snarl: 0.5 } } }]; },
    saved: (id) => (id === W ? { crossing: 271, row: { at: { x: 30, y: 40 }, kind: "wolf", moods: { fear: 1 }, flags: [] } } : null),
  });
  assert.deepEqual(asked, [[W, 10]]);
  assert.equal(r.kind, "creature");
  assert.equal(r.name, "a grey wolf");
  assert.deepEqual(r.presence.now.at, { x: 30, y: 40 });
  assert.deepEqual(r.presence.now.from_you, { m: 50 });
  assert.equal(r.presence.now.state, "out of the Mists");
  assert.deepEqual(r.presence.now.moods, { fear: "1 of 3" });
  assert.equal(r.presence.now.answered_by, "the record, as of now");
  assert.equal(r.presence.last_crossing.answered_by, "the crossing save, as of crossing 271");
  assert.deepEqual(r.reactions.rows[0].odds, { watch: 0.5, snarl: 0.5 });
  assert.equal(r.reactions.rows[0].line, "The wolf's lip curls back. It snarls at kai, low and steady.");
  assert.equal(r.reactions.rows[0].why, "timeout");
  // none held and none saved: "no creature"; no law here: said, never a guess
  assert.equal((await investigateCreature("creature:wolf-270-99", { creatures: cur, nowMs: NOW })).code, 404);
  assert.match((await investigateCreature(W, { creatures: null })).unavailable, /law cannot be read/);
  // the record unreadable: the reactions say so, the rest still answers
  const blind = await investigateCreature(W, { creatures: cur, nowMs: NOW, rows: async () => null });
  assert.match(blind.reactions.unavailable, /could not be read/);
  assert.equal(blind.presence.last_crossing.unavailable, "no crossing save holds this creature");
});

nodeTest("the crossing save's tier: STATE/snapshot/<newest>/creatures.json, as the world's creaturesSnapshot writes it", () => {
  const repo = mkdtempSync(join(tmpdir(), "creatures-saved-"));
  try {
    mkdirSync(join(repo, "STATE", "snapshot", "270"), { recursive: true });
    mkdirSync(join(repo, "STATE", "snapshot", "271"), { recursive: true });
    writeFileSync(join(repo, "STATE", "snapshot", "271", "creatures.json"), JSON.stringify({ crossing: 271, evaluated_at: iso(NOW), creature_count: 1,
      creatures: [{ id: "creature:wolf-270-1", kind: "wolf", crossing: 270, x: 30.4, y: 39.6, spawned_at: iso(NOW - 3600_000), fades_at: iso(NOW + 3600_000), moods: { fear: 2 }, flags: ["wary"] }] }));
    assert.deepEqual(savedCreatureOf("creature:wolf-270-1", repo), { crossing: 271, row: { at: { x: 30, y: 40 }, kind: "wolf", moods: { fear: 2 }, flags: ["wary"],
      spawned_at: iso(NOW - 3600_000), fades_at: iso(NOW + 3600_000) } });
    assert.equal(savedCreatureOf("creature:wolf-270-2", repo), null);
  } finally { rmSync(repo, { recursive: true, force: true }); }
});

// ── one fold per process (W3) ───────────────────────────────────────────────

test("a read worker folds the record itself, at most once per REFRESH_MS; the writer's own set is read as it stands", async () => {
  __resetCreaturesReadForTest();
  let reads = 0;
  const query = async (sql) => { reads += 1; return /make_interval/.test(sql) ? [spawn("creature:wolf-270-1", { at: Date.now() - 3600_000 })] : []; };
  const a = await creaturesForRead({ hook: null, law: LAW, query, nowMs: Date.now() });
  assert.equal(a.living.byId.size, 1);
  const r1 = reads;
  await creaturesForRead({ hook: null, law: LAW, query, nowMs: Date.now() });
  assert.equal(reads, r1, "inside REFRESH_MS: no read");
  await creaturesForRead({ hook: null, law: LAW, query, nowMs: Date.now() + REFRESH_MS });
  assert.ok(reads > r1, "past it: the cursor reads on");
  const writer = { living: "the hook's own", law: LAW };
  assert.equal(await creaturesForRead({ hook: writer }), writer);
  // no law at the blessed ref (any blessing before world#218): nothing to read
  __resetCreaturesReadForTest();
  assert.equal(await creaturesForRead({ hook: null, law: { unavailable: "no law" }, query }), null);
  // a store this office does not hold: nothing, never a half-booted set
  __resetCreaturesReadForTest();
  assert.equal(await creaturesForRead({ hook: null, law: LAW, query: async () => null, nowMs: Date.now() }), null);
  __resetCreaturesReadForTest();
});
