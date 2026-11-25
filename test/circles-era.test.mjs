// circles-era.test.mjs — POS-1218: speech from before circles went live reads as one flowing conversation per room.
//
// THE RULING (Wright, 2026-11-24 16:59:45Z, on POS-1218, picking the build): "The boundary is the deploy instant
// 2026-11-22T10:19:06.729Z, with act 60672 a valid modern origin opener. Build the shared reader's pre-circles reading: says before the
// instant read as one flowing conversation per room, later ones as circles, and the derived legacy roots get corrected."
// Darko, 2026-11-24 08:48 EST on CORE-177: "It's a little different for this one because we didn't have circles back then".
//
// The rule is the speech TIME against that instant, and nothing else: a missing `reply_to` or `place_mark` does not make a say old,
// because a modern room has independent openers with neither. So this file pairs every pre-boundary room with a control that has the
// SAME shape spoken after the instant, and the control must stay circles (a no-edges heuristic fails it). Every name, id and
// time is invented. It drives the pure views (src/circles.mjs), the memory read (voices.mjs, the say door and its page feed) and the
// historical read (world2/tools/conversations.mjs, the store's act decoder), which share circleIndex.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

process.env.WORLD_CLONE = join(tmpdir(), "postmark-no-world-clone-xyz");
const C = await import("../src/circles.mjs");
const { createVoices } = await import("../src/voices.mjs");
const port = await import("../world2/tools/conversations.mjs");

const B = Date.parse("2026-11-22T10:19:06.729Z"); // when circles went live
const MIN = 60_000;
const before = (min) => B - 60 * MIN + min * MIN; // an hour before, then minutes on
const after = (min) => B + 60 * MIN + min * MIN; // an hour after, then minutes on
// a voice: [id, handle, time, reply_to, text]
const voicesOf = (rows) => rows.map(([id, handle, t, reply, text]) => ({ id, handle, at: t, text, x: 0, y: 0, ...(reply ? { reply_to: reply } : {}) }));
const ids = (lines) => lines.map((l) => l.id);

// SIX identified, parentless says from four handles, spoken before circles went live: Facet's counterexample in miniature.
const OLD = [[31001, "ada", 1], [31002, "bram", 2], [31003, "ada", 3], [31004, "cato", 4], [31005, "dell", 5], [31006, "bram", 6]];
const oldRoom = () => voicesOf(OLD.map(([id, h, m]) => [id, h, before(m), null, `old ${id}`]));
// the SAME shape, spoken after: six independent openers, no replies anywhere
const newRoom = () => voicesOf(OLD.map(([id, h, m]) => [id + 1000, h, after(m), null, `new ${id + 1000}`]));

test("the boundary is the instant itself: a say a millisecond before it is pre-circles, the instant and after are circles", () => {
  assert.equal(C.CIRCLES_LIVE_AT, "2026-11-22T10:19:06.729Z");
  assert.equal(C.CIRCLES_LIVE_MS, B);
  assert.equal(C.spokenBeforeCircles({ at: B - 1 }), true);
  assert.equal(C.spokenBeforeCircles({ at: B }), false, "at the instant the office was listening: a circle");
  assert.equal(C.spokenBeforeCircles({ at: B + 1 }), false);
  assert.equal(C.spokenBeforeCircles({}), false, "no time is never guessed old");
  const edge = voicesOf([[32001, "ada", B - 1, null, "just before"], [32002, "bram", B, null, "at it"], [32003, "cato", B + 1, null, "just after"]]);
  const ix = C.circleIndex(edge);
  assert.deepEqual(ids(ix.timeline), [32001]);
  assert.deepEqual(ix.tops.map((v) => v.id), [32002, 32003]);
});

