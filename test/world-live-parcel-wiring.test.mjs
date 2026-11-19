// world-live-parcel-wiring.test.mjs — POS-686: the layer, through the readers a viewer actually asks, with the store's rows behind them.
//
//   node --test test/world-live-parcel-wiring.test.mjs
//
// world-live-parcel.test.mjs holds the rules and the SQL. THIS file is the wiring: the real `worldFind`, `worldInvestigate`, `worldEyes` (the telling),
// `placeWords`, `markRows`, `placeMarksAt`, `marksRead` (the town's marks), `stakesFor` and `embeddedScan` (the household media), each reading through the
// office's own store read (`actsQuery`) from a store that holds the owed rows. A reader whose call into the layer is removed goes red here, and the cases
// name what each oracle is:
//
//   · SCOPE: an author's market mark, and a mark WELCOMED onto another household's parcel (the standing walk calls it `home`), are edited and withdrawn in
//     the store; every reader still serves canon's body, the mark, and its name in the telling; an own-ground mark beside them goes live.
//   · CACHE BOUNDARY, through the PRODUCTION `world()` (no world seam: the seam returns before anything an edit could swap, so a leg behind it cannot see
//     the swap): another owner's edit appears, and `world()`'s marks array and every world-keyed derived index (the id, ground, room and interior
//     indexes, counted where they are built) are exactly as they were. The leg also builds the OLD swap in a shadow and shows this oracle goes red on it.
//   · EXISTENCE: a withdrawn mark is not served, and not NAMED (the telling's band lines and within chain, the place words), as records and telling agree.

import test, { after, before } from "node:test";
import assert from "node:assert/strict";

process.env.WORLD2_PG = "1";
process.env.WORLD2_PG_URL = "postgres://live-parcel-wiring/none";
const office = await import("../src/world.mjs");
const acts = await import("../src/world2-acts.mjs");
const live = await import("../src/world-live-parcel.mjs");

const mk = (id, by, house, x, y, body, over = {}) => ({ id, kind: "sited", by, household: by, declared_household: house, tier: "home", at: { x, y }, extent: { w: 2, h: 2 }, body, date: "2026-09-02T00:00:00Z", ...over });
const parcel = (id, by, house, x, y, over = {}) => mk(id, by, house, x, y, `${id} parcel`, { kind: "parcel", extent: { w: 100, h: 100 }, ...over });
const MARKS = [
  parcel("wright/the-yard", "wright", "hh:starforge", 50, 50),
  mk("wright/the-drafting-table", "wright", "hh:starforge", 10, 10, "A tilted sheet of working drawings."),
  mk("wright/the-keystone", "wright", "hh:starforge", 20, 20, "A keystone."),
  parcel("ada/the-plot", "ada", "hh:ada", 350, 350),
  mk("ada/a-lamp", "ada", "hh:ada", 305, 305, "A lamp on ada's own ground."),
  mk("ada/a-lantern", "ada", "hh:ada", 310, 310, "A lantern on ada's own ground."),
  parcel("bea/the-yard", "bea", "hh:bea", 650, 650, { consent: { "ada/ada-stall": "welcomed" } }),
  mk("ada/ada-stall", "ada", "hh:ada", 605, 605, "Ada's stall, welcomed onto bea's ground."), // the walk's verdict for it is `home`; it is not ada's parcel
  mk("alden/the-alder-at-the-green-lamp", "alden", "hh:alden", 900, 900, "An alder stands beside the green lamp.", { tier: "market" }),
];
const WORLD = { marks: MARKS };
const ALDER = "alden/the-alder-at-the-green-lamp", STALL = "ada/ada-stall";

// the store, as the office reads it: the two statements the layer makes, counted
let owed = [];
const store = { watch: { mark_acts: 1, mark_act: 1, window_top: 321, window_closed: 320, clearing: 0 }, statements: [] };
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
const stateOf = (rows) => { owed = rows; store.watch = { ...store.watch, mark_acts: store.watch.mark_acts + 1, mark_act: store.watch.mark_act + 1 }; };

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

test("2 · AMEND (own ground): every serving reader carries the new body, for anonymous and keyed callers, and canon's own mark is not edited", async () => {
  stateOf([amendRow("wright/the-drafting-table", "A new sheet, re-inked between crossings.")]);
  await live.liveScope(async () => {
    assert.equal((await rowOf("wright/the-drafting-table")).body, "A new sheet, re-inked between crossings.", "markRows");
    for (const key of [null, { handles: new Set(["wright"]), household: "wright" }]) {
      const inv = await office.worldInvestigate({ mark: "wright/the-drafting-table" }, key);
      assert.match(JSON.stringify(inv), /re-inked between crossings/, `investigate (${key ? "keyed" : "anonymous"})`);
      assert.doesNotMatch(JSON.stringify(inv), /tilted sheet of working drawings/);
    }
  });
  assert.equal(MARKS[1].body, "A tilted sheet of working drawings.", "canon is not edited");
});

