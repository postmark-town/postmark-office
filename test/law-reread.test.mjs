// law-reread.test.mjs — a settlement's law reaches the doors with no restart,
// even when a refresh hangs (POS-680, part 1 of 2).
//
// Found in a dev sandbox (2026-10-18): a blessed change to the holders dial
// read straight away in explain, but the hold door kept refusing a second
// holder until the office restarted. The doors read the law snapshot
// (law-snapshot.mjs), refreshed by a timer; a refresh shared through
// `inflight` that never settled answered every later tick with the same
// pending promise, so the law before it stood until a restart.
//
// What is held here, against the suite's store (a real Postgres) carrying the
// law the way law-ingest writes it, and the real refresher on a short tick:
//   1. a refresh that hangs is let go at its deadline, and the next tick loads
//      the new law (the law snapshot and the world graph snapshot alike);
//   2. a refresh let go and finishing late never publishes over a newer law;
//   3. every publish, from any path, is heard by the same listeners;
//   4. the kept read of restored classes is marked stale with the law it was read
//      from, answers until a new read lands, and is replaced only then;
//   5. THE DOORS: after an ingest, within one tick, a take of a second holder
//      obeys the new holders dial, and a taken class's take, give and consume
//      refuse, then land again once the law gives it back. The doors are the
//      kind door (`callKinds`) with every collaborator injected, reading the
//      class layer the way the office does: `classViewOf(lawSnapshot())`.
//
// THE FLIPS (each reds the named cases; a refresh keeping the store's own text
// reds 6): no deadline on the law refresh (1, 5a,
// 5b); no deadline on the graph refresh (1g); a late refresh publishes anyway
// (2); only the timer's own publish is announced (3); the restored keep never
// marked stale, or dropped before a new read lands (4).

process.env.LAW_REFRESH_DEADLINE_MS = "150";
process.env.WORLD_GRAPH_REFRESH_DEADLINE_MS = "150";

import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";

const { startStore, NO_STORE } = await import("./helpers/embedded-store.mjs");
const { writeLaw } = await import("../world2/tools/law-ingest.mjs");
const law = await import("../src/law-snapshot.mjs");
const graph = await import("../src/world-graph-snapshot.mjs");
const restored = await import("../src/restored-classes.mjs");
const { callKinds } = await import("../src/world-kinds.mjs");
const { classViewOf } = await import("../src/world-units.mjs");
const { UNIT_ACTION, foldUnits, kindEdgesOf } = await import("../src/world-stacks.mjs");

const TICK = 40;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (pred, ms = 2_000) => { const end = Date.now() + ms; while (!pred() && Date.now() < end) await sleep(10); return pred(); };

// ── the law, as law-ingest writes it ─────────────────────────────────────────
const cls = (key, data = {}) => ({ kind: "class", path: `WORLD/marks/the-town/${key}/mark.md`, key, data: { class: key, ...data } });
const prop = (klass, name, dflt, tier, parent = null) => ({ kind: "property", path: `WORLD/marks/the-town/${klass}/${name}.md`,
  key: parent ? `${klass}/${parent}/${name}` : `${klass}/${name}`, data: { class: klass, parent, name, tier, default: dflt, id: `the-town/${klass}-${name}` } });
const CLUE = "Not a single trinket is left in town.";
/** The town's law: `holders` the resident's holders dial (null: unset, no limit), `trinket` the trinket class's dials. */
const lawRows = ({ holders = null, trinket = {} } = {}) => [
  cls("postmark-node"), cls("mark", { extends: "postmark-node" }), cls("sited", { extends: "mark" }),
  cls("thing", { extends: "sited" }), cls("consumable", { extends: "thing" }),
  cls("trinket", { extends: "consumable", dials: trinket }), cls("glass-bead", { extends: "trinket" }), cls("biscuit", { extends: "consumable" }),
  cls("satchel", { extends: "thing" }), cls("bowl", { extends: "thing" }),
  cls("entity", { extends: "postmark-node" }), cls("resident", { extends: "entity" }),
  prop("postmark-node", "makers", false, "constitution"), prop("sited", "makers", true, "constitution"), prop("thing", "makers", true, "constitution"),
  prop("resident", "holder", true, "constitution"), prop("resident", "capacity", 24, "constitution", "holder"),
  ...(holders == null ? [] : [prop("resident", "holders", holders, "constitution", "holder")]),
  prop("thing", "holder", false, "sovereign"), prop("thing", "capacity", 30, "sovereign", "holder"),
  prop("thing", "min", 1, "constitution", "capacity"), prop("thing", "max", 120, "constitution", "capacity"),
  prop("thing", "open", true, "sovereign", "holder"), prop("thing", "portable", true, "sovereign"),
  prop("satchel", "holder", true, "constitution"), prop("bowl", "holder", true, "constitution"),
];
const shaOf = (n) => String(n).padStart(40, "a");
/**
 * A store of its own for one test: `query` reads as the office does
 * (office_api), `close` ends it. Null when the suite's store cannot start.
 */
