// pos-1064-held-client.test.mjs — POS-1064: a doorstep's composition runs with no pen connection held, and asks the store only after the connection is back.
//
// WHAT WAS MEASURED (local, capped, `/var/tmp/pos1064-instrument/seg/`; the PR body has the per-phase table). A doorstep composes in sequence: the paper read-through,
// ONE index read (`ix.doorstep`, the core: mail, awaiting, stamps, bulletin, pulse, window, psa, counts), the copy, then stances, outcomes, stakes, alerts, posts and the
// owner garnish, each its own short READ ONLY transaction (or none) through `storeIndexPooled`, with the part of a read that is not the index running in `storeAnswer`'s
// `then`, after the connection is back. On an idle office the core held ONE connection for 98-120 ms across 34-38 statements, of which 25-31 ms (~25%) was JavaScript
// between the statements (cards and laws parsed, pages folded), with the transaction open on the pen; the other phases already composed after release. (An earlier
// aggregate over every transaction, "3% of held time", was dominated by thousands of short ones and hid it; it is withdrawn.)
//
// THE CORE'S BOUNDARY (the first test): `ix.doorstep` reads its rows in the one snapshot (`doorstepRows`), the connection comes back, and the page is composed after it
// (`doorstepFromRows`). Measured here through the pen's pool: the JSON this call parses is parsed with no pen connection held (red on the one-pass reader, which parsed the
// resident's card, the mail law and the roster inside the transaction), and no statement is issued on a connection after it was released. The answer is the page's, not
// a changed one: test/doorstep-bundle.test.mjs deep-equals every segment against the read it serves.
//
// THE OUTER GUARD (the other two tests, green on main as well, and said so): a doorstep composed with the acts pool a stand-in that records, for every statement,
// whether the pen held a transaction on the asking call chain (`penHeld()`, store-pool.mjs). Any registry or acts read asked WHILE the pen holds its transaction is
// the POS-963/POS-370 shape (a held connection waiting on a second pool).
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
const checkouts = { open: 0, peak: 0, afterRelease: 0 };

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
    const release = c.release.bind(c), query = c.query.bind(c);
    let released = false;
    c.release = (...r) => { checkouts.open -= 1; released = true; return release(...r); };
    c.query = (...q) => { if (released) checkouts.afterRelease += 1; return query(...q); };   // a statement on a connection that was handed back
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

test("THE CORE: ix.doorstep loads its rows under the connection and composes after it is back: no JSON parsed while a pen connection is held, no statement after release", async () => {
  checkouts.afterRelease = 0;
  const parseHeld = [];
  let parses = 0;
  const real = JSON.parse;
  JSON.parse = function (text, ...r) {
    parses += 1;
    // the driver parses a json column itself, inside its own statement: that is the statement's work. What this counts is the PAGE's parsing.
    if (penHeld() && !/node_modules[\\/]pg[\\/]/.test(new Error().stack ?? "")) parseHeld.push(String(text).slice(0, 48));
    return real.call(this, text, ...r);
  };
  let page;
  try { page = await storeIndexPooled(null).doorstep("wright", null, { nowMs: Date.parse("2026-07-12T12:00:00Z"), fresh: { clone: null } }); }
  finally { JSON.parse = real; }
  assert.ok(page && page.handle === "wright", `the doorstep did not compose: ${JSON.stringify(page)?.slice(0, 200)}`);
  assert.ok(parses > 0, "the page parsed nothing: this test is not looking at what it claims to");
  assert.deepEqual(parseHeld, [], `the page parsed ${parseHeld.length} JSON text(s) while the pen held its transaction (the composition ran under the connection): ${JSON.stringify(parseHeld.slice(0, 3))}`);
  assert.equal(checkouts.afterRelease, 0, "a statement was issued on a pen connection after it was released");
  assert.equal(checkouts.open, 0, "a pen connection was still out when the page was composed");
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
