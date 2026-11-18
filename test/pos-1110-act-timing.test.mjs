// pos-1110-act-timing.test.mjs — where a world act's time goes (POS-1110: MEASUREMENT ONLY, the same stance as POS-1064/b and POS-1086's segment timing).
//
// On prod, `world { do: "enter" }` and `do: "exit"` ran for seconds and their access lines carried no `timing`. An act now carries the SAME request-scoped
// `timing` object a read does, plus `act: { seg: { <name>: { n, sum_ms, max_ms } } }` (read-timing.mjs § actSpan). The act's answer must be byte-identical with it on.
//
//   1. THE SPAN ITSELF (no world, no clone): sync and async, the callback's own result or exception untouched, a thenable settles as it does, nesting counts both,
//      nothing recorded with no request in scope, and a request's record is its own;
//   2. THE ACT DOORS: a REST apex act and an MCP request holding an act are named (`world-act` ... `mcp-act`); a read, a GET and an unknown path are not; a read
//      door's line carries NO `act`; the worst-case line (every segment, a full `call`) still fits the access line's bound with its `timing` intact;
//   3. THE APEX (a miniature world, in process): `worldApex({ do: "say" })` under a request carries the apex's phases, nested inside `dispatch`, and answers byte-for-byte
//      what it answers with no request in scope;
//   4. ENTER AND EXIT (the real clone's grammar, the injected deps of test/exit-lock.test.mjs and test/ground-lands-on-entry.test.mjs): the crossing's reads and its
//      pen write are named, `record` is one segment, and the answers are byte-identical. SKIPS, saying why, on a checkout with no world clone (WORLD_CLONE=<a clone>);
//   5. THE WIRING, as text pins and labelled so (the weakest instrument): server.mjs, mcp.mjs and world.mjs call the seams this file proves.
//
// FLIPS (each reddens the named test only; restore with `git checkout HEAD -- <file>`):
//   · src/read-timing.mjs § actSpan: drop the `end()` in the throw arm            → "1 · a callback that throws ... is still counted" reds
//   · src/read-timing.mjs § timingLine: drop the `act:` spread                      → "2 · an act door's line carries act.seg" and every test that reads `.act` red
//   · src/world-crossings.mjs § timedDeps: return `deps` untouched                  → "4 · enter" and "4 · exit" red (no `record` segment), "1 · timedDeps" reds
//   · src/world-apex.mjs § apexDo: drop the `actSpan("orient", ...)` wrapper        → "3 · the apex" reds (no orient)
//   · src/read-timing.mjs § classifyMcpAct: ignore `do`                              → "2 · MCP" reds
//   node --import ./test/helpers/sparse-guard.mjs --test test/pos-1110-act-timing.test.mjs
//   (with no checked-out world clone: WORLD_CLONE=<a postmark-world clone> to run 4; 1, 2, 3 and 5 need none)

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { tempDir } from "./helpers/temp-dir.mjs";
import { NO_WORLD, worldClone } from "./fixture-paths.mjs";
import { newTiming, runTiming, timingLine, actSpan, classifyMcpAct, classifyMcpRead, restActDoor, currentTiming } from "../src/read-timing.mjs";
import { accessLine, LINE_MAX } from "../src/telemetry.mjs";

const REAL = worldClone(); // the pinned clone, read before WORLD_CLONE is pointed at the miniature world below
const HAVE_CLONE = !!REAL && existsSync(join(REAL, "tools", "enter-exit.mjs"));
const NO_CLONE = !HAVE_CLONE && (REAL ? `the world clone at ${REAL} has no tools/enter-exit.mjs` : NO_WORLD);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const busy = (ms) => { const e = performance.now() + ms; while (performance.now() < e); };
const within = async (fn) => { const tm = newTiming(); const out = await runTiming(tm, fn); return { out, tm }; };
const lineOf = (tm, door = "world-act") => timingLine(tm, { door, status: 200 });
// Two runs of one act are compared byte for byte, so the wall clock the acts stamp their answers with (`latest`, a ledger row's instant) is pinned for both (TEST-DESIGN § Clocks).
// The timing's own clock is performance.now, which this does not touch.
const pinned = async (fn) => { const real = Date.now; Date.now = () => Date.UTC(2026, 10, 17, 12, 0, 0); try { return await fn(); } finally { Date.now = real; } };