test("several identified pre-boundary openers are ONE flowing conversation: every id intact, no circle among them", () => {
  const room = oldRoom();
  const ix = C.circleIndex(room);
  assert.deepEqual(ix.tops, [], "LAW POS-1218: old identified openers are not top circles");
  assert.deepEqual(ids(ix.timeline), OLD.map(([id]) => id), "all six, in the order spoken");
  const lines = C.sayLines(room);
  assert.deepEqual(ids(lines), OLD.map(([id]) => id), "ids are never stripped");
  assert.ok(lines.every((l) => !("circle" in l) && !("reply_to" in l)), "the derived legacy roots are corrected: no line names a circle");
  assert.deepEqual(lines.map((l) => l.said), room.map((v) => v.text), "speech untouched");
  const v = C.circleView(room, { caller: "ada" });
  assert.equal(v.room.top_circles, 0);
  assert.equal(v.yours, null, "a caller who spoke only before circles has no circle of their own, and none is made up");
  assert.deepEqual(v.elsewhere, []);
  assert.deepEqual(ids(v.timeline), OLD.map(([id]) => id), "one timeline for the room");
  assert.equal(v.counts.timeline, 6);
  assert.deepEqual(v.pre_circles, { before: C.CIRCLES_LIVE_AT, says: 6, note: C.PRE_CIRCLES_NOTE }, "the read says which lines are from before circles");
  assert.equal(v.broken, undefined);
});

test("CONTROL: the same shape spoken after the instant is still six circles, with no timeline and no pre-circles block", () => {
  const room = newRoom();
  const ix = C.circleIndex(room);
  assert.deepEqual(ix.tops.map((t) => t.id), OLD.map(([id]) => id + 1000), "each opener tops its own circle");
  assert.deepEqual(ix.timeline, []);
  assert.deepEqual(C.sayLines(room).map((l) => l.circle), room.map((v) => v.id), "each line names itself as its circle");
  const v = C.circleView(room, { caller: null });
  assert.equal(v.room.top_circles, 6);
  assert.equal(v.elsewhere.length, 6);
  assert.equal(v.timeline, undefined);
  assert.equal(v.pre_circles, undefined);
});

test("CONTROL: the origin opener (act 60672's shape: identified, no reply_to, no place_mark) is a modern circle by itself", () => {
  const origin = voicesOf([[60672, "wren", after(0), null, "let there be light"]]);
  assert.equal("place_mark" in origin[0], false);
  const v = C.circleView(origin, { caller: null });
  assert.deepEqual(v.elsewhere.map((s) => [s.circle, s.says]), [[60672, 1]]);
  assert.equal(v.timeline, undefined);
  assert.equal(C.sayLines(origin)[0].circle, 60672);
  const read = C.circleRead(origin, 60672);
  assert.deepEqual(read.path, [60672]);
  assert.equal(read.pre_circles, undefined);
});

test("a mixed room keeps both eras: the old openers flow, the later openers and their reply chain are circles with their ancestry", () => {
  const room = voicesOf([
    [33001, "ada", before(1), null, "old one"],
    [33002, "bram", before(2), null, "old two"],
    [33003, "cato", before(3), null, "old three"],
    [33010, "dell", after(1), null, "new opener, no mark"],
    [33011, "ada", after(2), 33010, "reply to it"],
    [33012, "bram", after(3), 33011, "and again"],
    [33020, "cato", after(4), null, "a second independent opener"],
  ]);
  const ix = C.circleIndex(room);
  assert.deepEqual(ids(ix.timeline), [33001, 33002, 33003]);
  assert.deepEqual(ix.tops.map((t) => t.id), [33010, 33020]);
  assert.deepEqual(ix.pathOf(33012), [33010, 33011, 33012], "ancestry is the recorded edges");
  assert.equal(ix.rootOf(room.find((v) => v.id === 33012)), 33010);
  assert.equal(ix.rootOf(room.find((v) => v.id === 33002)), null);
  const v = C.circleView(room, { caller: "ada" });
  assert.equal(v.yours, 33010, "ada spoke in both eras; her circle is the modern one");
  assert.deepEqual(ids(v.lines), [33010, 33011, 33012]);
  assert.deepEqual(v.elsewhere.map((s) => [s.circle, s.says]), [[33020, 1]]);
  assert.deepEqual(ids(v.timeline), [33001, 33002, 33003]);
  assert.deepEqual(v.room, { says: 7, people: 4, top_circles: 2 });
  assert.equal(v.pre_circles.says, 3);
  const w = C.withRead(room, "ada");
  assert.deepEqual(w.circles.map((s) => s.circle), [33010], "a circle stub for the modern circle only, never one per old say");
  assert.deepEqual(ids(w.lines), [33001, 33010, 33011], "her old say is a line (then the modern say she answered, as context, and her answer)");
  assert.ok(w.lines.find((l) => l.id === 33001) && !("circle" in w.lines.find((l) => l.id === 33001)), "the old line names no circle");
});

