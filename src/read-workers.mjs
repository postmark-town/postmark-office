// read-workers.mjs — reads answered on the other cores, writes kept on one
// thread (POS-266, "the office holds a crowd").
//
// ── THE SHAPE ────────────────────────────────────────────────────────────────
//
// The box has four cores and the office used one. On the Snug Harbour night a
// single read (/world/settlements, /world/present) held the one thread for
// seconds, and every caller behind it waited, the letters included. So:
//
//   - THE MAIN THREAD keeps the port, every write, the admission (the bouncer's
//     buckets are its RAM), the telemetry line, and every read whose answer
//     lives in its own memory (MAIN_ONLY_READS below).
//   - N READ WORKERS (worker_threads, N = cores − 1, OFFICE_READ_WORKERS to
//     tune, 0 to switch off) each run the SAME server module as a read-role
//     office (`role.mjs`: sqlite read-only, no pen, the unsafe doors refused by
//     name) that never listens. The main thread hands a worker a read after it
//     has admitted it, and writes the worker's answer back on its own socket.
//
// Each worker holds its own caches: it is a fresh module graph. Most of them
// are keyed on a stamp the worker reads itself (a file's mtime, a ref file, a
// table's count), and those need nothing from here. The ones a WRITE on the
// main thread moves in memory are told by a message — `announce(kind, payload)`
// on the main thread, `onAnnounce(kind, fn)` in the module that owns the cache.
// Messages and requests to one worker ride ONE port, and a port delivers in
// order, so a read handed over after a write's announcement is answered after
// the worker has applied it. That is the whole freshness guarantee: no read on a
// worker is older than the write that preceded it by more than that one hop.
// The inventory of every cache and how its worker learns it moved is in
// docs/read-workers.md.
//
// ── WHY THREADS AND NOT DEC-4's PROCESSES ────────────────────────────────────
//
// DEC-4 (2026-09-08) proposed three read PROCESSES behind nginx, and its kit
// (now deploy/_archived/postmark-office-read@.service, nginx-postmark-read-pool*.conf;
// POS-729) was never applied. A process cannot be told what moved: since POS-264 the
// positions projection is RAM on the writer, fed by its walk door, and a read
// process would answer walkers from a projection up to PROJECTION_MAX_AGE_MS
// old. The worker keeps DEC-4's three refusals (it boots as `--role read`), and
// replaces its transport.

import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { availableParallelism } from "node:os";
import { Writable } from "node:stream";
import { workerSafe } from "./role.mjs";
import { faultLogged } from "./fault-words.mjs"; // the office's own words for its own fault (POS-578)
import { nowMs, newTiming, runTiming, currentTiming, workerReport } from "./read-timing.mjs"; // POS-1064/b: measurement only

/** True inside a read worker. Everything that must not run twice keys on this. */
export const IN_READ_WORKER = !isMainThread && workerData?.readWorker === true;

/**
 * The reads a worker must NOT answer, because the answer is the main thread's
 * RAM and no message keeps a copy of it:
 *
 *   /world/conversations — the voices window (voices.mjs), appended by every say
 *                          on the main thread; a worker's copy hydrates the log
 *                          once and would never see another voice. voices.mjs is
 *                          O1's, so the window is not taught to listen here.
 *   /world/dynamic       — `acts_by_channel` (channel.mjs), counted per act on
 *                          the main thread.
 *   /household           — the standing read carries `world_writes`, the
 *                          bouncer's live budget, which is main-thread RAM.
 *   /world/say/stream    — POS-265's push waits on new voices, and voices land
 *                          on the main thread: served from a worker, the stream
 *                          would open and never hear a word.
 *
 * A read not named here, not refused by `workerSafe` and not the REST listen
 * (`listensToVoices` below) goes to a worker.
 */
export const MAIN_ONLY_READS = new Set(["/world/conversations", "/world/dynamic", "/household", "/world/say/stream"]);

