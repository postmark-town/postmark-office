// pos-1185-rooms-do-not-fuse.test.mjs — a say's conversation is decided once, and a read fetches only the rooms it serves (POS-1185).
//
// LAW (Darko, 2026-11-22 11:44 EST): "I'd like a solution where we simply dont merge separate conversations just because there is a
// geometric linker later on, go with whatever's sensible. The goal/floor is for everything to be readable and findable (no orphans)".
//
// What that is held to here, on invented speakers, marks and settlements:
//   · THE RULE, at the real say door (voices.mjs): a say within earshot of two rooms joins ONE (the nearest voice's, ties to the
//     most recent) and the two rooms stay two; a reply joins its parent's room; the room rides the say to its act as
//     `payload.conversation` (world.mjs § voiceEntry).
//   · THE RECORD (src/rooms.mjs § roomsOf): a say with a recorded room is in that room whatever stands near it; a say with none
//     (every act before this shipped) is named as it was when it was spoken, so a room that was fused opens again under its own id.
//   · THE DOOR (world2-serve.mjs § THE ROOMS, KEPT), over a REAL Postgres: every say in exactly one room, every room id opens its
//     room, the answers equal the whole derivation's, CORE-97's carry and POS-1152's start place hold, and N concurrent named
//     reads make ONE whole read between them and fetch only their own rooms' rows.
//
//   node --import ./test/helpers/sparse-guard.mjs --test --test-concurrency=1 test/pos-1185-rooms-do-not-fuse.test.mjs

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startStore } from "./helpers/embedded-store.mjs";

process.env.WORLD_CLONE = join(tmpdir(), "postmark-no-world-clone-xyz");
const env = { pg: process.env.WORLD2_PG, url: process.env.WORLD2_PG_URL };
process.env.WORLD2_PG = "1";
process.env.WORLD2_PG_URL = "postgres://pos-1185-test/none";
after(() => {
  if (env.pg == null) delete process.env.WORLD2_PG; else process.env.WORLD2_PG = env.pg;
  if (env.url == null) delete process.env.WORLD2_PG_URL; else process.env.WORLD2_PG_URL = env.url;
});

const R = await import("../src/rooms.mjs");
const { createVoices } = await import("../src/voices.mjs");
const talk = await import("../world2/tools/conversations.mjs");
const { penVoiceAct } = await import("../src/world.mjs");
const serve = await import("../src/world2-serve.mjs");

const H = 3600_000, MIN = 60_000;
const iso = (ms) => new Date(ms).toISOString();

// ═══ THE RULE, at the say door ════════════════════════════════════════════════════════════════════════════════════════════════
const T = Date.parse("2026-11-20T20:00:00Z");
const DIR = mkdtempSync(join(tmpdir(), "pos1185-"));
let logN = 0;
function door(where, { penMs = 0 } = {}) {
  const clock = { t: T };
  let next = 80001;
  const penned = [];
  const path = join(DIR, `voices-${++logN}.jsonl`);
  const store = createVoices({
    standpoint: async (handle) => ({ handle, placed: true, ...where[handle], aboard: false, moving: false }),
    place: async () => "the green",
    logPath: path,
    now: () => clock.t,
    hearingWindow: () => ({ since: T - H, source: "the bench", disclosure: null }),
    settlements: () => [T - H],
    beforeSpoke: async (voice) => {
      penned.push({ ...voice });                       // the say exactly as the pen is handed it: BEFORE its act is written
      if (penMs) await new Promise((r) => setTimeout(r, penMs));
      return { id: next++ };
    },
  });
  return { store, clock, path, penned, tick: (ms = 20_000) => { clock.t += ms; }, log: () => readFileSync(path, "utf8").trim().split("\n").map((l) => JSON.parse(l)) };
}
const roomsNow = (store) => Object.fromEntries(store.conversations().live.map((c) => [c.id, c.voices.map((v) => v.said)]));
// two groups 100 m apart (out of earshot, 60 m) and a speaker between them: 45 m from the west group, 55 m from the east
const GREEN = { wes: { x: 0, y: 0 }, wyn: { x: 5, y: 0 }, eli: { x: 100, y: 0 }, eve: { x: 105, y: 0 }, mid: { x: 45, y: 0 } };

