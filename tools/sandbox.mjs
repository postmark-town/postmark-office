#!/usr/bin/env node
// sandbox.mjs — the local sandbox: a whole office on this tree's own Postgres,
// a seeded town, crossings by hand, media open, and the viewer pointed at it,
// for trying World mechanics fast (POS-560).
//
// ── WHY ─────────────────────────────────────────────────────────────────────
//
// Darko, 2026-10-10: "We need to build basically a sandbox that I can quickly,
// and you can also quickly, try things in." Dev was meant for this, and it is
// too heavy: it resets nightly, has no crossing timer, serves prod's world and
// keeps media closed. This is the fully local one.
//
// ── THE COMMANDS ────────────────────────────────────────────────────────────
//
//   node tools/sandbox.mjs up       [--port 4590] [--viewer-port 4591]
//        Builds the seed the first time (about 8 minutes, once), then starts
//        the office, the GitHub stub and the viewer, and stays in the
//        foreground. Ctrl-C stops everything.
//   node tools/sandbox.mjs cross    [--ferry | --settle] [--keep]
//        A crossing now, as the box runs one: the ferry and the keeping tick's
//        mint on the town clone, then the clearing, the settlement and the
//        keeper's bless on the world. --ferry runs only the town half,
//        --settle only the world half. Needs `up` running.
//   node tools/sandbox.mjs as <handle> <tool> ['<json args>']
//        One MCP tool call as a seeded resident: world, household, town, …
//   node tools/sandbox.mjs call <handle> <METHOD> <path> ['<json body>']
//        One REST call as a seeded resident.
//   node tools/sandbox.mjs look     --at x,y [--crossing N] [--json]
//        The telling at a point, from the sandbox's world (tools/world-poc.mjs).
//   node tools/sandbox.mjs status
//   node tools/sandbox.mjs reset    Back to the seed (the sandbox must be down).
//   node tools/sandbox.mjs drop     Removes the sandbox's databases and folder.
//   node tools/sandbox.mjs mcp-config <handle>
//        An MCP server entry for an agent to act in the sandbox as a resident.
//
// The one-page guide is tools/SANDBOX.md.
//
// ── WHAT IT REUSES (it forks none of it) ────────────────────────────────────
//
//   · the dev rehearsal's local stand-in, test/helpers/dev-target.mjs
//     (localDevTarget): scratch clones of this tree's town and world with no
//     remote, the town's ledger re-signed onto a throwaway key by the dev
//     freshen's own tools/dev-ledger-resign.mjs, real outboxes set aside, the
//     registry and town index in the store, stamp_lines, an open window and
//     the world's law. It is built in this sandbox's folder and kept.
//   · the office's own migrations, through test/helpers/embedded-store.mjs
//     (treeDatabase: a named database from the tree's migrated floor).
//   · the world graph snapshot the way the read eval writes it
//     (src/world-hydrate.mjs --rows-out, world2/tools/graph-ingest.mjs).
//   · the dev rehearsal's crossing, tools/dev-rehearsal.mjs: its CROSSING job
//     list (postmark-ferry.service and the keep tick, job for job) and its
//     clearing, settlement and bless steps, run through crossingContext() and
//     plan() unchanged; its GitHub stub; its env-file target.
//   · the read eval's MCP caller, tools/read-eval/office.mjs (callTool, mcp).
//   · the office API for everything a resident does: the seeded houses
//     join through POST /households and add-resident, and leave their marks
//     through POST /world/marks. The one seam that is not an API call is the
//     rehearsal's: a household key minted for a synthetic GitHub account with
//     the office's own key desk function (src/oauth.mjs § mintHouseholdKey).
//
// ── WHAT IT NEVER DOES ──────────────────────────────────────────────────────
//
// Reach prod or dev. Before anything starts, sandboxProblems() checks that the
// store is this tree's own server on loopback and the database is the
// sandbox's, every URL in the office's env is loopback, no path is a box path,
// the clones have no remote, nothing pushes, the stamp key is the sandbox's
// own and its public half is not the town's (prod's), and R2 holds no real
// credential. Any problem refuses the start. Every node process it starts
// carries tools/lib/sandbox-fence.mjs, which destroys any socket to a host
// that is not this machine and answers the media endpoint's R2 writes from a
// local folder; git is held to file:// (GIT_ALLOW_PROTOCOL).
//
// Node 22+, on a pool tree (its own Postgres, node G:/Postmark/pool/pg.mjs).

import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createPublicKey } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer, request as httpRequest } from "node:http";
import { connect as netConnect } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const OFFICE = resolve(HERE, "..");
const importFrom = (p) => import(pathToFileURL(p).href);

export const DB = "sandbox";
export const SEED_DB = "sandbox_seed";
export const SEED_TAG = "sandbox-seed";
/** PROD's store and the rehearsal copy, by name: never the sandbox's (POS-243: the first name lies). */
export const REFUSED_DBS = ["world2_dev", "world2_rehearsal"];
const FENCE = join(OFFICE, "tools", "lib", "sandbox-fence.mjs");

/**
 * THE SEEDED TOWN: three households of the sandbox's own, each with a parcel
 * in open ground at the Town Centre's south edge, and two things to try the
 * hold verbs on. Everyone else in the town and the world is the real record
 * at the clones' shas (the law, the Keeping Works, the Mists' clearings), so
 * the engine and the ledger's verifiers run on what prod runs.
 */
export const HOUSES = [
  { household: "sb-lantern", residents: ["sb-ash", "sb-bram"], parcel: { x: 200, y: -350 },
    things: [{ slug: "a-bowl-of-candy", at: { x: 205, y: -345 }, body: "A wooden bowl of wrapped candy, left out for whoever passes." }] },
  { household: "sb-quill", residents: ["sb-cleo"], parcel: { x: 300, y: -350 },
    things: [{ slug: "a-lantern", at: { x: 302, y: -352 }, body: "An iron lantern with a stub of candle in it." }] },
  { household: "sb-moss", residents: ["sb-dov"], parcel: { x: 400, y: -350 }, things: [] },
];
/** Synthetic GitHub accounts: above every real id, apart from the rehearsal's (2.1e9 + …), below 2^31. */
const GH_BASE = 2_050_000_000;

// ── small helpers ────────────────────────────────────────────────────────────

const git = (repo, ...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, windowsHide: true }).trim();
const gitQuiet = (repo, ...a) => spawnSync("git", ["-C", repo, ...a], { encoding: "utf8", windowsHide: true });
const say = (s) => process.stdout.write(`${s}\n`);
const ms = (t0) => `${Math.round((Date.now() - t0) / 100) / 10} s`;
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; } };
const readJson = (p, d = null) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return d; } };

/** The sandbox's folders, from its root. */
export function layout(dir) {
  return {
    dir,
    live: join(dir, "live"),               // the stand-in's folder: clones, keys, env files
    seedFiles: join(dir, "seed-files"),    // the seed's copies of the office's file databases
    media: join(dir, "media"),             // the media endpoint's objects (R2 keys), served at /shelf/
    logs: join(dir, "logs"),
    state: join(dir, "state.json"),        // the seed: shas, houses, keys
    run: join(dir, "run.json"),            // while up: ports and pid
    officeEnv: join(dir, "live", "sandbox-office.env"),
    rolesEnv: join(dir, "live", "postmark-dev-rehearsal.env"),
  };
}

/**
 * This process's environment without anything that could point a child at a
 * real store, key, bucket or remote. Every child starts from this.
 */
