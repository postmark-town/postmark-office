// kind-holding.mjs — WHAT A HOLDER HOLDS, BY KIND (LOGOS v2 part 2, lane O2).
//
// The law (world #229 + #230, LOGOS/classes.md; SITTING 2026-10-16):
//
//   holder   "A holder is anything with `holder: true`" (16:03–16:05): a resident
//            (capacity 24, constitution), or a thing whose maker set it true
//            (capacity sovereign, default 30, bounds 1–120; `open`, default true).
//   make     "Leave-mark makes marks into a holder: `leave-mark { kind, count,
//            to }`. Making into a published holder is live (holders confer
//            their state)" — yourself included, a resident being a holder (16:02).
//   blur     "A holding is a set of marks. A count describes that set at some
//            resolution, a class and a number; a read gives it at the nearest
//            common class, and investigate sharpens it." Nothing materializes,
//            no answer says "piece", and no unit is ever named or listed one by
//            one (15:46; 18:44 item 4). Compact storage is implementation only:
//            here, the hold lane's `units:*` moves, each naming its `kind`.
//   takes    "A take from a holder that names no kind is pot luck over
//            everything it holds. Naming a kind narrows the draw" (18:44 item 6).
//   refuse   "An ambiguous object is refused, with nothing changed and the
//            candidates listed, each by owner, id and distance" (18:44 item 4).
//   room     Settled for O2 by the lead (2026-10-17): making past a holder's room
//            refuses WHOLE — nothing made — and says how much room is left
//            ("the bowl has room for 4, not 10"). Refill behaves the same.
//   draw     Settled for O2 by the lead: the pot-luck draw is derived from the
//            act (sha256 of its identity, as the creatures' d20 is), so a replay
//            or a settlement draws the same.
//
// EVERYTHING HERE IS PURE: the fold, the class view and the marks are handed
// in; the door (world-kinds.mjs) reads the record and writes the act.

import { createHash } from "node:crypto";
import { kindEdgesOf, totalOf, nearestCommonClass, plural, UNIT_ACTION } from "./world-stacks.mjs";
import { lineageOf, markClassOf } from "./world-grants.mjs";
import { holdingOf, makersOf, truth, whole } from "./holding-law.mjs";

const bounce = (code, defect, hint, extra = {}) => {
  const e = new Error(defect);
  Object.assign(e, { code, defect, hint, ...extra });
  return e;
};

/** The class reader a view hands the holding law: `(class, prop) → property`. */
const propertyOf = (view) => (n, p) => view.property?.(n, p) ?? null;

// ── THE KIND ────────────────────────────────────────────────────────────────

/**
 * Is `kind` a class a resident may make by count, into a holder? Its record
 * must exist; its `makers` must answer true (holding-law § makersOf, inherited
 * down `extends`); it must be a thing ("A thing is made, held or set down",
 * the thing class's body); and it must not itself hold — a holder has contents
 * of its own, which a count cannot carry (O2 gap G2, the lead's call). Returns
 * `{ kind, lineage }`, or throws the door's refusal, nothing made.
 */
export function makeableKind(kind, view) {
  if (kind == null || String(kind).trim() === "")
    throw bounce(422, "make what kind?", "kind: a class id, e.g. a kind of candy — explain: \"candy\" lists the kinds. Nothing was made.");
  const k = String(kind).trim();
  if (!view.record(k)) throw bounce(422, `no kind "${k}" in the law`, `a kind is a class the town has declared; explain: "thing" shows the tree. Nothing was made.`);
  const lineage = lineageOf(k, view.extendsOf);
  const makers = makersOf(k, propertyOf(view));
  if (!makers.may)
    throw bounce(422, `"${k}" is the town's to make`, makers.read
      ? `its makers is false (set on ${makers.from}), under the-town/nothing-you-control-mints. Nothing was made.`
      : `no class in its lineage states makers, and an unread makers answers false (the root's own answer). Nothing was made.`);
  if (!lineage.includes("thing"))
    throw bounce(422, `a ${k} is not a thing, so nothing holds it`, `a holder holds things; a ${k} is left as its own mark (leave-mark with a slug). Nothing was made.`);
  if (holdingOf({ className: k, classProperty: propertyOf(view) }).holder)
    throw bounce(422, `a ${k} holds things of its own, so it is not made by count`,
      `make it as its own mark, with a slug, so what it holds has somewhere to be. Nothing was made.`);
  return { kind: k, lineage };
}

