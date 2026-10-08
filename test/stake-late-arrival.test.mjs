// stake-late-arrival.test.mjs — a draft that outlived its window can still be
// put forward, and a refused promotion never debits.
//
// THE DEFECT (postmark#2722, hotfix w38). A private draft is a claims row in
// the window it was composed in, and the deed it is holding carries that same
// crossing. When a resident slept on a draft and then staked it, the stake pen
// released the held deed into the pen — which refused, correctly on its own
// terms, because a certified window may not be rewritten:
//
//     a row for crossing 183 may not enter the record while the open window is
//     185: that window is certified history and the notary refuses to rewrite
//     it (the act-4171 class). A late arrival files into the window it ARRIVES
//     in — set W2_LATE_ARRIVAL="<reason>" and the pen stamps 185, keeping the
//     original crossing on the payload.
//
// The promotion's whole transaction rolled back; the stake door's catch logged
// it; and the LEDGER ran anyway. Sophia's books read ✦1 staked while every mark
// surface read a zero-backed draft. She hit it twice, 2026-09-12 18:24:29Z and
// 18:25:24Z; Deva's 03:35Z 09-13 stake hit the identical line at 184/186.
//
// THE REPAIR IS THE GUARD'S OWN REMEDY, made reachable by a caller instead of
// only by a process-wide environment variable: the stake pen names its standing
// reason, the deed files into the window it ARRIVES in with the composing
// crossing kept on its payload, and the promotion proceeds. Nothing rewrites
// certified history. The claim row needed no remedy at all — 007's own
// `claims_update_guard` already spells the SUBMIT transition as moving
// `window_id` with it — which is why nothing here files a second claim.
//
// AND THE ORDERING: the promotion runs before the ledger, so a refusal is
// knowable before a stamp moves. It now refuses the stake instead of debiting.
// An unreachable store keeps the old posture, deliberately: down and "no" are
// different facts.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { lateCrossingGuard, crossingIsLate, LateCrossingError, LATE_ARRIVAL_PUT_FORWARD } from "../src/world2-pen.mjs";
import { stakeRefusalFor } from "../src/world-stake.mjs";
import { currentCrossing, CROSSING_EPOCH_UTC, CROSSING_MS } from "../src/crossings.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const src = (f) => readFileSync(join(HERE, "..", "src", f), "utf8");

// A clock, so "the open window" is a fact this file states rather than inherits
// from whenever it happens to run. `at(n)` is a moment inside crossing n.
const at = (n) => CROSSING_EPOCH_UTC + n * CROSSING_MS + 60_000;
const OPEN = 185;
const now = at(OPEN);
const heldAct = (crossing) => ({
  crossing, actor: "a-resident", action: "leave-mark", class: "mark",
  object: "a-resident/a-mark", payload: { slug: "a-mark" },
});

test("the clock this file reasons with is the one the pen uses", () => {
  assert.equal(currentCrossing(now), OPEN);
});

// ── (a) A DRAFT FROM A CLOSED WINDOW — the case that was refused ─────────────

test("a held deed from a CLOSED window files into the window it arrives in, keeping the crossing it was composed in", () => {
  const filed = lateCrossingGuard(heldAct(183), { now, lateArrival: LATE_ARRIVAL_PUT_FORWARD });
  assert.equal(filed.crossing, OPEN, "the deed did not file into the open window");
  assert.equal(filed.payload.late_from_crossing, 183, "the composing crossing was not kept on the payload");
  assert.equal(filed.payload.late_arrival, LATE_ARRIVAL_PUT_FORWARD);
  assert.equal(filed.payload.slug, "a-mark", "the deed's own payload was not carried through");
  // Deva's shape, one window along, by the same rule
  const devas = lateCrossingGuard(heldAct(184), { now: at(186), lateArrival: LATE_ARRIVAL_PUT_FORWARD });
  assert.equal(devas.crossing, 186);
  assert.equal(devas.payload.late_from_crossing, 184);
});

const thrownBy = (fn) => { try { fn(); } catch (e) { return e; } return null; };

