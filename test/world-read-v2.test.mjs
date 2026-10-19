// world-read-v2.test.mjs — the world read v2's sayings, pure (POS-632).
//
// The rig tests (test/world-read-shape.test.mjs) drive the whole read on a real
// world clone. These hold the rulings each block carries, on fixtures, so a
// flip of any one of them reds here by name:
//   G2 landmark = lifted AND weight ≥ 10 · G3 active = a public act in the last
//   12 hours · G5 only public acts, a say as the fact of it · G6 at most 8 active
//   · G8 the approved one-liner per act, grouped by intent · G7 happening_here.
//
// Run: node --test test/world-read-v2.test.mjs

import test from "node:test";
import assert from "node:assert/strict";

import {
  viewBlock, whoBlock, canBlock, happeningBlock, eventsHere, heardBlock, HEARD_CAP, SAID_MAX, happenedGlance, shapeV2, activeOf, actLine, inWords, markIdsShown,
  LANDMARK_WEIGHT_FLOOR, ACTIVE_CAP, ACTIVE_WINDOW_MS, PUBLIC_ACTS, ACTIVE_SQL,
} from "../src/world-read-v2.mjs";
import { ONE_LINERS } from "../src/world-read-shape.mjs";
import { unbodied } from "./helpers/mark-bodies.mjs";
import { rideBlockFrom } from "../src/world-ride.mjs";
import { arrivalLine } from "../src/arrival-entries.mjs";
import { toYou } from "../src/world-happened.mjs";
import { claimEffectsFrom } from "../src/claim-effects.mjs";
import { holdEffectsFrom } from "../src/world-hold.mjs";
import { currentCrossing } from "../src/crossings.mjs";

const NOW = Date.parse("2026-10-15T00:08:00Z");

test("G2: a landmark is lifted by its stamps AND weighs at least the floor; a picture is a flag", () => {
  const v = viewBlock([
    { id: "a/big", name: "Big", body: "A big place.", bearing: "NE", band: "across the way", distM: 393, weight: 83 },
    { id: "b/far", name: "Far", bearing: "SE", band: "far off", distM: 6164, weight: 82, lifted: true, image: true },
    { id: "c/tiny", name: "Tiny", bearing: "SE", band: "across the way", distM: 152, weight: LANDMARK_WEIGHT_FLOOR - 7, lifted: true },
    { id: "d/edge", name: "Edge", bearing: "N", band: "far off", distM: 3345, weight: LANDMARK_WEIGHT_FLOOR, lifted: true },
  ]);
  assert.deepEqual(Object.keys(v), ["NE", "SE", "N", "how"], "groups in the order of their best-ranked member");
  assert.equal(v.NE[0].landmark, undefined, "weighted but seated by its size: no flag");
  assert.equal(v.SE[0].landmark, true);
  assert.equal(v.SE[0].image, true);
  assert.deepEqual(v.SE[0].km, 6.2);
  assert.equal(v.SE[1].landmark, undefined, "lifted under the floor: no flag");
  assert.equal(v.N[0].landmark, true, "the floor itself counts");
  assert.equal(v.NE[0].m, 393);
  assert.equal(v.NE[0].body, "A big place.", "every view row carries its whole body (Darko 22:33)");
  assert.equal(v.SE[0].body, "", "a row whose mark has no body says so as an empty body, never by leaving the key out");
});

test("G3/G5/G6: active is a public act in the last 12 hours, at most 8, nearest first; a say is the fact of it", () => {
  const crowd = Array.from({ length: 12 }, (_, i) => ({ handle: `r${i}`, distance_m: 10 * (i + 1), bearing: "N", band: "close by", source: i === 11 ? "parcel" : "walk" }));
  const active = new Map([
    ["r0", { action: "say", at: NOW - 5 * 60000 }],
    ["r1", { action: "note-to-self", at: NOW - 60000 }],                     // private: never seen
    ["r2", { action: "walk", at: NOW - ACTIVE_WINDOW_MS - 60000 }],          // older than 12 h
    ...Array.from({ length: 9 }, (_, i) => [`r${i + 3}`, { action: "take", at: new Date(NOW - 3600000).toISOString() }]),
  ]);
  const who = whoBlock(crowd, active, { nowMs: NOW });
  assert.equal(who.active.length, ACTIVE_CAP);
  assert.equal(who.active[0].handle, "r0");
  assert.equal(who.active[0].last, "said something, 5 min ago");
  assert.ok(!who.active.some((r) => r.handle === "r1" || r.handle === "r2"));
  assert.equal(who.more_active, 10 - ACTIVE_CAP, "the rest of the active are counted");
  assert.equal(who.around_but_quiet.count, 2);
  assert.deepEqual(who.around_but_quiet.nearest, ["r1 (20 m)", "r2 (30 m)"]);
  assert.ok(!JSON.stringify(who).includes("note-to-self"));
  const home = whoBlock([crowd[11]], new Map(), { nowMs: NOW });
  assert.deepEqual(home.around_but_quiet.nearest, ["r11 (120 m, at home)"]);
});

