// pos-1095-store-migrations.test.mjs — POS-1095 b: two small store migrations, proved on a real Postgres.
//
//   099_acts_passage_idx.sql         the enter/exit count (enter-exit-ledger.mjs § passageMark) reads an index, not the table
//   100_town_residents_github.sql    probeRows reads two stored columns, and falls back to the two casts when the table lacks them
//
// LAW (Darko, 2026-11-17 12:55 EST, the picker, POS-1095/b): "Yes, both". Jetto's brief (2026-11-17 17:57Z): the plan of passageMark's own statement,
// "with its `action = ANY($1)` parameter bound as the office binds it, shows the index and no scan of `acts`; and the statement's answer is unchanged
// with the index and without it"; probeRows "reads the columns when the table has them and falls back to today's casts when it doesn't", with "an
// old-against-new equivalence over fixture rows (a string, a JSON null, a missing key, a missing `address`, a missing `address.data`), on a real
// Postgres; the fallback path; and the migration's own up and re-run".
//
// passageMark is not exported, so § 1 drives livePassageRows through a pool that records the statement it is handed and forwards it to the real store.
// The statement EXPLAINed and compared is that recorded one, with the params the office passed.
//
//   node --import ./test/helpers/sparse-guard.mjs --test --test-concurrency=1 test/pos-1095-store-migrations.test.mjs

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { fixtureTown, put } from "./fixture.mjs";
import { startStore } from "./helpers/embedded-store.mjs";
import { seedTownIndex } from "./helpers/index-to-store.mjs";
import * as store from "../src/town-index-store.mjs";
import { livePassageRows, __forgetPassages } from "../src/enter-exit-ledger.mjs";
import { __setPoolForTest } from "../src/world2-acts.mjs";
import { LANDED } from "../world2/tools/migrations-landed.mjs";

const SCHEMA = join(dirname(fileURLToPath(import.meta.url)), "..", "world2", "schema");
const ACTS_SQL = readFileSync(join(SCHEMA, "099_acts_passage_idx.sql"), "utf8");
const RESIDENTS_SQL = readFileSync(join(SCHEMA, "100_town_residents_github.sql"), "utf8");

let s = null, skip = false, owner = null, api = null;

before(async () => {
  s = await startStore({ db: "pos1095_migrations" });
  if (s.skip) { skip = s.skip; return; }
  owner = await s.connect("world2_owner");
  api = await s.connect("office_api");
});

after(async () => {
  __setPoolForTest(null);
  for (const c of [api, owner]) if (c) await c.end().catch(() => {});
  if (s?.stop) await s.stop();
});

const plan = (rows) => rows.map((r) => r["QUERY PLAN"]).join("\n");
const probe = async (file) => (await owner.query(`SELECT (${LANDED[file].probe}) AS landed`)).rows[0].landed;
const indexExists = async () => (await owner.query("SELECT 1 FROM pg_indexes WHERE tablename = 'acts' AND indexname = 'acts_passage_idx'")).rowCount === 1;

// ── § 1  the acts index ──────────────────────────────────────────────────────

/** Rows shaped like the town's record: mostly other acts, some live passages, some founding-era (`_ledger`) passages. */
async function seedActs() {
  await owner.query(`
    INSERT INTO acts (at, actor, action, class, payload)
    SELECT now(), 'actor' || (g % 50),
           (ARRAY['say','walk','look','enter','exit','legacy:enter','legacy:exit','give'])[1 + g % 8],
           'world',
           CASE WHEN g % 8 IN (5, 6) THEN jsonb_build_object('_ledger', true, 'lines', jsonb_build_array('x')) ELSE jsonb_build_object('lines', jsonb_build_array('x')) END
      FROM generate_series(1, 40000) g`);
  await owner.query("VACUUM ANALYZE acts");
}

/** The statement the office sends for the passage mark, and its params, taken from the real call path. */
async function recordedMark() {
  __forgetPassages();
  const seen = [];
  __setPoolForTest({ async query(text, params = []) { seen.push({ text, params }); return api.query(text, params); } });
  await livePassageRows({ env: { WORLD2_PG: "1", WORLD2_PG_URL: "postgres://stub/none" } });
  __setPoolForTest(null);
  const mark = seen.find((q) => /max\(id\)/.test(q.text));
  assert.ok(mark, "livePassageRows sent no max(id) statement: the passage mark was not asked");
  return mark;
}

