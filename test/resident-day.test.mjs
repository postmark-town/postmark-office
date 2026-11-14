// resident-day.test.mjs — `household { read: "day", args: { handle, date } }`: one resident's UTC day, in sentences written by rule (POS-1027).
//
//   node --test test/resident-day.test.mjs
//
//   1. the sentences and counts are deterministic from the public record, in a fixed order, and never repeat what a resident wrote (a say is the fact of it);
//   2. QUIET IS NOT UNAVAILABLE: a day every source was read for and found nothing on says so in one explicit sentence (`quiet: true`); a source that could not be
//      read is NAMED, no quiet sentence is said and `quiet` is null, so a missing input can never read as a calm day; a ledger window too long to read whole is
//      unavailable too;
//   3. only the public verbs count (a private act the store handed back is not counted), a letter that never arrived is not "wrote", and the day's own bounds hold;
//   4. a future date, a bad date and an unknown resident are refused by name; the default date is today, UTC.

import test from "node:test";
import assert from "node:assert/strict";
import { dayRead, daySentences, validDay, utcDate, nameList } from "../src/resident-day.mjs";
import { PUBLIC_HOUSE_VERBS } from "../src/hearth-public.mjs";

const NOW = Date.parse("2026-11-13T15:30:00Z");

function ix({ residents = ["ada"], sent = [], received = [], acts = [], lines = [], fail = {}, cutActs = false, cutLines = false } = {}) {
  const asked = { acts: [], lines: [] };
  return {
    asked,
    hasResident: async (h) => residents.includes(h),
    asOf: async () => "head-1",
    lettersOfDay: async () => { if (fail.letters) throw new Error("letters down"); return { sent, received }; },
    actsOfActor: async (actor, opts) => { asked.acts.push([actor, opts]); if (fail.acts) throw new Error("acts down"); return { rows: acts, cut: cutActs }; },
    stampLinesSince: async (since, opts) => { asked.lines.push([since, opts]); if (fail.stamps) throw new Error("ledger down"); return { rows: lines, cut: cutLines }; },
  };
}
const line = (date, giver, target, n, note = "") => ({ canonical: `- ${date} · ${giver} → ${target} · ${n}${note ? ` · ${note}` : ""}`, written_at: `${date}T10:00:00Z` });

test("1 · a busy day: letters, public acts and stamps become plain sentences in a fixed order, with counts, and never a resident's words", async () => {
  const r = await dayRead({ handle: "ada", date: "2026-11-12" }, { nowMs: NOW, ix: ix({
    sent: [{ id: "l1", to_h: "limen", delivered_at: "2026-11-12T20:00:00Z" }, { id: "l2", to_h: "neth", delivered_at: "2026-11-12T20:00:00Z" },
      { id: "l3", to_h: "lupi, neth", multi: JSON.stringify({ toList: ["lupi", "neth"] }), delivered_at: "2026-11-13T00:00:00Z" },
      { id: "undelivered", to_h: "zed", delivered_at: null }],
    received: [{ id: "r1", from_h: "bo" }],
    acts: [{ action: "say", class: "voice", object: "the-town/porch" }, { action: "say", class: "voice", object: "the-town/porch" }, { action: "walk", class: "move", object: "the-town/quay" },
      { action: "enter", class: "move", object: "the-town/quay" }, { action: "leave-mark", class: "mark", object: "ada/lamp", put_forward: "true" }, { action: "post", class: "idea", object: "ada/an-idea" },
      { action: "stake", class: "mark", object: "x/y" }, { action: "rsvp", class: "event", object: "e/1" }],
    lines: [line("2026-11-12", "ada", "stake:world-mark/x/y", 5, "via: web"), line("2026-11-12", "ada", "stake:vote/topic", 2), line("2026-11-12", "ada", "bo", 3, "for: gift"),
      line("2026-11-11", "ada", "stake:pot/lamp", 9), line("2026-11-12", "bo", "stake:world-mark/z/z", 7)],
  }) });
  assert.equal(r.read, "day");
  assert.deepEqual([r.handle, r.date, r.quiet], ["ada", "2026-11-12", false]);
  assert.deepEqual(r.sentences, [
    "wrote 3 letters, to limen, lupi and neth",
    "had 1 letter arrive, from bo",
    "spoke 2 times",
    "walked 1 time",
    "went in the-town/quay",
    "left 1 mark",
    "backed 1 mark with stamps",
    "put up a idea",
    "took part in 1 post (1 act)",
    "put 5 stamps behind 1 mark",
    "put 2 stamps behind 1 ballot",
    "gave 3 stamps to bo",
  ]);
  assert.equal(r.counts.letters_sent, 3);
  assert.equal(r.counts.said, 2);
  assert.equal(r.counts.stamps_on_marks, 5);
  assert.equal(r.counts.stamps_on_ballots, 2);
  assert.equal(r.counts.stamps_given, 3);
  assert.equal(r.unavailable, undefined);
  assert.ok(!JSON.stringify(r).includes("undelivered") && !JSON.stringify(r).includes("zed"), "a letter that never arrived is not 'wrote'");
  // the same record gives the same words
  const again = await dayRead({ handle: "ada", date: "2026-11-12" }, { nowMs: NOW + 99_999, ix: ix({ sent: [{ id: "l1", to_h: "limen", delivered_at: "x" }] }) });
  const twice = await dayRead({ handle: "ada", date: "2026-11-12" }, { nowMs: NOW, ix: ix({ sent: [{ id: "l1", to_h: "limen", delivered_at: "x" }] }) });
  assert.deepEqual(again, twice);
});

