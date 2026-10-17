// office-under-test.mjs — the town index a test's office reads: the store.
//
// The office reads its town index from the store (POS-268; office.db is gone,
// POS-656). So a test that boots an office (or calls its doors in-process)
// gives it a store seeded from the fixture town the test states
// (test/fixture.mjs § fixtureTown), the way the ingest would have written it.
// The rows stay the test's one statement of the town; this helper turns them
// into the store.
//
//   const town = fixtureTown();               // then put / drop / setMeta
//   const ix = await indexStore(town);        // in before()
//   spawn(node, [server.mjs, ...], { env: { ...process.env, ...ix.env } });
//   await ix.reseed();                        // after the test changed the rows
//   await ix.stop();                          // in after()
//
// A file that cannot start its store FAILS with embedded-store.mjs § NO_STORE.

import { startStore } from "./embedded-store.mjs";
import { seedTownIndex } from "./index-to-store.mjs";
import { execFileSync as execFileSyncSeed } from "node:child_process";
import { fileURLToPath as fileURLToPathSeed } from "node:url";

/**
 * ONE READ WORKER for an office on a test store. Switched, every read worker
 * keeps a pen pool of its own and polls the store each 5 s; at the default
 * cores - 1 workers (15 on a 16-core machine) one office held ~45 of the test
 * server's 100 connections, and under a busy suite its reads and boots timed
 * out (POS-268 5a: 68 such reds in the switch-only probe). The box runs 3. A
 * test about workers sets OFFICE_READ_WORKERS itself, after this env.
 */
const ONE_WORKER = "1";

/**
 * A store seeded from the fixture town `town` (fixtureTown's rows), or an empty
 * town index when `town` is null (a test whose doors never had one).
 * `env` is what an office (spawned, or this process via `useInProcess`) needs to
 * read it; office_api is the office's own pen. `own: true` puts it on a server
 * of this file's own, whose `store.pause()` / `store.resume()` are an outage
 * (embedded-store.mjs § startStore).
 */
export async function indexStore(town, { db: name = "office_test", own = false } = {}) {
  if (town != null && (typeof town !== "object" || !Array.isArray(town.residents)))
    throw new TypeError("indexStore takes a fixture town (test/fixture.mjs § fixtureTown) or null, never a path: office.db is gone (POS-656)");
  const s = await startStore({ db: name, own });
  const seed = async () => {
    if (town == null) return;
    const w = await s.connect("law_ingester");
    // ONE TRANSACTION, as the ingest writes it (POS-639). The copy writes
    // town_meta's as_of first and the residents after, statement by statement,
    // so an office polling mid-copy read the NEW as-of over a half-copied
    // roll, held that probe, and never read again: its as-of had not moved
    // since. Committed whole, a reader sees the old index or the new.
    try {
      await w.query("BEGIN");
      try { await seedTownIndex(w, town); await w.query("COMMIT"); }
      catch (e) { await w.query("ROLLBACK").catch(() => {}); throw e; }
    }
    finally { await w.end(); }
  };
  await seed();
  let inProcess = null; // this process's index module, once useInProcess switched it
  const env = { TOWN_INDEX_READS: "store", WORLD2_PG: "1", WORLD2_PG_URL: s.url("office_api"), OFFICE_READ_WORKERS: ONE_WORKER };
  return {
    env,
    store: s,
    /**
     * Copy the town again, after the test changed its rows. In a switched process
     * the held roll and probe are read again too: the fixture's head never moves,
     * so nothing else would tell them the rows did.
     */
    async reseed() {
      await seed();
      if (!inProcess) return;
      inProcess.__resetRosterForTest();
      inProcess.__resetProbeForTest();
      await inProcess.refreshStoreRoll();
      await inProcess.refreshStoreProbe();
    },
    /**
     * Switch THIS process to the store (for a test that calls mcp / household
     * in-process) and load the roll and the write path's probe. Answers a
     * function that puts the environment back.
     */
    // The switch, and the index read through a pool of its own
    // (town-index-store.mjs § __setTownIndexPoolForTest): the record's env is
    // left as the test set it, so a suite that stubs the record's pen keeps its
    // stub and still reads a real index.
    async useInProcess() {
      const keep = process.env.TOWN_INDEX_READS;
      process.env.TOWN_INDEX_READS = "store";
      const { default: pg } = await import("pg");
      const pool = new pg.Pool({ connectionString: s.url("office_api"), max: 3 });
      pool.on("error", () => {});
      const tis = await import("../../src/town-index-store.mjs");
      tis.__setTownIndexPoolForTest(pool);
      inProcess = tis;
      // every fixture store has the fixture's head, so the memos keyed on a head are forgotten first
      tis.__resetRosterForTest();
      tis.__resetProbeForTest();
      await tis.refreshStoreRoll();
      await tis.refreshStoreProbe();
      return async () => {
        tis.__setTownIndexPoolForTest(null);
        inProcess = null;
        await pool.end().catch(() => {});
        if (keep === undefined) delete process.env.TOWN_INDEX_READS; else process.env.TOWN_INDEX_READS = keep;
      };
    },
    stop: () => s.stop(),
  };
}

/**
 * A store filled the way the box fills it: the town-index ingest's seed over a
 * town checkout at `sha` (default HEAD), written by its own pen. For a test
 * that builds a real town rather than a fixture town.
 */
