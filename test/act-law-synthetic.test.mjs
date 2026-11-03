// act-law-synthetic.test.mjs — POS-680 part 2, proven on invented inputs only.
//
// LAW (Wright, Settled on POS-680, 2026-11-03 03:17Z): "every world act and
// `explain` ask the store's law first, and an act whose law moved but can't load
// is refused with a plain 503." And act-law.mjs § G1: "the act is refused with a
// plain 503 and nothing is done. It is never judged under law the store has
// replaced."
//
// LAW, CONTENTION (Wright, Settled on POS-680, 2026-11-03 01:0x EST, adopting
// Rivet's recommendation): "No stale admission ... every act asks the cheap pin
// question, even when the load cap is full; an act reuses a refresh in flight
// only if that refresh's pin matches what it was just told; otherwise, the
// existing plain 503 for law that moved but hasn't loaded." Cases 14 to 17 (the
// review's N2 and N3, for the law and for the graph).
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
  const s = { newest: null, pinned: null, rows: new Map(), pinAsks: 0, lawAsks: 0, failLaw: false, failPin: false, hang: null, slow: false };
  const query = async (sql) => {
    if (sql === law.LAW_REFRESH_SQLS.pin) {
      s.pinAsks += 1;
      if (s.failPin) throw new Error("connect ECONNREFUSED (invented)");
      return { rows: [{ newest: s.newest, pinned: s.pinned }] };
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
  const s = { pin: null, builds: new Map(), pinAsks: 0, tableAsks: 0, failTables: false, failPin: false, hang: null };
  const query = async (sql, params) => {
    if (sql === graph.PIN_SQL) {
      s.pinAsks += 1;
      if (s.failPin) throw new Error("connect ECONNREFUSED (invented)");
      return { rows: s.pin ? [s.pin] : [] };
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

/** What every door's lawForAnAct() does, on the invented stores: the real lawForAnAct, freshLaw and freshGraph. */
function asker(L, G, deadlineMs = 200) {
  const asked = { n: 0 };
  const ask = () => { asked.n += 1; return actLaw.lawForAnAct({ law: () => law.freshLaw({ query: L.query, deadlineMs }), graph: () => graph.freshGraph({ query: G.query, deadlineMs }) }); };
  const answer = () => actLaw.lawForAnAnswer({ law: () => law.freshLaw({ query: L.query, deadlineMs }), graph: () => graph.freshGraph({ query: G.query, deadlineMs }) });
  return { ask, answer, asked };
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

test("14 · N2, the law: with the load cap full (graph loads hung), an act still asks the law's pin, and when the law moved it is refused, never admitted on S1", async () => {
  const { L, G, ask } = await standing();
  let release;
  G.s.hang = new Promise((r) => { release = r; });
  try {
    await fillTheCap(() => graph.reloadWorldGraph({ query: G.query, force: true, deadlineMs: 20 }));
    assert.equal(graph.worldGraphBehind(), null, "the hung loads leave the graph current: only the law will move");
    // the controls: an unchanged law at the cap, and the act goes on (the cap alone refuses nothing);
    // and a store that cannot be asked at all still refuses nothing at the cap (case 6's ruled fallback, kept)
    assert.equal(await ask(), null, "an act at the cap, on an unchanged law, was refused");
    L.s.failPin = true;
    assert.equal(await ask(), null, "at the cap, a store that could not be asked refused the act (G1 says it refuses nothing)");
    L.s.failPin = false;
    L.bless(2, 7);
    const before = { pins: L.s.pinAsks, laws: L.s.lawAsks };
    const r = await ask();
    assert.equal(r?.code, 503, `LAW: "every act asks the cheap pin question, even when the load cap is full ... otherwise, the existing plain 503 for law that moved but hasn't loaded" — the act at the cap was admitted on S1: ${JSON.stringify(r)}`);
    assert.match(r.behind, /S2's, and this office has not loaded it yet \(it acts on S1's\)/);
    assert.equal(L.s.pinAsks, before.pins + 1, "the act asked the law's pin itself");
    assert.equal(L.s.lawAsks, before.laws, "at the cap the act loads nothing: it asks the pin only");
    assert.equal(law.lawSnapshot().pin.settlement, 1, "reads keep what stands");
    assert.match(law.lawRefreshStanding().behind ?? "", /S2's/, "and /release says the law is behind");
  } finally { release(); }
  for (let i = 0; i < 5; i++) await settle();
  // once a load can run again, the next act loads S2 and goes on
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

test("16 · N2, the graph: with the load cap full (law loads hung), an act still asks the graph's pin, and when the graph moved it is refused", async () => {
  const { L, G, ask } = await standing();
  let release;
  L.s.hang = new Promise((r) => { release = r; });
  try {
    await fillTheCap(() => law.reloadLawSnapshot({ query: L.query, force: true, deadlineMs: 20 }));
    assert.equal(law.lawBehind(), null, "the hung loads leave the law current: only the graph will move");
    assert.equal(await ask(), null, "an act at the cap, on an unchanged graph, was refused");
    G.s.failPin = true;
    assert.equal(await ask(), null, "at the cap, a graph store that could not be asked refused the act (G1 says it refuses nothing)");
    G.s.failPin = false;
    G.build(2);
    const before = { pins: G.s.pinAsks, tables: G.s.tableAsks };
    const r = await ask();
    assert.equal(r?.code, 503, `LAW: "every act asks the cheap pin question, even when the load cap is full" — the act at the cap was admitted on G1: ${JSON.stringify(r)}`);
    assert.match(r.behind, /world graph/);
    assert.equal(G.s.pinAsks, before.pins + 1, "the act asked the graph's pin itself");
    assert.equal(G.s.tableAsks, before.tables, "at the cap the act loads nothing");
    assert.equal(graphBuild(), "G1", "reads keep what stands");
    assert.match(graph.worldGraphRefreshStanding().behind ?? "", /world graph/, "and /release says the graph is behind");
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
  const ra = await a;
  assert.equal(ra?.code, 503, `LAW (act-law.mjs § G1): "It is never judged under law the store has replaced" — act A: ${JSON.stringify(ra)}`);
  assert.equal(await ask(), null);
  assert.equal(graphBuild(), "G3");
});
