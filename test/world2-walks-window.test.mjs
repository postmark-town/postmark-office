// world2-walks-window.test.mjs — `/world2/walks?since=&last=`, the door's own
// shape, exercised against canned `acts` rows (POS-84).
//
// WHY THIS DOOR GREW A WINDOW. It answered the whole record and only the whole
// record: 2,498 departures / 1.17 MB measured on prod 2026-09-16, growing by
// ~100 a day. Its one live consumer — the world viewer's Lately pane — wanted a
// fortnight, could not ask for one, and read `WORLD/walk-ledger.md` instead, a
// file frozen 2026-08-10. So Lately showed nothing the town had done in five
// weeks. The window is the ask it did not have.
//
// WHAT THIS FILE PROVES, and what it deliberately does not:
//
//   · The CUT and the SHAPE. A windowed row is the same row — field for field,
//     `line` and `line_derived` included — as the unwindowed answer's. A door
//     that changed its grammar when you narrowed it would be two doors.
//   · The ORDER SURVIVES. This read's order is the record's own APPEND order,
//     which is not instant order (§ DEPARTURE_ORDER_SQL — the 08-08 sailing
//     filed every passenger at 18:00:00.000Z and those lines were appended
//     after walks stamped 18:16). A window filters; it must never re-sort, and
//     `last` is therefore the most recently APPENDED n. The sailing's own shape
//     is canned below so that claim is tested rather than asserted in prose.
//   · The REFUSALS. An unreadable `since` or `last` bounces. A door that
//     silently served 2,498 rows to a caller who asked for 40 would have
//     answered a question nobody put to it.
//   · NOT the store. Postgres, the real acts table and era-equality belong to
//     `falsifier-live-equality.mjs`; this file drives `world2Serve` with an
//     injected connection, which is the seam `world2Apex` already had.
//
// THE FLIP, run 2026-09-16 on the committed tree. Drop the window from
// `src/world2-serve.mjs` — delete the `if (win.sinceMs != null)` filter and the
// `if (win.last != null)` slice in the `/world2/walks` arm — and 7 of these 21
// go red, the first being:
//
//   not ok 3 - since keeps only the departures at or after it
//     error: |-
//       Expected values to be strictly equal:
//
//       4 !== 2
//
// Run: node --test test/world2-walks-window.test.mjs

import { test, before, after } from "node:test";
import assert from "node:assert/strict";

const env = { pg: process.env.WORLD2_PG, url: process.env.WORLD2_PG_URL };
before(() => {
  // The env gate decides whether these doors exist at all, and it is not what
  // is under test. The injected pool means no connection is ever opened, so the
  // URL is a placeholder that must merely be truthy.
  process.env.WORLD2_PG = "1";
  process.env.WORLD2_PG_URL = "postgres://walks-window-test/none";
});
after(() => {
  if (env.pg == null) delete process.env.WORLD2_PG; else process.env.WORLD2_PG = env.pg;
  if (env.url == null) delete process.env.WORLD2_PG_URL; else process.env.WORLD2_PG_URL = env.url;
});

const { world2Serve } = await import("../src/world2-serve.mjs");

// ── the row shapes, as their pens write them ────────────────────────────────

// ERA 1 — the frozen walk ledger: `parseWalkLedger`'s own output, whole, plus
// the raw `line`. `_ledger` is what the backfill stamps and what the order
// clause sorts on.
const ledgerAct = (id, { iso, handle, at }) => ({
  id, at: new Date(iso), crossing: null, actor: handle, action: "legacy:departure",
  payload: {
    _ledger: "WORLD/walk-ledger.md", iso, handle,
    from: { x: 0, y: 0 }, toward: { x: 100, y: 100 }, at,
    targetExtent: null, targetMarkId: null, pace: null,
    line: `- ${iso} · ${handle} · from 0,0 · toward 100,100 · at ${at}`,
  },
});

// ERA 5 — the movement-store pen (`WORLD_MOVEMENT_V2`). No ledger line is
// written at all, so the door renders one and says `line_derived`. The crossing
// rides the ACT ROW and `pg` hands numeric back as TEXT.
const movementAct = (id, { iso, handle, crossing, to = null, pace = null }) => ({
  id, at: new Date(iso), crossing: String(crossing), actor: handle, action: "walk",
  payload: { from: { x: 10, y: 10 }, toward: { x: 20, y: 20 }, within: null, to, pace },
});

