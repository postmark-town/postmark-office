// static-keys-retire.test.mjs — retire one static key, and the import cannot bring it back (POS-604).
//
// Everything here is SYNTHETIC: keys named sk-*, households and handles invented,
// a temporary Postgres from the suite's helper (as office_api, so the real
// grants are the ones proved), sqlite files in a temp directory. No real
// database, env file, key or resident record is read.
//
//   § A  the falsifier: import, retire, re-import
//   § B  dry writes nothing and says nothing secret
//   § C  the selector: no match, ambiguous, widened, a wider row is a cover
//   § D  the cover: what counts and what fails closed
//   § E  between dry and apply: the cover removed, the count wrong
//   § F  the table lock: writers wait, readers do not, a second apply rechecks, a busy table times out
//   § G  the file: failure, wrong read-back, missing, and --mirror-only
//   § H  the import: partial, foreign-kind rollback, dry parity
//   § I  the CLIs: exit codes, no key and no hash in any output
//   § K  Wright's review folds: the statement bound, the key's facts and created, the file's busy wait, the resident cover
//   § J  the door: a real office on the store answers a static bearer, then refuses the SAME bearer once retired

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";

import { oauthSchema } from "../src/oauth.mjs";
import { paperOnPool, paperworkPoolTypes, asPaper } from "../src/paperwork.mjs";
import { staticLookup, importStaticKeys, RETIRED_KIND } from "../src/static-keys.mjs";
import { planRetire, retireStaticKey, mirrorOnly, LOCK_TIMEOUT_MS, STATEMENT_TIMEOUT_MS } from "../src/static-keys-retire.mjs";
import { startStore } from "./helpers/embedded-store.mjs";
import { indexStore } from "./helpers/office-under-test.mjs";
import { fixtureTown } from "./fixture.mjs";
import { bootOnFreePort } from "./spawn-office.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TMP = mkdtempSync(join(tmpdir(), "postmark-static-retire-"));
const CLEANUP = [];
after(async () => {
  for (const f of CLEANUP.reverse()) await f().catch(() => {});
  rmSync(TMP, { recursive: true, force: true });
});

const sha = (s) => createHash("sha256").update(s).digest("base64url");
const NOW = Math.floor(Date.now() / 1000);

// ── the suite's store, as office_api ────────────────────────────────────────
const store = await startStore({ db: "static_keys_retire" });
CLEANUP.push(() => store.stop());
const pg = (await import("pg")).default;
const pool = new pg.Pool({ connectionString: store.url("office_api"), max: 8, types: paperworkPoolTypes(pg) });
CLEANUP.push(() => pool.end());
const paper = paperOnPool(pool);

let ordSeq = 9000;
let fileSeq = 0;
let idSeq = 7_100_000;

/** A clean tokens table, and a fresh synthetic house: unique slug, handles, account id. */
async function fresh(handles = ["wren", "moss"], { pinTo = undefined, resident = null } = {}) {
  await pool.query("DELETE FROM oauth_tokens");
  const n = ++idSeq;
  const slug = `hearth-${n}`;
  const ghId = n;
  await pool.query(
    "INSERT INTO households (slug, ord, accounts, residents, since, declared_by) VALUES ($1, $2, $3::jsonb, $4, '2026-10-01', 'test')",
    [slug, ++ordSeq, JSON.stringify([{ login: `login-${n}`, id: ghId }]), resident ?? handles.map((h) => `${h}-${n}`)]);
  for (const h of handles)
    await pool.query("INSERT INTO household_pins (handle, login, gh_id) VALUES ($1, $2, $3)", [`${h}-${n}`, `login-${n}`, pinTo ?? ghId]);
  return { slug, ghId, login: `login-${n}`, h: (x) => `${x}-${n}` };
}

const mintedCover = (ghId, { expires = NOW + 86400, kind = "household", heldBy = null, claimedHandle = null } = {}) =>
  pool.query("INSERT INTO oauth_tokens (token_hash, kind, gh_id, gh_login, client_id, expires, created, held_by, claimed_handle) VALUES ($1, $2, $3, 'x', NULL, $4, $5, $6, $7)",
    [sha(`minted-${ghId}-${kind}-${expires}-${heldBy}-${claimedHandle}`), kind, ghId, expires, NOW, heldBy, claimedHandle]);

const importSpec = (spec, opts) => importStaticKeys(paper, spec, opts);
const snapshot = async () => (await pool.query(
  "SELECT token_hash, kind, gh_id, gh_login, client_id, expires, created, held_by, household, handles FROM oauth_tokens ORDER BY token_hash")).rows;
const minted = async () => (await snapshot()).filter((r) => ["household", "access", "refresh"].includes(r.kind));
const kindOf = async (key) => (await pool.query("SELECT kind FROM oauth_tokens WHERE token_hash = $1", [sha(key)])).rows[0]?.kind ?? null;
const resolves = async (key) => (await staticLookup(paper, key)) != null;

function fileDb(name = `f${++fileSeq}`) {
  const path = join(TMP, `${name}-oauth.db`);
  const db = new DatabaseSync(path);
  oauthSchema(db);
  db.close();
  return path;
}
const fileRows = (path) => {
  const db = new DatabaseSync(path, { readOnly: true });
  try { return db.prepare("SELECT token_hash, kind, household, handles, gh_id FROM tokens ORDER BY token_hash").all(); }
  finally { db.close(); }
};
/** Put the same static rows in the file as the store holds (what the mirror keeps true). */
async function seedFile(path, spec) {
  const db = new DatabaseSync(path);
  try { await importStaticKeys(asPaper(db), spec); } finally { db.close(); }
}
const fileKind = (path, key) => fileRows(path).find((r) => r.token_hash === sha(key))?.kind ?? null;

/** Nothing secret in any words a verb or CLI said: no key, no hash, no piece of a hash. */
function assertNoSecret(said, keys, why = "") {
  const text = typeof said === "string" ? said : JSON.stringify(said);
  for (const k of keys) {
    assert.equal(text.includes(k), false, `the key ${k} was printed ${why}`);
    const h = sha(k);
    for (let i = 0; i + 6 <= h.length; i++) assert.equal(text.includes(h.slice(i, i + 6)), false, `a piece of ${k}'s hash was printed ${why}`);
  }
}

/** A pool whose registry reads fail: the registry tables answer an error. */
function registryDown(real) {
  const wrap = (c) => ({
    query: (sql, ...a) => (/household_pins|households|registry_meta/.test(String(sql?.text ?? sql))
      ? Promise.reject(new Error("the registry is unreadable (synthetic)")) : c.query(sql, ...a)),
    on: (...a) => c.on?.(...a), release: (x) => c.release(x),
  });
  return { query: (sql, ...a) => wrap(real).query(sql, ...a), connect: async () => wrap(await real.connect()) };
}

