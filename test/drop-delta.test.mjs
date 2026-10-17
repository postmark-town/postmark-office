// drop-delta.test.mjs — WLD-27 post-#501, C (Wright, AUTHORITY
// 2026-10-13T05:20:23Z): "F0 must compute only the delta." A RESOLVED DROP
// LEAVES THE TICK'S WORK SET, ONCE, AND STAYS OUT; a fresh one is still found;
// a drop still being written is never skipped behind the cursor.
//
//   node --test test/drop-delta.test.mjs
//
// A real Postgres (embedded-store.mjs, the whole schema) and the tick's own
// `recoverOrphanDrops` on an office_api connection. The WORK is measured, not
// only the balances: every statement the tick sends is counted through the
// connection itself, and the statements it sent are EXPLAINed against the
// store's own indexes. Synthetic handles and labels only.

import { after, test } from "node:test";
import assert from "node:assert/strict";
import { startStore } from "./helpers/embedded-store.mjs";
import { recoverOrphanDrops, dropsStillOut, dropSequenceGuard, undoNonce, resolvedNonce, dropCursor, TICK_MS } from "../src/drop-recovery.mjs";
import { foldUnits, totalOf, UNIT_ACTION } from "../src/world-stacks.mjs";

const store = await startStore({ db: "drop_delta_test" });
after(() => store.stop());
const skip = store.skip ?? false;

const LABEL = "test-comets";
const HH = "hh:sbx-cy";
async function owner(fn) { const c = await store.connect("world2_owner"); try { return await fn(c); } finally { await c.end(); } }
async function office(fn) { const c = await store.connect("office_api"); try { return await fn(c); } finally { await c.end(); } }
const q1 = (sql, p = []) => owner(async (c) => (await c.query(sql, p)).rows);

async function seed() {
  await owner(async (c) => {
    await c.query("TRUNCATE acts, claims, marks, windows, settlements, households, household_pins CASCADE");
    await c.query(`INSERT INTO windows (id, opens_at, closes_at, status) VALUES (300, now() - interval '2 days', now() + interval '2 days', 'open')`);
    await c.query(`INSERT INTO households (slug, ord, name, residents, since, declared_by) VALUES ('sbx-cy', 0, 'Cy', ARRAY['sbx-cy'], '2026-08-01', 'sbx-cy')`);
    await c.query(`INSERT INTO household_pins (handle, login, gh_id, pinned) VALUES ('sbx-cy', 'sbx-cy', 931, '2026-08-01')`);
    await c.query(`INSERT INTO acts (at, crossing, actor, action, object, class, payload, household) VALUES (now() - interval '9 days', 300.0, 'the-town', 'units:give', 'sbx-cy', 'holding', $1, 'the-town')`,
      [JSON.stringify({ units: true, moves: [{ from: null, to: "sbx-cy", label: LABEL, n: 2000 }] })]);
  });
}
const DROP_PAYLOAD = JSON.stringify({ units: true, moves: [{ from: "sbx-cy", to: null, label: LABEL, n: 1 }], label: LABEL });
/** `n` committed set-downs, `minutesAgo` old: their ids. */
const drops = (n, minutesAgo = 60) => q1(`INSERT INTO acts (at, crossing, actor, action, object, class, payload, household)
  SELECT now() - make_interval(mins => $2::int), 300.1, 'sbx-cy', 'units:drop', 'sbx-cy', 'holding', $3::jsonb, $4::text FROM generate_series(1, $1::int)
  RETURNING id::text`, [n, minutesAgo, DROP_PAYLOAD, HH]).then((r) => r.map((x) => x.id));
/** Their marks filed, as the pen writes them: a claim naming the act in `status` (and, unless a draft, its leave act). */
async function fileAll(ids, status) {
  await owner(async (c) => {
    if (status !== "draft") await c.query(`INSERT INTO acts (at, crossing, actor, action, object, class, payload, household)
      SELECT now(), 300.2, 'sbx-cy', 'leave-mark', 'sbx-cy/' || $3::text || '-' || i, 'mark', jsonb_build_object('class','candy','label',$3::text,'dropped','act:' || i,'by','sbx-cy'), $2::text FROM unnest($1::text[]) AS i`, [ids, HH, LABEL]);
    await c.query(`INSERT INTO claims (window_id, class, claimant, household, status, body, geometry, bbox, stake, data, slug)
      SELECT 300, 'sited', 'sbx-cy', $2::text, $4::text, 'One Test Comets, set down here.', jsonb_build_object('slug','sbx-cy/' || $3::text || '-' || i,'at',jsonb_build_object('x',0,'y',0),'extent',jsonb_build_object('w',1,'h',1)),
             '((0,0),(1,1))', 1, jsonb_build_object('class','candy','label',$3::text,'dropped','act:' || i), 'sbx-cy/' || $3::text || '-' || i FROM unnest($1::text[]) AS i`, [ids, HH, LABEL, status]);
  });
}
/** Already undone by the door's compensation, under its nonce. */
const undoAll = (ids) => q1(`INSERT INTO acts (at, crossing, actor, action, object, class, payload, household, nonce)
  SELECT now(), 300.3, 'sbx-cy', 'units:drop-undone', NULL, 'holding', jsonb_build_object('units',true,'moves',jsonb_build_array(jsonb_build_object('from',NULL,'to','sbx-cy','label',$2::text,'n',1)),'label',$2::text,'undoes',i,'by','door'), $3::text, $4::text || ':' || i
  FROM unnest($1::text[]) AS i`, [ids, LABEL, HH, UNIT_ACTION.dropUndone]);

