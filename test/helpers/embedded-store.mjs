// embedded-store.mjs — a REAL Postgres for a test: the suite's store.
//
// "A round trip through a JS stub is not a round trip through Postgres": a stub
// keeps what the database would reorder, refuse or collate differently. So a
// test that needs the store runs on a Postgres server this helper starts and
// deletes itself: the `embedded-postgres` package, a devDependency since the
// store became the suite's substrate (POS-268). EMBEDDED_PG_DIR (a directory
// whose node_modules holds it) still overrides where it is found. Without it
// the test FAILS with the reason: a store test that skips reads as green.
//
// ON A POOL TREE, THE TREE'S OWN SERVER (POS-479). A tree that
// G:/Postmark/pool/pg.mjs has provisioned keeps one long-lived Postgres beside it
// (`<ROOT>.pg/`, whose READY names the port), started on claim and stopped on
// release. There a store is a DATABASE, made from the migrated floor as a
// template and dropped at teardown. A killed test leaves a database, never a
// running server, and the next store start in the tree drops the databases
// whose process is gone (on 10-08, killed tests had left 101 servers running).
//
// ANYWHERE ELSE (CI, a clone that isn't a pool tree, OFFICE_STORE_SERVER=own),
// every file's server is its own: its port is asked of the OS (bind 0) and its
// data directory is a fresh temp directory. A server is started and stopped with
// the package's own pg_ctl (`stop -m fast`, a clean shutdown); the package's own
// stop is a forced kill on Windows, which left every copy of a data directory
// needing recovery. The folder records the pid that started it (`starter`), so
// `pg.mjs reap` can stop a server whose test was killed.
//
// The floor is CI's (guard-falsifier-floor.sh): every world2/schema/[0-9]*.sql
// in name order, 003 skipped, applied as `world2_owner`, after the roles the box
// makes by hand. Every connection is built here; WORLD2_PG_URL and PG* are never
// read, so no test can reach a real store by accident.

import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:net";
import { createRequire } from "node:module";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCHEMA = join(ROOT, "world2", "schema");
const ROLES = ["world2_owner", "office_api", "clearing_job", "law_ingester", "snapshot_reader",
  "review_publisher", "earpiece", "stance_reader"];
const PW = "local";
// io_method=sync: Postgres 18's io_worker children outlived a Windows stop and
// held the test file open.
//
// THE SHARED SERVER, MEASURED (POS-479). A run-wide server was tried once before
// and was recorded here as refusing connections: on Windows every connection is
// a process, and a burst of eight files' offices was said to overflow the listen
// backlog. Measured on 10-09 against office-1's server at the default 100
// connections, with the 126 store files at the suite's concurrency of 8: the
// peak was 62 connections and nothing was refused. The reds that run did have
// came from tests reading the whole server (pg_terminate_backend on every
// office_api session, a pg_locks count). Those are scoped to the test's own
// database now. A test that reads the server's views filters by
// `store.database`. pg.mjs sizes the server at 200.
const SERVER_OPTS = "-c io_method=sync -c listen_addresses=127.0.0.1";
const FLOOR_DB = "floor";

/** The words a test fails with when it cannot have its store. */
export const NO_STORE = "this test needs the suite's store, a real Postgres from the embedded-postgres devDependency, and could not start one";

const freePort = () => new Promise((ok, no) => {
  const s = createServer();
  s.unref();
  s.on("error", no);
  s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => ok(port)); });
});

const migrations = () => readdirSync(SCHEMA).filter((n) => /^\d{3}_.+\.sql$/.test(n) && n !== "003_falsifier_roles.sql").sort();

