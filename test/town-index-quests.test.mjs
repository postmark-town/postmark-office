// town-index-quests.test.mjs — group 1 of POS-268: the pots and the quest
// boards answer from the store exactly as their office.db twins did.
//
//   EMBEDDED_PG_DIR=<dir with embedded-postgres> node --test test/town-index-quests.test.mjs
//
// One fixture town, built here, holds three pots (a roll, receipts with a tie on
// date, escrow with a tie on stake, an invalid funding row), quest progress for
// today and yesterday's shape, and a standing row. The store is seeded from those
// rows (helpers/index-to-store.mjs). Each reader and each door that reads through
// them is compared as the bytes it sends, to the twin's answer over the same rows
// recorded in the last tree that had office.db (helpers/twin-golden.mjs, POS-656):
// potBoard, standingFor, the quest board (a resident's and the town's),
// household-stamps' three reads, GET /quests/{h} and read_quests. The
// quest tools are the pinned town clone's own (fixture-paths.mjs); without the
// clone or without a Postgres the file SKIPS and says which.

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

import { fixtureTown, putValues } from "./fixture.mjs";
import { startStore } from "./helpers/embedded-store.mjs";
import { seedTownIndex } from "./helpers/index-to-store.mjs";
import { twinGolden } from "./helpers/twin-golden.mjs";
import { townClone, townModuleUrl } from "./fixture-paths.mjs";
import * as store from "../src/town-index-store.mjs";
import { estateRead, questsRead, fundReadOf } from "../src/household-stamps.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TWINS = twinGolden("town-index-quests");
const TOWN = townClone();
const tmp = mkdtempSync(join(tmpdir(), "town-index-quests-"));
let s = null, skip = TOWN ? false : "no town clone beside the office: the quest board reads the town's own tools from it";
let api, db;
const offices = {};

