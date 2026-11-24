// pos1203-durable-rooms.test.mjs — fixed room records and an event's own window membership (POS-1203, CORE-170; migration 103).
//
// LAW (Darko, 2026-11-23 18:35 EST): "sparks, galleries, conversations, they should all be durable". Ruled at 19:40 EST as Rivet's packet recommends:
// a closed room is a FIXED RECORD (looked up, never recomputed); a room is fixed only when it TRULY closes (a settlement passed with no say in the hour
// after); an ended event keeps the rooms and says of ITS OWN WINDOW; a backfill goes back to the first say; no stopgap on the 60-settlement window.
//
// On invented speakers, marks and settlements, over a REAL Postgres (the migration's own file, applied by the store floor):
//   · the closing rule is hearing-window's ONE rule (a carried room is not closed by a settlement; closed an hour after one with no say);
//   · the replay writes closed rooms and ended events, and a DRY RUN writes nothing; run twice it writes nothing new and moves no id;
//   · a carried room keeps the id it had while open when it closes later, and the event that ended before it closed keeps only ITS window's says
//     (the later talk in the carried room never becomes its attendance: control for the leak);
//   · the OLD 60-SETTLEMENT EXPIRY (an event window older than the settlements this office has read answers unknown rooms and a null gallery) is
//     the control: with the event's rooms fixed the same read answers its rooms and its gallery;
//   · the conversations door answers a fixed room from the store, equal to the derivation's answer, and an id or alias only the store knows opens it;
//   · old talk without reply links stays a timeline, a say with no place and a say inside a dungeon's walls are never written, and the malformed
//     frame is FLAGGED and stored as derived, never repaired;
//   · the tables are insert only, and the migration is idempotent.
//
//   node --import ./test/helpers/sparse-guard.mjs --test --test-concurrency=1 test/pos1203-durable-rooms.test.mjs

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { startStore } from "./helpers/embedded-store.mjs";

process.env.WORLD_CLONE = join(tmpdir(), "postmark-no-world-clone-pos1203");
const env0 = { pg: process.env.WORLD2_PG, url: process.env.WORLD2_PG_URL };
process.env.WORLD2_PG = "1";
process.env.WORLD2_PG_URL = "postgres://pos-1203-test/none";
after(() => {
  if (env0.pg == null) delete process.env.WORLD2_PG; else process.env.WORLD2_PG = env0.pg;
  if (env0.url == null) delete process.env.WORLD2_PG_URL; else process.env.WORLD2_PG_URL = env0.url;
});

const D = await import("../src/durable-rooms.mjs");
const H0 = await import("../src/hearing-window.mjs");
const talk = await import("../world2/tools/conversations.mjs");
const serve = await import("../src/world2-serve.mjs");
const { replayRooms } = await import("../world2/tools/replay-rooms.mjs");
const { calendarAtOffice } = await import("../src/events-store.mjs");

const HERE = dirname(fileURLToPath(import.meta.url));
const H = 3600_000, MIN = 60_000;
const iso = (ms) => new Date(ms).toISOString();
const S1 = Date.parse("2026-10-01T06:00:00Z"), S2 = S1 + 12 * H, S3 = S2 + 12 * H, S4 = S3 + 12 * H;
const N1 = S3 + 10 * MIN;      // the third settlement has just passed: B (carried at S2) is still within its hour
const N2 = S4 + 2 * H;         // the fourth has passed and its hour ran out: B has truly closed

// ═══ the pure parts ═════════════════════════════════════════════════════════════════════
test("THE CLOSING RULE is hearing-window's one rule: not closed by a settlement alone, closed once the hour after it has gone with no say", () => {
  const edges = [S1, S2];
  const latest = S1 + 70 * MIN;
  assert.equal(D.isClosed(latest, S2 - MIN, edges), false, "no settlement has passed it yet");
  assert.equal(D.isClosed(latest, S2 + 30 * MIN, edges), false, "a settlement has passed, but its hour is not over: a say in it carries the room");
  assert.equal(D.isClosed(latest, S2 + H, edges), false, "exactly at the hour is still open (roomOpen: atMs - edge <= grace)");
  assert.equal(D.isClosed(latest, S2 + H + 1, edges), true, "the hour ran out with no say in it");
  assert.equal(D.closesAt(latest, edges), S2 + H);
  assert.equal(D.closesAt(S2 + 5 * MIN, edges), null, "no settlement has followed its newest say");
  for (const at of [S1 - H, latest, S2 - 1, S2, S2 + 30 * MIN, S2 + H, S2 + H + 1, S2 + 5 * H])
    assert.equal(D.isClosed(latest, at, edges), !H0.roomOpen(latest, at, edges), `one rule at ${iso(at)}`);
});

// ═══ the store ══════════════════════════════════════════════════════════════════════════
let s = null, skip = false, owner = null, office = null, pool = null;
const ID = {};

async function insertSay(name, at, actor, anchor, dx, payload = {}) {
  const { rows } = await owner.query(
    `INSERT INTO acts (at, crossing, actor, action, at_anchor, at_dx, at_dy, class, payload, inserted_at)
     VALUES ($1::timestamptz, 1, $2, 'say', $3, $4, 0, 'voice', $5::jsonb, $1::timestamptz) RETURNING id`,
    [iso(at), actor, anchor, dx, JSON.stringify({ text: `${name}: ${actor} speaks`, place: "the green", ...payload })]);
  ID[name] = Number(rows[0].id);
  return ID[name];
}
const mark = (slug, x, status = "standing", data = {}) => owner.query(
  `INSERT INTO marks (id, slug, kind, owner, geometry, bbox, status, data, locked_window)
   VALUES (gen_random_uuid(), $1, 'fixture', split_part($1, '/', 1), $2::jsonb, box(point(0,0), point(0,0)), $3, $4::jsonb, 1)`,
  [slug, JSON.stringify({ at: { x, y: 0 }, extent: { w: 4, h: 4 } }), status, JSON.stringify(data)]);

const LANTERN_X = 1000;
const EVENT = "quill/lantern-night";
const EVENT_2 = "quill/lantern-night-again";
const EVENT_FROM = S2 - H, EVENT_TO = S2 + 2 * H;

