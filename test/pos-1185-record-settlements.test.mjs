// pos-1185-record-settlements.test.mjs — the conversations RECORD reads every published settlement, so no room is too old to open (POS-1185).
//
// LAW (Darko, 2026-11-22 11:44 EST): "The goal/floor is for everything to be readable and findable (no orphans)".
//
// The ear keeps the newest 60 published settlements (HEARING_HISTORY: hearing never reaches further). Until this, the record's
// conversations read used that same list, and a voice older than the oldest settlement a read knows is not grouped: on prod's
// record of 2026-11-22 that was 9,996 of 23,658 voices, every room older than about a month. The record now asks world main for
// EVERY sweep commit, once (hearing-window.mjs § recorded), and hearing's own list is untouched.
//
//   · the reader, over an invented world repo with 64 sweeps: hearing still keeps 60, the record gets all 64;
//   · THE WIRING, nothing stubbed: a spawned office over a real Postgres and that repo opens a room from before the 60 newest
//     sweeps by its id over HTTP, and its "show earlier" page says nothing is ungrouped.
//
//   node --import ./test/helpers/sparse-guard.mjs --test --test-concurrency=1 test/pos-1185-record-settlements.test.mjs

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tempDir } from "./helpers/temp-dir.mjs";
import { startStore } from "./helpers/embedded-store.mjs";
import { openOauthDb } from "../src/oauth.mjs";
import { createHearingWindow, publishedSettlementsAt, everyPublishedSettlementAt, HEARING_HISTORY } from "../src/hearing-window.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tmp = tempDir("pos1185-edges-");
const H = 3600_000, MIN = 60_000;
const iso = (ms) => new Date(ms).toISOString();
const SWEEPS = HEARING_HISTORY + 4;                                    // four more than the ear keeps
const FIRST = Date.parse("2026-06-01T06:00:00.000Z");
const sweepAt = (i) => FIRST + i * 12 * H;                             // sweep i, oldest 0
const NEWEST = sweepAt(SWEEPS - 1);

/** An invented world repo: `SWEEPS` `settlement: sweep` commits twelve hours apart, an ordinary commit after each. */
function inventedWorld(dir) {
  execFileSync("git", ["init", "-q", "-b", "main", dir]);
  const commit = (subject, at) => execFileSync("git", ["-C", dir, "commit", "-q", "--allow-empty", "-m", subject], {
    env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.test", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.test", GIT_AUTHOR_DATE: iso(at), GIT_COMMITTER_DATE: iso(at) },
    stdio: ["ignore", "ignore", "pipe"] });
  commit("seed", FIRST - 5 * H);
  for (let i = 0; i < SWEEPS; i++) { commit(`settlement: sweep ${i + 1} published`, sweepAt(i)); commit(`ordinary work ${i}`, sweepAt(i) + H); }
}
const WORLD = join(tmp, "world");
inventedWorld(WORLD);

test("the reader: hearing keeps the newest 60 sweeps; the record's list is every sweep world main holds", async () => {
  assert.equal((await publishedSettlementsAt(WORLD)).length, HEARING_HISTORY, "the ear's ask is bounded, as it was");
  const all = await everyPublishedSettlementAt(WORLD);
  assert.equal(all.length, SWEEPS);
  const h = createHearingWindow({ repo: WORLD });
  await h.refresh();
  assert.equal(h.settlements().length, HEARING_HISTORY, "hearing's own list is unchanged (CORE-97: HEARING_HISTORY published sweeps kept)");
  assert.equal(h.settlements()[0], sweepAt(SWEEPS - HEARING_HISTORY));
  assert.deepEqual(h.recorded(), Array.from({ length: SWEEPS }, (_, i) => sweepAt(i)), "the record's list reaches the first sweep");
});

test("the reader: the whole list is asked once, a later sweep reaches it through the minute's ask, and a whole ask that trips leaves the newest standing in", async () => {
  let clock = 1_000_000, wholeAsks = 0, trip = true;
  const newest = [sweepAt(5), sweepAt(4)];
  const h = createHearingWindow({ repo: "unused", clock: () => clock, refreshMs: 60_000,
    published: async () => newest[0], blessed: async () => null, history: async () => [...newest],
    everything: async () => { wholeAsks += 1; if (trip) throw new Error("git is stuck"); return [sweepAt(5), sweepAt(4), sweepAt(3), sweepAt(2), sweepAt(1), sweepAt(0)]; } });
  await h.refresh();
  assert.deepEqual(h.recorded(), [sweepAt(4), sweepAt(5)], "the whole ask tripped: the record has what hearing has, and no less");
  trip = false; clock += 60_000;
  await h.refresh();
  assert.equal(h.recorded().length, 6);
  newest.unshift(sweepAt(6)); clock += 60_000;
  await h.refresh();
  assert.deepEqual(h.recorded().at(-1), sweepAt(6), "a new sweep joins the record's list");
  assert.equal(wholeAsks, 2, "one trip, one answer, and never again");
});