// Two keys on the house; wren's is the one to retire; a live human key covers it.
async function threeKeys({ cover = true } = {}) {
  const w = await fresh();
  const spec = `sk-wren=${w.slug}:${w.h("wren")};sk-moss=${w.slug}:${w.h("moss")}`;
  await importSpec(spec);
  if (cover) await mintedCover(w.ghId);
  return { ...w, spec, wren: w.h("wren"), moss: w.h("moss") };
}

// ── § A the falsifier ───────────────────────────────────────────────────────

test("§ A import, retire, re-import: the retired entry is refused by name, the rest still import, minted rows byte-identical", async (t) => {
  const w = await threeKeys();
  const file = fileDb();
  await seedFile(file, w.spec);
  const mintedBefore = await minted();
  assert.equal(await resolves("sk-wren"), true);

  const out = await retireStaticKey(pool, { household: w.slug, handle: w.wren, file });
  assert.equal(out.status, "retired", out.message ?? out.reason);
  assert.equal(typeof out.lock_held_ms, "number");
  t.diagnostic(`synthetic, one embedded Postgres, not a production latency guarantee: oauth_tokens write-locked ${out.lock_held_ms} ms for an unpaused successful retire`);
  assert.equal(await resolves("sk-wren"), false, "a retired bearer resolves nothing");
  assert.equal(await resolves("sk-moss"), true, "the other key is untouched");
  assert.equal(await kindOf("sk-wren"), RETIRED_KIND);
  const tomb = (await pool.query("SELECT * FROM oauth_tokens WHERE kind = 'retired'")).rows[0];
  assert.equal(tomb.household, w.slug);
  assert.equal(tomb.handles, JSON.stringify([w.wren]));
  assert.equal(tomb.expires, null);
  assert.equal(fileKind(file, "sk-wren"), "retired", "and the file agrees");

  // re-import from the same OFFICE_KEYS, plus a new entry
  const again = await importSpec(`${w.spec};sk-new=${w.slug}:newcomer`);
  assert.equal(again.outcome, "partial");
  assert.equal(again.retired_refused, 1);
  assert.deepEqual(again.retired, [`${w.slug}:${w.wren}`], "named by household and handles, never by key");
  assert.equal(again.added, 1);
  assert.equal(again.refused, 0);
  assert.equal(await resolves("sk-wren"), false, "the retired key stays retired");
  assert.equal(await resolves("sk-new"), true, "the rest of the import committed");
  assert.deepEqual(await minted(), mintedBefore, "minted rows are byte-identical");

  // THE CONTROL: with no tombstone (the way a hand-deleted key looks) the same import writes it back.
  await pool.query("DELETE FROM oauth_tokens WHERE kind = 'retired'");
  const control = await importSpec(w.spec);
  assert.equal(control.added, 1, "without the record, the old behavior: the key returns");
  assert.equal(await resolves("sk-wren"), true);
});

test("§ A2 the sweep keeps a tombstone, and retiring swaps one row for one (the dev rehearsal's kind-blind count)", async () => {
  const w = await fresh(["wren"]);
  await importSpec(`sk-pin=${w.slug}#${w.ghId}:${w.h("wren")}`); // pinned to the synthetic account id
  await importSpec(`sk-cover=${w.slug}:${w.h("wren")},extra`);
  const countFor = async () => (await pool.query("SELECT kind FROM oauth_tokens WHERE gh_id = $1", [w.ghId])).rows;
  assert.equal((await countFor()).length, 1);
  const out = await retireStaticKey(pool, { household: w.slug, handle: w.h("wren"), file: fileDb() });
  assert.equal(out.status === "retired" || out.status === "mirror_failed", true, out.reason);
  const rows = await countFor();
  assert.equal(rows.length, 1, "one row in, one row out: the rehearsal's count of tokens for a pinned account is unchanged");
  assert.equal(rows[0].kind, "retired");
  await paper.run("DELETE FROM tokens WHERE expires < ?", NOW + 10);
  assert.equal(await kindOf("sk-pin"), "retired", "the sweep never reaches a tombstone");
});

// ── § B dry ─────────────────────────────────────────────────────────────────

test("§ B dry is advisory: it writes nothing to the store or the file, and says nothing secret", async () => {
  const w = await threeKeys();
  const file = fileDb();
  await seedFile(file, w.spec);
  const before = [await snapshot(), fileRows(file)];
  const out = await planRetire(pool, { household: w.slug, handle: w.wren, file });
  assert.equal(out.status, "dry", JSON.stringify(out));
  assert.equal(out.matched, 1);
  assert.match(out.cover, /live household key/);
  assert.deepEqual([await snapshot(), fileRows(file)], before, "nothing written anywhere");
  assertNoSecret(out, ["sk-wren", "sk-moss"], "in the dry result");
});

// ── § C the selector ────────────────────────────────────────────────────────

test("§ C no match, ambiguous and widened selectors write nothing; a wider row is a cover, not ambiguity", async () => {
  const w = await fresh(["aa", "bb", "cc"]);
  await importSpec([`sk-aa=${w.slug}:${w.h("aa")}`, `sk-aa2=${w.slug}:${w.h("aa")}`, `sk-bc=${w.slug}:${w.h("bb")},${w.h("cc")}`].join(";"));
  await mintedCover(w.ghId);
  const before = await snapshot();
  const none = await retireStaticKey(pool, { household: w.slug, handle: "nobody" });
  assert.deepEqual([none.status, none.reason], ["refused", "no matching static row"]);
  const otherHouse = await retireStaticKey(pool, { household: "no-such-house", handle: w.h("aa") });
  assert.equal(otherHouse.status, "refused");
  const amb = await retireStaticKey(pool, { household: w.slug, handle: w.h("aa") });
  assert.equal(amb.status, "refused");
  assert.match(amb.reason, /2 static rows hold exactly this handle \(ambiguous\)/);
  const wide = await retireStaticKey(pool, { household: w.slug, handle: w.h("bb") });
  assert.equal(wide.status, "refused");
  assert.match(wide.reason, new RegExp(`also holds other handles \\(${w.h("cc")}\\).*widen`));
  assert.deepEqual(await snapshot(), before, "no tombstone and no deletion for any refusal");
  assert.equal(await resolves("sk-bc"), true);

  // one exact row plus a wider one holding the same handle: the exact row is the target, the wider one the cover
  const w2 = await fresh(["dd", "ee"]);
  await importSpec(`sk-dd=${w2.slug}:${w2.h("dd")};sk-dd-ee=${w2.slug}:${w2.h("dd")},${w2.h("ee")}`);
  const ok = await retireStaticKey(pool, { household: w2.slug, handle: w2.h("dd"), file: fileDb() });
  assert.notEqual(ok.status, "refused", ok.reason);
  assert.equal(await resolves("sk-dd"), false);
  assert.equal(await resolves("sk-dd-ee"), true, "the wider row, the cover, is untouched");
});