test("1b · a draft is not the day: an unpublished withdrawal and an unstaked leave or amend are not counted, published ones and other classes' amends are", async () => {
  const mark = (action, extra = {}) => ({ action, class: "mark", object: "ada/lamp", ...extra });
  const r = await dayRead({ handle: "ada", date: "2026-11-12" }, { nowMs: NOW, ix: ix({ acts: [
    mark("withdraw", { was_published: "false" }), mark("withdraw"), mark("withdraw", { was_published: "true" }),
    mark("leave-mark", { put_forward: "false" }), mark("leave-mark"), mark("leave-mark", { put_forward: "true" }), mark("amend"), mark("amend", { put_forward: "true" }),
    { action: "amend", class: "idea", object: "ada/an-idea" },
  ] }) });
  assert.equal(r.counts.marks_withdrawn, 1, "only the published withdrawal");
  assert.ok(r.sentences.includes("withdrew 1 mark"));
  assert.equal(r.counts.marks_left, 1, "only the put-forward leave-mark");
});

test("1c · AN ACTIVE DAY IS NEVER CALLED QUIET: a public act the rules do not word (exit, take, give, drop, a put-forward mark amend) and a stamp kind they do not word are counted and said; an unstake is not backing", async () => {
  const day = (opts) => dayRead({ handle: "ada", date: "2026-11-12" }, { nowMs: NOW, ix: ix(opts) });
  const exitOnly = await day({ acts: [{ action: "exit", class: "movement", object: "the-town/quay" }] });
  assert.equal(exitOnly.quiet, false, "one public act, every source read: not quiet");
  assert.deepEqual(exitOnly.sentences, ["did 1 other public thing (exit ×1)"]);
  assert.equal(exitOnly.counts.other_acts, 1);
  const many = await day({ acts: [{ action: "take", class: "item", object: "a/b" }, { action: "take", class: "item", object: "a/c" }, { action: "give", class: "item", object: "a/d" }, { action: "drop", class: "item", object: "a/e" },
    { action: "amend", class: "mark", object: "ada/lamp", put_forward: "true" }] });
  assert.equal(many.quiet, false);
  assert.deepEqual(many.sentences, ["did 5 other public things (amend ×1, drop ×1, give ×1, take ×2)"]);
  const un = await day({ acts: [{ action: "unstake", class: "mark", object: "x/y" }] });
  assert.equal(un.quiet, false);
  assert.deepEqual(un.sentences, ["took stamps back from 1 stake"]);
  assert.ok(!un.sentences.some((t) => /backed/.test(t)), "taking stamps back is not backing a mark");
  assert.equal(un.counts.marks_backed, 0);
  assert.equal(un.counts.marks_unstaked, 1);
  // a ledger line of a kind with no sentence of its own is still the day's
  const burn = await day({ lines: [line("2026-11-12", "ada", "burn:the-fire", 4)] });
  assert.equal(burn.quiet, false, JSON.stringify(burn));
  assert.ok(burn.sentences.length >= 1 && !/quiet day/.test(burn.sentences[0]));
  // and the day with nothing in any source stays quiet
  assert.equal((await day({})).quiet, true);
});

