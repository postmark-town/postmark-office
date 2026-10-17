// read-grammar.test.mjs — explain:, the read grammar's second move (POS-632).
//
// One table, three doors. These hold: the fixed shape; the tutorial at an
// empty path; an unknown path refused with the list; and COVERAGE: every key a
// bare read can carry has a row, so a new key with no explain reds here by
// name. The world's coverage is the v2 read with every optional block filled;
// the town's is its bare read at each shape. The household's live read needs
// the index rig, so its coverage rides test/foyer-shrink.test.mjs.
//
// Run: node --test test/read-grammar.test.mjs

import test from "node:test";
import assert from "node:assert/strict";

process.env.WORLD_APEX = "1";
const { EXPLAIN, EXPLAIN_DOORS, TUTORIAL, explainAnswer, explainRow, explainPath, keyPaths, unexplained, encodeCursor, decodeCursor, CURSOR_RE } = await import("../src/read-grammar.mjs");
const { liveLines, LIVE_KINDS, LIVE_SCAN, LIVE_HW_SQL, LIVE_AFTER_SQL, LIVE_NEWEST_SQL } = await import("../src/world-happened.mjs");
const { shapeV2 } = await import("../src/world-read-v2.mjs");
const { worldApex } = await import("../src/world-apex.mjs");
const { townApex } = await import("../src/town-apex.mjs");

const NOW = Date.parse("2026-10-15T00:08:00Z");

test("every row has the fixed shape, and changes is one of the three cadences", () => {
  assert.deepEqual(EXPLAIN_DOORS, ["world", "household", "doorstep", "town"]);
  for (const door of EXPLAIN_DOORS) for (const [path, r] of Object.entries(EXPLAIN[door])) {
    assert.equal(typeof r.what, "string", `${door} ${path}: what`);
    assert.ok(r.what.length <= 200, `${door} ${path}: what is one line`);
    assert.equal(typeof r.deeper, "string", `${door} ${path}: deeper`);
    assert.ok(["live", "settled", "weekly"].includes(r.changes), `${door} ${path}: changes`);
    for (const k of Object.keys(r)) assert.ok(["what", "detail", "deeper", "changes"].includes(k), `${door} ${path}: ${k}`);
  }
});

test("explain answers docs in one shape, a wildcard covers data-named keys, and an empty path is the tutorial", () => {
  const who = explainAnswer("world", "who.active");
  assert.deepEqual(Object.keys(who), ["explains", "what", "deeper", "changes"]);
  assert.equal(who.explains, "who.active");
  assert.equal(explainRow("world", "view.NNW"), EXPLAIN.world["view.*"]);
  assert.equal(explainRow("household", "papers.wright"), EXPLAIN.household["papers.*"]);
  const t = explainAnswer("town", "");
  assert.equal(t.tutorial, TUTORIAL);
  assert.match(TUTORIAL, /explain: "<path>"/);
  const bad = explainAnswer("world", "nope.nothing");
  assert.equal(bad.code, 422);
  assert.ok(bad.explainable.includes("who"));
  assert.equal(explainPath({ explain: "" }), "", "an empty explain is present, not absent");
  assert.equal(explainPath({}), null);
});

