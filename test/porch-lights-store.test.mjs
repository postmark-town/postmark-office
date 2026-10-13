// porch-lights-store.test.mjs — WLD-29, the pointer model: THE BOUNDED BATCH,
// ON A REAL POSTGRES, BEHIND A REAL LOCK.
//
// The activity batch (household-activity.mjs) is the one piece of store work a
// default read can now wait on. The approved rework bounds it twice:
//   · a CALLER waits about CALLER_WAIT_MS (1.5 s), then is told
//     `unavailable` by name — while the batch runs on and fills the cache for
//     the next reader, and no second batch starts;
//   · the BATCH runs in its own read-only transaction with SET LOCAL
//     statement_timeout BATCH_STATEMENT_TIMEOUT_MS (5 s): a statement stuck
//     behind a lock is cancelled by Postgres, rolled back, and its connection
//     handed back to the pool — never left holding the pen.
//
// A zero-latency JS stub cannot show either, so this file holds the batch to
// them on the suite's own Postgres (embedded-store.mjs; OFFICE_STORE_SERVER=own
// gives the file a server of its own), with synthetic rows only. A SEPARATE
// connection takes `LOCK TABLE acts IN ACCESS EXCLUSIVE MODE`, and the test
// SEES the batch's last-active statement wait on it (pg_stat_activity:
// wait_event_type = 'Lock') before it asserts anything about time. Every test
// starts COLD (resetActivityCache), so a warm cache is never mistaken for a
// bound. Timings are measured, with tolerances, not read off the constants.

