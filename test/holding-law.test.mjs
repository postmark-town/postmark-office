// holding-law.test.mjs — makers, holder, capacity and open, read from the class tree (LOGOS v2 part 2, O1).
//
// LOGOS/classes.md, verbatim:
//   "Who may make an instance is the class's `makers` property … a constitution
//    true/false, inherited down `extends`. The root, `postmark-node`, answers
//    false; `thing`, `note`, `post` and `predicate` answer true … a subclass sets
//    false only to be the town's alone. `sited` answers true … `the-town/parcel`
//    … `the-town/portal-ground` … and `the-town/vehicle` … set false."
//   "On `resident`: `holder: true` and `capacity: 24`, both constitution and locked."
//   "On `thing`: `holder` is sovereign, default false … When it is true,
//    `capacity` (sovereign, default 30, constitution children min 1 / max 120)
//    and `open` (sovereign, default true) apply."
//   "the Halloween Candy Bag's `capacity` 200, above `thing`'s 120"

import test from "node:test";
import assert from "node:assert/strict";

import { makersOf, holdingOf, truth, whole } from "../src/holding-law.mjs";
import { lawSnapshotFromRows, snapProperty } from "../src/law-classes.mjs";

// The ruled tree as a law snapshot: class rows, and property rows (the projection law-ingest writes).
const SHA = "a".repeat(40);
const cls = (key, data) => ({ number: 300, tag_sha: SHA, newest: 300, kind: "class", key, data: { class: key, ...data } });
const prop = (klass, name, dflt, tier, parent = null) => ({ number: 300, tag_sha: SHA, newest: 300, kind: "property",
  key: parent ? `${klass}/${parent}/${name}` : `${klass}/${name}`, data: { class: klass, parent, name, tier, default: dflt, id: `the-town/${klass}-${parent ?? ""}${name}` } });
const SNAP = lawSnapshotFromRows([
  cls("postmark-node", {}), cls("mark", { extends: "postmark-node" }), cls("sited", { extends: "mark" }),
  cls("thing", { extends: "sited" }), cls("consumable", { extends: "thing" }), cls("candy", { extends: "consumable" }),
  cls("parcel", { extends: "sited" }), cls("portal-ground", { extends: "sited" }), cls("vehicle", { extends: "portal-ground" }),
  cls("entity", { extends: "postmark-node" }), cls("resident", { extends: "entity" }),
  cls("halloween-candy-bag", { extends: "thing" }), cls("halloween-candy-bowl", { extends: "thing" }),
  cls("old-thing", { extends: "mark", dials: { carry_cap: 24, makers: true } }),
  prop("postmark-node", "makers", false, "constitution"),
  prop("sited", "makers", true, "constitution"), prop("thing", "makers", true, "constitution"),
  prop("parcel", "makers", false, "constitution"), prop("portal-ground", "makers", false, "constitution"),
  // W1's shape: properties nest — holder → capacity → min, max; holder → open
  prop("resident", "holder", true, "constitution"), prop("resident", "capacity", 24, "constitution", "holder"),
  prop("thing", "holder", false, "sovereign"), prop("thing", "capacity", 30, "sovereign", "holder"),
  prop("thing", "min", 1, "constitution", "capacity"), prop("thing", "max", 120, "constitution", "capacity"),
  prop("thing", "open", true, "sovereign", "holder"),
  prop("halloween-candy-bag", "holder", true, "constitution"), prop("halloween-candy-bag", "capacity", 200, "sovereign", "holder"),
  prop("halloween-candy-bag", "max", 200, "constitution", "capacity"),
  prop("halloween-candy-bowl", "holder", true, "constitution"),
]);
const cp = (n, p) => snapProperty(SNAP, n, p);

test("makers: inherited down extends, nearest class first; the root's false where nothing nearer speaks", () => {
  for (const [c, want] of [["thing", true], ["candy", true], ["sited", true], ["halloween-candy-bowl", true],
    ["parcel", false], ["portal-ground", false], ["vehicle", false], ["resident", false], ["entity", false], ["mark", false]])
    assert.equal(makersOf(c, cp).may, want, c);
  assert.equal(makersOf("candy", cp).from, "thing", "candy's answer is thing's, inherited");
  assert.equal(makersOf("vehicle", cp).from, "portal-ground");
});

test("makers unread anywhere in the lineage answers false (G2: no floor, no hand list)", () => {
  const nothing = () => null;
  assert.deepEqual(makersOf("thing", nothing), { may: false, from: null, source: null, read: false });
  assert.equal(makersOf("unknown-class", cp).may, false, "an unknown class has no lineage that says true");
});

test("the older spellings stand second: a dial on the class answers where no property node does", () => {
  assert.equal(makersOf("old-thing", cp).may, true);
  assert.equal(snapProperty(SNAP, "old-thing", "makers").source, "dial");
  assert.equal(holdingOf({ className: "old-thing", classProperty: cp, legacy: { capacity: 24 } }).capacity, 24);
});

test("a resident holds 24, constitution: their own field never moves it", () => {
  const h = holdingOf({ mark: { capacity: 999, holder: false }, className: "resident", classProperty: cp });
  assert.equal(h.holder, true);
  assert.equal(h.capacity, 24);
  assert.equal(h.from.capacity, "resident");
});

