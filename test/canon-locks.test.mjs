// canon-locks.test.mjs — the falsifiers for the #2594 standing read's judgement.
//
// THE CLASS IT WATCHES (postmark#2594): the store locked a claim at a named
// candle window for a mark canon never carried, and the two records disagreed
// from the moment of locking. Three instances stood for three weeks. The reason
// nobody caught them is not that anything was quiet — it is that NOTHING WAS
// LOOKING, which is the whole argument for this instrument existing.
//
// ── THE ONE DISTINCTION EVERY TEST HERE IS ABOUT ────────────────────────────
//
// A mark the world PUBLISHED and later UNPUBLISHED also has a locked claim and no
// file in canon. That is not this class — it is the retire path's, and the retire
// path writes `status='retired'`. Getting that wrong in either direction is the
// whole failure space:
//
//   listing retired marks  → the board alarms forever on a fact the town settled
//   walking claims, not marks → 831 of 1,023 locked claims carry no slug, so the
//                               read examines 18% of the register and reports a
//                               confident three
//
// ── THE CAN-FAIL FLIP, REPRODUCIBLE ─────────────────────────────────────────
//
// In `world2/tools/canon-locks.mjs § canonLockFindings`, delete the retired
// guard so a retired mark is judged like a standing one:
//
//     -    if (r.mark_status && r.mark_status !== "standing") continue;   // § the retired mark, above
//
// The split is recorded in `docs/2026-09-08/jetto-candle-refusal-report.md`
// beside the run. The negative control is test 2: it must stay GREEN under that
// flip or it was never a control.

import { test } from "node:test";
import assert from "node:assert/strict";
import { canonLockFindings, projectedShas, unjudgeableByWindow, STANDING_SELECT, UNMATERIALIZED_SELECT, ESCROW_BY_SHA_SELECT, ESCROW_OLDEST_SELECT } from "../world2/tools/canon-locks.mjs";

const register = (...slugs) => ({ slugs: new Set(slugs), sha: "0123456789abcdef0123456789abcdef01234567" });

// The five rows the pre-cutover dump actually carries, as the store held them
// before the 2026-09-08 hand retire. Three never stood in canon; two were
// published and then let go. The shape is `marks` LEFT JOIN its claim, because
// that is what the read walks — see the file's § the denominator.
const FIVE = [
  { slug: "darko/the-second-foundation-stone", mark_status: "standing", locked_window: 154, claim_id: "2a2463c0", claim_status: "locked", window_id: 154, claimant: "darko" },
  { slug: "wright/final-unstaked", mark_status: "standing", locked_window: 155, claim_id: "03c8470b", claim_status: "locked", window_id: 155, claimant: "wright" },
  { slug: "little-bird/the-second-spoon-verdict", mark_status: "standing", locked_window: 161, claim_id: "5bc276b7", claim_status: "locked", window_id: 161, claimant: "little-bird" },
  // The two the claim-walk could not see: seed-imported, so their CLAIM carries
  // no slug at all and only `marks.slug` names them.
  { slug: "berthillon/pistache-cone-for-julian", mark_status: "standing", locked_window: 150, claim_id: "071e677e", claim_status: "locked", window_id: 150, claimant: "berthillon" },
  { slug: "the-town/pledges", mark_status: "standing", locked_window: 150, claim_id: "cd98f807", claim_status: "locked", window_id: 150, claimant: "the-town" },
];

// ── 1 · the pre-cutover state answers FIVE ─────────────────────────────────
//
// The brief predicted three. Three is what the CLAIM-walk answered, and it
// answered it while reading 188 of 1,019 marks. Five is what the register
// actually holds against world main at 91536f76.
test("before the retire, every standing mark canon has no file for is listed — five", () => {
  const r = canonLockFindings(FIVE, register("wright/the-lit-name"));
  assert.equal(r.absent.length, 5);
  assert.equal(r.compared, 5);
  assert.ok(r.absent.some((a) => a.slug === "berthillon/pistache-cone-for-julian"),
    "a seed-imported mark whose claim carries no slug must still be examined");
});