let stores = 0;
async function storeFor(t) {
  let s;
  try { s = await startStore({ db: `law_reread_${++stores}` }); } catch { t.skip(NO_STORE); return null; }
  const [api, pen, owner] = [await s.connect("office_api"), await s.connect("law_ingester"), await s.connect("world2_owner")];
  // closed when the test ends, passed or failed: a red test leaves no connection holding the run open
  t.after(async () => { for (const c of [api, pen, owner]) await c.end().catch(() => {}); await s.stop(); });
  return { query: (sql, params) => api.query(sql, params), pen, owner };
}
/** A settlement blessed and its law ingested: what the bless re-reads into the store. */
async function bless(db, n, rows) {
  await writeLaw(db.pen, { lawSha: shaOf(n), rows, identities: [], blessed: true });
  await db.owner.query("INSERT INTO settlements (number, tag_sha, published_at) VALUES ($1, $2, now())", [n, shaOf(n)]);
}

/**
 * The store as the refresher asks it, with a stall that can be armed: the
 * next statement the refresher sends does not answer (a hung connection).
 * `hung` says it has been reached. A hung statement ends, with the error a
 * dropped connection gives, when the next stall is armed or the test ends:
 * loads still running are capped (MAX_LOADS), and a connection that hangs
 * for good holds its slot for good.
 */
function stallable(db, t) {
  const s = { armed: false, hung: false, ends: [] };
  const endAll = () => { for (const end of s.ends.splice(0)) end(); };
  t.after(endAll);
  s.arm = () => { endAll(); s.armed = true; };
  s.query = (sql, params) => {
    if (s.armed) {
      s.armed = false; s.hung = true;
      return new Promise((_, reject) => s.ends.push(() => reject(new Error("Connection terminated unexpectedly"))));
    }
    return db.query(sql, params);
  };
  return s;
}

beforeEach(() => { law.resetLawSnapshot(); graph.resetWorldGraph(); });
after(() => { law.resetLawSnapshot(); graph.resetWorldGraph(); });

// ── 1 · a refresh that hangs is let go ───────────────────────────────────────

test("1 · a law refresh that hangs is let go at its deadline, and the next tick loads the new law: no restart", async (t) => {
  const db = await storeFor(t);
  if (!db) return;
  await bless(db, 1, lawRows({ holders: 1 }));
  const store = stallable(db, t);
  law.startLawRefresher({ intervalMs: TICK, query: store.query });
  assert.ok(await until(() => law.lawSnapshot()?.pin.settlement === 1), "the first law loads");

  store.arm();
  assert.ok(await until(() => store.hung), "a tick reached the stall");
  await bless(db, 2, lawRows({ holders: null }));
  assert.ok(await until(() => law.lawSnapshot()?.pin.settlement === 2),
    `the law blessed after a hung refresh never reached this process (standing: ${JSON.stringify(law.lawStanding())}, refresh: ${JSON.stringify(law.lawRefreshStanding())})`);
  const r = law.lawRefreshStanding();
  assert.ok(r.abandoned >= 1, "the hung refresh was let go, and counted");
  assert.equal(r.error, null, "a refresh after it answered, so the error is cleared");
  assert.ok(r.checked_at && r.published_at, "the health line says when the store was asked and when the law was published");
});