// ── § D the cover ───────────────────────────────────────────────────────────

test("§ D the cover: only a proved, working key counts, and an unproved one fails closed", async () => {
  const refused = async (w, why, opts = {}) => {
    const before = await snapshot();
    const out = await retireStaticKey(opts.pool ?? pool, { household: w.slug, handle: w.wren });
    assert.equal(out.status, "refused", `${why}: ${JSON.stringify(out)}`);
    assert.match(out.reason, /no other working key covers|registry/, why);
    assert.deepEqual(await snapshot(), before, `${why}: nothing written`);
    assert.equal(await resolves("sk-wren"), true, `${why}: the target still resolves`);
  };
  // no other key at all
  await refused(await threeKeys({ cover: false }), "no other key");
  // another static key of the house for a DIFFERENT handle is not a cover for this handle
  await refused(await threeKeys({ cover: false }), "a static key for a different handle");
  // an expired human key; an access token; a resident-held key
  let w = await threeKeys({ cover: false }); await mintedCover(w.ghId, { expires: NOW - 5 }); await refused(w, "an expired household key");
  w = await threeKeys({ cover: false }); await mintedCover(w.ghId, { kind: "access" }); await refused(w, "an access token");
  w = await threeKeys({ cover: false }); await mintedCover(w.ghId, { heldBy: "resident" }); await refused(w, "a resident-held key");
  // a live key, but the registry does not prove THIS household and handle
  w = await fresh(); await importSpec(`sk-wren=${w.slug}:${w.h("wren")}`); await mintedCover(w.ghId + 5_000_000);
  w.wren = w.h("wren"); await refused(w, "a live key for an account the handle is not pinned to");
  w = await fresh(["wren"], { pinTo: 111 }); await importSpec(`sk-wren=${w.slug}:${w.h("wren")}`); await mintedCover(111); w.wren = w.h("wren");
  await refused(w, "a live key for the pinned account, which is not an account of this household");
  w = await fresh(["wren"], { resident: ["someone-else"] }); await importSpec(`sk-wren=${w.slug}:${w.h("wren")}`); await mintedCover(w.ghId); w.wren = w.h("wren");
  await refused(w, "the registry does not list the handle as a resident");
  // a household string that is not a registry slug can be covered only by a static row
  await pool.query("DELETE FROM oauth_tokens");
  await importSpec("sk-solo=the-town:ferry");
  await mintedCover(777);
  const town = await retireStaticKey(pool, { household: "the-town", handle: "ferry" });
  assert.equal(town.status, "refused");
  // the registry unreadable: fail closed on apply AND dry
  w = await threeKeys();
  await refused(w, "the registry is unreadable", { pool: registryDown(pool) });
  const dry = await planRetire(registryDown(pool), { household: w.slug, handle: w.wren });
  assert.equal(dry.status, "refused");
  assert.match(dry.reason, /registry could not be read/);
  // and the positive controls: a static cover passes, a live proved human key passes
  w = await fresh(["wren", "moss"]);
  await importSpec(`sk-wren=${w.slug}:${w.h("wren")};sk-wren-moss=${w.slug}:${w.h("wren")},${w.h("moss")}`);
  assert.notEqual((await retireStaticKey(pool, { household: w.slug, handle: w.h("wren"), file: fileDb() })).status, "refused");
  w = await threeKeys();
  const ok = await retireStaticKey(pool, { household: w.slug, handle: w.wren, file: fileDb() });
  assert.match(ok.cover ?? ok.message, /live household key|retired/);
});

// ── § E between dry and apply ───────────────────────────────────────────────

test("§ E the cover removed between dry and apply: the apply refuses and rolls back", async () => {
  for (const how of ["deleted", "expired-by-time"]) {
    const w = await threeKeys({ cover: false });
    await importSpec(`sk-cover=${w.slug}:${w.wren},${w.moss}`);
    const file = fileDb();
    await seedFile(file, `${w.spec};sk-cover=${w.slug}:${w.wren},${w.moss}`);
    const dry = await planRetire(pool, { household: w.slug, handle: w.wren, file });
    assert.equal(dry.status, "dry", how);
    if (how === "deleted") await pool.query("DELETE FROM oauth_tokens WHERE token_hash = $1", [sha("sk-cover")]);
    else { await pool.query("DELETE FROM oauth_tokens WHERE token_hash = $1", [sha("sk-cover")]); await mintedCover(w.ghId, { expires: NOW - 1 }); }
    const before = [await snapshot(), fileRows(file)];
    const out = await retireStaticKey(pool, { household: w.slug, handle: w.wren, file });
    assert.equal(out.status, "refused", how);
    assert.match(out.reason, /no other working key/);
    assert.deepEqual([await snapshot(), fileRows(file)], before, `${how}: store and file untouched`);
    assert.equal(await resolves("sk-wren"), true);
  }
});

test("§ E2 a wrong count rolls back: the delete that removes 0 rows leaves the store as it was", async () => {
  const w = await threeKeys();
  const before = await snapshot();
  const out = await retireStaticKey(pool, { household: w.slug, handle: w.wren, file: fileDb(),
    hooks: { beforeDelete: (c) => c.query("DELETE FROM oauth_tokens WHERE token_hash = $1", [sha("sk-wren")]) } });
  assert.equal(out.status, "refused");
  assert.match(out.reason, /removed 0 rows, not 1/);
  assert.deepEqual(await snapshot(), before, "the hook's own delete rolled back with the rest");
});

// ── § F the table lock ──────────────────────────────────────────────────────

/** Count backends of THIS store waiting on a lock on oauth_tokens (bounded wait for `n`; no sleeps). */
async function waitTableWaiters(n, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const r = await pool.query(
      "SELECT count(*)::int AS n FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid"
      + " WHERE l.locktype = 'relation' AND NOT l.granted AND l.relation = 'oauth_tokens'::regclass AND a.datname = $1", [store.database]);
    if (r.rows[0].n >= n) return true;
    await new Promise((ok) => setImmediate(ok));
  }
  return false;
}
const gate = () => { let release; let seen; const open = new Promise((ok) => { release = ok; }); const reached = new Promise((ok) => { seen = ok; }); return { open, release, reached, seen }; };

