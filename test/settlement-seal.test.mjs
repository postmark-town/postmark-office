// settlement-seal.test.mjs — SAVE FIRST, THEN PAY, THEN SEAL, IN NUMBER ORDER (POS-1025/d, POS-1177/a).
//
//   node --test test/settlement-seal.test.mjs
//
// THE RULINGS. Darko 2026-11-21 21:17 EST, POS-1025/d: "Save first, then pay." Wright 02:20Z: "Before any stamps move, the
// settlement durably records what it decided, so a retry repeats the same removals. Each payback carries a town-owned once-only
// id. Stakers are paid at the same moment as today, and POS-1138's rule is unchanged." Wright 03:26Z: "the office seals the saved
// decisions in number order, so a blocked return holds the later seals until it clears"; "A held seal is a blocked settlement,
// and it alarms like one"; and the proof he asked for: "block one return, close two more windows, clear it, and see three seals
// in order with one return paid." Darko 2026-11-21 23:46 EST, POS-1177/a, "Yes, refuse them": between the decided removal and its
// seal the stake door refuses new stakes on the mark ("this mark is being removed at the next seal"); withdrawing still works.
//
// THE RIG is test/town-return.test.mjs's, for the same seam: a real Postgres (test/helpers/settlement-seed.mjs, S10 and S11
// sealed, the town's opposed word on bo/shed before S11), a stand-in World engine that returns whatever the town opposes with its
// subtree (WLD-203's shape), and a scratch town whose tools are the office's OWN pins (POS-1175's once-only writer at town
// 90c49b3a), with a test key. The writer is the real one: src/town-return.mjs § runTownReturn spawns town-return-exec.mjs under
// the flock and every mark's lock, which runs the pinned engine and lands the ledger. The stake door is the real exec
// (src/world-stake.mjs § runExec). The decisions are saved by the clearing's own statements (world-snapshot-seal.mjs §
// saveDecision, after § sealPrepare, at § NEXT_SETTLEMENT_SQL's number) and sealed by the crossing's own tool
// (world2/tools/settlement-seal.mjs § sealSaved). Nothing is pushed. Synthetic handles and marks.

process.env.TOWN_PINS_DIR = "";

import { after, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tempDir } from "./helpers/temp-dir.mjs";
import { pinnedTown } from "./helpers/pinned-town.mjs";
import { startStore } from "./helpers/embedded-store.mjs";
import { settlementRig, MARKS, git } from "./helpers/settlement-seed.mjs";
import { runTownReturn, townDate, removalOf } from "../src/town-return.mjs";
import { settlementTakesAway } from "../src/world-settlement.mjs";
import { sealPrepare, saveDecision, NEXT_SETTLEMENT_SQL } from "../world2/tools/world-snapshot-seal.mjs";
import { takeawaysBeforeSeal, PREVIOUS_LIST_SQL } from "../world2/tools/settlement-decides.mjs";
import { sealSaved, SealRefusal } from "../world2/tools/settlement-seal.mjs";
import { pendingRemovalOf } from "../src/mark-stake-lock.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const store = await startStore({ db: "settlement_seal_test" });
after(() => store.stop());
const skip = store.skip ?? false;
const { owner, asOffice, seed } = settlementRig(store);

// The stand-in engine: the town's word returns the mark with its declared children, whatever is staked on them.
const ENGINE = tempDir("settlement-seal-engine-");
mkdirSync(join(ENGINE, "tools"));
writeFileSync(join(ENGINE, "tools", "consent.mjs"), 'export const TOWN_WORDS = new Set(["neutral", "opposed"]);\nexport const STANCE_RETURNS_ALONE = true;\n');
writeFileSync(join(ENGINE, "tools", "marks-fold.mjs"), [
  "export function fold({ marks, townWords = null }) {",
  "  const opposed = new Set([...(townWords ?? new Map())].filter(([, w]) => w === 'opposed').map(([id]) => id));",
  "  const kids = (id) => marks.filter((m) => m.parent === id).map((m) => m.id);",
  "  const returned = [...opposed].sort().map((mark) => ({ mark, authority: 'the town (absolute)', returned_from: 'the-town', subtree: kids(mark), state: 'returned' }));",
  "  const away = new Set(returned.flatMap((r) => [r.mark, ...r.subtree]));",
  "  return { marks: marks.filter((m) => !away.has(m.id)).map((m) => ({ id: m.id, parent: m.parent ?? null })), parcels: [], returned };",
  "}", ""].join("\n"));
