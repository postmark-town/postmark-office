// paperwork-signin-survives.test.mjs — POS-271's gate, at the door: a signed-in
// agent stays signed in across the switch, with zero forced re-sign-ins.
//
// The switch, as prod takes it. Prod's office already reads sign-in from the
// store (OFFICE_PAPERWORK_STORE=1) and keeps oauth.db and roles.db beside it as
// the rollback's mirror. Then (1) it restarts on the release that deletes the
// mirror, (2) the two files leave the box (deploy/DEPLOY.md § The paperwork
// files leave the box) and it restarts again. This drives a real office on a
// real store through its own doors at every step, with a session minted the
// way a connector gets one: an authorization code (planted as the GitHub
// callback writes it), exchanged at /oauth/token with PKCE, so the office's
// own issueTokens writes the pair inside its own transaction.
//
//   S1  the deploy, the files still on disk: the session is minted and /me
//       answers it; neither file gains a row or changes a byte
//   S1b the same, restarted with both files held under an EXCLUSIVE lock by
//       another process: the office boots and answers the session without so
//       much as reading either file (any read fails at once under the lock; an
//       open that only reruns the schema changes no byte, measured 2026-11-03,
//       so S1's byte check alone could not see one)
//   S2  the files gone (moved aside by name, as the box step removes them),
//       the office restarted switched: the same access token answers /me as
//       the same identity, the refresh grant rotates, the new access token
//       answers, and neither file comes back
//   S3  the switch turned off by mistake, the files gone, the store holding the
//       session: the office refuses to boot (exit 78) and makes no file, rather
//       than boot on an empty oauth.db and answer the session 401
//   S4  the switch back on: both access tokens still answer, as the same identity
//   ZERO  across all of it, no answer to the session was a 401 or carried the
//       sign-in challenge (WWW-Authenticate), which a connector reads as
//       "signed out"
//
// On the code before this change, S1 (the mirror writes the pair into the
// file), S1b (the switched office reads oauth.db at boot, so under the lock it
// refuses to boot) and S3 (the office boots on an empty file and answers 401)
// are red, and so is ZERO; S2 and S4 are green on both, which is the claim that
// the sign-in road itself did not move.
//
// Synthetic, and only that: an invented session for the fixture town's
// keeminlee (id 999), on a store this file makes. Prod's own store and box are
// the operator's after-deploy check (DEPLOY.md), not this file's.
//
//   node --test test/paperwork-signin-survives.test.mjs

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

