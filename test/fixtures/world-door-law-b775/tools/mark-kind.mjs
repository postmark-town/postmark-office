// mark-kind.mjs — WHAT A RECORD IS, AND HOW IT STANDS, IN EITHER FORM (LOGOS v2 part 2, W2).
//
// LOGOS/classes.md § The LOGOS ladder (ruled 2026-10-16 16:02): "`kind` is a
// flat field naming the node's own class … The `class:` field folds into
// `kind`: a class node's name is its own slug, so `kind: candy` names
// `the-town/candy`." A thing that wrote `kind: sited` + `class: thing` writes
// `kind: thing` now.
//
// Both forms are read, always: the old form is every store folded before the
// migration, every record a door wrote before its own readers moved, and every
// fixture. One home for the two questions every reader asks, so no reader
// spells either form out for itself:
//
//   instanceClassOf(m)  the class an instance names — its `class:` in the old
//                       form, its `kind:` in the new; undefined for a plain
//                       sited mark, a parcel, a predicate or a naming written
//                       with their standing word, and for class and property
//                       nodes (they ARE class space; their name is `class:`).
//   isSited(m)          it stands on the ground as a sited mark: it carries a
//                       place, and it is none of the kinds that never do. The
//                       lint holds every non-ground kind to no `at` (a
//                       predicate takes its parent's locus, a class or a
//                       property has no where, a post stands nowhere), so the
//                       place is the answer and no class tree is needed to ask.
//   isGround(m)         sited, or a parcel with its place: what can contain.
//
//   standingOf(m, idx)  how the record stands, asked of its CLASS CHAIN (G12,
//   isSitedIn(m, idx)   settled 2026-10-17: "the fold is the record"). The fold
//   isGroundIn(m, idx)  asks these, with the class index of the marks it folds
//                       (kindIndexOf), so its geometry follows the lineage even
//                       where a place and a chain disagree. isSited and isGround
//                       stay the place-proxy for readers with no class index
//                       (the viewer, the verbs over a store slice); they agree
//                       with the chain wherever the lint holds (G13).
//
// Browser-pure: the viewer and the store readers ask through it too.

import { classIndex, classChain } from "./class-properties.mjs";
import { CLAIMED_AT_FIELD, FOOTPRINTS_FIELD } from "./claim-instant.mjs";

/** The standing words `kind:` wrote before it named the class, and the node kinds. */
export const STANDING_WORDS = Object.freeze(new Set(["sited", "predicated", "predicate", "naming", "parcel", "class", "property", "post"]));

const NEVER_GROUND = new Set(["predicated", "predicate", "naming", "class", "property", "parcel"]);

// ── A SPARK HAS A PLACE AND IS NOT GROUND (WLD-173; CORE-70, Darko 2026-11-14) ──
//
// "a spark is neither sited nor anchored. Its at and extent come from its root
// conversation's room, frozen when it's made, or … a maker-chosen at with a
// fixed 60 m circle. It isn't sited, so sited marks in its extent don't contest
// it." So a spark carries `at`/`extent`, and that place must never make it
// sited or ground: not here, by the place proxy, and not by its class chain
// (`standingOf` answers "spark"). It stands in ground like any mark (its
// containment parent is geometric, marks-fold.mjs § containmentParentOf); it
// never contains anything. tools/spark.mjs holds the class's own grammar.
export const SPARK_CLASS = "spark";
/** A spark: how the record STANDS (`standingOf` below), the one answer every ground and sited
 *  question reads too, so no record is a spark to the market and sited ground to everything else.
 *  The old form `kind: sited` + `class: spark` stands sited, so it is no spark here, and the lint
 *  refuses that spelling (mark-lint.mjs § the spark's kind; review 391 F2). */
export const isSparkIn = (m, idx = null) => standingOf(m, idx) === SPARK_CLASS;

export function instanceClassOf(m) {
  if (!m || m.kind === "class" || m.kind === "property") return undefined;
  if (m.class !== undefined) return String(m.class);
  return m.kind != null && !STANDING_WORDS.has(String(m.kind)) ? String(m.kind) : undefined;
}

// A LANDFORM (WLD-97, ruled by Darko 2026-10-22 21:03–21:04): a class that extends
// `mark` directly, a sibling of sited. It carries a place, an outline and its
// `ground_m`, and it only shapes the ground the heightfield reads: it is never
// sited and never ground, so containment and every sited reader pass it by. Only
// the town makes one (its class answers makers: false).
export const LANDFORM = "landform";
/**
 * A landform, by the class it names, in either form (`kind: landform`, or the old
 * `kind: sited` + `class: landform`). Handed a class index, it walks the chain, so
 * a class that extends landform is one too; with none in hand (the place proxy's
 * readers) only the name itself can answer.
 */
