#!/usr/bin/env node
// retire-unpublished.mjs — THE RETIRE STEP AT THE SETTLEMENT SEAM.
//
//   node world2/tools/retire-unpublished.mjs --sweep <sweep.json> [--window N]
//                                            [--dry-run] [--json]
//
//   env: WORLD2_CLEARING_URL = postgres://clearing_job:…@localhost/world2_dev
//
// EXIT CODES:  0 retired, or nothing to retire · 1 REFUSED (loud; the crossing
//              must not publish a receipt claiming a retirement it did not make)
//              · 2 a bad argument or a missing credential.
//
// ── THE GAP, MEASURED BEFORE IT WAS BUILT ───────────────────────────────────
//
// The store never retired what the world unpublished. `marks.status` has
// allowed `'retired'` since 001_tables.sql:110 and `retired_window` has existed
// beside it since :112, and until this tool the only writers of either were
// `replay-ingest.mjs`'s backfill and `falsifier-standing-equality.mjs`'s own
// can-fail fixture — neither of them a live path. On the pre-cutover dump that
// read 1,019 standing and 0 retired, ever.
//
// The consequence is not a stale row. `materialize.mjs`'s `recomputeStanding`
// walks `WHERE status = 'standing'` and standing is a fact about the ground a
// mark stands on, so a mark that should have been retired keeps holding ground
// under its neighbours. That is why this runs BEFORE a recompute and never
// after, and why the step is a transaction rather than a nightly tidy.
//
// ── WHAT THIS TOOL CLAIMS, AND WHAT IT DELIBERATELY DOES NOT ────────────────
//
// It closes ONE of the three doors a mark leaves canon by. The three were
// measured on world main before this was written, and saying which is which is
// most of the value here:
//
//   DOOR A · THE SWEEP'S UNPUBLISH — this tool's whole scope. A commons mark
//     the sweep previously admitted whose escrow has fallen to zero
//     (settlement-sweep.mjs:1161-1183). It leaves canon with a named channel
//     in a machine-readable report, at a known instant, on a crossing — which
//     is exactly what makes it mechanizable. `pistache-cone-for-julian` left
//     by this door at world `49e0fe89`.
//
//   DOOR B · A LAW OR HAND COMMIT ON MAIN — NOT closed here, and not closeable
//     at this seam. `the-town/pledges` was added at `7b1b03b1` and removed at
//     `6b235216`, a founder-ruled law commit ("the three asks", 2026-08-30).
//     No sweep ran, no channel named it, and there is no report for this tool
//     to read. Closing this door means the store learning to diff canon
//     against its own register, which is a different lane with a different
//     oracle — see the report's § what is still owed.
//
//   DOOR C · NEVER PUBLISHED AT ALL — not a retirement, and treating it as one
//     would be a lie in a new direction. `darko/the-second-foundation-stone`
//     and `wright/final-unstaked` have no file on any ref of the world repo,
//     ever; `little-bird/the-second-spoon-verdict` exists only on a draft
//     branch (drained at `5fe5e8b3`) and never reached main. A mark that never
//     stood cannot stop standing, and writing `retired` over it would record
//     "this stood and then ended" for something that did neither. These are a
//     MATERIALIZATION defect — the store locked a claim canon never carried —
//     and they belong to the draft/published lane, not to this one.
//
// A step that quietly retired all three classes would go green on the
// falsifier and be wrong about two thirds of the town. So this tool takes only
// what the sweep names, and the receipt says which door it acted on.
//
// ── WHY IT IS A SEPARATE PROCESS FROM THE SWEEP ─────────────────────────────
//
// The sweep runs inside the world checkout and holds no database credential;
// this holds `clearing_job` and no checkout. Merging them would give the sweep
// a store pen for the length of a crossing, which is the "the role happened to
// be handy" shape `snapshot-export.mjs` names as how a fourth writer gets born.
// The crossing chain joins them instead, and the join is one `&&`.
//
// ── LOUD, BECAUSE THE MIRROR TAUGHT US ──────────────────────────────────────
//
// The reverse mirror was best-effort and fell behind five acts without a sound
// (flip-watch 09-06). This is not best-effort: a refusal exits 1, names the
// slug it died on, and writes nothing — the transaction rolls back whole. The
// crossing chain treats that as a refusal rather than publishing a receipt that
// claims a retirement that did not happen.

