#!/usr/bin/env node
// paperwork-import.mjs — copy oauth.db and roles.db, whole, into the store's
// 031 and 032 tables, and prove every row arrived unchanged (POS-271).
//
//   node world2/tools/paperwork-import.mjs --pg-url <url> --oauth-db <file> --roles-db <file>
//        [--check]     compare only; write nothing
//        [--repair]    insert into the FILES the rows only the store holds, then
//                      check again (the clean week's repair, below)
//        [--replace]   empty the eleven tables first, in the same transaction
//        [--json]      the receipt as JSON on stdout
//
//   --pg-url is REQUIRED and nothing else is read for it: not WORLD2_PG_URL,
//   not PG*. On the box both of those name prod, and a copy tool that
//   defaulted to them could write prod by accident. Connect as world2_owner:
//   this is a migration step, and office_api cannot TRUNCATE.
//
//   EXIT: 0 every row equal · 1 DRIFT (nothing was committed) · 2 cannot run.
//
// ── --repair: THE STORE IS THE RECORD (POS-271, Darko 2026-10-09) ───────────
//
// While the office is switched, the mirror writes every store write to the
// files after the store. When a mirror write fails (10-05 "database is
// locked"; 10-09 "database or disk is full"), the file lacks that row. Darko
// ruled: repair, and keep the date. Prod's --check (Wright, 2026-10-09) named
// only rows "in the store, not in the file" (two tokens, one town-log row), so
// --repair does exactly that and nothing else: it INSERTS into the files the
// rows only the store holds. It never deletes and never overwrites. A row that
// differs in content, or one only the file holds, is not a missing write, so it
// REFUSES (exit 2) before writing anything, and --check's findings are the thing
// to read. The store is only read. Then it checks again; the exit is that second
// check's. Only when it reads equal are the files deleted (deploy/DEPLOY.md §
// The paperwork files leave the box).
//
// ── WHY A SIGNED-IN AGENT STAYS SIGNED IN ───────────────────────────────────
//
// A session is a row in `tokens`, looked up by the sha256 of the bearer token
// the agent already holds (oauth.mjs § oauthLookup / keyLookup / berthLookup).
// The token is never stored and never re-issued. If the row arrives with the
// same hash, kind, gh id and expiry, the same token resolves to the same
// household. So the proof is equality, row by row and column by column, and
// the copy commits only if it holds. Nothing here mints, rotates or expires.
//
// ── THE ORDER ON A BOX (copy, check, then switch) ───────────────────────────
//
//   1. apply 031 and 032 (tables empty)
//   2. stop the writer, so nothing mints or rotates mid-copy
//   3. this tool, then `--check`: 0 or stop
//   4. start the office on the build that reads the store
//
// The files are opened read-only here and never changed by this tool. The
// switch (OFFICE_PAPERWORK_STORE=1, src/paperwork.mjs) keeps writing them after
// the store, as a mirror, so the rollback is the flag off: the files hold what
// the store holds, sessions minted after the switch included.
//
// Copying without stopping the writer is refused in effect, not by a check: a
// second run over tables that already hold rows would bring back rotated keys
// or drop fresh ones, so without --replace a non-empty table is a refusal.
//
// THE WHOLE FILE MOVES. oauth.db also holds the media quota ledger (`media`)
// and the town log (`town_journal` + `meta`); 032 gives them their tables.
// Those three are created lazily in the file (the first upload, the first
// town-log row), so a file without one of them copies it as zero rows and says
// so ("absent in the file"), where a missing sign-in table is a refusal.

import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";

// sqlite table → store table, and the primary key the rows are matched by.
export const TABLES = Object.freeze([
  { db: "oauth", from: "clients",    to: "oauth_clients",     key: ["client_id"] },
  { db: "oauth", from: "pending",    to: "oauth_pending",     key: ["id"] },
  { db: "oauth", from: "codes",      to: "oauth_codes",       key: ["code"] },
  { db: "oauth", from: "tokens",     to: "oauth_tokens",      key: ["token_hash"] },
  { db: "oauth", from: "berths",     to: "oauth_berths",      key: ["slug"] },
  { db: "oauth", from: "key_claims", to: "oauth_key_claims",  key: ["ask_hash"] },
  { db: "roles", from: "roles",      to: "office_roles",      key: ["subject", "role"] },
  { db: "roles", from: "role_audit", to: "office_role_audit", key: ["id"] },
  { db: "oauth", from: "media",        to: "office_media",        key: ["household", "sha"], lazy: true },
  { db: "oauth", from: "town_journal", to: "office_town_journal", key: ["seq"], lazy: true },
  { db: "oauth", from: "meta",         to: "office_meta",         key: ["key"], lazy: true },
]);

// Identity columns whose file values are kept, then the sequence moved past them.
const IDENTITY = Object.freeze({ office_role_audit: "id", office_town_journal: "seq" });

// One spelling for a value on both sides. node:sqlite gives integers as
// numbers and node-postgres gives int8 as strings, so both become strings;
// null stays null. Text is compared as it is, byte for byte.
const norm = (v) => (v == null ? null : String(v));
const keyOf = (row, key) => JSON.stringify(key.map((k) => norm(row[k])));