test("FALSIFIER 1 · a say within earshot of two rooms does not fuse them: it joins the nearest voice's room, each room still opens by its own id with its own says, and the say is in exactly one", async () => {
  const d = door(GREEN);
  const say = async (h, t, o) => { const r = await d.store.say(h, t, o); d.tick(); return r; };
  await say("wes", "west opens"); await say("eli", "east opens"); await say("wyn", "west two"); await say("eve", "east two");
  const west = `t${T}-wes`, east = `t${T + 20_000}-eli`;
  assert.deepEqual(roomsNow(d.store), { [west]: ["west opens", "west two"], [east]: ["east opens", "east two"] }, "two rooms before the say between them");
  const r = await say("mid", "heard by both");
  assert.equal(r.spoke, true);
  for (const line of ["east opens", "east two", "west opens", "west two"]) assert.ok(r.voices.some((v) => v.said === line), `the speaker HEARS both rooms (hearing is earshot's, not the room's): "${line}"`);
  const after = roomsNow(d.store);
  assert.equal(Object.keys(after).length, 2, 'LAW: "we simply dont merge separate conversations just because there is a geometric linker later on" — still two rooms');
  assert.deepEqual(after[west], ["west opens", "west two", "heard by both"], "the nearest voice is the west room's (40 m against 55 m): the say joined that one room");
  assert.deepEqual(after[east], ["east opens", "east two"], "the east room is as it was: nothing was added to it and nothing taken");
  for (const id of [west, east]) {
    const found = d.store.conversations({ find: { room: id } }).find;
    assert.equal(found.room.id, id, 'LAW: "everything to be readable and findable (no orphans)" — the room opens by its own id');
    assert.equal(found.room.voice_count, after[id].length);
  }
  const lines = d.log();
  assert.equal(lines.at(-1).root, west, "its log line names the one room it joined");
  for (const l of lines) assert.equal(l.merged, undefined, "no line records a join of two rooms");
  // and both rooms go on as themselves
  await say("eve", "east three"); await say("wes", "west three");
  assert.deepEqual(roomsNow(d.store), { [west]: ["west opens", "west two", "heard by both", "west three"], [east]: ["east opens", "east two", "east three"] });
});

test("FALSIFIER 2 · a tie in distance goes to the most recent voice, and standing still keeps a speaker in their own room", async () => {
  const d = door({ wes: { x: 0, y: 0 }, eli: { x: 100, y: 0 }, mid: { x: 50, y: 0 } });
  const say = async (h, t) => { await d.store.say(h, t); d.tick(); };
  await say("wes", "west opens"); await say("eli", "east opens");
  await say("mid", "exactly between");                        // 50 m from each: the most recent voice is the east room's
  const west = `t${T}-wes`, east = `t${T + 20_000}-eli`;
  assert.deepEqual(roomsNow(d.store), { [west]: ["west opens"], [east]: ["east opens", "exactly between"] });
  await say("wes", "still here");                             // wes has not moved: his own last say is the nearest voice (0 m), though mid's is more recent and in earshot
  assert.deepEqual(roomsNow(d.store)[west], ["west opens", "still here"], "your own last say counts, so standing still keeps you in your room");
});

test("FALSIFIER 3 · a reply joins its parent's room even when another room's voice is nearer, and one out of every open room's earshot is refused", async () => {
  const d = door({ ...GREEN, far: { x: 5000, y: 0 } });
  const say = async (h, t, o) => { const r = await d.store.say(h, t, o); d.tick(); return r; };
  await say("wes", "west opens");                              // 80001
  await say("eli", "east opens");                              // 80002
  const west = `t${T}-wes`, east = `t${T + 20_000}-eli`;
  const r = await say("mid", "answering the east room from nearer the west", { replyTo: 80002 });   // mid is 45 m from wes and 55 m from eli
  assert.equal(r.said.reply_to, 80002);
  assert.deepEqual(roomsNow(d.store), { [west]: ["west opens"], [east]: ["east opens", "answering the east room from nearer the west"] },
    "a reply joins the room of the say it answers, not the nearest voice's");
  assert.equal(d.penned.at(-1).root, east, "and the pen is handed that room");
  const refused = await say("far", "from across town", { replyTo: 80002 });
  assert.equal(refused.code, 422);
  assert.match(refused.defect, /say 80002 is not in a conversation you can hear from where you stand/);
  assert.equal(d.penned.length, 3, "the pen never saw the refused say");
});

test("FALSIFIER 4 · the room is decided BEFORE the act is written and recorded on it: the pen is handed `root`, and the act's payload carries it as `conversation`", async () => {
  const d = door(GREEN);
  await d.store.say("wes", "west opens"); d.tick();
  await d.store.say("wyn", "west two"); d.tick();
  const west = `t${T}-wes`;
  assert.deepEqual(d.penned.map((v) => v.root), [west, west], "a founder is handed its own id; a joiner the room it joined");
  // world.mjs § voiceEntry, through the real pen function with its store stubbed (the pattern of conversation-place-mark.test.mjs)
  const entries = [];
  const deps = { witnessStampAt: async () => ({ at: { anchor: "quill/the-green", dx: 1, dy: 1 }, witnesses: { source: "presence", list: [] } }),
    appendActFlipped: async (_c, entry) => { entries.push(entry); return { seq: 1, actId: 9 }; }, currentCrossing: () => 1, actsHaveNonce: async () => false };
  for (const v of d.penned) await penVoiceAct(v, null, deps);
  await penVoiceAct({ handle: "old", text: "a voice with no room named", at: T, x: 0, y: 0, place: null, aboard: false }, null, deps);
  assert.deepEqual(entries.map((e) => e.payload.conversation ?? null), [west, west, null], "the act records the room; a voice handed over without one records none, and nothing is made up");
  assert.deepEqual(Object.keys(entries[0].payload).sort(), ["conversation", "place", "text"], "one new field, beside the words and the place");
});

