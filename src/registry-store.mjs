// registry-store.mjs — the household registry, READ FROM THE STORE (POS-187).
//
// `src/registry-rows.mjs` is the pure round trip. This file is the half that
// touches Postgres: it reads `households`, `household_pins` and
// `registry_meta` through the office's ONE pool (`world2-acts.mjs actsQuery`,
// `WORLD2_PG_URL`, role `office_api`) and hands back exactly the shapes the
// registry's readers already hold —
//
//     { schema_version, note, households: { <slug>: { … } } }     the registry
//     { <handle>: { login, id, … } }                              the pins
//
// so a caller can feed the result straight to `houseForAccount`,
// `houseForName`, `conformance` or `planRegistryJoin` with nothing in between.
// That is deliberate: the store read is not a new vocabulary, it is the SAME
// object arriving by a different road, and the round-trip falsifier is what
// makes "the same object" a measured claim rather than a hope.
//
// ── NULL IS NOT EMPTY ───────────────────────────────────────────────────────
//
// `actsQuery` answers `null` — never `[]` — when the office is not pointed at
// the record, and this module keeps that distinction all the way up.
// `loadRegistryRows()` returns `null` for "I could not look" and a rows object
// for "I looked". A registry read that turned "I could not look" into "the town
// has no households" would hand `planRegistryJoin` an empty registry, and an
// empty registry is a registry in which every account is unknown and every
// house is available — which mints duplicates over live rows. The callers
// below must branch on null, and the one that cannot is named in the header of
// this lane's PR as the reason the door readers did not move this week.
//
// ── WHY NOTHING IN `src/` IMPORTS THIS YET ──────────────────────────────────
//
// See § THE STOP in the PR body, and the same sentence here so it is impossible
// to wire this in by accident:
//
//     The ceremony that DECLARES a household reads the registry, folds a whole
//     new registry object over it, and commits that object as the FILE
//     (src/declare-exec.mjs:50 + src/declare.mjs:410, src/residency.mjs:547 +
//     :584). Nothing writes the table. So a reader switched to the store today
//     would read a table frozen at its seed, fold over it, and commit a file
//     that DROPS every house declared since — which is precisely the revert
//     `src/residency.mjs:540-546` already warns about, arriving by the other
//     door. The table has to gain its write (POS-158's mint, which calls
//     `drainRegistry()` after its own commit) before any reader may leave the
//     file.
//
// Until then this module is proven against fixtures and imported by nothing at
// a door. `tools/registry-drain.mjs` uses it, and it only ever READS.

import { actsQuery } from "./world2-acts.mjs";
import { registryFromRows, pinsFromRows, HOUSEHOLD_KEYS, PIN_KEYS } from "./registry-rows.mjs";

// ORDER BY `ord`, always. The file's 118 keys are in declaration order and
// nothing derives it (measured 2026-09-22: not sorted, and `since` runs
// backwards at 36 of them), so the column is the only place that order lives
// and a query without this clause would make the town's file depend on the
// planner's mood.
//
// `formerly` (migration 020, POS-158) is selected like any other column and
// carried through untouched. `node-postgres` hands a `text[]` back as a JS
// array of strings, which is exactly what `registryFromRows` wants — and its
// renderer drops the key when the array is empty, which today is all 118 rows.
const HOUSEHOLDS_SQL = `
  SELECT slug, ord, name, human, accounts, residents, since, member_of, declared_by, formerly
    FROM households
   ORDER BY ord`;

// Pins are sorted by handle in the renderer (`serializePins` sorts), so this
// ORDER BY is for a human reading a log, not for the bytes.
const PINS_SQL = `
  SELECT handle, login, gh_id, pinned, renamed, note, retired, renamed_to
    FROM household_pins
   ORDER BY handle`;

const META_SQL = "SELECT key, value FROM registry_meta";

/**
 * The three tables -> the rows shape `registry-rows.mjs` folds and unfolds.
 *
 * `null` = the office is not pointed at the record. Never `{}`.
 *
 * `meta` is rebuilt in the FILE'S key order — `schema_version` first, then
 * `note` — because those two are the first bytes of `tools/households.json` and
 * a meta table read back in primary-key order would spell them the other way
 * round. The order is stated here rather than stored, because it is two keys
 * and a column holding it would be a column nobody could read.
 */
