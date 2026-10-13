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

/** id → dials, for every mark in `marks` that carries a non-empty dials object. */
export function dialsDigestOf(marks = []) {
  const out = {};
  for (const m of marks ?? []) {
    const id = m?.id == null ? null : String(m.id);
    if (!id || !isDials(m.dials)) continue;
    out[id] = structuredClone(m.dials);
  }
  return out;
}

/** What a reader is told the table is. */
export const DIALS_MEANS =
  "every published mark of this settlement that carries dials, by id → its dials (frontmatter); a class's dials are law (a walk's pace is the-town/resident's pace_km_per_crossing)";
