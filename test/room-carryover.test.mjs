// room-carryover.test.mjs — CORE-97: a room carries across a settlement when anyone contributes in the hour after it (Darko 2026-11-14; Wright's settlement 15:54Z).
//
// Slice 1: the one shared policy (`roomOpen` / `edgeAfter` / ROOM_GRACE_MS, src/hearing-window.mjs). Slice 2: the readers — the memory (voices.mjs: clustering, liveness,
// hearing), the stored record (world2/tools/conversations.mjs) and the stored say read (world2-serve.mjs) — all on invented speakers and explicit settlement instants.
//
//   node --test test/room-carryover.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ROOM_GRACE_MS, edgeAfter, roomOpen } from "../src/hearing-window.mjs";

process.env.WORLD_CLONE = join(tmpdir(), "postmark-no-world-clone-xyz");
const { createVoices, EARSHOT_M, clusterVoices } = await import("../src/voices.mjs");
const port = await import("../world2/tools/conversations.mjs");

const H = 3600_000;
const S1 = Date.UTC(2026, 10, 14, 6, 0, 0);   // an invented settlement
const S2 = S1 + 12 * H;                        // the next

test("the grace is one hour", () => { assert.equal(ROOM_GRACE_MS, H); });

test("edgeAfter: the first settlement strictly after an instant", () => {
  assert.equal(edgeAfter(S1 - 1, [S1, S2]), S1);
  assert.equal(edgeAfter(S1, [S1, S2]), S2, "a say AT a settlement is in the new epoch: the next edge is the one after");
  assert.equal(edgeAfter(S2 + 1, [S1, S2]), null);
  assert.equal(edgeAfter(0, []), null);
});

test("a room is open inside its settlement, for an hour past the one after its newest say, and then closed", () => {
  const marks = [S1, S2];
  assert.equal(roomOpen(S1 - 10 * 60_000, S1 - 1, marks), true, "before the settlement: open");
  assert.equal(roomOpen(S1 - 10 * 60_000, S1 + 30 * 60_000, marks), true, "inside the hour after: still open, nothing said yet");
  assert.equal(roomOpen(S1 - 10 * 60_000, S1 + H, marks), true, "at the hour exactly: open");
  assert.equal(roomOpen(S1 - 10 * 60_000, S1 + H + 1, marks), false, "past the hour with no say: closed");
  assert.equal(roomOpen(S1 + 30 * 60_000, S2 - 1, marks), true, "a room carried by a say in the hour lives to the next settlement with no idle timeout");
  assert.equal(roomOpen(S1 + 30 * 60_000, S2 + H + 1, marks), false, "and the same hour test applies again at the next settlement");
  assert.equal(roomOpen(5, 10, []), true, "no settlement known: open");
});

// ── the memory: createVoices over invented speakers ──────────────────────────
const MIN = 60_000;
const T0 = Date.UTC(2026, 10, 14, 5, 40, 0);   // twenty minutes before the settlement at 06:00Z
const DIR = mkdtempSync(join(tmpdir(), "postmark-carryover-"));
let logN = 0;
function bench(at, more = {}) {
  const clock = { t: T0, settledAt: T0 - 5 * H };
  const store = createVoices({
    standpoint: async (handle) => { const p = at[handle]; return p ? { handle, placed: true, x: p.x, y: p.y, aboard: false, moving: false } : { handle, placed: false }; },
    place: async ({ x, y }) => `the ground at ${x},${y}`,
    logPath: join(DIR, `v-${++logN}.jsonl`),
    now: () => clock.t,
    hearingWindow: () => ({ since: clock.settledAt, source: "the test's settlement", disclosure: null }),
    settlements: () => [clock.settledAt],
    ...more,
  });
  return { store, clock, tick: (ms) => { clock.t += ms; }, settle: () => { clock.settledAt = clock.t; } };
}
const AT = { mira: { x: 0, y: 0 }, odo: { x: 10, y: 0 }, pell: { x: 20, y: 0 } };
const said = (r) => r.voices.map((v) => v.said);

