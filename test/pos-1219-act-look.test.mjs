// pos-1219-act-look.test.mjs — a world act's look (orient, then eyes) is read on a worker, and the act's answer does not change (POS-1219).
//
// THE RULE (POS-1219's brief, 2026-11-24): "an act's orient and eyes reads move to a read worker, and the act itself stays on main", with "answers byte-identical
// to today's". On prod both reads ran on the main thread for every act (15–16Z: 154 MCP says, orient 351 s and eyes 405 s of their segments).
//
// In process, on test/pos-1110-act-timing.test.mjs's miniature world (one ambient `say`), with the look's caller injected (world-apex.mjs § __setActLookCallerForTest):
//   1. ASKED OF A WORKER, ANSWERED THROUGH A PORT: a caller that runs the worker's own read (§ __actLookReadForTest) and crosses it through structuredClone, as a
//      port does, is asked once per act with { args, key, roll }, the act's segment is `look` (no `orient`, no `eyes` on this thread), and the act's answer is
//      byte-identical to the answer read here;
//   2. NO WORKER, THE SAME ANSWER: a caller that answers null, throws, or answers something that is not a look leaves the act to read both here (`orient` and
//      `eyes` timed), and the answer is byte-identical;
//   3. ORIENT REFUSES, EYES IS NEVER READ: on the worker's side as on this thread, and the refusal is the act's answer, byte-identical;
//   4. NO POOL: with no caller injected and no read pool running, nothing is asked and no `look` is timed (the office with its workers off reads as it did).
// test/pos-1219-act-look-workers.test.mjs drives the real pool and a real office.
//
// FLIPS (each reddens the named tests; restore with `git checkout HEAD -- src/world-apex.mjs`):
//   · world-apex.mjs § actLook: return lookHere(...) first, never asking          → 1 reds (asked 0 times, `orient` timed)
//   · world-apex.mjs § actLook: return `handed` even when it is null               → 2 reds (the act answers the orient refusal's TypeError / a 500)
//   · world-apex.mjs § actLookRead: return { oriented } without eyes                → 1 reds (the apex reads `seen.objects` of undefined)
//   · world-apex.mjs § actLookRead / lookHere: read eyes even when orient refused   → 3 reds
//   · world-apex.mjs § actLook: ask without `answeredWithin` (no bound)             → 2's "never answers" reds by the runner's timeout (a hang)
//   · world-apex.mjs § actLook: leave `deadline` off the payload                    → 5's payload test reds
//   · world-apex.mjs § actLookRead: drop the first deadline check                   → 5's "after its deadline" reds
//   · world-apex.mjs § actLookRead: drop the check after orient                     → 5's "passes while orient is read" reds
//   node --import ./test/helpers/sparse-guard.mjs --test test/pos-1219-act-look.test.mjs

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tempDir } from "./helpers/temp-dir.mjs";
import { newTiming, runTiming, timingLine } from "../src/read-timing.mjs";

const within = async (fn) => { const tm = newTiming(); const out = await runTiming(tm, fn); return { out, seg: timingLine(tm, { door: "world-act", status: 200 })?.act?.seg ?? {} }; };
// Two runs of one act are compared byte for byte, so the wall clock the acts stamp their answers with is pinned for both (TEST-DESIGN § Clocks).
const pinned = async (fn) => { const real = Date.now; Date.now = () => Date.UTC(2026, 10, 24, 16, 0, 0); try { return await fn(); } finally { Date.now = real; } };
const sameBytes = (a, b, what) => {
  const [x, y] = [JSON.stringify(a), JSON.stringify(b)];
  const at = [...x].findIndex((c, i) => c !== y[i]);
  assert.equal(y, x, `${what}: the act's answer changed (first difference at ${at}: ${x.slice(Math.max(0, at - 60), at + 80)} | ${y.slice(Math.max(0, at - 60), at + 80)})`);
};