test("a thing holds nothing unless its maker says so; then capacity 30 in 1..120 and open true, each the maker's", () => {
  const plain = holdingOf({ mark: { kind: "thing" }, className: "thing", classProperty: cp });
  assert.equal(plain.holder, false);
  const crate = holdingOf({ mark: { kind: "thing", holder: true }, className: "thing", classProperty: cp });
  assert.deepEqual([crate.holder, crate.capacity, crate.min, crate.max, crate.open], [true, 30, 1, 120, true]);
  const shut = holdingOf({ mark: { kind: "thing", holder: true, capacity: 60, open: false }, className: "thing", classProperty: cp });
  assert.deepEqual([shut.capacity, shut.open, shut.capacity_said_by], [60, false, "the mark"]);
});

test("a subclass sets its own bound: the Candy Bag's 200 is above thing's 120, and min is inherited", () => {
  const bag = holdingOf({ className: "halloween-candy-bag", classProperty: cp });
  assert.deepEqual([bag.holder, bag.capacity, bag.min, bag.max], [true, 200, 1, 200]);
  const bowl = holdingOf({ className: "halloween-candy-bowl", classProperty: cp });
  assert.deepEqual([bowl.holder, bowl.capacity, bowl.max], [true, 30, 120], "the bowl inherits thing's capacity and bounds");
});

test("the chest door's older dials stand second, behind every property", () => {
  const none = () => null;
  const h = holdingOf({ className: "chest", classProperty: none, legacy: { capacity: 30, capacity_min: 1, capacity_max: 120 } });
  assert.deepEqual([h.capacity, h.min, h.max], [30, 1, 120]);
  assert.equal(h.capacity_said_by, "the older dial");
});

test("the record's spellings of true/false and whole numbers", () => {
  assert.equal(truth("true"), true); assert.equal(truth(false), false); assert.equal(truth("yes"), null);
  assert.equal(whole("24"), 24); assert.equal(whole(2.5), null); assert.equal(whole(""), null);
});

test("the chest door reads capacity and open from properties first, the older chest dials second (G4), in both forms", async () => {
  const { classViewOf, chestFace } = await import("../src/world-units.mjs");
  const { foldUnits } = await import("../src/world-stacks.mjs");
  const CHEST_DIALS = { capacity: 30, capacity_min: 1, capacity_max: 120, first_stock: 30, portable: true, welcome: "open" };
  const withChest = lawSnapshotFromRows([...[...SNAP.classes].map(([key, data]) => cls(key, data)),
    cls("chest", { extends: "thing", dials: CHEST_DIALS }),
    ...[...SNAP.properties].flatMap(([klass, own]) => [...own.values()].map((p) => prop(klass, p.name, p.default, p.tier, p.parentName)))]);
  const view = classViewOf(withChest);
  const face = (mark) => chestFace({ mark, fold: foldUnits([]), stocked: new Set(), labels: [], view });
  const at = { x: 0, y: 0 }, extent = { w: 1, h: 1 };
  // the old form: a chest-class mark, its numbers from the chest's dials (its class states no holder property)
  const old = face({ id: "ana/bowl", by: "ana", kind: "sited", class: "chest", at, extent, capacity: 60, welcome: "closed" });
  assert.deepEqual([old.capacity, old.welcome], [60, "closed"]);
  // the new form: a thing with holder: true, its numbers from thing's properties, its own sovereign values honoured
  const neu = face({ id: "ana/bowl", by: "ana", kind: "thing", holder: true, at, extent, capacity: 60, open: false });
  assert.deepEqual([neu.capacity, neu.welcome], [60, "closed"]);
  assert.equal(face({ id: "ana/crate", by: "ana", kind: "thing", holder: true, at, extent }).capacity, 30, "thing's default capacity");
  assert.equal(face({ id: "ana/bag", by: "ana", kind: "halloween-candy-bag", at, extent }).capacity, 200, "the bag's own 200");
  assert.equal(face({ id: "ana/bag", by: "ana", kind: "halloween-candy-bag", at, extent, capacity: 150 }).capacity, 150, "inside the bag's own bound, above thing's 120");
  assert.equal(face({ id: "ana/crate", by: "ana", kind: "thing", holder: true, at, extent, capacity: 150 }).capacity, null, "above thing's 120 is refused (capacityOf), so the face shows no capacity");
});

test("the carry is the resident's capacity, property first and the thing class's carry_cap second", async () => {
  const { classViewOf } = await import("../src/world-units.mjs");
  const view = classViewOf(SNAP);
  assert.equal(holdingOf({ className: "resident", classProperty: (n, p) => view.property(n, p), legacy: { capacity: view.dials("thing")?.carry_cap } }).capacity, 24);
  const older = classViewOf(lawSnapshotFromRows([cls("thing", { dials: { carry_cap: 24 } }), cls("resident", {})]));
  assert.equal(holdingOf({ className: "resident", classProperty: (n, p) => older.property(n, p), legacy: { capacity: older.dials("thing")?.carry_cap } }).capacity, 24, "the older record's carry_cap still answers");
});

test("an own capacity outside its class's bounds is refused, never clamped (review-606)", () => {
  const bag = holdingOf({ mark: { capacity: 500 }, className: "halloween-candy-bag", classProperty: cp });
  assert.equal(bag.capacity, null);
  assert.match(bag.capacity_refused, /500 is outside 1\.\.200/);
  const ok = holdingOf({ mark: { capacity: 150 }, className: "halloween-candy-bag", classProperty: cp });
  assert.deepEqual([ok.capacity, ok.capacity_refused], [150, undefined]);
  assert.equal(holdingOf({ mark: { holder: true, capacity: 0 }, className: "thing", classProperty: cp }).capacity, null, "below thing's min 1");
});
