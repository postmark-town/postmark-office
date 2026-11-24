// mark-repair.mjs — AN OPERATOR AMENDS OR WITHDRAWS A MARK THAT IS NOT THEIRS (POS-1025, the office half of POS-365).
//
//   household { do: "repair-mark", args: { mark: "<by>/<slug>", act: "amend" | "withdraw", reason,
//                                          handle?, as?: "town", …for an amend, the fields a resident's own amend sends } }
//
// ── THE RULINGS ─────────────────────────────────────────────────────────────
//
// POS-365/a adopted the recommendation that an operator "files the claim on the mark's household's behalf" rather
// than writing a letter asking the household. Darko's POS-1025/b, "Both" (2026-11-13, authenticated on the issue by
// Wright at 20:11Z): an operator may AMEND and WITHDRAW an existing mark without its resident's consent, through the
// clearing, with a named hand, a reason and a receipt; the economy is unchanged and no stamp moves. The build
// disposition (item 7): the owner is the mark's own author, the hand is the trusted credential's, the route is
// `operator`; law and class marks are refused; there is no economic override.
//
// ── WHO MAY CALL IT ─────────────────────────────────────────────────────────
//
// The town's hands (town-stance.mjs § TOWN_HANDS: darko, wright, the Worldkeeper), each judged against the credential
// itself (POS-389, named-hand.mjs § holdsHand), never a housemate it lists. An operator act, so it is unlisted
// (household-apex.mjs § OPERATOR_ACTS): to any other key it answers as a name the door has never heard of.
//
// ── WHAT IT WRITES ──────────────────────────────────────────────────────────
//
// The mark's own amend or withdrawal, through the very door a resident's goes through (world.mjs § leaveMarkAct,
// withdrawMarkViaOffice), every guard included, filed as the mark's author and under their household, so the clearing
// judges it as theirs and the settlement prints what the clearing decided. The operator is the act's HAND, the author
// its FOR, and its route is `operator` (079; act-provenance.mjs § withOperator): the scope carries them, never a field
// a caller sends. The reason rides the act (an amend's `_repair_reason`, a withdrawal's `cause.repair`), and the
// receipt names the hand, the reason and what was filed.
//
// A town mark (`by: the-town`) is repaired only AS THE TOWN, and only when `as: "town"` says so: never inferred from
// the key (town-stance.mjs § AS_TOWN). As the town the operator is the town's pen, the road the town's own classes
// arrive by, so the class's `makers` gate does not hold it back; every other guard does.
//
// ── WHAT IT REFUSES, AND WRITES NOTHING ─────────────────────────────────────
//
//   · a mark canon does not hold: a repair is of a mark that stands in the world
//   · a law or class mark (tier constitution): law-ingest's, never a repair's
//   · a town mark without `as: "town"`, and `as: "town"` on a resident's mark
//   · any stake. A repair moves no stamp: an amend is filed at ✦0, PREVIEWED FIRST, and refused when the preview says
//     it would not publish (the ground's minimum is not met by the mark's own escrow); the town-signpost tool's
//     applyGate (POS-606) is the precedent
//   · a withdrawal of a mark with escrow on it (the withdraw door's own guard: the stamps are their holders'), or of a
//     set-down unit or holder (only its dropper's withdrawal returns it)
//   · off the store's single-log path (WORLD_SINGLE_LOG=1), where the clearing is not the writer and no verdict is ruled

import { holdsHand } from "./named-hand.mjs";
import { AS_TOWN, LAW_TIER, TOWN, TOWN_HANDS } from "./town-stance.mjs";

export const REPAIR_ACTS = Object.freeze(["amend", "withdraw"]);
/** The amend's own fields, the ones a resident's amend sends (leave-mark's), less the stake and the actor. */
export const REPAIR_AMEND_FIELDS = Object.freeze(["body", "kind", "class", "at", "extent", "points", "slot", "value", "parent_id", "image"]);

const bounce = (code, defect, hint) => Object.assign(new Error(defect), { code, defect, hint });

/** The repair door's gate (OPERATOR_ACTS § may): a key holding one of the town's hands as its own. */
export const callerMayRepair = (key) => TOWN_HANDS.some((h) => holdsHand(key, h));

/** The operator's hand: the named one when this credential holds it, else its one town hand. */
export function repairHand(args, key) {
  const held = TOWN_HANDS.filter((h) => holdsHand(key, h));
  const named = args?.handle == null ? "" : String(args.handle).trim();
  if (named) {
    if (!held.includes(named)) throw bounce(403, `"${named}" is not a hand this key holds that may repair a mark`, `this key repairs as: ${held.join(", ") || "(none)"}`);
    return named;
  }
  if (held.length > 1) throw bounce(422, "which hand is repairing?", `pass handle: one of ${held.join(", ")}`);
  return held[0];
}

/**
 * The plan, PURE: `canonMark` as canon holds it (world.mjs § canonForGuards), or null. Answers
 * `{ act, by, slug, asTown, reason }`, or throws the refusal by name.
 */