before(async () => {
  try { s = await startStore({ db: "pos1203_rooms" }); } catch (e) { skip = String(e.message ?? e).slice(0, 160); return; }
  if (s.skip) { skip = s.skip; s = null; return; }
  owner = await s.connect("world2_owner");
  office = await s.connect("office_api");
  await owner.query("INSERT INTO windows (id, opens_at, closes_at, status) VALUES (1, '2026-01-01', '2026-01-02', 'closed') ON CONFLICT DO NOTHING");
  await mark("the-town/earshot-m", 90_000, "standing", { slot: "earshot_m", value: "60", _parent_is_law: "the-town/say" });
  await mark("quill/west-bench", 0); await mark("quill/the-lantern", LANTERN_X); await mark("quill/the-barn", 5000); await mark("quill/far-pier", 30_000);
  // room A: old talk (no recorded room) in the first epoch, with a reply: a circle
  await insertSay("a1", S1 + 60 * MIN, "ann", "quill/west-bench", 0);
  await insertSay("a2", S1 + 65 * MIN, "ben", "quill/west-bench", 0, { reply_to: ID.a1 });
  await insertSay("a3", S1 + 70 * MIN, "ann", "quill/west-bench", 0);
  // room B: carried across S2 by a say in its hour, and again across S3: one room, one id, the whole while
  await insertSay("b1", S2 - 20 * MIN, "bea", "quill/the-lantern", 0, { place_mark: "quill/the-lantern" });
  await insertSay("b2", S2 + 30 * MIN, "cal", "quill/the-lantern", 5);
  // room C: old talk, a single say, no replies: a timeline
  await insertSay("c1", S1 + 2 * H, "cyd", "quill/the-barn", 0);
  // room D: two says that NAME one room from 30 km apart: a malformed frame, to be flagged and never repaired
  const DNAME = `t${S1 + 3 * H}-dee`;
  await insertSay("d1", S1 + 3 * H, "dee", "quill/west-bench", 0, { conversation: DNAME });
  await insertSay("d2", S1 + 3 * H + 5 * MIN, "eve", "quill/far-pier", 0, { conversation: DNAME });
  ID.DNAME = DNAME;
  // never written: a say inside a dungeon's walls (WLD-74), a say whose anchor is in no row (#351)
  await insertSay("hidden", S1 + 61 * MIN, "hob", "quill/west-bench", 0, { room: "quill/the-keep#cellar" });
  await insertSay("lost", S1 + 62 * MIN, "lux", "quill/no-such-mark", 0);
  // the event: doors open an hour before S2, ends two hours after it; its place is the lantern
  await owner.query(`INSERT INTO posts (id, class, title, body, author, household, place_mark, place_x, place_y, starts, ends, state, fields, revised, posted_act, last_act)
    VALUES ($1, 'event', 'Lantern night', '', 'quill', 'quill-house', NULL, $2, 0, $3, $4, 'announced', $5, 0, 1, 1)`,
    [EVENT, LANTERN_X, iso(EVENT_FROM), iso(EVENT_TO), JSON.stringify({ doors_open: iso(EVENT_FROM) })]);
  const { default: pg } = await import("pg");
  pool = new pg.Pool({ connectionString: s.url("office_api"), max: 3 });
});
after(async () => { await pool?.end(); await office?.end(); await owner?.end(); await s?.stop?.(); });

const count = async (table) => Number((await owner.query(`SELECT count(*) AS n FROM ${table}`)).rows[0].n);
const ask = (p, query, { at = N1, edges = [S1, S2, S3] } = {}) => serve.world2Serve("/world2/conversations", new URLSearchParams(`at=${iso(at)}&${query}`),
  { p, settlements: () => edges, hearingWindow: () => ({ since: edges.at(-1) }) });
const calendar = (edges, now) => calendarAtOffice({ event: EVENT }, { now, env: { ...process.env, WORLD2_PG: "1", WORLD2_PG_URL: s.url("office_api") }, settlements: async () => edges });

test("THE OLD 60-SETTLEMENT EXPIRY (the control): before anything is fixed, an event whose window is older than the settlements this office has read answers unknown rooms and a null gallery", async (t) => {
  if (skip) return t.skip(skip);
  const view = await calendar([S3, S4], N2);                       // the oldest settlement read is after the window's opening
  const ev = view.event.evidence;
  assert.equal(ev.room_history, "unavailable");
  assert.equal(ev.gallery, null);
  assert.match(ev.gallery_note, /unknown, not none/);
});

test("THE MIGRATION is idempotent and insert only: re-applying it changes nothing, and no role the office holds can edit or remove a fixed record", async (t) => {
  if (skip) return t.skip(skip);
  const sql = readFileSync(join(HERE, "..", "world2", "schema", "103_durable_rooms.sql"), "utf8");
  await owner.query(sql);
  await owner.query(sql);
  const priv = async (table, p) => (await owner.query("SELECT has_table_privilege('office_api', $1, $2) AS ok", [table, p])).rows[0].ok;
  for (const table of ["durable_rooms", "durable_room_says", "durable_event_memberships", "durable_event_rooms", "durable_event_room_says"]) {
    assert.equal(await priv(table, "SELECT"), true, `${table}: select`);
    assert.equal(await priv(table, "INSERT"), true, `${table}: insert`);
    assert.equal(await priv(table, "UPDATE"), false, `${table}: no update`);
    assert.equal(await priv(table, "DELETE"), false, `${table}: no delete`);
  }
  assert.equal((await owner.query("SELECT count(*)::int AS n FROM registry WHERE object LIKE 'durable\\_%'")).rows[0].n, 5, "five registry rows, none duplicated");
  // the box's own proof it landed (migrations-landed.mjs, run by the roll-call): its probe answers true here, as it must on the box after the file
  const { LANDED } = await import("../world2/tools/migrations-landed.mjs");
  assert.ok(LANDED["103_durable_rooms.sql"], "103 is on the landed list");
  assert.equal((await owner.query(`SELECT (${LANDED["103_durable_rooms.sql"].probe}) AS ok`)).rows[0].ok, true);
});

let derived = null, baseList = null;
test("BEFORE ANYTHING IS FIXED the door answers every room from the derivation (the baseline the fixed record must equal)", async (t) => {
  if (skip) return t.skip(skip);
  const r = await ask(pool, "closed=1000&voices=1000");
  assert.equal(r.code, 200, JSON.stringify(r.body).slice(0, 300));
  derived = Object.fromEntries([...r.body.live, ...r.body.closed].map((c) => [c.voices.map((v) => v.said.split(":")[0]).join(","), c]));
  for (const k of ["a1,a2,a3", "b1,b2", "c1", "d1,d2"]) assert.ok(derived[k], `the derivation holds the room ${k}: ${Object.keys(derived)}`);
  assert.equal(derived["b1,b2"].live, true, "at N1 the carried room is open (its hour after the third settlement is running)");
  assert.equal(derived["a1,a2,a3"].live, false);
  baseList = r.body;   // the whole page as the derivation gives it: the list over fixed rooms must equal it
});

test("THE DRY RUN writes nothing and says what it would", async (t) => {
  if (skip) return t.skip(skip);
  const report = await replayRooms(office, { edges: [S1, S2, S3], nowMs: N1, apply: false });
  assert.equal(report.mode, "dry-run");
  assert.equal(report.migration_landed, true);
  assert.deepEqual([report.rooms.derived, report.rooms.closed, report.rooms.open_or_carried, report.rooms.already_stored, report.rooms.to_write], [4, 3, 1, 0, 3]);
  assert.equal(report.rooms.timeline_only, 2, "C (one say) and D (named, no replies) have no reply links: timelines, never invented circles");
  assert.deepEqual(report.events, { ended: 1, already_fixed: 0, to_fix: 1, unknown: [], fixed: [], suspect_frames: [] });
  assert.equal(report.says.dungeon_interior_never_read, 1);
  assert.equal(report.says.unplaced, 1, "a say whose anchor is in no row is counted, never placed at the Origin");
  for (const t of ["durable_rooms", "durable_room_says", "durable_event_memberships", "durable_event_rooms", "durable_event_room_says"]) assert.equal(await count(t), 0, `${t} untouched`);
});

