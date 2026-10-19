// both-forms.test.mjs — every changed reader gives ONE answer for both spellings
// of a mark's class (LOGOS v2 part 2, lane O1).
//
// LOGOS/classes.md § The LOGOS ladder, verbatim: "`kind` is a flat field naming
// the node's own class … The `class:` field folds into `kind`." Until the
// instance migration (W2) lands, the record holds both forms:
//   old   kind: sited + class: thing
//   new   kind: thing
// Each test feeds a reader the old form, then the same marks in the new form,
// and holds the two answers equal. The class tree is W1's: thing, parcel,
// portal-ground and vehicle under sited (ruled 13:56–15:12).

import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { tmpdir } from "node:os";

process.env.WORLD_CLONE = join(tmpdir(), "postmark-no-world-clone-both-forms");
const { reloadLawSnapshot, resetLawSnapshot, LAW_REFRESH_SQLS } = await import("../src/law-snapshot.mjs");
const { placeMarksFrom } = await import("../src/world.mjs");
const { pathFor } = await import("../src/world-journal.mjs");
const { stanceReturnsWhole } = await import("../src/world-settlement.mjs");
const { carryForecast } = await import("../src/carry-forecast.mjs");
const { isDroppedUnitMark } = await import("../src/world-stacks.mjs");
const { withinWithVehicles } = await import("../src/world-apex.mjs");
const { worldHasVehicle, vehicleWithin } = await import("../src/world-movement.mjs");
const { groundBlockOf, portalEntryFor } = await import("../src/world-crossings.mjs");
const { findMarks } = await import("../src/world-find.mjs");
const { pointAnswerable } = await import("../src/world-serve.mjs");
const { classFieldOf, classNodeNameOf } = await import("../src/world-grants.mjs");

// W1's class tree as the office's class layer (a law snapshot), and as class nodes on the record.
const TREE = { mark: "postmark-node", sited: "mark", predicate: "mark", thing: "sited", parcel: "sited",
  "portal-ground": "sited", vehicle: "portal-ground", consumable: "thing", candy: "consumable", post: "postmark-node", idea: "post" };
const SHA = "b".repeat(40);
await reloadLawSnapshot({ force: true, query: async (sql) => ({ rows: sql === LAW_REFRESH_SQLS.pin ? [{ newest: 270, pinned: 270 }]
  : Object.entries({ "postmark-node": null, ...TREE }).map(([key, ext]) => ({ number: 270, tag_sha: SHA, newest: 270, kind: "class", key, data: { class: key, ...(ext ? { extends: ext } : {}) } })) }) });
test.after(() => resetLawSnapshot());
const CLASS_NODES = Object.entries(TREE).map(([c, ext]) => ({ id: `the-town/${c}`, by: "the-town", kind: "class", class: c, extends: ext }));

/** The same mark in the new form: `kind` names its class, and `class:` is gone. */
const neu = (m) => {
  if (!m || m.kind !== "sited" || m.class == null) return m;
  const { class: c, ...rest } = m;
  return { ...rest, kind: c };
};
const both = (marks, fn) => { const a = fn(marks); const b = fn(marks.map(neu)); return [a, b]; };

const stool = { id: "keith/stool", by: "keith", kind: "sited", class: "thing", at: { x: 10, y: 10 }, extent: { w: 1, h: 1 } };
const shed = { id: "keith/shed", by: "keith", kind: "sited", at: { x: 0, y: 0 }, extent: { w: 40, h: 40 } };
const ferry = { id: "the-town/the-ferry", by: "the-town", kind: "sited", class: "vehicle", at: { x: 100, y: 100 }, extent: { w: 20, h: 8 } };
const candy = { id: "ana/test-comets-77", by: "ana", kind: "sited", class: "candy", label: "test-comets", dropped: "act:77", at: { x: 1, y: 1 }, extent: { w: 1, h: 1 } };
const idea = { id: "ana/an-idea", by: "ana", kind: "sited", class: "idea", at: { x: 2, y: 2 }, extent: { w: 1, h: 1 } };

test("the new form changes the spelling only", () => {
  assert.deepEqual(neu(stool), { id: "keith/stool", by: "keith", kind: "thing", at: { x: 10, y: 10 }, extent: { w: 1, h: 1 } });
  assert.equal(neu(shed), shed, "a plain mark is the same in both forms");
});

test("world § placeMarksFrom: a thing is never ground, and a new-form thing is not ground either", () => {
  const verbs = { containmentChain: ({ x, y }, ground) => ground.filter((m) => m.at && x >= m.at.x - m.extent.w / 2 && x <= m.at.x + m.extent.w / 2 && y >= m.at.y - m.extent.h / 2 && y <= m.at.y + m.extent.h / 2) };
  const [a, b] = both([shed, stool], (ms) => placeMarksFrom(ms, { x: 10, y: 10 }, verbs).spine.map((m) => m.id));
  assert.deepEqual(a, ["keith/shed"]);
  assert.deepEqual(b, a);
  const [na, nb] = both([stool, { ...ferry, at: { x: 500, y: 500 } }], (ms) => placeMarksFrom(ms, { x: 400, y: 400 }, { containmentChain: () => [] }).near?.id ?? null);
  assert.equal(na, "the-town/the-ferry", "the nearest SITED mark: the vehicle, sited in both forms");
  assert.equal(nb, na);
});

test("world-journal § pathFor: a sited record files at its id in both forms", () => {
  assert.deepEqual(pathFor(neu(stool)), pathFor(stool));
  assert.ok(pathFor(neu(stool)), "the new-form thing is sited, so it takes the sited filing");
});

