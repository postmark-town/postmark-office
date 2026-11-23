// berth-expiry.test.mjs — A CO-SIGNED BERTH KEY KEEPS WORKING; A SUNSET ONE IS NAMED AT EVERY DOOR (POS-1189).
//
// Darko, 2026-11-22 18:41 EST, POS-1189/b: "keep working". Wright: "A row with `cosigned_gh_id` must not be turned away for its
// date. The seven-day clock stays for a berth nobody has co-signed." And a berth key that HAS lapsed (never co-signed) is refused
// by name on every door (REST, MCP, media), saying that it has sunset and that re-boarding is one POST, in place of the general
// "no key at the door". The 15 August arrival ruling stands: "the agent never fetches a new credential, its standing simply grows".
//
// A real office (OFFICE_PAPERWORK_STORE=1) on a store of this file's own, with synthetic berths planted in oauth_berths as the
// mint writes them (sha256 of the key, base64url). The co-signing human is the fixture registry's keeminlee (gh 999):
//
//   E1  a co-signed berth key PAST its date answers as its household at /me, exactly as a co-signed key before its date does
//   E2  an un-co-signed berth key past its date is refused BY NAME, with the one-POST remedy, on REST (/me and a write), MCP and
//       media; an unknown key still gets "no key at the door"; a public read with the sunset key is still served
//   E3  the store stopped: the sunset key's door answers the outage (503), never a sunset and never the sign-in challenge
//
//   node --test test/berth-expiry.test.mjs
//
// The falsifiers (run, see the PR): restoring berthLookup's expiry-first return reds E1; dropping the request's lapse
// (server.mjs § resolveRequestBearer) reds E2's three doors.

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { fixtureTown } from "./fixture.mjs";
import { indexStore } from "./helpers/office-under-test.mjs";
import { bootOnFreePort } from "./spawn-office.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TMP = mkdtempSync(join(tmpdir(), "berth-expiry-"));
const CLEANUP = [];
after(async () => {
  for (const f of CLEANUP.reverse()) await f().catch(() => {});
  try { rmSync(TMP, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* litter */ }
});

const sha = (s) => createHash("sha256").update(s).digest("base64url");
const now = () => Math.floor(Date.now() / 1000);
const key = () => "pmb_" + randomBytes(32).toString("base64url");
const SUNSET = /^your berth key has sunset — "lapsed-wanderer" lapsed at \d{4}-\d{2}-\d{2}T/;
const REMEDY = /Re-boarding is one POST: POST \/berth \{"slug": "lapsed-wanderer"\}/;

test("POS-1189 · a co-signed berth key keeps working past its date; a sunset one is named on REST, MCP and media", async (t) => {
  const town = fixtureTown();
  const ix = await indexStore(town, { db: "berth_expiry", own: true });
  CLEANUP.push(() => ix.stop());

  const WEEK = 7 * 24 * 3600;
  const kept = key(), fresh = key(), lapsed = key();
  const api = await ix.store.connect("office_api");
  try {
    const ins = "INSERT INTO oauth_berths (slug, token_hash, created, expires, cosigned_gh_id, cosigned_gh_login, cosigned_at) VALUES ($1, $2, $3, $4, $5, $6, $7)";
    // co-signed, minted two weeks ago: its seven days ran out a week ago (the 53)
    await api.query(ins, ["kept-heir", sha(kept), now() - 2 * WEEK, now() - WEEK, 999, "keeminlee", now() - 2 * WEEK + 60]);
    // co-signed, still inside its seven days (unchanged behaviour)
    await api.query(ins, ["fresh-heir", sha(fresh), now() - 3600, now() - 3600 + WEEK, 999, "keeminlee", now() - 3000]);
    // nobody co-signed it, and its seven days ran out a minute ago
    await api.query(ins, ["lapsed-wanderer", sha(lapsed), now() - WEEK - 60, now() - 60, null, null, null]);
  } finally { await api.end(); }

  let said = "";
  const office = await bootOnFreePort((port) => { const c = spawn(process.execPath, [join(ROOT, "src", "server.mjs"),
    "--port", String(port), "--oauth-db", join(TMP, "oauth.db"), "--roles-db", join(TMP, "roles.db")], {
    env: { ...process.env, ...ix.env, OFFICE_PAPERWORK_STORE: "1", OFFICE_READ_WORKERS: "0", WORLD_GRAPH_NONE: "1", OFFICE_KEYS: "",
      TOWN_CLONE: join(TMP, "no-clone"), WORLD_CLONE: join(TMP, "no-world-clone"), TOWN_PUSH: "" },
    stdio: ["ignore", "pipe", "pipe"],
  }); c.stderr.on("data", (x) => { said += String(x); }); return c; });
  CLEANUP.push(async () => office.child.kill());
  const base = `http://127.0.0.1:${office.port}`;
  const auth = (token) => (token ? { authorization: `Bearer ${token}` } : {});
  const me = (token) => fetch(`${base}/me`, { headers: auth(token) });
  const write = (token) => fetch(`${base}/letters`, { method: "POST", headers: { ...auth(token), "content-type": "application/json" }, body: JSON.stringify({ to: "keeminlee", body: "hello" }) });
  const mcp = (token) => fetch(`${base}/mcp`, {
    method: "POST", headers: { ...auth(token), "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  const media = (token) => fetch(`${base}/media`, { method: "POST", headers: { ...auth(token), "content-type": "application/json" }, body: JSON.stringify({ image_url: "https://example.invalid/a.png" }) });
  // the keyed REST reads with words of their own: the page's stream (POS-265) and the holdings read
  const stream = (token) => fetch(`${base}/world/say/stream`, { headers: auth(token) });
  const holdings = (token) => fetch(`${base}/world/holdings`, { headers: auth(token) });
  const bodyOf = async (r) => { const s = await r.text(); try { return JSON.parse(s); } catch { return { raw: s }; } };

  await t.test("E1 · a co-signed berth key PAST its date answers as its household, exactly as one before its date", async () => {
    const before = await me(fresh);
    const b = await bodyOf(before);
    assert.equal(before.status, 200, `the co-signed key inside its seven days: ${JSON.stringify(b).slice(0, 300)}\n${said.slice(-1500)}`);
    const past = await me(kept);
    const p = await bodyOf(past);
    assert.equal(past.status, 200, `the co-signed key a week past its date: ${JSON.stringify(p).slice(0, 300)}`);
    assert.equal(p.household, b.household, "the same household standing, whatever the berth's date");
    assert.ok(p.household, "and it is a household");
  });

  await t.test("E2 · an un-co-signed berth key past its date is refused BY NAME, with the one-POST remedy, on REST, MCP and media", async () => {
    for (const [door, call] of [["REST /me", () => me(lapsed)], ["REST write", () => write(lapsed)], ["MCP", () => mcp(lapsed)], ["media", () => media(lapsed)],
      ["REST stream", () => stream(lapsed)], ["REST holdings", () => holdings(lapsed)]]) {
      const r = await call();
      const b = await bodyOf(r);
      assert.equal(r.status, 401, `${door}: ${JSON.stringify(b).slice(0, 300)}`);
      assert.match(b.defect ?? "", SUNSET, `${door} names the sunset: ${b.defect}`);
      assert.match(b.hint ?? "", REMEDY, `${door} gives the one-POST way back: ${b.hint}`);
    }
    // an unknown key is still no key, at the same doors
    for (const [door, call] of [["REST /me", () => me(key())], ["MCP", () => mcp(key())], ["media", () => media(key())]]) {
      const b = await bodyOf(await call());
      assert.equal(b.defect, "no key at the door", `${door}: an unknown key is not a sunset`);
    }
    // the stream and the holdings read keep their own words for an unknown key and for none
    for (const token of [key(), null]) {
      assert.equal((await bodyOf(await stream(token))).defect, "a stream needs a key", `the stream, ${token ? "an unknown key" : "no key"}`);
      assert.equal((await bodyOf(await holdings(token))).defect, "these are YOUR hands, and the office must know whose", `holdings, ${token ? "an unknown key" : "no key"}`);
    }
    // and a public read with the sunset key is served, as with any key that is not one
    assert.equal((await fetch(`${base}/town`, { headers: auth(lapsed) })).status, 200);
  });

  await ix.store.pause();
  try {
    await t.test("E3 · the store stopped: the sunset key's door answers the outage, never a sunset or the sign-in challenge", async () => {
      const r = await me(lapsed);
      const b = await bodyOf(r);
      assert.equal(r.status, 503, `${JSON.stringify(b).slice(0, 300)}`);
      assert.doesNotMatch(b.defect ?? "", /sunset/);
      assert.equal(r.headers.get("www-authenticate"), null);
    });
  } finally { await ix.store.resume(); }
});
