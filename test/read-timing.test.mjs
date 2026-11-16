// read-timing.test.mjs — POS-1064/b: the doorstep and household reads' path-tagged timing (request → worker take → bundle → store leases), measurement only.
//
//   node --test test/read-timing.test.mjs
//
// The workers here are REAL worker threads (read-workers.mjs § startReadPool) running a small stand-in handler instead of the server: it holds its thread busy for a
// known time (the worker-queue delay the NEXT read sees), takes a pen lease from a fake pool whose connect and hold times are known (store-pool.mjs § onPenClient, the real
// lease seam) and runs a bundle span. The main thread's part is played as server.mjs plays it: a timing context per request, `markRouted`, `forward`, then `timingLine`.
//   1. WHERE THE TIME LANDS: a known queue delay, a known acquire wait and a known held time land in queue_ms, leases.worker.acquire_ms and leases.worker.held_ms,
//      each and no other, and a bundle's time is in `bundle`, never in a lease field;
//   2. OVERLAPPING CALLERS DO NOT SHARE: concurrent requests with different delays each carry their own rid, lease count and times;
//   3. ABSENT, ZERO AND FAILED: a main-thread read has `queue_ms: null` and `leases.worker: null` (not measured); a free connection is a measured acquire 0; a failed
//      acquisition is counted in `failed` and keeps its error;
//   4. BEHAVIOUR PRESERVED: the lease's release/discard handling and the error are the read's own, and a telemetry fault never fails a read;
//   5. A RETRY: the first worker stopping before it answered shows tries 2, a retry_ms and the same rid;
//   6. NO SECRET: a planted secret in the URL, query, header, body and handle appears nowhere in the timing line or the access line.

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { startReadPool } from "../src/read-workers.mjs";
import { newTiming, runTiming, markRouted, timingLine, leaseStart, bundleSpan, nowMs, currentTiming } from "../src/read-timing.mjs";
import { onPenClient, StoreAcquireTimeout } from "../src/store-pool.mjs";
import { accessLine } from "../src/telemetry.mjs";

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "..", "src");
const href = (f) => new URL(`file://${SRC}/${f}`).href;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// the stand-in worker: its plan is in the URL's numbers (busy = block this thread, acquire = the pool's connect wait, held = the lease's hold time, fail = acquire fails)
const WORKER = `
import { serveReadsInWorker } from "${href("read-workers.mjs")}";
import { onPenClient } from "${href("store-pool.mjs")}";
import { bundleSpan } from "${href("read-timing.mjs")}";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const busy = (ms) => { const e = performance.now() + ms; while (performance.now() < e); };
serveReadsInWorker(async (req, res) => {
  const q = new URL(req.url, "http://x").searchParams;
  const n = (k) => Number(q.get(k) || 0);
  busy(n("busy"));
  const pool = { options: { max: 3 }, connect: async () => { await sleep(n("acquire")); if (n("fail")) throw new Error("timeout exceeded when trying to connect"); return { query() {}, on() {}, removeListener() {}, release() {} }; } };
  try {
    await bundleSpan(async () => { await sleep(n("bundle")); await onPenClient(pool, "test", async () => { await sleep(n("held")); }); });
    res.writeHead(200, { "Content-Type": "text/plain" }); res.end("ok");
  } catch (e) { res.writeHead(503, { "Content-Type": "text/plain" }); res.end(e?.name ?? "error"); }
});
`;
const ENTRY = new URL(`data:text/javascript;base64,${Buffer.from(WORKER).toString("base64")}`);
const pools = [];
const mkPool = (size) => { const p = startReadPool({ size, entry: ENTRY, log: { error() {}, warn() {}, log() {} } }); pools.push(p); return p; };
after(async () => { for (const p of pools) await p.close(); });
const ready = async (p, n) => { for (let i = 0; i < 200 && p.disclose().ready < n; i++) await sleep(25); assert.equal(p.disclose().ready, n, "the workers are up"); };

