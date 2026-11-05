// wld74-reader-boundary.test.mjs — WLD-74, B at the reader boundary, through the
// office's REAL consumers (Wright, 2026-11-05 04:48, on Bevel's 04:47Z Packet).
//
// The rule lives in the world engine (orient and openYourEyes: a thing is within
// only once entered; a thing at your feet is an object). The office passes the
// enter stack it already reads, and changes in two places only:
//   K1  the keyless door (world2Apex) hands the engine the accepted class law at its
//       pin, so a subclass thing (a halloween-candy-bowl) reads as a thing there as
//       it does in the keyed world, whose published state carries the class marks
//   E2  the keyed membership read (world.mjs § enteredNow) reads the enter record
//       once, in full, or stands as one who entered nothing, and the log says why
//
// THE ENGINE VERSION IS NAMED, NEVER ASSUMED. These suites copy the world clone's
// own `tools/` (the CI pin, test/clone-pins.json). An engine without B lists an
// unentered thing within, so every arm that reads B's membership says which engine
// it read and SKIPS WITH THAT REASON on an older one. It runs when the pin moves to
// the reviewed B-containing World main commit, or locally with WORLD_CLONE naming a
// checkout of that engine. The K1 arm and the fail-closed log read the office alone.
//
// Every record is invented; residents come from the world's own where-is seam.
// Run: node --test --import ./test/helpers/sparse-guard.mjs test/wld74-reader-boundary.test.mjs

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { NO_WORLD, worldClone } from "./fixture-paths.mjs";
import { startStore } from "./helpers/embedded-store.mjs";
import { markRecord } from "../src/mark-record.mjs";

const WORLD = worldClone();
const store = await startStore({ db: "wld74_reader_boundary" });
const skip = store.skip ?? ((!WORLD && NO_WORLD) || false);
// B, read off the engine this suite will run: E1's predicate is its mark
const B = !!WORLD && /export const isThingIn\b/.test(readFileSync(join(WORLD, "tools", "mark-kind.mjs"), "utf8"));
const ENGINE_AT = WORLD ? (() => { try { return execFileSync("git", ["-C", WORLD, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(); } catch { return "(not a git checkout)"; } })() : null;
const notB = B ? false : `the world engine at ${ENGINE_AT?.slice(0, 12)} predates WLD-74 B (no mark-kind isThingIn): its readers still list an unentered thing within. This arm runs at the B-containing World main pin`;
const skipB = skip || notB;

// cy stands at home, at (1010, 10); dee beside her, off every thing; eve on her own ground at (1100, 10)
const ANA_BOWL = "sbx-ana/a-door-bowl";   // a halloween-candy-bowl (a SUBCLASS thing), open, centred EXACTLY under cy
const CY_BOWL = "sbx-cy/a-door-bowl";     // cy's own bowl, centred 0.7 m east: its footprint still holds her
const LAMP = "sbx-ana/a-lamp";            // a DIRECT thing (class: thing), centred 0.6 m north
const STOOL = "sbx-ana/a-stool";          // untyped and carriable: no class, so not a thing (stays within)
const CRATE = "sbx-eve/a-crate";          // a thing on eve's ground, entered in the frozen era
const CY_HOME = "sbx-cy/home", EVE_HOME = "sbx-eve/home";
const KEY = { household: "sbx-cy", handles: new Set(["sbx-cy"]) };
const KEY_EVE = { household: "sbx-eve", handles: new Set(["sbx-eve"]) };

const repo = mkdtempSync(join(tmpdir(), "wld74-"));
const put = (p, content) => { const f = join(repo, p); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, content); };
const FLAGS = ["WORLD2_PG", "WORLD2_PG_URL", "W2_PEN", "W2_GUARDS", "WORLD_CLONE", "WORLD_SINGLE_LOG", "WORLD_POOL", "TOWN_CLONE", "WORLD_APEX"];
const NO_TOWN = mkdtempSync(join(tmpdir(), "wld74-no-town-"));
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
  prop("postmark-node", "makers", false, "constitution"), prop("thing", "makers", true, "constitution"),
  prop("resident", "holder", true, "constitution"), prop("resident", "capacity", 24, "constitution", "holder"),
  prop("thing", "holder", false, "sovereign"), prop("thing", "capacity", 30, "sovereign", "holder"),
  prop("thing", "min", 1, "constitution", "capacity"), prop("thing", "max", 120, "constitution", "capacity"),
  prop("thing", "open", true, "sovereign", "holder"), prop("thing", "portable", true, "sovereign"),
  prop("halloween-candy-bowl", "holder", true, "constitution"),
];
// the class marks as the fold publishes them (kind: class, the town's, `extends`): the keyed world carries these
const CLASS_MARKS = LAW.filter((r) => r.kind === "class").map((r) => ({ id: `the-town/${r.key}`, kind: "class", by: "the-town", household: "the-town", tier: "constitution", ...r.data }));

