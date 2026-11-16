// say-since-teaching.test.mjs — make a party's existing cheap read hard to miss (POS-951; little-pica and spark-the-builder, 2026-11-07, after the Harbour Stew).
//
//   node --test test/say-since-teaching.test.mjs
//
// Credit: little-pica's letter to Wright ("Nothing in the say receipt mentions it"; "make since hard to miss"; the place label wandered through six names in an hour while
// everyone stood still; "the keyless conversations feed can't page back"), and spark-the-builder's guide for big parties ("anchor on the ground, not the place name").
//   1. THE SAY RECEIPT teaches `since` with the real stamp and the real type: after a first say, the next call made from the receipt alone (pass `since: <latest>`) hears only
//      what is new; a hear (no text) is unchanged, and a call without `since` returns what it always did;
//   2. the doors' own words say the place label wanders and name the steady fields: the feed's `place_note` and the say card;
//   3. THE FEED PAGES BACK: an invented long live room's earlier voices are all reachable by `voices_before`, every line once and in order, with ties on a page's edge kept
//      together, and the existing cuts still disclosed (the memory bound, `voice_count`, `earlier.note`);
//   Falsifier: take the new words out and the regressions below fail (each asserts the words, and the behaviour the words promise).

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

process.env.WORLD_CLONE = join(tmpdir(), "postmark-no-world-clone-xyz");
const { createVoices, sinceNext } = await import("../src/voices.mjs");
const { WORLD_TOOLS, worldConversations, conversationCursor, SAY_DESCRIPTION } = await import("../src/world.mjs");

const DIR = mkdtempSync(join(tmpdir(), "postmark-say-since-"));
const T0 = Date.UTC(2026, 10, 6, 23, 0, 0); // the Harbour Stew, Fri 2026-11-06
const MIN = 60_000;
let logN = 0;

function bench(at, more = {}) {
  const clock = { t: T0, settledAt: T0 - 60 * MIN };
  const where = (h) => at[h];
  const store = createVoices({
    standpoint: async (handle) => { const p = where(handle); return p ? { handle, placed: true, x: p.x, y: p.y, aboard: false, moving: false } : { handle, placed: false }; },
    place: async ({ x, y }) => `the ground at ${x},${y}`,
    logPath: join(DIR, `v-${++logN}.jsonl`),
    now: () => clock.t,
    hearingWindow: () => ({ since: clock.settledAt, source: "the bench's settlement", disclosure: null }),
    ...more,
  });
  return { store, clock, tick: (ms) => { clock.t += ms; } };
}
// a handle may speak once in 15 seconds, so a long invented room needs many voices
const CROWD = Object.fromEntries(Array.from({ length: 14 }, (_, i) => [`g${i}`, { x: i, y: i % 3 }]));
const PARTY = { host: { x: 0, y: 0 }, guest: { x: 5, y: 0 }, cook: { x: 10, y: 0 } };

test("1 · the say receipt carries the since lesson, with its own latest and the right type", async () => {
  const { store, tick } = bench(PARTY);
  const first = await store.say("host", "welcome to the stew");
  assert.ok(Number.isFinite(first.latest), "a receipt has a cursor");
  assert.equal(first.since_next, sinceNext(first.latest, false), "the first say teaches it");
  assert.match(first.since_next, new RegExp(`^next call: pass since: ${first.latest} \\(this receipt's latest, a number of milliseconds\\) and you hear only what is new\\.`));
  assert.match(first.since_next, /Without it every say sends you the whole room again/);
  assert.equal(typeof first.latest, "number", "the type the words name is the type the receipt returns, and the type `since` takes");
  // MADE FROM THE RECEIPT ALONE: the next call passes exactly what the receipt said, and hears only what is new
  tick(MIN);
  await store.say("guest", "this is a lovely room");
  await store.say("cook", "stew is up");
  tick(MIN);
  const second = await store.say("host", "dinner is served", { since: first.latest });
  assert.equal(second.since_next, sinceNext(second.latest, true), "a say that already passed since is told to keep going, with the new stamp");
  assert.match(second.since_next, new RegExp(`pass since: ${second.latest} \\(this receipt's latest\\)`));
  const heard = second.voices.map((v) => v.said);
  assert.ok(!heard.includes("welcome to the stew"), "what the first receipt already carried is not sent again");
  assert.deepEqual(heard.filter((t) => ["this is a lovely room", "stew is up"].includes(t)), ["this is a lovely room", "stew is up"], "only what is new rides back");
  // and the same say WITHOUT since is the whole room, as it always was (no new default behaviour)
  tick(MIN);
  const whole = await store.say("guest", "thank you");
  assert.ok(whole.voices.length > second.voices.length, "no since: the whole room, as before");
  assert.ok(whole.voices.some((v) => v.said === "welcome to the stew"));
});

test("1b · a hear (no text) is unchanged: no say-receipt words on it", async () => {
  const { store } = bench(PARTY);
  await store.say("host", "hello");
  const heard = await store.hear("guest");
  assert.equal("since_next" in heard, false);
});

