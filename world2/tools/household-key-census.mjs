#!/usr/bin/env node
// household-key-census.mjs — WHICH ROWS NAME A HOUSE BY ITS SLUG KEY (POS-457).
//
// READ ONLY, ALWAYS. One `BEGIN READ ONLY` transaction; nothing here writes, and
// there is no write mode to forget to leave off. `--dry` is required anyway, so
// the command line says what it does.
//
// THE RULING IT SERVES. Darko ruled A on POS-457 (2026-10-08): the store never
// respells (Ruling 4, 024's spelling set), so the old rows keep their spellings
// and are read through the deriver. What must be true from the law date on is
// that every NEW row names `hh:<slug>`, and that the two projections rebuilt
// from the town at each clearing are re-keyed by their one pen
// (`stamp-ingest.mjs § writeStamps`). This prints both, so a ship can be read
// before and after:
//
//   1. THE COLUMNS. Every household-bearing column: rows per prefix, how many
//      the deriver's spelling set maps to a house's live key, and the spellings
//      no house claims (listed, never guessed).
//   2. THE STRAGGLERS. Claims and acts written since `--since` that do not
//      carry `hh:`, by the writer that made them, and whether each resolves.
//      `--after <iso>` is the post-ship check: any straggler since then that is
//      not a named interim (`solo:the-town`, POS-142) exits 1.
//   3. THE PROJECTIONS. stamp_projection and escrow_projection at the town
//      head (and, for escrow, every town sha held): what the pen's re-key would
//      do, and the parity: the town's weights walked by the fold's own
//      `stakesFromRows` before and after the re-key, which must be equal.
//
// USAGE
//   node world2/tools/household-key-census.mjs --dry [--url <postgres url>] [--since <iso>] [--after <iso>] [--json]
//
// The url defaults to WORLD2_PG_URL. On the box, run it as a read role against
// the store; never against anything but a store you mean to read.

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { liveHouseOfVia } from "../../src/household-deriver.mjs";
import { keyEscrowRows } from "./escrow-ingest.mjs";
import { stakesFromRows } from "./fold-input.mjs";
import { TOWN_HOUSEHOLD_BY_NAME } from "./materialize.mjs";

/** The first window after the w40 ship (window 216 opened 2026-09-27 13:45:40 EDT): POS-157's law date. */
export const LAW_DATE = "2026-09-27T17:45:40Z";

/** Every column the 10-08 measurement found holding a house key. */
export const KEY_COLUMNS = [
  ["acts", "household"], ["claims", "household"], ["marks", "household"],
  ["escrow_projection", "household"], ["escrow_projection", "own_household"], ["stamp_projection", "household"],
  ["letter_opens", "household"], ["posts", "household"], ["responses", "household"],
  ["resident_notes", "household"], ["household_harnesses", "household"], ["earpiece_wakes", "household"],
];

/** Spellings a ruling keeps by name. */
export const INTERIM = new Set([TOWN_HOUSEHOLD_BY_NAME]);

const prefixOf = (s) => (s == null ? "(null)" : (String(s).match(/^([a-z]+):/)?.[1] ?? "(bare)"));

/** One column: rows per prefix, rows the set re-keys, the spellings no house claims. PURE over `counts`. */
export function columnCensus(counts, houseOf) {
  const out = { total: 0, by_prefix: {}, rekeyable: 0, unresolved: {} };
  for (const { k, n } of counts) {
    out.total += n;
    out.by_prefix[prefixOf(k)] = (out.by_prefix[prefixOf(k)] ?? 0) + n;
    if (k == null) continue;
    const to = houseOf(k);
    if (to !== k) out.rekeyable += n;
    else if (!String(k).startsWith("hh:")) out.unresolved[k] = n;
  }
  return out;
}

const CLAIM_WRITER = `CASE
  WHEN household = '${TOWN_HOUSEHOLD_BY_NAME}' THEN 'interim: the town (POS-142)'
  WHEN data ? '_ingested_from' THEN 'marks-ingest'
  WHEN data ? '_carried_by' THEN 'clearing carry'
  ELSE 'the door (claimTxFromJournal)' END`;

