// store-writedown-parent.test.mjs — A NESTED MARK FILES UNDER ITS PARENT (S93).
//
// The keeper refused S93 (2026-10-03 18:00Z) because Jiang Haijing's naming
// mark, `jiang-haijing/call-it-fengtian-lou`, was written at the world root
// (WORLD/marks/let-there-be-light/call-it-fengtian-lou/) instead of under her
// parcel. `planStoreWriteDown` called `pathFor` with canon's filing only, never
// with a parent lookup, so every naming mark (and every other kind that is
// neither sited nor a parcel) with a `parent_id` took the root fallback. The
// parcel and its name arrived in the same crossing, so the parent was not in
// canon either: the plan has to answer from its own batch first.
//
// Pure: the plan only, no git, no store.

import test from "node:test";
import assert from "node:assert/strict";
import { planStoreWriteDown } from "../src/store-writedown.mjs";

const mark = (id, kind, fileRec = {}) => {
  const [by, ...rest] = id.split("/");
  return {
    id, by, slug: rest.join("/"), household: by, kind, plannedPath: null, locked_window: 228,
    fileRec: { kind, by, date: "2026-10-03", ...fileRec },
    bytes: null,
  };
};
const pathsOf = (plan) => Object.fromEntries(plan.households.flatMap((h) => h.upserts.map((u) => [u.id, u.path])));

test("S93 · a parcel and its name in the same crossing: the name files under the parcel", () => {
  const plan = planStoreWriteDown([
    mark("jiang-haijing/fengtian-lou", "parcel", { points: [[0, 0], [10, 0], [10, 10], [0, 10]] }),
    mark("jiang-haijing/call-it-fengtian-lou", "naming", { parent_id: "jiang-haijing/fengtian-lou", slot: "name", value: "奉天楼" }),
  ]);
  const p = pathsOf(plan);
  assert.equal(p["jiang-haijing/fengtian-lou"], "WORLD/marks/jiang-haijing/fengtian-lou/mark.md");
  assert.equal(p["jiang-haijing/call-it-fengtian-lou"],
    "WORLD/marks/jiang-haijing/fengtian-lou/call-it-fengtian-lou/mark.md",
    "the name goes where its parcel is filed, never to the world root");
});

test("S93 · the order of the batch doesn't matter: the name before its parcel files the same", () => {
  const plan = planStoreWriteDown([
    mark("jiang-haijing/call-it-fengtian-lou", "naming", { parent_id: "jiang-haijing/fengtian-lou" }),
    mark("jiang-haijing/fengtian-lou", "parcel", { points: [[0, 0], [10, 0], [10, 10], [0, 10]] }),
  ]);
  assert.equal(pathsOf(plan)["jiang-haijing/call-it-fengtian-lou"],
    "WORLD/marks/jiang-haijing/fengtian-lou/call-it-fengtian-lou/mark.md");
});

test("S93 · a parent canon already files: the name files under canon's directory for it", () => {
  const canon = { "alpha/old-house": "WORLD/marks/let-there-be-light/the-town-centre/old-house/mark.md" };
  const plan = planStoreWriteDown([
    mark("alpha/call-it-the-old-house", "naming", { parent_id: "alpha/old-house" }),
  ], { publishedPathOf: (id) => canon[id] ?? null });
  assert.equal(pathsOf(plan)["alpha/call-it-the-old-house"],
    "WORLD/marks/let-there-be-light/the-town-centre/old-house/call-it-the-old-house/mark.md");
});

test("S93 · a chain: a name on a sited mark inside a new parcel files two deep", () => {
  const plan = planStoreWriteDown([
    mark("beta/garden", "parcel", { points: [[0, 0], [20, 0], [20, 20], [0, 20]] }),
    mark("beta/shed", "sited", { parent_id: "beta/garden" }),
    mark("beta/call-it-the-shed", "naming", { parent_id: "beta/shed" }),
  ]);
  // a sited mark files at its own id (Gate B), so the name follows the shed there
  assert.equal(pathsOf(plan)["beta/call-it-the-shed"], "WORLD/marks/beta/shed/call-it-the-shed/mark.md");
});

test("S93 / POS-1212 · a declared parent we cannot find is HELD BY NAME at write planning; a mark with no parent files at its maker's id", () => {
  const plan = planStoreWriteDown([
    mark("gamma/call-it-nowhere", "naming", { parent_id: "gamma/missing" }),
    mark("gamma/a-name-alone", "naming", {}),
  ], { publishedPathOf: () => null });
  const p = pathsOf(plan);
  assert.equal(p["gamma/call-it-nowhere"], undefined, "it declared a parent: filing it at the root, or at its maker's id, would be a guess");
  assert.deepEqual(plan.held.map((h) => [h.id, h.crossing_output, h.declared_parent]), [["gamma/call-it-nowhere", "parent-unresolved", "gamma/missing"]]);
  assert.equal(p["gamma/a-name-alone"], "WORLD/marks/gamma/a-name-alone/mark.md", "no parent: the maker's id, whatever its kind; the root fallback is gone");
});

test("S93 / POS-1212 · a parent_id cycle is held by name instead of looping", () => {
  const plan = planStoreWriteDown([
    mark("delta/a", "naming", { parent_id: "delta/b" }),
    mark("delta/b", "naming", { parent_id: "delta/a" }),
  ]);
  assert.deepEqual(Object.keys(pathsOf(plan)), [], "neither files, neither hangs");
  assert.deepEqual(plan.held.map((h) => h.crossing_output).sort(), ["parent-unresolved", "parent-unresolved"]);
});
