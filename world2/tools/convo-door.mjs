// convo-door.mjs — `GET /world/conversations`, READ FROM THE DURABLE RECORD (POS-779).
//
// The door the conversations page and the World map poll. Where the world store is engaged the office answers it
// from `acts` through the bounded pieces that sit beside this file, instead of from the newest 2,000 voices in RAM:
//
//   convo-edges.mjs   the published sweeps this office has read: where a thread splits (never a heartbeat)
//   convo-read.mjs    one epoch's public voices, read on a snapshot the caller holds, measured before bodies
//   convo-components  the exact connected components (the producer's `chains` rule), counted work, a fuse
//   convo-memo.mjs    the last view of a few epochs, served only under an equal fingerprint
//   convo-pager.mjs   the threads, their generations and the pages back through a thread
//
// THREE REQUESTS, one URL, every parameter validated and bounded:
//
//   (none)                       the page: `live` (the newest settlement's threads) and `closed` (the earlier
//                                settlements', newest first), each a bounded first page, with `next_threads`
//   next_threads=<cursor>        the next threads of a list that was cut, on to older settlements
//   thread_of=&before=&generation=&since=&next=[&limit=]
//                                SHOW EARLIER: the lines of one thread strictly before a cursor
//   voices=<0..200>              how many lines a thread summary carries (default 80; 0 = the lean summary the
//                                World map uses: threads without their lines)
//
// WHAT IT NEVER DOES. It never answers from a partial read as if it were whole: an epoch over a budget, a read
// that times out, edges that moved under it or a read that failed is `unavailable`, with one generic reason and no
// counts, never a short list. It never invents a settlement: before the oldest sweep this office has read, an
// epoch's start is unknown, and `list.history_from` says where the grouping begins. No private row reaches it (the
// eligibility is the read's), and no wrong, private or missing anchor is told apart from another.

import { publishedEdges, epochsOf } from "./convo-edges.mjs";
import {
  loadEpochView, threadList, earlierPage, ensureByAct, parseEarlierRequest, parseListRequest, PAGE,
} from "./convo-pager.mjs";
import { createEpochMemo } from "./convo-memo.mjs";
import { openSnapshot, closeSnapshot, BUDGETS } from "./convo-read.mjs";

/**
 * The door's own bounds, with their reasons. Engineering bounds, not law.
 *   liveLimit     live threads in a first page: PAGE.defaultListLimit, the keyset continues past it
 *   closedMax     the 40 newest closed threads the page has always been given; `closed` may be asked for up to 100
 *   voiceBudget   lines in one list page (per section): the old RAM ceiling was 2,000 voices in all, so a page
 *                 never carries more lines than the whole RAM-era answer could. A thread the budget leaves out is
 *                 reachable through the cursor.
 *   closedEpochs  settlements read for one closed page: the memo keeps four epochs, the live one and these three
 */
export const DOOR = Object.freeze({
  liveLimit: PAGE.defaultListLimit,
  closedMax: 40,
  closedMaxAsked: 100,
  voiceBudget: 2000,
  closedEpochs: 3,
});

/** The start of an older epoch as a cursor: nothing in it is before the cursor (a stamp no view has). */
const NO_VIEW = "0000000000000000";
const startCursor = (epoch) => `${epoch.next}:1:${NO_VIEW}`;

const bounce = (code, defect, hint) => ({ code, body: { error: "bounce", defect, hint } });
const bad = (what) => bounce(422, `bad ${what}`, `the ${what} parameter is not in the form this door takes`);
// ONE generic posture for a thread, anchor or cursor that is wrong, private, missing or from another view
const NOT_AVAILABLE = () => bounce(404, "that conversation is not available", "it may have ended, moved to another settlement or never been public; read the list again");
const UNAVAILABLE = (reason) => bounce(503, "the conversations cannot be read just now", `try again shortly (${reason})`);

const SAFE_REASON = { "settlements-unknown": "settlements-unknown", "over-budget": "too-large", timeout: "timeout", "edges-moved": "settlement-moved", "unreadable-acts": "unreadable", "unsupported-geometry": "unreadable" };

class Unavailable extends Error { constructor(reason) { super(reason); this.reason = SAFE_REASON[reason] ?? "unreadable"; this.moved = reason === "edges-moved"; } }

const get = (params, k) => (typeof params?.get === "function" ? params.get(k) : params?.[k]);
/** A small non-negative integer parameter within [lo, hi], else the default when absent. */
function intParam(params, k, dflt, lo, hi) {
  const raw = get(params, k);
  if (raw == null || raw === "") return { ok: true, value: dflt };
  if (typeof raw !== "string" && typeof raw !== "number") return { ok: false };
  if (!/^[0-9]{1,4}$/.test(String(raw))) return { ok: false };
  const n = Number(raw);
  return n >= lo && n <= hi ? { ok: true, value: n } : { ok: false };
}

const epochAt = (epochs, ms) => epochs.findIndex((e) => e.since <= ms && (e.next === null || ms < e.next));

