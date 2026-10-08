// materialize.mjs — HOW A CLAIM BECOMES A MARK, and how standing is re-walked
// after it does. Extracted from `clearing-job.mjs` (steps 6 and 7) the day a
// SECOND lawful writer of `marks` appeared: the REVIEW lane's ruling on a
// `held_review` contest (`review-rule.mjs`, census Decision 2's "a mind rules").
//
// IT IS AN EXTRACTION, NOT A SECOND COPY, and that is the whole reason this file
// exists. `mark-standing.mjs` states the rule one level up — "One definition,
// five consumers … a second copy of this walk is a future drift; import it" —
// and a candle and a ruling that materialized a claim two slightly different
// ways would be that drift with a schema. The clearing job calls these; the
// ruling calls these; there is one answer to "what does a locked claim become".
//
// THE PEN IS STILL ONE. Both callers connect as `clearing_job` — the only role
// holding INSERT/UPDATE on `marks` and UPDATE on `claims` (002_grants.sql) — so
// extracting the code adds no writer. What changed is that two TOOLS now hold
// that one pen, which is exactly why the law had to leave the tool it grew up
// in.
//
// Nothing here opens a connection or a transaction. Every function takes the
// caller's `q(text, args)` and runs inside the caller's transaction, because a
// materialization that could commit on its own would be a second candle.

import { computeStanding, admissionNotes, gistContainment } from "./standing.mjs";
import { houseKeyOfVia, houseRowsVia, liveHouseOfVia as liveHouseOfStore } from "../../src/household-deriver.mjs";
import { REFUSALS, refuse } from "../../src/ceremony.mjs";

/**
 * The identity a claim will materialize under.
 *
 * `claims.slug` since 006; the `geometry->>'slug'` fallback is for the lab rows
 * written before it, and dies with them (anti-rebake rule 5: every shim ships
 * with its own death — this one is over when
 * `SELECT count(*) FROM claims WHERE slug IS NULL AND geometry ? 'slug'` is
 * zero, which 006's own UPDATE already made true on dev).
 */
export const slugOf = (c) => c.slug ?? c.geometry?.slug ?? null;

/**
 * PARENTS BEFORE CHILDREN.
 *
 * `marks.parent` is a self-referencing foreign key and it is NOT deferrable
 * (004), so two marks locking in one window with one predicated on the other are
 * refused mid-transaction unless they go in order — and the whole window would
 * roll back on it, which is the right failure and a needless one. This is
 * seed-import's `orderByParent`, asked of a batch instead of a whole register: a
 * claim whose parent is not another claim in THIS batch is already satisfiable
 * (the parent stands from an earlier window, or there is none), so it goes
 * first.
 */
//
// `onCycle`, when given, is handed the claims a cycle strands (the cycle and
// everything predicated on it) and the rest are returned in order, instead of
// throwing. The clearing passes it (POS-356: one bad claim refuses only itself);
// every other caller throws exactly as before.
export function orderByParent(claims, { label = "this batch", onCycle = null } = {}) {
  const inBatch = new Set(claims.map((c) => String(c.id)));
  const ordered = [];
  const emitted = new Set();
  let waiting = claims.slice();
  while (waiting.length) {
    const ready = waiting.filter((c) => !c.parent || !inBatch.has(String(c.parent)) || emitted.has(String(c.parent)));
    if (!ready.length) {
      if (onCycle) { onCycle(waiting); return ordered; }
      throw new Error(`the parent edges among ${waiting.length} claim(s) in ${label} form a cycle, e.g. ` +
        waiting.slice(0, 3).map((c) => slugOf(c)).join(", "));
    }
    for (const c of ready) { ordered.push(c); emitted.add(String(c.id)); }
    const readySet = new Set(ready);
    waiting = waiting.filter((c) => !readySet.has(c));
  }
  return ordered;
}

