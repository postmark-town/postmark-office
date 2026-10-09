#!/usr/bin/env node
// ashore-backfill.mjs — the store's record that a handle came ashore (071),
// filled once from the town index for every resident who landed before the
// record existed (POS-444, Darko's A: "with one backfill from the copy").
//
//   node world2/tools/ashore-backfill.mjs
//        [--dry-run]            the default: read, count, print the plan, write nothing
//        [--apply [--prod]]     INSERT the handles the table lacks, one transaction
//        [--json]               the receipt as one JSON line on stdout
//
//   env: WORLD2_PG_URL (the office's own connection — `office_api`, the pen 071
//        grants INSERT to), or PG* as `w2_pgenv` exports them, or --pg-url.
//
//   EXIT: 0 · 1 the machinery tripped (nothing partial lands: one transaction)
//         · 2 cannot run (no store, no 071, no town index).
//
// ── FROM THE COPY, AND ONLY THE COPY ─────────────────────────────────────────
//
// Every handle the store's town index holds as a resident (town_residents, by
// the door's own admission grammar) gets a row with road `backfill`. Its `sha`
// and `at` are the commit that first ADDED its WHITE_PAGES/<handle>/ADDRESS.md
// in the index's own history (town_repo_log). A resident whose add the history
// does not hold gets a row with both NULL, which 071 allows for this road
// alone: it came ashore before the record of when.
//
// A handle the table already holds is left alone (the roads write it, and the
// table is append-only). Nothing here updates or deletes. Re-running it writes
// only what is still missing, so it is also the repair for a road whose row
// did not land.
//
// ── WHAT IT REFUSES ─────────────────────────────────────────────────────────
//
//   · --apply on a database whose name says neither `lab` nor `scratch`
//     without --prod beside it (the box's store is named world2_dev and is
//     prod's: the prod apply is a person's hand, typed twice).

import pg from "pg";

import { isResidentHandle } from "../../src/residency.mjs";

const arg = (n, d = null) => { const i = process.argv.indexOf(`--${n}`); return i === -1 ? d : process.argv[i + 1]; };
const flag = (n) => process.argv.includes(`--${n}`);

const ADDRESS = /^WHITE_PAGES\/([^/]+)\/ADDRESS\.md$/;

/**
 * The plan from what the store holds: `residents` (handles in the index),
 * `adds` (rows of { path, sha, committed_at }, the first add of each address),
 * `existing` (handles already in ashore). Pure.
 */
export function ashorePlan({ residents, adds, existing }) {
  const firstAdd = new Map();
  for (const a of adds) {
    const m = ADDRESS.exec(a.path);
    if (m && !firstAdd.has(m[1])) firstAdd.set(m[1], a);
  }
  const have = new Set(existing);
  const handles = [...new Set(residents)].filter((h) => isResidentHandle(h)).sort();
  const rows = [];
  let already = 0;
  for (const handle of handles) {
    if (have.has(handle)) { already++; continue; }
    const add = firstAdd.get(handle);
    rows.push({ handle, sha: add?.sha ?? null, at: add?.committed_at ?? null });
  }
  return {
    rows,
    counts: { residents: handles.length, already_ashore: already, to_write: rows.length, without_add_commit: rows.filter((r) => !r.sha).length },
  };
}

/** Read the plan from a connected client, and write it when `apply`. Answers the receipt. */
export async function backfillAshore(client, { apply = false } = {}) {
  const residents = (await client.query("SELECT handle FROM town_residents")).rows.map((r) => r.handle);
  const adds = (await client.query(
    `SELECT path, sha, committed_at FROM town_repo_log
      WHERE op = 'A' AND path LIKE 'WHITE_PAGES/%/ADDRESS.md'
      ORDER BY committed_at COLLATE "C", sha COLLATE "C"`)).rows;
  const existing = (await client.query("SELECT handle FROM ashore")).rows.map((r) => r.handle);
  const plan = ashorePlan({ residents, adds, existing });
  let wrote = 0;
  if (apply && plan.rows.length) {
    await client.query("BEGIN");
    try {
      for (const r of plan.rows) {
        const { rowCount } = await client.query(
          "INSERT INTO ashore (handle, at, sha, road) VALUES ($1, $2, $3, 'backfill') ON CONFLICT (handle) DO NOTHING",
          [r.handle, r.at, r.sha]);
        wrote += rowCount;
      }
      await client.query("COMMIT");
    } catch (e) { await client.query("ROLLBACK").catch(() => {}); throw e; }
  }
  return { mode: apply ? "APPLY" : "dry-run", ...plan.counts, wrote, rows: plan.rows };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split(/[\\/]/).pop())) {
  const apply = flag("apply"), json = flag("json");
  const url = arg("pg-url") ?? (process.env.PGUSER ? null : process.env.WORLD2_PG_URL);
  if (!url && !process.env.PGDATABASE) {
    console.error("no --pg-url, no PG* environment, and no WORLD2_PG_URL (the office's own connection is the pen 071 grants)");
    process.exit(2);
  }
  const dbName = url ? decodeURIComponent(new URL(url).pathname.replace(/^\//, "")) : process.env.PGDATABASE;
  if (apply && !/lab|scratch/i.test(dbName) && !flag("prod")) {
    console.error(`--apply refuses database "${dbName}": its name says neither "lab" nor "scratch". Pass --prod as WELL if this is the ship.`);
    process.exit(2);
  }
  const client = url ? new pg.Client({ connectionString: url }) : new pg.Client();
  try { await client.connect(); }
  catch (e) { console.error(`cannot reach ${dbName}: ${String(e?.message ?? e)}`); process.exit(2); }
  try {
    const r = await backfillAshore(client, { apply });
    if (json) console.log(JSON.stringify({ ...r, rows: undefined }));
    else {
      console.log(`ashore-backfill (${r.mode}) on ${dbName}: ${r.residents} residents in the town index · ${r.already_ashore} already ashore · ${r.to_write} to write (${r.without_add_commit} with no add commit in the index's history)${apply ? ` · wrote ${r.wrote}` : ""}`);
      for (const row of r.rows.slice(0, 20)) console.log(`  ${row.handle}  ${row.sha ? row.sha.slice(0, 12) : "(no add commit)"}  ${row.at ?? ""}`);
      if (r.rows.length > 20) console.log(`  … and ${r.rows.length - 20} more`);
    }
  } catch (e) {
    if (e?.code === "42P01") { console.error(`a table is missing in ${dbName} (${String(e.message)}): apply world2/schema/033_town_index.sql and 071_ashore.sql first`); process.exit(2); }
    console.error(String(e?.stack ?? e)); process.exit(1);
  } finally { await client.end().catch(() => {}); }
}
