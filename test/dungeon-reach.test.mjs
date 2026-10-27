// dungeon-reach.test.mjs — WLD-74: a thing inside a room of a dungeon is ground, and takeable, only to one who entered that room.
//
// The take door's reach was "inside the extent OR within 60 m" (reach.mjs), asked of a thing by its position alone, so a resident in one
// room read, and could take, the things of a room behind a wall. The reach now asks the one sight function (world.mjs § reachableBy,
// standpointSight over the resident's stack) before the geometry. Walking is untouched.
//
// The fixture is invented: a keep (a dungeon, the W2 form: `kind: dungeon`) with a hall and a vault, a lamp in each, a bench in the open.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { __setOccupancyForTest } from "../src/creature-sight.mjs";
import { NO_WORLD, worldModuleUrl } from "./fixture-paths.mjs";

const TMP = mkdtempSync(join(tmpdir(), "dungeon-reach-"));
const KEEP = "fortholders/the-fort", HALL = "fortholders/the-great-room", VAULT = "fortholders/the-cellar";
const HALL_LAMP = "fortholders/the-hall-lamp", VAULT_LAMP = "fortholders/the-cellar-lamp", BENCH = "townsfolk/a-bench";
const HALL_AT = { x: 2000, y: 2000 }, VAULT_AT = { x: 2150, y: 2150 };
const ANNEX = "fortholders/the-annex", ANNEX_LAMP = "fortholders/the-annex-lamp"; // a room 50 m from the hall, with a lamp

const mark = (id, kind, x, y, w, h, by = id.split("/")[0]) => ({ id, kind, by, household: by, tier: "market", at: { x, y }, extent: { w, h }, body: id, date: "2026-09-02T00:00:00Z" });
const MARKS = [
  mark(KEEP, "dungeon", 2000, 2000, 400, 400),
  mark(HALL, "sited", 2000, 2000, 60, 60), mark(VAULT, "sited", 2150, 2150, 60, 60),
  mark(HALL_LAMP, "thing", 2005, 2005, 1, 1), mark(VAULT_LAMP, "thing", 2150, 2150, 1, 1),
  mark(BENCH, "thing", 100, 100, 2, 1),
  mark(ANNEX, "sited", 2070, 2000, 40, 40), mark(ANNEX_LAMP, "thing", 2070, 2000, 1, 1),
];
const stackOf = (...marks) => new Map([["ann", marks]]);
const OUTSIDE = stackOf(), NEXT_DOOR = stackOf(KEEP, VAULT), INSIDE = stackOf(KEEP, HALL);

const withWorld = async (fn) => {
  const world = await import("../src/world.mjs");
  world.__setWorldForTest({ marks: MARKS });
  try { return await fn(world); } finally { world.__setWorldForTest(null); __setOccupancyForTest(null); }
};

test("reachableBy: the hall's lamp is reachable only by one whose stack holds the hall; the vault's by one in the vault; the open bench by all", { skip: NO_WORLD || false }, async () => {
  await withWorld(async ({ reachableBy }) => {
    const as = async (occ, id) => { __setOccupancyForTest(() => occ); const r = await reachableBy("ann"); return r ? r(id) : true; };
    for (const [label, occ, hall, vault] of [["out", OUTSIDE, false, false], ["next door (the vault)", NEXT_DOOR, false, true], ["in the hall", INSIDE, true, false]]) {
      assert.equal(await as(occ, HALL_LAMP), hall, `${label}: the hall lamp`);
      assert.equal(await as(occ, VAULT_LAMP), vault, `${label}: the vault lamp`);
      assert.equal(await as(occ, BENCH), true, `${label}: the open bench`);
    }
    __setOccupancyForTest(() => new Map());
    assert.equal((await reachableBy("")) ? await (await reachableBy(""))(HALL_LAMP) : true, false, "a read with no resident has entered nothing");
  });
});

test("reachableBy: a world with no dungeon hides nothing and reads no ledger", { skip: NO_WORLD || false }, async () => {
  const world = await import("../src/world.mjs");
  world.__setWorldForTest({ marks: MARKS.filter((m) => m.id === BENCH) });
  let reads = 0;
  __setOccupancyForTest(() => { reads += 1; return OUTSIDE; });
  try { assert.equal(await world.reachableBy("ann"), null); assert.equal(reads, 0); }
  finally { world.__setWorldForTest(null); __setOccupancyForTest(null); }
});

test("the take door: the hall's lamp is no mark to one outside the hall, even 35 m away; to one inside it, it is; the open bench is untouched", { skip: NO_WORLD || false }, async () => {
  await withWorld(async () => {
    const { reachContext } = await import("../src/world-hold.mjs");
    const markFor = async (occ, thing) => { __setOccupancyForTest(() => occ); return (await reachContext(thing, "ann"))?.mark ?? null; };
    for (const occ of [OUTSIDE, NEXT_DOOR]) assert.equal(await markFor(occ, HALL_LAMP), null, `the hall lamp, stack ${JSON.stringify([...occ.get("ann")])}`);
    assert.equal((await markFor(INSIDE, HALL_LAMP))?.id, HALL_LAMP, "the control: one who entered the hall reaches its lamp");
    assert.equal((await markFor(OUTSIDE, BENCH))?.id, BENCH, "the open ground is untouched");
  });
});

// ── the ground read: `read: "take"` → ground.things ──────────────────────────

