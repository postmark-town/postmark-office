// act-law-synthetic.test.mjs — POS-680 part 2, proven on invented inputs only.
//
// LAW (Wright, Settled on POS-680, 2026-11-03 03:17Z): "every world act and
// `explain` ask the store's law first, and an act whose law moved but can't load
// is refused with a plain 503." And act-law.mjs § G1: "the act is refused with a
// plain 503 and nothing is done. It is never judged under law the store has
// replaced."
//
// LAW, CONTENTION (Wright, Settled on POS-680, 2026-11-03 01:0x EST, adopting
// Rivet's recommendation): "No stale admission ... an act reuses a refresh in
// flight only if that refresh's pin matches what it was just told; otherwise,
// the existing plain 503 for law that moved but hasn't loaded." Its line "every
// act asks the cheap pin question, even when the load cap is full" was replaced
// (01:5x EST, the round-2 review's F3): "When the cap is full, an act doesn't
// ask outside it. It gets the existing plain, retryable 503 ... an act is never
// admitted on law or graph it hasn't confirmed." And how the pin is asked
// (Wright, 2026-11-03, "C plus coalescing"): "One shared pin session,
// single-flight ... It holds one slot of the existing cap of 2 ... Every act
// arriving while that session is in flight awaits the same answer, within its
// own deadline." Cases 14 to 17 (the review's N2 and N3) and 18 to 26.
//
// LAW, THE MCP REFUSAL'S CODE (CONTRACT.md § Error shape): "`code` is the HTTP
// status, in the body as well as the status line ... so a REST body and an MCP
// answer carry the same fields." Case 11.
//
// INVENTED INPUTS ONLY (the security brief on POS-680, Rivet 2026-11-03): no
// store, no clone, no town or world record, no endpoint, and nothing the test
// relies on from the environment. "The store" here is a function that answers
// the statements the two refreshers send (law-snapshot.mjs § PIN_SQL and
// LAW_AT_BLESSING_SQL; world-graph-snapshot.mjs § PIN_SQL and GRAPH_SQLS) from
// rows written in this file. Any other statement throws, by name.
//
// THE DOORS ARE THEIR OWN LINES. src/server.mjs, src/mcp.mjs and
// src/world-apex.mjs do I/O at import (they read the clones, open stores and
// listen), so no test can import them on invented inputs. Their gate lines are
// lifted from the source as it stands and run in node:vm, every collaborator
// they name handed in (HANDBOOK CRAFT WIRING-AND-PINS: "lift the lines and run
// them ... and assert the lines were found; never test a second copy of the
// rule"). The law they ask is the real act-law.mjs § lawForAnAct, on the
// invented store. Each lift asserts it found its lines exactly once, so a door
// that moved or was renamed reds here instead of passing on nothing.
//
// THE FLIPS (each run by hand on a committed tree, one at a time, the source put
// back after each; every red an AssertionError; measured 2026-11-02 on Windows):
//   F1 act-law.mjs: lawForAnAct admits whatever is behind (always null) → 3, 4, 5, 9, 11 red
//   F2 law-snapshot.mjs: freshLaw answers what stands without asking → 1, 2, 3, 4, 7, 9, 10, 11, 12, 13 red
//   F3 server.mjs: POST /world/hold without its `lawMovedRefused` line → 8, 9, 10 red
//   F4 mcp.mjs: the gate's call disconnected (`moved = null`) → 11, 12 red
//   F5 world-apex.mjs: explainClassOr's ask not awaited → 13 red ("ask → store:G1 → explain:G1:S1")
//   F5b world-apex.mjs: explainClassOr never asks → 13 red
//   F6 server.mjs: the stake route answers the refusal and acts anyway → 9 red
// Re-proved 2026-11-03 at 05ff1e2aa (Windows, Node 25), after the FIX round
// reshaped freshLaw; F3, F5, F5b and F6 strike lines it did not touch and were
// not re-run:
//   F1 → 3, 4, 5, 9, 11, 14, 15, 16, 17 red
//   F2 (freshLaw's first line returns what stands) → 1, 2, 3, 4, 7, 9, 10, 11, 12, 13, 14, 15 red
//   F4 → 11, 12 red
// The FIX round's own (2026-11-03 at 05ff1e2aa; each reds exactly the cases named):
//   F7  mcp.mjs: the law refusal without `code` → 11 red
//   F8  server.mjs: POST /world/apex asks the law above the standing gate again → 9 red
//   F9  law-snapshot.mjs: at the cap, freshLaw answers what stands without asking the pin → 14 red
//   F10 law-snapshot.mjs: an act joins a refresh in flight without asking the pin → 15 red
//   F11 law-snapshot.mjs: an act stands on a refresh in flight whatever it put in force → 15 red
//   F12 law-snapshot.mjs: the act's own pin is not recorded → 14 (/release), 15 (act A) red
//   F13 law-snapshot.mjs: at the cap, a store that cannot be asked refuses → 14 red
//   F14 law-snapshot.mjs: under contention, the verdict ignores the pin it was told → 14, 15 red
//   F9g to F14g: the same six in world-graph-snapshot.mjs → 16; 17; 17; 16, 17; 16; 16, 17 red
// Round 3 (2026-11-03 at 4320f347a, Windows, Node 25). F9 to F14g struck code
// round 3 removed (the per-act pin question) and are retired; F2 is replaced by
// F2r. F7, F8, F1 and F4 were re-run; F3, F5, F5b and F6 strike untouched lines:
//   F7 → 11 red; F8 → 9 red; F4 → 11, 12 red
//   F1 → 3, 4, 5, 9, 11, 15, 17, 23, 24 red
//   F2r act-law.mjs: the shared question never asks the law's pin → 1–4, 7, 9–15, 18, 20–23 red
//   S1  act-law.mjs: every act opens its own session (no single-flight) → 18, 20, 21, 22 red
//   S2  act-law.mjs: a waiter ignores its own deadline → 21 red
//   S3  act-law.mjs: the session never gives up at its deadline → 22 red
//   S4  act-law.mjs: the session asks outside the cap → 14, 16, 19 red
//   S5  act-law.mjs: an answer that did not come in time admits → 20, 21, 22 red
//   S6  law-snapshot.mjs: a store that cannot be asked refuses (G1 retired) → 6 red
//   N6a law-snapshot.mjs: an act's pin written even when older → 23 red
//   N6b law-snapshot.mjs: "behind" is any difference, not newer by settlement → 23 red
//   N6c world-graph-snapshot.mjs: an act's key written even when older or already ahead → 17, 24 red
//   N6d world-graph-snapshot.mjs: a pin older than the graph in force counts as behind → 24 red
//   U1  law-snapshot.mjs: a refresh in flight is never stood on, even when it matches → 15, 25 red
//   U1g world-graph-snapshot.mjs: the same → 17, 26 red
// act-law-pool.test.mjs (the real-Postgres F3 falsifier) is graded across
// versions instead: 2/3 at 94da8f368, 1/3 at f4431ccff, 2/3 at c86cea70d (F3
// as first ruled), 3/3 at round 3's head.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

import * as actLaw from "../src/act-law.mjs";
import * as law from "../src/law-snapshot.mjs";
import * as graph from "../src/world-graph-snapshot.mjs";
import { loadsStanding } from "../src/snapshot-loads.mjs";

const settle = () => new Promise((r) => setImmediate(r));

