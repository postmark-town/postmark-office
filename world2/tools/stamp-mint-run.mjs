#!/usr/bin/env node
// stamp-mint-run.mjs — THE MINT DECIDES FROM THE STORE (POS-341, Q4).
//
// Ruled by Darko, 2026-10-04. The crossing's mint pass was `node
// tools/stamp-mint.mjs --append`, run in the town clone. It decided every
// correspondence mint, friendship mint, transfer and void from git files: the
// mail ledger, the pins file, the ADDRESS cards and the stamp ledger itself.
// That is how nine households minted as two (68 extra stamps, 09-14 → 10-03):
// the keys came from files nothing compared. This runner makes the same
// decision from the store:
//
//   the ledger      stamp_lines (066)
//   the key base    household_pins + town_rooms (067), src/mint-inputs.mjs §
//                   keyBaseOf, held to the town's householdKeys by the parity
//                   gate (world2/tools/stamp-mint-parity.mjs)
//   the deliveries  town_mail_lines (067), read by the town's own parseDeliveries
//
// THE LAW STAYS THE TOWN'S. The runner imports the town engine and calls the
// functions --append calls, in --append's order: deriveMints,
// deriveFriendshipMints, combineDerived, walkLedger (a divergent ledger appends
// nothing), deriveTransfers, interleaveByDelivery. Then it signs the owed lines
// onto the export with the engine's own appendSigned, verifies it, and then,
// in one SHORT store transaction (SQL and the push only: § mintFromStore),
// records them in stamp_lines and commits the export (src/stamp-lines.mjs §
// the pen's transaction). Its output is --append's, line for line:
// test/stamp-mint-run.test.mjs holds the two byte-equal on a fixture town.
//
//   node world2/tools/stamp-mint-run.mjs --append --key <ed25519 pem> [--clone <town clone>] [--message <commit message>]
//
// The caller holds the town lock (the ferry's flock, the keep tick's), as for
// --append. The store must hold its inputs: 066 and 067 applied, one town-index
// ingest run and the chain recorded (stamp-lines.mjs --sync). An empty input is
// a refusal by name, never a mint from nothing. Exit 0 appended or up to date,
// 1 refused.

