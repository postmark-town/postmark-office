// world2-settlements-reads.test.mjs — `/world2/settlements`, the settlements
// twin, held to 1.0's own rules AND made unable to go green off the tree
// (postmark#2897, POS-104 box 4).
//
// ── WHAT IS HELD TO WHAT ────────────────────────────────────────────────────
//
// 1.0 (`src/settlements.mjs`) is two halves: `readSettlementTags` shells git
// over the world clone and hands back `{tag, sha, date}` lines; `settlementsFrom`
// decides what those lines MEAN — which count, ordered by NUMBER (never by
// date, never by git's lexical `S9`-after-`S10` order), `current` = the highest
// number that landed, a gap left as the refusal it was, and the recent cap.
//
// The twin replaces the first half with a table read and keeps the second half
// by IMPORTING it. So the equality here is against `settlementsFrom` over the
// fixture's rows rendered as git lines: the twin's `{current, recent}` must BE
// that function's output, field for field, plus the two fields only the store
// has (`window`, `blessed_at`). A twin that re-expressed the rules would pass a
// test written against its own copy; this file asserts it did not.
//
// ── WHY AN EQUALITY ALONE WOULD BE WORTHLESS ────────────────────────────────
//
// 1.0 reads the world clone's tags. A twin that quietly did the same would
// answer identically on every real row, and the equality above would pass with
// the port doing nothing. So the fixture store carries a row that stands in NO
// clone — `settlement/S9001`, a number the world will not reach for years (it
// stands at S71 and blesses about twice a day) — and the pool COUNTS what it
// was asked, so a door that never opened `settlements` fails on the count even
// if its numbers looked right.
//
// No database, no checkout: the pool is canned rows. The LIVE equality — the
// table on prod against the clone's tags — is `settlements-backfill.mjs
// --verify`, which needs a store and a checkout.
//
// ── THE FLIP, run 2026-09-17 against commit 3b5526c of this branch ──────────
//
// In `src/world2-serve.mjs § /world2/settlements`, point the twin at the tree:
// replace the table read
//
//     const { rows } = await p.query(
//       `SELECT number, tag_sha, published_at, window_id, blessed_at
//        FROM settlements ORDER BY number DESC`);
//
// with 1.0's own git half —
//
//     const rows = (await import("./settlements.mjs")).readSettlementTags(WORLD_CLONE)
//       .map((r) => ({ number: Number(r.tag.slice("settlement/S".length)), tag_sha: r.sha,
//                      published_at: r.date, window_id: null, blessed_at: null }));
//
// and, with WORLD_CLONE at the shared world clone (S71 newest), 10 of these 12
// go red — among them:
//
//   not ok - THE PLANTED ROW: a settlement that exists only in the store reaches the answer
//       the twin did not see `settlement/S9001` — it is reading a tree
//   not ok - THE QUERY COUNT: the door opened `settlements`
//       a door that read the tree would open no `settlements`
//   not ok - `sha` is the WHOLE blessed commit, and 1.0's `--short` is its prefix
//       (the tree answers `1984062f`, eight characters)
//   not ok - each row carries `window` and `blessed_at` beside 1.0's three fields
//       (the tree has neither)
//
// The two that stay green are the two that do not ask the door: the shared
// parser's own refusals, and the viewer's guard (a tree read still satisfies
// `body.current || Array.isArray(body.recent)` — a shape check, by design).
//
// Restored with `git checkout -- src/world2-serve.mjs`; `git diff --exit-code`
// clean; 12/12 green again.
//
// Run: node --test test/world2-settlements-reads.test.mjs

import { test, before, after } from "node:test";
import assert from "node:assert/strict";

import { settlementsFrom, parseSettlementTags } from "../src/settlements.mjs";

const env = { pg: process.env.WORLD2_PG, url: process.env.WORLD2_PG_URL };
before(() => {
  process.env.WORLD2_PG = "1";
  process.env.WORLD2_PG_URL = "postgres://settlements-reads-test/none";
});
after(() => {
  if (env.pg == null) delete process.env.WORLD2_PG; else process.env.WORLD2_PG = env.pg;
  if (env.url == null) delete process.env.WORLD2_PG_URL; else process.env.WORLD2_PG_URL = env.url;
});

const { world2Serve } = await import("../src/world2-serve.mjs");

// ── the fixture store ───────────────────────────────────────────────────────
//
// Real rows, measured on the shared world clone 2026-09-17 (`git for-each-ref
// refs/tags/settlement/S<n> --format='%(*objectname) %(*committerdate:iso-strict)
// %(taggerdate:iso-strict)'`), so the fixture is the record and not a story
// about it. `published_at` and `blessed_at` arrive as `Date`s, which is what
// node-pg hands back for a timestamptz.

