#!/usr/bin/env node
// probe-090-landed.mjs — ask 090's landed probe on THIS job's postgres:16.
// Workflow machinery for .github/workflows/guard-falsifier.yml, not an office
// tool (POS-721 B).
//
// 090's probe (world2/tools/migrations-landed.mjs) compares Postgres's own
// deparse of the canonical nonce index with 090's. The office suite asks it on
// its embedded Postgres (18); the box runs 16. This asks the SAME query,
// through `landedIn`, on a database the CI floor migrated, as world2_owner,
// and prints what it read: the server's version, the role, database and
// schema, the index's definition as this server deparses it, and the answer.
//
//   node .github/scripts/probe-090-landed.mjs <database>
//
// libpq's PGHOST/PGPORT/PGPASSWORD come from the job's env.
// exit 0  090 landed, on PostgreSQL 16
//      1  NOT landed, or the server is not 16 (the proof would be mislabelled)
//      2  CANNOT RUN (no connection, or the query failed)
import pg from "pg";
import { LANDED, landedIn } from "../../world2/tools/migrations-landed.mjs";

const FILE = "090_canonical_records.sql";
const database = process.argv[2];
if (!database) { console.error("usage: probe-090-landed.mjs <database>"); process.exit(2); }

const c = new pg.Client({ database, user: "world2_owner" });
c.on("error", () => {});
let code;
try {
  await c.connect();
  const { rows: [f] } = await c.query(`SELECT current_setting('server_version') AS version, current_setting('server_version_num')::int AS num,
    current_user AS role, current_database() AS db, current_schema() AS schema,
    pg_get_indexdef(to_regclass('public.office_town_journal_canonical_nonce')) AS def`);
  const [r] = await landedIn((q) => c.query(q), [FILE]);
  console.log(`server   PostgreSQL ${f.version} (server_version_num ${f.num})`);
  console.log(`as       role ${f.role} · database ${f.db} · schema ${f.schema}`);
  console.log(`index    ${f.def ?? "(none of that name)"}`);
  console.log(`query    SELECT (${LANDED[FILE].probe}) AS landed`);
  console.log(`${FILE}: ${r.state}`);
  const major = Math.floor(f.num / 10000);
  if (major !== 16) { console.log(`NOT PostgreSQL 16 (major ${major}): this is not the 16 proof`); code = 1; }
  else if (r.state !== "landed") { console.log(`NOT LANDED on PostgreSQL 16`); code = 1; }
  else { console.log(`LANDED on PostgreSQL 16`); code = 0; }
} catch (e) {
  console.log(`CANNOT RUN: ${e.code ?? ""} ${String(e.message).split("\n")[0]}`);
  code = 2;
} finally {
  await c.end().catch(() => {});
}
process.exit(code);
