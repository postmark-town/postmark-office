// world-live-parcel.mjs — own-parcel content and dependency-free withdrawals, live for every viewer (POS-686).
//
// WHAT THIS IS. Between two settlements canon (the blessed world-state.json, and every cache keyed on its sha, a digest or a
// snapshot) is the world. An amendment to the authored content of a mark its author already published, and a withdrawal of a
// published mark nothing depends on, are written to the store at once (a pending `claims` row and an `acts` row, or an
// `acts` row alone: a published withdrawal files no claim) but reach canon only at the crossing. This module lays those two
// facts over canon at READ time, for every viewer, the way `heldPlaced` lays a hold over it (world.mjs, POS-688):
//
//     canon (immutable, shared, never touched)  +  the edits the store holds that canon has not carried yet  =  what is served
//
// WHAT IT TOUCHES, AND WHAT IT NEVER DOES.
//   · Content only: `body`. A mark's geometry, kind, tier, household, stamps and place stay canon's, whatever the pending claim
//     says (Darko: geometry and ground changes, opposition and the canonical fold stay settled).
//   · A mark leaves a read only by its author's own withdraw act, the newest owner act on it (the very rule the crossing's
//     `WITHDRAWN_OWED_SELECT` uses, world2/tools/fold-delta.mjs), so a later re-leave or amend by the author cancels it.
//   · Never a canon cache, never the fold, never the settlement: nothing here clears or keys anything global. With no edit
//     pending the answer is canon's own object, so every identity-keyed cache downstream keeps hitting. With edits, the
//     overlaid copy is built once per (canon object, edit set) and shared by every reader on the thread.
//   · No resurrection: the edits are read from the store every time, so a refused or retracted claim stops showing, and a
//     crossing that carries the edit makes the overlay a no-op (the body is canon's now; the mark is gone from canon).
//
// WHICH EDITS. Newest mark act (leave-mark, amend, withdraw) BY THE MARK'S OWNER per object, among the acts of the last two
// crossings before the blessed settlement's own window (older ones are canon's by construction: a crossing carries or refuses
// everything filed before it). One indexed read, no scan of history. `markEditsSql`.
//
// WHO SEES IT. Everyone. Pending and locked claims are public rows (007's row policy hides only `draft`), a withdraw act is a
// public act, and the query declares no household.

import { createHash } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";

/**
 * THE SWITCH. On by default; WORLD_LIVE_PARCEL=0 (or off, false, no) serves canon as it was before this layer: no store read, no overlay.
 * A way back that needs no deploy, and the control the read-eval round measures the layer's own cost against in one tree.
 */
export const liveParcelOn = (env = process.env) => !/^(0|off|false|no)$/i.test(String(env.WORLD_LIVE_PARCEL ?? "").trim());

/** How far back before the settlement's own window an act can still be owed to canon: the crossings between its fold and its blessing. */
export const WINDOWS_BACK = 2;

/**
 * The newest owner act per mark, with the newest pending-or-locked claim on it. `$2` = the owners asked about (a reader that serves
 * one house asks for its own handles only, so an unrelated house's read finds nothing and does no overlay work), or null for all.
 * `$1` = the blessed settlement's number (the
 * lower bound is the window it closed, minus `WINDOWS_BACK`); when the store holds no such row (or no window for it) the bound is open (every
 * act is considered: correct first, bounded where the store knows the settlement).
 */
export const markEditsSql = `
  SELECT l.object, l.action, l.act_id, l.crossing, c.id AS claim_id, c.status AS claim_status, c.body
    FROM (
      SELECT DISTINCT ON (a.object) a.object, a.action, a.id AS act_id, a.crossing
        FROM acts a
       WHERE a.class = 'mark'
         AND a.action IN ('leave-mark', 'amend', 'withdraw')
         AND a.object IS NOT NULL
         AND a.actor = split_part(a.object, '/', 1)
         AND ($2::text[] IS NULL OR a.actor = ANY($2::text[]))
         AND a.crossing >= COALESCE((SELECT s.window_id FROM settlements s WHERE s.number = $1), 0) - ${WINDOWS_BACK}
       ORDER BY a.object, a.id DESC
    ) l
    LEFT JOIN LATERAL (
      SELECT c.id, c.status, c.body FROM claims c
       WHERE c.slug = l.object AND c.claimant = split_part(l.object, '/', 1) AND c.status IN ('pending', 'locked')
       ORDER BY c.submitted_at DESC, c.id DESC LIMIT 1
    ) c ON true
   ORDER BY l.object`;

/**
 * THE EDITS, from the rows. PURE.
 * `{ bodies: Map(id -> body), removed: Set(id), key }`; `key` is empty when nothing is owed, else a short print of the set
 * (the memo key; a different edit, in any reader or worker, is a different key).
 *
 * Applicable only against canon: an amend whose body is already canon's, or an object canon does not hold, is no edit.
 */
