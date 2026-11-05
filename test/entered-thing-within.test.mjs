// entered-thing-within.test.mjs — WLD-74: a thing you stand on is not a place you are in until you have entered it.
//
//   node --test test/entered-thing-within.test.mjs
//
// Darko 2026-10-18: "you cannot be INSIDE a <thing> unless you've entered". Wright, AUTHORITY 2026-11-04T20:34:47Z:
// `within` "and any reach or law read keyed on it" lists a thing only once its enter record holds it. The thing is
// not gone: under your feet, it is in reach, so a verb its doors admit by reach still shows, and the read and the
// door gather the same set (world-apex.mjs § "anything you can do, you can read").
//
// THE KEYED ARM drives the REAL doors with prod's lane flags (the single log, the frame and hold pens flipped): the
// leave-mark door makes comets, the enter and exit doors write the passages into `acts`, the apex reads v1 and v2,
// orient and the eyes read the spine, and the apex's act door and the hold door take and refill. Positions come
// from the world's own where-is seam, the law from the class layer, as the carried-holder fixture stands them.
// THE KEYLESS ARM is the store route (world2-serve.mjs § world2Apex) over invented rows: a keyless reader has
// entered nothing.
//
// Everything is invented: sbx-cy, sbx-ana, two bowls by a door, cy's home parcel.

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
const store = await startStore({ db: "entered_thing_within" });
const skip = store.skip ?? ((!WORLD && NO_WORLD) || false);
const repo = mkdtempSync(join(tmpdir(), "wld74-"));
const NO_TOWN = mkdtempSync(join(tmpdir(), "wld74-no-town-"));
const put = (p, content) => { const f = join(repo, p); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, content); };
const FLAGS = ["WORLD2_PG", "WORLD2_PG_URL", "W2_PEN", "W2_GUARDS", "WORLD_CLONE", "WORLD_SINGLE_LOG", "WORLD_POOL", "TOWN_CLONE", "WORLD_APEX"];
const saved = Object.fromEntries(FLAGS.map((k) => [k, process.env[k]]));
let pool;

const FRAME = "the-town/let-there-be-light", HOME = "sbx-cy/home";
const CY_BOWL = "sbx-cy/a-door-bowl", ANA_BOWL = "sbx-ana/a-door-bowl";
const AT = { x: 1010, y: 10 }; // cy's standpoint: her home parcel, and both bowls under her feet
const KEY = { household: "sbx-cy", handles: new Set(["sbx-cy"]) };

const SHA = "f".repeat(40);
const cls = (key, data = {}) => ({ number: 300, tag_sha: SHA, newest: 300, kind: "class", key, data: { class: key, ...data } });
const prop = (klass, name, dflt, tier, parent = null) => ({ number: 300, tag_sha: SHA, newest: 300, kind: "property",
  key: `${klass}/${name}`, data: { class: klass, parent, name, tier, default: dflt, id: `the-town/${klass}-${name}` } });
const LAW = [
  cls("postmark-node"), cls("mark", { extends: "postmark-node" }), cls("sited", { extends: "mark" }), cls("thing", { extends: "sited" }),
  cls("consumable", { extends: "thing" }), cls("candy", { extends: "consumable" }), cls("pocket-comet", { extends: "candy" }),
  cls("entity", { extends: "postmark-node" }), cls("resident", { extends: "entity" }),
  cls("halloween-candy-bowl", { extends: "thing", actions: [{ action: "refill", who: "maker", from: "reach", effect: "leave-mark { kind, count, to: this bowl }" }] }),
  prop("postmark-node", "makers", false, "constitution"), prop("thing", "makers", true, "constitution"),
  prop("resident", "holder", true, "constitution"), prop("resident", "capacity", 24, "constitution", "holder"),
  prop("thing", "holder", false, "sovereign"), prop("thing", "capacity", 30, "sovereign", "holder"),
  prop("thing", "open", true, "sovereign", "holder"), prop("thing", "portable", true, "sovereign"),
  prop("halloween-candy-bowl", "holder", true, "constitution"),
];