// ── 1 · the span itself ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

test("1 · actSpan: sync and async results come back as the callback's own, counted once each, with a measured duration", async () => {
  const { out, tm } = await within(async () => {
    const s = actSpan("standing", () => { busy(5); return "sync"; });
    const a = await actSpan("standing", async () => { await sleep(1); return "async"; });
    return [s, a, actSpan("gather", () => 7)];
  });
  assert.deepEqual(out, ["sync", "async", 7], "the callbacks' own answers, in their own kinds (a sync callback answers synchronously)");
  const seg = lineOf(tm).act.seg;
  assert.equal(seg.standing.n, 2);
  assert.ok(seg.standing.sum_ms >= 5 && seg.standing.max_ms >= 5 && seg.standing.max_ms <= seg.standing.sum_ms, `standing ${JSON.stringify(seg.standing)}: the 5 ms busy wait is in it, max <= sum`);
  assert.equal(seg.gather.n, 1);
  assert.deepEqual(Object.keys(seg).sort(), ["gather", "standing"], "only what ran is named");
});

test("1 · a callback that throws (sync) or rejects (async) throws and rejects exactly as it did, and is still counted", async () => {
  const boom = new Error("boom");
  const { tm } = await within(async () => {
    assert.throws(() => actSpan("handler", () => { throw boom; }), (e) => e === boom, "a sync throw is the callback's own error, once");
    await assert.rejects(() => actSpan("handler", async () => { throw boom; }), (e) => e === boom, "an async rejection is the callback's own error");
    let runs = 0;
    assert.throws(() => actSpan("handler", () => { runs += 1; throw boom; }));
    assert.equal(runs, 1, "ONE invocation: no retry hides in the span");
  });
  assert.equal(lineOf(tm).act.seg.handler.n, 3, "all three were counted although each threw");
});

test("1 · a thenable that is not a native promise settles as it does", async () => {
  const { out, tm } = await within(() => actSpan("record", () => ({ then(res) { res(42); } })));
  assert.equal(out, 42);
  assert.equal(lineOf(tm).act.seg.record.n, 1);
});

test("1 · nested spans each count: the outer holds the inner, and the inner is not folded into the outer", async () => {
  const { tm } = await within(() => actSpan("dispatch", async () => {
    await actSpan("orient", async () => { busy(5); });
    await actSpan("eyes", async () => { busy(5); });
    busy(5);
  }));
  const seg = lineOf(tm).act.seg;
  assert.ok(seg.dispatch.sum_ms + 0.2 >= seg.orient.sum_ms + seg.eyes.sum_ms, `dispatch ${seg.dispatch.sum_ms} holds orient ${seg.orient.sum_ms} and eyes ${seg.eyes.sum_ms}`);
  assert.ok(seg.dispatch.sum_ms >= 15 && seg.orient.sum_ms < seg.dispatch.sum_ms, "and the outer carries its own 5 ms beside the two inner ones");
});

test("1 · no request in scope: nothing is recorded and the call is the bare one; a request's record is its own", async () => {
  const bystander = newTiming();
  assert.equal(currentTiming(), undefined);
  assert.equal(actSpan("orient", () => "bare"), "bare");
  assert.equal(await actSpan("orient", async () => "bare"), "bare");
  assert.equal(bystander.act, undefined, "a context nobody ran under holds nothing");
  const [a, b] = await Promise.all([
    within(async () => { await actSpan("record", () => sleep(2)); await actSpan("record", () => sleep(2)); }),
    within(async () => { await actSpan("record", () => sleep(2)); }),
  ]);
  assert.equal(lineOf(a.tm).act.seg.record.n, 2);
  assert.equal(lineOf(b.tm).act.seg.record.n, 1, "overlapping requests do not share a bucket");
});

