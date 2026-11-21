// WHAT A PLACEMENT TOUCHES — the two lists beside the parent a placement already names (POS-1156).
//
// `leave-mark` answers with `parent` (where the mark nests: the fold's own
// containment rule, § nestingParent). Darko (CORE-124, 2026-11-19) wanted the agent
// told, in the same turn and with no confirmation step, what else the mark lands
// among. This adds the two missing lists and nothing else:
//
//   overlaps — every other placed mark that shares ground with the candidate, by the
//              ENGINE's own overlap predicate (`marksOverlapArea(candidate, m) > 0`,
//              the one consent uses: regular pairs analytic, rings by shared
//              coverage cells). It is the predicate's result, literally: a mark
//              that wholly covers the candidate (its parent among them) and a mark
//              the candidate wholly covers both share ground, so both appear.
//              Edge contact is not overlap (area 0). Your own marks are included.
//   contains — the marks that would become the candidate's CHILDREN, by the fold's
//              own containment rule: those whose tightest container, asked of the
//              same marks plus the candidate (`containmentParentOf`), is the
//              candidate. Not a geometry rule of ours: a mark held by something
//              tighter than the candidate is NOT listed.
//
// One computation over the one normalized mark set the placement judged (canon plus
// the household's live drafts, the candidate's own old row out, a duplicate id
// resolved to the later row). A row is `{ id, name, household }`: ordinary public
// mark metadata, no body and no private human. `names`/`households` are injected so
// both writers and the tests use the same projection. The lists are complete: no cutoff.
//
// NOT READ is not EMPTY: when the engine cannot answer (an older clone without the
// predicates) the function returns null and the door says nothing rather than print
// two empty lists that read as "touches nothing".

const rectOf = (m) => ({ x: m.at?.x ?? 0, y: m.at?.y ?? 0, w: m.extent?.w ?? 1, h: m.extent?.h ?? 1 });
// A closed-interval bounding-box test: a cheap prefilter that can only let too many
// through (the predicates decide), never too few.
const boxesTouch = (a, b) =>
  Math.abs(a.x - b.x) <= (a.w + b.w) / 2 && Math.abs(a.y - b.y) <= (a.h + b.h) / 2;
/**
 * @param candidate  the declaration being placed ({ id, at, extent, points?, … })
 * @param marks      the set the placement judged (may hold the candidate's old row)
 * @param deps       { marksOverlapArea, containmentParentOf, worldRootOf?, name(m), household(m) }
 * @returns { overlaps, contains } or null (unread / not placed)
 */
export function placementRelations(candidate, marks, deps = {}) {
  const { marksOverlapArea, containmentParentOf, worldRootOf, name, household } = deps;
  if (typeof marksOverlapArea !== "function" || typeof containmentParentOf !== "function") return null;
  if (!candidate?.at) return null;
  const root = typeof worldRootOf === "function" ? worldRootOf(marks ?? []) : null;
  // the normalized set: the candidate's own row (an amend's old row) out, a repeated id once (the later row)
  const byId = new Map();
  for (const m of marks ?? []) if (m && m.id != null && m.id !== candidate.id && !m._error) byId.set(m.id, m);
  const others = [...byId.values()];
  const box = rectOf(candidate);
  const cArea = box.w * box.h;
  const row = (m) => ({ id: m.id, name: typeof name === "function" ? name(m) : null, household: typeof household === "function" ? household(m) : null });

  const overlaps = [], contains = [];
  const all = [...others, candidate];
  for (const m of others) {
    if (!m.at || (root && m.id === root.id)) continue; // the world frame is the frame, never a neighbour
    const mb = rectOf(m);
    if (!boxesTouch(box, mb)) continue;
    if (marksOverlapArea(candidate, m) > 0) overlaps.push(row(m));
    if (mb.w * mb.h < cArea && containmentParentOf(m, all) === candidate.id) contains.push(row(m));
  }
  const byName = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  overlaps.sort(byName); contains.sort(byName);
  return { overlaps, contains };
}
