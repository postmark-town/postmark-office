// carry-forecast.test.mjs — WHAT A MOVE WILL CARRY, said at the door (POS-441).
//
//   node --test test/carry-forecast.test.mjs
//
// The door no longer refuses a move of a mark with something inside it (the
// move guard is retired). It forecasts the carry from the World it serves —
// the fold's own `placementParent` and the frozen filing — and labels it a
// forecast; the clearing decides (world2/tools/carry.mjs).

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { carryForecast } from "../src/carry-forecast.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const mark = (id, kind, at, placementParent, declared_household) => ({ id, kind, at, extent: { w: 1, h: 1 }, placementParent, declared_household });

const SERVED = [
  mark("rei/the-parcel", "parcel", { x: 1000, y: 1000 }, null, "hh:starforge"),
  mark("rei/the-house", "sited", { x: 1000, y: 1000 }, "rei/the-parcel", "hh:starforge"),
  mark("wright/the-bench", "sited", { x: 1008, y: 1008 }, "rei/the-house", "hh:starforge"),
  mark("little-bird/the-spork", "sited", { x: 995, y: 995 }, "rei/the-parcel", "hh:foundoutanyway"),
  mark("rei/the-lamp", "sited", { x: 1100, y: 1100 }, null, "hh:starforge"),
  { id: "rei/a-name", kind: "predicated", placementParent: "rei/the-parcel", declared_household: "hh:starforge" },
];

test("the forecast names who rides and who stays, in the future tense, and says the clearing decides", () => {
  const f = carryForecast({
    id: "rei/the-parcel", prior: { at: { x: 1000, y: 1000 } }, next: { at: { x: 1100, y: 960 } }, marks: SERVED,
    filedParentOf: (id) => (id === "rei/the-lamp" ? "rei/the-house" : null),
  });
  assert.equal(f.forecast, true);
  assert.deepEqual([f.dx, f.dy, f.moves, f.stays], [100, -40, 3, 1]);
  assert.deepEqual(f.riders, ["rei/the-house", "wright/the-bench", "rei/the-lamp"], "by ground (the bench in the house), and by filing (the lamp)");
  assert.deepEqual(f.stayed, [{ slug: "little-bird/the-spork", household: "hh:foundoutanyway" }]);
  assert.equal(f.sentence, "moves rei/the-parcel and 3 marks of your household's; 1 mark of other households stays where it is (hh:foundoutanyway ×1) — at the next crossing");
  assert.match(f.decided, /the clearing decides/);
});

test("nothing to forecast for words, and none for a mark nothing stands in — and never a refusal", () => {
  assert.equal(carryForecast({ id: "rei/the-parcel", prior: { at: { x: 1000, y: 1000 } }, next: { body: "new words" }, marks: SERVED }), null);
  const f = carryForecast({ id: "little-bird/the-spork", prior: { at: { x: 995, y: 995 } }, next: { at: { x: 0, y: 0 } }, marks: SERVED });
  assert.deepEqual([f.moves, f.stays], [0, 0]);
});

test("THE DOOR: the move guard is gone from the amend branch, and the answer carries the forecast", () => {
  const src = readFileSync(join(ROOT, "src", "world.mjs"), "utf8");
  assert.doesNotMatch(src, /moveGuard\(|world-move-guard/, "the blanket refusal is retired (POS-441)");
  const arm = src.slice(src.indexOf("async function journalLeaveMark"), src.indexOf("async function journalLeaveMark") + 30000);
  assert.match(arm, /carries = carryForecast\(/, "the amend branch forecasts the carry");
  assert.equal((arm.match(/\.\.\.\(carries \? \{ carries \} : \{\}\)/g) ?? []).length, 2, "both answers — the preview and the write — say it");
});
