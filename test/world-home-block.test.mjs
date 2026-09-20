// worldBlockForHandle — THE RECORD ANSWERS, and the July painting is gone
// (postmark#3025, 2026-09-20).
//
// Until this hotfix the house's display id came from `seeding/manifest.json`, a
// build intermediate generated from the atlas on 2026-07-22 whose own first
// line says it is not world canon. A painting cannot be amended by living here,
// so for four months it outranked the record: `current-the-reader` read "the
// Snug harbour" while the fold said that mark stands on spar's coast and is
// MARKET, and fourteen of the 88 painted houses had already stopped being marks
// at all. The FOLD was only ever the fallback.
//
// Now there is one rule and it is the fold's: among the marks a household has
// standing `home` (`tools/mark-standing.mjs`, Keemin 2026-08-12 — the ground
// decides), the one standing directly on ground the household holds, largest
// first. Measured over the live fold at `settlement/S74` against the 68 seeded
// households whose painted house is still such a mark: fold order agreed on 64,
// earliest-declared 67, most-marks-standing-inside-it 67, LARGEST FOOTPRINT
// 68 of 68. Where no such mark stands, the block names the ground — the parcel,
// which is what every household the seeding missed has always read.
//
// The red control that predates this hotfix stays: the resident the seeding
// missed, absent from the painting, plainly holding a parcel in the fold.
// Before the fold fallback this returned sited:false, the viewer could derive no
// origin, and that resident could not walk at all (vermillion, 2026-08-04;
// #1044 is the same bug on wren-winter).
//
// THE CAN-FAIL FLIP: restore the manifest read in src/world.mjs and LEG 2 and
// LEG 5 red — the painted house the record does not stand, and the painted
// household the record never placed. Flip receipt in the PR.
//
// LEG 3 IS NOT A DISCRIMINATOR AGAINST MAIN AND SAYS SO. `crowded`'s painting
// names the same mark the new rule picks, so main answers it too; the flip
// leaves LEG 3 green. It discriminates against the WRONG DERIVATIONS — fold
// order, and any rule that would let a room drawn larger than its house win —
// which is what the measurement actually had to choose between. A leg that
// pins a choice no flip of the shipped change can reach is still worth having;
// calling it a falsifier when it is not is what is not.

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

const repo = mkdtempSync(join(tmpdir(), "postmark-home-block-"));
after(() => rmSync(repo, { recursive: true, force: true }));
const git = (...args) => execFileSync("git", ["-C", repo, ...args], {
  encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
});
const put = (path, text) => {
  const full = join(repo, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, text);
};