test("FALSIFIER 5 · two residents opening in the same breath found ONE room: a say penned while another is still being penned hears it", async () => {
  const d = door({ wes: { x: 0, y: 0 }, wyn: { x: 5, y: 0 } }, { penMs: 30 });
  const first = d.store.say("wes", "welcome, all");            // its room is named, and its pen is still writing…
  await new Promise((r) => setTimeout(r, 5));
  d.tick(1000);
  const second = d.store.say("wyn", "glad to be here");        // …when the second say names its room
  await Promise.all([first, second]);
  assert.deepEqual(roomsNow(d.store), { [`t${T}-wes`]: ["welcome, all", "glad to be here"] });
});

test("FALSIFIER 6 · a listener between two rooms is shown ONE conversation, the one a say from there would join, and still hears both", async () => {
  const d = door({ ...GREEN, nea: { x: 58, y: 0 } });           // 58 m from wes, 42 m from eli: within earshot of both, nearer the east room
  const say = async (h, t) => { await d.store.say(h, t); d.tick(); };
  await say("wes", "west opens"); await say("eli", "east opens");
  const heard = await d.store.hear("nea");
  assert.deepEqual(heard.voices.map((v) => v.said), ["west opens", "east opens"]);
  assert.equal(heard.conversation.voice_count, 1, "one room, not both");
  assert.deepEqual(heard.conversation.participants, ["eli"], "the room here is the east room: its voice is the nearer, though the west room began first");
  const west = await d.store.hear("mid");                       // 45 m from wes, 55 m from eli
  assert.deepEqual(west.conversation.participants, ["wes"], "and from nearer the west room, the west room");
});

// ═══ THE RECORD's derivation (src/rooms.mjs) ══════════════════════════════════════════════════════════════════════════════════
const S1 = Date.parse("2026-06-01T06:00:00.000Z"), S2 = S1 + 12 * H, S3 = S2 + 12 * H;
const v = (at, handle, x, more = {}) => ({ handle, text: `${handle} @${(at - S1) / MIN}`, at, x, y: 0, place: null, aboard: false, ...more });
const shape = (rooms) => Object.fromEntries(rooms.map((c) => [c.root, c.voices.map((x) => x.text)]));

test("FALSIFIER 7 · a say with NO recorded room is named as it was when spoken: the fused room's own says read again under its own id, the bridge and the says after it stay where they were", () => {
  const west = v(S1 + 60 * MIN, "wes", 0), east = v(S1 + 65 * MIN, "eli", 96);
  const voices = [west, east, v(S1 + 70 * MIN, "wyn", 0), v(S1 + 75 * MIN, "eve", 96),
    v(S1 + 80 * MIN, "mid", 48),          // within earshot of both: under the rule of its day it fused them under the older room
    v(S1 + 85 * MIN, "eve", 96)];         // and a later say on the east side joined the fused room
  const rooms = R.roomsOf(voices, { earshotM: 60, boundaries: [S1] });
  assert.deepEqual(shape(rooms), {
    [R.roomIdOf(west)]: ["wes @60", "wyn @70", "mid @80", "eve @85"],
    [R.roomIdOf(east)]: ["eli @65", "eve @75"],
  }, 'LAW: "no orphans" — the east room, whose id opened nothing once it was fused, is its own room again with the says that named it');
  // CONTROL: the grouping of its day, which is what made the east room's id open nothing
  assert.equal(talk.clusterVoices(voices, { earshotM: 60, boundaries: [S1] }).length, 1, "the old fold fuses them: one room, under the west id only");
  // and nothing depends on what is said LATER: the rooms of a prefix are the rooms of the whole, for the says the prefix holds
  for (let n = 1; n <= voices.length; n++) {
    const prefix = R.roomsOf(voices.slice(0, n), { earshotM: 60, boundaries: [S1] });
    for (const room of prefix) for (const say of room.voices)
      assert.equal(rooms.find((c) => c.voices.includes(say)).root, room.root, `the say "${say.text}" is in the same room after ${voices.length - n} later says`);
  }
});