test("old unidentified lines and old identified says are one timeline together, in time order", () => {
  const room = [
    { handle: "rei", text: "no id, old", at: before(0), x: 0, y: 0 },
    ...voicesOf([[34001, "ada", before(1), null, "identified, old"]]),
    { handle: "cato", text: "no id, later still old", at: before(2), x: 0, y: 0 },
  ];
  const v = C.circleView(room, { caller: null });
  assert.deepEqual(v.timeline.map((l) => l.said), ["no id, old", "identified, old", "no id, later still old"]);
  assert.deepEqual(v.timeline.map((l) => l.id ?? null), [null, 34001, null], "ids only where recorded");
  assert.equal(v.pre_circles.says, 1, "only the identified one is counted as pre-circles speech; the lines that never had an id keep reading as they always did");
});

test("NAMED FALLBACK: a recorded reply to an old say keeps its edge; that old say stays the root of the circle it opened (nothing synthesised)", () => {
  const room = voicesOf([
    [35001, "ada", before(1), null, "old, never answered"],
    [35002, "bram", before(2), null, "old, answered long after"],
    [35003, "cato", after(1), 35002, "a modern reply to it"],
  ]);
  const ix = C.circleIndex(room);
  assert.deepEqual(ids(ix.timeline), [35001]);
  assert.deepEqual(ix.tops.map((t) => t.id), [35002], "today's behaviour for a say a recorded reply names");
  assert.deepEqual(ix.pathOf(35003), [35002, 35003]);
  assert.equal(C.sayLines(room).find((l) => l.id === 35003).circle, 35002);
});

test("a say from before circles is still readable by its id: its own line, no circle, the era said, never unavailable", () => {
  const room = oldRoom();
  const read = C.circleRead(room, 31003);
  assert.deepEqual(read.path, [31003]);
  assert.deepEqual(ids(read.lines), [31003]);
  assert.equal("circle" in read.lines[0], false);
  assert.equal(read.complete, true);
  assert.deepEqual(read.pre_circles, { before: C.CIRCLES_LIVE_AT, note: C.PRE_CIRCLES_NOTE });
  const clusters = [{ voices: room, latest: room.at(-1).at }];
  const thread = (c) => ({ id: `t${c.voices[0].at}-${c.voices[0].handle}`, voice_count: c.voices.length, voices: C.sayLines(c.voices.slice(-2)) });
  const byId = C.findConversation(clusters, { circle: 31003 }, { thread, source: "record" });
  assert.equal(byId.history, "complete");
  assert.equal(byId.circle_read.pre_circles.before, C.CIRCLES_LIVE_AT);
  const byRoom = C.findConversation(clusters, { room: `t${room[0].at}-ada` }, { thread, source: "record" });
  assert.equal(byRoom.history, "complete");
  assert.deepEqual(byRoom.circles.elsewhere, [], "the room lookup lists no stub per old say");
  assert.deepEqual(ids(byRoom.circles.timeline), OLD.map(([id]) => id));
  assert.equal(byRoom.circles.pre_circles.says, 6);
});

test("since: an old say among the new ones arrives as a plain line, with no circle named for it", () => {
  const room = voicesOf([[36001, "ada", before(1), null, "old"], [36002, "bram", after(1), null, "new"], [36003, "cato", after(2), 36002, "answer"]]);
  const r = C.sinceRead(room, before(0));
  assert.deepEqual(r.lines.map((l) => [l.id, l.circle ?? null]), [[36001, null], [36002, 36002], [36003, 36002]]);
});

// ── the memory read: the say door, its page feed and the named lookups (src/voices.mjs) ──

const DIR = mkdtempSync(join(tmpdir(), "circles-era-"));
let logN = 0;
function door(where, startAt) {
  const clock = { t: startAt };
  let next = 41001;
  const store = createVoices({
    standpoint: async (handle) => ({ handle, placed: true, ...where[handle], aboard: false, moving: false }),
    place: async () => "the lantern yard",
    logPath: join(DIR, `voices-${++logN}.jsonl`),
    now: () => clock.t,
    hearingWindow: () => ({ since: startAt - 6 * 60 * MIN, source: "the bench", disclosure: null }),
    settlements: () => [startAt - 6 * 60 * MIN],
    beforeSpoke: async () => ({ id: next++ }),
  });
  return { store, clock };
}
const here = { ada: { x: 0, y: 0 }, bram: { x: 5, y: 0 }, cato: { x: 9, y: 0 }, dell: { x: 12, y: 0 } };