/**
 * Turn locked claims into standing marks.
 *
 * THE MARK CARRIES THE WHOLE RECORD, not the columns that existed before 004
 * (the replay gate's finding 3). `data` is where the record's remainder lives —
 * `date`, `image`, `pre`, `slot`, and the standing the fold answered — and
 * `parent` is the continuation edge a predicated mark IS. Materializing without
 * them made every mark that came through the candle strictly poorer than one the
 * seed imported.
 *
 * A CLAIM THAT NAMES A MARK MATERIALIZES, geometry or no geometry (finding 1).
 * The old gate was `c.geometry?.slug`, so a de-sited claim — 44% of 1.0's
 * register is predicated or naming — locked and then produced nothing, with no
 * refusal and nothing to notice.
 *
 * AN AMEND REWRITES THE MARK IT CONTINUES. Not a new row: the slug is unique,
 * the mark's id is its FIRST locking claim's id, and the register has one
 * standing mark per slug. `locked_window` moves to `windowId`, because that is
 * when this version of the record was ruled.
 *
 * `amends` maps a claim id (as a string) to the standing mark row it continues.
 *
 * A REVIVE STANDS THE AUTHOR'S OWN RETIRED ROW BACK UP (POS-241 phase 1, ruled
 * 2026-09-26: "a mark keeps one id for life"). Not a new row, for the same reason
 * an amend is not: the slug is unique across every status, so an INSERT under a
 * retired row's slug is `marks_slug_key` and the whole caller's transaction rolls
 * back (window 212, 09-26). The row keeps its id, takes the claim's record as an
 * amend does, goes `standing`, and drops `retired_window`; the caller records
 * what it overwrote. `revives` maps a claim id to that retired row, and only the
 * clearing resolves it (clearing-job.mjs § step 1). Every other caller passes
 * none and keeps exactly the behaviour it had.
 */
/**
 * THE OWNERSHIP GRAIN IS THE CLAIMANT'S, RESOLVED — never the claim's scope
 * label (2026-09-02, the flip week's first catch; the standing falsifier's
 * symmetric attribution exposed it same morning it landed).
 *
 * `claims.household` answers a DIFFERENT question: whose eyes may see this
 * draft — the acting KEY's household name, and for a human-credentialed act
 * that is the human's GitHub login (world2-claims.mjs § THE ONE RESOLVER:
 * flipping it would break my-drafts parity). Copying it into `marks.household`
 * made the login the ownership grain on 26 standing rows across 12 households
 * (berthillon's cones as solo:devadavisson, sage-reeves' welcomes as
 * solo:kristinashoultz-wq, pando-peak-home as solo:FluffUPando …), and the
 * standing walk then refused sovereignty on the resident's own parcel —
 * fold says home, port says market, and the PORT was right about a store that
 * was wrong. Two questions, one column, exactly the words-for-one-fact class.
 *
 * So the mark's household resolves from the CLAIMANT (the resident who owns
 * the mark), never from the claim's scope label. The sibling resolver in
 * world2-claims.mjs stays untouched and keeps its lane.
 *
 * ── AND IT NO LONGER READS `identities` (POS-160 follow-up, RED 2) ──────────
 *
 * The 08-28 spelling was "the roster's household KEY, else solo:<handle>", and
 * the roster it meant was `identities` — a projection of the WORLD repo's copy
 * of the town's pins, four hops from the fact, answering in whatever spelling
 * that copy happened to carry. MEASURED 2026-09-22: `gh:<id>` on 173 handles,
 * `hh:<slug>` on 17, and one house wearing both at once.
 *
 * #165's lane flagged this function as THE SOURCE of the multi-spelling store:
 * `claims.household` is the acting key's and `marks.household` was copied from
 * `identities`, so between them the pen minted `gh:`, `hh:` and `solo:` rows
 * and then the read side had to reconcile them with a spelling set. Ruling 1
 * and the design note say every NEW line from the law date names `hh:<slug>`.
 * So this function now asks the ONE DERIVER, against the registry in the
 * caller's own store, and answers `hh:<slug>`.
 *
 * ── IT REFUSES A HOUSELESS CLAIMANT. IT DOES NOT FALL BACK ──────────────────
 *
 * `solo:<handle>` is gone from this pen (one named exception, the town's own
 * marks: `TOWN_HOUSEHOLD_BY_NAME` below), and that is the point rather than a
 * side effect: every `solo:` row the store holds was minted by a fallback
 * exactly here, and a fallback that keeps minting them makes the spelling set
 * a permanent fixture instead of a bridge over a closed history. After
 * POS-159's backfill the case does not arise — every resident on the roll
 * stands in exactly one house, 188 of 188 by account — so a claimant the
 * registry cannot name is a genuine defect in the roll and a person should see
 * it, at the crossing, rather than read it as a household six weeks later.
 *
 * TWO REFUSALS AND NOT ONE, because `NULL IS NOT EMPTY` (registry-store.mjs's
 * own rule) and the two failures want different hands:
 *
 *   NO_RECORD (503)      the registry holds no houses at all — this store is
 *                        not pointed at the record, or the tables are unseeded.
 *                        An operator problem, and refusing every claimant on
 *                        one reading is louder and truer than naming them one
 *                        at a time.
 *   NO_SUCH_HOUSE (404)  the roll is readable and does not name this claimant.
 *                        One person's row to fix, in the join ceremony.
 *
 * The vocabulary is `src/ceremony.mjs § REFUSALS` verbatim — the same sentences
 * the join door says, because "a refusal a resident meets at two doors in two
 * wordings is two laws wearing one name."
 *
 * ── THE MEMO MOVED INTO THE DERIVER, ON PURPOSE ────────────────────────────
 *
 * The `ownerKeys` Map this replaced was keyed on the HANDLE alone and lived for
 * the life of the process, so two stores in one process (a suite's stub and a
 * real pool; a replay and a live arm) shared one answer and `__clearHouseCache`
 * could not reach it. `houseOfVia` memoises per (queryable, x) in a WeakMap and
 * IS cleared by that seam, so the cache is now scoped to the store it came
 * from. `queryableFor` keeps ONE adapter object per `q` for the same reason —
 * a fresh `{ query }` per claim would defeat the WeakMap and put the whole
 * registry fold through `registryFromRows` on every line of a crossing.
 */