/**
 * GET /world/apex?read=say is the one read whose answer is the voices window by
 * its QUERY, not its path: the same listen as the MCP `world { read: "say" }`,
 * which `mcpWorkerTakes` below keeps home. Handed to a worker, it heard the
 * worker's window as it hydrated and never another voice (POS-284's hotfix,
 * measured before the fix: a say on the main thread, then this GET on worker-0,
 * and the voice was not in it). `read` is trimmed as the apex trims it.
 */
function listensToVoices(path, query) {
  return path === "/world/apex" && String(query?.get("read") ?? "").trim() === "say";
}

/**
 * A letter read IN FULL clears it for the recipients the caller's key holds
 * (POS-286, src/unread-store.mjs § answerOpening), and that is a write. So a
 * KEYED full read stays on the main thread, where the writes are, rather than
 * teaching a read-role worker to write. A keyless one writes nothing and still
 * goes to a worker. The MCP twins (read_letter, town, household) never reach a
 * worker: `mcpWorkerTakes` names only the world's reads.
 */
export function opensALetter(path, query = null) {
  if (/^\/letters\/.+/.test(path)) return true;
  return path === "/town/apex" && String(query?.get("read") ?? "").trim() === "letter";
}

/** Does a read with this method, path and query (and the caller's key) go to a worker? */
export function workerTakes(method, path, query = null, key = null) {
  const keyed = (key?.handles?.size ?? key?.handles?.length ?? 0) > 0;
  return method === "GET" && workerSafe(method, path) && !MAIN_ONLY_READS.has(path) && !listensToVoices(path, query)
    && !(keyed && opensALetter(path, query));
}

/**
 * THE AGENTS' READS (POS-284). An agent reads through POST /mcp, so the method
 * rule above sends every one of them to the main thread, where on dev at 80
 * agents open-your-eyes alone held a third of the thread. These MCP calls are
 * the same reads the workers already answer as GETs (/world/orient,
 * /world/eyes, /world/apex), through the same functions:
 *
 *   world_orient, world_open_your_eyes, and `world` with no `do:`: the bare
 *   look and every `read:` shadow, save `read: "say"`, which listens, and a
 *   listen is the voices window's RAM (it marks the listener present).
 *
 * A NAMED LIST, not "everything that is not a write": `writeShaped` answers
 * which calls the bouncer charges as acts, not which answers live in the main
 * thread's memory (the household standing read's `world_writes` is a read and
 * is the bouncer's own RAM). A read not named here stays on the main thread.
 * The main thread admits and charges the call first, exactly as for a GET;
 * the worker answers it and refuses anything this list does not name.
 */
const MCP_WORKER_TOOLS = new Set(["world_orient", "world_open_your_eyes"]);
export function mcpWorkerTakes(messages) {
  if (!Array.isArray(messages) || !messages.length) return false;
  return messages.every((m) => {
    if (m?.jsonrpc !== "2.0" || m.method !== "tools/call" || m.id === undefined) return false;
    const name = m.params?.name;
    const args = m.params?.arguments ?? {};
    if (MCP_WORKER_TOOLS.has(name)) return true;
    if (name === "household") return householdReadOnWorker(args);
    if (name === "doorstep") return doorstepReadOnWorker(args);
    if (name !== "world" || typeof args !== "object" || Array.isArray(args)) return false;
    if (args.do != null && args.do !== "") return false;
    return String(args.read ?? "").trim() !== "say";
  });
}

/**
 * THE HOUSEHOLD'S READS (POS-1064). `household` is answered on the main thread
 * today, so a doorstep waited in line behind everything that thread does (POS-1057:
 * ~100-300 ms of its synchronous CPU per read, 12 residents polling together queued
 * 3-8 s). The same reads already run on a worker as REST GETs (/doorstep, /quests,
 * /stamps); these are the household reads that answer from the store, the clone and
 * the files, through the same functions, with no main-thread memory but ONE, which
 * the handover carries (the world-write budget, `wantsWorldWrites`).
 *
 * A NAMED LIST, as above. NOT on it, and so on the main thread: every `do:` (an act),
 * `read: "letter"` (opening a letter clears it for the key's residents, a write:
 * `opensALetter`), `explain:`, and every read this list does not name (mail, window,
 * address, home, media, earpiece, fund, blocks, settings, house, day, hearth: not
 * audited for this lane, they keep their thread).
 */