export async function indexStoreFromTown(townRepo, { sha = null, db: name = "office_test" } = {}) {
  const { execFileSync } = await import("node:child_process");
  const at = sha ?? execFileSync("git", ["-C", townRepo, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const s = await startStore({ db: name });
  const { ingest } = await import("../../world2/tools/town-index-ingest.mjs");
  const w = await s.connect("law_ingester");
  try { await ingest(w, { townRepo, sha: at, seed: true }); }
  finally { await w.end(); }
  return { env: { TOWN_INDEX_READS: "store", WORLD2_PG: "1", WORLD2_PG_URL: s.url("office_api"), OFFICE_READ_WORKERS: ONE_WORKER }, store: s, stop: () => s.stop() };
}

/**
 * THE REGISTRY, IN THE STORE (POS-342/343): replace a started store's
 * `households`, `household_pins` and `registry_meta` with the two documents a
 * town clone would print (`tools/households.json`, `tools/github-ids.json`).
 *
 * The household block and sign-in read these rows, never the clone's files, so
 * a suite that used to write the pins file into its temp clone states the same
 * pins here instead. Written as the store's owner, because the office's own
 * role holds no DELETE and a suite re-states its registry between tests.
 */
export async function seedRegistry(store, households = null, pins = null) {
  const { rowsFromRegistry } = await import("../../src/registry-rows.mjs");
  const rows = rowsFromRegistry(households ?? { schema_version: 1, households: {} }, pins ?? {});
  const c = await store.connect("world2_owner");
  const json = new Set(["accounts", "home_images"]);
  const insert = async (table, row) => {
    const cols = Object.keys(row);
    await c.query(`INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")})`,
      cols.map((k) => (json.has(k) ? JSON.stringify(row[k]) : row[k])));
  };
  try {
    await c.query("TRUNCATE household_pins, households, registry_meta");
    for (const [key, value] of Object.entries(rows.meta)) await c.query("INSERT INTO registry_meta (key, value) VALUES ($1, $2)", [key, JSON.stringify(value)]);
    for (const r of rows.households) await insert("households", r);
    for (const r of rows.pins) await insert("household_pins", r);
  } finally { await c.end(); }
}

/**
 * Point THIS process's record (`world2-acts.mjs § actsQuery`, the pool every
 * registry read uses) at a started store, as the office's own role. Answers a
 * function that puts the environment and the pool back.
 */
export async function recordInProcess(store) {
  const { default: pg } = await import("pg");
  const { __setPoolForTest } = await import("../../src/world2-acts.mjs");
  const pool = new pg.Pool({ connectionString: store.url("office_api"), max: 2 });
  pool.on("error", () => {});
  const was = { on: process.env.WORLD2_PG, url: process.env.WORLD2_PG_URL };
  __setPoolForTest(pool);
  process.env.WORLD2_PG = "1";
  process.env.WORLD2_PG_URL = store.url("office_api");
  return async () => {
    __setPoolForTest(null);
    await pool.end().catch(() => {});
    if (was.on === undefined) delete process.env.WORLD2_PG; else process.env.WORLD2_PG = was.on;
    if (was.url === undefined) delete process.env.WORLD2_PG_URL; else process.env.WORLD2_PG_URL = was.url;
  };
}

/**
 * A store for a suite that SPAWNS a tool reading the registry (POS-350: the
 * world export renders the store's registry, never the town clone's printouts).
 * `seedFrom(town)` re-states the store from the two printouts a fixture town
 * holds, so the fixture stays the suite's one statement of its registry; call it
 * again after the suite rewrites them. `env` points a child at the store.
 *
 * A fixture house may omit the two columns 019 requires and the export never
 * reads (`since`, `declared_by`); they are filled with a stated harness value.
 */
export async function registryStoreForTowns({ db = "registry_town_test" } = {}) {
  const s = await startStore({ db });
  const { readFileSync, existsSync } = await import("node:fs");
  const { join } = await import("node:path");
  const read = (p) => (existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null);
  return {
    store: s,
    env: { WORLD2_PG: "1", WORLD2_PG_URL: s.url("office_api") },
    async seedFrom(town) {
      const doc = read(join(town, "tools", "households.json")) ?? { schema_version: 1, households: {} };
      const houses = {};
      for (const [slug, rec] of Object.entries(doc.households ?? {}))
        houses[slug] = { since: "2026-01-01", declared_by: (rec?.residents ?? [])[0] ?? slug, ...rec };
      await seedRegistry(s, { ...doc, households: houses }, read(join(town, "tools", "github-ids.json")) ?? {});
    },
    /** The same, from a synchronous harness: a child process does the writing. */
    seedFromSync(town) {
      return execSeed(town, s.url("world2_owner"));
    },
    stop: () => s.stop(),
  };
}

/** Run the seed child synchronously (seed-registry-cli.mjs). */
function execSeed(town, ownerUrl) {
  execFileSyncSeed(process.execPath, [fileURLToPathSeed(new URL("./seed-registry-cli.mjs", import.meta.url)), town],
    { env: { ...process.env, REG_OWNER_URL: ownerUrl }, stdio: ["ignore", "pipe", "pipe"] });
}