test("§ F the lock is the contract: office_api may take it, writers wait, readers do not", async () => {
  const w = await threeKeys();
  const g = gate();
  const held = retireStaticKey(pool, { household: w.slug, handle: w.wren, file: fileDb(),
    hooks: { afterLock: async () => { g.seen(); await g.open; } } });
  await g.reached;
  // a reader is not blocked: a bearer lookup answers while the table is write-locked
  assert.equal(await resolves("sk-moss"), true, "readers go through");
  // a writer is: an INSERT waits for the retire
  const writer = pool.query("INSERT INTO oauth_tokens (token_hash, kind, gh_id, expires, created) VALUES ($1, 'access', 5, $2, $3)", [sha("sk-late-writer"), NOW + 1e6, NOW]);
  assert.equal(await waitTableWaiters(1), true, "the writer is waiting on the table lock (it needs ROW EXCLUSIVE; SHARE ROW EXCLUSIVE conflicts)");
  g.release();
  const out = await held;
  assert.equal(out.status, "retired", out.reason ?? out.message);
  await writer;
  assert.equal(await kindOf("sk-late-writer"), "access", "the writer ran after the retire committed");
});

test("§ F2 two applies: the second WAITS, then rechecks after the first, and refuses when the cover left meanwhile", async () => {
  const w = await threeKeys(); // wren and moss, one shared live human cover
  const g = gate();
  const first = retireStaticKey(pool, { household: w.slug, handle: w.wren, file: fileDb(),
    hooks: { afterDelete: async () => { g.seen(); await g.open; } } }); // proved and deleted, NOT yet committed
  await g.reached;
  // a hand DELETE of the cover queues behind the first, and the second apply queues behind it
  const revoke = pool.query("DELETE FROM oauth_tokens WHERE kind = 'household'");
  assert.equal(await waitTableWaiters(1), true, "the revocation waits for the retire");
  const second = retireStaticKey(pool, { household: w.slug, handle: w.moss, file: fileDb() });
  assert.equal(await waitTableWaiters(2), true, "and so does the second apply");
  g.release();
  const [a, b] = await Promise.all([first, second]);
  await revoke;
  assert.equal(a.status, "retired", a.reason ?? a.message);
  assert.equal(b.status, "refused", "the second rechecked AFTER the lock and found no cover");
  assert.match(b.reason, /no other working key/);
  assert.equal(await resolves("sk-moss"), true, "its target is untouched");
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM oauth_tokens WHERE kind = 'retired'")).rows[0].n, 1);
});

test("§ F3 two applies on the same selector: one retires, the other waits and finds it gone", async () => {
  const w = await threeKeys();
  const g = gate();
  const first = retireStaticKey(pool, { household: w.slug, handle: w.wren, file: fileDb(),
    hooks: { afterLock: async () => { g.seen(); await g.open; } } });
  await g.reached;
  const second = retireStaticKey(pool, { household: w.slug, handle: w.wren, file: fileDb() });
  assert.equal(await waitTableWaiters(1), true);
  g.release();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a.status, "retired", a.reason ?? a.message);
  assert.equal(b.status, "refused");
  assert.match(b.reason, /no matching static row/);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM oauth_tokens WHERE kind = 'retired'")).rows[0].n, 1);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM oauth_tokens WHERE kind = 'household'")).rows[0].n, 1, "the cover stands");
});

test("§ F4 a conflicting lock held elsewhere: a clean timeout, nothing written, a non-success receipt, no file touched", async () => {
  const w = await threeKeys();
  const file = fileDb();
  await seedFile(file, w.spec);
  const before = [await snapshot(), fileRows(file)];
  const blocker = await pool.connect();
  await blocker.query("BEGIN");
  await blocker.query("LOCK TABLE oauth_tokens IN ROW EXCLUSIVE MODE"); // what any writer holds; conflicts with SHARE ROW EXCLUSIVE
  try {
    const t0 = performance.now();
    const out = await retireStaticKey(pool, { household: w.slug, handle: w.wren, file, lockTimeoutMs: 400 });
    const took = performance.now() - t0;
    assert.equal(out.status, "busy");
    assert.match(out.message, /table busy/);
    assert.match(out.message, /Nothing changed\. Run it again/);
    assert.ok(took >= 350 && took < 5000, `it waited its bound and no longer (${Math.round(took)} ms)`);
  } finally { await blocker.query("ROLLBACK"); blocker.release(); }
  assert.deepEqual([await snapshot(), fileRows(file)], before, "nothing written to the store or the file");
  assert.equal(await resolves("sk-wren"), true);
  assert.equal(LOCK_TIMEOUT_MS, 2000, "the shipped bound is the ruled 2 s");
  // and with the blocker gone the same call succeeds
  assert.equal((await retireStaticKey(pool, { household: w.slug, handle: w.wren, file })).status, "retired");
});

// ── § G the file ────────────────────────────────────────────────────────────

const failOnInsert = (path, sql) => { const db = new DatabaseSync(path); db.exec(sql); db.close(); };

test("§ G a file that cannot be written, reads back wrong, or is missing is NON-success; the store is committed", async () => {
  for (const [how, setup] of [
    ["write fails", (p) => failOnInsert(p, "CREATE TRIGGER nope BEFORE INSERT ON tokens WHEN NEW.kind = 'retired' BEGIN SELECT RAISE(ABORT, 'synthetic refusal'); END")],
    ["reads back wrong", (p) => failOnInsert(p, "CREATE TRIGGER skew AFTER INSERT ON tokens WHEN NEW.kind = 'retired' BEGIN UPDATE tokens SET household = 'skewed' WHERE token_hash = NEW.token_hash; END")],
    ["file missing", () => null],
  ]) {
    const w = await threeKeys();
    const file = how === "file missing" ? join(TMP, `absent-${++fileSeq}.db`) : fileDb();
    if (how !== "file missing") { await seedFile(file, w.spec); setup(file); }
    const out = await retireStaticKey(pool, { household: w.slug, handle: w.wren, file });
    assert.equal(out.status, "mirror_failed", how);
    assert.match(out.message, /STORE COMMITTED/);
    assert.match(out.message, /--mirror-only/);
    assert.doesNotMatch(out.message, /rolled back|nothing was written/i, "it never implies the store rolled back");
    assert.equal(await kindOf("sk-wren"), RETIRED_KIND, `${how}: the store holds the retirement`);
    assert.equal(await resolves("sk-wren"), false);
    if (how === "write fails") assert.equal(fileKind(file, "sk-wren"), "static", "the file still holds the live key (the rollback hazard the message names)");
    if (how === "reads back wrong") assert.equal(fileRows(file).find((r) => r.token_hash === sha("sk-wren")).household, "skewed", "the file committed a row that is not the retirement, and the tool said so");
    assertNoSecret(out, ["sk-wren", "sk-moss"], how);
    if (how === "file missing") assert.equal(existsSync(file), false, "the tool does not create the file");
  }
});