test("WITHOUT a reason the law is unchanged: the pen still refuses, in the notary's own words", () => {
  const e = thrownBy(() => lateCrossingGuard(heldAct(183), { now, env: {} }));
  assert.ok(e instanceof LateCrossingError, "the pen no longer refuses an unexplained late row");
  assert.equal(e.crossing, 183);
  assert.equal(e.open, OPEN);
  assert.match(e.message, /certified history and the notary refuses to rewrite it/);
});

test("a FUTURE crossing is refused even with the reason — no excuse files a row into a window that has not opened", () => {
  const e = thrownBy(() => lateCrossingGuard(heldAct(OPEN + 3), { now, lateArrival: LATE_ARRIVAL_PUT_FORWARD }));
  assert.ok(e instanceof LateCrossingError, "a future crossing was let through");
  assert.equal(e.crossing, OPEN + 3);
});

// ── (b) THE ORDINARY CASE — promoted in place, untouched ─────────────────────

test("a held deed from the OPEN window, or the one just closed at the boundary, is filed unchanged", () => {
  for (const c of [OPEN, OPEN - 1]) {
    const filed = lateCrossingGuard(heldAct(c), { now, lateArrival: LATE_ARRIVAL_PUT_FORWARD });
    assert.equal(filed.crossing, c, `crossing ${c} was restamped and should not have been`);
    assert.equal(filed.payload.late_from_crossing, undefined, `crossing ${c} was marked a late arrival`);
    assert.equal(filed.payload.late_arrival, undefined);
  }
});

// ── (c) ONE PREDICATE, TWO READERS — the relation, not the wording ───────────

test("the pen restamps EXACTLY the crossings `crossingIsLate` names, so what the resident is told and what the pen did are one fact", () => {
  let late = 0, ontime = 0;
  for (const c of [OPEN - 5, OPEN - 2, OPEN - 1, OPEN]) {
    const said = crossingIsLate(c, { now });
    const filed = lateCrossingGuard(heldAct(c), { now, lateArrival: LATE_ARRIVAL_PUT_FORWARD });
    const didRestamp = filed.crossing !== c;
    assert.equal(didRestamp, said, `predicate and pen disagree at crossing ${c}`);
    assert.equal("late_from_crossing" in filed.payload, said, `payload and predicate disagree at crossing ${c}`);
    said ? late++ : ontime++;
  }
  assert.ok(late > 0 && ontime > 0, `one-sided matrix: ${late} late / ${ontime} on time`);
});

// ── (d) THE ORDERING GUARD — a refused promotion never debits ────────────────

test("a promotion the pen REFUSED bounces before the ledger, holding nothing", () => {
  const standing = { known: true, found: true, retired: false };
  const refused = stakeRefusalFor({ mark: "a/b", n: 1, promoted: false, status: standing, refused: new LateCrossingError(183, 185) });
  assert.ok(refused, "a refused promotion did not bounce — the ledger would have debited");
  assert.equal(refused.error, "bounce");
  assert.equal(refused.held, 0);
  assert.equal(refused.requested, 1);
});

test("an ordinary stake on a standing mark is untouched: no refusal, the ledger runs", () => {
  const standing = { known: true, found: true, retired: false };
  assert.equal(stakeRefusalFor({ mark: "a/b", n: 1, promoted: false, status: standing, refused: null }), null);
  assert.equal(stakeRefusalFor({ mark: "a/b", n: 1, promoted: true, status: standing, refused: null }), null);
});

test("an UNREACHABLE store keeps the old posture — down and \"no\" are different facts", () => {
  // the store could not answer: no status, no refusal recorded
  assert.equal(stakeRefusalFor({ mark: "a/b", n: 1, promoted: false, status: { known: false }, refused: null }), null);
});