export const HOUSEHOLD_WORKER_READS = new Set(["doorstep", "stamps", "quests", "stances", "outcomes", "stakes", "waiting", "marks", "needs-you", "happened", "closer", "correspondents", "posts", "standing"]);
function householdReadOnWorker(args) {
  if (typeof args !== "object" || Array.isArray(args)) return false;
  if ((args.do != null && args.do !== "") || args.explain != null) return false;
  const read = String(args.read ?? "").trim();
  // the bare call is the glance (v2) or the checklist (v1): both carry the standing's world_writes
  if (read === "") return args.read == null || args.read === "";
  return HOUSEHOLD_WORKER_READS.has(read);
}
/** `doorstep` (the apex of apexes): a read, never an act; its `world` item carries `heard`, so it takes the earshot too. */
function doorstepReadOnWorker(args) {
  if (typeof args !== "object" || Array.isArray(args)) return false;
  if ((args.do != null && args.do !== "") || args.explain != null) return false;
  const read = String(args.read ?? "").trim();
  return read === "" || read === "bundle";
}

/**
 * Does a handed-over household call state the standing's `world_writes`? That block
 * is the bouncer's live budget, this thread's memory (admission is one thread's), so
 * the main thread reads it for the key's household at admission and hands it over
 * with the call, as it does earshot; a worker's own bouncer is empty and would say 0.
 */
export function wantsWorldWrites(messages) {
  if (!Array.isArray(messages)) return false;
  return messages.some((m) => {
    if (m?.params?.name !== "household") return false;
    const a = m.params?.arguments ?? {};
    if (a.do != null && a.do !== "") return false;
    const read = String(a.read ?? "").trim();
    return read === "" || read === "standing";
  });
}

/**
 * Does this handed-over MCP call need the main thread's earshot (POS-632 W4)?
 * A bare world read at v2 carries `heard`, and the voices window lives on the
 * main thread. `shape` is the office's default (WORLD_READ_SHAPE).
 */
export function wantsEarshot(messages, shape = "v0") {
  if (!Array.isArray(messages)) return false;
  return messages.some((m) => {
    if (m?.params?.name === "doorstep") return true; // the doorstep's world item is a v2 bare read
    if (m?.params?.name !== "world") return false;
    const a = m.params?.arguments ?? {};
    if ((a.do != null && a.do !== "") || (a.read != null && a.read !== "")) return false;
    // WLD-187: a top-level at: is the spectator look, which is always the v2 read (and so carries `heard`), whatever the office's
    // default shape: before the default flip it must reach a worker WITH the earshot snapshot, or its heard block is "unavailable".
    // A look that asks another shape is refused at the door, so it needs none.
    if (a.at != null && a.at !== "") return a.read_shape == null || a.read_shape === "" || a.read_shape === "v2";
    return (a.read_shape ?? shape) === "v2";
  });
}

/** How many workers: OFFICE_READ_WORKERS if it is a whole number, else cores − 1. */
export function readWorkerCount(env = process.env, cores = availableParallelism()) {
  const raw = env.OFFICE_READ_WORKERS;
  if (raw != null && String(raw).trim() !== "") {
    const n = Number(raw);
    if (Number.isInteger(n) && n >= 0) return n;
    console.warn(`WARN: OFFICE_READ_WORKERS="${raw}" is not a whole number; using cores − 1`);
  }
  return Math.max(0, cores - 1);
}

// ── ANNOUNCEMENTS: what a write moved ───────────────────────────────────────