/**
 * The door. Everything it reads comes in through the arguments, so a test can stand each one.
 *   pool          the serve pool (`connect()`): ONE client per REQUEST, in ONE read-only repeatable snapshot, held
 *                 until the request is answered; the live epoch and every closed epoch the request reads come from it
 *   isPrivate     the REAL `spokenInRoom` (row => boolean)
 *   settlements   () => ms[]            the published sweeps the reader keeps
 *   hearingWindow (ms) => { since }     the window open at ms
 *   now           () => ms
 *   memo          an epoch memo (defaults to the bounded one)
 *   budgets       readEpoch's budget overrides
 *   fuse/sliceMs  the component builder's (tests)
 */
export function createConversationsDoor({ pool, isPrivate, settlements, hearingWindow, now = () => Date.now(), memo = createEpochMemo(), budgets = {}, fuse, sliceMs } = {}) {
  if (!pool || typeof isPrivate !== "function") throw new TypeError("the conversations door needs the pool and the real spokenInRoom guard");
  // Builds shared by requests that arrive together, keyed by the FINGERPRINT each request's own snapshot read (the
  // source's identity), never by the epoch's name: a request whose snapshot saw other rows has another key and builds
  // its own (convo-pager.mjs § loadEpochView).
  const inflight = new Map();

  // ONE snapshot per REQUEST. The first epoch the request needs opens it; every other epoch of the request is read on
  // the same client in the same transaction, so the live epoch, up to three closed ones, their rows, anchors and dials
  // are one picture. It is ended in `attempt`'s finally, on every path. A request that retries (the edges moved)
  // makes a second attempt that opens its own snapshot; an answer is only ever made from one attempt.
  const snapshotOf = (ctx) => (ctx.snap ??= openSnapshot(pool, { statementTimeoutMs: { ...BUDGETS, ...budgets }.statementTimeoutMs }));

  const viewOf = (epoch, ctx) => {
    const id = `${epoch.since}:${epoch.next ?? "open"}|${ctx.edges.version}`;
    // one request reads an epoch once, however many sections ask for it
    if (ctx.views.has(id)) return ctx.views.get(id);
    // and its reads are one after another: a client runs one statement at a time, and the cursors are named
    const asked = (ctx.chain = ctx.chain.catch(() => {}).then(() => load(epoch, ctx)));
    ctx.views.set(id, asked);
    return asked;
  };
  const load = async (epoch, ctx) => {
    const { client } = await snapshotOf(ctx);
    // THE FENCE. The epochs of this request were drawn from `ctx.edges`; the read asks for the edges' version
    // twice, before its read (it must be the very edges the epoch came from) and after it (read afresh). A sweep
    // published in between answers `edges-moved`, and the request is made once more on the new edges.
    let asked = 0;
    const out = await loadEpochView(pool, {
      epoch, isPrivate, memo, budgets, fuse, sliceMs, client, inflight,
      edgesOf: () => (asked++ === 0 ? ctx.edges : publishedEdges({ settlements, hearingWindow, ms: ctx.ms })),
    });
    if (out.status !== "ok") throw new Unavailable(out.reason);
    return out;
  };

  /** Threads newest first across `epochs[startIdx..]`, from `after`, within a thread count, a line budget and an epoch count. */
  async function stream(ctx, epochs, startIdx, after, { limit, voiceCap, voiceBudget, maxEpochs }) {
    const threads = [];
    let next = null, spent = 0, visited = 0, idx = startIdx, cursor = after;
    while (idx < epochs.length && threads.length < limit) {
      const e = epochs[idx];
      if (visited >= maxEpochs) { next = startCursor(e); break; }
      const { view } = await viewOf(e, ctx);
      visited += 1;
      const tl = threadList(view, { limit: limit - threads.length, after: cursor }, { live: e.next === null, voiceCap, voiceBudget: voiceBudget - spent });
      if (tl.status === "regenerated") return { regenerated: tl.reason, threads: [], next_threads: null, view };
      for (const t of tl.threads) { threads.push(t); spent += t.voices.length; }
      if (tl.next_threads) { next = tl.next_threads; break; }
      idx += 1; cursor = null;
      if (idx < epochs.length && threads.length >= limit) { next = startCursor(epochs[idx]); break; }
    }
    return { threads, next_threads: next, view: null };
  }

  async function attempt(searchParams) {
    const ctx = { ms: now(), edges: null, views: new Map(), snap: null, chain: Promise.resolve() };
    try { return await answer(searchParams, ctx); }
    finally { if (ctx.snap) await closeSnapshot(await ctx.snap.catch(() => null)); }
  }

  async function answer(searchParams, ctx) {
    const { ms } = ctx;
    const edges = publishedEdges({ settlements, hearingWindow, ms });
    if (!edges.list.length) throw new Unavailable("settlements-unknown");
    const epochs = epochsOf(edges.list);
    ctx.edges = edges;
    const historyFrom = new Date(edges.list[0]).toISOString();

    // ── SHOW EARLIER ─────────────────────────────────────────────────────────
    if (get(searchParams, "thread_of") != null) {
      const req = parseEarlierRequest(searchParams);
      if (!req.ok) return bad(req.reason.replace(/^bad /, ""));
      // the epoch is named by its start; its end is whatever the edges say now, and a moved end changes the generation
      const idx = epochs.findIndex((e) => e.since === req.value.epoch.since);
      if (idx < 0) return NOT_AVAILABLE();
      const { view } = await viewOf(epochs[idx], ctx);
      await ensureByAct(view, { ...(sliceMs ? { sliceMs } : {}) }); // the act-id index, a slice at a time, once per view
      const r = earlierPage(view, req.value, { voiceCap: PAGE.defaultVoiceCap });
      if (r.status === "unavailable") return NOT_AVAILABLE();
      if (r.status === "regenerated") return { code: 200, body: { now: new Date(ms).toISOString(), regenerated: true, thread: r.thread } };
      return { code: 200, body: { now: new Date(ms).toISOString(), epoch: { since: epochs[idx].since, next: epochs[idx].next },
        thread_of: req.value.thread_of, generation: req.value.generation, voices: r.voices, earlier: r.earlier } };
    }

    const voicesP = intParam(searchParams, "voices", PAGE.defaultVoiceCap, 0, PAGE.maxLimit);
    if (!voicesP.ok) return bad("voices");
    const voiceCap = voicesP.value;

    // ── THE NEXT THREADS OF A CUT LIST ───────────────────────────────────────
    if (get(searchParams, "next_threads") != null && get(searchParams, "next_threads") !== "") {
      const req = parseListRequest(searchParams);
      if (!req.ok) return bad("next_threads");
      const { after } = req.value;
      const sentinel = after.view === NO_VIEW;
      const idx = epochAt(epochs, sentinel ? after.latest_ms - 1 : after.latest_ms);
      if (idx < 0) return NOT_AVAILABLE();
      // a cursor into the LIVE epoch continues the live list only; one into an earlier settlement continues the closed
      // list, on through still older settlements. The two lists are the page's two sections, each with its own cursor.
      const out = await stream(ctx, idx === 0 ? epochs.slice(0, 1) : epochs, idx, sentinel ? null : after, { limit: req.value.limit, voiceCap, voiceBudget: DOOR.voiceBudget, maxEpochs: DOOR.closedEpochs });
      if (out.regenerated) return { code: 200, body: { now: new Date(ms).toISOString(), regenerated: true, reason: out.regenerated, threads: [], next_threads: null } };
      return { code: 200, body: { now: new Date(ms).toISOString(), threads: out.threads, next_threads: out.next_threads,
        list: { complete: out.next_threads === null, returned: out.threads.length, history_from: historyFrom } } };
    }

    // ── THE PAGE ─────────────────────────────────────────────────────────────
    const closedP = intParam(searchParams, "closed", DOOR.closedMax, 1, DOOR.closedMaxAsked);
    if (!closedP.ok) return bad("closed");
    const limitP = parseListRequest(searchParams);
    if (!limitP.ok) return bad("limit");
    const liveLimit = limitP.value.limit; // PAGE.defaultListLimit (= DOOR.liveLimit) unless asked, at most PAGE.maxListLimit

    const liveOut = await stream(ctx, epochs.slice(0, 1), 0, null, { limit: liveLimit, voiceCap, voiceBudget: DOOR.voiceBudget, maxEpochs: 1 });
    const closedOut = epochs.length > 1
      ? await stream(ctx, epochs, 1, null, { limit: closedP.value, voiceCap, voiceBudget: DOOR.voiceBudget, maxEpochs: DOOR.closedEpochs })
      : { threads: [], next_threads: null };
    const liveView = (await viewOf(epochs[0], ctx)).view; // the same read the live section used (per-request cache)
    const fadeMinutes = Number(liveView.dials?.fade_min?.value);
    const olderLeft = closedOut.next_threads !== null;
    return { code: 200, body: {
      now: new Date(ms).toISOString(),
      earshot_m: liveView.earshotM,
      fade_minutes: Number.isFinite(fadeMinutes) ? fadeMinutes : null,
      hearable_since: new Date(edges.list[edges.list.length - 1]).toISOString(),
      close_minutes: null,
      live: liveOut.threads,
      closed: closedOut.threads,
      next_threads: { live: liveOut.next_threads, closed: closedOut.next_threads },
      list: {
        complete: liveOut.next_threads === null && !olderLeft,
        live: { threads: liveView.threads.length, returned: liveOut.threads.length },
        closed: { returned: closedOut.threads.length, more: olderLeft },
        history_from: historyFrom,
      },
    } };
  }

  return {
    memo,
    /** Answer a request: `{ code, body }`, never throwing for a request the store cannot serve. */
    async handle(searchParams) {
      for (let tries = 0; tries < 2; tries++) {
        try { return await attempt(searchParams); }
        catch (e) {
          if (e instanceof Unavailable) {
            if (e.moved && tries === 0) continue; // a sweep was published under the read: once more, on the new edges
            return UNAVAILABLE(e.reason);
          }
          console.error(`[convo-door] a conversations read failed (${String(e?.message ?? e).slice(0, 120)})`);
          return UNAVAILABLE("unreadable");
        }
      }
      return UNAVAILABLE("settlement-moved");
    },
  };
}
