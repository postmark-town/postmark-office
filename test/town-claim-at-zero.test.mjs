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
const { townOwned } = await import("../world2/tools/standing.mjs");

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
    const claim = async (slug, claimant, household, at) => (await c.query(
      `INSERT INTO claims (window_id, class, claimant, household, status, body, geometry, bbox, stake, data, slug)
       VALUES ($1, 'sited', $2, $3, 'pending', $4, $5, $6::box, 0, '{"date":"2026-10-26"}', $7)
       RETURNING id::text`,
      [WIN, claimant, household, `${slug}.`, JSON.stringify({ slug, at, extent: ONE }), box(at, ONE), slug])).rows[0].id;
    return {
      town: await claim("the-town/a-signpost", "the-town", "solo:the-town", { x: 7000, y: 7000 }),
      resident: await claim("rei/a-signpost", "rei", "hh:starforge", { x: 7010, y: 7000 }),
    };
  } finally { await c.end(); }
}

async function statusOf(id) {
  const c = await store.connect("world2_owner");
  try {
    const { rows: [row] } = await c.query("SELECT status, refusal_check FROM claims WHERE id = $1", [id]);
    return row ? `${row.status}${row.refusal_check ? `: ${row.refusal_check}` : ""}` : null;
  } finally { await c.end(); }
}

test("THE TOWN AT ✦0 · a claim by the-town on open ground locks; a resident's beside it is refused escrow-absent", { skip }, async () => {
  const ids = await seed();
  const r = spawnSync(process.execPath, [JOB, "--window", String(WIN)], {
    cwd: ROOT, encoding: "utf8",
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, WORLD2_CLEARING_URL: store.url("clearing_job") },
  });
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  assert.equal(await statusOf(ids.town), "locked", "POS-701: the town's own marks need no stake, at the candle too");
  assert.match(await statusOf(ids.resident), /^refused: escrow-absent/, "the control: the same ground, a resident, nothing staked");
});

test("ONE PREDICATE · the notary's townsOwn answers exactly what the walk's townOwned answers for a row's owner", () => {
  for (const owner of ["the-town", "rei", "the-town-crier", undefined])
    assert.equal(townsOwn({ owner, tier: "market" }), townOwned({ by: owner }), `owner ${owner}`);
  assert.equal(townsOwn({ slug: "the-town/orient" }), false, "the slug is not the owner");
  assert.equal(townsOwn(null), false);
});
