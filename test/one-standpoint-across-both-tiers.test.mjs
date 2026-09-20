// one-standpoint-across-both-tiers.test.mjs — the 2.0 read tier says the Origin
// for a groundless resident too (postmark-town/postmark#2900, the fix-forward).
//
// THE THIRD HOLDER. `world2/tools/live-reads.mjs` is a VERBATIM port of the
// world engine's tools/where-is.mjs (VENDOR.whereIs, blob 83e6a766…), held to
// the original by world2/tools/falsifier-live-equality.mjs. It answers the
// porch, and it MUST keep answering the porch: being field-for-field the
// engine's law is the whole of what that file promises.
//
// So the ruling is applied exactly where 1.0 applies it — on the DOOR's answer,
// one layer above the derivation. `src/positions.mjs` rewrites the real
// engine's groundless rows; `src/world2-serve.mjs` rewrites the port's. Same
// module, same predicate, same rewrite, two tiers.
//
// WHAT THIS FILE PROVES. Over ONE fixture world, the 1.0 presence derivation
// and the live 2.0 door both name the Origin for the same groundless resident
// and both carry `placeholder: true`. The two sides run DIFFERENT CODE over
// that world — the real engine at WORLD_CLONE on one side, the port on the
// other — which is what makes the equality worth asserting rather than a
// tautology over one implementation.
//
// WHAT IT DELIBERATELY DOES NOT TOUCH. The port. It is asserted here to still
// answer the porch, so this file can never go green by the vendored copy having
// drifted off the engine it promises to be.
//
//   node --test test/one-standpoint-across-both-tiers.test.mjs

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const env = { pg: process.env.WORLD2_PG, url: process.env.WORLD2_PG_URL };
before(() => {
  // The env gate decides whether the 2.0 doors exist at all and is not what is
  // under test. The injected pool means no connection is ever opened, so the
  // URL merely has to be truthy (the seam world2Apex already had).
  process.env.WORLD2_PG = "1";
  process.env.WORLD2_PG_URL = "postgres://one-standpoint-test/none";
});
after(() => {
  if (env.pg == null) delete process.env.WORLD2_PG; else process.env.WORLD2_PG = env.pg;
  if (env.url == null) delete process.env.WORLD2_PG_URL; else process.env.WORLD2_PG_URL = env.url;
});

const live = await import("../world2/tools/live-reads.mjs");
const { world2Serve, apexPresent } = await import("../src/world2-serve.mjs");
const { everyonePlaced } = await import("../src/positions.mjs");

// ── ONE fixture world, read by both tiers ───────────────────────────────────
//
// `live.worldFromRows` returns `{ marks, parcels, households }` — the same fold
// shape the real engine consumes — so a single row set feeds the port's door
// and the engine's derivation without either being handed a world of its own.
const markRow = ({ slug, kind, owner, household, at, extent = { w: 25, h: 25 } }) => ({
  slug, kind, owner, household, status: "standing",
  geometry: at ? { at, extent } : null, data: {},
});
const QUAY = { x: 1390, y: 5665, id: "the-town/the-quay" };
const WORLD_ROWS = [
  markRow({ slug: QUAY.id, kind: "sited", owner: "the-town", household: "solo:the-town", at: { x: QUAY.x, y: QUAY.y }, extent: { w: 10, h: 40 } }),
  markRow({ slug: "holder/the-ground-parcel", kind: "parcel", owner: "holder", household: "solo:holder", at: { x: 100, y: 100 } }),
];
const IDS = [
  { handle: "holder", household: "solo:holder" },        // holds ground — the control
  { handle: "groundless", household: "solo:groundless" }, // no walk, no ground
];
const ROLL = ["holder", "groundless"];
const WORLD = live.worldFromRows({ marks: WORLD_ROWS, identities: IDS });

// The 2.0 door's four queries, dispatched on the SQL text it actually sends.
const pool = {
  query: async (sql) => {
    if (/FROM acts/i.test(sql)) return { rows: [] };            // nobody has walked
    if (/FROM marks/i.test(sql)) return { rows: WORLD_ROWS };
    if (/FROM identities/i.test(sql)) return { rows: IDS };
    if (/FROM town_roll/i.test(sql)) return { rows: ROLL.map((handle) => ({ handle })) };
    return { rows: [] };
  },
};
const present2 = () => world2Serve("/world2/present", new URLSearchParams(""), { p: pool });

// The 1.0 side runs the REAL engine out of the world clone — the office imports
// it by path at runtime, so a test that wants it resolves it the same way. A
// checkout without one SKIPS VISIBLY: a silent `return` would be a probe that
// cannot fail, reporting green while measuring nothing.
async function engineWhereIs(t) {
  const roots = [process.env.WORLD_CLONE, join(ROOT, "..", "postmark-world"),
    join(ROOT, "..", "..", "postmark-world"), join(ROOT, "world-clone")].filter(Boolean);
  for (const r of roots) {
    const f = join(r, "tools", "where-is.mjs");
    if (existsSync(f)) return import(pathToFileURL(f).href);
  }
  t.skip(`no world clone found (looked in ${roots.join(", ")}) — set WORLD_CLONE to bind the cross-tier equality`);
  return null;
}

const rowOf = (rows, handle) => rows.find((r) => r.handle === handle);
const point = (o) => ({ x: o.x, y: o.y });

// ── THE EQUALITY ────────────────────────────────────────────────────────────