/** `q(text, args)` as the queryable `registryRowsVia` wants — one per `q`. */
const queryables = new WeakMap();
const queryableFor = (q) => {
  let via = queryables.get(q);
  if (!via) { via = { query: (text, args = []) => q(text, args) }; queryables.set(q, via); }
  return via;
};

/**
 * THE TOWN'S MARKS, BY NAME — AN INTERIM (POS-142).
 *
 * Keemin, 2026-09-24 ~19:3x EDT: "the town should be some kind of entity, idk
 * if household is correct, but yes the long-term shape is that the meeps should
 * belong to the town." Wright proposed an interim (the town's marks keep
 * `solo:the-town` by name, pinned by a test, committing to nothing about what
 * the town is) and Keemin approved it: "I agree. good to have a lane build it
 * tonight".
 *
 * `the-town` authors the constitution marks and is not a household on the
 * roll, so under the refusal below every ingest carrying a new town mark
 * refused whole at NO_SUCH_HOUSE (the dev sandbox run, 2026-09-24: six of 21
 * adds). The store already holds the town's rows as `solo:the-town`, and
 * `store-writedown.mjs § isTheTown` already reads that spelling as the town.
 *
 * ONE claimant, matched exactly, answered BEFORE the roll is asked. No other
 * handle is exempt: every other claimant the roll does not name still refuses.
 * INTERIM until the town-as-entity sitting decides what the town is.
 */
export const TOWN_CLAIMANT = "the-town";
export const TOWN_HOUSEHOLD_BY_NAME = "solo:the-town";

