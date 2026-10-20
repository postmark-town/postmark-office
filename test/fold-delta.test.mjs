// fold-delta.test.mjs — THE DOCKET, AND THE ONE WINDOW IT IS RECOVERABLE AT.
//
//   node --test test/fold-delta.test.mjs
//
// ── THE PREMISE THAT WAS TRUE ONLY WHERE IT WAS USED ────────────────────────
//
// `foldDelta` reads `marks WHERE locked_window = <closed>` where the ruling
// names `claims WHERE window_id = <closed> AND status = 'locked'`. The first
// version of its header justified that with a COUNT — "33 and 33 at window 177"
// — and a count is not an identity. Measured read-only against prod 2026-09-09,
// reproducing the reviewer's figures exactly:
//
//   window 177   33 marks · 33 claims · 17 SHARED IDS · 33 shared slugs
//   window 176    4 marks ·  4 claims ·  4 shared ids ·  4 shared slugs
//   window 172  116 marks · 118 claims · TWO slugs in claims and not in marks
//                (berthillon/cone-blue-moon-2026-08-30 and
//                 wright/the-flip-day-plumb-line, both now locked_window = 177)
//
// `claims.window_id` is historical; `marks.locked_window` is latest-wins. They
// agree by slug only at the NEWEST closed window, where "most recently locked"
// and "locked here" are the same sentence. One window back, the docket is no
// longer recoverable from `marks`.
//
// The crossing's own clearing wait runs to 240 s, so a replay or a catch-up
// crossing landing on an older window is not hypothetical — and its shortfall
// would be unattributable, because each omitted mark simply is not in the fold.
// So this refuses instead.
//
// The client here is a stub: `foldDelta` speaks to a `pg` client through exactly
// one method, and every assertion below is about which query it refuses at,
// which is a property of the code and not of a database.

import test from "node:test";
import assert from "node:assert/strict";

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

import { foldDelta } from "../world2/tools/fold-delta.mjs";
// The sha-taking register, built here the way `fold-input-cli.mjs` builds it,
// so the registry-refresh falsifier below exercises the real reader and not a
// hand-built object that could not reproduce the defect.
import { canonRegisterAtSha } from "../world2/tools/canon-register.mjs";

/**
 * A client that answers by matching the query text. It THROWS on a query this
 * test did not anticipate, so a refusal that fires later than expected shows up
 * as an unanticipated read rather than as a silent pass.
 */
function stubClient(windows, {
  marks = [], docketClaims = null, standing = null, absentRows = [], onUnexpected = null, withdrawnOwed = [],
} = {}) {
  const seen = [];
  return {
    seen,
    async query(text, params) {
      seen.push(text.trim().split("\n")[0].trim());
      // THE THIRD TERM'S READ (WLD-88): standing marks whose latest mark act is
      // a withdraw. Matched FIRST, because its text names `m.status =
      // 'standing'` too and would otherwise be answered as the notary's read.
      if (/latest_mark_act/.test(text)) return { rows: withdrawnOwed };
      // ── THE CARRY'S TWO READS ────────────────────────────────────────────
      //
      // `standing` is the notary's own `STANDING_SELECT` answer, and it is NULL
      // by default so every test written before the carry existed still proves
      // what it proved: a fold handed no register must not ask for the standing
      // set at all, and here that shows as a throw rather than as an empty read
      // silently passing for one.
      if (/FROM marks m/.test(text) && /m\.status = 'standing'/.test(text)) {
        if (standing === null) {
          throw new Error("the fold asked for the standing set, and this test supplied none — it should not have asked");
        }
        return { rows: standing };
      }
      // The full-column re-read of the slugs the fold decided to carry, FILTERED
      // BY THE PARAMETER rather than returned wholesale, so a test can prove the
      // fold asked for the slugs it named and not for a wider set.
      if (/FROM marks WHERE slug = ANY/.test(text)) {
        const want = new Set(params[0]);
        return { rows: absentRows.filter((r) => want.has(r.slug)) };
      }
      if (/FROM windows WHERE id = \$1/.test(text)) {
        const w = windows.find((x) => Number(x.id) === Number(params[0]));
        return { rows: w ? [w] : [] };
      }
      if (/FROM windows WHERE status = 'closed' ORDER BY id DESC/.test(text)) {
        const closed = windows.filter((x) => x.status === "closed").sort((a, b) => b.id - a.id);
        return { rows: closed.slice(0, 1) };
      }
      // THE DOCKET'S SIZE, ANSWERED SEPARATELY FROM THE MARKS — which is the
      // whole point of the field. `docketClaims` defaults to the mark count only
      // so the ordinary tests need not state it twice; every test that is ABOUT
      // this field sets it to something the mark array cannot supply.
      if (/FROM claims WHERE window_id = \$1 AND status = 'locked'/.test(text)) {
        return { rows: [{ n: docketClaims === null ? marks.length : docketClaims }] };
      }
      if (/FROM marks WHERE locked_window/.test(text)) return { rows: marks };
      if (onUnexpected) return onUnexpected(text);
      throw new Error(`the stub was asked something this test did not anticipate: ${text.slice(0, 120)}`);
    },
  };
}

