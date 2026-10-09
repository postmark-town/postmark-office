// oauth-store-outage.test.mjs — a store outage never signs anyone out (POS-480).
//
// On 10-09 the box's disk filled and Postgres went into crash recovery for
// hours. Two things then logged residents' connectors out:
//
//   1. THE SWEEP GATED THE ROUTE. Every oauth request ran the housekeeping
//      deletes first, so with the store down the token endpoint answered a 500
//      before it read the request, and a connector's refresh read as final.
//   2. THE ROTATION WAS TWO WRITES. The refresh deleted the old refresh token,
//      committed, and only then issued the new pair. The store took deletes it
//      then could not follow with inserts (the journal: 4 DELETE, 1 INSERT), so
//      a resident whose delete landed held no refresh token at all.
//
//   R0  the sweep still deletes an expired row, after the answer, and runs at
//       most once a minute (it must be the file's first oauth request: the
//       minute is the module's own clock)
//
// Each test runs on a real Postgres of this file's own (never the tree's shared
// server, which every file in the tree uses), which it stops and starts:
//
//   R1  the store is down: a refresh answers 503 with Retry-After, never
//       invalid_grant; discovery still answers; once the store is back, the
//       SAME refresh token works, and the rotation retires it
//   R2  the store goes down mid-rotation, right after it took the old token's
//       DELETE: the answer is 503, and once the store is back the SAME refresh
//       token still works (the delete was rolled back with the insert)
//   R3  a code exchange the store could not finish leaves the code for the
//       retry; a refused code is still burned (single use, even on failure)
//   R4  two refreshes of one token, both past their SELECT before either
//       deletes: exactly one 200 (the DELETE's own row count is the claim)
//   R5  a malformed grant (a non-string field, a NUL, a body that is no object)
//       is the client's: 400 invalid_request, never the outage's 503
//
//   node --test test/oauth-store-outage.test.mjs
//
// A SERVER OF ITS OWN IS ONE MORE POSTGRES PER RUN (review of #449). If the file
// dies before after() (a killed run, an uncaught error), that server is left
// running under the temp dir: `node G:/Postmark/pool/pg.mjs reap` stops it, and
// run-heavy reaps before every slot (POS-479).

import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createHash, randomBytes } from "node:crypto";

import { startStore } from "./helpers/embedded-store.mjs";
import { handleOauth } from "../src/oauth.mjs";
import { paperOnPool, paperworkPoolTypes } from "../src/paperwork.mjs";

const sha = (s) => createHash("sha256").update(s).digest("base64url");
const now = () => Math.floor(Date.now() / 1000);

let store, pool, paper, server, BASE;

// Hooks on the pool the paper writes through: `after(re, fn, times)` runs
// `fn()` once a statement matching `re` has run (the store TOOK it) and before
// the caller sees the answer, for the next `times` matches. It hooks both roads
// a paper writes by: a bare `pool.query` (autocommit) and a transaction's client.
function hooksOn(p) {
  const armed = [];
  const hook = async (sql, answer) => {
    const text = typeof sql === "string" ? sql : sql?.text ?? "";
    for (const h of [...armed]) {
      if (!h.re.test(text)) continue;
      if (--h.times <= 0) armed.splice(armed.indexOf(h), 1);
      await h.fn();
    }
    return answer;
  };
  const query = p.query.bind(p);
  p.query = async (sql, args) => hook(sql, await query(sql, args));
  const connect = p.connect.bind(p);
  p.connect = (cb) => {
    if (typeof cb === "function") return connect(cb); // pool.query's own road, hooked above
    return connect().then((client) => {
      if (!client.__faultHooked) {
        const cq = client.query.bind(client);
        // pool.query reuses this client with a callback: that road is hooked above
        client.query = (sql, args, cb) => (typeof cb === "function" || typeof args === "function"
          ? cq(sql, args, cb) : cq(sql, args).then((answer) => hook(sql, answer)));
        client.__faultHooked = true;
      }
      return client;
    });
  };
  return { after: (re, fn, times = 1) => { armed.push({ re, fn, times }); } };
}

let hooks;
const TAKEN = /^DELETE FROM oauth_(tokens|codes) WHERE (token_hash|code) = /;
const outageAfterTheDelete = () => hooks.after(TAKEN, () => store.pause());