import { existsSync, realpathSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { mintInputsVia, keyBaseOf, sealedDatesOf, deliveriesOf } from "../../src/mint-inputs.mjs";
import { engineOf, stampLinesVia, syncStampLinesVia, stampRowsPast, stampHeadVia, lockStampLinesVia, insertStampRowsVia } from "../../src/stamp-lines.mjs";
import { LOST_RACE, penCommit } from "../../src/write.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * What --append would append, decided from the store's inputs: `{ problems,
 * lines, mints, moved, voided, recorded }`. `lines` are canonicals, unsigned.
 * Pure over its arguments, so a test can hold it to the town CLI.
 */
export function owedFromStore(engine, { entries, mailLines, pins, rooms }) {
  const deliveries = deliveriesOf(engine, mailLines);
  const households = keyBaseOf({ pins, rooms, sealed: sealedDatesOf(engine, entries) });
  const { laws, revisions } = engine.parseLaws(entries);
  const corr = engine.deriveMints(deliveries, households, { laws, revisions });
  const friend = engine.deriveFriendshipMints(deliveries, households, { laws, revisions });
  const mints = engine.combineDerived(deliveries, corr, friend);
  const transfers = engine.deriveTransfers(deliveries, households, { laws, revisions }, entries);
  const genesisDate = deliveries[0]?.date ?? "2026-06-12";
  const recorded = entries.map((e) => e.canonical);
  if (entries.length > 0 && recorded[0] !== engine.rulesLine(genesisDate))
    return { problems: ["the ledger does not open with the v1 rules marker"], lines: [] };
  const body = entries.length === 0 ? [] : recorded.slice(1);
  const { problems, owed } = engine.walkLedger(body, mints);
  if (problems.length) return { problems, lines: [] };
  const settled = new Set();
  for (const e of entries) { const c = engine.classifyEntry(e.canonical); if (c.kind === "transfer" || c.kind === "void") settled.add(c.id); }
  const owedTransfers = transfers.filter((t) => !settled.has(t.id));
  const owedLines = engine.interleaveByDelivery(deliveries, owed, owedTransfers);
  return {
    problems: [],
    lines: entries.length === 0 ? [engine.rulesLine(genesisDate), ...owedLines] : owedLines,
    mints: owed.length,
    moved: owedTransfers.filter((t) => t.kind === "transfer").length,
    voided: owedTransfers.filter((t) => t.kind === "void").length,
    recorded: entries.length,
  };
}

/** How many times the pass decides again when the chain's head moved under it, before it refuses. */
export const HEAD_TRIES = 3;

// The push is the one non-SQL step left inside the landing transaction, and it
// cannot move out: the store commits only after git lands, so a push that
// cannot land rolls the store back (src/stamp-lines.mjs § the pen's
// transaction). A push can take longer than the store's idle budget on a slow
// network, so that one transaction names its own (WORLD2_PG_LAND_TX_MS).
export const LAND_TX_MS_DEFAULT = 120_000;
const landTxMs = (env) => { const n = Number(env.WORLD2_PG_LAND_TX_MS); return Number.isFinite(n) && n > 0 ? n : LAND_TX_MS_DEFAULT; };

const MOVED = Symbol("the chain's head moved");
const racedNote = (n) => n ? ` (decided again after ${n} lost push race${n === 1 ? "" : "s"})` : "";

/**
 * The pass. A WRITE TRANSACTION NEVER SPANS NON-SQL WORK (Wright's review of
 * #415, 2026-10-07: the 30 s idle-transaction budget killed a pass that held
 * one open across the derivation and the town's full verify, and a raised
 * budget would only have held every other stamp writer that long):
 *
 *   1. the store reads git: whatever the export holds past the store is
 *      recorded, in its own short transaction (a few lines, or none);
 *   2. one READ ONLY transaction reads the chain and the inputs, SQL only;
 *   3. with NO transaction open: decide (the town's own derivation), sign the
 *      owed lines onto the export, run the town's full verifier over it, and
 *      compute the rows the store will hold (every seal and signature);
 *   4. one short write transaction: re-read the chain's head, and if it is not
 *      the head step 3 decided against, put the export back and decide again
 *      (HEAD_TRIES times, then refuse by name); else insert the rows and land
 *      the commit, the store committing last.
 *
 * A LOST PUSH RACE RE-DECIDES, NEVER REBASES (POS-447; Darko, 2026-10-08: "a
 * lost race is a transaction retry that re-decides"). Each signed line's seal
 * chains to the line before it, so lines decided against one head are wrong on
 * any other. When the push finds the remote moved, the commit is unmade, the
 * store rolls back, the clone comes up to the remote's tip (the pen's
 * `{ rebase: false }`), and the pass starts again at step 1: the store reads
 * what the remote brought, and the decision is made from the new head. A
 * rebase never landed a ledger commit anyway: two appends to the file's end
 * conflict in git, and the throw that followed left the arrival bytes written
 * over the remote's lines (measured 10-08, test/stamp-mint-run.test.mjs).
 *
 * A refusal anywhere leaves the export as it arrived and the store as it was,
 * or, after a lost race, the export as the remote holds it. Returns the
 * summary, or throws. `verify` is the town's verifyStampLedger by default (a
 * test seam: it is the step that takes seconds).
 */
export async function mintFromStore(clone, { keyPem, message = "mint: crossing pass", env = process.env, engine = null, verify = null } = {}) {
  const eng = engine ?? await engineOf(clone);
  const { officeRead, officeWrite } = await import("../../src/world2-pen.mjs");
  const ledger = join(clone, "WHITE_PAGES", "stamp-ledger.md");
  let arrived, arrivedAt;
  const arrive = () => {
    arrived = existsSync(ledger) ? readFileSync(ledger, "utf8") : null;
    arrivedAt = git(clone, "rev-parse", "HEAD");
  };
  // The arrival bytes go back only over the head they arrived on: a clone the
  // pen moved to the remote's tip holds the remote's lines, never older ones.
  const putBack = () => {
    if (arrived != null && existsSync(ledger) && readFileSync(ledger, "utf8") !== arrived && git(clone, "rev-parse", "HEAD") === arrivedAt) writeFileSync(ledger, arrived);
  };
  const verifyLedger = verify ?? (await import(pathToFileURL(join(clone, "tools", "stamp-verify.mjs")).href)).verifyStampLedger;
  arrive();
  let raced = 0;
  try {
    for (let attempt = 1; attempt <= HEAD_TRIES; attempt++) {
      await officeWrite((client) => syncStampLinesVia(client, clone, { engine: eng }), { env });
      const { inputs, entries } = await officeRead(async (client) =>
        ({ inputs: await mintInputsVia(client), entries: await stampLinesVia(client) }), { env });
      if (!inputs.rooms.size) throw new Error("town_rooms is empty: the store has no key base yet (apply 067 and run the town-index ingest)");
      if (!inputs.mailLines.length) throw new Error("town_mail_lines is empty: the store has no deliveries yet (apply 067 and run the town-index ingest)");
      if (!entries.length) throw new Error("stamp_lines is empty: record the chain first (stamp-lines.mjs --sync)");
      const d = owedFromStore(eng, { entries, ...inputs });
      if (d.problems.length) throw new Error(`the recorded ledger diverges from the derivation; nothing appended\n${d.problems[0]}`);
      if (!d.lines.length) return { appended: 0, raced, summary: `stamp-ledger: up to date — nothing to mint${racedNote(raced)}` };
      eng.appendSigned(clone, d.lines, keyPem);
      // ONLY A GREEN VERIFY COMMITS (the ferry's POS-295 rule): the town's
      // verifier over the export, every check it makes, before the commit.
      const v = await verifyLedger(clone);
      if (!v.ok) throw new Error(`stamp-verify is red over the appended ledger; nothing committed\n${v.problems[0]}`);
      const head = entries.at(-1);
      const fresh = stampRowsPast(clone, { ...head, seq: entries.length }, { engine: eng });
      if (fresh.length !== d.lines.length) throw new Error(`signed ${d.lines.length} line(s) and the export holds ${fresh.length} past the store; nothing committed`);
      let out;
      try {
        out = await officeWrite(async (client) => {
          await lockStampLinesVia(client);
          const now = await stampHeadVia(client);
          if (!now || now.seq !== entries.length || now.sig !== head.sig) return MOVED;
          await insertStampRowsVia(client, fresh);
          await client.query("SELECT set_config('idle_in_transaction_session_timeout', $1, true)", [String(landTxMs(env))]);
          // A lost push race throws LOST_RACE out of the transaction: the rows
          // roll back with the unmade commit, and the pass decides again.
          const commit = penCommit(clone, [ledger], message, { rebase: false });
          return {
            appended: d.lines.length, commit, raced,
            summary: `stamp-ledger: appended ${d.lines.length} line(s) — ${d.mints} mint(s), ${d.moved} transfer(s), ${d.voided} void(s) (${d.recorded} already recorded), decided from the store${racedNote(raced)}`,
          };
        }, { env });
      } catch (e) {
        if (e?.pen !== LOST_RACE) throw e;
        raced++;
        arrive();
        continue;
      }
      if (out !== MOVED) return out;
      putBack();
    }
    throw new Error(`the stamp chain's head moved under the mint ${HEAD_TRIES} times running (another writer is appending${raced ? `; ${raced} of them a lost push race` : ""}); nothing appended — the next pass decides again`);
  } catch (e) {
    // The export goes back to its arrival bytes: a pass that did not land leaves
    // nothing behind (penCommit has already unmade an unlanded commit).
    putBack();
    throw e;
  }
}

const git = (repo, ...args) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();

function arg(name, fallback = null) { const i = process.argv.indexOf(`--${name}`); return i === -1 ? fallback : process.argv[i + 1]; }

async function main() {
  if (!process.argv.includes("--append")) { console.error("say --append"); return 1; }
  const clone = resolve(arg("clone", process.env.TOWN_CLONE ?? process.cwd()));
  const keyPath = arg("key");
  if (!keyPath || !existsSync(keyPath)) { console.error("--append needs --key <ed25519-private-pem>"); return 1; }
  if (!existsSync(join(clone, "tools", "stamp-mint.mjs"))) { console.error(`no town clone with tools/stamp-mint.mjs at ${clone}`); return 1; }
  try {
    const out = await mintFromStore(clone, { keyPem: readFileSync(keyPath, "utf8"), message: arg("message", "mint: crossing pass") });
    console.log(out.summary);
    return 0;
  } catch (e) { console.error(`FATAL: ${e.message}`); return 1; }
}

// Entry guard: real paths, the junction lesson (town-index-ingest.mjs § entry guard).
const isMain = (() => {
  if (!process.argv[1]) return false;
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return pathToFileURL(process.argv[1]).href === import.meta.url; }
})();
if (isMain) process.exitCode = await main();
