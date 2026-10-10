// mists-pando-and-ground.test.mjs — the Mists' other roads (POS-468 B).
//
// Pando Peak keeps its own air: a clearing round all
// its ground, the Post Office's landing with it, so the ride is the one link
// between Pando and the map. Proved here with the office's own ride code (its
// timetable and set-down points) and the walk door's own road reading:
//   ride in → set down in clear ground; walk inside Pando → allowed (going
//   home, for the household whose parcel is there); ride out → set down in
//   town; walk out of Pando → refused at the wall.
// And the two guards: no mark placed or moved onto ground
// behind the wall, and no portal ground that sets anyone down there.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { mistsOnTheRoad, mistsWallOn, mistsGroundCheck, MISTS_FIRST_CROSSING, MISTS_UNREADABLE } from "../src/world.mjs";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { vesselServiceFrom } from "../src/world-movement.mjs";
import { depositPointFor, stopsOfService } from "../src/world-ride.mjs";
import { worldClone, NO_WORLD } from "./fixture-paths.mjs";

const CLONE = worldClone();
const SKELETON_PATH = CLONE ? join(CLONE, "WORLD", "skeleton.json") : null;
const SKELETON = SKELETON_PATH && existsSync(SKELETON_PATH) ? JSON.parse(readFileSync(SKELETON_PATH, "utf8")) : null;
const ENGINE = CLONE ? join(CLONE, "tools", "world-engine.mjs") : null;
const READY = !!SKELETON?.mists?.clearings_m?.some((k) => k.id === "pando")
  && existsSync(ENGINE) && readFileSync(ENGINE, "utf8").includes("export function mistsRoad");
const WHY_NOT = !CLONE ? NO_WORLD : `the world clone at ${CLONE} predates Pando's clearing or mistsRoad (POS-468); the pin moves to them with the world's merge`;

const LANDING = "the-town/the-pando-landing";
const QUAY = "the-town/the-post-office";
const PANDO_PARCEL = "vermillion/the-pando-peak-parcel";
const SOURCE = readFileSync(new URL("../src/world.mjs", import.meta.url), "utf8");
const APEX = readFileSync(new URL("../src/world-apex.mjs", import.meta.url), "utf8");

test("THE PANDO ROADS: ride in, walk inside, ride out, and a walk out of Pando refused", { skip: !READY && WHY_NOT }, async () => {
  const worldState = JSON.parse(readFileSync(join(CLONE, "WORLD", "world-state.json"), "utf8"));
  const { service } = await vesselServiceFrom(worldState, { repo: CLONE });
  assert.ok(service, "the Post Office's timetable reads");
  assert.ok(stopsOfService(service).some((s) => s.markId === LANDING), "she still calls at the Pando landing");
  const at = (id) => depositPointFor(id, service) ?? worldState.marks.find((m) => m.id === id)?.at;
  const landing = at(LANDING), quay = worldState.marks.find((m) => m.id === QUAY).at;
  const home = worldState.marks.find((m) => m.id === PANDO_PARCEL).at;
  for (const c of [SKELETON.mists.schedule[0].crossing, SKELETON.mists.schedule.at(-1).crossing]) {
    // ride in: the ride sets you down at the landing, and the landing is clear ground
    assert.equal(await mistsWallOn(CLONE, SKELETON, [landing], c), null, `the landing is clear at ${c}`);
    // walk inside: from the landing home to the Pando parcel, an open road
    const inside = await mistsOnTheRoad(CLONE, SKELETON, landing, home, c);
    assert.ok(inside && !inside.refused, `the road home inside Pando walks at ${c}`);
    // ride out: the quay is clear, and the road from it into town is open
    assert.equal(await mistsWallOn(CLONE, SKELETON, [quay], c), null, `the quay is clear at ${c}`);
    assert.ok(!(await mistsOnTheRoad(CLONE, SKELETON, quay, { x: 0, y: 0 }, c))?.refused);
    // walk out: no road from Pando reaches the map
    const out = await mistsOnTheRoad(CLONE, SKELETON, landing, { x: 0, y: 0 }, c);
    assert.ok(out?.refused, `a walk out of Pando is refused at the wall at ${c}`);
  }
  // every stop she calls at is clear ground at every keyframe
  for (const c of SKELETON.mists.schedule.map((e) => e.crossing))
    for (const stop of stopsOfService(service))
      assert.equal(await mistsWallOn(CLONE, SKELETON, [at(stop.markId) ?? stop.at], c), null, `${stop.markId} is clear at ${c}`);
});

