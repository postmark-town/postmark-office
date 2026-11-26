// pos1098-residents-cache.test.mjs — the bare /residents list reuses its expensive work (POS-1098).
//
//   EMBEDDED_PG_DIR=<dir with embedded-postgres> node --test test/pos1098-residents-cache.test.mjs
//
// MEASURED FIRST (scratch, a real Postgres seeded with 389 cards of ~125 KB, the box's shape; node v22): a WARM bare read (the roster memo hit) costs about
// 4 ms of main-thread CPU and three statements; the COLD read after a head move costs about 230 ms of CPU, 26-48 MB read and parsed, once per thread per head,
// and every read that arrived before the first finished did it again. So the work worth reusing is (1) the roster's cold load, shared by the reads that
// overlap it, and (2) the composed page, kept per (head, ask). Neither may freeze what moves faster than the head: last_active is read again for every answer,
// onto the reader's OWN copy of the kept page.
//
// The store is a real Postgres, the residents are invented, and the counters are the module's own (town-index-store.mjs § residentCacheStats).
// Falsifiers (run, then restored): keep no page and the reuse test goes red; share no cold load and the overlap test goes red.

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { fixtureTown, putValues } from "./fixture.mjs";
import { startStore } from "./helpers/embedded-store.mjs";
import { seedTownIndex } from "./helpers/index-to-store.mjs";
import * as store from "../src/town-index-store.mjs";
import { residentPageOf } from "../src/queries.mjs";
import { stampRowsOn } from "../src/last-active.mjs";

let s = null, skip = false;
const AS_OF_1 = "pos1098sha1000000000000000000000000000000";
const AS_OF_2 = "pos1098sha2000000000000000000000000000000";

const card = (handle, joined, extra = {}) => JSON.stringify({ handle, display: `Resident ${handle}`, address: { data: { joined, ...extra }, body: `# ${handle}` }, boxes: "x".repeat(2000) });
const HANDLES = ["amber", "birch", "cedar", "dune", "elm", "fern", "grove", "heath"];
function townAt(asOf, over = {}) {
  const db = fixtureTown();
  db.residents = [];                                              // only the invented roll
  HANDLES.forEach((h, i) => putValues(db, "residents", [h, over[h] ?? card(h, `2026-0${1 + i}-01`, h === "cedar" ? { office: "true" } : {})]));
  putValues(db, "residents", ["_archived", JSON.stringify({ handle: "_archived", address: { data: { joined: "2026-07-13" } } })]);   // on the table, never on the roll
  db.meta = db.meta.filter((r) => r.key !== "as_of");
  putValues(db, "meta", ["as_of", asOf]);
  return db;
}
async function seed(db) { const w = await s.connect("law_ingester"); await seedTownIndex(w, db); await w.end(); }

before(async () => {
  s = await startStore();
  if (s.skip) { skip = s.skip; return; }
  process.env.WORLD2_PG = "1";
  process.env.WORLD2_PG_URL = s.url("office_api");
  await seed(townAt(AS_OF_1));
});
after(async () => { if (s?.stop) await s.stop(); });
const fresh = () => store.__resetRosterForTest();
const page = async (opts = {}) => (await store.storeAnswer((c) => store.residentPage(c, opts))).out;
/** The same page composed with nothing kept: the roll's lines straight through the page's own shaper. */
const uncached = async (opts = {}) => (await store.storeAnswer(async (c) => residentPageOf(await store.residentList(c), opts))).out;

test("UNCHANGED REPEATED BARE READS REUSE THE WORK: one cold roster load, one composition, then hits; every answer is the uncached one", async (t) => {
  if (skip) return t.skip(skip);
  fresh();
  const want = await uncached();
  fresh();
  const reads = [await page(), await page(), await page(), await page()];
  for (const r of reads) assert.deepEqual(r, want, "a hit answers exactly what composing it fresh does");
  assert.deepEqual(store.residentCacheStats(), { page_hits: 3, page_misses: 1, roster_loads: 1, roster_shared: 0 }, "the first read composed it, the other three reused it");
  assert.deepEqual(want.residents.map((r) => r.handle), HANDLES, "the roll: the shelf is not on it, and the order is the roster's");
  assert.equal(want.town_total, HANDLES.length);
});

test("EACH READER HAS ITS OWN COPY: what a door writes onto its answer never reaches the kept page", async (t) => {
  if (skip) return t.skip(skip);
  fresh();
  const first = await page();
  first.residents[0].last_active = "2099-01-01T00:00:00.000Z";
  first.residents.push({ handle: "intruder" });
  first.total = 999;
  const second = await page();
  assert.ok(!("last_active" in second.residents[0]), "the stamp the first reader wrote is not in the kept page");
  assert.equal(second.residents.length, HANDLES.length);
  assert.equal(second.total, HANDLES.length);
  assert.equal(store.residentCacheStats().page_hits, 1, "and the second read was a hit");
});

test("THE HEAD'S IDENTITY ALONE FREEZES NOTHING: last_active is read again for every answer, onto the reader's own copy of the kept page", async (t) => {
  if (skip) return t.skip(skip);
  fresh();
  // the store's acts as a stand-in client: the answer to the last-active statement is whatever the acts say at that moment
  const actsSay = (at) => ({ query: async (sql) => (/SAVEPOINT/.test(sql) ? { rows: [] } : { rows: [{ handle: "amber", at, src: "act", what: "say" }] }) });
  const a = await page();
  await stampRowsOn(actsSay("2026-11-23T10:00:00.000Z"), a.residents);
  const b = await page();                                              // a hit: the head has not moved
  await stampRowsOn(actsSay("2026-11-23T10:05:00.000Z"), b.residents); // a newer act, the same head
  assert.equal(a.residents[0].last_active, "2026-11-23T10:00:00.000Z");
  assert.equal(b.residents[0].last_active, "2026-11-23T10:05:00.000Z", "the newer act is shown though the head did not move");
  assert.equal(store.residentCacheStats().page_hits, 1);
});

