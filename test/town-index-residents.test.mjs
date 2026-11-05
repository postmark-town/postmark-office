// town-index-residents.test.mjs — group 3 of POS-268: the residents, the town
// card and the doorstep answer from the store exactly as their office.db twins did.
//
//   EMBEDDED_PG_DIR=<dir with embedded-postgres> node --test test/town-index-residents.test.mjs
//
// test/fixture.mjs's town plus what the ports had to get right: a handle the
// door could never admit (`_archived`, on the roll's table and never on the
// roll), an office resident, a resident whose handle sorts differently bytewise
// than in an English collation, a window state, and a PSA posting with one
// entry inside the week and one outside it. The store is seeded from those rows.
// Every reader is compared as the bytes a door sends to the twin's answer over
// the same rows, recorded in the last tree that had office.db
// (helpers/twin-golden.mjs, POS-656); then the doors over an office reading the
// store and one whose store is gone, the MCP cases, and household { read:
// address | window | home | doorstep }.

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

import { fixtureTown, putValues } from "./fixture.mjs";
import { startStore } from "./helpers/embedded-store.mjs";
import { seedTownIndex } from "./helpers/index-to-store.mjs";
import { twinGolden, steady } from "./helpers/twin-golden.mjs";
import { overlayStakes, firstDiffPath } from "./helpers/pos896-fixtures.mjs";
import { INVENTED_WORLD, INVENTED_STAKE_ROWS } from "./fixtures/pos896-invented-world.mjs";   // POS-896: a made-up world for two asks, below
import { PSA_SLUG } from "../src/queries.mjs";
import * as store from "../src/town-index-store.mjs";
import { openOauthDb } from "../src/oauth.mjs";

// THE OFFICE'S SIGN-IN FILE EXISTS before it boots (POS-271's boot guard): an
// unswitched office whose oauth.db is missing asks the store whether it holds
// the town's sign-ins, and refuses to boot when it cannot ask. The cut-off
// office's store is dead on purpose, so its file is made first, as every
// office past its first boot has one. This file is about the index, not sign-in.
const existingOauthDb = (path) => { openOauthDb(path).close(); return path; };

// WLD-27's chest and candy doors ship dark (chests-candy.mjs), so these offices run dark, and the doorstep
// answer whose record is read with its `holds` stripped is named here (helpers/twin-golden.mjs § withoutHolds).
delete process.env.WORLD_CHESTS_CANDY;
const DARK = new Set(["REST /doorstep/wright"]);

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TWINS = twinGolden("town-index-residents");
const tmp = mkdtempSync(join(tmpdir(), "town-index-residents-"));
const NOW = Date.parse("2026-07-14T12:00:00Z");
const AS_OF = "fixturesha000000000000000000000000000000";
let s = null, skip = false, api, db;
const offices = {};