test("THE REPLAY writes the CLOSED rooms only (a carried room keeps its id and waits), flags the malformed frame without repairing it, and never writes an interior or unplaced say", async (t) => {
  if (skip) return t.skip(skip);
  const report = await replayRooms(office, { edges: [S1, S2, S3], nowMs: N1, apply: true });
  assert.deepEqual([report.written.rooms.inserted, report.written.rooms.existing, report.written.rooms.drift.length], [3, 0, 0]);
  const { rows } = await owner.query("SELECT * FROM durable_rooms ORDER BY first_at, id");
  assert.deepEqual(rows.map((r) => r.id).sort(), [derived["a1,a2,a3"].id, derived["c1"].id, derived["d1,d2"].id].sort(), "the ids the derivation issued, exactly");
  const a = rows.find((r) => r.id === derived["a1,a2,a3"].id);
  assert.equal(a.has_replies, true);
  assert.deepEqual(a.participants, ["ann", "ben"]);
  assert.equal(a.era, "live");
  assert.equal(a.closed_at.getTime(), S2 + H, "closed at the first settlement after its newest say, plus the hour");
  assert.equal(rows.find((r) => r.id === derived["c1"].id).has_replies, false, "old talk without replies stays a timeline");
  const d = rows.find((r) => r.id === ID.DNAME);
  assert.equal(d.span_m, 30_000);
  assert.match(d.frame_flag, /suspect frame: the bounds span 30000 m/);
  assert.deepEqual([d.x0, d.x1], [0, 30_000], "stored exactly as derived: flagged for judgment, never repaired");
  assert.deepEqual(report.suspect_frames.map((f) => f.id), [ID.DNAME]);
  const says = (await owner.query("SELECT act_id, room_id, ord FROM durable_room_says ORDER BY act_id")).rows;
  assert.equal(says.length, 3 + 1 + 2, "a1 a2 a3, c1, d1 d2");
  assert.ok(!says.some((x) => [ID.hidden, ID.lost, ID.b1, ID.b2, ID.b3].includes(Number(x.act_id))), "no interior say, no unplaced say, no say of the open room");
  assert.equal(new Set(says.map((x) => x.act_id)).size, says.length, "a say is in exactly one room");
  const grants = (await owner.query("SELECT count(*)::int AS n FROM durable_rooms WHERE source <> 'replay'")).rows[0].n;
  assert.equal(grants, 0);
});

test("THE EVENT'S OWN WINDOW is fixed when it ends: the carried room's says up to the window's end, flagged in or out of the window", async (t) => {
  if (skip) return t.skip(skip);
  const m = (await owner.query("SELECT * FROM durable_event_memberships WHERE event_id = $1", [EVENT])).rows[0];
  assert.equal(m.rooms_count, 1);
  assert.equal(m.history, "complete");
  assert.equal(m.window_from.getTime(), EVENT_FROM);
  assert.equal(m.window_to.getTime(), EVENT_TO);
  const rooms = (await owner.query("SELECT room_id, header FROM durable_event_rooms WHERE event_id = $1 ORDER BY ord", [EVENT])).rows;
  assert.deepEqual(rooms.map((r) => r.room_id), [derived["b1,b2"].id]);
  assert.equal(rooms[0].header.voice_count, 2, "the room as it stood at the window's end: b1 and b2");
  const said = (await owner.query("SELECT act_id, in_window FROM durable_event_room_says WHERE event_id = $1 ORDER BY act_id", [EVENT])).rows;
  assert.deepEqual(said.map((x) => Number(x.act_id)), [ID.b1, ID.b2]);
  assert.deepEqual(said.map((x) => x.in_window), [true, true]);
});

test("THE SECOND REPLAY writes nothing new and moves no id", async (t) => {
  if (skip) return t.skip(skip);
  const before = await owner.query("SELECT id, recorded_at FROM durable_rooms ORDER BY id");
  const again = await replayRooms(office, { edges: [S1, S2, S3], nowMs: N1, apply: true });
  assert.deepEqual([again.written.rooms.inserted, again.written.rooms.existing, again.written.rooms.says_inserted, again.written.rooms.drift.length], [0, 3, 0, 0]);
  assert.deepEqual(again.written.events, [], "the event is already fixed: nothing to write");
  assert.equal(again.events.already_fixed, 1);
  assert.deepEqual((await owner.query("SELECT id, recorded_at FROM durable_rooms ORDER BY id")).rows, before.rows);
  assert.equal(await count("durable_room_says"), 6);
});

test("THE LISTS READ FIXED ROOMS: the bare page and ?before= list the closed rooms from their records, equal to the derivation's page, with no room twice", async (t) => {
  if (skip) return t.skip(skip);
  const seen = [];
  const watching = { query: async (sql, params) => { seen.push(sql); return pool.query(sql, params); } };
  const list = await ask(watching, "closed=1000&voices=1000");
  assert.equal(list.code, 200);
  assert.ok(seen.some((q) => /FROM durable_rooms/.test(q)), "the closed rooms were listed from the store");
  assert.deepEqual(list.body, baseList, "the page over fixed rooms is the page the derivation gave before anything was fixed, byte for byte");
  const ids = [...list.body.live, ...list.body.closed].map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length, "no room twice (a fixed room and the derived one it stands for)");
  // paging: ?before= walks the same closed rooms, one a page, and lands where the full list does
  const walked = [];
  let cursor = null, pages = 0;
  for (; pages < 6; pages++) {
    const page = await ask(watching, `closed=1&voices=1000${cursor ? `&before=${encodeURIComponent(cursor)}` : ""}`);
    walked.push(...page.body.closed.map((c) => c.id));
    if (!page.body.earlier.remaining) break;
    cursor = page.body.earlier.before;
  }
  assert.deepEqual(walked, list.body.closed.map((c) => c.id), "the cursor pages the fixed rooms in the page's own order");
  // a COLD START (a pool that has kept nothing) and MOVED ANCHORS: the fixed rooms keep the ids and the places they were fixed with, and the list agrees with the room's own read
  const { default: pg } = await import("pg");
  const cold = new pg.Pool({ connectionString: s.url("office_api"), max: 2 });
  await owner.query("UPDATE marks SET geometry = $2::jsonb WHERE slug = $1", ["quill/west-bench", JSON.stringify({ at: { x: 40, y: 0 }, extent: { w: 4, h: 4 } })]);
  try {
    const moved = await ask(cold, "closed=1000&voices=1000");
    assert.deepEqual(moved.body.closed.map((c) => c.id), list.body.closed.map((c) => c.id), "the same ids after a cold start and a moved anchor");
    for (const c of moved.body.closed) {
      const detail = await ask(cold, `room=${c.id}&voices=1000`);
      const pick = ({ id, extent, at, voice_count, participants, started, latest }) => ({ id, extent, at, voice_count, participants, started, latest });
      assert.deepEqual(pick(c), pick(detail.body.find.room), `the list's header is the room's own read's: ${c.id}`);
    }
    const a = moved.body.closed.find((c) => c.id === derived["a1,a2,a3"].id);
    assert.equal(a.extent.x0, 0, "the place it was fixed with, not the anchor's new composition");
  } finally {
    await owner.query("UPDATE marks SET geometry = $2::jsonb WHERE slug = $1", ["quill/west-bench", JSON.stringify({ at: { x: 0, y: 0 }, extent: { w: 4, h: 4 } })]);
    await cold.end();
  }
});

test("THE GALLERY OUTLIVES THE 60-SETTLEMENT WINDOW: the same read that answered unknown now answers the event's room and its gallery, whatever settlements this office has read", async (t) => {
  if (skip) return t.skip(skip);
  const view = await calendar([S3, S4], N2);
  const ev = view.event.evidence;
  assert.equal(ev.room_history, "complete");
  assert.deepEqual(ev.rooms.map((r) => r.id), [derived["b1,b2"].id]);
  assert.equal(ev.rooms[0].voice_count, 2, "its own window's talk: the later carried say is not its attendance");
  assert.deepEqual(ev.gallery, { rooms: [derived["b1,b2"].id], sparks: [] }, "a gallery of the event's room (no spark has been made: known none, not unknown)");
  assert.equal(ev.gallery_note, undefined);
  assert.equal(ev.complete, true);
});