test("a room across the edge is ONE room and its earlier says stay hearable through the grace", async () => {
  const { store, tick, settle } = bench(AT);
  await store.say("mira", "before the edge"); tick(30 * MIN);
  settle(); tick(10 * MIN);
  assert.deepEqual(said(await store.hear("pell")), ["before the edge"], "the room is still open ten minutes after the settlement: its earlier say is heard");
  const c = store.conversations();
  assert.equal(c.live.length, 1);
  assert.deepEqual(c.live[0].voices.map((v) => v.said), ["before the edge"]);
  await store.say("odo", "in the grace"); tick(16_000);
  const after = store.conversations();
  assert.equal(after.live.length, 1, "one room, not two");
  assert.equal(after.closed.length, 0);
  assert.equal(after.live[0].id, c.live[0].id, "the same stable room");
  assert.deepEqual(after.live[0].voices.map((v) => v.said), ["before the edge", "in the grace"]);
  assert.deepEqual(said(await store.hear("pell")), ["before the edge", "in the grace"]);
});

test("with no say in the hour the room closes at the hour: unheard, closed, and a later say cannot revive it", async () => {
  const { store, tick, settle } = bench(AT);
  await store.say("mira", "before the edge"); tick(30 * MIN);
  settle(); tick(ROOM_GRACE_MS + 1);
  assert.deepEqual(said(await store.hear("pell")), []);
  assert.deepEqual(store.conversations().live, []);
  await store.say("odo", "too late");
  const c = store.conversations();
  assert.equal(c.live.length, 1);
  assert.equal(c.closed.length, 1, "the closed room stays browsable");
  assert.deepEqual(c.live[0].voices.map((v) => v.said), ["too late"], "a late say starts a new room, it does not revive the old one");
  assert.deepEqual(said(await store.hear("pell")), ["too late"]);
});

test("a grace say carries the room through this settlement, but not silently through the next inactive grace", async () => {
  const { store, tick, settle, clock } = bench(AT);
  await store.say("mira", "one"); tick(30 * MIN);
  settle(); tick(10 * MIN);
  await store.say("odo", "carried"); tick(5 * 60 * 60_000);
  assert.deepEqual(said(await store.hear("pell")), ["one", "carried"], "hours later, still the same room: no idle timeout inside a settlement");
  settle(); tick(ROOM_GRACE_MS + 1); // the next settlement, and an inactive hour after it
  assert.deepEqual(said(await store.hear("pell")), []);
  assert.equal(store.conversations().live.length, 0);
  assert.equal(store.conversations().closed.length, 1);
  assert.ok(clock.t > T0);
});

test("a say in the grace of the NEXT settlement carries the room again", async () => {
  const { store, tick, settle } = bench(AT);
  await store.say("mira", "one"); tick(30 * MIN);
  settle(); tick(10 * MIN);
  await store.say("odo", "two"); tick(5 * 60 * 60_000);
  settle(); tick(10 * MIN);
  await store.say("pell", "three"); tick(16_000);
  const c = store.conversations();
  assert.equal(c.live.length, 1);
  assert.deepEqual(c.live[0].voices.map((v) => v.said), ["one", "two", "three"]);
});

test("spatial isolation holds: a say out of earshot never joins the carried room", async () => {
  const { store, tick, settle } = bench({ ...AT, far: { x: 5 * EARSHOT_M, y: 0 } });
  await store.say("mira", "here"); tick(30 * MIN);
  settle(); tick(10 * MIN);
  await store.say("far", "elsewhere"); tick(16_000);
  const c = store.conversations();
  assert.equal(c.live.length, 2);
  assert.deepEqual(said(await store.hear("pell")), ["here"], "pell hears the room beside them, not the far one");
});

