// mark-declared-parent.mjs — A MARK THAT DECLARES ITS PARENT MUST STAND IN IT.
//
// ── THE LIVE CASE (postmark#3020, Linear POS-147) ────────────────────────────
//
// `current-the-reader/the-snug-mooring` is filed, by the 2026-08-25 freeze, at
//
//   WORLD/marks/let-there-be-light/the-doubled-coast/the-snug-harbour/the-snug-mooring/mark.md
//
// — inside the harbour, and the harbour's composed centre is (-350, 4978). Its
// owner's 2026-09-14T17:02Z amend carried the WORLD point (-358, 4972), which is
// exactly where the mooring stood; the file's own number was (-8, -6). The
// 2026-09-15T17:46Z crossing (world `3a3a645c`, BEFORE the 2026-09-18 framer)
// wrote the world number raw into the relative file, the fold composed it
// against the harbour, and the mooring resolved to (-708, 9950) — five
// kilometres out to sea, where it stayed through S71, S72 and S73, and where
// three placements lost it as their parent.
//
// The 2026-09-18 framer (postmark#2865, the Berthillon carriage) closed the raw
// write. It did not close the second half, and the second half is this file:
// the framer converts whatever world point it is handed, faithfully. Hand it a
// point five kilometres from the declared parent and it writes a file that says
// "in the harbour" over a geometry that says "at sea". The conversion is not
// wrong; the input is, and nobody was asking.
//
// ── THE RULING (Keemin, 2026-09-20, verbatim) ────────────────────────────────
//
//   "1) absolute coords are what it takes (the written schema is correct, the
//    current behavior is wrong)
//    2) if marks DECLARE their parent, refuse at that lands outside the parent.
//    If they DON'T, dont, and parent just gets computed by geometry (which is
//    the way it should be)"
//
// (1) is already true and has been since 2026-09-18 — `at` at the door is
// absolute, the file is frame-relative, and the carriage converts once. This
// module is (2), and only (2).
//
// ── WHAT "DECLARE" MEANS HERE, AND WHY IT IS NOT A NEW FIELD ─────────────────
//
// A mark never authors a `parent` — `leave-exec.mjs` ~313 says it outright: "a
// sited/parcel mark never authors a parent (geometry decides)". What an EXISTING
// mark has instead is a FROZEN FILING PATH, and the path is where containment is
// declared: `WORLD/filing-freeze.json` is the manifest, minted once on
// 2026-08-25 and never regenerated, and the fold composes a nested file against
// the mark that owns its parent directory. So:
//
//   · a mark WITH a frozen path under another mark DECLARES that mark as its
//     parent, and an `at` outside it is refused;
//   · a mark with NO frozen path is a create — Gate B files it root-framed at
//     `WORLD/marks/<by>/<slug>/` and geometry places it, untouched by this;
//   · a mark whose path-parent is the WORLD ROOT declares nothing but the world,
//     and is likewise untouched. The root is the frame, not a parent.
//
// That is the ruling's second sentence, already true, left exactly as it is.
//
// ── ONE PREDICATE, ONE WORD, ONE SENTENCE ────────────────────────────────────
//
// Two doors have to agree or the resident hears one answer at the door and a
// different one at the crossing:
//
//   · `src/world.mjs § journalLeaveMark` — the amend branch, so the owner is
//     told at once, in the same breath as the move guard;
//   · `src/store-writedown.mjs` — the framing block, so a row that reached the
//     journal some other way is set aside at the crossing rather than written.
//
// Neither computes containment itself. Both hand THIS module the clone's own
// `pointWithinMark` (tools/world-verbs.mjs — the same function the enter door
// adjudicates with and `leavingWhileOccupying` walks with) and the parent as the
// last fold composed it. One derivation, two doors; the refusal word and the
// sentence are minted here so they cannot drift apart.

/** THE WORD. Both doors refuse under it; nothing else in the office uses it. */
export const OUTSIDE_DECLARED_PARENT = "mark-outside-declared-parent";

const norm = (p) => String(p ?? "").replace(/\\/g, "/");