git(ENGINE, "init", "-q");
git(ENGINE, "-c", "user.name=t", "-c", "user.email=t@t", "add", ".");
git(ENGINE, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "stand-in engine: the town's return, WLD-203's shape");
const LAW = git(ENGINE, "rev-parse", "HEAD");

// The scratch town: the office's pinned tools, a test key, and a ledger the tests reset to (§ freshTown).
const SHED = "bo/shed", NAME = "bo/shed-name", BENCH = MARKS.bench.slug;
const TOWN = tempDir("settlement-seal-town-");
pinnedTown(TOWN);
mkdirSync(join(TOWN, "WHITE_PAGES"), { recursive: true });
const { privateKey } = generateKeyPairSync("ed25519");
const PEM = privateKey.export({ type: "pkcs8", format: "pem" });
const KEY = join(tempDir("settlement-seal-key-"), "stamp-key.pem");
writeFileSync(KEY, PEM);
execFileSync("git", ["init", "-q", "-b", "main", TOWN]);
const MINT = await import(pathToFileURL(join(TOWN, "tools", "stamp-mint.mjs")).href);
const STAKE = await import(pathToFileURL(join(TOWN, "tools", "world-stake.mjs")).href);
const commitTown = (m) => { git(TOWN, "add", "-A"); git(TOWN, "-c", "user.name=fixture", "-c", "user.email=fixture@test.invalid", "commit", "-q", "-m", m); };
MINT.appendSigned(TOWN, ["- 2026-06-12 · rules: stamps-v1"], PEM);
MINT.appendSigned(TOWN, ["bo", "ann", "cy", "dot"].map((handle) => MINT.giftLine({ date: "2026-09-01", handle, n: 20, slug: "seed", by: "the-town" })), PEM);
STAKE.worldStakeApply(TOWN, { handle: "bo", mark: SHED, n: 6, via: "api", date: "2026-10-02" }, PEM);
STAKE.worldStakeApply(TOWN, { handle: "ann", mark: SHED, n: 3, via: "api", date: "2026-10-02" }, PEM);
STAKE.worldStakeApply(TOWN, { handle: "cy", mark: SHED, n: 5, via: "api", date: "2026-10-02" }, PEM);
STAKE.worldStakeApply(TOWN, { handle: "cy", mark: NAME, n: 2, via: "api", date: "2026-10-02" }, PEM);
STAKE.worldStakeApply(TOWN, { handle: "dot", mark: BENCH, n: 4, via: "api", date: "2026-10-02" }, PEM);
commitTown("fixture town");
const FIXTURE = git(TOWN, "rev-parse", "HEAD");
const freshTown = () => { git(TOWN, "reset", "-q", "--hard", FIXTURE); git(TOWN, "clean", "-qfd"); };

const saved = {};
const setEnv = (k, v) => { if (!(k in saved)) saved[k] = process.env[k]; if (v === undefined) delete process.env[k]; else process.env[k] = v; };
setEnv("TOWN_CLONE", TOWN);
setEnv("STAMP_KEY", KEY);
setEnv("TOWN_LOCK", join(tempDir("settlement-seal-lock-"), "town.lock"));
setEnv("BOT_NAME", "fixture"); setEnv("BOT_EMAIL", "fixture@test.invalid");
setEnv("TOWN_PUSH", undefined); setEnv("STAMP_LINES", undefined); setEnv("SETTLEMENT_DRY", undefined);
setEnv("TOWN_TZ", "America/New_York");
if (!skip) { setEnv("WORLD2_PG", "1"); setEnv("WORLD2_PG_URL", store.url("office_api")); } // the execs hold each mark's lock in the store
after(() => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });
const { runExec } = await import("../src/world-stake.mjs");   // after TOWN_CLONE: the stake door's exec, as the office runs it

