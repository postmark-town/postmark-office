// pos-1232-room-voices-http.test.mjs — THE OPT-IN ONE-ROOM PUBLIC VOICE READ, over the real public adapter (POS-1232; CORE-177's platform half).
//
// WHAT IS ASKED. `GET /world/conversations?room=<id>&room_voices=1` (optionally `&voices=<n>` for the page size and `&voices_before=<ms|ISO>` to continue) answers the room as it
// always did AND, beside the room header and its circles, `voices` (the LIST's own public say lines: full `said`, recorded `id` and `reply_to`, the producer's `circle`) and
// `voices_page` (total, served, cap, complete, and the cursor for the lines before). Without `room_voices=1` the answer is byte-for-byte what it was.
//
// THE WHOLE CHAIN, nothing stubbed between the request and the record: acts in a real Postgres -> the office's own server.mjs (spawned, loopback HTTP) -> the hearing
// reader's `git log` over an INVENTED world repo -> /world/conversations -> world2-serve.mjs -> conversations.mjs -> circles.mjs::findConversation -> the JSON a site reads.
// A second office without the store answers the same URL from memory and says so. Every name, row and commit is invented.
//
//   node --test test/pos-1232-room-voices-http.test.mjs
//
// FALSIFIERS (run, see the PR): take `room_voices` out of `findOf` (the wire-through) and the opt-in tests go red; serve circle stubs where the lines are and the uncut-opener and
// edges tests go red.

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tempDir } from "./helpers/temp-dir.mjs";
import { startStore } from "./helpers/embedded-store.mjs";
import { openOauthDb } from "../src/oauth.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tmp = tempDir("pos1232-http-");
const H = 3600_000, MIN = 60_000;
const iso = (ms) => new Date(ms).toISOString();
const S1 = Date.parse("2026-06-01T06:00:00.000Z"), S2 = S1 + 12 * H, S3 = S2 + 12 * H;

let s = null, skip = false, api = null;
const offices = {};
const ID = {};
const OPENER = `${"The lantern festival begins at dusk, and everyone who can carry a light is asked to bring one. ".repeat(6)}Bring a friend.`;   // far past an opener stub's cut
const ROOM_AT = S1 + H;          // whole seconds: the record rounds a say's instant to the second

function inventedWorld(dir) {
  mkdirSync(dir, { recursive: true });
  const git = (env, ...args) => execFileSync("git", ["-C", dir, ...args], { env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.test", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.test", ...env } });
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

/** One say into the store, as the door writes it (an optional recorded reply edge); returns its act number. */
async function say(name, atMs, actor, text, replyTo = null, x = 40000) {
  const payload = { text, place: "the green", aboard: false, ...(replyTo != null ? { reply_to: replyTo } : {}) };
  const { rows } = await api.query(`INSERT INTO acts (at, crossing, actor, action, class, payload, at_anchor, at_dx, at_dy)
    VALUES ($1::timestamptz, 0, $2, 'say', 'voice', $3::jsonb, 'world', $4, 0) RETURNING id`, [iso(atMs), actor, JSON.stringify(payload), x]);
  ID[name] = Number(rows[0].id);
  return ID[name];
}

