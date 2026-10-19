// drop-recovery.test.mjs — WLD-27, Wright's independent review F0: AN ORPHANED
// SET-DOWN COMES BACK, ONCE, AND A FILED ONE NEVER DOES.
//
//   node --test test/drop-recovery.test.mjs
//
// A real Postgres (embedded-store.mjs, the whole schema). The recovery is run
// three ways, and each is named: the function on an office_api connection; the
// guards inside real transactions racing each other; and THE REAL TICK — the
// office tick's own step, `world2/tools/settlements-backfill.mjs --apply --prod
// --quiet` (office-keep.sh's own flags), spawned as a child against a fixture
// world repo, on a tick with a new settlement and on one with none. The cadence
// is pinned to the timer unit that runs the tick. Synthetic handles and labels;
// no real stamps, store or box.

import { after, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { startStore } from "./helpers/embedded-store.mjs";
import { TICK_MS, recoverOrphanDrops, dropLiveGuard, dropUndoGuard, dropsStillOut, undoNonce, dropMarkId } from "../src/drop-recovery.mjs";
import { foldUnits, totalOf, refuseOverCarry, UNIT_ACTION } from "../src/world-stacks.mjs";
import { inFlightFor } from "../src/world-units.mjs";

// WLD-27's doors ship dark by default (src/chests-candy.mjs); these are their own tests, so they run with them open.
process.env.WORLD_CHESTS_CANDY = "1";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const store = await startStore({ db: "drop_recovery_test" });
// The door's office_api pool (below) ends BEFORE the store goes. On a pool tree's
// shared server, stop() drops this file's database, which terminates every
// connection still open; an idle pooled one has no error listener, so it threw
// after the last test had passed (the file red on 10-18, never on CI's
// server-per-file path). One hook, in that order.
let pool = null;
after(async () => { if (pool) await pool.end(); await store.stop(); });
const skip = store.skip ?? false;

const LABEL = "test-comets";
const HH = "hh:sbx-cy";
async function owner(fn) { const c = await store.connect("world2_owner"); try { return await fn(c); } finally { await c.end(); } }
async function office(fn) { const c = await store.connect("office_api"); try { return await fn(c); } finally { await c.end(); } }

async function seed() {
  await owner(async (c) => {
    await c.query("TRUNCATE acts, claims, marks, windows, settlements, households, household_pins CASCADE");
    await c.query(`INSERT INTO windows (id, opens_at, closes_at, status) VALUES (300, now() - interval '2 days', now() + interval '2 days', 'open')`);
    await c.query(`INSERT INTO households (slug, ord, name, residents, since, declared_by) VALUES ('sbx-cy', 0, 'Cy', ARRAY['sbx-cy'], '2026-08-01', 'sbx-cy')`);
    await c.query(`INSERT INTO household_pins (handle, login, gh_id, pinned) VALUES ('sbx-cy', 'sbx-cy', 931, '2026-08-01')`);
  });
}
/** A committed set-down, `minutesAgo` old. */
const drop = (minutesAgo, actor = "sbx-cy") => owner(async (c) => (await c.query(
  `INSERT INTO acts (at, crossing, actor, action, object, class, payload, household)
   VALUES (now() - make_interval(mins => $1), 300.1, $2, 'units:drop', $2, 'holding', $3, $4) RETURNING id::text`,
  [minutesAgo, actor, JSON.stringify({ units: true, moves: [{ from: actor, to: null, label: LABEL, n: 1 }], label: LABEL }), HH])).rows[0].id);
const give = (to, n) => owner((c) => c.query(
  `INSERT INTO acts (at, crossing, actor, action, object, class, payload, household) VALUES (now() - interval '1 day', 300.0, 'the-town', 'units:give', $1, 'holding', $2, 'the-town')`,
  [to, JSON.stringify({ units: true, moves: [{ from: null, to, label: LABEL, n }] })]));
/** The leave's declaration for a dropped unit: it names the act it is (world-stacks.mjs § droppedUnitMark). */
const leavePayload = (actId) => ({ class: "candy", kind: "sited", label: LABEL, dropped: `act:${actId}`, by: "sbx-cy" });
/** The dropped unit's mark, filed: its claim in `status`, and (unless a draft) its leave act — as the pen writes them, together. */
const file = (actId, status = "pending") => owner(async (c) => {
  const slug = dropMarkId({ actor: "sbx-cy", label: LABEL, actId });
  if (status !== "draft") await c.query(`INSERT INTO acts (at, crossing, actor, action, object, class, payload, household) VALUES (now(), 300.2, 'sbx-cy', 'leave-mark', $1, 'mark', $3, $2)`,
    [slug, HH, JSON.stringify(leavePayload(actId))]);
  await c.query(`INSERT INTO claims (window_id, class, claimant, household, status, body, geometry, bbox, stake, data, slug)
                 VALUES (300, 'sited', 'sbx-cy', $1, $2, 'One Test Comets, set down here.', '{"at":{"x":0,"y":0},"extent":{"w":1,"h":1}}', '((0,0),(1,1))', 1, $3, $4)`,
    [HH, status, JSON.stringify({ class: "candy", label: LABEL, dropped: `act:${actId}` }), slug]);
});
const unitActs = () => owner(async (c) => (await c.query("SELECT id::text, class, action, actor, household, nonce, payload FROM acts WHERE action LIKE 'units:%' ORDER BY acts.id")).rows);
const undos = async (actId) => (await unitActs()).filter((a) => a.action === UNIT_ACTION.dropUndone && a.payload.undoes === String(actId));
const heldBy = async (h) => totalOf(foldUnits(await unitActs()), h);

// ── the cadence ──────────────────────────────────────────────────────────────

test("THE CADENCE IS THE TICK'S: TICK_MS is the spacing of postmark-office-keep.timer, and that timer runs the step that recovers", () => {
  const timer = readFileSync(join(ROOT, "deploy", "postmark-office-keep.timer"), "utf8");
  const mins = /^OnCalendar=\*:([\d,]+)\s*$/m.exec(timer)[1].split(",").map(Number);
  const gaps = mins.map((m, i) => ((mins[(i + 1) % mins.length] - m + 60) % 60));
  assert.deepEqual([...new Set(gaps)], [TICK_MS / 60000], `the timer fires every ${gaps[0]} minutes`);
  assert.match(readFileSync(join(ROOT, "deploy", "postmark-office-keep.service"), "utf8"), /ExecStart=.*office-keep\.sh/);
  assert.match(readFileSync(join(ROOT, "deploy", "office-keep.sh"), "utf8"), /settlements-backfill\.mjs --apply --prod/);
  const src = readFileSync(join(ROOT, "world2", "tools", "settlements-backfill.mjs"), "utf8");
  assert.match(src, /if \(apply\) \{\n\s+drops = await dropsRecoveredOnTick\(client\);/, "every --apply tick runs the recovery");
});

// ── the recovery, on a real store ───────────────────────────────────────────

test("RESTART BETWEEN THE DROP AND ITS CLAIM: an orphan older than one tick comes back to its dropper, once, by the nonce, with a line; a younger one is left alone", { skip }, async () => {
  await seed();
  await give("sbx-cy", 5);
  const old = await drop(20), young = await drop(5);
  assert.equal(await heldBy("sbx-cy"), 3, "two set down, neither filed");
  const r = await office((c) => recoverOrphanDrops(c, { crossing: 300.5 }));
  assert.deepEqual(r.restored.map((x) => x.act), [old]);
  assert.match(r.line, new RegExp(`drops: restored 1 \\(act ${old} → 1 ${LABEL} back to sbx-cy\\)`));
  const [u] = await undos(old);
  assert.deepEqual([u.actor, u.household, u.nonce, u.payload.by], ["sbx-cy", HH, undoNonce(old), "tick"], "the dropper's own actor and household, the drop's nonce");
  assert.deepEqual(await undos(young), [], "younger than one tick: untouched");
  assert.equal(await heldBy("sbx-cy"), 4);
  // the injectable clock: one tick later the young one is old
  const later = await office((c) => recoverOrphanDrops(c, { now: Date.now() + TICK_MS, crossing: 300.6 }));
  assert.deepEqual(later.restored.map((x) => x.act), [young]);
  // replay: nothing more
  assert.deepEqual((await office((c) => recoverOrphanDrops(c, { now: Date.now() + TICK_MS }))).restored, []);
  assert.equal(await heldBy("sbx-cy"), 5, "every unit accounted for, none twice");
});

test("A FILED DROP IS NEVER REFUNDED — pending, locked, refused, retracted, held for review, a PRIVATE DRAFT, or only a leave act that names it", { skip }, async () => {
  await seed();
  const states = ["pending", "locked", "refused", "retracted", "held_review", "draft"];
  const ids = {};
  for (const s of states) { ids[s] = await drop(30); await file(ids[s], s); }
  ids.actOnly = await drop(30);                                // a leave act whose own payload names the drop, its claim since gone
  await owner((c) => c.query(`INSERT INTO acts (at, crossing, actor, action, object, class, payload, household) VALUES (now(), 300.2, 'sbx-cy', 'leave-mark', $1, 'mark', $3, $2)`,
    [`sbx-cy/renamed-${ids.actOnly}`, HH, JSON.stringify(leavePayload(ids.actOnly))]));
  const r = await office((c) => recoverOrphanDrops(c, {}));
  assert.deepEqual(r.restored, [], JSON.stringify(r));
  assert.deepEqual(r.filed.map((f) => f.act).sort(), Object.values(ids).sort());
  for (const id of Object.values(ids)) assert.deepEqual(await undos(id), [], `act ${id}`);
});

test("IDENTITY IS THE ACT REFERENCE, NOT A NAME: an unrelated mark act at the predicted slug, another resident's claim naming the act, and a claim with the wrong label do not stand in for the unit", { skip }, async () => {
  await seed();
  const a = await drop(30), b = await drop(30), d = await drop(30);
  await owner(async (c) => {
    // a: a mark act at exactly the predicted slug, naming no act
    await c.query(`INSERT INTO acts (at, crossing, actor, action, object, class, payload, household) VALUES (now(), 300.2, 'sbx-cy', 'leave-mark', $1, 'mark', '{"class":"thing"}', $2)`, [dropMarkId({ actor: "sbx-cy", label: LABEL, actId: a }), HH]);
    // b: someone else's claim that names Cy's act
    await c.query(`INSERT INTO claims (window_id, class, claimant, household, status, body, geometry, bbox, stake, data, slug)
                   VALUES (300, 'sited', 'sbx-bo', 'hh:sbx-bo', 'pending', 'Not mine to file.', '{"at":{"x":0,"y":0},"extent":{"w":1,"h":1}}', '((0,0),(1,1))', 1, $1, 'sbx-bo/borrowed')`,
      [JSON.stringify({ class: "candy", label: LABEL, dropped: `act:${b}` })]);
    // d: Cy's own claim naming the act, under another label
    await c.query(`INSERT INTO claims (window_id, class, claimant, household, status, body, geometry, bbox, stake, data, slug)
                   VALUES (300, 'sited', 'sbx-cy', $1, 'pending', 'Another label.', '{"at":{"x":0,"y":0},"extent":{"w":1,"h":1}}', '((0,0),(1,1))', 1, $2, 'sbx-cy/other-label')`,
      [HH, JSON.stringify({ class: "candy", label: "test-drops", dropped: `act:${d}` })]);
  });
  const r = await office((c) => recoverOrphanDrops(c, {}));
  assert.deepEqual(r.restored.map((x) => x.act).sort(), [a, b, d].sort(), "none of the three proves this unit was filed");
});

test("ONCE ACROSS REPLAY AND CONCURRENT TICKS: two recoveries racing write one undo", { skip }, async () => {
  await seed();
  const id = await drop(30);
  await Promise.all([office((c) => recoverOrphanDrops(c, {})), office((c) => recoverOrphanDrops(c, {})), office((c) => recoverOrphanDrops(c, {}))]);
  assert.equal((await undos(id)).length, 1);
});

test("ONCE ACROSS THE DOOR'S COMPENSATION AND THE TICK: whichever comes second finds the first", { skip }, async () => {
  await seed();
  const id = await drop(30);
  // the door's undo (same nonce, same guard), committed
  await office(async (c) => {
    await c.query("BEGIN");
    await dropUndoGuard({ actId: id, actor: "sbx-cy", label: LABEL })(c);
    await c.query(`INSERT INTO acts (at, crossing, actor, action, class, payload, household, nonce) VALUES (now(), 300.3, 'sbx-cy', $1, 'holding', $2, $3, $4)`,
      [UNIT_ACTION.dropUndone, JSON.stringify({ units: true, moves: [{ from: null, to: "sbx-cy", label: LABEL, n: 1 }], label: LABEL, undoes: id, by: "door" }), HH, undoNonce(id)]);
    await c.query("COMMIT");
  });
  const r = await office((c) => recoverOrphanDrops(c, {}));
  assert.deepEqual(r.restored, []);
  assert.equal((await undos(id)).length, 1);
  // and past the lock, the nonce alone refuses a second
  await assert.rejects(owner((c) => c.query(`INSERT INTO acts (at, crossing, actor, action, class, payload, household, nonce) VALUES (now(), 300.4, 'sbx-cy', $1, 'holding', '{}', $2, $3)`,
    [UNIT_ACTION.dropUndone, HH, undoNonce(id)])), (e) => e.code === "23505");
});

test("THE CLAIM RACES THE RECOVERY: a filing holding the drop's lock commits first and the recovery finds it; after an undo, the filing is refused", { skip }, async () => {
  await seed();
  const id = await drop(30);
  const filer = await store.connect("office_api");
  await filer.query("BEGIN");
  await dropLiveGuard({ actId: id })(filer);                  // the leave's own guard, inside its transaction
  await filer.query(`INSERT INTO acts (at, crossing, actor, action, object, class, payload, household) VALUES (now(), 300.2, 'sbx-cy', 'leave-mark', $1, 'mark', $3, $2)`,
    [dropMarkId({ actor: "sbx-cy", label: LABEL, actId: id }), HH, JSON.stringify(leavePayload(id))]);
  const rec = office((c) => recoverOrphanDrops(c, {}));
  await new Promise((r) => setTimeout(r, 300));
  const waiting = await owner(async (c) => (await c.query("SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND NOT granted")).rows[0].n);
  assert.equal(waiting, 1, "the recovery waits on the drop's lock");
  await filer.query("COMMIT"); await filer.end();
  const r = await rec;
  assert.deepEqual([r.restored.length, r.filed.map((f) => f.act)], [0, [id]], "filed first: not refunded");
  assert.deepEqual(await undos(id), []);

  const other = await drop(30);
  await office((c) => recoverOrphanDrops(c, {}));
  assert.equal((await undos(other)).length, 1);
  const late = await store.connect("office_api");
  try {
    await late.query("BEGIN");
    await assert.rejects(dropLiveGuard({ actId: other })(late), (e) => e.code === 409 && /already undone/.test(e.defect), "undone first: the late filing refuses");
    await late.query("ROLLBACK");
  } finally { await late.end(); }
});

test("CONSERVATION AFTER RESTART: at 23 held with one set-down still out, a take that would make the 25th is refused; the recovery brings it to 24", { skip }, async () => {
  await seed();
  await give("sbx-cy", 24);
  const id = await drop(30);                                   // 23 in hand, 1 out — and no process remembers it
  assert.equal(await heldBy("sbx-cy"), 23);
  const dropsOut = (h) => office(async (c) => { await c.query("BEGIN READ ONLY"); try { return await dropsStillOut(c, h); } finally { await c.query("COMMIT"); } });
  assert.equal(await dropsOut("sbx-cy"), 1);
  const inFlight = await inFlightFor("sbx-cy", { dropsOut });  // the in-memory reservation is 0 here, as after a restart
  assert.equal(inFlight, 1);
  assert.throws(() => refuseOverCarry({ who: "sbx-cy", units: 23 + inFlight, things: 0, adding: 1, cap: 24 }), (e) => e.code === 409);
  await office((c) => recoverOrphanDrops(c, {}));
  assert.equal(await heldBy("sbx-cy"), 24, "the unit came back to a slot that was kept for it");
  assert.equal(await dropsOut("sbx-cy"), 0);
  // a FILED drop is not counted as out
  const filed = await drop(1); await file(filed, "draft");
  assert.equal(await dropsOut("sbx-cy"), 0, "a private draft is a filed mark: the unit is on the ground");
});

// ── the real tick ────────────────────────────────────────────────────────────

function worldRepo() {
  const repo = mkdtempSync(join(tmpdir(), "wld27-f0-world-"));
  const git = (...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  writeFileSync(join(repo, "README"), "a fixture world\n");
  git("init", "-q", "-b", "main"); git("add", "-A");
  git("-c", "user.name=fixture", "-c", "user.email=fixture@test.invalid", "commit", "-q", "-m", "S1");
  git("-c", "user.name=fixture", "-c", "user.email=fixture@test.invalid", "tag", "-a", "settlement/S1", "-m", "S1");
  return repo;
}
const tick = (repo) => {
  const r = spawnSync(process.execPath, [join(ROOT, "world2", "tools", "settlements-backfill.mjs"), "--apply", "--prod", "--quiet", "--world-repo", repo, "--pg-url", store.url("office_api")],
    { cwd: ROOT, encoding: "utf8", env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot } });
  return { code: r.status, out: `${r.stdout}\n${r.stderr}` };
};

test("THE REAL TICK RECOVERS: settlements-backfill --apply --prod --quiet (office-keep.sh's step) restores the orphan — on a tick that writes a settlement AND on one that writes none", { skip }, async () => {
  await seed();
  const repo = worldRepo();
  try {
    const first = await drop(30), young = await drop(2);
    const a = tick(repo);
    assert.match(a.out, /wrote 1 row\(s\) — S1/, a.out);
    assert.match(a.out, new RegExp(`drops: restored 1 \\(act ${first} → 1 ${LABEL} back to sbx-cy\\)`), a.out);
    assert.equal((await undos(first)).length, 1);
    assert.deepEqual(await undos(young), [], "younger than one tick: untouched by the real tick");
    // the next tick: NO new settlement — the recovery still runs
    const second = await drop(16);
    const b = tick(repo);
    assert.match(b.out, /wrote 0 row\(s\)/, b.out);
    assert.match(b.out, new RegExp(`drops: restored 1 \\(act ${second} → 1 ${LABEL} back to sbx-cy\\)`), b.out);
    assert.equal((await undos(first)).length, 1, "replayed by the next tick: still one");
    assert.equal((await undos(second)).length, 1);
  } finally { rmSync(repo, { recursive: true, force: true }); }
});

// ── the door: what committed decides the compensation ──────────────────────
// The unit door itself (`callUnits("drop", …)`) writing through the REAL pen
// (appendActFlipped → penWrite, office_api) onto this store; only `leave` (the
// mark's filing) and the witness stamp are stand-ins, so each case can make the
// filing commit-then-throw, fail outright, or succeed.

const { RECORD_ON } = await import("./acts-pen-stub.mjs");
const { __setPoolForTest } = await import("../src/world2-pen.mjs");
const { appendActFlipped } = await import("../src/world-journal.mjs");
const { callUnits, classViewOf } = await import("../src/world-units.mjs");
const { currentCrossing } = await import("../src/crossings.mjs");
const CLASSES = new Map(Object.entries({
  mark: { extends: null, dials: {} }, thing: { extends: "mark", dials: { carry_cap: 24 } }, consumable: { extends: "thing", dials: {} },
  candy: { extends: "consumable", dials: {}, labels: [{ label: LABEL, name: "Test Comets", creator: "sbx-ana" }] },
}));
after(() => { __setPoolForTest(null); });
async function door({ leave }) {
  if (!pool && !skip) {
    const { default: pg } = await import("pg");
    pool = new pg.Pool({ connectionString: store.url("office_api") });
    Object.assign(process.env, RECORD_ON);
    __setPoolForTest(pool);
  }
  return {
    classes: () => classViewOf({ classes: CLASSES }),
    readRows: async () => ({ units: (await unitActs()), attachments: [] }),
    markById: async () => null, reachTake: async () => ({}), reachGive: async () => ({}),
    standpoint: async () => ({ x: 3, y: 4 }), householdOf: null,
    append: (entry, opts = {}) => appendActFlipped(null, { ...entry, writtenAt: new Date().toISOString() }, opts),
    stamp: async () => ({ at: null, witnesses: null }),
    crossing: () => currentCrossing(), household: () => HH,
    leave,
  };
}
const KEY = { handles: new Set(["sbx-cy"]) };
const lastDrop = async () => (await unitActs()).filter((a) => a.action === UNIT_ACTION.drop).at(-1).id;

test("DOOR · the filing COMMITS and then throws: nothing is undone, and the receipt says the mark was filed", { skip }, async () => {
  await seed(); await give("sbx-cy", 3);
  const deps = await door({ leave: async (payload) => {
    await file(String(payload.dropped).slice(4), "pending");    // the claim and its act commit…
    throw new Error("world clone has no main ref");               // …then the door's after-filing step trips
  } });
  const out = await callUnits("drop", { label: LABEL }, KEY, "sbx-cy", deps);
  const id = await lastDrop();
  assert.deepEqual(await undos(id), [], "no refund of a filed unit");
  assert.equal(out.filed.status, "pending");
  assert.match(out.stands_note, /the mark WAS filed \(pending\)/);
  assert.equal(out.office_error_after_filing, "the world's files could not be read", "the plain reason (POS-657); the raw error is in the log");
  assert.equal(await heldBy("sbx-cy"), 2, "one unit on the ground, two in hand — never three");
  assert.deepEqual((await office((c) => recoverOrphanDrops(c, { now: Date.now() + 2 * TICK_MS }))).restored, [], "and the tick agrees");
});

test("DOOR · ordinary failure: nothing filed → the unit comes back once, by the nonce; the tick then finds nothing to do", { skip }, async () => {
  await seed(); await give("sbx-cy", 3);
  const deps = await door({ leave: async () => ({ error: "bounce", defect: "the ground is taken" }) });
  await assert.rejects(callUnits("drop", { label: LABEL }, KEY, "sbx-cy", deps), (e) => e.code === 409 && /back in your hands/.test(e.hint));
  const id = await lastDrop();
  const [u] = await undos(id);
  assert.deepEqual([u.nonce, u.payload.by], [undoNonce(id), "door"]);
  assert.equal(await heldBy("sbx-cy"), 3);
  assert.deepEqual((await office((c) => recoverOrphanDrops(c, { now: Date.now() + 2 * TICK_MS }))).restored, []);
});

test("DOOR · the compensation's own write fails: the unit stays out, the receipt says so honestly, and a later tick restores it", { skip }, async () => {
  await seed(); await give("sbx-cy", 3);
  const deps = await door({ leave: async () => { throw new Error("pen down"); } });
  const real = deps.append;
  deps.append = async (entry, opts) => { if (entry.action === UNIT_ACTION.dropUndone) throw Object.assign(new Error("the record cannot be reached"), { name: "PenUnreachableError" }); return real(entry, opts); };
  await assert.rejects(callUnits("drop", { label: LABEL }, KEY, "sbx-cy", deps), (e) => e.code === 503 && /office tick returns it/.test(e.hint));
  const id = await lastDrop();
  assert.deepEqual(await undos(id), []);
  assert.equal(await heldBy("sbx-cy"), 2, "out, honestly");
  const r = await office((c) => recoverOrphanDrops(c, { now: Date.now() + 2 * TICK_MS }));
  assert.deepEqual(r.restored.map((x) => x.act), [id]);
  assert.equal(await heldBy("sbx-cy"), 3);
});

test("DOOR · a legitimate set-down files and stays filed: no undo, nothing out", { skip }, async () => {
  await seed(); await give("sbx-cy", 3);
  const deps = await door({ leave: async (payload) => { await file(String(payload.dropped).slice(4), "pending"); return { id: `sbx-cy/${payload.slug}`, put_forward: true }; } });
  const out = await callUnits("drop", { label: LABEL }, KEY, "sbx-cy", deps);
  assert.equal(out.put_forward, true);
  const id = await lastDrop();
  assert.deepEqual(await undos(id), []);
  assert.equal(await office(async (c) => { await c.query("BEGIN READ ONLY"); try { return await dropsStillOut(c, "sbx-cy"); } finally { await c.query("COMMIT"); } }), 0);
  assert.deepEqual((await office((c) => recoverOrphanDrops(c, { now: Date.now() + 2 * TICK_MS }))).restored, []);
});

// ── correction B across every unit cap path (Bevel's probe covers `take`) ────
// The tick's recovery commits between the in-flight read and the held read —
// injected exactly there, as Bevel's probe does. Each path must refuse, and the
// record must hold 24, never 25. Real pen, real store.

const raceDeps = async ({ markById = async () => null, attachments = [], holders = async () => [] } = {}) => {
  const base = await door({ leave: async () => { throw new Error("unused"); } });
  let ran = 0;
  return { ...base, markById, holders, unstake: async () => ({ applied: 0 }), withdraw: async () => ({ withdrawn: true }), markTurn: (id, fn) => fn(),
    readRows: async () => ({ units: await unitActs(), attachments }),
    dropsOut: async (h) => {
      if (ran++ === 0) assert.equal((await office((c) => recoverOrphanDrops(c, {}))).restored.length, 1, "the tick restores in the gap");
      return office(async (c) => { await c.query("BEGIN READ ONLY"); try { return await dropsStillOut(c, h); } finally { await c.query("COMMIT"); } });
    } };
};

test("B · a GIVE to a resident at 23 held + 1 out, with the tick restoring in the gap, is refused; the record stays 24", { skip }, async () => {
  await seed(); await give("sbx-cy", 24); await drop(30); await give("sbx-bo", 1);
  const deps = await raceDeps();
  const e = await callUnits("give", { to: "sbx-cy", count: 1 }, { handles: new Set(["sbx-bo"]) }, "sbx-bo", deps).then(() => null, (x) => x);
  assert.equal(e?.code, 409, e?.message);
  assert.equal(await heldBy("sbx-cy"), 24);
});

test("B · a TAKE-BACK at 23 held + 1 out, with the tick restoring in the gap, is refused; the record stays 24", { skip }, async () => {
  await seed(); await give("sbx-cy", 25); const first = await drop(30); await drop(30);   // 23 in hand; one out (restored in the gap), one filed:
  await file(first, "pending");
  const mark = { id: dropMarkId({ actor: "sbx-cy", label: LABEL, actId: first }), by: "sbx-cy", class: "candy", kind: "sited", label: LABEL, dropped: `act:${first}` };
  const deps = await raceDeps({ markById: async (id) => (id === mark.id ? mark : null) });
  const e = await callUnits("take-back", { thing: mark.id }, KEY, "sbx-cy", deps).then(() => null, (x) => x);
  assert.equal(e?.code, 409, e?.message);
  assert.equal(await heldBy("sbx-cy"), 24);
});

test("B · a WHOLE THING out of a chest at 23 held + 1 out, with the tick restoring in the gap, is refused", { skip }, async () => {
  await seed(); await give("sbx-cy", 24); await drop(30);
  const chest = { id: "sbx-ana/b-chest", by: "sbx-ana", class: "chest", capacity: 30 };
  const toaster = { id: "sbx-ana/b-toaster", by: "sbx-ana", class: "thing" };
  const deps = await raceDeps({ markById: async (id) => ({ [chest.id]: chest, [toaster.id]: toaster })[id] ?? null,
    attachments: [{ entity: chest.id, target: toaster.id, policy: "cascade", born_at: new Date(Date.now() - 60000).toISOString() }] });
  const e = await callUnits("thing-from-chest", { thing: toaster.id, from: chest.id }, KEY, "sbx-cy", deps).then(() => null, (x) => x);
  assert.equal(e?.code, 409, e?.message);
  assert.equal(await heldBy("sbx-cy"), 24, "24 units — and no toaster on top");
});

test("B · [source pin, not a run] the hold lane's whole-thing carry check reads in-flight BEFORE the held rows, as the unit door does", () => {
  const src = readFileSync(join(ROOT, "src", "world-hold.mjs"), "utf8");
  const fn = src.slice(src.indexOf("async function carryForThings("), src.indexOf("async function unitsHeldBy("));
  const flight = fn.indexOf("await inFlightFor(who"), rows = fn.indexOf("await storeHoldingRows()");
  assert.ok(flight > 0 && rows > 0 && flight < rows, "out first, held second");
});

// ── correction C: the drop's ORIGINAL household, not the dropper's present one ─

test("C · two houses, two drops: a private draft filed under the OLD house keeps its drop filed after Cy moves; the new house's orphan alone comes back; out counts only it", { skip }, async () => {
  await seed();
  await owner((c) => c.query("UPDATE households SET slug = 'sbx-old-house', residents = ARRAY['sbx-cy','sbx-zed'], declared_by = 'sbx-zed' WHERE slug = 'sbx-cy'"));
  const OLD = "hh:sbx-old-house", NEW = "hh:sbx-new-house";
  const dropIn = (hh) => owner(async (c) => (await c.query(
    `INSERT INTO acts (at, crossing, actor, action, object, class, payload, household) VALUES (now() - interval '30 minutes', 300.1, 'sbx-cy', 'units:drop', 'sbx-cy', 'holding', $1, $2) RETURNING id::text`,
    [JSON.stringify({ units: true, moves: [{ from: "sbx-cy", to: null, label: LABEL, n: 1 }], label: LABEL }), hh])).rows[0].id);
  await give("sbx-cy", 3);
  const old = await dropIn(OLD);
  await owner((c) => c.query(`INSERT INTO claims (window_id, class, claimant, household, status, body, geometry, bbox, stake, data, slug)
     VALUES (300, 'sited', 'sbx-cy', $1, 'draft', 'Filed in the old house.', '{"at":{"x":0,"y":0},"extent":{"w":1,"h":1}}', '((0,0),(1,1))', 0, $2, 'sbx-cy/old-house-candy')`,
    [OLD, JSON.stringify({ class: "candy", label: LABEL, dropped: `act:${old}` })]));
  await owner(async (c) => {
    await c.query("UPDATE households SET residents = ARRAY['sbx-zed'] WHERE slug = 'sbx-old-house'");
    await c.query("INSERT INTO households (slug, ord, name, residents, since, declared_by) VALUES ('sbx-new-house', 1, 'New', ARRAY['sbx-cy'], '2026-08-02', 'sbx-cy')");
  });
  const { actHouseholdFor } = await import("../src/world2-claims.mjs");
  assert.equal(await office((c) => actHouseholdFor(c, { actor: "sbx-cy" })), NEW, "Cy now resolves to the new house");
  const orphan = await dropIn(NEW);
  const out = await office(async (c) => { await c.query("BEGIN READ ONLY"); try { return await dropsStillOut(c, "sbx-cy"); } finally { await c.query("COMMIT"); } });
  assert.equal(out, 1, "the old house's filed drop is not out; the new house's orphan is");
  const r = await office((c) => recoverOrphanDrops(c, {}));
  assert.deepEqual(r.restored.map((x) => x.act), [orphan]);
  assert.deepEqual(r.filed.map((f) => [f.act, f.slug, f.status]), [[old, "sbx-cy/old-house-candy", "draft"]]);
  const [u] = await undos(orphan);
  assert.equal(u.household, NEW, "the undo keeps its own drop's original household");
  assert.deepEqual(await undos(old), []);
  assert.equal(await heldBy("sbx-cy"), 2, "3 − 2 set down + 1 back: the filed one stays on the ground");
});

test("C · the door's compensation guard, run in the pen's own transaction, sees the old house's private draft too", { skip }, async () => {
  await seed();
  await owner((c) => c.query("UPDATE households SET slug = 'sbx-old-house' WHERE slug = 'sbx-cy'"));
  const OLD = "hh:sbx-old-house";
  const id = await owner(async (c) => (await c.query(
    `INSERT INTO acts (at, crossing, actor, action, object, class, payload, household) VALUES (now(), 300.1, 'sbx-cy', 'units:drop', 'sbx-cy', 'holding', $1, $2) RETURNING id::text`,
    [JSON.stringify({ units: true, moves: [{ from: "sbx-cy", to: null, label: LABEL, n: 1 }], label: LABEL }), OLD])).rows[0].id);
  await owner(async (c) => {
    await c.query(`INSERT INTO claims (window_id, class, claimant, household, status, body, geometry, bbox, stake, data, slug)
       VALUES (300, 'sited', 'sbx-cy', $1, 'draft', 'Filed.', '{"at":{"x":0,"y":0},"extent":{"w":1,"h":1}}', '((0,0),(1,1))', 0, $2, 'sbx-cy/kept')`,
      [OLD, JSON.stringify({ class: "candy", label: LABEL, dropped: `act:${id}` })]);
    await c.query("UPDATE households SET residents = ARRAY['sbx-zed'] WHERE slug = 'sbx-old-house'");
    await c.query("INSERT INTO households (slug, ord, name, residents, since, declared_by) VALUES ('sbx-new-house', 1, 'New', ARRAY['sbx-cy'], '2026-08-02', 'sbx-cy')");
  });
  const e = await office(async (c) => {
    await c.query("BEGIN");
    try { await dropUndoGuard({ actId: id })(c); return null; } catch (x) { return x; } finally { await c.query("ROLLBACK"); }
  });
  assert.deepEqual(e?.filed && [e.filed.slug, e.filed.status], ["sbx-cy/kept", "draft"], e?.message);
});
