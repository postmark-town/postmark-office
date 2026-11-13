// town-feed.test.mjs — `town { read: "feed" }`: the town as one stream (POS-1027). No store: the six sources are injected, so what is judged here is the merge.
//
//   node --test test/town-feed.test.mjs
//
// The claims:
//   1. one row per thing, from six kinds, newest first, each with a stable id, kind, at, href and title; a time a source does not have is never invented;
//   2. backed ranks by the stamps behind a row (a row with none ranks 0); near ranks by metres from the house, a row with no place last, and a house the town holds
//      no position for says so and the rows come newest (never ranked from a guessed origin);
//   3. THE CURSOR never skips and never duplicates: paging a whole feed in small pages gives exactly the one-page list, across kinds, with TIES in every sort;
//      and a cursor belongs to the sort it came from;
//   4. kinds and since narrow; an unavailable source is NAMED and its kind is left out, never read as empty; a source cut at its cap is named too, and a
//      time-ordered page never serves a row older than the oldest a cut source returned (it reads that source on down at the next page);
//   5. bad arguments are refused by name.

import test from "node:test";
import assert from "node:assert/strict";
import { feedRead, FEED_KINDS, encodeFeedCursor, decodeFeedCursor, keyOf, compareKeys, instantOf, FETCH_CAP } from "../src/town-feed.mjs";

const T = (min) => new Date(Date.parse("2026-11-13T12:00:00Z") - min * 60_000).toISOString();
const row = (kind, id, min, extra = {}) => ({ id, kind, at: T(min), href: `https://example.test/${kind}/${id}`, title: `${kind} ${id}`, ...extra });

/** Sources over fixed rows, honouring since/before/cap the way a real source does, and counting the calls. */
function sources(rows, { cut = {}, fail = {}, origin = { x: 0, y: 0, from: "the test" } } = {}) {
  const calls = [];
  const by = (kind) => async ({ since, before, cap }) => {
    calls.push([kind, since, before, cap]);
    if (fail[kind]) throw new Error("store down");
    const mine = rows.filter((r) => r.kind === kind && (!since || (r.at != null && r.at >= since)) && (!before || r.at == null || r.at <= before))
      .sort((a, b) => (a.at === b.at ? String(a.id).localeCompare(String(b.id)) : a.at < b.at ? 1 : -1));
    const take = cut[kind] ?? cap;
    return { rows: mine.slice(0, take), cut: mine.length > take };
  };
  const out = Object.fromEntries(FEED_KINDS.map((k) => [k, by(k)]));
  return { calls, sources: { ...out, origin: async () => origin, asOf: async () => "asof-1" } };
}

const MIX = [
  row("letter", "L1", 1), row("idea", "I1", 2, { backed: 5, place: { x: 30, y: 40 } }), row("bug", "B1", 3), row("event", "E1", 4, { place: { x: 3, y: 4 } }),
  row("mark", "M1", 5, { backed: 9, place: { x: 600, y: 800 } }), row("arrival", "A1", 6),
  // ties: five rows at ONE instant, across every kind, and two at another
  row("letter", "L2", 10), row("idea", "I2", 10, { backed: 5 }), row("bug", "B2", 10), row("event", "E2", 10), row("mark", "M2", 10, { backed: 5 }),
  row("letter", "L3", 20), row("idea", "I3", 20),
];

test("1 · one row per thing, six kinds, newest first; a date-only time says so and a missing time is not invented", async () => {
  const { sources: s } = sources(MIX);
  const r = await feedRead({ limit: 100 }, { sources: s });
  assert.equal(r.read, "feed");
  assert.equal(r.rows.length, MIX.length);
  assert.deepEqual(new Set(r.rows.map((x) => x.kind)), new Set(FEED_KINDS));
  const ats = r.rows.map((x) => x.at);
  assert.deepEqual(ats, [...ats].sort().reverse(), "newest first");
  for (const x of r.rows) for (const k of ["id", "kind", "at", "href", "title"]) assert.ok(x[k] != null, `${x.id} has ${k}`);
  assert.equal(r.as_of, "asof-1");
  assert.deepEqual(instantOf("2026-11-01"), { at: "2026-11-01T00:00:00.000Z", at_precision: "day" });
  assert.deepEqual(instantOf(null), { at: null });
  assert.deepEqual(instantOf("not a time"), { at: null });
  // a row with no time sorts last and is excluded by since: no invented instant
  const { sources: s2 } = sources([row("bug", "B", 1), { id: "X", kind: "letter", at: null, href: "h", title: "t" }]);
  const all = await feedRead({}, { sources: s2 });
  assert.deepEqual(all.rows.map((x) => x.id), ["B", "X"]);
  assert.equal(all.rows[1].at, null);
  assert.deepEqual((await feedRead({ since: T(60) }, { sources: s2 })).rows.map((x) => x.id), ["B"]);
});

