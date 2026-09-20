// canon-locks.mjs — the judgement half of the #2594 standing read.
//
// SEPARATED FROM `falsifier-canon-locks.mjs` BECAUSE THAT FILE IS A SCRIPT.
// It has top-level `process.exit` calls and reads `process.argv`, so importing it
// to test the judgement would run it and kill the test process. A file's
// testability is a property of its SHAPE, not of its content — this room recorded
// that lesson on 2026-09-08 after shipping a fold inside `src/hydrate.mjs` where
// six rules were watched by nothing, and this is the same mistake declined.
//
// Nothing here opens a connection or reads a checkout. It takes rows and a
// register and returns findings, so the hardest judgement in the lane — WHICH
// disagreements between the store and canon are the class, and which are the
// town working — is provable on hand-built rows with no Postgres and no clone
// (`world-hold.mjs § deps`, the house rule).
//
// ── THE SUBJECT IS THE MARK, NOT THE CLAIM, AND THAT WAS A REPAIR ───────────
//
// The issue and the brief both phrase the class as "a locked CLAIM whose slug has
// no file at the pinned world sha", so the first cut of this file walked
// `claims`. Run against the pre-cutover dump it reported the three instances and
// looked right. IT WAS READING 188 OF 1,019 STANDING MARKS.
//
// `claims.slug` is NULL on every seed-imported claim — the mark carries the slug
// and the claim does not — so 831 of the 1,023 locked claims name nothing, and
// `berthillon/pistache-cone-for-julian` and `the-town/pledges`, which are absent
// from canon and were standing in that dump, were invisible to it. The subject of
// the SENTENCE is not always the subject of the QUERY. It is caught here because
// the run disagreed with a prediction; a green that matched the prediction would
// have hidden an 82% blind spot indefinitely.
//
// So: walk the MARKS, join each one's claim by id (measured on the pre-cutover
// dump — every one of the 1,019 standing marks has a claim row and all 1,019 are
// `locked`), and take the slug from `marks.slug`, which is the column that is
// never null.

import { rowClassOf } from "./escrow-presence.mjs";

/**
 * Every standing mark and the claim that locked it.
 *
 * The claim rides along as EVIDENCE — which window ruled it in, and who claimed
 * it — and the join is LEFT so a standing mark with no claim at all is still
 * examined rather than dropped by the join that was supposed to describe it.
 */
export const STANDING_SELECT = `
  SELECT m.slug, m.locked_window, m.status AS mark_status, m.data->>'tier' AS tier,
         w.town_sha AS locking_town_sha,
         c.id::text AS claim_id, c.status AS claim_status, c.window_id, c.claimant, c.decided_at
    FROM marks m
    LEFT JOIN claims c ON c.id = m.id
    LEFT JOIN windows w ON w.id = m.locked_window
   WHERE m.status = 'standing'
   ORDER BY m.slug`;

/**
 * The open stamps per (town sha, mark), for the escrow class below.
 *
 * Grouped by SHA as well as by mark because each standing mark is judged at the
 * town sha of the window that LOCKED IT, not at today's — a mark locked at
 * window 150 and a mark locked at 177 are answerable to different reads of the
 * ledger, and collapsing them would judge August's marks against September's
 * town.
 */
export const ESCROW_BY_SHA_SELECT = `
  SELECT town_sha, mark, sum(n)::int AS n FROM escrow_projection GROUP BY town_sha, mark`;

/**
 * The projection's OLDEST town sha — the boundary the unjudgeable count is
 * measured against (§ the unjudgeable window, below). Named on every run so a
 * reader of the count knows which windows it covers without opening the store:
 * on prod that is window 181, ingested 2026-09-10T17:45Z, migration 014's birth.
 * The window id rides along where one window pinned that sha (a by-hand ingest
 * at a sha no window pinned answers null there, and that is a true answer).
 */
export const ESCROW_OLDEST_SELECT = `
  SELECT e.town_sha, min(e.ingested_at) AS ingested_at,
         (SELECT min(w.id) FROM windows w WHERE w.town_sha = e.town_sha) AS window_id
    FROM escrow_projection e GROUP BY e.town_sha ORDER BY 2 LIMIT 1`;

