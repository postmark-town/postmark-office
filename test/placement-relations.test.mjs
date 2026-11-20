// placement-relations.test.mjs — POS-1156: a placement names what it overlaps and what it contains.
//
// The pure helper (src/placement-relations.mjs) against the REAL engine: the office's own pinned
// world clone, `tools/marks-fold.mjs` (containmentParentOf, worldRootOf) and `tools/geometry.mjs`
// (marksOverlapArea). A stand-in predicate here would prove the helper agrees with itself, so the
// fixture is plain marks and the answer is the engine's.
//
// The door legs (preview writes nothing, the write answers the same, one call) are in
// test/placement-relations-door.test.mjs.
//
//   node --test test/placement-relations.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { placementRelations, RELATION_ROWS_MAX } from "../src/placement-relations.mjs";

const CLONE = join(dirname(fileURLToPath(import.meta.url)), "..", "world-clone");
const have = existsSync(join(CLONE, "tools", "geometry.mjs")) && existsSync(join(CLONE, "tools", "marks-fold.mjs"));
const skip = !have && "no world-clone (the consumed engine is read from it)";
const fold = have ? await import(pathToFileURL(join(CLONE, "tools", "marks-fold.mjs"))) : {};
const geom = have ? await import(pathToFileURL(join(CLONE, "tools", "geometry.mjs"))) : {};

const box = (id, x, y, w, h, extra = {}) => ({ id, by: id.split("/")[0], kind: "sited", at: { x, y }, extent: { w, h }, ...extra });
const ROOT = { id: "the-town/let-there-be-light", by: "the-town", kind: "sited", slug: "let-there-be-light", at: { x: 0, y: 0 }, extent: { w: 60000, h: 60000 } };
const HOUSES = { ada: "ada-house", bea: "bea-house" };
const deps = (over = {}) => ({
  marksOverlapArea: geom.marksOverlapArea, containmentParentOf: fold.containmentParentOf, worldRootOf: fold.worldRootOf,
  name: (m) => m.id.split("/")[1], household: (m) => HOUSES[m.by] ?? null, ...over,
});
const ids = (rows) => rows.map((r) => r.id);

// The candidate: ada's shed, x 105..115, y 100..110, on ada's parcel (97.5..122.5, 92.5..117.5).
const CAND = box("ada/the-shed", 110, 105, 10, 10);
const PARCEL = box("ada/ada-parcel", 110, 105, 25, 25, { kind: "parcel" });
const SQUARE = box("the-town/town-square", 100, 100, 40, 40);
const BENCH = box("ada/the-bench", 112, 105, 2, 2);          // wholly inside the shed: ada's own mark, contained
const CART = box("bea/the-cart", 116, 105, 6, 6);            // x 113..119: sticks out of the shed — overlaps, not contained
const BOX = box("bea/the-box", 108, 105, 6, 6);              // x 105..111 y 102..108: wholly inside the shed — contained
const CRATE = box("ada/the-crate", 107, 103, 2, 2);          // inside the box, so held by the TIGHTER box, not by the shed
const FAR = box("bea/far-hut", -300, -300, 4, 4);            // disjoint
const POT = box("bea/edge-pot", 104, 105, 2, 2);             // x 103..105: its edge touches the shed's, no shared area
const TWIN = box("bea/the-twin", 110, 105, 10, 10);          // the shed's own rect: shares ground, is neither parent nor child
const WORLD = [ROOT, SQUARE, PARCEL, BENCH, CART, BOX, CRATE, FAR, POT];

test("overlaps: every other placed mark sharing ground, own marks and the holding marks included; contact and the far are not", { skip }, () => {
  const out = placementRelations(CAND, WORLD, deps());
  assert.deepEqual(ids(out.overlaps), ["ada/ada-parcel", "ada/the-bench", "ada/the-crate", "bea/the-box", "bea/the-cart", "the-town/town-square"]);
  assert.ok(!ids(out.overlaps).includes("bea/far-hut"), "a disjoint mark is not listed");
  assert.ok(!ids(out.overlaps).includes("bea/edge-pot"), "touching an edge shares no area (the predicate's own answer, area 0)");
  assert.ok(!ids(out.overlaps).includes("the-town/let-there-be-light"), "the world frame is the frame, not a neighbour");
  assert.ok(!ids(out.overlaps).includes("ada/the-shed"), "never the candidate itself");
  // each row is the public projection: id, name, household, nothing else
  assert.deepEqual(out.overlaps.find((r) => r.id === "bea/the-cart"), { id: "bea/the-cart", name: "the-cart", household: "bea-house" });
  assert.deepEqual(Object.keys(out.overlaps[0]).sort(), ["household", "id", "name"]);
});

test("contains: the marks that would become its children by the fold's own rule: a mark held by something tighter is not one", { skip }, () => {
  const out = placementRelations(CAND, WORLD, deps());
  assert.deepEqual(ids(out.contains), ["ada/the-bench", "bea/the-box"], "own mark and other house's mark both named, with households");
  assert.deepEqual(out.contains.map((r) => r.household), ["ada-house", "bea-house"]);
  assert.ok(!ids(out.contains).includes("ada/the-crate"), "the crate is wholly inside the shed but its tightest container is the box");
  assert.ok(!ids(out.contains).includes("bea/the-cart"), "a mark that sticks out is not wholly covered");
  // the same answer the engine gives about the children once the candidate stands
  const all = [...WORLD, CAND];
  for (const m of [BENCH, BOX, CRATE]) assert.equal(fold.containmentParentOf(m, all) === CAND.id, ids(out.contains).includes(m.id), m.id);
});

