// definer-pg-temp-last.test.mjs — every SECURITY DEFINER function searches pg_temp last (POS-579).
//
// A SECURITY DEFINER function runs as its owner and resolves names through its
// own search_path. A list that does not name pg_temp still searches the
// CALLING session's temp schema first, so a caller's TEMP table can stand in
// for the store's (the review of #482, closed for 073; 030's
// arrival_heard_weekly was the one left, and 077 closes it).
//
//   D1  the files: the last definition of every SECURITY DEFINER function in
//       world2/schema names a search_path whose last entry is pg_temp
//   D2  the store, migrated to the floor: every SECURITY DEFINER function in
//       public says so in proconfig, and arrival_heard_weekly is 077's
//   D3  THE SHADOW: an office_api session's TEMP arrival_heard, readable by the
//       owner, is not what arrival_heard_weekly counts
//
// D2 and D3 run on the suite's own store (test/helpers/embedded-store.mjs).

import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { startStore } from "./helpers/embedded-store.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCHEMA = join(ROOT, "world2", "schema");
const files = readdirSync(SCHEMA).filter((n) => /^\d{3}_.+\.sql$/.test(n)).sort();

/** A search_path setting that searches pg_temp last: its list's last entry is pg_temp. */
export const pgTempLast = (path) => /(^|,)\s*"?pg_temp"?\s*$/i.test(String(path).trim());

/**
 * Every CREATE [OR REPLACE] FUNCTION in the schema files, in apply order, as
 * { file, name, args, definer, search_path }. Comments are stripped first, so a
 * header that names SECURITY DEFINER is not a function.
 */
export function functionsIn(names = files) {
  const out = [];
  for (const file of names) {
    const sql = readFileSync(join(SCHEMA, file), "utf8").replace(/--[^\n]*/g, "");
    const re = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?([a-z_][a-z0-9_]*)\s*\(([^)]*)\)([\s\S]*?)\bAS\s+\$/gi;
    for (const m of sql.matchAll(re)) {
      const head = m[3];
      const sp = /\bSET\s+search_path\s*(?:=|TO)\s*([^;$]*?)\s*(?:\bAS\b|$)/i.exec(head + " AS");
      out.push({ file, name: m[1].toLowerCase(), args: m[2].replace(/\s+/g, " ").trim(), definer: /\bSECURITY\s+DEFINER\b/i.test(head), search_path: sp ? sp[1].trim() : null });
    }
  }
  return out;
}

test("D1 · the files: the last definition of every SECURITY DEFINER function names a search_path that ends with pg_temp", () => {
  const last = new Map();
  for (const f of functionsIn()) last.set(f.name, f);
  const definers = [...last.values()].filter((f) => f.definer);
  assert.deepEqual(definers.map((f) => f.name).sort(), ["arrival_heard_weekly", "berth_heard_land", "berth_heard_park"],
    "the sweep's census: the three definer functions in world2/schema (a new one is held to the same rule below)");
  for (const f of definers)
    assert.ok(f.search_path && pgTempLast(f.search_path), `${f.name} (${f.file}) sets search_path = ${f.search_path ?? "nothing"}: the caller's pg_temp would be searched first`);
  assert.equal(last.get("arrival_heard_weekly").file, "077_definer_pg_temp_last.sql", "077 is arrival_heard_weekly's last word");
  // the reader itself: 030's own definition is the one it must catch
  const v030 = functionsIn(["030_arrival_heard.sql"]).find((f) => f.name === "arrival_heard_weekly");
  assert.deepEqual([v030.definer, v030.search_path, pgTempLast(v030.search_path)], [true, "public", false], "030 alone searches pg_temp first");
  assert.equal(pgTempLast("public, pg_temp"), true);
  assert.equal(pgTempLast("pg_temp, public"), false);
  assert.equal(pgTempLast("public"), false);
});

test("D2 + D3 · the store: every SECURITY DEFINER function searches pg_temp last, and a caller's TEMP arrival_heard is not what the weekly counts read", async () => {
  const s = await startStore({ db: "definer_pg_temp_test" });
  const api = await s.connect("office_api");
  const owner = await s.connect("world2_owner");
  try {
    const { rows: definers } = await owner.query(
      `SELECT p.proname, pg_get_userbyid(p.proowner) AS owner, p.proconfig
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.prosecdef ORDER BY 1`);
    assert.deepEqual(definers.map((d) => d.proname), ["arrival_heard_weekly", "berth_heard_land", "berth_heard_park"]);
    for (const d of definers) {
      const sp = (d.proconfig ?? []).find((c) => c.startsWith("search_path="));
      assert.ok(sp && pgTempLast(sp.slice("search_path=".length)), `${d.proname}: proconfig ${JSON.stringify(d.proconfig)}`);
      assert.equal(d.owner, "world2_owner");
    }
    assert.deepEqual(definers.find((d) => d.proname === "arrival_heard_weekly").proconfig, ["search_path=public, pg_temp"]);
    // 030's grants survive the replace: office_api may execute it, PUBLIC may not
    const { rows: [g] } = await owner.query(
      "SELECT has_function_privilege('office_api', 'arrival_heard_weekly(timestamptz)', 'EXECUTE') AS api, has_function_privilege('snapshot_reader', 'arrival_heard_weekly(timestamptz)', 'EXECUTE') AS other");
    assert.deepEqual(g, { api: true, other: false });

    // the store's own answers: three for reddit (counted by name), one for youtube (folded)
    for (const [h, heard] of [["a", "reddit"], ["b", "reddit"], ["c", "reddit"], ["d", "youtube"]])
      await api.query("INSERT INTO arrival_heard (handle, household, heard, answered_at) VALUES ($1, $1, $2, '2026-10-13T10:00:00Z')", [h, heard]);
    const weekly = async () => (await api.query("SELECT week::text AS week, heard, n::int AS n FROM arrival_heard_weekly('2026-10-01T00:00:00Z')")).rows;
    const truth = [{ week: "2026-10-12", heard: "fewer-than-3", n: 1 }, { week: "2026-10-12", heard: "reddit", n: 3 }];
    assert.deepEqual(await weekly(), truth);

    // THE SHADOW: office_api makes a TEMP arrival_heard the owner may read, full of
    // its own rows. A function that searched pg_temp first would count these.
    await api.query("CREATE TEMP TABLE arrival_heard (handle text, household text, heard text, note text, answered_at timestamptz)");
    await api.query("GRANT SELECT ON arrival_heard TO world2_owner");
    for (let i = 0; i < 5; i += 1) await api.query("INSERT INTO pg_temp.arrival_heard VALUES ($1, $1, 'shadow', null, '2026-10-13T10:00:00Z')", [`s${i}`]);
    assert.deepEqual(await weekly(), truth, "the weekly counts read the store's table, never the caller's shadow");
    await api.query("DROP TABLE pg_temp.arrival_heard");
  } finally {
    await api.end();
    await owner.end();
    await s.stop();
  }
});