const ledger = () => readFileSync(join(TOWN, "WHITE_PAGES", "stamp-ledger.md"), "utf8");
const returnLines = (n) => (ledger().match(new RegExp(` · for: town-return:S${n} · sig: `, "g")) ?? []).length;
const open = () => { const o = new Map(); for (const [k, n] of STAKE.worldStakeState(TOWN).positions) if (n > 0) { const m = k.slice(0, k.lastIndexOf("|")); o.set(m, (o.get(m) ?? 0) + n); } return o; };
const read = (sql, args = []) => owner(async (c) => (await c.query(sql, args)).rows);
const asClearing = async (fn) => { const c = await store.connect("clearing_job"); try { return await fn(c); } finally { await c.end(); } };

// The shed and its name stand in the store, as the cutover's store holds them, so the clearing's statements see them.
const standing = (c) => c.query(
  `INSERT INTO marks (id, slug, kind, owner, household, body, geometry, bbox, status, locked_window, data) VALUES
     ($1, $2, 'sited', 'bo', 'hh:bo', 'A shed.', $3, '((3,3),(7,7))'::box, 'standing', 501, '{"date":"2026-10-01T00:00:00Z"}'),
     ($4, $5, 'naming', 'bo', 'hh:bo', 'The Lean-To.', NULL, NULL, 'standing', 501, $6)`,
  [randomUUID(), SHED, JSON.stringify({ at: { x: 5, y: 5 }, extent: { w: 4, h: 4 } }), randomUUID(), NAME, JSON.stringify({ date: "2026-10-01T00:00:01Z", name: "The Lean-To", parent_id: SHED })]);
const TOWN_WORD = async () => ({ actor: (await import("../src/town-stance.mjs")).TOWN_SPEAKER, on: SHED, stance: "opposed", as: "town" });
async function setUp() {
  freshTown();
  await seed({ lawSha: LAW, cutover: "S10", sealWords: [await TOWN_WORD()], before: async (c) => {
    await c.query("TRUNCATE marks CASCADE");
    await standing(c);
  } });
  // the rig sealed S10 and S11 under explicit ids: the sequence moves past them, as a clearing's own seals would have
  await owner((c) => c.query("SELECT setval('world_snapshots_id_seq', (SELECT max(id) FROM world_snapshots))"));
}

/**
 * CLOSE A WINDOW AS THE CLEARING'S STEP 8 DOES: in one clearing_job transaction, the versions and lists (§ sealPrepare), the
 * number (§ NEXT_SETTLEMENT_SQL, counting the saved decisions), and the decision saved with its removal's day and town returns.
 */
async function closeWindow(win, { townReturns = null, at }) {
  // the candle tiles time: each window opens where the one before it closed
  await owner((c) => c.query(
    `INSERT INTO windows (id, opens_at, closes_at, status, cleared_at)
     SELECT $1, closes_at, closes_at + interval '12 hours', 'closed', closes_at + interval '12 hours' FROM windows WHERE id = $1 - 1
     ON CONFLICT (id) DO NOTHING`, [win]));
  return asClearing(async (c) => {
    const q = (t, a) => c.query(t, a);
    await q("BEGIN");
    try {
      const prepared = await sealPrepare(q);
      const { rows: [{ next }] } = await q(NEXT_SETTLEMENT_SQL);
      const held = townReturns ? townReturns.flatMap((r) => r.leaving.map((slug) => ({ slug, held: "town-return", mark: r.mark }))) : null;
      const d = await saveDecision(q, { windowId: win, stances: null, settlement: Number(next), held, day: townDate(new Date(at)), townReturns, at, prepared });
      await q("COMMIT");
      return d;
    } catch (e) { await q("ROLLBACK"); throw e; }
  });
}
const RETURNS = [{ mark: SHED, leaving: [SHED, NAME] }];
const writer = (env = process.env) => (a) => runTownReturn(a, { townClone: TOWN, env });
/** The crossing's seal step over the clearing pen; `failSealOnce` makes the first header write fail, after the payment. */
const crossing = ({ through = 999, write = writer(), failSealOnce = false } = {}) => asClearing((c) => {
  let failed = !failSealOnce;
  const client = { query: (t, a) => {
    if (!failed && /INSERT INTO world_snapshots/.test(t)) { failed = true; return Promise.reject(new Error("the store went away mid-seal")); }
    return c.query(t, a);
  } };
  return sealSaved(client, { through, townClone: TOWN, write });
});
const decisionOf = async (win) => (await read("SELECT settlement, day::text AS day, header, town_returns, decided_at FROM settlement_decisions WHERE window_id = $1", [win]))[0];
const sealOf = async (win) => (await read("SELECT * FROM world_snapshots WHERE window_id = $1", [win]))[0];

