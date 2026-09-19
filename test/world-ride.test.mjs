// world-ride.test.mjs — THE POST OFFICE AS A PORTAL (postmark-town/postmark#2986).
//
//   node --test test/world-ride.test.mjs
//
// Every test carries the VERBATIM ruling it asserts. Keemin ruled this in
// conversation on 2026-09-19 and the brief quotes him in order; a test that
// quoted the brief's paraphrase would guard the paraphrase.
//
// ── WHAT IS REAL HERE AND WHAT IS A FIXTURE ─────────────────────────────────
//
// The world clone is REAL: the fold, `tools/enter-exit.mjs`, `tools/world-verbs.mjs`
// and `tools/vessel.mjs` are the ones this office deploys against, so a drift
// between the two repos reds here rather than in front of a resident.
//
// The CLASS ROWS are a fixture, and they have to be until the world half lands:
// `class: vehicle` does not stand on `the-town/the-post-office` in any checkout
// while this is written (measured against world main 5beca99a — she carries no
// `class:` line at all), and `the-town/vehicle` stands at version 0 with an
// EMPTY roster. So the fixture adds exactly the two things Wright's world PR
// adds and nothing else: the class line on her, and the Snug mooring on the
// wheelhouse's stop list. When the law lands, the fixture becomes the record and
// these tests run against it unchanged.
//
// ⚑ AND THE STOP LIST IS THREE, NOT FIVE. Measured off world main: the
// wheelhouse names `the-town/the-post-office` (her own berth), the Pando landing
// and the Garrison's grove wharf. Vermillion's landing and the brass-otter
// mooring are places residents have WALKED to, which is a different fact.

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  CROSSING_MS, anchorOfStop, arrivedNotice, depositAt, doorstepTransport, hasArrived,
  isVehicleStop, rideMillis, rideOrigin, rideRefusal, rideStateFrom, rideViaOffice,
  stopAnnotationFor, stopUnderfoot, stopsOfService, straightLineM, transportAt,
  vehicleGroundExtras, vesselIdOf,
} from "../src/world-ride.mjs";
import { VEHICLE_CLASS, enterViaOffice, exitViaOffice, groundBlockOf, portalEntryFor } from "../src/world-crossings.mjs";
import { spineWithVehicles } from "../src/world-apex.mjs";
import { vehicleStandpoint, vehicleWithin, worldHasVehicle } from "../src/world-movement.mjs";

const CLONE = process.env.WORLD_CLONE ?? join(process.cwd(), "..", "postmark-world");
const GRAMMAR = ["enter-exit.mjs", "thresholds.mjs"].find((n) => existsSync(join(CLONE, "tools", n)));
const HAVE_CLONE = Boolean(GRAMMAR) && existsSync(join(CLONE, "WORLD", "world-state.json"));

const SHIP = "the-town/the-post-office";
const WHEELHOUSE = "the-town/the-wheelhouse";
const PANDO = "the-town/the-pando-landing";
const WHARF = "sol-of-garrison/grove-wharf";
const SNUG = "current-the-reader/the-snug-mooring";

const key = (...handles) => ({ handles: new Set(handles) });

/** The real fold, plus exactly the two rows the world half plants. */
function vehicleWorld() {
  const raw = JSON.parse(readFileSync(join(CLONE, "WORLD", "world-state.json"), "utf8"));
  const marks = raw.marks.map((m) => {
    if (m.id === SHIP) return { ...m, class: VEHICLE_CLASS };
    if (m.id === WHEELHOUSE) {
      return { ...m, timetable: { ...m.timetable, stops: [...m.timetable.stops, { mark: SNUG, departs: ["06:20Z", "18:20Z"] }] } };
    }
    return m;
  });
  return { ...raw, marks };
}

/** The fold with NO vehicle anywhere — the control every "it is inert" leg needs. */
function plainWorld() {
  return JSON.parse(readFileSync(join(CLONE, "WORLD", "world-state.json"), "utf8"));
}

const markIn = (w, id) => w.marks.find((m) => m.id === id) ?? null;

/**
 * A whole office in a closure — the crossings suite's harness, plus the two
 * reads the portal added: this actor's journal rows, and what a class lends.
 */
async function officeWith({ standing = { x: -1380, y: -2543 }, ledger = "", at = 200, nowMs = Date.UTC(2026, 8, 19, 20, 0, 0), world = null, lends = {} } = {}) {
  const worldState = world ?? vehicleWorld();
  const mod = await import(`file:///${join(CLONE, "tools", GRAMMAR).replace(/\\/g, "/")}`);
  const thresholds = mod.parseEnterExitLedger ? mod : { ...mod, parseEnterExitLedger: mod.parseThresholdLedger };
  let text = ledger;
  let clock = nowMs;
  let where = { ...standing };
  const written = [];
  const journal = [];
  const stops = [];
  const deps = {
    world: async () => worldState,
    ledger: async () => text,
    standpointOf: async (who) => ({ ...where, name: who }),
    within: async (who) => [...(thresholds.occupancyAt(thresholds.parseEnterExitLedger(text).acts, at).get(who) ?? [])],
    acts: async (who) => journal.filter((j) => j.actor === who).map(({ actor, ...rest }) => rest),
    lends: async (id) => lends[id] ?? [],
    now: () => at,
    nowMs: () => clock,
    crossing: () => at,
    walking: async () => null,
    stop: async (who, pt) => { stops.push({ who, ...pt }); where = { x: pt.x, y: pt.y }; return { ok: true }; },
    record: async (entry) => {
      const { handle, act, lines = [], mark = null, via = null, set_down_at = null, arrived = null, action, object, payload } = entry;
      if (action === "ride") {
        journal.push({ actor: handle, action: "ride", object, payload });
        return { seq: journal.length };
      }
      written.push(...lines);
      text += lines.join("\n") + "\n";
      journal.push({ actor: handle, action: act, object: mark,
        payload: { ...(via ? { via } : {}), ...(set_down_at ? { set_down_at } : {}), ...(arrived == null ? {} : { arrived }) } });
      const acts = thresholds.parseEnterExitLedger(text).acts;
      return { lines, within: thresholds.occupancyAt(acts, at).get(handle) ?? [], commit: "deadbeef", pushed: false, seq: journal.length };
    },
  };
  return {
    deps, written, journal, stops, worldState,
    setClock: (ms) => { clock = ms; },
    standAt: (pt) => { where = { ...pt }; },
    within: (who) => [...(thresholds.occupancyAt(thresholds.parseEnterExitLedger(text).acts, at).get(who) ?? [])],
    text: () => text,
  };
}

