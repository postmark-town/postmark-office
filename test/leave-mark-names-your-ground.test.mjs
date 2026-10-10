// leave-mark-names-your-ground.test.mjs — POS-493, the pure half.
//
//   node --test test/leave-mark-names-your-ground.test.mjs
//
// THE INSTANCE (the read-shape eval, POS-486, 2026-10-09). Two Sonnet agents
// asked to "leave a mark on your own parcel" set it a few metres from where
// they stood, 1 m inside the edge, and it landed at y −2530 against an edge at
// −2530.5: half a metre outside, a commons mark wanting ✦1. A v2 agent landed
// at −2531, inside. Nothing they read named the edge.
//
// `groundNoteOf` is the door's sentence; the door hands it the parcels its own
// ground verdict read, and whether that verdict found the mark on them. Here
// the verdict is the ENGINE's marksContain from the pinned world clone, so the
// pure test answers with the rule the fold enforces. The door's own legs are
// in leave-door-region-filed-parcel.test.mjs § LEGS 9–11.

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { NO_WORLD, worldClone } from "./fixture-paths.mjs";

const { groundNoteOf, yourGroundOf } = await import("../src/world.mjs");

const CLONE = worldClone();
const GEOMETRY = CLONE ? join(CLONE, "tools", "geometry.mjs") : null;
const HAVE_ENGINE = Boolean(GEOMETRY) && existsSync(GEOMETRY);
const { marksContain } = HAVE_ENGINE ? await import(pathToFileURL(GEOMETRY)) : {};

// The eval's parcel: x 605..630, y −2555.5..−2530.5.
const PARCEL = { id: "sonnet/the-plot", kind: "parcel", at: { x: 617.5, y: -2543 }, extent: { w: 25, h: 25 } };
const LAMP = { kind: "sited", extent: { w: 1, h: 1 } };

function noteFor(at, own = [PARCEL]) {
  const claim = { ...LAMP, at };
  return groundNoteOf({ ...claim, own, onOwnGround: own.some((p) => marksContain(p, claim)), nearM: 25, contains: marksContain });
}

test("the ranges are the parcel's edges, as the issue writes them", () => {
  assert.deepEqual(yourGroundOf([PARCEL]), [{ parcel: "sonnet/the-plot", x: "605..630", y: "-2555.5..-2530.5" }]);
  assert.deepEqual(yourGroundOf([{ id: "x/no-place", kind: "parcel" }]), [], "a parcel with no place names no range");
});

test("THE INSTANCE: y −2530 against the edge at −2530.5 warns, says how far, and offers the point inside", { skip: !HAVE_ENGINE && NO_WORLD }, () => {
  const n = noteFor({ x: 620, y: -2530 });
  assert.ok(n.off_your_ground, "the half-metre miss is said");
  assert.match(n.off_your_ground.note, /reaches 1 m outside your parcel sonnet\/the-plot \(x 605\.\.630, y -2555\.5\.\.-2530\.5\)/,
    "the footprint (1 m square, centred 0.5 m past the edge) must come back 1 m to sit wholly inside");
  assert.match(n.off_your_ground.note, /needs ✦1/);
  assert.deepEqual(n.off_your_ground.corrected_at, { x: 620, y: -2531 });
  assert.ok(marksContain(PARCEL, { ...LAMP, at: n.off_your_ground.corrected_at }), "the engine agrees the offered point is inside");
});

test("a footprint reaching exactly 0.5 m past the edge warns; the v2 agent's −2531 does not", { skip: !HAVE_ENGINE && NO_WORLD }, () => {
  const out = noteFor({ x: 620, y: -2530.5 });       // footprint −2531..−2530, 0.5 m past
  assert.ok(out.off_your_ground);
  assert.match(out.off_your_ground.note, /reaches 0\.5 m outside/);
  const inside = noteFor({ x: 620, y: -2531 });      // footprint −2531.5..−2530.5, on the edge
  assert.equal(inside.off_your_ground, undefined, "inside by the engine's rule: no warning");
  assert.deepEqual(inside.your_ground, yourGroundOf([PARCEL]), "and the ranges still ride");
});

test("a deliberate commons mark far from every parcel gets no warning; a household with no parcel gets nothing", { skip: !HAVE_ENGINE && NO_WORLD }, () => {
  assert.equal(noteFor({ x: 620, y: -2400 }).off_your_ground, undefined, "130 m off is not a miss");
  assert.equal(noteFor({ x: 620, y: -2530 }, []), null);
});

test("words and parcels carry no ground note", () => {
  assert.equal(groundNoteOf({ kind: "predicated", at: null, own: [PARCEL], onOwnGround: false, nearM: 25 }), null);
  assert.equal(groundNoteOf({ kind: "parcel", at: { x: 0, y: 0 }, own: [PARCEL], onOwnGround: false, nearM: 25 }), null);
});

test("THE 25 m EDGE: a footprint whose gap to the parcel is exactly 25 m still warns; 25.5 m is a deliberate commons mark", { skip: !HAVE_ENGINE && NO_WORLD }, () => {
  // The parcel's top edge is y −2530.5 and the lamp is 1 m square, so a centre
  // at −2505 leaves a gap of exactly 25 m (`gap > nearM` admits it), and
  // −2504.5 leaves 25.5 m.
  const atEdge = noteFor({ x: 620, y: -2505 });
  assert.ok(atEdge.off_your_ground, "exactly 25 m off: warned");
  assert.match(atEdge.off_your_ground.note, /reaches 26 m outside/);
  assert.deepEqual(atEdge.off_your_ground.corrected_at, { x: 620, y: -2531 });
  const past = noteFor({ x: 620, y: -2504.5 });
  assert.equal(past.off_your_ground, undefined, "25.5 m off: no warning, only the ranges");
  assert.deepEqual(past.your_ground, yourGroundOf([PARCEL]));
});
