// say-push.test.mjs — THE WAITERS (POS-265, the second half), and the say's
// retry key kept in the record.
//
// The laws on trial, from the brief (Linear POS-265, "BRIEF, lane
// jetto-say-push"):
//
//   "agents get a long-poll (world read: say with since and wait:<=25 s returns
//    as soon as a new voice lands in earshot, or empty at the deadline)"
//   "One room state per place, fanned out, never computed per connection.
//    Prove: 50 open waiters cost one room computation per new voice (count it)."
//   "a retry after an office restart returns the first say's receipt and
//    records nothing new"
//
// The count is read off the store's own counters (voices.mjs § room.stats):
// `rooms` is every snapshot built, `heardFrom` every relocation read, `nearby`
// every per-ear presence read. The control beside it is fifty plain listens,
// which is what fifty lingering agents cost before this.
//
//   node --test test/say-push.test.mjs

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

process.env.WORLD_CLONE = join(tmpdir(), "postmark-no-world-clone-xyz");
const { createVoices, EARSHOT_M, PRESENCE_MS } = await import("../src/voices.mjs");
const { createSayPush, waitMsOf, WAIT_MAX_S, WAITERS_PER_HANDLE } = await import("../src/say-push.mjs");

const DIR = mkdtempSync(join(tmpdir(), "postmark-say-push-"));
const T0 = Date.UTC(2026, 8, 27, 0, 0, 0);
let logN = 0;

// A store over its own log, a hand clock, hand-placed residents, and counting
// hooks: every structural relocation and every presence read is counted.
function bench(at, { log = null } = {}) {
  const clock = { t: T0 };
  const path = log ?? join(DIR, `voices-${++logN}.jsonl`);
  const counted = { heardFrom: 0, nearby: 0, nearbyMany: 0 };
  const within = (point) => Object.keys(at)
    .filter((h) => Math.hypot(at[h].x - point.x, at[h].y - point.y) <= EARSHOT_M).sort();
  const store = createVoices({
    standpoint: async (handle) => (at[handle] ? { handle, placed: true, x: at[handle].x, y: at[handle].y } : { handle, placed: false }),
    place: async ({ x, y }) => `the ground at ${x},${y}`,
    logPath: path,
    now: () => clock.t,
    // structural hearing on, so the relocation is a real, countable read
    heardFrom: async (v) => { counted.heardFrom += 1; return { x: v.x, y: v.y }; },
    structuralHearing: () => true,
    nearby: async (point) => { counted.nearby += 1; return within(point); },
  });
  const nearbyMany = async (ears) => { counted.nearbyMany += 1; return ears.map(({ at: p }) => within(p)); };
  return { store, clock, path, counted, nearbyMany, within, tick: (ms) => { clock.t += ms; } };
}

// A timer the test drives: the deadline fires when the test says so.
function handTimers() {
  const timers = new Set();
  return {
    setTimer: (fn) => { const t = { fn }; timers.add(t); return t; },
    clearTimer: (t) => { timers.delete(t); },
    fireAll: () => { for (const t of [...timers]) { timers.delete(t); t.fn(); } },
    get count() { return timers.size; },
  };
}

const crowd = (n, { x = 0, y = 0 } = {}) => {
  const at = { speaker: { x, y } };
  for (let i = 0; i < n; i++) at[`ear-${String(i).padStart(2, "0")}`] = { x: x + (i % 10), y: y + Math.floor(i / 10) };
  return at;
};

test("50 OPEN WAITERS COST ONE ROOM PER NEW VOICE — and all fifty hear it", async () => {
  const b = bench(crowd(50));
  const timers = handTimers();
  const push = createSayPush({ voices: b.store, nearbyMany: b.nearbyMany, setTimer: timers.setTimer, clearTimer: timers.clearTimer });
  await b.store.say("speaker", "the room opens");
  const since = b.clock.t;
  b.tick(20_000);
  const ears = Object.keys(crowd(50)).filter((h) => h !== "speaker");
  const answers = ears.map((h) => push.wait(h, { since, waitMs: 25_000 }));
  await new Promise((r) => setImmediate(r));
  assert.equal(push.open, 50, "fifty ears are open");

  const before = { ...b.store.room.stats };
  const heardBefore = b.counted.heardFrom;
  const nearbyBefore = b.counted.nearby;
  await b.store.say("speaker", "can everyone hear me?");
  await push.settled();
  const got = await Promise.all(answers);

  // the count, which is the whole claim
  const rooms = b.store.room.stats.rooms - before.rooms;
  assert.equal(rooms, 2, `one room for the speaker's own reply and ONE for the fifty waiters — got ${rooms}`);
  assert.equal(push.stats.fanouts, 1, "one fan-out for the voice");
  // two audible voices, relocated once each per room — never once per ear
  assert.equal(b.counted.heardFrom - heardBefore, 2 * 2, "relocations scale with rooms × voices, not with waiters");
  assert.equal(b.counted.nearbyMany, 1, "who is here BY POSITION is read once for all fifty ears");
  assert.equal(b.counted.nearby - nearbyBefore, 1, "the only per-ear presence read is the speaker's own reply");
  // and every ear heard it
  for (const r of got) {
    assert.equal(r.voices.length, 1, "each waiter carries exactly the new voice");
    assert.equal(r.voices[0].said, "can everyone hear me?");
    assert.ok(Number.isFinite(r.waited_ms));
  }
  assert.equal(push.open, 0, "every ear answered and closed");
  assert.equal(timers.count, 0, "every deadline was cleared");
});

test("THE CONTROL: fifty plain listens cost fifty rooms (what lingering cost before the push)", async () => {
  const b = bench(crowd(50));
  await b.store.say("speaker", "the room opens");
  const since = b.clock.t;
  b.tick(20_000);
  await b.store.say("speaker", "can everyone hear me?");
  const before = b.store.room.stats.rooms;
  const ears = Object.keys(crowd(50)).filter((h) => h !== "speaker");
  for (const h of ears) await b.store.hear(h, { since });
  assert.equal(b.store.room.stats.rooms - before, 50);
});

