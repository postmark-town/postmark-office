// world-stacks.test.mjs — WLD-27: the counted holding's pure core.
//
// Rows in, answers out (src/world-stacks.mjs): the fold of unit acts, the
// label selection, capacity, refill, the first-stock plan, the carry cap, the
// nearest-common-class display, the taken-class hook and the exit returns.
// Every label here is SYNTHETIC — never the town's real assignments.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  UNIT_ACTION, foldUnits, edgesOf, totalOf, stockedChests, exitedMarks, unitCount,
  candyLabels, labelOfCreator, labelRecord, capacityOf, chestDials, portableOf, welcomeOf,
  ancestry, nearestCommonClass, holdingDisplay, selectLabel, carryLoad, refuseOverCarry,
  takenRefusal, planGive, planTake, planConsume, planRefill, planChestStock,
  droppedUnitMark, isDroppedUnitMark, returnsAtExit, returnLine, isUnitRow,
} from "../src/world-stacks.mjs";

const EXTENDS = { candy: "consumable", consumable: "thing", thing: "mark", chest: "thing", mark: "postmark-node", "postmark-node": null, toaster: "thing" };
const extendsOf = (c) => EXTENDS[c] ?? null;
const LABELS = candyLabels({ labels: [
  { label: "test-comets", name: "Test Comets", creator: "sbx-ana" },
  { label: "test-drops", name: "Test Drops", creator: "sbx-bo" },
] });
const CHEST = "sbx-ana/the-bowl";
let seq = 0;
const act = (action, moves, extra = {}) => ({ id: ++seq, class: "holding", action, object: extra.object ?? null, payload: { moves } });
const stock = (chest, label, n) => act(UNIT_ACTION.stock, [{ from: null, to: chest, label, n }], { object: chest });

test("the brief's path: stocked 30, a second resident takes 3, consumes 1 — 27 / 2", () => {
  const rows = [stock(CHEST, "test-comets", 30)];
  let fold = foldUnits(rows);
  assert.equal(totalOf(fold, CHEST), 30);
  const take = planTake({ fold, actor: "sbx-cy", from: CHEST, label: null, n: 3 });
  rows.push(act(take.action, take.moves, { object: take.object }));
  fold = foldUnits(rows);
  assert.deepEqual([totalOf(fold, CHEST), totalOf(fold, "sbx-cy")], [27, 3]);
  const eat = planConsume({ fold, actor: "sbx-cy", label: null, classOfLabel: () => "candy", extendsOf });
  assert.deepEqual(eat.returns, [], "a held unit carries no stakes");
  assert.match(eat.returns_note, /returns nothing/);
  rows.push(act(eat.action, eat.moves));
  fold = foldUnits(rows);
  assert.deepEqual([totalOf(fold, CHEST), totalOf(fold, "sbx-cy")], [27, 2]);
  assert.deepEqual(fold.anomalies, []);
});

test("amounts: invalid, negative, fractional and zero counts refuse; omitted is one", () => {
  assert.equal(unitCount(undefined), 1);
  assert.equal(unitCount(3), 3);
  assert.equal(unitCount("4"), 4);
  for (const bad of [0, -1, 1.5, "1.5", "x", NaN, Infinity, "", true, {}])
    assert.throws(() => unitCount(bad), (e) => e.code === 422, `count ${JSON.stringify(bad)} must refuse`);
});

