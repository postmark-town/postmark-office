// static-keys.test.mjs — the office's static keys are store rows (POS-352 part 2).
//
// RULED (Darko, 2026-10-06, 2a): static office keys become a `static` kind with
// an explicit handles column and an explicit household column, imported from
// OFFICE_KEYS by hash, nothing re-issued, no token printed.
//
// The brief's pin: the same request with the same key resolves to the same
// household and handles as before, for a scoped row (two handles out of a
// house), a whole-house row, a row with a gh_id and one without. "Before" is
// not paraphrased here: BOOT_PARSE below is the parse server.mjs ran at boot
// until this change, byte for byte, and every row is held to what it built.
//
//   § 1  the store row resolves to the boot parse's object, on the file
//   § 2  and on a real Postgres, through 070 and office_api's own grants
//   § 3  the import: dry writes nothing, idempotent, an edit replaces, a
//        foreign hash refuses everything, it never revokes
//   § 4  the import's CLI prints no key and no part of a hash
//   § 5  the doors: /me answers each key as identityOf answered the boot
//        parse's object, and OFFICE_KEYS in the env is not read

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";

import { oauthSchema, openOauthDb } from "../src/oauth.mjs";
import { paperOnPool, paperworkPoolTypes, asPaper } from "../src/paperwork.mjs";
import { parseOfficeKeys, staticLookup, importStaticKeys } from "../src/static-keys.mjs";
import { identityOf } from "../src/queries.mjs";
import { startStore } from "./helpers/embedded-store.mjs";
import { indexStore } from "./helpers/office-under-test.mjs";
import { fixtureDb } from "./fixture.mjs";
import { bootOnFreePort } from "./spawn-office.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TMP = mkdtempSync(join(tmpdir(), "postmark-static-keys-"));
const CLEANUP = [];
after(async () => {
  for (const f of CLEANUP.reverse()) await f().catch(() => {});
  rmSync(TMP, { recursive: true, force: true });
});

// ── THE ORACLE: server.mjs § keys, as it stood before POS-352 (7f38f72) ──────
function BOOT_PARSE(spec) {
  const KEYS = new Map(); // key -> { household, handles: Set, ghId?: number }
  for (const entry of (spec ?? "").split(";").filter(Boolean)) {
    const m = /^([^=]+)=([^:]+):(.+)$/.exec(entry.trim());
    if (!m) continue;
    const [, token, householdField, handleList] = m;
    const hash = householdField.lastIndexOf("#");
    const household = hash === -1 ? householdField : householdField.slice(0, hash);
    const idPart = hash === -1 ? "" : householdField.slice(hash + 1).trim();
    const ghId = /^[1-9][0-9]*$/.test(idPart) ? Number(idPart) : null;
    KEYS.set(token, {
      household,
      handles: new Set(handleList.split(",").map((s) => s.trim())),
      ...(ghId === null ? {} : { ghId }),
    });
  }
  return KEYS;
}

// Every shape the brief names, and the edges the boot parse had.
const SCOPED = "sk-scoped-two-of-a-house";        // two handles out of the founder's house
const WHOLE = "sk-whole-house";                    // every handle of a house
const PINNED = "sk-pinned";                        // #<gh_id>: may hold a role, may mint
const UNPINNED = "sk-unpinned";                    // no id: holds no role
const BAD_PIN = "sk-bad-pin";                      // a '#' with no numeric id: pins nothing
const SPACED = "sk-spaced";                        // whitespace around the entry and the handles
const TWICE = "sk-twice";                          // named twice: the later entry wins
const SPEC = [
  `${SCOPED}=keemin:wright,postmaster`,
  `${WHOLE}=limen-house:limen,vesper,corwin`,
  `${PINNED}=keemin#583231:wright`,
  `${UNPINNED}=the-town:bugcatcher`,
  `${BAD_PIN}=keemin#abc:rei`,
  `  ${SPACED}=fox-hearth: alden , corwin  `,
  `${TWICE}=keemin:wright`,
  "not an entry at all",
  `${TWICE}=the-town:ferry,iris`,
].join(";");
const TOKENS = [SCOPED, WHOLE, PINNED, UNPINNED, BAD_PIN, SPACED, TWICE];
const BEFORE = BOOT_PARSE(SPEC);

const sha = (s) => createHash("sha256").update(s).digest("base64url");
/** The credential as a door reads it; the handles' ORDER too (a key's first handle is read as its default). */
const view = (k) => k && { ...k, handles: [...k.handles] };

const fileDb = (name) => {
  const db = new DatabaseSync(join(TMP, name));
  oauthSchema(db);
  CLEANUP.push(async () => db.close());
  return db;
};