export function repairPlan(args, canonMark) {
  const act = String(args?.act ?? "").trim();
  if (!REPAIR_ACTS.includes(act)) throw bounce(422, "`act` must be amend or withdraw", 'household { do: "repair-mark", args: { mark, act: "amend" | "withdraw", reason, … } }');
  const reason = typeof args?.reason === "string" ? args.reason.trim() : "";
  if (!reason) throw bounce(422, "a repair needs a `reason`", "the resident whose mark this is reads it on the act; a repair with no stated cause is what this door exists to prevent");
  if (reason.length > 500) throw bounce(422, `the reason is ${reason.length} characters; the cap is 500`, "say why in a few sentences");
  const id = String(args?.mark ?? "").trim();
  const cut = id.indexOf("/");
  if (cut < 1 || cut === id.length - 1) throw bounce(422, "which mark?", "pass mark: '<by>/<slug>', the id canon names it by");
  const by = id.slice(0, cut), slug = id.slice(cut + 1);
  if (!canonMark) throw bounce(404, `no mark "${id}" stands in the world`, "a repair is of a mark the world carries; a resident's own draft is theirs to change. Nothing was written.");
  if (canonMark.tier === LAW_TIER) throw bounce(422, `"${id}" is law (tier ${LAW_TIER})`,
    "law and class marks are written by law-ingest's own road and its review, never by a repair. Nothing was written.");
  const asTown = args?.as === AS_TOWN;
  if (args?.as !== undefined && !asTown) throw bounce(422, `as: "${args.as}" is not a word this door knows`, `the one word is as: "${AS_TOWN}", for a town mark`);
  if (by === TOWN && !asTown) throw bounce(422, `"${id}" is the town's mark`, `a town mark is repaired as the town, and only when you say so: pass as: "${AS_TOWN}". Nothing was written.`);
  if (by !== TOWN && asTown) throw bounce(422, `"${id}" is ${by}'s mark, not the town's`, `as: "${AS_TOWN}" is for the town's own marks; drop it to repair a resident's. Nothing was written.`);
  if (args?.stamps !== undefined) throw bounce(422, "a repair moves no stamp", "drop stamps: the amend is filed at ✦0 and publishes on what already stands behind the mark, or not at all. Nothing was written.");
  if (act === "withdraw") {
    const extra = REPAIR_AMEND_FIELDS.filter((f) => args?.[f] !== undefined);
    if (extra.length) throw bounce(422, `a withdrawal carries no ${extra.join(", ")}`, "those are an amend's; pass act: \"amend\" to change the mark instead");
  }
  return { act, id, by, slug, asTown, reason };
}

/** Whether an amend's preview says it would publish, or the refusal's words (town-signpost-amend.mjs § applyGate). */
export function repairGate(preview) {
  if (preview?.would !== "amend") return `the office's preview would not amend this mark (${JSON.stringify(preview?.would ?? null)}); nothing written`;
  if (preview.put_forward !== true)
    return "the amend would stand as a draft, not the town's canon, and not publish: the ground it stands on asks a stake the mark's own escrow does not meet, and a repair moves no stamp. Nothing was written; its resident can stake it, or the ground's rule decides";
  return null;
}

/** The door: `household { do: "repair-mark", args }`, behind OPERATOR_ACTS' gate. */
export async function repairMarkAtOffice(args = {}, key = null, deps = {}) {
  const world = deps.world ?? await import("./world.mjs");
  const { singleLogEnabled } = deps.store ?? await import("./dynamic-store.mjs");
  const { withOperator } = await import("./act-provenance.mjs");
  const hand = repairHand(args, key);
  if (!singleLogEnabled()) throw bounce(409, "a repair is filed only on the store's single-log path",
    "WORLD_SINGLE_LOG is off on this office, so the clearing is not the writer and no publish verdict is ruled. Nothing was written.");
  const id = String(args?.mark ?? "").trim();
  let canonMark = null;
  try { canonMark = world.canonForGuards().byId.get(id) ?? null; } catch (e) {
    const { faultLogged } = await import("./fault-words.mjs");
    throw bounce(503, "the office could not read the world, so it cannot tell what this mark is", `nothing was written; try again shortly — ${faultLogged("the repair's world read tripped", e)}`);
  }
  const plan = repairPlan(args, canonMark);
  const household = plan.asTown ? TOWN : (await (deps.pinnedLoginOf ?? (await import("./households.mjs")).pinnedLoginOf)(plan.by));
  if (!household) throw bounce(422, `the office cannot tell which household "${plan.by}" belongs to`,
    "a repair is filed under the mark's own household, read from the store's pins; this handle has none, or the store could not be read. Nothing was written.");
  const operator = { hand, reason: plan.reason, household, asTown: plan.asTown };
  const receipt = { repaired: plan.id, act: plan.act, hand, for: plan.by, household, reason: plan.reason, route: "operator" };

  if (plan.act === "withdraw") {
    const result = await withOperator(hand, () => world.withdrawMarkViaOffice(world.WORLD_CLONE, { mark: plan.id }, key, { operator }));
    return { ...receipt, result };
  }
  const payload = { by: plan.by, slug: plan.slug, amend: true, stamps: 0 };
  for (const f of REPAIR_AMEND_FIELDS) if (args[f] !== undefined) payload[f] = args[f];
  // THE PREVIEW FIRST, ALWAYS: every guard and the publish verdict, nothing written
  const preview = await withOperator(hand, () => world.leaveMarkViaOffice(world.WORLD_CLONE, { ...payload, preview: true }, key, { operator }));
  if (preview?.error) return { ...preview, repair: receipt };
  const gate = repairGate(preview);
  if (gate) throw bounce(409, "this repair would not publish", gate);
  const result = await withOperator(hand, () => world.leaveMarkViaOffice(world.WORLD_CLONE, payload, key, { operator }));
  if (result?.error) return { ...result, repair: receipt };
  return { ...receipt, result };
}