import test, { after, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { startStore } from "./helpers/embedded-store.mjs";
import { seedRegistry } from "./helpers/office-under-test.mjs";
import { storePoolOptions } from "../src/store-pool.mjs";
import { currentCrossing, CROSSING_MS } from "../src/crossings.mjs";
import {
  readHouseholdActivity, resetActivityCache, lightsAnswer,
  ACTIVITY_SLOW, CALLER_WAIT_MS, BATCH_STATEMENT_TIMEOUT_MS,
} from "../src/household-activity.mjs";

const APP = "porch-test";
let A = null, B = null;   // two stores: B is the injected-isolation witness
const pools = [];
const holders = [];

/** Seed a store: two declared houses and a solo resident; `kinAgo` is how long ago ash-kin acted. */
async function seed(store, { kinAgoMs = 0 } = {}) {
  await seedRegistry(store, { schema_version: 1, households: {
    "ash-house": { residents: ["ash", "ash-kin"], accounts: [{ login: "ash-gh", id: 101 }], since: "2026-06-12", declared_by: "ash" },
    "birch-house": { residents: ["birch"], accounts: [{ login: "birch-gh", id: 102 }], since: "2026-06-12", declared_by: "birch" },
  } }, {});
  const c = await store.connect("world2_owner");
  try {
    await c.query("INSERT INTO projection_heads (repo, sha, ingested_at) VALUES ('town', 'porch-town-1', now()) ON CONFLICT (repo) DO UPDATE SET sha = EXCLUDED.sha");
    await c.query("INSERT INTO town_roll (town_sha, handle) VALUES ('porch-town-1', 'ash'), ('porch-town-1', 'birch'), ('porch-town-1', 'dune') ON CONFLICT DO NOTHING");
    await c.query(`INSERT INTO acts (at, actor, action, class) VALUES
      (now() - ($1::bigint * interval '1 millisecond'), 'ash-kin', 'say', 'voice'),
      (now() - interval '5 days', 'birch', 'walk', 'walk'),
      (now(), 'dune', 'say', 'voice')`, [kinAgoMs]);
  } finally { await c.end(); }
}

/** A pool as the office builds its pen (storePoolOptions), on office_api, counting its connections. */
function countedPool(store) {
  const p = new pg.Pool(storePoolOptions({}, { name: APP, max: 3, connectionString: store.url("office_api") }));
  p.on("error", () => {});
  let connects = 0;
  const connect = p.connect.bind(p);
  p.connect = (...a) => { connects += 1; return connect(...a); };
  p.connects = () => connects;
  pools.push(p);
  return p;
}

/** A separate connection holding `acts` exclusively until released. */
async function lockActs(store) {
  const c = await store.connect("world2_owner");
  await c.query("BEGIN");
  await c.query("LOCK TABLE acts IN ACCESS EXCLUSIVE MODE");
  const pid = (await c.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
  const h = { pid, released: false, async release() { if (h.released) return; h.released = true; await c.query("COMMIT"); await c.end(); } };
  holders.push(h);
  return h;
}

/** This test pool's sessions on the store, as the server sees them. */
async function ours(store) {
  const o = await store.connect("postgres");
  try {
    return (await o.query(`SELECT pid, state, wait_event_type, query FROM pg_stat_activity
      WHERE datname = $1 AND application_name LIKE $2`, [store.database, `postmark-office:${APP}:%`])).rows;
  } finally { await o.end(); }
}
const waitingOnLock = (rows) => rows.filter((r) => r.wait_event_type === "Lock" && /FROM acts/.test(r.query));
async function until(fn, { ms = 8000, every = 50 } = {}) {
  const t0 = performance.now();
  for (;;) {
    const v = await fn();
    if (v) return performance.now() - t0;
    if (performance.now() - t0 > ms) throw new Error("waited too long");
    await new Promise((r) => setTimeout(r, every));
  }
}
async function rollbacks(store) {
  const o = await store.connect("postgres");
  try { return Number((await o.query("SELECT xact_rollback FROM pg_stat_database WHERE datname = $1", [store.database])).rows[0].xact_rollback); }
  finally { await o.end(); }
}

before(async () => {
  A = await startStore({ db: "porch_lights_a" });
  B = await startStore({ db: "porch_lights_b" });
  await seed(A);
  await seed(B, { kinAgoMs: 4 * CROSSING_MS });
});
after(async () => {
  for (const h of holders) await h.release().catch(() => {});
  for (const p of pools) await p.end().catch(() => {});
  await A?.stop(); await B?.stop();
});
beforeEach(() => resetActivityCache());

test("THE ROUTE: the real store answers the batch — the declared houses by `hh:<slug>`, the solo resident by `solo:<handle>`, lit by C and C-1 only", async () => {
  const pool = countedPool(A);
  const a = await readHouseholdActivity({ pool });
  const C = currentCrossing();
  assert.equal(a.clock, C);
  assert.deepEqual(a.households, { "hh:ash-house": C, "hh:birch-house": C - 10, "solo:dune": C });
  assert.deepEqual(lightsAnswer(a, C), { crossing: C, window: 1, lit: ["hh:ash-house", "solo:dune"] });
  assert.equal(pool.connects(), 1, "one connection for the whole batch");
  const after = await ours(A);
  assert.ok(after.every((r) => r.state === "idle"), `the batch's session went back idle, its transaction closed: ${JSON.stringify(after)}`);
});

test("N1 · HELD, RELEASED BEFORE 5 s: the callers are told `slow` at about 1.5 s while the ONE batch waits on the lock; released, it lands in the cache and the next reader is served without another batch", async () => {
  const pool = countedPool(A);
  const lock = await lockActs(A);
  const t0 = performance.now();
  const callers = Promise.all([0, 1, 2, 3].map(() => readHouseholdActivity({ pool })));
  await until(async () => waitingOnLock(await ours(A)).length === 1);   // the batch really waits on the lock
  const answers = await callers;
  const waited = performance.now() - t0;
  for (const r of answers) assert.equal(r.unavailable, ACTIVITY_SLOW, JSON.stringify(r));
  assert.ok(waited >= CALLER_WAIT_MS - 100 && waited < CALLER_WAIT_MS + 1000, `four callers waited ${waited.toFixed(0)} ms for a ${CALLER_WAIT_MS} ms bound`);
  assert.equal(pool.connects(), 1, "four callers, ONE batch");
  assert.equal(waitingOnLock(await ours(A)).length, 1, "the caller's bound did not cancel the batch: it is still waiting");
  const releasedAt = performance.now() - t0;
  assert.ok(releasedAt < BATCH_STATEMENT_TIMEOUT_MS - 1000, `released at ${releasedAt.toFixed(0)} ms, before the statement limit`);
  await lock.release();
  const next = await readHouseholdActivity({ pool });
  assert.equal(next.households?.["hh:ash-house"], currentCrossing(), `the next reader knows: ${JSON.stringify(next)}`);
  assert.equal(pool.connects(), 1, "served by the batch that was waiting — no second batch");
  const later = await readHouseholdActivity({ pool });
  assert.equal(pool.connects(), 1, "and kept: a later reader inside the TTL asks nothing");
  assert.deepEqual(later, next);
  console.log(`    N1 · callers told slow at ${waited.toFixed(0)} ms; lock released at ${releasedAt.toFixed(0)} ms; 1 batch for 6 readers`);
});

test("N1 · HELD PAST 5 s: Postgres cancels the waiting statement at about 5 s with the lock STILL held, rolls the batch back and hands the connection back idle; nothing is kept, and the next healthy read asks again and knows", async () => {
  const pool = countedPool(A);
  const rolledBefore = await rollbacks(A);
  const lock = await lockActs(A);
  const t0 = performance.now();
  const r = await readHouseholdActivity({ pool });
  assert.equal(r.unavailable, ACTIVITY_SLOW);
  await until(async () => waitingOnLock(await ours(A)).length === 1, { ms: 2000 }).catch(() => {});
  const waitingAt = waitingOnLock(await ours(A)).length;
  assert.equal(waitingAt, 1, "the batch is waiting on the lock after the caller left");
  await until(async () => waitingOnLock(await ours(A)).length === 0, { ms: 9000 });
  const cancelledAt = performance.now() - t0;
  assert.ok(cancelledAt >= BATCH_STATEMENT_TIMEOUT_MS - 300 && cancelledAt < BATCH_STATEMENT_TIMEOUT_MS + 2000,
    `the statement stopped waiting at ${cancelledAt.toFixed(0)} ms for a ${BATCH_STATEMENT_TIMEOUT_MS} ms limit`);
  // the lock is still held: the statement was CANCELLED, not let through by a release
  const o = await A.connect("postgres");
  try {
    const held = (await o.query(`SELECT l.pid FROM pg_locks l JOIN pg_class c ON c.oid = l.relation
      WHERE c.relname = 'acts' AND l.mode = 'AccessExclusiveLock' AND l.granted`)).rows.map((x) => x.pid);
    assert.deepEqual(held, [lock.pid], "the holder still holds acts");
  } finally { await o.end(); }
  await until(async () => (await ours(A)).every((x) => x.state === "idle"), { ms: 2000 });
  const sessions = await ours(A);
  assert.ok(sessions.length >= 1 && sessions.every((x) => x.state === "idle"), `rolled back and handed back idle, never 'idle in transaction': ${JSON.stringify(sessions)}`);
  assert.ok((await rollbacks(A)) > rolledBefore, "the server counted the batch's rollback");
  assert.equal(pool.waitingCount, 0, "nobody is queued on the pool");
  // still locked: a read now asks AGAIN (the cancelled batch was not kept) and is bounded again
  const t1 = performance.now();
  const again = await readHouseholdActivity({ pool });
  assert.equal(again.unavailable, ACTIVITY_SLOW);
  assert.equal(pool.connects(), 2, "a failure is not cached: the next read started a new batch");
  assert.ok(performance.now() - t1 < CALLER_WAIT_MS + 1000);
  await lock.release();
  const healthy = await readHouseholdActivity({ pool });
  assert.equal(healthy.households?.["hh:ash-house"], currentCrossing(), `recovered: ${JSON.stringify(healthy)}`);
  assert.ok(pool.connects() <= 3, `at most one more batch to recover (${pool.connects()})`);
  console.log(`    N1 · statement cancelled at ${cancelledAt.toFixed(0)} ms with the lock still held; rolled back; recovered after release`);
});

test("N1 · A NEW CROSSING WITH OLD WORK PENDING: the old clock's batch, finishing late, cannot relabel or overwrite the new clock's answer", async () => {
  const pool = countedPool(A);
  const lock = await lockActs(A);
  const now = Date.now();
  const C = currentCrossing(now), next = now + CROSSING_MS;
  const old = await readHouseholdActivity({ pool, now });
  assert.equal(old.unavailable, ACTIVITY_SLOW);
  const fresh = await readHouseholdActivity({ pool, now: next });
  assert.equal(fresh.unavailable, ACTIVITY_SLOW);
  assert.equal(fresh.clock, C + 1, "the new crossing's own clock, even while unknown");
  assert.equal(pool.connects(), 2, "the new crossing reads afresh");
  await lock.release();
  const known = await readHouseholdActivity({ pool, now: next + 1000 });
  assert.equal(known.clock, C + 1, `the new clock's answer: ${JSON.stringify(known)}`);
  assert.equal(known.households["hh:ash-house"], C, "ash-kin acted at C: lit at C+1 (C-1 of it)");
  assert.equal(pool.connects(), 2, "the late old-clock reply did not displace it, and no third batch ran");
});

test("ISOLATION: an injected store is its own (store B's old act is B's answer, never A's), the office's default store is neither, and a caller's copy is its own", async () => {
  const pa = countedPool(A), pb = countedPool(B);
  const a = await readHouseholdActivity({ pool: pa });
  const b = await readHouseholdActivity({ pool: pb });
  const C = currentCrossing();
  assert.equal(a.households["hh:ash-house"], C);
  assert.equal(b.households["hh:ash-house"], C - 4, "B's own rows: ash-kin acted four crossings ago there");
  assert.deepEqual([pa.connects(), pb.connects()], [1, 1]);
  const office = await readHouseholdActivity({ env: { WORLD2_PG_URL: "postgres://no-such-office-store.invalid/none" } });
  assert.equal(office.households, null, "the default store is a third store, read on its own (here: unreachable, so unknown)");
  a.households["hh:ash-house"] = -1;
  delete a.house_of.ash;
  const again = await readHouseholdActivity({ pool: pa });
  assert.equal(pa.connects(), 1);
  assert.equal(again.households["hh:ash-house"], C, "mutating one caller's answer leaves the next caller's whole");
  assert.equal(again.house_of.ash, "hh:ash-house");
});
