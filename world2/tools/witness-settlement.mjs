#!/usr/bin/env node
// witness-settlement.mjs — owe and publish a settlement's witness record (POS-907).
//
//   node world2/tools/witness-settlement.mjs --receipt <settlement-auto.json> --attempt <n or empty>
//        --event <when the crossing started> --town <town clone> [--sweep <World sweep clone>]
//        [--lock <town.lock>]
//
// Run by deploy/settlement-auto.sh § report for every DECIDED crossing (the
// history's rule: deploy/settlement-history.mjs § isDecision, so a lost race
// inside the retry wrapper is not a decision yet), and once more by the wrapper
// when a race outlives its retries.
//
// The town's witness chain is the town's: its grammar, owed queue and publisher
// are the town clone's own tools/witness-chain.mjs (town WITNESS.md). This only
// composes the settlement's DECIDED OUTCOME from the receipt and the sweep
// clone, owes it there, and publishes under the town clone's lock, the one the
// ferry holds (deploy/postmark-ferry.service), so the two never write the clone
// at once.
//
// THE OUTCOME, all of it public: the receipt's own bytes (the file the harbor
// serves), its status and detail, the town and World shas it read and the World
// sha it published, and every World file that publication changed, by digest.
//
// Bookkeeping beside a crossing: it never fails one. Exit 0 when it did its
// part, when the witness is not configured, and when the record is left owed
// (it says which); 2 for a usage error.
//
// Env: WITNESS_KEY (the witness's private key, never the stamp pen's) and
// WITNESS_OWED (the owed queue's directory). Unset, it prints that the witness
// is not configured and does nothing. No secret is printed.

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { isDecision } from "../../deploy/settlement-history.mjs";

const HEX40 = /^[0-9a-f]{40}$/;
const sha256 = (b) => createHash("sha256").update(b).digest("hex");

function git(repo, args) {
  const r = spawnSync("git", ["-C", repo, ...args], { maxBuffer: 512 * 1024 * 1024 });
  return { status: r.status, stdout: r.stdout ?? Buffer.alloc(0), stderr: String(r.stderr ?? "") };
}

/**
 * The World files a publication changed, each bound by its digest at world_to
 * (sha256 null for a file the publication removed). [] with a reason when the
 * sweep clone cannot answer: a record that names fewer files says why.
 */
export function worldArtifacts(sweep, worldFrom, worldTo) {
  if (!sweep || !HEX40.test(worldFrom ?? "") || !HEX40.test(worldTo ?? "") || worldFrom === worldTo) return { artifacts: [], why: null };
  const diff = git(sweep, ["diff", "--name-only", "--no-renames", "-z", worldFrom, worldTo]);
  if (diff.status !== 0) return { artifacts: [], why: `the sweep clone could not diff ${worldFrom.slice(0, 8)}..${worldTo.slice(0, 8)}: ${diff.stderr.trim()}` };
  const paths = diff.stdout.toString("utf8").split("\0").filter(Boolean).sort();
  const artifacts = paths.map((path) => {
    const blob = git(sweep, ["cat-file", "blob", `${worldTo}:${path}`]);
    return { repo: "world", commit: worldTo, path, sha256: blob.status === 0 ? sha256(blob.stdout) : null };
  });
  return { artifacts, why: null };
}