before(async () => {
  try { s = await startStore({ db: "pos1232_http" }); } catch (e) { skip = String(e.message ?? e).slice(0, 120); return; }
  if (s.skip) { skip = s.skip; s = null; return; }
  api = await s.connect("office_api");
  // ONE CLOSED ROOM in the first settlement: an opener, replies three levels deep, a second top circle, and TWO says tied on one instant at the page boundary
  await say("a", ROOM_AT, "ann", OPENER);
  await say("b", ROOM_AT + 1 * MIN, "ben", "I will bring the red one.", ID.a);
  await say("c", ROOM_AT + 2 * MIN, "cy", "The red one from last year? It is beautiful.", ID.b);
  await say("d", ROOM_AT + 3 * MIN, "dee", "Count me in.", ID.a);
  await say("e", ROOM_AT + 4 * MIN, "eve", "Same here, on the east path.", ID.a);
  await say("f", ROOM_AT + 4 * MIN, "fay", "And me, tied on the very same second.", ID.a);
  await say("g", ROOM_AT + 5 * MIN, "gus", "A different question: who has the matches?");
  inventedWorld(join(tmp, "durable-world"));
  inventedWorld(join(tmp, "legacy-world"));
  // the memory office holds a short log of old talk with NO ids (the pre-circles shape): one room, three lines
  const log = join(tmp, "legacy-voices.jsonl");
  writeFileSync(log, ["x0", "x1", "x2"].map((h, i) => JSON.stringify({ at: iso(ROOM_AT + i * 5 * MIN), handle: h, text: `${h} said an old thing`, x: 100, y: 0, place: null, aboard: false })).join("\n") + "\n");
  await spawnOffice("durable", { WORLD2_PG: "1", WORLD2_PG_URL: s.url("office_api") });
  await spawnOffice("legacy", {}, log);
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
    if (r.status === 200 && r.body.settlement_since === iso(S3)) return r;
    await new Promise((ok) => setTimeout(ok, 250));
  }
  throw new Error("the office never read the sweeps");
}
let roomId = null;
async function room() {
  if (roomId) return roomId;
  const list = await untilEdges("durable", `/world/conversations?before=${encodeURIComponent("9999-12-31T23:59:59.999Z")}&closed=100&voices=100`);
  const hit = list.body.closed.find((c) => c.voices.some((v) => v.id === ID.a));
  assert.ok(hit, `the room is in the record's closed list: ${JSON.stringify(list.body.closed.map((c) => c.id))}`);
  return (roomId = hit.id);
}
const ids = (lines) => lines.map((l) => l.id);

test("OMITTED: without the opt-in the named read is the one it always was (no voices, no page), and `room_voices=0` is no opt-in", async (t) => {
  if (skip) return t.skip(skip);
  const id = await room();
  const plain = await getJson("durable", `/world/conversations?room=${encodeURIComponent(id)}`);
  assert.equal(plain.status, 200);
  assert.equal(plain.body.find.history === "complete" || plain.body.find.history === "folded", true, JSON.stringify(plain.body.find).slice(0, 200));
  assert.equal("voices" in plain.body.find, false, "the header's voices stay stripped");
  assert.equal("voices_page" in plain.body.find, false);
  assert.ok(plain.body.find.circles, "the keyless circles are as they were");
  const off = await getJson("durable", `/world/conversations?room=${encodeURIComponent(id)}&room_voices=0`);
  // the two reads differ only by the clock they were taken at
  const clockless = (body) => JSON.parse(JSON.stringify(body, (k, v) => (k === "now" || k === "evaluated_at" ? undefined : v)));
  assert.deepEqual(clockless(off.body), clockless(plain.body), "room_voices=0 is the same bytes");
});

test("OPT-IN through the public adapter: the canonical room's public lines: an UNCUT opener, multi-level replies, original ids/edges/classification, the room's identity", async (t) => {
  if (skip) return t.skip(skip);
  const id = await room();
  const r = await getJson("durable", `/world/conversations?room=${encodeURIComponent(id)}&room_voices=1&voices=100`);
  assert.equal(r.status, 200, JSON.stringify(r.body).slice(0, 300));
  const f = r.body.find;
  assert.equal(f.room.id, id, "the canonical room identity, the one the LIST names");
  assert.equal(f.source, "record");
  assert.ok(f.circles, "the room's circles are still there, beside the lines (never instead of them)");
  assert.deepEqual(ids(f.voices), [ID.a, ID.b, ID.c, ID.d, ID.e, ID.f, ID.g], "every line of the room, oldest first");
  const byId = Object.fromEntries(f.voices.map((v) => [v.id, v]));
  assert.equal(byId[ID.a].said, OPENER, "the opener is whole: not a stub's cut opener");
  assert.ok(byId[ID.a].said.length > 400);
  assert.deepEqual([byId[ID.b].reply_to, byId[ID.c].reply_to, byId[ID.d].reply_to, byId[ID.e].reply_to, byId[ID.f].reply_to, byId[ID.g].reply_to],
    [ID.a, ID.b, ID.a, ID.a, ID.a, undefined], "the recorded edges, as recorded (three levels: a <- b <- c)");
  assert.deepEqual([byId[ID.a].circle, byId[ID.b].circle, byId[ID.c].circle, byId[ID.d].circle, byId[ID.g].circle], [ID.a, ID.a, ID.a, ID.a, ID.g],
    "the producer's own circle classification, resolved over the whole room");
  for (const v of f.voices) for (const k of ["handle", "standing", "said", "at", "at_ms", "x", "y"]) assert.ok(k in v, `${k} is on every line`);
  assert.deepEqual({ ...f.voices_page, source: undefined }, { source: undefined, order: "oldest first", total: 7, served: 7, cap: 100, complete: true });
  assert.equal(f.room.voice_count, 7, "the header's own total agrees");
});

