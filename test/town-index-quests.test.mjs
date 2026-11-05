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
import { twinGolden, steady } from "./helpers/twin-golden.mjs";
import { overlayRegistry, firstDiffPath } from "./helpers/pos896-fixtures.mjs";
import { townClone, townModuleUrl } from "./fixture-paths.mjs";
import * as store from "../src/town-index-store.mjs";
import { estateRead, questsRead, fundReadOf } from "../src/household-stamps.mjs";
import { openOauthDb } from "../src/oauth.mjs";

// THE OFFICE'S SIGN-IN FILE EXISTS before it boots (POS-271's boot guard): an
// unswitched office whose oauth.db is missing asks the store whether it holds
// the town's sign-ins, and refuses to boot when it cannot ask. The cut-off
// office's store is dead on purpose, so its file is made first, as every
// office past its first boot has one. This file is about the index, not sign-in.
const existingOauthDb = (path) => { openOauthDb(path).close(); return path; };

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
      "--oauth-db", existingOauthDb(join(tmp, `${name}-oauth.db`)), "--roles-db", join(tmp, `${name}-roles.db`)], {
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
const same = async (label, newAnswer) => eq(label, JSON.stringify(await newAnswer));

// THE EXPECTED SIDE FOLLOWS THE PRISTINE REGISTRY (POS-896). The recorded twin answers hold the quest list and the pot
// postings of the town the record was made on. The store reads the PINNED town's registry (put into `meta` in before()), so
// when the pin moves it holds more quests and more bounty postings than the record, and the old comparison reddened although
// the store was right. `expectedFor` is the record for this label with exactly those two branches following the registry FILE
// (helpers/pos896-fixtures.mjs § overlayRegistry): the quest rows in the file's order (a row the record holds kept byte for
// byte, a missing one built from the file's row, never from the store's answer), and the postings for the file's bounty ids
// that have no pot in this fixture's pot table. Everything else stays the record's, compared as bytes.
const FIXTURE_POT_IDS = ["darko-fund", "Keeping", "a-closed-pot"];   // the pots before() puts in the store; a bounty id outside it has no pot file
const rawQuests = () => JSON.parse(readFileSync(join(TOWN, "quest-registry.json"), "utf8")).quests;
const expectedFor = (label) => overlayRegistry(TWINS.of(label), { rawQuests: rawQuests(), fixturePotIds: FIXTURE_POT_IDS });
const eq = (label, value) => assert.equal(steady(value), expectedFor(label), label);
const eqResponse = async (label, response, message = label) => {
  const body = await response.text();
  assert.equal(steady({ status: response.status, body: steady(body) }), expectedFor(label), message);
  return body;
};

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
    await eqResponse(`REST ${door}`, b, `${door}: status and body`);
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
      eq(`read_quests ${h}`, norm(await callTool("read_quests", { handle: h }, { clone: TOWN })));
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
    for (const a of asks) eq(`household ${JSON.stringify(a)}`, norm(await householdApex(a, KEY, CTX)));
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

// ── THE DETECTORS (POS-896): an invented registry and an invented record, the pristine expectation held fixed ────────────────
// `overlayRegistry` is the expected side; it never reads the answer. Each detector below compares an ANSWER that is wrong in one
// way to that same pristine expectation, with the very comparison the suite makes (byte equality), and names the first place
// they part. A positive case first shows the overlay follows a registry that gained a quest and a bounty.
const INV_UNCOUNTED = { measured: false, progress: null, complete: null, counted: [], household: { size: 2, total: null, cap_shared: false } };
const invRow = (id, over = {}) => ({ id, title: `Title of ${id}`, cadence: "one-time", validation: "automatic", target: 1, reward: "2 stamps", source: `Do ${id}.`, door: null, ...INV_UNCOUNTED, ...over });
const INV_POSTING = (id) => ({ row_kind: "pot-posting", line: `quest-registry.json § ${id}`, reason: `the board posts a bounty for pot "${id}" but no WHITE_PAGES/pot-${id}.json stands behind it — the posting has no pot` });
// the record: a registry of two quests and one bounty (no pot file for it), a bad pot file beside the posting
const INV_LEGACY = {
  handle: "inv", quests: [invRow("inv-a"), invRow("inv-b", { cadence: "daily", target: 3, progress: 1, complete: false, counted: ["x"], measured: true })],
  pots: { invalid_rows: { list: [{ row_kind: "pot-file", line: "WHITE_PAGES/pot-bad.json", reason: "unparseable JSON" }, INV_POSTING("inv-fund-a")] } },
};
const INV_RAW = [
  { id: "inv-a", title: "Title of inv-a", cadence: "one-time", validation: "automatic", target: 1, reward: "2 stamps", source: "Do inv-a." },
  { id: "inv-b", title: "Title of inv-b", cadence: "daily", validation: "automatic", target: 3, reward: "2 stamps", source: "Do inv-b." },
  { id: "inv-fund-a", title: "A pot", cadence: "ongoing", subtype: "bounty", validation: "needs-review" },
];
// the pristine registry later: one more needs-review milestone (after the two) and one more bounty (between the two postings' places)
const INV_RAW_NEXT = [...INV_RAW.slice(0, 2),
  { id: "inv-m", title: "A milestone", cadence: "milestone", validation: "needs-review", target: 1, reward: "5 stamps, once", source: "Tell us.", awaits: "a hand reads it" },
  { id: "inv-fund-b", title: "Another pot", cadence: "ongoing", subtype: "bounty", validation: "needs-review" }, INV_RAW[2]];
const invExpected = (rawQuests, legacy = INV_LEGACY) => overlayRegistry(steady(legacy), { rawQuests, fixturePotIds: [] });
const NEXT = JSON.parse(invExpected(INV_RAW_NEXT));

test("detector · the overlay at the SAME registry changes nothing, byte for byte (the record stands where the registry stands)", () => {
  assert.equal(invExpected(INV_RAW), steady(INV_LEGACY));
});

test("detector · a registry that gained a milestone and a bounty: the new row is built from the file's row, in the file's order, and the posting follows the registry's order", () => {
  assert.deepEqual(NEXT.quests.map((q) => q.id), ["inv-a", "inv-b", "inv-m"]);
  assert.deepEqual(NEXT.quests[2], {
    id: "inv-m", title: "A milestone", cadence: "milestone", validation: "needs-review", target: 1, reward: "5 stamps, once", source: "Tell us.",
    door: null, awaits: "a hand reads it", progress: null, complete: null, counted: [], household: { size: 2, total: null, cap_shared: false }, measured: false,
  });
  assert.deepEqual(NEXT.quests.slice(0, 2), INV_LEGACY.quests, "the record's own rows are kept exactly");
  assert.deepEqual(NEXT.pots.invalid_rows.list.map((r) => r.line), ["WHITE_PAGES/pot-bad.json", "quest-registry.json § inv-fund-b", "quest-registry.json § inv-fund-a"],
    "the pot-file row keeps its place; the postings follow the registry's order (inv-fund-b before inv-fund-a), and the id is in the record's wording");
  assert.ok(NEXT.pots.invalid_rows.list[1].reason.includes('pot "inv-fund-b"') && NEXT.pots.invalid_rows.list[1].reason.includes("pot-inv-fund-b.json"));
});

test("detector · a bounty that HAS a pot file is not a posting row", () => {
  const withPot = JSON.parse(overlayRegistry(steady(INV_LEGACY), { rawQuests: INV_RAW_NEXT, fixturePotIds: ["inv-fund-b"] }));
  assert.deepEqual(withPot.pots.invalid_rows.list.map((r) => r.line), ["WHITE_PAGES/pot-bad.json", "quest-registry.json § inv-fund-a"]);
});

test("detector · a counted row the record does not hold has no independent expectation and throws by name (it is never invented)", () => {
  const counted = [...INV_RAW, { id: "inv-new-daily", title: "t", cadence: "daily", validation: "automatic", target: 2, reward: "1 stamp", source: "s" }];
  assert.throws(() => invExpected(counted), /no independent expectation for registry quest "inv-new-daily"/);
});

test("detector · each wrong ANSWER is named against the fixed expectation: missing, duplicated, changed and misplaced quests; missing, extra and misnamed postings", () => {
  const want = invExpected(INV_RAW_NEXT);
  const answer = () => structuredClone(NEXT);   // the right answer, then ONE thing wrong per case
  const parts = (mutate) => { const a = answer(); mutate(a); return firstDiffPath(steady(a), want); };
  assert.equal(firstDiffPath(steady(answer()), want), null, "the control: the right answer equals the expectation");
  assert.equal(parts((a) => a.quests.pop()), "$.quests.length", "the new quest missing");
  assert.equal(parts((a) => a.quests.push({ ...a.quests[2] })), "$.quests.length", "the new quest twice");
  assert.equal(parts((a) => { a.quests[2].reward = "6 stamps, once"; }), "$.quests[2].reward", "a changed reward");
  assert.equal(parts((a) => { a.quests[2].measured = true; }), "$.quests[2].measured", "a row measured that is not");
  assert.equal(parts((a) => { a.quests[0].progress = 4; }), "$.quests[0].progress", "a record row that moved");
  assert.equal(parts((a) => a.quests.reverse()), "$.quests[0].id", "the registry's order lost");
  assert.equal(parts((a) => a.pots.invalid_rows.list.pop()), "$.pots.invalid_rows.list.length", "a posting missing");
  assert.equal(parts((a) => a.pots.invalid_rows.list.push(INV_POSTING("inv-ghost"))), "$.pots.invalid_rows.list.length", "an extra posting");
  assert.equal(parts((a) => { a.pots.invalid_rows.list[1] = INV_POSTING("inv-fund-c"); }), "$.pots.invalid_rows.list[1].line", "a posting for the wrong id");
  assert.equal(parts((a) => a.pots.invalid_rows.list.reverse()), "$.pots.invalid_rows.list[0].row_kind", "the postings before the pot-file row");
});