/** The vessel service, from the clone's own engine over a given fold. */
async function serviceOf(worldState) {
  const vessel = await import(`file:///${join(CLONE, "tools", "vessel.mjs").replace(/\\/g, "/")}`);
  const { services } = vessel.servicesFromFold({ marks: worldState.marks });
  return services.find((s) => s.markId === WHEELHOUSE) ?? services[0] ?? null;
}

// ── the arithmetic, asserted LONGHAND ────────────────────────────────────────

test("the ride's clock is the same half-day the walk ledger is quoted against", { skip: !HAVE_CLONE && "no world clone" }, async () => {
  const walk = await import(`file:///${join(CLONE, "tools", "walk.mjs").replace(/\\/g, "/")}`);
  assert.equal(CROSSING_MS, walk.CROSSING_MS,
    "world-ride.mjs keeps its own copy of the crossing period so it can stay pure; if the clone's ever changes, this is the line that says so");
  assert.equal(CROSSING_MS, 43_200_000);
});

test("arrives_at is the straight line over the timetable's own pace — computed longhand, not by calling the implementation", { skip: !HAVE_CLONE && "no world clone" }, async () => {
  // Keemin, ruling 3: "they can take it to their destination at Post Office
  // speed as if it was going directly there".
  const w = vehicleWorld();
  const service = await serviceOf(w);
  assert.equal(service.pace, 405, "the pace is READ from the wheelhouse — one owner, and this is the number it owns");

  const a = markIn(w, SHIP).at, b = markIn(w, PANDO).at;
  // longhand, so a wrong formula in the module cannot make this agree with it
  const dx = b.x - a.x, dy = b.y - a.y;
  const expectedM = Math.sqrt(dx * dx + dy * dy);
  const expectedMs = (expectedM / (405 * 1000)) * 43_200_000;

  // `Math.hypot` and `sqrt(dx^2+dy^2)` differ in the last bit — which is the
  // point of computing it the other way here rather than calling the module.
  assert.ok(Math.abs(straightLineM(a, b) - expectedM) < 1e-6, `${straightLineM(a, b)} vs ${expectedM}`);
  assert.ok(Math.abs(rideMillis(expectedM, 405) - expectedMs) < 1e-6);
  // and the figure the brief quotes for this leg: ~135 km, ~4 h
  assert.ok(Math.abs(expectedM / 1000 - 133.8) < 0.5, `the Pando leg measures ${(expectedM / 1000).toFixed(1)} km`);
  assert.ok(Math.abs(expectedMs / 3_600_000 - 3.96) < 0.05, `the Pando leg times at ${(expectedMs / 3_600_000).toFixed(2)} h`);
});

test("the brief's SNUG example is wrong and the record is what this asserts", { skip: !HAVE_CLONE && "no world clone" }, async () => {
  // The brief's § 2 says "quay → the Snug mooring ≈ 4.9 km ≈ 9 min". Measured
  // off world main 5beca99a: the Post Office anchors at (-9, 35.5) and the Snug
  // mooring at (-708, 9950), which is 9,939 m — twice the brief's figure, and
  // ~17.7 minutes at pace 405, not 9. This is pinned rather than reported once,
  // because the number in a brief is exactly the kind of thing a later reader
  // takes for the record.
  const w = vehicleWorld();
  const d = straightLineM(markIn(w, SHIP).at, markIn(w, SNUG).at);
  assert.ok(Math.abs(d - 9939) < 2, `the Snug leg measures ${Math.round(d)} m`);
  assert.ok(Math.abs(rideMillis(d, 405) / 60000 - 17.7) < 0.2);
});

// ── the stop set ─────────────────────────────────────────────────────────────

test("the stop set is the timetable's, and it names the vessel's own berth", { skip: !HAVE_CLONE && "no world clone" }, async () => {
  const w = vehicleWorld();
  const service = await serviceOf(w);
  assert.deepEqual(stopsOfService(service).map((s) => s.markId), [SHIP, PANDO, WHARF, SNUG]);
  assert.equal(vesselIdOf(service), SHIP);
  assert.ok(isVehicleStop(WHARF, service));
  assert.ok(isVehicleStop(SHIP, service), "her own berth IS on the published word; what it is not is a destination");
  assert.ok(!isVehicleStop("the-town/the-lochan", service));
});

