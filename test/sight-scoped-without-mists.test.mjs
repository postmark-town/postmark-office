// sight-scoped-without-mists.test.mjs — the office hands the engine the reader's
// enter stack whenever sight is framed by it, Mists or not.
//
// WLD-5 (Darko 2026-10-16 19:52): "your line of sight [is] scoped to the interior
// of the mark you are within … all marks should follow this principle." The
// world's engine frames sight by the stack it is handed (postmark-world
// tools/world-verbs.mjs § sightFrameOf, tested there). The office read the stack
// only when the Mists' shelter was in play, so with the Mists off every read
// went unscoped: the WLD-63 playground walk (2026-10-19) had darko in the Red
// Stair Hall seeing twelve seats from outside it. Under test: the gate, the
// wiring, and that the stack changes what the real clone's eyes see with no
// Mists in the world at all.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { MISTS_FIRST_CROSSING, enterStackMatters, shelterInPlay } from "../src/world.mjs";
import { worldClone, NO_WORLD } from "./fixture-paths.mjs";

const SOURCE = readFileSync(new URL("../src/world.mjs", import.meta.url), "utf8");
const CLONE = worldClone();
const verbsOf = async () => import(pathToFileURL(join(CLONE, "tools", "world-verbs.mjs")).href);
const FRAMES = !!CLONE && existsSync(join(CLONE, "tools", "world-verbs.mjs"))
  && readFileSync(join(CLONE, "tools", "world-verbs.mjs"), "utf8").includes("export function sightFrameOf");
const SKIP = !FRAMES && (CLONE ? `the world clone at ${CLONE} predates the sight frame (no sightFrameOf)` : NO_WORLD);

test("THE GATE: a clone that frames sight reads the stack with the Mists off; an older one out of season reads no ledger", () => {
  const noMists = { terrain: {} };
  assert.equal(enterStackMatters({ verbs: { sightFrameOf: () => null }, w: noMists, crossing: 300 }), true, "sight is scoped for all marks, Mists or not");
  assert.equal(enterStackMatters({ verbs: { sightFrameOf: () => null }, w: noMists, crossing: 0 }), true, "before the Mists' season too");
  assert.equal(enterStackMatters({ verbs: {}, w: noMists, crossing: 300 }), false, "a clone older than the ruling, no Mists: no ledger");
  assert.equal(enterStackMatters({}), false);
  // the shelter's own gate is unchanged, and still opens the read on its own
  const mists = { terrain: { mists: {} } };
  assert.equal(shelterInPlay({ verbs: { shelterOf: () => null }, w: mists, crossing: MISTS_FIRST_CROSSING }), true);
  assert.equal(enterStackMatters({ verbs: { shelterOf: () => null }, w: mists, crossing: MISTS_FIRST_CROSSING }), true);
});

test("THE WIRING: the eyes and the air read the stack through the one gate", () => {
  const body = SOURCE.slice(SOURCE.indexOf("async function enteredNow("));
  assert.match(body.slice(0, 200), /if \(!handle \|\| !enterStackMatters\(inPlay\)\) return null;/);
});

test("THE PINNED CLONE frames sight, and with no Mists in the world the stack is what scopes the eyes", { skip: SKIP }, async () => {
  const verbs = await verbsOf();
  assert.equal(enterStackMatters({ verbs, w: { terrain: {} }, crossing: 300 }), true, "the pinned clone is read with the Mists off");
  // a world as the engine assembles it (the world's own sight-scoped test's shape): flat ground, NO Mists
  const { fold } = await import(pathToFileURL(join(CLONE, "tools", "marks-fold.mjs")).href);
  const { buildHeightfield } = await import(pathToFileURL(join(CLONE, "tools", "world-engine.mjs")).href);
  const M = (id, x, y, w, h) => ({ id, by: id.split("/")[0], household: id.split("/")[0], kind: "sited", tier: "market",
    at: { x, y }, extent: { w, h }, date: "2026-09-01T00:00:00Z", body: "b" });
  const f = fold({ marks: [M("the-town/let-there-be-light", 0, 0, 60000, 60000), M("t/hall", 0, 0, 40, 40), M("t/hall-bench", 5, 5, 2, 1),
    M("u/courtyard", 60, 0, 30, 30), M("v/well", 62, 2, 2, 2)], terrain: { features: [] }, stakes: [], tick: 1, households: {} });
  assert.deepEqual(f.errors, [], "the fixture folds clean");
  const flat = buildHeightfield({ controlPoints: [{ x: 0, y: 0, h: 5 }, { x: 10000, y: 0, h: 5 }, { x: 0, y: 10000, h: 5 }, { x: -10000, y: 0, h: 5 }] });
  const world = { ...f, terrain: { far_features: [], features: [], elevation: {} }, heightfield: flat,
    light: { dawn_pole_m: { x: 5000, y: -5000 }, dark_pole_m: { x: -5000, y: 5000 } }, fogCeilingM: 22 };
  assert.ok(!world.terrain.mists, "no Mists in this world");
  const at = { x: 0, y: 0, name: "ann" };
  const seen = (r) => JSON.stringify(r.radial ?? r);
  const outside = verbs.openYourEyes(at, world, { crossing: 300, entered: null });
  const inside = verbs.openYourEyes(at, world, { crossing: 300, entered: ["t/hall"] });
  assert.match(seen(outside), /u\/courtyard/, "unentered, the eyes reach past the hall");
  assert.doesNotMatch(seen(inside), /u\/courtyard|v\/well/, "entered, the hall is the frame: nothing outside it is a seat");
  assert.match(seen(inside), /t\/hall-bench/, "and what the hall holds is seen");
});
