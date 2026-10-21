// media-sweep-store.test.mjs — POS-737 on a real store, as office_api: 080's
// states and grant, every store source readable by the sweep's role, a table
// that would read as empty refused, and an office on this code against a store
// that has NOT taken 080 answering exactly as before.
//
//   node --test test/media-sweep-store.test.mjs   (the tree's own Postgres; CI starts its own)

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";

import { startStore } from "./helpers/embedded-store.mjs";

process.env.R2_ACCOUNT_ID = "test-account";
process.env.R2_ACCESS_KEY_ID = "test-key";
process.env.R2_SECRET_ACCESS_KEY = "test-secret";

const { MEDIA_BASE, uploadMedia, mediaQuota, mediaHeldRefusal, mediaLedgerHasStates } = await import("../src/media.mjs");
const { STORE_SOURCES, storeKeys, runSweep, GRACE_MS } = await import("../src/media-sweep.mjs");
const { paperOnPool, paperworkPoolTypes } = await import("../src/paperwork.mjs");
const pg = (await import("pg")).default;

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const KEY = { household: "eve", handles: new Set(["eve"]) };
const put = async () => {};
const NOW = Date.UTC(2026, 10, 30);
const dirs = [];
test.after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

function repo(files) {
  const dir = mkdtempSync(join(tmpdir(), "media-sweep-store-repo-"));
  dirs.push(dir);
  const git = (...a) => execFileSync("git", ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@t", ...a], { stdio: ["ignore", "pipe", "pipe"] });
  for (const [p, body] of Object.entries(files)) { mkdirSync(dirname(join(dir, p)), { recursive: true }); writeFileSync(join(dir, p), body); }
  git("init", "-q", "-b", "main"); git("add", "-A"); git("commit", "-q", "-m", "x");
  return dir;
}
const HUNG = `${MEDIA_BASE}/media/alta/${"a".repeat(64)}.png`;

test("POS-737 on the store: 080's states and grant, the sources, the RLS refusal, the sweep as office_api, and the office before 080", async (t) => {
  const store = await startStore({ db: "media_sweep_test" });
  const owner = new pg.Client({ connectionString: store.url("world2_owner") });
  await owner.connect();
  const apiPool = () => new pg.Pool({ connectionString: store.url("office_api"), max: 2, types: paperworkPoolTypes(pg) });
  const pools = [];
  // every client closed BEFORE the store goes, or its drop is an uncaught error
  t.after(async () => { await owner.end(); for (const p of pools) await p.end(); await store.stop(); });
  const fresh = () => { const p = apiPool(); p.on("error", () => {}); pools.push(p); return p; };

  await t.test("080 landed on the floor: office_api may UPDATE the ledger, and the paper sees the states", async () => {
    const { rows } = await owner.query("SELECT has_table_privilege('office_api', 'office_media', 'UPDATE') AS u");
    assert.equal(rows[0].u, true);
    assert.equal(await mediaLedgerHasStates(paperOnPool(fresh())), true);
  });

  await t.test("every store source is a table office_api can read, never one that would read as empty", async () => {
    const pool = fresh();
    for (const src of STORE_SOURCES) await storeKeys(pool, src); // throws on a missing table, no grant, or RLS with no policy
  });

  await t.test("a row's text is read whole, an escaped slash included; RLS with no policy is refused by name", async () => {
    await owner.query(`CREATE TABLE pictures_fixture (t text, j jsonb);
      GRANT SELECT ON pictures_fixture TO office_api;
      CREATE TABLE hidden_fixture (t text); GRANT SELECT ON hidden_fixture TO office_api;
      ALTER TABLE hidden_fixture ENABLE ROW LEVEL SECURITY;`);
    await owner.query("INSERT INTO pictures_fixture VALUES ($1, $2), ('nothing', NULL)",
      [`a face: ${HUNG}`, JSON.stringify({ img: `${MEDIA_BASE}/media/bree/${"b".repeat(64)}-96.png`.replace(/\//g, "\\/") })]);
    await owner.query("INSERT INTO hidden_fixture VALUES ($1)", [HUNG]);
    const pool = fresh();
    assert.deepEqual([...await storeKeys(pool, { table: "pictures_fixture" })].sort(), [`alta/${"a".repeat(64)}.png`, `bree/${"b".repeat(64)}.png`]);
    await assert.rejects(storeKeys(pool, { table: "hidden_fixture" }), /row-level security with no policy for the sweep's role, so it would read as empty/);
    await assert.rejects(storeKeys(pool, { table: "no_such_fixture" }), /the store has no table no_such_fixture/);
  });

  await t.test("the sweep runs as office_api: dry keeps the clock, a live run frees what is due", async () => {
    const paper = paperOnPool(fresh());
    const up = await uploadMedia({}, KEY, paper, { put, bytes: PNG });
    const world = repo({ "WORLD/marks/alta/m/mark.md": `image: ${HUNG}` });
    const town = repo({ "WHITE_PAGES/alta/PROFILE.md": `avatar_url: ${HUNG}` });
    const pool = fresh();
    const dry = await runSweep({ odb: paper, pool, worldClone: world, townClone: town, now: NOW });
    assert.equal(dry.refused, undefined, JSON.stringify(dry.sources));
    assert.equal(dry.clock.stamped, 1);
    const keys = [];
    const live = await runSweep({ odb: paper, pool, worldClone: world, townClone: town, now: NOW + GRACE_MS, apply: true, del: async (k) => { keys.push(k); } });
    assert.equal(live.freed.files, 1);
    assert.deepEqual(keys, [`media/eve/${up.sha}.png`, `media/eve/${up.sha}-96.png`, `media/eve/${up.sha}-256.png`]);
    assert.equal((await mediaQuota(paper, "eve")).used, 0);
    const { rows } = await owner.query("SELECT deleted_cause, purged_at FROM office_media WHERE sha = $1", [up.sha]);
    assert.deepEqual(rows[0], { deleted_cause: "sweep", purged_at: String(NOW + GRACE_MS) });
  });

  await t.test("BEFORE 080: an office on this code answers as it always did, and the sweep refuses", async () => {
    await owner.query(`ALTER TABLE office_media DROP COLUMN unreferenced_since, DROP COLUMN deleted_at, DROP COLUMN deleted_cause,
      DROP COLUMN deleted_by, DROP COLUMN deleted_reason, DROP COLUMN purged_at`);
    const paper = paperOnPool(fresh());
    assert.equal(await mediaLedgerHasStates(paper), false);
    const up = await uploadMedia({}, { household: "fern", handles: new Set(["fern"]) }, paper, { put, bytes: PNG });
    assert.equal((await uploadMedia({}, { household: "fern", handles: new Set(["fern"]) }, paper, { put, bytes: PNG })).already, true);
    assert.equal((await mediaQuota(paper, "fern")).used, PNG.length);
    assert.equal(await mediaHeldRefusal(up.url, { odb: paper }), null);
    assert.equal((await mediaHeldRefusal(`${MEDIA_BASE}/media/fern/${"f".repeat(64)}.png`, { odb: paper })).code, 422);
    const r = await runSweep({ odb: paper, pool: fresh(), worldClone: null, townClone: null, now: NOW });
    assert.match(r.refused, /has not taken 080_media_freed\.sql/);
  });
});
