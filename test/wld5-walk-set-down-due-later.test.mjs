// wld5-walk-set-down-due-later.test.mjs — the walk door's `__at`: a set-down
// written now for an instant still to come (WLD-5).
//
// A portal entered by a walk's enter_on_arrival sets its walker down at the
// landing WHEN THE WALK ARRIVES (test/wld5-walk-enter-landing.test.mjs drives
// that composition on the real clone). The crossing deps' `stop` carries the
// arrival crossing as `__at`, and the door then dates the set-down there: the
// act's crossing and its written instant, which is what the record's reads cut
// on (world-movement.mjs § storedDepartures) and what the projection holds back
// (position-projection.mjs § record). This file drives the real door against a
// synthetic git-backed world, test/pos-165-walk-to-a-stop.test.mjs's bottle.
//
//   node --test test/wld5-walk-set-down-due-later.test.mjs

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

const repo = mkdtempSync(join(tmpdir(), "wld5-due-later-world-"));
const pool = mkdtempSync(join(tmpdir(), "wld5-due-later-pool-"));
after(() => rmSync(repo, { recursive: true, force: true }));
after(() => rmSync(pool, { recursive: true, force: true }));

const git = (...args) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const put = (path, text) => { const full = join(repo, path); mkdirSync(dirname(full), { recursive: true }); writeFileSync(full, text); };

// ── the world in a bottle (pos-165's, without the timetable) ────────────────
const NOW_CROSSING = 100.5;
put("WORLD/marks/let-there-be-light/mark.md",
  "---\nkind: sited\nby: the-town\ntier: market\ndate: 2026-09-21\nat: { x: 0, y: 0 }\nextent: { w: 4, h: 4 }\n---\n\nthe public frame\n");
put("WORLD/skeleton.json", JSON.stringify({ features: [], physics_registry: {} }));
put("WORLD/world-state.json", JSON.stringify({ tick: 0, dials: {}, parcels: [], determined: {}, vague: [], rivalries: [],
  portfolios: {}, terrain_weight: {}, errors: [], marks: [] }));
put("seeding/manifest.json", JSON.stringify({ homes: [] }));
put("tools/mark-lint.mjs", "process.exit(0);\n");
put("tools/world-build.mjs", "export function assembleWorld({ worldState, skeleton }) { return { ...worldState, skeleton }; }\n");
put("tools/world-verbs.mjs", `
export function orient(_state, world) { return { seen: world.marks.map((m) => m.id) }; }
export function openYourEyes() { return { fov: { carried: [], far: [], counts: {} }, radial: { byBearing: {}, counts: {} }, tell: () => "" }; }
export function investigate(id, world) { return world.marks.find((m) => m.id === id) ?? null; }
`);
put("tools/where-is.mjs", `
export const NOWHERE = Object.freeze({ x: null, y: null, placed: false, source: null, mark_id: null });
export function householdOf(handle) { return handle; }
export function parcelFor() { return null; }
export function homeOf() { return { ...NOWHERE }; }
export function whereIs() { return { ...NOWHERE }; }
`);
put("tools/walk.mjs", `
export function fractionalCrossing() { return ${NOW_CROSSING}; }
export function formatDeparture({ handle, from, toward, at }) {
  return \`- 2026-09-21T00:00:00.000Z · \${handle} · from \${from.x},\${from.y} · toward \${toward.x},\${toward.y} · at \${at}\`;
}
export function parseWalkLedger() { return { departures: [], unrecognized: [] }; }
export function currentDeparture() { return null; }
export function positionAt(departure) {
  const at = departure?.toward ?? { x: 0, y: 0 };
  return { x: at.x, y: at.y, legM: 0, etaCrossings: 0, standing: true, arrived: true, remainingM: 0 };
}
`);
put("tools/vessel.mjs", "export function servicesFromFold() { return { services: [], errors: [] }; }\nexport function vesselPositionAt() { return null; }\nexport function ashoreOf() { return null; }\n");
put("tools/water.mjs", "export function crossingsOnSegment() { return []; }\n");
put("tools/geometry.mjs", `
export const rect = (mk) => ({ x: mk.at?.x ?? 0, y: mk.at?.y ?? 0, w: mk.extent?.w ?? 1, h: mk.extent?.h ?? 1 });
export function pointInRect(px, py, r) { return px >= r.x - r.w / 2 && px <= r.x + r.w / 2 && py >= r.y - r.h / 2 && py <= r.y + r.h / 2; }
export function overlapArea() { return 0; }
export const contains = () => false;
export const marksContain = () => false;
`);
put("tools/marks-fold.mjs", "export function loadMarks() { return []; }\nexport function fold() { return { marks: [] }; }\nexport function placementParent() { return null; }\nexport function marksContain() { return false; }\n");
git("init", "-q", "-b", "main");
git("add", "-A");
git("-c", "user.name=fixture", "-c", "user.email=fixture@test.invalid", "commit", "-q", "-m", "published main");

process.env.WORLD_CLONE = repo;
process.env.WORLD_POOL_DIR = pool;
process.env.WORLD_POOL_SIZE = "2";
const { walkViaOffice } = await import("../src/world.mjs");

const house = { household: "house-a", handles: new Set(["alpha"]) };
const LANDING = { x: 860, y: 1000 };

test("a set-down with __at is stamped at that instant, not now (the act's crossing, on the bottle's pen)", async () => {
  const due = NOW_CROSSING + 0.25;
  const walk = await walkViaOffice(repo, { handle: "alpha", x: LANDING.x, y: LANDING.y, __from: LANDING, __at: due }, house);
  assert.equal(walk.departed_at_crossing, due, "the act is stamped at the arrival crossing");
  assert.deepEqual(walk.from, LANDING, "a zero-length set-down AT the landing (`__from`)");
  assert.deepEqual(walk.toward, LANDING);
});

test("without __at the door is unchanged: stamped at the clock's own crossing", async () => {
  const walk = await walkViaOffice(repo, { handle: "alpha", x: 10, y: 20 }, house);
  assert.equal(walk.departed_at_crossing, NOW_CROSSING);
});

// THE STORE-ERA PEN (WORLD_MOVEMENT_V2, what prod runs) writes the act into the
// store, which this bottle has none of; the repo's own v2 walk tests pin the door
// by its source for the same reason (test/walk-from-the-kept-positions.test.mjs).
// So the two v2 facts are pinned here, and driven end to end in the playground.
const src = readFileSync(new URL("../src/world.mjs", import.meta.url), "utf8");
const doorAt = src.indexOf("export async function walkViaOffice(");
const door = src.slice(doorAt, src.indexOf("\n}\n", doorAt));

test("[pin] the store-era pen writes a due-later set-down at the arrival's own instant", () => {
  assert.ok(door.includes("const declaredAt = dueLater ? crossingSailsAt(at) : new Date().toISOString();"),
    "the written instant (what storedDepartures cuts on) is the arrival's, when __at rides the call");
});

test("[pin] the walk guard judges a due-later set-down by the occupancy of ITS instant", () => {
  assert.ok(door.includes("occupiedNowBy(who, law.thresholds, dueLater ? { ...deps, now: () => at } : deps)"),
    "at a portal's landing, the guard reads the room the passage put the walker in");
});
