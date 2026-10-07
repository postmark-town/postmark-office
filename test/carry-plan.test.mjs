// carry-plan.test.mjs — MOVING A MARK CARRIES YOUR HOUSEHOLD'S MARKS; OTHER
// HOUSEHOLDS' MARKS NEVER MOVE (POS-441, ruled by Darko 2026-10-07: "That
// should just always be the default rule"). The plan, pure: rows in, riders out.
//
//   node --test test/carry-plan.test.mjs
//
// The fixture is Rei's Lanternstep in miniature: her parcel, her house on it
// (filed inside it, the 08-25 directory edge), Wright's bench by the door (one
// household with Rei: hh:starforge, under another spelling), a lamp of Rei's
// filed in the house but standing outside it, little-bird's spork and the town's
// lantern on the parcel. Then postmark#2458: vermillion's tower landed over
// Wright's benches, and moving it away must take nothing of Wright's along.

import test from "node:test";
import assert from "node:assert/strict";
import { carryPlan, carrySentence, moveOf, translated } from "../world2/tools/carry.mjs";
import { geometryMoved } from "../src/mark-declared-parent.mjs";

const row = (slug, kind, owner, household, at, extent, data = {}) => ({
  id: `uuid-${slug}`, slug, kind, owner, household, body: slug, parent: null,
  geometry: { at, extent }, data,
});
const ROOT = row("the-town/let-there-be-light", "sited", "the-town", "solo:the-town", { x: 0, y: 0 }, { w: 320000, h: 320000 });

function lanternstep() {
  return [
    ROOT,
    row("rei/the-lanternstep-house-parcel", "parcel", "rei", "hh:starforge", { x: 1000, y: 1000 }, { w: 25, h: 25 }),
    row("rei/the-lanternstep-house", "sited", "rei", "hh:starforge", { x: 1000, y: 1000 }, { w: 10, h: 10 }, { _parentMarkId: "rei/the-lanternstep-house-parcel" }),
    row("wright/the-bench", "sited", "wright", "gh:12345", { x: 1008, y: 1008 }, { w: 2, h: 1 }),
    row("rei/the-lamp-out-back", "sited", "rei", "hh:starforge", { x: 1100, y: 1100 }, { w: 1, h: 1 }, { _parentMarkId: "rei/the-lanternstep-house" }),
    row("little-bird/the-spork", "sited", "little-bird", "hh:foundoutanyway", { x: 995, y: 995 }, { w: 1, h: 1 }),
    row("the-town/the-wick-end", "sited", "the-town", "solo:the-town", { x: 1005, y: 995 }, { w: 1, h: 1 }),
    row("rei/the-name-plate", "predicated", "rei", "hh:starforge", null, null, { _parentMarkId: "rei/the-lanternstep-house" }),
  ];
}
// two spellings, one house: the store's own resolver folds gh:12345 into hh:starforge
const houseOf = (cred) => (cred === "gh:12345" ? "hh:starforge" : cred);
const moveParcel = (dx, dy) => [{ claimId: "c-move", slug: "rei/the-lanternstep-house-parcel", next: { at: { x: 1000 + dx, y: 1000 + dy }, extent: { w: 25, h: 25 } } }];

test("THE RULING: the parcel's household's marks ride, by ground or by filing, and keep their place relative to it; other households' marks stay", () => {
  const plan = carryPlan({ rows: lanternstep(), movers: moveParcel(100, -40), houseOf }).get("c-move");
  assert.equal(plan.dx, 100); assert.equal(plan.dy, -40);
  assert.deepEqual(plan.riders.map((r) => [r.slug, r.to]), [
    ["rei/the-lamp-out-back", { x: 1200, y: 1060 }],
    ["rei/the-lanternstep-house", { x: 1100, y: 960 }],
    ["wright/the-bench", { x: 1108, y: 968 }],
  ], "the house (inside it), the bench (inside it, one household under another spelling) and the lamp (filed in the house, standing outside it) all ride");
  assert.deepEqual(plan.stayed, [
    { slug: "little-bird/the-spork", household: "hh:foundoutanyway" },
    { slug: "the-town/the-wick-end", household: "solo:the-town" },
  ], "another household's marks never move — the town counts as one (Q2)");
  assert.deepEqual(plan.stuck, []);
  assert.ok(!plan.riders.some((r) => r.slug === "rei/the-name-plate"), "a predicate has no ground: it follows its parent without a write");
  assert.equal(carrySentence(plan),
    "moved rei/the-lanternstep-house-parcel and 3 marks of your household's; 2 marks of other households stayed where they were (hh:foundoutanyway ×1, solo:the-town ×1)");
  assert.equal(carrySentence(plan, { tense: "future" }),
    "moves rei/the-lanternstep-house-parcel and 3 marks of your household's; 2 marks of other households stay where they are (hh:foundoutanyway ×1, solo:the-town ×1)");
});