let callHoldTool, leaveMarkViaOffice, worldOrient, worldEyes, enterViaOffice, exitViaOffice, crossingDeps, resetLawSnapshot;
if (!skip) {
  mkdirSync(join(repo, "tools"), { recursive: true });
  for (const f of readdirSync(join(WORLD, "tools")).filter((f) => f.endsWith(".mjs") && !f.endsWith(".test.mjs")))
    copyFileSync(join(WORLD, "tools", f), join(repo, "tools", f));
  put("tools/where-is.mjs", `
export const NOWHERE = Object.freeze({ x: null, y: null, placed: false, source: null, mark_id: null });
export const QUAY_MARK_ID = "the-town/the-quay";
const HOMES = { "sbx-cy": { x: ${AT.x}, y: ${AT.y} } };
export function homeOf(handle) { const h = HOMES[handle]; return h ? { ...h, mark_id: handle + "/home", placed: true, source: "home", parcel: { id: handle + "/home", at: { x: h.x, y: h.y }, extent: { w: 25, h: 25 } } } : NOWHERE; }
export function whereIs(handle) { const h = homeOf(handle); return h.placed ? { ...h, position: null } : NOWHERE; }
export function publicResidents() { return []; }
export function porchOf() { return null; }
export function householdOf() { return null; }
export function parcelsFor() { return []; }
export function parcelFor() { return null; }
export function sourceLabel() { return "home"; }
`);
  const root = { id: FRAME, by: "the-town", slug: "let-there-be-light", kind: "sited", at: { x: 0, y: 0 }, extent: { w: 10000, h: 10000 } };
  const ms = [
    { rec: { id: HOME, by: "sbx-cy", slug: "home", kind: "parcel", at: AT, extent: { w: 25, h: 25 } }, body: "cy's home ground." },
    { rec: { id: CY_BOWL, by: "sbx-cy", slug: "a-door-bowl", kind: "sited", class: "halloween-candy-bowl", portable: false, at: AT, extent: { w: 2, h: 2 } }, body: "A carved pumpkin bowl by cy's door." },
    { rec: { id: ANA_BOWL, by: "sbx-ana", slug: "a-door-bowl", kind: "sited", class: "halloween-candy-bowl", portable: false, at: AT, extent: { w: 2, h: 2 } }, body: "A carved pumpkin bowl by ana's door." },
  ];
  put("WORLD/marks/let-there-be-light/mark.md", markRecord(root, "Synthetic world frame."));
  for (const m of ms) put(`WORLD/marks/${m.rec.id}/mark.md`, markRecord(m.rec, m.body));
  // the fold carries each mark's body, as the world's state does: the telling names a spine mark by it
  put("WORLD/world-state.json", JSON.stringify({ tick: 0, dials: {}, marks: [{ ...root, body: "Synthetic world frame." }, ...ms.map((m) => ({ ...m.rec, body: m.body }))] }));
  copyFileSync(join(WORLD, "WORLD", "skeleton.json"), join(repo, "WORLD", "skeleton.json"));
  execFileSync("git", ["init", "-q", "-b", "main", repo]);
  execFileSync("git", ["-C", repo, "add", "-A", "WORLD", "tools"]);
  execFileSync("git", ["-C", repo, "-c", "user.name=fixture", "-c", "user.email=fixture@test.invalid", "commit", "-qm", "synthetic canon"]);
  const { default: pg } = await import("pg");
  pool = new pg.Pool({ connectionString: store.url("office_api") });
  // PROD'S LANES: the single log, and the frame (passages) and hold pens flipped, so an enter is an act in `acts`
  Object.assign(process.env, { WORLD_CLONE: repo, WORLD_SINGLE_LOG: "1", WORLD_POOL: "0", WORLD2_PG: "1", WORLD2_PG_URL: store.url("office_api"), W2_PEN: "hold,frame", W2_GUARDS: "1", TOWN_CLONE: NO_TOWN });
  (await import("../src/world2-pen.mjs")).__setPoolForTest(pool);
  const snap = await import("../src/law-snapshot.mjs");
  resetLawSnapshot = snap.resetLawSnapshot;
  await snap.reloadLawSnapshot({ force: true, query: async (sql) => ({ rows: sql === snap.LAW_REFRESH_SQLS.pin ? [{ newest: 300, pinned: 300 }] : LAW }) });
  ({ callHoldTool } = await import("../src/world-hold.mjs"));
  ({ leaveMarkViaOffice, worldOrient, worldEyes } = await import("../src/world.mjs"));
  ({ enterViaOffice, exitViaOffice } = await import("../src/world-crossings.mjs"));
  ({ crossingDeps } = await import("../src/world-apex.mjs"));
}
after(async () => {
  for (const k of FLAGS) { if (saved[k] == null) delete process.env[k]; else process.env[k] = saved[k]; }
  resetLawSnapshot?.();
  if (!skip) (await import("../src/world2-pen.mjs")).__setPoolForTest(null);
  if (pool) await pool.end(); await store.stop();
  rmSync(NO_TOWN, { recursive: true, force: true });
  rmSync(repo, { recursive: true, force: true });
});

