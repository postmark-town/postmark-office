// draft-leak-oracle.test.mjs — POS-1234: the Spark door test's leak oracle still catches a real leak, and does not blame it for a neighbour's writes.
//
// test/spark-names-event-door.test.mjs runs the REAL leave executor and asserts, in the clone the suite shares, that none of ITS household's draft
// work landed there (test/helpers/draft-leak.mjs). Run 45654574072 showed the earlier "the shared clone is unchanged" oracle failing on a
// neighbour's writes (test/pos-1221-leave-mark-segments.test.mjs drives the same executor in the same clone, concurrently). So this file proves
// BOTH halves on repositories that are fully private to it — a stand-in for the shared clone made here, never the suite's own, its ref cache or its
// worktree registry:
//   · a neighbour writing the stand-in (another household's draft slot, a moved main, a fetched branch) does NOT trip the oracle;
//   · the door pointed at the stand-in (POS1234_DOOR_LEAK=1: the leak this oracle exists to catch) DOES trip it, with the real executor's own writes.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { draftArtifactsOf } from "./helpers/draft-leak.mjs";

const SUITE_CLONE = process.env.WORLD_CLONE || join(import.meta.dirname, "..", "world-clone");
const skip = !existsSync(join(SUITE_CLONE, ".git")) && "no pinned world clone in this tree";
const DOOR_TEST = join(import.meta.dirname, "spark-names-event-door.test.mjs");
const git = (dir, ...a) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8" }).trim();
const DIRS = [];
test.after(() => { for (const d of DIRS) rmSync(d, { recursive: true, force: true }); });

/** A private stand-in for the suite's shared clone: its pin as `origin/main` and a local main, a detached HEAD, nothing the suite's clone can see change. */
function standIn() {
  const dir = mkdtempSync(join(tmpdir(), "pos1234-standin-")); DIRS.push(dir);
  const clone = join(dir, "world-clone");
  execFileSync("git", ["clone", "-q", "--local", "--no-checkout", SUITE_CLONE, clone]);
  const pin = git(SUITE_CLONE, "rev-parse", "HEAD");
  git(clone, "fetch", "-q", "--no-tags", "origin", `+${pin}:refs/remotes/origin/main`);
  git(clone, "branch", "-f", "main", pin);
  git(clone, "checkout", "-q", "--detach", pin);
  return clone;
}

/** The door test, run as its own process with `clone` as the clone the suite shares; resolves { code, out }. */
const runDoor = (clone, env = {}) => new Promise((resolve) => {
  const args = [...process.execArgv.filter((a) => !a.startsWith("--test")), DOOR_TEST];
  // NODE_TEST_CONTEXT would make the child report to THIS run in node:test's internal serializer; it is its own run, read as plain TAP
  const { NODE_TEST_CONTEXT: _ctx, ...inherited } = process.env;
  const child = spawn(process.execPath, args, { env: { ...inherited, WORLD_CLONE: clone, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  child.stdout.on("data", (d) => { out += d; }); child.stderr.on("data", (d) => { out += d; });
  child.on("close", (code) => resolve({ code, out }));
});

test("a neighbour's draft work in the shared clone does not trip the oracle; the door on its private clone passes beside it", { skip, timeout: 170_000 }, async () => {
  const shared = standIn();
  // a neighbour (another household) seats a draft slot, fetches and moves main in the shared clone, as pos-1221's executor run does
  git(shared, "branch", "draft/alex-rowan", "main");
  git(shared, "worktree", "add", "-q", join(shared, "..", "world-clone-pool", "wt-0"), "draft/alex-rowan");
  git(shared, "update-ref", "refs/remotes/origin/some-branch", "main");
  assert.deepEqual(draftArtifactsOf(shared, "pos1234-door"), [], "the oracle looks at the door's own household only");
  assert.ok(draftArtifactsOf(shared, "alex-rowan").length > 0, "and does see a neighbour's, so the control is not blind");
  const { code, out } = await runDoor(shared);
  assert.equal(code, 0, `the door test passes beside a neighbour's writes:\n${out.slice(-3000)}`);
  assert.match(out, /^ok 3 - POS-1234: the door's draft work is in its PRIVATE clone/m, `the child really ran the oracle (not an empty pass):\n${out.slice(-3000)}`);
  assert.deepEqual(draftArtifactsOf(shared, "pos1234-door"), [], "and left nothing of its own in the shared clone");
});

test("FALSIFIER: the real executor pointed at the shared clone leaves its household's draft there, and the door test goes red on exactly that", { skip, timeout: 170_000 }, async () => {
  const shared = standIn();
  assert.deepEqual(draftArtifactsOf(shared, "pos1234-door"), [], "clean before");
  const { code, out } = await runDoor(shared, { POS1234_DOOR_LEAK: "1" });
  assert.notEqual(code, 0, `the leaking door fails the suite; its own output:\n${out.slice(-3000)}`);
  assert.match(out, /not ok \d+ - POS-1234: the door's draft work is in its PRIVATE clone/, "and it is the leak oracle that fails");
  assert.match(out, /leaked into the shared world clone/, "naming the leak");
  assert.ok(draftArtifactsOf(shared, "pos1234-door").length > 0, "the real executor's own writes are what it caught: the household's draft is in the stand-in");
});
