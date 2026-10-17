// chests-candy.mjs — WLD-27's chest and candy doors, behind one flag that defaults OFF.
//
// Office #499 (WLD-27) built chests and candy on candy LABELS, and is merged
// into train/2026-w43. Darko ruled the label version out (LOGOS v2: candy
// kinds are subclasses, the chest class dissolves into `holder`), and said at
// 12:56 on 2026-10-16: "#499 still needs a fallback". So its doors ship dark
// until the rebuilt ones replace them:
//
//   the counted-unit door   world_hold's take/give/drop by label, consume and
//                           refill (world-units.mjs § callUnits) refuse;
//   a resident's chest      leave_mark { class: "chest" } refuses
//                           (world.mjs § leaveMarkViaOffice);
//   the reads               the doorstep's `holds`, GET /world/chests and
//                           world_holdings' `units` offer nothing;
//   the tick                the first stock writes nothing
//                           (world2/tools/settlements-backfill.mjs § stockedOnTick).
//
// ON is `WORLD_CHESTS_CANDY=1` in /etc/postmark-office.env (deploy/DEPLOY.md §
// The chest and candy doors). Any other value, or none, is OFF.

export const CHESTS_CANDY_ENV = "WORLD_CHESTS_CANDY";

/** Whether WLD-27's chest and candy doors are open at this office. */
export const chestsCandyOn = (env = process.env) => env[CHESTS_CANDY_ENV] === "1";

/**
 * The office's own words for a closed door: what it is, where its work is done now, and that nothing
 * changed. Candy itself is open: LOGOS v2's kind doors are live (Darko 2026-10-17 10:22), so "chests
 * and candy aren't open in town yet", said beside a candy refill that works, was false (the
 * playground's QA of part 2, I1c). What is closed is #499's chest-and-label spelling.
 */
export const CHESTS_CANDY_OFF = Object.freeze({
  code: 409,
  defect: "the older chest-and-label doors are closed",
  hint: "candy works by kind now: leave-mark { kind, count, to } makes it, and take, give, refill and consume name a kind and a holder (to:, from: or thing:, never chest: or label:); a chest is any thing made with holder: true — nothing was changed",
});

/** The refusal as the doors throw it: a refusal-shaped error every door's catch already sends. */
export function chestsCandyOffError() {
  return Object.assign(new Error(CHESTS_CANDY_OFF.defect), { ...CHESTS_CANDY_OFF });
}
