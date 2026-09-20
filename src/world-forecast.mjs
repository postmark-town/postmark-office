// world-forecast.mjs — the proposed settlement: the door predicts, and only predicts.
//
// THE LAW (world repo, by id):
//   the-town/the-forecast    a forecast is a reading of the next save, run through
//                            the judgment that will make it — derived at the asking,
//                            never stored, never canon.
//   the-town/the-save        the settlement is the canonical save; the past reads
//                            from the newest save and is never re-judged.
//   the-town/the-tenses      settled past, declared present, undeclared future.
//   the-town/the-disclosure  refuse or disclose absent inputs; never quietly
//                            substitute.
//
// WHAT A CROSSING DOES, and what this does. The settlement computes a mark's
// ✦weight in two steps that already exist, one per repo:
//
//     (town)   node tools/world-stake.mjs --escrow --json  > stakes.json
//     (world)  node tools/marks-fold.mjs  --stakes stakes.json
//
// marks-fold's own `loadStakes` names that contract: "The town OWNS the ledger
// grammar and hands the world a derived artifact… One parser of the money lines
// across the two repos." A forecast is those same two steps against the ledger AS
// IT STANDS rather than the one the last save froze. Nothing here decides anything:
// the town derives, the world folds, and this module carries the rows between them.
//
// THE ONE THING IT MUST NEVER DO is compute a weight. A mark's ✦ is escrow, plus
// the breadth bonus for unique external households, plus everything nested inside
// it fanning up through consenting edges. Any shortcut — "add the pending stamps to
// the settled figure" — is a second judgment, and the day it disagrees with the
// sweep the door will have promised a number the crossing does not land.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { foldedStateAtRef, mainRef, readJsonAtRef } from "./world-branches.mjs";

// The sweep's own clock: deploy/postmark-settlement.timer — OnCalendar 06:00 and
// 18:00 UTC, on the dot (POS-80, the founder 2026-09-14: "make it 6 and 18 UTC
// on the dot"; the law is world `LOGOS/classes.md § crossing ②`, amended by
// postmark-world#96: "S1, S2, … at 06:00 and 18:00 UTC from the w39 ship
// (2026-09-21), 05:45 and 17:45 UTC until then"). This constant read 05:45/17:45
// until 2026-09-18 — the timer in this same tree had moved to 06:00/18:00 on
// 2026-09-17 (commit 1095279) and nothing bound the two — so every forecast's
// `at` and, from today, the doorstep's stakes segment would have named a
// settlement fifteen minutes before the one that runs. One clock, read by both
// (postmark#2919 found it; the stakes segment is its second reader).
//
// NOT write.mjs's `nextCrossing`, which is the MAIL ferry at 00:00Z/12:00Z. Two
// crossings on two clocks; a weight lands at this one. Reusing the ferry's helper
// would have put a plausible, wrong time on every forecast.
export const SETTLEMENTS_UTC = Object.freeze([[6, 0], [18, 0]]);
export const SETTLEMENT_CLOCK = "the keeper's settlement, 06:00/18:00Z (the sweep's own timer) — not the ferry's 00:00/12:00Z crossing, and not the candle's window";

export function nextSettlement(now = new Date()) {
  for (const day of [0, 1]) {
    for (const [h, m] of SETTLEMENTS_UTC) {
      const at = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + day, h, m, 0, 0));
      if (at > now) return at.toISOString();
    }
  }
  return null;
}

// The town's own derive — the artifact a crossing hands the fold, read live. The
// office never learns the ledger grammar; it asks the module that owns it, the
// same way world_stake_read already does for escrow and retirement.
export async function pendingStakeRows(townClone) {
  const engine = join(townClone, "tools", "world-stake.mjs");
  if (!existsSync(engine)) return null;
  const mod = await import(pathToFileURL(engine));
  return mod.deriveWorldMarkWeights(townClone)?.rows ?? [];
}

const disclose = (reason) => ({ unavailable: reason });

// WHAT THE PUBLIC IS TOLD WHEN THE PENDING FOLD FAILS, and no more than this.
// Exported so a test can grep the exact string that reaches a reader: the whole
// point is that it names no mark, no household, and no slug.
export const FOLD_UNREADABLE = "the next Settlement could not be read — a pending line could not be read";

/**
 * The rows that can be folded against a tree holding `published`.
 *
 * A row naming a mark the tree does not hold is a PUBLICATION IN TRANSIT — since
 * the self-stake publish path shipped, the normal case rather than a fault. It
 * cannot contribute weight to anything in this tree (there is nowhere for it to
 * fan up from), and left in it makes marks-fold refuse the tree entirely.
 *
 * Pure, and exported, because the rule is the fix and the rule is what wants
 * pinning — the plumbing around it is just a fold call.
 */
export function foldableStakeRows(rows = [], published = new Set()) {
  const held = published instanceof Set ? published : new Set(published ?? []);
  return (rows ?? []).filter((row) => row && held.has(row.mark));
}

