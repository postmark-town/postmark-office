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
 * published marks grow past it, although the door is right. The walk now advances by what the door SHOWED and ends on the
 * door's own count, with two guards so a broken door fails by name instead of looping: an offset asked twice is a cycle, and
 * a page that adds no new id is no progress. Pure over `fetchPage`, so the detectors below can drive it with an invented door.
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
    if (seen.size >= counts.published) return { seen, counts, pages, stoppedBy: "count" };
    if (seen.size === before) return { seen, counts, pages, stoppedBy: "no-progress" };  // a page that adds nothing is the end
    offset += page.shown?.published ?? page.published?.length ?? 0;
  }
}

test("FALSIFIER — the walk reaches every mark the counts promise", async (t) => {
  if (!HAVE) return t.skip(WHY_NOT);
  const { seen, counts } = await walkPublished((offset) => worldMyMarks(KEY(), { offset }));
  assert.equal(seen.size, counts.published,
    `walked ${seen.size} published marks; the door's own count says ${counts.published}`);
  // ⚑ AND THIS IS WHY `complete` IS NOT THE END-OF-WALK FLAG: it means "this ONE
  // page holds everything", so past twenty it is false at EVERY offset and
  // never becomes true. Reading it as "keep going" is an infinite walk; the
  // counts are the real end, and this asserts that they are reachable.
  const last = await worldMyMarks(KEY(), { offset: 0 });
  assert.equal(last.complete, false,
    "with more than one page, `complete` is false at offset 0 — and stays false everywhere");
});

// ── THE DETECTORS (POS-896): an invented door, the walk's expectation held fixed, one wrong door per branch ──
// No clone: these drive `walkPublished` with a door that honours the offset the way markPage does (clamped, MARKS_PAGE rows).
const PAGE = 20;
const inventedDoor = (n, { honourOffset = true, dropFrom = Infinity } = {}) => async (offset) => {
  const start = honourOffset ? Math.min(Math.max(offset, 0), Math.max(n - 1, 0)) : 0;
  const rows = [];
  for (let i = start; i < Math.min(start + PAGE, n, dropFrom); i += 1) rows.push({ id: `invented/mark-${i}` });
  return { counts: { published: n }, published: rows, shown: { published: rows.length }, complete: n <= PAGE };
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

test("detector · a household past the old 200-row cap is walked whole: 348 marks in 18 pages, equal to the promise", async () => {
  const r = await walkPublished(inventedDoor(348));
  assert.deepEqual({ walked: r.seen.size, promised: r.counts.published, pages: r.pages, stoppedBy: r.stoppedBy },
    { walked: 348, promised: 348, pages: 18, stoppedBy: "count" });
});

test("detector · the walk also ends on the count for a household of one page and for an exact multiple of the page", async () => {
  for (const n of [1, 20, 21, 40, 91]) {
    const r = await walkPublished(inventedDoor(n));
    assert.equal(r.seen.size, n, `${n} marks`);
    assert.equal(r.pages, Math.ceil(n / PAGE), `${n} marks: one page per ${PAGE}`);
  }
});

test("detector · the retired blind cap WOULD have stopped short: 200 of 348 (the defect this change removes)", async () => {
  const old = await blindCappedWalk(inventedDoor(348));
  assert.deepEqual({ walked: old.seen.size, promised: old.counts.published }, { walked: 200, promised: 348 });
});

test("detector · a door that ignores the offset is caught by name: the walk ends on no progress at 20 of 348", async () => {
  const r = await walkPublished(inventedDoor(348, { honourOffset: false }));
  assert.deepEqual({ walked: r.seen.size, promised: r.counts.published, stoppedBy: r.stoppedBy },
    { walked: 20, promised: 348, stoppedBy: "no-progress" });
});

test("detector · a door that loses its tail is caught: 300 walked of 348 promised", async () => {
  const r = await walkPublished(inventedDoor(348, { dropFrom: 300 }));
  assert.deepEqual({ walked: r.seen.size, promised: r.counts.published, stoppedBy: r.stoppedBy },
    { walked: 300, promised: 348, stoppedBy: "no-progress" });
});

test("detector · a door whose pages claim to show nothing while adding ids makes the walk fail by name (a cycle), never loop", async () => {
  let n = 0;
  const cycling = async () => ({ counts: { published: 1000 }, published: [{ id: `invented/new-${n += 1}` }], shown: { published: 0 } });
  await assert.rejects(walkPublished(cycling), /asked offset 0 twice: the door is cycling/);
});

test("detector · an erroring door ends the walk as an error, not as a short count", async () => {
  const r = await walkPublished(async (offset) => (offset === 0 ? { counts: { published: 50 }, published: [{ id: "invented/a" }], shown: { published: 1 } } : { error: "bounce" }));
  assert.equal(r.stoppedBy, "error");
});
