// pos-1184-voice-scan-single-flight.test.mjs — a burst of conversations reads makes ONE whole read of the voices, and no reader is served a room that is missing a say already spoken (POS-1184, held against POS-1185's door).
//
// LAW (POS-1184, the box's measurement 2026-11-22): three `world2Serve` conversations reads each ran the unbounded voice scan at once (1.2 to
// 2.1 s each, once 10.4 s) and held all three `serve` connections, so every other world-door read queued and timed out. The ask: at most one
// voice scan holds a `serve` connection at a time, and "a resident who speaks and then reads must see their say, so nothing may be served
// stale" (Wright, 2026-11-22).
//
// REWRITTEN THE SAME DAY BY POS-1185. Until then this file held the stopgap: every read still scanned every voice act, one scan at a time,
// a reader arriving mid-scan waiting for the NEXT scan, and "nothing is kept" (FALSIFIER 2 asserted a second read opened a second scan).
// POS-1185 ended the per-read scan: which says are in which room is worked out once and KEPT (world2-serve.mjs § THE ROOMS, KEPT), and
// every read then asks only for the acts newer than the kept ones and for the rooms it serves. So the law is held by different means, and
// the cases below assert the law, not the old mechanism:
//
//   FALSIFIER 1  a burst of bare, ?room=, ?circle= and ?before= reads makes ONE whole read of the voices, never two at once.
//   FALSIFIER 2  a read made after it sees a say written in between, WITHOUT a second whole read (the say's act names its room).
//   FALSIFIER 2b the same for a say whose act names no room (an office on older code): it is there too, by one more whole read.
//   FALSIFIER 3  a whole read that rejects rejects the readers waiting on it and is not kept: the next read starts clean.
//   FALSIFIER 4  the burst's answers equal the same reads made one after another, each on a fresh office, byte for byte.
//   FALSIFIER 5  the rows the store hands back are only read: they are deep-frozen, and no reader throws on them.
//   FALSIFIER 6  a say recorded while the whole read runs is in the answer of a reader who asks for it then.
//
// Invented speakers and places only. The pool is a fake that honours the door's four queries (every voice, the voices after an act
// number, voices by act number, marks), counts the whole read and can hold it open until the test lets it go. A query reads the store as
// it is when the query STARTS (a snapshot), as Postgres does.
//
//   node --test --test-concurrency=1 test/pos-1184-voice-scan-single-flight.test.mjs

import { test, before, after } from "node:test";
import assert from "node:assert/strict";

const env = { pg: process.env.WORLD2_PG, url: process.env.WORLD2_PG_URL };
before(() => {
  process.env.WORLD2_PG = "1";
  process.env.WORLD2_PG_URL = "postgres://pos-1184-test/none";
});
after(() => {
  if (env.pg == null) delete process.env.WORLD2_PG; else process.env.WORLD2_PG = env.pg;
  if (env.url == null) delete process.env.WORLD2_PG_URL; else process.env.WORLD2_PG_URL = env.url;
});

const { world2Serve, ROOMS_BUILD_SQL, ROOMS_BUILD_PAGE, ROOMS_TAIL_SQL, ROOM_VOICES_SQL } = await import("../src/world2-serve.mjs");
const { currentCrossing } = await import("../src/crossings.mjs");

const H = 3600_000, MIN = 60_000;
const S0 = Date.UTC(2026, 10, 19, 6, 0, 0);
const EDGES = [S0, S0 + 12 * H, S0 + 24 * H];
const NOW = S0 + 24 * H + 3 * H;

const PLACES = ["quay", "hill", "mill"];
const MARKS = PLACES.map((n, i) => ({ slug: `the-town/${n}`, status: "standing", geometry: { at: { x: 1000 + i * 5000, y: 1000 }, extent: { w: 20, h: 20 } }, data: {} }));

