// act-law-pool.test.mjs — POS-680 part 2, round 3: an act's pin question never
// takes the serve pool, and no act is admitted on law or graph it has not
// confirmed (the round-2 review's F3, on a real Postgres).
//
// LAW (Wright's Settled on POS-680, 2026-11-03, "C plus coalescing", decided on
// Darko's behalf): "One shared pin session, single-flight ... It holds one slot
// of the existing cap of 2 ... Every act arriving while that session is in
// flight awaits the same answer, within its own deadline ... No slot means the
// plain 503 ... A read always keeps the third connection." And the amended
// Settled (01:5x EST): "an act is never admitted on law or graph it hasn't
// confirmed, and reads keep their connection." Part 1's own words
// (snapshot-loads.mjs): "Two of three connections, so a read always has one."
//
// MODELLED ON the round-2 Truey's pool probes (office #762, issuecomment
// 6595734657, F3): the suite's Postgres (a throwaway database from the migrated
// floor; invented rows only), the office's own serve-pool options
// (store-pool.mjs § storePoolOptions, max 3), the real refreshers and the real
// lawForAnAct on their default store path. One seam: snapshot-loads.mjs's
// import of world2-serve.mjs answers with this file's pool (a resolve hook,
// registered below), because world2-serve.mjs reads the clones at import. The
// store hangs as the Truey's did: another session holds ACCESS EXCLUSIVE on a
// table, so a pin on it waits until the store's statement_timeout ends it.
// Times are a quarter of production's: deadline 750 ms (3 s), statement
// timeout 1000 ms (4 s), the pool's acquire timeout 2500 ms (10 s).

process.env.LAW_REFRESH_DEADLINE_MS = "750";
process.env.WORLD_GRAPH_REFRESH_DEADLINE_MS = "750";
process.env.REFRESH_STATEMENT_TIMEOUT_MS = "1000";
process.env.WORLD2_PG_ACQUIRE_MS = "2500";
process.env.REFRESH_MAX_LOADS = "2";
process.env.WORLD_GRAPH_NONE = "1"; // no load at import: each case loads its own invented graph

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

const STUB = `data:text/javascript,${encodeURIComponent([
  "export const world2ServeEnabled = () => true;",
  "export const world2Pool = async () => { const p = globalThis.__actLawPoolTestPool; if (!p) throw new Error('the pool test has no pool open'); return p; };",
].join("\n"))}`;
register(`data:text/javascript,${encodeURIComponent(`export async function resolve(specifier, context, next) {
  if (specifier === "./world2-serve.mjs" && String(context.parentURL ?? "").endsWith("/src/snapshot-loads.mjs")) return { url: ${JSON.stringify(STUB)}, shortCircuit: true };
  return next(specifier, context);
}`)}`);

const { startStore, NO_STORE } = await import("./helpers/embedded-store.mjs");
const { storePoolOptions, watchPoolErrors } = await import("../src/store-pool.mjs");
const law = await import("../src/law-snapshot.mjs");
const graph = await import("../src/world-graph-snapshot.mjs");
const actLaw = await import("../src/act-law.mjs");
const { loadsStanding } = await import("../src/snapshot-loads.mjs");
const { default: pg } = await import("pg");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tag = (n) => `invented-tag-${n}`.padEnd(40, "0");
const office = (n) => `invented-office-${n}`.padEnd(40, "0");
/** An invented world graph build `n` (no law: the store's law tables stay empty). */
async function build(db, n) {
  await db.query("INSERT INTO world_graphs (tag_sha, office_sha, settlement, built_at) VALUES ($1, $2, $3, now())", [tag(n), office(n), n]);
  await db.query("INSERT INTO world_graph_meta (tag_sha, office_sha, ord, key, value) VALUES ($1, $2, 0, 'invented_build', $3)", [tag(n), office(n), `G${n}`]);
}
const inForce = () => graph.worldGraphSnapshot()?.pin?.settlement ?? null;
const outcome = (p) => p.then((v) => ({ ok: true, admitted: v === null, code: v?.code ?? null, behind: v?.behind ?? null }), (e) => ({ ok: false, error: String(e?.message ?? e).slice(0, 160) }));

/** The rig: a store, the office's serve pool on it, an owner session and a locker session. */
async function rig(t, name) {
  let store;
  try { store = await startStore({ db: name }); } catch { t.skip(NO_STORE); return null; }
  const pool = watchPoolErrors(new pg.Pool(storePoolOptions({ ...process.env, WORLD2_PG_URL: store.url("office_api") }, { name: "serve", max: 3 })), "serve");
  globalThis.__actLawPoolTestPool = pool;
  const owner = await store.connect("world2_owner");
  const locker = await store.connect("world2_owner");
  t.after(async () => {
    try { await locker.query("ROLLBACK"); } catch { /* not in a transaction */ }
    for (const c of [locker, owner]) await c.end().catch(() => {});
    await pool.end().catch(() => {});
    globalThis.__actLawPoolTestPool = null;
    await store.stop();
  });
  const sampled = { peakInUse: 0, peakWaiting: 0 };
  const sample = () => {
    sampled.peakInUse = Math.max(sampled.peakInUse, pool.totalCount - pool.idleCount);
    sampled.peakWaiting = Math.max(sampled.peakWaiting, pool.waitingCount);
  };
  return { pool, owner, locker, sampled, sample };
}
/** Let everything queued on the pool finish, and every slot come back. */
async function drain(pool) {
  for (let i = 0; i < 60 && (pool.waitingCount > 0 || pool.totalCount - pool.idleCount > 0 || loadsStanding().running > 0); i++) await sleep(100);
}

