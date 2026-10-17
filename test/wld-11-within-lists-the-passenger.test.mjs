// wld-11-within-lists-the-passenger.test.mjs — WLD-11 (formerly POS-519), town #3394.
//
//   WORLD_CLONE=<a world checkout> node --test test/wld-11-within-lists-the-passenger.test.mjs
//
// THE REPORT (kogane, 10-01 and 10-02). Under way aboard the Post Office,
// `read: walk` said "aboard" and the bare read's `within` did not list her, so a
// plain exit (which takes the innermost thing in `within`) could not find her.
// office #338 fixed the ride read's handle; this is the other half.
//
// THE READER. The apex's bare read (`worldApex`, GET/POST /world/apex, and the
// MCP `world` tool) answers `within`. Its source is the GEOMETRIC spine, the
// marks whose footprint holds the standpoint, and the vessel's mark stands where
// it is berthed; a rider's feet are at the hull, wherever she is. The grant spine
// already knows this (`apexSpineIds` unions the vehicles you occupy); the `within`
// the resident READS did not.
//
// THE INPUT THAT PROVES THE PASSENGER ABOARD: marigold's `enter` act on the
// vessel in the record's `acts` (a real embedded Postgres here, the live era the
// office serves with TOWN_INDEX_READS=store), no later `exit`. The clock is
// frozen with the vessel genuinely under way: the fixture's timetable leaves the
// quay at 06:00Z and is 72 minutes on the 4 km leg, and the frozen instant is
// 06:36Z (crossing 10.55). Nothing is read off the wall clock.
import test, { after, before, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

import { fixtureWorldCloneWithEngine, fixtureWorldDb, mainShaOf, scratchDir } from "./dynamic-fixture.mjs";
import { NO_WORLD_DB } from "./helpers/world-rows.mjs";
import { startStore } from "./helpers/embedded-store.mjs";
import { ENGINE_FILES, fixtureMarks, atCrossing } from "./movement-fixture.mjs";
import { copyEngineFiles } from "./helpers/engine-closure.mjs";

const REAL_CLONE = (await import("../src/world-store.mjs")).WORLD_CLONE;
const scratch = scratchDir("wld11");
const SHIP = "the-town/the-post-office";
const FRAME = "the-town/let-there-be-light";
const MARKS = [
  { id: FRAME, by: "the-town", kind: "sited", tier: "constitution", at: { x: 0, y: 0 }, extent: { w: 100000, h: 100000 }, body: "let there be light" },
  ...fixtureMarks().map((m) => (m.id === SHIP ? { ...m, class: "vehicle" } : m)),
];

const BERTHED = atCrossing(10.3);     // 04:48Z, before she sails
const UNDER_WAY = atCrossing(10.55);  // 06:36Z, between departure (06:00Z) and arrival (07:12Z)
const ARRIVED = atCrossing(10.8);     // 09:36Z, alongside the far shore
const AFTER_EXIT = atCrossing(11.2);
const iso = (c) => new Date(atCrossing(c)).toISOString();
const OFF_HARBOUR = { x: 2000, y: 500 };   // nowhere on her route, so the hull never stands here
const DEPARTURES = ["marigold", "dom-pidgey", "kestrel", "sparrow"].map((actor, i) => (
  { at: iso(10.1), actor, from: OFF_HARBOUR, toward: OFF_HARBOUR, crossing: 10, line_no: i + 1 }));

const repo = fixtureWorldCloneWithEngine({ label: "wld11", marks: MARKS, departures: DEPARTURES });
// The engine and its imports (W2's enter-exit.mjs reads mark-kind.mjs).
copyEngineFiles(REAL_CLONE, repo, [...ENGINE_FILES, "enter-exit.mjs"]);
writeFileSync(join(repo, "tools", "world-verbs.mjs"),
  readFileSync(join(repo, "tools", "world-verbs.mjs"), "utf8") + "\nexport function enter() { return null; }\n");
const quiet = { stdio: ["ignore", "pipe", "pipe"] };
execFileSync("git", ["-C", repo, "add", "-A"], quiet);
execFileSync("git", ["-C", repo, "-c", "user.name=f", "-c", "user.email=f@t.invalid", "commit", "-q", "-m", "engine"], quiet);

const sweep = (d) => { try { rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); } catch { /* litter */ } };
let store;
after(async () => { mock.timers.reset(); await store?.stop(); sweep(scratch); sweep(repo); });

process.env.WORLD_CLONE = repo;
process.env.WORLD_STORE_DB = NO_WORLD_DB;
process.env.WORLD_DYNAMIC_DB = join(scratch, "dynamic.db");
process.env.WORLD_POSITIONS = "1";
process.env.WORLD_MOVEMENT_V2 = "1";
process.env.TOWN_INDEX_READS = "store";
process.env.WORLD_APEX = "1";
process.env.WORLD_PRESENCE = "1";
delete process.env.WORLD_EMISSIONS;

const passage = (handle, act, c, word = "neutral") => ({
  actor: handle, action: act, crossing: c, at: iso(c),
  payload: { ledger: "WORLD/enter-exit-ledger.md", lines: [`- ${iso(c)} · ${handle} · ${act === "enter" ? "enters" : "exits"} ${SHIP} · at ${c} · word ${word}`] },
});

