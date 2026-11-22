// settlement-decides.mjs — THE SETTLEMENT'S LAST TWO DECISIONS, MADE BEFORE ITS SEAL (POS-1025).
//
// RULED (Darko, 2026-11-13). 09:08 EST, POS-365/a "Printout only": git becomes a printout of each
// settlement. 15:1x EST, POS-1025/c "Report only": "What publishes is decided inside the settlement and stays
// fixed." Rivet's build disposition (4, 6): the settlement fixes the publication, unpublish and withdrawal
// decisions before the seal and the printout only renders them; the old retire step's effects stay
// (retired_cause, the return to drafts, the alerts and the carry), made in the settlement's decision stage
// instead of fed back from a printout after the seal.
//
// ── WHAT WAS STILL DECIDED AFTER THE SEAL, AND MOVES HERE ───────────────────
//
// The clearing already makes every other outcome the sweep used to (clearing-job.mjs's header: "the
// clearing's transitions are the sweep's existing outcomes, renamed"; 5.5 escrow presence and 5.6 the parcel
// cap were ported before). Two doors out of canon were left to the sweep and to retire-unpublished.mjs after
// the push, and this file is both of them, in the clearing's transaction, after step 7's recompute:
//
//   THE WITHDRAWAL (WLD-88). A standing mark whose OWNER's latest mark act is a withdraw leaves canon and
//     retires as `settlement-withdraw`, returned to no drafts: the author let it go (fold-delta.mjs § THE
//     THIRD TERM's predicate, the one reader both ever had). A slug locked again this window waits for the
//     next one, as the fold input deferred it: the docket wins its own crossing. EXCEPT A HOLD PRINTOUT
//     (WLD-179; Darko, 2026-11-16: "Withdrawal wins is the correct short-term solution"): a docket row the
//     hold write-through printed (`isHoldPrintout`, the fold input's own scalar discriminator) is nobody's
//     act of the maker's, so the maker's withdrawal wins it here, as it did there. A later re-declaration
//     by the maker still wins, because the owed predicate reads the owner's LATEST mark act.
//
//   THE COMMONS UNPUBLISH (WLD-51). A registered commons mark with no stamps behind it at the window's town
//     sha leaves canon and retires as `settlement-unpublish`, and goes back to its household's drafts in the
//     same transaction (WLD-51 G1). THE RULE IS THE WORLD'S and is imported, never copied: tools/unpublish-
//     verdict.mjs (with mark-kind's `isHeld` and mark-standing's `townOwned`) out of the world checkout at the
//     store's pinned law sha, as parcel-cap.mjs imports the fold's limits. Its inputs, in the store's terms:
//       entry     the registry row as it stands before this window (settlement_publications, 095)
//       escrow    escrow_projection at the window's town sha (escrow-presence.mjs § escrowPresenceAt)
//       standing  the mark's tier as step 7 just walked it (`marks.data.tier`), null when it does not stand
//       pathOnMain  the row is not STALE (095: a seeded row whose path was not the mark's filing); a stale
//                 row is never swept under the world's STALE_ROWS "skip"
//       held      the mark is printed held (`data.held_by`)
//     A town-owned mark is never a candidate (the sweep's own exclusion). An input the store cannot answer
//     (no escrow read at this sha, no world checkout) makes the verdict UNCHECKED: the mark is kept, and the
//     window's receipt names every one. Kept is the safe side: a mark is never taken on a rule not read.
//
// Then THE REGISTRY, kept as the sweep kept the file: each mark this window locked (riders and hold
// write-throughs included) is (re)admitted at the class its tier walks now, except a HAND-OFF (the hold
// fields alone moved: mark-kind.mjs § holdOnlyChange), which is not a publication and changes nothing but a
// drop's class; the town's own marks are never registered. Both doors close their row.
//
// A retirement moves ground, so when either door took anything the standing is walked again before the seal:
// the snapshot is the World as the settlement decided it, and the printout renders exactly that.

import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