import { readFileSync } from "node:fs";

import { retireMarks, returnToDrafts } from "./materialize.mjs";

const arg = (n) => { const i = process.argv.indexOf(n); return i === -1 ? null : process.argv[i + 1]; };
const has = (n) => process.argv.includes(n);

/**
 * The slugs a sweep report says left canon.
 *
 * ONLY `unpublished`. The sweep has six other outcome channels and none of them
 * is a retirement: `left_drafted` never published, `withdrawn` is the docket's
 * own lane (world2-claims.mjs:228), `quarantined` and `suite_quarantined` are
 * held back rather than let go, `dropped` is the-already-standing (a copy that
 * was never a conflict — the ORIGINAL still stands and retiring by that id
 * would retire the survivor), and `rebased` is git mechanics. Reading a second
 * channel into this step is how it would start retiring marks the world still
 * carries, which the negative control in the test asserts it does not.
 *
 * ── THE IDENTITY MAPPING, PROVEN RATHER THAN ASSUMED ───────────────────────
 *
 * This is the one line the whole step hangs on: `unpublished[].id` must be
 * `marks.slug`, or nothing is retired. It is checked against the register both
 * ends:
 *
 *   · the sweep builds `unpublished` from `registry.published`'s KEYS
 *     (settlement-sweep.mjs:1174-1183), and those keys read
 *     `"berthillon/pistache-cone-for-julian"` in
 *     `WORLD/settlement-publications.json` on world main — `<owner>/<name>`.
 *   · `marks.slug` is `<owner>/<name>` by 001_tables.sql:102's own comment,
 *     "the 1.0 path identity", and `world-state.json`'s mark ids agree
 *     (`alex-rowan/the-threadbound-house`, …).
 *
 * THE TRAP THIS AVOIDS, which I walked into once while writing the tests: the
 * PATH is not the id. The pistache cone's registry path is
 * `WORLD/marks/let-there-be-light/the-town-centre/pistache-cone-for-julian/mark.md`
 * — `let-there-be-light` is a REGION segment and `the-town-centre` a
 * containment one, and neither is the owner (the owner is `berthillon`, whose
 * household is `devadavisson`, which is a third thing again — the ownership
 * grain materialize.mjs warns about). Deriving the slug from the path would
 * produce an identity the register has never held.
 *
 * And `marks.id` is NOT this: 001_tables.sql:101 makes it a uuid, "= the
 * locking claim's id".
 *
 * ── WHAT A WRONG IDENTITY ACTUALLY DOES, CORRECTED ─────────────────────────
 *
 * This paragraph used to warn that a wrong identity fails SILENTLY — "the
 * quietest possible failure", and matching on `marks.id` "a no-op UPDATE
 * reporting a clean crossing". A reviewer ran both against the store on
 * 2026-09-08 and neither is true, so both are struck. Recording what the store
 * really does, because a warning about a hazard the design already closes is
 * worse than no warning: it teaches the next reader to fear the wrong thing,
 * and it implies a guard is missing when it is present.
 *
 *   A WRONG-BUT-VALID SLUG → `absent`, and the receipt CARRIES IT BY NAME.
 *   `retireMarks` distinguishes its two zeroes on purpose, and
 *   settlement-receipt.mjs prints the `absent` list in full rather than as a
 *   count, precisely so an operator sees which slugs the register did not hold.
 *   `test/retire-marks.test.mjs`'s fifth test is the proof, and the keeper's
 *   own step-2 sentence makes a non-empty `absent` a finding. Not silent.
 *
 *   MATCHING ON `marks.id` → Postgres raises `invalid input syntax for type
 *   uuid` on the first row. The transaction ROLLS BACK whole and `main()`
 *   exits 1 with the message. That is the LOUDEST failure in this file, not a
 *   quiet one.
 *
 * The mapping still deserves the care above; what it does not deserve is a
 * scary story about a failure mode that cannot happen here.
 */
