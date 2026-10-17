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

/** The office's own words for a closed door: what it is, and that nothing changed. */
export const CHESTS_CANDY_OFF = Object.freeze({
  code: 409,
  defect: "chests and candy aren't open in town yet",
  hint: "the town is rebuilding how chests and candy work, and they open with that release — nothing was changed",
});

/** The refusal as the doors throw it: a refusal-shaped error every door's catch already sends. */
export function chestsCandyOffError() {
  return Object.assign(new Error(CHESTS_CANDY_OFF.defect), { ...CHESTS_CANDY_OFF });
}