// ── THE HOLDER ──────────────────────────────────────────────────────────────

/**
 * What a holder is by law. A resident (a handle, no "/"): holder, its class's
 * capacity (24, constitution), no `open` (a give to a resident follows the
 * general consent law). A mark: its class's `holder`, `capacity` and `open`,
 * the mark's own sovereign fields counting (holding-law § holdingOf). A mark
 * that names no thing class holds nothing.
 */
export function holderLawOf({ holder, mark = null, view }) {
  if (!String(holder).includes("/")) {
    const r = holdingOf({ className: "resident", classProperty: propertyOf(view), legacy: { capacity: view.dials?.("thing")?.carry_cap } });
    return { resident: true, holder: true, capacity: r.capacity, open: null, className: "resident" };
  }
  const className = markClassOf(mark);
  const thing = className != null && lineageOf(className, view.extendsOf).includes("thing");
  if (!thing) return { resident: false, holder: false, capacity: null, open: null, className };
  const h = holdingOf({ mark, className, classProperty: propertyOf(view) });
  return { resident: false, holder: h.holder === true, capacity: h.capacity, open: h.open !== false, accepts: h.accepts, keeps: h.keeps, accepts_shown: h.accepts_shown, className,
    // an own capacity outside its class's bounds is refused, never clamped (holding-law § holdingOf, O1 review-606)
    ...(h.capacity_refused ? { capacity_refused: h.capacity_refused } : {}) };
}

/**
 * Is this mark a holder, by the holder property (16:03: "a holder is anything
 * with `holder: true`") — never by a class named chest. `classProperty` is
 * the class layer's reader. #499's chest class still answers, for its own
 * marks, until its doors go.
 */
export function isHolderMark(mark, classProperty) {
  const className = markClassOf(mark);
  if (className == null) return false;
  if (className === "chest") return true;
  return holdingOf({ mark, className, classProperty }).holder === true;
}

/** How many holders a resident carries at once, when a ruling sets it: `resident/holder/holders`; null when unset (no limit). */
export const holdersCarriedOf = (classProperty) => {
  // a law that cannot be read sets no dial either: the ruled answer, no limit (a hold with no law loaded, hold-reach's end-to-end takes)
  try { return whole(classProperty("resident", "holders")?.value); } catch { return null; }
};

// ANY NUMBER OF HOLDERS (Darko, 2026-10-18 12:17, POS-679 / WLD-76: "Yeah, I agree
// with your recommended shape"): a resident carries as many holders as their 24
// slots hold, nesting is free, and counts confer up between holders, which is what
// keeps nesting from multiplying room. It replaces 2026-10-17 23:29's one holder.
// The dial stays, so a later ruling (a class of bag that grants more, say) can set
// a number; unset, it is no limit.
export const RULED_HOLDERS = Infinity;

/**
 * A HOLDERS DIAL, WHEN A RULING SETS ONE. Since 2026-10-18 12:17 (POS-679) the
 * law sets none: a resident carries any number of holders, and this refuses
 * nothing. It stays for the dial: if `resident/holder/holders` is ever set, a
 * holder past it coming into a resident's hands (by a take, a give or a
 * pot-luck draw) is refused in the full-hands voice. `adding` are the whole
 * marks arriving, `held` the ones already in `who`'s hands, `markById` the
 * record's reader. A holder named `who` (a mark) is not a resident and is not asked.
 */