// ── ENTER: a stop is a door into the vehicle ─────────────────────────────────

test("a stop is a door into the vehicle, and the mark you named is what the reach is measured at", { skip: !HAVE_CLONE && "no world clone" }, async () => {
  // Keemin, ruling 2: "every Post Office stop mark … acts as a Portal into the
  // Post Office, which (as portals do) has different physical rules than usual."
  const o = await officeWith({ standing: { x: -1380, y: -2543 } }); // ON the grove wharf
  const service = await serviceOf(o.worldState);
  const portal = portalEntryFor(WHARF, o.worldState, service);
  assert.deepEqual({ vessel: portal.vessel, stop: portal.stop }, { vessel: SHIP, stop: WHARF });

  const terms = await enterViaOffice(CLONE, { mark: WHARF, handle: "rider" }, key("rider"), o.deps);
  assert.equal(terms.target, SHIP, "you are shown the VESSEL's terms, not the wharf's — that is the portal");
  assert.equal(terms.via, WHARF);
  assert.ok(terms.awaiting, "her entry law declares an `aboard` counter-edge, so the first call is the terms");
  assert.deepEqual(o.written, [], "and nothing reached the pen");

  const went = await enterViaOffice(CLONE, { mark: WHARF, handle: "rider", accept: true }, key("rider"), o.deps);
  assert.deepEqual(went.entered, [SHIP]);
  assert.deepEqual(went.within, [SHIP]);
  assert.equal(went.via, WHARF);
  assert.equal(o.written.length, 1, "ONE enter row — the brief's own words, and the reason the portal crossing does not run the chain");
  assert.match(o.written[0], /rider · enters the-town\/the-post-office/);
});

test("the portal crossing writes ONE row where the geometric chain would have written THREE", { skip: !HAVE_CLONE && "no world clone" }, async () => {
  // The measurement this design rests on. `enterExitPlan` computes the Post
  // Office's chain as town-centre → quay-reach → the-post-office, so running a
  // portal entry through `verbs.enter` would have put a resident standing on the
  // Garrison's wharf inside the town centre, five kilometres from any of it.
  const verbs = await import(`file:///${join(CLONE, "tools", "world-verbs.mjs").replace(/\\/g, "/")}`);
  const w = vehicleWorld();
  const plan = verbs.enterExitPlan({ x: -1380, y: -2543 }, SHIP, w, { occupancy: new Map(), handle: "rider" });
  assert.deepEqual(plan.chain, ["the-town/the-town-centre", "the-town/the-quay-reach", SHIP],
    "if this ever becomes one link on its own, the portal's single-link adjudication can be reconsidered");

  const o = await officeWith();
  await enterViaOffice(CLONE, { mark: WHARF, handle: "rider", accept: true }, key("rider"), o.deps);
  assert.deepEqual(o.within("rider"), [SHIP],
    "a rider is inside HER and nothing else — not the town centre they have never been within 5 km of");
});

test("a door is still entered from within its reach, and the refusal names the STOP", { skip: !HAVE_CLONE && "no world clone" }, async () => {
  const o = await officeWith({ standing: { x: 0, y: 0 } }); // the Origin, nowhere near the wharf
  await assert.rejects(
    () => enterViaOffice(CLONE, { mark: WHARF, handle: "rider", accept: true }, key("rider"), o.deps),
    (e) => e.code === 409 && e.defect.includes(WHARF) && e.walk?.mark === WHARF);
  assert.deepEqual(o.written, [], "nothing was recorded");
});

test("a stop is a door only where the vehicle class stands — the law gates the physics", { skip: !HAVE_CLONE && "no world clone" }, async () => {
  // Against the world as it stands TODAY (no `class: vehicle` anywhere), the
  // portal does not exist and the wharf is an ordinary mark. That is what lets
  // this office ship ahead of the Keeping Works half.
  const plain = plainWorld();
  const service = await serviceOf(plain);
  assert.equal(portalEntryFor(WHARF, plain, service), null);
  assert.equal(worldHasVehicle(plain), false);
  assert.equal(worldHasVehicle(vehicleWorld()), true);
});

test("her own berth is not a portal into herself", { skip: !HAVE_CLONE && "no world clone" }, async () => {
  const w = vehicleWorld();
  const service = await serviceOf(w);
  assert.equal(portalEntryFor(SHIP, w, service), null,
    "entering her while standing on her is the ordinary chain crossing it has always been");
});

// ── the ground block (§ 5) ───────────────────────────────────────────────────

test("a class that LENDS answers its body and its roster at the threshold — terms call and crossing both", { skip: !HAVE_CLONE && "no world clone" }, async () => {
  // Keemin, ruling 10: "some kind of message be given to an agent upon
  // enter-verb into the Post Office (or any Portal for that matter) that
  // concisely explains the 'rules' of that portal space."
  const o = await officeWith({ lends: { [SHIP]: ["ride"] } });
  const terms = await enterViaOffice(CLONE, { mark: WHARF, handle: "rider" }, key("rider"), o.deps);
  assert.equal(terms.ground.class, VEHICLE_CLASS);
  assert.deepEqual(terms.ground.lends, ["ride"]);
  assert.ok(terms.ground.rules, "`rules` IS the class mark's own body — edit the law and the door follows");
  assert.equal(terms.ground.your_origin, null, "nobody has entered yet, so there is no origin to measure from");
  assert.ok(terms.ground.stops.some((s) => s.mark === PANDO && s.ride_minutes === null),
    "with no origin the minutes are null rather than invented");

  const went = await enterViaOffice(CLONE, { mark: WHARF, handle: "rider", accept: true }, key("rider"), o.deps);
  assert.equal(went.ground.class, VEHICLE_CLASS, "the block rides the ACCEPTING call too, not only the terms");
  assert.deepEqual(went.ground.lends, ["ride"]);
});