test("a woken waiter's answer IS the say's own delta — byte for byte what a listen at that instant answers", async () => {
  const at = { speaker: { x: 0, y: 0 }, ear: { x: 10, y: 0 }, twin: { x: 10, y: 0 } };
  const b = bench(at);
  const push = createSayPush({ voices: b.store, nearbyMany: b.nearbyMany });
  await b.store.say("speaker", "first");
  const since = b.clock.t;
  // both ears carry the same delta memory: the reply that handed out `since`
  await b.store.hear("ear", {}); await b.store.hear("twin", {});
  b.tick(20_000);
  const waiting = push.wait("ear", { since: (await b.store.hear("ear", {})).latest, waitMs: 25_000 });
  const twinSince = (await b.store.hear("twin", {})).latest;
  await b.store.say("speaker", "second");
  await push.settled();
  const woke = await waiting;
  const listened = await b.store.hear("twin", { since: twinSince });
  const { waited_ms, ...body } = woke;
  assert.deepEqual(body, listened);
  assert.ok(since <= woke.latest);
});

test("an ear out of earshot is not woken, and its deadline answers empty with the cursor unmoved", async () => {
  const b = bench({ speaker: { x: 0, y: 0 }, far: { x: 0, y: EARSHOT_M + 50 } });
  const timers = handTimers();
  const push = createSayPush({ voices: b.store, nearbyMany: b.nearbyMany, setTimer: timers.setTimer, clearTimer: timers.clearTimer });
  const since = b.clock.t;
  const waiting = push.wait("far", { since, waitMs: 25_000 });
  await new Promise((r) => setImmediate(r));
  b.tick(1000); // newer than the cursor: only the distance keeps it out
  await b.store.say("speaker", "you cannot hear this");
  await push.settled();
  assert.equal(push.open, 1, "the far ear is still waiting");
  timers.fireAll();
  const r = await waiting;
  assert.deepEqual(r.voices, []);
  assert.equal(r.latest, since, "the cursor has not moved");
  assert.equal(r.spoke, false);
  assert.match(r.note, /nothing new within earshot in 25s/);
  assert.equal(push.stats.timed_out, 1);
});

test("voices landing in the same turn share one fan-out", async () => {
  const b = bench({ a: { x: 0, y: 0 }, b: { x: 5, y: 0 }, ear: { x: 10, y: 0 } });
  const push = createSayPush({ voices: b.store, nearbyMany: b.nearbyMany });
  const since = b.clock.t;
  const waiting = push.wait("ear", { since, waitMs: 25_000 });
  await new Promise((r) => setImmediate(r));
  b.tick(1000);
  await Promise.all([b.store.say("a", "one"), b.store.say("b", "two")]);
  await push.settled();
  const r = await waiting;
  assert.equal(push.stats.fanouts, 1);
  assert.deepEqual(r.voices.map((v) => v.said), ["one", "two"]);
});

test("a voice already newer than the cursor answers the wait at once; nothing newer costs no room", async () => {
  const b = bench({ speaker: { x: 0, y: 0 }, ear: { x: 10, y: 0 } });
  const timers = handTimers();
  const push = createSayPush({ voices: b.store, nearbyMany: b.nearbyMany, setTimer: timers.setTimer, clearTimer: timers.clearTimer });
  const before = b.clock.t - 1;
  await b.store.say("speaker", "already said");
  const r = await push.wait("ear", { since: before, waitMs: 25_000 });
  assert.equal(r.voices[0].said, "already said");
  const rooms = b.store.room.stats.rooms;
  const quiet = push.wait("ear", { since: b.clock.t, waitMs: 25_000 });
  await new Promise((res) => setImmediate(res));
  assert.equal(b.store.room.stats.rooms, rooms, "an arrival with nothing newer than its cursor reads no room");
  timers.fireAll();
  assert.deepEqual((await quiet).voices, []);
});

test("THE STREAM: the room first, then a delta per voice in earshot, the cursor advancing; close stops it", async () => {
  const b = bench({ speaker: { x: 0, y: 0 }, page: { x: 10, y: 0 } });
  const push = createSayPush({ voices: b.store, nearbyMany: b.nearbyMany });
  await b.store.say("speaker", "before the page opened");
  const events = [];
  const s = await push.stream("page", {}, (r) => events.push(r));
  assert.equal(events.length, 1, "the room, on connect");
  assert.equal(events[0].voices[0].said, "before the page opened");
  b.tick(20_000);
  await b.store.say("speaker", "while it listens");
  await push.settled();
  assert.equal(events.length, 2);
  assert.deepEqual(events[1].voices.map((v) => v.said), ["while it listens"], "a delta: only the new voice");
  b.tick(20_000);
  await b.store.say("speaker", "and again");
  await push.settled();
  assert.deepEqual(events[2].voices.map((v) => v.said), ["and again"], "the cursor advanced with the last event");
  s.close();
  b.tick(20_000);
  await b.store.say("speaker", "after it closed");
  await push.settled();
  assert.equal(events.length, 3, "a closed stream hears nothing");
  assert.equal(push.open, 0);
});

test("a handle holds a few open ears, not a crowd", async () => {
  const b = bench({ ear: { x: 0, y: 0 } });
  const timers = handTimers();
  const push = createSayPush({ voices: b.store, setTimer: timers.setTimer, clearTimer: timers.clearTimer });
  const open = [];
  for (let i = 0; i < WAITERS_PER_HANDLE; i++) open.push(push.wait("ear", { since: b.clock.t, waitMs: 25_000 }));
  await new Promise((r) => setImmediate(r));
  const refused = await push.wait("ear", { since: b.clock.t, waitMs: 25_000 });
  assert.equal(refused.error, "bounce");
  assert.match(refused.defect, /already has 4 open ears/);
  timers.fireAll();
  await Promise.all(open);
});

test("wait is refused, never trimmed: over the cap, without since, with text", () => {
  assert.equal(waitMsOf({}).waitMs, null, "absent is a plain listen");
  assert.equal(waitMsOf({ wait: 25, since: 1 }).waitMs, 25_000);
  assert.match(waitMsOf({ wait: WAIT_MAX_S + 1, since: 1 }).bounce.defect, /at most 25/);
  assert.match(waitMsOf({ wait: 0, since: 1 }).bounce.defect, /above 0/);
  assert.match(waitMsOf({ wait: 5 }).bounce.defect, /wait needs since/);
  assert.match(waitMsOf({ wait: 5, since: 1, text: "hi" }).bounce.defect, /a wait is a listen/);
});