test("§ 1 the plan: passageMark's own statement, bound as the office binds it, uses acts_passage_idx and no scan of acts", async (t) => {
  if (skip) return t.skip(skip);
  await seedActs();
  const { text, params } = await recordedMark();
  assert.ok(Array.isArray(params[0]) && params[0].includes("enter"), "the statement is handed the passage action list as its one array param");

  // BEFORE: no index (the floor has run 099, so take it away as the owner) — the plan scans acts. This is the control that the plan reader can see a scan.
  await owner.query("DROP INDEX IF EXISTS acts_passage_idx");
  const before = plan((await owner.query(`EXPLAIN ${text}`, params)).rows);
  assert.match(before, /Seq Scan on acts|Index Scan using acts_\w+ on acts|Bitmap Heap Scan on acts/, `without the index the statement reads the table:\n${before}`);
  assert.doesNotMatch(before, /acts_passage_idx/, "no index, so the plan cannot name it");

  // AFTER: the migration's own file, as the owner applies it.
  await owner.query(ACTS_SQL);
  assert.ok(await indexExists(), "099 made acts_passage_idx");
  await owner.query("VACUUM ANALYZE acts");
  const after = plan((await owner.query(`EXPLAIN ${text}`, params)).rows);
  assert.match(after, /Index Only Scan using acts_passage_idx on acts/, `the statement is answered from the index:\n${after}`);
  assert.doesNotMatch(after, /Seq Scan on acts/, `and nothing scans acts:\n${after}`);
  t.diagnostic(`EXPLAIN before:\n${before}\nEXPLAIN after:\n${after}`);
});

test("§ 1b the answer: the statement's answer is identical with the index and without it", async (t) => {
  if (skip) return t.skip(skip);
  await owner.query(ACTS_SQL); // idempotent: present for the first read
  await owner.query("VACUUM ANALYZE acts");
  const { text, params } = await recordedMark();
  const withIndex = (await api.query(text, params)).rows[0];
  await owner.query("DROP INDEX IF EXISTS acts_passage_idx");
  const without = (await api.query(text, params)).rows[0];
  await owner.query(ACTS_SQL);
  assert.deepEqual(withIndex, without, "max(id) and count(*) do not move with the index");
  // The control: the answer is a real one (a count of live passages only, the founding era excluded), not a pair of nulls that agree.
  const n = Number(withIndex.n);
  assert.equal(n, 40000 / 8 * 2, "the live enter and exit rows (2 of 8 actions, none carrying _ledger)");
  assert.ok(Number(withIndex.hw) > 0);
});

test("§ 1c the migration's up and re-run: 099 is idempotent and its probe says landed", async (t) => {
  if (skip) return t.skip(skip);
  await owner.query("DROP INDEX IF EXISTS acts_passage_idx");
  assert.equal(await probe("099_acts_passage_idx.sql"), false, "probe: missing before");
  await owner.query(ACTS_SQL);
  assert.equal(await probe("099_acts_passage_idx.sql"), true, "probe: landed after");
  await owner.query(ACTS_SQL); // the re-run must not throw
  assert.equal(await probe("099_acts_passage_idx.sql"), true, "still landed after a re-run");
  const def = (await owner.query("SELECT indexdef FROM pg_indexes WHERE indexname = 'acts_passage_idx'")).rows[0].indexdef;
  assert.match(def, /\(action, id\) WHERE \(\(payload ->> '_ledger'::text\) IS NULL\)/, `the index is (action, id) where not _ledger: ${def}`);
});

// ── § 2  the residents' GitHub columns ───────────────────────────────────────

// THE ORACLE: the statement main sent, verbatim, and the JS pick it fed.
const OLD_SQL = `SELECT handle, json::jsonb -> 'github' AS g1, json::jsonb -> 'address' -> 'data' -> 'github' AS g2 FROM town_residents ORDER BY handle COLLATE "C"`;
const oldLogins = (rows) => rows.map((r) => ({ handle: r.handle, github: r.g1 ?? r.g2 ?? "" }));