const owner = async (fn) => { const c = await store.connect("world2_owner"); try { return await fn(c); } finally { await c.end(); } };
async function seed() {
  await owner(async (c) => {
    await c.query("TRUNCATE acts, claims, marks, windows, settlements, households, household_pins CASCADE");
    await c.query("INSERT INTO windows (id,opens_at,closes_at,status) VALUES (300,now()-interval '1 day',now()+interval '1 day','open')");
  });
}

// THE APEX'S CLASS LAYER: the resident's ambient verbs, and the bowl's class granting refill on the GROUND channel,
// with cy's bowl standing as its class mark at her feet (the store the read and the act door gather from)
async function withApex(fn) {
  const { publishWorldGraphForTest, resetWorldGraph } = await import("../src/world-graph-snapshot.mjs");
  const n = (id, props, at = { x: 0, y: 0 }, extent = { w: 100000, h: 100000 }) => ({ id, kind: "mark", subkind: "sited", tier: "constitution", by: id.split("/")[0],
    at_x: at?.x ?? null, at_y: at?.y ?? null, extent_w: extent?.w ?? null, extent_h: extent?.h ?? null, props: JSON.stringify(props) });
  const actions = ["leave-mark", "take", "give", "drop", "consume"].map((action) => ({ action, residue: `the-town/${action}` }));
  publishWorldGraphForTest({ meta: [{ key: "hydration_status", value: "OK" }, { key: "as_of_world", value: "wld74fixture" }],
    nodes: [n(FRAME, { slug: "let-there-be-light", body: "Let there be light.", path: "WORLD/marks/let-there-be-light/mark.md" }),
      n("the-town/resident", { slug: "resident", class: "resident", class_version: 1, ambient: true, actions, body: "A household's living voice.",
        path: "WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/resident/mark.md" }),
      n("the-town/halloween-candy-bowl", { slug: "halloween-candy-bowl", class: "halloween-candy-bowl", class_version: 1, extends: "thing",
        actions: [{ action: "refill", residue: "the-town/refill" }], body: "A bowl set out for the season.",
        path: "WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/halloween-candy-bowl/mark.md" }, null, null),
      // cy's bowl alone carries the grant in this store, so the one refill entry is hers (ana's is a holder by the class layer, for the hold doors)
      n(CY_BOWL, { slug: "a-door-bowl", class: "halloween-candy-bowl", body: "A carved pumpkin bowl by cy's door." }, AT, { w: 2, h: 2 })],
    edges: [], events: [], geometryVersions: [], lintFindings: [] }, { label: "wld74-apex" });
  process.env.WORLD_APEX = "1";
  try { return await fn((await import("../src/world-apex.mjs")).worldApex); } finally { delete process.env.WORLD_APEX; resetWorldGraph?.(); }
}

const ids = (list) => (list ?? []).map((m) => (typeof m === "string" ? m : m?.id));
const refillOf = (read) => (read.actions ?? []).find((e) => e.action === "refill");
const enter = (mark) => enterViaOffice(repo, { mark }, KEY, crossingDeps());
const exit = () => exitViaOffice(repo, { confirm: true }, KEY, crossingDeps());

/** Every read of the spine at cy's standpoint, and what each says of her own bowl. */
async function spineReads(worldApex) {
  const v1 = await worldApex({}, KEY);
  const v2 = await worldApex({ read_shape: "v2" }, KEY);
  const orient = await worldOrient({}, KEY);
  const eyes = await worldEyes({}, KEY, { lights: false });
  assert.ok(!v1.error && !v2.error && !orient.error && !eyes.error, JSON.stringify([v1.error, v2.error, orient.error, eyes.error]));
  return { v1: ids(v1.within), v2: ids(v2.you?.within), orient: ids(orient.you?.within), telling: String(eyes.telling ?? ""), refill: refillOf(v1), read: v1 };
}