const unitActs = () => q1("SELECT id::text, class, action, actor, household, nonce, payload FROM acts WHERE action LIKE 'units:%' ORDER BY acts.id");
const heldBy = async (h) => totalOf(foldUnits(await unitActs()), h);

/** The connection, counted: every statement the tick sends, with its parameters. */
function counted(c) {
  const log = [];
  const client = new Proxy(c, { get(t, k) {
    if (k === "query") return (sql, params) => { log.push({ sql: typeof sql === "string" ? sql : sql?.text, params }); return t.query(sql, params); };
    const v = t[k]; return typeof v === "function" ? v.bind(t) : v;
  } });
  return { client, log, claimReads: () => log.filter((e) => /FROM claims/.test(e.sql)).length, dropLocks: () => log.filter((e) => /pg_advisory_xact_lock\(hashtext/.test(e.sql) && /^wld27-drop:/.test(String(e.params?.[0] ?? ""))).length };
}
const tick = (later = 0) => office(async (c) => { const k = counted(c); const r = await recoverOrphanDrops(k.client, { now: Date.now() + later * TICK_MS, crossing: 300.5 }); return { ...r, sent: k.log.length, claimReads: k.claimReads(), dropLocks: k.dropLocks(), log: k.log }; });
const actCount = async () => (await q1("SELECT count(*)::int AS n FROM acts"))[0].n;

// ════════════════════════════════════════════════════════════════════════════

test("C · MANY RESOLVED, A SMALL DELTA: the first tick decides the history once; the next idle tick reads only what is above the cursor — no claim lookup, no lock, no line, no act", { skip }, async () => {
  await seed();
  const pending = await drops(150); await fileAll(pending, "pending");
  const drafts = await drops(100); await fileAll(drafts, "draft");
  const undone = await drops(150); await undoAll(undone);
  const fresh = await drops(3);                       // orphans older than one tick
  const young = await drops(1, 5);                    // younger than one tick
  const t1 = await tick();
  assert.deepEqual(t1.restored.map((r) => r.act), fresh, "the three orphans come back");
  assert.equal(t1.filed.length, 250, "every filed drop resolved, once");
  assert.equal(t1.work.read, 404, "the first tick reads the whole history once");
  assert.equal(t1.work.decided, 253, "and decides only the 253 not already undone");
  assert.equal(t1.work.cursor, String(BigInt(young[0]) - 1n), "the cursor stops just below the one drop still open");
  assert.match(t1.line, /^drops: restored 3 .* · 250 resolved as filed/);
  const resolutions = (await unitActs()).filter((a) => a.action === UNIT_ACTION.dropResolved);
  assert.equal(resolutions.length, 250);
  assert.deepEqual([...new Set(resolutions.map((r) => r.household))], [HH], "under the drop's own household");
  assert.equal(resolutions.find((r) => r.payload.resolves === pending[0]).nonce, resolvedNonce(pending[0]));
  const draftRes = resolutions.find((r) => r.payload.resolves === drafts[0]);
  assert.deepEqual(Object.keys(draftRes.payload).sort(), ["as", "moves", "resolves", "units"], "a private draft's resolution names no slug and no status: the act log leaves the box");

  const acts = await actCount();
  const t2 = await tick();
  assert.deepEqual([t2.work.read, t2.work.decided, t2.claimReads, t2.dropLocks], [1, 0, 0, 0], "the idle tick: one row read (the young drop), nothing decided, no claim lookup, no drop lock");
  assert.deepEqual([t2.restored, t2.filed, t2.skipped], [[], [], []]);
  assert.equal(t2.line, "drops: restored 0", "no resolution named a second time");
  assert.equal(await actCount(), acts, "and nothing written");

  const t3 = await tick(2);                           // two ticks later the young one is old
  assert.deepEqual(t3.restored.map((r) => r.act), young);
  assert.equal(t3.work.read, 1);
  const t4 = await tick(2);
  assert.deepEqual([t4.work.read, t4.claimReads, t4.dropLocks], [0, 0, 0], "fully idle: nothing above the cursor");
  assert.equal(t4.sent, 5, `a fixed handful of statements, whatever the history (${t4.log.map((e) => e.sql.trim().split(/\s+/).slice(0, 3).join(" ")).join(" | ")})`);
  assert.equal(await heldBy("sbx-cy"), 2000 - 254 - 150 + 150 + 4, "every unit accounted for, none twice");

  // a fresh orphan after resolved history: found, decided once, and only it
  const late = await drops(1);
  const t5 = await tick();
  assert.deepEqual([t5.restored.map((r) => r.act), t5.work.read, t5.work.decided], [late, 1, 1]);
  const t6 = await tick();
  assert.deepEqual([t6.work.read, t6.restored.length], [0, 0]);
});

test("C · A BUSY DROP IS NEVER LOST BEHIND THE CURSOR: a set-down still being written when the tick reads holds the tick until it commits, and is then decided", { skip }, async () => {
  await seed();
  const busy = await store.connect("office_api");
  try {
  await busy.query("BEGIN");
  await dropSequenceGuard(busy);                       // the drop door's own guard, shared
  const { rows: [{ id: n }] } = await busy.query(`INSERT INTO acts (at, crossing, actor, action, object, class, payload, household)
    VALUES (now() - interval '1 hour', 300.1, 'sbx-cy', 'units:drop', 'sbx-cy', 'holding', $1, $2) RETURNING id::text`, [DROP_PAYLOAD, HH]);
  // a LATER drop commits first and is resolved (undone) — the shape that would carry a high-water cursor past N
  const [later] = await office(async (c) => {
    await c.query("BEGIN"); await dropSequenceGuard(c);
    const { rows } = await c.query(`INSERT INTO acts (at, crossing, actor, action, object, class, payload, household)
      VALUES (now() - interval '1 hour', 300.1, 'sbx-cy', 'units:drop', 'sbx-cy', 'holding', $1, $2) RETURNING id::text`, [DROP_PAYLOAD, HH]);
    await c.query("COMMIT"); return rows.map((r) => r.id);
  });
  assert.ok(BigInt(later) > BigInt(n));
  await undoAll([later]);
  let ticked = false;
  const t = tick().finally(() => { ticked = true; });
  for (let i = 0; i < 300 && !ticked && (await q1("SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND NOT granted"))[0].n < 1; i++) await new Promise((r) => setTimeout(r, 20));
  await busy.query("COMMIT");
  const r = await t;
  assert.deepEqual(r.restored.map((x) => x.act), [n], "the busy drop was waited for, read, and returned");
  assert.equal(await office((c) => dropCursor(c)), later, "and the cursor stands past both");
  } finally { await busy.query("ROLLBACK").catch(() => {}); await busy.end(); }
});

test("C · CONCURRENT TICKS, THE DOOR'S COMPENSATION AND A FILING conserve one representation per drop: one undo or one resolution, never both, never two", { skip }, async () => {
  await seed();
  const orphans = await drops(20), filed = await drops(20);
  await fileAll(filed, "pending");
  const { dropUndoGuard, dropLiveGuard } = await import("../src/drop-recovery.mjs");
  const compensate = (id) => office(async (c) => {
    await c.query("BEGIN");
    try {
      await dropUndoGuard({ actId: id })(c);
      await c.query(`INSERT INTO acts (at, crossing, actor, action, object, class, payload, household, nonce) VALUES (now(), 300.4, 'sbx-cy', 'units:drop-undone', NULL, 'holding', $1, $2, $3) ON CONFLICT DO NOTHING`,
        [JSON.stringify({ units: true, moves: [{ from: null, to: "sbx-cy", label: LABEL, n: 1 }], label: LABEL, undoes: id, by: "door" }), HH, undoNonce(id)]);
      await c.query("COMMIT");
    } catch { await c.query("ROLLBACK"); }
  });
  const fileLate = (id) => office(async (c) => { await c.query("BEGIN"); try { await dropLiveGuard({ actId: id })(c); await c.query("COMMIT"); return true; } catch { await c.query("ROLLBACK"); return false; } });
  await Promise.all([tick(), tick(), tick(), ...orphans.slice(0, 10).map(compensate), ...orphans.slice(10).map(fileLate)]);
  await tick();
  const acts = await unitActs();
  for (const id of [...orphans, ...filed]) {
    const u = acts.filter((a) => a.nonce === undoNonce(id)).length, r = acts.filter((a) => a.nonce === resolvedNonce(id)).length;
    assert.equal(u + r, 1, `act ${id}: undo ${u}, resolution ${r}`);
    assert.equal(r, filed.includes(id) ? 1 : 0, `act ${id}`);
  }
  assert.equal(await heldBy("sbx-cy"), 2000 - 40 + 20);
  const sweeps = acts.filter((a) => a.action === UNIT_ACTION.dropSweep).map((a) => BigInt(a.payload.through));
  assert.ok(sweeps.length >= 1 && sweeps.every((s, i) => i === 0 || s >= sweeps[i - 1]), "the cursor only ever moves up");
});

test("C · THE CARRY COUNT reads the delta too: with history resolved, dropsStillOut sends no claim lookup and counts only the drops still out", { skip }, async () => {
  await seed();
  const old = await drops(50); await fileAll(old, "pending");
  await tick();
  const out = await office(async (c) => { const k = counted(c); await c.query("BEGIN READ ONLY"); const n = await dropsStillOut(k.client, "sbx-cy"); await c.query("COMMIT"); return { n, claimReads: k.claimReads(), sent: k.log.length }; });
  assert.deepEqual([out.n, out.claimReads], [0, 0], `nothing above the cursor, so no claim is asked (${out.sent} statements)`);
  const fresh = await drops(2);
  await fileAll([fresh[0]], "draft");
  const two = await office(async (c) => { const k = counted(c); await c.query("BEGIN READ ONLY"); const n = await dropsStillOut(k.client, "sbx-cy"); await c.query("COMMIT"); return { n, claimReads: k.claimReads() }; });
  assert.deepEqual([two.n, two.claimReads], [1, 1], "the fresh orphan is out, the fresh draft is filed; one count statement asks the claims, once");
});

test("C · THE INDEXES ANSWER: the statements the tick and the carry count actually sent are served by acts_class_idx, acts_actor_nonce_idx (027), acts_world_nonce_once (052) and acts_actor_id_idx — never a payload->>'undoes' scan", { skip }, async () => {
  await seed();
  const d = await drops(30); await fileAll(d.slice(0, 10), "pending"); await undoAll(d.slice(10, 20));
  await owner((c) => c.query("ANALYZE acts"));
  const t = await tick();
  await drops(1);                                     // one drop above the cursor, so the carry count's own statement runs
  const outLog = await office(async (c) => { const k = counted(c); await c.query("BEGIN READ ONLY"); await dropsStillOut(k.client, "sbx-cy"); await c.query("COMMIT"); return k.log; });
  const sent = [...t.log, ...outLog].filter((e) => /^\s*SELECT/.test(e.sql) && /FROM acts/.test(e.sql) && !/pg_advisory/.test(e.sql));
  assert.ok(!sent.some((e) => /payload->>'undoes'/.test(e.sql)), "no statement matches undos by payload");
  // with sequential scans priced out, the planner shows which index CAN serve each statement as sent (its own parameters)
  const plans = await office(async (c) => {
    await c.query("BEGIN"); await c.query("SET LOCAL enable_seqscan = off");
    const out = [];
    for (const e of sent) out.push({ sql: e.sql.trim().replace(/\s+/g, " "), plan: JSON.stringify((await c.query(`EXPLAIN (FORMAT JSON) ${e.sql}`, e.params)).rows[0]) });
    await c.query("ROLLBACK"); return out;
  });
  for (const p of plans) console.log("PLAN", p.sql.slice(0, 90), "::", (p.plan.match(/"(Index Name|Node Type)":"[^"]+"/g) ?? []).join(" "));
  const planOf = (re) => { const p = plans.find((x) => re.test(x.sql)); assert.ok(p, `sent: ${re}`); return p.plan; };
  assert.match(planOf(/COALESCE\(household, ''\) = \$1 AND actor = \$2 AND action = 'units:drop-sweep'/), /acts_world_nonce_once/, "the cursor: 052's leading columns, given exactly");
  assert.match(planOf(/^SELECT id::text FROM acts WHERE actor = \$1 AND nonce = \$2/), /acts_actor_nonce_idx/, "a spent nonce: (actor, nonce), 027");
  const delta = planOf(/EXISTS \(SELECT 1 FROM acts u WHERE u.actor = d.actor/);
  assert.match(delta, /acts_class_idx/, "the delta ranges acts_class_idx from the cursor");
  assert.equal((delta.match(/acts_actor_nonce_idx/g) ?? []).length, 2, "both resolutions by (actor, nonce)");
  const still = planOf(/^SELECT count\(\*\)::int AS n FROM acts d/);
  assert.match(still, /acts_actor_id_idx|acts_class_idx/, "the carry count ranges from the cursor");
  assert.match(still, /acts_actor_nonce_idx/, "and asks its undo and resolution by (actor, nonce)");
  for (const p of plans) assert.ok(!/"Node Type":"Seq Scan"[^}]*"Relation Name":"acts"/.test(p.plan), `no statement needs a sequential scan of acts: ${p.sql.slice(0, 80)}`);
});