async function withGround(fn) {
  const { SCHEMA } = await import("../src/world-store.mjs");
  const { NO_WORLD_DB, withWorld: withRows } = await import("./helpers/world-rows.mjs");
  const path = join(TMP, "ground.db");
  rmSync(path, { force: true });
  const db = new DatabaseSync(path);
  db.exec(SCHEMA);
  const meta = db.prepare("INSERT INTO meta VALUES (?, ?)");
  meta.run("hydration_status", "OK"); meta.run("as_of_world", "f00dcafe");
  const node = db.prepare("INSERT INTO nodes (id, kind, subkind, tier, by, at_x, at_y, extent_w, extent_h, props) VALUES (?,?,?,?,?,?,?,?,?,?)");
  for (const m of MARKS.filter((x) => x.kind === "thing")) node.run(m.id, "mark", "sited", "market", m.by, m.at.x, m.at.y, m.extent.w, m.extent.h, JSON.stringify({ class: "thing", body: m.body }));
  db.close();
  const prev = { store: process.env.WORLD_STORE_DB, dyn: process.env.WORLD_DYNAMIC_DB };
  process.env.WORLD_STORE_DB = NO_WORLD_DB;
  process.env.WORLD_DYNAMIC_DB = join(mkdtempSync(join(TMP, "run-")), "dynamic.db");
  try { return await withRows(path, fn); }
  finally { for (const [k, v] of [["WORLD_STORE_DB", prev.store], ["WORLD_DYNAMIC_DB", prev.dyn]]) if (v === undefined) delete process.env[k]; else process.env[k] = v; }
}

test("the take read's ground lists the hall's lamp only to one who entered the hall, from 35 m and from the spot itself", { skip: NO_WORLD || false }, async () => {
  await withGround(async () => {
    await withWorld(async () => {
      const { groundWithinReach } = await import("../src/world-apex.mjs");
      const key = { handles: new Set(["ann"]) };
      const ids = async (occ, at) => { __setOccupancyForTest(() => occ); const a = await groundWithinReach({ standpoint: { ...at, handle: "ann" } }, key); assert.ok(!a.unavailable, a.unavailable); return a.things.map((t) => t.thing); };
      for (const at of [{ x: 2040, y: 2000 }, { x: 2005, y: 2005 }, { x: 2150, y: 2120 }]) {
        for (const occ of [OUTSIDE, NEXT_DOOR]) {
          const seen = await ids(occ, at);
          assert.ok(!seen.includes(HALL_LAMP), `${JSON.stringify(at)} with ${JSON.stringify([...occ.get("ann")])}: no hall lamp`);
        }
      }
      assert.ok((await ids(INSIDE, { x: 2040, y: 2000 })).includes(HALL_LAMP), "the control: from inside the hall, the lamp is on the ground, takeable");
      assert.ok((await ids(NEXT_DOOR, { x: 2150, y: 2120 })).includes(VAULT_LAMP), "and the vault's lamp to one who entered the vault");
      assert.ok(!(await ids(INSIDE, { x: 2150, y: 2120 })).includes(VAULT_LAMP), "but not from the hall, through the wall");
      assert.ok((await ids(OUTSIDE, { x: 101, y: 100 })).includes(BENCH), "the open ground is untouched");
    });
  });
});

test("[pin] the take door, the ground read and a set-down holder's reach each ask reachableBy", async () => {
  const { readFileSync } = await import("node:fs");
  const read = (f) => readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8");
  assert.match(read("world-hold.mjs"), /reachableBy\(actor, key\)/, "world-hold § reachContext");
  assert.match(read("world-apex.mjs"), /reachableBy\(who, key\)/, "world-apex § groundWithinReach");
  assert.match(read("world-units.mjs"), /reachable: async \(id, actor\) => \{ const r = await world\.reachableBy\(String\(actor\)\)/, "world-units § liveUnitDeps");
  assert.match(read("world-kinds.mjs"), /deps\.reachable && !\(await deps\.reachable\(String\(id\), actor\)\)/, "world-kinds § reachHolder");
  void worldModuleUrl;
});

// ── a stack holding ONLY the dungeon (entered by its own door, no room): the reach into a room next to the one it stands in ──

const KEEP_ONLY = stackOf(KEEP);

test("a stack holding only the dungeon, standing in the hall's footprint, cannot reach the annex lamp 50 m off (rooms it has not entered show as outsides)", { skip: NO_WORLD || false }, async () => {
  await withWorld(async ({ reachableBy }) => {
    __setOccupancyForTest(() => KEEP_ONLY);
    const r = await reachableBy("ann");
    assert.equal(r(ANNEX_LAMP), false, "the annex lamp, through reachableBy");
    assert.equal(r(HALL_LAMP), false, "the hall lamp too: this stack has entered no room");
    assert.equal(r(ANNEX), true, "the annex itself reads as its outside");
    assert.equal(r(KEEP), true);
    const { reachContext } = await import("../src/world-hold.mjs");
    assert.equal((await reachContext(ANNEX_LAMP, "ann"))?.mark ?? null, null, "the take door");
    const { SCHEMA } = await import("../src/world-store.mjs");
    void SCHEMA;
  });
});

test("the take read's ground, for a dungeon-only stack standing in the hall, lists neither room's lamp", { skip: NO_WORLD || false }, async () => {
  await withGround(async () => {
    await withWorld(async () => {
      const { groundWithinReach } = await import("../src/world-apex.mjs");
      __setOccupancyForTest(() => KEEP_ONLY);
      const a = await groundWithinReach({ standpoint: { x: 2020, y: 2000, handle: "ann" } }, { handles: new Set(["ann"]) });
      assert.ok(!a.unavailable, a.unavailable);
      assert.deepEqual(a.things.map((t) => t.thing), []);
    });
  });
});