// placed:    painted AND the record stands their house on their own ground.
// stale:     painted, but the record does not stand that mark on their ground —
//            the Snug harbour's shape, and the whole reason for #3025.
// crowded:   several marks stand `home` on their parcel; the house is the
//            largest, and the painting agrees (so the leg discriminates the
//            RULE, not the painting).
// unplaced:  painted, and holding no ground at all.
// missed:    NOT painted, but the fold holds their parcel.
// groundless: in neither — the honest sited:false must survive the fix.
//
// THE PAINTING IS PRESENT IN THE FIXTURE ON PURPOSE. The office must stop
// CONSULTING it, not merely survive its absence, so every id below is one main
// would answer from this file.
put("seeding/manifest.json", JSON.stringify({
  homes: [
    { household: "placed", home_id: "the-placed-house" },
    { household: "stale", home_id: "the-painted-house" },
    { household: "crowded", home_id: "the-crowded-house" },
    { household: "unplaced", home_id: "the-house-that-never-was" },
  ],
}));
// the clone owns the engine; this block only needs it to load, not to think
put("tools/world-build.mjs", `
export function assembleWorld({ worldState, skeleton }) { return { ...worldState, skeleton }; }
`);
put("tools/world-verbs.mjs", `
export function orient() { return { seen: [] }; }
export function openYourEyes() { return { fov: { carried: [], far: [], counts: {} }, radial: { byBearing: {}, counts: {} }, tell: () => "" }; }
export function investigate() { return null; }
`);
// The position JOIN is the clone's (tools/where-is.mjs) and is tested there —
// see postmark-world/tools/where-is.test.mjs, 7 cases incl. the vermillion
// regression. What THIS suite covers is the office's mapping over it: which id
// read_home names, and that an unloadable world still degrades honestly. So the
// double below mirrors the contract and nothing more.
put("tools/where-is.mjs", `
export const NOWHERE = Object.freeze({ x: null, y: null, placed: false, source: null, mark_id: null });
export function householdOf(handle, world) {
  const own = (world?.marks ?? []).find((m) => m.by === handle && m.household);
  return own?.household ?? handle;
}
export function parcelsFor(handle, world) {
  const hh = householdOf(handle, world);
  return (world?.parcels ?? []).filter((p) => p.household === hh);
}
export function parcelFor(handle, world) { return parcelsFor(handle, world)[0] ?? null; }
export function homeOf(handle, world) {
  const parcel = parcelFor(handle, world);
  if (!parcel) return { ...NOWHERE };
  return { x: parcel.at.x, y: parcel.at.y, placed: true, source: "parcel", mark_id: parcel.id, parcel,
           household_parcels: parcelsFor(handle, world).map((p) => p.id) };
}
export function whereIs(handle, { world = null } = {}) { return homeOf(handle, world); }
`);
put("WORLD/skeleton.json", JSON.stringify({ features: [], physics_registry: {} }));
put("WORLD/world-state.json", JSON.stringify({
  tick: 0,
  dials: {},
  marks: [
    // stands `home` on its household's own parcel — the record's own house
    { id: "placed/the-placed-house", by: "placed", household: "placed", kind: "sited", tier: "home", placementParent: "placed/the-placed-house-parcel", at: { x: 10, y: 20 }, extent: { w: 12, h: 12 }, body: "a house" },
    // painted as stale's house, but it stands on SOMEONE ELSE'S ground and the
    // fold says MARKET — the Snug harbour in miniature
    { id: "stale/the-painted-house", by: "stale", household: "stale", kind: "sited", tier: "market", placementParent: "the-town/the-coast", at: { x: 900, y: 900 }, extent: { w: 30, h: 22 }, body: "a house the painting kept and the ground did not" },
    // three marks stand `home` on crowded's parcel; only one is the house
    { id: "crowded/the-crowded-house", by: "crowded", household: "crowded", kind: "sited", tier: "home", placementParent: "crowded/the-crowded-parcel", at: { x: 50, y: 50 }, extent: { w: 12, h: 12 }, body: "the house" },
    { id: "crowded/the-garden-shed", by: "crowded", household: "crowded", kind: "sited", tier: "home", placementParent: "crowded/the-crowded-parcel", at: { x: 58, y: 58 }, extent: { w: 3, h: 3 }, body: "the shed" },
    { id: "crowded/the-front-walk", by: "crowded", household: "crowded", kind: "sited", tier: "home", placementParent: "crowded/the-crowded-parcel", at: { x: 44, y: 50 }, extent: { w: 6, h: 1 }, body: "the walk" },
    // inside the house, not on the parcel — a room is not a dwelling
    { id: "crowded/the-kitchen", by: "crowded", household: "crowded", kind: "sited", tier: "home", placementParent: "crowded/the-crowded-house", at: { x: 48, y: 48 }, extent: { w: 20, h: 20 }, body: "the kitchen, drawn large and standing INSIDE the house" },
    { id: "missed/the-far-mountain", by: "missed", household: "missed", kind: "sited", tier: "market", at: { x: -95458, y: -95458 }, extent: { w: 3600, h: 3600 }, body: "a mountain kept as one house" },
  ],
  parcels: [
    { id: "placed/the-placed-house-parcel", household: "placed", at: { x: 10, y: 20 }, extent: { w: 25, h: 25 } },
    { id: "stale/the-stale-parcel", household: "stale", at: { x: 400, y: 400 }, extent: { w: 25, h: 25 } },
    { id: "crowded/the-crowded-parcel", household: "crowded", at: { x: 50, y: 50 }, extent: { w: 25, h: 25 } },
    { id: "missed/the-far-mountain-parcel", household: "missed", at: { x: -95458, y: -95458 }, extent: { w: 25, h: 25 } },
  ],
  determined: {}, vague: [], rivalries: [], portfolios: {}, terrain_weight: {}, errors: [],
}));

// the office reads the world at refs/heads/main, so the fixture must be a repo
git("init", "-q", "-b", "main");
git("add", "-A");
git("-c", "user.name=fixture", "-c", "user.email=fixture@test.invalid", "commit", "-q", "-m", "published main");

