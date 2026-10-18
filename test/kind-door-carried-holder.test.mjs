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
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { NO_WORLD, worldClone } from "./fixture-paths.mjs";
import { startStore } from "./helpers/embedded-store.mjs";
import { markRecord } from "../src/mark-record.mjs";

const WORLD = worldClone();
const store = await startStore({ db: "kind_door_carried_holder" });
const skip = store.skip ?? ((!WORLD && NO_WORLD) || false);
const BAG = "sbx-cy/my-bag", MY_BOWL = "sbx-cy/my-bowl", FAR_BOWL = "sbx-ana/the-bowl", LAMP = "sbx-cy/a-lamp", STONE = "sbx-ana/a-stone", PEBBLE = "sbx-ana/a-pebble";
// A PORTABLE HOLDER AT CY'S FEET (plumb-nest-guard): the take that would put a second holder in her hands
const BASKET = "sbx-ana/a-basket";
// THE SET-OUT BOWLS under cy's feet (the playground's QA, PART2-MCP-QA fail 4): ana's, open, and cy's own
const ANA_DOOR_BOWL = "sbx-ana/a-door-bowl", CY_DOOR_BOWL = "sbx-cy/a-door-bowl";
// A RESIDENT'S OWN HOLDER (QA fail 2): a thing cy made with holder: true, published by the world's REAL fold
const POUCH = "sbx-cy/a-small-pouch";
// END TO END ON THE WORLD'S OWN LAW: a world that carries part 2's class tree (W1 and after). The
// pinned pre-W1 world has no consumable class and no resident holding word to carry, so it says so.
const KEEPING = "WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-node";
const PART2_WORLD = Boolean(WORLD) && existsSync(join(WORLD, KEEPING, "mark/thing/consumable/mark.md"));
const notPart2 = PART2_WORLD ? false : "the world clone predates LOGOS v2 part 2 (no the-town/consumable): its law has nothing of part 2 to drive";
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
  prop("resident", "holders", 1, "constitution", "holder"), // one holder in hand (Darko 2026-10-17 23:29)
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
    { rec: { id: PEBBLE, by: "sbx-ana", slug: "a-pebble", kind: "sited", class: "thing", at: { x: 1010, y: 10 }, extent: { w: 2, h: 2 } }, body: "A pebble." },
    { rec: { id: BASKET, by: "sbx-ana", slug: "a-basket", kind: "sited", class: "halloween-candy-bag", at: { x: 1010, y: 10 }, extent: { w: 2, h: 2 } }, body: "A basket left by the path." },
    { rec: { id: ANA_DOOR_BOWL, by: "sbx-ana", slug: "a-door-bowl", kind: "sited", class: "halloween-candy-bowl", portable: false, at: { x: 1010, y: 10 }, extent: { w: 2, h: 2 } }, body: "A carved pumpkin bowl by ana's door." },
    { rec: { id: CY_DOOR_BOWL, by: "sbx-cy", slug: "a-door-bowl", kind: "sited", class: "halloween-candy-bowl", portable: false, at: { x: 1010, y: 10 }, extent: { w: 2, h: 2 } }, body: "A carved pumpkin bowl by cy's door." }];
  put("WORLD/marks/let-there-be-light/mark.md", markRecord(root, "Synthetic world frame."));
  for (const m of ms) put(`WORLD/marks/${m.rec.id}/mark.md`, markRecord(m.rec, m.body));
  // THE POUCH IS PUBLISHED BY THE WORLD'S OWN FOLD (QA fail 2): its file is written, read back through the
  // clone's parseRecord (no boolean case: holder arrives as "true"), and folded by the clone's fold, so
  // world-state.json carries exactly what that fold publishes, as the door reads it at the box
  const pouch = { id: POUCH, by: "sbx-cy", slug: "a-small-pouch", kind: "sited", class: "thing", holder: true, capacity: 10, at: { x: 10, y: 10 }, extent: { w: 1, h: 1 } };
  put(`WORLD/marks/${POUCH}/mark.md`, markRecord(pouch, "A small leather pouch."));
  let published = pouch;
  if (PART2_WORLD) {
    const { fold, parseRecord } = await import(pathToFileURL(join(WORLD, "tools", "marks-fold.mjs")).href);
    const read = (id, file) => ({ ...parseRecord(readFileSync(join(repo, file), "utf8"), file), id, household: id.split("/")[0] });
    const folded = fold({ marks: [read(root.id, "WORLD/marks/let-there-be-light/mark.md"), read(POUCH, `WORLD/marks/${POUCH}/mark.md`)], terrain: { features: [] }, stakes: [], tick: 1 });
    published = folded.marks.find((m) => m.id === POUCH);
  }
  put("WORLD/world-state.json", JSON.stringify({ tick: 0, dials: {}, marks: [root, ...ms.map((m) => m.rec), published] }));
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
const KEY_DEE = { household: "sbx-dee", handles: new Set(["sbx-dee"]) };
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
async function withApex(fn, { verbs = ["leave-mark", "take", "give", "drop", "consume", "refill"], classes = [] } = {}) {
  const { publishWorldGraphForTest, resetWorldGraph } = await import("../src/world-graph-snapshot.mjs");
  const n = (id, props) => ({ id, kind: "mark", subkind: "sited", tier: "constitution", by: "the-town", at_x: 0, at_y: 0, extent_w: 100000, extent_h: 100000, props: JSON.stringify(props) });
  const actions = verbs.map((action) => ({ action, residue: `the-town/${action}` }));
  publishWorldGraphForTest({ meta: [{ key: "hydration_status", value: "OK" }, { key: "as_of_world", value: "o2fixture" }],
    nodes: [n("the-town/let-there-be-light", { slug: "let-there-be-light", body: "Let there be light.", path: "WORLD/marks/let-there-be-light/mark.md" }),
      n("the-town/resident", { slug: "resident", class: "resident", class_version: 1, ambient: true, actions, body: "A household's living voice.",
        path: "WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/resident/mark.md" }),
      // a class node the Keeping Works declares stands nowhere: no place, no extent
      ...classes.map((c) => ({ ...n(c.id, c.props), at_x: null, at_y: null, extent_w: null, extent_h: null }))],
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
    // the pebble under cy's feet is in reach, and its door admits the take (F2 below): take shows for it, not for the empty bag
    assert.ok(acts.includes("take"), `the pebble at your feet is takeable (${acts})`);
    assert.deepEqual((await worldApex({ mark: BAG }, KEY)).focus?.can, [], "the empty bag in your hands: nothing to take from it, nothing else in hand to give into it");
    assert.ok(!acts.includes("consume"), `${acts}`);
    assert.ok(acts.includes("leave-mark"), "the always-on roster passes untouched");
    // fill it: take shows on the bag (from the bag in your hands)
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

// ── THE PLAYGROUND'S QA (Starstory docs/2026-10-18/w43-ship/PART2-MCP-QA.md), driven here ──────────────
//
// R4, R10 and K2 (fail 4): standing ON a set-out bowl, the bowl is in your spine (`within`), not among
// what the eyes see (`nearby`), and the matrix was handed `nearby` alone. So a take from and a give into
// an open bowl, and its maker's refill, all landed at their doors while the bare read and the close look
// hid them. H1 (fail 4): a refusal's "From here you can" listed the UNTRIMMED grants, so refill was
// offered to a resident who made no bowl. R8/R9 (fail 5): the v2 read's `you.holding` left counted kinds out.

test("QA fail 4 · standing on a set-out bowl: the bare read, the close look's can and the doors are one reader", { skip }, async () => {
  await seed();
  await withApex(async (worldApex) => {
    await leaveMarkViaOffice(repo, { kind: "pocket-comet", count: 3, to: "sbx-cy" }, KEY);
    const into = await callHoldTool("world_hold", { to: ANA_DOOR_BOWL, kind: "pocket-comet", count: 1 }, KEY, { verb: "give" });
    assert.equal(into.did, "give", "the door admits a give into ana's open bowl under cy's feet");
    const read = await worldApex({}, KEY);
    assert.ok((read.within ?? []).some((m) => m.id === ANA_DOOR_BOWL), `the bowl is under cy's feet, in her spine: ${(read.within ?? []).map((m) => m.id)}`);
    assert.ok(!(read.nearby ?? []).some((o) => o.id === ANA_DOOR_BOWL), "and not among what the eyes see (the case the matrix missed)");
    const acts = read.actions.map((e) => e.action);
    for (const v of ["take", "give", "refill"]) assert.ok(acts.includes(v), `${v} is admitted here, so it shows (${acts})`);
    // the close look's column, one bowl at a time
    assert.deepEqual((await worldApex({ mark: ANA_DOOR_BOWL }, KEY)).focus?.can, ["take", "give"], "ana's open bowl: take from it and give into it; not cy's to refill");
    assert.deepEqual((await worldApex({ mark: CY_DOOR_BOWL }, KEY)).focus?.can, ["give", "refill"], "cy's own empty bowl: give into it and refill it; nothing in it to take");
    // and each verb shown lands at its door
    const took = await callHoldTool("world_hold", { from: ANA_DOOR_BOWL, count: 1 }, KEY, { verb: "take" });
    assert.equal(took.did, "take");
    const refilled = await callHoldTool("world_hold", { act: "refill", thing: CY_DOOR_BOWL, kind: "pocket-comet", count: 2 }, KEY, { verb: "refill" });
    assert.equal(refilled.did, "refill");
    assert.deepEqual((await worldApex({ mark: CY_DOOR_BOWL }, KEY)).focus?.can, ["take", "give", "refill"], "refilled, it holds two: take shows too");
  });
});

test("QA fail 4 · a refusal's \"From here you can\" is the bare read's own trimmed list: no refill offered to a resident who made no bowl", { skip }, async () => {
  await seed();
  // the resident class grants refill (and every hold verb but consume) ambiently, so only the matrix can hide it
  await withApex(async (worldApex) => {
    const read = await worldApex({}, KEY_DEE);
    const shown = read.actions.map((e) => e.action);
    assert.ok(!shown.includes("refill"), `dee made no bowl: the bare read hides refill (${shown})`);
    const refused = await worldApex({ do: "consume", args: { kind: "pocket-comet" } }, KEY_DEE);
    assert.ok(refused.error, "consume is granted by no class here, so the gate refuses it");
    assert.deepEqual(refused.affordable_here, shown, "the refusal lists exactly what the bare read shows");
    assert.doesNotMatch(String(refused.hint), /\brefill\b/, `the hint offers no refill: ${refused.hint}`);
  }, { verbs: ["leave-mark", "take", "give", "drop", "refill"] });
});

test("QA I1 · refill from a step away names where it is used (on, or carrying, a bowl you made), never a class node's (null, null)", { skip }, async () => {
  await seed();
  const bowlClass = { id: "the-town/halloween-candy-bowl", props: { slug: "halloween-candy-bowl", class: "halloween-candy-bowl", class_version: 1, body: "A Halloween Candy Bowl is a thing that holds.",
    actions: [{ action: "refill", who: "maker", from: "reach", effect: "leave-mark { kind, count, to: this bowl }", residue: "the-town/leave-mark" }],
    path: "WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-node/mark/thing/halloween-candy-bowl/mark.md" } };
  await withApex(async (worldApex) => {
    const r = await worldApex({ do: "refill", args: { thing: MY_BOWL, kind: "pocket-comet", count: 1 } }, KEY);
    assert.ok(r.error, JSON.stringify(r).slice(0, 300));
    assert.doesNotMatch(String(r.hint), /null, null|walk there/, `no direction to a class node with no place: ${r.hint}`);
    assert.match(String(r.hint), /halloween-candy-bowl/);
    assert.match(String(r.hint), /footprint/, "say where it is used: standing within the bowl");
    assert.match(String(r.hint), /its maker/, "and whose it is: the bowl's maker's");
  }, { verbs: ["leave-mark", "take", "give"], classes: [bowlClass] });
});

test("QA fail 5 · the v2 read's you.holding carries what you hold by kind, beside your whole things", { skip }, async () => {
  await seed();
  await carry(BAG);
  await leaveMarkViaOffice(repo, { kind: "pocket-comet", count: 3, to: "sbx-cy" }, KEY);
  await withApex(async (worldApex) => {
    const v2 = await worldApex({ read_shape: "v2" }, KEY);
    const holding = v2.you?.holding;
    assert.ok(Array.isArray(holding), JSON.stringify(v2).slice(0, 400));
    assert.ok(holding.includes(BAG), `the whole bag: ${JSON.stringify(holding)}`);
    const kinds = holding.filter((h) => typeof h === "object");
    assert.deepEqual(kinds.map((k) => [k.kind, k.count]), [["pocket-comet", 3]], `the three pocket comets, a kind and a number: ${JSON.stringify(holding)}`);
    assert.equal(kinds[0].shows, "3 pocket-comets");
  });
});

test("QA H1 · the office side of consume is ready: with the resident class granting it, consume shows only with a consumable in hand and lands through the apex", { skip }, async () => {
  await seed();
  await withApex(async (worldApex) => {
    assert.ok(!(await worldApex({}, KEY)).actions.some((e) => e.action === "consume"), "nothing consumable in hand: hidden");
    await leaveMarkViaOffice(repo, { kind: "pocket-comet", count: 2, to: "sbx-cy" }, KEY);
    assert.ok((await worldApex({}, KEY)).actions.some((e) => e.action === "consume"), "a pocket comet in hand: shown");
    const ate = await worldApex({ do: "consume", args: { kind: "pocket-comet" } }, KEY);
    assert.equal(ate.error, undefined, JSON.stringify(ate).slice(0, 400));
    assert.deepEqual((await unitActs()).map((a) => a.action), ["units:make", "units:consume"]);
  });
});

test("QA fail 2 · end to end: a resident's own holder:true thing, published by the world's own fold, holds", { skip: skip || notPart2 }, async () => {
  await seed();
  await carry(POUCH);
  const made = await leaveMarkViaOffice(repo, { kind: "pocket-comet", count: 3, to: POUCH }, KEY);
  assert.deepEqual([made.did, made.count, made.holds.count], ["make", 3, 3], "the pouch's own holder: true, read off the published fold");
  const took = await callHoldTool("world_hold", { from: POUCH, count: 1 }, KEY, { verb: "take" });
  assert.equal(took.did, "take");
  await assert.rejects(leaveMarkViaOffice(repo, { kind: "pocket-comet", count: 9, to: POUCH }, KEY), (e) => e.code === 409 && /room for 8, not 9/.test(String(e.defect)), "its own capacity, 10, governs");
});

test("QA fail 1 · end to end: the world's own resident class grants consume, and it lands through the apex", { skip: skip || notPart2 }, async () => {
  await seed();
  const { parseRecord } = await import(pathToFileURL(join(WORLD, "tools", "marks-fold.mjs")).href);
  const file = join(WORLD, KEEPING, "entity/resident/mark.md");
  const verbs = (parseRecord(readFileSync(file, "utf8"), file).actions ?? []).map((a) => a.action);
  assert.ok(verbs.includes("take") && verbs.includes("give"), `the resident class's grants were read: ${verbs}`);
  await leaveMarkViaOffice(repo, { kind: "pocket-comet", count: 2, to: "sbx-cy" }, KEY);
  await withApex(async (worldApex) => {
    const ate = await worldApex({ do: "consume", args: { kind: "pocket-comet" } }, KEY);
    assert.equal(ate.error, undefined, `consume through the apex on the world's own grants (${verbs}): ${JSON.stringify(ate).slice(0, 300)}`);
    assert.deepEqual((await unitActs()).map((a) => a.action), ["units:make", "units:consume"]);
  }, { verbs });
});

// ── ONE HOLDER IN HAND, through the real hold door (plumb-nest-guard; Darko 2026-10-17 23:29) ──
test("one holder · carrying a bag, a take of a basket at your feet is refused in the full-hands voice; with empty hands it lands", { skip }, async () => {
  await seed();
  await carry(BAG);
  await assert.rejects(callHoldTool("world_hold", { thing: BASKET }, KEY, { verb: "take" }),
    (e) => e.code === 409 && e.defect === `you're already carrying a holder (${BAG})` && e.hint === "set it down first. Nothing was recorded.");
  await seed();
  const took = await callHoldTool("world_hold", { thing: BASKET }, KEY, { verb: "take" });
  assert.deepEqual([took.did, took.holder], ["take", "sbx-cy"]);
});

test("one holder · a give of a bag to a resident who carries a bowl is refused, naming them; to one who carries none it lands", { skip }, async () => {
  await seed();
  await carry(BAG);
  await carry(MY_BOWL, "sbx-dee");
  await assert.rejects(callHoldTool("world_hold", { thing: BAG, to: "sbx-dee" }, KEY, { verb: "give" }),
    (e) => e.code === 409 && e.defect === `sbx-dee is already carrying a holder (${MY_BOWL})`);
  await seed();
  await carry(BAG);
  const gave = await callHoldTool("world_hold", { thing: BAG, to: "sbx-dee" }, KEY, { verb: "give" });
  assert.deepEqual([gave.did, gave.holder ?? gave.to], ["give", "sbx-dee"]);
});