test("1g · a world graph refresh that hangs is let go at its deadline, and the next tick loads the new graph", async (t) => {
  // the graph's tables, as graph-ingest writes them, at one key per settlement
  const pinOf = (n) => ({ tag_sha: shaOf(n), office_sha: "o".repeat(40), settlement: n });
  let newest = 1;
  const rows = { meta: [{ key: "as_of_world", value: "x" }], nodes: [], edges: [], events: [], geometryVersions: [], lintFindings: [] };
  const answer = async (sql) => (sql === graph.PIN_SQL ? { rows: [pinOf(newest)] }
    : { rows: rows[Object.entries(graph.GRAPH_SQLS).find(([, v]) => v === sql)?.[0]] ?? [] });
  const store = { armed: false, hung: false, ends: [] };
  t.after(() => store.ends.forEach((end) => end()));
  const query = (sql, params) => {
    if (store.armed) { store.armed = false; store.hung = true; return new Promise((_, reject) => store.ends.push(() => reject(new Error("Connection terminated unexpectedly")))); }
    return answer(sql, params);
  };
  graph.startWorldGraphRefresher({ intervalMs: TICK, query });
  assert.ok(await until(() => graph.worldGraphSnapshot()?.pin.settlement === 1), "the first graph loads");
  store.armed = true;
  assert.ok(await until(() => store.hung), "a tick reached the stall");
  newest = 2;
  assert.ok(await until(() => graph.worldGraphSnapshot()?.pin.settlement === 2),
    `the graph copied in after a hung refresh never reached this process (${JSON.stringify(graph.worldGraphRefreshStanding())})`);
  assert.ok(graph.worldGraphRefreshStanding().abandoned >= 1);
});

// ── 2 · a late refresh never publishes over a newer law ─────────────────────

test("2 · a refresh let go and finishing late publishes nothing over a newer law; one let go with nothing newer still publishes", async (t) => {
  const db = await storeFor(t);
  if (!db) return;
  await bless(db, 1, lawRows());
  // the first refresh reads S1's pair and S1's law, and the law's answer is held on its way back (a slow wire)
  let release;
  const gate = new Promise((r) => { release = r; });
  t.after(() => release());
  const slow = async (sql, p) => { const r = await db.query(sql, p); if (sql === law.LAW_REFRESH_SQLS.law) await gate; return r; };
  const first = law.reloadLawSnapshot({ query: slow, deadlineMs: 50 });
  assert.equal((await first).abandoned, true, "let go at its deadline");
  // meanwhile S2 lands and a fresh refresh publishes it
  await bless(db, 2, lawRows({ holders: 3 }));
  assert.equal((await law.reloadLawSnapshot({ query: db.query })).changed, true);
  assert.equal(law.lawSnapshot().pin.settlement, 2);
  // the one let go answers now, and it started before the one that published
  release();
  await sleep(50);
  assert.equal(law.lawSnapshot().pin.settlement, 2, "a refresh that started before the published one never publishes over it");

  // nothing newer published: a slow refresh let go still publishes when it finishes
  law.resetLawSnapshot();
  let release2;
  const gate2 = new Promise((r) => { release2 = r; });
  t.after(() => release2());
  const r2 = await law.reloadLawSnapshot({ query: async (sql, p) => { await gate2; return db.query(sql, p); }, deadlineMs: 50 });
  assert.equal(r2.abandoned, true);
  assert.equal(law.lawSnapshot(), null);
  release2();
  assert.ok(await until(() => law.lawSnapshot()?.pin.settlement === 2), "slow, not stuck: the law still lands");
});

// ── 3 · every publish is heard ──────────────────────────────────────────────

test("3 · a publish from any path is heard by the refresher's listener, not only the timer's own", async (t) => {
  const db = await storeFor(t);
  if (!db) return;
  await bless(db, 1, lawRows());
  const told = [];
  law.startLawRefresher({ intervalMs: 60 * 60_000, query: db.query, onChange: (s) => told.push(s.settlement) });
  assert.ok(await until(() => told.length === 1), "the timer's first publish is heard");
  await bless(db, 2, lawRows({ holders: 1 }));
  // not the timer (it ticks once an hour here): a read worker's reload, a tool, a test
  const r = await law.reloadLawSnapshot({ query: db.query });
  assert.equal(r.changed, true);
  assert.deepEqual(told, [1, 2], "the second publish came from outside the timer and was heard all the same");
});

test("3g · a graph publish from any path is heard", async () => {
  const told = [];
  let newest = 1;
  const query = async (sql) => (sql === graph.PIN_SQL ? { rows: [{ tag_sha: shaOf(newest), office_sha: "o".repeat(40), settlement: newest }] }
    : { rows: sql === graph.GRAPH_SQLS.meta ? [{ key: "as_of_world", value: "x" }] : [] });
  graph.startWorldGraphRefresher({ intervalMs: 60 * 60_000, query, onChange: (s) => told.push(s.settlement) });
  assert.ok(await until(() => told.length === 1), `the first graph publish was not heard: ${JSON.stringify(graph.worldGraphRefreshStanding())} ${JSON.stringify(graph.worldGraphStanding())}`);
  newest = 2;
  assert.equal((await graph.reloadWorldGraph({ query })).changed, true);
  assert.deepEqual(told, [1, 2]);
});