// The package, its version and its binaries, or NO_STORE with the cause.
async function thePackage() {
  const dir = process.env.EMBEDDED_PG_DIR;
  try {
    const req = dir ? createRequire(join(dir, "noop.js")) : createRequire(import.meta.url);
    const at = req.resolve("embedded-postgres");
    const EmbeddedPostgres = (await import(pathToFileURL(at).href)).default;
    // the package's own package.json is not exported; it sits at the package root
    const root = at.slice(0, at.lastIndexOf("embedded-postgres") + "embedded-postgres".length);
    const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
    const plat = `${process.platform === "win32" ? "windows" : process.platform}-${process.arch}`;
    const bins = await import(pathToFileURL(createRequire(join(root, "package.json")).resolve(`@embedded-postgres/${plat}`)).href);
    return { EmbeddedPostgres, version, pgCtl: bins.pg_ctl };
  } catch (e) {
    throw new Error(`${NO_STORE}: ${dir ? `EMBEDDED_PG_DIR=${dir} holds no embedded-postgres` : "npm ci has not installed it"} (${String(e?.message ?? e).slice(0, 160)})`);
  }
}

const run = (cmd, args) => new Promise((ok, no) => {
  const c = spawn(cmd, args, { stdio: "ignore", windowsHide: true });
  c.on("error", no);
  c.on("exit", (code) => (code === 0 ? ok() : no(new Error(`${cmd} ${args[0]} exited ${code}`))));
});
const pgStart = (pgCtl, data, port) =>
  run(pgCtl, ["start", "-w", "-t", "120", "-D", data, "-l", join(data, "..", "postgres.log"), "-o", `-p ${port} ${SERVER_OPTS}`]);
async function pgStop(pgCtl, data) {
  try { await run(pgCtl, ["stop", "-w", "-t", "60", "-D", data, "-m", "fast"]); }
  catch { await run(pgCtl, ["stop", "-w", "-t", "30", "-D", data, "-m", "immediate"]).catch(() => {}); }
}

async function connector(port) {
  const { default: pg } = await import("pg");
  return async (user, database) => {
    const c = new pg.Client({ host: "127.0.0.1", port, user, password: PW, database });
    c.on("error", () => {});
    await c.connect();
    return c;
  };
}

// THE FLOOR, BUILT ONCE PER TREE AND SCHEMA (the suite's wall time). initdb is
// ~6 s of a store's start, and every file used to pay it. Now the first start
// in a run builds a stopped cluster with the roles and a migrated `floor`
// database, keyed on this tree's path, the package's version and every
// migration's bytes. Each server copies it and starts on its own port; each
// store is a database made from `floor` as a template. A changed migration is a
// new key, so a stale floor is never used. Builders race through an atomic
// mkdir; the others wait for READY.
async function floorDir({ EmbeddedPostgres, version, pgCtl }) {
  const h = createHash("sha256").update(ROOT).update(version);
  for (const f of migrations()) h.update(f).update(readFileSync(join(SCHEMA, f)));
  const dir = join(tmpdir(), `office-pg-floor-${h.digest("hex").slice(0, 16)}`);
  const ready = join(dir, "READY");
  if (existsSync(ready)) return dir;
  const lock = `${dir}.lock`;
  try { mkdirSync(lock); }
  catch {
    for (let i = 0; i < 600 && !existsSync(ready); i++) await new Promise((ok) => setTimeout(ok, 200));
    if (existsSync(ready)) return dir;
    throw new Error(`the store's floor at ${dir} was never finished (${lock} held for two minutes)`);
  }
  const building = `${dir}.building-${process.pid}`;
  try {
    rmSync(building, { recursive: true, force: true });
    const data = join(building, "data");
    // initdb only: the package's initialise writes the superuser's password and auth method
    await new EmbeddedPostgres({ databaseDir: data, user: "postgres", password: PW, onLog: () => {}, onError: () => {} }).initialise();
    const port = await freePort();
    await pgStart(pgCtl, data, port);
    try {
      const connect = await connector(port);
      const su = await connect("postgres", "postgres");
      for (const r of ROLES) await su.query(`CREATE ROLE ${r} LOGIN PASSWORD '${PW}'`);
      await su.query(`CREATE DATABASE ${FLOOR_DB} OWNER world2_owner`);
      await su.end();
      const owner = await connect("world2_owner", FLOOR_DB);
      for (const f of migrations()) await owner.query(readFileSync(join(SCHEMA, f), "utf8"));
      await owner.end();
    } finally { await pgStop(pgCtl, data); }
    writeFileSync(ready.replace(dir, building), new Date().toISOString());
    renameSync(building, dir);
    return dir;
  } finally { rmSync(lock, { recursive: true, force: true }); }
}

