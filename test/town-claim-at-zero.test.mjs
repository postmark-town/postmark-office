// town-claim-at-zero.test.mjs — THE CANDLE NEVER REFUSES THE TOWN'S OWN CLAIM AT
// ✦0 (POS-701).
//
//   node --test test/town-claim-at-zero.test.mjs
//
// Darko, 2026-10-19 09:21 (POS-696): "constitutional marks need no stake." The
// notary was fixed first (canon-locks.mjs, through escrow-presence.mjs §
// townsOwn), and POS-696's gap read found the candle still refusing: step 5.5
// walks a claim by the-town on open ground to `market`, and a commons claim with
// nothing staked is refused `escrow-absent`. So any town-filed mark through the
// claims path would have been refused.
//
// POS-702 decided it in the walk, not with a clause at the gate: `standing.mjs §
// markStanding` answers `constitution` for every mark by the town (`townOwned`),
// and only `commons` needs escrow. This pins it where it matters, at the candle,
// with the real `clearing-job.mjs`: the town's ✦0 claim on open ground locks,
// and a resident's ✦0 claim beside it is refused. ONE PREDICATE: the notary's
// `townsOwn` now asks the same `townOwned` (escrow-presence.mjs).
//
// THE FLIP: in standing.mjs § markStanding, delete
// `if (townOwned(mark)) return "constitution";` and the town's claim is refused
// `escrow-absent` here.
//
// THE TOWN'S HAND ONLY, NEVER A TIER OR A LOOKALIKE. POS-696, Wright, 2026-10-19
// 13:50Z: "Reading Darko's 'constitutional marks need no stake' as 'the town's
// own marks need no stake', matching 1.0's townOwned exemption." So the same
// clearing also judges three claims that must not ride it, each read alone:
//   · a resident's ✦0 claim that writes `tier: constitution` is refused: an
//     exemption by tier in markStanding locks it;
//   · a claimant that only pads the town's handle is refused: materialize.mjs §
//     ownerHouseholdFor trims it to the town's house, so it passes 5.4 and meets
//     5.5, and a townOwned that trims too locks it;
//   · a resident's claim on a mark somebody staked locks: the escrow gate itself
//     is unchanged.
// And the owner is the only field that names the town: a row with no owner is
// never the town's through its household column, in the notary's read and in
// the walk's own record (standing.mjs § recordOf).
//
// THE RIG is clearing-escrow-order.test.mjs's: a real Postgres
// (test/helpers/embedded-store.mjs) and the real clearing as `clearing_job`.

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
const WIN = 270;

const store = await startStore({ db: "town_claim_at_zero_test" });
after(() => store.stop());
const skip = store.skip ?? false;

const { townsOwn } = await import("../world2/tools/escrow-presence.mjs");
const { townOwned, markStanding, recordOf } = await import("../world2/tools/standing.mjs");

const box = (at, ext) => `((${at.x - ext.w / 2},${at.y - ext.h / 2}),(${at.x + ext.w / 2},${at.y + ext.h / 2}))`;
const ONE = { w: 1, h: 1 };

async function seed() {
  const c = await store.connect("world2_owner");
  try {
    await c.query("TRUNCATE escrow_projection, claims, marks, windows, projection_heads, households, household_pins CASCADE");
    for (const id of [WIN - 1, WIN]) {
      const opens = new Date(Date.UTC(2026, 9, 26, 6) + (id - WIN + 1) * 12 * 3600e3).toISOString();
      await c.query(
        `INSERT INTO windows (id, opens_at, closes_at, status, cleared_at)
         VALUES ($1, $2, $2::timestamptz + interval '12 hours', $3, $4)`,
        [id, opens, id === WIN ? "open" : "closed", id === WIN ? null : opens]);
    }
    await c.query("INSERT INTO projection_heads (repo, sha, ingested_at) VALUES ('world-law', $1, now()), ('town', $2, now())", [LAW_SHA, TOWN_SHA]);
    await c.query(
      `INSERT INTO households (slug, ord, name, residents, since, declared_by)
       VALUES ('starforge', 0, 'Starforge', ARRAY['rei'], '2026-08-01', 'rei')`);
    await c.query(`INSERT INTO household_pins (handle, login, gh_id, pinned) VALUES ('rei', 'rei', 201, '2026-08-01')`);
    // somebody's stake on another mark, so the escrow read is a real answer
    // (an empty projection reports every commons claim UNCHECKED and refuses none)
    await c.query(
      `INSERT INTO escrow_projection (town_sha, mark, holder, household, own_household, n, weight_k)
       VALUES ($1, 'rei/a-staked-stone', 'rei', 'hh:starforge', 'hh:starforge', 1, 0)`, [TOWN_SHA]);
    const claim = async (slug, claimant, household, at, data = { date: "2026-10-26" }) => (await c.query(
      `INSERT INTO claims (window_id, class, claimant, household, status, body, geometry, bbox, stake, data, slug)
       VALUES ($1, 'sited', $2, $3, 'pending', $4, $5, $6::box, 0, $7, $8)
       RETURNING id::text`,
      [WIN, claimant, household, `${slug}.`, JSON.stringify({ slug, at, extent: ONE }), box(at, ONE), JSON.stringify(data), slug])).rows[0].id;
    return {
      town: await claim("the-town/a-signpost", "the-town", "solo:the-town", { x: 7000, y: 7000 }),
      resident: await claim("rei/a-signpost", "rei", "hh:starforge", { x: 7010, y: 7000 }),
      charter: await claim("rei/a-charter", "rei", "hh:starforge", { x: 7020, y: 7000 }, { date: "2026-10-26", tier: "constitution" }),
      padded: await claim("the-town/a-padded-post", " the-town", "solo:the-town", { x: 7030, y: 7000 }),
      staked: await claim("rei/a-staked-stone", "rei", "hh:starforge", { x: 7040, y: 7000 }),
    };
  } finally { await c.end(); }
}