test("§ G2 a plain rerun directs to --mirror-only; --mirror-only repairs the file and writes nothing in the store", async () => {
  const w = await threeKeys();
  const file = fileDb();
  await seedFile(file, w.spec);
  failOnInsert(file, "CREATE TRIGGER nope BEFORE INSERT ON tokens WHEN NEW.kind = 'retired' BEGIN SELECT RAISE(ABORT, 'synthetic refusal'); END");
  assert.equal((await retireStaticKey(pool, { household: w.slug, handle: w.wren, file })).status, "mirror_failed");
  failOnInsert(file, "DROP TRIGGER nope");

  // a plain rerun does not repair: it refuses and names the repair
  const storeBefore = await snapshot();
  const plain = await retireStaticKey(pool, { household: w.slug, handle: w.wren, file });
  assert.equal(plain.status, "refused");
  const plainDry = await planRetire(pool, { household: w.slug, handle: w.wren, file });
  assert.match(plainDry.hint, /--mirror-only/);
  assert.deepEqual(await snapshot(), storeBefore);

  const fixed = await mirrorOnly(pool, { household: w.slug, handle: w.wren, file });
  assert.equal(fixed.status, "repaired", fixed.reason ?? fixed.message);
  assert.deepEqual(await snapshot(), storeBefore, "the store is byte-identical: --mirror-only writes nothing there");
  assert.equal(fileKind(file, "sk-wren"), "retired");
  assert.equal(fileKind(file, "sk-moss"), "static", "the other key in the file is untouched");
  // idempotent
  assert.equal((await mirrorOnly(pool, { household: w.slug, handle: w.wren, file })).status, "repaired");
  assert.deepEqual(await snapshot(), storeBefore);
});

test("§ G3 --mirror-only with a fresh static key for the same household and handle leaves it alone; with no tombstone it refuses", async () => {
  const w = await threeKeys();
  const file = fileDb();
  await seedFile(file, w.spec);
  assert.equal((await mirrorOnly(pool, { household: w.slug, handle: w.wren, file })).status, "refused", "no tombstone recorded");
  assert.equal(fileKind(file, "sk-wren"), "static", "refusal wrote nothing to the file");

  await retireStaticKey(pool, { household: w.slug, handle: w.wren, file: join(TMP, "absent-for-g3.db") }); // store commits, file missing
  await importSpec(`sk-fresh=${w.slug}:${w.wren}`);                                                           // a NEW key, same household and handle
  await seedFile(file, `sk-fresh=${w.slug}:${w.wren}`);
  const storeBefore = await snapshot();
  const fixed = await mirrorOnly(pool, { household: w.slug, handle: w.wren, file });
  assert.equal(fixed.status, "repaired");
  assert.equal(fixed.newer_static_untouched, 1);
  assert.deepEqual(await snapshot(), storeBefore);
  assert.equal(await resolves("sk-fresh"), true, "the fresh key still resolves");
  assert.equal(await resolves("sk-wren"), false);
  assert.equal(fileKind(file, "sk-fresh"), "static", "and is still a live row in the file");
  assert.equal(fileKind(file, "sk-wren"), "retired");
});

// ── § H the import ──────────────────────────────────────────────────────────

test("§ H a foreign kind rolls back EVERYTHING, even when a retired entry is also named; dry says the same", async () => {
  const w = await threeKeys();
  await retireStaticKey(pool, { household: w.slug, handle: w.wren, file: fileDb() });
  await pool.query("INSERT INTO oauth_tokens (token_hash, kind, gh_id, gh_login, client_id, expires, created) VALUES ($1, 'access', 7, 'someone', 'c', $2, $3)", [sha("sk-collides"), NOW + 1e6, NOW]);
  const before = await snapshot();
  const spec = `sk-wren=${w.slug}:${w.wren};sk-collides=${w.slug}:x;sk-brand-new=${w.slug}:newcomer`;
  const real = await importSpec(spec);
  assert.deepEqual([real.outcome, real.refused, real.retired_refused], ["rolled_back", 1, 1]);
  assert.deepEqual(await snapshot(), before, "nothing written, not even the new entry");
  const dry = await importSpec(spec, { dry: true });
  assert.deepEqual([dry.outcome, dry.refused, dry.retired_refused], ["rolled_back", 1, 1]);
  assert.deepEqual(await snapshot(), before);
  // and a partial, dry and real
  const ok = `sk-wren=${w.slug}:${w.wren};sk-brand-new=${w.slug}:newcomer`;
  const dryP = await importSpec(ok, { dry: true });
  assert.deepEqual([dryP.outcome, dryP.added, dryP.retired_refused], ["partial", 1, 1]);
  assert.equal(await resolves("sk-brand-new"), false, "dry wrote nothing");
  const realP = await importSpec(ok);
  assert.deepEqual([realP.outcome, realP.added], ["partial", 1]);
  assert.equal(await resolves("sk-brand-new"), true);
  assert.equal((await importSpec(`sk-moss=${w.slug}:${w.moss}`)).outcome, "complete");
});

// ── § I the CLIs ────────────────────────────────────────────────────────────