/**
 * The fossil manifest, inverted: `WORLD/…/<slug>/mark.md` → `<by>/<slug>`.
 *
 * `frozenFilingAt` is keyed id → file and the walk needs it the other way. Done
 * here rather than twice, because the two doors reading the SAME manifest in two
 * slightly different ways is exactly how one of them ends up naming a parent the
 * other does not.
 */
export function idOfMarkFileFrom(frozen) {
  const out = new Map();
  for (const [id, file] of frozen) out.set(norm(file), id);
  return out;
}

/**
 * The parent a FILING PATH declares: the nearest enclosing mark, walking the
 * path's own directory ancestors against the inverted freeze manifest.
 *
 * `idOfMarkFile` is directory-file → id (`WORLD/…/<slug>/mark.md` → `<by>/<slug>`),
 * exactly what `frozenFilingAt` gives once inverted.
 *
 * THE FLOOR IS THE DRAIN'S FLOOR, deliberately. `world-drain.mjs § originForPath`
 * walks `depth > 3` and `settlement-sweep.mjs § enclosingMarkId` walks to the
 * same place; a guard that disagreed with the framer about what an ancestor IS
 * would refuse rows the framer frames correctly, or wave through rows it does
 * not.
 *
 * AND THAT FLOOR IS ALREADY THE RULING'S ROOT EXCLUSION, which is why there is
 * no second check for it here. Segments run WORLD / marks / <first> / …dirs… /
 * <slug> / mark.md, and `<first>` is the world root's own directory — it sits at
 * depth 3, so `depth > 3` never offers it as a parent. A mark filed directly
 * under the root therefore returns null by construction: it declares the FRAME,
 * not a parent, and every absolute number is already in the frame. An explicit
 * `dir === WORLD_ROOT_DIR` line beside the walk would be unreachable, and an
 * unreachable guard reads to the next person like a guarantee that is being
 * enforced when nothing is enforcing it.
 *
 * Returns null when the path is root-level, when no ancestor directory is a
 * mark the manifest names, or when there is no path at all (a create).
 */
export function declaredParentIdOf(markFile, idOfMarkFile) {
  const parts = norm(markFile).split("/");
  if (parts.length < 3) return null;
  for (let depth = parts.length - 2; depth > 3; depth--) {
    const id = idOfMarkFile.get(`${parts.slice(0, depth).join("/")}/mark.md`);
    if (id) return id;
  }
  return null;
}

/** Every world point a record puts on the ground: its centre, then its ring. */
function pointsOf({ at, points }) {
  const out = [];
  if (at && Number.isFinite(Number(at.x)) && Number.isFinite(Number(at.y)))
    out.push({ which: "at", point: { x: Number(at.x), y: Number(at.y) } });
  if (Array.isArray(points)) {
    points.forEach((p, i) => {
      const x = Number(Array.isArray(p) ? p[0] : p?.x);
      const y = Number(Array.isArray(p) ? p[1] : p?.y);
      if (Number.isFinite(x) && Number.isFinite(y)) out.push({ which: `points[${i}]`, point: { x, y } });
    });
  }
  return out;
}

/**
 * The parent's ground, said the way a resident can check it against a number.
 *
 * THIS IS PROSE, NOT ADJUDICATION. Nothing here decides anything: the verdict is
 * the injected `pointWithinMark`'s alone, and this only turns the parent into a
 * sentence a refused owner can act on. A ring is given as its bounding box and
 * SAID to be a bounding box, because a resident cannot check a number against a
 * twelve-point polygon in their head and a bbox they are told is a bbox does not
 * lie to them — whereas a bbox printed as if it were the shape would, on every
 * concave stretch.
 */
