// act-law.test.mjs — an act stands on the law the store has NOW (POS-680, part 2 of 2).
//
// Part 1 made a hung refresh let go and the next tick load the new law. A tick
// is still up to a minute: an act in that minute was judged under the law
// before. Now every world act asks both pins first and loads what moved
// (act-law.mjs § lawForAnAct), `explain:` asks the same before it answers,
// and when the store's law moved and this process cannot load it, the act is
// refused (503) and nothing is done (G1, agreed 2026-10-23).
//
// Against the suite's store (a real Postgres), the timer never running (no
// tick can save a case), and the kind door (`callKinds`) reading the class
// layer as the office does, `classViewOf(lawSnapshot())`.
//
// THE FLIPS (each reds the named cases): an act reads the snapshot as the
// timer left it, with no ask (1, 2); the refusal dropped, the act judged under
// the old law (3, 4, 5); the MCP gate removed (6); explain answers without
// asking (7); a REST /world route without the gate (8); no cap on loads still
// running (9).

process.env.LAW_REFRESH_DEADLINE_MS = "150";
process.env.WORLD_GRAPH_REFRESH_DEADLINE_MS = "150";

import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Readable } from "node:stream";

const { startStore, NO_STORE } = await import("./helpers/embedded-store.mjs");
const { writeLaw } = await import("../world2/tools/law-ingest.mjs");
const law = await import("../src/law-snapshot.mjs");
const graph = await import("../src/world-graph-snapshot.mjs");
const actLaw = await import("../src/act-law.mjs");
const { callKinds } = await import("../src/world-kinds.mjs");
const { classViewOf } = await import("../src/world-units.mjs");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── the law, as law-ingest writes it ─────────────────────────────────────────
const cls = (key, data = {}) => ({ kind: "class", path: `WORLD/marks/the-town/${key}/mark.md`, key, data: { class: key, ...data } });
const prop = (klass, name, dflt, tier, parent = null) => ({ kind: "property", path: `WORLD/marks/the-town/${klass}/${name}.md`,
  key: parent ? `${klass}/${parent}/${name}` : `${klass}/${name}`, data: { class: klass, parent, name, tier, default: dflt, id: `the-town/${klass}-${name}` } });
const lawRows = ({ holders = null } = {}) => [
  cls("postmark-node"), cls("mark", { extends: "postmark-node" }), cls("sited", { extends: "mark" }),
  cls("thing", { extends: "sited" }), cls("satchel", { extends: "thing" }), cls("bowl", { extends: "thing" }),
  cls("entity", { extends: "postmark-node" }), cls("resident", { extends: "entity" }),
  prop("postmark-node", "makers", false, "constitution"), prop("thing", "makers", true, "constitution"),
  prop("resident", "holder", true, "constitution"), prop("resident", "capacity", 24, "constitution", "holder"),
  ...(holders == null ? [] : [prop("resident", "holders", holders, "constitution", "holder")]),
  prop("thing", "holder", false, "sovereign"), prop("thing", "capacity", 30, "sovereign", "holder"),
  prop("thing", "min", 1, "constitution", "capacity"), prop("thing", "max", 120, "constitution", "capacity"),
  prop("thing", "open", true, "sovereign", "holder"), prop("thing", "portable", true, "sovereign"),
  prop("satchel", "holder", true, "constitution"), prop("bowl", "holder", true, "constitution"),
];
const shaOf = (n) => String(n).padStart(40, "b");

let stores = 0;
async function storeFor(t) {
  let s;
  try { s = await startStore({ db: `act_law_${++stores}` }); } catch { t.skip(NO_STORE); return null; }
  const [api, pen, owner] = [await s.connect("office_api"), await s.connect("law_ingester"), await s.connect("world2_owner")];
  t.after(async () => { for (const c of [api, pen, owner]) await c.end().catch(() => {}); await s.stop(); });
  return { query: (sql, params) => api.query(sql, params), pen, owner };
}
async function bless(db, n, rows) {
  await writeLaw(db.pen, { lawSha: shaOf(n), rows, identities: [], blessed: true });
  await db.owner.query("INSERT INTO settlements (number, tag_sha, published_at) VALUES ($1, $2, now())", [n, shaOf(n)]);
}

