// kind-door-on-the-pen.test.mjs — LOGOS v2 part 2, lane O2: the kind door on a
// real store. The acts are written by the real pen (appendActFlipped) and read
// back from Postgres; the holder's room is judged again under its own lock in
// the write's transaction (chest-lock.mjs § chestRoomGuard), counting kinds; a
// pot-luck take is replayed from the act the store holds; and leave-mark into
// yourself runs the flat tool's own implementation (leaveMarkViaOffice) with
// the office's live collaborators.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startStore } from "./helpers/embedded-store.mjs";
import { foldUnits, kindEdgesOf, totalOf, UNIT_ACTION } from "../src/world-stacks.mjs";
import { callKinds } from "../src/world-kinds.mjs";
import { classViewOf } from "../src/world-units.mjs";
import { appendActFlipped } from "../src/world-journal.mjs";
import { __setPoolForTest } from "../src/world2-pen.mjs";
import { currentCrossing } from "../src/crossings.mjs";
import { lawSnapshotFromRows } from "../src/law-classes.mjs";
import { potLuck } from "../src/kind-holding.mjs";

const store = await startStore({ db: "kind_door_on_the_pen" });
const skip = store.skip ?? false;
const ACTOR = "sbx-cy", HH = "sbx-cy", BOWL = "sbx-ana/the-bowl";
let pool;
const FLAGS = ["WORLD2_PG", "WORLD2_PG_URL", "W2_PEN", "W2_GUARDS", "WORLD_CLONE"];
const saved = Object.fromEntries(FLAGS.map((k) => [k, process.env[k]]));
after(async () => {
  for (const k of FLAGS) { if (saved[k] == null) delete process.env[k]; else process.env[k] = saved[k]; }
  __setPoolForTest(null); if (pool) await pool.end(); await store.stop();
});
async function owner(fn) { const c = await store.connect("world2_owner"); try { return await fn(c); } finally { await c.end(); } }
async function seed() {
  await owner(async (c) => {
    await c.query("TRUNCATE acts, claims, marks, windows, settlements, households, household_pins CASCADE");
    await c.query("INSERT INTO windows (id,opens_at,closes_at,status) VALUES (300,now()-interval '1 day',now()+interval '1 day','open')");
    await c.query("INSERT INTO households (slug,ord,name,residents,since,declared_by) VALUES ('sbx-cy',0,'Synthetic Cy',ARRAY['sbx-cy'],'2026-08-01','sbx-cy')");
  });
}
const make = (to, kind, n) => owner((c) => c.query(
  "INSERT INTO acts (at,crossing,actor,action,object,class,payload,household) VALUES (now()-interval '1 day',300,'the-town','units:make',$1,'holding',$2,'the-town')",
  [to, JSON.stringify({ units: true, kinds: true, moves: [{ from: null, to, kind, n }] })]));
const rows = () => owner(async (c) => (await c.query("SELECT id::text,class,action,actor,household,payload FROM acts WHERE action LIKE 'units:%' ORDER BY acts.id")).rows);
async function onThePen() {
  if (!pool) { const { default: pg } = await import("pg"); pool = new pg.Pool({ connectionString: store.url("office_api") }); }
  Object.assign(process.env, { WORLD2_PG: "1", WORLD2_PG_URL: store.url("office_api"), W2_PEN: "hold", W2_GUARDS: "1" });
  __setPoolForTest(pool);
}

const SHA = "d".repeat(40);
const cls = (key, data = {}) => ({ number: 300, tag_sha: SHA, newest: 300, kind: "class", key, data: { class: key, ...data } });
const prop = (klass, name, dflt, tier, parent = null) => ({ number: 300, tag_sha: SHA, newest: 300, kind: "property",
  key: `${klass}/${name}`, data: { class: klass, parent, name, tier, default: dflt, id: `the-town/${klass}-${name}` } });