test("§ I the CLIs: exit codes, and no key or hash in any output", async () => {
  const w = await threeKeys();
  const file = fileDb();
  await seedFile(file, w.spec);
  const env = { ...process.env, OFFICE_PAPERWORK_STORE: "1", WORLD2_PG: "1", WORLD2_PG_URL: store.url("office_api"), OFFICE_KEYS: "" };
  const run = (tool, args, extra = {}) => spawnSync(process.execPath, [join(ROOT, "tools", tool), "--oauth-db", file, ...args], { env: { ...env, ...extra }, encoding: "utf8" });
  const said = [];
  const retire = (...a) => { const r = run("static-keys-retire.mjs", ["--household", w.slug, "--handle", w.wren, ...a]); said.push(r.stdout, r.stderr); return r; };

  assert.equal(retire("--dry").status, 0, said.at(-1));
  assert.equal(fileKind(file, "sk-wren"), "static", "dry wrote nothing");
  assert.equal(retire("--dry", "--json").status, 0);
  assert.equal(retire().status, 0, said.at(-1));
  assert.equal(await kindOf("sk-wren"), RETIRED_KIND);
  assert.equal(retire().status, 1, "retiring again: refused, nothing written");
  assert.match(said.at(-1), /--mirror-only/);
  assert.equal(retire("--mirror-only").status, 0);
  assert.equal(retire("--mirror-only", "--json").status, 0);
  assert.equal(run("static-keys-retire.mjs", ["--household", w.slug, "--handle", "nobody", "--mirror-only"]).status, 1, "no tombstone: refused");

  // usage, and no way to hand it a key
  assert.equal(run("static-keys-retire.mjs", ["--household", w.slug]).status, 2);
  const withKey = run("static-keys-retire.mjs", ["--household", w.slug, "--handle", w.wren, "--key", "sk-wren"]);
  assert.equal(withKey.status, 2);
  assert.equal(run("static-keys-retire.mjs", ["--household", w.slug, "--handle", w.wren], { OFFICE_PAPERWORK_STORE: "" }).status, 2, "no store, no run");

  // a mirror failure exits 4: the file is gone
  const w2 = await threeKeys();
  const gone = join(TMP, `never-${++fileSeq}.db`);
  const r4 = spawnSync(process.execPath, [join(ROOT, "tools", "static-keys-retire.mjs"), "--oauth-db", gone, "--household", w2.slug, "--handle", w2.wren], { env, encoding: "utf8" });
  said.push(r4.stdout, r4.stderr);
  assert.equal(r4.status, 4, r4.stderr);
  assert.match(r4.stderr, /STORE COMMITTED/);

  // the import: partial exits 3 and names the entry; complete exits 0
  const spec = `sk-wren=${w.slug}:${w.wren};sk-moss=${w.slug}:${w.moss};sk-extra=${w.slug}:extra`;
  const imp = (...a) => { const r = run("static-keys-import.mjs", a, { OFFICE_KEYS: spec }); said.push(r.stdout, r.stderr); return r; };
  const dryI = imp("--dry");
  assert.equal(dryI.status, 3, dryI.stderr);
  assert.match(dryI.stdout, /outcome: partial/);
  assert.match(dryI.stdout, new RegExp(`RETIRED, refused by name: ${w.slug}:${w.wren}`));
  const realI = imp();
  assert.equal(realI.status, 3, realI.stderr);
  assert.equal(imp("--json").status, 3);
  assert.equal(await resolves("sk-extra"), true, "the partial import committed the rest");
  const spec2 = `sk-moss=${w.slug}:${w.moss}`;
  assert.equal(run("static-keys-import.mjs", [], { OFFICE_KEYS: spec2 }).status, 0);
  // a foreign collision exits 1
  await pool.query("INSERT INTO oauth_tokens (token_hash, kind, gh_id, expires, created) VALUES ($1, 'access', 7, $2, $3)", [sha("sk-clash"), NOW + 1e6, NOW]);
  const clash = run("static-keys-import.mjs", [], { OFFICE_KEYS: `sk-clash=${w.slug}:y;sk-wren=${w.slug}:${w.wren}` });
  said.push(clash.stdout, clash.stderr);
  assert.equal(clash.status, 1);
  assert.match(clash.stdout, /outcome: rolled_back/);

  assertNoSecret(said.join("\n"), ["sk-wren", "sk-moss", "sk-extra", "sk-clash"], "in a CLI's output");
});

// ── § J the door ────────────────────────────────────────────────────────────

test("§ J a booted office on the store: the static bearer authenticates, the SAME bearer is refused 401 once retired, its replacement still works", async () => {
  const dbPath = fixtureTown();
  const ix = await indexStore(dbPath, { db: "retire_door", own: true });
  CLEANUP.push(() => ix.stop());
  const jpool = new pg.Pool({ connectionString: ix.store.url("office_api"), max: 4, types: paperworkPoolTypes(pg) });
  CLEANUP.push(() => jpool.end());
  const jpaper = paperOnPool(jpool);
  const spec = "sk-door-wren=doorhouse:dwren;sk-door-cover=doorhouse:dwren,dmoss";
  await importStaticKeys(jpaper, spec);
  // a store-switched office opens the file only if it exists, so the mirror's file is made first
  const oauthDb = fileDb("j");
  await seedFile(oauthDb, spec);
  let said = "";
  const office = await bootOnFreePort((port) => { const c = spawn(process.execPath, [join(ROOT, "src", "server.mjs"),
    "--port", String(port), "--oauth-db", oauthDb, "--roles-db", join(TMP, "j-roles.db")], {
    env: { ...process.env, ...ix.env, OFFICE_PAPERWORK_STORE: "1", OFFICE_READ_WORKERS: "0", WORLD_GRAPH_NONE: "1", OFFICE_KEYS: "",
      TOWN_CLONE: join(TMP, "j-no-clone"), WORLD_CLONE: join(TMP, "j-no-world-clone"), TOWN_PUSH: "" },
    stdio: ["ignore", "pipe", "pipe"],
  }); c.stderr.on("data", (x) => { said += String(x); }); return c; });
  CLEANUP.push(async () => office.child.kill());
  const me = async (key) => {
    const r = await fetch(`http://127.0.0.1:${office.port}/me`, { headers: { authorization: `Bearer ${key}` } });
    return { status: r.status, challenge: r.headers.get("www-authenticate"), body: await r.text() };
  };

  const before = await me("sk-door-wren");
  assert.equal(before.status, 200, `the live static bearer authenticates: ${before.body.slice(0, 200)}\n${said.slice(-800)}`);
  assert.deepEqual(JSON.parse(before.body).handles.includes("dwren"), true);
  assert.equal((await me("sk-door-cover")).status, 200, "and so does the covering key");

  const out = await retireStaticKey(jpool, { household: "doorhouse", handle: "dwren", file: oauthDb });
  assert.equal(out.status, "retired", out.reason ?? out.message);

  const after = await me("sk-door-wren");
  assert.equal(after.status, 401, `the SAME bearer is refused once retired: ${after.body.slice(0, 200)}`);
  assert.ok(after.challenge, "refused with the sign-in challenge, as an unknown key is");
  const cover = await me("sk-door-cover");
  assert.equal(cover.status, 200, "the replacement still works");
  assert.equal(JSON.parse(cover.body).handles.includes("dwren"), true, "and still speaks for the handle");
  assertNoSecret(after.body + cover.body + said, ["sk-door-wren", "sk-door-cover"], "by the office");
});

// ── § K Wright's review folds (POS-604, 2026-10-12) ─────────────────────────