test("A CARRIED ROOM KEEPS ITS ID WHEN IT CLOSES, and the event that ended before it closed keeps only its own window", async (t) => {
  if (skip) return t.skip(skip);
  // the third settlement has passed, and somebody speaks in the room within its hour: the room carries on, under the same id
  await insertSay("b3", S3 + 30 * MIN, "bea", "quill/the-lantern", 0);
  // a second event, with the same window and place, that nobody fixed while it was fresh: it is fixed NOW, after the room's later talk exists
  await owner.query(`INSERT INTO posts (id, class, title, body, author, household, place_mark, place_x, place_y, starts, ends, state, fields, revised, posted_act, last_act)
    VALUES ($1, 'event', 'Lantern night, again', '', 'quill', 'quill-house', NULL, $2, 0, $3, $4, 'announced', $5, 0, 1, 1)`,
    [EVENT_2, LANTERN_X, iso(EVENT_FROM), iso(EVENT_TO), JSON.stringify({ doors_open: iso(EVENT_FROM) })]);
  const report = await replayRooms(office, { edges: [S1, S2, S3, S4], nowMs: N2, apply: true });
  assert.deepEqual([report.written.rooms.inserted, report.written.rooms.existing], [1, 3], "the room that had carried is now closed and written; the rest are untouched");
  assert.equal(report.events.ended, 2);
  const b = (await owner.query("SELECT * FROM durable_rooms WHERE id = $1", [derived["b1,b2"].id])).rows[0];
  assert.ok(b, "the id it had while it was open and carried");
  assert.equal(b.voice_count, 3, "its whole life: b1, b2 and the say in the hour after the third settlement");
  assert.equal(b.latest_at.getTime(), S3 + 30 * MIN);
  assert.equal(b.closed_at.getTime(), S4 + H);
  // THE LEAK CONTROL: the event's membership did not change when the room's later talk landed
  const said = (await owner.query("SELECT act_id FROM durable_event_room_says WHERE event_id = $1 ORDER BY act_id", [EVENT])).rows.map((x) => Number(x.act_id));
  assert.deepEqual(said, [ID.b1, ID.b2], "b3 spoke in the same room after the event ended: it is not the event's");
  const view = await calendar([S3, S4], N2);
  assert.equal(view.event.evidence.rooms[0].voice_count, 2);
  assert.equal(view.event.evidence.rooms[0].latest, iso(S2 + 30 * MIN), "the room as it stood at the window's end");
  // and an event fixed only AFTER that talk exists (the backfill's case) takes its window's says, not the room's whole life
  assert.equal(report.events.fixed.includes(EVENT_2), true);
  const late = (await owner.query("SELECT act_id, in_window FROM durable_event_room_says WHERE event_id = $1 ORDER BY act_id", [EVENT_2])).rows;
  assert.deepEqual(late.map((x) => Number(x.act_id)), [ID.b1, ID.b2], "b3 is the room's, not this event's attendance");
  const late2 = (await owner.query("SELECT header FROM durable_event_rooms WHERE event_id = $1", [EVENT_2])).rows[0];
  assert.equal(late2.header.voice_count, 2);
});

test("THE DOOR answers a fixed room from the store, equal to the derivation's answer, by id, by a say in it, and by an alias only the store knows", async (t) => {
  if (skip) return t.skip(skip);
  const opts = { at: N2, edges: [S1, S2, S3, S4] };
  const room = derived["a1,a2,a3"];
  const viaDerivation = await ask(pool, `room=${room.id}&voices=1000`, { at: N1, edges: [S1, S2, S3] });     // a store with nothing stored for it answers as ever
  // the kept rooms answer too: remove the fixed row's effect by asking a pool whose first query shows the lookup
  const seen = [];
  const watching = { query: async (sql, params) => { seen.push(sql); return pool.query(sql, params); } };
  const viaStore = await ask(watching, `room=${room.id}&voices=1000`, { at: N1, edges: [S1, S2, S3] });
  assert.equal(viaStore.code, 200);
  assert.ok(seen.some((q) => /FROM durable_rooms/.test(q)), "the closed room was looked up in the store");
  assert.deepEqual(viaStore.body.find, viaDerivation.body.find, "the answer is the one the derivation gives, byte for byte");
  // a circle read: the say's id opens the room's circle
  const circle = await ask(watching, `circle=${ID.a1}&voices=1000`, { at: N1, edges: [S1, S2, S3] });
  assert.equal(circle.code, 200);
  assert.ok(circle.body.find?.circle_read || circle.body.find?.thread || circle.body.find, JSON.stringify(circle.body.find).slice(0, 200));
  // an alias that only the record holds: nothing derived knows it
  const alias = "t1700000000000-legacy";
  const none = await ask(pool, `room=${alias}`, { at: N1, edges: [S1, S2, S3] });
  assert.ok(none.body.find.refused || none.body.find.found === false || !none.body.find.thread, `an unissued id opens nothing: ${JSON.stringify(none.body.find).slice(0, 160)}`);
  await owner.query("UPDATE durable_rooms SET aliases = aliases || $2::text[], keys = keys || ARRAY['1700000000-legacy'] WHERE id = $1", [room.id, [alias]]);
  const issued = await ask(pool, `room=${alias}`, { at: N1, edges: [S1, S2, S3] });
  assert.equal(issued.code, 200);
  assert.equal(issued.body.find.room.id, room.id, "the issued alias opens the fixed room");
  assert.equal(issued.body.find.history, "complete");
  void opts;
});

test("A FIXED ROOM READS AS IT WAS WHEN IT CLOSED: each say's recorded place, not what its anchor composes to now", async (t) => {
  if (skip) return t.skip(skip);
  const room = derived["c1"];
  const before = await ask(pool, `room=${room.id}&voices=1000`, { at: N1, edges: [S1, S2, S3] });
  // a room read's header carries where its newest say was (`at`) and its bounds, both from the says' recorded places
  assert.deepEqual([before.body.find.room.at.x, before.body.find.room.extent.x0], [5000, 5000]);
  await owner.query("UPDATE durable_room_says SET x = 5555 WHERE act_id = $1", [ID.c1]);
  const after = await ask(pool, `room=${room.id}&voices=1000`, { at: N1, edges: [S1, S2, S3] });
  assert.deepEqual([after.body.find.room.at.x, after.body.find.room.extent.x0], [5555, 5555], "the stored place is the room's: the record, not a recomposition");
  await owner.query("UPDATE durable_room_says SET x = 5000 WHERE act_id = $1", [ID.c1]);
});

