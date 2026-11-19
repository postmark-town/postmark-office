// world-live-parcel-wiring.test.mjs — POS-686: the layer, through the readers a viewer actually asks, with the store's rows behind them.
//
//   node --test test/world-live-parcel-wiring.test.mjs
//
// world-live-parcel.test.mjs holds the rules and the SQL. THIS file is the wiring: the real `worldFind`, `worldInvestigate`, `markRows`, `placeMarksAt`,
// `marksRead` (the town's marks), `stakesFor` and `embeddedScan` (the household media), each reading through the office's own store read (`actsQuery`)
// from a store that holds the owed rows. A reader whose call into the layer is removed goes red here, and the cases name what each oracle is:
//
//   · SCOPE: an author's own market mark is edited and withdrawn in the store (the public market-mark probe, run on the pinned world's real
//     `alden/the-alder-at-the-green-lamp`); every reader still serves canon's body and the mark; an own-parcel mark beside it goes live.
//   · CACHE BOUNDARY: another owner's edit appears, and `world()`'s object, `worldMarksAll()`'s array and every world-keyed derived index (the id,
//     ground, room and interior indexes, counted where they are built) are exactly as they were: not replaced, not rebuilt, not re-keyed.
//   · EVERY SERVING READER: the body or the absence, for anonymous and keyed callers alike.

import test, { after, before } from "node:test";
import assert from "node:assert/strict";

process.env.WORLD2_PG = "1";
process.env.WORLD2_PG_URL = "postgres://live-parcel-wiring/none";
const office = await import("../src/world.mjs");
const acts = await import("../src/world2-acts.mjs");
const live = await import("../src/world-live-parcel.mjs");

const mk = (id, by, tier, x, body, kind = "sited") => ({ id, kind, by, household: by, tier, at: { x, y: x }, extent: { w: 2, h: 2 }, body, date: "2026-09-02T00:00:00Z" });
const MARKS = [
  mk("wright/the-drafting-table", "wright", "home", 10, "A tilted sheet of working drawings."),
  mk("wright/the-keystone", "wright", "home", 20, "A keystone."),
  mk("ada/a-lamp", "ada", "home", 300, "A lamp on ada's own ground."),
  mk("ada/a-lantern", "ada", "home", 310, "A lantern on ada's own ground."),
  mk("alden/the-alder-at-the-green-lamp", "alden", "market", 600, "An alder stands beside the green lamp."),
];
const WORLD = { marks: MARKS };
const ALDER = "alden/the-alder-at-the-green-lamp";

// the store, as the office reads it: the two statements the layer makes, counted
let owed = [];
const store = { watch: { mark_act: 1, window_top: 321, window_closed: 320, clearing: 0 }, statements: [] };
const fakePool = {
  query: async (sql) => {
    store.statements.push(sql === live.watchSql ? "watch" : sql === live.owedSql ? "owed" : "other");
    if (sql === live.watchSql) return { rows: [store.watch] };
    if (sql === live.owedSql) return { rows: owed };
    return { rows: [] };
  },
};
const amendRow = (object, body) => ({ object, action: "amend", act_id: 10, crossing: 320, claim_id: "c1", claim_status: "pending", body });
const withdrawRow = (object) => ({ object, action: "withdraw", act_id: 11, crossing: 320, claim_id: null, claim_status: null, body: null });
const stateOf = (rows) => { owed = rows; store.watch = { ...store.watch, mark_act: store.watch.mark_act + 1 }; };

before(() => { acts.__setPoolForTest(fakePool); office.__setWorldForTest(WORLD); });
after(() => { acts.__setPoolForTest(null); office.__setWorldForTest(null); });

const rowOf = async (id) => (await office.markRows([id], WORLD))[0] ?? null;

test("1 · nothing owed: every reader serves canon exactly as before, and the store is asked one watch for the whole request", async () => {
  stateOf([]);
  store.statements.length = 0;
  const r = await live.liveScope(async () => ({ row: await rowOf("wright/the-keystone"), hit: JSON.stringify(await office.worldFind({ q: "keystone" }, null)) }));
  assert.equal(r.row.body, "A keystone.");
  assert.match(r.hit, /wright\/the-keystone/);
  assert.equal(store.statements.filter((s) => s === "watch").length, 1, "one watch for the whole request, the two readers sharing it");
});

test("2 · AMEND (own parcel): every serving reader carries the new body, for anonymous and keyed callers, and canon's own mark is not edited", async () => {
  stateOf([amendRow("wright/the-drafting-table", "A new sheet, re-inked between crossings.")]);
  await live.liveScope(async () => {
    assert.equal((await rowOf("wright/the-drafting-table")).body, "A new sheet, re-inked between crossings.", "markRows");
    for (const key of [null, { handles: new Set(["wright"]), household: "wright" }]) {
      const inv = await office.worldInvestigate({ mark: "wright/the-drafting-table" }, key);
      assert.match(JSON.stringify(inv), /re-inked between crossings/, `investigate (${key ? "keyed" : "anonymous"})`);
      assert.doesNotMatch(JSON.stringify(inv), /tilted sheet of working drawings/);
    }
  });
  assert.equal(MARKS[0].body, "A tilted sheet of working drawings.", "canon is not edited");
});

