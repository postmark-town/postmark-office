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
import { totalOf, kindEdgesOf, stolenClassRefusal } from "./world-stacks.mjs";
import { liveHolder, holdingsOf, sameHousehold } from "./world-hold.mjs";
import { lineageOf, markClassOf } from "./world-grants.mjs";
import { holderLawOf, roomIn, affordedActions, portableMark, isHolderMark, holdersCarriedOf, RULED_HOLDERS } from "./kind-holding.mjs";
import { liveHolders, wholeLoadOf } from "./holder-tree.mjs";

/** The verbs this calculus decides; every other act keeps its own grant. */
export const HOLD_VERBS = Object.freeze(["take", "give", "drop", "consume", "refill"]);

/** The creatures' afforded actions (POS-672): their pairs come from creature-verbs.mjs § creaturePairs,
 *  one more column set of the same matrix, so `can` and investigate's `can` project them alike (W4). */
export const CREATURE_VERBS = Object.freeze(["watch", "approach", "shoo", "call", "offer", "whisper"]);
/** Every verb the matrix decides, in roster order. */
export const CAN_VERBS = Object.freeze([...HOLD_VERBS, ...CREATURE_VERBS]);

/** Is a thing portable? `thing/portable` is sovereign, default true (the lead's settlement, 2026-10-17). */
export const portableOf = (mark, view) => portableMark(mark, (n, p) => view.property?.(n, p) ?? null);

/**
 * A CLASS TAKEN BY THE TOWN'S OWN ACT, IN `can` (WLD-7/b, RULED 2026-10-21 19:07 EDT:
 * "Show and refuse"). While a class is taken, `can` keeps listing the verbs on things
 * and units of it, and trying one is refused by its door with the class's clue: the
 * moment of discovery. ONE SWITCH: "show" (ruled) or "hide" (no verb offered on a thing
 * of it, a unit of it in your hands, or a holder only for what of it it holds).
 */