/** The settlement's decided outcome, in the town witness chain's shape (town WITNESS.md). */
export function settlementDecided({ receiptText, attempt, event, sweep = null }) {
  const receipt = JSON.parse(receiptText);
  const at = typeof receipt.at === "string" && !Number.isNaN(Date.parse(receipt.at)) ? receipt.at : null;
  if (!at) throw new Error("the receipt carries no `at` instant");
  const inputs = {};
  if (HEX40.test(receipt.town_sha ?? "")) inputs.town_sha = receipt.town_sha;
  if (HEX40.test(receipt.world_from ?? "")) inputs.world_from = receipt.world_from;
  const results = {};
  if (HEX40.test(receipt.world_to ?? "")) results.world_to = receipt.world_to;
  const { artifacts, why } = String(receipt.status) === "published"
    ? worldArtifacts(sweep, receipt.world_from, receipt.world_to)
    : { artifacts: [], why: null };
  const outcome = { status: String(receipt.status), detail: String(receipt.detail ?? "") };
  if (why) outcome.artifacts_unread = why;
  return {
    v: 1,
    kind: "settlement",
    event: `settlement:${event}`,
    attempt: attempt ? String(attempt) : "final",
    // The receipt's own instant, so recomposing the same decision is the same
    // outcome, and the chain's dedupe sees one record, not two.
    decided_at: at,
    outcome,
    inputs,
    results,
    heads: {},
    artifacts,
    receipt: { sha256: sha256(Buffer.from(receiptText, "utf8")), text: receiptText },
  };
}

function main(argv) {
  const opt = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] ?? "" : null; };
  const log = (m) => process.stderr.write(`[witness] ${m}\n`);
  const receiptPath = opt("--receipt");
  const event = opt("--event");
  const town = opt("--town");
  if (!receiptPath || !event || !town) { log("witness-settlement: --receipt, --event and --town are required"); return 2; }
  const attempt = opt("--attempt") ?? "";

  const key = process.env.WITNESS_KEY ?? "";
  const owed = process.env.WITNESS_OWED ?? "";
  if (!key || !owed) { log("not configured (WITNESS_KEY, WITNESS_OWED): this settlement owes no record"); return 0; }
  const cli = join(resolve(town), "tools", "witness-chain.mjs");
  if (!existsSync(cli)) { log(`the town clone has no tools/witness-chain.mjs yet: no record (${town})`); return 0; }

  let receiptText;
  try { receiptText = readFileSync(receiptPath, "utf8"); } catch (e) { log(`no receipt to witness at ${receiptPath}: ${e.message}`); return 0; }
  let receipt;
  try { receipt = JSON.parse(receiptText); } catch (e) { log(`the receipt does not parse, so no record: ${e.message}`); return 0; }
  if (!isDecision(receipt, attempt)) { log(`attempt ${attempt} lost a race: not a decision yet, so no record`); return 0; }

  let decided;
  try { decided = settlementDecided({ receiptText, attempt, event, sweep: opt("--sweep") }); } catch (e) {
    log(`the settlement's outcome could not be composed, so it is not owed: ${e.message}`);
    return 0;
  }
  const owe = spawnSync(process.execPath, [cli, "owe", "--owed", owed, "--decided", "-"], { input: JSON.stringify(decided), encoding: "utf8" });
  process.stderr.write(owe.stderr);
  if (owe.status !== 0) { log(`the settlement's outcome could not be owed (exit ${owe.status})`); return 0; }

  // Publish under the town clone's lock, the ferry's. A lock that is not free
  // in time leaves the record owed; the next crossing or settlement pays it.
  const lock = opt("--lock") ?? join(process.env.OFFICE_ROOT ?? "/srv/postmark-office", "town.lock");
  const publishArgs = [cli, "publish", "--repo", resolve(town), "--owed", owed, "--key", key];
  const hasFlock = spawnSync("flock", ["--version"], { stdio: "ignore" }).status === 0;
  const pub = hasFlock
    ? spawnSync("flock", ["-w", "120", lock, process.execPath, ...publishArgs], { encoding: "utf8" })
    : spawnSync(process.execPath, publishArgs, { encoding: "utf8" });
  process.stderr.write(pub.stderr ?? "");
  if (pub.status === 0) return 0;
  log(pub.status === 1 && hasFlock && !pub.stderr
    ? `the town clone's lock (${lock}) was not free in 120 s: the record is owed`
    : `the record is owed, not published (exit ${pub.status}); the next crossing or settlement pays it`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = main(process.argv.slice(2)); } catch (e) {
    process.stderr.write(`[witness] ${e.message}\n`);
    process.exitCode = 0;
  }
}