export async function loadRegistryRows(env = process.env) {
  const [households, pins, meta] = await Promise.all([
    actsQuery(HOUSEHOLDS_SQL, [], env),
    actsQuery(PINS_SQL, [], env),
    actsQuery(META_SQL, [], env),
  ]);
  if (households === null || pins === null || meta === null) return null;

  const byKey = new Map(meta.map((r) => [r.key, r.value]));
  const ordered = {};
  for (const k of ["schema_version", "note"]) if (byKey.has(k)) ordered[k] = byKey.get(k);
  for (const [k, v] of byKey) if (!(k in ordered)) ordered[k] = v;

  return {
    meta: ordered,
    // `gh_id` comes back from `pg` as a STRING for bigint columns (node-postgres
    // will not silently narrow a bigint to a float), and the file spells the id
    // as a NUMBER. Every live id fits a double with room to spare — GitHub's
    // largest here is 332132909, eleven orders below 2^53 — so this coercion is
    // lossless today and the column stays bigint so the town never meets the
    // 2^31 wall at a door. `pinsFromRows` does the same coercion for the same
    // reason; both are named so neither reads as an accident.
    households: households.map((r) => ({ ...r, ord: Number(r.ord) })),
    pins,
  };
}

/** The registry object, as the clone's `tools/households.json` parses to. `null` = not asked. */
export async function loadRegistry(env = process.env) {
  const rows = await loadRegistryRows(env);
  return rows === null ? null : registryFromRows(rows);
}

/** The pins object, as the clone's `tools/github-ids.json` parses to. `null` = not asked. */
export async function loadPins(env = process.env) {
  const rows = await loadRegistryRows(env);
  return rows === null ? null : pinsFromRows(rows);
}

// ── the writers ─────────────────────────────────────────────────────────────
//
// `office_api` holds INSERT and UPDATE on all three tables (019_households.sql)
// and no DELETE anywhere. `insertRegistryRows` is the SEED's one-time fill.
// `upsertHousehold` and `upsertPin` are the hooks POS-158's mint calls, in its
// own transaction, before it calls `drainRegistry()` — they are exported and
// falsified here so that lane inherits a writer rather than inventing one.

const COLUMNS = ["slug", "ord", "name", "human", "accounts", "residents", "since", "member_of", "declared_by", "formerly"];
const PIN_COLUMNS = ["handle", "login", "gh_id", "pinned", "renamed", "note", "retired", "renamed_to"];

const placeholders = (n, offset = 0) => Array.from({ length: n }, (_, i) => `$${i + 1 + offset}`).join(", ");
// `accounts` is jsonb and wants a STRING; `residents` and `formerly` are
// `text[]` and want the JS array itself, which `node-postgres` turns into a
// Postgres array literal. Stringifying either of those would store the literal
// characters `["a","b"]` in a text[] and the drain would render JSON inside
// JSON. The `?? null` fallback is for the nullable scalars only — the two array
// columns are NOT NULL with a `'{}'` default, and `[] ?? null` is `[]`, so an
// empty list reaches the column as an empty list rather than as a NULL.
const valuesOf = (row, cols) => cols.map((c) => (c === "accounts" ? JSON.stringify(row[c] ?? []) : row[c] ?? null));

/**
 * The seed's insert. Plain INSERTs, no ON CONFLICT: the seed has already
 * REFUSED unless the table was empty, so a conflict here means something
 * raced it and the right answer is to fail loudly rather than to merge two
 * fills into one registry.
 */
export async function insertRegistryRows(rows, env = process.env) {
  const counts = { households: 0, pins: 0, meta: 0 };
  for (const [k, v] of Object.entries(rows.meta ?? {})) {
    await actsQuery("INSERT INTO registry_meta (key, value) VALUES ($1, $2)", [k, JSON.stringify(v)], env);
    counts.meta++;
  }
  for (const r of rows.households ?? []) {
    await actsQuery(`INSERT INTO households (${COLUMNS.join(", ")}) VALUES (${placeholders(COLUMNS.length)})`,
      valuesOf(r, COLUMNS), env);
    counts.households++;
  }
  for (const r of rows.pins ?? []) {
    await actsQuery(`INSERT INTO household_pins (${PIN_COLUMNS.join(", ")}) VALUES (${placeholders(PIN_COLUMNS.length)})`,
      valuesOf(r, PIN_COLUMNS), env);
    counts.pins++;
  }
  return counts;
}

