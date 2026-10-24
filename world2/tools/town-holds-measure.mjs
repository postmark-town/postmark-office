#!/usr/bin/env node
// town-holds-measure.mjs: HOW MANY TOWN-SIGNED MARKS DOES THE FOURTH TERM OFFER TODAY? (WLD-5)
//
//   WORLD2_PG_URL=<a READ-ONLY store url> node world2/tools/town-holds-measure.mjs --world-repo <checkout> --world-sha <sha>
//
// Read-only on both sides: one SELECT (fold-delta.mjs § TOWN_HOLDS_SELECT) against the store, and a
// canon register read at the named commit. It writes nothing. The answer is the number of standing
// town-signed marks whose store holder or owner differs from what canon carries, and which they are:
// exactly the set `foldDelta`'s fourth term would offer to the next crossing (docket and the other
// terms aside). Run on prod before deciding whether the term may merge.
import { createRequire } from "node:module";
import { canonRegisterAtSha } from "./canon-register.mjs";
import { TOWN_HOLDS_SELECT, holdsOwed } from "./fold-delta.mjs";

const argOf = (n) => { const i = process.argv.indexOf(n); return i === -1 ? null : process.argv[i + 1]; };
const worldRepo = argOf("--world-repo"), sha = argOf("--world-sha"), url = process.env.WORLD2_PG_URL;
if (!worldRepo || !sha || !url) {
  console.error("usage: WORLD2_PG_URL=<read-only url> node world2/tools/town-holds-measure.mjs --world-repo <checkout> --world-sha <sha>");
  process.exit(2);
}
const pg = createRequire(import.meta.url)("pg");
const register = await canonRegisterAtSha({ worldRepo, sha });
const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  await client.query("SET default_transaction_read_only = on");
  const { rows } = await client.query(TOWN_HOLDS_SELECT);
  const owed = holdsOwed(rows, register.holds);
  console.log(JSON.stringify({
    world_sha: register.sha, town_standing_in_store: rows.length, town_records_in_canon: register.holds.size,
    in_store_not_in_canon: rows.filter((r) => !register.holds.has(r.slug)).length,
    differ: owed.length, slugs: owed,
    detail: owed.map((s) => { const r = rows.find((x) => x.slug === s); const c = register.holds.get(s); return { slug: s, store: [r.held_by, r.owned_by], canon: [c.held_by, c.owned_by] }; }),
  }, null, 1));
} finally { await client.end(); }
