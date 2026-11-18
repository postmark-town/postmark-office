// pos-1072-search.test.mjs — POS-1072: search's four statements fold ASCII case with `lower(x COLLATE "C")`, the same fold as before, at a fraction of the cost.
//
// WHAT WAS MEASURED (local, run-heavy, whole tree 2G/no-swap, PG 18.4 C.UTF-8; scripts and raw output in `/var/tmp/pos1072-instrument/`). On an index built from the
// pinned town-clone (26,181 letters, 53.5M json chars; 381 residents, 53.9M chars) each of search's four statements took 17-62 s; production's are 16-23 s each, 56-76 s a
// call, held inside the pen's READ ONLY transaction. The LIKE is not the cost: `translate(json, 'A-Z', 'a-z')` alone took 66.4 s over the letters, the LIKE over the raw text
// 1.4 s. A trigram GIN index on the translate expression did not fix it (the recheck folds every candidate again: 12-40 s for ordinary terms; two-character terms are full
// scans; 68-75 s per index build; a 500-row UPDATE 6.2 s against 0.16 s) and is a production migration. `lower(x COLLATE "C")` is the same fold (Postgres's byte-wise ASCII
// lower-case under the C collation) and cost 0.7 s for the fold alone and 0.09-0.9 s per statement, with the same counts and the same ordered row sets on the terms compared.
//
// THE FALSIFIERS. § 1 is the CAUSE: the statements search sends carry no `translate(` fold and fold with `lower(... COLLATE "C")` (red on the translate statements, which is
// what main sent). § 2 is the ANSWER: for a corpus built from every ASCII character and the non-ASCII case pairs that a locale-aware fold would wrongly match (É/é, İ, Kelvin sign,
// ẞ/ß, Σ/σ/ς) and the characters LIKE treats specially (% _ \), search's counts and rows equal the OLD predicate's (kept here, verbatim, as the oracle) for every term. § 3 is the
// COST, relative so it holds on any machine: the same predicate over wide rows is at least 8 times cheaper than translate's.
//
//   node --test test/pos-1072-search.test.mjs

import test, { after, before } from "node:test";
import assert from "node:assert/strict";

import { fixtureTown, put } from "./fixture.mjs";
import { startStore } from "./helpers/embedded-store.mjs";
import { seedTownIndex } from "./helpers/index-to-store.mjs";
import * as store from "../src/town-index-store.mjs";

const UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ", LOWER = "abcdefghijklmnopqrstuvwxyz";
// THE ORACLE: the predicate main sent, verbatim.
const oldLike = (col, param) => `translate(${col}, '${UPPER}', '${LOWER}') LIKE translate(${param}, '${UPPER}', '${LOWER}') ESCAPE ''`;

// the words a locale-aware fold would fold and sqlite's LIKE does not, and the characters LIKE treats specially
const TRICKY = ["Éclair", "éclair", "İstanbul", "istanbul", "Kelvin K sign", "STRASSE", "Straße", "ẞtra", "ΣΊΣΥΦΟΣ", "σίσυφος", "ς", "100% sure", "under_score", "back\\slash", "MiXeD CaSe", "ÀÉÎÕÜ"];

let s = null, skip = false, api = null, own = null;

before(async () => {
  s = await startStore({ db: "pos1072_search" });
  if (s.skip) { skip = s.skip; return; }
  const db = fixtureTown();
  TRICKY.forEach((word, i) => {
    const id = `tricky-${String(i).padStart(2, "0")}`;
    put(db, "letters", { id, from_h: "limen", to_h: "wright", date: "2026-07-03", thread: null, box: "inbox", owner: "wright", path: `WHITE_PAGES/wright/inbox/${id}.md`,
      json: JSON.stringify({ id, from: "limen", to: "wright", date: "2026-07-03", box: "inbox", body: `a note about ${word}` }), delivered_at: "2026-07-03T08:00:00.000Z" });
    put(db, "residents", { handle: `t${String(i).padStart(2, "0")}-${word.slice(0, 3).toLowerCase()}`, json: JSON.stringify({ handle: `t${i}`, address: { data: { note: `lives near ${word}` } } }) });
  });
  const w = await s.connect("law_ingester");
  await seedTownIndex(w, db);
  await w.end();
  api = await s.connect("office_api");
  own = await s.connect("world2_owner");
});

after(async () => {
  if (api) await api.end().catch(() => {});
  if (own) await own.end().catch(() => {});
  if (s?.stop) await s.stop();
});

/** A client that keeps every statement it is asked. */
const spy = (c) => { const sql = []; return { sql, query: (text, params) => { sql.push(String(typeof text === "string" ? text : text.text)); return c.query(text, params); } }; };