/** One read as server.mjs hands it over: a context of its own, `markRouted`, `forward`, the answer, then the record. `extra` rides the URL, headers, body. */
function oneRead(pool, plan, { url = null, headers = {}, ip = "127.0.0.1", status = null } = {}) {
  const tm = newTiming();
  return new Promise((resolveRead, reject) => {
    const res = { writableEnded: false, destroyed: false, writeHead(code) { this.code = code; }, end() { this.writableEnded = true; resolveRead({ tm, code: this.code, line: () => timingLine(tm, { door: "doorstep", status: this.code }) }); } };
    const q = new URLSearchParams(Object.entries(plan).map(([k, v]) => [k, String(v)])).toString();
    runTiming(tm, () => {
      markRouted(tm);
      const ok = pool.forward({ method: "GET", url: url ?? `/read?${q}`, headers, socket: { remoteAddress: ip } }, res);
      if (!ok) reject(new Error("no worker took it"));
    });
  });
}

test("1 · WHERE THE TIME LANDS: a known worker queue delay, acquire wait and held time are each in their own field, and a bundle's time is not a lease's", async () => {
  const pool = mkPool(1);
  await ready(pool, 1);
  // a first read keeps the one worker's thread busy for 150 ms; the second, sent at once, waits that long in the worker's queue, then waits 80 ms for a connection, holds it 120 ms
  const first = oneRead(pool, { busy: 150, acquire: 0, held: 0 });
  await sleep(10);
  const second = await oneRead(pool, { acquire: 80, held: 120, bundle: 40 });
  await first;
  const t = second.line();
  assert.equal(t.route, "worker");
  assert.equal(t.worker, 0);
  assert.equal(t.tries, 1);
  assert.ok(t.queue_ms >= 110 && t.queue_ms < 260, `queue_ms ${t.queue_ms} is the ~140 ms the worker was busy, not the acquire or the hold`);
  const L = t.leases.worker;
  assert.equal(L.n, 1);
  assert.equal(L.failed, 0);
  assert.ok(L.acquire_ms.sum >= 70 && L.acquire_ms.sum < 160, `acquire ${L.acquire_ms.sum} is the ~80 ms connect wait`);
  assert.ok(L.held_ms.sum >= 110 && L.held_ms.sum < 220, `held ${L.held_ms.sum} is the ~120 ms the lease was held (acquired to released)`);
  assert.ok(t.queue_ms > L.acquire_ms.sum, "the queue delay is not folded into the acquire wait");
  // the bundle wraps 40 ms of its own + the lease: its time is the bundle's, and is longer than the lease it contains; neither is called the other
  assert.equal(t.bundle.n, 1);
  assert.ok(t.bundle.sum_ms >= L.held_ms.sum + L.acquire_ms.sum + 30, `bundle ${t.bundle.sum_ms} covers its own 40 ms and the lease`);
  assert.ok(t.exec_ms >= t.bundle.sum_ms - 5, "exec on the worker covers the bundle");
  assert.ok(t.total_ms >= t.admit_ms + t.queue_ms + t.exec_ms - 5, "the path's phases follow one another inside the total");
  assert.ok(t.return_ms != null && t.return_ms >= 0 && t.return_ms < 100, "the answer's way back is its own field");
  assert.deepEqual(t.leases.main, { n: 0, failed: 0, acquire_ms: { sum: 0, max: 0 }, held_ms: { sum: 0, max: 0 }, failed_wait_ms: 0 }, "main took no lease for this read: a measured zero");
  assert.equal(t.cov, "pen");
  assert.match(t.rid, /^[0-9a-f]{12}$/);
});

