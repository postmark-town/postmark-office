// doors-read-the-blessing.test.mjs — the walk door, the land pen and the
// enter/exit law run the engine the newest blessing carries (world-branches.mjs
// § engineDirAt), never the clone's working tree.
//
// THE DEFECT: those doors imported `<clone>/tools/*.mjs` straight off the
// working tree, which the shared clone's fast-forward keeps at main, and a plain
// import lasts the life of the process. So engine code merged to main and never
// blessed went live at the next office restart, and a blessing's engine waited
// for one.
//
// THE FIXTURE: a clone with `settlement/S1` at C1. Its working tree is then
// edited (uncommitted), then main moves to C2 (unblessed): the doors still read
// C1. Then `settlement/S2` blesses C2, and the very next call, in this same
// process, reads C2.

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { engineDirAt } from "../src/world-branches.mjs";
import { mistsOnTheRoad, mistsWallOn } from "../src/world.mjs";
import { crossingLaw } from "../src/world-crossings.mjs";
import { mistsEngine } from "../src/mists-forecast.mjs";

const repo = mkdtempSync(join(tmpdir(), "doors-blessing-"));
after(() => rmSync(repo, { recursive: true, force: true }));
const git = (...args) => execFileSync("git", ["-c", "core.autocrlf=false", "-C", repo, ...args], { encoding: "utf8" }).trim();

// One engine, its version written into every module the doors import.
function writeEngine(v) {
  mkdirSync(join(repo, "tools"), { recursive: true });
  writeFileSync(join(repo, "tools", "world-engine.mjs"),
    `export const V = "${v}";\n`
    + `export function mistsRoad() { return { factor: 1, deepest: 0, v: V }; }\n`
    + `export function mistsAt() { return { v: V }; }\n`
    + `export function mistsHere() { return { inWall: V !== "C1" }; }\n`);
  writeFileSync(join(repo, "tools", "enter-exit.mjs"),
    `export const V = "${v}";\nexport function occupancyAt() { return []; }\nexport function parseEnterExitLedger() { return []; }\n`);
  writeFileSync(join(repo, "tools", "world-verbs.mjs"), `export const V = "${v}";\nexport function enter() { return V; }\n`);
}
function commit(msg) {
  git("add", "-A");
  git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", msg);
  return git("rev-parse", "HEAD");
}

git("init", "-q", "-b", "main");
writeEngine("C1");
const C1 = commit("C1");
git("-c", "user.name=t", "-c", "user.email=t@t", "tag", "-a", "settlement/S1", "-m", "S1", C1);

const MISTS = { mists: {} };
const road = () => mistsOnTheRoad(repo, MISTS, { x: 0, y: 0 }, { x: 1, y: 0 }, 300);
const lawV = async () => (await crossingLaw(repo)).verbs.V;

test("at the blessing: every door reads C1", async () => {
  assert.equal((await road()).v, "C1", "the walk door's Mists road");
  assert.equal(await lawV(), "C1", "the enter/exit law");
  assert.equal((await mistsEngine(repo)).V, "C1", "the placement forecast");
  assert.equal(await mistsWallOn(repo, MISTS, [{ x: 0, y: 0 }], 300), null, "the ground check (C1 stands clear)");
  assert.equal(readFileSync(join(engineDirAt(repo), "tools", "world-verbs.mjs"), "utf8").includes('"C1"'), true);
});

test("a working-tree edit never reaches the doors", async () => {
  writeEngine("TREE");
  assert.equal((await road()).v, "C1");
  assert.equal(await lawV(), "C1");
  assert.equal((await mistsEngine(repo)).V, "C1");
});

test("main moved but unblessed never reaches the doors", async () => {
  writeEngine("C2");
  commit("C2");
  assert.equal((await road()).v, "C1");
  assert.equal(await lawV(), "C1");
  assert.equal(await mistsWallOn(repo, MISTS, [{ x: 0, y: 0 }], 300), null);
});

test("a new blessing reaches the doors on the next call, in the same process", async () => {
  git("-c", "user.name=t", "-c", "user.email=t@t", "tag", "-a", "settlement/S2", "-m", "S2", "main");
  assert.equal((await road()).v, "C2", "the walk door's Mists road");
  assert.equal(await lawV(), "C2", "the enter/exit law");
  assert.equal((await mistsEngine(repo)).V, "C2", "the placement forecast");
  assert.deepEqual(await mistsWallOn(repo, MISTS, [{ x: 0, y: 0 }], 300), { x: 0, y: 0 }, "the ground check (C2 stands in the wall)");
});

test("a directory that is not a git repository is its own engine (a test's stub)", () => {
  const stub = mkdtempSync(join(tmpdir(), "doors-stub-"));
  try { assert.equal(engineDirAt(stub), stub); } finally { rmSync(stub, { recursive: true, force: true }); }
});
