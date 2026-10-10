// ship-guard — the two rules a pull request into main passes through (Darko,
// 2026-10-06): main takes only train/* and hotfix/*, and a train/* ship PR
// carries every commit main has. Each rule is flipped red here at least once;
// the git half runs against a scratch repository, never this one.

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync, execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { openTrain, judgeBase, judgeTrainContainsMain, mainCommitsMissing } from "../tools/ship-guard.mjs";

const TOOL = resolve(dirname(fileURLToPath(import.meta.url)), "..", "tools", "ship-guard.mjs");
const day = (s) => new Date(`${s}T00:00:00Z`);
const TUE = day("2026-10-06"); // a Tuesday of release week 41; the open train is w42

test("the open train is the current release week plus one, and rolls on Sunday", () => {
  assert.equal(openTrain(TUE), "train/2026-w42");
  assert.equal(openTrain(day("2026-10-10")), "train/2026-w42"); // Saturday, still week 41
  assert.equal(openTrain(day("2026-10-11")), "train/2026-w43"); // Sunday: w42 ships, w43 opens
});

test("the base guard: main takes train/* and hotfix/*, refs/heads/ prefixes allowed", () => {
  for (const head of ["train/2026-w42", "hotfix/w41.5-housemate-stake", "refs/heads/hotfix/x"]) {
    assert.equal(judgeBase({ base: "main", head, on: TUE }).ok, true, head);
  }
});

test("the base guard refuses any other head into main, and names the open train", () => {
  for (const head of ["plumb/pos330-repos-rooms", "wright/front-door-plain-words", "main", "release/2026-w41", "train/", "hotfix"]) {
    const v = judgeBase({ base: "refs/heads/main", head, on: TUE });
    assert.equal(v.ok, false, head);
    assert.match(v.hint, /retarget to train\/2026-w42/);
  }
});

test("the base guard leaves PRs into any other base alone", () => {
  assert.equal(judgeBase({ base: "train/2026-w42", head: "plumb/anything", on: TUE }).ok, true);
});

test("train contains main: refused when main has commits the train lacks, lawful when none", () => {
  const red = judgeTrainContainsMain({ base: "main", head: "train/2026-w42", missing: ["bee1201 posts: a housemate may change a post"] });
  assert.equal(red.ok, false);
  assert.match(red.defect, /lacks 1 commit\(s\) that main has/);
  assert.match(red.defect, /bee1201/);
  assert.match(red.hint, /merge main into the train/);
  assert.equal(judgeTrainContainsMain({ base: "main", head: "train/2026-w42", missing: [] }).ok, true);
  // not a ship PR: the rule does not apply, whatever main has
  assert.equal(judgeTrainContainsMain({ base: "main", head: "hotfix/x", missing: ["a b"] }).ok, true);
  assert.equal(judgeTrainContainsMain({ base: "train/2026-w42", head: "train/2026-w43", missing: ["a b"] }).ok, true);
});

test("train contains main lists at most ten commits and counts the rest", () => {
  const missing = Array.from({ length: 13 }, (_, i) => `c${i} subject ${i}`);
  const v = judgeTrainContainsMain({ base: "main", head: "train/2026-w42", missing });
  assert.match(v.defect, /lacks 13 commit/);
  assert.match(v.defect, /c9 subject 9/);
  assert.doesNotMatch(v.defect, /c10 subject/);
  assert.match(v.defect, /and 3 more/);
});

// ── the git half, against a scratch repository ──────────────────────────────
function scratchRepo() {
  const dir = mkdtempSync(join(tmpdir(), "ship-guard-"));
  const git = (...a) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...a], { cwd: dir, encoding: "utf8" }).trim();
  git("init", "-q", "-b", "main");
  writeFileSync(join(dir, "a.txt"), "1\n"); git("add", "."); git("commit", "-qm", "the w41 ship");
  git("branch", "train/2026-w42");
  writeFileSync(join(dir, "b.txt"), "hotfix\n"); git("add", "."); git("commit", "-qm", "hotfix: w41.2");
  return { dir, git };
}

test("mainCommitsMissing reads the hotfix the train lacks, and nothing once the train takes main", (t) => {
  const { dir, git } = scratchRepo();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const before = mainCommitsMissing({ headRev: "train/2026-w42", mainRef: "main", cwd: dir });
  assert.equal(before.length, 1);
  assert.match(before[0], /hotfix: w41\.2$/);
  git("checkout", "-q", "train/2026-w42");
  git("merge", "-q", "--no-edit", "main");
  assert.deepEqual(mainCommitsMissing({ headRev: "train/2026-w42", mainRef: "main", cwd: dir }), []);
});

test("the CLI: exit 1 with the refusal on both rules, exit 0 when lawful, exit 2 when it cannot run", (t) => {
  const { dir, git } = scratchRepo();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const run = (...a) => spawnSync(process.execPath, [TOOL, ...a, "--on", "2026-10-06"], { cwd: dir, encoding: "utf8" });

  const feature = run("--base", "main", "--head", "plumb/pos330-repos-rooms");
  assert.equal(feature.status, 1);
  assert.match(feature.stderr, /REFUSED · a pull request into main from plumb\/pos330-repos-rooms/);
  assert.match(feature.stderr, /retarget to train\/2026-w42/);

  const behind = run("--base", "main", "--head", "train/2026-w42", "--main-ref", "main");
  assert.equal(behind.status, 1);
  assert.match(behind.stderr, /REFUSED · train\/2026-w42 lacks 1 commit\(s\) that main has/);
  assert.match(behind.stderr, /merge main into the train/);

  git("checkout", "-q", "train/2026-w42");
  git("merge", "-q", "--no-edit", "main");
  const ship = run("--base", "main", "--head", "train/2026-w42", "--main-ref", "main");
  assert.equal(ship.status, 0, ship.stderr);
  assert.match(ship.stdout, /contains every commit on main/);

  assert.equal(run("--base", "train/2026-w42", "--head", "plumb/x").status, 0);
  assert.equal(run("--base", "main", "--head", "train/2026-w42", "--main-ref", "no-such-ref").status, 2);
  assert.equal(run("--head", "train/2026-w42").status, 2);
});
