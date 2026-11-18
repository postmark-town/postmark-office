// mark-footprint-caps.test.mjs — the ruled footprint caps at the writing doors (POS-1126, WLD-193).
//
// Darko, 2026-11-17: "yeah 256 is good" (a mark's 2D `points:` outline). 2026-11-18 09:28 EST: "Cap at 2 km a side"
// (a resident's mark on common ground; a parcel keeps its own extent dial). Wright: "World owns the law, and Rivet owns
// the writing doors." The numbers are two properties of the class `mark` (Bevel, 2026-11-18: `outline-point-cap` = 256,
// `common-ground-side-cap` = 2000 m per planar side), read through the existing law reader (classDials). The office
// holds no number: every limit below is a property of the LAW FIXTURE the test loads, and moving the property moves it.
//
// Every house, handle and mark here is INVENTED, except that the amend legs run on a real resident mark of the pinned
// world clone (the way town-centre-amend.test.mjs does), against an embedded store.
//
//   F1  the rule, pure: the boundaries (256/257, 2000/2001 each side), the dial read, the scope exemptions, what an
//       existing over-cap record may keep, and the words
//   F2  THE DOOR, REAL: leave-mark through leaveMarkViaOffice — 257 points, width 2001, depth 2001 refuse with the cap
//       named; 256 and 2000 pass; `preview: true` answers the SAME refusal and writes nothing (no act, no draft)
//   F3  NO HIDDEN CONSTANT: the same marks under a changed property default, and under no property at all
//   F4  AMENDMENTS: a real resident mark amended over the cap refuses (on a lowered law, so the existing record
//       is itself over it); keeping or shrinking what it already was is allowed; growing is not
//   F5  THE DIRECT CALLERS: the journal pass refuses for an event's spark-free declaration and a town tool's call the
//       same way (preview and write), and a parcel, a spark and the town's own mark are not judged by the side cap
//
//   node --import ./test/helpers/sparse-guard.mjs --test --test-concurrency=1 test/mark-footprint-caps.test.mjs

