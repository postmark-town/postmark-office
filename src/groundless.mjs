// groundless.mjs — WHERE A RESIDENT WITH NO GROUND STANDS. One owner, six readers.
//
// ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
//
// The office held TWO deliberate answers to one question, 5,833 m apart, and
// served both in the same session.
//
//   the Origin (0,0)   — #2752, ruled 2026-09-13 ("can we just… call 0,0 the
//                        Origin?"), pinned in test/origin-name.test.mjs, read by
//                        `orient`, `eyes` and the apex through `homeCoords`.
//   the quay           — the engine's porch (`the-town/the-standing-porch`,
//     (1390, 5665)       world fd965b7c), read by `walk`, `presence` and `say`
//                        through `residentStandpoint` and `everyonePlaced`.
//
// So one call told kogane he stood at the Origin while the same session's walk
// line departed the Long Run harbour 6.5 km away (#2889, his first item, second
// half). RULED 2026-09-17 (the founder): "Agreed with the Origin." A groundless
// resident stands at the Origin, everywhere the office answers the question.
//
// This file is that "everywhere" made structural. It is the ONE place that says
// where a groundless resident stands and what a reader must be told about it;
// `homeCoords`, `residentStandpoint` and `everyonePlaced` each ask it rather
// than each holding a copy. A law with two holders is a law whose falsifiers go
// green at one holder while the other is still wrong — which is exactly how
// these two answers survived side by side for four days.
//
// ── WHAT THIS DOES NOT DO ───────────────────────────────────────────────────
//
// It does not change what the Origin IS — {0,0} and its words are moved here
// verbatim from src/world.mjs, byte for byte, and origin-name.test.mjs still
// holds them. It does not touch `the-town/the-standing-porch`, which remains a
// mark: a place someone can walk to, stand on and be found at. What it retires
// is the porch as a standpoint nobody chose — a default handed over in silence.
// And it never touches a resident WITH ground: the engine reads `parcel` for
// them and `walk` for a walker, and neither goes through here.
//
// PURE — no fs, no git, no engine import, so `positions.mjs` can hold its own
// stated purity law while asking this question.

// The Origin — {0,0}, where the ferry lands; the grid origin and the default
// standpoint. (Moved from src/world.mjs, where it had lived since before the
// naming; the value and the sentence are unchanged.)
export const ORIGIN = { x: 0, y: 0 };

// THE ENGINE'S DEFAULT, BY NAME. `tools/where-is.mjs § porchOf` answers
// `source: "quay"` for one class and one only: "a resident with no walk and no
// ground". A resident holding ground reads `parcel`; a walker reads `walk`;
// `src/world-movement.mjs` answers `timetable`, `frame`, `walk` or `store` and
// never this. So keying on it selects exactly the class the ruling names, on a
// declared field rather than by inference — which is the whole reason the
// engine declared it ("any caller that cared about the distinction can still
// make it, on a field rather than by inference").
export const PORCH_SOURCE = "quay";

// How we know, once the office has answered. `source` is provenance and must
// never be broader than what it claims (the engine's own rule): this resident
// is not on a parcel and has not walked — they are at the Origin because the
// record places them nowhere, and the field says so rather than borrowing a
// word that would make it look like a placement they earned.
export const GROUNDLESS_SOURCE = "origin";

// The disclosure, moved verbatim from src/world.mjs (#2889 box 1, kogane).
// Every field derived from a placeholder standpoint is the Origin's, and a
// reader who is not told that reads a stranger's neighbourhood as their own.
export const NO_GROUND_NEIGHBOURHOOD =
  "this standpoint is the Origin's default, not a place you stand: you hold no ground on the map. Everything in this answer derived from it — `within`, `region`, `standingOn`, `nearby`, `present` — is the ORIGIN's neighbourhood and not yours, and the residents it names are not your neighbours.";

/**
 * Is this the engine's groundless default? Takes anything carrying a `source`
 * — a `whereIs` answer or a `publicResidents` row — because both spell it the
 * same way and a second spelling is how the two answers drifted apart.
 */
export const isGroundlessDefault = (here) => here?.source === PORCH_SOURCE;

/**
 * THE GROUNDLESS STANDPOINT, in `residentStandpoint`'s own vocabulary.
 *
 * Placed, because a standpoint must be a point and the Origin is one — the
 * unplaced/NOWHERE distinction the engine draws is upstream of this and stays
 * exactly where it is. Not moving, not aboard, on no mark: the Origin is the
 * grid's corner, not a mark anyone can stand on, so `mark_id` is null rather
 * than borrowing the quay's.
 *
 * `placeholder` + `placeholder_note` ride the standpoint for the reason #2889
 * gave: the standpoint is the one object every derived field is computed from,
 * so one place says it and every door that carries a standpoint says it too.
 */
export function groundlessStandpoint(handle) {
  return {
    handle, x: ORIGIN.x, y: ORIGIN.y, placed: true, source: GROUNDLESS_SOURCE,
    moving: false, remaining_m: 0, narration: null, aboard: false, mark_id: null,
    placeholder: true, placeholder_note: NO_GROUND_NEIGHBOURHOOD,
  };
}

/**
 * THE SAME ANSWER IN A PRESENCE ROW'S VOCABULARY — `everyonePlaced`'s shape,
 * which is the engine's `publicResidents` row and not a standpoint.
 *
 * The row is REWRITTEN rather than rebuilt: whatever else the engine put on it
 * survives, and only the four fields that say where this resident is move. A
 * row built from scratch here would silently drop any field the engine adds
 * later, which is the quiet way a port becomes a fork.
 */
export function atOrigin(row) {
  return {
    ...row,
    x: ORIGIN.x, y: ORIGIN.y, source: GROUNDLESS_SOURCE, mark_id: null,
    placeholder: true, placeholder_note: NO_GROUND_NEIGHBOURHOOD,
  };
}
