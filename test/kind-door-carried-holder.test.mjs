// kind-door-carried-holder.test.mjs — LOGOS v2 part 2, lane O2; review-610 B1
// and S3: the SUCCESSFUL reach acts, through the real doors with the REAL reach.
//
// "refill: at, or carrying" (10:30); the Bag's "fill it at chests, share from
// it" (12:34). A holder carried 1 km from where it was made is in reach, in
// your hands; one left where it was made, 1 km off, is not. Through the flat
// tools' own implementations (world_hold via callHoldTool, world_leave_mark via
// leaveMarkViaOffice) with prod's flags on a real store, over a throwaway world
// whose resident positions come from the world's own `where-is` seam (a home
// for each resident, as world-apex.test.mjs stands its residents), and the law
// in W1's shape. Nothing here injects a reach.

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { NO_WORLD, worldClone } from "./fixture-paths.mjs";
import { startStore } from "./helpers/embedded-store.mjs";
import { markRecord } from "../src/mark-record.mjs";

const WORLD = worldClone();
const store = await startStore({ db: "kind_door_carried_holder" });
const skip = store.skip ?? ((!WORLD && NO_WORLD) || false);
const BAG = "sbx-cy/my-bag", MY_BOWL = "sbx-cy/my-bowl", FAR_BOWL = "sbx-ana/the-bowl", LAMP = "sbx-cy/a-lamp", STONE = "sbx-ana/a-stone", PEBBLE = "sbx-ana/a-pebble";
const repo = mkdtempSync(join(tmpdir(), "o2-carried-"));
const put = (p, content) => { const f = join(repo, p); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, content); };
const FLAGS = ["WORLD2_PG", "WORLD2_PG_URL", "W2_PEN", "W2_GUARDS", "WORLD_CLONE", "WORLD_SINGLE_LOG", "WORLD_POOL"];
const saved = Object.fromEntries(FLAGS.map((k) => [k, process.env[k]]));
let pool;

const SHA = "f".repeat(40);
const cls = (key, data = {}) => ({ number: 300, tag_sha: SHA, newest: 300, kind: "class", key, data: { class: key, ...data } });
const prop = (klass, name, dflt, tier, parent = null) => ({ number: 300, tag_sha: SHA, newest: 300, kind: "property",
  key: `${klass}/${name}`, data: { class: klass, parent, name, tier, default: dflt, id: `the-town/${klass}-${name}` } });
const LAW = [
  cls("postmark-node"), cls("mark", { extends: "postmark-node" }), cls("sited", { extends: "mark" }), cls("thing", { extends: "sited" }),
  cls("consumable", { extends: "thing" }), cls("candy", { extends: "consumable" }), cls("pocket-comet", { extends: "candy" }),
  cls("entity", { extends: "postmark-node" }), cls("resident", { extends: "entity" }),
  cls("halloween-candy-bowl", { extends: "thing", actions: [{ action: "refill", who: "maker", from: "reach", effect: "leave-mark { kind, count, to: this bowl }" }] }),
  cls("halloween-candy-bag", { extends: "thing" }),
  prop("postmark-node", "makers", false, "constitution"), prop("thing", "makers", true, "constitution"),
  prop("resident", "holder", true, "constitution"), prop("resident", "capacity", 24, "constitution", "holder"),
  prop("thing", "holder", false, "sovereign"), prop("thing", "capacity", 30, "sovereign", "holder"),
  prop("thing", "min", 1, "constitution", "capacity"), prop("thing", "max", 120, "constitution", "capacity"),
  prop("thing", "open", true, "sovereign", "holder"), prop("thing", "portable", true, "sovereign"),
  prop("halloween-candy-bowl", "holder", true, "constitution"),
  prop("halloween-candy-bag", "holder", true, "constitution"), prop("halloween-candy-bag", "capacity", 200, "sovereign", "holder"),
  prop("halloween-candy-bag", "max", 200, "constitution", "capacity"),
];

