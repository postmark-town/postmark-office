// household-activity.mjs — WHICH HOUSES ARE LIT (WLD-29): the household
// activity the office derives for the porch lights, kept INSIDE the office.
//
// THE POINTER MODEL (Wright, AUTHORITY 2026-10-13T19:16:02.257Z; Darko's go,
// "Gaps closed: build"): the town-wide answer is never carried on a default
// read. What leaves this file is small and local:
//   · `lit: true|false|null` on a house a read already shows (litOf);
//   · a focused house's "lit; last active crossing N; what lights a house"
//     (houseFocus) — when, never who or what;
//   · GET /world/lights' `{ crossing, window, lit: [<household keys>] }`
//     (lightsAnswer) — the lit keys only: no resident→house map, no members,
//     no acts.
// `households` and `house_of` below are this module's working state; no
// answer carries them.
//
// THE PORCH LIGHT IS HOUSEHOLD ACTIVITY, FROM THE STORE (Darko, 2026-10-08):
// not somebody resting inside. Presence stays on the walkers and in earshot;
// nothing here reads a walker, a position, git or presence.
//
// ONE DEFINITION OF "ACTIVE" (Wright, AUTHORITY 2026-10-13T11:04:36.763Z):
// last-active.mjs's own statement — the resident's newest act of their own:
// acts, letters they sent, page updates; never reads, mail received or stakes —
// at the town clock's crossing of that instant (`currentCrossing(at)`, never
// `acts.crossing`). This file adds only the household fold:
//
//   members     the store's registry (`registry_households`: each house's
//               residents) and the town roll's residents who belong to no
//               house, each a house of one.
//   the key     THE FOLD'S HOUSEHOLD KEY, `declared_household`'s spelling
//               (marks-fold.mjs § the household grain; world2-claims.mjs):
//               a declared house is `hh:<registry slug>`, anyone else
//               `solo:<handle>` — as the published world-state.json spells
//               every parcel's `declared_household`. A page joins a parcel's
//               own `declared_household` to the lit list, so the two must be
//               one spelling.
//   the fold    MAX of the last-active crossing over the house's residents who
//               are NOT emeritus. An emeritus resident contributes nothing — the
//               exclusion happens before the max, so an active co-resident still
//               lights the house and an emeritus one never does.
//   the window  lit when the house's crossing is the clock C or C-1, against
//               THIS clock (never a browser's preview).
//
// A HISTORICAL READ (a crossing other than the current one) carries no lit
// state: activity is kept as each resident's newest act only, so a past
// crossing's lights cannot be rebuilt, and today's are not painted onto it.
//
// AN UNREAD STORE IS NOT A DARK TOWN: the answer says it could not read, and
// every house is unknown (null) — never "nobody was active", never a fallback.
//
// BOUNDED (the approved rework): a caller waits at most CALLER_WAIT_MS for the
// answer, then is told `unavailable` by name; the batch it was waiting on runs
// on and fills the cache for the next reader. The batch runs in its own
// read-only transaction with `statement_timeout` BATCH_STATEMENT_TIMEOUT_MS, so
// a statement stuck behind a lock is cancelled by Postgres, rolled back and its
// connection handed back — never left holding the pen.

import { currentCrossing } from "./crossings.mjs";
import { lastActiveFor, LAST_ACTIVE_MEANS } from "./last-active.mjs";
import { registryRowsVia } from "./registry-store.mjs";
import { registryFromRows } from "./registry-rows.mjs";

/**
 * THE EMERITUS SEAM (POS-453, not built). Whether a resident is emeritus — and
 * so lights nothing. No field says so yet: POS-453 supplies and wires it in its
 * own PR. Until then this is false for everyone in production, and nothing is
 * inferred from retired pins, identity status or anything else. Tests inject
 * their own predicate through `householdActivity({ isEmeritus })`.
 */
export const isEmeritus = (_resident) => false;

/** How many crossings back a house's last act still lights it: C and C-1. */
export const LIT_WINDOW = 1;

/** The town roll's residents, at the town head the store has projected. */
export const ROLL_SQL = `SELECT r.handle FROM town_roll r
  JOIN projection_heads h ON h.repo = 'town' AND h.sha = r.town_sha ORDER BY r.handle`;

/** How long one current batch is served before the next read asks again (per office worker, per store). */
export const ACTIVITY_TTL_MS = 60_000;
/** How long a reader waits for the answer before it is told `unavailable`. */
export const CALLER_WAIT_MS = 1_500;
/** Postgres's own limit on each statement of the batch (SET LOCAL, this transaction only). */
export const BATCH_STATEMENT_TIMEOUT_MS = 5_000;

/** What lights a house — the sentence a focused house carries. */
export const LIGHT_MEANS =
  `a house is lit when its newest act falls in the current crossing or the one before (C or C-1). An act is ${LAST_ACTIVE_MEANS}. A house's last active crossing is the newest over its residents who are not emeritus; null: none of them has an act on record. FRESHNESS: each office worker reads the town's activity at most once per ${ACTIVITY_TTL_MS / 1000} s for the current crossing, so an act can take up to about ${ACTIVITY_TTL_MS / 1000} s (plus that read's own duration) to light its house; a new crossing reads afresh, and a failed read is not kept`;

