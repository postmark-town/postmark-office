// read-eval/office.mjs — the eval's office: local, seeded, fresh for every run (POS-486).
//
// A ROUND builds the town once: the local stand-in for the dev office
// (test/helpers/dev-target.mjs, POS-354: scratch clones of this tree's pinned
// town and world, the registry, the town index, an open window and the world's
// law, all in a database on this tree's own Postgres), plus the world graph
// snapshot the world reads stand on (world-hydrate --rows-out, then
// graph-ingest's writer) and one static key for the test household. That
// database is then copied to a TEMPLATE and the stand-in's own copy is dropped.
//
// A RUN gets a database made from that template (CREATE DATABASE ... TEMPLATE,
// about a second), so every run starts from the same seed and no run sees
// another's acts, and an office booted on it with WORLD_READ_SHAPE set to the
// run's variant. The clones are shared: the acts the eval's tasks make land in
// the store (W2_PEN), and `clonesClean()` says if a run ever wrote to them.
//
// EVERYTHING IS LOCAL. The town clone has no remote (TOWN_PUSH=0), the office's
// GitHub address is a loopback port nothing answers, and the store is a
// database on this tree's server. Nothing here can reach dev or prod.

import { execFileSync, spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const OFFICE = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const g = (repo, ...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8" }).trim();

/** The static key's household: the registry's house that lists the handle. */
async function householdOf(store, handle) {
  const c = await store.connect("world2_owner");
  try {
    const r = await c.query("SELECT slug FROM households WHERE $1 = ANY(residents) LIMIT 1", [handle]);
    return r.rows[0]?.slug ?? null;
  } finally { await c.end(); }
}

const envOf = (file) => Object.fromEntries(readFileSync(file, "utf8").trim().split(/\r?\n/)
  .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));

/**
 * Build the round: the seeded template and everything a run's office needs.
 * Answers `{ dir, template, env, key, handle, household, stop }`. `stop()` drops
 * the template and the stand-in's folder.
 */
export async function prepareRound({ handle, dir, seed = null, log = () => {} }) {
  const { localDevTarget } = await import("../../test/helpers/dev-target.mjs");
  const dev = await localDevTarget({ boot: false, db: "read_eval_seed", log });
  try {
    // the world graph snapshot, written the way the box's hydration writes it
    const rows = join(dev.dir, "world-rows.json");
    execFileSync(process.execPath, [join(OFFICE, "src", "world-hydrate.mjs"), "--world", dev.world, "--no-db", "--rows-out", rows, "--no-gexf", "--no-lints"],
      { stdio: "ignore", cwd: OFFICE });
    const { graphSnapshotFromTables, writeGraphSnapshot } = await import("../../world2/tools/graph-ingest.mjs");
    const c = await dev.store.connect("law_ingester");
    try { await writeGraphSnapshot(c, graphSnapshotFromTables(JSON.parse(readFileSync(rows, "utf8")))); } finally { await c.end(); }
    log("world graph snapshot written");

    // the test household's key, written by the office's own import (store and file)
    const household = await householdOf(dev.store, handle);
    if (!household) throw new Error(`no household in the registry lists ${handle}`);
    const key = `re_${randomBytes(18).toString("hex")}`;
    const env = envOf(dev.envFile);
    // the neighbour's key (the door suites' seed acts as them; no agent ever holds it)
    const neighbour = seed?.neighbour ?? null;
    const nHousehold = neighbour ? await householdOf(dev.store, neighbour) : null;
    const nKey = neighbour ? `re_${randomBytes(18).toString("hex")}` : null;
    execFileSync(process.execPath, [join(OFFICE, "tools", "static-keys-import.mjs"), "--oauth-db", join(dev.dir, "oauth.db")],
      { cwd: OFFICE, stdio: "ignore", env: { ...cleanEnv(), ...env, OFFICE_KEYS: [`${key}=${household}:${handle}`, ...(nKey ? [`${nKey}=${nHousehold}:${neighbour}`] : [])].join(";") } });
    log(`key written for ${handle} (household ${household})${neighbour ? `, and for the seed's neighbour ${neighbour} (${nHousehold})` : ""}`);
    const seeded = seed ? await seedDoors({ dev, env, key, nKey, seed, log }) : null;

    // the template: the seeded database copied, then the stand-in's own dropped by its stop
    const template = `read_eval_tpl_${process.pid}`;
    const su = await superuser(dev.store);
    try {
      await su.query(`DROP DATABASE IF EXISTS ${template}`);
      await su.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()", [dev.store.database]);
      await su.query(`CREATE DATABASE ${template} TEMPLATE "${dev.store.database}" OWNER world2_owner`);
      await su.query(`ALTER DATABASE ${template} IS_TEMPLATE true`);
    } finally { await su.end(); }
    log(`template ${template} made`);
    mkdirSync(dir, { recursive: true });
    return {
      dir: dev.dir, template, env, key, handle, household, seeded, port: portOf(dev.store), dev,
      clones: { town: dev.town, world: dev.world, townHead: g(dev.town, "rev-parse", "HEAD"), worldHead: g(dev.world, "rev-parse", "HEAD") },
      async stop() {
        const s = await superuser(dev.store);
        try {
          await s.query(`ALTER DATABASE ${template} IS_TEMPLATE false`).catch(() => {});
          await s.query(`DROP DATABASE IF EXISTS ${template} WITH (FORCE)`);
        } finally { await s.end(); }
        await dev.stop();
      },
    };
  } catch (e) { await dev.stop(); throw e; }
}

/**
 * THE DOOR SUITES' SEED, put through the office's own doors on the seed
 * database before it becomes the template: the test resident's bug (so "amend
 * that bug" has one), and the neighbour's events this week (so "which starts
 * first" and "RSVP" have them). Answers the ids, in the seed's own order.
 */
async function seedDoors({ dev, env, key, nKey, seed, log }) {
  const { freePort } = await import("../../test/helpers/dev-target.mjs");
  const { awaitListening } = await import("../../test/spawn-office.mjs");
  const port = await freePort();
  const child = spawn(process.execPath, [join(OFFICE, "src", "server.mjs"), "--port", String(port),
    "--db", join(dev.dir, "office.db"), "--oauth-db", join(dev.dir, "oauth.db"), "--roles-db", join(dev.dir, "roles.db")],
  { cwd: OFFICE, env: { ...cleanEnv(), ...env, PUBLIC_BASE: `http://127.0.0.1:${port}` }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  child.stdout.on("data", () => {}); child.stderr.on("data", () => {});
  try {
    await awaitListening(child, { budgetMs: 90_000 });
    const base = `http://127.0.0.1:${port}`;
    const must = async (k, door, args) => {
      const r = await callTool(base, k, door, args);
      if (r.isError || r.body?.error) throw new Error(`the seed's ${door} ${JSON.stringify(args).slice(0, 120)} was refused: ${JSON.stringify(r.body).slice(0, 300)}`);
      return r.body;
    };
    // round 2's errands bring their own seed (errands.mjs § ERRAND_SEED)
    if (seed.plant) {
      const ids = await seed.plant({ me: (door, args) => must(key, door, args), them: (door, args) => must(nKey, door, args), cross: () => crossTown({ dev, env, log }), log });
      log(`seeded: ${JSON.stringify(ids)}`);
      return ids;
    }
    const bug = await must(key, "town", { do: "post", args: { class: "bug", title: seed.bug.title, body: seed.bug.body, steps: seed.bug.steps } });
    const day0 = new Date(); day0.setUTCHours(0, 0, 0, 0);
    const events = [];
    for (const e of seed.events) {
      const starts = new Date(day0.getTime() + e.days * 86400_000 + (e.hour * 60 + e.minutes) * 60_000);
      const ends = new Date(starts.getTime() + 2 * 3600_000);
      const r = await must(nKey, "household", { do: "host", args: { title: e.title, place: e.place, starts: starts.toISOString(), ends: ends.toISOString() } });
      events.push(r.result?.post?.id ?? r.result?.event?.id ?? r.result?.id ?? null);
    }
    const ids = { bug: bug.result?.post?.id ?? null, events };
    if (!ids.bug || events.some((x) => !x)) throw new Error(`the seed could not read back its ids: ${JSON.stringify(ids)} (bug answer keys: ${Object.keys(bug.result ?? bug).join(", ")})`);
    log(`seeded: bug ${ids.bug}; events ${events.join(", ")}`);
    return ids;
  } finally {
    if (child.exitCode === null) { const gone = new Promise((ok) => child.on("exit", ok)); child.kill(); await gone; }
    for (const f of [`loop-lag-${port}.json`, `store-txn-${port}.json`]) rmSync(join(OFFICE, "telemetry", f), { force: true });
  }
}

/**
 * ONE CROSSING ON THE SEED, so a seeded letter is delivered the way the box
 * delivers it: the town-log drain (the office's rows become outbox files), the
 * town's ferry (outbox to inbox, and the mail ledger), each committed on the
 * round's scratch clone as the box commits them, then the town-index ingest
 * that brings the store's index up to the clone (tools/dev-rehearsal.mjs §
 * CROSSING, the first two jobs and its index step). The stand-in set real
 * residents' outboxes aside, so only the seed's letters cross. Never pushed:
 * the clone has no remote.
 */
async function crossTown({ dev, env, log }) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: env.TOWN_TZ ?? "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const base = { ...cleanEnv(), ...env, TOWN_PUSH: "0" };
  const job = (name, argv, { cwd = OFFICE, extra = {} } = {}) => {
    try { execFileSync(process.execPath, argv, { cwd, env: { ...base, ...extra }, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" }); }
    catch (e) { throw new Error(`the seed's crossing: ${name} exited ${e.status}: ${String(e.stdout ?? "").slice(-800)} ${String(e.stderr ?? "").slice(-800)}`); }
  };
  const commit = (message) => {
    if (!g(dev.town, "status", "--porcelain")) return false;
    g(dev.town, "add", "-A");
    g(dev.town, "-c", "user.name=read-eval seed", "-c", "user.email=read-eval@postmark.invalid", "commit", "-q", "-m", message);
    return true;
  };
  job("drain", [join(OFFICE, "tools", "town-drain-run.mjs"), "--clone", dev.town, "--db", join(dev.dir, "office.db"), "--oauth-db", join(dev.dir, "oauth.db"), "--date", today, "--unlocked"]);
  const drained = commit(`town-log: crossing ${today} (read-eval seed)`);
  job("ferry", [join(dev.town, "tools", "ferry.mjs"), "--no-git", "--date", today], { cwd: dev.town });
  const ferried = commit(`ferry: crossing ${today} (read-eval seed)`);
  const u = new URL(dev.store.url("law_ingester"));
  job("index", [join(OFFICE, "world2", "tools", "town-index-ingest.mjs"), "--town-repo", dev.town, "--sha", g(dev.town, "rev-parse", "HEAD")], {
    extra: { PGHOST: u.hostname, PGPORT: u.port, PGUSER: decodeURIComponent(u.username), PGPASSWORD: decodeURIComponent(u.password), PGDATABASE: decodeURIComponent(u.pathname.slice(1)), WORLD2_INGEST_URL: dev.store.url("law_ingester") },
  });
  log(`the seed's crossing ${today}: drain ${drained ? "committed" : "had nothing"}, ferry ${ferried ? "committed" : "had nothing"}, index ingested at ${g(dev.town, "rev-parse", "--short", "HEAD")}`);
  return { today, drained, ferried };
}

const portOf = (store) => Number(new URL(store.url("office_api")).port);

async function superuser(store) {
  const { default: pg } = await import("pg");
  const c = new pg.Client({ host: "127.0.0.1", port: portOf(store), user: "postgres", password: "local", database: "postgres" });
  c.on("error", () => {});
  await c.connect();
  return c;
}

/**
 * This process's environment without anything that could point a child at a
 * real store or key, and without any read shape: a run's office gets its own
 * door's shape from bootRun and nothing from the shell that started the round
 * (#455 review, finding 6).
 */
function cleanEnv() {
  const e = { ...process.env };
  for (const k of Object.keys(e)) if (/^(PG[A-Z]*|WORLD2_[A-Z_]*URL|OFFICE_KEYS|NODE_TEST_CONTEXT|WORLD_GRAPH_ROWS|WORLD_READ_SHAPE|TOWN_READ_SHAPE|HOUSEHOLD_READ_SHAPE)$/.test(k)) delete e[k];
  return e;
}

/** True when neither clone has moved or changed since the round was built. */
export function clonesClean(round) {
  const { town, world, townHead, worldHead } = round.clones;
  return g(town, "rev-parse", "HEAD") === townHead && g(world, "rev-parse", "HEAD") === worldHead
    && g(town, "status", "--porcelain") === "" && g(world, "status", "--porcelain") === "";
}

/**
 * Boot an office for one run, on a fresh copy of the template, at `shape`.
 * Answers `{ base, key, db, query(role, sql, params), stop }`.
 */
export async function bootRun(round, { shape, runId, log = () => {} }) {
  const { freePort } = await import("../../test/helpers/dev-target.mjs");
  const { awaitListening } = await import("../../test/spawn-office.mjs");
  const db = `read_eval_run_${runId}`.replace(/[^a-z0-9_]/g, "_").slice(0, 63);
  const su = await superuser(round.dev.store);
  try {
    await su.query(`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`);
    await su.query(`CREATE DATABASE ${db} TEMPLATE ${round.template} OWNER world2_owner`);
  } finally { await su.end(); }
  const swap = (url) => url.replace(/\/[^/]+$/, `/${db}`);
  const port = await freePort();
  const env = { ...round.env, PUBLIC_BASE: `http://127.0.0.1:${port}`, WORLD2_PG_URL: swap(round.env.WORLD2_PG_URL),
    ...(round.env.WORLD2_STANCE_URL ? { WORLD2_STANCE_URL: swap(round.env.WORLD2_STANCE_URL) } : {}),
    // the variant's own door: v* is the world's, t* the town's, h* the household's
    [{ t: "TOWN_READ_SHAPE", h: "HOUSEHOLD_READ_SHAPE" }[shape[0]] ?? "WORLD_READ_SHAPE"]: shape };
  const child = spawn(process.execPath, [join(OFFICE, "src", "server.mjs"), "--port", String(port),
    "--db", join(round.dir, "office.db"), "--oauth-db", join(round.dir, "oauth.db"), "--roles-db", join(round.dir, "roles.db")],
  { cwd: OFFICE, env: { ...cleanEnv(), ...env }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  let errText = "";
  child.stderr.on("data", (d) => { errText = (errText + d).slice(-20000); });
  child.stdout.on("data", () => {});
  await awaitListening(child, { budgetMs: 90_000 });
  log(`office :${port} on ${db} at ${shape}`);
  const { default: pg } = await import("pg");
  const query = async (role, sql, params = []) => {
    const c = new pg.Client({ connectionString: swap(round.dev.store.url(role)) });
    c.on("error", () => {});
    await c.connect();
    try { return (await c.query(sql, params)).rows; } finally { await c.end(); }
  };
  return {
    base: env.PUBLIC_BASE, key: round.key, db, query, stderr: () => errText,
    async stop() {
      if (child.exitCode === null) { const gone = new Promise((ok) => child.on("exit", ok)); child.kill(); await gone; }
      for (const f of [`loop-lag-${port}.json`, `store-txn-${port}.json`]) rmSync(join(OFFICE, "telemetry", f), { force: true });
      const s = await superuser(round.dev.store);
      try { await s.query(`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`); } finally { await s.end(); }
    },
  };
}

/** One MCP call to an office, as the agent would make it. */
export async function mcp(base, key, method, params = {}) {
  const r = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${key}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* an SSE frame or an error page */ }
  return { status: r.status, text, json };
}

/** A tool call's answer, parsed from its text content. */
export async function callTool(base, key, name, args = {}) {
  const r = await mcp(base, key, "tools/call", { name, arguments: args });
  const t = r.json?.result?.content?.find((c) => c.type === "text")?.text ?? null;
  let body = null;
  try { body = t == null ? null : JSON.parse(t); } catch { body = t; }
  return { status: r.status, isError: Boolean(r.json?.result?.isError), body, chars: t?.length ?? 0 };
}

export const keyHash = (key) => createHash("sha256").update(key).digest("base64url");
