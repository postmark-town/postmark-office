// canonical-nonce-index-landed.test.mjs — 090's landed probe judges the nonce
// index by what it IS, ON A REAL POSTGRES (POS-721 B; world2/tools/
// migrations-landed.mjs § 090, world2/schema/090_canonical_records.sql).
//
// 090 makes `office_town_journal_canonical_nonce` with CREATE UNIQUE INDEX IF
// NOT EXISTS, which keeps whatever already holds the name. The probe at
// 25aa1e79 asked pg_indexes for the name alone, so it called a non-unique,
// re-keyed, re-predicated or INVALID index "landed". Each control below
// builds one such index on this file's own store (invented rows only), and
// asks BOTH probes: the old one (NAMES_ONLY, kept here as the discriminator)
// wrongly says landed, the probe says missing, and re-applying 090 does not
// repair it. The INVALID one is real: a CONCURRENTLY build that failed on
// duplicate invented rows, outside any transaction. Postgres leaves no
// not-ready-but-valid or not-live index behind to build, so those two flags
// are shown by a session-local view over pg_index (pg_temp first on the
// search path), which changes no catalog row.

import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { startStore } from "./helpers/embedded-store.mjs";
import { LANDED, landedIn } from "../world2/tools/migrations-landed.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FILE = "090_canonical_records.sql";
const MIGRATION = join(ROOT, "world2", "schema", FILE);
const INDEX = "office_town_journal_canonical_nonce";
const KEYS = "(household, (coalesce(handle, '')), ((payload::jsonb #>> '{receipt,nonce}')))";
const WHERE = "WHERE class = 'update' AND act = 'canonical-profile'";
// The 090 probe as it stood at 25aa1e79: the tables and the index's NAME.
const NAMES_ONLY = "to_regclass('public.resident_records') IS NOT NULL AND to_regclass('public.human_records') IS NOT NULL AND EXISTS (SELECT 1 FROM pg_indexes WHERE tablename = 'office_town_journal' AND indexname = 'office_town_journal_canonical_nonce')";

let store, owner;

const probe = async (c = owner) => (await landedIn((q) => c.query(q), [FILE]))[0].state;
const namesOnly = async () => (await owner.query(`SELECT (${NAMES_ONLY}) AS landed`)).rows[0].landed ? "landed" : "missing";
const apply090 = () => owner.query(readFileSync(MIGRATION, "utf8"));
const flags = async () => (await owner.query(
  "SELECT i.indisunique, i.indisvalid, i.indisready, i.indislive FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid WHERE c.relname = $1", [INDEX])).rows;
/** Put 090's own index back, and prove it is back. */
const restore = async () => {
  await owner.query(`DROP INDEX IF EXISTS ${INDEX}`);
  await apply090();
  assert.equal(await probe(), "landed");
};

before(async () => {
  store = await startStore({ db: "canonical_nonce_landed" });
  owner = await store.connect("world2_owner");
});

after(async () => {
  await owner?.end().catch(() => {});
  await store?.stop();
});

test("090's header proves it landed with the probe's own query, not a different one", () => {
  const norm = (s) => s.replace(/\s+/g, " ").trim();
  const header = readFileSync(MIGRATION, "utf8").split("\n").filter((l) => l.startsWith("--")).map((l) => l.replace(/^--/, "")).join(" ");
  assert.ok(norm(header).includes(`SELECT ${norm(LANDED[FILE].probe)} AS landed;`), "the HOW TO PROVE IT LANDED query must be migrations-landed.mjs's 090 probe, verbatim");
});

test("090 as built: landed, and still landed (one index, unchanged) when 090 is applied again", async () => {
  assert.equal(await probe(), "landed");
  assert.deepEqual(await flags(), [{ indisunique: true, indisvalid: true, indisready: true, indislive: true }]);
  const def = async () => (await owner.query("SELECT pg_get_indexdef(to_regclass($1)) AS d", [`public.${INDEX}`])).rows[0].d;
  const was = await def();
  await apply090();
  assert.equal(await probe(), "landed");
  assert.equal(await def(), was);
  assert.equal((await owner.query("SELECT count(*)::int AS n FROM pg_indexes WHERE indexname = $1", [INDEX])).rows[0].n, 1);
});

test("without the index, 090 is missing (both probes agree)", async () => {
  await owner.query(`DROP INDEX ${INDEX}`);
  try {
    assert.equal(await probe(), "missing");
    assert.equal(await namesOnly(), "missing");
  } finally { await restore(); }
});

