// pos-779-089-landed.test.mjs — 089's "landed" probe means the INTENDED valid index and function, not a name (POS-779).
//
// Own throwaway Postgres (test/helpers/embedded-store.mjs), invented data, DDL by the schema owner only: no
// superuser, no catalog write. Every wrong artifact is built by ordinary DDL inside a transaction that is rolled
// back, except the INVALID index, which is made by a real interrupted CREATE INDEX CONCURRENTLY: an `office_api`
// transaction holds an uncommitted INSERT (a writer the build must wait for) and the owner's statement_timeout
// cancels the build, leaving the index INVALID. No sleep decides anything: the build waits on the open writer and
// the timeout is the cancel.
//
// The probe under test is the existing LANDED["089_voice_time_index.sql"].probe. The OLD name-only probe and the
// lossy-regexp draft are kept below as text, to show what they would have said.
//
//   node --test test/pos-779-089-landed.test.mjs

import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { startStore } from "./helpers/embedded-store.mjs";
import { LANDED } from "../world2/tools/migrations-landed.mjs";

const SQLFILE = join(dirname(fileURLToPath(import.meta.url)), "..", "world2", "schema", "089_voice_time_index.sql");
const PROBE = LANDED["089_voice_time_index.sql"].probe;
const OLD_NAME_ONLY = `to_regclass('public.acts_voice_at_idx') IS NOT NULL AND EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'voice_payload_private' AND provolatile = 'i')`;
// The draft this lane first wrote: it erased syntax INSIDE quoted literals too.
const OLD_LOSSY = PROBE.replace(
  /pg_get_expr\(i\.indpred, i\.indrelid\) IN \([^\n]*\)\n/,
  `regexp_replace(pg_get_expr(i.indpred, i.indrelid), '::text|public\\.|[()\\s]', '', 'g') = 'action=ANYARRAY[''say'',''legacy:emission'',''emission'']ANDNOTvoice_payload_privatepayload'\n`);
// Mutants of the real probe, for the in-test discrimination checks.
const NO_VALIDITY = PROBE.replace("i.indisvalid AND i.indisready AND i.indislive AND ", "");
const NO_DEPEND = PROBE.replace(/AND EXISTS \(SELECT 1 FROM pg_depend d[\s\S]*?\)\)\n/, "\n");

const GOOD_KEYS = "(action, at, id)";
const GOOD_PRED = "action IN ('say', 'legacy:emission', 'emission') AND NOT voice_payload_private(payload)";

let s = null, skip = false, owner = null;
before(async () => {
  try { s = await startStore({ db: "landed_089" }); } catch (e) { skip = String(e.message ?? e).slice(0, 120); return; }
  if (s.skip) { skip = s.skip; s = null; return; }
  owner = await s.connect("world2_owner");
});
after(async () => { await owner?.end().catch(() => {}); await s?.stop?.(); });

const ask = async (c, probe = PROBE) => (await c.query(`SELECT (${probe}) AS ok`)).rows[0].ok;

/** Replace the intended index with `ddl` inside a transaction, ask `probes`, roll back. */
async function withVariant(ddl, probes = [PROBE], { pre = [] } = {}) {
  await owner.query("BEGIN");
  try {
    for (const p of pre) await owner.query(p);
    await owner.query("DROP INDEX acts_voice_at_idx");
    await owner.query(ddl);
    const out = [];
    for (const p of probes) out.push(await ask(owner, p));
    return out;
  } finally { await owner.query("ROLLBACK"); }
}
const idx = (keys, pred, how = "") => `CREATE ${how} INDEX acts_voice_at_idx ON acts ${keys} ${pred ? "WHERE " + pred : ""}`;

test("the correct artifact, as the migration lays it down, reads LANDED", async (t) => {
  if (skip) return t.skip(skip);
  assert.equal(await ask(owner), true);
  // and under another search_path (the deparse then qualifies the function name)
  await owner.query("BEGIN");
  try { await owner.query("SET LOCAL search_path = pg_catalog"); assert.equal(await ask(owner), true); }
  finally { await owner.query("ROLLBACK"); }
});

test("missing index, or missing function, is not landed", async (t) => {
  if (skip) return t.skip(skip);
  await owner.query("BEGIN");
  try { await owner.query("DROP INDEX acts_voice_at_idx"); assert.equal(await ask(owner), false); }
  finally { await owner.query("ROLLBACK"); }
  await owner.query("BEGIN");
  try {
    await owner.query("DROP INDEX acts_voice_at_idx");
    await owner.query("DROP FUNCTION voice_payload_private(jsonb)");
    assert.equal(await ask(owner), false);
  } finally { await owner.query("ROLLBACK"); }
  assert.equal(await ask(owner), true, "rolled back: the artifact is intact again");
});