import { filingHolds, normalizeMark } from "../../src/store-writedown.mjs";
import { renderedMark } from "./mark-render.mjs";
import { publishedPathReader } from "./settlement-printout.mjs";

import { retireMarks, returnToDrafts, recomputeStanding } from "./materialize.mjs";
import { escrowPresenceAt } from "./escrow-presence.mjs";
import { WITHDRAWN_OWED_SELECT, isHoldPrintout } from "./fold-delta.mjs";
import { recordFromRow } from "./mark-render.mjs";

export const UNPUBLISH_CAUSE = "settlement-unpublish";
export const WITHDRAW_CAUSE = "settlement-withdraw";

/**
 * The world's own rules at the pinned law, or the reason they could not be read. Never a default: an
 * unreadable rule makes the unpublish UNCHECKED (kept), exactly as parcel-cap.mjs's unreadable law judges no
 * limit and says so.
 */
export async function worldRulesAt(worldRepo, lawSha) {
  if (!worldRepo) return { rules: null, reason: "no --world-repo: the clearing holds no world checkout to read the unpublish rule from" };
  if (!lawSha) return { rules: null, reason: "the store pins no world-law sha" };
  try {
    const { materializeAtRef } = await import("../../src/world-branches.mjs");
    const dir = join(materializeAtRef(worldRepo, lawSha, "tools"), "tools");
    const [verdict, kind, standing] = await Promise.all([
      import(pathToFileURL(join(dir, "unpublish-verdict.mjs")).href),
      import(pathToFileURL(join(dir, "mark-kind.mjs")).href),
      import(pathToFileURL(join(dir, "mark-standing.mjs")).href),
    ]);
    if (typeof verdict.unpublishVerdict !== "function" || typeof kind.isHeld !== "function"
      || typeof kind.holdOnlyChange !== "function" || typeof standing.townOwned !== "function")
      return { rules: null, reason: `the law at ${lawSha.slice(0, 12)} lacks the unpublish rule (unpublish-verdict, mark-kind or mark-standing)` };
    return { rules: { unpublishVerdict: verdict.unpublishVerdict, rowClassOf: verdict.rowClassOf ?? ((c) => (c === "market" ? "commons" : c)),
      isHeld: kind.isHeld, holdOnlyChange: kind.holdOnlyChange, townOwned: standing.townOwned }, reason: null };
  } catch (e) {
    return { rules: null, reason: `the unpublish rule at the pinned law ${lawSha.slice(0, 12)} could not be read from ${worldRepo}: ${String(e?.message ?? e).slice(0, 160)}` };
  }
}

/**
 * THE FILING HOLD, BEFORE THE SEAL (WLD-230; Wright, 2026-11-22 00:13Z: "decide the hold before the seal … the collision check
 * belongs to settlement-decides. The held mark is never admitted as sealed-published; it's named in the seal's held list, with
 * whose filing it met, and stays undelivered in the store for the layout fix. The printout then never meets it.").
 *
 * The write-down planner's own question (store-writedown.mjs § filingHolds), asked of the marks this window would admit, against
 * the main the printout will print onto: the last PRINTED settlement's commit (world_snapshots.printout_sha), read in the clearing's
 * world checkout by the printout's own path reader. Nothing new is judged: a mark whose planned filing is another id's published
 * file, or whose filing was planned under one, is held, exactly as the planner would hold it after the seal.
 *
 * `{ held: Map(slug → hold), against, unchecked }`. When main cannot be read here (no checkout, nothing printed yet, the commit not in
 * the checkout) nothing is held and `unchecked` says why: the mark is admitted as before, and a sealed-published row the printout
 * then cannot file still refuses by name (settlement-printout.mjs § registryRowRefusal), so a blind decision is never a silent one.
 */
