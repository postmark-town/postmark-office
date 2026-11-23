// conversation-place-mark.test.mjs — POS-1152: a conversation's ROOT records the mark it started at.
//
// Wright (2026-11-19 21:51Z): "the place where each conversation started, and only when that place is a recorded mark id. No picture
// for a conversation whose start place wasn't recorded, and nothing inferred from today's coordinates or names." The office records
// `place_mark` (a canonical mark id) once, on each new root say, from its own write-time derivation (world.mjs § placeMarkAt, injected
// into voices.mjs as `placeMark`). This file drives the real say door, the voices log and its rebuild, the circle and thread reads,
// the store's act decoder and the pen's payload; every name is synthetic. A later voice, a moved speaker, a joined room or a reply
// never replaces the start, and unknown stays absent.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

process.env.WORLD_CLONE = join(tmpdir(), "postmark-no-world-clone-xyz");
const { createVoices } = await import("../src/voices.mjs");
const C = await import("../src/circles.mjs");
const port = await import("../world2/tools/conversations.mjs");
const { penVoiceAct } = await import("../src/world.mjs");

const T = Date.parse("2026-11-19T20:00:00Z");
const DIR = mkdtempSync(join(tmpdir(), "place-mark-"));
let logN = 0;
const A = "quill/the-yard", B = "quill/the-porch";
// the write-time place, by where the speaker stands: x < 30 is mark A, x 30..59 is mark B, x >= 60 stands on no mark (unknown)
const markAt = ({ x }) => (x < 30 ? A : x < 60 ? B : null);