// A server of its own: the floor copied into a fresh temp directory, started on
// a port the OS chose. `stop` shuts it down cleanly and removes the directory.
async function ownServer() {
  const pkg = await thePackage();
  const floor = await floorDir(pkg);
  const scratch = mkdtempSync(join(tmpdir(), "office-store-"));
  writeFileSync(join(scratch, "starter"), String(process.pid)); // pg.mjs reap stops the server once this pid is gone
  const data = join(scratch, "data");
  cpSync(join(floor, "data"), data, { recursive: true });
  // Postgres refuses a data directory others can read (0700 or 0750 only), and
  // the copy is made under the umask, 0755 on Linux. Windows has no such bits,
  // so this went unseen until the suite ran in CI (POS-417).
  chmodSync(data, 0o700);
  const port = await freePort();
  await pgStart(pkg.pgCtl, data, port);
  return {
    port,
    async stop() {
      await pgStop(pkg.pgCtl, data);
      // Windows can hold the directory a moment after the server has gone: named, not thrown
      try { rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); }
      catch (e) { console.error(`[embedded-store] left ${scratch} behind (${e.code ?? e.message})`); }
    },
  };
}

// ── THE TREE'S SERVER ─────────────────────────────────────────────────────────

const TREE_PG = `${ROOT}.pg`;

/** The tree's own server, `{ port }`, when pg.mjs provisioned one beside this checkout; else null. */
function treeServer() {
  if (process.env.OFFICE_STORE_SERVER === "own") return null;
  try { return JSON.parse(readFileSync(join(TREE_PG, "READY"), "utf8")); } catch { return null; }
}

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; } };

// A test database is t<pid>_<n>_<the db the caller asked for>: the pid says whose
// it is, so a database whose process is gone is a killed test's, and is dropped.
const TEST_DB = /^t(\d+)_\d+_/;
let made = 0;
let swept = false;

// The floor in the tree's server: a template database keyed on the package's
// version and every migration's bytes, built once under an advisory lock (the
// other starters wait on it) and marked a template only when it is finished, so
// a half-built floor is never cloned. A changed migration is a new key; the
// newest three floors are kept, so a flip and its restore don't rebuild.
const FLOOR_LOCK = 479;
async function treeFloor(su, version) {
  const h = createHash("sha256").update(version);
  for (const f of migrations()) h.update(f).update(readFileSync(join(SCHEMA, f)));
  const floor = `floor_${h.digest("hex").slice(0, 16)}`;
  const isReady = async () => (await su.query("SELECT 1 FROM pg_database WHERE datname = $1 AND datistemplate", [floor])).rowCount === 1;
  if (await isReady()) return floor;
  await su.query("SELECT pg_advisory_lock($1)", [FLOOR_LOCK]);
  try {
    if (await isReady()) return floor;
    await su.query(`DROP DATABASE IF EXISTS ${floor} WITH (FORCE)`); // a build that died half-way
    for (const r of ROLES) {
      const { rowCount } = await su.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [r]);
      if (!rowCount) await su.query(`CREATE ROLE ${r} LOGIN PASSWORD '${PW}'`);
    }
    await su.query(`CREATE DATABASE ${floor} OWNER world2_owner`);
    const owner = await (await connector(su.port))("world2_owner", floor);
    try { for (const f of migrations()) await owner.query(readFileSync(join(SCHEMA, f), "utf8")); }
    finally { await owner.end(); }
    await su.query(`ALTER DATABASE ${floor} IS_TEMPLATE true`);
    const { rows } = await su.query("SELECT datname FROM pg_database WHERE datname ~ '^floor_' AND datname <> $1 ORDER BY oid DESC OFFSET 2", [floor]);
    for (const { datname } of rows) {
      await su.query(`ALTER DATABASE ${datname} IS_TEMPLATE false`).catch(() => {});
      await su.query(`DROP DATABASE IF EXISTS ${datname}`).catch(() => {}); // one being cloned is kept for the next build
    }
    return floor;
  } finally { await su.query("SELECT pg_advisory_unlock($1)", [FLOOR_LOCK]); }
}

