// convo-pager.mjs — A SETTLEMENT'S THREADS, AND THE PAGES BACK THROUGH ONE (POS-779).
//
// STATUS: UNWIRED (see convo-read.mjs). Pure over a view except `loadEpochView`, which composes the read, the
// exact component builder and the memo.
//
// THE VIEW. One settlement's public voices (convo-read.mjs), their exact connected components (convo-components.mjs,
// held to the vendored fold by its own test), and per thread: its members, its latest instant, and a GENERATION.
// A generation is a digest of everything a membership depends on: the epoch, the edges version, the earshot, the
// eligibility/decoder version and every member's (act id, instant, composed point, deck flag). It is not
// count-plus-first: a late bridge, a moved anchor or a changed edge changes it, and a count never would.
//
// IDENTITY. A thread's `id` stays the compatibility id `t<first.at>-<handle>` and is NOT identity: regrouping
// changes it. What a client holds is `thread_of`, the act id of any admitted member, and the generation it was
// shown. The earlier request resolves `thread_of` to its CURRENT component. A wrong, private or nonexistent
// anchor all answer the one generic `unavailable`: the answer never says which.
//
// PAGING. Voices are ordered by (logical ms, act id numerically). "Earlier" is strictly before a cursor
// `<at_ms>:<act_id>` in that order, so equal-millisecond voices and ids past 2^53 cannot be lost or repeated at
// a page seam. A cursor carries no room, no handle and no right: it is two numbers.
//
// A GENERATION MISMATCH IS NOT AN ERROR AND NOT A SILENT RESET. The answer is `regenerated` with the thread's
// newest page, so the client can drop the lines it accumulated under the old generation.
//
// LISTS. A settlement with many places has many threads. `threadList` pages them by a keyset
// (latest instant, first act id) bound to the view's fingerprint, so every summary is reachable exactly once
// from one view and a changed view says so instead of skipping or repeating.

import { createHash } from "node:crypto";
import { componentsOf, OverBudget, UnsupportedGeometry } from "./convo-components.mjs";
import { threadOf } from "./conversations.mjs";
import { standingOf } from "../../src/speaker-standing.mjs";
import { readEpoch, compareVoices, compareIds, ELIGIBILITY_VERSION } from "./convo-read.mjs";

export const PAGE = Object.freeze({ defaultLimit: 80, maxLimit: 200, defaultVoiceCap: 80, defaultListLimit: 40, maxListLimit: 100 });
/**
 * The memo's charge for one retained view is an ACCOUNTED ESTIMATE of the decoded material the view keeps
 * (below), in bytes. It is not exact JS heap or RSS and no guarantee of either: V8's real layout varies by
 * version, string representation (one-byte, two-byte, sliced, cons) and sharing.
 */
export const VIEW_COST = Object.freeze({
  base: 4096,        // the envelope: epoch, dials, source counts, key, stats, eras
  string: 16,        // per string: header
  charBytes: 2,      // per UTF-16 unit: assume two-byte storage (one-byte strings are half; this errs high)
  voice: 192,        // per retained voice object: header + eight fields + two boxed numbers + array slot
  thread: 256,       // per thread object, its Int32Array header, its `order` slot
  member: 4,         // per Int32Array member
  byActEntry: 96,    // per Map entry (act id -> thread): hash bucket + entry, key string shared with its voice
  unplaced: 128,     // per unplaced record, plus its strings
});

const sha = (parts) => createHash("sha256").update(parts.join("|")).digest("hex");

export const cursorOf = (v) => `${v.at}:${v.act_id}`;
const idOk = (s) => /^[1-9][0-9]{0,18}$/.test(s);
const MAX_MS = 8.64e15;

// ═════════════════════════════════════════════════════════════════════
// the view
// ═════════════════════════════════════════════════════════════════════

/**
 * What a retained VIEW (the result of buildView) costs, as the memo counts it: an accounted estimate of the
 * decoded material it retains, from the view's own contents, not the bytes read from the store (which are
 * compressed or JSON-encoded, a different thing). Charged: every voice object and each of its strings at two
 * bytes per UTF-16 unit, every thread with its member array, the act-id index, the unplaced list and the anchor
 * names. Not charged: the transient source rows (dropped after the build), V8 over-allocation, string sharing
 * (never assumed), and other threads' memory. A shape it cannot charge (no voices array, or no threads) answers
 * Infinity, which the memo refuses: a view is never admitted on an undercount.
 */