export async function refuseSecondHolder({ who, actor, adding = [], held = [], markById, view, nothing = "Nothing was changed." }) {
  if (who == null || String(who).includes("/") || !adding.length) return;
  const classProperty = propertyOf(view);
  if (holdersCarriedOf(classProperty) == null) return; // unset: no limit, and no mark is read for it
  const holds = async (id) => {
    const m = await markById(String(id)).catch(() => null);
    return m ? isHolderMark(m, classProperty) : false;
  };
  const coming = [];
  for (const t of adding) if (await holds(t)) coming.push(String(t));
  if (!coming.length) return;
  const limit = holdersCarriedOf(classProperty) ?? RULED_HOLDERS;
  const carrying = [];
  for (const t of held) if (!coming.includes(String(t)) && await holds(t)) carrying.push(String(t));
  if (carrying.length + coming.length <= limit) return;
  const mine = String(who) === String(actor);
  if (carrying.length) {
    // the words follow how many are carried: one from today, or several from before the rule
    const what = `${carrying.length === 1 ? "a holder" : `${carrying.length} holders`} (${carrying.join(", ")})`;
    const over = carrying.length + coming.length - limit; // how many must be set down first
    const setDown = carrying.length === 1 ? "set it down first" : over >= carrying.length ? "set them down first" : `set ${over} of them down first`;
    throw bounce(409, mine ? `you're already carrying ${what}` : `${who} is already carrying ${what}`,
      `${mine ? setDown : `it goes to them once they set ${carrying.length === 1 ? "theirs" : "those"} down`}. ${nothing}`, { holders: carrying, coming, limit });
  }
  throw bounce(409, `that would put ${coming.length} holders in ${mine ? "your" : `${who}'s`} hands (${coming.join(", ")})`,
    `a resident carries ${limit === 1 ? "one holder" : `${limit} holders`} at a time. ${nothing}`, { holders: coming, coming, limit });
}

/** Is this thing portable? `thing/portable` is sovereign, default true (the lead's settlement, 2026-10-17). */
export function portableMark(mark, classProperty) {
  const className = markClassOf(mark);
  const p = className == null ? null : classProperty(className, "portable") ?? null;
  const own = p?.tier === "sovereign" && mark?.portable !== undefined ? truth(mark.portable) : null;
  // #499's chest marks said portable on themselves, with no property behind them
  const legacy = p == null && typeof mark?.portable === "boolean" ? mark.portable : null;
  return own ?? legacy ?? truth(p?.value) ?? true;
}

/**
 * THE HOLDER'S OWN WORD AT THE LEAVE DOOR (LOGOS v2, O2; review-610 S8; ruled
 * 16:03): any thing may hold, at its maker's choice. `holder` is sovereign on
 * thing (default false); with it true, `capacity` (sovereign, within its
 * class's bounds) and `open` (sovereign) apply; `portable` is sovereign on
 * thing (default true). A value is written only where the property's tier is
 * sovereign: a constitution property is the town's, and no instance writes it
 * (classes.md § What an instance writes). An own capacity outside its bounds is
 * refused with the holding law's own sentence (holding-law § holdingOf), never
 * clamped. Returns the fields the record carries, or null when none were sent.
 */
export const HOLDER_FIELDS = Object.freeze(["holder", "capacity", "open", "portable"]);
export function holderWordOf({ payload = {}, klass, classProperty, extendsOf }) {
  const sent = HOLDER_FIELDS.filter((f) => payload[f] !== undefined);
  if (!sent.length) return null;
  const line = klass == null ? [] : lineageOf(klass, extendsOf);
  if (!line.includes("thing")) throw bounce(422, `${sent.join(", ")} belong to a thing`, 'a thing holds and is carried; give the mark class: "thing" (or a kind of thing)');
  const out = {};
  for (const f of sent) {
    const p = classProperty(klass, f);
    if (p && p.tier !== "sovereign") throw bounce(422, `${f} is the town's on a ${klass}`, `its ${f} is ${JSON.stringify(p.value)}, set by ${p.from} at the constitution tier: no instance writes it`);
    if (f === "capacity") {
      if (whole(payload.capacity) == null) throw bounce(422, "capacity is a whole number", `got ${JSON.stringify(payload.capacity)}`);
      out.capacity = whole(payload.capacity);
    } else {
      if (truth(payload[f]) == null) throw bounce(422, `${f} is true or false`, `got ${JSON.stringify(payload[f])}`);
      out[f] = truth(payload[f]);
    }
  }
  const law = holdingOf({ mark: out, className: klass, classProperty });
  if (law.capacity_refused) throw bounce(422, law.capacity_refused, `leave capacity off for its class's ${holdingOf({ className: klass, classProperty }).capacity ?? "default"}`);
  if ((out.capacity !== undefined || out.open !== undefined) && !law.holder)
    throw bounce(422, "capacity and open belong to a holder", "add holder: true, or leave them off: a thing holds nothing unless its maker says so");
  return out;
}