test("overdraw refuses without a partial debit, and the fold never goes below zero", () => {
  const rows = [stock(CHEST, "test-comets", 2)];
  const fold = foldUnits(rows);
  assert.throws(() => planTake({ fold, actor: "sbx-cy", from: CHEST, label: "test-comets", n: 3 }), (e) => e.code === 409 && /holds 2 test-comets, not 3/.test(e.defect));
  assert.equal(totalOf(foldUnits(rows), CHEST), 2, "nothing moved");
  // A record the doors would never write (two takers over-drawing) is named, not applied.
  const over = [...rows, act(UNIT_ACTION.take, [{ from: CHEST, to: "sbx-cy", label: "test-comets", n: 2 }]), act(UNIT_ACTION.take, [{ from: CHEST, to: "sbx-dee", label: "test-comets", n: 2 }])];
  const f2 = foldUnits(over);
  assert.equal(totalOf(f2, CHEST), 0);
  assert.equal(totalOf(f2, "sbx-dee"), 0, "no candy is invented by an over-draw");
  assert.equal(f2.anomalies.length, 1);
});

test("mixed holdings keep one edge per label; omission refuses listing labels and counts; naming moves just that label", () => {
  const rows = [stock(CHEST, "test-comets", 5)];
  rows.push(act(UNIT_ACTION.refill, [{ from: null, to: CHEST, label: "test-drops", n: 2 }]));
  const fold = foldUnits(rows);
  assert.deepEqual(edgesOf(fold, CHEST), [{ label: "test-comets", count: 5 }, { label: "test-drops", count: 2 }]);
  const before = JSON.stringify(edgesOf(fold, CHEST));
  assert.throws(() => planTake({ fold, actor: "sbx-cy", from: CHEST, label: undefined, n: 1 }),
    (e) => e.code === 409 && /name a label/.test(e.defect) && /5 test-comets, 2 test-drops/.test(e.hint) && e.holds.length === 2);
  assert.equal(JSON.stringify(edgesOf(foldUnits(rows), CHEST)), before, "a refused omission mutates nothing");
  assert.throws(() => planTake({ fold, actor: "sbx-cy", from: CHEST, label: "nope", n: 1 }), (e) => /no nope/.test(e.defect));
  const t = planTake({ fold, actor: "sbx-cy", from: CHEST, label: "test-drops", n: 2 });
  assert.deepEqual(t.moves, [{ from: CHEST, to: "sbx-cy", label: "test-drops", n: 2 }]);
  assert.throws(() => planConsume({ fold, actor: "sbx-cy", from: CHEST, label: undefined, classOfLabel: () => "candy", extendsOf }), /name a label/);
});

test("display: the nearest common class and summed count, components kept whole", () => {
  const one = holdingDisplay([{ class: "candy", label: "test-comets", name: "Pocket Comets", count: 18 }], extendsOf);
  assert.equal(one.text, "Pocket Comets: 18");
  const mixed = holdingDisplay([{ class: "candy", label: "glowdrops", count: 100 }, { class: "candy", label: "pocket-comets", count: 1 }], extendsOf);
  assert.deepEqual([mixed.text, mixed.class, mixed.count, mixed.components.length], ["101 candies", "candy", 101, 2]);
  const toaster = holdingDisplay([...mixed.components, { class: "toaster", count: 1 }], extendsOf);
  assert.deepEqual([toaster.text, toaster.class, toaster.components.length], ["102 things", "thing", 3]);
  // the unrelated-class control: a chest and candy share only `thing`; nothing shares with a stranger
  assert.equal(nearestCommonClass(["candy", "chest"], extendsOf), "thing");
  assert.equal(nearestCommonClass(["candy", "weather"], extendsOf), null);
  assert.deepEqual(ancestry("candy", extendsOf), ["candy", "consumable", "thing", "mark", "postmark-node"]);
  assert.equal(holdingDisplay([], extendsOf).text, "empty");
});

test("labels: read both ways from the candy class record; malformed entries are not labels", () => {
  assert.equal(labelOfCreator(LABELS, "sbx-ana").label, "test-comets");
  assert.equal(labelRecord(LABELS, "test-drops").creator, "sbx-bo");
  assert.equal(labelOfCreator(LABELS, "sbx-nobody"), null);
  assert.deepEqual(candyLabels({ labels: [{ label: "x" }, null, { label: "y", creator: "z" }] }), [{ label: "y", name: "y", creator: "z" }]);
  assert.deepEqual(candyLabels({ labels: JSON.stringify([{ label: "s", name: "S", creator: "c" }]) }), [{ label: "s", name: "S", creator: "c" }]);
  assert.deepEqual(candyLabels({}), []);
});