/** How many rows the three tables hold. The seed's refusal reads this. */
export async function registryRowCounts(env = process.env) {
  const r = await actsQuery(
    `SELECT (SELECT count(*) FROM households)     AS households,
            (SELECT count(*) FROM household_pins) AS pins,
            (SELECT count(*) FROM registry_meta)  AS meta`, [], env);
  if (r === null) return null;
  return { households: Number(r[0].households), pins: Number(r[0].pins), meta: Number(r[0].meta) };
}

// ── A NEW HOUSE TAKES ITS PLACE FROM THE DATABASE (POS-158, review 4/6) ───
//
// THE HOLE THIS CLOSES. `mintHousehold` used to read the rows, compute
// `max(ord) + 1` in JavaScript, and write that back — with no transaction
// between the read and the write. Two mints landing together both read the same
// highest ord and both chose the same next one. `households_ord_key` is UNIQUE
// and `upsertHousehold`'s ON CONFLICT names the SLUG only, so the second insert
// did not update anything: it threw. And the caller swallowed the throw into a
// `console.warn` while still telling the resident "the same PR declares your
// household" — a house that does not exist, announced as founded.
//
// The window between the read and the write is gone: the place is computed
// INSIDE the insert, so no caller can hold a stale answer.
//
// WHAT REMAINS, STATED PLAINLY RATHER THAN CLAIMED AWAY. Two transactions
// running under the same snapshot can still both see the same `max(ord)`, and
// one of them will lose the unique index. That case is now RECOVERABLE and
// never silent: `insertHousehold` retries a bounded number of times against a
// fresh snapshot, and a failure that survives the retries is thrown — where the
// ceremony turns it into a refusal the caller actually reads. A lost race costs
// a retry; it never costs a wrong row, and it never costs a false receipt.
const ORD_RETRIES = 3;
const isOrdCollision = (e) =>
  /households_ord_key|duplicate key value/i.test(String(e?.message ?? e));

/**
 * Insert a NEW house, with its place assigned by the database.
 *
 * `row.ord` is IGNORED and must be: this is the one writer that chooses a
 * place, and a caller that could choose one is the caller that raced. Returns
 * the row as written, `ord` included, so the caller can say where it landed.
 *
 * Deliberately NOT an upsert. A mint founds a house that does not exist; if the
 * slug is taken, that is `REFUSALS.TAKEN` and a person needs to hear it, not an
 * UPDATE that silently rewrites somebody's row.
 */
export async function insertHousehold(row, env = process.env) {
  const cols = COLUMNS.filter((c) => c !== "ord");
  const vals = valuesOf(row, cols);
  const sql = `INSERT INTO households (ord, ${cols.join(", ")})
               SELECT coalesce(max(ord), -1) + 1, ${placeholders(cols.length)} FROM households
               RETURNING ord`;
  let last = null;
  for (let attempt = 1; attempt <= ORD_RETRIES; attempt++) {
    try {
      const r = await actsQuery(sql, vals, env);
      if (r === null) return null;
      return { ...row, ord: Number(r[0].ord) };
    } catch (e) {
      last = e;
      if (!isOrdCollision(e)) throw e;   // a real failure is not a race
    }
  }
  throw last;
}

/** POS-158's hook: one house, EDITED in place — the place is the caller's. Never deletes. */
export async function upsertHousehold(row, env = process.env) {
  const set = COLUMNS.filter((c) => c !== "slug").map((c) => `${c} = EXCLUDED.${c}`).join(", ");
  return actsQuery(
    `INSERT INTO households (${COLUMNS.join(", ")}) VALUES (${placeholders(COLUMNS.length)})
       ON CONFLICT (slug) DO UPDATE SET ${set}`, valuesOf(row, COLUMNS), env);
}

/** POS-158's hook: one pin, inserted or edited in place. Never deletes. */
export async function upsertPin(row, env = process.env) {
  const set = PIN_COLUMNS.filter((c) => c !== "handle").map((c) => `${c} = EXCLUDED.${c}`).join(", ");
  return actsQuery(
    `INSERT INTO household_pins (${PIN_COLUMNS.join(", ")}) VALUES (${placeholders(PIN_COLUMNS.length)})
       ON CONFLICT (handle) DO UPDATE SET ${set}`, valuesOf(row, PIN_COLUMNS), env);
}

// Re-exported so a future reader importing "the registry's grammar" gets it
// from one place whether it is reading the file or the table.
export { HOUSEHOLD_KEYS, PIN_KEYS };