test("THE COMPLETION'S FREEZE (event-sparks § freezeEventRooms) fixes an event as it ends, never throws, and leaves a fixed event exactly as it is", async (t) => {
  if (skip) return t.skip(skip);
  const { eventEvidence, freezeEventRooms } = await import("../src/event-sparks.mjs");
  const { rowOf, POST_COLUMNS } = await import("../src/events-store.mjs");
  const id = "quill/lantern-night-third";
  await owner.query(`INSERT INTO posts (id, class, title, body, author, household, place_mark, place_x, place_y, starts, ends, state, fields, revised, posted_act, last_act)
    VALUES ($1, 'event', 'Lantern night, third', '', 'quill', 'quill-house', NULL, $2, 0, $3, $4, 'announced', $5, 0, 1, 1)`,
    [id, LANTERN_X, iso(EVENT_FROM), iso(EVENT_TO), JSON.stringify({ doors_open: iso(EVENT_FROM) })]);
  const row = rowOf((await owner.query(`SELECT ${POST_COLUMNS} FROM posts WHERE id = $1`, [id])).rows[0]);
  const env = { ...process.env, WORLD2_PG: "1", WORLD2_PG_URL: s.url("office_api") };
  const collect = {};
  const evidence = await eventEvidence(office, row, { now: N2, edges: [S1, S2, S3, S4], collect });
  assert.equal(evidence.room_history, "complete");
  assert.ok(collect.membership, "the evidence handed what the event fixes beside itself");
  assert.equal("members" in evidence || "membership" in evidence, false, "and not inside it: the public envelope is unchanged");
  const first = await freezeEventRooms(row, collect, { env });
  assert.equal(first.froze, true, JSON.stringify(first));
  assert.deepEqual((await owner.query("SELECT act_id FROM durable_event_room_says WHERE event_id = $1 ORDER BY act_id", [id])).rows.map((x) => Number(x.act_id)), [ID.b1, ID.b2]);
  const again = await freezeEventRooms(row, collect, { env });
  assert.deepEqual([again.froze, again.existing], [true, true], "fixed once: a second freeze writes nothing");
  assert.equal(await count("durable_event_rooms") >= 3, true);
  // a freeze that cannot write answers by name and NEVER throws: the completion must not wait on it
  const dup = { membership: { ...collect.membership, rooms: [collect.membership.rooms[0], collect.membership.rooms[0]] } };   // the same room twice: the store refuses it
  const gone = await freezeEventRooms({ ...row, id: "quill/never" }, dup, { env });
  assert.equal(gone.froze, false);
  assert.equal(typeof gone.error, "string");
  assert.equal(await count("durable_event_memberships") >= 1, true);
  assert.equal((await owner.query("SELECT count(*)::int AS n FROM durable_event_memberships WHERE event_id = 'quill/never'")).rows[0].n, 0, "the failed freeze rolled back whole: no half record");
  assert.deepEqual(await freezeEventRooms(row, {}, { env }), { froze: false, why: "nothing to fix (not ended, already fixed, or its rooms cannot be told)" });
  // an event that has not ended yet fixes nothing (no collect at all while its window is open)
  const open = {};
  await eventEvidence(office, { ...row, ends: iso(N2 + 30 * H) }, { now: N2, edges: [S1, S2, S3, S4], collect: open });
  assert.equal(open.membership, undefined);
});

test("THE REPLAY REFUSES to write when migration 103 has not landed, and says so (a dry run still reports)", async (t) => {
  if (skip) return t.skip(skip);
  D.__forgetLandedForTest();
  const fakeClient = { query: async (sql, params) => (/to_regclass/.test(sql) ? { rows: [{ ok: false }] } : office.query(sql, params)) };
  const dry = await replayRooms(fakeClient, { edges: [S1, S2, S3, S4], nowMs: N2, apply: false });
  assert.equal(dry.migration_landed, false);
  await assert.rejects(replayRooms(fakeClient, { edges: [S1, S2, S3, S4], nowMs: N2, apply: true }), /migration 103 \(durable rooms\) has not landed: nothing was written/);
  D.__forgetLandedForTest();
});

// ═══ the recurring producer (the keeping tick's step) ═══════════════════════════════════
// The tick's own caller is deploy/office-keep.sh → deploy/durable-rooms-pass.mjs → src/durable-keep.mjs § keepDurable. The shell's wiring is pinned in
// test/office-keep-receipt.test.mjs (a tick that does not call the pass fails there); these run the pass and the producer itself, over the real store.
const EVENT_FREE = "quill/barn-dance";          // a FREE event, no stake: outside DUE_EVENTS_SQL and the drafts cohort entirely (nothing configured)
const EVENT_ODD = "quill/bench-and-pier";        // an event whose room's bounds are malformed (the named 30 km room)
const E_FROM = S3 + 2 * H, E_TO = S3 + 4 * H;
const penOver = (state) => ({
  officeRead: async (fn) => fn(office),
  officeWrite: async (fn) => {
    state.writes += 1;
    if (state.failing) throw Object.assign(new Error("the store refused"), { code: "XX000" });
    await office.query("BEGIN");
    try { const out = await fn(office); await office.query("COMMIT"); return out; } catch (e) { await office.query("ROLLBACK"); throw e; }
  },
});

test("THE PRODUCER fixes a newly closed room and an ended event OUTSIDE the financial cohort, reports a failed write, retries it on the next tick, and then writes nothing it already wrote", async (t) => {
  if (skip) return t.skip(skip);
  const { keepDurable } = await import("../src/durable-keep.mjs");
  const edges = [S1, S2, S3, S4];
  // a room that spoke after the third settlement and was never carried: closed at the fourth settlement's hour
  await insertSay("e1", S3 + 3 * H, "fay", "quill/the-barn", 0, {});
  await insertSay("e2", S3 + 3 * H + 5 * MIN, "gus", "quill/the-barn", 0, { reply_to: ID.e1 });
  const post = (id, title, x, from, to) => owner.query(`INSERT INTO posts (id, class, title, body, author, household, place_mark, place_x, place_y, starts, ends, state, fields, revised, posted_act, last_act)
    VALUES ($1, 'event', $2, '', 'quill', 'quill-house', NULL, $3, 0, $4, $5, 'announced', $6, 0, 1, 1)`, [id, title, x, iso(from), iso(to), JSON.stringify({ doors_open: iso(from) })]);
  await post(EVENT_FREE, "Barn dance", 5000, E_FROM, E_TO);
  const oddFrom = S1 + 3 * H - 30 * MIN;
  await post(EVENT_ODD, "Bench and pier", 0, oddFrom, oddFrom + H);
  const { DUE_EVENTS_SQL } = await import("../deploy/event-sparks-pass.mjs");
  const due = (await owner.query(DUE_EVENTS_SQL, [iso(N2), null])).rows.map((r) => r.id);
  assert.ok(!due.includes(EVENT_FREE) && !due.includes(EVENT_ODD), "neither is due for the money's pass: no stake, no drafts cutoff configured");

  const rooms0 = await count("durable_rooms"), events0 = await count("durable_event_memberships");
  const state = { writes: 0, failing: true };
  // TICK 1: the store refuses the writes. Reported, nothing half-written, nothing thrown
  const one = await keepDurable({ edges, nowMs: N2, pen: penOver(state) });
  assert.equal(one.landed, true);
  assert.equal(one.rooms.to_write, 1, "the one room that has closed and is not stored (e1, e2)");
  assert.equal(one.events.to_fix, 2);
  assert.deepEqual([one.rooms.failed.length, one.events.failed.length, one.wrote], [1, 2, false], JSON.stringify(one.rooms.failed));
  assert.deepEqual([await count("durable_rooms"), await count("durable_event_memberships")], [rooms0, events0], "a failed tick leaves the store as it was");
  // TICK 2: the next tick asks again, and it lands
  state.failing = false; state.writes = 0;
  const two = await keepDurable({ edges, nowMs: N2, pen: penOver(state) });
  assert.deepEqual([two.rooms.failed.length, two.events.failed.length, two.rooms.written.inserted, two.events.fixed.length, two.wrote], [0, 0, 1, 2, true]);
  assert.deepEqual([await count("durable_rooms"), await count("durable_event_memberships")], [rooms0 + 1, events0 + 2]);
  const e1room = (await owner.query("SELECT * FROM durable_rooms WHERE first_at = $1", [iso(S3 + 3 * H)])).rows[0];
  assert.equal(e1room.source, "live");
  assert.equal(e1room.closed_at.getTime(), S4 + H);
  assert.deepEqual((await owner.query("SELECT act_id FROM durable_room_says WHERE room_id = $1 ORDER BY ord", [e1room.id])).rows.map((r) => Number(r.act_id)), [ID.e1, ID.e2]);
  assert.deepEqual(two.events.suspect_frames.map((f) => [f.event, f.room, f.span_m]), [[EVENT_ODD, ID.DNAME, 30_000]], "the tick that fixes an event holding the malformed frame names it");
  const free = (await owner.query("SELECT * FROM durable_event_memberships WHERE event_id = $1", [EVENT_FREE])).rows[0];
  assert.deepEqual([free.rooms_count, free.source, free.window_to.getTime()], [1, "live", E_TO]);
  // TICK 3: NEW ONLY. Everything is stored, so nothing is handed to a write at all (no transaction, however much history there is)
  state.writes = 0;
  const three = await keepDurable({ edges, nowMs: N2, pen: penOver(state) });
  assert.equal(state.writes, 0, "no write was even opened: the stored rooms and events are filtered out before it");
  assert.deepEqual([three.rooms.to_write, three.events.to_fix, three.wrote], [0, 0, false]);
  assert.equal(three.rooms.already_stored, three.rooms.closed);
});

