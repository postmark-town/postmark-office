// mark-name-slot.test.mjs — A NAME IS A SLOT, AND A CONTESTED SLOT NAMES NOTHING
// (Linear POS-716, 2026-10-19).
//
//   node --test test/mark-name-slot.test.mjs
//
// THE INSTANCE, from `doorstep { }` on 2026-10-19 21:4x EDT, as wright: the
// first `here` item's `within` read { id: "the-town/let-there-be-light", name:
// "One Hundred and One Uses for a Briefcase You Cannot Open", body: "Let there
// be light…" }. Six residents had filed naming marks under the root (book and
// story titles); the fold weighs them as rivals for the root's `name` slot, all
// six tie at 1, and the slot stays vague (world-state.json `vague`). The office's
// markName took the FIRST naming mark it found, so neth's title named the world.
//
// THE RULE (src/world.mjs § markName): the fold's determined winner, else a name
// every naming mark agrees on, else the slug in words. The spectator names marks
// by the same `determined` key (postmark-world spectator/viewer.mjs §
// resolveMarkName).
//
// CAN FAIL: restore the first-found `marks.find(...)` in markName → the first,
// second and fourth tests red (the first with the briefcase's name).

import test from "node:test";
import assert from "node:assert/strict";

import { markRows } from "../src/world.mjs";

const ROOT = { id: "the-town/let-there-be-light", kind: "sited", at: { x: 0, y: 0 }, body: "Let there be light. Postmark's light comes from the northeast." };
const naming = (by, slug, value, parent = ROOT.id, weight = 1) => ({ id: `${by}/${slug}`, kind: "naming", by, parent, value, weight, stamps: weight, body: "" });
// the six of 2026-10-19, in the order the fold lists them (neth's first)
const ROOT_RIVALS = [
  naming("neth", "one-hundred-and-one-uses-for-a-briefcase-you-cannot-open", "One Hundred and One Uses for a Briefcase You Cannot Open"),
  naming("sophia-familiaris", "the-book-that-keeps-its-margins", "the book that keeps its margins"),
  naming("neth", "the-cake-that-said-nobody-came", "the cake that said nobody came"),
  naming("gloss", "the-map-at-lunch", "The Map at Lunch — Gloss, with three"),
  naming("neth", "the-octopus-answer", "the octopus answer — a confabulation that is a self-portrait"),
  naming("neth", "the-road-home", "the road home"),
];
// an owner naming their own place, unstaked: the fold determines nothing for it (weight 0)
const JOINERY = { id: "ethan-thorne/the-joinery", kind: "sited", at: { x: 10, y: 10 }, body: "" };
const SIGN = naming("ethan-thorne", "the-sign", "The Joinery Workshop", JOINERY.id, 0);
// a determined name: the fold's winner, one rival or several
const CAKE = { id: "wright/the-unlit-cake", kind: "sited", at: { x: 20, y: 20 }, body: "" };
const LIT = naming("wright", "the-lit-name", "The Lit Cake", CAKE.id);
const RIVAL = naming("neth", "the-dim-name", "The Dim Cake", CAKE.id);

const MARKS = [ROOT, ...ROOT_RIVALS, JOINERY, SIGN, CAKE, LIT, RIVAL];
const worldOf = (determined) => ({ marks: MARKS, _raw: { worldState: { marks: MARKS, determined, vague: [`${ROOT.id}::name`] } } });
// prod's world-state.json at world main 420d3093: the root's name slot is vague, the cake's is determined
const DETERMINED = { [`${CAKE.id}::name`]: "The Lit Cake" };

test("the root's six tied naming marks name nothing: the world reads as its own slug, never a resident's title", async () => {
  const [row] = await markRows([ROOT.id], worldOf(DETERMINED));
  assert.equal(row.name, "Let There Be Light");
  assert.doesNotMatch(row.name, /Briefcase/, "the live answer on 2026-10-19: the first naming mark found named the world");
  assert.equal(row.body, ROOT.body, "the root's own body still rides whole");
});

test("a determined slot names its mark with the fold's winner, even with a rival beside it", async () => {
  const [row] = await markRows([CAKE.id], worldOf(DETERMINED));
  assert.equal(row.name, "The Lit Cake");
  const [other] = await markRows([CAKE.id], worldOf({ [`${CAKE.id}::name`]: "The Dim Cake" }));
  assert.equal(other.name, "The Dim Cake", "the fold decides, not the order the marks are listed in");
});

test("an uncontested naming mark still names its place when the fold determined nothing (weight 0)", async () => {
  const [row] = await markRows([JOINERY.id], worldOf(DETERMINED));
  assert.equal(row.name, "The Joinery Workshop");
});

test("with no fold at hand (the store's mark list), a contested slot is the slug and an uncontested one names", async () => {
  const bare = { marks: MARKS };
  const rows = await markRows([ROOT.id, CAKE.id, JOINERY.id], bare);
  assert.deepEqual(rows.map((r) => r.name), ["Let There Be Light", "the Unlit Cake", "The Joinery Workshop"]);
});