const WINDOWS = [
  { id: 178, status: "open", cleared_at: null, town_sha: null },
  { id: 177, status: "closed", cleared_at: "2026-09-08 17:45:44.650035+00", town_sha: "723005e5" },
  { id: 176, status: "closed", cleared_at: "2026-09-08 05:45:44.36846+00", town_sha: "2a681e6c" },
  { id: 172, status: "closed", cleared_at: "2026-09-06 17:45:41.000000+00", town_sha: "aaaaaaaa" },
];

const caught = async (fn) => { try { await fn(); return null; } catch (e) { return e; } };

// `stakesFromStore` REFUSES on an empty escrow read — an empty stake set is
// indistinguishable from a town where nobody stakes — so every test that lets
// `foldDelta` run to completion has to answer it with a position.
const escrowStub = (text) => (/escrow_projection/.test(text)
  ? { rows: [{ mark: "alpha/one", holder: "beta", household: "solo:beta", own_household: "solo:alpha", n: 3, weight_k: 5 }] }
  : { rows: [] });

test("an OLDER closed window REFUSES — its docket is no longer recoverable from `marks`", async () => {
  // The case the reviewer found. 172 is a real, closed, cleared window; asking
  // for it returns a set missing every slug re-locked since, and nothing
  // downstream could tell.
  const e = await caught(() => foldDelta(stubClient(WINDOWS), { window: 172, worldSha: "w".repeat(40) }));
  assert.ok(e, "it must refuse");
  assert.match(e.message, /^not-newest-closed-window/);
  assert.match(e.message, /newest closed window is 177/);
  assert.match(e.message, /latest-wins/, "and it must say WHY, or the operator retries it");
});

test("the newest closed window is accepted", async () => {
  const client = stubClient(WINDOWS, {
    marks: [{ id: "u1", slug: "alpha/one", kind: "sited", owner: "alpha", household: "solo:alpha",
      body: "b", geometry: { at: { x: 1, y: 2 } }, status: "standing", locked_window: 177, data: {} }],
    onUnexpected: (text) => (/escrow_projection/.test(text)
      ? { rows: [{ mark: "alpha/one", holder: "beta", household: "solo:beta", own_household: "solo:alpha", n: 3, weight_k: 5 }] }
      : { rows: [] }),
  });
  const out = await foldDelta(client, { window: 177, worldSha: "w".repeat(40) });
  assert.equal(out.as_of.window, 177);
  assert.equal(out.marks.length, 1);
  assert.equal(out.marks[0].slug, "alpha/one");
});

// ── THE DOCKET'S SIZE, AND WHOSE TABLE IT COMES FROM (2026-09-09) ────────────
//
// `starvingCheck` refused every crossing over a window in which nobody locked a
// claim — 6 of the 30 closed windows prod has ever had, one in five — because it
// inferred "the store did not answer" from `marks.length === 0`, and under the
// delta contract the offered set IS the docket. The fix is this field. These
// falsifiers are about the one property that makes it worth having: that it is a
// SECOND READ, so the guard it feeds can disagree with itself.

test("the selection carries `docket_claims`, and it is read from `claims` — not from the mark array", async () => {
  // The stub answers 33 to the claims count while handing back ONE mark. No
  // arithmetic over the returned marks can produce 33, so a `docket_claims` of 33
  // is proof the count came from the other table. If this field were
  // `rows.length` in disguise, this test reds at 1.
  const client = stubClient(WINDOWS, {
    marks: [{ id: "u1", slug: "alpha/one", kind: "sited", owner: "alpha", household: "solo:alpha",
      body: "b", geometry: { at: { x: 1, y: 2 } }, status: "standing", locked_window: 177, data: {} }],
    docketClaims: 33,
    onUnexpected: (text) => (/escrow_projection/.test(text)
      ? { rows: [{ mark: "alpha/one", holder: "beta", household: "solo:beta", own_household: "solo:alpha", n: 3, weight_k: 5 }] }
      : { rows: [] }),
  });
  const out = await foldDelta(client, { window: 177, worldSha: "w".repeat(40) });
  assert.equal(out.marks.length, 1);
  assert.equal(out.selection.docket_claims, 33,
    "the size must come from `claims`; a size taken from the marks array is a guard that cannot disagree with itself");
  assert.equal(out.selection.by, "docket");
  assert.equal(out.selection.window, 177);
  assert.equal(out.selection.entry, "fold-delta.mjs § foldDelta");
  assert.equal(out.selection.note, null, "an empty channel is named, not omitted");
});

test("an empty docket is reported as ZERO rows, not as an absent field", async () => {
  // The lawful quiet crossing, at the fold. `docket_claims: 0` is what lets the
  // guard downstream say "nobody locked a claim" instead of refusing; an ABSENT
  // field would put it back where it started, because absence cannot prove quiet.
  const client = stubClient(WINDOWS, { marks: [], docketClaims: 0, onUnexpected: escrowStub });
  const out = await foldDelta(client, { window: 177, worldSha: "w".repeat(40) });
  assert.equal(out.marks.length, 0);
  assert.equal(out.selection.docket_claims, 0);
  assert.ok("docket_claims" in out.selection, "the field is present at zero, not dropped");
});

