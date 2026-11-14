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
//       deletes: exactly one rotates (the DELETE's own row count is the claim),
//       and the other is a reuse that ends the sign-in (POS-485): no fork
//   R5  a malformed grant (a non-string field, a NUL, a body that is no object)
//       is the client's: 400 invalid_request, never the outage's 503
//
// POS-485 (Darko, 2026-11-13: "End the whole sign-in, no grace"; "Link new
// keys, leave old"), on the same real store, as office_api:
//
//   R6  THE FALSIFIER: rotate, replay the retired refresh token: every key of
//       that sign-in fails; another sign-in of the same account and client, a
//       pre-switch access key and household and resident keys still work
//   R7  a pre-switch refresh's first rotation starts a family and records its
//       own hash in it; its pre-switch access key stays outside the rule
//   R8  a rotation and a revocation of one sign-in race: the revocation waits
//       on the family's lock (seen in pg_locks) and ends what the rotation issued
//   R9  a store fault mid-revocation, or mid-rotation after its evidence row, is
//       a 503 that rolls back whole; the retry decides as if nothing happened
//   R10 a lost COMMIT acknowledgement: the retry is a reuse and ends the sign-in
//   R11 the sweep keeps a retired token's evidence while its sign-in has a key
//       that can authenticate, and removes it once none can
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
import { handleOauth, mintHouseholdKey, sweep, SIGN_IN_ENDED } from "../src/oauth.mjs";
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

// POS-485 · a NEW sign-in, through the token endpoint's own code exchange (a code row as the consent leaves it)
async function signIn(client = "client-1") {
  const verifier = randomBytes(32).toString("base64url");
  const code = randomBytes(16).toString("base64url");
  await paper.run("INSERT INTO codes VALUES (?, ?, ?)", code, JSON.stringify({ client_id: client, redirect_uri: "http://localhost/cb",
    code_challenge: sha(verifier), gh_id: 999, gh_login: "keeminlee" }), now() + 120);
  const r = await post({ grant_type: "authorization_code", code, client_id: client, redirect_uri: "http://localhost/cb", code_verifier: verifier });
  assert.equal(r.status, 200, `sign-in: ${r.status} ${await r.clone().text()}`);
  return r.json();
}
const rotate = async (token) => {
  const r = await refresh(token);
  assert.equal(r.status, 200, `rotation: ${r.status} ${await r.clone().text()}`);
  return r.json();
};
// Does this access token still authenticate? The bearer lookup's own statement and its expiry test (oauth.mjs § oauthLookup,
// which goes on to resolve the household only for a row this finds); the end-to-end door is test/oauth.test.mjs § POS-485.
const accessLive = async (token) => {
  const row = await paper.get("SELECT * FROM tokens WHERE token_hash = ? AND kind = 'access'", sha(token));
  return Boolean(row && row.expires >= now());
};
// A pair issued BEFORE the switch, as issueTokens wrote it then: no family.
async function seedLegacyPair() {
  const access = randomBytes(32).toString("base64url"), refreshToken = randomBytes(32).toString("base64url");
  const cols = "INSERT INTO tokens (token_hash, kind, gh_id, gh_login, client_id, expires, created)";
  await paper.run(`${cols} VALUES (?, 'access', 999, 'keeminlee', 'client-1', ?, ?)`, sha(access), now() + 3600, now());
  await paper.run(`${cols} VALUES (?, 'refresh', 999, 'keeminlee', 'client-1', ?, ?)`, sha(refreshToken), now() + 7200, now());
  return { access_token: access, refresh_token: refreshToken };
}
const familyOf = async (token) => (await pool.query("SELECT family FROM oauth_tokens WHERE token_hash = $1", [sha(token)])).rows[0]?.family ?? null;

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
  const next = await refresh(grant.refresh_token);
  assert.equal(next.status, 200, "the new refresh token is the live one");
  // POS-485: the retired token, presented again, ends the sign-in (no grace), the pair just issued with it
  const replay = await refresh(token);
  assert.equal(replay.status, 400, "and the rotation retired it");
  assert.equal((await replay.json()).error_description, SIGN_IN_ENDED);
  assert.equal((await refresh((await next.json()).refresh_token)).status, 400, "its sign-in ended: the newest refresh token too");
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