export function viewBytes(view) {
  const C = VIEW_COST;
  if (!Array.isArray(view?.voices) || !Array.isArray(view?.threads)) return Infinity;
  const str = (s) => (s == null ? 0 : C.string + C.charBytes * String(s).length);
  let n = C.base;
  for (const v of view.voices) n += C.voice + str(v.handle) + str(v.text) + str(v.place) + str(v.act_id) + str(v.era);
  for (const t of view.threads) n += C.thread + C.member * (t.members?.length ?? 0) + str(t.first_act_id) + str(t.generation);
  n += C.byActEntry * (view.byAct?.size ?? 0);
  for (const u of view.unplaced ?? []) n += C.unplaced + str(u.act_id) + str(u.anchor);
  for (const a of view.anchors ?? []) n += str(a);
  return n;
}

/**
 * The view of a read epoch: its exact components, a generation per thread, and the indexes a request needs.
 * Throws OverBudget / UnsupportedGeometry from the component builder; the caller answers "unavailable".
 */
export async function buildView(source, { fuse, sliceMs } = {}) {
  const V = source.voices;
  const { components, stats } = await componentsOf(V, { earshotM: source.earshotM, ...(fuse ? { fuse } : {}), ...(sliceMs ? { sliceMs } : {}) });
  const head = [ELIGIBILITY_VERSION, source.epoch.since, source.epoch.next ?? "open", source.edges_version ?? "", source.earshotM].join("|");
  const byAct = new Map();
  const threads = components.map((idx, i) => {
    const members = Int32Array.from(idx);
    const h = createHash("sha256").update(head);
    for (const k of members) {
      const v = V[k];
      h.update(`;${v.act_id}:${v.at}:${v.x}:${v.y}:${v.aboard ? 1 : 0}`);
      byAct.set(v.act_id, i);
    }
    const first = V[members[0]], last = V[members[members.length - 1]];
    return { members, first_act_id: first.act_id, first_ms: first.at, latest_ms: last.at, count: members.length, generation: h.digest("hex").slice(0, 32) };
  });
  // newest first; a tie on the instant is broken by the first act id, so the order is total
  const order = threads.map((_, i) => i).sort((a, b) => (threads[b].latest_ms - threads[a].latest_ms) || compareIds(threads[b].first_act_id, threads[a].first_act_id));
  return { epoch: source.epoch, edges_version: source.edges_version ?? "", earshotM: source.earshotM, dials: source.dials ?? null, key: source.key,
    voices: V, threads, order, byAct, stats, eras: source.eras, unplaced: source.unplaced,
    non_sound_emissions: source.non_sound_emissions, source: source.source, anchors: source.anchors };
}

/** One voice as the page renders it (threadOf's own shape plus the exact id). */
export function voiceOut(v) {
  return {
    handle: v.handle, standing: standingOf(v.handle), said: v.text,
    at: new Date(v.at).toISOString(), at_ms: v.at, x: Math.round(v.x), y: Math.round(v.y),
    act_id: v.act_id,
  };
}

/** A thread's summary: the vendored `threadOf` plus the pager's fields. `voices` is the newest `voiceCap`. */
export function threadSummary(view, t, { live = true, voiceCap = PAGE.defaultVoiceCap } = {}) {
  const members = Array.from(t.members, (i) => view.voices[i]);
  // voiceCap 0 is the LEAN summary: the thread without its lines. (`slice(-0)` is the whole array, so it is
  // asked for one line and the lines are dropped.) A lean thread carries no `earlier` at all: it has shown
  // nothing, so it cannot say where the lines it did not show begin.
  const lean = !(voiceCap > 0);
  const base = threadOf({ voices: members }, { live, voiceCap: lean ? 1 : voiceCap });
  const shown = lean ? [] : members.slice(-voiceCap);
  return {
    ...base,
    voices: lean ? [] : base.voices.map((bv, i) => ({ ...bv, act_id: shown[i].act_id })),
    epoch: { since: view.epoch.since, next: view.epoch.next },
    thread_of: t.first_act_id,
    generation: t.generation,
    ...(lean ? {} : { earlier: members.length > shown.length ? cursorOf(shown[0]) : null }),
  };
}