import { after, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { startStore } from "./helpers/embedded-store.mjs";
import { footprintCaps, footprintRefusal, pointCount, sidesOf } from "../src/mark-footprint.mjs";

const CLONE = join(process.cwd(), "world-clone");
const SKIP = !existsSync(CLONE) && "no pinned world clone in this tree";
const store = await startStore({ db: "mark_footprint_caps" });
const FLAGS = ["WORLD2_PG", "WORLD2_PG_URL", "W2_PEN", "W2_GUARDS", "WORLD_CLONE"];
const saved = Object.fromEntries(FLAGS.map((k) => [k, process.env[k]]));
Object.assign(process.env, { WORLD2_PG: "1", WORLD2_PG_URL: store.url("office_api"), W2_PEN: "mark", W2_GUARDS: "1", WORLD_CLONE: CLONE });
const { reloadLawSnapshot, resetLawSnapshot, LAW_REFRESH_SQLS } = await import("../src/law-snapshot.mjs");
after(async () => {
  resetLawSnapshot();
  for (const k of FLAGS) { if (saved[k] == null) delete process.env[k]; else process.env[k] = saved[k]; }
  await store.stop();
});

// ── the law fixture: the class `mark` and its two properties (WLD-196's shape), plus the parcel's own dial ──────────
const SHA = "d".repeat(40);
const classRow = (key, data = {}) => ({ number: 281, tag_sha: SHA, newest: 281, kind: "class", key, data: { class: key, ...data } });
const propRow = (klass, name, dflt, id) => ({ number: 281, tag_sha: SHA, newest: 281, kind: "property", key: `${klass}/${name}`, data: { class: klass, parent: null, name, tier: "constitution", default: dflt, id } });
async function lawWith({ points = 256, side = 2000 } = {}) {
  const rows = [classRow("mark"), classRow("parcel"), propRow("parcel", "extent_m", 25, "the-town/parcel-extent-m"),
    ...(points == null ? [] : [propRow("mark", "outline-point-cap", points, "the-town/mark-outline-point-cap")]),
    ...(side == null ? [] : [propRow("mark", "common-ground-side-cap", side, "the-town/mark-common-ground-side-cap")])];
  await reloadLawSnapshot({ force: true, query: async (sql) => ({ rows: sql === LAW_REFRESH_SQLS.pin ? [{ newest: 281, pinned: 281 }] : rows }) });
  const { resetClassRosterCache } = await import("../src/world-classes.mjs");
  resetClassRosterCache();
}

// A ring of n points inside a w×h box, centred on (cx, cy): the four corners, then n-4 points along the top edge.
const ring = (n, w = 100, h = 100, cx = 40000, cy = 40000) => {
  const pts = [[cx - w / 2, cy - h / 2], [cx + w / 2, cy - h / 2], [cx + w / 2, cy + h / 2], [cx - w / 2, cy + h / 2]];
  for (let i = 0; pts.length < n; i++) pts.push([cx - w / 2 + (w * (i + 1)) / (n + 1), cy - h / 2]);
  return pts;
};
const box = (w, h, cx = 40000, cy = 40000) => ring(4, w, h, cx, cy);

// ── F1 the rule, pure ───────────────────────────────────────────────────────

test("F1 · the rule: the boundaries, the dial read, the scope, what an existing record may keep, and the words", () => {
  const caps = footprintCaps({ "outline-point-cap": 256, "common-ground-side-cap": 2000 });
  assert.deepEqual(caps, { points: 256, side: 2000 });
  assert.deepEqual(footprintCaps({}), { points: null, side: null }, "no property, no boundary: the office holds no number");
  assert.deepEqual(footprintCaps({ "outline-point-cap": "x", "common-ground-side-cap": 0 }), { points: null, side: null }, "a value that is no positive number is no boundary");
  assert.equal(pointCount(ring(256)), 256);
  assert.deepEqual(sidesOf({ points: box(2000, 1500) }), { w: 2000, h: 1500 }, "the ring's own box");
  assert.deepEqual(sidesOf({ extent: { w: 30, h: 20 } }), { w: 30, h: 20 });
  const judge = (c, o = {}) => footprintRefusal(c, { caps, ...o });
  assert.equal(judge({ points: ring(256) }), null, "256 points are permitted");
  assert.match(judge({ points: ring(257) }).defect, /^an outline holds at most 256 points; this one has 257$/);
  assert.equal(judge({ extent: { w: 2000, h: 2000 } }), null, "2000 m a side is permitted");
  assert.match(judge({ extent: { w: 2001, h: 100 } }).defect, /^a mark on common ground is at most 2000 m a side; this one is 2001 m wide$/);
  assert.match(judge({ extent: { w: 100, h: 2001 } }).defect, /2001 m deep$/);
  assert.match(judge({ points: box(2001, 100) }).defect, /2001 m wide/, "a ring is judged by its own box");
  assert.equal(judge({ extent: { w: 99999, h: 99999 } }, { sideScope: false }), null, "a parcel, a spark and the town's own marks are not judged by the side cap");
  assert.match(judge({ points: ring(257), extent: { w: 99999, h: 99999 } }, { sideScope: false }).defect, /257/, "but the point cap judges any ring");
  assert.equal(judge({ kind: "sited", body: "no footprint at all" }), null);
  // an existing record over a cap may be kept or shrunk, never grown, on the measure that is over
  const was = { extent: { w: 3000, h: 3000 } };
  assert.equal(judge({ extent: { w: 3000, h: 3000 } }, { prior: was }), null, "kept as it is");
  assert.equal(judge({ extent: { w: 2500, h: 3000 } }, { prior: was }), null, "shrunk");
  assert.match(judge({ extent: { w: 3001, h: 3000 } }, { prior: was }).defect, /3001 m wide/, "grown");
  assert.match(judge({ extent: { w: 2001, h: 100 } }, { prior: { extent: { w: 100, h: 100 } } }).defect, /2001/, "a mark that was inside the cap may not leave it");
  assert.equal(judge({ points: ring(300) }, { prior: { points: ring(300) } }), null);
  assert.match(judge({ points: ring(301) }, { prior: { points: ring(300) } }).defect, /301/);
});

// ── F2 the real door ────────────────────────────────────────────────────────

const actsCount = async () => {
  const { default: pg } = await import("pg");
  const c = new pg.Client({ connectionString: store.url("office_api") });
  await c.connect();
  try { return Number((await c.query("SELECT count(*)::int AS n FROM acts")).rows[0].n); }
  finally { await c.end(); }
};
const KEY = { household: "cap-fixture", handles: new Set(["cap-fixture"]) };
let n = 0;
const leave = async (payload, key = KEY) => {
  const { leaveMarkViaOffice } = await import("../src/world.mjs");
  return leaveMarkViaOffice(process.env.WORLD_CLONE, { kind: "sited", body: "a footprint fixture", slug: `fp-${process.pid}-${++n}`, ...payload }, key);
};
const refusal = (re) => (e) => e?.code === 422 && re.test(e.defect) && /Nothing was written/.test(e.hint);

test("F2 · THE DOOR: 257 points, width 2001 and depth 2001 refuse naming the cap; 256 and 2000 pass; a preview answers the same and writes nothing", { skip: SKIP }, async () => {
  await lawWith();
  for (const preview of [true, false]) {
    const tag = preview ? "preview" : "write";
    const before = await actsCount();
    await assert.rejects(leave({ points: ring(257), preview }), refusal(/an outline holds at most 256 points; this one has 257/), `${tag}: 257 points`);
    await assert.rejects(leave({ points: box(2001, 1000), preview }), refusal(/at most 2000 m a side; this one is 2001 m wide/), `${tag}: width 2001`);
    await assert.rejects(leave({ points: box(1000, 2001), preview }), refusal(/this one is 2001 m deep/), `${tag}: depth 2001`);
    await assert.rejects(leave({ at: { x: 40000, y: 40000 }, extent: { w: 2001, h: 10 }, preview }), refusal(/2001 m wide/), `${tag}: a bare extent is judged as well`);
    assert.equal(await actsCount(), before, `${tag}: a refusal writes nothing`);
  }
  const before = await actsCount();
  const ok = await leave({ points: ring(256, 2000, 2000), preview: true });
  assert.equal(ok.preview, true, `256 points over a 2000 × 2000 box previews: ${JSON.stringify(ok).slice(0, 300)}`);
  assert.equal(ok.would, "leave");
  assert.equal(await actsCount(), before, "the preview that passes writes nothing either: no act, no draft, no stake");
});

// ── F3 no hidden constant ───────────────────────────────────────────────────

test("F3 · NO HIDDEN CONSTANT: a changed property default changes the limit, and no property means no boundary", { skip: SKIP }, async () => {
  await lawWith({ points: 300, side: 3000 });
  const wider = await leave({ points: ring(257, 100, 100), preview: true });
  assert.equal(wider.preview, true, "257 points pass when the law says 300");
  assert.equal((await leave({ points: box(2001, 100), preview: true })).preview, true, "2001 m passes when the law says 3000");
  await assert.rejects(leave({ points: ring(301), preview: true }), refusal(/at most 300 points; this one has 301/), "and 301 refuses by the law's number");
  await assert.rejects(leave({ points: box(3001, 100), preview: true }), refusal(/at most 3000 m a side; this one is 3001 m wide/));
  await lawWith({ points: 100, side: 500 });
  await assert.rejects(leave({ points: ring(101), preview: true }), refusal(/at most 100 points; this one has 101/), "a lower default lowers it");
  await assert.rejects(leave({ points: box(501, 50), preview: true }), refusal(/at most 500 m a side/));
  await lawWith({ points: null, side: null });
  assert.equal((await leave({ points: ring(300, 5000, 5000), preview: true })).preview, true, "no property, no boundary: nothing is refused until the law says it");
  await lawWith({ points: 256, side: null });
  assert.equal((await leave({ points: box(9000, 9000), preview: true })).preview, true, "each cap is its own property");
  await assert.rejects(leave({ points: ring(257), preview: true }), refusal(/256/));
});

// ── F4 amendments ───────────────────────────────────────────────────────────

test("F4 · AMENDMENTS: over the cap refuses; an existing record over it may be kept or shrunk, never grown", { skip: SKIP }, async () => {
  const { canonForGuards } = await import("../src/world.mjs");
  const canon = canonForGuards();
  const real = canon.marks.find((m) => m.by !== "the-town" && m.kind === "sited" && m.at && m.extent && Number(m.extent.w) > 20 && Number(m.extent.w) < 1800
    && !m.points && String(m.id).startsWith(`${m.by}/`) && m.parent_id == null && m.household);
  assert.ok(real, "a resident's plain sited mark in the pinned canon");
  const slug = real.id.slice(real.by.length + 1);
  const key = { household: real.household, handles: new Set([real.by]) };
  const amend = (extent, extra = {}) => leave({ slug, by: real.by, at: real.at, extent, amend: true, preview: true, body: `${real.body ?? "a mark"} (amended)`, ...extra }, key);

  await lawWith({ points: 256, side: 2000 });
  await assert.rejects(amend({ w: 2001, h: real.extent.h }), refusal(/this one is 2001 m wide/), "an amendment may not grow a mark past the cap");
  await assert.rejects(amend({ w: real.extent.w, h: 2001 }), refusal(/2001 m deep/));
  await assert.rejects(leave({ slug, by: real.by, amend: true, preview: true, body: "ring", points: ring(257, 10, 10, real.at.x, real.at.y) }, key), refusal(/at most 256 points; this one has 257/));
  const same = await amend(real.extent);
  assert.equal(same.preview, true, `an amendment inside the cap previews: ${JSON.stringify(same).slice(0, 200)}`);

  // the law is lowered under the mark: its existing record is now OVER the cap, and stays
  const cap = Math.floor(Number(real.extent.w)) - 1;
  await lawWith({ points: 256, side: cap });
  const kept = await amend(real.extent);
  assert.equal(kept.preview, true, "an amendment that keeps the footprint it has is allowed: no resizing is asked of anyone");
  assert.equal((await amend({ w: Number(real.extent.w) - 1, h: real.extent.h })).preview, true, "shrinking it is allowed");
  await assert.rejects(amend({ w: Number(real.extent.w) + 1, h: real.extent.h }), refusal(new RegExp(`at most ${cap} m a side`)), "growing it is not");
  assert.equal(canonForGuards().byId.get(real.id).extent.w, real.extent.w, "and the stored record is exactly as it was");
});

// ── F5 the direct callers and the scope ─────────────────────────────────────

test("F5 · THE JOURNAL PASS, for every direct caller: the same refusal on preview and write; a parcel, a spark and the town's own mark are not judged by the side cap", { skip: SKIP }, async () => {
  const { journalLeaveMark, footprintGate } = await import("../src/world.mjs");
  await lawWith();
  const base = { slug: `fp-direct-${process.pid}`, kind: "sited", body: "a direct call", by: "cap-fixture", household: "cap-fixture", date: new Date().toISOString() };
  for (const preview of [true, false]) {
    const before = await actsCount();
    await assert.rejects(journalLeaveMark({ ...base, at: { x: 40000, y: 40000 }, extent: { w: 2001, h: 100 }, ...(preview ? { preview } : {}) }),
      (e) => e?.code === 422 && /2001 m wide/.test(e.defect), `preview ${preview}`);
    await assert.rejects(journalLeaveMark({ ...base, at: { x: 40000, y: 40000 }, extent: { w: 100, h: 100 }, points: ring(257), ...(preview ? { preview } : {}) }),
      (e) => e?.code === 422 && /257/.test(e.defect), `preview ${preview}`);
    assert.equal(await actsCount(), before, `preview ${preview}: nothing written`);
  }
  // the scope, asked of the gate itself
  const big = { at: { x: 0, y: 0 }, extent: { w: 9000, h: 9000 } };
  assert.doesNotThrow(() => footprintGate({ ...base, kind: "parcel", ...big }), "a parcel keeps its own extent dial");
  assert.doesNotThrow(() => footprintGate({ ...base, kind: "spark", ...big }), "a spark's frame is no ground it stands on");
  assert.doesNotThrow(() => footprintGate({ ...base, by: "the-town", ...big }), "the town's own constitutional mark");
  assert.doesNotThrow(() => footprintGate({ ...base, kind: "sited", class: "parcel", ...big }), "the old spelling of a parcel lineage is a parcel");
  assert.throws(() => footprintGate({ ...base, ...big }), (e) => e.code === 422 && /9000 m wide/.test(e.defect), "a resident's sited mark is");
  assert.throws(() => footprintGate({ ...base, kind: "parcel", points: ring(257) }), (e) => /257/.test(e.defect), "the point cap judges a parcel's ring too");
  assert.doesNotThrow(() => footprintGate({ ...base, kind: "predicated", slot: "x", value: "y" }), "a mark with no footprint is not judged");
});

// ── F6 the journal road, through the public door ────────────────────────────

test("F6 · THE JOURNAL ROAD (WORLD_SINGLE_LOG): the public door reaches the same refusal there, on a leave and on an amendment, preview and write", { skip: SKIP }, async () => {
  const prev = process.env.WORLD_SINGLE_LOG;
  process.env.WORLD_SINGLE_LOG = "1";
  try {
    await lawWith();
    const { canonForGuards } = await import("../src/world.mjs");
    for (const preview of [true, false]) {
      const before = await actsCount();
      await assert.rejects(leave({ points: ring(257), preview }), refusal(/at most 256 points; this one has 257/), `leave, preview ${preview}`);
      await assert.rejects(leave({ points: box(1000, 2001), preview }), refusal(/this one is 2001 m deep/), `leave, preview ${preview}`);
      assert.equal(await actsCount(), before, `preview ${preview}: no act, no draft`);
    }
    const real = canonForGuards().marks.find((m) => m.by !== "the-town" && m.kind === "sited" && m.at && m.extent && Number(m.extent.w) > 20 && Number(m.extent.w) < 1800
      && !m.points && String(m.id).startsWith(`${m.by}/`) && m.parent_id == null && m.household);
    const key = { household: real.household, handles: new Set([real.by]) };
    const slug = real.id.slice(real.by.length + 1);
    const amend = (extent) => leave({ slug, by: real.by, at: real.at, extent, amend: true, preview: true, body: `${real.body ?? "a mark"} (amended)` }, key);
    await assert.rejects(amend({ w: 2001, h: real.extent.h }), refusal(/2001 m wide/), "an amendment past the cap");
    assert.equal((await amend(real.extent)).preview, true, "an amendment inside it");
    await lawWith({ points: 256, side: Math.floor(Number(real.extent.w)) - 1 });
    assert.equal((await amend(real.extent)).preview, true, "an existing record over the lowered cap is kept");
    await assert.rejects(amend({ w: Number(real.extent.w) + 1, h: real.extent.h }), refusal(/a side/), "and not grown");
  } finally { if (prev == null) delete process.env.WORLD_SINGLE_LOG; else process.env.WORLD_SINGLE_LOG = prev; }
});
