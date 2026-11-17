// read-timing.mjs — WHERE A DOORSTEP OR HOUSEHOLD READ'S TIME GOES, written to the access log (POS-1064/b; Darko 2026-11-16 17:49 EST "Yes, hotfix";
// Wright 22:50Z: "Path-tagged timing on the doorstep and household read paths: request → worker take (its queue wait) → bundle → store reads, with each
// lease's acquire wait, length and count per request, written to telemetry").
//
// MEASUREMENT ONLY. Nothing here changes a response, a status, a refusal, admission, routing, a pool, a transaction or a retry. Every hook is wrapped so a
// telemetry fault is silence, never a failed read (the access log's own stance: telemetry must never take down a door).
//
// ── THE RECORD ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// One `timing` object on the request's ONE access line (telemetry.mjs), written by the main thread when the response finishes, for the doorstep and household
// doors only (REST /doorstep/<h>, /doorsteps, /household, and MCP household / doorstep). Units are milliseconds, to 0.1. Boundaries, in time order:
//
//   t0        the main thread's handleRequest begins (BEFORE the credential is resolved: admission begins here, as the line's own `ms` does)
//   routed    the main thread's decision point: the credential is resolved, the bouncer admitted the call, and the door is about to run on this thread or hand the
//             read to a worker (the REST handover) / the MCP handler has parsed the body and hands the call over (`sent`)
//   sent      the main thread posts the read to the chosen worker                 [worker route only]
//   taken     the worker's message handler receives it                            [worker route only]
//   done      the worker's response is complete and posted back                   [worker route only]
//   received  the main thread's message handler receives the answer               [worker route only]
//   finish    the response finished on the socket (the line's `ms` ends here)
//
//   admit_ms  t0 → routed (main route) or t0 → sent (worker route): the request's admission, credential lookup and routing, on the main thread. `routed_ms` is
//             t0 → routed alone, so a handover's own cost (body, earshot, world-writes snapshot) is admit_ms − routed_ms
//   retry_ms  first send → the send that was taken, when the first worker stopped before it answered and the read was handed to another (null otherwise);
//             `sent` below is the LAST send, and admit_ms ends at the FIRST
//   queue_ms  sent → taken: how long the worker took to pick the read up (its port's queue, and the worker thread's own busy event loop); null on the main route
//   exec_ms   the thread that ran the door: taken → done on a worker, routed → finish on the main thread
//   return_ms done → received: the answer's way back to the main thread's loop (a busy main thread shows here); null on the main route
//   total_ms  t0 → finish
//   NOT SUMMED INTO ELAPSED: admit, queue, exec and return follow one another on one request's path, but `bundle` and `leases` are measured INSIDE exec on whichever
//   thread ran it, and overlap each other and exec. `bundle.sum_ms` and a lease group's `held_ms.sum` are sums of durations, not wall time, and overlapping
//   calls count separately. A bundle's duration is not SQL time and is never called lease time.
//
//   bundle    { n, sum_ms, max_ms } over houseBundle / housePage / doorstepBundle calls this request made on the executing thread; null: none ran on this path
//   leases    { main, worker }, each null (not measured: that thread did not run any of this request) or
//             { n, failed, acquire_ms: { sum, max }, held_ms: { sum, max }, failed_wait_ms }:
//               n          pen connections this request took on that thread (store-pool.mjs § onPenClient: every officeRead and officeWrite)
//               failed     acquisitions that did not produce a connection (the 10 s acquire timeout, a pool error), counted apart from n
//               acquire_ms how long each wait for a connection took, summed and the longest (a measured 0 is a connection that was free)
//               held_ms    acquired → released, summed and the longest: the whole time the pen was held, SQL and JavaScript between statements alike
//               failed_wait_ms  the time failed acquisitions waited
//             `main` is the main thread's leases for this request (admission's credential read, and the door itself when it ran there); `worker` the worker's.
//   cov       "pen": WHICH POOL the leases cover. Other pools (acts, claims, serve) are not measured here.
//
//   rid       an opaque random id, joined across the handover: the same on both threads, on a retry, and never derived from the request
//   route     "main" | "worker"; worker the slot (0-based) the read was handed to, `tries` how many workers were asked (2: the first stopped before it answered)
//   door      "doorstep" | "doorsteps" | "household" | "mcp" | "mcp-doorstep"; `read` the household read's own name when it is one of the office's fixed set, and only
//             for a single-call request; `batch` the number of tools/calls when an MCP request carried more than one (the record describes the whole request).
//             READS ONLY: a REST GET, or an MCP request whose every message is a household/doorstep read (classifyMcpRead); an act, an explain, a letter opening, a
//             batch holding any of them or any other tool, carries no timing
//   status    the response's status; `ok: false` is a refusal or a failure, not an absent measurement
//
// ABSENT, ZERO AND FAILED ARE THREE THINGS: null is "this was not measured here" (no worker ran it, no lease was taken on that thread, no bundle ran), 0 is a
// measurement that found zero, and `failed` counts acquisitions that did not get a connection.
//
// PRIVACY: bounded labels and numbers only. No URL, path value, query, body, header, key, handle, SQL, parameter or error text ever enters a context (the labels
// are chosen from fixed sets by the caller; this file takes none from a request). test/read-timing.test.mjs plants a secret in every request channel and reads
// the whole line for it.

