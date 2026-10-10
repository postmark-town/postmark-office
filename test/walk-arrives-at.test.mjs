// walk-arrives-at.test.mjs — the walk read gives arrival as a UTC instant
// beside the crossing count (POS-331 part 3; Office Hours 10-02, Q8).
//
// Amia: "I dispatched a walk at crossing 225.44, calculated 0.04 crossings,
// and arrived two hours before I meant to, a timezone error I couldn't
// catch… One line giving ETA as a wall-clock time alongside the crossing
// count would close that gap." Her walk is the case: at 60 km a crossing,
// 0.04 crossings is 2,400 m, so 225.48 crossings after 2026-06-12T00:00Z, at
// 12 hours a crossing: 2026-10-02T17:45:36Z.
//
// ONE DERIVATION, NOT TWO ROUNDINGS (review of #448). The instant is the
// unrounded remainder over the leg's own stride, never `eta_crossings` (rounded
// to hundredths, 7.2 minutes), so the receipt at departure and `read: "walk"`
// later name the same second. The receipt's own leg, through the real door,
// is test/pos-171-receipt-wording.test.mjs leg 5c.
//
//   WORLD_CLONE=<a world checkout> node --test test/walk-arrives-at.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { NO_WORLD, worldClone } from "./fixture-paths.mjs";
import { arrivesAt, CROSSING_EPOCH_UTC, CROSSING_MS } from "../src/crossings.mjs";
import { walkDomain } from "../src/world-apex.mjs";
import { walkerPaces } from "../src/world.mjs";

const CLONE = worldClone();
const HAVE_ENGINE = Boolean(CLONE) && existsSync(join(CLONE, "tools", "walk.mjs"));
const AMIA = "2026-10-02T17:45:36.000Z";
const instantOf = (c) => new Date(CROSSING_EPOCH_UTC + c * CROSSING_MS);

test("Amia's walk: dispatched at 225.44, 2,400 m out at 60 km a crossing, arrives 2026-10-02T17:45:36Z", () => {
  assert.equal(arrivesAt(225.44, 2400, 60), AMIA);
  assert.equal(instantOf(225.48).toISOString(), AMIA);
});

test("the instant is said to the second, in UTC, and is null when any input is unreadable", () => {
  assert.match(arrivesAt(100, 1234, 60), /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.000Z$/);
  assert.equal(arrivesAt(100, 0, 60), instantOf(100).toISOString(), "nothing left to walk is the instant itself");
  for (const args of [[null, 2400, 60], [225.44, null, 60], [225.44, 2400, null], ["x", 2400, 60], [225.44, NaN, 60], [225.44, 2400, 0], [225.44, 2400, -15]])
    assert.equal(arrivesAt(...args), null, JSON.stringify(args));
});

test("walkerPaces: a walking row carries its leg's stride, the stamped pace or the legacy constant; riders, the vessel and the still carry none", () => {
  const walk = {
    currentDeparture: (deps, h) => { let cur = null; for (const d of deps) if (d.handle === h) cur = d; return cur; },
    WALK_KM_PER_CROSSING: 15,
  };
  const departures = [{ handle: "amia-semper", pace: 30 }, { handle: "amia-semper", pace: 60 }, { handle: "old-walker", pace: null }];
  const rows = walkerPaces([
    { handle: "amia-semper", moving: true, source: "walk", remaining_m: 2400 },
    { handle: "old-walker", moving: true, source: "walk", remaining_m: 500 },
    { handle: "rider", moving: true, source: "walk", aboard: true, remaining_m: 0 },
    { handle: "the-post-office", moving: true, source: "timetable", remaining_m: 0 },
    { handle: "kogane", moving: false, source: "ground", remaining_m: 0 },
  ], departures, walk);
  const by = Object.fromEntries(rows.map((r) => [r.handle, r]));
  assert.equal(by["amia-semper"].pace_km_per_crossing, 60, "the CURRENT departure's stamp");
  assert.equal(by["old-walker"].pace_km_per_crossing, 15, "an unstamped row walks at the engine's legacy constant");
  for (const h of ["rider", "the-post-office", "kogane"]) assert.equal("pace_km_per_crossing" in by[h], false, h);
});