test("a differently keyed, ordered, directed, uniqued or predicated index is not landed", async (t) => {
  if (skip) return t.skip(skip);
  const cases = {
    "wrong key list":        idx("(action, at)", GOOD_PRED),
    "wrong key order":       idx("(action, id, at)", GOOD_PRED),
    "DESC key":              idx("(action, at DESC, id)", GOOD_PRED),
    "extra INCLUDE column":  idx(`${GOOD_KEYS} INCLUDE (actor)`, GOOD_PRED),
    "unique":                idx(GOOD_KEYS, GOOD_PRED, "UNIQUE"),
    "hash method":           `CREATE INDEX acts_voice_at_idx ON acts USING hash (action) WHERE ${GOOD_PRED}`,
    "no predicate":          idx(GOOD_KEYS, ""),
    "only say":              idx(GOOD_KEYS, "action IN ('say') AND NOT voice_payload_private(payload)"),
    "predicate w/o privacy": idx(GOOD_KEYS, "action IN ('say', 'legacy:emission', 'emission')"),
    "extra predicate term":  idx(GOOD_KEYS, `${GOOD_PRED} AND id > 0`),
  };
  for (const [name, ddl] of Object.entries(cases)) {
    const [real, nameOnly] = await withVariant(ddl, [PROBE, OLD_NAME_ONLY]).catch((e) => { throw new Error(`${name}: ${e.message}`); });
    assert.equal(real, false, `${name}: must NOT read landed`);
    assert.equal(nameOnly, true, `${name}: (control) the OLD name-only probe called this landed`);
  }
});

test("valid-but-wrong LITERALS do not pass for the intended ones; the lossy normalizer would have", async (t) => {
  if (skip) return t.skip(skip);
  const lits = ["'s a y'", "'say::text'", "'public.say'", "'(say)'"];
  for (const bad of lits) {
    const pred = `action IN (${bad}, 'legacy:emission', 'emission') AND NOT voice_payload_private(payload)`;
    const [real, lossy, nameOnly] = await withVariant(idx(GOOD_KEYS, pred), [PROBE, OLD_LOSSY, OLD_NAME_ONLY]);
    assert.equal(real, false, `${bad}: the real probe must refuse`);
    assert.equal(lossy, true, `${bad}: (control) the lossy-regexp draft called this landed`);
    assert.equal(nameOnly, true, `${bad}: (control) the name-only probe too`);
  }
});

test("a same-NAMED function in another schema is not THE function (pg_depend ties the predicate to public's)", async (t) => {
  if (skip) return t.skip(skip);
  const pre = [
    "CREATE SCHEMA shadow",
    `CREATE FUNCTION shadow.voice_payload_private(p jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$ SELECT false $$`,
    "SET LOCAL search_path = shadow, public",
  ];
  const ddl = idx(GOOD_KEYS, GOOD_PRED); // resolves, by search_path, to shadow's function, and DEPARSES unqualified
  const [real, noDepend, nameOnly] = await withVariant(ddl, [PROBE, NO_DEPEND, OLD_NAME_ONLY], { pre });
  assert.equal(real, false);
  assert.equal(noDepend, true, "(mutant) without the pg_depend tie the deparse alone cannot see the shadow function");
  assert.equal(nameOnly, true, "(control) the old probe saw a name");
});

test("a wrong function definition is not landed: body, volatility, security, config, strictness, language", async (t) => {
  if (skip) return t.skip(skip);
  const body = readFileSync(SQLFILE, "utf8").match(/AS \$\$([\s\S]*?)\$\$;/)[1];
  const fn = (attrs, b = body, lang = "plpgsql") =>
    `CREATE OR REPLACE FUNCTION voice_payload_private(p jsonb) RETURNS boolean LANGUAGE ${lang} ${attrs} AS $f$${b}$f$`;
  const keep = idx(GOOD_KEYS, GOOD_PRED);
  const cases = {
    "edited body":    fn("IMMUTABLE SET search_path = pg_catalog", body.replace("1e-300", "1e-200")),
    "STABLE":         fn("STABLE SET search_path = pg_catalog"),
    "no search_path": fn("IMMUTABLE"),
    "other path":     fn("IMMUTABLE SET search_path = public"),
    "STRICT":         fn("IMMUTABLE STRICT SET search_path = pg_catalog"),
    "SECURITY DEFINER": fn("IMMUTABLE SECURITY DEFINER SET search_path = pg_catalog"),
    "PARALLEL SAFE":  fn("IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog"),
    "sql language":   `CREATE OR REPLACE FUNCTION voice_payload_private(p jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $f$ SELECT false $f$`,
  };
  for (const [name, ddl] of Object.entries(cases)) {
    await owner.query("BEGIN");
    try {
      await owner.query(ddl);
      assert.equal(await ask(owner), false, `${name}: must NOT read landed`);
      assert.equal(await ask(owner, OLD_NAME_ONLY), name === "STABLE" ? false : true, `${name}: old probe`);
    } finally { await owner.query("ROLLBACK"); }
  }
  assert.equal(await ask(owner), true);
});

