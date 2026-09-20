// THE DEGRADED ANSWER MUST SAY SO (#1864, 2026-08-18).
//
// THE LAW THIS ENFORCES: `the-town/the-disclosure` — "refuse or disclose absent
// inputs; never quietly substitute" (world repo,
// WORLD/marks/let-there-be-light/logos/the-disclosure/, planted 2026-08-18 on
// jetto/initiator-buttons under Keemin's nodes-first ruling). It was already the
// office's law in prose — cited by name in world-apex.mjs, positions.mjs,
// dynamic-store.mjs and dynamic-entities.mjs — and had no node. That is not a
// bookkeeping detail: world-apex.mjs OBEYS it (law.unavailable / law.stale, no
// affordances) while worldBlockForHandle two files away broke it, because a law
// living in a comment reaches only the files whose author read that comment.
// This test is the machinery closing that gap (`the-town/the-gap`).
//
// worldBlockForHandle's catch branch used to answer {mark_id, x:null, y:null,
// sited:false} — byte-identical to a resident who genuinely has no ground. On
// the 2026-08-18 box resize the engine went unreadable and every home in town
// read homeless; nothing in the answer let a reader tell the two apart, so the
// acute reports were about residents' own ground rather than about the office.
//
// Both halves run here because a disclosure test that only proves the field
// APPEARS is half a test: a field that is always present discloses nothing.
// WORLD_CLONE is bound at module load, so each half is its own child process
// with its own env — the same probe, the same fixture, one condition varied.

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

const repo = mkdtempSync(join(tmpdir(), "postmark-home-unreadable-"));
after(() => rmSync(repo, { recursive: true, force: true }));
const git = (...args) => execFileSync("git", ["-C", repo, ...args], {
  encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
});
const put = (path, text) => {
  const full = join(repo, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, text);
};

// The same shape as world-home-block.test.mjs: a clone the office can actually
// read, holding one placed resident and one who is genuinely groundless.
put("seeding/manifest.json", JSON.stringify({
  homes: [{ household: "placed", home_id: "the-placed-house" }],
}));
put("tools/world-build.mjs", `
export function assembleWorld({ worldState, skeleton }) { return { ...worldState, skeleton }; }
`);
put("tools/world-verbs.mjs", `
export function orient() { return { seen: [] }; }
export function openYourEyes() { return { fov: { carried: [], far: [], counts: {} }, radial: { byBearing: {}, counts: {} }, tell: () => "" }; }
export function investigate() { return null; }
`);
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
  // `tier: "home"` + `placementParent` are what make this the RECORD's house
  // rather than the painting's (postmark#3025) — the fold's standing walk is
  // the one rule, and the office reads the fold's word for it.
  marks: [{ id: "placed/the-placed-house", by: "placed", household: "placed", kind: "sited", tier: "home", placementParent: "placed/the-placed-house-parcel", at: { x: 10, y: 20 }, extent: { w: 12, h: 12 }, body: "a house" }],
  parcels: [{ id: "placed/the-placed-house-parcel", household: "placed", at: { x: 10, y: 20 }, extent: { w: 25, h: 25 } }],
  determined: {}, vague: [], rivalries: [], portfolios: {}, terrain_weight: {}, errors: [],
}));
git("init", "-q", "-b", "main");
git("add", "-A");
git("-c", "user.name=fixture", "-c", "user.email=fixture@test.invalid", "commit", "-q", "-m", "published main");

const worldUrl = pathToFileURL(join(import.meta.dirname, "..", "src", "world.mjs")).href;

/** Ask a child process for one handle's home block under one WORLD_CLONE. */
function blockUnder(worldClone, handle) {
  const out = execFileSync(process.execPath, ["--input-type=module", "-e",
    `const { worldBlockForHandle } = await import(${JSON.stringify(worldUrl)});
     process.stdout.write("<<" + JSON.stringify(await worldBlockForHandle(${JSON.stringify(handle)})) + ">>");`,
  ], { encoding: "utf8", env: { ...process.env, WORLD_CLONE: worldClone }, stdio: ["ignore", "pipe", "pipe"] });
  // the office chatters to stdout on import (households/engine notices); the
  // sentinels are what make this a read of the answer rather than of the noise
  return JSON.parse(out.slice(out.lastIndexOf("<<") + 2, out.lastIndexOf(">>")));
}

const MISSING = join(repo, "no-such-clone-here");

test("engine unreadable: the block DISCLOSES, and says it is not about your ground", () => {
  const w = blockUnder(MISSING, "placed");
  assert.equal(w.unreadable, true, "an unreadable engine must not answer in the grammar of an unplaced resident");
  assert.match(w.unreadable_reason, /cannot read the world engine/);
  // additive only: the four keys the site and the MCP readers consume are
  // unchanged in name and shape
  assert.equal(w.sited, false);
  assert.equal(w.x, null);
  assert.equal(w.y, null);
  assert.ok("mark_id" in w);
  // ── #3025 · the one field that used to answer anyway ──────────────────────
  // The id came from `seeding/manifest.json`, a file read without the engine,
  // so on main this branch still named a house while every other field said
  // "I cannot see". A disclosure with one field still talking is the shape the
  // `unreadable` flag exists to end; the painting is gone and so is the leak.
  assert.equal(w.mark_id, null,
    "on main this is 'placed/the-placed-house', read out of the painting the engine was never needed for");
});

test("CONTROL — engine readable: a PLACED resident carries no disclosure field", () => {
  const w = blockUnder(repo, "placed");
  assert.deepEqual(w, { mark_id: "placed/the-placed-house", x: 10, y: 20, sited: true });
});

test("CONTROL — engine readable: a GENUINELY groundless resident carries no disclosure field", () => {
  // The sharp control. This is the answer the catch branch was impersonating:
  // same sited:false, same nulls, and the field must be absent — otherwise the
  // disclosure means nothing, because it would be there either way.
  const w = blockUnder(repo, "groundless");
  assert.deepEqual(w, { mark_id: null, x: null, y: null, sited: false });
  assert.equal("unreadable" in w, false);
});