test("UNENTERED · ENTERED · EXITED, at one standpoint, through the real doors: cy's own bowl under her feet is in no spine until she enters it, and leaves every spine when she exits; her home parcel stands in each throughout", { skip }, async () => {
  await seed();
  await withApex(async (worldApex) => {
    // unentered
    let r = await spineReads(worldApex);
    for (const [read, spine] of [["v1", r.v1], ["v2", r.v2], ["orient", r.orient]]) {
      assert.ok(!spine.includes(CY_BOWL) && !spine.includes(ANA_BOWL), `${read}, unentered: no bowl in the spine (${spine})`);
      assert.ok(spine.includes(HOME), `${read}: the home parcel is a place she is in, entered or not (${spine})`);
    }
    assert.doesNotMatch(r.telling, /You are within[^\n]*bowl/i, `the telling, unentered:\n${r.telling.slice(0, 400)}`);

    // entered, by the enter door: the passage is an act in `acts`, and every spine read holds the bowl
    const e = await enter(CY_BOWL);
    assert.ok(!e.error && (e.entered ?? []).includes(CY_BOWL), JSON.stringify(e).slice(0, 300));
    r = await spineReads(worldApex);
    for (const [read, spine] of [["v1", r.v1], ["v2", r.v2], ["orient", r.orient]]) {
      assert.ok(spine.includes(CY_BOWL), `${read}, entered: her bowl is in the spine (${spine})`);
      assert.ok(!spine.includes(ANA_BOWL), `${read}, entered hers: ana's bowl, never entered, is not (${spine})`);
      assert.ok(spine.includes(HOME), `${read}, entered: the home parcel stays (${spine})`);
    }
    assert.match(r.telling, /You are within[^\n]*bowl/i, `the telling, entered:\n${r.telling.slice(0, 400)}`);

    // exited, by the exit door: out of every spine again
    const x = await exit();
    assert.ok(!x.error, JSON.stringify(x).slice(0, 300));
    r = await spineReads(worldApex);
    for (const [read, spine] of [["v1", r.v1], ["v2", r.v2], ["orient", r.orient]]) {
      assert.ok(!spine.includes(CY_BOWL), `${read}, exited: her bowl has left the spine (${spine})`);
      assert.ok(spine.includes(HOME), `${read}, exited: the home parcel stays (${spine})`);
    }
    assert.doesNotMatch(r.telling, /You are within[^\n]*bowl/i, `the telling, exited:\n${r.telling.slice(0, 400)}`);
  });
});

test("THE LAW KEYED ON THE SPINE: the bowl's ground grant (refill) reaches cy IN REACH while she stands on it unentered, WITHIN once she enters, in reach again once she exits, and the act door admits it through the same channel the read showed", { skip }, async () => {
  await seed();
  await leaveMarkViaOffice(repo, { kind: "pocket-comet", count: 4, to: "sbx-cy" }, KEY);
  await withApex(async (worldApex) => {
    const arm = async (label, via) => {
      const read = await worldApex({}, KEY);
      const e = refillOf(read);
      assert.ok(e, `${label}: refill shows (${(read.actions ?? []).map((a) => `${a.action}:${a.via}`)})`);
      assert.equal(e.channel, "ground", label);
      assert.equal(e.via, via, `${label}: ${JSON.stringify(e).slice(0, 300)}`);
      assert.equal(e.ground, CY_BOWL, label);
      // the act door: the same gathering, so the same channel; and it lands
      const did = await worldApex({ do: "refill", thing: CY_BOWL, kind: "pocket-comet", count: 1 }, KEY);
      assert.ok(!did.error, `${label}: ${did.defect ?? ""} ${did.hint ?? ""}`);
      assert.deepEqual([did.did, did.via, did.from], ["refill", via, e.from], `${label}: ${JSON.stringify(did).slice(0, 300)}`);
    };
    await arm("unentered", "in reach");
    await enter(CY_BOWL);
    await arm("entered", "within");
    await exit();
    await arm("exited", "in reach");
  });
});

test("AT YOUR FEET, UNENTERED: the bowls stay usable where the hold doors admit them — take, give and refill show on the bare read and on each bowl's close look, and each lands at its door; nothing is widened (ana's bowl is not cy's to refill)", { skip }, async () => {
  await seed();
  await leaveMarkViaOffice(repo, { kind: "pocket-comet", count: 3, to: "sbx-cy" }, KEY);
  await withApex(async (worldApex) => {
    const read = await worldApex({}, KEY);
    assert.ok(!ids(read.within).includes(ANA_BOWL));
    const acts = (read.actions ?? []).map((e) => e.action);
    for (const v of ["give", "refill"]) assert.ok(acts.includes(v), `${v} shows (${acts})`);
    assert.deepEqual((await worldApex({ mark: ANA_BOWL }, KEY)).focus?.can, ["give"], "ana's empty bowl: give into it; not cy's to refill");
    assert.deepEqual((await worldApex({ mark: CY_BOWL }, KEY)).focus?.can, ["give", "refill"], "cy's own empty bowl: give into it and refill it");
    const gave = await callHoldTool("world_hold", { to: ANA_BOWL, kind: "pocket-comet", count: 1 }, KEY, { verb: "give" });
    assert.equal(gave.did, "give");
    assert.deepEqual((await worldApex({ mark: ANA_BOWL }, KEY)).focus?.can, ["take", "give"], "holding one now: take from it too");
    const took = await callHoldTool("world_hold", { from: ANA_BOWL, count: 1 }, KEY, { verb: "take" });
    assert.equal(took.did, "take");
    await assert.rejects(callHoldTool("world_hold", { act: "refill", thing: ANA_BOWL, kind: "pocket-comet", count: 1 }, KEY, { verb: "refill" }),
      (e) => e.code >= 400, "the refill door refuses ana's bowl to cy, as the read says");
  });
});