// ── the miniature world (test/pos-1110-act-timing.test.mjs § 3's, cut to the one ambient `say`) ─────────────────────────────────────────────────────────
const repo = tempDir("postmark-1219-");
after(() => rmSync(repo, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })); // this test's own temp folder (Windows can hold a handle a moment longer)
const tmpHome = tempDir("postmark-1219-tmp-");
process.env.TEMP = process.env.TMP = process.env.TMPDIR = tmpHome; // BEFORE the first ../src import that computes a cache path: a private engine cache
after(() => rmSync(tmpHome, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
process.env.WORLD_CLONE = repo;
process.env.WORLD_STORE_DB = join(repo, "no-world-db-here.db");
process.env.VOICES_LOG = join(repo, "voices-log.jsonl");
for (const k of ["WORLD_PRESENCE", "WORLD_EMISSIONS", "WORLD_STORE_READS", "WORLD_STORE_SHADOW", "OFFICE_READ_WORKERS"]) delete process.env[k];

const git = (...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const put = (path, text) => { const full = join(repo, path); mkdirSync(dirname(full), { recursive: true }); writeFileSync(full, text); };
const FRAME = "the-town/let-there-be-light";
const MARKS = [
  { id: FRAME, by: "the-town", kind: "sited", tier: "constitution", at: { x: 0, y: 0 }, extent: { w: 100000, h: 100000 }, body: "Let there be light." },
  { id: "the-town/sound", by: "the-town", kind: "sited", tier: "constitution", at: { x: -900, y: -760 }, extent: { w: 200, h: 200 }, body: "A voice carries sixty metres and is heard for five minutes.",
    props: { class: "sound", class_version: 1, ambient: true, dials: { radius_m: 60, hearing_ttl_min: 5, flood_cap: 20 }, actions: [{ action: "say", residue: "the-town/sound" }] } },
];
put("WORLD/world-state.json", JSON.stringify({ tick: 0, dials: {}, marks: MARKS, parcels: [], determined: {}, vague: [], rivalries: [], portfolios: {}, terrain_weight: {}, errors: [] }));
put("WORLD/skeleton.json", JSON.stringify({ features: [], physics_registry: {} }));
put("seeding/manifest.json", JSON.stringify({ homes: [] }));
put("WORLD/walk-ledger.md", "# walks\n");
put("tools/geometry.mjs", `
export const rect = (mk) => ({ x: mk.at?.x ?? 0, y: mk.at?.y ?? 0, w: mk.extent?.w ?? 1, h: mk.extent?.h ?? 1 });
export function pointInRect(px, py, r) { return px >= r.x - r.w / 2 && px <= r.x + r.w / 2 && py >= r.y - r.h / 2 && py <= r.y + r.h / 2; }
export function overlapArea(a, b) {
  const dx = Math.min(a.x + a.w / 2, b.x + b.w / 2) - Math.max(a.x - a.w / 2, b.x - b.w / 2);
  const dy = Math.min(a.y + a.h / 2, b.y + b.h / 2) - Math.max(a.y - a.h / 2, b.y - b.h / 2);
  return dx > 0 && dy > 0 ? dx * dy : 0;
}
export const contains = (outer, inner) => overlapArea(outer, inner) >= 0.99 * inner.w * inner.h;
export const polygonOf = () => null;
export function pointInPolygon() { return false; }
`);
put("tools/world-verbs.mjs", `
import { rect, contains, pointInRect } from "./geometry.mjs";
const area = (m) => (m.extent?.w ?? 1) * (m.extent?.h ?? 1);
export function containmentChain(pos, marks) {
  const containing = marks
    .filter((m) => m.at && (m.kind === "sited" || m.kind === "parcel") && pointInRect(pos.x, pos.y, rect(m)))
    .sort((a, b) => area(a) - area(b));
  const nest = [];
  for (const m of containing) if (!nest.length || contains(rect(m), rect(nest[nest.length - 1]))) nest.push(m);
  return nest.reverse().map((m) => ({ id: m.id, by: m.by, tier: m.tier, body: m.body, extentM: Math.max(m.extent?.w ?? 0, m.extent?.h ?? 0) }));
}
const REACH_M = 300;
export function orient(state, world) {
  const within = containmentChain(state, world.marks);
  return { charter: { light: "let there be light", from_mark: within[0]?.id ?? null }, you: { name: state.name ?? "(unnamed)", at: { x: state.x, y: state.y }, within }, verbs: [] };
}
export function openYourEyes(state, world) {
  const seen = world.marks
    .filter((m) => m.at && (m.kind === "sited" || m.kind === "parcel"))
    .map((m) => ({ id: m.id, at: m.at, bearing: "N", distM: Math.round(Math.hypot(m.at.x - state.x, m.at.y - state.y)) }))
    .filter((o) => o.distM <= REACH_M)
    .sort((a, b) => a.distM - b.distM);
  const fov = { carried: seen.filter((o) => o.distM <= 50), far: seen.filter((o) => o.distM > 50) };
  const radial = { within: containmentChain(state, world.marks) };
  fov.within = radial.within;
  return { fov, radial, tell: () => "you see the fixture" };
}
export function investigate() { return null; }
`);
put("tools/world-build.mjs", `export function assembleWorld({ worldState, skeleton }) { return { ...worldState, skeleton }; }`);
put("tools/walk.mjs", `export function parseWalkLedger() { return { departures: [] }; }`);
put("tools/where-is.mjs", `
export const NOWHERE = Object.freeze({ x: null, y: null, placed: false, source: null, mark_id: null });
const HOMES = { beta: { x: 40000, y: 40000, mark_id: null }, gamma: { x: -880, y: -750, mark_id: null } };
export function homeOf(handle) {
  const h = HOMES[handle];
  return h ? { ...h, placed: true, source: "home", parcel: { id: h.mark_id, at: { x: h.x, y: h.y }, extent: { w: 25, h: 25 } } } : NOWHERE;
}
export function whereIs(handle) { const h = homeOf(handle); return h.placed ? { ...h, position: null } : NOWHERE; }
export function publicResidents() { return []; }
`);
git("init", "--quiet", "--initial-branch=main");
git("-c", "user.name=t", "-c", "user.email=t@t", "add", "-A");
git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "--quiet", "-m", "fixture world");

const { SCHEMA } = await import("../src/world-store.mjs");
{
  const db = new DatabaseSync(join(repo, "apex-world.db"));
  db.exec(SCHEMA);
  const meta = db.prepare("INSERT OR REPLACE INTO meta VALUES (?, ?)");
  meta.run("as_of_world", "apexfixture0000000000000000000000000000");
  meta.run("hydrated_at", new Date().toISOString());
  meta.run("hydration_status", "OK");
  const node = db.prepare("INSERT OR REPLACE INTO nodes VALUES (?,?,?,?,?,?,?,?,?,?)");
  for (const m of MARKS) {
    node.run(m.id, "mark", m.kind, m.tier ?? null, m.by ?? null, m.at?.x ?? null, m.at?.y ?? null, m.extent?.w ?? null, m.extent?.h ?? null,
      JSON.stringify({ slug: m.id.split("/").at(-1), body: m.body ?? "",
        path: m.props?.class != null ? `WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/${m.id.split("/").at(-1)}/mark.md` : `WORLD/marks/${m.id}/mark.md`, ...(m.props ?? {}) }));
  }
  db.close();
}
const W = await import("./helpers/world-rows.mjs");
W.publishWorld(join(repo, "apex-world.db"));
const { worldApex, __setActLookCallerForTest, __actLookReadForTest } = await import("../src/world-apex.mjs");
const { workerCallable } = await import("../src/read-workers.mjs");
process.env.WORLD_APEX = "1";
after(() => { delete process.env.WORLD_APEX; __setActLookCallerForTest(null); });
// beta stands far from the sound mark (nothing in reach); gamma stands inside it (the mark is in eyes' reach, so `seen.objects` carries it)
const KEY_BETA = { household: "house-b", handles: new Set(["beta"]) };
const KEY_GAMMA = { household: "house-g", handles: new Set(["gamma"]) };
const KEY_TWO = { household: "house-2", handles: new Set(["beta", "gamma"]) }; // a multi-resident key that names no handle: orient refuses

/** A caller that is a worker: it runs the worker's own read and hands the answer back through a structured clone, as a port does. */
function portCaller(asked) {
  return async (name, payload) => { asked.push({ name, payload: structuredClone(payload) }); return structuredClone(await __actLookReadForTest(structuredClone(payload))); };
}
const control = (args, key) => pinned(() => { __setActLookCallerForTest(async () => null); return within(() => worldApex(args, key)); });

test("0 · the fixture: with no pool running this process has no worker to ask, and the say dispatches", async () => {
  __setActLookCallerForTest(null);
  assert.equal(workerCallable(), false, "no read pool runs in this process");
  const out = await pinned(() => worldApex({ do: "say" }, KEY_BETA));
  assert.ok(!out.error && out.did === "say", `control: the act dispatched (${JSON.stringify(out).slice(0, 200)})`);
});

for (const [who, key] of [["beta (nothing in reach)", KEY_BETA], ["gamma (the sound mark in reach)", KEY_GAMMA]]) {
  test(`1 · ${who}: the look is asked of a worker once, with the act's args, key and roll; the segment is \`look\`; the answer is byte-identical`, async () => {
    const here = await control({ do: "say" }, key);
    assert.ok(!here.out.error && here.out.did === "say", `control: the act dispatched here (${JSON.stringify(here.out).slice(0, 200)})`);
    assert.ok(here.seg.orient && here.seg.eyes, "control: read here, orient and eyes are timed on this thread");
    const asked = [];
    const there = await pinned(() => { __setActLookCallerForTest(portCaller(asked)); return within(() => worldApex({ do: "say" }, key, { roll: ["beta", "gamma"] })); });
    __setActLookCallerForTest(null);
    // LAW (POS-1219): "an act's orient and eyes reads move to a read worker, and the act itself stays on main"
    assert.equal(asked.length, 1, `the look was asked of a worker once (asked ${asked.length})`);
    assert.equal(asked[0].name, "act-look");
    // until 2026-11-24 (Truey's N2) this asserted ["args", "key", "roll"]: the payload now carries the act's deadline too (5 · below)
    assert.deepEqual(Object.keys(asked[0].payload).sort(), ["args", "deadline", "key", "roll"], "the payload is the act's args, its key, the town roll and its deadline");
    assert.deepEqual([...asked[0].payload.key.handles], [...key.handles], "the key crossed whole");
    assert.deepEqual(asked[0].payload.roll, ["beta", "gamma"], "the roll the act was given rides with it");
    assert.ok(there.seg.look?.n === 1, `the look is timed as \`look\`: ${JSON.stringify(there.seg)}`);
    assert.equal(there.seg.orient, undefined, "orient was not read on this thread");
    assert.equal(there.seg.eyes, undefined, "eyes was not read on this thread");
    assert.ok(there.seg.handler?.n === 1, "the act's verb ran here, once");
    // LAW (POS-1219): "answers byte-identical to today's"
    sameBytes(await pinned(() => { __setActLookCallerForTest(async () => null); return worldApex({ do: "say" }, key, { roll: ["beta", "gamma"] }); }), there.out, "a look read on a worker and crossed through a port");
    __setActLookCallerForTest(null);
  });
}

test("1 · the look a worker reads is the look this thread reads (orient whole, eyes' objects), crossed through a port", async () => {
  const payload = { args: { do: "say" }, key: KEY_GAMMA, roll: [] };
  const a = await pinned(() => __actLookReadForTest(payload));
  const b = await pinned(async () => structuredClone(await __actLookReadForTest(structuredClone(payload))));
  assert.ok(a.oriented?.you?.within?.length >= 1 && Array.isArray(a.seen?.objects), `control: a real look (${JSON.stringify(a).slice(0, 200)})`);
  assert.ok(a.seen.objects.some((o) => o.id === "the-town/sound"), `control: gamma has the sound mark in reach: ${JSON.stringify(a.seen.objects).slice(0, 200)}`);
  assert.equal(JSON.stringify(b.oriented), JSON.stringify(a.oriented), "orient survives the clone byte for byte");
  assert.equal(JSON.stringify(b.seen), JSON.stringify(a.seen), "eyes survives the clone byte for byte");
});

for (const [why, fn] of [
  ["answers null (no worker answered)", async () => null],
  ["throws", async () => { throw new Error("the port broke"); }],
  ["answers something that is not a look", async () => ({ nope: true })],
]) {
  test(`2 · a worker that ${why}: the act reads both here, and the answer is byte-identical`, async () => {
    const here = await control({ do: "say" }, KEY_GAMMA);
    const fell = await pinned(() => { __setActLookCallerForTest(fn); return within(() => worldApex({ do: "say" }, KEY_GAMMA)); });
    __setActLookCallerForTest(null);
    assert.ok(fell.seg.look?.n === 1, "a worker was asked");
    assert.ok(fell.seg.orient?.n === 1 && fell.seg.eyes?.n === 1, `and then the look was read here: ${JSON.stringify(fell.seg)}`);
    sameBytes(here.out, fell.out, `a worker that ${why}`);
  });
}

test("2 · a worker that never answers: the act waits only its bound, then reads both here, and the answer is byte-identical", async () => {
  const here = await control({ do: "say" }, KEY_GAMMA);
  const t0 = performance.now();
  const fell = await pinned(() => { __setActLookCallerForTest(() => new Promise(() => {}), { waitMs: 150 }); return within(() => worldApex({ do: "say" }, KEY_GAMMA)); });
  const took = performance.now() - t0;
  __setActLookCallerForTest(null);
  assert.ok(fell.seg.look?.n === 1 && fell.seg.look.sum_ms >= 140, `the act waited its bound for the worker: ${JSON.stringify(fell.seg.look)}`);
  assert.ok(fell.seg.orient?.n === 1 && fell.seg.eyes?.n === 1, `and then read the look here: ${JSON.stringify(fell.seg)}`);
  assert.ok(took < 10_000, `the act did not hang (${Math.round(took)} ms)`);
  sameBytes(here.out, fell.out, "a worker that never answers");
});

// ── 5 · the deadline (Truey's N2) ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test("5 · the look's payload carries the act's deadline: the instant the act stops waiting", async () => {
  const asked = [];
  const t0 = Date.now();
  __setActLookCallerForTest(async (name, payload) => { asked.push(payload); return null; }, { waitMs: 4321 });
  await worldApex({ do: "say" }, KEY_BETA);
  const t1 = Date.now();
  __setActLookCallerForTest(null);
  assert.equal(asked.length, 1);
  assert.ok(Number.isFinite(asked[0].deadline), `the payload carries a deadline: ${JSON.stringify(Object.keys(asked[0]))}`);
  assert.ok(asked[0].deadline >= t0 + 4321 && asked[0].deadline <= t1 + 4321, `the deadline is the act's start plus its wait (${asked[0].deadline - t0} ms after it began)`);
});

