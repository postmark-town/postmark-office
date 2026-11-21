// dev-target.test.mjs — POS-686: the local dev stand-in's in-process seed steps check the clone they read against the target's OWN pins.
//
//   node --test test/dev-target.test.mjs
//
// THE FAILURE (Jetto, reproduced on train b63d96b3). `localDevTarget` writes its own pins (POS-994: from its re-signed town clone, into a folder outside the clone) and hands
// them to the children it spawns as TOWN_PINS_DIR. Its IN-PROCESS steps (the town index's derivation, the stamp lines' sync) load the town's pinned tools through
// src/town-tool.mjs, which reads TOWN_PINS_DIR at each call; with none set it reads the office's committed pins, a different town commit, and the seed stopped with
// TownPinMismatch before the round stood up. THE REFUSAL IS RIGHT: pinned code and the clone it is checked against must be one town. The fix is that the in-process steps
// check the clone against the target's pins (`withTownPins`), never that the check is loosened. Here, on a scratch clone whose pinned tool differs from the committed pins:
//   1. without the target's pins the pinned tool is refused (the original failure, by name);
//   2. under `withTownPins(<the clone's own pins>)` it loads;
//   3. the variable is put back as it was on every path out (set or absent, return or throw), and the next call without it is refused again: nothing leaks between targets;
//   4. a clone that differs from ITS OWN pins is still refused under `withTownPins`: the mismatch check is preserved;
//   5. a second target's pin folder is a second root: the first target's manifest is not read for it.

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { withTownPins } from "./helpers/dev-target.mjs";
import { townTool, TownPinMismatch } from "../src/town-tool.mjs";
import { tempDir } from "./helpers/temp-dir.mjs";

const OFFICE = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = join(OFFICE, "town-clone");
const SKIP = existsSync(join(SOURCE, "tools", "stamp-mint.mjs")) ? false : "no town clone beside the office";
const g = (repo, ...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).trim();
const TOOL = "stamp-mint.mjs";

let dir = null, clone = null, pins = null;
const KEEP = Object.hasOwn(process.env, "TOWN_PINS_DIR") ? process.env.TOWN_PINS_DIR : undefined;

before(() => {
  if (SKIP) return;
  dir = tempDir("pos686-dev-target-");
  // a scratch clone whose pinned tool is NOT the office's committed copy: one commit that edits stamp-mint.mjs (what a re-signed stand-in is, to the office's pins)
  clone = join(dir, "town-clone");
  execFileSync("git", ["clone", "-q", "--shared", "--no-checkout", SOURCE, clone], { stdio: "ignore" });
  g(clone, "-c", "advice.detachedHead=false", "checkout", "-q", "HEAD");
  g(clone, "config", "user.name", "pos686-test"); g(clone, "config", "user.email", "t@postmark.invalid");
  appendFileSync(join(clone, "tools", TOOL), "\n// the stand-in's own copy (POS-686 test)\n");
  g(clone, "commit", "-qam", "the stand-in's copy of a pinned tool");
  // that clone's own pins, as the target's `asFreshen` writes them
  pins = join(dir, "pins-of-the-clone");
  execFileSync(process.execPath, [join(OFFICE, "tools", "town-pins.mjs"), "--write", "--town", clone, "--ref", "HEAD", "--out", pins], { encoding: "utf8", stdio: "pipe", env: { ...process.env, TOWN_PINS_DIR: pins } });
});
after(() => {
  if (KEEP === undefined) delete process.env.TOWN_PINS_DIR; else process.env.TOWN_PINS_DIR = KEEP;
  if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

/** The office's own committed pins: no TOWN_PINS_DIR at all, as an in-process step of a stand-in saw it. */
const committed = (fn) => {
  const was = process.env.TOWN_PINS_DIR;
  delete process.env.TOWN_PINS_DIR;
  try { return fn(); } finally { if (was !== undefined) process.env.TOWN_PINS_DIR = was; }
};

test("1 · the original failure: with no pin folder named, the stand-in's pinned tool is refused by name (the check is right, and stays)", { skip: SKIP }, () => {
  committed(() => assert.throws(() => townTool(clone, TOOL), (e) => e instanceof TownPinMismatch && e.code === "TOWN_PIN_MISMATCH" && e.file === `tools/${TOOL}`));
});

test("2 · under the target's own pins the same clone's tool loads", { skip: SKIP }, async () => {
  const path = await withTownPins(pins, () => townTool(clone, TOOL));
  assert.equal(path, join(pins, "tools", TOOL), "the pinned copy, from the target's folder, never a path into the clone");
});

test("3 · the variable is put back on every path out, and nothing leaks to the next call", { skip: SKIP }, async () => {
  // was absent
  delete process.env.TOWN_PINS_DIR;
  await withTownPins(pins, () => assert.equal(process.env.TOWN_PINS_DIR, pins));
  assert.equal(Object.hasOwn(process.env, "TOWN_PINS_DIR"), false, "absent before, absent after");
  assert.throws(() => townTool(clone, TOOL), TownPinMismatch, "and the next call, with none named, is refused again");
  // was set (the suite's own pins), and a throw inside
  process.env.TOWN_PINS_DIR = "/some/other/target/pins";
  await assert.rejects(withTownPins(pins, async () => { throw new Error("the step failed"); }), /the step failed/);
  assert.equal(process.env.TOWN_PINS_DIR, "/some/other/target/pins", "set before: restored, though the step threw");
  // the return value passes through
  assert.equal(await withTownPins(pins, async () => 42), 42);
  if (KEEP === undefined) delete process.env.TOWN_PINS_DIR; else process.env.TOWN_PINS_DIR = KEEP;
});

test("4 · the mismatch check is preserved: a clone that differs from ITS OWN pins is still refused under the target's folder", { skip: SKIP }, async () => {
  appendFileSync(join(clone, "tools", TOOL), "\n// edited after the pins were written\n");
  g(clone, "commit", "-qam", "drift after the pins");
  await withTownPins(pins, () => assert.throws(() => townTool(clone, TOOL), (e) => e instanceof TownPinMismatch && e.file === `tools/${TOOL}`));
});

test("5 · a second target's pin folder is its own root: the first target's manifest is not read for it", { skip: SKIP }, async () => {
  const other = join(dir, "pins-of-the-other");
  execFileSync(process.execPath, [join(OFFICE, "tools", "town-pins.mjs"), "--write", "--town", clone, "--ref", "HEAD", "--out", other], { encoding: "utf8", stdio: "pipe", env: { ...process.env, TOWN_PINS_DIR: other } });
  // `other` was written at the drifted HEAD, `pins` at the one before: each matches only the clone state it was written for
  const path = await withTownPins(other, () => townTool(clone, TOOL));
  assert.equal(path, join(other, "tools", TOOL));
  await withTownPins(pins, () => assert.throws(() => townTool(clone, TOOL), TownPinMismatch));
});