test("2 · backed ranks by the stamps behind a row; near by metres from the house, and an unplaced house is said, never guessed", async () => {
  const { sources: s } = sources(MIX);
  const backed = await feedRead({ sort: "backed", limit: 100 }, { sources: s });
  assert.deepEqual(backed.rows.slice(0, 2).map((x) => x.id), ["M1", "I1"], "nine, then five (the newer of the fives first)");
  assert.deepEqual(backed.rows.map((x) => x.backed ?? 0), backed.rows.map((x) => x.backed ?? 0).slice().sort((a, b) => b - a), "descending, rows with none as 0");
  const near = await feedRead({ sort: "near", household: "h", limit: 100 }, { sources: s });
  assert.equal(near.sort, "near");
  assert.deepEqual(near.rows.slice(0, 3).map((x) => [x.id, x.distance_m]), [["E1", 5], ["I1", 50], ["M1", 1000]]);
  assert.ok(near.rows.slice(3).every((x) => x.distance_m === undefined), "a row with no place has no distance and ranks last");
  // no origin: said, and the rows come newest
  const { sources: none } = sources(MIX, { origin: { unavailable: "the walkers roll places none of h's residents" } });
  const unranked = await feedRead({ sort: "near", household: "h", limit: 100 }, { sources: none });
  assert.equal(unranked.sort, "newest");
  assert.equal(unranked.sort_asked, "near");
  assert.match(unranked.near_unavailable, /walkers roll places none/);
  assert.ok(unranked.rows.every((x) => x.distance_m === undefined));
  const noHouse = await feedRead({ sort: "near" }, { sources: s });
  assert.match(noHouse.near_unavailable, /pass household/);
});

test("3 · the cursor never skips and never duplicates: whole feeds paged small equal the one-page list, in every sort, with ties across kinds", async () => {
  for (const sort of ["newest", "backed", "near"]) {
    const { sources: s } = sources(MIX);
    const whole = (await feedRead({ sort, household: "h", limit: 100 }, { sources: s })).rows.map((x) => `${x.kind}:${x.id}`);
    for (const size of [1, 2, 3, 5]) {
      const ids = [];
      let cursor;
      for (let guard = 0; guard < 40; guard++) {
        const page = await feedRead({ sort, household: "h", limit: size, ...(cursor ? { cursor } : {}) }, { sources: s });
        ids.push(...page.rows.map((x) => `${x.kind}:${x.id}`));
        if (!page.cursor) break;
        cursor = page.cursor;
      }
      assert.deepEqual(ids, whole, `${sort}, pages of ${size}: no row skipped, none twice`);
      assert.equal(new Set(ids).size, ids.length);
    }
  }
  // the key is total: two rows never share one, even at one instant
  const keys = MIX.map((r) => keyOf(r, "newest"));
  for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) assert.notEqual(compareKeys(keys[i], keys[j], "newest"), 0);
  // a cursor belongs to its sort, and a bad one is refused
  const { sources: s } = sources(MIX);
  const p = await feedRead({ sort: "newest", limit: 2 }, { sources: s });
  assert.equal((await feedRead({ sort: "backed", cursor: p.cursor }, { sources: s })).code, 422);
  assert.equal((await feedRead({ cursor: "garbage" }, { sources: s })).code, 422);
  assert.deepEqual(decodeFeedCursor(encodeFeedCursor("newest", [T(1), 0, "L1"])), { sort: "newest", key: [T(1), 0, "L1"] });
});