test("coverage: every key of a full v2 world read, to depth 2, has a row", () => {
  const full = shapeV2({
    deep: null, handle: "wright", standpoint: { x: 1, y: 2, seat: {}, arrival: {}, enters_on_arrival: {} }, spine: [{ id: "a", body: "b" }],
    here: "here", near: { id: "n/m", name: "M", body: "b" }, holdings: ["x"], stancesAwaiting: 3, note: "n", frame: { vessel: "v" }, crossing: 250, nextCrossingIn: "1h 00m",
    air: "air", canon: "S1", nextSettlement: "06:00Z", sinceCrossing: 249,
    happened: { to_you: { complete: true }, around_you: { count: 0, events: [] } },
    viewRows: [{ id: "a/b", name: "B", bearing: "N", band: "close by", distM: 5, weight: 20, lifted: true, image: true }],
    events: [{ id: "e/1", title: "E", place: { name: "P" }, phase: "underway", ends: "2026-10-15T04:00:00Z" }],
    departures: { next: [{ at: "2026-10-15T01:00:00Z", toward: "t/s" }] }, mists: { in_wall: true },
    crowd: Array.from({ length: 10 }, (_, i) => ({ handle: `r${i}`, distance_m: i, bearing: "N", band: "close by" })),
    active: new Map(Array.from({ length: 10 }, (_, i) => [`r${i}`, { action: "say", at: NOW }])), activeUnavailable: "x", nowMs: NOW,
    entries: [{ action: "say" }, { action: "candy" }], handles: ["wright", "rei"], humanHere: ["say"], notYours: [{ action: "build", because: "x" }],
    focus: { a: 1 }, found: { b: 1 }, diagnostics: { law: {} },
  });
  assert.deepEqual(unexplained("world", { ...full, heard: [], renamed: [] }, 2), []);
  assert.ok(keyPaths(full).includes("who.more_active"), "the fixture reaches the capped branch");
});

test("coverage: the town's bare read at every shape has a row for every key", async () => {
  for (const shape of [undefined, "t1", "t2"]) {
    const t = await townApex({}, null, shape ? { readShape: shape } : {});
    assert.ok(!t.error, `the town's bare read answers at ${shape ?? "t0"}`);
    assert.deepEqual(unexplained("town", t, 1), [], `town at ${shape ?? "t0"}`);
  }
});

test("the one cursor round-trips the crossing, the clock and the record's high-water mark; anything else is not a cursor", () => {
  const c = encodeCursor({ crossing: 250.4, ms: 1792022882579.7, hw: "18234" });
  assert.equal(c, "c1.250.1792022882579.18234");
  assert.match(c, CURSOR_RE);
  assert.deepEqual(decodeCursor(c), { crossing: 250, ms: 1792022882579, hw: "18234" });
  assert.deepEqual(decodeCursor("c1.250.5."), { crossing: 250, ms: 5, hw: null }, "a record that could not be read leaves the mark empty");
  for (const bad of ["", "250", "c2.250.5.1", "c1.x.5.1", "yesterday"]) assert.equal(decodeCursor(bad), null, bad);
});

test("the live lines: after a cursor's mark by the primary key, else the newest at or after the crossing's start; placed by anchor", async () => {
  const at = (m) => new Date(Date.parse("2026-10-15T00:00:00Z") + m * 60000);
  const rows = [
    { id: "11", actor: "elowen", action: "walk", at: at(1), at_anchor: "a/b", at_dx: 1, at_dy: 2 },
    { id: "12", actor: "fizz", action: "say", at: at(2), at_anchor: "a/b", at_dx: 0, at_dy: 0 },
    { id: "13", actor: "ghost", action: "take", at: at(3), at_anchor: "nowhere", at_dx: 0, at_dy: 0 },
  ];
  const asked = [];
  const query = async (sql, params) => {
    asked.push({ sql, params });
    if (sql === LIVE_HW_SQL) return [{ hw: "13" }];
    if (sql === LIVE_AFTER_SQL) return rows.filter((r) => Number(r.id) > Number(params[0])).reverse(); // newest first, as the SQL orders
    if (sql === LIVE_NEWEST_SQL) return [...rows].reverse();
    throw new Error("unexpected");
  };
  const compose = ({ anchor, dx, dy }, centreOf) => { const c = centreOf(anchor); return c ? { x: c.x + dx, y: c.y + dy } : null; };
  const centreOf = (id) => (id === "a/b" ? { x: 100, y: 200 } : null);
  const after = await liveLines({ afterId: "11", query, centreOf, compose });
  assert.deepEqual(after.lines.map((l) => [l.actor, l.type, l.payload.x]), [["fizz", "emission", 100]], "after 11 only, and an unplaceable act is left out");
  assert.equal(after.hw, "13");
  assert.deepEqual(asked.find((q) => q.sql === LIVE_AFTER_SQL).params, ["11", Object.keys(LIVE_KINDS), LIVE_SCAN]);
  const since = await liveLines({ sinceMs: at(2).getTime(), query, centreOf, compose });
  assert.deepEqual(since.lines.map((l) => l.actor), ["fizz"], "the newest at or after the start, oldest first");
  assert.equal(await liveLines({ query: async () => null, centreOf, compose }), null, "no store: the log alone");
  assert.equal(await liveLines({ query: async () => { throw new Error("down"); }, centreOf, compose }), null);
  assert.ok(!Object.keys(LIVE_KINDS).includes("note-to-self"), "a private act is never a line");
});

