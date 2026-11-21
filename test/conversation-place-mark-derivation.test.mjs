// conversation-place-mark-derivation.test.mjs — POS-1152: the office's own derivation of "the mark a conversation started at"
// (world.mjs § placeMarkAt) against the REAL clone verbs: the innermost non-thing ground that is a real mark, and null for everything
// else — the world frame, a point on no ground, an unplaced speaker, a world that cannot be read. Names are synthetic.

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { NO_WORLD, worldClone } from "./fixture-paths.mjs";

const CLONE = worldClone();
const SKIP = !CLONE || !existsSync(join(CLONE, "tools")) ? NO_WORLD : false;
const { placeMarkAt } = await import("../src/world.mjs");

const ROOT = "the-town/let-there-be-light";
const marks = () => [
  { id: ROOT, kind: "sited", by: "the-town", at: { x: 0, y: 0 }, extent: { w: 100000, h: 100000 }, body: "The town." },
  { id: "quill/the-yard", kind: "sited", by: "quill", at: { x: 1000, y: 1000 }, extent: { w: 500, h: 400 }, body: "The open yard." },
  { id: "quill/the-porch", kind: "sited", by: "quill", at: { x: 880, y: 1000 }, extent: { w: 50, h: 50 }, body: "The porch." },
];
const world = { marks: marks() };

test("the innermost ground that is a real mark is the start: the porch inside no yard, the yard where only it stands", { skip: SKIP }, async () => {
  assert.equal(await placeMarkAt({ x: 1100, y: 1100 }, world), "quill/the-yard");
  assert.equal(await placeMarkAt({ x: 880, y: 1000 }, world), "quill/the-porch");
});

test("the world frame is no mark to picture: a point on the open town, an unplaced speaker and a world that cannot be read answer null", { skip: SKIP }, async () => {
  assert.equal(await placeMarkAt({ x: 50000, y: 50000 }, world), null, "only the root stands here");
  assert.equal(await placeMarkAt({ x: Number.NaN, y: 0 }, world), null, "unplaced");
  assert.equal(await placeMarkAt({ x: 1100, y: 1100 }, { marks: null, get marks() { throw new Error("unreadable"); } }), null, "never throws, never guesses");
});
