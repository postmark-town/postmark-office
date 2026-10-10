// mists-walk-door.test.mjs — the walk declare reads the Mists (POS-468).
//
// The stride falls the deeper a road goes into the Mists' fringe, to nothing at
// the wall's face. The world's engine owns the reading
// (tools/world-engine.mjs § mistsRoad); this door asks it once at the declare,
// refuses a road into the wall before any act is written, and stamps the leg's
// slowed stride as its pace, so every reader of a departure walks it slowed.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { mistsOnTheRoad, mistsRefusal, mistedPace } from "../src/world.mjs";
import { worldClone, NO_WORLD } from "./fixture-paths.mjs";

const SOURCE = readFileSync(new URL("../src/world.mjs", import.meta.url), "utf8");
const CLONE = worldClone();
const ENGINE = CLONE ? join(CLONE, "tools", "world-engine.mjs") : null;
const HAS_ROAD = !!ENGINE && existsSync(ENGINE) && readFileSync(ENGINE, "utf8").includes("export function mistsRoad");
const WHY_NOT = !CLONE ? NO_WORLD : `the world clone at ${CLONE} predates mistsRoad (POS-468); the pin moves to it with the world's merge`;
const bounce = (code, defect, hint, extra = {}) => Object.assign(new Error(defect), { code, defect, hint, ...extra });

test("the stride: the dial's pace slowed by the factor; no factor, the pace exactly as it was", () => {
  assert.equal(mistedPace(60, null, 15), 60);
  assert.equal(mistedPace(60, 1, 15), 60);
  assert.equal(mistedPace(null, null, 15), null, "an unreadable dial stays unstamped, as before");
  assert.equal(mistedPace(60, 0.5, 15), 30);
  assert.equal(mistedPace(null, 0.5, 15), 7.5, "a slowed leg is always stamped: at the legacy constant's stride when the dial is unreadable");
});

test("the refusal says, in plain words, where the road meets the wall", () => {
  const e = mistsRefusal(bounce, { x: 0, y: -4600 });
  assert.equal(e.code, 422);
  assert.equal(e.defect, "the mist is too thick to walk into");
  assert.match(e.hint, /\(0, -4600\)/);
  assert.match(e.hint, /no road goes into the wall/);
  assert.deepEqual(e.wall_at, { x: 0, y: -4600 });
});

test("no Mists on the record, or a clone without the reading: the road is untouched", async () => {
  assert.equal(await mistsOnTheRoad(CLONE ?? "nowhere", { physics_registry: {} }, { x: 0, y: 0 }, { x: 1, y: 1 }, 300), null);
  assert.equal(await mistsOnTheRoad("G:/no/such/clone", { mists: { schedule: [] } }, { x: 0, y: 0 }, { x: 1, y: 1 }, 300), null);
});

test("THE ORDER: the Mists are read before the exits under DEC-5 and before the pen, and the pen's pace is the slowed stride", () => {
  const door = SOURCE.slice(SOURCE.indexOf("export async function walkViaOffice"), SOURCE.indexOf("export async function worldWalkers"));
  const read = door.indexOf("let mistRoad = await mistsOnTheRoad(");
  const refused = door.indexOf("if (mistRoad?.refused) throw mistsRefusal(");
  const exits = door.indexOf("await exitViaOffice(");
  const pen = door.indexOf("walkEntry({");
  assert.ok(read > 0 && refused > read, "the road is read, and a refusal thrown, in the door");
  assert.ok(refused < exits, "a refused road writes no exit act");
  assert.ok(refused < pen, "a refused road writes no walk act");
  assert.match(door, /const pace = mistedPace\(departurePace\(\), mistFactor, WALK_KM_PER_CROSSING\);/);
  assert.match(door, /\.\.\.\(mistFactor \? \{ mistFactor \} : \{\}\)/, "the legacy pen gets the factor too");
});

const SKELETON = HAS_ROAD ? JSON.parse(readFileSync(join(CLONE, "WORLD", "skeleton.json"), "utf8")) : null;

test("against the world clone: a road into the wall is refused, a road into the fringe slowed, a road clear of it untouched", { skip: !HAS_ROAD && WHY_NOT }, async () => {
  const last = SKELETON.mists.schedule.at(-1).crossing;
  const eng = await import(`file:///${ENGINE.replace(/\\/g, "/")}`);
  const face = eng.mistsAt(last, SKELETON.mists).clear.minY;
  const from = { x: 0, y: -2000 };
  const into = await mistsOnTheRoad(CLONE, SKELETON, from, { x: 0, y: face - 50 }, last);
  assert.ok(into.refused, "into the wall");
  const fringe = await mistsOnTheRoad(CLONE, SKELETON, from, { x: 0, y: face + 50 }, last);
  assert.ok(!fringe.refused && fringe.factor < 1, "into the fringe, slowed");
  const clear = await mistsOnTheRoad(CLONE, SKELETON, from, { x: 0, y: -2500 }, last);
  assert.deepEqual(clear, { factor: 1, deepest: 0 });
  assert.equal(await mistsOnTheRoad(CLONE, SKELETON, from, { x: 0, y: face - 50 }, SKELETON.mists.schedule[0].crossing - 1), null, "before the Mists, nothing");
  assert.deepEqual(await mistsOnTheRoad(CLONE, SKELETON, { x: 0, y: face - 50 }, { x: 0, y: face - 50 }, last), { factor: 1, deepest: 0 }, "a stop is never refused, wherever it stands");
});

test("the walk out at the door: a walker the wall overtook may walk straight out, slowly; deeper is refused in today's words", { skip: !HAS_ROAD && WHY_NOT }, async () => {
  const first = SKELETON.mists.schedule[0].crossing;
  const eng = await import(`file:///${ENGINE.replace(/\\/g, "/")}`);
  const caught = { x: 0, y: eng.mistsAt(first, SKELETON.mists).clear.minY - 100 };
  const out = await mistsOnTheRoad(CLONE, SKELETON, caught, { x: 0, y: 0 }, first);
  assert.ok(out && !out.refused && out.walk_out && out.factor < 1, "toward the Origin: allowed, slow");
  const deeper = await mistsOnTheRoad(CLONE, SKELETON, caught, { x: 0, y: caught.y - 300 }, first);
  assert.ok(deeper?.refused, "deeper: refused");
  assert.equal(mistsRefusal(bounce, deeper.refused).defect, "the mist is too thick to walk into");
  assert.ok(SOURCE.includes("the wall of the Mists had overtaken you"), "the answer says so");
});
