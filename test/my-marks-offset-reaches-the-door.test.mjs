// my-marks-offset-reaches-the-door.test.mjs — the REST door carries the page
// its own twin has always carried (2026-09-10).
//
// THE DEFECT. `server.mjs` called `worldMyMarks(key)` with no second argument,
// while the function has taken `{ offset }` since it was paged and the MCP twin
// `world_my_marks` has always passed `args.offset`. So the REST door answered
// page ZERO to every request: `complete` stayed false forever and a caller
// walking the offset re-collected the same twenty rows. The world viewer did
// exactly that, twelve times, before this was found.
//
// It is a TWIN-PARITY defect, not a new field. Nothing is invented here: same
// lists, same page bound, same counts. Without it Keemin's "plus all of yours"
// cannot hold over HTTP — this household owns 91 published marks and the door
// could only ever show the first twenty.
//
// THE TWIN IS THE ORACLE. The assertion is not "offset does something" — that
// would pass against a door that shuffled rows. It is that the REST door's page
// at an offset is the SAME page the MCP twin returns at that offset, which is
// the parity the defect broke.
//
//   node --test test/my-marks-offset-reaches-the-door.test.mjs

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { WORLD_CLONE, worldMyMarks } from "../src/world.mjs";
import { installActsPen, uninstallActsPen, RECORD_ON } from "./acts-pen-stub.mjs";
import { rowsFromRegistry } from "../src/registry-rows.mjs";

const TOWN_CLONE = process.env.TOWN_CLONE ?? join(WORLD_CLONE, "..", "town-clone");
const HAVE = existsSync(join(WORLD_CLONE, "WORLD", "world-state.json"))
  && existsSync(join(TOWN_CLONE, "tools", "stamp-mint.mjs"))
  && existsSync(join(TOWN_CLONE, "tools", "households.json"));
const WHY_NOT = `needs a world clone at ${WORLD_CLONE} and a town clone at ${TOWN_CLONE}`;

// THE PAGE'S RESIDENTS ARE THE STORE'S HOUSEHOLD (POS-545). This file reads the
// real clones, so the record is seeded from the town clone's own printout of it
// (tools/households.json and tools/github-ids.json, which tools/registry-drain.mjs
// prints from the store). At the pins of 2026-10-10 the two rosters are the
// same six authors (104 marks), so this file asks the same question it always did.
if (HAVE) {
  const readJson = (p) => JSON.parse(readFileSync(join(TOWN_CLONE, "tools", p), "utf8"));
  const rows = rowsFromRegistry(readJson("households.json"), existsSync(join(TOWN_CLONE, "tools", "github-ids.json")) ? readJson("github-ids.json") : {});
  process.env.WORLD2_PG = RECORD_ON.WORLD2_PG;
  process.env.WORLD2_PG_URL = RECORD_ON.WORLD2_PG_URL;
  installActsPen({ households: rows.households, pins: rows.pins, meta: [] });
  after(() => { uninstallActsPen(); delete process.env.WORLD2_PG; delete process.env.WORLD2_PG_URL; });
}
const KEY = () => ({ handles: new Set(["wright"]), household: "keeminlee" });

const SERVER = readFileSync(
  join(fileURLToPath(new URL(".", import.meta.url)), "..", "src", "server.mjs"), "utf8");

test("the ROUTE reads an offset and hands it on — the source guard", () => {
  // Cheap and brittle on purpose, and it is the one that runs where no clone
  // exists. The behavioural tests below are the real ones.
  const call = SERVER.match(/return worldMyMarks\(key([^)]*)\)/);
  assert.ok(call, "the route calls worldMyMarks");
  assert.match(call[1], /offset/,
    "the route passes an offset — dropping it is the defect this file exists for");
  assert.match(SERVER, /searchParams\.get\("offset"\)/,
    "and it reads that offset from the query string");
});

test("FALSIFIER — offset 20 is a DIFFERENT page from offset 0", async (t) => {
  if (!HAVE) return t.skip(WHY_NOT);
  const first = await worldMyMarks(KEY(), { offset: 0 });
  const second = await worldMyMarks(KEY(), { offset: 20 });
  assert.ok(!first?.error && !second?.error, "the door answered both");
  const a = first.published.map((r) => r.id);
  const b = second.published.map((r) => r.id);
  assert.ok(a.length && b.length, "both pages have rows — otherwise this proves nothing");
  assert.notDeepEqual(a, b, "offset 20 returned the same rows as offset 0 — the page never moved");
  // and they are DISJOINT: a page is a window, not a reshuffle
  const overlap = a.filter((id) => b.includes(id));
  assert.deepEqual(overlap, [], `pages 0 and 20 share ${overlap.length} rows`);
  // ANTI-VACUITY: this household must actually own more than one page, or the
  // whole file is green against a door that ignores the offset entirely.
  assert.ok((first.counts?.published ?? 0) > 20,
    `this household owns ${first.counts?.published} published marks — needs >20 to test paging at all`);
});