test("§ K1 a statement that outlasts the bound while the table is locked: cancelled, rolled back, nothing written", async () => {
  assert.equal(STATEMENT_TIMEOUT_MS, 5000, "the shipped bound is the ruled 5 s");
  const w = await threeKeys();
  const file = fileDb();
  await seedFile(file, w.spec);
  const before = [await snapshot(), fileRows(file)];
  const out = await retireStaticKey(pool, { household: w.slug, handle: w.wren, file, statementTimeoutMs: 300,
    hooks: { beforeDelete: (c) => c.query("SELECT pg_sleep(2)") } });
  assert.equal(out.status, "refused");
  assert.equal(out.timed_out, true);
  assert.match(out.reason, /outlasted the 300 ms bound \(statement_timeout\).*nothing was written/);
  assert.deepEqual([await snapshot(), fileRows(file)], before, "store and file untouched");
  assert.equal(await resolves("sk-wren"), true);
  // and the lock is gone with it: a plain retire right after succeeds
  assert.equal((await retireStaticKey(pool, { household: w.slug, handle: w.wren, file })).status, "retired");
});

test("§ K2 dry, apply and the tombstone carry the key's own created, whether it has a gh_id, and what is left", async () => {
  const w = await threeKeys();
  const file = fileDb();
  await seedFile(file, w.spec);
  const orig = Number((await pool.query("SELECT created FROM oauth_tokens WHERE token_hash = $1", [sha("sk-wren")])).rows[0].created);
  const iso = new Date(orig * 1000).toISOString();
  const dry = await planRetire(pool, { household: w.slug, handle: w.wren, file });
  assert.deepEqual([dry.target_created, dry.target_has_gh_id, dry.household_static_keys_now, dry.household_static_keys_left], [iso, false, 2, 1]);
  const later = orig + 3600; // the retirement happens an hour after the import (inside the cover key's life)
  const out = await retireStaticKey(pool, { household: w.slug, handle: w.wren, file, now: later });
  assert.equal(out.status, "retired", out.reason ?? out.message);
  assert.deepEqual([out.target_created, out.target_has_gh_id, out.household_static_keys_left], [iso, false, 1]);
  assert.equal(out.retired_at, new Date(later * 1000).toISOString(), "the retirement's own instant is in the receipt");
  const tomb = (await pool.query("SELECT created FROM oauth_tokens WHERE token_hash = $1", [sha("sk-wren")])).rows[0];
  assert.equal(Number(tomb.created), orig, "the tombstone keeps the key's own created, not the retirement's");
  const db = new DatabaseSync(file, { readOnly: true });
  try { assert.equal(Number(db.prepare("SELECT created FROM tokens WHERE token_hash = ?").get(sha("sk-wren")).created), orig, "and so does the file"); }
  finally { db.close(); }
  assertNoSecret([dry, out], ["sk-wren", "sk-moss"], "in the receipts");
  // a key pinned to a gh_id says so (nonsecret: present or not, never the id's owner)
  const p = await fresh(["wren"]);
  await importSpec(`sk-pinned=${p.slug}#${p.ghId}:${p.h("wren")};sk-cover=${p.slug}:${p.h("wren")},extra`);
  assert.equal((await planRetire(pool, { household: p.slug, handle: p.h("wren") })).target_has_gh_id, true);
});

test("§ K3 the file's busy wait: a writer holding oauth.db for under 2 s is waited out, not failed", async () => {
  const w = await threeKeys();
  const file = fileDb();
  await seedFile(file, w.spec);
  // another process holds the file's write lock for 800 ms (DatabaseSync is synchronous, so it must be another process)
  const holder = spawn(process.execPath, ["-e", `
    const { DatabaseSync } = require("node:sqlite");
    const db = new DatabaseSync(process.argv[1]);
    db.exec("BEGIN IMMEDIATE"); console.log("locked");
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 800);
    db.exec("COMMIT"); db.close();`, file], { stdio: ["ignore", "pipe", "inherit"] });
  await new Promise((ok, no) => { holder.stdout.on("data", (d) => { if (String(d).includes("locked")) ok(); }); holder.on("exit", () => no(new Error("the holder exited before locking"))); });
  const out = await retireStaticKey(pool, { household: w.slug, handle: w.wren, file });
  await new Promise((ok) => (holder.exitCode !== null ? ok() : holder.on("exit", ok)));
  assert.equal(out.status, "retired", `waited out the holder: ${out.message ?? out.reason}`);
  assert.equal(fileKind(file, "sk-wren"), "retired");
});

test("§ K4 a resident-held key covers ONLY the exact claimed handle, with the registry's proof and a live expiry", async () => {
  // positive: claimed for exactly this handle, the pinned account, live
  let w = await threeKeys({ cover: false });
  await mintedCover(w.ghId, { heldBy: "resident", claimedHandle: w.wren });
  const mintedBefore = await minted();
  const ok = await retireStaticKey(pool, { household: w.slug, handle: w.wren, file: fileDb() });
  assert.equal(ok.status, "retired", ok.reason ?? ok.message);
  assert.match(ok.cover, /resident-held household key claimed for exactly this handle/);
  assert.deepEqual(await minted(), mintedBefore, "the minted rows are byte-identical");
  // negatives, each on a fresh house, each writing nothing
  const refusedWith = async (setup, why) => {
    const h = await setup();
    const before = await snapshot();
    const out = await retireStaticKey(pool, { household: h.slug, handle: h.wren });
    assert.equal(out.status, "refused", `${why}: ${JSON.stringify(out)}`);
    assert.match(out.reason, /no other working key/, why);
    assert.deepEqual(await snapshot(), before, `${why}: nothing written`);
  };
  await refusedWith(async () => { const h = await threeKeys({ cover: false }); await mintedCover(h.ghId, { heldBy: "resident", claimedHandle: h.moss }); return h; },
    "a resident key claimed for ANOTHER handle of the same house");
  await refusedWith(async () => { const h = await threeKeys({ cover: false }); await mintedCover(h.ghId, { heldBy: "resident", claimedHandle: h.wren, expires: NOW - 5 }); return h; },
    "the exact claim, expired");
  await refusedWith(async () => { const h = await threeKeys({ cover: false }); await mintedCover(h.ghId, { heldBy: "resident", claimedHandle: null }); return h; },
    "a resident key with no claimed handle");
  await refusedWith(async () => {
    const h = await fresh(["wren"], { pinTo: 222 });
    await importSpec(`sk-wren=${h.slug}:${h.h("wren")}`);
    await mintedCover(222, { heldBy: "resident", claimedHandle: h.h("wren") });
    return { ...h, wren: h.h("wren") };
  }, "the exact claim, but the registry pins the handle to an account that is not this house's");
  await refusedWith(async () => {
    const h = await fresh(["wren"], { resident: ["someone-else"] });
    await importSpec(`sk-wren=${h.slug}:${h.h("wren")}`);
    await mintedCover(h.ghId, { heldBy: "resident", claimedHandle: h.h("wren") });
    return { ...h, wren: h.h("wren") };
  }, "the exact claim, but the registry does not list the handle as the house's resident");
});

