#!/usr/bin/env node
// dev-rehearsal.mjs — one crossing, end to end, through the dev office's doors,
// every step asserted against the dev office's STORE (POS-354).
//
// ── WHY ─────────────────────────────────────────────────────────────────────
//
// Darko, 2026-10-04: "we have an entire dev environment. I don't think we're
// really using it to its full potential when we're shipping things." The 10-03
// failures (a household minting as two, file-only binds blocking the clearing,
// the by-hand settlement dead since the cutover) were each found by a resident
// or a meep, never by a test. This script rehearses a crossing on dev before
// every tag, so the next one is found here.
//
// ── WHAT IT RUNS ────────────────────────────────────────────────────────────
//
//   node tools/dev-rehearsal.mjs [--env-file /etc/postmark-office-dev.env]
//                                [--roles-file /etc/postmark-dev-rehearsal.env]
//                                [--office http://127.0.0.1:4381] [--user meepo]
//                                [--only <step,…>] [--keep] [--json] [--report <file>]
//
// On the box, from the dev office's own tree, so the tools it runs are the ones
// the dev office was carried with:
//
//   cd /srv/postmark-office-dev && sudo node tools/dev-rehearsal.mjs --user meepo
//
// Root reads the two files (both 0600) and the process then becomes meepo
// before anything runs: root-owned files in the dev clones stop the nightly
// freshen. The roles file holds the two pens the crossing's jobs write with,
// both naming the dev office's database (the guard refuses anything else):
//
//   WORLD2_INGEST_URL=postgres://law_ingester:…@localhost:5432/<the dev db>
//   WORLD2_CLEARING_URL=postgres://clearing_job:…@localhost:5432/<the dev db>
//
// THE STEPS, in the crossing's order (`plan()` below is the list):
//
//   guard       the target is the dev office's store and is not world2_dev
//   preflight   the office answers; the store holds every table this tree's
//               migrations create; the office's flags read the store as prod's
//               do; its pens sign with its own key; nothing it can reach pushes
//               (TOWN_PUSH=0, GitHub stubbed)
//   sign-in     the one seam that is not a door: a household key minted for a
//               synthetic GitHub account, through the office's own key desk
//               function, into the store's paperwork (on prod it is GitHub's
//               OAuth dance, which a script cannot do)
//   join        POST /households declares the rehearsal's house
//   resident    POST /household add-resident: a house adding its own is bound at
//               admission (POS-297); where the door opens a join PR instead (a
//               frozen gangway), the PR lands on this script's stub GitHub, its
//               merge on the dev town clone, and the keeping tick's settle-pass binds it
//   letters     POST /letters both ways; they wait in the store's town log
//   crossing    the ferry's chain on the dev town clone under the town lock
//               (drain, deliver, mint, verify, ballot, welcome), never pushed;
//               then the town-index ingest. The house must mint as ONE.
//   claim       a parcel through POST /world/marks, put forward (stamps: 0)
//   clearing    the candle closes the window as clearing_job, while the
//               scheduled settlement waits for it (the box fires both at once)
//   settle      settlement-auto.sh from the store, into a bare copy of the world
//   bless       an annotated settlement tag on the copy, then settlements-backfill
//   recovery    the clearing re-run refuses and moves nothing; a second claim
//               settled BY HAND; POS-356's refused claim is PENDING until it lands
//
// Every step's checks read the store: the store is the record (RULED 10-04), and
// the 10-03 failures were each a file that disagreed with it. The one record the
// store does not yet hold is the mint (POS-341), so the crossing compares the
// store's balances against the town's ledger and counts the ledger's welcomes.
// A FINDING is a defect measured and named on every run that does not gate (a
// ruling or another lane's fix is owed).
//
// ── WHAT IT NEVER DOES ──────────────────────────────────────────────────────
//
//   · connect to world2_dev (PROD's store; the name lies, POS-243), or to any
//     database but the one the dev office's env file names. The first line of
//     output says which database it will write and why;
//   · push or open anything on GitHub: TOWN_PUSH=0 is required of the dev
//     office, the pen's GitHub calls go to this script's stub (GITHUB_API_URL
//     in the dev env names it), and the settlement crosses into a bare copy of
//     the world in the scratch directory;
//   · touch prod's tree, clones, env or units.
//
// What it leaves on dev: the rehearsal's households, letters and claims in the
// dev store (named rh-<run>-…), local commits on the dev town clone (the nightly
// freshen resets it to sandbox/seed), and one cleared window. Dev is the
// sandbox; that is its job.
//
// Exit 0 green · 1 red (the step and the check that failed are named) · 2 the
// rehearsal could not start (a refusal before any write, named).
//
// Node 22+. Prints no secrets: credentials are read into memory, handed to the
// children that need them, and never printed.

import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { publicOf } from "./dev-ledger-resign.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
export const OFFICE = resolve(HERE, "..");
const importFrom = (path) => import(pathToFileURL(path).href);

/** PROD's store. The name is historical; every lane must refuse it (AGENTS.md, POS-243). */
export const PROD_DB = "world2_dev";
export const DEFAULT_ENV_FILE = "/etc/postmark-office-dev.env";
export const DEFAULT_ROLES_FILE = "/etc/postmark-dev-rehearsal.env";
export const DEFAULT_OFFICE = "http://127.0.0.1:4381";
/** PROD's signing key, where every office pen defaults to (src/ledger-pen.mjs). Dev's must not be it. */
export const PROD_STAMP_KEY = "/srv/postmark-office/stamp-key.pem";

// ── the env files ────────────────────────────────────────────────────────────

