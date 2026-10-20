// retire-marks.test.mjs — the falsifiers for the retire step at the settlement
// seam (G1 lane 1).
//
// THE LAW EACH ONE QUOTES. `retireMarks` exists because of one sentence in
// 001_tables.sql, which has been true and unenforced since the first migration:
//
//   marks.status  text NOT NULL DEFAULT 'standing'
//                 CHECK (status IN ('standing','retired'))   (001_tables.sql:109-110)
//   retired_window integer REFERENCES windows(id)            (001_tables.sql:112)
//
// A column with a CHECK nobody writes is a law with no pen. These tests are the
// pen's proof.
//
// ── THE CAN-FAIL FLIP, REPRODUCIBLE ─────────────────────────────────────────
//
// The flip is the exact four-line edit recorded in `materialize.mjs`'s
// `retireMarks` header (§ THE CAN-FAIL FLIP, AS A DIFF). Apply it, then:
//
//   node --test test/retire-marks.test.mjs
//     → 9 tests · 6 pass · 3 fail        (re-run 2026-09-08 on 9259657)
//   node --test test/retire-marks.test.mjs test/settlement-receipt-retired.test.mjs
//     → 15 tests · 12 pass · 3 fail      (first run, on 6b9045f)
//
// Same three reds either way — the second command only adds six green receipt
// tests, which is why the two numbers differ and neither is wrong. Naming the
// COMMAND beside the count is the repair: "12 pass / 3 fail" alone cannot be
// checked by anyone who runs a different file set.
//
// THE THREE REDS: tests 1, 2 and 4. The greens: 3, 5, 6, 7, 8.
//
// WHY THE FLIP IS A SELECT AND NOT A DELETED LINE: the `register` stub below
// THROWS on SQL it does not model, so most ways of "removing the write" produce
// an error rather than this split. The chosen SELECT is one the stub already
// answers, which is what makes the flip runnable at all — the detail my first
// prose write-up lost, and the reviewer's repair 3.
//
// I PREDICTED FOUR REDS AND GOT THREE, kept rather than quietly corrected. I
// expected test 6 (the missing-window refusal) to red; it does not, because its
// throw happens BEFORE the UPDATE is reached, so it never touches the disabled
// code. The test is right and the prediction was wrong — it guards an argument,
// not a write.
//
// The half that matters: tests 3 and 5 are the negative controls and they
// stayed GREEN under the flip. A control that reds when the feature is removed
// was never a control.

import { test } from "node:test";
import assert from "node:assert/strict";

import { retireMarks } from "../world2/tools/materialize.mjs";
import { WITHDRAW_CAUSE, retireFromSweep, retireOnlyFromFoldInput, slugsFromSweep, withdrawnSlugsFromSweep } from "../world2/tools/retire-unpublished.mjs";

/**
 * A register, as a fake `q`. It answers exactly the two statements
 * `retireMarks` issues and refuses anything else — a stub that accepted any SQL
 * would let the function drift into a statement no test had ever seen, which is
 * the "something between the assertion and the code silently narrows the input"
 * class (four lanes, one shape, 09-05). Refusing the unknown is what keeps this
 * a test of the function rather than of the stub.
 */
function register(rows) {
  const marks = new Map(rows.map((r) => [r.slug, { retired_window: null, ...r }]));
  const seen = [];
  const q = async (text, args) => {
    seen.push(text.replace(/\s+/g, " ").trim());
    if (/^UPDATE marks SET status = 'retired'/.test(text.trim())) {
      const [slug, windowId] = args;
      const m = marks.get(slug);
      if (!m || m.status !== "standing") return { rows: [] };
      m.status = "retired";
      m.retired_window = windowId;
      return { rows: [{ slug, locked_window: m.locked_window ?? null }] };
    }
    if (/^SELECT status, retired_window FROM marks WHERE slug/.test(text.trim())) {
      const m = marks.get(args[0]);
      return { rows: m ? [{ status: m.status, retired_window: m.retired_window }] : [] };
    }
    throw new Error(`the register was asked a statement these tests do not model: ${text}`);
  };
  return { q, marks, seen };
}

const standing = (slug, locked_window = 100) => ({ slug, status: "standing", locked_window });