export function slugsFromSweep(sweep) {
  const rows = Array.isArray(sweep?.unpublished) ? sweep.unpublished : [];
  return rows.map((r) => r?.id).filter((id) => typeof id === "string" && id.length > 0);
}

async function main() {
  const sweepPath = arg("--sweep");
  if (!sweepPath) { console.error("usage: retire-unpublished.mjs --sweep <sweep.json> [--window N] [--dry-run] [--json]"); process.exit(2); }

  let sweep;
  try { sweep = JSON.parse(readFileSync(sweepPath, "utf8")); }
  catch (e) {
    // A sweep report this tool cannot read is NOT "nothing to retire". The
    // crossing produced a report and this step could not see it, which is a
    // different fact and the one that must stop the chain.
    console.error(`cannot read the sweep report at ${sweepPath}: ${e.message}`);
    process.exit(1);
  }

  const slugs = slugsFromSweep(sweep);
  if (has("--dry-run")) {
    process.stdout.write(`${JSON.stringify({ dry_run: true, would_retire: slugs }, null, 1)}\n`);
    process.exit(0);
  }

  // Nothing to do is a real, common, green outcome — and it still prints a
  // receipt, because "0 retired" is the evidence the step RAN and its absence
  // is indistinguishable from a step nobody called. That distinction is the
  // whole lesson of the drain's three caller-less days.
  if (!slugs.length) {
    process.stdout.write(`${JSON.stringify({ ran: true, retired: [], already_retired: [], absent: [], count: 0, drafts: { returned: [], kept: [], unreturned: [] } }, null, 1)}\n`);
    process.exit(0);
  }

  const url = process.env.WORLD2_CLEARING_URL;
  if (!url) { console.error("WORLD2_CLEARING_URL missing (role clearing_job) — refusing rather than skipping the retirement"); process.exit(2); }

  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  const q = (text, args) => client.query(text, args);
  try {
    await q("BEGIN");
    const windowArg = arg("--window");
    let windowId = windowArg === null ? null : Number(windowArg);
    if (windowId === null) {
      // The open window is the one this crossing is ruling under, and it is read
      // rather than passed so a caller cannot name a closed window by accident.
      const { rows } = await q("SELECT id FROM windows WHERE status = 'open' ORDER BY id DESC LIMIT 1");
      if (!rows.length) throw new Error("no open window — the candle is dark; a retirement must be ruled at a window");
      windowId = Number(rows[0].id);
    }
    const report = await retireMarks(q, { slugs, windowId, cause: "settlement-unpublish" });
    // WLD-51 G1 (Darko, 2026-10-15 13:00): each mark this crossing took goes
    // back to its household's drafts, in the same transaction, so a retirement
    // and its return commit together or not at all. Only the marks retired NOW:
    // a re-run retires nothing and so returns nothing twice.
    const drafts = await returnToDrafts(q, { slugs: report.retired.map((r) => r.slug), windowId });
    await q("COMMIT");
    process.stdout.write(`${JSON.stringify({ ran: true, ...report, count: report.retired.length, drafts }, null, 1)}\n`);
    process.exit(0);
  } catch (e) {
    try { await q("ROLLBACK"); } catch { /* the connection is already gone */ }
    console.error(`RETIRE REFUSED — nothing was written: ${e.message}`);
    process.exit(1);
  } finally {
    try { await client.end(); } catch { /* already closed */ }
  }
}

// The junction lesson (2026-09-05): `argv[1] === import.meta.url` is false when
// the path reaches this file through a Windows junction, and the tool then
// exits 0 having done nothing. Compare resolved real paths instead.
const invokedDirectly = await (async () => {
  try {
    const { realpathSync } = await import("node:fs");
    const { fileURLToPath, pathToFileURL } = await import("node:url");
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
      || pathToFileURL(process.argv[1]).href === import.meta.url;
  } catch { return false; }
})();

if (invokedDirectly) await main();