test("2 · OVERLAPPING CALLERS DO NOT SHARE CONTEXT OR LEASE COUNTS: each carries its own rid, lease count and times", async () => {
  const pool = mkPool(3);
  await ready(pool, 3);
  const plans = [{ acquire: 10, held: 50 }, { acquire: 60, held: 200 }, { acquire: 30, held: 120 }];
  const outs = await Promise.all(plans.map((p) => oneRead(pool, p)));
  const lines = outs.map((o) => o.line());
  assert.equal(new Set(lines.map((l) => l.rid)).size, 3, "three requests, three ids");
  lines.forEach((l, i) => {
    assert.equal(l.leases.worker.n, 1, `request ${i} took exactly its own lease`);
    assert.ok(l.leases.worker.held_ms.sum >= plans[i].held - 10 && l.leases.worker.held_ms.sum < plans[i].held + 120, `request ${i} held ${l.leases.worker.held_ms.sum}, planned ${plans[i].held}`);
    assert.ok(l.leases.worker.acquire_ms.sum >= plans[i].acquire - 10 && l.leases.worker.acquire_ms.sum < plans[i].acquire + 100, `request ${i} acquire ${l.leases.worker.acquire_ms.sum}, planned ${plans[i].acquire}`);
  });
  assert.ok(lines[1].leases.worker.held_ms.sum > lines[0].leases.worker.held_ms.sum + 100, "the longer hold is on the longer request, not shared");
  // on ONE thread: two overlapping contexts on the main thread, each with its own pen leases
  const fake = (wait) => ({ options: { max: 3 }, connect: async () => { await sleep(wait); return { query() {}, on() {}, removeListener() {}, release() {} }; } });
  const a = newTiming(), b = newTiming();
  await Promise.all([
    runTiming(a, () => onPenClient(fake(5), "a", async () => { await sleep(30); }).then(() => onPenClient(fake(5), "a2", async () => { await sleep(10); }))),
    runTiming(b, () => onPenClient(fake(40), "b", async () => { await sleep(80); })),
  ]);
  const la = timingLine(a, { door: "household", status: 200 }).leases.main, lb = timingLine(b, { door: "household", status: 200 }).leases.main;
  assert.equal(la.n, 2); assert.equal(lb.n, 1);
  assert.ok(lb.held_ms.sum >= 70 && la.held_ms.sum < 100 && lb.acquire_ms.sum >= 30 && la.acquire_ms.sum < 60, `the two contexts keep their own times: ${JSON.stringify([la, lb])}`);
});

test("3 · ABSENT, ZERO AND FAILED ARE THREE THINGS: a main-thread read has no queue and no worker group; a free connection is a measured 0; a failed acquisition is counted and keeps its error", async () => {
  const tm = newTiming();
  const free = { options: { max: 3 }, connect: async () => ({ query() {}, on() {}, removeListener() {}, release() {} }) };
  await runTiming(tm, async () => { markRouted(tm); await onPenClient(free, "main", async () => {}); await bundleSpan(async () => {}); });
  const t = timingLine(tm, { door: "household", read: "stamps", status: 200 });
  assert.equal(t.route, "main");
  assert.equal(t.worker, null);
  assert.equal(t.queue_ms, null, "no worker, no queue: absent, not 0");
  assert.equal(t.return_ms, null);
  assert.equal(t.leases.worker, null, "the worker's leases were not measured: null");
  assert.equal(t.leases.main.n, 1);
  assert.ok(t.leases.main.acquire_ms.max < 5, "a free connection's acquire is a measured (near) zero, not absent");
  assert.equal(t.bundle.n, 1);
  assert.equal(t.read, "stamps");
  assert.ok(t.exec_ms != null && t.exec_ms >= 0, "the main thread ran the door: exec is measured");
  // a request with no bundle and no lease: bundle null (none ran), leases.main a measured zero
  const quiet = newTiming();
  runTiming(quiet, () => markRouted(quiet));
  const q = timingLine(quiet, { door: "doorstep", status: 404 });
  assert.equal(q.bundle, null);
  assert.equal(q.leases.main.n, 0);
  assert.equal(q.ok, false);
  // a failed acquisition
  const dead = { options: { max: 3, connectionTimeoutMillis: 10 }, connect: async () => { await sleep(25); throw new Error("timeout exceeded when trying to connect"); } };
  const f = newTiming();
  await runTiming(f, async () => {
    await assert.rejects(onPenClient(dead, "main", async () => {}), (e) => e instanceof StoreAcquireTimeout, "the read gets its own error, unchanged");
  });
  const L = timingLine(f, { door: "doorstep", status: 503 }).leases.main;
  assert.equal(L.failed, 1, "the failed acquisition is counted");
  assert.equal(L.n, 0, "and is not a lease");
  assert.ok(L.failed_wait_ms >= 20, `its wait ${L.failed_wait_ms} ms is its own field`);
  assert.equal(L.held_ms.sum, 0);
});

