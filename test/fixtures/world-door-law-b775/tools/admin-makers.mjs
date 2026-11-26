// admin-makers.mjs — WHO ELSE MAY MAKE THE PASSAGE CLASSES: an admin household
// (WLD-21; Darko 2026-10-18 19:38, 19:51, 19:52, and 21:23 on the gap read's
// G1–G6). LOGOS/classes.md § Admin households carries the law in words.
//
// The law: a household is an admin household when the GitHub account it is
// tied to (an account in the household's own registry entry, never a
// resident's pin) owns the postmark-town organisation. An admin household may
// make instances of exactly three classes whose `makers` answers false:
// dungeon, stairs and portal-ground. The classes themselves and not what
// extends them (G2), so `arena` and `vehicle`, which extend portal-ground, stay
// the town's, and so does any class that someday extends one of the three.
//
// ONE RECORD, AND THIS IS NOT IT. Whether a household is admin is the office's
// role registry (office_roles, role `admin`), refreshed from GitHub at each
// settlement; no gate asks GitHub itself. The World reads it as the record's
// printout: WORLD/households.json § admins, written by the office's
// world-households-export.mjs beside `households` and `logins`, every
// settlement. This module owns only the three class names and the one check,
// and the office imports it through its pinned world clone, so the names live
// in one place.

import { propertyOf } from "./class-properties.mjs";

/** The passage classes admin unlocks, by exact class name (G2: no subclass). */
export const ADMIN_CLASSES = Object.freeze(["dungeon", "stairs", "portal-ground"]);

/** Is this exactly one of the classes an admin household may make? */
export const isAdminClass = (klass) => klass != null && ADMIN_CLASSES.includes(String(klass));

/** The admin households a registry names (WORLD/households.json § admins), as household keys. Absent is none. */
export function adminsOf(registry) {
  const a = registry?.admins;
  return new Set(Array.isArray(a) ? a.map(String) : []);
}

/** The household a handle stands in, by the registry's own map; a handle it does not know is its own household. */
export const householdOf = (registry, handle) => registry?.households?.[handle] ?? `solo:${handle}`;

/**
 * May the resident `by` make an instance of `klass`? The class's `makers`
 * answers first (a constitution true/false inherited down `extends`); then,
 * for the three classes exactly, the resident's household's admin.
 * `marks` is the tree (or a class index) the class is read from.
 * Returns `{ may, via: "makers" | "admin" | null, household }`.
 */
export function mayMake({ klass, by, marks, registry }) {
  const household = householdOf(registry, by);
  if (propertyOf(marks, String(klass), "makers")?.value === true) return { may: true, via: "makers", household };
  if (isAdminClass(klass) && adminsOf(registry).has(household)) return { may: true, via: "admin", household };
  return { may: false, via: null, household };
}

/** The refusal's words, one sentence for every gate that reads this module. */
export const makersRefusal = (klass) =>
  `"${klass}" answers makers: false: it is the town's to make (the-town/nothing-you-control-mints)`
  + (isAdminClass(klass) ? `, and an admin household's (an owner of the postmark-town GitHub organisation; LOGOS/classes.md § Admin households)` : "");
