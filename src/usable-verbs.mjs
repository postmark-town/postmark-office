// usable-verbs.mjs — VERBS SHOW WHEN USABLE (LOGOS v2 part 2, lane O2).
//
// The law (SITTING 2026-10-16 10:30–10:36, 12:01; reads-and-affordances.md):
//
//   "these verbs only reveal themselves when you can actually use them" — take
//   shows when a thing is in reach; give and drop when you carry something;
//   refill at, or carrying, a holder you made whose class affords it.
//   "`can` is the verbs alone, each listed once … object agnostic" (10:36), and
//   investigate(m).can is m's column: the verbs you can do to m right now.
//   THE INVARIANT: the verbs in `can` equal the object-less verbs plus the
//   union of investigate(m).can over every mark in view.
//   "hidden until usable never means unknowable": explain: lists every afforded
//   action with its conditions, and a verb tried while it isn't showing is
//   refused by its door with its reason, never "no such verb".
//
// ONE FUNCTION, PROJECTED TWO WAYS: `usablePairs` is the matrix of (verb,
// object) pairs at a standpoint; `canVerbs` projects it onto verbs (the bare
// read's `can`) and `canOn` onto one object (investigate's `can`). Both reads
// call these two, so they cannot diverge. PURE: the record is handed in.

import { standsWithin, withinArmsLength, EARSHOT_M } from "./reach.mjs";
import { totalOf, kindEdgesOf } from "./world-stacks.mjs";
import { liveHolder, holdingsOf, sameHousehold } from "./world-hold.mjs";
import { lineageOf, markClassOf } from "./world-grants.mjs";
import { holderLawOf, roomIn, affordedActions, portableMark } from "./kind-holding.mjs";

/** The verbs this calculus decides; every other act keeps its own grant. */
export const HOLD_VERBS = Object.freeze(["take", "give", "drop", "consume", "refill"]);

/** Is a thing portable? `thing/portable` is sovereign, default true (the lead's settlement, 2026-10-17). */
export const portableOf = (mark, view) => portableMark(mark, (n, p) => view.property?.(n, p) ?? null);

/**
 * Every (verb, object) pair you can do right now — each one exactly what its
 * door admits (review-610 B3; held by a differential test against the doors).
 * `marks` are the marks in view (canon records with `at`) and the things in your
 * hands; `residents` the others placed near you (`{ handle, x, y }`, or
 * presence's `{ handle, distance_m }`); `fold` the hold lane's units fold;
 * `attachments` the hold rows; `places` where a set-down holder stands now
 * (`Map(id → {x, y})`, the hold lane's drop act). `object` is a mark id, a
 * resident's handle, or null (a verb of your own hands).
 *
 *   take     a portable thing on the ground in reach; a holder in reach (or in
 *            your hands) that holds something and lets you; a whole mark inside
 *            such a holder — and only while you have a slot to carry it in
 *   give     you carry something, to a resident beside you with a slot, or into
 *            a holder in reach (or in your hands, or beside you in another's
 *            hands) that lets you and has room
 *   drop     a whole thing in your hands (a set-down by kind is G8, not built)
 *   consume  a consumable kind in your hands
 *   refill   a holder whose class affords it, its maker you, within reach, with room
 */
