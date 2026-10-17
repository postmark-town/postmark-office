// wld-9-home-in-the-bare-read.test.mjs — WLD-9 (formerly POS-528), the office half.
//
//   WORLD_CLONE=<postmark-world at the WLD-9 head> node --test test/wld-9-home-in-the-bare-read.test.mjs
//
// The bare read must carry the ACTING resident's own home in `nearby`, outside the
// 12-mark telling budget (postmark-world#152). The World engine does it when it is
// told who is acting (`openYourEyes(state, world, { actor })`). This office's
// `worldEyes` called it as `openYourEyes({x, y, name}, w, { crossing })`, so the
// real embodied read never said, and the home sat in the anonymous tail.
//
// Driven through the REAL doors: `worldEyes` (the compact `objects`) and `worldApex`
// (the bare read's `nearby`, which is `worldEyes`' objects), on a key that stands as
// TWO residents with the second one named, over a synthetic crowded ground and the
// real World engine copied from the clone this runs against (no stub that pins
// independently). A spectator (x/y, no handle) is the unchanged control.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

import { worldClone } from "./fixture-paths.mjs";

const REAL = worldClone();
const SCRATCH = mkdtempSync(join(tmpdir(), "wld9-"));
const repo = join(SCRATCH, "world");
const put = (p, t) => { const f = join(repo, p); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, t); };

const parcel = (by, x, y) => ({ id: `${by}/parcel`, by, household: by, kind: "parcel", tier: "market", at: { x, y }, extent: { w: 25, h: 25 }, date: "2026-08-01T00:00:00Z", body: `${by}'s ground` });
// big, heavy and close to the second resident's home: each outranks the home parcel
const crowd = Array.from({ length: 14 }, (_, i) => ({
  id: `crowd${i}/stall`, by: `crowd${i}`, household: `crowd${i}`, kind: "sited", tier: "market",
  at: { x: 7 + i * 0.5, y: 63 }, extent: { w: 40, h: 40 }, weight: 50, date: "2026-09-01T00:00:00Z", body: `stall ${i}`,
}));
const MARKS = [parcel("dom-pidgey", 0, 0), parcel("marigold", 0, 60), ...crowd];

before(() => {
  cpSync(join(REAL, "tools"), join(repo, "tools"), { recursive: true });   // the real, revised engine
  put("WORLD/world-state.json", JSON.stringify({ tick: 0, dials: {}, marks: MARKS, parcels: MARKS.filter((m) => m.kind === "parcel"), households: {}, determined: {}, vague: [], rivalries: [], portfolios: {}, terrain_weight: {}, errors: [] }));
  put("WORLD/skeleton.json", JSON.stringify({ features: [], physics_registry: {}, elevation: { fog_ceiling_m: 22 }, light: { dawn_pole_m: { x: 5000, y: -5000 }, dark_pole_m: { x: -5000, y: 5000 } }, far_features: [] }));
  put("WORLD/walk-ledger.md", "# Walk ledger\n");
  put("seeding/manifest.json", JSON.stringify({ homes: [] }));
  const git = (...a) => execFileSync("git", ["-C", repo, ...a], { stdio: ["ignore", "pipe", "pipe"] });
  git("init", "-q", "-b", "main"); git("add", "-A");
  git("-c", "user.name=f", "-c", "user.email=f@t.invalid", "commit", "-q", "-m", "fixture");
});
after(() => { try { rmSync(SCRATCH, { recursive: true, force: true }); } catch { /* litter */ } });

process.env.WORLD_CLONE = join(SCRATCH, "world");
process.env.WORLD_STORE_DB = join(SCRATCH, "none.db");
process.env.WORLD_DYNAMIC_DB = join(SCRATCH, "dynamic.db");
delete process.env.WORLD_EMISSIONS;
delete process.env.WORLD_PRESENCE;

const key = (...handles) => ({ household: "h", handles: new Set(handles) });
const TWO = key("dom-pidgey", "marigold");     // marigold is the SECOND handle
const ids = (r) => (r.objects ?? []).map((o) => o.id);
const count = (list, id) => list.filter((x) => x === id).length;

let world, apex;
before(async () => {
  process.env.WORLD_APEX = "1";
  world = await import("../src/world.mjs");
  apex = await import("../src/world-apex.mjs");
});

test("PRIMARY · the embodied read carries the SELECTED resident's home: the second handle on a two-handle key", async () => {
  const r = await world.worldEyes({ handle: "marigold" }, TWO);
  assert.ok(!r.error, JSON.stringify(r));
  assert.equal(r.stance, "embodied");
  assert.equal(count(ids(r), "marigold/parcel"), 1, `marigold's home is in worldEyes.objects once (got ${JSON.stringify(ids(r))})`);
  assert.equal(ids(r).filter((id) => id !== "marigold/parcel").length, 12, "beside the ordinary twelve");
  assert.equal(count(ids(r), "dom-pidgey/parcel"), 0, "and the other resident of the key is not pinned");
});

test("the first handle, selected, carries its own home and not the second's", async () => {
  const r = await world.worldEyes({ handle: "dom-pidgey" }, TWO);
  assert.equal(count(ids(r), "dom-pidgey/parcel"), 1);
  assert.equal(count(ids(r), "marigold/parcel"), 0);
});

test("the apex bare read: nearby is that same set, with the home once", async () => {
  const r = await apex.worldApex({ handle: "marigold" }, TWO);
  assert.ok(!r.error, JSON.stringify(r));
  const nearby = (r.nearby ?? []).map((o) => o.id);
  assert.equal(count(nearby, "marigold/parcel"), 1, `apex.nearby carries the home (got ${JSON.stringify(nearby)})`);
  assert.equal(nearby.filter((id) => id !== "marigold/parcel").length, 12);
});

test("the actor is the selected handle, never args.name", async () => {
  const r = await world.worldEyes({ handle: "marigold", name: "dom-pidgey" }, TWO);
  assert.equal(count(ids(r), "marigold/parcel"), 1);
  assert.equal(count(ids(r), "dom-pidgey/parcel"), 0);
});

test("a one-handle key with no handle named stands as that handle and carries its home", async () => {
  const r = await world.worldEyes({}, key("marigold"));
  assert.equal(count(ids(r), "marigold/parcel"), 1);
});

test("a spectator (x/y, no handle) is unchanged: no actor, no pinned home", async () => {
  const r = await world.worldEyes({ x: 3, y: 63 }, null);
  assert.equal(r.stance, "spectator");
  assert.equal(count(ids(r), "marigold/parcel"), 0, "the crowd outranks it and nobody is acting");
  assert.equal(ids(r).length, 12);
  const k = await world.worldEyes({ x: 3, y: 63 }, TWO);
  assert.deepEqual(ids(k), ids(r), "a key with residents on it does not make coordinates embodied");
});