test("THE RELATION: given n ≥ 1 and no promotion, a bounce appears for exactly the refused cases", () => {
  const standing = { known: true, found: true, retired: false };
  let bounced = 0, through = 0;
  for (const refused of [null, new LateCrossingError(183, 185)])
    for (const status of [standing, { known: false }, { known: true, found: false }]) {
      const out = stakeRefusalFor({ mark: "a/b", n: 1, promoted: false, status, refused });
      assert.equal(out !== null, refused !== null, `refusal/bounce disagree for ${JSON.stringify({ refused: !!refused, status })}`);
      out ? bounced++ : through++;
    }
  assert.ok(bounced > 0 && through > 0, `one-sided matrix: ${bounced} bounced / ${through} through`);
});

// ── (e) THE LAWS THIS RESTS ON, QUOTED FROM THEIR OWN FILES ──────────────────

// The ordering was pinned here by reading the door's source, which survived a
// rename of the very calls it named and told us nothing about what runs first.
// It is a BEHAVIOUR, so it is watched as one: see § (f) below, where the door is
// driven and the two steps record the order they actually ran in.

test("the stake pen still names its standing reason when it releases a held deed", () => {
  assert.match(src("world2-claims.mjs"), /lateArrival: LATE_ARRIVAL_PUT_FORWARD/,
    "promoteDraftOnStake no longer declares the late arrival — a slept-on draft would refuse again");
});

// ── (f) THE DOOR ITSELF — the one line that stops the charge ─────────────────
//
// ADDED ON REVIEW, and the review is the point. The section above unit-tests
// `stakeRefusalFor` and pins the door's ordering by reading its source, and
// both passed while the reviewer's flip — the catch's class name changed to one
// that never arrives — put Sophia's debit straight back. Twelve green tests over
// a door that charged her anyway. Nothing here drove `worldStakeViaOffice` with
// a pen that refuses, so the `catch` that tells a refusal from an outage was
// never executed by this suite at all.
//
// THE ASSERTION THAT WAS MISSING IS AN ABSENCE: the ledger is NEVER CALLED. A
// bounce coming back is not enough — the old code could have charged her and
// then bounced. So the ledger is a spy and the test reads its call count, which
// is the only way "she was not charged" is a fact a test can hold.

import { worldStakeViaOffice } from "../src/world-stake.mjs";

const KEY = { handles: new Set(["sophia-familiaris"]), household: "kadakatzenberg" };
const MARK = "sophia-familiaris/the-familiar-house";

// The door with every collaborator answering, and the ledger counting. `promote`
// is whatever the case under test needs it to be.
function doorWith(promote) {
  const charges = [];
  const deps = {
    exists: async () => ({ known: true, exists: true, record: null }),
    standing: async () => ({ known: true, found: true, retired: false }),
    promote,
    ledger: async (payload) => { charges.push(payload); return { applied: payload.n, staked: payload.n }; },
  };
  return { deps, charges };
}

test("A LAWFUL REFUSAL NEVER REACHES THE LEDGER: the pen refuses, the door bounces 409, no stamp moves", async () => {
  const { deps, charges } = doorWith(async () => { throw new LateCrossingError(183, 185); });
  const out = await worldStakeViaOffice({ mark: MARK, stamps: 1 }, KEY, deps);
  assert.equal(charges.length, 0,
    `THE RESIDENT WAS CHARGED for a claim that was never filed — the ledger ran ${charges.length} time(s) after a lawful refusal. This is postmark#2722 reopened.`);
  assert.equal(out?.error, "bounce", "a refused promotion did not bounce");
  assert.equal(out.code, 409);
  assert.equal(out.held, 0);
  assert.equal(out.requested, 1);
});

test("AN UNREACHABLE STORE STILL LETS THE LEDGER RUN — down and \"no\" are different facts, at the door too", async () => {
  const { deps, charges } = doorWith(async () => { throw new Error("connect ECONNREFUSED 127.0.0.1:5432"); });
  const out = await worldStakeViaOffice({ mark: MARK, stamps: 1 }, KEY, deps);
  assert.equal(charges.length, 1, "a store outage swallowed the resident's stake — the old posture was not kept");
  assert.equal(charges[0].verb, "stake");
  assert.equal(charges[0].n, 1);
  assert.equal(out?.error, undefined, "an outage turned into a bounce");
});