export function cleanEnv(env = process.env) {
  const e = { ...env };
  for (const k of Object.keys(e))
    if (/^(PG[A-Z]*|WORLD2_[A-Z_]*URL|OFFICE_KEYS|R2_[A-Z_]*|MEDIA_[A-Z_]*|STAMP_KEY|TOWN_CLONE|WORLD_CLONE|TOWN_PUSH|GITHUB_[A-Z_]*|GH_TOKEN|GH_ENTERPRISE_TOKEN|NODE_OPTIONS|NODE_TEST_CONTEXT|[A-Z]+_READ_SHAPE|SETTLEMENT_[A-Z_]*|POSTMARK_[A-Z_]*)$/.test(k)) delete e[k];
  return e;
}

/** Git bash's sh, for settlement-auto.sh, when this shell has none on PATH (PowerShell on Windows). */
function pathWithSh(env) {
  if (process.platform !== "win32") return env;
  const probe = spawnSync("sh", ["-c", "true"], { env, windowsHide: true });
  if (probe.status === 0) return env;
  try {
    const exec = execFileSync("git", ["--exec-path"], { encoding: "utf8", windowsHide: true }).trim(); // …/mingw64/libexec/git-core
    const usrBin = resolve(exec, "..", "..", "..", "usr", "bin");
    if (existsSync(join(usrBin, "sh.exe"))) {
      const key = Object.keys(env).find((k) => k.toUpperCase() === "PATH") ?? "PATH";
      return { ...env, [key]: `${usrBin};${env[key] ?? ""}` };
    }
  } catch { /* the settlement names the missing sh */ }
  return env;
}

// ── the guard ────────────────────────────────────────────────────────────────

const LOOPBACK_HOST = /^(localhost|127\.\d+\.\d+\.\d+|\[?::1\]?)$/i;

/** The public half of a PEM key (private or public), as SPKI PEM, or null. */
export function publicPem(pem) {
  try { return createPublicKey(pem).export({ type: "spki", format: "pem" }).toString().trim(); } catch { return null; }
}

/**
 * Every reason the sandbox could reach prod or dev, from what it is about to
 * start with. Empty means start. Reads only what it is handed.
 *
 *   env        the office's environment, exactly as it will be spawned
 *   roles      the crossing's pens (WORLD2_INGEST_URL, WORLD2_CLEARING_URL)
 *   remotes    { town: [...], world: [...] } the clones' `git remote -v` lines
 *   townPub    the source town's own tools/stamp-pubkey.pem (prod's public key)
 *   keyPem     the sandbox's stamp key
 *   dir        the sandbox's folder: every path the env names must be inside it or the office tree
 */