// ── 2 · after the retire, ZERO — and this is the negative control ───────────
//
// Nothing about canon changed: it still has no file for any of the five. The
// answer is zero because the MARKS are retired. A flip that removes the retired
// guard must leave this test RED and test 1 green; a control that reds when the
// feature is removed was never a control.
test("after the retire, the same marks against the same canon answer zero", () => {
  const retired = FIVE.map((r) => ({ ...r, mark_status: "retired", retired_window: 177 }));
  const r = canonLockFindings(retired, register("wright/the-lit-name"));
  assert.deepEqual(r.absent, []);
  assert.equal(r.compared, 0, "a retired mark is not compared — it is not a standing disagreement");
});

// ── 3 · the live fourth instance, found while this was built ───────────────
//
// `lupi/the-drift-room` locked at window 177 on 2026-09-08 17:45:44Z with its
// file on `origin/draft/lupi-agent` and no other ref. A draft branch is not main,
// which is the whole of what this asserts — NOT that the sweep declined it. The
// verified case of a sweep declining for seven days is
// `little-bird/the-second-spoon-verdict`.
test("a mark whose only file is on a household draft branch is canon-absent", () => {
  const r = canonLockFindings(
    [{ slug: "lupi/the-drift-room", mark_status: "standing", locked_window: 177, claim_id: "32c20578", claim_status: "locked", window_id: 177, claimant: "lupi" }],
    register("berthillon/pistache-cone-for-julian"));
  assert.deepEqual(r.absent.map((a) => a.slug), ["lupi/the-drift-room"]);
});

// ── 4 · a mark canon carries is not a finding ──────────────────────────────
test("a standing mark canon carries produces no finding, and is still compared", () => {
  const r = canonLockFindings(
    [{ slug: "current-the-reader/the-mantel", mark_status: "standing", claim_id: "c", claim_status: "locked", window_id: 176 }],
    register("current-the-reader/the-mantel"));
  assert.deepEqual(r.absent, []);
  assert.equal(r.compared, 1, "a green comparison must still count, or an empty run and a clean run look alike");
});

// ── 5 · the missing record is its own class, not folded in ─────────────────
test("a locked claim no mark carries the slug of is unmaterialized, never canon-absent", () => {
  const r = canonLockFindings([], register("nobody/never-made"), {
    unmaterializedRows: [{ claim_id: "dddddddd", window_id: 160, slug: "nobody/never-made", claimant: "nobody" }],
  });
  assert.deepEqual(r.absent, []);
  assert.deepEqual(r.unmaterialized.map((u) => u.slug), ["nobody/never-made"]);
});

// ── 6 · a mark row with no slug is not judged ──────────────────────────────
test("a row carrying no slug is skipped entirely, in both classes", () => {
  const r = canonLockFindings([{ slug: null, mark_status: "standing" }], register(),
    { unmaterializedRows: [{ claim_id: "e", window_id: 170, slug: null }] });
  assert.deepEqual(r.absent, []);
  assert.deepEqual(r.unmaterialized, []);
  assert.equal(r.compared, 0);
});

