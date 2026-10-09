// world-state-route.test.mjs — GET /world/state at a real office reads the
// settlement (POS-359; R2, R3, R16).
//
//   node --test test/world-state-route.test.mjs
//
// A spawned office, its store engaged (office-under-test.mjs § indexStore), and
// two settlements in that store (helpers/settlement-seed.mjs). What a caller
// sees at the door: the newest settlement by default, `?settlement=S<n>` by
// name, a malformed or unknown name refused, and a holder's opposition gone at
// the next refresh.

import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { fixtureDb } from "./fixture.mjs";
import { indexStore } from "./helpers/office-under-test.mjs";
import { settlementRig, WORLD } from "./helpers/settlement-seed.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
let tmp, ix, rig;
before(async () => {
  tmp = mkdtempSync(join(tmpdir(), "postmark-world-state-route-"));
  const db = join(tmp, "fixture.db");
  fixtureDb(db).close();
  ix = await indexStore(db, { db: "world_state_route" });
  rig = settlementRig(ix.store);
});
after(async () => {
  await ix?.stop();
  if (tmp) rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

// `extra`: env for this office alone; a key set to null is removed (the cutover, unset).
async function withOffice(fn, extra = {}) {
  const env = { ...process.env, ...ix.env, OFFICE_READ_WORKERS: "0", WORLD_CLONE: WORLD, TOWN_CLONE: join(ROOT, "town-clone"), ...extra };
  for (const [k, v] of Object.entries(extra)) if (v == null) delete env[k];
  const proc = spawn(process.execPath, [
    join(ROOT, "src", "server.mjs"), "--port", "0",
    "--db", join(tmp, "fixture.db"), "--oauth-db", join(tmp, "oauth.db"), "--roles-db", join(tmp, "roles.db"),
  ], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const logs = { out: "", err: "", exit: null };
  proc.stdout.on("data", (d) => { logs.out += String(d); });
  proc.stderr.on("data", (d) => { logs.err += String(d); });
  const gone = new Promise((ok) => proc.on("exit", (code, signal) => { logs.exit = { code, signal }; ok(); }));
  try {
    for (let i = 0; i < 300 && !logs.out.includes("listening") && !logs.exit; i++) await new Promise((r) => setTimeout(r, 100));
    assert.ok(logs.out.includes("listening"), `the office never listened: ${JSON.stringify(logs.exit)} ${logs.err.slice(-400)}`);
    await fn(`http://127.0.0.1:${logs.out.match(/listening on :(\d+)/)[1]}`, logs);
  } finally {
    proc.kill();
    await gone;
  }
}

const get = async (url) => { const r = await fetch(url); return { status: r.status, body: await r.json() }; };
const ids = (state) => state.marks.map((m) => m.id).filter((id) => id !== "the-town/hall").sort();

test("the door serves the newest settlement, names it, serves one by name, and refuses what is not one", { skip: ix?.store?.skip }, async () => {
  await rig.seed();
  await withOffice(async (base, logs) => {
    const newest = await get(`${base}/world/state`);
    assert.equal(newest.status, 200, JSON.stringify(newest.body).slice(0, 300) + logs.err.slice(-300));
    assert.equal(newest.body.meta.source, "settlement", JSON.stringify(newest.body.meta) + logs.err.slice(-600));
    assert.equal(newest.body.meta.as_of.settlement, "S11");
    assert.deepEqual(ids(newest.body), ["ann/plot", "bo/shed", "bo/shed-name", "cy/bench", "cy/yard"]);

    const named = await get(`${base}/world/state?settlement=S10`);
    assert.equal(named.status, 200);
    assert.equal(named.body.meta.as_of.settlement, "S10");
    assert.deepEqual(ids(named.body), ["ann/plot", "cy/bench"]);

    const unknown = await get(`${base}/world/state?settlement=S99`);
    assert.equal(unknown.status, 404);
    assert.match(JSON.stringify(unknown.body), /S99 is not a settlement/);
    const bad = await get(`${base}/world/state?settlement=latest`);
    assert.equal(bad.status, 422);
  });
});

test("a holder's opposition is gone from the door's answer without a clearing (R16)", { skip: ix?.store?.skip }, async () => {
  await rig.seed({ cutover: "S10" });                       // S11 sealed at or after the cutover: stances count
  await rig.speak({ actor: "ann", on: "bo/shed", stance: "opposed" });
  await withOffice(async (base) => {
    const r = await get(`${base}/world/state`);
    assert.equal(r.status, 200);
    assert.equal(r.body.meta.as_of.settlement, "S11");
    assert.deepEqual(ids(r.body), ["ann/plot", "cy/bench", "cy/yard"]);
    assert.equal(r.body.returned.find((x) => x.mark === "bo/shed")?.returned_from, "ann/plot");
  });
});

test("THE SERVED WORLD WAITS FOR THE CUTOVER (Darko, 2026-10-09): sealed with it unset, /world/state keeps the opposed shed, and git keeps it too", { skip: ix?.store?.skip }, async () => {
  // S11 sealed while TOWN_STANCE_CUTOVER was unset (072 records it); the office's own env sets it, and changes nothing.
  await rig.seed({ sealWords: [{ actor: "ann", on: "bo/shed", stance: "opposed" }], cutover: "S10",
    s11Stances: { counted: false, cutover: null, settlement_inferred: 11, how: "inferred" } });
  await rig.speak({ actor: "ann", on: "bo/shed", stance: "opposed", at: "2026-10-04T00:00:00Z" });
  for (const asked of ["", "?settlement=S11"]) {
    await withOffice(async (base) => {
      const r = await get(`${base}/world/state${asked}`);
      assert.equal(r.status, 200);
      assert.deepEqual(ids(r.body), ["ann/plot", "bo/shed", "bo/shed-name", "cy/bench", "cy/yard"], `${asked || "the newest"}: the opposed shed stands`);
      assert.deepEqual(r.body.returned ?? [], []);
      assert.equal(r.body.meta.words.counted, false);
      assert.equal(r.body.meta.words.not_counted, "TOWN_STANCE_CUTOVER was not set when S11 was sealed: before the cutover every mark counts as ratified (R14), so no stance is applied to this World");
    }, { TOWN_STANCE_CUTOVER: "S1" });
  }
  const { settlementTakesAway } = await import("../src/world-settlement.mjs");
  const header = await rig.asOffice(async (p) => (await p.query("SELECT * FROM world_snapshots WHERE id = 2")).rows[0]);
  const away = await rig.asOffice((p) => settlementTakesAway(p, header, { worldRepo: WORLD }));
  assert.deepEqual([...away.slugs], [], "and git is written with the shed in it: the page and the record agree");
});