export const ACTIVITY_HISTORICAL =
  "activity isn't kept per crossing: the store keeps each resident's newest act only, so a past crossing's lights cannot be rebuilt — this read carries no lit state";

export const ACTIVITY_UNAVAILABLE =
  "household activity could not be read from the store just now, so no house's light is known on this answer — not because nobody was active";

export const ACTIVITY_SLOW =
  `household activity did not answer within ${CALLER_WAIT_MS / 1000} s, so no house's light is known on this answer — not because nobody was active; the read carries on, and a later answer can know`;

/** Whether a house whose last act fell in `last` is lit at activity clock `clock`. null when either is unknown. */
export function litAt(last, clock) {
  if (!Number.isInteger(clock)) return null;
  if (last === undefined) return null;
  if (last === null) return false;
  const age = clock - last;
  return age >= 0 && age <= LIT_WINDOW;
}

/**
 * The fold, pure: membership + last-active → the two working maps.
 * `houses`: Map key → handles; `found`: Map handle → { crossing }.
 */
export function foldHouseholds({ houses, found, isEmeritus: emeritus = isEmeritus }) {
  const households = {};
  const house_of = {};
  for (const [key, residents] of houses) {
    let best = null;
    for (const h of residents) {
      house_of[h] = key;
      if (emeritus(h)) continue;                 // before the max: an emeritus act lights nothing
      const c = found.get(h)?.crossing;
      if (Number.isInteger(c) && (best === null || c > best)) best = c;
    }
    households[key] = best;
  }
  return { households, house_of };
}

/** Every house and its residents, keyed as the fold keys them: `hh:<slug>` for the registry's houses, then `solo:<handle>` for the roll's residents of no house. */
export function housesOf(registry, roll = []) {
  const houses = new Map();
  for (const [slug, h] of Object.entries(registry?.households ?? {})) {
    const residents = [...new Set((h?.residents ?? []).map(String).filter(Boolean))];
    if (residents.length) houses.set(`hh:${slug}`, residents);
  }
  const housed = new Set([...houses.values()].flat());
  for (const h of roll) if (h && !housed.has(String(h))) houses.set(`solo:${h}`, [String(h)]);
  return houses;
}

/**
 * The working answer, on the caller's queryable `q`. `current: false` is a
 * historical read. `now` is the clock's instant (tests pin it).
 */
export async function householdActivity(q, { current = true, now = Date.now(), isEmeritus: emeritus = isEmeritus } = {}) {
  if (!current) return { clock: null, households: null, house_of: null, historical: true, note: ACTIVITY_HISTORICAL };
  const clock = currentCrossing(now);
  const registry = registryFromRows(await registryRowsVia(q));
  const roll = (await q.query(ROLL_SQL)).rows.map((r) => r.handle);
  const houses = housesOf(registry, roll);
  const found = await lastActiveFor(q, [...houses.values()].flat());
  return { clock, ...foldHouseholds({ houses, found, isEmeritus: emeritus }) };
}

/** The batch on a pen connection: its own statement limit first, then the three reads. */
export async function boundedActivity(c, { now = Date.now() } = {}) {
  await c.query(`SET LOCAL statement_timeout = ${BATCH_STATEMENT_TIMEOUT_MS}`);
  return householdActivity(c, { now });
}

// ── THE CURRENT ANSWER, SHARED ───────────────────────────────────────────────
//
// The batch reads the town's whole membership and every resident's newest act;
// it grows with history and borrows a pen connection. So ONE answer per store,
// per activity clock C, is shared for ACTIVITY_TTL_MS:
//   · keyed by the STORE the read goes to (`backend`: the office's own store, or
//     an injected one), never by a caller's closure — so every door shares it,
//     and an injected test store never meets another's;
//   · keyed by C, and only the current C is kept: a new crossing reads afresh,
//     and a reply for an older C cannot land in the newer C's slot;
//   · single-flight: concurrent misses wait on the one batch in flight, and a
//     caller who stopped waiting (CALLER_WAIT_MS) leaves it running: its answer
//     still lands for the next reader, and no second batch is started;
//   · a FAILURE IS NOT KEPT: the next read asks the store again — an outage
//     never sticks as darkness;
//   · the cached value is plain data (no connection held), and every caller gets
//     its OWN copy, so shaping one answer cannot change another's.
const shared = new Map();   // backend → Map(clock → { promise, value, at })

/** Tests only: forget every cached answer. */
export function resetActivityCache() { shared.clear(); }

