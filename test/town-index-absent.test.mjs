// town-index-absent.test.mjs — a switched office answers every door with office.db GONE (POS-268 part 5a).
//
//   node --test test/town-index-absent.test.mjs
//
// Two offices over one town and one record. "plain" has the switch off and reads the fixture's
// office.db, as prod does today. "absent" has TOWN_INDEX_READS=store, a store
// seeded from that same office.db, and a --db path where NO FILE EXISTS. Every
// door that reads the town index (REST and MCP, keyed and keyless) must answer
// the absent office exactly as it answers the plain one: the same status, the
// same body, the same x-postmark-as-of. A reader still asking office.db meets
// server.mjs § ABSENT_INDEX, which throws by name, so it cannot pass quietly.

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

import { fixtureDb } from "./fixture.mjs";
import { startStore } from "./helpers/embedded-store.mjs";
import { copyIndexToStore } from "./helpers/index-to-store.mjs";
import { townClone, townModuleUrl } from "./fixture-paths.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tmp = mkdtempSync(join(tmpdir(), "town-index-absent-"));
const dbPath = join(tmp, "office.db");
const NO_DB = join(tmp, "there-is-no-office.db");
const KEY = "absent-test-key";
// The town clone, when the tree has one: the quest board and the doorstep's next
// steps read the town's own quest tools from it, and without one they never
// reach the index rows they read (the quest registry, progress and standing).
const TOWN = townClone();
let store = null, skip = false;
const offices = {};