// ONE CLEARING for every case below, so each assertion reads the same verdict
// and a red in one never hides another.
let cleared = null;
async function clearedOnce() {
  if (!cleared) {
    const ids = await seed();
    const r = spawnSync(process.execPath, [JOB, "--window", String(WIN)], {
      cwd: ROOT, encoding: "utf8",
      env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, WORLD2_CLEARING_URL: store.url("clearing_job") },
    });
    cleared = { ids, r, out: `${r.stdout}\n${r.stderr}` };
  }
  return cleared;
}

async function statusOf(id) {
  const c = await store.connect("world2_owner");
  try {
    const { rows: [row] } = await c.query("SELECT status, refusal_check FROM claims WHERE id = $1", [id]);
    return row ? `${row.status}${row.refusal_check ? `: ${row.refusal_check}` : ""}` : null;
  } finally { await c.end(); }
}

test("THE TOWN AT ✦0 · a claim by the-town on open ground locks; a resident's beside it is refused escrow-absent", { skip }, async () => {
  const { ids, r, out } = await clearedOnce();
  assert.equal(r.status, 0, out);
  assert.equal(await statusOf(ids.town), "locked", "POS-701: the town's own marks need no stake, at the candle too");
  assert.match(await statusOf(ids.resident), /^refused: escrow-absent/, "the control: the same ground, a resident, nothing staked");
});

test("NO TIER EXEMPTION · a resident's ✦0 claim that writes tier: constitution is still refused escrow-absent", { skip }, async () => {
  const { ids, out } = await clearedOnce();
  assert.match(await statusOf(ids.charter), /^refused: escrow-absent/,
    `POS-696: the exemption is the town's own hand, not a tier a resident can write\n${out}`);
});

test("NO LOOKALIKE · a claimant that only pads the town's handle reaches 5.5 and is refused escrow-absent", { skip }, async () => {
  const { ids, out } = await clearedOnce();
  assert.match(await statusOf(ids.padded), /^refused: escrow-absent/,
    `townOwned matches the owner exactly; the house lookup's trim lends it the town's house, never its exemption\n${out}`);
});

test("NORMAL ESCROW · a resident's ✦0 claim on a mark somebody staked still locks", { skip }, async () => {
  const { ids, out } = await clearedOnce();
  assert.equal(await statusOf(ids.staked), "locked", `the gate asks for somebody's stamps, and these are there\n${out}`);
});

test("ONE PREDICATE · the notary's townsOwn answers exactly what the walk's townOwned answers for a row's owner", () => {
  for (const owner of ["the-town", "rei", "the-town-crier", " the-town", "The-Town", null, undefined])
    assert.equal(townsOwn({ owner, tier: "market" }), townOwned({ by: owner }), `owner ${JSON.stringify(owner)}`);
  assert.equal(townsOwn({ slug: "the-town/orient" }), false, "the slug is not the owner");
  assert.equal(townsOwn(null), false);
});

test("THE OWNER ONLY · a row with no owner is never the town's through its household column, in the notary or the walk", () => {
  assert.equal(townsOwn({ owner: null, household: "the-town", tier: "market" }), false, "the notary reads marks.owner, nothing else");
  const row = { id: null, slug: "someone/a-stone", kind: "sited", owner: null, household: "the-town", geometry: null, parent: null, data: {} };
  assert.notEqual(markStanding(recordOf(row), new Map()), "constitution", "the walk's record carries the owner as `by`, and no household beside it");
});