test("the ground block is general: no roster, no block — and it is ABSENT rather than empty", () => {
  assert.equal(groundBlockOf({ classMark: { class: "parcel", body: "a parcel" }, lends: [] }), null);
  assert.equal(groundBlockOf({ classMark: null, lends: ["ride"] }), null);
  const b = groundBlockOf({ classMark: { class: "arena", body: "a ring" }, lends: ["strike", "strike", "guard"] });
  assert.deepEqual(b.lends, ["strike", "guard"], "one entry per verb, whatever the roster's shape");
  assert.equal(b.class, "arena");
});

// ── RIDE ─────────────────────────────────────────────────────────────────────

test("ride names a destination from aboard, and writes ONE journal act with the brief's payload", { skip: !HAVE_CLONE && "no world clone" }, async () => {
  // Keemin, ruling 7: "have the journal write the act as 'ride' not 'board'".
  const o = await officeWith();
  await enterViaOffice(CLONE, { mark: WHARF, handle: "rider", accept: true }, key("rider"), o.deps);
  const r = await rideViaOffice(CLONE, { to: PANDO, handle: "rider" }, key("rider"), o.deps);

  const w = o.worldState;
  const dx = markIn(w, PANDO).at.x - markIn(w, WHARF).at.x;
  const dy = markIn(w, PANDO).at.y - markIn(w, WHARF).at.y;
  const expectedM = Math.round(Math.sqrt(dx * dx + dy * dy));
  assert.equal(r.ride.origin, WHARF, "measured from the door you came in by, not from the hull");
  assert.equal(r.ride.to, PANDO);
  assert.equal(r.ride.distance_m, expectedM);
  assert.equal(r.ride.pace_km_per_crossing, 405);
  // THE ROW MUST BE RE-DERIVABLE FROM ITS OWN PUBLISHED INPUTS. This is the
  // assertion that caught the 24 ms disagreement: the timer had been computed
  // from the unrounded line while `distance_m` published the rounded one, so a
  // reader recomputing the arrival from the row got a different instant than the
  // row carried.
  assert.equal(Date.parse(r.ride.arrives_at) - Date.parse(r.ride.declared_at),
    Math.round((r.ride.distance_m / (r.ride.pace_km_per_crossing * 1000)) * 43_200_000),
    "arrives_at must be exactly what the row's own distance and pace say it is");

  const rides = o.journal.filter((j) => j.action === "ride");
  assert.equal(rides.length, 1);
  assert.equal(rides[0].object, SHIP, "the act is performed ON the vehicle; the destination rides the payload");
  assert.deepEqual(Object.keys(rides[0].payload).sort(),
    ["arrives_at", "declared_at", "distance_m", "origin", "pace_km_per_crossing", "to"],
    "exactly the six fields the brief names — the summary sentence rides `effect`, the column the log already keeps one in");
});

test("ride off a vehicle's ground is refused, and the refusal names the class", { skip: !HAVE_CLONE && "no world clone" }, async () => {
  const o = await officeWith();
  await assert.rejects(
    () => rideViaOffice(CLONE, { to: PANDO, handle: "rider" }, key("rider"), o.deps),
    (e) => e.code === 422 && /not aboard/.test(e.defect) && e.hint.includes(WHARF));
});

test("the three refusals a destination can earn, each its own sentence", { skip: !HAVE_CLONE && "no world clone" }, async () => {
  const service = await serviceOf(vehicleWorld());
  assert.match(rideRefusal({ to: "", service }).defect, /ride where/);
  assert.match(rideRefusal({ to: "the-town/the-lochan", service }).defect, /not a stop/);
  assert.match(rideRefusal({ to: SHIP, service }).defect, /the vehicle you are standing in/);
  assert.match(rideRefusal({ to: PANDO, origin: PANDO, service }).defect, /already bound from/);
  assert.equal(rideRefusal({ to: PANDO, origin: WHARF, service }), null);
});

// ── THE ORIGIN RULE (ruling 9) ───────────────────────────────────────────────

test("a re-ride BEFORE arrival measures from the entry stop, and the time already spent is gone", () => {
  // Keemin, ruling 9, verbatim: "if a resident … redeclares a different
  // destination while on board, the Post Office computes the new time from their
  // initial entry stop if they haven't 'arrived' yet".
  const t0 = Date.UTC(2026, 8, 19, 20, 0, 0);
  const standing = { to: PANDO, origin: WHARF, arrives_at: new Date(t0 + 4 * 3600_000).toISOString() };
  const o = rideOrigin({ entryStop: WHARF, standingRide: standing, nowMs: t0 + 3.9 * 3600_000 });
  assert.deepEqual(o, { stop: WHARF, because: "entry" },
    "3.9 hours in and a minute from arriving, the origin is STILL the wharf — there are no intermediate points in a lobby");
});

