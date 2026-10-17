// read-carries-its-records.test.mjs — falsifiers for `records` (2026-09-10).
//
// THE PROMISE, stated as a biconditional so it can fail in both directions:
//
//   every id this response NAMES has a record here,
//   and every record here is either NAMED by this response or on the town's
//   ground set — and nothing else.
//
// A field that carried too much would be the fold creeping back in through a
// door built to avoid it; a field that carried too little would leave a reader
// holding an id it cannot resolve, which is the exact gap `records` exists to
// close. One-directional tests would pass against both defects, so neither is
// written that way.
//
// THE GROUND SET IS COMPUTED HERE FROM THE RECORD, not read back out of
// world.mjs. A test that asked the implementation what the ground is would
// assert that the implementation agrees with itself. So this file does the join
// again, from `REGION_SLUGS` and the skeleton's own water selection — the two
// sources the viewer's `townRegionMarks`/`townWaterShapes` read — and compares.
//
//   node --test test/read-carries-its-records.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { WORLD_CLONE, markRecords, worldEyes } from "../src/world.mjs";
import { STRIDE_MARK_ID } from "../src/world-classes.mjs";

const HAVE_WORLD = existsSync(join(WORLD_CLONE, "tools", "region-outsiders.mjs"))
  && existsSync(join(WORLD_CLONE, "WORLD", "world-state.json"));
const NO_WORLD = `no world clone at ${WORLD_CLONE}`;

// Five standpoints across the town, chosen so the radial is not the same set
// twice: the quay, a hill home, the threshold flats, the far south-east, and
// the locks. A falsifier that only ever saw one standpoint would be asserting
// about one radial, not about the door.
const STANDPOINTS = [
  ["the quay", { x: 0, y: 0 }],
  ["wright's terrace", { x: 888, y: -2320 }],
  ["the threshold district", { x: 1358, y: 1821 }],
  ["aelyria", { x: 4075, y: 5050 }],
  ["the long run", { x: 1513, y: 4888 }],
];

// The ground, joined here from the record's own two rosters.
async function groundFromTheRecord() {
  const tools = (f) => import(pathToFileURL(join(WORLD_CLONE, "tools", f)));
  const [{ REGION_SLUGS }, { polygonOf }, { waterFeatures, seaFeature }, { assembleWorld }] =
    await Promise.all([tools("region-outsiders.mjs"), tools("geometry.mjs"),
      tools("water.mjs"), tools("world-build.mjs")]);
  const { readFileSync } = await import("node:fs");
  const worldState = JSON.parse(readFileSync(join(WORLD_CLONE, "WORLD", "world-state.json"), "utf8"));
  const skeleton = JSON.parse(readFileSync(join(WORLD_CLONE, "WORLD", "skeleton.json"), "utf8"));
  const w = assembleWorld({ worldState, skeleton });
  const SENTINEL = 50000;
  const ringed = (m) => {
    const r = m ? polygonOf(m) : null;
    if (!r?.length) return false;
    return !r.some((p) => Math.abs(p.x) > SENTINEL || Math.abs(p.y) > SENTINEL);
  };
  const slugOf = (m) => String(m?.id ?? "").split("/")[1];
  const ids = new Set();
  for (const slug of REGION_SLUGS) {
    const mark = w.marks.find((m) => slugOf(m) === slug && ringed(m));
    if (mark) ids.add(mark.id);
  }
  const feats = [...waterFeatures(skeleton)];
  const sea = seaFeature(skeleton);
  if (sea && !feats.some((f) => f.id === sea.id)) feats.push(sea);
  for (const f of feats) {
    const mark = w.marks.find((m) => slugOf(m) === f.id && ringed(m));
    if (mark) ids.add(mark.id);
  }
  return { ids, regions: REGION_SLUGS.length, marks: w.marks.length };
}

test("FALSIFIER 1 — every id the read NAMES has its record", async (t) => {
  if (!HAVE_WORLD) return t.skip(NO_WORLD);
  let checked = 0;
  for (const [where, at] of STANDPOINTS) {
    const read = await worldEyes(at);
    assert.ok(read.objects?.length, `${where}: the radial named nothing — this falsifier would be vacuous`);
    for (const o of read.objects) {
      assert.ok(Object.hasOwn(read.records, o.id),
        `${where}: the read names ${o.id} and carries no record for it`);
      assert.equal(read.records[o.id].id, o.id, `${where}: ${o.id}'s record is somebody else's`);
      checked++;
    }
  }
  assert.ok(checked >= 25, `only ${checked} named ids across five standpoints — too thin to falsify anything`);
});

test("FALSIFIER 2 — and NOTHING ELSE: every record is named or is ground", async (t) => {
  if (!HAVE_WORLD) return t.skip(NO_WORLD);
  const ground = await groundFromTheRecord();
  for (const [where, at] of STANDPOINTS) {
    const read = await worldEyes(at);
    const named = new Set(read.objects.map((o) => o.id));
    for (const id of Object.keys(read.records)) {
      assert.ok(named.has(id) || ground.ids.has(id),
        `${where}: \`records\` carries ${id}, which this read never named and which is not the town's ground `
        + `— the fold is coming back through the door`);
    }
    // and the two sets together are the WHOLE of it: no third source
    assert.equal(Object.keys(read.records).length,
      new Set([...named, ...ground.ids]).size,
      `${where}: the record count does not equal |named ∪ ground|`);
  }
});