test("FALSIFIER 8 · a recorded room wins over the ground: a say named into one room sits there though it stands within earshot of another, and the two never fuse", () => {
  const nia = v(S3 + 10 * MIN + 250, "nia", 2000, { id: 11, text: "nia opens" });
  const pax = v(S3 + 12 * MIN + 700, "pax", 2090, { id: 12, text: "pax opens" });
  const NIA = R.roomIdOf(nia), PAX = R.roomIdOf(pax);
  const voices = [{ ...nia, root: NIA }, { ...pax, root: PAX },
    v(S3 + 14 * MIN, "quin", 2050, { id: 13, root: PAX, text: "quin, named into pax's" }),                 // 50 m from nia, 40 m from pax: the office named pax's room when it was spoken
    v(S3 + 16 * MIN, "rae", 2095, { id: 14, root: NIA, reply_to: 11, text: "rae answers nia" }),           // a reply to nia from 95 m away: out of her earshot, in her room
    v(S3 + 18 * MIN, "nia", 2000, { id: 15, root: NIA, text: "nia again" })];
  const rooms = R.roomsOf(voices, { earshotM: 60, boundaries: [S1, S2, S3] });
  assert.deepEqual(shape(rooms), { [NIA]: ["nia opens", "rae answers nia", "nia again"], [PAX]: ["pax opens", "quin, named into pax's"] });
  // CONTROL: the same says with no recorded room are one fused room under the old fold
  assert.equal(talk.clusterVoices(voices, { earshotM: 60, boundaries: [S1, S2, S3] }).length, 1);
});

test("FALSIFIER 9 · a reply with no recorded room joins its parent's room: a circle is never split across two rooms", () => {
  const voices = [v(S1 + 60 * MIN, "wes", 0, { id: 1 }), v(S1 + 65 * MIN, "eli", 96, { id: 2 }),
    v(S1 + 80 * MIN, "mid", 48, { id: 3 }),                       // fuses the two (the rule of its day)
    v(S1 + 85 * MIN, "eve", 96, { id: 4, reply_to: 2 })];         // answers eli: by the ground alone it would be named into the fused west room
  const rooms = R.roomsOf(voices, { earshotM: 60, boundaries: [S1] });
  assert.deepEqual(shape(rooms), { [`t${S1 + 60 * MIN}-wes`]: ["wes @60", "mid @80"], [`t${S1 + 65 * MIN}-eli`]: ["eli @65", "eve @85"] });
});

test("the record's instant and memory's are one room: a recorded name with milliseconds joins the room the record names to the second (POS-1183), and the recorded name is its id", () => {
  const founder = v(Math.floor((S3 + 10 * MIN) / 1000) * 1000, "nia", 2000, { id: 21 });               // as the record reads it: to the second, no recorded room
  const joiner = v(S3 + 12 * MIN, "oro", 2010, { id: 22, root: `t${S3 + 10 * MIN + 250}-nia` });       // names the room as memory did, with its milliseconds
  const rooms = R.roomsOf([founder, joiner], { earshotM: 60, boundaries: [S3] });
  assert.equal(rooms.length, 1);
  assert.equal(rooms[0].root, `t${S3 + 10 * MIN + 250}-nia`);
  assert.equal(R.roomKeyOf(rooms[0].root), R.roomKeyOf(R.roomIdOf(founder)));
});

test("roomFor: only OPEN rooms are joined (CORE-97's hour), and a deck is one place", () => {
  const edges = [S1, S2];
  const room = { root: "t1-a", voices: [v(S2 - 20 * MIN, "a", 0)], latest: S2 - 20 * MIN };
  assert.equal(R.roomFor(v(S2 + 30 * MIN, "b", 10), [room], { earshotM: 60, boundaries: edges }), room, "in the hour after the settlement the room is still open: a say belongs to it");
  assert.equal(R.roomFor(v(S2 + 61 * MIN, "b", 10), [room], { earshotM: 60, boundaries: edges }), null, "past the hour with no say it has closed: a later say founds its own");
  const deck = { root: "t2-c", voices: [v(S2 + 2 * H, "c", 9000, { aboard: true })], latest: S2 + 2 * H };
  assert.equal(R.roomFor(v(S2 + 3 * H, "d", 0, { aboard: true }), [deck], { earshotM: 60, boundaries: edges }), deck, "two voices aboard are beside each other however far the water moved");
});