// ─────────────────────────── port 5: the removal, decided before the seal ────────────────────────────────

test("PORT 5 · THE TOWN'S RETURN IS DECIDED BEFORE THE SEAL: the shed and its name are held by it, its targets saved to pay, and nothing is paid or read of the ledger", { skip }, async () => {
  await setUp();
  const before = ledger();
  const header = (await read("SELECT * FROM world_snapshots WHERE id = 2"))[0];
  const taken = await asClearing(async (c) => {
    const q = (t, a) => c.query(t, a);
    return takeawaysBeforeSeal(q, await settlementTakesAway({ query: q }, { ...header, settlement: 11 }, { worldRepo: ENGINE, townRepo: TOWN, decide: true }));
  });
  assert.deepEqual([...taken.held.values()], [
    { slug: SHED, held: "town-return", mark: SHED },
    { slug: NAME, held: "town-return", mark: SHED },
  ], "both leave with the town's return: held by the seal, never printed or registered, their store rows kept");
  assert.deepEqual(taken.townReturns, RETURNS, "the return the settlement crossing pays");
  assert.equal(ledger(), before, "deciding pays nobody");
  // the fold that cannot run holds w48's fallback (the over-limit forecasts), and says so
  const blind = await asClearing((c) => takeawaysBeforeSeal((t, a) => c.query(t, a), null, { unread: "no engine" }));
  assert.deepEqual(blind.townReturns, []);
  assert.equal(blind.account.unread, "no engine");
});

test("PORT 5 · THE CLEARING ITSELF SAVES THE REMOVAL: clearing-job closes the window with the town's return decided, held in the saved header and its targets saved to pay; nothing is paid or sealed", { skip }, async () => {
  await setUp();
  await owner(async (c) => {
    // window 502 tiles on from 501 and is due; the store's heads name the stand-in engine's law, as the box's ingest would
    await c.query(`INSERT INTO windows (id, opens_at, closes_at, status) SELECT 502, closes_at, closes_at + interval '12 hours', 'open' FROM windows WHERE id = 501`);
    await c.query(`INSERT INTO projection_heads (repo, sha, ingested_at) VALUES ('world-law', $1, now()), ('town', $2, now()), ('world-marks', $1, now())
                   ON CONFLICT (repo) DO UPDATE SET sha = EXCLUDED.sha`, [LAW, "a".repeat(40)]);
  });
  const before = ledger();
  const r = spawnSync(process.execPath, [join(ROOT, "world2", "tools", "clearing-job.mjs"), "--window", "502", "--world-repo", ENGINE], {
    cwd: ROOT, encoding: "utf8",
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, WORLD2_CLEARING_URL: store.url("clearing_job"), TOWN_STANCE_CUTOVER: "S10", TOWN_TZ: "America/New_York" },
  });
  const out = `${r.stdout}\n${r.stderr}`;
  assert.equal(r.status, 0, out);
  assert.match(out, /⚑ held: bo\/shed — taken away by the settlement \(town-return\); not published, its store row kept/);
  assert.match(out, /⚑ town return: bo\/shed \(\d mark\(s\)\) is S12's removal, saved for the settlement crossing to pay on \d{4}-\d{2}-\d{2}/);
  const d = await decisionOf(502);
  assert.equal(d.settlement, 12);
  assert.deepEqual(d.town_returns.map((x) => x.mark), [SHED], "the return its removal pays");
  assert.ok(d.header.held.some((h) => h.slug === SHED && h.held === "town-return"), "held by the seal it will be");
  assert.equal(await sealOf(502), undefined, "saved, not sealed");
  assert.equal(ledger(), before, "the clearing pays nobody: it holds no town pen");
  const [{ status }] = await read("SELECT status FROM marks WHERE slug = $1", [SHED]);
  assert.equal(status, "standing", "its store row is kept");
});

