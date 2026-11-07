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
import { DISCOVERY_LIMITS as L, DISCOVERY_EPOCH, ZERO_REVISION, fingerprintAdd, fingerprintRemove, digestOfChunk } from "../src/town-discovery.mjs";
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
  await w.query("INSERT INTO town_meta (key, value, digest) SELECT k, CASE k WHEN 'discovery_epoch' THEN $3 WHEN 'discovery_revision' THEN $2 ELSE repeat('v', 200) END, 'x' FROM unnest($1::text[]) k",
    [META_KEYS, ZERO_REVISION, DISCOVERY_EPOCH]);
  await w.query("INSERT INTO town_residents (handle, json, digest) VALUES ('ada', '{}', 'x'), ('bex', '{}', 'x')");
  await RESIDENTS("m", 200);
  await AUTHORS("m", 200, 10, { needleLast: true });
  // a rare word, in two pieces of two authors (the churn measurement's term, POS-497 FIX 5)
  await w.query(`INSERT INTO town_discovery_chunks (id, author, source_kind, source_id, ordinal, piece, digest) VALUES
    ('letter:10:m00100-l', 'm00100', 'letter', 'm00100-l', 10, 'a rare quokka appears here', 'x'),
    ('letter:10:m00150-l', 'm00150', 'letter', 'm00150-l', 10, 'another quokka, rarer still', 'x')`);
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

// ── the churn harness (POS-497 FIX 5) ────────────────────────────────────────
//
// LAW (Rivet's FIX packet): "walk a rare term to completion with stable source;
// record pages, bytes, wall, candidate/heap/DB work. Repeat with a controlled
// relevant public change during a walk and a repeated public-edit cadence;
// record resets, forward progress/completion and honest starvation if it never
// stabilizes. Private-only changes must not reset public cursor." And: "I accept
// for slice1 that an exact CURRENT-generation walk has no eventual-completion
// guarantee under continuous relevant edits."
//
// A walk is driven page by page through the real reader. A "public edit" moves
// the generation the way the ingest's writeDiscovery moves it (one piece
// replaced: its digest removed, the new one added, in one transaction, by the
// real fingerprint functions), so the reader meets exactly the cursor-versus-
// generation case a real ingest makes. The real ingest's own private-only and
// public transitions are test/town-discovery-ingest.test.mjs; this file measures
// what they cost a long walk.

const EDIT_ID = "letter:0:zedit-l";
const editRow = (n) => [EDIT_ID, "zedit", "letter", "zedit-l", 0, `an edit, number ${n}`];
let editNumber = 0;
/** A relevant public change: one piece replaced, the revision moved by its remove and its add. */
async function publicEdit() {
  const n = ++editNumber;
  await w.query("BEGIN");
  try {
    let rev = (await w.query("SELECT value FROM town_meta WHERE key = 'discovery_revision'")).rows[0].value;
    const old = (await w.query("SELECT id, author, source_kind, source_id, ordinal, piece FROM town_discovery_chunks WHERE id = $1", [EDIT_ID])).rows[0];
    if (old) { rev = fingerprintRemove(rev, [digestOfChunk([old.id, old.author, old.source_kind, old.source_id, old.ordinal, old.piece])]); await w.query("DELETE FROM town_discovery_chunks WHERE id = $1", [EDIT_ID]); }
    const row = editRow(n);
    await w.query("INSERT INTO town_discovery_chunks (id, author, source_kind, source_id, ordinal, piece, digest) VALUES ($1, $2, $3, $4, $5, $6, 'x')", row);
    rev = fingerprintAdd(rev, [digestOfChunk(row)]);
    await w.query("DELETE FROM town_meta WHERE key = 'discovery_revision'");
    await w.query("INSERT INTO town_meta (key, value, digest) VALUES ('discovery_revision', $1, 'x')", [rev]);
    await w.query("COMMIT");
    return true;
  } catch (e) { await w.query("ROLLBACK").catch(() => {}); throw e; }
}
/** A private-only change: a resident's card. Discovery reads no card, so the revision must not move (the ingest test holds this through the real ingest). */
let privateNumber = 0;
const privateEdit = async () => { await owner.query("UPDATE town_residents SET json = $1 WHERE handle = 'ada'", [JSON.stringify({ private_edit: ++privateNumber })]); return true; };