test("the docket count is asked of the window this crossing folds, and only after the window checks pass", async () => {
  // Asserted from what the stub was asked. A count read before the
  // newest-closed check would be a query issued on a window the fold is about to
  // refuse — cheap, but it is the shape that turns a refusal into two failures.
  const c = stubClient(WINDOWS, { marks: [], docketClaims: 0, onUnexpected: escrowStub });
  await foldDelta(c, { window: 177, worldSha: "w".repeat(40) });
  const claimsAt = c.seen.findIndex((q) => /FROM claims WHERE window_id/.test(q));
  const newestAt = c.seen.findIndex((q) => /FROM windows WHERE status = 'closed' ORDER BY id DESC/.test(q));
  assert.ok(claimsAt > newestAt && newestAt !== -1, `the count must follow the window checks; asked: ${JSON.stringify(c.seen)}`);

  const refused = stubClient(WINDOWS);
  await caught(() => foldDelta(refused, { window: 172, worldSha: "w".repeat(40) }));
  assert.ok(!refused.seen.some((q) => /FROM claims/.test(q)),
    "and a refused window is never counted at all");
});

test("an OPEN window refuses under its own name, not the newest-closed one", async () => {
  // Two different repairs; an operator reading `window-not-closed` waits, and one
  // reading `not-newest-closed-window` looks at what is replaying. Collapsing
  // them into one reason would send half of them to the wrong door.
  const e = await caught(() => foldDelta(stubClient(WINDOWS), { window: 178, worldSha: "w".repeat(40) }));
  assert.match(e.message, /^window-not-closed/);
});

test("a window the store does not hold refuses under its own name", async () => {
  const e = await caught(() => foldDelta(stubClient(WINDOWS), { window: 9999, worldSha: "w".repeat(40) }));
  assert.match(e.message, /^not-a-window/);
});

test("no window, and no worldSha, each refuse before any query is made", async () => {
  // The docket IS the selector, so its absence cannot be a default; and the
  // store does not know the world commit and must not appear to.
  const c1 = stubClient(WINDOWS);
  assert.match((await caught(() => foldDelta(c1, { worldSha: "w".repeat(40) }))).message, /no window/);
  assert.deepEqual(c1.seen, [], "and it asked the store nothing at all");

  const c2 = stubClient(WINDOWS);
  assert.match((await caught(() => foldDelta(c2, { window: 177 }))).message, /no worldSha/);
  assert.deepEqual(c2.seen, []);
});

test("the newest-closed check happens BEFORE the marks are read", async () => {
  // The ordering the ruling asks for: refuse before the connection is used for
  // anything else. Asserted by what the stub was asked, not by reading the code.
  const c = stubClient(WINDOWS);
  await caught(() => foldDelta(c, { window: 172, worldSha: "w".repeat(40) }));
  assert.ok(
    !c.seen.some((q) => /FROM marks/.test(q)),
    `it must refuse before reading any mark; it asked: ${JSON.stringify(c.seen)}`,
  );
});

// ── THE WINDOW CLEARED OUTSIDE THE SWEEP'S TIMING (2026-09-12) ───────────────
//
// THE DEFECT THESE ARE THE FALSIFIERS FOR. On 2026-09-12 the 05:45Z candle could
// not log in; window 184 was cleared BY HAND at 05:52Z, locking two marks, and
// the sweep's re-run refused on timing. The 17:45Z crossing folded window 185,
// published its seven, and never wrote the two — which stand in the store with
// no file in canon, and which the notary has listed as `canon_absent` every
// 03:20 since. Nothing revisited window 184, because the docket selector asks
// for ONE window by design.
//
// So the selection becomes the docket UNION every standing mark canon does not
// carry. The docket query is untouched — it is still the selector, and its
// refusals still fire first. The union is a SECOND, NAMED term, computed by the
// notary's own reader (`canon-locks.mjs § STANDING_SELECT` and
// `§ canonLockFindings`, against a register from `canon-register.mjs §
// canonRegisterAt`), so a listing at 03:20 and a carry at 17:45 cannot come to
// disagree about what "canon does not carry it" means.
//
// The two fixture slugs are the two real marks, because a falsifier named for
// the instance it was written from is one a keeper can trace back.

const WARM_STONE = "neth/warm-stone-for-whoever-waits";
const REACHABILITY = "sophia-familiaris/reachability-is-not-permission";

const CARRY_WINDOWS = [
  { id: 186, status: "open", cleared_at: null, town_sha: null },
  { id: 185, status: "closed", cleared_at: "2026-09-12 17:45:44.000000+00", town_sha: "723005e5" },
  { id: 184, status: "closed", cleared_at: "2026-09-12 05:52:00.000000+00", town_sha: "2a681e6c" },
];