test("world-settlement § stanceReturnsWhole: positioned marks are the sited ones, in both forms", () => {
  const state = { returned: [{ state: "returned", subtree: ["keith/stool"] }] };
  const [a, b] = both([...CLASS_NODES, stool], (ms) => stanceReturnsWhole({ args: { marks: ms } }, state));
  assert.deepEqual(b, a);
});

test("carry-forecast: a rider is a sited mark under the mover, in both forms", () => {
  const prior = { ...shed }, next = { at: { x: 5, y: 0 } };
  const rider = { ...stool, placementParent: "keith/shed", household: "hh:keith" };
  const [a, b] = both([...CLASS_NODES, { ...shed, household: "hh:keith" }, rider],
    (ms) => carryForecast({ id: "keith/shed", prior, next, marks: ms })?.riders ?? null);
  assert.deepEqual(a, ["keith/stool"]);
  assert.deepEqual(b, a);
});

test("world-stacks § isDroppedUnitMark: a dropped unit is candy in both forms", () => {
  assert.equal(isDroppedUnitMark(candy), true);
  assert.equal(isDroppedUnitMark(neu(candy)), true);
  assert.equal(isDroppedUnitMark(neu(stool)), false);
});

test("world-apex § withinWithVehicles, world-movement § worldHasVehicle / vehicleWithin: the ferry is a vehicle in both forms", () => {
  for (const ms of [[ferry, stool], [ferry, stool].map(neu)]) {
    const byId = new Map(ms.map((m) => [m.id, m]));
    assert.deepEqual(withinWithVehicles([], ["the-town/the-ferry", "keith/stool"], (id) => byId.get(id)).map((m) => m.id), ["the-town/the-ferry"]);
    assert.equal(worldHasVehicle({ marks: ms }), true);
    assert.equal(vehicleWithin(["keith/stool", "the-town/the-ferry"], { marks: ms }), "the-town/the-ferry");
  }
  assert.equal(worldHasVehicle({ marks: [{ ...CLASS_NODES.find((c) => c.class === "vehicle") }] }), false, "the vehicle CLASS node is no vehicle");
});

test("world-crossings § portalEntryFor and § groundBlockOf: the vessel and the class node, in both forms", () => {
  const service = { vessel: "the-town/the-ferry", stops: [{ id: "the-town/the-quay" }] };
  // groundBlockOf names its class from a class node in either form (a `kind: class` node may name itself by its slug)
  const old = groundBlockOf({ classMark: { id: "the-town/arena", kind: "class", class: "arena", body: "x" }, lends: ["strike"] });
  const slugOnly = groundBlockOf({ classMark: { id: "the-town/arena", kind: "class", body: "x" }, lends: ["strike"] });
  assert.equal(old?.class, "arena");
  assert.equal(slugOnly?.class, "arena");
  assert.equal(classNodeNameOf({ id: "the-town/arena", kind: "class" }), "arena");
  for (const ms of [[ferry], [ferry].map(neu)]) {
    const r = portalEntryFor("the-town/the-quay", { marks: ms }, service);
    assert.equal(r === null || r?.vessel === "the-town/the-ferry", true);
  }
});

test("world-find § findMarks: a found mark reports its class in both forms, and the old form's plain and parcel marks as before", () => {
  const parcel = { id: "keith/plot", by: "keith", kind: "parcel", at: { x: 0, y: 0 }, body: "plot" };
  for (const ms of [[stool, shed, parcel], [stool, shed, parcel].map(neu)]) {
    const found = findMarks(ms.map((m) => ({ ...m, body: m.body ?? m.id })), "keith");
    const cls = Object.fromEntries((found.hits ?? []).map((m) => [m.id ?? m.mark, m.class]));
    assert.equal(cls["keith/stool"], "thing");
    assert.equal(cls["keith/shed"] ?? null, null);
    assert.equal(cls["keith/plot"] ?? null, null, "a parcel reports no class, as it never did");
  }
});

test("world-serve § pointAnswerable: a new-form thing is sited by the graph's own declarations", () => {
  const nodes = [...CLASS_NODES.map((c) => [c.id, { kind: "mark", props: { class: c.class, extends: c.extends, declares: true } }])];
  const graph = { forEachNode: (fn) => nodes.forEach(([id, a]) => fn(id, a)) };
  const geom = { rect: (m) => m, pointInRect: (x, y, m) => Math.abs(x - m.at.x) <= m.extent.w / 2 && Math.abs(y - m.at.y) <= m.extent.h / 2 };
  const twin = (m) => ({ ...m, extent: { w: 1, h: 1 }, at: { x: 10, y: 10 } });
  // two equal-extent sited marks at the point: a tie in both forms (each is sited)
  for (const ms of [[twin(stool), twin({ ...shed, id: "keith/box" })], [twin(stool), twin({ ...shed, id: "keith/box" })].map(neu)])
    assert.equal(pointAnswerable({ irregular: [], marks: ms, graph }, { x: 10, y: 10 }, geom), "equal-extent-tie");
});

test("the hydrator's resolver (world-grants § classFieldOf): the store's class prop, in both forms", () => {
  for (const m of [stool, ferry, candy, idea]) assert.equal(classFieldOf(neu(m)), classFieldOf(m), m.id);
  assert.equal(classFieldOf(shed), null);
  assert.equal(classFieldOf({ kind: "parcel" }), null, "a parcel projects no class, as it never did");
  assert.equal(classFieldOf({ kind: "naming", value: "x" }), null);
  assert.equal(classFieldOf({ id: "the-town/thing", kind: "class", class: "thing" }), "thing");
  assert.equal(classFieldOf({ id: "the-town/thing", kind: "class" }), "thing", "a class node named by its slug");
});
