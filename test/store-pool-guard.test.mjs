// store-pool-guard.test.mjs — the guard POS-370 puts on every office pool, on a
// real Postgres: a nested pen ask is refused by name, a pool with nothing to
// give refuses in WORLD2_PG_ACQUIRE_MS instead of hanging, the server ends a
// transaction left idle (and the office survives it), and the watcher sees a
// session idle in transaction.
//
//   node --test test/store-pool-guard.test.mjs

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

import { startStore } from "./helpers/embedded-store.mjs";
import {
  storePoolOptions, acquireMs, idleTxMs, ACQUIRE_MS_DEFAULT, IDLE_TX_MS_DEFAULT,
  NestedStoreError, StoreAcquireTimeout, penHeld,
} from "../src/store-pool.mjs";
import { createStoreTxnWatch, lookOnce } from "../src/store-txn-watch.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tmp = mkdtempSync(join(tmpdir(), "store-pool-guard-"));
let s = null, skip = false;
const KEEP = Object.fromEntries(["WORLD2_PG", "WORLD2_PG_URL", "WORLD2_PG_ACQUIRE_MS", "WORLD2_PG_IDLE_TX_MS"].map((k) => [k, process.env[k]]));
const restore = () => { for (const [k, v] of Object.entries(KEEP)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } };
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));

before(async () => {
  s = await startStore({ db: "pool_guard" });
  if (s.skip) { skip = s.skip; return; }
  Object.assign(process.env, { WORLD2_PG: "1", WORLD2_PG_URL: s.url("office_api") });
});

