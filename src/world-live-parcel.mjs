// world-live-parcel.mjs — own-parcel content and dependency-free withdrawals, live for every viewer (POS-686).
//
// WHAT THIS IS. Between two settlements canon (the blessed world-state.json, and every cache keyed on its sha, a digest or a
// snapshot) is the world. An amendment to the authored content of a mark its author already published, and a withdrawal of a
// published mark nothing depends on, are written to the store at once (a pending `claims` row and an `acts` row, or an `acts`
// row alone: a published withdrawal files no claim) but reach canon only at the crossing. This module lays those two facts over
// canon at the point where a reader SERVES a mark's body or its existence, for every viewer:
//
//     canon (immutable, shared, never touched)  +  the edits the store holds that canon has not carried yet  =  what is served
//
// WHAT IT TOUCHES, AND WHAT IT NEVER DOES.
//   · Only marks standing on their author's household's OWN PARCEL (Darko, 2026-11-18: "your own parcel only; common-ground market
//     marks stay settled, because others may have staked on them or welcomed them"). The ground fact is canon's own `tier`: the
//     standing walk's answer, recomputed at every settlement, which is `home` exactly when the mark stands on its household's parcel
//     (or continues a mark that does): world2/tools/standing.mjs, the same walk `groundMinimumStake` asks (`world.mjs`). Measured on
//     the pinned world (S179, 3,005 marks): every `home` mark with a site is contained by a parcel of its own household, no `market`
//     mark is, and the 89 `constitution` marks with a site are not (the Town Centre's backing rule is another judgement and stays
//     settled). A parcel is ground, so it is never withdrawn here (a ground change); its words may be amended.
//   · Content only: `body`. A mark's geometry, kind, tier, household, stamps and place stay canon's, whatever the pending claim says.
//   · Never the shared world: `world()`, every canon-keyed cache (the assembled world, the id, ground, room and interior indexes,
//     the stance world's kept slow half, the fold, the settlement) are not given a new object, a new key or a rebuild by an edit,
//     anyone's. The overlay is applied where a reader serves: the marks it lists (an array copy, built once per edit set), the body
//     in an investigate answer. Orient, eyes and the presence telling are the SIGHT of canon's geometry and stay canon's.
//   · A mark leaves a read only by its author's own withdraw act, the newest owner act on it (the very rule the crossing's
//     `WITHDRAWN_OWED_SELECT` uses, world2/tools/fold-delta.mjs), so a later re-leave or amend by the author cancels it.
//   · No age: an edit is visible while the store still owes it (the newest owner act on the mark, the newest live claim on it, canon
//     not yet carrying it), however old, and stops by the store's own facts (claim refused or retracted, a re-leave, canon carrying
//     it). No window count, no time-to-live, no mode.
//
// HOW THE OWED SET IS FOUND WITHOUT A HISTORY SCAN. The candidates are canon's own-parcel marks (about a third of the world), probed
// by the two indexes that answer "newest act on this object" (`acts_object_idx`) and "newest claim on this slug" (`claims_slug_idx`).
// That is run only when the store's facts moved, and the thing that says so is one cheap read per request: the newest mark act
// (`acts_class_idx`) and the windows' state (`windows` primary key). A claim's status changes only at a clearing (a window closes,
// the next opens) or by an act of its author (a mark act), so those numbers and canon's own object are the whole key: the same
// key means the same owed set, a different one means one rescan per process, never a rebuild of anything canon keeps.

import { createHash } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";

/** The ground fact: canon's standing walk says the mark stands on its own household's parcel. */
export const ownParcel = (m) => m?.tier === "home";

/** What the store's facts are keyed by: the newest mark act and the windows. A cheap read; an unchanged answer is an unchanged owed set. */
export const watchSql = `
  SELECT COALESCE((SELECT max(a.id) FROM acts a WHERE a.class = 'mark'), 0) AS mark_act,
         COALESCE((SELECT max(w.id) FROM windows w), 0) AS window_top,
         COALESCE((SELECT max(w.id) FROM windows w WHERE w.status = 'closed'), 0) AS window_closed,
         (SELECT count(*) FROM windows w WHERE w.status = 'clearing')::int AS clearing`;

