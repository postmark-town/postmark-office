// dev-target.mjs — a local stand-in for the dev office, for tools/dev-rehearsal.mjs's
// own test (POS-354): an embedded store with every migration, scratch clones of
// this tree's town and world, the two env files the box holds, and this tree's
// office booted on them.
//
//   const dev = await localDevTarget();
//   const report = await runRehearsal(dev.target);
//   await dev.stop();
//
// The store is seeded the way the box's was: the registry from the town's two
// printouts, then the town index from a snapshot (town-index-ingest --seed), as
// law_ingester. The town clone has no remote, so nothing it does can leave the
// machine; the office's GITHUB_API_URL names a loopback port the rehearsal's
// stub takes. A store that cannot start FAILS (embedded-store.mjs § NO_STORE).

import { execFileSync, spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { startStore } from "./embedded-store.mjs";
import { seedRegistry } from "./office-under-test.mjs";
import { awaitListening } from "../spawn-office.mjs";

const OFFICE = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const g = (repo, ...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).trim();

/** A port the OS says is free now. */
export const freePort = () => new Promise((ok, no) => {
  const s = createServer();
  s.once("error", no);
  s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => ok(port)); });
});

/** A scratch clone with no remote, committing as the harness. */
function scratchClone(source, dest) {
  execFileSync("git", ["-c", "core.autocrlf=false", "clone", "--local", "--quiet", "--config", "core.autocrlf=false", source, dest]);
  g(dest, "checkout", "-q", "-B", "main"); // the box's clones sit on main, and the settlement pins it
  g(dest, "remote", "remove", "origin");
  g(dest, "config", "user.name", "dev-rehearsal-harness");
  g(dest, "config", "user.email", "harness@postmark.invalid");
  return dest;
}

/** The world's law into the store at the world clone's HEAD (world2/tools/law-ingest.mjs, its main run). */
export async function ingestLaw(store, world) {
  const { deriveLaw, writeLaw } = await import("../../world2/tools/law-ingest.mjs");
  const { rows } = await deriveLaw({ lawRepo: world });
  const c = await store.connect("law_ingester");
  try { await writeLaw(c, { lawSha: g(world, "rev-parse", "HEAD"), rows }); } // the main run: it sets projection_heads['world-law'], the clearing's pin
  finally { await c.end(); }
}

/**
 * Build the stand-in. `db` is the store's database name (the guard reads it from
 * the env file this writes). `envOverrides` changes lines of the dev env file,
 * so a test can hand the rehearsal a misconfigured office.
 */
