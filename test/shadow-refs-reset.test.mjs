// Falsifiers for the shadow clone's ref reset — over a REAL git repository.
//
//   node --test test/shadow-refs-reset.test.mjs
//
// ── THE LAW, AND THE THING THAT MAKES IT LOAD-BEARING ───────────────────────
//
// A rehearsal is only worth its CPU if it rehearses the town that exists.
// settlement-shadow.sh's reset walked origin's refs and reset each one:
//
//     for-each-ref … 'refs/remotes/origin/draft/*' > tips
//     while read -r ref sha; do git branch -qf "${ref#origin/}" "$sha"; done < tips
//
// A local sketchbook whose origin ref was DROPPED is in neither `fetch -p`
// (which prunes refs/remotes/* only) nor that loop. It survives untouched,
// forever. And the shadow's clone grows such branches by itself: the sweep
// CREATES a local `draft/<household>` for every household it sweeps
// (postmark-world tools/settlement-sweep.mjs:1320).
//
// What makes it matter is what the sweep READS. It unions both ref spaces when
// it looks for candidates — postmark-world tools/settlement-sweep.mjs:316-317,
// verbatim:
//
//   ...git(repo, ["for-each-ref", "--format=%(refname:short)", "refs/heads/draft/"]),
//   ...git(repo, ["for-each-ref", "--format=%(refname:short)", "refs/remotes/origin/draft/"]),
//
// So the residue is swept as a live drawer, and the verdict is about a town
// nobody is holding.
//
// Every test below builds an actual origin repository and an actual clone. The
// first one runs the OLD reset and watches the residue survive — the
// reproduction, not a description of one.

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tempDir } from "./helpers/temp-dir.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const RESET = join(HERE, "..", "deploy", "shadow-refs-reset.sh");

const git = (repo, ...args) =>
  execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

const heads = (repo) =>
  git(repo, "for-each-ref", "--format=%(refname:short)", "refs/heads/draft/").split("\n").filter(Boolean).sort();

const remoteDrafts = (repo) =>
  git(repo, "for-each-ref", "--format=%(refname:short)", "refs/remotes/origin/draft/").split("\n").filter(Boolean).sort();

/**
 * An origin with main and two drawers, and a clone that has swept both — which
 * is to say, a clone carrying LOCAL draft branches, exactly as the sweep leaves
 * one.
 */
function fixture() {
  const dir = tempDir("shadow-refs-");
  const origin = join(dir, "origin");
  const clone = join(dir, "clone");
  mkdirSync(origin, { recursive: true });

  git(origin, "init", "-q", "--initial-branch=main", ".");
  git(origin, "config", "user.email", "t@example.com");
  git(origin, "config", "user.name", "t");
  writeFileSync(join(origin, "WORLD.md"), "the world\n");
  git(origin, "add", "-A");
  git(origin, "commit", "-qm", "main");

  for (const h of ["alice", "bruno"]) {
    git(origin, "checkout", "-q", "-b", `draft/${h}`, "main");
    writeFileSync(join(origin, `${h}.md`), `${h}'s mark\n`);
    git(origin, "add", "-A");
    git(origin, "commit", "-qm", `${h}`);
  }
  git(origin, "checkout", "-q", "main");

  execFileSync("git", ["clone", "-q", origin, clone], { stdio: "ignore" });
  git(clone, "config", "user.email", "t@example.com");
  git(clone, "config", "user.name", "t");
  // What a sweep leaves behind: a local branch per household.
  for (const h of ["alice", "bruno"]) git(clone, "branch", "-qf", `draft/${h}`, `origin/draft/${h}`);

  return { dir, origin, clone };
}

/** Origin closes a drawer — the household settled and its branch was deleted. */
function dropDrawerOnOrigin(origin, household) {
  git(origin, "branch", "-qD", `draft/${household}`);
}

/** The reset EXACTLY as settlement-shadow.sh carried it before this fix. */
function oldReset(clone) {
  const script = [
    'set -eu',
    'git -C "$1" fetch -qp origin "+refs/heads/*:refs/remotes/origin/*"',
    'git -C "$1" checkout -qf -B main origin/main',
    'git -C "$1" clean -fdq',
    'git -C "$1" for-each-ref --format="%(refname:short) %(objectname)" "refs/remotes/origin/draft/*" > "$2"',
    'while read -r ref sha; do [ -n "$ref" ] || continue; git -C "$1" branch -qf "${ref#origin/}" "$sha"; done < "$2"',
  ].join("\n");
  const tips = join(tempDir("oldtips-"), "tips");
  execFileSync("sh", ["-c", script, "sh", clone, tips], { stdio: "ignore" });
}