// ── 1 · a mark the sweep unpublished is retired, with the window named ───────
test("an unpublished mark is retired at the named window", async () => {
  const { q, marks } = register([standing("berthillon/pistache-cone-for-julian", 168)]);
  const r = await retireMarks(q, { slugs: ["berthillon/pistache-cone-for-julian"], windowId: 174 });

  assert.equal(r.retired.length, 1);
  assert.equal(r.retired[0].slug, "berthillon/pistache-cone-for-julian");
  // The window is named, and it is the RETIRING window — not the locking one.
  // 001 gives the row two columns for two different instants and conflating
  // them would make the register unable to say how long the mark stood.
  assert.equal(r.retired[0].window, 174);
  assert.equal(r.retired[0].locked_window, 168);
  assert.equal(r.retired[0].cause, "settlement-unpublish");

  const row = marks.get("berthillon/pistache-cone-for-julian");
  assert.equal(row.status, "retired");
  assert.equal(row.retired_window, 174);
});

// ── 2 · the store-only class goes to zero ────────────────────────────────────
test("every slug the world let go stops standing in the register", async () => {
  const gone = ["the-town/pledges", "wright/final-unstaked", "little-bird/the-second-spoon-verdict"];
  const { q, marks } = register([...gone.map((s) => standing(s)), standing("current-the-reader/the-decks")]);

  await retireMarks(q, { slugs: gone, windowId: 174 });

  // This is `falsifier-standing-equality`'s "store carries X the register does
  // not" class, asked of the three rows directly.
  const stillStanding = gone.filter((s) => marks.get(s).status === "standing");
  assert.deepEqual(stillStanding, [], "the store-only class must be zero after the step");
});

// ── 3 · THE NEGATIVE CONTROL — a mark the fold still carries is untouched ────
test("a standing mark the world still carries is NOT retired", async () => {
  const { q, marks } = register([standing("current-the-reader/the-decks"), standing("the-town/pledges")]);

  await retireMarks(q, { slugs: ["the-town/pledges"], windowId: 174 });

  const kept = marks.get("current-the-reader/the-decks");
  assert.equal(kept.status, "standing", "a mark nobody named must keep standing");
  assert.equal(kept.retired_window, null, "and must not be stamped with a window it never left at");
});

// ── 4 · idempotent, and it can say which zero it means ───────────────────────
test("a second run retires nothing and says so as already_retired, not as success", async () => {
  const { q, marks } = register([standing("the-town/pledges")]);

  const first = await retireMarks(q, { slugs: ["the-town/pledges"], windowId: 174 });
  assert.equal(first.retired.length, 1);

  const second = await retireMarks(q, { slugs: ["the-town/pledges"], windowId: 175 });
  assert.equal(second.retired.length, 0, "a re-run must write nothing");
  assert.equal(second.already_retired.length, 1);
  assert.equal(second.already_retired[0].retired_window, 174,
    "the ORIGINAL retiring window survives a re-run — a second pass must not restamp history");
  assert.equal(marks.get("the-town/pledges").retired_window, 174);
});

// ── 5 · a slug the register never held is reported, not thrown ───────────────
test("a slug the store never materialized is reported absent rather than refusing the crossing", async () => {
  const { q } = register([standing("current-the-reader/the-decks")]);

  const r = await retireMarks(q, { slugs: ["someone/founding-estate"], windowId: 174 });

  assert.deepEqual(r.absent, [{ slug: "someone/founding-estate" }]);
  assert.equal(r.retired.length, 0);
  assert.equal(r.already_retired.length, 0,
    "absent and already-retired are different facts and must not share a spelling");
});

// ── 6 · the window is required, because a retirement is ruled AT one ─────────
test("retireMarks refuses without the window it rules at", async () => {
  const { q } = register([standing("the-town/pledges")]);
  await assert.rejects(
    () => retireMarks(q, { slugs: ["the-town/pledges"], windowId: null }),
    /needs the window it rules at/);
});

// ── 7 · ONLY the unpublished channel is read ─────────────────────────────────
//
// The sweep has seven other array-valued channels and none of them is a
// retirement. `dropped` is the sharpest: it is the-already-standing, a copy
// that was never a conflict — the ORIGINAL still stands, so retiring by that id
// would retire the survivor.
test("only the unpublished channel becomes a retirement", () => {
  const sweep = {
    published: [{ id: "a/one" }],
    unpublished: [{ id: "b/two" }, { id: "c/three" }],
    left_drafted: [{ id: "d/four" }],
    withdrawn: [{ id: "e/five" }],
    quarantined: [{ id: "f/six" }],
    suite_quarantined: [{ id: "g/seven" }],
    dropped: [{ id: "h/eight" }],
    rebased: [{ branch: "draft/x" }],
  };
  assert.deepEqual(slugsFromSweep(sweep), ["b/two", "c/three"]);
});

test("a sweep with no unpublished channel yields nothing rather than throwing", () => {
  assert.deepEqual(slugsFromSweep({ published: [{ id: "a/one" }] }), []);
  assert.deepEqual(slugsFromSweep({}), []);
  assert.deepEqual(slugsFromSweep(null), []);
});