// ── THE RETRY KEY, KEPT IN THE RECORD ────────────────────────────────────────

test("POS-265 durable nonce: after a restart the record answers the retry — the first say's receipt, and no second voice", async () => {
  const at = { caelan: { x: 0, y: 0 } };
  const record = new Map(); // "<handle> <nonce>" -> at: the acts column, standing in
  const pen = async (voice, spoken) => { if (spoken?.nonce) record.set(`${voice.handle} ${spoken.nonce}`, voice.at); return null; };
  const spentNonce = async (handle, nonce, sinceMs) => { const t = record.get(`${handle} ${nonce}`); return t != null && t >= sinceMs ? t : null; };
  const log = join(DIR, "durable.jsonl");
  const clock = { t: T0 };
  const office = () => createVoices({
    standpoint: async (h) => ({ handle: h, placed: true, ...at[h] }),
    logPath: log, now: () => clock.t, beforeSpoke: pen, spentNonce, nonceKept: async () => true,
  });
  const first = await office().say("caelan", "an entrance", { nonce: "enter-1" });
  assert.equal(first.spoke, true);
  assert.match(first.idempotent, /kept on this voice's act/);
  clock.t += 3 * 60_000;                   // the brownout: three minutes, and a restart
  const again = await office().say("caelan", "an entrance", { nonce: "enter-1" });
  assert.equal(again.duplicate, true, "the record remembered what the process forgot");
  assert.equal(again.spoken_at, new Date(T0).toISOString());
  assert.equal(readFileSync(log, "utf8").trim().split("\n").length, 1, "one voice in the log, not two");
});

test("THE CONTROL: with no record to ask, the restarted office speaks the retry again (the gap 027 closes)", async () => {
  const log = join(DIR, "no-record.jsonl");
  const clock = { t: T0 };
  const office = () => createVoices({
    standpoint: async (h) => ({ handle: h, placed: true, x: 0, y: 0 }),
    logPath: log, now: () => clock.t,
  });
  const first = await office().say("caelan", "an entrance", { nonce: "enter-1" });
  assert.match(first.idempotent, /while this office stays up/);
  clock.t += 3 * 60_000;
  const again = await office().say("caelan", "an entrance", { nonce: "enter-1" });
  assert.equal(again.duplicate, undefined);
  assert.equal(readFileSync(log, "utf8").trim().split("\n").length, 2);
});

test("a record lookup that trips is a miss, never a refused voice", async () => {
  const log = join(DIR, "tripping.jsonl");
  const store = createVoices({
    standpoint: async (h) => ({ handle: h, placed: true, x: 0, y: 0 }),
    logPath: log, now: () => T0,
    spentNonce: async () => { throw new Error("the store tripped"); },
  });
  const r = await store.say("caelan", "still heard", { nonce: "n" });
  assert.equal(r.spoke, true);
});

test("the nonce rides to the pen and the listener beside the voice, and never into the voices log", async () => {
  const log = join(DIR, "carried.jsonl");
  const seen = [];
  const store = createVoices({
    standpoint: async (h) => ({ handle: h, placed: true, x: 0, y: 0 }),
    logPath: log, now: () => T0,
    beforeSpoke: async (v, spoken) => { seen.push(["pen", spoken.nonce]); return null; },
    onSpoke: (v, spoken) => seen.push(["listener", spoken.nonce]),
  });
  await store.say("caelan", "keyed", { nonce: "n-1" });
  await store.say("rei", "unkeyed");
  assert.deepEqual(seen, [["pen", "n-1"], ["listener", "n-1"], ["pen", undefined], ["listener", undefined]]);
  assert.ok(!readFileSync(log, "utf8").includes("n-1"), "the voices log's ruled shape carries no nonce");
});

// ── THE WIRE: Server-Sent Events ─────────────────────────────────────────────

const { serveSayStream } = await import("../src/say-push.mjs");
const { EventEmitter } = await import("node:events");
const fakeRes = () => {
  const res = new EventEmitter();
  res.head = null; res.body = ""; res.ended = 0;
  res.writeHead = (code, headers) => { res.head = { code, headers }; };
  res.write = (s) => { res.body += s; res.emit("wrote", s); return true; };
  res.end = () => { res.ended += 1; res.emit("ended"); };
  return res;
};

test("the stream's wire: headers on the first event, `event: room` frames, a bounce written before any event, close on disconnect", async () => {
  const b = bench({ speaker: { x: 0, y: 0 }, page: { x: 10, y: 0 } });
  const push = createSayPush({ voices: b.store, nearbyMany: b.nearbyMany });
  await b.store.say("speaker", "hello, page");
  const req = new EventEmitter();
  const res = fakeRes();
  await serveSayStream(req, res, (send) => push.stream("page", {}, send), { beatMs: 60_000, onBounce: () => assert.fail("no bounce expected") });
  assert.equal(res.head.code, 200);
  assert.match(res.head.headers["content-type"], /^text\/event-stream/);
  const [frame] = res.body.split("\n\n");
  assert.match(frame, /^event: room\ndata: /);
  assert.equal(JSON.parse(frame.slice(frame.indexOf("data: ") + 6)).voices[0].said, "hello, page");
  assert.equal(push.open, 1);
  req.emit("close");
  assert.equal(push.open, 0, "a closed connection is a closed ear");
  assert.equal(res.ended, 1, "and an ended response");

  const refusedRes = fakeRes();
  let refusal = null;
  await serveSayStream(new EventEmitter(), refusedRes, (send) => push.stream("nobody", {}, send), { onBounce: (r) => { refusal = r; } });
  assert.equal(refusal.error, "bounce");
  assert.equal(refusedRes.head, null, "a refusal is written as JSON by the door, before any event");
});

// ── THE ROOM A WAITER STANDS IN (POS-887) ────────────────────────────────────
//
// LAW (voices.mjs § heardBy, WLD-74): "hearing stops at a dungeon room's walls, both ways" — a voice is heard
// only by an ear in the room it was spoken in (null: the open). A waiter is an ear that opened in one room. The
// falsifiers below move its reader out of that room, or into one, while it waits — through the real seam
// (createVoices → createSayPush → serveSayStream) on invented residents at fixed times — and hold that the
// waiter is then not served, and ends, and ends its connection. Each sits beside an ADMITTING CONTROL in which
// a reader who stays IS served, so an absence can only mean the move.

const HALL = "an-invented-hall";
const CELLAR = "an-invented-cellar";

// A hand-held await: the code under test arrives at `reached`, and the test lets it go with `open`.
function gate(handle = null) {
  let open; let hit;
  const promise = new Promise((r) => { open = r; });
  const reached = new Promise((r) => { hit = r; });
  return { handle, promise, open, reached, hit };
}

// Residents at invented points and rooms, a hand clock, and the holds the race falsifiers close on: one reader's
// standing read (`hold.standing`), the batch presence read (`hold.nearby`), one ear's own presence read
// (`hold.one`, for a push with no batch) and the snapshot's relocations (`hold.heard`, a queue: each call takes
// the next gate). `broken` is the handles whose standpoint trips. `withNearby: false` leaves only the door's own
// presence map to say who is here.
function roomBench(placed, rooms, { withNearby = true } = {}) {
  const at = { ...placed };
  const inRoom = { ...rooms };
  const clock = { t: T0 };
  const hold = { standing: null, nearby: null, one: null, heard: [] };
  const broken = new Set();
  const counted = { nearbyMany: 0 };
  const within = (point, room) => Object.keys(at)
    .filter((h) => (inRoom[h] ?? null) === (room ?? null) && Math.hypot(at[h].x - point.x, at[h].y - point.y) <= EARSHOT_M).sort();
  const store = createVoices({
    standpoint: async (h) => {
      if (hold.standing && hold.standing.handle === h) { hold.standing.hit(); await hold.standing.promise; }
      if (broken.has(h)) throw new Error("the standpoint tripped");
      return at[h] ? { handle: h, placed: true, x: at[h].x, y: at[h].y } : { handle: h, placed: false };
    },
    place: async ({ x, y }) => `the ground at ${x},${y}`,
    roomOf: async (h) => inRoom[h] ?? null,
    logPath: join(DIR, `voices-${++logN}.jsonl`),
    now: () => clock.t,
    hearingWindow: () => ({ since: T0 - 3_600_000, source: "bench", disclosure: null }),
    structuralHearing: () => true,
    heardFrom: async (v) => {
      const g = hold.heard.shift();
      if (g) { g.hit(); await g.promise; }
      return { x: v.x, y: v.y };
    },
    ...(withNearby ? { nearby: async (point, { room = null } = {}) => {
      const g = hold.one; // one-shot: only the first ear to ask is held
      if (g && !g.taken) { g.taken = true; g.hit(); await g.promise; }
      return within(point, room);
    } } : {}),
  });
  const nearbyMany = withNearby ? async (ears) => {
    counted.nearbyMany += 1;
    if (hold.nearby) { hold.nearby.hit(); await hold.nearby.promise; }
    return ears.map(({ at: p, room = null }) => within(p, room));
  } : null;
  return { store, clock, at, inRoom, hold, broken, counted, nearbyMany, tick: (ms) => { clock.t += ms; } };
}

// A stream on the real wire (serveSayStream over a fake request and response), with the opened stream's own
// handle on it and the `send` it was given. Every wire is closed at the end of the file, so no beat outlives it.
const openWires = new Set();
after(() => { for (const w of openWires) w.req.emit("close"); });
async function onWire(push, handle, opts = {}, { beatMs = 60_000 } = {}) {
  const req = new EventEmitter();
  const res = fakeRes();
  const wire = { req, res, opened: null, send: null };
  await serveSayStream(req, res, async (send) => { wire.send = send; wire.opened = await push.stream(handle, opts, send); return wire.opened; },
    { beatMs, onBounce: () => assert.fail("no bounce expected") });
  openWires.add(wire);
  return wire;
}
const framesOf = (res) => res.body.split("\n\n").filter((f) => f.startsWith("event: room")).map((f) => JSON.parse(f.slice(f.indexOf("data: ") + 6)));
const saidOn = (res) => framesOf(res).flatMap((f) => f.voices.map((v) => v.said));
// An event the code under test must raise. The deadline is only the fuse that turns a missing event into a red
// that names it; nothing here waits on a clock.
const until = (emitter, event, ready, what) => new Promise((resolve, reject) => {
  if (ready()) return resolve();
  const fuse = setTimeout(() => { emitter.off(event, check); reject(new Error(`never happened: ${what}`)); }, 5000);
  const check = () => { if (ready()) { clearTimeout(fuse); emitter.off(event, check); resolve(); } };
  emitter.on(event, check);
});
const turns = async (n = 3) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };

test("POS-887 THE STREAM: a reader who leaves the room the stream opened in is not served that room's later voice, and the stream ends", async () => {
  const b = roomBench({ ann: { x: 2000, y: 2000 }, cy: { x: 2001, y: 2000 } }, { ann: HALL, cy: HALL });
  const push = createSayPush({ voices: b.store, nearbyMany: b.nearbyMany });
  const wire = await onWire(push, "cy");
  assert.equal(push.open, 1);
  // THE CONTROL: cy still stands in the hall, so the hall's voice reaches the stream
  b.tick(20_000);
  await b.store.say("ann", "a word while cy is in the hall");
  await push.settled();
  assert.deepEqual(saidOn(wire.res), ["a word while cy is in the hall"], "a reader who stays in the room IS served");
  assert.equal(wire.res.ended, 0, "and its stream stays open");
  // THE PROBE: cy walks out of the hall, and the hall speaks again
  b.inRoom.cy = null;
  b.tick(20_000);
  await b.store.say("ann", "a word after cy left the hall");
  await push.settled();
  assert.ok(!wire.res.body.includes("after cy left"), "the hall's later voice does not reach the reader who left it");
  assert.deepEqual(saidOn(wire.res), ["a word while cy is in the hall"], "the stream carries nothing more");
  assert.equal(wire.res.ended, 1, "and its connection ended");
  assert.equal(push.open, 0, "and so did its ear");
});