test("3 · WITHDRAW (own parcel, dependency-free): gone from every serving reader, anonymous and keyed", async () => {
  stateOf([withdrawRow("wright/the-keystone")]);
  await live.liveScope(async () => {
    assert.equal(await rowOf("wright/the-keystone"), null, "markRows");
    for (const key of [null, { handles: new Set(["wright"]), household: "wright" }]) {
      const inv = await office.worldInvestigate({ mark: "wright/the-keystone" }, key);
      assert.equal(inv.error, "bounce", `investigate (${key ? "keyed" : "anonymous"})`);
      assert.doesNotMatch(JSON.stringify(await office.worldFind({ q: "keystone" }, key)), /wright\/the-keystone/, "find");
    }
    const near = await office.placeMarksAt({ x: 21, y: 21 });
    assert.doesNotMatch(JSON.stringify(near), /the-keystone/, "place words");
    assert.match(JSON.stringify(await office.placeMarksAt({ x: 11, y: 11 })), /the-drafting-table/, "an unedited neighbour is still named");
  });
});

test("4 · SCOPE, the public market-mark probe: the author's own market mark, edited AND withdrawn in the store, is served as canon in every reader; the own-parcel mark beside it goes live", async () => {
  stateOf([amendRow(ALDER, "SYNTHETIC LIVE BODY"), withdrawRow(ALDER), amendRow("wright/the-drafting-table", "The own-parcel positive.")]);
  await live.liveScope(async () => {
    assert.equal((await rowOf(ALDER)).body, "An alder stands beside the green lamp.", "markRows");
    const inv = JSON.stringify(await office.worldInvestigate({ mark: ALDER }, null));
    assert.match(inv, /An alder stands beside the green lamp/); assert.doesNotMatch(inv, /SYNTHETIC LIVE BODY/);
    assert.match(JSON.stringify(await office.worldFind({ q: "alder" }, null)), /the-alder-at-the-green-lamp/, "still found: a withdrawal of market ground waits for the settlement");
    assert.match(JSON.stringify(await office.placeMarksAt({ x: 601, y: 601 })), /An alder stands beside the green lamp/);
    assert.equal((await rowOf("wright/the-drafting-table")).body, "The own-parcel positive.", "the positive control, in the same read");
  });
});

test("5 · SCOPE on the pinned world's real canon: the real market mark is no candidate and no edit; a real own-parcel mark is both", async () => {
  const { publishedState } = await import("../src/world-branches.mjs");
  const { WORLD_CLONE } = await import("../src/world.mjs");
  const marks = publishedState(WORLD_CLONE).state?.marks ?? [];
  const market = marks.find((m) => m.id === ALDER) ?? marks.find((m) => m.tier === "market" && m.kind !== "parcel");
  const home = marks.find((m) => m.tier === "home" && m.kind !== "parcel" && typeof m.body === "string");
  assert.ok(market && home, "the pinned world holds a market mark and an own-parcel mark");
  const e = live.editsFrom([amendRow(market.id, "SYNTHETIC LIVE BODY"), withdrawRow(market.id), amendRow(home.id, "SYNTHETIC HOME BODY")], marks);
  assert.deepEqual([...e.bodies.keys()], [home.id]);
  assert.equal(e.removed.size, 0);
  const asked = [];
  await live.liveEdits(marks, { query: async (sql, p) => (sql === live.watchSql ? [store.watch] : (asked.push(...p[0]), [])) });
  assert.ok(asked.includes(home.id) && !asked.includes(market.id), "the store is asked about own-parcel marks only");
});

test("6 · CACHE BOUNDARY: another owner's edit replaces nothing and rebuilds nothing at the world-keyed caches", async () => {
  stateOf([]);
  // warm every world-keyed derived index through the readers that build them, with nothing owed
  const warm = async () => { await office.markRows(["ada/a-lamp"], WORLD); await office.reachableBy("ada"); await office.worldFind({ q: "lamp" }, null); await office.worldInvestigate({ mark: "ada/a-lamp" }, null); };
  await live.liveScope(warm);
  const builds0 = office.__derivedBuildsForTest();
  const canonMarks = await office.worldMarksAll();
  // wright's edits (not ada's) appear, then a DIFFERENT owner's, then a withdrawal: each is a new edit set in the store
  for (const rows of [[amendRow("wright/the-drafting-table", "wright's new words")], [amendRow("ada/a-lantern", "ada's new words")], [withdrawRow("wright/the-keystone"), withdrawRow("ada/a-lantern")]]) {
    stateOf(rows);
    await live.liveScope(warm);
    assert.deepEqual(office.__derivedBuildsForTest(), builds0, "no world-keyed index was built again");
    assert.strictEqual(await office.worldMarksAll(), canonMarks, "world() is the same object: its marks are the same array");
  }
  // and the edits are real: the same readers, in the same state, serve them
  await live.liveScope(async () => assert.equal((await office.markRows(["ada/a-lantern"], WORLD))[0] ?? null, null));
});

