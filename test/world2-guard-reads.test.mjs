// world2-guard-reads.test.mjs — the folds in `world2/tools/guard-reads.mjs`,
// exercised without a store.
//
// The equality falsifier (`falsifier-guard-equality.mjs`) is the real proof and
// it needs Postgres, a world checkout and a scratch database. This suite covers
// what that one CANNOT reach on this box, plus the arithmetic that would be
// silly to need a database for:
//
//   · THE LIVE HOLDING ERA. Nothing has been given, dropped or taken since the
//     mirror shipped (2026-08-28), so `acts` holds no `give`/`drop`/`take` row
//     and the falsifier's G5 exercises the frozen era only. The trap in that
//     era — `acts.actor` is the DECLARER, not the holder — is therefore tested
//     here, on rows shaped exactly as `mirrorHoldingAct` writes them.
//   · THE REFUSALS. A guard that skipped a row it could not read would PERMIT
//     wrongly, which is the one failure mode this port cannot have. Every
//     refusal branch is asserted to throw rather than to return a short list.
//   · THE ORDER GUARD. `assertAttachmentOrder` is what stands between
//     "latest wins" and whoever the seed inserted last.

import { test } from "node:test";
import assert from "node:assert/strict";

import * as guards from "../world2/tools/guard-reads.mjs";

// ── the row shapes, as their pens write them ────────────────────────────────

const legacyAttachment = (id, { at, seq, entity, target, policy = "cascade", declaredBy = entity }) => ({
  id, at: new Date(at), actor: entity, action: "legacy:attachment",
  payload: { at, seq, type: "attachment", actor: entity, payload: { policy, target, declared_by: declaredBy } },
});

// mirrorHoldingAct's own payload — world-hold.mjs § THE HOLDING GAP, CLOSED.
const holdingAct = (id, { at, actor, action, thing, holder, previousHolder = null, policy }) => ({
  id, at: new Date(at), actor, action,
  payload: { thing, holder, previous_holder: previousHolder, made_by: String(thing).split("/")[0], policy },
});

const claim = (over = {}) => ({
  id: "11111111-1111-1111-1111-111111111111",
  slug: "alfa/the-shed", class: "sited", claimant: "alfa", household: "gh:1",
  status: "draft", body: "a shed", geometry: { slug: "alfa/the-shed", at: { x: 1, y: 2 }, extent: { w: 3, h: 4 } },
  stake: 0, data: { by: "alfa", kind: "sited", date: "2026-08-28", _journal_seq: 7 },
  submitted_at: new Date("2026-08-28T00:00:00Z"),
  ...over,
});

// ═════════════════════════════════════════════════════════════════════════════
// THE LIVE LAYER
// ═════════════════════════════════════════════════════════════════════════════

test("liveMarkOf reassembles the record 1.0's guards destructure", () => {
  const { mark } = guards.liveMarkOf(claim());
  assert.equal(mark.id, "alfa/the-shed");
  assert.equal(mark.by, "alfa");
  assert.equal(mark.kind, "sited");
  assert.deepEqual(mark.at, { x: 1, y: 2 });
  assert.deepEqual(mark.extent, { w: 3, h: 4 });
  assert.equal(mark.body, "a shed");
  assert.equal(mark.seq, 7);
});

test("the bare slug is derived from the id — the docket pen discards it, and the collision guard says it back", () => {
  // `submitClaimFromJournal` opens `const { slug: _s, … } = payload`. Without
  // this the refusal reads: you already have a mark "undefined".
  const { mark } = guards.liveMarkOf(claim());
  assert.equal(mark.slug, "the-shed");
  // A slug with an interior segment still joins back whole, even though the
  // office's grammar does not produce one today.
  const { mark: deep } = guards.liveMarkOf(claim({ slug: "alfa/a/b" }));
  assert.equal(deep.slug, "a/b");
});

test("`by` falls back to the id's prefix, exactly as 1.0's liveMarks does", () => {
  const { mark } = guards.liveMarkOf(claim({ data: { kind: "sited" } }));
  assert.equal(mark.by, "alfa");
});

test("the plumbing keys never reach a mark record", () => {
  const { mark } = guards.liveMarkOf(claim({
    data: { by: "alfa", _journal_seq: 7, _act_id: "4242", _deferred_act: { actor: "alfa", payload: "{}" } },
  }));
  assert.equal("_deferred_act" in mark, false, "_deferred_act is a whole journal row; spreading it would put a second payload inside the mark");
  assert.equal("_journal_seq" in mark, false);
  // `_act_id` is the mark lane's flip adding a field to `data` (2026-09-04,
  // world2-claims § `_act_id`). Every field the docket pen adds has to be named
  // in the strip, or the guards hand the doors a pen's plumbing as something
  // the resident declared — and B1's guards are what PERMIT, so a stray field
  // there travels straight into a door's answer.
  assert.equal("_act_id" in mark, false);
});