test("a dungeon room's voices stay in their own room across the edge", async () => {
  const rooms = { odo: "the-keep" };
  const { store, tick, settle } = bench(AT, { roomOf: async (h) => rooms[h] ?? null });
  await store.say("mira", "in the open"); tick(30 * MIN);
  await store.say("odo", "in the keep"); tick(MIN);
  settle(); tick(10 * MIN);
  assert.deepEqual(said(await store.hear("pell")), ["in the open"], "the open reader hears only the open, carried");
  assert.deepEqual(said(await store.hear("odo")), ["in the keep"], "the keep's reader hears only the keep");
  assert.deepEqual(store.conversations().live.map((t) => t.voices.map((v) => v.said)), [["in the open"]], "the keyless page never shows the keep");
});

// ── the stored record: the vendored clusterVoices and conversationsOf equal the memory's ─────────────────
const v = (at, x = 0) => ({ handle: "a", text: "x", at, x, y: 0, place: null, aboard: false });
test("memory and stored clustering agree across the edge, in grace and past it", () => {
  const edge = T0 + 20 * MIN;
  for (const second of [edge + 10 * MIN, edge + H, edge + H + 1, edge + 5 * H]) {
    const voices = [v(T0), v(second)];
    const o = { earshotM: EARSHOT_M, boundaries: [edge] };
    assert.deepEqual(clusterVoices(voices, o).map((c) => c.voices.length), port.clusterVoices(voices, o).map((c) => c.voices.length), "memory = stored");
    const a = port.clusterVoices(voices, o).map((c) => c.voices.length);
    assert.deepEqual(a, second - edge <= H ? [2] : [1, 1], `second say ${second - edge} ms after the edge`);
    const page = port.conversationsOf(voices, { now: second + MIN, earshotM: EARSHOT_M, boundaries: [edge], fadeMs: 5 * MIN });
    assert.equal(page.live.length + page.closed.length, a.length);
  }
});

test("the stored page: a cross-edge room is live in the grace and closed past it", () => {
  const edge = T0 + 20 * MIN;
  const voices = [v(T0)];
  const live = port.conversationsOf(voices, { now: edge + 30 * MIN, earshotM: EARSHOT_M, boundaries: [edge], fadeMs: 5 * MIN });
  assert.equal(live.live.length, 1);
  const closed = port.conversationsOf(voices, { now: edge + H + 1, earshotM: EARSHOT_M, boundaries: [edge], fadeMs: 5 * MIN });
  assert.equal(closed.live.length, 0);
  assert.equal(closed.closed.length, 1);
});

test("without boundaries the lull path is untouched (the sound class's own fade)", () => {
  const voices = [v(0), v(40 * MIN)];
  assert.equal(port.clusterVoices(voices, { earshotM: EARSHOT_M, fadeMs: 30 * MIN }).length, 2);
});

// ── the stored say read (/world2/say) ───────────────────────────────────────
process.env.WORLD2_PG = "1";
process.env.WORLD2_PG_URL = "postgres://room-carryover-test/none";
const { world2Serve } = await import("../src/world2-serve.mjs");
const { createHearingWindow } = await import("../src/hearing-window.mjs");
const iso = (ms) => new Date(ms).toISOString();
const sayAct = (id, bornMs, actor, x = 0) => ({
  id, at: new Date(bornMs), actor, action: "legacy:emission",
  payload: { at: iso(bornMs), type: "emission", id: `sound:${bornMs}:${actor}`, actor,
    payload: { class: "sound", x, y: 0, text: `${actor} speaks`, spoken_by: actor, human: false, aboard: false, place: null,
      ttl_min: 5, radius_m: 60, class_version: 2, ttl_expires_at: iso(bornMs + 5 * MIN) } },
});
function sayAt(acts, atMs, sweeps) {
  const h = createHearingWindow({ repo: "unused", published: async () => sweeps[0], history: async () => [...sweeps], blessed: async () => null });
  return h.refresh().then(() => world2Serve("/world2/say", new URLSearchParams(`at=${iso(atMs)}&x=0&y=0`),
    { p: { query: async (sql) => (/FROM acts/i.test(sql) ? { rows: acts } : { rows: [] }) }, hearingWindow: (at) => h.read(at), settlements: () => sweeps }));
}
const heardBy = (r) => r.body.heard.map((e) => e.source);

