// chest-stock.test.mjs — WLD-27: the first stock of a chest, in a real store.
//
//   node --test test/chest-stock.test.mjs
//
// A real Postgres (test/helpers/embedded-store.mjs) with the whole schema, the
// stock written as `office_api` — the pen the settlement tick holds — against
// SYNTHETIC candy labels in `law_projection` (never the town's assignments).
// What it proves, each in the store's own terms:
//   · a settlement admitting chests stocks each with min(30, capacity), once;
//   · a replay or retry writes nothing more (the plan, and the nonce index);
//   · a maker with no label is admitted unstocked, named, and not counted;
//   · a later label stocks that chest at the next tick, exactly once;
//   · units already in a chest are kept, and the stock never overfills it.

import { after, test } from "node:test";
import assert from "node:assert/strict";
import { startStore } from "./helpers/embedded-store.mjs";
import { stockChests, stockNonce, TOWN_PEN, TOWN_HOUSEHOLD } from "../world2/tools/chest-stock.mjs";
import { stockedOnTick, chestsAfterCarried } from "../world2/tools/settlements-backfill.mjs";
import { chestRoomGuard, CHEST_LOCK_SQL, chestLockKey } from "../src/chest-lock.mjs";
import { foldUnits, totalOf, edgesOf, UNIT_ACTION } from "../src/world-stacks.mjs";

// WLD-27's doors ship dark by default (src/chests-candy.mjs); these are their own tests, so they run with them open.
process.env.WORLD_CHESTS_CANDY = "1";

const store = await startStore({ db: "chest_stock_test" });
after(() => store.stop());
const skip = store.skip ?? false;
const WIN = 250;
const SHA_A = "a".repeat(40), SHA_B = "b".repeat(40);
const CHEST_DIALS = { capacity: 30, capacity_min: 1, capacity_max: 120, first_stock: 30, portable: true, welcome: "open" };
const LABELS_A = [{ label: "test-comets", name: "Test Comets", creator: "sbx-ana" }];
const LABELS_B = [...LABELS_A, { label: "test-eves", name: "Test Eves", creator: "sbx-eve" }];