/** Room left in a holder: its capacity less everything it holds (both maps, plus whole things). */
export const roomIn = ({ capacity, fold, holder, things = 0, inFlight = 0 }) =>
  (Number.isInteger(capacity) ? capacity - totalOf(fold, holder) - Number(things) - Number(inFlight) : null);

/**
 * "The bowl has room for 4, not 10." Refuses WHOLE when `n` exceeds the room
 * (the lead's settlement, 2026-10-17); `name` is how the answer names the holder.
 */
export function refuseOverRoom({ n, room, name, capacity, holding, verb = "made" }) {
  if (room == null || n <= room) return;
  const left = Math.max(room, 0);
  throw bounce(409, `${name} has room for ${left}, not ${n}`,
    `it holds ${holding} of ${capacity}. Nothing was ${verb}.`, { room: left, capacity });
}

// ── THE BLUR ────────────────────────────────────────────────────────────────

// the one plural is world-stacks.mjs § plural (POS-741, POS-743)

/**
 * What a holding shows, at the nearest common class and a number: "18
 * pocket-comets", "21 candies", "22 things" (a toaster beside them). `edges`
 * are the holder's kinds, `things` the classes of the whole things it holds.
 * `sharp: true` (investigate) adds each kind with its count — the class
 * sharpened, never into units.
 */
export function blurOf({ edges = [], things = [], extendsOf, sharp = false }) {
  const classes = [...edges.map((e) => e.kind), ...things.map((t) => t ?? "thing")];
  const count = edges.reduce((s, e) => s + e.count, 0) + things.length;
  if (!count) return { count: 0, class: null, shows: "empty" };
  const klass = nearestCommonClass(classes, extendsOf) ?? "thing";
  return {
    count, class: klass, shows: `${count} ${plural(klass, count)}`,
    ...(sharp ? { kinds: edges.map((e) => ({ kind: e.kind, count: e.count, shows: `${e.count} ${plural(e.kind, e.count)}` })) } : {}),
  };
}

// ── CHOOSING ────────────────────────────────────────────────────────────────

/**
 * Which kind a give moves. Named: it must be held. Omitted: only when one kind
 * is held; otherwise refused, listing the kinds (each a class and a number —
 * never a unit), nothing changed (O2 gap G7: pot luck is ruled for take alone).
 */
export function selectKind(edges, kind, { where = "your hands", verb = "give" } = {}) {
  const listing = edges.map((e) => `${e.count} ${plural(e.kind, e.count)}`).join(", ");
  if (kind != null && kind !== "") {
    const hit = edges.find((e) => e.kind === String(kind));
    if (!hit) throw bounce(409, `no ${kind} in ${where}`, edges.length ? `${where} hold ${listing}. Nothing was changed.` : `${where} hold nothing. Nothing was changed.`);
    return hit;
  }
  if (edges.length === 1) return edges[0];
  if (!edges.length) throw bounce(409, `nothing to ${verb}: ${where} hold nothing`, "Nothing was changed.");
  throw bounce(409, `${verb} which kind? ${where} hold ${edges.length} kinds`, `${where} hold ${listing}; say which with kind:. Nothing was changed.`, { kinds: edges.map((e) => e.kind) });
}