// every shape the casts meet: a string, a JSON null, a missing key, a missing address, a missing address.data, both set, a nested null
const SHAPES = {
  "r-top-string":      { handle: "r-top-string", github: "topper" },
  "r-top-null":        { handle: "r-top-null", github: null, address: { data: { github: "fallback" } } },
  "r-top-null-only":   { handle: "r-top-null-only", github: null },
  "r-missing-key":     { handle: "r-missing-key", note: "no github anywhere" },
  "r-no-address":      { handle: "r-no-address", github: undefined, other: 1 },
  "r-no-data":         { handle: "r-no-data", address: { line: "somewhere" } },
  "r-address-string":  { handle: "r-address-string", github: "", address: { data: { github: "viaaddress" } } },
  "r-both":            { handle: "r-both", github: "first", address: { data: { github: "second" } } },
  "r-nested-null":     { handle: "r-nested-null", address: { data: { github: null } } },
  "r-data-not-object": { handle: "r-data-not-object", address: { data: "plain text" } },
};

/** A client that keeps every statement it is asked. */
const spy = (c) => { const sql = []; return { sql, query: (text, params) => { sql.push(String(typeof text === "string" ? text : text.text)); return c.query(text, params); } }; };

async function seedResidents() {
  const db = fixtureTown();
  for (const [handle, value] of Object.entries(SHAPES)) put(db, "residents", { handle, json: JSON.stringify(value) });
  const w = await s.connect("law_ingester"); // the ingest's own role, writing by named columns
  try { await seedTownIndex(w, db); } finally { await w.end(); }
}

async function dropColumns() { await owner.query("ALTER TABLE town_residents DROP COLUMN IF EXISTS github_top, DROP COLUMN IF EXISTS github_address"); }
const columnsHeld = async () => Number((await owner.query("SELECT count(*) AS n FROM pg_attribute WHERE attrelid = 'town_residents'::regclass AND attname IN ('github_top','github_address') AND NOT attisdropped")).rows[0].n);

test("§ 2 the equivalence: probeRows through the stored columns answers what the two casts answered, on every shape", async (t) => {
  if (skip) return t.skip(skip);
  assert.equal(await columnsHeld(), 2, "the floor ran 100: both columns exist");
  await seedResidents();
  const oldRows = (await api.query(OLD_SQL)).rows;
  assert.equal(oldRows.length, (await api.query("SELECT count(*)::int AS n FROM town_residents")).rows[0].n, "the oracle read every resident (the fixture town's own, and the shapes)");
  for (const h of Object.keys(SHAPES)) assert.ok(oldRows.some((r) => r.handle === h), `the oracle holds ${h}`);

  const c = spy(api);
  const got = await store.probeRows(c);
  assert.ok(c.sql.includes(store.RESIDENT_GITHUB_SQL.stored), "with the columns, probeRows sent the stored-column statement");
  assert.ok(!c.sql.includes(store.RESIDENT_GITHUB_SQL.cast), "and not the cast one");
  assert.deepEqual(got.logins, oldLogins(oldRows), "the same GitHub line for every handle, in the same (bytewise) order");

  // the raw jsonb values too, not only the picked line: a JSON null stays a JSON null and a missing path stays SQL null, as the casts gave them
  const stored = (await api.query(store.RESIDENT_GITHUB_SQL.stored)).rows;
  assert.deepEqual(stored.map((r) => [r.handle, r.g1, r.g2]), oldRows.map((r) => [r.handle, r.g1, r.g2]));

  // the controls: the shapes are distinguishable (each reads what the table says it should), so a pair of empty answers agreeing is not what passed
  const by = Object.fromEntries(got.logins.map((l) => [l.handle, l.github]));
  assert.equal(by["r-top-string"], "topper");
  assert.equal(by["r-top-null"], "fallback", "a JSON null at the top falls through to address.data.github");
  assert.equal(by["r-top-null-only"], "");
  assert.equal(by["r-missing-key"], "");
  assert.equal(by["r-no-address"], "");
  assert.equal(by["r-no-data"], "");
  assert.equal(by["r-address-string"], "", "an empty string is a value: `??` keeps it, exactly as before");
  assert.equal(by["r-both"], "first");
  assert.equal(by["r-nested-null"], "");
  assert.equal(by["r-data-not-object"], "");
  assert.ok(stored.find((r) => r.handle === "r-top-null").g1 === null && stored.find((r) => r.handle === "r-missing-key").g1 === null);
});