let n = 0;
const uuid = () => `c0000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
const box = (at) => `((${at.x - 1},${at.y - 1}),(${at.x + 1},${at.y + 1}))`;

async function owner(fn) { const c = await store.connect("world2_owner"); try { return await fn(c); } finally { await c.end(); } }
async function asOffice(fn) { const c = await store.connect("office_api"); try { return await fn(c); } finally { await c.end(); } }

async function law(c, sha, number, labels) {
  for (const [key, data] of [["candy", { class: "candy", extends: "consumable", dials: {}, labels }], ["chest", { class: "chest", extends: "thing", dials: CHEST_DIALS }], ["thing", { class: "thing", extends: "mark", dials: { carry_cap: 24 } }]])
    await c.query("INSERT INTO law_projection (law_sha, kind, path, key, data) VALUES ($1, 'class', $2, $3, $4)", [sha, `WORLD/${key}/mark.md`, key, JSON.stringify(data)]);
  await c.query("INSERT INTO settlements (number, tag_sha, published_at, window_id) VALUES ($1, $2, now(), $3)", [number, sha, WIN]);
}

async function carried(c, slug, settlement = 250) {
  await c.query("INSERT INTO mark_carried (mark, settlement, added_sha) VALUES ($1, $2, $3)", [slug, settlement, "c".repeat(40)]);
}

async function chest(c, slug, data = {}, { admitted = 250 } = {}) {
  const id = uuid(), at = { x: 10 * n, y: 0 };
  const owner = slug.split("/")[0];
  const geometry = JSON.stringify({ at, extent: { w: 2, h: 2 } }), d = JSON.stringify({ class: "chest", by: owner, ...data });
  await c.query(`INSERT INTO claims (id, window_id, class, claimant, household, status, decided_at, body, geometry, bbox, stake, data, slug)
                 VALUES ($1, $2, 'sited', $3, $4, 'locked', now(), 'A chest.', $5, $6::box, 1, $7, $8)`, [id, WIN, owner, `hh:${owner}`, geometry, box(at), d, slug]);
  await c.query(`INSERT INTO marks (id, slug, kind, owner, household, body, geometry, bbox, status, locked_window, data)
                 VALUES ($1, $2, 'sited', $3, $4, 'A chest.', $5, $6::box, 'standing', $7, $8)`, [id, slug, owner, `hh:${owner}`, geometry, box(at), WIN, d]);
  if (admitted != null) await carried(c, slug, admitted);
}

async function seed() {
  await owner(async (c) => {
    await c.query("TRUNCATE acts, claims, marks, mark_carried, settlements, law_projection, windows CASCADE");
    await c.query(`INSERT INTO windows (id, opens_at, closes_at, status, cleared_at) VALUES ($1, now() - interval '12 hours', now(), 'closed', now())`, [WIN]);
    await law(c, SHA_A, 250, LABELS_A);
    await chest(c, "sbx-ana/the-bowl");
    await chest(c, "sbx-ana/the-thimble", { capacity: 1 });
    await chest(c, "sbx-ana/the-tub", { capacity: 120 });
    await chest(c, "sbx-eve/her-chest", { capacity: 20 });
  });
}
const units = () => owner(async (c) => (await c.query("SELECT id, class, action, object, payload, actor, household, nonce FROM acts WHERE action LIKE 'units:%' ORDER BY at, id")).rows);

test("a settlement's chests are stocked min(30, capacity), once; the unlabelled maker's chest is admitted unstocked and named", { skip }, async () => {
  await seed();
  const r = await asOffice((c) => stockChests(c, { crossing: 250.5 }));
  assert.deepEqual(r.stocked.map((s) => [s.chest, s.n]).sort(), [["sbx-ana/the-bowl", 30], ["sbx-ana/the-thimble", 1], ["sbx-ana/the-tub", 30]]);
  assert.match(r.line, /chest-unstocked: sbx-eve has no candy label/);
  const rows = await units();
  assert.equal(rows.length, 3);
  for (const a of rows) {
    assert.deepEqual([a.action, a.actor, a.household, a.nonce], [UNIT_ACTION.stock, TOWN_PEN, TOWN_HOUSEHOLD, stockNonce(a.object)]);
    assert.equal(a.payload.settlement, 250);
  }
  const fold = foldUnits(rows);
  assert.deepEqual(edgesOf(fold, "sbx-ana/the-bowl"), [{ label: "test-comets", count: 30 }]);
  assert.equal(totalOf(fold, "sbx-eve/her-chest"), 0, "admitted, not stocked, and not counted as stocked");

  // the replay: the tick runs again, and again — nothing more is written
  const again = await asOffice((c) => stockChests(c, { crossing: 250.6 }));
  assert.deepEqual(again.stocked, []);
  assert.equal((await units()).length, 3);
});

test("the nonce index is the second wall: a racing insert of the same stock writes nothing", { skip }, async () => {
  await seed();
  await asOffice((c) => stockChests(c, { crossing: 250.5 }));
  const dup = await asOffice((c) => c.query(
    `INSERT INTO acts (at, crossing, actor, action, object, class, payload, effect, household, nonce)
     VALUES (now(), 250.7, $1, $2, 'sbx-ana/the-bowl', 'holding', '{"units":true,"moves":[{"from":null,"to":"sbx-ana/the-bowl","label":"test-comets","n":30}]}', 'x', $3, $4)
     ON CONFLICT DO NOTHING RETURNING id`, [TOWN_PEN, UNIT_ACTION.stock, TOWN_HOUSEHOLD, stockNonce("sbx-ana/the-bowl")]));
  assert.equal(dup.rows.length, 0);
  assert.equal(totalOf(foldUnits(await units()), "sbx-ana/the-bowl"), 30);
});

test("a label registered later stocks the unstocked chest at the next tick, once, keeping what was given into it", { skip }, async () => {
  await seed();
  await asOffice((c) => stockChests(c, { crossing: 250.5 }));
  // someone gave 4 units into Eve's empty chest meanwhile
  await asOffice((c) => c.query(`INSERT INTO acts (at, crossing, actor, action, object, class, payload, effect, household)
     VALUES (now(), 250.8, 'sbx-cy', $1, 'sbx-eve/her-chest', 'holding', '{"units":true,"moves":[{"from":null,"to":"sbx-eve/her-chest","label":"test-comets","n":4}]}', 'a give', 'hh:sbx-cy')`, [UNIT_ACTION.give]));
  await owner((c) => law(c, SHA_B, 251, LABELS_B));
  const r = await asOffice((c) => stockChests(c, { crossing: 251.5 }));
  assert.deepEqual(r.stocked.map((s) => [s.chest, s.label, s.n]), [["sbx-eve/her-chest", "test-eves", 16]], "min(30, 20) less the 4 already in it");
  assert.doesNotMatch(r.line, /chest-unstocked/);
  assert.equal((await asOffice((c) => stockChests(c, { crossing: 251.6 }))).stocked.length, 0);
  assert.deepEqual(edgesOf(foldUnits(await units()), "sbx-eve/her-chest"), [{ label: "test-comets", count: 4 }, { label: "test-eves", count: 16 }]);
});

test("the tick's step is non-fatal: an error is one named line", { skip }, async () => {
  const r = await stockedOnTick(null, { stock: async () => { throw new Error("no store"); }, crossing: () => 1 });
  assert.deepEqual([r.verdict, r.line], ["error", "chests: NOT stocked (non-fatal) — no store"]);
});

test("a whole thing already in a chest takes its slot: the first stock fills only the room left", { skip }, async () => {
  await seed();
  // before the tick, the toaster went into the 20-slot chest of a labelled maker
  await owner((c) => law(c, SHA_B, 251, LABELS_B));
  await asOffice((c) => c.query(`INSERT INTO acts (at, crossing, actor, action, object, class, payload, effect, household)
     VALUES (now() - interval '1 minute', 250.9, 'sbx-cy', 'give', 'sbx-cy/the-toaster', 'holding',
             '{"thing":"sbx-cy/the-toaster","holder":"sbx-eve/her-chest","previous_holder":"sbx-cy","made_by":"sbx-cy","policy":"cascade"}', 'into the chest', 'hh:sbx-cy')`));
  const r = await asOffice((c) => stockChests(c, { crossing: 251.5 }));
  assert.deepEqual(r.stocked.filter((s) => s.chest === "sbx-eve/her-chest").map((s) => s.n), [19], "min(30, 20) less the toaster's one slot");
});


// ── Bevel's review, findings 6 and 7, in the store's own terms ─────────────

test("7 · a standing chest no settlement carried is NOT stocked; once carried, it is stocked at THAT settlement, not the newest", { skip }, async () => {
  await seed();
  await owner(async (c) => {
    await c.query("INSERT INTO settlements (number, tag_sha, published_at, window_id) VALUES (249, $1, now() - interval '1 day', $2)", ["d".repeat(40), WIN]);
    await chest(c, "sbx-ana/the-crate", {}, { admitted: null });
  });
  const before = await asOffice((c) => stockChests(c, { crossing: 250.5 }));
  assert.ok(!before.stocked.some((s) => s.chest === "sbx-ana/the-crate"), "standing in the store is not admitted");
  await owner((c) => carried(c, "sbx-ana/the-crate", 249));
  const after = await asOffice((c) => stockChests(c, { crossing: 250.6 }));
  const crate = after.stocked.find((s) => s.chest === "sbx-ana/the-crate");
  assert.equal(crate?.settlement, 249, "attributed to the settlement that carried it");
  assert.equal((await units()).find((a) => a.object === "sbx-ana/the-crate").payload.settlement, 249);
});

test("7b · the stock is held, and says so, when the carried step did not settle", { skip }, async () => {
  let asked = 0;
  for (const verdict of ["error", "DISAGREE", "skipped", "absent"]) {
    const r = await chestsAfterCarried(null, { verdict }, { stock: async () => { asked += 1; return { line: "x" }; } });
    assert.equal(r.verdict, "held");
    assert.match(r.line, new RegExp(`did not settle \\(${verdict}\\)`));
  }
  assert.equal(asked, 0);
  assert.equal((await chestsAfterCarried(null, { verdict: "ok" }, { stock: async () => ({ line: "stocked" }) })).line, "stocked");
});

test("6 · a give holding the chest's lock is counted by the stock that waits for it — 20 never becomes 24", { skip }, async () => {
  await seed();
  // the eve chest (capacity 20) gets a label, so the tick would stock it 20
  await owner((c) => law(c, SHA_B, 251, LABELS_B));
  const give = await store.connect("office_api");
  try {
    await give.query("BEGIN");
    await chestRoomGuard({ chest: "sbx-eve/her-chest", capacity: 20, adding: 4 })(give);   // takes the lock, finds room
    await give.query(`INSERT INTO acts (at, crossing, actor, action, object, class, payload, effect, household)
       VALUES (now(), 251.1, 'sbx-cy', 'units:give', 'sbx-eve/her-chest', 'holding', '{"units":true,"moves":[{"from":null,"to":"sbx-eve/her-chest","label":"test-comets","n":4}]}', 'a give', 'hh:sbx-cy')`);
    const stocking = asOffice((c) => stockChests(c, { crossing: 251.5 }));   // plans, then waits on the lock
    await new Promise((r) => setTimeout(r, 400));
    await give.query("COMMIT");
    const r = await stocking;
    assert.deepEqual(r.stocked.filter((x) => x.chest === "sbx-eve/her-chest").map((x) => x.n), [16]);
  } finally { await give.end(); }
  assert.equal(totalOf(foldUnits(await units()), "sbx-eve/her-chest"), 20);
});

test("6b · a give after the stock is refused under the same lock, and its transaction writes nothing", { skip }, async () => {
  await seed();
  await asOffice((c) => stockChests(c, { crossing: 250.5 }));   // the bowl: 30 of 30
  const before = (await units()).length;
  const give = await store.connect("office_api");
  try {
    await give.query("BEGIN");
    await assert.rejects(chestRoomGuard({ chest: "sbx-ana/the-bowl", capacity: 30, adding: 1 })(give), (e) => e.code === 409 && /room for 0/.test(e.defect));
    await give.query("ROLLBACK");
  } finally { await give.end(); }
  assert.equal((await units()).length, before);
  // and the lock really is one key per chest: a second session waits on it
  const a = await store.connect("office_api"), b = await store.connect("office_api");
  try {
    await a.query("BEGIN"); await a.query(CHEST_LOCK_SQL, [chestLockKey("sbx-ana/the-bowl")]);
    await b.query("BEGIN");
    const r = await b.query("SELECT pg_try_advisory_xact_lock(hashtext($1)) AS got", [chestLockKey("sbx-ana/the-bowl")]);
    assert.equal(r.rows[0].got, false, "the bowl's lock is held by the first session");
    const other = await b.query("SELECT pg_try_advisory_xact_lock(hashtext($1)) AS got", [chestLockKey("sbx-ana/the-tub")]);
    assert.equal(other.rows[0].got, true, "another chest's lock is free");
  } finally { await a.query("ROLLBACK"); await b.query("ROLLBACK"); await a.end(); await b.end(); }
});

// ── Wright, 2026-10-13T01:19Z: zero room completes the first stock ─────────

test("ZERO ROOM: a labelled chest already full is stocked 0 — the nonce is spent, the line says so, and nothing is minted later", { skip }, async () => {
  await seed();
  await asOffice((c) => stockChests(c, { crossing: 250.5 }));               // eve: unlabelled, unstocked
  // gifts fill eve's 20-slot chest before her label exists
  await asOffice((c) => c.query(`INSERT INTO acts (at, crossing, actor, action, object, class, payload, effect, household)
     VALUES (now(), 250.8, 'sbx-cy', 'units:give', 'sbx-eve/her-chest', 'holding', '{"units":true,"moves":[{"from":null,"to":"sbx-eve/her-chest","label":"test-comets","n":20}]}', 'gifts', 'hh:sbx-cy')`));
  await owner((c) => law(c, SHA_B, 251, LABELS_B));
  const r = await asOffice((c) => stockChests(c, { crossing: 251.5 }));
  // decided at S251, where her label was first found — never "full at S250",
  // before the label existed; S250 stays named as the chest's admission
  assert.match(r.line, /chest-stock: 0, chest full at S251, admitted at S250 \(sbx-eve\/her-chest\)/);
  assert.doesNotMatch(r.line, /chest full at S250/, "no stock decision dated before the label was registered");
  const zero = (await units()).filter((a) => a.object === "sbx-eve/her-chest" && a.action === UNIT_ACTION.stock);
  assert.equal(zero.length, 1);
  assert.deepEqual([zero[0].payload.settlement, zero[0].payload.label_found_at, zero[0].payload.decided_at], [250, 251, 251], "admission kept, decision named");
  assert.match((await owner((c) => c.query("SELECT effect FROM acts WHERE id = $1", [zero[0].id]))).rows[0].effect, /^chest-stock: 0, chest full at S251, admitted at S250 — /);
  assert.deepEqual([zero[0].payload.moves, zero[0].payload.stocked, zero[0].nonce], [[], 0, stockNonce("sbx-eve/her-chest")]);
  const fold = foldUnits(await units());
  assert.deepEqual(fold.anomalies, [], "a zero stock is no bad move");
  assert.deepEqual(edgesOf(fold, "sbx-eve/her-chest"), [{ label: "test-comets", count: 20 }], "no zero-count edge minted");
  // someone takes 5; later ticks add nothing — the gift is not deferred
  await asOffice((c) => c.query(`INSERT INTO acts (at, crossing, actor, action, object, class, payload, effect, household)
     VALUES (now(), 251.6, 'sbx-cy', 'units:take', 'sbx-eve/her-chest', 'holding', '{"units":true,"moves":[{"from":"sbx-eve/her-chest","to":"sbx-cy","label":"test-comets","n":5}]}', 'a take', 'hh:sbx-cy')`));
  for (const x of [251.7, 251.8]) assert.equal((await asOffice((c) => stockChests(c, { crossing: x }))).stocked.length, 0);
  assert.equal(totalOf(foldUnits(await units()), "sbx-eve/her-chest"), 15);
});

test("A LATE LABEL STOCKS AT ITS OWN SETTLEMENT: an empty chest admitted at S250 is stocked when S251 finds the label, and the receipt says both", { skip }, async () => {
  await seed();
  await asOffice((c) => stockChests(c, { crossing: 250.5 }));               // eve: unlabelled, unstocked
  await owner((c) => law(c, SHA_B, 251, LABELS_B));
  const r = await asOffice((c) => stockChests(c, { crossing: 251.5 }));
  assert.match(r.line, /sbx-eve\/her-chest \+20 test-eves at S251, admitted at S250/);
  const [act] = (await units()).filter((a) => a.object === "sbx-eve/her-chest" && a.action === UNIT_ACTION.stock);
  assert.deepEqual([act.payload.settlement, act.payload.decided_at, act.payload.stocked], [250, 251, 20]);
  const { effect } = (await owner((c) => c.query("SELECT effect FROM acts WHERE id = $1", [act.id]))).rows[0];
  assert.equal(effect, "the town stocked sbx-eve/her-chest with 20 test-eves at S251, the settlement that found its creator's candy label (the chest was admitted at S250)");
  assert.doesNotMatch(effect, /at the settlement that admitted it/, "a delayed stock does not claim it happened at admission");
});

test("A LABEL ALREADY THERE AT ADMISSION DECIDES AT ADMISSION, even when the tick first runs a settlement later — only the later label moves the date", { skip }, async () => {
  await seed();                                                            // ana's label is in S250's law
  await owner((c) => law(c, SHA_B, 251, LABELS_B));                        // eve's arrives at S251
  await asOffice((c) => stockChests(c, { crossing: 251.5 }));              // the first tick to run
  const acts = (await units()).filter((a) => a.action === UNIT_ACTION.stock);
  const bowl = acts.find((a) => a.object === "sbx-ana/the-bowl"), eve = acts.find((a) => a.object === "sbx-eve/her-chest");
  assert.deepEqual([bowl.payload.settlement, bowl.payload.decided_at], [250, 250], "ana's label was law at S250");
  assert.deepEqual([eve.payload.settlement, eve.payload.decided_at], [250, 251], "eve's was not, until S251");
  const effects = (await owner((c) => c.query("SELECT object, effect FROM acts WHERE id = ANY($1)", [[bowl.id, eve.id]]))).rows;
  assert.match(effects.find((e) => e.object === "sbx-ana/the-bowl").effect, /at the settlement that admitted it \(S250\)$/);
});

test("ZERO ROOM, RACED: two ticks finding the same full chest spend the gift once", { skip }, async () => {
  await seed();
  await asOffice((c) => c.query(`INSERT INTO acts (at, crossing, actor, action, object, class, payload, effect, household)
     VALUES (now(), 250.8, 'sbx-cy', 'units:give', 'sbx-eve/her-chest', 'holding', '{"units":true,"moves":[{"from":null,"to":"sbx-eve/her-chest","label":"test-comets","n":20}]}', 'gifts', 'hh:sbx-cy')`));
  await owner((c) => law(c, SHA_B, 251, LABELS_B));
  await Promise.all([asOffice((c) => stockChests(c, { crossing: 251.5 })), asOffice((c) => stockChests(c, { crossing: 251.5 }))]);
  assert.equal((await units()).filter((a) => a.object === "sbx-eve/her-chest" && a.action === UNIT_ACTION.stock).length, 1);
});