export async function localDevTarget({
  db = "w2_devsandbox_rehearsal",
  townSource = join(OFFICE, "town-clone"),
  worldSource = join(OFFICE, "world-clone"),
  envOverrides = {},
  rolesOverrides = {},
  boot = true,
  windowId = 240,
  worldSuite = false,
  log = () => {},
} = {}) {
  const dir = mkdtempSync(join(tmpdir(), "dev-target-"));
  const cleanups = [() => rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })];
  const stop = async () => { for (const c of cleanups.reverse()) { try { await c(); } catch { /* litter */ } } };
  try {
    const store = await startStore({ db });
    cleanups.push(() => store.stop());
    const town = scratchClone(townSource, join(dir, "town-clone"));
    const world = scratchClone(worldSource, join(dir, "world-clone"));
    // The world's own checker suite (test:candle) runs after a settlement publishes, as a
    // warning, never a hold; on this machine it costs ~25 minutes a settlement. The box's
    // run keeps it. Here it is replaced in the scratch world, and the stand-in says so.
    if (!worldSuite) {
      const pkgPath = join(world, "package.json");
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
      pkg.scripts["test:candle"] = "node -e \"console.log('# the local stand-in skips the world checker suite (test/helpers/dev-target.mjs); the box runs it')\"";
      writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
      g(world, "commit", "-qam", "harness: the world checker suite skipped in the local stand-in");
    }
    log(`clones: town ${g(town, "rev-parse", "--short", "HEAD")}, world ${g(world, "rev-parse", "--short", "HEAD")}`);

    // THE STAMP KEY. The dev box keeps its own (/srv/postmark-office-dev/stamp-key.pem),
    // and postmark-dev-freshen moves the clone onto it every night with
    // tools/dev-ledger-resign.mjs; here a throwaway key, a stand-in "prod" key
    // the tool must refuse, and the same tool. Real residents' outboxes are then
    // set aside so only the rehearsal's letters cross.
    const { generateKeyPairSync } = await import("node:crypto");
    const { resignDevTown } = await import("../../tools/dev-ledger-resign.mjs");
    const pemOf = () => generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" });
    const keyPem = pemOf();
    const stampKey = join(dir, "stamp-key.pem");
    writeFileSync(stampKey, keyPem);
    const prodKey = join(dir, "prod-stamp-key.pem");
    writeFileSync(prodKey, pemOf());
    const moved = await resignDevTown({ town, keyPem, notKeyPem: readFileSync(prodKey, "utf8") });
    if (moved.status !== "resigned") throw new Error(`the stand-in's re-sign: ${moved.status} ${moved.why ?? ""}`);
    const wp = join(town, "WHITE_PAGES");
    for (const room of readdirSync(wp, { withFileTypes: true })) {
      const ob = join(wp, room.name, "outbox");
      if (!room.isDirectory() || !existsSync(ob)) continue;
      for (const f of readdirSync(ob)) if (f !== ".gitkeep") rmSync(join(ob, f), { recursive: true, force: true });
    }
    g(town, "add", "-A");
    g(town, "commit", "-q", "-m", "harness: real outboxes set aside");

    // the registry, from the town's two printouts (019 needs since/declared_by; a printout may omit them)
    const read = (rel) => (existsSync(join(town, rel)) ? JSON.parse(readFileSync(join(town, rel), "utf8")) : null);
    const doc = read("tools/households.json") ?? { schema_version: 1, households: {} };
    const houses = {};
    for (const [slug, rec] of Object.entries(doc.households ?? {}))
      houses[slug] = { since: "2026-01-01", declared_by: (rec?.residents ?? [])[0] ?? slug, ...rec };
    await seedRegistry(store, { ...doc, households: houses }, read("tools/github-ids.json") ?? {});

    // office.db, as the dev box holds one (the office opens it at boot even with
    // TOWN_INDEX_READS=store), and the town index copied from it into the store
    // with its head at the clone's HEAD, so the rehearsal's ingests are deltas
    // (the suites' seam, test/helpers/index-to-store.mjs; the git-walking seed
    // costs as much again for the same rows)
    const t0 = Date.now();
    const officeDb = join(dir, "office.db");
    execFileSync(process.execPath, [join(OFFICE, "src", "hydrate.mjs"), "--town", town, "--db", officeDb], { cwd: OFFICE, stdio: "ignore", env: { ...process.env, NODE_NO_WARNINGS: "1" } });
    const { DatabaseSync } = await import("node:sqlite");
    const { copyIndexToStore } = await import("./index-to-store.mjs");
    const { HEAD_KEY } = await import("../../world2/tools/town-index-ingest.mjs");
    const w = await store.connect("law_ingester");
    const sdb = new DatabaseSync(officeDb, { readOnly: true });
    try {
      await w.query("BEGIN");
      await copyIndexToStore(w, sdb);
      await w.query("INSERT INTO projection_heads (repo, sha, ingested_at) VALUES ($1, $2, now()) ON CONFLICT (repo) DO UPDATE SET sha = EXCLUDED.sha, ingested_at = now()", [HEAD_KEY, g(town, "rev-parse", "HEAD")]);
      await w.query("COMMIT");
    } finally { sdb.close(); await w.end(); }
    log(`store: registry seeded; office.db hydrated and its town index copied in ${Math.round((Date.now() - t0) / 1000)} s`);

    // THE STORE'S STAMP CHAIN, in the box's switch order (066/067, one ingest, one
    // stamp-lines --sync, then STAMP_LINES=store; deploy/DEPLOY.md § The dev
    // rehearsal): recorded from the clone AFTER the re-sign, so it carries dev's signatures.
    const { syncStampLinesVia } = await import("../../src/stamp-lines.mjs");
    const pen = await store.connect("office_api");
    try {
      await pen.query("BEGIN");
      const synced = await syncStampLinesVia(pen, town);
      await pen.query("COMMIT");
      log(`store: stamp_lines holds the clone's ${synced.inserted} ledger lines`);
    } catch (e) { await pen.query("ROLLBACK").catch(() => {}); throw e; }
    finally { await pen.end(); }

    // THE CANDLE: one open window, as the dev store always holds one (the clearing
    // opens the next in the same transaction). The id is a crossing number past the
    // world's newest settlement, so a blessed rehearsal settlement names a real window.
    const o = await store.connect("world2_owner");
    try {
      await o.query("INSERT INTO windows (id, opens_at, closes_at, status) VALUES ($1, date_trunc('second', now()) - interval '1 hour', date_trunc('second', now()) + interval '11 hours', 'open')", [windowId]);
    } finally { await o.end(); }
    // THE LAW the candle computes against (the dev store holds a world-law head; a
    // clearing refuses without one), ingested from the world clone as law_ingester.
    await ingestLaw(store, world);

    const officePort = await freePort();
    const ghPort = await freePort();
    const env = {
      TOWN_CLONE: town, TOWN_PUSH: "0", TOWN_TZ: "America/New_York",
      BOT_NAME: "Postmark Pen", BOT_EMAIL: "harness@postmark.invalid",
      PUBLIC_BASE: `http://127.0.0.1:${officePort}`,
      POSTMARK_PEN_TOKEN: "pen-harness-token", POSTMARK_TOWN_REPO: "postmark-town/postmark", POSTMARK_TOWN_BRANCH: "main",
      GITHUB_API_URL: `http://127.0.0.1:${ghPort}`,
      WORLD_CLONE: world,
      WORLD_EMISSIONS: "1", WORLD_PRESENCE: "1", WORLD_APEX: "1", WORLD_MOVEMENT_V2: "1", LEDGER_FREEZE: "1",
      WORLD_SINGLE_LOG: "1", TOWN_SINGLE_LOG: "1",
      WORLD2_PG: "1", WORLD2_CANDLE: "1",
      WORLD2_PG_URL: store.url("office_api"), WORLD2_STANCE_URL: store.url("stance_reader"),
      W2_PEN: "stance,hold,say,walk,frame,mark", W2_GUARDS: "1", WORLD_POSITIONS: "1",
      OFFICE_READ_WORKERS: "0", STAMP_KEY: stampKey, STAMP_LINES: "store",
      STATE_LOG_SOURCE: "store", OFFICE_PAPERWORK_STORE: "1", TOWN_INDEX_READS: "store",
      ...envOverrides,
    };
    for (const [k, v] of Object.entries(env)) if (v === undefined) delete env[k];
    const envFile = join(dir, "postmark-office-dev.env");
    writeFileSync(envFile, Object.entries(env).map(([k, v]) => `${k}=${v}`).join("\n") + "\n");
    const roles = { WORLD2_INGEST_URL: store.url("law_ingester"), WORLD2_CLEARING_URL: store.url("clearing_job"), ...rolesOverrides };
    for (const [k, v] of Object.entries(roles)) if (v === undefined) delete roles[k];
    const rolesFile = join(dir, "postmark-dev-rehearsal.env");
    writeFileSync(rolesFile, Object.entries(roles).map(([k, v]) => `${k}=${v}`).join("\n") + "\n");

    let office = null;
    if (boot) {
      const childEnv = { ...process.env };
      for (const k of Object.keys(childEnv)) if (/^(PG[A-Z]*|WORLD2_[A-Z_]*URL|OFFICE_KEYS)$/.test(k)) delete childEnv[k];
      const child = spawn(process.execPath, [join(OFFICE, "src", "server.mjs"), "--port", String(officePort),
        "--db", officeDb, "--oauth-db", join(dir, "oauth.db"), "--roles-db", join(dir, "roles.db")],
      { cwd: OFFICE, env: { ...childEnv, ...env }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
      // the office writes its instruments under the tree's telemetry/ by port (src/loop-lag.mjs, store-txn-watch.mjs);
      // registered before the kill, so (cleanups run in reverse) they go after the office has stopped writing them
      for (const f of [`loop-lag-${officePort}.json`, `store-txn-${officePort}.json`]) cleanups.push(() => rmSync(join(OFFICE, "telemetry", f), { force: true }));
      cleanups.push(async () => { if (child.exitCode === null) { const gone = new Promise((ok) => child.on("exit", ok)); child.kill(); await gone; } });
      let errText = "";
      child.stderr.on("data", (d) => { errText = (errText + d).slice(-20000); });
      await awaitListening(child, { budgetMs: 60_000 });
      office = { child, stderr: () => errText };
      log(`office: listening on :${officePort}`);
    }
    return { dir, store, town, world, envFile, rolesFile, prodKey, officeBase: `http://127.0.0.1:${officePort}`, ghPort, office, stop };
  } catch (e) { await stop(); throw e; }
}