// The databases of tests that were killed: their process is gone.
async function sweepDead(su) {
  const { rows } = await su.query("SELECT datname FROM pg_database WHERE datname ~ '^t[0-9]+_[0-9]+_'");
  const dead = rows.map((r) => r.datname).filter((n) => !alive(Number(TEST_DB.exec(n)[1])));
  for (const n of dead) await su.query(`DROP DATABASE IF EXISTS "${n}" WITH (FORCE)`).catch(() => {});
  return dead;
}

async function superuser(port) {
  try { const su = await (await connector(port))("postgres", "postgres"); su.port = port; return su; }
  catch (e) {
    throw new Error(`${NO_STORE}: this tree's Postgres (${TREE_PG}, port ${port}) is not answering (${e.code ?? e.message}). `
      + `Start it: node G:/Postmark/pool/pg.mjs start ${ROOT.replace(/\\/g, "/").split("/").pop()} (claim.mjs starts it)`);
  }
}

/** Build this checkout's floor in the tree's server, for pg.mjs provision. Returns its name. */
export async function prepareTreeFloor() {
  const tree = treeServer();
  if (!tree) throw new Error(`no tree server at ${TREE_PG}`);
  const su = await superuser(tree.port);
  try { return await treeFloor(su, tree.version); } finally { await su.end(); }
}

async function treeStore(tree, db) {
  const su = await superuser(tree.port);
  let name;
  try {
    if (!swept) { swept = true; await sweepDead(su); }
    const floor = await treeFloor(su, tree.version);
    name = `t${process.pid}_${++made}_${db}`.slice(0, 63);
    await su.query(`CREATE DATABASE "${name}" TEMPLATE ${floor} OWNER world2_owner`);
  } finally { await su.end(); }
  return {
    port: tree.port,
    database: name,
    async stop() {
      const s = await superuser(tree.port);
      try { await s.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`); }
      catch (e) { console.error(`[embedded-store] left database ${name} behind (${e.message}); the next start sweeps it`); }
      finally { await s.end(); }
    },
  };
}

/**
 * Start a store with the whole schema applied: `{ connect(role), url(role), stop(), database }`,
 * where `connect` hands back a connected `pg.Client`. Throws NO_STORE, with the
 * cause, when no embedded Postgres can be found or started.
 *
 * `db` names the store for its caller; `connect(role, db)` and `url(role, db)`
 * reach it by that name. On a tree's server the database itself is named
 * apart (`database`), since every file there shares one server.
 */
export async function startStore({ db = "town_index_test" } = {}) {
  const tree = treeServer();
  let server;
  if (tree) server = await treeStore(tree, db);
  else {
    const own = await ownServer();
    const su = await (await connector(own.port))("postgres", "postgres");
    try { await su.query(`CREATE DATABASE ${db} TEMPLATE ${FLOOR_DB} OWNER world2_owner`); }
    finally { await su.end(); }
    server = { ...own, database: db };
  }
  const connectTo = await connector(server.port);
  const real = (database) => (database === db ? server.database : database);
  return {
    connect: (user, database = db) => connectTo(user, real(database)),
    /** A connection string for a role, for a child process (a spawned office) to dial. */
    url: (user, database = db) => `postgres://${user}:${PW}@127.0.0.1:${server.port}/${real(database)}`,
    /** The database the store is, on its server: for a query that reads the server's own views. */
    database: server.database,
    stop: () => server.stop(),
  };
}