const listeners = new Map(); // kind -> [fn]
let broadcast = null;        // set on the main thread by a running pool

/** Main thread: tell every worker that `kind` moved. A no-op without a pool, and in a worker. */
export function announce(kind, payload = null) {
  if (broadcast) broadcast(kind, payload);
}

/** In a worker: run `fn(payload)` when the main thread announces `kind`. Inert on the main thread. */
export function onAnnounce(kind, fn) {
  if (!IN_READ_WORKER) return;
  if (!listeners.has(kind)) listeners.set(kind, []);
  listeners.get(kind).push(fn);
}

// ── CALLS: a read the main thread asks of a worker mid-request (POS-1219) ────
//
// A handover (`forward`) gives a worker a whole request. A CALL gives it one named
// read inside a request the main thread keeps: today an act's look (world-apex.mjs §
// actLook), the orient and eyes reads every world act gathers before its law, which
// are the same functions a worker already answers as GET /world/orient and /world/eyes.
// The answer comes back as a structured clone. `callOnWorker` answers null whenever no
// worker gave one (no pool, none ready, a payload that cannot be cloned, a worker that
// stopped, a handler that threw or an answer that cannot be cloned), and the caller
// then does the read itself, on its own thread, exactly as before: a call never
// refuses, and it never answers what the caller could not have answered itself.

const callHandlers = new Map(); // name -> fn (in a worker)
let caller = null;              // set on the main thread by a running pool

/** Main thread: ask a worker for the read named `name`. Resolves to its answer, or null when no worker answered (the caller reads it itself). */
export function callOnWorker(name, payload) {
  if (!caller || IN_READ_WORKER) return Promise.resolve(null);
  return caller(name, payload);
}

/** Main thread: is there a running pool to ask at all? (False with the workers off, in a worker, and once the pool stopped.) */
export const workerCallable = () => caller != null && !IN_READ_WORKER;

/** In a worker: answer the call named `name` with `fn(payload)`. Inert on the main thread. */
export function onCall(name, fn) {
  if (!IN_READ_WORKER) return;
  callHandlers.set(name, fn);
}

// ── THE WORKER'S SIDE ────────────────────────────────────────────────────────

/** A response a handler can write to as if it were http.ServerResponse, collected for the port. */
class CollectedResponse extends Writable {
  constructor(onDone) {
    super();
    this.statusCode = 200;
    this.statusMessage = "";
    this.headersSent = false;
    this._headers = new Map(); // lower-case name -> [name, value]
    this._chunks = [];
    this._onDone = onDone;
    this.on("finish", () => {
      this._onDone(this);
      this.emit("close");
    });
  }
  setHeader(name, value) { this._headers.set(String(name).toLowerCase(), [name, value]); return this; }
  getHeader(name) { return this._headers.get(String(name).toLowerCase())?.[1]; }
  getHeaders() { return Object.fromEntries([...this._headers.values()].map(([k, v]) => [k.toLowerCase(), v])); }
  hasHeader(name) { return this._headers.has(String(name).toLowerCase()); }
  removeHeader(name) { this._headers.delete(String(name).toLowerCase()); }
  writeHead(code, reason, headers) {
    if (typeof reason === "object" && reason !== null) { headers = reason; reason = undefined; }
    this.statusCode = code;
    if (typeof reason === "string") this.statusMessage = reason;
    if (Array.isArray(headers)) for (let i = 0; i + 1 < headers.length; i += 2) this.setHeader(headers[i], headers[i + 1]);
    else if (headers) for (const [k, v] of Object.entries(headers)) this.setHeader(k, v);
    this.headersSent = true;
    return this;
  }
  flushHeaders() { this.headersSent = true; }
  _write(chunk, encoding, cb) {
    this.headersSent = true;
    this._chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding));
    cb();
  }
  body() { return Buffer.concat(this._chunks); }
  headerPairs() { return [...this._headers.values()]; }
}