test("G5: the public acts are the ones the crossing log or the docket publishes, and note-to-self is not one", () => {
  assert.deepEqual(Object.keys(PUBLIC_ACTS).sort(), ["drop", "enter", "exit", "give", "leave-mark", "say", "stake", "take", "walk", "withdraw"]);
});

test("G8 (POS-697 G1a): each act's line is the approved sentence WITH its fields, grouped by intent; an unknown act rides `more`", () => {
  const entries = ["say", "walk", "enter", "take", "candy-trade", "stake"].map((action) => ({ action, blurb: "A candy trade swaps two candies. More words.",
    ...(action === "candy-trade" ? { fields: { with: { type: "string", required: true }, kind: { type: "string" } } } : {}) }));
  const can = canBlock(entries, { pace: 5, handles: ["wright", "rei"], standing: "wright", notYours: [{ action: "build", because: "not your ground" }] });
  assert.deepEqual(Object.keys(can), ["speak", "move", "back", "carry", "more", "not_here", "as"]);
  assert.equal(can.speak.say, `${ONE_LINERS.say.says} Fields: text.`);
  assert.equal(can.move.walk, "Walk to a mark or a point, at about 5 km an hour. Fields: mark_id or to_x + to_y, mode?, enter_on_arrival?.");
  // an act with no approved line names its own schema's fields, the optional ones marked
  assert.equal(can.more["candy-trade"], "A candy trade swaps two candies. Fields: with, kind?.");
  // every grouped act's line names every field its approved line names: the first act needs no guess
  for (const group of ["speak", "move", "back", "carry"])
    for (const [act, line] of Object.entries(can[group])) assert.ok(line.endsWith(`Fields: ${ONE_LINERS[act].fields.join(", ")}.`), `${act}: ${line}`);
  assert.deepEqual(can.not_here, [{ act: "build", because: "not your ground" }]);
  const both = canBlock(entries, { notYours: [{ action: "say", because: "this door is for a human" }] });
  assert.equal(both.not_here, undefined, "G1: a refusal of an act your own grant opens is not said");
  assert.match(can.as, /^wright \(one of 2 residents on your key/);
  assert.equal(actLine({ action: "walk" }), "Walk to a mark or a point. Fields: mark_id or to_x + to_y, mode?, enter_on_arrival?.", "no dial, no speed");
  assert.equal(actLine({ action: "wave", blurb: "Wave." }), "Wave. No fields.");
});

test("G7: happening_here says the vessel's next departures and the Mists only where you stand in them; nothing is null", () => {
  assert.equal(happeningBlock({}), null);
  assert.equal(happeningBlock({ mists: { in_wall: false, thickness: 0 } }), null, "clear of the Mists: the air says it");
  const snug = { id: "the-town/the-snug", name: "the Snug", body: "A small harbour." };
  const h = happeningBlock({ departures: { next: [{ at: "2026-10-15T01:30:00Z", toward: "the-town/the-snug" }] }, mists: { in_wall: false, thickness: 0.4 }, markOf: (id) => (id === snug.id ? snug : null) });
  assert.deepEqual(h.map((r) => r.kind), ["departure", "emission"]);
  assert.equal(h[0].at, "01:30Z");
  assert.deepEqual(h[0].to, snug, "a departure's destination is shown whole");
  assert.equal(h[0].what, "the Post Office leaves here for the Snug");
  assert.deepEqual(unbodied(h), []);
  const cal = { now: [
    { id: "postmaster/halloween", title: "Halloween in Postmark", place: { mark: "the-town/the-quay-reach", name: "the Quay Reach", x: 0, y: 0 }, phase: "underway", ends: "2026-11-01T04:00:00Z" },
    { id: "a/far-party", title: "Far party", place: { mark: "a/elsewhere", x: 5000, y: 5000 }, phase: "underway", ends: "2026-11-01T04:00:00Z" },
    { id: "b/near-point", title: "On the steps", place: { mark: null, x: 100, y: 100 }, phase: "doors-open", ends: "2026-11-01T04:00:00Z" },
  ] };
  const here = eventsHere(cal, { at: { x: 0, y: 50 }, ids: new Set(["the-town/the-quay-reach"]) });
  assert.deepEqual(here.map((e) => e.id), ["postmaster/halloween", "b/near-point"], "on the spine, or its point within 150 m");
  const reach = { id: "the-town/the-quay-reach", name: "the Quay Reach", body: "The mail's own water." };
  const rows = happeningBlock({ events: here, markOf: (id) => (id === reach.id ? reach : null) });
  assert.equal(rows[0].kind, "event");
  assert.deepEqual(rows[0].place, reach, "an event's place is shown whole");
  assert.equal(rows[0].event, "postmaster/halloween");
  assert.deepEqual(unbodied(rows), []);
});

test("G4: happened with no cursor names where it reaches back to; an unread delta says so", () => {
  const g = happenedGlance({ to_you: { complete: true, count: 0, events: [] }, around_you: { count: 7, events: [
    { kind: "departure", actor: "elowen", at: "2026-10-15T00:01:00Z" }, { kind: "emission", actor: "fizz", at: "2026-10-15T00:00:09Z" },
    { kind: "attachment", actor: "kai", at: "2026-10-14T23:00:00Z" }, { kind: "departure", actor: "x", at: "2026-10-14T22:00:00Z" },
  ] } }, { sinceCrossing: 249 });
  assert.equal(g.since, "crossing 249");
  assert.equal(g.around_you.events.length, 3);
  assert.equal(g.around_you.count, 7);
  assert.deepEqual(g.around_you.events[0], { who: "elowen", what: "set out", when: "00:01Z" });
  assert.match(happenedGlance(null, { sinceCrossing: 249 }).unavailable, /not read/);
  assert.equal(g.complete, true, "nothing cut is said as complete");
  const cut = happenedGlance({ complete: false, reach: "clamped to the last 14 crossings", around_you: { events: [] } }, { sinceCrossing: 236 });
  assert.equal(cut.complete, false, "a cut delta says so (review-559 § 2)");
  assert.match(cut.reach, /clamped/);
});

test("the assembled read: you, now, view, who, can, law in order; no URL; happened always", () => {
  const v2 = shapeV2({
    handle: "wright", standpoint: { x: -318, y: 211, seat: { ground: "x" } }, spine: [{ id: "the-town/the-town-centre" }, { id: "the-town/the-quay-reach" }],
    marks: new Map([["the-town/the-town-centre", { id: "the-town/the-town-centre", name: "the Town Centre", body: "A." }], ["the-town/the-quay-reach", { id: "the-town/the-quay-reach", name: "the Quay Reach", body: "The reach." }]]),
    here: "the Quay Reach, the Town Centre", holdings: [], stancesAwaiting: 55, note: null, crossing: 250, nextCrossingIn: "11h 52m",
    canon: "S109", nextSettlement: "06:00Z", happened: null, sinceCrossing: 249, viewRows: [], crowd: [], active: new Map(), nowMs: NOW, entries: [{ action: "say" }],
  });
  assert.deepEqual(Object.keys(v2).slice(0, 7), ["you", "now", "view", "who", "heard", "can", "law"]);
  assert.match(v2.heard.unavailable, /read: "say"/, "earshot not read here is said, never an empty room");
  assert.deepEqual(v2.you.within.map((m) => m.body), ["A.", "The reach."], "every spine mark carries its whole body");
  assert.ok(!("here_body" in v2.you), "here_body repeated the innermost; within carries it");
  assert.deepEqual(unbodied(v2), [], "no mark is shown without its body");
  const dark = shapeV2({ standpoint: { x: 0, y: 0 }, spine: [], crossing: 1, entries: [], canUnavailable: "the world store is not open" });
  // open ground: the place the words say you are near rides as a row (review-559 Addendum 3)
  const gauge = { id: "histor-reeves/the-gauge-house", name: "the Gauge House", body: "A low brick house." };
  const open = shapeV2({ standpoint: { x: 0, y: 0 }, spine: [], here: "near the Gauge House", near: gauge, crossing: 1, entries: [] });
  assert.deepEqual(open.you.near, gauge);
  assert.deepEqual(unbodied(open), []);
  assert.deepEqual(unbodied({ ...open, you: { ...open.you, near: undefined } }), ['you.here: names "the Gauge House" with no row of it beside the words'], "the check reads the words");
  assert.deepEqual(dark.can, { unavailable: "the world store is not open" }, "an unreadable class layer is said, never an empty can (review-555 § 1)");
  assert.deepEqual(v2.you.seat, { ground: { id: "x", name: "x", body: "" } }, "G1: the seat is said on you, its ground a row");
  assert.deepEqual(v2.you.waiting_on_you, { stances: 55, read: 'household { read: "stances" }' });
  assert.ok("happened" in v2.now);
  assert.doesNotMatch(JSON.stringify(v2), /https?:\/\//);
  assert.equal(inWords(52 * 60000 + 11 * 3600000), "11h 52m");
});

// review-555 (10-14): the bodies check passed on empty blocks. This fills every
// conditional block from its own producer (the aboard block's ride half from
// world-ride.mjs, the arrival lines from arrival-entries.mjs, to_you from
// world-happened.mjs with a claim, a hold and a carried leg), reads the bodies
// for exactly the ids markIdsShown names, and holds that no mark is bare.
test("every block filled: aboard, seat, arrival, to_you events — each mark they name is shown whole", () => {
  const PO = "the-town/the-post-office";
  const service = { pace: 15000, stops: [
    { markId: "the-town/the-quay-reach", at: { x: 0, y: 0 } },
    { markId: "the-town/the-snug", at: { x: 3000, y: 0 } },
    { markId: "the-town/lanternseed", at: { x: 0, y: 4000 } },
  ] };
  const acts = [
    { object: PO, action: "enter", payload: { via: "the-town/the-quay-reach" } },
    { object: PO, action: "ride", payload: { origin: "the-town/the-quay-reach", to: "the-town/the-snug", distance_m: 3000, pace_km_per_crossing: 15, declared_at: "2026-10-14T23:00:00Z", arrives_at: "2026-10-15T00:00:00Z" } },
  ];
  const frame = {
    aboard: PO, offset: { x: 2, y: 1 }, provenance: "a stop's door",
    moves_next: { at: "2026-10-15T01:30:00Z", toward: "the-town/lanternseed", crossing: 250.1 },
    how_to_leave: "world_walk anywhere off her footprint.", terms: "you ride where she goes.",
    ...rideBlockFrom({ vesselId: PO, service, acts, nowMs: NOW }),
  };
  const nowC = currentCrossing(NOW);
  const decided = new Date(NOW - 3600000).toISOString();
  const happened = { to_you: toYou({
    transitions: [{ kind: "born", carrier: PO, at: decided, crossing: nowC, reason: "you entered through a stop" }],
    carriedLegs: [{ carrier: PO, at: decided, crossing: nowC, metres: 900, from: { x: 0, y: 0 }, to: { x: 900, y: 0 } }],
    claimEffects: { readable: true, events: claimEffectsFrom({ rows: [{ slug: "wright/the-reading-room", status: "locked", submitted_at: decided, decided_at: decided, window_id: 77 }], sinceCrossing: nowC - 1, nowCrossing: nowC, mine: () => true }) },
    holdEffects: { readable: true, events: holdEffectsFrom({ rows: [{ class: "holding", action: "give", object: "iris/a-lantern", actor: "iris", crossing: nowC, written_at: decided, payload: { holder: "wright", previous_holder: "iris" } }], handles: ["wright"], sinceCrossing: nowC - 1, nowCrossing: nowC }) },
    sinceCrossing: nowC - 1, nowCrossing: nowC,
  }), around_you: { count: 0, events: [] } };
  const standpoint = {
    x: 10, y: 5,
    seat: { ground: "the-town/the-quay-reach", seat: "wright", human: "keemin", note: "you are seated by this ground" },
    ...arrivalLine({ mark: "the-town/the-snug", settled_at: null, due_at: "2026-10-15T00:30:00Z" }),
    ...arrivalLine({ mark: "the-town/lanternseed", settled_at: decided, outcome: "refused", words: "not tonight" }),
  };
  const spine = [{ id: "the-town/let-there-be-light" }];
  const ids = markIdsShown({ spine, frame, standpoint, happened });
  for (const id of [PO, "the-town/the-quay-reach", "the-town/the-snug", "the-town/lanternseed", "wright/the-reading-room", "iris/a-lantern"])
    assert.ok(ids.includes(id), `${id} is read for its body`);
  const marks = new Map(ids.map((id) => [id, { id, name: id.split("/")[1], body: `The body of ${id}.` }]));
  const v2 = shapeV2({ marks, handle: "wright", standpoint, spine, frame, happened, crossing: nowC, sinceCrossing: nowC - 1,
    viewRows: [], crowd: [], active: new Map(), nowMs: NOW, entries: [] });
  for (const k of ["aboard", "seat", "arrival", "enters_on_arrival"]) assert.ok(v2.you[k], `the fixture fills you.${k}`);
  assert.ok(v2.you.aboard.can_ride_to.length && v2.you.aboard.ride && v2.you.aboard.arrived, "and the ride half of aboard");
  assert.deepEqual(v2.now.happened.to_you.events.map((e) => e.kind).sort(), ["carried", "claim-locked", "claim-pending", "frame-entered", "hold-give"]);
  assert.deepEqual(unbodied(v2), [], "no mark is shown without its body");
  assert.equal(v2.you.aboard.aboard.body, `The body of ${PO}.`);
  assert.equal(v2.you.aboard.moves_next.toward.body, "The body of the-town/lanternseed.");
  assert.equal(v2.you.seat.ground.body, "The body of the-town/the-quay-reach.");
  assert.equal(v2.you.arrival.mark.body, "The body of the-town/lanternseed.");
  assert.equal(v2.you.enters_on_arrival.mark.body, "The body of the-town/the-snug.");
  assert.equal(v2.now.happened.to_you.events.find((e) => e.kind === "claim-locked").mark.body, "The body of wright/the-reading-room.");
});

test("activeOf: one query for the crowd, public acts only, and a store that cannot answer is said", async () => {
  let asked = null;
  const r = await activeOf(["a", "b", "a"], { query: async (text, params) => { asked = { text, params }; return [{ handle: "a", action: "say", at: new Date(NOW) }]; } });
  assert.equal(asked.text, ACTIVE_SQL);
  assert.deepEqual(asked.params[0], ["a", "b"]);
  assert.deepEqual(asked.params[1], Object.keys(PUBLIC_ACTS));
  assert.equal(asked.params[2], ACTIVE_WINDOW_MS / 1000);
  assert.deepEqual(r.active.get("a"), { action: "say", at: NOW });
  assert.match((await activeOf(["a"], { query: async () => null })).unavailable, /store/);
  assert.match((await activeOf(["a"], { query: async () => { throw new Error("gone"); } })).unavailable, /could not be read/);
  assert.equal((await activeOf([], { query: async () => { throw new Error("never asked"); } })).active.size, 0);
});

test("G6: heard is the newest three, each cut at 140 characters with an ellipsis", () => {
  const voices = Array.from({ length: 5 }, (_, i) => ({ handle: `r${i}`, said: i === 4 ? "x".repeat(300) : `line ${i}`, ago: "1 min" }));
  const h = heardBlock(voices);
  assert.equal(h.length, HEARD_CAP);
  assert.deepEqual(h.map((v) => v.from), ["r2", "r3", "r4"], "newest last, as the room reads");
  assert.equal(h[2].said.length, SAID_MAX);
  assert.ok(h[2].said.endsWith("…"));
  assert.equal(h[0].said, "line 2");
});

test("POS-697 G2a: shapeV2Focus is where you are and the focus, with no cursor and the glance a call away", async () => {
  const { shapeV2Focus, FOCUS_MORE_V2 } = await import("../src/world-read-v2.mjs");
  const found = { q: "snug", hits: [{ id: "a/b" }] };
  const r = shapeV2Focus({ handle: "wright", standpoint: { x: -1476.6, y: -2233 }, here: "the Marquee", found });
  assert.deepEqual(r, { you: { handle: "wright", at: { x: -1477, y: -2233 }, here: "the Marquee" }, found, more: FOCUS_MORE_V2,
    reading_law: r.reading_law, read_shape: "v2" });
  assert.match(FOCUS_MORE_V2, /world \{ read_shape: "v2" \} is the whole glance/);
  assert.deepEqual(Object.keys(shapeV2Focus({ standpoint: { x: 0, y: 0 } }).you), ["at"], "a spectator names no handle and no place it was not told");
});

test("POS-697 G3a: an around_you row says where, how far, and a departure's destination whole; a say stays the fact of it (G5)", () => {
  const pier = { id: "a/the-pier", name: "the Pier", body: "Boards over the water." };
  const g = happenedGlance({ around_you: { count: 2, events: [
    { kind: "departure", actor: "elowen", at: "2026-10-15T00:01:00Z", x: 130, y: 240, m: 50, where: "the Quay", toward: pier },
    { kind: "emission", actor: "mari", at: "2026-10-15T00:00:09Z", x: 100, y: 200, m: 0, where: "the Quay", place: "a/b", text: "hello" },
  ] } }, { sinceCrossing: 249 });
  assert.deepEqual(g.around_you.events[0], { who: "elowen", what: "set out", when: "00:01Z", where: "the Quay", m: 50, toward: pier });
  assert.deepEqual(g.around_you.events[1], { who: "mari", what: "spoke", when: "00:00Z", where: "the Quay", m: 0 }, "no words, no raw place id");
  // a destination the body read missed (a bare id) is not shown as a mark
  const bare = happenedGlance({ around_you: { events: [{ kind: "departure", actor: "x", at: "2026-10-15T00:01:00Z", toward: "a/the-pier" }] } }, { sinceCrossing: 249 });
  assert.equal(bare.around_you.events[0].toward, undefined);
});

test("POS-697 G4a: to_you in the glance is the short form; a gap is named in a few words, never a paragraph", async () => {
  const { toYou } = await import("../src/world-happened.mjs");
  const whole = toYou({ sinceCrossing: 258, nowCrossing: 259 });
  const ok = happenedGlance({ to_you: whole, around_you: { events: [] } }, { sinceCrossing: 258 });
  assert.deepEqual(ok.to_you, { complete: true, count: 0, events: [] });
  const cut = toYou({ sinceCrossing: 258, nowCrossing: 259, creatureEffects: { events: [], readable: false, missing: "creatures' reactions older than 25 h", reason: "long" } });
  assert.match(cut.note, /^INCOMPLETE/, "v1 keeps its sentence");
  assert.deepEqual(cut.missing, ["creatures' reactions older than 25 h"]);
  const g = happenedGlance({ to_you: cut, around_you: { events: [] } }, { sinceCrossing: 258 });
  assert.deepEqual(g.to_you, { complete: false, missing: ["creatures' reactions older than 25 h"], count: 0, events: [] });
  assert.ok(JSON.stringify(g.to_you, null, 1).length < 140, JSON.stringify(g.to_you));
});

test("POS-697 item 6: under v2, cards: \"names\" says can by name and cards: \"full\" adds every card whole", async () => {
  const { fullCards } = await import("../src/world-read-v2.mjs");
  const entries = ["say", "walk", "candy-trade"].map((action) => ({ action, blurb: "B.", fields: { x: { type: "string" } }, from: "the-town/resident" }));
  assert.deepEqual(canBlock(entries, { names: true }), { speak: ["say"], move: ["walk"], more: ["candy-trade"] });
  assert.deepEqual(fullCards(entries).walk, entries[1]);
  const p = { entries, standpoint: { x: 0, y: 0 }, crossing: 1, happened: null, sinceCrossing: 0 };
  assert.deepEqual(Object.keys(shapeV2({ ...p, cards: "full" }).cards), ["say", "walk", "candy-trade"]);
  assert.ok(!("cards" in shapeV2(p)), "omitted, no cards");
  assert.deepEqual(shapeV2({ ...p, cards: "names" }).can.move, ["walk"]);
});