/**
 * THE EQUALITY for one table. `columns` are the sqlite table's own columns, so
 * a column the store lacks is a finding, never a silent drop.
 * Returns `{ table, sqlite, store, missing, extra, differ: [sentences] }`.
 */
export function compareTable({ to, key }, columns, sqliteRows, storeRows) {
  const have = new Map(storeRows.map((r) => [keyOf(r, key), r]));
  const want = new Map(sqliteRows.map((r) => [keyOf(r, key), r]));
  const differ = [];
  let missing = 0, extra = 0;
  for (const [k, w] of want) {
    const h = have.get(k);
    if (!h) { missing += 1; differ.push(`${to} ${k}: in the file, not in the store`); continue; }
    for (const c of columns) {
      if (!(c in h)) { differ.push(`${to}.${c}: the store has no such column`); continue; }
      if (norm(h[c]) !== norm(w[c])) differ.push(`${to} ${k}.${c}: file ${JSON.stringify(norm(w[c]))}, store ${JSON.stringify(norm(h[c]))}`);
    }
  }
  for (const k of have.keys()) if (!want.has(k)) { extra += 1; differ.push(`${to} ${k}: in the store, not in the file`); }
  return { table: to, sqlite: sqliteRows.length, store: storeRows.length, missing, extra, differ };
}

const columnsOf = (sdb, table) => sdb.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);

/**
 * Copy (unless `check`) and compare, inside ONE transaction that commits only
 * when every table is equal. `client` is a connected node-postgres client.
 */
export async function importPaperwork(client, files, { check = false, replace = false } = {}) {
  const sdbs = { oauth: new DatabaseSync(files.oauth, { readOnly: true }), roles: new DatabaseSync(files.roles, { readOnly: true }) };
  const results = [];
  let committed = false;
  await client.query("BEGIN");
  try {
    if (!check) {
      const counts = await Promise.all(TABLES.map(async (t) =>
        [t.to, Number((await client.query(`SELECT count(*) AS n FROM ${t.to}`)).rows[0].n)]));
      const occupied = counts.filter(([, n]) => n > 0);
      if (occupied.length && !replace)
        throw Object.assign(new Error(`the store already holds rows (${occupied.map(([t, n]) => `${t} ${n}`).join(", ")}); a second copy would bring back rotated keys or drop fresh ones. Stop the writer and pass --replace, or run --check`), { exit: 2 });
      if (replace) await client.query(`TRUNCATE ${TABLES.map((t) => t.to).join(", ")}`);
    }
    for (const t of TABLES) {
      const sdb = sdbs[t.db];
      const columns = columnsOf(sdb, t.from);
      if (!columns.length && !t.lazy) throw Object.assign(new Error(`${files[t.db]} has no table ${t.from}`), { exit: 2 });
      const rows = columns.length ? sdb.prepare(`SELECT * FROM ${t.from}`).all() : [];
      if (!check) {
        const list = columns.join(", ");
        const marks = columns.map((_, i) => `$${i + 1}`).join(", ");
        const override = IDENTITY[t.to] ? " OVERRIDING SYSTEM VALUE" : "";
        for (const r of rows)
          await client.query(`INSERT INTO ${t.to} (${list})${override} VALUES (${marks})`, columns.map((c) => r[c] ?? null));
      }
      const stored = (await client.query(`SELECT * FROM ${t.to}`)).rows;
      results.push({ ...compareTable(t, columns, rows, stored), ...(columns.length ? {} : { absent: true }) });
    }
    if (!check)
      for (const [table, col] of Object.entries(IDENTITY))
        await client.query(`SELECT setval('${table}_${col}_seq', GREATEST((SELECT COALESCE(max(${col}), 0) FROM ${table}), 1), (SELECT count(*) > 0 FROM ${table}))`);
    const equal = results.every((r) => r.differ.length === 0);
    if (equal && !check) { await client.query("COMMIT"); committed = true; }
    else await client.query("ROLLBACK");
    return { equal, committed, check, tables: results };
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch { /* the transaction is already gone */ }
    throw e;
  } finally {
    for (const s of Object.values(sdbs)) try { s.close(); } catch { /* read-only; nothing to lose */ }
  }
}

/**
 * --repair: insert into the files the rows only the store holds (see above).
 * Refuses, writing nothing, when any flagged row differs in content or is held
 * only by the file. Reads the store; writes only the missing rows, one sqlite
 * transaction per table. Answers `{ before, repaired, after, equal }`, where
 * `before` and `after` are the two checks and `repaired` holds counts only.
 */
