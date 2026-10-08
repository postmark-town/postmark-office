#!/usr/bin/env node
// escrow-ingest.mjs — THE TOWN'S OPEN STAKE POSITIONS, derived from a town checkout.
//
// THE LAW THIS IMPLEMENTS (Keemin's ruling, 2026-09-08, in the G1 cutover
// sitting): "the store is the escrow oracle from G1 on." Until this file the
// store could not be, and this tree said so in three places rather than leaving
// it to be found — see `014_escrow_projection.sql` for the three quotes and for
// why the POSITION is stored and the WEIGHT is not.
//
// ── THIS FILE IS NOT A PEN ───────────────────────────────────────────────────
//
// It derives; `stamp-ingest.mjs` writes. Three projections come from ONE repo at
// ONE sha and share ONE row in `projection_heads`, so a second tool moving that
// head would be the two-pens class the schema exists to make unrepresentable.
// This is roll-ingest.mjs's own rule, applied unchanged to a third projection:
// `writeEscrow` takes the CALLER's client mid-transaction, opens no transaction
// of its own, and touches `projection_heads` never. The CLI here is `--dry-run`
// only, and says so.
//
// ── REUSE, NOT RE-IMPLEMENTATION ─────────────────────────────────────────────
//
// The money lines have exactly one parser across the two repos and it is the
// TOWN's. The world repo states the rule about itself (marks-fold.mjs § load
// stakes: "No money parser lives here, on purpose … The town OWNS the ledger
// grammar"); stamp-ingest.mjs obeys it from the office's side; so does this.
// Imported live out of the checkout, never restated:
//
//   worldStakeState    tools/world-stake.mjs   the ledger fold — `positions` is
//                                              the open (mark|holder) escrow map
//                                              and `currentHouseholdOf` is the
//                                              town's dated registry resolver
//   worldWeightDial    tools/world-stake.mjs   ECONOMY-DIALS.json
//                                              read_side.weight.k_unique_household_bonus,
//                                              with the town's own refusal on a
//                                              malformed dial
//
// THE HOUSEHOLD IS RESOLVED HERE AND NOT AT READ TIME, deliberately, because it
// is the unit k counts and the resolver is dated: `currentHouseholdOf` folds the
// ledger's `registry:` revisions to now. "Now" is a property of the CHECKOUT, so
// resolving at read time against a later roll would answer a question about
// today with a sha from last week — the same shape as the frame note in
// seed-import.mjs ("a frame is a property of the tree, and the tree does not
// come with us").
//
// ── USAGE ───────────────────────────────────────────────────────────────────
//
//   node world2/tools/escrow-ingest.mjs --town-repo /tmp/town-at-sha [--json]
//
// Derivation only. The write is `stamp-ingest.mjs`'s, in its one transaction.

import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { stakesFromRows } from "./fold-input.mjs";

const toolUrl = (repo, file) => pathToFileURL(join(resolve(repo), "tools", file)).href;

const CHUNK = 500;

/**
 * Derive every `escrow_projection` row for one town checkout.
 *
 * PURE with respect to the checkout and the database. Both the ingester and the
 * equality falsifier call THIS — one derivation, so a green means the database
 * agrees with the town, never that two folds agree with each other.
 *
 * WHO GETS A ROW: exactly the open positions the town's fold holds. A position
 * of zero is not a row — `foldWorldMarkPositions` closes a position when an
 * unstake draws it down, and a closed position is an absence, not a zero. That
 * is the opposite of `deriveStamps`'s rule for balances and the difference is
 * real: a resident with no stamps still has a balance to report, while a mark
 * nobody stakes has no position to report.
 *
 * Rows come back sorted by (mark, holder) so any two runs produce the same order
 * and the falsifier can diff positionally.
 */
export async function deriveEscrow({ townRepo }) {
  const repo = resolve(townRepo);
  const dialPath = join(repo, "ECONOMY-DIALS.json");
  const ledgerPath = join(repo, "WHITE_PAGES", "stamp-ledger.md");
  if (!existsSync(ledgerPath)) {
    throw new Error(`no WHITE_PAGES/stamp-ledger.md under ${repo} — is this a town checkout?`);
  }
  if (!existsSync(dialPath)) {
    // The town's own dial reader falls back to the ruled default on an absent
    // file. That is right for a READ and wrong for an INGEST: a projection that
    // silently records a defaulted dial as the dial in force is a number with no
    // source, and `weight_k` is stored precisely so the row can name its own
    // arithmetic. Refuse and say which file.
    throw new Error(`no ECONOMY-DIALS.json under ${repo} — the weight dial has no source at this sha, and a projection may not record a defaulted dial as a pinned one`);
  }

  const stake = await import(toolUrl(repo, "world-stake.mjs"));
  const dial = stake.worldWeightDial(repo);
  const state = stake.worldStakeState(repo);

  const rows = [];
  for (const [key, n] of state.positions.entries()) {
    const i = key.lastIndexOf("|");
    const mark = key.slice(0, i);
    const holder = key.slice(i + 1);
    if (!(Number(n) > 0)) continue;   // a closed position is an absence, not a zero
    rows.push({
      mark,
      holder,
      household: state.currentHouseholdOf(holder),
      // `deriveWorldMarkWeights`'s own `ownHouseholdOf`, verbatim: "A mark id is
      // `<by>/<slug>`, so the mark's own household is derivable from the id
      // alone — no lookup into the marks tree, and this stays a pure ledger
      // fold." Same function, same fold, so the store's k and the town's k can
      // never disagree about who is external.
      own_household: state.currentHouseholdOf(mark.slice(0, mark.indexOf("/"))),
      n: Number(n),
      weight_k: dial.k,
    });
  }
  rows.sort((a, b) => (a.mark === b.mark ? a.holder.localeCompare(b.holder) : a.mark.localeCompare(b.mark)));
  return { rows, k: dial.k, dial_source: dial.source, positions: state.positions.size, marks: new Set(rows.map((r) => r.mark)).size };
}

