// first-laid-chain.test.mjs — A MARK'S FOOTPRINTS ARE READ OFF ITS LOCKED CLAIMS, ON THE STORE (POS-571).
//
//   node --test test/first-laid-chain.test.mjs
//
// World LOGOS conflict-matrix § Roles from seniority: "per-cell (whoever first
// covered a cell is that cell's incumbent)", and "an expansion is a newcomer on
// its new cells" (RULED 2026-10-04). The brief's word on what may count: "Draft,
// pending or refused attempts do not acquire seniority merely by being
// submitted." So the chain is read by the real SQL on a real Postgres
// (mark-render.mjs § CLAIM_CHAIN_SQL, through MARK_COLUMNS for the write-down and
// FOOTPRINT_CHAIN_SQL for the store's fold), never a stub of it.

import test from "node:test";
import assert from "node:assert/strict";
import { startStore } from "./helpers/embedded-store.mjs";
import { recordFromRow, MARK_COLUMNS } from "../world2/tools/mark-render.mjs";
import { withClaimedAt } from "../src/world-snapshot.mjs";

const store = await startStore({ db: "first_laid_chain_test" });
test.after(async () => { await store.stop(); });

const WIN = 300;
async function owner(fn) { const c = await store.connect("world2_owner"); try { return await fn(c); } finally { await c.end(); } }
const geo = (x, w) => JSON.stringify({ at: { x, y: 0 }, extent: { w, h: 100 } });
const box = (x, w) => `((${x - w / 2},-50),(${x + w / 2},50))`;

/**
 * The estate: its origin claim (first laid 08-01 over x -50..50) and a locked
 * amend decided 08-20 reaching x 150, which is what the mark row holds now. Beside
 * them, `extra` claims on the same mark that never stood. → the mark's id.
 */
async function estate(c, { amendStatus = "locked", extra = [] } = {}) {
  await c.query("TRUNCATE claims, marks, windows CASCADE");
  await c.query("INSERT INTO windows (id, opens_at, closes_at, status, cleared_at) VALUES ($1, '2026-07-30', '2026-08-30', 'closed', '2026-08-30')", [WIN]);
  const claim = (status, x, w, data, { supersedes = null, decided = null } = {}) => c.query(
    `INSERT INTO claims (window_id, class, claimant, household, status, decided_at, body, geometry, bbox, stake, data, slug, supersedes)
     VALUES ($1, 'sited', 'ea', 'hh:ea', $2, $3, 'The estate.', $4, $5::box, 0, $6, 'ea/estate', $7) RETURNING id::text`,
    [WIN, status, decided, geo(x, w), box(x, w), JSON.stringify(data), supersedes]);
  const { rows: [origin] } = await claim("locked", 0, 100, { date: "2026-08-01T00:00:00.000Z" }, { decided: "2026-08-01T00:00:00Z" });
  await c.query(
    `INSERT INTO marks (id, slug, kind, owner, household, body, geometry, bbox, status, locked_window, data)
     VALUES ($1, 'ea/estate', 'sited', 'ea', 'hh:ea', 'The estate.', $2, $3::box, 'standing', $4, $5)`,
    [origin.id, geo(50, 200), box(50, 200), WIN, JSON.stringify({ date: "2026-08-20T00:00:00.000Z", tier: "market" })]);
  await claim(amendStatus, 50, 200, { date: "2026-08-20T00:00:00.000Z" }, { supersedes: origin.id, decided: amendStatus === "locked" ? "2026-08-20T00:00:00Z" : null });
  for (const { status, x, w, decided } of extra) await claim(status, x, w, { date: "2026-08-05T00:00:00.000Z" }, { supersedes: origin.id, decided });
  return origin.id;
}
const rowOf = (c) => c.query(`SELECT ${MARK_COLUMNS} FROM marks WHERE slug = 'ea/estate'`).then((r) => r.rows[0]);
const ORIGIN = { since: "2026-08-01T00:00:00.000Z", at: { x: 0, y: 0 }, extent: { w: 100, h: 100 } };
const AMEND = { since: "2026-08-20T00:00:00.000Z", at: { x: 50, y: 0 }, extent: { w: 200, h: 100 } };