// the graph's half of an act's ask, held still: these cases are about the law
const graphStill = async () => ({ snap: null, behind: null });
/** The act's ask, against this store: what the door gate calls. */
const ask = (query) => actLaw.lawForAnAct({ law: () => law.freshLaw({ query }), graph: graphStill });

// ── the kind door, every collaborator injected ──────────────────────────────
const ME = "sbx-cy", BOWL = "sbx-ana/the-bowl";
const bag = (name) => `sbx-cy/${name}`;
const markOf = (id) => (id === BOWL ? { id, by: "sbx-ana", kind: "bowl", at: { x: 5, y: 6 } }
  : String(id).startsWith("sbx-cy/") ? { id, by: ME, kind: "satchel", at: { x: 5, y: 6 } } : null);
const row = (entity, target) => ({ entity, target, policy: "cascade", born_at: "2026-10-17T00:00:00Z" });
function world(things = []) {
  const acts = [];
  const deps = {
    classes: () => classViewOf(law.lawSnapshot()),
    readRows: async () => ({ units: acts.filter((a) => String(a.action).startsWith("units:")), attachments: things }),
    markById: async (id) => markOf(String(id)),
    reachTake: async () => ({ reach: { stands: true } }),
    reachGive: async () => ({ stands: true }),
    standpoint: async () => ({ x: 5, y: 6 }),
    householdOf: (h) => ({ key: `hh:${h}`, house: `hh:${h}` }),
    append: async (entry, { also = [] } = {}) => { for (const e of [entry, ...also]) acts.push({ id: acts.length + 100, class: e.cls, action: e.action, payload: e.payload }); return { actId: acts.length + 99 }; },
    stamp: async (actor) => ({ at: `2026-10-21T06:00:00Z@${actor}#${acts.length}`, witnesses: [] }),
    crossing: () => 265,
    household: () => "hh:test",
  };
  return { deps, acts };
}
/** An act as the doors run it now: the gate's ask first, then the door. */
async function act(query, w, route, args) {
  const moved = await ask(query);
  if (moved) return { refused: moved };
  return callKinds(route, args, { handles: new Set([ME]) }, ME, w.deps).then((r) => ({ r }), (e) => ({ e }));
}
const SECOND_HOLDER = { thing: bag("other"), from: BOWL };

beforeEach(() => { law.resetLawSnapshot(); graph.resetWorldGraph(); actLaw.__setLawForAnActForTest(null); });
after(() => { law.resetLawSnapshot(); graph.resetWorldGraph(); actLaw.__setLawForAnActForTest(null); });

// ── 1–2 · the act asks, and stands on what it found ─────────────────────────

test("1 · with no tick at all, the very next act after a bless stands on the new law: the holders dial unset, a second holder lands", async (t) => {
  const db = await storeFor(t);
  if (!db) return;
  await bless(db, 1, lawRows({ holders: 1 }));
  const w = world([row(ME, bag("mine")), row(BOWL, bag("other"))]);
  const first = await act(db.query, w, "thing-from-holder", SECOND_HOLDER);
  assert.equal(first.e?.defect, "you're already carrying a holder (sbx-cy/mine)", "S1's dial binds");
  await bless(db, 2, lawRows({ holders: null }));
  const next = await act(db.query, w, "thing-from-holder", SECOND_HOLDER);
  assert.equal(next.r?.did, "take", `the act after S2's bless was judged under S1's law: ${next.e?.defect ?? JSON.stringify(next)}`);
  assert.equal(law.lawSnapshot().pin.settlement, 2);
});

test("2 · and back: a bless that sets the dial binds the very next act", async (t) => {
  const db = await storeFor(t);
  if (!db) return;
  await bless(db, 1, lawRows({ holders: null }));
  await law.reloadLawSnapshot({ query: db.query });
  await bless(db, 2, lawRows({ holders: 1 }));
  const w = world([row(ME, bag("mine")), row(BOWL, bag("other"))]);
  const r = await act(db.query, w, "thing-from-holder", SECOND_HOLDER);
  assert.equal(r.e?.code, 409, `S2 set the dial, and the act did not obey it: ${JSON.stringify(r.r ?? r.refused)}`);
  assert.equal(w.acts.length, 0);
});