// ── 4 · the restored keep goes with its law ─────────────────────────────────

test("4 · a law publish marks the restored keep stale; with the store down the old keep still answers; once the store answers the new keep lands", async (t) => {
  const db = await storeFor(t);
  if (!db) return;
  t.after(() => restored.__setRestoredForTest(null));
  await bless(db, 1, lawRows({ trinket: { stolen: true, clue: CLUE } }));
  restored.__setRestoredForTest({ trinket: { since: "2026-10-26T06:30:00.000Z", restored: true } });
  assert.equal(restored.restoredClass("trinket"), true, "kept: the town gave the trinket back");
  assert.equal(restored.restoredStanding().stale, false);

  // a new law is published while the store cannot be read (this file engages none: the re-read fails)
  await bless(db, 2, lawRows({ trinket: { stolen: true, clue: CLUE } }));
  await law.reloadLawSnapshot({ query: db.query });
  await until(() => restored.restoredStanding().last_read_failed);
  assert.equal(restored.restoredStanding().last_read_failed, true, "the re-read after the publish failed");
  assert.equal(restored.restoredClass("trinket"), true, "the store is down: the old keep still answers, the class is not taken back");
  assert.equal(restored.restoredStanding().stale, true, "and the health line says the keep is stale");

  // the store answers again, a keep later: the new read lands, against the new law (the dial went on again at S2; no restore since)
  const S2_BLESSED = "2026-10-28T06:30:00.000Z";
  const answers = async (sql) => (sql === restored.RESTORE_ROWS_SQL
    ? { rows: [{ id: "1", action: "restore", actor: "the-town", object: "trinket", at: "2026-10-27T18:31:00.000Z" }] }
    : { rows: [{ number: 2, blessed_at: S2_BLESSED, data: { dials: { stolen: true } } }, { number: 1, blessed_at: "2026-10-26T06:30:00.000Z", data: { dials: {} } }] });
  restored.restoredClass("trinket", { now: Date.now() + restored.KEEP_MS, query: answers });
  assert.ok(await until(() => restored.restoredStanding().stale === false), "the new keep landed");
  assert.equal(restored.restoredClass("trinket"), false, "read against the new law: the restore was before the dial went on again, so the class is taken");
});

// ── 5 · THE DOORS ──────────────────────────────────────────────────────────

const ME = "sbx-cy";
const bag = (name) => `sbx-cy/${name}`;
const BOWL = "sbx-ana/the-bowl";
const markOf = (id) => (id === BOWL ? { id, by: "sbx-ana", kind: "bowl", at: { x: 5, y: 6 } }
  : String(id).startsWith("sbx-cy/") ? { id, by: ME, kind: "satchel", at: { x: 5, y: 6 } } : null);
const row = (entity, target) => ({ entity, target, policy: "cascade", born_at: "2026-10-17T00:00:00Z" });
/** The kind door, every collaborator injected; the class layer is the office's own: `classViewOf(lawSnapshot())`. */
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
    append: async (entry, { also = [] } = {}) => { for (const e of [entry, ...also]) acts.push({ id: acts.length + 100, class: e.cls, action: e.action, object: e.object, actor: e.actor, payload: e.payload }); return { actId: acts.length + 99 }; },
    stamp: async (actor) => ({ at: `2026-10-21T06:00:00Z@${actor}#${acts.length}`, witnesses: [] }),
    crossing: () => 265,
    household: () => "hh:test",
  };
  const seed = (moves) => acts.push({ id: acts.length + 100, class: "holding", action: UNIT_ACTION.make, payload: { units: true, moves } });
  return { deps, acts, seed, fold: () => foldUnits(acts) };
}
const go = (w, route, args, actor = ME) => callKinds(route, args, { handles: new Set([actor]) }, actor, w.deps);
const refusedTaken = (e) => e.code === 423 && e.defect === CLUE && e.stolen === "trinket";

