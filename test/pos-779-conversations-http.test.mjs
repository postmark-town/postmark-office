// pos-779-conversations-http.test.mjs — `GET /world/conversations` over HTTP, on the DEFAULT durable road (POS-779).
//
// The whole chain a page reaches, with nothing stubbed between the request and the record:
//
//   acts in a real Postgres  ->  the office's own server.mjs (spawned, loopback HTTP)
//     ->  the hearing reader's `git log` over an INVENTED world repo whose `settlement: sweep` commits are the edges
//     ->  world2/tools/convo-door.mjs  ->  convo-read / components / memo / pager  ->  the JSON a page script gets
//
// No flag is set beyond the ones an engaged office already carries (WORLD2_PG and its URL). A second office, without the
// store, answers the same URL from memory and says `incomplete_legacy`. All rows, handles and commits are invented.
//
//   node --test test/pos-779-conversations-http.test.mjs

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { startStore } from "./helpers/embedded-store.mjs";
import { openOauthDb } from "../src/oauth.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tmp = mkdtempSync(join(tmpdir(), "pos779-http-"));
const H = 3600_000;
const iso = (ms) => new Date(ms).toISOString();
// three published sweeps, long enough ago that "now" is in the open epoch
const S1 = Date.parse("2026-06-01T06:00:00.000Z"), S2 = S1 + 12 * H, S3 = S2 + 12 * H;

let s = null, skip = false, api = null;
const offices = {};

/** An invented world repo: a few ordinary commits and three `settlement: sweep` commits with the committer dates above. */
function inventedWorld(dir) {
  const git = (env, ...args) => execFileSync("git", ["-C", dir, ...args], { env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.test", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.test", ...env }, stdio: ["ignore", "pipe", "pipe"] });
  execFileSync("git", ["init", "-q", "-b", "main", dir]);
  const commit = (subject, at) => {
    writeFileSync(join(dir, "f.txt"), `${subject} ${at}\n`);
    git({}, "add", "f.txt");
    git({ GIT_AUTHOR_DATE: iso(at), GIT_COMMITTER_DATE: iso(at) }, "commit", "-q", "-m", subject);
  };
  commit("seed", S1 - 5 * H);
  for (const [i, at] of [S1, S2, S3].entries()) { commit(`settlement: sweep S${i + 1}`, at); commit(`ordinary work ${i}`, at + H); }
}

function spawnOffice(name, extraEnv) {
  const world = join(tmp, `${name}-world`);
  const child = spawn(process.execPath, [join(ROOT, "src", "server.mjs"), "--port", "0",
    "--oauth-db", existingOauthDb(join(tmp, `${name}-oauth.db`)), "--roles-db", join(tmp, `${name}-roles.db`)], {
    env: { ...process.env, WORLD_GRAPH_NONE: "1", WORLD_CLONE: world, TOWN_CLONE: join(tmp, "no-town-clone"), VOICES_LOG: join(tmp, `${name}-voices.jsonl`),
      TOWN_PUSH: "", WORLD_STORE_DB: join(tmp, "no-world.db"), OFFICE_READ_WORKERS: "0",
      WORLD2_PG: undefined, WORLD2_PG_URL: undefined, ...extraEnv },
    stdio: ["ignore", "pipe", "pipe"],
  });
  return new Promise((ok, no) => {
    const t = setTimeout(() => no(new Error(`${name}: the office never listened`)), 30_000);
    child.stdout.on("data", (d) => { const m = /listening on :(\d+)/.exec(String(d)); if (m) { clearTimeout(t); offices[name] = { child, base: `http://127.0.0.1:${m[1]}` }; ok(); } });
    child.on("exit", (c) => no(new Error(`${name}: the office exited early (${c})`)));
  });
}
const existingOauthDb = (path) => { openOauthDb(path).close(); return path; };

before(async () => {
  try { s = await startStore({ db: "pos779_http" }); } catch (e) { skip = String(e.message ?? e).slice(0, 120); return; }
  if (s.skip) { skip = s.skip; s = null; return; }
  api = await s.connect("office_api");
  const rows = [];
  const add = (at, actor, x, y, extra = {}) => rows.push({ at: iso(at), actor, x, y, payload: { text: `${actor} spoke`, place: "the quay", aboard: false, ...extra } });
  for (let i = 0; i < 4; i++) add(S1 + H + i * 60_000, `a${i}`, 0, 0);                  // epoch 1
  for (let i = 0; i < 6; i++) add(S2 + H + i * 60_000, `b${i}`, 0, 0);                  // epoch 2
  for (let i = 0; i < 2300; i++) add(S3 + H + i * 1000, `c${i % 5}`, 800, 800);         // the open epoch: a thread longer than RAM
  add(S3 + 2 * H, "d0", 4000, 0); add(S3 + 2 * H + 60_000, "d1", 4020, 0);
  add(S3 + 3 * H, "room0", 800, 800, { room: "cellar" });                                 // a private voice at the long thread's place
  await api.query(`INSERT INTO acts (at, crossing, actor, action, class, payload, at_anchor, at_dx, at_dy)
    SELECT (r->>'at')::timestamptz, 0, r->>'actor', 'say', 'voice', r->'payload', 'world', (r->>'x')::float, (r->>'y')::float
      FROM jsonb_array_elements($1::jsonb) AS r ORDER BY (r->>'at')::timestamptz`, [JSON.stringify(rows)]);
  for (const name of ["durable", "legacy"]) { const { mkdirSync } = await import("node:fs"); mkdirSync(join(tmp, `${name}-world`), { recursive: true }); }
  inventedWorld(join(tmp, "durable-world"));
  inventedWorld(join(tmp, "legacy-world"));
  await spawnOffice("durable", { WORLD2_PG: "1", WORLD2_PG_URL: s.url("office_api") });
  await spawnOffice("legacy", {});
});

