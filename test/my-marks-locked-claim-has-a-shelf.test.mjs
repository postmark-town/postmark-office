// my-marks-locked-claim-has-a-shelf.test.mjs — bug post #4014: the my-marks read
// has no shelf for a locked or held claim.
//
// THE REPORT, verbatim (kogane, 2026-10-19; the kept record on the bug post,
// postmark-town/postmark#4014):
//
//   "Expected: the bare read shows the bowl on some shelf while it is locked and
//    waiting for its settlement.
//    Actually happened: the bare read's counts were drafts 1 (a different mark),
//    docket 0, published 0, refused 0. The bowl was on no shelf. The focused read
//    said status locked, window 259, 'the candle ruled for it; it reaches the
//    world at the settlement that carries that candle'."
//
// ── WHAT THIS FILE HOLDS, AND WHAT IT DOES NOT (read this before editing) ───
//
// The code's own warning, `world.mjs § worldMyMarks`, names two things at once:
//
//   "`drafts` IS A NEGATIVE FILTER, AND IT IS CORRECT ONLY BECAUSE
//    `LIVE_STATUSES` IS EXACTLY `["draft","pending"]` … The day a `locked`,
//    `refused` or `held_review` row joins that constant, it lands HERE and is
//    labelled 'YOURS AND PRIVATE — on no docket, in no export, in no archive, in
//    no public answer' about a row 007 makes public."
//
// and the brief for #4014 took the two lines under it for the cause. They are
// not. A locked claim is never in the list those two lines split, because the
// overlay reads `claims` with `status = ANY(LIVE_STATUSES)` and `locked` is not
// in it (`guard-reads.mjs § LIVE_STATUSES`: "locked  gone — it is a row in
// `marks` now, which is canon"; pinned by leave-mark-drafts-and-docket and
// world2-guard-reads, and the equality falsifier's first proof is a RED when it
// is widened). So on prod today the bowl is on no shelf because it is never
// read, and the negative filter is a trap that has not been sprung.
//
// What is held here:
//
//   1 · THE HARNESS IS LIVE (a control): through the real door, a draft files
//       under `drafts` and a pending claim under `docket`, and the overlay asked
//       the store for exactly draft and pending. Without this, "the bowl is on no
//       shelf" could mean the harness read nothing.
//   2 · DRAFTS ARE DRAFTS (RED at the base, green with the positive filter): the
//       day the reader hands back a locked row, it is not filed under the private
//       word. This is the trap, simulated — the store here returns the row
//       whatever statuses were asked for, standing for LIVE_STATUSES widened.
//   3 · A ROW WITH NO CLAIM STATUS (the sketchbook half) is still private. The
//       positive filter must not drop it: `=== "draft"` alone would.
//   4 · KOGANE'S SHAPE (the acceptance falsifier): a claim the candle locked,
//       not yet carried, is on a shelf of its own and in `counts`. SKIPPED, with
//       its reason in the title: the reader does not carry locked claims into
//       this read, and how it should is not ruled (the PR body has the gap read).
//       It was run red against the base with MY_MARKS_LOCKED_SHELF=1; un-skip it
//       the day the reader is ruled, and it must go green.
//
// Run: WORLD_CLONE=<tree>/world-clone node --import ./test/helpers/sparse-guard.mjs \
//        --test --test-concurrency=1 test/my-marks-locked-claim-has-a-shelf.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { useGuardReader } from "../src/world2-guards.mjs";
import { __clearHouseCache } from "../src/household-deriver.mjs";
import { LIVE_STATUSES } from "../world2/tools/guard-reads.mjs";
// Imported HERE, before any test registers (world.mjs awaits the world graph
// snapshot's load at import — see my-marks-refused.test.mjs).
import { WORLD_CLONE, worldMyMarks } from "../src/world.mjs";

const TOWN_CLONE = process.env.TOWN_CLONE ?? join(WORLD_CLONE, "..", "town-clone");
const HAVE = existsSync(join(WORLD_CLONE, "WORLD", "world-state.json"))
  && existsSync(join(TOWN_CLONE, "tools", "world-stake.mjs"));
const WHY_NOT = `needs a world clone at ${WORLD_CLONE} and a town clone at ${TOWN_CLONE}`;
const WHY_SKIPPED = "SKIPPED until ruled (#4014, STOP on shape): the reader does not carry locked claims into this read and how it should is unruled; MY_MARKS_LOCKED_SHELF=1 runs it, red";

// ── the fixture: one household of one resident, no registry, a hand-built store ──
//
// A handle nothing else in the suite uses (`world2-claims.mjs` keeps a
// process-wide house cache). With no registry rows the handle is its own house,
// `solo:<handle>`, which is also the key every claim below is filed under.
const HANDLE = "pos4014-kogane";
const HOUSE = `solo:${HANDLE}`;
const KEY = { household: "pos4014", handles: new Set([HANDLE]) };

const BOWL = `${HANDLE}/the-bowl-on-the-step`;      // Kogane's shape: locked, stamps 0, our own parcel, not in canon
const SHED = `${HANDLE}/the-private-shed`;
const STAKED = `${HANDLE}/the-staked-shed`;
const NOTHING = `${HANDLE}/a-row-with-no-claim-status`;

