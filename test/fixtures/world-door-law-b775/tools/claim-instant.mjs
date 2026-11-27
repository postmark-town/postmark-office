// claim-instant.mjs — when a mark was FIRST laid, the one reading.
//
// Pure, zero imports, like geometry.mjs, so both marks-fold.mjs (the claim order,
// the cap's law date) and consent.mjs (a parcel's reach, seniority at contact)
// read the same instant without importing each other. marks-fold.mjs re-exports
// both names, so `engine.CLAIMED_AT_FIELD` and its readers are unchanged.
//
// ── THE FIRST CLAIM, NOT THE LATEST DATE (POS-364 review, 2026-10-08) ─────────
//
// Every leave and every amendment restamps a record's `date` (the office's door,
// and the store's materialize replaces the record's data on amend). Ordered by
// `date`, moving a held parcel would send it to the back of its household's
// claims: the parcel it was would lose its slot to one claimed after it, and a
// pre-law parcel moved today would count as post-law. A claim's place is when it
// was FIRST claimed. A record may carry that instant as `claimed_at` (the
// office's settlement fold reads it from the mark's origin claim; a tree record
// carries none, and its `date` is the only instant there is), and the claim
// order and the cap's law date both read it first.
//
// AN AMEND DOES NOT MAKE AN ELDER MARK YOUNG (Darko, 2026-10-07, POS-449). The
// same instant is a mark's AGE wherever the law asks who came first: a parcel's
// reach and the senior at contact (consent.mjs) read it, never the amended `date`.
export const CLAIMED_AT_FIELD = "claimed_at";
/** A record's claim instant: when it was first claimed if the record says, else its date. */
export const claimInstant = (mk) => mk?.[CLAIMED_AT_FIELD] ?? mk?.date;

// ── WHEN EACH CELL WAS FIRST COVERED (POS-571) ───────────────────────────────
//
// Seniority is per cell (LOGOS conflict-matrix § Roles from seniority, RULED
// 2026-10-04: "whoever first covered a cell is that cell's incumbent", and "an
// expansion is a newcomer on its new cells"). One instant cannot say that: a mark
// amended to cover new ground is an elder on the cells it always covered and a
// newcomer on the cells its amend added. A record may carry its FOOTPRINT HISTORY
// as `footprints`: every footprint it has stood on, from its origin claim through
// each amend that changed its geometry, each with the instant it was laid. Each
// entry is `{ since, at, extent, points? }`, in WORLD numbers whatever frame the
// tree's files are written in (WORLD/marks/SCHEMA.md § footprints): the file's own
// `at` is an offset from today's parent, and a past footprint has no parent to be
// an offset from. A record with no history keeps the one instant above for every
// cell it covers, exactly as before.
export const FOOTPRINTS_FIELD = "footprints";

const isPoint = (p) => p != null && Number.isFinite(p.x) && Number.isFinite(p.y);
const footprintsRead = new WeakMap();
/**
 * A record's footprint history, oldest first, as `[{ t, at, extent, points? }]`
 * (`t` the parsed instant), or null when it carries none. A history any entry of
 * which does not read whole (an instant that does not parse, no centre, no
 * positive extent) is read as no history at all: a history missing its origin
 * would date the mark's oldest cells by a later amend, so a partial one is never
 * guessed at. Memoized on the record, so each entry keeps one identity.
 */
export function footprintsOf(mk) {
  if (mk == null || typeof mk !== "object") return null;
  if (footprintsRead.has(mk)) return footprintsRead.get(mk);
  const raw = mk[FOOTPRINTS_FIELD];
  let out = null;
  if (Array.isArray(raw) && raw.length) {
    out = [];
    for (const e of raw) {
      const t = Date.parse(String(e?.since ?? ""));
      if (!Number.isFinite(t) || !isPoint(e.at) || !(e.extent?.w > 0 && e.extent?.h > 0)) { out = null; break; }
      out.push({ t, at: { x: e.at.x, y: e.at.y }, extent: { w: e.extent.w, h: e.extent.h }, ...(Array.isArray(e.points) ? { points: e.points } : {}) });
    }
    if (out) out.sort((a, b) => a.t - b.t);
  }
  footprintsRead.set(mk, out);
  return out;
}
