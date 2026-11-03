// prospective-standing.test.mjs — THE STAKE DOOR ASKS THE CANDLE'S OWN WALK
// (POS-674).
//
//   node --test test/prospective-standing.test.mjs
//
// A resident staked ✦0 on a plain sited mark on open ground, with no
// parcel above it. The door said "it stands on your own household's ground"
// because it printed that whenever the promotion went through, and the crossing
// refused it `escrow-absent` (claim 56688387, window 260). The door now asks
// `world2-claims.mjs § claimGroundClass`, which lays the author's claim on the
// world with the open window's pending claims and walks it through
// `world2/tools/prospective-standing.mjs`, the composition the candle's 5.5 makes.
//
// THE RIG is clearing-escrow-order.test.mjs's: a real Postgres
// (test/helpers/embedded-store.mjs). The judge runs as the door does, as
// `office_api` under the staker's house; the PARITY case runs the real
// `clearing-job.mjs` as `clearing_job` over the same rows and holds its 5.5
// refusals equal to the export's commons answers. The clearing keeps its own
// copy of the composition until train/2026-w45 (POS-701), and this is what holds
// the two equal until then.

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
const WIN = 260;

const store = await startStore({ db: "prospective_standing_test" });
after(() => store.stop());
const skip = store.skip ?? false;

const ENV = skip ? {} : { WORLD2_CANDLE: "1", WORLD2_PG: "1", WORLD2_PG_URL: store.url("office_api") };
const { claimGroundClass } = await import("../src/world2-claims.mjs");
const { candidateRowOf, prospectiveTiers } = await import("../world2/tools/prospective-standing.mjs");
const { rowClassOf } = await import("../world2/tools/escrow-presence.mjs");

const box = (at, ext) => `((${at.x - ext.w / 2},${at.y - ext.h / 2}),(${at.x + ext.w / 2},${at.y + ext.h / 2}))`;
const PARCEL = { w: 25, h: 25 }, ONE = { w: 1, h: 1 };
// Rei's parcel; Sable's parcel, which welcomes one of Rei's marks; open
// ground; Rei's second parcel, only pending in this window; and
// Rei's oldest parcel, stored under the house's pre-ruling solo spelling; and
// Sable's orchard, which an amend pending in this window MOVES (#756 review: a
// claim must replace the standing row it continues, or the orchard stands in the
// walk twice and the shed it leaves behind reads home).
const REI = { x: 1000, y: 1000 }, SABLE = { x: 2000, y: 2000 }, GROUNDS = { x: 5000, y: 5000 },
  PENDING = { x: 3000, y: 3000 }, OLD = { x: 4000, y: 4000 },
  ORCHARD_OLD = { x: 6000, y: 6000 }, ORCHARD_NEW = { x: 6100, y: 6000 };