import { fixtureTown } from "./fixture.mjs";
import { indexStore } from "./helpers/office-under-test.mjs";
import { bootOnFreePort, freePort } from "./spawn-office.mjs";
import { openOauthDb, oauthSchema } from "../src/oauth.mjs";
import { openRolesDb, rolesSchema } from "../src/roles.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TMP = mkdtempSync(join(tmpdir(), "signin-survives-"));
const CLEANUP = [];
after(async () => {
  for (const f of CLEANUP.reverse()) await f().catch(() => {});
  try { rmSync(TMP, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* litter */ }
});

const b64sha = (s) => createHash("sha256").update(s).digest("base64url");
const now = () => Math.floor(Date.now() / 1000);
const identity = (me) => me && { household: me.household, handles: [...(me.handles ?? [])].sort(), verified_github: me.verified_github, key_kind: me.key_kind };
const fileRows = (path, table) => {
  const db = new DatabaseSync(path, { readOnly: true });
  try { return db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n; } finally { db.close(); }
};

// Another process holding each file under an EXCLUSIVE lock, as something else
// on the box might hold one (the nightly backup reads roles.db). While it holds,
// any read of either file fails at once with "database is locked" (node:sqlite
// waits 0 ms by default): an open that runs a schema, or any query, cannot pass
// unseen. `release()` commits nothing, closes, and waits for the process to go.
async function holdFiles(paths) {
  const c = spawn(process.execPath, ["-e", `
    const { DatabaseSync } = require("node:sqlite");
    const dbs = process.argv.slice(1).map((p) => new DatabaseSync(p));
    for (const db of dbs) db.exec("BEGIN EXCLUSIVE");
    console.log("locked");
    process.stdin.once("data", () => { for (const db of dbs) { db.exec("COMMIT"); db.close(); } process.exit(0); });`, ...paths],
  { stdio: ["pipe", "pipe", "inherit"] });
  await new Promise((ok, no) => {
    c.stdout.on("data", (d) => { if (String(d).includes("locked")) ok(); });
    c.on("exit", (n) => no(new Error(`the lock holder exited (${n}) before locking`)));
  });
  let released = null;
  return {
    release() {
      released ??= new Promise((ok) => {
        if (c.exitCode !== null || c.signalCode !== null) return ok();
        c.once("exit", ok);
        c.stdin.write("release\n");
      });
      return released;
    },
  };
}

// An invented client and redirect: nothing here is a real connector's.
const CLIENT = "cl_invented_for_pos271";
const REDIRECT = "http://127.0.0.1:1/invented-callback";

test("POS-271 · a signed-in agent stays signed in across the switch: the deploy, the files leaving, a mistaken switch-off", async (t) => {
  const ix = await indexStore(fixtureTown(), { db: "signin_survives" });
  CLEANUP.push(() => ix.stop());

  // The files, as the box holds them beside a switched office.
  const box = mkdtempSync(join(TMP, "box-"));
  const OAUTH = join(box, "oauth.db"), ROLES = join(box, "roles.db");
  openOauthDb(OAUTH).close();
  openRolesDb(ROLES).close();
  const bytesOf = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
  const filesBefore = [bytesOf(OAUTH), bytesOf(ROLES)];

  let said = ""; // every office's stderr, for a failure's message
  const env = (extra) => ({ ...process.env, ...ix.env, OFFICE_READ_WORKERS: "0", WORLD_GRAPH_NONE: "1", OFFICE_KEYS: "",
    TOWN_CLONE: join(TMP, "no-clone"), WORLD_CLONE: join(TMP, "no-world-clone"), TOWN_PUSH: "", ...extra });
  const args = (port) => [join(ROOT, "src", "server.mjs"), "--port", String(port), "--oauth-db", OAUTH, "--roles-db", ROLES];
  const stop = async (child) => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const gone = new Promise((ok) => child.once("exit", ok));
    child.kill();
    await gone;
  };
  const boot = async (extra) => {
    const o = await bootOnFreePort((port) => {
      const c = spawn(process.execPath, args(port), { env: env(extra), stdio: ["ignore", "pipe", "pipe"] });
      c.stderr.on("data", (x) => { said += String(x); });
      return c;
    });
    CLEANUP.push(() => stop(o.child));
    return { child: o.child, base: `http://127.0.0.1:${o.port}` };
  };

  // Every answer the office gave the session, in order: the instrument for ZERO.
  const answers = [];
  const me = async (base, token, step) => {
    const r = await fetch(`${base}/me`, { headers: { authorization: `Bearer ${token}` } });
    const body = await r.text();
    answers.push({ step, status: r.status, challenge: r.headers.get("www-authenticate") });
    let json = null;
    try { json = JSON.parse(body); } catch { /* not JSON */ }
    return { status: r.status, body, json };
  };
  const grant = async (base, form) => {
    const r = await fetch(`${base}/oauth/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(form).toString() });
    return { status: r.status, json: await r.json().catch(() => null) };
  };

  // The authorization code, as the GitHub callback writes it (oauth.mjs § the
  // callback's INSERT INTO codes), for an invented verifier.
  const verifier = randomBytes(32).toString("base64url");
  const code = randomBytes(16).toString("base64url");
  const api = await ix.store.connect("office_api");
  try {
    await api.query("INSERT INTO oauth_codes (code, json, expires) VALUES ($1, $2, $3)", [code,
      JSON.stringify({ client_id: CLIENT, redirect_uri: REDIRECT, code_challenge: b64sha(verifier), gh_id: 999, gh_login: "keeminlee" }), now() + 120]);
  } finally { await api.end(); }

  let session = null, first = null;

  // ── 1. the deploy: the release that deletes the mirror, the files still there
  const o1 = await boot({ OFFICE_PAPERWORK_STORE: "1" });
  await t.test("S1 · the deploy, the files still on disk: the session is minted at /oauth/token and answers /me, and neither file gains a row or changes a byte", async () => {
    const g = await grant(o1.base, { grant_type: "authorization_code", code, code_verifier: verifier, client_id: CLIENT, redirect_uri: REDIRECT });
    assert.equal(g.status, 200, `the code exchange at /oauth/token: ${g.status} ${JSON.stringify(g.json)}\n${said.slice(-1200)}`);
    session = { access: g.json.access_token, refresh: g.json.refresh_token };
    const m = await me(o1.base, session.access, "S1");
    assert.equal(m.status, 200, `the new session at /me: ${m.status} ${m.body.slice(0, 300)}`);
    first = identity(m.json);
    assert.deepEqual(first.verified_github, { login: "keeminlee", id: 999 }, "the session is the account the code was issued to");
    assert.equal(first.key_kind, "oauth");
    assert.equal(fileRows(OAUTH, "tokens"), 0, "the switched office wrote the session's pair into oauth.db: that is the rollback's mirror, which this change deletes");
    assert.equal(fileRows(OAUTH, "codes"), 0, "the switched office wrote into oauth.db's codes");
    assert.equal(fileRows(ROLES, "roles") + fileRows(ROLES, "role_audit"), 0, "the switched office wrote into roles.db");
    assert.deepEqual([bytesOf(OAUTH), bytesOf(ROLES)], filesBefore, "oauth.db and roles.db are byte-for-byte as the box held them: a switched office never writes either");
  });
  await stop(o1.child);

  // ── 1b. the same deploy, the files held: does the switched office READ them?
  // A byte check cannot see an open that only reruns the schema (that changes no
  // byte, measured 2026-11-03), so another process holds both files under an
  // EXCLUSIVE lock while a switched office boots and answers: any read of either
  // file fails at once. oauth.db is opened at boot and a failure there refuses
  // the boot (exit 78); roles.db is opened after it and a failure there is only
  // warned about (server.mjs § roles.db: an ungated office still boots), so a
  // read of roles.db shows as that warning.
  await t.test("S1b · a switched office restarted with both files held under a lock boots and answers the session without reading either file",
    { skip: session ? false : "S1 minted no session" }, async () => {
      const held = await holdFiles([OAUTH, ROLES]);
      CLEANUP.push(() => held.release());
      let o1b = null;
      try {
        // the control: the lock is live, so a read of either file fails while it holds
        for (const [path, schema] of [[OAUTH, oauthSchema], [ROLES, rolesSchema]]) {
          const db = new DatabaseSync(path);
          try { assert.throws(() => schema(db), /locked|busy/i, `the lock on ${path} refuses a read: the instrument is live`); }
          finally { db.close(); }
        }
        const saidBefore = said.length;
        o1b = await boot({ OFFICE_PAPERWORK_STORE: "1" });
        const m = await me(o1b.base, session.access, "S1b");
        assert.equal(m.status, 200, `the session, the files held: ${m.status} ${m.body.slice(0, 300)}`);
        assert.deepEqual(identity(m.json), first, "the same identity");
        assert.doesNotMatch(said.slice(saidBefore), /roles\.db could not be opened/, "the switched office tried to open roles.db");
      } finally {
        if (o1b) await stop(o1b.child);
        await held.release();
      }
      assert.deepEqual([bytesOf(OAUTH), bytesOf(ROLES)], filesBefore, "and both files are byte-for-byte as the box held them");
    });

  // ── 2. the files leave the box: removed by name there, moved aside by name here
  const removed = mkdtempSync(join(TMP, "removed-"));
  for (const f of readdirSync(box)) {
    for (let i = 0; ; i++) {
      try { renameSync(join(box, f), join(removed, f)); break; }
      catch (e) { if (i >= 20 || !["EBUSY", "EPERM"].includes(e.code)) throw e; await new Promise((ok) => setTimeout(ok, 100)); }
    }
  }
  assert.equal(existsSync(OAUTH) || existsSync(ROLES), false, "the precondition: both files are gone from the paths the office is given");

  const o2 = await boot({ OFFICE_PAPERWORK_STORE: "1" });
  await t.test("S2 · the files gone, the office restarted switched: the same session answers as the same identity, refreshes, and no file comes back",
    { skip: session ? false : "S1 minted no session" }, async () => {
      const m = await me(o2.base, session.access, "S2");
      assert.equal(m.status, 200, `the same access token after the files left: ${m.status} ${m.body.slice(0, 300)}`);
      assert.deepEqual(identity(m.json), first, "the same identity as before the files left");
      const g = await grant(o2.base, { grant_type: "refresh_token", refresh_token: session.refresh, client_id: CLIENT });
      assert.equal(g.status, 200, `the refresh grant after the files left: ${g.status} ${JSON.stringify(g.json)}`);
      session = { ...session, access2: g.json.access_token, refresh: g.json.refresh_token };
      const m2 = await me(o2.base, session.access2, "S2 refreshed");
      assert.equal(m2.status, 200, `the refreshed access token: ${m2.status} ${m2.body.slice(0, 300)}`);
      assert.deepEqual(identity(m2.json), first, "the refreshed token is the same identity");
      assert.equal(existsSync(OAUTH), false, "a switched office never makes oauth.db");
      assert.equal(existsSync(ROLES), false, "a switched office never makes roles.db");
    });
  await stop(o2.child);

  // ── 3. the switch turned off by mistake, with the files gone
  await t.test("S3 · the switch off by mistake, the files gone, the store holding the session: the office refuses to boot rather than sign the session out",
    { skip: session?.access2 ? false : "S2 refreshed no session" }, async () => {
      const port = await freePort();
      const c = spawn(process.execPath, args(port), { env: env({ OFFICE_PAPERWORK_STORE: "" }), stdio: ["ignore", "pipe", "pipe"] });
      let out = "";
      const outcome = await new Promise((ok) => {
        const timer = setTimeout(() => ok({ hung: true }), 60_000);
        const hear = (x) => { out += String(x); if (/listening on :\d+/.test(out)) { clearTimeout(timer); ok({ listening: true }); } };
        c.stdout.on("data", hear);
        c.stderr.on("data", (x) => { out += String(x); });
        c.on("exit", (n) => { clearTimeout(timer); ok({ code: n }); });
      });
      let asked = null;
      if (!("code" in outcome)) {
        if (outcome.listening) asked = await me(`http://127.0.0.1:${port}`, session.access2, "S3");
        await stop(c);
      }
      assert.equal(outcome.code, 78, asked
        ? `the office booted with the switch off on an empty oauth.db and answered the signed-in session ${asked.status}${asked.status === 401 ? " with the sign-in challenge: a forced re-sign-in" : ""}`
        : `the office must refuse to boot (EX_CONFIG, 78): ${JSON.stringify(outcome)} ${out.slice(-800)}`);
      assert.match(out, /OFFICE_PAPERWORK_STORE is off/, "the refusal names the flag");
      assert.match(out, /the store holds \d+ sign-ins/, "the refusal says the store holds the town's sign-ins");
      assert.equal(existsSync(OAUTH), false, "and it made no oauth.db");
    });

  // ── 4. the switch back on
  const o4 = await boot({ OFFICE_PAPERWORK_STORE: "1" });
  await t.test("S4 · the switch back on: both access tokens still answer, as the same identity",
    { skip: session?.access2 ? false : "S2 refreshed no session" }, async () => {
      for (const [what, token] of [["the first access token", session.access], ["the refreshed access token", session.access2]]) {
        const m = await me(o4.base, token, `S4 ${what}`);
        assert.equal(m.status, 200, `${what}: ${m.status} ${m.body.slice(0, 300)}`);
        assert.deepEqual(identity(m.json), first, `${what} is the same identity`);
      }
    });
  await stop(o4.child);

  await t.test("ZERO · no answer to the session, at any step, was a 401 or carried the sign-in challenge", () => {
    assert.ok(answers.length >= 5, `the session was asked at every step: ${JSON.stringify(answers)}`);
    const signedOut = answers.filter((a) => a.status === 401 || a.challenge);
    assert.deepEqual(signedOut, [], `forced re-sign-ins: ${JSON.stringify(signedOut)}`);
  });
});
