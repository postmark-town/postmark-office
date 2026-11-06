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
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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

/** One run's name in the chain: the crossing's event and this attempt, unique across crossings. */
export const attemptOf = (event, attempt) => `${event}#${attempt ? String(attempt) : "final"}`;

/**
 * The World inventory a settlement binds: every file the run changed, or WHY it
 * could not be read. An unread inventory is never an empty one (Rivet's FIX,
 * 2026-11-06): `complete: false` and its reason, which the town's verifier reads
 * as incomplete. A run that moved nothing has a complete, empty inventory.
 */
export function settlementInventory({ status, worldFrom, worldTo, sweep }) {
  const to = HEX40.test(worldTo ?? "") ? worldTo : null;
  if (!to) {
    return String(status) === "published"
      ? { artifacts: [], inventory: { complete: false, why: "the receipt names no world_to for a published settlement" } }
      : { artifacts: [], inventory: { complete: true } };
  }
  if (to === worldFrom) return { artifacts: [], inventory: { complete: true } };
  if (!HEX40.test(worldFrom ?? "")) return { artifacts: [], inventory: { complete: false, why: "the receipt names no world_from to diff from" } };
  if (!sweep) return { artifacts: [], inventory: { complete: false, why: "no sweep clone was given, so the changed World files could not be read" } };
  const { artifacts, why } = worldArtifacts(sweep, worldFrom, to);
  return why ? { artifacts: [], inventory: { complete: false, why } } : { artifacts, inventory: { complete: true } };
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
  const { artifacts, inventory } = settlementInventory({ status: receipt.status, worldFrom: receipt.world_from, worldTo: receipt.world_to, sweep });
  const outcome = { status: String(receipt.status), detail: String(receipt.detail ?? "") };
  return {
    v: 1,
    kind: "settlement",
    event: `settlement:${event}`,
    attempt: attemptOf(event, attempt),
    // The receipt's own instant, so recomposing the same decision is the same
    // outcome, and the chain's dedupe sees one record, not two.
    decided_at: at,
    outcome,
    inputs,
    results,
    heads: {},
    artifacts,
    inventory,
    receipt: { sha256: sha256(Buffer.from(receiptText, "utf8")), text: receiptText },
  };
}

function main(argv) {
  const opt = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] ?? "" : null; };
  const log = (m) => process.stderr.write(`[witness] ${m}\n`);
  const opening = argv.includes("--open");
  const receiptPath = opt("--receipt");
  const event = opt("--event");
  const town = opt("--town");
  if ((!opening && !receiptPath) || !event || !town) { log("witness-settlement: --receipt, --event and --town are required (or --open, --event and --town)"); return 2; }
  const attempt = opt("--attempt") ?? "";
  const run = attemptOf(event, attempt);

  const key = process.env.WITNESS_KEY ?? "";
  const owed = process.env.WITNESS_OWED ?? "";
  if (!key || !owed) { log("not configured (WITNESS_KEY, WITNESS_OWED): this settlement owes no record"); return 0; }
  const cli = join(resolve(town), "tools", "witness-chain.mjs");
  if (!existsSync(cli)) { log(`the town clone has no tools/witness-chain.mjs yet: no record (${town})`); return 0; }
  const town_ = (args, input = null) => {
    const r = spawnSync(process.execPath, [cli, ...args], { input, encoding: "utf8" });
    process.stderr.write(r.stderr ?? "");
    return r.status;
  };
  // Publish under the town clone's lock, the ferry's. A lock that is not free
  // in time leaves the record owed; the next crossing or settlement pays it.
  const publishNow = () => {
    const lock = opt("--lock") ?? join(process.env.OFFICE_ROOT ?? "/srv/postmark-office", "town.lock");
    const publishArgs = [cli, "publish", "--repo", resolve(town), "--owed", owed, "--key", key];
    const hasFlock = spawnSync("flock", ["--version"], { stdio: "ignore" }).status === 0;
    const pub = hasFlock
      ? spawnSync("flock", ["-w", "120", lock, process.execPath, ...publishArgs], { encoding: "utf8" })
      : spawnSync(process.execPath, publishArgs, { encoding: "utf8" });
    process.stderr.write(pub.stderr ?? "");
    if (pub.status !== 0) {
      log(pub.status === 1 && hasFlock && !pub.stderr
        ? `the town clone's lock (${lock}) was not free in 120 s: the record is owed`
        : `the record is owed, not published (exit ${pub.status}); the next crossing or settlement pays it`);
    }
    return 0;
  };
  // Whatever goes wrong from here, the run is still owed: as an incomplete
  // outcome with its reason (Rivet's FIX, 2026-11-06), never a stderr line alone,
  // and it is published like any other.
  const incomplete = (why) => {
    const s = town_(["owe-incomplete", "--owed", owed, "--kind", "settlement", "--attempt", run, "--event", `settlement:${event}`, "--why", why]);
    log(s === 0 ? `owed as incomplete: ${why}` : `the outcome could not even be owed as incomplete (exit ${s}); the run's open entry stands, and the next publisher records it`);
    return publishNow();
  };

  // THE OPEN ENTRY, before the settlement does anything. Its holder is the
  // crossing's own shell (--pid), whose death is the run's end.
  if (opening) {
    const pid = opt("--pid") ?? String(process.ppid);
    const s = town_(["owe-open", "--owed", owed, "--kind", "settlement", "--event", `settlement:${event}`, "--attempt", run, "--pid", pid]);
    if (s !== 0) log(`this settlement could not be opened (exit ${s}): its outcome is still owed when it decides`);
    return 0;
  }

  let receiptText;
  try { receiptText = readFileSync(receiptPath, "utf8"); } catch (e) { return incomplete(`no receipt could be read at ${receiptPath}: ${e.message}`); }
  let receipt;
  try { receipt = JSON.parse(receiptText); } catch (e) { return incomplete(`the receipt does not parse: ${e.message}`); }
  // A dry crossing decided nothing (deploy/settlement-receipt.mjs § dry), and a
  // lost race inside the retry is not a decision yet (the history's rule). The
  // wrapper's raced-out path records its receipt whatever the leg, so these
  // rules live here, where every path passes. Neither leaves a debt.
  if (receipt.dry === true || !isDecision(receipt, attempt)) {
    town_(["owe-close", "--owed", owed, "--kind", "settlement", "--attempt", run]);
    log(receipt.dry === true ? "a dry run decided nothing: no record" : `attempt ${attempt} lost a race: not a decision yet, so no record`);
    return 0;
  }

  let decided;
  try { decided = settlementDecided({ receiptText, attempt, event, sweep: opt("--sweep") }); } catch (e) {
    return incomplete(`the settlement's outcome could not be composed: ${e.message}`);
  }
  const oweStatus = town_(["owe", "--owed", owed, "--decided", "-"], JSON.stringify(decided));
  if (oweStatus !== 0) return incomplete(`the settlement's outcome could not be owed (exit ${oweStatus})`);
  return publishNow();
}

// Entered through a symlink or a junction, argv[1] is the link and
// import.meta.url the target: compare real paths, as world2/tools/crossing-receipt.mjs does.
const isMain = (() => {
  if (!process.argv[1]) return false;
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return pathToFileURL(process.argv[1]).href === import.meta.url; }
})();

if (isMain) {
  try { process.exitCode = main(process.argv.slice(2)); } catch (e) {
    process.stderr.write(`[witness] ${e.message}\n`);
    process.exitCode = 0;
  }
}
