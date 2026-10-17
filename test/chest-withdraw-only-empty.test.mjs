// chest-withdraw-only-empty.test.mjs — WLD-27, Wright's independent review F1:
// A CHEST IS WITHDRAWN ONLY WHEN IT HOLDS NOTHING.
//
//   node --test test/chest-withdraw-only-empty.test.mjs
//
// The real door (`journalWithdraw`) over the real pen (`penWrite` →
// `officeWrite`, the office_api role) on a real Postgres (embedded-store.mjs,
// the whole schema). A chest holding units of any label, a whole thing, or
// both is refused, named, and NOTHING is written — no withdraw act, the claim
// untouched. A genuinely empty chest withdraws; a non-chest withdraws as before.
// And the ordering: the withdrawal and an ordinary give / stock take one lock,
// so one of them sees the other — a give after the withdrawal is refused, a
// give before it makes the withdrawal refuse. Synthetic handles only.

import { after, test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";

// An empty published world (no canon marks): every mark here is live, in the store.
const clone = mkdtempSync(join(tmpdir(), "wld27-f1-world-"));
after(() => rmSync(clone, { recursive: true, force: true }));
mkdirSync(join(clone, "WORLD"), { recursive: true });
writeFileSync(join(clone, "WORLD", "world-state.json"), JSON.stringify({ tick: 0, dials: {}, marks: [] }));
writeFileSync(join(clone, "WORLD", "skeleton.json"), JSON.stringify({ features: [], physics_registry: {} }));
const git = (...a) => execFileSync("git", ["-C", clone, ...a], { stdio: ["ignore", "pipe", "pipe"] });
git("init", "-q", "-b", "main"); git("add", "-A");
git("-c", "user.name=fixture", "-c", "user.email=fixture@test.invalid", "commit", "-q", "-m", "an empty world");
process.env.WORLD_CLONE = clone;

const { RECORD_ON } = await import("./acts-pen-stub.mjs");
const { __setPoolForTest } = await import("../src/world2-pen.mjs");
const { journalWithdraw } = await import("../src/world.mjs");
const { chestRoomGuard, chestEmptyGuard, CHEST_LOCK_SQL, chestLockKey } = await import("../src/chest-lock.mjs");
const { stockChests } = await import("../world2/tools/chest-stock.mjs");
const { startStore } = await import("./helpers/embedded-store.mjs");

const store = await startStore({ db: "chest_withdraw_test" });
const skip = store.skip ?? false;
const saved = { WORLD2_PG: process.env.WORLD2_PG, WORLD2_PG_URL: process.env.WORLD2_PG_URL };
let pool = null;
after(async () => {
  __setPoolForTest(null); if (pool) await pool.end();
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  if (!skip) await store.stop();
});

const WIN = 250;
async function owner(fn) { const c = await store.connect("world2_owner"); try { return await fn(c); } finally { await c.end(); } }
const box = (x) => `((${x - 1},-1),(${x + 1},1))`;
let n = 0;

async function seed() {
  if (!pool) {
    const { default: pg } = await import("pg");
    pool = new pg.Pool({ connectionString: store.url("office_api") });
    Object.assign(process.env, RECORD_ON);
    __setPoolForTest(pool);
  }
  await owner(async (c) => {
    await c.query("TRUNCATE acts, claims, marks, mark_carried, settlements, law_projection, windows, households, household_pins CASCADE");
    await c.query(`INSERT INTO windows (id, opens_at, closes_at, status) VALUES ($1, now() - interval '1 hour', now() + interval '11 hours', 'open')`, [WIN]);
    await c.query(`INSERT INTO households (slug, ord, name, residents, since, declared_by) VALUES ('sbx-ana', 0, 'Ana', ARRAY['sbx-ana'], '2026-08-01', 'sbx-ana'), ('sbx-cy', 1, 'Cy', ARRAY['sbx-cy'], '2026-08-01', 'sbx-cy')`);
    await c.query(`INSERT INTO household_pins (handle, login, gh_id, pinned) VALUES ('sbx-ana', 'sbx-ana', 801, '2026-08-01'), ('sbx-cy', 'sbx-cy', 803, '2026-08-01')`);
  });
}

/** A pending chest (or other mark) of Ana's, standing in the live layer, with its leave act. */
async function mark(slug, data = { class: "chest" }) {
  const id = `sbx-ana/${slug}`, x = 10 * ++n;
  await owner(async (c) => {
    const { rows: [a] } = await c.query(`INSERT INTO acts (at, crossing, actor, action, object, class, payload, household) VALUES (now(), 250.1, 'sbx-ana', 'leave-mark', $1, 'mark', '{}', 'hh:sbx-ana') RETURNING id`, [id]);
    await c.query(`INSERT INTO claims (window_id, class, claimant, household, status, body, geometry, bbox, stake, data, slug)
                   VALUES ($1, 'sited', 'sbx-ana', 'hh:sbx-ana', 'pending', 'A mark.', $2, $3::box, 0, $4, $5)`,
      [WIN, JSON.stringify({ at: { x, y: 0 }, extent: { w: 2, h: 2 } }), box(x), JSON.stringify({ ...data, by: "sbx-ana", _act_id: a.id }), id]);
  });
  return id;
}
const units = (chest, n, label = "test-comets") => owner((c) => c.query(
  `INSERT INTO acts (at, crossing, actor, action, object, class, payload, household) VALUES (now(), 250.2, 'sbx-cy', 'units:give', $1, 'holding', $2, 'sbx-cy')`,
  [chest, JSON.stringify({ units: true, moves: [{ from: null, to: chest, label, n }] })]));
const thing = (chest, t) => owner((c) => c.query(
  `INSERT INTO acts (at, crossing, actor, action, object, class, payload, household) VALUES (now(), 250.2, 'sbx-ana', 'give', $1, 'holding', $2, 'sbx-ana')`,
  [t, JSON.stringify({ thing: t, holder: chest, previous_holder: "sbx-ana", made_by: "sbx-ana", policy: "cascade", declared_by: "sbx-ana" })]));
const withdrawActs = (id) => owner(async (c) => (await c.query("SELECT id FROM acts WHERE action = 'withdraw' AND object = $1", [id])).rows.length);
const claimStatus = (id) => owner(async (c) => (await c.query("SELECT status FROM claims WHERE slug = $1", [id])).rows.map((r) => r.status));
const withdraw = (id) => journalWithdraw({ by: "sbx-ana", slug: id.split("/")[1], household: "hh:sbx-ana" });

test("F1 · a chest holding units, a whole thing, or both is refused by name, and nothing is written", { skip }, async () => {
  await seed();
  const cases = [];
  const a = await mark("units-only"); await units(a, 3); await units(a, 2, "test-drops"); cases.push([a, /still holds 5 units$/]);
  const b = await mark("toaster-only"); await thing(b, "sbx-ana/toaster-1"); cases.push([b, /still holds 1 whole thing$/]);
  const m = await mark("mixed"); await units(m, 4); await thing(m, "sbx-ana/toaster-2"); cases.push([m, /still holds 4 units and 1 whole thing$/]);
  for (const [id, said] of cases) {
    const before = await owner(async (c) => (await c.query("SELECT count(*)::int AS n FROM acts")).rows[0].n);
    const e = await withdraw(id).then(() => null, (x) => x);
    assert.ok(e, `${id}: refused`);
    assert.equal(e.code, 409, `${id}: ${e.defect ?? e.message}`);
    assert.match(e.defect, said, id);
    assert.equal(await withdrawActs(id), 0, `${id}: no withdraw act`);
    assert.deepEqual(await claimStatus(id), ["pending"], `${id}: the claim stands untouched`);
    assert.equal(await owner(async (c) => (await c.query("SELECT count(*)::int AS n FROM acts")).rows[0].n), before, `${id}: no act of any kind`);
  }
});

test("F1 · a genuinely empty chest withdraws; a chest emptied by takes withdraws; a non-chest withdraws as before", { skip }, async () => {
  await seed();
  const empty = await mark("empty");
  const r = await withdraw(empty);
  assert.equal(r.withdrawn, true);
  assert.equal(await withdrawActs(empty), 1);
  const emptied = await mark("emptied"); await units(emptied, 3);
  await owner((c) => c.query(`INSERT INTO acts (at, crossing, actor, action, object, class, payload, household) VALUES (now(), 250.3, 'sbx-cy', 'units:take', $1, 'holding', $2, 'sbx-cy')`,
    [emptied, JSON.stringify({ units: true, moves: [{ from: emptied, to: "sbx-cy", label: "test-comets", n: 3 }] })]));
  await owner((c) => c.query(`INSERT INTO acts (at, crossing, actor, action, object, class, payload, household) VALUES (now(), 250.3, 'sbx-ana', 'take', 'sbx-ana/toaster-x', 'holding', $1, 'sbx-ana')`,
    [JSON.stringify({ thing: "sbx-ana/toaster-x", holder: "sbx-ana", previous_holder: emptied, policy: "cascade" })]));
  assert.equal((await withdraw(emptied)).withdrawn, true, "what came out does not count");
  const lamp = await mark("a-lamp", { class: "thing" });
  await units(lamp, 1);                                    // nonsense for a lamp, and no chest rule reads it
  assert.equal((await withdraw(lamp)).withdrawn, true, "a non-chest is not asked what it holds");
});

test("F1 · ORDERING under the one lock: a give that holds the lock first makes the withdrawal refuse; after the withdrawal, a planned give and a stock are refused", { skip }, async () => {
  await seed();
  const chest = await mark("raced");
  // a give holds the chest's lock and has not committed yet
  const giver = await store.connect("office_api");
  await giver.query("BEGIN");
  await chestRoomGuard({ chest, capacity: 30, adding: 2 })(giver);
  await giver.query(`INSERT INTO acts (at, crossing, actor, action, object, class, payload, household) VALUES (now(), 250.4, 'sbx-cy', 'units:give', $1, 'holding', $2, 'sbx-cy')`,
    [chest, JSON.stringify({ units: true, moves: [{ from: null, to: chest, label: "test-comets", n: 2 }] })]);
  const w = withdraw(chest).then(() => "withdrawn", (e) => e.defect);
  await new Promise((r) => setTimeout(r, 300));
  const waiting = await owner(async (c) => (await c.query("SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND NOT granted")).rows[0].n);
  assert.equal(waiting, 1, "the withdrawal waits on the chest's lock");
  await giver.query("COMMIT"); await giver.end();
  assert.match(await w, /still holds 2 units/, "the give landed first and is counted");
  assert.equal(await withdrawActs(chest), 0);

  // the other order: an empty chest is withdrawn; a give planned before it reaches the lock after
  const later = await mark("withdrawn-first");
  assert.equal((await withdraw(later)).withdrawn, true);
  const g = await store.connect("office_api");
  try {
    await g.query("BEGIN");
    await assert.rejects(chestRoomGuard({ chest: later, capacity: 30, adding: 1 })(g), (e) => e.code === 409 && /was withdrawn/.test(e.defect));
    await g.query("ROLLBACK");
  } finally { await g.end(); }
  // and the tick's stock, planned for it, skips it
  await owner(async (c) => {
    await c.query(`INSERT INTO law_projection (law_sha, kind, path, key, data) VALUES ($3, 'class', 'WORLD/candy/mark.md', 'candy', $1), ($3, 'class', 'WORLD/chest/mark.md', 'chest', $2), ($3, 'class', 'WORLD/thing/mark.md', 'thing', '{"class":"thing"}')`,
      [JSON.stringify({ class: "candy", labels: [{ label: "test-comets", name: "Test Comets", creator: "sbx-ana" }] }), JSON.stringify({ class: "chest", dials: { capacity: 30, capacity_min: 1, capacity_max: 120, first_stock: 30 } }), "a".repeat(40)]);
    await c.query(`INSERT INTO settlements (number, tag_sha, published_at, window_id) VALUES (250, $2, now(), $1)`, [WIN, "a".repeat(40)]);
    await c.query(`INSERT INTO marks (id, slug, kind, owner, household, body, geometry, bbox, status, locked_window, data) VALUES (gen_random_uuid(), $1, 'sited', 'sbx-ana', 'sbx-ana', 'A chest.', '{}', '((0,0),(1,1))', 'standing', $2, '{"class":"chest","by":"sbx-ana"}')`, [later, WIN]);
    await c.query(`INSERT INTO mark_carried (mark, settlement, added_sha) VALUES ($1, 250, $2)`, [later, "c".repeat(40)]);
  });
  const tick = await store.connect("office_api");
  const s = await stockChests(tick, { crossing: 250.5 }).finally(() => tick.end());
  assert.deepEqual(s.skipped, [{ chest: later, why: "withdrawn before its stock" }]);
  assert.equal(await owner(async (c) => (await c.query("SELECT count(*)::int AS n FROM acts WHERE action = 'units:stock'")).rows[0].n), 0);
});

test("F1 · the guard alone: the empty check takes the same per-chest lock as the room check", { skip }, async () => {
  await seed();
  const a = await store.connect("office_api"), b = await store.connect("office_api");
  try {
    await a.query("BEGIN"); await chestEmptyGuard({ chest: "sbx-ana/any" })(a);
    await b.query("BEGIN");
    const r = await b.query("SELECT pg_try_advisory_xact_lock(hashtext($1)) AS got", [chestLockKey("sbx-ana/any")]);
    assert.equal(r.rows[0].got, false);
    assert.equal(CHEST_LOCK_SQL, "SELECT pg_advisory_xact_lock(hashtext($1))");
  } finally { await a.query("ROLLBACK"); await b.query("ROLLBACK"); await a.end(); await b.end(); }
});