test("3 · WITHDRAW (own ground, dependency-free): gone from every serving reader, anonymous and keyed", async () => {
  stateOf([withdrawRow("wright/the-keystone")]);
  await live.liveScope(async () => {
    assert.equal(await rowOf("wright/the-keystone"), null, "markRows");
    for (const key of [null, { handles: new Set(["wright"]), household: "wright" }]) {
      const inv = await office.worldInvestigate({ mark: "wright/the-keystone" }, key);
      assert.equal(inv.error, "bounce", `investigate (${key ? "keyed" : "anonymous"})`);
      assert.doesNotMatch(JSON.stringify(await office.worldFind({ q: "keystone" }, key)), /wright\/the-keystone/, "find");
    }
    assert.doesNotMatch(JSON.stringify(await office.placeMarksAt({ x: 21, y: 21 })), /the-keystone/, "place words");
    assert.match(JSON.stringify(await office.placeMarksAt({ x: 11, y: 11 })), /the-drafting-table/, "an unedited neighbour is still named");
  });
});

test("4 · SCOPE, the market probe and the WELCOMED probe: a market mark, and a mark welcomed onto another household's parcel, edited AND withdrawn in the store, are served as canon in every reader; the own-ground mark beside them goes live", async () => {
  stateOf([amendRow(ALDER, "SYNTHETIC LIVE BODY"), withdrawRow(ALDER), amendRow(STALL, "SYNTHETIC WELCOMED BODY"), withdrawRow(STALL), amendRow("wright/the-drafting-table", "The own-ground positive.")]);
  await live.liveScope(async () => {
    for (const [id, canonBody, word, x] of [[ALDER, "An alder stands beside the green lamp.", "alder", 901], [STALL, "Ada's stall, welcomed onto bea's ground.", "stall", 606]]) {
      assert.equal((await rowOf(id)).body, canonBody, `markRows ${id}`);
      const inv = JSON.stringify(await office.worldInvestigate({ mark: id }, null));
      assert.match(inv, new RegExp(canonBody.slice(0, 20))); assert.doesNotMatch(inv, /SYNTHETIC/);
      assert.match(JSON.stringify(await office.worldFind({ q: word }, null)), new RegExp(id), "still found: a withdrawal off the author's own parcel waits for the settlement");
      assert.match(JSON.stringify(await office.placeMarksAt({ x, y: x })), new RegExp(canonBody.slice(0, 20)));
    }
    assert.equal((await rowOf("wright/the-drafting-table")).body, "The own-ground positive.", "the positive control, in the same read");
  });
});

test("5 · SCOPE on the pinned world's real canon: the real market mark is no candidate and no edit; real own-ground marks are both; the real walk's welcomed case would be settled", async () => {
  const { publishedState } = await import("../src/world-branches.mjs");
  const { WORLD_CLONE } = await import("../src/world.mjs");
  const marks = publishedState(WORLD_CLONE).state?.marks ?? [];
  const contains = await office.liveParcelContains();
  assert.equal(typeof contains, "function", "the engine's containment is available");
  const own = live.ownGroundIds(marks, contains);
  const market = marks.find((m) => m.id === ALDER) ?? marks.find((m) => m.tier === "market" && m.kind !== "parcel");
  const home = marks.find((m) => own.has(m.id) && m.kind !== "parcel" && typeof m.body === "string");
  assert.ok(market && home && !own.has(market.id));
  const e = live.editsFrom([amendRow(market.id, "SYNTHETIC LIVE BODY"), withdrawRow(market.id), amendRow(home.id, "SYNTHETIC HOME BODY")], marks, own);
  assert.deepEqual([...e.bodies.keys()], [home.id]);
  assert.equal(e.removed.size, 0);
  // the welcomed case on the REAL canon: plant one welcome in a copy of a real parcel and a real mark of another household inside it
  const [guestHome, hostHome] = [home, marks.find((m) => m.kind === "parcel" && m.declared_household && m.declared_household !== home.declared_household && own.has(m.id))];
  const guest = { ...guestHome, id: "guest/planted", by: "guest", declared_household: "hh:guest-planted", at: hostHome.at, extent: { w: 1, h: 1 }, tier: "home" };
  assert.equal(live.ownGroundIds([...marks, guest], contains).has("guest/planted"), false, "a mark of another household standing on a parcel is not own ground");
  const asked = [];
  await live.liveEdits(marks, { contains, query: async (sql, p) => (sql === live.watchSql ? [store.watch] : (asked.push(...p[0]), [])) });
  assert.ok(asked.includes(home.id) && !asked.includes(market.id), "the store is asked about own-ground marks only");
});

