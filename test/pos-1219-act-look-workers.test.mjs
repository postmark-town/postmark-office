// pos-1219-act-look-workers.test.mjs — the pool answers a CALL, and a real office reads a world act's look on its worker (POS-1219).
//
// THE RULE (POS-1219's brief, 2026-11-24): "an act's orient and eyes reads move to a read worker, and the act itself stays on main", "answers byte-identical
// to today's". test/pos-1219-act-look.test.mjs proves the apex's side in process; this file drives the real workers (read-workers.mjs § startReadPool running the
// server module as read-role offices, as test/read-workers.test.mjs does):
//   A. NO POOL: `callOnWorker` answers null and nothing is callable;
//   B. THE POOL'S CALL: a real worker answers `act-look` with the look this thread reads (its standpoint, the spine it is within, eyes' objects); a call no worker
//      answers by that name, a payload that cannot be cloned, a worker killed while it holds a call, and a pool closed with a call out all answer null, never a hang;
//   C. A REAL OFFICE: with one worker, an MCP `world { do: "say" }` lands, its access line times `look` and neither `orient` nor `eyes`, and the worker counted the
//      call; with its workers off (OFFICE_READ_WORKERS=0) the same say times `orient` and `eyes` and no `look`; the two answers' law (did, via, from, dispatched_to,
//      terms) is the same.
// SKIPS B and C, saying why, on a checkout with no world clone (WORLD_CLONE=<a clone>).
//
// FLIPS (restore with `git checkout HEAD -- <file>`):
//   · read-workers.mjs § serveReadsInWorker: drop the `call` branch               → B's real call and C's `look` red (B by its own 60 s bound, a hang)
//   · read-workers.mjs § startReadPool's exit handler: drop the call's resolve      → B's killed worker reds by its bound (a hang)
//   · read-workers.mjs § caller: drop the try/catch around postMessage              → B's uncloneable payload throws instead of answering null
//   · read-workers.mjs § close: drop the calls' resolve                             → B's closed pool reds by its bound
//   · world-apex.mjs § actLook: never ask (return lookHere)                         → C's worker office times `orient`, and its worker counted 0
//   node --import ./test/helpers/sparse-guard.mjs --test test/pos-1219-act-look-workers.test.mjs

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { fixtureTown } from "./fixture.mjs";
import { bootOnFreePort } from "./spawn-office.mjs";
import { callOnWorker, startReadPool, workerCallable } from "../src/read-workers.mjs";
import { newTiming, runTiming, timingLine } from "../src/read-timing.mjs";
import { WORLD_CLONE } from "../src/world-store.mjs";
import { indexStore } from "./helpers/office-under-test.mjs";
import { seedStaticKeys } from "./helpers/static-keys.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const haveClone = existsSync(join(WORLD_CLONE, "WORLD", "walk-ledger.md"));
const SKIP = !haveClone && `needs the world clone at ${WORLD_CLONE}`;
const KEY = "pos-1219-test-key";
const FLAGS = { WORLD_POSITIONS: "1", WORLD_MOVEMENT_V2: "1", WORLD_PRESENCE: "1" };
const was = Object.fromEntries(Object.keys(FLAGS).map((k) => [k, process.env[k]]));
const bounded = (p, ms, what) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error(`${what} never settled (${ms} ms)`)), ms).unref())]);
const until = async (what, fn, ms = 90_000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (fn()) return; await new Promise((r) => setTimeout(r, 100)); }
  throw new Error(`timed out waiting for ${what}`);
};

let tmp = null, IX = null;
async function setup() {
  if (tmp) return;
  Object.assign(process.env, FLAGS);
  tmp = mkdtempSync(join(tmpdir(), "postmark-1219-workers-"));
  IX = await indexStore(fixtureTown());
  const { openDynamic } = await import("../src/dynamic-store.mjs");
  openDynamic(join(tmp, "dynamic.db")).close();
  const { openOauthDb } = await import("../src/oauth.mjs");
  openOauthDb(join(tmp, "oauth.db")).close();
  seedStaticKeys(join(tmp, "oauth.db"), `${KEY}=keemin:wright`);
}
after(async () => {
  for (const [k, v] of Object.entries(was)) if (v == null) delete process.env[k]; else process.env[k] = v;
  await IX?.stop();
  if (tmp) rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});
const poolEnv = () => ({ ...process.env, ...IX?.env, WORLD_GRAPH_NONE: "1", WORLD_DYNAMIC_DB: join(tmp, "dynamic.db"), TOWN_CLONE: join(ROOT, "town-clone") });
const startPool = async (size = 1) => {
  const pool = startReadPool({ size, entry: new URL("../src/server.mjs", import.meta.url),
    argv: ["--port", "0", "--oauth-db", join(tmp, "oauth.db"), "--roles-db", join(tmp, "roles.db")], env: poolEnv(), log: { error: () => {} } });
  await until("the workers to be ready", () => pool.disclose().ready === size);
  return pool;
};
const LOOK = { args: { handle: "wright" }, key: { household: "keemin", handles: new Set(["keemin", "wright"]) }, roll: [] };