test("capacity: default 30, 1..120, every other value refused", () => {
  const dials = { capacity: 30, capacity_min: 1, capacity_max: 120, first_stock: 30, portable: true, welcome: "open" };
  assert.equal(capacityOf({}, dials), 30);
  for (const c of [1, 20, 30, 60, 120]) assert.equal(capacityOf({ capacity: c }, dials), c);
  for (const bad of [0, 121, -5, 2.5, "lots"]) assert.throws(() => capacityOf({ capacity: bad }, dials), (e) => e.code === 422);
  assert.equal(chestDials({}).capacity, 30, "the class default stands in only for an absent record");
  assert.equal(portableOf({ portable: false }, dials), false);
  assert.equal(portableOf({}, dials), true);
  assert.equal(welcomeOf({}, dials), "open");
});

test("first stock: min(30, capacity) once; unlabelled makers admitted unstocked and named; later registration stocks once", () => {
  const dials = { capacity: 30, capacity_min: 1, capacity_max: 120, first_stock: 30 };
  const chests = [1, 20, 30, 60, 120].map((c) => ({ id: `sbx-ana/c${c}`, by: "sbx-ana", capacity: c })).concat([{ id: "sbx-ana/plain", by: "sbx-ana" }]);
  const plan = planChestStock({ chests, labels: LABELS, dials });
  assert.deepEqual(plan.stock.map((s) => [s.chest, s.n]), [["sbx-ana/c1", 1], ["sbx-ana/c20", 20], ["sbx-ana/c30", 30], ["sbx-ana/c60", 30], ["sbx-ana/c120", 30], ["sbx-ana/plain", 30]]);
  assert.ok(plan.stock.every((s) => s.label === "test-comets"));
  // replay: the record shows the stock acts, so nothing is planned again
  const rows = plan.stock.map((s) => stock(s.chest, s.label, s.n));
  assert.deepEqual(planChestStock({ chests, labels: LABELS, dials, stocked: stockedChests(rows) }).stock, []);
  // unlabelled: admitted unstocked, the receipt line named, not counted as stocked
  const lone = [{ id: "sbx-eve/her-chest", by: "sbx-eve" }];
  const p1 = planChestStock({ chests: lone, labels: LABELS, dials });
  assert.deepEqual(p1.stock, []);
  assert.deepEqual(p1.unstocked.map((u) => u.line), ["chest-unstocked: sbx-eve has no candy label"]);
  assert.equal(stockedChests([]).has("sbx-eve/her-chest"), false);
  // registered later: the next settlement stocks it, exactly once, keeping what was given in
  const later = [...LABELS, { label: "test-eves", name: "Eves", creator: "sbx-eve" }];
  const given = foldUnits([act(UNIT_ACTION.give, [{ from: null, to: "sbx-eve/her-chest", label: "test-drops", n: 4 }])]);
  const p2 = planChestStock({ chests: [{ ...lone[0], capacity: 20 }], labels: later, dials, fold: given });
  assert.deepEqual(p2.stock.map((s) => [s.label, s.n]), [["test-eves", 16]], "fills toward min(30, capacity) without overfilling what is already there");
  assert.deepEqual(planChestStock({ chests: lone, labels: later, dials, stocked: new Set(["sbx-eve/her-chest"]) }).stock, []);
  // a capacity out of range is named and not stocked
  assert.match(planChestStock({ chests: [{ id: "sbx-ana/huge", by: "sbx-ana", capacity: 500 }], labels: LABELS, dials }).refused[0].line, /outside 1\.\.120/);
});

