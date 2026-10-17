// index-to-store.mjs — write a fixture town (test/fixture.mjs § fixtureTown:
// rows by TOWN_TABLES) into the store's town_* tables, the way the town-index
// ingest writes them: every column, the row's digest, and repo_log's `n` (a
// commit's files in the order they were put). Test-only: it lets a suite state
// its town as rows and read it through the doors' own readers.

import { TOWN_TABLES } from "../../src/town-index.mjs";
import { digestOf } from "../../world2/tools/town-index-ingest.mjs";

/** Replace every town_* table with `town`'s rows (an absent table is emptied). */
export async function seedTownIndex(client, town) {
  for (const [name, { cols }] of Object.entries(TOWN_TABLES)) {
    await client.query(`DELETE FROM town_${name}`);
    const rows = (town?.[name] ?? []).map((r) => cols.map((c) => r[c] ?? null));
    let sha = null, n = 0;
    for (const row of rows) {
      const extra = name === "repo_log" ? [(row[0] === sha ? ++n : ((sha = row[0]), (n = 1)))] : [digestOf(row)];
      const vals = [...row, ...extra];
      const all = [...cols, name === "repo_log" ? "n" : "digest"];
      await client.query(`INSERT INTO town_${name} (${all.join(", ")}) VALUES (${vals.map((_, i) => `$${i + 1}`).join(", ")})`, vals);
    }
  }
}