// The record as the town actually wrote it: the frozen era first, in file
// order, then the live pen. Ids ascend inside each era — `assertDepartureOrder`
// refuses anything else, and that guard is the 44-handle trap's only alarm.
//
// Rows 1 and 2 ARE the 08-08 sailing: the passenger filed at 18:00:00.000Z was
// appended after the walk stamped 18:16:36.605Z. Append order and instant order
// disagree here and nowhere else in the real record.
const ROWS = [
  ledgerAct(1, { iso: "2026-08-08T18:16:36.605Z", handle: "wright", at: 95.88 }),
  ledgerAct(2, { iso: "2026-08-08T18:00:00.000Z", handle: "amber", at: 95.87 }),
  movementAct(3, { iso: "2026-09-15T09:00:00.000Z", handle: "sophia-familiaris", crossing: 193.1, to: "claude-of-tulip/the-headland", pace: 60 }),
  movementAct(4, { iso: "2026-09-16T17:49:43.061Z", handle: "jetto-of-starforge", crossing: 193.48 }),
];

const pool = { query: async () => ({ rows: ROWS }) };
const walks = (qs = "") => world2Serve("/world2/walks", new URLSearchParams(qs), { p: pool });

// ═════════════════════════════════════════════════════════════════════════════
// NO WINDOW — the answer this door has always given
// ═════════════════════════════════════════════════════════════════════════════

test("no query answers the whole record, and says nothing about a window", async () => {
  const { code, body } = await walks();
  assert.equal(code, 200);
  assert.equal(body.count, 4);
  assert.equal(body.walks.length, 4);
  assert.equal(body.what, "every departure the record holds, oldest first — the walk ledger's grammar, served from acts");
  assert.equal("window" in body, false, "an unwindowed answer must not grow a window field");
  assert.deepEqual(body.eras, { ledger: 2, journal: 0, "journal-line": 0, live: 0, "movement-store": 2 });
});

test("the row shape is the ledger's grammar, and a derived line says so", async () => {
  const { body } = await walks();
  const [sailing] = body.walks;
  assert.deepEqual(sailing, {
    iso: "2026-08-08T18:16:36.605Z", handle: "wright",
    from: { x: 0, y: 0 }, toward: { x: 100, y: 100 }, at: 95.88,
    within: null, to: null, pace: null,
    era: "ledger", act_id: "1",
    line: "- 2026-08-08T18:16:36.605Z · wright · from 0,0 · toward 100,100 · at 95.88",
  });
  const live = body.walks.at(-1);
  assert.equal(live.era, "movement-store");
  assert.equal(live.line_derived, true, "a row the record never wrote a line for must admit the line is derived");
  assert.match(live.line, /jetto-of-starforge/);
});

// ═════════════════════════════════════════════════════════════════════════════
// ?since — the cut
// ═════════════════════════════════════════════════════════════════════════════

test("since keeps only the departures at or after it", async () => {
  const { code, body } = await walks("since=2026-09-15T00:00:00Z");
  assert.equal(code, 200);
  assert.equal(body.count, 2);
  assert.deepEqual(body.walks.map((w) => w.act_id), ["3", "4"]);
  assert.deepEqual(body.eras, { ledger: 0, journal: 0, "journal-line": 0, live: 0, "movement-store": 2 });
});

test("since is inclusive of its own instant", async () => {
  const { body } = await walks("since=2026-09-16T17:49:43.061Z");
  assert.deepEqual(body.walks.map((w) => w.act_id), ["4"]);
});

test("a windowed row is the same row, field for field", async () => {
  const whole = await walks();
  const cut = await walks("since=2026-09-15T00:00:00Z");
  const sameIds = whole.body.walks.filter((w) => ["3", "4"].includes(w.act_id));
  assert.deepEqual(cut.body.walks, sameIds,
    "a door that changed its grammar when you narrowed it would be two doors");
});

test("the answer names the window it applied, and how big the record behind it is", async () => {
  const { body } = await walks("since=2026-09-15T00:00:00Z");
  assert.equal(body.window.since, "2026-09-15T00:00:00Z");
  assert.equal(body.window.last, null);
  assert.equal(body.window.count_all, 4);
  assert.match(body.what, /inside the window you asked for/);
  assert.match(body.window.note, /never re-sorts/);
});