test("/world2/say: a room across the edge is heard whole in the grace, gone at the hour, and a grace say carries it", async () => {
  const sweeps = [S1, S1 - 12 * H];
  const before = [sayAct(1, S1 - 10 * MIN, "mira"), sayAct(2, S1 - 5 * MIN, "odo", 10)];
  assert.deepEqual(heardBy(await sayAt(before, S1 + 30 * MIN, sweeps)), ["mira", "odo"], "in the grace both earlier says are hearable");
  assert.deepEqual(heardBy(await sayAt(before, S1 + H + MIN, sweeps)), [], "with no say in the hour: gone");
  const carried = [...before, sayAct(3, S1 + 20 * MIN, "pell", 20)];
  assert.deepEqual(heardBy(await sayAt(carried, S1 + 5 * H, sweeps)), ["mira", "odo", "pell"], "a grace say carries the whole room, hours on");
  const late = [...before, sayAct(3, S1 + 90 * MIN, "pell", 20)];
  assert.deepEqual(heardBy(await sayAt(late, S1 + 5 * H, sweeps)), ["pell"], "a late say cannot revive the closed room");
  const next = [S2, ...sweeps];
  assert.deepEqual(heardBy(await sayAt(carried, S2 + H + MIN, next)), [], "not silently through the next inactive grace");
});

// ── the flip: the old immediate epoch split is what this file exists to break ─────────────────────────
test("FALSIFIER: restoring the old epoch split would break the cross-edge room (the old rule, run on the same fixtures)", () => {
  const epochOf = (marks, at) => marks.filter((m) => m <= at).length;
  const oldSplit = (a, b, marks) => epochOf(marks, a) !== epochOf(marks, b);
  const edge = S1, first = S1 - 10 * MIN, inGrace = S1 + 10 * MIN;
  assert.equal(oldSplit(first, inGrace, [edge]), true, "the old rule split here");
  assert.equal(clusterVoices([v(first), v(inGrace)], { earshotM: EARSHOT_M, boundaries: [edge] }).length, 1, "the new rule keeps one room");
});

// ── the bounds: what a carried room loses is said, and its name survives (the FIX pass) ─────────────────
test("memory trim: a carried room's lost front is disclosed, hearable_since names what is actually heard, and the room keeps its id", async () => {
  const { store, tick, settle } = bench(AT, { memoryMax: 5 });
  for (let i = 1; i <= 5; i++) { await store.say("mira", `m${i}`); tick(20_000); }
  const idBefore = store.conversations().live[0].id;
  settle(); tick(10 * MIN);
  const whole = await store.hear("pell");
  assert.deepEqual(said(whole), ["m1", "m2", "m3", "m4", "m5"]);
  assert.equal(whole.hearing_disclosed, undefined, "nothing lost yet");
  assert.equal(whole.hearable_since, new Date(T0).toISOString(), "hearing reaches the room's first say, not the settlement edge");
  await store.say("odo", "g1"); tick(20_000);
  const cut = await store.hear("pell");
  assert.deepEqual(said(cut), ["m2", "m3", "m4", "m5", "g1"]);
  assert.match(cut.hearing_disclosed, /carried across the settlement has lost its earliest voices/);
  assert.equal(cut.hearable_since, new Date(T0 + 20_000).toISOString(), "the earliest voice this ear can still be given");
  const c = store.conversations();
  assert.equal(c.live.length, 1);
  assert.equal(c.live[0].id, idBefore, "the same room, named the same after its first say left memory");
  assert.equal(c.settlement_since, new Date(T0 + 100_000).toISOString(), "settlement_since stays the published edge");
  await store.say("odo", "g2"); tick(20_000);
  assert.equal(store.conversations().live[0].id, idBefore, "and again after the next trim");
});

