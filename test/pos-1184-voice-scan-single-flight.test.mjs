// pos-1184-voice-scan-single-flight.test.mjs — the conversations voice scan runs one at a time, and never serves a reader a scan that began before it asked (POS-1184).
//
// LAW (POS-1184, the box's measurement 2026-11-22): three `world2Serve` conversations reads each ran the unbounded voice scan at once (1.2 to
// 2.1 s each, once 10.4 s) and held all three `serve` connections, so every other world-door read queued and timed out. The ask: at most one
// voice scan holds a `serve` connection at a time, "No TTL, no cache of settled results: a resident who speaks and then reads must see their
// say, so nothing may be served stale" (Wright, 2026-11-22: a reader that arrives while a scan runs waits for the NEXT scan, one that starts
// after it asked).
//
//   FALSIFIER 1  a burst of bare, ?room=, ?circle= and ?before= reads: at most two voice queries (the running one and the next), never two at once.
//   FALSIFIER 2  a read that starts after the scans settled issues its own scan, and sees a say written in between (nothing is kept).
//   FALSIFIER 3  a scan that rejects rejects the readers waiting on it and nobody else; the next read starts clean.
//   FALSIFIER 4  the burst's answers equal the same reads made one after another, each with its own scan, byte for byte.
//   FALSIFIER 5  the shared rows are only read: they are deep-frozen, and no reader throws on them.
//   FALSIFIER 6  a say recorded after scan 1 began, and a reader who arrives mid-scan: the reader's answer holds that say.
//
// Invented speakers and places only. The pool is a fake that counts the voice SQL and holds each scan open until the test lets it go. A scan
// reads the store as it is when it STARTS (a snapshot), as Postgres does.
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

const { world2Serve, ALL_VOICES_SQL } = await import("../src/world2-serve.mjs");
const { currentCrossing } = await import("../src/crossings.mjs");

const H = 3600_000, MIN = 60_000;
const S0 = Date.UTC(2026, 10, 19, 6, 0, 0);
const EDGES = [S0, S0 + 12 * H, S0 + 24 * H];
const NOW = S0 + 24 * H + 3 * H;

const PLACES = ["quay", "hill", "mill"];
const MARKS = PLACES.map((n, i) => ({ slug: `the-town/${n}`, status: "standing", geometry: { at: { x: 1000 + i * 5000, y: 1000 }, extent: { w: 20, h: 20 } }, data: {} }));

