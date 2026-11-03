// town-discovery-plan.test.mjs — a discovery page's WORK is bounded, measured
// in the plan of the statement the door actually sends (POS-497).
//
//   node --import ./test/helpers/sparse-guard.mjs --test test/town-discovery-plan.test.mjs   (a pool tree's Postgres, or EMBEDDED_PG_DIR)
//   DISCOVERY_PLAN_DUPLICATES=<n> sets the duplicate run (default 1,000,000)
//
// LAW (Rivet's brief, POS-497, 2026-11-03): "Dev EXPLAIN ANALYZE/buffers/loops/
// rows removed + body/response bytes, scaling fixed candidate window against
// large history/duplicates/giant body. Counter-mutant returns same 64
// pieces/128 candidates but secretly COUNTs/scans/sorts/parses history: gate
// MUST red. Row returns alone aren't work proof."
//
// THE INSTRUMENT. The office_api reader is given a client that records what it
// sends; the one statement that walks is then run again under EXPLAIN (ANALYZE,
// BUFFERS) with the same parameters. The gate reads the plan: every row each
// town_* table handed any node (rows, rows removed by a filter or a recheck,
// times loops), every sequential scan, every sort's input and the buffers
// touched. On a small store each counter-mutant (the same statement made to
// count, sort or read history beside the same answer) must return the same rows
// and red the gate, while the real statement passes. Then the store grows a
// hundredfold, with a giant author and a run of duplicate letters, and the real
// statement's work must not grow. (The mutants run small because a sorting
// mutant over the grown store would cost minutes and prove nothing more.)
//
// Every row is invented, written straight into discovery's tables by
// generate_series as the ingest's own pen (law_ingester).

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { startStore } from "./helpers/embedded-store.mjs";
import { DISCOVERY_LIMITS as L, ZERO_REVISION } from "../src/town-discovery.mjs";
import * as store from "../src/town-index-store.mjs";

const DUPLICATES = Number(process.env.DISCOVERY_PLAN_DUPLICATES ?? 1_000_000);
let s = null, w = null, api = null, owner = null, skip = false;

before(async () => {
  s = await startStore({ db: "town_discovery_plan" });
  if (s.skip) { skip = s.skip; return; }
  w = await s.connect("law_ingester");
  api = await s.connect("office_api");
  owner = await s.connect("world2_owner");
});

after(async () => {
  for (const c of [w, api, owner]) if (c) await c.end().catch(() => {});
  if (s?.stop) await s.stop();
});

// ── the store, small and then grown ──────────────────────────────────────────

/** Residents and their pieces: `n` authors `<prefix>NNNNN`, `per` pieces each, the word "needle" only in each author's last piece when `needleLast`. */
const AUTHORS = (prefix, n, per, { needleLast = false } = {}) => w.query(`
  WITH a AS (SELECT $1 || lpad(i::text, 5, '0') AS h FROM generate_series(1, $2::int) i)
  INSERT INTO town_discovery_chunks (id, author, source_kind, source_id, ordinal, piece, digest)
  SELECT 'letter:' || o || ':' || a.h || '-l', a.h, 'letter', a.h || '-l', o,
         CASE WHEN $4::boolean AND o = $3::int - 1 THEN 'the needle is here ' ELSE 'hay ' END || repeat('lorem ', 20), md5(a.h || o)
    FROM a, generate_series(0, $3::int - 1) o`, [prefix, n, per, needleLast]);
const RESIDENTS = (prefix, n) => w.query(`
  INSERT INTO town_residents (handle, json, digest)
  SELECT $1 || lpad(i::text, 5, '0'), '{}', md5($1 || i) FROM generate_series(1, $2::int) i ON CONFLICT DO NOTHING`, [prefix, n]);
