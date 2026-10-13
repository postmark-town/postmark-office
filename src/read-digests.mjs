// read-digests.mjs — THE MIDDLE A READ CARRIES (WLD-29): what a page needs that
// is not a mark in reach, as metadata beside the read's own records.
//
// `records` is the read's spatial whole: the marks the answer names, plus the
// town's ground. A class mark has no place, so it was never nearby, and the
// viewer's walk pace (`the-town/resident`'s `dials.pace_km_per_crossing`) was
// smuggled into `records` by name, twice (world.mjs § markRecords, world2-serve
// § world2Apex). The DIALS DIGEST replaces both: every published mark that
// carries dials, id → its dials, and nothing else of the record — no body, no
// actor, no claim. A reader that needs a number reads it here; `records` goes
// back to being what the answer names.
//
// The household activity digest (porch lights) is household-activity.mjs's.

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

/** What a reader is told the digest is. */
export const DIALS_MEANS =
  "every published mark that carries dials, by id → its dials (frontmatter), whether or not it is in this read's records; a class's dials are law (a walk's pace is the-town/resident's pace_km_per_crossing)";
