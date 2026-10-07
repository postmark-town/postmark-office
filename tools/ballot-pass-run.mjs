#!/usr/bin/env node
// ballot-pass-run.mjs — the crossing's ballot sweep, judged from the office's
// record (POS-349). It replaces the town's tools/ballot-pass.mjs in the ferry
// unit (deploy/postmark-ferry.service); the town's pass stays in its repo,
// unused, until a town lane retires it.
//
//   node tools/ballot-pass-run.mjs --key FILE [--town PATH] [--date YYYY-MM-DD]
//
//   --town defaults to the working directory (the ferry runs it from inside
//   the town clone). env: the office's store (WORLD2_PG / WORLD2_PG_URL, the
//   pen's own), TOWN_PUSH=1 and BOT_NAME/BOT_EMAIL for the pen, TOWN_TZ.
//
// ── WHAT IT KEEPS FROM THE TOWN'S PASS, BYTE FOR BYTE ───────────────────────
//
// It reads the same letters (WHITE_PAGES/postmaster/inbox/, strict
// frontmatter: stake_topic / stake_candidate / stake_stamps), writes the same
// stake and first-stake mint lines (the town's own builders, through
// src/ballots-store.mjs § stakeInStore) and the same receipt letters (the
// town's words and file names, below), and never processes a letter twice.
//
// ── WHAT CHANGED ────────────────────────────────────────────────────────────
//
//   · The clip is judged from the store: the ballot post and its votes (the
//     town engine's law, the ledger as its input). Each landed stake is a
//     vote act and the resident's response, written in the same transaction.
//   · Each ballot is landed by the pen on its own, ledger line and receipt in
//     one commit, after the town's own verifier passes it, and the store
//     commits after the push (Wright's S2). The ferry's commit step after this
//     pass then finds nothing of the pass's left to commit.
//   · A letter is also skipped when the store holds a vote carrying its
//     `mail:<letter-id>`.
//   · A stake the store cannot judge right now (the record unreachable, the
//     file and the post disagreeing, the votes and the ledger disagreeing) is
//     HELD: no receipt, nothing written, and the next crossing reads it again.
//     A held letter is printed by name; the exit stays 0, as the town's pass
//     kept it for a malformed ballot, so mail and the mint are never held
//     hostage by one ballot.
//
// Exit 0 unless the machinery itself trips.

import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

import { penTransaction } from "../src/write.mjs";
import { landStamped, landStampedVia } from "../src/stamp-lines.mjs";
import { stakeInStore, ballotsWithVotes } from "../src/ballots-store.mjs";
import { stakesOf } from "../src/ballots.mjs";

const OFFICE = "postmaster";

// ── the town's own parsing and receipts (tools/ballot-pass.mjs), unchanged ───

function parseFrontmatter(text) {
  const t = text.replace(/^﻿/, "").replace(/\r\n/g, "\n");
  if (!t.startsWith("---\n")) return null;
  const end = t.indexOf("\n---", 4);
  if (end === -1) return null;
  const fields = {};
  for (const line of t.slice(4, end).split("\n")) {
    const m = /^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/.exec(line);
    if (m) fields[m[1]] = m[2].trim();
  }
  return fields;
}

function receiptedIds(repo) {
  const ids = new Set();
  const scan = (dir) => {
    if (!existsSync(dir)) return;
    for (const f of readdirSync(dir)) {
      if (!f.endsWith(".md")) continue;
      const fm = parseFrontmatter(readFileSync(join(dir, f), "utf8"));
      if (fm?.receipt_for) ids.add(fm.receipt_for);
    }
  };
  scan(join(repo, "WHITE_PAGES", OFFICE, "outbox"));
  return { ids, hasDelivered: (voter, letterId) => {
    const dir = join(repo, "WHITE_PAGES", voter, "inbox");
    if (!existsSync(dir)) return false;
    for (const f of readdirSync(dir)) {
      if (!f.endsWith(".md") || !f.includes("receipt")) continue;
      const fm = parseFrontmatter(readFileSync(join(dir, f), "utf8"));
      if (fm?.receipt_for === letterId) return true;
    }
    return false;
  } };
}