/** Edges `sender` -> `<prefix>NNNNN`, one letter each. */
const WRITES_TO = (sender, prefix, from, to) => w.query(`
  INSERT INTO town_letter_edges (id, letter_id, sender, recipient, digest)
  SELECT $1 || ':' || $2 || lpad(i::text, 5, '0') || ':' || $1 || '-' || i, $1 || '-' || i, $1, $2 || lpad(i::text, 5, '0'), md5($1 || i)
    FROM generate_series($3::int, $4::int) i`, [sender, prefix, from, to]);

// town_meta as the derivation writes it (src/town-index.mjs § deriveTownIndex): a closed set of ten keys
const META_KEYS = ["as_of", "town_path", "hydrated_counts", "docs", "stamps_minted", "stamps_tip", "quest_day", "quest_registry", "discovery_epoch", "discovery_revision"];

async function smallStore() {
  await w.query("INSERT INTO town_meta (key, value, digest) SELECT k, CASE k WHEN 'discovery_epoch' THEN '1' WHEN 'discovery_revision' THEN $2 ELSE repeat('v', 200) END, 'x' FROM unnest($1::text[]) k",
    [META_KEYS, ZERO_REVISION]);
  await w.query("INSERT INTO town_residents (handle, json, digest) VALUES ('ada', '{}', 'x'), ('bex', '{}', 'x')");
  await RESIDENTS("m", 200);
  await AUTHORS("m", 200, 10, { needleLast: true });
  await RESIDENTS("c", 1000);
  await WRITES_TO("ada", "c", 1, 1000);
  await w.query(`INSERT INTO town_letter_edges (id, letter_id, sender, recipient, digest)
    SELECT 'bex:c' || lpad(i::text, 5, '0') || ':bex-' || i, 'bex-' || i, 'bex', 'c' || lpad(i::text, 5, '0'), md5('bex' || i) FROM generate_series(1, 300, 10) i`);
  // history the walks must never read: letters with bodies
  await w.query(`INSERT INTO town_letters (id, from_h, to_h, json, digest)
    SELECT 'hist-' || i, 'ada', 'bex', json_build_object('id', 'hist-' || i, 'body', repeat('old words ', 50))::text, md5(i::text) FROM generate_series(1, 2000) i`);
  await owner.query("ANALYZE town_discovery_chunks, town_letter_edges, town_residents, town_meta, town_letters");
}

async function grow() {
  const t0 = Date.now();
  await RESIDENTS("aaa", 1);
  await AUTHORS("aaa", 1, 50_000);                       // a giant author, first in C order: fifty thousand pieces, no needle
  await RESIDENTS("w", 2000);
  await AUTHORS("w", 2000, 50, { needleLast: true });    // a hundred thousand more pieces
  await RESIDENTS("c", 20_000);
  await WRITES_TO("ada", "c", 1001, 20_000);
  await w.query(`INSERT INTO town_letter_edges (id, letter_id, sender, recipient, digest)
    SELECT 'ada:c00150:dup-' || i, 'dup-' || i, 'ada', 'c00150', md5('dup' || i) FROM generate_series(1, $1::int) i`, [DUPLICATES]);
  await w.query(`INSERT INTO town_letters (id, from_h, to_h, json, digest)
    SELECT 'hist-' || i, 'ada', 'bex', json_build_object('id', 'hist-' || i, 'body', repeat('old words ', 50))::text, md5(i::text) FROM generate_series(2001, 100000) i`);
  await owner.query("ANALYZE town_discovery_chunks, town_letter_edges, town_residents, town_meta, town_letters");
  return Date.now() - t0;
}

// ── the instrument ───────────────────────────────────────────────────────────

/** The page the real reader answers, and the walking statement it sent, captured. */
async function capture(args) {
  const sent = [];
  const q = { query: (text, params) => { sent.push({ text, params }); return api.query(text, params); } };
  const page = await store.discover(q, args);
  assert.equal(page.error, undefined, JSON.stringify(page));
  const walks = sent.filter((x) => /WITH RECURSIVE/.test(x.text));
  assert.equal(walks.length, 1, "one walking statement per page");
  return { page, walk: walks[0] };
}