// ── 3–5 · G1: the law moved and will not load ───────────────────────────────

test("3 · the store's law moved and its rows will not load: the act is refused (503), nothing is done, and the refusal says which law", async (t) => {
  const db = await storeFor(t);
  if (!db) return;
  await bless(db, 1, lawRows({ holders: null }));
  await law.reloadLawSnapshot({ query: db.query });
  await bless(db, 2, lawRows({ holders: 1 }));
  const broken = async (sql, p) => { if (sql === law.LAW_REFRESH_SQLS.law) throw new Error("the connection was reset"); return db.query(sql, p); };
  const w = world([row(ME, bag("mine")), row(BOWL, bag("other"))]);
  const r = await act(broken, w, "thing-from-holder", SECOND_HOLDER);
  assert.equal(r.refused?.code, 503, `an act under replaced law: ${JSON.stringify(r)}`);
  assert.equal(r.refused.defect, actLaw.LAW_MOVED.defect);
  assert.match(r.refused.behind, /S2's, and this office has not loaded it yet \(it acts on S1's\)/);
  assert.equal(w.acts.length, 0, "nothing was done");
  assert.equal(law.lawSnapshot().pin.settlement, 1, "reads keep what stands");
  assert.match(law.lawRefreshStanding().behind ?? "", /S2's/, "and the receipt says so");
  // once the law loads, the same act is judged under it
  const ok = await act(db.query, w, "thing-from-holder", SECOND_HOLDER);
  assert.equal(ok.e?.code, 409, "S2's dial, now loaded, binds");
});

test("4 · the store's law moved and its load hangs past the deadline: refused, not judged under the old law", async (t) => {
  const db = await storeFor(t);
  if (!db) return;
  await bless(db, 1, lawRows({ holders: null }));
  await law.reloadLawSnapshot({ query: db.query });
  await bless(db, 2, lawRows({ holders: 1 }));
  let release;
  const gate = new Promise((r) => { release = r; });
  t.after(() => release());
  const stuck = async (sql, p) => { if (sql === law.LAW_REFRESH_SQLS.law) await gate; return db.query(sql, p); };
  const w = world([row(ME, bag("mine")), row(BOWL, bag("other"))]);
  const r = await act(stuck, w, "thing-from-holder", SECOND_HOLDER);
  assert.equal(r.refused?.code, 503, `judged under S1 while S2's load hung: ${JSON.stringify(r)}`);
  assert.equal(w.acts.length, 0);
});

test("5 · a store that cannot be asked at all refuses nothing here: no law is known to have moved (the act's own write meets the store)", async () => {
  const down = async () => { throw new Error("connect ECONNREFUSED"); };
  assert.equal(await ask(down), null);
  // and a graph behind refuses like a law behind
  const moved = await actLaw.lawForAnAct({ law: async () => ({ behind: null }), graph: async () => ({ behind: "the store's newest world graph is bbbb, and this office has not loaded it yet" }) });
  assert.equal(moved?.code, 503);
  assert.match(moved.behind, /world graph/);
});

// ── 6 · the MCP door asks before a world act, and only a world act ─────────

async function mcpCall(handleMcp, name, args, key) {
  const raw = JSON.stringify({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name, arguments: args } });
  const req = Object.assign(Readable.from([Buffer.from(raw)]), { method: "POST", headers: { "content-type": "application/json" } });
  let body = "";
  await new Promise((ok) => {
    const res = { headersSent: false, setHeader() {}, hasHeader() { return false; }, getHeader() { return undefined; },
      writeHead() { this.headersSent = true; return this; }, end(chunk) { if (chunk) body += chunk; ok(); } };
    handleMcp(req, res, { key, canWrite: true, asOf: "test" });
  });
  const rpc = JSON.parse(body);
  return rpc.result ? JSON.parse(rpc.result.content[0].text) : rpc;
}

