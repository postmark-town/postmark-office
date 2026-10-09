// read-shape-mcp-only.test.mjs — a read shape is the MCP door's, never the
// process's (POS-486; postmark-office#455 review, finding 1).
//
// WORLD_READ_SHAPE, TOWN_READ_SHAPE and HOUSEHOLD_READ_SHAPE pick the bare read
// an MCP caller gets. They used to be read inside each apex, from the process
// environment, so setting one on the box reshaped the REST doors too: GET
// /world/apex is the site cockpit's read, and its forms are built from every
// card's `fields`, which v1 replaces with one line. Now the MCP door (and only
// it) marks its calls `door: "mcp"` and hands the shape in; a REST call carries
// no shape and answers the 0 shape whatever the environment says.
//
// THE RIG: the world-read-shape rig (the real world clone, hydrated and
// published as the world graph snapshot, a record with no acts; kogane on her
// parcel) for the world; the town's bare read needs nothing; the household's
// reads a fixture office.db through a store (foyer-shrink's rig).
//
// Run: WORLD_CLONE=<a world checkout> node --test test/read-shape-mcp-only.test.mjs

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { NO_WORLD, OFFICE_ROOT, worldClone } from "./fixture-paths.mjs";
import { publishWorld } from "./helpers/world-rows.mjs";
import { fixtureDb } from "./fixture.mjs";
import { indexStore } from "./helpers/office-under-test.mjs";

const CLONE = worldClone();
const HAVE_CLONE = Boolean(CLONE) && existsSync(join(CLONE, "WORLD", "world-state.json"));
const WHY_NOT = CLONE ? `the world clone at ${CLONE} is missing world-state.json` : NO_WORLD;

const VARS = ["WORLD_APEX", "WORLD2_PG", "WORLD2_PG_URL", "WORLD_READ_SHAPE", "TOWN_READ_SHAPE", "HOUSEHOLD_READ_SHAPE", "WORLD_STORE_DB"];
const saved = Object.fromEntries(VARS.map((k) => [k, process.env[k]]));
const setEnv = (k, v) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; };
setEnv("WORLD_APEX", "1"); setEnv("WORLD2_PG", "1"); setEnv("WORLD2_PG_URL", "postgres://read-shape-mcp-only/none");
for (const k of ["WORLD_READ_SHAPE", "TOWN_READ_SHAPE", "HOUSEHOLD_READ_SHAPE"]) setEnv(k, undefined);
setEnv("WORLD_STORE_DB", join(tmpdir(), "pm-read-shape-no-such-world-store.db"));

const { worldApex } = await import("../src/world-apex.mjs");
const { __setPoolForTest } = await import("../src/world2-acts.mjs");
const { callTool, TOOLS } = await import("../src/mcp.mjs");
const { householdApex } = await import("../src/household-apex.mjs");

const WHO = "kogane";
const KEY = { handles: new Set([WHO]) };
let dir;

// the household's fixture and its store (foyer-shrink.test.mjs's rig)
const hdir = mkdtempSync(join(tmpdir(), "pm-read-shape-"));
const dbPath = join(hdir, "fixture.db");
fixtureDb(dbPath).close();
const db = new DatabaseSync(dbPath, { readOnly: true });
const IX = await indexStore(dbPath);
const IX_RESTORE = await IX.useInProcess();
const HKEY = { household: "keemin", handles: new Set(["wright"]), ghId: "42", ghLogin: "keeminlee" };
const worldBlock = async () => ({ sited: true, unreadable: false, parcel_id: "wright/the-trueing-house-parcel", transport: { line: "a transport line" } });
const SCHEMAS = Object.fromEntries(TOOLS.map((t) => [t.name, t.inputSchema?.properties ?? {}]));
const REQUIRED = Object.fromEntries(TOOLS.map((t) => [t.name, t.inputSchema?.required ?? []]));

before(() => {
  if (!HAVE_CLONE) return;
  dir = mkdtempSync(join(tmpdir(), "read-shape-mcp-"));
  execFileSync(process.execPath, [join(OFFICE_ROOT, "src", "world-hydrate.mjs"),
    "--world", CLONE, "--no-db", "--rows-out", join(dir, "rows.json"), "--no-gexf", "--no-lints"],
  { stdio: "ignore", env: { ...process.env, TMP: dir, TEMP: dir, TMPDIR: dir } });
  publishWorld(join(dir, "rows.json"), "the world clone's head");
  __setPoolForTest({ async query(sql) {
    const text = String(sql).replace(/\s+/g, " ");
    if (/max\(id\) AS hw, count\(\*\) AS n FROM acts/.test(text)) return { rows: [{ hw: null, n: "0" }] };
    if (/SELECT id, at, crossing, actor, action, payload FROM acts/.test(text)) return { rows: [] };
    throw new Error(`the record was asked something it does not answer: ${text.slice(0, 160)}`);
  } });
});