// ═══ THE DOOR, over a real Postgres ═══════════════════════════════════════════════════════════════════════════════════════════
let s = null, skip = false, pool = null, owner = null;
const ID = {}; // name -> act id
const EDGES = [S1, S2, S3];
const NOW = S3 + 4 * H;
const NIA_AT = S3 + 10 * MIN + 250, PAX_AT = S3 + 12 * MIN + 700;
const NIA = `t${NIA_AT}-nia`, PAX = `t${PAX_AT}-pax`;
const WEST = `t${S1 + 60 * MIN}-wes`, EAST = `t${S1 + 65 * MIN}-eli`, CARRIED = `t${S2 - 20 * MIN}-cal`, LATE = `t${S3 + 90 * MIN}-dov`;

async function insertSay(name, at, actor, anchor, dx, payload = {}, { settled = true } = {}) {
  const { rows } = await owner.query(
    `INSERT INTO acts (at, crossing, actor, action, at_anchor, at_dx, at_dy, class, payload${settled ? ", inserted_at" : ""})
     VALUES ($1::timestamptz, 1, $2, 'say', $3, $4, 0, 'voice', $5::jsonb${settled ? ", $1::timestamptz" : ""}) RETURNING id`,
    [iso(at), actor, anchor, dx, JSON.stringify({ text: `${name}: ${actor} speaks`, place: "the green", ...payload })]);
  ID[name] = Number(rows[0].id);
  return ID[name];
}

before(async () => {
  try { s = await startStore({ db: "pos1185_rooms" }); } catch (e) { skip = String(e.message ?? e).slice(0, 160); return; }
  if (s.skip) { skip = s.skip; s = null; return; }
  owner = await s.connect("world2_owner");
  await owner.query("INSERT INTO windows (id, opens_at, closes_at, status) VALUES (1, '2026-01-01', '2026-01-02', 'closed') ON CONFLICT DO NOTHING");
  const mark = (slug, x, status = "standing", data = {}) => owner.query(
    `INSERT INTO marks (id, slug, kind, owner, geometry, bbox, status, data, locked_window)
     VALUES (gen_random_uuid(), $1, 'fixture', split_part($1, '/', 1), $2::jsonb, box(point(0,0), point(0,0)), $3, $4::jsonb, 1)`,
    [slug, JSON.stringify({ at: { x, y: 0 }, extent: { w: 4, h: 4 } }), status, JSON.stringify(data)]);
  // the say class's own dial (read by every answer), and five dials of ANOTHER class that a conversations read has no business fetching
  await mark("the-town/earshot-m", 90_000, "standing", { slot: "earshot_m", value: "60", _parent_is_law: "the-town/say" });
  for (let i = 0; i < 5; i++) await mark(`the-town/stride-dial-${i}`, 91_000 + i, "standing", { slot: `stride_${i}`, value: "1", _parent_is_law: "the-town/stride" });
  await mark("quill/west-bench", 0); await mark("quill/east-bench", 96); await mark("quill/the-path", 48);
  await mark("quill/the-lantern", 1000, "retired");            // a retired mark still places the says spoken at it
  await mark("quill/the-barn", 2000);
  for (let i = 0; i < 40; i++) await mark(`filler/mark-${i}`, 50_000 + i * 500); // marks no say stands on: a named read must not fetch them
  // ── the old says: no recorded room ──
  await insertSay("w1", S1 + 60 * MIN, "wes", "quill/west-bench", 0);
  await insertSay("e1", S1 + 65 * MIN, "eli", "quill/east-bench", 0);
  await insertSay("w2", S1 + 70 * MIN, "wyn", "quill/west-bench", 0);
  await insertSay("e2", S1 + 75 * MIN, "eve", "quill/east-bench", 0);
  await insertSay("bridge", S1 + 80 * MIN, "mid", "quill/the-path", 0);                       // fused west and east, under the rule of its day
  await insertSay("e3", S1 + 85 * MIN, "eve", "quill/east-bench", 0);                         // named the fused (west) room
  await insertSay("r1", S1 + 90 * MIN, "eli", "quill/east-bench", 0, { reply_to: ID.e1 });    // a reply to e1: its parent's room
  // CORE-97: a room carried across S2 by a say in the hour after it, and a say past S3's hour that founds its own
  await insertSay("c1", S2 - 20 * MIN, "cal", "quill/the-lantern", 0, { place_mark: "quill/the-lantern" });
  await insertSay("c2", S2 + 30 * MIN, "cyd", "quill/the-lantern", 5);
  await insertSay("c3", S2 + 5 * H, "cal", "quill/the-lantern", 0);
  await insertSay("d1", S3 + 90 * MIN, "dov", "quill/the-lantern", 0);
  await insertSay("hidden", S1 + 61 * MIN, "hob", "quill/west-bench", 0, { room: "quill/the-keep#cellar" });   // WLD-74: inside a dungeon room
  await insertSay("lost", S1 + 62 * MIN, "lux", "quill/no-such-mark", 0);                                     // #351: its anchor is in no row
  // ── the new says: each carries its room ──
  await insertSay("n1", NIA_AT, "nia", "quill/the-barn", 0, { conversation: NIA, place_mark: "quill/the-barn" });
  await insertSay("p1", PAX_AT, "pax", "quill/the-barn", 90, { conversation: PAX });
  await insertSay("q1", S3 + 14 * MIN, "quin", "quill/the-barn", 50, { conversation: PAX });                    // within earshot of both rooms: named into pax's
  await insertSay("n2", S3 + 16 * MIN, "rae", "quill/the-barn", 95, { conversation: NIA, reply_to: ID.n1 });    // a reply from out of nia's earshot
  const { default: pg } = await import("pg");
  pool = new pg.Pool({ connectionString: s.url("office_api"), max: 3 });   // this door's own pool size (world2-serve.mjs: { name: "serve", max: 3 })
});
after(async () => { await pool?.end(); await owner?.end(); await s?.stop?.(); });