test("4 · BEHAVIOUR PRESERVED: release and discard are the lease's own, the result and the error pass through, and a telemetry fault never fails a read", async () => {
  const released = [];
  const client = () => ({ query() {}, on() {}, removeListener() {}, release(d) { released.push(d); } });
  const pool = { options: { max: 3 }, connect: async () => client() };
  const tm = newTiming();
  await runTiming(tm, async () => {
    assert.equal(await onPenClient(pool, "x", async () => "answer"), "answer");
    await assert.rejects(onPenClient(pool, "x", async () => { throw new Error("the read's own error"); }), /the read's own error/);
    assert.equal(await onPenClient(pool, "x", async (_c, discard) => { discard(); return 1; }), 1);
  });
  assert.deepEqual(released, [undefined, undefined, true], "release(undefined) twice and release(true) on discard, exactly as without timing");
  assert.equal(timingLine(tm, { door: "doorstep", status: 200 }).leases.main.n, 3, "an erroring lease is still a counted lease, truthfully timed");
  // outside any request: no context, no change
  assert.equal(await onPenClient(pool, "x", async () => "bare"), "bare");
  // a broken context never fails the read
  const broken = { leases: null, bundle: null };
  assert.equal(await runTiming(broken, () => onPenClient(pool, "x", async () => "still answers")), "still answers");
  assert.equal(await runTiming(broken, () => bundleSpan(async () => 7)), 7);
  assert.equal(timingLine(broken, { door: "doorstep", status: 200 })?.leases.main, null, "an unreadable context says its leases were not measured, and never throws");
  assert.equal(timingLine(newTiming(), { door: "not-a-door", status: 200 }), null, "a label outside the fixed set is no line");
  assert.equal(timingLine(null, { door: "doorstep" }), null);
  assert.equal(currentTiming(), undefined);
  leaseStart().got(); leaseStart().failed(); leaseStart().released();   // inert with no request in scope
});

test("5 · A RETRY: the first worker stopping before it answers shows two tries, the first-to-last send gap and the same rid", async () => {
  const pool = mkPool(2);
  await ready(pool, 2);
  // the read holds worker 0 or 1 for 600 ms; kill the one that took it, the read is handed to the other once
  const read = oneRead(pool, { acquire: 0, held: 600 });
  await sleep(120);
  const busy = pool.disclose().in_flight.findIndex((n) => n > 0);
  assert.ok(busy >= 0, "a worker holds the read");
  await pool.kill(busy);
  const done = await read;
  const t = done.line();
  assert.equal(done.code, 200, "the read is answered by the other worker, as without timing");
  assert.equal(t.tries, 2);
  assert.ok(t.retry_ms >= 100, `retry_ms ${t.retry_ms} is the first send to the second`);
  assert.notEqual(t.worker, busy, "the selected worker is the one that answered");
  assert.equal(t.leases.worker.n, 1);
  assert.match(t.rid, /^[0-9a-f]{12}$/);
});

test("6 · NO SECRET: a planted secret in the URL, query, header, body and handle is in neither the timing line nor the access line", async () => {
  const SECRET = "S3CR3T-sentinel-0451";
  const pool = mkPool(1);
  await ready(pool, 1);
  const o = await oneRead(pool, { acquire: 1, held: 1 }, { url: `/doorstep/${SECRET}?key=${SECRET}&acquire=1&held=1`, headers: { authorization: `Bearer ${SECRET}`, "x-note": SECRET }, ip: SECRET });
  const t = o.line();
  const text = JSON.stringify(t);
  assert.ok(!text.includes(SECRET), "no planted value in the timing line");
  const line = accessLine({ ts: "t", ip: "i", method: "GET", path: "/doorstep/x", status: 200, ms: 1, ua: "", household: null, mcp: null, call: null, timing: t });
  assert.ok(!line.includes(SECRET) && Buffer.byteLength(line) + 1 <= 4000, "nor in the bounded access line, which stays within one atomic write");
  // the keys of a timing line are a fixed set of names and numbers
  for (const [k, v] of Object.entries(t)) assert.ok(["string", "number", "boolean", "object"].includes(typeof v) || v === null, k);
  const allowed = new Set(["v", "rid", "door", "read", "route", "worker", "tries", "ok", "status", "routed_ms", "admit_ms", "retry_ms", "queue_ms", "exec_ms", "return_ms", "total_ms", "bundle", "leases", "cov"]);
  for (const k of Object.keys(t)) assert.ok(allowed.has(k), `an unexpected field ${k}`);
  // a read name outside the fixed shape is dropped
  const odd = newTiming(); runTiming(odd, () => markRouted(odd));
  assert.ok(!("read" in timingLine(odd, { door: "household", read: `stamps ${SECRET}`, status: 200 })));
  assert.ok(nowMs() > 0);
});
