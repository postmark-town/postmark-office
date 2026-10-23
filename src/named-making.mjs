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
// it. Setting one down (part 2, /e, built on the lead's P2 word 2026-10-23) files
// it as a sited draft keeping its maker's id, where the dropper stands, and the
// hold face `set-down` ends the holding: from that act it is a mark like any
// other (a draft until it publishes), so the made record lets it go.
//
// PURE: the record, the fold and the words. The door is world.mjs § the `to:`
// branch of leaveMarkAct; the act is world-kinds.mjs § makeNamed.

import { HOLDER_FIELDS } from "./kind-holding.mjs";

/** The hold face a named make writes, and the one a named thing is eaten by (guard-reads § HOLD_FACES). */
export const MAKE_FACE = "make";
export const CONSUME_FACE = "consume";
/** The hold face that sets one down: the holding ends, and its draft carries the place (POS-766/e). */
export const SET_DOWN_FACE = "set-down";

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
      hint: `it is published by its holder at once, free. Leave stamps off. Set down later by its maker's house, it costs the usual 1 stamp on the commons, free on your own ground. Nothing was made.` };
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
 * Every make ever is kept, eaten ones too: an id is never reused (G2). A thing
 * SET DOWN leaves it (/e): it is a draft of its maker's now, and the docket and
 * canon carry its name from that act.
 */
export function foldMade(holding = [], base = null) {
  const out = new Map(base ?? []);
  for (const r of holding ?? []) {
    if (r?.action === SET_DOWN_FACE) { const id = r.object ?? r.payload?.thing; if (id != null) out.delete(String(id)); continue; }
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

// ── SETTING ONE DOWN (POS-766/e; P2-a..e on the lead's word, 2026-10-23) ─────

/** The extent a thing made in hand is set down with: it never had one, so the thing default (P2-c). */
export const SET_DOWN_EXTENT = Object.freeze({ w: 1, h: 1 });

/**
 * P2-a: the maker's house sets it down, because the draft it becomes is its
 * maker's own, in its maker's live layer. The key that drops it must act for its
 * maker; anyone else holding it is told what they can do.
 */
export function setDownNotByMaker(id, maker) {
  return { code: 403, defect: `${id} was made by ${maker}, and a thing made in hand is set down only by its maker's house`,
    hint: `it becomes ${maker}'s own draft where it is set down, so only ${maker}'s house files it. Give it back to its maker's house to set down, or keep, give or eat it (consume { thing: "${id}" }, if it is a consumable). Nothing was changed.` };
}

/** P2-d: a draft holds nothing until it publishes, so a holder is set down empty. */
export function setDownHolding(id, n) {
  return { code: 409, defect: `${id} holds ${n} ${n === 1 ? "thing" : "things"}, and a holder is set down empty`,
    hint: `set down, it is a draft until the next settlement, and a draft holds nothing. Take out what it holds first (take { from: "${id}" }), then set it down. Nothing was changed.` };
}

/** A candy on the ground is a proved set-down unit's (POS-692, drop-provenance): a named candy is eaten or given, not set down. */
export function setDownCandy(id, kind) {
  return { code: 422, defect: `${id} is a ${kind}, a kind of candy, and candy is not set down on the ground`,
    hint: `the clearing stands a candy on the ground only where a counted unit was set down, so a candy made in hand stays in hands and holders: eat it (consume { thing: "${id}" }), give it, or give it into a bowl. Nothing was changed.` };
}

/**
 * The draft a set-down files, as leave-mark's own payload: the made record whole,
 * sited where the dropper stands, by its maker. `free` is the drop-stake verdict
 * (the maker's own ground): there it is put forward with nothing to buy
 * (stamps: 0); on the commons it is left a draft and the dropper's stamp is staked
 * behind it after, as a published thing's set-down is (world-hold § stakeTheDrop).
 */
export function setDownDraftOf(made, { at, free }) {
  const { id: _id, by, slug, kind, body, household: _h, date: _d, ...own } = made;
  return { slug, kind, body, ...own, by, at: { x: at.x, y: at.y }, extent: { ...SET_DOWN_EXTENT }, ...(free ? { stamps: 0 } : {}) };
}

/**
 * The words a set-down answers with. `stake`: "free" (the maker's own ground),
 * "staked" (the dropper's stamp stands behind it) or "bounced" (asked, and the
 * stake did not land: the answer's `stake_bounce` carries the call that does).
 */
export function setDownWords({ id, maker, stake }) {
  if (stake === "staked") return `${id} is set down where you stood, as ${maker}'s draft, with your stamp behind it: it publishes at the next settlement`;
  if (stake === "bounced") return `${id} is set down where you stood, as ${maker}'s draft, but the stamp did not land: it publishes only with one behind it (stake_bounce has the call)`;
  return `${id} is set down where you stood, as ${maker}'s draft, on its own ground, free: it publishes at the next settlement`;
}

/**
 * THE MADE NAMES, OR WHY THEY COULD NOT BE READ (#759 review A: fail closed).
 * `{ made }` is the made record; where the hold lane is not on the record
 * (`edgeOn` false) nothing can have been made, so it is empty. `{ unread }`
 * when the record is kept and could not be read: a door that asks whether a
 * name was made in hand refuses then, never guesses "no" (a ground mark under
 * a made name would hide the held thing, canon winning the overlay).
 */
// `reasonOf` is the caller's (world.mjs hands in fault-words § plainReason): this file reads no error text
export async function madeNamesRead({ ids, edgeOn, query, reasonOf = () => "the record did not answer" }) {
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
 * lane's makes and set-downs naming these ids, oldest first (a set-down lets the
 * name go to its draft, foldMade's own rule). Narrow on purpose (an index
 * step on class, then the ids), and in the shape every reader of `acts` uses.
 */
export const MADE_NAMES_SQL = "SELECT id, action, object, payload FROM acts WHERE class = $1 AND action = ANY($2) AND object = ANY($3) ORDER BY id";
export const madeNamesParams = (ids) => ["holding", [MAKE_FACE, SET_DOWN_FACE], ids];

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