/**
 * The newest owner act per candidate mark, with the newest pending-or-locked claim on it. `$1` = the candidate ids (canon's own-parcel
 * marks). Both probes are by index; there is no bound on how old an act is, because nothing that is still owed is old by anyone's clock.
 */
export const owedSql = `
  SELECT s.slug AS object, la.action, la.id AS act_id, la.crossing, c.id AS claim_id, c.status AS claim_status, c.body
    FROM unnest($1::text[]) AS s(slug)
    JOIN LATERAL (
      SELECT a.action, a.id, a.crossing FROM acts a
       WHERE a.object = s.slug AND a.class = 'mark'
         AND a.actor = split_part(s.slug, '/', 1)
         AND a.action IN ('leave-mark', 'amend', 'withdraw')
       ORDER BY a.id DESC LIMIT 1
    ) la ON true
    LEFT JOIN LATERAL (
      SELECT c.id, c.status, c.body FROM claims c
       WHERE c.slug = s.slug AND c.claimant = split_part(s.slug, '/', 1) AND c.status IN ('pending', 'locked')
       ORDER BY c.submitted_at DESC, c.id DESC LIMIT 1
    ) c ON la.action <> 'withdraw'
   ORDER BY s.slug`;

/**
 * THE EDITS, from the rows. PURE.
 * `{ bodies: Map(id -> body), removed: Set(id), key }`; `key` is empty when nothing is owed, else a short print of the set (the memo
 * key; a different edit, in any reader or worker, is a different key).
 *
 * Applicable only against canon and only to an own-parcel mark: an object canon does not hold, a mark that is not `home` tier, an
 * amend whose body is already canon's, and (withdrawals) a parcel, are no edit.
 */
export function editsFrom(rows, canonMarks) {
  const byId = new Map();
  for (const m of canonMarks ?? []) byId.set(m.id, m);
  const bodies = new Map();
  const removed = new Set();
  for (const r of rows ?? []) {
    const m = byId.get(r.object);
    if (!m || !ownParcel(m)) continue;
    if (r.action === "withdraw") { if (m.kind !== "parcel") removed.add(m.id); continue; }
    // an amend or a re-leave: the author's newest claim, while the candle has not refused or retracted it
    if (r.claim_status && typeof r.body === "string" && r.body !== m.body) bodies.set(m.id, r.body);
  }
  if (!bodies.size && !removed.size) return { bodies, removed, key: "" };
  const parts = [...bodies].map(([id, b]) => `b:${id}:${b.length}:${createHash("sha1").update(b).digest("hex").slice(0, 12)}`)
    .concat([...removed].map((id) => `r:${id}`)).sort();
  return { bodies, removed, key: parts.join("|") };
}

const NONE = Object.freeze({ bodies: new Map(), removed: new Set(), key: "" });
const memo = new WeakMap(); // canon marks array -> Map(edit key -> the overlaid array)

/**
 * The marks as served: canon's array itself when there is no edit, else one overlaid copy per (canon array, edit set). Only a
 * changed mark is a new object; every other mark and every unrelated field stays canon's own reference.
 */
export function overlayMarks(canonMarks, edits) {
  if (!edits?.key || !Array.isArray(canonMarks)) return canonMarks;
  let per = memo.get(canonMarks);
  if (!per) { per = new Map(); memo.set(canonMarks, per); }
  const hit = per.get(edits.key);
  if (hit) return hit;
  const out = [];
  for (const m of canonMarks) {
    if (edits.removed.has(m.id)) continue;
    out.push(edits.bodies.has(m.id) ? { ...m, body: edits.bodies.get(m.id) } : m);
  }
  if (per.size >= 8) per.clear(); // an edit set is replaced by the next; a handful is plenty
  per.set(edits.key, out);
  return out;
}