let nextId = 100;
const row = (place, handle, atMs, text, replyTo = null, conversation = null) => ({
  id: nextId++, at: new Date(atMs), crossing: currentCrossing(atMs), actor: handle, action: "say",
  at_anchor: `the-town/${place}`, at_dx: 0, at_dy: 0, payload: { text, ...(replyTo != null ? { reply_to: replyTo } : {}), ...(conversation ? { conversation } : {}) },
});
const roomId = (r) => `t${r.at.getTime()}-${r.actor}`;
const A1 = row("quay", "ada-vale", S0 + 1 * H, "A one");
const A2 = row("quay", "bram-oke", S0 + 90 * MIN, "A two", A1.id);
const B1 = row("hill", "cora-finch", EDGES[1] + 2 * H, "B one");
const B2 = row("hill", "dov-ash", EDGES[1] + 150 * MIN, "B two", B1.id);
const C1 = row("mill", "hal-pike", EDGES[2] + 1 * H, "C one");
const C2 = row("mill", "ivy-croft", EDGES[2] + 80 * MIN, "C two", C1.id);
const BASE = [A1, A2, B1, B2, C1, C2];

const deepFreeze = (o) => { if (o && typeof o === "object" && !Object.isFrozen(o)) { Object.freeze(o); for (const v of Object.values(o)) deepFreeze(v); } return o; };
const clone = (r) => ({ ...r, at: new Date(r.at), payload: JSON.parse(JSON.stringify(r.payload)) });

/**
 * A pool that honours the door's queries and counts the WHOLE read. `acts` is the live store (a test may push a say into it at any time).
 * `hold`: each whole read waits for `release(n)`, n counting whole reads from 1. `failWhole`: the whole reads that reject. Every query
 * returns the store as it was when the query STARTED, deep-frozen.
 */
function poolOf({ acts = BASE, hold = false, failWhole = [] } = {}) {
  // EVERY query that reads voices is counted, with the rows it handed back: the whole read, the read of newer acts, and each read of
  // rooms' says (`roomRows`). Until the review of 7ba23476 only the whole read was counted, so a page that fetched every voice through
  // the rooms' read could not turn this file red.
  const stats = { whole: 0, wholePages: 0, live: 0, maxLive: 0, newer: 0, newerRows: [], rooms: 0, roomRows: [], marks: 0 };
  const gates = new Map();
  const gate = (n) => { if (!gates.has(n)) { let ok; const promise = new Promise((r) => { ok = r; }); gates.set(n, { promise, ok }); } return gates.get(n); };
  const snapshot = (keep) => deepFreeze(acts.filter(keep).map(clone).sort((a, b) => a.at - b.at || a.id - b.id)); // taken at the start, like a Postgres snapshot
  return {
    stats,
    release: (n) => gate(n).ok(),
    query: async (sql, params) => {
      if (sql === ROOMS_BUILD_SQL) {
        // the whole read comes a page of act numbers at a time: `after` 0 begins one (counted, held and failed as ONE whole read)
        const after = Number(params[1]);
        const rows = deepFreeze(acts.filter((r) => r.id > after).map(clone).sort((a, b) => a.id - b.id).slice(0, ROOMS_BUILD_PAGE));
        stats.wholePages += 1;
        if (after !== 0) return { rows };
        const n = ++stats.whole;
        stats.live++; stats.maxLive = Math.max(stats.maxLive, stats.live);
        try {
          if (hold) await gate(n).promise;
          if (failWhole.includes(n)) throw new Error(`whole read ${n} was cut off (test)`);
          return { rows };
        } finally { stats.live--; }
      }
      if (sql === ROOMS_TAIL_SQL) { stats.newer++; const rows = snapshot((r) => r.id > Number(params[1])); stats.newerRows.push(rows.length); return { rows }; }
      if (sql === ROOM_VOICES_SQL) { stats.rooms++; const want = new Set(params[0].map(String)); const rows = snapshot((r) => want.has(String(r.id))); stats.roomRows.push(rows.length); return { rows }; }
      if (/FROM acts/i.test(sql) && !/FROM marks/i.test(sql)) throw new Error(`a voice-reading query this file does not count: ${sql.slice(0, 80)}`);
      if (/FROM marks/i.test(sql)) { stats.marks++; return { rows: MARKS }; }
      return { rows: [] };
    },
  };
}

const ask = (query, p) => world2Serve("/world2/conversations", new URLSearchParams(`at=${new Date(NOW).toISOString()}&${query}`),
  { p, settlements: () => EDGES, hearingWindow: () => ({ since: EDGES.at(-1) }) });
