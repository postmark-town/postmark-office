// parcel-room-nonce.test.mjs — A ROOM PURCHASE'S RETRY KEY (POS-939).
//
//   node --import ./test/helpers/sparse-guard.mjs --test test/parcel-room-nonce.test.mjs
//
// RULED (Wright 2026-11-13 15:2x EST, on Darko's ruling): "buy-parcel-room joins
// the office's act nonce, so a retry after a lost answer can't buy a second
// room." POS-762's promise, which nothing held: "a retry after a lost answer
// reads as a second purchase, and only a caller field (`room: 2`, or a nonce)
// can tell them apart".
//
// The door and the exec are the real ones (src/parcel-room.mjs,
// src/parcel-room-exec.mjs); the key is kept on a REAL Postgres with every
// schema file applied, because 096's primary key and its grants exist only there
// ("a round trip through a JS stub is not a round trip through Postgres"). The
// town is a stand-in engine in the town's grammar, as parcel-room.test.mjs's is.
//
//   1. a retry after a lost answer answers the first purchase's receipt: one
//      burn, one room, the first price, across handlers that share no memory;
//      and its control, the same retry without a nonce, buys a second room
//   2. two overlapping calls with one nonce, in two handlers that share no
//      in-flight map, burn once; two calls racing past the lookup keep one key
//   3. isolation: another house's same nonce is its own purchase, and the same
//      word kept for another action answers nothing here (nor this key there)
//   4. the boundary: a key the store cannot read or keep refuses with nothing
//      burned; a key kept with no burn never answers "bought", and its retry
//      makes the purchase once; a key whose room another resident bought refuses
//   5. preview, an entry refusal and the field's judgement: no key is kept by
//      a call that buys nothing, and the household door takes the field
//
// The lock: on Windows the exec runs without flock (town-lock.mjs § useFlock),
// so the stand-in engine models it in § 2, as parcel-room.test.mjs § 11 does: the
// first exec holds after its line is on disk and before its commit, and a later
// exec reads the ledger only after the test says the first has answered.

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";

const { startStore } = await import("./helpers/embedded-store.mjs");
const { __setPoolForTest } = await import("../src/world2-pen.mjs");
const { keptNonce, spentWorldNonce } = await import("../src/act-nonce.mjs");
const { keepRoomKey, roomKeyKept, ROOM_NONCE_IDEMPOTENT } = await import("../src/parcel-room.mjs");
// TWO HANDLERS THAT SHARE NO MEMORY: the door's module, loaded twice, so each has
// its own in-flight map (parcel-room.mjs § THE PURCHASES IN FLIGHT). Only the
// store and the ledger stand between them.
const doorA = (await import("../src/parcel-room.mjs?handler=a")).buyParcelRoomViaOffice;
const doorB = (await import("../src/parcel-room.mjs?handler=b")).buyParcelRoomViaOffice;

const store = await startStore({ db: "parcel_room_nonce" });
const { default: pg } = await import("pg");
const pool = new pg.Pool({ connectionString: store.url("office_api") });
__setPoolForTest(pool);
after(async () => { __setPoolForTest(null); await pool.end(); await store.stop(); });

const owner = async (sql, params = []) => {
  const c = await store.connect("world2_owner");
  try { return (await c.query(sql, params)).rows; } finally { await c.end(); }
};
const keysKept = () => owner("SELECT household, nonce, handle, nth FROM parcel_room_nonces ORDER BY kept_at, household, nonce");
const fresh = () => owner("TRUNCATE parcel_room_nonces");