/** Serve the reads the main thread hands over, through `handle(req, res)`. */
export function serveReadsInWorker(handle) {
  parentPort.on("message", (msg) => {
    if (msg?.type === "announce") {
      for (const fn of listeners.get(msg.kind) ?? []) {
        try { fn(msg.payload); }
        catch (e) { console.error(`[read-worker] the ${msg.kind} listener threw (${String(e?.message ?? e).slice(0, 120)})`); }
      }
      return;
    }
    if (msg?.type === "call") { // POS-1219: one named read; the answer is the handler's value, or `failed` (the main thread then reads it itself)
      const fn = callHandlers.get(msg.name);
      const failed = (e) => parentPort.postMessage({ type: "answer", id: msg.id, failed: String(e?.message ?? e).slice(0, 200) });
      Promise.resolve()
        .then(() => { if (!fn) throw new Error(`this worker answers no call named ${msg.name}`); return fn(msg.payload); })
        .then((value) => { try { parentPort.postMessage({ type: "answer", id: msg.id, value }); } catch (e) { failed(e); } }, failed);
      return;
    }
    if (msg?.type !== "read") return;
    const { id, method, url, headers, ip, body = null, mcp = false, earshot = null, worldWrites = null, timing = null } = msg;
    // POS-1064/b: the instant this worker picked the read up, and a context of its own for the leases and bundles it runs (the main thread's rid joins them)
    const taken = nowMs();
    const tm = timing && typeof timing.rid === "string" ? newTiming(taken, timing.rid.slice(0, 32)) : null;
    // An ended request: a GET's is empty, an agent's MCP read (POS-284) carries
    // the JSON-RPC body the main thread already read, delivered as one chunk
    // before the end.
    const req = new Writable({ write(_c, _e, cb) { cb(); } });
    Object.assign(req, { method, url, headers, socket: { remoteAddress: ip }, connection: { remoteAddress: ip }, handedMcpRead: Boolean(mcp), handedEarshot: earshot, handedWorldWrites: worldWrites });
    req.on = ((on) => function (ev, fn) {
      if (ev === "end") { queueMicrotask(() => queueMicrotask(fn)); return this; }
      if (ev === "data") { if (body != null) queueMicrotask(() => fn(body)); return this; }
      return on.call(this, ev, fn);
    })(req.on);
    const res = new CollectedResponse((r) => {
      const body = r.body();
      const ab = body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength);
      parentPort.postMessage({ type: "answer", id, status: r.statusCode, statusMessage: r.statusMessage, headers: r.headerPairs(), body: ab, ...(tm ? { timing: workerReport(tm, taken) } : {}) }, [ab]);
    });
    try { if (tm) runTiming(tm, () => handle(req, res)); else handle(req, res); }
    catch (e) {
      parentPort.postMessage({ type: "answer", id, status: 500, headers: [["Content-Type", "application/json"]],
        body: Buffer.from(JSON.stringify({ error: "the read worker tripped", hint: faultLogged("the read worker tripped", e) })).buffer }); // its error goes to the log (POS-578)
    }
  });
  parentPort.postMessage({ type: "ready" });
}

// ── THE MAIN THREAD'S SIDE ───────────────────────────────────────────────────

/**
 * Start `size` workers running `entry` (the server module) as read-role
 * offices. A worker that exits is respawned; a worker that exits BEFORE it was
 * ever ready is a boot refusal (read role's guards: no oauth.db, no dynamic.db,
 * thrown in a worker, server.mjs § refuseBoot), and after three of those in a
 * row IN ONE SLOT that slot stays empty, and the main thread answers the reads
 * it would have taken (office #236: a worker that cannot start costs the office
 * a core, never its life). Every exit is one log line naming the worker and why.
 * The reads a dead worker was holding are handed to another worker once (a GET
 * is safe to ask again), else answered 503.
 */