test("6 · the MCP door: a world act (apex or flat) is refused when the law moved; a read and a letter are not asked", async (t) => {
  const saved = process.env.WORLD_APEX;
  process.env.WORLD_APEX = "1";   // the apex verb is listed only where it is switched on
  t.after(() => { if (saved == null) delete process.env.WORLD_APEX; else process.env.WORLD_APEX = saved; });
  const { handleMcp } = await import("../src/mcp.mjs");
  const key = { household: "cyhouse", handles: new Set(["cy"]), accountId: 1 };
  let asked = 0;
  actLaw.__setLawForAnActForTest(() => { asked += 1; return { ...actLaw.LAW_MOVED, behind: "the store's law is S9's" }; });
  for (const [name, args] of [["world", { do: "take", args: { thing: "cy/a-lamp" } }], ["world_hold", { thing: "cy/a-lamp", handle: "cy" }]]) {
    const before = asked;
    const a = await mcpCall(handleMcp, name, args, key);
    // a gate above this one may answer first for a key the rig cannot make whole (standing, harbor);
    // when the act reaches the law gate, the law gate answers
    if (asked > before) assert.equal(a.defect, actLaw.LAW_MOVED.defect, `${name}: ${JSON.stringify(a)}`);
    else assert.fail(`${name} never asked for the law: ${JSON.stringify(a)}`);
  }
  const before = asked;
  await mcpCall(handleMcp, "world", {}, key);
  await mcpCall(handleMcp, "send_letter", { to: "dee", body: "hello" }, key);
  assert.equal(asked, before, "a read and a letter never ask");
});

// ── 7 · explain asks before it answers ──────────────────────────────────────

test("7 · explain: \"<class>\" asks for the law before it answers, so it stands where the next act will", async () => {
  const saved = process.env.WORLD_APEX;
  process.env.WORLD_APEX = "1";
  try {
    const { worldApex } = await import("../src/world-apex.mjs");
    const before = actLaw.__answeredForTest();
    await worldApex({ explain: "resident" }, null, {});
    assert.equal(actLaw.__answeredForTest(), before + 1, "explain answered from what stood, without asking");
  } finally { if (saved == null) delete process.env.WORLD_APEX; else process.env.WORLD_APEX = saved; }
});

// ── 8 · every REST world act route asks ─────────────────────────────────────

test("8 · every POST /world/* act route asks before it acts (server.mjs)", () => {
  const src = readFileSync(new URL("../src/server.mjs", import.meta.url), "utf8");
  const routes = [...src.matchAll(/if \(req\.method === "POST" && \(?path === "(\/world\/[a-z-]+)"[^\n]*\{\n([\s\S]*?)\n    \}\n/g)];
  const named = routes.map((m) => m[1]);
  for (const r of ["/world/apex", "/world/marks", "/world/walks", "/world/notes", "/world/hold", "/world/say", "/world/stake"])
    assert.ok(named.includes(r), `the route ${r} was not found to check (the matcher is stale)`);
  for (const [, path, body] of routes) assert.match(body, /lawMovedRefused\(res\)/, `POST ${path} acts without asking for the law`);
});

// ── 9 · loads still running are capped ──────────────────────────────────────

test("9 · a store that hangs is never asked for the whole law once per act: two loads still running, and a third does not start", async (t) => {
  const releases = [];
  t.after(() => releases.forEach((r) => r()));
  let pins = 0;
  // the pin hangs (a stuck connection); once let through, the store holds no law
  const hung = (sql) => (sql === law.LAW_REFRESH_SQLS.pin
    ? (pins += 1, new Promise((r) => releases.push(() => r({ rows: [] }))))
    : Promise.resolve({ rows: [] }));
  const a = await law.reloadLawSnapshot({ query: hung, deadlineMs: 20 });
  const b = await law.reloadLawSnapshot({ query: hung, deadlineMs: 20 });
  assert.equal(a.abandoned && b.abandoned, true);
  const c = await law.reloadLawSnapshot({ query: hung, deadlineMs: 20 });
  assert.equal(c.busy, true, "a third refresh with two still running is not started");
  assert.equal(pins, 2, "the store was asked twice, not three times");
  assert.equal(law.lawRefreshStanding().loading, 2, "the receipt counts them");
  releases.forEach((r) => r());
  await sleep(20);
  assert.equal(law.lawRefreshStanding().loading, 0, "they finish into the count");
});