// Each: the same NAME on the journal, something else in it.
const IMPOSTORS = [
  ["not unique", `CREATE INDEX ${INDEX} ON office_town_journal ${KEYS} ${WHERE}`],
  ["no handle in the key (scopes conflated)", `CREATE UNIQUE INDEX ${INDEX} ON office_town_journal (household, ((payload::jsonb #>> '{receipt,nonce}'))) ${WHERE}`],
  ["the nonce truncated", `CREATE UNIQUE INDEX ${INDEX} ON office_town_journal (household, (coalesce(handle, '')), (left(payload::jsonb #>> '{receipt,nonce}', 64))) ${WHERE}`],
  ["the nonce hashed", `CREATE UNIQUE INDEX ${INDEX} ON office_town_journal (household, (coalesce(handle, '')), (md5(payload::jsonb #>> '{receipt,nonce}'))) ${WHERE}`],
  ["a wider predicate (every update)", `CREATE UNIQUE INDEX ${INDEX} ON office_town_journal ${KEYS} WHERE class = 'update'`],
  ["no predicate", `CREATE UNIQUE INDEX ${INDEX} ON office_town_journal ${KEYS}`],
  ["an included column", `CREATE UNIQUE INDEX ${INDEX} ON office_town_journal ${KEYS} INCLUDE (seq) ${WHERE}`],
];

for (const [what, ddl] of IMPOSTORS) {
  test(`a same-named index with ${what} is NOT 090 landed, the name-only probe said it was, and re-applying 090 does not repair it`, async () => {
    await owner.query(`DROP INDEX ${INDEX}`);
    try {
      await owner.query(ddl);
      assert.equal(await namesOnly(), "landed", "the discriminator: the old probe must have been fooled");
      assert.equal(await probe(), "missing");
      await apply090();
      assert.equal(await probe(), "missing", "IF NOT EXISTS kept the impostor");
    } finally { await restore(); }
  });
}

test("the same name on another table is not 090's index", async () => {
  await owner.query(`DROP INDEX ${INDEX}`);
  try {
    await owner.query("CREATE TABLE inv_journal_twin (LIKE office_town_journal)");
    await owner.query(`CREATE UNIQUE INDEX ${INDEX} ON inv_journal_twin ${KEYS} ${WHERE}`);
    assert.equal(await probe(), "missing");
    await apply090();
    assert.equal(await probe(), "missing", "IF NOT EXISTS skipped the journal's index: the name was taken");
  } finally {
    await owner.query("DROP TABLE IF EXISTS inv_journal_twin");
    await restore();
  }
});

test("INVALID, for real: a CONCURRENTLY build that failed on duplicate invented rows is not 090 landed, and 090 does not repair it", async () => {
  await owner.query(`DROP INDEX ${INDEX}`);
  const dup = JSON.stringify({ receipt: { nonce: "inv-dup-nonce" } });
  try {
    for (const seq of [990001, 990002])
      await owner.query("INSERT INTO office_town_journal (seq, class, act, household, handle, payload, written_at) VALUES ($1, 'update', 'canonical-profile', 'inv-dup', NULL, $2, '2026-11-04T00:00:00Z')", [seq, dup]);
    await assert.rejects(owner.query(`CREATE UNIQUE INDEX CONCURRENTLY ${INDEX} ON office_town_journal ${KEYS} ${WHERE}`), (e) => e.code === "23505");
    const [f] = await flags();
    assert.equal(f.indisvalid, false, "the failed build left an INVALID index behind");
    assert.equal(await namesOnly(), "landed", "the discriminator: the old probe must have been fooled");
    assert.equal(await probe(), "missing");
    await apply090();
    assert.equal(await probe(), "missing", "IF NOT EXISTS kept the INVALID index");
    assert.deepEqual(await flags(), [f], "and left it as it was");
  } finally {
    await owner.query("DELETE FROM office_town_journal WHERE seq IN (990001, 990002)");
    await restore();
  }
});

test("valid, ready and live are each required: one flag false, in a session-local view over pg_index, and 090 is missing", async () => {
  const c = await store.connect("world2_owner");
  const view = (off) => `CREATE OR REPLACE TEMP VIEW pg_index AS SELECT indexrelid, indrelid, indnatts, indnkeyatts, indisunique,
    ${["indisvalid", "indisready", "indislive"].map((k) => (k === off ? `CASE WHEN indexrelid = to_regclass('public.${INDEX}') THEN false ELSE ${k} END AS ${k}` : k)).join(", ")}
    FROM pg_catalog.pg_index`;
  try {
    await c.query("SET search_path = pg_temp, pg_catalog, public");
    await c.query(view(null));
    assert.equal(await probe(c), "landed", "the admitting control: through the same view, nothing turned off");
    for (const off of ["indisvalid", "indisready", "indislive"]) {
      await c.query(view(off));
      assert.equal(await probe(c), "missing", `${off} false`);
    }
  } finally { await c.end(); }
  assert.equal(await probe(), "landed", "no catalog row changed");
});
