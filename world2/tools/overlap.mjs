// overlap.mjs — what "overlaps" means for two pieces of ground, in SQL (POS-595).
//
// The clearing's question, lifted out of clearing-job.mjs so a second reader can
// ask it without a second copy. The clearing is a script that connects and runs
// at import, so nothing can import it for a constant; tools/dev-rehearsal.mjs's
// free-ground search needs the very predicate the candle will judge its claims
// by, so it reads it here. One question, one owner.
//
// bbox overlap: the same operator the marks exclusion constraint
// (`parcels_do_not_overlap`) uses, so the clearing and the constraint can never
// disagree about "overlaps". `&&` on two boxes is inclusive: boxes that share
// only an edge overlap.
//
// Imports nothing: the clearing and the rehearsal both read this one line, with
// their two boxes named `a` and `b`.

export const OVERLAP = "a.bbox && b.bbox";