before(async () => {
  store = await startStore({ db: "oauth_outage", own: true });
  const { default: pg } = await import("pg");
  pool = new pg.Pool({ connectionString: store.url("office_api"), max: 4, types: paperworkPoolTypes(pg) });
  pool.on("error", () => {}); // an idle client the outage ended: the pool drops it
  hooks = hooksOn(pool);
  paper = paperOnPool(pool);
  // The office's own dispatch (server.mjs § OAuth + discovery routes): a
  // rejection the route did not answer is the outer catch's 500 bounce.
  server = createServer((req, res) => {
    handleOauth(req, res, { odb: paper, db: null, clone: "" }).catch((e) => {
      if (!res.headersSent) { res.writeHead(500, { "content-type": "application/json" }); res.end(JSON.stringify({ error: "the office tripped", hint: String(e?.message ?? e) })); }
    });
  });
  await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
  BASE = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.closeAllConnections(); // fetch keeps its sockets alive; close() alone waits on them
  await new Promise((ok) => server.close(ok));
  await pool.end().catch(() => {});
  await store.stop();
});

// A resident's live refresh token, as a past sign-in left it.
async function seedRefresh() {
  const token = randomBytes(32).toString("base64url");
  await paper.run("INSERT INTO tokens (token_hash, kind, gh_id, gh_login, client_id, expires, created) VALUES (?, 'refresh', ?, ?, ?, ?, ?)",
    sha(token), 999, "keeminlee", "client-1", now() + 3600, now());
  return token;
}

const post = (body) => fetch(`${BASE}/oauth/token`, {
  method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body),
});
const refresh = (token) => post({ grant_type: "refresh_token", refresh_token: token });

async function assertRetryable(res, what) {
  const text = await res.text();
  assert.equal(res.status, 503, `${what}: a store fault answers 503, got ${res.status} ${text.slice(0, 160)}`);
  assert.ok(Number(res.headers.get("retry-after")) > 0, `${what}: the 503 says when to retry (Retry-After)`);
  assert.doesNotMatch(text, /invalid_grant/, `${what}: a store fault is never invalid_grant, which a client reads as "sign in again"`);
  assert.equal(JSON.parse(text).error, "temporarily_unavailable");
  assert.match(JSON.parse(text).error_description, /may not have been changed/, `${what}: the answer never promises nothing changed (a lost COMMIT acknowledgement)`);
}

test("R0 the sweep still deletes an expired row after an oauth request, and not twice in a minute", async () => {
  const expiredRow = async (tag) => {
    await paper.run("INSERT INTO tokens (token_hash, kind, gh_id, gh_login, client_id, expires, created) VALUES (?, 'access', ?, ?, ?, ?, ?)",
      sha(tag), 999, "keeminlee", "client-1", now() - 60, now() - 3600);
    return async () => (await pool.query("SELECT 1 FROM oauth_tokens WHERE token_hash = $1", [sha(tag)])).rowCount;
  };
  const disco = () => fetch(`${BASE}/.well-known/oauth-authorization-server`, { headers: { accept: "application/json" } });
  const first = await expiredRow("expired-1");
  assert.equal((await disco()).status, 200);
  for (let i = 0; i < 40 && await first(); i++) await new Promise((ok) => setTimeout(ok, 50));
  assert.equal(await first(), 0, "the sweep deleted the expired token after the request was answered");
  const second = await expiredRow("expired-2");
  assert.equal((await disco()).status, 200);
  await new Promise((ok) => setTimeout(ok, 500));
  assert.equal(await second(), 1, "a second request inside the minute does not sweep again");
});

test("R1 the store is down: the refresh answers 503 with Retry-After, and once it is back the SAME refresh token works", async () => {
  const token = await seedRefresh();
  await store.pause();
  try {
    await assertRetryable(await refresh(token), "refresh while the store is down");
    const disco = await fetch(`${BASE}/.well-known/oauth-authorization-server`, { headers: { accept: "application/json" } });
    assert.equal(disco.status, 200, "discovery reads no record, so the outage does not reach it");
  } finally { await store.resume(); }

  const back = await refresh(token);
  assert.equal(back.status, 200, `the same refresh token works once the store is back: ${back.status} ${await back.clone().text()}`);
  const grant = await back.json();
  assert.ok(grant.access_token && grant.refresh_token);
  assert.equal((await refresh(token)).status, 400, "and the rotation retired it, as before");
  assert.equal((await refresh(grant.refresh_token)).status, 200, "the new refresh token is the live one");
});

