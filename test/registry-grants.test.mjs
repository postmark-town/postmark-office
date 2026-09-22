// registry-grants.test.mjs — the three-pens law, checked WITHOUT a database (POS-187).
//
// `world2/schema/003_falsifier_roles.sql` is the real falsifier: it enumerates
// every role holding INSERT/UPDATE/DELETE/TRUNCATE in the live database and
// prints a row for any that is not on its lawful list. Green = zero rows. It
// needs a database, so it runs on the box.
//
// This is the half that can run in CI, and it catches the one way 003 goes
// stale: a migration grants a write and forgets to add the matching row. That
// is not hypothetical — `014_escrow_projection.sql` did exactly this and the
// roles falsifier has been RED on prod ever since (named in 018's header, and
// named here, and NOT repaired by this lane: repairing it means deciding
// whether those grants are lawful, which is a ruling and not a test fix).
//
// So this test asserts the *forward* direction only — every write GRANT in
// `world2/schema/` appears on 003's lawful list — and it records 014's rows as
// the one known-missing set, with the count asserted so a SECOND forgotten
// grant reds immediately instead of hiding behind the first.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCHEMA = join(HERE, "..", "world2", "schema");

const WRITES = new Set(["INSERT", "UPDATE", "DELETE", "TRUNCATE"]);
// The owner is migrations, not a runtime pen — 003 excludes it by the same
// words, and this list must exclude it by the same words or the two disagree.
const NOT_A_PEN = new Set(["postgres", "world2_owner", "public"]);

/** Every `GRANT <privs> ON <tables> TO <roles>` in the schema, as flat triples. */
function grantsInSchema() {
  const out = [];
  for (const f of readdirSync(SCHEMA).filter((n) => n.endsWith(".sql")).sort()) {
    const sql = readFileSync(join(SCHEMA, f), "utf8")
      .split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    for (const m of sql.matchAll(/GRANT\s+([A-Za-z,\s]+?)\s+ON\s+(?:TABLE\s+)?([A-Za-z0-9_,\s]+?)\s+TO\s+([A-Za-z0-9_,\s]+?)\s*;/gi)) {
      const privs = m[1].split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
      if (privs.includes("ALL")) continue; // 002 grants the owner everything; not a runtime pen
      const tables = m[2].split(",").map((s) => s.trim()).filter(Boolean);
      const roles = m[3].split(",").map((s) => s.trim()).filter(Boolean);
      for (const p of privs) {
        if (!WRITES.has(p)) continue;
        for (const t of tables) for (const r of roles) {
          if (NOT_A_PEN.has(r)) continue;
          out.push({ file: f, grantee: r, table_name: t, privilege_type: p });
        }
      }
    }
  }
  return out;
}

/** 003's own lawful list, parsed out of its VALUES block. */
function lawfulList() {
  const sql = readFileSync(join(SCHEMA, "003_falsifier_roles.sql"), "utf8");
  const set = new Set();
  for (const m of sql.matchAll(/\(\s*'([a-z_]+)'\s*,\s*'([a-z_]+)'\s*,\s*'([A-Z]+)'\s*\)/g))
    set.add(`${m[1]}|${m[2]}|${m[3]}`);
  return set;
}

// 014_escrow_projection.sql's grants, missing from 003's list since the day it
// shipped. Recorded, not repaired: whether they are lawful is a ruling.
const KNOWN_MISSING = [
  "law_ingester|escrow_projection|INSERT",
  "law_ingester|escrow_projection|DELETE",
];

test("019's own grants are on 003's lawful list", () => {
  const lawful = lawfulList();
  const mine = grantsInSchema().filter((g) => g.file === "019_households.sql");
  assert.ok(mine.length > 0, "019 grants at least one write, or this test proves nothing");
  for (const g of mine)
    assert.ok(lawful.has(`${g.grantee}|${g.table_name}|${g.privilege_type}`),
      `019 grants ${g.privilege_type} on ${g.table_name} to ${g.grantee}, and 003_falsifier_roles.sql does not list it — the three-pens falsifier will red on the box`);

  // The grants 019 is supposed to have written, stated so a silently dropped
  // GRANT line reds here rather than at the first door that needs it.
  const got = new Set(mine.map((g) => `${g.grantee}|${g.table_name}|${g.privilege_type}`));
  for (const want of [
    "office_api|households|INSERT", "office_api|households|UPDATE",
    "office_api|household_pins|INSERT", "office_api|household_pins|UPDATE",
    "office_api|registry_meta|INSERT", "office_api|registry_meta|UPDATE",
  ]) assert.ok(got.has(want), `019 must grant ${want.split("|").join(" ")}`);
});

test("019 grants no DELETE to any pen — a house is never removed", () => {
  // The town's own witness refuses a PR that removes a registry row ("nothing
  // removed", town tools/witness.mjs:31). The store must not be able to do what
  // the file's gate refuses.
  const mine = grantsInSchema().filter((g) => g.file === "019_households.sql");
  assert.deepEqual(mine.filter((g) => g.privilege_type === "DELETE"), []);
  assert.deepEqual(mine.filter((g) => g.privilege_type === "TRUNCATE"), []);
});

test("no write grant anywhere in world2/schema is missing from 003, beyond 014's known two", () => {
  const lawful = lawfulList();
  const missing = grantsInSchema()
    .map((g) => `${g.grantee}|${g.table_name}|${g.privilege_type}`)
    .filter((k) => !lawful.has(k));
  const unexpected = [...new Set(missing)].filter((k) => !KNOWN_MISSING.includes(k));
  assert.deepEqual(unexpected, [],
    "a migration granted a write and did not add it to 003_falsifier_roles.sql's lawful list — add the row in the same commit, or the roles falsifier reds on the box");
  // And the known red is still exactly the known red: if 014's grants get
  // repaired upstream, this line says so instead of silently widening.
  assert.deepEqual([...new Set(missing)].sort(), [...KNOWN_MISSING].sort(),
    "014_escrow_projection.sql's two grants are the one pre-existing gap; this list must not grow");
});