/**
 * THE POT-LUCK DRAW (18:44 item 6; the lead's settlements 2026-10-17). `n`
 * marks drawn without replacement from EVERYTHING a holder holds: its counted
 * kinds, each weighted by its count, and its whole marks, each counting 1 (a
 * holding is a set of marks, and a count is only its shorthand: 15:46). Every
 * step's number is `sha256(seed · step)` over the pool in one fixed order
 * (kinds by id, then whole marks by id), and the seed is the act's own
 * identity, so a replay of the act draws the same. Naming a kind narrows the
 * draw to what is that kind, by lineage (`extendsOf`): a kind of candy, or
 * a whole mark whose class is it. `things` are `[{ thing, class }]`.
 * Returns the kinds drawn with their counts, and the whole marks drawn.
 */
export function potLuck({ edges, things = [], n, seed, kind = null, extendsOf = () => null }) {
  const is = (c) => kind == null || (c != null && lineageOf(c, extendsOf).includes(String(kind)));
  const pool = [
    ...[...edges].sort((a, b) => (a.kind < b.kind ? -1 : 1)).filter((e) => is(e.kind)).map((e) => ({ kind: e.kind, count: e.count })),
    ...[...things].sort((a, b) => (a.thing < b.thing ? -1 : 1)).filter((t) => is(t.class)).map((t) => ({ thing: t.thing, count: 1 })),
  ];
  const held = pool.reduce((s, e) => s + e.count, 0);
  if (n > held) return { short: held };
  const drawn = new Map();
  const whole = [];
  for (let step = 0; step < n; step++) {
    const left = pool.reduce((s, e) => s + e.count, 0);
    const h = createHash("sha256").update(`${seed}·${step}`).digest();
    let r = Number(h.readBigUInt64BE(0) % BigInt(left));
    const hit = pool.find((e) => (r < e.count ? true : ((r -= e.count), false)));
    hit.count -= 1;
    if (hit.thing != null) whole.push(hit.thing);
    else drawn.set(hit.kind, (drawn.get(hit.kind) ?? 0) + 1);
  }
  return { drawn: [...drawn].map(([k, c]) => ({ kind: k, count: c })).sort((a, b) => (a.kind < b.kind ? -1 : 1)), things: whole.sort() };
}

/**
 * The seed of an act's draw (O2 gap G6): the act's own identity, as the
 * creatures' d20 is its trigger act's — its actor, its holder, its crossing,
 * its witness stamp (an object: serialized) and its ordinal, the number of
 * unit acts the record held when it was judged. Two takes by one resident
 * from one bowl in one spot are two ordinals, so they draw apart; a replay of
 * the act reads the same five and draws the same. Recorded on the act.
 */
export const drawSeed = ({ actor, from, crossing = null, at = null, ordinal = null }) =>
  [actor, from, crossing, typeof at === "string" ? at : JSON.stringify(at ?? null), ordinal].map((x) => String(x ?? "")).join("·");

/**
 * THE CANDIDATES, when `from` is omitted and several holders in reach hold the
 * kind: each by owner, id and distance, nearest first (18:44 item 4). `found`
 * is `[{ id, owner, distance_m }]`; exactly one is the answer, none or several
 * refuse with nothing changed.
 */
