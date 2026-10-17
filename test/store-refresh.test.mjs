// store-refresh.test.mjs — the poll's store read: one in flight, bounded in
// Postgres, and never more than its own two connections (POS-639; the reviews
// of office#591 and #595).
//
// THE DEFECTS THIS CLOSES. office#591 gave the poll a guard so a tick skips
// while the last roll+probe pair is still reading, with no time bound: one hung
// read would have stopped every index refresh, silently. #595's first answer
// freed the guard at a JS bound but left the connections held, so a slow store
// let the poll take a third connection and queue for a fourth. The pen pool is
// three per thread and serves every resident read and write there. Now each
// read carries statement_timeout, and the guard waits for the read to settle.
//
// THE FLIPS: free the guard at the JS bound again (the #595 shape) and § 4's
// connection count passes 2; drop the statement timeout and § 4's reads never
// settle while the store is locked.

import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { storeRefresher, STORE_READ_BOUND_MS } from "../src/store-refresh.mjs";
import { fixtureDb } from "./fixture.mjs";
import { startStore } from "./helpers/embedded-store.mjs";
import { copyIndexToStore } from "./helpers/index-to-store.mjs";

test("1 · a read past the bound holds the guard until it settles: ticks skip, the bound is named once, and the next tick reads", { timeout: 5_000 }, async (t) => {
  // The bound's timer is unref'd, as it must be in the office (a pending bound
  // never keeps a process up), so something must hold the event loop open the
  // way the office's own server does; node 22 otherwise cancels the file.
  const alive = setInterval(() => {}, 1_000);
  t.after(() => clearInterval(alive));
  const lines = [];
  let reads = 0, applied = 0, settle;
  const r = storeRefresher({
    read: () => (++reads === 1 ? new Promise((_ok, no) => { settle = no; }) : Promise.resolve()),
    onRead: () => { applied++; },
    boundMs: 50,
    log: (l) => lines.push(l),
  });

  const first = r.tick();
  await new Promise((ok) => setTimeout(ok, 120));
  assert.equal(r.inFlight(), true, "the guard holds while the read holds its connection");
  assert.equal(await r.tick(), "skipped");
  assert.equal(reads, 1, "no second read while the first is still out");
  assert.deepEqual(lines, ["[office] the store read has not answered within 0.05s — it is still reading; each statement is bounded at 0.05s, and the poll waits for it before reading again"]);

  // the store's statement timeout ends the read: the guard frees, and the next tick reads
  settle(Object.assign(new Error("canceling statement due to statement timeout"), { code: "57014" }));
  assert.equal(await first, "late");
  assert.equal(r.inFlight(), false);
  assert.equal(applied, 1, "onRead runs after a refused read, as the poll's swallowed errors always did");
  assert.equal(await r.tick(), "read");
  assert.equal(reads, 2);
  assert.equal(lines.length, 1, "an answered read logs nothing");
});

test("2 · one store read in flight: a tick while the last read is still reading skips", async () => {
  let release, reads = 0;
  const r = storeRefresher({ read: () => { reads++; return new Promise((ok) => { release = ok; }); }, boundMs: 5_000 });
  const first = r.tick();
  assert.equal(r.inFlight(), true);
  assert.equal(await r.tick(), "skipped");
  assert.equal(reads, 1, "the skipped tick started no second read");
  release();
  assert.equal(await first, "read");
  assert.equal(r.inFlight(), false);
});

test("3 · the poll's bound is the boot path's: 10 s", () => {
  assert.equal(STORE_READ_BOUND_MS, 10_000);
});

// ── 4 · against a real store: a locked index, the real roll and probe reads ──

let s = null, skip = false, tmp = null;
before(async () => {
  s = await startStore();
  if (s.skip) { skip = s.skip; return; }
  tmp = mkdtempSync(join(tmpdir(), "store-refresh-"));
  const db = fixtureDb(join(tmp, "office.db"));
  const w = await s.connect("law_ingester");
  try { await copyIndexToStore(w, db); } finally { await w.end(); db.close(); }
});
after(async () => {
  await s?.stop?.();
  if (tmp) rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

test("4 · a store that will not answer never lets the poll hold more than its two connections, and Postgres frees them at the bound", { timeout: 30_000 }, async (t) => {
  if (skip) return t.skip(skip);
  const keep = process.env.TOWN_INDEX_READS;
  process.env.TOWN_INDEX_READS = "store";
  const { default: pg } = await import("pg");
  const tis = await import("../src/town-index-store.mjs");
  // the pen's own shape: three connections per thread (world2-pen.mjs § pool)
  const pool = new pg.Pool({ connectionString: s.url("office_api"), max: 3 });
  pool.on("error", () => {});
  tis.__setTownIndexPoolForTest(pool);
  tis.__resetRosterForTest(); tis.__resetProbeForTest();
  const locker = await s.connect("law_ingester");
  const alive = setInterval(() => {}, 1_000);
  t.after(async () => {
    clearInterval(alive);
    tis.__setTownIndexPoolForTest(null);
    await locker.end().catch(() => {});
    await pool.end().catch(() => {});
    if (keep === undefined) delete process.env.TOWN_INDEX_READS; else process.env.TOWN_INDEX_READS = keep;
  });

  // the index tables locked, as a stuck ingest or a slow disk would hold them
  await locker.query("BEGIN");
  await locker.query("LOCK TABLE town_residents, town_meta IN ACCESS EXCLUSIVE MODE");

  const BOUND = 300;
  const lines = [];
  let reads = 0, applied = 0;
  const r = storeRefresher({
    read: () => { reads++; return Promise.all([
      tis.refreshStoreRoll({ statementTimeoutMs: BOUND }).catch(() => {}),
      tis.refreshStoreProbe({ statementTimeoutMs: BOUND }).catch(() => {}),
    ]); },
    onRead: () => { applied++; },
    boundMs: BOUND,
    log: (l) => lines.push(l),
  });

  // the poll's clock, run fast: a tick every 25 ms for two seconds
  let maxHeld = 0, maxWaiting = 0;
  const sample = setInterval(() => {
    maxHeld = Math.max(maxHeld, pool.totalCount - pool.idleCount);
    maxWaiting = Math.max(maxWaiting, pool.waitingCount);
  }, 5);
  const ticks = [];
  const clock = setInterval(() => { ticks.push(r.tick()); }, 25);
  await new Promise((ok) => setTimeout(ok, 2_000));
  clearInterval(clock);
  // the last read settles within its bound; one that never does is the defect, said below
  await Promise.race([Promise.all(ticks), new Promise((ok) => setTimeout(ok, BOUND * 4))]);
  clearInterval(sample);

  assert.ok(maxHeld <= 2, `the poll held ${maxHeld} of the pen's three connections; it may hold its pair's two, never more`);
  assert.equal(maxWaiting, 0, "no tick queued for a connection behind the poll's own pair");
  assert.ok(reads >= 3, `the store's statement timeout ended each read at the bound, so the poll read again (${reads} reads in 2 s)`);
  assert.ok(lines.length >= 1 && /has not answered within 0\.3s/.test(lines[0]), "the bound is named in the journal");

  // the store answers again: the next tick reads the index
  await locker.query("ROLLBACK");
  const before = applied;
  assert.notEqual(await r.tick(), "skipped");
  assert.equal(applied, before + 1);
  assert.ok(tis.storeProbeAsOf(), "the probe was read once the store answered");
});
