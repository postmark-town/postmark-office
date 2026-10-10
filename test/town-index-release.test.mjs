// town-index-release.test.mjs — every store read gives its connection back, on an answer and on a throw (POS-268 part 5a).
//
//   node --test test/town-index-release.test.mjs
//
// The POS-370 class: on 2026-10-04 switch 2 left office_api sessions idle in a
// transaction and the index reads stalled for an hour. Every family of door
// that reads the town index from the store is asked here, in this process, on a
// pen pool of prod's size (three), the way the MCP door and the REST door both
// reach it (storeAnswer -> officeRead). After each answer the pool holds
// nothing and nobody waits for it, and the store has no office_api session
// idle in a transaction. Then the family's table is taken away under it (the
// reader throws inside the transaction, the ROLLBACK path) and the same is
// asserted again.
//
// Each door is handed an office.db that throws on any read and a meta that
// throws on any key, as a switched office now holds (server.mjs §
// ABSENT_INDEX), so a door that still read office.db would fail here too.

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { fixtureDb, fixtureKey } from "./fixture.mjs";
import { startStore } from "./helpers/embedded-store.mjs";
import { copyIndexToStore } from "./helpers/index-to-store.mjs";
import { townClone, townModuleUrl } from "./fixture-paths.mjs";

const TOWN = townClone();
const tmp = mkdtempSync(join(tmpdir(), "town-index-release-"));
const KEEP = Object.fromEntries(["TOWN_INDEX_READS", "WORLD2_PG", "WORLD2_PG_URL"].map((k) => [k, process.env[k]]));
let s = null, su = null, pool = null, pen = null, skip = false;

// what a switched office holds where office.db was (server.mjs § ABSENT_INDEX)
const officeDbRead = () => { throw new Error("office.db was read by a switched door"); };
const ABSENT_DB = Object.freeze({ prepare: officeDbRead, exec: officeDbRead, close() {} });
const ABSENT_META = new Proxy({}, { get: (_t, k) => (typeof k === "symbol" || k === "then" ? undefined : officeDbRead()), ownKeys: officeDbRead });