const LAW = [
  cls("postmark-node"), cls("mark", { extends: "postmark-node" }), cls("sited", { extends: "mark" }), cls("thing", { extends: "sited" }),
  cls("consumable", { extends: "thing" }), cls("candy", { extends: "consumable" }), cls("pocket-comet", { extends: "candy" }), cls("carbon-ghost", { extends: "candy" }),
  cls("entity", { extends: "postmark-node" }), cls("resident", { extends: "entity" }), cls("halloween-candy-bowl", { extends: "thing" }),
  prop("postmark-node", "makers", false, "constitution"), prop("thing", "makers", true, "constitution"),
  prop("resident", "holder", true, "constitution"), prop("resident", "capacity", 24, "constitution", "holder"),
  prop("thing", "holder", false, "sovereign"), prop("thing", "capacity", 30, "sovereign", "holder"), prop("thing", "open", true, "sovereign", "holder"),
  prop("halloween-candy-bowl", "holder", true, "constitution"),
];
const VIEW = classViewOf(lawSnapshotFromRows(LAW));

const depsOver = (over = {}) => ({
  classes: () => VIEW,
  readRows: async () => ({ units: await rows(), attachments: [] }),
  markById: async (id) => (id === BOWL ? { id, by: "sbx-ana", kind: "halloween-candy-bowl", at: { x: 1, y: 1 } } : null),
  reachTake: async () => ({}), reachGive: async () => ({}), standpoint: async () => ({ x: 1, y: 1 }), householdOf: null,
  dropsOut: async () => 0,
  append: (e, opts = {}) => appendActFlipped(null, { ...e, writtenAt: new Date().toISOString() }, opts),
  stamp: async () => ({ at: { anchor: BOWL, dx: 0, dy: 0 }, witnesses: { source: "presence", list: [] } }),
  crossing: () => currentCrossing(), household: () => HH,
  ...over,
});
const KEY = { household: HH, handles: new Set([ACTOR]) };

test("make into a holder through the real pen: one units:make act, its moves by kind, its edge, read back from the store", { skip }, async () => {
  await seed(); await onThePen();
  const r = await callKinds("make", { kind: "pocket-comet", count: 7, to: BOWL }, KEY, ACTOR, depsOver());
  assert.equal(r.holds.count, 7);
  const acts = await rows();
  assert.equal(acts.length, 1);
  assert.equal(acts[0].action, UNIT_ACTION.make);
  assert.equal(acts[0].class, "holding");
  assert.deepEqual(acts[0].payload.moves, [{ from: null, to: BOWL, kind: "pocket-comet", n: 7 }]);
  assert.deepEqual(acts[0].payload.edge, { giver: null, receiver: BOWL, maker: ACTOR });
  assert.deepEqual(kindEdgesOf(foldUnits(acts), BOWL), [{ kind: "pocket-comet", count: 7 }]);
});

test("the room is judged again under the holder's lock, counting kinds: a stale read admits, the guard refuses, nothing is written", { skip }, async () => {
  await seed(); await onThePen();
  await make(BOWL, "carbon-ghost", 29);
  const before = (await rows()).length;
  // the door read the record before another hand filled the bowl: it saw it empty
  const stale = depsOver({ readRows: async () => ({ units: [], attachments: [] }) });
  await assert.rejects(callKinds("make", { kind: "pocket-comet", count: 2, to: BOWL }, KEY, ACTOR, stale),
    (e) => e.code === 409 && /has room for 1, not 2/.test(e.defect) && /another hand reached it first/.test(e.hint));
  assert.equal((await rows()).length, before, "the guard rolled the write back");
  assert.equal(totalOf(foldUnits(await rows()), BOWL), 29);
});

test("a pot-luck take is replayed from the act the store holds: its recorded seed draws its recorded moves", { skip }, async () => {
  await seed(); await onThePen();
  await make(BOWL, "pocket-comet", 9); await make(BOWL, "carbon-ghost", 9);
  const r = await callKinds("take", { from: BOWL, count: 6 }, KEY, ACTOR, depsOver());
  assert.equal(r.draw, "pot luck");
  const act = (await rows()).at(-1);
  assert.equal(act.action, UNIT_ACTION.take);
  assert.match(act.payload.seed, /^sbx-cy·sbx-ana\/the-bowl·/);
  const replay = potLuck({ edges: [{ kind: "carbon-ghost", count: 9 }, { kind: "pocket-comet", count: 9 }], n: 6, seed: act.payload.seed });
  assert.deepEqual(act.payload.moves.map((m) => ({ kind: m.kind, count: m.n })), replay.drawn);
  assert.equal(totalOf(foldUnits(await rows()), ACTOR), 6);
});