export function sandboxProblems({ env, roles = {}, remotes = {}, townPub = null, keyPem = null, dir, office = OFFICE, port = null }) {
  const p = [];
  const looksLikeUrl = ([, v]) => /^[a-z][a-z0-9+.-]*:\/\//i.test(String(v));
  // a pen given as a keyword string (host=… dbname=…) is read below, with PG*
  const urls = Object.fromEntries([...Object.entries(env), ...Object.entries(roles)].filter(looksLikeUrl));
  for (const [k, v] of Object.entries(urls)) {
    let u;
    try { u = new URL(v); } catch { p.push(`${k} is not a URL: ${String(v).slice(0, 80)}`); continue; }
    if (!LOOPBACK_HOST.test(u.hostname)) p.push(`${k} names ${u.hostname}, not this machine`);
    if (/^postgres(ql)?:$/.test(u.protocol)) {
      const db = decodeURIComponent(u.pathname.slice(1));
      if (REFUSED_DBS.includes(db)) p.push(`${k} names ${db}: PROD's store or its rehearsal copy`);
      else if (db !== DB) p.push(`${k} names the database ${db}, not the sandbox's (${DB})`);
      if (port != null && Number(u.port) !== Number(port)) p.push(`${k} dials port ${u.port}, not this tree's own Postgres (${port})`);
    }
  }
  // the other two ways a pen finds a store: PG* (libpq's environment) and a keyword string (host=… dbname=…)
  const dbProblem = (k, db) => (REFUSED_DBS.includes(db) ? `${k} names ${db}: PROD's store or its rehearsal copy` : db !== DB ? `${k} names the database ${db}, not the sandbox's (${DB})` : null);
  for (const [k, v] of Object.entries({ ...env, ...roles })) {
    if (k === "PGHOST" || k === "PGHOSTADDR") { for (const h of String(v).split(",")) if (!LOOPBACK_HOST.test(h.trim()) && !h.trim().startsWith("/")) p.push(`${k} names ${h.trim()}, not this machine`); }
    else if (k === "PGDATABASE") { const x = dbProblem(k, String(v)); if (x) p.push(x); }
    else if (k === "PGPORT" && port != null && Number(v) !== Number(port)) p.push(`${k} is ${v}, not this tree's own Postgres (${port})`);
    else if (k === "PGSERVICE" || k === "PGSERVICEFILE") p.push(`${k} is set: a service file can name any store`);
    const words = /^[^:]*\b(host|hostaddr|dbname)\s*=/.test(String(v)) ? Object.fromEntries([...String(v).matchAll(/(\w+)\s*=\s*('(?:[^'\\]|\\.)*'|\S+)/g)].map(([, a, b]) => [a, b.replace(/^'|'$/g, "")])) : null;
    if (words) {
      for (const hk of ["host", "hostaddr"]) for (const h of String(words[hk] ?? "").split(",").filter(Boolean)) if (!LOOPBACK_HOST.test(h.trim()) && !h.trim().startsWith("/")) p.push(`${k} names ${h.trim()}, not this machine`);
      if (words.dbname != null) { const x = dbProblem(k, words.dbname); if (x) p.push(x); }
      if (words.service != null) p.push(`${k} names a service (${words.service}): a service file can name any store`);
      if (port != null && words.port != null && Number(words.port) !== Number(port)) p.push(`${k} dials port ${words.port}, not this tree's own Postgres (${port})`);
    }
  }
  for (const k of ["WORLD2_PG_URL", "GITHUB_API_URL", "PUBLIC_BASE"]) if (!env[k]) p.push(`the office's env has no ${k}`);
  if (env.TOWN_PUSH !== "0") p.push(`TOWN_PUSH is ${env.TOWN_PUSH ?? "unset"}, not 0`);
  if (env.SANDBOX_FENCE !== "1" || !String(env.NODE_OPTIONS ?? "").includes("sandbox-fence.mjs")) p.push("the fence (tools/lib/sandbox-fence.mjs) is not loaded into the office");
  if (!/^file$/.test(env.GIT_ALLOW_PROTOCOL ?? "")) p.push("git is not held to file:// (GIT_ALLOW_PROTOCOL=file)");
  // R2: the fence answers the media endpoint; a real credential must never ride along
  for (const k of ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"]) if (env[k] !== "sandbox") p.push(`${k} is not the sandbox's stand-in`);
  // paths: the box's, or anything outside the sandbox and this office tree
  const inside = (v) => { const n = normalize(resolve(v)); return [dir, office].some((root) => n === normalize(root) || n.startsWith(normalize(root) + sep)); };
  for (const [k, v] of Object.entries(env)) {
    if (k === "NODE_OPTIONS" || k === "PATH" || /^[a-z][a-z0-9+.-]*:\/\//i.test(String(v))) continue;
    if (/^\/(srv|etc)\//.test(String(v))) p.push(`${k} names a box path (${v})`);
    else if (/^(STAMP_KEY|TOWN_CLONE|WORLD_CLONE|SANDBOX_MEDIA_DIR)$/.test(k) && !inside(v)) p.push(`${k} names ${v}, outside the sandbox's folder`);
  }
  for (const [name, lines] of Object.entries(remotes)) if ((lines ?? []).length) p.push(`the ${name} clone has a remote (${lines[0]}): nothing it does may leave the machine`);
  if (!keyPem) p.push("the sandbox has no stamp key of its own");
  else if (!townPub) p.push("the town's own public key (tools/stamp-pubkey.pem) could not be read, so the sandbox key cannot be proved not prod's");
  else if (publicPem(keyPem) === publicPem(townPub)) p.push("the sandbox's stamp key is the town's (prod's) key");
  return p;
}

// ── the office's environment ─────────────────────────────────────────────────

/** The office's env for this run: the stand-in's dev env, the run's ports, the fence, media open. */
export function officeEnvFor(L, seedEnv, { officePort, ghPort }) {
  return {
    ...seedEnv,
    PUBLIC_BASE: `http://127.0.0.1:${officePort}`,
    GITHUB_API_URL: `http://127.0.0.1:${ghPort}`,
    // GitHub's sign-in dance: nothing answers it here (the seeded houses hold keys)
    GITHUB_AUTH_URL: `http://127.0.0.1:${ghPort}/login/oauth/authorize`,
    GITHUB_TOKEN_URL: `http://127.0.0.1:${ghPort}/login/oauth/access_token`,
    TOWN_PUSH: "0",
    // media open: the fence answers the R2 PUT from L.media
    R2_ACCOUNT_ID: "sandbox", R2_ACCESS_KEY_ID: "sandbox", R2_SECRET_ACCESS_KEY: "sandbox", R2_BUCKET: "postmark-media",
    SANDBOX_FENCE: "1", SANDBOX_MEDIA_DIR: L.media,
    NODE_OPTIONS: `--import=${pathToFileURL(FENCE).href}`,
    GIT_ALLOW_PROTOCOL: "file",
  };
}

function writeEnvFile(path, env) {
  writeFileSync(path, Object.entries(env).map(([k, v]) => `${k}=${v}`).join("\n") + "\n");
}

async function guardOrThrow(L, env, roles, store) {
  const state = readJson(L.state, {});
  const remotes = {};
  for (const [name, repo] of [["town", env.TOWN_CLONE], ["world", env.WORLD_CLONE]])
    remotes[name] = existsSync(join(repo ?? "", ".git")) ? git(repo, "remote", "-v").split("\n").filter(Boolean) : [`no clone at ${repo}`];
  const keyPem = existsSync(env.STAMP_KEY ?? "") ? readFileSync(env.STAMP_KEY, "utf8") : null;
  const problems = sandboxProblems({ env, roles, remotes, townPub: state.town_pubkey ?? null, keyPem, dir: L.dir, port: store?.port ?? null });
  // the second instrument: ask the store which database and port it is
  if (store) {
    const c = await store.connect("office_api");
    try {
      const [{ db, port }] = (await c.query("SELECT current_database() AS db, current_setting('port') AS port")).rows;
      if (db !== DB) problems.push(`the office's pen reached ${db}, not ${DB}`);
      if (Number(port) !== Number(store.port)) problems.push(`the store answered from port ${port}, not the tree's ${store.port}`);
    } finally { await c.end(); }
  }
  if (problems.length) throw Object.assign(new Error(`the sandbox refuses to start:\n  ${problems.join("\n  ")}`), { refusal: true });
  return "sandbox: guard green (this tree's own Postgres, database sandbox; every URL loopback; no remote; the sandbox's own key; the fence on)";
}

// ── processes ────────────────────────────────────────────────────────────────

async function bootOffice(L, env, port, { logFile }) {
  const { awaitListening } = await importFrom(join(OFFICE, "test", "spawn-office.mjs"));
  const child = spawn(process.execPath, [join(OFFICE, "src", "server.mjs"), "--port", String(port),
    "--oauth-db", join(L.live, "oauth.db"), "--roles-db", join(L.live, "roles.db")],
  { cwd: OFFICE, env: { ...cleanEnv(), ...env }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  const { createWriteStream } = await import("node:fs");
  const out = createWriteStream(logFile, { flags: "a" });
  child.stdout.pipe(out, { end: false });
  child.stderr.pipe(out, { end: false });
  await awaitListening(child, { budgetMs: 120_000 });
  return {
    child,
    pid: child.pid,
    async stop() {
      if (child.exitCode === null) { const gone = new Promise((ok) => child.on("exit", ok)); child.kill(); await gone; }
      for (const f of [`loop-lag-${port}.json`, `store-txn-${port}.json`]) rmSync(join(OFFICE, "telemetry", f), { force: true });
    },
  };
}

/**
 * The viewer, pointed at the sandbox: the world's own read-only spectator
 * (spectator/server.mjs, run from the sandbox's world clone) behind one small
 * front server that sends /api/* to the sandbox office (the viewer's office base
 * is "/api"), serves /shelf/* from the media folder and /atlas/* from the
 * town clone's own atlas (PROJECTS/build-the-town/atlas, which the site syncs),
 * and answers the site's /media/* with a 404, so nothing is fetched from the
 * town's site.
 */
async function bootViewer(L, { viewerPort, spectatorPort, officePort, env, logFile }) {
  const world = env.WORLD_CLONE;
  const { createWriteStream } = await import("node:fs");
  const out = createWriteStream(logFile, { flags: "a" });
  const spect = spawn(process.execPath, [join(world, "spectator", "server.mjs")], {
    cwd: join(world, "spectator"), windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
    env: { ...cleanEnv(), SANDBOX_FENCE: "1", NODE_OPTIONS: env.NODE_OPTIONS, PORT: String(spectatorPort),
      STAMP_LEDGER: join(env.TOWN_CLONE, "WHITE_PAGES", "stamp-ledger.md"),
      ATLAS_ORIGIN: `http://127.0.0.1:${viewerPort}/__sandbox_has_no_atlas`, SHELF_ORIGIN: `http://127.0.0.1:${viewerPort}/__sandbox_has_no_atlas` },
  });
  spect.stdout.pipe(out, { end: false });
  spect.stderr.pipe(out, { end: false });
  await new Promise((ok, no) => {
    const t = setTimeout(() => no(new Error("the spectator never said it was listening")), 30_000);
    spect.stdout.on("data", (d) => { if (/world-spectator/.test(String(d))) { clearTimeout(t); ok(); } });
    spect.on("exit", (code) => { clearTimeout(t); no(new Error(`the spectator exited ${code}`)); });
  });
  const forward = (req, res, port, path) => {
    const up = httpRequest({ host: "127.0.0.1", port, path, method: req.method, headers: { ...req.headers, host: `127.0.0.1:${port}` } }, (r) => {
      res.writeHead(r.statusCode, r.headers);
      r.pipe(res);
    });
    up.on("error", (e) => { res.writeHead(502, { "content-type": "application/json" }); res.end(JSON.stringify({ error: `the sandbox could not reach :${port} (${e.code ?? e.message})` })); });
    req.pipe(up);
  };
  const shelf = join(L.media, "media");
  const atlas = join(env.TOWN_CLONE, "PROJECTS", "build-the-town", "atlas");
  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://sandbox");
    const p = url.pathname;
    // THE MAP READS THE RECORD FILE. The store holds the law and the sandbox's own
    // marks, not the world's other 1,349 (with them as rows a settlement took 666 s
    // against 114 s, measured 2026-10-11), so the office's settled World is a
    // partial one and the map's regions have no rings to draw. Refused here, the
    // viewer falls back to /WORLD/world-state.json as it is built to, which is the
    // file each sandbox settlement writes into the sandbox's world.
    if (p === "/api/world/state" && !url.searchParams.has("settlement")) { res.writeHead(404, { "content-type": "application/json" }); return res.end(JSON.stringify({ error: "the sandbox's map reads the world file" })); }
    if (p === "/api" || p.startsWith("/api/")) return forward(req, res, officePort, (p.slice(4) || "/") + url.search);
    if (p.startsWith("/shelf/")) {
      const file = normalize(join(shelf, decodeURIComponent(p.slice(7))));
      if (!file.startsWith(normalize(shelf) + sep) || !existsSync(file)) { res.writeHead(404); return res.end(); }
      const ext = file.slice(file.lastIndexOf(".") + 1).toLowerCase();
      res.writeHead(200, { "content-type": { jpg: "image/jpeg", png: "image/png", webp: "image/webp", svg: "image/svg+xml" }[ext] ?? "application/octet-stream", "cache-control": "no-store" });
      return res.end(readFileSync(file));
    }
    // the atlas the town renders and the site syncs (/atlas/ground.html, the map's backdrop): from the town clone
    if (p.startsWith("/atlas/")) {
      const file = normalize(join(atlas, decodeURIComponent(p.slice(7))));
      if (file.startsWith(normalize(atlas) + sep) && /\.(html|json)$/.test(file) && existsSync(file)) {
        res.writeHead(200, { "content-type": file.endsWith(".html") ? "text/html; charset=utf-8" : "application/json; charset=utf-8", "cache-control": "no-store" });
        return res.end(readFileSync(file));
      }
    }
    if (p.startsWith("/atlas/") || p.startsWith("/media/") || p.startsWith("/__sandbox_has_no_atlas")) {
      res.writeHead(404, { "content-type": "application/json" });
      return res.end(JSON.stringify({ error: "the sandbox serves only the town clone's atlas, and nothing from the town's site" }));
    }
    return forward(req, res, spectatorPort, req.url);
  });
  await new Promise((ok, no) => { server.once("error", no); server.listen(viewerPort, "127.0.0.1", ok); });
  return {
    pid: spect.pid,
    async stop() {
      await new Promise((ok) => server.close(() => ok()));
      if (spect.exitCode === null) { const gone = new Promise((ok) => spect.on("exit", ok)); spect.kill(); await gone; }
    },
  };
}

// ── the seed ─────────────────────────────────────────────────────────────────

/** Whether anything answers on a port at either loopback address (another tool may hold one of them only). */
const answers = (port) => Promise.all(["127.0.0.1", "::1"].map((host) => new Promise((ok) => {
  const s = netConnect({ host, port });
  s.setTimeout(500, () => { s.destroy(); ok(false); });
  s.once("connect", () => { s.destroy(); ok(true); });
  s.once("error", () => ok(false));
}))).then((r) => r.some(Boolean));

async function ports(...wanted) {
  const { freePort } = await importFrom(join(OFFICE, "test", "helpers", "dev-target.mjs"));
  const out = [];
  for (const w of wanted) {
    if (w != null && !(await answers(w))) { out.push(w); continue; }
    const got = await freePort();
    if (w != null) say(`  port ${w} is taken on this machine; using ${got}`);
    out.push(got);
  }
  return out;
}

/** The world graph snapshot the office's world reads stand on, from the world clone (the read eval's way). */
async function writeGraph(store, world, scratch) {
  const rows = join(scratch, "world-rows.json");
  execFileSync(process.execPath, [join(OFFICE, "src", "world-hydrate.mjs"), "--world", world, "--no-db", "--rows-out", rows, "--no-gexf", "--no-lints"],
    { stdio: "ignore", cwd: OFFICE, env: cleanEnv(), windowsHide: true });
  const { graphSnapshotFromTables, writeGraphSnapshot } = await importFrom(join(OFFICE, "world2", "tools", "graph-ingest.mjs"));
  const c = await store.connect("law_ingester");
  try { await writeGraphSnapshot(c, graphSnapshotFromTables(JSON.parse(readFileSync(rows, "utf8")))); } finally { await c.end(); }
  rmSync(rows, { force: true });
}

/** A REST call to the office. Answers `{ status, body }`; a refusal is an answer. */
async function rest(base, method, path, { key = null, body } = {}) {
  const r = await fetch(new URL(path.replace(/^\//, ""), base.replace(/\/?$/, "/")), {
    method, headers: { ...(key ? { authorization: `Bearer ${key}` } : {}), ...(body !== undefined ? { "content-type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = { text: text.slice(0, 600) }; }
  return { status: r.status, body: parsed };
}
const said = (r) => `${r.status} ${r.body?.defect ?? r.body?.error?.defect ?? r.body?.error ?? ""}${r.body?.hint ? ` (${String(r.body.hint).slice(0, 200)})` : ""}`.trim();

/** The seeded houses, through the office API: the sign-in seam, the declaration, add-resident, the marks. */
async function seedHouses(L, store, base, log) {
  const { mintHouseholdKey } = await importFrom(join(OFFICE, "src", "oauth.mjs"));
  const { paperOnPool, paperworkPoolTypes } = await importFrom(join(OFFICE, "src", "paperwork.mjs"));
  const { default: pg } = await import("pg");
  const houses = [];
  for (const [i, h] of HOUSES.entries()) {
    const ghId = GH_BASE + i + 1;
    const login = h.household; // the household's name follows its account's
    const pool = new pg.Pool({ connectionString: store.url("office_api"), max: 1, types: paperworkPoolTypes(pg) });
    let key;
    try { key = await mintHouseholdKey(paperOnPool(pool), ghId, login); } finally { await pool.end(); }
    const [first, ...rest_] = h.residents;
    const joined = await rest(base, "POST", "/households", { key, body: {
      handle: first, household: h.household,
      card: `${first} lives in the local sandbox (POS-560): a seeded resident for trying World mechanics. Nothing here is the town's record.`,
    } });
    if (joined.status !== 201) throw new Error(`the seed's declaration for ${h.household} answered ${said(joined)}`);
    key = joined.body?.credential ?? key;
    for (const r of rest_) {
      const added = await rest(base, "POST", "/household", { key, body: { do: "add-resident", args: {
        handle: r, card: `${r} lives in the local sandbox (POS-560), in ${h.household}.`,
      } } });
      if (added.status >= 300 || added.body?.error) throw new Error(`the seed's add-resident ${r} answered ${said(added)}`);
    }
    const [row] = (await (async () => { const c = await store.connect("office_api"); try { return (await c.query("SELECT slug FROM households WHERE $1 = ANY(residents)", [first])).rows; } finally { await c.end(); } })());
    houses.push({ household: row?.slug ?? h.household, residents: h.residents, key, gh_id: ghId, login });
    log(`house ${h.household}: ${h.residents.join(", ")}`);
  }
  // the parcels, into the open window (free: min stake 0)
  for (const [i, h] of HOUSES.entries()) {
    const parcel = await rest(base, "POST", "/world/marks", { key: houses[i].key, body: {
      by: h.residents[0], slug: `${h.household}-ground`, kind: "parcel", at: h.parcel, stamps: 0,
      body: `${h.household}'s ground in the sandbox (POS-560).`,
    } });
    if (parcel.status >= 300 || parcel.body?.error) throw new Error(`the seed's parcel for ${h.household} answered ${said(parcel)}`);
    log(`parcel ${h.household}-ground at ${h.parcel.x},${h.parcel.y}`);
  }
  return houses;
}

/**
 * The things, on ground that now stands: a sited mark publishes free only when
 * its footprint is inside one of the household's parcels, so a thing left in
 * the same window as its parcel stays a draft (measured on the first seed).
 */
async function seedThings(base, houses, log) {
  for (const [i, h] of HOUSES.entries()) {
    const key = houses[i].key;
    const by = h.residents[0];
    for (const t of h.things) {
      // WHO MAY MAKE A THING is read from the class layer now (LOGOS v2, O1: its
      // `makers`, no floor), and right after the seed's bless the office's class
      // layer may still be the pre-bless one, where the new class nodes do not yet
      // stand in the works. The door says so with a 503; the seed waits for the
      // office's refresh (up to two minutes) rather than failing.
      let thing = null;
      for (let tries = 0; tries < 13; tries++) {
        thing = await rest(base, "POST", "/world/marks", { key, body: {
          by, slug: t.slug, kind: "sited", class: "thing", at: t.at, extent: { w: 1, h: 1 }, body: t.body, stamps: 0,
        } });
        if (!(thing.status === 503 && /could not be read/.test(String(thing.body?.defect ?? "")))) break;
        log(`thing ${by}/${t.slug}: the class layer is not readable yet (${thing.body.defect}); waiting 10 s for the office's refresh`);
        await new Promise((r) => setTimeout(r, 10_000));
      }
      if (thing.status >= 300 || thing.body?.error) throw new Error(`the seed's thing ${t.slug} answered ${said(thing)}`);
      log(`thing ${by}/${t.slug} at ${t.at.x},${t.at.y}`);
    }
  }
}

async function superuser(port) {
  const { default: pg } = await import("pg");
  const c = new pg.Client({ host: "127.0.0.1", port, user: "postgres", password: "local", database: "postgres" });
  c.on("error", () => {});
  await c.connect();
  return c;
}

/** The seed's snapshot: the clones tagged, the office's file databases copied, the store copied to a template. */
async function snapshot(L, store) {
  const env = readEnv(L);
  for (const repo of [env.TOWN_CLONE, env.WORLD_CLONE]) git(repo, "tag", "-f", SEED_TAG, "HEAD");
  mkdirSync(L.seedFiles, { recursive: true });
  for (const f of ["oauth.db", "roles.db"]) if (existsSync(join(L.live, f))) copyFileSync(join(L.live, f), join(L.seedFiles, f));
  const su = await superuser(store.port);
  try {
    await su.query(`ALTER DATABASE ${SEED_DB} IS_TEMPLATE false`).catch(() => {});
    await su.query(`DROP DATABASE IF EXISTS ${SEED_DB} WITH (FORCE)`);
    await su.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()", [DB]);
    await su.query(`CREATE DATABASE ${SEED_DB} TEMPLATE ${DB} OWNER world2_owner`);
    await su.query(`ALTER DATABASE ${SEED_DB} IS_TEMPLATE true`);
  } finally { await su.end(); }
}

function readEnv(L) {
  const out = {};
  for (const line of readFileSync(join(L.live, "postmark-office-dev.env"), "utf8").split(/\r?\n/)) {
    const i = line.indexOf("=");
    if (i > 0) out[line.slice(0, i)] = line.slice(i + 1);
  }
  return out;
}
function readRoles(L) {
  const out = {};
  for (const line of readFileSync(L.rolesEnv, "utf8").split(/\r?\n/)) {
    const i = line.indexOf("=");
    if (i > 0) out[line.slice(0, i)] = line.slice(i + 1);
  }
  return out;
}

/** The town's crossing number now (the town's own clock, tools/crossings.mjs). */
async function crossingNow(town) {
  const { crossingAt } = await importFrom(join(town, "tools", "crossings.mjs"));
  return crossingAt(Date.now());
}

/**
 * Build the seed: the stand-in in this sandbox's folder on the `sandbox`
 * database, the world graph, the seeded houses and their parcels through the
 * office API, a crossing (they stand ashore, the parcels settle), the things on that
 * ground, the world half of a second crossing (the things settle), then the
 * snapshot `reset` returns to.
 */
async function buildSeed(L, { town, world, log }) {
  const t0 = Date.now();
  const { treeDatabase } = await importFrom(join(OFFICE, "test", "helpers", "embedded-store.mjs"));
  const { localDevTarget } = await importFrom(join(OFFICE, "test", "helpers", "dev-target.mjs"));
  for (const p of [L.live, L.seedFiles, L.media]) if (existsSync(p)) rmSync(p, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  mkdirSync(L.live, { recursive: true });
  mkdirSync(L.media, { recursive: true });
  mkdirSync(L.logs, { recursive: true });
  const store = await treeDatabase(DB, { from: "floor", fresh: true });
  log(`store: database ${DB} on this tree's Postgres (port ${store.port}), from the migrated floor`);
  const windowId = (await crossingNow(town)) + 1;
  // the town's own public key at the source, read before the re-sign replaces it: prod's, never the sandbox's
  const townPub = git(town, "show", "HEAD:tools/stamp-pubkey.pem");
  const dev = await localDevTarget({ dir: L.live, store, boot: false, townSource: town, worldSource: world, windowId,
    log: (m) => log(`stand-in: ${m} (${ms(t0)})`) });
  await writeGraph(store, dev.world, L.live);
  log(`world graph snapshot written (${ms(t0)})`);
  const state = {
    built_at: new Date().toISOString(), office_head: git(OFFICE, "rev-parse", "HEAD"),
    sources: { town: { path: town, sha: git(town, "rev-parse", "HEAD") }, world: { path: world, sha: git(world, "rev-parse", "HEAD") } },
    town_pubkey: townPub, window: windowId, houses: [],
  };
  writeFileSync(L.state, JSON.stringify(state, null, 2));
  // the houses, through a booted office (fenced, guarded, as `up` boots it)
  const [officePort, ghPort] = await ports(null, null);
  const env = officeEnvFor(L, readEnv(L), { officePort, ghPort });
  writeEnvFile(L.officeEnv, env);
  log(await guardOrThrow(L, env, readRoles(L), store));
  const stub = await githubStubFor(env);
  const office = await bootOffice(L, env, officePort, { logFile: join(L.logs, "office.log") });
  try {
    state.houses = await seedHouses(L, store, env.PUBLIC_BASE, (m) => log(`seed: ${m}`));
    writeFileSync(L.state, JSON.stringify(state, null, 2));
    writeFileSync(L.run, JSON.stringify({ pid: process.pid, office: env.PUBLIC_BASE, gh: ghPort, seeding: true }, null, 2));
    const r = await crossNow(L, { log: (m) => log(`seed crossing 1: ${m}`) });
    if (!r.green) throw new Error(`the seed's first crossing was red: ${r.problems.join("; ")}`);
    await seedThings(env.PUBLIC_BASE, state.houses, (m) => log(`seed: ${m}`));
    const r2 = await crossNow(L, { ferry: false, log: (m) => log(`seed crossing 2: ${m}`) });
    if (!r2.green) throw new Error(`the seed's second crossing was red: ${r2.problems.join("; ")}`);
  } finally {
    await office.stop();
    await stub.close();
    rmSync(L.run, { force: true });
  }
  await snapshot(L, store);
  state.seed = { town: git(env.TOWN_CLONE, "rev-parse", "HEAD"), world: git(env.WORLD_CLONE, "rev-parse", "HEAD") };
  writeFileSync(L.state, JSON.stringify(state, null, 2));
  log(`seed built in ${ms(t0)}: town ${state.seed.town.slice(0, 9)}, world ${state.seed.world.slice(0, 9)}, database ${SEED_DB}`);
  return state;
}

async function githubStubFor(env) {
  const { githubStub } = await importFrom(join(OFFICE, "tools", "dev-rehearsal.mjs"));
  const [owner, repo] = String(env.POSTMARK_TOWN_REPO ?? "postmark-town/postmark").split("/");
  const stub = githubStub({ owner, repo, branch: env.POSTMARK_TOWN_BRANCH ?? "main", townClone: env.TOWN_CLONE });
  await stub.listen(Number(new URL(env.GITHUB_API_URL).port));
  return stub;
}

// ── the crossing, by hand ────────────────────────────────────────────────────

/**
 * A crossing now, through the dev rehearsal's own steps: `crossing` (the
 * ferry and the keep tick, job for job), `clearing` (the candle closes the
 * open window, the scheduled settlement waiting on it), `settle` and `bless`.
 * Then the world clone moves to the blessed commit and the store's law and
 * world graph are re-read from it, so the office and the viewer see the new
 * world. Answers `{ green, problems, notes }`.
 */
export async function crossNow(L, { ferry = true, settle = true, keep = false, log = say } = {}) {
  const run = readJson(L.run);
  if (!run || !alive(run.pid)) return { green: false, problems: ["the sandbox is not up: start it with `node tools/sandbox.mjs up`"], notes: [] };
  const { targetFromFiles, storeClients, crossingContext, plan, parseEnvFile } = await importFrom(join(OFFICE, "tools", "dev-rehearsal.mjs"));
  // the same guard `up` runs, on the env files the crossing's jobs are about to read
  const { treeDatabase } = await importFrom(join(OFFICE, "test", "helpers", "embedded-store.mjs"));
  try {
    log(await guardOrThrow(L, parseEnvFile(readFileSync(L.officeEnv, "utf8")), parseEnvFile(readFileSync(L.rolesEnv, "utf8")), await treeDatabase(DB)));
  } catch (e) { return { green: false, problems: [String(e.message)], notes: [] }; }
  // nothing in this process's own environment rides into a job
  for (const k of Object.keys(process.env)) if (!(k in cleanEnv())) delete process.env[k];
  Object.assign(process.env, pathWithSh(process.env), { GIT_ALLOW_PROTOCOL: "file" });
  const t = targetFromFiles({ envFile: L.officeEnv, rolesFile: L.rolesEnv, office: run.office, officeRoot: OFFICE, prodPubKey: join(L.live, "prod-stamp-key.pem") });
  const s = await storeClients(t);
  const scratch = mkdtempSync(join(tmpdir(), "sandbox-crossing-"));
  const problems = [];
  const notes = [];
  const steps = plan();
  const step = (id) => steps.find((x) => x.id === id);
  const tail = (out, n = 8) => String(out ?? "").trim().split("\n").slice(-n).join(" | ");
  try {
    const ctx = crossingContext({ t, s, db: DB, run: `sb${Date.now().toString(36)}`, scratch, log });
    if (ferry) {
      const t0 = Date.now();
      const done = await step("crossing").run(ctx);
      for (const [name, r, job] of done) {
        if (r.code === 0) continue;
        if (job?.nonFatal) notes.push(`${name} exited ${r.code} (the box runs it non-fatal): ${tail(r.out, 4)}`);
        else problems.push(`${name} exited ${r.code}: ${tail(r.out)}`);
      }
      log(`the ferry and the keep tick: ${done.map(([n, r]) => (r.code === 0 ? n : `${n}(${r.code})`)).join(" → ")} (${ms(t0)})`);
      if (problems.length) return { green: false, problems, notes };
    }
    if (settle) {
      const t0 = Date.now();
      const [win] = await s.q("office_api", "SELECT id FROM windows WHERE status = 'open' ORDER BY id DESC LIMIT 1");
      if (!win) return { green: false, problems: ["the store has no open window: the candle is out (reset the sandbox)"], notes };
      ctx.window = Number(win.id);
      const cleared = await step("clearing").run(ctx);
      if (cleared.code !== 0) problems.push(`the clearing of window ${ctx.window} exited ${cleared.code}: ${tail(cleared.out)}`);
      const settled = await ctx.settling;
      if (settled?.setup) problems.push(`the settlement could not start: ${settled.setup}`);
      else if (settled.code !== 0) problems.push(`the settlement exited ${settled.code}: ${tail(settled.out)}`);
      const receipt = readJson(settled?.report ?? "", null);
      if (receipt) notes.push(`the settlement: ${receipt.verdict ?? receipt.status ?? "done"}${receipt.summary ? `, ${typeof receipt.summary === "string" ? receipt.summary : JSON.stringify(receipt.summary).slice(0, 300)}` : ""}`);
      log(`the clearing (window ${ctx.window}) and the settlement (${ms(t0)})`);
      if (problems.length) return { green: false, problems, notes };
      const blessed = await step("bless").run(ctx);
      if (blessed.code !== 0) return { green: false, problems: [`the bless's settlements-backfill exited ${blessed.code}: ${tail(blessed.out)}`], notes };
      // the sandbox's world takes the blessed commit (its own clone; never pushed anywhere)
      git(t.worldClone, "merge", "-q", "--ff-only", `settlement/S${ctx.blessed}`);
      const { ingestLaw } = await importFrom(join(OFFICE, "test", "helpers", "dev-target.mjs"));
      const { treeDatabase } = await importFrom(join(OFFICE, "test", "helpers", "embedded-store.mjs"));
      const store = await treeDatabase(DB);
      await ingestLaw(store, t.worldClone);
      await writeGraph(store, t.worldClone, scratch);
      notes.push(`S${ctx.blessed} blessed over window ${ctx.window}: the world is at ${ctx.blessedSha.slice(0, 9)}, its law and graph re-read into the store`);
      log(`S${ctx.blessed} blessed; the world clone and the store's law and graph moved to it (${ms(t0)})`);
    }
    return { green: true, problems, notes };
  } finally {
    await s.end();
    if (keep) log(`kept: ${scratch}`);
    else { try { rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* litter in tmp */ } }
  }
}

// ── the commands ─────────────────────────────────────────────────────────────

function treeName() { return OFFICE.replace(/\\/g, "/").split("/").pop(); }

/**
 * The sandbox's folder: <temp>/postmark-sandbox-<tree>. Under the temp dir
 * because the dev freshen's re-sign touches only a clone there
 * (tools/dev-ledger-resign.mjs § cloneRefusal), and beside the tree rather than
 * in it, so a lane's git clean leaves it as pg.mjs leaves the database (no
 * reaper names this prefix).
 */
export const defaultDir = () => join(tmpdir(), `postmark-sandbox-${treeName()}`);

/**
 * Why a folder may not be the sandbox's, or null. `drop` deletes the folder
 * whole and `reset` runs git clean in its clones, so --dir is held to the one
 * shape the sandbox makes: a folder directly under the temp dir, named
 * postmark-sandbox-<something>.
 */
export function dirRefusal(dir, { temp = tmpdir() } = {}) {
  const d = normalize(resolve(dir));
  const parent = normalize(resolve(d, ".."));
  const name = d.slice(parent.length).replace(/^[\\/]+/, "");
  const same = (a, b) => (process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b);
  if (!same(parent, normalize(resolve(temp)))) return `--dir ${dir} is not directly under the temp dir (${temp}): the sandbox's folder lives there and nowhere else`;
  if (!/^postmark-sandbox-[A-Za-z0-9._-]+$/.test(name)) return `--dir ${dir} is not named postmark-sandbox-<name>: drop and reset act on the whole folder`;
  return null;
}

async function up(L, opts) {
  const { treeDatabaseExists, treeDatabase } = await importFrom(join(OFFICE, "test", "helpers", "embedded-store.mjs"));
  const run = readJson(L.run);
  if (run && alive(run.pid)) throw new Error(`the sandbox is already up (pid ${run.pid}): ${run.viewer ?? run.office}`);
  const hasSeed = existsSync(L.state) && readJson(L.state)?.seed && await treeDatabaseExists(SEED_DB) && existsSync(join(L.live, "postmark-office-dev.env"));
  if (!hasSeed || opts.fresh) {
    say(`sandbox: building the seed in ${L.dir} (about 8 minutes, once; \`reset\` returns to it in seconds)`);
    await buildSeed(L, { town: opts.town, world: opts.world, log: (m) => say(`  ${m}`) });
  } else if (!(await treeDatabaseExists(DB))) {
    await resetTo(L);
  }
  const store = await treeDatabase(DB);
  const [officePort, ghPort, viewerPort, spectatorPort] = await ports(opts.port, null, opts.viewerPort, null);
  const env = officeEnvFor(L, readEnv(L), { officePort, ghPort });
  writeEnvFile(L.officeEnv, env);
  say(await guardOrThrow(L, env, readRoles(L), store));
  const stub = await githubStubFor(env);
  const office = await bootOffice(L, env, officePort, { logFile: join(L.logs, "office.log") });
  const viewer = await bootViewer(L, { viewerPort, spectatorPort, officePort, env, logFile: join(L.logs, "viewer.log") });
  const viewerBase = `http://127.0.0.1:${viewerPort}`;
  writeFileSync(L.run, JSON.stringify({ pid: process.pid, children: [office.pid, viewer.pid], office: env.PUBLIC_BASE, viewer: viewerBase, gh: ghPort, started_at: new Date().toISOString() }, null, 2));
  const state = readJson(L.state);
  say("");
  say(`sandbox UP on ${treeName()} (database ${DB}, port ${store.port})`);
  say(`  office  ${env.PUBLIC_BASE}   (REST and MCP at /mcp; log ${join(L.logs, "office.log")})`);
  say(`  viewer  ${viewerBase}/`);
  say(`  town    ${env.TOWN_CLONE} @ ${git(env.TOWN_CLONE, "rev-parse", "--short", "HEAD")}`);
  say(`  world   ${env.WORLD_CLONE} @ ${git(env.WORLD_CLONE, "rev-parse", "--short", "HEAD")}`);
  say(`  houses  ${state.houses.map((h) => `${h.household} (${h.residents.join(", ")})`).join("; ")}`);
  say("");
  say("  try:    node tools/sandbox.mjs as sb-ash world '{\"read\":\"here\"}'");
  say("          node tools/sandbox.mjs cross");
  say("          node tools/sandbox.mjs look --at 200,-350");
  say("  Ctrl-C (or `node tools/sandbox.mjs down`) stops it; `reset` (while down) returns to the seed.");
  await new Promise((ok) => {
    const stop = () => ok();
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    office.child.once("exit", (code) => { say(`sandbox: the office exited (${code}); see ${join(L.logs, "office.log")}`); ok(); });
  });
  say("sandbox: stopping");
  await viewer.stop();
  await office.stop();
  await stub.close();
  rmSync(L.run, { force: true });
  return 0;
}

/** Back to the seed: the store from its template, the clones to their tag, the file databases and media from the seed. */
async function resetTo(L) {
  const run = readJson(L.run);
  if (run && alive(run.pid)) throw new Error(`the sandbox is up (pid ${run.pid}): stop it (Ctrl-C) before a reset`);
  const state = readJson(L.state);
  if (!state?.seed) throw new Error("there is no seed yet: `node tools/sandbox.mjs up` builds it");
  const { treeDatabase } = await importFrom(join(OFFICE, "test", "helpers", "embedded-store.mjs"));
  const t0 = Date.now();
  await treeDatabase(DB, { from: SEED_DB, fresh: true });
  const env = readEnv(L);
  for (const repo of [env.TOWN_CLONE, env.WORLD_CLONE]) {
    git(repo, "checkout", "-q", "-f", "-B", "main", SEED_TAG);
    git(repo, "clean", "-q", "-fdx");
    // settlement tags blessed in play go with the play
    for (const tag of git(repo, "tag", "-l", "settlement/S*").split("\n").filter(Boolean))
      if (gitQuiet(repo, "merge-base", "--is-ancestor", tag, SEED_TAG).status !== 0) git(repo, "tag", "-d", tag);
  }
  for (const f of ["oauth.db", "roles.db"]) if (existsSync(join(L.seedFiles, f))) copyFileSync(join(L.seedFiles, f), join(L.live, f));
  rmSync(L.media, { recursive: true, force: true });
  mkdirSync(L.media, { recursive: true });
  say(`sandbox: reset to the seed in ${ms(t0)} (database ${DB} from ${SEED_DB}; town ${state.seed.town.slice(0, 9)}, world ${state.seed.world.slice(0, 9)})`);
  return 0;
}

function keyFor(L, handle) {
  const state = readJson(L.state);
  const house = state?.houses?.find((h) => h.residents.includes(handle) || h.household === handle);
  if (!house) throw new Error(`no seeded resident ${handle}; the seeded ones are ${(state?.houses ?? []).flatMap((h) => h.residents).join(", ") || "none (build the seed with up)"}`);
  return house.key;
}

function upOrThrow(L) {
  const run = readJson(L.run);
  if (!run || !alive(run.pid)) throw new Error("the sandbox is not up: start it with `node tools/sandbox.mjs up` in another terminal");
  return run;
}

const parseArgs = (raw) => {
  if (raw == null || raw === "") return {};
  try { return JSON.parse(raw); } catch (e) { throw new Error(`the arguments are not JSON (${e.message}): ${raw.slice(0, 120)}`); }
};

async function status(L) {
  const state = readJson(L.state);
  const run = readJson(L.run);
  const { treeDatabaseExists } = await importFrom(join(OFFICE, "test", "helpers", "embedded-store.mjs"));
  say(`sandbox in ${L.dir} on ${treeName()}`);
  say(`  ${run && alive(run.pid) ? `UP (pid ${run.pid}): office ${run.office}, viewer ${run.viewer}` : "down"}`);
  if (!state?.seed) { say("  no seed yet (`up` builds it)"); return 0; }
  say(`  seed built ${state.built_at}: town ${state.seed.town.slice(0, 9)}, world ${state.seed.world.slice(0, 9)}; databases ${DB} ${await treeDatabaseExists(DB) ? "present" : "MISSING"}, ${SEED_DB} ${await treeDatabaseExists(SEED_DB) ? "present" : "MISSING"}`);
  say(`  houses: ${state.houses.map((h) => `${h.household} (${h.residents.join(", ")})`).join("; ")}`);
  const env = readEnv(L);
  say(`  now: town ${git(env.TOWN_CLONE, "rev-parse", "--short", "HEAD")}, world ${git(env.WORLD_CLONE, "rev-parse", "--short", "HEAD")}`);
  try {
    const { treeDatabase } = await importFrom(join(OFFICE, "test", "helpers", "embedded-store.mjs"));
    const store = await treeDatabase(DB);
    const c = await store.connect("office_api");
    try {
      const w = (await c.query("SELECT id, status, closes_at FROM windows ORDER BY id DESC LIMIT 2")).rows;
      const sN = (await c.query("SELECT max(number) AS n FROM settlements")).rows[0]?.n;
      say(`  windows: ${w.map((x) => `${x.id} ${x.status}`).join(", ")}; newest settlement S${sN ?? "?"}`);
    } finally { await c.end(); }
  } catch (e) { say(`  (the store could not be read: ${e.message})`); }
  return 0;
}

/** A process's command line, or "" when it cannot be read (then nothing is killed). */
function commandLineOf(pid) {
  try {
    if (process.platform === "linux") return readFileSync(`/proc/${pid}/cmdline`, "utf8").replace(/\0/g, " ");
    if (process.platform === "win32")
      return execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `(Get-CimInstance Win32_Process -Filter "ProcessId=${Number(pid)}").CommandLine`], { encoding: "utf8", windowsHide: true }).trim();
    return execFileSync("ps", ["-o", "command=", "-p", String(Number(pid))], { encoding: "utf8", windowsHide: true }).trim();
  } catch { return ""; }
}

/**
 * Whether a command line is one the sandbox started: the `up` process
 * (tools/sandbox.mjs up), or a child that names the sandbox's folder (the
 * office's --db, the spectator under the sandbox's world clone).
 */
export function namesTheSandbox(cmdline, dir) {
  const norm = (x) => String(x ?? "").replace(/\\/g, "/").toLowerCase();
  const c = norm(cmdline);
  if (!c) return false;
  return (/(^|[\s/"])tools\/sandbox\.mjs["\s]+up(\s|$)/.test(c) || /(^|[\s/"])sandbox\.mjs["\s]+up(\s|$)/.test(c)) || c.includes(norm(dir) + "/");
}

/** Stop a running sandbox: its office and viewer, then the `up` process. */
function down(L) {
  const run = readJson(L.run);
  if (!run || !alive(run.pid)) { rmSync(L.run, { force: true }); say("sandbox: already down"); return 0; }
  // a pid in run.json may have been reused since: kill only a process whose command line names the sandbox
  const spared = [];
  for (const pid of [...(run.children ?? []), run.pid]) {
    if (!pid || !alive(pid)) continue;
    if (!namesTheSandbox(commandLineOf(pid), L.dir)) { spared.push(pid); continue; }
    try { process.kill(pid); } catch { /* gone */ }
  }
  if (spared.length) say(`sandbox: left pid ${spared.join(", ")} alone: its command line is not the sandbox's (the pid was reused)`);
  // the office's instruments, which its own stop would have removed (src/loop-lag.mjs, store-txn-watch.mjs)
  const port = (() => { try { return new URL(run.office).port; } catch { return null; } })();
  if (port) for (const f of [`loop-lag-${port}.json`, `store-txn-${port}.json`]) rmSync(join(OFFICE, "telemetry", f), { force: true });
  rmSync(L.run, { force: true });
  say(`sandbox: stopped (pid ${run.pid})`);
  return 0;
}

async function drop(L) {
  const run = readJson(L.run);
  if (run && alive(run.pid)) throw new Error(`the sandbox is up (pid ${run.pid}): stop it first`);
  const READY = join(`${OFFICE}.pg`, "READY");
  const port = readJson(READY)?.port;
  if (port) {
    const su = await superuser(port);
    try {
      for (const db of [DB, SEED_DB]) {
        await su.query(`ALTER DATABASE ${db} IS_TEMPLATE false`).catch(() => {});
        await su.query(`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`);
      }
    } finally { await su.end(); }
  }
  rmSync(L.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  say(`sandbox: dropped (databases ${DB} and ${SEED_DB}, folder ${L.dir})`);
  return 0;
}

const USAGE = `usage: node tools/sandbox.mjs <command>
  up [--fresh] [--port N] [--viewer-port N] [--town <checkout>] [--world <checkout>]
  down                                       stops a running sandbox (as Ctrl-C does)
  cross [--ferry | --settle] [--keep]
  as <handle> <tool> ['<json args>']        one MCP tool call as a seeded resident
  call <handle> <METHOD> <path> ['<json>']   one REST call as a seeded resident
  look --at x,y [--crossing N] [--json]      the telling, from the sandbox's world
  status | reset | drop | mcp-config <handle>
  [--dir <folder>]  the sandbox's folder (default <temp>/postmark-sandbox-<tree>)
the guide: tools/SANDBOX.md`;

async function main(argv = process.argv.slice(2)) {
  const flag = (f) => { const i = argv.indexOf(f); if (i < 0) return null; const v = argv[i + 1]; argv.splice(i, 2); return v; };
  const has = (f) => { const i = argv.indexOf(f); if (i < 0) return false; argv.splice(i, 1); return true; };
  if (has("--help") || has("-h")) { say(USAGE); return 0; }
  // this process carries the fence too: the stub, the viewer's front server, the crossing's own reads
  process.env.SANDBOX_FENCE = "1";
  await import(pathToFileURL(FENCE).href);
  if (!argv.length) { say(USAGE); return 2; }
  const dir = resolve(flag("--dir") ?? defaultDir());
  const badDir = dirRefusal(dir);
  if (badDir) { say(`sandbox: ${badDir}`); return 2; }
  const L = layout(dir);
  const cmd = argv.shift();
  try {
    switch (cmd) {
      case "up": {
        const port = flag("--port"), viewerPort = flag("--viewer-port");
        return await up(L, {
          fresh: has("--fresh"),
          port: port ? Number(port) : 4590, viewerPort: viewerPort ? Number(viewerPort) : 4591,
          town: resolve(flag("--town") ?? join(OFFICE, "town-clone")), world: resolve(flag("--world") ?? join(OFFICE, "world-clone")),
        });
      }
      case "cross": {
        const onlyFerry = has("--ferry"), onlySettle = has("--settle");
        const r = await crossNow(L, { ferry: !onlySettle, settle: !onlyFerry, keep: has("--keep") });
        for (const n of r.notes) say(`  ${n}`);
        for (const p of r.problems) say(`  RED: ${p}`);
        say(r.green ? "sandbox: crossed" : "sandbox: the crossing was RED");
        return r.green ? 0 : 1;
      }
      case "reset": return await resetTo(L);
      case "down": return down(L);
      case "status": return await status(L);
      case "drop": return await drop(L);
      case "as": {
        const [handle, tool, raw] = argv;
        if (!handle || !tool) { say(USAGE); return 2; }
        const run = upOrThrow(L);
        const { callTool } = await importFrom(join(OFFICE, "tools", "read-eval", "office.mjs"));
        const args = parseArgs(raw);
        // a household key stands as every resident of its house: the world and household tools ask which
        if (["world", "household"].includes(tool) && args.handle === undefined) args.handle = handle;
        const r = await callTool(run.office, keyFor(L, handle), tool, args);
        say(typeof r.body === "string" ? r.body : JSON.stringify(r.body, null, 2));
        return r.isError || r.status >= 400 ? 1 : 0;
      }
      case "call": {
        const [handle, method, rawPath, raw] = argv;
        // Git bash rewrites a leading-slash argument into a Windows path (/letters → C:/Program Files/Git/letters)
        const msys = /^[A-Za-z]:[\\/].*?[\\/]Git[\\/](.*)$/.exec(rawPath ?? "");
        const path = msys ? `/${msys[1].replace(/\\/g, "/")}` : rawPath;
        if (!handle || !method || !path) { say(USAGE); return 2; }
        const run = upOrThrow(L);
        const r = await rest(run.office, method.toUpperCase(), path, { key: keyFor(L, handle), body: raw ? parseArgs(raw) : undefined });
        say(`${r.status}`);
        say(JSON.stringify(r.body, null, 2));
        return r.status >= 400 ? 1 : 0;
      }
      case "look": {
        const env = readEnv(L);
        const args = [join(env.WORLD_CLONE, "tools", "world-poc.mjs"), ...argv];
        const crossing = flag("--crossing");
        if (!crossing) args.push("--crossing", String(await crossingNow(env.TOWN_CLONE)));
        const r = spawnSync(process.execPath, args, { cwd: env.WORLD_CLONE, stdio: "inherit", windowsHide: true, env: { ...cleanEnv(), SANDBOX_FENCE: "1", NODE_OPTIONS: `--import=${pathToFileURL(FENCE).href}` } });
        return r.status ?? 1;
      }
      case "mcp-config": {
        const [handle] = argv;
        if (!handle) { say(USAGE); return 2; }
        const run = readJson(L.run);
        const base = run?.office ?? "http://127.0.0.1:4590";
        say(JSON.stringify({ mcpServers: { [`postmark-sandbox-${handle}`]: { type: "http", url: `${base}/mcp`, headers: { Authorization: `Bearer ${keyFor(L, handle)}` } } } }, null, 2));
        return 0;
      }
      default: say(USAGE); return 2;
    }
  } catch (e) {
    say(e?.refusal ? String(e.message) : `sandbox: ${String(e?.stack ?? e?.message ?? e)}`);
    return 2;
  }
}

const isMain = (() => {
  if (!process.argv[1]) return false;
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return false; }
})();
if (isMain) main().then((code) => process.exit(code), (e) => { console.error(String(e?.stack ?? e)); process.exit(2); });