let callHoldTool, leaveMarkViaOffice, resetLawSnapshot, writeThingHolding, appendActFlipped, currentCrossing;
if (!skip) {
  mkdirSync(join(repo, "tools"), { recursive: true });
  for (const f of readdirSync(join(WORLD, "tools")).filter((f) => f.endsWith(".mjs") && !f.endsWith(".test.mjs")))
    copyFileSync(join(WORLD, "tools", f), join(repo, "tools", f));
  // THE POSITIONS, by the world's own where-is seam: cy stands 1 km east of where her bag and bowl were made; dee beside her
  put("tools/where-is.mjs", `
export const NOWHERE = Object.freeze({ x: null, y: null, placed: false, source: null, mark_id: null });
export const QUAY_MARK_ID = "the-town/the-quay";
const HOMES = { "sbx-cy": { x: 1010, y: 10 }, "sbx-dee": { x: 1012, y: 10 } };
export function homeOf(handle) { const h = HOMES[handle]; return h ? { ...h, mark_id: handle + "/home", placed: true, source: "home", parcel: { id: handle + "/home", at: { x: h.x, y: h.y }, extent: { w: 25, h: 25 } } } : NOWHERE; }
export function whereIs(handle) { const h = homeOf(handle); return h.placed ? { ...h, position: null } : NOWHERE; }
export function publicResidents() { return []; }
export function porchOf() { return null; }
export function householdOf() { return null; }
export function parcelsFor() { return []; }
export function parcelFor() { return null; }
export function sourceLabel() { return "home"; }
`);
  const root = { id: "the-town/let-there-be-light", by: "the-town", slug: "let-there-be-light", kind: "sited", at: { x: 0, y: 0 }, extent: { w: 10000, h: 10000 } };
  const mark = (id, klass, body) => ({ rec: { id, by: id.split("/")[0], slug: id.split("/")[1], kind: "sited", class: klass, at: { x: 10, y: 10 }, extent: { w: 2, h: 2 } }, body });
  const ms = [mark(BAG, "halloween-candy-bag", "A bag for gathering."), mark(MY_BOWL, "halloween-candy-bowl", "My bowl of candy."), mark(FAR_BOWL, "halloween-candy-bowl", "A bowl by a far door."), mark(LAMP, "thing", "A small lamp."),
    { rec: { id: STONE, by: "sbx-ana", slug: "a-stone", kind: "sited", class: "thing", portable: false, at: { x: 1010, y: 10 }, extent: { w: 2, h: 2 } }, body: "A stone too heavy to lift." },
    { rec: { id: PEBBLE, by: "sbx-ana", slug: "a-pebble", kind: "sited", class: "thing", at: { x: 1010, y: 10 }, extent: { w: 2, h: 2 } }, body: "A pebble." }];
  put("WORLD/marks/let-there-be-light/mark.md", markRecord(root, "Synthetic world frame."));
  for (const m of ms) put(`WORLD/marks/${m.rec.id}/mark.md`, markRecord(m.rec, m.body));
  put("WORLD/world-state.json", JSON.stringify({ tick: 0, dials: {}, marks: [root, ...ms.map((m) => m.rec)] }));
  copyFileSync(join(WORLD, "WORLD", "skeleton.json"), join(repo, "WORLD", "skeleton.json"));
  execFileSync("git", ["init", "-q", "-b", "main", repo]);
  execFileSync("git", ["-C", repo, "add", "-A", "WORLD", "tools"]);
  execFileSync("git", ["-C", repo, "-c", "user.name=fixture", "-c", "user.email=fixture@test.invalid", "commit", "-qm", "synthetic canon"]);
  const { default: pg } = await import("pg");
  pool = new pg.Pool({ connectionString: store.url("office_api") });
  Object.assign(process.env, { WORLD_CLONE: repo, WORLD_SINGLE_LOG: "", WORLD_POOL: "0", WORLD2_PG: "1", WORLD2_PG_URL: store.url("office_api"), W2_PEN: "hold", W2_GUARDS: "1" });
  (await import("../src/world2-pen.mjs")).__setPoolForTest(pool);
  const snap = await import("../src/law-snapshot.mjs");
  resetLawSnapshot = snap.resetLawSnapshot;
  await snap.reloadLawSnapshot({ force: true, query: async (sql) => ({ rows: sql === snap.LAW_REFRESH_SQLS.pin ? [{ newest: 300, pinned: 300 }] : LAW }) });
  ({ callHoldTool } = await import("../src/world-hold.mjs"));
  ({ leaveMarkViaOffice } = await import("../src/world.mjs"));
  ({ writeThingHolding } = await import("../src/world-units.mjs"));
  ({ appendActFlipped } = await import("../src/world-journal.mjs"));
  ({ currentCrossing } = await import("../src/crossings.mjs"));
}
after(async () => {
  for (const k of FLAGS) { if (saved[k] == null) delete process.env[k]; else process.env[k] = saved[k]; }
  resetLawSnapshot?.();
  if (!skip) (await import("../src/world2-pen.mjs")).__setPoolForTest(null);
  if (pool) await pool.end(); await store.stop();
});
const KEY = { household: "sbx-cy", handles: new Set(["sbx-cy"]) };
const owner = async (fn) => { const c = await store.connect("world2_owner"); try { return await fn(c); } finally { await c.end(); } };
async function seed() {
  await owner(async (c) => {
    await c.query("TRUNCATE acts, claims, marks, windows, settlements, households, household_pins CASCADE");
    await c.query("INSERT INTO windows (id,opens_at,closes_at,status) VALUES (300,now()-interval '1 day',now()+interval '1 day','open')");
  });
}
// THE REAL HOLD ACT for picking a thing up, by the hold lane's own writer (world-units § writeThingHolding)
const carry = (thing, who = "sbx-cy") => writeThingHolding({
  stamp: async () => ({ at: { anchor: null, dx: null, dy: null, unplaced: true }, witnesses: { source: "presence", list: [] } }),
  crossing: () => currentCrossing(), household: () => "sbx-cy",
  append: (e, opts = {}) => appendActFlipped(null, { ...e, writtenAt: new Date().toISOString() }, opts),
}, KEY, who, [], { did: "take", thing, holder: who, previous: null, madeBy: thing.split("/")[0] });
const unitActs = () => owner(async (c) => (await c.query("SELECT action, payload FROM acts WHERE action LIKE 'units:%' ORDER BY id")).rows);

