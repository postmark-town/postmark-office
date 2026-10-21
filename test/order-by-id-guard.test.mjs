// order-by-id-guard.test.mjs — no read sorts act ids by their text (POS-742).
//
// `SELECT id::text AS id … ORDER BY id` orders by the OUTPUT alias, the text, so
// "1000000" comes before "999999" (plumb-combat found it, 2026-10-21). This
// refuses that shape in every SQL string of src/, world2/tools/ and deploy/: a
// string that selects `<x.>id::text AS id` must order by a qualified column
// (`acts.id`, `s.id`), never a bare `id`. order-by-id-store.test.mjs drives the
// fixed reads on a real Postgres across 999,999 → 1,000,000.
//
// THE CAN-FAIL CONTROL is the last case: the same reader catches the bug's own
// spelling, so a reader that matches nothing cannot pass for a clean tree.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Known and fixed elsewhere: plumb-combat's branch (wld25/encounter-nerve, on the
 * w44 train) orders these two by `acts.id` already. A main-side edit to the same
 * lines would only conflict when the train takes main, so they wait for it.
 * Each is named by its file and constant, never by a line number.
 */
const FIXED_ON_THE_TRAIN = Object.freeze([
  { file: "src/creatures.mjs", constant: "LIVING_SQL" },
  { file: "src/creatures.mjs", constant: "LIVING_BOOT_SQL" },
]);

/** Every SQL string in `text` that selects id as text and orders by the bare alias: [{ line, constant, sql }]. */
export function textOrderedReads(text) {
  const out = [];
  const re = /`[^`]*`|"(?:[^"\\\n]|\\.)*"/g;
  let m;
  while ((m = re.exec(text))) {
    const sql = m[0];
    if (!/\bSELECT\s+(?:\w+\.)?id::text\s+AS\s+id\b/i.test(sql)) continue;
    if (!/ORDER\s+BY\s+id\b/i.test(sql)) continue;
    const before = text.slice(0, m.index);
    const constant = /(?:const|let)\s+(\w+)\s*=\s*$/.exec(before)?.[1] ?? null;
    out.push({ line: before.split("\n").length, constant, sql: sql.replace(/\s+/g, " ").slice(0, 120) });
  }
  return out;
}

test("no read in src/, world2/tools/ or deploy/ sorts act ids by their text", () => {
  const found = [];
  for (const dir of ["src", "world2/tools", "deploy"]) {
    let names = [];
    try { names = readdirSync(join(ROOT, dir)).filter((f) => f.endsWith(".mjs")); } catch { continue; }
    for (const f of names) {
      const file = `${dir}/${f}`;
      for (const hit of textOrderedReads(readFileSync(join(ROOT, file), "utf8")))
        if (!FIXED_ON_THE_TRAIN.some((k) => k.file === file && k.constant === hit.constant)) found.push(`${file}:${hit.line} ${hit.constant ?? ""} ${hit.sql}`);
    }
  }
  assert.deepEqual(found, [], `order these by the table's column (acts.id), never the id::text alias:\n${found.join("\n")}`);
});

test("the can-fail control: the reader catches the bug's own spelling, and passes the fixed one and a CTE's own id", () => {
  assert.equal(textOrderedReads("export const X = `SELECT id::text AS id FROM acts WHERE a = $1 ORDER BY id LIMIT 1`;").length, 1);
  assert.equal(textOrderedReads("const Y = `SELECT s.id::text AS id FROM acts s ORDER BY id DESC`;")[0].constant, "Y");
  assert.equal(textOrderedReads("const Z = `SELECT id::text AS id FROM acts ORDER BY acts.id`;").length, 0);
  assert.equal(textOrderedReads("const W = `WITH w AS (SELECT id FROM windows ORDER BY id DESC LIMIT 1) INSERT INTO c SELECT w.id RETURNING id::text AS id`;").length, 0,
    "a RETURNING alias with a CTE's own ORDER BY id is not this bug");
});
