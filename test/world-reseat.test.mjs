// The pen reseats on a moving origin. The Worldkeeper rewrites every draft
// branch at each Settlement (rebase onto new main + force-with-lease), so the
// office checkout must fetch and reseat before writing — fast-forward when
// merely behind, rebase when it holds unpushed (stranded) commits. The
// white-flower incident of 2026-07-30 is the proof case: a mark committed onto
// replaced history, push rejected non-fast-forward, commit stranded local-only.

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { ensureDraftCheckout } from "../src/world-branches.mjs";
// Imported for its side effect too: every git below (ensureDraftCheckout's
// included) runs its auto-maintenance in the foreground, so no detached child
// is still writing pen/.git/objects when after() removes it (POS-580).
import { removeTempDirSync } from "./helpers/temp-dir.mjs";

const root = mkdtempSync(join(tmpdir(), "postmark-reseat-"));
after(() => removeTempDirSync(root));

const g = (repo, ...args) => execFileSync("git", [
  "-C", repo,
  "-c", "user.email=test@postmark.town", "-c", "user.name=reseat-test",
  ...args,
], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

const put = (repo, path, text) => {
  const full = join(repo, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, text);
};

// One bare origin; "keeper" and "pen" are two working clones of it.
const origin = join(root, "origin.git");
const keeper = join(root, "keeper");
const pen = join(root, "pen");

const seed = join(root, "seed");
mkdirSync(seed);
g(seed, "init", "-q", "-b", "main");
put(seed, "WORLD/base.md", "the world\n");
g(seed, "add", "-A");
g(seed, "commit", "-q", "-m", "world: base");
g(seed, "branch", "draft/alpha", "main");
execFileSync("git", ["clone", "-q", "--bare", seed, origin], { stdio: ["ignore", "pipe", "pipe"] });
execFileSync("git", ["clone", "-q", origin, keeper], { stdio: ["ignore", "pipe", "pipe"] });
execFileSync("git", ["clone", "-q", origin, pen], { stdio: ["ignore", "pipe", "pipe"] });

test("the pen's git runs its auto-maintenance in the foreground, so nothing outlives a call into after() (POS-580)", () => {
  for (const key of ["gc.autoDetach", "maintenance.autoDetach"]) {
    assert.equal(g(pen, "config", "--get", key), "false", `${key}: a detached child would still be writing pen/.git/objects at teardown`);
  }
});

test("stranded local commit is rebased onto the Worldkeeper's rewritten branch and pushes clean", () => {
  // The pen writes a mark on draft/alpha and pushes it... except this one
  // never pushed (the stranding): commit locally only.
  ensureDraftCheckout(pen, "alpha");
  put(pen, "WORLD/marks/rei/white-flower/mark.md", "a white flower\n");
  g(pen, "add", "-A");
  g(pen, "commit", "-q", "-m", "mark: rei/white-flower");
  const stranded = g(pen, "rev-parse", "HEAD");

  // Settlement: keeper advances main and rewrites draft/alpha onto it.
  g(keeper, "switch", "-q", "main");
  put(keeper, "WORLD/settled.md", "S1 published things\n");
  g(keeper, "add", "-A");
  g(keeper, "commit", "-q", "-m", "settlement: S1");
  g(keeper, "push", "-q", "origin", "main");
  g(keeper, "branch", "-f", "draft/alpha", "main");
  g(keeper, "push", "-q", "--force", "origin", "draft/alpha");

  // The next write seats the pen: it must fetch, see the rewrite, and replay
  // the stranded commit on top of it.
  const branch = ensureDraftCheckout(pen, "alpha");
  assert.equal(branch, "draft/alpha");
  assert.equal(g(pen, "branch", "--show-current"), "draft/alpha");

  const remoteTip = g(pen, "rev-parse", "refs/remotes/origin/draft/alpha");
  // remote tip is now an ancestor of HEAD (we sit on the rewritten history)...
  g(pen, "merge-base", "--is-ancestor", remoteTip, "HEAD");
  // ...the stranded mark survived the replay (as a new commit, not the old sha)...
  assert.notEqual(g(pen, "rev-parse", "HEAD"), stranded);
  assert.equal(g(pen, "show", "HEAD:WORLD/marks/rei/white-flower/mark.md"), "a white flower");
  // ...and the settled file from the rewrite is present too.
  assert.equal(g(pen, "show", "HEAD:WORLD/settled.md"), "S1 published things");

  // The push that used to bounce non-fast-forward now lands.
  g(pen, "push", "-q", "origin", "draft/alpha");
  assert.equal(
    g(pen, "rev-parse", "HEAD"),
    execFileSync("git", ["-C", origin, "rev-parse", "refs/heads/draft/alpha"], { encoding: "utf8" }).trim(),
  );
});

test("a clean pen merely behind an advanced branch fast-forwards to it", () => {
  // The branch moves forward WITHOUT a rewrite (old tip is an ancestor of the
  // new one) while the pen holds nothing unpushed — the reseat is a plain
  // fast-forward, no rebase.
  g(keeper, "fetch", "-q", "origin");
  g(keeper, "switch", "-q", "draft/alpha");
  g(keeper, "reset", "-q", "--hard", "origin/draft/alpha");
  put(keeper, "WORLD/marks/alpha/second-mark/mark.md", "a second mark\n");
  g(keeper, "add", "-A");
  g(keeper, "commit", "-q", "-m", "mark: alpha/second-mark");
  g(keeper, "push", "-q", "origin", "draft/alpha");
  g(keeper, "switch", "-q", "main");
  put(keeper, "WORLD/settled2.md", "S2 published things\n");
  g(keeper, "add", "-A");
  g(keeper, "commit", "-q", "-m", "settlement: S2");
  g(keeper, "push", "-q", "origin", "main");

  ensureDraftCheckout(pen, "alpha");
  assert.equal(g(pen, "rev-parse", "HEAD"), g(pen, "rev-parse", "refs/remotes/origin/draft/alpha"));
  // the local main ref was carried forward too — draft deltas measure against it
  assert.equal(g(pen, "rev-parse", "main"), g(pen, "rev-parse", "refs/remotes/origin/main"));
});

// Tier 1: the pen may be a leased WORKTREE of the same clone. Same reseat, two
// differences that only exist because the shared clone is standing right there
// holding main — the branch switch must tolerate an idle slot still parked on
// the branch, and the local main ref can no longer be forced from the worktree.
test("a pooled worktree reseats on origin and advances main through the shared clone it may not force", () => {
  g(pen, "switch", "-q", "main"); // where world-pool's normalisation leaves it
  const wt = join(root, "pool-wt");
  g(pen, "worktree", "add", "--quiet", "--detach", wt, "refs/heads/main");

  // a Settlement moves origin/main on
  g(keeper, "switch", "-q", "main");
  g(keeper, "pull", "-q", "--ff-only");
  put(keeper, "WORLD/settled4.md", "S4 published things\n");
  g(keeper, "add", "-A");
  g(keeper, "commit", "-q", "-m", "settlement: S4");
  g(keeper, "push", "-q", "origin", "main");

  const staleMain = g(pen, "rev-parse", "refs/heads/main");
  const branch = ensureDraftCheckout(wt, "beta", { pooled: true, shared: pen });
  assert.equal(branch, "draft/beta");
  assert.equal(g(wt, "branch", "--show-current"), "draft/beta");
  assert.equal(g(pen, "branch", "--show-current"), "main", "the shared clone was not dragged onto the household branch");

  // `git branch -f main` from the worktree is refused (main is checked out in
  // the shared clone), so the fallback fast-forwards that clone instead — and
  // local main, which mainRef prefers and every draft delta measures against,
  // stays honest.
  assert.notEqual(g(pen, "rev-parse", "refs/heads/main"), staleMain);
  assert.equal(g(pen, "rev-parse", "refs/heads/main"), g(pen, "rev-parse", "refs/remotes/origin/main"));

  // and the branch the worktree holds is no obstacle to seating it again later
  g(pen, "worktree", "add", "--quiet", "--detach", join(root, "pool-wt-2"), "refs/heads/main");
  assert.equal(ensureDraftCheckout(join(root, "pool-wt-2"), "beta", { pooled: true, shared: pen }), "draft/beta");
});

test("a pooled lease heals what the last write abandoned, rather than refusing to start", () => {
  const wt = join(root, "pool-wt");
  writeFileSync(join(wt, "WORLD", "junk.md"), "a write that never finished\n");
  writeFileSync(join(wt, "WORLD", "base.md"), "clobbered\n");
  assert.equal(ensureDraftCheckout(wt, "beta", { pooled: true, shared: pen }), "draft/beta");
  assert.equal(existsSync(join(wt, "WORLD", "junk.md")), false, "untracked leftovers are cleaned");
  assert.equal(readFileSync(join(wt, "WORLD", "base.md"), "utf8").trim(), "the world", "tracked damage is reset");
  // the un-pooled pen keeps refusing: its checkout is nobody's to trample
  writeFileSync(join(pen, "WORLD", "base.md"), "clobbered\n");
  assert.throws(() => ensureDraftCheckout(pen, "alpha"), /not clean before branch selection/);
  g(pen, "checkout", "-q", "--", "WORLD/base.md");
});

test("a rewrite that already CONTAINS the pen's unpushed work drops it cleanly (the publish case)", () => {
  // Real settlement: the Worldkeeper publishes a draft mark into main, then
  // rewrites the draft branch onto that main. The pen still holds the original
  // unpushed commit — rebase must recognize the patch as already applied and
  // land the pen exactly on the rewritten tip, not duplicate the mark.
  ensureDraftCheckout(pen, "alpha");
  put(pen, "WORLD/marks/alpha/third-mark/mark.md", "a third mark\n");
  g(pen, "add", "-A");
  g(pen, "commit", "-q", "-m", "mark: alpha/third-mark");
  // stranded: not pushed

  // keeper "publishes" it into main (same content lands there)…
  g(keeper, "switch", "-q", "main");
  put(keeper, "WORLD/marks/alpha/third-mark/mark.md", "a third mark\n");
  g(keeper, "add", "-A");
  g(keeper, "commit", "-q", "-m", "settlement: S3 publishes alpha/third-mark");
  g(keeper, "push", "-q", "origin", "main");
  // …and rewrites draft/alpha onto the new main
  g(keeper, "branch", "-f", "draft/alpha", "main");
  g(keeper, "push", "-q", "--force", "origin", "draft/alpha");

  ensureDraftCheckout(pen, "alpha");
  const remoteTip = g(pen, "rev-parse", "refs/remotes/origin/draft/alpha");
  // the pen sits on the rewritten history…
  g(pen, "merge-base", "--is-ancestor", remoteTip, "HEAD");
  // …the published mark's stranded twin was recognized as already applied and
  // dropped (no duplicate commit ahead of the remote)…
  const ahead = g(pen, "log", "--format=%s", `${remoteTip}..HEAD`).split(/\r?\n/).filter(Boolean);
  assert.ok(!ahead.some((s) => s.includes("third-mark")), `third-mark duplicate survived the reseat: ${ahead.join(" | ")}`);
  // …its content is present via the publish, other unpushed work still rides
  // ahead (this rewrite dropped it keeper-side; the pen re-proposes it), and
  // the push lands.
  assert.equal(g(pen, "show", "HEAD:WORLD/marks/alpha/third-mark/mark.md"), "a third mark");
  g(pen, "push", "-q", "origin", "draft/alpha");
});

test("a rewrite that AMENDED the pen's pushed mark resets to origin instead of replaying the ghost against its twin (#1774)", () => {
  // The pen writes a mark and PUSHES it — a normal completed write. The push
  // stamps the remote-tracking ref's reflog: the clone now remembers this
  // commit was on origin.
  ensureDraftCheckout(pen, "alpha");
  put(pen, "WORLD/marks/alpha/garden-gate/mark.md", "position: 10,10\nthe garden gate\n");
  g(pen, "add", "-A");
  g(pen, "commit", "-q", "-m", "mark: alpha/garden-gate");
  g(pen, "push", "-q", "origin", "draft/alpha");

  // Settlement with a machinery sweep: the keeper rewrites draft/alpha onto a
  // new main and carries the mark forward AMENDED (a tense sweep re-derives
  // its coordinates). The ghost's twin no longer patch-id-matches, so the old
  // ceremony replayed the ghost against it here — conflict, abort, bounce:
  // vermillion's "a draft branch that wouldn't reseat".
  g(keeper, "fetch", "-q", "origin");
  g(keeper, "switch", "-q", "main");
  g(keeper, "pull", "-q", "--ff-only");
  put(keeper, "WORLD/settled5.md", "S5 published things\n");
  g(keeper, "add", "-A");
  g(keeper, "commit", "-q", "-m", "settlement: S5");
  g(keeper, "push", "-q", "origin", "main");
  g(keeper, "branch", "-f", "draft/alpha", "main");
  g(keeper, "switch", "-q", "draft/alpha");
  put(keeper, "WORLD/marks/alpha/garden-gate/mark.md", "position: 12,9\nthe garden gate\n");
  g(keeper, "add", "-A");
  g(keeper, "commit", "-q", "-m", "mark: alpha/garden-gate (tense sweep: coordinates re-derived)");
  g(keeper, "push", "-q", "--force", "origin", "draft/alpha");
  g(keeper, "switch", "-q", "main");

  // The next write seats cleanly on the rewritten tip — no replay, no throw.
  const branch = ensureDraftCheckout(pen, "alpha");
  assert.equal(branch, "draft/alpha");
  const remoteTip = g(pen, "rev-parse", "refs/remotes/origin/draft/alpha");
  assert.equal(g(pen, "rev-parse", "HEAD"), remoteTip, "pen lands exactly on the rewritten tip, ghosts dropped");
  assert.equal(
    g(pen, "show", "HEAD:WORLD/marks/alpha/garden-gate/mark.md").split(/\r?\n/)[0],
    "position: 12,9",
    "the Settlement's amendment is canon; the ghost did not fight the ruling",
  );
  // and the household's next write flows.
  put(pen, "WORLD/marks/alpha/garden-gate-latch/mark.md", "the latch\n");
  g(pen, "add", "-A");
  g(pen, "commit", "-q", "-m", "mark: alpha/garden-gate-latch");
  g(pen, "push", "-q", "origin", "draft/alpha");
});

test("a never-pushed commit alongside an amended twin still bounces loudly — and survives the abort (the precious case keeps its guard)", () => {
  // One pushed mark (will be amended keeper-side) + one crashed write (never
  // pushed). The reflog can vouch for the first ghost but not the second, so
  // the reseat must take the rebase path, hit the amended-twin conflict, and
  // throw — WITHOUT losing the never-pushed work.
  ensureDraftCheckout(pen, "alpha");
  put(pen, "WORLD/marks/alpha/lantern/mark.md", "wick: short\nthe lantern\n");
  g(pen, "add", "-A");
  g(pen, "commit", "-q", "-m", "mark: alpha/lantern");
  g(pen, "push", "-q", "origin", "draft/alpha");
  put(pen, "WORLD/marks/alpha/lantern-hook/mark.md", "the hook\n");
  g(pen, "add", "-A");
  g(pen, "commit", "-q", "-m", "mark: alpha/lantern-hook");
  // crashed here: lantern-hook never pushed

  g(keeper, "fetch", "-q", "origin");
  g(keeper, "switch", "-q", "main");
  g(keeper, "pull", "-q", "--ff-only");
  put(keeper, "WORLD/settled6.md", "S6 published things\n");
  g(keeper, "add", "-A");
  g(keeper, "commit", "-q", "-m", "settlement: S6");
  g(keeper, "push", "-q", "origin", "main");
  g(keeper, "branch", "-f", "draft/alpha", "main");
  g(keeper, "switch", "-q", "draft/alpha");
  put(keeper, "WORLD/marks/alpha/lantern/mark.md", "wick: long\nthe lantern\n");
  g(keeper, "add", "-A");
  g(keeper, "commit", "-q", "-m", "mark: alpha/lantern (sweep: wick re-derived)");
  g(keeper, "push", "-q", "--force", "origin", "draft/alpha");
  g(keeper, "switch", "-q", "main");

  assert.throws(() => ensureDraftCheckout(pen, "alpha"), /never-pushed work/);
  // the abort left the precious commit intact on the local branch
  assert.equal(g(pen, "show", "draft/alpha:WORLD/marks/alpha/lantern-hook/mark.md"), "the hook");
  // clean up for any later test: surrender the branch to origin by hand (the
  // documented operator remedy for the compound case)
  g(pen, "switch", "-q", "draft/alpha");
  g(pen, "reset", "-q", "--hard", "refs/remotes/origin/draft/alpha");
});

test("a ghost vouched only DEEP in the reflog still resets — the vouching scan has no entry cap (review finding 1)", () => {
  // A resident writes once, then is away for weeks while the reflog churns.
  // The capped newest-50 scan silently expired here and re-minted the #1774
  // bounce; the one-call predicate must not.
  ensureDraftCheckout(pen, "alpha");
  put(pen, "WORLD/marks/alpha/weathervane/mark.md", "facing: north\nthe weathervane\n");
  g(pen, "add", "-A");
  g(pen, "commit", "-q", "-m", "mark: alpha/weathervane");
  g(pen, "push", "-q", "origin", "draft/alpha");

  // Bury the vouching entry: 60 reflog entries land on top of it (update-ref
  // writes an entry per actual change; alternate two OLD shas so the ghost's
  // own sha is never one of the fresh entries).
  const old1 = g(pen, "rev-parse", "HEAD~1");
  const old2 = g(pen, "rev-parse", "HEAD~2");
  for (let i = 0; i < 30; i++) {
    g(pen, "update-ref", "refs/remotes/origin/draft/alpha", old1);
    g(pen, "update-ref", "refs/remotes/origin/draft/alpha", old2);
  }

  // Settlement: the keeper amends the weathervane AND relocates it (the
  // vermillions-landing shape — moved districts) on a rewritten branch.
  g(keeper, "fetch", "-q", "origin");
  g(keeper, "switch", "-q", "main");
  g(keeper, "pull", "-q", "--ff-only");
  put(keeper, "WORLD/settled7.md", "S7 published things\n");
  g(keeper, "add", "-A");
  g(keeper, "commit", "-q", "-m", "settlement: S7");
  g(keeper, "push", "-q", "origin", "main");
  g(keeper, "branch", "-f", "draft/alpha", "main");
  g(keeper, "switch", "-q", "draft/alpha");
  put(keeper, "WORLD/marks/alpha/the-north-post/weathervane/mark.md", "facing: north-north-east\nthe weathervane\n");
  g(keeper, "add", "-A");
  g(keeper, "commit", "-q", "-m", "mark: alpha/weathervane relocated to the-north-post (sweep)");
  g(keeper, "push", "-q", "--force", "origin", "draft/alpha");
  g(keeper, "switch", "-q", "main");

  const branch = ensureDraftCheckout(pen, "alpha"); // must NOT throw
  assert.equal(branch, "draft/alpha");
  const remoteTip = g(pen, "rev-parse", "refs/remotes/origin/draft/alpha");
  assert.equal(g(pen, "rev-parse", "HEAD"), remoteTip, "deep-vouched ghost reset cleanly; no cap re-minted the bounce");
  assert.equal(
    g(pen, "show", "HEAD:WORLD/marks/alpha/the-north-post/weathervane/mark.md").split(/\r?\n/)[0],
    "facing: north-north-east",
    "the relocated, amended twin is canon",
  );
  assert.throws(
    () => g(pen, "show", "HEAD:WORLD/marks/alpha/weathervane/mark.md"),
    /exists on disk, but not in|does not exist|fatal/,
    "the old path is gone — the relocation was not fought",
  );
});

test("a pushed mark the rewrite DROPS is surrendered — and the pre-reset tip is recoverable at @{1} (review finding 3)", () => {
  ensureDraftCheckout(pen, "alpha");
  put(pen, "WORLD/marks/alpha/bench/mark.md", "the bench\n");
  g(pen, "add", "-A");
  g(pen, "commit", "-q", "-m", "mark: alpha/bench");
  g(pen, "push", "-q", "origin", "draft/alpha");
  const preReset = g(pen, "rev-parse", "HEAD");

  // Settlement rewrite that simply does not carry the bench forward:
  // keeper-side removal is a ruling too, and origin is canon.
  g(keeper, "fetch", "-q", "origin");
  g(keeper, "switch", "-q", "main");
  g(keeper, "pull", "-q", "--ff-only");
  put(keeper, "WORLD/settled8.md", "S8 published things\n");
  g(keeper, "add", "-A");
  g(keeper, "commit", "-q", "-m", "settlement: S8");
  g(keeper, "push", "-q", "origin", "main");
  g(keeper, "branch", "-f", "draft/alpha", "main");
  g(keeper, "push", "-q", "--force", "origin", "draft/alpha");

  ensureDraftCheckout(pen, "alpha");
  const remoteTip = g(pen, "rev-parse", "refs/remotes/origin/draft/alpha");
  assert.equal(g(pen, "rev-parse", "HEAD"), remoteTip, "the drop is surrendered, not fought");
  assert.throws(() => g(pen, "show", "HEAD:WORLD/marks/alpha/bench/mark.md"), /does not exist|fatal/);
  // The recovery pointer is the SHA (the log prints it) — a relative @{N}
  // decays as soon as the write's own commit moves the branch, which is
  // exactly when an operator would be reading the journal. Prove the sha
  // contract survives a subsequent write:
  assert.equal(g(pen, "show", `${preReset}:WORLD/marks/alpha/bench/mark.md`), "the bench");
  put(pen, "WORLD/marks/alpha/stool/mark.md", "the stool\n");
  g(pen, "add", "-A");
  g(pen, "commit", "-q", "-m", "mark: alpha/stool (the write continues after the surrender)");
  assert.equal(
    g(pen, "show", `${preReset}:WORLD/marks/alpha/bench/mark.md`),
    "the bench",
    "recovery by sha still works after the branch has moved on",
  );
  // put the branch back where origin expects it for later tests
  g(pen, "reset", "-q", "--hard", "refs/remotes/origin/draft/alpha");
});

test("with nothing to vouch, the bounce names the unvouched commits and BOTH readings — never a cause it didn't establish (review finding 2)", () => {
  ensureDraftCheckout(pen, "alpha");
  put(pen, "WORLD/marks/alpha/sundial/mark.md", "hour: noon\nthe sundial\n");
  g(pen, "add", "-A");
  g(pen, "commit", "-q", "-m", "mark: alpha/sundial");
  g(pen, "push", "-q", "origin", "draft/alpha");

  g(keeper, "fetch", "-q", "origin");
  g(keeper, "switch", "-q", "main");
  g(keeper, "pull", "-q", "--ff-only");
  put(keeper, "WORLD/settled9.md", "S9 published things\n");
  g(keeper, "add", "-A");
  g(keeper, "commit", "-q", "-m", "settlement: S9");
  g(keeper, "push", "-q", "origin", "main");
  g(keeper, "branch", "-f", "draft/alpha", "main");
  g(keeper, "switch", "-q", "draft/alpha");
  put(keeper, "WORLD/marks/alpha/sundial/mark.md", "hour: dusk\nthe sundial\n");
  g(keeper, "add", "-A");
  g(keeper, "commit", "-q", "-m", "mark: alpha/sundial (sweep: hour re-derived)");
  g(keeper, "push", "-q", "--force", "origin", "draft/alpha");
  g(keeper, "switch", "-q", "main");

  // Erase the vouching record: the pushed ghost becomes unprovable, exactly
  // like a fresh clone or expired entries.
  g(pen, "reflog", "expire", "--expire=now", "refs/remotes/origin/draft/alpha");

  assert.throws(
    () => ensureDraftCheckout(pen, "alpha"),
    (e) =>
      /unvouched local commit/.test(e.message) &&
      /never-pushed work/.test(e.message) &&
      /reflog could not vouch/.test(e.message),
    "the message states both readings and picks neither",
  );
  // clean up: the operator remedy for a vouch-starved diverged branch whose
  // origin is canonical
  g(pen, "switch", "-q", "draft/alpha");
  g(pen, "reset", "-q", "--hard", "refs/remotes/origin/draft/alpha");
});
