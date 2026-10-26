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

/** Every resident's entered stack now: the enter ledger folded at the clock, once. An unreadable ledger is an empty Map. */
export async function occupancyAll() {
  if (occupancySeam) return Promise.resolve(occupancySeam()).then((m) => (m instanceof Map ? m : new Map())).catch(() => new Map());
  try {
    const [{ crossingLaw }, { crossingDeps }, { occupancyNowAll }] = await Promise.all([
      import("./world-crossings.mjs"), import("./world-apex.mjs"), import("./world.mjs")]);
    const law = await crossingLaw(WORLD_CLONE);
    return law?.thresholds ? await occupancyNowAll(law.thresholds, crossingDeps()) : new Map();
  } catch { return new Map(); }
}

/** Does the set hold any creature in a room? When none does, nobody needs the ledger. */
export const hasRoomed = (living) => !!living?.byId && [...living.byId.values()].some((c) => c.room);

/**
 * `living` as `stack` may see it: a view whose creatures in a room the stack has not entered are
 * left out. The same set back when it holds none in a room. Folds, refreshes and prunes go to
 * the real set, so a verb's own rows still land in it.
 */
export function sightedLiving(living, stack) {
  if (!living?.byId || !hasRoomed(living)) return living;
  const seen = new Set(stack instanceof Set ? stack : Array.isArray(stack) ? stack : []);
  const byId = new Map([...living.byId].filter(([, c]) => enteredBy(c, seen)));
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