test("3 · a thing that arrives between two pages appears where it belongs and never displaces a row already served", async () => {
  const rows = [row("letter", "L1", 5), row("bug", "B1", 6), row("idea", "I1", 7), row("event", "E1", 8)];
  let live = rows.slice();
  const s = { ...Object.fromEntries(FEED_KINDS.map((k) => [k, async () => ({ rows: live.filter((r) => r.kind === k), cut: false })])), origin: async () => ({}), asOf: async () => "x" };
  const first = await feedRead({ limit: 2 }, { sources: s });
  assert.deepEqual(first.rows.map((x) => x.id), ["L1", "B1"]);
  live = [row("arrival", "A-new", 1), ...rows];   // newer than everything served: it is not on page two, and nothing served moves
  const second = await feedRead({ limit: 2, cursor: first.cursor }, { sources: s });
  assert.deepEqual(second.rows.map((x) => x.id), ["I1", "E1"], "the continuation is below the last row served");
  assert.ok(!second.rows.some((x) => x.id === "A-new"));
});

test("4 · kinds and since narrow; an unavailable source is named and its kind left out, never read as empty", async () => {
  const { sources: s } = sources(MIX, { fail: { event: true } });
  const r = await feedRead({ limit: 100 }, { sources: s });
  assert.ok(!r.rows.some((x) => x.kind === "event"));
  assert.equal(r.unavailable.length, 1);
  assert.equal(r.unavailable[0].kind, "event");
  assert.match(r.unavailable[0].reason, /missing here, not absent from the town/);
  assert.equal(r.complete, false, "a feed missing a source is not complete");
  const only = await feedRead({ kinds: "bug, idea", limit: 100 }, { sources: sources(MIX).sources });
  assert.deepEqual(only.kinds, ["idea", "bug"]);
  assert.ok(only.rows.every((x) => x.kind === "bug" || x.kind === "idea"));
  const arr = await feedRead({ kinds: ["letter"], limit: 100 }, { sources: sources(MIX).sources });
  assert.ok(arr.rows.every((x) => x.kind === "letter"));
  const since = await feedRead({ since: T(5), limit: 100 }, { sources: sources(MIX).sources });
  assert.ok(since.rows.every((x) => x.at >= T(5)) && since.rows.length === 5);
});

test("4 · a source cut at its cap is named; a time-ordered page never serves a row older than the oldest a cut source returned, and the next page reads it on", async () => {
  // 30 letters (one a minute), but the letter source returns only its newest 10 at a time; other kinds hold one row each far below
  const letters = Array.from({ length: 30 }, (_, i) => row("letter", `L${String(i).padStart(2, "0")}`, i + 1));
  const others = [row("bug", "B-old", 15), row("idea", "I-old", 25)];
  const { sources: s } = sources([...letters, ...others], { cut: { letter: 10 } });
  const seen = [];
  let cursor, pages = 0;
  for (; pages < 60; pages++) {
    const p = await feedRead({ limit: 7, ...(cursor ? { cursor } : {}) }, { sources: s });
    if (pages === 0) assert.deepEqual(p.incomplete.map((x) => x.kind), ["letter"], "the cut is named");
    seen.push(...p.rows.map((x) => `${x.kind}:${x.id}`));
    if (!p.cursor) break;
    cursor = p.cursor;
  }
  // the total order: time newest first, then the kind's rank (letter before bug before idea…), then id — L14 and B-old share an instant, as do L24 and I-old
  const truth = [...letters, ...others].sort((a, b) => (a.at === b.at ? (FEED_KINDS.indexOf(a.kind) - FEED_KINDS.indexOf(b.kind)) || a.id.localeCompare(b.id) : a.at < b.at ? 1 : -1)).map((x) => `${x.kind}:${x.id}`);
  assert.deepEqual(seen, truth, "a cut source is read on down, so nothing is skipped across the cut");
  assert.ok(FETCH_CAP >= 100);
});

test("5 · bad arguments are refused by name", async () => {
  const { sources: s } = sources(MIX);
  for (const [args, re] of [[{ sort: "loudest" }, /not a feed sort/], [{ kinds: "letter,poem" }, /not a kind/], [{ since: "yesterday-ish" }, /not a time/]]) {
    const r = await feedRead(args, { sources: s });
    assert.equal(r.error, "bounce");
    assert.equal(r.code, 422);
    assert.match(r.defect, re);
  }
  const clamp = await feedRead({ limit: 5000 }, { sources: s });
  assert.equal(clamp.limit, 100);
  assert.match(clamp.limit_note, /this page carries 100/);
});
