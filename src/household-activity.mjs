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

export const ACTIVITY_MEANS =
  `a house is lit when its newest act falls in the activity clock's crossing or the one before (C or C-1). An act is ${LAST_ACTIVE_MEANS}. A house's crossing is the newest over its residents who are not emeritus; null: none of them has an act on record`;

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

/**
 * The digest for a door, with ONE store read of its own (the compatibility
 * path holds no store connection). A failure is disclosed, never thrown and
 * never filled from anywhere else.
 */
export async function readHouseholdActivity({ current = true, env = process.env, read = null, now = Date.now() } = {}) {
  if (!current) return householdActivity(null, { current: false });
  try {
    if (read) return await read((q) => householdActivity(q, { now }));
    const { officeRead } = await import("./world2-pen.mjs");
    return await officeRead((c) => householdActivity(c, { now }), { env, by: "householdActivity" });
  } catch {
    return { clock: currentCrossing(now), households: null, house_of: null, unavailable: ACTIVITY_UNAVAILABLE };
  }
}

/** Whether a read is of the current crossing: no crossing asked, or the one it is now. */
export function isCurrentRead(asked, now = Date.now()) {
  if (asked == null || asked === "") return true;
  const n = Math.floor(Number(asked));
  return !Number.isFinite(n) || n === currentCrossing(now);
}
