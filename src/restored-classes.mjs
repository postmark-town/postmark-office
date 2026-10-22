// restored-classes.mjs — a class the town has taken, and since given back by its own act (WLD-7, WLD-25/j).
//
// A class is taken while its record says `dials.stolen: true` (world-stacks.mjs §
// stolenRefusal). It can also be given back IN THE RECORD, before the world's dial is
// removed: the town's own `restore` act on the class (an ending that gives a class
// back, written at the settlement it ends on; plumb-combat's engine). From that act
// on, the class works again, though the dial still stands. So the question is the
// dial AND no restore since the dial went on (Wright, 2026-10-22, from Darko's
// WLD-25/j ruling at 14:52).
//
// WHEN THE DIAL WENT ON is read from the law, never guessed: the bless of the
// earliest settlement in the unbroken run of settlements, newest back, whose law says
// `stolen: true` for the class. A restore at or after it lifts the freeze. A dial
// turned off and on again later starts a new run, so an old restore lifts nothing.
//
// KEPT, NEVER ON THE REQUEST PATH. `restoredClass(klass)` is synchronous and answers
// what this process last read; a read older than KEEP_MS starts a refresh in the
// background and the act goes on with what stood. Before the first read, nothing is
// restored: a taken class stays taken until the record is read (fail closed). Each
// process keeps its own, as each keeps its own law snapshot.

import { lawSnapshot } from "./law-snapshot.mjs";

export const RESTORE_ACTION = "restore";
const TOWN = "the-town";
export const KEEP_MS = 30_000;

/** The town's restore acts, oldest first. */
export const RESTORE_ROWS_SQL = `SELECT id::text AS id, at, actor, action, object FROM acts
  WHERE action = '${RESTORE_ACTION}' AND actor = '${TOWN}' ORDER BY acts.id`;
/** One class's record at every ingested settlement, newest first: its dials, and when each was blessed. */
export const CLASS_RUN_SQL = `SELECT s.number, s.blessed_at, s.published_at, l.data FROM settlements s
  JOIN law_projection l ON l.law_sha = s.tag_sha AND l.kind = 'class' AND l.key = $1
  ORDER BY s.number DESC`;

const dialsOf = (data) => {
  const d = (typeof data === "string" ? (() => { try { return JSON.parse(data); } catch { return {}; } })() : data)?.dials;
  const v = typeof d === "string" ? (() => { try { return JSON.parse(d); } catch { return {}; } })() : d;
  return v && typeof v === "object" ? v : {};
};
const isoOf = (t) => (t instanceof Date ? t.toISOString() : t == null ? null : String(t));

/** PURE. Has the town restored `klass` at or after `since`? `record` is the restore rows. */
export function restoredSince(record, klass, since) {
  if (since == null) return false;
  const from = Date.parse(since);
  if (!Number.isFinite(from)) return false;
  return (record ?? []).some((r) => r?.action === RESTORE_ACTION && r?.actor === TOWN && String(r?.object) === String(klass)
    && Number.isFinite(Date.parse(isoOf(r.at))) && Date.parse(isoOf(r.at)) >= from);
}

/** PURE. When the dial went on: the bless of the earliest settlement in the newest unbroken run that says stolen; null when the newest does not. */
export function stolenSinceOf(rowsNewestFirst) {
  let since = null;
  for (const r of rowsNewestFirst ?? []) {
    if (dialsOf(r.data).stolen !== true) break;
    since = isoOf(r.blessed_at ?? r.published_at);
  }
  return since;
}

async function defaultQuery(sql, params) {
  const { world2ServeEnabled, world2Pool } = await import("./world2-serve.mjs");
  if (!world2ServeEnabled()) throw new Error("the world 2.0 store is not engaged at this office (WORLD2_PG/WORLD2_PG_URL)");
  return (await world2Pool()).query(sql, params);
}

/**
 * Read which taken classes are restored: `Map(class → { since, restored })`, for every
 * class whose dial says stolen in `classes` (the names). `query(sql, params)` → { rows }.
 */
export async function readRestored({ classes = [], query = defaultQuery } = {}) {
  const out = new Map();
  if (!classes.length) return out;
  const record = (await query(RESTORE_ROWS_SQL)).rows;
  for (const klass of classes) {
    const since = stolenSinceOf((await query(CLASS_RUN_SQL, [klass])).rows);
    out.set(String(klass), { since, restored: restoredSince(record, klass, since) });
  }
  return out;
}

const state = { byClass: new Map(), at: 0, inflight: null, failed: false };

/** Every class the published law says is stolen. */
function stolenInLaw() {
  const snap = lawSnapshot();
  const names = [];
  for (const [name, rec] of snap?.classes ?? []) if (dialsOf(rec).stolen === true) names.push(String(name));
  return names;
}

/** Refresh in the background. A failure leaves what stood and keeps it for the same
 *  KEEP_MS a good read is kept, so a store that is down is asked once a window, never
 *  once per act (Wright's review of #734). */
export function refreshRestored({ query = defaultQuery, now = Date.now(), classes = null } = {}) {
  if (state.inflight) return state.inflight;
  state.inflight = (async () => {
    try {
      state.byClass = await readRestored({ classes: classes ?? stolenInLaw(), query });
      state.at = now;
      state.failed = false;
    } catch {
      state.failed = true;   // no text kept: nothing here says it (error-text census)
      state.at = now;
    } finally {
      state.inflight = null;
    }
  })();
  return state.inflight;
}

/** SYNCHRONOUS. Is this taken class restored, as this process last read? */
export function restoredClass(klass, { now = Date.now(), query = defaultQuery, classes = null } = {}) {
  if (now - state.at >= KEEP_MS) refreshRestored({ now, query, classes }).catch(() => {});
  return state.byClass.get(String(klass))?.restored === true;
}

/** Tests only. */
export function __setRestoredForTest(entries = null, at = Date.now()) {
  state.byClass = new Map(Object.entries(entries ?? {}));
  state.at = entries == null ? 0 : at;
  state.inflight = null;
}