// ── the stand-in town ────────────────────────────────────────────────────────
const PARCEL = /^- (\d{4}-\d{2}-\d{2}) · (\S+) → BURN · (\d+) · for: parcel:([23])\/(\S+)$/;
const classifyEntry = (c) => {
  const m = PARCEL.exec(c);
  return m ? { kind: "parcel-burn", date: m[1], handle: m[2], n: Number(m[3]), nth: Number(m[4]), household: m[5] } : { kind: "unknown" };
};
const townEngine = {
  PARCEL_PRICE: 50, PARCEL_SETTLED_BY_DAY: "2026-10-31", PARCEL_ROOM_FROM: "2026-11-01",
  parcelBurnLine: ({ date, handle, n, nth, household }) => `- ${date} · ${handle} → BURN · ${n} · for: parcel:${nth}/${household}`,
  parseLaws: () => ({ laws: [], revisions: [] }),
  meepChecker: () => () => false,
  foldBalances: (entries) => {
    const m = new Map();
    for (const { canonical: c } of entries) {
      const mint = /MINT → (\S+) · (\d+)/.exec(c); if (mint) m.set(mint[1], (m.get(mint[1]) ?? 0) + Number(mint[2]));
      const burn = /^- \S+ · (\S+) → BURN · (\d+)/.exec(c); if (burn) m.set(burn[1], (m.get(burn[1]) ?? 0) - Number(burn[2]));
    }
    return m;
  },
};
const REGISTRY = { households: {
  "the-rowan": { accounts: [{ login: "rowan-gh", id: 101 }], residents: ["ash", "birch", "cedar"], since: "2026-11-02", formerly: ["rowan-house"] },
  "the-elm": { accounts: [{ login: "elm-gh", id: 103 }], residents: ["elm"], since: "2026-11-02" },
} };
const PAUSE = "PARCEL_ROOM_NONCE_TEST_PAUSE_DIR";

function standInTown({ purse = 200 } = {}) {
  const town = mkdtempSync(join(tmpdir(), "parcel-room-nonce-"));
  mkdirSync(join(town, "tools"), { recursive: true });
  mkdirSync(join(town, "WHITE_PAGES"), { recursive: true });
  writeFileSync(join(town, "tools", "households.json"), JSON.stringify(REGISTRY));
  writeFileSync(join(town, "tools", "stamp-mint.mjs"), [
    "import { appendFileSync, existsSync, writeFileSync } from 'node:fs';",
    "import { join } from 'node:path';",
    `const PARCEL = ${PARCEL};`,
    `export const classifyEntry = ${classifyEntry.toString()};`,
    // THE LOCK, MODELLED (§ 2). With <PAUSE> set: the first exec to append holds
    // after its line is on disk, before its commit, until a second call has read
    // the ledger (`entered`: its door's entry quote, or its exec); an exec that is
    // not the first reads the ledger only once the test says the first answered.
    "const IN_EXEC = String(process.argv[1] ?? '').endsWith('parcel-room-exec.mjs');",
    `const pause = () => process.env.${PAUSE};`,
    "const nap = new Int32Array(new SharedArrayBuffer(4));",
    "const waitFor = (f) => { const t0 = Date.now(); while (!existsSync(f) && Date.now() - t0 < 20000) Atomics.wait(nap, 0, 0, 20); };",
    "let iHeld = false;",
    "export const parseStampLedger = (text) => {",
    "  const p = pause();",
    "  if (p && !iHeld && existsSync(join(p, 'paused'))) {",
    "    writeFileSync(join(p, 'entered'), 'entered');",
    "    if (IN_EXEC) waitFor(join(p, 'answered'));",
    "  }",
    "  return text.split(/\\r?\\n/).filter((l) => l.startsWith('- ')).map((l) => ({ canonical: l.replace(/ · sig: \\S+$/, '') }));",
    "};",
    "export const appendSigned = (clone, lines) => {",
    "  appendFileSync(join(clone, 'WHITE_PAGES', 'stamp-ledger.md'), lines.map((l) => l + ' · sig: x\\n').join(''));",
    "  const p = pause();",
    "  if (p && IN_EXEC && !existsSync(join(p, 'paused'))) { iHeld = true; writeFileSync(join(p, 'paused'), 'paused'); waitFor(join(p, 'entered')); }",
    "};",
    ...Object.entries(townEngine).map(([k, v]) => `export const ${k} = ${typeof v === "function" ? v.toString() : JSON.stringify(v)};`),
    "export const householdKeys = () => new Map([['ash', { key: 'gh:101' }], ['birch', { key: 'gh:101' }], ['cedar', { key: 'gh:101' }], ['elm', { key: 'gh:103' }]]);",
  ].join("\n"));
  writeFileSync(join(town, "WHITE_PAGES", "stamp-ledger.md"), "# stamp-ledger\n\n"
    + ["ash", "birch", "elm"].map((h) => `- 2026-10-20 · MINT → ${h} · ${h === "ash" ? purse : 200} · for: gift:seed · by: keemin · sig: x`).join("\n") + "\n");
  writeFileSync(join(town, ".gitignore"), "stamp-key.pem\n");
  writeFileSync(join(town, "stamp-key.pem"), "stand-in: the stand-in engine signs nothing\n");
  execFileSync("git", ["init", "-q"], { cwd: town });
  execFileSync("git", ["add", "-A"], { cwd: town });
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "fixture"], { cwd: town });
  return town;
}
const burnsIn = (town) => readFileSync(join(town, "WHITE_PAGES", "stamp-ledger.md"), "utf8").split("\n")
  .filter((l) => l.includes("for: parcel:")).map((l) => l.replace(/ · sig: \S+$/, ""));