// ── 7 · the two queries read the two things they name ──────────────────────
//
// The SQL never runs in this suite, so this is the only place these can be
// asserted — and both were WRONG in the first cut, each in a way a green suite
// could not have shown:
//
//   · the subject was `claims`, whose `slug` is null on 831 of 1,023 locked rows
//   · "unmaterialized" asked whether a mark carried the CLAIM'S ID, which is
//     false of every amendment by construction (materialize.mjs § an amend
//     rewrites the mark it continues), so it reported four amendments as missing
//     records on the pre-cutover dump
test("STANDING_SELECT walks the marks, and UNMATERIALIZED_SELECT asks about the SLUG", () => {
  assert.match(STANDING_SELECT, /FROM marks m/);
  assert.match(STANDING_SELECT, /WHERE m\.status = 'standing'/);
  assert.match(STANDING_SELECT, /LEFT JOIN claims c ON c\.id = m\.id/);

  assert.match(UNMATERIALIZED_SELECT, /NOT EXISTS \(SELECT 1 FROM marks m WHERE m\.slug = coalesce\(c\.slug, c\.geometry->>'slug'\)\)/,
    "an amend claim's id is never a mark id — asking by id reports every amendment as missing");
  assert.match(UNMATERIALIZED_SELECT, /coalesce\(c\.slug, c\.geometry->>'slug'\)/,
    "darko/the-second-foundation-stone carries its slug in geometry and not in claims.slug");
});

// ── THE ESCROW CLASS (postmark#2594's second half, ruled a G1 blocker) ──────
//
// A standing COMMONS mark with nothing staked on it at the town sha of the
// window that LOCKED it — not at today's town. A mark locked at window 150 and
// one locked at 177 are answerable to different reads of the ledger, and judging
// August's marks against September's town would invent findings.
//
// THE CAN-FAIL FLIP: in `canon-locks.mjs § canonLockFindings`, delete
//
//     -    if (n === 0) unbacked.push(r);
//
// The drift-room test reds; the staked and own-ground controls stay green.

const DRIFT = {
  slug: "lupi/the-drift-room", mark_status: "standing", tier: "market",
  locked_window: 177, locking_town_sha: "723005e5", claim_id: "32c20578", claim_status: "locked", window_id: 177,
};
const anyRegister = { slugs: new Set(["lupi/the-drift-room"]), sha: "0".repeat(40) };

test("a standing COMMONS mark with nothing staked at its locking sha is unbacked", () => {
  const r = canonLockFindings([DRIFT], anyRegister, { escrowBySha: new Map([["723005e5|somebody/else", 4]]) });
  assert.deepEqual(r.unbacked.map((u) => u.slug), ["lupi/the-drift-room"]);
  assert.equal(r.escrow_checked, true);
  assert.equal(r.escrow_compared, 1);
  assert.deepEqual(r.absent, [], "canon carries it in this fixture — the two classes are independent");
});

test("the stake is read at the LOCKING window's town sha, not at another one", () => {
  // Staked at a DIFFERENT sha: that is a fact about a different read of the
  // ledger and must not excuse this mark. The first shape I considered keyed the
  // map on the mark alone, which would have silently passed this.
  //
  // MOVED 2026-09-18 (postmark#2935): the map also carries a row for the LOCKING
  // sha, on another mark. Before, this fixture's locking sha had no rows at all
  // — which now reads as unjudgeable, not unbacked (the block below) — and the
  // question this test asks needs a sha the projection actually holds.
  const r = canonLockFindings([DRIFT], anyRegister,
    { escrowBySha: new Map([["e34e5fa0|lupi/the-drift-room", 9], ["723005e5|somebody/else", 4]]) });
  assert.deepEqual(r.unbacked.map((u) => u.slug), ["lupi/the-drift-room"]);
  const ok = canonLockFindings([DRIFT], anyRegister, { escrowBySha: new Map([["723005e5|lupi/the-drift-room", 1]]) });
  assert.deepEqual(ok.unbacked, [], "staked at its OWN locking sha, so it stands");
});

test("own ground and town law are never unbacked — the class exempts them", () => {
  const home = { ...DRIFT, slug: "current-the-reader/the-mantel", tier: "home" };
  const law = { ...DRIFT, slug: "the-town/pledges", tier: "constitution" };
  const r = canonLockFindings([home, law], { slugs: new Set([home.slug, law.slug]), sha: "0".repeat(40) },
    { escrowBySha: new Map() });
  assert.deepEqual(r.unbacked, []);
  assert.equal(r.escrow_compared, 0, "they are not commons, so they are not even compared");
});

