// pos-779-conversations-http.test.mjs — `GET /world/conversations` over HTTP: one thread per place per settlement, and "show earlier" (POS-779).
//
// The whole chain, nothing stubbed between the request and the record:
//
//   acts in a real Postgres  ->  the office's own server.mjs (spawned, loopback HTTP)
//     ->  the hearing reader's `git log` over an INVENTED world repo whose `settlement: sweep` commits are the edges
//     ->  /world/conversations?before=  ->  world2/tools/conversations.mjs  ->  the JSON the page script gets
//
// A second office, without the store, answers the same URL from memory and says so (`earlier.source`). Every row, handle and
// commit is invented.
//
//   node --test test/pos-779-conversations-http.test.mjs

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { startStore } from "./helpers/embedded-store.mjs";
import { openOauthDb } from "../src/oauth.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tmp = mkdtempSync(join(tmpdir(), "pos779-http-"));
const H = 3600_000, MIN = 60_000;
const iso = (ms) => new Date(ms).toISOString();
// three published sweeps, long enough ago that "now" is in the open epoch
const S1 = Date.parse("2026-06-01T06:00:00.000Z"), S2 = S1 + 12 * H, S3 = S2 + 12 * H;
const FAR = iso(S3 + 30 * H); // a cursor later than every voice: the first page of the record's closed threads
// what the conversations page asks with when its poll shows no finished thread to count back from (site index.astro EVER)
const EVER = "9999-12-31T23:59:59.999Z";

let s = null, skip = false, api = null;
const offices = {};