export async function census(q, { since = LAW_DATE, after = null } = {}) {
  const houseOf = await liveHouseOfVia(q);
  const columns = [];
  for (const [table, col] of KEY_COLUMNS) {
    const { rows } = await q.query(`SELECT ${col} AS k, count(*)::int AS n FROM ${table} GROUP BY 1`);
    columns.push({ table, col, ...columnCensus(rows, houseOf) });
  }

  const stragglers = async (from) => {
    const { rows: c } = await q.query(
      `SELECT ${CLAIM_WRITER} AS writer, household AS k, count(*)::int AS n FROM claims
        WHERE submitted_at >= $1 AND household !~ '^hh:' GROUP BY 1, 2`, [from]);
    const { rows: a } = await q.query(
      `SELECT CASE WHEN household = '${TOWN_HOUSEHOLD_BY_NAME}' THEN 'interim: the town (POS-142)'
                   ELSE 'the door (' || action || ')' END AS writer, household AS k, count(*)::int AS n
         FROM acts WHERE at >= $1 AND household IS NOT NULL AND household !~ '^hh:' GROUP BY 1, 2`, [from]);
    const fold = (rows) => {
      const by = {};
      for (const { writer, k, n } of rows) {
        const w = (by[writer] ??= { rows: 0, resolvable: 0, spellings: {} });
        w.rows += n;
        if (houseOf(k) !== k) w.resolvable += n;
        w.spellings[k] = (w.spellings[k] ?? 0) + n;
      }
      return by;
    };
    return { since: from, claims: fold(c), acts: fold(a) };
  };

  const projections = { stamp: null, escrow: [] };
  const { rows: [head] } = await q.query("SELECT sha FROM projection_heads WHERE repo = 'town'");
  if (head?.sha) {
    const { rows } = await q.query("SELECT household AS k, count(*)::int AS n FROM stamp_projection WHERE town_sha = $1 GROUP BY 1", [head.sha]);
    projections.stamp = { town_sha: head.sha, ...columnCensus(rows, houseOf) };
  }
  const { rows: shas } = await q.query("SELECT town_sha, max(ingested_at) AS at FROM escrow_projection GROUP BY 1 ORDER BY 2 DESC");
  for (const { town_sha } of shas) {
    const { rows } = await q.query(
      "SELECT mark, holder, household, own_household, n, weight_k FROM escrow_projection WHERE town_sha = $1", [town_sha]);
    const keyed = keyEscrowRows(rows, houseOf);
    const k = Number(rows[0]?.weight_k ?? 0);
    const before = stakesFromRows(rows, k), after = stakesFromRows(keyed.rows, k);
    projections.escrow.push({
      town_sha, head: town_sha === head?.sha, rows: rows.length,
      households_before: new Set(rows.map((r) => r.household)).size,
      households_after: new Set(keyed.rows.map((r) => r.household)).size,
      rekeyed: keyed.rekeyed, kept_town_spellings: keyed.merged,
      weights_equal: JSON.stringify(before) === JSON.stringify(after),
    });
  }

  const out = { law_date: since, columns, stragglers: await stragglers(since), projections };
  if (after) {
    out.after = await stragglers(after);
    const bad = [...Object.entries(out.after.claims), ...Object.entries(out.after.acts)]
      .filter(([w]) => !w.startsWith("interim:"));
    out.after_ok = bad.length === 0;
  }
  return out;
}

