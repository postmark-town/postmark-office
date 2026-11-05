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
import { lastStandingCrossing } from "./helpers/mists-standing.mjs";

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
  const read = door.indexOf("await roadFromTheDeposit({");
  const refused = door.indexOf("if (roadRead.refused) {");
  const exits = door.indexOf("await exitViaOffice(");
  const pen = door.indexOf("walkEntry({");
  assert.ok(read > 0 && refused > read, "the road is read, and a refusal thrown, in the door");
  assert.ok(read < exits && exits < refused, "the exit is injected into roadFromTheDeposit, which reads the road before it exits (its tests drive the order)");
  assert.ok(refused < pen, "a refused road writes no walk act");
  assert.match(door, /const pace = mistedPace\(departurePace\(\), mistFactor, WALK_KM_PER_CROSSING\);/);
  assert.match(door, /\.\.\.\(mistFactor \? \{ mistFactor \} : \{\}\)/, "the legacy pen gets the factor too");
});

const SKELETON = HAS_ROAD ? JSON.parse(readFileSync(join(CLONE, "WORLD", "skeleton.json"), "utf8")) : null;

test("against the world clone: a road into the wall is refused, a road into the fringe slowed, a road clear of it untouched", { skip: !HAS_ROAD && WHY_NOT }, async () => {
  const last = lastStandingCrossing(SKELETON.mists);                // WLD-147: a withdrawn record's last keyframe has no Mists; the wall at its fullest is the crossing before
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

test("the walk door carries the sentence on its one refusal (both reads of the road come back through it)", () => {
  const door = SOURCE.slice(SOURCE.indexOf("export async function walkViaOffice"), SOURCE.indexOf("export async function worldWalkers"));
  const calls = door.match(/throw mistsRefusal\([^\n]*await mistsTrackHint\(worldClone, roadRead\.refused, at\)\);/g) ?? [];
  assert.equal(calls.length, 1);
  assert.doesNotMatch(door, /throw mistsRefusal\(bounce, [a-zA-Z.]+\.refused(, \{[^}]*\})?\);/, "no refusal leaves the door without it");
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

// ── WLD-134 (Darko 2026-10-30 09:59 EDT, "Add from crossing"): THE WAY TO THE SPIRE PARTS AT CROSSING 282 (POS-896) ──
// Until this change the case below read the last standing crossing (282) off the pinned skeleton and expected Sol's
// diagonal (3198.9, -2907.5) → (3735, -4065) REFUSED. At the world pin that carries WLD-134 two clearings are parted
// FROM crossing 282, "the way to the Spire" (3850, -4263, r 935) among them, so at 282 that whole diagonal lies on clear
// ground: the clear box up to the wall's face at y -3840, then the one convex disc from there to the destination (the
// face point is 476 m from the disc's centre and the destination 229 m, the disc's radius 935). Not the endpoint alone:
// the engine reads the entire segment (a wall endpoint inside a disc says nothing about the stretch between). The
// movement exception for the old track (KEPT_AIR) is a separate, movement-only rule (WLD-6): nothing here reads sight
// or paint as permission to walk. At crossing 281 the clearing has not parted, so the same road is refused as it was.
//
// THE INPUTS ARE THIS FILE'S OWN: a mists record spelled out below (the world's border, schedule and the two clearings as
// numbers), so a later move of the world's skeleton cannot move this case; what is read from the clone is the ENGINE (the
// code under test). It skips, by its title, on an engine without WLD-134's `from_crossing` (the pin before it).
const PARTING = 282;
const MISTS = {
  border_m: { minX: -4600, minY: -4600, maxX: 5850, maxY: 9700 },
  fringe_m: 400, wall_sight_m: 20,
  density: { from: 0.55, to: 0.95, power: 2 },
  schedule: [{ crossing: 244, front_m: 0, veil: 0.1 }, { crossing: 272, front_m: 390, veil: 0.3 }, { crossing: PARTING, front_m: 760, veil: 0.5 }],
  clearings_m: [
    { id: "invented-spire", x: 3850, y: -5500, r_m: 821, from_crossing: PARTING },
    { id: "invented-way", x: 3850, y: -4263, r_m: 935, from_crossing: PARTING },
  ],
};
const SOL_FROM = { x: 3198.9, y: -2907.5 }, SOL_TO = { x: 3735, y: -4065 };
const HAS_PARTING = HAS_ROAD && readFileSync(ENGINE, "utf8").includes("from_crossing");
const WHY_NO_PARTING = !HAS_ROAD ? WHY_NOT : "the pinned world engine predates WLD-134's from_crossing (clearings parted from a crossing); the pin moves to it with the world's merge";
const road = (from, to, crossing) => mistsOnTheRoad(CLONE, { mists: MISTS }, from, to, crossing);
const clearingsAt = (c) => MISTS.clearings_m.filter((k) => c >= k.from_crossing);
const inAnyClearing = (p, c) => clearingsAt(c).some((k) => Math.hypot(p.x - k.x, p.y - k.y) <= k.r_m);
/** n+1 points along the segment: the entire path, not its endpoints. */
const along = (a, b, n = 200) => Array.from({ length: n + 1 }, (_, i) => ({ x: a.x + (b.x - a.x) * i / n, y: a.y + (b.y - a.y) * i / n }));

test("WLD-134 · Sol's whole diagonal: refused at 281 (the way not yet parted), walked at 282 (every point of it on clear ground)", { skip: !HAS_PARTING && WHY_NO_PARTING }, async () => {
  const eng = await import(pathToFileURL(ENGINE).href);
  const at281 = await road(SOL_FROM, SOL_TO, PARTING - 1);
  assert.ok(at281.refused, "281: the clearing has not parted, so the diagonal into the wall is refused");
  const face281 = eng.mistsAt(PARTING - 1, MISTS).clear.minY;
  assert.ok(Math.abs(at281.refused.y - face281) <= 2, `281: it is refused where the road meets the wall's face (${at281.refused.y} vs ${face281})`);
  assert.ok(along(SOL_FROM, SOL_TO).some((p) => eng.mistsHere(p, eng.mistsAt(PARTING - 1, MISTS)).inWall), "281: some stretch of the segment is in the wall");

  const at282 = await road(SOL_FROM, SOL_TO, PARTING);
  assert.ok(!at282.refused, `282: the whole diagonal is clear ground, not refused (${JSON.stringify(at282)})`);
  const m282 = eng.mistsAt(PARTING, MISTS);
  assert.ok(along(SOL_FROM, SOL_TO).every((p) => !eng.mistsHere(p, m282).inWall), "282: no point of the entire segment is in the wall");
  assert.ok(inAnyClearing(SOL_TO, PARTING), "282: the destination is inside a parted clearing (the precondition of the case)");
  assert.ok(!inAnyClearing(SOL_TO, PARTING - 1), "281: the same destination is in no active clearing");
});

test("WLD-134 · the rim pair: 1 m inside the parted way is walked at 282 and refused at 281; 1 m outside is refused at both", { skip: !HAS_PARTING && WHY_NO_PARTING }, async () => {
  const way = MISTS.clearings_m.find((k) => k.id === "invented-way");
  const inside = { x: way.x + way.r_m - 1, y: way.y }, outside = { x: way.x + way.r_m + 1, y: way.y };
  assert.ok(inAnyClearing(inside, PARTING) && !inAnyClearing(outside, PARTING), "the pair straddles the rim");
  assert.ok(!(await road(SOL_FROM, inside, PARTING)).refused, "inside the rim at 282: walked");
  assert.ok((await road(SOL_FROM, inside, PARTING - 1)).refused, "inside the rim at 281: refused");
  assert.ok((await road(SOL_FROM, outside, PARTING)).refused, "1 m outside the rim at 282: refused");
  assert.ok((await road(SOL_FROM, outside, PARTING - 1)).refused, "outside at 281: refused");
});

test("WLD-134 · a current negative outside ALL active clearings and off the old track: a diagonal into the wall at 282 is still refused", { skip: !HAS_PARTING && WHY_NO_PARTING }, async () => {
  const eng = await import(pathToFileURL(ENGINE).href);
  const far = { x: 2400, y: -4300 };
  assert.ok(!inAnyClearing(far, PARTING), "outside every clearing active at 282");
  assert.ok(!(eng.KEPT_AIR ?? []).some((b) => far.x >= b.minX && far.x <= b.maxX && far.y >= b.minY && far.y <= b.maxY), "and not on the old track");
  const r = await road(SOL_FROM, far, PARTING);
  assert.ok(r.refused, "refused");
  assert.ok(Math.abs(r.refused.y - eng.mistsAt(PARTING, MISTS).clear.minY) <= 2, "at the wall's face");
});

test("WLD-134 · the track is still named on the 281 refusal: the sentence is the engine's kept air in plain words", { skip: !HAS_PARTING && WHY_NO_PARTING }, async (t) => {
  const eng = await import(pathToFileURL(ENGINE).href);
  if (!eng.KEPT_AIR) return t.skip("the pinned world engine predates the KEPT_AIR export (WLD-6 part 2); the pin moves to it with the world's merge");
  const refused = (await road(SOL_FROM, SOL_TO, PARTING - 1)).refused;
  assert.ok(refused, "refused at 281 (the precondition)");
  assert.equal(await mistsTrackHint(CLONE, refused, PARTING - 1), SENTENCE);
  // and off the track the old hint stands whole: the far negative is refused with no sentence
  const farRefused = (await road(SOL_FROM, { x: -3000, y: -4300 }, PARTING)).refused;
  assert.ok(farRefused);
  assert.equal(await mistsTrackHint(CLONE, farRefused, PARTING), null, "a refusal far from the track names no track");
});
