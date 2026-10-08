// a-move-is-one-unit.test.mjs — A MOVE AND ITS RIDERS ARE FILED AS ONE UNIT (POS-356).
//
//   node --test test/a-move-is-one-unit.test.mjs
//
// THE RULING (Darko, 2026-10-08, on #427): a mover and its riders are filed under
// one savepoint at step 6.1. If any of it is refused (a constraint, a cycle, a
// revive no longer retired), the savepoint is rolled back: no rider claim row
// survives, every rider stays where it stands, and the mover alone is refused
// `unfileable`, naming the rider and the constraint. The rest of the window
// locks. Any other error still refuses the window.
//
// THE RIG is test/carry-at-the-clearing.test.mjs's: a real Postgres and the real
// `clearing-job.mjs` as a child under the `clearing_job` pen, because the
// refusals here are constraints only Postgres raises.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { startStore } from "./helpers/embedded-store.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const JOB = join(ROOT, "world2", "tools", "clearing-job.mjs");
const TOWN_SHA = "t".repeat(40);
const LAW_SHA = "l".repeat(40);
const WIN = 250;

const store = await startStore({ db: "move_unit_test" });
const skip = store.skip ?? false;

const box = (at, ext) => `((${at.x - ext.w / 2},${at.y - ext.h / 2}),(${at.x + ext.w / 2},${at.y + ext.h / 2}))`;
const HOUSES = { rei: "starforge", sable: "rabbit", ada: "ada" };

async function owner(fn) {
  const c = await store.connect("world2_owner");
  try { return await fn(c); } finally { await c.end(); }
}
const read = (sql, args = []) => owner(async (c) => (await c.query(sql, args)).rows);
const placeOf = async (slug) => (await read("SELECT geometry FROM marks WHERE slug = $1", [slug]))[0]?.geometry?.at ?? null;

/**
 * Windows 249 closed and 250 open, three houses, the given standing marks (each
 * with its locking claim), the given moves, and one lawful new claim of ada's.
 * Returns { moves: claim ids in order, lawful: ada's claim id }.
 */
