// w2-thing-at-the-clearing.test.mjs — A W2 THING AT THE CANDLE: left, staked,
// crossed and standing, its ground and its standing as the world's fold says
// (LOGOS v2 part 2, W2 · G12; lane o2-store-chain).
//
//   node --import ./test/helpers/sparse-guard.mjs --test test/w2-thing-at-the-clearing.test.mjs
//
// W2 re-kinds `kind: sited` + `class: thing` to `kind: thing`, and the bless puts
// those rows in the store as they are. Three steps of the crossing asked
// `kind === "sited" || "parcel"` and so passed a thing by: the escrow gate's
// walk (5.5), the mover test and the carry (5.5a, 5.7), and the recompute
// (7). Each now asks the class chain, read from law_projection at the pinned law.
//
// THE RIG is carry-at-the-clearing.test.mjs's: a real Postgres
// (test/helpers/embedded-store.mjs), every migration (016's GiST among them), and
// the real `clearing-job.mjs` run as a child under the `clearing_job` pen. Rei's
// parcel stands at (1000, 1000) and holds Rei's chest, a `kind: thing` whose
// consent welcomes Sable's letter standing in it; Rei's coin lies in the chest.

import { after, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { startStore } from "./helpers/embedded-store.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const JOB = join(ROOT, "world2", "tools", "clearing-job.mjs");
const TOWN_SHA = "t".repeat(40);
const LAW_SHA = "l".repeat(40);
const WIN = 240;

const store = await startStore({ db: "w2_thing_test" });
after(() => store.stop());
const skip = store.skip ?? false;

const IDS = {
  parcel: "c0000000-0000-4000-8000-000000000001",
  chest: "c0000000-0000-4000-8000-000000000002",
  letter: "c0000000-0000-4000-8000-000000000003",
  coin: "c0000000-0000-4000-8000-000000000004",
  stone: "c0000000-0000-4000-8000-000000000005",
};
const box = (at, ext) => `((${at.x - ext.w / 2},${at.y - ext.h / 2}),(${at.x + ext.w / 2},${at.y + ext.h / 2}))`;
const PARCEL_AT = { x: 1000, y: 1000 }, CHEST_EXT = { w: 6, h: 6 };

// The class layer at W2, as law-ingest writes it: one row per class, `extends` in `data`.
const CLASSES = [["postmark-node", null], ["mark", "postmark-node"], ["sited", "mark"], ["parcel", "sited"],
  ["predicate", "mark"], ["naming", "predicate"], ["thing", "sited"]];

async function seed(claims) {
  const c = await store.connect("world2_owner");
  try {
    await c.query("TRUNCATE escrow_projection, claims, marks, windows, projection_heads, households, household_pins, law_projection CASCADE");
    for (const id of [WIN - 1, WIN]) {
      const opens = new Date(Date.UTC(2026, 9, 6, 18) + (id - WIN + 1) * 12 * 3600e3).toISOString();
      await c.query(
        `INSERT INTO windows (id, opens_at, closes_at, status, cleared_at)
         VALUES ($1, $2, $2::timestamptz + interval '12 hours', $3, $4)`,
        [id, opens, id === WIN ? "open" : "closed", id === WIN ? null : opens]);
    }
    await c.query("INSERT INTO projection_heads (repo, sha, ingested_at) VALUES ('world-law', $1, now()), ('town', $2, now())", [LAW_SHA, TOWN_SHA]);
    for (const [key, ext] of CLASSES)
      await c.query("INSERT INTO law_projection (law_sha, kind, path, key, data) VALUES ($1, 'class', $2, $3, $4)",
        [LAW_SHA, `WORLD/marks/the-town/the-keeping-works/${key}/mark.md`, key,
          JSON.stringify(ext ? { class: key, extends: ext } : { class: key })]);
    await c.query(
      `INSERT INTO households (slug, ord, name, residents, since, declared_by)
       VALUES ('starforge', 0, 'Starforge', ARRAY['rei'], '2026-08-01', 'rei'),
              ('rabbit', 1, 'Rabbit', ARRAY['sable'], '2026-08-01', 'sable')`);
    await c.query(
      `INSERT INTO household_pins (handle, login, gh_id, pinned)
       VALUES ('rei', 'rei', 201, '2026-08-01'), ('sable', 'sable', 204, '2026-08-01')`);
    const mark = async (id, slug, kind, owner, household, at, ext, data = {}) => {
      const geometry = JSON.stringify({ at, extent: ext }), d = JSON.stringify({ tier: "home", ...data });
      await c.query(
        `INSERT INTO claims (id, window_id, class, claimant, household, status, decided_at, body, geometry, bbox, stake, data, slug)
         VALUES ($1, $2, $3, $4, $5, 'locked', now(), $6, $7, $8::box, 0, $9, $10)`,
        [id, WIN - 1, kind, owner, household, `${slug}.`, geometry, box(at, ext), d, slug]);
      await c.query(
        `INSERT INTO marks (id, slug, kind, owner, household, body, geometry, bbox, status, locked_window, data)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::box, 'standing', $9, $10)`,
        [id, slug, kind, owner, household, `${slug}.`, geometry, box(at, ext), WIN - 1, d]);
    };
    // The tiers are the world's fold's, as the bless leaves them.
    await mark(IDS.parcel, "rei/the-parcel", "parcel", "rei", "hh:starforge", PARCEL_AT, { w: 25, h: 25 });
    await mark(IDS.chest, "rei/the-chest", "thing", "rei", "hh:starforge", PARCEL_AT, CHEST_EXT,
      { consent: { "sable/the-letter": "welcomed", "sable/the-second-letter": "welcomed" } });
    await mark(IDS.letter, "sable/the-letter", "sited", "sable", "hh:rabbit", { x: 1001, y: 1001 }, { w: 1, h: 1 });
    await mark(IDS.coin, "rei/the-coin", "sited", "rei", "hh:starforge", { x: 999, y: 999 }, { w: 1, h: 1 });
    // somebody's stake on another mark, so the escrow read is a real answer
    // (an empty projection reports every commons claim UNCHECKED and refuses none)
    await mark(IDS.stone, "sable/the-stone", "sited", "sable", "hh:rabbit", { x: 9000, y: 9000 }, { w: 1, h: 1 }, { tier: "market" });
    await c.query(
      `INSERT INTO escrow_projection (town_sha, mark, holder, household, own_household, n, weight_k)
       VALUES ($1, 'sable/the-stone', 'rei', 'hh:starforge', 'hh:rabbit', 1, 0),
              ($1, 'sable/the-staked-lamp', 'rei', 'hh:starforge', 'hh:rabbit', 1, 0)`, [TOWN_SHA]);
    const ids = {};
    for (const { slug, kind, owner, household, at, ext, supersedes = null } of claims)
      ids[slug] = (await c.query(
        `INSERT INTO claims (window_id, class, claimant, household, status, body, geometry, bbox, stake, data, slug, supersedes)
         VALUES ($1, $2, $3, $4, 'pending', $5, $6, $7::box, 0, '{"date":"2026-10-17"}', $8, $9)
         RETURNING id::text`,
        [WIN, kind, owner, household, `${slug}.`, JSON.stringify({ slug, at, extent: ext }), box(at, ext), slug, supersedes])).rows[0].id;
    return ids;
  } finally { await c.end(); }
}

function clear() {
  const r = spawnSync(process.execPath, [JOB, "--window", String(WIN)], {
    cwd: ROOT, encoding: "utf8",
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, WORLD2_CLEARING_URL: store.url("clearing_job") },
  });
  return { code: r.status, out: `${r.stdout}\n${r.stderr}` };
}
async function read(sql, args = []) {
  const c = await store.connect("world2_owner");
  try { return (await c.query(sql, args)).rows; } finally { await c.end(); }
}
const tierOf = async (slug) => (await read("SELECT data->>'tier' AS tier FROM marks WHERE slug = $1 AND status = 'standing'", [slug]))[0]?.tier ?? null;
const placeOf = async (slug) => (await read("SELECT geometry FROM marks WHERE slug = $1 AND status = 'standing'", [slug]))[0]?.geometry?.at ?? null;
const statusOf = async (id) => (await read("SELECT status, refusal_check FROM claims WHERE id = $1", [id]))[0];

