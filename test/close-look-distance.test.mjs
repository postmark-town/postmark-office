// close-look-distance.test.mjs — WLD-79: the close look says how far, and a focused mark always gets its `can`.
//
// Darko, 2026-10-19 18:49 EDT: "(b), 60 m, one rule for give and take." A take reaches 60 m, the refusal
// teaches the fix (POS-806, test/hold-reach.test.mjs), and the close look shows the distance up front,
// in the refusal's own words ("140 m NE"), so the two reads match.
//
// Driven through the real apex over a throwaway world, the way test/kind-door-carried-holder.test.mjs
// stands one: cy stands at (1010, 10), and the marks lie east of her at measured distances. A ring of
// fourteen big things stands 45 m around her, so the glance's twelve go to them and the small lamps are
// NOT among what the eyes see (the first test pins that premise, then reads the close look anyway).

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { NO_WORLD, worldClone } from "./fixture-paths.mjs";
import { startStore } from "./helpers/embedded-store.mjs";
import { markRecord } from "../src/mark-record.mjs";

const WORLD = worldClone();
const store = await startStore({ db: "close_look_distance" });
const skip = store.skip ?? ((!WORLD && NO_WORLD) || false);
const HOME = { x: 1010, y: 10 };
const BANDS = [10, 59, 60, 61];
const lampAt = (d) => `sbx-ana/lamp-${d}`;
const NORTH_LAMP = "sbx-ana/lamp-north-40"; // 40 m straight north (y is south in the world's grid)
const CROWD = Array.from({ length: 14 }, (_, i) => `sbx-ana/big-${i}`);
// bo stands 2 km east of cy beside a dungeon: a keep, its hall, and a lamp in the hall 25 m south of her (WLD-74's shape: test/dungeon-reach.test.mjs)
const BO = { x: 3010, y: 10 };
const KEEP = "sbx-fort/the-keep", HALL = "sbx-fort/the-hall", HALL_LAMP = "sbx-fort/the-hall-lamp";
// cat stands 1 km further east in the open, with fourteen things that cannot be carried around her and one lamp 10 m east the glance drops
const CAT = { x: 4010, y: 10 };
const CAT_LAMP = "sbx-ana/cat-lamp";
const CAT_CROWD = Array.from({ length: 14 }, (_, i) => `sbx-ana/cat-big-${i}`);
const repo = mkdtempSync(join(tmpdir(), "wld79-"));
const put = (p, content) => { const f = join(repo, p); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, content); };
const FLAGS = ["WORLD2_PG", "WORLD2_PG_URL", "W2_PEN", "W2_GUARDS", "WORLD_CLONE", "WORLD_SINGLE_LOG", "WORLD_POOL", "TOWN_CLONE"];
const NO_TOWN = mkdtempSync(join(tmpdir(), "wld79-no-town-"));
const saved = Object.fromEntries(FLAGS.map((k) => [k, process.env[k]]));
let pool, callHoldTool, resetLawSnapshot;

const SHA = "e".repeat(40);
const cls = (key, data = {}) => ({ number: 300, tag_sha: SHA, newest: 300, kind: "class", key, data: { class: key, ...data } });
const prop = (klass, name, dflt, tier, parent = null) => ({ number: 300, tag_sha: SHA, newest: 300, kind: "property",
  key: `${klass}/${name}`, data: { class: klass, parent, name, tier, default: dflt, id: `the-town/${klass}-${name}` } });
const LAW = [
  cls("postmark-node"), cls("mark", { extends: "postmark-node" }), cls("sited", { extends: "mark" }), cls("thing", { extends: "sited" }),
  cls("entity", { extends: "postmark-node" }), cls("resident", { extends: "entity" }),
  prop("postmark-node", "makers", false, "constitution"), prop("thing", "makers", true, "constitution"),
  prop("resident", "holder", true, "constitution"), prop("resident", "capacity", 24, "constitution", "holder"),
  prop("thing", "holder", false, "sovereign"), prop("thing", "capacity", 30, "sovereign", "holder"),
  prop("thing", "min", 1, "constitution", "capacity"), prop("thing", "max", 120, "constitution", "capacity"),
  prop("thing", "open", true, "sovereign", "holder"), prop("thing", "portable", true, "sovereign"),
];