after(async () => {
  __setPoolForTest(null);
  await IX_RESTORE(); await IX.stop(); db.close();
  for (const [k, v] of Object.entries(saved)) setEnv(k, v);
  for (const d of [dir, hdir]) if (d) rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

const under = async (k, v, fn) => { setEnv(k, v); try { return await fn(); } finally { setEnv(k, undefined); } };

test("world: with WORLD_READ_SHAPE=v1 the REST read (GET/POST /world/apex's ctx) keeps every card's fields; the MCP door's call is lean", { skip: !HAVE_CLONE && WHY_NOT }, async () => {
  const full = await worldApex({ handle: WHO }, KEY, { roll: [] });
  const rest = await under("WORLD_READ_SHAPE", "v1", () => worldApex({ handle: WHO }, KEY, { roll: [] }));
  assert.ok(full.actions.length > 0 && full.actions.every((a) => a.fields && typeof a.fields === "object"), "the rig's read carries full cards");
  assert.deepEqual(rest.actions.map((a) => [a.action, a.fields]), full.actions.map((a) => [a.action, a.fields]), "REST's cards keep their fields under v1");
  assert.equal(JSON.stringify(rest), JSON.stringify(full), "REST answers the v0 read whole");
  const mcp = await under("WORLD_READ_SHAPE", "v1", () => callTool("world", { handle: WHO }, { key: KEY, door: "mcp" }));
  assert.equal(mcp.read_shape, "v1", "the MCP door's own call is shaped");
  assert.ok(mcp.actions.every((a) => typeof a.line === "string" && !("fields" in a)));
  const unmarked = await under("WORLD_READ_SHAPE", "v1", () => callTool("world", { handle: WHO }, { key: KEY }));
  assert.equal(unmarked.read_shape, undefined, "the dispatcher without the MCP marker (REST's road) is not shaped");
});

test("town: with TOWN_READ_SHAPE=t1, GET /town/apex's road (the dispatcher, unmarked) answers today's acts; the MCP door's call is lean", async () => {
  const full = await callTool("town", {}, { key: null });
  const rest = await under("TOWN_READ_SHAPE", "t1", () => callTool("town", {}, { key: null }));
  assert.deepEqual(rest.acts.map((a) => [a.act, a.fields]), full.acts.map((a) => [a.act, a.fields]));
  assert.equal(JSON.stringify(rest), JSON.stringify(full));
  const mcp = await under("TOWN_READ_SHAPE", "t1", () => callTool("town", {}, { key: null, door: "mcp" }));
  assert.equal(mcp.read_shape, "t1");
  assert.ok(mcp.acts.every((a) => typeof a.line === "string"));
});

test("household: with HOUSEHOLD_READ_SHAPE=h1, GET /household's ctx answers today's papers and index; the MCP door's call is lean", async () => {
  const ctx = { db, worldBlock, slim: true, schemas: SCHEMAS, schemaRequired: REQUIRED };
  const full = await householdApex({}, HKEY, ctx);
  const rest = await under("HOUSEHOLD_READ_SHAPE", "h1", () => householdApex({}, HKEY, ctx));
  assert.equal(JSON.stringify(rest), JSON.stringify(full), "REST answers h0 whole under h1");
  const mcp = await under("HOUSEHOLD_READ_SHAPE", "h1", () => callTool("household", {}, { db, key: HKEY, door: "mcp" }));
  assert.equal(mcp.read_shape, "h1", "the MCP door's own call is shaped");
});

test("household h0 end to end: through the MCP dispatcher, unset and h0 are byte-identical (#455 review, finding 7)", async () => {
  const unset = await callTool("household", {}, { db, key: HKEY, door: "mcp" });
  assert.ok(Array.isArray(unset.acts) && unset.papers, "the rig answers a real bare read");
  const h0 = await under("HOUSEHOLD_READ_SHAPE", "h0", () => callTool("household", {}, { db, key: HKEY, door: "mcp" }));
  assert.equal(JSON.stringify(h0), JSON.stringify(unset));
  assert.ok(!JSON.stringify(unset).includes("read_shape"));
});