test("the wall helper: a point in town is clear, a point past the border is behind the wall, and before the Mists nothing is", { skip: !READY && WHY_NOT }, async () => {
  const last = SKELETON.mists.schedule.at(-1).crossing;
  assert.equal(await mistsWallOn(CLONE, SKELETON, [{ x: 0, y: 0 }], last), null);
  const past = { x: 0, y: SKELETON.mists.border_m.minY - 500 };
  assert.deepEqual(await mistsWallOn(CLONE, SKELETON, [{ x: 0, y: 0 }, past], last), { x: past.x, y: past.y });
  assert.equal(await mistsWallOn(CLONE, SKELETON, [past], SKELETON.mists.schedule[0].crossing - 1), null);
  assert.equal(await mistsWallOn(CLONE, { physics_registry: {} }, [past], last), null, "no Mists on the record");
});

test("THE PLACEMENT DOOR asks the wall for the ground a sited or parcel mark adds, before the write, in plain words", () => {
  const door = SOURCE.slice(SOURCE.indexOf("export async function leaveMarkViaOffice"), SOURCE.indexOf("export async function withdrawMarkViaOffice") > 0 ? SOURCE.indexOf("export async function withdrawMarkViaOffice") : undefined);
  const guard = door.indexOf("await mistsGroundCheck(worldClone,");
  assert.ok(guard > 0, "the placement door asks the wall");
  assert.ok(guard > door.indexOf("RING_CLAIM_SENTENCE") && guard > door.indexOf("const clean = {"), "after every other judgment of the mark");
  assert.ok(guard < door.indexOf("await journalLeaveMark(clean)") && guard < door.indexOf("draftWrite("), "and before either pen writes");
  assert.ok(door.includes("if (seen?.unreadable) throw bounce(503, MISTS_UNREADABLE,"), "a wall it cannot read is a 503, never a pass");
  assert.match(door, /this ground stands behind the wall of the Mists/);
  assert.match(door, /marks already standing stay as they are/);
});

test("A PORTAL GROUND never sets anyone down behind the wall: the spawn asks before its walk is written", () => {
  const spawn = APEX.slice(APEX.indexOf("async function spawnOnEnter"), APEX.indexOf("// ── the read mode"));
  const asked = spawn.indexOf("await mistsGroundCheck(WORLD_CLONE,");
  assert.ok(asked > 0 && asked < spawn.indexOf("await appendJournal(null, walkEntry("), "asked before the set-down walk");
  assert.match(spawn, /sets no one down there; you stay where you entered/);
});

// ── FAIL CLOSED (POS-468 B, the seam review) ─────────────────────────────────
// A guard that cannot read the wall must not wave ground through it: from the
// Mists' first crossing, a world that will not load, an engine that will not
// import, or one without the reading refuses. A record with no schedule passes.
const MISTS_ON = { mists: { border_m: { minX: -10, minY: -10, maxX: 10, maxY: 10 }, schedule: [{ crossing: MISTS_FIRST_CROSSING, front_m: 0, veil: 0 }] } };
const HERE = [{ x: 0, y: 0 }];

test("FAIL CLOSED: a world that will not load refuses from the Mists' first crossing, and before it changes nothing", async () => {
  const unreadable = async () => { throw new Error("no world clone"); };
  assert.deepEqual(await mistsGroundCheck(CLONE ?? "nowhere", unreadable, HERE, MISTS_FIRST_CROSSING), { unreadable: true });
  assert.deepEqual(await mistsGroundCheck(CLONE ?? "nowhere", async () => null, HERE, MISTS_FIRST_CROSSING + 40), { unreadable: true }, "a world with no skeleton is as unread");
  assert.equal(await mistsGroundCheck(CLONE ?? "nowhere", unreadable, HERE, MISTS_FIRST_CROSSING - 1), null);
});