test("MEMORY, the say door: openers spoken before the instant read as the room's timeline, and the page feed's lines name no circle", async () => {
  const d = door(here, before(0));
  for (const h of ["ada", "bram", "cato", "dell"]) { d.clock.t += 16_000; await d.store.say(h, `hello from ${h}`); }
  const listen = await d.store.hear("ada");
  const c = listen.conversation.circles;
  assert.equal(c.room.top_circles, 0);
  assert.deepEqual(c.elsewhere, []);
  assert.deepEqual(ids(c.timeline), [41001, 41002, 41003, 41004]);
  assert.equal(c.pre_circles.says, 4);
  const [thread] = d.store.conversations().live;
  assert.deepEqual(thread.voices.map((v) => [v.id, v.circle ?? null]), [[41001, null], [41002, null], [41003, null], [41004, null]], "the feed's derived legacy roots are gone, ids stay");
  const room = d.store.conversations({ find: { room: thread.id } }).find;
  assert.equal(room.history, "complete");
  assert.deepEqual(ids(room.circles.timeline), [41001, 41002, 41003, 41004]);
  assert.deepEqual(room.circles.elsewhere, []);
  const one = d.store.conversations({ find: { circle: 41003 } }).find;
  assert.equal(one.history, "complete", "an old say's id still answers");
  assert.ok(one.circle_read.pre_circles);
  const sayCircle = await d.store.hear("ada", { circle: 41002 });
  assert.ok(JSON.stringify(sayCircle).includes("\"pre_circles\""), "say { circle: <old id> } reads it, saying which era");
});

test("MEMORY CONTROL: the same four openers spoken after the instant are four circles", async () => {
  const d = door(here, after(0));
  for (const h of ["ada", "bram", "cato", "dell"]) { d.clock.t += 16_000; await d.store.say(h, `hello from ${h}`); }
  const listen = await d.store.hear("ada");
  const c = listen.conversation.circles;
  assert.equal(c.room.top_circles, 4);
  assert.equal(c.yours, 41001, "ada's own circle");
  assert.deepEqual(c.elsewhere.map((s) => s.circle), [41002, 41003, 41004]);
  assert.equal(c.timeline, undefined);
  assert.equal(c.pre_circles, undefined);
  const [thread] = d.store.conversations().live;
  assert.deepEqual(thread.voices.map((v) => v.circle), [41001, 41002, 41003, 41004]);
});

test("MEMORY, a mixed room: the clock crosses the instant inside one room, and both eras keep their reading", async () => {
  const d = door(here, before(0));
  for (const h of ["ada", "bram", "cato"]) { d.clock.t += 16_000; await d.store.say(h, `old ${h}`); }
  d.clock.t = after(0);
  await d.store.say("dell", "a new opener");          // 41004
  d.clock.t += 16_000;
  await d.store.say("ada", "an answer", { replyTo: 41004 }); // 41005
  d.clock.t += 16_000;
  await d.store.say("cato", "another independent opener"); // 41006
  const [thread] = d.store.conversations().live;
  assert.deepEqual(thread.voices.map((v) => [v.id, v.circle ?? null, v.reply_to ?? null]),
    [[41001, null, null], [41002, null, null], [41003, null, null], [41004, 41004, null], [41005, 41004, 41004], [41006, 41006, null]]);
  const room = d.store.conversations({ find: { room: thread.id } }).find;
  assert.deepEqual(room.circles.elsewhere.map((s) => [s.circle, s.says]), [[41004, 2], [41006, 1]]);
  assert.deepEqual(ids(room.circles.timeline), [41001, 41002, 41003]);
  const circle = d.store.conversations({ find: { circle: 41005 } }).find;
  assert.deepEqual(circle.circle_read.path, [41004, 41005]);
});

// ── the historical read: the store's act decoder and the vendored thread (world2/tools/conversations.mjs) ──

const row = (id, actor, t, payload = {}) => ({ id, at: new Date(t), actor, action: "say", at_anchor: "lantern/the-yard", at_dx: 1, at_dy: 0, payload: { text: `act ${id}`, ...payload } });
const decode = (rows) => port.voiceRecords(rows, { centreOf: () => ({ x: 0, y: 0 }) }).voices;
const read = (voices, now, find = null) => port.conversationsOf(voices, { now, earshotM: 60, boundaries: [before(0) - 6 * 60 * MIN], fadeMs: 300_000, ...(find ? { find } : {}) });

