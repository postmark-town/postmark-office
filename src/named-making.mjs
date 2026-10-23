// named-making.mjs — ONE NAMED THING, MADE STRAIGHT INTO HANDS OR A HOLDER
// (POS-766, ruled by Darko 2026-10-22 21:55 and 2026-10-23 00:15).
//
// "leave-mark with to: (your hands, or a holder you're at) plus a slug, body or
// anything of its own makes ONE named mark, held. With kind and count it stays
// the batch form, so there's no new verb." Free and live: it is published by
// its holder at once (LOGOS classes.md § "Holders confer their state on what
// they hold"), with no commons stake and no settlement wait. Hands still hold 24.
//
// ── WHERE IT LIVES (POS-766/d, "Store, overlaid") ───────────────────────────
//
// In the store, as the make act's own record: a hold-lane act `make` whose
// payload carries the mark whole (`made`). The hold record reads it as a hold
// row like any give (guard-reads § HOLD_FACES), so who holds it, what a holder
// holds, the draws and the room are the same machinery a published thing in a
// holder already runs on. The mark itself is laid into the one world by the
// overlay every resident read already asks (held.mjs § unplaceHeld, POS-688):
// a held thing, published but unplaced. It is not printed into WORLD/ while it
// is held, as counted units are not (the unit precedent).
//
// An id is never reused: the made record keeps every make, eaten ones too, so
// a slug once made in hand is taken for good (G2).
//
// Eating one (POS-766/f) is the hold lane's `consume` face: the holding ends
// (policy detach, with no place, so nothing is set down) and the overlay drops
// it. Setting one down on the ground is part 2 of POS-766 (/e) and is refused
// here, by name, until it lands.
//
// PURE: the record, the fold and the words. The door is world.mjs § the `to:`
// branch of leaveMarkAct; the act is world-kinds.mjs § makeNamed.

import { HOLDER_FIELDS } from "./kind-holding.mjs";

/** The hold face a named make writes, and the one a named thing is eaten by (guard-reads § HOLD_FACES). */
export const MAKE_FACE = "make";
export const CONSUME_FACE = "consume";

/**
 * What makes a `to:` call the NAMED form: any field of the mark's own. `kind`
 * and `count` are the batch form's; a named thing takes `kind` too (its class).
 */
export const NAMED_OWN = Object.freeze(["slug", "body", ...HOLDER_FIELDS, "image"]);

/** A place: never carried by a thing made into hands or a holder (G10). */
export const PLACE_FIELDS = Object.freeze(["at", "extent", "points"]);

/** Never taken with to:, each refused by name (G4, G6, G7). */
export const NAMED_REFUSED = Object.freeze(["slot", "value", "parent_id", "amend", "consent", "placed_by", "tier", "ask", "reward", "status", "label", "dropped"]);

const sent = (payload, fields) => fields.filter((k) => payload?.[k] !== undefined);

/** True when this `to:` call names anything of its own: the named form. */
export const isNamedForm = (payload = {}) => sent(payload, NAMED_OWN).length > 0;

/**
 * The words for a `to:` call that mixes the forms, or names what the named form
 * never takes. Null when the call is well formed. `by` is the maker, for the
 * call that works.
 */
export function namedFormRefusal(payload = {}, by = "<you>") {
  const own = sent(payload, NAMED_OWN);
  const place = sent(payload, PLACE_FIELDS);
  if (place.length)
    return { code: 422, defect: `a thing made into hands or a holder has no place: ${place.join(", ")} ${place.length === 1 ? "is" : "are"} for a mark on the ground`,
      hint: `with to:, the thing is held from the moment it is made, so it stands nowhere. To leave a mark on the ground, leave to: off. Nothing was made.` };
  if (own.length && payload.count !== undefined)
    return { code: 422, defect: `count makes that many alike, with nothing of their own, and ${own.join(", ")} ${own.length === 1 ? "is" : "are"} one thing's own`,
      hint: `two forms, one verb: leave-mark { kind, count, to } makes that many of a kind, none named; leave-mark { slug, body, kind?, to } makes ONE thing of your own, named, held, free and live. Send count without slug and body, or slug and body without count. Nothing was made.` };
  const refused = sent(payload, NAMED_REFUSED);
  if (own.length && refused.length) {
    const why = refused.includes("parent_id") || refused.includes("slot") || refused.includes("value")
      ? "a detail laid on a mark (slot, value, parent_id) is its own predicated mark, left on a mark that stands on the ground"
      : refused.includes("amend")
        ? "a thing made in hand is not amended: its words are set when it is made"
        : refused.includes("consent") || refused.includes("placed_by")
          ? "consent and placed_by are a placer's, for a resident's first parcel"
          : refused.includes("tier")
            ? "standing is derived from the ground, and a thing made in hand stands on none"
            : "those fields belong to other kinds of mark";
    return { code: 422, defect: `a thing made into hands or a holder carries no ${refused.join(", ")}`,
      hint: `${why}. A named thing takes slug, body, kind (a kind of thing, thing by default), ${HOLDER_FIELDS.join(", ")} and image. Nothing was made.` };
  }
  if (own.length && Number(payload.stamps ?? 0) > 0)
    return { code: 422, defect: "a thing made into hands or a holder costs nothing, so there is nothing to stake",
      hint: `it is published by its holder at once, free. Leave stamps off. Setting a made thing down comes next: the usual 1 stamp on the commons, free on your own ground. Nothing was made.` };
  return null;
}