test("NO PROJECTION IS NOT A CLEAN TOWN — nothing is judged and the run says so", () => {
  const r = canonLockFindings([DRIFT], anyRegister, { escrowBySha: null });
  assert.deepEqual(r.unbacked, []);
  assert.equal(r.escrow_checked, false);
  assert.equal(r.escrow_compared, 0);
});

test("a commons mark whose window pinned no town read cannot be judged, and is not guessed", () => {
  const r = canonLockFindings([{ ...DRIFT, locking_town_sha: null }], anyRegister, { escrowBySha: new Map() });
  assert.deepEqual(r.unbacked, []);
  assert.equal(r.escrow_compared, 0);
});

test("STANDING_SELECT reads the tier and the LOCKING window's town sha", () => {
  // Neither was in the first cut, and without them the escrow class is
  // unjudgeable — a query that does not fetch the fields the judgement needs is
  // a judgement that silently finds nothing.
  assert.match(STANDING_SELECT, /m\.data->>'tier' AS tier/);
  assert.match(STANDING_SELECT, /LEFT JOIN windows w ON w\.id = m\.locked_window/);
  assert.match(STANDING_SELECT, /w\.town_sha AS locking_town_sha/);
  assert.match(ESCROW_BY_SHA_SELECT, /GROUP BY town_sha, mark/);
});

// ── THE UNJUDGEABLE WINDOW (postmark#2935; 2026-09-18) ──────────────────────
//
// `escrowBySha.get(...) ?? 0` read a sha the projection NEVER HELD as ✦0. The
// projection's oldest row is window 181 (2026-09-10T17:45Z, migration 014's
// first ingest); 227 standing commons marks lock at windows 150–179, and every
// one of them read ESCROW-ABSENT on the roll-call every morning for eight
// nights — 233 on 09-18, 290 on 09-17, 283 on 09-16. Measured against prod on
// 2026-09-18 the number of TRUE unbacked marks (a zero at a sha the projection
// holds) was ZERO. The rows below are prod's, verbatim, that morning.
//
// THE RULE: a locking sha with NO projection rows at all is UNJUDGEABLE —
// counted, grouped by window, never listed as unbacked. `escrow_unbacked`
// lists only judgeable zeros. Unavailable, never ✦0.
//
// THE CAN-FAIL FLIP: in `canon-locks.mjs § canonLockFindings`, delete
//
//     -    if (!projected.has(r.locking_town_sha)) { unjudgeable.push(r); continue; }
//
// The first test reds (ORIENT lists as unbacked, the count is 0); the backed
// and drift controls stay green.

// the-town/orient — locked at window 150, town 830a6996…; no projection row
// carries that sha. One of 153 marks at that window.
const ORIENT = {
  slug: "the-town/orient", mark_status: "standing", tier: "market",
  locked_window: 150, locking_town_sha: "830a69963d8e4801ad4ed8bb80da38e79fd3fdbf", claim_id: "26eec02c", claim_status: "locked", window_id: 150,
};
// vermillion/pando-peak-home — the peak the issue names; window 164, 9cef0774….
const PEAK = {
  slug: "vermillion/pando-peak-home", mark_status: "standing", tier: "market",
  locked_window: 164, locking_town_sha: "9cef0774164b97af31fec61cd6bef21e8790e2b5", claim_id: "d2dc5a93", claim_status: "locked", window_id: 164,
};
// berthillon/le-petit-berthillon — locked at window 196, 422dbe6f…, ✦3 at that
// sha: the BACKED specimen, and the row the seam rule calls Berthillon's.
const PETIT = {
  slug: "berthillon/le-petit-berthillon", mark_status: "standing", tier: "market",
  locked_window: 196, locking_town_sha: "422dbe6f2b5b4fc0eaae69c5f2c8058d259d8d98", claim_id: "petit001", claim_status: "locked", window_id: 196,
};
const PROJECTION = new Map([
  ["422dbe6f2b5b4fc0eaae69c5f2c8058d259d8d98|berthillon/le-petit-berthillon", 3],
  ["422dbe6f2b5b4fc0eaae69c5f2c8058d259d8d98|somebody/else", 1],
  ["723005e5|somebody/else", 4],   // DRIFT's locking sha, held — on another mark
]);
const bigRegister = { slugs: new Set([ORIENT.slug, PEAK.slug, PETIT.slug, DRIFT.slug]), sha: "0".repeat(40) };