// The independent review of 7ba23476, finding 5: the whole-history ask was awaited BEFORE the ask that opens the ear's window, so at a start
// hearing had no settlement edge until it answered. Hearing comes first: its window and its 60 are set while the whole ask is still out.
test("the reader: the ear has its window and its own list BEFORE the record's whole list has answered", async () => {
  let release = null, asked = false;
  const newest = [sweepAt(5), sweepAt(4)];
  const h = createHearingWindow({ repo: "unused",
    published: async () => newest[0], blessed: async () => null, history: async () => [...newest],
    everything: () => { asked = true; return new Promise((ok) => { release = () => ok([sweepAt(5), sweepAt(4), sweepAt(3)]); }); } });
  const refreshed = h.refresh();
  for (let i = 0; i < 50 && !asked; i++) await new Promise((ok) => setImmediate(ok));   // wait on the event: the whole ask has been made
  assert.equal(asked, true, "the whole list has been asked for, and has not answered");
  assert.equal(h.read()?.since, sweepAt(5), "the ear's window is already open: hearing never waits on the record's list");
  assert.deepEqual(h.settlements(), [sweepAt(4), sweepAt(5)], "and hearing has its own list");
  assert.deepEqual(h.recorded(), [sweepAt(4), sweepAt(5)], "the record has what hearing has until its own list answers");
  release();
  await refreshed;
  assert.deepEqual(h.recorded(), [sweepAt(3), sweepAt(4), sweepAt(5)]);
});

// ── THE WIRING: a spawned office, a real Postgres, the invented world ──
let s = null, skip = false, office = null, api = null;
const OLD = sweepAt(1) + 2 * H;          // a say in the second epoch: older than the 60 newest sweeps
const OLD_ROOM = `t${OLD}-ada`;

before(async () => {
  try { s = await startStore({ db: "pos1185_edges" }); } catch (e) { skip = String(e.message ?? e).slice(0, 160); return; }
  if (s.skip) { skip = s.skip; s = null; return; }
  api = await s.connect("office_api");
  const rows = [
    { at: iso(OLD), actor: "ada", x: 0, payload: { text: "said long ago", place: "the quay" } },
    { at: iso(OLD + 5 * MIN), actor: "bo", x: 10, payload: { text: "and answered", place: "the quay" } },
    { at: iso(NEWEST + 2 * H), actor: "cy", x: 9000, payload: { text: "said lately", place: "the green" } },
  ];
  await api.query(`INSERT INTO acts (at, crossing, actor, action, class, payload, at_anchor, at_dx, at_dy)
    SELECT (r->>'at')::timestamptz, 0, r->>'actor', 'say', 'voice', r->'payload', 'world', (r->>'x')::float, 0
      FROM jsonb_array_elements($1::jsonb) AS r ORDER BY (r->>'at')::timestamptz`, [JSON.stringify(rows)]);
  openOauthDb(join(tmp, "oauth.db")).close();
  const child = spawn(process.execPath, [join(ROOT, "src", "server.mjs"), "--port", "0", "--oauth-db", join(tmp, "oauth.db"), "--roles-db", join(tmp, "roles.db")], {
    env: { ...process.env, WORLD_GRAPH_NONE: "1", WORLD_CLONE: WORLD, TOWN_CLONE: join(tmp, "no-town-clone"), VOICES_LOG: join(tmp, "voices.jsonl"),
      TOWN_PUSH: "", WORLD_STORE_DB: join(tmp, "no-world.db"), OFFICE_READ_WORKERS: "0", WORLD2_PG: "1", WORLD2_PG_URL: s.url("office_api") },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise((ok, no) => {
    const t = setTimeout(() => no(new Error("the office never listened")), 30_000);
    child.stdout.on("data", (d) => { const m = /listening on :(\d+)/.exec(String(d)); if (m) { clearTimeout(t); office = { child, base: `http://127.0.0.1:${m[1]}` }; ok(); } });
    child.on("exit", (c) => no(new Error(`the office exited early (${c})`)));
  });
});
after(async () => {
  if (office?.child.exitCode === null) { const gone = new Promise((ok) => office.child.on("exit", ok)); office.child.kill(); await gone; }
  await api?.end().catch(() => {});
  await s?.stop?.();
  rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});
const getJson = async (path) => { const r = await fetch(office.base + path); return { status: r.status, body: await r.json() }; };

test("THE WIRING · over HTTP, a room from before the 60 newest settlements opens by its id, and the page behind the cursor says nothing is ungrouped", async (t) => {
  if (skip) return t.skip(skip);
  // the reader asks git in the background at boot: ask until this office's record has the whole list (the old room opens), within a bound
  let room = null;
  const read = () => room?.body?.settlement_since === iso(NEWEST) && room.body.find?.history === "complete";
  for (let i = 0; i < 80 && !read(); i++) {
    room = await getJson(`/world/conversations?room=${encodeURIComponent(OLD_ROOM)}`);
    if (!read()) await new Promise((ok) => setTimeout(ok, 250));
  }
  assert.equal(room.status, 200);
  assert.equal(room.body.find.history, "complete", 'LAW: "everything to be readable and findable (no orphans)" — a room older than the ear\'s 60 settlements opens');
  assert.equal(room.body.find.room.id, OLD_ROOM);
  assert.equal(room.body.find.room.voice_count, 2);
  assert.equal(room.body.settlement_since, iso(NEWEST));
  const page = await getJson(`/world/conversations?before=${encodeURIComponent("9999-12-31T23:59:59.999Z")}&closed=50`);
  assert.equal(page.status, 200);
  assert.ok(page.body.closed.some((c) => c.id === OLD_ROOM), "and it is on the record's page of closed rooms");
  assert.ok(!page.body.disclosed.some((d) => /before the oldest settlement this office has read/.test(d)), `no voice is left ungrouped: ${JSON.stringify(page.body.disclosed.slice(-2))}`);
});