/**
 * What the next save will say this mark carries — or nothing, when it will say
 * what the last one already did.
 *
 * Returns `null` where there is no pending delta. That absence is the UI rule
 * held at the door: a mark with nothing pending must render exactly as it does
 * today, and the viewer should never have to decide that for itself.
 *
 * Returns `{ unavailable }` where an input is missing. Rendering nothing there
 * would be indistinguishable from "your stake already settled" — an answer
 * wearing the grammar of an answer that had its inputs (the-town/the-disclosure).
 */
export async function forecastForMark(mark, { worldClone, townClone, now = new Date() } = {}) {
  if (!mark || !worldClone || !townClone) return disclose("the office has no world record to read against");
  if (!existsSync(join(worldClone, ".git"))) return disclose("the office has no world clone to fold");

  let ref;
  let settled;
  let published;   // the mark ids main actually holds — see the filter below
  try {
    ref = mainRef(worldClone);
    const state = readJsonAtRef(worldClone, ref, "WORLD/world-state.json");
    // A mark absent from the newest save has no settled figure to differ from —
    // it is a draft, and the drafts-grey grammar already says so on every surface.
    const row = (state?.marks ?? []).find((m) => m.id === mark);
    if (!row) return null;
    settled = Number(row.weight ?? row.stamps ?? 0);
    published = new Set((state?.marks ?? []).map((m) => m.id));
  } catch (e) {
    return disclose(`the world record could not be read (${String(e?.message ?? e).slice(0, 120)})`);
  }

  let proposed;
  try {
    const rows = await pendingStakeRows(townClone);
    if (rows === null) return disclose("the office has no town clone carrying the world-stake derive");
    // AN EMPTY BOOK IS AN ABSENT INPUT, not a forecast of nothing. A stale or
    // unreadable ledger derives zero rows, and folding those says every mark in
    // the world loses all its weight at the next crossing — a catastrophic claim
    // made with a judgment's confidence. Found by pointing this at the live world
    // with a town clone whose ledger the derive could not see: `proposed: 0`
    // against a settled ✦74. Refusing here costs nothing true, because a town
    // that really holds no stakes has a save with no weight to differ from.
    if (!rows.length) return disclose("the town's stake ledger read empty — the pending book could not be trusted");
    // The judgment, imported and not repeated: the same fold, the same tree, a
    // later book. Published canon only — the stakes half of the forecast is a
    // public read, and a household's own held mark-files already render grey.
    // A PENDING ROW FOR A MARK MAIN DOES NOT HOLD IS A PUBLICATION IN TRANSIT,
    // and since tonight it is the NORMAL case: staking your own draft is how a
    // draft gets published, so between the stake and the sweep the ledger
    // legitimately names a mark that lives only on a draft branch.
    //
    // Unfiltered, marks-fold refuses the whole tree over it — "stake on a mark
    // the record does not hold" — and because one bad row fails the entire fold,
    // ONE household's in-transit publication blanked the forecast for EVERY
    // viewer and every mark. That is the founder-reported defect.
    //
    // The settlement sweep already solved this, and the fix is its line borrowed:
    // settlement-sweep.mjs filters its rows by the ids the tree holds before
    // folding each ref. Filtering rather than tolerating per-row is right HERE
    // for a reason particular to this function: `ref` is always mainRef, and on
    // main the save and the marks tree are written by the same sweep, so they
    // agree — a row main's save does not name is a row main's tree does not hold.
    // Such a row cannot fan weight into anything published, because it has
    // nowhere in this tree to fan up from.
    const foldable = foldableStakeRows(rows, published);
    // EVERY PENDING ROW WAS A DRAFT. Folding the remainder would say every
    // published mark carries nothing — the same catastrophic claim the empty-book
    // guard above refuses. Nothing pending touches anything published, which is
    // precisely what "no delta" means, so answer it as one.
    if (!foldable.length) return null;
    const state = foldedStateAtRef(worldClone, ref, { stakes: foldable });
    const row = (state?.marks ?? []).find((m) => m.id === mark);
    if (!row) return null;
    proposed = Number(row.weight ?? 0);
  } catch (e) {
    // THE DISCLOSURE IS PUBLIC, AND IT WAS NAMING SOMEBODY ELSE'S DRAFT.
    //
    // The fold's own error text carries the offending stake row, and the row
    // carries a mark id — so slicing 120 characters of it into the answer put a
    // foreign household's unpublished mark slug into every reader's stake pane.
    // A draft is not public until its household publishes it; the office does not
    // get to leak one in an error message.
    //
    // The cap is the SHAPE of the failure and nothing about whose it is. The full
    // error still exists, on the server, where the operator can read it.
    console.error("[forecast] the pending fold failed", { mark, ref, error: String(e?.stack ?? e?.message ?? e) });
    return disclose(FOLD_UNREADABLE);
  }

  if (!Number.isFinite(proposed) || proposed === settled) return null;
  return { weight: proposed, settled, at: nextSettlement(now) };
}