/** Wait on the event: whole read `n` has started. (The first read of a process loads the speaker book, POS-1132, before it reaches the store.) */
async function untilWhole(p, n) {
  for (let t0 = Date.now(); Date.now() - t0 < 20_000 && p.stats.whole < n; ) await new Promise((ok) => setTimeout(ok, 5));
  assert.equal(p.stats.whole, n, `whole read ${n} started`);
}

const BURST = [`room=${roomId(A1)}`, `room=${roomId(B1)}`, `circle=${B2.id}`, `circle=${C2.id}`, "before=" + new Date(NOW).toISOString(), "closed=50", `room=${roomId(C1)}`, `circle=${A1.id}`];

/** Run BURST at once on a held pool: the whole read is open while every reader is in flight. Answers come back in BURST's order. */
async function burstOn(p) {
  let settled = 0;
  const reads = BURST.map((q) => ask(q, p).finally(() => { settled += 1; }));
  await untilWhole(p, 1);
  await new Promise((ok) => setImmediate(ok));
  assert.equal(settled, 0, "no reader has an answer while the whole read is open");
  assert.equal(p.stats.whole, 1, `${BURST.length} readers in flight, one whole read open`);
  p.release(1);
  return Promise.all(reads);
}

test("FALSIFIER 1: a burst of bare, room, circle and before reads makes one whole read of the voices, never two at once", async () => {
  const p = poolOf({ hold: true });
  const out = await burstOn(p);
  assert.ok(out.every((r) => r.code === 200), JSON.stringify(out.map((r) => r.code)));
  assert.equal(p.stats.whole, 1, `LAW: at most one voice scan holds a connection at a time — ${BURST.length} readers, one whole read`);
  assert.equal(p.stats.maxLive, 1, "never two whole reads open at once");
  assert.equal(out[0].body.find.room.voice_count, 2, "and each reader has its own room");
});

test("FALSIFIER 2: a read made after it sees a say written in between, without a second whole read", async () => {
  const acts = [...BASE];
  const p = poolOf({ acts });
  const first = await ask(`circle=${C2.id}`, p);
  assert.equal(first.code, 200);
  assert.equal(p.stats.whole, 1);
  const C3 = row("mill", "jun-lark", EDGES[2] + 100 * MIN, "C three, said after the first read", C2.id, roomId(C1));
  acts.push(C3);
  const second = await ask(`circle=${C3.id}`, p);
  assert.equal(second.body.find.history, "complete", 'LAW: "a resident who speaks and then reads must see their say" — the say written between the two reads is there');
  assert.equal(second.body.find.room.voice_count, 3);
  assert.equal(p.stats.whole, 1, "POS-1185: by the small read of newer acts, not a second whole read (until 2026-11-22 this asserted a second scan: nothing was kept)");
});

test("FALSIFIER 2b: a say whose act names no room is there too on the next read, by one more whole read", async () => {
  const acts = [...BASE];
  const p = poolOf({ acts });
  assert.equal((await ask(`circle=${C2.id}`, p)).code, 200);
  const C3 = row("mill", "jun-lark", EDGES[2] + 100 * MIN, "C three, from an office on older code", C2.id);
  acts.push(C3);
  const second = await ask(`circle=${C3.id}`, p);
  assert.equal(second.body.find.history, "complete", 'LAW: "nothing may be served stale" — the unnamed say is in its room');
  assert.equal(second.body.find.room.voice_count, 3);
  assert.equal(p.stats.whole, 2, "the kept rooms were built again, once");
});

test("FALSIFIER 3: a whole read that rejects rejects the readers waiting on it, and is not kept: the next read starts clean", async () => {
  const p = poolOf({ hold: true, failWhole: [1] });
  const reads = BURST.slice(0, 4).map((q) => ask(q, p).then((r) => `answered ${r.code}`, (e) => `rejected: ${e.message}`));
  await untilWhole(p, 1);
  await new Promise((ok) => setImmediate(ok));
  p.release(2);            // a reader that arrives after the failure opens its own whole read: let it through
  p.release(1);
  const out = await Promise.all(reads);
  assert.equal(out[0], "rejected: whole read 1 was cut off (test)");
  for (const o of out) assert.ok(o === "rejected: whole read 1 was cut off (test)" || o === "answered 200", o);
  const clean = await ask(`circle=${B1.id}`, p);
  assert.equal(clean.code, 200, "the failed read is not kept: the next read opens its own");
  assert.equal(clean.body.find.room.voice_count, 2);
  assert.equal(p.stats.whole, 2);
});

