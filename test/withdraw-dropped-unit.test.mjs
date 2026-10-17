// withdraw-dropped-unit.test.mjs — WLD-27 post-#501, D (Wright, AUTHORITY
// 2026-10-13T05:20:23Z; the carry case ruled 06:44:41Z): A DROPPED UNIT'S MARK
// WITHDRAWN BEFORE PUBLICATION BRINGS THE UNIT BACK TO ITS DROPPER — once, as
// an add under the carry cap — and after publication it is a take-back only.
//
//   node --test test/withdraw-dropped-unit.test.mjs
//
// The public door (`withdrawMarkViaOffice`, single-log) over the real pen on a
// real Postgres (embedded-store.mjs, the office_api role), with the tick's own
// `recoverOrphanDrops` and the unit door's take-back beside it. The class law
// is handed in (the door's `units` seam), and the escrow is read from a
// throwaway town's real ledger. Draft (the claim deleted) and pending (the
// claim retracted) both. Synthetic handles, labels and stamps only.

import { after, test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { NO_TOWN, townClone } from "./fixture-paths.mjs";
import { copyTownTools } from "./helpers/town-tools.mjs";
import { startStore } from "./helpers/embedded-store.mjs";

// WLD-27's doors ship dark by default (src/chests-candy.mjs); these are their own tests, so they run with them open.
process.env.WORLD_CHESTS_CANDY = "1";

const TOWN = townClone();
const litter = [];
after(() => { for (const d of litter) { try { rmSync(d, { recursive: true, force: true }); } catch { /* litter */ } } });
const scratch = (p) => { const d = mkdtempSync(join(tmpdir(), p)); litter.push(d); return d; };
const git = (repo, ...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

const world = scratch("wld27-d-world-");
mkdirSync(join(world, "WORLD"), { recursive: true });
writeFileSync(join(world, "WORLD", "world-state.json"), JSON.stringify({ tick: 0, dials: {}, marks: [] }));
writeFileSync(join(world, "WORLD", "skeleton.json"), JSON.stringify({ features: [], physics_registry: {} }));
execFileSync("git", ["init", "-q", "-b", "main", world]);
git(world, "add", "-A"); git(world, "-c", "user.name=fixture", "-c", "user.email=fixture@test.invalid", "commit", "-q", "-m", "an empty world");

const FX = TOWN ? (() => {
  const repo = scratch("wld27-d-town-");
  mkdirSync(join(repo, "WHITE_PAGES"), { recursive: true });
  copyTownTools(TOWN, repo);
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  writeFileSync(join(repo, "tools", "stamp-pubkey.pem"), publicKey.export({ type: "spki", format: "pem" }));
  return { repo, pem: privateKey.export({ type: "pkcs8", format: "pem" }) };
})() : null;

const store = await startStore({ db: "withdraw_dropped_unit_test" });
const skip = (store.skip ?? false) || (!FX && NO_TOWN) || false;
const savedEnv = {};
const setEnv = (k, v) => { if (!(k in savedEnv)) savedEnv[k] = process.env[k]; if (v === undefined) delete process.env[k]; else process.env[k] = v; };
if (!skip) {
  setEnv("WORLD_CLONE", world); setEnv("TOWN_CLONE", FX.repo);
  setEnv("WORLD2_PG", "1"); setEnv("WORLD2_PG_URL", store.url("office_api"));
  setEnv("WORLD2_CANDLE", "1"); setEnv("WORLD_SINGLE_LOG", "1");
}
const ENGINE = FX ? await import(pathToFileURL(join(FX.repo, "tools", "world-stake.mjs"))) : null;
if (FX) {
  const MINT = await import(pathToFileURL(join(FX.repo, "tools", "stamp-mint.mjs")));
  MINT.appendSigned(FX.repo, [MINT.giftLine({ date: "2026-09-01", handle: "sbx-bo", n: 10, slug: "seed", by: "the-town" })], FX.pem);
}

const { __setPoolForTest } = await import("../src/world2-pen.mjs");
const { appendActFlipped } = await import("../src/world-journal.mjs");
const { callUnits, classViewOf, liveUnitDeps } = await import("../src/world-units.mjs");
const { withdrawMarkViaOffice } = await import("../src/world.mjs");
const { recoverOrphanDrops, dropsStillOut, undoNonce, TICK_MS } = await import("../src/drop-recovery.mjs");
const { actHouseholdFor } = await import("../src/world2-claims.mjs");
const houseOf = (actor) => as("office_api", (c) => actHouseholdFor(c, { actor }));
const { CLEARING_TAKES_THE_CANDLE } = await import("../world2/tools/candle-lock.mjs");
const { foldUnits, totalOf, UNIT_ACTION } = await import("../src/world-stacks.mjs");
const { currentCrossing } = await import("../src/crossings.mjs");

let pool = null;
after(async () => {
  __setPoolForTest(null); if (pool) await pool.end();
  for (const [k, v] of Object.entries(savedEnv)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  if (!(store.skip ?? false)) await store.stop();
});

const LABEL = "test-comets";
const WIN = 300;
const CY = "sbx-cy";
let HH = null;   // Cy's household as the pen spells it (actHouseholdFor), read once the registry is seeded
const CLASSES = new Map(Object.entries({
  mark: { extends: null, dials: {} }, thing: { extends: "mark", dials: { carry_cap: 24 } }, consumable: { extends: "thing", dials: {} },
  candy: { extends: "consumable", dials: {}, labels: [{ label: LABEL, name: "Test Comets", creator: "sbx-ana" }] },
}));
async function as(role, fn) { const c = await store.connect(role); try { return await fn(c); } finally { await c.end(); } }
const owner = (fn) => as("world2_owner", fn);
const q1 = (sql, p = []) => owner(async (c) => (await c.query(sql, p)).rows);
const at = () => currentCrossing();

async function seed({ held = 5 } = {}) {
  if (!pool) {
    const { default: pg } = await import("pg");
    pool = new pg.Pool({ connectionString: store.url("office_api") });
    __setPoolForTest(pool);
  }
  await owner(async (c) => {
    await c.query("TRUNCATE acts, claims, marks, windows, settlements, households, household_pins CASCADE");
    await c.query(`INSERT INTO windows (id, opens_at, closes_at, status) VALUES ($1, now() - interval '2 days', now() + interval '2 days', 'open')`, [WIN]);
    for (const [i, h] of ["sbx-ana", "sbx-bo", "sbx-cy"].entries()) {
      await c.query(`INSERT INTO households (slug, ord, name, residents, since, declared_by) VALUES ($1, $2, $1, ARRAY[$1], '2026-08-01', $1)`, [h, i]);
      await c.query(`INSERT INTO household_pins (handle, login, gh_id, pinned) VALUES ($1, $1, $2, '2026-08-01')`, [h, 700 + i]);
    }
  });
  HH = await houseOf(CY);
  if (held) await give(CY, held);
}
const give = (to, n) => q1(`INSERT INTO acts (at, crossing, actor, action, object, class, payload, household) VALUES (now() - interval '1 day', $1, 'the-town', 'units:give', $2, 'holding', $3, 'the-town')`,
  [at(), to, JSON.stringify({ units: true, moves: [{ from: null, to, label: LABEL, n }] })]);
const consume = (who) => q1(`INSERT INTO acts (at, crossing, actor, action, object, class, payload, household) VALUES (now(), $1, $2, 'units:consume', $2, 'holding', $3, $4)`,
  [at(), who, JSON.stringify({ units: true, moves: [{ from: who, to: null, label: LABEL, n: 1 }], label: LABEL }), HH]);

/** Cy sets one unit down, `minutesAgo`, and its mark is filed as `status` ('draft': no deed, by law; else its leave act too). */
async function dropFiled(status, { minutesAgo = 30, data: extra = {}, slugOf = null } = {}) {
  const [{ id }] = await q1(`INSERT INTO acts (at, crossing, actor, action, object, class, payload, household)
    VALUES (now() - make_interval(mins => $1), $2, $3, 'units:drop', $3, 'holding', $4, $5) RETURNING id::text`,
  [minutesAgo, at(), CY, JSON.stringify({ units: true, moves: [{ from: CY, to: null, label: LABEL, n: 1 }], label: LABEL }), HH]);
  const mark = slugOf ? slugOf(id) : `${CY}/${LABEL}-${id}`;
  const data = { class: "candy", label: LABEL, dropped: `act:${id}`, by: CY, ...extra };
  if (status !== "draft") await q1(`INSERT INTO acts (at, crossing, actor, action, object, class, payload, household) VALUES (now(), $1, $2, 'leave-mark', $3, 'mark', $4, $5)`,
    [at(), CY, mark, JSON.stringify(data), HH]);
  await q1(`INSERT INTO claims (window_id, class, claimant, household, status, body, geometry, bbox, stake, data, slug)
            VALUES ($1, 'sited', $2, $3, $4, 'One Test Comets, set down here.', $7, '((0,0),(1,1))', 1, $5, $6)`,
  [WIN, CY, HH, status, JSON.stringify(data), mark, JSON.stringify({ slug: mark, at: { x: 0, y: 0 }, extent: { w: 1, h: 1 } })]); // the pen's geometry carries the slug
  return { mark, drop: id, record: { id: mark, by: CY, class: "candy", label: LABEL, dropped: `act:${id}`, household: HH } };
}

const unitActs = () => q1("SELECT id::text, class, action, actor, object, household, nonce, payload FROM acts WHERE action LIKE 'units:%' ORDER BY acts.id");
const heldBy = async (h) => totalOf(foldUnits(await unitActs()), h);
const undos = async (drop) => (await unitActs()).filter((a) => a.action === UNIT_ACTION.dropUndone && a.nonce === undoNonce(drop));
const census = async () => ({
  acts: await q1("SELECT id::text, action, object, nonce FROM acts ORDER BY acts.id"),
  claims: await q1("SELECT slug, status FROM claims ORDER BY slug"),
  marks: await q1("SELECT slug, status FROM marks ORDER BY slug"),
});
const claimOf = async (mark) => (await q1("SELECT status FROM claims WHERE slug = $1", [mark])).map((r) => r.status);

let LIVE = null;
async function deps(over = {}) {
  LIVE ??= await liveUnitDeps();
  return {
    classes: () => classViewOf({ classes: CLASSES }),
    readRows: async () => ({ units: await unitActs(), attachments: [] }),
    markById: async () => null, reachTake: async () => ({}), reachGive: async () => ({}), standpoint: async () => ({ x: 3, y: 4 }),
    householdOf: (h) => ({ key: HH }),
    append: (entry, opts = {}) => appendActFlipped(null, { ...entry, writtenAt: new Date().toISOString() }, opts),
    stamp: async () => ({ at: null, witnesses: null }),
    crossing: () => at(), household: () => HH,
    dropsOut: LIVE.dropsOut, droppedUnit: LIVE.droppedUnit,
    holders: LIVE.holders, unstake: LIVE.unstake, withdraw: LIVE.withdraw, markTurn: LIVE.markTurn,
    ...over,
  };
}
const KEY = (household = CY) => ({ household, handles: new Set([CY]) });
const withdraw = async (mark, { key = KEY(), escrowOf = null, units = null } = {}) =>
  withdrawMarkViaOffice(world, { mark }, key, { units: units ?? await deps(), ...(escrowOf ? { escrowOf } : {}) });
const tick = (later = 2) => owner(async () => as("office_api", (c) => recoverOrphanDrops(c, { now: Date.now() + later * TICK_MS, crossing: at() })));
const gate = () => { let open; const p = new Promise((r) => { open = r; }); return { p, open }; };
async function until(fn, what) { for (let i = 0; i < 600; i++) { if (await fn()) return; await new Promise((r) => setTimeout(r, 20)); } throw new Error(`timed out: ${what}`); }
const advisoryWaiters = async () => (await q1("SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND NOT granted"))[0].n;

// ════════════════════════════════════════════════════════════════════════════

for (const status of ["draft", "pending"]) {
  const gone = status === "draft" ? [] : ["retracted"];

  test(`D · ${status} → withdraw: the unit comes back to its dropper once, in the withdrawal's own write; a retry returns 0`, { skip }, async () => {
    await seed();
    const m = await dropFiled(status);
    assert.equal(await heldBy(CY), 4);
    const r = await withdraw(m.mark);
    assert.equal(r.withdrawn, true, JSON.stringify(r));
    assert.equal(r.unit_returned, 1);
    assert.deepEqual([r.unit.label, r.unit.to], [LABEL, CY]);
    assert.deepEqual(await claimOf(m.mark), gone, status === "draft" ? "the draft is deleted" : "the pending claim is retracted");
    const [u] = await undos(m.drop);
    assert.deepEqual([u.actor, u.household, u.payload.by, u.payload.mark, u.payload.undoes, u.id], [CY, HH, "withdraw", m.mark, m.drop, r.unit.act],
      "the drop's own undo: its dropper, its ORIGINAL household, its nonce");
    assert.equal(await heldBy(CY), 5);
    const again = await withdraw(m.mark);
    assert.deepEqual([again.withdrawn, again.already, again.unit_returned, again.returned_before], [true, true, 0, u.id]);
    assert.equal((await undos(m.drop)).length, 1);
    assert.equal(await heldBy(CY), 5, "never twice");
    // the tick agrees: the drop is resolved by its undo, nothing to restore
    const t = await tick();
    assert.deepEqual(t.restored, []);
    assert.equal(await heldBy(CY), 5);
  });

  test(`D · ${status} AFTER a filed-resolution tick: the resolved drop is not stranded — the withdrawal itself restores it; no rescan of history`, { skip }, async () => {
    await seed();
    const m = await dropFiled(status);
    const t1 = await tick();
    assert.deepEqual(t1.filed.map((f) => f.act), [m.drop], "C: resolved as filed, once");
    const t2 = await tick();
    assert.deepEqual([t2.work.read, t2.filed.length], [0, 0], "and never asked again");
    const r = await withdraw(m.mark);
    assert.equal(r.unit_returned, 1);
    assert.equal(await heldBy(CY), 5);
    const t3 = await tick();
    assert.deepEqual([t3.restored.length, t3.work.read], [0, 0], "no tick work: the withdrawal was the restoration");
    assert.equal(await as("office_api", (c) => dropsStillOut(c, CY)), 0);
  });

  test(`D · CARRY RULING (${status}): Cy at 23 + 1 given back = 24 → the withdrawal is refused before anything is written; after making room it returns 1, and a retry 0`, { skip }, async () => {
    await seed({ held: 24 });
    const m = await dropFiled(status);
    assert.equal(await heldBy(CY), 23, "a unit set down");
    await give(CY, 1);                                   // "Cy gives one back to fill the slot"
    assert.equal(await heldBy(CY), 24);
    const before = { census: await census(), ledger: ENGINE.worldStakeState(FX.repo).escrow.get(m.mark) ?? 0 };
    const e = await withdraw(m.mark).then(() => null, (x) => x);
    assert.equal(e?.code, 409, String(e?.defect));
    assert.equal(e.hint, "your hands are full (24/24): drop, give or consume one, then withdraw. Nothing was withdrawn and nothing was recorded.");
    assert.deepEqual(await census(), before.census, "marks, claims and acts unchanged — no retraction, no undo, no deed");
    assert.equal(ENGINE.worldStakeState(FX.repo).escrow.get(m.mark) ?? 0, before.ledger, "ledger unchanged");
    await consume(CY);                                   // make room
    assert.equal(await heldBy(CY), 23);
    const r = await withdraw(m.mark);
    assert.equal(r.unit_returned, 1);
    assert.equal(await heldBy(CY), 24);
    const again = await withdraw(m.mark);
    assert.deepEqual([again.already, again.unit_returned], [true, 0], "a replay of the success, not a fresh add refused at 24");
    assert.equal(await heldBy(CY), 24);
  });
}

// ── R2 (Bevel's first review): a replay follows the drop's recorded withdrawal, never the mark's name ──

for (const status of ["draft", "pending"]) {
  test(`D · R2 (${status}) — credit Bevel: withdrawal replay follows the actual drop reference, not a predicted slug suffix`, { skip }, async () => {
    await seed();
    const m = await dropFiled(status, { slugOf: () => `${CY}/a-differently-named-unit` });
    const first = await withdraw(m.mark);
    assert.equal(first.unit_returned, 1);
    assert.equal(await heldBy(CY), 5);
    const [u] = await undos(m.drop);
    assert.equal(u.object, m.mark, "the withdrawal's undo names the mark it came back from");
    const before = await census();
    let again, error;
    try { again = await withdraw(m.mark); } catch (e) { error = e; }
    assert.equal(error, undefined, `exact-reference replay must answer already returned, not ${error?.code}: ${error?.message}`);
    assert.deepEqual([again.unit_returned, again.already, again.returned_before], [0, true, u.id]);
    assert.deepEqual(await census(), before, "a replay writes nothing");
    assert.equal((await undos(m.drop)).length, 1);
  });
}

test("D · R2 — a replay is not borrowed: a mark with a drop-shaped name that never came back gets the ordinary 404, and a later GENERATION at the same id withdraws as itself", { skip }, async () => {
  await seed();
  // a name that looks like a drop's and a real drop act behind the number, but no withdrawal ever returned it
  const [{ id: n }] = await q1(`INSERT INTO acts (at, crossing, actor, action, object, class, payload, household) VALUES (now() - interval '1 hour', $1, $2, 'units:drop', $2, 'holding', $3, $4) RETURNING id::text`,
    [at(), CY, JSON.stringify({ units: true, moves: [{ from: CY, to: null, label: LABEL, n: 1 }], label: LABEL }), HH]);
  const e = await withdraw(`${CY}/${LABEL}-${n}`).then(() => null, (x) => x);
  assert.equal(e?.code, 404, "nothing recorded a withdrawal of this mark, so there is nothing to replay");
  // the first generation is withdrawn and returned; the id is then left again as an ordinary pending mark
  const m = await dropFiled("pending", { slugOf: () => `${CY}/reused-name` });
  assert.equal((await withdraw(m.mark)).unit_returned, 1);
  await q1(`INSERT INTO acts (at, crossing, actor, action, object, class, payload, household) VALUES (now(), $1, $2, 'leave-mark', $3, 'mark', '{}', $4)`, [at(), CY, m.mark, HH]);
  await q1(`INSERT INTO claims (window_id, class, claimant, household, status, body, geometry, bbox, stake, data, slug)
            VALUES ($1, 'sited', $2, $3, 'pending', 'Something else now.', $4, '((0,0),(1,1))', 0, '{}', $5)`,
  [WIN, CY, HH, JSON.stringify({ slug: m.mark, at: { x: 0, y: 0 }, extent: { w: 1, h: 1 } }), m.mark]);
  const held = await heldBy(CY);
  const r = await withdraw(m.mark);
  assert.equal(r.already, undefined, "the new generation is withdrawn, not answered with the old one's return");
  assert.equal(r.withdrawn, true);
  assert.equal(r.unit_returned, undefined);
  assert.equal(await heldBy(CY), held, "and no unit moves for it");
  assert.deepEqual((await q1("SELECT status FROM claims WHERE slug = $1 ORDER BY submitted_at", [m.mark])).map((x) => x.status), ["retracted", "retracted"]);
});

// ── R3 (Wright, AUTHORITY 2026-10-13T07:52:24.868Z): the git lane refuses a set-down unit's mark by name ──

test("D · R3 — on the GIT (non-single-log) lane a set-down unit's draft or pending mark is refused `dropped-unit-withdraw-store-only` before anything is written; another mark is not", { skip }, async () => {
  await seed();
  const d = await dropFiled("draft"), p = await dropFiled("pending");
  const other = `${CY}/an-ordinary-mark`;
  await q1(`INSERT INTO claims (window_id, class, claimant, household, status, body, geometry, bbox, stake, data, slug)
            VALUES ($1, 'sited', $2, $3, 'pending', 'Ordinary.', $4, '((0,0),(1,1))', 0, '{}', $5)`, [WIN, CY, HH, JSON.stringify({ slug: other, at: { x: 0, y: 0 }, extent: { w: 1, h: 1 } }), other]);
  const worldBefore = [git(world, "rev-parse", "HEAD"), git(world, "for-each-ref", "--format=%(refname) %(objectname)"), git(world, "status", "--porcelain")];
  const before = await census(), held = await heldBy(CY), ledger = ENGINE.worldStakeState(FX.repo).escrow;
  setEnv("WORLD_SINGLE_LOG", undefined);
  try {
    for (const m of [d, p]) {
      const e = await withdraw(m.mark).then(() => null, (x) => x);
      assert.equal(e?.code, 409, `${m.mark}: ${e?.defect}`);
      assert.equal(e.reason, "dropped-unit-withdraw-store-only");
      assert.match(e.defect, /withdrawn only on the store's path \(dropped-unit-withdraw-store-only\)/);
      assert.match(e.hint, /WORLD_SINGLE_LOG=1/);
      assert.match(e.hint, /nothing was written/);
    }
    // the store unreachable: it cannot be told, so it is refused too, by the same name
    const blind = await deps({ droppedUnit: async () => { throw new Error("synthetic: the store did not answer"); } });
    const e = await withdraw(d.mark, { units: blind }).then(() => null, (x) => x);
    assert.deepEqual([e?.code, e?.reason], [503, "dropped-unit-withdraw-store-only"]);
    // any other mark is not this refusal's: the lane's check answers null and the git lane goes on as before
    const { droppedUnitOnGitLane } = await import("../src/world-units.mjs");
    assert.equal(await droppedUnitOnGitLane({ mark: other, by: CY, household: CY }, await deps()), null);
  } finally { setEnv("WORLD_SINGLE_LOG", "1"); }
  assert.deepEqual(await census(), before, "no mark, claim or act written");
  assert.equal(await heldBy(CY), held, "no holding moved");
  assert.deepEqual(ENGINE.worldStakeState(FX.repo).escrow, ledger, "no ledger change");
  assert.deepEqual([git(world, "rev-parse", "HEAD"), git(world, "for-each-ref", "--format=%(refname) %(objectname)"), git(world, "status", "--porcelain")], worldBefore, "no file or branch written in the world");
});

test("D · CAP COORDINATED WITH OTHER ADDS: a give to Cy at 23 and Cy's prepublication withdrawal race in the hold queue — exactly one is admitted, the record never shows 25", { skip }, async () => {
  for (const first of ["give", "withdraw"]) {
    await seed({ held: 24 });
    await give("sbx-ana", 3);
    const m = await dropFiled("pending");
    assert.equal(await heldBy(CY), 23);
    const d = await deps();
    const runs = { give: () => callUnits("give", { to: CY, label: LABEL, count: 1 }, { handles: new Set(["sbx-ana"]) }, "sbx-ana", d), withdraw: () => withdraw(m.mark, { units: d }) };
    const order = first === "give" ? ["give", "withdraw"] : ["withdraw", "give"];
    const settled = await Promise.allSettled(order.map((k) => runs[k]()));
    const ok = settled.filter((s) => s.status === "fulfilled").length;
    assert.equal(ok, 1, `${first} first: ${JSON.stringify(settled.map((s) => s.reason?.defect ?? s.value?.did ?? s.value?.withdrawn))}`);
    assert.match(String(settled.find((s) => s.status === "rejected").reason.defect), /full \(24\/24\)|24 of 24 carried/);
    assert.equal(await heldBy(CY), 24, `${first} first: never 25`);
  }
});

test("D · FAILURE BETWEEN RETRACTION AND RECOVERY cannot happen apart: a write that fails after the unit's return rolls the retraction back with it; the retry restores once", { skip }, async () => {
  for (const status of ["draft", "pending"]) {
    await seed();
    const m = await dropFiled(status);
    const before = await census();
    // the escrow read runs AFTER the return is written in the same transaction (lock order), so failing it fails the whole write
    const e = await withdraw(m.mark, { escrowOf: async () => { throw new Error("synthetic: the ledger did not answer"); } }).then(() => null, (x) => x);
    assert.equal(e?.code, 503, String(e?.defect));
    assert.deepEqual(await census(), before, `${status}: no undo without its retraction, no retraction without its undo`);
    const r = await withdraw(m.mark);
    assert.equal(r.unit_returned, 1);
    assert.equal((await undos(m.drop)).length, 1);
  }
});

test("D · ORIGINAL HOUSEHOLD: after Cy moves house, neither old-house mark is reachable through the withdraw door under either house's key — so no refund lands through a house that cannot see the claim, and nothing is touched", { skip }, async () => {
  await seed({ held: 0 });
  // Cy's house is renamed old and shared, as drop-recovery.test.mjs § C moves a resident
  await owner((c) => c.query("UPDATE households SET slug = 'sbx-old-house', residents = ARRAY['sbx-cy','sbx-zed'], declared_by = 'sbx-zed' WHERE slug = 'sbx-cy'"));
  HH = await houseOf(CY);
  const OLD = HH;
  await give(CY, 5);
  const p = await dropFiled("pending"), d = await dropFiled("draft");
  await owner(async (c) => {
    await c.query("UPDATE households SET residents = ARRAY['sbx-zed'] WHERE slug = 'sbx-old-house'");
    await c.query("INSERT INTO households (slug, ord, name, residents, since, declared_by) VALUES ('sbx-new-house', 9, 'New', ARRAY['sbx-cy'], '2026-08-02', 'sbx-cy')");
  });
  assert.notEqual(await houseOf(CY), OLD, "Cy now resolves to the new house");
  const before = await census();
  for (const house of ["sbx-new-house", "sbx-old-house"])
    for (const m of [p, d]) {
      const e = await withdraw(m.mark, { key: KEY(house) }).then(() => null, (x) => x);
      assert.equal(e?.code, 404, `${house} key, ${m.mark}: the live layer is the actor's present house (unchanged here)`);
    }
  assert.deepEqual(await census(), before, "no undo, no retraction, no deletion");
  assert.deepEqual([await claimOf(p.mark), await claimOf(d.mark)], [["pending"], ["draft"]]);
  assert.equal(await heldBy(CY), 3, "the two units stay on the ground as the old house's marks");
  // the tick, too, keeps both as filed under the drop's own house, never refunds them
  const t = await tick();
  assert.deepEqual([t.restored.length, t.filed.map((f) => f.act).sort()], [0, [p.drop, d.drop].sort()]);
  // AFTER PUBLICATION the old house's pending mark is an ordinary take-back for Cy — no visibility widened, no refund undo
  await as("clearing_job", async (c) => {
    await c.query("UPDATE claims SET status = 'locked', decided_at = now() WHERE slug = $1", [p.mark]);
    await c.query(`INSERT INTO marks (id, slug, kind, owner, household, body, geometry, bbox, status, locked_window)
                   SELECT id, slug, 'sited', claimant, household, body, geometry, bbox, 'standing', window_id FROM claims WHERE slug = $1`, [p.mark]);
  });
  const tb = await callUnits("take-back", { thing: p.mark }, KEY("sbx-new-house"), CY, await deps({ markById: async (id) => (id === p.mark ? p.record : null) }));
  assert.equal(tb.did, "take-back", JSON.stringify(tb));
  assert.equal(await heldBy(CY), 4, "the published unit came home by take-back");
  assert.deepEqual(await undos(p.drop), [], "a take-back, never the prepublication refund");
  // ⚑ The MARK'S withdrawal stays pending here, by the fixture, not the move: this
  // "publication" is the store's alone (no settlement wrote the world clone's
  // canon), so journalWithdraw finds the mark neither live nor in canon. The exit
  // says so (withdrawn: false, retry) and the unit — the thing this control is
  // about — is home. Printed, not asserted either way.
  console.log(`# ORIGINAL HOUSEHOLD take-back: exit act ${tb.seq}; the mark's withdrawal: ${JSON.stringify(tb.withdrawn)}`);
});

test("D · BOGUS REFERENCES are ordinary withdrawals: a claim naming a non-drop act, another resident's drop, or the wrong label returns nothing", { skip }, async () => {
  await seed();
  await give("sbx-ana", 2);
  // another resident's drop, named by Cy's claim
  const [{ id: anaDrop }] = await q1(`INSERT INTO acts (at, crossing, actor, action, object, class, payload, household) VALUES (now() - interval '1 hour', $1, 'sbx-ana', 'units:drop', 'sbx-ana', 'holding', $2, 'hh:sbx-ana') RETURNING id::text`,
    [at(), JSON.stringify({ units: true, moves: [{ from: "sbx-ana", to: null, label: LABEL, n: 1 }], label: LABEL })]);
  const [{ id: notDrop }] = await q1(`INSERT INTO acts (at, crossing, actor, action, object, class, payload, household) VALUES (now(), $1, $2, 'units:consume', $2, 'holding', '{"units":true,"moves":[]}', $3) RETURNING id::text`, [at(), CY, HH]);
  const cases = [
    await dropFiled("pending", { slugOf: () => `${CY}/borrowed`, data: { dropped: `act:${anaDrop}` } }),
    await dropFiled("pending", { slugOf: () => `${CY}/not-a-drop`, data: { dropped: `act:${notDrop}` } }),
    await dropFiled("pending", { slugOf: (id) => `${CY}/wrong-label-${id}`, data: { label: "test-drops" } }),
  ];
  const held = await heldBy(CY);
  for (const c of cases) {
    const r = await withdraw(c.mark);
    assert.equal(r.withdrawn, true, c.mark);
    assert.equal(r.unit_returned, undefined, `${c.mark}: an ordinary withdrawal, no unit named`);
  }
  assert.equal(await heldBy(CY), held, "nothing returned to anyone");
  assert.equal(await heldBy("sbx-ana"), 1, "Ana's unit is not refunded through Cy's claim");
});

test("D · PUBLISHED (and published-then-retired) refuses the withdrawal and names take-back; take-back brings the unit home without any refund", { skip }, async () => {
  for (const marked of ["standing", "retired"]) {
    await seed();
    const m = await dropFiled("pending");
    await as("clearing_job", async (c) => {
      await c.query("UPDATE claims SET status = 'locked', decided_at = now() WHERE slug = $1", [m.mark]);
      await c.query(`INSERT INTO marks (id, slug, kind, owner, household, body, geometry, bbox, status, locked_window, retired_window)
                     SELECT id, slug, 'sited', claimant, household, body, geometry, bbox, $2, window_id, CASE WHEN $2 = 'retired' THEN window_id END FROM claims WHERE slug = $1`, [m.mark, marked]);
    });
    const before = await census();
    const e = await withdraw(m.mark).then(() => null, (x) => x);
    assert.equal(e?.code, 409, `${marked}: ${e?.defect}`);
    assert.match(e.defect, /has been published — it is taken back, not withdrawn/);
    assert.match(e.hint, new RegExp(`world_hold \\{ thing: "${m.mark}" \\}`));
    assert.deepEqual(await census(), before, `${marked}: nothing written`);
    const tb = await callUnits("take-back", { thing: m.mark }, KEY(), CY, await deps({ markById: async () => m.record }));
    assert.equal(tb.did, "take-back", JSON.stringify(tb));
    assert.deepEqual(await undos(m.drop), [], `${marked}: a take-back, never the prepublication refund`);
    assert.equal(await heldBy(CY), 5);
  }
});

test("D · RACE WITH PUBLICATION — the candle decides: a clearing that holds it first publishes and the withdrawal is refused as a take-back; a withdrawal that holds it first retracts, and the clearing finds nothing to publish", { skip }, async () => {
  // (1) the clearing first
  await seed();
  const a = await dropFiled("pending");
  const clearing = await store.connect("clearing_job");
  await clearing.query("BEGIN"); await clearing.query(CLEARING_TAKES_THE_CANDLE);
  await clearing.query("UPDATE claims SET status = 'locked', decided_at = now() WHERE slug = $1 AND status = 'pending'", [a.mark]);
  await clearing.query(`INSERT INTO marks (id, slug, kind, owner, household, body, geometry, bbox, status, locked_window) SELECT id, slug, 'sited', claimant, household, body, geometry, bbox, 'standing', window_id FROM claims WHERE slug = $1`, [a.mark]);
  let done1 = false;
  const w1 = withdraw(a.mark).then((x) => ({ x }), (e) => ({ e })).finally(() => { done1 = true; });
  await until(async () => done1 || (await advisoryWaiters()) >= 1, "the withdrawal to wait on the candle");
  await clearing.query("COMMIT"); await clearing.end();
  const one = await w1;
  assert.equal(one.e?.code, 409, JSON.stringify(one.x ?? one.e?.defect));
  assert.match(one.e.defect, /published — it is taken back/);
  assert.deepEqual([await claimOf(a.mark), (await q1("SELECT status FROM marks WHERE slug = $1", [a.mark])).map((r) => r.status), await undos(a.drop)],
    [["locked"], ["standing"], []], "winner: the clearing — published, no undo");

  // (2) the withdrawal first
  await seed();
  const b = await dropFiled("pending");
  const read = gate(), go = gate();
  const { ledgerEscrowOf } = await import("../src/world-stake.mjs");
  const w2 = withdraw(b.mark, { escrowOf: async (id) => { read.open(); await go.p; return ledgerEscrowOf(id); } });
  await read.p;                                                   // inside the withdrawal: the candle (shared), the drop's lock, the unit's return written
  const later = await store.connect("clearing_job");
  const clear = (async () => {
    await later.query("BEGIN"); await later.query(CLEARING_TAKES_THE_CANDLE);
    const { rowCount } = await later.query("UPDATE claims SET status = 'locked', decided_at = now() WHERE slug = $1 AND status = 'pending'", [b.mark]);
    await later.query("COMMIT"); await later.end();
    return rowCount;
  })();
  let cleared = false; clear.finally(() => { cleared = true; });
  await until(async () => cleared || (await advisoryWaiters()) >= 1, "the clearing to wait on the candle");
  go.open();
  const two = await w2;
  assert.equal(two.unit_returned, 1);
  assert.equal(await clear, 0, "the clearing found no pending claim to publish");
  assert.deepEqual([await claimOf(b.mark), (await undos(b.drop)).length, await heldBy(CY)], [["retracted"], 1, 5], "winner: the withdrawal — retracted, returned once");
});

test("D · RESTART AND REPEAT: withdraw, tick, withdraw again, tick again — one undo, one unit, and the cursor never brings it back", { skip }, async () => {
  await seed();
  const m = await dropFiled("draft");
  await withdraw(m.mark);
  for (let i = 0; i < 2; i++) { await tick(2 + i); await withdraw(m.mark); }
  assert.equal((await undos(m.drop)).length, 1);
  assert.equal(await heldBy(CY), 5);
});