function office(name, db, env) {
  const child = spawn(process.execPath, [join(ROOT, "src", "server.mjs"), "--port", "0", "--db", db,
    "--oauth-db", join(tmp, `${name}-oauth.db`), "--roles-db", join(tmp, `${name}-roles.db`)], {
    env: { ...process.env, OFFICE_KEYS: `${KEY}=keemin:wright`, TOWN_CLONE: TOWN ?? join(tmp, "no-clone-here"), WORLD_CLONE: join(tmp, "no-world-clone"),
      VOICES_LOG: join(tmp, `${name}-voices.jsonl`), TOWN_PUSH: "", WORLD_STORE_DB: join(tmp, "no-world.db"),
      OFFICE_READ_WORKERS: "0", TOWN_INDEX_READS: undefined, WORLD2_PG: undefined, WORLD2_PG_URL: undefined, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let err = "";
  child.stderr.on("data", (d) => { err += String(d); });
  return new Promise((ok, no) => {
    const t = setTimeout(() => no(new Error(`${name}: the office never listened\n${err}`)), 20_000);
    child.stdout.on("data", (d) => {
      const m = /listening on :(\d+)/.exec(String(d));
      if (m) { clearTimeout(t); offices[name] = { child, base: `http://127.0.0.1:${m[1]}`, err: () => err }; ok(); }
    });
    child.on("exit", (c) => { clearTimeout(t); no(new Error(`${name}: the office exited early (${c})\n${err}`)); });
  });
}

before(async () => {
  store = await startStore({ db: "index_absent" });
  if (store.skip) { skip = store.skip; return; }
  const db = fixtureDb(dbPath);
  if (TOWN) {
    const { townDay } = await import(townModuleUrl("tools", "quest-progress.mjs"));
    const put = db.prepare("INSERT OR REPLACE INTO meta VALUES (?, ?)");
    put.run("quest_registry", readFileSync(join(TOWN, "quest-registry.json"), "utf8"));
    put.run("quest_day", townDay());
    db.prepare("INSERT INTO quest_progress (handle, send, receive, house_size, house_send, house_receive, sent_to, heard_from) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run("wright", 2, 1, 1, 2, 1, JSON.stringify(["limen"]), JSON.stringify(["limen"]));
    db.prepare("INSERT INTO quest_standing VALUES (?, ?)").run("wright", JSON.stringify({ facts: { address: true }, since: {} }));
  }
  const w = await store.connect("law_ingester");
  await copyIndexToStore(w, db);
  await w.end();
  db.close();
  // prod has the record (WORLD2_PG) and the switch off; only the switch differs between the two
  await office("plain", dbPath, { WORLD2_PG: "1", WORLD2_PG_URL: store.url("office_api") });
  await office("absent", NO_DB, { TOWN_INDEX_READS: "store", WORLD2_PG: "1", WORLD2_PG_URL: store.url("office_api") });
});

after(async () => {
  for (const { child } of Object.values(offices)) {
    if (child.exitCode === null) { const gone = new Promise((ok) => child.on("exit", ok)); child.kill(); await gone; }
  }
  if (store?.stop) await store.stop();
  rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

const keyed = { authorization: `Bearer ${KEY}` };

/** Where two answers first part (a JSON path and both values), or null when they are the same bytes. */
function firstDiff(a, b) {
  if (a === b) return null;
  let x, y;
  try { x = JSON.parse(a); y = JSON.parse(b); } catch { return { at: "(not JSON)", plain: a.slice(0, 300), absent: b.slice(0, 300) }; }
  // an MCP answer carries its result as JSON text; open it so the path names the field
  const open = (v) => (typeof v === "string" && /^s*[{[]/.test(v) ? (() => { try { return JSON.parse(v); } catch { return v; } })() : v);
  const walk = (u, v, at) => {
    u = open(u); v = open(v);
    if (u === v) return null;
    if (typeof u !== "object" || typeof v !== "object" || u === null || v === null || Array.isArray(u) !== Array.isArray(v))
      return { at, plain: JSON.stringify(u)?.slice(0, 300), absent: JSON.stringify(v)?.slice(0, 300) };
    const keys = [...new Set([...Object.keys(u), ...Object.keys(v)])];
    for (const k of keys) { const d = walk(u[k], v[k], `${at}.${k}`); if (d) return d; }
    const ko = JSON.stringify(Object.keys(u)), kv = JSON.stringify(Object.keys(v));
    return ko === kv ? null : { at: `${at} (key order)`, plain: ko, absent: kv };
  };
  return walk(x, y, "$") ?? { at: "(whitespace)", plain: a.slice(0, 120), absent: b.slice(0, 120) };
}
const same = (what, a, b) => { const d = firstDiff(a, b); assert.equal(d, null, `${what}: the answers part at ${d?.at}
  plain:  ${d?.plain}
  absent: ${d?.absent}`); };

// The doors that read the town index: every family the store answers.
const REST = [
  ["/town"], ["/residents"], ["/residents?limit=1&offset=1"], ["/residents/wright"], ["/residents/limen"], ["/residents/nobody"],
  ["/repo/log"], ["/repo/log?path=WHITE_PAGES/"], ["/regions"], ["/regions/the-terrace"], ["/regions/nowhere"],
  ["/bulletin"], ["/bulletin/settling-in"], ["/bulletin/nope"], ["/homes/wright"], ["/homes/nobody"],
  ["/stamps"], ["/stamps/wright"], ["/stamps/nobody"], ["/quests/wright"],
  ["/letters"], ["/letters/limen-2026-07-01-to-wright-the-gap"], ["/letters/limen-2026-07-01-to-wright-the-gap", keyed], ["/letters/nope"],
  ["/mail/wright", keyed], ["/mail/wright?box=outbox", keyed], ["/mail/limen", keyed],
  ["/search?q=gap"], ["/search?q=wright&kind=residents"], ["/metrics/mail"], ["/town/ledger"], ["/town/docs"],
  ["/doorstep/wright"], ["/doorstep/wright", keyed], ["/doorstep/limen", keyed], ["/doorstep/nobody", keyed],
  ["/me", keyed],
];

// The same families over MCP, through the one dispatch every MCP door shares.
const MCP = [
  ["read_town", {}], ["list_residents", {}], ["read_resident", { handle: "wright" }], ["list_mail", { handle: "wright" }],
  ["list_letters", {}], ["read_letter", { id: "limen-2026-07-01-to-wright-the-gap" }], ["search_town", { q: "gap" }],
  ["list_commits", {}], ["list_regions", {}], ["read_home", { handle: "wright" }], ["read_bulletin", {}], ["read_stamps", {}],
  ["read_stamps", { handle: "wright" }], ["read_quests", { handle: "wright" }], ["read_metrics", {}], ["read_docs", {}],
  ["read_doorstep", { handle: "wright" }], ["whoami", {}],
  ["household", {}], ["household", { read: "stamps" }], ["household", { read: "quests" }], ["household", { read: "fund" }],
  ["household", { read: "doorstep", handle: "wright" }], ["household", { read: "house" }], ["household", { read: "needs-you" }],
  ["household", { read: "mail", handle: "wright" }], ["household", { read: "letter", id: "limen-2026-07-01-to-wright-the-gap" }],
  ["household", { read: "standing", handle: "wright" }], ["household", { read: "home", handle: "wright" }], ["household", { read: "window", handle: "wright" }],
  ["town", {}], ["town", { read: "town" }], ["town", { read: "residents" }], ["town", { read: "resident", args: { handle: "limen" } }],
  ["town", { read: "letters" }], ["town", { read: "letter", args: { id: "limen-2026-07-01-to-wright-the-gap" } }], ["town", { read: "search", args: { q: "gap" } }],
  ["town", { read: "commits" }], ["town", { read: "regions" }], ["town", { read: "home", args: { handle: "wright" } }],
  ["town", { read: "bulletin" }], ["town", { read: "stamps" }], ["town", { read: "metrics" }], ["town", { read: "quests" }], ["town", { read: "docs" }],
];

async function rest(name, door, headers = {}) {
  const r = await fetch(offices[name].base + door, { headers });
  return { status: r.status, asOf: r.headers.get("x-postmark-as-of"), body: await r.text() };
}

async function mcp(name, tool, args) {
  const r = await fetch(offices[name].base + "/mcp", {
    method: "POST",
    headers: { ...keyed, "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: tool, arguments: args } }),
  });
  return { status: r.status, body: await r.text() };
}

test("the absent office booted with no office.db on disk", (t) => {
  if (skip) return t.skip(skip);
  assert.equal(existsSync(NO_DB), false, "the switched office was handed a --db path that holds nothing");
});

test("every index door answers the absent office exactly as the plain one: status, body and as-of", async (t) => {
  if (skip) return t.skip(skip);
  for (const [door, headers] of REST) {
    const a = await rest("plain", door, headers);
    const b = await rest("absent", door, headers);
    const what = `${door}${headers ? " (keyed)" : ""}`;
    assert.equal(b.status, a.status, `${what}: status (absent said ${b.body.slice(0, 300)})`);
    same(what, a.body, b.body);
    assert.equal(b.asOf, a.asOf, `${what}: x-postmark-as-of`);
  }
  assert.doesNotMatch(offices.absent.err(), /office\.db is not opened/, "no reader asked the absent index");
});

test("every MCP index read answers the absent office exactly as the plain one", async (t) => {
  if (skip) return t.skip(skip);
  for (const [tool, args] of MCP) {
    const a = await mcp("plain", tool, args);
    const b = await mcp("absent", tool, args);
    const what = `${tool} ${JSON.stringify(args)}`;
    assert.equal(b.status, a.status, `${what}: status`);
    same(what, a.body, b.body);
  }
  assert.doesNotMatch(offices.absent.err(), /office\.db is not opened/, "no reader asked the absent index");
});

test("unswitched, an office with no office.db still refuses to boot (the rollback is unchanged)", async (t) => {
  if (skip) return t.skip(skip);
  await assert.rejects(office("plain-no-db", NO_DB, {}), /exited early/);
});
