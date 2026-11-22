// pos-1184-voice-scan-single-flight.test.mjs — the conversations voice scan is single-flight (POS-1184).
//
// LAW (POS-1184, the box's measurement 2026-11-22): three `world2Serve` conversations reads each ran the unbounded voice scan at once (1.2 to
// 2.1 s each, once 10.4 s) and held all three `serve` connections, so every other world-door read queued and timed out. "make the unbounded voice
// read single-flight per process. While one such read is in flight, every other caller that needs the same rows awaits that same promise ...
// No TTL, no cache of settled results: a resident who speaks and then reads must see their say, so nothing may be served stale."
//
//   FALSIFIER 1  N concurrent bare, ?room=, ?circle= and ?before= reads issue exactly ONE voice query, and never two at once.
//   FALSIFIER 2  a read that starts after the scan settles issues its own, and sees a say written in between (nothing is kept).
//   FALSIFIER 3  a scan that rejects rejects every caller waiting on it, and the next read starts clean (the rejection is not kept).
//   FALSIFIER 4  the answers of the concurrent burst equal the answers of the same reads made one after another (each with its own scan, which
//                is what the door did before), byte for byte.
//   FALSIFIER 5  the shared rows are only read: they are deep-frozen, and no caller throws on them.
//
// Invented speakers and places only. The pool is a fake that counts the voice SQL, and holds it open until the test lets it go.
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
 * A pool that counts the voice scan. `acts` is the live store (a test may push a say into it between reads). `hold`: the scan waits on
 * `release()`. `failScans`: the first that many scans reject. `frozen`: the rows handed back are deep-frozen.
 */
function poolOf({ acts = BASE, hold = false, failScans = 0, frozen = true } = {}) {
  const stats = { voice: 0, live: 0, maxLive: 0, marks: 0, gate: null };
  let release;
  const gate = new Promise((ok) => { release = ok; });
  let failures = failScans;
  const p = {
    stats,
    release: () => release(),
    query: async (sql) => {
      if (sql === ALL_VOICES_SQL) {
        stats.voice++; stats.live++; stats.maxLive = Math.max(stats.maxLive, stats.live);
        try {
          if (hold) await gate;
          if (failures > 0) { failures--; throw new Error("the scan was cut off (test)"); }
          const rows = acts.map(clone).sort((a, b) => a.at - b.at || a.id - b.id);
          return { rows: frozen ? deepFreeze(rows) : rows };
        } finally { stats.live--; }
      }
      if (/FROM marks/i.test(sql)) { stats.marks++; return { rows: MARKS }; }
      return { rows: [] };
    },
  };
  return p;
}

const ask = (query, p) => world2Serve("/world2/conversations", new URLSearchParams(`at=${new Date(NOW).toISOString()}&${query}`),
  { p, settlements: () => EDGES, hearingWindow: () => ({ since: EDGES.at(-1) }) });
const tick = () => new Promise((ok) => setImmediate(ok));
/** Wait until `n` readers have reached the pool's marks read (every one of them is then past the voice scan's start). */
async function untilArrived(p, n) {
  // the first read of a process loads the speaker book (POS-1132) before it reaches the store, so wait on the event with a generous ceiling
  for (let t0 = Date.now(); Date.now() - t0 < 20_000 && p.stats.marks < n; ) await new Promise((ok) => setTimeout(ok, 5));
  assert.equal(p.stats.marks, n, "every reader reached the store");
}

const BURST = [`room=${roomId(A1)}`, `room=${roomId(B1)}`, `circle=${B2.id}`, `circle=${C2.id}`, "before=" + new Date(NOW).toISOString(), "closed=50", `room=${roomId(C1)}`, `circle=${A1.id}`];

test("FALSIFIER 1: a burst of bare, room, circle and before reads issues exactly one voice query, and never two at once", async () => {
  const p = poolOf({ hold: true });
  const reads = BURST.map((q) => ask(q, p));
  await untilArrived(p, BURST.length);
  assert.equal(p.stats.voice, 1, `${BURST.length} readers in flight, ${p.stats.voice} voice scan(s) opened`);
  p.release();
  const out = await Promise.all(reads);
  assert.ok(out.every((r) => r.code === 200), JSON.stringify(out.map((r) => r.code)));
  assert.equal(p.stats.voice, 1, "still one after they all answered");
  assert.equal(p.stats.maxLive, 1, "never two voice scans open at once");
});

test("FALSIFIER 2: a read started after the scan settled issues its own scan, and sees a say written in between", async () => {
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

test("FALSIFIER 3: a scan that rejects rejects every waiter, and does not poison the next read", async () => {
  const p = poolOf({ hold: true, failScans: 1 });
  const reads = [`room=${roomId(A1)}`, `circle=${B1.id}`, "closed=10"].map((q) => ask(q, p).then(() => "answered", (e) => `rejected: ${e.message}`));
  await untilArrived(p, 3);
  assert.equal(p.stats.voice, 1);
  p.release();
  const outcomes = await Promise.all(reads);
  assert.deepEqual(outcomes, Array(3).fill("rejected: the scan was cut off (test)"), "every waiter on the failed scan failed with its error");
  const next = await ask(`circle=${B1.id}`, p);
  assert.equal(next.code, 200, "the next read is not poisoned by the failed one");
  assert.equal(p.stats.voice, 2, "it started a scan of its own");
});

test("FALSIFIER 4: the burst's answers equal the same reads made one after another, each with its own scan", async () => {
  const p = poolOf({ hold: true });
  const reads = BURST.map((q) => ask(q, p));
  await untilArrived(p, BURST.length);
  p.release();
  const burst = await Promise.all(reads);
  const alone = poolOf();
  for (let i = 0; i < BURST.length; i++) {
    const r = await ask(BURST[i], alone);
    assert.equal(JSON.stringify(burst[i]), JSON.stringify(r), `${BURST[i]}: the shared scan answered what its own scan answers`);
  }
  assert.equal(alone.stats.voice, BURST.length, "control: the sequential reads each opened their own scan (the comparison's other side is the old behaviour)");
});

test("FALSIFIER 5: the shared rows are frozen, and no caller of the burst throws on them", async () => {
  const p = poolOf({ hold: true, frozen: true });
  const reads = BURST.map((q) => ask(q, p));
  await untilArrived(p, BURST.length);
  p.release();
  const out = await Promise.allSettled(reads);
  assert.deepEqual(out.map((o) => o.status), Array(BURST.length).fill("fulfilled"), JSON.stringify(out.filter((o) => o.status === "rejected").map((o) => String(o.reason))));
});

test("two pools never share a scan (the flight is per pool)", async () => {
  const a = poolOf({ hold: true }), b = poolOf({ hold: true });
  const ra = ask("closed=10", a), rb = ask("closed=10", b);
  await untilArrived(a, 1); await untilArrived(b, 1);
  assert.equal(a.stats.voice, 1); assert.equal(b.stats.voice, 1);
  a.release(); b.release();
  await Promise.all([ra, rb]);
});