/** An invented world repo: a few ordinary commits and three `settlement: sweep` commits with the committer dates above. */
function inventedWorld(dir) {
  mkdirSync(dir, { recursive: true });
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

const existingOauthDb = (path) => { openOauthDb(path).close(); return path; };
function spawnOffice(name, extraEnv, voicesLog = join(tmp, `${name}-voices.jsonl`)) {
  const world = join(tmp, `${name}-world`);
  const child = spawn(process.execPath, [join(ROOT, "src", "server.mjs"), "--port", "0",
    "--oauth-db", existingOauthDb(join(tmp, `${name}-oauth.db`)), "--roles-db", join(tmp, `${name}-roles.db`)], {
    env: { ...process.env, WORLD_GRAPH_NONE: "1", WORLD_CLONE: world, TOWN_CLONE: join(tmp, "no-town-clone"), VOICES_LOG: voicesLog,
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

const PLACES = 6; // closed threads per settlement: more than one page of the size asked below
before(async () => {
  try { s = await startStore({ db: "pos779_http" }); } catch (e) { skip = String(e.message ?? e).slice(0, 120); return; }
  if (s.skip) { skip = s.skip; s = null; return; }
  api = await s.connect("office_api");
  const rows = [];
  const add = (at, actor, x, y, extra = {}) => rows.push({ at: iso(at), actor, x, y, payload: { text: `${actor} spoke`, place: "the quay", aboard: false, ...extra } });
  // settlement 1 and 2: PLACES places each, far apart; every place's voices are 20 minutes apart for two hours — past the old 30-minute lull in total
  for (let k = 0; k < PLACES; k++) for (let i = 0; i < 7; i++) add(S1 + H + k * MIN + i * 20 * MIN, `a${k}`, k * 1000, 0);
  for (let k = 0; k < PLACES; k++) for (let i = 0; i < 3; i++) add(S2 + H + k * MIN + i * 5 * MIN, `b${k}`, k * 1000, 5000);
  // the open settlement: one place, a pause of three hours in the middle (the old lull would have cut it in two)
  for (const dt of [0, 1 * MIN, 3 * H, 3 * H + MIN]) add(S3 + H + dt, `c${dt > H ? 1 : 0}`, 8000, 0);
  // two public circles 100 m apart, in settlement 2, and a voice from inside a room standing between them (it must not bridge them)
  add(S2 + 6 * H, "p0", 20000, 0); add(S2 + 6 * H + MIN, "p1", 20100, 0);
  add(S2 + 6 * H + 2 * MIN, "room0", 20050, 0, { room: "cellar" });
  // a long thread (100 voices) for the per-thread line cap, and one voice older than the oldest published sweep (not groupable)
  for (let i = 0; i < 100; i++) add(S2 + 8 * H + i * 20_000, "z0", 30000, 0);
  add(S1 - 3 * H, "old0", -9000, 0);
  await api.query(`INSERT INTO acts (at, crossing, actor, action, class, payload, at_anchor, at_dx, at_dy)
    SELECT (r->>'at')::timestamptz, 0, r->>'actor', 'say', 'voice', r->'payload', 'world', (r->>'x')::float, (r->>'y')::float
      FROM jsonb_array_elements($1::jsonb) AS r ORDER BY (r->>'at')::timestamptz`, [JSON.stringify(rows)]);
  inventedWorld(join(tmp, "durable-world"));
  inventedWorld(join(tmp, "legacy-world"));
  // the memory office holds a short log of its own
  const log = join(tmp, "legacy-voices.jsonl");
  writeFileSync(log, ["x0", "x1", "x2"].map((h, i) => JSON.stringify({ at: iso(S1 + H + i * 40 * MIN), handle: h, text: `${h} spoke`, x: i * 5000, y: 0, place: null, aboard: false })).join("\n") + "\n");
  await spawnOffice("durable", { WORLD2_PG: "1", WORLD2_PG_URL: s.url("office_api") });
  await spawnOffice("legacy", {}, log);
  // a store-engaged office whose MEMORY holds only the newest finished threads (settlement 2's talk, not settlement 1's)
  const partialLog = join(tmp, "partial-voices.jsonl");
  const mem = [];
  for (let k = 0; k < PLACES; k++) for (let i = 0; i < 3; i++) mem.push({ at: iso(S2 + H + k * MIN + i * 5 * MIN), handle: `b${k}`, text: "m", x: k * 1000, y: 5000 });
  mem.push({ at: iso(S2 + 6 * H), handle: "p0", text: "m", x: 20000, y: 0 }, { at: iso(S2 + 6 * H + MIN), handle: "p1", text: "m", x: 20100, y: 0 });
  for (let i = 0; i < 100; i++) mem.push({ at: iso(S2 + 8 * H + i * 20_000), handle: "z0", text: "m", x: 30000, y: 0 });
  writeFileSync(partialLog, mem.sort((x, y) => Date.parse(x.at) - Date.parse(y.at)).map((v) => JSON.stringify({ ...v, place: null, aboard: false })).join("\n") + "\n");
  inventedWorld(join(tmp, "partial-world"));
  await spawnOffice("partial", { WORLD2_PG: "1", WORLD2_PG_URL: s.url("office_api") }, partialLog);
});

after(async () => {
  for (const { child } of Object.values(offices)) if (child.exitCode === null) { const gone = new Promise((ok) => child.on("exit", ok)); child.kill(); await gone; }
  await api?.end().catch(() => {});
  await s?.stop?.();
  rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

const getJson = async (office, path) => { const r = await fetch(offices[office].base + path); return { status: r.status, body: await r.json() }; };
/** The reader reads git in the background at boot: ask until it has the newest sweep, within a bound. */
async function untilEdges(office, path) {
  for (let i = 0; i < 60; i++) {
    const r = await getJson(office, path);
    if (r.status === 200 && (r.body.settlement_since === iso(S3))) return r;
    await new Promise((ok) => setTimeout(ok, 250));
  }
  throw new Error("the office never read the sweeps");
}

/** Walk the record's closed threads page by page with the cursor each page hands back. */
async function walk(size) {
  const pages = [];
  let cursor = FAR;
  for (let hops = 0; cursor && hops < 20; hops++) {
    const r = await getJson("durable", `/world/conversations?before=${encodeURIComponent(cursor)}&closed=${size}`);
    assert.equal(r.status, 200);
    pages.push(r.body);
    cursor = r.body.earlier.remaining > 0 ? r.body.earlier.before : null;
  }
  return pages;
}

test("a thread spans its settlement: voices hours apart at one place are one thread, and a settlement splits them", async (t) => {
  if (skip) return t.skip(skip);
  const first = await untilEdges("durable", `/world/conversations?before=${encodeURIComponent(FAR)}&closed=100`);
  const closed = first.body.closed;
  const a0 = closed.filter((th) => th.participants.includes("a0"));
  assert.equal(a0.length, 1, "seven voices 20 minutes apart (two hours) at one place in one settlement are ONE thread: the old 30-minute lull made four");
  assert.equal(a0[0].voice_count, 7);
  const b0 = closed.filter((th) => th.participants.includes("b0"));
  assert.equal(b0.length, 1);
  assert.notEqual(a0[0].id, b0[0].id, "and the next settlement's talk at the same place is its own thread");
  // the open settlement: a three-hour pause inside it does not split it
  const live = (await getJson("durable", `/world/conversations?before=${encodeURIComponent(FAR)}`)).body;
  assert.deepEqual(live.live, [], "a page behind a cursor carries no live threads");
  assert.equal(first.body.settlement_since, iso(S3));
});

test("show earlier over HTTP reaches threads the first page does not hold, a page at a time, none twice and none missed", async (t) => {
  if (skip) return t.skip(skip);
  await untilEdges("durable", `/world/conversations?before=${encodeURIComponent(FAR)}&closed=100`);
  const everything = (await getJson("durable", `/world/conversations?before=${encodeURIComponent(FAR)}&closed=100`)).body.closed.map((th) => th.id);
  assert.ok(everything.length >= 2 * PLACES, `the record holds ${everything.length} closed threads, more than one page of 4`);
  const pages = await walk(4);
  assert.ok(pages.length >= 3, `${pages.length} pages of at most 4`);
  const seen = pages.flatMap((p) => p.closed.map((th) => th.id));
  assert.equal(new Set(seen).size, seen.length, "no thread on two pages");
  assert.deepEqual([...seen].sort(), [...everything].sort(), "every closed thread of the record is reached");
  for (const p of pages.slice(0, -1)) assert.ok(p.closed.length >= 4 && p.closed.length <= 4 + 1, "a page holds its page size (ties on the last instant aside)");
  assert.ok(pages.at(-1).closed.length > 0);
  assert.equal(pages.at(-1).earlier.remaining, 0, "the walk ends");
  // a page past the first holds threads absent from the first page
  const onFirst = new Set(pages[0].closed.map((th) => th.id));
  assert.ok(pages[1].closed.every((th) => !onFirst.has(th.id)));
  // newest first across the whole walk
  const latest = pages.flatMap((p) => p.closed.map((th) => Date.parse(th.latest)));
  assert.deepEqual(latest, [...latest].sort((x, y) => y - x));
  assert.equal(pages[0].earlier.source, "record");
});

test("a room's voice does not bridge two public circles in the record's page", async (t) => {
  if (skip) return t.skip(skip);
  await untilEdges("durable", `/world/conversations?before=${encodeURIComponent(FAR)}&closed=100`);
  const body = (await getJson("durable", `/world/conversations?before=${encodeURIComponent(FAR)}&closed=100`)).body;
  assert.equal(JSON.stringify(body).includes("room0"), false, "no private speaker anywhere in the body");
  const p0 = body.closed.find((th) => th.participants.includes("p0"));
  const p1 = body.closed.find((th) => th.participants.includes("p1"));
  assert.ok(p0 && p1);
  assert.notEqual(p0.id, p1.id, "p0 and p1 are 100 m apart, past earshot: two threads, with the cellar voice between them in no one's record");
});

test("a bad cursor is a 422 naming it", async (t) => {
  if (skip) return t.skip(skip);
  await untilEdges("durable", `/world/conversations?before=${encodeURIComponent(FAR)}`);
  const bad = await getJson("durable", "/world/conversations?before=not-a-time");
  assert.equal(bad.status, 422);
  assert.match(bad.body.defect, /cursor/);
});

test("without the store the same URL answers from memory and SAYS it is only memory", async (t) => {
  if (skip) return t.skip(skip);
  const r = await untilEdges("legacy", "/world/conversations");
  assert.equal(r.body.earlier.source, "memory");
  assert.match(r.body.earlier.note, /in-memory record/);
  const paged = await getJson("legacy", `/world/conversations?before=${encodeURIComponent(FAR)}&closed=2`);
  assert.equal(paged.status, 200);
  assert.equal(paged.body.earlier.source, "memory");
  assert.ok(paged.body.closed.length <= 2 + 1);
  assert.deepEqual(paged.body.live, []);
});

// ── POS-779 FIX: the record is reachable from the page's entry, whatever memory holds ─────────────────────────────────────────
// The page's poll is answered from the office's MEMORY; its "Show earlier" asks with the cursor the poll hands back (`earlier.before`,
// else EVER when memory shows no finished thread) and reads the RECORD behind it. These walk exactly that, on a store-engaged office.

test("empty memory: the poll shows nothing finished and says memory, yet the record is one cursor away and holds every finished thread", async (t) => {
  if (skip) return t.skip(skip);
  await untilEdges("durable", `/world/conversations?before=${encodeURIComponent(FAR)}`);
  const poll = (await getJson("durable", "/world/conversations?closed=40")).body;
  assert.deepEqual(poll.closed, [], "memory holds no finished thread");
  assert.equal(poll.earlier.source, "memory");
  assert.equal(poll.earlier.before, null, "memory has no cursor to count back from");
  const record = (await getJson("durable", `/world/conversations?closed=40&before=${encodeURIComponent(EVER)}`)).body;
  assert.equal(record.earlier.source, "record");
  assert.ok(record.closed.length >= 2 * PLACES + 2, `the record's finished threads: ${record.closed.length}`);
});

test("partial memory: memory holds one page or less, and the record's older threads are reached from its cursor and the walk comes back", async (t) => {
  if (skip) return t.skip(skip);
  await untilEdges("partial", `/world/conversations?before=${encodeURIComponent(FAR)}`);
  const poll = (await getJson("partial", "/world/conversations?closed=40")).body;
  assert.equal(poll.earlier.source, "memory");
  assert.equal(poll.earlier.remaining, 0, "memory has no more than this page");
  const inMemory = poll.closed.map((th) => th.id);
  assert.ok(inMemory.length >= PLACES + 2, `memory's finished threads: ${inMemory.length}`);
  assert.ok(poll.closed.every((th) => !th.participants.some((h) => h.startsWith("a"))), "settlement 1's talk is not in memory");
  // the entry: the cursor the poll hands back, whose page is the record's older threads
  const older = (await getJson("partial", `/world/conversations?closed=40&before=${encodeURIComponent(poll.earlier.before)}`)).body;
  assert.equal(older.earlier.source, "record");
  assert.equal(older.closed.length, PLACES, "settlement 1's six threads, unreachable from memory");
  assert.ok(older.closed.every((th) => th.participants.some((h) => h.startsWith("a"))));
  assert.ok(older.closed.every((th) => !inMemory.includes(th.id)), "none of memory's page repeated");
  // and back: from the record's page the walk re-enters at the newest by asking the poll's own URL again
  const again = (await getJson("partial", "/world/conversations?closed=40")).body;
  assert.deepEqual(again.closed.map((th) => th.id), inMemory, "the newest page is the poll's, unchanged");
});

test("the limit of the reach is in the record's answer, and reads the way the page looks for it", async (t) => {
  if (skip) return t.skip(skip);
  await untilEdges("durable", `/world/conversations?before=${encodeURIComponent(FAR)}`);
  const record = (await getJson("durable", `/world/conversations?closed=40&before=${encodeURIComponent(EVER)}`)).body;
  // the same pattern the page matches (site index.astro OLDER_NOTE): a producer rename reds here and not silently on the page
  const line = record.disclosed.find((d) => /before the oldest settlement this office has read/.test(d));
  assert.ok(line, "the older-than-the-sweeps line rides disclosed[]: " + JSON.stringify(record.disclosed));
  assert.match(line, /^1 of the \d+ voices come before the oldest settlement this office has read \(.+\), so their settlement is unknown and they are not grouped$/);
});

test("the per-thread line cap is the existing 80 on every road, with the thread's true count beside it", async (t) => {
  if (skip) return t.skip(skip);
  await untilEdges("durable", `/world/conversations?before=${encodeURIComponent(FAR)}`);
  const rec = (await getJson("durable", `/world/conversations?closed=40&before=${encodeURIComponent(EVER)}`)).body.closed.find((th) => th.participants.includes("z0"));
  assert.equal(rec.voice_count, 100);
  assert.equal(rec.voices.length, 80, "the record's default is 80, as the base's was");
  await untilEdges("partial", `/world/conversations?before=${encodeURIComponent(FAR)}`);
  const mem = (await getJson("partial", "/world/conversations?closed=40")).body.closed.find((th) => th.participants.includes("z0"));
  assert.equal(mem.voice_count, 100);
  assert.equal(mem.voices.length, 80, "and memory's");
});