test("THE STANDING HOLDS: the first crossing after the bless keeps a guest's welcomed letter home on a W2 thing", { skip }, async () => {
  // At 674430cce step 7 walked past the chest (not `sited`, not `parcel`) to the
  // parcel, whose consent names no letter, and wrote the letter down to market.
  await seed([{ slug: "rei/the-bench", kind: "sited", owner: "rei", household: "hh:starforge", at: { x: 1008, y: 1008 }, ext: { w: 1, h: 1 } }]);
  const run = clear();
  assert.equal(run.code, 0, run.out);
  assert.equal(await tierOf("sable/the-letter"), "home", "the chest is sovereign ground and its holder welcomed the letter");
  assert.equal(await tierOf("rei/the-chest"), "home");
  assert.equal(await tierOf("rei/the-coin"), "home");
});

test("A W2 THING LEFT, STAKED AND CROSSED: own ground locks ✦0, the staked one locks, the bare one is refused, and the ground the chest gives is read at the gate", { skip }, async () => {
  const ids = await seed([
    { slug: "rei/the-new-chest", kind: "thing", owner: "rei", household: "hh:starforge", at: { x: 1008, y: 992 }, ext: { w: 3, h: 3 } },
    { slug: "sable/the-staked-lamp", kind: "thing", owner: "sable", household: "hh:rabbit", at: { x: 6000, y: 6000 }, ext: { w: 1, h: 1 } },
    { slug: "sable/the-bare-lamp", kind: "thing", owner: "sable", household: "hh:rabbit", at: { x: 6100, y: 6100 }, ext: { w: 1, h: 1 } },
    // inside Rei's chest: one the chest's holder welcomed, one it did not
    { slug: "sable/the-second-letter", kind: "sited", owner: "sable", household: "hh:rabbit", at: { x: 998, y: 1002 }, ext: { w: 1, h: 1 } },
    { slug: "sable/the-unasked-letter", kind: "sited", owner: "sable", household: "hh:rabbit", at: { x: 1002, y: 998 }, ext: { w: 1, h: 1 } },
  ]);
  const run = clear();
  assert.equal(run.code, 0, run.out);
  assert.equal((await statusOf(ids["rei/the-new-chest"])).status, "locked", "a ✦0 thing on its own house's parcel is home");
  assert.equal((await statusOf(ids["sable/the-staked-lamp"])).status, "locked", "a commons thing with stamps behind it locks");
  const bare = await statusOf(ids["sable/the-bare-lamp"]);
  assert.equal(bare.status, "refused", "a ✦0 commons thing is refused like any ✦0 commons mark");
  assert.match(bare.refusal_check, /escrow/);
  assert.equal((await statusOf(ids["sable/the-second-letter"])).status, "locked",
    "the chest is the letter's ground and its holder welcomed it: home, ✦0 is enough");
  assert.equal((await statusOf(ids["sable/the-unasked-letter"])).status, "refused", "standing in the chest unwelcomed is commons");

  const rows = await read("SELECT slug, kind, data->>'tier' AS tier FROM marks WHERE status = 'standing' AND slug = ANY($1) ORDER BY slug",
    [["rei/the-new-chest", "sable/the-staked-lamp", "sable/the-second-letter"]]);
  assert.deepEqual(rows.map((r) => [r.slug, r.kind, r.tier]), [
    ["rei/the-new-chest", "thing", "home"],
    ["sable/the-second-letter", "sited", "home"],
    ["sable/the-staked-lamp", "thing", "market"],
  ], "each stands in its own kind, at the standing the walk gives it");
});