test("1 · a telemetry fault is silence: a request context whose accumulator cannot be written never fails the act", async () => {
  const tm = newTiming();
  Object.freeze(tm); // `tm.act ??=` now throws inside the span's own bookkeeping
  const out = await runTiming(tm, () => actSpan("handler", async () => "the act's own answer"));
  assert.equal(out, "the act's own answer");
});

// ── 2 · the act doors ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

const APEX = { "/household": "household", "/world/apex": "world", "/town/apex": "town" }; // call-shape.mjs § APEX_DOORS, as data: a test that imported it would pass any value

test("2 · REST: a POST to an apex whose body named a `do` is an act door; a read, a GET, another path and another method are not", () => {
  assert.equal(restActDoor(APEX, "POST", "/world/apex", { tool: "world", do: "enter" }), "world-act");
  assert.equal(restActDoor(APEX, "POST", "/household", { tool: "household", do: "other" }), "household-act", "an act the call-shape does not know still names the door (`do` reads 'other')");
  assert.equal(restActDoor(APEX, "POST", "/town/apex", { tool: "town", do: "post" }), "town-act");
  assert.equal(restActDoor(APEX, "POST", "/world/apex", { tool: "world", read: "view" }), null, "a read on the POST door is a read");
  assert.equal(restActDoor(APEX, "POST", "/world/apex", { tool: "world" }), null, "a bare call");
  assert.equal(restActDoor(APEX, "POST", "/world/apex", undefined), null, "a call with no shape (it never parsed)");
  assert.equal(restActDoor(APEX, "GET", "/world/apex", { tool: "world", do: "enter" }), null, "a GET is never an act door here");
  assert.equal(restActDoor(APEX, "POST", "/world/marks", { tool: "world", do: "enter" }), null, "only the three apex paths");
  assert.equal(restActDoor(APEX, "POST", "constructor", { do: "x" }), null, "an inherited property name is not a door");
});

const call = (name, args) => ({ method: "tools/call", params: { name, arguments: args } });
test("2 · MCP: a request holding at least one world / household / town act is `mcp-act`, whatever else rides with it; a request of reads only is not", () => {
  const ACT = call("world", { do: "enter", args: { mark: "x/y" } });
  const READ = call("household", { read: "doorstep" });
  for (const [label, msgs, calls] of [
    ["a world act", [ACT], 1], ["a household act", [call("household", { do: "send" })], 1], ["a town act", [call("town", { do: "post" })], 1],
    ["an act then a read", [ACT, READ], 2], ["a read then an act", [READ, ACT], 2], ["an act among other tools and a notification", [call("whoami", {}), ACT, { method: "notifications/initialized" }], 3],
  ]) assert.deepEqual(classifyMcpAct(msgs), { door: "mcp-act", calls }, label);
  for (const [label, msgs] of [
    ["a read", [READ]], ["a world read", [call("world", { read: "view" })]], ["an explain", [call("world", { explain: "who" })]], ["a bare call", [call("world", {})]],
    ["an empty do", [call("world", { do: "" })]], ["a null do", [call("world", { do: null })]], ["another tool's do", [call("send_letter", { do: "x" })]],
    ["a non-object argument", [call("world", "enter")]], ["a non-call", [{ method: "tools/list" }]], ["nothing", []], ["not an array", null],
  ]) assert.equal(classifyMcpAct(msgs), null, `${label}: no act`);
  // the two classifiers never both claim a request: an act is never a read door, and a read is never an act door
  for (const msgs of [[ACT], [READ], [ACT, READ], [READ, READ]]) assert.ok(classifyMcpRead(msgs) === null || classifyMcpAct(msgs) === null, "a request is one kind");
});