test("the stake seam: stamps appears only when there is a stake", () => {
  assert.equal("stamps" in guards.liveMarkOf(claim({ stake: 0 })).mark, false,
    "1.0 carries no `stamps` key on an unstaked declaration; inventing stamps: 0 would make every draft differ");
  assert.equal(guards.liveMarkOf(claim({ stake: 5 })).mark.stamps, 5);
});

test("the boundary seam: put_forward appears only on a pending row", () => {
  assert.equal("put_forward" in guards.liveMarkOf(claim({ status: "draft" })).mark, false);
  assert.equal(guards.liveMarkOf(claim({ status: "pending" })).mark.put_forward, true);
});

test("a claim with no slug is REFUSED, never skipped", () => {
  const r = guards.liveMarkOf(claim({ slug: null }));
  assert.equal(r.refused, true);
  assert.match(r.reason, /identity is a column/);
  assert.throws(() => guards.liveMarkRecords([claim(), claim({ slug: null })]),
    /PERMIT wrongly/, "a strict read must throw — a guard that skipped it would permit a duplicate slug");
  // …and the non-strict read still NAMES it rather than losing it.
  const soft = guards.liveMarkRecords([claim(), claim({ slug: null })], { strict: false });
  assert.equal(soft.marks.length, 1);
  assert.equal(soft.refusals.length, 1);
});

test("held_review is not live, and the choice is a constant somebody can argue with", () => {
  assert.deepEqual([...guards.LIVE_STATUSES], ["draft", "pending"]);
});

// ═════════════════════════════════════════════════════════════════════════════
// HOLDING — the two eras, and the actor trap
// ═════════════════════════════════════════════════════════════════════════════

test("the frozen era reads the log event, seq and all", () => {
  const r = guards.attachmentRowOf(legacyAttachment(1, {
    at: "2026-08-15T21:52:24.761Z", seq: 1, entity: "little-m", target: "little-m/jar" }));
  assert.equal(r.era, "legacy");
  assert.deepEqual(r.row, { seq: 1, entity: "little-m", target: "little-m/jar",
    policy: "cascade", declared_by: "little-m", born_at: "2026-08-15T21:52:24.761Z" });
});

test("THE ACTOR TRAP: the live era's entity is the holder, not the actor", () => {
  // A GIVE. `declareHolding`: `entity = act === "drop" ? actor : (act === "take"
  // ? actor : to)` and `holder: act === "drop" ? null : entity`. So the
  // recipient holds it, and `acts.actor` is the giver.
  const give = guards.attachmentRowOf(holdingAct(1, {
    at: "2026-08-29T00:00:00.000Z", actor: "alfa", action: "give",
    thing: "alfa/the-lamp", holder: "bravo", previousHolder: "alfa", policy: "cascade" }));
  assert.equal(give.era, "live");
  assert.equal(give.row.entity, "bravo", "reading acts.actor here hands every given thing back to the giver");
  assert.equal(give.row.declared_by, "alfa");

  // A DROP. `holder` is null and the entity IS the actor — the one face where
  // the two coincide, which is why `payload.holder ?? actor` covers all three.
  const drop = guards.attachmentRowOf(holdingAct(2, {
    at: "2026-08-29T00:01:00.000Z", actor: "bravo", action: "drop",
    thing: "alfa/the-lamp", holder: null, previousHolder: "bravo", policy: "detach" }));
  assert.equal(drop.row.entity, "bravo");
  assert.equal(drop.row.policy, "detach");

  // A TAKE. Actor and holder are the same resident.
  const take = guards.attachmentRowOf(holdingAct(3, {
    at: "2026-08-29T00:02:00.000Z", actor: "alfa", action: "take",
    thing: "alfa/the-lamp", holder: "alfa", policy: "cascade" }));
  assert.equal(take.row.entity, "alfa");
});

test("the holder fold: latest wins, and `detach` means set down", () => {
  const rows = guards.attachmentRecords([
    legacyAttachment(1, { at: "2026-08-15T21:52:24.761Z", seq: 1, entity: "little-m", target: "little-m/jar" }),
    legacyAttachment(2, { at: "2026-08-15T21:52:30.488Z", seq: 2, entity: "hal", target: "little-m/jar", declaredBy: "little-m" }),
    holdingAct(3, { at: "2026-08-29T00:00:00.000Z", actor: "hal", action: "drop",
      thing: "little-m/jar", holder: null, previousHolder: "hal", policy: "detach" }),
  ]).rows;

  assert.equal(guards.pgHolderOf(rows.slice(0, 1), "little-m/jar"), "little-m");
  assert.equal(guards.pgHolderOf(rows.slice(0, 2), "little-m/jar"), "hal", "latest wins — the give moved it");
  assert.equal(guards.pgHolderOf(rows, "little-m/jar"), null, "a detach row is a thing set down, not a thing held");
  assert.deepEqual(guards.pgHoldingsOf(rows.slice(0, 2), "hal"), ["little-m/jar"]);
  assert.deepEqual(guards.pgHoldingsOf(rows, "hal"), [], "the drop empties their hands");
});