const row = (number, tag_sha, published_at, window_id, blessed_at) =>
  ({ number, tag_sha, published_at: new Date(published_at), window_id, blessed_at: blessed_at == null ? null : new Date(blessed_at) });

const S71 = row(71, "1984062faa76f0b835f316ca0f60a47676a98c5b", "2026-09-17T05:46:08Z", 194, "2026-09-17T02:08:49-04:00");
const S70 = row(70, "42e3d04f8cdceb8d3a21cd26214b9b92fca219e3", "2026-09-15T05:46:03Z", 190, "2026-09-15T02:07:52-04:00");
const S69 = row(69, "ddd495a1c903dfdba7d0ec158b7ed3eef20db011", "2026-09-13T17:46:05Z", 187, "2026-09-13T14:09:53-04:00");
// Keeper-era: committed from an EDT machine, so 1.0 prints these with `-04:00`.
// The store holds the instant; the window is null because the store's first
// window (150) opened 2026-08-26, a month after these.
const S2  = row(2,  "eeef9ae3a2a5a0be0fc23b33f01bf8a96dd43dc6", "2026-07-29T08:11:48-04:00", null, "2026-07-29T08:13:40-04:00");
const S1  = row(1,  "f0bf94e4f157d165a39e764536609ba395d6a28c", "2026-07-28T16:08:58-04:00", null, "2026-07-28T16:15:42-04:00");
// ⚑ THE PLANTED ROW — in the table, in no clone, in no fold.
const PLANTED = row(9001, "9001000000000000000000000000000000009001", "2099-01-01T00:00:00Z", null, null);

// Deliberately NOT in number order, and with the planted row in the middle:
// the store's row order is nobody's promise, and the twin must not inherit it.
const ROWS = [S70, S2, PLANTED, S71, S1, S69];

function fixturePool({ rows = ROWS } = {}) {
  const asked = [];
  const answer = async (sql, params) => {
    asked.push({ sql: String(sql).replace(/\s+/g, " ").trim(), params });
    if (/FROM settlements/i.test(sql)) return { rows };
    return { rows: [] };
  };
  return { asked, query: answer, connect: async () => ({ query: answer, release: () => {} }) };
}

const door = async (opts = {}) => {
  const p = fixturePool(opts);
  const r = await world2Serve("/world2/settlements", new URLSearchParams(), { p });
  return { p, code: r.code, body: r.body };
};

// The lines 1.0's git half would have produced for these rows, so the oracle
// is `settlementsFrom` over exactly what the twin is handed. `date` is the
// twin's own rendering rule (UTC, whole seconds) — asserted separately below
// against the instant 1.0 would print.
const isoZ = (d) => new Date(d).toISOString().replace(/\.\d{3}Z$/, "Z");
const linesOf = (rows) => rows.map((r) => ({ tag: `settlement/S${r.number}`, sha: r.tag_sha, date: isoZ(r.published_at) }));
const strip = (s) => (s == null ? null : (({ window, blessed_at, ...rest }) => rest)(s));

// ═════════════════════════════════════════════════════════════════════════════
// 1 · THE DECISIONS ARE 1.0'S
// ═════════════════════════════════════════════════════════════════════════════

test("the twin's {current, recent} IS `settlementsFrom` over the store's rows — the rules are imported, not copied", async () => {
  const { body } = await door();
  const oracle = settlementsFrom(linesOf(ROWS));
  assert.deepEqual(strip(body.current), oracle.current);
  assert.deepEqual(body.recent.map(strip), oracle.recent);
});

test("ordered by NUMBER, newest first — not by the order the store handed rows over, not by date", async () => {
  const { body } = await door();
  const ns = body.recent.map((s) => s.n);
  assert.deepEqual(ns, [...ns].sort((a, b) => b - a), "recent is not in descending number order");
  assert.equal(ns[0], 9001, "the highest number is first, whatever row the store returned first");
  // and the fixture really did hand them over shuffled, or this proved nothing
  assert.notDeepEqual(ROWS.map((r) => r.number), [...ROWS.map((r) => r.number)].sort((a, b) => b - a));
});

test("`current` is the HIGHEST number that landed, and a gap is left as the refusal it was", async () => {
  const { body } = await door({ rows: [S71, S69] });          // S70 missing on purpose
  assert.equal(body.current.n, 71);
  assert.deepEqual(body.recent.map((s) => s.n), [71, 69], "nothing invented S70 to fill the gap");
});

test("the recent cap is 1.0's own, applied by 1.0's own function", async () => {
  const many = Array.from({ length: 30 }, (_, i) => row(100 + i, "a".repeat(40), "2026-09-01T00:00:00Z", null, null));
  const { body } = await door({ rows: many });
  const oracle = settlementsFrom(linesOf(many));
  assert.equal(body.recent.length, oracle.recent.length);
  assert.ok(body.recent.length < many.length, "a cap that never binds proves nothing");
  assert.equal(body.current.n, 129, "current is the newest even when the list is cut");
});