export function usablePairs({ actor, here, marks = [], residents = [], fold, attachments = [], view, householdOf = null, pointWithinMark = null, places = null }) {
  const me = String(actor);
  // THE HOLD ROWS, READ ONCE: the last row per thing decides who holds it (liveHolder's rule)
  const last = new Map();
  for (const r of attachments) last.set(String(r.target), r);
  const heldByOf = (id) => { const r = last.get(String(id)); return r?.policy === "cascade" ? String(r.entity) : null; };
  const inside = new Map();
  for (const [t, r] of last) if (r.policy === "cascade") { const e = String(r.entity); if (!inside.has(e)) inside.set(e, []); inside.get(e).push(t); }
  const carriedThings = inside.get(me) ?? [];
  const load = (who) => totalOf(fold, who) + (inside.get(String(who))?.length ?? 0);
  const cap = holderLawOf({ holder: "resident", view }).capacity;
  const slots = (who) => (Number.isInteger(cap) ? cap - load(who) : Infinity);
  const carryingKinds = kindEdgesOf(fold, me).length > 0;
  const pairs = [];
  const add = (verb, object) => { if (!pairs.some((p) => p.verb === verb && p.object === object)) pairs.push({ verb, object }); };
  const beside = (handle) => {
    if (here == null) return false;
    const r = residents.find((x) => String(x?.handle) === String(handle));
    if (!r) return false;
    return Number.isFinite(Number(r.x)) ? withinArmsLength(here, { x: Number(r.x), y: Number(r.y) }).stands
      : Number.isFinite(Number(r.distance_m)) && Number(r.distance_m) <= EARSHOT_M;
  };
  if (carriedThings.length) add("drop", null);
  // consume: a consumable kind in your own hands (10:30's roster)
  if (kindEdgesOf(fold, me).some((e) => lineageOf(e.kind, view.extendsOf).includes("consumable"))) add("consume", null);
  const seen = new Set();
  for (const m of marks) {
    if (!m?.id || seen.has(m.id)) continue;
    seen.add(m.id);
    const className = markClassOf(m);
    if (className == null || !lineageOf(className, view.extendsOf).includes("thing")) continue;
    const heldBy = heldByOf(m.id);
    if (heldBy != null && heldBy.includes("/")) continue; // inside a holder: it is taken out through its holder
    const inHand = heldBy === me;
    const setDown = heldBy == null ? places?.get?.(m.id) ?? null : null;
    const ground = heldBy == null && here != null && m.at != null
      && standsWithin(here, setDown ? { ...m, at: setDown } : m, { pointWithinMark: setDown ? null : pointWithinMark }).stands;
    const atIt = inHand || ground;                                       // take's reach
    const toIt = atIt || (heldBy != null && !inHand && beside(heldBy));  // give's: another's hands, at arm's length
    // take the thing itself: portable, on the ground, in reach, with a slot
    if (ground && portableOf(m, view) && slots(me) > 0) add("take", m.id);
    const law = holderLawOf({ holder: m.id, mark: m, view });
    // a holder whose own capacity is refused, or unread, takes and gives nothing until it is set (the door refuses alike)
    if (!law.holder || law.capacity_refused || !Number.isInteger(law.capacity)) continue;
    const mine = sameHousehold(String(m.by ?? m.id.split("/")[0]), me, householdOf).same;
    const welcome = law.open !== false || mine;
    const wholeInside = inside.get(m.id) ?? [];
    const room = roomIn({ capacity: law.capacity, fold, holder: m.id, things: wholeInside.length });
    if (welcome && atIt && slots(me) > 0) {
      // take from it, by kind or pot luck; and each whole mark inside carries its own take (11:55)
      if (kindEdgesOf(fold, m.id).length || wholeInside.length) add("take", m.id);
      for (const t of wholeInside) add("take", t);
    }
    // give into it: something in your hands besides the holder itself
    if (welcome && toIt && room > 0 && (carryingKinds || carriedThings.some((t) => t !== m.id))) add("give", m.id);
    // its class's own afforded actions (the Candy Bowl's refill): its maker, within reach, with room
    for (const a of affordedActions(className, view))
      if (a.action === "refill" && (a.who !== "maker" || String(m.by ?? "") === me) && toIt && room > 0) add("refill", m.id);
  }
  if (carryingKinds || carriedThings.length)
    for (const r of residents) {
      if (!r?.handle || String(r.handle) === me) continue;
      if (beside(r.handle) && slots(r.handle) > 0) add("give", String(r.handle));
    }
  return pairs;
}

/** The bare read's `can` for the hold verbs: each usable verb once, in roster order. */
export const canVerbs = (pairs) => HOLD_VERBS.filter((v) => pairs.some((p) => p.verb === v));

/** Investigate's `can`: one object's column, the verbs you can do to it now. */
export const canOn = (pairs, object) => HOLD_VERBS.filter((v) => pairs.some((p) => p.verb === v && p.object === String(object)));

/** The verbs with no object in view (your own hands). */
export const objectlessVerbs = (pairs) => HOLD_VERBS.filter((v) => pairs.some((p) => p.verb === v && p.object == null));

/**
 * The read's action list, trimmed to what is usable: a hold verb shows only
 * when some object makes it possible; every other entry passes untouched. The
 * door is not trimmed: a verb tried while hidden reaches its door, which
 * refuses it with its reason.
 */
export function onlyUsable(entries, pairs) {
  const usable = new Set(canVerbs(pairs));
  return entries.filter((e) => !HOLD_VERBS.includes(e.action) || usable.has(e.action));
}
