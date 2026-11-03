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
//   D1b the reader fails loudly on a definer it cannot read, never skips it
//   D4  077's own guard refuses each bad setting: pg_temp alone, pg_temp twice,
//       a quoted single string, a quoted "PG_TEMP"; and admits public, pg_temp
//
// D2 to D4 run on the suite's own store (test/helpers/embedded-store.mjs).

import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { startStore } from "./helpers/embedded-store.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCHEMA = join(ROOT, "world2", "schema");
const files = readdirSync(SCHEMA).filter((n) => /^\d{3}_.+\.sql$/.test(n)).sort();

/**
 * A search_path that searches pg_temp LAST, and only there: a list of plain
 * schema names (or "$user") whose last entry is pg_temp, which appears once and
 * is not the only entry. Case counts: a quoted "PG_TEMP" is another schema, so
 * there is no `i` flag. A quoted single string ('public, pg_temp') is ONE
 * schema name with a comma in it, and is refused.
 */
const SCHEMA_NAME = String.raw`(?:"\$user"|[a-z_][a-z0-9_$]*)`;
export const pgTempLast = (path) => {
  const p = String(path ?? "").trim();
  return new RegExp(`^(?:${SCHEMA_NAME}\\s*,\\s*)+pg_temp$`).test(p) && !/(^|,)\s*pg_temp\s*,/.test(p);
};

/**
 * Every CREATE [OR REPLACE] FUNCTION in one file's SQL, in order, as
 * { file, name, args, definer, search_path }, and `unparsed`: every SECURITY
 * DEFINER this reader could not tie to a function it read (a schema-qualified
 * or quoted name, a body in `AS '...'`, an ALTER FUNCTION … SECURITY DEFINER).
 * A definer the reader cannot read is a failure, never a skip. Comments are
 * stripped first, so a header that names SECURITY DEFINER is not a function.
 */
export function functionsInText(file, text) {
  const sql = String(text).replace(/--[^\n]*/g, "");
  const functions = [], covered = [], unparsed = [];
  const re = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?([a-z_][a-z0-9_]*)\s*\(([^)]*)\)([\s\S]*?)\bAS\s+\$/gi;
  for (const m of sql.matchAll(re)) {
    const head = m[3];
    const sp = /\bSET\s+search_path\s*(?:=|TO)\s*([^;$]*?)\s*(?:\bAS\b|$)/i.exec(head + " AS");
    functions.push({ file, name: m[1].toLowerCase(), args: m[2].replace(/\s+/g, " ").trim(), definer: /\bSECURITY\s+DEFINER\b/i.test(head), search_path: sp ? sp[1].trim() : null });
    covered.push([m.index, m.index + m[0].length]);
  }
  // a string literal that names SECURITY DEFINER (077's own refusal) is words, not a function:
  // the scan reads the SQL with every '…' blanked, positions kept
  const scan = sql.replace(/'(?:[^']|'')*'/g, (q) => " ".repeat(q.length));
  for (const d of scan.matchAll(/\bSECURITY\s+DEFINER\b/gi)) {
    if (covered.some(([a, b]) => d.index >= a && d.index < b)) continue;
    const at = sql.slice(0, d.index).split("\n").length;
    unparsed.push(`${file}:${at}: a SECURITY DEFINER this reader cannot tie to a function it read (${sql.slice(Math.max(0, d.index - 60), d.index + 20).replace(/\s+/g, " ").trim()})`);
  }
  return { functions, unparsed };
}

/** Every function in the schema files, in apply order. Throws on any definer it cannot read. */
export function functionsIn(names = files) {
  const out = [], unparsed = [];
  for (const file of names) {
    const r = functionsInText(file, readFileSync(join(SCHEMA, file), "utf8"));
    out.push(...r.functions);
    unparsed.push(...r.unparsed);
  }
  if (unparsed.length) throw new Error(`definer functions the reader could not read (it never skips one):\n${unparsed.join("\n")}`);
  return out;
}