/**
 * The town shas the projection HOLDS ROWS FOR, read off the map's own keys.
 *
 * Derived from the map rather than passed beside it so a caller that built the
 * map from `ESCROW_BY_SHA_SELECT` and a test that built it by hand describe the
 * projection the same way: a sha is projected iff some (sha, mark) has a row.
 * That is exact — `escrow_projection.n` is CHECK (n > 0), a closed position is
 * an absence and not a zero (escrow-ingest.mjs § who gets a row), so a sha the
 * ingest wrote has rows, and a sha with no rows was never ingested.
 */
export function projectedShas(escrowBySha) {
  const shas = new Set();
  if (!escrowBySha) return shas;
  for (const key of escrowBySha.keys()) {
    const i = key.indexOf("|");
    if (i > 0) shas.add(key.slice(0, i));
  }
  return shas;
}

/** The unjudgeable rows grouped by locking window, oldest first — the shape the read prints and reports. */
export function unjudgeableByWindow(rows) {
  const by = new Map();
  for (const r of rows) {
    const k = `${r.locked_window ?? "?"}|${r.locking_town_sha}`;
    const g = by.get(k) ?? { locked_window: r.locked_window ?? null, town_sha: r.locking_town_sha, marks: 0 };
    g.marks += 1;
    by.set(k, g);
  }
  return [...by.values()].sort((a, b) => (a.locked_window ?? Infinity) - (b.locked_window ?? Infinity));
}

/**
 * The other class: a claim that locked and produced no mark.
 *
 * AN AMEND IS NOT UNMATERIALIZED, and this is the second thing the rehearsal
 * caught. `materializeClaims` gives an amended mark the FIRST locking claim's id
 * and rewrites that row (materialize.mjs § "an amend rewrites the mark it
 * continues"), so an amend claim's id is never a mark id. A query asking "is
 * there a mark with this claim's id" therefore reports every amendment the town
 * has ever made as a missing record — on the pre-cutover dump that was four
 * (`vellix/casa-nera` and vermillion's three space-program marks, the exact four
 * the replay gate's finding 2 is about).
 *
 * The question that is actually being asked is whether the SLUG reached the
 * register, so that is what this asks.
 *
 * A TRANSFER IS NOT UNMATERIALIZED either — the third thing (2026-09-15).
 * DEC-16 re-identifies a mark that changes hands: the row keeps its id and its
 * slug moves. The claim that locked it keeps the OLD slug, because it is the
 * historical fact of what was ruled in at that window — so the slug question
 * finds no mark and lists a claim whose own row is standing under the new name.
 * `the-town/the-lanternstep-parlor`, locked at window 172, has stood as
 * `wright/the-lanternstep-parlor` since the 08-29 transfer (act 4930); it sat
 * on the roll-call as unmaterialized for a week and was nearly RETIRED by hand,
 * which DEC-16 names as the rejected alternative: it costs the mark its escrow
 * and its whole history under the old identity. So the second question: does
 * the claim's own row exist. A row that never materialized has no row by id
 * either, so the never-stood class is still listed.
 */
export const UNMATERIALIZED_SELECT = `
  SELECT c.id::text AS claim_id, c.window_id, c.claimant,
         coalesce(c.slug, c.geometry->>'slug') AS slug
    FROM claims c
   WHERE c.status = 'locked'
     AND coalesce(c.slug, c.geometry->>'slug') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM marks m WHERE m.slug = coalesce(c.slug, c.geometry->>'slug'))
     AND NOT EXISTS (SELECT 1 FROM marks m WHERE m.id = c.id)
   ORDER BY c.window_id, slug`;

