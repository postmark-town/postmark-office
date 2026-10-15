// world2-refresh-clone-history.test.mjs — THE BLESSED CHECKOUT CAN PLACE THE PIN
// (POS-635, 2026-10-14).
//
// The law pen moves the clearing's pin only to a descendant of where it stands,
// and asks `git merge-base --is-ancestor` in the world-blessed checkout
// (world2/tools/law-ingest.mjs § pinMove). That checkout was `--depth 1`, so a
// pin one settlement back was never there to place: git exited 128, the pen
// held the pin and exited 0. On the box the pin sat at b0db90f from
// 2026-10-11 15:04Z while S103..S109 were blessed on top of it. The fixture in
// test/law-pin-forward.test.mjs has full history, so it never asked this.
//
// These tests run the SHIPPED deploy/world2-refresh-clone.sh against a local
// origin (git's url.<base>.insteadOf points the script's github URL at it), the
// way the law unit runs it, and then ask the pen's own question with the pen's
// own pinMove.
//
// The flip: put `--depth 1` back on the world-blessed arm and the move tests go
// red (held, "this checkout cannot place the pin").
//
//   node --test test/world2-refresh-clone-history.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ancestryIn, pinMove } from "../world2/tools/law-ingest.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = join(ROOT, "deploy", "world2-refresh-clone.sh");
const WORLD_URL = "https://github.com/postmark-town/postmark-world.git";

const bashOk = spawnSync("bash", ["-c", "exit 0"], { stdio: "ignore" }).status === 0;
const skip = bashOk ? false : "bash is not on PATH here, so the shipped refresh script cannot run";