test("R2 the store goes down mid-rotation, after it took the old token's DELETE: 503, and the old refresh token survives", async () => {
  const token = await seedRefresh();
  outageAfterTheDelete();
  try {
    await assertRetryable(await refresh(token), "refresh whose store went down mid-rotation");
  } finally { await store.resume(); }

  const { rows } = await pool.query("SELECT kind FROM oauth_tokens WHERE token_hash = $1", [sha(token)]);
  assert.deepEqual(rows.map((r) => r.kind), ["refresh"], "the old refresh token is still in the store: its DELETE was rolled back with the insert");
  const back = await refresh(token);
  assert.equal(back.status, 200, `the same refresh token works once the store is back: ${back.status} ${await back.clone().text()}`);
});

test("R3 a code exchange the store could not finish leaves the code for the retry; a refused code is still burned", async () => {
  const verifier = randomBytes(32).toString("base64url");
  const code = randomBytes(16).toString("base64url");
  const grant = { client_id: "client-1", redirect_uri: "http://localhost/cb", code_challenge: sha(verifier), gh_id: 999, gh_login: "keeminlee" };
  await paper.run("INSERT INTO codes VALUES (?, ?, ?)", code, JSON.stringify(grant), now() + 120);
  const exchange = (v) => post({ grant_type: "authorization_code", code, client_id: "client-1", redirect_uri: "http://localhost/cb", code_verifier: v });

  outageAfterTheDelete();
  try { await assertRetryable(await exchange(verifier), "code exchange whose store went down mid-exchange"); }
  finally { await store.resume(); }
  const ok = await exchange(verifier);
  assert.equal(ok.status, 200, `the retry exchanges the same code: ${ok.status} ${await ok.clone().text()}`);
  assert.ok((await ok.json()).refresh_token);

  const code2 = randomBytes(16).toString("base64url");
  await paper.run("INSERT INTO codes VALUES (?, ?, ?)", code2, JSON.stringify(grant), now() + 120);
  const bad = await post({ grant_type: "authorization_code", code: code2, client_id: "client-1", code_verifier: "not-the-verifier" });
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).error, "invalid_grant");
  const { rowCount } = await pool.query("SELECT 1 FROM oauth_codes WHERE code = $1", [code2]);
  assert.equal(rowCount, 0, "a refused code is burned: its deletion commits with the refusal");
});

test("R4 two refreshes of one token race past their SELECT: exactly one 200, and one refresh family", async () => {
  const token = await seedRefresh();
  const refreshRows = async () => (await pool.query("SELECT count(*)::int AS n FROM oauth_tokens WHERE kind = 'refresh'")).rows[0].n;
  const before = await refreshRows();
  // A barrier on the refresh's SELECT: neither grant goes on to its DELETE until
  // both have read the row, so the race the review named is forced, not hoped for.
  let seen = 0, both;
  const bothRead = new Promise((ok) => { both = ok; });
  hooks.after(/^SELECT \* FROM oauth_tokens WHERE token_hash = /, async () => {
    if (++seen === 2) both();
    await Promise.race([bothRead, new Promise((ok) => setTimeout(ok, 5000))]);
  }, 2);
  const answers = await Promise.all([refresh(token), refresh(token)]);
  assert.equal(seen, 2, "both grants read the row before either deleted it");
  const statuses = answers.map((r) => r.status).sort();
  assert.deepEqual(statuses, [200, 400], `exactly one grant wins: ${statuses}`);
  const loser = await answers.find((r) => r.status === 400).json();
  assert.equal(loser.error, "invalid_grant");
  assert.equal(await refreshRows(), before, "one refresh token retired and ONE issued: the family did not fork");
});

test("R5 a malformed grant is the client's: 400 invalid_request, never the outage's 503", async () => {
  const json = (body) => fetch(`${BASE}/oauth/token`, { method: "POST", headers: { "content-type": "application/json" }, body });
  const cases = [
    ["a numeric refresh_token", json(JSON.stringify({ grant_type: "refresh_token", refresh_token: 1 }))],
    ["a numeric code_verifier", json(JSON.stringify({ grant_type: "authorization_code", code: "c", code_verifier: 7 }))],
    ["an object code", json(JSON.stringify({ grant_type: "authorization_code", code: { a: 1 }, code_verifier: "v" }))],
    ["a NUL in the code", post({ grant_type: "authorization_code", code: "a\0b", code_verifier: "v" })],
    ["a JSON body that is null", json("null")],
  ];
  for (const [what, call] of cases) {
    const r = await call;
    const body = await r.text();
    assert.equal(r.status, 400, `${what}: ${r.status} ${body.slice(0, 160)}`);
    assert.equal(JSON.parse(body).error, "invalid_request", what);
  }
});