test("5 · a worker that reaches the call after its deadline reads nothing and answers null; before it, the look", async () => {
  const live = await __actLookReadForTest({ args: { do: "say" }, key: KEY_GAMMA, roll: [], deadline: Date.now() + 60_000 });
  assert.ok(live?.oriented && live.seen, "control: a deadline still ahead reads the look");
  // LAW (Truey's N2): "the worker answers `failed` without reading once it's past" (here: null, which the act reads as no answer)
  const real = Date.now;
  let reads = 0;
  const past = real() - 1;
  Date.now = () => { reads += 1; return real(); };
  let out;
  try { out = await __actLookReadForTest({ args: { do: "say" }, key: KEY_GAMMA, roll: [], deadline: past }); }
  finally { Date.now = real; }
  assert.equal(out, null, "past its deadline the worker answers null");
  assert.equal(reads, 1, `and reads nothing: the clock is read once, by the deadline check, and orient never runs (the clock was read ${reads} times)`);
});

test("5 · a deadline that passes while orient is read leaves eyes unread: null", async () => {
  const real = Date.now;
  const base = real();
  let calls = 0;
  Date.now = () => (++calls === 1 ? base : base + 3_600_000); // the first look at the clock (the worker's first check) is in time; every later one is an hour on
  let out;
  try { out = await __actLookReadForTest({ args: { do: "say" }, key: KEY_GAMMA, roll: [], deadline: base + 1000 }); }
  finally { Date.now = real; }
  assert.ok(calls > 1, "control: the clock was read again after the first check (the read went on past it)");
  assert.equal(out, null, "the deadline passed during orient, so eyes was not read and nothing was answered");
});