if (!skip) {
  mkdirSync(join(repo, "tools"), { recursive: true });
  for (const f of readdirSync(join(WORLD, "tools")).filter((f) => f.endsWith(".mjs") && !f.endsWith(".test.mjs")))
    copyFileSync(join(WORLD, "tools", f), join(repo, "tools", f));
  put("tools/where-is.mjs", `
export const NOWHERE = Object.freeze({ x: null, y: null, placed: false, source: null, mark_id: null });
export const QUAY_MARK_ID = "the-town/the-quay";
const HOMES = { "sbx-cy": { x: ${HOME.x}, y: ${HOME.y} }, "sbx-bo": { x: ${BO.x}, y: ${BO.y} }, "sbx-cat": { x: ${CAT.x}, y: ${CAT.y} } };
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
  const thing = (id, at, extent, extra = {}) => ({ rec: { id, by: id.split("/")[0], slug: id.split("/")[1], kind: "sited", class: "thing", at, extent, ...extra }, body: `A thing, ${id}.` });
  const ring = (ids, c, extra) => ids.map((id, i) => thing(id, { x: Math.round(c.x + 45 * Math.cos((i / 14) * 2 * Math.PI + 0.3)), y: Math.round(c.y + 45 * Math.sin((i / 14) * 2 * Math.PI + 0.3)) }, { w: 20, h: 20 }, extra));
  const ms = [
    ...BANDS.map((d) => thing(lampAt(d), { x: HOME.x + d, y: HOME.y }, { w: 1, h: 1 })),
    thing(NORTH_LAMP, { x: HOME.x, y: HOME.y - 40 }, { w: 1, h: 1 }),
    // the crowd: fourteen big things on a 45 m ring, each far larger to the eye than any lamp
    ...CROWD.map((id, i) => thing(id, { x: Math.round(HOME.x + 45 * Math.cos((i / 14) * 2 * Math.PI + 0.3)), y: Math.round(HOME.y + 45 * Math.sin((i / 14) * 2 * Math.PI + 0.3)) }, { w: 20, h: 20 })),
    { rec: { id: "sbx-cy/home", by: "sbx-cy", slug: "home", kind: "parcel", at: HOME, extent: { w: 25, h: 25 } }, body: "cy's home ground." },
    { rec: { id: "sbx-bo/home", by: "sbx-bo", slug: "home", kind: "parcel", at: BO, extent: { w: 25, h: 25 } }, body: "bo's home ground." },
    { rec: { id: KEEP, by: "sbx-fort", slug: "the-keep", kind: "dungeon", at: { x: BO.x, y: BO.y + 25 }, extent: { w: 20, h: 20 } }, body: "A small keep." },
    { rec: { id: HALL, by: "sbx-fort", slug: "the-hall", kind: "sited", at: { x: BO.x, y: BO.y + 25 }, extent: { w: 16, h: 16 } }, body: "Its hall." },
    thing(HALL_LAMP, { x: BO.x, y: BO.y + 25 }, { w: 1, h: 1 }),
    { rec: { id: "sbx-cat/home", by: "sbx-cat", slug: "home", kind: "parcel", at: CAT, extent: { w: 25, h: 25 } }, body: "cat's home ground." },
    thing(CAT_LAMP, { x: CAT.x + 10, y: CAT.y }, { w: 1, h: 1 }),
    ...ring(CAT_CROWD, CAT, { portable: false }),
  ];
  put("WORLD/marks/let-there-be-light/mark.md", markRecord(root, "Synthetic world frame."));
  for (const m of ms) put(`WORLD/marks/${m.rec.id}/mark.md`, markRecord(m.rec, m.body));
  put("WORLD/world-state.json", JSON.stringify({ tick: 0, dials: {}, marks: [root, ...ms.map((m) => m.rec)] }));
  copyFileSync(join(WORLD, "WORLD", "skeleton.json"), join(repo, "WORLD", "skeleton.json"));
  execFileSync("git", ["init", "-q", "-b", "main", repo]);
  execFileSync("git", ["-C", repo, "add", "-A", "WORLD", "tools"]);
  execFileSync("git", ["-C", repo, "-c", "user.name=fixture", "-c", "user.email=fixture@test.invalid", "commit", "-qm", "synthetic canon"]);
  const { default: pg } = await import("pg");
  pool = new pg.Pool({ connectionString: store.url("office_api") });
  Object.assign(process.env, { WORLD_CLONE: repo, WORLD_SINGLE_LOG: "", WORLD_POOL: "0", WORLD2_PG: "1", WORLD2_PG_URL: store.url("office_api"), W2_PEN: "hold", W2_GUARDS: "1", TOWN_CLONE: NO_TOWN });
  (await import("../src/world2-pen.mjs")).__setPoolForTest(pool);
  const snap = await import("../src/law-snapshot.mjs");
  resetLawSnapshot = snap.resetLawSnapshot;
  await snap.reloadLawSnapshot({ force: true, query: async (sql) => ({ rows: sql === snap.LAW_REFRESH_SQLS.pin ? [{ newest: 300, pinned: 300 }] : LAW }) });
  ({ callHoldTool } = await import("../src/world-hold.mjs"));
}
after(async () => {
  for (const k of FLAGS) { if (saved[k] == null) delete process.env[k]; else process.env[k] = saved[k]; }
  resetLawSnapshot?.();
  if (!skip) (await import("../src/world2-pen.mjs")).__setPoolForTest(null);
  if (pool) await pool.end(); await store.stop();
  rmSync(NO_TOWN, { recursive: true, force: true });
});
const KEY = { household: "sbx-cy", handles: new Set(["sbx-cy"]) };
async function seed() {
  const c = await store.connect("world2_owner");
  try {
    await c.query("TRUNCATE acts, claims, marks, windows, settlements, households, household_pins CASCADE");
    await c.query("INSERT INTO windows (id,opens_at,closes_at,status) VALUES (300,now()-interval '1 day',now()+interval '1 day','open')");
  } finally { await c.end(); }
}
// the apex's class layer, as the town's resident class grants these acts ambiently (the same stand as kind-door-carried-holder)
async function withApex(fn) {
  const { publishWorldGraphForTest, resetWorldGraph } = await import("../src/world-graph-snapshot.mjs");
  const n = (id, props) => ({ id, kind: "mark", subkind: "sited", tier: "constitution", by: "the-town", at_x: 0, at_y: 0, extent_w: 100000, extent_h: 100000, props: JSON.stringify(props) });
  const actions = ["leave-mark", "take", "give", "drop"].map((action) => ({ action, residue: `the-town/${action}` }));
  publishWorldGraphForTest({ meta: [{ key: "hydration_status", value: "OK" }, { key: "as_of_world", value: "wld79fixture" }],
    nodes: [n("the-town/let-there-be-light", { slug: "let-there-be-light", body: "Let there be light.", path: "WORLD/marks/let-there-be-light/mark.md" }),
      n("the-town/resident", { slug: "resident", class: "resident", class_version: 1, ambient: true, actions, body: "A household's living voice.",
        path: "WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/resident/mark.md" })],
    edges: [], events: [], geometryVersions: [], lintFindings: [] }, { label: "wld79-apex" });
  process.env.WORLD_APEX = "1";
  try { return await fn((await import("../src/world-apex.mjs")).worldApex); } finally { delete process.env.WORLD_APEX; resetWorldGraph?.(); }
}

test("WLD-79 · a mark the glance dropped still gets its `can`: a lamp 10 m away, outside the eyes' twelve, lists take", { skip }, async () => {
  await seed();
  await withApex(async (worldApex) => {
    const read = await worldApex({}, KEY);
    const seen = (read.nearby ?? []).map((o) => o.id);
    // THE PREMISE, measured: the crowd filled the eyes' cap and the 10 m lamp is not among what the eyes see
    assert.ok(!seen.includes(lampAt(10)), `the 10 m lamp is outside the glance (premise): ${seen}`);
    assert.ok(seen.length >= 12 && CROWD.filter((id) => seen.includes(id)).length >= 12, `the glance is full of the crowd (control that the eyes read): ${seen}`);
    const look = await worldApex({ mark: lampAt(10) }, KEY);
    assert.deepEqual(look.focus?.can, ["take"], `the close look carries its column although the eyes dropped it: ${JSON.stringify(look.focus ?? look).slice(0, 400)}`);
    // v2: the focus answered alone reads the eyes for its verbs too, and gets the same column
    const alone = await worldApex({ mark: lampAt(10), read_shape: "v2" }, KEY);
    assert.deepEqual(alone.focus?.can, ["take"], "v2's focus alone: the same column");
  });
});

test("WLD-79 · the close look shows the distance in the refusal's own words, and the refusal says the same", { skip }, async () => {
  await seed();
  await withApex(async (worldApex) => {
    const d10 = await worldApex({ mark: lampAt(10) }, KEY);
    assert.equal(d10.focus?.distance, "10 m E", "ten metres, due east: meters then the compass point");
    const north = await worldApex({ mark: NORTH_LAMP }, KEY);
    assert.equal(north.focus?.distance, "40 m N", "y is south in the world's grid, so a lamp at y-40 lies north");
    assert.equal((await worldApex({ mark: lampAt(61), read_shape: "v2" }, KEY)).focus?.distance, "61 m E", "v2's focus alone carries it too");
    // the refusal that follows names the same words (POS-806: `<id> stands <m> m <point> of you; walk …`)
    await assert.rejects(callHoldTool("world_hold", { thing: lampAt(61) }, KEY, { verb: "take" }),
      (e) => e.code === 409 && `${e.defect}`.includes(`${lampAt(61)} stands 61 m E of you`), "61 m: the take is refused in the same words the close look used");
  });
});

test("WLD-79 · the 60 m band through the real reach: take is listed at 10, 59 and 60 m, absent at 61 m, and the door agrees at each", { skip }, async () => {
  await seed();
  await withApex(async (worldApex) => {
    const seen = {};
    for (const d of BANDS) seen[d] = (await worldApex({ mark: lampAt(d) }, KEY)).focus?.can;
    assert.deepEqual(seen, { 10: ["take"], 59: ["take"], 60: ["take"], 61: [] });
    // and the door admits the one the close look listed at the edge, and refuses the one it did not
    const took = await callHoldTool("world_hold", { thing: lampAt(60) }, KEY, { verb: "take" });
    assert.equal(took.did, "take", "60 m: in reach, the door takes it");
    await assert.rejects(callHoldTool("world_hold", { thing: lampAt(61) }, KEY, { verb: "take" }), (e) => e.code === 409);
  });
});

test("WLD-79 · a mark that stands nowhere on the world gets no distance (not a 0 m)", { skip }, async () => {
  await seed();
  await withApex(async (worldApex) => {
    const none = await worldApex({ mark: "sbx-ana/no-such-lamp" }, KEY);
    assert.equal(none.focus?.distance, undefined, `an unknown mark has no distance: ${JSON.stringify(none.focus ?? none).slice(0, 300)}`);
  });
});

test("WLD-79 · a thing in your own hands has no place, so its close look shows no distance (and not a 0 m)", { skip }, async () => {
  await seed();
  await withApex(async (worldApex) => {
    assert.equal((await worldApex({ mark: lampAt(10) }, KEY)).focus?.distance, "10 m E", "control: set down 10 m away, it has one");
    const took = await callHoldTool("world_hold", { thing: lampAt(10) }, KEY, { verb: "take" });
    assert.equal(took.did, "take", "the lamp is in cy's hands");
    const held = await worldApex({ mark: lampAt(10) }, KEY);
    assert.ok(held.focus && !held.focus.error, `the look itself stands (control that it was read): ${JSON.stringify(held.focus ?? held).slice(0, 300)}`);
    assert.equal(held.focus.distance, undefined, `in hands: no distance, ${JSON.stringify(held.focus.distance)}`);
  });
});

// ── THE SIGHT RULE (Truey, PR 934, 8f98a203d): the focus joins the matrix only where the one sight function lets the reader reach it ──
//
// The eyes are sight-filtered and a focused id is not, so a bare read with mark: set to a thing in a dungeon room the reader has not
// entered must not add a `take` the door refuses (WLD-74, world.mjs § reachableBy), nor hint that the room's lamp is there.
// The fixture is test/dungeon-reach.test.mjs's shape: bo stands 25 m from a lamp in a hall of a keep. Nothing else is takeable near her,
// so `actions` carries `take` only if the lamp reached the matrix.
const KEY_BO = { household: "sbx-bo", handles: new Set(["sbx-bo"]) };
const KEY_CAT = { household: "sbx-cat", handles: new Set(["sbx-cat"]) };
const takes = (read) => (read.actions ?? []).some((e) => e.action === "take");

test("WLD-79 · a focused lamp in a dungeon room the reader has not entered adds no take; one who entered the room gets it", { skip }, async () => {
  const { __setOccupancyForTest } = await import("../src/creature-sight.mjs");
  await seed();
  try {
    await withApex(async (worldApex) => {
      __setOccupancyForTest(() => new Map());
      const outside = await worldApex({ mark: HALL_LAMP }, KEY_BO);
      assert.equal(takes(outside), false, `outside the hall: no take, and no hint the lamp is there (${(outside.actions ?? []).map((e) => e.action)})`);
      assert.equal(takes(await worldApex({}, KEY_BO)), false, "and the bare read without a focus has none either (control: nothing else of hers is takeable)");
      // the control: one who entered the hall reaches its lamp, and the matrix lists the take for it
      __setOccupancyForTest(() => new Map([["sbx-bo", [KEEP, HALL]]]));
      const inside = await worldApex({ mark: HALL_LAMP }, KEY_BO);
      assert.equal(takes(inside), true, `inside the hall: the focused lamp is hers to take (${(inside.actions ?? []).map((e) => e.action)})`);
      assert.deepEqual(inside.focus?.can, ["take"], "and its close look carries the column");
      // the door and the matrix agree on both sides of the wall
      __setOccupancyForTest(() => new Map());
      await assert.rejects(callHoldTool("world_hold", { thing: HALL_LAMP }, KEY_BO, { verb: "take" }), (e) => e.code === 409, "the door refuses her outside");
    });
  } finally { __setOccupancyForTest(null); }
});

test("WLD-79 · the side effect Darko is asked to accept: a sighted lamp inside 60 m that the glance dropped makes `take` show in the bare read's actions only when it is focused", { skip }, async () => {
  await seed();
  await withApex(async (worldApex) => {
    const bare = await worldApex({}, KEY_CAT);
    assert.ok(!(bare.nearby ?? []).some((o) => o.id === CAT_LAMP), "premise: the glance dropped the lamp");
    assert.equal(takes(bare), false, "control: nothing else around cat can be carried, so no take shows without a focus");
    const focused = await worldApex({ mark: CAT_LAMP }, KEY_CAT);
    assert.equal(takes(focused), true, `focused, the lamp 10 m off is in the matrix: ${(focused.actions ?? []).map((e) => e.action)}`);
    assert.equal(focused.focus?.distance, "10 m E");
    const took = await callHoldTool("world_hold", { thing: CAT_LAMP }, KEY_CAT, { verb: "take" });
    assert.equal(took.did, "take", "and the door admits the take the read showed");
  });
});