// ─────────────────────────── /d: pay, a failed seal, the retry ────────────────────────────────────────────

test("PAY → FAILED SEAL → RETRY ACROSS MIDNIGHT AND A LIVE-INPUT CHANGE: one return, under the saved S and day; the retry pays nobody, names the first, and seals the saved header", { skip }, async () => {
  await setUp();
  // decided one minute before midnight, town time: the removal's day is the 2nd, whatever day the retry runs on
  const d = await closeWindow(502, { townReturns: RETURNS, at: "2026-10-03T03:59:00Z" });
  assert.equal(d.settlement, 12, "past S11, the store's newest");
  assert.equal(d.day, "2026-10-02");
  // 1 · paid, then the header write fails: the crossing refuses by name; the stamps are home, the decision stands, nothing sealed
  await assert.rejects(crossing({ failSealOnce: true }), (e) => e instanceof SealRefusal && /S12 \(window 502\) could not be sealed: the store went away mid-seal/.test(e.detail));
  assert.equal(returnLines(12), 4, "the stakers were paid: ann 3, bo 4, cy 5, and cy 2 on the name");
  assert.equal(open().get(SHED), undefined);
  assert.equal(await sealOf(502), undefined, "not sealed");
  assert.deepEqual(await decisionOf(502).then((x) => [x.settlement, x.day, x.header.digest]), [12, "2026-10-02", d.header.digest], "the decision is as it was saved");
  // 2 · the world moves on: the town opposes another mark, and the clock is weeks past the removal's day (today)
  await owner(async (c) => c.query("INSERT INTO acts (at, actor, action, object, class, payload, household) VALUES (now(), $1, 'declare-stance-on', $2, 'stance', $3, $1)",
    [(await import("../src/town-stance.mjs")).TOWN_SPEAKER, BENCH, JSON.stringify({ stance: "opposed", as: "town" })]));
  assert.notEqual(townDate(new Date()), d.day, "the retry runs on another day than the removal's");
  // 3 · the retry: the same decision, the same S and day, the town's once-only answer naming the first, then the saved header
  const out = await crossing();
  assert.equal(out.status, "sealed", JSON.stringify(out));
  const [s] = out.sealed;
  assert.equal(s.settlement, 12);
  assert.equal(s.town_return.removal, "S12");
  assert.equal(s.town_return.date, "2026-10-02", "the SAVED day, never the retry's clock (another day would be the town's 409)");
  assert.equal(s.town_return.already_returned, true);
  assert.equal(s.town_return.id, "town-return:S12");
  assert.equal(s.town_return.first.id, "town-return:S12", "the repeat names the first");
  assert.equal(s.town_return.first.total, 16);
  assert.deepEqual(s.town_return.returned, [], "and pays nobody");
  assert.equal(returnLines(12), 4, "ONE return in the ledger");
  const h = await sealOf(502);
  assert.equal(h.sealed_settlement, 12, "the final seal is the removal the return names");
  assert.equal(removalOf(h.sealed_settlement), s.town_return.removal);
  assert.equal(h.digest, d.header.digest, "the saved header, not one re-read after the town spoke again");
  assert.equal(new Date(h.taken_at).toISOString(), "2026-10-03T03:59:00.000Z", "sealed as of its decision");
  assert.deepEqual(h.held.map((x) => x.slug), [SHED, NAME]);
  // 4 · and again: a sealed decision is not paid or sealed twice
  const again = await crossing();
  assert.equal(again.status, "nothing-to-seal");
  assert.equal(returnLines(12), 4);
});

// ─────────────────────────── POS-1177/a: no new stake on a mark being removed ──────────────────────────────