test("FALSIFIER 4: the burst's answers equal the same reads made one after another, each on a fresh office", async () => {
  const burst = await burstOn(poolOf({ hold: true }));
  let whole = 0;
  for (let i = 0; i < BURST.length; i++) {
    const alone = poolOf();
    const r = await ask(BURST[i], alone);
    whole += alone.stats.whole;
    assert.equal(JSON.stringify(burst[i]), JSON.stringify(r), `${BURST[i]}: the shared whole read answered what its own whole read answers`);
  }
  assert.equal(whole, BURST.length, "control: each fresh office made its own whole read (the other side of the comparison shares nothing)");
});

test("FALSIFIER 5: the rows the store hands back are frozen, and no reader of the burst throws on them", async () => {
  const out = await Promise.allSettled([burstOn(poolOf({ hold: true }))]);
  assert.equal(out[0].status, "fulfilled", String(out[0].reason));
});

test("FALSIFIER 6: a say recorded while the whole read runs is in the answer of a reader who asks for it then", async () => {
  const acts = [...BASE];
  const p = poolOf({ acts, hold: true });
  const first = ask(`circle=${C2.id}`, p);
  await untilWhole(p, 1);
  // the whole read is open, and its snapshot has no C3
  const C3 = row("mill", "jun-lark", EDGES[2] + 100 * MIN, "C three, said while the whole read ran", C2.id, roomId(C1));
  acts.push(C3);
  const spoke = ask(`circle=${C3.id}`, p); // the resident who just spoke opens their say
  await new Promise((ok) => setImmediate(ok));
  p.release(1);
  assert.equal((await first).code, 200);
  const r = await spoke;
  assert.equal(r.body.find.history, "complete", 'LAW: "a resident who speaks and then reads must see their say" — the shared whole read began before the say, and the reader still has it');
  assert.equal(r.body.find.room.voice_count, 3);
  assert.equal(p.stats.whole, 1);
  assert.ok(p.stats.newer >= 2, "each reader asked for the acts newer than the kept ones before it answered");
});

// ── the review of 7ba23476, block 1: a page must not be a second way to read every voice ──
// 150 closed rooms of one say each (more than one page holds), beside BASE. Six readers ask for everything at once, three ways.
const MANY = 150;
const MANY_MARKS = Array.from({ length: MANY }, (_, i) => ({ slug: `the-town/spot-${i}`, status: "standing", geometry: { at: { x: 100_000 + i * 5000, y: 1000 }, extent: { w: 20, h: 20 } }, data: {} }));
const manyRows = () => Array.from({ length: MANY }, (_, i) => ({
  id: 10_000 + i, at: new Date(S0 + 2 * H + i * 1000), crossing: currentCrossing(S0 + 2 * H), actor: `guest-${i}`, action: "say",
  at_anchor: `the-town/spot-${i}`, at_dx: 0, at_dy: 0, payload: { text: `spot ${i}` } }));

test("FALSIFIER 7: no reader fetches every voice, however it asks: `closed=100000`, behind a cursor, or evaluated before any settlement, six at once", async () => {
  MARKS.push(...MANY_MARKS);
  try {
    const acts = [...BASE, ...manyRows()];
    for (const [name, query, at] of [
      ["closed=100000", "closed=100000", NOW],
      ["closed=100000 behind a cursor", `closed=100000&before=${encodeURIComponent(new Date(NOW).toISOString())}`, NOW],
      ["a bare read evaluated before any settlement", "", S0 - H],
    ]) {
      const p = poolOf({ acts, hold: true });
      const reads = Array.from({ length: 6 }, () => world2Serve("/world2/conversations", new URLSearchParams(`at=${new Date(at).toISOString()}&${query}`),
        { p, settlements: () => EDGES, hearingWindow: () => ({ since: EDGES.at(-1) }) }));
      await untilWhole(p, 1);
      p.release(1);
      const out = await Promise.all(reads);
      assert.ok(out.every((r) => r.code === 200), `${name}: ${JSON.stringify(out.map((r) => r.code))}`);
      assert.equal(p.stats.whole, 1, `${name}: one whole read (without the words) between six readers`);
      assert.equal(p.stats.roomRows.length, 6, `${name}: each reader read its own page's rooms`);
      for (const rows of p.stats.roomRows)
        assert.ok(rows <= 100 + BASE.length && rows < acts.length, `LAW (POS-1184): ${name}: a reader fetched ${rows} voices with their words; the store holds ${acts.length}`);
      const body = out[0].body;
      assert.ok(body.limits, `${name}: a read that asked for more than a page holds is told so`);
      if (at === NOW) { assert.equal(body.closed.length, 100); assert.equal(body.limits.closed.asked, 100000); assert.ok(body.earlier.remaining >= 50); }
      else { assert.equal(body.live.length, 100); assert.equal(body.limits.live.open, MANY + 3); }
    }
  } finally { MARKS.length = PLACES.length; }
});

