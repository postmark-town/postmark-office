// mark-footprint-caps.test.mjs — the 256-point outline cap at the writing doors (POS-1126, WLD-193).
//
// Darko, 2026-11-17: "yeah 256 is good" (a mark's 2D `points:` outline). NO SIZE CAP: Darko, 2026-11-18 14:42 EST, "I'm actually just
// going to err on not having a cap for now", Wright: "POS-1126's door now refuses only an outline over 256 points. There's no size
// refusal." The number is the class `mark`'s `outline-point-cap` property (Bevel, WLD-193), read through the existing law reader
// (classDials). The office holds no number: every limit below is a property of the LAW FIXTURE the test loads, and moving the property
// moves the limit.
//
// Every house, handle and mark here is INVENTED, except that the amend legs run on a real resident mark of the pinned world clone
// (the way town-centre-amend.test.mjs does), against an embedded store.
//
//   F1  the rule, pure: 256/257, the dial read, the words, and that size is never judged
//   F2  THE DOOR, REAL: leave-mark through leaveMarkViaOffice — 257 points refuse naming the cap, 256 pass, `preview: true` answers the
//       SAME refusal and writes nothing (no act, no draft); large footprints with permitted point counts are allowed
//   F3  NO HIDDEN CONSTANT: the same marks under a changed property default, and under no property at all
//   F4  AMENDMENTS are judged on what they carry, like a leave: a real resident mark amended with 257 points refuses, with 256 points
//       and with a huge extent passes
//   F5  THE DIRECT CALLERS: the journal pass refuses the same way (preview and write); the gate judges a parcel's and a constitution
//       mark's ring too, and judges no footprint's size
//   F6  the git door (flag off): refusals only, answered before its exec (which would pull into the shared world clone)
//
//   node --import ./test/helpers/sparse-guard.mjs --test --test-concurrency=1 test/mark-footprint-caps.test.mjs