export function render(r) {
  const L = [];
  L.push(`household-key-census · read only · law date ${r.law_date}`);
  L.push("", "1 · THE COLUMNS (rows · by prefix · the set re-keys · no house claims)");
  for (const c of r.columns) {
    const un = Object.entries(c.unresolved).sort((a, b) => b[1] - a[1]);
    L.push(`  ${`${c.table}.${c.col}`.padEnd(32)} ${String(c.total).padStart(6)}  ${JSON.stringify(c.by_prefix)}  re-keys ${c.rekeyable}  unresolved ${un.reduce((s, [, n]) => s + n, 0)}`);
    if (un.length) L.push(`      unresolved: ${un.slice(0, 8).map(([k, n]) => `${k} ×${n}`).join(", ")}${un.length > 8 ? ` … ${un.length} spellings` : ""}`);
  }
  const strag = (s, title) => {
    L.push("", `${title} since ${s.since} (rows not under hh:, by writer)`);
    for (const [t, by] of [["claims", s.claims], ["acts", s.acts]]) {
      const e = Object.entries(by);
      if (!e.length) { L.push(`  ${t}: none`); continue; }
      for (const [w, v] of e.sort((a, b) => b[1].rows - a[1].rows))
        L.push(`  ${t} · ${w}: ${v.rows} (${v.resolvable} resolve to a house) e.g. ${Object.keys(v.spellings).slice(0, 3).join(", ")}`);
    }
  };
  strag(r.stragglers, "2 · THE STRAGGLERS");
  L.push("", "3 · THE PROJECTIONS");
  if (r.projections.stamp) {
    const s = r.projections.stamp;
    L.push(`  stamp_projection @ ${s.town_sha.slice(0, 9)} (head): ${s.total} rows ${JSON.stringify(s.by_prefix)}; the pen re-keys ${s.rekeyable}; unresolved ${Object.entries(s.unresolved).map(([k, n]) => `${k} ×${n}`).join(", ") || "none"}`);
  }
  const esc = r.projections.escrow;
  const held = esc.filter((e) => e.weights_equal && !e.kept_town_spellings).length;
  L.push(`  escrow_projection: ${esc.length} town shas; re-keyed with equal weights at ${held}, town spellings kept at ${esc.length - held}`);
  for (const e of esc.filter((x) => x.head || x.kept_town_spellings || !x.weights_equal))
    L.push(`    ${e.town_sha.slice(0, 9)}${e.head ? " (head)" : ""}: ${e.rows} rows, households ${e.households_before} → ${e.households_after}, re-keys ${e.rekeyed}, weights ${e.weights_equal ? "EQUAL" : "DIFFER"}${e.kept_town_spellings ? `, kept (would move ${e.kept_town_spellings.join(", ")})` : ""}`);
  if (r.after) {
    strag(r.after, "4 · AFTER THE SHIP");
    L.push(`  ${r.after_ok ? "OK: every row since then names a house by its slug key, or a ruled interim" : "RED: a writer still files rows under an old spelling"}`);
  }
  return L.join("\n");
}

const argOf = (name) => { const i = process.argv.indexOf(name); return i !== -1 ? process.argv[i + 1] : null; };

async function main() {
  if (!process.argv.includes("--dry")) {
    console.error("usage: household-key-census.mjs --dry [--url <postgres url>] [--since <iso>] [--after <iso>] [--json]");
    console.error("  read only: one READ ONLY transaction; --dry says so on the command line");
    process.exit(2);
  }
  const url = argOf("--url") ?? process.env.WORLD2_PG_URL;
  if (!url) { console.error("household-key-census: no --url and no WORLD2_PG_URL — which store?"); process.exit(2); }
  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  let r;
  try {
    await client.query("BEGIN READ ONLY");
    r = await census(client, { since: argOf("--since") ?? LAW_DATE, after: argOf("--after") });
    await client.query("ROLLBACK");
  } finally { await client.end(); }
  console.log(process.argv.includes("--json") ? JSON.stringify(r, null, 2) : render(r));
  if (r.after && !r.after_ok) process.exit(1);
}

// THE REALPATH IDIOM (test/cli-guard.test.mjs): true through a junction too.
const isMain = (() => { try { return realpathSync(process.argv[1] ?? "") === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } })();
if (isMain) main().catch((e) => { console.error(String(e?.stack ?? e)); process.exit(1); });