test("2 · an act door's line carries `act.seg` beside the read line's fields; a read door's line carries NO `act`", async () => {
  const { tm } = await within(async () => { await actSpan("orient", () => sleep(1)); });
  for (const door of ["world-act", "household-act", "town-act", "mcp-act"]) {
    const t = timingLine(tm, { door, status: 200 });
    assert.ok(t, `${door} is a door this record covers`);
    assert.deepEqual(Object.keys(t.act), ["seg"]);
    assert.equal(t.act.seg.orient.n, 1);
    assert.deepEqual(Object.keys(t.act.seg.orient).sort(), ["max_ms", "n", "sum_ms"]);
    assert.equal(t.route, "main", "an act is never handed to a read worker");
    assert.equal(t.cov, "pen");
    assert.equal(t.ok, true);
    assert.ok(t.exec_ms === null, "no `routed` mark in this bare context, so exec is absent, not 0");
  }
  for (const door of ["doorstep", "doorsteps", "household", "mcp", "mcp-doorstep"]) {
    const t = timingLine(tm, { door, status: 200 });
    assert.equal(Object.hasOwn(t, "act"), false, `${door}: a read's line is the line it was before POS-1110`);
  }
  assert.equal(timingLine(tm, { door: "world-acts", status: 200 }), null, "a label outside the fixed set is dropped");
  const none = timingLine(newTiming(), { door: "world-act", status: 200 });
  assert.deepEqual(none.act, { seg: {} }, "an act that ran no named phase says so: measured nothing, which is not an absent record");
});

test("2 · the worst-case act line (every named segment, a full `call`, a long client) fits the access line's bound with its `timing` intact", async () => {
  const NAMES = ["body", "standing", "law_moved", "dispatch", "orient", "eyes", "ledger_scan", "spine", "gather", "holdings", "households", "nonce_kept", "handler",
    "crossing_law", "world_state", "ledger", "standpoint", "acts_read", "lends", "dungeon_locks", "door_holdings", "vessel_service", "record", "walking", "walk_stop",
    "land_write", "land", "creatures"];
  const { tm } = await within(async () => { for (const n of NAMES) { await actSpan(n, () => sleep(0)); await actSpan(n, () => sleep(0)); } });
  const timing = lineOf(tm, "mcp-act");
  assert.equal(Object.keys(timing.act.seg).length, NAMES.length);
  const callBig = { tool: "world", do: "enter", keys: Array.from({ length: 20 }, (_, i) => `args.field_${String(i).padStart(2, "0")}`), out_bytes: 12345678, bounce: 409 };
  const line = accessLine({ ts: new Date().toISOString(), ip: "2001:0db8:85a3:0000:0000:8a2e:0370:7334", method: "POST", path: "/world/apex", status: 200, ms: 12345,
    ua: "u".repeat(120), household: "h".repeat(40), mcp: "tools/call", call: { ...callBig, keys: callBig.keys.slice(0, 20) }, timing });
  const parsed = JSON.parse(line);
  assert.ok(Buffer.byteLength(line, "utf8") + 1 <= LINE_MAX, `${Buffer.byteLength(line, "utf8")} bytes`);
  assert.ok(parsed.timing?.act?.seg?.record, "the timing survived whole");
  assert.equal(parsed.timing_dropped, undefined);
  assert.equal(parsed.call_dropped, undefined, "and the call was not given up for it");
});

// ── 3 · the apex, in a miniature world ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
// The fixture is test/world-apex.test.mjs's own miniature (a hand-built store, a stand-in engine), cut to the one ambient `say` that file already acts with.