test("POS-887 THE STREAM, the other way: a reader who walks into a room is not served the open air the stream opened in", async () => {
  const b = roomBench({ dee: { x: 2000, y: 2000 }, bo: { x: 2001, y: 2000 } }, {});
  const push = createSayPush({ voices: b.store, nearbyMany: b.nearbyMany });
  const wire = await onWire(push, "bo");
  b.tick(20_000);
  await b.store.say("dee", "open air, while bo is out in it");
  await push.settled();
  assert.deepEqual(saidOn(wire.res), ["open air, while bo is out in it"], "the admitting control: a reader who stays in the open IS served the open");
  b.inRoom.bo = HALL;
  b.tick(20_000);
  await b.store.say("dee", "open air, after bo went in");
  await push.settled();
  assert.ok(!wire.res.body.includes("after bo went in"), "the open air does not follow a reader into a room");
  assert.deepEqual(saidOn(wire.res), ["open air, while bo is out in it"]);
  assert.equal(wire.res.ended, 1);
  assert.equal(push.open, 0);
});

test("POS-887 THE BEAT: a stream's beat looks at its reader first — it keeps them present in the room they stand in, and once they have left it counts them there no longer", async () => {
  const step = Math.ceil(PRESENCE_MS / 3);
  const b = roomBench({ ann: { x: 2000, y: 2000 }, cy: { x: 2001, y: 2000 } }, { ann: HALL, cy: HALL }, { withNearby: false });
  const push = createSayPush({ voices: b.store });
  const wire = await onWire(push, "cy");
  // THE CONTROL: past the time one stamp lasts, the beats alone keep cy present in the hall
  for (let i = 0; i < 4; i++) { b.tick(step); assert.equal(await wire.opened.beat(), true, "the beat of a reader still in the hall"); }
  const held = await b.store.say("ann", "who is here");
  assert.deepEqual(held.listeners, ["cy"], "kept present by its beats, past the time one stamp lasts");
  // THE PROBE: cy leaves, and the beats go on being asked for as long again
  b.inRoom.cy = null;
  let open = true;
  for (let i = 0; i < 4; i++) { b.tick(step); open = await wire.opened.beat(); }
  assert.equal(open, false, "the beat found cy gone, and the stream ended");
  const gone = await b.store.say("ann", "who is here now");
  assert.deepEqual(gone.listeners, [], "cy is not counted present in the hall by beats that went on after it left");
  assert.equal(wire.res.ended, 1);
});

test("POS-887 THE BEAT ALONE: with no voice at all, the heartbeat finds a reader who left and ends the connection", async () => {
  const b = roomBench({ cy: { x: 2001, y: 2000 } }, { cy: HALL });
  const push = createSayPush({ voices: b.store, nearbyMany: b.nearbyMany });
  const wire = await onWire(push, "cy", {}, { beatMs: 5 });
  // THE CONTROL: while cy stands in the hall, the connection is beat on
  await until(wire.res, "wrote", () => wire.res.body.includes(": beat"), "a beat written to a reader still in the hall");
  assert.equal(wire.res.ended, 0);
  b.inRoom.cy = null;
  await until(wire.res, "ended", () => wire.res.ended > 0, "the connection ended once the reader had left");
  assert.equal(wire.res.ended, 1);
  assert.equal(push.open, 0);
});

test("POS-887 THE WIRE: a stream that ends itself ends its response and its beat once; a client that goes twice, or before the stream opens, is safe", async () => {
  const live = new Set();
  const [setIt, clearIt] = [globalThis.setInterval, globalThis.clearInterval];
  const MARK = 61_000; // this test's beat, so nothing else's interval is counted
  globalThis.setInterval = (fn, ms, ...rest) => { const h = setIt(fn, ms, ...rest); if (ms === MARK) live.add(h); return h; };
  globalThis.clearInterval = (h) => { live.delete(h); return clearIt(h); };
  try {
    const b = roomBench({ cy: { x: 2001, y: 2000 } }, { cy: HALL });
    const push = createSayPush({ voices: b.store, nearbyMany: b.nearbyMany });
    // (1) the stream ends itself: its reader left
    const one = await onWire(push, "cy", {}, { beatMs: MARK });
    assert.equal(live.size, 1, "a beat is running");
    b.inRoom.cy = null;
    assert.equal(await one.opened.beat(), false);
    assert.equal(one.res.ended, 1, "the response ended");
    assert.equal(live.size, 0, "and its beat stopped");
    assert.equal(push.open, 0);
    const written = one.res.body;
    one.req.emit("close"); one.req.emit("close"); one.res.emit("error", new Error("the socket broke")); one.opened.close();
    one.send({ voices: [{ said: "sent after the end" }] });
    assert.equal(one.res.ended, 1, "reaching the end again, every way, ends nothing twice");
    assert.equal(one.res.body, written, "and nothing is written after it");
    // (2) the client goes, twice
    b.inRoom.cy = HALL;
    const two = await onWire(push, "cy", {}, { beatMs: MARK });
    assert.equal(live.size, 1);
    two.req.emit("close"); two.req.emit("close");
    assert.equal(two.res.ended, 1);
    assert.equal(live.size, 0);
    assert.equal(push.open, 0);
    // (3) the client goes before the stream has opened
    const slow = gate();
    const req = new EventEmitter();
    const res = fakeRes();
    const serving = serveSayStream(req, res, async (send) => { await slow.promise; return push.stream("cy", {}, send); }, { beatMs: MARK });
    req.emit("close");
    slow.open();
    await serving;
    assert.equal(push.open, 0, "the stream that opened after its client had gone is closed");
    assert.equal(live.size, 0, "and runs no beat");
    assert.equal(res.body, "", "and was sent nothing");
  } finally {
    globalThis.setInterval = setIt;
    globalThis.clearInterval = clearIt;
  }
});