// ── THE KEYLESS STORE ROUTE: a reader with no key has entered nothing ─────────────────────────────────────────────
const LAW_SHA = "b".repeat(40);
const row = ({ id, slug, kind, owner, body = "", at = null, extent = null, data = {} }) => ({
  id, slug, kind, owner, household: `solo:${owner}`, body, geometry: at ? { at, ...(extent ? { extent } : {}) } : null, data, status: "standing", parent: null });
const KEYLESS_ROWS = [
  row({ id: "k0", slug: FRAME, kind: "sited", owner: "the-town", body: "the light", at: { x: 0, y: 0 }, extent: { w: 320000, h: 320000 }, data: { tier: "constitution" } }),
  row({ id: "k1", slug: "sbx-mo/home", kind: "parcel", owner: "sbx-mo", body: "mo's home ground", at: { x: 500, y: 500 }, extent: { w: 25, h: 25 }, data: { tier: "market" } }),
  row({ id: "k2", slug: "sbx-mo/a-bench", kind: "thing", owner: "sbx-mo", body: "a bench by the door", at: { x: 500, y: 500 }, extent: { w: 2, h: 1 }, data: { tier: "market" } }),
  row({ id: "k3", slug: "sbx-mo/a-bowl", kind: "sited", owner: "sbx-mo", body: "a bowl by the door", at: { x: 500, y: 500 }, extent: { w: 2, h: 2 }, data: { tier: "market", class: "halloween-candy-bowl" } }),
];
const keylessPool = (skeleton) => ({ query: async (sql) => {
  if (/FROM windows/i.test(sql)) return { rows: /status = 'open'/.test(sql) ? [] : [{ id: 194, law_sha: LAW_SHA }] };
  if (/FROM projection_heads/i.test(sql)) return { rows: [{ sha: LAW_SHA }] };
  if (/FROM law_projection/i.test(sql)) return { rows: [...skeleton,
    { kind: "class", key: "thing", path: "x", data: { class: "thing", extends: "sited" } },
    { kind: "class", key: "halloween-candy-bowl", path: "x", data: { id: "the-town/halloween-candy-bowl", class: "halloween-candy-bowl", extends: "thing", by: "the-town", tier: "constitution", actions: [{ action: "refill", residue: "the-town/refill" }] } }] };
  if (/FROM marks WHERE slug/i.test(sql)) return { rows: [] };
  if (/FROM marks/i.test(sql)) return { rows: KEYLESS_ROWS };
  return { rows: [] };
} });

test("KEYLESS · the store route's spine holds the parcel and neither thing under the point (a bench by kind, a bowl by its class's lineage), and the bowl's ground grant reaches the point in reach, never within", { skip: NO_WORLD || false }, async () => {
  const branches = await import("../src/world-branches.mjs");
  const doc = JSON.parse(execFileSync("git", ["-C", WORLD, "show", `${branches.freshestMainRef(WORLD)}:WORLD/skeleton.json`], { encoding: "utf8", maxBuffer: 64 << 20 }));
  const skeleton = Object.entries(doc).map(([key, data]) => ({ kind: "skeleton", key, path: "WORLD/skeleton.json", data }));
  const { world2Apex } = await import("../src/world2-serve.mjs");
  const answer = await world2Apex(new URLSearchParams({ x: "500", y: "500", crossing: "1" }), { p: keylessPool(skeleton) });
  const r = answer.body ?? answer;
  assert.ok(!r.error && !answer.code, JSON.stringify(answer).slice(0, 400));
  const spine = ids(r.within);
  assert.ok(spine.includes("sbx-mo/home"), `the parcel stands (${spine})`);
  assert.ok(!spine.includes("sbx-mo/a-bench") && !spine.includes("sbx-mo/a-bowl"), `no thing a keyless reader stands on is a place it is in (${spine})`);
  const refill = (r.actions ?? []).find((a) => a.action === "refill" && a.ground === "sbx-mo/a-bowl");
  assert.ok(refill, `the bowl's grant reaches the point (${JSON.stringify(r.actions ?? []).slice(0, 300)})`);
  assert.equal(refill.via, "in reach");
});