test("5 · a saturated worker (answering 20× past the bound) cannot make the act wait longer than its bound; its late answer is dropped", async () => {
  const here = await control({ do: "say" }, KEY_GAMMA);
  // ORDER, NOT A WALL-CLOCK MARGIN (TEST-DESIGN § Clocks; Truey on #1220): the act and the worker each say when they answered, and the act must come first
  const order = [];
  let workerRun = null;
  const slow = (name, payload) => (workerRun = (async () => {
    await new Promise((r) => setTimeout(r, 2000));
    const look = structuredClone(await __actLookReadForTest({ ...payload, deadline: Infinity }));
    order.push("worker");
    return look;
  })());
  const fell = await pinned(() => { __setActLookCallerForTest(slow, { waitMs: 100 }); return within(() => worldApex({ do: "say" }, KEY_GAMMA)); });
  order.push("act");
  __setActLookCallerForTest(null);
  const late = await workerRun;
  // LAW (Truey's N2): "a saturated pool can't make an act wait 20 s and then pay the main-thread cost anyway" — the act waits its bound, not the worker
  assert.ok(late?.oriented && late.seen, "control: the saturated worker did answer, with a whole look");
  assert.deepEqual(order, ["act", "worker"], "the act answered before the saturated worker did; the worker's late answer was dropped");
  assert.ok(fell.seg.look?.n === 1, `the act asked the worker once: ${JSON.stringify(fell.seg.look)}`);
  assert.ok(fell.seg.orient?.n === 1 && fell.seg.eyes?.n === 1, "and read its look itself");
  sameBytes(here.out, fell.out, "a saturated worker");
});