/**
 * One ask walked page by page (to its end, or `maxPages`), through the real
 * reader: what the walk cost, and what edits made to the record did to it.
 * `edit` runs after every `editEvery` pages. `explainEvery` > 0 plans every
 * Nth page's statement under EXPLAIN (ANALYZE, BUFFERS): those pages' buffers
 * and rows handed to the plan are MEASURED; the walk's totals are then the
 * sampled mean times its pages (an estimate, labelled so).
 */
async function walkOf(args, { maxPages = 100_000, editEvery = Infinity, edit = null, explainEvery = 0 } = {}) {
  const m = { pages: 0, bytes: 0, examined: 0, resets: 0, completed: false, hits: [], run: 0, longestRun: 0, edits: 0, sampled: 0, buffers: 0, rowsHanded: 0, planMs: 0, wallMs: 0, maxPageBytes: 0, maxExamined: 0 };
  let cursor = null, last = null, overhead = 0;
  const q = { query: (text, params) => { if (/WITH RECURSIVE/.test(text)) last = { text, params }; return api.query(text, params); } };
  const t0 = performance.now();
  while (m.pages < maxPages) {
    const page = await store.discover(q, { ...args, ...(cursor ? { cursor } : {}) });
    assert.equal(page.error, undefined, JSON.stringify(page));
    const bytes = Buffer.byteLength(JSON.stringify(page));
    assert.ok(bytes <= L.response_bytes, "a page never weighs past its bound");
    m.pages++; m.bytes += bytes; m.maxPageBytes = Math.max(m.maxPageBytes, bytes);
    const read = page.examined.pieces ?? page.examined.candidates;
    m.examined += read; m.maxExamined = Math.max(m.maxExamined, read);
    for (const h of page.hits) m.hits.push(h.handle);
    if (page.reset) { m.resets++; m.longestRun = Math.max(m.longestRun, m.run); m.run = 0; }
    m.run++;
    if (explainEvery && m.pages % explainEvery === 0 && last) {
      const s0 = performance.now();
      const { plan } = await explain(last);
      const work = workOf(plan);
      m.sampled++; m.buffers += work.buffers; m.rowsHanded += Object.values(work.rows).reduce((a, b) => a + b, 0); m.planMs += work.ms;
      overhead += performance.now() - s0;
    }
    if (page.complete) { m.completed = true; break; }
    cursor = page.cursor;
    if (edit && m.pages % editEvery === 0 && await edit()) m.edits++;
  }
  m.longestRun = Math.max(m.longestRun, m.run);
  m.wallMs = Math.round(performance.now() - t0 - overhead);
  return m;
}
const brief = (label, m) => {
  const per = m.sampled ? { buffers_per_page: +(m.buffers / m.sampled).toFixed(1), rows_handed_per_page: +(m.rowsHanded / m.sampled).toFixed(1), plan_ms_per_page: +(m.planMs / m.sampled).toFixed(2), sampled_pages: m.sampled } : {};
  console.log(`# measured: walk ${label}: ${JSON.stringify({ pages: m.pages, completed: m.completed, bytes: m.bytes, max_page_bytes: m.maxPageBytes, examined: m.examined, max_examined: m.maxExamined, wall_ms: m.wallMs, resets: m.resets, edits: m.edits, longest_run_pages: m.longestRun, hits: m.hits.length, ...per })}`);
};
const walks = {};

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

  // the baseline walks (POS-497 FIX 5): a rare word, and the common walk, each to its end on this small store, every page planned
  walks.small = {
    text: await walkOf({ mode: "text", q: "quokka" }, { explainEvery: 1 }),
    common: await walkOf({ mode: "common_correspondents", people: ["ada", "bex"] }, { explainEvery: 1 }),
  };
  brief("text, a rare word, small store", walks.small.text);
  brief("common, ada and bex, small store", walks.small.common);
  assert.deepEqual([walks.small.text.completed, walks.small.text.hits], [true, ["m00100", "m00150"]]);
  assert.deepEqual([walks.small.common.completed, walks.small.common.hits.length], [true, 30]);
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