/** A pool that counts: each query's SQL and the rows it handed back. A fresh one is a fresh office (the kept rooms are per pool). */
function counting() {
  const seen = [];
  return { seen, query: async (sql, params) => { const r = await pool.query(sql, params); seen.push({ sql, rows: r.rows.length }); return r; } };
}
const count = (p, sql) => p.seen.filter((q) => q.sql === sql);
const ask = (p, query, at = NOW) => serve.world2Serve("/world2/conversations", new URLSearchParams(`at=${iso(at)}&${query}`),
  { p, settlements: () => EDGES, hearingWindow: () => ({ since: S3 }) });
const said = (thread) => thread.voices.map((x) => x.said.split(":")[0]);
const allThreads = async (p) => { const r = await ask(p, "closed=1000&voices=1000"); assert.equal(r.code, 200, JSON.stringify(r.body).slice(0, 300)); return [...r.body.live, ...r.body.closed]; };

test("THE DOOR · every say is readable in exactly one room, and every room id that was ever a room's opens that room", async (t) => {
  if (skip) return t.skip(skip);
  const p = counting();
  const threads = await allThreads(p);
  const rooms = Object.fromEntries(threads.map((c) => [c.id, said(c)]));
  assert.deepEqual(rooms, {
    [WEST]: ["w1", "w2", "bridge", "e3"],
    [EAST]: ["e1", "e2", "r1"],
    [CARRIED]: ["c1", "c2", "c3"],
    [LATE]: ["d1"],
    [NIA]: ["n1", "n2"],
    [PAX]: ["p1", "q1"],
  }, 'LAW: "we simply dont merge separate conversations just because there is a geometric linker later on"');
  const placed = Object.keys(ID).filter((k) => k !== "hidden" && k !== "lost");
  assert.deepEqual(threads.flatMap(said).sort(), [...placed].sort(), 'LAW: "everything to be readable" — each say is in exactly one room (the dungeon-room say and the unplaced say are on no keyless read, as before)');
  for (const [id, names] of Object.entries(rooms)) {
    const r = await ask(p, `room=${encodeURIComponent(id)}`);
    assert.equal(r.body.find.history, "complete", `${id} opens`);
    assert.equal(r.body.find.room.id, id);
    assert.equal(r.body.find.room.voice_count, names.length);
  }
  // the east room's id: the one a fuse made open nothing
  const east = await ask(p, `room=${encodeURIComponent(EAST)}`);
  assert.deepEqual(east.body.find.room.participants, ["eli", "eve"], 'LAW: "findable (no orphans)" — the room a later say fused away answers under its own id');
  // an id that never was a room still says so
  const none = await ask(p, "room=t1-nobody");
  assert.equal(none.body.find.history, "unavailable");
  assert.equal(none.body.find.note, "no conversation in the record holds it");
});

test("THE DOOR · a circle opens in its say's one room: a reply sits with its parent (old and new), and a say named into one room is not read into the room beside it", async (t) => {
  if (skip) return t.skip(skip);
  const p = counting();
  const roomOf = async (name) => (await ask(p, `circle=${ID[name]}`)).body.find.room?.id ?? null;
  assert.equal(await roomOf("r1"), EAST, "an old reply: its parent's room");
  assert.equal(await roomOf("e3"), WEST, "an old say after the bridge: the room it joined then");
  assert.equal(await roomOf("q1"), PAX, "a say within earshot of two rooms: the one its act names");
  assert.equal(await roomOf("n2"), NIA, "a reply from out of earshot: its parent's room");
  const circle = (await ask(p, `circle=${ID.n1}`)).body.find.circle_read;
  assert.deepEqual(circle.lines.map((l) => l.id), [ID.n1, ID.n2], "the circle is whole inside its room");
  assert.equal((await ask(p, `circle=${ID.hidden}`)).body.find.history, "unavailable", "WLD-74: a say inside a dungeon room is in no room of a keyless read");
  assert.equal((await ask(p, "circle=999999999")).body.find.history, "unavailable");
});