/**
 * The mark a named make carries, whole: the record the overlay lays into the
 * world. `kind` is the class it is an instance of (the new form, LOGOS v2 part
 * 2: `kind: <class>`, no `class:` line), `holder` its own sovereign holder
 * fields as the leave door judged them (kind-holding.mjs § holderWordOf).
 */
export function madeRecordOf({ by, slug, kind, body, holderFields = null, image, household = null, date = null }) {
  return {
    id: `${by}/${slug}`, by: String(by), slug: String(slug), kind: String(kind), body: String(body).trim(),
    ...(holderFields ?? {}), ...(image !== undefined ? { image: String(image) } : {}),
    ...(household ? { household: String(household) } : {}), ...(date ? { date: String(date) } : {}),
  };
}

const isMarkId = (v) => typeof v === "string" && v.includes("/");

/**
 * THE MADE RECORD, folded: `Map(id → the mark it was made as)` from hold rows
 * (guard-reads § holdingRowOf: `action`, `object`, `payload`), on top of
 * `base` (copied, never mutated), so a kept base and its window fold alike.
 * Every make ever is kept, eaten ones too: an id is never reused (G2).
 */
export function foldMade(holding = [], base = null) {
  const out = new Map(base ?? []);
  for (const r of holding ?? []) {
    if (r?.action !== MAKE_FACE) continue;
    const m = r.payload?.made;
    const id = r.object ?? r.payload?.thing;
    if (!m || typeof m !== "object" || !isMarkId(id) || m.id !== id) continue;
    out.set(String(id), m);
  }
  return out;
}

/** A sentence for the make, as the act log and the answer say it. */
export const madeWords = ({ actor, id, to }) => (String(to) === String(actor)
  ? `${actor} made ${id} into their own hands: held, live and free`
  : `${actor} made ${id} into ${to}: held, live and free`);

/** A sentence for eating one. */
export const eatenWords = ({ actor, id }) => `${actor} consumed ${id}; it is used up and gone, and its name is never made again`;

/** Part 2's refusal (POS-766/e): a named thing made in hand is not set down yet. */
export function setDownNotYet(id) {
  return { code: 501, defect: `${id} was made in hand, and setting a thing made in hand down is not built yet`,
    hint: `give it to a resident or into a holder (give { thing: "${id}", to }), or eat it if it is a consumable (consume { thing: "${id}" }). Setting a made thing down comes next: it is not built yet (the usual 1 stamp on the commons, free on your own ground). Nothing was changed.` };
}

/**
 * THE MADE NAMES, OR WHY THEY COULD NOT BE READ (#759 review A: fail closed).
 * `{ made }` is the made record; where the hold lane is not on the record
 * (`edgeOn` false) nothing can have been made, so it is empty. `{ unread }`
 * when the record is kept and could not be read: a door that asks whether a
 * name was made in hand refuses then, never guesses "no" (a ground mark under
 * a made name would hide the held thing, canon winning the overlay).
 */
export async function madeNamesRead({ ids, edgeOn, query, reasonOf = (e) => String(e?.message ?? e) }) {
  const want = [...new Set([...(ids ?? [])].filter((x) => x != null).map(String))];
  if (!want.length || !edgeOn()) return { made: new Map() };
  try {
    const rows = await query(MADE_NAMES_SQL, madeNamesParams(want));
    if (!Array.isArray(rows)) return { unread: "this office is not pointed at the record" };
    return { made: foldMade(rows.map((r) => ({ seq: r.id, action: r.action, object: r.object, payload: r.payload }))) };
  } catch (e) { return { unread: reasonOf(e) }; }
}

/**
 * THE ONE READ the made names are asked by, at a door that writes: the hold
 * lane's makes naming these ids, oldest first. Narrow on purpose (an index
 * step on class, then the ids), and in the shape every reader of `acts` uses.
 */
export const MADE_NAMES_SQL = "SELECT id, action, object, payload FROM acts WHERE class = $1 AND action = ANY($2) AND object = ANY($3) ORDER BY id";
export const madeNamesParams = (ids) => ["holding", [MAKE_FACE], ids];

/** The refusal when the made names could not be read: nothing written, try again. */
export function madeNamesUnread(unread) {
  return { code: 503, defect: "the office could not read the hold record, so it cannot tell whether that name was made in hand",
    hint: `nothing was written; try again shortly (${unread})` };
}

/** A slug once made in hand stays taken (G2): the words for a leave or a make that reuses one. */
export function madeIdTaken(id) {
  return { code: 409, defect: `${id} is a thing made in hand, and its name is taken for good`,
    hint: `a slug is unique per author, and a thing made in hand keeps its name forever, eaten or not. Pick another slug. Nothing was made.` };
}