test("R4 two refreshes of one token race past their SELECT: exactly one rotates, and the other, a reuse, ends the sign-in: no fork survives", async () => {
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
  // POS-485: the second grant presented a token the first had just retired, which is a reuse: the sign-in ends, the winner's
  // new pair with it (Darko: "End the whole sign-in, no grace"), so no line survives either racer
  assert.equal(loser.error_description, SIGN_IN_ENDED);
  const winner = await answers.find((r) => r.status === 200).json();
  assert.equal(await refreshRows(), before - 1, "the retired token and the winner's new refresh token are both gone: nothing forked");
  assert.equal(await accessLive(winner.access_token), false, "and the winner's access token no longer authenticates");
  assert.equal((await refresh(winner.refresh_token)).status, 400);
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

// ── POS-485 · a reused refresh token ends its whole sign-in, on the real store ──

test("R6 THE FALSIFIER: rotate, then replay the retired refresh token: every key of that sign-in fails at once; another sign-in of the same account and client, a pre-switch access key and the household and resident keys all still work", async () => {
  const g1 = await signIn(), g2 = await rotate(g1.refresh_token), g3 = await rotate(g2.refresh_token);
  const F = await familyOf(g1.access_token);
  assert.ok(F, "a new sign-in records its family");
  for (const g of [g2, g3]) for (const tok of [g.access_token, g.refresh_token]) assert.equal(await familyOf(tok), F, "every rotation carries it");
  const { rows: spent } = await pool.query("SELECT token_hash, family, gh_id, expires FROM oauth_tokens WHERE kind = 'spent' AND family = $1 ORDER BY created", [F]);
  assert.deepEqual(spent.map((r) => r.token_hash).sort(), [sha(g1.refresh_token), sha(g2.refresh_token)].sort(), "each retired refresh token is kept by HASH as evidence");
  assert.ok(spent.every((r) => r.gh_id === null && r.expires === null), "and nothing else: no account, no expiry of its own");

  const other = await signIn();                                   // the same account AND the same client: a different sign-in
  assert.notEqual(await familyOf(other.access_token), F);
  const legacy = await seedLegacyPair();
  const humanKey = await mintHouseholdKey(paper, 999, "keeminlee");
  const residentKey = await mintHouseholdKey(paper, 999, "keeminlee", { heldBy: "resident", claimedHandle: "wright", cosignedBy: { id: 999, login: "keeminlee" } });
  const keyLive = async (key) => Boolean(await paper.get("SELECT 1 FROM tokens WHERE token_hash = ? AND kind = 'household' AND expires >= ?", sha(key), now()));
  for (const g of [g1, g2, g3, other]) assert.equal(await accessLive(g.access_token), true, "before: every access key works (the older 30-day ones included)");

  const replay = await refresh(g1.refresh_token);
  assert.equal(replay.status, 400);
  assert.deepEqual(await replay.json(), { error: "invalid_grant", error_description: SIGN_IN_ENDED }, "the protocol's shape, in words that say the sign-in ended");
  for (const [what, g] of [["the first", g1], ["the second", g2], ["the newest", g3]])
    assert.equal(await accessLive(g.access_token), false, `${what} access key of the sign-in fails at once`);
  const newest = await refresh(g3.refresh_token);
  assert.equal(newest.status, 400, "and so does its live refresh token");
  assert.equal((await refresh(g2.refresh_token)).status, 400, "a second replay is refused too");
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM oauth_tokens WHERE family = $1 AND kind IN ('access', 'refresh')", [F])).rows[0].n, 0);

  assert.equal(await accessLive(other.access_token), true, "another sign-in of the same account and client still works");
  assert.equal((await refresh(other.refresh_token)).status, 200, "and still refreshes");
  assert.equal(await accessLive(legacy.access_token), true, "a pre-switch access key is outside the rule (POS-485/b)");
  assert.equal(await keyLive(humanKey), true, "the human's household key is untouched");
  assert.equal(await keyLive(residentKey), true, "and so is the resident's own key");
});

test("R7 A PRE-SWITCH REFRESH starts a linked family at its first rotation, and its own hash joins it: a replay ends what it issued, never the pre-switch access key beside it", async () => {
  const legacy = await seedLegacyPair();
  assert.equal(await familyOf(legacy.refresh_token), null);
  const n1 = await rotate(legacy.refresh_token);
  const F = await familyOf(n1.access_token);
  assert.ok(F, "the first post-switch rotation starts a family");
  assert.equal(await familyOf(n1.refresh_token), F);
  assert.deepEqual((await pool.query("SELECT kind, family FROM oauth_tokens WHERE token_hash = $1", [sha(legacy.refresh_token)])).rows, [{ kind: "spent", family: F }],
    "the consumed pre-switch refresh is recorded in that family, for reuse detection");
  assert.equal(await familyOf(legacy.access_token), null, "its pre-switch access key is NOT linked: no lineage was stored, none is inferred");
  const n2 = await rotate(n1.refresh_token);

  const replay = await refresh(legacy.refresh_token);
  assert.equal(replay.status, 400);
  assert.equal((await replay.json()).error_description, SIGN_IN_ENDED);
  for (const g of [n1, n2]) assert.equal(await accessLive(g.access_token), false, "what the family issued fails");
  assert.equal((await refresh(n2.refresh_token)).status, 400);
  assert.equal(await accessLive(legacy.access_token), true, "the pre-switch access key keeps its own expiry, outside the rule");
});

test("R8 A ROTATION AND A REVOCATION OF ONE SIGN-IN RACE: the revocation waits for the rotation's commit and ends what it issued, so no child survives", async () => {
  const g1 = await signIn(), g2 = await rotate(g1.refresh_token);
  const { default: pg } = await import("pg");
  const watcher = new pg.Client({ connectionString: store.url("office_api") });
  await watcher.connect();
  try {
    // Hold the honest client's rotation of g2 open after it took the claim (its DELETE), and replay g1 meanwhile
    let held, release;
    const holding = new Promise((ok) => { held = ok; });
    const go = new Promise((ok) => { release = ok; });
    hooks.after(/^DELETE FROM oauth_tokens WHERE token_hash = \$1 AND kind = 'refresh'/, async () => { held(); await go; }, 1);
    const rotation = refresh(g2.refresh_token);
    await holding;
    const replay = refresh(g1.refresh_token);
    // the replay is WAITING on the rotation (an ungranted lock), seen from the store itself, not from a timer
    let waiting = 0;
    for (let i = 0; i < 100 && !waiting; i++) {
      waiting = (await watcher.query("SELECT count(*)::int AS n FROM pg_locks WHERE NOT granted")).rows[0].n;
      if (!waiting) await new Promise((ok) => setTimeout(ok, 20));
    }
    release();
    assert.ok(waiting > 0, "the revocation waited for the rotation");
    const [rot, rep] = await Promise.all([rotation, replay]);
    assert.equal(rot.status, 200, "the rotation committed first");
    const g3 = await rot.json();
    assert.equal(rep.status, 400);
    assert.equal((await rep.json()).error_description, SIGN_IN_ENDED);
    assert.equal(await accessLive(g3.access_token), false, "the pair the rotation issued while the revocation waited is ended too");
    assert.equal((await refresh(g3.refresh_token)).status, 400, "no child survives");
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM oauth_tokens WHERE family = $1 AND kind IN ('access', 'refresh')", [await familyOf(g1.refresh_token)])).rows[0].n, 0);
  } finally { await watcher.end(); }
});

test("R9 THE STORE FAILS: a revocation the store could not finish is a 503, never invalid_grant, and rolls back whole; the retry ends the sign-in", async () => {
  const g1 = await signIn(), g2 = await rotate(g1.refresh_token);
  hooks.after(/^DELETE FROM oauth_tokens WHERE family = /, () => store.pause());
  try { await assertRetryable(await refresh(g1.refresh_token), "a replay whose store went down mid-revocation"); }
  finally { await store.resume(); }
  assert.equal(await accessLive(g2.access_token), true, "the revocation's DELETE was rolled back: nothing half-ended");
  const retry = await refresh(g1.refresh_token);
  assert.equal(retry.status, 400);
  assert.equal((await retry.json()).error_description, SIGN_IN_ENDED);
  assert.equal(await accessLive(g2.access_token), false);

  // and a linked rotation the store could not finish keeps its refresh token, with no evidence row left behind
  const h1 = await signIn();
  hooks.after(/^INSERT INTO oauth_tokens \(token_hash, kind, family, created\) VALUES/, () => store.pause());
  try { await assertRetryable(await refresh(h1.refresh_token), "a rotation whose store went down after its evidence row"); }
  finally { await store.resume(); }
  assert.deepEqual((await pool.query("SELECT kind FROM oauth_tokens WHERE token_hash = $1", [sha(h1.refresh_token)])).rows.map((r) => r.kind), ["refresh"]);
  assert.equal((await refresh(h1.refresh_token)).status, 200, "the same refresh token works once the store is back");
});

test("R10 A LOST COMMIT ACKNOWLEDGEMENT: the rotation landed but the client was told 503 (may not have changed); its retry is a reuse and ends the sign-in, no grace", async () => {
  const g1 = await signIn();
  hooks.after(/^COMMIT/, () => { throw Object.assign(new Error("Connection terminated unexpectedly"), { code: "57P01" }); });
  await assertRetryable(await refresh(g1.refresh_token), "a rotation whose COMMIT landed and whose acknowledgement was lost");
  assert.deepEqual((await pool.query("SELECT kind FROM oauth_tokens WHERE token_hash = $1", [sha(g1.refresh_token)])).rows.map((r) => r.kind), ["spent"],
    "the store DID apply it: the old refresh token is retired");
  const retry = await refresh(g1.refresh_token);
  assert.equal(retry.status, 400, "the retry is a reuse (Darko: no grace)");
  assert.equal((await retry.json()).error_description, SIGN_IN_ENDED);
  assert.equal(await accessLive(g1.access_token), false, "and the sign-in, its first access key included, has ended");
});

test("R11 RETIREMENT CLEANUP: the sweep keeps a retired token's evidence while any key of its sign-in can authenticate, and removes it once none can", async () => {
  const t = now();
  const cols = "INSERT INTO tokens (token_hash, kind, gh_id, gh_login, client_id, expires, created, family)";
  const spentRow = (tag, family) => paper.run("INSERT INTO tokens (token_hash, kind, family, created) VALUES (?, 'spent', ?, ?)", sha(tag), family, t);
  const has = async (tag) => (await pool.query("SELECT 1 FROM oauth_tokens WHERE token_hash = $1", [sha(tag)])).rowCount === 1;
  // fam-live: its refresh has lapsed but an access key still authenticates; fam-dead: every key has lapsed
  await paper.run(`${cols} VALUES (?, 'access', 999, 'k', 'c', ?, ?, 'fam-live')`, sha("live-access"), t + 600, t);
  await paper.run(`${cols} VALUES (?, 'refresh', 999, 'k', 'c', ?, ?, 'fam-live')`, sha("live-refresh-lapsed"), t - 5, t);
  await paper.run(`${cols} VALUES (?, 'access', 999, 'k', 'c', ?, ?, 'fam-dead')`, sha("dead-access"), t - 5, t);
  await spentRow("live-spent", "fam-live");
  await spentRow("dead-spent", "fam-dead");
  await spentRow("orphan-spent", "fam-ended");                      // its sign-in was ended by a reuse: no key left at all
  await sweep(paper);
  assert.equal(await has("live-spent"), true, "kept: a key of its sign-in still authenticates, so a replay must still be recognized");
  assert.equal(await has("dead-spent"), false, "removed: no key of its sign-in can authenticate");
  assert.equal(await has("orphan-spent"), false);
  assert.equal(await has("live-access"), true);
  assert.equal(await has("live-refresh-lapsed"), false, "the expiry sweep itself is unchanged");
  assert.equal(await has("dead-access"), false);
});
