// paperwork-gone-boot-guard.test.mjs — once the paperwork files are deleted, the
// switch off is no rollback (POS-271, Wright 2026-10-09).
//
// After the deletion, an office booted with OFFICE_PAPERWORK_STORE off would
// create an empty oauth.db and sign the whole town out without a word. So the
// writer refuses to boot when its switch is off, its oauth.db is missing, and
// the store holds sign-ins, and the refusal names the flag and the missing
// files. A new office (its store holds no sign-ins) and an office whose file is
// there still boot as before, and so does a switched one. A store it cannot
// ask is a refusal too: it then cannot tell the deleted box from a new office.
//
//   G1  switch off, files missing, the store holds sign-ins: exit 78, naming
//       OFFICE_PAPERWORK_STORE, both missing files and the count
//   G2  switch off, files missing, the store holds none: boots (a new office)
//   G3  switch on, files missing, the store holds sign-ins: boots
//   G4  switch off, files missing, a store that cannot be reached: exit 78,
//       saying the store could not be asked, and no file is created
//
// Ported from office #450 (2e9851f) onto w46's helpers: the office's town
// index is a store seeded from the fixture town (office-under-test.mjs §
// indexStore, POS-656), so there is no --db.
//
//   node --test test/paperwork-gone-boot-guard.test.mjs

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { fixtureTown } from "./fixture.mjs";
import { indexStore } from "./helpers/office-under-test.mjs";
import { bootOnFreePort, freePort } from "./spawn-office.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TMP = mkdtempSync(join(tmpdir(), "paperwork-gone-"));
const CLEANUP = [];
after(async () => {
  for (const f of CLEANUP.reverse()) await f().catch(() => {});
  try { rmSync(TMP, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* litter */ }
});

const officeArgs = (port, dir) => [join(ROOT, "src", "server.mjs"), "--port", String(port),
  "--oauth-db", join(dir, "oauth.db"), "--roles-db", join(dir, "roles.db")];
const officeEnv = (env, extra) => ({ ...process.env, ...env, OFFICE_READ_WORKERS: "0", WORLD_GRAPH_NONE: "1", OFFICE_KEYS: "",
  TOWN_CLONE: join(TMP, "no-clone"), WORLD_CLONE: join(TMP, "no-world-clone"), TOWN_PUSH: "", ...extra });

// A store holding `tokens` sign-ins, written as issueTokens writes them. The
// hashes are invented and match no key anyone holds.
async function storeWith(name, tokens) {
  const ix = await indexStore(fixtureTown(), { db: name });
  CLEANUP.push(() => ix.stop());
  const api = await ix.store.connect("office_api");
  try {
    for (let i = 0; i < tokens; i++)
      await api.query("INSERT INTO oauth_tokens (token_hash, kind, gh_id, gh_login, client_id, expires, created) VALUES ($1, 'access', 999, 'keeminlee', 'cl', $2, $2)",
        [`invented-hash-${i}`, Math.floor(Date.now() / 1000) + 3600]);
  } finally { await api.end(); }
  return ix;
}

const freshDir = (n) => mkdtempSync(join(TMP, `${n}-`)); // no oauth.db, no roles.db

// Spawn an office that is expected to refuse; answer its exit code and what it said.
async function refusal(env, dir) {
  const port = await freePort();
  const c = spawn(process.execPath, officeArgs(port, dir), { env, stdio: ["ignore", "pipe", "pipe"] });
  let said = "";
  c.stdout.on("data", (x) => { said += String(x); });
  c.stderr.on("data", (x) => { said += String(x); });
  const code = await new Promise((ok) => { const t = setTimeout(() => { c.kill(); ok("timeout"); }, 60_000); c.on("exit", (n) => { clearTimeout(t); ok(n); }); });
  return { code, said };
}

test("G1 · switch off, the files gone, the store holding sign-ins: the office refuses to boot and names why", async () => {
  const ix = await storeWith("gone_g1", 3);
  const dir = freshDir("g1");
  const { code, said } = await refusal(officeEnv(ix.env, { OFFICE_PAPERWORK_STORE: "" }), dir);
  assert.equal(code, 78, `the office must refuse (EX_CONFIG), got ${code}: ${said.slice(-800)}`);
  assert.match(said, /OFFICE_PAPERWORK_STORE is off/, "the refusal names the flag");
  assert.match(said, /oauth\.db and .*roles\.db is missing/, "the refusal names both missing files");
  assert.match(said, /the store holds 3 sign-ins/, "the refusal says what the store holds");
  assert.equal(existsSync(join(dir, "oauth.db")), false, "and it created no oauth.db on its way out");
});

test("G2 · switch off, the files missing, a store with no sign-ins: a new office boots as before", async () => {
  const ix = await storeWith("gone_g2", 0);
  const o = await bootOnFreePort((port) => spawn(process.execPath, officeArgs(port, freshDir("g2")), { env: officeEnv(ix.env, { OFFICE_PAPERWORK_STORE: "" }), stdio: ["ignore", "pipe", "pipe"] }));
  CLEANUP.push(async () => o.child.kill());
  assert.equal((await fetch(`http://127.0.0.1:${o.port}/town`)).status, 200);
});

test("G3 · switch on, the files missing, the store holding sign-ins: the switched office boots", async () => {
  const ix = await storeWith("gone_g3", 2);
  const o = await bootOnFreePort((port) => spawn(process.execPath, officeArgs(port, freshDir("g3")), { env: officeEnv(ix.env, { OFFICE_PAPERWORK_STORE: "1" }), stdio: ["ignore", "pipe", "pipe"] }));
  CLEANUP.push(async () => o.child.kill());
  assert.equal((await fetch(`http://127.0.0.1:${o.port}/town`)).status, 200);
});

test("G4 · switch off, the files missing, a store that cannot be reached: a refusal, never a guess", async () => {
  const dir = freshDir("g4");
  // Port 9 on loopback answers nothing (the town-index files' cut-off store).
  const dead = { WORLD2_PG: "1", WORLD2_PG_URL: "postgres://office_api:x@127.0.0.1:9/none" };
  const { code, said } = await refusal(officeEnv(dead, { OFFICE_PAPERWORK_STORE: "" }), dir);
  assert.equal(code, 78, `the office must refuse when it cannot ask the store, got ${code}: ${said.slice(-800)}`);
  assert.match(said, /the store could not be asked whether it holds the town's sign-ins/, "the refusal says the store could not be asked");
  assert.equal(existsSync(join(dir, "oauth.db")), false, "and it created no oauth.db on its way out");
});