test("THE FLIP: without the household resolver the bench is another household's and stays — a spelling compare is the wrong question", () => {
  const plan = carryPlan({ rows: lanternstep(), movers: moveParcel(100, -40) }).get("c-move");
  assert.ok(plan.stayed.some((s) => s.slug === "wright/the-bench"), "gh:12345 read as a different house");
  assert.ok(!plan.riders.some((r) => r.slug === "wright/the-bench"));
});

test("A CHAIN THROUGH ANOTHER HOUSEHOLD COUNTS (Q3): my mark in a neighbour's house on my parcel rides; the house stays", () => {
  const rows = [
    ROOT,
    row("rei/the-parcel", "parcel", "rei", "hh:starforge", { x: 0, y: 5000 }, { w: 25, h: 25 }),
    row("sable/the-guest-house", "sited", "sable", "hh:rabbit", { x: 0, y: 5000 }, { w: 10, h: 10 }),
    row("rei/the-teacup", "sited", "rei", "hh:starforge", { x: 1, y: 5001 }, { w: 1, h: 1 }),
  ];
  const plan = carryPlan({ rows, movers: [{ claimId: "c", slug: "rei/the-parcel", next: { at: { x: 50, y: 5000 }, extent: { w: 25, h: 25 } } }] }).get("c");
  assert.deepEqual(plan.riders.map((r) => r.slug), ["rei/the-teacup"]);
  assert.deepEqual(plan.stayed.map((s) => s.slug), ["sable/the-guest-house"]);
});

test("ALL OR NOTHING (Q4): a rider with its own claim waiting this window is named stuck, and so is one with no position", () => {
  const rows = lanternstep();
  rows.find((r) => r.slug === "rei/the-lamp-out-back").geometry = { extent: { w: 1, h: 1 } };
  const plan = carryPlan({ rows, movers: moveParcel(10, 0), houseOf, waiting: new Set(["rei/the-lanternstep-house"]) }).get("c-move");
  assert.deepEqual(plan.stuck, [
    { slug: "rei/the-lamp-out-back", why: "it carries no position to move" },
    { slug: "rei/the-lanternstep-house", why: "it has its own claim waiting in this window" },
  ], "the lamp is still filed in the house, so it would ride, and has no position to translate; the house has its own claim");
  assert.deepEqual(plan.riders.map((r) => r.slug), ["wright/the-bench"], "the plan still lists who could ride — the clearing refuses the whole move on any stuck rider");
});

test("WORDS ARE FREE, and so is a resize: nothing rides an amend whose position did not move", () => {
  assert.equal(carryPlan({ rows: lanternstep(), movers: moveParcel(0, 0), houseOf }).size, 0, "same at: no carry");
  assert.equal(moveOf({ at: { x: 1, y: 1 } }, { at: { x: 1, y: 1 }, extent: { w: 9, h: 9 } }), null, "an extent change carries nothing — containment follows the new geometry");
  assert.equal(moveOf({ at: { x: 1, y: 1 } }, { body: "new words" }), null, "an amend with no `at` says nothing about where");
  // the retired guard's own test, kept where it is still asked (mark-declared-parent.mjs)
  assert.equal(geometryMoved({ at: { x: 1, y: 1 } }, { at: { x: 2, y: 1 } }), "at");
  assert.equal(geometryMoved({ at: { x: 1, y: 1 }, extent: { w: 2, h: 2 } }, { at: { x: 1, y: 1 } }), null, "an amend that states no extent is not shrinking the mark");
});

test("translated: `at` and every ring point move by the offset, in either spelling; the extent is a size and never moves", () => {
  const g = translated({ at: { x: 10, y: 20 }, extent: { w: 4, h: 4 }, points: [[8, 18], { x: 12, y: 22 }], slug: "a/b" }, { dx: 5, dy: -5 });
  assert.deepEqual(g, { at: { x: 15, y: 15 }, extent: { w: 4, h: 4 }, points: [[13, 13], { x: 17, y: 17 }], slug: "a/b" });
});

test("postmark#2458: vermillion's tower, landed over Wright's benches, moves away FREELY — and the benches stay where they were", () => {
  const rows = [
    ROOT,
    row("vermillion/launching-tower", "sited", "vermillion", "hh:aurumsalamandra", { x: 0, y: 5.5 }, { w: 81.2, h: 81.2 }),
    row("wright/the-crossing-bench", "sited", "wright", "hh:starforge", { x: 33, y: 3.5 }, { w: 4, h: 1 }),
    row("wright/bench-wood", "sited", "wright", "hh:starforge", { x: 30, y: 3.5 }, { w: 1, h: 1 }),
  ];
  const plan = carryPlan({ rows, movers: [{ claimId: "t", slug: "vermillion/launching-tower", next: { at: { x: -95728.6, y: -96832.8 }, extent: { w: 81.2, h: 81.2 } } }] }).get("t");
  assert.deepEqual(plan.riders, [], "nothing of another household's rides");
  assert.deepEqual(plan.stayed.map((s) => s.slug), ["wright/bench-wood", "wright/the-crossing-bench"]);
  assert.deepEqual(plan.stuck, [], "and nothing refuses: the move guard's blanket refusal is gone");
});