export async function filingHoldsBeforeSeal(q, { worldRepo, rows }) {
  const none = (why) => ({ held: new Map(), against: null, unchecked: why });
  if (!rows.length) return { held: new Map(), against: null, unchecked: null };
  if (!worldRepo) return none("no --world-repo: main's filings could not be read, so no filing was checked before the seal");
  const { rows: [last] } = await q("SELECT sealed_settlement, printout_sha FROM world_snapshots WHERE printout_sha IS NOT NULL ORDER BY sealed_settlement DESC LIMIT 1");
  if (!last) return none("no settlement has been printed yet, so there is no printout's main to check filings against");
  const head = String(last.printout_sha);
  try { execFileSync("git", ["-C", worldRepo, "cat-file", "-e", `${head}^{commit}`], { stdio: "ignore" }); }
  catch { return none(`the last printout ${head.slice(0, 12)} (S${last.sealed_settlement}) is not in ${worldRepo}, so its filings could not be read`); }
  const canonBytesAt = (path) => {
    try { return execFileSync("git", ["-C", worldRepo, "show", `${head}:${path}`], { encoding: "utf8", maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "ignore"] }); }
    catch { return null; }
  };
  const marks = rows.map((row) => normalizeMark({ slug: row.slug, kind: row.kind, by: row.owner, household: row.household ?? row.owner,
    ...renderedMark({ ...row, first_claimed: null, first_claim_submitted_at: null }) }));
  const { holds } = filingHolds(marks, { publishedPathOf: publishedPathReader(worldRepo, head), canonBytesAt });
  return { held: holds, against: { settlement: Number(last.sealed_settlement), printout_sha: head }, unchecked: null };
}

/** The registry as it stands now (its live rows), by slug. */
async function liveRegistry(q) {
  const { rows } = await q("SELECT slug, class, stale, ord, from_window FROM settlement_publications WHERE to_window IS NULL");
  return new Map(rows.map((r) => [r.slug, { ...r, ord: Number(r.ord), from_window: Number(r.from_window) }]));
}

/** A version row (054) or a marks row, as the record the world's hand-off rule compares. */
const recordOf = (row) => (row ? { ...recordFromRow({ ...row, first_claimed: null, first_claim_submitted_at: null }), held_by: row.data?.held_by ?? undefined } : null);

/** Each slug's version in the window's previous snapshot, as its row (054's canonical jsonb), or nothing. */
async function previousVersions(q, windowId, slugs) {
  if (!slugs.length) return new Map();
  const { rows } = await q(
    `SELECT sm.slug, v.row
       FROM world_snapshots s
       JOIN world_snapshot_marks sm ON sm.marks_digest = s.marks_digest
       JOIN mark_versions v ON v.digest = sm.digest
      WHERE s.id = (SELECT id FROM world_snapshots WHERE window_id < $1 ORDER BY window_id DESC LIMIT 1)
        AND sm.slug = ANY($2::text[])`, [windowId, slugs]);
  return new Map(rows.map((r) => [r.slug, typeof r.row === "string" ? JSON.parse(r.row) : r.row]));
}

/**
 * THE STEP (clearing-job.mjs § 7.5). Runs inside the clearing's transaction, after step 7. Writes the two
 * doors' retirements, the drafts, and the registry; walks the standing again if anything left.
 *
 * @returns the window receipt's `settlement` account: `{ withdrawn, unpublished, drafts, deferred,
 *   unchecked, rules, registry: { admitted, reclassed, closed, unchanged }, restanding }`
 */
