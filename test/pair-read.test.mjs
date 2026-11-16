// pair-read.test.mjs — `town { read: "pair", args: { a, b } }`: two residents' public correspondence, the quote BY RULE (POS-1027; Darko, POS-1024/c).
//
//   node --test test/pair-read.test.mjs
//
//   1. first letter, counts each way (a multi-recipient letter counts for each recipient), newest each way with the tie-break the public letter index uses, and
//      the milestones the pair reached, from the quest board's own rows; a letter that never arrived is no correspondence;
//   2. THE QUOTE IS THE LITERAL FIRST LINE, not letterExcerpt's paragraph: on a letter that opens with a heading, a greeting and a long paragraph the two
//      DIFFER, and the quote is the heading, as written (this is the falsifier against reusing the excerpt helper);
//   3. an unknown resident is 404, the same resident twice 422, a missing side 422; the answer is dated by the index's own head, not the clock;
//   4. the store's recipient reading: a "x, y" column and a toList both name the recipients.

import test from "node:test";
import assert from "node:assert/strict";
import { pairRead, firstLine, newestFirst, pairMilestones, QUOTE_MAX } from "../src/pair-read.mjs";
import { letterExcerpt } from "../src/queries.mjs";
import { recipientsOf } from "../src/town-index-store.mjs";

const letter = (id, from, to, date, deliveredAt, extra = {}) => ({ id, from_h: from, to_h: to, date, delivered_at: deliveredAt, thread: "new", multi: null, ...extra });
const BODIES = new Map();
const body = (id, text) => { BODIES.set(id, { id, body: text }); };

// a letter that opens with a heading, a greeting and a long paragraph: the excerpt skips the first two, the quote must not
const HEADED = "# A note on the weather\n\nDear Ada,\n\nIt has rained on the quay since Tuesday, and the lamplighters have taken to carrying their ladders on their shoulders like umbrellas.\n";

function ix({ letters, boards = {}, residents = ["ada", "bo", "cy"], fail = {} } = {}) {
  return {
    hasResident: async (h) => residents.includes(h),
    lettersBetween: async (a, b) => letters.filter((r) => r.delivered_at && ((r.from_h === a && recipientsOf(r).includes(b)) || (r.from_h === b && recipientsOf(r).includes(a)))),
    letterBodies: async (ids) => new Map(ids.filter((i) => BODIES.has(i)).map((i) => [i, BODIES.get(i)])),
    questBoard: async (h) => { if (fail[h]) throw new Error("board down"); return boards[h] ?? { quests: [] }; },
    asOf: async () => "head-sha-1",
  };
}

const LETTERS = [
  letter("ada-1", "ada", "bo", "2026-10-01", "2026-10-01T12:00:00.000Z"),
  letter("bo-1", "bo", "ada", "2026-10-02", "2026-10-02T12:00:00.000Z"),
  letter("ada-2", "ada", "bo", "2026-10-05", "2026-10-05T12:00:00.000Z"),
  // two from bo at ONE instant: the tie breaks on id ascending, as the public letter index orders
  letter("bo-2", "bo", "ada", "2026-10-07", "2026-10-07T12:00:00.000Z"),
  letter("bo-3", "bo", "ada", "2026-10-07", "2026-10-07T12:00:00.000Z"),
  // a letter to several: ada wrote to bo AND cy
  letter("ada-3", "ada", "cy", "2026-10-09", "2026-10-09T12:00:00.000Z", { multi: JSON.stringify({ toList: ["cy", "bo"] }) }),
  // never arrived: not correspondence
  letter("ada-undelivered", "ada", "bo", "2026-10-20", null),
  letter("cy-1", "cy", "ada", "2026-10-03", "2026-10-03T12:00:00.000Z"),
];
body("ada-3", HEADED);
body("bo-3", "Thank you, truly.\nMore below.");
body("bo-2", "never the latest");

test("1 · first letter, counts each way (a letter to several counts for each), the newest each way with the index's tie-break, delivered only", async () => {
  const r = await pairRead({ a: "ada", b: "bo" }, { ix: ix({ letters: LETTERS }) });
  assert.equal(r.read, "pair");
  assert.deepEqual([r.a, r.b], ["ada", "bo"]);
  assert.equal(r.first.id, "ada-1");
  assert.equal(r.first.from, "ada");
  assert.deepEqual(r.letters, { a_to_b: 3, b_to_a: 3 }, "ada-1, ada-2 and the multi-recipient ada-3; bo-1, bo-2, bo-3; the undelivered one is not counted");
  assert.equal(r.latest.a_to_b.id, "ada-3");
  assert.equal(r.latest.b_to_a.id, "bo-2", "bo-2 and bo-3 share an instant: the lower id is the index's first");
  for (const side of [r.latest.a_to_b, r.latest.b_to_a]) assert.deepEqual(Object.keys(side), ["id", "date", "delivered_at", "href", "line"]);
  assert.match(r.latest.a_to_b.href, /\/letters\/ada-3$/);
  assert.equal(r.as_of, "head-sha-1");
  // the other side's view mirrors it
  const mirror = await pairRead({ a: "bo", b: "ada" }, { ix: ix({ letters: LETTERS }) });
  assert.deepEqual(mirror.letters, { a_to_b: 3, b_to_a: 3 });
  assert.equal(mirror.latest.a_to_b.id, "bo-2");
  // a pair that never wrote: null first and no latest, honestly
  const none = await pairRead({ a: "bo", b: "cy" }, { ix: ix({ letters: [] }) });
  assert.equal(none.first, null);
  assert.deepEqual(none.letters, { a_to_b: 0, b_to_a: 0 });
  assert.deepEqual(none.latest, { a_to_b: null, b_to_a: null });
});