/** A full-column `marks` row, the shape `MARK_COLUMNS` returns. */
const markRow = (slug, { window = 185, status = "standing" } = {}) => ({
  id: `id:${slug}`, slug, kind: "sited", owner: slug.split("/")[0],
  household: `solo:${slug.split("/")[0]}`, body: "b",
  geometry: { at: { x: 1, y: 2 } }, status, locked_window: window, data: {},
});

/** A `STANDING_SELECT` row — the notary's shape, not the fold's. */
const standingRow = (slug, { window = 184, markStatus = "standing" } = {}) => ({
  slug, locked_window: window, mark_status: markStatus, tier: null,
  locking_town_sha: "2a681e6c", claim_id: null, claim_status: "locked",
  window_id: window, claimant: slug.split("/")[0], decided_at: "2026-09-12T05:52:00Z",
});

const WORLD_SHA = "c".repeat(40);

/**
 * What `canonRegisterAtSha` returns, hand-built — no clone, no git, no store.
 * The sibling, not `canonRegisterAt`: that one is the notary's and stamps HEAD,
 * and this shape is the one the crossing's caller actually produces.
 */
const registerOf = (...slugs) => ({
  slugs: new Set(slugs), sha: WORLD_SHA, count: slugs.length, source: "test", unreadable: [],
});

const carryClient = (opts = {}) => stubClient(CARRY_WINDOWS, { onUnexpected: escrowStub, ...opts });

test("CARRIED · a mark locked at an earlier window and absent from canon is in this window's fold", async () => {
  // The 09-12 defect exactly: window 185's docket is one mark, and two marks
  // locked at 184 stand in the store with no file in canon. Before the union the
  // fold returned one mark and the two were orphaned for good.
  const client = carryClient({
    marks: [markRow("alpha/one", { window: 185 })],
    docketClaims: 1,
    standing: [
      standingRow("alpha/one", { window: 185 }),
      standingRow(WARM_STONE), standingRow(REACHABILITY),
    ],
    absentRows: [markRow(WARM_STONE, { window: 184 }), markRow(REACHABILITY, { window: 184 })],
  });
  const out = await foldDelta(client, {
    window: 185, worldSha: WORLD_SHA, canonRegister: registerOf("someone/else-entirely"),
  });

  assert.deepEqual(out.marks.map((m) => m.slug).sort(),
    [WARM_STONE, "alpha/one", REACHABILITY].sort(),
    "the fold carries the docket AND the two the 17:45Z crossing left behind");
  assert.equal(out.selection.carried_absent.count, 2);
  assert.deepEqual(out.selection.carried_absent.slugs, [WARM_STONE, REACHABILITY].sort());
  assert.equal(out.selection.carried_absent.checked, true);
  assert.equal(out.selection.carried_absent.canon_sha, WORLD_SHA,
    "and the receipt names the state the absence was judged at — one stamp, one source");

  const carried = out.marks.filter((m) => m.slug !== "alpha/one");
  assert.deepEqual(carried.map((m) => m.locked_window), [184, 184],
    "a carried mark keeps ITS OWN locking window, so `written_by_locked_window` reads {185:1, 184:2}");
  assert.ok(carried.every((m) => m.bytes), "and it is rendered, not a slug in a list");
});

test("CARRIED · the docket's own rows are untouched — same count, same slugs, same bytes", async () => {
  // The union must not become a second selector. The docket query is unchanged
  // and its answer must survive the widening byte for byte.
  const docket = [markRow("alpha/one", { window: 185 }), markRow("beta/two", { window: 185 })];
  const plain = stubClient(CARRY_WINDOWS, { marks: docket, docketClaims: 2, onUnexpected: escrowStub });
  const before = await foldDelta(plain, { window: 185, worldSha: WORLD_SHA });

  const client = carryClient({
    marks: docket,
    docketClaims: 2,
    standing: [standingRow("alpha/one", { window: 185 }), standingRow("beta/two", { window: 185 }),
      standingRow(WARM_STONE)],
    absentRows: [markRow(WARM_STONE, { window: 184 })],
  });
  const after = await foldDelta(client, {
    window: 185, worldSha: WORLD_SHA, canonRegister: registerOf("someone/else-entirely"),
  });

  const own = after.marks.filter((m) => m.locked_window === 185);
  assert.deepEqual(own.map((m) => m.slug), before.marks.map((m) => m.slug));
  assert.deepEqual(own.map((m) => m.bytes), before.marks.map((m) => m.bytes));
  assert.equal(after.selection.docket_claims, 2,
    "and the docket's SIZE is still the docket's, not the union's");
});

