#!/usr/bin/env node
// stamp-verify-owed.mjs — the town's stamp-verify, where "behind the mail" is not red
// (POS-341, Darko 2026-10-20 15:38).
//
//   node /srv/postmark-office/tools/stamp-verify-owed.mjs [--repo <town clone>] [the town verify's own args]
//
// Runs the town's own `tools/stamp-verify.mjs` (in --repo, else the working
// directory) with the same arguments, and passes its output through. Exit 0 when
// it is green, OR when every problem it names is one of its two "not a tamper"
// sentences: the ledger is behind the derivation (mints owed), or a paying
// letter is not settled yet (settlement owed). Exit 1 on anything else, with the
// town's own words. Exit 2 if there is no town verifier to run.
//
// ── WHY ─────────────────────────────────────────────────────────────────────
// Darko ruled that in store mode a crossing whose town-index ingest failed skips
// the store mint, and the keep tick pays what is owed. The town's verifier reads
// an unpaid crossing as red ("mints owed, run the mint pass (not a tamper)"), so
// the plain verify would only move the red one line down the ferry's chain, and
// the tick's own arrival check (office-keep.sh) would refuse to start the very
// catch-up that pays it. This is the check for exactly those two places: the
// ferry's verifies after a skipped mint, and the tick's arrival check. Every
// verify AFTER a write stays the town's plain one, so a pass that appends still
// has to leave the ledger whole.
//
// What it still refuses, because the verifier still runs every check: the chain,
// the signatures, the replay (an owed sentence is only printed when the replay
// found nothing else), conservation and the lawful fold. The settlement check
// runs only on a ledger with no other problem, so it is skipped while mints are
// owed, and it is itself an owed sentence. The same two sentences are what
// src/house-key.mjs already reads as "not a divergence".

import { existsSync, realpathSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";

const OWED = /^(ledger is \d+ line\(s\) behind the derivation — mints owed|settlement owed for "mail:[^"]+" — ledger is behind the mail), run the mint pass \(not a tamper\)$/;

/** The problems a town verify printed ("  - <problem>" under its FAILED line), split into owed and the rest. */
export function owedOnly(output) {
  const problems = String(output).split("\n").map((l) => l.replace(/\r$/, "")).filter((l) => l.startsWith("  - ")).map((l) => l.slice(4));
  return { owed: problems.filter((p) => OWED.test(p)), other: problems.filter((p) => !OWED.test(p)) };
}

const isMain = process.argv[1] && realpathSync(process.argv[1]).replace(/\\/g, "/").endsWith("/stamp-verify-owed.mjs");

if (isMain) {
  const args = process.argv.slice(2);
  const i = args.indexOf("--repo");
  const repo = resolve(i !== -1 ? args[i + 1] : process.cwd());
  const verifier = join(repo, "tools", "stamp-verify.mjs");
  if (!existsSync(verifier)) {
    console.error(`stamp-verify-owed: no town at ${repo} (no tools/stamp-verify.mjs)`);
    process.exit(2);
  }
  const r = spawnSync(process.execPath, [verifier, ...args], { cwd: repo, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  if (r.status === 0) process.exit(0);
  const { owed, other } = owedOnly(`${r.stdout ?? ""}\n${r.stderr ?? ""}`);
  if (r.status === 1 && owed.length && !other.length) {
    console.log(`[stamp-verify-owed] behind the mail and nothing else (${owed.length} owed sentence(s), not a tamper): green for this check; the mint pass pays them`);
    process.exit(0);
  }
  process.exit(r.status === null ? 1 : r.status || 1);
}