export const TAKEN_IN_CAN = Object.freeze({ value: "show", ruled: "WLD-7/b, 2026-10-21 19:07 EDT" });

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
export function usablePairs({ actor, here, marks = [], residents = [], fold, attachments = [], view, householdOf = null, pointWithinMark = null, places = null, takenInCan = TAKEN_IN_CAN.value, made = null }) {
  const me = String(actor);
  // THE HOLD ROWS, READ ONCE: the last row per thing decides who holds it (liveHolder's rule)
  const last = new Map();
  for (const r of attachments) last.set(String(r.target), r);
  const heldByOf = (id) => { const r = last.get(String(id)); return r?.policy === "cascade" ? String(r.entity) : null; };
  const inside = new Map();
  for (const [t, r] of last) if (r.policy === "cascade") { const e = String(r.entity); if (!inside.has(e)) inside.set(e, []); inside.get(e).push(t); }
  const up = liveHolders(attachments); // a holder's room counts each holder in it 1 and all it holds (counts confer up)
  const carriedThings = inside.get(me) ?? [];
  // A HOLDERS DIAL, WHEN A RULING SETS ONE (kind-holding § refuseSecondHolder, the door's own rule): no take of
  // a holder is offered to hands already at it. Since 2026-10-18 12:17 (POS-679) it is unset, so nothing is held back.
  const classProperty = (n, p) => view.property?.(n, p) ?? null;
  const byId = new Map(marks.filter((x) => x?.id).map((x) => [String(x.id), x]));
  const isHolder = (id) => { const x = byId.get(String(id)); return x ? isHolderMark(x, classProperty) : false; };
  const handsFull = carriedThings.filter(isHolder).length >= (holdersCarriedOf(classProperty) ?? RULED_HOLDERS);
  const takeable = (id) => !(handsFull && isHolder(id));
  const load = (who) => totalOf(fold, who) + (inside.get(String(who))?.length ?? 0);
  const cap = holderLawOf({ holder: "resident", view }).capacity;
  const slots = (who) => (Number.isInteger(cap) ? cap - load(who) : Infinity);
  // a class taken by the town's own act hides what is of it (TAKEN_IN_CAN); on every other day nothing is
  const hiding = takenInCan === "hide" && !!view.stolenAny?.();
  const taken = (klass) => hiding && klass !== undefined && stolenClassRefusal(klass, view) != null;
  const freeKinds = (holder) => kindEdgesOf(fold, holder).filter((e) => !taken(e.kind));
  const classOfId = (id) => { const x = byId.get(String(id)); return x ? markClassOf(x) ?? null : undefined; };
  // a holder moved whole moves what it holds: one that carries anything of a taken class is not offered either
  const carriesTaken = (id, depth = 0) => hiding && depth <= 8 && (kindEdgesOf(fold, id).some((e) => taken(e.kind))
    || (inside.get(String(id)) ?? []).some((t) => taken(classOfId(t)) || carriesTaken(t, depth + 1)));
  const movable = (id) => !taken(classOfId(id)) && !carriesTaken(id);
  const carryingKinds = freeKinds(me).length > 0;
  const pairs = [];
  const add = (verb, object) => { if (!pairs.some((p) => p.verb === verb && p.object === object)) pairs.push({ verb, object }); };
  const beside = (handle) => {
    if (here == null) return false;
    const r = residents.find((x) => String(x?.handle) === String(handle));
    if (!r) return false;
    return Number.isFinite(Number(r.x)) ? withinArmsLength(here, { x: Number(r.x), y: Number(r.y) }).stands
      : Number.isFinite(Number(r.distance_m)) && Number(r.distance_m) <= EARSHOT_M;
  };
  // a thing made in hand (POS-766, `made`: the hold record's made marks) is set down by its maker's house only, and a
  // candy never (POS-766/e; the door's own refusals, world-hold § setDownMade); it is eaten by its own consume
  const madeIn = (t) => made?.has?.(String(t)) === true;
  const madeSetsDown = (t) => { const m = made.get(String(t)); return String(m?.by) === me && !lineageOf(String(m?.kind ?? "thing"), view.extendsOf).includes("candy"); };
  if (carriedThings.some((t) => movable(t) && (!madeIn(t) || madeSetsDown(t)))) add("drop", null);
  // consume: a consumable kind in your own hands (10:30's roster), counted or made in hand
  const edibleMade = carriedThings.some((t) => madeIn(t) && !taken(String(made.get(String(t))?.kind)) && lineageOf(String(made.get(String(t))?.kind ?? "thing"), view.extendsOf).includes("consumable"));
  if (edibleMade || freeKinds(me).some((e) => lineageOf(e.kind, view.extendsOf).includes("consumable"))) add("consume", null);
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
    if (ground && portableOf(m, view) && slots(me) > 0 && takeable(m.id) && movable(m.id)) add("take", m.id);
    const law = holderLawOf({ holder: m.id, mark: m, view });
    // a holder whose own capacity is refused, or unread, takes and gives nothing until it is set (the door refuses alike)
    if (!law.holder || law.capacity_refused || !Number.isInteger(law.capacity)) continue;
    const mine = sameHousehold(String(m.by ?? m.id.split("/")[0]), me, householdOf).same;
    const welcome = law.open !== false || mine;
    const wholeInside = inside.get(m.id) ?? [];
    const room = roomIn({ capacity: law.capacity, fold, holder: m.id, things: wholeLoadOf({ up, holder: m.id, unitsOf: (h) => totalOf(fold, h) }) });
    if (welcome && atIt && slots(me) > 0) {
      // take from it, by kind or pot luck; and each whole mark inside carries its own take (11:55)
      const free = (t) => takeable(t) && movable(t);
      if (freeKinds(m.id).length || wholeInside.some(free)) add("take", m.id);
      for (const t of wholeInside) if (free(t)) add("take", t);
    }
    // give into it: something in your hands besides the holder itself
    if (welcome && toIt && room > 0 && (carryingKinds || carriedThings.some((t) => t !== m.id && movable(t)))) add("give", m.id);
    // its class's own afforded actions (the Candy Bowl's refill): its maker, within reach, with room
    for (const a of affordedActions(className, view))
      // refill is a make: at it or carrying it, never into another's hands (the lead's settlement)
      if (a.action === "refill" && (a.who !== "maker" || String(m.by ?? "") === me) && atIt && room > 0) add("refill", m.id);
  }
  if (carryingKinds || carriedThings.some(movable))
    for (const r of residents) {
      if (!r?.handle || String(r.handle) === me) continue;
      if (beside(r.handle) && slots(r.handle) > 0) add("give", String(r.handle));
    }
  return pairs;
}

/**
 * The marks the matrix is handed at a standpoint: your spine (`within`, the marks you stand inside)
 * and what your eyes see (`nearby`), each id once, the spine first. A bowl you stand ON is in the
 * spine and never among what the eyes see, so a matrix handed `nearby` alone hid its take, give and
 * refill while their doors admitted them (the playground's QA of part 2, fail 4).
 */
export const viewMarkIds = ({ within = [], nearby = [] } = {}) =>
  [...new Set([...within, ...nearby].map((m) => (typeof m === "string" ? m : m?.id)).filter(Boolean).map(String))];

/** The bare read's `can` for the hold verbs: each usable verb once, in roster order. */
export const canVerbs = (pairs) => CAN_VERBS.filter((v) => pairs.some((p) => p.verb === v));

/** Investigate's `can`: one object's column, the verbs you can do to it now. */
export const canOn = (pairs, object) => CAN_VERBS.filter((v) => pairs.some((p) => p.verb === v && p.object === String(object)));

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
