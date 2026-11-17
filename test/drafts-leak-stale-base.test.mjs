// drafts-leak-stale-base.test.mjs — THE READER THAT PUT OTHER HOUSEHOLDS'
// MARKS IN A RESIDENT'S `drafts` LIST.
//
// #2556, and postmark-town/postmark#2526's own defect wearing a second face.
//
// ── WHAT THE WALKS SAW ─────────────────────────────────────────────────────
//
// 2026-09-06 05:53 EDT: `read: "leave-mark"` answered `household: keeminlee,
// branch: draft/keeminlee, drafts: 18` — and fifteen were by berthillon,
// current-the-reader and histor-reeves. 2026-09-07 09:53Z, on prod: wright's
// `drafts` held `current-the-reader/the-decks` and `.../the-toucan-poster`,
// `berthillon/pistache-cone-for-julian` (DELETED) and
// `little-m-of-garrison/a-cluster-of-phaenolepis-garrisonii` (ADDED).
//
// ── WHAT IT IS NOT ─────────────────────────────────────────────────────────
//
// Not the docket store. Every `claims` reader in `src/` at the base filters on
// `household` (`pgLiveMarks`: `status = ANY($1) AND household = $2`;
// `readDraftClaims`: `status='draft' AND household=$1`), and the operator's
// prod SELECT settled the data question: those rows carry `solo:devadavisson` /
// `solo:berthillon` / `solo:kristinashoultz-wq`, never wright's `gh:67605380`,
// so no household-scoped query could return them. My earlier report inferred
// the store half and the inference was wrong.
//
// ── WHAT IT IS: THE SKETCHBOOK HALF, AGAINST A STALE BASE ──────────────────
//
// `draftDeltaForKey` computes
//
//     base      = mainRef(repo)                    ← refs/heads/main, LOCAL
//     mergeBase = git merge-base <base> <draftRef>
//     diff        <mergeBase> <draftRef> -- WORLD/marks
//
// and the Worldkeeper REBASES every `draft/<household>` onto the new main at
// each settlement. So on the box the two refs sit like this:
//
//     refs/heads/main        S58   ← moves only on the crossing-save's pull
//     draft/<household>      rebased onto S61, so S59/S60/S61 are IN ITS ANCESTRY
//
// `merge-base(S58, that)` is **S58**, and the diff from S58 to the draft branch
// therefore contains EVERY MARK EVERY HOUSEHOLD PUBLISHED AT S59, S60 AND S61 —
// as `added` — plus everything those settlements removed, as `deleted`. The
// household's own sketchbook is a handful of rows inside that.
//
// The function's own comment describes this exact class in the other direction:
//
//   "A two-dot diff reports everything main gained since divergence as
//    deletions the household is 'proposing' — the convergence's 172 published
//    marks once rendered as 171 phantom deletion intents this way."
//
// The merge-base fixed the DIRECTION and the base stayed stale, so the same
// class came back as additions. #2526 and #2556 are one defect at two doors.
//
// ── AND THE FIX IS ALREADY IN THIS BRANCH ──────────────────────────────────
//
// Commit 1 moved `draftDeltaForKey`'s base to `freshestMainRef`. With a fresh
// base the merge-base is main's own tip and the diff is the household's work.
// These legs go RED at the base and green here, which is the whole point:
// nothing new is added to fix this, and the leg is what keeps it fixed.

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tempDir } from "./helpers/temp-dir.mjs";

import { draftDeltaForKey, mainRef, freshestMainRef } from "../src/world-branches.mjs";

const repo = tempDir("postmark-drafts-leak-");
after(() => { try { rmSync(repo, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); } catch { /* litter */ } });

const git = (...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const put = (p, t) => { const f = join(repo, p); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, t); };
const commit = (m) => git("-c", "user.name=f", "-c", "user.email=f@t.invalid", "commit", "-q", "-m", m);
const mark = (by, slug, body) =>
  put(`WORLD/marks/${by}/${slug}/mark.md`, `---\nby: ${by}\nkind: thing\ndate: 2026-09-01\n---\n\n${body}\n`);

const HOUSEHOLD = "keeminlee";
const KEY = { household: HOUSEHOLD, handles: new Set(["wright", "rei"]) };

// ── the box, in a bottle ────────────────────────────────────────────────────
//
// S58 is where the crossing-save's pull last left `refs/heads/main`. S59 then
// publishes three other households' marks and removes one. The pen branch is
// REBASED onto S59, as the Worldkeeper rebases it every settlement, and carries
// exactly ONE piece of the household's own work.

git("init", "-q", "-b", "main");
put("WORLD/world-state.json", JSON.stringify({ marks: [] }));
mark("berthillon", "pistache-cone-for-julian", "a cone, published long ago");
git("add", "-A");
commit("settlement: sweep — S58");
const S58 = git("rev-parse", "HEAD").trim();

// S59: three other households publish, and one older mark comes off the world.
mark("current-the-reader", "the-decks", "the decks of the Snug Harbour");
mark("current-the-reader", "the-toucan-poster", "a toucan, above the bar");
mark("little-m-of-garrison", "a-cluster-of-phaenolepis-garrisonii", "a cluster, in the garrison");
rmSync(join(repo, "WORLD/marks/berthillon/pistache-cone-for-julian/mark.md"));
git("add", "-A");
commit("settlement: sweep 3 published, 1 unpublished — S59");
const S59 = git("rev-parse", "HEAD").trim();