test("THE DOOR · CORE-97 and POS-1152 hold: a room still talking carries across a settlement under one id, one past the hour founds its own, and a room's place is where its root started", async (t) => {
  if (skip) return t.skip(skip);
  const p = counting();
  const carried = (await ask(p, `room=${encodeURIComponent(CARRIED)}`)).body.find.room;
  assert.equal(carried.started, iso(S2 - 20 * MIN), "CORE-97: the room that began before the settlement");
  assert.equal(carried.latest, iso(S2 + 5 * H), 'CORE-97: "if anyone contributes during that time they can keep it going" — and it then lives with no idle timeout');
  assert.equal(carried.voice_count, 3);
  assert.equal(carried.place_mark, "quill/the-lantern", "POS-1152: where its root started");
  assert.equal((await ask(p, `room=${encodeURIComponent(LATE)}`)).body.find.room.voice_count, 1, "CORE-97: a say past the hour after the next settlement does not revive it");
  const nia = (await ask(p, `room=${encodeURIComponent(NIA)}`)).body.find.room;
  assert.equal(nia.place_mark, "quill/the-barn", "POS-1152: a named room's start is its founder's, found though the record reads its instant to the second and the name keeps milliseconds");
  assert.equal((await ask(p, `room=${encodeURIComponent(PAX)}`)).body.find.room.place_mark, undefined, "and a room whose root recorded none borrows none from the room beside it");
  // POS-1183: the same room by the id the record would spell (to the second)
  const bySecond = `t${Math.floor(NIA_AT / 1000) * 1000}-nia`;
  assert.equal((await ask(p, `room=${encodeURIComponent(bySecond)}`)).body.find.room.id, NIA);
  // liveness is the instant asked, never membership: at an earlier instant the same rooms, the same says
  const then = await ask(p, `room=${encodeURIComponent(CARRIED)}`, S2 + 40 * MIN);
  assert.equal(then.body.find.room.live, true);
  assert.equal(then.body.find.room.voice_count, 3, "a say's room does not move with the instant a read is evaluated at");
});

test("THE DOOR · its answers are the whole derivation's: the page, every page behind a cursor, each room and each circle equal conversationsOf over every voice", async (t) => {
  if (skip) return t.skip(skip);
  const { rows } = await pool.query(`SELECT id, at, actor, action, at_anchor, at_dx, at_dy, payload FROM acts WHERE action = ANY($1) ${talk.VOICE_ORDER_SQL}`, [talk.VOICE_ACTIONS]);
  const { rows: markRows } = await pool.query(talk.ANCHOR_MARKS_SQL);
  const centres = talk.anchorCentres(markRows);
  const whole = talk.voiceRecords(rows.filter((r) => !serve.spokenInRoom(r)), { centreOf: (id) => centres.get(id) ?? null }).voices.filter((x) => x.at >= S1);
  const opts = { now: NOW, earshotM: 60, boundaries: EDGES, fadeMs: 5 * MIN };
  const core = ({ what, evaluated_at, voices, eras, dials, unplaced_says, disclosed, ...rest }) => { if (rest.find) { delete rest.find.sparks; delete rest.find.sparks_note; } return rest; };
  const p = counting();
  let checked = 0;
  const same = async (query, more) => {
    const got = await ask(p, query);
    assert.equal(got.code, 200, `${query}: ${JSON.stringify(got.body).slice(0, 200)}`);
    assert.deepEqual(JSON.parse(JSON.stringify(core(got.body))), JSON.parse(JSON.stringify(talk.conversationsOf(whole, { ...opts, ...more }))), query);
    checked += 1;
    return got.body;
  };
  await same("", {});
  // every page behind the cursor, two rooms at a time, until nothing is behind it
  let before = iso(NOW + H), pages = 0;
  for (;;) {
    const body = await same(`closed=2&voices=2&before=${encodeURIComponent(before)}`, { closedMax: 2, voiceCap: 2, before: Date.parse(before) });
    pages += 1;
    if (!body.earlier.remaining) break;
    before = body.earlier.before;
  }
  assert.equal(pages, 2, "three closed rooms, two to a page: the cursor walked two pages");
  for (const id of [WEST, EAST, CARRIED, LATE, NIA, PAX, "t1-nobody"]) await same(`room=${encodeURIComponent(id)}`, { find: { room: id } });
  for (const name of ["w1", "bridge", "e3", "r1", "c2", "n1", "n2", "q1"]) await same(`circle=${ID[name]}`, { find: { circle: String(ID[name]), after: null } });
  assert.equal(checked, 18, "the page, two pages behind the cursor, seven rooms and eight circles were each compared");
  const first = await ask(p, "");
  assert.equal(first.body.voices, whole.length, "the count of voices is still the whole record's");
  assert.equal(first.body.unplaced_says.count, 1);
  assert.match(first.body.disclosed.join(" "), /1 say could not be placed/);
});