test("HISTORICAL: acts spoken before the instant decode with their ids and read as one flowing conversation; the thread's lines name no circle", () => {
  const rows = OLD.map(([id, h, m]) => row(id, h, before(m)));
  const voices = decode(rows);
  assert.deepEqual(voices.map((v) => v.id), OLD.map(([id]) => id), "the decoder still gives every say its act id");
  const out = read(voices, before(10));
  const [thread] = out.live;
  assert.deepEqual(thread.voices.map((v) => [v.id, v.circle ?? null]), OLD.map(([id]) => [id, null]));
  const found = read(voices, before(10), { room: thread.id }).find;
  assert.equal(found.history, "complete");
  assert.deepEqual(found.circles.elsewhere, []);
  assert.deepEqual(ids(found.circles.timeline), OLD.map(([id]) => id));
  assert.equal(found.circles.pre_circles.says, 6);
  const one = read(voices, before(10), { circle: 31004 }).find;
  assert.equal(one.history, "complete");
  assert.deepEqual(one.circle_read.path, [31004]);
});

test("HISTORICAL boundary through the decoder, Date rows as the store hands them: B-1 ms is pre-circles, B and B+1 are circles", () => {
  const rows = [row(38001, "ada", B - 1), row(38002, "bram", B), row(38003, "cato", B + 1), row(38004, "dell", B + 271)];
  assert.ok(rows.every((r) => r.at instanceof Date));
  const voices = decode(rows);
  assert.deepEqual(voices.map((v) => v.at), [B - 1, B, B + 1, B + 271], "the decoder keeps the Date's milliseconds");
  const ix = C.circleIndex(voices);
  assert.deepEqual(ids(ix.timeline), [38001]);
  assert.deepEqual(ix.tops.map((t) => t.id), [38002, 38003, 38004]);
  const asString = decode(rows.map((r) => ({ ...r, at: r.at.toISOString() })));
  assert.deepEqual(asString.map((v) => v.at), [B - 1, B, B + 1, B + 271], "an ISO string reads the same");
});

test("HISTORICAL CONTROL: the same acts spoken after the instant, with no place mark and no reply, are six circles", () => {
  const rows = OLD.map(([id, h, m]) => row(id + 1000, h, after(m)));
  const voices = decode(rows);
  assert.ok(voices.every((v) => v.place_mark === undefined && v.reply_to === undefined), "the shape: identified, parentless, unmarked");
  const [thread] = read(voices, after(10)).live;
  assert.deepEqual(thread.voices.map((v) => v.circle), voices.map((v) => v.id));
  const found = read(voices, after(10), { room: thread.id }).find;
  assert.equal(found.circles.room.top_circles, 6);
  assert.equal(found.circles.timeline, undefined);
  assert.equal(found.circles.pre_circles, undefined);
});

test("HISTORICAL, a mixed room with a reply chain: the old acts flow, the later circles keep their ancestry and a mark", () => {
  const rows = [
    row(37001, "ada", before(1)), row(37002, "bram", before(2)),
    row(37010, "cato", after(1), { place_mark: "lantern/the-yard" }),
    row(37011, "dell", after(2), { reply_to: 37010 }),
    row(37020, "ada", after(3)),
  ];
  const voices = decode(rows);
  const [thread] = read(voices, after(10)).live;
  assert.deepEqual(thread.voices.map((v) => [v.id, v.circle ?? null]), [[37001, null], [37002, null], [37010, 37010], [37011, 37010], [37020, 37020]]);
  assert.equal(thread.place_mark, undefined, "the room's start was pre-circles and recorded no mark: unknown stays absent");
  const found = read(voices, after(10), { room: thread.id }).find;
  assert.deepEqual(found.circles.elsewhere.map((s) => [s.circle, s.says]), [[37010, 2], [37020, 1]]);
  assert.deepEqual(ids(found.circles.timeline), [37001, 37002]);
  assert.equal(found.circles.elsewhere[0].place_mark, "lantern/the-yard");
  const chain = read(voices, after(10), { circle: 37011 }).find;
  assert.deepEqual(chain.circle_read.path, [37010, 37011]);
});
