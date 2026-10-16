// mists-shelter.test.mjs — AN ENTERED MARK IS SHELTER (Darko 2026-10-15; WORLD/ENGINE.md § The Mists).
//
// Within a mark a walker has entered, the Mists neither slow the walk nor stop
// it, and nothing inside it is cut from their reads. The world owns the law
// (world-verbs.mjs § shelterOf, world-engine.mjs § mistsRoad's `shelter`); the
// office owns only handing it the walker's enter stack:
//   the walk  — DEC-5's occupancy read, minus the marks the road carries them out of;
//   the eyes and the air — what the reader is within now.
// A clone that predates the ruling has no shelterOf, and everything reads as before.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { mistsOnTheRoad, roadShelter } from "../src/world.mjs";
import { happeningBlock } from "../src/world-read-v2.mjs";
import { worldClone, NO_WORLD } from "./fixture-paths.mjs";

const SOURCE = readFileSync(new URL("../src/world.mjs", import.meta.url), "utf8");

test("roadShelter: the stack minus the marks the road leaves; null on a clone without the ruling", () => {
  const seen = [];
  const verbs = { shelterOf: (w, ids) => { seen.push(ids); return ids.length ? () => true : null; } };
  roadShelter(verbs, { marks: [] }, ["a", "b", "c"], ["c", "b"]);
  roadShelter(verbs, { marks: [] }, ["a"]);
  roadShelter(verbs, null, [], []);
  assert.deepEqual(seen, [["a"], ["a"], []]);
  assert.equal(roadShelter({}, { marks: [] }, ["a"], []), null, "an older clone: no shelterOf, no shelter");
  assert.equal(roadShelter(null, null, null, null), null);
});

test("mistsOnTheRoad hands the walker's shelter to the engine, and an older engine's road is untouched", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mists-shelter-"));
  try {
    mkdirSync(join(dir, "tools"));
    writeFileSync(join(dir, "tools", "world-engine.mjs"),
      "export function mistsRoad(from, toward, crossing, mists, opts) { return { factor: 1, deepest: 0, opts: opts ?? null, argc: arguments.length }; }\n");
    const shelter = () => true;
    const r = await mistsOnTheRoad(dir, { mists: {} }, { x: 0, y: 0 }, { x: 1, y: 0 }, 10, { shelter });
    assert.equal(r.opts.shelter, shelter);
    const bare = await mistsOnTheRoad(dir, { mists: {} }, { x: 0, y: 0 }, { x: 1, y: 0 }, 10);
    assert.deepEqual(bare.opts, { shelter: null }, "no shelter is shelter: null, which the engine reads as before");
    assert.equal(await mistsOnTheRoad(dir, {}, { x: 0, y: 0 }, { x: 1, y: 0 }, 10, { shelter }), null, "no Mists, no reading");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("the walk reads the Mists after DEC-5's occupancy read and before its exits, with the walker's shelter", () => {
  const walk = SOURCE.slice(SOURCE.indexOf("export async function walkViaOffice"));
  const occ = walk.indexOf("const stack = await occupiedNowBy(who, law.thresholds, deps);");
  const road = walk.indexOf("let mistRoad = await mistsOnTheRoad(worldClone, skeleton, from, toward, at, { shelter });");
  const exits = walk.indexOf("await exitViaOffice(worldClone, { handle: who, mark: markId }, key, deps)");
  assert.ok(occ > 0 && road > occ && exits > road, `order: occupancy ${occ}, road ${road}, exits ${exits}`);
  assert.match(walk, /const shelter = occupying \? roadShelter\(law\.verbs, occupying\.w, occupying\.stack, occupying\.leaving\) : null;/);
  assert.match(walk, /if \(setDownFirst\) \{\n    mistRoad = await mistsOnTheRoad\(worldClone, skeleton, from, toward, at, \{ shelter \}\);/,
    "stepping ashore re-reads the road with the same shelter");
});

test("the eyes and the air read with the reader's enter stack; a look from coordinates carries none", () => {
  for (const [name, call] of [
    ["worldOrient", "verbs.orient({ x: at.x, y: at.y }, w, { crossing, entered });"],
    ["worldEyes", "verbs.openYourEyes({ x: at.x, y: at.y, name: args.name }, w, { crossing, actor: choice.handle ?? null, entered,"],
  ]) {
    const body = SOURCE.slice(SOURCE.indexOf(`export async function ${name}(`));
    const read = body.indexOf("const entered = choice.coords ? null : await enteredNow(choice.handle);");
    assert.ok(read > 0 && body.indexOf(call) > read, `${name} passes the reader's stack`);
  }
});

test("v2's happening_here: entered, the wall stands around the mark and hides nothing; unentered, arm's reach as ever", () => {
  const note = (mists) => happeningBlock({ mists })[0].note;
  assert.equal(note({ in_wall: true, thickness: 1, sheltered: true }), "the wall stands around the mark you have entered; inside it, nothing is hidden");
  assert.equal(note({ in_wall: true, thickness: 1 }), "you stand in the wall: arm's reach, and walking slows to nothing");
  assert.equal(note({ in_wall: false, thickness: 0.4, sheltered: true }), "you stand in their fringe: sight is short and walking slows");
  assert.match(SOURCE, /mists: r\.fov\?\.mists \? \{ \.\.\.r\.fov\.mists, \.\.\.\(verbs\.shelterOf\?\.\(w, entered\)\?\.\(at\) \? \{ sheltered: true \} : \{\}\) \} : null/,
    "the eyes mark the Mists sheltered on orient's own test: the reader's entered marks, at the standpoint");
});

// The real engine, where the clone carries the ruling (World shelter/entered-mark).
const CLONE = worldClone();
const VERBS = CLONE ? join(CLONE, "tools", "world-verbs.mjs") : null;
const READY = !!VERBS && existsSync(VERBS) && readFileSync(VERBS, "utf8").includes("export function shelterOf");
const WHY_NOT = !CLONE ? NO_WORLD : `the world clone at ${CLONE} predates the shelter ruling (world-verbs.mjs § shelterOf)`;

test("with the world's own law: a road inside an entered mark in the wall walks; unentered, or leaving it, it is refused",
  { skip: !READY && WHY_NOT }, async () => {
    const verbs = await import(pathToFileURL(VERBS));
    const MISTS = {
      border_m: { minX: -1000, minY: -1000, maxX: 1000, maxY: 1000 },
      fringe_m: 300, wall_sight_m: 20, density: { from: 0.9, to: 0.9 },
      schedule: [{ crossing: 10, front_m: 0, veil: 0.4 }],
    };
    const GROUNDS = { id: "beyond/grounds", kind: "sited", at: { x: 0, y: -1150 }, extent: { w: 300, h: 300 } };
    const world = { marks: [GROUNDS] };
    const a = { x: -50, y: -1100 }, b = { x: 60, y: -1250 }, out = { x: 400, y: -1100 };
    const skel = { mists: MISTS };
    assert.ok((await mistsOnTheRoad(CLONE, skel, a, b, 10))?.refused, "unentered: the wall stops it");
    const inside = await mistsOnTheRoad(CLONE, skel, a, b, 10, { shelter: roadShelter(verbs, world, [GROUNDS.id], []) });
    assert.equal(inside.refused, undefined);
    assert.deepEqual([inside.factor, inside.deepest], [1, 0]);
    // a road out of the Grounds: DEC-5 names it leaving, so it shelters nothing
    assert.ok((await mistsOnTheRoad(CLONE, skel, a, out, 10, { shelter: roadShelter(verbs, world, [GROUNDS.id], [GROUNDS.id]) }))?.refused);
  });