/**
 * An investigate answer with the owed edits laid over it: the focus's body (and any other edited mark's body the answer carries,
 * `alongside` and the rest), a removed mark dropped from the lists it sits in. Returns the answer itself when nothing it names is
 * edited. `null` when the FOCUS is a mark its author has withdrawn: the reader answers "no such mark" as it does for any miss. PURE.
 */
export function patchServed(answer, edits, focusId = null) {
  if (!edits?.key || !answer || typeof answer !== "object") return answer;
  if (focusId != null && edits.removed.has(String(focusId))) return null;
  const walk = (v, depth) => {
    if (depth > 6 || v === null || typeof v !== "object") return v;
    if (Array.isArray(v)) {
      let out = null;
      v.forEach((x, i) => {
        const dropped = x && typeof x === "object" && typeof x.id === "string" && edits.removed.has(x.id);
        const next = dropped ? undefined : walk(x, depth + 1);
        if (dropped || next !== x) out ??= v.slice(0, i);
        if (out && !dropped) out.push(next);
      });
      return out ?? v;
    }
    let out = null;
    const set = (k, val) => { out ??= { ...v }; out[k] = val; };
    if (typeof v.id === "string" && typeof v.body === "string" && edits.bodies.has(v.id)) set("body", edits.bodies.get(v.id));
    for (const [k, x] of Object.entries(v)) {
      if (k === "body" && out && out.body !== v.body) continue;
      const next = walk(x, depth + 1);
      if (next !== x) set(k, next);
    }
    return out ?? v;
  };
  return walk(answer, 0);
}

/** The ids an edit set touches (for a reader serving one house: whether anything of its own moved). */
export const editedIds = (edits) => new Set([...(edits?.bodies?.keys() ?? []), ...(edits?.removed ?? [])]);

// ── the store read ─────────────────────────────────────────────────────────

/** Counters the instrument and the tests read: reads of the watch, rescans of the owed set, empty and owed answers, failures. */
export const liveParcelStats = { watches: 0, scans: 0, empty: 0, owed: 0, failures: 0 };

// ONE WATCH PER REQUEST. A read can ask for the world's edits many times (GET /world/present asks 44 times); a request is a snapshot:
// it reads the store's facts once and every ask inside it shares that answer, so a request never sees two different worlds and
// never pays twice. A request that WRITES an edit (leave-mark, withdraw) reads afresh (`liveBypass`), so what it composes after its
// own write has the write in it. Outside a request scope (a script, a suite) every ask reads the store.
const scope = new AsyncLocalStorage();
/** Run one request inside its own snapshot scope: the server's and the read worker's request entry. */
export const liveScope = (fn) => scope.run({ memo: new Map(), bypass: false }, fn);
/** This request writes edits: stop sharing what it read before its write. */
export const liveBypass = () => { const st = scope.getStore(); if (st) { st.bypass = true; st.memo.clear(); } };

// What this thread knows of the owed set, per reader of the store (the default store read, or a suite's): the watch it was found
// under, the canon marks it was found for, and the rows. One rescan per change of the watch or of canon, shared by whoever asks while it runs.
const known = new WeakMap(); // ask function -> { watch, canon, rows, pending }
const candidates = new WeakMap(); // canon marks array -> the own-parcel ids

const candidateIds = (canonMarks) => {
  let ids = candidates.get(canonMarks);
  if (!ids) { ids = canonMarks.filter((m) => m?.id && ownParcel(m)).map((m) => m.id); candidates.set(canonMarks, ids); }
  return ids;
};