test("a re-ride AFTER arrival measures from where the ride landed you", () => {
  // "…and from their exit stop if they have."
  const t0 = Date.UTC(2026, 8, 19, 20, 0, 0);
  const standing = { to: PANDO, origin: WHARF, arrives_at: new Date(t0).toISOString() };
  assert.deepEqual(rideOrigin({ entryStop: WHARF, standingRide: standing, nowMs: t0 }), { stop: PANDO, because: "arrived" },
    "at the exact instant it comes due, it has come due — `now >= arrives_at`");
  assert.deepEqual(rideOrigin({ entryStop: WHARF, standingRide: standing, nowMs: t0 - 1 }), { stop: WHARF, because: "entry" });
});

test("the origin rule end to end: the second ride's distance changes only after the first has come due", { skip: !HAVE_CLONE && "no world clone" }, async () => {
  const o = await officeWith();
  await enterViaOffice(CLONE, { mark: WHARF, handle: "rider", accept: true }, key("rider"), o.deps);
  const first = await rideViaOffice(CLONE, { to: PANDO, handle: "rider" }, key("rider"), o.deps);

  // before it comes due
  o.setClock(Date.parse(first.ride.arrives_at) - 1000);
  const early = await rideViaOffice(CLONE, { to: SNUG, handle: "rider" }, key("rider"), o.deps);
  assert.equal(early.ride.origin, WHARF);
  assert.equal(early.origin_because, "entry");
  assert.ok(early.replaced, "the latest ride wins, and the answer says what it replaced");

  // after THAT one comes due
  o.setClock(Date.parse(early.ride.arrives_at) + 1000);
  const late = await rideViaOffice(CLONE, { to: PANDO, handle: "rider" }, key("rider"), o.deps);
  assert.equal(late.ride.origin, SNUG, "you are at the Snug's door now, you simply have not stepped through it");
  assert.equal(late.origin_because, "arrived");
  assert.notEqual(late.ride.distance_m, first.ride.distance_m,
    "and the distance is genuinely a different leg — a test that only read `origin` would pass on a cosmetic change");
});

// ── EXIT: the deposit rule ───────────────────────────────────────────────────

test("exit BEFORE the timer sets you down at the stop you came in through", { skip: !HAVE_CLONE && "no world clone" }, async () => {
  // Keemin, ruling 8: "If the resident tries to exit before, they simply exit to
  // the stop they were at when they boarded."
  const o = await officeWith();
  await enterViaOffice(CLONE, { mark: WHARF, handle: "rider", accept: true }, key("rider"), o.deps);
  const r = await rideViaOffice(CLONE, { to: PANDO, handle: "rider" }, key("rider"), o.deps);
  o.setClock(Date.parse(r.ride.arrives_at) - 60_000);

  const out = await exitViaOffice(CLONE, { mark: SHIP, handle: "rider" }, key("rider"), o.deps);
  assert.equal(out.set_down.at, WHARF);
  assert.equal(out.set_down.arrived, false);
  assert.ok(out.ride_abandoned, "and the answer says the ride was not wasted so much as not waited for");
  assert.deepEqual(o.within("rider"), []);

  const anchor = anchorOfStop(WHARF, await serviceOf(o.worldState));
  assert.deepEqual(o.stops.at(-1), { who: "rider", x: anchor.x, y: anchor.y },
    "the deposit is a ZERO-LENGTH DEPARTURE through the walk act — never a second pen");
});

test("exit AT OR AFTER the timer sets you down at the destination", { skip: !HAVE_CLONE && "no world clone" }, async () => {
  const o = await officeWith();
  await enterViaOffice(CLONE, { mark: WHARF, handle: "rider", accept: true }, key("rider"), o.deps);
  const r = await rideViaOffice(CLONE, { to: SNUG, handle: "rider" }, key("rider"), o.deps);
  o.setClock(Date.parse(r.ride.arrives_at));

  const out = await exitViaOffice(CLONE, { mark: SHIP, handle: "rider" }, key("rider"), o.deps);
  assert.equal(out.set_down.at, SNUG);
  assert.equal(out.set_down.arrived, true);
  const anchor = anchorOfStop(SNUG, await serviceOf(o.worldState));
  assert.deepEqual({ x: o.stops.at(-1).x, y: o.stops.at(-1).y }, { x: anchor.x, y: anchor.y },
    "the deposit point is the stop mark's own anchor — you stand ON the mooring");
});

test("the exit's journal row carries set_down_at and arrived as FIELDS", { skip: !HAVE_CLONE && "no world clone" }, async () => {
  const o = await officeWith();
  await enterViaOffice(CLONE, { mark: WHARF, handle: "rider", accept: true }, key("rider"), o.deps);
  const r = await rideViaOffice(CLONE, { to: SNUG, handle: "rider" }, key("rider"), o.deps);
  o.setClock(Date.parse(r.ride.arrives_at));
  await exitViaOffice(CLONE, { mark: SHIP, handle: "rider" }, key("rider"), o.deps);
  const row = o.journal.filter((j) => j.action === "exit").at(-1);
  assert.equal(row.object, SHIP);
  assert.deepEqual(row.payload, { set_down_at: SNUG, arrived: true });
});