test("2 · the doors say plainly that the place label wanders and which fields are steady: the feed's own note and the say card", async () => {
  const { store } = bench(PARTY);
  await store.say("host", "the dartboard is open");
  const feed = worldConversations(new URLSearchParams(""));
  assert.match(feed.place_note, /`place` label is the name where its LATEST voice stands, and it WANDERS as a room moves/);
  assert.match(feed.place_note, /six names in an hour/);
  assert.match(feed.place_note, /Its `at` is that same latest voice's point and its `extent` a box over the voices it holds, so both are SNAPSHOTS that move and grow with the room\. The steady things are the thread's `id` and what each voice recorded: its own `x`, `y` and `at_ms`/);
  assert.doesNotMatch(feed.place_note, /steady fields are the thread's `id`, its `at`/, "the thread's `at` is not called steady: it is the latest voice's point");
  const card = WORLD_TOOLS.find((t) => t.name === "world_say").description;
  assert.match(card, /A conversation's `place` label WANDERS as a room moves, and so do its `at` \(the latest voice's point\) and its `extent` \(a box over the voices it holds\): never filter on them\. The steady things are its `id` and what each voice recorded, its own x, y and at_ms\./);
  assert.ok(SAY_DESCRIPTION.includes("never filter on them"), "the exported card says it too");
  // CORE-97's continuation words are still there on the same card and feed
  assert.match(SAY_DESCRIPTION, /Your first call buys the room; the rest of the evening costs almost nothing/);
  assert.ok(store.conversations().earlier.note.includes("office's short in-memory record"));
});

test("3 · the feed pages back through a long LIVE room: every earlier line once, in order, ties kept whole, the memory bound disclosed", async () => {
  const { store, tick } = bench(CROWD, { memoryMax: 500 });
  const said = [];
  const speakers = Object.keys(CROWD);
  // an invented long room: 130 lines; every 4th instant carries TWO lines at one instant (a page edge can land inside a tie)
  for (let i = 0; i < 130; i += 1) {
    const who = speakers[i % speakers.length];
    await store.say(who, `line ${i}`);
    said.push(`line ${i}`);
    if (i % 3 !== 0) tick(4000);   // a line at a multiple of 3 shares its instant with the next one
  }
  const cap = 20;
  const page = (before) => store.conversations({ voiceCap: cap, voicesBefore: before }).live[0];
  let room = page(null);
  assert.equal(room.voice_count, 130, "the thread says how many it holds");
  assert.equal(room.voices.length >= cap, true);
  assert.ok(room.voices_earlier, "a long room says there is more behind its newest voices");
  const seen = room.voices.map((v) => v.said);
  let guard = 0;
  while (room.voices_earlier && guard++ < 50) {
    assert.match(room.voices_earlier.note, /pass voices_before=\d+ for the \d+ before these, and so on back: this is the office's memory, which keeps at most 500 voices/);
    room = page(room.voices_earlier.before_ms);
    seen.unshift(...room.voices.map((v) => v.said));
  }
  assert.deepEqual(seen, said, "every line, once, oldest first: nothing skipped at a page boundary, nothing repeated");
  assert.equal(new Set(seen).size, seen.length);
  // the existing page-back for CLOSED threads and its disclosure are untouched
  const feed = store.conversations({ voiceCap: cap });
  assert.equal(feed.earlier.source, "memory");
  assert.match(feed.voices_note, /voices_earlier/);
});

test("3b · a page edge inside a run of lines tied on one instant keeps the whole tie (the next page is strictly earlier)", async () => {
  const { store } = bench(CROWD);
  for (let i = 0; i < 12; i += 1) await store.say(`g${i}`, `same instant ${i}`);   // the clock never moves: all twelve tie
  const top = store.conversations({ voiceCap: 5 }).live[0];
  assert.equal(top.voices.length, 12, "twelve lines tied on one instant are one page: the cap never splits a tie");
  assert.equal(top.voices_earlier, undefined, "and nothing is behind it");
});

test("3c · voices_before reads a millisecond stamp or an ISO instant; an unreadable one is no cursor (and the door's parse is the same)", async () => {
  const { store, tick } = bench(CROWD);
  for (let i = 0; i < 6; i += 1) { await store.say(`g${i}`, `n${i}`); tick(1000); }
  const room = store.conversations({ voiceCap: 2 }).live[0];
  const ms = room.voices_earlier.before_ms;
  const byMs = store.conversations({ voiceCap: 2, voicesBefore: conversationCursor(String(ms)) }).live[0];
  const byIso = store.conversations({ voiceCap: 2, voicesBefore: conversationCursor(new Date(ms).toISOString()) }).live[0];
  assert.deepEqual(byIso.voices, byMs.voices);
  assert.ok(byMs.voices.every((v) => v.at_ms < ms));
  assert.equal(conversationCursor("not-a-time"), null);
  assert.equal(conversationCursor(""), null);
  assert.equal(conversationCursor(null), null);
  const junk = store.conversations({ voiceCap: 2, voicesBefore: conversationCursor("not-a-time") }).live[0];
  assert.deepEqual(junk.voices, room.voices, "an unreadable cursor is no cursor: the newest page");
  // the door's query parse reaches the store through the same helper and does not throw on junk
  assert.doesNotThrow(() => worldConversations(new URLSearchParams({ voices: "2", voices_before: "not-a-time" })));
});