/**
 * Which standing marks the world carries no file for.
 *
 * ── THE ONE DISTINCTION EVERY RULE HERE IS ABOUT ────────────────────────────
 *
 * A mark the world published and later UNPUBLISHED also stands with a locked
 * claim and no canon file. That is not this class — it is the retire path's (G1
 * lane 1), and the retire path writes `status='retired'`. `STANDING_SELECT`
 * already asks only for standing rows, so a retired mark cannot reach here; the
 * guard below is the second lock on that door, for a caller passing its own rows.
 *
 * MEASURED ON THE PRE-CUTOVER DUMP (`w2-pre-cutover-20260908T143559Z`) against
 * world main at `91536f76`: FIVE — the three never-stood marks plus
 * `berthillon/pistache-cone-for-julian` (unpublished by the sweep at world
 * 49e0fe89) and `the-town/pledges` (removed by a law commit). All five were
 * retired by the founder's hand at window 177, so prod after the retire answers
 * ONE: `lupi/the-drift-room`, which locked at window 177 the same evening and
 * whose file sits on `origin/draft/lupi-agent` and no other ref. Whether that one
 * is "never" or "not yet" is UNDETERMINED, and not this file's to decide: the
 * nightly read lists it every 03:20 until a crossing carries the file or the
 * founder retires it, and the HOLD on it is the conductor's
 * (`docs/2026-09-08/jetto-candle-refusal-report.md` § finding 5).
 */
export function canonLockFindings(rows, register, { unmaterializedRows = [], escrowBySha = null } = {}) {
  const absent = [];
  const unbacked = [];
  const unjudgeable = [];
  let compared = 0;
  let escrowCompared = 0;
  const projected = projectedShas(escrowBySha);
  for (const r of rows) {
    // A mark row with no slug is not a thing canon could carry.
    if (!r.slug) continue;
    if (r.mark_status && r.mark_status !== "standing") continue;   // § the retired mark, above
    compared += 1;
    if (!register.slugs.has(r.slug)) absent.push(r);

    // ── THE ESCROW CLASS (postmark#2594's second half) ──────────────────────
    //
    // A standing COMMONS mark with nothing staked on it at the town sha of the
    // window that locked it. The candle's step 5.5 stops a new one; this is the
    // standing read for the ones already in the register, and it is judged at
    // each mark's OWN locking sha rather than at today's town.
    //
    // `escrowBySha === null` means the projection cannot answer (migration 014
    // absent, or nothing ingested) — nothing is judged, and the caller reports
    // that rather than reporting zero findings, which would look identical to a
    // clean town.
    if (!escrowBySha) continue;
    if (rowClassOf(r.tier) !== "commons") continue;
    if (!r.locking_town_sha) continue;   // a mark whose window pinned no town read cannot be judged

    // ── THE UNJUDGEABLE WINDOW (postmark#2935) ─────────────────────────────
    //
    // `escrowBySha.get(...) ?? 0` reads a sha the projection NEVER HELD as ✦0,
    // and for eight nights it did: the projection's oldest row is window 181
    // (2026-09-10T17:45Z, migration 014's first ingest), and 227 standing
    // commons marks lock at windows 150–179 — `the-town/*`'s class nodes,
    // Vermillion's peak, Wright's terrace. Every one of them read
    // ESCROW-ABSENT on the roll-call every morning (233 on 09-18, 290 on 09-17,
    // 283 on 09-16), and measured against the store on 2026-09-18 the number of
    // TRUE unbacked marks — a zero at a sha the projection holds — was ZERO.
    // An alarm that is always on teaches its reader to skim, which is the
    // failure this file's sibling names in its own header.
    //
    // So a locking sha with NO projection rows at all is UNJUDGEABLE: counted,
    // named by window, never listed as unbacked. The doorstep's rule (POS-105):
    // unavailable, never ✦0. It is the same distinction `escrow_checked: false`
    // draws for the whole projection, drawn per sha — and it is NOT a grace or
    // a hold: nothing about the mark is excused, the question is simply one the
    // store cannot answer for that window. A mark leaves this count only when
    // it is retired or re-locked by an amend at a projected window (which is
    // how `current-the-reader/the-taproom` left it on 09-18), never by a stake
    // — a stake today is read at today's sha, not at the locking one.
    //
    // `unbacked` below therefore lists ONLY judgeable zeros: a sha the
    // projection holds rows for and none for this slug.
    if (!projected.has(r.locking_town_sha)) { unjudgeable.push(r); continue; }
    escrowCompared += 1;
    const n = Number(escrowBySha.get(`${r.locking_town_sha}|${r.slug}`) ?? 0);
    if (n === 0) unbacked.push(r);
  }
  return {
    absent, unbacked, unjudgeable, compared, escrow_compared: escrowCompared,
    escrow_checked: Boolean(escrowBySha),
    unmaterialized: unmaterializedRows.filter((r) => r.slug),
  };
}