test("exiting with no ride and no `via` writes NO deposit — the crossing made before the portal existed still reads", { skip: !HAVE_CLONE && "no world clone" }, async () => {
  // A resident who boarded the old way (standing on her at the quay) carries no
  // entry stop, so the deposit rule declines to move them rather than setting
  // them down somewhere they cannot prove they came from.
  const mod = await import(`file:///${join(CLONE, "tools", GRAMMAR).replace(/\\/g, "/")}`);
  const line = mod.formatEnterExit({ handle: "oldhand", act: "enters", mark: SHIP, at: 199, word: "welcomed" });
  const o = await officeWith({ ledger: `${line}\n` });
  const out = await exitViaOffice(CLONE, { mark: SHIP, handle: "oldhand" }, key("oldhand"), o.deps);
  assert.equal(out.set_down, undefined);
  assert.deepEqual(o.stops, [], "no departure was written for them at all");
});

test("the deposit rule, pure and both ways", () => {
  const t0 = Date.UTC(2026, 8, 19, 20, 0, 0);
  const ride = { to: PANDO, origin: WHARF, arrives_at: new Date(t0).toISOString() };
  assert.deepEqual(depositAt({ entryStop: WHARF, standingRide: ride, nowMs: t0 }), { stop: PANDO, arrived: true });
  assert.deepEqual(depositAt({ entryStop: WHARF, standingRide: ride, nowMs: t0 - 1 }), { stop: WHARF, arrived: false });
  assert.deepEqual(depositAt({ entryStop: WHARF, standingRide: null, nowMs: t0 }), { stop: WHARF, arrived: false });
  assert.deepEqual(depositAt({ entryStop: null, standingRide: null, nowMs: t0 }), { stop: null, arrived: false });
});

// ── POSITION ABOARD ──────────────────────────────────────────────────────────

test("a rider's standpoint is the HULL's, and it tracks her along her ring — never the destination", { skip: !HAVE_CLONE && "no world clone" }, async () => {
  // Keemin, ruling 3 + ruling 6: "wherever a resident boards … as if it was going
  // directly there" and "we need the residents sitting still in a Post Office
  // interior". Both mean: no interpolation toward the destination.
  const w = vehicleWorld();
  const vessel = await import(`file:///${join(CLONE, "tools", "vessel.mjs").replace(/\\/g, "/")}`);
  const walkMod = await import(`file:///${join(CLONE, "tools", "walk.mjs").replace(/\\/g, "/")}`);
  const service = await serviceOf(w);

  // ⚑ "NEVER AT THE DESTINATION" IS THE WRONG PROBE, and the first run of this
  // file proved it: the Pando landing IS one of her berths, so at 12:00Z a rider
  // bound for Pando is standing exactly on Pando — legitimately, because her
  // hull is there. The property that actually distinguishes interpolation from
  // no-interpolation is the test below: the standpoint does not depend on the
  // ride at all.
  const seen = new Set();
  let moved = 0;
  // A whole day of her ring, sampled — she is a derived body, so this drives her
  // along a real path rather than asserting one point.
  for (let i = 0; i <= 24; i++) {
    const atMs = Date.UTC(2026, 8, 19, 0, 0, 0) + i * 3600_000;
    const hull = vessel.vesselPositionAt(service, walkMod.fractionalCrossing(atMs));
    const stand = await vehicleStandpoint("rider", w, { repo: CLONE, atMs, stack: [SHIP] });
    assert.ok(stand, "occupancy says aboard, so there is a standpoint");
    assert.equal(stand.x, hull.x);
    assert.equal(stand.y, hull.y);
    assert.equal(stand.aboard, true);
    assert.equal(stand.moving, false, "the rider sits still; the HULL is what may be under way");
    assert.equal(stand.frame, SHIP);
    const k = `${stand.x},${stand.y}`;
    if (!seen.has(k)) { seen.add(k); moved++; }
  }
  assert.ok(moved > 1, `the hull actually moved across the samples (${moved} distinct points) — a frozen boat would make every assertion above vacuous`);
});

test("the standpoint does not depend on the ride — the one property interpolation would break", { skip: !HAVE_CLONE && "no world clone" }, async () => {
  // This is the discriminating assertion for "no interpolation toward the
  // destination". A position that leaned on the ride would differ between a
  // rider bound for Pando, a rider bound for the Snug, and a rider bound
  // nowhere; a position that is the hull's cannot.
  const w = vehicleWorld();
  const t0 = Date.UTC(2026, 8, 19, 20, 0, 0);
  const pts = [];
  for (let i = 0; i <= 8; i++) {
    const atMs = t0 + i * 1800_000;
    const stand = await vehicleStandpoint("rider", w, { repo: CLONE, atMs, stack: [SHIP] });
    pts.push({ atMs, x: stand.x, y: stand.y });
  }
  assert.ok(new Set(pts.map((p) => `${p.x},${p.y}`)).size > 1,
    "the hull moved across these samples, so a drifting rider would have been visible");
  // `vehicleStandpoint` takes no ride and cannot: there is no argument by which
  // a destination could reach it. Asserted as a fact about the signature so a
  // future hand cannot quietly add one.
  assert.equal(vehicleStandpoint.length, 2, "vehicleStandpoint(handle, worldState, opts) — a third positional would be a destination sneaking in");
  const opts = { repo: CLONE, atMs: t0, stack: [SHIP] };
  const a = await vehicleStandpoint("rider", w, opts);
  const b = await vehicleStandpoint("rider", w, { ...opts, ride: { to: PANDO, arrives_at: new Date(t0 + 1).toISOString() } });
  assert.deepEqual({ x: b.x, y: b.y }, { x: a.x, y: a.y },
    "handing it a ride changes nothing, because nothing reads one");
});