export const isLandform = (m, idx = null) => {
  const k = instanceClassOf(m);
  if (k == null) return false;
  if (k === LANDFORM) return true;
  return !!idx && classChain(idx, k).some((c) => String(c.class) === LANDFORM);
};

// neither a spark (WLD-173) nor a landform (WLD-97) is sited by its place: both carry `at` and are no ground
export const isSited = (m) => !!m && !!m.at && !NEVER_GROUND.has(String(m.kind)) && String(m.kind) !== SPARK_CLASS && !isLandform(m);

export const isGround = (m) => !!m && !!m.at && (m.kind === "parcel" || isSited(m));

/** A claim standing under a mark, in either spelling: `kind: predicate` names the
 *  class (G10, settled 2026-10-17); `kind: predicated` is the standing word it
 *  replaced, which every store folded before it, and every door that writes it
 *  until its readers move, still carries. A naming is a predicate too, as the
 *  class tree says (naming extends predicate) and the site's helper reads it.
 *  It is asked of the record's kind, so a class or property node (kind: class,
 *  kind: property), the predicate class's own declaration included, never is. */
const PREDICATE_KINDS = new Set(["predicated", "predicate", "naming"]);
export const isPredicate = (m) => PREDICATE_KINDS.has(m?.kind);

// ── PUBLISHED, NOT PLACED (POS-688, ruled by Darko 2026-10-18 20:58) ────────
//
// A held thing stays the same mark (its maker, its words, its id) and loses its
// ground position while held: the settlement prints it with the holder's name
// in this field and no `at`/`extent`, and a drop prints a fresh `at`. The value
// is the holder: a resident's handle, or a holder thing's id (a thing in a chest
// is held by the chest). `holder` is NOT this field: `holder: true` is the
// thing's own "can hold" property (LOGOS/classes.md § The transfer edge).
//
// ONE NAME, so a rename is this line (the office keeps its twin of it, held
// equal by a test that reads this file).
export const HELD_BY = "held_by";

/** Who holds this record, as printed, or null when it is placed. */
export const heldBy = (m) => {
  const v = m?.[HELD_BY];
  return typeof v === "string" && v.trim() ? v.trim() : null;
};
export const isHeld = (m) => heldBy(m) != null;

// ── MAKER AND OWNER (POS-688, ruled by Darko 2026-10-19 16:39–16:45 and 17:14) ──
//
// The maker is the record's `by` and never moves. The OWNER is the one with the
// say over the thing, and starts as the maker; ownership passes only by the
// owner's own act (a give, putting it in an open holder, a welcomed on someone's
// take or set-down). The settlement prints `owned_by: <owner>` only when the
// owner is not the maker, the way `held_by` prints only when held. A thing is
// judged on its ground by its owner (D-O2): the fold resolves the owner's
// household onto the record, and the standing walk reads it.
export const OWNED_BY = "owned_by";

/** Who owns this record, as printed, or null when its maker does. */
export const ownedBy = (m) => {
  const v = m?.[OWNED_BY];
  return typeof v === "string" && v.trim() ? v.trim() : null;
};

/** The fields a hand-off moves: where it is, whose hands it is in, or whose it is. Nothing else. */
const HOLD_FIELDS = new Set(["at", "extent", "points", HELD_BY, OWNED_BY]);
/**
 * The facts the office prints into a record from its store, never a resident's
 * words (WORLD/marks/SCHEMA.md § First-laid facts): when the mark was first laid,
 * and the footprints it has stood on. A hand-off printed after the office began
 * printing them carries them where main's copy may not yet (POS-571, Bevel
 * 2026-11-13 15:47Z). They are not compared, and they never move a hand: a print
 * that changes only them is no hand-off.
 */
const STORE_PRINTED = new Set([CLAIMED_AT_FIELD, FOOTPRINTS_FIELD]);

/**
 * Is `after` the same mark as `before`, moved into or out of hands and nothing
 * else? The settlement prints a hand-off (POS-688) as exactly this change, and it
 * is the town's record of where a thing is, not a publication of new work, so the
 * sweep lets it land whatever stands behind the thing. Internal keys (`_…`) are
 * the loader's, never the record's. PURE.
 */
