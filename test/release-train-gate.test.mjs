// release-train-gate.test.mjs — the release tag is cut only for the approved ship (STAR-102).
//
// On 2026-11-02 at 21:10 EST GitHub's update-branch merged train/2026-w45 into main; the merge subject named the
// train, release-train.yml cut and deployed w45.3, and it had to be restored. The gate asks GitHub which pull
// request the push's commit merged: only train/<week> → main, merged by a person, cuts.

import { test } from "node:test";
import assert from "node:assert/strict";

import { shipVerdict } from "../tools/release-train-gate.mjs";

const SHA = "abc1234def5678";
const pr = (o = {}) => ({ number: 900, merge_commit_sha: SHA, base: { ref: "main" }, head: { ref: "train/2026-w46" }, merged_at: "2026-11-08T22:00:00Z", merged_by: { login: "keeminlee", type: "User" }, ...o });

test("the approved ship cuts: train → main, merged by a person", () => {
  const v = shipVerdict([pr()], SHA, "2026-w46");
  assert.equal(v.ok, true);
  assert.match(v.why, /#900 \(train\/2026-w46 → main\), merged by keeminlee/);
});

test("the w45.3 class: an update-branch push to main has no pull request that merged it, and cuts nothing", () => {
  // update-branch on a PR whose head is main merges the base into main: the commit's PR is that one, and its
  // merge commit is not this push
  const v = shipVerdict([pr({ number: 880, head: { ref: "main" }, base: { ref: "train/2026-w45" }, merge_commit_sha: "other", merged_at: null })], SHA, "2026-w45");
  assert.equal(v.ok, false);
  assert.match(v.why, /not the merge commit of a train\/2026-w45 → main pull request/);
});

test("a direct push, or a commit no pull request touched, cuts nothing", () => {
  const v = shipVerdict([], SHA, "2026-w46");
  assert.equal(v.ok, false);
  assert.match(v.why, /no pull request merged it/);
});

test("a hotfix into main whose subject happens to name a train cuts nothing", () => {
  const v = shipVerdict([pr({ head: { ref: "hotfix/2026-w45-pos876-town-keyline" } })], SHA, "2026-w46");
  assert.equal(v.ok, false);
});

test("the train merged by a bot or an App is not the founder's approval", () => {
  const v = shipVerdict([pr({ merged_by: { login: "rivet-starforge[bot]", type: "Bot" } })], SHA, "2026-w46");
  assert.equal(v.ok, false);
  assert.match(v.why, /not a person/);
});

test("the subject's train must be the PR's train", () => {
  assert.equal(shipVerdict([pr()], SHA, "2026-w45").ok, false);
});