test("NOT CARRIED · a mark the docket already holds is never also `carried_absent`", async () => {
  // EVERY mark this crossing just locked is absent from canon at `world_from` —
  // the push lands minutes AFTER the clear, which is why the lock-time refusal
  // was withdrawn. So the docket's own rows arrive in the absent set on every
  // ordinary crossing, and the dedup is what keeps this a union and not a
  // double-write.
  const client = carryClient({
    marks: [markRow("alpha/one", { window: 185 })],
    docketClaims: 1,
    standing: [standingRow("alpha/one", { window: 185 })],
    absentRows: [markRow("alpha/one", { window: 185 })],
  });
  const out = await foldDelta(client, {
    window: 185, worldSha: WORLD_SHA, canonRegister: registerOf("someone/else-entirely"),
  });
  assert.equal(out.marks.length, 1, "one mark, once");
  assert.equal(out.selection.carried_absent.count, 0);
  assert.deepEqual(out.selection.carried_absent.slugs, []);
});

test("NOT CARRIED · a RETIRED mark absent from canon stays absent — the retire path's own meaning", async () => {
  // A mark the world published and later UNPUBLISHED also has no file in canon.
  // Carrying it would re-publish what the town has already recorded as gone.
  // `STANDING_SELECT` filters this out and `canonLockFindings` filters it again;
  // this asserts the SECOND lock, by handing the fold a row the first would have
  // dropped.
  const client = carryClient({
    marks: [markRow("alpha/one", { window: 185 })],
    docketClaims: 1,
    standing: [standingRow("alpha/one", { window: 185 }),
      standingRow(WARM_STONE, { markStatus: "retired" })],
    absentRows: [markRow(WARM_STONE, { window: 184, status: "retired" })],
  });
  const out = await foldDelta(client, {
    window: 185, worldSha: WORLD_SHA, canonRegister: registerOf("someone/else-entirely"),
  });
  assert.equal(out.selection.carried_absent.count, 0, "a retirement is not a shortfall");
  assert.deepEqual(out.marks.map((m) => m.slug), ["alpha/one"]);
});

test("NOT CARRIED · a mark locked earlier whose file IS in canon is left alone", async () => {
  // There is nothing to write. Carrying it would make every crossing re-offer
  // the standing corpus — the 956-write configuration wearing a delta's name.
  const client = carryClient({
    marks: [markRow("alpha/one", { window: 185 })],
    docketClaims: 1,
    standing: [standingRow("alpha/one", { window: 185 }), standingRow(WARM_STONE)],
    absentRows: [markRow(WARM_STONE, { window: 184 })],
  });
  const out = await foldDelta(client, {
    window: 185, worldSha: WORLD_SHA, canonRegister: registerOf(WARM_STONE),
  });
  assert.equal(out.selection.carried_absent.count, 0);
  assert.deepEqual(out.marks.map((m) => m.slug), ["alpha/one"]);
});

test("NO REGISTER · the fold does not carry, SAYS it did not check, and asks the store nothing extra", async () => {
  // The hand-carry's safety property. A caller with no world checkout folds
  // exactly the docket, as it did before this field existed — and the receipt
  // says `checked: false` rather than an unqualified zero, because "carried
  // nothing" and "never looked" are different states and only one is evidence.
  const client = stubClient(CARRY_WINDOWS, {
    marks: [markRow("alpha/one", { window: 185 })], docketClaims: 1, onUnexpected: escrowStub,
  });
  const out = await foldDelta(client, { window: 185, worldSha: WORLD_SHA });
  assert.deepEqual(out.marks.map((m) => m.slug), ["alpha/one"]);
  assert.equal(out.selection.carried_absent.checked, false);
  assert.equal(out.selection.carried_absent.count, 0);
  assert.equal(out.selection.carried_absent.canon_sha, null);
  assert.ok(!client.seen.some((q) => /standing/.test(q)),
    `it must not read the standing set with no register; it asked: ${JSON.stringify(client.seen)}`);
});

test("THE REGISTER MUST BE THE FOLD'S OWN WORLD SHA, or the absence was judged against another world", async () => {
  // `as_of.world_sha` is what the receipt says the crossing folded from. A
  // register built at a DIFFERENT checkout would answer "canon does not carry
  // this" about a world this crossing is not publishing into — a carry that is
  // correct, precise, and about the wrong subject. In the sweep the two are the
  // same by construction (`$SWEEP` is checked out at `$WORLD_FROM`), so this can
  // only fire on a hand-run pointed at the wrong clone, which is exactly when it
  // should.
  const client = carryClient({
    marks: [markRow("alpha/one", { window: 185 })], docketClaims: 1,
    standing: [standingRow("alpha/one", { window: 185 })], absentRows: [],
  });
  const e = await caught(() => foldDelta(client, {
    window: 185, worldSha: "d".repeat(40), canonRegister: registerOf("someone/else-entirely"),
  }));
  assert.ok(e, "it must refuse");
  assert.match(e.message, /^canon-register-sha-mismatch/);
  assert.match(e.message, /dddddddd/,
    "and it must name both shas, or the operator cannot tell which clone was wrong");
  assert.match(e.message, /cccccccc/);
});