import { AsyncLocalStorage } from "node:async_hooks";
import { performance } from "node:perf_hooks";
import { randomBytes } from "node:crypto";

const als = new AsyncLocalStorage();

/** Epoch milliseconds with sub-millisecond resolution. Comparable between the main thread and a worker (both add their own time origin). */
export const nowMs = () => performance.timeOrigin + performance.now();

const round = (x) => Math.round(x * 10) / 10;
const groupOf = () => ({ n: 0, failed: 0, acquire_sum: 0, acquire_max: 0, held_sum: 0, held_max: 0, failed_wait: 0 });

/** A new request's timing context: its opaque id, its t0 (epoch ms), and the accumulators for what runs under it. */
export function newTiming(t0 = nowMs(), rid = null) {
  return { rid: rid ?? randomBytes(6).toString("hex"), t0, routed: null, hand: null, answer: null, leases: groupOf(), bundle: { n: 0, sum: 0, max: 0 } };
}

/** Run `fn` with `tm` as the current request's context (every async continuation under it sees it, and no other request does). */
export function runTiming(tm, fn) {
  // ONE invocation, and the callback's own result or exception, untouched: there is no catch here that could run `fn` a second time or replace what it threw.
  return tm ? als.run(tm, fn) : fn();
}

// ── WHICH REQUESTS THIS RECORD IS FOR ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// The doorstep and household READS, and nothing that writes. A REST read is a GET (server.mjs § timingFields); an MCP request is classified here from the WHOLE
// request, never from its last tool: every message must be a tools/call to a household or doorstep READ, so a batch holding an act, an explain, a letter opening,
// any other tool or any non-call message carries NO timing at all (it is not a request this record covers, said in docs/read-workers.md), and an act can never be
// made to look like a read by a read that follows it.
const isObject = (x) => x !== null && typeof x === "object" && !Array.isArray(x);

/** The door of one MCP message when it is a doorstep/household read, else null. */
function mcpReadDoor(m) {
  if (m?.method !== "tools/call" || !isObject(m.params)) return null;
  const name = m.params.name;
  const args = m.params.arguments ?? {};
  if (name === "read_doorstep") return isObject(args) ? "mcp-doorstep" : null;
  if (name !== "household" && name !== "doorstep") return null;
  if (!isObject(args)) return null;
  if ((args.do != null && args.do !== "") || args.explain != null) return null;                  // an act, or the grammar's explain
  if (name === "household" && String(args.read ?? "").trim() === "letter") return null;         // opening a letter clears it for the key: a write
  return name === "doorstep" ? "mcp-doorstep" : "mcp";
}

/**
 * `{ door, calls }` for an MCP request whose EVERY message is a doorstep or household read (door "mcp" when any is a household read, "mcp-doorstep" when all are
 * doorstep), else null. `calls` is how many tools/calls the one request carried: the record describes the whole request.
 */
export function classifyMcpRead(messages) {
  try {
    if (!Array.isArray(messages) || !messages.length) return null;
    const doors = messages.map(mcpReadDoor);
    if (doors.some((d) => d === null)) return null;
    return { door: doors.includes("mcp") ? "mcp" : "mcp-doorstep", calls: messages.length };
  } catch { return null; }
}

/** The context of the request this code runs under, or undefined (a boot task, a test, a request that has none). */
export const currentTiming = () => { try { return als.getStore(); } catch { return undefined; } };

/** Mark `routed`: the main thread's decision point. First mark wins. */
export function markRouted(tm = currentTiming()) {
  try { if (tm && tm.routed == null) tm.routed = nowMs(); } catch { /* telemetry never fails a read */ }
}

// ── LEASES: the pen connection's acquire wait and its acquired → released time ─────────────────────────────────────────────────────────────────────────

const NO_LEASE = { got() {}, failed() {}, released() {} };

/** Begin timing a pen lease under the current request. Returns { got, failed, released }; inert when no request is in scope. */
export function leaseStart() {
  const tm = currentTiming();
  if (!tm) return NO_LEASE;
  const asked = nowMs();
  let gotAt = null;
  return {
    got() { try { gotAt = nowMs(); const w = gotAt - asked; tm.leases.acquire_sum += w; if (w > tm.leases.acquire_max) tm.leases.acquire_max = w; } catch { /* */ } },
    failed() { try { tm.leases.failed += 1; tm.leases.failed_wait += nowMs() - asked; } catch { /* */ } },
    released() {
      try {
        if (gotAt == null) return;
        const h = nowMs() - gotAt;
        tm.leases.n += 1; tm.leases.held_sum += h; if (h > tm.leases.held_max) tm.leases.held_max = h;
      } catch { /* */ }
    },
  };
}

// ── BUNDLES ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