test("POS-887 THE WAIT: a reader who leaves the room the wait began in is answered empty at once, not at the deadline, and is not served the room's later voice", async () => {
  const b = roomBench({ ann: { x: 2000, y: 2000 }, cy: { x: 2001, y: 2000 } }, { ann: HALL, cy: HALL });
  const timers = handTimers();
  const push = createSayPush({ voices: b.store, nearbyMany: b.nearbyMany, setTimer: timers.setTimer, clearTimer: timers.clearTimer });
  // THE CONTROL: a reader who stays in the hall is woken by the hall's voice
  const stays = push.wait("cy", { since: b.clock.t, waitMs: 25_000 });
  await turns(1);
  b.tick(20_000);
  await b.store.say("ann", "a word while cy waits in the hall");
  await push.settled();
  const heard = await stays;
  assert.deepEqual(heard.voices.map((v) => v.said), ["a word while cy waits in the hall"], "a reader who stays IS served");
  // THE PROBE: cy waits again, walks out, and the hall speaks
  const leaves = push.wait("cy", { since: heard.latest, waitMs: 25_000 });
  await turns(1);
  assert.equal(push.open, 1);
  b.inRoom.cy = null;
  b.tick(20_000);
  await b.store.say("ann", "a word after cy left the hall");
  await push.settled();
  const r = await leaves;
  assert.ok(!JSON.stringify(r).includes("after cy left"), "the hall's later voice does not reach the reader who left it");
  assert.deepEqual(r.voices, []);
  assert.equal(r.latest, heard.latest, "the cursor has not moved");
  assert.match(r.note, /no longer stand where this listen began/);
  assert.equal(push.stats.timed_out, 0, "answered at the move, not at the deadline");
  assert.equal(timers.count, 0, "its deadline was cleared");
  assert.equal(push.open, 0);
});

test("POS-887 THE WAIT'S ARRIVAL CHECK: a reader who leaves while the check reads the room is not served what it read", async () => {
  const run = async ({ leaves }) => {
    const b = roomBench({ ann: { x: 2000, y: 2000 }, cy: { x: 2001, y: 2000 } }, { ann: HALL, cy: HALL });
    const timers = handTimers();
    const push = createSayPush({ voices: b.store, nearbyMany: b.nearbyMany, setTimer: timers.setTimer, clearTimer: timers.clearTimer });
    const since = b.clock.t - 1;
    await b.store.say("ann", "already said in the hall");
    const g = gate();
    b.hold.heard.push(g); // the check's room read waits on the test
    const waiting = push.wait("cy", { since, waitMs: 25_000 });
    await g.reached;
    if (leaves) b.inRoom.cy = null;
    g.open();
    return { r: await waiting, push, timers };
  };
  const stays = await run({ leaves: false });
  assert.deepEqual(stays.r.voices.map((v) => v.said), ["already said in the hall"], "the admitting control: the check serves a reader who stayed");
  const left = await run({ leaves: true });
  assert.ok(!JSON.stringify(left.r).includes("already said"), "the check does not serve the hall to a reader who left it while it read");
  assert.deepEqual(left.r.voices, []);
  assert.match(left.r.note, /no longer stand where this listen began/);
  assert.equal(left.push.stats.timed_out, 0);
  assert.equal(left.timers.count, 0);
  assert.equal(left.push.open, 0);
});

test("POS-887 THE STREAM'S FIRST EVENT: a voice that lands before the ear joins the fan-out reaches a reader who stayed, and not one who left", async () => {
  const run = async ({ leaves }) => {
    const b = roomBench({ ann: { x: 2000, y: 2000 }, cy: { x: 2001, y: 2000 } }, { ann: HALL, cy: HALL });
    const push = createSayPush({ voices: b.store, nearbyMany: b.nearbyMany });
    await b.store.say("ann", "said before the page opened");
    b.tick(20_000);
    const g = gate();
    b.hold.one = g; // the first event's presence read, which comes after its room is built, waits on the test
    const events = [];
    const opening = push.stream("cy", {}, (r) => events.push(r));
    await g.reached;
    b.tick(20_000);
    await b.store.say("ann", "said in the gap");
    if (leaves) b.inRoom.cy = null;
    g.open();
    const s = await opening;
    return { events, push, s };
  };
  const stays = await run({ leaves: false });
  assert.deepEqual(stays.events.map((e) => e.voices.map((v) => v.said)), [["said before the page opened"], ["said in the gap"]],
    "the admitting control: the arrival check catches the gap voice for a reader who stayed");
  const left = await run({ leaves: true });
  assert.ok(!JSON.stringify(left.events).includes("said in the gap"), "the gap voice is not served to a reader who left the hall");
  assert.deepEqual(left.events.map((e) => e.voices.map((v) => v.said)), [["said before the page opened"]], "only the room as it stood when they asked");
  assert.equal(left.push.open, 0);
  assert.equal(await left.s.beat(), false);
  let told = false;
  left.s.onEnd(() => { told = true; });
  assert.equal(told, true, "a stream that has already ended tells a hook at once");
});

test("POS-887 RACES: a reader who walks out while the fan-out's standing read is out is not served when it resumes", async () => {
  const run = async ({ leaves }) => {
    const b = roomBench({ ann: { x: 2000, y: 2000 }, cy: { x: 2001, y: 2000 } }, { ann: HALL, cy: HALL });
    const push = createSayPush({ voices: b.store, nearbyMany: b.nearbyMany });
    const events = [];
    await push.stream("cy", {}, (r) => events.push(r));
    b.hold.standing = gate("cy"); // cy's standing reads now wait on the test
    b.tick(20_000);
    await b.store.say("ann", "a word as cy walks out");
    const settled = push.settled(); // the fan-out that say scheduled
    await b.hold.standing.reached; // it has asked where cy stands, and waits for the answer
    if (leaves) b.inRoom.cy = null;
    b.hold.standing.open();
    await settled;
    return { events, push };
  };
  const stays = await run({ leaves: false });
  assert.equal(stays.events.length, 2, "the admitting control: the read resumes and a reader who stayed IS served");
  const left = await run({ leaves: true });
  assert.ok(!JSON.stringify(left.events).includes("as cy walks out"), "nothing is served from a standing read that resumed after the reader left");
  assert.equal(left.events.length, 1);
  assert.equal(left.push.open, 0);
});