export async function ownerHouseholdFor(q, owner) {
  const handle = String(owner ?? "").trim();
  if (handle === TOWN_CLAIMANT) return TOWN_HOUSEHOLD_BY_NAME;   // the one named exception, above
  const via = queryableFor(q);

  const rows = await houseRowsVia(via);
  if (!Object.keys(rows?.registry?.households ?? {}).length)
    throw refuse(REFUSALS.NO_RECORD,
      `materialize: the registry names no households in this store, so no mark may be filed under one` +
      (handle ? ` (asked for ${JSON.stringify(handle)})` : ""));

  if (!handle)
    throw refuse(REFUSALS.NO_SUCH_HOUSE,
      "materialize: a claim arrived with no claimant, and `marks.household` is never NULL");

  const key = await houseKeyOfVia(via, handle);
  if (!key)
    throw refuse(REFUSALS.NO_SUCH_HOUSE,
      `materialize: the town's roll does not name ${JSON.stringify(handle)}, so this mark has no household ` +
      `to stand in. The pen no longer mints \`solo:${handle}\` — every solo row in the store came from that ` +
      `fallback, and Ruling 1 says every new line from the law date carries hh:<slug>. Fix the roll.`);

  return key;
}

/**
 * EVERY SPELLING A HOUSE HAS WORN → ITS LIVE KEY, as one function for the
 * standing walk (standing.mjs § computeStanding's `houseOf`).
 *
 * The same deriver `ownerHouseholdFor` asks, over the same registry, so the
 * standing rows and the candidates they are judged against speak one key per
 * house. A spelling no house claims maps to itself: a `solo:<handle>` that is
 * nobody's resident is its own household, as it always was. The rule is
 * `household-deriver.mjs § liveHouseOf`; this is that, over `q`.
 */
export async function liveHouseOfVia(q) {
  return liveHouseOfStore(queryableFor(q));
}

/**
 * ── ONE BAD CLAIM REFUSES ONLY ITSELF (POS-356, ruling R5) ──────────────────
 *
 * THE INSTANCE. At 06:00Z on 2026-10-04 one claimant in window 228 (gabo) stood
 * in the town's households file and not in the store's roll. `ownerHouseholdFor`
 * threw NO_SUCH_HOUSE, the clearing's one transaction rolled back, and the ten
 * lawful claims beside it waited a night with S93.
 *
 * THE RULING (Darko, 2026-10-04, R5): "a refusal cannot hold anyone's marks". A
 * claim that cannot be materialized refuses itself, with its cause on that
 * resident's outcome, and the rest of the docket locks. The whole window refuses
 * only where nothing can be judged at all: a store that cannot be read, or a
 * registry that cannot be read.
 *
 * SO THE LINE IS DRAWN BY WHAT THE FAILURE IS ABOUT, not by where it is thrown:
 *
 *   per claim     NO_SUCH_HOUSE (this claimant is not on a readable roll);
 *                 a parent cycle; a revive whose row is no longer retired; and
 *                 any integrity-constraint refusal from Postgres (SQLSTATE class
 *                 23: the slug, the parcel exclusion, the parent key, a CHECK,
 *                 a NOT NULL), which is the store saying no to THIS row.
 *   whole window  NO_RECORD (the registry names no houses at all); and every
 *                 other error: a connection, a permission, a missing table. A
 *                 store that cannot be read is not one claim's fault, and
 *                 refusing a claim for it would blame a resident for the box.
 *
 * Every per-claim refusal is written under ONE check, `unfileable`, with the
 * sentence the resident reads after the colon. Its bulletin word is
 * `quarantined` (ruled by Darko 2026-10-08; `mark-receipt.mjs § CAUSE_OF_CHECK`).
 */
export const UNFILEABLE_CHECK = "unfileable";

const unfileable = (sentence) => `${UNFILEABLE_CHECK}: ${sentence}`;

/** The resident's sentence for a claimant the roll does not name. Same words as the join door's. */
export function noHouseCheck(claimant) {
  const handle = String(claimant ?? "").trim();
  return unfileable(handle
    ? `${REFUSALS.NO_SUCH_HOUSE.defect} for ${handle}: the town's roll does not name ${handle}, so this mark had no household to stand in. Nothing else waited on it. Once your house is on the roll, put the mark forward again.`
    : `${REFUSALS.NO_SUCH_HOUSE.defect}: this claim arrived with no claimant, so the mark had no household to stand in.`);
}

