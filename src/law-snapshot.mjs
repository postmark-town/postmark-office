// law-snapshot.mjs — the class layer's ONE in-memory copy of the law, at the
// newest blessing, refreshed off the request path (POS-270, Wright-ruled
// 2026-09-27: "snapshot").
//
// The class readers in world-classes.mjs are synchronous and have callers all
// over the office (the doorstep, say, hold, walk). They stay synchronous: they
// read `lawSnapshot()`, which is a variable, never a query. The query runs HERE,
// on a timer, and a new snapshot is PUBLISHED by one assignment once it is whole
// — so a request never waits on Postgres, and a request that lands mid-refresh
// is answered by the snapshot before it, complete.
//
// ── WHEN IT REFRESHES ────────────────────────────────────────────────────────
// "When the tag changes": every tick asks one cheap question — the newest
// settlement number, and the newest one whose law the pen has ingested
// (PIN_SQL). Only when that pair moves does the whole law come over
// (LAW_AT_BLESSING_SQL, law-classes.mjs). Between blessings a tick is two
// index lookups.
//
// ── THE FLOOR, NAMED (the ruling's first condition) ──────────────────────────
// Before the first snapshot lands, or on an office with no store engaged,
// `lawSnapshot()` is null and the class readers answer exactly as they did
// before this file: from world.db when there is one, and from their own floor
// when there is not — ROSTER_FLOOR for the roster (disclosed in `disclosed`),
// the caller's fallback for `dialNumber` (`read: false`, `source: "fallback"`).
// `lawStanding()` says which of the three a read stood on, with the sha, so a
// door can disclose it. Never an empty law passed off as a read one.
//
// ── ONE CACHE PER PROCESS (the ruling's second condition) ────────────────────
// `reloadLawSnapshot()` is the one way to make THIS process learn the tag
// moved. The timer calls it; a read worker (POS-266) calls it too, or runs its
// own timer — each process holds its own copy and learns on its own.
//
// ── A REFRESH HAS A DEADLINE (POS-680) ───────────────────────────────────────
// A refresh shared through `inflight` that never settled (a store query that
// hangs) used to answer every later tick with the same pending promise, so the
// law in force was the one before it until the process restarted. Now a
// refresh still running after LAW_REFRESH_DEADLINE_MS is let go: `inflight` is
// cleared, its callers get `{ changed: false, abandoned: true }`, and the next
// tick starts a fresh one. A refresh that was let go and then finishes still
// publishes, unless a refresh that started after it has already published, so
// a store that is slow rather than stuck costs nothing. What was let go is
// ended by the store itself (a statement_timeout scoped to the refresh's own
// transaction), and at most MAX_LOADS refreshes run at once, law and graph
// together (snapshot-loads.mjs), so a store that hangs never takes the pool.
//
// ── ONE EVENT FOR EVERY PUBLISH (POS-680) ────────────────────────────────────
// Whatever publishes a law (the timer, a read worker's announcement, a test, a
// tool), the same listeners hear it (`onLawPublish`): the main thread's
// announcement to its read workers, and every kept read that is derived from
// the law (restored-classes.mjs), so nothing derived outlives the law it was
// read from.
//
// ── AN ACT ASKS FIRST (POS-680 part 2) ───────────────────────────────────────
// The timer is how a READ learns the law moved; an ACT does not wait for it.
// `freshLaw()` asks the pin (two index lookups) and, when it moved, loads the
// new law before it answers, so the act stands on the law the store has at
// that moment. When the store says it moved and the new law could not be
// loaded in time, `behind` says so, and the act refuses rather than judge
// under law the store has replaced (act-law.mjs). The asks share the
// refreshers' cap (snapshot-loads.mjs § MAX_LOADS): a store that is slow is
// never asked for the whole law once per act.

import { LAW_AT_BLESSING_SQL, lawSnapshotFromRows } from "./law-classes.mjs";
import { startLoad, endLoad, loadsStanding, timedSession, servePool, MAX_LOADS } from "./snapshot-loads.mjs";

// The pair that says "the law to serve has moved". Both halves matter: a new
// settlement whose law is not ingested moves `newest` (the disclosure changes),
// and the law pen catching up moves `pinned` (the law itself changes).
export const PIN_SQL = `
  SELECT (SELECT max(number) FROM settlements) AS newest,
         (SELECT s.number FROM settlements s
           WHERE EXISTS (SELECT 1 FROM law_projection l WHERE l.law_sha = s.tag_sha)
           ORDER BY s.number DESC LIMIT 1) AS pinned`;