export async function settlementDecides(q, { windowId, townSha, lawSha, worldRepo, recompute = recomputeStanding }) {
  const { rules, reason } = await worldRulesAt(worldRepo, lawSha);
  const { rows: lockedRows } = await q(
    "SELECT DISTINCT slug FROM claims WHERE window_id = $1 AND status = 'locked' AND slug IS NOT NULL", [windowId]);
  const locked = new Set(lockedRows.map((r) => r.slug));
  const before = await liveRegistry(q);

  // ── the withdrawal: the owner let it go ──
  const { rows: owed } = await q(WITHDRAWN_OWED_SELECT);
  // WLD-179: the docket rows a hold printout wrote (the window's own marks rows, as the fold input read them:
  // `marks.locked_window` is this window), which a maker's withdrawal wins
  const docketOwed = owed.filter((r) => locked.has(r.slug)).map((r) => r.slug);
  const holdPrinted = new Set();
  if (docketOwed.length) {
    const { rows: docketRows } = await q(
      "SELECT slug, data FROM marks WHERE status = 'standing' AND locked_window = $1 AND slug = ANY($2::text[])", [windowId, docketOwed]);
    for (const r of docketRows) if (isHoldPrintout(r)) holdPrinted.add(r.slug);
  }
  const deferred = docketOwed.filter((s) => !holdPrinted.has(s));
  const overHold = docketOwed.filter((s) => holdPrinted.has(s));
  const withdrawSlugs = owed.filter((r) => !locked.has(r.slug) || holdPrinted.has(r.slug)).map((r) => r.slug);
  const withdrawn = await retireMarks(q, { slugs: withdrawSlugs, windowId, cause: WITHDRAW_CAUSE });
  const gone = new Set(withdrawn.retired.map((r) => r.slug));

  // ── the commons unpublish: the world's rule, at the pinned law ──
  const unchecked = [];
  const unpublishSlugs = [];
  const candidates = [...before.values()].filter((e) => e.class === "commons" && !gone.has(e.slug)).sort((a, b) => (a.slug < b.slug ? -1 : 1));
  const escrow = candidates.length ? await escrowPresenceAt(q, { townSha }) : new Map();
  if (candidates.length) {
    const { rows: standingRows } = await q(
      "SELECT slug, owner, household, data FROM marks WHERE status = 'standing' AND slug = ANY($1::text[])", [candidates.map((e) => e.slug)]);
    const markOf = new Map(standingRows.map((r) => [r.slug, r]));
    for (const entry of candidates) {
      const m = markOf.get(entry.slug) ?? null;
      if (!rules) { unchecked.push({ slug: entry.slug, why: reason }); continue; }
      if (m && rules.townOwned({ by: m.owner, household: m.household })) continue;
      const v = rules.unpublishVerdict({ class: entry.class, path: entry.slug }, {
        escrow: escrow === null ? null : (escrow.get(entry.slug) ?? 0),
        pathOnMain: !entry.stale,
        standing: m ? (m.data?.tier ?? null) : null,
        held: () => rules.isHeld({ held_by: m?.data?.held_by ?? null }),
      });
      if (v.unpublish === null) unchecked.push({ slug: entry.slug, why: v.why });
      else if (v.unpublish === true && m) unpublishSlugs.push(entry.slug);
    }
  }
  const unpublished = await retireMarks(q, { slugs: unpublishSlugs, windowId, cause: UNPUBLISH_CAUSE });
  const drafts = await returnToDrafts(q, { slugs: unpublished.retired.map((r) => r.slug), windowId, cause: UNPUBLISH_CAUSE });
  for (const r of unpublished.retired) gone.add(r.slug);

  // ── the standing again, when ground left ──
  let restanding = null;
  if (gone.size) {
    const again = await recompute(q);
    restanding = { recomputed: again.standing.length, moved: again.moved.length, moves: again.moved.slice(0, 25), ...(again.notes?.length ? { notes: again.notes } : {}) };
  }

  // ── the registry, kept as the sweep kept the file ──
  const registry = { admitted: [], reclassed: [], closed: [], unchanged: 0, hand_offs: [], unchecked: rules ? null : reason };
  let filing = { held: new Map(), against: null, unchecked: null };
  const closeRow = async (slug) => {
    const { rowCount } = await q("UPDATE settlement_publications SET to_window = $2 WHERE slug = $1 AND to_window IS NULL", [slug, windowId]);
    return rowCount > 0;
  };
  for (const slug of [...gone].sort()) if (await closeRow(slug)) registry.closed.push(slug);
  if (rules && locked.size) {
    const slugs = [...locked].filter((s) => !gone.has(s)).sort();
    const { rows: nowRows } = await q(
      "SELECT slug, kind, owner, household, body, geometry, data FROM marks WHERE status = 'standing' AND slug = ANY($1::text[])", [slugs]);
    const prev = await previousVersions(q, windowId, slugs);
    // WLD-230, before the seal: the window's marks planned as one batch (a dependent files under its batch parent), against the
    // printout's main; a held mark is never admitted as sealed-published (§ filingHoldsBeforeSeal)
    filing = await filingHoldsBeforeSeal(q, { worldRepo, rows: nowRows });
    const { rows: [{ top }] } = await q("SELECT coalesce(max(ord), -1) AS top FROM settlement_publications");
    let nextOrd = Number(top) + 1;
    for (const row of nowRows.sort((a, b) => (a.slug < b.slug ? -1 : 1))) {
      if (rules.townOwned({ by: row.owner, household: row.household })) continue;   // the town's own marks are never registered
      if (filing.held.has(row.slug)) continue;                                        // held: not published, its store row kept
      const cls = rules.rowClassOf(row.data?.tier ?? null);
      if (!cls) continue;
      const was = before.get(row.slug) ?? null;
      const prior = prev.get(row.slug) ?? null;
      const handOff = prior ? rules.holdOnlyChange(recordOf(prior), recordOf(row)) : false;
      if (handOff) {
        // A HAND-OFF IS NOT A PUBLICATION (POS-688): the row stays what it was, and founding estate stays out
        // of it. A DROP onto ground takes the class its new place walks (D4 step 3).
        const dropped = rules.isHeld({ held_by: prior.data?.held_by ?? null }) && !rules.isHeld({ held_by: row.data?.held_by ?? null });
        registry.hand_offs.push(row.slug);
        if (!was || !dropped || was.class === cls) continue;
      } else if (was && was.class === cls && !was.stale) { registry.unchanged += 1; continue; }
      if (was) {
        await closeRow(row.slug);
        await q("INSERT INTO settlement_publications (slug, class, stale, ord, from_window) VALUES ($1, $2, false, $3, $4)",
          [row.slug, cls, was.ord, windowId]);
        registry.reclassed.push({ slug: row.slug, from: was.class, to: cls, ...(was.stale ? { was_stale: true } : {}) });
      } else {
        await q("INSERT INTO settlement_publications (slug, class, stale, ord, from_window) VALUES ($1, $2, false, $3, $4)",
          [row.slug, cls, nextOrd++, windowId]);
        registry.admitted.push({ slug: row.slug, class: cls });
      }
    }
  }

  return {
    withdrawn: withdrawn.retired.map((r) => r.slug),
    unpublished: unpublished.retired.map((r) => r.slug),
    drafts,
    ...(deferred.length ? { deferred } : {}),
    // WLD-179: the hold printouts a maker's withdrawal won, each also in `withdrawn` when it retired
    ...(overHold.length ? { over_hold_printout: overHold.filter((s) => gone.has(s)) } : {}),
    ...(unchecked.length ? { unchecked } : {}),
    rules: rules ? "read" : reason,
    escrow: escrow === null ? "unread" : "read",
    registry,
    // WLD-230: THE SEAL'S HELD LIST, each mark not admitted with the filing it met; `filing_check` says what main it was checked
    // against, or why it could not be (then nothing was held, and the printout's named refusal stays the backstop)
    ...(filing.held.size ? { filing_held: [...filing.held.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([slug, h]) => ({ slug, path: h.path ?? null,
      held_by_filing_of: h.held_by_filing_of ?? null, crossing_output: h.crossing_output ?? null, ...(h.held_under ? { held_under: h.held_under } : {}) })) } : {}),
    ...(filing.against || filing.unchecked ? { filing_check: filing.against ? { against: filing.against } : { unchecked: filing.unchecked } } : {}),
    ...(restanding ? { restanding } : {}),
  };
}
