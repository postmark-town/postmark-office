// world-pair.test.mjs — POS-1234 (WLD-197): the suite's World skeleton and the engine's tools are read at ONE resolved ref.
//
// The CI failure: the fixture read WORLD/skeleton.json out of the clone's WORKING TREE (the pin, no anchors) while the engine's tools were
// materialized at the clone's newest settlement tag (anchors required), so World's strict guard refused. This builds that exact shape on a
// throwaway repo — the checkout is OLDER than the newest blessing — and proves the pair is coherent, and that the old split still exposes it.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveWorldPair, skeletonRowsOf } from "./helpers/world-pair.mjs";

const dir = mkdtempSync(join(tmpdir(), "world-pair-"));
after(() => rmSync(dir, { recursive: true, force: true }));
const git = (...a) => execFileSync("git", ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@t", ...a], { encoding: "utf8" }).trim();
const put = (rel, text) => { mkdirSync(join(dir, rel, ".."), { recursive: true }); writeFileSync(join(dir, rel), text); };
const OLD = { elevation: { regions: { hill: {} } } };                                  // the pin's: a region with no anchor
const NEW = { elevation: { regions: { hill: { anchor: { at_m: 10 }, band_m: 4 } } } }; // the blessing's: anchored

git("init", "-q", "-b", "main");
put("WORLD/skeleton.json", JSON.stringify(OLD)); put("tools/engine.mjs", "export const needs = 'no anchors';\n");
git("add", "-A"); git("commit", "-q", "-m", "the pin"); const PIN = git("rev-parse", "HEAD");
git("tag", "-a", "-m", "S1", "settlement/S1");
put("WORLD/skeleton.json", JSON.stringify(NEW)); put("tools/engine.mjs", "export const needs = 'anchors';\n");
git("add", "-A"); git("commit", "-q", "-m", "the newer blessing"); const BLESSED = git("rev-parse", "HEAD");
git("tag", "-a", "-m", "S2", "settlement/S2");
git("checkout", "-q", "--detach", PIN);                                              // the checkout stays at the OLD commit; S2 is the newest tag

test("the checkout and the newest blessing differ, as in CI", () => {
  assert.notEqual(PIN, BLESSED);
  assert.deepEqual(JSON.parse(readFileSync(join(dir, "WORLD/skeleton.json"), "utf8")), OLD, "the working tree is the OLD pin");
});

test("the pair is ONE ref: the skeleton and the tools both come from the clone's newest blessing, not its working tree", async () => {
  const pair = await resolveWorldPair(dir);
  assert.equal(pair.ref, "refs/tags/settlement/S2");
  assert.equal(pair.sha, BLESSED);
  assert.deepEqual(pair.skeleton, NEW, "the skeleton at the blessed ref, anchors and all");
  assert.equal(readFileSync(join(pair.toolsDir, "tools", "engine.mjs"), "utf8"), "export const needs = 'anchors';\n", "the tools at that same ref");
  assert.deepEqual(skeletonRowsOf(pair.skeleton).map((r) => r.key), ["elevation"], "one law row per top-level key, as law-ingest stores them");
});

test("FALSIFIER: the original split still shows — the working-tree skeleton is NOT the blessed tools' skeleton", async () => {
  const pair = await resolveWorldPair(dir);
  const workingTree = JSON.parse(readFileSync(join(dir, "WORLD/skeleton.json"), "utf8"));        // what the fixture used to read
  assert.deepEqual(workingTree, OLD);
  assert.notDeepEqual(workingTree, pair.skeleton, "a fixture on the working tree and an engine on the blessing read two different worlds");
  const pinned = await resolveWorldPair(dir, { ref: PIN });
  assert.deepEqual(pinned.skeleton, OLD, "a deliberately pinned ref moves BOTH halves together: coherent at the old pin too");
  assert.equal(readFileSync(join(pinned.toolsDir, "tools", "engine.mjs"), "utf8"), "export const needs = 'no anchors';\n");
});

test("a clone that cannot be resolved is refused, never guessed", async () => {
  await assert.rejects(resolveWorldPair(null), /WORLD_CLONE is unset/);
  await assert.rejects(resolveWorldPair(join(dir, "not-a-repo")));
});