test("POS-887 RACES: a stream another look found empty is not served what the fan-out was carrying, whether it was reading the batch or building the reply", async () => {
  // `batch`: the fan-out holds the batch presence read; `reply`: there is no batch, and the ear's own read is held
  const run = async ({ at, leaves }) => {
    const b = roomBench({ ann: { x: 2000, y: 2000 }, cy: { x: 2001, y: 2000 } }, { ann: HALL, cy: HALL });
    const push = createSayPush({ voices: b.store, nearbyMany: at === "batch" ? b.nearbyMany : null });
    const events = [];
    const s = await push.stream("cy", {}, (r) => events.push(r));
    const g = gate();
    if (at === "batch") b.hold.nearby = g;
    b.tick(20_000);
    await b.store.say("ann", "a word the fan-out is carrying");
    if (at === "reply") b.hold.one = g; // armed after the say's own reply, so only the fan-out's reply is held
    const settled = push.settled();
    await g.reached;
    if (leaves) {
      b.inRoom.cy = null;
      assert.equal(await s.beat(), false, "a beat found cy gone while the fan-out was out");
    }
    g.open();
    await settled;
    return { events, push };
  };
  for (const at of ["batch", "reply"]) {
    const stays = await run({ at, leaves: false });
    assert.equal(stays.events.length, 2, `the admitting control (${at}): a reader who stayed IS served`);
    assert.equal(stays.push.stats.woken, 1, at);
  }
  for (const at of ["batch", "reply"]) {
    const left = await run({ at, leaves: true });
    assert.ok(!JSON.stringify(left.events).includes("the fan-out is carrying"), `nothing is sent to a stream that ended while the fan-out held its ${at}`);
    assert.equal(left.events.length, 1, at);
    assert.equal(left.push.stats.woken, 0, `and nothing is counted as woken (${at})`);
    assert.equal(left.push.open, 0, at);
  }
});

test("POS-887 CURSOR: two fan-outs reaching one stream together hand each voice over once, in order", async () => {
  const b = roomBench({ ann: { x: 2000, y: 2000 }, cy: { x: 2001, y: 2000 } }, { ann: HALL, cy: HALL });
  const push = createSayPush({ voices: b.store, nearbyMany: b.nearbyMany });
  const events = [];
  await push.stream("cy", {}, (r) => events.push(r));
  b.hold.standing = gate("cy");
  b.tick(20_000);
  await b.store.say("ann", "first of two");
  await b.hold.standing.reached; // fan-out 1 has asked where cy stands
  b.tick(20_000);
  await b.store.say("ann", "second of two"); // lands while fan-out 1 is out, so it is a fan-out of its own
  for (let i = 0; i < 200 && b.counted.nearbyMany < 2; i++) await turns(1);
  assert.equal(b.counted.nearbyMany, 2, "fan-out 2 is under way beside fan-out 1");
  await turns(2);
  b.hold.standing.open();
  for (let i = 0; i < 200 && push.stats.woken < 2; i++) await turns(1);
  await turns(2);
  assert.deepEqual(events.slice(1).map((e) => e.voices.map((v) => v.said)), [["first of two"], ["second of two"]], "each voice once, in the order it landed");
  assert.ok(events[1].latest < events[2].latest, "and the cursor only moved forward");
});

test("POS-887 UNREADABLE: a reader the world can no longer place, or whose place trips, has the waiter ended without the room's voice", async () => {
  const b = roomBench({ ann: { x: 2000, y: 2000 }, cy: { x: 2001, y: 2000 }, bo: { x: 2002, y: 2000 }, dee: { x: 2003, y: 2000 } }, { ann: HALL, cy: HALL, bo: HALL, dee: HALL });
  const timers = handTimers();
  const push = createSayPush({ voices: b.store, nearbyMany: b.nearbyMany, setTimer: timers.setTimer, clearTimer: timers.clearTimer });
  const cy = await onWire(push, "cy");
  const bo = await onWire(push, "bo");
  const first = push.wait("dee", { since: b.clock.t, waitMs: 25_000 });
  await turns(1);
  // THE CONTROL: all three stand in the hall, and the first word reaches both streams and the wait
  b.tick(20_000);
  await b.store.say("ann", "a word everyone can read");
  await push.settled();
  assert.deepEqual(saidOn(cy.res), ["a word everyone can read"]);
  assert.deepEqual(saidOn(bo.res), ["a word everyone can read"]);
  const woken = await first;
  assert.deepEqual(woken.voices.map((v) => v.said), ["a word everyone can read"]);
  // THE PROBE: a fresh wait, cy unplaced, bo's and dee's standpoints tripping
  const second = push.wait("dee", { since: woken.latest, waitMs: 25_000 });
  await turns(1);
  assert.equal(push.open, 3);
  delete b.at.cy;
  b.broken.add("bo");
  b.broken.add("dee");
  b.tick(20_000);
  await b.store.say("ann", "a word nobody can be sure of");
  await push.settled();
  assert.ok(!cy.res.body.includes("nobody can be sure"), "an unplaced reader is served nothing");
  assert.ok(!bo.res.body.includes("nobody can be sure"), "nor one whose place cannot be read");
  const answered = await second;
  assert.ok(!JSON.stringify(answered).includes("nobody can be sure"), "nor a wait whose reader's place cannot be read");
  assert.deepEqual(answered.voices, []);
  assert.match(answered.note, /could not be read/);
  assert.equal(cy.res.ended, 1);
  assert.equal(bo.res.ended, 1);
  assert.equal(push.open, 0);
  assert.equal(push.stats.timed_out, 0, "answered when the read failed, not at the deadline");
  assert.equal(timers.count, 0);
});

test("POS-887 UNREADABLE, in the open: a reader who was out in the open and can no longer be placed has the stream ended too", async () => {
  const b = roomBench({ dan: { x: 2000, y: 2000 }, eve: { x: 2001, y: 2000 } }, {});
  const push = createSayPush({ voices: b.store, nearbyMany: b.nearbyMany });
  const wire = await onWire(push, "eve");
  b.tick(20_000);
  await b.store.say("dan", "a word out in the open");
  await push.settled();
  assert.deepEqual(saidOn(wire.res), ["a word out in the open"], "the admitting control: a placed reader in the open IS served");
  delete b.at.eve;
  b.tick(20_000);
  await b.store.say("dan", "a word eve cannot be placed to hear");
  await push.settled();
  assert.ok(!wire.res.body.includes("cannot be placed to hear"), "an unplaced reader is served nothing, in the open as in a room");
  assert.equal(wire.res.ended, 1);
  assert.equal(push.open, 0);
});