test("B1 · a carried bag, 1 km from where it was made, is filled, taken from and given into — and a holder left where it was made is out of reach", { skip }, async () => {
  await seed();
  // not carried yet: the bag stands where it was made, 1 km west — the real reach refuses
  await assert.rejects(leaveMarkViaOffice(repo, { kind: "pocket-comet", count: 3, to: BAG }, KEY), (e) => e.code === 409 && /not standing where/.test(`${e.defect}`), "the canon place, judged by the thing door's own reach");
  assert.equal((await unitActs()).length, 0);
  await carry(BAG);
  const made = await leaveMarkViaOffice(repo, { kind: "pocket-comet", count: 3, to: BAG }, KEY);
  assert.deepEqual([made.did, made.count, made.holds.count], ["make", 3, 3], "in your hands is in reach, wherever you stand");
  const took = await callHoldTool("world_hold", { from: BAG, count: 1 }, KEY, { verb: "take" });
  assert.deepEqual([took.did, took.count], ["take", 1]);
  const gave = await callHoldTool("world_hold", { to: BAG, kind: "pocket-comet", count: 1 }, KEY, { verb: "give" });
  assert.equal(gave.did, "give");
  assert.equal(gave.receiver.count, 3);
  // and the far bowl, never carried, refuses by the reach with nothing written
  const before = (await unitActs()).length;
  await assert.rejects(callHoldTool("world_hold", { to: FAR_BOWL, kind: "pocket-comet", count: 1 }, KEY, { verb: "give" }), (e) => e.code === 409);
  assert.equal((await unitActs()).length, before);
});