const TABLES = ["town_discovery_chunks", "town_letter_edges", "town_residents", "town_meta", "town_letters", "town_homes"];

/** Run a statement under EXPLAIN ANALYZE in a READ ONLY transaction, as the door reads: its plan, and its rows. */
async function explain({ text, params }) {
  await api.query("BEGIN READ ONLY");
  try {
    const [{ "QUERY PLAN": [plan] }] = (await api.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${text}`, params)).rows;
    const rows = (await api.query(text, params)).rows;
    return { plan, rows };
  } finally { await api.query("ROLLBACK"); }
}

/** DISCOVERY_PLAN_DUMP=<dir> keeps every plan this file measures, by label, for a reader to check the gate's arithmetic. */
function dump(label, plan) {
  const dir = process.env.DISCOVERY_PLAN_DUMP;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${label.replace(/[^a-z0-9]+/gi, "-")}.json`), JSON.stringify(plan, null, 2));
}

/** What the plan did: rows each table handed any node, sequential scans, sorts' input, buffers. */
function workOf(plan) {
  const work = { rows: Object.fromEntries(TABLES.map((t) => [t, 0])), seqScans: [], sorted: 0, buffers: 0 };
  const visit = (n) => {
    const loops = n["Actual Loops"] ?? 0;
    const handed = ((n["Actual Rows"] ?? 0) + (n["Rows Removed by Filter"] ?? 0) + (n["Rows Removed by Index Recheck"] ?? 0)) * loops;
    if (TABLES.includes(n["Relation Name"])) {
      work.rows[n["Relation Name"]] += handed;
      // town_meta is the derivation's closed set of keys (META_KEYS), so a scan of it is bounded by construction; its rows are still counted
      if (n["Node Type"] === "Seq Scan" && loops > 0 && n["Relation Name"] !== "town_meta") work.seqScans.push(n["Relation Name"]);
    }
    // a sort's input is its outer child; its other children are init plans and subplans, counted where they read
    if (/Sort$/.test(n["Node Type"]) && loops > 0)
      work.sorted = Math.max(work.sorted, (n.Plans ?? []).filter((c) => c["Parent Relationship"] === "Outer").reduce((m, c) => m + (c["Actual Rows"] ?? 0) * (c["Actual Loops"] ?? 0), 0));
    for (const c of n.Plans ?? []) visit(c);
  };
  visit(plan.Plan);
  work.buffers = (plan.Plan["Shared Hit Blocks"] ?? 0) + (plan.Plan["Shared Read Blocks"] ?? 0);
  work.ms = plan["Execution Time"];
  return work;
}

// THE GATE, held to what the walk itself did (its rows, from the same
// statement). A text page reads one piece a step and one probe past the last,
// and probes the roll once per author it meets (an author's pieces are
// contiguous in the walk's order, and the probe runs only when the author
// changes); a common page seeks one recipient a step and one past the last, and
// probes the roll and the second person at most once a step, plus the two
// people. Two generation reads of town_meta's closed key set. Nothing else is
// touched, nothing but town_meta is scanned, and nothing larger than a page is
// sorted. Each cap is also inside the page's declared bound.
const SLACK = 4;
function gate(work, mode, walkRows) {
  const why = [];
  const meta = 2 * META_KEYS.length;
  const steps = walkRows.filter((r) => r.step != null);
  const authors = new Set(steps.map((r) => r.author)).size;
  assert.ok(steps.length <= (mode === "text" ? L.pieces_per_page : L.candidates_per_page), "the walk kept to its declared bound");
  const cap = mode === "text"
    ? { town_discovery_chunks: steps.length + 1, town_residents: authors, town_meta: meta, town_letter_edges: 0, town_letters: 0, town_homes: 0 }
    : { town_letter_edges: 2 * steps.length + 1, town_residents: steps.length + 2, town_meta: meta, town_discovery_chunks: 0, town_letters: 0, town_homes: 0 };
  for (const [t, max] of Object.entries(cap)) if (work.rows[t] > max + SLACK) why.push(`${t}: ${work.rows[t]} rows handed to the plan, bound ${max}`);
  if (work.seqScans.length) why.push(`sequential scans: ${work.seqScans.join(", ")}`);
  const page = mode === "text" ? L.pieces_per_page : L.candidates_per_page;
  if (work.sorted > page + SLACK) why.push(`a sort over ${work.sorted} rows`);
  return why;
}