test("A MOVED THING IS A MOVER: it carries its household's coin, and the guest's letter stays where it is", { skip }, async () => {
  // 5.5a and 5.7 read a mover as `class === "sited" || "parcel"`, so a moved
  // chest skipped the mover gate and carried nothing: the coin stayed behind.
  const to = { x: 1005, y: 1005 };
  const ids = await seed([{ slug: "rei/the-chest", kind: "thing", owner: "rei", household: "hh:starforge", at: to, ext: CHEST_EXT, supersedes: IDS.chest }]);
  const run = clear();
  assert.equal(run.code, 0, run.out);
  assert.equal((await statusOf(ids["rei/the-chest"])).status, "locked", run.out);
  assert.deepEqual(await placeOf("rei/the-chest"), to);
  assert.deepEqual(await placeOf("rei/the-coin"), { x: 1004, y: 1004 }, "the coin rode by the chest's offset");
  assert.deepEqual(await placeOf("sable/the-letter"), { x: 1001, y: 1001 }, "another household's mark never moves");
  const [w] = await read("SELECT receipts FROM windows WHERE id = $1", [WIN]);
  assert.equal(w.receipts.carried?.[0]?.sentence,
    "moved rei/the-chest and 1 mark of your household's; 1 mark of other households stayed where it was (hh:rabbit ×1)");
  // Left outside the moved chest, the letter's ground is the parcel now, whose
  // consent does not name it: the walk says market, as the world's fold would.
  assert.equal(await tierOf("sable/the-letter"), "market");
});