test("REFUSALS STAY · an older window still refuses before any canon read", async () => {
  // The widening must not become a way to fold an old window "because the marks
  // are absent anyway". The docket refusals are first, and they are unchanged.
  const client = carryClient({
    standing: [standingRow(WARM_STONE)], absentRows: [markRow(WARM_STONE, { window: 184 })],
  });
  const e = await caught(() => foldDelta(client, {
    window: 184, worldSha: WORLD_SHA, canonRegister: registerOf("someone/else-entirely"),
  }));
  assert.match(e.message, /^not-newest-closed-window/);
  assert.ok(!client.seen.some((q) => /standing/.test(q)),
    `a refused window is never carried for; it asked: ${JSON.stringify(client.seen)}`);
});

// ── AFTER THE REVIEW (2026-09-12): THE TWO THE READER FOUND ──────────────────
//
// 1 · THE EQUALITY WAS NOT "BY CONSTRUCTION" AND THIS LANE SAID IT WAS.
//
// `deploy/settlement-auto.sh` reads `WORLD_FROM` from `origin/main` and checks
// `$SWEEP` out at it (:303-304) — and then COMMITS `WORLD/households.json` onto
// that same clone whenever the household registry moved (:386-395). The script
// documents it at :418-425: "main may already be ahead of origin/main at this
// line, because the registry refresh commits before the fold." `canonRegisterAt`
// stamps `git rev-parse HEAD`, so on any crossing after a household is declared
// the register's sha is ONE COMMIT PAST the fold's `worldSha`, the equality check
// below throws, `fold-input-cli.mjs` turns it into `store-refused`, and THE
// CROSSING PUBLISHES NOTHING. A household was declared on 2026-09-12, so this
// would have fired at 05:45Z.
//
// The carry itself was never wrong — the registry commit touches only
// `households.json` and the marks tree is byte-identical. The EQUALITY TEST READ
// THE WRONG INSTRUMENT. The repair is not to loosen it: the register is now read
// AT `worldSha` (`canon-register.mjs § canonRegisterAtSha`), so the equality
// holds by construction and the check below stays as the falsifier for the day
// something other than the registry moves main before the fold.
//
// 2 · A NULL HOUSEHOLD IN THE CARRIED TERM WOULD REFUSE EVERY CROSSING.
//
// `marks.household` is nullable (`001_tables.sql`), and `normalizeMark` refuses
// the WHOLE fold input with `mark-without-household`. A door-locked docket mark
// always carries one, so the docket never meets this. The carried term draws from
// the whole standing corpus, so ONE canon-absent standing mark with a null
// household would have refused every crossing until somebody edited the store by
// hand. A carried candidate with no household is NAMED AND SKIPPED.