test("2 · THE QUOTE IS THE LITERAL FIRST LINE, never letterExcerpt's paragraph: on a headed, greeted letter the two differ", async () => {
  const r = await pairRead({ a: "ada", b: "bo" }, { ix: ix({ letters: LETTERS }) });
  assert.equal(r.latest.a_to_b.line, "# A note on the weather", "the first line, as written: a heading stays a heading");
  assert.notEqual(r.latest.a_to_b.line, letterExcerpt(HEADED), "the excerpt picks the substantive paragraph, the quote does not");
  assert.match(letterExcerpt(HEADED), /rained on the quay/);
  assert.equal(firstLine("\n\n  Hello there  \nnext"), "Hello there", "blank lines before the first line are not the first line");
  assert.equal(firstLine(""), "");
  // a letter with no body on record has an empty line, not a made-up one
  const r2 = await pairRead({ a: "ada", b: "cy" }, { ix: ix({ letters: LETTERS }) });
  assert.equal(r2.latest.a_to_b.id, "ada-3");
  // a long first line is cut and says so
  body("long-1", "x".repeat(QUOTE_MAX + 50));
  const r3 = await pairRead({ a: "ada", b: "bo" }, { ix: ix({ letters: [letter("long-1", "ada", "bo", "2026-11-01", "2026-11-01T01:00:00.000Z")] }) });
  assert.equal(r3.latest.a_to_b.line.length, QUOTE_MAX);
  assert.equal(r3.latest.a_to_b.line_cut, true);
});

test("1 · milestones are the quest board's own rows for the pair, either side, once each, oldest first; a board that cannot be read is said", async () => {
  const boards = {
    ada: { quests: [{ earned_with: [{ with: "bo", threshold: 3, date: "2026-10-08" }, { with: "cy", threshold: 1, date: "2026-10-04" }] }] },
    bo: { quests: [{ earned_with: [{ with: "ada", threshold: 3, date: "2026-10-08" }, { with: "ada", threshold: 1, date: "2026-10-03" }] }] },
  };
  const r = await pairRead({ a: "ada", b: "bo" }, { ix: ix({ letters: LETTERS, boards }) });
  assert.deepEqual(r.milestones, [{ threshold: 1, date: "2026-10-03", by: "bo" }, { threshold: 3, date: "2026-10-08", by: "ada" }, { threshold: 3, date: "2026-10-08", by: "bo" }]);
  assert.equal(r.milestones_unavailable, undefined);
  const blind = await pairRead({ a: "ada", b: "bo" }, { ix: ix({ letters: LETTERS, boards, fail: { bo: true } }) });
  assert.match(blind.milestones_unavailable, /unknown, not none/);
  assert.deepEqual(pairMilestones(new Map(), "a", "b"), []);
});

test("3 · an unknown resident is 404, the same resident twice 422, a missing side 422", async () => {
  const i = ix({ letters: LETTERS });
  assert.deepEqual([(await pairRead({ a: "ada", b: "nobody" }, { ix: i })).code, (await pairRead({ a: "nobody", b: "ada" }, { ix: i })).code], [404, 404]);
  assert.equal((await pairRead({ a: "ada", b: "ada" }, { ix: i })).code, 422);
  assert.equal((await pairRead({ a: "ada" }, { ix: i })).code, 422);
  assert.equal((await pairRead({}, { ix: i })).error, "bounce");
});

test("4 · recipients: a toList names them all; a \"x, y\" column is split; the newest-first order is the public index's", () => {
  assert.deepEqual(recipientsOf({ to_h: "a", multi: JSON.stringify({ toList: ["b", "c"] }) }), ["b", "c"]);
  assert.deepEqual(recipientsOf({ to_h: "b, c", multi: null }), ["b", "c"]);
  assert.deepEqual(recipientsOf({ to_h: "b", multi: "not json" }), ["b"]);
  const rows = [letter("b", "x", "y", "2026-01-01", "2026-01-02T00:00:00.000Z"), letter("a", "x", "y", "2026-01-01", "2026-01-02T00:00:00.000Z"), letter("c", "x", "y", "2026-01-03", null)];
  assert.deepEqual(rows.slice().sort(newestFirst).map((r) => r.id), ["c", "a", "b"], "a bare date is that day's midnight; ties on id ascending");
});
