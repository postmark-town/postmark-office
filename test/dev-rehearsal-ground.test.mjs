// dev-rehearsal-ground.test.mjs — the rehearsal's free-ground search against a real store (POS-595).
//
//   node --test test/dev-rehearsal-ground.test.mjs
//
// THE 10-18 RED: groundTakenIn refused any place covered by every standing mark
// of any kind, and the world's root `the-town/let-there-be-light` is sited over
// the whole map, so no place could be free (dev: 0 of 7,729). The town's own
// grounds (owner = the-town) are not ground the rehearsal keeps off; a
// resident's mark and a pending parcel claim still are. The search is the real
// findGround, its answer the real groundTakenIn, asked of a real Postgres by the
// clearing's OVERLAP, because the question is SQL.

import { after, test } from "node:test";
import assert from "node:assert/strict";
import { startStore } from "./helpers/embedded-store.mjs";
import { findGround, groundOf, groundTakenIn } from "../tools/dev-rehearsal.mjs";
import { OVERLAP } from "../world2/tools/overlap.mjs";
import { boxOf } from "../world2/tools/seed-import.mjs";

const store = await startStore({ db: "rehearsal_ground_test" });
after(() => store.stop());

const WIN = 250;
// the box the wall leaves in a 1200 m world with a 400 m fringe (test/dev-rehearsal.test.mjs § a safe box
// filled): three places for the rehearsal's ground, by hand so no world clone is read
const SAFE = { box: { minX: 500, maxX: 700, minY: 500, maxY: 700 }, insetM: 500, keyframes: [244] };
const RUN = "abc1";

async function owner(fn) {
  const c = await store.connect("world2_owner");
  try { return await fn(c); } finally { await c.end(); }
}
const s = { q: async (role, sql, args = []) => { const c = await store.connect(role); try { return (await c.query(sql, args)).rows; } finally { await c.end(); } } };

/** The places the walk asks, in order: every one answered covered, so it asks them all and refuses. */
async function walk() {
  const asked = [];
  await assert.rejects(findGround({ run: RUN, safe: SAFE, parcelM: 25, taken: async (f) => { asked.push(f[0].at); return "covered"; } }));
  return asked;
}

async function seed() {
  await owner(async (c) => {
    await c.query("TRUNCATE claims, marks, windows CASCADE");
    await c.query(`INSERT INTO windows (id, opens_at, closes_at, status, cleared_at) VALUES
      ($1, '2026-10-17T00:00Z', '2026-10-17T12:00Z', 'closed', '2026-10-17T12:00Z'),
      ($2, '2026-10-17T12:00Z', '2026-10-18T00:00Z', 'open', NULL)`, [WIN - 1, WIN]);
  });
}

const mark = (slug, kind, by, at, extent) => owner((c) => c.query(
  `INSERT INTO marks (id, slug, kind, owner, household, body, geometry, bbox, status, locked_window)
   VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7::box, 'standing', $8)`,
  [slug, kind, by, by === "the-town" ? null : `hh:${by}`, `${slug}.`, JSON.stringify({ at, extent }), boxOf(at, extent), WIN - 1]));

const pendingParcel = (slug, by, at) => owner((c) => c.query(
  `INSERT INTO claims (window_id, class, claimant, household, status, body, geometry, bbox, stake, slug)
   VALUES ($1, 'parcel', $2, $3, 'pending', $4, $5, $6::box, 0, $7)`,
  [WIN, by, `hh:${by}`, `${slug}.`, JSON.stringify({ slug, at, extent: { w: 25, h: 25 } }), boxOf(at, { w: 25, h: 25 }), slug]));

test("the world's root covers the whole map and is not counted; a resident's mark at the first place and a pending parcel claim at the second still are", async () => {
  await seed();
  const [A, B, C] = await walk();
  assert.ok(A && B && C, "the box holds three places");
  // the town's own grounds: the root over the whole map, the sea over the box
  await mark("the-town/let-there-be-light", "sited", "the-town", { x: 0, y: 0 }, { w: 320000, h: 320000 });
  await mark("the-town/the-sea", "sited", "the-town", { x: 600, y: 600 }, { w: 4000, h: 4000 });
  // a resident's lamp at place A, and a resident's pending parcel at place B
  await mark("rei/a-lamp", "sited", "rei", A, { w: 3, h: 3 });
  await pendingParcel("sable/b-parcel", "sable", B);

  const taken = groundTakenIn(s, OVERLAP, boxOf);
  assert.equal(await taken(groundOf(A, 25)), `the standing sited "rei/a-lamp"`);
  assert.equal(await taken(groundOf(B, 25)), `the pending parcel claim "sable/b-parcel"`);
  assert.equal(await taken(groundOf(C, 25)), null, "only the town's grounds cover C");

  const g = await findGround({ run: RUN, safe: SAFE, parcelM: 25, taken });
  assert.notDeepEqual(g.parcelAt, A);
  assert.deepEqual(g.parcelAt, C);
  assert.equal(g.tried, 3);
});

test("a resident's mark as wide as the map still covers every place: only the town's are set aside", async () => {
  await seed();
  await mark("the-town/let-there-be-light", "sited", "the-town", { x: 0, y: 0 }, { w: 320000, h: 320000 });
  await mark("orion-by-the-fire/the-reach", "sited", "orion-by-the-fire", { x: 600, y: 600 }, { w: 4000, h: 4000 });
  await assert.rejects(findGround({ run: RUN, safe: SAFE, parcelM: 25, taken: groundTakenIn(s, OVERLAP, boxOf) }),
    /: 3 of 3 places tried, each covered \(the last by the standing sited "orion-by-the-fire\/the-reach"\)$/);
});