test("FALSIFIER 10 · N concurrent named reads do not each read the store: ONE whole read between them, on a pool of three, and each fetches only its own room's rows", async (t) => {
  if (skip) return t.skip(skip);
  const p = counting();
  const N = 12;
  const ids = [WEST, EAST, CARRIED, LATE, NIA, PAX];
  const answers = await Promise.all(Array.from({ length: N }, (_, i) => ask(p, `room=${encodeURIComponent(ids[i % ids.length])}`)));
  for (const [i, r] of answers.entries()) assert.equal(r.body.find?.room?.id, ids[i % ids.length], `read ${i} answered its own room`);
  assert.equal(count(p, serve.ROOMS_BUILD_SQL).length, 1, `the read of every voice act ran once for ${N} concurrent reads, not ${N} times`);
  assert.equal(count(p, talk.ANCHOR_MARKS_SQL).length, 1, "and the read of every mark once");
  const fetched = count(p, serve.ROOM_VOICES_SQL);
  assert.equal(fetched.length, N);
  assert.deepEqual(fetched.map((q) => q.rows).sort((a, b) => a - b), [1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4], "each read fetched its own room's says and nothing else");
  for (const q of count(p, serve.ROOM_ANCHORS_SQL)) assert.ok(q.rows >= 2 && q.rows <= 4, `a named read fetched ${q.rows} marks: its room's anchors (one to three) and the say class's one dial, never the 51 the store holds nor another class's dials`);
  assert.deepEqual(answers[0].body.dials.earshot_m, { value: 60, source: "record" }, "and the say dial it fetched is the one the answer stands on");
  // and the next reads make no whole read at all
  const beforeN = p.seen.length;
  await ask(p, `room=${encodeURIComponent(WEST)}`); await ask(p, `circle=${ID.n1}`);
  assert.equal(count(p, serve.ROOMS_BUILD_SQL).length, 1, "still one");
  const later = p.seen.slice(beforeN);
  assert.ok(later.every((q) => q.sql !== serve.ROOMS_BUILD_SQL && q.sql !== talk.ANCHOR_MARKS_SQL));
  assert.ok(later.reduce((n, q) => n + q.rows, 0) <= 16, `two later named reads touched ${later.reduce((n, q) => n + q.rows, 0)} rows in all`);
});

test("THE DOOR · a say spoken after the rooms were kept is read at once, filed by the room its act names, with no second whole read; an act with no room from an older office makes it build again", async (t) => {
  if (skip) return t.skip(skip);
  const p = counting();
  assert.equal((await ask(p, `room=${encodeURIComponent(PAX)}`)).body.find.room.voice_count, 2);
  await insertSay("p2", S3 + 20 * MIN, "pax", "quill/the-barn", 90, { conversation: PAX }, { settled: false });
  const pax = (await ask(p, `room=${encodeURIComponent(PAX)}`)).body.find.room;
  assert.equal(pax.voice_count, 3, "the new say is in its room on the next read");
  assert.equal((await ask(p, `circle=${ID.p2}`)).body.find.room.id, PAX);
  assert.equal(count(p, serve.ROOMS_BUILD_SQL).length, 1, "and the kept rooms were topped up, not rebuilt");
  // a brand new room, founded after the rooms were kept
  const SOL = `t${S3 + 30 * MIN}-sol`;
  await insertSay("s1", S3 + 30 * MIN, "sol", "quill/west-bench", 0, { conversation: SOL }, { settled: false });
  assert.equal((await ask(p, `room=${encodeURIComponent(SOL)}`)).body.find.room.voice_count, 1);
  assert.ok((await allThreads(p)).some((c) => c.id === SOL), "and it is on the page");
  assert.equal(count(p, serve.ROOMS_BUILD_SQL).length, 1);
  // an office on older code writes a say with no recorded room: it is never left in no room
  await insertSay("o1", S3 + 3 * H, "odd", "quill/the-lantern", 0, {}, { settled: false });
  const threads = await allThreads(p);
  assert.ok(threads.some((c) => said(c).includes("o1")), 'LAW: "everything to be readable" — the unnamed say is in a room');
  assert.equal(count(p, serve.ROOMS_BUILD_SQL).length, 2, "by building the kept rooms again, once");
  assert.equal(threads.flatMap(said).filter((n) => n === "o1").length, 1);
});
