// last-active.test.mjs — a resident's last_active is their newest act of their own (POS-481).
//
//   node --test test/last-active.test.mjs
//
// Darko, 2026-10-09: "to be able to see when that resident was last active …
// a timestamp or a date or a crossing". The store's `acts`, `town_letters` and
// town journal are seeded so each resident answers a different way: wright's
// newest is a say (an act, at the clock's crossing for its time, whatever it
// stored), limen's is a letter they sent (at the crossing that sailed it),
// postmaster's only a letter, decorator's only a window re-hung (a page edit),
// and quiet has nothing of their own: a letter received and a join row. The
// roster, the card and the household's address are asked over REST on two
// offices (switch 2 off and on), and search is asked to carry none of it. Over
// MCP, in this process, the store's statements are counted: one per page.
// Then an office whose store is gone says why both fields are null.
//
// Falsifier (POS-481): point LAST_ACTIVE_SQL at `acts.inserted_at` instead of
// `acts.at` and the act-led rows go red here (every seeded act was inserted
// today, long after it happened).

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

import { fixtureDb, fixtureKey } from "./fixture.mjs";
import { startStore } from "./helpers/embedded-store.mjs";
import { copyIndexToStore } from "./helpers/index-to-store.mjs";
import { seedStaticKeys } from "./helpers/static-keys.mjs";
import { LAST_ACTIVE_UNAVAILABLE, pickLastActive } from "../src/last-active.mjs";
import { currentCrossing } from "../src/crossings.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tmp = mkdtempSync(join(tmpdir(), "last-active-"));
const dbPath = join(tmp, "office.db");
const KEEP = Object.fromEntries(["TOWN_INDEX_READS", "WORLD2_PG", "WORLD2_PG_URL"].map((k) => [k, process.env[k]]));
let s = null, su = null, skip = false, db = null, pool = null, pen = null;
const offices = {};
const statements = [];
const KEY = "pos481-last-active-test-key"; // /mcp answers a key, never a stranger (a static row in each office's oauth.db)

// What each resident must read, from the seed below.
const LIMEN_LETTER = "2026-07-05T08:00:00.000Z"; // the fixture's limen → postmaster, delivered at 08:00Z
const EXPECT = {
  wright: { last_active: "2026-07-03T10:00:00.000Z", last_active_crossing: 42 },            // a say: the clock at its time, never its stored 39
  limen: { last_active: LIMEN_LETTER, last_active_crossing: currentCrossing(Date.parse(LIMEN_LETTER)) }, // a letter beats an older walk
  postmaster: { last_active: "2026-07-05T20:00:00.000Z", last_active_crossing: 47 },         // only a letter
  quiet: { last_active: null, last_active_crossing: null },                                  // only received, and a join row
  decorator: { last_active: "2026-07-08T15:00:00.000Z", last_active_crossing: 53 },          // only a window re-hung (a page edit, O3)
};
const pick = (r) => ({ last_active: r.last_active, last_active_crossing: r.last_active_crossing });

