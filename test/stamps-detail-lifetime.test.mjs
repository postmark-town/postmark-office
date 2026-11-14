// stamps-detail-lifetime.test.mjs — POS-963: an office read must not wait on ANOTHER connection while it holds its own transaction open.
//
// What prod showed (2026-11-08 18:09:50Z and 20:09:24Z): `[store-pool pen] a held connection failed (officeRead): terminating connection due to idle-in-transaction
// timeout`, and once, in the same second, a 500 "Client has encountered a connection error and is not queryable".
//
// THE PATH (found by reading every officeRead callback, not by the log's label, which is only `officeRead`'s default `by`): `readTownIndex` runs a reader in the
// pen's `BEGIN READ ONLY`. `stampsDetail` (the /stamps/{h} read, the stamps segment of the doorstep and of the house page, read_stamps) queried `town_stamps` on that
// client and then `await stampParties(handle)`, which read the household registry through `householdOf` -> `loadRegistryRows` -> the module's own ACTS pool (2
// connections, an acquire timeout of 10 s each, three queries in turn). While it waited, the pen's connection sat idle in its transaction. The server ends an idle
// transaction after `idle_in_transaction_session_timeout` (30 s by default), and a cold or busy acts pool can take that long (one acquire is bounded by 10 s, three in a
// row by 30 s). `stampParties` swallowed a failure of its lookup as garnish, so the NEXT query on the killed client threw the sentence above. Nothing was "forgotten":
// the callback held its transaction across a wait on a second pool, and the nested-pen guard (POS-370) cannot see the acts pool.
//
// THE FIX: the registry is read through the held client (registry-store.mjs § registryRowsVia, the way `householdKeyFor` reads it), so the read waits on nothing but its own
// statements, in its own snapshot, on its own connection.
//
// This is that boundary on a real Postgres: the server's idle-transaction limit is made short (400 ms), the acts pool is a stand-in that takes 1.5 s per query (the cold or
// busy store), and `readTownIndex` runs `stampsDetail` as the office runs it. THE FALSIFIER: before the fix the read dies with the observed 500's own sentence and the acts
// pool was asked while the pen held its transaction; put the registry read back on the acts pool and it fails the same way.
//
//   node --test test/stamps-detail-lifetime.test.mjs

import test, { after, before } from "node:test";
import assert from "node:assert/strict";

import { fixtureTown } from "./fixture.mjs";
import { indexStore, seedRegistry } from "./helpers/office-under-test.mjs";
import { rowsFromRegistry } from "../src/registry-rows.mjs";
import { storePoolOptions, penHeld } from "../src/store-pool.mjs";
import { readTownIndex, stampsDetail, __setTownIndexPoolForTest } from "../src/town-index-store.mjs";
import { stampParties } from "../src/queries.mjs";
import { __setPoolForTest as setActsPool } from "../src/world2-acts.mjs";

const REGISTRY = { schema_version: 1, note: "invented for POS-963", households: {
  "ember-lane": { name: "Ember Lane", since: "2026-08-01", declared_by: "wright", accounts: [{ login: "ember-gh", id: 8101 }], residents: ["wright", "limen"] },
} };
const PINS = { wright: { login: "ember-gh", id: 8101 }, limen: { login: "ember-gh", id: 8101 } };
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));

let ix = null, penPool = null, actsPg = null;
const KEEP = Object.fromEntries(["WORLD2_PG", "WORLD2_PG_URL"].map((k) => [k, process.env[k]]));
const asked = [];   // every query the acts-pool stand-in took, and whether the pen held a transaction on this call chain when it was asked

before(async () => {
  ix = await indexStore(fixtureTown(), { db: "stamps_detail_lifetime" });
  await seedRegistry(ix.store, REGISTRY, PINS);
  Object.assign(process.env, { WORLD2_PG: "1", WORLD2_PG_URL: ix.env.WORLD2_PG_URL });
  const { default: pg } = await import("pg");
  // the pen's pool, built as the office builds it, with the server's idle-transaction limit made short
  penPool = new pg.Pool(storePoolOptions({ ...process.env, WORLD2_PG_URL: ix.env.WORLD2_PG_URL, WORLD2_PG_IDLE_TX_MS: "400" }, { name: "pen", max: 3 }));
  penPool.on("error", () => {});
  __setTownIndexPoolForTest(penPool);
  // the ACTS pool (the module's own, which every registry read without a client uses): a store that answers, slowly
  actsPg = new pg.Pool({ connectionString: ix.env.WORLD2_PG_URL, max: 2 });
  actsPg.on("error", () => {});
  setActsPool({ query: async (...a) => { asked.push({ held: penHeld(), sql: String(a[0]).slice(0, 40) }); await sleep(1500); return actsPg.query(...a); } });
});

after(async () => {
  setActsPool(null);
  __setTownIndexPoolForTest(null);
  await penPool?.end().catch(() => {});
  await actsPg?.end().catch(() => {});
  await ix?.stop();
  for (const [k, v] of Object.entries(KEEP)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});

test("POS-963 · /stamps/{h}'s reader holds its transaction across no second connection: a slow acts pool does not end it, and no 500", async () => {
  asked.length = 0;
  const out = await readTownIndex((c) => stampsDetail(c, "wright"));   // exactly how the office runs it (server.mjs, mcp.mjs read_stamps, the doorstep and house segments)
  assert.equal(out.out.stamps, 4, "the answer is the stamps row's own");
  assert.deepEqual(asked, [], "the registry was read through the held client: the acts pool was never asked (and never while the pen held its transaction)");
});

test("POS-963 · the parties are the same as ever: the handle and its household's slug, now from the held client's own snapshot", async () => {
  const viaHeld = await readTownIndex((c) => stampParties("wright", c));
  assert.deepEqual(viaHeld.out, ["wright", "ember-lane"]);
  assert.deepEqual(await readTownIndex((c) => stampParties("nobody-here", c)).then((r) => r.out), ["nobody-here"], "a handle no house holds is its own party alone");
  // and the funding rows of the household's slug ride the detail, as they did
  const owner = await ix.store.connect("law_ingester");
  try { await owner.query("INSERT INTO town_funding_keeping_mint (party, pot, n, epoch, date, seq, digest) VALUES ('ember-lane', 'invented-pot', 5, 1, '2026-11-01', 1, 'invented-digest')"); }
  finally { await owner.end(); }
  const detail = (await readTownIndex((c) => stampsDetail(c, "wright"))).out;
  assert.equal(detail.tenses.minted_keeping, 5, "the household's keeping mint is counted for its resident");
});

test("POS-963 · the standalone form (no client) still reads the module's pool, as every non-reader caller does", async () => {
  asked.length = 0;
  assert.deepEqual(await stampParties("wright"), ["wright", "ember-lane"]);
  assert.ok(asked.length > 0 && asked.every((a) => a.held == null), "asked outside any held transaction");
});