function door(where, { placeMark = async (at) => markAt(at), memoryMax, path = join(DIR, `voices-${++logN}.jsonl`), rooms = {} } = {}) {
  const clock = { t: T };
  let next = 70001;
  const asked = [], written = [];
  const make = () => createVoices({
    standpoint: async (handle) => ({ handle, placed: true, ...where[handle], aboard: false, moving: false }),
    place: async () => "the yard",
    placeMark: async (at) => { asked.push(at); return placeMark(at); },
    roomOf: async (handle) => rooms[handle] ?? null,
    logPath: path,
    now: () => clock.t,
    hearingWindow: () => ({ since: T - 3_600_000, source: "the bench", disclosure: null }),
    settlements: () => [T - 3_600_000],
    ...(memoryMax ? { memoryMax } : {}),
    beforeSpoke: async (voice) => { written.push({ ...voice }); return { id: next++ }; },
  });
  return { store: make(), remake: make, clock, path, asked, written, tick: (ms = 16_000) => { clock.t += ms; } };
}
const logOf = (path) => readFileSync(path, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const whereAll = { pica: { x: 5, y: 0 }, seth: { x: 40, y: 0 }, claran: { x: 20, y: 0 } };

test("the root starts at A; a reply spoken from B, a later top say at B and a rebuilt log all leave the room and the circle at A", async () => {
  const d = door({ ...whereAll });
  await d.store.say("pica", "Welcome!");                             // root, at A
  d.tick();
  await d.store.say("seth", "Is the lemon one sour?", { replyTo: 70001 }); // a reply, from B
  d.tick();
  await d.store.say("seth", "A new topic, from the porch");            // a second root, at B, joining the same acoustic room
  d.tick();
  for (const store of [d.store, d.remake()]) {                          // the live memory, then a rebuild from the log alone
    const [thread] = store.conversations().live;
    assert.equal(thread.place_mark, A, "the room's root started at A, whatever came after");
    assert.deepEqual(thread.voices.map((v) => [v.id, v.place_mark ?? null]), [[70001, A], [70002, null], [70003, B]], "only a root say carries a mark: its own");
    const view = (await store.hear("claran")).conversation;
    assert.equal(view.place_mark, A, "the heard room names the same start");
    const stubs = new Map(view.circles.elsewhere.map((s) => [s.circle, s.place_mark ?? null]));
    assert.deepEqual([...stubs], [[70001, A], [70003, B]], "each circle's opener keeps its own start");
    const one = (await store.hear("claran", { circleAsk: { circle: 70001 } })).circle;
    assert.equal(one.place_mark, A, "the circle's page");
    const reply = (await store.hear("claran", { circleAsk: { circle: 70002 } })).circle;
    assert.equal(reply.place_mark, A, "a reply's page names its circle's start through its path, not the reply's own place");
    const named = store.conversations({ find: { circle: 70003 } }).find;
    assert.equal(named.circle_read.place_mark, B, "the second root's circle is its own start");
    assert.equal(named.room.place_mark, A, "while the room it sits in keeps the first root");
  }
});

test("the log carries the mark on root lines only, and a joiner's line carries its room's start beside the root's name", async () => {
  const d = door({ ...whereAll });
  await d.store.say("pica", "Welcome!"); d.tick();
  await d.store.say("seth", "reply", { replyTo: 70001 }); d.tick();
  await d.store.say("claran", "another top say, from A"); d.tick();
  const lines = logOf(d.path);
  assert.deepEqual(lines.map((l) => [l.handle, l.place_mark ?? null, l.root_place_mark ?? null]),
    [["pica", A, null], ["seth", null, A], ["claran", A, A]]);
  assert.equal(lines[1].root, lines[0].root ?? lines[1].root, "the root's name is carried as ever");
});

test("the circle reads: a root's page and every line down it name A, a reply's own page too (through its path), and a reply line has no mark", async () => {
  const d = door({ ...whereAll });
  await d.store.say("pica", "Welcome!"); d.tick();
  await d.store.say("seth", "reply from B", { replyTo: 70001 }); d.tick();
  const view = C.circleView([
    { handle: "pica", text: "Welcome!", at: T, x: 5, y: 0, id: 70001, place_mark: A },
    { handle: "seth", text: "reply from B", at: T + 16_000, x: 40, y: 0, id: 70002, reply_to: 70001, place_mark: B /* forged on a reply */ },
  ], { caller: "seth" });
  assert.equal(view.lines.find((l) => l.id === 70001).place_mark, A);
  assert.equal(view.lines.find((l) => l.id === 70002).place_mark, undefined, "a reply never lends or carries a mark");
  const page = C.circleRead([
    { handle: "pica", text: "Welcome!", at: T, x: 5, y: 0, id: 70001, place_mark: A },
    { handle: "seth", text: "reply from B", at: T + 16_000, x: 40, y: 0, id: 70002, reply_to: 70001 },
  ], 70002);
  assert.equal(page.place_mark, A, "a reply's own page names its circle's start through its path");
});

test("a root with no recorded mark, or a broken chain, has no field - even when a later reply stood at a known place", async () => {
  const d = door({ ...whereAll, far: { x: 500, y: 0 } }, { placeMark: async () => null });   // this office could not name the start
  await d.store.say("pica", "Welcome!"); d.tick();
  await d.store.say("seth", "reply, from a place the office could name now", { replyTo: 70001 }); d.tick();
  const [thread] = d.store.conversations().live;
  assert.equal(thread.place_mark, undefined, "unknown stays absent: nothing is guessed from a later say");
  for (const v of thread.voices) assert.equal(v.place_mark, undefined);
  // a broken chain: a reply whose parent this read does not hold borrows nothing from a later marked root
  const page = C.circleRead([
    { handle: "seth", text: "reply", at: T + 16_000, x: 40, y: 0, id: 70002, reply_to: 69999 },
    { handle: "pica", text: "marked root, later", at: T + 32_000, x: 5, y: 0, id: 70003, place_mark: A },
  ], 70002);
  assert.equal(page.place_mark, undefined);
  assert.ok(page.broken);
});

test("an old room's later top say does not become the room's start: the founder recorded none, so the header has none", async () => {
  let first = true;
  const d = door({ ...whereAll }, { placeMark: async (at) => { const m = first ? null : markAt(at); first = false; return m; } });
  await d.store.say("pica", "Welcome!"); d.tick();                    // the founder: no mark could be named
  await d.store.say("claran", "a later top say, at A, in the same room"); d.tick();
  const [thread] = d.store.conversations().live;
  assert.equal(thread.place_mark, undefined, "the later root's own start is its own circle's, not the room's");
  assert.deepEqual(thread.voices.map((v) => v.place_mark ?? null), [null, A]);
  assert.equal(d.remake().conversations().live[0].place_mark, undefined, "and after a rebuild");
});

test("the root's start survives its founding say leaving memory (the joiners carry it), and the log is the road", async () => {
  const d = door({ ...whereAll }, { memoryMax: 3 });
  await d.store.say("pica", "Welcome!"); d.tick();
  for (const [h, n] of [["seth", "two"], ["claran", "three"], ["seth", "four"], ["claran", "five"]]) { await d.store.say(h, n); d.tick(); }
  const [thread] = d.store.conversations().live;
  assert.ok(!thread.voices.some((v) => v.said === "Welcome!"), "the founding say has left memory");
  assert.equal(thread.place_mark, A, "its start did not leave with it");
});

// A BRIDGE: a say heard by two rooms joins them under the older root. Older room: pica at x 0 (founder), dan at x 8 joins.
// Younger room: seth at x 110 founds it at mark X, claran at x 118 joins (her line carries X as her room's start). The bridge is a say from x 55.
const X = "quill/the-barn";
async function bridged({ olderKnown }) {
  const mark = ({ x }) => (x < 30 ? (olderKnown ? A : null) : x >= 100 ? X : null);
  const where = { pica: { x: 0, y: 0 }, dan: { x: 8, y: 0 }, seth: { x: 110, y: 0 }, claran: { x: 118, y: 0 }, mara: { x: 55, y: 0 } };
  const d = door(where, { placeMark: async (at) => mark(at), memoryMax: 4 });   // the older founder leaves memory as the bridge is spoken
  for (const [h, t] of [["pica", "old room opens"], ["seth", "young room opens"], ["claran", "joins the young room"], ["dan", "joins the old room"]]) { await d.store.say(h, t); d.tick(); }
  const before = d.store.conversations().live.map((c) => c.place_mark ?? null).sort();
  await d.store.say("mara", "heard by both"); d.tick();
  return { d, before };
}

test("a bridge between an older room with NO recorded start and a younger room with one: the merged room has none, live, in the bridge line and after a rebuild", async () => {
  const { d, before } = await bridged({ olderKnown: false });
  assert.deepEqual(before, [null, X], "two rooms before the bridge: the young one's start, and none");
  for (const store of [d.store, d.remake()]) {
    const live = store.conversations().live;
    assert.equal(live.length, 1, "one room after the bridge");
    assert.equal(live[0].place_mark, undefined, "the younger room's start is not the older room's");
  }
  const bridge = logOf(d.path).at(-1);
  assert.equal(bridge.handle, "mara");
  assert.ok(bridge.merged?.length, "the bridge line records the merge");
  assert.equal(bridge.root_place_mark, undefined, "and carries no start it was never given");
});

test("a bridge into an older room with a recorded start keeps that room's own marker after its founder left memory: live, in the bridge line and after a rebuild", async () => {
  const { d } = await bridged({ olderKnown: true });
  assert.ok(!d.store.conversations().live[0].voices.some((v) => v.said === "old room opens"), "the older founder has left memory");
  for (const store of [d.store, d.remake()]) {
    const live = store.conversations().live;
    assert.equal(live.length, 1);
    assert.equal(live[0].place_mark, A, "the older room's own start, not the younger room's");
  }
  assert.equal(logOf(d.path).at(-1).root_place_mark, A);
});

test("a known mark id keeps its whole value through the new field: a long, valid id is carried by the room, the circle stub and the page, and a non-id is still dropped", async () => {
  const LONG = `quill/${"the-very-long-name-".repeat(14)}end`;
  assert.ok(LONG.length > 200);
  const d = door({ ...whereAll }, { placeMark: async () => LONG });
  await d.store.say("pica", "Welcome!"); d.tick();
  const [thread] = d.store.conversations().live;
  assert.equal(thread.place_mark, LONG);
  assert.equal(thread.voices[0].place_mark, LONG);
  assert.equal(C.markIdOf("not a mark id"), null);
  assert.equal(C.markIdOf("no-slash"), null);
  assert.equal(C.markIdOf(`${LONG}/child`), `${LONG}/child`);
  const page = (await d.store.hear("claran", { circleAsk: { circle: 70001 } })).circle;
  assert.equal(page.place_mark, LONG);
});

test("a caller cannot supply the mark, and a say inside a dungeon room records none and never asks", async () => {
  const d = door({ ...whereAll }, { rooms: { claran: "quill/the-keep#cellar" } });
  await d.store.say("pica", "Welcome!", { place_mark: "evil/invented", placeMark: "evil/invented" }); d.tick();
  assert.equal(d.written[0].place_mark, A, "the office's own derivation, not the caller's");
  const before = d.asked.length;
  await d.store.say("claran", "spoken inside a room"); d.tick();
  assert.equal(d.asked.length, before, "a room say never asks the resolver");
  assert.equal(d.written[1].place_mark, undefined);
  assert.equal(d.written[1].room, "quill/the-keep#cellar");
});

test("the pen's write: a root act carries the mark in its payload; a reply act, a room act and an unknown carry none", async () => {
  const entries = [];
  const deps = { witnessStampAt: async () => ({ at: { anchor: A, dx: 1, dy: 1 }, witnesses: { source: "presence", list: [] } }),
    appendActFlipped: async (_c, entry) => { entries.push(entry); return { seq: 1, actId: 9 }; }, currentCrossing: () => 1, actsHaveNonce: async () => false };
  const base = { handle: "pica", text: "hi", at: T, x: 5, y: 0, place: "the yard", aboard: false };
  await penVoiceAct({ ...base, place_mark: A }, null, deps);
  await penVoiceAct({ ...base, place_mark: B, reply_to: 70001 }, null, deps);
  await penVoiceAct({ ...base, place_mark: A, room: "quill/the-keep#cellar" }, null, deps);
  await penVoiceAct({ ...base }, null, deps);
  assert.deepEqual(entries.map((e) => e.payload.place_mark ?? null), [A, null, null, null]);
});

test("the store's record: a root act's mark is decoded, a reply's or a room say's is not, and the thread and the stub name it", () => {
  const row = (id, over = {}, payload = {}) => ({ id, at: new Date(T + (id - 1) * 1000), actor: id % 2 ? "pica" : "seth", action: "say",
    at_anchor: "quill/the-yard", at_dx: 3, at_dy: 0, payload: { text: `say ${id}`, ...payload }, ...over });
  const rows = [row(1, {}, { place_mark: A }), row(2, {}, { reply_to: 1, place_mark: B }), row(3, {}, { place_mark: B, room: "quill/the-keep#cellar" }), row(4, {}, { place_mark: "not a mark id" })];
  const { voices } = port.voiceRecords(rows, { centreOf: () => ({ x: 0, y: 0 }) });
  assert.deepEqual(voices.map((v) => v.place_mark ?? null), [A, null, null, null]);
  const out = port.conversationsOf(voices.filter((v) => v.id !== 3), { now: T + 60_000, earshotM: 60, boundaries: [T - 1000], fadeMs: 300_000 });
  assert.equal(out.live[0].place_mark, A, "the thread names its root's start");
  assert.deepEqual(out.live[0].voices.map((v) => v.place_mark ?? null), [A, null, null]);
  const named = port.conversationsOf(voices.filter((v) => v.id !== 3), { now: T + 60_000, earshotM: 60, boundaries: [T - 1000], fadeMs: 300_000, find: { circle: 1 } });
  assert.equal(named.find.circle_read.place_mark, A);
  assert.equal(named.find.room.place_mark, A);
});

test("the vendored thread and the producer agree on the header with a mark (the same derivation, twice)", () => {
  const voices = [
    { handle: "pica", text: "a", at: T, x: 5, y: 0, id: 1, place_mark: A },
    { handle: "seth", text: "b", at: T + 1000, x: 40, y: 0, id: 2, reply_to: 1 },
    { handle: "claran", text: "c", at: T + 2000, x: 40, y: 0, id: 3, place_mark: B },
  ];
  const mine = port.threadOf({ voices }, { live: true, voiceCap: 10 });
  assert.equal(mine.place_mark, A);
  assert.equal(mine.place, null, "`place` and `at` keep their meaning: the latest voice's, not the start");
  assert.deepEqual(mine.at, { x: 40, y: 0 });
});