test("D1 · the files: the last definition of every SECURITY DEFINER function names a search_path that ends with pg_temp", () => {
  const last = new Map();
  for (const f of functionsIn()) last.set(f.name, f);
  const definers = [...last.values()].filter((f) => f.definer);
  // POS-666: 083's mail_block_stands is the fourth, born with search_path = public, pg_temp.
  // POS-770: 086's three (park, land, the daily count) are born the same way.
  assert.deepEqual(definers.map((f) => f.name).sort(), ["arrival_heard_weekly", "arrival_source_land", "arrival_source_park", "arrival_sources_daily",
    "berth_heard_land", "berth_heard_park", "mail_block_stands"],
    "the sweep's census: the seven definer functions in world2/schema (a new one is held to the same rule below)");
  for (const f of definers)
    assert.ok(f.search_path && pgTempLast(f.search_path), `${f.name} (${f.file}) sets search_path = ${f.search_path ?? "nothing"}: the caller's pg_temp would be searched first`);
  assert.equal(last.get("arrival_heard_weekly").file, "077_definer_pg_temp_last.sql", "077 is arrival_heard_weekly's last word");
  // the reader itself: 030's own definition is the one it must catch
  const v030 = functionsIn(["030_arrival_heard.sql"]).find((f) => f.name === "arrival_heard_weekly");
  assert.deepEqual([v030.definer, v030.search_path, pgTempLast(v030.search_path)], [true, "public", false], "030 alone searches pg_temp first");
  assert.equal(pgTempLast("public, pg_temp"), true);
  assert.equal(pgTempLast("public,pg_temp"), true);
  assert.equal(pgTempLast('"$user", public, pg_temp'), true);
  for (const bad of ["pg_temp, public", "public", "pg_temp", "public, pg_temp, pg_temp", "pg_temp, public, pg_temp",
    "'public, pg_temp'", '"public, pg_temp"', 'public, "PG_TEMP"', "public, PG_TEMP", 'public, "pg_temp"', "", null])
    assert.equal(pgTempLast(bad), false, `${JSON.stringify(bad)} is not pg_temp last and only last`);
});

test("D1b · the reader fails loudly on a definer it cannot read, and on ALTER FUNCTION … SECURITY DEFINER", () => {
  const body = "RETURNS int LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp";
  const unread = {
    "schema-qualified": `CREATE FUNCTION other.f() ${body} AS $$ SELECT 1 $$;`,
    "a quoted name": `CREATE OR REPLACE FUNCTION "F"() ${body} AS $$ SELECT 1 $$;`,
    "a body in AS '...'": `CREATE FUNCTION f() ${body} AS 'SELECT 1';`,
    "ALTER FUNCTION": "ALTER FUNCTION f() SECURITY DEFINER;",
  };
  for (const [why, sql] of Object.entries(unread)) {
    const r = functionsInText("probe.sql", sql);
    assert.equal(r.unparsed.length, 1, `${why}: named, not skipped`);
    assert.match(r.unparsed[0], /^probe\.sql:1: a SECURITY DEFINER this reader cannot tie/);
  }
  const read = functionsInText("probe.sql", `-- a SECURITY DEFINER named in a comment is not one\nCREATE FUNCTION f() ${body} AS $$ SELECT 1 $$;`);
  assert.deepEqual([read.unparsed, read.functions.map((x) => [x.name, x.definer, x.search_path])], [[], [["f", true, "public, pg_temp"]]]);
  assert.doesNotThrow(() => functionsIn(), "every definer in world2/schema is one the reader reads");
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
    assert.deepEqual(definers.map((d) => d.proname), ["arrival_heard_weekly", "arrival_source_land", "arrival_source_park", "arrival_sources_daily",
      "berth_heard_land", "berth_heard_park", "mail_block_stands"]);
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

    // D4 · 077's own guard, run as the owner beside a definer with each bad
    // setting (inside a transaction that is rolled back): it refuses all of them
    // and admits the good one (review of #589).
    const guard = /^DO \$\$[\s\S]*?^END \$\$;/m.exec(readFileSync(join(SCHEMA, "077_definer_pg_temp_last.sql"), "utf8"))?.[0];
    assert.match(guard ?? "", /POS-579: these SECURITY DEFINER functions/, "077's guard, read from the file");
    const trial = async (setting) => {
      await owner.query("BEGIN");
      try {
        await owner.query(`CREATE FUNCTION pos579_probe() RETURNS int LANGUAGE sql SECURITY DEFINER SET search_path = ${setting} AS $$ SELECT 1 $$`);
        const { rows: [c] } = await owner.query("SELECT proconfig FROM pg_proc WHERE proname = 'pos579_probe'");
        try { await owner.query(guard); return { refused: false, proconfig: c.proconfig }; }
        catch (e) { return { refused: /pos579_probe/.test(e.message), proconfig: c.proconfig, message: e.message }; }
      } finally { await owner.query("ROLLBACK"); }
    };
    const bads = ["pg_temp", "pg_temp, public, pg_temp", "'public, pg_temp'", "public, pg_temp, pg_temp", 'public, "PG_TEMP"'];
    const verdicts = {};
    for (const bad of bads) { const t = await trial(bad); verdicts[bad] = t.refused ? "refused" : `admitted ${JSON.stringify(t.proconfig)}`; }
    assert.deepEqual(verdicts, Object.fromEntries(bads.map((b) => [b, "refused"])), "the guard refuses every one");
    assert.deepEqual(await trial("public, pg_temp"), { refused: false, proconfig: ["search_path=public, pg_temp"] }, "and admits public, pg_temp");
  } finally {
    await api.end();
    await owner.end();
    await s.stop();
  }
});