test("a since after everything answers empty rather than falling back to everything", async () => {
  const { code, body } = await walks("since=2030-01-01T00:00:00Z");
  assert.equal(code, 200);
  assert.deepEqual(body.walks, []);
  assert.equal(body.count, 0);
  assert.equal(body.window.count_all, 4);
});

// ═════════════════════════════════════════════════════════════════════════════
// ?last — the tail of the APPEND order
// ═════════════════════════════════════════════════════════════════════════════

test("last keeps the tail of the record's own append order", async () => {
  const { body } = await walks("last=2");
  assert.deepEqual(body.walks.map((w) => w.act_id), ["3", "4"]);
  assert.equal(body.window.last, 2);
  assert.equal(body.window.count_all, 4);
});

test("last is the most recently APPENDED n, not the n latest instants", async () => {
  // Rows 1 and 2 are the 08-08 sailing. Instant order would make the 18:16 walk
  // the later of the two; append order makes the 18:00 passenger the later,
  // because that is the line the record wrote last. `last` must read the
  // record, not the clock — re-sorting here is exactly what re-decides which
  // leg governs a resident.
  const { body } = await walks("since=2026-08-08T00:00:00Z&last=3");
  assert.deepEqual(body.walks.map((w) => w.iso), [
    "2026-08-08T18:00:00.000Z",
    "2026-09-15T09:00:00.000Z",
    "2026-09-16T17:49:43.061Z",
  ], "the dropped row is the FIRST appended, not the earliest instant");
});

test("a window filters and never re-sorts", async () => {
  const { body } = await walks("since=2026-08-08T00:00:00Z");
  assert.deepEqual(body.walks.map((w) => w.iso), [
    "2026-08-08T18:16:36.605Z",
    "2026-08-08T18:00:00.000Z",
    "2026-09-15T09:00:00.000Z",
    "2026-09-16T17:49:43.061Z",
  ], "the sailing's inversion is the record's own and must survive the cut");
});

test("since and last compose: the cut first, then the tail of what survived", async () => {
  const { body } = await walks("since=2026-09-15T00:00:00Z&last=1");
  assert.deepEqual(body.walks.map((w) => w.act_id), ["4"]);
  assert.equal(body.window.since, "2026-09-15T00:00:00Z");
  assert.equal(body.window.last, 1);
});

test("last larger than the record is the whole record, not an error", async () => {
  const { body } = await walks("last=99");
  assert.equal(body.count, 4);
});

// ═════════════════════════════════════════════════════════════════════════════
// THE REFUSALS — an unreadable window bounces rather than being ignored
// ═════════════════════════════════════════════════════════════════════════════

test("a since that is not an instant bounces", async () => {
  const { code, body } = await walks("since=last%20tuesday");
  assert.equal(code, 422);
  assert.equal(body.error, "bounce");
  assert.match(body.defect, /is not an instant/);
  assert.match(body.hint, /ISO-8601/);
});

test("an empty since bounces rather than reading as the whole record", async () => {
  const { code } = await walks("since=");
  assert.equal(code, 422, "a caller writing ?since= has a bug, and silently serving 2,498 rows hides it");
});

for (const bad of ["0", "-3", "2.5", "many", ""]) {
  test(`last=${JSON.stringify(bad)} bounces`, async () => {
    const { code, body } = await walks(`last=${encodeURIComponent(bad)}`);
    assert.equal(code, 422);
    assert.match(body.defect, /is not a count of rows/);
  });
}

test("the clock bounces before the window does — ?at is still its own question", async () => {
  const { code, body } = await walks("at=yesterday&since=2026-09-15T00:00:00Z");
  assert.equal(code, 422);
  assert.match(body.hint, /\?at=/);
});

// ═════════════════════════════════════════════════════════════════════════════
// THE ORDER GUARD still stands over the windowed read
// ═════════════════════════════════════════════════════════════════════════════

test("an unordered read still bounces, window or no window", async () => {
  const outOfOrder = [ROWS[2], ROWS[0]]; // a ledger act after a live one
  const p = { query: async () => ({ rows: outOfOrder }) };
  const { code, body } = await world2Serve("/world2/walks", new URLSearchParams("since=2026-01-01T00:00:00Z"), { p });
  assert.equal(code, 500);
  assert.equal(body.error, "bounce");
  assert.match(body.hint, /append order/);
});