test("POS-1177/a · THE STAKE DOOR REFUSES A NEW STAKE WHILE THE SAVED REMOVAL AWAITS ITS SEAL, under the lock, in the ruling's words; withdrawing still works; after the seal the rule is gone", { skip }, async () => {
  await setUp();
  await closeWindow(502, { townReturns: RETURNS, at: "2026-10-03T06:00:00Z" });
  const before = ledger();
  for (const mark of [SHED, NAME]) {
    const r = await runExec({ verb: "stake", handle: "dot", mark, n: 1, date: "2026-10-03" });
    assert.equal(r.code, 409, JSON.stringify(r));
    assert.match(r.defect, /^this mark is being removed at the next seal \(".+", S12\)$/);
    assert.match(r.hint, /Withdrawing a stake you already hold still works\. Nothing was staked/);
  }
  assert.equal(ledger(), before, "no line written");
  const back = await runExec({ verb: "unstake", handle: "ann", mark: SHED, n: 1, date: "2026-10-03" });
  assert.equal(back.applied, 1, `an existing stake comes home: ${JSON.stringify(back)}`);
  const elsewhere = await runExec({ verb: "stake", handle: "dot", mark: BENCH, n: 1, date: "2026-10-03" });
  assert.equal(elsewhere.applied, 1, "a mark no removal takes is staked as ever");
  // the return pays every stake there is, the gate reads them home, and the seal lands
  const out = await crossing();
  assert.equal(out.status, "sealed", JSON.stringify(out));
  assert.equal(out.sealed[0].town_return.total, 15, "ann's 2 left, bo 4, cy 5 and 2: everything that stood");
  assert.equal(await asOffice((c) => pendingRemovalOf(c, SHED)), null, "sealed: no longer pending");
  const later = await runExec({ verb: "stake", handle: "dot", mark: SHED, n: 1, date: "2026-10-04" });
  assert.equal(later.applied, 1, "POS-1177's refusal covers only the wait for the seal");
});