/**
 * THE WALK (POS-896). Until this change the loop was `for (offset = 0; offset < 200; offset += 20)`: a blind cap of ten
 * pages that was the household's size at the pin it was written on (104, then 200), and that reds when the household's
 * published marks grow past it, although the door is right. The walk now advances by what the door SHOWED and ends where the
 * DOOR ENDS, not where its count says: the terminal observation is a page that adds no id not already seen (this door clamps
 * an offset past the end to the last row, markPage in src/world.mjs, so the probe past the tail answers that one seen row).
 * `counts.published` is the PROMISE the final assertion holds the walk to; it is never the walk's stopping oracle, so a door
 * whose count is short (even by a whole page) cannot end the walk early and then agree with itself. Two guards make a broken
 * door fail by name instead of looping: an offset asked twice is a cycle (throws), and an error page ends the walk as an error.
 * Pure over `fetchPage`, so the detectors below can drive it with an invented door.
 */
async function walkPublished(fetchPage) {
  const seen = new Set();
  const asked = new Set();
  let counts = null, offset = 0, pages = 0;
  for (;;) {
    if (asked.has(offset)) throw new Error(`the walk asked offset ${offset} twice: the door is cycling`);
    asked.add(offset);
    const page = await fetchPage(offset);
    pages += 1;
    if (page?.error) return { seen, counts, pages, stoppedBy: "error" };
    counts ??= page.counts;
    const before = seen.size;
    for (const r of page.published ?? []) seen.add(r.id);
    if (seen.size === before) return { seen, counts, pages, stoppedBy: "tail" };   // the terminal observation: a page with no new id
    offset += page.shown?.published ?? page.published?.length ?? 0;
  }
}

/**
 * THE ONE FINAL ASSERTION. The walk must have ended honestly (it reached the tail: an error after reaching the promised
 * number does not count), and then what it walked is exactly what the door promised. Both detectors and the live test call it.
 */
function assertWalkedWhole({ seen, counts, stoppedBy }) {
  assert.equal(stoppedBy, "tail", `the walk ended by "${stoppedBy}", not at the tail: a walk that stopped on an error proves nothing about the rest`);
  assert.equal(seen.size, counts.published,
    `walked ${seen.size} published marks; the door's own count says ${counts.published}`);
}

test("FALSIFIER — the walk reaches every mark the counts promise", async (t) => {
  if (!HAVE) return t.skip(WHY_NOT);
  assertWalkedWhole(await walkPublished((offset) => worldMyMarks(KEY(), { offset })));
  // ⚑ AND THIS IS WHY `complete` IS NOT THE END-OF-WALK FLAG: it means "this ONE
  // page holds everything", so past twenty it is false at EVERY offset and
  // never becomes true. Reading it as "keep going" is an infinite walk; the
  // counts are the real end, and this asserts that they are reachable.
  const last = await worldMyMarks(KEY(), { offset: 0 });
  assert.equal(last.complete, false,
    "with more than one page, `complete` is false at offset 0 — and stays false everywhere");
});

// ── THE DETECTORS (POS-896): an invented door, the walk's expectation held fixed, one wrong door per branch ──
// No clone: these drive `walkPublished` and `assertWalkedWhole` (the SAME final assertion the live test calls) with a door that
// honours the offset the way markPage does (clamped to the last row, MARKS_PAGE rows). `claims` is what the door's counts say;
// by default the truth. Expected values are fixed numbers, not copied from a result.
const PAGE = 20;
const inventedDoor = (n, { honourOffset = true, dropFrom = Infinity, claims = n, errorFrom = Infinity } = {}) => async (offset) => {
  if (offset >= errorFrom) return { error: "bounce" };
  const start = honourOffset ? Math.min(Math.max(offset, 0), Math.max(n - 1, 0)) : 0;
  const rows = [];
  for (let i = start; i < Math.min(start + PAGE, n, dropFrom); i += 1) rows.push({ id: `invented/mark-${i}` });
  return { counts: { published: claims }, published: rows, shown: { published: rows.length }, complete: n <= PAGE };
};
// the loop this file used to carry, kept only so the detector can show what a blind cap does
async function blindCappedWalk(fetchPage, cap = 200) {
  const seen = new Set();
  let counts = null;
  for (let offset = 0; offset < cap; offset += 20) {
    const page = await fetchPage(offset);
    counts ??= page.counts;
    const before = seen.size;
    for (const r of page.published ?? []) seen.add(r.id);
    if (seen.size === before) break;
  }
  return { seen, counts };
}
/** The result of the final assertion on a walk: null when it holds, else the failing assertion's actual and expected. */
const finalVerdict = (result) => { try { assertWalkedWhole(result); return null; } catch (e) { return { actual: e.actual, expected: e.expected }; } };