async function seed({ marks, moves }) {
  return owner(async (c) => {
    await c.query("TRUNCATE escrow_projection, claims, marks, windows, projection_heads, households, household_pins CASCADE");
    for (const id of [WIN - 1, WIN]) {
      const opens = new Date(Date.UTC(2026, 9, 7, 18) + (id - WIN + 1) * 12 * 3600e3).toISOString();
      await c.query(
        `INSERT INTO windows (id, opens_at, closes_at, status, cleared_at)
         VALUES ($1, $2, $2::timestamptz + interval '12 hours', $3, $4)`,
        [id, opens, id === WIN ? "open" : "closed", id === WIN ? null : opens]);
    }
    await c.query("INSERT INTO projection_heads (repo, sha, ingested_at) VALUES ('world-law', $1, now()), ('town', $2, now())", [LAW_SHA, TOWN_SHA]);
    for (const [i, [h, slug]] of Object.entries(HOUSES).entries()) {
      await c.query(`INSERT INTO households (slug, ord, name, residents, since, declared_by) VALUES ($1, $2, $1, ARRAY[$3], '2026-08-01', $3)`, [slug, i, h]);
      await c.query(`INSERT INTO household_pins (handle, login, gh_id, pinned) VALUES ($1, $1, $2, '2026-08-01')`, [h, 300 + i]);
    }
    const escrow = (slug, who) => c.query(
      `INSERT INTO escrow_projection (town_sha, mark, holder, household, own_household, n, weight_k)
       VALUES ($1, $2, $3, $4, $4, 1, 1) ON CONFLICT DO NOTHING`, [TOWN_SHA, slug, who, `hh:${HOUSES[who]}`]);
    const ids = {};
    for (const m of marks) {
      const geometry = JSON.stringify(m.ext ? { at: m.at, extent: m.ext } : { at: m.at });
      const bbox = box(m.at, m.ext ?? { w: 1, h: 1 });
      const data = JSON.stringify({ tier: "home", ...(m.data ?? {}) });
      const hh = `hh:${HOUSES[m.owner]}`;
      const { rows: [row] } = await c.query(
        `INSERT INTO claims (window_id, class, claimant, household, status, decided_at, body, geometry, bbox, stake, data, slug)
         VALUES ($1, $2, $3, $4, 'locked', now(), $5, $6, $7::box, 0, $8, $9) RETURNING id::text`,
        [WIN - 1, m.kind, m.owner, hh, `${m.slug}.`, geometry, bbox, data, m.slug]);
      await c.query(
        `INSERT INTO marks (id, slug, kind, owner, household, body, geometry, bbox, status, locked_window, data)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::box, 'standing', $9, $10)`,
        [row.id, m.slug, m.kind, m.owner, hh, `${m.slug}.`, geometry, bbox, WIN - 1, data]);
      ids[m.slug] = row.id;
      await escrow(m.slug, m.owner);
    }
    const out = { moves: [] };
    for (const mv of moves) {
      const m = marks.find((x) => x.slug === mv.slug);
      const { rows: [row] } = await c.query(
        `INSERT INTO claims (window_id, class, claimant, household, status, body, geometry, bbox, stake, data, slug, supersedes)
         VALUES ($1, $2, $3, $4, 'pending', $5, $6, $7::box, 0, '{"date":"2026-10-08"}', $8, $9) RETURNING id::text`,
        [WIN, m.kind, m.owner, `hh:${HOUSES[m.owner]}`, `${m.slug}, moved.`,
         JSON.stringify({ slug: m.slug, at: mv.to, extent: m.ext }), box(mv.to, m.ext), m.slug, ids[m.slug]]);
      out.moves.push(row.id);
    }
    const { rows: [lawful] } = await c.query(
      `INSERT INTO claims (window_id, class, claimant, household, status, body, geometry, bbox, stake, data, slug)
       VALUES ($1, 'sited', 'ada', 'hh:ada', 'pending', 'A lamp.', $2, $3::box, 0, '{"date":"2026-10-08"}', 'ada/a-lamp')
       RETURNING id::text`,
      [WIN, JSON.stringify({ slug: "ada/a-lamp", at: { x: 9000, y: 9000 }, extent: { w: 2, h: 2 } }), box({ x: 9000, y: 9000 }, { w: 2, h: 2 })]);
    await escrow("ada/a-lamp", "ada");
    out.lawful = lawful.id;
    return out;
  });
}

function clear() {
  const r = spawnSync(process.execPath, [JOB, "--window", String(WIN)], {
    cwd: ROOT, encoding: "utf8",
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, WORLD2_CLEARING_URL: store.url("clearing_job") },
  });
  return { code: r.status, out: `${r.stdout}\n${r.stderr}` };
}

const riderClaims = () => read("SELECT slug, status FROM claims WHERE window_id = $1 AND data ? '_carried_by'", [WIN]);