test("refill: the chest's maker who created the label (F2), exactly the remaining room (every label counted), full is a no-op", () => {
  const rows = [stock(CHEST, "test-comets", 30), act(UNIT_ACTION.take, [{ from: CHEST, to: "sbx-cy", label: "test-comets", n: 7 }])];
  let fold = foldUnits(rows);
  const r = planRefill({ fold, actor: "sbx-ana", chest: CHEST, capacity: 30, labels: LABELS, maker: "sbx-ana" });
  assert.deepEqual(r.moves, [{ from: null, to: CHEST, label: "test-comets", n: 7 }]);
  assert.throws(() => planRefill({ fold, actor: "sbx-cy", chest: CHEST, capacity: 30, labels: LABELS, maker: "sbx-ana" }), (e) => e.code === 403 && /sbx-cy did not make/.test(e.defect));
  assert.throws(() => planRefill({ fold, actor: "sbx-bo", chest: CHEST, capacity: 30, labels: LABELS, maker: "sbx-ana" }), (e) => e.code === 403 && /sbx-bo did not make/.test(e.defect), "a label of one's own does not open another's chest");
  rows.push(act(r.action, r.moves, { object: CHEST }));
  fold = foldUnits(rows);
  const again = planRefill({ fold, actor: "sbx-ana", chest: CHEST, capacity: 30, labels: LABELS, maker: "sbx-ana" });
  assert.equal(again.noop, true, "a full chest refills nothing");
  // mixed contents count toward the one capacity
  const mixed = foldUnits([stock(CHEST, "test-comets", 10), act(UNIT_ACTION.give, [{ from: null, to: CHEST, label: "test-drops", n: 15 }])]);
  assert.equal(planRefill({ fold: mixed, actor: "sbx-ana", chest: CHEST, capacity: 30, labels: LABELS, maker: "sbx-ana" }).moves[0].n, 5);
});

test("give into a chest respects its capacity; give to yourself and from empty hands refuse", () => {
  const rows = [stock(CHEST, "test-comets", 28), act(UNIT_ACTION.take, [{ from: CHEST, to: "sbx-cy", label: "test-comets", n: 5 }])];
  const fold = foldUnits(rows);
  assert.throws(() => planGive({ fold, actor: "sbx-cy", to: CHEST, label: null, n: 5, capacityOfTo: 25 }), (e) => e.code === 409 && /room for 2/.test(e.defect));
  assert.deepEqual(planGive({ fold, actor: "sbx-cy", to: CHEST, label: null, n: 2, capacityOfTo: 25 }).moves, [{ from: "sbx-cy", to: CHEST, label: "test-comets", n: 2 }]);
  assert.throws(() => planGive({ fold, actor: "sbx-cy", to: "sbx-cy", label: null, n: 1 }), /already holding/);
  assert.throws(() => planGive({ fold, actor: "sbx-nobody", to: "sbx-cy", label: null, n: 1 }), /holds nothing/);
});

test("consume: consumables only — a toaster or a plain thing label refuses", () => {
  const fold = foldUnits([act(UNIT_ACTION.give, [{ from: null, to: "sbx-cy", label: "a-toaster", n: 1 }])]);
  assert.throws(() => planConsume({ fold, actor: "sbx-cy", label: "a-toaster", classOfLabel: () => "thing", extendsOf }), (e) => e.code === 422 && /not a consumable/.test(e.defect));
  assert.throws(() => planConsume({ fold, actor: "sbx-cy", label: "a-toaster", classOfLabel: () => null, extendsOf }), /not a consumable/);
});