/**
 * The claimant's house, or the per-claim refusal that says why there is none.
 * `{ household }` or `{ check }`. NO_RECORD and every other failure throw: those
 * refuse the whole window.
 */
export async function houseOrRefusal(q, claimant) {
  try {
    return { household: await ownerHouseholdFor(q, claimant) };
  } catch (err) {
    if (err?.refusal === REFUSALS.NO_SUCH_HOUSE) return { check: noHouseCheck(claimant) };
    throw err;
  }
}

// Postgres names the constraint; the resident reads what it means for their mark.
const CONSTRAINT_SENTENCES = Object.freeze({
  marks_slug_key: (slug) => `another mark already carries the name ${slug}, so this one could not be filed under it.`,
  marks_pkey: (slug) => `another mark already carries this mark's id, so ${slug} could not be filed.`,
  parcels_do_not_overlap: (slug) => `a parcel already holds this ground, so ${slug} could not be filed on it.`,
  marks_parent_fkey: (slug) => `the mark ${slug} continues is not in the world (it did not lock), so ${slug} had nothing to stand on.`,
  sited_marks_have_a_where: (slug) => `${slug} is a sited mark with no place, so it could not be filed.`,
});

/** The `unfileable` check for a store error that is about this one row, or null when it is not. */
export function unfileableCheckOf(err, c) {
  const code = String(err?.code ?? "");
  if (!/^23/.test(code)) return null;                 // not an integrity refusal: the whole window refuses
  const slug = slugOf(c) ?? String(c?.id ?? "?");
  const say = CONSTRAINT_SENTENCES[err.constraint];
  const named = err.constraint ? ` (store: ${err.constraint})` : ` (store: ${code}${err.column ? ` ${err.column}` : ""})`;
  return unfileable(`${say ? say(slug) : `the store could not file ${slug}.`} Nothing else waited on it.${named}`);
}

/**
 * `refuseEach(claim, check)`, when given, turns every per-claim failure above
 * into a call and a skipped claim, and the batch goes on; the return is the
 * count actually filed. Each claim is filed under its own SAVEPOINT, because
 * Postgres aborts the whole transaction on any error and only a savepoint can
 * take one row's refusal back without the rest. Without `refuseEach` (the review
 * lane, the ingests, the backfills) the first failure throws, as it always has.
 */
export async function materializeClaims(q, { claims, amends = new Map(), revives = new Map(), windowId, label, refuseEach = null }) {
  const where = label ?? `window ${windowId}`;
  const named = claims.filter((c) => slugOf(c));   // a stake or escrow claim names no mark
  const ordered = orderByParent(named, {
    label: where,
    onCycle: refuseEach && ((stuck) => {
      const names = stuck.map((c) => slugOf(c)).join(", ");
      for (const c of stuck) refuseEach(c, unfileable(`${slugOf(c)} and the marks it continues (${names}) each wait on another, so none of them has ground to stand on. Nothing else waited on them.`));
    }),
  });
  let filed = 0;
  for (const c of ordered) {
    if (!refuseEach) {
      const grain = await ownerHouseholdFor(q, c.claimant); // NOT c.household — § the ownership grain above
      await fileOne(q, c, { grain, amends, revives, windowId, where });
      filed += 1;
      continue;
    }
    const house = await houseOrRefusal(q, c.claimant);
    if (house.check) { refuseEach(c, house.check); continue; }
    await q("SAVEPOINT file_one_claim");
    try {
      await fileOne(q, c, { grain: house.household, amends, revives, windowId, where });
      await q("RELEASE SAVEPOINT file_one_claim");
      filed += 1;
    } catch (err) {
      // The rollback runs first, so a dead connection fails HERE and refuses the window.
      await q("ROLLBACK TO SAVEPOINT file_one_claim");
      await q("RELEASE SAVEPOINT file_one_claim");
      const check = err?.notRetired ? unfileable(`the retired mark ${slugOf(c)} revives was not retired when its window closed, so it could not be stood back up. Nothing else waited on it.`)
        : unfileableCheckOf(err, c);
      if (!check) throw err;
      refuseEach(c, check);
    }
  }
  return filed;
}

