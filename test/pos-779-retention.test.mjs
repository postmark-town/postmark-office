// pos-779-retention.test.mjs — the in-memory voice list is bounded for the PUBLIC separately from rooms (POS-779, source-review P2).
//
// The office keeps the newest `memoryMax` voices in RAM (2,000). It used to trim ONE list across every room, so a flood spoken
// inside a room could push public speech out of memory, and the cut it left rode every public reply's `hearing_disclosed`:
// private speech moved a public reader's record. The memory now caps the open voices and the room voices on their own.
//
// The controls here are the invented-data ones the brief names: the same public log alone, and with MORE than `memoryMax`
// private voices BEFORE it, INTERLEAVED with it and AFTER it; the public reply, the retained public first/last/count and the
// cut metadata must be unchanged. The mutant that restores the single global trim is run against exactly this file (the commit
// message of the flip records the result).
//
//   node --test test/pos-779-retention.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

process.env.WORLD_CLONE = join(tmpdir(), "postmark-no-world-clone-xyz");
const { createVoices } = await import("../src/voices.mjs");

const DIR = mkdtempSync(join(tmpdir(), "postmark-retention-"));
const T0 = Date.UTC(2026, 7, 8, 18, 0, 0);
const SEC = 1000;
const MEMORY = 8; // a small memory so the invented floods are small

let n = 0;
/** A store over its own log, a hand-driven clock, an open spot (0,0) and a cellar room at the same spot. */
function room() {
  const clock = { t: T0 };
  const store = createVoices({
    standpoint: async (h) => ({ handle: h, placed: true, x: 0, y: 0, aboard: false, moving: false }),
    roomOf: (h) => (h.startsWith("p") ? "cellar" : null),
    place: async () => "the cellar door",
    logPath: join(DIR, `voices-${++n}.jsonl`),
    now: () => clock.t,
    hearingWindow: () => ({ since: T0 - 3_600_000, source: "the test's settlement", disclosure: null }),
    settlements: () => [T0 - 3_600_000],
    memoryMax: MEMORY,
    speakEveryMs: 0,
  });
  const tick = (ms) => { clock.t += ms; };
  const publicSay = async (i) => { await store.say(`open${i}`, `public line ${i}`); tick(20 * SEC); };
  const privateSay = async (i) => { await store.say(`p${i}`, `private line ${i}`); tick(20 * SEC); };
  return { store, publicSay, privateSay, tick };
}

/** What a public reader and the public page see, with the retained public voices' first/last/count. */
async function publicView(store) {
  const heard = await store.hear("reader");
  const retained = store._voices().filter((v) => !v.room);
  const c = store.conversations();
  return {
    voices: heard.voices.map((v) => v.said),
    older: heard.older ?? null,
    latest: heard.latest ?? null,
    hearable_since: heard.hearable_since,
    hearing_disclosed: heard.hearing_disclosed ?? null,
    retained: { count: retained.length, first: retained[0]?.text ?? null, last: retained.at(-1)?.text ?? null },
    page: c.live.map((t) => ({ count: t.voice_count, said: t.voices.map((v) => v.said) })),
  };
}

const PUBLIC = 6; // fewer than the memory: the public log alone never touches the cap
const FLOOD = 3 * MEMORY; // more than the memory, in rooms

test("CONTROL: the public log alone keeps every line and says nothing about a cut", async () => {
  const { store, publicSay } = room();
  for (let i = 0; i < PUBLIC; i++) await publicSay(i);
  const v = await publicView(store);
  assert.deepEqual(v.retained, { count: PUBLIC, first: "public line 0", last: `public line ${PUBLIC - 1}` });
  assert.equal(v.hearing_disclosed, null);
  assert.equal(v.voices.length, PUBLIC);
});

for (const where of ["before", "interleaved with", "after"]) {
  test(`more than memoryMax private voices ${where} the public log leave the public reply, retained first/last/count and cut metadata unchanged`, async () => {
    const alone = room();
    for (let i = 0; i < PUBLIC; i++) await alone.publicSay(i);
    const want = await publicView(alone.store);

    const mixed = room();
    let p = 0;
    if (where === "before") for (; p < FLOOD; p++) await mixed.privateSay(p);
    for (let i = 0; i < PUBLIC; i++) {
      await mixed.publicSay(i);
      if (where === "interleaved with") for (let k = 0; k < FLOOD / PUBLIC; k++) await mixed.privateSay(p++);
    }
    if (where === "after") for (; p < FLOOD; p++) await mixed.privateSay(p);
    assert.ok(p >= FLOOD && p > MEMORY, "premise: more private voices than the memory holds");
    assert.ok(mixed.store._voices().some((v) => v.room), "premise: the room voices are really in the list");

    const got = await publicView(mixed.store);
    assert.deepEqual(got.retained, want.retained, "the retained public voices: count, first, last");
    assert.deepEqual(got.voices, want.voices, "the public reader's voices");
    assert.equal(got.hearing_disclosed, want.hearing_disclosed, "no cut is told on the public reader's reply");
    assert.deepEqual(got.page, want.page, "the public page");
    assert.equal(got.older, want.older);
    assert.equal(got.hearable_since, want.hearable_since);
  });
}

test("public-only overflow still cuts, and the scoped truncation says so truthfully", async () => {
  const { store, publicSay } = room();
  for (let i = 0; i < MEMORY + 4; i++) await publicSay(i);
  const v = await publicView(store);
  assert.deepEqual(v.retained, { count: MEMORY, first: "public line 4", last: `public line ${MEMORY + 3}` });
  assert.match(v.hearing_disclosed, new RegExp(`keeps at most ${MEMORY} voices in memory`));
  assert.doesNotMatch(v.hearing_disclosed, /rooms/, "a public reader is not told about rooms");
});

test("the whole memory is bounded: at most 2 x memoryMax entries however much is said, in rooms or out", async () => {
  const { store, publicSay, privateSay } = room();
  for (let i = 0; i < 3 * MEMORY; i++) { await publicSay(i); await privateSay(i); }
  const kept = store._voices();
  assert.equal(kept.filter((v) => !v.room).length, MEMORY);
  assert.equal(kept.filter((v) => v.room).length, MEMORY);
  assert.ok(kept.length <= 2 * MEMORY);
  assert.deepEqual(kept.map((v) => v.at), [...kept.map((v) => v.at)].sort((a, b) => a - b), "the list stays in the order it was spoken");
});

test("a reader standing in a room is told the room list's cut too; a public reader never is", async () => {
  const { store, privateSay } = room();
  for (let i = 0; i < MEMORY + 3; i++) await privateSay(i);
  const inside = await store.hear("p0");
  assert.match(inside.hearing_disclosed, /for the open and as many for rooms/);
  const outside = await store.hear("reader");
  assert.equal(outside.hearing_disclosed ?? null, null);
});
