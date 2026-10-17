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
import { holderLawOf, roomIn, affordedActions } from "./kind-holding.mjs";
import { truth } from "./holding-law.mjs";

/** The verbs this calculus decides; every other act keeps its own grant. */
export const HOLD_VERBS = Object.freeze(["take", "give", "drop", "consume", "refill"]);

/** Is a thing portable? `thing/portable` is sovereign, default true (the lead's settlement, 2026-10-17). */
export function portableOf(mark, view) {
  const className = markClassOf(mark);
  const p = className == null ? null : view.property?.(className, "portable") ?? null;
  const own = p?.tier === "sovereign" && mark?.portable !== undefined ? truth(mark.portable) : null;
  return own ?? truth(p?.value) ?? true;
}

/**
 * Every (verb, object) pair you can do right now. `marks` are the marks in
 * view (canon records with `at`), `residents` the others placed near you
 * (`{ handle, x, y }`, or presence's `{ handle, distance_m }`), `fold` the hold lane's units fold, `attachments` the
 * hold rows. `object` is a mark id, a resident's handle, or null (a verb of
 * your own hands: drop).
 */
export function usablePairs({ actor, here, marks = [], residents = [], fold, attachments = [], view, householdOf = null, pointWithinMark = null }) {
  const me = String(actor);
  const carriedThings = holdingsOf(attachments, me);
  const carrying = totalOf(fold, me) + carriedThings.length > 0;
  const pairs = [];
  const add = (verb, object) => { if (!pairs.some((p) => p.verb === verb && p.object === object)) pairs.push({ verb, object }); };
  if (carrying) add("drop", null);
  // consume: a consumable kind in your own hands (10:30's roster)
  if (kindEdgesOf(fold, me).some((e) => lineageOf(e.kind, view.extendsOf).includes("consumable"))) add("consume", null);
  const seen = new Set();
  for (const m of marks) {
    if (!m?.id || seen.has(m.id)) continue;
    seen.add(m.id);
    const className = markClassOf(m);
    if (className == null || !lineageOf(className, view.extendsOf).includes("thing")) continue;
    const heldBy = liveHolder(attachments, m.id);
    const inHand = heldBy === me;
    const reach = inHand || (here != null && m.at != null && standsWithin(here, m, { pointWithinMark }).stands);
    if (!reach) continue;
    const law = holderLawOf({ holder: m.id, mark: m, view });
    const mine = sameHousehold(String(m.by ?? m.id.split("/")[0]), me, householdOf).same;
    const welcome = law.open !== false || mine;
    // take the thing itself: portable, in reach, on the ground (held by no one)
    if (heldBy == null && portableOf(m, view)) add("take", m.id);
    // a holder whose own capacity is refused, or unread, takes and gives nothing until it is set (the door refuses alike)
    if (law.holder && !law.capacity_refused && Number.isInteger(law.capacity)) {
      const holds = kindEdgesOf(fold, m.id).length > 0 || holdingsOf(attachments, m.id).length > 0;
      // take from it: it holds something, and its open or its household lets you
      if (holds && welcome) add("take", m.id);
      // give into it: you carry something, and it has room and lets you
      const room = roomIn({ capacity: law.capacity, fold, holder: m.id, things: holdingsOf(attachments, m.id).length });
      if (carrying && welcome && room > 0) add("give", m.id);
      // its class's own afforded actions (the Candy Bowl's refill): its maker, at it or carrying it
      for (const a of affordedActions(className, view))
        if (a.action === "refill" && (a.who !== "maker" || String(m.by ?? "") === me)) add("refill", m.id);
    }
  }
  if (carrying && here != null)
    for (const r of residents) {
      if (!r?.handle || String(r.handle) === me) continue;
      // presence rows carry the distance; a row with a position is measured here
      const beside = Number.isFinite(Number(r.x)) ? withinArmsLength(here, { x: Number(r.x), y: Number(r.y) }).stands
        : Number.isFinite(Number(r.distance_m)) && Number(r.distance_m) <= EARSHOT_M;
      if (beside) add("give", String(r.handle));
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