/**
 * THE TOWN'S SPELLINGS, RE-KEYED TO THE HOUSE (POS-457). PURE.
 *
 * `deriveEscrow` names each position's household the way the town's dated
 * resolver spells it (`gh:<id>` for most of the town), and the store writes
 * `hh:<slug>` from the law date. `houseOf` is the deriver's inverted spelling
 * set (`household-deriver.mjs § liveHouseOf`): every spelling a house has worn
 * maps to its live key, and a spelling no house claims maps to itself, so
 * nothing is guessed.
 *
 * THE WEIGHTS ARE THE TOWN'S, AND THEY ARE HELD TO IT. k is drawn by a
 * household's first external position on a mark, so a re-key that merged two
 * of the town's households would change the arithmetic, which is not this
 * projection's to change. The re-keyed rows are walked by the fold's own
 * `stakesFromRows` beside the town's, and if any weight differs the town's
 * spellings are kept for the whole sha and `merged` names why. Measured on the
 * 10-08 dump: 53 households stay 53 and 0 weights move.
 */
export function keyEscrowRows(rows, houseOf) {
  if (!rows.length) return { rows, rekeyed: 0, merged: null };
  const keyed = rows.map((r) => ({ ...r, household: houseOf(r.household), own_household: houseOf(r.own_household) }));
  const k = Number(rows[0].weight_k);
  const before = stakesFromRows(rows, k), after = stakesFromRows(keyed, k);
  const moved = before.filter((s, i) => s.weight !== after[i]?.weight || s.holder !== after[i]?.holder || s.mark !== after[i]?.mark);
  if (moved.length) {
    return { rows, rekeyed: 0, merged: moved.slice(0, 5).map((s) => `${s.mark}|${s.holder}`) };
  }
  const rekeyed = keyed.filter((r, i) => r.household !== rows[i].household || r.own_household !== rows[i].own_household).length;
  return { rows: keyed, rekeyed, merged: null };
}

/**
 * The escrow half of the town's one transaction. Caller's client, caller's
 * transaction, no head move — roll-ingest.mjs's contract, unchanged.
 */
export async function writeEscrow(client, { townSha, rows }) {
  await client.query("DELETE FROM escrow_projection WHERE town_sha = $1", [townSha]);
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const values = [];
    const params = [];
    slice.forEach((r, n) => {
      const b = n * 6;
      values.push(`($${slice.length * 6 + 1}, $${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6})`);
      params.push(r.mark, r.holder, r.household, r.own_household, r.n, r.weight_k);
    });
    params.push(townSha);
    await client.query(
      `INSERT INTO escrow_projection (town_sha, mark, holder, household, own_household, n, weight_k) VALUES ${values.join(", ")}`, params);
  }
}

// ── CLI — derivation only ────────────────────────────────────────────────────

const argOf = (name) => { const i = process.argv.indexOf(name); return i !== -1 ? process.argv[i + 1] : null; };

async function main() {
  const townRepo = argOf("--town-repo");
  if (!townRepo) {
    console.error("usage: escrow-ingest.mjs --town-repo <checkout> [--json]");
    console.error("  derivation only — the write is stamp-ingest.mjs's, in its one town transaction");
    process.exit(2);
  }
  const { rows, k, dial_source, positions, marks } = await deriveEscrow({ townRepo });
  const summary = { rows: rows.length, marks, open_positions: positions, k, dial_source };
  console.log(process.argv.includes("--json") ? JSON.stringify(summary, null, 2)
    : `dry-run · ${rows.length} open positions over ${marks} marks · k=${k} from ${dial_source}`);
}

// THE BASENAME IDIOM, not the href comparison — the conductor's 2026-09-08 class
// note, and this room already carries the receipt for the other half of it: a
// junction in the path makes `pathToFileURL(argv[1]).href === import.meta.url`
// FALSE, so the tool runs nothing and exits 0, which is indistinguishable from
// success at the call site (33 fixture reds hid behind exactly that guard on
// 2026-09-05). This file is IMPORTED by `stamp-ingest.mjs`, so the tail must
// also stay inert on import — `test/world2-tool-imports.test.mjs` proves that by
// importing it rather than by reading this line.
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split(/[\\/]/).pop())) {
  main().catch((e) => { console.error(String(e?.stack ?? e)); process.exit(1); });
}
