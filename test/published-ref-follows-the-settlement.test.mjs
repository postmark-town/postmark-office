// published-ref-follows-the-settlement.test.mjs — the READ tier answers from
// published main, and the office's two published-main readers agree.
//
// THE LAW THIS ASSERTS, verbatim, from the ruling the office already wrote down
// (`src/world-serve.mjs § publishedMainSha`, 2026-08-17):
//
//   "mainRef()'s local-preference is right for the WRITE paths (a draft forks
//    from the freshest local line mid-settlement) and was wrong here: on
//    2026-08-17 the as-of bar read the lag backwards and reported the store
//    BEHIND a 'main' that was itself two commits stale. The published sha is
//    the DESCENDANT when the two disagree; a truly diverged pair falls to
//    origin, because published truth is what the world can clone."
//
// and, on the ref the tick moves (`deploy/office-keep.sh § under the lock`):
//
//   "The world clone gets FETCH, never pull: its checkout is the write pen's
//    (ensureDraftCheckout reseats it per-write) … Reads only need origin refs
//    freshened."
//
// ── WHAT WENT WRONG, AND WHY A SECOND READER IS THE CLASS ──────────────────
//
// That ruling was applied to `publishedMainSha` (the as-of bar) and to
// `freshestMainRef` (the engine), and NOT to `publishedState` — the function
// that produces the world every read serves. So on 2026-09-06 a mark published
// by the 05:45Z settlement came back from the focus as "no mark or terrain
// feature" for six hours, until the crossing-save's 12:02Z pull moved
// `refs/heads/main`; and the SAME answer stamped `law.as_of_world` with the
// newer sha, because `world.db` is hydrated `--ref origin/main`
// (`deploy/office-tick.sh:73`, then; deleted in POS-268 5b). One object, two
// sources, and the fresh one certified the stale one.
// postmark-town/postmark#2526.
//
// Three readers of one fact is how they drift, so the last three tests here
// BIND them: across all four states a clone can be in, `freshestMainRef` and
// `publishedMainSha` must name the same commit. If a future change moves one
// and not the other, this goes red before a resident reads a stale world.

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

import { freshestMainRef, mainRef, publishedState, publishedSkeleton } from "../src/world-branches.mjs";
import { publishedMainSha } from "../src/world-serve.mjs";

const repo = mkdtempSync(join(tmpdir(), "postmark-published-ref-"));
after(() => rmSync(repo, { recursive: true, force: true }));

const git = (...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const put = (p, t) => { const f = join(repo, p); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, t); };
const commit = (m) => git("-c", "user.name=f", "-c", "user.email=f@t.invalid", "commit", "-q", "-m", m);
const sha = (ref) => git("rev-parse", `${ref}^{commit}`).trim();

const stateWith = (ids) => JSON.stringify({ marks: ids.map((id) => ({ id, by: id.split("/")[0], kind: "thing" })) });

// ── the fixture: the box's shape ────────────────────────────────────────────
// A world clone whose local `main` is where the crossing-save last pulled it,
// whose `origin/main` is where the settlement published, and whose WORKING TREE
// is parked on a household's draft branch (what `ensureDraftCheckout` leaves).
put("WORLD/world-state.json", stateWith(["wright/the-terrace"]));
put("WORLD/skeleton.json", JSON.stringify({ regions: ["the-old-quarter"] }));
git("init", "-q", "-b", "main");
git("add", "-A");
commit("the world at the crossing-save's last pull");
const AT_PULL = sha("refs/heads/main");

// the settlement publishes a mark and pushes; the tick FETCHES it
put("WORLD/world-state.json", stateWith(["wright/the-terrace", "k-of-garrison/a-hand-beside-hers"]));
put("WORLD/skeleton.json", JSON.stringify({ regions: ["the-old-quarter", "the-harbour"] }));
git("add", "-A");
commit("settlement: sweep 1 published");
const AT_SETTLEMENT = sha("refs/heads/main");
git("update-ref", "refs/remotes/origin/main", AT_SETTLEMENT);
git("update-ref", "refs/heads/main", AT_PULL);      // local falls back to where the pull left it

// the pen parks the checkout on a draft branch, as it does after every write
git("switch", "-q", "--detach", AT_PULL);
git("switch", "-q", "-c", "draft/somebody");
put("WORLD/world-state.json", stateWith(["wright/the-terrace", "somebody/a-sketch"]));
git("add", "-A");
commit("a household's sketchbook");

test("RED CONTROL: the fixture is the box — local main lags origin, and the tree is a draft branch", () => {
  assert.equal(sha("refs/heads/main"), AT_PULL, "local main must be where the crossing-save left it");
  assert.equal(sha("refs/remotes/origin/main"), AT_SETTLEMENT, "origin/main must be where the settlement published");
  assert.notEqual(AT_PULL, AT_SETTLEMENT);
  assert.equal(git("rev-parse", "--abbrev-ref", "HEAD").trim(), "draft/somebody",
    "the working tree must be parked on a draft branch — that is what the pen leaves behind");
});