let apex, world;
before(async () => {
  store = await startStore({ db: "wld11", own: true });
  process.env.WORLD2_PG = "1";
  process.env.WORLD2_PG_URL = store.url("office_api");
  const owner = await store.connect("world2_owner");
  try {
    for (const a of [passage("marigold", "enter", 10.2), passage("kestrel", "enter", 10.25),
                     passage("sparrow", "enter", 10.2), passage("sparrow", "exit", 10.9, "neutral")]) {
      await owner.query(
        "INSERT INTO acts (at, crossing, actor, action, object, class, payload) VALUES ($1,$2,$3,$4,$5,'frame',$6)",
        [a.at, a.crossing, a.actor, a.action, SHIP, JSON.stringify(a.payload)]);
    }
  } finally { await owner.end(); }
  fixtureWorldDb(join(scratch, "world.db"), { sha: mainShaOf(repo), departures: DEPARTURES });
  apex = await import("../src/world-apex.mjs");
  world = await import("../src/world.mjs");
});

const keyOf = (...handles) => ({ household: "h", handles: new Set(handles) });
const freeze = (ms) => { mock.timers.reset(); mock.timers.enable({ apis: ["Date"], now: ms }); };
const withinIds = async (handle, key) => {
  const r = await apex.worldApex({ handle }, key);
  assert.ok(!r.error, JSON.stringify(r));
  return (r.within ?? []).map((m) => m.id);
};
const walkSays = async (handle) => {
  const w = await world.worldWalkers(repo, null);
  return (w.walkers ?? []).find((r) => r.handle === handle);
};
const count = (ids, id) => ids.filter((x) => x === id).length;

test("PRIMARY · under way, the passenger is listed in `within`, and the walk read agrees at the SAME instant", async () => {
  freeze(UNDER_WAY);
  const hull = await (await import("../src/world-movement.mjs")).vesselPositionAt({ marks: MARKS }, Date.now(), { repo });
  assert.equal(hull.berthed, false, "fixture: she is under way at the frozen instant");
  const ids = await withinIds("marigold", keyOf("dom-pidgey", "marigold"));   // the SECOND handle on the key
  const walk = await walkSays("marigold");
  assert.equal(walk?.aboard, true, "the walk read says she is aboard");
  assert.equal(walk?.frame, SHIP);
  assert.equal(count(ids, SHIP), 1, `the bare read's within lists the vessel she is aboard, once (got ${JSON.stringify(ids)})`);
});

test("the selected actor decides: the first handle on the key stands ashore, and her within does not name the vessel", async () => {
  freeze(UNDER_WAY);
  const ids = await withinIds("dom-pidgey", keyOf("dom-pidgey", "marigold"));
  assert.equal(count(ids, SHIP), 0);
  const walk = await walkSays("dom-pidgey");
  assert.ok(!walk?.aboard, "and the walk read agrees: ashore");
});

test("berthed: she is listed with the vessel once", async () => {
  freeze(BERTHED);
  const ids = await withinIds("marigold", keyOf("marigold"));
  assert.equal(count(ids, SHIP), 1);
});

test("arrived, not yet exited: still listed", async () => {
  freeze(ARRIVED);
  const ids = await withinIds("marigold", keyOf("marigold"));
  assert.equal(count(ids, SHIP), 1);
  assert.equal((await walkSays("marigold"))?.aboard, true);
});

test("two passengers: each is listed with the vessel once", async () => {
  freeze(UNDER_WAY);
  for (const h of ["marigold", "kestrel"]) assert.equal(count(await withinIds(h, keyOf(h)), SHIP), 1, h);
});

test("disembarked: after the exit act she is not listed", async () => {
  freeze(AFTER_EXIT);
  assert.equal(count(await withinIds("sparrow", keyOf("sparrow")), SHIP), 0);
  assert.ok(!(await walkSays("sparrow"))?.aboard);
});

test("no embodied caller: a spectator's within is the geometry's alone", async () => {
  freeze(UNDER_WAY);
  const r = await apex.worldApex({ x: OFF_HARBOUR.x, y: OFF_HARBOUR.y }, null);
  assert.ok(!r.error);
  assert.equal(count((r.within ?? []).map((m) => m.id), SHIP), 0);
});

test("the union itself: a mark already in the spine is not repeated, only the vehicle class joins, and the vessel is innermost", async () => {
  const { withinWithVehicles } = apex;
  const marks = { [SHIP]: { id: SHIP, class: "vehicle", by: "the-town", tier: "market", body: "b", extent: { w: 10, h: 26 } },
    "x/room": { id: "x/room", by: "x", tier: "market", extent: { w: 5, h: 5 } } };
  const markOf = (id) => marks[id] ?? null;
  const geo = [{ id: FRAME }, { id: SHIP }];
  assert.deepEqual(withinWithVehicles(geo, [SHIP], markOf).map((m) => m.id), [FRAME, SHIP], "berthed: geometry already names her");
  assert.deepEqual(withinWithVehicles([{ id: FRAME }], [SHIP, SHIP], markOf).map((m) => m.id), [FRAME, SHIP], "once, even if occupancy says it twice");
  assert.deepEqual(withinWithVehicles([{ id: FRAME }], ["x/room", "no/such"], markOf).map((m) => m.id), [FRAME], "a room or an unknown mark adds nothing");
  assert.deepEqual(withinWithVehicles([{ id: FRAME }], [], markOf).map((m) => m.id), [FRAME]);
  assert.equal(withinWithVehicles([{ id: FRAME }], [SHIP], markOf).at(-1).extentM, 26);
});