export function extentOf(parent) {
  if (Array.isArray(parent?.points) && parent.points.length >= 3) {
    const xs = parent.points.map((p) => Number(Array.isArray(p) ? p[0] : p?.x));
    const ys = parent.points.map((p) => Number(Array.isArray(p) ? p[1] : p?.y));
    return { shape: "ring", x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
  }
  // The fold's own `rect`: `at` is the CENTRE and `extent` the full width/height
  // (`tools/geometry.mjs:11`). Written out rather than imported because this
  // module stays pure — and because a wrong sentence here is a confusing refusal,
  // while a wrong predicate would be a wrong refusal, and the predicate is the
  // clone's.
  const x = Number(parent?.at?.x ?? 0), y = Number(parent?.at?.y ?? 0);
  const w = Number(parent?.extent?.w ?? 1), h = Number(parent?.extent?.h ?? 1);
  return { shape: "rect", x0: x - w / 2, x1: x + w / 2, y0: y - h / 2, y1: y + h / 2 };
}

const n = (v) => (Number.isInteger(v) ? String(v) : String(Number(v.toFixed(2))));
const pt = (p) => `(${n(p.x)}, ${n(p.y)})`;
export const extentText = (e) => (e.shape === "ring"
  ? `its drawn shape, bounded by x ${n(e.x0)}…${n(e.x1)}, y ${n(e.y0)}…${n(e.y1)}`
  : `x ${n(e.x0)}…${n(e.x1)}, y ${n(e.y0)}…${n(e.y1)}`);

/**
 * THE PREDICATE. Returns null to admit, or the finding to refuse on.
 *
 * `pointWithinMark` is the CLONE'S — `tools/world-verbs.mjs`, the same function
 * the enter door adjudicates with. It is injected rather than imported so that
 * the office cannot grow a second definition of "inside", which is the drift the
 * whole crossing seam exists to prevent.
 *
 * Returns null — admit — whenever the question cannot be ASKED: no declared
 * parent, no parent record, a parent with no ground of its own, no predicate, no
 * point. That is deliberate and it is the opposite of `dependentsOf`'s choice
 * next door: this guard adds a refusal to a path that works today, so an
 * unanswerable question must not become a refusal. The loud half is the
 * write-down's `mark-frame-unresolved`, which already refuses when the frame
 * itself cannot be resolved; this only ever speaks when it has a parent, a
 * shape, and a number.
 */
export function outsideDeclaredParent({ id, at, points, parentId, parent, pointWithinMark }) {
  if (!parentId || !parent || typeof pointWithinMark !== "function") return null;
  if (!parent.at && !Array.isArray(parent.points)) return null;      // no ground to be outside of
  for (const { which, point } of pointsOf({ at, points })) {
    if (pointWithinMark(point, parent) === true) continue;
    return { id, parentId, which, point, extent: extentOf(parent), parentAt: parent.at ?? null };
  }
  return null;
}

/** The write-down's sentence — the style of the three frame refusals beside it. */
export function outsideParentDetail(f, where) {
  return `${f.id} lands at the nested filing ${where} — whose path declares ${f.parentId} as its parent — `
    + `carrying \`${f.which}\` at world ${pt(f.point)}, which is OUTSIDE ${f.parentId} (${extentText(f.extent)}). `
    + "Framing it would write a file saying the mark is in its parent over a geometry saying it is not: the 2026-09-15 "
    + "Snug mooring (postmark#3020), which stood five kilometres out to sea through three settlements. The path and the "
    + "point disagree and the write-down may not pick — refusing this row rather than guessing which one the owner meant.";
}

/** The door's bounce — the same word, the same numbers, and the two ways out. */
export function outsideParentBounce(f) {
  return {
    code: 409,
    reason: OUTSIDE_DECLARED_PARENT,
    defect: `${pt(f.point)} is outside "${f.parentId}", and "${f.id}" is filed inside it`,
    hint: [
      `${f.parentId} covers ${extentText(f.extent)}${f.parentAt ? `, centred ${pt(f.parentAt)}` : ""}`,
      "A mark's filing declares its parent, and `at` is absolute — so an amend must stand where its filing says it stands",
      `Two ways on: amend to a point inside ${f.parentId}, or withdraw "${f.id}" and leave a new mark at ${pt(f.point)}, `
        + "which is filed at its own id and placed by geometry wherever that point really is",
    ].join(" · "),
    finding: f,
  };
}