test("the vehicle a stack puts you in is the innermost one, and an ordinary stack puts you in none", { skip: !HAVE_CLONE && "no world clone" }, async () => {
  const w = vehicleWorld();
  assert.equal(vehicleWithin([SHIP], w), SHIP);
  assert.equal(vehicleWithin(["the-town/the-town-centre", "the-town/the-quay-reach"], w), null);
  assert.equal(vehicleWithin([], w), null);
  assert.equal(vehicleWithin([SHIP], plainWorld()), null, "no class line, no vehicle — the law gates the physics");
});

test("the grant spine gains vehicles ONLY — a non-vehicle occupancy adds nothing", () => {
  const classOf = (id) => (id === SHIP ? VEHICLE_CLASS : "parcel");
  assert.deepEqual(spineWithVehicles(["the-town/the-quay-reach"], [SHIP], classOf),
    ["the-town/the-quay-reach", SHIP]);
  assert.deepEqual(spineWithVehicles(["the-town/the-quay-reach"], ["rei/the-looking-room"], classOf),
    ["the-town/the-quay-reach"],
    "DEC-5 already makes occupancy a subset of geometry for an ordinary mark; a stale row must not hand anybody a ground's verbs");
  assert.deepEqual(spineWithVehicles([SHIP], [SHIP], classOf), [SHIP], "and it never duplicates");
});

// ── THE ARRIVED NOTICE (§ 6) ─────────────────────────────────────────────────

test("the arrived notice is present exactly when now >= arrives_at, and absent once the ride is gone", () => {
  // Keemin, ruling 9: "We should also have an 'arrived' notification waiting for
  // residents." Derived: a replay at the same instant says the same thing.
  const t0 = Date.UTC(2026, 8, 19, 20, 0, 0);
  const ride = { to: SNUG, origin: WHARF, arrives_at: new Date(t0).toISOString() };
  assert.equal(arrivedNotice(ride, t0 - 1), null);
  const n = arrivedNotice(ride, t0);
  assert.equal(n.at, SNUG);
  assert.equal(n.since, ride.arrives_at);
  assert.match(n.note, /exit sets you down there/);
  assert.equal(arrivedNotice(ride, t0 + 86_400_000).note, n.note, "a replay far later says the same thing — nothing is marked read");
  assert.equal(arrivedNotice(null, t0), null, "and an exit ends it by ending the ride");
  assert.equal(hasArrived(ride, t0), true);
  assert.equal(hasArrived({ to: SNUG }, t0), false, "a ride with no arrives_at has not arrived; it is not an error");
});

test("the arrived notice ends when the exit does — the fold, end to end", { skip: !HAVE_CLONE && "no world clone" }, async () => {
  const o = await officeWith();
  await enterViaOffice(CLONE, { mark: WHARF, handle: "rider", accept: true }, key("rider"), o.deps);
  const r = await rideViaOffice(CLONE, { to: SNUG, handle: "rider" }, key("rider"), o.deps);
  const after = Date.parse(r.ride.arrives_at) + 1;

  let state = rideStateFrom(await o.deps.acts("rider"), { vesselId: SHIP });
  assert.ok(arrivedNotice(state.standingRide, after));

  o.setClock(after);
  await exitViaOffice(CLONE, { mark: SHIP, handle: "rider" }, key("rider"), o.deps);
  state = rideStateFrom(await o.deps.acts("rider"), { vesselId: SHIP });
  assert.equal(state.standingRide, null);
  assert.equal(state.entryStop, null);
  assert.equal(arrivedNotice(state.standingRide, after), null);
});

test("the ride fold: enter sets the door, ride replaces, exit clears — and other vessels are not this one", () => {
  const acts = [
    { action: "enter", object: SHIP, payload: { via: WHARF } },
    { action: "ride", object: SHIP, payload: { to: PANDO, origin: WHARF, arrives_at: "2026-09-19T22:00:00.000Z" } },
    { action: "ride", object: "the-town/some-other-cart", payload: { to: "elsewhere", origin: "x" } },
    { action: "ride", object: SHIP, payload: { to: SNUG, origin: WHARF, arrives_at: "2026-09-19T21:00:00.000Z" } },
  ];
  const s = rideStateFrom(acts, { vesselId: SHIP });
  assert.equal(s.entryStop, WHARF);
  assert.equal(s.standingRide.to, SNUG, "latest ride wins");
  const after = rideStateFrom([...acts, { action: "exit", object: SHIP, payload: {} }], { vesselId: SHIP });
  assert.deepEqual(after, { entryStop: null, standingRide: null });
});

// ── VISIBILITY (§ 11) ────────────────────────────────────────────────────────

test("a resident standing at a wharf is TOLD what the wharf is for", { skip: !HAVE_CLONE && "no world clone" }, async () => {
  const w = vehicleWorld();
  const service = await serviceOf(w);
  const t = transportAt(WHARF, service, w);
  assert.match(t.line, /the-town\/the-post-office calls here/);
  assert.match(t.line, /enter sol-of-garrison\/grove-wharf to board her/);
  assert.ok(t.ride_to.some((r) => r.mark === PANDO && r.ride_minutes > 0));
  assert.ok(!t.ride_to.some((r) => r.mark === SHIP), "her own berth is not somewhere to ride to");
  assert.equal(transportAt("the-town/the-lochan", service, w), null, "and away from a stop there is no line at all");
  assert.equal(transportAt(WHARF, service, plainWorld()), null, "nor in a world whose law has not planted the class");
});