before(async () => {
  s = await startStore({ db: "last_active" });
  if (s.skip) { skip = s.skip; return; }
  db = fixtureDb(dbPath);
  db.prepare("INSERT INTO residents VALUES (?, ?)").run("quiet", JSON.stringify({ handle: "quiet", is_office: false,
    last_active: "2026-07-06T09:00:00.000Z", address: { data: { joined: "2026-07-01", pronouns: "they/them" }, body: "# Quiet" } }));
  db.prepare("INSERT INTO residents VALUES (?, ?)").run("decorator", JSON.stringify({ handle: "decorator", is_office: false,
    address: { data: { joined: "2026-07-02" }, body: "# Decorator" } }));
  // quiet RECEIVES a letter, delivered after every other seed: if received mail counted, quiet would read
  // it (POS-481 review, O7). Its sender is a stranger to the roll, so no other row moves.
  db.prepare("INSERT INTO letters VALUES (?,?,?,?,?,?,?,?,?,?)").run("a-stranger-2026-07-10-to-quiet-hello", "a-stranger", "quiet",
    "2026-07-10", null, "inbox", "quiet", "WHITE_PAGES/quiet/inbox/x.md",
    JSON.stringify({ id: "a-stranger-2026-07-10-to-quiet-hello", from: "a-stranger", to: "quiet", date: "2026-07-10", body: "# Hello", delivered_at: "2026-07-10T12:04:00.000Z" }), "2026-07-10T12:04:00.000Z");
  const w = await s.connect("law_ingester");
  await copyIndexToStore(w, db);
  await w.end();
  su = await s.connect("postgres");
  // the acts: at, crossing, actor, action, class. Each is inserted now, long after its `at`;
  // the stored crossing is never what a door says (the clock at `at` is).
  const act = (at, crossing, actor, action, cls = "voice") =>
    su.query("INSERT INTO acts (at, crossing, actor, action, class) VALUES ($1, $2, $3, $4, $5)", [at, crossing, actor, action, cls]);
  await act("2026-06-20T10:00:00Z", 16, "wright", "walk", "move");
  await act("2026-07-03T10:00:00Z", 39, "wright", "say"); // a stored crossing the clock disagrees with: the clock wins
  await act("2026-07-04T13:00:00Z", 44.5, "limen", "walk", "move");
  await act("2026-09-01T00:00:00Z", 162, "someone-else", "say");
  // the town journal: a page edit counts (decorator's window), a join does not (quiet's)
  const journal = (cls, act, handle, at) => su.query(
    "INSERT INTO office_town_journal (class, act, household, handle, written_at) VALUES ($1, $2, $3, $3, $4)", [cls, act, handle, at]);
  await journal("update", "window", "decorator", "2026-07-08T15:00:00.000Z");
  await journal("join", "begin", "quiet", "2026-07-09T10:00:00.000Z");
  // one declared house, as the store's registry holds it, so household { read: "house" } has a house to read
  await su.query(`INSERT INTO households (slug, ord, name, residents, since, declared_by) VALUES ('fixture-house', 1, 'Fixture House', '{wright,limen,quiet,decorator}', '2026-06-12', 'test')`);

  const { default: pg } = await import("pg");
  const real = new pg.Pool({ connectionString: s.url("office_api"), max: 3 });
  real.on("error", () => {});
  // the pen's pool, counting the statements that read the acts table
  pool = new Proxy(real, { get: (t, k) => k !== "connect" ? (typeof t[k] === "function" ? t[k].bind(t) : t[k]) : async () => {
    const c = await t.connect();
    if (!c.__counted) {
      const q = c.query.bind(c);
      c.query = (text, ...rest) => { if (typeof text === "string" && /FROM acts/.test(text)) statements.push(text); return q(text, ...rest); };
      c.__counted = true;
    }
    return c;
  } });
  pen = await import("../src/world2-pen.mjs");

  for (const [name, env] of [["plain", { WORLD2_PG: "1", WORLD2_PG_URL: s.url("office_api") }],
    ["switched", { TOWN_INDEX_READS: "store", WORLD2_PG: "1", WORLD2_PG_URL: s.url("office_api") }],
    ["cut-off", { WORLD2_PG: "1", WORLD2_PG_URL: "postgres://office_api:x@127.0.0.1:9/none" }]]) {
    const child = spawn(process.execPath, [join(ROOT, "src", "server.mjs"), "--port", "0", "--db", dbPath,
      "--oauth-db", seedStaticKeys(join(tmp, `${name}-oauth.db`), `${KEY}=fixture-house:wright`), "--roles-db", join(tmp, `${name}-roles.db`)], {
      env: { ...process.env, TOWN_CLONE: join(tmp, "no-clone-here"), WORLD_CLONE: join(tmp, "no-world-clone"), VOICES_LOG: join(tmp, `${name}-voices.jsonl`),
        TOWN_PUSH: "", WORLD_APEX: "1" /* the apexes, as prod serves them */, WORLD_STORE_DB: join(tmp, "no-world.db"), OFFICE_READ_WORKERS: "0",
        TOWN_INDEX_READS: undefined, WORLD2_PG: undefined, WORLD2_PG_URL: undefined, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    await new Promise((ok, no) => {
      const t = setTimeout(() => no(new Error(`${name}: the office never listened`)), 20_000);
      child.stdout.on("data", (d) => { const m = /listening on :(\d+)/.exec(String(d)); if (m) { clearTimeout(t); offices[name] = { child, base: `http://127.0.0.1:${m[1]}` }; ok(); } });
      child.on("exit", (c) => no(new Error(`${name}: the office exited early (${c})`)));
    });
  }
});

after(async () => {
  for (const { child } of Object.values(offices)) if (child.exitCode === null) { const gone = new Promise((ok) => child.on("exit", ok)); child.kill(); await gone; }
  if (pen) pen.__setPoolForTest(null);
  if (pool) await Promise.race([pool.end().catch(() => {}), new Promise((ok) => setTimeout(ok, 2000))]);
  if (su) await su.end().catch(() => {});
  if (s?.stop) await s.stop();
  db?.close();
  for (const [k, v] of Object.entries(KEEP)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

/** One tools/call over the office's own /mcp door, with the suite's key; the tool's JSON answer. */
const mcp = async (office, name, args) => {
  const res = await fetch(`${offices[office].base}/mcp`, {
    method: "POST",
    headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  });
  assert.equal(res.status, 200, `${office} /mcp ${name}: ${res.status}`);
  const text = await res.text();
  const body = JSON.parse(text.startsWith("{") ? text : text.split(/\r?\n/).find((l) => l.startsWith("data: ")).slice(6));
  assert.ok(body.result?.content?.[0]?.text, `${office} /mcp ${name}: ${text.slice(0, 300)}`);
  return JSON.parse(body.result.content[0].text);
};

const get = async (office, path) => {
  const res = await fetch(`${offices[office].base}${path}`);
  assert.equal(res.status, 200, `${office} ${path}: ${res.status}`);
  return res.json();
};

for (const office of ["plain", "switched"]) {
  test(`${office} office: GET /residents carries each resident's newest act of their own`, async (t) => {
    if (skip) return t.skip(skip);
    const page = await get(office, "/residents");
    assert.equal(page.last_active_unavailable, undefined);
    for (const [h, want] of Object.entries(EXPECT))
      assert.deepEqual(pick(page.residents.find((r) => r.handle === h)), want, h);
    // POS-383 rides this row: pronouns where the address sets them, no key otherwise
    assert.equal(page.residents.find((r) => r.handle === "quiet").pronouns, "they/them");
    assert.equal("pronouns" in page.residents.find((r) => r.handle === "wright"), false);
  });

  test(`${office} office: GET /residents/{h} carries it on the card, and search carries none of it`, async (t) => {
    if (skip) return t.skip(skip);
    for (const [h, want] of Object.entries(EXPECT)) assert.deepEqual(pick(await get(office, `/residents/${h}`)), want, h);
    // search finds; the fact lives on the resident's own row, in one shape (review O5)
    const found = await get(office, "/search?q=limen");
    assert.ok(found.residents.includes("limen"));
    assert.equal("residents_last_active" in found, false);
  });

  test(`${office} office: town { read: "resident" } over /mcp and household { read: "house" } carry them, through the production readers`, async (t) => {
    if (skip) return t.skip(skip);
    for (const h of ["wright", "limen", "decorator"]) {
      const card = await mcp(office, "town", { read: "resident", args: { handle: h } });
      assert.deepEqual(pick(card.resident ?? card), EXPECT[h], `town resident ${h}: ${JSON.stringify(card).slice(0, 200)}`);
    }
    const house = await get(office, "/household?read=house&household=fixture-house");
    assert.equal(house.read, "house", JSON.stringify(house).slice(0, 200));
    for (const h of ["wright", "limen", "quiet", "decorator"]) assert.deepEqual(pick(house.residents[h]), EXPECT[h], `house ${h}`);
    assert.equal(house.last_active_unavailable, undefined);
  });

  test(`${office} office: household { read: "address" } carries the same two fields as /residents/{h}`, async (t) => {
    if (skip) return t.skip(skip);
    for (const h of Object.keys(EXPECT)) {
      const { address } = await get(office, `/household?read=address&handle=${h}`);
      assert.deepEqual(pick(address), pick(await get(office, `/residents/${h}`)), h);
      assert.deepEqual(pick(address), EXPECT[h], h);
    }
  });
}

test("a letter sent at crossing N reads crossing N (the acceptance)", async (t) => {
  if (skip) return t.skip(skip);
  const card = await get("plain", "/residents/limen");
  assert.equal(card.last_active, LIMEN_LETTER);
  assert.equal(card.last_active_crossing, 46);
});

test("an office whose store is gone answers the roll, and says why last_active is null", async (t) => {
  if (skip) return t.skip(skip);
  const page = await get("cut-off", "/residents");
  assert.ok(page.residents.length >= 4, "the roll still answers from office.db");
  assert.equal(page.last_active_unavailable, LAST_ACTIVE_UNAVAILABLE);
  for (const r of page.residents) assert.deepEqual(pick(r), { last_active: null, last_active_crossing: null }, r.handle);
  const card = await get("cut-off", "/residents/wright");
  assert.equal(card.last_active_unavailable, LAST_ACTIVE_UNAVAILABLE);
  assert.equal(card.last_active, null, "never the index's commit-derived value");
});

for (const switched of [false, true]) {
  test(`MCP (switch ${switched ? "on" : "off"}): one statement reads the acts for a whole page`, async (t) => {
    if (skip) return t.skip(skip);
    Object.assign(process.env, { WORLD2_PG: "1", WORLD2_PG_URL: s.url("office_api") });
    if (switched) process.env.TOWN_INDEX_READS = "store"; else delete process.env.TOWN_INDEX_READS;
    pen.__setPoolForTest(pool);
    const { callTool } = await import("../src/mcp.mjs");
    const ctx = { db, meta: {}, key: fixtureKey, asOf: "fixture", clone: join(tmp, "no-clone-here"), canWrite: false };
    statements.length = 0;
    const page = await callTool("list_residents", {}, ctx);
    assert.equal(statements.length, 1, `one statement for ${page.residents.length} residents, got ${statements.length}`);
    for (const [h, want] of Object.entries(EXPECT)) assert.deepEqual(pick(page.residents.find((r) => r.handle === h)), want, h);
    statements.length = 0;
    const card = await callTool("read_resident", { handle: "limen" }, ctx);
    assert.deepEqual(pick(card), EXPECT.limen);
    const found = await callTool("search_town", { q: "wright" }, ctx);
    assert.equal("residents_last_active" in found, false);
    assert.equal(statements.length, 1, "one for the card; search reads no acts");
  });
}

test("pickLastActive: the newest of the two sources wins, and its crossing is the clock's at that time", () => {
  const m = pickLastActive([
    { handle: "a", at: "2026-07-03T10:00:00.000Z", src: "act" },
    { handle: "a", at: "2026-07-02T08:00:00Z", src: "letter" },
    { handle: "b", at: "2026-07-01T00:00:00.000Z", src: "act" },
    { handle: "b", at: "2026-07-05T20:00:00Z", src: "letter" },
    { handle: "c", at: "not a time", src: "letter" },
  ]);
  assert.deepEqual(m.get("a"), { at: "2026-07-03T10:00:00.000Z", crossing: 42 });
  assert.deepEqual(m.get("b"), { at: "2026-07-05T20:00:00.000Z", crossing: 47 });
  assert.equal(m.has("c"), false);
});