test("5 · end to end: a worker too late answers null, and the act reads its look here, byte-identical", async () => {
  const here = await control({ do: "say" }, KEY_GAMMA);
  // the worker reaches the call only once the act has answered (order, not a timer): by then the act's deadline (its pinned start + 40 ms) is long past
  let actAnswered;
  const answered = new Promise((r) => { actAnswered = r; });
  let workerRun = null;
  const late = (name, payload) => (workerRun = (async () => { await answered; return __actLookReadForTest(payload); })());
  const fell = await pinned(() => { __setActLookCallerForTest(late, { waitMs: 40 }); return within(() => worldApex({ do: "say" }, KEY_GAMMA)); });
  __setActLookCallerForTest(null);
  actAnswered();
  // LAW (Truey's N2): "the worker answers `failed` without reading once it's past" — the late worker's own return is null (Truey's N1 on #1220: asserted, not assumed)
  assert.equal(await workerRun, null, "the worker that came too late answered null");
  assert.ok(fell.seg.orient?.n === 1 && fell.seg.eyes?.n === 1, `the act read the look itself: ${JSON.stringify(fell.seg)}`);
  sameBytes(here.out, fell.out, "a worker that came too late");
});

// ── 6 · the look as its worker saw it (measurement only) ───────────────────────────────────────────────────────────────────────────────────────────────
test("6 · an act's line carries its look's worker, queue, exec, return and the worker's pen leases; a look never answered names its worker and no more", () => {
  const leases = { n: 3, failed: 0, acquire_ms: { sum: 12.5, max: 9.1 }, held_ms: { sum: 18_400.2, max: 17_900 }, failed_wait_ms: 0 };
  const tm = newTiming();
  tm.calls = { "act-look": { slot: 2, sent: 1000, answer: { rid: tm.rid, taken: 1050, done: 19_450, bundle: null, leases }, answer_at: 19_470 } };
  // LAW (POS-1219, the coordinator 2026-11-24): "worker slot, queue_ms and pen leases (acquire and held) on each look's access line, measurement only"
  assert.deepEqual(timingLine(tm, { door: "mcp-act", status: 200 }).act.look,
    { worker: 2, answered: true, queue_ms: 50, exec_ms: 18_400, return_ms: 20, leases }, "the answered look, as its worker reported it");
  const never = newTiming();
  never.calls = { "act-look": { slot: 1, sent: 1000, answer: null, answer_at: null } };
  assert.deepEqual(timingLine(never, { door: "mcp-act", status: 200 }).act.look,
    { worker: 1, answered: false, queue_ms: null, exec_ms: null, return_ms: null, leases: null }, "a look that never answered still names the worker it waited on");
  const none = newTiming();
  assert.equal(timingLine(none, { door: "mcp-act", status: 200 }).act.look, undefined, "no worker asked: no look");
  assert.equal(timingLine(tm, { door: "doorstep", status: 200 }).act, undefined, "a read's line is unchanged");
});