/** One claim to one mark row: the revive, the amend, or the INSERT. The grain is resolved by the caller. */
async function fileOne(q, c, { grain, amends, revives, windowId, where }) {
  const slug = slugOf(c);
  const amended = amends.get(String(c.id));
  const revived = revives.get(String(c.id));
  if (revived) {
    const { rowCount } = await q(
      `UPDATE marks SET status = 'standing', retired_window = NULL, kind = $2, owner = $3, household = $4,
                        body = $5, geometry = $6, bbox = $7, data = $8, parent = $9, locked_window = $10
         WHERE id = $1 AND status = 'retired'`,
      [revived.id, c.class, c.claimant, grain, c.body, c.geometry, c.bbox,
       c.data, c.parent, windowId]);
    if (rowCount !== 1)
      throw Object.assign(new Error(`${where}: ${slug}'s retired row ${revived.id} was not retired when its revive materialized`), { notRetired: true });
    return;
  }
  if (amended) {
    await q(
      `UPDATE marks SET kind = $2, owner = $3, household = $4, body = $5, geometry = $6,
                        bbox = $7, data = $8, parent = $9, locked_window = $10
         WHERE id = $1`,
      [amended.id, c.class, c.claimant, grain, c.body, c.geometry, c.bbox,
       c.data, c.parent, windowId]);
    return;
  }
  await q(
    `INSERT INTO marks (id, slug, kind, owner, household, body, geometry, bbox, status,
                        locked_window, data, parent)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'standing',$9,$10,$11)`,
    [c.id, slug, c.class, c.claimant, grain,
     c.body, c.geometry, c.bbox, windowId, c.data, c.parent]);
}

/**
 * THE STANDING RECOMPUTE — the last act of anything that added ground.
 *
 * RULING (Wright, 2026-08-28 eve, on the replay gate's finding 4): "tier is
 * recomputed for ALL standing marks inside the clearing transaction, which is
 * settlement-equivalent staleness, zero new class."
 *
 * ALL STANDING MARKS, not the batch's. That is the whole point: standing is a
 * fact about the ground a mark stands on, so a NEIGHBOUR's parcel landing moves
 * marks nobody claimed — `berthillon/le-petit-berthillon` went `market → home`
 * with every authored byte identical, because `berthillon/chez-antoine` gave the
 * walk sovereign ground to stop at.
 *
 * INSIDE THE CALLER'S TRANSACTION, because a recompute that could land after the
 * writer committed would be a second pen writing the register.
 *
 * ONLY THE ROWS THAT MOVED are written, and the count is a receipt: a recompute
 * that touched every row every time would tell a reader nothing about whether
 * the world moved.
 *
 * A REVIEW RULING NEEDS THIS EXACTLY AS A CLEARING DOES — a granted parcel is
 * ground arriving, and ground arriving is what moves a neighbour's standing.
 * A ruling that skipped it would re-open finding 4 through the side door.
 */