test("PR-5: the MCP server's instructions are the tutorial, the same text explain: \"\" answers, with the reading law", async () => {
  const { MCP_INSTRUCTIONS, READING_LAW } = await import("../src/mcp.mjs");
  assert.ok(MCP_INSTRUCTIONS.includes(TUTORIAL));
  assert.ok(MCP_INSTRUCTIONS.includes(READING_LAW));
  for (const move of ["1. Look:", "2. Ask:", "3. Go deeper:", "4. Catch up:"]) assert.ok(TUTORIAL.includes(move), move);
  assert.match(MCP_INSTRUCTIONS, /DARKO/);
});

test("a gap longer than the scan is a glance of its NEWEST acts; the mark handed back is the top; complete is false (review-559 § 1)", async () => {
  const N = LIVE_SCAN + 200;
  const rows = Array.from({ length: N }, (_, i) => ({ id: String(1001 + i), actor: `r${i}`, action: "walk", at: new Date(1e12 + i * 1000), at_anchor: "a/b", at_dx: 0, at_dy: 0 }));
  const query = async (sql, params) => {
    if (sql === LIVE_HW_SQL) return [{ hw: String(1000 + N) }];
    if (sql === LIVE_AFTER_SQL) { const after = rows.filter((r) => Number(r.id) > Number(params[0])); return (/ORDER BY id DESC/.test(sql) ? after.reverse() : after).slice(0, params[2]); } // the store honours the SQL's own order
    throw new Error("unexpected");
  };
  const got = await liveLines({ afterId: "1000", query, centreOf: () => ({ x: 0, y: 0 }), compose: () => ({ x: 0, y: 0 }) });
  assert.equal(got.lines.length, LIVE_SCAN);
  assert.equal(got.lines.at(-1).actor, `r${N - 1}`, "the newest act is in the glance");
  assert.equal(got.lines[0].actor, `r${N - LIVE_SCAN}`, "the cut is at the old end");
  assert.equal(got.hw, String(1000 + N), "the cursor handed back is the top");
  assert.equal(got.complete, false);
  const race = await liveLines({ afterId: "1000", query: async (sql, p) => (sql === LIVE_HW_SQL ? [{ hw: "1001" }] : query(sql, p)), centreOf: () => ({}), compose: () => ({ x: 0, y: 0 }) });
  assert.equal(race.hw, String(1000 + N), "a row newer than the top read before it raises the mark: shown now, never again");
});

test("the doors answer explain: before anything is read, and never beside an act or a read", async () => {
  const w = await worldApex({ explain: "now.happened" }, null, {});
  assert.equal(w.explains, "now.happened");
  assert.equal(w.changes, "live");
  assert.equal((await worldApex({ explain: "" }, null, {})).tutorial, TUTORIAL);
  assert.equal((await worldApex({ explain: "who", do: "say" }, null, {})).code, 422);
  assert.equal((await worldApex({ explain: "who", read: "view" }, null, {})).code, 422);
  assert.equal((await townApex({ explain: "reading" }, null, {})).explains, "reading");
  assert.equal((await townApex({ explain: "who" }, null, {})).code, 422, "a world path is not a town path");
});