test("6 · CACHE BOUNDARY through the PRODUCTION world(): another owner's edit replaces nothing and rebuilds nothing at the world-keyed caches; the old swap would fail this", async () => {
  office.__setWorldForTest(null); // the real `world()`: assembled from the pinned clone, cached, the object every reader shares
  try {
    const { publishedState } = await import("../src/world-branches.mjs");
    const { WORLD_CLONE } = await import("../src/world.mjs");
    const real = publishedState(WORLD_CLONE).state.marks;
    const own = live.ownGroundIds(real, await office.liveParcelContains());
    const sample = (house) => real.find((m) => own.has(m.id) && m.kind !== "parcel" && m.declared_household === house && m.at);
    const houses = [...new Set(real.filter((m) => own.has(m.id) && m.kind !== "parcel" && m.at).map((m) => m.declared_household))];
    const A = sample(houses[0]), B = sample(houses[1]), C = sample(houses[2]);
    assert.ok(A && B && C && new Set([A.by, B.by, C.by]).size === 3, "three different owners' own-ground marks on the pinned world");
    stateOf([]);
    const warm = async () => { await office.markRows([B.id]); await office.reachableBy(B.by); await office.worldFind({ q: B.id.split("/")[1].split("-")[1] ?? "a" }, null); await office.worldInvestigate({ mark: B.id }, null); await office.worldEyes({ x: B.at.x, y: B.at.y }, null, {}); };
    await live.liveScope(warm);
    const builds0 = office.__derivedBuildsForTest();
    const canonMarks = await office.worldMarksAll();
    for (const rows of [[amendRow(A.id, "A's new words")], [amendRow(C.id, "C's new words")], [withdrawRow(A.id), withdrawRow(C.id)]]) {
      stateOf(rows);
      await live.liveScope(warm);
      assert.deepEqual(office.__derivedBuildsForTest(), builds0, "no world-keyed index was built again");
      assert.strictEqual(await office.worldMarksAll(), canonMarks, "world() is the same object: its marks are the same array");
    }
    // and the edits are real in the same state: the served reads carry them
    stateOf([amendRow(A.id, "A's new words")]);
    await live.liveScope(async () => assert.equal((await office.markRows([A.id]))[0].body, "A's new words"));
    stateOf([withdrawRow(A.id)]);
    await live.liveScope(async () => assert.equal((await office.markRows([A.id]))[0] ?? null, null));

    // THE OLD SWAP, in a shadow: what `world()` did at a39a5265 (`{ ...canon, marks: overlay }` per edit set) is a NEW object, so the world-keyed WeakMaps
    // (keyed on the object a reader holds) would be rebuilt once per edit set. The same oracle, handed that world, goes red:
    stateOf([withdrawRow(A.id), withdrawRow(C.id)]);
    const edits = await live.liveEdits(real);
    assert.ok(edits.key);
    const swapped = { marks: live.overlayMarks(canonMarks, edits) };
    assert.notStrictEqual(swapped.marks, canonMarks, "the old swap's marks array is a different array");
    office.__setWorldForTest(swapped);
    try {
      await live.liveScope(async () => { await office.markRows([B.id]); await office.reachableBy(B.by); });
      assert.notDeepEqual(office.__derivedBuildsForTest(), builds0, "THE OLD SWAP REBUILDS THE WORLD-KEYED INDEXES, and this oracle sees it");
      assert.notStrictEqual(await office.worldMarksAll(), canonMarks, "and the shared world is a different object");
    } finally { office.__setWorldForTest(null); }
  } finally { office.__setWorldForTest(WORLD); }
});

test("7 · the town's marks read (real canon): the owner's published list carries the new body, then loses a withdrawn mark; another house's list is canon's", async () => {
  const tm = await import("../src/town-marks.mjs");
  const { publishedState } = await import("../src/world-branches.mjs");
  const { WORLD_CLONE } = await import("../src/world.mjs");
  const marks = publishedState(WORLD_CLONE).state?.marks ?? [];
  const own = live.ownGroundIds(marks, await office.liveParcelContains());
  const home = marks.find((m) => own.has(m.id) && m.kind !== "parcel" && typeof m.body === "string" && m.by);
  const other = marks.find((m) => m.by && m.by !== home.by && own.has(m.id));
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
    assert.deepEqual(mine.rows.map((r) => [r.mark, r.body]).sort(), [["wright/the-drafting-table", "wright's new words"], ["wright/the-yard", "wright/the-yard parcel"]].sort());
    const other = await stakesFor(["ada"], readers);
    assert.deepEqual(other.rows.map((r) => r.mark).sort(), ["ada/a-lamp", "ada/a-lantern", "ada/ada-stall", "ada/the-plot"]);
  });
  assert.equal(store.statements.filter((s) => s === "watch").length, 1, "two houses composed in one request: one watch");
});

