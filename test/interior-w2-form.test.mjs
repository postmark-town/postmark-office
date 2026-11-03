// interior-w2-form.test.mjs — WLD-74: the keyless store routes hide a dungeon's insides when the dungeon is stored in the W2 form.
//
// interior-sweep.test.mjs writes its dungeon as `kind: sited` + `data.class: dungeon` (the old form). The store holds the W2 form: `kind: dungeon`,
// no `class` in the data. The store's record for the engine (apex-reads.mjs § markRecordOf) wrote `class: null` for it, which the engine reads
// as the class "null", so no mark was a dungeon, the sight function hid nothing, and every keyless store route listed what is inside it. This file
// is the sweep's keyless routes over rows in the form the store holds.
//
// The fixture is invented: a keep (a dungeon) with a hall and a vault, a statue in the hall, a bench in the open.

import { test as nodeTest } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

import * as apex from "../world2/tools/apex-reads.mjs";
import { NO_WORLD, worldClone } from "./fixture-paths.mjs";

const test = (name, fn) => nodeTest(name, { skip: NO_WORLD || false }, fn);
process.env.WORLD2_PG = "1"; process.env.WORLD2_PG_URL ??= "postgres://interior-w2-form/none";

const row = ({ id, slug, kind, owner, body = "", at = null, extent = null, data = {} }) => ({
  id, slug, kind, owner, household: `solo:${owner}`, body,
  geometry: at ? { at, ...(extent ? { extent } : {}) } : null, data, status: "standing", parent: null,
});
const KEEP = "fortholders/the-fort", HALL = "fortholders/the-great-room", VAULT = "fortholders/the-cellar", STATUE = "fortholders/the-statue";
const ROWS = [
  row({ id: "u0", slug: "the-town/let-there-be-light", kind: "sited", owner: "the-town", body: "the light", at: { x: 0, y: 0 }, extent: { w: 320000, h: 320000 }, data: { tier: "constitution", date: "2026-07-22" } }),
  row({ id: "u1", slug: KEEP, kind: "dungeon", owner: "fortholders", body: "a fort with rooms inside it", at: { x: 2000, y: 2000 }, extent: { w: 400, h: 400 }, data: { tier: "market", date: "2026-09-01" } }),
  row({ id: "u2", slug: HALL, kind: "sited", owner: "fortholders", body: "the great room of the fort", at: { x: 2000, y: 2000 }, extent: { w: 60, h: 60 }, data: { tier: "market", date: "2026-09-02" } }),
  row({ id: "u3", slug: VAULT, kind: "sited", owner: "fortholders", body: "the cellar of the fort", at: { x: 2150, y: 2150 }, extent: { w: 60, h: 60 }, data: { tier: "market", date: "2026-09-02" } }),
  row({ id: "u4", slug: STATUE, kind: "thing", owner: "fortholders", body: "a statue standing in the great room", at: { x: 2005, y: 2005 }, extent: { w: 2, h: 2 }, data: { tier: "market", date: "2026-09-03" } }),
  row({ id: "u5", slug: "townsfolk/a-bench", kind: "thing", owner: "townsfolk", body: "a bench in the open", at: { x: 100, y: 100 }, extent: { w: 2, h: 1 }, data: { tier: "market", date: "2026-09-03" } }),
];
const INTERIOR = [HALL, VAULT, STATUE];
const HALL_AT = { x: 2000, y: 2000 };
const LAW_SHA = "a23a8d174776db4d325631a3b9ecf9380cecb722";
let SKELETON = null, WHY = null, world2Serve = null, world2Apex = null;
const pool = () => ({ query: async (sql) => {
  if (/FROM windows/i.test(sql)) return { rows: /status = 'open'/.test(sql) ? [] : [{ id: 194, law_sha: LAW_SHA }] };
  if (/FROM projection_heads/i.test(sql)) return { rows: [{ sha: LAW_SHA }] };
  if (/FROM law_projection/i.test(sql)) return { rows: [...(SKELETON ?? [])] };
  if (/FROM marks WHERE slug/i.test(sql)) return { rows: [] };
  if (/FROM marks/i.test(sql)) return { rows: ROWS };
  return { rows: [] };
} });
nodeTest.before(async () => {
  try {
    const clone = worldClone();
    const branches = await import("../src/world-branches.mjs");
    const ref = branches.freshestMainRef(clone);
    const doc = JSON.parse(execFileSync("git", ["-C", clone, "show", `${ref}:WORLD/skeleton.json`], { encoding: "utf8", maxBuffer: 64 << 20 }));
    SKELETON = Object.entries(doc).map(([key, data]) => ({ kind: "skeleton", key, path: "WORLD/skeleton.json", data }));
    ({ world2Serve, world2Apex } = await import("../src/world2-serve.mjs"));
  } catch (e) { WHY = String(e?.message ?? e); }
});
const SECRETS = [...INTERIOR, "the great room of the fort", "the cellar of the fort", "a statue standing in the great room", "The Great Room", "The Cellar", "The Statue"];
const leaks = (answer) => { const s = JSON.stringify(answer); return SECRETS.filter((x) => s.includes(x)); };