/** A world origin with a line of settlements: S1 ← c ← S2 ← c ← S3, tagged. */
function origin(t) {
  const dir = mkdtempSync(join(tmpdir(), "w2-blessed-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const src = join(dir, "origin");
  const g = (...a) => execFileSync("git", ["-C", src, "-c", "user.name=t", "-c", "user.email=t@t", ...a], { encoding: "utf8" }).trim();
  execFileSync("git", ["init", "-q", src]);
  const commit = (n) => { writeFileSync(join(src, "f"), n); g("add", "f"); g("commit", "-qm", n); return g("rev-parse", "HEAD"); };
  const tag = (n) => g("tag", `settlement/S${n}`);
  return { dir, src, commit, tag, lab: join(dir, "lab") };
}

/** Run the shipped script as the law unit does, with github pointed at `o.src`. */
function refresh(o) {
  const env = {
    ...process.env,
    WORLD2_LAB: o.lab,
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: `url.${pathToFileURL(o.src).href}.insteadOf`,
    GIT_CONFIG_VALUE_0: WORLD_URL,
  };
  const r = spawnSync("bash", [SCRIPT, "world-blessed"], { encoding: "utf8", env });
  assert.equal(r.status, 0, `the refresh script failed: ${r.stderr}`);
  return r.stdout.trim().split("\n").pop();
}

/** The pen's own ancestry question (law-ingest.mjs § ancestryIn, which main() hands writeLaw). */
const isAncestorIn = (repo) => ancestryIn(repo);

test("pinMove names a checkout that cannot place the pin apart from a law that does not descend", () => {
  const throws = () => { const e = new Error("fatal: Not a valid commit name"); e.status = 128; throw e; };
  const cannot = pinMove("a".repeat(40), "b".repeat(40), throws);
  assert.equal(cannot.move, false);
  assert.match(cannot.why, /this checkout cannot place the pin a{12} against b{12}/);
  const behind = pinMove("a".repeat(40), "b".repeat(40), () => false);
  assert.equal(behind.move, false);
  assert.match(behind.why, /^b{12} does not descend from the pin a{12}: the pin stays/);
  assert.match(pinMove("a".repeat(40), "b".repeat(40), null).why, /cannot place/, "no way to ask is cannot place");
});

test("EXECUTED: the next settlement's checkout places the pin one settlement back, and the pin moves", { skip }, (t) => {
  const o = origin(t);
  const s1 = o.commit("S1"); o.tag(1);
  assert.equal(refresh(o), s1, "the first run checks out S1");
  o.commit("between");
  const s2 = o.commit("S2"); o.tag(2);
  const head = refresh(o);
  assert.equal(head, s2, "the second run checks out S2");
  const v = pinMove(s1, s2, isAncestorIn(join(o.lab, "ingest-clones", "world-blessed")));
  assert.equal(v.move, true, `the pin at S1 must move to S2: ${v.why}`);
  assert.ok(!existsSync(join(o.lab, "ingest-clones", "world-blessed", ".git", "shallow")), "the blessed checkout is not shallow");
});

test("EXECUTED: a checkout the box left shallow is unshallowed once, then places the pin", { skip }, (t) => {
  const o = origin(t);
  const s1 = o.commit("S1"); o.tag(1);
  o.commit("between");
  const s2 = o.commit("S2"); o.tag(2);
  // The box today: a --depth 1 checkout at S2 (the shape the old script left).
  const dir = join(o.lab, "ingest-clones", "world-blessed");
  execFileSync("git", ["-c", "advice.detachedHead=false", "clone", "-q", "--depth", "1", "--branch", "settlement/S2", pathToFileURL(o.src).href, dir]);
  assert.ok(existsSync(join(dir, ".git", "shallow")), "the fixture starts shallow, as the box does");
  assert.throws(() => isAncestorIn(dir)(s1, s2), "a shallow checkout cannot place S1: the bug");
  const s3 = o.commit("S3"); o.tag(3);
  assert.equal(refresh(o), s3);
  assert.ok(!existsSync(join(dir, ".git", "shallow")), "the refresh unshallowed it");
  for (const pin of [s1, s2]) {
    const v = pinMove(pin, s3, isAncestorIn(dir));
    assert.equal(v.move, true, `a pin at ${pin.slice(0, 7)} must move to S3: ${v.why}`);
  }
});

test("EXECUTED: a pin that is not an ancestor still holds, with the fact named", { skip }, (t) => {
  const o = origin(t);
  const base = o.commit("base");
  o.tag(1);
  refresh(o);
  // main ran ahead of S1 and the pin went with it (the 10-11 deploy's first run)
  const ahead = o.commit("main ahead");
  execFileSync("git", ["-C", o.src, "checkout", "-q", "-b", "side", base]);
  const s2 = o.commit("S2 off base"); o.tag(2);
  assert.equal(refresh(o), s2);
  const dir = join(o.lab, "ingest-clones", "world-blessed");
  execFileSync("git", ["-C", dir, "fetch", "-q", pathToFileURL(o.src).href, ahead]);
  const v = pinMove(ahead, s2, isAncestorIn(dir));
  assert.equal(v.move, false);
  assert.match(v.why, /does not descend from the pin/);
});

test("ancestryIn: a shallow checkout that holds the old pin, cut off from it, says it cannot place it, never 'does not descend'", { skip }, (t) => {
  const o = origin(t);
  const s1 = o.commit("S1"); o.tag(1);
  o.commit("between");
  const s2 = o.commit("S2"); o.tag(2);
  // The old script's two runs: a --depth 1 clone at S1, then a --depth 1 fetch of S2.
  const dir = join(o.lab, "ingest-clones", "world-blessed");
  execFileSync("git", ["-c", "advice.detachedHead=false", "clone", "-q", "--depth", "1", "--branch", "settlement/S1", pathToFileURL(o.src).href, dir]);
  execFileSync("git", ["-C", dir, "fetch", "-q", "--depth", "1", "origin", "settlement/S2"]);
  const v = pinMove(s1, s2, ancestryIn(dir));
  assert.equal(v.move, false);
  assert.match(v.why, /this checkout cannot place the pin/, "git answered 1 at the cut, which is not a fact about the law");
});