const inSpan = new AsyncLocalStorage();

/**
 * Time one bundle call under the current request, whatever it does (returns or throws, the result is the call's own). A bundle called from inside another timed
 * bundle (the bare doorstep composes through doorstepBundle) is part of the outer one and is not counted again; sibling calls (a bulk read's) each count.
 */
export async function bundleSpan(fn) {
  const tm = currentTiming();
  if (!tm || inSpan.getStore() === true) return fn();
  const t = nowMs();
  try { return await inSpan.run(true, fn); }
  finally { try { const d = nowMs() - t; tm.bundle.n += 1; tm.bundle.sum += d; if (d > tm.bundle.max) tm.bundle.max = d; } catch { /* */ } }
}

/**
 * POS-1086 step 1: time one SEGMENT of a bundle's composition under the current request (the doorstep's core, stances, rulings, ...), into
 * `bundle.seg[name] = { n, sum, max }`. Measurement only: the callback's result or exception is returned or thrown untouched; inert with no request in scope.
 * `name` is chosen from a fixed set by the caller (never from a request). A segment inside a nested bundle call counts under the same request.
 */
export async function segSpan(name, fn) {
  const tm = currentTiming();
  if (!tm) return fn();
  const t = nowMs();
  try { return await fn(); }
  finally {
    try {
      const d = nowMs() - t;
      const seg = (tm.bundle.seg ??= {});
      const s = (seg[name] ??= { n: 0, sum: 0, max: 0 });
      s.n += 1; s.sum += d; if (d > s.max) s.max = d;
    } catch { /* */ }
  }
}

// ── THE SUMMARIES ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** A lease group as the record states it. */
function leaseGroup(g) {
  if (!g) return null;
  return { n: g.n, failed: g.failed, acquire_ms: { sum: round(g.acquire_sum), max: round(g.acquire_max) }, held_ms: { sum: round(g.held_sum), max: round(g.held_max) }, failed_wait_ms: round(g.failed_wait) };
}
const segGroup = (seg) => Object.fromEntries(Object.entries(seg).map(([k, s]) => [k, { n: s.n, sum_ms: round(s.sum), max_ms: round(s.max) }]));
const bundleGroup = (b) => (b && b.n ? { n: b.n, sum_ms: round(b.sum), max_ms: round(b.max), ...(b.seg ? { seg: segGroup(b.seg) } : {}) } : null);

/**
 * What a WORKER reports back with its answer (bounded numbers, no labels): the take and done instants, the bundle and the leases it took. `taken` and `done`
 * are epoch ms; the main thread does the subtraction against its own `sent`.
 */
export function workerReport(tm, taken, done = nowMs()) {
  try { return { rid: tm.rid, taken, done, bundle: bundleGroup(tm.bundle), leases: leaseGroup(tm.leases) }; } catch { return null; }
}

const DOORS = new Set(["doorstep", "doorsteps", "household", "mcp", "mcp-doorstep"]);
const num = (x) => (Number.isFinite(x) ? round(x) : null);

/**
 * The `timing` object for the access line: the main thread's context plus whatever the worker reported. `label` is `{ door, read }` chosen from fixed sets by
 * the caller; anything outside them is dropped here too. Null when the request is not on a path this record is for.
 */
export function timingLine(tm, { door = null, read = null, calls = 1, status = null, finish = nowMs() } = {}) {
  try {
    if (!tm || !DOORS.has(door)) return null;
    const h = tm.hand;
    const w = tm.answer; // the worker's report, when it answered
    const sent = h?.sent ?? null;
    const firstSent = h?.first_sent ?? sent;
    const routed = tm.routed;
    const onWorker = h != null;
    const exec = onWorker ? (w ? num(w.done - w.taken) : null) : (routed != null ? num(finish - routed) : null);
    return {
      v: 1, rid: tm.rid, door, ...(Number.isInteger(calls) && calls > 1 ? { batch: Math.min(calls, 99) } : {}), ...(typeof read === "string" && /^[a-z0-9-]{1,24}$/.test(read) ? { read } : {}),
      route: onWorker ? "worker" : "main", worker: onWorker ? h.slot : null, tries: onWorker ? h.tries : null,
      ok: status == null ? null : status < 400, status,
      routed_ms: num(routed != null ? routed - tm.t0 : null),
      admit_ms: num((onWorker ? firstSent : routed) != null ? (onWorker ? firstSent : routed) - tm.t0 : null),
      retry_ms: onWorker && h.tries > 1 ? num(sent - firstSent) : null,
      queue_ms: onWorker && w ? num(w.taken - sent) : null,
      exec_ms: exec,
      return_ms: onWorker && w && tm.answer_at != null ? num(tm.answer_at - w.done) : null,
      total_ms: num(finish - tm.t0),
      bundle: onWorker ? (w?.bundle ?? null) : bundleGroup(tm.bundle),
      leases: { main: leaseGroup(tm.leases), worker: onWorker ? (w?.leases ?? null) : null },
      cov: "pen",
    };
  } catch { return null; }
}