test("THE PRODUCER runs as the tick runs it: the pass, over the real pen as office_api, answers by exit code, and its line carries counts and ids, never a say's words", async (t) => {
  if (skip) return t.skip(skip);
  const pass = await import("../deploy/durable-rooms-pass.mjs");
  const env = { ...process.env, WORLD2_PG: "1", WORLD2_PG_URL: s.url("office_api") };
  const run = async (opts) => {
    const lines = [], errs = [];
    const log = console.log, err = console.error;
    console.log = (l) => lines.push(l); console.error = (l) => errs.push(l);
    try { const code = await pass.main(["--world", "/nowhere"], env, opts); return { code, lines, errs }; } finally { console.log = log; console.error = err; }
  };
  // a new room closes: the real pen, the real store, the real clock (every settlement here is long past)
  await insertSay("f1", S4 + 3 * H, "hal", "quill/the-barn", 0, {});
  const real = await run({ settlementsOf: async () => [S1, S2, S3, S4, S4 + 12 * H] });
  assert.equal(real.code, 0, real.errs.join("\n"));
  const line = JSON.parse(real.lines[0]);
  assert.equal(line.durable_rooms.fixed_now, 1, "f1: a room of its own, closed once the next settlement and its hour passed");
  assert.equal((await owner.query("SELECT count(*)::int AS n FROM durable_room_says WHERE act_id = $1", [ID.f1])).rows[0].n, 1);
  assert.ok(!/speaks/.test(real.lines.join("\n")), "the line names no say's words");
  assert.deepEqual(line.suspect_frames, [], "the line reports the frames it fixed THIS tick (the malformed one was named when it was fixed; the replay's dry run lists it for judgment)");
  const again = await run({ settlementsOf: async () => [S1, S2, S3, S4, S4 + 12 * H] });
  assert.equal(JSON.parse(again.lines[0]).durable_rooms.fixed_now, 0);
  assert.equal(again.code, 0);
  // the exit codes the shell maps: nothing to tell (3), the world's settlements unreadable (1), a failed write (1), a stored record that differs (1)
  assert.equal((await run({ settlementsOf: async () => [] })).code, 3);
  assert.equal((await run({ settlementsOf: async () => { throw new Error("no repo"); } })).code, 1);
  assert.equal((await run({ settlementsOf: async () => [S1], keep: async () => ({ landed: false }) })).code, 3);
  const failed = await run({ settlementsOf: async () => [S1], keep: async () => ({ landed: true, rooms: { failed: [{ id: "x" }], drift: [] }, events: { failed: [] } }) });
  assert.equal(failed.code, 1);
  assert.match(failed.errs.join("\n"), /the next tick asks again/);
  assert.equal((await run({ settlementsOf: async () => [S1], keep: async () => ({ landed: true, rooms: { failed: [], drift: [{ id: "x", why: "y" }] }, events: { failed: [] } }) })).code, 1);
});

test("THE FLAG TRAVELS: an event that holds the malformed frame fixes it WITH its flag, the fixed read gives the flag back, and the replay report names it; a clean frame carries none", async (t) => {
  if (skip) return t.skip(skip);
  const rows = (await owner.query("SELECT room_id, frame_flag, header FROM durable_event_rooms WHERE event_id = $1", [EVENT_ODD])).rows;
  assert.deepEqual(rows.map((r) => r.room_id), [ID.DNAME]);
  assert.match(rows[0].frame_flag, /suspect frame: the bounds span 30000 m/);
  assert.equal(rows[0].header.extent.span_m, 30_000, "the bounds are exactly as derived: flagged, never repaired");
  assert.equal((await owner.query("SELECT count(*)::int AS n FROM durable_event_rooms WHERE frame_flag IS NOT NULL AND event_id <> $1", [EVENT_ODD])).rows[0].n, 0, "no clean frame carries a flag");
  // the event's own read, answered from the fixed record after the settlements it needs are gone from this office's view
  const odd = await calendarAtOffice({ event: EVENT_ODD }, { now: N2, env: { ...process.env, WORLD2_PG: "1", WORLD2_PG_URL: s.url("office_api") }, settlements: async () => [S4] });
  const r = odd.event.evidence.rooms[0];
  assert.deepEqual([r.id, r.extent.span_m], [ID.DNAME, 30_000]);
  assert.match(r.frame_flag, /suspect frame/, "the frozen frame is not read back as an unqualified clean one");
  const clean = await calendarAtOffice({ event: EVENT }, { now: N2, env: { ...process.env, WORLD2_PG: "1", WORLD2_PG_URL: s.url("office_api") }, settlements: async () => [S4] });
  assert.equal("frame_flag" in clean.event.evidence.rooms[0], false);
  // the replay's dry run reports it before any apply, for the lead's judgment (a fresh event, not yet fixed)
  await owner.query(`INSERT INTO posts (id, class, title, body, author, household, place_mark, place_x, place_y, starts, ends, state, fields, revised, posted_act, last_act)
    VALUES ('quill/odd-again', 'event', 'Again', '', 'quill', 'quill-house', NULL, 0, 0, $1, $2, 'announced', $3, 0, 1, 1)`, [iso(S1 + 3 * H - 20 * MIN), iso(S1 + 3 * H + 40 * MIN), JSON.stringify({ doors_open: iso(S1 + 3 * H - 20 * MIN) })]);
  const dry = await replayRooms(office, { edges: [S1, S2, S3, S4], nowMs: N2, apply: false });
  assert.deepEqual(dry.events.suspect_frames.map((x) => [x.event, x.room]), [["quill/odd-again", ID.DNAME]]);
  assert.equal(await count("durable_event_memberships") > 0, true);
  assert.equal((await owner.query("SELECT count(*)::int AS n FROM durable_event_memberships WHERE event_id = 'quill/odd-again'")).rows[0].n, 0, "a dry run fixed nothing");
});

