// creature-sight.mjs — a creature in a dungeon room exists only for those who entered that room.
//
// RULED (Darko, 2026-10-26 13:34–13:44 EDT, WLD-74): "hide the creatures entirely. The only
// instance where you see the creatures is if you are entered in the room that the creature is
// entered in also. That needs to be the logic for dungeons in general, always."
//
// THE ONE PREDICATE. A creature with a `room` (creatures.mjs § warmRooms: the dungeon room it
// stands in) perceives a resident, and is perceived by them, only when that resident's
// occupancy stack (the enter ledger, world.mjs § occupancyNowAll: the one fold sight reads)
// holds that room's id. For anyone else it does not exist: not listed in a read, no reaction to
// their act, every verb refused as for an unknown creature, no tell, no place in its ring,
// roster, press, cost or pack. A creature with no room keeps the distance rule unchanged.
//
// HOW IT IS APPLIED. Geometry (ringHolds, seesCreature) still answers "within reach"; this
// answers "exists for you" BEFORE any of it runs: `sightedLiving` hands a resident's read or
// act a view of the living set with the unentered creatures left out, so every path downstream
// (find, who, matrix, verbs, the hook's ring, the encounter) sees no creature there, and none
// of them can forget to ask. The ledger is read once per read or act, never per creature.
// A ledger that cannot be read is nobody entered anywhere: the creatures stay hidden.

import { WORLD_CLONE } from "./world-store.mjs";

/** Has `stack` (a resident's entered marks) entered the room `creature` stands in? A creature without a room is everyone's. */
export function enteredBy(creature, stack) {
  const room = creature?.room;
  if (!room) return true;
  const id = typeof room === "string" ? room : room.id;
  if (id == null) return false; // a room we cannot name is a room nobody is known to have entered
  const entered = stack instanceof Set ? stack : new Set(Array.isArray(stack) ? stack : []);
  return entered.has(id);
}

let occupancySeam = null;
/** Test seam: `fn()` answers a Map<handle, [marks…]> (or null to read the ledger again). */
export function __setOccupancyForTest(fn) { occupancySeam = typeof fn === "function" ? fn : null; }

// THE LEDGER IS FOLDED ONCE A SECOND, NOT ONCE A CALL. One embodied read asks "who has entered what" from several places (the creature view, the labels,
// the presence filter, the ring); the answer is shared for OCCUPANCY_TTL_MS and by every caller in flight, and the enter and exit doors forget it the
// moment they write (world-crossings.mjs), so a resident who has just entered reads the room at once. The Map is shared: callers never change it.
export const OCCUPANCY_TTL_MS = 1000;
let memo = null; // { at, p }
export function forgetOccupancy() { memo = null; }
/** How many times the ledger has been folded since the process began (the load, measured). */
export const folds = { n: 0 };

/** Every resident's stack now: the enter ledger folded at the clock (shared for a second). An unreadable ledger is an empty Map. */
export async function occupancyAll() {
  if (occupancySeam) return Promise.resolve(occupancySeam()).then((m) => (m instanceof Map ? m : new Map())).catch(() => new Map());
  const now = Date.now();
  if (memo && now - memo.at < OCCUPANCY_TTL_MS) return memo.p;
  const mine = { at: Infinity, p: readOccupancy() }; // valid while it is being read; its second starts when it lands
  memo = mine;
  mine.p.then((m) => { if (memo !== mine) return; if (m.size) mine.at = Date.now(); else memo = null; }, () => { if (memo === mine) memo = null; }); // an empty or failed read is not kept
  return mine.p;
}
let readerSeam = null;
/** Test seam: `fn()` answers the Map the ledger fold would, so the sharing of it can be counted. */
export function __setOccupancyReaderForTest(fn) { readerSeam = typeof fn === "function" ? fn : null; }
async function readOccupancy() {
  folds.n += 1;
  if (readerSeam) return readerSeam();
  try {
    const [{ crossingLaw }, { crossingDeps }, { occupancyNowAll }] = await Promise.all([
      import("./world-crossings.mjs"), import("./world-apex.mjs"), import("./world.mjs")]);
    const law = await crossingLaw(WORLD_CLONE);
    return law?.thresholds ? await occupancyNowAll(law.thresholds, crossingDeps()) : new Map();
  } catch { return new Map(); }
}