// ═════════════════════════════════════════════════════════════════════
// requests
// ═════════════════════════════════════════════════════════════════════

const get = (params, k) => (typeof params?.get === "function" ? params.get(k) : params?.[k]);
const bad = (what) => ({ ok: false, reason: `bad ${what}` });

function parseCursor(raw) {
  if (typeof raw !== "string" || raw.length > 40) return null;
  const m = /^(\d{1,16}):([1-9][0-9]{0,18})$/.exec(raw);
  if (!m) return null;
  const at_ms = Number(m[1]);
  if (!Number.isSafeInteger(at_ms) || at_ms > MAX_MS) return null;
  return { at_ms, act_id: m[2] };
}

/** The earlier request, validated: bounded types, lengths and ranges. `{ ok: true, value }` or `{ ok: false, reason }`. */
export function parseEarlierRequest(params) {
  const thread_of = get(params, "thread_of");
  if (typeof thread_of !== "string" || !idOk(thread_of)) return bad("thread_of");
  const before = parseCursor(get(params, "before"));
  if (!before) return bad("before");
  const generation = get(params, "generation");
  if (typeof generation !== "string" || !/^[0-9a-f]{32}$/.test(generation)) return bad("generation");
  let limit = PAGE.defaultLimit;
  const rawLimit = get(params, "limit");
  if (rawLimit != null && rawLimit !== "") {
    if (typeof rawLimit !== "string" && typeof rawLimit !== "number") return bad("limit");
    if (!/^[0-9]{1,3}$/.test(String(rawLimit))) return bad("limit");
    limit = Number(rawLimit);
    if (limit < 1 || limit > PAGE.maxLimit) return bad("limit");
  }
  const since = get(params, "since"), next = get(params, "next");
  if (typeof since !== "string" || !/^[0-9]{1,16}$/.test(since) || Number(since) > MAX_MS) return bad("since");
  if (next !== "open" && (typeof next !== "string" || !/^[0-9]{1,16}$/.test(next) || Number(next) > MAX_MS || Number(next) <= Number(since))) return bad("next");
  return { ok: true, value: { thread_of, before, generation, limit, epoch: { since: Number(since), next: next === "open" ? null : Number(next) } } };
}

/** The list request, validated. `after` is `<latest_ms>:<first_act_id>:<view key prefix>`. */
export function parseListRequest(params) {
  let limit = PAGE.defaultListLimit;
  const rawLimit = get(params, "limit");
  if (rawLimit != null && rawLimit !== "") {
    if (!/^[0-9]{1,3}$/.test(String(rawLimit))) return bad("limit");
    limit = Number(rawLimit);
    if (limit < 1 || limit > PAGE.maxListLimit) return bad("limit");
  }
  let after = null;
  const rawAfter = get(params, "next_threads");
  if (rawAfter != null && rawAfter !== "") {
    const m = typeof rawAfter === "string" && rawAfter.length <= 80 ? /^(\d{1,16}):([1-9][0-9]{0,18}):([0-9a-f]{16})$/.exec(rawAfter) : null;
    if (!m || Number(m[1]) > MAX_MS) return bad("next_threads");
    after = { latest_ms: Number(m[1]), first_act_id: m[2], view: m[3] };
  }
  return { ok: true, value: { limit, after } };
}

const UNAVAILABLE = Object.freeze({ status: "unavailable" });

/**
 * Voices of one thread strictly before a cursor, newest `limit` of them in (at, id) order.
 * `req` is a parsed earlier request. Answers:
 *   { status: "ok", voices, earlier }          earlier = cursor of the first voice returned, or null at the thread's start
 *   { status: "regenerated", thread }          the generation moved: the thread, newest page, current generation
 *   { status: "unavailable" }                  the anchor is not an admitted member of this epoch (one posture for every reason)
 */