function writeReceipt(repo, { voter, ballotId, date, lines }) {
  const outbox = join(repo, "WHITE_PAGES", OFFICE, "outbox");
  if (!existsSync(outbox)) mkdirSync(outbox, { recursive: true });
  const slug = `ballot-receipt-${ballotId.slice(0, 48).replace(/[^a-z0-9-]/g, "")}`;
  const file = join(outbox, `letter-${date}-to-${voter}-${slug}.md`);
  if (existsSync(file)) return null; // already receipted this crossing
  const id = `${OFFICE}-${date}-to-${voter}-${slug}`;
  const fm = `---\nid: ${id}\nfrom: ${OFFICE}\nto: ${voter}\ndate: ${date}\nthread: ${ballotId}\nreceipt_for: ${ballotId}\n---\n\n`;
  writeFileSync(file, fm + lines.join("\n") + "\n");
  return file;
}

const landedLines = (fm, r) => [
  `Your ballot landed. **${r.applied} of ${r.requested}** stamp(s) staked on **${fm.stake_candidate}** (${fm.stake_topic}).`,
  r.clipped ? `The rest were clipped — your household's headroom on this candidate was ${r.household_headroom_before}; the unapplied stamps never left your balance.` : "Nothing was clipped.",
  r.vote_minted ? "Casting your first stake on this topic minted you +1 stamp (rule 4)." : "",
  `Household headroom left on this candidate: ${r.household_headroom_after}. Your balance: ${r.balance_after}.`,
].filter(Boolean);
const zeroLines = (r) => [
  `Your ballot was read but **no stamps could apply**: ${r.reason}.`,
  "Nothing left your balance. You can stake a different candidate, or rest easy — a read ballot is a counted voice even at zero.",
];
const refusedLines = (e) => [
  `Your ballot could not be applied: **${e.defect ?? e.message}**.`,
  e.hint ? `Hint: ${e.hint}.` : "",
  "Fix and send again — the ferry carries corrections at every crossing (sender-fixes-own, standing policy).",
].filter(Boolean);

// ── the pass ────────────────────────────────────────────────────────────────

/** The town's verifier over the working tree, as the ferry runs it. */
function townVerifies(repo) {
  const r = spawnSync(process.execPath, [join(repo, "tools", "stamp-verify.mjs")], { cwd: repo, encoding: "utf8" });
  return { ok: r.status === 0, out: `${r.stdout ?? ""}${r.stderr ?? ""}`.trim().split("\n").slice(-3).join(" | ") };
}

/** The letters the store already holds a vote for, by `mail:<id>`. */
async function storeMailIds(env) {
  const ids = new Set();
  for (const { votes } of await ballotsWithVotes({ env }))
    for (const s of stakesOf(votes)) if (String(s.via ?? "").startsWith("mail:")) ids.add(s.via.slice(5));
  return ids;
}

