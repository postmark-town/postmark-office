// exit-stake-boundary.test.mjs — WLD-27 post-#501, A and B (Wright, AUTHORITY
// 2026-10-13T05:20:23Z): NO STAKE LANDS BEHIND A MARK THAT HAS LEFT, and every
// return's receipt carries the ledger commit the engine actually made.
//
//   node --test test/exit-stake-boundary.test.mjs
//
// Everything here is the real path, against synthetic fixtures:
//   · a real Postgres (embedded-store.mjs, the whole schema; the office_api role);
//   · a throwaway TOWN carrying the town's own tools/ code (copyTownTools) and
//     its own signed ledger — stakes and unstakes go through
//     src/world-stake-exec.mjs as a child under the flock (runExec), so the
//     receipts are what the engine and the pen's commit really answered;
//   · the unit door's own markExit (callUnits "take-back") with the live
//     collaborators for the ledger: the holders read, the unstake, the
//     barrier and the withdrawal (journalWithdraw).
// The one in-process piece is a stake HELD inside the exec's own critical
// section (mark-stake-lock.mjs § withMarkHeld, with the engine's append and its landing)
// so an interleaving can be pinned exactly; the exec file's wiring of that same
// function is driven as a child in the refusal cases.
//
// Synthetic handles, labels and stamps only; no real town, store or box.