after(async () => {
  const pen = await import("../src/world2-pen.mjs");
  pen.__setPoolForTest(null);
  if (s?.stop) await s.stop();
  restore();
  rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

/** A pen pool built exactly as the office builds it, from this env, handed to the pen. */
async function penFrom(env) {
  const { default: pg } = await import("pg");
  const pool = new pg.Pool(storePoolOptions({ ...process.env, ...env }, { name: "pen", max: 3 }));
  pool.on("error", () => {});
  const pen = await import("../src/world2-pen.mjs");
  pen.__setPoolForTest(pool);
  return { pool, pen, held: () => pool.totalCount - pool.idleCount, async done() { pen.__setPoolForTest(null); await pool.end().catch(() => {}); } };
}

test("the pool options: the acquire timeout and the idle-transaction limit default, and the env sets them", () => {
  assert.equal(acquireMs({}), ACQUIRE_MS_DEFAULT);
  assert.equal(idleTxMs({}), IDLE_TX_MS_DEFAULT);
  assert.equal(acquireMs({ WORLD2_PG_ACQUIRE_MS: "2500" }), 2500);
  assert.equal(idleTxMs({ WORLD2_PG_IDLE_TX_MS: "0" }), 0, "0 is a real value (no limit)");
  assert.equal(acquireMs({ WORLD2_PG_ACQUIRE_MS: "soon" }), ACQUIRE_MS_DEFAULT, "an unreadable value is the default");
  const o = storePoolOptions({ WORLD2_PG_URL: "postgres://x" }, { name: "pen", max: 3 });
  assert.equal(o.connectionString, "postgres://x");
  assert.equal(o.max, 3);
  assert.equal(o.connectionTimeoutMillis, ACQUIRE_MS_DEFAULT);
  assert.equal(o.idle_in_transaction_session_timeout, IDLE_TX_MS_DEFAULT);
  assert.equal(o.keepAlive, true, "every store connection keeps TCP keepalive on (review-595: the half-open socket)");
  assert.match(o.application_name, /^postmark-office:pen:t\d+$/);
  assert.equal(o.keepAliveInitialDelayMillis, 10_000, "the first keepalive probe is 10 s out, not the kernel's 2 h (POS-821)");
});

// POS-821: the option above is a property; this reads what the KERNEL was told.
// A real pg pool, built by storePoolOptions as the office builds it, dials a
// local server that answers the startup and then says nothing; the client
// socket's keepalive timer is read from /proc/net/tcp (timer 2, expiry in
// 1/100 s). Without the initial delay the timer is the kernel's tcp_keepalive_time
// (7200 s = 720000 ticks here); with it, about 10 s. This proves the setting
// reaches the socket. How long a dead peer then takes to be found (about 11 s
// of probes on top) needs a peer that stops answering, which a local server
// cannot be, so that figure is the PR's measurement in a network namespace,
// not this test's claim.
test("a pool connection's kernel keepalive timer is the initial delay, not the kernel's two hours", { skip: process.platform !== "linux" && "reads /proc/net/tcp (Linux only)" }, async () => {
  const { createServer } = await import("node:net");
  const { default: pg } = await import("pg");
  const sockets = new Set();
  const server = createServer((c) => {
    sockets.add(c);
    c.on("error", () => {});
    c.once("data", () => c.write(Buffer.from([0x52, 0, 0, 0, 8, 0, 0, 0, 0, 0x5a, 0, 0, 0, 5, 0x49]))); // AuthenticationOk, ReadyForQuery
  });
  await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
  const pool = new pg.Pool(storePoolOptions({ WORLD2_PG_URL: `postgres://u@127.0.0.1:${server.address().port}/d` }, { name: "pen", max: 1 }));
  pool.on("error", () => {});
  let client = null;
  try {
    client = await pool.connect();
    const port = client.connection.stream.localPort;
    const row = readFileSync("/proc/net/tcp", "utf8").split("\n").slice(1)
      .map((l) => l.trim().split(/\s+/))
      .find((f) => f[1]?.endsWith(`:${port.toString(16).toUpperCase().padStart(4, "0")}`));
    assert.ok(row, `the client socket (port ${port}) is in /proc/net/tcp`);
    const [timer, ticks] = row[5].split(":").map((x) => parseInt(x, 16));
    assert.equal(timer, 2, "the socket's running timer is the keepalive timer");
    assert.ok(ticks > 0 && ticks <= 1_100, `the first probe is due in ${ticks / 100} s; the kernel default would be 7200 s`);
  } finally {
    client?.release();
    await pool.end().catch(() => {});
    for (const c of sockets) c.destroy();
    await new Promise((ok) => server.close(ok));
  }
});

// POS-821: the pen's pool is built lazily, and `await import("pg")` yields. These
// drive the pen's real doors (officeRead) with no pool injected, so they
// traverse pool() itself; the real pg.Pool is wrapped only to COUNT
// constructions (its own behaviour is unchanged), and every pool built is ended
// below. The store is a closed port: no pool here ever reaches a database, and
// each door's refusal is the store being unreachable, which is not what is judged.
async function countingPg(failFirst = false) {
  const { default: pg } = await import("pg");
  const Real = pg.Pool;
  const built = [];
  let asked = 0;
  pg.Pool = class extends Real {
    constructor(o) {
      asked++;
      if (failFirst && asked === 1) throw new Error("the first construction fails");
      super(o);
      built.push(this);
    }
  };
  return {
    asked: () => asked, built,
    async done() { pg.Pool = Real; await Promise.all(built.map((p) => p.end().catch(() => {}))); },
  };
}
const NO_STORE_ENV = { WORLD2_PG: "1", WORLD2_PG_URL: "postgres://u@127.0.0.1:1/d" };
const fiveFirstCallers = (pen, env) => Promise.allSettled(Array.from({ length: 5 }, () => pen.officeRead(async (c) => c.query("SELECT 1"), { env })));

test("simultaneous first requests to the pen build one pool, and a later request builds none", async () => {
  const pen = await import("../src/world2-pen.mjs");
  pen.__setPoolForTest(null);
  const count = await countingPg();
  try {
    const first = await fiveFirstCallers(pen, NO_STORE_ENV);
    assert.equal(count.asked(), 1, "five callers that arrived before the first pool was built share its construction");
    assert.equal(count.built.length, 1);
    for (const r of first) assert.equal(r.status, "rejected", "the closed port refuses each, as the unreachable store it is");
    await fiveFirstCallers(pen, NO_STORE_ENV);
    assert.equal(count.asked(), 1, "the pool built is the pool kept");
  } finally { pen.__setPoolForTest(null); await count.done(); }
});

test("a first construction that fails fails every caller that was waiting on it, and the next caller builds afresh", async () => {
  const pen = await import("../src/world2-pen.mjs");
  pen.__setPoolForTest(null);
  const count = await countingPg(true);
  try {
    const first = await fiveFirstCallers(pen, NO_STORE_ENV);
    assert.deepEqual(first.map((r) => r.status), Array(5).fill("rejected"));
    for (const r of first) assert.match(r.reason.message, /the first construction fails/);
    assert.equal(count.asked(), 1, "the five shared the one failing construction");
    assert.equal(count.built.length, 0, "a failed construction left no pool");
    const again = await fiveFirstCallers(pen, NO_STORE_ENV);
    assert.equal(count.asked(), 2, "the failure was forgotten: one fresh construction, shared");
    assert.equal(count.built.length, 1);
    for (const r of again) assert.doesNotMatch(String(r.reason?.message), /the first construction fails/);
  } finally { pen.__setPoolForTest(null); await count.done(); }
});

test("an office pointed at no record refuses by name at once and builds no pool, however many ask", async () => {
  const pen = await import("../src/world2-pen.mjs");
  pen.__setPoolForTest(null);
  const count = await countingPg();
  try {
    const refused = await fiveFirstCallers(pen, {});
    for (const r of refused) assert.equal(r.reason?.name, "NoRecordError");
    assert.equal(count.asked(), 0, "nothing was built, so nothing dialled");
    const later = await fiveFirstCallers(pen, NO_STORE_ENV);
    assert.equal(count.asked(), 1, "the refusal left nothing behind: the next office that is pointed at a record builds its one pool");
    assert.equal(later.length, 5);
  } finally { pen.__setPoolForTest(null); await count.done(); }
});

test("every office pool is built with the options: no bare new pg.Pool left in src", () => {
  // the pen, the acts and stance pools, claims, serve and paperwork: a pool
  // built without the options would hang where the others refuse
  for (const f of ["world2-pen.mjs", "world2-acts.mjs", "world2-claims.mjs", "world2-serve.mjs", "paperwork.mjs"]) {
    // code lines only: a comment may quote the bare constructor it warns about
    const code = readFileSync(join(ROOT, "src", f), "utf8").split(/\r?\n/).filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
    const pools = code.match(/new pg\.Pool\(([^)]*\)?)/g) ?? [];
    assert.ok(pools.length > 0, `${f} builds a pool`);
    for (const p of pools) assert.match(p, /storePoolOptions\(/, `${f}: ${p}`);
  }
});

test("a pen connection reaches the store with the server-side idle-transaction limit and its pool's name", async (t) => {
  if (skip) return t.skip(skip);
  const pen = await penFrom({});
  try {
    const got = await pen.pen.officeRead(async (c) => ({
      idle: (await c.query("SHOW idle_in_transaction_session_timeout")).rows[0].idle_in_transaction_session_timeout,
      app: (await c.query("SELECT current_setting('application_name') AS a")).rows[0].a,
    }));
    assert.equal(got.idle, "30s");
    assert.match(got.app, /^postmark-office:pen:t\d+$/);
  } finally { await pen.done(); }
});

test("a call that holds a pen connection and asks for another is refused at once, by name, and gives its own back", async (t) => {
  if (skip) return t.skip(skip);
  const pen = await penFrom({});
  try {
    const started = Date.now();
    await assert.rejects(pen.pen.officeRead(async () => pen.pen.officeRead(async (c) => c.query("SELECT 1"))),
      (e) => e instanceof NestedStoreError && /officeRead asked the store's pen for a connection while this call already holds one \(officeRead\)/.test(e.message));
    await assert.rejects(pen.pen.officeRead(async () => pen.pen.officeWrite(async (c) => c.query("SELECT 1"))), NestedStoreError);
    await assert.rejects(pen.pen.officeWrite(async () => pen.pen.officeRead(async (c) => c.query("SELECT 1"))), NestedStoreError);
    assert.ok(Date.now() - started < 5000, "refused, not waited out");
    assert.equal(pen.held(), 0, "the outer connection came back");
    assert.equal(penHeld(), null, "nothing is marked held after");
    // two requests at once are two chains: neither is refused
    const both = await Promise.all([1, 2].map((n) => pen.pen.officeRead(async (c) => (await c.query("SELECT $1::int AS n", [n])).rows[0].n)));
    assert.deepEqual(both, [1, 2]);
    // work a read started and did not await is not holding once the read is done
    let later = null;
    await pen.pen.officeRead(async () => { later = (async () => { await sleep(50); return pen.pen.officeRead(async (c) => (await c.query("SELECT 7 AS n")).rows[0].n); })(); });
    assert.equal(await later, 7);
    assert.equal(pen.held(), 0);
  } finally { await pen.done(); }
});

test("a pool with nothing to give refuses within the acquire timeout, naming the pool, instead of waiting", async (t) => {
  if (skip) return t.skip(skip);
  // 2 s, not less: the timeout also bounds the dial, and under a full suite a
  // fresh embedded-Postgres connection on Windows can take most of a second
  const pen = await penFrom({ WORLD2_PG_ACQUIRE_MS: "2000" });
  try {
    let open;
    const gate = new Promise((ok) => { open = ok; });
    const holders = [1, 2, 3].map(() => pen.pen.officeRead(async (c) => { await c.query("SELECT 1"); await gate; return "held"; }));
    holders.forEach((h) => h.catch(() => {})); // judged below; never an unhandled rejection meanwhile
    for (let i = 0; i < 40 && pen.held() < 3; i++) await sleep(100);
    assert.equal(pen.held(), 3);
    const started = Date.now();
    await assert.rejects(pen.pen.officeRead(async (c) => c.query("SELECT 1")),
      (e) => e instanceof StoreAcquireTimeout && /the store's pen pool had no free connection within 2000 ms \(it holds 3\)/.test(e.message));
    const waited = Date.now() - started;
    assert.ok(waited >= 1800 && waited < 8000, `refused after ${waited} ms`);
    open();
    assert.deepEqual(await Promise.all(holders), ["held", "held", "held"]);
    assert.equal(pen.held(), 0);
  } finally { await pen.done(); }
});

test("a transaction left idle is ended by the server; the call fails, the office lives, and the pool serves the next call", async (t) => {
  if (skip) return t.skip(skip);
  const pen = await penFrom({ WORLD2_PG_IDLE_TX_MS: "300" });
  try {
    await assert.rejects(pen.pen.officeRead(async (c) => { await c.query("SELECT 1"); await sleep(1200); return (await c.query("SELECT 2")).rows; }));
    assert.equal(pen.held(), 0, "the ended connection is not held");
    assert.equal(await pen.pen.officeRead(async (c) => (await c.query("SELECT 3 AS n")).rows[0].n), 3, "the next call is served");
  } finally { await pen.done(); }
});

test("the watcher sees an office_api session idle in transaction, and not once it commits", async (t) => {
  if (skip) return t.skip(skip);
  const stuck = await s.connect("office_api");
  const looker = await s.connect("office_api");
  try {
    await stuck.query("BEGIN READ ONLY");
    await stuck.query("SELECT 'the progress read' AS q");
    await sleep(1300);
    const seen = await lookOnce(looker, { stuckAfterS: 1 });
    assert.equal(seen.stuck.length, 1, JSON.stringify(seen));
    assert.match(seen.stuck[0].query, /the progress read/);
    assert.ok(seen.stuck[0].idle_s >= 1);
    assert.ok((seen.sessions["idle in transaction"] ?? 0) >= 1);
    await stuck.query("COMMIT");
    assert.equal((await lookOnce(looker, { stuckAfterS: 1 })).stuck.length, 0);
  } finally { await stuck.end(); await looker.end(); }
});

test("the watcher counts only its own database's sessions: the same role idle in a transaction in another database is not this store's", async (t) => {
  if (skip) return t.skip(skip);
  // A second database on the same server, as every file's store is on a pool tree's shared server (POS-479).
  const other = `${s.database}_other`.slice(0, 63);
  const su = await s.connect("postgres", "postgres");
  await su.query(`CREATE DATABASE "${other}" OWNER world2_owner`);
  const elsewhere = await s.connect("office_api", other);
  const looker = await s.connect("office_api");
  try {
    await elsewhere.query("BEGIN READ ONLY");
    await elsewhere.query("SELECT 'another file''s read' AS q");
    await sleep(1300);
    const seen = await lookOnce(looker, { stuckAfterS: 1 });
    assert.deepEqual(seen.stuck, [], JSON.stringify(seen));
    assert.equal(seen.sessions["idle in transaction"] ?? 0, 0, JSON.stringify(seen.sessions));
  } finally {
    await elsewhere.end(); await looker.end();
    await su.query(`DROP DATABASE IF EXISTS "${other}" WITH (FORCE)`).catch(() => {});
    await su.end();
  }
});

test("calm_at moves only on a minute the store answered with nothing stuck", async () => {
  let t0 = Date.parse("2026-10-04T19:30:00Z");
  const answers = [
    { stuck: [], sessions: { idle: 3 } },
    { stuck: [{ pid: 1, idle_s: 61, query: "SELECT … town_quest_progress" }], sessions: { "idle in transaction": 1 } },
    new Error("connect ECONNREFUSED"),
    { stuck: [], sessions: {} },
  ];
  const file = join(tmp, "store-txn-0.json");
  const w = createStoreTxnWatch({ file, now: () => t0, look: async () => { const a = answers.shift(); if (a instanceof Error) throw a; return a; } });
  await w.tick();
  assert.equal(w.read().calm_at, "2026-10-04T19:30:00.000Z");
  t0 += 60_000; await w.tick();
  assert.equal(w.read().calm_at, "2026-10-04T19:30:00.000Z", "a stuck minute is not calm");
  assert.equal(w.read().last_minute.stuck, 1);
  assert.equal(w.read().worst_24h.stuck, 1);
  t0 += 60_000; await w.tick();
  assert.equal(w.read().calm_at, "2026-10-04T19:30:00.000Z", "a minute it could not ask is not calm");
  assert.equal(w.read().last_minute.looked, false);
  t0 += 60_000; await w.tick();
  assert.equal(w.read().calm_at, "2026-10-04T19:33:00.000Z");
  // a restart carries the last calm minute; it does not make the store calm by itself
  const again = createStoreTxnWatch({ file, now: () => t0, look: async () => ({ stuck: [{ pid: 2 }], sessions: {} }) });
  assert.equal(again.read().calm_at, "2026-10-04T19:33:00.000Z");
});

test("the roll-call watches the file: office_api idle in transaction for 5 minutes is an alarm", () => {
  const manifest = JSON.parse(readFileSync(join(ROOT, "deploy", "box-rollcall-manifest.json"), "utf8"));
  const row = manifest.units.find((r) => r.heartbeat?.path === "/srv/postmark-office/telemetry/store-txn-4380.json");
  assert.ok(row, "a roll-call row reads the watcher's file");
  assert.equal(row.unit, "postmark-office.service");
  assert.equal(row.heartbeat.kind, "state_file");
  assert.equal(row.heartbeat.stamp_field, "calm_at");
  assert.equal(row.heartbeat.stale_after_minutes, 5);
});