test("A · no pool: callOnWorker answers null and nothing is callable", async () => {
  assert.equal(workerCallable(), false);
  assert.equal(await callOnWorker("act-look", LOOK), null);
});

test("B · the pool's call: a real worker answers the act's look; every way of not answering is null, never a hang", { skip: SKIP }, async () => {
  await setup();
  let pool = await startPool(1);
  try {
    assert.equal(workerCallable(), true, "a running pool is callable");
    // LAW (POS-1219): "an act's orient and eyes reads move to a read worker"
    const look = await bounded(callOnWorker("act-look", LOOK), 60_000, "the act-look call");
    assert.ok(look && look.oriented && !look.oriented.error, `the worker read the look: ${JSON.stringify(look).slice(0, 300)}`);
    assert.ok(look.oriented.standpoint && Number.isFinite(look.oriented.standpoint.x), "orient's standpoint crossed");
    assert.ok(Array.isArray(look.oriented.you?.within) && look.oriented.you.within.length >= 1, "the spine the act's law reads crossed");
    assert.ok(Array.isArray(look.seen?.objects), "eyes' objects crossed");
    assert.deepEqual(pool.called(), [1], "the worker counted the call");
    // POS-1219 (measurement only): a call made under a request's timing records the worker it went to and the worker's own report of the look
    const tm = newTiming();
    const timed = await runTiming(tm, () => bounded(callOnWorker("act-look", LOOK), 60_000, "a timed act-look call"));
    assert.ok(timed?.oriented, "control: the timed call answered the look");
    const seen = tm.calls?.["act-look"];
    assert.equal(seen?.slot, 0, `the call names its worker: ${JSON.stringify(seen)}`);
    assert.ok(Number.isFinite(seen.answer?.taken) && Number.isFinite(seen.answer?.done) && seen.answer.done >= seen.answer.taken, "the worker reported when it took the call and when it was done");
    assert.equal(seen.answer.rid, tm.rid, "the worker's report is joined to the request by its rid");
    const onLine = timingLine(tm, { door: "mcp-act", status: 200 }).act.look;
    assert.equal(onLine.worker, 0);
    assert.equal(onLine.answered, true);
    for (const k of ["queue_ms", "exec_ms", "return_ms"]) assert.ok(Number.isFinite(onLine[k]) && onLine[k] >= 0, `${k} is measured: ${JSON.stringify(onLine)}`);
    assert.deepEqual(pool.called(), [2], "and the worker counted it");
    assert.equal(await bounded(callOnWorker("no-such-call", {}), 60_000, "an unnamed call"), null, "a call no worker answers by that name is null");
    assert.deepEqual(pool.called(), [3], "and it was answered (as failed), not dropped");
    assert.equal(await callOnWorker("act-look", { ...LOOK, key: { ...LOOK.key, sign: () => "a function cannot cross a port" } }), null, "a payload that cannot be cloned is null");
    assert.deepEqual(pool.called(), [3], "and it never reached the worker");
    // a worker killed while it holds a call: the call is answered null (its caller then reads it itself)
    const held = callOnWorker("act-look", LOOK);
    const killed = pool.kill(0);
    assert.equal(await bounded(held, 60_000, "a call held by a killed worker"), null, "the killed worker's call is null");
    await killed;
    await until("the slot to be respawned", () => pool.disclose().ready === 1);
    // a pool closed with a call out
    const out = callOnWorker("act-look", LOOK);
    await pool.close();
    pool = null;
    assert.equal(await bounded(out, 10_000, "a call out when the pool closed"), null, "the closed pool's call is null");
    assert.equal(workerCallable(), false, "a closed pool is not callable");
  } finally { await pool?.close(); }
});