test("THE RELATION AT THE DOOR: the ledger runs exactly when the promotion did not lawfully refuse", async () => {
  const cases = [
    ["a lawful refusal", async () => { throw new LateCrossingError(183, 185); }, false],
    ["a store outage", async () => { throw new Error("ECONNREFUSED"); }, true],
    ["an ordinary stake on a standing mark", async () => ({ promoted: false, claim: null, window: 186, late_from: null }), true],
    ["a promotion that went forward", async () => ({ promoted: true, claim: "c1", window: 186, late_from: null }), true],
    ["a slept-on draft, filed late", async () => ({ promoted: true, claim: "c1", window: 185, late_from: 183 }), true],
  ];
  let charged = 0, spared = 0;
  for (const [name, promote, shouldCharge] of cases) {
    const { deps, charges } = doorWith(promote);
    await worldStakeViaOffice({ mark: MARK, stamps: 1 }, KEY, deps);
    assert.equal(charges.length > 0, shouldCharge, `${name}: the ledger ${charges.length > 0 ? "ran" : "did not run"} and should have ${shouldCharge ? "run" : "not run"}`);
    shouldCharge ? charged++ : spared++;
  }
  assert.ok(charged > 0 && spared > 0, `one-sided matrix: ${charged} charged / ${spared} spared`);
});

test("a draft filed late is ANSWERED as such through the door, naming both windows", async () => {
  const { deps } = doorWith(async () => ({ promoted: true, claim: "c1", window: 185, late_from: 183 }));
  const out = await worldStakeViaOffice({ mark: MARK, stamps: 1 }, KEY, deps);
  assert.equal(out.put_forward, true);
  assert.equal(out.late_from_crossing, 183);
  assert.match(out.effect, /183/); assert.match(out.effect, /185/);
});

test("an ordinary same-window promotion says nothing about a late arrival", async () => {
  const { deps } = doorWith(async () => ({ promoted: true, claim: "c1", window: 186, late_from: null }));
  const out = await worldStakeViaOffice({ mark: MARK, stamps: 1 }, KEY, deps);
  assert.equal(out.put_forward, true);
  assert.equal("late_from_crossing" in out, false, "a same-window promotion claimed to be a late arrival");
});

test("THE ORDER IS A BEHAVIOUR, not a line number: the promotion runs, then the ledger", async () => {
  const order = [];
  const deps = {
    exists: async () => ({ known: true, exists: true, record: null }),
    standing: async () => { order.push("standing"); return { known: true, found: true, retired: false }; },
    promote: async () => { order.push("promote"); return { promoted: true, claim: "c1", window: 186, late_from: null }; },
    ledger: async (p) => { order.push("ledger"); return { applied: p.n }; },
  };
  await worldStakeViaOffice({ mark: MARK, stamps: 1 }, KEY, deps);
  assert.deepEqual(order, ["promote", "standing", "ledger"],
    "the stake's steps ran out of order — a refusal is only knowable before the debit if the promotion precedes it");
});

// POS-457 (review of #438): the promotion scopes by the STAKER'S KEY, through
// keyHouseholdOf, never by the key's login label alone. The door must hand the
// key over, or promoteDraftOnStake falls back to the label and a signed-in
// resident's stake misses their own draft filed under the slug.
test("THE STAKE DOOR hands the staker's KEY to the promotion", async () => {
  const seen = [];
  const deps = {
    exists: async () => ({ known: true, exists: true, record: null }),
    standing: async () => ({ known: true, found: true, retired: false }),
    promote: async (p) => { seen.push(p); return { promoted: true, claim: "c1", window: 186, late_from: null }; },
    ledger: async (p) => ({ applied: p.n }),
  };
  await worldStakeViaOffice({ mark: MARK, stamps: 1 }, KEY, deps);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].key, KEY, "the promotion receives the key itself");
  assert.equal(seen[0].householdName, KEY.household, "and the label rides beside it, for the keyless fallback only");
});