let nextId = 100;
const row = (place, handle, atMs, text, replyTo = null) => ({
  id: nextId++, at: new Date(atMs), crossing: currentCrossing(atMs), actor: handle, action: "say",
  at_anchor: `the-town/${place}`, at_dx: 0, at_dy: 0, payload: { text, ...(replyTo != null ? { reply_to: replyTo } : {}) },
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
 * A pool that counts the voice scan. `acts` is the live store (a test may push a say into it at any time). `hold`: each scan waits for
 * `release(n)`, n counting scans from 1. `failScans`: the scan numbers that reject. The rows a scan returns are the store as it was when
 * the scan STARTED, deep-frozen.
 */
function poolOf({ acts = BASE, hold = false, failScans = [] } = {}) {
  const stats = { voice: 0, live: 0, maxLive: 0, marks: 0 };
  const gates = new Map();
  const gate = (n) => { if (!gates.has(n)) { let ok; const promise = new Promise((r) => { ok = r; }); gates.set(n, { promise, ok }); } return gates.get(n); };
  return {
    stats,
    release: (n) => gate(n).ok(),
    query: async (sql) => {
      if (sql === ALL_VOICES_SQL) {
        const n = ++stats.voice;
        const snapshot = acts.map(clone).sort((a, b) => a.at - b.at || a.id - b.id); // taken at the start, like a Postgres snapshot
        stats.live++; stats.maxLive = Math.max(stats.maxLive, stats.live);
        try {
          if (hold) await gate(n).promise;
          if (failScans.includes(n)) throw new Error(`scan ${n} was cut off (test)`);
          return { rows: deepFreeze(snapshot) };
        } finally { stats.live--; }
      }
      if (/FROM marks/i.test(sql)) { stats.marks++; return { rows: MARKS }; }
      return { rows: [] };
    },
  };
}

const ask = (query, p) => world2Serve("/world2/conversations", new URLSearchParams(`at=${new Date(NOW).toISOString()}&${query}`),
  { p, settlements: () => EDGES, hearingWindow: () => ({ since: EDGES.at(-1) }) });
/** Wait until `n` readers have reached the pool's marks read (each is then past asking for the voice scan). */
async function untilArrived(p, n) {
  // the first read of a process loads the speaker book (POS-1132) before it reaches the store, so wait on the event with a generous ceiling
  for (let t0 = Date.now(); Date.now() - t0 < 20_000 && p.stats.marks < n; ) await new Promise((ok) => setTimeout(ok, 5));
  assert.equal(p.stats.marks, n, "every reader reached the store");
}
async function untilScans(p, n) {
  for (let t0 = Date.now(); Date.now() - t0 < 20_000 && p.stats.voice < n; ) await new Promise((ok) => setTimeout(ok, 5));
  assert.equal(p.stats.voice, n, `scan ${n} started`);
}

const BURST = [`room=${roomId(A1)}`, `room=${roomId(B1)}`, `circle=${B2.id}`, `circle=${C2.id}`, "before=" + new Date(NOW).toISOString(), "closed=50", `room=${roomId(C1)}`, `circle=${A1.id}`];

/** Run BURST at once on a held pool: scan 1 runs, every other reader waits for scan 2. Answers come back in BURST's order. */
async function burstOn(p) {
  const reads = BURST.map((q) => ask(q, p));
  await untilArrived(p, BURST.length);
  assert.equal(p.stats.voice, 1, `${BURST.length} readers in flight, ${p.stats.voice} scan(s) open: the rest wait for the next one`);
  p.release(1);
  await untilScans(p, 2);
  p.release(2);
  return Promise.all(reads);
}

test("FALSIFIER 1: a burst of bare, room, circle and before reads opens at most two voice scans, one at a time", async () => {
  const p = poolOf({ hold: true });
  const out = await burstOn(p);
  assert.ok(out.every((r) => r.code === 200), JSON.stringify(out.map((r) => r.code)));
  assert.equal(p.stats.voice, 2, `${BURST.length} readers, two scans`);
  assert.equal(p.stats.maxLive, 1, "never two voice scans open at once");
});

test("FALSIFIER 2: a read started after the scans settled issues its own scan, and sees a say written in between", async () => {
  const acts = [...BASE];
  const p = poolOf({ acts });
  const first = await ask(`circle=${C2.id}`, p);
  assert.equal(first.code, 200);
  assert.equal(p.stats.voice, 1);
  const C3 = row("mill", "jun-lark", EDGES[2] + 100 * MIN, "C three, said after the first read", C2.id);
  acts.push(C3);
  const second = await ask(`circle=${C3.id}`, p);
  assert.equal(p.stats.voice, 2, "the second read opened its own scan: nothing was kept");
  assert.equal(second.body.find.history, "complete", "the say written between the two reads is there");
  assert.equal(second.body.find.room.voice_count, 3);
});

test("FALSIFIER 3a: a scan that rejects rejects the reader that started it, and the readers behind it are not poisoned", async () => {
  const p = poolOf({ hold: true, failScans: [1] });
  const reads = BURST.slice(0, 4).map((q) => ask(q, p).then((r) => `answered ${r.code}`, (e) => `rejected: ${e.message}`));
  await untilArrived(p, 4);
  p.release(1);
  await untilScans(p, 2);
  p.release(2);
  assert.deepEqual(await Promise.all(reads), ["rejected: scan 1 was cut off (test)", "answered 200", "answered 200", "answered 200"]);
  const next = await ask(`circle=${B1.id}`, poolOf());
  assert.equal(next.code, 200);
});

test("FALSIFIER 3b: a scan that rejects rejects every reader waiting on it, and the next read starts clean", async () => {
  const p = poolOf({ hold: true, failScans: [2] });
  const reads = BURST.slice(0, 4).map((q) => ask(q, p).then((r) => `answered ${r.code}`, (e) => `rejected: ${e.message}`));
  await untilArrived(p, 4);
  p.release(1);
  await untilScans(p, 2);
  p.release(2);
  assert.deepEqual(await Promise.all(reads), ["answered 200", "rejected: scan 2 was cut off (test)", "rejected: scan 2 was cut off (test)", "rejected: scan 2 was cut off (test)"]);
  const clean = ask(`circle=${B1.id}`, p);
  await untilScans(p, 3);
  p.release(3);
  assert.equal((await clean).code, 200, "the failed scan is not kept: the next read opens its own");
});

test("FALSIFIER 4: the burst's answers equal the same reads made one after another, each with its own scan", async () => {
  const burst = await burstOn(poolOf({ hold: true }));
  const alone = poolOf();
  for (let i = 0; i < BURST.length; i++) {
    const r = await ask(BURST[i], alone);
    assert.equal(JSON.stringify(burst[i]), JSON.stringify(r), `${BURST[i]}: the shared scan answered what its own scan answers`);
  }
  assert.equal(alone.stats.voice, BURST.length, "control: the sequential reads each opened their own scan (the other side of the comparison is the old behaviour)");
});

test("FALSIFIER 5: the shared rows are frozen, and no reader of the burst throws on them", async () => {
  const out = await Promise.allSettled([burstOn(poolOf({ hold: true }))]);
  assert.equal(out[0].status, "fulfilled", String(out[0].reason));
});

test("FALSIFIER 6: a say recorded after scan 1 began is in the answer of a reader who arrived while scan 1 ran", async () => {
  const acts = [...BASE];
  const p = poolOf({ acts, hold: true });
  const first = ask(`circle=${C2.id}`, p);
  await untilArrived(p, 1);
  assert.equal(p.stats.voice, 1, "scan 1 is open, and its snapshot has no C3");
  const C3 = row("mill", "jun-lark", EDGES[2] + 100 * MIN, "C three, said while scan 1 ran", C2.id);
  acts.push(C3);
  const spoke = ask(`circle=${C3.id}`, p); // the resident who just spoke opens their say
  await untilArrived(p, 2);
  p.release(1);
  await untilScans(p, 2);
  p.release(2);
  assert.equal((await first).code, 200);
  const r = await spoke;
  assert.equal(r.body.find.history, "complete", "the say is there: this reader's rows came from a scan that began after they asked");
  assert.equal(r.body.find.room.voice_count, 3);
});

test("two pools never share a scan (the flight is per pool)", async () => {
  const a = poolOf({ hold: true }), b = poolOf({ hold: true });
  const ra = ask("closed=10", a), rb = ask("closed=10", b);
  await untilArrived(a, 1); await untilArrived(b, 1);
  assert.equal(a.stats.voice, 1); assert.equal(b.stats.voice, 1);
  a.release(1); b.release(1);
  await Promise.all([ra, rb]);
});