const repo = tempDir("postmark-1110-");
after(() => rmSync(repo, { recursive: true, force: true }));
const tmpHome = tempDir("postmark-1110-tmp-");
process.env.TEMP = process.env.TMP = process.env.TMPDIR = tmpHome; // BEFORE the first ../src import that computes a cache path: a private engine cache
after(() => rmSync(tmpHome, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
process.env.WORLD_CLONE = repo;
process.env.WORLD_STORE_DB = join(repo, "no-world-db-here.db");
process.env.VOICES_LOG = join(repo, "voices-log.jsonl");
for (const k of ["WORLD_PRESENCE", "WORLD_EMISSIONS", "WORLD_STORE_READS", "WORLD_STORE_SHADOW"]) delete process.env[k];

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
const HOMES = { beta: { x: 40000, y: 40000, mark_id: null } };
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
const { worldApex } = await import("../src/world-apex.mjs");
process.env.WORLD_APEX = "1";
after(() => { delete process.env.WORLD_APEX; });
const KEY_BETA = { household: "house-b", handles: new Set(["beta"]) };

test("3 · the apex: an act under a request carries the apex's phases, nested inside `dispatch`, and answers byte-for-byte what it answers with no request in scope", async () => {
  const off = await pinned(() => worldApex({ do: "say" }, KEY_BETA));
  assert.ok(!off.error && off.did === "say", `control: the act dispatched (${JSON.stringify(off).slice(0, 200)})`);
  const { out, tm } = await pinned(() => within(() => worldApex({ do: "say" }, KEY_BETA)));
  const [a, b] = [JSON.stringify(off), JSON.stringify(out)];
  const at = [...a].findIndex((c, i) => c !== b[i]);
  assert.equal(b, a, `measurement only: the act's answer does not change (first difference at ${at}: ${a.slice(Math.max(0, at - 60), at + 80)} | ${b.slice(Math.max(0, at - 60), at + 80)})`);
  const seg = lineOf(tm).act.seg;
  // FLIP: drop the actSpan wrapper on `worldOrient` in apexDo (world-apex.mjs) and `orient` is gone: this reds
  for (const name of ["dispatch", "orient", "eyes", "spine", "gather", "holdings", "households", "handler"])
    assert.ok(seg[name] && seg[name].n >= 1 && Number.isFinite(seg[name].sum_ms) && Number.isFinite(seg[name].max_ms), `the apex's phase ${name} was timed: ${JSON.stringify(seg[name])}`);
  assert.equal(seg.dispatch.n, 1, "one door call");
  assert.equal(seg.gather.n, 2, "the ambient channel and the ground channel are each gathered");
  assert.equal(seg.handler.n, 1, "the verb ran once");
  const nested = seg.orient.sum_ms + seg.eyes.sum_ms + seg.spine.sum_ms + seg.holdings.sum_ms + seg.households.sum_ms + seg.handler.sum_ms;
  assert.ok(seg.dispatch.sum_ms + 0.6 >= nested, `dispatch ${seg.dispatch.sum_ms} holds its own phases (${nested.toFixed(1)}): they nest, they are not summed into it`);
  for (const name of ["standing", "law_moved", "creatures", "record", "land", "body"]) assert.equal(seg[name], undefined, `${name} did not run on this act, so it is not named (absent, not 0)`);
  // a READ through the same door is timed the same way and is told apart by its door label, not by what the segments hold
  const read = await within(() => worldApex({ handle: "beta" }, KEY_BETA));
  assert.ok(!read.out.error, JSON.stringify(read.out).slice(0, 200));
  assert.equal(lineOf(read.tm).act.seg.dispatch.n, 1);
});

// ── 4 · enter and exit ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

const grammarOf = async () => import(pathToFileURL(join(REAL, "tools", "enter-exit.mjs")).href);
const MARKS_G = () => [{ id: "g/parlor", kind: "sited", by: "g", at: { x: 0, y: 0 }, extent: { w: 20, h: 20 }, body: "An open parlor." }];
const key = (...h) => ({ handles: new Set(h) });
const row = (mark) => `- 2026-10-16T20:00:00.000Z · ann · enters ${mark} · ferry 299.0000 · word neutral`;

/** The office's own plumbing, in a closure (test/ground-lands-on-entry.test.mjs's): the world, one resident standing in the parlor, an in-memory ledger, a pen that appends. */
async function office({ ledger = "" } = {}) {
  const thresholds = await grammarOf();
  let text = ledger;
  const records = [];
  return {
    records,
    world: async () => ({ marks: MARKS_G() }), ledger: async () => text, standpointOf: async (who) => ({ x: 0, y: 0, name: who }), acts: async () => [], now: () => 300,
    record: async (p) => {
      records.push(p.act);
      text += p.lines.join("\n") + "\n";
      const acts = thresholds.parseEnterExitLedger(text).acts;
      return { lines: p.lines, within: thresholds.occupancyAt(acts, 300).get(p.handle) ?? [], commit: "deadbeef", pushed: false };
    },
    walking: async () => null, stop: async () => {}, land: async () => {},
  };
}
const crossings = async () => import("../src/world-crossings.mjs");

test("4 · enter: the crossing's reads and its pen write are named segments, and the answer is byte-identical", { skip: NO_CLONE }, async () => {
  const { enterViaOffice } = await crossings();
  const off = await pinned(async () => enterViaOffice(REAL, { mark: "g/parlor" }, key("ann"), await office()));
  assert.ok(off.entered?.includes("g/parlor"), "control: the enter crossed into the parlor");
  const { out, tm } = await pinned(() => within(async () => enterViaOffice(REAL, { mark: "g/parlor" }, key("ann"), await office())));
  assert.equal(JSON.stringify(out), JSON.stringify(off), "measurement only: the enter's answer does not change");
  const seg = lineOf(tm).act.seg;
  // FLIP: return `deps` untouched from timedDeps (world-crossings.mjs) and `record`, `ledger`, `world_state`, `standpoint` and `walking` are gone: this reds
  for (const name of ["crossing_law", "world_state", "ledger", "standpoint", "vessel_service", "record", "walking"])
    assert.ok(seg[name]?.n >= 1 && Number.isFinite(seg[name].sum_ms), `enter: ${name} was timed (${JSON.stringify(seg[name])})`);
  assert.equal(seg.record.n, 1, "the pen write is ONE segment: the town lock's wait, the child and the commit are not split");
  assert.equal(seg.walk_stop, undefined, "no walk was running, so no stop was written: absent, not 0");
});

test("4 · exit: the same reads and the pen write are named, and the answer is byte-identical", { skip: NO_CLONE }, async () => {
  const { exitViaOffice } = await crossings();
  const off = await pinned(async () => exitViaOffice(REAL, { mark: "g/parlor" }, key("ann"), await office({ ledger: row("g/parlor") + "\n" })));
  assert.ok(!off.error && off.handle === "ann", `control: the exit answered (${JSON.stringify(off).slice(0, 200)})`);
  const { out, tm } = await pinned(() => within(async () => exitViaOffice(REAL, { mark: "g/parlor" }, key("ann"), await office({ ledger: row("g/parlor") + "\n" }))));
  assert.equal(JSON.stringify(out), JSON.stringify(off), "measurement only: the exit's answer does not change");
  const seg = lineOf(tm).act.seg;
  for (const name of ["crossing_law", "world_state", "ledger", "vessel_service", "record"])
    assert.ok(seg[name]?.n >= 1 && Number.isFinite(seg[name].sum_ms), `exit: ${name} was timed (${JSON.stringify(seg[name])})`);
  assert.equal(seg.record.n, 1);
});

test("4 · nothing is recorded with no request in scope, and the deps are the caller's own objects", { skip: NO_CLONE }, async () => {
  const { enterViaOffice, timedDeps } = await crossings();
  const bystander = newTiming();
  const deps = await office();
  assert.equal(timedDeps(deps), deps, "no request in scope: the very same deps, no wrapper allocated");
  const answer = await enterViaOffice(REAL, { mark: "g/parlor" }, key("ann"), deps);
  assert.ok(answer.entered?.includes("g/parlor"));
  assert.equal(bystander.act, undefined);
});

test("1 · timedDeps: every injected dep is a named segment, `this` and the result or exception are the dep's own, and a dep the caller left out stays out", async () => {
  const { timedDeps } = await crossings();
  const NAMES = { world: "world_state", ledger: "ledger", standpointOf: "standpoint", acts: "acts_read", actsStrict: "acts_read", lends: "lends", dungeonLocks: "dungeon_locks",
    doorHoldings: "door_holdings", record: "record", walking: "walking", stop: "walk_stop", land: "land_write" };
  const boom = new Error("a dep's own");
  const deps = { tag: "mine", nowMs: () => 7, flee: true, ...Object.fromEntries(Object.keys(NAMES).map((k) => [k, async function (a) { if (a === "throw") throw boom; return [this.tag, k, a]; }])) };
  delete deps.lends; // a dep the caller did not inject
  const { tm } = await within(async () => {
    const timed = timedDeps(deps);
    assert.notEqual(timed, deps);
    assert.equal(Object.hasOwn(timed, "lends"), false, "an absent dep is not invented (the callers test for it)");
    assert.equal(timed.nowMs, deps.nowMs, "a dep that is not a phase is passed through as it was");
    assert.equal(timed.flee, true);
    for (const k of Object.keys(NAMES)) if (k !== "lends") assert.deepEqual(await timed[k]("x"), ["mine", k, "x"], `${k}: the dep's own answer, called on the caller's deps`);
    await assert.rejects(() => timed.record("throw"), (e) => e === boom, "a dep's own exception");
  });
  const seg = lineOf(tm).act.seg;
  assert.deepEqual(Object.keys(seg).sort(), [...new Set(Object.entries(NAMES).filter(([k]) => k !== "lends").map(([, v]) => v))].sort(), "each phase named once, the two acts reads together");
  assert.equal(seg.acts_read.n, 2, "acts and actsStrict are the same phase");
  assert.equal(seg.record.n, 2, "a dep that threw was still counted");
});

test("1 · the gates every act door shares are timed where they are written: standing, the act-law pin check and the body's arrival", async () => {
  const { standingBounce } = await import("../src/standing.mjs");
  const { lawForAnAct } = await import("../src/act-law.mjs");
  const { readBody } = await import("../src/body.mjs");
  const { out, tm } = await within(async () => [
    await standingBounce({ handles: new Set() }),                                                     // a key with no handles: good standing, nothing to read
    await lawForAnAct({ pins: async () => ({ law: {}, graph: {} }), law: async () => ({ behind: null }), graph: async () => ({ behind: null }) }),
    await readBody({ readableEnded: true }, 1000),                                                    // a body that had already ended: the empty text
  ]);
  assert.deepEqual(out, [null, null, ""], "each answers exactly what it answers with no request in scope (null: the act may go on; the empty body)");
  const seg = lineOf(tm).act.seg;
  for (const name of ["standing", "law_moved", "body"]) assert.equal(seg[name]?.n, 1, `${name} was timed once`);
  // and a refusal is still the gate's own refusal, counted
  const refused = await within(() => lawForAnAct({ pins: async () => ({ law: {}, graph: {} }), law: async () => ({ behind: "the law is behind" }), graph: async () => ({ behind: null }) }));
  assert.equal(refused.out?.behind, "the law is behind");
  assert.equal(lineOf(refused.tm).act.seg.law_moved.n, 1);
});

// ── 5 · the wiring, as text pins (the weakest instrument: they prove the seams are called, not that they time anything) ──────────────────────────────

test("5 · TEXT PINS (weakest): the doors call the classifiers and the one scan is timed where orient and eyes ask for it", () => {
  const src = (f) => readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8");
  assert.match(src("server.mjs"), /door = restActDoor\(APEX_DOORS, req\.method, path, req\.tel\?\.call\);/, "server.mjs § timingFields names a REST act door");
  assert.match(src("server.mjs"), /req\.tm\?\.klass \?\? req\.tm\?\.aklass/, "and an MCP request holding an act");
  assert.match(src("mcp.mjs"), /ctx\.req\.tm\.aklass = classifyMcpAct\(messages\);/, "mcp.mjs sets aklass where the batch is whole");
  assert.match(src("world.mjs"), /await actSpan\("ledger_scan", \(\) => servedLedgerNow\(\)\)/, "world.mjs § enteredNow times the ACTS pool's ledger scan");
  for (const [f, name] of [["standing.mjs", "standing"], ["act-law.mjs", "law_moved"], ["body.mjs", "body"], ["act-watch.mjs", "creatures"], ["town-apex.mjs", "dispatch"], ["household-apex.mjs", "dispatch"], ["world-apex.mjs", "dispatch"]])
    assert.ok(src(f).includes(`actSpan("${name}"`), `${f} times ${name}`);
});
