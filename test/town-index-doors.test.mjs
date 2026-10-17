// town-index-doors.test.mjs — the doors that moved to the store (POS-268).
//
//   EMBEDDED_PG_DIR=<dir with embedded-postgres> node --test test/town-index-doors.test.mjs
//
// Two offices over the fixture town: one over a real Postgres seeded from its
// rows, and one over a store that is not there. The moved doors must answer
// byte for byte as the unswitched office answered from office.db over the same
// rows (recorded in the last tree that had it: helpers/twin-golden.mjs,
// POS-656), say which index they read (x-postmark-town-index-as-of), and, when
// the store cannot be read, refuse with a 503. The MCP twins go through
// callTool, the one dispatch every MCP door shares.

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

import { fixtureTown } from "./fixture.mjs";
import { startStore } from "./helpers/embedded-store.mjs";
import { seedTownIndex } from "./helpers/index-to-store.mjs";
import { twinGolden } from "./helpers/twin-golden.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TWINS = twinGolden("town-index-doors");
const tmp = mkdtempSync(join(tmpdir(), "town-index-doors-"));
let store = null, skip = false;
const offices = {};

function office(name, env) {
  const child = spawn(process.execPath, [join(ROOT, "src", "server.mjs"), "--port", "0",
    "--oauth-db", join(tmp, `${name}-oauth.db`), "--roles-db", join(tmp, `${name}-roles.db`)], {
    env: { ...process.env, WORLD_GRAPH_NONE: "1", TOWN_CLONE: join(tmp, "no-clone-here"), WORLD_CLONE: join(tmp, "no-world-clone"),
      VOICES_LOG: join(tmp, `${name}-voices.jsonl`), TOWN_PUSH: "", WORLD_STORE_DB: join(tmp, "no-world.db"),
      OFFICE_READ_WORKERS: "0", WORLD2_PG: undefined, WORLD2_PG_URL: undefined, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  return new Promise((ok, no) => {
    const t = setTimeout(() => no(new Error(`${name}: the office never listened`)), 20_000);
    child.stdout.on("data", (d) => {
      const m = /listening on :(\d+)/.exec(String(d));
      if (m) { clearTimeout(t); offices[name] = { child, base: `http://127.0.0.1:${m[1]}` }; ok(); }
    });
    child.on("exit", (c) => no(new Error(`${name}: the office exited early (${c})`)));
  });
}

before(async () => {
  store = await startStore();
  if (store.skip) { skip = store.skip; return; }
  const db = fixtureTown();
  const w = await store.connect("law_ingester");
  await seedTownIndex(w, db);
  await w.end();
  await office("switched", { WORLD2_PG: "1", WORLD2_PG_URL: store.url("office_api") });
  await office("cut-off", { WORLD2_PG: "1", WORLD2_PG_URL: "postgres://office_api:x@127.0.0.1:9/none" });
});

after(async () => {
  for (const { child } of Object.values(offices)) {
    if (child.exitCode === null) { const gone = new Promise((ok) => child.on("exit", ok)); child.kill(); await gone; }
  }
  if (store?.stop) await store.stop();
  rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

const DOORS = ["/repo/log", "/repo/log?limit=1", "/repo/log?path=WHITE_PAGES/", "/repo/log?author=keemin", "/repo/log?since=2026-07-05&until=2026-07-12",
  "/regions", "/regions?limit=1&offset=0", "/regions/the-terrace", "/regions/nowhere",
  "/bulletin", "/bulletin/settling-in", "/bulletin/nope", "/homes/wright", "/homes/limen", "/homes/nobody",
  "/stamps", "/stamps?limit=1&offset=1", "/stamps/wright", "/stamps/nobody"];

test("every moved door answers as the unswitched office did, and names the store's as-of", async (t) => {
  if (skip) return t.skip(skip);
  for (const door of DOORS) {
    const b = await fetch(offices.switched.base + door);
    const status = b.status;
    await TWINS.equalResponse(`REST ${door}`, b, `${door}: status and body, byte for byte`);
    if (status === 200) assert.equal(b.headers.get("x-postmark-town-index-as-of"), "fixturesha000000000000000000000000000000", `${door}: names the index it read`);
  }
});

test("a door whose store cannot be read refuses with a 503", async (t) => {
  if (skip) return t.skip(skip);
  for (const door of ["/repo/log", "/regions", "/regions/the-terrace", "/bulletin", "/bulletin/settling-in", "/homes/wright", "/stamps", "/stamps/wright"]) {
    const r = await fetch(offices["cut-off"].base + door);
    assert.equal(r.status, 503, door);
    const body = await r.json();
    assert.match(body.defect, /town index \(the store\) cannot be reached/, door);
  }
  // a door that reads no town index still answers on the same office
  assert.equal((await fetch(offices["cut-off"].base + "/release")).status, 200); // a door that reads no town index
});

test("the MCP twins (list_commits, list_regions, read_bulletin, read_home, read_stamps) answer through the store as they did over office.db", async (t) => {
  if (skip) return t.skip(skip);
  const { callTool } = await import("../src/mcp.mjs");
  let pool = null;
  const keep = { WORLD2_PG: process.env.WORLD2_PG, WORLD2_PG_URL: process.env.WORLD2_PG_URL };
  try {
    const asks = [["list_commits", {}], ["list_commits", { path: "WHITE_PAGES/", limit: 1 }], ["list_regions", {}],
      ["read_bulletin", {}], ["read_bulletin", { limit: 1 }], ["read_bulletin", { slug: "settling-in" }], ["read_bulletin", { slug: "nope" }],
      ["read_home", { handle: "wright" }], ["read_home", { handle: "nobody" }],
      ["read_stamps", {}], ["read_stamps", { limit: 1 }], ["read_stamps", { handle: "wright" }]];
    Object.assign(process.env, { WORLD2_PG: "1", WORLD2_PG_URL: store.url("office_api") });
    // The pen's pool is this test's own, handed in and ended here: a pool the
    // module made for itself would outlive the store and hold this file open.
    const { default: pg } = await import("pg");
    pool = new pg.Pool({ connectionString: store.url("office_api"), max: 2 });
    (await import("../src/world2-pen.mjs")).__setPoolForTest(pool);
    for (const [tool, args] of asks)
      TWINS.equal(`${tool} ${JSON.stringify(args)}`, JSON.stringify(await callTool(tool, args, {})));
  } finally {
    if (pool) { (await import("../src/world2-pen.mjs")).__setPoolForTest(null); await pool.end(); }
    for (const [k, v] of Object.entries(keep)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
});