export async function recomputeStanding(q) {
  const { rows: standing } = await q(
    `SELECT id::text, slug, kind, owner, household, geometry, parent::text, data
       FROM marks WHERE status = 'standing'`);
  // THE CONTAINMENT CANDIDATES, ASKED OF THE STORE (standing.mjs § the spatial
  // index, 016_marks_bbox_gist.sql). Read INSIDE this transaction, off `q`, so
  // the index answers about exactly the rows the SELECT above returned. Null
  // when migration 016 is not applied, and then the walk scans as it always has
  // — the reader refuses to run its pair query unindexed precisely because
  // unindexed it is slower than the walk it would replace.
  const containment = await gistContainment(q);
  const houseOf = await liveHouseOfVia(q);
  const tiers = computeStanding(standing, { containment, houseOf });
  const moved = [];
  for (const m of standing) {
    const next = tiers.get(m.slug);
    // A standing mark the walk did not answer for is not a mark with an unknown
    // standing; it is a register the recompute could not resolve, and writing
    // the stale value would be the finding-4 bug wearing a receipt.
    if (next == null) throw new Error(`the standing walk returned no verdict for ${m.slug}`);
    if ((m.data?.tier ?? null) === next) continue;
    await q(
      `UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{tier}', to_jsonb($2::text)) WHERE id = $1`,
      [m.id, next]);
    moved.push({ slug: m.slug, from: m.data?.tier ?? null, to: next });
  }
  // The premises the port stands on that are FACTS about today's register rather
  // than law (standing.mjs § the tripwires). Recorded in the receipts, not
  // thrown: a write must not fail because the town outgrew a premise, but nobody
  // should have to go looking for the day it did.
  // WHAT THE PREFILTER COULD SPEAK FOR, on the record. Without this the
  // containment index is a thing that either helped or did not and left nothing
  // behind to say which — and its two failure modes are both quiet: migration
  // 016 absent (`indexed: false`, the walk silently pays the old price) and the
  // loose set growing (rows whose `bbox` does not bound them, which the walk
  // must keep scanning). Both are counts a reader can watch move.
  return {
    standing, moved, notes: admissionNotes(standing, { houseOf }),
    containment: containment
      ? { indexed: true, covered: containment.covered.size, loose: containment.loose.length,
          ...(containment.loose.length ? { loose_marks: containment.loose.slice(0, 10) } : {}) }
      : { indexed: false },
  };
}