beforeEach(() => { law.resetLawSnapshot(); graph.resetWorldGraph(); });

test("F3 · the store hangs on the law's table and twelve acts come: the pin questions stay inside the cap, an ordinary read still answers, and the act after the graph moves is not admitted on the old graph", async (t) => {
  const r = await rig(t, "act_law_pool_hang");
  if (!r) return;
  const { pool, owner, locker, sampled, sample } = r;
  await build(owner, 1);
  await law.reloadLawSnapshot(); await graph.reloadWorldGraph(); // the office has been up a while: G1 in force
  assert.equal(inForce(), 1, "the floor: G1 in force");
  assert.equal(await actLaw.lawForAnAct(), null, "the control: on a healthy store an act goes on");

  await locker.query("BEGIN");
  await locker.query("LOCK TABLE settlements IN ACCESS EXCLUSIVE MODE"); // the law's pin waits; the graph's tables answer
  const sampler = setInterval(sample, 10);
  let read, late;
  try {
    const tick = outcome(law.reloadLawSnapshot()); // the 60 s tick: takes a slot, hangs on the lock
    await sleep(20);
    const acts = Array.from({ length: 12 }, () => outcome(actLaw.lawForAnAct()));
    await sleep(50);
    sample();
    const before = { ...sampled };
    const reading = outcome(pool.query("SELECT 1 AS ok")); // any serve read, after the acts
    await sleep(30);
    await build(owner, 2); // the graph moves while the law's table still hangs; the graph's tables answer at once
    late = await outcome(actLaw.lawForAnAct()); // the next act after the graph moved
    const lateOn = late.admitted ? inForce() : null;
    read = await reading;
    // every fact in one assertion, so one red cannot hide another
    assert.deepEqual(
      { readAnswered: read.ok, inUseBeforeTheRead: before.peakInUse <= 2, queuedBeforeTheRead: before.peakWaiting, lateActOnTheOldGraph: lateOn === 1 },
      { readAnswered: true, inUseBeforeTheRead: true, queuedBeforeTheRead: 0, lateActOnTheOldGraph: false },
      `LAW (snapshot-loads.mjs): "Two of three connections, so a read always has one"; (amended Settled): "an act is never admitted on law or graph it hasn't confirmed" — `
      + `the read ${read.ok ? "answered" : `failed: ${read.error}`}; ${before.peakInUse} of 3 connections in use and ${before.peakWaiting} queued before it; the act after G2 was built: ${JSON.stringify(late)}, on G${lateOn ?? "-"}`);
    assert.equal(late.ok, true, late.error);
    if (!late.admitted) assert.equal(late.code, 503, `refused with the plain 503: ${JSON.stringify(late)}`);
    for (const a of await Promise.all(acts)) assert.equal(a.ok, true, `an act threw: ${a.error}`);
    await tick;
  } finally {
    clearInterval(sampler);
    await locker.query("ROLLBACK");
  }
  await drain(pool);
  const after = await outcome(actLaw.lawForAnAct());
  assert.equal(after.admitted, true, `once the hang ends, an act goes on: ${JSON.stringify(after)}`);
  assert.equal(inForce(), 2, "and stands on G2");
});

test("F3 · a healthy store: twelve acts at once are all admitted, and one during a tick too", async (t) => {
  const r = await rig(t, "act_law_pool_healthy");
  if (!r) return;
  const { owner, pool } = r;
  await build(owner, 1);
  await law.reloadLawSnapshot(); await graph.reloadWorldGraph();
  const twelve = await Promise.all(Array.from({ length: 12 }, () => outcome(actLaw.lawForAnAct())));
  const admitted = twelve.filter((a) => a.admitted).length;
  assert.equal(admitted, 12, `LAW: "Twelve concurrent acts are one pin question" — ${admitted} of 12 admitted on a healthy store: ${JSON.stringify(twelve.find((a) => !a.admitted))}`);
  await drain(pool);
  const tick = law.reloadLawSnapshot();
  const during = await outcome(actLaw.lawForAnAct());
  assert.equal(during.admitted, true, `an act during a tick was refused: ${JSON.stringify(during)}`);
  await tick;
});

