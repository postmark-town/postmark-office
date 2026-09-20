// ledger-names.mjs — the world's ledger filenames, and what the retired ones became.
//
// ── WHY THIS FILE EXISTS ─────────────────────────────────────────────────────
//
// THE CLASS (postmark#2894, found 2026-09-17 by the POS-104 measurement): A
// GUARD PINNED TO A FILENAME DIES AT THE NEXT RENAME AND NOTHING SAYS SO.
//
// `falsifier-live-equality.mjs`'s E6occupancy takes its ledger path from the
// frozen passage acts themselves — `payload._ledger` — which is deliberate and
// well-reasoned: "the acts name their own source, so nothing here guesses which
// file to read." The trouble is that a FROZEN record keeps the vocabulary of
// the day it was frozen. The backfilled acts say `WORLD/threshold-ledger.md`;
// that file is gone from world main; so E6 compared 0, landed in `unchecked`,
// and the WHOLE RUN exited 2 (CANNOT RUN) on any current checkout. It had been
// unable to complete for nineteen days when a lane finally ran it.
//
// The repair is not to guess and not to stop naming the source. It is to write
// the rename DOWN, dated and evidenced, so a reader that resolves a live path
// from a frozen field can map the retired spelling forward and say that it did.
//
// ── WHAT IS MEASURED, NOT ASSUMED ────────────────────────────────────────────
//
// Every field below was measured in a read-only clone of keeminlee/postmark-world
// on 2026-09-17, not taken from an issue body. Two of those measurements
// CORRECTED the issue that asked for this fix:
//
//   · postmark#2894 (and the POS-104 report it was filed from) dates the death
//     of the retired name to 2026-08-29 and attributes it to world `3ef755913`.
//     `3ef755913` is NOT AN ANCESTOR OF WORLD MAIN — `git merge-base --is-ancestor`
//     says no. It is the founder's vocabulary ruling ("DO NOT CALL IT CROSSING
//     RECORD. ENTEREXIT. EVERYWHERE.", 2026-08-29) and it is real, but it is not
//     the commit that removed the file from the tree this pen reads.
//
//   · The commit that actually deleted `WORLD/threshold-ledger.md` from main is
//     `2a9042d4b`, 2026-08-28 — "the passage record keeps one file, and the
//     retired twin is deleted (#2152)" — and the same commit modified
//     `WORLD/enter-exit-ledger.md`, which is the successor.
//
// THE SUCCESSOR IS PROVEN BY BYTES, NOT BY NAME. At `settlement/S50`, where both
// files still stand, they are byte-identical (both md5 bd20f9b74b7f, 185 lines).
// The world's own prose says so on both sides of the rename — before:
// "`WORLD/threshold-ledger.md` carries these same bytes for one grace window";
// after, on main: "The retired name `WORLD/threshold-ledger.md` is gone
// (2026-08-28) … there is no second file."
//
// THE CONSEQUENCE FOR AN OLD TAG IS NOTHING, AND THAT IS THE POINT. Where the
// named file still exists — `settlement/S50` is the recipe's own historical
// case — the resolver returns it untouched and the pen reads exactly the bytes
// it read before. The rename is followed ONLY when the named file is absent, so
// this cannot change any verdict that was reachable before it.
//
// ── WHAT THIS FILE IS NOT ────────────────────────────────────────────────────
//
// Not a CLI. It carries no entry guard and no tail on purpose: the roster in
// test/cli-guard.test.mjs is a live scan for entry guards, and a pure module
// belongs outside it. It lives apart from the falsifier for one reason, said
// plainly so the next reader does not mistake it for structure bought early:
// `falsifier-live-equality.mjs` parses argv, imports the checkout's tools and
// connects to Postgres at MODULE SCOPE, so importing it from a test calls
// process.exit(2) before an assertion can run. The fix had to be testable, and
// this is the smallest shape that makes it so.

import { existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Retired ledger path → the path that carries its record today.
 *
 * Keyed by the repo-relative path a frozen act can name. `on`/`by` date the
 * REMOVAL from main (what makes a reader fail), and `word` records the ruling
 * that motivated the vocabulary, which is a different event on a different day
 * and is kept separate so neither gets misquoted as the other again.
 */
export const LEDGER_RENAMES = Object.freeze({
  "WORLD/threshold-ledger.md": Object.freeze({
    to: "WORLD/enter-exit-ledger.md",
    on: "2026-08-28",
    by: "2a9042d4b46bfeffeda61b30474f7d17d4de1373",
    subject: "the passage record keeps one file, and the retired twin is deleted (#2152)",
    word: "founder, 2026-08-29 (world 3ef755913, NOT an ancestor of main): " +
          "\"DO NOT CALL IT CROSSING RECORD. ENTEREXIT. EVERYWHERE.\"",
    proof: "byte-identical at settlement/S50 (both md5 bd20f9b74b7f, 185 lines), " +
           "and the successor's own prose names the retirement and its date",
  }),
});

/**
 * Resolve the ledger a checkout actually carries for a path some record names.
 *
 * Returns `{ rel, followed }` — `rel` is the path to read, and `followed` is
 * null when the named path was the one used, or the rename entry when this
 * walked forward. Returns null when neither the named path nor any successor
 * this module knows about exists in the checkout, so a caller keeps its own
 * honest refusal rather than inheriting a silent one from here.
 *
 * The walk is bounded and visits each path once: a second rename is a second
 * entry in the table above, never a loop that could spin on a cycle somebody
 * typed by hand.
 */
export function resolveLedgerRel(repoDir, namedRel) {
  if (!repoDir || !namedRel) return null;
  const seen = new Set();
  let rel = namedRel;
  let followed = null;
  while (rel && !seen.has(rel)) {
    if (existsSync(join(repoDir, rel))) return { rel, followed };
    seen.add(rel);
    const next = LEDGER_RENAMES[rel];
    if (!next) return null;
    followed = { from: rel, ...next };
    rel = next.to;
  }
  return null;
}