test("§ 0 the oracle is what the brief describes: a scoped row, a whole house, a pin and none", () => {
  assert.equal(BEFORE.size, TOKENS.length);
  assert.deepEqual([...BEFORE.get(SCOPED).handles], ["wright", "postmaster"]);
  assert.equal(BEFORE.get(PINNED).ghId, 583231);
  assert.equal("ghId" in BEFORE.get(UNPINNED), false);
  assert.equal("ghId" in BEFORE.get(BAD_PIN), false);
  assert.deepEqual([...BEFORE.get(SPACED).handles], ["alden", "corwin"]);
  assert.equal(BEFORE.get(TWICE).household, "the-town");
  // and the module's parse is the boot parse, entry for entry
  const { keys, skipped, warnings } = parseOfficeKeys(SPEC);
  assert.deepEqual([...keys.keys()], [...BEFORE.keys()]);
  assert.equal(skipped, 1, "the one malformed entry is counted");
  assert.equal(warnings.length, 1, "the '#' with no id is named");
});

test("§ 1 on the file: every key resolves to exactly the object the boot parse built", async () => {
  const db = fileDb("s1-oauth.db");
  const out = await importStaticKeys(db, SPEC);
  assert.equal(out.added, TOKENS.length);
  for (const t of TOKENS)
    assert.deepStrictEqual(view(await staticLookup(db, t)), view(BEFORE.get(t)), `key ${t}`);
  assert.equal(await staticLookup(db, "a-key-nobody-issued"), null);
  // A minted household key's row is not a static key, whatever its hash.
  db.prepare("INSERT INTO tokens (token_hash, kind, gh_id, gh_login, client_id, expires, created) VALUES (?, 'household', 1, 'x', NULL, ?, ?)")
    .run(sha("pmk_minted"), 9e9, 1);
  assert.equal(await staticLookup(db, "pmk_minted"), null);
});

test("§ 2 on a real Postgres: 070's columns, office_api's grants, the same objects", async () => {
  const store = await startStore({ db: "static_keys_test" });
  CLEANUP.push(() => store.stop());
  const pg = (await import("pg")).default;
  const pool = new pg.Pool({ connectionString: store.url("office_api"), max: 2, types: paperworkPoolTypes(pg) });
  CLEANUP.push(() => pool.end());
  const paper = paperOnPool(pool);
  const first = await importStaticKeys(paper, SPEC);
  assert.equal(first.added, TOKENS.length);
  for (const t of TOKENS)
    assert.deepStrictEqual(view(await staticLookup(paper, t)), view(BEFORE.get(t)), `key ${t} on the store`);
  // an edit is a delete and an insert: office_api holds no UPDATE on oauth_tokens (031)
  const edited = await importStaticKeys(paper, SPEC.replace(`${SCOPED}=keemin:wright,postmaster`, `${SCOPED}=keemin:wright`));
  assert.equal(edited.replaced, 1);
  assert.deepEqual([...(await staticLookup(paper, SCOPED)).handles], ["wright"]);
  const rows = (await pool.query("SELECT kind, gh_login, client_id, expires FROM oauth_tokens WHERE kind = 'static'")).rows;
  assert.equal(rows.length, TOKENS.length);
  assert.ok(rows.every((r) => r.gh_login === null && r.client_id === null && r.expires === null),
    "no sign-in stands behind a static row, and it does not expire");
  // the sweep (oauth.mjs § sweep) never reaches one
  await paper.run("DELETE FROM tokens WHERE expires < ?", Math.floor(Date.now() / 1000));
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM oauth_tokens WHERE kind = 'static'")).rows[0].n, TOKENS.length);
});

test("§ 3 the import: dry writes nothing, a re-run changes nothing, an edit replaces, it never revokes", async () => {
  const db = fileDb("s3-oauth.db");
  const count = () => db.prepare("SELECT count(*) AS n FROM tokens WHERE kind = 'static'").get().n;
  const dry = await importStaticKeys(db, SPEC, { dry: true });
  assert.deepEqual([dry.added, dry.replaced, dry.unchanged, dry.refused], [TOKENS.length, 0, 0, 0]);
  assert.equal(count(), 0, "a dry run writes nothing");
  await importStaticKeys(db, SPEC);
  const again = await importStaticKeys(db, SPEC);
  assert.deepEqual([again.added, again.replaced, again.unchanged], [0, 0, TOKENS.length]);
  assert.equal(count(), TOKENS.length);
  assert.deepEqual(again.households, ["fox-hearth", "keemin", "limen-house", "the-town"]);
  // the env row loses a key: the import counts the row and leaves it
  const fewer = await importStaticKeys(db, `${SCOPED}=keemin:wright,postmaster`);
  assert.equal(fewer.not_in_spec, TOKENS.length - 1);
  assert.equal(count(), TOKENS.length, "removing a key is a decision, never an import's side effect");
  // a pin added to an existing key replaces its row
  const pinned = await importStaticKeys(db, `${UNPINNED}=the-town#301406700:bugcatcher`);
  assert.equal(pinned.replaced, 1);
  assert.equal((await staticLookup(db, UNPINNED)).ghId, 301406700);
});