test("a rider that trips a constraint refuses the move alone: no rider claim row survives, every rider stays, the rest lock", { skip }, async () => {
  // The district carries rei's house (fine) and rei's lamp, a SITED mark whose
  // geometry has no extent: carried, its claim gets no bbox, and Postgres refuses
  // the lamp's row (sited_marks_have_a_where). Step 5.7 does not ask about that.
  const { moves: [move], lawful } = await seed({
    marks: [
      { slug: "rei/the-district", kind: "sited", owner: "rei", at: { x: 1000, y: 1000 }, ext: { w: 200, h: 200 } },
      { slug: "rei/the-house", kind: "sited", owner: "rei", at: { x: 1010, y: 1010 }, ext: { w: 10, h: 10 }, data: { _parentMarkId: "rei/the-district" } },
      { slug: "rei/the-lamp", kind: "sited", owner: "rei", at: { x: 990, y: 990 }, data: { _parentMarkId: "rei/the-district" } },
    ],
    moves: [{ slug: "rei/the-district", to: { x: 1300, y: 1000 } }],
  });
  const run = clear();
  assert.equal(run.code, 0, `one move the store refuses must never roll a window back:\n${run.out}`);

  const [m] = await read("SELECT status, refusal_check FROM claims WHERE id = $1", [move]);
  assert.equal(m.status, "refused");
  assert.equal(m.refusal_check,
    "unfileable: the move of rei/the-district couldn't carry rei/the-lamp: rei/the-lamp is a sited mark with no place, so it could not be filed. (store: sited_marks_have_a_where)",
    "the mover alone is refused, naming the rider and the constraint");

  assert.deepEqual(await placeOf("rei/the-district"), { x: 1000, y: 1000 }, "the mover did not move");
  assert.deepEqual(await placeOf("rei/the-house"), { x: 1010, y: 1010 }, "a rider that would have filed stays too: one unit");
  assert.deepEqual(await placeOf("rei/the-lamp"), { x: 990, y: 990 });
  assert.deepEqual(await riderClaims(), [], "no rider claim row survives the rollback");

  const [ok] = await read("SELECT status FROM claims WHERE id = $1", [lawful]);
  assert.equal(ok.status, "locked", "the rest of the window locks");

  const [w] = await read("SELECT receipts FROM windows WHERE id = $1", [WIN]);
  assert.equal(w.receipts.carried, undefined, "a refused move is not on the carried list");
  assert.deepEqual(w.receipts.unfileable.map((u) => u.slug), ["rei/the-district"], "it is on the unfileable list");
  assert.deepEqual(w.receipts.six_count, { locked: 1, refused: 1, held_review: 0, retracted_before_close: 0, pending_carried: 0 });
});

test("two moves whose carried parcels collide: the first carries, the second refuses alone", { skip }, async () => {
  // Each district carries its household's parcel to (4500, 3000). Step 5.7 cannot
  // see it (both parcels are moving), so the store's exclusion constraint does.
  const { moves: [first, second], lawful } = await seed({
    marks: [
      { slug: "rei/the-district", kind: "sited", owner: "rei", at: { x: 3000, y: 3000 }, ext: { w: 200, h: 200 } },
      { slug: "rei/the-parcel", kind: "parcel", owner: "rei", at: { x: 3000, y: 3000 }, ext: { w: 25, h: 25 }, data: { _parentMarkId: "rei/the-district" } },
      { slug: "sable/the-district", kind: "sited", owner: "sable", at: { x: 6000, y: 3000 }, ext: { w: 200, h: 200 } },
      { slug: "sable/the-parcel", kind: "parcel", owner: "sable", at: { x: 6000, y: 3000 }, ext: { w: 25, h: 25 }, data: { _parentMarkId: "sable/the-district" } },
    ],
    moves: [
      { slug: "rei/the-district", to: { x: 4500, y: 3000 } },
      { slug: "sable/the-district", to: { x: 4500, y: 3000 } },
    ],
  });
  const run = clear();
  assert.equal(run.code, 0, run.out);

  const rows = await read("SELECT id::text, status, refusal_check FROM claims WHERE id = ANY($1)", [[first, second, lawful]]);
  const by = Object.fromEntries(rows.map((r) => [r.id, r]));
  assert.equal(by[first].status, "locked", "the first move carries");
  assert.equal(by[second].status, "refused");
  assert.equal(by[second].refusal_check,
    "unfileable: the move of sable/the-district couldn't carry sable/the-parcel: a parcel already holds this ground, so sable/the-parcel could not be filed on it. (store: parcels_do_not_overlap)");
  assert.equal(by[lawful].status, "locked");

  assert.deepEqual(await placeOf("rei/the-parcel"), { x: 4500, y: 3000 });
  assert.deepEqual(await placeOf("sable/the-district"), { x: 6000, y: 3000 });
  assert.deepEqual(await placeOf("sable/the-parcel"), { x: 6000, y: 3000 });
  assert.deepEqual(await riderClaims(), [{ slug: "rei/the-parcel", status: "locked" }], "only the first move's rider claim stands");

  const [w] = await read("SELECT receipts FROM windows WHERE id = $1", [WIN]);
  assert.deepEqual(w.receipts.carried.map((m) => m.slug), ["rei/the-district"]);
  assert.deepEqual(w.receipts.unfileable.map((u) => u.slug), ["sable/the-district"]);
});