/** The two statements a refresh sends, by name — so a test can tell them apart. */
export const LAW_REFRESH_SQLS = Object.freeze({ pin: PIN_SQL, law: LAW_AT_BLESSING_SQL });

/** How long a refresh may run before it is let go (POS-680). */
export const LAW_REFRESH_DEADLINE_MS = Number(process.env.LAW_REFRESH_DEADLINE_MS ?? 3_000);

const fresh = () => ({
  snap: null,          // the published snapshot, or null (the floor)
  key: null,           // "newest/pinned" the published snapshot answers
  inflight: null,      // the refresh in progress, if any — never awaited by a read
  lastError: null,     // the last refresh's failure, for the health line
  timer: null,
  started: 0,          // refreshes started, numbered: a late one never publishes over a newer one
  publishedBy: 0,      // the number of the refresh whose law is in force
  checkedAt: null,     // when a refresh last finished asking the store (ISO), for the health line
  publishedAt: null,   // when the law in force was published (ISO)
  abandoned: 0,        // refreshes let go at the deadline, this process
  unhear: null,        // the refresher's own listener, removed by a reset
  seenPinned: null,    // the settlement whose law the store last said is the newest ingested
});
const state = fresh();
const listeners = new Set();

/** The published snapshot, or null. Synchronous; never queries. */
export const lawSnapshot = () => state.snap;

/**
 * Hear every publish, from any path. `fn(standing)` runs after the new law is
 * in force; one that throws stops nothing. Returns the way to stop hearing.
 */