// ── § L --gh-id: two keys hold exactly one handle (POS-805) ──────────────────

const GH_OLD = 4100700;
async function twoExact() {
  const w = await fresh(["aa", "bb"]);
  // the old key carries a gh_id; its replacement carries none: same household, same exact handle
  await importSpec(`sk-old=${w.slug}#${GH_OLD}:${w.h("aa")};sk-new=${w.slug}:${w.h("aa")};sk-bb=${w.slug}:${w.h("bb")}`);
  return w;
}

test("§ L1 no flag: two exact rows still refuse as ambiguous; a flag that matches nothing refuses; neither writes", async () => {
  const w = await twoExact();
  const before = await snapshot();
  const h = w.h("aa");
  const amb = await retireStaticKey(pool, { household: w.slug, handle: h });
  assert.equal(amb.status, "refused");
  assert.match(amb.reason, /2 static rows hold exactly this handle \(ambiguous\)/);
  const ambDry = await planRetire(pool, { household: w.slug, handle: h });
  assert.match(ambDry.reason, /2 static rows hold exactly this handle \(ambiguous\)/);
  for (const ghId of [999, 4100701]) {
    const r = await retireStaticKey(pool, { household: w.slug, handle: h, ghId });
    assert.equal(r.status, "refused");
    assert.match(r.reason, /none of the 2 static rows holding exactly this handle has that gh_id/);
    assert.equal((await planRetire(pool, { household: w.slug, handle: h, ghId })).status, "refused");
  }
  assert.deepEqual(await snapshot(), before, "no tombstone and no deletion for any refusal");
});

test("§ L2 --gh-id picks the old key (by its id) or the new key (none); the OTHER exact row is the cover; --dry and --mirror-only honour it", async () => {
  // the old key, by its gh_id
  const w = await twoExact();
  const file = fileDb();
  await seedFile(file, `sk-old=${w.slug}#${GH_OLD}:${w.h("aa")};sk-new=${w.slug}:${w.h("aa")};sk-bb=${w.slug}:${w.h("bb")}`);
  const dry = await planRetire(pool, { household: w.slug, handle: w.h("aa"), ghId: GH_OLD, file });
  assert.equal(dry.status, "dry");
  assert.equal(dry.cover, "another static key for this household and handle", "the new key is the cover; no minted key exists here");
  assert.equal(dry.target_has_gh_id, true);
  assert.equal(await kindOf("sk-old"), "static", "dry wrote nothing");
  const done = await retireStaticKey(pool, { household: w.slug, handle: w.h("aa"), ghId: GH_OLD, file });
  assert.equal(done.status, "retired", done.reason ?? done.message);
  assert.equal(await kindOf("sk-old"), RETIRED_KIND);
  assert.equal(await kindOf("sk-new"), "static", "the replacement stands");
  assert.equal(await resolves("sk-old"), false);
  assert.equal(await resolves("sk-new"), true);
  assert.equal(fileKind(file, "sk-old"), RETIRED_KIND);
  assert.equal(fileKind(file, "sk-new"), "static");
  // the file side honours the flag: a repair for the OTHER gh_id finds no tombstone, the right one repairs
  assert.equal((await mirrorOnly(pool, { household: w.slug, handle: w.h("aa"), ghId: null, file })).status, "refused");
  assert.equal((await mirrorOnly(pool, { household: w.slug, handle: w.h("aa"), ghId: GH_OLD, file })).status, "repaired");
  // and the old key now gone, one exact row is left: no flag is needed, but the wrong flag still refuses
  assert.equal((await retireStaticKey(pool, { household: w.slug, handle: w.h("aa"), ghId: GH_OLD })).status, "refused");

  // the new key, by "none"
  const w2 = await twoExact();
  const r = await retireStaticKey(pool, { household: w2.slug, handle: w2.h("aa"), ghId: null, file: fileDb() });
  assert.equal(r.status, "retired", r.reason ?? r.message);
  assert.equal(await kindOf("sk-new"), RETIRED_KIND);
  assert.equal(await kindOf("sk-old"), "static");
  assertNoSecret([dry, done, r], ["sk-old", "sk-new", "sk-bb"], "in a --gh-id result");
});

test("§ L3 two exact rows with the SAME gh_id stay ambiguous under the flag; the CLI parses --gh-id and refuses a bad value", async () => {
  const w = await fresh(["aa"]);
  await importSpec(`sk-1=${w.slug}#${GH_OLD}:${w.h("aa")};sk-2=${w.slug}#${GH_OLD}:${w.h("aa")}`);
  const r = await retireStaticKey(pool, { household: w.slug, handle: w.h("aa"), ghId: GH_OLD });
  assert.equal(r.status, "refused");
  assert.match(r.reason, /2 of the 2 static rows holding exactly this handle have that gh_id \(still ambiguous\)/);

  const w2 = await twoExact();
  const file = fileDb();
  const env = { ...process.env, OFFICE_PAPERWORK_STORE: "1", WORLD2_PG: "1", WORLD2_PG_URL: store.url("office_api"), OFFICE_KEYS: "" };
  const run = (...a) => spawnSync(process.execPath, [join(ROOT, "tools", "static-keys-retire.mjs"), "--oauth-db", file, "--household", w2.slug, "--handle", w2.h("aa"), ...a], { env, encoding: "utf8" });
  const said = [];
  const go = (...a) => { const x = run(...a); said.push(x.stdout, x.stderr); return x; };
  assert.equal(go("--dry").status, 1, "no flag: ambiguous, refused");
  assert.equal(go("--dry", "--gh-id", "12").status, 1, "a flag that matches nothing");
  assert.equal(go("--gh-id", "abc").status, 2, "not a number");
  assert.equal(go("--gh-id").status, 2, "no value");
  assert.equal(go("--gh-id", "--dry").status, 2, "a flag where the value goes");
  assert.equal(go("--dry", "--gh-id", String(GH_OLD)).status, 0, said.at(-1));
  assert.equal(await kindOf("sk-old"), "static", "dry wrote nothing");
  assert.equal(go("--gh-id", String(GH_OLD)).status, 0, said.at(-1));
  assert.equal(await kindOf("sk-old"), RETIRED_KIND);
  assertNoSecret(said.join("\n"), ["sk-old", "sk-new", "sk-bb"], "in a --gh-id CLI's output");
});