process.env.WORLD_CLONE = repo;
const { worldBlockForHandle } = await import("../src/world.mjs");

// ── LEG 1 · unchanged where the painting and the record agree ───────────────

test("a resident whose house the RECORD stands on their own ground reads that house", async () => {
  const w = await worldBlockForHandle("placed");
  assert.deepEqual(w, { mark_id: "placed/the-placed-house", x: 10, y: 20, sited: true });
});

// ── LEG 2 · THE FIX · red on main ───────────────────────────────────────────
//
// The painting names `stale/the-painted-house`; the fold stands that mark on
// the coast and calls it MARKET. On main this block answers the painted id and
// the painted mark's coordinates — a resident told they live somewhere the
// record says they do not. Now the block names their ground.

test("THE FIX: a painted house the record does not stand on the household's ground is NOT named", async () => {
  const w = await worldBlockForHandle("stale");
  assert.notEqual(w.mark_id, "stale/the-painted-house",
    "the July painting outranked the fold here for four months — this is the Snug harbour's shape");
  assert.deepEqual(w, { mark_id: "stale/the-stale-parcel", x: 400, y: 400, sited: true },
    "with no house of theirs standing on their ground, the block names the ground");
});

// ── LEG 3 · THE DISCRIMINATOR BETWEEN RULES, not against main ───────────────
//
// Green on either side of the flip, deliberately: the painting names the same
// mark here, so main agrees. What this leg refuses is the OTHER derivations the
// measurement had to choose between — fold order, and anything that would let
// a room drawn larger than its house win.
//
// Four marks of crowded's stand `home`: three on the parcel (house 144 m²,
// shed 9 m², walk 6 m²) and one INSIDE the house (the kitchen, drawn 400 m² —
// larger than the house, and deliberately so). The house wins twice over: the
// kitchen does not stand on the parcel, and of those that do the house is the
// largest. Fold order alone would answer the house here too, so the ordering is
// shuffled by the ids: `the-crowded-house` sorts after `the-crowded-parcel`'s
// other children only by area.

test("THE DISCRIMINATOR: of several marks standing home on the parcel, the LARGEST is the house", async () => {
  const w = await worldBlockForHandle("crowded");
  assert.equal(w.mark_id, "crowded/the-crowded-house",
    "the shed and the walk stand home on the same ground; the house is the biggest thing built on it");
  assert.notEqual(w.mark_id, "crowded/the-kitchen",
    "and a room INSIDE the house is not the house, however large it is drawn — it does not stand on the parcel");
  assert.equal(w.x, 50);
  assert.equal(w.y, 50);
});

// ── LEG 4 · the control that predates #3025 ─────────────────────────────────

test("RED CONTROL: a resident the seeding missed is sited off the fold's parcel", async () => {
  const w = await worldBlockForHandle("missed");
  // Before the fold fallback this was { mark_id: null, x: null, y: null, sited: false }
  // — and a viewer with no origin cannot offer a walk.
  assert.equal(w.sited, true, "a resident holding a parcel is placed, manifest or no manifest");
  assert.equal(w.x, -95458);
  assert.equal(w.y, -95458);
  assert.equal(w.mark_id, "missed/the-far-mountain-parcel");
});

test("genuinely groundless stays sited:false — the honest answer is not papered over", async () => {
  const w = await worldBlockForHandle("groundless");
  assert.deepEqual(w, { mark_id: null, x: null, y: null, sited: false });
});

// ── LEG 5 · THE FIX · red on main · the issue's own sentence ────────────────
//
// "where a seeded household has no such mark, the block says so honestly
// (`mark_id: null`) rather than naming a July painting" (#3025). `unplaced` is
// painted with `the-house-that-never-was` and holds no ground at all; on main
// this block answers that id beside `sited: false` — a house with no place,
// which is the painting speaking where the record has nothing to say.

test("THE FIX: a painted household holding no ground reads mark_id null, not the painting's id", async () => {
  const w = await worldBlockForHandle("unplaced");
  assert.deepEqual(w, { mark_id: null, x: null, y: null, sited: false },
    "on main this is { mark_id: 'unplaced/the-house-that-never-was', … } — a house the record never placed");
});