test("THE BRIEF'S FALSIFIER: a sha the projection never held is UNJUDGEABLE; a held sha with ✦0 is UNBACKED", () => {
  const r = canonLockFindings([ORIENT, DRIFT], bigRegister, { escrowBySha: PROJECTION });
  assert.deepEqual(r.unjudgeable.map((u) => u.slug), ["the-town/orient"], "150's sha has no rows at all — not judged, never ✦0");
  assert.deepEqual(r.unbacked.map((u) => u.slug), ["lupi/the-drift-room"], "177's sha IS held (on another mark) and carries nothing for this slug — a judgeable zero");
  assert.equal(r.escrow_checked, true, "the projection exists; unjudgeable is a fact about ONE sha, not the whole read");
  assert.equal(r.escrow_compared, 1, "only the judgeable mark is compared — an unjudgeable one is not a comparison that happened");
});

test("the backed specimen stays backed, and the counts partition the commons rows", () => {
  const r = canonLockFindings([ORIENT, PEAK, PETIT, DRIFT], bigRegister, { escrowBySha: PROJECTION });
  assert.deepEqual(r.unjudgeable.map((u) => u.slug).sort(), ["the-town/orient", "vermillion/pando-peak-home"]);
  assert.deepEqual(r.unbacked.map((u) => u.slug), ["lupi/the-drift-room"]);
  assert.equal(r.escrow_compared, 2, "PETIT and DRIFT were judged; ORIENT and PEAK were not");
  assert.equal(r.unjudgeable.length + r.escrow_compared, 4, "every commons row is exactly one of judged or unjudgeable");
});

test("with the projection ABSENT nothing is unjudgeable either — that is escrow_checked:false, the whole read's word", () => {
  const r = canonLockFindings([ORIENT, DRIFT], bigRegister, { escrowBySha: null });
  assert.deepEqual(r.unjudgeable, []);
  assert.deepEqual(r.unbacked, []);
  assert.equal(r.escrow_checked, false);
});

test("home and law rows are never unjudgeable — the class exempts them before the sha is asked", () => {
  const home = { ...ORIENT, slug: "current-the-reader/the-mantel", tier: "home" };
  const r = canonLockFindings([home], { slugs: new Set([home.slug]), sha: "0".repeat(40) }, { escrowBySha: PROJECTION });
  assert.deepEqual(r.unjudgeable, []);
  assert.equal(r.escrow_compared, 0);
});

test("projectedShas reads the shas off the map's own keys, and a key with no bar is not a sha", () => {
  assert.deepEqual([...projectedShas(PROJECTION)].sort(), ["422dbe6f2b5b4fc0eaae69c5f2c8058d259d8d98", "723005e5"]);
  assert.deepEqual([...projectedShas(null)], []);
  assert.deepEqual([...projectedShas(new Map([["nobar", 1], ["|leading", 1]]))], []);
});

test("unjudgeableByWindow groups by locking window, oldest first, and counts the marks", () => {
  const twin = { ...ORIENT, slug: "the-town/quay-steps", claim_id: "twin0001" };
  assert.deepEqual(unjudgeableByWindow([PEAK, ORIENT, twin]), [
    { locked_window: 150, town_sha: ORIENT.locking_town_sha, marks: 2 },
    { locked_window: 164, town_sha: PEAK.locking_town_sha, marks: 1 },
  ]);
  assert.deepEqual(unjudgeableByWindow([]), []);
});