export async function ballotPassRun(repo, keyPem, date, { env = process.env, verify = townVerifies } = {}) {
  const inbox = join(repo, "WHITE_PAGES", OFFICE, "inbox");
  const out = { processed: 0, receipts: 0, held: [] };
  if (!existsSync(inbox)) return out;

  const { parseStampLedger, classifyEntry } = await import(pathToFileURL(join(repo, "tools", "stamp-mint.mjs")).href);
  const ledgerPath = join(repo, "WHITE_PAGES", "stamp-ledger.md");
  const staked = new Set();
  if (existsSync(ledgerPath)) {
    for (const e of parseStampLedger(readFileSync(ledgerPath, "utf8"))) {
      const c = classifyEntry(e.canonical);
      if (c.kind === "stake" && c.via.startsWith("mail:")) staked.add(c.via.slice(5));
    }
  }
  const inStore = await storeMailIds(env);
  const receipts = receiptedIds(repo);

  for (const f of readdirSync(inbox).sort()) {
    if (!f.endsWith(".md")) continue;
    const fm = parseFrontmatter(readFileSync(join(inbox, f), "utf8"));
    if (!fm || !fm.stake_topic) continue; // not a ballot letter
    const ballotId = fm.id ?? f.replace(/\.md$/, "");
    const voter = fm.from;
    if (!voter) continue;
    if (staked.has(ballotId) || inStore.has(ballotId) || receipts.ids.has(ballotId) || receipts.hasDelivered(voter, ballotId)) continue;

    out.processed++;
    let receiptFile = null;
    // A landed stake lands on its own store transaction (`client`), so its
    // vote and its stamp_lines rows (POS-341, STAMP_LINES=store) go together;
    // a receipt alone lands outside one.
    const land = async (lines, client = null) => {
      receiptFile = writeReceipt(repo, { voter, ballotId, date, lines });
      const v = verify(repo);
      if (!v.ok) return { error: { code: 409, defect: "the town's verifier refused this ballot's line", hint: v.out, held: true } };
      const paths = [ledgerPath, ...(receiptFile ? [receiptFile] : [])];
      const message = `ballot: crossing pass (${ballotId})`;
      const commit = client ? await landStampedVia(client, repo, paths, message, { env }) : await landStamped(repo, paths, message, { env });
      return commit?.error ? commit : { commit };
    };
    const r = await penTransaction(repo, async () => {
      try {
        const res = await stakeInStore({ clone: repo, keyPem, env,
          payload: { handle: voter, topic: fm.stake_topic, candidate: fm.stake_candidate, n: fm.stake_stamps, via: `mail:${ballotId}`, date },
          land: (res, client) => land(landedLines(fm, res), client) });
        if (res.applied > 0) return { landed: res };
        const done = await land(zeroLines(res));
        return done?.error ? { error: done.error } : { landed: res };
      } catch (e) {
        if (!e?.code) throw e;
        if (e.held || e.code >= 500) return { error: { code: e.code, defect: e.defect, hint: e.hint, held: true } };
        const done = await land(refusedLines(e));
        return done?.error ? { error: done.error } : { refused: e.defect };
      }
    });
    if (r.error) { out.held.push({ letter: ballotId, defect: r.error.defect, hint: r.error.hint }); continue; }
    if (receiptFile) out.receipts++;
  }
  return out;
}

async function main() {
  const argv = process.argv.slice(2);
  const arg = (name) => { const i = argv.indexOf(name); return i !== -1 ? argv[i + 1] : null; };
  const repo = resolve(arg("--town") ?? process.cwd());
  const keyPath = arg("--key");
  if (!keyPath || !existsSync(keyPath)) { console.error("usage: ballot-pass-run.mjs --key FILE [--town PATH] [--date YYYY-MM-DD]"); process.exit(1); }
  const date = arg("--date") ?? new Intl.DateTimeFormat("en-CA", { timeZone: process.env.TOWN_TZ ?? "America/New_York" }).format(new Date());
  try {
    const r = await ballotPassRun(repo, readFileSync(keyPath, "utf8"), date);
    console.log(`ballot-pass: ${r.processed} ballot(s) processed, ${r.receipts} receipt(s) written`);
    for (const h of r.held) console.error(`[ballot-pass] HELD ${h.letter}: ${h.defect}${h.hint ? ` (${h.hint})` : ""} — nothing written; the next crossing reads it again`);
  } catch (e) { console.error(`ballot-pass tripped: ${e.message}`); process.exit(1); }
  process.exit(0);
}

// Script only when run as one (the realpath compare: deploy/welcome-pass.mjs § entry guard).
const isMain = (() => {
  if (!process.argv[1]) return false;
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return pathToFileURL(process.argv[1]).href === import.meta.url; }
})();
if (isMain) main();
