// read-digests.mjs — THE DIALS A PAGE READS (WLD-29): GET /world/dials' table.
//
// A class mark has no place, so it is never nearby, and the viewer's walk pace
// (`the-town/resident`'s `dials.pace_km_per_crossing`) used to be smuggled into
// every read's `records` by name. Under the pointer model (Wright, AUTHORITY
// 2026-10-13T19:16:02.257Z) no default read carries a town-wide dial table:
// the page asks its own door, GET /world/dials (world.mjs § the page's two
// sources), for every published mark that carries dials, id → its dials, and
// nothing else of the record — no body, no actor, no claim.

const isDials = (d) => d && typeof d === "object" && !Array.isArray(d) && Object.keys(d).length > 0;

/**
 * id → dials, for every mark in `marks` that carries a non-empty dials object.
 *
 * A CLASS's dials are read through the class layer when one is handed in
 * (`classDialsOf(mark)`, world-classes.mjs § classDials, law-classes.mjs §
 * dialsOf): its top-level property nodes first, the class mark's old
 * frontmatter `dials:` second, the order every class reader uses. LOGOS v2 part 2 moves a class's dials into
 * `kind: property` nodes and empties the class node's `dials:` (the resident's
 * pace becomes resident-pace-km-per-crossing), so a frontmatter-only table
 * would lose the page's stride the day that law is blessed. Any other mark
 * keeps its own frontmatter. `isClass` says which marks are class nodes (the
 * office hands in world-grants.mjs § kindFieldOf, which reads both forms).
 */
export function dialsDigestOf(marks = [], { classDialsOf = null, isClass = (m) => m?.kind === "class" } = {}) {
  const out = {};
  for (const m of marks ?? []) {
    const id = m?.id == null ? null : String(m.id);
    if (!id) continue;
    const own = isDials(m.dials) ? m.dials : null;
    let layer = null;
    if (classDialsOf && isClass(m)) {
      try { layer = classDialsOf(m); } catch { layer = null; }
    }
    const dials = isDials(layer) ? { ...(own ?? {}), ...layer } : own;
    if (!isDials(dials)) continue;
    out[id] = structuredClone(dials);
  }
  return out;
}

/** What a reader is told the table is. */
export const DIALS_MEANS =
  "every published mark of this settlement that carries dials, by id → its dials: a class's from its class layer (its property nodes first, the class mark's old frontmatter dials: second), any other mark's from its own frontmatter. A class's dials are law (a walk's pace is the-town/resident's pace_km_per_crossing)";