test("FAIL CLOSED: an engine that will not import, or one without the reading, refuses from the first crossing", async () => {
  assert.deepEqual(await mistsGroundCheck("G:/no/such/clone", async () => MISTS_ON, HERE, MISTS_FIRST_CROSSING), { unreadable: true });
  const dir = mkdtempSync(join(tmpdir(), "mists-old-engine-"));
  try {
    mkdirSync(join(dir, "tools"));
    writeFileSync(join(dir, "tools", "world-engine.mjs"), "export const DIALS = {};\n");
    assert.deepEqual(await mistsGroundCheck(dir, async () => MISTS_ON, HERE, MISTS_FIRST_CROSSING), { unreadable: true }, "no mistsAt / mistsHere");
    assert.equal(await mistsGroundCheck(dir, async () => MISTS_ON, HERE, MISTS_FIRST_CROSSING - 1), null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("THE QUIET PASS: a record that truly carries no Mists schedule is not refused, at any crossing", async () => {
  assert.equal(await mistsGroundCheck("G:/no/such/clone", async () => ({ physics_registry: {} }), HERE, MISTS_FIRST_CROSSING + 100), null);
});

test("the floor the office holds while it cannot read the record is the record's own first crossing", { skip: !READY && WHY_NOT }, () => {
  assert.equal(MISTS_FIRST_CROSSING, SKELETON.mists.schedule[0].crossing);
});

test("FAIL CLOSED AT THE DOORS: the mark door answers 503 in plain words with Retry-After; the spawn sets no one down", () => {
  assert.equal(MISTS_UNREADABLE, "the office cannot read the world to check the wall; try again");
  const server = readFileSync(new URL("../src/server.mjs", import.meta.url), "utf8");
  assert.ok(server.includes('if (code === 503 && obj?.defect === MISTS_UNREADABLE && !res.hasHeader?.("retry-after"))') && server.includes('res.setHeader("retry-after", String(MISTS_RETRY_AFTER_S));'), "the 503 carries Retry-After");
  const spawn = APEX.slice(APEX.indexOf("async function spawnOnEnter"), APEX.indexOf("// ── the read mode"));
  assert.ok(spawn.includes("if (seen?.unreadable) return { ground: place.ground, refused: `${MISTS_UNREADABLE}:"), "a wall it cannot read sets no one down");
});

// ── THE TOWN'S OWN GREAT MARKS (POS-468 B) ───────────────────────────────────
// Its sea, its channel and the root's box already reach behind the wall by the
// last keyframe. An amend is asked only about the ground it adds, so re-filing
// one in place is not refused; moving or widening it onto the wall still is.
test("AN AMEND ASKS ONLY ABOUT THE GROUND IT ADDS: the-sea's real outline, re-filed at the last keyframe, passes; moved south, it is refused", { skip: !READY && WHY_NOT }, async () => {
  const { mistsNewGround } = await import("../src/world.mjs");
  const { ringOf } = await import("../src/ring-box.mjs");
  const worldState = JSON.parse(readFileSync(join(CLONE, "WORLD", "world-state.json"), "utf8"));
  const sea = worldState.marks.find((m) => m.id === "the-town/the-sea");
  const last = SKELETON.mists.schedule.at(-1).crossing;
  const outline = ringOf(sea.points);
  assert.ok(outline?.length > 10, "the sea carries its outline");
  // the problem: the whole outline reaches behind the wall by the last keyframe
  assert.ok((await mistsGroundCheck(CLONE, async () => SKELETON, outline, last))?.wall, "the-sea's own ground reaches behind the wall");
  // re-filed in place: no new ground, nothing asked, nothing refused
  assert.deepEqual(mistsNewGround(sea, outline), []);
  // the root's 320 km box, re-filed as it stands: nothing new either
  const root = worldState.marks.find((m) => m.id === "the-town/let-there-be-light");
  const hw = root.extent.w / 2, hh = root.extent.h / 2;
  assert.deepEqual(mistsNewGround(root, [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([x, y]) => ({ x: root.at.x + x, y: root.at.y + y }))), []);
  // moved 3 km south: the new ground is asked, and the wall refuses it
  const moved = outline.map((p) => ({ x: p.x, y: p.y + 3000 }));
  const fresh = mistsNewGround(sea, moved);
  assert.ok(fresh.length > 0);
  assert.ok((await mistsGroundCheck(CLONE, async () => SKELETON, fresh, last))?.wall, "moved onto the wall, refused");
  // a new placement has no old footprint: all of it is asked
  assert.equal(mistsNewGround(null, outline).length, outline.length);
});