test("6 · the worst-case act line with its look block (every segment, the worker's leases and bundle at their widest) still fits the access line's bound", async () => {
  const { accessLine, LINE_MAX } = await import("../src/telemetry.mjs");
  const { actSpan } = await import("../src/read-timing.mjs");
  const NAMES = ["body", "standing", "law_moved", "dispatch", "look", "orient", "eyes", "ledger_scan", "spine", "gather", "holdings", "households", "nonce_kept", "handler",
    "crossing_law", "world_state", "ledger", "standpoint", "acts_read", "lends", "dungeon_locks", "door_holdings", "vessel_service", "record", "walking", "walk_stop", "land_write", "land", "creatures"];
  const tm = newTiming();
  await runTiming(tm, async () => { for (const n of NAMES) { await actSpan(n, async () => {}); await actSpan(n, async () => {}); } });
  const wide = { n: 999, failed: 999, acquire_ms: { sum: 999_999.9, max: 99_999.9 }, held_ms: { sum: 999_999.9, max: 99_999.9 }, failed_wait_ms: 999_999.9 };
  tm.calls = { "act-look": { slot: 9, sent: 0, answer: { rid: tm.rid, taken: 99_999.9, done: 999_999.9, bundle: { n: 999, sum_ms: 999_999.9, max_ms: 99_999.9 }, leases: wide }, answer_at: 1_999_999.9 } };
  const timing = timingLine(tm, { door: "mcp-act", status: 200 });
  const call = { tool: "world", do: "enter", keys: Array.from({ length: 20 }, (_, i) => `args.field_${String(i).padStart(2, "0")}`), out_bytes: 12345678, bounce: 409 };
  const line = accessLine({ ts: new Date().toISOString(), ip: "2001:0db8:85a3:0000:0000:8a2e:0370:7334", method: "POST", path: "/world/apex", status: 200, ms: 12345,
    ua: "u".repeat(120), household: "h".repeat(40), mcp: "tools/call", call, timing });
  const parsed = JSON.parse(line);
  assert.ok(Buffer.byteLength(line, "utf8") + 1 <= LINE_MAX, `${Buffer.byteLength(line, "utf8")} bytes`);
  assert.equal(parsed.timing?.act?.look?.worker, 9, "the look survived whole");
  assert.equal(parsed.timing_dropped, undefined);
  assert.equal(parsed.call_dropped, undefined, "and the call was not given up for it");
});