test("memory identity equals the stored record's for the same room", async () => {
  const { store, tick, settle } = bench(AT, { memoryMax: 5 });
  const rows = [];
  for (let i = 1; i <= 5; i++) { rows.push({ ...v(T0 + (i - 1) * 20_000), handle: "mira" }); await store.say("mira", `m${i}`); tick(20_000); }
  settle(); tick(10 * MIN);
  for (let i = 1; i <= 3; i++) { rows.push({ ...v(T0 + 100_000 + 10 * MIN + (i - 1) * 20_000), handle: "odo" }); await store.say("odo", `g${i}`); tick(20_000); }
  const mem = store.conversations().live[0].id;
  const stored = port.conversationsOf(rows, { now: T0 + 30 * MIN, earshotM: EARSHOT_M, boundaries: [T0 + 100_000], fadeMs: 5 * MIN });
  assert.equal(stored.live[0].id, mem);
});

test("memory trim that loses the WHOLE pre-edge part of a carried room still says so, and keeps the id", async () => {
  const { store, tick, settle } = bench(AT, { memoryMax: 3 });
  await store.say("mira", "m1"); tick(20 * MIN);                 // 05:40 + 20 min: the edge falls at T0 + 20 min
  settle(); tick(5 * MIN);
  await store.say("odo", "g1"); tick(20_000);
  await store.say("odo", "g2"); tick(20_000);
  const id = store.conversations().live[0].id;
  assert.equal(store._voices().length, 3);
  assert.equal((await store.hear("pell")).hearing_disclosed, undefined, "all of it is still held");
  await store.say("odo", "g3"); tick(20_000);                    // trims m1: nothing before the edge is held any more
  const r = await store.hear("pell");
  assert.deepEqual(said(r), ["g1", "g2", "g3"]);
  assert.match(r.hearing_disclosed, /carried across the settlement has lost its earliest voices/, "an unknown earlier prefix does not read as complete");
  assert.equal(store.conversations().live[0].id, id, "the id is the room's, not the earliest held say's");
});

test("a spatial bridge that leaves memory leaves ONE room, BOTH sides kept, with the stored record's id", async () => {
  const at = { bridge: { x: 48, y: 0 }, west: { x: 0, y: 0 }, east: { x: 96, y: 0 }, ear: { x: 48, y: 5 } };
  const { store, tick } = bench(at, { memoryMax: 5 });
  const say = async (h, t) => { await store.say(h, t); tick(20_000); };
  await say("west", "w1"); await say("east", "e1");             // two rooms: 96 m apart, out of earshot (60 m)
  assert.equal(store.conversations().live.length, 2);
  await say("bridge", "b1");                                     // joins them
  assert.equal(store.conversations().live.length, 1);
  const joined = store.conversations().live[0].id;
  await say("west", "w2"); await say("east", "e2");
  await say("west", "w3"); await say("east", "e3"); await say("west", "w4"); // w1, e1 and the bridge have left; both sides are still held
  const held = store._voices().map((v) => v.text);
  assert.equal(held.length, 5);
  assert.ok(!held.includes("b1") && held.some((t) => t.startsWith("w")) && held.some((t) => t.startsWith("e")), "the bridge is gone, both sides remain");
  const c = store.conversations();
  assert.equal(c.live.length, 1, "one room, not two fragments");
  assert.equal(c.live[0].id, joined);
  assert.equal(joined, `t${T0}-west`, "the stored record names it by its first say");
});

test("legacy voices are joined ONCE: a say into a room of rootless lines records no alias list again", async () => {
  const log = join(DIR, "legacy.jsonl");
  const lines = [];
  for (let i = 0; i < 30; i++) lines.push(JSON.stringify({ at: new Date(T0 + i * 20_000).toISOString(), handle: "mira", text: `old ${i}`, x: 0, y: 0, place: null, aboard: false }));
  writeFileSync(log, lines.join("\n") + "\n");
  const b = bench(AT, { logPath: log, memoryMax: 100 });
  b.tick(30 * 20_000);
  for (let i = 0; i < 6; i++) { await b.store.say("odo", `new ${i}`); b.tick(20_000); }
  const written = readFileSync(log, "utf8").trim().split("\n").slice(30).map((l) => JSON.parse(l));
  assert.equal(written.length, 6);
  assert.ok(written[0].merged?.length >= 29, "the first say records the join of the old room, once");
  for (const w of written.slice(1)) assert.equal(w.merged, undefined, "later says repeat nothing");
  assert.equal(written[1].root, written[0].root);
});