/** One unique replacement in the captured statement, or the mutant is no mutant. */
function mutate(walk, from, to) {
  const parts = walk.text.split(from);
  assert.equal(parts.length, 2, `the mutant's anchor must occur once in the statement: ${from.slice(0, 80)}`);
  return { text: parts.join(to), params: walk.params };
}

const ASKS = [
  ["text, a word only in last pieces, from the start", { mode: "text", q: "needle" }],
  ["text, a word in nothing", { mode: "text", q: "no such word anywhere" }],
  ["common, ada and bex", { mode: "common_correspondents", people: ["ada", "bex"] }],
];

const small = {};

test("on a small store the real statements pass the gate, and every counter-mutant returns the same rows and reds it", async (t) => {
  if (skip) return t.skip(skip);
  await smallStore();
  for (const [label, args] of ASKS) {
    const { page, walk } = await capture(args);
    const { plan, rows } = await explain(walk);
    dump(`small ${label}`, plan);
    small[label] = { work: workOf(plan), page, walk };
    assert.deepEqual(gate(small[label].work, args.mode, rows), [], `${label} (small): ${JSON.stringify(small[label].work)}`);
  }
  const text = small[ASKS[0][0]].walk;
  const common = small[ASKS[2][0]].walk;
  const SEEK = `ORDER BY t.author COLLATE "C", t.source_kind COLLATE "C", t.source_id COLLATE "C", t.ordinal LIMIT 1) n`;
  const EDGE_SEEK = `ORDER BY e.sender COLLATE "C", e.recipient COLLATE "C" LIMIT 1) n`;
  const mutants = [
    ["text: a secret count of every piece", "text", text, (wk) => mutate(wk, "SELECT g.epoch, g.revision, w.step,", "SELECT g.epoch, g.revision, (SELECT count(*) FROM town_discovery_chunks) >= 0 AS secret, w.step,")],
    ["text: the seek sorted instead of read in index order", "text", text, (wk) => mutate(wk, SEEK, `ORDER BY (t.author || '') COLLATE "C", t.source_kind COLLATE "C", t.source_id COLLATE "C", t.ordinal LIMIT 1) n`)],
    ["text: history parsed beside the walk", "text", text, (wk) => mutate(wk, "SELECT g.epoch, g.revision, w.step,", "SELECT g.epoch, g.revision, (SELECT count(*) FROM town_letters l WHERE l.json::jsonb ? 'body') >= 0 AS secret, w.step,")],
    ["common: a secret count of the first person's letters", "common", common, (wk) => mutate(wk, "SELECT g.epoch, g.revision, p.a, p.b,", "SELECT g.epoch, g.revision, (SELECT count(DISTINCT e.recipient) FROM town_letter_edges e WHERE e.sender = $1::text) >= 0 AS secret, p.a, p.b,")],
    ["common: the recipient seek sorted instead of read in index order", "common", common, (wk) => mutate(wk, EDGE_SEEK, `ORDER BY (e.recipient || '') COLLATE "C" LIMIT 1) n`)],
  ];
  const strip = (rows) => rows.map(({ secret, ...r }) => r);
  for (const [label, mode, walk, make] of mutants) {
    const real = await explain(walk);
    const bent = await explain(make(walk));
    dump(`mutant ${label}`, bent.plan);
    assert.deepEqual(strip(bent.rows), strip(real.rows), `${label}: the mutant must return the same rows, or it proves nothing`);
    assert.deepEqual(gate(workOf(real.plan), mode, real.rows), [], `${label}: the real statement passes`);
    const why = gate(workOf(bent.plan), mode, real.rows);
    assert.ok(why.length > 0, `${label}: the gate must red on the mutant (its work: ${JSON.stringify(workOf(bent.plan))})`);
    console.log(`# mutant red: ${label}: ${why.join("; ")}`);
  }
});