test("S3 · a give to a resident at arm's length, and the refill of a bowl you carry, land through world_hold", { skip }, async () => {
  await seed();
  await carry(MY_BOWL);
  const refilled = await callHoldTool("world_hold", { act: "refill", thing: MY_BOWL, kind: "pocket-comet", count: 4 }, KEY, { verb: "refill" });
  assert.deepEqual([refilled.did, refilled.count, refilled.holds.count], ["refill", 4, 4]);
  await leaveMarkViaOffice(repo, { kind: "pocket-comet", count: 2, to: "sbx-cy" }, KEY);
  const gave = await callHoldTool("world_hold", { to: "sbx-dee", kind: "pocket-comet", count: 1 }, KEY, { verb: "give" });
  assert.deepEqual([gave.did, gave.to, gave.receiver.count], ["give", "sbx-dee", 1], "beside, by the walk ledger's own measure");
  const acts = await unitActs();
  assert.deepEqual(acts.map((a) => a.action), ["units:make", "units:make", "units:give"]);
  assert.equal(acts[0].payload.via, "refill");
});

test("S3 · through the apex: do: leave-mark { kind, count, to: <the bag you carry> } and do: take from it land, by the apex's own gate and dispatch", { skip }, async () => {
  await seed();
  await carry(BAG);
  // the class layer the apex's gate reads: the resident class grants these acts ambiently, as the town's own does
  const { publishWorldGraphForTest, resetWorldGraph } = await import("../src/world-graph-snapshot.mjs");
  const n = (id, subkind, props, extra = {}) => ({ id, kind: "mark", subkind, tier: "constitution", by: "the-town", at_x: 0, at_y: 0, extent_w: 100000, extent_h: 100000, props: JSON.stringify(props), ...extra });
  const actions = ["leave-mark", "take", "give", "refill"].map((action) => ({ action, residue: `the-town/${action}` }));
  publishWorldGraphForTest({ meta: [{ key: "hydration_status", value: "OK" }, { key: "as_of_world", value: "o2fixture" }],
    nodes: [n("the-town/let-there-be-light", "sited", { slug: "let-there-be-light", body: "Let there be light.", path: "WORLD/marks/let-there-be-light/mark.md" }),
      n("the-town/resident", "sited", { slug: "resident", class: "resident", class_version: 1, ambient: true, actions, body: "A household's living voice.",
        path: "WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/resident/mark.md" })],
    edges: [], events: [], geometryVersions: [], lintFindings: [] }, { label: "o2-apex" });
  process.env.WORLD_APEX = "1";
  try {
    const { worldApex } = await import("../src/world-apex.mjs");
    const made = await worldApex({ do: "leave-mark", args: { kind: "pocket-comet", count: 2, to: BAG } }, KEY);
    assert.equal(made.error, undefined, JSON.stringify(made).slice(0, 500));
    const took = await worldApex({ do: "take", args: { from: BAG, count: 1 } }, KEY);
    assert.equal(took.error, undefined, JSON.stringify(took).slice(0, 500));
    assert.deepEqual((await unitActs()).map((a) => a.action), ["units:make", "units:take"]);
  } finally { delete process.env.WORLD_APEX; resetWorldGraph?.(); }
});

