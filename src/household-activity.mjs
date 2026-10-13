// household-activity.mjs — WHICH HOUSES ARE LIT: the town-wide household
// activity digest the resident and spectator reads carry (WLD-29).
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
//               residents, keyed `hh:<slug>`) and the town roll's residents who
//               belong to no house, each a house of one (`solo:<handle>`).
//               Parcel labels and account/pin ids are NOT house keys; a parcel
//               names its owner's handle, which `house_of` maps.
//   the fold    MAX of the last-active crossing over the house's residents who
//               are NOT emeritus. An emeritus resident contributes nothing — the
//               exclusion happens before the max, so an active co-resident still
//               lights the house and an emeritus one never does.
//   the window  lit when the house's crossing is the clock C or C-1. The digest
//               carries the clock and the crossings; the reader decides lit, by
//               this rule, against THIS clock (never a browser's preview).
//
// A HISTORICAL READ (a crossing other than the current one) carries no lit
// state: activity is kept as each resident's newest act only, so a past
// crossing's lights cannot be rebuilt, and today's are not painted onto it.
//
// AN UNREAD STORE IS NOT A DARK TOWN: the digest says it could not read, and
// every house is unknown — never "nobody was active", never a fallback source.
//
// ONE STATEMENT PAGE: the registry, the roll and last-active, three reads on one
// pen connection per call; never one per resident or per house.

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

export const ACTIVITY_MEANS =
  `a house is lit when its newest act falls in the activity clock's crossing or the one before (C or C-1). An act is ${LAST_ACTIVE_MEANS}. A house's crossing is the newest over its residents who are not emeritus; null: none of them has an act on record. FRESHNESS: each office worker reads the town's activity at most once per ${ACTIVITY_TTL_MS / 1000} s for the current crossing and serves that answer until then, so an act can take up to about ${ACTIVITY_TTL_MS / 1000} s (plus that read's own duration) to light its house; a new crossing reads afresh, and a failed read is not kept`;

export const ACTIVITY_HISTORICAL =
  "activity isn't kept per crossing: the store keeps each resident's newest act only, so a past crossing's lights cannot be rebuilt — this read carries no lit state";

export const ACTIVITY_UNAVAILABLE =
  "household activity could not be read from the store just now, so no house's light is known on this answer — not because nobody was active";

/** Whether a house whose last act fell in `last` is lit at activity clock `clock`. null when either is unknown. */
export function litAt(last, clock) {
  if (!Number.isInteger(clock)) return null;
  if (last === undefined) return null;
  if (last === null) return false;
  const age = clock - last;
  return age >= 0 && age <= LIT_WINDOW;
}

/**
 * The fold, pure: membership + last-active → the digest's two maps.
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

/** Every house and its residents: the registry's houses, then the roll's residents of no house. */
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
 * The digest, on the caller's queryable `q`. `current: false` is a historical
 * read. `now` is the clock's instant (tests pin it).
 */
export async function householdActivity(q, { current = true, now = Date.now(), isEmeritus: emeritus = isEmeritus } = {}) {
  if (!current) return { clock: null, households: null, house_of: null, historical: true, note: ACTIVITY_HISTORICAL };
  const clock = currentCrossing(now);
  const registry = registryFromRows(await registryRowsVia(q));
  const roll = (await q.query(ROLL_SQL)).rows.map((r) => r.handle);
  const houses = housesOf(registry, roll);
  const found = await lastActiveFor(q, [...houses.values()].flat());
  return { clock, window: LIT_WINDOW, ...foldHouseholds({ houses, found, isEmeritus: emeritus }), means: ACTIVITY_MEANS };
}

// ── THE CURRENT ANSWER, SHARED (WLD-29 independent review, b) ─────────────────
//
// The batch reads the town's whole membership and every resident's newest act;
// it grows with history and borrows a pen connection (Wright's measurement:
// p50 56 ms at 20k acts, 80 ms at 60k — his, not this file's). So ONE answer per
// store, per activity clock C, is shared for ACTIVITY_TTL_MS:
//   · keyed by the STORE the read goes to (`backend`: the office's own store, or
//     an injected one), never by a caller's closure — so both apex paths and the
//     eyes door share it, and an injected test store never meets another's;
//   · keyed by C, and only the current C is kept: a new crossing reads afresh,
//     and a reply for an older C cannot land in the newer C's slot;
//   · single-flight: concurrent misses wait on the one batch in flight;
//   · a FAILURE IS NOT KEPT: the read that failed answers "unavailable", and the
//     next read asks the store again — an outage never sticks as darkness;
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
  byClock.set(clock, entry);
  return entry.promise;
}

/**
 * The digest for a door. A current read is served from the shared answer for
 * its store and clock (above), read with ONE store round of its own when it
 * must be read — the compatibility path holds no store connection. `backend`
 * names the store: the office's own by default; a caller with an injected
 * store passes that store. A failure is disclosed, never thrown and never
 * filled from anywhere else.
 */
export async function readHouseholdActivity({ current = true, env = process.env, read = null, backend = null, now = Date.now() } = {}) {
  if (!current) return householdActivity(null, { current: false });
  const clock = currentCrossing(now);
  const store = backend ?? `store:${env.WORLD2_PG_URL ?? ""}`;
  try {
    const value = await sharedActivity(store, clock, now, async () => {
      if (read) return read((q) => householdActivity(q, { now }));
      const { officeRead } = await import("./world2-pen.mjs");
      return officeRead((c) => householdActivity(c, { now }), { env, by: "householdActivity" });
    });
    return structuredClone(value);
  } catch {
    return { clock, households: null, house_of: null, unavailable: ACTIVITY_UNAVAILABLE };
  }
}

/** Whether a read is of the current crossing: no crossing asked, or the one it is now. */
export function isCurrentRead(asked, now = Date.now()) {
  if (asked == null || asked === "") return true;
  const n = Math.floor(Number(asked));
  return !Number.isFinite(n) || n === currentCrossing(now);
}
