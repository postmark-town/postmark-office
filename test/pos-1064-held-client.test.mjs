// pos-1064-held-client.test.mjs — POS-1064: a doorstep's composition runs with no pen connection held, and asks the store only after the connection is back.
//
// WHAT WAS MEASURED (local, capped, `/var/tmp/pos1064-instrument/`, a real office with 3 read workers and 12 residents polling; labelled local). A doorstep is ten
// segments, each its own short READ ONLY transaction through `storeIndexPooled` (town-index-store.mjs), and the part of a read that is not the index (the quest
// tools, the world read, the givers' households) runs in `storeAnswer`'s `then`, after the connection is back. Over 7,099 transactions on the changed tree and
// 6,897 on main, 97-98% of the time a connection was held was the store's own statements; the gaps BETWEEN a held connection's statements (JavaScript running while
// the transaction idled) summed to 7.0 s of 228 s held (3%), the longest single gap 150 ms, the longest in a doorstep path 69 ms. So the held-across-composition
// shape is already what the code does; the 5-19 s idle-in-transaction sampler saw in production is a transaction waiting on a thread whose loop was busy (a held
// transaction's next statement is queued behind the loop's other work), which is what moving the household reads off the main thread (§ read-workers) takes out.
//
// THIS FILE KEEPS THAT SHAPE HONEST. A doorstep is composed with the acts pool a stand-in that records, for every statement, whether the pen held a transaction on
// the asking call chain (`penHeld()`, store-pool.mjs). The doorstep's composition reads the household registry and the stamps ledger, and any of those asked WHILE
// the pen holds its transaction is the POS-963/POS-370 shape (a held connection waiting on a second pool). Red if a reader puts a registry or acts read inside a
// held `readTownIndex` callback; green as it stands.
//
//   node --test test/pos-1064-held-client.test.mjs

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { fixtureTown } from "./fixture.mjs";
import { indexStore, seedRegistry } from "./helpers/office-under-test.mjs";
import { penHeld, storePoolOptions } from "../src/store-pool.mjs";
import { readTownIndex, stampsDetail, storeIndexPooled, __setTownIndexPoolForTest } from "../src/town-index-store.mjs";
import { __setPoolForTest as setActsPool } from "../src/world2-acts.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REGISTRY = { schema_version: 1, note: "invented for POS-1064", households: {
  "ember-lane": { name: "Ember Lane", since: "2026-08-01", declared_by: "wright", accounts: [{ login: "ember-gh", id: 8101 }], residents: ["wright", "limen"] },
} };
const PINS = { wright: { login: "ember-gh", id: 8101 }, limen: { login: "ember-gh", id: 8101 } };

let ix = null, penPool = null, actsPg = null;
const KEEP = Object.fromEntries(["WORLD2_PG", "WORLD2_PG_URL"].map((k) => [k, process.env[k]]));
const asked = [];   // every statement the acts pool took: { held: who held a pen connection on that call chain, or null, sql }
const checkouts = { open: 0, peak: 0 };

before(async () => {
  ix = await indexStore(fixtureTown(), { db: "pos1064_held" });
  await seedRegistry(ix.store, REGISTRY, PINS);
  Object.assign(process.env, { WORLD2_PG: "1", WORLD2_PG_URL: ix.env.WORLD2_PG_URL });
  const { default: pg } = await import("pg");
  penPool = new pg.Pool(storePoolOptions({ ...process.env, WORLD2_PG_URL: ix.env.WORLD2_PG_URL }, { name: "pen", max: 3 }));
  penPool.on("error", () => {});
  // count how many pen connections are out at once, through the pool the office would use
  const connect = penPool.connect.bind(penPool);
  penPool.connect = async (...a) => {
    const c = await connect(...a);
    checkouts.open += 1; checkouts.peak = Math.max(checkouts.peak, checkouts.open);
    const release = c.release.bind(c);
    c.release = (...r) => { checkouts.open -= 1; return release(...r); };
    return c;
  };
  __setTownIndexPoolForTest(penPool);
  actsPg = new pg.Pool({ connectionString: ix.env.WORLD2_PG_URL, max: 2 });
  actsPg.on("error", () => {});
  setActsPool({ query: async (...a) => { asked.push({ held: penHeld(), sql: String(a[0]).slice(0, 60) }); return actsPg.query(...a); } });
});

after(async () => {
  setActsPool(null);
  __setTownIndexPoolForTest(null);
  await penPool?.end().catch(() => {});
  await actsPg?.end().catch(() => {});
  await ix?.stop();
  for (const [k, v] of Object.entries(KEEP)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});

test("a doorstep's composition asks the registry and the ledger only after its pen connection is back, and holds none when it ends", async () => {
  const { doorstepBundle } = await import("../src/doorstep-bundle.mjs");
  asked.length = 0; checkouts.open = 0; checkouts.peak = 0;
  const d = await doorstepBundle("wright", { key: null, asOf: "fixturesha", canWrite: false, clone: null, pen: null, odb: null, ix: storeIndexPooled(null), conversationsOffset: 0 });
  assert.ok(d && !d.error, `the doorstep did not compose: ${JSON.stringify(d)?.slice(0, 200)}`);
  assert.ok(asked.length > 0, "the doorstep composed without reading the registry or the acts at all: this test is not looking at what it claims to");
  const nested = asked.filter((a) => a.held);
  assert.deepEqual(nested, [], `the acts pool was asked while a pen connection was held: ${JSON.stringify(nested.slice(0, 3))}`);
  assert.equal(checkouts.open, 0, "a pen connection was still out when the doorstep was composed");
  assert.ok(checkouts.peak <= 3, `${checkouts.peak} pen connections held at once (the pool is three)`);
});

test("the stamps reader's registry read goes through the held client, the acts pool is not asked while it holds", async () => {
  asked.length = 0;
  await readTownIndex((c) => stampsDetail(c, "wright"));
  assert.deepEqual(asked.filter((a) => a.held), [], "stampsDetail asked the acts pool while it held the pen's transaction (POS-963's shape)");
});