test("detector · a household past the old 200-row cap is walked whole: 348 marks to the tail (18 pages and the probe past it), equal to the promise", async () => {
  const r = await walkPublished(inventedDoor(348));
  assert.deepEqual({ walked: r.seen.size, promised: r.counts.published, pages: r.pages, stoppedBy: r.stoppedBy }, { walked: 348, promised: 348, pages: 19, stoppedBy: "tail" });
  assert.equal(finalVerdict(r), null);
});

test("detector · zero, one, an exact page, a page and one, and 91 marks each end at the tail with the right count (a page per 20, plus the probe)", async () => {
  for (const [n, pages] of [[0, 1], [1, 2], [20, 2], [21, 3], [40, 3], [91, 6]]) {
    const r = await walkPublished(inventedDoor(n));
    assert.deepEqual({ n, walked: r.seen.size, pages: r.pages, stoppedBy: r.stoppedBy }, { n, walked: n, pages, stoppedBy: "tail" });
    assert.equal(finalVerdict(r), null, `${n} marks`);
  }
});

test("detector · the retired blind cap WOULD have stopped short: 200 of 348 (the defect this change removes)", async () => {
  const old = await blindCappedWalk(inventedDoor(348));
  assert.deepEqual({ walked: old.seen.size, promised: old.counts.published }, { walked: 200, promised: 348 });
});

test("detector · a door whose count is SHORT (348 rows, promises 320, and promises 328, a whole page short) is walked to its real tail and the final assertion refuses it by number", async () => {
  for (const claims of [320, 328, 347]) {
    const r = await walkPublished(inventedDoor(348, { claims }));
    assert.deepEqual({ walked: r.seen.size, stoppedBy: r.stoppedBy }, { walked: 348, stoppedBy: "tail" }, `claims ${claims}: the walk still reaches the tail`);
    assert.deepEqual(finalVerdict(r), { actual: 348, expected: claims }, `claims ${claims}: refused as 348 against ${claims}`);
  }
});

test("detector · a door whose count is LONG (320 rows, promises 348) is refused as 320 against 348", async () => {
  const r = await walkPublished(inventedDoor(320, { claims: 348 }));
  assert.deepEqual({ walked: r.seen.size, stoppedBy: r.stoppedBy }, { walked: 320, stoppedBy: "tail" });
  assert.deepEqual(finalVerdict(r), { actual: 320, expected: 348 });
});

test("detector · a door that ignores the offset ends at the tail it keeps showing, 20 of 348, and is refused by number", async () => {
  const r = await walkPublished(inventedDoor(348, { honourOffset: false }));
  assert.deepEqual({ walked: r.seen.size, stoppedBy: r.stoppedBy }, { walked: 20, stoppedBy: "tail" });
  assert.deepEqual(finalVerdict(r), { actual: 20, expected: 348 });
});

test("detector · a door that loses its tail ends early and is refused: 300 walked of 348 promised", async () => {
  const r = await walkPublished(inventedDoor(348, { dropFrom: 300 }));
  assert.deepEqual({ walked: r.seen.size, stoppedBy: r.stoppedBy }, { walked: 300, stoppedBy: "tail" });
  assert.deepEqual(finalVerdict(r), { actual: 300, expected: 348 });
});

test("detector · an error AFTER every promised mark was reached cannot pass: seen equals the promise, yet the walk did not end at the tail", async () => {
  const r = await walkPublished(inventedDoor(348, { errorFrom: 348 }));   // honest pages through offset 340, then the probe past the tail errors
  assert.deepEqual({ walked: r.seen.size, promised: r.counts.published, stoppedBy: r.stoppedBy }, { walked: 348, promised: 348, stoppedBy: "error" });
  assert.deepEqual(finalVerdict(r), { actual: "error", expected: "tail" }, "refused for the error, not for the number");
});

test("detector · an error before the promise is reached is refused as an error too", async () => {
  const r = await walkPublished(inventedDoor(348, { errorFrom: 100 }));
  assert.equal(r.stoppedBy, "error");
  assert.deepEqual(finalVerdict(r), { actual: "error", expected: "tail" });
});

test("detector · a door whose pages claim to show nothing while adding ids makes the walk fail by name (a cycle), never loop", async () => {
  let n = 0;
  const cycling = async () => ({ counts: { published: 1000 }, published: [{ id: `invented/new-${n += 1}` }], shown: { published: 0 } });
  await assert.rejects(walkPublished(cycling), /asked offset 0 twice: the door is cycling/);
});