import { after, test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

// ── the fixtures, BEFORE the office modules load (TOWN_CLONE / WORLD_CLONE are read at load) ──

const world = scratch("wld27-a-world-");
mkdirSync(join(world, "WORLD"), { recursive: true });
writeFileSync(join(world, "WORLD", "world-state.json"), JSON.stringify({ tick: 0, dials: {}, marks: [] }));
writeFileSync(join(world, "WORLD", "skeleton.json"), JSON.stringify({ features: [], physics_registry: {} }));
execFileSync("git", ["init", "-q", "-b", "main", world]);
git(world, "add", "-A"); git(world, "-c", "user.name=fixture", "-c", "user.email=fixture@test.invalid", "commit", "-q", "-m", "an empty world");

const DAY = "2026-10-13";
const FX = TOWN ? (() => {
  const repo = scratch("wld27-a-town-");
  mkdirSync(join(repo, "WHITE_PAGES"), { recursive: true });
  copyTownTools(TOWN, repo);
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  writeFileSync(join(repo, "tools", "stamp-pubkey.pem"), publicKey.export({ type: "spki", format: "pem" }));
  const pem = privateKey.export({ type: "pkcs8", format: "pem" });
  const keyFile = join(scratch("wld27-a-key-"), "stamp-key.pem");
  writeFileSync(keyFile, pem);
  execFileSync("git", ["init", "-q", "-b", "main", repo]);
  return { repo, pem, keyFile };
})() : null;

const store = await startStore({ db: "exit_stake_boundary_test" });
const skip = (store.skip ?? false) || (!FX && NO_TOWN) || false;

const savedEnv = {};
const setEnv = (k, v) => { if (!(k in savedEnv)) savedEnv[k] = process.env[k]; if (v === undefined) delete process.env[k]; else process.env[k] = v; };
if (!skip) {
  setEnv("WORLD_CLONE", world);
  setEnv("TOWN_CLONE", FX.repo);
  setEnv("TOWN_LOCK", join(scratch("wld27-a-lock-"), "town.lock"));
  setEnv("STAMP_KEY", FX.keyFile);
  setEnv("BOT_NAME", "fixture"); setEnv("BOT_EMAIL", "fixture@test.invalid");
  setEnv("TOWN_PUSH", undefined); setEnv("STAMP_LINES", undefined);
  // the record the office AND the exec child dial: the store's office_api role
  setEnv("WORLD2_PG", "1"); setEnv("WORLD2_PG_URL", store.url("office_api"));
  setEnv("WORLD2_CANDLE", "1"); setEnv("WORLD_SINGLE_LOG", "1");
}

const MINT = FX ? await import(pathToFileURL(join(FX.repo, "tools", "stamp-mint.mjs"))) : null;
const ENGINE = FX ? await import(pathToFileURL(join(FX.repo, "tools", "world-stake.mjs"))) : null;
if (FX) {
  MINT.appendSigned(FX.repo, ["sbx-ana", "sbx-bo", "sbx-dee", "sbx-cy"].map((handle) =>
    MINT.giftLine({ date: "2026-09-01", handle, n: 40, slug: "seed", by: "the-town" })), FX.pem);
  git(FX.repo, "add", "-A"); git(FX.repo, "-c", "user.name=fixture", "-c", "user.email=fixture@test.invalid", "commit", "-q", "-m", "fixture town");
}

const { __setPoolForTest } = await import("../src/world2-pen.mjs");
const { appendActFlipped } = await import("../src/world-journal.mjs");
const { callUnits, classViewOf, liveUnitDeps } = await import("../src/world-units.mjs");
const { worldStakeViaOffice, runExec } = await import("../src/world-stake.mjs");
const { withdrawMarkViaOffice, journalWithdraw } = await import("../src/world.mjs");
const { withMarkHeld, stakeRefusalUnderLock, withdrawEscrowGuard, markLockKey } = await import("../src/mark-stake-lock.mjs");
const { heldFor } = await import("../src/stamps-preview.mjs");
const { UNIT_ACTION } = await import("../src/world-stacks.mjs");
const { currentCrossing } = await import("../src/crossings.mjs");

let pool = null;
after(async () => {
  __setPoolForTest(null); if (pool) await pool.end();
  for (const [k, v] of Object.entries(savedEnv)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  if (!(store.skip ?? false)) await store.stop();
});

// ── the store ────────────────────────────────────────────────────────────────

const LABEL = "test-comets";
const WIN = 300;
const CY = "sbx-cy", HH = "hh:sbx-cy";
const CLASSES = new Map(Object.entries({
  mark: { extends: null, dials: {} }, thing: { extends: "mark", dials: { carry_cap: 24 } }, consumable: { extends: "thing", dials: {} },
  candy: { extends: "consumable", dials: {}, labels: [{ label: LABEL, name: "Test Comets", creator: "sbx-ana" }] },
}));
async function owner(fn) { const c = await store.connect("world2_owner"); try { return await fn(c); } finally { await c.end(); } }
const q1 = (sql, p = []) => owner(async (c) => (await c.query(sql, p)).rows);

async function seed() {
  if (!pool) {
    const { default: pg } = await import("pg");
    pool = new pg.Pool({ connectionString: store.url("office_api") });
    __setPoolForTest(pool);
  }
  await owner(async (c) => {
    await c.query("TRUNCATE acts, claims, marks, windows, settlements, households, household_pins CASCADE");
    await c.query(`INSERT INTO windows (id, opens_at, closes_at, status) VALUES ($1, now() - interval '2 days', now() + interval '2 days', 'open')`, [WIN]);
    for (const [i, h] of ["sbx-ana", "sbx-bo", "sbx-cy", "sbx-dee"].entries()) {
      await c.query(`INSERT INTO households (slug, ord, name, residents, since, declared_by) VALUES ($1, $2, $1, ARRAY[$1], '2026-08-01', $1)`, [h, i]);
      await c.query(`INSERT INTO household_pins (handle, login, gh_id, pinned) VALUES ($1, $1, $2, '2026-08-01')`, [h, 900 + i]);
    }
    await c.query(`INSERT INTO acts (at, crossing, actor, action, object, class, payload, household) VALUES (now() - interval '1 day', $1, 'the-town', 'units:give', $2, 'holding', $3, 'the-town')`,
      [currentCrossing(), CY, JSON.stringify({ units: true, moves: [{ from: null, to: CY, label: LABEL, n: 5 }] })]);
  });
}

/** Cy sets one unit down and its mark is filed pending — the drop act, its claim and its leave act, as the pen writes them. */
async function droppedMark() {
  const [{ id }] = await q1(`INSERT INTO acts (at, crossing, actor, action, object, class, payload, household)
    VALUES (now() - interval '1 hour', $1, $2, 'units:drop', $2, 'holding', $3, $4) RETURNING id::text`,
  [currentCrossing(), CY, JSON.stringify({ units: true, moves: [{ from: CY, to: null, label: LABEL, n: 1 }], label: LABEL }), HH]);
  const mark = `${CY}/${LABEL}-${id}`;
  const data = { class: "candy", label: LABEL, dropped: `act:${id}`, by: CY };
  await q1(`INSERT INTO acts (at, crossing, actor, action, object, class, payload, household) VALUES (now(), $1, $2, 'leave-mark', $3, 'mark', $4, $5)`,
    [currentCrossing(), CY, mark, JSON.stringify(data), HH]);
  await q1(`INSERT INTO claims (window_id, class, claimant, household, status, body, geometry, bbox, stake, data, slug)
            VALUES ($1, 'sited', $2, $3, 'pending', 'One Test Comets, set down here.', $6, '((0,0),(1,1))', 1, $4, $5)`,
  [WIN, CY, HH, JSON.stringify(data), mark, JSON.stringify({ slug: mark, at: { x: 0, y: 0 }, extent: { w: 1, h: 1 } })]);
  return { mark, drop: id, record: { id: mark, by: CY, class: "candy", label: LABEL, dropped: `act:${id}`, household: HH } };
}

/** An ordinary pending mark of Ana's, with its leave act. */
async function plainMark(slug) {
  const mark = `sbx-ana/${slug}`;
  await q1(`INSERT INTO acts (at, crossing, actor, action, object, class, payload, household) VALUES (now(), $1, 'sbx-ana', 'leave-mark', $2, 'mark', '{}', 'hh:sbx-ana')`, [currentCrossing(), mark]);
  await q1(`INSERT INTO claims (window_id, class, claimant, household, status, body, geometry, bbox, stake, data, slug)
            VALUES ($1, 'sited', 'sbx-ana', 'hh:sbx-ana', 'pending', 'A mark.', $3, '((39,-1),(41,1))', 0, '{"by":"sbx-ana"}', $2)`,
  [WIN, mark, JSON.stringify({ slug: mark, at: { x: 40, y: 0 }, extent: { w: 2, h: 2 } })]);
  return mark;
}

const unitActs = async () => (await q1("SELECT id::text, class, action, actor, object, household, nonce, payload FROM acts WHERE action LIKE 'units:%' ORDER BY acts.id"));
const census = async () => ({
  acts: await q1("SELECT id::text, action, object FROM acts ORDER BY acts.id"),
  claims: await q1("SELECT slug, status FROM claims ORDER BY slug"),
});

// ── the ledger ───────────────────────────────────────────────────────────────

const ledgerFile = () => join(FX.repo, "WHITE_PAGES", "stamp-ledger.md");
const ledger = () => readFileSync(ledgerFile(), "utf8");
const position = (mark, handle) => ENGINE.markPosition(FX.repo, mark, handle);
const balance = (handle) => ENGINE.worldStakeState(FX.repo).balances.get(handle) ?? 0;
/** A stake through the real exec, under the flock — what the office's ledger collaborator runs. */
const execStake = (handle, mark, n) => runExec({ verb: "stake", handle, mark, n, via: "api", date: DAY });
const execUnstake = (handle, mark, n) => runExec({ verb: "unstake", handle, mark, n, date: DAY });
const commitExists = (sha) => { try { return git(FX.repo, "cat-file", "-t", sha) === "commit"; } catch { return false; } };
const commitSubject = (sha) => git(FX.repo, "log", "-1", "--format=%s", sha);

const gate = () => { let open; const p = new Promise((r) => { open = r; }); return { p, open }; };
async function until(fn, what) {
  for (let i = 0; i < 600; i++) { if (await fn()) return; await new Promise((r) => setTimeout(r, 20)); }
  throw new Error(`timed out waiting for ${what}`);
}
const advisoryWaiters = async () => (await q1("SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND NOT granted"))[0].n;

/**
 * A STAKE HELD INSIDE THE EXEC'S CRITICAL SECTION: the mark's lock is taken
 * and the record asked (the exec's own two functions, withMarkHeld and
 * stakeRefusalUnderLock), then it waits for `release()` before the engine
 * appends, and is committed to the fixture's git — the exec's landing — while
 * the lock is STILL held, as the exec holds it. `checked` resolves once the
 * record has been asked and admitted the stake.
 */
function heldStake(mark, handle, n) {
  const checked = gate(), go = gate();
  const done = withMarkHeld(mark, async (client) => {
    const refused = await stakeRefusalUnderLock(client, mark);
    if (refused) throw refused;
    checked.open();
    await go.p;
    const out = ENGINE.worldStakeApply(FX.repo, { handle, mark, n, via: "api", date: DAY }, FX.pem);
    git(FX.repo, "add", "-A"); git(FX.repo, "-c", "user.name=fixture", "-c", "user.email=fixture@test.invalid", "commit", "-q", "-m", `stake: ${handle} -> world-mark/${mark} · ${n} (held)`);
    return out;
  });
  return { checked: checked.p, release: () => go.open(), done };
}

/**
 * The exit paused just before its take-back act is written — its first,
 * settled holder read already done. `atAct` resolves there; `go()` lets the
 * act commit.
 */
function exitPausedAtAct(deps) {
  const at = gate(), go = gate();
  return { at: at.p, go: () => go.open(), deps: { ...deps, append: async (entry, opts) => {
    if (entry.action === UNIT_ACTION.takeBack) { at.open(); await go.p; }
    return deps.append(entry, opts);
  } } };
}

// ── the unit door, with the live ledger collaborators ───────────────────────

let LIVE = null;
async function unitDeps(rec, over = {}) {
  LIVE ??= await liveUnitDeps();
  return {
    classes: () => classViewOf({ classes: CLASSES }),
    readRows: async () => ({ units: await unitActs(), attachments: [] }),
    markById: async (id) => (id === rec.id ? rec : null),
    reachTake: async () => ({}), reachGive: async () => ({}), standpoint: async () => ({ x: 3, y: 4 }),
    householdOf: (h) => ({ key: `hh:${h}` }),
    append: (entry, opts = {}) => appendActFlipped(null, { ...entry, writtenAt: new Date().toISOString() }, opts),
    stamp: async () => ({ at: null, witnesses: null }),
    crossing: () => currentCrossing(), household: () => HH,
    holders: LIVE.holders, unstake: LIVE.unstake, withdraw: LIVE.withdraw, markTurn: LIVE.markTurn, dropsOut: LIVE.dropsOut,
    ...over,
  };
}
const KEY_CY = { household: HH, handles: new Set([CY]) };
const takeBack = (rec, deps) => callUnits("take-back", { thing: rec.id }, KEY_CY, CY, deps);
const KEY_ANA = { household: "hh:sbx-ana", handles: new Set(["sbx-ana"]) };
const doorDeps = () => ({ exists: async () => ({ known: true, exists: true, record: null }), held: (h) => heldFor(FX.repo, h) });

// ════════════════════════════════════════════════════════════════════════════
// A · the stake door against a recorded exit
// ════════════════════════════════════════════════════════════════════════════

test("A · EXIT RECORDED ⇒ the stake door refuses before any promotion or stamp, and so does the exec itself under the mark's lock", { skip }, async () => {
  await seed();
  const m = await droppedMark();
  const out = await takeBack(m.record, await unitDeps(m.record));
  assert.equal(out.withdrawn?.withdrawn, true, JSON.stringify(out));
  const before = { ledger: ledger(), census: await census(), held: balance("sbx-ana") };

  const r = await worldStakeViaOffice({ mark: m.mark, stamps: 2 }, KEY_ANA, doorDeps());
  assert.equal(r.code, 409, JSON.stringify(r));
  assert.match(r.defect, /has left the world — its unit was taken back \(act \d+\)/);
  assert.match(r.hint, /Nothing was staked/);
  // and the preview says the same, before showing any block
  const p = await worldStakeViaOffice({ mark: m.mark, stamps: 2, preview: true }, KEY_ANA, doorDeps());
  assert.equal(p.code, 409);

  // THE EXEC'S OWN CHECK, with the door's early answer out of the way: the real
  // child under the flock asks the record under the mark's lock and refuses
  const x = await execStake("sbx-ana", m.mark, 2);
  assert.equal(x.error, "bounce", JSON.stringify(x));
  assert.equal(x.code, 409);
  assert.match(x.defect, /has left the world/);

  assert.equal(ledger(), before.ledger, "no ledger line");
  assert.equal(balance("sbx-ana"), before.held, "no stamp moved");
  assert.deepEqual(await census(), before.census, "no act, no claim promoted or changed");
});

test("A · THE PROMOTION'S OWN GUARD: with the door's early read gone stale, a stake on an exited unit's private DRAFT is refused inside the promotion's transaction — the draft stays a draft, no stamp moves", { skip }, async () => {
  await seed();
  const [{ id }] = await q1(`INSERT INTO acts (at, crossing, actor, action, object, class, payload, household)
    VALUES (now() - interval '1 hour', $1, $2, 'units:drop', $2, 'holding', $3, $4) RETURNING id::text`,
  [currentCrossing(), CY, JSON.stringify({ units: true, moves: [{ from: CY, to: null, label: LABEL, n: 1 }], label: LABEL }), HH]);
  const mark = `${CY}/${LABEL}-${id}`;
  await q1(`INSERT INTO claims (window_id, class, claimant, household, status, body, geometry, bbox, stake, data, slug)
            VALUES ($1, 'sited', $2, $3, 'draft', 'One Test Comets, set down here.', $4, '((0,0),(1,1))', 0, $5, $6)`,
  [WIN, CY, HH, JSON.stringify({ slug: mark, at: { x: 0, y: 0 }, extent: { w: 1, h: 1 } }), JSON.stringify({ class: "candy", label: LABEL, dropped: `act:${id}`, by: CY }), mark]);
  await q1(`INSERT INTO acts (at, crossing, actor, action, object, class, payload, household) VALUES (now(), $1, $2, 'units:take-back', $3, 'holding', $4, $5)`,
    [currentCrossing(), CY, mark, JSON.stringify({ units: true, moves: [{ from: null, to: CY, label: LABEL, n: 1 }], label: LABEL, mark, returns: [] }), HH]);
  const before = { ledger: ledger(), census: await census(), claim: await q1("SELECT status FROM claims WHERE slug = $1", [mark]) };
  assert.deepEqual(before.claim.map((r) => r.status), ["draft"]);
  const r = await worldStakeViaOffice({ mark, stamps: 1 }, KEY_CY, { ...doorDeps(), left: async () => null });
  assert.equal(r.code, 409, JSON.stringify(r));
  assert.match(r.defect, /has left the world/);
  assert.deepEqual(await q1("SELECT status FROM claims WHERE slug = $1", [mark]), before.claim, "never put forward");
  assert.deepEqual(await census(), before.census);
  assert.equal(ledger(), before.ledger);
});

test("A · INTERLEAVING 1 — a stake that passed its check after the exit's first read but BEFORE its act committed lands after it, and the late pass, reading under the lock, returns it once", { skip }, async () => {
  await seed();
  const m = await droppedMark();
  const balBefore = balance("sbx-dee");
  // the exit's first (settled) read sees nothing; it pauses before writing its act
  const e = exitPausedAtAct(await unitDeps(m.record));
  let settled = false;
  const exit = takeBack(m.record, e.deps).finally(() => { settled = true; });
  await e.at;
  // the stake is inside the exec's critical section: lock held, record asked — no exit yet, so admitted
  const s = heldStake(m.mark, "sbx-dee", 3);
  await s.checked;
  e.go();                                               // the exit act commits while the stake is still in flight
  await until(async () => (await unitActs()).some((a) => a.action === UNIT_ACTION.takeBack && a.object === m.mark), "the exit act to commit");
  // the exit's late read waits on the stake's lock — or, with no settled read, runs on past it
  await until(async () => settled || (await advisoryWaiters()) >= 1, "the exit to reach its late pass");
  assert.equal(position(m.mark, "sbx-dee"), 0, "the stake has not landed yet");
  s.release();
  const staked = await s.done;
  assert.equal(staked.applied, 3, "the stake admitted before the exit committed is a real stake");
  const out = await exit;

  assert.deepEqual(out.returns, [], "the exit's own first read saw no stake");
  assert.equal(out.late_returns?.length, 1, JSON.stringify(out));
  const [late] = out.late_returns;
  assert.deepEqual([late.handle, late.stamps], ["sbx-dee", 3]);
  assert.ok(commitExists(late.commit), `B: the late return names the real ledger commit (${late.commit})`);
  assert.match(commitSubject(late.commit), /^unstake: sbx-dee <- world-mark\/.+ · 3$/);
  assert.equal(position(m.mark, "sbx-dee"), 0, "returned: nothing of Dee's stands on the exited mark");
  assert.equal(balance("sbx-dee"), balBefore, "Dee holds exactly what she held before");
  assert.equal(out.withdrawn?.withdrawn, true);
  const w = (await unitActs()).find((a) => a.action === UNIT_ACTION.exitWithdrawn && a.object === m.mark);
  assert.deepEqual(w.payload.late_returns, [{ handle: "sbx-dee", stamps: 3, commit: late.commit }], "the record carries the receipt the engine gave");
});

test("A · INTERLEAVING 2 — a stake asking AFTER the exit committed (while its late pass and withdrawal run) is refused; a retry adds no line, no unit, no exit", { skip }, async () => {
  await seed();
  const m = await droppedMark();
  // the exit is held inside its withdrawal: exit act committed, late pass done
  const inWithdraw = gate(), letGo = gate();
  const deps = await unitDeps(m.record);
  const exit = takeBack(m.record, { ...deps, withdraw: async (w) => { inWithdraw.open(); await letGo.p; return deps.withdraw(w); } });
  await inWithdraw.p;
  const before = ledger();
  const x = await execStake("sbx-ana", m.mark, 2);
  assert.equal(x.code, 409, JSON.stringify(x));
  assert.equal(ledger(), before, "refused under the lock: no line");
  letGo.open();
  const out = await exit;
  assert.equal(out.withdrawn?.withdrawn, true);
  const acts = (await census()).acts.length, units = await unitActs();
  const retry = await takeBack(m.record, await unitDeps(m.record));
  assert.equal(retry.duplicate, true);
  assert.deepEqual(retry.returns, []);
  assert.equal((await census()).acts.length, acts, "the retry writes nothing");
  assert.deepEqual(await unitActs(), units, "no second unit, no second exit");
  assert.equal(ledger(), before, "and no ledger line");
});

test("A · an ordinary mark is staked through the real door and exec as before, and unstaking stays open — even on a mark that has left", { skip }, async () => {
  await seed();
  const mark = await plainMark("a-stakeable-mark");
  const r = await worldStakeViaOffice({ mark, stamps: 2 }, KEY_ANA, doorDeps());
  assert.equal(r.error, undefined, JSON.stringify(r));
  assert.equal(position(mark, "sbx-ana"), 2);
  assert.ok(commitExists(r.read_back?.commit ?? r.commit ?? ""), JSON.stringify(r.read_back));
  const u = await execUnstake("sbx-ana", mark, 2);
  assert.equal(u.applied, 2, JSON.stringify(u));
  assert.equal(position(mark, "sbx-ana"), 0);

  // a stake that stood before the exit (put there directly), then the exit recorded with no return: the staker still unstakes
  const m = await droppedMark();
  assert.equal((await execStake("sbx-bo", m.mark, 1)).applied, 1);
  await q1(`INSERT INTO acts (at, crossing, actor, action, object, class, payload, household) VALUES (now(), $1, $2, 'units:take-back', $3, 'holding', $4, $5)`,
    [currentCrossing(), CY, m.mark, JSON.stringify({ units: true, moves: [], label: LABEL, mark: m.mark, returns: [] }), HH]);
  assert.equal((await execStake("sbx-bo", m.mark, 1)).code, 409, "no new stake");
  const back = await execUnstake("sbx-bo", m.mark, 1);
  assert.equal(back.applied, 1, "an unstake is never refused — it is how stakes come home");
  assert.ok(commitExists(back.commit));
});

// ── the public withdrawal's read → write gap, both pens ─────────────────────

for (const pen of ["unflipped", "flipped"]) {
  const arm = () => setEnv("W2_PEN", pen === "flipped" ? "mark" : undefined);

  test(`A · PUBLIC WITHDRAW (${pen} mark pen) — a stake holding the lock first lands, and the withdrawal's own read under the lock refuses; nothing is withdrawn`, { skip }, async () => {
    await seed(); arm();
    const mark = await plainMark(`racing-${pen}`);
    const s = heldStake(mark, "sbx-bo", 2);
    await s.checked;
    let settled = false;
    const w = withdrawMarkViaOffice(world, { mark }, KEY_ANA).then((x) => ({ x }), (e) => ({ e })).finally(() => { settled = true; });
    await until(async () => settled || (await advisoryWaiters()) >= 1, "the withdrawal to wait on the mark's lock (or, unguarded, to finish)");
    s.release(); await s.done;
    const { x, e } = await w;
    assert.equal(x, undefined, JSON.stringify(x));
    assert.equal(e.code, 409, e.defect);
    assert.match(e.defect, /2✦ stand in escrow/);
    assert.equal((await q1("SELECT count(*)::int AS n FROM acts WHERE action = 'withdraw' AND object = $1", [mark]))[0].n, 0, "no withdraw act");
    assert.deepEqual((await q1("SELECT status FROM claims WHERE slug = $1", [mark])).map((r) => r.status), ["pending"], "the claim stands");
    assert.equal(position(mark, "sbx-bo"), 2, "the stake stands where a withdrawal could not strand it");
    setEnv("W2_PEN", undefined);
  });

  test(`A · PUBLIC WITHDRAW (${pen} mark pen) — the withdrawal holding the lock first commits, and the stake asking after it is refused by the exec; no stamp stranded`, { skip }, async () => {
    await seed(); arm();
    const mark = await plainMark(`racing-second-${pen}`);
    const read = gate(), go = gate();
    const { ledgerEscrowOf } = await import("../src/world-stake.mjs");
    const guard = withdrawEscrowGuard({ mark, escrow: async (id) => { read.open(); await go.p; return ledgerEscrowOf(id); } });
    const w = journalWithdraw({ by: "sbx-ana", slug: mark.split("/")[1], household: "hh:sbx-ana", guard });
    await read.p;                                         // the withdrawal holds the mark's lock
    const before = ledger();
    let staked = false;
    const stake = execStake("sbx-bo", mark, 2).finally(() => { staked = true; }); // the real exec, under the flock, waits on the mark's lock
    await until(async () => staked || (await advisoryWaiters()) >= 1, "the stake to wait on the mark's lock (or, unchecked, to land)");
    go.open();
    assert.equal((await w).withdrawn, true);
    const x = await stake;
    assert.equal(x.code, 409, JSON.stringify(x));
    assert.match(x.defect, /was withdrawn \(act \d+\)/);
    assert.equal(ledger(), before, "no line behind the withdrawal");
    assert.equal(position(mark, "sbx-bo"), 0);
    setEnv("W2_PEN", undefined);
  });
}

// ── R1 (Bevel's first review): a ledger change is read only once it has LANDED OR ROLLED BACK ──
//
// The REAL exec, paused at its own git commit by a pre-commit hook installed
// ONLY in this throwaway fixture repo, after the engine appended the line and
// before the landing. Released, the hook fails (the exec's own penTransaction
// then restores the ledger's exact bytes) or passes (the change lands). It
// fires once, then stands aside, so later commits in the same test land.

function landingGate({ fail }) {
  const dir = scratch("wld27-landing-");
  const ready = join(dir, "ready"), release = join(dir, "release"), used = join(dir, "used");
  const hook = join(FX.repo, ".git", "hooks", "pre-commit");
  writeFileSync(hook, `#!/bin/sh\n[ -f '${used}' ] && exit 0\n: > '${used}'\n: > '${ready}'\ni=0\nwhile [ ! -f '${release}' ] && [ "$i" -lt 300 ]; do sleep 0.1; i=$((i+1)); done\nexit ${fail ? 1 : 0}\n`, { mode: 0o755 });
  return {
    reached: () => existsSync(ready),
    release: () => writeFileSync(release, "release\n"),
    restore: () => writeFileSync(hook, "#!/bin/sh\nexit 0\n", { mode: 0o755 }),
  };
}

for (const pen of ["unflipped", "flipped"]) {
  test(`A · R1 (${pen} pen) — credit Bevel: a withdrawal cannot use an unstake that subsequently rolls back; it waits, reads the restored 2, and refuses`, { skip }, async () => {
    await seed(); setEnv("W2_PEN", pen === "flipped" ? "mark" : undefined);
    const mark = await plainMark(`unstake-rollback-${pen}`);
    assert.equal((await execStake("sbx-bo", mark, 2)).applied, 2);
    const before = ledger();
    const g = landingGate({ fail: true });
    let u, w;
    try {
      u = execUnstake("sbx-bo", mark, 2).then((x) => ({ x }), (e) => ({ e }));
      await until(() => g.reached(), "the real unstake exec to reach its landing");
      assert.equal(position(mark, "sbx-bo"), 0, "the working ledger reads a zero that has not landed");
      let settled = false;
      w = withdrawMarkViaOffice(world, { mark }, KEY_ANA).then((x) => ({ x }), (e) => ({ e })).finally(() => { settled = true; });
      await until(async () => settled || (await advisoryWaiters()) > 0, "the withdrawal to wait for the settled ledger (or, unguarded, to commit)");
      g.release();
      const un = await u;
      assert.equal(un.x?.error, "bounce", `the landing failed: ${JSON.stringify(un.x)}`);
      const answer = await w;
      assert.equal(ledger(), before, "the real failed exec rolled its unstake back");
      assert.equal(position(mark, "sbx-bo"), 2);
      assert.equal(answer.x, undefined, `no withdrawal against a zero that un-happened: ${JSON.stringify(answer.x)}`);
      assert.equal(answer.e?.code, 409);
      assert.match(answer.e.defect, /2✦ stand in escrow/);
      assert.equal((await q1("SELECT count(*)::int AS n FROM acts WHERE action = 'withdraw' AND object = $1", [mark]))[0].n, 0);
    } finally { g.release(); if (u) await u; if (w) await w; g.restore(); setEnv("W2_PEN", undefined); }
  });

  test(`A · R1 (${pen} pen) — an unstake that LANDS: the waiting withdrawal reads the settled 0 and withdraws`, { skip }, async () => {
    await seed(); setEnv("W2_PEN", pen === "flipped" ? "mark" : undefined);
    const mark = await plainMark(`unstake-lands-${pen}`);
    assert.equal((await execStake("sbx-bo", mark, 2)).applied, 2);
    const g = landingGate({ fail: false });
    try {
      const u = execUnstake("sbx-bo", mark, 2);
      await until(() => g.reached(), "the real unstake exec to reach its landing");
      let settled = false;
      const w = withdrawMarkViaOffice(world, { mark }, KEY_ANA).finally(() => { settled = true; });
      await until(async () => settled || (await advisoryWaiters()) > 0, "the withdrawal to wait for the landing");
      assert.equal(settled, false, "it waited for the landing rather than reading the half-landed zero");
      g.release();
      const un = await u;
      assert.ok(commitExists(un.commit), JSON.stringify(un));
      assert.equal((await w).withdrawn, true);
      assert.equal(position(mark, "sbx-bo"), 0);
    } finally { g.release(); g.restore(); setEnv("W2_PEN", undefined); }
  });
}

test("A · R1 — an ADMITTED stake whose landing fails is never counted: the waiting withdrawal reads the settled 0 and withdraws; the line is gone", { skip }, async () => {
  await seed();
  const mark = await plainMark("stake-that-unlands");
  const before = ledger();
  const g = landingGate({ fail: true });
  try {
    const st = execStake("sbx-bo", mark, 2);
    await until(() => g.reached(), "the real stake exec to reach its landing");
    assert.equal(position(mark, "sbx-bo"), 2, "the working ledger shows a stake that has not landed");
    let settled = false;
    const w = withdrawMarkViaOffice(world, { mark }, KEY_ANA).then((x) => ({ x }), (e) => ({ e })).finally(() => { settled = true; });
    await until(async () => settled || (await advisoryWaiters()) > 0, "the withdrawal to wait for the landing");
    g.release();
    assert.equal((await st).error, "bounce", "the stake's landing failed");
    const answer = await w;
    assert.equal(answer.x?.withdrawn, true, JSON.stringify(answer.e?.defect ?? answer.x));
    assert.equal(ledger(), before, "the stake's line rolled back");
    assert.equal(position(mark, "sbx-bo"), 0);
  } finally { g.release(); g.restore(); }
});

test("A · R1 — EXIT CLEANUP over an unstake that rolls back: the exit's reads wait for the settled ledger, return the restored 2 once, and only then mark the exit withdrawn", { skip }, async () => {
  await seed();
  const m = await droppedMark();
  const bal = balance("sbx-bo");
  assert.equal((await execStake("sbx-bo", m.mark, 2)).applied, 2);
  const g = landingGate({ fail: true });
  try {
    const u = execUnstake("sbx-bo", m.mark, 2).then((x) => ({ x }), (e) => ({ e }));
    await until(() => g.reached(), "the real unstake exec to reach its landing");
    assert.equal(position(m.mark, "sbx-bo"), 0, "a zero that has not landed");
    let settled = false;
    const exit = takeBack(m.record, await unitDeps(m.record)).finally(() => { settled = true; });
    await until(async () => settled || (await advisoryWaiters()) > 0, "the exit's read to wait for the settled ledger");
    g.release();
    await u;
    assert.equal(position(m.mark, "sbx-bo"), 2, "the failed landing restored Bo's stake");
    const out = await exit;
    const all = [...out.returns, ...(out.late_returns ?? [])];
    assert.deepEqual(all.map((r) => [r.handle, r.stamps]), [["sbx-bo", 2]], JSON.stringify(out));
    assert.ok(commitExists(all[0].commit));
    assert.equal(position(m.mark, "sbx-bo"), 0, "returned once, after the rollback, not lost to it");
    assert.equal(out.withdrawn?.withdrawn, true);
    assert.equal(balance("sbx-bo"), bal, "Bo holds exactly what he held before staking");
  } finally { g.release(); g.restore(); }
});

test("A · a withdrawn mark LEFT AGAIN stands, and is stakeable — the withdrawal refuses only while it is the mark's newest act", { skip }, async () => {
  await seed();
  const mark = await plainMark("left-again");
  assert.equal((await journalWithdraw({ by: "sbx-ana", slug: "left-again", household: "hh:sbx-ana" })).withdrawn, true);
  assert.equal((await execStake("sbx-bo", mark, 1)).code, 409);
  await q1(`INSERT INTO acts (at, crossing, actor, action, object, class, payload, household) VALUES (now(), $1, 'sbx-ana', 'leave-mark', $2, 'mark', '{"amend":true}', 'hh:sbx-ana')`, [currentCrossing(), mark]);
  const ok = await execStake("sbx-bo", mark, 1);
  assert.equal(ok.applied, 1, JSON.stringify(ok));
});

// ════════════════════════════════════════════════════════════════════════════
// B · the receipt is the engine's commit
// ════════════════════════════════════════════════════════════════════════════

test("B · INITIAL RETURNS carry each unstake's real commit and the applied count; the exit act records them", { skip }, async () => {
  await seed();
  const m = await droppedMark();
  const a = await execStake("sbx-ana", m.mark, 2), b = await execStake("sbx-bo", m.mark, 1);
  assert.deepEqual([a.applied, b.applied], [2, 1]);
  const out = await takeBack(m.record, await unitDeps(m.record));
  assert.deepEqual(out.returns.map((r) => [r.handle, r.stamps]), [["sbx-ana", 2], ["sbx-bo", 1]]);
  for (const r of out.returns) {
    assert.ok(commitExists(r.commit), `${r.handle}: ${r.commit}`);
    assert.match(commitSubject(r.commit), new RegExp(`^unstake: ${r.handle} <- world-mark/.+ · ${r.stamps}$`));
    assert.equal("line" in r, false, "no field the exec never answers");
  }
  assert.notEqual(out.returns[0].commit, out.returns[1].commit, "one commit per return");
  const act = (await unitActs()).find((x) => x.action === UNIT_ACTION.takeBack && x.object === m.mark);
  assert.deepEqual(act.payload.returns, out.returns, "the act records the receipts it answered");
});

test("B · CLIPPED and ZERO: a stale holder read asks for more than is open — the receipt says what the engine applied; a position already closed gets no receipt and no invented commit", { skip }, async () => {
  await seed();
  const m = await droppedMark();
  await execStake("sbx-ana", m.mark, 2); await execStake("sbx-bo", m.mark, 1);
  const stale = await (await unitDeps(m.record)).holders(m.mark);       // ana 2, bo 1, as read now
  await execUnstake("sbx-ana", m.mark, 1);                              // ana takes one back herself: 1 open
  await execUnstake("sbx-bo", m.mark, 1);                               // bo takes all of his: 0 open
  let reads = 0;
  const out = await takeBack(m.record, await unitDeps(m.record, { holders: async (id) => (reads++ === 0 ? stale.map((h) => ({ ...h })) : (await LIVE.holders(id))) }));
  assert.deepEqual(out.returns.map((r) => [r.handle, r.stamps]), [["sbx-ana", 1]], "clipped to the open 1, and Bo's closed position is no receipt");
  assert.ok(commitExists(out.returns[0].commit));
  assert.match(commitSubject(out.returns[0].commit), / · 1$/);
  assert.equal(position(m.mark, "sbx-ana") + position(m.mark, "sbx-bo"), 0);
});

test("B · PARTIAL FAILURE then CLEANUP RETRY: the first return lands with its commit, the second fails; the retry returns only the second, with its own commit — never the first twice", { skip }, async () => {
  await seed();
  const m = await droppedMark();
  await execStake("sbx-ana", m.mark, 2); await execStake("sbx-bo", m.mark, 1);
  let failBo = true;
  const deps = await unitDeps(m.record, { unstake: async (r) => (r.handle === "sbx-bo" && failBo ? (failBo = false, { error: "bounce", defect: "synthetic: the pen is busy" }) : LIVE.unstake(r)) });
  const e = await takeBack(m.record, deps).then(() => null, (x) => x);
  assert.equal(e?.code, 503, String(e?.defect));
  assert.deepEqual(e.returned.map((r) => r.handle), ["sbx-ana"]);
  assert.ok(commitExists(e.returned[0].commit), "the return that landed names its commit even inside the refusal");
  const out = await takeBack(m.record, deps);
  assert.deepEqual(out.returns.map((r) => [r.handle, r.stamps]), [["sbx-bo", 1]], "only the position still open");
  assert.ok(commitExists(out.returns[0].commit));
  assert.notEqual(out.returns[0].commit, e.returned[0].commit);
  assert.equal(balance("sbx-ana"), 40, "Ana got her 2 back once");
});

test("B · CLEANUP RETRY of a failed withdrawal whose late return failed: the retry's late return carries its real commit", { skip }, async () => {
  await seed();
  const m = await droppedMark();
  let failDee = true;
  const e = exitPausedAtAct(await unitDeps(m.record, { unstake: async (r) => (r.handle === "sbx-dee" && failDee ? (failDee = false, { error: "bounce", defect: "synthetic: the ledger could not be written" }) : LIVE.unstake(r)) }));
  let settled = false;
  const first = takeBack(m.record, e.deps).finally(() => { settled = true; });
  await e.at;
  const s = heldStake(m.mark, "sbx-dee", 2);
  await s.checked;
  e.go();
  await until(async () => settled || (await advisoryWaiters()) >= 1, "the exit to reach its late pass");
  s.release(); await s.done;
  const one = await first;
  assert.equal(one.withdrawn.withdrawn, false, "the late return failed, so the mark has not left");
  assert.equal(position(m.mark, "sbx-dee"), 2);
  const two = await takeBack(m.record, e.deps);
  assert.equal(two.duplicate, true);
  assert.deepEqual(two.late_returns.map((r) => [r.handle, r.stamps]), [["sbx-dee", 2]]);
  assert.ok(commitExists(two.late_returns[0].commit));
  assert.equal(two.withdrawn.withdrawn, true);
  assert.equal(position(m.mark, "sbx-dee"), 0);
});

test("A · the lock keys are per mark: another mark's stake never waits on this one", { skip }, async () => {
  assert.notEqual(markLockKey("sbx-cy/a-1"), markLockKey("sbx-cy/a-2"));
  assert.equal(markLockKey("sbx-cy/a-1"), "wld27-mark:sbx-cy/a-1");
});