test("FALSIFIER 3 — the ground set is there, whole, and is not the fold", async (t) => {
  if (!HAVE_WORLD) return t.skip(NO_WORLD);
  const ground = await groundFromTheRecord();
  const bare = await markRecords([]);          // no ids named at all: the ground alone (no class by name, falsifier 5)
  const ids = new Set(Object.keys(bare));
  assert.deepEqual([...ids].sort(), [...ground.ids].sort(),
    "the ground the door carries is not the ground the record describes");
  // WHOLE: every region on the roster is present. A ground missing one region
  // paints a town with a hole in the floor, and nothing else would say so.
  assert.ok(ids.size >= ground.regions,
    `${ids.size} ground marks for ${ground.regions} regions — a region's ring is missing`);
  // AND NOT THE FOLD: this is the bound that makes the whole field worth having.
  // Stated as a ratio against the live record rather than a magic number, so it
  // cannot quietly pass by the town shrinking.
  assert.ok(ids.size < ground.marks / 10,
    `the ground set is ${ids.size} of ${ground.marks} marks — that is a fold, not a floor`);
  for (const id of ids) assert.equal(bare[id].id, id);
});

test("FALSIFIER 4 — a read with the ground set gone is DETECTABLY gone", async (t) => {
  if (!HAVE_WORLD) return t.skip(NO_WORLD);
  // The flip this file's other tests are checked against: if `records` ever
  // stopped carrying the ground, falsifier 3's deepEqual is what catches it.
  // Here that is asserted as a property rather than trusted: the named-only
  // half of a read is strictly smaller than the whole, and by the ground's size.
  const ground = await groundFromTheRecord();
  const read = await worldEyes({ x: 888, y: -2320 });
  const named = new Set(read.objects.map((o) => o.id));
  const namedOnly = [...Object.keys(read.records)].filter((id) => named.has(id));
  assert.ok(Object.keys(read.records).length > namedOnly.length,
    "the ground contributes nothing to this read — falsifier 3 could not tell a missing floor from a present one");
  assert.equal(Object.keys(read.records).length,
    new Set([...namedOnly, ...ground.ids]).size);
});

test("FALSIFIER 5 — NO CLASS RIDES BY NAME (WLD-29, the pointer model): the mover's class is in `records` only where the read names it", async (t) => {
  // 2026-09-13 to 2026-10-13 the resident class rode every read by name, so a
  // page could price a walk from records["the-town/resident"].dials. The
  // approved rework (Wright, AUTHORITY 2026-10-13T19:16:02.257Z) takes it out
  // of every default read, on both apex paths: a page asks GET /world/dials,
  // and an agent's walk card is priced from the class's own dial. A class mark
  // has no place, so no standpoint names it — so it is in no read's records.
  if (!HAVE_WORLD) return t.skip(NO_WORLD);
  for (const [where, at] of STANDPOINTS) {
    const read = await worldEyes(at);
    assert.ok(!read.objects.some((o) => o.id === STRIDE_MARK_ID), `${where}: the radial named the class — this falsifier would be vacuous`);
    assert.ok(!Object.hasOwn(read.records, STRIDE_MARK_ID), `${where}: \`records\` carries ${STRIDE_MARK_ID}, which this read never named`);
    assert.ok(!("dials" in read), `${where}: a town-wide dial table rides the read`);
  }
  // ⚑ THE FLIP: put STRIDE_MARK_ID back on markRecords' list → this and
  //   FALSIFIERS 2–4 red on every standpoint.

  // ⚑ THE CLASS LAYER PRODUCTION READS (LOGOS v2, W1 G3/G5), for the page's
  // table: on a world that files the pace as a `kind: property` node (W2), the
  // class mark carries no `dials:` of its own, and GET /world/dials takes it
  // from the class layer (read-digests.mjs § dialsDigestOf). The class layer is
  // the law snapshot, seeded from the same checkout the fold reads, as the
  // train's version of this test did for `records` before WLD-29 took the class
  // out of them. On the world CI pins the frontmatter carries the pace either way.
  const { deriveLaw } = await import("../world2/tools/law-ingest.mjs");
  const { reloadLawSnapshot, resetLawSnapshot, LAW_REFRESH_SQLS } = await import("../src/law-snapshot.mjs");
  const { resetClassRosterCache } = await import("../src/world-classes.mjs");
  const { rows } = await deriveLaw({ lawRepo: WORLD_CLONE });
  const law = rows.map((r) => ({ number: 1, tag_sha: "f".repeat(40), newest: 1, ...r }));
  // the store answers the two statements a refresh sends, and nothing else
  const answers = new Map([[LAW_REFRESH_SQLS.pin, [{ newest: 1, pinned: 1 }]], [LAW_REFRESH_SQLS.law, law]]);
  await reloadLawSnapshot({ force: true, query: async (sql) => {
    if (!answers.has(sql)) throw new Error(`the law stub was asked a statement it does not answer: ${String(sql).slice(0, 80)}`);
    return { rows: answers.get(sql) };
  } });
  resetClassRosterCache();
  try {
    const { worldDialsPage } = await import("../src/world.mjs");
    const page = await worldDialsPage();
    const pace = Number(page.dials?.[STRIDE_MARK_ID]?.pace_km_per_crossing);
    assert.ok(Number.isFinite(pace) && pace > 0, `GET /world/dials carries no pace for ${STRIDE_MARK_ID} (${pace})`);
  } finally { resetLawSnapshot(); resetClassRosterCache(); }
  // ⚑ THE FLIP: drop the class layer from worldDialsPage (classDialsOf) → the
  //   pace assertion reds ONLY on W2, with the seed above in place: on the world
  //   CI pins the class mark's own `dials:` carries the pace, so it stays green.
});