import { after, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { startStore } from "./helpers/embedded-store.mjs";
import { footprintCaps, footprintRefusal, pointCount } from "../src/mark-footprint.mjs";

const CLONE = join(process.cwd(), "world-clone");
const SKIP = !existsSync(CLONE) && "no pinned world clone in this tree";
const store = await startStore({ db: "mark_footprint_caps" });
const FLAGS = ["WORLD2_PG", "WORLD2_PG_URL", "W2_PEN", "W2_GUARDS", "WORLD_CLONE", "WORLD_SINGLE_LOG"];
const saved = Object.fromEntries(FLAGS.map((k) => [k, process.env[k]]));
// THE JOURNAL ROAD (prod's flags). No leg here lets a mark through the git door's exec: it pulls into the SHARED world clone (and fetches
// its tags), which would move what other files read there (test/porch-lights-http.test.mjs's blessed settlement). The git door is covered by
// refusals only (F6), which the gate gives before the exec is reached.
Object.assign(process.env, { WORLD2_PG: "1", WORLD2_PG_URL: store.url("office_api"), W2_PEN: "mark", W2_GUARDS: "1", WORLD_CLONE: CLONE, WORLD_SINGLE_LOG: "1" });
const { reloadLawSnapshot, resetLawSnapshot, LAW_REFRESH_SQLS } = await import("../src/law-snapshot.mjs");
after(async () => {
  resetLawSnapshot();
  for (const k of FLAGS) { if (saved[k] == null) delete process.env[k]; else process.env[k] = saved[k]; }
  await store.stop();
});

// ── the law fixture: the class `mark` and its one property (WLD-196's shape), plus the parcel's own dial ───────────
const SHA = "d".repeat(40);
const classRow = (key, data = {}) => ({ number: 281, tag_sha: SHA, newest: 281, kind: "class", key, data: { class: key, ...data } });
const propRow = (klass, name, dflt, id) => ({ number: 281, tag_sha: SHA, newest: 281, kind: "property", key: `${klass}/${name}`, data: { class: klass, parent: null, name, tier: "constitution", default: dflt, id } });
async function lawWith({ points = 256 } = {}) {
  const rows = [classRow("mark"), classRow("parcel"), propRow("parcel", "extent_m", 25, "the-town/parcel-extent-m"),
    ...(points == null ? [] : [propRow("mark", "outline-point-cap", points, "the-town/mark-outline-point-cap")])];
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

// ── F1 the rule, pure ───────────────────────────────────────────────────────

test("F1 · the rule: 256 passes, 257 refuses with the count and the cap; the dial read; size is never judged", () => {
  const caps = footprintCaps({ "outline-point-cap": 256 });
  assert.deepEqual(caps, { points: 256 });
  assert.deepEqual(footprintCaps({}), { points: null }, "no property, no boundary: the office holds no number");
  assert.deepEqual(footprintCaps({ "outline-point-cap": "x" }), { points: null }, "a value that is no positive number is no boundary");
  assert.deepEqual(footprintCaps({ "common-ground-side-cap": 2000 }), { points: null }, "the withdrawn size property is not read");
  assert.equal(pointCount(ring(256)), 256);
  assert.equal(pointCount("1,1 2,2 3,3"), 3);
  const judge = (c) => footprintRefusal(c, { caps });
  assert.equal(judge({ points: ring(256) }), null, "256 points are permitted");
  assert.match(judge({ points: ring(257) }).defect, /^an outline holds at most 256 points; this one has 257$/);
  assert.equal(judge({ points: ring(257) }).code, 422);
  assert.match(judge({ points: ring(257) }).hint, /Nothing was written\.$/);
  assert.equal(judge({ kind: "sited", body: "no outline at all" }), null);
  // NO SIZE REFUSAL: however large, a footprint is not this door's business
  assert.equal(judge({ extent: { w: 99999, h: 99999 } }), null, "a huge extent");
  assert.equal(judge({ points: ring(256, 50000, 50000), extent: { w: 50000, h: 50000 } }), null, "256 points over a 50 km box");
  assert.equal(judge({ extent: { w: 15300, h: 13470 } }), null);
  assert.equal(judge({ points: ring(256, 16001, 16001) }), null, "nor the withdrawn 16001 m");
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

test("F2 · THE DOOR: 257 points refuse naming the cap; 256 pass; a preview answers the same and writes nothing; large footprints are allowed", { skip: SKIP }, async () => {
  await lawWith();
  for (const preview of [true, false]) {
    const tag = preview ? "preview" : "write";
    const before = await actsCount();
    await assert.rejects(leave({ points: ring(257), preview }), refusal(/an outline holds at most 256 points; this one has 257/), `${tag}: 257 points`);
    await assert.rejects(leave({ points: ring(300, 5000, 5000), preview }), refusal(/this one has 300/), `${tag}: a large ring over the cap refuses by its points`);
    assert.equal(await actsCount(), before, `${tag}: a refusal writes nothing`);
  }
  const before = await actsCount();
  const ok = await leave({ points: ring(256), preview: true });
  assert.equal(ok.preview, true, `256 points previews: ${JSON.stringify(ok).slice(0, 300)}`);
  assert.equal(ok.would, "leave");
  // large footprints with permitted point counts get no size refusal
  for (const [what, p] of [["256 points over a 30 km box", { points: ring(256, 30000, 30000) }], ["a 4-point 50 km ring", { points: ring(4, 50000, 50000) }],
    ["a bare 20 km extent", { at: { x: 40000, y: 40000 }, extent: { w: 20000, h: 20000 } }], ["Pando Plains' 15300 × 13470", { points: ring(4, 15300, 13470) }]]) {
    const r = await leave({ ...p, preview: true });
    assert.equal(r.preview, true, `${what} previews (no size refusal): ${JSON.stringify(r).slice(0, 200)}`);
  }
  assert.equal(await actsCount(), before, "the previews that pass write nothing either: no act, no draft, no stake");
});

// ── F3 no hidden constant ───────────────────────────────────────────────────

test("F3 · NO HIDDEN CONSTANT: a changed property default changes the limit, and no property means no boundary", { skip: SKIP }, async () => {
  await lawWith({ points: 300 });
  assert.equal((await leave({ points: ring(257), preview: true })).preview, true, "257 points pass when the law says 300");
  await assert.rejects(leave({ points: ring(301), preview: true }), refusal(/at most 300 points; this one has 301/), "and 301 refuses by the law's number");
  await lawWith({ points: 100 });
  await assert.rejects(leave({ points: ring(101), preview: true }), refusal(/at most 100 points; this one has 101/), "a lower default lowers it");
  assert.equal((await leave({ points: ring(100), preview: true })).preview, true);
  await lawWith({ points: null });
  assert.equal((await leave({ points: ring(300, 5000, 5000), preview: true })).preview, true, "no property, no boundary: nothing is refused until the law says it");
  await lawWith();
  await assert.rejects(leave({ points: ring(257), preview: true }), refusal(/256/));
});

// ── F4 amendments ───────────────────────────────────────────────────────────

test("F4 · AMENDMENTS are judged on what they carry: 257 points refuse, 256 points and a huge extent pass", { skip: SKIP }, async () => {
  const { canonForGuards } = await import("../src/world.mjs");
  const canon = canonForGuards();
  const real = canon.marks.find((m) => m.by !== "the-town" && m.kind === "sited" && m.at && m.extent && Number(m.extent.w) > 20 && Number(m.extent.w) < 1800
    && !m.points && String(m.id).startsWith(`${m.by}/`) && m.parent_id == null && m.household);
  assert.ok(real, "a resident's plain sited mark in the pinned canon");
  const slug = real.id.slice(real.by.length + 1);
  const key = { household: real.household, handles: new Set([real.by]) };
  const amend = (extra) => leave({ slug, by: real.by, amend: true, preview: true, body: `${real.body ?? "a mark"} (amended)`, ...extra }, key);

  await lawWith();
  const before = await actsCount();
  await assert.rejects(amend({ points: ring(257, 10, 10, real.at.x, real.at.y) }), refusal(/at most 256 points; this one has 257/), "an amendment over the cap");
  const same = await amend({ at: real.at, extent: real.extent });
  assert.equal(same.preview, true, `an amendment that carries no outline previews: ${JSON.stringify(same).slice(0, 200)}`);
  assert.equal((await amend({ points: ring(256, 10, 10, real.at.x, real.at.y) })).preview, true, "an amendment at the cap");
  assert.equal((await amend({ at: real.at, extent: { w: 30000, h: 30000 } })).preview, true, "an amendment that makes the mark large is not refused for its size");
  assert.equal(await actsCount(), before, "no preview wrote anything");
  assert.equal(canonForGuards().byId.get(real.id).extent.w, real.extent.w, "and the published record is exactly as it was");
});

// ── F5 the direct callers and the scope ─────────────────────────────────────

test("F5 · THE JOURNAL PASS, for every direct caller: the same refusal on preview and write; a parcel's and a constitution mark's ring are judged, no footprint's size is", { skip: SKIP }, async () => {
  const { journalLeaveMark, footprintGate, canonForGuards } = await import("../src/world.mjs");
  await lawWith();
  const base = { slug: `fp-direct-${process.pid}`, kind: "sited", body: "a direct call", by: "cap-fixture", household: "cap-fixture", date: new Date().toISOString() };
  for (const preview of [true, false]) {
    const before = await actsCount();
    await assert.rejects(journalLeaveMark({ ...base, at: { x: 40000, y: 40000 }, extent: { w: 100, h: 100 }, points: ring(257), ...(preview ? { preview } : {}) }),
      (e) => e?.code === 422 && /257/.test(e.defect), `preview ${preview}`);
    assert.equal(await actsCount(), before, `preview ${preview}: nothing written`);
  }
  // the gate: points only, whoever writes and whatever it is
  const huge = { at: { x: 0, y: 0 }, extent: { w: 90000, h: 90000 } };
  for (const [what, c] of [["a resident's sited mark", {}], ["a parcel", { kind: "parcel" }], ["a spark", { kind: "spark" }], ["a parcel-lineage class", { class: "parcel" }],
    ["the town's own mark", { by: "the-town", household: "the-town" }], ["an unplaced mark", { at: undefined }]])
    assert.doesNotThrow(() => footprintGate({ ...base, ...huge, ...c }), `${what}: a huge footprint with no outline is not refused`);
  for (const [what, c] of [["a resident's sited mark", {}], ["a parcel", { kind: "parcel" }], ["a spark", { kind: "spark" }], ["the town's own mark", { by: "the-town", household: "the-town" }]])
    assert.throws(() => footprintGate({ ...base, ...c, points: ring(257) }), (e) => e.code === 422 && /this one has 257/.test(e.defect), `${what}: the point cap judges any ring`);
  assert.doesNotThrow(() => footprintGate({ ...base, ...huge, points: ring(256, 90000, 90000) }), "256 points over 90 km pass");
  assert.doesNotThrow(() => footprintGate({ ...base, kind: "predicated", slot: "x", value: "y" }), "a mark with no outline is not judged");
  // and the real thing: every constitution-tier mark of the pinned canon, large as it is, is not refused for its size
  const constitutional = canonForGuards().marks.filter((m) => m.tier === "constitution" && m.kind === "sited" && m.at && m.extent);
  assert.ok(constitutional.length >= 1, "the pinned canon holds constitution-tier sited marks");
  for (const m of constitutional) {
    const as = { ...base, slug: m.id.slice(m.by.length + 1), by: m.by, household: m.household, amend: true, at: m.at, extent: m.extent };
    assert.doesNotThrow(() => footprintGate(as), `${m.id}: no size refusal`);
    assert.throws(() => footprintGate({ ...as, points: ring(257) }), (e) => /this one has 257/.test(e.defect), `${m.id}: its ring over the cap refuses`);
  }
});

// ── F6 the git door (flag off): refusals only ───────────────────────────────

test("F6 · THE GIT DOOR (WORLD_SINGLE_LOG off): the gate answers before its exec, so 257 points refuse on a leave and an amendment, preview and write, and nothing is run", { skip: SKIP }, async () => {
  const prev = process.env.WORLD_SINGLE_LOG;
  delete process.env.WORLD_SINGLE_LOG;
  try {
    await lawWith();
    const { canonForGuards } = await import("../src/world.mjs");
    for (const preview of [true, false]) {
      await assert.rejects(leave({ points: ring(257), preview }), refusal(/at most 256 points; this one has 257/), `leave, preview ${preview}`);
      await assert.rejects(leave({ points: ring(400, 3000, 3000), preview }), refusal(/this one has 400/), `leave, preview ${preview}`);
    }
    const real = canonForGuards().marks.find((m) => m.by !== "the-town" && m.kind === "sited" && m.at && m.extent && Number(m.extent.w) > 20 && Number(m.extent.w) < 1800
      && !m.points && String(m.id).startsWith(`${m.by}/`) && m.parent_id == null && m.household);
    const key = { household: real.household, handles: new Set([real.by]) };
    const slug = real.id.slice(real.by.length + 1);
    await assert.rejects(leave({ slug, by: real.by, points: ring(257, 10, 10, real.at.x, real.at.y), amend: true, preview: true, body: "amended" }, key), refusal(/this one has 257/), "an amendment over the cap");
  } finally { if (prev == null) delete process.env.WORLD_SINGLE_LOG; else process.env.WORLD_SINGLE_LOG = prev; }
});
