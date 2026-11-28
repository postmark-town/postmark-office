// draft-leak.mjs — did THIS household's draft work land in THAT world clone? (POS-1234, WLD-197)
//
// The real leave executor seats a draft slot for the household it acts for (world-branches.mjs § seatDraftCheckout): a branch
// `draft/<household>`, a worktree on it, and a fetch of origin. So the artifact of "the door ran in this clone" that nothing else in
// the suite can leave is a draft branch or worktree named for a household only this test uses.
//
// WHY NOT "the shared clone is unchanged": the suite runs several files at once (suite-shard.mjs --jobs 4) against ONE shared pinned clone,
// and other files (test/pos-1221-leave-mark-segments.test.mjs, for one) legitimately drive the same executor in it. A whole-clone snapshot
// compare blames this test for their writes (run 45654574072: draft/alex-rowan, a fetched origin and a moved main were pos-1221's).
// This asks only about the household this test owns, so a neighbour's writes cannot move it, and a real leak by this test always does.
import { execFileSync } from "node:child_process";

const git = (dir, ...args) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" }).trim();

/** What the draft executor left in `clone` for `household`: its branch (local or remote-tracking) and any worktree standing on it. [] = none. */
export function draftArtifactsOf(clone, household) {
  const branch = `draft/${household}`;
  const refs = git(clone, "for-each-ref", "--format=%(refname)", `refs/heads/${branch}`, `refs/remotes/origin/${branch}`).split("\n").filter(Boolean);
  const trees = git(clone, "worktree", "list", "--porcelain").split("\n\n")
    .filter((block) => block.split("\n").some((line) => line === `branch refs/heads/${branch}`))
    .map((block) => block.split("\n")[0].replace(/^worktree /, ""));
  return [...refs, ...trees.map((t) => `worktree ${t}`)];
}