before(async () => {
  if (skip) return;
  s = await startStore();
  if (s.skip) { skip = s.skip; return; }
  const { townDay } = await import(townModuleUrl("tools", "quest-progress.mjs"));
  db = fixtureTown();
  const put = (...v) => putValues(db, "meta", v);
  put("quest_registry", readFileSync(join(TOWN, "quest-registry.json"), "utf8"));
  put("quest_day", townDay());
  const qp = (...v) => putValues(db, "quest_progress", v, ["handle", "send", "receive", "house_size", "house_send", "house_receive", "sent_to", "heard_from"]);
  qp("wright", 2, 1, 1, 2, 1, JSON.stringify(["limen", "errant"]), JSON.stringify(["limen"]));
  qp("limen", 0, 3, 2, 1, 3, "not json", null);
  putValues(db, "quest_standing", ["wright", JSON.stringify({ facts: { address: true, home: true }, since: { "first-letter-out": "2026-07-02" } })]);
  const pot = (...v) => putValues(db, "pots", v);
  pot("darko-fund", JSON.stringify({ title: "Darko's fund", beneficiary: "keeminlee", target_usd_per_epoch: 100, received_usd: 40, epoch_cadence: "monthly", status: "open", close: "epoch", first_close: "2026-10-31" }));
  pot("Keeping", JSON.stringify({ title: "Keeping", beneficiary: "the-town", target_usd_per_epoch: 0, status: "open", close: "elastic", min_close_usd: 5 }));
  pot("a-closed-pot", JSON.stringify({ title: "Closed", beneficiary: "wright", status: "closed" }));
  const rc = (...v) => putValues(db, "pot_receipts", v, ["pot", "rail", "usd", "date", "receipt", "payer"]);
  rc("darko-fund", "stripe", 25, "2026-09-02", "cs_b", "wright");
  rc("darko-fund", "paypal", 15.5, "2026-09-02", "pp_a", "limen");
  rc("darko-fund", "usdc", 10, "2026-09-01", "0xabc", "limen");
  const roll = (...v) => putValues(db, "funding_roll", v, ["patron", "pot", "usd", "date", "receipt", "holo"]);
  roll("wright", "darko-fund", 25, "2026-09-02", "cs_b", 3);
  putValues(db, "pot_escrow", ["darko-fund", 9]);
  const sk = (...v) => putValues(db, "pot_stakers", v);
  sk("darko-fund", "wright", 3); sk("darko-fund", "Zed", 3); sk("darko-fund", "limen", 3);
  putValues(db, "funding_invalid", ["pot-file", "WHITE_PAGES/pot-bad.json", "unparseable JSON"], ["row_kind", "line", "reason"]);
  const w = await s.connect("law_ingester");
  await seedTownIndex(w, db);
  await w.end();
  api = await s.connect("office_api");

  // the door over the store, and one whose store is gone; a pot board's gifts
  // name their households from the store's registry (POS-550), as on the box
  for (const [name, env] of [["switched", { WORLD2_PG: "1", WORLD2_PG_URL: s.url("office_api") }],
    ["cut-off", { WORLD2_PG: "1", WORLD2_PG_URL: "postgres://office_api:x@127.0.0.1:9/none" }]]) {
    const child = spawn(process.execPath, [join(ROOT, "src", "server.mjs"), "--port", "0",
      "--oauth-db", join(tmp, `${name}-oauth.db`), "--roles-db", join(tmp, `${name}-roles.db`)], {
      env: { ...process.env, WORLD_GRAPH_NONE: "1", TOWN_CLONE: TOWN, WORLD_CLONE: join(tmp, "no-world-clone"), VOICES_LOG: join(tmp, `${name}-voices.jsonl`),
        TOWN_PUSH: "", WORLD_STORE_DB: join(tmp, "no-world.db"), OFFICE_READ_WORKERS: "0",
        WORLD2_PG: undefined, WORLD2_PG_URL: undefined, ...env },
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
  if (api) await api.end().catch(() => {});
  if (s?.stop) await s.stop();
  rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

// the bytes a door sends, key order included
const same = async (label, newAnswer) => TWINS.equal(label, JSON.stringify(await newAnswer));

test("potBoard and standingFor answer as their office.db twins did", async (t) => {
  if (skip) return t.skip(skip);
  await same("potBoard", store.potBoard(api));
  const extra = [{ row_kind: "pot-posting", line: "quest-registry.json § ghost", reason: "no pot" }];
  await same("potBoard with extra invalid rows", store.potBoard(api, extra));
  for (const h of ["wright", "limen", "nobody"]) await same(`standingFor ${h}`, store.standingFor(api, h));
});

test("the quest board answers as its office.db twin did, for a resident and for the town", async (t) => {
  if (skip) return t.skip(skip);
  for (const h of ["wright", "limen", "nobody", null, ""])
    await same(`questBoardFor ${JSON.stringify(h)}`, (async () => store.questBoardOfRows(await store.questIndexRows(api, h), TOWN, { worldSited: null }))()); // POS-370: the rows in the transaction, the board after it
});

test("household-stamps' estate, quests and fund reads answer as they did over office.db", async (t) => {
  if (skip) return t.skip(skip);
  const ix = store.storeIndex(api, TOWN); // one client, the reader-level twin; the door itself uses storeIndexPooled (the last test)
  const key = { household: "keemin", handles: new Set(["wright", "limen"]) };
  await same("estateRead", estateRead(key, { clone: TOWN, ix }));
  for (const h of ["wright", null]) await same(`questsRead ${h}`, questsRead(h, { ix }));
  await same("fundRead", (async () => fundReadOf((await ix.potBoard()).list, { stripeUrl: "https://buy.stripe.com/x" }))());
});

test("GET /quests/{h} answers as the unswitched office did, and names the index it read", async (t) => {
  if (skip) return t.skip(skip);
  for (const door of ["/quests/wright", "/quests/limen", "/quests/nobody"]) {
    const b = await fetch(offices.switched.base + door);
    await TWINS.equalResponse(`REST ${door}`, b, `${door}: status and body`);
    assert.equal(b.headers.get("x-postmark-town-index-as-of"), "fixturesha000000000000000000000000000000", `${door}: names the index it read`);
  }
});

test("a /quests/{h} whose store is gone answers the store's 503", async (t) => {
  if (skip) return t.skip(skip);
  const r = await fetch(offices["cut-off"].base + "/quests/wright");
  assert.equal(r.status, 503);
  assert.match((await r.json()).defect, /town index \(the store\) cannot be reached/);
});

test("read_quests through callTool answers as the unswitched office did", async (t) => {
  if (skip) return t.skip(skip);
  const { callTool } = await import("../src/mcp.mjs");
  const keep = { WORLD2_PG: process.env.WORLD2_PG, WORLD2_PG_URL: process.env.WORLD2_PG_URL };
  const { default: pg } = await import("pg");
  const pool = new pg.Pool({ connectionString: s.url("office_api"), max: 2 });
  const pen = await import("../src/world2-pen.mjs");
  try {
    const norm = (o) => { const c = structuredClone(o); if (c?.today) c.today = { day: c.today.day }; return JSON.stringify(c); };
    Object.assign(process.env, { WORLD2_PG: "1", WORLD2_PG_URL: s.url("office_api") }); // the registry (POS-550)
    pen.__setPoolForTest(pool);
    for (const h of ["wright", null])
      TWINS.equal(`read_quests ${h}`, norm(await callTool("read_quests", { handle: h }, { clone: TOWN })));
  } finally {
    pen.__setPoolForTest(null); await pool.end();
    for (const [k, v] of Object.entries(keep)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
});

test("household { read: stamps | quests | fund } answers through the store as it did over office.db, and 503s when the store is gone", async (t) => {
  if (skip) return t.skip(skip);
  const { householdApex } = await import("../src/household-apex.mjs");
  const KEY = { household: "keemin", handles: new Set(["wright", "limen"]) };
  const CTX = { clone: TOWN, asOf: "fixture" };
  const asks = [{ read: "stamps" }, { read: "quests", handle: "wright" }, { read: "fund" }];
  const keep = { WORLD2_PG: process.env.WORLD2_PG, WORLD2_PG_URL: process.env.WORLD2_PG_URL };
  const { default: pg } = await import("pg");
  const pool = new pg.Pool({ connectionString: s.url("office_api"), max: 2 });
  const pen = await import("../src/world2-pen.mjs");
  const norm = (o) => { const c = structuredClone(o); if (c?.today) c.today = { day: c.today.day }; return JSON.stringify(c); };
  try {
    Object.assign(process.env, { WORLD2_PG: "1", WORLD2_PG_URL: s.url("office_api") }); // the registry (POS-550)
    pen.__setPoolForTest(pool);
    for (const a of asks) TWINS.equal(`household ${JSON.stringify(a)}`, norm(await householdApex(a, KEY, CTX)));
    // the store gone: a pool whose every connect fails
    pen.__setPoolForTest({ connect: async () => { throw new Error("ECONNREFUSED"); } });
    for (const a of asks) {
      const r = await householdApex(a, KEY, CTX);
      assert.equal(r.code, 503, `household ${JSON.stringify(a)}: ${JSON.stringify(r).slice(0, 160)}`);
      assert.match(r.defect, /town index \(the store\) cannot be reached/);
    }
  } finally {
    pen.__setPoolForTest(null); await pool.end();
    for (const [k, v] of Object.entries(keep)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
});

test("a switched reader that throws is answered with a 500, and the office stays up", async (t) => {
  if (skip) return t.skip(skip);
  // a bent row in the STORE only (a region no other answer here reads)
  const w = await s.connect("law_ingester");
  await w.query("INSERT INTO town_regions (id, name, json, digest) VALUES ('bent-region', 'Bent', 'not json', 'x')");
  await w.end();
  const r = await fetch(offices.switched.base + "/regions");
  assert.equal(r.status, 500, "the reader's own error is the office's 500, not an unanswered rejection");
  assert.match((await r.json()).defect, /tripped reading the town index/);
  assert.equal((await fetch(offices.switched.base + "/quests/wright")).status, 200, "and the office is still answering");
});