test("REGISTRY REFRESH · HEAD one commit past worldSha still CARRIES, and stamps worldSha", async () => {
  // The reviewer's case end to end, on a REAL git repo: the register is built the
  // way the CLI builds it, at `worldSha`, while HEAD sits one households-only
  // commit ahead. Before the repair this reds with `canon-register-sha-mismatch`
  // and the crossing publishes nothing.
  const dir = mkdtempSync(join(tmpdir(), "fold-carry-world-"));
  try {
    mkdirSync(join(dir, "tools"), { recursive: true });
    mkdirSync(join(dir, "WORLD", "marks", "someone", "else-entirely"), { recursive: true });
    writeFileSync(join(dir, "tools", "marks-fold.mjs"), [
      'import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";',
      'import { join } from "node:path";',
      "export function loadMarks(dir) {",
      "  const out = [];",
      "  if (!existsSync(dir)) return out;",
      "  for (const owner of readdirSync(dir)) {",
      "    const od = join(dir, owner);",
      "    if (!statSync(od).isDirectory()) continue;",
      "    for (const leaf of readdirSync(od)) {",
      "      const md = join(od, leaf, 'mark.md');",
      "      if (!existsSync(md)) continue;",
      "      const by = (readFileSync(md, 'utf8').match(/^by:\\s*(.+)$/m) || [])[1];",
      "      out.push({ id: (by ? by.trim() : '?') + '/' + leaf, kind: 'sited' });",
      "    }",
      "  }",
      "  return out;",
      "}",
    ].join("\n"));
    writeFileSync(join(dir, "WORLD", "marks", "someone", "else-entirely", "mark.md"),
      "---\nby: someone\nkind: sited\n---\n\nbody\n");
    const g = (...a) => execFileSync("git", ["-C", dir, ...a], { stdio: "pipe" });
    g("init", "-q"); g("config", "user.email", "t@e.invalid"); g("config", "user.name", "t");
    g("add", "-A"); g("commit", "-qm", "canon");
    const worldFrom = execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();

    // The registry refresh, exactly as the sweep performs it.
    writeFileSync(join(dir, "WORLD", "households.json"), '{"logins":{"yannlugrin":"gh:1"}}');
    g("add", "-A"); g("commit", "-qm", "the household registry moved");
    assert.notEqual(execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(), worldFrom,
      "the fixture must reproduce the advance, or it proves nothing");

    const register = await canonRegisterAtSha({ worldRepo: dir, sha: worldFrom });

    const client = carryClient({
      marks: [markRow("alpha/one", { window: 185 })],
      docketClaims: 1,
      standing: [standingRow("alpha/one", { window: 185 }), standingRow(WARM_STONE), standingRow(REACHABILITY)],
      absentRows: [markRow(WARM_STONE, { window: 184 }), markRow(REACHABILITY, { window: 184 })],
    });
    const out = await foldDelta(client, { window: 185, worldSha: worldFrom, canonRegister: register });

    assert.equal(out.selection.carried_absent.count, 2, "the crossing carries; it does not refuse");
    assert.equal(out.selection.carried_absent.canon_sha, worldFrom,
      "and the receipt names the crossing's own world sha, not the clone's HEAD");
    assert.equal(out.as_of.world_sha, worldFrom);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("NULL HOUSEHOLD · a carried candidate with no household is NAMED AND SKIPPED, never a refusal", async () => {
  // `marks.household` is nullable and `store-writedown.mjs § normalizeMark`
  // refuses the WHOLE fold input on a null one. The docket never meets this — the
  // door composes a household on every path — but the carried term draws from the
  // whole standing corpus, so one such row would have stopped every crossing in
  // the town until somebody edited the store.
  const orphan = { ...markRow("nobody/no-household-at-all", { window: 184 }), household: null };
  const client = carryClient({
    marks: [markRow("alpha/one", { window: 185 })],
    docketClaims: 1,
    standing: [standingRow("alpha/one", { window: 185 }), standingRow(WARM_STONE),
      standingRow("nobody/no-household-at-all")],
    absentRows: [markRow(WARM_STONE, { window: 184 }), orphan],
  });
  const out = await foldDelta(client, {
    window: 185, worldSha: WORLD_SHA, canonRegister: registerOf("someone/else-entirely"),
  });

  assert.deepEqual(out.marks.map((m) => m.slug).sort(), [WARM_STONE, "alpha/one"].sort(),
    "the crossing proceeds and carries the one it can");
  assert.equal(out.selection.carried_absent.count, 1, "the count is what was CARRIED, not what was considered");
  assert.deepEqual(out.selection.carried_absent.slugs, [WARM_STONE]);
  assert.deepEqual(out.selection.carried_absent.skipped_no_household, ["nobody/no-household-at-all"],
    "and the one that could not be carried is NAMED — a silent skip is how a mark stays lost for another three weeks");
});

test("NULL HOUSEHOLD · the field is present and empty when nothing was skipped", async () => {
  // An empty channel is named, not omitted — the same rule `note: null` keeps.
  // A field that appears only on the bad crossings is a field whose absence
  // starts meaning "fine".
  const client = carryClient({
    marks: [markRow("alpha/one", { window: 185 })],
    docketClaims: 1,
    standing: [standingRow("alpha/one", { window: 185 }), standingRow(WARM_STONE)],
    absentRows: [markRow(WARM_STONE, { window: 184 })],
  });
  const out = await foldDelta(client, {
    window: 185, worldSha: WORLD_SHA, canonRegister: registerOf("someone/else-entirely"),
  });
  assert.deepEqual(out.selection.carried_absent.skipped_no_household, []);
  assert.equal(out.selection.carried_absent.count, 1);
});

test("NULL HOUSEHOLD · an empty-string household is skipped too, not written as `\"\"`", async () => {
  // `?? null` would let an empty string through, and an empty household resolves
  // to a sketchbook name of nothing. The test is falsy, not null-only.
  const orphan = { ...markRow("nobody/blank-household", { window: 184 }), household: "" };
  const client = carryClient({
    marks: [markRow("alpha/one", { window: 185 })],
    docketClaims: 1,
    standing: [standingRow("alpha/one", { window: 185 }), standingRow("nobody/blank-household")],
    absentRows: [orphan],
  });
  const out = await foldDelta(client, {
    window: 185, worldSha: WORLD_SHA, canonRegister: registerOf("someone/else-entirely"),
  });
  assert.equal(out.selection.carried_absent.count, 0);
  assert.deepEqual(out.selection.carried_absent.skipped_no_household, ["nobody/blank-household"]);
});

// ── THE THIRD TERM: A WITHDRAWAL CANON HAS NOT YET CARRIED (WLD-88) ─────────
//
// The instance: Current withdrew the bed (act 18087, S250), the door promised
// "canon lets it go at the next crossing", and no store crossing could name it.
// The rows below are the shape `WITHDRAWN_OWED_SELECT` returns; the read itself
// is proven against a real Postgres in withdrawal-carried.test.mjs.

const BED = "current-the-reader/the-bed-under-the-moons-road";
const owedRow = (slug, { household = "hh:deva-s-commons", act = 18087, crossing = "250" } = {}) => ({
  slug, owner: slug.split("/")[0], household, act_id: String(act), crossing,
});

test("WITHDRAWN · a standing mark whose latest act is a withdraw, and which canon holds, is owed — as a removal, never a mark", async () => {
  const client = carryClient({
    marks: [markRow("alpha/one", { window: 185 })], docketClaims: 1,
    standing: [standingRow("alpha/one", { window: 185 }), standingRow(BED, { window: 184 })],
    withdrawnOwed: [owedRow(BED)],
  });
  const out = await foldDelta(client, { window: 185, worldSha: WORLD_SHA, canonRegister: registerOf("alpha/one", BED) });

  assert.deepEqual(out.withdrawals, [{ slug: BED, by: "current-the-reader", household: "hh:deva-s-commons" }]);
  assert.deepEqual(out.marks.map((m) => m.slug), ["alpha/one"], "a withdrawal is never written as a mark");
  assert.deepEqual(out.selection.withdrawn_owed, {
    checked: true, count: 1, slugs: [BED], acts: [{ slug: BED, act: 18087, crossing: 250 }],
    deferred_to_docket: [], retire_only: [], skipped_no_household: [], canon_sha: WORLD_SHA,
  });
});

test("WITHDRAWN · a withdrawal canon has already carried is not removed again — only its retirement is owed (retire_only)", async () => {
  const client = carryClient({
    marks: [markRow("alpha/one", { window: 185 })], docketClaims: 1,
    standing: [standingRow("alpha/one", { window: 185 })],
    withdrawnOwed: [owedRow(BED)],
  });
  const out = await foldDelta(client, { window: 185, worldSha: WORLD_SHA, canonRegister: registerOf("alpha/one") });
  assert.deepEqual(out.withdrawals, []);
  assert.equal(out.selection.withdrawn_owed.count, 0);
  assert.deepEqual(out.selection.withdrawn_owed.retire_only, [BED], "the retire step reads this from the fold input");
});

test("WITHDRAWN · THE CARRY NEVER WRITES IT BACK: standing, canon-absent, latest act a withdraw", async () => {
  // A refused retire step leaves the row standing after the file left canon,
  // which is the carry's own set. Without the shared predicate the next
  // crossing would publish the bed again.
  const client = carryClient({
    marks: [markRow("alpha/one", { window: 185 })], docketClaims: 1,
    standing: [standingRow("alpha/one", { window: 185 }), standingRow(BED, { window: 184 })],
    absentRows: [markRow(BED, { window: 184 })],
    withdrawnOwed: [owedRow(BED)],
  });
  const out = await foldDelta(client, { window: 185, worldSha: WORLD_SHA, canonRegister: registerOf("alpha/one") });
  assert.deepEqual(out.marks.map((m) => m.slug), ["alpha/one"]);
  assert.equal(out.selection.carried_absent.count, 0);
  assert.deepEqual(out.withdrawals, []);
  assert.deepEqual(out.selection.withdrawn_owed.retire_only, [BED]);
});

test("WITHDRAWN · a docket slug canon does not yet hold is deferred, never retired under the docket's write", async () => {
  const client = carryClient({
    marks: [markRow(BED, { window: 185 })], docketClaims: 1,
    standing: [standingRow(BED, { window: 185 })],
    withdrawnOwed: [owedRow(BED)],
  });
  const out = await foldDelta(client, { window: 185, worldSha: WORLD_SHA, canonRegister: registerOf("alpha/one") });
  assert.deepEqual(out.selection.withdrawn_owed.deferred_to_docket, [BED]);
  assert.deepEqual(out.selection.withdrawn_owed.retire_only, []);
});

test("WITHDRAWN · the docket wins its own crossing: a docket slug is deferred, not also removed", async () => {
  const client = carryClient({
    marks: [markRow(BED, { window: 185 })], docketClaims: 1,
    standing: [standingRow(BED, { window: 185 })],
    withdrawnOwed: [owedRow(BED)],
  });
  const out = await foldDelta(client, { window: 185, worldSha: WORLD_SHA, canonRegister: registerOf(BED) });
  assert.deepEqual(out.marks.map((m) => m.slug), [BED]);
  assert.deepEqual(out.withdrawals, []);
  assert.deepEqual(out.selection.withdrawn_owed.deferred_to_docket, [BED]);
});

test("WITHDRAWN · an owed withdrawal with no household is NAMED AND SKIPPED", async () => {
  const client = carryClient({
    marks: [], docketClaims: 0, standing: [],
    withdrawnOwed: [owedRow(BED, { household: null })],
  });
  const out = await foldDelta(client, { window: 185, worldSha: WORLD_SHA, canonRegister: registerOf(BED) });
  assert.deepEqual(out.withdrawals, []);
  assert.deepEqual(out.selection.withdrawn_owed.skipped_no_household, [BED]);
});

test("WITHDRAWN · no register: the term says it did not check, and asks nothing", async () => {
  const client = stubClient(CARRY_WINDOWS, {
    marks: [markRow("alpha/one", { window: 185 })], docketClaims: 1, onUnexpected: escrowStub,
  });
  const out = await foldDelta(client, { window: 185, worldSha: WORLD_SHA });
  assert.equal(out.selection.withdrawn_owed.checked, false);
  assert.deepEqual(out.withdrawals, []);
  assert.ok(!client.seen.some((q) => /latest_mark_act|m\.owner/.test(q)), JSON.stringify(client.seen));
});
