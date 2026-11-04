// canonical-race-child.mjs — ONE independent process for the canonical-record
// race proofs (test/canonical-records-store.test.mjs). It opens its OWN pool as
// `office_api`, asks the real transaction core once, prints the answer as one
// JSON line and exits. Two of these, started together, are two writers that
// share nothing but the database.
//
//   node test/helpers/canonical-race-child.mjs '<json>'
//   json: { url, appName, kind, target, patch, expectedRevision, nonce, provenance }

import pg from "pg";
import { paperOnPool, paperworkPoolTypes } from "../../src/paperwork.mjs";
import { writeCanonicalRecord } from "../../src/canonical-records.mjs";

const ask = JSON.parse(process.argv[2]);
const pool = new pg.Pool({ connectionString: ask.url, max: 1, application_name: ask.appName, types: paperworkPoolTypes(pg) });
pool.on("error", () => {});
try {
  const answer = await writeCanonicalRecord(paperOnPool(pool), ask);
  process.stdout.write(`${JSON.stringify(answer)}\n`);
} catch (e) {
  process.stdout.write(`${JSON.stringify({ threw: true, code: e?.code ?? null })}\n`);
} finally {
  await pool.end();
}