test("POS-1177/a · THE QUESTION IS ASKED INSIDE THE LOCK BOUNDARY: the exec holds the town flock and the mark's lock, asks before the engine runs, and the return writes under the same flock and locks", () => {
  const exec = readFileSync(join(ROOT, "src", "world-stake-exec.mjs"), "utf8");
  const held = exec.indexOf("withMarkHeld(payload.mark");
  const asked = exec.indexOf("stakeRefusalUnderLock(client, payload.mark)");
  const engine = exec.indexOf("worldStakeApply(CLONE");
  assert.ok(held > 0 && held < asked && asked < engine, "the mark's lock, then the question, then the engine");
  const lock = readFileSync(join(ROOT, "src", "mark-stake-lock.mjs"), "utf8");
  assert.match(lock, /export async function stakeRefusalUnderLock[\s\S]*?pendingRemovalOf\(client, id\)/, "the stake's question asks the pending removal");
  const door = readFileSync(join(ROOT, "src", "world-stake.mjs"), "utf8");
  assert.match(door, /execUnderTownLock\(exec, JSON\.stringify\(payload\), env\)/, "the exec runs under the town flock");
  const ret = readFileSync(join(ROOT, "src", "town-return-exec.mjs"), "utf8");
  assert.match(ret, /withMarksHeld\(marks, \(\) => penTransaction/, "and the return lands under every mark's lock");
});

// ─────────────────────────── 03:26Z: blocked, and the catch-up in order ────────────────────────────────────

test("BLOCKED, THEN CAUGHT UP IN ORDER: one return blocked, two more windows close, the return clears, and three seals land in number order, each its own frozen header, with one return paid", { skip }, async () => {
  await setUp();
  const d12 = await closeWindow(502, { townReturns: RETURNS, at: "2026-10-03T06:00:00Z" });
  // 1 · BLOCK IT: the pen has no key, so the return does not land and the gate holds it (stamps still stand)
  const nokey = { ...process.env, STAMP_KEY: join(tempDir("settlement-seal-nokey-"), "absent.pem") };
  const blocked = await crossing({ write: writer(nokey) });
  assert.equal(blocked.status, "blocked");
  assert.deepEqual(blocked.sealed, []);
  const b = blocked.blocked;
  assert.deepEqual([b.settlement, b.window, b.removal, b.day], [12, 502, "S12", "2026-10-03"]);
  assert.match(b.reason, /^the town's return did not land \(409: not-yet-open\), so its stamps are not home$/);
  assert.deepEqual(b.held[0].stakers, { [SHED]: [{ handle: "ann", n: 3 }, { handle: "bo", n: 6 }, { handle: "cy", n: 5 }], [NAME]: [{ handle: "cy", n: 2 }] },
    "the receipt names who holds the stamps");
  assert.equal(returnLines(12), 0, "nothing paid");
  // 2 · TWO MORE WINDOWS CLOSE (the candle never waits): numbered past the saved S12, each based on the decision before it
  await owner((c) => c.query("UPDATE households SET name = 'Rabbit, renamed after S12 was decided' WHERE true"));
  const d13 = await closeWindow(503, { at: "2026-10-03T18:00:00Z" });
  await owner((c) => c.query("UPDATE marks SET body = 'A bench, painted after S13 was decided.' WHERE slug = $1", [SHED]));
  const d14 = await closeWindow(504, { at: "2026-10-04T06:00:00Z" });
  assert.deepEqual([d13.settlement, d14.settlement], [13, 14], "numbering includes the saved decisions");
  assert.notEqual(d14.header.marks_digest, d13.header.marks_digest, "S14 saw the store as it was when its window closed");
  const prev = await asClearing((c) => c.query(PREVIOUS_LIST_SQL, [504, [SHED]]));
  assert.deepEqual(prev.rows.map((r) => r.slug), [SHED], "the previous state of window 504 is S13's saved list, not the last SEALED one");
  assert.equal(JSON.parse(prev.rows[0].row).body, "A shed.", "as S13 decided it");
  // still blocked: nothing seals past S12
  const still = await crossing({ write: writer(nokey) });
  assert.equal(still.status, "blocked");
  assert.deepEqual(still.waiting, [{ window: 503, settlement: 13 }, { window: 504, settlement: 14 }]);
  assert.deepEqual(await read("SELECT window_id FROM world_snapshots WHERE window_id >= 502"), [], "no seal lands out of order");
  // 3 · CLEARED: the key is back; the same decision pays once, and all three seal in number order
  const out = await crossing();
  assert.equal(out.status, "sealed", JSON.stringify(out));
  assert.deepEqual(out.sealed.map((s) => [s.window, s.settlement]), [[502, 12], [503, 13], [504, 14]]);
  assert.equal(out.sealed[0].town_return.already_returned, false);
  assert.equal(out.sealed[0].town_return.total, 16);
  assert.equal(out.sealed[1].town_return, undefined); assert.equal(out.sealed[2].town_return, undefined);
  assert.equal(returnLines(12), 4, "one return paid");
  assert.equal(returnLines(13) + returnLines(14), 0);
  for (const [win, d] of [[502, d12], [503, d13], [504, d14]]) {
    const h = await sealOf(win);
    assert.deepEqual([h.sealed_settlement, h.digest, h.marks_digest, h.register_digest, new Date(h.taken_at).toISOString()],
      [d.settlement, d.header.digest, d.header.marks_digest, d.header.register_digest, new Date(d.decided_at).toISOString()],
      `window ${win}: its own frozen header`);
  }
});

test("SEALS LAND ONLY IN NUMBER ORDER: the store refuses a later decision's seal while an earlier one waits", { skip }, async () => {
  await setUp();
  await closeWindow(502, { townReturns: RETURNS, at: "2026-10-03T06:00:00Z" });
  await closeWindow(503, { at: "2026-10-03T18:00:00Z" });
  const { sealDecision } = await import("../world2/tools/world-snapshot-seal.mjs");
  await assert.rejects(asClearing(async (c) => {
    await c.query("BEGIN");
    try { return await sealDecision((t, a) => c.query(t, a), { windowId: 503 }); } finally { await c.query("ROLLBACK"); }
  }), (e) => e.reason === "out-of-order" && /S13 \(window 503\) waits for S12 \(window 502\)/.test(e.message));
});
