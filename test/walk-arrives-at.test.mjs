// walk-arrives-at.test.mjs — the walk read gives arrival as a UTC instant
// beside the crossing count (POS-331 part 3; Office Hours 10-02, Q8).
//
// Amia: "I dispatched a walk at crossing 225.44, calculated 0.04 crossings,
// and arrived two hours before I meant to, a timezone error I couldn't
// catch… One line giving ETA as a wall-clock time alongside the crossing
// count would close that gap." Her walk is the case: 225.44 + 0.04 = 225.48
// crossings after 2026-06-12T00:00Z, at 12 hours a crossing, is
// 2026-10-02T17:45:36Z, said to the minute.
//
// The walk receipt carries the same field; its leg is in
// test/pos-171-receipt-wording.test.mjs (leg 5c), through the real door.
//
//   node --test test/walk-arrives-at.test.mjs

import test from "node:test";
import assert from "node:assert/strict";

import { arrivesAt, CROSSING_EPOCH_UTC, CROSSING_MS } from "../src/crossings.mjs";
import { walkDomain } from "../src/world-apex.mjs";

const AMIA = "2026-10-02T17:46:00.000Z";

test("Amia's walk: dispatched at 225.44, 0.04 crossings out, arrives 2026-10-02T17:46Z", () => {
  assert.equal(arrivesAt(225.44, 0.04), AMIA);
  // the unrounded instant, so the minute above is the honest rounding of it
  assert.equal(new Date(CROSSING_EPOCH_UTC + 225.48 * CROSSING_MS).toISOString(), "2026-10-02T17:45:36.000Z");
});

test("the instant is said to the minute, in UTC, and is null when either half is unreadable", () => {
  assert.match(arrivesAt(100, 0.5), /^\d{4}-\d\d-\d\dT\d\d:\d\d:00\.000Z$/);
  assert.equal(arrivesAt(100, 0), new Date(CROSSING_EPOCH_UTC + 100 * CROSSING_MS).toISOString(), "a zero eta is the departure instant");
  for (const [from, eta] of [[null, 0.04], [225.44, null], [225.44, undefined], ["x", 0.04], [225.44, NaN]])
    assert.equal(arrivesAt(from, eta), null, `${from} + ${eta}`);
});

test("read: walk — a moving row carries arrives_at beside eta_crossings; a still row and the vessel's do not", () => {
  const answer = { at: 225.44, walkers: [
    { handle: "amia-semper", x: 10, y: 10, source: "walk", moving: true, remaining_m: 2400, eta_crossings: 0.04, toward: { x: 10, y: 2410 } },
    { handle: "kogane", x: 20, y: 0, source: "ground", moving: false, remaining_m: 0, eta_crossings: 0 },
    { handle: "the-post-office", x: 30, y: 0, source: "timetable", moving: true, remaining_m: 0, eta_crossings: 0, provenance: "timetable" },
  ] };
  const oriented = { standpoint: { x: 0, y: 0 } };
  const { walkers } = walkDomain(answer, {}, oriented);
  const row = (h) => walkers.walkers.find((w) => w.handle === h);
  assert.equal(row("amia-semper").arrives_at, AMIA);
  assert.equal(row("amia-semper").eta_crossings, 0.04, "beside the crossing count, which stays");
  assert.equal("arrives_at" in row("kogane"), false, "standing still arrives nowhere");
  assert.equal("arrives_at" in row("the-post-office"), false, "her eta is the timetable's placeholder 0, not an arrival");
  assert.equal(walkers.at, 225.44, "the crossing the instant is counted from rides beside it");
});