test("the md5 constant is held to the function body in the .sql file, and to the server's prosrc", async (t) => {
  if (skip) return t.skip(skip);
  const body = readFileSync(SQLFILE, "utf8").match(/AS \$\$([\s\S]*?)\$\$;/)[1];
  const constant = PROBE.match(/md5\(p\.prosrc\) = '([0-9a-f]{32})'/)[1];
  assert.equal(createHash("md5").update(body).digest("hex"), constant, "edit the body ⇒ update the probe's constant");
  assert.equal((await owner.query("SELECT md5(prosrc) AS m FROM pg_proc WHERE oid = to_regprocedure('public.voice_payload_private(jsonb)')")).rows[0].m, constant);
});

test("an INTERRUPTED CREATE INDEX CONCURRENTLY leaves the intended index INVALID, and the probe refuses it", async (t) => {
  if (skip) return t.skip(skip);
  const api = await s.connect("office_api");
  const o2 = await s.connect("world2_owner");
  try {
    await owner.query("DROP INDEX acts_voice_at_idx"); // own disposable db; restored at the end of this test
    // A writer the build must wait for: an uncommitted INSERT by office_api.
    await api.query("BEGIN");
    await api.query(`INSERT INTO acts (at, crossing, actor, action, class, payload) VALUES (now(), 0, 'invented', 'say', 'voice', '{"text":"hold"}')`)
      .catch(async (e) => { throw new Error(`cannot hold a writer open: ${e.message}`); });
    await o2.query("SET statement_timeout = '1500ms'");
    await assert.rejects(
      o2.query(`CREATE INDEX CONCURRENTLY acts_voice_at_idx ON acts ${GOOD_KEYS} WHERE ${GOOD_PRED}`),
      (e) => e.code === "57014", "the build is cancelled by the owner's own statement_timeout");
    await o2.query("RESET statement_timeout");
    const st = (await owner.query(`SELECT indisvalid, indisready FROM pg_index WHERE indexrelid = to_regclass('public.acts_voice_at_idx')`)).rows[0];
    assert.ok(st, "the cancelled build left an index row behind");
    assert.equal(st.indisvalid, false, "…and it is INVALID (the premise of this control)");
    // exact intended definition, only invalid:
    assert.equal(await ask(owner), false, "real probe: invalid is not landed");
    assert.equal(await ask(owner, OLD_NAME_ONLY), true, "(control) the old name-only probe: false-landed");
    assert.equal(await ask(owner, OLD_LOSSY), false, "(the lossy draft checked the definition but not validity: it passes only if validity is missing)");
    assert.equal(await ask(owner, NO_VALIDITY), true, "(mutant) with the validity/ready checks removed the invalid index reads landed");
    // the header's `IF NOT EXISTS` is a silent no-op on it (it needs the table lock, so the held writer ends first):
    await api.query("ROLLBACK");
    await owner.query(`CREATE INDEX IF NOT EXISTS acts_voice_at_idx ON acts ${GOOD_KEYS} WHERE ${GOOD_PRED}`);
    assert.equal(await ask(owner), false, "IF NOT EXISTS did not repair it");
  } finally {
    await api.query("ROLLBACK").catch(() => {});
    await api.end().catch(() => {});
    await o2.end().catch(() => {});
    // restore in this disposable db: the operator's order, by hand
    await owner.query("DROP INDEX IF EXISTS acts_voice_at_idx");
    await owner.query(`CREATE INDEX acts_voice_at_idx ON acts ${GOOD_KEYS} WHERE ${GOOD_PRED}`);
  }
  assert.equal(await ask(owner), true, "rebuilt (disposable db): landed again");
});