test("§ 3b a key whose hash belongs to another kind of token refuses the whole import", async () => {
  const db = fileDb("s3b-oauth.db");
  db.prepare("INSERT INTO tokens (token_hash, kind, gh_id, gh_login, client_id, expires, created) VALUES (?, 'access', 7, 'someone', 'c', ?, ?)")
    .run(sha("collides"), 9e9, 1);
  const out = await importStaticKeys(db, `${SCOPED}=keemin:wright;collides=keemin:wright`);
  assert.equal(out.refused, 1);
  assert.equal(db.prepare("SELECT count(*) AS n FROM tokens WHERE kind = 'static'").get().n, 0, "nothing at all was written");
  assert.equal(db.prepare("SELECT kind FROM tokens WHERE token_hash = ?").get(sha("collides")).kind, "access", "and the other token is untouched");
});

test("§ 4 the CLI prints counts and households, never a key or any part of a hash", () => {
  const path = join(TMP, "s4-oauth.db");
  const run = (args, env) => spawnSync(process.execPath, [join(ROOT, "tools", "static-keys-import.mjs"), "--oauth-db", path, ...args], {
    env: { ...process.env, OFFICE_PAPERWORK_STORE: "", ...env }, encoding: "utf8" });
  const none = run(["--dry"], { OFFICE_KEYS: "" });
  assert.equal(none.status, 2);
  assert.match(none.stderr, /OFFICE_KEYS is not set/);
  for (const args of [["--dry"], [], [], ["--json"]]) {
    const r = run(args, { OFFICE_KEYS: SPEC });
    assert.equal(r.status, 0, r.stderr);
    const said = r.stdout + r.stderr;
    for (const t of TOKENS) {
      assert.equal(said.includes(t), false, `the key ${t} was printed`);
      const h = sha(t);
      for (let i = 0; i + 6 <= h.length; i++) assert.equal(said.includes(h.slice(i, i + 6)), false, `a piece of ${t}'s hash was printed`);
    }
    assert.match(said, /households: fox-hearth, keemin, limen-house, the-town|"households"/);
  }
  const db = new DatabaseSync(path, { readOnly: true });
  try { assert.equal(db.prepare("SELECT count(*) AS n FROM tokens WHERE kind = 'static'").get().n, TOKENS.length); }
  finally { db.close(); }
});

test("§ 5 the doors: /me answers each key as it did, and OFFICE_KEYS in the env is not read", async () => {
  const dbPath = join(TMP, "s5-fixture.db");
  fixtureDb(dbPath).close();
  const ix = await indexStore(dbPath, { db: "static_keys_doors" });
  CLEANUP.push(() => ix.stop());
  const oauthPath = join(TMP, "s5-oauth.db");
  openOauthDb(oauthPath).close();
  const seed = new DatabaseSync(oauthPath);
  try { await importStaticKeys(asPaper(seed), SPEC); } finally { seed.close(); }
  // A second office whose ONLY keys are in the env: none of them may answer.
  const envOnly = join(TMP, "s5-env-only-oauth.db");
  openOauthDb(envOnly).close();
  const stderrOf = new Map(); // child -> what it said on stderr, from its first byte
  const boot = (oauthDb, extra = {}) => bootOnFreePort((port) => {
    const c = spawn(process.execPath, [join(ROOT, "src", "server.mjs"),
      "--port", String(port), "--db", dbPath, "--oauth-db", oauthDb, "--roles-db", `${oauthDb}.roles.db`], {
      env: { ...process.env, ...ix.env, WORLD_GRAPH_NONE: "1", OFFICE_KEYS: "", TOWN_CLONE: join(TMP, "no-clone"),
        WORLD_CLONE: join(TMP, "no-world-clone"), TOWN_PUSH: "", ...extra },
      stdio: ["ignore", "pipe", "pipe"],
    });
    stderrOf.set(c, "");
    c.stderr.on("data", (d) => stderrOf.set(c, stderrOf.get(c) + String(d)));
    return c;
  });
  const a = await boot(oauthPath);
  CLEANUP.push(async () => a.child.kill());
  const b = await boot(envOnly, { OFFICE_KEYS: SPEC });
  CLEANUP.push(async () => b.child.kill());
  const me = async (port, key) => {
    const r = await fetch(`http://127.0.0.1:${port}/me`, { headers: { authorization: `Bearer ${key}` } });
    return { status: r.status, body: await r.json() };
  };
  for (const t of TOKENS) {
    const r = await me(a.port, t);
    assert.equal(r.status, 200, `key ${t}`);
    const want = identityOf(BEFORE.get(t));
    for (const field of ["household", "handles", "visitor", "verified_github", "key_kind"])
      assert.deepStrictEqual(r.body[field], want[field], `key ${t}: ${field}`);
    const off = await me(b.port, t);
    assert.equal(off.status, 401, `key ${t} answered from the env at an office whose store does not hold it`);
  }
  // The env line is noticed, said once at boot, and nothing in it is printed.
  const said = stderrOf.get(b.child);
  assert.match(said, /OFFICE_KEYS is set but the office no longer reads it/);
  for (const t of TOKENS) assert.equal(said.includes(t), false, `the boot printed the key ${t}`);
  assert.doesNotMatch(stderrOf.get(a.child), /OFFICE_KEYS/, "an office with no env line says nothing about it");
});
