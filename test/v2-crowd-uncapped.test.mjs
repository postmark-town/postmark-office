// v2-crowd-uncapped.test.mjs — v2's `who` reads the whole crowd (POS-632, review-555 § 2).
//
// v2 splits EVERYONE within presence's radius by activity: the active are listed
// (at most 8) and the quiet are counted. So orient asks presence with
// world.mjs § crowdPresence (no cap). Presence's own default cap is 10, so with
// it back the quiet count could never pass 10 (the Quay Reach counts 71). This
// fixture stands twelve residents within 500 m and holds that every one of them
// reaches the crowd. The flip is crowdPresence returning {}.
//
// The fixture is test/dynamic-presence.test.mjs's, with its own twelve standers.
//
// Run: node --test test/v2-crowd-uncapped.test.mjs

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { join } from "node:path";

import { fixtureWorldCloneWithEngine, fixtureWorldDb, mainShaOf, scratchDir, crossingStart } from "./dynamic-fixture.mjs";
import { NO_WORLD_DB } from "./helpers/world-rows.mjs";

const scratch = scratchDir("v2-crowd");
const FRAME = "the-town/let-there-be-light";
const MARKS = [
  { id: FRAME, by: "the-town", kind: "sited", tier: "constitution", at: { x: 0, y: 0 }, extent: { w: 100000, h: 100000 }, body: "let there be light" },
  { id: "the-town/town-square", by: "the-town", kind: "sited", tier: "constitution", at: { x: 0, y: 0 }, extent: { w: 400, h: 400 }, body: "the square" },
];
process.env.WORLD_STORE_DB = NO_WORLD_DB;
delete process.env.WORLD_PRESENCE;

const N = 400;
const B = crossingStart(N);
const STANDERS = Array.from({ length: 12 }, (_, i) => ({
  at: new Date(B).toISOString(), actor: `r${String(i).padStart(2, "0")}`, from: { x: 20 * (i + 1), y: 0 }, toward: { x: 20 * (i + 1), y: 0 }, crossing: N, line_no: i + 1,
}));
const repo = fixtureWorldCloneWithEngine({ label: "v2-crowd", marks: MARKS, departures: STANDERS });
after(() => { for (const d of [scratch, repo]) { try { rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); } catch { /* litter */ } } });
process.env.WORLD_CLONE = repo;
fixtureWorldDb(join(scratch, "world.db"), { sha: mainShaOf(repo), departures: STANDERS });

let presence, world;
before(async () => {
  presence = await import("../src/dynamic-presence.mjs");
  world = await import("../src/world.mjs");
});

test("v2's crowd is uncapped: twelve standers within 500 m all reach it, where presence's default shows ten", async () => {
  const derived = await world.departuresAcrossEras(repo, { atMs: B });
  const projected = { ...derived, built_at: new Date(B).toISOString() };
  const capped = await presence.near({ x: 0, y: 0, radiusM: 500, repo, projected, atMs: B });
  assert.equal(capped.count, 12);
  assert.equal(capped.shown, 10, "presence's own default is a cap of ten — the reason v2 asks without one");
  const crowd = await presence.near({ x: 0, y: 0, radiusM: 500, repo, projected, atMs: B, ...world.crowdPresence() });
  assert.equal(crowd.shown, 12, "every resident within reach reaches who: listed when active, counted when quiet");
  assert.equal(crowd.capped, false);
});

// review-555 (10-14): the test above holds what crowdPresence asks; this one
// holds that orient asks it. Writing `crowd ? {} :` at the call site left every
// other test green. The flip is that edit: the v2 crowd falls back to ten.
test("worldOrient asks presence with crowdPresence when v2 wants the crowd, and as it always did otherwise", async () => {
  process.env.WORLD_POSITIONS = "1";
  process.env.WORLD_PRESENCE = "1";
  try {
    const v2 = await world.worldOrient({ x: 0, y: 0 }, null, { crowd: true });
    assert.equal(v2.present.residents.length, 12, "the v2 crowd is the whole crowd within reach");
    assert.ok(v2.present.residents.every((r) => !("place" in r)), "without place words: v2's rows say distance, bearing and doing");
    const v1 = await world.worldOrient({ x: 0, y: 0 }, null);
    assert.equal(v1.present.residents.length, 10, "v1 asks exactly as it always did, presence's cap of ten");
  } finally {
    delete process.env.WORLD_PRESENCE;
    delete process.env.WORLD_POSITIONS;
  }
});