function newReset(clone) {
  execFileSync("sh", [RESET, clone], { stdio: ["ignore", "ignore", "pipe"] });
}

// ── §0 THE REPRODUCTION ─────────────────────────────────────────────────────

test("THE REPRODUCTION: under the OLD reset, a drawer origin has closed survives in the clone forever", () => {
  const { origin, clone } = fixture();
  assert.deepEqual(heads(clone), ["draft/alice", "draft/bruno"], "the fixture is not a swept clone");

  dropDrawerOnOrigin(origin, "bruno");
  oldReset(clone);

  // The fetch's prune did its job on the REMOTE side…
  assert.deepEqual(remoteDrafts(clone), ["origin/draft/alice"],
    "the prune did not run — this test would then prove nothing about the local side");
  // …and the local branch is still standing, which is the bug.
  assert.deepEqual(heads(clone), ["draft/alice", "draft/bruno"],
    "the residue did not survive, so the old reset was not the shape being replaced");

  // And it is not inert: it is exactly what settlement-sweep.mjs:316 enumerates.
  assert.ok(heads(clone).includes("draft/bruno"),
    "a drawer nobody is holding is in the ref space the sweep unions for candidates");
});

// ── §1 THE FIX ──────────────────────────────────────────────────────────────

test("the new reset DROPS the residue, and says which one it dropped", () => {
  const { origin, clone } = fixture();
  dropDrawerOnOrigin(origin, "bruno");

  // stderr redirected by the shell rather than captured from a throw: the reset
  // SUCCEEDS here, so a harness that only kept stderr from failures would have
  // nothing to assert the narration against.
  const errFile = join(tempDir("reseterr-"), "err.txt");
  execFileSync("sh", ["-c", 'sh "$1" "$2" 2> "$3"', "sh", RESET, clone, errFile], { stdio: "ignore" });
  const said = readFileSync(errFile, "utf8");

  assert.deepEqual(heads(clone), ["draft/alice"], "the residue is still standing");
  assert.deepEqual(remoteDrafts(clone), ["origin/draft/alice"]);
  assert.match(said, /draft\/bruno is no longer a drawer on origin/,
    "a rehearsal that quietly corrects itself teaches nobody that it had been judging a drawer that was gone");
});

test("a drawer origin STILL holds is kept and reset to origin's tip, never dropped", () => {
  // The control. A reset that dropped everything would make the rehearsal
  // trivially correct and completely useless — it would sweep an empty town.
  const { origin, clone } = fixture();

  // Origin moves alice on; the clone is stale by one commit.
  git(origin, "checkout", "-q", "draft/alice");
  writeFileSync(join(origin, "alice2.md"), "a second mark\n");
  git(origin, "add", "-A");
  git(origin, "commit", "-qm", "alice again");
  git(origin, "checkout", "-q", "main");
  const tip = git(origin, "rev-parse", "draft/alice");

  newReset(clone);

  assert.deepEqual(heads(clone), ["draft/alice", "draft/bruno"], "a live drawer was dropped");
  assert.equal(git(clone, "rev-parse", "draft/alice"), tip, "a live drawer was not brought up to origin's tip");
});

test("a local branch AHEAD of origin is still dropped here — the shadow's pen is denied", () => {
  // The half that separates this script from settlement-auto.sh's sync, which
  // KEEPS an ahead-of-origin branch because it may hold drained commits whose
  // journal rows are already truncated. The shadow publishes nothing, so a local
  // commit in its clone is scratch paper from its own last rehearsal and must
  // not be allowed to compose into the next verdict as though a resident wrote it.
  const { origin, clone } = fixture();
  git(clone, "checkout", "-q", "draft/bruno");
  writeFileSync(join(clone, "rehearsal-residue.md"), "written by a past rehearsal\n");
  git(clone, "add", "-A");
  git(clone, "commit", "-qm", "the shadow's own scratch");
  git(clone, "checkout", "-q", "main");
  const scratch = git(clone, "rev-parse", "draft/bruno");

  newReset(clone);

  assert.equal(git(clone, "rev-parse", "draft/bruno"), git(origin, "rev-parse", "draft/bruno"),
    "the rehearsal's own scratch commit survived into the next rehearsal's candidate set");
  assert.notEqual(git(clone, "rev-parse", "draft/bruno"), scratch);
});

test("main is planted on origin/main whatever the clone was standing on", () => {
  const { origin, clone } = fixture();
  git(clone, "checkout", "-q", "-B", "main", "draft/alice");
  newReset(clone);
  assert.equal(git(clone, "rev-parse", "main"), git(origin, "rev-parse", "main"));
  assert.equal(git(clone, "rev-parse", "--abbrev-ref", "HEAD"), "main");
});