test("9 · the household media: an amendment that adds a media URL is embedded now, a withdrawn mark's URL is not", async () => {
  const { embeddedScan } = await import("../src/household-media.mjs");
  const { publishedState } = await import("../src/world-branches.mjs");
  const { WORLD_CLONE } = await import("../src/world.mjs");
  const marks = publishedState(WORLD_CLONE).state?.marks ?? [];
  const own = live.ownGroundIds(marks, await office.liveParcelContains());
  const home = marks.find((m) => own.has(m.id) && m.kind !== "parcel" && typeof m.body === "string" && m.by);
  assert.ok(home, "the pinned world holds an own-ground mark");
  const URL = "https://media.example/uploads/live-parcel-probe.png";
  stateOf([amendRow(home.id, `${home.body} ${URL}`)]);
  const withAmend = await live.liveScope(() => embeddedScan({ handles: [home.by], clone: null, urls: new Set([URL]) }));
  assert.ok(withAmend.hits.has(URL), "the amended body's URL is embedded");
  stateOf([]);
  const without = await live.liveScope(() => embeddedScan({ handles: [home.by], clone: null, urls: new Set([URL]) }));
  assert.ok(!without.hits.has(URL), "and not once the store owes nothing");
});

test("10 · EXISTENCE AGREES (real canon, real engine): a withdrawn own-ground mark is not NAMED in the eyes' telling or the place words, as it is in no record; the geometry and everyone else's lines are the engine's", async () => {
  office.__setWorldForTest(null);
  try {
    const { publishedState } = await import("../src/world-branches.mjs");
    const { WORLD_CLONE } = await import("../src/world.mjs");
    const real = publishedState(WORLD_CLONE).state.marks;
    const own = live.ownGroundIds(real, await office.liveParcelContains());
    const leaf = real.find((m) => m.id === "wright/the-keystone") ?? real.find((m) => own.has(m.id) && m.kind !== "parcel" && m.at);
    assert.ok(leaf && own.has(leaf.id));
    const at = { x: leaf.at.x, y: leaf.at.y };
    stateOf([]);
    const before = await live.liveScope(async () => ({ eyes: await office.worldEyes(at, null, {}), place: await office.placeWords(at) }));
    assert.ok(before.eyes.telling.includes(`[${leaf.id}`), "canon's telling names the mark");
    const slugWord = leaf.id.split("/")[1].split("-").pop();
    assert.match(String(before.place), new RegExp(slugWord, "i"), "canon's place words name it");
    stateOf([withdrawRow(leaf.id)]);
    const after = await live.liveScope(async () => ({ eyes: await office.worldEyes(at, null, {}), place: await office.placeWords(at), rows: await office.markRows([leaf.id]), names: await office.worldFind({ q: leaf.id.split("/")[1] }, null) }));
    assert.ok(!after.eyes.telling.includes(`[${leaf.id}`), "the telling does not name the withdrawn mark");
    assert.doesNotMatch(String(after.place), new RegExp(slugWord, "i"), "nor do the place words");
    assert.equal(after.rows.length, 0, "and no record carries it");
    assert.doesNotMatch(JSON.stringify(after.names), new RegExp(leaf.id));
    assert.ok(!(after.eyes.objects ?? []).some((o) => o.id === leaf.id), "nor the compact objects");
    // everything else the engine said is the engine's: the telling differs only by the mark's own lines
    const lines = (t) => t.split("\n");
    const dropped = lines(before.eyes.telling).filter((l) => !lines(after.eyes.telling).includes(l));
    assert.ok(dropped.length >= 1 && dropped.every((l) => l.includes(`[${leaf.id}`)), "only lines naming the mark went: " + JSON.stringify(dropped));
    // names, never quotes (POS-393): no body in the telling before or after
    assert.ok(!before.eyes.telling.includes(String(leaf.body).slice(0, 25)) && !after.eyes.telling.includes(String(leaf.body).slice(0, 25)));
    // a mark off the author's own ground keeps its name in the telling, withdrawn in the store or not
    const market = real.find((m) => m.tier === "market" && m.kind !== "parcel" && m.at && !own.has(m.id));
    stateOf([withdrawRow(market.id)]);
    const kept = await live.liveScope(() => office.worldEyes({ x: market.at.x, y: market.at.y }, null, {}));
    assert.ok(kept.telling.includes(`[${market.id}`), "a market mark is still named");
  } finally { office.__setWorldForTest(WORLD); }
});