function sharedActivity(backend, clock, nowMs, compute) {
  let byClock = shared.get(backend);
  if (!byClock) shared.set(backend, byClock = new Map());
  for (const c of [...byClock.keys()]) if (c !== clock) byClock.delete(c);
  const held = byClock.get(clock);
  if (held && (held.promise || nowMs - held.at < ACTIVITY_TTL_MS)) return held.promise ?? Promise.resolve(held.value);
  const entry = { promise: null, value: null, at: nowMs };
  entry.promise = (async () => {
    try {
      const value = await compute();
      if (byClock.get(clock) === entry) { entry.value = value; entry.promise = null; }
      return value;
    } catch (e) {
      if (byClock.get(clock) === entry) byClock.delete(clock);   // a failure is not kept
      throw e;
    }
  })();
  entry.promise.catch(() => {});   // a batch nobody is still waiting on fails quietly
  byClock.set(clock, entry);
  return entry.promise;
}

/** The answer, or `undefined` when `ms` passed first; the timer never outlives the race. */
function within(promise, ms) {
  let timer = null;
  const late = new Promise((resolve) => { timer = setTimeout(resolve, ms, undefined); });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

/**
 * The working answer for a read. A current read is served from the shared
 * answer for its store and clock (above). `backend` names the store: the
 * office's own by default; a caller with an injected pool passes it as `pool`
 * (and so as the key). `read` is the unit tests' seam: a function handed the
 * batch, in place of the pen. A failure or a slow store is disclosed, never
 * thrown and never filled from anywhere else.
 */
export async function readHouseholdActivity({ current = true, env = process.env, read = null, pool = null, backend = null, now = Date.now(), waitMs = CALLER_WAIT_MS } = {}) {
  if (!current) return householdActivity(null, { current: false });
  const clock = currentCrossing(now);
  const store = backend ?? pool ?? `store:${env.WORLD2_PG_URL ?? ""}`;
  const unknown = (why) => ({ clock, households: null, house_of: null, unavailable: why });
  try {
    const batch = sharedActivity(store, clock, now, async () => {
      if (read) return read((q) => householdActivity(q, { now }));
      const { officeRead } = await import("./world2-pen.mjs");
      return officeRead((c) => boundedActivity(c, { now }), { env, pool: pool ?? null, by: "householdActivity" });
    });
    const value = await within(batch, waitMs);
    return value === undefined ? unknown(ACTIVITY_SLOW) : structuredClone(value);
  } catch {
    return unknown(ACTIVITY_UNAVAILABLE);
  }
}

// ── WHAT LEAVES THE OFFICE ───────────────────────────────────────────────────

/** Why no house's light is known on this answer, or null when they are. */
export function lightsUnknownWhy(activity) {
  if (!activity) return ACTIVITY_UNAVAILABLE;
  if (activity.historical) return activity.note ?? ACTIVITY_HISTORICAL;
  if (!activity.households || !Number.isInteger(activity.clock)) return activity.unavailable ?? ACTIVITY_UNAVAILABLE;
  return null;
}

/**
 * A mark's household key: its own `declared_household` (the fold's key, the one
 * a page joins on) where the answer knows that house; otherwise its owner's
 * house in the store's registry. null: neither is known.
 */
export function houseKeyOf(mark, activity) {
  const houses = activity?.households;
  if (!houses || !mark) return null;
  const declared = mark.declared_household == null ? null : String(mark.declared_household);
  if (declared && Object.hasOwn(houses, declared)) return declared;
  const owner = mark.by ?? mark.household ?? null;
  const key = owner == null ? null : activity.house_of?.[String(owner)] ?? null;
  return key && Object.hasOwn(houses, key) ? key : null;
}

/** A shown house's light: true or false when known, null when it is not (an unread store, a past crossing, a house the answer does not name). */
export function litOf(mark, activity) {
  if (lightsUnknownWhy(activity)) return null;
  const key = houseKeyOf(mark, activity);
  return key == null ? null : litAt(activity.households[key], activity.clock);
}

/** A focused house: lit, its last active crossing, and what lights a house. When, never who or what. */
export function houseFocus(mark, activity) {
  const why = lightsUnknownWhy(activity);
  if (why) return { lit: null, last_active_crossing: null, unknown: why, means: LIGHT_MEANS };
  const key = houseKeyOf(mark, activity);
  if (key == null) return { lit: null, last_active_crossing: null, unknown: "this house is not one the store's registry or roll names, so its light is not known", means: LIGHT_MEANS };
  const last = activity.households[key];
  return { lit: litAt(last, activity.clock), last_active_crossing: last, crossing: activity.clock, means: LIGHT_MEANS };
}

/**
 * GET /world/lights' answer for the crossing `n` it stands at: the lit
 * household keys only, sorted. A past crossing or an unread store says so,
 * with `lit: null` — never an empty list that would read as a dark town.
 */
export function lightsAnswer(activity, n) {
  const why = lightsUnknownWhy(activity);
  if (activity?.historical) return { crossing: n, window: LIT_WINDOW, lit: null, historical: true, note: why };
  if (why) return { crossing: n, window: LIT_WINDOW, lit: null, unavailable: why };
  const lit = Object.entries(activity.households).filter(([, last]) => litAt(last, activity.clock) === true).map(([key]) => key).sort();
  return { crossing: activity.clock, window: LIT_WINDOW, lit };
}