// ═══ exact and atomic writes ════════════════════════════════════════════════════════════
const fakeRecord = (id, acts, extra = {}) => {
  const base = { id, aliases: [], keys: [], first_at: iso(S1 + 4 * H), latest_at: iso(S1 + 5 * H), closed_at: iso(S2 + H), x0: 0, y0: 0, x1: 4, y1: 4, span_m: 4,
    voice_count: acts.length, participants: ["zed"], place: null, place_mark: null, last_x: 0, last_y: 0, aboard: false, era: "live", has_replies: false, inputs: {}, frame_flag: null, source: "replay", ...extra };
  return { room: base, says: acts.map((a, ord) => ({ act_id: a, room_id: id, ord, at: iso(S1 + 4 * H + ord * MIN), handle: "zed", x: 0, y: 0, place: null, aboard: false, say_id: null, reply_to: null, era: "live", root: null, place_mark: null })) };
};
const inRolledBack = async (fn) => { await office.query("BEGIN"); try { return await fn(office); } finally { await office.query("ROLLBACK"); } };

test("EXACT MEMBERSHIP: a stored room is compared WHOLE both ways: a stored say the rules no longer derive is drift, as is a derived say that is not stored; the stored record stands", async (t) => {
  if (skip) return t.skip(skip);
  await inRolledBack(async (c) => {
    const three = fakeRecord("t1800000000000-zed", [9_000_001, 9_000_002, 9_000_003]);
    assert.equal((await D.writeRooms(c, [three])).inserted, 1);
    const fewer = await D.writeRooms(c, [fakeRecord("t1800000000000-zed", [9_000_001, 9_000_002])]);
    assert.deepEqual([fewer.inserted, fewer.existing, fewer.drift.length], [0, 1, 1], "the stored room holds an extra say the new derivation lacks: a difference, not a match");
    assert.match(fewer.drift[0].why, /holds 3 says and the rules derive 2 now \(0 not stored, 1 stored and not derived\)/);
    const more = await D.writeRooms(c, [fakeRecord("t1800000000000-zed", [9_000_001, 9_000_002, 9_000_003, 9_000_004])]);
    assert.match(more.drift[0].why, /\(1 not stored, 0 stored and not derived\)/);
    const same = await D.writeRooms(c, [three]);
    assert.deepEqual([same.existing, same.drift.length], [1, 0]);
    assert.equal((await c.query("SELECT count(*)::int AS n FROM durable_room_says WHERE room_id = 't1800000000000-zed'")).rows[0].n, 3, "nothing was replaced or added");
  });
});

test("ATOMIC ROOMS: a room whose says do not all land (a keeper and a replay overlapping) is rolled back whole, never left with part of its membership, and the others still land", async (t) => {
  if (skip) return t.skip(skip);
  await inRolledBack(async (c) => {
    assert.equal((await D.writeRooms(c, [fakeRecord("t1800000000001-zed", [9_100_001])])).inserted, 1);
    // the pre-check sees nothing (the other writer has not committed yet, in life), and the say is then taken: the insert conflicts
    const blind = { query: (sql, params) => (/FROM durable_room_says WHERE act_id = ANY/.test(sql) ? Promise.resolve({ rows: [] }) : c.query(sql, params)) };
    const out = await D.writeRooms(blind, [fakeRecord("t1800000000002-zed", [9_100_001, 9_100_002]), fakeRecord("t1800000000003-zed", [9_100_003])]);
    assert.deepEqual([out.inserted, out.drift.length, out.failed.length], [1, 1, 0]);
    assert.match(out.drift[0].why, /1 of its 2 says could be stored.*rolled back whole/);
    assert.equal((await c.query("SELECT count(*)::int AS n FROM durable_rooms WHERE id = 't1800000000002-zed'")).rows[0].n, 0, "no room row without its says");
    assert.equal((await c.query("SELECT count(*)::int AS n FROM durable_room_says WHERE act_id = 9100002")).rows[0].n, 0, "and not a say of it either");
    assert.equal((await c.query("SELECT count(*)::int AS n FROM durable_rooms WHERE id = 't1800000000003-zed'")).rows[0].n, 1, "the next room landed");
    // a say already in ANOTHER room is named by the pre-check and the room is not written
    const taken = await D.writeRooms(c, [fakeRecord("t1800000000004-zed", [9_100_001, 9_100_004])]);
    assert.match(taken.drift[0].why, /already stored in another room/);
    // a count that disagrees with the room's own says never stands
    const bad = await D.writeRooms(c, [fakeRecord("t1800000000005-zed", [9_100_005, 9_100_006], { voice_count: 5 })]);
    assert.equal(bad.inserted, 0);
    assert.equal((await c.query("SELECT count(*)::int AS n FROM durable_room_says WHERE act_id = ANY($1)", [[9_100_005, 9_100_006]])).rows[0].n, 0);
    // a write the store refuses is named and does not stop the rest
    const refused = await D.writeRooms(c, [fakeRecord("not-a-room-id", [9_100_007]), fakeRecord("t1800000000006-zed", [9_100_008])]);
    assert.deepEqual([refused.failed.length, refused.inserted], [1, 1]);
    assert.match(refused.failed[0].why, /the next run asks again/);
  });
});