test("ESCROW_OLDEST_SELECT names the projection's oldest sha with its first ingest and its window", () => {
  assert.match(ESCROW_OLDEST_SELECT, /FROM escrow_projection e/);
  assert.match(ESCROW_OLDEST_SELECT, /min\(e\.ingested_at\) AS ingested_at/);
  assert.match(ESCROW_OLDEST_SELECT, /SELECT min\(w\.id\) FROM windows w WHERE w\.town_sha = e\.town_sha/);
  assert.match(ESCROW_OLDEST_SELECT, /ORDER BY 2 LIMIT 1/, "oldest by first ingest, exactly one row");
});

// ── THE PHAENOLEPIS CASE, KEPT AS A TEST OF THE READ (ruled 2026-09-08) ─────
//
// `little-m-of-garrison/a-cluster-of-phaenolepis-garrisonii` locked at window
// 174 on 2026-09-07 while that crossing's settlement was 1h56m late; the file
// reached main at 07:42. The GRACE built for this case was dropped — it was dead
// by construction, because every settlement pushes after its own candle, so
// every claim would have taken it. What survives is the requirement on the READ:
// by the time the nightly read runs, the next crossing has carried the mark, and
// the read MUST NOT alarm on it.
//
// This is the whole reason the read is nightly and not at the crossing.
test("a mark whose settlement was LATE is not a finding once canon carries it", () => {
  const late = {
    slug: "little-m-of-garrison/a-cluster-of-phaenolepis-garrisonii",
    mark_status: "standing", tier: "home", locked_window: 174,
    claim_id: "late0001", claim_status: "locked", window_id: 174,
  };
  const carried = { slugs: new Set([late.slug]), sha: "0".repeat(40) };
  const r = canonLockFindings([late], carried);
  assert.deepEqual(r.absent, [], "the next crossing carried it — a late settlement is not a canon-absent mark");
  assert.equal(r.compared, 1, "and it WAS compared, so this is a pass and not a skip");
});

test("the same mark IS a finding while canon genuinely lacks it — the control", () => {
  // Without this, the test above would pass on an empty register and prove
  // nothing about lateness at all.
  const late = { slug: "little-m-of-garrison/a-cluster-of-phaenolepis-garrisonii", mark_status: "standing", tier: "home", locked_window: 174 };
  const r = canonLockFindings([late], { slugs: new Set(["somebody/else"]), sha: "0".repeat(40) });
  assert.deepEqual(r.absent.map((a) => a.slug), [late.slug]);
});

// ── A TRANSFER IS NOT UNMATERIALIZED (DEC-16; 2026-09-15) ───────────────────
//
// the-town/the-lanternstep-parlor locked at window 172. On 08-29 the parlor
// passed to wright; DEC-16 keeps the row's id (21e07250…) and moves its slug, so
// the mark stands as wright/the-lanternstep-parlor while the claim keeps the old
// name. The slug question listed it as unmaterialized for a week, and the fridge
// recommended retiring it by hand — DEC-16's rejected alternative, which costs
// the mark its escrow and its history. The read now asks the claim's own row.
// CAN FAIL: drop the by-id clause from UNMATERIALIZED_SELECT → this reds.
test("a locked claim whose own row stands under a NEW slug is a transfer, never unmaterialized (DEC-16)", () => {
  assert.match(UNMATERIALIZED_SELECT, /NOT EXISTS \(SELECT 1 FROM marks m WHERE m\.id = c\.id\)/,
    "the read asks whether the claim's own row exists before calling a lock unmaterialized");
  // and the never-stood class is still asked by slug — the first clause stays
  assert.match(UNMATERIALIZED_SELECT, /NOT EXISTS \(SELECT 1 FROM marks m WHERE m\.slug = coalesce\(c\.slug, c\.geometry->>'slug'\)\)/);
});