test("3 · orient refuses: eyes is never read, on the worker's side or here, and the refusal is the act's answer, byte-identical", async () => {
  const worker = await pinned(() => __actLookReadForTest({ args: { do: "say" }, key: KEY_TWO, roll: [] }));
  assert.ok(worker.oriented?.error, `control: orient refuses a key with two residents and no handle (${JSON.stringify(worker).slice(0, 200)})`);
  assert.equal("seen" in worker, false, "the worker did not read eyes after orient refused");
  const here = await control({ do: "say" }, KEY_TWO);
  assert.ok(here.out.error, "control: the act refuses");
  assert.equal(here.seg.eyes, undefined, "here, eyes was not read after orient refused");
  const asked = [];
  const there = await pinned(() => { __setActLookCallerForTest(portCaller(asked)); return within(() => worldApex({ do: "say" }, KEY_TWO)); });
  __setActLookCallerForTest(null);
  assert.equal(asked.length, 1);
  sameBytes(here.out, there.out, "orient's refusal read on a worker");
});

test("4 · no pool, no seam: nothing is asked, no `look` is timed, orient and eyes are read here", async () => {
  __setActLookCallerForTest(null);
  const { out, seg } = await pinned(() => within(() => worldApex({ do: "say" }, KEY_BETA)));
  assert.ok(!out.error && out.did === "say");
  assert.equal(seg.look, undefined, "no worker to ask, so no look");
  assert.ok(seg.orient?.n === 1 && seg.eyes?.n === 1, `read here: ${JSON.stringify(seg)}`);
});
