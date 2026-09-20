// disclosed-read-qualifies-its-summary.test.mjs — a read that discloses its own
// drift says so ON the fields that drift qualifies (postmark-town/postmark#2889,
// kogane's eighth item).
//
// THE DEFECT AS REPORTED, and the half of it that is a compliment. The
// disclosure works: "A read named its own drift unprompted ('folded from one
// world, the class layer stands at another') — the August ask, shipped." What it
// did not do is reach the fields a reader decides on. In the SAME object he read
//
//     status  "published"
//     says    "published at S68 (…)"
//     cause   null
//
// three confident summaries with no marker that a sibling key qualified all
// three — "he filed the wrong verdict".
//
// THE SHAPE OF THE REPAIR, and why it is not the one he proposed. kogane
// suggested `status: "published (disclosed)"`. `status` is an enum callers
// branch on — `worldInvestigate` tests it against "never-was" in this same file
// — so rewriting the value a consumer switches on changes what the field MEANS
// rather than adding beside it. The enum stands untouched; the qualification
// arrives in the SENTENCE (which the door hands up as `note`, and which a
// reading agent actually reads) and as a flag for a reader that branches.
//
// WHAT IS UNDER TEST is that relation, never the wording: a disclosed read is
// never summarised bare, and an undisclosed one is untouched.
//
//   node --test test/disclosed-read-qualifies-its-summary.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { qualifiedByDisclosure } from "../src/world.mjs";

// The receipt kogane actually read, in the three fields he quoted.
const PUBLISHED = Object.freeze({
  id: "kogane/the-well-house",
  status: "published",
  says: "published at S68 (5c2321ae) on 2026-09-15T17:45:00Z",
  cause: null,
});
const DRIFT = "world-store-at-another-world: this answer was folded from refs/remotes/origin/main at 0123456789ab, and the class layer (world.db) stands at fedcba987654 — the two do not name the same world";

test("FALSIFIER — a disclosed read carries a marker ON its summary, not only a sibling key", () => {
  const q = qualifiedByDisclosure(PUBLISHED, [DRIFT]);

  // THE RED LINE. Before this repair the only account of the drift was the
  // `disclosed` array standing beside three untouched summary fields.
  assert.equal(q.qualified, true, "a summary standing over a disclosed caveat must say that it is qualified");
  assert.match(q.says, /qualified/i);
  assert.match(q.says, /disclosed/, "the marker must point at the key that holds the detail");

  // the detail is still carried, unchanged and un-summarised
  assert.deepEqual(q.disclosed, [DRIFT]);

  // ANTI-VACUITY: the original sentence survives inside the new one. A marker
  // that replaced the summary would be a different defect, not a fix.
  assert.ok(q.says.startsWith(PUBLISHED.says),
    `the door's own sentence must still lead:\n  was: ${PUBLISHED.says}\n  now: ${q.says}`);
});

test("FALSIFIER — an UNDISCLOSED read is byte-identical: no keys, no marker, nothing", () => {
  // This is the anti-vacuity partner of the test above and the additive
  // guarantee in one: if this ever returns keys, every ordinary receipt in the
  // town just grew a field.
  for (const nothing of [[], null, undefined, [null, false, ""]])
    assert.deepEqual(qualifiedByDisclosure(PUBLISHED, nothing), {},
      `nothing disclosed must add nothing — got keys for ${JSON.stringify(nothing)}`);
});

test("the STATUS ENUM is never rewritten — that was the stop, and it is asserted", () => {
  const q = qualifiedByDisclosure(PUBLISHED, [DRIFT]);

  // The proposal on the issue was `status: "published (disclosed)"`. A consumer
  // branching on `status === "published"` would have silently stopped matching.
  assert.equal(q.status, undefined, "this function must not return a status at all");
  const merged = { ...PUBLISHED, ...q };
  assert.equal(merged.status, "published", "the enum a caller switches on survives the qualification untouched");
  assert.equal(merged.cause, null);
  assert.equal(merged.id, PUBLISHED.id);
});

test("the count is the caveats', and a receipt with no sentence still gets the flag", () => {
  const two = qualifiedByDisclosure(PUBLISHED, [DRIFT, "some-other-caveat: and its reason"]);
  assert.match(two.says, /2 caveats/);
  assert.match(qualifiedByDisclosure(PUBLISHED, [DRIFT]).says, /a caveat/);

  // `says` is present on every branch of the receipt today, but a reader that
  // assumed so would break the day one is added without it. The flag and the
  // detail must not depend on a sentence existing to attach to.
  const sentenceless = qualifiedByDisclosure({ status: "published" }, [DRIFT]);
  assert.equal(sentenceless.qualified, true);
  assert.deepEqual(sentenceless.disclosed, [DRIFT]);
  assert.equal(sentenceless.says, undefined, "no sentence is not an invitation to invent one");
});