/**
 * THE RETIREMENT — the inverse of `materializeClaims`, and the only path by
 * which a standing mark stops standing.
 *
 * ── WHY IT LIVES HERE AND NOT IN A NEW FILE ─────────────────────────────────
 *
 * `marks` has exactly one pen — `clearing_job` holds INSERT, UPDATE on it
 * (002_grants.sql:22) — and this file is where that pen's answers to "what
 * becomes of a mark" live. A retirement written anywhere else would be a second
 * place to read the register's law, which is the drift `mark-standing.mjs`'s
 * header forbids one level up. No new grant is needed and none is asked for.
 *
 * ── THE GAP THIS CLOSES, MEASURED BEFORE IT WAS BUILT ───────────────────────
 *
 * Until this function existed, NOTHING in the live write path ever set
 * `marks.status = 'retired'`. 001_tables.sql has carried the column and its
 * CHECK since the first migration; the only writers in the tree were
 * `replay-ingest.mjs`'s backfill and `falsifier-standing-equality.mjs`'s own
 * can-fail fixture. So a mark the world unpublished stayed `standing` in the
 * store forever, and on the pre-cutover dump that read 1,019 standing / 0
 * retired, ever.
 *
 * IT IS WORSE THAN A STALE ROW, and this is the reason the step is worth a
 * transaction rather than a nightly tidy. `recomputeStanding` above walks
 * `WHERE status = 'standing'`, and standing is a fact about the ground a mark
 * stands on — so a mark that should have been retired keeps holding ground
 * under its neighbours and hands them a tier the fold does not agree with.
 * That is the `berthillon/chez-antoine` mechanism in this file's own comment,
 * running backwards. Retiring correctly is what removes the phantom ground,
 * which is why the caller runs this BEFORE the recompute, never after.
 *
 * ── WHAT HAPPENS TO THE CLAIM, AND WHY NOTHING ─────────────────────────────
 *
 * The locking claim is left exactly as it stands. `retracted` is the docket's
 * word for a claim that never locked — `world2-claims.mjs:234-237` only ever
 * moves a `pending` row there — and the docket's own guard forbids deleting a
 * locked one. The claim is the historical fact that this mark WAS ruled in at
 * that window, and that fact did not stop being true when the world let the
 * mark go. The retirement is a fact about the mark's standing today; the claim
 * is a fact about a window that has closed. Writing the retirement onto the
 * claim would collapse two different times into one row.
 *
 * ── IDEMPOTENT BY THE GUARD, NOT BY A CHECK-THEN-WRITE ─────────────────────
 *
 * `AND status = 'standing'` is what makes a re-run a no-op, and it is in the
 * UPDATE rather than in a preceding SELECT on purpose: a check-then-write over
 * a connection two crossings could share is a race with a comfortable shape.
 * A slug already retired reports as `already_retired`, not as an error and not
 * as a silent success — a caller re-running after a half-finished crossing has
 * to be able to tell "I did this" from "this was already done".
 *
 * A slug the register does not carry at all is `absent`, and that is also not
 * an error: the world can unpublish a mark the store never materialized (a
 * founding-estate row, or one whose claim was never locked here), and refusing
 * the whole crossing over it would make the store's ignorance the town's
 * problem. It is REPORTED, because a step that quietly did nothing is the
 * failure mode this whole seam exists to end.
 *
 * ── THE CAN-FAIL FLIP, AS A DIFF RATHER THAN A DESCRIPTION ─────────────────
 *
 * My first write-up said "the UPDATE replaced by a SELECT that returns no
 * rows", and a reader cannot run that sentence: the fake register in
 * `test/retire-marks.test.mjs` THROWS on SQL it does not model, so most
 * spellings of that sentence produce an error rather than the split I reported.
 * The flip is therefore recorded as the exact four-line edit it was, applied to
 * the UPDATE below:
 *
 *     -    const { rows } = await q(
 *     -      `UPDATE marks SET status = 'retired', retired_window = $2
 *     -        WHERE slug = $1 AND status = 'standing'
 *     -        RETURNING slug, locked_window`,
 *     -      [slug, windowId]);
 *     +    const { rows } = await q(
 *     +      `SELECT status, retired_window FROM marks WHERE slug = $1 AND FALSE`,
 *     +      [slug, windowId]);
 *
 * It is the SELECT the register already models (the second branch of its `q`),
 * so it returns rows instead of throwing — which is what makes this flip
 * runnable at all, and is exactly the detail the prose lost.
 *
 * Run on the committed tree, the split it produces is recorded in
 * `test/retire-marks.test.mjs`'s header beside the tests it reds.
 *
 * @param q      the caller's query function — this runs INSIDE the caller's
 *               transaction, like every other function in this file.
 * @param slugs  the `<owner>/<name>` identities the world no longer carries.
 * @param windowId  the window this retirement is ruled at; lands in
 *               `retired_window`, which is the column 001 gave it — NOT
 *               `locked_window`, which records when the mark was ruled IN.
 * @param cause  a short word naming which door the mark left canon by, carried
 *               into the receipt so a keeper reading it knows what happened
 *               rather than only that something did.
 */
export async function retireMarks(q, { slugs, windowId, cause = "settlement-unpublish" }) {
  if (!Number.isInteger(windowId)) {
    throw new Error(`retireMarks needs the window it rules at; got ${JSON.stringify(windowId)}`);
  }
  const retired = [];
  const alreadyRetired = [];
  const absent = [];
  for (const slug of [...new Set(slugs.map((s) => String(s)))].sort()) {
    const { rows } = await q(
      `UPDATE marks SET status = 'retired', retired_window = $2
        WHERE slug = $1 AND status = 'standing'
        RETURNING slug, locked_window`,
      [slug, windowId]);
    if (rows.length) { retired.push({ slug, window: windowId, locked_window: rows[0].locked_window, cause }); continue; }
    // Tell the two zeroes apart. A zero meaning "already done" and a zero
    // meaning "never here" must not be spelled the same way — the RLS lesson,
    // one table over.
    const { rows: seen } = await q("SELECT status, retired_window FROM marks WHERE slug = $1", [slug]);
    if (seen.length) alreadyRetired.push({ slug, retired_window: seen[0].retired_window ?? null });
    else absent.push({ slug });
  }
  return { retired, already_retired: alreadyRetired, absent, window: windowId, cause };
}