test("a row 1.0's parser would not count is not counted here either", () => {
  // Pinned on the shared parser rather than on the twin: the twin renders every
  // store row as `settlement/S<number>`, so the only way a row could fail this
  // parse is a negative or non-integer number — which the table's CHECK refuses.
  // This asserts the oracle the twin is handed to still refuses what it refused.
  assert.deepEqual(parseSettlementTags([{ tag: "settlement/S-1", sha: "x", date: "y" }]), []);
  assert.deepEqual(parseSettlementTags([{ tag: "release/2026-w39", sha: "x", date: "y" }]), []);
});

// ═════════════════════════════════════════════════════════════════════════════
// 2 · THE DOOR READ THE STORE — the leg an equality cannot supply
// ═════════════════════════════════════════════════════════════════════════════

test("THE PLANTED ROW: a settlement that exists only in the store reaches the answer", async () => {
  const { body } = await door();
  assert.ok(body.recent.some((s) => s.n === 9001),
    "the twin did not see `settlement/S9001` — it is reading a tree");
  assert.equal(body.current?.n, 9001, "the planted row is the highest number and must be `current`");
});

test("THE QUERY COUNT: the door opened `settlements`", async () => {
  const { p } = await door();
  assert.ok(p.asked.some((a) => /FROM settlements/i.test(a.sql)), "a door that read the tree would open no `settlements`");
});

// ═════════════════════════════════════════════════════════════════════════════
// 3 · THE TWO REPRESENTATIONS THAT DIFFER FROM 1.0, EACH SAID OUT LOUD
// ═════════════════════════════════════════════════════════════════════════════

test("`date` is the crossing's push as the SAME INSTANT 1.0 prints, rendered in UTC with whole seconds", async () => {
  const { body } = await door();
  const s1 = body.recent.find((s) => s.n === 1);
  // 1.0 prints `%cI` in the committer's own offset: 2026-07-28T16:08:58-04:00.
  assert.equal(s1.date, "2026-07-28T20:08:58Z");
  assert.equal(Date.parse(s1.date), Date.parse("2026-07-28T16:08:58-04:00"), "not the same instant 1.0 serves");
  // and a box-era row is byte-equal to `%cI`, because that committer sat on UTC
  const s71 = body.recent.find((s) => s.n === 71);
  assert.equal(s71.date, "2026-09-17T05:46:08Z");
  for (const s of body.recent) assert.match(s.date, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/, `${s.date} carries milliseconds or an offset`);
});

test("`sha` is the WHOLE blessed commit, and 1.0's `--short` is its prefix", async () => {
  const { body } = await door();
  const s71 = body.recent.find((s) => s.n === 71);
  assert.match(s71.sha, /^[0-9a-f]{40}$/);
  // `git rev-parse --short settlement/S71^{commit}` on the shared clone, 2026-09-17
  assert.ok(s71.sha.startsWith("1984062f"), "1.0's abbreviation is not a prefix of the store's commit");
});

// ═════════════════════════════════════════════════════════════════════════════
// 4 · WHAT THE STORE KNOWS THAT THE TAG LIST DOES NOT
// ═════════════════════════════════════════════════════════════════════════════

test("each row carries `window` and `blessed_at` beside 1.0's three fields; null where the store has none", async () => {
  const { body } = await door();
  const s71 = body.recent.find((s) => s.n === 71);
  assert.deepEqual(Object.keys(s71).sort(), ["blessed_at", "date", "n", "sha", "window"]);
  assert.equal(s71.window, 194, "the crossing's own journal line: `docket: window 194 locked at 2026-09-17T05:45:45.550Z`");
  assert.equal(s71.blessed_at, "2026-09-17T06:08:49Z", "the tag object's date — the keeper's bless, ~20 min after the push");
  assert.ok(Date.parse(s71.blessed_at) > Date.parse(s71.date), "the bless follows the push, never precedes it");
  const s1 = body.recent.find((s) => s.n === 1);
  assert.equal(s1.window, null, "S1 predates the store's first window and must say so with null, not a guess");
  assert.equal(body.current.window, null, "`current` carries the store fields too");
});

test("the viewer's own guard holds on this body: `body.current || Array.isArray(body.recent)`", async () => {
  const { body, code } = await door();
  assert.equal(code, 200);
  assert.ok(body.current || Array.isArray(body.recent));
  assert.match(body.what, /settlements-backfill\.mjs/, "the freshness sentence names the writer that is its source");
});

test("an EMPTY table answers honestly: current null, recent [] — a number is never invented", async () => {
  const { body } = await door({ rows: [] });
  assert.equal(body.current, null);
  assert.deepEqual(body.recent, []);
});