// ── the invented law store ──────────────────────────────────────────────────
const SHA = (n, c) => String(n).padStart(40, c);
/** One invented class with one property: what settlement `n` blessed. */
const lawRows = (n, glow) => [
  { number: n, tag_sha: SHA(n, "a"), newest: n, kind: "class", key: "test-lamp", data: { class: "test-lamp" } },
  { number: n, tag_sha: SHA(n, "a"), newest: n, kind: "property", key: "test-lamp/glow",
    data: { class: "test-lamp", parent: null, name: "glow", tier: "constitution", default: glow, id: "test/test-lamp-glow" } },
];
function lawStore() {
  const s = { newest: null, pinned: null, rows: new Map(), pinAsks: 0, lawAsks: 0, failLaw: false, failPin: false, hang: null, slow: false, pinHold: null };
  const query = async (sql) => {
    if (sql === law.LAW_REFRESH_SQLS.pin) {
      s.pinAsks += 1;
      if (s.failPin) throw new Error("connect ECONNREFUSED (invented)");
      const at = { newest: s.newest, pinned: s.pinned }; // read as the statement began
      // `pinHold`, once: the next pin answer waits on it (and fails if it rejects, as a cancelled statement does)
      if (s.pinHold) { const hold = s.pinHold; s.pinHold = null; await hold; }
      return { rows: [at] };
    }
    if (sql === law.LAW_REFRESH_SQLS.law) {
      s.lawAsks += 1;
      const at = s.pinned; // a statement reads the store as it stood when it began, as Postgres does
      if (s.failLaw) throw new Error("the connection was reset (invented)");
      if (s.hang) await s.hang;
      if (s.slow) await settle();
      return { rows: s.rows.get(at) ?? [] };
    }
    throw new Error(`the invented law store was asked a statement it does not hold: ${String(sql).trim().slice(0, 60)}`);
  };
  const bless = (n, glow) => { s.rows.set(n, lawRows(n, glow)); s.newest = n; s.pinned = n; };
  return { s, query, bless };
}

// ── the invented graph store ────────────────────────────────────────────────
const GRAPH_STATEMENTS = new Set(Object.values(graph.GRAPH_SQLS));
function graphStore() {
  const s = { pin: null, builds: new Map(), pinAsks: 0, tableAsks: 0, failTables: false, failPin: false, hang: null, pinHold: null };
  const query = async (sql, params) => {
    if (sql === graph.PIN_SQL) {
      s.pinAsks += 1;
      if (s.failPin) throw new Error("connect ECONNREFUSED (invented)");
      const at = s.pin; // read as the statement began
      if (s.pinHold) { const hold = s.pinHold; s.pinHold = null; await hold; }
      return { rows: at ? [at] : [] };
    }
    if (GRAPH_STATEMENTS.has(sql)) {
      s.tableAsks += 1;
      // the tables are read at the pin the refresh found, which the store still holds after it builds a newer one
      const at = s.builds.get(params?.[0]);
      if (s.failTables) throw new Error("the connection was reset (invented)");
      if (s.hang) await s.hang;
      assert.ok(at && params[1] === at.office_sha, `the graph's tables are read at a pin the store built (${JSON.stringify(params)})`);
      return { rows: sql === graph.GRAPH_SQLS.meta ? [{ key: "invented_build", value: `G${at.settlement}` }] : [] };
    }
    throw new Error(`the invented graph store was asked a statement it does not hold: ${String(sql).trim().slice(0, 60)}`);
  };
  const build = (n) => { s.pin = { tag_sha: SHA(n, "c"), office_sha: SHA(n, "d"), settlement: n, built_at: `2026-11-0${n}T00:00:00Z` }; s.builds.set(s.pin.tag_sha, s.pin); };
  return { s, query, build };
}
const graphBuild = () => graph.worldGraphSnapshot()?.tables?.meta?.find((r) => r.key === "invented_build")?.value ?? null;
const glowNow = () => law.lawSnapshot()?.properties?.get("test-lamp")?.get("glow")?.default ?? null;

/** What every door's lawForAnAct() does, on the invented stores: the real lawForAnAct, askPins (the one shared pin question), freshLaw and freshGraph. */
function asker(L, G, deadlineMs = 200) {
  const asked = { n: 0 };
  const seams = {
    pins: () => actLaw.askPins({ lawQuery: L.query, graphQuery: G.query, deadlineMs }),
    law: (o) => law.freshLaw({ query: L.query, deadlineMs, ...o }),
    graph: (o) => graph.freshGraph({ query: G.query, deadlineMs, ...o }),
  };
  const ask = () => { asked.n += 1; return actLaw.lawForAnAct(seams); };
  const answer = () => actLaw.lawForAnAnswer(seams);
  return { ask, answer, asked, seams };
}
/** S1 and G1 loaded by the refreshers' own tick (not by an act), as an office that has been up a while stands. */
async function standing() {
  const L = lawStore(), G = graphStore();
  L.bless(1, 1); G.build(1);
  await law.reloadLawSnapshot({ query: L.query });
  await graph.reloadWorldGraph({ query: G.query });
  assert.equal(law.lawSnapshot()?.pin?.settlement, 1, "the floor: the tick loaded S1");
  assert.equal(graphBuild(), "G1", "the floor: the tick loaded G1");
  return { L, G, ...asker(L, G) };
}

beforeEach(() => { law.resetLawSnapshot(); graph.resetWorldGraph(); });
afterEach(async () => {
  for (let i = 0; i < 5; i++) await settle();
  assert.equal(loadsStanding().running, 0, "a case left a store load running (the cap would skip the next case's ask)");
  law.resetLawSnapshot(); graph.resetWorldGraph();
});

// ── 1–6 · the ask itself (act-law.mjs § lawForAnAct over the real refreshers) ──

test("1 · unchanged law and graph: the act may go on, and only the pins are asked again", async () => {
  const { L, G, ask } = await standing();
  const before = { pins: L.s.pinAsks, law: L.s.lawAsks, tables: G.s.tableAsks };
  assert.equal(await ask(), null);
  assert.equal(L.s.pinAsks, before.pins + 1, "the act asked the law's pin");
  assert.equal(L.s.lawAsks, before.law, "an unchanged law is not loaded again");
  assert.equal(G.s.tableAsks, before.tables, "an unchanged graph is not loaded again");
  assert.equal(law.lawSnapshot().pin.settlement, 1);
});

test("2 · the law moved and loads: the very next act stands on the new law, with no tick", async () => {
  const { L, ask } = await standing();
  assert.equal(glowNow(), 1);
  L.bless(2, 7);
  assert.equal(await ask(), null, "a law that moved and loaded refuses nothing");
  assert.equal(law.lawSnapshot().pin.settlement, 2, "the act's ask loaded S2 (the stale path would still stand on S1)");
  assert.equal(glowNow(), 7, "and S2's own words are what stands");
  assert.equal(law.lawBehind(), null);
});

test("3 · the law moved and will not load: refused, 503, and the refusal names which law", async () => {
  const { L, ask } = await standing();
  L.bless(2, 7); L.s.failLaw = true;
  const r = await ask();
  assert.equal(r?.code, 503, `LAW: "an act whose law moved but can't load is refused with a plain 503" — got ${JSON.stringify(r)}`);
  assert.equal(r.defect, actLaw.LAW_MOVED.defect);
  assert.equal(r.hint, actLaw.LAW_MOVED.hint);
  assert.match(r.behind, /S2's, and this office has not loaded it yet \(it acts on S1's\)/);
  assert.equal(law.lawSnapshot().pin.settlement, 1, "reads keep what stands");
  assert.match(law.lawRefreshStanding().behind ?? "", /S2's/, "and the refresher's standing says so");
  // once it loads, the same ask lets the act go on, on S2
  L.s.failLaw = false;
  assert.equal(await ask(), null);
  assert.equal(law.lawSnapshot().pin.settlement, 2);
});

test("4 · the law moved and its load hangs past the deadline: refused, never judged under S1", async () => {
  const { L, G } = await standing();
  let release;
  L.s.hang = new Promise((r) => { release = r; });
  L.bless(2, 7);
  const { ask } = asker(L, G, 25);
  // The deadline's timer is unref'd by design (a refresher never holds a process open); in the
  // office its server holds the event loop. Here nothing else would, and on Node 22 the loop
  // drained mid-wait and the runner cancelled this case and every one after it (CI, 2026-11-03).
  // This interval stands in for the server while the deadline runs.
  const server = setInterval(() => {}, 1000);
  try {
    const r = await ask();
    assert.equal(r?.code, 503, `LAW: "never judged under law the store has replaced" — got ${JSON.stringify(r)}`);
    assert.equal(law.lawSnapshot().pin.settlement, 1);
  } finally { clearInterval(server); release(); }
  for (let i = 0; i < 5; i++) await settle();
});

test("5 · the graph moved: it loads before the act; when it will not load, the act is refused like a law", async () => {
  const { G, ask } = await standing();
  G.build(2);
  assert.equal(await ask(), null);
  assert.equal(graphBuild(), "G2", "the act's ask loaded the moved graph");
  G.build(3); G.s.failTables = true;
  const r = await ask();
  assert.equal(r?.code, 503, `a graph behind refuses like a law behind — got ${JSON.stringify(r)}`);
  assert.match(r.behind, /world graph/);
  assert.equal(graphBuild(), "G2", "reads keep what stands");
});

