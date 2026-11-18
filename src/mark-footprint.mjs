// mark-footprint.mjs — the ruled footprint caps of a mark, judged at the writing doors (POS-1126, WLD-193).
//
// Darko, 2026-11-17: "yeah 256 is good" (a mark's 2D `points:` outline holds at most 256 points).
// Darko, 2026-11-18 09:28 EST: "Cap at 2 km a side", then, once the census showed nine published marks over it, 13:5x EST:
// "What are the marks? Set the max to whatever allows them." (Wright 18:58Z: 16000 m a side, strict refusal over it, no
// grandfathering.) A resident's mark on common ground is at most that wide by that deep; a parcel keeps its own extent
// dial. Wright's split: World owns the law, Rivet the writing doors.
//
// THE LAW'S NUMBERS ARE NOT HELD HERE. They are two direct property nodes of the class `mark` (Bevel, WLD-193,
// 2026-11-18: `outline-point-cap` = 256, `common-ground-side-cap` = 16000, metres per planar side), read through
// the existing law reader (world-classes.mjs § classDials, which follows the ingested-law settlement). A dial the
// law does not say is an absent boundary, as classDials' own contract has it: this file holds no default, so a
// fixture that changes a property changes the limit, and until the law publishes them nothing is refused.
//
// SCOPE. The point cap judges any ring a write carries. The side cap judges the footprint of a resident's placed
// mark standing on common ground (not the household's own parcel ground, by the door's own ground verdict,
// world.mjs § groundMinimumStake): its ring's box when it sends one, else its `extent`. Not judged: a parcel (its
// own dial), a spark, an unplaced mark, a mark on its household's own parcel, and a CONSTITUTION mark (an existing
// record whose tier is `constitution`: the town's own five; world.mjs § footprintGate asks the canon). 3D form geometry
// is not read here.
//
// A write is judged on what it carries, a leave and an amendment alike. Records already published are not rewritten
// by this door (no resizing is asked of anyone); an amendment that carries a footprint over a cap is refused like any other,
// with no allowance for what it was before (every published resident mark fits the side cap as ruled).
//
// Pure: no I/O. world.mjs § footprintGate wires it in and decides whether the side cap's scope holds (sideScope).

import { ringBox } from "./ring-box.mjs";

export const FOOTPRINT_PROPERTIES = Object.freeze({ points: "outline-point-cap", side: "common-ground-side-cap" });

const positive = (v) => { const n = Number(v); return v !== undefined && v !== null && String(v).trim() !== "" && Number.isFinite(n) && n > 0 ? n : null; };

/** The two caps from a class's dials (`classDials("mark")`): `{ points, side }`, each a positive number or null (no such law). */
export function footprintCaps(dials) {
  return { points: positive(dials?.[FOOTPRINT_PROPERTIES.points]), side: positive(dials?.[FOOTPRINT_PROPERTIES.side]) };
}

/** How many points an outline carries: an array's length, or a "x1,y1 x2,y2 …" string's pairs. Null for no outline. */
export function pointCount(points) {
  if (Array.isArray(points)) return points.length;
  if (typeof points === "string" && points.trim()) return points.trim().split(/\s+/).length;
  return null;
}

/** A mark's planar footprint `{ w, h }` in metres: its ring's box when it has a ring, else its `extent`; null when it has none. */
export function sidesOf(mark) {
  const box = ringBox(mark?.points);
  const e = box?.extent ?? mark?.extent;
  const w = Number(e?.w), h = Number(e?.h);
  return Number.isFinite(w) && Number.isFinite(h) ? { w, h } : null;
}

const metres = (n) => `${Math.round(n * 100) / 100} m`;

/**
 * The refusal for a declaration over a cap, or null. `clean` is the declaration (points, extent); `caps` is
 * `footprintCaps(...)`; `sideScope` false exempts the side cap (see SCOPE above).
 * `{ code: 422, defect, hint }`, the door's own grammar.
 */
export function footprintRefusal(clean, { caps, sideScope = true } = {}) {
  const n = pointCount(clean?.points);
  if (caps?.points != null && n != null && n > caps.points) {
    return { code: 422, defect: `an outline holds at most ${caps.points} points; this one has ${n}`,
      hint: `the town's law (${FOOTPRINT_PROPERTIES.points} on the mark class) caps a mark's 2D map-footprint outline at ${caps.points} points; it is not a limit on 3D geometry. Smooth shapes need 50 to 100. Nothing was written.` };
  }
  if (caps?.side != null && sideScope) {
    const now = sidesOf(clean);
    if (now) {
      for (const [axis, word] of [["w", "wide"], ["h", "deep"]]) {
        if (now[axis] > caps.side)
          return { code: 422, defect: `a mark on common ground is at most ${metres(caps.side)} a side; this one is ${metres(now[axis])} ${word}`,
            hint: `the town's law (${FOOTPRINT_PROPERTIES.side} on the mark class) caps a resident's mark at ${caps.side} m wide by ${caps.side} m deep; a parcel keeps its own extent. Nothing was written.` };
      }
    }
  }
  return null;
}