export function onLawPublish(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function publish(next, key, n) {
  // THE PUBLISH. One assignment: a reader sees the old snapshot or the new
  // one, never a half-built map.
  state.snap = next; state.key = key; state.publishedBy = n; state.publishedAt = new Date().toISOString();
  const standing = lawStanding();
  for (const fn of listeners) { try { fn(standing); } catch { /* a listener that throws does not stop the publish */ } }
}

/**
 * The refresher's own state, for the health line: when the store was last
 * asked, when the law in force was published, how many refreshes were let go,
 * and whether one is running now.
 */
export function lawRefreshStanding() {
  return { checked_at: state.checkedAt, published_at: state.publishedAt, abandoned: state.abandoned,
    in_flight: Boolean(state.inflight), deadline_ms: LAW_REFRESH_DEADLINE_MS, error: state.lastError, loads: loadsStanding(),
    ...(lawBehind() ? { behind: lawBehind() } : {}) };
}

/**
 * Null when this process acts on the newest law the store has ingested (as far
 * as the store last said), else the sentence: the store's law moved and this
 * process has not loaded it.
 */
export function lawBehind() {
  const seen = state.seenPinned == null ? null : Number(state.seenPinned);
  const have = state.snap?.pin?.settlement == null ? null : Number(state.snap.pin.settlement);
  if (seen == null || seen === have) return null;
  return `the store's law is S${seen}'s, and this office has not loaded it yet (it acts on ${have == null ? "no law" : `S${have}'s`})`;
}

/**
 * The law as the store has it NOW, for an act: asks the pin, loads a moved law,
 * and answers `{ snap, behind }` (§ AN ACT ASKS FIRST). Never throws.
 */
export async function freshLaw({ query, deadlineMs } = {}) {
  await reloadLawSnapshot({ ...(query ? { query } : {}), ...(deadlineMs !== undefined ? { deadlineMs } : {}) });
  return { snap: state.snap, behind: lawBehind() };
}

/**
 * Where the class layer is standing right now, for a door to disclose:
 * `{ source: "law", settlement, sha, disclosed }` once a snapshot is published,
 * `{ source: "floor", disclosed }` before (the readers then fall back to
 * the world graph snapshot, or their floors).
 */
export function lawStanding() {
  const s = state.snap;
  if (s) return { source: "law", settlement: s.pin.settlement, sha: s.pin.sha, disclosed: s.disclosed };
  return {
    source: "floor",
    disclosed: state.lastError
      ? `the law snapshot has not loaded (${state.lastError}) — class reads answer from the world graph snapshot where it has loaded, else from their floors`
      : "the law snapshot has not loaded yet — class reads answer from the world graph snapshot where it has loaded, else from their floors",
  };
}

// The store, by default: a refresh handed no `query` reads in its own timed
// session on the serve pool (snapshot-loads.mjs § timedSession). This function
// is that default's name; a refresh never calls it statement by statement.
async function defaultQuery(sql, params) {
  return (await servePool()).query(sql, params);
}

/**
 * Ask the store whether the law to serve moved, and if so load it and PUBLISH it.
 * Resolves to `{ changed, standing }`. Concurrent calls share one refresh. A
 * failure keeps the published snapshot (stale-but-whole beats none) and is
 * recorded for `lawStanding()`; it never throws into a caller.
 *
 * `query(sql, params)` → `{ rows }` — the pg pool by default; a test hands in
 * PGlite. `deadlineMs` is how long callers wait before the refresh is let go
 * (§ A REFRESH HAS A DEADLINE); null waits for it however long it takes.
 */
export function reloadLawSnapshot({ query = defaultQuery, force = false, deadlineMs = LAW_REFRESH_DEADLINE_MS } = {}) {
  if (state.inflight) return state.inflight;
  if (!startLoad()) {
    state.lastError = `${MAX_LOADS} store refreshes are still running (the cap); this one was skipped and the next tick asks again`;
    return Promise.resolve({ changed: false, busy: true, standing: lawStanding() });
  }
  const n = ++state.started;
  const newest = () => n === state.started; // only the newest refresh speaks for the health line
  let live = null;
  const work = (async () => {
    await null; // the body runs after `inflight` is set, even when `query` throws at once
    let session = null;
    try {
      if (query === defaultQuery) session = await timedSession(await servePool());
      const ask = session ? session.query : query;
      const pin = (await ask(PIN_SQL)).rows[0] ?? {};
      const key = `${pin.newest ?? "-"}/${pin.pinned ?? "-"}`;
      if (newest() || n > state.publishedBy) state.seenPinned = pin.pinned ?? null;
      if (!force && state.snap && key === state.key) {
        if (newest()) { state.lastError = null; state.checkedAt = new Date().toISOString(); }
        return { changed: false, standing: lawStanding() };
      }
      const next = lawSnapshotFromRows((await ask(LAW_AT_BLESSING_SQL)).rows);
      // A refresh let go at its deadline publishes only if nothing that started
      // after it has published since. A store with no ingested blessing
      // publishes nothing and leaves whatever stood (null on a fresh process:
      // the floor).
      const late = n < state.publishedBy;
      if (next && !late) publish(next, key, n);
      if (newest()) { state.lastError = next ? null : "the store holds no settlement whose law is ingested"; state.checkedAt = new Date().toISOString(); }
      return { changed: Boolean(next) && !late, standing: lawStanding() };
    } catch (e) {
      if (newest()) state.lastError = String(e?.message ?? e).slice(0, 160);
      return { changed: false, standing: lawStanding() };
    } finally {
      await session?.end();
      endLoad();
      if (state.inflight === live) state.inflight = null;
    }
  })();
  let timer = null;
  live = deadlineMs == null ? work : Promise.race([work, new Promise((resolve) => {
    timer = setTimeout(() => {
      if (state.inflight === live) state.inflight = null;
      state.abandoned += 1;
      state.lastError = `a law refresh did not finish in ${deadlineMs} ms and was let go; the next tick asks again`;
      resolve({ changed: false, abandoned: true, standing: lawStanding() });
    }, deadlineMs);
    timer.unref?.();
  })]).finally(() => clearTimeout(timer));
  state.inflight = live;
  return live;
}

/**
 * Start the refresher: one load now, then a tick every `intervalMs`. The timer
 * is unref'd — it never holds a process open. Idempotent.
 *
 * `onChange(standing)` runs after every PUBLISH, from the timer or any other
 * path (§ ONE EVENT FOR EVERY PUBLISH), and only then. The office's main
 * thread hands in `announce("law")`, so its read workers (POS-266) reload the
 * moment the tag moves rather than a tick later. A worker runs no timer of its
 * own: it loads once at boot (`reloadLawSnapshot()`), then on each
 * announcement.
 */
export function startLawRefresher({ intervalMs = Number(process.env.LAW_REFRESH_MS ?? 60_000), query, onChange = null } = {}) {
  if (state.timer) return;
  if (onChange) state.unhear = onLawPublish(onChange);
  const tick = () => reloadLawSnapshot({ query });
  tick();
  state.timer = setInterval(tick, intervalMs);
  state.timer.unref?.();
}

/** Tests only: forget everything, stop the timer and its listener. Listeners a module registered stay. */
export function resetLawSnapshot() {
  if (state.timer) clearInterval(state.timer);
  state.unhear?.();
  // the count goes on, and every refresh from before the reset is late: none publishes into it
  Object.assign(state, { ...fresh(), started: state.started, publishedBy: state.started + 1 });
}
