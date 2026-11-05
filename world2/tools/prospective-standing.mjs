// prospective-standing.mjs — HOW A CLAIM WILL STAND, ASKED BEFORE IT STANDS.
//
// The candle's escrow gate (clearing-job.mjs § 5.5) asks the standing walk about
// claims that are not marks yet: the standing rows, with each claim laid on the
// world in place of the row it continues, walked prospectively. That walk input
// was composed inline in the clearing, so no door could ask the same question
// without writing a second copy of it. It lives here now, so the candle and the
// stake door (src/world-stake.mjs § THE GROUND, JUDGED; POS-674) read ONE walk.
//
// NOTHING HERE IS A RULE. The rule is `standing.mjs § markStanding` →
// `groundVerdict`, reached through `computeStanding`, and `escrow-presence.mjs §
// rowClassOf` maps its answer to the sweep's row class. This file only lays the
// claims on the world the way 5.5 lays them:
//
//   · a claim REPLACES the standing row of its slug (WLD-51: a claim that moves a
//     standing mark must not stand in the walk twice, at its old place and its new);
//   · an amend stands under the uuid of the row it continues, so a predicate whose
//     `parent` edge names that row still resolves (review-550, finding 4);
//   · a rider the carry moves stands where the carry puts it (`carried`);
//   · a row whose GROUND this window moves leaves the GiST's answer and is walked
//     the long way (standing.mjs § the candidate set).
//
// The clearing's escrow gate reads it (POS-701), and so does the stake door;
// test/prospective-standing.test.mjs holds the door's answers equal to the
// clearing's refusals over one set of rows.

import { computeStanding, gistContainment } from "./standing.mjs";
import { ownerHouseholdFor, liveHouseOfVia, slugOf } from "./materialize.mjs";

/** The standing rows the walk resolves against: 5.5's own SELECT. */
export const STANDING_ROWS_SQL =
  `SELECT id::text, slug, kind, owner, household, geometry, parent::text, data
     FROM marks WHERE status = 'standing'`;

// Does a geometry stand on the same ground as another? `at`, `extent` and the
// ring: a words-only amend answers yes, a move or a resize answers no.
const groundOf = (g) => JSON.stringify([
  g?.at ? [Number(g.at.x), Number(g.at.y)] : null,
  g?.extent ? [Number(g.extent.w), Number(g.extent.h)] : null,
  Array.isArray(g?.points) ? g.points : null,
]);
export const sameGround = (a, b) => groundOf(a) === groundOf(b);

// The GiST's answer with some slugs taken out of it: those are walked the long
// way as inners and offered to every mark as outers (standing.mjs § the
// candidate set). Null (no index) stays null.
export function withoutSlugs(containment, slugs) {
  if (!containment || !slugs.size) return containment;
  const covered = new Set([...containment.covered].filter((s) => !slugs.has(s)));
  const pairs = new Map();
  for (const [inner, outers] of containment.pairs)
    if (!slugs.has(inner)) pairs.set(inner, outers.filter((o) => !slugs.has(o)));
  return { ...containment, covered, pairs };
}

/**
 * A claim row, in the `marks` row shape the walk reads. `continues` is the
 * standing row an amend continues (the clearing's `amends`), or null. The
 * claimant's house is asked of the store (`ownerHouseholdFor`), and its refusal
 * is the caller's to handle: the clearing has already refused houseless claims
 * at 5.4, and a door decides for itself.
 */
export async function candidateRowOf(q, c, { continues = null } = {}) {
  return {
    id: continues?.id ?? String(c.id), slug: slugOf(c), kind: c.class, owner: c.claimant,
    household: await ownerHouseholdFor(q, c.claimant),
    geometry: c.geometry, parent: c.parent, data: c.data,
  };
}

/**
 * computeStanding over the world as these claims would leave it → Map slug → tier.
 *
 * `candidates` are `candidateRowOf` rows. `only` is the answer set (default:
 * every candidate). `classes` is the class layer the caller read
 * (`classLayerVia`); `q` is the caller's own query function, so the walk sees the
 * rows its transaction sees.
 */
export async function prospectiveTiers(q, { candidates, carried = new Map(), only = null, classes = null }) {
  const { rows: standing } = await q(STANDING_ROWS_SQL);
  const replaced = new Set(candidates.map((c) => c.slug));
  const standingRows = standing
    .filter((row) => !replaced.has(row.slug))
    .map((row) => (carried.has(row.slug) ? { ...row, geometry: carried.get(row.slug) } : row));
  const claimOf = new Map(candidates.map((c) => [c.slug, c]));
  const movedSlugs = new Set(standing
    .filter((row) => carried.has(row.slug) || (claimOf.has(row.slug) && !sameGround(row.geometry, claimOf.get(row.slug).geometry)))
    .map((row) => row.slug));
  const containment = withoutSlugs(await gistContainment(q), movedSlugs);
  return computeStanding([...standingRows, ...candidates],
    { only: only ?? new Set(candidates.map((c) => c.slug)), containment, houseOf: await liveHouseOfVia(q), classes });
}