test("mainRef still prefers the local branch — the WRITE path's reader is unchanged", () => {
  assert.equal(mainRef(repo), "refs/heads/main",
    "a draft forks from the freshest local line mid-settlement; that preference is this reader's job");
});

test("the READ tier's ref follows the settlement, not the pull", () => {
  assert.equal(freshestMainRef(repo), "refs/remotes/origin/main",
    "the tick fetches and never pulls, so origin is the published truth");
});

test("publishedState answers from the settlement's world — #2526's mark is THERE", () => {
  const ps = publishedState(repo);
  assert.equal(ps.sha, AT_SETTLEMENT, "the state a read serves is the one the settlement published");
  const ids = (ps.state.marks ?? []).map((m) => m.id);
  assert.ok(ids.includes("k-of-garrison/a-hand-beside-hers"),
    'the focus said "no mark or terrain feature" about exactly this shape for six hours');
  assert.ok(!ids.includes("somebody/a-sketch"),
    "and it is not the working tree's sketchbook — a read serves canon, never the pen's checkout");
});

test("publishedSkeleton follows it too — terrain and marks must be one world", () => {
  const sk = publishedSkeleton(repo);
  assert.equal(sk.ref, "refs/remotes/origin/main");
  assert.deepEqual(sk.skeleton.regions, ["the-old-quarter", "the-harbour"],
    "a skeleton one settlement behind the state is two worlds in one answer");
});

test("ONE STAMP FOR ONE ANSWER: publishedState names the ref AND the sha it read", () => {
  const ps = publishedState(repo);
  assert.equal(ps.ref, "refs/remotes/origin/main");
  assert.match(ps.sha, /^[0-9a-f]{40}$/);
  assert.equal(ps.sha, sha(ps.ref), "the sha must be the one that ref points at, read together");
});

// ── the binding: two readers, one answer, four states ───────────────────────
//
// Each state is built by moving the two refs and asking both readers. A state
// that could not be built is skipped LOUDLY rather than passing silently.

test("BOUND · equal — both readers name the one commit", () => {
  git("update-ref", "refs/heads/main", AT_SETTLEMENT);
  git("update-ref", "refs/remotes/origin/main", AT_SETTLEMENT);
  assert.equal(sha(freshestMainRef(repo)), publishedMainSha(repo));
  assert.equal(publishedMainSha(repo), AT_SETTLEMENT);
});

test("BOUND · local behind origin (the box) — both name origin's", () => {
  git("update-ref", "refs/heads/main", AT_PULL);
  git("update-ref", "refs/remotes/origin/main", AT_SETTLEMENT);
  assert.equal(sha(freshestMainRef(repo)), publishedMainSha(repo));
  assert.equal(publishedMainSha(repo), AT_SETTLEMENT, "the published sha is the DESCENDANT when the two disagree");
});

test("BOUND · local ahead of origin (a settlement's push in flight) — both name local's", () => {
  git("update-ref", "refs/heads/main", AT_SETTLEMENT);
  git("update-ref", "refs/remotes/origin/main", AT_PULL);
  assert.equal(sha(freshestMainRef(repo)), publishedMainSha(repo));
  assert.equal(publishedMainSha(repo), AT_SETTLEMENT);
});

test("BOUND · DIVERGED (a settlement push meeting a keeper's PC push) — both fall to origin", () => {
  git("switch", "-q", "--detach", AT_PULL);
  put("WORLD/world-state.json", stateWith(["wright/the-terrace", "a/keeper-pc-line"]));
  git("add", "-A");
  commit("the keeper's PC pushed straight to GitHub");
  const OTHER = git("rev-parse", "HEAD").trim();
  git("switch", "-q", "draft/somebody");
  git("update-ref", "refs/heads/main", AT_SETTLEMENT);
  git("update-ref", "refs/remotes/origin/main", OTHER);

  // the fixture is genuinely diverged: neither is an ancestor of the other
  const anc = (a, b) => { try { execFileSync("git", ["-C", repo, "merge-base", "--is-ancestor", a, b], { stdio: "ignore" }); return true; } catch { return false; } };
  assert.equal(anc(AT_SETTLEMENT, OTHER), false, "fixture must be diverged, not merely behind");
  assert.equal(anc(OTHER, AT_SETTLEMENT), false, "fixture must be diverged, not merely ahead");

  assert.equal(sha(freshestMainRef(repo)), publishedMainSha(repo),
    "two readers of one fact must not answer differently — this is the drift that started the lane");
  assert.equal(publishedMainSha(repo), OTHER, "a truly diverged pair falls to origin");
});
