// holding-law.mjs — WHO MAY MAKE, AND WHAT HOLDS: four properties read from the
// class tree (LOGOS v2 part 2, lane O1).
//
// The law (world #229 + #230, LOGOS/classes.md):
//
//   makers   "Who may make an instance is the class's `makers` property … a
//            constitution true/false, inherited down `extends`. The root,
//            `postmark-node`, answers false … It replaces the hand-kept
//            `RESIDENT_INSTANTIABLE` whitelist." (ruled 16:02, shaped 18:44)
//   holder   "A holder is anything with `holder: true` … a true/false property
//            with two child properties: `capacity`, how many it can hold, and
//            `open`, whether other households may give and take." (16:03–16:05)
//   resident "`holder: true` and `capacity: 24`, both constitution and locked."
//   thing    "`holder` is sovereign, default false … When it is true, `capacity`
//            (sovereign, default 30, constitution children min 1 / max 120) and
//            `open` (sovereign, default true) apply."
//
// So a class answers through its lineage (world-classes § classProperty, nearest
// first), and an instance may say its own value only where the property's tier
// is `sovereign`: "The constitution properties are the town's, and no instance
// writes them" (classes.md § What an instance writes). Nothing here is a copy of
// a number. A property no class in the lineage states answers its ruled
// default only where the law names one here (the root's `makers: false`).

/** A record's true/false, in either spelling a frontmatter parser leaves it. */
export const truth = (v) => (v === true || v === "true" ? true : v === false || v === "false" ? false : null);
/** A record's whole number, or null. */
export const whole = (v) => {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  return typeof n === "number" && Number.isInteger(n) ? n : null;
};

/** A record's list of mark ids (an array, or its JSON spelling), or null. */
export const idList = (v) => {
  let a = v;
  if (typeof a === "string" && a.trim().startsWith("[")) { try { a = JSON.parse(a); } catch { return null; } }
  return Array.isArray(a) && a.every((x) => typeof x === "string" && x !== "") ? a.map(String) : null;
};

/**
 * May a resident make an instance of this class? `classProperty` is the
 * class layer's reader (world-classes § classProperty). An unread `makers`
 * anywhere in the lineage answers false, the root's own answer (G2, settled
 * 2026-10-17: no floor, no hand list).
 */
export function makersOf(className, classProperty) {
  const p = className == null ? null : classProperty(String(className), "makers");
  const v = truth(p?.value);
  return { may: v === true, from: p?.from ?? null, source: p?.source ?? null, read: p != null };
}

/**
 * What a mark (or a class, given `mark: null`) holds by law: `{ holder,
 * capacity, min, max, open, from }`. The instance's own field counts only
 * where the property's tier is sovereign. `legacy` is the caller's older
 * spelling of the same numbers (the chest dials, the thing class's
 * carry_cap), read SECOND, after every property in the lineage: G4, settled
 * 2026-10-17, property first and dial second.
 */
export function holdingOf({ mark = null, className, classProperty, legacy = {} }) {
  const read = (prop) => classProperty(String(className), prop);
  const own = (prop, p) => (mark && p?.tier === "sovereign" && mark[prop] !== undefined ? mark[prop] : undefined);
  const h = read("holder");
  const holder = truth(own("holder", h) ?? h?.value) ?? (legacy.holder === true ? true : false);
  const c = read("capacity");
  const min = whole(c?.children?.min?.value) ?? whole(legacy.capacity_min);
  const max = whole(c?.children?.max?.value) ?? whole(legacy.capacity_max);
  const ownCap = own("capacity", c);
  // AN OWN CAPACITY OUTSIDE ITS BOUNDS IS REFUSED, never clamped (review-606):
  // a Candy Bag asking 500 beside its max 200 holds no number here, and says
  // why, so no reader can act on a capacity the law does not allow.
  const asked = whole(ownCap);
  const outside = asked != null && ((min != null && asked < min) || (max != null && asked > max));
  const capacity = outside ? null : asked ?? whole(c?.value) ?? whole(legacy.capacity);
  const o = read("open");
  const open = truth(own("open", o) ?? o?.value) ?? (legacy.open === undefined ? null : legacy.open === true);
  // WHAT IT TAKES IN, AND WHETHER IT KEEPS IT (WLD-5 B): `accepts`, the ids it takes,
  // null for anything its room allows; `keeps`, nothing comes back out. Both
  // sovereign, read from the law like `open`: a law without them reads as before.
  const a = read("accepts");
  const accepts = idList(own("accepts", a) ?? a?.value);
  const k = read("keeps");
  const keeps = truth(own("keeps", k) ?? k?.value) === true;
  return {
    holder, capacity, min, max, open, accepts, keeps,
    ...(outside ? { capacity_refused: `a capacity of ${asked} is outside ${min ?? "…"}..${max ?? "…"}, the bounds its class sets` } : {}),
    capacity_said_by: ownCap !== undefined ? "the mark" : c ? c.from : legacy.capacity !== undefined ? "the older dial" : null,
    from: { holder: h?.from ?? null, capacity: c?.from ?? null, open: o?.from ?? null },
    source: { holder: h?.source ?? null, capacity: c?.source ?? null, open: o?.source ?? null },
  };
}
