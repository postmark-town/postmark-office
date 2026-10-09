// bearer-store-outage.test.mjs — an outage never tells a signed-in client it is
// signed out (POS-480, the door's half; ruled by Wright 2026-10-09).
//
// On 10-09, with the store in crash recovery, every connector's bearer lookup
// threw. server.mjs § handle served a lookup that threw as anonymous, so /mcp
// answered 401 with the WWW-Authenticate sign-in challenge, and residents'
// connectors came back "invalidated". Now a lookup that throws answers 503 with
// Retry-After and the named defect, at every door, never the challenge.
//
// A real office, switched to the paperwork store (OFFICE_PAPERWORK_STORE=1), on
// a store of this file's own that the test stops and starts:
//
//   B1  the store up: the signed-in token answers 200 at /me; no bearer, an
//       unknown token and an expired token stay anonymous (401 at /me, which
//       needs a key, with the challenge), and a public read with no bearer is 200
//   B2  the store stopped: the same token at /me and at /mcp answers 503 with
//       Retry-After and the named defect, and no WWW-Authenticate
//   B3  the store back: the same token answers 200 at /me again
//
//   node --test test/bearer-store-outage.test.mjs

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { fixtureDb } from "./fixture.mjs";
import { indexStore } from "./helpers/office-under-test.mjs";
import { bootOnFreePort } from "./spawn-office.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TMP = mkdtempSync(join(tmpdir(), "bearer-outage-"));
const CLEANUP = [];
after(async () => {
  for (const f of CLEANUP.reverse()) await f().catch(() => {});
  try { rmSync(TMP, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* litter */ }
});

const sha = (s) => createHash("sha256").update(s).digest("base64url");
const now = () => Math.floor(Date.now() / 1000);
const DEFECT = "the town's store is unreachable; your sign-in is intact, retry";

test("POS-480 · a bearer whose lookup cannot reach the store answers 503 with Retry-After, never the sign-in challenge", async (t) => {
  const dbPath = join(TMP, "fixture.db");
  fixtureDb(dbPath).close();
  const ix = await indexStore(dbPath, { db: "bearer_outage", own: true });
  CLEANUP.push(() => ix.stop());

  // A signed-in connector's access token, and an expired one, as issueTokens writes them.
  const live = randomBytes(32).toString("base64url");
  const expired = randomBytes(32).toString("base64url");
  const api = await ix.store.connect("office_api");
  try {
    const ins = "INSERT INTO oauth_tokens (token_hash, kind, gh_id, gh_login, client_id, expires, created) VALUES ($1, 'access', 999, 'keeminlee', 'cl', $2, $3)";
    await api.query(ins, [sha(live), now() + 3600, now()]);
    await api.query(ins, [sha(expired), now() - 60, now() - 3600]);
  } finally { await api.end(); }

  let said = ""; // the office's stderr, for a failure's message
  const office = await bootOnFreePort((port) => { const c = spawn(process.execPath, [join(ROOT, "src", "server.mjs"),
    "--port", String(port), "--db", dbPath, "--oauth-db", join(TMP, "oauth.db"), "--roles-db", join(TMP, "roles.db")], {
    env: { ...process.env, ...ix.env, OFFICE_PAPERWORK_STORE: "1", OFFICE_READ_WORKERS: "0", WORLD_GRAPH_NONE: "1", OFFICE_KEYS: "",
      TOWN_CLONE: join(TMP, "no-clone"), WORLD_CLONE: join(TMP, "no-world-clone"), TOWN_PUSH: "" },
    stdio: ["ignore", "pipe", "pipe"],
  }); c.stderr.on("data", (x) => { said += String(x); }); return c; });
  CLEANUP.push(async () => office.child.kill());
  const base = `http://127.0.0.1:${office.port}`;
  const me = (token) => fetch(`${base}/me`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
  const mcp = (token) => fetch(`${base}/mcp`, {
    method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });

  await t.test("B1 · the store up: the token answers; no bearer, unknown and expired stay anonymous", async () => {
    const ok = await me(live);
    assert.equal(ok.status, 200, `the signed-in token at /me: ${ok.status} ${await ok.clone().text()}`);
    for (const [what, token] of [["no bearer", null], ["an unknown token", "not-a-token"], ["an expired token", expired]]) {
      const r = await me(token);
      assert.equal(r.status, 401, `${what} is anonymous, and /me needs a key`);
      assert.ok(r.headers.get("www-authenticate"), `${what}: anonymous at a keyed door still gets the challenge`);
    }
    assert.equal((await fetch(`${base}/town`)).status, 200, "a public read with no bearer is answered");
  });

  await ix.store.pause();
  try {
    await t.test("B2 · the store stopped: the same token gets 503, Retry-After and the named defect, and no WWW-Authenticate", async () => {
      for (const [door, call] of [["/me", () => me(live)], ["/mcp", () => mcp(live)]]) {
        const r = await call();
        const body = await r.text();
        assert.equal(r.status, 503, `${door} during the outage: ${r.status} ${body.slice(0, 200)}
${said.slice(-1500)}`);
        assert.equal(r.headers.get("www-authenticate"), null, `${door}: an outage must never send the sign-in challenge`);
        assert.ok(Number(r.headers.get("retry-after")) > 0, `${door}: the 503 says when to retry`);
        assert.equal(JSON.parse(body).defect, DEFECT, `${door}: the defect names the outage, not the sign-in`);
      }
    });
  } finally { await ix.store.resume(); }

  await t.test("B3 · the store back: the same token answers 200 again", async () => {
    let r;
    for (let i = 0; i < 20; i++) { // the office's pools reconnect on their next ask
      r = await me(live);
      if (r.status === 200) break;
      await new Promise((ok) => setTimeout(ok, 250));
    }
    assert.equal(r.status, 200, `the same token after the outage: ${r.status} ${await r.text()}
${said.slice(-1500)}`);
  });
});