// The pen branch, rebased onto S59 by the Worldkeeper, plus one mark of the
// household's own — the ONLY row that belongs in this answer.
git("switch", "-q", "-c", `draft/${HOUSEHOLD}`);
mark("wright", "the-flip-day-plumb-line", "a 1x1 sited mark on my own terrace");
git("add", "-A");
commit("mark: wright/the-flip-day-plumb-line — by wright (via world_leave_mark)");
git("switch", "-q", "main");

// THE STALE REF: `refs/heads/main` is left at S58 (where a pull left it) while
// `origin/main` is at S59 (where the tick's fetch put it). Exactly #2526.
git("update-ref", "refs/remotes/origin/main", S59);
git("update-ref", "refs/heads/main", S58);

const OTHERS = [
  "current-the-reader/the-decks",
  "current-the-reader/the-toucan-poster",
  "little-m-of-garrison/a-cluster-of-phaenolepis-garrisonii",
  "berthillon/pistache-cone-for-julian",
];
const MINE = "wright/the-flip-day-plumb-line";

// ── the red control: the fixture is the box ────────────────────────────────

test("RED CONTROL: local main lags a settlement, and the pen branch is rebased PAST it", () => {
  assert.equal(git("rev-parse", "refs/heads/main").trim(), S58, "the crossing-save's pull left main at S58");
  assert.equal(git("rev-parse", "refs/remotes/origin/main").trim(), S59, "the tick's fetch has S59");
  assert.equal(mainRef(repo), "refs/heads/main", "the WRITE path's reader still answers the stale one");
  assert.equal(freshestMainRef(repo), "refs/remotes/origin/main", "and the READ tier's answers the settlement's");
  // The rebase is what makes the leak possible: S59 is in the pen branch's own
  // ancestry, so a merge-base against S58 sits BEHIND three other households'
  // published work.
  assert.equal(
    git("merge-base", "refs/remotes/origin/main", `refs/heads/draft/${HOUSEHOLD}`).trim(), S59,
    "the pen branch is rebased onto S59 — that is what the Worldkeeper does every settlement");
  assert.equal(
    git("merge-base", "refs/heads/main", `refs/heads/draft/${HOUSEHOLD}`).trim(), S58,
    "and against the STALE base the merge-base falls back to S58, which is the whole defect");
});

// ── the leak, and its absence ──────────────────────────────────────────────

test("THE LEAK: a household's `drafts` carries only its OWN work", () => {
  const delta = draftDeltaForKey(repo, KEY);
  assert.ok(!delta.error, `the delta bounced: ${JSON.stringify(delta).slice(0, 160)}`);
  const ids = (delta.marks ?? []).map((m) => m.id);

  for (const id of OTHERS)
    assert.ok(!ids.includes(id),
      `${id} is another household's PUBLISHED mark and it is in keeminlee's drafts list — ids were ${JSON.stringify(ids)}`);
  assert.deepEqual(ids, [MINE], "one row: the mark this household actually wrote");
});

test("and the counts agree with the list — a resident is not told 18 and shown 3", () => {
  const delta = draftDeltaForKey(repo, KEY);
  assert.deepEqual(delta.counts, { added: 1, modified: 0, deleted: 0 });
});

test("THE `deleted` HALF: a mark a SETTLEMENT removed is not a deletion you proposed", () => {
  const delta = draftDeltaForKey(repo, KEY);
  const gone = (delta.marks ?? []).filter((m) => m.status === "deleted");
  assert.deepEqual(gone, [],
    "walk #9 read `berthillon/pistache-cone-for-julian` as DELETED in wright's own drafts — a mark wright never touched, unpublished by a settlement wright's base could not see");
});

test("the delta's `main` stamp names the ref it actually diffed against", () => {
  const delta = draftDeltaForKey(repo, KEY);
  assert.equal(delta.main, S59,
    "a delta computed against a stale base while reporting a fresh main would be #2526's one-stamp-for-one-answer defect, one door over");
});

// ── what the base would have answered ──────────────────────────────────────
//
// Not a second implementation: the same `git diff` the function runs, at the
// base's own ref, so the leg can SAY how many rows the defect produced rather
// than only that it produced some. If this ever stops differing from the answer
// above, the two refs have converged and this file is measuring nothing — which
// is why it asserts the gap rather than trusting it.

test("THE MEASUREMENT: against the stale base the same diff yields FOUR other households' marks", () => {
  const at = (base) => {
    const mb = git("merge-base", base, `refs/heads/draft/${HOUSEHOLD}`).trim();
    return git("diff", "--name-status", "--no-renames", mb, `refs/heads/draft/${HOUSEHOLD}`, "--", "WORLD/marks")
      .split("\n").map((l) => l.trim()).filter(Boolean);
  };
  const stale = at("refs/heads/main");
  const fresh = at("refs/remotes/origin/main");

  assert.equal(stale.length, 5, `the stale base yields ${stale.length} rows: ${JSON.stringify(stale)}`);
  assert.equal(fresh.length, 1, "the fresh base yields exactly the household's own mark");
  assert.ok(stale.some((l) => l.startsWith("D\t")),
    "including a DELETION the household never proposed — the settlement's unpublish, read as theirs");
  assert.ok(stale.some((l) => l.includes("current-the-reader/the-decks")),
    "and one of the two slugs the operator's prod SELECT found as status='draft' — which is a coincidence of identity, not the cause: what leaked here is the PUBLISHED FILE");
});
