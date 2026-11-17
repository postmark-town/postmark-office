// pos-1086-doorsteps-known.test.mjs — GET /doorsteps?handles=&known= (POS-1086).
//
// LAW (Darko, 2026-11-17 09:52 EST, "prioritize getting through the entire list
// of planned, not built yet"; Wright's shape on POS-1086): each doorstep the REST
// doors answer carries a `rev`, the hash of its content without the five global
// as_of-derived leaves; `known=handle:rev,…` answers `{ handle, unchanged: true,
// rev }` for each match instead of the body, and hands the five leaves back once
// (`global`). Without `known` the response is what it was, plus `rev`.
//   node --test test/pos-1086-doorsteps-known.test.mjs

import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { fixtureTown } from "./fixture.mjs";
import { indexStore } from "./helpers/office-under-test.mjs";
import { bootOnFreePort, freePort } from "./spawn-office.mjs";
import { seedStaticKeys } from "./helpers/static-keys.mjs";
import { REV_RE, revOf, splitGlobal, GLOBAL_LEAVES } from "../src/doorstep-rev.mjs";

const STORES = [];
const storeFor = async (town) => { const x = await indexStore(town, { db: "pos1086_known" }); STORES.push(x); return x.env; };
test.after(async () => { for (const x of STORES) await x.stop(); });

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const KEY = "pos1086-known-key";
let BASE, child, tmp;

before(async () => {
  tmp = mkdtempSync(join(tmpdir(), "postmark-office-known-"));
  const IX_ENV = await storeFor(fixtureTown());
  const box = await freePort();
  ({ child } = await bootOnFreePort((p) => spawn(process.execPath, [
    join(ROOT, "src", "server.mjs"), "--port", String(p),
    "--bouncer-now-ms", String(Date.parse("2026-10-13T14:00:00Z")),
    "--oauth-db", seedStaticKeys(join(tmp, "oauth.db"), `${KEY}=keemin:wright`),
  ], {
    env: { ...process.env, WORLD_GRAPH_NONE: "1", ...IX_ENV, TOWN_CLONE: join(tmp, "no-clone-here"), OFFICE_BOX_PORT: String(box) },
    stdio: ["ignore", "pipe", "pipe"],
  })));
  BASE = `http://127.0.0.1:${box}`;
});