export function holdOnlyChange(before, after) {
  if (!before || !after) return false;
  const owned = ownedBy(before) !== ownedBy(after);
  if (!owned && isHeld(before) === isHeld(after) && heldBy(before) === heldBy(after)
    && JSON.stringify(before.at ?? null) === JSON.stringify(after.at ?? null)) return false; // no hand moved
  const rest = (r) => JSON.stringify(Object.keys(r).filter((k) => !k.startsWith("_") && !HOLD_FIELDS.has(k) && !STORE_PRINTED.has(k)).sort().map((k) => [k, r[k]]));
  return rest(before) === rest(after) && (isHeld(before) || isHeld(after) || owned);
}

/**
 * Is `after` the same mark as `before` with ONLY the hand-off fields moved, and
 * moved no further than a hand-off moves them? PURE.
 *
 * This is the question the town wall asks, and it is narrower than
 * `holdOnlyChange`: holding a thing is not authoring it, so a hand-off may print
 * on a mark the town signed, but nothing else about that mark may change. Beyond
 * `holdOnlyChange` (every other field equal), the place may differ only when the
 * thing goes into hands (the place leaves) or comes out of them (a fresh place
 * is printed); a mark that stays on the ground and whose place moves is the
 * author's move, and an owner stamped on beside a new place is not a hand-off.
 */
export function handOffOnly(before, after) {
  if (!holdOnlyChange(before, after)) return false;
  const same = (k) => JSON.stringify(before[k] ?? null) === JSON.stringify(after[k] ?? null);
  if (isHeld(before) !== isHeld(after)) return true; // into or out of hands: the place may leave or return
  return ["at", "extent", "points"].every(same);      // held to held, or ground to ground: the place stays put
}

// ── the chain's answer (G12) ─────────────────────────────────────────────────

const INDEXES = new WeakMap();
/** The class index of a set of marks (an array, cached; a Map's values, fresh). */
export function kindIndexOf(marks) {
  if (Array.isArray(marks)) {
    if (!INDEXES.has(marks)) INDEXES.set(marks, classIndex(marks));
    return INDEXES.get(marks);
  }
  return classIndex(marks instanceof Map ? [...marks.values()] : [...(marks ?? [])]);
}

/**
 * How a record stands: "sited", "parcel", "predicate", "naming", "post",
 * "landform", "class", "property", or null (an instance of a class under none of them).
 *   - A standing word still answers for itself (`kind: sited`, `kind: parcel`,
 *     and a post class's instances, which keep their old form until the post
 *     lane: WLD-73 G7).
 *   - A kind that names a class is answered by that class's chain, when the
 *     chain reaches the root. Only a chain that cannot answer (no class nodes
 *     in hand, or a fixture's partial tree) falls back to the record's place.
 */
export function standingOf(m, idx) {
  if (!m) return null;
  const kind = m.kind == null ? null : String(m.kind);
  if (kind === "class" || kind === "property") return kind;
  if (kind === "naming") return "naming";
  if (kind === "predicated" || kind === "predicate") return "predicate";
  if (kind == null) return null;
  // a landform answers by its class BEFORE the standing words: the old spelling
  // (kind: sited + class: landform) is a landform, never a sited mark (review of #296)
  if (isLandform(m, idx)) return LANDFORM;
  if (STANDING_WORDS.has(kind)) return kind;
  // a spark answers for itself before its place can (WLD-173): never "sited" from an `at`
  if (kind === SPARK_CLASS) return SPARK_CLASS;
  const chain = idx ? classChain(idx, kind).map((c) => String(c.class)) : [];
  if (!chain.includes("postmark-node")) return m.at ? "sited" : null;
  for (const s of ["post", SPARK_CLASS, "naming", "predicate", "parcel", "sited"]) if (chain.includes(s)) return s;
  return null;
}

/** A thing, asked of its CLASS CHAIN (WLD-74 E1, Wright 2026-11-05 04:48): the class
 *  it names is `thing` or extends it, by the class index of the marks in hand
 *  (kindIndexOf), so a halloween-candy-bowl is a thing wherever its class node is.
 *  A record that names no class (a plain sited mark, the untyped carriable) is not. */
export const isThingIn = (m, idx) => {
  const k = instanceClassOf(m);
  if (k == null) return false;
  return k === "thing" || (!!idx && classChain(idx, k).some((c) => String(c.class) === "thing"));
};

export const isSitedIn = (m, idx) => !!m?.at && standingOf(m, idx) === "sited";
export const isGroundIn = (m, idx) => {
  if (!m?.at) return false;
  const s = standingOf(m, idx);
  return s === "sited" || s === "parcel";
};
