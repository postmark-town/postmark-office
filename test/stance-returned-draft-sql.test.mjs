// stance-returned-draft-sql.test.mjs — a returned draft is not a live stance candidate (postmark#4459, POS-1148).
//
// "Stances awaiting our word name three marks the world door says never were." The clearing hands a returned mark back to its author as a `draft` whose
// `data` carries `_returned`; the stance read still offered it to other households. The fix is one predicate on STANCE_CLAIM_SELECT
// (src/world-stance.mjs): `AND NOT (status = 'draft' AND COALESCE(data ? '_returned', false))`.
//
// WHY THIS TEST RUNS THE SQL AND NOT A STUB. test/stance-candidates-read-the-store.test.mjs filters on `params[0]` and never evaluates the query text, so it
// cannot see a predicate. This reads the module's OWN `STANCE_CLAIM_SELECT` text out of src/world-stance.mjs (the shipped string, not a copy) and runs it on a
// real Postgres with every migration applied, over five claims:
//
//     an ordinary draft                       kept
//     a draft whose `data` is NULL            kept   (the NULL-data guard: without COALESCE `NOT (true AND NULL)` is NULL and WHERE drops the row)
//     a returned mark put forward again       kept   (`pending` with `_returned`, which promoteDraftOnStake keeps)
//     a draft rewritten without `_returned`   kept
//     a returned draft (`draft` + `_returned`)  ABSENT
//
// TWO ENGINES, ONE ASSERTION. PGlite (Postgres compiled to WASM; found at PGLITE_MODULE_DIR or as a bare import, and SKIPPED WITH ITS REASON when absent, never
// silently) is the route the bug's brief took; the suite's own embedded Postgres (test/helpers/embedded-store.mjs) is the same SQL on the server CI already
// runs, so the proof does not depend on a package CI does not install.
//
// FLIP: take the line out of STANCE_CLAIM_SELECT → the returned draft comes back and this goes red (+ 'returned-draft'); drop the COALESCE → red on the
// NULL-data draft (- 'draft-null-data').
//
// Credit: Kogane's cause, Little Bird's (foundoutanyway's) predicate, Noe's accepted brief, NULL-data guard and SQL run (the route of this test).
//
//   node --test test/stance-returned-draft-sql.test.mjs        (PGLITE_MODULE_DIR=<dir with node_modules/@electric-sql/pglite> to run the PGlite leg)

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadPglite, storeFloor } from "./helpers/pglite-store.mjs";
import { startStore } from "./helpers/embedded-store.mjs";

const SRC = readFileSync(new URL("../src/world-stance.mjs", import.meta.url), "utf8");
const SELECT = SRC.match(/const STANCE_CLAIM_SELECT = `([\s\S]*?)`;/)?.[1] ?? null;
const LIVE = ["draft", "pending"];
const WHY_NOT_FOUND = SELECT ? false : "STANCE_CLAIM_SELECT was not found in src/world-stance.mjs (moved or built another way): this test reads the shipped text and will not guess";
const EXPECTED = ["draft-null-data", "kept-draft", "put-forward", "recomposed"];

const ROWS = [
  ["returned-draft", "draft", { _returned: { at: "2026-11-11" }, kind: "note" }],
  ["kept-draft", "draft", { kind: "note" }],
  ["put-forward", "pending", { _returned: { at: "2026-11-10" } }],
  ["recomposed", "draft", { kind: "note", recomposed: true }],
  ["draft-null-data", "draft", null],
];
const WINDOW = "INSERT INTO windows (id, opens_at, closes_at, status) VALUES (1, now(), now() + interval '12 hours', 'open')";
const CLAIM = `INSERT INTO claims (window_id, class, claimant, household, status, slug, data, geometry)
               VALUES (1, 'mark', 'noe', 'the-carried-weight', $1, $2, $3, '{"at":{"x":1,"y":1},"extent":{"w":10,"h":10}}')`;
const seed = async (query) => {
  await query(WINDOW);
  for (const [slug, status, data] of ROWS) await query(CLAIM, [status, slug, data === null ? null : JSON.stringify(data)]);
};

test("guard: the shipped select text carries the predicate and every other candidate semantic", () => {
  assert.ok(SELECT, WHY_NOT_FOUND);
  assert.match(SELECT, /WHERE status = ANY\(\$1\)\s+AND NOT \(status = 'draft' AND COALESCE\(data \? '_returned', false\)\)\s+ORDER BY slug/);
  assert.match(SELECT, /SELECT slug,\s+claimant,\s+status,\s+geometry -> 'at'\s+AS at,\s+geometry -> 'extent'\s+AS extent,\s+data ->> 'kind'\s+AS kind,\s+data ->> 'date'\s+AS date,\s+data ->> 'by'\s+AS declared_by\s+FROM claims/, "the columns are as they were: the carve is not widened");
});

const pglite = await loadPglite();
let pg = null;
after(async () => { if (pg) await pg.close(); });
test("#4459 (PGlite, the brief's route): a returned draft is not a live stance candidate; every other live row still is", { skip: pglite.reason ?? WHY_NOT_FOUND }, async () => {
  pg = await storeFloor(pglite);
  await seed((q, p) => pg.query(q, p));
  const { rows } = await pg.query(SELECT, [LIVE]);
  assert.deepEqual(rows.map((r) => r.slug).sort(), EXPECTED);
});

const store = await startStore({ db: "stance_returned_draft" });
after(async () => { await store.stop(); });
test("#4459 (the suite's embedded Postgres, every migration applied): the same SQL, the same five claims, the same answer", { skip: store.skip ?? WHY_NOT_FOUND }, async () => {
  const c = await store.connect("world2_owner");
  try {
    await c.query("DELETE FROM claims WHERE claimant = 'noe'");
    await seed((q, p) => c.query(q, p));
    const { rows } = await c.query(SELECT, [LIVE]);
    assert.deepEqual(rows.filter((r) => ROWS.some(([slug]) => slug === r.slug)).map((r) => r.slug).sort(), EXPECTED);
    assert.ok(!rows.some((r) => r.slug === "returned-draft"), "the returned draft is not offered");
    // the answer's own shape: the columns the stance read has always carried
    const kept = rows.find((r) => r.slug === "kept-draft");
    assert.deepEqual(Object.keys(kept), ["slug", "claimant", "status", "at", "extent", "kind", "date", "declared_by"]);
  } finally { await c.end(); }
});