/** Bless `rows` as settlement `n` while the refresher is stalled on a hung statement, then wait one tick and a deadline. */
async function blessThroughAStall(db, store, n, rows) {
  store.arm();
  assert.ok(await until(() => store.hung), "a tick reached the stall");
  store.hung = false;
  await bless(db, n, rows);
  await until(() => law.lawSnapshot()?.pin.settlement === n, 150 + 3 * TICK + 500);
}

test("5a · after an ingest, within one tick, the take of a second holder obeys the new holders dial: refused at 1, landed when unset", async (t) => {
  const db = await storeFor(t);
  if (!db) return;
  await bless(db, 1, lawRows({ holders: 1 }));
  const store = stallable(db, t);
  law.startLawRefresher({ intervalMs: TICK, query: store.query });
  assert.ok(await until(() => law.lawSnapshot()?.pin.settlement === 1));
  // I carry a satchel; the bowl holds another
  const w = world([row(ME, bag("mine")), row(BOWL, bag("other"))]);
  await assert.rejects(go(w, "thing-from-holder", { thing: bag("other"), from: BOWL }),
    (e) => e.code === 409 && e.defect === "you're already carrying a holder (sbx-cy/mine)", "the dial at 1 binds");

  await blessThroughAStall(db, store, 2, lawRows({ holders: null }));
  const took = await go(w, "thing-from-holder", { thing: bag("other"), from: BOWL }).catch((e) => e);
  assert.equal(took.did, "take", `the dial was unset at S2, and the very next take still obeyed S1's: ${took.defect ?? JSON.stringify(took)}`);
});

test("5b · a taken class: after the ingest the next take, give and consume of its kind refuse; after the law gives it back they land, no restart", async (t) => {
  const db = await storeFor(t);
  if (!db) return;
  await bless(db, 1, lawRows());
  const store = stallable(db, t);
  law.startLawRefresher({ intervalMs: TICK, query: store.query });
  assert.ok(await until(() => law.lawSnapshot()?.pin.settlement === 1));
  const w = world();
  w.seed([{ from: null, to: BOWL, kind: "glass-bead", n: 5 }, { from: null, to: ME, kind: "glass-bead", n: 4 }]);

  await blessThroughAStall(db, store, 2, lawRows({ trinket: { stolen: true, clue: CLUE } }));
  const before = w.acts.length;
  await assert.rejects(go(w, "take", { from: BOWL, kind: "glass-bead", count: 1 }), refusedTaken, "take: the class was taken at S2");
  await assert.rejects(go(w, "give", { to: BOWL, kind: "glass-bead", count: 1 }), refusedTaken, "give");
  await assert.rejects(go(w, "consume", { kind: "glass-bead" }), refusedTaken, "consume");
  assert.equal(w.acts.length, before, "nothing was recorded");

  await blessThroughAStall(db, store, 3, lawRows());
  await go(w, "take", { from: BOWL, kind: "glass-bead", count: 1 });
  await go(w, "give", { to: BOWL, kind: "glass-bead", count: 2 });
  await go(w, "consume", { kind: "glass-bead" });
  assert.deepEqual(kindEdgesOf(w.fold(), ME), [{ kind: "glass-bead", count: 2 }], "4 + 1 taken − 2 given − 1 eaten");
});

// ── 6 · what a refresh's error shows on GET /release ────────────────────────

test("6 · a refresh's error reaches GET /release in the office's own words: the store's text, role and host go to the log only", async () => {
  // what a cancelled statement and a refused connection say, with the names a store's text can carry
  const pgError = (message, code) => Object.assign(new Error(message), { code });
  const raw = [pgError("canceling statement due to statement timeout", "57014"),
    pgError('permission denied for relation law_projection (role "office_api" at 127.0.0.1:5432)', "42501"),
    Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:5432"), { code: "ECONNREFUSED" })];
  for (const e of raw) {
    law.resetLawSnapshot(); graph.resetWorldGraph();
    const fail = async () => { throw e; };
    await law.reloadLawSnapshot({ query: fail });
    await graph.reloadWorldGraph({ query: fail });
    const release = JSON.stringify({ law: law.lawForRelease(), world_graph: graph.worldGraphForRelease() });
    assert.match(release, /the record did not answer/, `the release names no reason: ${release}`);
    for (const said of [/canceling statement/i, /permission denied/i, /\brelation\b/i, /office_api/, /127\.0\.0\.1/, /ECONNREFUSED/])
      assert.doesNotMatch(release, said, `GET /release would carry the store's own text (${said}): ${release}`);
  }
});
