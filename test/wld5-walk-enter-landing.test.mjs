// wld5-walk-enter-landing.test.mjs — a walk's enter_on_arrival through a portal
// sets the walker down at the portal's landing, as a plain enter does (WLD-5).
//
// FOUND walking the Spire's shell in the playground (lane plumb-spire-ktable,
// 2026-10-13, transcript G:/Starstory/docs/2026-10-13/rail/spire-ktable/): a
// stranger walked to the vestibule's portal with `enter_on_arrival: true`. The
// passage was written (out of the vestibule, into the Rose Hall), but the walker
// stayed where the walk ended, on the vestibule's side of the wall. The read's
// `within` then dropped the Rose Hall (the standpoint was not in it), and every
// portal of the vestibule was hidden from them: inside the Spire, in no room. A
// plain `enter` at the same portal set them down at its landing.
//
// THE CAUSE: walkViaOffice handed the arrival entry `stop: null` (#2859), and
// the landing is world-crossings.mjs § passThroughPortal's `deps.stop`. THE FIX
// is no second landing path: the arrival composition (world.mjs §
// arrivalEntryDeps) keeps `walking: null` and hands the same stop, dated at the
// arrival crossing; the walk door writes that set-down for that instant
// (`__at`), and the record's reads hold it back until then (the projection, below).
//
// The fixture is test/wld5-portals.test.mjs's ruled instance in miniature, on the
// REAL clone's verbs, and it skips (saying why) on a clone that predates WLD-5.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { enterViaOffice } from "../src/world-crossings.mjs";
import { arrivalEntryDeps } from "../src/world.mjs";
import { createPositionProjection } from "../src/position-projection.mjs";
import { NO_WORLD, worldClone } from "./fixture-paths.mjs";

const CLONE = worldClone();
const HAVE = !!CLONE && existsSync(join(CLONE, "tools", "portals.mjs"));
const SKIP = !HAVE && (CLONE ? `the world clone at ${CLONE} predates WLD-5 (no tools/portals.mjs)` : NO_WORLD);
const grammarOf = async () => import(pathToFileURL(join(CLONE, "tools", "enter-exit.mjs")).href);

const SPIRE = "spire/the-spire";
const marks = () => [
  { id: "spire/grounds", kind: "sited", by: "spire", at: { x: 1000, y: 1000 }, extent: { w: 500, h: 400 }, body: "The open Grounds." },
  { id: "spire/forecourt", kind: "sited", by: "spire", at: { x: 800, y: 1000 }, extent: { w: 80, h: 120 }, body: "The Forecourt." },
  { id: SPIRE, kind: "sited", by: "spire", class: "dungeon", at: { x: 1000, y: 1000 }, extent: { w: 300, h: 300 }, body: "The Spire." },
  { id: "spire/vestibule", kind: "sited", by: "spire", at: { x: 880, y: 1000 }, extent: { w: 50, h: 50 }, body: "The vestibule." },
  // the outside face stands in the Forecourt, 2 m clear of the Spire's west wall (x 850)
  { id: "spire/doors-outside", kind: "sited", by: "spire", at: { x: 838, y: 1000 }, extent: { w: 2, h: 2 }, body: "The Gilded Doors.",
    entry: { word: "welcomed", into: "spire/vestibule", lands_at: "spire/doors-inside" } },
  { id: "spire/doors-inside", kind: "sited", by: "spire", at: { x: 860, y: 1000 }, extent: { w: 2, h: 2 }, body: "From inside.",
    entry: { word: "neutral", into: "spire/forecourt", lands_at: "spire/doors-outside" } },
];
const key = (...h) => ({ handles: new Set(h) });
const DEPARTED = 300;          // the crossing the walk was declared at
const ARRIVES = 300.0001;      // departure + the leg's eta: where the arrival entry is judged
const OUTSIDE_FACE = { x: 838, y: 1000 };
const INSIDE_FACE = { x: 860, y: 1000 };

/** The office's crossing deps as crossingDeps() would hand them, observable: the
 *  walker standing at the start of the walk (the Forecourt), a walk in flight,
 *  an in-memory threshold ledger, and a `stop` that records what it was asked. */
async function crossingDepsLike() {
  const thresholds = await grammarOf();
  const worldState = { marks: marks() };
  let text = "";
  const stops = [], records = [];
  return {
    stops, records,
    deps: {
      world: async () => worldState,
      ledger: async () => text,
      standpointOf: async (who) => ({ x: 780, y: 1000, name: who }),
      acts: async () => [],
      now: () => DEPARTED,
      walking: async () => ({ live: true, x: 790, y: 1000 }),
      record: async (payload) => {
        records.push(payload);
        text += payload.lines.join("\n") + "\n";
        const folded = thresholds.parseEnterExitLedger(text).acts;
        return { lines: payload.lines, within: thresholds.occupancyAt(folded, payload.at ?? DEPARTED).get(payload.handle) ?? [], commit: "deadbeef", pushed: false };
      },
      stop: async (who, to, k, opts = {}) => { stops.push({ who, to, from: opts.from ?? null, at: opts.at ?? null }); },
    },
  };
}