async function seed() {
  const c = await store.connect("world2_owner");
  try {
    await c.query("TRUNCATE acts, escrow_projection, claims, marks, windows, projection_heads, households, household_pins CASCADE");
    for (const id of [WIN - 1, WIN]) {
      const opens = new Date(Date.UTC(2026, 9, 21, 18) + (id - WIN + 1) * 12 * 3600e3).toISOString();
      await c.query(
        `INSERT INTO windows (id, opens_at, closes_at, status, cleared_at)
         VALUES ($1, $2, $2::timestamptz + interval '12 hours', $3, $4)`,
        [id, opens, id === WIN ? "open" : "closed", id === WIN ? null : opens]);
    }
    await c.query("INSERT INTO projection_heads (repo, sha, ingested_at) VALUES ('world-law', $1, now()), ('town', $2, now())", [LAW_SHA, TOWN_SHA]);
    await c.query(
      `INSERT INTO households (slug, ord, name, residents, since, declared_by)
       VALUES ('starforge', 0, 'Starforge', ARRAY['rei'], '2026-08-01', 'rei'),
              ('rabbit', 1, 'Rabbit', ARRAY['sable'], '2026-08-01', 'sable')`);
    await c.query(
      `INSERT INTO household_pins (handle, login, gh_id, pinned)
       VALUES ('rei', 'rei', 201, '2026-08-01'), ('sable', 'sable', 204, '2026-08-01')`);
    let n = 0;
    const mark = async (slug, kind, owner, household, at, ext, data = { tier: "home" }) => {
      const id = `c0000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
      const geometry = JSON.stringify({ at, extent: ext }), d = JSON.stringify(data);
      await c.query(
        `INSERT INTO claims (id, window_id, class, claimant, household, status, decided_at, body, geometry, bbox, stake, data, slug)
         VALUES ($1, $2, $3, $4, $5, 'locked', now(), $6, $7, $8::box, 0, $9, $10)`,
        [id, WIN - 1, kind, owner, household, `${slug}.`, geometry, box(at, ext), d, slug]);
      await c.query(
        `INSERT INTO marks (id, slug, kind, owner, household, body, geometry, bbox, status, locked_window, data)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::box, 'standing', $9, $10)`,
        [id, slug, kind, owner, household, `${slug}.`, geometry, box(at, ext), WIN - 1, d]);
      return id;
    };
    await mark("rei/the-parcel", "parcel", "rei", "hh:starforge", REI, PARCEL);
    await mark("sable/the-garden", "parcel", "sable", "hh:rabbit", SABLE, PARCEL,
      { tier: "home", consent: { "rei/a-lantern": "welcomed" } });
    await mark("rei/the-old-parcel", "parcel", "rei", "solo:rei", OLD, PARCEL);
    const orchard = await mark("sable/the-orchard", "parcel", "sable", "hh:rabbit", ORCHARD_OLD, PARCEL);
    // somebody's stake on another mark, so the clearing's escrow read is a real
    // answer (an empty projection reports every commons claim UNCHECKED)
    await mark("sable/the-stone", "sited", "sable", "hh:rabbit", { x: 9000, y: 9000 }, ONE);
    await c.query(
      `INSERT INTO escrow_projection (town_sha, mark, holder, household, own_household, n, weight_k)
       VALUES ($1, 'sable/the-stone', 'rei', 'hh:starforge', 'hh:rabbit', 1, 0)`, [TOWN_SHA]);
    const claim = async (slug, kind, at, ext, status, { by = "rei", house = "hh:starforge", supersedes = null } = {}) => (await c.query(
      `INSERT INTO claims (window_id, class, claimant, household, status, body, geometry, bbox, stake, data, slug, supersedes)
       VALUES ($1, $2, $8, $9, $3, $4, $5, $6::box, 0, '{"date":"2026-10-22"}', $7, $10)
       RETURNING id::text`,
      [WIN, kind, status, `${slug}.`, JSON.stringify({ slug, at, extent: ext }), box(at, ext), slug, by, house, supersedes])).rows[0].id;
    await claim("rei/the-second-parcel", "parcel", PENDING, PARCEL, "pending");
    const SABLE_HOUSE = { by: "sable", house: "hh:rabbit" };
    await claim("sable/the-orchard", "parcel", ORCHARD_NEW, PARCEL, "pending", { ...SABLE_HOUSE, supersedes: orchard });
    return {
      home: await claim("rei/a-bench", "sited", REI, ONE, "draft"),
      openGround: await claim("rei/a-bench-on-open-ground", "sited", GROUNDS, ONE, "draft"),
      welcomed: await claim("rei/a-lantern", "sited", SABLE, ONE, "draft"),
      unwelcomed: await claim("rei/a-ribbon", "sited", { x: SABLE.x + 3, y: SABLE.y + 3 }, ONE, "draft"),
      pendingGround: await claim("rei/a-shed", "sited", PENDING, ONE, "draft"),
      oldSpelling: await claim("rei/a-gate", "sited", OLD, ONE, "draft"),
      leftBehind: await claim("sable/a-shed-left-behind", "sited", ORCHARD_OLD, ONE, "draft", SABLE_HOUSE),
      movedTo: await claim("sable/a-shed-at-the-new-place", "sited", ORCHARD_NEW, ONE, "draft", SABLE_HOUSE),
    };
  } finally { await c.end(); }
}

const judge = (slug, actor = "rei") => claimGroundClass({ actor, householdName: actor, slug }, ENV);

test("OPEN GROUND · a ✦0 draft on open ground is judged commons, before the crossing says so", { skip }, async () => {
  await seed();
  const g = await judge("rei/a-bench-on-open-ground");
  assert.deepEqual(g, { known: true, tier: "market", ground: "commons" },
    "POS-674: the door told this mark 'your own household's ground'; the walk says commons");
});

test("OWN PARCEL · a draft inside the house's own parcel is home", { skip }, async () => {
  await seed();
  assert.deepEqual(await judge("rei/a-bench"), { known: true, tier: "home", ground: "home" });
});

test("WELCOMED · a draft on another house's ground that welcomed it is home; one it did not welcome is commons", { skip }, async () => {
  await seed();
  assert.equal((await judge("rei/a-lantern")).ground, "home",
    "the walk's own consent word: welcomed ground is home, which the leave-mark door's flat parcel scan cannot see (POS-625)");
  assert.equal((await judge("rei/a-ribbon")).ground, "commons", "the control: the same ground, no welcome");
});

test("PENDING GROUND · a draft inside the house's parcel that is itself pending this window is home, as 5.5 lays it", { skip }, async () => {
  await seed();
  assert.equal((await judge("rei/a-shed")).ground, "home",
    "the open window's pending claims are laid on the world, the way 5.5b lays them");
});

test("ONE HOUSE, WHICHEVER SPELLING · a parcel stored under the solo spelling still holds the house's draft", { skip }, async () => {
  await seed();
  assert.equal((await judge("rei/a-gate")).ground, "home",
    "the walk's houseOf (liveHouseOfVia): solo:rei is hh:starforge");
});

test("A MOVE PENDING THIS WINDOW · a draft where the parcel is leaving is commons; one where it is going is home", { skip }, async () => {
  await seed();
  assert.equal((await judge("sable/a-shed-left-behind", "sable")).ground, "commons",
    "the amend replaces the orchard's standing row: it no longer stands at its old place");
  assert.equal((await judge("sable/a-shed-at-the-new-place", "sable")).ground, "home");
});

test("NOTHING TO JUDGE · a slug with no draft or open claim of the author's is 'could not tell', never a ground", { skip }, async () => {
  await seed();
  const g = await judge("rei/no-such-mark");
  assert.equal(g.known, false);
  assert.match(g.why, /no draft or open claim/);
});

test("PARITY · the export's commons answers are exactly the clearing's 5.5 escrow-absent refusals over the same rows", { skip }, async () => {
  // Every draft goes forward at ✦0, as the stake door's promotion would put it,
  // and the window clears with the real clearing-job.mjs.
  const ids = await seed();
  const c = await store.connect("world2_owner");
  let tiers;
  try {
    await c.query("UPDATE claims SET status = 'pending', submitted_at = now() WHERE status = 'draft'");
    const q = (sql, params) => c.query(sql, params);
    const { rows: pending } = await c.query("SELECT * FROM claims WHERE window_id = $1 AND status = 'pending'", [WIN]);
    const candidates = [];
    for (const cl of pending) {
      // the clearing's step-1 amend test: a claim continues the standing row of
      // its slug when it supersedes that row
      const { rows: [row] } = await c.query("SELECT id::text FROM marks WHERE slug = $1 AND status = 'standing'", [cl.slug]);
      candidates.push(await candidateRowOf(q, cl, { continues: row && String(cl.supersedes ?? "") === row.id ? row : null }));
    }
    tiers = await prospectiveTiers(q, { candidates });
  } finally { await c.end(); }
  const judged = Object.values(ids);
  const r = spawnSync(process.execPath, [JOB, "--window", String(WIN)], {
    cwd: ROOT, encoding: "utf8",
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, WORLD2_CLEARING_URL: store.url("clearing_job") },
  });
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  const o = await store.connect("world2_owner");
  try {
    const { rows } = await o.query("SELECT slug, status, refusal_check FROM claims WHERE id = ANY($1::uuid[])", [judged]);
    const refused = rows.filter((x) => /^escrow-absent/.test(x.refusal_check ?? "")).map((x) => x.slug).sort();
    const commons = rows.filter((x) => rowClassOf(tiers.get(x.slug)) === "commons").map((x) => x.slug).sort();
    assert.deepEqual(refused, ["rei/a-bench-on-open-ground", "rei/a-ribbon", "sable/a-shed-left-behind"],
      "the fixture exercises refusals, and only these: open ground, unwelcomed ground, and the ground a moving parcel leaves");
    assert.deepEqual(commons, refused, "two readers of one walk, and they have drifted");
  } finally { await o.end(); }
});