/** KEY=value lines (systemd EnvironmentFile shape), quotes stripped. Never printed. */
export function parseEnvFile(text) {
  const out = {};
  for (const line of String(text).split(/\r?\n/)) {
    if (!line.trim() || /^\s*#/.test(line)) continue;
    const i = line.indexOf("=");
    if (i < 1) continue;
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^(["'])(.*)\1$/, "$2");
  }
  return out;
}

/** The database a postgres URL names, or null. */
export function databaseOf(url) {
  try { return decodeURIComponent(new URL(url).pathname.replace(/^\//, "")) || null; } catch { return null; }
}

/** The role a postgres URL connects as, or null. */
export const roleOf = (url) => { try { return decodeURIComponent(new URL(url).username) || null; } catch { return null; } };

// ── THE GUARD ────────────────────────────────────────────────────────────────
//
// The rehearsal writes a store. The only store it may write is the one the dev
// office itself is configured with, and that store must not be PROD's. Both
// are decided from the dev office's own env file before anything connects; the
// connection then asks Postgres which database it reached (a second instrument:
// a URL can name one database and a pooler route to another).

/**
 * Judge the URLs the rehearsal will connect with against the dev office's
 * configured store. Answers `{ ok, db, line, problems }`; `line` is the first
 * line of output either way.
 */
export function storeGuard({ configuredUrl, urls, source }) {
  const problems = [];
  const db = configuredUrl ? databaseOf(configuredUrl) : null;
  if (!configuredUrl) problems.push(`${source} names no WORLD2_PG_URL: the dev office has no store configured, so there is nothing to rehearse against`);
  else if (!db) problems.push(`${source}'s WORLD2_PG_URL names no database`);
  if (db === PROD_DB) problems.push(`${source} names ${PROD_DB}, which is PROD's store: the dev office is pointed at prod, and that is Wright's to hear at once`);
  for (const [name, url] of Object.entries(urls)) {
    if (!url) { problems.push(`no URL for ${name}`); continue; }
    const d = databaseOf(url);
    if (d === PROD_DB) problems.push(`${name} names ${PROD_DB}, PROD's store`);
    else if (db && d !== db) problems.push(`${name} names the database ${d ?? "(none)"}, not the dev office's ${db}`);
  }
  const ok = problems.length === 0;
  const line = ok
    ? `dev-rehearsal: target store ${db} (the dev office's, from ${source}); not ${PROD_DB}`
    : `dev-rehearsal: REFUSED, the target store is not the dev office's own: ${problems[0]}`;
  return { ok, db, line, problems };
}

// ── small helpers ────────────────────────────────────────────────────────────

const git = (repo, ...args) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 }).trim();
const gitQuiet = (repo, ...args) => spawnSync("git", ["-C", repo, ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const tail = (s, n = 4) => String(s ?? "").trim().split("\n").filter(Boolean).slice(-n).join(" | ");

/** One door call. Answers `{ status, body }`; a refusal is an answer, not a throw. */
async function door(target, method, path, { key = null, body = undefined } = {}) {
  const res = await fetch(new URL(path.replace(/^\//, ""), target.office.replace(/\/?$/, "/")), {
    method,
    headers: { ...(key ? { authorization: `Bearer ${key}` } : {}), ...(body !== undefined ? { "content-type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = { text: text.slice(0, 400) }; }
  return { status: res.status, body: parsed };
}

/** A door's answer, named for a problem line. */
const said = (r) => `${r.status} ${r.body?.defect ?? r.body?.error?.defect ?? ""}${r.body?.hint ? ` (${String(r.body.hint).slice(0, 160)})` : ""}`.trim();

// ── the GitHub stub ──────────────────────────────────────────────────────────
//
// The pen's join road (request_residency) opens a PR on the town repo through
// the GitHub API, and the keeping tick's settle-pass lists merged PRs from it.
// On dev both would reach the REAL town repo: the dev env carries the pen's
// token. So the dev office's GITHUB_API_URL names this stub, which answers the
// calls those two roads make, records the PR's file set, and reports it merged
// once the script lands it on the dev town clone. With no rehearsal running the
// stub is down and those roads fail closed (connection refused), which is the
// right answer for dev.

export function githubStub({ owner, repo, branch = "main", townClone }) {
  const prs = [];
  const trees = new Map();   // sha -> { base_tree, tree: [{ path, content }] }
  const commits = new Map(); // sha -> { tree, parents, message }
  const refs = new Map();    // "heads/x" -> sha
  let seq = 0;
  const sha = (tag) => (tag + "0".repeat(40)).slice(0, 2) + (++seq).toString(16).padStart(38, "0");
  const base = `/repos/${owner}/${repo}`;
  const readBody = (req) => new Promise((ok) => { let s = ""; req.on("data", (d) => { s += d; }); req.on("end", () => ok(s ? JSON.parse(s) : {})); });

  const server = createServer(async (req, res) => {
    res.setHeader("connection", "close");
    const url = new URL(req.url, "http://stub");
    const p = url.pathname;
    const json = (code, obj) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };
    try {
      if (!p.startsWith(base)) return json(404, { message: "the rehearsal's stub answers only the town repo" });
      const rest = p.slice(base.length);
      if (req.method === "GET" && rest === `/git/ref/heads/${branch}`) return json(200, { object: { sha: git(townClone, "rev-parse", "HEAD") } });
      if (req.method === "GET" && rest.startsWith("/git/commits/")) {
        const c = commits.get(rest.slice(13));
        return json(200, { sha: rest.slice(13), tree: { sha: c?.tree ?? git(townClone, "rev-parse", `${rest.slice(13)}^{tree}`) } });
      }
      if (req.method === "POST" && rest === "/git/trees") { const b = await readBody(req); const s = sha("t"); trees.set(s, b); return json(201, { sha: s }); }
      if (req.method === "POST" && rest === "/git/commits") { const b = await readBody(req); const s = sha("c"); commits.set(s, b); return json(201, { sha: s }); }
      if (req.method === "POST" && rest === "/git/refs") { const b = await readBody(req); refs.set(b.ref.replace(/^refs\//, ""), b.sha); return json(201, { ref: b.ref, object: { sha: b.sha } }); }
      if (req.method === "POST" && rest === "/pulls") {
        const b = await readBody(req);
        const number = 900000 + prs.length + 1;
        const head = b.head.includes(":") ? b.head.split(":").pop() : b.head;
        prs.push({ number, title: b.title, body: b.body, head: { ref: head, sha: refs.get(`heads/${head}`) ?? null, label: `${owner}:${head}` },
          base: { ref: b.base ?? branch }, state: "open", merged_at: null, html_url: `https://stub.invalid/pull/${number}`, user: { login: "postmark-pen" } });
        return json(201, prs.at(-1));
      }
      if (req.method === "GET" && rest === "/pulls") {
        const state = url.searchParams.get("state") ?? "open";
        const head = url.searchParams.get("head");
        let list = prs.filter((x) => state === "all" || x.state === state);
        if (head) list = list.filter((x) => x.head.label === head || x.head.ref === head.split(":").pop());
        return json(200, url.searchParams.get("page") && url.searchParams.get("page") !== "1" ? [] : list);
      }
      if (req.method === "GET" && /^\/pulls\/\d+$/.test(rest)) {
        const pr = prs.find((x) => x.number === Number(rest.slice(7)));
        return pr ? json(200, pr) : json(404, {});
      }
      if (req.method === "GET" && rest.startsWith("/contents/")) {
        const rel = decodeURIComponent(rest.slice(10));
        const r = gitQuiet(townClone, "show", `HEAD:${rel}`);
        return r.status === 0 ? json(200, { path: rel, encoding: "base64", content: Buffer.from(r.stdout, "utf8").toString("base64") }) : json(404, { message: "Not Found" });
      }
      return json(404, { message: `the rehearsal's stub does not answer ${req.method} ${rest}` });
    } catch (e) { return json(500, { message: String(e?.message ?? e) }); }
  });

  return {
    server, prs,
    /** The file set a PR's head commit carries (the tree entries the pen posted). */
    filesOf(pr) {
      const c = commits.get(pr.head.sha);
      const t = c ? trees.get(c.tree) : null;
      return (t?.tree ?? []).filter((e) => typeof e.content === "string").map((e) => ({ path: e.path, content: e.content }));
    },
    /** Mark a PR merged now (its files already landed on the town clone). */
    merged(pr) { pr.state = "closed"; pr.merged_at = new Date().toISOString(); pr.merge_commit_sha = git(townClone, "rev-parse", "HEAD"); },
    listen(port) { return new Promise((ok, no) => { server.once("error", no); server.listen(port, "127.0.0.1", () => ok(server.address().port)); }); },
    close() { return new Promise((ok) => server.close(() => ok())); },
  };
}

// ── the target ───────────────────────────────────────────────────────────────

/**
 * The rehearsal's target from the dev office's env file and the roles file.
 * Reads files only; connects to nothing. `office` is the dev office's base URL.
 */
export function targetFromFiles({ envFile = DEFAULT_ENV_FILE, rolesFile = DEFAULT_ROLES_FILE, office = DEFAULT_OFFICE, officeRoot = OFFICE, prodStampKey = PROD_STAMP_KEY } = {}) {
  const env = parseEnvFile(readFileSync(envFile, "utf8"));
  const roles = existsSync(rolesFile) ? parseEnvFile(readFileSync(rolesFile, "utf8")) : {};
  return {
    source: envFile,
    rolesSource: existsSync(rolesFile) ? rolesFile : null,
    office,
    officeRoot,
    env,
    urls: {
      office_api: env.WORLD2_PG_URL ?? null,
      law_ingester: roles.WORLD2_INGEST_URL ?? null,
      clearing_job: roles.WORLD2_CLEARING_URL ?? null,
    },
    townClone: env.TOWN_CLONE ?? null,
    worldClone: env.WORLD_CLONE ?? null,
    // the key the office's own pens sign with (src/ledger-pen.mjs § DRAIN_KEY_PATH, the same default)
    stampKey: env.STAMP_KEY ?? PROD_STAMP_KEY,
    // prod's, read only to prove dev's is not it
    prodStampKey,
  };
}

/** The env a child job runs with: the dev office's own, the store's pens named, nothing that pushes. */
function childEnv(t, extra = {}) {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (/^(PG[A-Z]*|WORLD2_[A-Z_]*URL|TOWN_CLONE|WORLD_CLONE|TOWN_PUSH|GITHUB_API_URL)$/.test(k)) delete env[k];
  return { ...env, ...t.env, TOWN_PUSH: "0", ...extra };
}

/** PG* for a child that reads them (the town-index ingest, the stamp ingest). */
function pgEnv(url) {
  const u = new URL(url);
  return { PGHOST: u.hostname, PGPORT: u.port || "5432", PGUSER: decodeURIComponent(u.username), PGPASSWORD: decodeURIComponent(u.password), PGDATABASE: decodeURIComponent(u.pathname.slice(1)) };
}

// ── the store ────────────────────────────────────────────────────────────────

async function storeClients(t) {
  const { default: pg } = await import("pg");
  const clients = new Map();
  const client = async (role) => {
    if (!clients.has(role)) {
      const url = t.urls[role];
      if (!url) throw new Error(`no URL for the ${role} pen`);
      const c = new pg.Client({ connectionString: url, application_name: "dev-rehearsal" });
      await c.connect();
      clients.set(role, c);
    }
    return clients.get(role);
  };
  return {
    client,
    q: async (role, text, params = []) => (await (await client(role)).query(text, params)).rows,
    end: async () => { for (const c of clients.values()) await c.end().catch(() => {}); clients.clear(); },
    pg,
  };
}

/** Every table this tree's migrations create (CREATE TABLE / VIEW names). */
export function treeTables(officeRoot = OFFICE) {
  const dir = join(officeRoot, "world2", "schema");
  const names = new Set();
  for (const f of readdirSync(dir).filter((n) => /^\d+.*\.sql$/.test(n) && !n.startsWith("003_")).sort()) {
    const sql = readFileSync(join(dir, f), "utf8").replace(/--[^\n]*/g, "");
    for (const m of sql.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?(?:TABLE|VIEW)\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?([a-z_][a-z0-9_]*)/gi)) names.add(m[1].toLowerCase());
    for (const m of sql.matchAll(/DROP\s+(?:TABLE|VIEW)\s+(?:IF\s+EXISTS\s+)?(?:public\.)?([a-z_][a-z0-9_]*)/gi)) names.delete(m[1].toLowerCase());
  }
  return names;
}

// ── the crossing, as the box runs it ─────────────────────────────────────────
//
// A REHEARSAL MUST RUN THE PATH THE BOX RUNS. The first version of this step
// (10-07) ran the town's own mint and ballot pass; by 10-09 the box's ferry had
// moved to the store's mint behind STAMP_LINES (POS-341) and the office's
// ballot pass (POS-349), so it rehearsed a chain prod no longer runs. This list
// is postmark-ferry.service's ExecStart, job for job, then the keep tick's mint
// block (deploy/office-keep.sh), with dev's clone, dev's key and nothing pushed.
// test/dev-rehearsal.test.mjs reads both box files and holds this list to them,
// so a job added to the box's crossing reds the rehearsal's own test until it is
// added here.
//
// Each job: `name`; `box`, the path the box's file names (office-relative, or
// `town:` for the town clone's); `when` ("store" or "git": one side of the
// STAMP_LINES switch); `phase` ("ferry" or "keep"); `run(ctx)`; `commit`, the
// message the box commits what the job wrote with; `nonFatal`, where the box
// carries on past a refusal (`|| echo`).

const officeJob = (ctx, rel, args, opts) => ctx.locked([process.execPath, join(ctx.t.officeRoot, rel), ...args], opts);
const townJob = (ctx, rel, args) => ctx.locked([process.execPath, join(ctx.t.townClone, rel), ...args], { cwd: ctx.t.townClone });

export const CROSSING = [
  { phase: "ferry", name: "drain", box: "tools/town-drain-run.mjs",
    run: (ctx) => officeJob(ctx, "tools/town-drain-run.mjs", ["--clone", ctx.t.townClone, "--date", ctx.today, ...(ctx.useFlock ? [] : ["--unlocked"])]),
    commit: (ctx) => `town-log: crossing ${ctx.today} (dev rehearsal ${ctx.run})` },
  { phase: "ferry", name: "ferry", box: "town:tools/ferry.mjs",
    run: (ctx) => townJob(ctx, "tools/ferry.mjs", ["--no-git", "--date", ctx.today]),
    commit: (ctx) => `ferry: crossing ${ctx.today} (dev rehearsal ${ctx.run})` },
  { phase: "ferry", name: "index-before-mint", box: "deploy/town-index-ingest.sh", when: "store", nonFatal: true,
    run: (ctx) => ctx.ingest("world2/tools/town-index-ingest.mjs", ["--town-repo", ctx.t.townClone, "--sha", git(ctx.t.townClone, "rev-parse", "HEAD")]) },
  { phase: "ferry", name: "mint", box: "world2/tools/stamp-mint-run.mjs", when: "store",
    run: (ctx) => officeJob(ctx, "world2/tools/stamp-mint-run.mjs", ["--append", "--key", ctx.stampKey, "--clone", ctx.t.townClone]) },
  { phase: "ferry", name: "mint", box: "town:tools/stamp-mint.mjs", when: "git",
    run: (ctx) => townJob(ctx, "tools/stamp-mint.mjs", ["--append", "--key", ctx.stampKey]) }, // committed after the verify, as the box does
  { phase: "ferry", name: "verify", box: "town:tools/stamp-verify.mjs",
    run: (ctx) => townJob(ctx, "tools/stamp-verify.mjs", []), commit: "mint: crossing pass" },
  { phase: "ferry", name: "ballot", box: "tools/ballot-pass-run.mjs",
    run: (ctx) => officeJob(ctx, "tools/ballot-pass-run.mjs", ["--key", ctx.stampKey]) },
  { phase: "ferry", name: "verify-ballot", box: "town:tools/stamp-verify.mjs",
    run: (ctx) => townJob(ctx, "tools/stamp-verify.mjs", []), commit: "ballot: crossing pass" },
  { phase: "ferry", name: "lines-sync", box: "world2/tools/stamp-lines.mjs", when: "store",
    run: (ctx) => officeJob(ctx, "world2/tools/stamp-lines.mjs", ["--sync", "--clone", ctx.t.townClone]) },
  { phase: "ferry", name: "quests", box: "world2/tools/quest-snapshot-run.mjs", when: "store",
    run: (ctx) => officeJob(ctx, "world2/tools/quest-snapshot-run.mjs", ["--clone", ctx.t.townClone]), commit: "quests: crossing leaderboard" },
  { phase: "ferry", name: "quests", box: "town:tools/quest-progress.mjs", when: "git",
    run: (ctx) => townJob(ctx, "tools/quest-progress.mjs", ["--snapshot"]), commit: "quests: crossing leaderboard" },
  { phase: "ferry", name: "seal", box: "town:PROJECTS/the-town-seal/seal.mjs",
    run: (ctx) => townJob(ctx, "PROJECTS/the-town-seal/seal.mjs", []) },
  { phase: "ferry", name: "seal-verify", box: "town:PROJECTS/the-town-seal/verify.mjs",
    run: (ctx) => townJob(ctx, "PROJECTS/the-town-seal/verify.mjs", []), commit: "seal: re-seal at the crossing" },
  // the keep tick under its lock: the store's registry for the town's tools (deploy/registry-file.mjs, never
  // the printouts), the binds, the two store-to-file drains, then the mint block
  { phase: "keep", name: "registry-file", box: "deploy/registry-file.mjs",
    run: (ctx) => officeJob(ctx, "deploy/registry-file.mjs", [ctx.registryFile]) },
  { phase: "keep", name: "settle-pass", box: "deploy/settle-pass.mjs", nonFatal: true,
    run: (ctx) => {
      const cursor = join(ctx.scratch, "tick-settle.cursor");
      if (!existsSync(cursor)) writeFileSync(cursor, new Date(Date.now() - 3600_000).toISOString() + "\n");
      return officeJob(ctx, "deploy/settle-pass.mjs", ["--town", ctx.t.townClone, "--cursor", cursor]);
    } },
  { phase: "keep", name: "standing-drain", box: "tools/standing-drain.mjs", nonFatal: true,
    run: (ctx) => officeJob(ctx, "tools/standing-drain.mjs", ["--apply", "--clone", ctx.t.townClone]) },
  { phase: "keep", name: "gangway-drain", box: "tools/gangway-drain.mjs", nonFatal: true,
    run: (ctx) => officeJob(ctx, "tools/gangway-drain.mjs", ["--apply", "--clone", ctx.t.townClone]) },
  // the arrival check: the box skips the mint on a red arrival; here a red ledger is red
  { phase: "keep", name: "arrival-verify", box: "town:tools/stamp-verify.mjs",
    run: (ctx) => townJob(ctx, "tools/stamp-verify.mjs", ["--registry", ctx.registryFile]) },
  { phase: "keep", name: "tick-mint", box: "world2/tools/stamp-mint-run.mjs", when: "store",
    run: (ctx) => officeJob(ctx, "world2/tools/stamp-mint-run.mjs", ["--append", "--key", ctx.stampKey, "--clone", ctx.t.townClone, "--message", "mint: tick catch-up pass"]) },
  { phase: "keep", name: "tick-mint", box: "town:tools/stamp-mint.mjs", when: "git",
    run: (ctx) => townJob(ctx, "tools/stamp-mint.mjs", ["--append", "--key", ctx.stampKey]) },
  { phase: "keep", name: "welcome", box: "deploy/welcome-pass.mjs", nonFatal: true,
    run: (ctx) => officeJob(ctx, "deploy/welcome-pass.mjs", ["--town", ctx.t.townClone, "--key", ctx.stampKey, "--date", ctx.today]) },
  { phase: "keep", name: "bug-stages", box: "tools/bug-stage-plan.mjs", nonFatal: true,
    run: (ctx) => officeJob(ctx, "tools/bug-stage-plan.mjs", ["--town", ctx.t.townClone, "--apply", "--quiet", "--key", ctx.stampKey]) },
  { phase: "keep", name: "ballots-in", box: "tools/ballots-backfill.mjs", nonFatal: true,
    run: (ctx) => officeJob(ctx, "tools/ballots-backfill.mjs", ["--town", ctx.t.townClone, "--hand", "keemin", "--apply", "--quiet"]) },
  { phase: "keep", name: "tick-verify", box: "town:tools/stamp-verify.mjs",
    run: (ctx) => townJob(ctx, "tools/stamp-verify.mjs", ["--registry", ctx.registryFile]), commit: "mint: tick pass (welcome, bug stages)" },
  { phase: "keep", name: "tick-lines-sync", box: "world2/tools/stamp-lines.mjs", when: "store",
    run: (ctx) => officeJob(ctx, "world2/tools/stamp-lines.mjs", ["--sync", "--clone", ctx.t.townClone]) },
];

// ── the plan ─────────────────────────────────────────────────────────────────
//
// Each step: `id`, `title`, `run(ctx)` (the act, through a door or the job the
// box runs) and `check(ctx, result)` (problems, read from the store). A step
// marked `pending` names what it waits for and is reported, never run.

export function plan() {
  return [
    {
      id: "preflight",
      title: "the office answers; the store holds this tree's tables; the flags read the store as prod's do; nothing pushes",
      async run(ctx) {
        const r = await door(ctx.t, "GET", "/release");
        ctx.release = r.body;
        return r;
      },
      async check(ctx, r) {
        const p = [];
        if (r.status !== 200) p.push(`GET /release answered ${said(r)}`);
        const have = new Set((await ctx.s.q("office_api", "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'")).map((x) => x.table_name));
        const missing = [...treeTables(ctx.t.officeRoot)].filter((n) => !have.has(n)).sort();
        if (missing.length) p.push(`the store lags this tree's migrations: ${missing.join(", ")} missing (apply them to ${ctx.db} first)`);
        const e = ctx.t.env;
        // The flags prod reads the store with (/etc/postmark-office.env, measured 2026-10-07), and
        // STAMP_LINES=store, which the w42 ship sets on prod (POS-341): the rehearsal runs the next tag's path.
        for (const [k, v] of [["TOWN_INDEX_READS", "store"], ["OFFICE_PAPERWORK_STORE", "1"], ["STATE_LOG_SOURCE", "store"], ["WORLD2_PG", "1"], ["TOWN_SINGLE_LOG", "1"], ["WORLD_SINGLE_LOG", "1"], ["STAMP_LINES", "store"]])
          if (e[k] !== v) p.push(`the dev office runs without ${k}=${v} (prod has it${k === "STAMP_LINES" ? " from the w42 ship" : ""}): a rehearsal on dev would not run the path the box runs`);
        p.push(...(await keyProblems(ctx)));
        if (e.TOWN_PUSH !== "0") p.push(`the dev office's TOWN_PUSH is ${e.TOWN_PUSH ?? "unset"}, not 0: its pen could push the real town`);
        if (!ctx.stubPort) p.push(`the dev office's GITHUB_API_URL (${e.GITHUB_API_URL ?? "unset"}) is not a loopback address this script can stub: the join road would open a real PR on ${e.POSTMARK_TOWN_REPO ?? "the town repo"}`);
        if (!ctx.t.townClone || !existsSync(join(ctx.t.townClone, ".git"))) p.push(`no town clone at ${ctx.t.townClone}`);
        else {
          // The store's town index must sit on the clone's history: the crossing's ingest is a delta from
          // its head. The nightly freshen resets the clone to sandbox/seed and leaves the store where it was.
          const [h] = await ctx.s.q("office_api", "SELECT sha FROM projection_heads WHERE repo = 'town-index'");
          const head = git(ctx.t.townClone, "rev-parse", "HEAD");
          if (!h) p.push("the store has no town-index head: seed it from the dev town clone first (town-index-ingest.mjs --seed)");
          else if (gitQuiet(ctx.t.townClone, "merge-base", "--is-ancestor", h.sha, head).status !== 0)
            p.push(`the store's town index is at ${h.sha.slice(0, 9)}, which is not on the dev town clone's history (HEAD ${head.slice(0, 9)}): reseed it at HEAD (node world2/tools/town-index-ingest.mjs --town-repo ${ctx.t.townClone} --sha ${head} --seed, as law_ingester)`);
        }
        return p;
      },
    },
    {
      id: "sign-in",
      title: "a household key for a synthetic GitHub account, through the office's own key desk function (the one seam that is not a door)",
      async run(ctx) {
        const { mintHouseholdKey } = await importFrom(join(ctx.t.officeRoot, "src", "oauth.mjs"));
        const { paperOnPool, paperworkPoolTypes } = await importFrom(join(ctx.t.officeRoot, "src", "paperwork.mjs"));
        const pool = new ctx.s.pg.Pool({ connectionString: ctx.t.urls.office_api, max: 1, types: paperworkPoolTypes(ctx.s.pg) });
        try { ctx.key = await mintHouseholdKey(paperOnPool(pool), ctx.who.ghId, ctx.who.login); }
        finally { await pool.end(); }
        return door(ctx.t, "GET", "/me", { key: ctx.key });
      },
      async check(ctx, me) {
        const p = [];
        const rows = await ctx.s.q("office_api", "SELECT kind FROM oauth_tokens WHERE gh_id = $1", [ctx.who.ghId]);
        if (rows.length !== 1) p.push(`the store holds ${rows.length} tokens for the rehearsal account, not 1`);
        if (me.status !== 200 || me.body?.visitor !== true) p.push(`GET /me with the new key answered ${said(me)} ${JSON.stringify(me.body).slice(0, 200)}, not a visitor pass`);
        return p;
      },
    },
    {
      id: "join",
      title: "POST /households declares the rehearsal's house",
      async run(ctx) {
        return door(ctx.t, "POST", "/households", { key: ctx.key, body: {
          handle: ctx.who.a, household: ctx.who.house,
          card: `${ctx.who.a} is a dev rehearsal resident (POS-354, run ${ctx.run}). Nobody lives here; the next freshen forgets it.`,
        } });
      },
      async check(ctx, r, rec) {
        const p = [];
        if (r.status !== 201) return [`POST /households answered ${said(r)}`];
        rec.notes.push(`the door says: tier ${r.body?.household?.tier ?? "?"}, settled ${r.body?.household?.settled}, member of ${r.body?.household?.member_of ?? "?"}`);
        // The door mints the house its own key and rotates the sign-in's dead (one live key per account).
        if (r.body?.credential) ctx.key = r.body.credential;
        else p.push("the declaration handed back no credential: the sign-in's key was rotated dead with nothing in its place");
        ctx.ashore = r.body?.household?.settled === true;
        const pin = await ctx.s.q("office_api", "SELECT login, gh_id FROM household_pins WHERE handle = $1", [ctx.who.a]);
        if (pin.length !== 1 || Number(pin[0].gh_id) !== ctx.who.ghId) p.push(`the store's pin for ${ctx.who.a} is ${JSON.stringify(pin)}, not the account ${ctx.who.ghId}`);
        const houses = await ctx.s.q("office_api", "SELECT slug, residents FROM households WHERE $1 = ANY(residents)", [ctx.who.a]);
        if (houses.length !== 1) p.push(`${houses.length} households in the store hold ${ctx.who.a}, not 1`);
        else ctx.houseSlug = houses[0].slug;
        return p;
      },
    },
    {
      id: "resident",
      title: "the house adds a second resident (add-resident): bound at admission, or, where the door opens a join PR instead, the PR on the stub, its merge on the dev town clone and the keeping tick's settle-pass",
      async run(ctx) {
        const prsBefore = ctx.stub?.prs.length ?? 0;
        const asked = await door(ctx.t, "POST", "/household", { key: ctx.key, body: { do: "add-resident", args: {
          handle: ctx.who.b, card: `${ctx.who.b} is the rehearsal house's second resident (POS-354, run ${ctx.run}).`,
        } } });
        if (asked.status >= 300 || asked.body?.error) return { asked };
        // A house adding its own is pre-vouched: the door binds it in the same act
        // (POS-297, "bound at admission") and opens no PR. The PR road is the
        // frozen gangway's and an unvouched join's; when the door takes it, the
        // merge and the tick's bind are rehearsed too.
        const pr = (ctx.stub?.prs.length ?? 0) > prsBefore ? ctx.stub.prs.at(-1) : null;
        if (!pr) return { asked, road: asked.body?.household?.lane ?? "no PR" };
        // The merge, as town main receives it: the PR's file set, committed on the dev town clone.
        const files = ctx.stub.filesOf(pr);
        for (const f of files) { mkdirSync(dirname(join(ctx.t.townClone, f.path)), { recursive: true }); writeFileSync(join(ctx.t.townClone, f.path), f.content); }
        git(ctx.t.townClone, "add", "-A", "--", ...files.map((f) => f.path));
        git(ctx.t.townClone, "-c", "user.name=dev-rehearsal", "-c", "user.email=dev-rehearsal@postmark.invalid", "commit", "-q", "-m", `Merge pull request #${pr.number} (dev rehearsal ${ctx.run}): ${pr.title}`);
        ctx.stub.merged(pr);
        // The keeping tick's bind (deploy/office-keep.sh runs it inside the town lock).
        const cursor = join(ctx.scratch, "settle-pass.cursor");
        writeFileSync(cursor, new Date(Date.now() - 3600_000).toISOString() + "\n");
        const bind = ctx.job("deploy/settle-pass.mjs", ["--town", ctx.t.townClone, "--cursor", cursor]);
        return { asked, road: `join PR #${pr.number}, merged, bound by settle-pass`, pr: pr.number, files: files.map((f) => f.path), bind };
      },
      async check(ctx, r, rec) {
        if (r.asked.status >= 300 || r.asked.body?.error) return [`add-resident answered ${said(r.asked)}`];
        const p = [];
        rec.notes.push(`road: ${r.road}; the door says ${JSON.stringify(r.asked.body).slice(0, 300)}`);
        if (r.bind && r.bind.code !== 0) p.push(`settle-pass exited ${r.bind.code}: ${tail(r.bind.out)}`);
        const pins = await ctx.s.q("office_api", "SELECT handle, login, gh_id FROM household_pins WHERE handle = ANY($1)", [[ctx.who.a, ctx.who.b]]);
        if (pins.length !== 2) p.push(`the store pins ${pins.map((x) => x.handle).join(", ") || "neither"} of ${ctx.who.a}, ${ctx.who.b}: the bind did not reach the store (the 10-03 file-only bind)`);
        const houses = await ctx.s.q("office_api", "SELECT slug, residents FROM households WHERE residents && $1", [[ctx.who.a, ctx.who.b]]);
        if (houses.length !== 1) p.push(`the two residents sit in ${houses.length} households in the store (${houses.map((h) => h.slug).join(", ")}), not 1: the house would mint as two (10-03)`);
        else if (!houses[0].residents.includes(ctx.who.b)) p.push(`the store's house ${houses[0].slug} holds ${houses[0].residents.join(", ")}, not ${ctx.who.b}`);
        return p;
      },
    },
    {
      id: "letters",
      title: "POST /letters, both ways between the two residents; each waits in the store's town log for the crossing",
      async run(ctx) {
        const send = async () => {
          const out = [];
          for (const [from, to] of [[ctx.who.a, ctx.who.b], [ctx.who.b, ctx.who.a]])
            out.push(await door(ctx.t, "POST", "/letters", { key: ctx.key, body: {
              from, to, title: `rehearsal ${ctx.run} ${from}`, body: `A dev rehearsal letter (POS-354, run ${ctx.run}).`,
            } }));
          return out;
        };
        let out = await send();
        // A HOUSE THE DOOR CALLED SETTLED, STILL AT THE HARBOR. The harbor gate
        // asks the store's town index whether a handle stands ashore, and only
        // the town-index ingest writes that index (postmark-town-index.service,
        // :05/:20/:35/:50 UTC on the box); the office re-reads it every 5 s. So a
        // house declared ashore is refused mail until the next ingest. Named as a
        // finding, then the ingest runs as the box's unit would and the letters go again.
        const harbor = out.filter((r) => r.status === 403 && /harbor/.test(r.body?.defect ?? "")).length;
        if (harbor === out.length) {
          ctx.findings.push(`letters: a house the declaration door answered "settled: true" was refused mail as a harbor act (${harbor}/${out.length} letters, 403 "${out[0].body.defect}") until the town-index ingest ran; on the box that is up to 15 minutes after joining`);
          const ing = ctx.ingest("world2/tools/town-index-ingest.mjs", ["--town-repo", ctx.t.townClone, "--sha", git(ctx.t.townClone, "rev-parse", "HEAD")]);
          if (ing.code !== 0) return { out, ingest: ing };
          await new Promise((ok) => setTimeout(ok, 6_000)); // the office's reload poll (OFFICE_RELOAD_POLL_MS, 5 s)
          out = await send();
        }
        return { out };
      },
      async check(ctx, { out: rs, ingest }) {
        const p = [];
        if (ingest) return [`the town-index ingest exited ${ingest.code}: ${tail(ingest.out)}`];
        for (const r of rs) if (r.status !== 202) p.push(`POST /letters answered ${said(r)}`);
        if (p.length) return p;
        const rows = await ctx.s.q("office_api", "SELECT seq, act, handle FROM office_town_journal WHERE handle = ANY($1) ORDER BY seq", [[ctx.who.a, ctx.who.b]]);
        const sends = rows.filter((x) => /send|letter/.test(x.act));
        if (sends.length !== 2) p.push(`the store's town log holds ${sends.length} letters from the rehearsal house, not 2 (acts: ${rows.map((x) => x.act).join(", ") || "none"})`);
        const early = await ctx.s.q("office_api", "SELECT id FROM town_letters WHERE from_h = ANY($1) AND delivered_at IS NOT NULL", [[ctx.who.a, ctx.who.b]]);
        if (early.length) p.push(`${early.length} rehearsal letters read as delivered before any crossing (slow mail broken)`);
        return p;
      },
    },
    {
      id: "crossing",
      title: "the box's crossing on the dev town clone, job for job (postmark-ferry.service, then the keep tick's mint block), then the town-index ingest into the store",
      async run(ctx) {
        const steps = [];
        for (const job of CROSSING) {
          if (job.when && job.when !== (ctx.storeMint ? "store" : "git")) continue;
          const r = job.run(ctx);
          steps.push([job.name, r, job]);
          if (r.code !== 0 && !job.nonFatal) break; // the unit's `&&`: the first refusal stops the chain
          if (job.commit) ctx.commitTown(typeof job.commit === "function" ? job.commit(ctx) : job.commit);
        }
        // the store's town index catches up to the clone (on the box: postmark-town-index.service, every 15 min)
        if (steps.every(([, r, job]) => r.code === 0 || job.nonFatal))
          steps.push(["index", ctx.ingest("world2/tools/town-index-ingest.mjs", ["--town-repo", ctx.t.townClone, "--sha", git(ctx.t.townClone, "rev-parse", "HEAD")]), {}]);
        return steps;
      },
      async check(ctx, steps, rec) {
        const p = [];
        for (const [name, r, job] of steps) {
          if (r.code === 0) continue;
          if (job.nonFatal) rec.notes.push(`${name} exited ${r.code} (the box runs it non-fatal): ${tail(r.out, 2)}`);
          else p.push(`${name} exited ${r.code}: ${tail(r.out)}`);
        }
        if (p.length) return p;
        rec.notes.push(`the chain: ${steps.map(([name]) => name).join(" → ")} (${ctx.storeMint ? "STAMP_LINES=store: the store's mint" : "the town's own --append"})`);
        if (ctx.storeMint) {
          // the store's chain and its export agree, line for line (the switch's own verifier)
          const v = ctx.job("world2/tools/stamp-lines.mjs", ["--verify", "--clone", ctx.t.townClone]);
          if (v.code !== 0) p.push(`stamp-lines --verify after the crossing exited ${v.code}: ${tail(v.out)}`);
        }
        const delivered = await ctx.s.q("office_api", "SELECT id, from_h, to_h FROM town_letters WHERE from_h = ANY($1) AND delivered_at IS NOT NULL", [[ctx.who.a, ctx.who.b]]);
        if (delivered.length < 2) p.push(`the store reads ${delivered.length} of the rehearsal's 2 letters as delivered after the crossing`);
        const ashore = await ctx.s.q("office_api", "SELECT handle FROM town_residents WHERE handle = ANY($1)", [[ctx.who.a, ctx.who.b]]);
        if (ashore.length !== 2) p.push(`the store's town index holds ${ashore.map((x) => x.handle).join(", ") || "neither"} of the two residents after the crossing`);
        // THE HOUSE MINTS AS ONE (10-03). The mint's record is still the town's
        // ledger (the store mint is POS-341); the store's projection must agree
        // with it, and the ledger must hold one welcome for the house.
        const engine = await importFrom(join(ctx.t.townClone, "tools", "stamp-mint.mjs"));
        const entries = engine.parseStampLedger(readFileSync(join(ctx.t.townClone, "WHITE_PAGES", "stamp-ledger.md"), "utf8"));
        const welcomes = entries.map((e) => engine.classifyEntry(e.canonical)).filter((c) => c?.kind === "welcome" && [ctx.who.a, ctx.who.b].includes(c.handle));
        if (welcomes.length !== 1) p.push(`the ledger holds ${welcomes.length} welcome bundles for the rehearsal house, not 1: the house minted as ${welcomes.length ? welcomes.map((w) => w.household).join(" and ") : "nothing"}`);
        const stamps = await ctx.s.q("office_api", "SELECT handle, balance FROM town_stamps WHERE handle = ANY($1)", [[ctx.who.a, ctx.who.b]]);
        const fold = engine.foldBalances(entries);
        for (const h of [ctx.who.a, ctx.who.b]) {
          const store = Number(stamps.find((x) => x.handle === h)?.balance ?? 0);
          if (store !== (fold.get(h) ?? 0)) p.push(`the store reads ${h}'s balance as ${store}, the ledger as ${fold.get(h) ?? 0}`);
        }
        ctx.minted = { welcomes: welcomes.map((w) => `${w.handle} ✦${w.n} (${w.household})`), balances: Object.fromEntries([ctx.who.a, ctx.who.b].map((h) => [h, fold.get(h) ?? 0])) };
        rec.notes.push(`delivered ${delivered.length} letters; welcome ${ctx.minted.welcomes.join(", ") || "none"}; balances ${JSON.stringify(ctx.minted.balances)} (ledger = store)`);
        return p;
      },
    },
    {
      id: "claim",
      title: "the first resident claims a parcel through POST /world/marks (free: min stake 0), into the open window",
      async run(ctx) {
        const [win] = await ctx.s.q("office_api", "SELECT id FROM windows WHERE status = 'open' ORDER BY id DESC LIMIT 1");
        ctx.window = win?.id ?? null;
        ctx.mark = `rh-${ctx.run}-ground`;
        return door(ctx.t, "POST", "/world/marks", { key: ctx.key, body: {
          by: ctx.who.a, slug: ctx.mark, kind: "parcel", at: ctx.parcelAt, stamps: 0, body: `The dev rehearsal's ground (POS-354, run ${ctx.run}).`,
        } });
      },
      async check(ctx, r, rec) {
        if (ctx.window == null) return ["the store has no open window: the candle is out, nothing can be claimed or cleared"];
        if (r.status >= 300 || r.body?.error) return [`POST /world/marks answered ${said(r)}`];
        // claims carry row-level security scoped to a household; the clearing's pen reads them all
        const claims = await ctx.s.q("clearing_job", "SELECT id, status, window_id, claimant, household FROM claims WHERE slug = $1 AND claimant = $2", [`${ctx.who.a}/${ctx.mark}`, ctx.who.a]).catch((e) => [{ error: e.message }]);
        ctx.claims = claims;
        if (!claims.length) return [`the store holds no claim for ${ctx.mark} after the door answered ${r.status}`];
        if (claims[0].error) return [`reading the claim: ${claims[0].error}`];
        const mine = claims.find((c) => Number(c.window_id) === Number(ctx.window));
        if (!mine) return [`the claim sits in window ${claims.map((c) => c.window_id).join(", ")}, not the open ${ctx.window}`];
        rec.notes.push(`claim ${mine.id}: ${mine.status} in window ${mine.window_id}, household ${mine.household}`);
        return mine.status === "pending" ? [] : [`the claim reads ${mine.status}, not pending: the door did not put it forward, so the candle will not rule on it`];
      },
    },
    {
      id: "clearing",
      title: "the clearing closes the open window as clearing_job (stamp-ingest first, the parcel cap read from the world clone)",
      async run(ctx) {
        // The box fires postmark-world2-clearing and postmark-settlement at the same
        // instant, and the settlement waits for the candle to lock its docket. So the
        // scheduled settlement starts first here too, and the next step awaits it.
        ctx.settling = ctx.settlement();
        await new Promise((ok) => setTimeout(ok, 5_000));
        // THE CLOCK, COMPRESSED. The box clears a window at its boundary; the rehearsal
        // clears it now, so the window's close comes to now first (as clearing_job, the
        // pen that writes windows; the newest window has no successor to tile against).
        // Left in the future, every reader keyed on closes_at misses this crossing:
        // settlements-backfill names a settlement's window as the newest closed at or
        // before its publish, and a settlement S<n> would carry no window.
        await ctx.s.q("clearing_job", "UPDATE windows SET closes_at = date_trunc('second', now()) WHERE id = $1 AND status = 'open' AND closes_at > now()", [ctx.window]);
        return ctx.clearing(ctx.window);
      },
      async check(ctx, r) {
        if (r.code !== 0) return [`clearing-job --window ${ctx.window} exited ${r.code}: ${tail(r.out)}`];
        const p = [];
        const [w] = await ctx.s.q("office_api", "SELECT status, cleared_at, town_sha, receipts FROM windows WHERE id = $1", [ctx.window]);
        if (w?.status !== "closed") p.push(`window ${ctx.window} reads ${w?.status ?? "missing"} after the clearing, not closed`);
        const next = await ctx.s.q("office_api", "SELECT id FROM windows WHERE id = $1 AND status = 'open'", [ctx.window + 1]);
        if (!next.length) p.push(`the clearing left no open window ${ctx.window + 1}: the candle went out`);
        ctx.clearedReceipts = w?.receipts ?? null;
        const [c] = await ctx.s.q("clearing_job", "SELECT status, refusal_check FROM claims WHERE slug = $1 AND claimant = $2 AND window_id = $3", [`${ctx.who.a}/${ctx.mark}`, ctx.who.a, ctx.window]);
        if (c?.status !== "locked") p.push(`the rehearsal's parcel reads ${c?.status ?? "missing"}${c?.refusal_check ? ` (${c.refusal_check})` : ""} after the clearing, not locked`);
        const marks = await ctx.s.q("clearing_job", "SELECT slug FROM marks WHERE slug = $1", [`${ctx.who.a}/${ctx.mark}`]);
        if (marks.length !== 1) p.push(`the store's marks hold ${marks.length} rows for ${ctx.mark}, not 1`);
        return p;
      },
    },
    {
      id: "settle",
      title: "the settlement crosses the cleared window from the store (settlement-auto.sh, SETTLEMENT_SOURCE=store) into a bare copy of the world",
      async run(ctx) { return ctx.settling ?? ctx.settlement(); },
      async check(ctx, r) { return settled(ctx, r, { byHand: false, window: ctx.window }); },
    },
    {
      id: "bless",
      title: "the keeper's bless (an annotated settlement tag on the copy), then the keeping tick's settlements-backfill writes the row",
      async run(ctx) {
        const tags = git(ctx.worldBare, "tag", "-l", "settlement/S*").split("\n").filter(Boolean).map((x) => Number(x.slice(12))).filter(Number.isInteger);
        const [{ n }] = await ctx.s.q("office_api", "SELECT coalesce(max(number), 0) AS n FROM settlements");
        ctx.blessed = Math.max(Number(n), ...tags, 0) + 1;
        ctx.blessedSha = git(ctx.worldBare, "rev-parse", "main");
        git(ctx.worldBare, "-c", "user.name=dev-rehearsal (the keeper's hand)", "-c", "user.email=dev-rehearsal@postmark.invalid",
          "tag", "-a", `settlement/S${ctx.blessed}`, ctx.blessedSha, "-m", `S${ctx.blessed} (dev rehearsal ${ctx.run}): blessed over window ${ctx.window}`);
        const tag = `settlement/S${ctx.blessed}`;
        // THE ROW, FROM A VIEW HOLDING ONLY THIS BLESSING. The backfill writes a row
        // for every tag its checkout carries and REFUSES a tag whose row disagrees
        // ("a moved tag is a person's finding"). The dev store keeps each rehearsal's
        // row, and the world's real S<n> arrives later with another sha, so a view
        // carrying every tag would refuse the next rehearsal for the last one's row.
        const view = join(ctx.scratch, `bless-${ctx.blessed}`);
        execFileSync("git", ["clone", "-q", "--no-tags", "--single-branch", "--branch", "main", ctx.worldBare, view]);
        git(view, "fetch", "-q", "origin", `refs/tags/${tag}:refs/tags/${tag}`);
        // The blessed commit into the dev world clone too (a tag, never main, never
        // pushed), so the dev office can read the settlement its store now names;
        // the nightly freshen's forced tag fetch puts the world's own back.
        if (ctx.t.worldClone && existsSync(join(ctx.t.worldClone, ".git"))) gitQuiet(ctx.t.worldClone, "fetch", "-q", ctx.worldBare, `+refs/tags/${tag}:refs/tags/${tag}`);
        // `--prod` is the tool's own override of its name check ("lab"/"scratch");
        // the rehearsal's guard has already proved this is the dev office's database.
        return ctx.job("world2/tools/settlements-backfill.mjs", ["--world-repo", view, "--apply", "--prod", "--quiet"]);
      },
      async check(ctx, r) {
        if (r.code !== 0) return [`settlements-backfill exited ${r.code}: ${tail(r.out)}`];
        const [row] = await ctx.s.q("office_api", "SELECT tag_sha, window_id, blessed_at FROM settlements WHERE number = $1", [ctx.blessed]);
        if (!row) return [`the store holds no settlements row for S${ctx.blessed} after the backfill`];
        const p = [];
        if (row.tag_sha !== ctx.blessedSha) p.push(`S${ctx.blessed}'s row names ${row.tag_sha}, not the blessed ${ctx.blessedSha}`);
        if (Number(row.window_id) !== Number(ctx.window)) p.push(`S${ctx.blessed}'s row names window ${row.window_id}, not the cleared ${ctx.window}`);
        if (!row.blessed_at) p.push(`S${ctx.blessed}'s row has no blessed_at (an annotated tag carries one)`);
        return p;
      },
    },
    // ── the recovery paths ──
    {
      id: "clearing-rerun",
      title: "recovery: the clearing re-run on the window it already closed refuses by name and moves nothing",
      async run(ctx) {
        ctx.before = await storeFacts(ctx);
        return ctx.clearing(ctx.window);
      },
      async check(ctx, r) {
        const p = [];
        if (r.code === 0) p.push(`clearing-job --window ${ctx.window} ran a second time and exited 0`);
        else if (!/is not open/.test(r.out)) p.push(`the re-run exited ${r.code} without naming the closed window: ${tail(r.out)}`);
        const after = await storeFacts(ctx);
        if (JSON.stringify(after) !== JSON.stringify(ctx.before)) p.push(`the re-run moved the store: ${JSON.stringify(ctx.before)} → ${JSON.stringify(after)}`);
        return p;
      },
    },
    {
      id: "by-hand",
      title: "recovery: a second claim, its window cleared, and the settlement taken BY HAND (SETTLEMENT_BY_HAND=1, the operator's road)",
      async run(ctx) {
        ctx.window2 = ctx.window + 1;
        ctx.mark2 = `rh-${ctx.run}-by-hand`;
        const claim = await door(ctx.t, "POST", "/world/marks", { key: ctx.key, body: {
          by: ctx.who.b, slug: ctx.mark2, kind: "parcel", at: ctx.parcelAt2, stamps: 0, body: `The by-hand road's ground (POS-354, run ${ctx.run}).`,
        } });
        if (claim.status >= 300 || claim.body?.error) return { claim };
        await ctx.s.q("clearing_job", "UPDATE windows SET closes_at = date_trunc('second', now()) WHERE id = $1 AND status = 'open' AND closes_at > now()", [ctx.window2]);
        const clearing = ctx.clearing(ctx.window2);
        if (clearing.code !== 0) return { claim, clearing };
        return { claim, clearing, settle: await ctx.settlement({ byHand: true }) };
      },
      async check(ctx, r) {
        if (r.claim.status >= 300 || r.claim.body?.error) return [`the second claim: POST /world/marks answered ${said(r.claim)}`];
        if (r.clearing.code !== 0) return [`clearing-job --window ${ctx.window2} exited ${r.clearing.code}: ${tail(r.clearing.out)}`];
        return settled(ctx, r.settle, { byHand: true, window: ctx.window2, mark: ctx.mark2 });
      },
    },
    {
      id: "refused-alone",
      title: "recovery: a claim the clearing cannot file refuses only itself (POS-356), and the rest of its window locks and crosses",
      // THE 10-04 INSTANCE, PLANTED. Window 228 held ten lawful claims and one
      // from a claimant the store's roll did not name; the clearing threw and the
      // whole window waited a night. No door on this train can let that claim in
      // (the mark door files under the acting handle's house, and no door removes
      // a resident), so the rehearsal writes it the way the 10-04 door did: the
      // door's own pen (office_api) puts a copy of a lawful door claim on the
      // docket under a claimant the roll does not carry. Then the candle runs as
      // the box runs it, and the crossing follows.
      async run(ctx) {
        ctx.window3 = ctx.window2 + 1;
        ctx.mark3 = `rh-${ctx.run}-lamp`;
        ctx.ghost = `rh-${ctx.run}-gone`;
        const claim = await door(ctx.t, "POST", "/world/marks", { key: ctx.key, body: {
          by: ctx.who.a, slug: ctx.mark3, kind: "sited", at: ctx.parcelAt, stamps: 0, body: `A lamp on the rehearsal's own ground (POS-354, run ${ctx.run}).`,
        } });
        if (claim.status >= 300 || claim.body?.error) return { claim };
        const [good] = await ctx.s.q("clearing_job", "SELECT id::text, window_id FROM claims WHERE slug = $1 AND claimant = $2 AND status = 'pending'", [`${ctx.who.a}/${ctx.mark3}`, ctx.who.a]);
        if (!good) return { claim, setup: `the door answered ${claim.status} and the store holds no pending claim for ${ctx.mark3}` };
        if (Number(good.window_id) !== ctx.window3) return { claim, setup: `the claim sits in window ${good.window_id}, not the open ${ctx.window3}` };
        ctx.goodClaim = good.id;
        ctx.ghostSlug = `${ctx.ghost}/${ctx.mark3}`;
        // every column the door wrote, copied, but the claimant and the name
        const cols = (await ctx.s.q("office_api", "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'claims' AND column_name <> 'id' AND is_generated = 'NEVER' AND is_identity = 'NO' ORDER BY ordinal_position")).map((r) => r.column_name);
        const pick = cols.map((c) => c === "claimant" ? "$2::text" : c === "slug" ? "$3::text"
          : c === "geometry" ? "CASE WHEN geometry ? 'slug' THEN jsonb_set(geometry, '{slug}', to_jsonb($3::text)) ELSE geometry END" : `"${c}"`);
        const [planted] = await ctx.s.q("office_api", `INSERT INTO claims (${cols.map((c) => `"${c}"`).join(", ")}) SELECT ${pick.join(", ")} FROM claims WHERE id = $1 RETURNING id::text`, [good.id, ctx.ghost, ctx.ghostSlug]);
        ctx.plantedClaim = planted.id;
        const houses = await ctx.s.q("office_api", "SELECT slug FROM households WHERE $1 = ANY(residents)", [ctx.ghost]);
        if (houses.length) return { claim, setup: `the planted claimant ${ctx.ghost} stands in ${houses[0].slug}: the instance did not plant` };
        // the box's order: the scheduled settlement starts first and waits for the candle
        ctx.settling = ctx.settlement();
        await new Promise((ok) => setTimeout(ok, 5_000));
        await ctx.s.q("clearing_job", "UPDATE windows SET closes_at = date_trunc('second', now()) WHERE id = $1 AND status = 'open' AND closes_at > now()", [ctx.window3]);
        const clearing = ctx.clearing(ctx.window3);
        const settle = await ctx.settling;
        ctx.settling = null;
        return { claim, clearing, settle };
      },
      async check(ctx, r, rec) {
        if (r.claim.status >= 300 || r.claim.body?.error) return [`the lawful claim: POST /world/marks answered ${said(r.claim)}`];
        if (r.setup) return [r.setup];
        if (r.clearing.code !== 0) return [`clearing-job --window ${ctx.window3} exited ${r.clearing.code} with a claim it could not file in the docket (the 10-04 failure: one claim held the window): ${tail(r.clearing.out)}`];
        const p = [];
        const rows = await ctx.s.q("clearing_job", "SELECT id::text, status, refusal_check FROM claims WHERE id = ANY($1::bigint[])", [[ctx.goodClaim, ctx.plantedClaim]]);
        const planted = rows.find((x) => x.id === ctx.plantedClaim), good = rows.find((x) => x.id === ctx.goodClaim);
        if (planted?.status !== "refused") p.push(`the planted claim reads ${planted?.status ?? "missing"}, not refused`);
        else if (!/^unfileable: no such household stands in the town for /.test(planted.refusal_check ?? "")) p.push(`the planted claim was refused for "${planted.refusal_check}", not as unfileable (no house on the roll)`);
        if (good?.status !== "locked") p.push(`the lawful claim beside it reads ${good?.status ?? "missing"}${good?.refusal_check ? ` (${good.refusal_check})` : ""}, not locked: one claim held another`);
        const [w] = await ctx.s.q("office_api", "SELECT status, receipts FROM windows WHERE id = $1", [ctx.window3]);
        if (w?.status !== "closed") p.push(`window ${ctx.window3} reads ${w?.status ?? "missing"} after the clearing, not closed`);
        const unfiled = (w?.receipts?.unfileable ?? []).map((u) => u.slug);
        if (JSON.stringify(unfiled) !== JSON.stringify([ctx.ghostSlug])) p.push(`the window's receipt names ${JSON.stringify(unfiled)} unfileable, not [${ctx.ghostSlug}]`);
        if (!(await ctx.s.q("office_api", "SELECT 1 FROM windows WHERE id = $1 AND status = 'open'", [ctx.window3 + 1])).length) p.push(`the clearing left no open window ${ctx.window3 + 1}: the candle went out`);
        const marks = await ctx.s.q("clearing_job", "SELECT slug FROM marks WHERE slug = ANY($1)", [[`${ctx.who.a}/${ctx.mark3}`, ctx.ghostSlug]]);
        if (marks.map((m) => m.slug).join() !== `${ctx.who.a}/${ctx.mark3}`) p.push(`the store's marks hold ${JSON.stringify(marks.map((m) => m.slug))}, not the lawful mark alone`);
        if (p.length) return p;
        rec.notes.push(`refused alone: ${planted.refusal_check.slice(0, 160)}`);
        const crossed = await settled(ctx, r.settle, { byHand: false, window: ctx.window3, mark: ctx.mark3 });
        if (!crossed.length) {
          const head = git(ctx.worldBare, "rev-parse", "main");
          if (git(ctx.worldBare, "ls-tree", "-r", "--name-only", head, "--", "WORLD/marks").split("\n").some((f) => f.includes(`/${ctx.ghost}/`)))
            crossed.push(`the copy's main carries a file for the refused claimant ${ctx.ghost}`);
        }
        return crossed;
      },
    },
  ];
}

/**
 * DEV SIGNS WITH ITS OWN KEY (POS-354, Darko 2026-10-07). Each fact read, none
 * printed: the dev env names a STAMP_KEY and it is a key; its public half is
 * not prod's (on 10-07 the dev root's key was a byte-identical copy of prod's);
 * and the dev town clone's tools/stamp-pubkey.pem is that public half (the
 * freshen's re-sign put it there), so every line dev's pens sign verifies. With
 * STAMP_LINES=store, also: the store's chain agrees with the clone's export. A
 * freshen stands the clone back on the seed and leaves the store's lines past
 * it, and every stamped write then refuses; the dev reset trims them
 * (deploy/DEPLOY.md § The dev rehearsal).
 */
async function keyProblems(ctx) {
  const t = ctx.t;
  if (!t.env.STAMP_KEY) return ["the dev office sets no STAMP_KEY, so its pens sign with PROD's key file (/srv/postmark-office/stamp-key.pem, src/ledger-pen.mjs); set it to the dev root's own key"];
  if (!existsSync(t.stampKey)) return [`no stamp key at ${t.stampKey}: the crossing cannot mint`];
  let pub;
  try { pub = publicOf(readFileSync(t.stampKey, "utf8")); }
  catch (e) { return [`the dev key at ${t.stampKey} could not be read as a key (${e.code ?? e.message})`]; }
  const p = [];
  if (t.prodStampKey && existsSync(t.prodStampKey)) {
    let prodPub = null;
    try { prodPub = publicOf(readFileSync(t.prodStampKey, "utf8")); }
    catch (e) { p.push(`prod's key at ${t.prodStampKey} could not be read to compare with dev's (${e.code ?? e.message})`); }
    if (prodPub === pub) p.push(`dev's STAMP_KEY (${t.stampKey}) is PROD's key (${t.prodStampKey}): generate dev's own (deploy/DEPLOY.md § The dev rehearsal)`);
  }
  const pubPath = t.townClone ? join(t.townClone, "tools", "stamp-pubkey.pem") : null;
  const installed = pubPath && existsSync(pubPath) ? readFileSync(pubPath, "utf8").replace(/\r\n/g, "\n") : null;
  if (installed !== pub) p.push(`the dev town clone's tools/stamp-pubkey.pem is not the public half of dev's STAMP_KEY: the clone is not on dev's key, so every line dev's pens sign fails the town's verifier (the freshen moves it: node tools/dev-ledger-resign.mjs --town ${t.townClone} --key ${t.stampKey} --not-key ${t.prodStampKey} --verify)`);
  if (ctx.storeMint && !p.length) {
    const v = ctx.job("world2/tools/stamp-lines.mjs", ["--verify", "--clone", t.townClone]);
    if (v.code !== 0) p.push(`the store's stamp chain and the dev clone's ledger disagree (stamp-lines --verify exited ${v.code}: ${tail(v.out, 3)}): before a rehearsal the store's lines are trimmed to the clone and synced (deploy/DEPLOY.md § The dev rehearsal)`);
  }
  return p;
}

/** The store facts a re-run must not move: the window, its claims, the marks. */
async function storeFacts(ctx) {
  const [w] = await ctx.s.q("office_api", "SELECT status, cleared_at::text AS cleared_at, town_sha, md5(receipts::text) AS receipts FROM windows WHERE id = $1", [ctx.window]);
  const claims = await ctx.s.q("clearing_job", "SELECT id::text, status FROM claims WHERE window_id = $1 ORDER BY id", [ctx.window]);
  const [{ marks }] = await ctx.s.q("clearing_job", "SELECT count(*)::int AS marks FROM marks");
  const [{ open }] = await ctx.s.q("office_api", "SELECT count(*)::int AS open FROM windows WHERE status = 'open'");
  return { window: w, claims, marks, open };
}

/** A settlement's checks: it crossed, its receipt is in the store, the mark is on the copy's main. */
async function settled(ctx, r, { byHand, window, mark = ctx.mark }) {
  if (r.setup) return [r.setup];
  const p = [];
  let receipt = null;
  try { receipt = JSON.parse(readFileSync(r.report, "utf8")); } catch { /* named below */ }
  if (r.code !== 0) p.push(`settlement-auto.sh${byHand ? " (by hand)" : ""} exited ${r.code}: ${receipt?.status ?? ""} ${receipt?.detail ?? tail(r.out)}`.trim());
  if (!receipt) return [...p, `no receipt at ${r.report}`];
  if (p.length) return p;
  const rows = await ctx.s.q("office_api", "SELECT status, by_hand, world_to FROM crossing_receipts WHERE world_to = $1 ORDER BY id DESC LIMIT 1", [receipt.world_to ?? ""]);
  if (!rows.length) p.push(`the store holds no crossing_receipts row for this crossing (world_to ${receipt.world_to ?? "none"})`);
  else if (rows[0].by_hand !== byHand) p.push(`the store's receipt says by_hand ${rows[0].by_hand}, not ${byHand}`);
  const head = git(ctx.worldBare, "rev-parse", "main");
  const files = git(ctx.worldBare, "ls-tree", "-r", "--name-only", head, "--", "WORLD/marks").split("\n");
  if (!files.some((f) => f.includes(`/${mark}/`) || f.endsWith(`/${mark}.md`))) p.push(`the copy's main (${head.slice(0, 9)}) carries no file for ${mark} after the crossing`);
  if (receipt.docket_window != null && Number(receipt.docket_window) !== Number(window)) p.push(`the crossing folded window ${receipt.docket_window}, not ${window}`);
  return p;
}

// ── the run ──────────────────────────────────────────────────────────────────

/** A short run id, unique enough for a handle: base36 minutes since 2026-01-01. */
const runId = () => Math.floor((Date.now() - Date.UTC(2026, 0, 1)) / 60_000).toString(36);

/**
 * Run the rehearsal against `t` (a target from `targetFromFiles`, or a test's).
 * Answers `{ green, guard, steps: [{ id, title, ok, problems, notes, ms }] }`.
 * Stops at the first red step.
 */
export async function runRehearsal(t, { only = null, keep = false, log = () => {}, run = runId() } = {}) {
  const t0 = Date.now();
  const report = { green: false, run, office: t.office, steps: [] };
  const guard = storeGuard({ configuredUrl: t.env.WORLD2_PG_URL, urls: t.urls, source: t.source });
  report.guard = guard.line;
  log(guard.line);
  if (!guard.ok) { report.refused = guard.problems; report.setup_failed = true; return report; }

  const scratch = mkdtempSync(join(tmpdir(), "dev-rehearsal-"));
  const s = await storeClients(t);
  let stub = null;
  let ctx = null;
  try {
    // The second instrument: ask each connection which database it reached.
    for (const role of Object.keys(t.urls)) {
      const [{ db }] = await s.q(role, "SELECT current_database() AS db");
      if (db !== guard.db || db === PROD_DB) throw Object.assign(new Error(`the ${role} connection reached ${db}, not ${guard.db}`), { refusal: true });
    }
    log(`store: every pen (${Object.keys(t.urls).join(", ")}) answers from ${guard.db}`);

    // The GitHub stub, on the port the dev office's env names (loopback only).
    let stubPort = null;
    try {
      const u = new URL(t.env.GITHUB_API_URL ?? "");
      if (["127.0.0.1", "localhost"].includes(u.hostname) && u.port) stubPort = Number(u.port);
    } catch { /* no URL, no stub: the preflight names it */ }
    if (stubPort) {
      const [owner, repo] = String(t.env.POSTMARK_TOWN_REPO ?? "postmark-town/postmark").split("/");
      stub = githubStub({ owner, repo, branch: t.env.POSTMARK_TOWN_BRANCH ?? "main", townClone: t.townClone });
      await stub.listen(stubPort);
      log(`github: the stub answers ${owner}/${repo} on :${stubPort}`);
    }

    ctx = {
      t, s, db: guard.db, run, scratch, stub, stubPort, log,
      // a defect the rehearsal measured and names on every run but does not gate on (a ruling or another lane's fix is owed)
      findings: [],
      who: {
        a: `rh-${run}-a`, b: `rh-${run}-b`, house: `rh-${run}-house`,
        // A synthetic GitHub account: above every real id today (~2.4e8) and below 2^31.
        ghId: 2_100_000_000 + (parseInt(run, 36) % 40_000_000), login: `rh-${run}-human`,
      },
      /** A job the box runs (an office deploy/ or tools/ script), with the dev office's env. */
      job(rel, args = [], { extraEnv = {}, cwd = t.officeRoot } = {}) {
        return ctx.spawn([process.execPath, join(t.officeRoot, rel), ...args], { extraEnv, cwd });
      },
      spawn(argv, { extraEnv = {}, cwd = t.officeRoot } = {}) {
        const r = spawnSync(argv[0], argv.slice(1), { cwd, env: childEnv(t, extraEnv), encoding: "utf8", maxBuffer: 64 * 1024 * 1024, windowsHide: true });
        return { code: r.status ?? (r.error ? 127 : null), out: `${r.stdout ?? ""}${r.stderr ?? ""}${r.error ? String(r.error.message) : ""}` };
      },
      /**
       * A crossing job under the dev office's town lock, as the ferry and the
       * keeping tick take it (flock -w 300 <root>/town.lock): a dev door write
       * landing mid-crossing waits its turn instead of racing the chain. Where
       * there is no flock (a laptop), the job runs bare and the drain is told so.
       */
      locked(argv, { extraEnv = {}, cwd = t.officeRoot } = {}) {
        const lock = t.env.TOWN_LOCK ?? join(t.officeRoot, "town.lock");
        return ctx.useFlock ? ctx.spawn(["/usr/bin/flock", "-w", "300", lock, ...argv], { extraEnv, cwd }) : ctx.spawn(argv, { extraEnv, cwd });
      },
      useFlock: process.platform === "linux" && existsSync("/usr/bin/flock"),
      // STAMP_LINES=store: the mint decides from the store (POS-341), as prod's will after the w42 ship
      storeMint: t.env.STAMP_LINES === "store",
      // the keep tick's registry, written from the store by deploy/registry-file.mjs
      registryFile: join(scratch, "registry.json"),
      /** Commit what a crossing job wrote on the dev town clone, as the pen would (never pushed). */
      commitTown(message) {
        if (!git(t.townClone, "status", "--porcelain")) return null;
        git(t.townClone, "add", "-A");
        git(t.townClone, "-c", `user.name=${t.env.BOT_NAME ?? "dev-rehearsal"}`, "-c", `user.email=${t.env.BOT_EMAIL ?? "dev-rehearsal@postmark.invalid"}`, "commit", "-q", "-m", message);
        return git(t.townClone, "rev-parse", "HEAD");
      },
      /** An ingest the box runs as law_ingester (the town index, the stamps), against the dev store. */
      ingest(rel, args = []) {
        return ctx.job(rel, args, { extraEnv: { ...pgEnv(t.urls.law_ingester), WORLD2_INGEST_URL: t.urls.law_ingester } });
      },
      /** The candle's close for one window, as world2-clearing.sh runs it. */
      clearing(windowId, extra = []) {
        return ctx.job("world2/tools/clearing-job.mjs", ["--window", String(windowId), "--town-repo", t.townClone, ...(t.worldClone ? ["--world-repo", t.worldClone] : []), ...extra],
          // the first step (stamp-ingest) dials PG*, as the box's clearing unit env file supplies them for law_ingester
          { extraEnv: { ...pgEnv(t.urls.law_ingester), WORLD2_CLEARING_URL: t.urls.clearing_job, WORLD2_INGEST_URL: t.urls.law_ingester } });
      },
      /**
       * The settlement, as postmark-settlement(-by-hand).service runs it, with
       * every edge that leaves the run pointed into the scratch directory:
       *   · world: SETTLEMENT_CLONE clones from WORLD_CLONE's origin, and that
       *     origin is a bare copy of the dev world clone, so publish_main's push
       *     and the keeper's tag land there and nowhere else;
       *   · town: the crossing pins origin/main of TOWN_CLONE, so its town is a
       *     view whose origin is the dev town clone (the rehearsal's commits),
       *     never GitHub's town;
       *   · the receipt: SETTLEMENT_REPORT, never /srv/postmark-harbor (prod's
       *     public receipt, which the keeper reads before he blesses);
       *   · escalation: SETTLEMENT_ESCALATE_CRED names a file that does not
       *     exist, so a red files no GitHub issue (the tool prints ISSUE-WANTED).
       */
      async settlement({ byHand = false } = {}) {
        if (!ctx.worldBare) {
          if (!t.worldClone || !existsSync(join(t.worldClone, ".git"))) return { setup: `no world clone at ${t.worldClone}` };
          ctx.worldBare = join(scratch, "world.git");
          // tags come along: the bless numbers the next settlement after the world's real ones
          execFileSync("git", ["clone", "-q", "--bare", "--local", t.worldClone, ctx.worldBare]);
          const branch = gitQuiet(t.worldClone, "symbolic-ref", "--short", "-q", "HEAD").stdout.trim();
          if (branch !== "main") git(ctx.worldBare, "update-ref", "refs/heads/main", git(t.worldClone, "rev-parse", "HEAD"));
          git(ctx.worldBare, "symbolic-ref", "HEAD", "refs/heads/main");
          ctx.worldView = join(scratch, "world-view");
          execFileSync("git", ["clone", "-q", ctx.worldBare, ctx.worldView]);
          ctx.townView = join(scratch, "town-view");
          execFileSync("git", ["clone", "-q", "--local", "--no-checkout", t.townClone, ctx.townView]);
          const tb = gitQuiet(t.townClone, "symbolic-ref", "--short", "-q", "HEAD").stdout.trim();
          if (tb !== "main") return { setup: `the dev town clone is on ${tb || "a detached HEAD"}, not main: the settlement pins origin/main` };
        }
        const n = (ctx.settlements = (ctx.settlements ?? 0) + 1);
        const report = join(scratch, `settlement-${n}.json`);
        const logPath = join(scratch, `settlement-${n}.log`);
        // Asynchronous, its output to a file: the scheduled crossing STARTS before
        // the clearing and waits for the candle (await-clearing), as the box's two
        // units fire at the same instant; a pipe would stall it while this process
        // waits on the clearing.
        const fd = openSync(logPath, "w");
        const child = spawn("sh", [join(t.officeRoot, "deploy", "settlement-auto.sh")], {
          cwd: t.officeRoot, stdio: ["ignore", fd, fd], windowsHide: true,
          env: childEnv(t, {
            OFFICE_ROOT: t.officeRoot,
            TOWN_CLONE: ctx.townView, WORLD_CLONE: ctx.worldView,
            SETTLEMENT_CLONE: join(scratch, `sweep-${n}`),
            SETTLEMENT_REPORT: report,
            SETTLEMENT_SOURCE: "store", STATE_LOG_SOURCE: "store",
            SETTLEMENT_BY_HAND: byHand ? "1" : "0",
            SETTLEMENT_ESCALATE_CRED: join(scratch, "no-credentials-on-purpose"),
            SETTLEMENT_CLEARING_WAIT_S: "180",
            SETTLEMENT_ATTEMPT: "1",
            WORLD2_CLEARING_URL: t.urls.clearing_job,
          }),
        });
        return new Promise((ok) => child.on("exit", (code) => {
          try { closeSync(fd); } catch { /* closed */ }
          ok({ code, out: readFileSync(logPath, "utf8"), report, log: logPath });
        }));
      },
      // the town's date, as the ferry dates a crossing
      today: new Intl.DateTimeFormat("en-CA", { timeZone: t.env.TOWN_TZ ?? "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()),
      stampKey: t.stampKey,
      // two parcels of ground for the rehearsal, apart from each other and moved by the run id
      parcelAt: { x: 30000 + (parseInt(run, 36) % 400) * 60, y: 30000 },
      parcelAt2: { x: 30000 + (parseInt(run, 36) % 400) * 60, y: 30100 },
    };

    for (const step of plan()) {
      if (only && !only.includes(step.id) && step.id !== "preflight") continue;
      const rec = { id: step.id, title: step.title, ok: false, problems: [], notes: [] };
      report.steps.push(rec);
      if (step.pending) { rec.pending = step.pending; rec.ok = true; log(`· ${step.id} PENDING: ${step.pending}`); continue; }
      const s0 = Date.now();
      const f0 = ctx.findings.length;
      log(`· ${step.id}: ${step.title}`);
      let result;
      try { result = await step.run(ctx); }
      catch (e) { rec.problems.push(`the step threw: ${tail(e?.stack ?? e, 4)}`); }
      if (!rec.problems.length) {
        try { rec.problems.push(...((await step.check(ctx, result, rec)) ?? [])); }
        catch (e) { rec.problems.push(`the step's check threw: ${tail(e?.stack ?? e, 4)}`); }
      }
      rec.findings = ctx.findings.slice(f0);
      for (const f of rec.findings) log(`  FINDING: ${f}`);
      rec.ms = Date.now() - s0;
      rec.ok = rec.problems.length === 0;
      log(`  ${rec.ok ? "green" : "RED"} (${Math.round(rec.ms / 100) / 10} s)${rec.ok ? "" : "\n    " + rec.problems.join("\n    ")}`);
      if (!rec.ok) break;
    }
    report.green = report.steps.length > 0 && report.steps.every((x) => x.ok);
  } catch (e) {
    report.error = String(e?.message ?? e);
    report.setup_failed = Boolean(e?.refusal) || !report.steps.length;
  } finally {
    if (ctx?.settling) await ctx.settling.catch(() => {}); // never leave a settlement running behind the report
    await s.end();
    if (stub) await stub.close();
    if (keep) log(`kept: ${scratch}`);
    else { try { rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* litter in tmp */ } }
    report.ms = Date.now() - t0;
  }
  return report;
}

// ── the report ───────────────────────────────────────────────────────────────

export function renderReport(r) {
  const out = [r.guard ?? "dev-rehearsal: (no guard line)"];
  out.push(`# dev rehearsal ${r.run}: ${r.green ? "GREEN" : "RED"}${r.ms != null ? ` (${Math.round(r.ms / 1000)} s)` : ""}`);
  for (const p of r.refused ?? []) out.push(`  refused: ${p}`);
  if (r.error) out.push(`THE REHEARSAL ${r.setup_failed ? "COULD NOT START" : "TRIPPED"}: ${r.error}`);
  for (const s of r.steps) {
    out.push(`${s.pending ? "…  " : s.ok ? "ok " : "RED"} ${s.id}: ${s.title}${s.ms != null ? ` (${Math.round(s.ms / 100) / 10} s)` : ""}`);
    if (s.pending) out.push(`      PENDING: ${s.pending}`);
    for (const n of s.notes ?? []) out.push(`      note: ${n}`);
    for (const f of s.findings ?? []) out.push(`      FINDING: ${f}`);
    for (const p of s.problems ?? []) out.push(`      ✗ ${p}`);
  }
  const red = r.steps.find((x) => !x.ok);
  out.push(r.green ? "GREEN: one crossing ran end to end through the dev office's doors and the store agreed at every step."
    : red ? `RED at ${red.id}: ${red.problems[0]}` : `RED: ${r.error ?? (r.refused ?? [])[0] ?? "no step ran"}`);
  return out.join("\n");
}

// ── CLI ──────────────────────────────────────────────────────────────────────

const USAGE = "usage: node tools/dev-rehearsal.mjs [--env-file <dev office env>] [--roles-file <pens env>] [--office <base url>] [--user meepo] [--only <step,…>] [--keep] [--json] [--report <file>]";

async function main(argv = process.argv.slice(2)) {
  if (argv.includes("--help") || argv.includes("-h")) { console.log(USAGE); return 0; }
  const known = new Set(["--env-file", "--roles-file", "--office", "--only", "--user", "--keep", "--json", "--report"]);
  for (const a of argv) if (a.startsWith("--") && !known.has(a)) { console.error(`unknown flag ${a}\n${USAGE}`); return 2; }
  const arg = (n, d = null) => { const i = argv.indexOf(n); return i === -1 ? d : argv[i + 1]; };
  const envFile = arg("--env-file", DEFAULT_ENV_FILE);
  if (!existsSync(envFile)) { console.error(`dev-rehearsal: REFUSED, no dev office env file at ${envFile}\n${USAGE}`); return 2; }
  let t;
  try { t = targetFromFiles({ envFile, rolesFile: arg("--roles-file", DEFAULT_ROLES_FILE), office: arg("--office", DEFAULT_OFFICE) }); }
  catch (e) { console.error(`dev-rehearsal: REFUSED, could not read ${envFile}: ${e.code ?? e.message}`); return 2; }
  // NEVER AS ROOT. The dev office's env file is root's (0600), but every write
  // the rehearsal makes on the dev clones must be meepo's: root-owned files there
  // stop the nightly freshen (the 2026-09-22 roll-call row, 1,918 of them). So
  // root reads the two files above and then becomes --user before anything runs.
  if (typeof process.getuid === "function" && process.getuid() === 0) {
    const user = arg("--user");
    if (!user) { console.log("dev-rehearsal: REFUSED, running as root with no --user: pass --user meepo (root reads the env files, then everything runs as that user, so the dev clones never gain root-owned files)"); return 2; }
    try { process.initgroups(user, user); process.setgid(user); process.setuid(user); }
    catch (e) { console.log(`dev-rehearsal: REFUSED, could not become ${user}: ${e.message}`); return 2; }
  }
  const json = argv.includes("--json");
  const only = arg("--only")?.split(",").map((x) => x.trim()).filter(Boolean) ?? null;
  // The guard's line is the first line of output in every mode, --json included (the JSON follows it).
  const report = await runRehearsal(t, { only, keep: argv.includes("--keep"), log: json ? (l) => { if (l.startsWith("dev-rehearsal: ")) console.log(l); } : (l) => console.log(l) });
  const text = renderReport(report);
  const reportPath = arg("--report");
  if (reportPath) writeFileSync(reportPath, (json ? JSON.stringify(report, null, 2) : text) + "\n");
  console.log(json ? JSON.stringify(report, null, 2) : `\n${text}`);
  return report.green ? 0 : report.setup_failed ? 2 : 1;
}

const isMain = (() => {
  if (!process.argv[1]) return false;
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return pathToFileURL(process.argv[1]).href === import.meta.url; }
})();
if (isMain) main().then((code) => process.exit(code), (e) => { console.error(String(e?.stack ?? e)); process.exit(2); });