test("THE TRANSCRIPT · walk onto the Gilded Doors' outside face with enter_on_arrival: the walker is set down in the vestibule, at the inside face, at the arrival", { skip: SKIP }, async () => {
  const o = await crossingDepsLike();
  // exactly what walkViaOffice hands the door: its own crossing deps, through arrivalEntryDeps
  const deps = arrivalEntryDeps(o.deps, { arrivedAtCrossing: ARRIVES, toward: OUTSIDE_FACE, who: "ann" });
  const a = await enterViaOffice(CLONE, { mark: "spire/doors-outside", handle: "ann" }, key("ann"), deps);

  assert.deepEqual(a.entered, [SPIRE, "spire/vestibule"], "the passage enters the dungeon and the room");
  assert.equal(o.records.length, 1, "one passage, written once");
  assert.equal(o.records[0].via, "spire/doors-outside");
  // THE LANDING: the same zero-length set-down a plain enter writes, dated at the arrival
  assert.deepEqual(o.stops, [{ who: "ann", to: INSIDE_FACE, from: INSIDE_FACE, at: ARRIVES }],
    "set down at the inside face, from the inside face, at the arrival crossing");
  assert.deepEqual(a.landed, { ...INSIDE_FACE, mark: "spire/doors-inside", clamped: false, recorded: true });
  assert.deepEqual(a.portals.map((p) => p.id), ["spire/doors-inside"], "and the vestibule's portals are the next step");
  assert.equal("walk_ended" in a, false, "#2859 holds: the walk that arrived is not stopped again");
});

test("the same passage by a plain enter, standing at the doors, lands in the same place: one landing path", { skip: SKIP }, async () => {
  const o = await crossingDepsLike();
  const plain = { ...o.deps, walking: null, standpointOf: async (who) => ({ ...OUTSIDE_FACE, name: who }) };
  const a = await enterViaOffice(CLONE, { mark: "spire/doors-outside", handle: "ann" }, key("ann"), plain);
  assert.deepEqual(o.stops, [{ who: "ann", to: INSIDE_FACE, from: INSIDE_FACE, at: null }], "a plain enter sets down now (no `at`)");
  assert.deepEqual(a.landed, { ...INSIDE_FACE, mark: "spire/doors-inside", clamped: false, recorded: true });
});

test("an arrival entry that is NOT a portal still issues no stop (#2859): the walk-ending hook stays off", { skip: SKIP }, async () => {
  const o = await crossingDepsLike();
  const deps = arrivalEntryDeps(o.deps, { arrivedAtCrossing: ARRIVES, toward: { x: 800, y: 1000 }, who: "ann" });
  const a = await enterViaOffice(CLONE, { mark: "spire/forecourt", handle: "ann" }, key("ann"), deps);
  assert.ok(a.entered.includes("spire/forecourt"), "the fixture must actually enter, or nothing is exercised");
  assert.deepEqual(o.stops, [], "no stop: `walking` is null, and a room is not a portal");
});

// ── THE PROJECTION HOLDS A SET-DOWN UNTIL IT FALLS DUE ───────────────────────
//
// The landing is written at the walk's declaration but dated at its arrival.
// world-movement.mjs § storedDepartures skips an act written after the instant
// read; the projection, which takes a walk in the same step as its write, has
// to agree, or the walker would be read at the landing the moment they set out.

function projectionAt(clock) {
  const store = [];
  const p = createPositionProjection({ now: () => clock.ms, maxAgeMs: 60_000,
    rebuild: async (atMs) => ({ departures: store.filter((r) => Date.parse(r.iso) <= atMs) }) });
  return { p, store };
}
const rec = (iso, toward, handle = "ann") => ({ handle, iso, from: toward, toward, at: 300, source: "store" });
const T0 = Date.parse("2026-10-14T03:00:00.000Z");

test("a set-down written now for a later instant is not read until that instant, then governs", async () => {
  const clock = { ms: T0 };
  const { p, store } = projectionAt(clock);
  const walk = rec(new Date(T0).toISOString(), OUTSIDE_FACE);
  store.push(walk); await p.departures(); p.record(walk);
  const landing = rec(new Date(T0 + 30_000).toISOString(), INSIDE_FACE);
  store.push(landing); p.record(landing);
  assert.deepEqual((await p.entry("ann")).where.toward, OUTSIDE_FACE, "before the arrival: still walking to the doors");
  clock.ms = T0 + 30_000;
  assert.deepEqual((await p.entry("ann")).where.toward, INSIDE_FACE, "at the arrival: set down at the landing");
  clock.ms = T0 + 120_000;
  assert.deepEqual((await p.entry("ann")).where.toward, INSIDE_FACE, "and the rebuild from the record agrees");
});

test("a newer walk declared before the set-down falls due supersedes it, as the record's write order says", async () => {
  const clock = { ms: T0 };
  const { p, store } = projectionAt(clock);
  await p.departures();
  const landing = rec(new Date(T0 + 30_000).toISOString(), INSIDE_FACE);
  store.push(landing); p.record(landing);
  clock.ms = T0 + 10_000;
  const turned = rec(new Date(T0 + 10_000).toISOString(), { x: 700, y: 1000 });
  store.push(turned); p.record(turned);
  clock.ms = T0 + 40_000;
  assert.deepEqual((await p.entry("ann")).where.toward, { x: 700, y: 1000 }, "the later write governs once both are due");
});