let callHoldTool, resetLawSnapshot, worldOrient, enterViaOffice, exitViaOffice, crossingDeps, leaveMarkViaOffice;
if (!skip) {
  mkdirSync(join(repo, "tools"), { recursive: true });
  for (const f of readdirSync(join(WORLD, "tools")).filter((f) => f.endsWith(".mjs") && !f.endsWith(".test.mjs")))
    copyFileSync(join(WORLD, "tools", f), join(repo, "tools", f));
  put("tools/where-is.mjs", `
export const NOWHERE = Object.freeze({ x: null, y: null, placed: false, source: null, mark_id: null });
export const QUAY_MARK_ID = "the-town/the-quay";
const HOMES = { "sbx-cy": { x: 1010, y: 10 }, "sbx-dee": { x: 1014, y: 10 }, "sbx-eve": { x: 1100, y: 10 } };
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
  const rec = (id, fields, body) => ({ rec: { id, by: id.split("/")[0], slug: id.split("/")[1], ...fields }, body });
  const ms = [
    rec(CY_HOME, { kind: "parcel", at: { x: 1010, y: 10 }, extent: { w: 25, h: 25 } }, "cy's home ground."),
    rec(EVE_HOME, { kind: "parcel", at: { x: 1100, y: 10 }, extent: { w: 25, h: 25 } }, "eve's home ground."),
    rec(ANA_BOWL, { kind: "sited", class: "halloween-candy-bowl", portable: false, at: { x: 1010, y: 10 }, extent: { w: 2, h: 2 } }, "A carved pumpkin bowl by ana's door."),
    rec(CY_BOWL, { kind: "sited", class: "halloween-candy-bowl", portable: false, at: { x: 1010.7, y: 10 }, extent: { w: 2, h: 2 } }, "A carved pumpkin bowl by cy's door."),
    rec(LAMP, { kind: "sited", class: "thing", at: { x: 1010, y: 10.6 }, extent: { w: 2, h: 2 } }, "A small lamp."),
    rec(STOOL, { kind: "sited", at: { x: 1010, y: 10 }, extent: { w: 4, h: 4 } }, "A three-legged stool."),
    rec(CRATE, { kind: "sited", class: "thing", at: { x: 1100, y: 10 }, extent: { w: 2, h: 2 } }, "A packing crate."),
  ];
  put("WORLD/marks/let-there-be-light/mark.md", markRecord(root, "Synthetic world frame."));
  for (const m of ms) put(`WORLD/marks/${m.rec.id}/mark.md`, markRecord(m.rec, m.body));
  put("WORLD/world-state.json", JSON.stringify({ tick: 0, dials: {}, marks: [root, ...ms.map((m) => m.rec), ...CLASS_MARKS] }));
  copyFileSync(join(WORLD, "WORLD", "skeleton.json"), join(repo, "WORLD", "skeleton.json"));
  // THE FROZEN ERA holds eve's entry into her crate (an early passage, before the cutover)
  const { formatEnterExit } = await import(pathToFileURL(join(repo, "tools", "enter-exit.mjs")).href);
  put("WORLD/enter-exit-ledger-frozen.md", `# enter-exit ledger (frozen era)\n\n${formatEnterExit({ handle: "sbx-eve", act: "enters", mark: CRATE, at: 1, iso: "2026-08-01T00:00:00.000Z" })}\n`);
  execFileSync("git", ["init", "-q", "-b", "main", repo]);
  execFileSync("git", ["-C", repo, "add", "-A", "WORLD", "tools"]);
  execFileSync("git", ["-C", repo, "-c", "user.name=fixture", "-c", "user.email=fixture@test.invalid", "commit", "-qm", "synthetic canon"]);
  const { default: pg } = await import("pg");
  pool = new pg.Pool({ connectionString: store.url("office_api") });
  Object.assign(process.env, { WORLD_CLONE: repo, WORLD_SINGLE_LOG: "1", WORLD_POOL: "0", WORLD2_PG: "1", WORLD2_PG_URL: store.url("office_api"), W2_PEN: "hold,frame", W2_GUARDS: "1", TOWN_CLONE: NO_TOWN });
  (await import("../src/world2-pen.mjs")).__setPoolForTest(pool);
  const snap = await import("../src/law-snapshot.mjs");
  resetLawSnapshot = snap.resetLawSnapshot;
  await snap.reloadLawSnapshot({ force: true, query: async (sql) => ({ rows: sql === snap.LAW_REFRESH_SQLS.pin ? [{ newest: 300, pinned: 300 }] : LAW }) });
  ({ callHoldTool } = await import("../src/world-hold.mjs"));
  ({ worldOrient, leaveMarkViaOffice } = await import("../src/world.mjs"));
  ({ enterViaOffice, exitViaOffice } = await import("../src/world-crossings.mjs"));
  ({ crossingDeps } = await import("../src/world-apex.mjs"));
}
after(async () => {
  for (const k of FLAGS) { if (saved[k] == null) delete process.env[k]; else process.env[k] = saved[k]; }
  resetLawSnapshot?.();
  if (!skip) (await import("../src/world2-pen.mjs")).__setPoolForTest(null);
  if (pool) await pool.end(); await store.stop();
  rmSync(NO_TOWN, { recursive: true, force: true });
});

const owner = async (fn) => { const c = await store.connect("world2_owner"); try { return await fn(c); } finally { await c.end(); } };
async function seed() {
  await owner(async (c) => {
    await c.query("TRUNCATE acts, claims, marks, windows, settlements, households, household_pins CASCADE");
    await c.query("INSERT INTO windows (id,opens_at,closes_at,status) VALUES (300,now()-interval '1 day',now()+interval '1 day','open')");
  });
}
// the apex's class layer: the resident class grants the hold verbs ambiently (`verbs`); the bowl's own class grants refill on its ground
const BOWL_CLASS = { id: "the-town/halloween-candy-bowl", props: { slug: "halloween-candy-bowl", class: "halloween-candy-bowl", class_version: 1, body: "A Halloween Candy Bowl is a thing that holds.",
  actions: [{ action: "refill", who: "maker", from: "reach", effect: "leave-mark { kind, count, to: this bowl }", residue: "the-town/leave-mark" }],
  path: "WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-node/mark/thing/halloween-candy-bowl/mark.md" } };
// a mark of the world graph, standing where the record has it (the ground channel asks its class here)
const INSTANCE = (id, klass, at) => ({ id, kind: "mark", subkind: "sited", tier: "market", by: id.split("/")[0], at_x: at.x, at_y: at.y, extent_w: 2, extent_h: 2,
  props: JSON.stringify({ slug: id.split("/")[1], class: klass, path: `WORLD/marks/${id}/mark.md` }) });
async function withApex(fn, { verbs = ["leave-mark", "take", "give", "drop", "refill"], classes = [], instances = [] } = {}) {
  const { publishWorldGraphForTest, resetWorldGraph } = await import("../src/world-graph-snapshot.mjs");
  const n = (id, props) => ({ id, kind: "mark", subkind: "sited", tier: "constitution", by: "the-town", at_x: 0, at_y: 0, extent_w: 100000, extent_h: 100000, props: JSON.stringify(props) });
  const actions = verbs.map((action) => ({ action, residue: `the-town/${action}` }));
  publishWorldGraphForTest({ meta: [{ key: "hydration_status", value: "OK" }, { key: "as_of_world", value: "wld74fixture" }],
    nodes: [n("the-town/let-there-be-light", { slug: "let-there-be-light", body: "Let there be light.", path: "WORLD/marks/let-there-be-light/mark.md" }),
      n("the-town/resident", { slug: "resident", class: "resident", class_version: 1, ambient: true, actions, body: "A household's living voice.",
        path: "WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/resident/mark.md" }),
      ...classes.map((c) => ({ ...n(c.id, c.props), at_x: null, at_y: null, extent_w: null, extent_h: null })), ...instances],
    edges: [], events: [], geometryVersions: [], lintFindings: [] }, { label: "wld74-apex" });
  process.env.WORLD_APEX = "1";
  try { return await fn((await import("../src/world-apex.mjs")).worldApex); } finally { delete process.env.WORLD_APEX; resetWorldGraph?.(); }
}
const ids = (rows) => (rows ?? []).map((m) => (typeof m === "string" ? m : m.id));
const enter = (mark, handle = "sbx-cy", key = KEY) => enterViaOffice(repo, { mark, handle }, key, crossingDeps());
const exit = (mark, handle = "sbx-cy", key = KEY) => exitViaOffice(repo, { mark, handle }, key, crossingDeps());

test("KEYED · UNENTERED, ENTERED, EXITED at one standpoint, v1 and v2: a thing is within only once entered; the parcel and the untyped stool stand in every arm", { skip: skipB }, async () => {
  await seed();
  await withApex(async (worldApex) => {
    const spines = async () => [ids((await worldApex({}, KEY)).within), ids((await worldApex({ read_shape: "v2" }, KEY)).you?.within)];
    const [v1, v2] = await spines();
    assert.deepEqual(v2, v1, "v1 and v2 tell one spine");
    for (const id of [ANA_BOWL, CY_BOWL, LAMP]) assert.ok(!v1.includes(id), `unentered, ${id} is not within: ${v1}`);
    for (const id of [CY_HOME, STOOL]) assert.ok(v1.includes(id), `${id} stands within, unentered as ever: ${v1}`);
    const e = await enter(CY_BOWL);
    assert.ok(!e.error, JSON.stringify(e).slice(0, 300));
    const [in1, in2] = await spines();
    assert.ok(in1.includes(CY_BOWL) && in2.includes(CY_BOWL), `entered, cy's bowl is within: ${in1}`);
    assert.ok(!in1.includes(ANA_BOWL) && !in1.includes(LAMP), "the things she did not enter are still not");
    assert.ok(in1.includes(CY_HOME), "her parcel stands within beside it");
    const x = await exit(CY_BOWL);
    assert.ok(!x.error, JSON.stringify(x).slice(0, 300));
    const [out1, out2] = await spines();
    assert.ok(!out1.includes(CY_BOWL) && !out2.includes(CY_BOWL), `exited, it is not within again: ${out1}`);
    assert.deepEqual(out1, v1, "and the spine is the unentered one, mark for mark");
  });
});

test("W2 · the bowl's own ground grant (refill) reaches cy IN REACH unentered, WITHIN once entered, in reach once exited; the act door admits it each time with the read's own `via`", { skip: skipB }, async () => {
  await seed();
  await leaveMarkViaOffice(repo, { kind: "pocket-comet", count: 3, to: "sbx-cy" }, KEY);
  // refill comes from the bowl's class alone here: the resident class grants no refill
  await withApex(async (worldApex) => {
    const refillVia = async () => (await worldApex({}, KEY)).actions.filter((a) => a.action === "refill").map((a) => a.via);
    const doRefill = () => worldApex({ do: "refill", args: { thing: CY_BOWL, kind: "pocket-comet", count: 1 } }, KEY);
    assert.deepEqual(await refillVia(), ["in reach"], "unentered: the bowl at her feet grants refill in reach");
    const d1 = await doRefill();
    assert.ok(!d1.error, JSON.stringify(d1).slice(0, 300));
    assert.equal(d1.via, "in reach", "the door admits it by the same via");
    await enter(CY_BOWL);
    assert.deepEqual(await refillVia(), ["within"], "entered: within");
    const d2 = await doRefill();
    assert.ok(!d2.error, JSON.stringify(d2).slice(0, 300));
    assert.equal(d2.via, "within");
    await exit(CY_BOWL);
    assert.deepEqual(await refillVia(), ["in reach"], "exited: in reach again");
    const d3 = await doRefill();
    assert.ok(!d3.error, JSON.stringify(d3).slice(0, 300));
    assert.equal(d3.via, "in reach");
  }, { verbs: ["leave-mark", "take", "give", "drop"], classes: [BOWL_CLASS], instances: [INSTANCE(CY_BOWL, "halloween-candy-bowl", { x: 1010.7, y: 10 })] });
});

test("W3 · AT YOUR FEET, UNENTERED: exact centre (ana's bowl) and off centre (cy's bowl, 0.7 m) stay usable — take, give and refill show on the bare read and each bowl's close look, and each lands at its door", { skip }, async () => {
  await seed();
  await leaveMarkViaOffice(repo, { kind: "pocket-comet", count: 3, to: "sbx-cy" }, KEY);
  await withApex(async (worldApex) => {
    const into = await callHoldTool("world_hold", { to: ANA_BOWL, kind: "pocket-comet", count: 1 }, KEY, { verb: "give" });
    assert.equal(into.did, "give", "the door admits a give into ana's bowl under cy's feet");
    const read = await worldApex({}, KEY);
    if (B) {
      // under B the bowls are not where she is; they are what she sees at her feet, and reach rides the eyes
      for (const id of [ANA_BOWL, CY_BOWL]) {
        assert.ok(!ids(read.within).includes(id), `${id} is not within`);
        assert.ok(ids(read.nearby).includes(id), `${id} is among what the eyes see: ${ids(read.nearby)}`);
      }
    }
    const acts = read.actions.map((e) => e.action);
    for (const v of ["take", "give", "refill"]) assert.ok(acts.includes(v), `${v} is admitted here, so it shows (${acts})`);
    assert.deepEqual((await worldApex({ mark: ANA_BOWL }, KEY)).focus?.can, ["take", "give"], "ana's bowl: take from it, give into it; not cy's to refill");
    assert.deepEqual((await worldApex({ mark: CY_BOWL }, KEY)).focus?.can, ["give", "refill"], "cy's own empty bowl: give, refill; nothing to take");
    const took = await callHoldTool("world_hold", { from: ANA_BOWL, count: 1 }, KEY, { verb: "take" });
    assert.equal(took.did, "take");
    const refilled = await callHoldTool("world_hold", { act: "refill", thing: CY_BOWL, kind: "pocket-comet", count: 2 }, KEY, { verb: "refill" });
    assert.equal(refilled.did, "refill");
    assert.deepEqual((await worldApex({ mark: CY_BOWL }, KEY)).focus?.can, ["take", "give", "refill"], "refilled, it holds two: take shows too");
  });
});

test("THE BUDGET · a small view still carries the things at your feet first; the door's default budget is its own, and admits each", { skip: skipB }, async () => {
  await seed();
  const { worldEyes } = await import("../src/world.mjs");
  const smallAll = ids((await worldEyes({}, KEY, { budget: 1, lights: false })).objects);
  assert.ok(smallAll.includes(CY_HOME), `her kept home rides outside the budget, as ever: ${smallAll}`);
  const small = smallAll.filter((id) => id !== CY_HOME);
  assert.equal(small.length, 1, `one seat: ${small}`);
  assert.ok([ANA_BOWL, CY_BOWL, LAMP].includes(small[0]), `and it goes to a thing at her feet: ${small}`);
  const door = ids((await worldEyes({}, KEY, { lights: false })).objects);
  for (const id of [ANA_BOWL, CY_BOWL, LAMP]) assert.ok(door.includes(id), `the default budget carries ${id}: ${door}`);
  assert.ok(door.length > small.length, "the small view and the door's view stay different budgets");
});

// The log reads the office alone and runs on any engine; what `within` says of the crate is B's, and is asked only of B.
test("FAILS CLOSED, AND SAYS SO · eve entered her crate in the frozen era and has stepped out since: with the record unread she is not told she is inside it, and the office's log names the unread record", { skip }, async () => {
  await seed();
  const within = async () => ids((await worldOrient({}, KEY_EVE)).you?.within);
  if (B) assert.ok((await within()).includes(CRATE), "control: the frozen era's entry stands, so the crate is within");
  const x = await exit(CRATE, "sbx-eve", KEY_EVE);
  assert.ok(!x.error, JSON.stringify(x).slice(0, 300));
  if (B) assert.ok(!(await within()).includes(CRATE), "read in full: she has stepped out");
  // the passages since the cutover cannot be read: the fossil still holds her entry
  const said = [];
  const err = console.error;
  console.error = (...a) => { said.push(a.join(" ")); };
  const url = process.env.WORLD2_PG;
  delete process.env.WORLD2_PG;
  let unread;
  try { unread = await within(); } finally { process.env.WORLD2_PG = url; console.error = err; }
  if (B) assert.ok(!unread.includes(CRATE), `unread, the crate's inside is not claimed: ${unread}`);
  assert.ok(unread.includes(EVE_HOME), "her ground still stands within");
  assert.ok(said.some((l) => /\[office\] the enter record could not be read in full for sbx-eve/.test(l)), `the log names it: ${said.join(" | ").slice(0, 400)}`);
});

// ── KEYLESS: the store door, over invented rows ──────────────────────────────
const LAW_SHA = "b".repeat(40);
const rrow = ({ id, kind = "sited", owner, at = null, extent = null, data = {} }) => ({ id, slug: id, kind, owner, household: `solo:${owner}`, body: id,
  geometry: at ? { at, ...(extent ? { extent } : {}) } : null, data: { tier: "market", date: "2026-10-01", ...data }, status: "standing", parent: null });
async function keyless() {
  const { world2Apex } = await import("../src/world2-serve.mjs");
  const doc = JSON.parse(readFileSync(join(repo, "WORLD", "skeleton.json"), "utf8"));
  const skeletonRows = Object.entries(doc).map(([key, data]) => ({ kind: "skeleton", key, path: "WORLD/skeleton.json", data }));
  const classRows = LAW.filter((r) => r.kind === "class").map((r) => ({ kind: "class", key: r.key, path: `WORLD/marks/${r.key}/mark.md`, data: { id: `the-town/${r.key}`, kind: "class", by: "the-town", tier: "constitution", ...r.data } }));
  const markRows = [
    rrow({ id: "the-town/let-there-be-light", owner: "the-town", at: { x: 0, y: 0 }, extent: { w: 10000, h: 10000 }, data: { tier: "constitution" } }),
    rrow({ id: CY_HOME, kind: "parcel", owner: "sbx-cy", at: { x: 1010, y: 10 }, extent: { w: 25, h: 25 } }),
    rrow({ id: ANA_BOWL, owner: "sbx-ana", at: { x: 1010, y: 10 }, extent: { w: 2, h: 2 }, data: { class: "halloween-candy-bowl" } }),
    rrow({ id: LAMP, owner: "sbx-ana", at: { x: 1010, y: 10.6 }, extent: { w: 2, h: 2 }, data: { class: "thing" } }),
    rrow({ id: STOOL, owner: "sbx-ana", at: { x: 1010, y: 10 }, extent: { w: 4, h: 4 } }),
  ];
  const p = { query: async (sql) => {
    if (/FROM windows/i.test(sql)) return { rows: /status = 'open'/.test(sql) ? [] : [{ id: 300, law_sha: LAW_SHA }] };
    if (/FROM projection_heads/i.test(sql)) return { rows: [{ sha: LAW_SHA }] };
    if (/FROM law_projection/i.test(sql)) return { rows: [...skeletonRows, ...classRows] };
    if (/FROM marks/i.test(sql)) return { rows: markRows };
    return { rows: [] };
  } };
  const branches = await import("../src/world-branches.mjs");
  const dir = branches.engineDirAt(repo);
  // the door's own engine set (world2-serve.mjs § engine), from this world's tools
  const at = (f) => import(pathToFileURL(join(dir, "tools", f)).href);
  const [verbs, build, engineMod, regions, geometry, water] = await Promise.all([
    at("world-verbs.mjs"), at("world-build.mjs"), at("world-engine.mjs"), at("region-outsiders.mjs"), at("geometry.mjs"), at("water.mjs")]);
  // the engine, recorded: what world each reader was handed
  const handed = [];
  const eng = { build, engine: engineMod, regions, geometry, water, dir,
    verbs: { ...verbs, orient: (s, w, o) => { handed.push(w); return verbs.orient(s, w, o); }, openYourEyes: (s, w, o) => { handed.push(w); return verbs.openYourEyes(s, w, o); } } };
  const r = await world2Apex(new URLSearchParams({ x: "1010", y: "10", crossing: "1" }), { p, eng });
  return { r, handed };
}

test("K1 · the keyless door hands both readers the accepted class law at its pin, as class marks the engine indexes (on any engine)", { skip }, async () => {
  const { r, handed } = await keyless();
  assert.ok(!r.error, String(JSON.stringify(r.error?.body ?? r.error)).slice(0, 300));
  assert.equal(handed.length, 2, "orient and openYourEyes");
  for (const w of handed) {
    const bowlClass = w.marks.find((m) => m.kind === "class" && m.class === "halloween-candy-bowl");
    assert.equal(bowlClass?.extends, "thing", "the subclass names its parent");
    assert.equal(bowlClass?.by, "the-town");
  }
  // the law half and the rows the answer names read the marks as they were: no class rides `nearby`
  assert.ok(!(r.body.nearby ?? []).some((o) => o.kind === "class"));
});

test("KEYLESS · the store door's spine holds the parcel and the untyped stool, and neither thing (the subclass bowl by its class law, the lamp by kind); the bowl is at the point's feet, in nearby", { skip: skipB }, async () => {
  const { r } = await keyless();
  assert.ok(!r.error, String(JSON.stringify(r.error?.body ?? r.error)).slice(0, 300));
  const within = ids(r.body.within), nearby = ids(r.body.nearby);
  for (const id of [ANA_BOWL, LAMP]) assert.ok(!within.includes(id), `${id} is not within a keyless reader, who entered nothing: ${within}`);
  for (const id of [CY_HOME, STOOL]) assert.ok(within.includes(id), `${id} stands within: ${within}`);
  for (const id of [ANA_BOWL, LAMP]) assert.ok(nearby.includes(id), `${id} is seen at the point's feet: ${nearby}`);
});

test("KEYED AND KEYLESS AGREE · the direct thing and the subclass thing are out of the unentered spine on both doors", { skip: skipB }, async () => {
  await seed();
  const { r } = await keyless();
  await withApex(async (worldApex) => {
    const keyed = ids((await worldApex({}, KEY)).within);
    const keylessW = ids(r.body.within);
    for (const id of [ANA_BOWL, LAMP]) assert.equal(keyed.includes(id), keylessW.includes(id), `${id}: keyed ${keyed.includes(id)}, keyless ${keylessW.includes(id)}`);
    for (const id of [ANA_BOWL, LAMP]) assert.equal(keyed.includes(id), false);
  });
});