test("EVERY ASK IS ITS OWN KEY AND ITS OWN ANSWER: limit, offset, since and office, each equal to composing it fresh; the kept asks are bounded", async (t) => {
  if (skip) return t.skip(skip);
  fresh();
  const asks = [{}, { limit: 3 }, { limit: 3, offset: 3 }, { since: "2026-04-01" }, { office: true }, { office: false }, { limit: "2", offset: "1" }, { since: "2026-03-01", office: false }];
  for (const o of asks) {
    const miss = await page(o), hit = await page(o);
    assert.deepEqual(hit, miss, `${JSON.stringify(o)}: a hit equals its miss`);
    assert.deepEqual(miss, await uncached(o), `${JSON.stringify(o)}: and equals composing it fresh`);
  }
  assert.equal((await page({ office: true })).residents.map((r) => r.handle).join(), "cedar");
  // the ask is the caller's, so the number kept must not be: many distinct asks never grow it past its bound, and each answer stays right
  fresh();
  for (let n = 1; n <= 40; n++) assert.equal((await page({ limit: n })).shown, Math.min(n, HANDLES.length));
  const before = store.residentCacheStats().page_misses;
  assert.equal((await page({ limit: 1 })).shown, 1);
  assert.equal(store.residentCacheStats().page_misses, before + 1, "the oldest ask was let go (bounded), and it is composed again, correctly");
});

test("A NEW HEAD IS A NEW KEY: the page is composed again from the new roster, and the old page is not served", async (t) => {
  if (skip) return t.skip(skip);
  fresh();
  const old = await page();
  assert.equal(old.residents.find((r) => r.handle === "amber").display, "Resident amber");
  await seed(townAt(AS_OF_2, { amber: card("amber", "2026-01-01", { github: "a" }).replace("Resident amber", "Amber, renamed") }));
  try {
    const next = await page();
    assert.equal(next.residents.find((r) => r.handle === "amber").display, "Amber, renamed", "the new head's roster, not the kept page");
    assert.deepEqual(store.residentCacheStats().page_misses, 2, "composed again for the new head");
    assert.equal((await page()).residents.find((r) => r.handle === "amber").display, "Amber, renamed");
    assert.equal(store.residentCacheStats().page_hits, 1);
  } finally { await seed(townAt(AS_OF_1)); fresh(); }
});

test("A FAILED READ IS NOT KEPT AND POISONS NOTHING: the reader's error is its own, and the next read loads and composes as if the first had not happened", async (t) => {
  if (skip) return t.skip(skip);
  fresh();
  const failing = { query: async (sql) => { if (/FROM town_residents/.test(sql)) throw new Error("the store dropped the cards read (a test)"); return { rows: [{ value: AS_OF_1 }] }; } };
  await assert.rejects(store.residentPage(failing, {}), /the store dropped the cards read/);
  assert.deepEqual(store.residentCacheStats().roster_loads, 0, "nothing was loaded");
  assert.deepEqual(await page(), await uncached());
  assert.equal(store.residentCacheStats().roster_loads, 1, "the next read loaded once");
});

test("READS THAT OVERLAP A COLD LOAD SHARE IT: four at once make one read of the cards and one parse, each answers the uncached page, and a failed load is not shared", async (t) => {
  if (skip) return t.skip(skip);
  fresh();
  const want = await uncached({ limit: 8 });
  const want5 = await uncached({ limit: 5 });
  fresh();
  // the cards read is held a moment, so the four reads genuinely overlap it (a real cold read is 26-48 MB, hundreds of ms)
  const slowCards = (c) => new Proxy(c, { get(tg, k) { if (k !== "query") { const v = tg[k]; return typeof v === "function" ? v.bind(tg) : v; }
    return async (sql, ...a) => { if (/FROM town_residents/.test(sql)) await new Promise((ok) => setTimeout(ok, 80)); return tg.query(sql, ...a); }; } });
  const slowPage = async (opts) => (await store.storeAnswer((c) => store.residentPage(slowCards(c), opts))).out;
  const reads = await Promise.all([slowPage({ limit: 8 }), slowPage({ limit: 7 }), slowPage({ limit: 6 }), slowPage({ limit: 5 })]);
  assert.deepEqual(reads.map((r) => r.shown), [8, 7, 6, 5]);
  assert.deepEqual(reads[0], want);
  assert.deepEqual(reads[3], want5);
  const st = store.residentCacheStats();
  assert.equal(st.roster_loads, 1, "one read of every card, not four");
  assert.equal(st.roster_loads + st.roster_shared, 4, "the other three took its entries");
  // a load that fails reaches its own reader only: an overlapping read does its own load
  fresh();
  let n = 0;
  const flaky = (c) => new Proxy(c, { get(tg, k) { if (k !== "query") { const v = tg[k]; return typeof v === "function" ? v.bind(tg) : v; }
    return async (sql, ...a) => { if (/FROM town_residents/.test(sql) && n++ === 0) { await new Promise((ok) => setTimeout(ok, 30)); throw new Error("the first load failed (a test)"); } return tg.query(sql, ...a); }; } });
  const [first, second] = await Promise.allSettled([store.storeAnswer((c) => store.residentPage(flaky(c), {})), store.storeAnswer((c) => store.residentPage(flaky(c), {}))]);
  assert.equal(first.status, "rejected", "the load's own reader sees its error");
  assert.equal(second.status, "fulfilled", "the read that waited on it did its own load");
  assert.deepEqual(second.value.out, await uncached({}));
});