test("an ordinary say records no join, and the alias map stays bounded by the memory", async () => {
  const quiet = bench(AT, { memoryMax: 5 });
  for (let i = 0; i < 40; i++) { await quiet.store.say("mira", `q${i}`); quiet.tick(20_000); }
  assert.equal(quiet.store._aliases(), 0, "a say into one room unions nothing");
  // many rooms joined by bridges, a round at a time: every round is a real join
  const at = {};
  const rounds = 40;
  for (let r = 0; r < rounds; r++) { at[`w${r}`] = { x: 0, y: r * 1000 }; at[`e${r}`] = { x: 96, y: r * 1000 }; at[`b${r}`] = { x: 48, y: r * 1000 }; }
  const { store, tick } = bench(at, { memoryMax: 6 });
  for (let r = 0; r < rounds; r++) for (const h of [`w${r}`, `e${r}`, `b${r}`]) { await store.say(h, h); tick(20_000); }
  assert.ok(store._aliases() <= 2 * 6 + 3, `aliases ${store._aliases()} stay within twice the memory (plus the say being made)`);
});

test("the room's root rides the log line, and a restarted office reads it back without walking the log", async () => {
  const log = join(DIR, "restart.jsonl");
  const a = bench(AT, { logPath: log, memoryMax: 4 });
  for (let i = 1; i <= 6; i++) { await a.store.say("mira", `m${i}`); a.tick(20_000); }
  const idA = a.store.conversations().live[0].id;
  const b = bench(AT, { logPath: log, memoryMax: 4 });
  b.tick(6 * 20_000);
  b.store._voices();
  assert.equal(b.store.room.stats.clustered, 0, "loading the log clusters nothing");
  assert.equal(b.store.conversations().live[0].id, idA, "the same room after a restart that holds only its last four voices");
  const base = b.store.room.stats.clustered;
  await b.store.say("odo", "after");
  assert.ok(b.store.room.stats.clustered - base <= 1, "a say walks the held list once: the append's walk, read again by the reply");
});

test("/world2/say: a room open just after the edge whose earlier epoch lies behind the 13 h read says it may be part of a carried room", async () => {
  const sweeps = [S2, S1];
  // a say 30 min after S2, read at S2 + 11.5 h: the read (13 h) reaches S2 - 1.5 h, not back to S1 (12 h before S2)
  const acts = [sayAct(1, S2 + 30 * MIN, "odo")];
  const r = await sayAt(acts, S2 + 11.5 * H, sweeps);
  assert.match(r.body.read_bound_disclosed, /carried across the settlement/);
  const near = await sayAt(acts, S2 + 45 * MIN, sweeps);
  assert.equal(near.body.read_bound_disclosed, undefined, "a read that reaches back to the previous settlement holds the whole epoch");
});

test("/world2/say: a carried room's read says it holds only part of it, and hearable_since names the earliest row returned", async () => {
  const sweeps = [S1, S1 - 12 * H];
  const acts = [sayAct(1, S1 - 20 * MIN, "mira"), sayAct(2, S1 + 5 * MIN, "odo", 10)];
  const r = await sayAt(acts, S1 + 30 * MIN, sweeps);
  assert.deepEqual(heardBy(r), ["mira", "odo"]);
  assert.equal(r.body.hearable_since, iso(S1 - 20 * MIN), "the reach is the earliest row returned; the edge is the settlement's");
  assert.match(r.body.read_bound_disclosed, /carried across the settlement/);
  const plain = await sayAt([sayAct(1, S1 + 5 * MIN, "odo")], S1 + 30 * MIN, sweeps);
  assert.equal(plain.body.hearable_since, iso(S1));
  assert.equal(plain.body.read_bound_disclosed, undefined);
});