before(async () => {
  s = await startStore({ db: "index_release" });
  if (s.skip) { skip = s.skip; return; }
  const db = fixtureDb(join(tmp, "office.db"));
  if (TOWN) {
    const { townDay } = await import(townModuleUrl("tools", "quest-progress.mjs"));
    const put = db.prepare("INSERT OR REPLACE INTO meta VALUES (?, ?)");
    put.run("quest_registry", readFileSync(join(TOWN, "quest-registry.json"), "utf8"));
    put.run("quest_day", townDay());
    db.prepare("INSERT INTO quest_progress (handle, send, receive, house_size, house_send, house_receive, sent_to, heard_from) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run("wright", 2, 1, 1, 2, 1, JSON.stringify(["limen"]), JSON.stringify(["limen"]));
    db.prepare("INSERT INTO pots VALUES (?, ?)").run("darko-fund", JSON.stringify({ title: "Darko's fund", beneficiary: "keeminlee", target_usd_per_epoch: 100, status: "open", close: "epoch" }));
  }
  const w = await s.connect("law_ingester");
  await copyIndexToStore(w, db);
  await w.end();
  db.close();
  su = await s.connect("postgres"); // the superuser, on this test's own database
  Object.assign(process.env, { TOWN_INDEX_READS: "store", WORLD2_PG: "1", WORLD2_PG_URL: s.url("office_api") });
  const { default: pg } = await import("pg");
  pool = new pg.Pool({ connectionString: s.url("office_api"), max: 3 });
  pool.on("error", () => {});
  pen = await import("../src/world2-pen.mjs");
  pen.__setPoolForTest(pool);
});

after(async () => {
  if (pen) pen.__setPoolForTest(null);
  if (pool) await Promise.race([pool.end().catch(() => {}), new Promise((ok) => setTimeout(ok, 2000))]);
  if (su) { await su.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename = 'office_api' AND datname = current_database()").catch(() => {}); await su.end().catch(() => {}); }
  if (s?.stop) await s.stop();
  for (const [k, v] of Object.entries(KEEP)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

/** The pool holds nothing, nobody waits for it, and no office_api session is idle in a transaction. */
async function nothingHeld(label) {
  assert.deepEqual({ out: pool.totalCount - pool.idleCount, waiting: pool.waitingCount }, { out: 0, waiting: 0 }, `${label}: the pool still holds a connection`);
  const { rows } = await su.query("SELECT left(query, 120) AS query FROM pg_stat_activity WHERE usename = 'office_api' AND datname = current_database() AND state LIKE 'idle in transaction%'");
  assert.deepEqual(rows, [], `${label}: an office_api session is idle in a transaction`);
}

/** Ask, and hand back what came: an answer, or the error it threw. */
const settle = async (ask) => { try { return { ok: await ask() }; } catch (e) { return { threw: e }; } };

/** The table taken away for one ask (the reader throws inside its transaction), then put back. */
async function without(table, ask) {
  await su.query(`ALTER TABLE ${table} RENAME TO ${table}_away`);
  try { return await settle(ask); }
  finally { await su.query(`ALTER TABLE ${table}_away RENAME TO ${table}`); }
}

const ctx = () => ({ db: ABSENT_DB, meta: ABSENT_META, key: fixtureKey, asOf: "fixture", clone: TOWN, canWrite: false });
const tool = (name, args) => async () => (await import("../src/mcp.mjs")).callTool(name, args, ctx());
const house = (args) => async () => (await import("../src/household-apex.mjs")).householdApex(args, fixtureKey, ctx());
const store = async () => import("../src/town-index-store.mjs");

// Each family: its doors, and the table its store reader reads. `town` marks a
// family whose answer needs the town's own tools from a clone; `roster` one
// whose reader keeps the roster memo per as-of, forgotten before each ask so
// the ask reads the table; `keeps` one whose refresh keeps the last snapshot
// when its read fails (as a failed office.db reload kept its file), so only the
// connection is asserted after the throw.
const FAMILIES = [
  ["the repo log", "town_repo_log", [tool("list_commits", {})]],
  ["regions", "town_regions", [tool("list_regions", {}), tool("town", { read: "regions" })]],
  ["the bulletin", "town_bulletin", [tool("read_bulletin", {})]],
  ["homes", "town_homes", [tool("read_home", { handle: "wright" })]],
  ["stamps", "town_stamps", [tool("read_stamps", {}), tool("read_stamps", { handle: "wright" }), house({ read: "stamps" })]],
  ["quests", "town_quest_progress", [tool("read_quests", { handle: "wright" }), house({ read: "quests", handle: "wright" })], "town"],
  ["pots and the fund", "town_pots", [house({ read: "fund" })], "town"],
  ["letters", "town_letters", [tool("read_letter", { id: "limen-2026-07-01-to-wright-the-gap" }), tool("list_letters", {}), tool("search_town", { q: "gap" })]],
  ["mail", "town_letters", [tool("list_mail", { handle: "wright" }), house({ read: "mail", handle: "wright" })]],
  ["residents", "town_residents", [tool("list_residents", {}), tool("read_resident", { handle: "wright" }), tool("read_town", {})], "roster"],
  ["the doorstep", "town_residents", [tool("read_doorstep", { handle: "wright" }), house({ read: "doorstep", handle: "wright" })]],
  ["the mail metrics", "town_ledger", [tool("read_metrics", {})]],
  ["the ledger", "town_ledger", [async () => (await store()).storeAnswer(async (c) => (await store()).townLedger(c))]],
  ["the docs", "town_meta", [tool("read_docs", {}), tool("town", { read: "docs" })]],
  ["the write path's probe", "town_residents", [async () => { const tis = await store(); tis.__resetProbeForTest(); return tis.refreshStoreProbe(); }]],
  ["the roll", "town_residents", [async () => (await store()).refreshStoreRoll()], "roster keeps"],
  ["the reply hint's mail_state", "town_mail_state", [async () => (await store()).probeWithMailState("wright")]],
];

for (const [family, table, doors, needs] of FAMILIES) {
  test(`${family}: every door answers and gives its connection back, and gives it back when its read throws`, async (t) => {
    if (skip) return t.skip(skip);
    if (needs?.includes("town") && !TOWN) return t.skip("no town clone beside the office: this family's answer reads the town's own tools from it");
    const tis = await store();
    await tis.refreshStoreProbe(); // a later family's write-path check reads the held probe
    for (const [i, door] of doors.entries()) {
      const ask = needs?.includes("roster") ? async () => { tis.__resetRosterForTest(); return door(); } : door;
      const got = await settle(ask);
      assert.equal(got.threw, undefined, `${family} door ${i}: ${got.threw?.stack ?? ""}`);
      assert.doesNotMatch(JSON.stringify(got.ok ?? null), /office\.db was read|cannot be reached/, `${family} door ${i} answered from the store`);
      await nothingHeld(`${family} door ${i}, answered`);
      const broken = await without(table, ask);
      const said = (r) => (r.threw ? `threw: ${r.threw.message}` : JSON.stringify(r.ok));
      if (!needs?.includes("keeps")) assert.notEqual(said(broken), said(got), `${family} door ${i}: with ${table} gone it answered the same, so it never read ${table}`);
      await nothingHeld(`${family} door ${i}, after its read threw`);
    }
  });
}