/** A `claims` row as `LIVE_CLAIM_SELECT` returns it (plus the candle's window, which that select omits). */
let serial = 0;
const claim = ({ id, status, stake = 0, window_id = 259 }) => ({
  id: `00000000-0000-0000-0000-${String(++serial).padStart(12, "0")}`,
  slug: id, class: "sited", claimant: HANDLE, household: HOUSE, status, body: `the body of ${id}`,
  geometry: { slug: id, at: { x: 12, y: 34 }, extent: { w: 2, h: 2 } },
  stake, data: { by: HANDLE, kind: "sited", date: "2026-10-19" },
  submitted_at: new Date("2026-10-19T17:17:27Z"), window_id,
});

/**
 * The store. It honours what the reader depends on — and that is the whole of
 * its value: a fake that ignored `status = ANY($1)` could not tell a reader that
 * never asks for a locked claim from one that asks and drops it
 * (TEST-DESIGN § A fake must honour what the code depends on).
 *
 * `honourStatuses: false` is the ONE deliberate lie, for the test that stands for
 * "LIVE_STATUSES widened": it hands back every row of the house whatever statuses
 * were asked for. It is named at its call site, never the default.
 *
 * A query it does not know THROWS: an empty answer to a question it does not
 * understand reads as "the record holds none".
 */