test("2 · QUIET IS NOT UNAVAILABLE: a day read whole and found empty says so; any source that cannot be read is named and no quiet sentence is said", async () => {
  const quiet = await dayRead({ handle: "ada", date: "2026-11-12" }, { nowMs: NOW, ix: ix() });
  assert.equal(quiet.quiet, true);
  assert.deepEqual(quiet.sentences, ["A quiet day: nothing public was recorded for ada on 2026-11-12."]);
  assert.equal(quiet.unavailable, undefined);
  for (const [source, opts] of [["letters", { fail: { letters: true } }], ["acts", { fail: { acts: true } }], ["stamps", { fail: { stamps: true } }], ["acts", { cutActs: true }], ["stamps", { cutLines: true }]]) {
    const blind = await dayRead({ handle: "ada", date: "2026-11-12" }, { nowMs: NOW, ix: ix(opts) });
    assert.equal(blind.quiet, null, `${source}: unknown, not quiet`);
    assert.ok(blind.unavailable.some((u) => u.startsWith(source)), `${source} is named`);
    assert.ok(!blind.sentences.some((s) => /quiet day/.test(s)), `${source}: no quiet sentence`);
    assert.match(blind.unavailable_note, /not a quiet day/);
  }
  // an unavailable source leaves out ITS sentences only: the others still read
  const partial = await dayRead({ handle: "ada", date: "2026-11-12" }, { nowMs: NOW, ix: ix({ fail: { acts: true }, sent: [{ id: "l", to_h: "limen", delivered_at: "x" }] }) });
  assert.deepEqual(partial.sentences, ["wrote 1 letter, to limen"]);
  assert.equal(partial.quiet, null);
});

test("3 · the day's own bounds and the public verbs: the acts are asked of the one actor, inside [00:00, 24:00) UTC, for the public verbs only", async () => {
  const i = ix({ acts: [{ action: "say", class: "voice", object: null }] });
  await dayRead({ handle: "ada", date: "2026-11-12" }, { nowMs: NOW, ix: i });
  const [[actor, opts]] = i.asked.acts;
  assert.equal(actor, "ada");
  assert.equal(opts.fromIso, "2026-11-12T00:00:00.000Z");
  assert.equal(opts.toIso, "2026-11-13T00:00:00.000Z");
  assert.deepEqual(opts.verbs, [...PUBLIC_HOUSE_VERBS]);
  for (const private_ of ["note-to-self", "award", "recredit", "answer-sign-up", "units:make", "adopt"]) assert.ok(!opts.verbs.includes(private_), `${private_} is not a public verb`);
  // the ledger is read from the day's start, and only that day's lines by the giver count
  assert.equal(i.asked.lines[0][0], "2026-11-12T00:00:00.000Z");
});

test("4 · a future date, a bad date and an unknown resident are refused by name; the default is today, UTC", async () => {
  const i = ix();
  const future = await dayRead({ handle: "ada", date: "2026-11-14" }, { nowMs: NOW, ix: i });
  assert.deepEqual([future.error, future.code], ["bounce", 422]);
  assert.match(future.defect, /has not come yet/);
  assert.equal((await dayRead({ handle: "ada", date: "2026-02-30" }, { nowMs: NOW, ix: i })).code, 422);
  assert.equal((await dayRead({ handle: "ada", date: "yesterday" }, { nowMs: NOW, ix: i })).code, 422);
  assert.equal((await dayRead({ handle: "nobody", date: "2026-11-12" }, { nowMs: NOW, ix: i })).code, 404);
  assert.equal((await dayRead({ date: "2026-11-12" }, { nowMs: NOW, ix: i })).code, 422);
  assert.equal((await dayRead({ handle: "ada" }, { nowMs: NOW, ix: i })).date, "2026-11-13", "today, UTC");
  assert.equal(utcDate(Date.parse("2026-11-13T23:59:59Z")), "2026-11-13");
  assert.equal(validDay("2026-11-13"), true);
  assert.equal(validDay("2026-13-01"), false);
  assert.equal(nameList(["c", "a", "b"]), "a, b and c");
  assert.equal(nameList(["a"]), "a");
  assert.equal(nameList("abcdefgh".split("")), "a, b, c, d, e and 3 more");
  assert.deepEqual(daySentences({ letters: { read: false }, received: { read: false } }), { sentences: [], counts: {} });
});