test("6 · a store that cannot be asked at all refuses nothing: no law is known to have moved (the ruled fallback, kept)", async () => {
  const { L, ask } = await standing();
  L.s.failPin = true;
  assert.equal(await ask(), null);
  assert.equal(law.lawSnapshot().pin.settlement, 1);
});

// ── 7 · explain's ask (act-law.mjs § lawForAnAnswer) ────────────────────────

test("7 · explain's ask loads both sources the next act will stand on, and refuses nothing even when one will not load", async () => {
  const { L, G, answer } = await standing();
  L.bless(2, 7); G.build(2);
  assert.equal(await answer(), undefined);
  assert.equal(law.lawSnapshot().pin.settlement, 2);
  assert.equal(graphBuild(), "G2");
  L.bless(3, 9); L.s.failLaw = true;
  assert.equal(await answer(), undefined, "a read is never refused for the law");
  assert.equal(law.lawSnapshot().pin.settlement, 2);
  assert.match(law.lawRefreshStanding().behind ?? "", /S3's/);
});

// ── lifting a door's own lines ──────────────────────────────────────────────

const source = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8").replace(/\r\n/g, "\n");
/** The one block that starts at the line `start` matches and ends at the first later line equal to `end` (or that `end` accepts). */
function lift(src, start, end, what) {
  const lines = src.split("\n");
  const at = lines.flatMap((l, i) => (start(l) ? [i] : []));
  assert.equal(at.length, 1, `${what}: found ${at.length} starts, wanted exactly 1 (the lift is stale)`);
  const ends = typeof end === "function" ? end : (l) => l === end;
  const stop = lines.findIndex((l, i) => i > at[0] && ends(l));
  assert.ok(stop > at[0], `${what}: no closing line`);
  return lines.slice(at[0], stop + 1).join("\n");
}
const replaceOnce = (text, from, to, what) => {
  const parts = text.split(from);
  assert.equal(parts.length, 2, `${what}: "${from}" occurs ${parts.length - 1} times, wanted exactly 1`);
  return parts.join(to);
};

// ── 8–10 · the REST doors (server.mjs) ──────────────────────────────────────

const SERVER = source("../src/server.mjs");
const restRoutes = () => {
  const lines = SERVER.split("\n");
  const starts = lines.filter((l) => /^ {4}if \(req\.method === "POST" && .*"\/world\/[a-z-]+"/.test(l));
  return starts.map((head) => ({ head, paths: [...head.matchAll(/"(\/world\/[a-z-]+)"/g)].map((m) => m[1]),
    src: lift(SERVER, (l) => l === head, "    }", head.trim()) }));
};
const LAW_MOVED_REFUSED = lift(SERVER, (l) => l === "async function lawMovedRefused(res) {", "}", "server.mjs § lawMovedRefused");

/** One request through the lifted route, its collaborators handed in. Resolves with the answer, the acts done, and whether the law was asked. */
async function restCall(route, path, body, ask) {
  const acts = [];
  let standingAsked = 0;
  let done;
  const answered = new Promise((r) => { done = r; });
  const res = {};
  const answer = (code, payload) => done({ code, payload });
  const act = (name) => async (...args) => { acts.push({ name, settlement: law.lawSnapshot()?.pin?.settlement ?? null, args: args.length }); return { ok: true, did: name }; };
  const ctx = vm.createContext({
    lawForAnAct: ask,
    j: (r, code, b) => answer(code, b),
    bounce: (r, code, defect, hint) => answer(code, { error: "bounce", defect, hint }),
    bounceFault: (r, what, e) => answer(500, { fault: what, said: String(e?.stack ?? e) }),
    doorTripped: (r, what, e) => answer(500, { fault: what, said: String(e?.stack ?? e) }),
    isBodyTooLarge: () => false, bodyTooLarge: () => answer(413, {}), setWwwAuth: () => {},
    readJsonBody: async () => JSON.stringify(body),
    judgeOrBounce: (r, name, payload) => ({ fields: payload }),
    apexEnabled: () => true, callShape: () => "invented", dispatchToolFor: (verb) => `world_${verb}`,
    bouncer: { checkHouseholdWorldWrite: () => null }, worldWriteHolder: () => "invented-house", worldWriteCost: () => 1,
    rateResponse: () => answer(429, {}),
    harborGated: () => false, HARBOR_BOUNCE: { code: 403, defect: "harbor", hint: "" },
    visitorGated: () => false, visitorBounceFor: () => ({ code: 403, defect: "visitor", hint: "" }),
    visitorBounces: () => false, VISITOR_BOUNCE: { defect: "visitor", hint: "" },
    standingBounce: async () => { standingAsked += 1; return null; },
    validateArgs: () => null, APEX_TOOL: {}, townRoll: () => [], ACT_RETRY: 1, WORLD_CLONE: "invented-world-clone",
    worldApex: act("worldApex"), leaveMarkViaOffice: act("leaveMarkViaOffice"), walkViaOffice: act("walkViaOffice"),
    worldNoteViaOffice: act("worldNoteViaOffice"), callHoldTool: act("callHoldTool"), worldSay: act("worldSay"),
    worldSayHuman: act("worldSayHuman"), worldStakeViaOffice: act("worldStakeViaOffice"), worldUnstakeViaOffice: act("worldUnstakeViaOffice"),
  });
  vm.runInContext(LAW_MOVED_REFUSED, ctx, { filename: "server.mjs § lawMovedRefused (lifted)" });
  const fn = vm.runInContext(`(async function route(req, res, key, path) {\n${route.src}\nreturn "not this route";\n})`, ctx, { filename: `server.mjs § ${route.paths.join(" | ")} (lifted)` });
  const fell = await fn({ method: "POST", tel: {} }, res, { household: "invented-house" }, path);
  assert.notEqual(fell, "not this route", `${path}: the lifted route did not take the request`);
  const timer = new Promise((r) => setTimeout(() => r({ code: "no answer in 2 s" }), 2000).unref());
  const a = await Promise.race([answered, timer]);
  return { ...a, acts, standingAsked };
}

// what each world act route is sent, to reach its act; a route with no recipe here reds case 8
const RECIPES = {
  "/world/apex": [{ do: "take", args: { thing: "invented/a-lamp" } }, "worldApex"],
  "/world/marks": [{ slug: "a-lamp", kind: "thing", body: "invented" }, "leaveMarkViaOffice"],
  "/world/walks": [{ x: 1, y: 2 }, "walkViaOffice"],
  "/world/notes": [{ body: "invented" }, "worldNoteViaOffice"],
  "/world/hold": [{ thing: "invented/a-lamp" }, "callHoldTool"],
  "/world/say": [{ text: "invented words" }, "worldSay"],
  "/world/stake": [{ mark: "invented/a-lamp", stamps: 1 }, "worldStakeViaOffice"],
  "/world/unstake": [{ mark: "invented/a-lamp", stamps: 1 }, "worldUnstakeViaOffice"],
};

test("8 · every POST /world/* route in server.mjs is found, lifted, and has a case here", () => {
  const routes = restRoutes();
  const paths = routes.flatMap((r) => r.paths).sort();
  assert.deepEqual(paths, Object.keys(RECIPES).sort(), "a world act route was added or removed: give it a recipe, or retire one");
  for (const r of routes) assert.match(r.src, /lawMovedRefused\(res\)/, `POST ${r.paths.join(" | ")} acts without asking for the law`);
});

test("9 · REST: when the law moved and will not load, every world act route answers 503 and its act is never performed", async () => {
  for (const route of restRoutes()) {
    for (const path of route.paths) {
      const { L, ask } = await standing();
      L.bless(2, 7); L.s.failLaw = true;
      const [body, actName] = RECIPES[path];
      const r = await restCall(route, path, body, ask);
      assert.equal(r.code, 503, `POST ${path}: LAW: "refused with a plain 503" — got ${JSON.stringify(r)}`);
      assert.equal(r.payload.defect, actLaw.LAW_MOVED.defect, `POST ${path}`);
      assert.match(r.payload.behind, /S2's/, `POST ${path}: the refusal names the law it waits on`);
      assert.deepEqual(r.acts, [], `POST ${path}: ${actName} ran under replaced law`);
      // Until 2026-11-03 this asserted standingAsked 0 ("the apex refuses before anything below it runs").
      // FIX F2 (the review of 94da8f368; Rivet's verdict, 05:20Z): the law is asked below the gates that refuse
      // a caller for who they are, as at the MCP door and the flat routes, so the standing gate runs first.
      if (path === "/world/apex") assert.equal(r.standingAsked, 1, "POST /world/apex: the law was asked before the standing gate (mcp.mjs: \"Below the gates that refuse a caller for who they are\")");
      law.resetLawSnapshot(); graph.resetWorldGraph();
    }
  }
});

test("10 · REST: when the law moved and loads, every world act route performs its act, on the new law (the control for 9)", async () => {
  for (const route of restRoutes()) {
    for (const path of route.paths) {
      const { L, ask } = await standing();
      L.bless(2, 7);
      const [body, actName] = RECIPES[path];
      const r = await restCall(route, path, body, ask);
      assert.equal(r.code, 200, `POST ${path}: ${JSON.stringify(r)}`);
      assert.deepEqual(r.acts.map((a) => [a.name, a.settlement]), [[actName, 2]], `POST ${path}: the act ran once, standing on S2`);
      law.resetLawSnapshot(); graph.resetWorldGraph();
    }
  }
  // the reads beside the acts are never asked: listening, and the apex's bare read
  for (const [path, body, actName] of [["/world/say", {}, "worldSay"], ["/world/apex", {}, "worldApex"]]) {
    const { L, ask, asked } = await standing();
    L.bless(2, 7); L.s.failLaw = true;
    const route = restRoutes().find((x) => x.paths.includes(path));
    const before = asked.n;
    const r = await restCall(route, path, body, ask);
    assert.equal(asked.n, before, `POST ${path} with no act asked for the law`);
    assert.equal(r.code, 200, `POST ${path} (a read) was refused: ${JSON.stringify(r)}`);
    assert.deepEqual(r.acts.map((a) => a.name), [actName]);
    law.resetLawSnapshot(); graph.resetWorldGraph();
  }
});

// ── 11–12 · the MCP door (mcp.mjs) ──────────────────────────────────────────

const MCP = source("../src/mcp.mjs");
const MCP_WRITE_TOOLS = lift(MCP, (l) => l.startsWith("export const WRITE_TOOLS = new Set(["), (l) => /\]\);( *\/\/.*)?$/.test(l), "mcp.mjs § WRITE_TOOLS")
  .replace(/^export /, "");
const MCP_WRITE_SHAPED = (() => {
  const lines = MCP.split("\n");
  const at = lines.flatMap((l, i) => (l.startsWith("const writeShaped = (name, args) => WRITE_TOOLS.has(name)") ? [i] : []));
  assert.equal(at.length, 1, "mcp.mjs § writeShaped: the lift is stale");
  const stop = lines.findIndex((l, i) => i >= at[0] && l.trimEnd().endsWith(";"));
  return lines.slice(at[0], stop + 1).join("\n");
})();
const MCP_GATE = lift(MCP, (l) => l.trim() === "// POS-680 part 2: a world act stands on the law the store has NOW. Both", "      }", "mcp.mjs § the world-act law gate");

async function mcpGate(name, args, key, ask) {
  const ctx = vm.createContext({ lawForAnAct: ask, refusal: (id, body) => ({ refused: body, id }) });
  vm.runInContext(`${MCP_WRITE_TOOLS}\n${MCP_WRITE_SHAPED}`, ctx, { filename: "mcp.mjs § WRITE_TOOLS, writeShaped (lifted)" });
  const fn = vm.runInContext(`(async function gate(msg, name, args, ctx) {\n${MCP_GATE}\nreturn "on to the act";\n})`, ctx, { filename: "mcp.mjs § the law gate (lifted)" });
  return fn({ id: 7 }, name, args, { key });
}
const KEY = { household: "invented-house", handles: new Set(["invented"]) };
const MCP_ACTS = [["world", { do: "take", args: { thing: "invented/a-lamp" } }], ["world_hold", { thing: "invented/a-lamp" }],
  ["world_walk", { x: 1 }], ["world_leave_mark", { slug: "a-lamp" }], ["world_stake", { mark: "invented/a-lamp", stamps: 1 }], ["world_say", { text: "hi" }]];

test("11 · MCP: a world act (the apex's do:, or a flat world_* write) is refused with the law's own refusal when the law moved and will not load", async () => {
  // where the gate sits, read from the source (a text check, the weakest instrument: labelled so):
  // in handleMessage, after the standing gate and before the one callTool that performs the act
  const start = MCP.indexOf("async function handleMessage(msg, ctx) {");
  const end = MCP.indexOf("\n}\n", start);
  const body = MCP.slice(start, end);
  const [standingAt, gateAt, actAt] = [body.indexOf("const st = await standingBounce(ctx.key);"), body.indexOf(MCP_GATE), body.indexOf("await callTool(name, args, { ...ctx, door: \"mcp\" })")];
  assert.ok(start >= 0 && standingAt > 0 && gateAt > 0 && actAt > 0, `the handleMessage landmarks were not all found (${standingAt}, ${gateAt}, ${actAt})`);
  assert.ok(standingAt < gateAt && gateAt < actAt, "the law gate is not between the standing gate and the act");
  for (const [name, args] of MCP_ACTS) {
    const { L, ask, asked } = await standing();
    L.bless(2, 7); L.s.failLaw = true;
    const before = asked.n;
    const r = await mcpGate(name, args, KEY, ask);
    assert.equal(asked.n, before + 1, `${name}: the gate did not ask`);
    assert.equal(r?.refused?.defect, actLaw.LAW_MOVED.defect, `${name}: LAW: "refused ... and nothing is done" — got ${JSON.stringify(r)}`);
    assert.equal(r.refused.code, 503, `${name}: LAW (CONTRACT § Error shape): "\`code\` is the HTTP status, in the body ... so a REST body and an MCP answer carry the same fields" — the MCP refusal carried ${JSON.stringify(r.refused)}`);
    assert.match(r.refused.behind, /S2's/);
    law.resetLawSnapshot(); graph.resetWorldGraph();
  }
});

test("12 · MCP: the same acts go on, on the new law, when it loads; reads, letters, town and household acts are never asked (the control for 11)", async () => {
  for (const [name, args] of MCP_ACTS) {
    const { L, ask } = await standing();
    L.bless(2, 7);
    assert.equal(await mcpGate(name, args, KEY, ask), "on to the act", name);
    assert.equal(law.lawSnapshot().pin.settlement, 2, `${name}: the act goes on standing on S2`);
    law.resetLawSnapshot(); graph.resetWorldGraph();
  }
  const NOT_ASKED = [["world", {}], ["world", { read: "view" }], ["send_letter", { to: "invented", body: "hi" }],
    ["town", { do: "post" }], ["household", { do: "declare" }], ["update_profile", {}]];
  for (const [name, args] of NOT_ASKED) {
    const { L, ask, asked } = await standing();
    L.bless(2, 7); L.s.failLaw = true;
    const before = asked.n;
    assert.equal(await mcpGate(name, args, KEY, ask), "on to the act", `${name} ${JSON.stringify(args)}`);
    assert.equal(asked.n, before, `${name} ${JSON.stringify(args)} asked for the law`);
    law.resetLawSnapshot(); graph.resetWorldGraph();
  }
  // no key: the gate above this one answers it, and this one never asks
  const { ask, asked } = await standing();
  const before = asked.n;
  assert.equal(await mcpGate("world_hold", { thing: "x" }, null, ask), "on to the act");
  assert.equal(asked.n, before);
});

// ── 13 · explain (world-apex.mjs § explainClassOr, § openStore) ────────────

const APEX = source("../src/world-apex.mjs");
const EXPLAIN = lift(APEX, (l) => l === "async function explainClassOr(path, bounced) {", "}", "world-apex.mjs § explainClassOr");
const OPEN_STORE = lift(APEX, (l) => l === "export function openStore() {", "}", "world-apex.mjs § openStore").replace(/^export /, "");

async function explainVia(answer) {
  const events = [];
  let src = EXPLAIN;
  for (const spec of ["./act-law.mjs", "./class-read.mjs", "./admin-role.mjs"]) src = replaceOnce(src, `import("${spec}")`, `__load("${spec}")`, `explainClassOr's import of ${spec}`);
  const modules = {
    "./act-law.mjs": { lawForAnAnswer: async () => { events.push("ask"); await answer(); events.push("asked"); } },
    "./class-read.mjs": { explainClass: (db, path) => { events.push(`explain:${db.build}:S${law.lawSnapshot()?.pin?.settlement}`); return { class: path }; }, nearestClasses: () => [] },
    "./admin-role.mjs": { withAdminMakers: (a) => a },
  };
  const ctx = vm.createContext({
    __load: async (spec) => modules[spec],
    worldGraphSnapshot: graph.worldGraphSnapshot, worldGraphStanding: graph.worldGraphStanding,
    graphDb: (tables) => { const build = tables.meta.find((r) => r.key === "invented_build")?.value; events.push(`store:${build}`); return { build }; },
    NO_WORLD: "no world (invented)", bounce: (code, defect, hint) => ({ error: "bounce", code, defect, hint }),
  });
  vm.runInContext(OPEN_STORE, ctx, { filename: "world-apex.mjs § openStore (lifted)" });
  const fn = vm.runInContext(`(${src})`, ctx, { filename: "world-apex.mjs § explainClassOr (lifted)" });
  const r = await fn("test-lamp", { error: "bounce", hint: "" });
  return { r, events };
}

test("13 · explain asks the law and the graph first, and answers from the graph that ask loaded", async () => {
  // the explain branch hands a class name to explainClassOr (a text check, labelled so)
  assert.match(APEX, /return answer\.error \? explainClassOr\(path, answer\) : answer;/);
  const { L, G, answer } = await standing();
  L.bless(2, 7); G.build(2); L.s.slow = true;
  const { r, events } = await explainVia(answer);
  assert.deepEqual(r, { class: "test-lamp" });
  assert.deepEqual(events, ["ask", "asked", "store:G2", "explain:G2:S2"],
    `LAW: "every world act and explain ask the store's law first" — explain answered from ${events.join(" → ")}`);
  // and when the moved law will not load, explain still answers (a read is never refused), from what stands
  L.bless(3, 9); L.s.failLaw = true; L.s.slow = false;
  const again = await explainVia(answer);
  assert.deepEqual(again.r, { class: "test-lamp" });
  assert.deepEqual(again.events, ["ask", "asked", "store:G2", "explain:G2:S2"]);
});

// ── 14–17 · contention: the load cap full (N2), a refresh in flight (N3) ─────
//
// The review of 94da8f368 probed both gaps real: at the cap an act's ask came
// back `busy` without reading the pin (N2), and an act that found a refresh in
// flight joined it and stood on whatever it loaded (N3). Each case below was
// red at 94da8f368's source.

/** Wait a turn at a time until `cond` holds (at most 50 turns). */
async function until(cond, what) {
  for (let i = 0; i < 50 && !cond(); i++) await settle();
  assert.ok(cond(), what);
}
/** The refreshers' deadline timers are unref'd by design; while a case waits on one, this holds the loop open (see case 4). */
async function held(fn) {
  const server = setInterval(() => {}, 1000);
  try { return await fn(); } finally { clearInterval(server); }
}
/** Fill the load cap with forced reloads whose loads hang, each let go at its deadline (so `inflight` is clear and the slot stays taken). */
async function fillTheCap(reload) {
  await held(async () => {
    for (let i = 0; i < 8 && loadsStanding().running < loadsStanding().max; i++) assert.equal((await reload()).abandoned, true, "a forced reload was let go at its deadline");
  });
  assert.equal(loadsStanding().running, loadsStanding().max, "the load cap is full");
}

// Until 2026-11-03 (round 2, f4431ccff), 14 and 16 had an act at the full cap
// ask the pin outside it, and admitted it when nothing had moved. Amended
// (Wright's Settled on POS-680, 01:5x EST, the round-2 review's F3): "When the
// cap is full, an act doesn't ask outside it. It gets the existing plain,
// retryable 503 ... an act is never admitted on law or graph it hasn't
// confirmed." So at the cap, moved or not, the act is refused and asks nothing.
const AT_THE_CAP = /could not confirm the law and the world graph in force: \d+ store loads are already running \(the cap\)/;

test("14 · N2, the law: with the load cap full (graph loads hung), an act does not ask outside the cap: it gets the plain 503, and is never admitted on law it has not confirmed", async () => {
  const { L, G, ask } = await standing();
  let release;
  G.s.hang = new Promise((r) => { release = r; });
  try {
    await fillTheCap(() => graph.reloadWorldGraph({ query: G.query, force: true, deadlineMs: 20 }));
    assert.equal(graph.worldGraphBehind(), null, "the hung loads leave the graph current: only the law will move");
    for (const [what, move] of [["an unchanged law", () => {}], ["a law that moved", () => L.bless(2, 7)]]) {
      move();
      const before = { pins: L.s.pinAsks, laws: L.s.lawAsks };
      const r = await ask();
      assert.equal(r?.code, 503, `${what}: LAW (amended): "When the cap is full, an act doesn't ask outside it. It gets the existing plain, retryable 503" — the act at the cap got ${JSON.stringify(r)}`);
      assert.equal(r.defect, actLaw.LAW_MOVED.defect, `${what}: the existing refusal`);
      assert.match(r.behind, AT_THE_CAP, `${what}: the refusal says why`);
      assert.equal(L.s.pinAsks, before.pins, `${what}: the act asked the law's pin outside the cap`);
      assert.equal(L.s.lawAsks, before.laws, `${what}: the act loaded the law outside the cap`);
    }
    assert.equal(law.lawSnapshot().pin.settlement, 1, "reads keep what stands");
  } finally { release(); }
  for (let i = 0; i < 5; i++) await settle();
  // once a slot is free again, the next act asks, loads S2 and goes on
  assert.equal(loadsStanding().running, 0);
  assert.equal(await ask(), null);
  assert.equal(law.lawSnapshot().pin.settlement, 2);
});

test("15 · N3, the law: an act that finds a refresh in flight from before a bless asks the pin itself, and is not admitted on the law that refresh loads", async () => {
  const { L, ask } = await standing();
  let release;
  L.s.hang = new Promise((r) => { release = r; });
  let a = null;
  try {
    L.bless(2, 7);
    const laws = L.s.lawAsks;
    a = ask(); // act A: its own refresh is told S2 and begins loading S2's rows, held
    await until(() => L.s.lawAsks === laws + 1, "act A's refresh began loading S2");
    L.bless(3, 9); // the store moves on while A's load is held
    const pins = L.s.pinAsks;
    const b = ask(); // act B arrives after S3's bless, with A's refresh in flight
    for (let i = 0; i < 5; i++) await settle();
    release();
    const rb = await b;
    assert.equal(rb?.code, 503, `LAW: "an act reuses a refresh in flight only if that refresh's pin matches what it was just told" — act B stood on S2's load: ${JSON.stringify(rb)}`);
    assert.match(rb.behind, /S3's, and this office has not loaded it yet \(it acts on S2's\)/);
    assert.equal(L.s.pinAsks, pins + 1, "act B asked the pin itself");
    assert.equal(law.lawSnapshot().pin.settlement, 2, "A's refresh put S2 in force");
  } finally { release(); }
  // A asked before S3's bless, but its load landed after B had heard S3 from the store
  const ra = await a;
  assert.equal(ra?.code, 503, `LAW (act-law.mjs § G1): "It is never judged under law the store has replaced" — act A: ${JSON.stringify(ra)}`);
  // the next act, with nothing in flight, loads S3 and goes on
  assert.equal(await ask(), null);
  assert.equal(law.lawSnapshot().pin.settlement, 3);
});

test("16 · N2, the graph: with the load cap full (law loads hung), an act does not ask the graph's pin outside the cap: it gets the plain 503, and is never admitted on a graph it has not confirmed", async () => {
  const { L, G, ask } = await standing();
  let release;
  L.s.hang = new Promise((r) => { release = r; });
  try {
    await fillTheCap(() => law.reloadLawSnapshot({ query: L.query, force: true, deadlineMs: 20 }));
    assert.equal(law.lawBehind(), null, "the hung loads leave the law current: only the graph will move");
    for (const [what, move] of [["an unchanged graph", () => {}], ["a graph that moved", () => G.build(2)]]) {
      move();
      const before = { pins: G.s.pinAsks, tables: G.s.tableAsks };
      const r = await ask();
      assert.equal(r?.code, 503, `${what}: LAW (amended): "When the cap is full, an act doesn't ask outside it" — the act at the cap got ${JSON.stringify(r)}`);
      assert.match(r.behind, AT_THE_CAP, `${what}: the refusal says why`);
      assert.equal(G.s.pinAsks, before.pins, `${what}: the act asked the graph's pin outside the cap`);
      assert.equal(G.s.tableAsks, before.tables, `${what}: the act loaded the graph outside the cap`);
    }
    assert.equal(graphBuild(), "G1", "reads keep what stands");
  } finally { release(); }
  for (let i = 0; i < 5; i++) await settle();
  assert.equal(await ask(), null);
  assert.equal(graphBuild(), "G2");
});

test("17 · N3, the graph: an act that finds a graph refresh in flight from before a build asks the graph's pin itself, and is not admitted on what that refresh loads", async () => {
  const { G, ask } = await standing();
  let release;
  G.s.hang = new Promise((r) => { release = r; });
  let a = null;
  try {
    G.build(2);
    const tables = G.s.tableAsks;
    a = ask(); // act A: its own graph refresh is told G2 and begins loading G2's tables, held
    await until(() => G.s.tableAsks === tables + 1, "act A's refresh began loading G2");
    G.build(3);
    const pins = G.s.pinAsks;
    const b = ask(); // act B arrives after G3 was built, with A's refresh in flight
    for (let i = 0; i < 5; i++) await settle();
    release();
    const rb = await b;
    assert.equal(rb?.code, 503, `LAW: "an act reuses a refresh in flight only if that refresh's pin matches what it was just told" — act B stood on G2's load: ${JSON.stringify(rb)}`);
    assert.match(rb.behind, /world graph/);
    assert.equal(G.s.pinAsks, pins + 1, "act B asked the graph's pin itself");
    assert.equal(graphBuild(), "G2", "A's refresh put G2 in force");
  } finally { release(); }
  // A was told G2 before G3 was built, and its own refresh put G2 in force: the reuse rule admits it on the
  // graph it was told. Unlike the law's (case 15), the graph's known key carries no settlement, so B's G3 does
  // not overwrite a known G2 that is already ahead of what was in force (N6: never backwards).
  const ra = await a;
  assert.equal(ra, null, `act A, told G2, should stand on G2: ${JSON.stringify(ra)}`);
  assert.equal(await ask(), null);
  assert.equal(graphBuild(), "G3");
});

// ── 18–26 · one pin question at a time (round 3: the review's F3, N6, N7) ───
//
// LAW (Wright's Settled on POS-680, 2026-11-03, "C plus coalescing", decided on
// Darko's behalf): "One shared pin session, single-flight. At most one pin
// session is in flight at a time, across law and graph together. It holds one
// slot of the existing cap of 2 ... Every act arriving while that session is
// in flight awaits the same answer, within its own deadline. It never opens
// its own ... No slot means the plain 503 ... The reuse rule stands."
// N6 (the same Settled): "what the process knows about the pin only moves
// forward (by settlement), so a late answer can't move it back."

/** A hold a case opens (the held answer comes) or shuts (it fails, as a statement the store cancels does). */
function holdable() {
  let open, shut;
  const p = new Promise((resolve, reject) => { open = resolve; shut = reject; });
  p.catch(() => {});
  return { p, open: () => open(), shut: () => shut(new Error("canceling statement due to statement timeout (invented)")) };
}
const NOT_IN_TIME = /could not confirm the law and the world graph in force: the store did not answer in time/;

test("18 · a healthy store: twelve acts at once are all admitted on one shared pin question, two at once both, and one during a tick too", async () => {
  const { L, G, ask } = await standing();
  const before = { law: L.s.pinAsks, graph: G.s.pinAsks };
  const twelve = await Promise.all(Array.from({ length: 12 }, ask));
  assert.deepEqual(twelve, Array(12).fill(null), `LAW: "Twelve concurrent acts are one pin question" — and every one goes on; one got ${JSON.stringify(twelve.find(Boolean))}`);
  assert.equal(L.s.pinAsks, before.law + 1, "twelve acts asked the law's pin once");
  assert.equal(G.s.pinAsks, before.graph + 1, "twelve acts asked the graph's pin once");
  for (let i = 0; i < 5; i++) await settle();
  assert.deepEqual(await Promise.all([ask(), ask()]), [null, null], "two acts at once");
  for (let i = 0; i < 5; i++) await settle();
  const tick = law.reloadLawSnapshot({ query: L.query }); // the 60 s tick, in flight as the act arrives
  assert.equal(await ask(), null, "an act during a tick goes on");
  await tick;
});

test("19 · both ticks in flight hold the cap: an act gets the plain 503, never admitted on the law or graph they are replacing", async () => {
  const { L, G, ask } = await standing();
  let openL, openG;
  L.s.hang = new Promise((r) => { openL = r; });
  G.s.hang = new Promise((r) => { openG = r; });
  L.bless(2, 7); G.build(2);
  const ticks = [law.reloadLawSnapshot({ query: L.query }), graph.reloadWorldGraph({ query: G.query })]; // both loading, held
  try {
    assert.equal(loadsStanding().running, loadsStanding().max, "the two ticks hold the cap");
    const r = await ask();
    assert.equal(r?.code, 503, `LAW: "No slot means the plain 503" — the act during both ticks got ${JSON.stringify(r)}`);
    assert.match(r.behind, AT_THE_CAP);
    assert.equal(law.lawSnapshot().pin.settlement, 1);
    assert.equal(graphBuild(), "G1");
  } finally { openL(); openG(); }
  await Promise.all(ticks);
  assert.equal(await ask(), null, "once the ticks land, the next act goes on");
  assert.equal(law.lawSnapshot().pin.settlement, 2);
  assert.equal(graphBuild(), "G2");
});

test("20 · a hung pin: twelve acts share the one question (one slot, one ask) and are each refused at their deadline, never admitted on law they have not confirmed", async () => {
  const { L, G, ask } = await standing();
  const hold = holdable();
  L.s.pinHold = hold.p;
  L.bless(2, 7); // the store moved: an act admitted now would stand on S1
  const before = { law: L.s.pinAsks, graph: G.s.pinAsks };
  try {
    const rs = await held(() => Promise.all(Array.from({ length: 12 }, ask)));
    for (const r of rs) {
      assert.equal(r?.code, 503, `LAW (amended): "an act is never admitted on law or graph it hasn't confirmed" — got ${JSON.stringify(r)}`);
      assert.match(r.behind, NOT_IN_TIME);
    }
    assert.equal(L.s.pinAsks, before.law + 1, `LAW: "It never opens its own" — twelve acts asked the law's pin ${L.s.pinAsks - before.law} times`);
    assert.equal(G.s.pinAsks, before.graph, "the graph's pin waits behind the law's, in the one session");
    assert.equal(loadsStanding().running, 1, "the one session holds one slot until its question ends");
    // an act after the session gave up, while its question is still held, is refused at once and opens nothing
    const late = await ask();
    assert.equal(late?.code, 503);
    assert.equal(L.s.pinAsks, before.law + 1, "a later act opened a second session");
  } finally { hold.open(); }
  for (let i = 0; i < 5; i++) await settle();
  assert.equal(loadsStanding().running, 0, "the slot comes back when the question ends");
  assert.equal(await ask(), null, "the next act asks again, loads S2 and goes on");
  assert.equal(law.lawSnapshot().pin.settlement, 2);
});

test("21 · an act waiting on the shared question answers at its own deadline, not the session's", async () => {
  const { L, G } = await standing();
  const opener = asker(L, G, 400), waiter = asker(L, G, 20);
  const hold = holdable();
  L.s.pinHold = hold.p;
  try {
    await held(async () => {
      let marked = false;
      const marker = setTimeout(() => { marked = true; }, 200);
      const a = opener.ask(); // opens the session; it and the session give up at 400 ms
      const b = waiter.ask(); // joins it; its own deadline is 20 ms
      const rb = await b;
      assert.equal(marked, false, `LAW: "awaits the same answer, within its own deadline" — the waiter with a 20 ms deadline answered after 200 ms`);
      assert.equal(rb?.code, 503);
      assert.match(rb.behind, NOT_IN_TIME);
      assert.equal((await a)?.code, 503);
      clearTimeout(marker);
    });
  } finally { hold.open(); }
  for (let i = 0; i < 5; i++) await settle();
});

test("22 · a hung session gives up at its deadline: a statement the store ends later, in an error, is never read as \"the store could not be asked\"", async () => {
  const { L, G } = await standing();
  const opener = asker(L, G, 30), waiter = asker(L, G, 2000);
  const hold = holdable();
  L.s.pinHold = hold.p;
  L.bless(2, 7); // the store moved: an act admitted now would stand on S1
  try {
    await held(async () => {
      const a = opener.ask(); // opens the session, whose deadline (30 ms) is its opener's
      await settle();
      const c = waiter.ask(); // joins it; its own deadline is long
      assert.equal((await a)?.code, 503, "the opener gave up at its deadline");
      hold.shut(); // the store ends the held statement with an error, as statement_timeout does
      const rc = await c;
      assert.equal(rc?.code, 503, `LAW (amended): "an act is never admitted on law ... it hasn't confirmed" — the waiter read the cancelled statement as "the store could not be asked" and got ${JSON.stringify(rc)}`);
      assert.match(rc.behind, NOT_IN_TIME);
    });
  } finally { hold.shut(); } // a held session never outlives its case
  for (let i = 0; i < 5; i++) await settle();
  assert.equal(loadsStanding().running, 0);
});

test("23 · N6, the law: a late, older pin answer never moves what the process knows back", async () => {
  // fail-open (the round-2 review's R5): X's answer reads S1 and is held; a tick hears S2 but cannot load it
  {
    const { L, ask } = await standing();
    const hold = holdable();
    L.s.pinHold = hold.p;
    try {
      const x = ask(); // X's shared question reads S1, held
      for (let i = 0; i < 3; i++) await settle();
      L.bless(2, 7); L.s.failLaw = true;
      await law.reloadLawSnapshot({ query: L.query }); // the tick hears S2 and cannot load it
      assert.match(law.lawBehind() ?? "", /S2's/);
      hold.open(); // X's late answer, S1, lands
      const rx = await x;
      assert.equal(rx?.code, 503, `LAW (N6): "a late answer can't move it back" — X, told S1 late, was admitted on S1: ${JSON.stringify(rx)}`);
      assert.match(law.lawRefreshStanding().behind ?? "", /S2's/, "and /release still says the law is behind");
      L.s.failPin = true; // the store cannot be asked now: G1 stands on what the process knows
      assert.equal((await ask())?.code, 503, "a later act, whose store could not be asked, was admitted on S1");
    } finally { hold.open(); }
    for (let i = 0; i < 5; i++) await settle();
    law.resetLawSnapshot(); graph.resetWorldGraph();
  }
  // fail-closed (R6): X's S1 lands after the tick has loaded S2: X stands on S2, with no false "behind"
  {
    const { L, ask } = await standing();
    const hold = holdable();
    L.s.pinHold = hold.p;
    try {
      const x = ask();
      for (let i = 0; i < 3; i++) await settle();
      L.bless(2, 7);
      await law.reloadLawSnapshot({ query: L.query }); // the tick loads S2
      hold.open();
      assert.equal(await x, null, "X, told S1 late, was refused though S2, newer, is in force");
      assert.equal(law.lawSnapshot().pin.settlement, 2);
      assert.equal(law.lawRefreshStanding().behind, undefined, "/release says behind after a late, older answer");
    } finally { hold.open(); }
  }
});

test("24 · N6, the graph: a late, older pin answer never moves what the process knows back", async () => {
  {
    const { G, ask } = await standing();
    const hold = holdable();
    G.s.pinHold = hold.p;
    try {
      const x = ask(); // X's shared question: the law's pin, then the graph's, which reads G1 and is held
      for (let i = 0; i < 5; i++) await settle();
      G.build(2); G.s.failTables = true;
      await graph.reloadWorldGraph({ query: G.query }); // the tick hears G2 and cannot load it
      assert.match(graph.worldGraphBehind() ?? "", /world graph/);
      hold.open();
      const rx = await x;
      assert.equal(rx?.code, 503, `LAW (N6): "a late answer can't move it back" — X, told G1 late, was admitted on G1: ${JSON.stringify(rx)}`);
      assert.match(graph.worldGraphRefreshStanding().behind ?? "", /world graph/, "and /release still says the graph is behind");
    } finally { hold.open(); }
    for (let i = 0; i < 5; i++) await settle();
    law.resetLawSnapshot(); graph.resetWorldGraph();
  }
  {
    const { G, ask } = await standing();
    const hold = holdable();
    G.s.pinHold = hold.p;
    try {
      const x = ask();
      for (let i = 0; i < 5; i++) await settle();
      G.build(2);
      await graph.reloadWorldGraph({ query: G.query }); // the tick loads G2
      hold.open();
      assert.equal(await x, null, "X, told G1 late, was refused though G2, newer, is in force");
      assert.equal(graphBuild(), "G2");
      assert.equal(graph.worldGraphRefreshStanding().behind, undefined, "/release says behind after a late, older answer");
    } finally { hold.open(); }
  }
});

test("25 · N7, the law: an act told S2 waits for a refresh in flight that is loading S2, and stands on it", async () => {
  const { L, ask } = await standing();
  let release;
  L.s.hang = new Promise((r) => { release = r; });
  L.bless(2, 7);
  const laws = L.s.lawAsks;
  const tick = law.reloadLawSnapshot({ query: L.query }); // told S2; loading S2's rows, held
  try {
    await until(() => L.s.lawAsks === laws + 1, "the tick began loading S2");
    const a = ask(); // the shared question tells it S2, the law the tick is loading
    for (let i = 0; i < 5; i++) await settle();
    release();
    assert.equal(await a, null, `LAW: "An act reuses a refresh in flight only if what that refresh put in force matches the shared answer's pin" — it matched, and the act was refused`);
    assert.equal(L.s.lawAsks, laws + 1, "the act loaded nothing itself: it stood on the tick's load");
    assert.equal(law.lawSnapshot().pin.settlement, 2);
  } finally { release(); }
  await tick;
});

test("26 · N7, the graph: an act told G2 waits for a refresh in flight that is loading G2, and stands on it", async () => {
  const { G, ask } = await standing();
  let release;
  G.s.hang = new Promise((r) => { release = r; });
  G.build(2);
  const tables = G.s.tableAsks;
  const tick = graph.reloadWorldGraph({ query: G.query }); // told G2; loading G2's tables, held
  try {
    await until(() => G.s.tableAsks === tables + 1, "the tick began loading G2");
    const a = ask();
    for (let i = 0; i < 5; i++) await settle();
    release();
    assert.equal(await a, null, `LAW: "An act reuses a refresh in flight only if what that refresh put in force matches the shared answer's pin" — it matched, and the act was refused`);
    assert.equal(graphBuild(), "G2");
  } finally { release(); }
  await tick;
  assert.equal(G.s.tableAsks, tables + 6, "the act loaded nothing itself: only the tick's six table reads");
});

test("27 · N8, the law: the refresher's own late, older pin answer never moves what the process knows back", async () => {
  // POS-908, from the round-three review of #762 (N8): a tick's pin statement reads S1 and its answer is held; the store blesses S2, which
  // cannot be loaded; an act hears S2, finds the tick in flight, waits for it and is refused; then the tick's S1 answer lands. Case 23 is
  // the act's side of this (an act's late answer); this is the tick's own write of what the process knows (law-snapshot.mjs § seenPinned).
  {
    const { L, ask } = await standing();
    const hold = holdable();
    const keep = setInterval(() => {}, 25); // the deadlines below are unref'd timers: hold the loop open while the case waits on one
    L.s.pinHold = hold.p;
    try {
      const tick = law.reloadLawSnapshot({ query: L.query, deadlineMs: 100 }); // its pin question reads S1, held; it is let go at 100 ms
      for (let i = 0; i < 3; i++) await settle();
      L.bless(2, 7); L.s.failLaw = true; // the store blesses S2, which cannot be loaded
      const refused = await ask(); // the act hears S2, finds the tick in flight, waits for it, and is refused
      assert.equal(refused?.code, 503, `the act, told S2 which will not load, was admitted: ${JSON.stringify(refused)}`);
      assert.match(law.lawBehind() ?? "", /S2's/, "the act's own hearing of S2 is recorded");
      hold.open(); // the tick's late answer, S1, lands
      await tick;
      for (let i = 0; i < 10; i++) await settle();
      assert.match(law.lawBehind() ?? "", /S2's/, `LAW (N8): "what the process knows moves only forward, by settlement" — the tick's late S1 answer moved it back: lawBehind() is now ${JSON.stringify(law.lawBehind())}`);
      assert.match(law.lawRefreshStanding().behind ?? "", /S2's/, "and /release no longer says the law is behind");
      L.s.failPin = true; // the store cannot be asked now: G1 stands on what the process knows
      assert.equal((await ask())?.code, 503, "LAW (N8): a later act, whose store could not be asked, was admitted on S1 after the store had blessed S2");
    } finally { hold.open(); clearInterval(keep); }
  }
  law.resetLawSnapshot(); graph.resetWorldGraph();
  // the matched control: the same tick, held and landing late, with nothing blessed in between — nothing is behind, and G1 admits
  {
    const { L, ask } = await standing();
    const hold = holdable();
    const keep = setInterval(() => {}, 25);
    L.s.pinHold = hold.p;
    try {
      const tick = law.reloadLawSnapshot({ query: L.query, deadlineMs: 100 });
      for (let i = 0; i < 3; i++) await settle();
      assert.equal(await ask(), null, "control: with nothing blessed, an act goes on while the tick is held");
      hold.open();
      await tick;
      for (let i = 0; i < 10; i++) await settle();
      assert.equal(law.lawBehind(), null, "control: the tick's S1 answer, with S1 in force, says nothing is behind");
      L.s.failPin = true;
      assert.equal(await ask(), null, "control: a store that cannot be asked still refuses nothing when no law is known to have moved (G1, kept)");
    } finally { hold.open(); clearInterval(keep); }
  }
});

// ── 28–30 · POS-908, the graph's side of N8 ─────────────────────────────────
// LAW (Wright, Settled on POS-680/POS-908, 2026-11-05 11:4x EST, option A): "Add a private settlement value beside `seenKey`, advanced
// coherently with the key, and guard both writes the round-3 review names with it. The graph then refuses a late tick that a later pin
// round trip has overtaken, just as the law's guard does." And its limits: "Private only: no change to the key's spelling, `/release`, or
// any public field." So these cases read only what the graph already shows: worldGraphBehind(), the /release standing's `behind`, and
// whether an act is admitted. The law's side is case 27.

test("28 · N8, the graph: the tick's own late, older pin answer never moves what the process knows back (an act heard the newer pin)", async () => {
  // a tick's pin statement reads G1 and its answer is held; the store builds G2, which cannot be loaded; an act hears G2, finds the tick in
  // flight, waits for it and is refused; then the tick's G1 answer lands. Case 24 is the act's side of this; this is the tick's own write.
  {
    const { G, ask } = await standing();
    const hold = holdable();
    const keep = setInterval(() => {}, 25); // the deadlines below are unref'd timers: hold the loop open while the case waits on one
    G.s.pinHold = hold.p;
    try {
      const tick = graph.reloadWorldGraph({ query: G.query, deadlineMs: 100 }); // its pin question reads G1, held; it is let go at 100 ms
      for (let i = 0; i < 3; i++) await settle();
      G.build(2); G.s.failTables = true; // the store builds G2, which cannot be loaded
      const refused = await ask(); // the act hears G2, finds the tick in flight, waits for it, and is refused
      assert.equal(refused?.code, 503, `the act, told G2 which will not load, was admitted: ${JSON.stringify(refused)}`);
      assert.match(graph.worldGraphBehind() ?? "", /world graph/, "the act's own hearing of G2 is recorded");
      hold.open(); // the tick's late answer, G1, lands
      await tick;
      for (let i = 0; i < 10; i++) await settle();
      assert.match(graph.worldGraphBehind() ?? "", /world graph/, `LAW (N8): "The graph then refuses a late tick that a later pin round trip has overtaken" — the tick's late G1 answer moved it back: worldGraphBehind() is now ${JSON.stringify(graph.worldGraphBehind())}`);
      assert.match(graph.worldGraphRefreshStanding().behind ?? "", /world graph/, "and /release no longer says the graph is behind");
      G.s.failPin = true; // the store cannot be asked now: G1 stands on what the process knows
      assert.equal((await ask())?.code, 503, "LAW (N8): a later act, whose store could not be asked, was admitted on G1 after the store had built G2");
    } finally { hold.open(); clearInterval(keep); }
  }
  law.resetLawSnapshot(); graph.resetWorldGraph();
  // the matched control: the same tick, held and landing late, with nothing built in between — nothing is behind, and G1 admits
  {
    const { G, ask } = await standing();
    const hold = holdable();
    const keep = setInterval(() => {}, 25);
    G.s.pinHold = hold.p;
    try {
      const tick = graph.reloadWorldGraph({ query: G.query, deadlineMs: 100 });
      for (let i = 0; i < 3; i++) await settle();
      assert.equal(await ask(), null, "control: with nothing built, an act goes on while the tick is held");
      hold.open();
      await tick;
      for (let i = 0; i < 10; i++) await settle();
      assert.equal(graph.worldGraphBehind(), null, "control: the tick's G1 answer, with G1 in force, says nothing is behind");
      G.s.failPin = true;
      assert.equal(await ask(), null, "control: a store that cannot be asked still refuses nothing when no graph is known to have moved (G1, kept)");
    } finally { hold.open(); clearInterval(keep); }
  }
});

test("29 · N8, the graph: an older tick, let go and landing after a newer tick heard G2, never moves what the process knows back (the tick's own write, both halves)", async () => {
  // no act hears G2 here: the NEWER TICK's own write has to put the settlement beside the key, or the older tick's G1 passes the guard
  const { G, ask } = await standing();
  const hold = holdable();
  const keep = setInterval(() => {}, 25);
  G.s.pinHold = hold.p;
  try {
    const older = graph.reloadWorldGraph({ query: G.query, deadlineMs: 100 }); // reads G1, held; let go at 100 ms
    for (let i = 0; i < 3; i++) await settle();
    G.build(2); G.s.failTables = true;
    await older; // let go: its slot stays taken until its answer lands
    await graph.reloadWorldGraph({ query: G.query }); // the next tick hears G2 and cannot load it
    assert.match(graph.worldGraphBehind() ?? "", /world graph/, "the newer tick's hearing of G2 is recorded");
    hold.open(); // the older tick's late answer, G1, lands
    for (let i = 0; i < 10; i++) await settle();
    assert.match(graph.worldGraphBehind() ?? "", /world graph/, `LAW (N8): the older tick's late G1 answer moved what the process knows back: worldGraphBehind() is now ${JSON.stringify(graph.worldGraphBehind())}`);
    assert.match(graph.worldGraphRefreshStanding().behind ?? "", /world graph/, "and /release no longer says the graph is behind");
    G.s.failPin = true;
    assert.equal((await ask())?.code, 503, "LAW (N8): an act, whose store could not be asked, was admitted on G1 after a tick had heard G2");
  } finally { hold.open(); clearInterval(keep); }
});

test("30 · N8, the graph: a pin answer that names no settlement never clears what the process knows", async () => {
  // "stale/null receipt cannot erase later knowledge": an act heard G2 (which will not load); a tick then reads a pin row for the graph in
  // force whose settlement is null. The key alone would say "nothing is behind"; the settlement beside it keeps it.
  const { G, ask } = await standing();
  G.build(2); G.s.failTables = true;
  assert.equal((await ask())?.code, 503, "the act, told G2 which will not load, is refused");
  assert.match(graph.worldGraphBehind() ?? "", /world graph/);
  G.s.pin = { tag_sha: SHA(1, "c"), office_sha: SHA(1, "d"), settlement: null, built_at: "2026-11-01T00:00:00Z" }; // G1's own key, naming no settlement
  await graph.reloadWorldGraph({ query: G.query });
  assert.match(graph.worldGraphBehind() ?? "", /world graph/, `LAW (N8): a pin answer naming no settlement cleared what the process knows: worldGraphBehind() is now ${JSON.stringify(graph.worldGraphBehind())}`);
  assert.match(graph.worldGraphRefreshStanding().behind ?? "", /world graph/);
});