after(async () => {
  for (const { child } of Object.values(offices)) if (child.exitCode === null) { const gone = new Promise((ok) => child.on("exit", ok)); child.kill(); await gone; }
  await api?.end().catch(() => {});
  await s?.stop?.();
  rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

const getJson = async (office, path) => { const r = await fetch(offices[office].base + path); return { status: r.status, body: await r.json() }; };
/** The reader reads git in the background at boot: ask until it has the sweeps (503 until then), within a bound. */
async function untilEdges(office, path = "/world/conversations") {
  for (let i = 0; i < 60; i++) {
    const r = await getJson(office, path);
    if (r.status === 200) return r;
    await new Promise((ok) => setTimeout(ok, 250));
  }
  throw new Error("the office never read the sweeps");
}

test("the default road: the engaged office reads the page from the record, edges from the world repo's sweep commits", async (t) => {
  if (skip) return t.skip(skip);
  const r = await untilEdges("durable");
  const b = r.body;
  assert.equal(b.hearable_since, iso(S3), "the newest sweep commit is the window's edge");
  assert.equal(b.list.history_from, iso(S1), "the oldest sweep the reader read is where grouping begins");
  assert.equal("incomplete_legacy" in b, false);
  assert.equal(b.live.length, 2, "the long thread and the small one; the cellar voice is not a third");
  const long = b.live.find((x) => x.voice_count === 2300);
  assert.ok(long, "a thread of 2,300 voices, more than the 2,000 RAM holds");
  assert.equal(long.voices.length, 80);
  assert.equal(JSON.stringify(b).includes("room0"), false, "no private speaker anywhere in the body");
  assert.deepEqual(b.closed.map((x) => x.voice_count), [6, 4], "the two earlier settlements, newest first");
  assert.ok(Array.isArray(b.pinned), "the office's own page fields still ride");
});

test("show earlier over HTTP reaches the first real voice of the long thread", async (t) => {
  if (skip) return t.skip(skip);
  const b = (await untilEdges("durable")).body;
  const long = b.live.find((x) => x.voice_count === 2300);
  let cursor = long.earlier, all = long.voices.map((v) => v.act_id), hops = 0;
  while (cursor) {
    const p = new URLSearchParams({ thread_of: long.thread_of, before: cursor, generation: long.generation, since: String(long.epoch.since), next: "open", limit: "200" });
    const r = await getJson("durable", `/world/conversations?${p}`);
    assert.equal(r.status, 200);
    all = [...r.body.voices.map((v) => v.act_id), ...all];
    cursor = r.body.earlier; hops += 1;
    assert.ok(hops < 20);
  }
  assert.equal(all.length, 2300);
  assert.equal(new Set(all).size, 2300);
  assert.equal(all[0], long.thread_of, "the walk ends at the thread's first real voice");
});

test("parameters are validated over HTTP: 422 names the field; the generic 404 is one body for every wrong anchor", async (t) => {
  if (skip) return t.skip(skip);
  await untilEdges("durable");
  const bad = await getJson("durable", "/world/conversations?voices=999");
  assert.equal(bad.status, 422);
  assert.match(bad.body.defect, /voices/);
  const p = (id) => new URLSearchParams({ thread_of: id, before: "1:1", generation: "a".repeat(32), since: String(S3), next: "open" });
  const a = await getJson("durable", `/world/conversations?${p("424242")}`);
  const b = await getJson("durable", `/world/conversations?${p("7")}`);
  assert.equal(a.status, 404);
  assert.deepEqual(a.body, b.body);
});

test("the lean summary and the cursor over HTTP", async (t) => {
  if (skip) return t.skip(skip);
  await untilEdges("durable");
  const lean = await getJson("durable", "/world/conversations?voices=0&limit=1&closed=1");
  assert.equal(lean.status, 200);
  assert.equal(lean.body.live.length, 1);
  assert.deepEqual(lean.body.live[0].voices, []);
  assert.ok(lean.body.next_threads.live, "one live thread was shown of two: the cursor goes on");
  const next = await getJson("durable", `/world/conversations?next_threads=${encodeURIComponent(lean.body.next_threads.live)}&voices=0`);
  assert.equal(next.status, 200);
  assert.equal(next.body.threads.length, 1);
  assert.equal(next.body.next_threads, null);
  assert.notEqual(next.body.threads[0].thread_of, lean.body.live[0].thread_of);
});

test("without the store the same URL answers from memory and SAYS it is the legacy read, with no stable ids or cursors", async (t) => {
  if (skip) return t.skip(skip);
  const r = await untilEdges("legacy");
  assert.equal(typeof r.body.incomplete_legacy, "string");
  assert.match(r.body.incomplete_legacy, /in-memory record/);
  for (const k of ["list", "next_threads", "settlement_since", "close_minutes_deprecated", "settlement_disclosed"]) assert.equal(k in r.body, false, k);
  for (const th of [...r.body.live, ...r.body.closed]) for (const k of ["thread_of", "generation", "epoch", "earlier"]) assert.equal(k in th, false, `legacy thread has no ${k}`);
  assert.equal(r.body.close_minutes, null);
});