test("S1 · what a resident holds by kind shows in world_holdings, a class and a number sharpened to kinds, never a unit", { skip }, async () => {
  await seed();
  await leaveMarkViaOffice(repo, { kind: "pocket-comet", count: 3, to: "sbx-cy" }, KEY);
  const h = await callHoldTool("world_holdings", {}, KEY);
  assert.equal(h.kinds.count, 3);
  assert.equal(h.kinds.shows, "3 pocket-comets");
  assert.deepEqual(h.kinds.kinds.map((k) => [k.kind, k.count]), [["pocket-comet", 3]]);
  assert.doesNotMatch(JSON.stringify(h.kinds), /\bpiece/i);
  const { kindsHeldBy } = await import("../src/world-kinds.mjs");
  assert.equal((await kindsHeldBy("sbx-dee")).count, 0, "someone who holds nothing reads empty, not unknown");
});

// the apex's class layer, as the town's resident class grants these acts ambiently
async function withApex(fn) {
  const { publishWorldGraphForTest, resetWorldGraph } = await import("../src/world-graph-snapshot.mjs");
  const n = (id, props) => ({ id, kind: "mark", subkind: "sited", tier: "constitution", by: "the-town", at_x: 0, at_y: 0, extent_w: 100000, extent_h: 100000, props: JSON.stringify(props) });
  const actions = ["leave-mark", "take", "give", "drop", "consume", "refill"].map((action) => ({ action, residue: `the-town/${action}` }));
  publishWorldGraphForTest({ meta: [{ key: "hydration_status", value: "OK" }, { key: "as_of_world", value: "o2fixture" }],
    nodes: [n("the-town/let-there-be-light", { slug: "let-there-be-light", body: "Let there be light.", path: "WORLD/marks/let-there-be-light/mark.md" }),
      n("the-town/resident", { slug: "resident", class: "resident", class_version: 1, ambient: true, actions, body: "A household's living voice.",
        path: "WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/resident/mark.md" })],
    edges: [], events: [], geometryVersions: [], lintFindings: [] }, { label: "o2-apex" });
  process.env.WORLD_APEX = "1";
  try { return await fn((await import("../src/world-apex.mjs")).worldApex); } finally { delete process.env.WORLD_APEX; resetWorldGraph?.(); }
}

test("S2 · the bare read's actions are trimmed by the matrix: with an empty carried bag, take hides and drop shows; investigate's can is the column", { skip }, async () => {
  await seed();
  await carry(BAG);
  await withApex(async (worldApex) => {
    const read = await worldApex({}, KEY);
    const acts = (read.actions ?? []).map((e) => e.action);
    assert.ok(acts.includes("drop"), `a whole thing in hand drops: ${acts}`);
    assert.ok(!acts.includes("take"), `nothing takeable in reach: take hides, though the resident class grants it (${acts})`);
    assert.ok(!acts.includes("consume") && !acts.includes("refill"), `${acts}`);
    assert.ok(acts.includes("leave-mark"), "the always-on roster passes untouched");
    // fill it: take shows (from the bag in your hands)
    await leaveMarkViaOffice(repo, { kind: "pocket-comet", count: 2, to: BAG }, KEY);
    const after = (await worldApex({}, KEY)).actions.map((e) => e.action);
    assert.ok(after.includes("take"), `${after}`);
    // the close look carries the column: the bag in your hands holds two, so take; nothing else in hand to give into it
    const look = await worldApex({ mark: BAG }, KEY);
    assert.deepEqual(look.focus?.can, ["take"], JSON.stringify(look.focus ?? look).slice(0, 400));
    assert.equal(look.focus?.holds?.count, 2, "and what it holds, sharpened to kinds");
    // investigate on a resident carries its column too (presence is off here, so no one is beside: an empty column, not an absent one)
    const dee = await worldApex({ investigate: "sbx-dee" }, KEY);
    assert.deepEqual(dee.investigated?.can, []);
  });
});