before(async () => {
  s = await startStore();
  if (s.skip) { skip = s.skip; return; }
  db = fixtureTown();
  const R = (...v) => putValues(db, "residents", v);
  R("_archived", JSON.stringify({ handle: "_archived", address: { data: { joined: "2026-07-13" } } }));
  R("Zed", JSON.stringify({ handle: "Zed", display: "Zed of the Lamplight", last_active: "2026-07-13T10:00:00.000Z",
    address: { data: { joined: "2026-07-13", github: "zed-gh" }, body: "# Zed" }, window_state: { lit: true, note: "back soon" } }));
  R("illuminator", JSON.stringify({ handle: "illuminator", address: { data: { joined: "2026-07-02", office: "true" }, body: "# The Illuminator" } }));
  putValues(db, "bulletin", [PSA_SLUG, JSON.stringify({ slug: PSA_SLUG, data: { title: "PSAs" },
    body: "# Public service announcements\n\n## 2026-07-12 · The quay reopens\n\nThe steps are dry.\n\n## 2026-06-01 · Old news\n\nLong ago." })]);
  const w = await s.connect("law_ingester");
  await seedTownIndex(w, db);
  await w.end();
  api = await s.connect("office_api");

  for (const [name, env] of [["switched", { WORLD2_PG: "1", WORLD2_PG_URL: s.url("office_api") }],
    ["cut-off", { WORLD2_PG: "1", WORLD2_PG_URL: "postgres://office_api:x@127.0.0.1:9/none" }]]) {
    const child = spawn(process.execPath, [join(ROOT, "src", "server.mjs"), "--port", "0",
      "--oauth-db", existingOauthDb(join(tmp, `${name}-oauth.db`)), "--roles-db", join(tmp, `${name}-roles.db`)], {
      env: { ...process.env, TOWN_CLONE: join(tmp, "no-clone-here"), WORLD_CLONE: join(tmp, "no-world-clone"), VOICES_LOG: join(tmp, `${name}-voices.jsonl`),
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

// the bytes a door sends; a live clock (the next boat, today's minute) is not the index's to agree on
const bytes = (o) => JSON.stringify(o, (k, v) => (k === "next_crossing" || k === "today" ? undefined : v));
// on a difference, the first path that differs, so a red says where rather than printing two whole doorsteps
const firstDiff = (x, y, p = "$") => {
  if (JSON.stringify(x) === JSON.stringify(y)) return null;
  if (!x || !y || typeof x !== "object" || typeof y !== "object") return `${p}: store ${JSON.stringify(x)?.slice(0, 160)} · office ${JSON.stringify(y)?.slice(0, 160)}`;
  const kx = Object.keys(x), ky = Object.keys(y);
  if (kx.join() !== ky.join()) return `${p}: keys store [${kx}] · office [${ky}]`;
  for (const k of kx) { const d = firstDiff(x[k], y[k], `${p}.${k}`); if (d) return d; }
  return null;
};
// a stakes row's `kind` in the record's form: the twins answered on a world that
// files a mark's standing there, and W2 files its class (helpers/kind-forms.mjs;
// the identity on the world CI pins)
const inRecordForm = async (text) => {
  let v;
  try { v = text.includes('"stakes"') ? JSON.parse(text) : null; } catch { v = null; }
  if (v == null) return text;
  const { stakeKindsInOldForm, worldKinds } = await import("./helpers/kind-forms.mjs");
  const { worldClone } = await import("./fixture-paths.mjs");
  return JSON.stringify(await stakeKindsInOldForm(v, () => worldKinds(worldClone())));
};
// THE TWO ASKS THAT READ A WORLD (POS-896). `ask 3` (read_doorstep) and `ask 7` (household { read: "doorstep" }) carry the doorstep's
// `stakes` segment, which reads WORLD_CLONE: until this change the tree's pinned world, whose published marks for wright were
// counted in the record (26) and moved with the pin (285). Those two now run in a process started over an INVENTED world
// (test/fixtures/pos896-doorstep-ask.mjs, test/fixtures/pos896-invented-world.mjs), so the segment's `count` and `rows` below are
// the fixture's own marks (INVENTED_STAKE_ROWS, written out, another owner's mark absent) and every other byte of the two
// answers stays the record's. The other asks, which read the pinned world for wright's home (`ask 8` carries its transport line),
// are left on it, and the REST doorsteps run in offices with no world. A count alone would erase the rows on both sides; this
// binds every row.
// SCOPE, STATED PLAINLY: these two asks are a controlled full-row STAKES test over a made-up world. The other blocks of the two
// answers that read a world (the Mists block, the stances block) match the record only because the fixture was CONSTRUCTED to
// give them the least they read (an empty skeleton, a stand-in geometry): that is not an integration test of those blocks over
// the pinned world, and no other suite is proven by it. The extra-mark falsifier is that another owner's mark in the world stays
// out of the rows; the detectors below move the answer against the fixed expectation.
const INVENTED_WORLD_ASKS = new Set(["ask 3", "ask 7"]);
const expectedFor = (label) => (INVENTED_WORLD_ASKS.has(label) ? overlayStakes(TWINS.of(label), { rows: INVENTED_STAKE_ROWS }) : TWINS.of(label));
/** One doorstep ask, answered in a child over the invented world, with the suite's store and the same injected pool (see the fixture). */
function inventedWorldAsk(which) {
  const child = spawn(process.execPath, [join(ROOT, "test", "fixtures", "pos896-doorstep-ask.mjs")], {
    env: { ...process.env, WORLD_CLONE: INVENTED_WORLD, WORLD2_PG: "1", WORLD2_PG_URL: s.url("office_api"), POS896_ASK: which, POS896_NO_CLONE: join(tmp, "no-clone-here") },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "", err = "";
  child.stdout.on("data", (d) => { out += d; });
  child.stderr.on("data", (d) => { err += d; });
  return new Promise((ok, no) => {
    const t = setTimeout(() => { child.kill(); no(new Error(`${which}: the invented-world child did not answer in 120 s`)); }, 120_000);
    child.on("error", (e) => { clearTimeout(t); no(e); });
    child.on("exit", (code, signal) => {
      clearTimeout(t);
      if (code !== 0) return no(new Error(`${which}: the invented-world child exited ${code ?? signal}: ${err.slice(0, 300)}`));
      try { ok(JSON.parse(out)); } catch (e) { no(new Error(`${which}: the child's answer was not JSON (${out.length} bytes)`)); }
    });
  });
}
// the twin's answer as recorded (helpers/twin-golden.mjs), against the store's
const same = async (label, newAnswer) => {
  const n = await inRecordForm(steady(bytes(await newAnswer) ?? "undefined")), o = expectedFor(label);
  if (n !== o) assert.fail(`${label}: ${firstDiff(JSON.parse(n), JSON.parse(o))}`);
};

test("the roll, the roster and the town card answer as their office.db twins did", async (t) => {
  if (skip) return t.skip(skip);
  store.__resetRosterForTest();
  await same("residentList", store.residentList(api));
  for (const o of [{}, { limit: 2 }, { limit: 2, offset: 2 }, { since: "2026-07-01" }, { office: true }, { office: false, limit: 1 }, { limit: "x", offset: -1 }])
    await same(`residentPage ${JSON.stringify(o)}`, store.residentPage(api, o));
  await same("townSummary", store.townSummary(api));
  await same("officeHandles", store.officeHandles(api));
});

test("resident, windowRead and psaFold answer as their office.db twins did", async (t) => {
  if (skip) return t.skip(skip);
  for (const h of ["wright", "limen", "Zed", "postmaster", "nobody", "_archived"]) {
    await same(`resident ${h}`, store.resident(api, h, {}));
    await same(`windowRead ${h}`, store.windowRead(api, h, {}));
  }
  for (const now of [NOW, Date.parse("2026-08-30T00:00:00Z")]) await same(`psaFold at ${now}`, store.psaFold(api, { now }));
});

test("the doorstep and a resident's house segments answer as their office.db twins did", async (t) => {
  if (skip) return t.skip(skip);
  for (const h of ["wright", "limen", "Zed", "nobody"])
    for (const o of [{}, { slim: true }, { conversationsOffset: 1 }])
      await same(`doorstep ${h} ${JSON.stringify(o)}`, store.doorstep(api, h, "ignored", { nowMs: NOW, fresh: {}, ...o }));
  for (const h of ["wright", "Zed"]) await same(`residentSegments ${h}`, store.residentSegments(api, h, {}));
});

test("the store's roll, held for the sync readers, is the roll", async (t) => {
  if (skip) return t.skip(skip);
  const keep = { WORLD2_PG: process.env.WORLD2_PG, WORLD2_PG_URL: process.env.WORLD2_PG_URL };
  const { default: pg } = await import("pg");
  const pool = new pg.Pool({ connectionString: s.url("office_api"), max: 2 });
  const pen = await import("../src/world2-pen.mjs");
  try {
    Object.assign(process.env, { WORLD2_PG: "1", WORLD2_PG_URL: s.url("office_api") });
    pen.__setPoolForTest(pool);
    const roll = JSON.parse(TWINS.of("roll handles"));
    assert.deepEqual(await store.refreshStoreRoll(), roll);
    assert.deepEqual(store.storeRollHandles(), roll, "held until the next refresh");
  } finally {
    pen.__setPoolForTest(null); await pool.end();
    for (const [k, v] of Object.entries(keep)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
});

const DOORS = ["/residents", "/residents?office=true", "/residents?limit=1&offset=1", "/residents/wright", "/residents/Zed", "/residents/nobody", "/town", "/doorstep/wright", "/doorstep/nobody"];

test("every moved REST door answers as the unswitched office did", async (t) => {
  if (skip) return t.skip(skip);
  for (const door of DOORS) {
    const b = await fetch(offices.switched.base + door);
    const got = steady({ status: b.status, body: steady(await b.text()) }), was = TWINS.of(`REST ${door}`, { dark: DARK.has(`REST ${door}`) });
    if (got !== was) assert.fail(`${door}: ${firstDiff(JSON.parse(got), JSON.parse(was))}`);
  }
});

test("a switched door whose store is gone answers the store's 503", async (t) => {
  if (skip) return t.skip(skip);
  for (const door of ["/residents", "/residents/wright", "/town", "/doorstep/wright"]) {
    const r = await fetch(offices["cut-off"].base + door);
    assert.equal(r.status, 503, door);
    assert.match((await r.json()).defect, /town index \(the store\) cannot be reached/, door);
  }
});

test("the MCP cases and household { read: address | window | home | doorstep | standing } answer as the unswitched office did, and 503 when the store is gone", async (t) => {
  if (skip) return t.skip(skip);
  const { callTool } = await import("../src/mcp.mjs");
  const { householdApex } = await import("../src/household-apex.mjs");
  const KEY = { household: "keemin", handles: new Set(["wright"]) };
  const CTX = { clone: join(tmp, "no-clone-here"), asOf: AS_OF };
  const asks = [
    () => callTool("read_town", {}, {}),
    () => callTool("list_residents", { limit: 2 }, {}),
    () => callTool("read_resident", { handle: "Zed" }, {}),
    () => callTool("read_doorstep", { handle: "wright" }, { asOf: AS_OF }),
    () => householdApex({ read: "address", handle: "wright" }, KEY, CTX),
    () => householdApex({ read: "window", handle: "wright" }, KEY, CTX),
    () => householdApex({ read: "home", handle: "wright" }, KEY, CTX),
    () => householdApex({ read: "doorstep", handle: "wright" }, KEY, CTX),
    () => householdApex({ read: "standing" }, KEY, CTX),
  ];
  const keep = { WORLD2_PG: process.env.WORLD2_PG, WORLD2_PG_URL: process.env.WORLD2_PG_URL };
  const { default: pg } = await import("pg");
  const pool = new pg.Pool({ connectionString: s.url("office_api"), max: 3 });
  const pen = await import("../src/world2-pen.mjs");
  try {
    Object.assign(process.env, { WORLD2_PG: "1", WORLD2_PG_URL: s.url("office_api") });
    pen.__setPoolForTest(pool);
    // asks 3 and 7 answer over the invented world (a child); the rest are the suite's own, in this process
    const live = { 3: () => inventedWorldAsk("read_doorstep"), 7: () => inventedWorldAsk("household-doorstep") };
    for (const [i, ask] of asks.entries()) await same(`ask ${i}`, (live[i] ?? ask)());
    pen.__setPoolForTest({ connect: async () => { throw new Error("ECONNREFUSED"); } });
    for (const [i, ask] of asks.entries()) {
      const r = await ask();
      assert.match(String(r?.defect), /town index \(the store\) cannot be reached/, `ask ${i} with the store gone: ${JSON.stringify(r).slice(0, 160)}`);
    }
  } finally {
    pen.__setPoolForTest(null); await pool.end();
    for (const [k, v] of Object.entries(keep)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
});

test("the house and needs-you answer through the store's index as they did over office.db", async (t) => {
  if (skip) return t.skip(skip);
  const { mkdirSync, writeFileSync } = await import("node:fs");
  const { houseBundle, needsYou } = await import("../src/house-bundle.mjs");
  const clone = join(tmp, "house-clone");
  mkdirSync(join(clone, "tools"), { recursive: true });
  writeFileSync(join(clone, "tools", "households.json"), JSON.stringify({ households: {
    keemin: { name: "Fixture", human: "FIX", accounts: [{ login: "fixture", id: 1 }], residents: ["wright", "limen", "Zed", "r-harbor"] },
  } }));
  // the world's reads, stubbed: they are not the index, and both sides get the same
  const readers = {
    stances: async (_h, opts) => ({ stances_awaiting: 0, awaiting: [], standing: [], cursor: null, complete: true, set_downs_awaiting: [], limit: opts.limit }),
    stakesFor: async () => ({ next_settlement: { at: "2026-07-15T00:00:00.000Z" }, count: 0, at_risk: 0, rows: [] }),
    walkers: async () => ({ at: 190.5, walkers: [] }),
    claimEffects: async () => ({ readable: true, store: "docket", events: [] }),
    claimState: async () => null,
    // the registry, injected: the store this suite stands up holds no households
    registry: { registry: { households: { keemin: { name: "Fixture", human: "FIX", accounts: [{ login: "fixture", id: 1 }], residents: ["wright", "limen", "Zed", "r-harbor"] } } }, pins: {} },
  };
  const key = { household: "keemin", handles: new Set(["wright", "limen"]) };
  const base = { key, asOf: AS_OF, clone, odb: null, nowMs: NOW, readers };
  const keep = { WORLD2_PG: process.env.WORLD2_PG, WORLD2_PG_URL: process.env.WORLD2_PG_URL };
  const { default: pg } = await import("pg");
  const pool = new pg.Pool({ connectionString: s.url("office_api"), max: 3 });
  const pen = await import("../src/world2-pen.mjs");
  try {
    Object.assign(process.env, { WORLD2_PG: "1", WORLD2_PG_URL: s.url("office_api") });
    pen.__setPoolForTest(pool);
    const ix = store.storeIndexPooled(clone);
    const house = await houseBundle({ household: "keemin" }, { ...base, ix });
    assert.equal(house.read, "house", `a house, not a refusal: ${JSON.stringify(house).slice(0, 160)}`);
    assert.deepEqual(house.ashore, ["wright", "limen", "Zed"]);
    await same("houseBundle", houseBundle({ household: "keemin" }, { ...base, ix }));
    // POS-717: `shown` is new beside `count`, and on this fixture every row is on
    // the page, so it equals the count; the rest is the record's answer.
    // WLD-83: `likeness_question` is new beside the twin's lists; this store
    // holds no households, so the house has none, and the rest is the record's.
    const { shown, likeness_question, ...asRecorded } = await needsYou({ household: "keemin" }, { ...base, ix });
    assert.equal(shown, asRecorded.count, "every row waiting is on this answer, so shown is the count");
    assert.deepEqual(likeness_question, { rows: [] }, "a house the record does not hold is asked nothing");
    await same("needsYou", asRecorded);
    pen.__setPoolForTest({ connect: async () => { throw new Error("ECONNREFUSED"); } });
    await assert.rejects(houseBundle({ household: "keemin" }, { ...base, ix: store.storeIndexPooled(clone) }), { name: "TownIndexUnreachable" },
      "the store gone is an error the door answers 503, never a house read from nothing");
  } finally {
    pen.__setPoolForTest(null); await pool.end();
    for (const [k, v] of Object.entries(keep)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
});

test("the roster memo follows the store's head: a new ingest's residents are on the roll", async (t) => {
  if (skip) return t.skip(skip);
  store.__resetRosterForTest();
  const before = (await store.residentList(api)).map((e) => e.handle);
  assert.ok(!before.includes("newcomer"));
  // what an ingest does: a new row, and the head moved (in the store only)
  const w = await s.connect("law_ingester");
  await w.query("INSERT INTO town_residents (handle, json, digest) VALUES ('newcomer', $1, 'x')", [JSON.stringify({ handle: "newcomer", address: { data: { joined: "2026-07-14" } } })]);
  await w.query("DELETE FROM town_meta WHERE key = 'as_of'");
  await w.query("INSERT INTO town_meta (key, value, digest) VALUES ('as_of', 'the-next-head', 'x')");
  await w.end();
  const after = (await store.residentList(api)).map((e) => e.handle);
  assert.ok(after.includes("newcomer"), "a moved head re-reads the cards once, and the roll has the newcomer");
});

// ── THE DETECTORS (POS-896): the invented world's rows held fixed, one wrong answer per branch ───────────────────────────────────
// The expectation is `overlayStakes` over an invented record; each case moves the ANSWER (never the expectation) and names the first
// place the two part. Not one of them reads a world, a store or the office.
const INV_STAKES_RECORD = { handle: "wright", stakes: { serves: "household.stakes", args: { handle: "wright" }, unavailable: "no town sha is ingested, so the store cannot say what stands behind these marks — unknown, not zero",
  escrow_at_town_sha: null, count: 26, at_risk: null, rows: [{ mark: "old/one", kind: "sited", body: "b", class: "commons", escrow: null, at_risk: null }] } };
const INV_WANT = () => overlayStakes(steady(INV_STAKES_RECORD), { rows: INVENTED_STAKE_ROWS });
const rightAnswer = () => structuredClone(JSON.parse(INV_WANT()));
const stakesDetector = (mutate) => { const a = rightAnswer(); mutate(a); return firstDiffPath(steady(a), INV_WANT()); };

test("detector · the stakes expectation is the invented rows and their count, in the segment's own order, with another owner's mark out and everything else the record's", () => {
  const want = JSON.parse(INV_WANT());
  assert.deepEqual(want.stakes.rows.map((r) => r.mark), ["wright/alpha-bench", "wright/bravo-parcel", "wright/charlie-note", "wright/delta-lamp"]);
  assert.equal(want.stakes.count, 4);
  assert.equal(want.stakes.rows.some((r) => r.mark.startsWith("someone-else/")), false, "another owner's mark stays out");
  assert.deepEqual(want.stakes.rows.map((r) => r.class), ["commons", "home", "commons", null], "a registry row's class, and null for founding estate");
  assert.deepEqual(want.stakes.rows.map((r) => [r.escrow, r.at_risk]), [[null, null], [null, null], [null, null], [null, null]], "unmeasured, so unjudged");
  assert.equal(want.stakes.unavailable, INV_STAKES_RECORD.stakes.unavailable, "the segment's own sentences stay the record's");
  assert.deepEqual(Object.keys(want.stakes.rows[0]), ["mark", "kind", "body", "class", "escrow", "at_risk"]);
  assert.equal(stakesDetector(() => {}), null, "the control: the right answer equals the expectation");
});

test("detector · a miscount, a missing row, an extra row (another owner's) and a count with no rows are each named", () => {
  assert.equal(stakesDetector((a) => { a.stakes.count = 5; }), "$.stakes.count");
  assert.equal(stakesDetector((a) => { a.stakes.rows.pop(); }), "$.stakes.rows.length");
  assert.equal(stakesDetector((a) => { a.stakes.rows.push({ mark: "someone-else/echo-gate", kind: "sited", body: "x", class: "commons", escrow: null, at_risk: null }); }), "$.stakes.rows.length");
  assert.equal(stakesDetector((a) => { a.stakes.rows = []; }), "$.stakes.rows.length", "the count alone is not the branch");
});

test("detector · a wrong kind, class, body, escrow, risk or order is named at its row and field", () => {
  assert.equal(stakesDetector((a) => { a.stakes.rows[1].kind = "sited"; }), "$.stakes.rows[1].kind", "wrong kind");
  assert.equal(stakesDetector((a) => { a.stakes.rows[0].class = "home"; }), "$.stakes.rows[0].class", "wrong class");
  assert.equal(stakesDetector((a) => { a.stakes.rows[3].class = "commons"; }), "$.stakes.rows[3].class", "founding estate given a class");
  assert.equal(stakesDetector((a) => { a.stakes.rows[2].body = null; }), "$.stakes.rows[2].body", "a body lost");
  assert.equal(stakesDetector((a) => { a.stakes.rows[0].escrow = 0; }), "$.stakes.rows[0].escrow", "an escrow read where none was");
  assert.equal(stakesDetector((a) => { a.stakes.rows[0].at_risk = true; }), "$.stakes.rows[0].at_risk", "a risk where none was judged");
  assert.equal(stakesDetector((a) => { a.stakes.rows.reverse(); }), "$.stakes.rows[0].mark", "the segment's order lost");
  assert.equal(stakesDetector((a) => { a.stakes.unavailable = "all clear"; }), "$.stakes.unavailable", "the unmeasured sentence replaced");
});

test("detector · a record in another state (measured, or with a judged row) is refused by name, never rewritten", () => {
  const measured = structuredClone(INV_STAKES_RECORD); delete measured.stakes.unavailable;
  assert.throws(() => overlayStakes(steady(measured), { rows: INVENTED_STAKE_ROWS }), /is measured, but the expected rows are the unmeasured state/);
  const judged = structuredClone(INV_STAKES_RECORD); judged.stakes.rows[0].at_risk = false;
  assert.throws(() => overlayStakes(steady(judged), { rows: INVENTED_STAKE_ROWS }), /rows are judged/);
});