test("carry: 24 fits, the 25th refuses; a chest held whole is one slot", () => {
  assert.deepEqual(refuseOverCarry({ who: "sbx-cy", units: 23, things: 0, adding: 1, cap: 24 }), { carried: 24, cap: 24 });
  assert.throws(() => refuseOverCarry({ who: "sbx-cy", units: 24, things: 0, adding: 1, cap: 24 }), (e) => e.code === 409 && /24 of 24/.test(e.defect));
  assert.throws(() => refuseOverCarry({ who: "sbx-cy", units: 20, things: 0, adding: 5, cap: 24 }), (e) => /4 more fit/.test(e.hint));
  assert.equal(carryLoad({ units: 23, things: 1 }), 24, "a portable chest of 30 is ONE slot");
  assert.equal(refuseOverCarry({ who: "x", units: 99, things: 0, adding: 1, cap: undefined }), null, "no cap on the record: nothing enforced here, and the door says so");
});

test("the taken-class hook: inactive with no taken class; a taken candy refuses with its clue; restored, it allows; non-candy unaffected", () => {
  const records = { candy: { dials: {} }, consumable: { dials: {} }, thing: { dials: {} } };
  const rec = (c) => records[c] ?? null;
  assert.equal(takenRefusal("candy", rec, extendsOf), null);
  records.candy = { dials: { taken: true, clue: "Someone has been in the sweet jars; follow the wrappers." } };
  const r = takenRefusal("candy", rec, extendsOf);
  assert.equal(r.code, 423);
  assert.equal(r.defect, "Someone has been in the sweet jars; follow the wrappers.");
  assert.equal(takenRefusal("thing", rec, extendsOf), null, "a toaster or a mixed-with-things holding is not candy");
  assert.equal(takenRefusal("chest", rec, extendsOf), null);
  records.candy = { dials: { taken: false } };
  assert.equal(takenRefusal("candy", rec, extendsOf), null, "restoring the flag allows it again");
});

test("the dropped unit's mark: sited candy, its label, its drop act, one stamp", () => {
  const m = droppedUnitMark({ actor: "sbx-cy", label: "test-comets", name: "Test Comets", actId: 77, at: { x: 10, y: -4 } });
  assert.deepEqual({ by: m.by, slug: m.slug, kind: m.kind, class: m.class, label: m.label, dropped: m.dropped, stamps: m.stamps, at: m.at },
    { by: "sbx-cy", slug: "test-comets-77", kind: "sited", class: "candy", label: "test-comets", dropped: "act:77", stamps: 1, at: { x: 10, y: -4 } });
  assert.equal(isDroppedUnitMark(m), true);
  assert.equal(isDroppedUnitMark({ ...m, dropped: undefined }), false);
  assert.throws(() => droppedUnitMark({ actor: "a", label: "l", actId: null, at: { x: 0, y: 0 } }));
});

test("exit returns: one per actual staker, the escrow included, and nothing once positions are closed", () => {
  const plan = returnsAtExit({ mark: "sbx-cy/test-comets-77", holders: [{ handle: "sbx-cy", stamps: 1 }, { handle: "sbx-ana", stamps: 3 }, { handle: "sbx-bo", stamps: 2 }, { handle: "sbx-ana", stamps: 1 }, { handle: "sbx-zed", stamps: 0 }] });
  assert.deepEqual(plan.map((p) => [p.handle, p.stamps]), [["sbx-ana", 4], ["sbx-bo", 2], ["sbx-cy", 1]]);
  assert.deepEqual(returnsAtExit({ mark: "m", holders: [] }), [], "a retry after the returns plans nothing");
  assert.equal(returnLine({ date: "2026-10-13", mark: "sbx-cy/test-comets-77", handle: "sbx-bo", stamps: 2, why: "unit-taken-back" }),
    "- 2026-10-13 · sbx-bo ← stake:world-mark/sbx-cy/test-comets-77 · 2 · for: unit-taken-back");
});

test("unit acts are holding acts the thing-holder fold never reads", () => {
  assert.equal(isUnitRow({ class: "holding", action: "units:take" }), true);
  assert.equal(isUnitRow({ class: "holding", action: "take" }), false);
  assert.deepEqual([...exitedMarks([{ class: "holding", action: UNIT_ACTION.takeBack, object: "a/b" }])], ["a/b"]);
});