export function earlierPage(view, req, { voiceCap = PAGE.defaultVoiceCap } = {}) {
  const ti = view.byAct.get(req.thread_of);
  if (ti === undefined) return UNAVAILABLE;
  const t = view.threads[ti];
  if (req.generation !== t.generation) return { status: "regenerated", thread: threadSummary(view, t, { live: view.epoch.next === null, voiceCap }) };
  // the first member at or after the cursor: everything before it is "earlier"
  let lo = 0, hi = t.members.length;
  const cmp = (v) => (v.at - req.before.at_ms) || compareIds(v.act_id, req.before.act_id);
  while (lo < hi) { const mid = (lo + hi) >> 1; if (cmp(view.voices[t.members[mid]]) < 0) lo = mid + 1; else hi = mid; }
  const from = Math.max(0, lo - req.limit);
  const page = Array.from(t.members.subarray(from, lo), (i) => view.voices[i]);
  return { status: "ok", voices: page.map(voiceOut), earlier: from > 0 ? cursorOf(page[0]) : null };
}

/**
 * A page of the epoch's thread summaries, newest first, by a keyset bound to the view.
 *   { status: "ok", threads, next_threads, list: { epoch_threads, returned, complete } }
 *   { status: "regenerated", ... }   the cursor was made from another view: start again from the first page
 * `list.epoch_threads` counts this epoch's threads in this view (exact for the view, not a global total).
 */
export function threadList(view, req, { live = view.epoch.next === null, voiceCap = PAGE.defaultVoiceCap, voiceBudget = Infinity } = {}) {
  const stamp = view.key.slice(0, 16);
  let start = 0;
  if (req.after) {
    if (req.after.view !== stamp) return { status: "regenerated", reason: "the view changed since this page was cut; start again from the first page", list: { epoch_threads: view.threads.length } };
    // first thread strictly after the cursor in the view's order
    const past = (t) => (t.latest_ms < req.after.latest_ms) || (t.latest_ms === req.after.latest_ms && compareIds(t.first_act_id, req.after.first_act_id) < 0);
    let lo = 0, hi = view.order.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (past(view.threads[view.order[mid]])) hi = mid; else lo = mid + 1; }
    start = lo;
  }
  // the page holds at most `req.limit` threads AND at most `voiceBudget` lines (the first thread always comes, so a
  // page is never empty): a thread the budget leaves out is not hidden, the cursor goes on from the last one shown
  let slice = view.order.slice(start, start + req.limit);
  if (Number.isFinite(voiceBudget)) {
    let spent = 0, keep = 0;
    for (const i of slice) {
      const lines = voiceCap > 0 ? Math.min(voiceCap, view.threads[i].count) : 0;
      if (keep > 0 && spent + lines > voiceBudget) break;
      spent += lines; keep += 1;
    }
    slice = slice.slice(0, keep);
  }
  const threads = slice.map((i) => threadSummary(view, view.threads[i], { live, voiceCap }));
  const more = start + slice.length < view.order.length;
  const last = slice.length ? view.threads[slice[slice.length - 1]] : null;
  return { status: "ok", threads,
    next_threads: more && last ? `${last.latest_ms}:${last.first_act_id}:${stamp}` : null,
    list: { epoch_threads: view.threads.length, returned: threads.length, complete: !more && start === 0 } };
}

// ═════════════════════════════════════════════════════════════════════
// read + build + memo
// ═════════════════════════════════════════════════════════════════════

/**
 * The view of one epoch: from the memo when the fingerprint read in this snapshot equals the stored one,
 * else read, build and keep. `unavailable` is passed through whole; a build that overruns its work fuse
 * is `unavailable`, never a partial partition.
 */
export async function loadEpochView(pool, { epoch, isPrivate, edgesOf = null, memo = null, budgets = {}, fuse, sliceMs } = {}) {
  const src = await readEpoch(pool, { epoch, isPrivate, edgesOf, memo, budgets });
  if (src.status !== "ok") return src;
  if (src.from === "memo") return { status: "ok", from: "memo", view: src.value };
  let view;
  try { view = await buildView(src, { fuse, sliceMs }); }
  catch (e) {
    if (e instanceof OverBudget) return { status: "unavailable", reason: "over-budget", what: "component work", ...e.detail };
    if (e instanceof UnsupportedGeometry) return { status: "unavailable", reason: "unsupported-geometry" };
    return { status: "unavailable", reason: "build-failed" };
  }
  memo?.set(`${src.epoch.since}:${src.epoch.next ?? "open"}`, { key: src.key, bytes: viewBytes(view), anchors: src.anchors, value: view });
  return { status: "ok", from: "store", view };
}