test("F3 · both ticks in flight (the store hangs on both tables) after the graph moved: a 503, never admitted on the old graph", async (t) => {
  const r = await rig(t, "act_law_pool_ticks");
  if (!r) return;
  const { owner, locker, pool } = r;
  await build(owner, 1);
  await law.reloadLawSnapshot(); await graph.reloadWorldGraph();
  await build(owner, 2); // the store moved; the office has not heard
  await locker.query("BEGIN");
  await locker.query("LOCK TABLE settlements, world_graphs IN ACCESS EXCLUSIVE MODE");
  let act;
  try {
    const ticks = [law.reloadLawSnapshot(), graph.reloadWorldGraph()]; // both take a slot, both hang
    await sleep(20);
    act = await outcome(actLaw.lawForAnAct());
    assert.equal(act.ok, true, act.error);
    assert.ok(!(act.admitted && inForce() === 1), `LAW (amended): "an act is never admitted on law or graph it hasn't confirmed" — admitted on G1 while the store's newest is G2`);
    assert.equal(act.code, 503, `LAW: "No slot means the plain 503" — ${JSON.stringify(act)}`);
    const read = await outcome(pool.query("SELECT 1 AS ok"));
    assert.equal(read.ok, true, `the read failed while both ticks hung: ${read.error}`);
    await Promise.all(ticks);
  } finally { await locker.query("ROLLBACK"); }
  await drain(pool);
  const after = await outcome(actLaw.lawForAnAct());
  assert.equal(after.admitted, true, `once the hang ends, an act goes on: ${JSON.stringify(after)}`);
  assert.equal(inForce(), 2);
});

test("N9 · the pin session's statement_timeout gives its connection and its slot back while a table lock is still held (a lock that ends early gives them back too)", async (t) => {
  // POS-908, from the round-three review of #762 (N9): act outcomes are the same with or without the session's `SET LOCAL statement_timeout`,
  // because a hung question refuses acts until it ends. What the timeout buys is that the one connection and the one slot come back when the
  // STORE ends the statement, not when the lock does ("a JS race frees the caller, not the connection": STORE-CONCURRENCY). Only the slot count
  // and the pool's use, read while the lock is still held, can see it.
  const r = await rig(t, "act_law_pool_timeout");
  if (!r) return;
  const { pool, owner, locker } = r;
  await build(owner, 1);
  await law.reloadLawSnapshot(); await graph.reloadWorldGraph();
  await drain(pool);
  const inUse = () => pool.totalCount - pool.idleCount;
  const { rows: [{ pid }] } = await locker.query("SELECT pg_backend_pid() AS pid");
  const lockHeld = async () => Number((await owner.query(
    "SELECT count(*) AS n FROM pg_locks WHERE pid = $1 AND granted AND locktype = 'relation' AND mode = 'AccessExclusiveLock'", [pid])).rows[0].n) > 0;

  // the paired control: the lock ends at 300 ms, before any timeout; the question is answered, the act is admitted, the slot and the connection are back
  await locker.query("BEGIN");
  await locker.query("LOCK TABLE settlements IN ACCESS EXCLUSIVE MODE");
  const early = outcome(actLaw.lawForAnAct());
  await sleep(300);
  assert.equal(await lockHeld(), true, "control: the lock is held while the question waits");
  await locker.query("ROLLBACK");
  const e = await early;
  assert.equal(e.admitted, true, `control: a lock that ends in time answers the question and the act goes on: ${JSON.stringify(e)}`);
  await drain(pool);
  assert.deepEqual({ running: loadsStanding().running, inUse: inUse() }, { running: 0, inUse: 0 }, "control: the slot and the connection are back once the question is answered");

  // the case: the lock outlasts the act's deadline (750 ms) and the store's statement timeout (1000 ms)
  await locker.query("BEGIN");
  await locker.query("LOCK TABLE settlements IN ACCESS EXCLUSIVE MODE");
  let backAfter = null;
  try {
    const began = Date.now();
    const act = await outcome(actLaw.lawForAnAct());
    assert.equal(act.code, 503, `the act is refused at its own deadline, never admitted on law it has not confirmed: ${JSON.stringify(act)}`);
    // the refusal frees the CALLER: the session's connection and slot are still taken, because the store has not ended the statement yet
    assert.deepEqual({ running: loadsStanding().running, inUse: inUse() }, { running: 1, inUse: 1 },
      "the instrument sees a held session at the act's deadline (before the store's statement timeout): a JS deadline frees the caller, not the connection");
    for (let i = 0; i < 40 && backAfter === null; i++) {
      await sleep(50);
      if (loadsStanding().running === 0 && inUse() === 0) backAfter = Date.now() - began;
    }
    assert.notEqual(backAfter, null,
      `LAW (snapshot-loads.mjs § timedSession; STORE-CONCURRENCY): "the store ends what was let go ... the connection comes back to the pool" — `
      + `2 s after the act began, with the lock still held, the session still held ${loadsStanding().running} slot(s) and ${inUse()} connection(s)`);
    assert.equal(await lockHeld(), true, "and the lock was still held when the slot and the connection came back: it was the store's statement timeout, not the lock's end");
  } finally {
    await locker.query("ROLLBACK");
  }
  await drain(pool);
  const after = await outcome(actLaw.lawForAnAct());
  assert.equal(after.admitted, true, `once the lock ends, an act goes on: ${JSON.stringify(after)}`);
});
