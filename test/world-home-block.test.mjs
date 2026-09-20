// worldBlockForHandle — YOUR PARCEL IS WHERE YOU LIVE, and the July painting is
// gone (postmark#3025, Keemin-ruled 2026-09-20).
//
// Until this hotfix the house's display id came from `seeding/manifest.json`, a
// build intermediate generated from the atlas on 2026-07-22 whose own first
// line says it is not world canon. The block ALREADY fell through to `homeOf`'s
// answer whenever the painting named nothing, so the painting was never the
// derivation — it was an OVERRIDE of the record with a seeded house's id.
//
// And it could not be corrected by living here. `current-the-reader` read "the
// Snug harbour" while the fold stands that mark on spar's coast and calls it
// MARKET; fourteen of the 88 painted house ids had already stopped being marks
// at all. So the override is gone and NOTHING REPLACES IT: `mark_id` is what
// `tools/where-is.mjs § homeOf` returns — the household's parcel, `source:
// "parcel"` — for everyone, which is the town's own law ("the parcel IS the
// home", ruling 7) and the founder's rule for the map: the parcel's own name.
//
// NO PICKER WENT IN ITS PLACE, and that was the ruling rather than the reflex.
// A largest-mark-standing-home rule was measured first and reproduces the
// painting on 68 of 68 households where the painting is still true — and hands
// lupi a 4 m² door light and solan a 6 m² table as "their house", because the
// record carries no DWELLING KIND, so any picker must guess. Keemin on reading
// that table: use the parcel's name.
//
// The red control that predates this hotfix stays: the resident the seeding
// missed, absent from the painting, plainly holding a parcel in the fold.
// Before the fold fallback this returned sited:false, the viewer could derive no
// origin, and that resident could not walk at all (vermillion, 2026-08-04;
// #1044 is the same bug on wren-winter). It is now the same assertion every
// other placed resident makes — which is the point of the change.
//
// THE CAN-FAIL FLIP: restore the manifest read in src/world.mjs and LEG 1, LEG 2
// and LEG 4 red. Flip receipt in the PR.

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

// placed:    painted, and the painted house really does stand on their parcel —
//            the 68-of-88 case, where the painting was RIGHT and still goes.
// stale:     painted, but that mark stands on someone else's coast and the fold
//            calls it MARKET — the Snug harbour's shape, and #3025's instance.
//            Its parcel is somewhere else entirely, so this leg catches the
//            COORDINATE leak that `placed` cannot: on main the block answers a
//            point 500 m from any ground of theirs.
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
export function parcelFor(handle, world) {
  const hh = householdOf(handle, world);
  return (world?.parcels ?? []).find((p) => p.household === hh) ?? null;
}
export function homeOf(handle, world) {
  const parcel = parcelFor(handle, world);
  if (!parcel) return { ...NOWHERE };
  return { x: parcel.at.x, y: parcel.at.y, placed: true, source: "parcel", mark_id: parcel.id, parcel };
}
export function whereIs(handle, { world = null } = {}) { return homeOf(handle, world); }
`);
put("WORLD/skeleton.json", JSON.stringify({ features: [], physics_registry: {} }));
put("WORLD/world-state.json", JSON.stringify({
  tick: 0,
  dials: {},
  marks: [
    // the painting was RIGHT about this one: their house really does stand on
    // their parcel. It goes anyway — the id is the ground's, for everyone.
    { id: "placed/the-placed-house", by: "placed", household: "placed", kind: "sited", tier: "home", at: { x: 10, y: 20 }, extent: { w: 12, h: 12 }, body: "a house" },
    // painted as stale's house, standing on SOMEONE ELSE'S coast, and the fold
    // says MARKET — the Snug harbour in miniature. Note the coordinates: 500 m
    // from any ground of theirs, which is what main answers for them today.
    { id: "stale/the-painted-house", by: "stale", household: "stale", kind: "sited", tier: "market", at: { x: 900, y: 900 }, extent: { w: 30, h: 22 }, body: "a house the painting kept and the ground did not" },
    { id: "missed/the-far-mountain", by: "missed", household: "missed", kind: "sited", tier: "market", at: { x: -95458, y: -95458 }, extent: { w: 3600, h: 3600 }, body: "a mountain kept as one house" },
  ],
  parcels: [
    { id: "placed/the-placed-house-parcel", household: "placed", at: { x: 10, y: 20 }, extent: { w: 25, h: 25 } },
    { id: "stale/the-stale-parcel", household: "stale", at: { x: 400, y: 400 }, extent: { w: 25, h: 25 } },
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

// ── LEG 1 · THE FIX · red on main · even where the painting was RIGHT ───────
//
// `placed`'s painted house genuinely stands on their parcel — the 68-of-88
// case. The override goes anyway, because the field's answer is the ground's
// name for everyone or it is a rule with an exception list. On main this reads
// `placed/the-placed-house`.

test("THE FIX: a painted household reads their PARCEL, not the painted house", async () => {
  const w = await worldBlockForHandle("placed");
  assert.deepEqual(w, { mark_id: "placed/the-placed-house-parcel", x: 10, y: 20, sited: true },
    "on main this is { mark_id: 'placed/the-placed-house', … } — the painting overriding the engine");
});

// ── LEG 2 · THE FIX · red on main · the instance, and the COORDINATE leak ───
//
// The painting names `stale/the-painted-house`; the fold stands that mark on
// someone else's coast and calls it MARKET. This leg is not a restatement of
// LEG 1: `stale`'s parcel is 500 m from the painted mark, so on main the block
// answers a POINT that is not on any ground of theirs — `x: 900, y: 900`. A
// resident told they live somewhere the record says they do not.

test("THE FIX: a painted house standing on someone else's ground leaks neither its id NOR its point", async () => {
  const w = await worldBlockForHandle("stale");
  assert.notEqual(w.mark_id, "stale/the-painted-house",
    "the July painting outranked the fold here for four months — this is the Snug harbour's shape");
  assert.deepEqual(w, { mark_id: "stale/the-stale-parcel", x: 400, y: 400, sited: true },
    "on main this is { mark_id: 'stale/the-painted-house', x: 900, y: 900 } — a point on another household's coast");
});

// ── LEG 3 · the control that predates #3025 ─────────────────────────────────

test("RED CONTROL: a resident the seeding missed is sited off the fold's parcel", async () => {
  const w = await worldBlockForHandle("missed");
  // Before the fold fallback this was { mark_id: null, x: null, y: null, sited: false }
  // — and a viewer with no origin cannot offer a walk.
  //
  // Green on both sides of the flip, and that is now its whole point: after
  // #3025 this is the SAME sentence LEG 1 makes. The resident the seeding
  // missed used to be the exception; everyone reads their parcel now, so the
  // exception is what went.
  assert.equal(w.sited, true, "a resident holding a parcel is placed, manifest or no manifest");
  assert.equal(w.x, -95458);
  assert.equal(w.y, -95458);
  assert.equal(w.mark_id, "missed/the-far-mountain-parcel");
});

test("genuinely groundless stays sited:false — the honest answer is not papered over", async () => {
  const w = await worldBlockForHandle("groundless");
  assert.deepEqual(w, { mark_id: null, x: null, y: null, sited: false });
});

// ── LEG 4 · THE FIX · red on main · the issue's own sentence ────────────────
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