// ── walk progress and churn on the grown store (POS-497 FIX 5) ───────────────
//
//   DISCOVERY_CHURN=full               also runs the text walk's churn scenarios to their ends (about 10,000 more pages)
//   DISCOVERY_CHURN_EXPLAIN_EVERY=<n>  plans every nth page (default 20; 1 plans them all)
//
// What this holds, and what it only measures. HELD: a walk over a stable source
// completes in the pages the record needs and no more; a relevant public change
// resets it exactly once and the walk then starts again from its beginning; a
// private-only change resets nothing; and a record that changes more often than
// the walk is long never lets it finish (the accepted limit of slice one: the
// reset is announced each time, nothing pretends the old pages still stand, and
// nothing serves the old record). MEASURED (printed as `# measured:`): pages,
// bytes, wall time, rows read and buffers, for the grown store.

test("progress and churn on the grown store: a rare word walked to completion, then with a public change in the middle, a private one, and a steady cadence of public edits", async (t) => {
  if (skip) return t.skip(skip);
  if (!walks.small || !Object.keys(measured).length) return t.skip("the small and grown measurements did not complete");
  const full = process.env.DISCOVERY_CHURN === "full";
  const every = Number(process.env.DISCOVERY_CHURN_EXPLAIN_EVERY ?? 20);
  const TEXT = { mode: "text", q: "quokka" }, COMMON = { mode: "common_correspondents", people: ["ada", "bex"] };
  const pieces = (await w.query("SELECT count(*)::int n FROM town_discovery_chunks")).rows[0].n;
  const near = (got, want, slack, what) => assert.ok(Math.abs(got - want) <= slack, `${what}: ${got}, expected ${want} (±${slack})`);
  const once = () => { let done = false; return async () => (done ? false : (done = true, publicEdit())); };

  // ── stable source: the walk to completion ──
  const text = await walkOf(TEXT, { explainEvery: every });
  brief(`text, a rare word, grown store (${pieces} pieces)`, text);
  assert.deepEqual([text.completed, text.resets, text.hits], [true, 0, ["m00100", "m00150"]]);
  near(text.pages, Math.ceil(pieces / L.pieces_per_page), 1, "a stable walk reads the record in bounded pages, no more");
  assert.ok(text.maxExamined <= L.pieces_per_page);
  near(text.pages / walks.small.text.pages, pieces / 2002, pieces / 2002 * 0.05, "and its length is the small walk's, scaled by the record");
  const common = await walkOf(COMMON, { explainEvery: every });
  brief("common, ada and bex, grown store", common);
  assert.deepEqual([common.completed, common.resets, common.hits.length, common.examined], [true, 0, 30, 20_000], "twenty thousand distinct recipients checked once each, the million duplicates as one step");
  near(common.pages, Math.ceil(20_000 / L.candidates_per_page), 1, "common pages");

  // ── a private-only change: no reset, and the walk is no longer ──
  const priv = await walkOf(COMMON, { editEvery: 50, edit: privateEdit });
  brief("common, a private-only edit every 50 pages", priv);
  assert.deepEqual([priv.completed, priv.resets, priv.pages, priv.edits >= 2], [true, 0, common.pages, true], "a private-only change resets nothing");
  const privText = await walkOf(TEXT, { editEvery: 100, edit: privateEdit, maxPages: 250 });
  brief("text, a private-only edit every 100 pages, first 250 pages", privText);
  assert.deepEqual([privText.resets, privText.edits, privText.longestRun], [0, 2, 250]);

  // ── one relevant public change in the middle: one reset, then a whole walk again ──
  const gen0 = (await w.query("SELECT value FROM town_meta WHERE key = 'discovery_revision'")).rows[0].value;
  const mid = await walkOf(COMMON, { editEvery: 60, edit: once() });
  brief("common, one public edit at page 60", mid);
  assert.deepEqual([mid.completed, mid.resets, mid.edits, mid.hits.length], [true, 1, 1, 60], "one reset; the walk starts again from its beginning and completes (bex's thirty are on the first pages, so they come twice: before the edit and again after it)");
  near(mid.pages, 60 + common.pages, 1, "the 60 pages before the edit are spent; the walk after it is the whole walk");
  near(mid.longestRun, common.pages, 1, "and the progress that counts is the final, whole run");
  assert.notEqual((await w.query("SELECT value FROM town_meta WHERE key = 'discovery_revision'")).rows[0].value, gen0, "the edit moved the generation");
  const midText = await walkOf(TEXT, { editEvery: 100, edit: once(), maxPages: full ? 100_000 : 110 });
  brief(`text, one public edit at page 100${full ? "" : ", first 110 pages"}`, midText);
  assert.equal(midText.resets, 1, "the page after the edit is a reset");
  if (full) {
    assert.deepEqual([midText.completed, midText.hits], [true, ["m00100", "m00150"]]);
    near(midText.pages, 100 + text.pages, 2, "text: 100 pages spent, then the whole walk again");
  } else assert.equal(midText.completed, false);

  // ── a steady cadence of public edits: a walk of P pages completes if and only if the record holds still for P pages ──
  const P = common.pages;
  const late = await walkOf(COMMON, { editEvery: P + 1, edit: publicEdit, maxPages: 4 * P });
  brief(`common, an edit every ${P + 1} pages (the walk is ${P})`, late);
  assert.deepEqual([late.completed, late.resets, late.edits], [true, 0, 0], "an edit later than the walk's last page never comes");
  const tight = await walkOf(COMMON, { editEvery: P - 1, edit: publicEdit, maxPages: 4 * P });
  brief(`common, an edit every ${P - 1} pages (the walk is ${P}), 4x the walk's pages allowed`, tight);
  assert.equal(tight.completed, false, "STARVATION: an edit one page before the walk would end resets it every time; it never finishes");
  assert.deepEqual([tight.pages, tight.resets, tight.longestRun], [4 * P, tight.edits, P - 1], "each edit is followed by a reset, and the longest run of progress is the cadence");
  assert.equal(tight.hits.length > 0, true, "(pages before each reset still returned their hits; none of them is a verdict on the walk)");
  const half = await walkOf(COMMON, { editEvery: 50, edit: publicEdit, maxPages: 4 * P });
  brief("common, an edit every 50 pages, 4x the walk's pages allowed", half);
  assert.deepEqual([half.completed, half.resets, half.longestRun], [false, half.edits, 50]);
  if (full) {
    const Pt = text.pages;
    const textHalf = await walkOf(TEXT, { editEvery: Math.floor(Pt / 2), edit: publicEdit, maxPages: Pt + Math.floor(Pt / 2) + 10 });
    brief(`text, an edit every ${Math.floor(Pt / 2)} pages (the walk is ${Pt}), ${Pt + Math.floor(Pt / 2) + 10} pages allowed`, textHalf);
    assert.deepEqual([textHalf.completed, textHalf.resets, textHalf.longestRun], [false, textHalf.edits, Math.floor(Pt / 2)], "text starves the same way");
    const textLate = await walkOf(TEXT, { editEvery: Pt + 1, edit: publicEdit });
    brief(`text, an edit every ${Pt + 1} pages`, textLate);
    assert.deepEqual([textLate.completed, textLate.resets], [true, 0]);
  }
});