export async function repairFiles(client, files) {
  const before = await importPaperwork(client, files, { check: true });
  const repaired = [];
  if (!before.equal) {
    const sdbs = { oauth: new DatabaseSync(files.oauth), roles: new DatabaseSync(files.roles) };
    try {
      const plan = [];
      const refusals = [];
      for (const t of TABLES) {
        if (!before.tables.find((r) => r.table === t.to)?.differ.length) continue;
        const sdb = sdbs[t.db];
        const columns = columnsOf(sdb, t.from);
        if (!columns.length) throw Object.assign(new Error(`cannot repair ${t.to}: ${files[t.db]} has no table ${t.from}`), { exit: 2 });
        if (before.tables.find((r) => r.table === t.to).differ.some((d) => d.endsWith(": the store has no such column")))
          refusals.push(`${t.to}: the store lacks a column the file has`);
        const file = new Map(sdb.prepare(`SELECT * FROM ${t.from}`).all().map((r) => [keyOf(r, t.key), r]));
        const store = new Map((await client.query(`SELECT * FROM ${t.to}`)).rows.map((r) => [keyOf(r, t.key), r]));
        const insert = [];
        let differ = 0, fileOnly = 0;
        for (const [k, sr] of store) {
          const fr = file.get(k);
          if (!fr) insert.push(sr);
          else if (columns.some((c) => c in sr && norm(fr[c]) !== norm(sr[c]))) differ += 1;
        }
        for (const k of file.keys()) if (!store.has(k)) fileOnly += 1;
        if (differ) refusals.push(`${t.to}: ${differ} row(s) differ in content`);
        if (fileOnly) refusals.push(`${t.to}: ${fileOnly} row(s) are in the file and not in the store`);
        plan.push({ t, sdb, columns, insert });
      }
      if (refusals.length)
        throw Object.assign(new Error(`--repair only inserts the rows the files are missing, and refuses the rest, so nothing was written: ${refusals.join("; ")}. Read --check's findings.`), { exit: 2 });
      for (const { t, sdb, columns, insert } of plan) {
        if (!insert.length) continue;
        const ins = sdb.prepare(`INSERT INTO ${t.from} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`);
        sdb.exec("BEGIN");
        try { for (const sr of insert) ins.run(...columns.map((c) => sr[c] ?? null)); sdb.exec("COMMIT"); }
        catch (e) { try { sdb.exec("ROLLBACK"); } catch { /* already gone */ } throw e; }
        repaired.push({ table: t.to, inserted: insert.length });
      }
    } finally { for (const x of Object.values(sdbs)) try { x.close(); } catch { /* closed */ } }
  }
  const after = await importPaperwork(client, files, { check: true });
  return { before, repaired, after, equal: after.equal };
}

if (process.argv[1]?.endsWith("paperwork-import.mjs")) {
  const argv = process.argv.slice(2);
  const opt = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
  const flag = (name) => argv.includes(name);
  const url = opt("--pg-url"), oauth = opt("--oauth-db"), roles = opt("--roles-db");
  const die = (msg) => { console.error(msg); process.exit(2); };
  if (!url) die("--pg-url is required, and nothing else is read for it (WORLD2_PG_URL and PG* name prod on the box)");
  if (!oauth || !existsSync(oauth)) die(`--oauth-db: no file at ${oauth}`);
  if (!roles || !existsSync(roles)) die(`--roles-db: no file at ${roles}`);
  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: url });
  let out;
  try {
    await client.connect();
    if (flag("--repair")) {
      const r = await repairFiles(client, { oauth, roles });
      await client.end();
      if (flag("--json")) console.log(JSON.stringify({ repaired: r.repaired, equal: r.equal,
        before: r.before.tables.map((t) => ({ table: t.table, findings: t.differ.length })),
        after: r.after.tables.map((t) => ({ table: t.table, findings: t.differ.length })) }, null, 2));
      else {
        // Counts only: a finding's key can be a token hash, and this output is pasted into reports.
        for (const t of r.before.tables) if (t.differ.length) console.log(`before    ${t.table.padEnd(20)} ${t.differ.length} finding(s)`);
        for (const t of r.repaired) console.log(`repaired  ${t.table.padEnd(20)} ${t.inserted} row(s) inserted into the file from the store`);
        for (const t of r.after.tables) if (t.differ.length) console.log(`after     ${t.table.padEnd(20)} ${t.differ.length} finding(s)`);
        console.log(r.equal ? "repaired; the files now equal the store" : "STILL DRIFT after the repair: run --check and read what it names");
      }
      process.exit(r.equal ? 0 : 1);
    }
    out = await importPaperwork(client, { oauth, roles }, { check: flag("--check"), replace: flag("--replace") });
  } catch (e) {
    await client.end().catch(() => {});
    die(`cannot run: ${e.message}`);
  }
  await client.end();
  if (flag("--json")) console.log(JSON.stringify(out, null, 2));
  else {
    for (const t of out.tables)
      console.log(`${t.differ.length ? "DRIFT" : "equal"}  ${t.table.padEnd(20)} file ${t.sqlite}  store ${t.store}${t.absent ? "  (absent in the file)" : ""}${t.differ.length ? `  (${t.differ.length} findings)` : ""}`);
    for (const t of out.tables) for (const d of t.differ.slice(0, 20)) console.log(`  ${d}`);
    console.log(out.check ? "checked; nothing written" : out.committed ? "copied and committed" : "DRIFT: rolled back, nothing committed");
  }
  process.exit(out.equal ? 0 : 1);
}