const measured = {};

test("a page's work, measured in its plan, does not grow with the record: a giant author, a hundredfold more pieces and a run of duplicate letters", async (t) => {
  if (skip) return t.skip(skip);
  if (Object.keys(small).length !== ASKS.length) return t.skip("the small store's measurements did not complete");
  const grewMs = await grow();
  for (const [label, args] of ASKS) {
    const { page, walk } = await capture(args);
    const { plan, rows } = await explain(walk);
    dump(`grown ${label}`, plan);
    const work = workOf(plan);
    assert.deepEqual(gate(work, args.mode, rows), [], `${label} (grown): ${JSON.stringify(work)}`);
    const was = small[label].work;
    for (const tbl of TABLES)
      assert.ok(work.rows[tbl] <= was.rows[tbl] + SLACK, `${label}: ${tbl} handed ${work.rows[tbl]} rows grown, ${was.rows[tbl]} small: the work grew with the record`);
    // each seek descends one index; a bigger index is at most one level deeper, so a few blocks more per seek
    const seeks = args.mode === "text" ? L.pieces_per_page * 2 : L.candidates_per_page * 3;
    assert.ok(work.buffers <= was.buffers + seeks, `${label}: ${work.buffers} buffers grown, ${was.buffers} small`);
    const bytes = Buffer.byteLength(JSON.stringify(page));
    assert.ok(bytes <= L.response_bytes);
    measured[label] = { small: { rows: was.rows, buffers: was.buffers, ms: was.ms }, grown: { rows: work.rows, buffers: work.buffers, ms: work.ms },
      examined: page.examined, shown: page.shown, complete: page.complete, response_bytes: bytes };
  }
  const counts = (await w.query(`SELECT (SELECT count(*) FROM town_discovery_chunks)::int AS pieces, (SELECT count(*) FROM town_letter_edges)::int AS edges,
    (SELECT count(*) FROM town_letter_edges WHERE sender = 'ada' AND recipient = 'c00150')::int AS duplicates, (SELECT count(*) FROM town_letters)::int AS letters`)).rows[0];
  console.log(`# measured: grown in ${grewMs} ms to ${JSON.stringify(counts)}`);
  for (const [label, m] of Object.entries(measured)) console.log(`# measured: ${label}: ${JSON.stringify(m)}`);

  // the giant author first in C order: page one reads its bound of the giant's pieces and stops; it does not finish the author
  const first = (await capture({ mode: "text", q: "needle" })).page;
  assert.deepEqual([first.examined.pieces, first.shown, first.complete], [L.pieces_per_page, 0, false]);
  // and the duplicate run is one candidate: ada's first page walks c00001..c00128 past c00150's million letters only once, on page two
  const common = [];
  let cursor = null;
  for (let i = 0; i < 400; i++) {
    const p = (await capture({ mode: "common_correspondents", people: ["ada", "bex"], ...(cursor ? { cursor } : {}) })).page;
    common.push(p);
    if (p.complete) break;
    cursor = p.cursor;
  }
  assert.equal(common.reduce((n, p) => n + p.examined.candidates, 0), 20_000, "twenty thousand distinct recipients, each checked once, the duplicate run as one");
  assert.deepEqual(common.flatMap((p) => p.hits.map((h) => h.handle)),
    Array.from({ length: 30 }, (_, k) => `c${String(1 + 10 * k).padStart(5, "0")}`), "bex's thirty, once each, in C order");
});