async function owedRows(ask, canonMarks) {
  const w = (await ask(watchSql, []))?.[0];
  if (!w) return null;
  const watch = `${w.mark_act}|${w.window_top}|${w.window_closed}|${w.clearing}`;
  let k = known.get(ask);
  if (!k) { k = { watch: null, canon: null, rows: null, pending: null }; known.set(ask, k); }
  if (k.canon === canonMarks && k.watch === watch && k.rows) return k.rows;
  if (k.pending && k.pending.canon === canonMarks && k.pending.watch === watch) return k.pending.promise;
  liveParcelStats.scans += 1;
  const { segSpan } = await import("./read-timing.mjs");
  const promise = segSpan("live_parcel_scan", () => ask(owedSql, [candidateIds(canonMarks)])).then((rows) => {
    if (k.pending?.promise === promise) { k.pending = null; k.watch = watch; k.canon = canonMarks; k.rows = rows ?? []; }
    return rows ?? [];
  }, (e) => { if (k.pending?.promise === promise) k.pending = null; throw e; });
  k.pending = { canon: canonMarks, watch, promise };
  return promise;
}

const builtFrom = new WeakMap(); // one snapshot's rows array -> Map(owners key -> { canon marks, the edit set built from them })

/**
 * The edits canon (the blessed marks array) is owed, read from the store now.
 * Never throws: a store that is not configured or will not answer is NO overlay (canon as it stands, as before this lane), counted in
 * `failures`, never a failed read.
 *
 * @param {object[]} canonMarks the blessed marks
 * @param {object} [o]
 * @param {Function} [o.query] (sql, params) => Promise<rows>; defaults to the office's store read (`actsQuery`)
 * @param {string[]|null} [o.owners] only these authors' edits (null = every author's)
 */
export async function liveEdits(canonMarks, { query = null, owners = null } = {}) {
  try {
    const ask = query ?? (await import("./world2-acts.mjs")).actsQuery;
    if (!query) {
      const { world2Enabled } = await import("./world2-acts.mjs");
      if (!world2Enabled()) return NONE;
    }
    if (!Array.isArray(canonMarks) || !canonMarks.length) return NONE;
    // the one watch a request makes, timed under it as the segment `live_parcel` (read-timing.mjs § segSpan): the cost is said, never inferred
    const { segSpan } = await import("./read-timing.mjs");
    const st = scope.getStore();
    const memoKey = st && !st.bypass ? canonMarks : null; // one snapshot per canon marks array
    let pending = memoKey ? st.memo.get(memoKey) : null;
    if (!pending) {
      liveParcelStats.watches += 1;
      pending = segSpan("live_parcel", () => owedRows(ask, canonMarks));
      if (memoKey) st.memo.set(memoKey, pending);
    }
    const all = await pending;
    if (!all?.length) { liveParcelStats.empty += 1; return NONE; }
    // a house-scoped reader keeps its own authors' rows (the object is `<author>/<slug>`); every other house's are not its to overlay
    const ownerKey = owners ? [...owners].sort().join(",") : "";
    let per = builtFrom.get(all);
    if (!per) { per = new Map(); builtFrom.set(all, per); }
    let hit = per.get(ownerKey);
    if (!hit || hit.canon !== canonMarks) {
      const rows = owners ? all.filter((r) => owners.includes(String(r.object).split("/")[0])) : all;
      hit = { canon: canonMarks, edits: editsFrom(rows, canonMarks) };
      per.set(ownerKey, hit);
    }
    const edits = hit.edits;
    if (edits.key) liveParcelStats.owed += 1; else liveParcelStats.empty += 1;
    return edits;
  } catch {
    liveParcelStats.failures += 1;
    return NONE;
  }
}

/** Canon's marks with the store's owed edits laid over, for every viewer. */
export async function liveMarks(canonMarks, opts = {}) {
  const edits = await liveEdits(canonMarks, opts);
  return { marks: overlayMarks(canonMarks, edits), edits };
}

/** The edits owed to the published world of `repo` (the readers that take canon from `publishedState` directly: the town's marks, the doorstep's stakes, the media). */
export async function editsForRepo(repo, opts = {}) {
  try {
    const { publishedState } = await import("./world-branches.mjs");
    return await liveEdits(publishedState(repo).state?.marks ?? [], opts);
  } catch { return NONE; }
}