test("an equal-size twin shares ground but is neither the parent nor a child; the lists never change what it nests in", { skip }, () => {
  const world = [...WORLD, TWIN];
  const out = placementRelations(CAND, world, deps());
  assert.ok(ids(out.overlaps).includes("bea/the-twin"), "it shares the shed's whole footprint");
  assert.ok(!ids(out.contains).includes("bea/the-twin"), "a container is strictly larger than what it holds");
  // whatever the fold decides about the bench in the twin's company (a tie goes to the first), the list says exactly that
  assert.equal(ids(out.contains).includes("ada/the-bench"), fold.containmentParentOf(BENCH, [...world, CAND]) === CAND.id);
  const all = [...world, CAND];
  assert.equal(fold.containmentParentOf(CAND, all), "ada/ada-parcel", "the engine's parent: the smallest strictly larger holder; the twin does not hold it");
  const before = JSON.stringify(world);
  placementRelations(CAND, world, deps());
  assert.equal(JSON.stringify(world), before, "the marks it was handed are untouched");
});

test("an amend's own old row is not a neighbour, and a repeated id counts once, as the later row", { skip }, () => {
  const oldRow = box("ada/the-shed", 110, 105, 10, 10, { body: "the old place" });   // same spot: would overlap itself
  const dup = [...WORLD, oldRow, box("bea/the-cart", 300, 300, 6, 6)];                 // the later row of the cart has moved away
  const out = placementRelations(CAND, dup, deps());
  assert.ok(!ids(out.overlaps).includes("ada/the-shed"));
  assert.ok(!ids(out.overlaps).includes("bea/the-cart"), "the later row of the cart is the one judged, and it is far away");
});

test("polygons go through the engine's own predicate: a ring's bounding box alone does not overlap", { skip }, () => {
  // A triangle whose box reaches the shed (x 112..115) but whose shape does not: it lies above the line y = 227 - x
  const ringOff = { id: "bea/the-wedge-off", by: "bea", kind: "sited", at: { x: 121, y: 106 }, extent: { w: 18, h: 18 },
    points: [[112, 115], [130, 115], [130, 97]] };
  const ringOn = { id: "bea/the-wedge-on", by: "bea", kind: "sited", at: { x: 107.5, y: 105 }, extent: { w: 15, h: 20 },
    points: [[100, 95], [115, 95], [100, 115]] };    // lower-left corner of its box: well inside the shed's ground
  assert.ok(geom.marksOverlapArea(CAND, ringOn) > 0, "fixture: the engine says the 'on' ring shares ground");
  assert.ok(!(geom.marksOverlapArea(CAND, ringOff) > 0), "fixture: the engine says the 'off' ring shares none, though the boxes touch");
  assert.ok(geom.overlapArea(geom.rect(CAND), geom.rect(ringOff)) > 0, "fixture: the bare boxes do overlap, so only the shape test can leave it out");
  const out = placementRelations(CAND, [...WORLD, ringOff, ringOn], deps());
  assert.ok(ids(out.overlaps).includes("bea/the-wedge-on"));
  assert.ok(!ids(out.overlaps).includes("bea/the-wedge-off"));
  // a ring candidate: the shape, not the box, decides what it overlaps
  const ringCand = { id: "ada/the-ring", by: "ada", kind: "sited", at: { x: 107.5, y: 105 }, extent: { w: 15, h: 20 }, points: [[100, 95], [115, 95], [100, 115]] };
  const own = placementRelations(ringCand, [...WORLD, ringOff], deps());
  assert.ok(!ids(own.overlaps).includes("bea/the-wedge-off"));
});

test("not read is not empty: an engine without the predicates, or a candidate with no place, answers null", { skip }, () => {
  assert.equal(placementRelations(CAND, WORLD, deps({ marksOverlapArea: undefined })), null);
  assert.equal(placementRelations(CAND, WORLD, deps({ containmentParentOf: undefined })), null);
  assert.equal(placementRelations({ id: "ada/the-note", by: "ada", kind: "predicate" }, WORLD, deps()), null);
});

test("nothing touching it is an honest empty read, and a long list is cut with its true count", { skip }, () => {
  const lone = box("ada/the-lone", 5000, 5000, 4, 4);
  assert.deepEqual(placementRelations(lone, WORLD, deps()), { overlaps: [], contains: [] });
  const crowd = Array.from({ length: RELATION_ROWS_MAX + 7 }, (_, i) => box(`bea/spot-${String(i).padStart(3, "0")}`, 110, 105, 3, 3));
  const out = placementRelations(CAND, [...WORLD, ...crowd], deps());
  assert.equal(out.overlaps.length, RELATION_ROWS_MAX);
  assert.equal(out.overlaps_more, 6 + 7, "the cut says how many more: six neighbours plus the crowd of forty-seven, less the forty shown");
});