test("read: walk — a walking row carries arrives_at; a still row, a rider and the vessel's do not", () => {
  const answer = { at: 225.44, walkers: [
    { handle: "amia-semper", x: 10, y: 10, source: "walk", moving: true, remaining_m: 2400, eta_crossings: 0.04, pace_km_per_crossing: 60 },
    { handle: "kogane", x: 20, y: 0, source: "ground", moving: false, remaining_m: 0, eta_crossings: 0 },
    { handle: "rider", x: 25, y: 0, source: "walk", moving: true, aboard: true, remaining_m: 0, eta_crossings: 0, pace_km_per_crossing: 60 },
    { handle: "the-post-office", x: 30, y: 0, source: "timetable", moving: true, remaining_m: 0, eta_crossings: 0 },
  ] };
  const { walkers } = walkDomain(answer, {}, { standpoint: { x: 0, y: 0 } });
  const row = (h) => walkers.walkers.find((w) => w.handle === h);
  assert.equal(row("amia-semper").arrives_at, AMIA);
  assert.equal(row("amia-semper").eta_crossings, 0.04, "beside the crossing count, which stays");
  assert.equal("arrives_at" in row("kogane"), false, "standing still arrives nowhere");
  assert.equal("arrives_at" in row("rider"), false, "a rider's remainder is zeroed by the frame; the roll's own instant is no arrival");
  assert.equal("arrives_at" in row("the-post-office"), false, "her eta is the timetable's placeholder 0");
});

// The review's worst case: a true eta of 0.0449 crossings. The receipt, at
// departure, rounds it to 0.04; a read 0.0099 crossings later rounds the
// remaining 0.035 up to 0.04 again, so two rounded answers sat 7.1 minutes
// apart. Walked through the real engine's positionAt at both instants.
test("one leg through both answers: the receipt at departure and read: walk later name the same second", { skip: !HAVE_ENGINE && NO_WORLD }, async () => {
  const engine = await import(pathToFileURL(join(CLONE, "tools", "walk.mjs")).href);
  const pace = 60;
  const dep = { handle: "amia-semper", from: { x: 0, y: 0 }, toward: { x: 2694, y: 0 }, at: 225.44, pace };
  // The receipt: departure crossing, the remainder at departure (world.mjs § walkViaOffice).
  const atDeparture = engine.positionAt(dep, dep.at);
  assert.equal(atDeparture.etaCrossings, 0.04, "the rig is the worst case: 0.0449 rounds down");
  const receipt = arrivesAt(dep.at, atDeparture.remainingM, pace);
  // The read: the roll at a later crossing, through walkerPaces and walkDomain.
  const t = dep.at + 0.0099;
  const p = engine.positionAt(dep, t);
  assert.equal(p.etaCrossings, 0.04, "0.035 rounds up, which is how two rounded answers drift");
  const rows = walkerPaces([{ handle: dep.handle, x: p.x, y: p.y, source: "walk", moving: !p.arrived,
    remaining_m: p.remainingM, eta_crossings: p.etaCrossings }], [dep], engine);
  const { walkers } = walkDomain({ at: t, walkers: rows }, {}, { standpoint: { x: p.x, y: p.y } });
  const read = walkers.walkers[0].arrives_at;
  assert.ok(Math.abs(Date.parse(read) - Date.parse(receipt)) <= 1000, `receipt ${receipt}, read ${read}`);
  // and the instant is the true one: 2,694 m at 60 km a crossing
  assert.equal(receipt, new Date(Math.round(instantOf(225.44 + 2694 / 60000).getTime() / 1000) * 1000).toISOString());
});