test("§ 2b the fallback: a table without the columns is read through the casts, with the same answer", async (t) => {
  if (skip) return t.skip(skip);
  await seedResidents();
  const withColumns = (await store.probeRows(api)).logins;
  await dropColumns();
  try {
    assert.equal(await columnsHeld(), 0, "control: the columns are gone");
    const c = spy(api);
    const got = await store.probeRows(c);
    assert.ok(c.sql.includes(store.RESIDENT_GITHUB_SQL.cast), "without the columns, probeRows sent the cast statement");
    assert.ok(!c.sql.includes(store.RESIDENT_GITHUB_SQL.stored), "and never named a column the table lacks");
    assert.deepEqual(got.logins, withColumns, "the same answer through the casts as through the columns");
    assert.deepEqual(got.logins, oldLogins((await api.query(OLD_SQL)).rows));
    // one of the columns is not enough: a half-migrated table still reads through the casts
    await owner.query("ALTER TABLE town_residents ADD COLUMN github_top jsonb GENERATED ALWAYS AS ((json::jsonb) -> 'github') STORED");
    const c2 = spy(api);
    await store.probeRows(c2);
    assert.ok(c2.sql.includes(store.RESIDENT_GITHUB_SQL.cast) && !c2.sql.includes(store.RESIDENT_GITHUB_SQL.stored), "one column of two still falls back");
  } finally { await dropColumns(); await owner.query(RESIDENTS_SQL); }
  assert.equal(await columnsHeld(), 2, "restored by the migration itself");
});

test("§ 2c the logins:false read never touches the columns or the casts", async (t) => {
  if (skip) return t.skip(skip);
  await seedResidents();
  const c = spy(api);
  const got = await store.probeRows(c, { logins: false });
  assert.equal(got.logins, null);
  assert.equal(got.handles.size, (await api.query("SELECT count(*)::int AS n FROM town_residents")).rows[0].n);
  for (const h of Object.keys(SHAPES)) assert.ok(got.handles.has(h), `${h} is on the roll`);
  assert.ok(!c.sql.includes(store.RESIDENT_GITHUB_SQL.stored) && !c.sql.includes(store.RESIDENT_GITHUB_SQL.cast));
});

test("§ 2d the migration's up and re-run: 100 adds both columns, a re-run changes nothing, the ingest's writer still writes, the columns follow", async (t) => {
  if (skip) return t.skip(skip);
  await seedResidents();
  await dropColumns();
  assert.equal(await probe("100_town_residents_github.sql"), false, "probe: missing before");
  await owner.query(RESIDENTS_SQL); // up: rewrites the table once, fills the existing rows
  assert.equal(await probe("100_town_residents_github.sql"), true, "probe: landed after");
  const rewriteOf = async () => (await owner.query("SELECT relfilenode FROM pg_class WHERE relname = 'town_residents'")).rows[0].relfilenode;
  const filenode = await rewriteOf();
  await owner.query(RESIDENTS_SQL); // the re-run must not throw and must not rewrite the table again
  assert.equal(await rewriteOf(), filenode, "a re-run is a no-op: the table was not rewritten");
  const kinds = (await owner.query("SELECT column_name, data_type, is_generated FROM information_schema.columns WHERE table_name = 'town_residents' AND column_name IN ('github_top','github_address') ORDER BY 1")).rows;
  assert.deepEqual(kinds, [
    { column_name: "github_address", data_type: "jsonb", is_generated: "ALWAYS" },
    { column_name: "github_top", data_type: "jsonb", is_generated: "ALWAYS" },
  ]);
  // existing rows were filled by the rewrite
  const row = (await api.query("SELECT github_top, github_address FROM town_residents WHERE handle = 'r-both'")).rows[0];
  assert.deepEqual(row, { github_top: "first", github_address: "second" });
  // a row written afterwards, by the ingest's role naming its columns (and deleted by key), carries its own values
  const w = await s.connect("law_ingester");
  try {
    await w.query("INSERT INTO town_residents (handle, json, digest) VALUES ($1, $2, $3)", ["r-late", JSON.stringify({ github: "late" }), "d"]);
    assert.equal((await api.query("SELECT github_top FROM town_residents WHERE handle = 'r-late'")).rows[0].github_top, "late");
    await w.query("DELETE FROM town_residents WHERE handle = ANY($1::text[])", [["r-late"]]);
  } finally { await w.end(); }
  // and the probe reads through them
  const c = spy(api);
  await store.probeRows(c);
  assert.ok(c.sql.includes(store.RESIDENT_GITHUB_SQL.stored));
});

// ── § 3  a NUL in an inbox must not fail the write, and must not blank the GitHub line ──
//
// LAW (Jetto, 2026-11-17 18:19Z, POS-1095): "the function must not answer NULL just because the text holds a NUL. The GitHub line is what sign-in
// matches an unpinned resident's login against (`oauth.mjs § loginIndex`)". Tries "the plain cast", then "the cast of the text with its `\u0000`
// escapes removed" (a doubled backslash is plain text), "only then NULL".