test("the transport line is offered at the ENTER door's reach, not the stop-answers' 25 m", { skip: !HAVE_CLONE && "no world clone" }, async () => {
  const w = vehicleWorld();
  const service = await serviceOf(w);
  const anchor = markIn(w, WHARF).at;
  assert.equal(stopUnderfoot({ x: anchor.x, y: anchor.y }, service, w), WHARF);
  assert.equal(stopUnderfoot({ x: anchor.x + 40, y: anchor.y }, service, w), WHARF,
    "40 m out the enter door would admit them, so the sentence has to reach them too");
  assert.equal(stopUnderfoot({ x: anchor.x + 500, y: anchor.y }, service, w), null);
  // ⚑ `stopUnderfoot` makes NO class promise — it answers "which stop are you
  // standing at", and a stop is a stop whatever the Keeping Works says. The
  // vehicle gate lives one level up, in `transportAt`, which is where a caller
  // asks "is there anything to tell them". Asserted so the division stays
  // deliberate rather than becoming a hole somebody plugs in the wrong file.
  assert.equal(stopUnderfoot({ x: anchor.x, y: anchor.y }, service, plainWorld()), WHARF);
  assert.equal(transportAt(WHARF, service, plainWorld()), null, "and the gate is HERE");
});

test("the doorstep's standing line names her, her stops, and the nearest one to you", { skip: !HAVE_CLONE && "no world clone" }, async () => {
  const w = vehicleWorld();
  const service = await serviceOf(w);
  const d = doorstepTransport(service, { x: -1380, y: -2500 }, w);
  assert.equal(d.vehicle, SHIP);
  assert.equal(d.stops, 3, "her own berth is not a place she 'stops at' for this sentence");
  assert.equal(d.nearest.mark, WHARF);
  assert.match(d.line, /Enter a stop to board/);
  assert.equal(doorstepTransport(service, null, w).nearest, undefined, "with no standpoint there is no nearest, and none is invented");
  assert.equal(doorstepTransport(service, { x: 0, y: 0 }, plainWorld()), null);
});

test("a stop mark's card carries a derived annotation, and nothing is written on the resident's mooring", { skip: !HAVE_CLONE && "no world clone" }, async () => {
  const w = vehicleWorld();
  const service = await serviceOf(w);
  assert.match(stopAnnotationFor(SNUG, service, w), /a the-town\/the-post-office stop/);
  assert.equal(stopAnnotationFor(SHIP, service, w), null);
  assert.equal(stopAnnotationFor("the-town/the-lochan", service, w), null);
  assert.equal(markIn(w, SNUG).transport, undefined, "the mark itself carries nothing — the sentence is derived at the read");
});

test("the ground block's vehicle extras name the stops with the minutes from YOUR origin", { skip: !HAVE_CLONE && "no world clone" }, async () => {
  const w = vehicleWorld();
  const service = await serviceOf(w);
  const fromWharf = vehicleGroundExtras({ service, entryStop: WHARF });
  const fromSnug = vehicleGroundExtras({ service, entryStop: SNUG });
  assert.equal(fromWharf.your_origin, WHARF);
  assert.equal(fromSnug.your_origin, SNUG);
  const a = fromWharf.stops.find((s) => s.mark === PANDO).ride_minutes;
  const b = fromSnug.stops.find((s) => s.mark === PANDO).ride_minutes;
  assert.notEqual(a, b, "the minutes are measured from where YOU are, not from her berth");
  assert.equal(fromWharf.standing_ride, null);
});

// ── ZERO CHANGE TO WALKS (§ 8 item 4) ────────────────────────────────────────

test("the movements table's schema is untouched — column for column", async () => {
  // Ruling 6 in the schema: "a ride is not a movement row". The falsifier is the
  // DDL itself rather than an argument about it.
  const src = readFileSync(new URL("../src/dynamic-store.mjs", import.meta.url), "utf8");
  const block = src.slice(src.indexOf("CREATE TABLE IF NOT EXISTS movements"));
  const ddl = block.slice(0, block.indexOf(");") + 2);
  assert.ok(ddl.length > 50, "the movements DDL could not be located — this check must be re-aimed, not deleted");
  for (const col of ["actor", "at", "from_x", "from_y", "toward_x", "toward_y", "crossing",
                     "within_w", "within_h", "to_mark", "pace", "declared_by", "note"])
    assert.ok(new RegExp(`\\b${col}\\b`).test(ddl), `movements lost its ${col} column`);
  assert.ok(!/ride|vehicle|arrives_at|via\b/.test(ddl),
    "a ride reached the movements table — it is a journal act and it has no line, no pace of its own and no interpolation");
});

test("no ride row was ever written as a movement", { skip: !HAVE_CLONE && "no world clone" }, async () => {
  const o = await officeWith();
  await enterViaOffice(CLONE, { mark: WHARF, handle: "rider", accept: true }, key("rider"), o.deps);
  await rideViaOffice(CLONE, { to: PANDO, handle: "rider" }, key("rider"), o.deps);
  assert.deepEqual(o.stops, [], "declaring a destination moves nobody and writes no departure");
  assert.equal(o.journal.filter((j) => j.action === "ride").length, 1);
});
