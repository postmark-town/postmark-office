// mark-footprint.mjs — the ruled footprint caps of a mark, judged at the writing doors (POS-1126, WLD-193).
//
// Darko, 2026-11-17: "yeah 256 is good" (a mark's 2D `points:` outline holds at most 256 points).
// Darko, 2026-11-18 09:28 EST: "Cap at 2 km a side" (a resident's mark on common ground is at most 2 km wide
// by 2 km deep; a parcel keeps its own extent dial). Wright's split: World owns the law, Rivet the writing doors.
//
// THE LAW'S NUMBERS ARE NOT HELD HERE. They are two direct property nodes of the class `mark` (Bevel, WLD-193,
// 2026-11-18: `outline-point-cap` = 256, `common-ground-side-cap` = 2000, metres per planar side), read through
// the existing law reader (world-classes.mjs § classDials, which follows the ingested-law settlement). A dial the
// law does not say is an absent boundary, as classDials' own contract has it: this file holds no default, so a
// fixture that changes a property changes the limit, and until the law publishes them nothing is refused.
//
// SCOPE. The point cap judges any ring a write carries. The side cap judges the footprint of a placed mark: its
// ring's box when it sends one, else its `extent`. Not judged: a parcel (its own dial), a spark (its frame is an
// event's room or circle, not ground it stands on), the town's own constitutional marks, and a mark that sends no
// footprint at all. 3D form geometry is a different representation and is not read here.
//
// EXISTING RECORDS STAY. An amendment may keep or shrink a footprint that already stands over a cap (nine published
// marks do, WLD-193's census), and is refused only when it carries MORE than the mark's current declaration did on
// the measure that is over: no resizing is asked of anyone, and nothing grows past the law.
//
// Pure: no I/O. world.mjs § footprintGate wires it in; the caps and the prior are its arguments.

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
 * `footprintCaps(...)`; `prior` the mark's current declaration when this is an amendment (its footprint is the most
 * the amendment may keep); `sideScope` false exempts the side cap (a parcel, a spark, the town's own mark).
 * `{ code: 422, defect, hint }`, the door's own grammar.
 */
export function footprintRefusal(clean, { caps, prior = null, sideScope = true } = {}) {
  const n = pointCount(clean?.points);
  if (caps?.points != null && n != null && n > caps.points) {
    const was = prior ? pointCount(prior.points) : null;
    if (!(was != null && n <= was))
      return { code: 422, defect: `an outline holds at most ${caps.points} points; this one has ${n}`,
        hint: `the town's law (${FOOTPRINT_PROPERTIES.points} on the mark class) caps a mark's 2D map-footprint outline at ${caps.points} points; it is not a limit on 3D geometry. Smooth shapes need 50 to 100. Nothing was written.` };
  }
  if (caps?.side != null && sideScope) {
    const now = sidesOf(clean);
    const was = prior ? sidesOf(prior) : null;
    if (now) {
      for (const [axis, word] of [["w", "wide"], ["h", "deep"]]) {
        if (now[axis] > caps.side && !(was && now[axis] <= was[axis]))
          return { code: 422, defect: `a mark on common ground is at most ${metres(caps.side)} a side; this one is ${metres(now[axis])} ${word}`,
            hint: `the town's law (${FOOTPRINT_PROPERTIES.side} on the mark class) caps a resident's mark at ${caps.side} m wide by ${caps.side} m deep; a parcel keeps its own extent. Nothing was written.` };
      }
    }
  }
  return null;
}
