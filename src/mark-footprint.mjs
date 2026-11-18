// mark-footprint.mjs — the ruled outline cap of a mark, judged at the writing doors (POS-1126, WLD-193).
//
// Darko, 2026-11-17: "yeah 256 is good" (a mark's 2D `points:` outline holds at most 256 points).
//
// NO SIZE CAP. Darko, 2026-11-18 14:42 EST: "I'm actually just going to err on not having a cap for now, with just the fact that the
// town can declare opposed on any mark that's like, you know, obnoxious or obstructive intentionally ... at the town's discretion until
// there are enough cases where we can publish some kind of guideline." Wright: "POS-1126's door now refuses only an outline over 256
// points. There's no size refusal." This door judges how many points an outline carries and never how large the mark is: not a
// resident's, not a constitution mark's, not a parcel's.
//
// THE LAW'S NUMBER IS NOT HELD HERE. It is a direct property node of the class `mark` (Bevel, WLD-193, 2026-11-18:
// `outline-point-cap` = 256), read through the existing law reader (world-classes.mjs § classDials, which follows the ingested-law
// settlement). A dial the law does not say is an absent boundary, as classDials' own contract has it: this file holds no default, so a
// fixture that changes the property changes the limit, and until the law publishes it nothing is refused.
//
// The cap judges any ring a write carries, a leave and an amendment alike, a parcel's and a constitution mark's included. 3D form
// geometry is a different representation and is not read here.
//
// Pure: no I/O. world.mjs § footprintGate wires it in.

export const FOOTPRINT_PROPERTIES = Object.freeze({ points: "outline-point-cap" });

const positive = (v) => { const n = Number(v); return v !== undefined && v !== null && String(v).trim() !== "" && Number.isFinite(n) && n > 0 ? n : null; };

/** The cap from a class's dials (`classDials("mark")`): `{ points }`, a positive number or null (no such law). */
export function footprintCaps(dials) {
  return { points: positive(dials?.[FOOTPRINT_PROPERTIES.points]) };
}

/** How many points an outline carries: an array's length, or a "x1,y1 x2,y2 …" string's pairs. Null for no outline. */
export function pointCount(points) {
  if (Array.isArray(points)) return points.length;
  if (typeof points === "string" && points.trim()) return points.trim().split(/\s+/).length;
  return null;
}

/**
 * The refusal for a declaration whose outline is over the cap, or null. `clean` is the declaration (points); `caps` is
 * `footprintCaps(...)`. `{ code: 422, defect, hint }`, the door's own grammar.
 */
export function footprintRefusal(clean, { caps } = {}) {
  const n = pointCount(clean?.points);
  if (caps?.points != null && n != null && n > caps.points)
    return { code: 422, defect: `an outline holds at most ${caps.points} points; this one has ${n}`,
      hint: `the town's law (${FOOTPRINT_PROPERTIES.points} on the mark class) caps a mark's 2D map-footprint outline at ${caps.points} points; it is not a limit on 3D geometry, and none on size. Smooth shapes need 50 to 100. Nothing was written.` };
  return null;
}