export function editsFrom(rows, canonMarks) {
  const byId = new Map();
  for (const m of canonMarks ?? []) byId.set(m.id, m);
  const bodies = new Map();
  const removed = new Set();
  for (const r of rows ?? []) {
    const m = byId.get(r.object);
    if (!m) continue;
    if (r.action === "withdraw") { removed.add(m.id); continue; }
    // an amend or a re-leave: the author's newest claim, while the candle has not refused or retracted it
    if (r.claim_status && typeof r.body === "string" && r.body !== m.body) bodies.set(m.id, r.body);
  }
  if (!bodies.size && !removed.size) return { bodies, removed, key: "" };
  const parts = [...bodies].map(([id, b]) => `b:${id}:${b.length}:${createHash("sha1").update(b).digest("hex").slice(0, 12)}`)
    .concat([...removed].map((id) => `r:${id}`)).sort();
  return { bodies, removed, key: parts.join("|") };
}

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

/** The ids an edit set touches (for a reader that serves one house: whether anything of its own moved). */
export const editedIds = (edits) => new Set([...(edits?.bodies?.keys() ?? []), ...(edits?.removed ?? [])]);

// ── the store read ─────────────────────────────────────────────────────────

// ONE READ OF THE STORE PER REQUEST. A read can ask for the world many times (GET /world/present asks 44 times), and every ask
// would be one query for the same answer. A request is a snapshot: it reads the owed edits once (per settlement and set of
// owners) and every ask inside it shares that answer, so a request never sees two different worlds and never pays the read twice.
// A request that WRITES an edit (leave-mark, withdraw) reads the store each time (`liveBypass`), so what it composes after its own
// write is the world with its write in it. Outside a request scope (a script, a suite) every ask reads the store.
const scope = new AsyncLocalStorage();
/** Run one request inside its own snapshot scope: the server's and the read worker's request entry. */
export const liveScope = (fn) => scope.run({ memo: new Map(), bypass: false }, fn);
/** This request writes edits: stop sharing what it read before its write. */
export const liveBypass = () => { const st = scope.getStore(); if (st) { st.bypass = true; st.memo.clear(); } };

/** Counters the instrument and the tests read: store reads made, overlay requests that found nothing owed, and ones that did. */
export const liveParcelStats = { reads: 0, empty: 0, owed: 0, failures: 0 };

/**
 * The edits canon (the marks array and the settlement number it came from) is owed, read from the store now.
 * Never throws: a store that is not configured or will not answer is NO overlay (canon as it stands, as before this lane),
 * counted in `failures`, never a failed read.
 *
 * @param {object[]} canonMarks   the blessed marks
 * @param {number|null} settlement the blessed settlement's number (`blessed.n`)
 * @param {Function} [query] (sql, params) => Promise<rows>; defaults to the office's store read (`actsQuery`)
 * @param {string[]|null} [owners] only these authors' edits (null = every author's)
 */
export async function liveEdits(canonMarks, settlement, { query = null, owners = null } = {}) {
  try {
    if (!liveParcelOn()) return { bodies: new Map(), removed: new Set(), key: "" };
    const ask = query ?? (await import("./world2-acts.mjs")).actsQuery;
    if (!query) {
      const { world2Enabled } = await import("./world2-acts.mjs");
      if (!world2Enabled()) return { bodies: new Map(), removed: new Set(), key: "" };
    }
    // the one store read this layer adds to a read, timed under the request as the segment `live_parcel` (read-timing.mjs § segSpan): the cost is said, never inferred
    const { segSpan } = await import("./read-timing.mjs");
    const params = [Number.isFinite(Number(settlement)) ? Number(settlement) : -1, owners ? [...owners].sort() : null];
    const st = scope.getStore();
    const memoKey = st && !st.bypass ? JSON.stringify(params) : null;
    let pending = memoKey ? st.memo.get(memoKey) : null;
    if (!pending) {
      liveParcelStats.reads += 1;
      pending = segSpan("live_parcel", () => ask(markEditsSql, params));
      if (memoKey) st.memo.set(memoKey, pending);
    }
    const rows = await pending;
    if (!rows?.length) { liveParcelStats.empty += 1; return { bodies: new Map(), removed: new Set(), key: "" }; }
    const edits = editsFrom(rows, canonMarks);
    if (edits.key) liveParcelStats.owed += 1; else liveParcelStats.empty += 1;
    return edits;
  } catch {
    liveParcelStats.failures += 1;
    return { bodies: new Map(), removed: new Set(), key: "" };
  }
}

/** Canon's marks with the store's owed edits laid over, for every viewer. The one call a reader makes. */
export async function liveMarks(canonMarks, settlement, opts = {}) {
  const edits = await liveEdits(canonMarks, settlement, opts);
  return { marks: overlayMarks(canonMarks, edits), edits };
}

/** The edits owed to the published world of `repo` (the readers that take canon from `publishedState` directly: the town's marks, the doorstep's stakes). */
export async function editsForRepo(repo, opts = {}) {
  try {
    const { publishedState } = await import("./world-branches.mjs");
    const ps = publishedState(repo);
    return await liveEdits(ps.state?.marks ?? [], ps.blessed?.n ?? null, opts);
  } catch { return { bodies: new Map(), removed: new Set(), key: "" }; }
}