test("§ 1 the cause: search's statements fold with lower(x COLLATE \"C\"), and none with translate", async (t) => {
  if (skip) return t.skip(skip);
  const c = spy(api);
  await store.search(c, "Wright", {});
  const searches = c.sql.filter((q) => /town_letters|town_residents/.test(q));
  assert.ok(searches.length >= 4, `search sent ${searches.length} statements over the letters and residents (it sends four)`);
  const folded = searches.filter((q) => /LIKE/.test(q));
  assert.ok(folded.length >= 4, "the four statements are the LIKE ones");
  for (const q of folded) {
    assert.doesNotMatch(q, /translate\(/i, `a search statement still folds with translate: ${q.replace(/\s+/g, " ").slice(0, 160)}`);
    assert.match(q, /lower\(\w+ COLLATE "C"\) LIKE lower\(\$\d::text COLLATE "C"\) ESCAPE ''/, `a search statement does not fold with lower(... COLLATE "C"): ${q.replace(/\s+/g, " ").slice(0, 160)}`);
  }
});

test("§ 2 the answer: search's counts and rows are the old predicate's, for every term (ASCII case only, LIKE's % and _, no escape character)", async (t) => {
  if (skip) return t.skip(skip);
  const terms = ["wright", "WRIGHT", "Wright", "limen", "gap", "the", "a", "_", "%", "100%", "under_score", "under\\_score", "back\\slash", "\\", "mixed case", "MIXED", "éclair", "ÉCLAIR", "Éclair",
    "istanbul", "İSTANBUL", "İstanbul", "kelvin k", "KELVIN K", "strasse", "STRASSE", "straße", "ẞtra", "σίσυφος", "ΣΊΣΥΦΟΣ", "ς", "Σ", "àéîõü", "ÀÉÎÕÜ", "nothing-matches", "t0", "T0", "T1_", "zed"];
  const NEWEST = `COALESCE(delivered_at, date) COLLATE "C" DESC, id COLLATE "C"`;   // the letters' page order, as town-index-store.mjs states it
  let withHits = 0;
  for (const term of terms) {
    const pat = `%${term}%`;
    // the oracle: main's four statements, verbatim (translate fold), over the same rows
    const lettersTotal = Number((await api.query(`SELECT COUNT(*) AS n FROM town_letters WHERE ${oldLike("id", "$1")} OR ${oldLike("json", "$1")}`, [pat])).rows[0].n);
    const residentsTotal = Number((await api.query(`SELECT COUNT(*) AS n FROM town_residents WHERE ${oldLike("handle", "$1")} OR ${oldLike("json", "$1")}`, [pat])).rows[0].n);
    const residents = (await api.query(`SELECT handle FROM town_residents WHERE ${oldLike("handle", "$1")} OR ${oldLike("json", "$1")}
        ORDER BY CASE WHEN handle = $2 THEN 0 WHEN ${oldLike("handle", "$3")} THEN 1 WHEN ${oldLike("handle", "$1")} THEN 2 ELSE 3 END, handle COLLATE "C" LIMIT $4`, [pat, term, `${term}%`, 10])).rows.map((r) => r.handle);
    const page = (await api.query(`SELECT id FROM town_letters WHERE ${oldLike("id", "$1")} OR ${oldLike("json", "$1")} ORDER BY ${NEWEST} LIMIT $2 OFFSET $3`, [pat, 200, 0])).rows.map((r) => r.id);
    const got = await store.search(api, term, { limit: 200 });
    assert.equal(got.matches.letters, lettersTotal, `search "${term}": letters matched`);
    assert.equal(got.matches.residents, residentsTotal, `search "${term}": residents matched`);
    assert.deepEqual(got.residents, residents, `search "${term}": residents, in the old order`);
    assert.deepEqual(got.letters.map((l) => l.id), page, `search "${term}": the letters' page, in the old order`);
    if (lettersTotal) withHits += 1;
    if (residentsTotal) withHits += 1;
  }
  assert.ok(withHits > 20, `only ${withHits} term/bucket pairs matched anything: the corpus is not exercising the predicate`);
});

test("§ 3 the cost: over wide rows the same predicate is at least 8 times cheaper than translate's", async (t) => {
  if (skip) return t.skip(skip);
  await own.query("BEGIN");
  try {
    // 120 letters of ~24 KB, rolled back: the shape (a wide json column) that made translate the cost
    await own.query(`CREATE TEMP TABLE wide_letters ON COMMIT DROP AS SELECT 'w' || g AS id, repeat('The Quay Floods And The Lamplight Keeps Its Own Counsel. ', 420) || g AS json FROM generate_series(1, 120) g`);
    const time = async (like) => { const t0 = performance.now(); const r = await own.query(`SELECT COUNT(*) AS n FROM wide_letters WHERE ${like("id", "$1")} OR ${like("json", "$1")}`, ["%lamplight%"]); return { ms: performance.now() - t0, n: Number(r.rows[0].n) }; };
    const newLike = (col, p) => `lower(${col} COLLATE "C") LIKE lower(${p}::text COLLATE "C") ESCAPE ''`;
    await time(newLike); await time(oldLike);   // warm both
    const a = await time(oldLike), b = await time(newLike);
    assert.equal(a.n, 120);
    assert.equal(b.n, a.n, "the two predicates count differently");
    assert.ok(a.ms >= 8 * b.ms, `translate ${a.ms.toFixed(0)} ms vs lower(COLLATE "C") ${b.ms.toFixed(0)} ms: less than 8x (the fold was the cost)`);
  } finally { await own.query("ROLLBACK"); }
});