test("PAGING tells the truth and continues without loss or repetition, widening over a tie so a cursor never skips a line", async (t) => {
  if (skip) return t.skip(skip);
  const id = await room();
  const q = (extra = "") => getJson("durable", `/world/conversations?room=${encodeURIComponent(id)}&room_voices=1&voices=2${extra}`);
  const first = (await q()).body.find;
  assert.deepEqual(ids(first.voices), [ID.e, ID.f, ID.g], "cap 2, widened to take the line tied with f: the page is the newest lines, never half a tie");
  assert.deepEqual([first.voices_page.total, first.voices_page.served, first.voices_page.complete, first.voices_page.earlier.remaining], [7, 3, false, 4],
    "a partial page says it is partial: it is not all the replies and not the whole history");
  assert.match(first.voices_page.earlier.next, /voices_before=/);
  const walked = [...first.voices];
  let page = first;
  for (let hops = 0; page.voices_page.earlier && hops < 10; hops++) {
    page = (await q(`&voices_before=${page.voices_page.earlier.before_ms}`)).body.find;
    assert.ok(page.voices_page.later_not_served > 0, "a continuation page says the newer lines were left to the earlier pages");
    walked.unshift(...page.voices);
  }
  assert.deepEqual(ids(walked), [ID.a, ID.b, ID.c, ID.d, ID.e, ID.f, ID.g], "the pages together are the room: none lost, none repeated");
  assert.equal(page.voices_page.earlier, undefined, "the last page has nothing before it");
  assert.equal(walked.find((v) => v.id === ID.a).said, OPENER, "and the opener is whole on its page");
  // a requested page larger than the bound is capped, and the page says the cap it served
  const big = (await getJson("durable", `/world/conversations?room=${encodeURIComponent(id)}&room_voices=1&voices=100000`)).body.find;
  assert.equal(big.voices_page.cap, 400);
});

test("UNAVAILABLE stays honest: a room the record does not hold answers unavailable with no lines, opt-in or not", async (t) => {
  if (skip) return t.skip(skip);
  const r = await getJson("durable", `/world/conversations?room=t1-nobody&room_voices=1`);
  assert.equal(r.status, 200);
  assert.equal(r.body.find.history, "unavailable");
  assert.equal("voices" in r.body.find, false);
  assert.equal("voices_page" in r.body.find, false);
});

test("A CIRCLE read is unchanged by the opt-in (the lines are a room read's)", async (t) => {
  if (skip) return t.skip(skip);
  const r = await getJson("durable", `/world/conversations?circle=${ID.a}&room_voices=1`);
  assert.equal(r.status, 200);
  assert.ok(r.body.find.circle_read, "the circle read is served as ever");
  assert.equal("voices_page" in r.body.find, false);
});

test("PRE-CIRCLES and MEMORY: old lines with no ids stay without ids or circles (nothing invented), and the memory office says it is memory", async (t) => {
  if (skip) return t.skip(skip);
  const list = await untilEdges("legacy", `/world/conversations?closed=50&voices=50`);
  const hit = [...list.body.live, ...list.body.closed].find((c) => c.voices.some((v) => /x0 said/.test(v.said)));
  assert.ok(hit, "the memory office holds the old room");
  const r = await getJson("legacy", `/world/conversations?room=${encodeURIComponent(hit.id)}&room_voices=1`);
  assert.equal(r.status, 200);
  const f = r.body.find;
  assert.equal(f.source, "memory");
  assert.equal(f.voices_page.source, "memory", "the coverage says whose memory it is: never the record's history");
  assert.equal(f.voices.length, 3);
  for (const v of f.voices) { assert.equal("id" in v, false); assert.equal("reply_to" in v, false); assert.equal("circle" in v, false); }
  assert.deepEqual(f.voices.map((v) => v.said), ["x0 said an old thing", "x1 said an old thing", "x2 said an old thing"]);
});
