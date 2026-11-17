// maintenance-switch.test.mjs — the planned-maintenance switch (POS-1096).
//
// Darko, 2026-11-16 22:50 EST: "we can just have like a small build so that there's an alert
// that gracefully says like, hey, like the server's down for maintenance or something. If there
// are queries in the meantime. And we should be able to reuse that for any future like planned
// outages as well."
//
// LAW (POS-1096): while the switch is on, every door answers AT ONCE with 503, Retry-After, a plain
// message and the expected end time if one is set; it never waits on the store (so it works while
// Postgres restarts); the manifest, /release and the in-memory ops reads stay up and say
// "maintenance"; switch off, everything is as before.
//
//   M1-M3  the module's own readings (the flag file, Retry-After, which doors stay up, the memory)
//   S1     a REAL office on a store of this file's own, the flag file in this file's temp dir:
//          off → normal; on → every door (REST and the four MCP tools) 503 with the message;
//          on AND the store stopped → the same maintenance answer (no store read stands in its way:
//          the store is the stub that fails if touched, since a bearer lookup against it answers the
//          store's own defect); health stays up; off → normal again
//
//   node --test test/maintenance-switch.test.mjs

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync, unlinkSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import {
  makeMaintenance, readSwitch, retryAfterSeconds, sendMaintenance, maintenanceBody,
  MAINTENANCE_DEFECT, MAINTENANCE_RETRY_AFTER_S,
} from "../src/maintenance.mjs";
import { fixtureTown } from "./fixture.mjs";
import { indexStore } from "./helpers/office-under-test.mjs";
import { bootOnFreePort } from "./spawn-office.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TMP = mkdtempSync(join(tmpdir(), "maintenance-switch-"));
const CLEANUP = [];
after(async () => {
  for (const f of CLEANUP.reverse()) await f().catch(() => {});
  try { rmSync(TMP, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* litter */ }
});

const err = (code) => Object.assign(new Error(code), { code });

test("M1 · the flag file: absent is off; present is on, with an end time only when its first line is a date", () => {
  assert.equal(readSwitch("x", () => { throw err("ENOENT"); }), null, "no file: off");
  assert.deepEqual(readSwitch("x", () => ""), { ends_at: null }, "an empty file is on, with no end time");
  assert.deepEqual(readSwitch("x", () => "2026-11-18T03:30:00Z\nthe operator's own note\n"), { ends_at: "2026-11-18T03:30:00.000Z" });
  assert.deepEqual(readSwitch("x", () => "soon-ish"), { ends_at: null }, "a first line that is no date is still ON (the file's presence is the switch)");
  // fails open: a flag that cannot be read must never take the town down
  for (const code of ["EACCES", "EISDIR", "ENOTDIR"]) assert.equal(readSwitch("x", () => { throw err(code); }), null, `${code}: off`);
});

test("M1b · a state change is logged once, not per request: an unreadable flag (EACCES) logs its code once and the doors still serve", () => {
  let t = 5_000_000, mode = "absent";
  const lines = [];
  const read = () => {
    if (mode === "absent") throw err("ENOENT");
    if (mode === "eacces") throw err("EACCES");
    return "";
  };
  const m = makeMaintenance({ file: "x", clock: () => t, read, log: (s) => lines.push(s) });
  const tick = () => { t += 1000; return m.refuses("GET", "/town"); };
  for (let i = 0; i < 3; i++) assert.equal(tick(), null, "absent: off");
  assert.deepEqual(lines, [], "absent (ENOENT) is the normal off: nothing logged");
  mode = "eacces";
  for (let i = 0; i < 5; i++) assert.equal(tick(), null, "EACCES: still serves normally (fails open)");
  assert.equal(lines.length, 1, `EACCES logs exactly once across five reads, got: ${JSON.stringify(lines)}`);
  assert.match(lines[0], /EACCES/, "the line names the error code");
  mode = "on";
  assert.ok(tick(), "readable again and present: on");
  assert.ok(tick(), "still on");
  assert.equal(lines.length, 2, "unreadable to on: one more line");
  assert.match(lines[1], /switch ON/);
  mode = "absent";
  assert.equal(tick(), null);
  assert.equal(tick(), null);
  assert.equal(lines.length, 3, "on to off: one more line");
  assert.match(lines[2], /switch OFF/);
  mode = "on"; tick(); mode = "eacces"; tick(); tick();
  assert.equal(lines.length, 5, "off to on, then on to unreadable: one line each");
  assert.match(lines[4], /EACCES/);
});

test("M2 · Retry-After: the seconds to the end time, bounded; a few minutes' worth when there is none or it has passed", () => {
  const now = Date.parse("2026-11-18T03:00:00Z");
  assert.equal(retryAfterSeconds({ ends_at: "2026-11-18T03:05:00.000Z" }, now), 300);
  assert.equal(retryAfterSeconds({ ends_at: null }, now), MAINTENANCE_RETRY_AFTER_S);
  assert.equal(retryAfterSeconds({ ends_at: "2026-11-18T02:00:00.000Z" }, now), MAINTENANCE_RETRY_AFTER_S, "an end time that passed: the default, not zero");
  assert.equal(retryAfterSeconds({ ends_at: "2026-11-18T03:00:01.000Z" }, now), 5, "never below 5 s");
  assert.equal(retryAfterSeconds({ ends_at: "2026-11-25T03:00:00.000Z" }, now), 3600, "never above an hour");
  const body = maintenanceBody({ ends_at: "2026-11-18T03:05:00.000Z" });
  assert.equal(body.defect, "Postmark is down for planned maintenance, back in a few minutes");
  assert.equal(body.maintenance.on, true);
  assert.equal(body.maintenance.ends_at, "2026-11-18T03:05:00.000Z");
  const res = { head: null, body: null, writeHead(c, h) { this.head = [c, h]; }, end(b) { this.body = b; } };
  sendMaintenance(res, { ends_at: null }, { nowMs: now });
  assert.equal(res.head[0], 503);
  assert.equal(res.head[1]["retry-after"], String(MAINTENANCE_RETRY_AFTER_S));
  assert.equal(res.head[1]["access-control-allow-origin"], "*", "a browser window reads the message, not a CORS failure");
  assert.equal(res.head[1]["cache-control"], "no-store");
});

test("M3 · which doors answer: every door but the manifest, /release and the keyless ops reads; a preflight passes; the memory is one second", () => {
  let text = null, t = 1_000_000, reads = 0;
  const m = makeMaintenance({ file: "x", clock: () => t, read: () => { reads++; if (text === null) throw err("ENOENT"); return text; } });
  for (const [method, path] of [["GET", "/town"], ["POST", "/mcp"], ["GET", "/household"], ["POST", "/letters"], ["GET", "/me"]])
    assert.equal(m.refuses(method, path), null, `off: ${method} ${path} is not refused`);
  text = ""; // on, but remembered off for a second
  assert.equal(m.refuses("GET", "/town"), null, "the reading is remembered for a second");
  t += 1000;
  for (const [method, path] of [["GET", "/town"], ["POST", "/mcp"], ["GET", "/household"], ["GET", "/doorstep/ada"], ["POST", "/letters"], ["PATCH", "/profile/ada"], ["GET", "/ops/heard"], ["POST", "/ops/gift"], ["GET", "/oauth/authorize"]])
    assert.ok(m.refuses(method, path), `on: ${method} ${path} is refused`);
  for (const [method, path] of [["GET", "/"], ["HEAD", "/"], ["GET", "/release"], ["GET", "/ops/loop-lag"], ["GET", "/ops/store-txn"], ["OPTIONS", "/mcp"], ["OPTIONS", "/town"]])
    assert.equal(m.refuses(method, path), null, `on: ${method} ${path} stays up`);
  assert.ok(m.refuses("POST", "/"), "on: only a GET or HEAD of the manifest stays up");
  assert.deepEqual(m.field(), { maintenance: { on: true, ends_at: null, message: MAINTENANCE_DEFECT } });
  text = null; t += 1000;
  assert.deepEqual(m.field(), {}, "off: the manifest's shape is byte-for-byte what it was");
  assert.ok(reads >= 3);
});

const sha = (s) => createHash("sha256").update(s).digest("base64url");
const now = () => Math.floor(Date.now() / 1000);
const STORE_DEFECT = "the town's store is unreachable; your sign-in is intact, retry";

test("S1 · a real office: on answers every door 503 with the message (store up or stopped), health stays up, off is normal", async (t) => {
  const town = fixtureTown();
  const ix = await indexStore(town, { db: "maintenance_switch", own: true });
  CLEANUP.push(() => ix.stop());
  const live = randomBytes(32).toString("base64url");
  const api = await ix.store.connect("office_api");
  try {
    await api.query("INSERT INTO oauth_tokens (token_hash, kind, gh_id, gh_login, client_id, expires, created) VALUES ($1, 'access', 999, 'keeminlee', 'cl', $2, $3)",
      [sha(live), now() + 3600, now()]);
  } finally { await api.end(); }

  const FLAG = join(TMP, "MAINTENANCE");
  let said = "";
  const office = await bootOnFreePort((port) => { const c = spawn(process.execPath, [join(ROOT, "src", "server.mjs"),
    "--port", String(port), "--oauth-db", join(TMP, "oauth.db"), "--roles-db", join(TMP, "roles.db")], {
    env: { ...process.env, ...ix.env, OFFICE_PAPERWORK_STORE: "1", OFFICE_READ_WORKERS: "0", WORLD_GRAPH_NONE: "1", OFFICE_KEYS: "",
      OFFICE_MAINTENANCE_FILE: FLAG,
      TOWN_CLONE: join(TMP, "no-clone"), WORLD_CLONE: join(TMP, "no-world-clone"), TOWN_PUSH: "" },
    stdio: ["ignore", "pipe", "pipe"],
  }); c.stderr.on("data", (x) => { said += String(x); }); return c; });
  CLEANUP.push(async () => office.child.kill());
  const base = `http://127.0.0.1:${office.port}`;
  const auth = { authorization: `Bearer ${live}` };
  const mcpTool = (name) => fetch(`${base}/mcp`, {
    method: "POST", headers: { ...auth, "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: {} } }),
  });
  // every door: REST reads and writes, the oauth desk, and the four MCP tools
  const DOORS = [
    ["GET /town", () => fetch(`${base}/town`)],
    ["GET /doorstep/ada", () => fetch(`${base}/doorstep/ada`)],
    ["GET /household (keyed)", () => fetch(`${base}/household`, { headers: auth })],
    ["GET /me (keyed)", () => fetch(`${base}/me`, { headers: auth })],
    ["POST /letters (keyed)", () => fetch(`${base}/letters`, { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: "{}" })],
    ["GET /oauth/authorize", () => fetch(`${base}/oauth/authorize`)],
    ["MCP doorstep", () => mcpTool("doorstep")],
    ["MCP world", () => mcpTool("world")],
    ["MCP household", () => mcpTool("household")],
    ["MCP town", () => mcpTool("town")],
  ];
  const until = async (what, ok) => { // wait on the event: the office remembers its reading for a second
    let last;
    for (let i = 0; i < 40; i++) { last = await ok(); if (last === true) return; await new Promise((r) => setTimeout(r, 250)); }
    assert.fail(`${what}: ${last}\n${said.slice(-1200)}`);
  };
  const allDoors503 = async (storeDefectAllowed) => {
    for (const [name, call] of DOORS) {
      const r = await call();
      const body = await r.text();
      assert.equal(r.status, 503, `${name} while the switch is on: ${r.status} ${body.slice(0, 200)}`);
      const j = JSON.parse(body);
      assert.equal(j.defect, MAINTENANCE_DEFECT, `${name}: the plain message, never the store's own defect (${storeDefectAllowed ? "store stopped" : "store up"})`);
      assert.notEqual(j.defect, STORE_DEFECT, `${name}: a maintenance answer is not an outage answer`);
      assert.ok(Number(r.headers.get("retry-after")) >= 5, `${name}: Retry-After`);
      assert.equal(r.headers.get("www-authenticate"), null, `${name}: planned work never sends the sign-in challenge`);
      assert.equal(r.headers.get("access-control-allow-origin"), "*", `${name}: the site's browser code can read the message`);
      assert.equal(j.maintenance.ends_at, "2030-01-01T00:00:00.000Z", `${name}: the expected end time rides along`);
    }
  };

  await t.test("S1a · switch off: a public read and the signed-in token answer as before; the manifest has no maintenance field", async () => {
    assert.equal((await fetch(`${base}/town`)).status, 200);
    assert.equal((await fetch(`${base}/me`, { headers: auth })).status, 200);
    const man = await (await fetch(`${base}/`)).json();
    assert.equal("maintenance" in man, false, "off: the manifest's shape is unchanged");
  });

  writeFileSync(FLAG, "2030-01-01T00:00:00Z\n");
  await until("the switch reads on", async () => (await fetch(`${base}/town`)).status === 503 || "still 200");

  await t.test("S1b · switch on, store up: every door answers 503 with the message, Retry-After and the end time", async () => {
    await allDoors503(false);
  });

  await t.test("S1c · switch on and the store stopped: the same answer, from no store read (the stopped store is the stub that fails if touched)", async () => {
    await ix.store.pause();
    try { await allDoors503(true); } finally { await ix.store.resume(); }
  });

  await t.test("S1d · switch on: the manifest, /release and the keyless ops reads stay up and say maintenance; a preflight answers", async () => {
    const man = await fetch(`${base}/`);
    assert.equal(man.status, 200);
    assert.equal((await man.json()).maintenance.on, true, "the sentinel's probe of the manifest reads 'maintenance'");
    const rel = await fetch(`${base}/release`);
    assert.equal(rel.status, 200);
    assert.equal((await rel.json()).maintenance.on, true);
    assert.equal((await fetch(`${base}/ops/loop-lag`)).status, 200);
    assert.equal((await fetch(`${base}/ops/store-txn`)).status, 200);
    const pre = await fetch(`${base}/mcp`, { method: "OPTIONS", headers: { origin: "https://postmark.town", "access-control-request-method": "POST" } });
    assert.equal(pre.status, 204, "a browser's preflight still answers");
  });

  unlinkSync(FLAG);
  await until("the switch reads off", async () => (await fetch(`${base}/town`)).status === 200 || "still 503");

  await t.test("S1e · switch off again: normal answers, the manifest back to its old shape", async () => {
    assert.equal((await fetch(`${base}/me`, { headers: auth })).status, 200);
    assert.equal("maintenance" in (await (await fetch(`${base}/`)).json()), false);
  });
});