export function startReadPool({ size, entry, argv = [], env = process.env, respawnMs = 250, log = console } = {}) {
  const workers = []; // by slot: { w, ready, inflight: Set<id>, slot, served, called, cause }
  const pending = new Map(); // id -> { res, msg, tries }
  const calls = new Map();   // id -> { resolve } (POS-1219: a call held by a worker)
  let nextId = 1;
  const bootFailures = new Array(size).fill(0); // per slot: exits before ready, in a row
  const down = new Array(size).fill(null);      // per slot: why it was given up, once it was
  let stopped = false;

  const argvFor = () => {
    const out = [];
    for (let i = 0; i < argv.length; i++) {
      if (argv[i] === "--role") { i++; continue; }
      out.push(argv[i]);
    }
    return [...out, "--role", "read"];
  };

  function spawn(slot) {
    const w = new Worker(entry, {
      argv: argvFor(),
      env: { ...env, OFFICE_ROLE: "read" },
      workerData: { readWorker: true, slot },
    });
    const rec = { w, ready: false, inflight: new Set(), slot, served: 0, called: 0, cause: null };
    workers[slot] = rec;
    w.on("message", (msg) => {
      if (msg?.type === "ready") { rec.ready = true; bootFailures[slot] = 0; return; }
      if (msg?.type !== "answer") return;
      const c = calls.get(msg.id);
      if (c) { // POS-1219: a call's answer, or null for the caller to read itself
        calls.delete(msg.id);
        rec.inflight.delete(msg.id);
        rec.called++;
        c.resolve(msg.failed != null ? null : msg.value ?? null);
        return;
      }
      const p = pending.get(msg.id);
      rec.inflight.delete(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      rec.served++;
      if (p.tm) { p.tm.answer = msg.timing ?? null; p.tm.answer_at = nowMs(); } // POS-1064/b: the worker's report, and when this thread received it
      write(p.res, msg, slot);
    });
    // Kept for the exit's one line: an `error` is always followed by an `exit`.
    w.on("error", (e) => { rec.cause = String(e?.message ?? e).slice(0, 200); });
    w.on("exit", (code) => {
      const wasReady = rec.ready;
      rec.ready = false;
      if (workers[slot] === rec) workers[slot] = null;
      // What it was holding goes to another worker once, or is refused plainly.
      // A call it was holding is answered null, and its caller reads it itself (POS-1219).
      for (const id of rec.inflight) {
        const c = calls.get(id);
        if (c) { calls.delete(id); c.resolve(null); continue; }
        const p = pending.get(id);
        if (!p) continue;
        pending.delete(id);
        if (p.tries < 1 && dispatch(p.res, p.msg, p.tries + 1, p.tm)) continue;
        refuse(p.res);
      }
      rec.inflight.clear();
      if (stopped) return;
      const why = rec.cause ?? `exit code ${code}`;
      if (!wasReady) bootFailures[slot]++;
      if (bootFailures[slot] >= 3) {
        down[slot] = why;
        const left = down.filter((d) => d == null).length;
        log.error(`[read-workers] worker ${slot} could not start, three times running (${why}) — it is given up and the main thread answers its reads`
          + (left ? `; ${left} other slot${left === 1 ? " is" : "s are"} still in the pool` : "; no worker is left, the main thread answers every read"));
        if (!left) { stopped = true; broadcast = null; caller = null; }
        return;
      }
      log.error(`[read-workers] worker ${slot} ${wasReady ? "stopped" : "could not start"} (${why}); respawning`);
      setTimeout(() => { if (!stopped) spawn(slot); }, respawnMs).unref();
    });
  }

  function write(res, msg, slot) {
    if (res.writableEnded || res.destroyed) return;
    const headers = {};
    for (const [k, v] of msg.headers ?? []) headers[k] = v;
    // Which thread answered, the way DEC-4's X-PM-Upstream named the process.
    headers["X-PM-Reader"] = `worker-${slot}`;
    res.writeHead(msg.status, msg.statusMessage || undefined, headers);
    res.end(Buffer.from(msg.body ?? new ArrayBuffer(0)));
  }

  function refuse(res) {
    if (res.writableEnded || res.destroyed) return;
    res.writeHead(503, { "Content-Type": "application/json", "Retry-After": "1" });
    res.end(JSON.stringify({ error: "the reader stopped", code: 503,
      defect: "the read worker holding this request stopped before it answered",
      hint: "ask again; a read is safe to repeat and another worker will take it",
      refused: true })); // POS-427: every refusal says so, and this one never passes through server.mjs § j
  }

  function pick() {
    let best = null;
    for (const r of workers) if (r?.ready && (!best || r.inflight.size < best.inflight.size)) best = r;
    return best;
  }

  function dispatch(res, msg, tries = 0, tm = currentTiming()) {
    const r = pick();
    if (!r) return false;
    const id = nextId++;
    const m = { ...msg, id };
    pending.set(id, { res, msg, tries, tm });
    r.inflight.add(id);
    // POS-1064/b: which worker and when this thread posted the read (the first post stays `first_sent` across a retry); the rid rides to the worker to join the two records
    if (tm) { const sent = nowMs(); tm.hand = { first_sent: tm.hand?.first_sent ?? sent, sent, slot: r.slot, tries: tries + 1 }; m.timing = { rid: tm.rid }; }
    r.w.postMessage(m);
    return true;
  }

  broadcast = (kind, payload) => {
    for (const r of workers) if (r) r.w.postMessage({ type: "announce", kind, payload });
  };

  // POS-1219: a call rides the same port as the announcements, so a worker answers it after every write announced before it.
  // Null, never a refusal, when there is no worker to ask or the payload cannot be cloned: the caller reads it itself.
  caller = (name, payload) => new Promise((resolve) => {
    if (stopped) return resolve(null);
    const r = pick();
    if (!r) return resolve(null);
    const id = nextId++;
    calls.set(id, { resolve });
    r.inflight.add(id);
    try { r.w.postMessage({ type: "call", id, name, payload }); }
    catch { calls.delete(id); r.inflight.delete(id); resolve(null); }
  });

  for (let i = 0; i < size; i++) spawn(i);

  return {
    size,
    /**
     * Hand a read to a worker. False when none is ready: the caller answers it
     * itself. `body` and `mcp` are an agent's MCP read (POS-284): the body the
     * main thread already read, and the flag that lets the worker's POST /mcp
     * past the read role's refusal for this call alone.
     */
    forward(req, res, { body = null, mcp = false, earshot = null, worldWrites = null } = {}) {
      if (stopped) return false;
      return dispatch(res, {
        type: "read",
        method: req.method,
        url: req.url,
        headers: req.headers,
        ip: req.socket?.remoteAddress ?? null,
        ...(mcp ? { body, mcp: true } : {}),
        ...(earshot ? { earshot } : {}),
        ...(worldWrites ? { worldWrites } : {}),
      });
    },
    /** What the pool is, for /release: how many workers are up and what each has served. */
    disclose() {
      return {
        size,
        stopped,
        ready: workers.filter((r) => r?.ready).length,
        served: workers.map((r) => r?.served ?? 0),
        in_flight: workers.map((r) => r?.inflight.size ?? 0),
        // Per slot: null while it serves or is respawning, else why it was given up.
        down: [...down],
      };
    },
    /** POS-1219: the calls each worker answered, by slot (not in `disclose`, which /release publishes). */
    called() { return workers.map((r) => r?.called ?? 0); },
    /** The workers' thread ids, for the kill falsifier. */
    threads() { return workers.map((r) => (r?.ready ? r.w.threadId : null)); },
    kill(slot) { return workers[slot]?.w.terminate(); },
    async close() {
      stopped = true;
      broadcast = null;
      caller = null;
      for (const c of calls.values()) c.resolve(null);
      calls.clear();
      await Promise.all(workers.map((r) => r?.w.terminate()));
    },
  };
}