const GH = { github: "ghnul", address: { data: { github: "addrnul" } } };
const columnsOf = async (handle) => (await api.query("SELECT github_top, github_address FROM town_residents WHERE handle = $1", [handle])).rows[0];
async function insertAs(handle, jsonText) {
  const w = await s.connect("law_ingester"); // the ingest's own role, by named columns
  try { await w.query("INSERT INTO town_residents (handle, json, digest) VALUES ($1, $2, 'd')", [handle, jsonText]); } finally { await w.end(); }
}

test("§ 3 a NUL escape in an inbox body: the INSERT succeeds through the ingest's role, and both columns equal a NUL-free copy's", async (t) => {
  if (skip) return t.skip(skip);
  await seedResidents();
  const withNul = JSON.stringify({ handle: "n1", ...GH, inbox: [{ body: "Before the nul\u0000NULWORD after it." }] });
  assert.ok(withNul.includes("\\u0000"), "control: the JSON text holds the escape that jsonb refuses");
  await assert.rejects(() => api.query("SELECT $1::text::jsonb", [withNul]), /unsupported Unicode escape/, "control: the plain cast refuses it");
  await insertAs("n1", withNul);
  await insertAs("n1-clean", JSON.stringify({ handle: "n1", ...GH, inbox: [{ body: "Before the nul NULWORD after it." }] }));
  const a = await columnsOf("n1"), b = await columnsOf("n1-clean");
  assert.deepEqual(a, { github_top: "ghnul", github_address: "addrnul" }, "the GitHub line of the NUL row is not blanked");
  assert.deepEqual(a, b, "and equals a NUL-free copy's");
  // the probe reads it as it reads any resident
  const login = (await store.probeRows(api)).logins.find((l) => l.handle === "n1");
  assert.equal(login.github, "ghnul");
});

test("§ 3b a real \\u0000 escape beside a literal doubled-backslash one: only the escape is removed", async (t) => {
  if (skip) return t.skip(skip);
  await seedResidents();
  // body: NUL, then the six characters \u0000 as plain text (JSON.stringify doubles the backslash)
  const both = JSON.stringify({ handle: "n2", ...GH, inbox: [{ body: "a\u0000b", note: "literal \\u0000 text" }] });
  assert.ok(both.includes("\\\\u0000") && both.includes("a\\u0000b"), "control: the text holds a doubled-backslash u0000 and a real escape");
  await insertAs("n2", both);
  assert.deepEqual(await columnsOf("n2"), { github_top: "ghnul", github_address: "addrnul" });
  const doc = (await api.query("SELECT resident_json_doc(json) AS d FROM town_residents WHERE handle = 'n2'")).rows[0].d;
  assert.equal(doc.inbox[0].body, "ab", "the NUL escape is gone");
  assert.equal(doc.inbox[0].note, "literal \\u0000 text", "the plain-text backslash and its letters are kept");
  // an escaped backslash then a real escape (three backslashes), and two escapes in a row
  const odd = `{"github":"g3","address":{"data":{"github":"a3"}},"p":"x\\\\\\u0000y","q":"m\\u0000\\u0000n"}`;
  await insertAs("n3", odd);
  assert.deepEqual(await columnsOf("n3"), { github_top: "g3", github_address: "a3" });
  const d3 = (await api.query("SELECT resident_json_doc(json) AS d FROM town_residents WHERE handle = 'n3'")).rows[0].d;
  assert.equal(d3.p, "x\\y", "an escaped backslash is kept, the escape after it goes");
  assert.equal(d3.q, "mn", "a run of escapes goes, not every other one");
});

test("§ 3c a row that will not cast at all: the INSERT succeeds and both columns are NULL", async (t) => {
  if (skip) return t.skip(skip);
  await seedResidents();
  await insertAs("n4", `{"github":"cut off","address":{"data":{"github":"x"`);
  assert.deepEqual(await columnsOf("n4"), { github_top: null, github_address: null });
  await insertAs("n5", `{"github":"x\\u0000","inbox":[{"body":"a\\u0000b"}],"broken":`);
  assert.deepEqual(await columnsOf("n5"), { github_top: null, github_address: null }, "a NUL escape in text that is cut off is still NULL, never a throw");
});