const commitsIn = (town) => Number(execFileSync("git", ["-C", town, "rev-list", "--count", "HEAD"], { encoding: "utf8" }).trim());

/** Run `fn` with the exec's env set (the stand-in key, a lock file outside the town, no push), restoring it after. */
async function withExecEnv(town, extra, fn) {
  const lockDir = mkdtempSync(join(tmpdir(), "parcel-room-nonce-lock-"));
  const set = { STAMP_KEY: join(town, "stamp-key.pem"), BOT_NAME: "t", BOT_EMAIL: "t@t", TOWN_PUSH: undefined, TOWN_LOCK: join(lockDir, "town.lock"), ...extra };
  const saved = Object.fromEntries(Object.keys(set).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(set)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  try { return await fn(); }
  finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    rmSync(lockDir, { recursive: true, force: true });
  }
}

// A world whose newest blessing carries the parcel law, so the door opens (parcel-room.test.mjs § 11, F2).
function lawWorld() {
  const repo = mkdtempSync(join(tmpdir(), "parcel-room-nonce-world-"));
  mkdirSync(join(repo, "tools"), { recursive: true });
  const g = (...a) => execFileSync("git", a, { cwd: repo, encoding: "utf8" });
  g("init", "-q", "-b", "main");
  writeFileSync(join(repo, "tools", "marks-fold.mjs"), "export const PARCEL_CLAIM_CAP = 3;\nexport function parcelRoomOf() { return 3; }\n");
  g("add", "-A"); g("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "law"); g("tag", "settlement/S1");
  return repo;
}
const LAW_WORLD = lawWorld();
process.on("exit", () => rmSync(LAW_WORLD, { recursive: true, force: true }));

const ROWAN = { household: "the-rowan", handles: new Set(["ash", "birch"]) };
const ELM = { household: "the-elm", handles: new Set(["elm"]) };
const on = (date) => ({ worldClone: LAW_WORLD, date });
const ROOM_2 = "- 2026-11-03 · ash → BURN · 50 · for: parcel:2/hh:the-rowan";
const ROOM_3 = (date) => `- ${date} · ash → BURN · 100 · for: parcel:3/hh:the-rowan`;

// ── 1 · the lost answer ──────────────────────────────────────────────────────

test("1 · a retry after a lost answer answers the first purchase's receipt: one burn, one room, the first price, in a handler that never saw the first call", async () => {
  await fresh();
  const town = standInTown();
  try {
    const first = await withExecEnv(town, {}, () => doorA(town, { from: "ash", nonce: "room-1" }, ROWAN, on("2026-11-03")));
    assert.equal(first.error, undefined, JSON.stringify(first));
    assert.deepEqual([first.did, first.duplicate, first.room, first.price, first.line], ["buy-parcel-room", undefined, { now: 1, after: 2 }, 50, ROOM_2]);
    const commits = commitsIn(town);
    // The answer is lost. The retry comes the next day, to the OTHER handler (its in-flight map never held the first),
    // when the entry quote would sell room 3 at 100.
    const retry = await withExecEnv(town, {}, () => doorB(town, { from: "ash", nonce: "room-1" }, ROWAN, on("2026-11-04")));
    assert.equal(retry.error, undefined, JSON.stringify(retry));
    assert.deepEqual(burnsIn(town), [ROOM_2], `one burn, one room: the retry bought nothing. It answered: ${JSON.stringify(retry)}`);
    assert.equal(commitsIn(town), commits, "and committed nothing");
    assert.deepEqual([first.nonce, first.idempotent], ["room-1", ROOM_NONCE_IDEMPOTENT], "the first answer said its nonce holds");
    assert.deepEqual(await keysKept(), [{ household: "the-rowan", nonce: "buy-parcel-room:room-1", handle: "ash", nth: 2 }],
      "the key names the purchase, spelled as the world door spells a kept nonce");
    assert.deepEqual([retry.did, retry.duplicate, retry.nonce, retry.handle, retry.household, retry.room, retry.price, retry.line, retry.date],
      ["buy-parcel-room", true, "room-1", "ash", "the-rowan", { now: 1, after: 2 }, 50, ROOM_2, "2026-11-03"],
      "the FIRST purchase's receipt, read off its line: its room, its price, its day — never today's quote");
    assert.match(retry.note, /^the purchase this nonce names is on the town's ledger: ash bought room for the-rowan's parcel 2 \(50 stamps\).*NOTHING WAS BURNED A SECOND TIME/);
    const again = await withExecEnv(town, {}, () => doorA(town, { from: "ash", nonce: "room-1" }, ROWAN, on("2026-11-05")));
    assert.deepEqual([again.duplicate, again.price, burnsIn(town).length, (await keysKept()).length], [true, 50, 1, 1], "and every retry after it");
  } finally { rmSync(town, { recursive: true, force: true }); }
});

test("1 · control: the same retry WITHOUT a nonce is a second purchase — room 3 at 100 — the failure POS-939 closes", async () => {
  await fresh();
  const town = standInTown();
  try {
    const first = await withExecEnv(town, {}, () => doorA(town, { from: "ash" }, ROWAN, on("2026-11-03")));
    assert.equal(first.error, undefined, JSON.stringify(first));
    const retry = await withExecEnv(town, {}, () => doorB(town, { from: "ash" }, ROWAN, on("2026-11-04")));
    assert.deepEqual([retry.duplicate, retry.room, retry.price], [undefined, { now: 2, after: 3 }, 100], JSON.stringify(retry));
    assert.deepEqual(burnsIn(town), [ROOM_2, ROOM_3("2026-11-04")], "two burns: 50 and then 100");
    assert.deepEqual(await keysKept(), [], "a call without a nonce keeps no key");
  } finally { rmSync(town, { recursive: true, force: true }); }
});

test("1 · the receipt outlives the purse and the cap: a retry once the payer is short for the next room still answers the first purchase", async () => {
  await fresh();
  const town = standInTown({ purse: 60 });
  try {
    const first = await withExecEnv(town, {}, () => doorA(town, { from: "ash", nonce: "short-1" }, ROWAN, on("2026-11-03")));
    assert.equal(first.price, 50, JSON.stringify(first));
    const bare = await withExecEnv(town, {}, () => doorB(town, { from: "ash" }, ROWAN, on("2026-11-04")));
    assert.equal(bare.code, 409, "the control: without the nonce the entry quote refuses the next room (10 stamps, 100 asked) instead of answering the receipt");
    const retry = await withExecEnv(town, {}, () => doorB(town, { from: "ash", nonce: "short-1" }, ROWAN, on("2026-11-04")));
    assert.deepEqual([retry.error, retry.duplicate, retry.price, retry.room], [undefined, true, 50, { now: 1, after: 2 }], JSON.stringify(retry));
    assert.deepEqual(burnsIn(town), [ROOM_2]);
  } finally { rmSync(town, { recursive: true, force: true }); }
});

// ── 2 · overlapping calls with one nonce ─────────────────────────────────────
// The first call's exec holds with its line on disk and unanswered, holding the
// (modelled) lock. The second call, in the OTHER handler, arrives then: its door
// shares no in-flight map with the first, and its entry quote would read room 2
// as bought and sell room 3. The key is what holds.
async function overlap(town, nonce) {
  const pause = mkdtempSync(join(tmpdir(), "parcel-room-nonce-pause-"));
  const lock2 = mkdtempSync(join(tmpdir(), "parcel-room-nonce-lock2-"));
  try {
    return await withExecEnv(town, { [PAUSE]: pause }, async () => {
      const a = doorA(town, { from: "ash", ...(nonce ? { nonce } : {}) }, ROWAN, on("2026-11-03"));
      const t0 = Date.now();
      while (!existsSync(join(pause, "paused")) && Date.now() - t0 < 20000) await new Promise((r) => setTimeout(r, 20));
      assert.ok(existsSync(join(pause, "paused")), "the first call's line is on disk, and its exec holds before the commit");
      // The second exec takes a lock file of its own, so on a box with flock it is not held off by the first
      // and the stand-in's model of the lock (above) is the one in force, as it is where there is no flock.
      process.env.TOWN_LOCK = join(lock2, "town.lock");
      const b = doorB(town, { from: "ash", ...(nonce ? { nonce } : {}) }, ROWAN, on("2026-11-03"));
      const first = await a;
      writeFileSync(join(pause, "answered"), "answered");
      const second = await b;
      assert.ok(existsSync(join(pause, "entered")), "the second call made its decision while the first call's line was on disk, unanswered");
      return { first, second };
    });
  } finally { rmSync(pause, { recursive: true, force: true }); rmSync(lock2, { recursive: true, force: true }); }
}

test("2 · two overlapping calls with one nonce, in two handlers that share no in-flight map, burn once", async () => {
  await fresh();
  const town = standInTown();
  try {
    const { first, second } = await overlap(town, "click-1");
    assert.equal(first.error, undefined, JSON.stringify(first));
    assert.deepEqual([first.duplicate, first.price], [undefined, 50], "the first call buys room 2 at 50");
    assert.deepEqual(burnsIn(town), [ROOM_2], `one burn: the second call bought nothing. It answered: ${JSON.stringify(second)}`);
    assert.deepEqual([second.error, second.duplicate, second.nonce, second.room, second.price], [undefined, true, "click-1", { now: 1, after: 2 }, 50],
      "the second call answers the first purchase's receipt");
    assert.equal((await keysKept()).length, 1, "one key");
  } finally { rmSync(town, { recursive: true, force: true }); }
});

test("2 · control: the same overlap without a nonce, in two handlers, buys two rooms — the in-flight map alone cannot hold across handlers", async () => {
  await fresh();
  const town = standInTown();
  try {
    const { first, second } = await overlap(town, null);
    assert.equal(first.price, 50, JSON.stringify(first));
    assert.deepEqual([second.duplicate, second.price], [undefined, 100], JSON.stringify(second));
    assert.deepEqual(burnsIn(town), [ROOM_2, ROOM_3("2026-11-03")], "two burns");
  } finally { rmSync(town, { recursive: true, force: true }); }
});

test("2 · two calls racing past the door's lookup keep one key, and both are handed the one purchase it names", async () => {
  await fresh();
  const kept = keptNonce("buy-parcel-room", "race-1");
  const [a, b] = await Promise.all([
    keepRoomKey({ household: "the-rowan", kept, handle: "ash", nth: 2 }),
    keepRoomKey({ household: "the-rowan", kept, handle: "birch", nth: 3 }),
  ]);
  assert.deepEqual(a, b, "both calls are handed the same purchase");
  assert.deepEqual(await keysKept(), [{ household: "the-rowan", nonce: kept, ...a }], "and the store kept one row");
});

// ── 3 · isolation ────────────────────────────────────────────────────────────

test("3 · another house's same nonce is its own purchase: it cannot read or consume this one's receipt", async () => {
  await fresh();
  const town = standInTown();
  try {
    const rowan = await withExecEnv(town, {}, () => doorA(town, { from: "ash", nonce: "shared-1" }, ROWAN, on("2026-11-03")));
    assert.equal(rowan.price, 50, JSON.stringify(rowan));
    const kept = keptNonce("buy-parcel-room", "shared-1");
    assert.equal(await roomKeyKept(["the-elm"], kept), null, "the elm's lookup does not see the rowan's key");
    const elm = await withExecEnv(town, {}, () => doorB(town, { from: "elm", nonce: "shared-1" }, ELM, on("2026-11-03")));
    assert.equal(elm.error, undefined, JSON.stringify(elm));
    assert.deepEqual([elm.duplicate, elm.household, elm.handle, elm.room, elm.price], [undefined, "the-elm", "elm", { now: 1, after: 2 }, 50],
      "the elm buys its own room: the rowan's receipt is not its answer");
    assert.deepEqual(burnsIn(town), [ROOM_2, "- 2026-11-03 · elm → BURN · 50 · for: parcel:2/hh:the-elm"]);
    assert.deepEqual((await keysKept()).map((k) => `${k.household}:${k.handle}:${k.nth}`), ["the-rowan:ash:2", "the-elm:elm:2"]);
    const stranger = await withExecEnv(town, {}, () => doorB(town, { from: "ash", nonce: "shared-1" }, ELM, on("2026-11-04")));
    assert.equal(stranger.code, 403, "and the elm's key cannot name a rowan resident to reach the rowan's key");
  } finally { rmSync(town, { recursive: true, force: true }); }
});

test("3 · the same word kept for another action answers nothing here, and this key answers nothing at the world door", async () => {
  await fresh();
  const town = standInTown();
  try {
    await owner("INSERT INTO parcel_room_nonces (household, nonce, handle, nth) VALUES ('the-rowan', 'walk:word-1', 'ash', 3)");
    const r = await withExecEnv(town, {}, () => doorA(town, { from: "ash", nonce: "word-1" }, ROWAN, on("2026-11-03")));
    assert.deepEqual([r.error, r.duplicate, r.room, r.price], [undefined, undefined, { now: 1, after: 2 }, 50], `a key kept under another action is not this purchase's: ${JSON.stringify(r)}`);
    assert.equal(await spentWorldNonce(keptNonce("walk", "word-1"), ["ash"]), null, "and the world door's lookup does not see the purchase's key");
    assert.equal(await spentWorldNonce(keptNonce("buy-parcel-room", "word-1"), ["ash"]), null, "under any spelling: it is not an act");
  } finally { rmSync(town, { recursive: true, force: true }); }
});

// ── 4 · the boundary ─────────────────────────────────────────────────────────

test("4 · a key the store cannot read refuses the purchase, and nothing burns (096 not landed)", async () => {
  await fresh();
  const town = standInTown();
  await owner("ALTER TABLE parcel_room_nonces RENAME TO parcel_room_nonces_set_aside");
  try {
    const r = await withExecEnv(town, {}, () => doorA(town, { from: "ash", nonce: "unread-1" }, ROWAN, on("2026-11-03")));
    assert.deepEqual([r.error, r.code, r.defect], ["bounce", 503, "the office could not read its retry keys"], JSON.stringify(r));
    assert.match(r.hint, /^so it cannot tell a retry from a second purchase, and it bought nothing: nothing was burned\./);
    assert.deepEqual(burnsIn(town), [], "a nonce it cannot keep never becomes an unprotected purchase");
    const bare = await withExecEnv(town, {}, () => doorA(town, { from: "ash" }, ROWAN, on("2026-11-03")));
    assert.deepEqual([bare.error, bare.price], [undefined, 50], "the control: a purchase without a nonce never asks the store, and is unchanged");
  } finally {
    await owner("ALTER TABLE parcel_room_nonces_set_aside RENAME TO parcel_room_nonces");
    rmSync(town, { recursive: true, force: true });
  }
});

test("4 · a key the store cannot keep refuses the purchase, and nothing burns", async () => {
  await fresh();
  const town = standInTown();
  await owner("REVOKE INSERT ON parcel_room_nonces FROM office_api");
  try {
    const r = await withExecEnv(town, {}, () => doorA(town, { from: "ash", nonce: "unkept-1" }, ROWAN, on("2026-11-03")));
    assert.deepEqual([r.error, r.code, r.defect], ["bounce", 503, "the office could not keep this nonce"], JSON.stringify(r));
    assert.match(r.hint, /^a nonce it cannot keep would let a retry after a lost answer buy a second room, so it bought nothing: nothing was burned\./);
    assert.deepEqual([burnsIn(town), await keysKept()], [[], []]);
  } finally {
    await owner("GRANT INSERT ON parcel_room_nonces TO office_api");
    rmSync(town, { recursive: true, force: true });
  }
});

test("4 · an office pointed at no store refuses a nonce'd purchase, and nothing burns", async () => {
  const town = standInTown();
  const saved = { WORLD2_PG: process.env.WORLD2_PG, WORLD2_PG_URL: process.env.WORLD2_PG_URL };
  delete process.env.WORLD2_PG; delete process.env.WORLD2_PG_URL;
  __setPoolForTest(null);
  try {
    const r = await withExecEnv(town, {}, () => doorA(town, { from: "ash", nonce: "nostore-1" }, ROWAN, on("2026-11-03")));
    assert.deepEqual([r.code, r.defect], [503, "the office could not read its retry keys"], JSON.stringify(r));
    assert.deepEqual(burnsIn(town), []);
  } finally {
    __setPoolForTest(pool);
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    rmSync(town, { recursive: true, force: true });
  }
});

test("4 · a key kept with no burn never answers \"bought\": the paid write fails, the answer is a refusal, and the retry makes the purchase once", async () => {
  await fresh();
  const town = standInTown();
  try {
    // The pen cannot write (no key on disk): the exec refuses after the door kept the key.
    const failed = await withExecEnv(town, { STAMP_KEY: join(town, "no-such-key.pem") },
      () => doorA(town, { from: "ash", nonce: "pen-1" }, ROWAN, on("2026-11-03")));
    assert.deepEqual([failed.error, failed.code, failed.duplicate], ["bounce", 409, undefined], JSON.stringify(failed));
    assert.deepEqual(burnsIn(town), [], "nothing burned");
    assert.deepEqual(await keysKept(), [{ household: "the-rowan", nonce: "buy-parcel-room:pen-1", handle: "ash", nth: 2 }], "the key was kept before the pen was asked");
    const made = await withExecEnv(town, {}, () => doorB(town, { from: "ash", nonce: "pen-1" }, ROWAN, on("2026-11-04")));
    assert.deepEqual([made.error, made.duplicate, made.price, made.nonce], [undefined, undefined, 50, "pen-1"],
      `the retry makes the purchase the key names, and says it made it: ${JSON.stringify(made)}`);
    const again = await withExecEnv(town, {}, () => doorA(town, { from: "ash", nonce: "pen-1" }, ROWAN, on("2026-11-05")));
    assert.equal(again.duplicate, true);
    assert.deepEqual(burnsIn(town), ["- 2026-11-04 · ash → BURN · 50 · for: parcel:2/hh:the-rowan"], "one burn across all three");
  } finally { rmSync(town, { recursive: true, force: true }); }
});

test("4 · a key whose room another resident bought answers a refusal, never that purchase as its own", async () => {
  await fresh();
  const town = standInTown();
  try {
    await owner("INSERT INTO parcel_room_nonces (household, nonce, handle, nth) VALUES ('the-rowan', 'buy-parcel-room:taken-1', 'ash', 2)");
    const birch = await withExecEnv(town, {}, () => doorB(town, { from: "birch" }, ROWAN, on("2026-11-03")));
    assert.equal(birch.price, 50, JSON.stringify(birch));
    const r = await withExecEnv(town, {}, () => doorA(town, { from: "ash", nonce: "taken-1" }, ROWAN, on("2026-11-04")));
    assert.deepEqual([r.error, r.code, r.duplicate], ["bounce", 409, undefined], JSON.stringify(r));
    assert.equal(r.defect, "the-rowan's room for parcel 2 was bought by birch, not by ash");
    assert.match(r.hint, /^this nonce names ash's purchase of that room, which was never made, so nothing was burned for it\./);
    assert.deepEqual(burnsIn(town), ["- 2026-11-03 · birch → BURN · 50 · for: parcel:2/hh:the-rowan"]);
  } finally { rmSync(town, { recursive: true, force: true }); }
});

test("4 · a key names its payer: a housemate's retry of a purchase not yet made is refused, and of one made answers its receipt", async () => {
  await fresh();
  const town = standInTown();
  try {
    await owner("INSERT INTO parcel_room_nonces (household, nonce, handle, nth) VALUES ('the-rowan', 'buy-parcel-room:payer-1', 'ash', 2)");
    const r = await withExecEnv(town, {}, () => doorB(town, { from: "birch", nonce: "payer-1" }, ROWAN, on("2026-11-03")));
    assert.deepEqual([r.code, r.defect], [409, "this nonce names ash's purchase of room for the-rowan's parcel 2, not birch's"], JSON.stringify(r));
    assert.deepEqual(burnsIn(town), [], "birch paid nothing on ash's key");
    const ash = await withExecEnv(town, {}, () => doorA(town, { from: "ash", nonce: "payer-1" }, ROWAN, on("2026-11-03")));
    assert.equal(ash.price, 50, JSON.stringify(ash));
    const late = await withExecEnv(town, {}, () => doorB(town, { from: "birch", nonce: "payer-1" }, ROWAN, on("2026-11-04")));
    assert.deepEqual([late.duplicate, late.handle, late.price], [true, "ash", 50], "the house's nonce answers the house's purchase");
    assert.deepEqual(burnsIn(town), [ROOM_2]);
  } finally { rmSync(town, { recursive: true, force: true }); }
});

// ── 5 · preview, refusal and the field ───────────────────────────────────────

test("5 · a preview and an entry refusal keep no key; the same nonce then buys; a malformed nonce is refused in the world door's words", async () => {
  await fresh();
  const town = standInTown();
  try {
    const p = await withExecEnv(town, {}, () => doorA(town, { from: "ash", preview: true, nonce: "first-1" }, ROWAN, on("2026-11-03")));
    assert.deepEqual([p.preview, p.room, p.price, p.duplicate], [true, { now: 1, after: 2 }, 50, undefined], JSON.stringify(p));
    const early = await withExecEnv(town, {}, () => doorA(town, { from: "ash", nonce: "first-1" }, ROWAN, on("2026-10-30")));
    assert.match(early.defect, /room is bought from 2026-11-01/, "the entry quote's refusal, unchanged");
    assert.deepEqual([burnsIn(town), await keysKept()], [[], []], "a call that buys nothing keeps no key");
    const r = await withExecEnv(town, {}, () => doorA(town, { from: "ash", nonce: "first-1" }, ROWAN, on("2026-11-03")));
    assert.deepEqual([r.error, r.duplicate, r.price], [undefined, undefined, 50], JSON.stringify(r));
    const bad = await withExecEnv(town, {}, () => doorA(town, { from: "ash", nonce: "" }, ROWAN, on("2026-11-03")));
    assert.deepEqual([bad.code, bad.defect], [422, "nonce must be a non-empty string"]);
    const long = await withExecEnv(town, {}, () => doorA(town, { from: "ash", nonce: "x".repeat(4096) }, ROWAN, on("2026-11-03")));
    assert.equal(long.code, 422);
    assert.match(long.defect, /^nonce must be under \d+ bytes$/);
    assert.deepEqual(burnsIn(town), [ROOM_2]);
  } finally { rmSync(town, { recursive: true, force: true }); }
});

test("5 · the household door takes `nonce` on buy-parcel-room (one-contract § DOOR_FIELDS), and still refuses it on an act that keeps none", async () => {
  const { judgeActFields } = await import("../src/one-contract.mjs");
  const { APEX_ONLY_FIELDS } = await import("../src/household-apex.mjs");
  const judge = (act, fields) => judgeActFields({ tool: act, declared: APEX_ONLY_FIELDS[act].properties, fields, exempt: ["handle"] });
  const ok = judge("buy-parcel-room", { from: "ash", nonce: "k" });
  assert.equal(ok.bounce, undefined, JSON.stringify(ok.bounce));
  assert.deepEqual(ok.fields, { from: "ash", nonce: "k" }, "the nonce rides through to the door");
  assert.equal(judge("letter-note", { letter: "l", state: "clear", nonce: "k" }).bounce?.defect, "letter-note does not take: nonce", "the control: an act with no key");
});