// POS-1185, after w48.3 moved the load onto the office's main thread: a burst of reads must not run back to back on it. Each read's own
// work takes its own turn of the event loop. The fake pool answers at once, so with no turn-taking every reader would finish in ONE turn.
test("FALSIFIER 8: each read's own work takes its own turn of the event loop: a burst of readers finishes in as many different turns", async () => {
  const p = poolOf();
  assert.equal((await ask(`room=${roomId(A1)}`, p)).code, 200); // the rooms are kept: the burst below is only the readers' own work
  let turn = 0, counting = true;
  const tick = () => { turn += 1; if (counting) setImmediate(tick); };
  setImmediate(tick);
  const finished = await Promise.all(BURST.map((q) => ask(q, p).then(() => turn)));
  counting = false;
  assert.equal(new Set(finished).size, BURST.length, `LAW (POS-1185): one read per turn of the loop — ${BURST.length} readers finished in turns ${finished.join(", ")}`);
});

// The whole read is paged by act number, so the thread is never held for the parse of every row at once (POS-1185, the loop measurement:
// one unpaged result of 23,937 rows held the office's main thread about 150 ms in the driver alone).
test("FALSIFIER 9: the whole read comes a page at a time and misses nothing: a record of more than two pages is read in three, and its first and last rooms open", async () => {
  const N = 2 * ROOMS_BUILD_PAGE + 100;
  const marks = [{ slug: "the-town/long-road", status: "standing", geometry: { at: { x: 500_000, y: 0 }, extent: { w: 20, h: 20 } }, data: {} }];
  const acts = Array.from({ length: N }, (_, i) => ({ id: 50_000 + i, at: new Date(S0 + H + i * 1000), crossing: currentCrossing(S0 + H), actor: `walker-${i}`, action: "say",
    at_anchor: "the-town/long-road", at_dx: i * 500, at_dy: 0, payload: { text: `step ${i}` } }));
  MARKS.push(...marks);
  try {
    const p = poolOf({ acts });
    const idOf = (i) => `t${S0 + H + i * 1000}-walker-${i}`;
    for (const i of [0, ROOMS_BUILD_PAGE - 1, ROOMS_BUILD_PAGE, N - 1]) {
      const r = await ask(`room=${idOf(i)}`, p);
      assert.equal(r.body.find.history, "complete", `say ${i} of ${N}: its room opens`);
      assert.equal(r.body.find.room.voice_count, 1);
    }
    assert.equal(p.stats.whole, 1, "one whole read");
    assert.equal(p.stats.wholePages, 3, `in three pages of at most ${ROOMS_BUILD_PAGE} act numbers`);
    assert.equal((await ask("", p)).body.voices, N, "and every voice is counted");
  } finally { MARKS.length = PLACES.length; }
});

test("two pools never share a whole read (the kept rooms are per pool)", async () => {
  const a = poolOf({ hold: true }), b = poolOf({ hold: true });
  const ra = ask("closed=10", a), rb = ask("closed=10", b);
  await untilWhole(a, 1); await untilWhole(b, 1);
  a.release(1); b.release(1);
  const [x, y] = await Promise.all([ra, rb]);
  assert.equal(x.code, 200); assert.equal(y.code, 200);
  assert.equal(a.stats.whole, 1); assert.equal(b.stats.whole, 1);
});
