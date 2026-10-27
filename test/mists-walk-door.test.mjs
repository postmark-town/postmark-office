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
import { mistsOnTheRoad, mistsRefusal, mistedPace, oldTrackSentence, mistsTrackHint, OLD_TRACK_NEAR_M } from "../src/world.mjs";
import { findMarks } from "../src/world-find.mjs";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
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

// ── THE OLD TRACK IS NAMED IN THE REFUSAL (WLD-6; Darko 2026-10-26 13:54: "revealing the path through the mists more
// clearly now that it's been discovered"). Revelation only: who may walk where is the engine's, unchanged. The office
// reads the kept air from the engine's own exports (KEPT_AIR, KEPT_AIR_SINCE) and keeps no copy of the boxes.
const BOXES = [
  { minX: 3690, maxX: 3770, minY: -5340, maxY: -3340 },
  { minX: 3690, maxX: 3912, minY: -5586, maxY: -5300 },
];
const SOL = { x: 3631, y: -3840 };       // where Sol's road (3198.9, -2907.5) → (3735, -4065) met the wall
const SENTENCE = "There is one way through here: an old track of clear air runs due south through the mist along x 3690 to 3770, from (3730, -3340) to the Spire's back wall. Walk to its north end first, then straight south along it.";

test("a refused road near the old track is told where the track is: the sentence is the engine's boxes, in plain words", () => {
  assert.equal(oldTrackSentence(BOXES, 272, 282, SOL), SENTENCE);
  const e = mistsRefusal(bounce, SOL, {}, oldTrackSentence(BOXES, 272, 282, SOL));
  assert.equal(e.defect, "the mist is too thick to walk into", "still refused, in the same words");
  assert.match(e.hint, /no road goes into the wall/, "the old hint stands whole");
  assert.ok(e.hint.endsWith(SENTENCE), "and the track's sentence follows it");
  assert.deepEqual(e.wall_at, SOL);
});

test("a road far from the track gets the old hint unchanged, byte for byte", () => {
  const far = { x: -3000, y: -4000 };
  assert.equal(oldTrackSentence(BOXES, 272, 282, far), null);
  assert.equal(mistsRefusal(bounce, far, {}, oldTrackSentence(BOXES, 272, 282, far)).hint, mistsRefusal(bounce, far).hint);
  const edge = { x: 3690 - OLD_TRACK_NEAR_M, y: -4000 };
  assert.ok(oldTrackSentence(BOXES, 272, 282, edge), "1.5 km from the track's side is near");
  assert.equal(oldTrackSentence(BOXES, 272, 282, { x: edge.x - 1, y: -4000 }), null, "just past 1.5 km is far");
});

test("the track is named only when the engine keeps it: before its crossing, with no boxes, or with a bad box, nothing extra", () => {
  assert.equal(oldTrackSentence(BOXES, 272, 271, SOL), null, "before 272 the track is not kept air");
  assert.equal(oldTrackSentence(undefined, 272, 282, SOL), null);
  assert.equal(oldTrackSentence([], 272, 282, SOL), null);
  assert.equal(oldTrackSentence([{ minX: 1 }], 272, 282, SOL), null);
  assert.equal(oldTrackSentence(BOXES, 272, 282, null), null);
});

function stubEngine(source) {
  const dir = mkdtempSync(join(tmpdir(), "mists-track-"));    // not a git repo: it is its own engine
  mkdirSync(join(dir, "tools"));
  writeFileSync(join(dir, "tools", "world-engine.mjs"), source);
  return dir;
}

test("read from the engine at the door: an engine that exports the kept air names the track; one that does not says nothing extra", async () => {
  const exporting = stubEngine(`export const KEPT_AIR_SINCE = 272; export const KEPT_AIR = ${JSON.stringify(BOXES)};`);
  assert.equal(await mistsTrackHint(exporting, SOL, 282), SENTENCE);
  assert.equal(await mistsTrackHint(exporting, { x: -3000, y: -4000 }, 282), null);
  const older = stubEngine("export function mistsRoad() { return null; }");
  assert.equal(await mistsTrackHint(older, SOL, 282), null, "a deployed engine without the export: fail quiet, not wrong");
  assert.equal(await mistsTrackHint("G:/no/such/clone", SOL, 282), null, "an engine that will not load: nothing extra");
});

test("the walk door carries the sentence on both refusals (the first read, and the read after stepping ashore)", () => {
  const door = SOURCE.slice(SOURCE.indexOf("export async function walkViaOffice"), SOURCE.indexOf("export async function worldWalkers"));
  const calls = door.match(/throw mistsRefusal\([^\n]*await mistsTrackHint\(worldClone, mistRoad\.refused, at\)\);/g) ?? [];
  assert.equal(calls.length, 2);
  assert.doesNotMatch(door, /throw mistsRefusal\(bounce, mistRoad\.refused(, \{[^}]*\})?\);/, "no refusal leaves the door without it");
});

test("the signpost is findable: `find: \"old track\"` ranks the-town/the-old-track first", () => {
  const marks = [
    { id: "the-town/the-old-track", at: { x: 3730, y: -3330 }, kind: "note" },
    { id: "the-town/the-commons", at: { x: 0, y: 0 }, kind: "place" },
  ];
  const found = findMarks(marks, "old track");
  assert.equal(found.hits[0]?.id, "the-town/the-old-track");
  assert.equal(found.hits[0].name, "the Old Track");
});

test("against the world clone, once it carries the export: Sol's road is still refused, and is now told the track", { skip: !HAS_ROAD && WHY_NOT }, async (t) => {
  const eng = await import(pathToFileURL(ENGINE).href);
  if (!eng.KEPT_AIR) return t.skip("the pinned world engine predates the KEPT_AIR export (WLD-6 part 2); the pin moves to it with the world's merge");
  const last = SKELETON.mists.schedule.at(-1).crossing;
  const road = await mistsOnTheRoad(CLONE, SKELETON, { x: 3198.9, y: -2907.5 }, { x: 3735, y: -4065 }, last);
  assert.ok(road.refused, "who may walk where is unchanged: the diagonal is still refused");
  assert.equal(await mistsTrackHint(CLONE, road.refused, last), SENTENCE);
});