test("the write-down reads the estate's footprints off its LOCKED claims: the origin and the amend that took effect", async () => {
  await owner(async (c) => {
    await estate(c);
    const rec = recordFromRow(await rowOf(c));
    assert.equal(rec.claimed_at, "2026-08-01T00:00:00.000Z", "a sited mark carries its first claim, as a parcel always did");
    assert.deepEqual(rec.footprints, [ORIGIN, AMEND]);
  });
});

test("a draft, a pending, a refused or a retracted claim never stood: none of them lays a footprint", async () => {
  await owner(async (c) => {
    // each would reach further east, decided or not; none of them is locked
    await estate(c, { extra: [
      { status: "draft", x: 400, w: 100 }, { status: "pending", x: 500, w: 100 },
      { status: "refused", x: 600, w: 100, decided: "2026-08-10T00:00:00Z" }, { status: "retracted", x: 700, w: 100, decided: "2026-08-11T00:00:00Z" },
    ] });
    assert.deepEqual(recordFromRow(await rowOf(c)).footprints, [ORIGIN, AMEND], "only what stood");
  });
});

test("a chain that does not end at the mark's shape is no history: an amend that never locked leaves nothing to print", async () => {
  await owner(async (c) => {
    await estate(c, { amendStatus: "pending" });
    const rec = recordFromRow(await rowOf(c));
    assert.equal(rec.footprints, undefined, "the origin alone cannot account for today's shape, so nothing is guessed");
    assert.equal(rec.claimed_at, "2026-08-01T00:00:00.000Z", "and its age still rides");
  });
});

test("the chain's end is the mark's shape in WORLD numbers, however it is spelled: a file's own offset and a ring written two ways never drop a whole chain", () => {
  // a seeded mark: its file is written as an offset from its parent (`_fileAt`), its row's geometry in world numbers
  const ring = (x) => [[x - 50, -50], [x + 150, -50], [x + 150, 50], [x - 50, 50]];
  const row = {
    id: "o-1", slug: "ea/estate", kind: "sited", owner: "ea", household: "hh:ea", body: "The estate.",
    geometry: { at: { x: 1050, y: 2000 }, extent: { w: 200, h: 100 }, points: ring(1000).map(([x, y]) => [x, y + 2000]) },
    data: { date: "2026-08-20T00:00:00.000Z", _fileAt: { x: 50, y: 0 } },
    first_claimed: "2026-08-01T00:00:00.000Z", first_claim_submitted_at: null,
    claim_chain: [
      { id: "o-1", geometry: { slug: "ea/estate", at: { x: 1000, y: 2000 }, extent: { w: 100, h: 100 } }, decided_at: "2026-08-01T00:00:00+00:00" },
      { id: "a-1", geometry: { at: { x: 1050, y: 2000 }, extent: { w: 200, h: 100 }, points: ring(1000).map(([x, y]) => ({ x, y: y + 2000 })) }, decided_at: "2026-08-20T00:00:00+00:00" },
    ],
  };
  const rec = recordFromRow(row);
  assert.deepEqual(rec.at, { x: 50, y: 0 }, "the file keeps its own offset");
  assert.equal(rec.footprints?.length, 2, "and the chain, which ends at the row's world shape, is printed whole");
  assert.deepEqual(rec.footprints[1].at, { x: 1050, y: 2000 }, "in world numbers");
});

test("the store's fold reads the same chain: withClaimedAt stamps a non-parcel's first claim and its footprints, checked against the record's own shape", async () => {
  await owner(async (c) => {
    await estate(c);
    const now = { id: "ea/estate", kind: "sited", at: { x: 50, y: 0 }, extent: { w: 200, h: 100 }, date: "2026-08-20T00:00:00.000Z" };
    const [stamped] = await withClaimedAt(c, [{ ...now }]);
    assert.equal(stamped.claimed_at, "2026-08-01T00:00:00.000Z");
    assert.deepEqual(stamped.footprints, [ORIGIN, AMEND]);
    // a record folded as it stood before the amend: the chain ends elsewhere, so it carries none
    const [before] = await withClaimedAt(c, [{ ...now, at: { x: 0, y: 0 }, extent: { w: 100, h: 100 } }]);
    assert.equal(before.footprints, undefined);
    assert.equal(before.claimed_at, "2026-08-01T00:00:00.000Z");
  });
});