export function oneHolderOf(found, { kind = null, verb = "take" } = {}) {
  const what = kind == null ? "anything" : String(kind);
  if (found.length === 1) return found[0].id;
  if (!found.length) throw bounce(409, `nothing in reach holds ${what}`, `walk to a holder that does, or name it with from:. Nothing was changed.`);
  const sorted = [...found].sort((a, b) => a.distance_m - b.distance_m || (a.id < b.id ? -1 : 1));
  throw bounce(409, `${verb} from which? ${sorted.length} holders in reach hold ${what}`,
    `${sorted.map((c) => `${c.id} (${c.owner}'s, ${c.distance_m} m)`).join(", ")}: name one with from:. Nothing was changed.`,
    { candidates: sorted.map((c) => ({ id: c.id, owner: c.owner, distance_m: c.distance_m })) });
}

// ── THE PLANS ───────────────────────────────────────────────────────────────
//
// Each returns the act's `{ action, object, moves, edge }` or throws, nothing
// written. A transfer is ONE paired edge with two ends (11:12–11:14, ruled
// 16:02 item 7): one act, its `edge` naming giver and receiver, its moves the
// kinds that crossed it.

/** leave-mark { kind, count, to }: n marks of `kind` made into `to`. */
export function planMake({ actor, kind, n, to, via = "leave-mark" }) {
  return { action: UNIT_ACTION.make, object: String(to), via,
    moves: [{ from: null, to: String(to), kind: String(kind), n }], edge: { giver: null, receiver: String(to), maker: String(actor) } };
}

/**
 * take { from, kind?, count }: pot luck over everything the holder holds, or
 * narrowed to a kind, into the taker's hands. `things` are the whole marks it
 * holds (`[{ thing, class }]`); the plan's `things` are those the draw took,
 * each moved by its own holding act beside this one (the act records them).
 */
export function planTakeKinds({ fold, actor, from, kind = null, n, seed, things = [], extendsOf = () => null }) {
  const edges = kindEdgesOf(fold, from);
  const d = potLuck({ edges, things, n, seed, kind, extendsOf });
  if (kind != null && d.short === 0)
    throw bounce(409, `${from} holds no ${kind}`, edges.length || things.length ? `it holds ${blurOf({ edges, things: things.map((t) => t.class), extendsOf }).shows} of other kinds. Nothing was changed.` : "it holds nothing. Nothing was changed.");
  if (d.short != null) throw bounce(409, `${from} holds ${d.short}${kind == null ? "" : ` ${kind}`}, not ${n}`, "take at most what it holds. Nothing was changed.", { holds: d.short });
  return { action: UNIT_ACTION.take, object: String(from), draw: kind == null ? "pot luck" : `pot luck within ${kind}`,
    moves: d.drawn.map((x) => ({ from: String(from), to: String(actor), kind: x.kind, n: x.count })), things: d.things,
    edge: { giver: String(from), receiver: String(actor) } };
}

/** give { kind?, count, to }: from the giver's hands into a resident's or a holder's. */
export function planGiveKinds({ fold, actor, to, kind = null, n }) {
  if (to == null || to === "") throw bounce(422, "give to whom?", "to: a resident's handle, or a holder's id <by>/<slug>");
  if (String(to) === String(actor)) throw bounce(422, "you are already holding them", "give names another resident or a holder");
  const edge = selectKind(kindEdgesOf(fold, actor), kind, { where: "your hands", verb: "give" });
  if (edge.count < n) throw bounce(409, `you hold ${edge.count} ${edge.kind}, not ${n}`, "give at most what you hold. Nothing was changed.");
  return { action: UNIT_ACTION.give, object: String(to),
    moves: [{ from: String(actor), to: String(to), kind: edge.kind, n }], edge: { giver: String(actor), receiver: String(to) } };
}

// ── AFFORDED ACTIONS (18:06; 18:44 item 3) ──────────────────────────────────

/**
 * A class's afforded actions, nearest class first down its lineage: the
 * record's `actions` (`[{ action, who, from, effect }]`), parsed in either
 * spelling. The Halloween Candy Bowl declares `refill`; nothing else does.
 */
export function affordedActions(className, view) {
  const out = [];
  const seen = new Set();
  for (const c of lineageOf(className, view.extendsOf)) {
    const raw = view.record(c)?.actions;
    const list = typeof raw === "string" ? (() => { try { return JSON.parse(raw); } catch { return []; } })() : raw;
    for (const a of Array.isArray(list) ? list : []) {
      if (!a || typeof a.action !== "string" || seen.has(a.action)) continue;
      seen.add(a.action);
      out.push({ ...a, from_class: c });
    }
  }
  return out;
}