test("the store's record reads a W2 `kind: dungeon` row as the class dungeon, and keeps every other kind's null", () => {
  const marks = apex.worldStateFromMarkRows(ROWS).marks;
  assert.equal(marks.find((m) => m.id === KEEP).class, "dungeon");
  for (const m of marks.filter((x) => x.id !== KEEP)) assert.equal(m.class, null, m.id);
  assert.equal(apex.markRecordOf({ ...ROWS[1], data: { class: "dungeon" } }).class, "dungeon", "the old form still reads as it did");
});

test("interiorSlugs sorts the W2-form keep's rooms and what they hold from the rest", async (t) => {
  if (WHY) return t.skip(WHY);
  const { interiorSlugs } = await import("../src/world2-serve.mjs");
  assert.deepEqual([...await interiorSlugs(pool())].sort(), [...INTERIOR].sort());
});

test("keyless store routes over the W2 form list nothing inside the keep: marks in all four shapes, mark, investigate, and the apex from the hall's spot", async (t) => {
  if (WHY) return t.skip(WHY);
  const p = pool();
  for (const q of ["", "?all=true", "?full=true", "?all=true&full=true"]) {
    const r = await world2Serve("/world2/marks", new URLSearchParams(q), { p });
    assert.equal(r.code, 200);
    const slugs = r.body.marks.map((m) => m.slug);
    assert.ok(slugs.includes(KEEP) && slugs.includes("townsfolk/a-bench"));
    assert.deepEqual(slugs.filter((s) => INTERIOR.includes(s)), [], `/world2/marks${q}`);
    assert.deepEqual(leaks(r.body.marks), [], `no interior body either (${q})`);
  }
  for (const slug of INTERIOR) {
    const pi = { query: async (sql, args) => (/FROM marks WHERE slug/i.test(sql) ? { rows: ROWS.filter((r) => r.slug === args[0]) } : pool().query(sql, args)) };
    assert.equal((await world2Serve("/world2/mark", new URLSearchParams({ slug }), { p: pi })).code, 404, `/world2/mark?slug=${slug}`);
    assert.equal((await world2Serve("/world2/investigate", new URLSearchParams({ mark: slug }), { p })).code, 404, `/world2/investigate?mark=${slug}`);
  }
  for (const at of [HALL_AT, { x: 2150, y: 2150 }, { x: 2005, y: 2005 }]) {
    const r = await world2Apex(new URLSearchParams({ x: String(at.x), y: String(at.y), crossing: "1" }), { p });
    assert.ok(!r.error, JSON.stringify(r.error?.body));
    assert.deepEqual(leaks(r.body), [], `/world2/apex at ${at.x},${at.y}`);
    assert.ok(r.body.within.some((m) => m.id === KEEP));
  }
});

test("keyless presence over the W2 form: a resident entered in a room is not listed, and no place word names a room", async (t) => {
  if (WHY) return t.skip(WHY);
  const walk = (id, handle) => ({ id, at: new Date("2026-10-26T16:40:00Z"), crossing: "300", actor: handle, action: "walk",
    payload: { from: HALL_AT, toward: HALL_AT, within: null, to: null, pace: 60 } });
  const enter = (id, handle, mark, act) => ({ id, at: new Date("2026-10-26T16:30:00Z"), crossing: null, actor: handle, action: act === "enters" ? "legacy:enter" : "legacy:exit",
    payload: { _ledger: "WORLD/enter-exit-ledger.md", iso: "2026-10-26T16:30:00.000Z", handle, act, mark, at: 1, word: "neutral" } });
  const departures = [walk(1, "ann"), walk(2, "bo"), walk(3, "cy")];
  const passages = [enter(10, "ann", KEEP, "enters"), enter(11, "ann", HALL, "enters"), enter(12, "bo", KEEP, "enters")];
  const p = { query: async (sql, args) => {
    if (/FROM acts/i.test(sql)) return { rows: (args?.[0] ?? []).includes("legacy:enter") ? passages : departures };
    if (/FROM town_roll/i.test(sql)) return { rows: [{ handle: "ann" }, { handle: "bo" }, { handle: "cy" }] };
    if (/FROM identities/i.test(sql)) return { rows: [] };
    if (/FROM marks WHERE status/i.test(sql)) return { rows: ROWS };
    return pool().query(sql, args);
  } };
  const handlesOf = (list) => (list ?? []).map((r) => r.handle).sort();
  const present = await world2Serve("/world2/present", new URLSearchParams(""), { p });
  assert.deepEqual(handlesOf(present.body.residents), ["cy"], "ann (a room) and bo (the keep itself) have entered");
  assert.deepEqual(leaks(present.body), [], "/world2/present names no room");
  const positions = await world2Serve("/world2/positions", new URLSearchParams(""), { p });
  assert.deepEqual(handlesOf(positions.body.walkers), ["cy"]);
  const apexed = await world2Apex(new URLSearchParams({ x: String(HALL_AT.x), y: String(HALL_AT.y), crossing: "1" }), { p });
  assert.deepEqual(handlesOf(apexed.body.present?.residents), ["cy"]);
  const occ = await world2Serve("/world2/occupancy", new URLSearchParams(""), { p });
  assert.deepEqual(occ.body.inside, {}, "nobody who has entered the keep or a room in it is on the stacks");
  assert.deepEqual(leaks(apexed.body), [], "the apex names no room, in a place word or anywhere else");
});