// ═══ a long season still on: the historical record, not the ear ════════════════════════
// CORE-163's season runs December 1 to January 6, longer than the ear's sixty settlements. An ongoing event's read must answer its rooms (and so its
// gallery) from the archive through its `as_of`, with no premature final membership.
const SEASON = "quill/long-season", SEASON_LATE = "quill/long-season-late", SEASON_EARLY = "quill/season-before-the-record";
test("A SEASON STILL ON: the one-event read answers the fixed closed rooms of its window and the open portion, not 'unavailable' because the ear forgot its start; nothing is made final", async (t) => {
  if (skip) return t.skip(skip);
  const edges = [S1, S2, S3, S4];
  const NOW = S4 + 2 * H;
  await insertSay("g1", S4 + 100 * MIN, "ivy", "quill/the-barn", 0, {});          // after the newest settlement: an OPEN room at the barn
  const post = (id, title, x, from, to) => owner.query(`INSERT INTO posts (id, class, title, body, author, household, place_mark, place_x, place_y, starts, ends, state, fields, revised, posted_act, last_act)
    VALUES ($1, 'event', $2, '', 'quill', 'quill-house', NULL, $3, 0, $4, $5, 'announced', $6, 0, 1, 1)`, [id, title, x, iso(from), iso(to), JSON.stringify({ doors_open: iso(from) })]);
  const SEASON_END = S4 + 30 * H;
  await post(SEASON, "The long season", 5000, S1 + H, SEASON_END);                  // began before the newest edges; c1 (S1+2h) is in it and long closed
  await post(SEASON_LATE, "The late season", 5000, S3 + 2 * H, SEASON_END);       // the window cut: opens after c1's room closed, before e1's
  await post(SEASON_EARLY, "Before the record", 5000, S1 - 2 * H, SEASON_END);    // opens before the oldest settlement: genuinely unknown
  const env = { ...process.env, WORLD2_PG: "1", WORLD2_PG_URL: s.url("office_api") };
  const read = (id, e = edges) => calendarAtOffice({ event: id }, { now: NOW, env, settlements: async () => e });
  const members0 = await count("durable_event_memberships");

  // THE CONTROL (the old failure): hand the read only the ear's newest edges and the season opens before the oldest of them
  const ear = (await read(SEASON, [S3, S4])).event.evidence;
  assert.equal(ear.room_history, "unavailable");
  assert.equal(ear.gallery, null, "the album's pictures were lost while the event was still on");

  // THE FIX: the historical record's edges: the fixed closed rooms and the open one
  const ev = (await read(SEASON)).event.evidence;
  assert.equal(ev.complete, false, "still on");
  assert.equal(ev.room_history, "complete");
  const c1room = derived["c1"].id;
  const e1room = (await owner.query("SELECT room_id FROM durable_room_says WHERE act_id = $1", [ID.e1])).rows[0].room_id;
  const g1room = ev.rooms.find((r) => r.id !== c1room && r.id !== e1room)?.id;
  assert.deepEqual(ev.rooms.map((r) => r.id).slice(0, 2), [c1room, e1room], "the old fixed closed rooms, in the order they began");
  assert.equal(ev.rooms.length, 3, "and the open room of the current portion");
  assert.equal(ev.rooms[2].voice_count, 1);
  assert.equal(ev.rooms[2].id, g1room);
  assert.deepEqual(ev.gallery, { rooms: ev.rooms.map((r) => r.id), sparks: [] }, "a gallery of every room: known, not unknown");

  // the fixed rooms read as the derivation gives them: switch the archive off (no tables seen) and derive the same window from the whole record
  D.__forgetLandedForTest();
  const blind = { query: (sql, params) => (/to_regclass/.test(sql) ? Promise.resolve({ rows: [{ ok: false }] }) : office.query(sql, params)) };
  const { eventEvidence } = await import("../src/event-sparks.mjs");
  const { rowOf, POST_COLUMNS } = await import("../src/events-store.mjs");
  const row = rowOf((await owner.query(`SELECT ${POST_COLUMNS} FROM posts WHERE id = $1`, [SEASON])).rows[0]);
  const whole = await eventEvidence(blind, row, { now: NOW, edges });
  D.__forgetLandedForTest();
  assert.deepEqual(ev.rooms, whole.rooms, "the archive's rooms are the whole-record derivation's rooms, header for header");
  assert.deepEqual(ev.present, whole.present);

  // the closed history is NOT reclustered: the says read are the unfixed ones only
  const seen = [];
  const spy = { query: (sql, params) => { seen.push(sql); return office.query(sql, params); } };
  D.__forgetLandedForTest();
  await eventEvidence(spy, row, { now: NOW, edges });
  assert.ok(seen.some((q) => /NOT EXISTS \(SELECT 1 FROM durable_room_says/.test(q)), "the say read leaves out every say a fixed room holds");

  // WINDOW CUT: a season that opens after c1's room has the later rooms and not c1's
  const late = (await read(SEASON_LATE)).event.evidence;
  assert.deepEqual(late.rooms.map((r) => r.id), [e1room, g1room], "the window cut: a closed room before the window is not the event's");
  // NOTHING FINAL: an ongoing read fixes no membership, and writes nothing
  assert.equal(await count("durable_event_memberships"), members0);
  assert.equal((await owner.query("SELECT count(*)::int AS n FROM durable_event_memberships WHERE event_id = ANY($1)", [[SEASON, SEASON_LATE, SEASON_EARLY]])).rows[0].n, 0);
  // GENUINELY UNKNOWN stays honest: a window opening before the oldest published settlement
  const early = (await read(SEASON_EARLY)).event.evidence;
  assert.equal(early.room_history, "unavailable");
  assert.equal(early.gallery, null);
  assert.match(early.gallery_note, /unknown, not none/);
});

test("THE EVENT READ'S DEFAULT SETTLEMENTS are the historical record's (hearing.recorded), never the ear's sixty", () => {
  const text = readFileSync(join(HERE, "..", "src", "events-store.mjs"), "utf8");
  const body = text.slice(text.indexOf("async function publishedSettlements"), text.indexOf("async function publishedSettlements") + 700);
  assert.match(body, /settlementsRecorded\(\)/);
  assert.doesNotMatch(body, /settlementsKnown\(\)/);
});

// ═══ the completion reads the historical record too ═════════════════════════════════════
test("THE COMPLETION'S SETTLEMENTS are every published one (deploy/event-sparks-pass.mjs § completionEdges), so an otherwise-eligible long event's first pass is not held for want of rooms", async (t) => {
  if (skip) return t.skip(skip);
  const { mkdtempSync } = await import("node:fs");
  const { execFileSync } = await import("node:child_process");
  const { completionEdges } = await import("../deploy/event-sparks-pass.mjs");
  // a REAL world clone with 64 published sweeps: the four this store knows, then sixty more, so the oldest four are beyond the ear's newest sixty
  const repo = mkdtempSync(join(tmpdir(), "pos1203-world-"));
  const git = (env, ...a) => execFileSync("git", ["-C", repo, ...a], { env: { ...process.env, ...env, GIT_AUTHOR_NAME: "k", GIT_AUTHOR_EMAIL: "k@k", GIT_COMMITTER_NAME: "k", GIT_COMMITTER_EMAIL: "k@k" }, stdio: "ignore" });
  git({}, "init", "-q", "-b", "main");
  const sweeps = [S1, S2, S3, S4, ...Array.from({ length: 60 }, (_, i) => S4 + (i + 1) * 12 * H)];
  for (const [i, at] of sweeps.entries()) git({ GIT_AUTHOR_DATE: iso(at), GIT_COMMITTER_DATE: iso(at) }, "commit", "-q", "--allow-empty", "-m", `settlement: sweep S${i + 1}`);
  const all = await completionEdges(repo, H0.createHearingWindow);
  assert.equal(all.length, 64, "every published settlement, not the newest sixty");
  assert.deepEqual(all.slice(0, 4), [S1, S2, S3, S4]);
  const ear = H0.createHearingWindow({ repo }); await ear.refresh();
  assert.equal(ear.settlements().length, 60, "the control: the ear's list is clipped at sixty");

  // an ended long event with NO membership yet (the first pass): its window opens before the sixtieth-newest settlement
  const id = "quill/lantern-first-pass";
  await owner.query(`INSERT INTO posts (id, class, title, body, author, household, place_mark, place_x, place_y, starts, ends, state, fields, revised, posted_act, last_act)
    VALUES ($1, 'event', 'First pass', '', 'quill', 'quill-house', NULL, $2, 0, $3, $4, 'announced', $5, 0, 1, 1)`, [id, LANTERN_X, iso(EVENT_FROM), iso(EVENT_TO), JSON.stringify({ doors_open: iso(EVENT_FROM) })]);
  const { eventEvidence } = await import("../src/event-sparks.mjs");
  const { rowOf, POST_COLUMNS } = await import("../src/events-store.mjs");
  const row = rowOf((await owner.query(`SELECT ${POST_COLUMNS} FROM posts WHERE id = $1`, [id])).rows[0]);
  const now = S4 + 62 * 12 * H;
  assert.equal((await owner.query("SELECT count(*)::int AS n FROM durable_event_memberships WHERE event_id = $1", [id])).rows[0].n, 0);
  const clipped = await eventEvidence(office, row, { now, edges: ear.settlements() });
  assert.equal(clipped.room_history, "unavailable", "with the ear's list the completion would be held");
  const collect = {};
  const full = await eventEvidence(office, row, { now, edges: all, collect });
  assert.equal(full.room_history, "complete", "with the historical list its rooms are told on the first pass");
  assert.deepEqual(full.rooms.map((r) => r.id), [derived["b1,b2"].id]);
  assert.ok(collect.membership, "and the window's membership is there to fix, with no pre-existing record");

  // the shipped caller asks this source, and not the ear
  const text = readFileSync(join(HERE, "..", "deploy", "event-sparks-pass.mjs"), "utf8");
  assert.match(text, /const edges = await completionEdges\(world, createHearingWindow\);/);
  assert.doesNotMatch(text, /h\.settlements\(\)/);
});
