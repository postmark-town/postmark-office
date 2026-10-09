// ride-bounce-names-the-stops.test.mjs — a ride asked off the boat names the
// timetable's stops, nearest first, and never the vehicle class
// (POS-379, postmark-town/postmark#3181 items 1 and 2).
//
// ── THE SIGHTING ────────────────────────────────────────────────────────────
//
// Mari, 09-26, from her parcel: `ride` bounced "It is afforded at
// the-town/vehicle (null, null) — walk there and it appears". The vehicle class
// is de-sited, so there is nowhere to walk to, and walking at it bounces too.
// Boarding cost her 25 minutes of probing. The read's bounce had the same
// fault: `read: "ride"` ashore said "ride" stands at the-town/vehicle.
//
// ── THE RIG ─────────────────────────────────────────────────────────────────
//
// The real world clone, hydrated to rows and published as the world graph
// snapshot (the law, the vessel, her timetable), and a record holding no
// passages, so nobody is aboard. kogane stands where the clone puts her, on
// open ground. Nothing on the read path is stubbed above the record.
//
// Run: WORLD_CLONE=<a world checkout> node --test test/ride-bounce-names-the-stops.test.mjs

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { NO_WORLD, OFFICE_ROOT, worldClone } from "./fixture-paths.mjs";
import { publishWorld } from "./helpers/world-rows.mjs";

const CLONE = worldClone();
const HAVE_CLONE = Boolean(CLONE) && existsSync(join(CLONE, "WORLD", "world-state.json")) && existsSync(join(CLONE, "tools", "vessel.mjs"));
const WHY_NOT = CLONE ? `the world clone at ${CLONE} is missing world-state.json or tools/vessel.mjs` : NO_WORLD;

const ENV = { WORLD_APEX: "1", WORLD2_PG: "1", WORLD2_PG_URL: "postgres://ride-bounce-names-the-stops/none" };
const saved = Object.fromEntries(Object.keys(ENV).map((k) => [k, process.env[k]]));
for (const [k, v] of Object.entries(ENV)) process.env[k] = v;

const { worldApex } = await import("../src/world-apex.mjs");
const { __setPoolForTest } = await import("../src/world2-acts.mjs");
const { __forgetPassages } = await import("../src/enter-exit-ledger.mjs");
const { vesselServiceFrom } = await import("../src/world-movement.mjs");
const { portalEntryFor } = await import("../src/world-crossings.mjs");
const { stopsOfService, vesselIdOf } = await import("../src/world-ride.mjs");

const WHO = "kogane";
const KEY = { handles: new Set([WHO]) };
let dir, worldState, service;

before(async () => {
  if (!HAVE_CLONE) return;
  dir = mkdtempSync(join(tmpdir(), "ride-bounce-"));
  execFileSync(process.execPath, [join(OFFICE_ROOT, "src", "world-hydrate.mjs"),
    "--world", CLONE, "--no-db", "--rows-out", join(dir, "rows.json"), "--no-gexf", "--no-lints"],
  { stdio: "ignore", env: { ...process.env, TMP: dir, TEMP: dir, TMPDIR: dir } });
  publishWorld(join(dir, "rows.json"), "the world clone's head");
  // A record with no passages: nobody is inside anything (recordOf's shape,
  // ride-read-names-the-rider.test.mjs). Anything else it is asked throws.
  __forgetPassages();
  __setPoolForTest({ async query(sql) {
    const text = String(sql).replace(/\s+/g, " ");
    if (/max\(id\) AS hw, count\(\*\) AS n FROM acts/.test(text)) return { rows: [{ hw: null, n: "0" }] };
    if (/SELECT id, at, crossing, actor, action, payload FROM acts/.test(text)) return { rows: [] };
    throw new Error(`the record was asked something it does not answer: ${text.slice(0, 160)}`);
  } });
  worldState = JSON.parse(readFileSync(join(CLONE, "WORLD", "world-state.json"), "utf8"));
  ({ service } = await vesselServiceFrom(worldState, { repo: CLONE }));
});

after(() => {
  __setPoolForTest(null); __forgetPassages();
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

/** What a bounce says out loud: its defect and its hint. */
const said = (r) => `${r.defect ?? ""}\n${r.hint ?? ""}`;

/** The stops the bounce names, the way it must: every one of them, each a door in. */
function assertNamesTheStops(r) {
  const stops = stopsOfService(service).map((s) => s.markId);
  assert.ok(stops.length, "the rig needs a timetable with stops");
  assert.deepEqual(r.ride_doors.map((d) => d.mark).sort(), [...stops].sort(), "every stop on her timetable, and only those");
  assert.ok(r.ride_doors.some((d) => d.mark === vesselIdOf(service)), "the boat's own mooring is among them");
  // Each accepts `enter`: the vessel herself is the ordinary crossing, and every
  // other stop is a portal into her (world-crossings.mjs § portalEntryFor).
  for (const d of r.ride_doors)
    assert.ok(d.mark === vesselIdOf(service) || portalEntryFor(d.mark, worldState, service), `${d.mark} is not a door enter would take`);
  // Nearest first, measured from where she stands.
  const ds = r.ride_doors.map((d) => d.distance_m);
  assert.ok(ds.every(Number.isFinite), `every door carries its distance: ${JSON.stringify(ds)}`);
  assert.deepEqual(ds, [...ds].sort((a, b) => a - b), "nearest first");
  const order = r.ride_doors.map((d) => said(r).indexOf(d.mark));
  assert.ok(order.every((i) => i >= 0), "the hint names every door");
  assert.deepEqual(order, [...order].sort((a, b) => a - b), "and in that order");
  // `affordable_at` keeps its shape ({ mark, class, at }) and names the same
  // doors in the same order: never the class at (null, null).
  assert.deepEqual(r.affordable_at.map((e) => e.mark), r.ride_doors.map((d) => d.mark), "affordable_at is the doors, nearest first");
  for (const e of r.affordable_at) {
    assert.deepEqual(Object.keys(e).sort(), ["at", "class", "mark"], `${e.mark}: the field's entry shape`);
    assert.ok(Number.isFinite(e.at?.x) && Number.isFinite(e.at?.y), `${e.mark} stands somewhere: ${JSON.stringify(e.at)}`);
  }
  // Never the class, and never the promise that cannot be kept.
  assert.doesNotMatch(JSON.stringify(r), /the-town\/vehicle/, "nowhere in the answer, the field included");
  assert.doesNotMatch(said(r), /the-town\/vehicle/);
  assert.doesNotMatch(said(r), /walk there and it appears/);
  assert.doesNotMatch(said(r), /null, null/);
}

test("do: ride from open ground names the stops nearest first, never the vehicle class", { skip: !HAVE_CLONE && WHY_NOT }, async () => {
  const r = await worldApex({ do: "ride", handle: WHO }, KEY);
  assert.equal(r.code, 422, JSON.stringify(r).slice(0, 300));
  assert.match(r.defect, /not aboard/);
  assertNamesTheStops(r);
  assert.match(r.hint, /do: "enter"/, "the way in is named as the act it is");
  assert.ok(Array.isArray(r.affordable_here) && r.affordable_here.includes("enter"), "and enter is open from where she stands");
});

test("read: ride from open ground answers the same doors", { skip: !HAVE_CLONE && WHY_NOT }, async () => {
  const r = await worldApex({ read: "ride", handle: WHO }, KEY);
  assert.equal(r.code, 422, JSON.stringify(r).slice(0, 300));
  assert.match(r.defect, /not aboard/);
  assertNamesTheStops(r);
});