function store(rows, { honourStatuses = true } = {}) {
  let declared = null, declaredKeys = null;
  const claimsAsked = [];
  return {
    claimsAsked,
    async query(sql, args = []) {
      const q = String(sql).replace(/\s+/g, " ").trim();
      if (/set_config\(.app\.household_keys./.test(q)) { declaredKeys = args[0] ? String(args[0]).split(",") : null; return { rows: [{}] }; }
      if (/set_config\(.app\.household./.test(q)) { declared = args[0]; return { rows: [{}] }; }
      if (/current_setting\(.app\.household./.test(q)) return { rows: [{ declared, keys: declaredKeys }] };
      // The overlay's DELETED arm (guard-reads.mjs § WITHDRAW_ACT_SELECT): nothing withdrawn here.
      if (/^SELECT/i.test(q) && /FROM acts a/.test(q) && /'withdraw'/.test(q)) return { rows: [] };
      // The registry, three fixed SELECTs: empty, so every handle is its own `solo:` house.
      if (/FROM households/.test(q) || /FROM household_pins/.test(q) || /FROM identities/.test(q)) return { rows: [] };
      if (/FROM registry_meta/.test(q)) return { rows: [{ key: "schema_version", value: 1 }] };
      if (/^SELECT/i.test(q) && /FROM claims/.test(q)) {
        const [statuses, asked] = args;
        claimsAsked.push({ statuses: [...statuses], households: [].concat(asked ?? []) });
        const keys = asked == null ? null : [].concat(asked);
        return { rows: rows.filter((c) => (honourStatuses ? statuses.includes(c.status) : true)
          && (keys == null || keys.includes(c.household))) };
      }
      throw new Error(`the hand-built store was asked something it does not know: ${q.slice(0, 120)}`);
    },
    release() { /* pooled in name only */ },
  };
}

/** Read the door as KEY, through a store holding `rows`. */
async function door(rows, opts) {
  const fake = store(rows, opts);
  __clearHouseCache();
  const restore = useGuardReader(async (run) => run(fake));
  try {
    const answer = await worldMyMarks(KEY);
    assert.ok(!answer?.error, `the door bounced: ${JSON.stringify(answer?.defect ?? answer).slice(0, 300)}`);
    return { answer, fake };
  } finally { restore(); __clearHouseCache(); }
}

/** Every list the answer carries, by name, as the ids on it. (Shape-agnostic on purpose: the shelf's name is not ruled.) */
const shelvesOf = (answer) => Object.fromEntries(Object.entries(answer)
  .filter(([, value]) => Array.isArray(value))
  .map(([name, rows]) => [name, rows.map((row) => (typeof row === "string" ? row : row?.id))]));
const shelvesHolding = (answer, id) => Object.entries(shelvesOf(answer)).filter(([, ids]) => ids.includes(id)).map(([name]) => name);

// ═════════════════════════════════════════════════════════════════════════════
// 1 · THE HARNESS IS LIVE
// ═════════════════════════════════════════════════════════════════════════════

test("CONTROL: through the real door a draft files under drafts and a pending claim under docket, and the overlay asked for draft and pending only", { skip: HAVE ? false : WHY_NOT }, async () => {
  const { answer, fake } = await door([
    claim({ id: SHED, status: "draft" }),
    claim({ id: STAKED, status: "pending", stake: 2 }),
    claim({ id: BOWL, status: "locked" }),
  ]);
  assert.deepEqual(shelvesHolding(answer, SHED), ["drafts"], "a private draft files under drafts");
  assert.deepEqual(shelvesHolding(answer, STAKED), ["docket"], "a pending claim files under docket");
  assert.equal(answer.counts.drafts, 1);
  assert.equal(answer.counts.docket, 1);
  // The premise, measured at the artifact the code reads: the overlay's SELECT
  // carries LIVE_STATUSES, so a locked row is not asked for and never arrives.
  assert.ok(fake.claimsAsked.length > 0, "the overlay never asked the store for claims — the harness read nothing, and every absence below would mean nothing");
  for (const ask of fake.claimsAsked) assert.deepEqual(ask.statuses, [...LIVE_STATUSES], "the overlay asks for exactly the live statuses");
  assert.deepEqual([...LIVE_STATUSES], ["draft", "pending"], "and those are draft and pending, the two sides of 007's line");
});

// ═════════════════════════════════════════════════════════════════════════════
// 2 · DRAFTS ARE DRAFTS
// ═════════════════════════════════════════════════════════════════════════════

test("DRAFTS ARE DRAFTS: a live row with a claim status the shelves do not know is never filed under the private word", { skip: HAVE ? false : WHY_NOT }, async () => {
  // LAW (world2/schema/007_private_drafts.sql, as leave-mark-drafts-and-docket
  // quotes it): "USING (status <> 'draft' OR household = current_setting('app.household', true))"
  // — a draft is private to its household; EVERY OTHER STATUS IS PUBLIC. So the
  // word the read puts on a locked row must never be the private one.
  //
  // `honourStatuses: false` — the one lie, on purpose: the store hands the locked
  // row back whatever was asked for, which is what the read sees the day
  // LIVE_STATUSES is widened (the event the code's own comment warns about).
  const { answer } = await door([claim({ id: SHED, status: "draft" }), claim({ id: BOWL, status: "locked" })], { honourStatuses: false });
  // The control that the row reached the splitter at all: the draft arrived beside it.
  assert.deepEqual(shelvesHolding(answer, SHED), ["drafts"], "the control: the draft that arrived with it is on drafts, so the overlay ran");
  assert.ok(!shelvesHolding(answer, BOWL).includes("drafts"),
    `a LOCKED claim, public by 007, was filed under "drafts" — the word the labels call "your drafts, not the town's canon, on no docket"; it is on: ${JSON.stringify(shelvesHolding(answer, BOWL))}, drafts: ${JSON.stringify(shelvesOf(answer).drafts)}`);
  assert.equal(answer.counts.drafts, 1, "and counts.drafts counts the one draft, not the locked row");
});

// ═════════════════════════════════════════════════════════════════════════════
// 3 · THE SKETCHBOOK HALF STAYS PRIVATE
// ═════════════════════════════════════════════════════════════════════════════

test("a live row with NO claim status (a sketchbook row) is private, so it still files under drafts", { skip: HAVE ? false : WHY_NOT }, async () => {
  // GUARD 2's own header: dropping the sketchbook half "would make a resident's
  // existing work vanish from their own overlay on the day the guard flipped".
  // A row with no `status` column comes through the overlay with no
  // `claim_status`, exactly as a sketchbook row does. (`honourStatuses: false`
  // is how it gets past the status filter here: a real `claims` row always has a
  // status; the sketchbook half has none, and rides the git delta, not the SQL.)
  const bare = { ...claim({ id: NOTHING, status: "draft" }), status: undefined };
  const { answer } = await door([bare], { honourStatuses: false });
  assert.deepEqual(shelvesHolding(answer, NOTHING), ["drafts"], "a row the docket never held cannot be on the docket, and is private");
  assert.equal(answer.counts.drafts, 1);
  assert.equal(answer.counts.docket, 0);
});

// ═════════════════════════════════════════════════════════════════════════════
// 4 · KOGANE'S SHAPE — the acceptance falsifier
// ═════════════════════════════════════════════════════════════════════════════

test("KOGANE'S SHAPE (acceptance): a claim the candle locked, not yet carried, is on a shelf of its own and in counts", { skip: !HAVE ? WHY_NOT : process.env.MY_MARKS_LOCKED_SHELF === "1" ? false : WHY_SKIPPED }, async () => {
  // LAW (mark-receipt.mjs § receiptFrom, the focused read's own sentence for this
  // state): "locked at candle N — the candle ruled for it; it reaches the world
  // at the settlement that carries that candle". The bare read owes the resident
  // the same fact about the same mark.
  const { answer, fake } = await door([claim({ id: BOWL, status: "locked", stake: 0 })]);
  const on = shelvesHolding(answer, BOWL);
  assert.ok(on.length > 0,
    `${BOWL} is on NO shelf (the bug post's own words: "The bowl was on no shelf"). shelves: ${JSON.stringify(shelvesOf(answer))}; counts: ${JSON.stringify(answer.counts)}; the overlay asked the store for statuses ${JSON.stringify(fake.claimsAsked.map((a) => a.statuses))}`);
  assert.ok(!on.includes("drafts"), "a locked claim is public; it is not a draft");
  assert.ok(!on.includes("docket"), "the docket is the pending claims; a locked one has left it");
  for (const shelf of on) assert.ok(answer.counts[shelf] >= 1, `${shelf} holds ${BOWL} but counts.${shelf} is ${answer.counts[shelf]}`);
});