test("S2 · naming a whole mark a holder holds takes it out through the kind door (the hold door's redirect)", { skip }, async () => {
  await seed();
  await carry(BAG);
  await carry(LAMP);
  const into = await callHoldTool("world_hold", { thing: LAMP, to: BAG }, KEY, { verb: "give" });
  assert.deepEqual([into.did, into.to], ["give", BAG]);
  const out = await callHoldTool("world_hold", { thing: LAMP }, KEY, { verb: "take" });
  assert.deepEqual([out.did, out.from, out.holder], ["take", BAG, "sbx-cy"], "the redirect reached thing-from-holder for a v2 holder");
});

test("S5 · the hold record is folded once per change: two reads with no hold act between share one fold; a hold act refolds", { skip }, async () => {
  await seed();
  const { holdRecordNow } = await import("../src/world-kinds.mjs");
  await carry(BAG);
  const a = await holdRecordNow(), b = await holdRecordNow();
  assert.equal(a, b, "no hold act between: the same kept fold, no second scan");
  await leaveMarkViaOffice(repo, { kind: "pocket-comet", count: 2, to: BAG }, KEY);
  const c = await holdRecordNow();
  assert.notEqual(c, b, "the hold lane moved: refolded");
  assert.equal(c.fold.kinds.get(BAG).get("pocket-comet"), 2);
});

test("F2 · B2 driven: withdrawing a holder (not a chest) that holds something is refused; a thing its maker made portable: false is not taken through world_hold", { skip }, async () => {
  await seed();
  await carry(MY_BOWL);
  await leaveMarkViaOffice(repo, { kind: "pocket-comet", count: 2, to: MY_BOWL }, KEY);
  const { journalWithdraw } = await import("../src/world.mjs");
  await assert.rejects(journalWithdraw({ by: "sbx-cy", slug: "my-bowl", household: "sbx-cy" }), (e) => e.code === 409 && /still holds 2 units/.test(e.defect),
    "a Candy Bowl is a holder by its holder property: withdrawn only when empty");
  await assert.rejects(callHoldTool("world_hold", { thing: STONE }, KEY, { verb: "take" }), (e) => e.code === 409 && /fixed where it stands/.test(e.defect),
    "thing/portable false: not carried");
  const took = await callHoldTool("world_hold", { thing: PEBBLE }, KEY, { verb: "take" });
  assert.equal(took.did, "take", "a portable thing in reach is taken (the refusal is the property's, not the reach's)");
});

test("F3 · a set-down holder is judged where it was set down: carried 1 km and set down, it is filled where it now stands", { skip }, async () => {
  await seed();
  await carry(BAG);
  const dropped = await callHoldTool("world_hold", { thing: BAG }, KEY, { verb: "drop" });
  assert.equal(dropped.did, "drop");
  const made = await leaveMarkViaOffice(repo, { kind: "pocket-comet", count: 2, to: BAG }, KEY);
  assert.equal(made.holds.count, 2, "not carried, and made 1 km off: in reach at its drop point");
});

test("round 4 · the production keeper re-bases from one full read when the clock crosses into the next settlement (its readEpoch is the crossings seam)", { skip }, async (t) => {
  await seed();
  const { holdRecordNow, holdRecordStats } = await import("../src/world-kinds.mjs");
  const { currentCrossing } = await import("../src/crossings.mjs");
  await carry(BAG);
  await holdRecordNow();
  const before = await holdRecordStats();
  assert.equal(before.epoch, currentCrossing(), "the keeper stands in the crossing the office counts by");
  await holdRecordNow();
  assert.equal((await holdRecordStats()).fullReads, before.fullReads, "the same settlement, no change: no full read");
  // the clock moves through the crossings seam into the next settlement window
  const real = Date.now();
  let ahead = real;
  while (currentCrossing(ahead) === before.epoch) ahead += 60 * 60 * 1000;
  t.mock.method(Date, "now", () => ahead);
  await holdRecordNow();
  const after = await holdRecordStats();
  assert.equal(after.epoch, currentCrossing(ahead), "the next settlement's crossing");
  assert.equal(after.fullReads, before.fullReads + 1, "one full read re-bases the record in the new settlement");
});
