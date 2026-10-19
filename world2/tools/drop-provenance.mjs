// drop-provenance.mjs — A DROPPED UNIT'S MARK IS PROVED AGAINST ITS ACT (WLD-27).
//
// Wright, 2026-10-13T01:19:15Z (AUTHORITY): the World's grammar is shape-only
// — it cannot see the store — so "at settlement, in the office fold/publication
// of the dropped mark, resolve `dropped: act:<N>` from the existing act log. It
// must exist, be the unit DROP act, and match BOTH mark author/act actor and
// candy label." An unproven reference withholds ONLY that mark, named
// `dropped-unit-unproven: act <N>`; the settlement is never failed or held.
//
// The act log is `acts` and the drop is `units:drop` (world-stacks.mjs §
// UNIT_ACTION.drop), class `holding`, actor the dropper, its one move
// `{ from: <dropper>, to: null, label, n: 1 }`. No second provenance store.

import { classChainOf } from "./standing.mjs";

export const UNIT_DROP = "units:drop";
export const DROP_REF = /^act:([1-9][0-9]*)$/;
/** acts.id is a Postgres bigint: the largest id an act can have. */
export const ACT_ID_MAX = 9223372036854775807n;

/**
 * The act id a `dropped:` reference names, as its exact decimal text, when it
 * is one an act could have; null when the reference is malformed or past the
 * bigint range (no act can carry it, so it is unproven without asking the
 * store). The text goes to the query as-is: no Number(), no rounding.
 */
export function dropRefId(ref) {
  const m = DROP_REF.exec(String(ref ?? ""));
  if (!m) return null;
  return BigInt(m[1]) <= ACT_ID_MAX ? m[1] : null;
}

/**
 * Is this pending claim a resident's candy mark (a unit set down)? The town's own candy is not.
 * In either form (LOGOS v2 part 2, W2): `kind: sited` + `class: candy` (the
 * claim's `class` is the mark's kind, its `data.class` the class), or `kind: candy`.
 * And by lineage: a class whose chain in `classes` (standing.mjs § classLayerOf)
 * reaches candy is candy, so a kind of candy is proved as candy is.
 *
 * IN A SKEW ONLY `candy` ITSELF IS CAUGHT: when the store's pens disagree on the
 * commit, `classLayerVia` hands the clearing no layer (null), and a subclass of
 * candy goes unproved. Acceptable today because W2's class tree has no class
 * under candy; the day it has one, a skew lets that kind's drop pass unchecked.
 */
export const isCandyClaim = (c, classes = null) => {
  const chainOf = classes ? (name) => classChainOf(classes, name) : null;
  return c?.claimant !== "the-town"
    && (isCandyClass(c?.class, chainOf)
      || ((c?.class === "sited" || c?.class == null) && isCandyClass(c?.data?.class, chainOf)));
};

/**
 * Is this class candy, itself or by lineage? THE ONE RULE's class half (POS-692):
 * the clearing asks it of every pending claim (above) and the leave door of every
 * classed mark (src/world.mjs § leaveMarkAct), each through its own reader of the
 * class layer: `chainOf(name)` is the class's lineage, itself first (the store's
 * `classChainOf` here, the law snapshot's `lineageOf` at the door). With none,
 * only `candy` itself is known.
 */
export const isCandyClass = (name, chainOf = null) => name != null
  && (String(name) === "candy" || (chainOf ? chainOf(String(name)).includes("candy") : false));

/**
 * The refusal check for one candy claim, given the act its reference names (or
 * null when there is none), or null when it is proved. PURE.
 */
export function dropProvenanceCheck(claim, act) {
  const d = claim?.data ?? {};
  const m = DROP_REF.exec(String(d.dropped ?? ""));
  if (!m) return "dropped-unit-unproven: no act";
  const n = m[1];
  const fail = `dropped-unit-unproven: act ${n}`;
  if (!act) return fail;                                             // fabricated: no such act
  if (act.action !== UNIT_DROP || act.class !== "holding") return fail; // not the unit drop
  if (String(act.actor) !== String(claim.claimant)) return fail;    // another hand's drop
  const p = act.payload ?? {};
  const moved = Array.isArray(p.moves) ? p.moves.find((x) => x?.to == null) : null;
  const label = p.label ?? moved?.label ?? null;
  if (label == null || String(label) !== String(d.label)) return fail; // another label
  if (moved && moved.from != null && String(moved.from) !== String(claim.claimant)) return fail;
  return null;
}

/**
 * THE ONE PROOF (POS-692): one candy claim's refusal check, its act read from
 * `acts`, or null when it is proved. A reference no act id could carry is
 * refused without asking the store. The clearing asks it of every pending candy
 * claim (below); the leave door asks it of a candy mark before filing one, so
 * the door never takes a candy the clearing will refuse. `q(sql, params)`
 * answers `{ rows }`.
 */
export async function dropRefusalOf(q, claim) {
  const id = dropRefId(claim?.data?.dropped);
  let act = null;
  if (id != null) {
    const { rows } = await q("SELECT id, action, class, actor, payload FROM acts WHERE id = $1::bigint", [id]);
    act = rows[0] ?? null;
  }
  return dropProvenanceCheck(claim, act);
}

/**
 * Every pending candy claim, checked against `acts` in the clearing's own
 * transaction. `refuse(claim, check)` is the clearing's refuse-alone: the claim
 * is refused with the named check and goes on the window's unfileable list.
 */
export async function checkDroppedUnits(q, pending, { decided = () => false, refuse, classes = null }) {
  const refused = [];
  for (const c of pending) {
    if (decided(c) || !isCandyClaim(c, classes)) continue;
    const check = await dropRefusalOf(q, c);
    if (check) { refuse(c, check); refused.push({ id: c.id, check }); }
  }
  return refused;
}