test("leave-mark { kind, count, to: yourself } through the flat tool's implementation, with the office's live collaborators", { skip }, async () => {
  await seed(); await onThePen();
  process.env.WORLD_CLONE = join(tmpdir(), "postmark-no-world-clone-o2");
  const { reloadLawSnapshot, resetLawSnapshot, LAW_REFRESH_SQLS } = await import("../src/law-snapshot.mjs");
  await reloadLawSnapshot({ force: true, query: async (sql) => ({ rows: sql === LAW_REFRESH_SQLS.pin ? [{ newest: 300, pinned: 300 }] : LAW }) });
  try {
    const { leaveMarkViaOffice } = await import("../src/world.mjs");
    const r = await leaveMarkViaOffice(process.env.WORLD_CLONE, { kind: "pocket-comet", count: 3, to: ACTOR }, KEY);
    assert.equal(r.did, "make");
    assert.equal(r.holds.count, 3);
    assert.deepEqual(kindEdgesOf(foldUnits(await rows()), ACTOR), [{ kind: "pocket-comet", count: 3 }]);
    // past a resident's 24, refused whole, nothing made
    await assert.rejects(leaveMarkViaOffice(process.env.WORLD_CLONE, { kind: "pocket-comet", count: 22, to: ACTOR }, KEY), (e) => /has room for 21, not 22/.test(e.defect));
    // a count carries nothing of its own: beside a thing's own field it is refused by name, both forms named (POS-766)
    await assert.rejects(leaveMarkViaOffice(process.env.WORLD_CLONE, { kind: "pocket-comet", count: 1, to: ACTOR, body: "mine" }, KEY),
      (e) => /count makes that many alike, with nothing of their own, and body is one thing's own/.test(e.defect) && /leave-mark \{ slug, body, kind\?, to \}/.test(e.hint));
    assert.equal(totalOf(foldUnits(await rows()), ACTOR), 3);
  } finally { resetLawSnapshot(); }
});

test("POS-766 · leave-mark { slug, body, kind, to: yourself } through the flat tool's implementation: one make act in the store, the thing in the one world, eaten by consume { thing }", { skip }, async () => {
  await seed(); await onThePen();
  // a real world clone: the name is checked against canon (the suite exports WORLD_CLONE; the tree keeps one)
  process.env.WORLD_CLONE = saved.WORLD_CLONE ?? join(process.cwd(), "world-clone");
  const { reloadLawSnapshot, resetLawSnapshot, LAW_REFRESH_SQLS } = await import("../src/law-snapshot.mjs");
  await reloadLawSnapshot({ force: true, query: async (sql) => ({ rows: sql === LAW_REFRESH_SQLS.pin ? [{ newest: 300, pinned: 300 }] : LAW }) });
  try {
    const { leaveMarkViaOffice, worldMarkById } = await import("../src/world.mjs");
    const id = `${ACTOR}/my-comet`;
    const r = await leaveMarkViaOffice(process.env.WORLD_CLONE, { slug: "my-comet", body: "A comet of my own, still warm.", kind: "pocket-comet", to: ACTOR }, KEY);
    assert.deepEqual([r.did, r.made, r.kind, r.live, r.stamps], ["make", id, "pocket-comet", true, 0]);
    const made = await owner(async (c) => (await c.query("SELECT action, object, class, actor, payload FROM acts WHERE action IN ('make', 'consume') ORDER BY id")).rows);
    assert.deepEqual(made.map((a) => [a.action, a.object, a.class, a.actor]), [["make", id, "holding", ACTOR]]);
    assert.equal(made[0].payload.made.body, "A comet of my own, still warm.");
    // the one world lays it in, held and unplaced, from the store alone
    const m = (await worldMarkById(id)).mark;
    assert.equal(m?.held_by, ACTOR);
    assert.equal(m?.at, undefined);
    // investigate reads it as the resident would: published by its holder, never "never-was"
    const { worldInvestigate } = await import("../src/world.mjs");
    const look = await worldInvestigate({ mark: id }, KEY);
    assert.equal(look.receipt?.status, "published", JSON.stringify(look).slice(0, 400));
    assert.equal(look.receipt?.made_in_hand, true);
    assert.match(look.receipt?.says ?? "", /published by its holder .* held by sbx-cy/);
    // its name is taken for good: a second make, and a mark on the ground by that slug, are refused
    await assert.rejects(leaveMarkViaOffice(process.env.WORLD_CLONE, { slug: "my-comet", body: "Again.", to: ACTOR }, KEY), (e) => e.code === 409);
    await assert.rejects(leaveMarkViaOffice(process.env.WORLD_CLONE, { slug: "my-comet", body: "On the ground.", kind: "sited", at: { x: 1, y: 1 }, extent: { w: 1, h: 1 } }, KEY),
      (e) => e.code === 409 && /taken for good/.test(e.defect));
    // eaten from hand: the holding ends, and the world no longer holds it
    const { liveUnitDeps } = await import("../src/world-units.mjs");
    const eaten = await callKinds("consume", { thing: id }, KEY, ACTOR, await liveUnitDeps());
    assert.equal(eaten.thing, id);
    assert.equal((await worldMarkById(id)).mark, null);
  } finally { resetLawSnapshot(); }
});

test("S4 · a pot-luck take that draws a whole mark commits the draw and the mark's holding act in ONE transaction; a failing half leaves nothing", { skip }, async () => {
  await seed(); await onThePen();
  const { liveUnitDeps } = await import("../src/world-units.mjs");
  const live = await liveUnitDeps();
  const lamp = "sbx-ana/a-lamp";
  const deps = depsOver({
    append: live.append,
    readRows: async () => ({ units: await rows(), attachments: [{ entity: BOWL, target: lamp, policy: "cascade", born_at: "2026-10-17T00:00:00Z" }] }),
    markById: async (id) => (id === BOWL ? { id, by: "sbx-ana", kind: "halloween-candy-bowl", at: { x: 1, y: 1 } } : id === lamp ? { id, by: "sbx-ana", kind: "thing" } : null),
  });
  const r = await callKinds("take", { from: BOWL, count: 1 }, KEY, ACTOR, deps);
  assert.deepEqual(r.whole?.map((x) => x.thing), [lamp], "the draw took the lamp, the only thing held");
  const all = await owner(async (c) => (await c.query("SELECT action, object FROM acts ORDER BY id")).rows);
  assert.deepEqual(all.map((a) => a.action), ["take", "units:take"], "both acts, one transaction (the mark's act inside the draw's)");
  assert.equal(all[0].object, lamp);
  // and when the draw's own act cannot be written AFTER the mark's act went in, the transaction rolls back: neither lands
  const before = all.length;
  const good = { crossing: currentCrossing(), actor: ACTOR, action: "take", object: lamp, cls: "holding", household: HH,
    payload: { thing: lamp, holder: ACTOR, previous_holder: BOWL, made_by: "sbx-ana", policy: "cascade", declared_by: ACTOR }, effect: "taken", writtenAt: new Date().toISOString() };
  // the draw's act reuses a spent world nonce (052's unique index), so its INSERT — the transaction's last — is refused
  const draw = { crossing: currentCrossing(), actor: ACTOR, action: "units:take", object: BOWL, cls: "holding", household: HH, nonce: "o2-spent-once",
    payload: { units: true, kinds: true, moves: [] }, effect: "x", writtenAt: new Date().toISOString() };
  await live.append(draw);
  const spent = before + 1;
  await assert.rejects(live.append({ ...draw, writtenAt: new Date().toISOString() }, { also: [good] }), (e) => /23505|duplicate|unique|cannot be reached/i.test(`${e.code} ${e.message} ${e.cause?.code ?? ""}`), "the pen refuses the whole write (it names a failed write as unreachable; the count below is the proof)");
  assert.equal((await owner(async (c) => (await c.query("SELECT count(*)::int AS n FROM acts")).rows[0].n)), spent, "the mark's act, written first, rolled back with the refused draw: nothing of the edge was written");
});