/** Boot a real office, say once over MCP, and hand back the say's answer and its access line. */
async function officeSays(workers) {
  const worldDb = join(tmp, `world-${workers}.db`);
  execFileSync(process.execPath, [join(ROOT, "src", "world-hydrate.mjs"), "--world", WORLD_CLONE, "--no-db", "--rows-out", `${worldDb}.rows.json`, "--no-gexf", "--no-lints"], { stdio: "ignore" });
  const logDir = join(tmp, `access-${workers}`);
  const { child: proc, port } = await bootOnFreePort((port) => spawn(process.execPath, [
    join(ROOT, "src", "server.mjs"), "--port", String(port), "--oauth-db", join(tmp, "oauth.db"), "--roles-db", join(tmp, "roles.db"),
  ], {
    env: { ...process.env, ...IX?.env, OFFICE_READ_WORKERS: String(workers), WORLD_APEX: "1",
      WORLD_GRAPH_ROWS: `${worldDb}.rows.json`, WORLD_STORE_DB: join(tmp, "no-world-db-here.db"),
      VOICES_LOG: join(tmp, `voices-${workers}.jsonl`), OFFICE_ACCESS_LOG_DIR: logDir,
      WORLD_DYNAMIC_DB: join(tmp, "dynamic.db"), TOWN_CLONE: join(ROOT, "town-clone") },
    stdio: ["ignore", "pipe", "pipe"],
  }), { budgetMs: 30_000 });
  const gone = new Promise((ok) => proc.on("exit", ok));
  try {
    const base = `http://127.0.0.1:${port}`;
    if (workers > 0) {
      let ready = 0;
      for (let i = 0; i < 300 && ready !== workers; i++) {
        ready = (await (await fetch(`${base}/release`)).json()).read_workers?.ready ?? 0;
        if (ready !== workers) await new Promise((r) => setTimeout(r, 200));
      }
      assert.equal(ready, workers, "the office's workers never came up");
    }
    const res = await fetch(`${base}/mcp`, { method: "POST",
      headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "world", arguments: { handle: "wright", do: "say", args: { text: `the look is read elsewhere (${workers})` } } } }) });
    const body = await res.text();
    assert.equal(res.status, 200, body.slice(0, 300));
    const text = JSON.parse(body.split("\n").find((l) => l.startsWith("{")) ?? body).result?.content?.[0]?.text ?? "";
    const answer = JSON.parse(text);
    await until("the access line", () => existsSync(logDir) && readdirSync(logDir).some((f) => readFileSync(join(logDir, f), "utf8").includes('"mcp-act"')), 10_000);
    const line = readdirSync(logDir).flatMap((f) => readFileSync(join(logDir, f), "utf8").split("\n")).filter(Boolean).map((l) => JSON.parse(l)).find((e) => e.timing?.door === "mcp-act");
    return { answer, seg: line.timing.act.seg, look: line.timing.act.look, reader: res.headers.get("x-pm-reader") };
  } finally {
    proc.kill();
    await gone;
  }
}

test("C · a real office: the say lands, its look is timed as `look` with one worker and as `orient` and `eyes` with none, and the act's law is the same", { skip: SKIP }, async () => {
  await setup();
  const off = await officeSays(0);
  assert.ok(off.answer.did === "say" && !off.answer.error, `control: the say landed with the workers off (${JSON.stringify(off.answer).slice(0, 300)})`);
  assert.ok(off.seg.orient?.n === 1 && off.seg.eyes?.n === 1, `control: with no workers the look is read on the main thread: ${JSON.stringify(off.seg)}`);
  assert.equal(off.seg.look, undefined, "control: no worker, no look");
  const on = await officeSays(1);
  assert.ok(on.answer.did === "say" && !on.answer.error, `the say landed with one worker (${JSON.stringify(on.answer).slice(0, 300)})`);
  assert.equal(on.reader, null, "the act itself was answered on the main thread");
  // LAW (POS-1219): "an act's orient and eyes reads move to a read worker, and the act itself stays on main"
  assert.ok(on.seg.look?.n === 1, `the look was asked of the worker: ${JSON.stringify(on.seg)}`);
  assert.equal(on.seg.orient, undefined, "orient was not read on the main thread");
  assert.equal(on.seg.eyes, undefined, "eyes was not read on the main thread");
  assert.ok(on.seg.handler?.n === 1, "the act's verb ran on the main thread");
  // POS-1219 (measurement only): the act's access line says which worker read its look and how long each part took
  assert.equal(on.look?.worker, 0, `the act's line names the worker that read its look: ${JSON.stringify(on.look)}`);
  assert.equal(on.look.answered, true);
  for (const k of ["queue_ms", "exec_ms", "return_ms"]) assert.ok(Number.isFinite(on.look[k]) && on.look[k] >= 0, `${k} is on the line: ${JSON.stringify(on.look)}`);
  assert.equal(off.look, undefined, "with its workers off, no look is on the line");
  // LAW (POS-1219): "answers byte-identical to today's" — the parts of the answer the look decides (the clocked voices differ run to run and are not the look's)
  const law = (a) => JSON.stringify({ did: a.did, via: a.via, from: a.from, dispatched_to: a.dispatched_to, terms: a.terms, channel: a.channel ?? null });
  assert.equal(law(on.answer), law(off.answer), "the act's law is the same, read on a worker or here");
});