test("FALSIFIER — over one fixture world, /world/present and /world2/present name the SAME standpoint for a groundless resident, and it is the Origin", async (t) => {
  const where = await engineWhereIs(t);
  if (!where) return;

  // 1.0 — the real engine, through the office's own presence derivation
  const oneOh = rowOf(everyonePlaced({ world: WORLD, departures: [], at: 0, where, roll: ROLL }), "groundless");
  // 2.0 — the port, through the live door
  const { code, body } = await present2();
  assert.equal(code, 200);
  const twoOh = rowOf(body.residents, "groundless");

  assert.ok(oneOh, "1.0 must answer about the groundless resident at all");
  assert.ok(twoOh, "2.0 must answer about the groundless resident at all");

  const AT_ORIGIN = { x: 0, y: 0 };
  assert.deepEqual(point(oneOh), AT_ORIGIN, "1.0 presence");
  assert.deepEqual(point(twoOh), AT_ORIGIN, "2.0 presence");
  // stated as the equality and not only as two constants: the defect was never
  // a wrong number, it was two right numbers that disagreed
  assert.deepEqual(point(twoOh), point(oneOh));
  assert.equal(twoOh.source, oneOh.source);
  assert.equal(twoOh.mark_id, oneOh.mark_id);
});

test("FALSIFIER — the 2.0 answer carries the placeholder disclosure, in the one wording", async () => {
  const { body } = await present2();
  const twoOh = rowOf(body.residents, "groundless");
  assert.equal(twoOh.placeholder, true, "a default handed over in silence is the whole defect");
  assert.match(twoOh.placeholder_note, /the ORIGIN's neighbourhood and not yours/,
    "one disclosure, not a second wording of it");
  // and it is the SAME string the 1.0 tier carries, from the one owner
  const { NO_GROUND_NEIGHBOURHOOD } = await import("../src/groundless.mjs");
  assert.equal(twoOh.placeholder_note, NO_GROUND_NEIGHBOURHOOD);
});

test("FALSIFIER — a resident WITH ground is untouched on the 2.0 tier", async (t) => {
  const where = await engineWhereIs(t);
  if (!where) return;
  const oneOh = rowOf(everyonePlaced({ world: WORLD, departures: [], at: 0, where, roll: ROLL }), "holder");
  const { body } = await present2();
  const twoOh = rowOf(body.residents, "holder");

  assert.deepEqual(point(twoOh), { x: 100, y: 100 });
  assert.deepEqual(point(twoOh), point(oneOh));
  assert.equal(twoOh.source, "parcel", "provenance still says how we know");
  assert.equal(twoOh.mark_id, "holder/the-ground-parcel");
  assert.equal(twoOh.placeholder, undefined, "nobody on their own ground is told they stand on a default");
});

// ── THE SECOND 2.0 DOOR ─────────────────────────────────────────────────────
//
// `/world2/present` and `/world2/apex` read the port through two different call
// sites. Fixing one and not the other would have left the apex's presence block
// answering the quay while the standalone door answered the Origin — the same
// split, one door over, which is the shape this whole lane is about. So the
// apex's block is asserted directly rather than inferred from the other one.

test("FALSIFIER — the apex's presence block says the Origin too, and its 500 m list is measured AFTER the rewrite", async () => {
  // The render's own helpers, stubbed: this test is about WHERE the resident is
  // and WHEN the rewrite ran, not about how the apex words a place.
  const eng = {
    engine: { bearingDeg: () => 0, quantizeBearing: () => "N", distanceBand: () => "here" },
    verbs: { containmentChain: () => [] },
  };
  const block = await apexPresent(pool, { world: WORLD, at: { x: 0, y: 0 }, engine: eng, roster: "roll" });

  const seen = (block.residents ?? []).find((r) => r.handle === "groundless");
  assert.ok(seen, "a groundless resident standing at the Origin is WITHIN 500 m of the Origin, so the apex must see them");
  assert.deepEqual({ x: seen.at.x, y: seen.at.y }, { x: 0, y: 0 });
  assert.equal(seen.distance_m, 0);

  // THE ORDERING IS THE WHOLE OF IT. The porch is 5,833 m from the Origin —
  // more than eleven times the 500 m dial — so a rewrite applied AFTER the
  // distance filter would drop this resident entirely and then relabel nobody.
  // Their presence in the list at distance 0 is the proof the map ran first.
  assert.equal(live.PRESENCE_DIALS.near_radius_m, 500);
  assert.ok(Math.hypot(QUAY.x, QUAY.y) > live.PRESENCE_DIALS.near_radius_m,
    "if the porch ever came inside the dial this test would stop proving the ordering");
});

// ── THE PORT IS UNTOUCHED ───────────────────────────────────────────────────

test("FALSIFIER — live-reads stays the engine's verbatim port: it still answers the porch, and the DOOR is what rewrites it", () => {
  // If this ever goes green by the PORT having been taught the ruling, the
  // equality above stops measuring the door and the vendor falsifier against
  // the engine is already broken. This is the line that keeps both honest.
  const ported = live.whereIs("groundless", { world: WORLD, departures: [], at: 0 });
  assert.equal(ported.source, "quay", "the port must keep answering what the engine answers");
  assert.equal(ported.mark_id, QUAY.id);
  assert.deepEqual(point(ported), { x: QUAY.x, y: QUAY.y });

  // and its own plural derivation, one layer below the door, is equally untouched
  const portedRow = rowOf(live.everyonePlaced({ world: WORLD, departures: [], at: 0, roll: ROLL }), "groundless");
  assert.equal(portedRow.source, "quay");
  assert.equal(portedRow.placeholder, undefined,
    "the rewrite belongs to the door; a port that disclosed on its own would be a fork");
});