after(async () => {
  if (child && child.exitCode === null) {
    const gone = new Promise((ok) => child.on("exit", ok));
    child.kill();
    await gone;
  }
  rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

const raw = async (path, headers = {}) => { const r = await fetch(`${BASE}${path}`, { headers }); return { status: r.status, text: await r.text() }; };
const get = async (path, headers = {}) => { const r = await raw(path, headers); return { status: r.status, body: JSON.parse(r.text), bytes: Buffer.byteLength(r.text) }; };
const roll = async () => (await get("/residents?limit=200")).body.residents.map((r) => r.handle);

test("every REST doorstep carries rev, last, and it is the revision of the body beside it", async () => {
  const handles = (await roll()).slice(0, 25);
  const bulk = (await get(`/doorsteps?handles=${handles.join(",")}`)).body;
  assert.ok(handles.length >= 2, "the fixture town has residents");
  assert.deepEqual(Object.keys(bulk), ["doorsteps"], "no known, no global: the response keeps its shape");
  for (const row of bulk.doorsteps) {
    assert.deepEqual(Object.keys(row), ["handle", "doorstep"], "a row is what it was");
    assert.match(row.doorstep.rev, REV_RE);
    assert.equal(Object.keys(row.doorstep).at(-1), "rev", "rev is the last key; nothing before it moved");
    assert.equal(row.doorstep.rev, revOf(row.doorstep), "rev is the hash of the content it sits on");
    const single = (await get(`/doorstep/${row.handle}`)).body;
    assert.deepEqual(single, row.doorstep, "the single door and the bulk door agree, rev included");
  }
});

test("known=: a matching rev answers unchanged with no body, a stale one the whole doorstep, a 404 stays null", async () => {
  const [a, b, c] = await roll();
  const full = (await get(`/doorsteps?handles=${a},${b},${c},nobody-lives-here`)).body.doorsteps;
  const rev = Object.fromEntries(full.filter((r) => r.doorstep).map((r) => [r.handle, r.doorstep.rev]));
  const stale = "0".repeat(16);
  assert.notEqual(rev[b], stale);
  const r = await get(`/doorsteps?handles=${a},${b},${c},nobody-lives-here&known=${a}:${rev[a]},${b}:${stale},nobody-lives-here:${stale}`);
  assert.equal(r.status, 200);
  const rows = r.body.doorsteps;
  assert.deepEqual(rows.map((x) => x.handle), [a, b, c, "nobody-lives-here"], "in the order named");
  assert.deepEqual(rows[0], { handle: a, unchanged: true, rev: rev[a] }, "a match: no body");
  assert.deepEqual(rows[1], full[1], "a stale rev: the whole doorstep, exactly the unknown read");
  assert.deepEqual(rows[2], full[2], "a handle not named in known: the whole doorstep");
  assert.deepEqual(rows[3], { handle: "nobody-lives-here", doorstep: null }, "a 404 is still null, even if a rev was offered for it");
});

test("known= hands the five global leaves back once, and they are the ones a doorstep carries", async () => {
  const [a, b] = await roll();
  const full = (await get(`/doorsteps?handles=${a},${b}`)).body.doorsteps;
  const r = (await get(`/doorsteps?handles=${a},${b}&known=${a}:${full[0].doorstep.rev},${b}:${full[1].doorstep.rev}`)).body;
  assert.deepEqual(Object.keys(r), ["doorsteps", "global"]);
  assert.deepEqual(r.global, splitGlobal(full[0].doorstep).global);
  assert.deepEqual(r.global, splitGlobal(full[1].doorstep).global, "one value for the town, whichever resident it is read from");
  assert.equal(Object.keys(r.global).length + 1, GLOBAL_LEAVES.length, "as_of, copy{2}, the window stamp, the outbox stamp: the five");
  // an empty known list is still a known read: nothing matches, the global rides
  const none = (await get(`/doorsteps?handles=${a}&known=`)).body;
  assert.equal(none.doorsteps[0].doorstep.rev, full[0].doorstep.rev);
  assert.deepEqual(none.global, r.global);
  // all 404: no global to hand back
  assert.equal((await get(`/doorsteps?handles=nobody-lives-here&known=`)).body.global, null);
});

test("known= is refused loudly when a pair is not handle:rev, and the existing refusals stand", async () => {
  const [a] = await roll();
  for (const bad of [a, `${a}:xyz`, `${a}:0123456789ABCDEF`, `../x:0123456789abcdef`]) {
    const r = await get(`/doorsteps?handles=${a}&known=${encodeURIComponent(bad)}`);
    assert.equal(r.status, 400, bad);
    assert.match(JSON.stringify(r.body), /known takes handle:rev pairs/);
  }
  assert.equal((await get("/doorsteps")).status, 400);
  assert.equal((await get(`/doorsteps?handles=${a},../etc`)).status, 400);
});

test("a key never widens the answer: the keyed bulk read carries the keyless rev, a keyed single doorstep its own", async () => {
  const [a] = await roll();
  const keyless = (await get(`/doorsteps?handles=${a}`)).body.doorsteps[0].doorstep;
  const keyedBulk = (await get(`/doorsteps?handles=${a}`, { authorization: `Bearer ${KEY}` })).body.doorsteps[0].doorstep;
  assert.deepEqual(keyedBulk, keyless);
  const wright = (await get("/doorstep/wright", { authorization: `Bearer ${KEY}` })).body;
  assert.equal(wright.rev, revOf(wright), "the owner's own page hashes what it carries");
});

test("MEASURED: the size of a known= answer for every unchanged resident against the full answer", async () => {
  const handles = (await roll()).slice(0, 25);
  const full = await get(`/doorsteps?handles=${handles.join(",")}`);
  const known = handles.map((h, i) => `${h}:${full.body.doorsteps[i].doorstep.rev}`).join(",");
  const r = await get(`/doorsteps?handles=${handles.join(",")}&known=${known}`);
  assert.ok(r.body.doorsteps.every((x) => x.unchanged === true && !("doorstep" in x)), "all unchanged");
  assert.ok(r.bytes < full.bytes / 4, `${r.bytes} bytes against ${full.bytes}`);
  console.log(`# measured on the fixture town: ${handles.length} residents, full ${full.bytes} bytes, all-unchanged known= ${r.bytes} bytes`);
});