test("an unknown thing is held by nobody, and that is not a refusal", () => {
  assert.equal(guards.pgHolderOf([], "nobody/nothing"), null);
});

test("POS-992 · `withdraw` is a hold face AND a mark's and a creature's action: the attachment reads take live faces in class holding only, and keep the legacy arm as it was", () => {
  assert.ok(guards.HOLD_FACES.includes("withdraw"));
  assert.equal(guards.ATTACHMENT_CLASS_SQL, "(action = 'legacy:attachment' OR class = 'holding')");
  // why the class is asked: a mark withdrawal names no thing, so the strict fold would refuse it, and every holder read with it
  const markWithdraw = { id: 70, at: new Date("2026-11-11T15:00:00Z"), actor: "alfa", action: "withdraw", class: "mark", payload: { by: "alfa", slug: "shed", was_published: false } };
  assert.equal(guards.attachmentRowOf(markWithdraw).refused, true);
  assert.throws(() => guards.attachmentRecords([markWithdraw]), /the WRONG RESIDENT|naming no thing/);
  // the hold lane's own withdraw reads as the end of a holding (detach), the holder being nobody
  const held = holdingAct(71, { at: "2026-11-11T15:00:01.000Z", actor: "alfa", action: "withdraw", thing: "alfa/pebble", holder: null, previousHolder: "alfa", policy: "detach" });
  const r = guards.attachmentRowOf(held);
  assert.deepEqual([r.era, r.row.target, r.row.policy], ["live", "alfa/pebble", "detach"]);
});

test("a holding act matching no era is REFUSED, never skipped", () => {
  const forged = { id: 99, at: new Date(), actor: "alfa", action: "legacy:attachment", payload: { some: "future-pen" } };
  const r = guards.attachmentRowOf(forged);
  assert.equal(r.refused, true);
  assert.throws(() => guards.attachmentRecords([forged]), /the WRONG RESIDENT/);
});

test("the order guard fires when the eras are read out of the record's order", () => {
  const legacy = legacyAttachment(9, { at: "2026-08-15T21:52:24.761Z", seq: 1, entity: "a", target: "a/x" });
  const live = holdingAct(1, { at: "2026-08-29T00:00:00.000Z", actor: "a", action: "take",
    thing: "a/x", holder: "a", policy: "cascade" });
  assert.doesNotThrow(() => guards.assertAttachmentOrder([legacy, live]));
  assert.throws(() => guards.assertAttachmentOrder([live, legacy]), /ATTACHMENT_ORDER_SQL/,
    "an ORDER BY id would hand a thing to whoever the seed happened to insert last");
});

test("born_at must ascend — a descending read is the same defect wearing one era", () => {
  const a = legacyAttachment(1, { at: "2026-08-16T00:00:00.000Z", seq: 2, entity: "a", target: "a/x" });
  const b = legacyAttachment(2, { at: "2026-08-15T00:00:00.000Z", seq: 1, entity: "b", target: "a/x" });
  assert.throws(() => guards.assertAttachmentOrder([a, b]), /born_at-ascending/);
});

// ═════════════════════════════════════════════════════════════════════════════
// THE DISCLOSURES ARE PART OF THE ANSWER
// ═════════════════════════════════════════════════════════════════════════════

test("every disclosure this port owes is present and says something", () => {
  for (const k of ["sketchbook", "filing", "cross_household", "holdings_source",
                   "no_journal_row", "jsonb_key_order", "two_household_spellings"]) {
    assert.equal(typeof guards.DISCLOSURES[k], "string", `${k} is missing`);
    assert.ok(guards.DISCLOSURES[k].length > 80, `${k} is too short to be an honest disclosure`);
  }
});

test("the tripwires fire on the premises that are facts rather than law", () => {
  assert.match(guards.admissionNotes({ heldReview: 2 })[0], /held_review/);
  assert.match(guards.admissionNotes({ claims: [{ slug: "a/b", household: "darko" }] })[0], /never a bare handle/);
  assert.match(
    guards.admissionNotes({ actsHouseholds: ["darko"], claimHouseholds: ["gh:1"] })[0],
    /two spellings/);
  assert.equal(guards.admissionNotes({ actsHouseholds: ["gh:1"], claimHouseholds: ["gh:1"] }).length, 0,
    "the note must go quiet the day the acts mirror adopts the docket pen's ruling");
  assert.match(
    guards.admissionNotes({ attachments: [{ era: "legacy" }] })[0],
    /NOT\s+exercised by any row/);
});