test("POS-887 THE BEAT, one look at a time: a beat still looking is not joined by another, and a beat that trips ends the stream", async () => {
  let tick = null; // this test drives the interval by hand
  const MARK = 62_000;
  const [setIt, clearIt] = [globalThis.setInterval, globalThis.clearInterval];
  globalThis.setInterval = (fn, ms, ...rest) => { if (ms !== MARK) return setIt(fn, ms, ...rest); tick = fn; return MARK; };
  globalThis.clearInterval = (h) => { if (h !== MARK) return clearIt(h); tick = null; };
  try {
    const looks = { calls: 0, held: gate() };
    const opened = { close: () => {}, onEnd: () => {}, beat: () => { looks.calls += 1; return looks.held.promise; } };
    const res = fakeRes();
    await serveSayStream(new EventEmitter(), res, async () => opened, { beatMs: MARK });
    for (let i = 0; i < 5; i++) tick();
    assert.equal(looks.calls, 1, "five ticks while one look is out make one look, not five");
    looks.held.open(true);
    await turns(2);
    assert.ok(res.body.includes(": beat"), "the look that finished writes its beat");
    tick();
    assert.equal(looks.calls, 2, "and once it is done the next tick looks again");
    // a look that trips ends the stream, rather than leaving a beat that fails every time
    const tripped = new EventEmitter();
    const res2 = fakeRes();
    await serveSayStream(tripped, res2, async () => ({ close: () => {}, onEnd: () => {}, beat: () => Promise.reject(new Error("the look tripped")) }), { beatMs: MARK });
    tick();
    await turns(2);
    assert.equal(res2.ended, 1);
    assert.equal(tick, null, "and its beat was stopped");
  } finally {
    globalThis.setInterval = setIt;
    globalThis.clearInterval = clearIt;
  }
});

test("POS-887 THE BODY: the stream looks at the body it opened with, not at its own label — a human stands where a housemate stands", async () => {
  const b = roomBench({ ann: { x: 2000, y: 2000 }, cy: { x: 2001, y: 2000 } }, { ann: HALL, cy: HALL });
  const push = createSayPush({ voices: b.store, nearbyMany: b.nearbyMany });
  const label = "human-of-the-invented-house"; // placed nowhere: only cy's body is
  const events = [];
  const s = await push.stream(label, { standAs: "cy" }, (r) => events.push(r));
  b.tick(20_000);
  await b.store.say("ann", "a word for the house");
  await push.settled();
  assert.equal(events.length, 2, "the admitting control: beside cy, in the hall, the human IS served (a look at the label would find nobody)");
  assert.equal(await s.beat(), true);
  b.inRoom.cy = null;
  b.tick(20_000);
  await b.store.say("ann", "a word after the housemate left");
  await push.settled();
  assert.ok(!JSON.stringify(events).includes("after the housemate left"), "the human is not served the hall once the body they stand in has left it");
  assert.equal(events.length, 2);
  assert.equal(push.open, 0);
});

test("POS-887 THE EAR WALKS: in the same room a stream is served from where its reader stands now; out of earshot it stays open and unserved, and a beat finds it again", async () => {
  const b = roomBench({ ann: { x: 2000, y: 2000 }, cy: { x: 2001, y: 2000 } }, { ann: HALL, cy: HALL });
  const push = createSayPush({ voices: b.store, nearbyMany: b.nearbyMany });
  const events = [];
  const s = await push.stream("cy", {}, (r) => events.push(r));
  // walks within the hall, still in earshot: the answer is built from there, and the presence moves with it
  b.at.cy = { x: 2000, y: 2030 };
  b.tick(20_000);
  await b.store.say("ann", "one");
  await push.settled();
  assert.equal(events.length, 2);
  assert.equal(events[1].where.y, 2030, "built from where cy stands now, not where it opened");
  assert.equal(await s.beat(), true);
  assert.equal(b.store._presence.get("cy").y, 2030, "and counted present there");
  // walks out of earshot of the hall's speaker, in the same hall
  b.at.cy = { x: 2000, y: 2000 + EARSHOT_M + 50 };
  b.tick(20_000);
  await b.store.say("ann", "two");
  await push.settled();
  assert.equal(events.length, 2, "out of earshot, nothing is served");
  assert.equal(push.open, 1, "but it is still the hall, so the stream stays open");
  // walks back; the beat finds it, and the next voice reaches it with what it missed
  b.at.cy = { x: 2000, y: 2005 };
  assert.equal(await s.beat(), true);
  b.tick(20_000);
  await b.store.say("ann", "three");
  await push.settled();
  assert.deepEqual(events.at(-1).voices.map((v) => v.said), ["two", "three"]);
});

test("POS-887 TWO READERS: one reader leaving its room ends only its own stream, and each is served only the room it stands in", async () => {
  const b = roomBench({ ann: { x: 2000, y: 2000 }, cy: { x: 2001, y: 2000 }, bo: { x: 2002, y: 2000 }, dee: { x: 2003, y: 2000 } }, { ann: HALL, cy: HALL });
  const push = createSayPush({ voices: b.store, nearbyMany: b.nearbyMany });
  const cy = await onWire(push, "cy"); // opened in the hall
  const bo = await onWire(push, "bo"); // opened in the open
  b.inRoom.cy = CELLAR;
  b.tick(20_000);
  await b.store.say("dee", "an open word");
  await b.store.say("ann", "a hall word");
  await push.settled();
  assert.deepEqual(saidOn(bo.res), ["an open word"], "the reader in the open hears the open, and not the hall");
  assert.equal(bo.res.ended, 0, "and is not ended by another reader's move");
  assert.ok(!cy.res.body.includes("a hall word"), "the reader who went to the cellar is not served the hall");
  assert.ok(!cy.res.body.includes("an open word"), "nor the open");
  assert.equal(cy.res.ended, 1);
  assert.equal(push.open, 1);
});