// ── 8 · the receipt names each slug retired and its cause ────────────────────
test("the receipt names every slug and the door it left by", async () => {
  const { q } = register([standing("a/one"), standing("b/two")]);
  const r = await retireMarks(q, { slugs: ["b/two", "a/one"], windowId: 174 });

  // Sorted, so two crossings that retired the same set produce the same
  // receipt — a receipt whose row order depends on the caller's iteration is a
  // diff that lies.
  assert.deepEqual(r.retired.map((x) => x.slug), ["a/one", "b/two"]);
  for (const row of r.retired) {
    assert.equal(row.cause, "settlement-unpublish");
    assert.equal(row.window, 174);
  }
});

// ── 9 · THE WITHDRAWN CHANNEL IS THE OTHER DOOR OUT OF CANON (WLD-88) ────────
//
// A published mark its author withdrew leaves canon by the sweep's `withdrawn`
// channel. Its store row must retire too, or it keeps holding ground and the
// fold's carry writes it back the next crossing. It retires under its own
// cause and is returned to no one's drafts: the author let it go (settled on
// WLD-88, 2026-10-20).
test("only the withdrawn channel becomes a withdrawal's retirement", () => {
  const sweep = {
    published: [{ id: "a/one" }], unpublished: [{ id: "b/two" }], left_drafted: [{ id: "d/four" }],
    withdrawn: [{ id: "e/five" }], quarantined: [{ id: "f/six" }], dropped: [{ id: "h/eight" }],
  };
  assert.deepEqual(withdrawnSlugsFromSweep(sweep), ["e/five"]);
  assert.deepEqual(slugsFromSweep(sweep), ["b/two"], "and the unpublish reader still reads its own channel only");
  assert.deepEqual(withdrawnSlugsFromSweep({}), []);
  assert.deepEqual(withdrawnSlugsFromSweep(null), []);
});

test("retireFromSweep retires the withdrawn under their own cause and returns none of them to drafts", async () => {
  const { q, marks } = register([standing("b/two"), standing("current/the-bed")]);
  const causes = [];
  const wrapped = async (text, args) => {
    if (/^UPDATE marks SET status = 'retired'/.test(text.trim())) causes.push([args[0], args[2]]);
    return q(text, args);
  };
  const asked = [];
  const returnDrafts = async (_q, { slugs }) => { asked.push(slugs); return { returned: [], kept: [], unreturned: [] }; };
  const r = await retireFromSweep(wrapped, {
    sweep: { unpublished: [{ id: "b/two" }], withdrawn: [{ id: "current/the-bed" }] }, windowId: 251, returnDrafts,
  });

  assert.deepEqual(causes, [["b/two", "settlement-unpublish"], ["current/the-bed", WITHDRAW_CAUSE]]);
  assert.equal(WITHDRAW_CAUSE, "settlement-withdraw");
  assert.deepEqual(asked, [["b/two"]], "only the taken go back to drafts");
  assert.equal(r.count, 1, "`count` stays the unpublish door's, as every earlier receipt read it");
  assert.equal(r.withdrawn.count, 1);
  assert.deepEqual(r.withdrawn.retired.map((x) => [x.slug, x.window, x.cause]), [["current/the-bed", 251, WITHDRAW_CAUSE]]);
  assert.equal(marks.get("current/the-bed").status, "retired");
});

test("an owed withdrawal retirement from the fold input retires as settlement-withdraw, returns to no drafts, and is named", async () => {
  assert.deepEqual(retireOnlyFromFoldInput({ selection: { withdrawn_owed: { retire_only: ["current/the-bed", "", 7] } } }), ["current/the-bed"]);
  assert.deepEqual(retireOnlyFromFoldInput({}), [], "a fold input from before the field owes nothing");
  assert.deepEqual(retireOnlyFromFoldInput(null), []);

  const { q, marks } = register([standing("current/the-bed")]);
  const asked = [];
  const r = await retireFromSweep(q, {
    sweep: { unpublished: [], withdrawn: [] }, windowId: 252, retireOnly: ["current/the-bed"],
    returnDrafts: async (_q, { slugs }) => { asked.push(slugs); return { returned: [], kept: [], unreturned: [] }; },
  });
  assert.deepEqual(r.withdrawn.retired.map((x) => [x.slug, x.window, x.cause]), [["current/the-bed", 252, WITHDRAW_CAUSE]]);
  assert.deepEqual(r.withdrawn.retire_only, ["current/the-bed"]);
  assert.deepEqual(asked, [[]], "nothing goes back to drafts");
  assert.equal(marks.get("current/the-bed").status, "retired");
});