/** Does the set hold any creature in a room? When none does, nobody needs the ledger. */
export const hasRoomed = (living) => { settleRooms(living); return !!living?.byId && [...living.byId.values()].some((c) => c.room || roomUnknown(c, living)); };

/**
 * A creature just out has no room looked up until the next tick, but the published marks are known (the last warm): place it in them now, so
 * that one standing inside a dungeon's extent is hidden at once and one outside every dungeon is seen from its first tick. Only a set that
 * has never been warmed (a boot before the first read of the marks) leaves a creature unplaced, and it is hidden.
 */
export function settleRooms(living) {
  if (living?.hideUnwarmed && living.lastMarks && typeof living.warmRooms === "function") living.warmRooms(living.lastMarks, living.lastKey);
}

/**
 * A creature whose room has not been looked up yet (LivingSet § warmRooms has not run for it: a boot, or a creature just out) under a law
 * that has rooms. It may stand inside a dungeon, and nothing yet says it does not, so it is hidden from everyone until its room is known
 * (WLD-74: zero means zero, the moment after a boot too). Outdoors it is seen again the moment its room reads null.
 */
export const roomUnknown = (c, living) => !!living?.hideUnwarmed && c?.room === undefined && c?.roomKey === undefined && typeof living?.law?.ringRoomOf === "function";

/**
 * `living` as `stack` may see it: a view whose creatures in a room the stack has not entered are
 * left out. The same set back when it holds none in a room. Folds, refreshes and prunes go to
 * the real set, so a verb's own rows still land in it.
 */
export function sightedLiving(living, stack) {
  if (!living?.byId || !hasRoomed(living)) return living; // (hasRoomed places the creatures just out)
  const seen = new Set(stack instanceof Set ? stack : Array.isArray(stack) ? stack : []);
  const byId = new Map([...living.byId].filter(([, c]) => !roomUnknown(c, living) && enteredBy(c, seen)));
  const view = Object.create(living);
  view.byId = byId;
  view.hidden = new Set([...living.byId.keys()].filter((id) => !byId.has(id))); // what this view leaves out (investigate says no creature of them too)
  for (const m of ["fold", "refresh", "prune", "warmRooms"]) if (typeof living[m] === "function") view[m] = (...a) => living[m](...a);
  return view;
}

/** `living` as `handle` may see it, reading the ledger once (and not at all when no creature is in a room). */
export async function sightedFor(living, handle, { occupancy = null } = {}) {
  if (!living?.byId || !hasRoomed(living)) return living;
  const all = occupancy ?? await occupancyAll();
  return sightedLiving(living, all.get(String(handle ?? "")) ?? []);
}

/** `cr` ({ living, law }, as a read or a door gets it) with `living` as `actor` may see it. */
export async function sightedCreatures(cr, actor) {
  if (!cr?.living) return cr;
  return { ...cr, living: await sightedFor(cr.living, actor) };
}

/** `point` carrying the entered stack of `handle` (from `occupancy`, a Map from occupancyAll), so ringHolds and seesCreature judge the resident's entry too. No map, no stack: the point as it was (the caller's creatures were already sighted for the actor). */
export function stackedAt(point, handle, occupancy) {
  if (!point || !(occupancy instanceof Map)) return point;
  return { ...point, stack: occupancy.get(String(handle ?? "")) ?? [] };
}

/** Every resident's stack now, read only when some creature in `living` stands in a room; else null (nothing to judge). */
export async function occupancyIfRoomed(living) {
  return hasRoomed(living) ? occupancyAll() : null;
}

/** What `handle` has entered now: their stack, read from the ledger once (empty when unreadable). */
export async function stackOf(handle) {
  return [...((await occupancyAll()).get(String(handle ?? "")) ?? [])];
}