test("7 · the town's marks read (real canon): the owner's published list carries the new body, then loses a withdrawn mark; another house's list is canon's", async () => {
  const tm = await import("../src/town-marks.mjs");
  const { publishedState } = await import("../src/world-branches.mjs");
  const { WORLD_CLONE } = await import("../src/world.mjs");
  const marks = publishedState(WORLD_CLONE).state?.marks ?? [];
  const home = marks.find((m) => m.tier === "home" && m.kind !== "parcel" && typeof m.body === "string" && m.by);
  const other = marks.find((m) => m.by && m.by !== home.by && m.tier === "home");
  const nodocket = async () => ({ readable: true, rows: [] });
  const read = (handle) => live.liveScope(() => tm.marksRead(handle, { repo: WORLD_CLONE, limit: 200, docketFor: nodocket, draftsFor: nodocket }));
  stateOf([]);
  const base = await read(home.by), baseOther = await read(other.by);
  stateOf([amendRow(home.id, "THE OWNER'S NEW WORDS")]);
  const amended = await read(home.by);
  assert.equal(amended.published.find((m) => m.id === home.id).body, "THE OWNER'S NEW WORDS");
  assert.equal(amended.counts.published, base.counts.published);
  assert.deepEqual((await read(other.by)).published, baseOther.published, "another house's list is canon's");
  stateOf([withdrawRow(home.id)]);
  const gone = await read(home.by);
  assert.ok(!gone.published.some((m) => m.id === home.id));
  assert.equal(gone.counts.published, base.counts.published - 1);
  const counts = await live.liveScope(() => tm.marksCountsFor(home.by, { repo: WORLD_CLONE, docketFor: nodocket }));
  assert.equal(counts.published, base.counts.published - 1, "marksCountsFor");
  const townwide = await live.liveScope(() => tm.marksRead("", { repo: WORLD_CLONE, sort: "weight", limit: 200, docketFor: nodocket }));
  assert.equal(townwide.counts.published, marks.filter((m) => m?.id && m.by).length - 1, "the town-wide ranked read");
});

test("8 · the doorstep's stakes rows, asked for the house's own authors: the new body, no withdrawn mark; another house's rows are canon's", async () => {
  const { stakesFor } = await import("../src/doorstep-stakes.mjs");
  const readers = { world: async () => ({ state: WORLD, ref: "refs/tags/settlement/S1" }), registry: async () => ({}), escrow: async () => ({ townSha: "x", byMark: new Map(), ingestedAt: null }), rule: async () => () => ({ unpublish: false }), pathAt: async () => () => null, allocationPage: false };
  stateOf([amendRow("wright/the-drafting-table", "wright's new words"), withdrawRow("wright/the-keystone")]);
  store.statements.length = 0;
  await live.liveScope(async () => {
    const mine = await stakesFor(["wright"], readers);
    assert.deepEqual(mine.rows.map((r) => [r.mark, r.body]), [["wright/the-drafting-table", "wright's new words"]]);
    const other = await stakesFor(["ada"], readers);
    assert.deepEqual(other.rows.map((r) => r.mark).sort(), ["ada/a-lamp", "ada/a-lantern"]);
  });
  assert.equal(store.statements.filter((s) => s === "watch").length, 1, "two houses composed in one request: one watch");
});

test("9 · the household media: an amendment that adds a media URL is embedded now, a withdrawn mark's URL is not", async () => {
  const { embeddedScan } = await import("../src/household-media.mjs");
  const { publishedState } = await import("../src/world-branches.mjs");
  const { WORLD_CLONE } = await import("../src/world.mjs");
  const marks = publishedState(WORLD_CLONE).state?.marks ?? [];
  const home = marks.find((m) => m.tier === "home" && m.kind !== "parcel" && typeof m.body === "string" && m.by);
  assert.ok(home, "the pinned world holds an own-parcel mark");
  const URL = "https://media.example/uploads/live-parcel-probe.png";
  stateOf([{ ...amendRow(home.id, `${home.body} ${URL}`) }]);
  const withAmend = await live.liveScope(() => embeddedScan({ handles: [home.by], clone: null, urls: new Set([URL]) }));
  assert.ok(withAmend.hits.has(URL), "the amended body's URL is embedded");
  stateOf([]);
  const without = await live.liveScope(() => embeddedScan({ handles: [home.by], clone: null, urls: new Set([URL]) }));
  assert.ok(!without.hits.has(URL), "and not once the store owes nothing");
  stateOf([withdrawRow(home.id)]);
  const urlOfHome = (home.body.match(/https?:\/\/\S+/) ?? [])[0];
  if (urlOfHome) {
    const gone = await live.liveScope(() => embeddedScan({ handles: [home.by], clone: null, urls: new Set([urlOfHome]) }));
    assert.ok(!gone.hits.has(urlOfHome), "a withdrawn mark's URL is not embedded");
  }
});
