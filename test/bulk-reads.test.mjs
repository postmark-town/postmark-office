// bulk-reads.test.mjs — the site refresh's bulk reads answer exactly what the
// single reads answer, element by element, and never more (Darko 2026-10-13).
//
// The refresh read the office ~625 times a pass: a card and a doorstep per
// resident, every bulletin entry, every page of the letter corpus. The bulk
// reads put those in tens of requests:
//   GET /residents?cards=1     the page's cards beside its rows
//   GET /doorsteps?handles=    up to 25 doorsteps
//   GET /bulletin?full=1       every entry whole
//   GET /letters?digests=1     { id, digest } per letter, the digest the hash of
//                              the letter's full answer; with ?full=1&ids= the
//                              reader fetches only the letters that moved
// "A page reads what the resident reads": each element is held to the single
// KEYLESS read, and a keyed bulk read is held to it too, so no credential can
// widen a bulk answer. And a bulk read costs what its single reads would.
//   node --test test/bulk-reads.test.mjs

import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { fixtureTown } from "./fixture.mjs";
import { indexStore } from "./helpers/office-under-test.mjs";
import { bootOnFreePort, freePort } from "./spawn-office.mjs";
import { seedStaticKeys } from "./helpers/static-keys.mjs";
import { letterDigest } from "../src/queries.mjs";

const STORES = [];
const storeFor = async (town) => { const x = await indexStore(town); STORES.push(x); return x.env; };
test.after(async () => { for (const x of STORES) await x.stop(); });

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const KEY = "bulk-reads-key";
// BASE is the box door, as the site refresh reads it, so the equality reads
// spend no keyless bucket; PUBLIC is the port nginx forwards to, where the
// price test charges a caller.
let BASE, PUBLIC, child, tmp;

before(async () => {
  tmp = mkdtempSync(join(tmpdir(), "postmark-office-bulk-"));
  const town = fixtureTown();
  const IX_ENV = await storeFor(town);
  const box = await freePort();
  let port;
  ({ child, port } = await bootOnFreePort((p) => spawn(process.execPath, [
    join(ROOT, "src", "server.mjs"), "--port", String(p),
    "--bouncer-now-ms", String(Date.parse("2026-10-13T14:00:00Z")),
    "--oauth-db", seedStaticKeys(join(tmp, "oauth.db"), `${KEY}=keemin:wright`),
  ], {
    env: { ...process.env, WORLD_GRAPH_NONE: "1", ...IX_ENV, TOWN_CLONE: join(tmp, "no-clone-here"), OFFICE_BOX_PORT: String(box) },
    stdio: ["ignore", "pipe", "pipe"],
  })));
  BASE = `http://127.0.0.1:${box}`;
  PUBLIC = `http://127.0.0.1:${port}`;
});

after(async () => {
  if (child && child.exitCode === null) {
    const gone = new Promise((ok) => child.on("exit", ok));
    child.kill();
    await gone;
  }
  rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

const get = async (path, headers = {}, base = BASE) => {
  const r = await fetch(`${base}${path}`, { headers });
  return { status: r.status, body: await r.json() };
};
// A public caller, as nginx forwards one: the public port, with XFF.
const getPublic = (path, from, headers = {}) => get(path, { "x-forwarded-for": from, ...headers }, PUBLIC);
const keyed = { authorization: `Bearer ${KEY}` };
// What the single keyless door answers: the body, or null where it says 404.
const single = async (path) => {
  const r = await get(path);
  if (r.status === 404) return null;
  assert.equal(r.status, 200, `${path}: ${JSON.stringify(r.body).slice(0, 200)}`);
  return r.body;
};

test("/residents?cards=1 keeps the roll page as it was and adds each row's card, exactly the single keyless read", async () => {
  const plain = await get("/residents?limit=200");
  const bulk = await get("/residents?cards=1&limit=200");
  assert.equal(bulk.status, 200);
  const { cards, ...page } = bulk.body;
  assert.deepEqual(page, plain.body, "the roll page is the same answer with or without cards");
  assert.ok(page.residents.length >= 3, "the fixture town has residents to compare");
  assert.equal(cards.length, page.residents.length);
  for (const [i, row] of page.residents.entries())
    assert.deepEqual(cards[i], await single(`/residents/${row.handle}`), `card ${i} (${row.handle})`);
});

test("/residents?cards=1 pages with the roll: each page's cards are that page's rows", async () => {
  const first = (await get("/residents?cards=1&limit=2")).body;
  const second = (await get("/residents?cards=1&limit=2&offset=2")).body;
  assert.deepEqual(first.cards.map((c) => c?.handle), first.residents.map((r) => r.handle));
  assert.deepEqual(second.cards.map((c) => c?.handle), second.residents.map((r) => r.handle));
});

test("a keyed bulk read is still the public read: no credential widens a card or a doorstep", async () => {
  // The question has teeth only if the key DOES widen the single reads.
  assert.notDeepEqual((await get("/residents/wright", keyed)).body, await single("/residents/wright"), "the keyed card differs");
  assert.notDeepEqual((await get("/doorstep/wright", keyed)).body, await single("/doorstep/wright"), "the keyed doorstep differs");
  const bulk = (await get("/residents?cards=1&limit=200", keyed)).body;
  for (const [i, row] of bulk.residents.entries())
    assert.deepEqual(bulk.cards[i], await single(`/residents/${row.handle}`), `keyed bulk card for ${row.handle}`);
  const ds = (await get("/doorsteps?handles=wright", keyed)).body;
  assert.deepEqual(ds.doorsteps[0].doorstep, await single("/doorstep/wright"));
});

test("/doorsteps answers each named doorstep exactly as the single keyless read, in the order named, null for a 404", async () => {
  const roll = (await get("/residents?limit=200")).body.residents.map((r) => r.handle);
  const handles = [...roll.slice().reverse(), "nobody-lives-here"];
  const bulk = await get(`/doorsteps?handles=${handles.join(",")}`);
  assert.equal(bulk.status, 200);
  assert.deepEqual(bulk.body.doorsteps.map((d) => d.handle), handles);
  for (const d of bulk.body.doorsteps)
    assert.deepEqual(d.doorstep, await single(`/doorstep/${d.handle}`), `doorstep for ${d.handle}`);
  assert.equal(bulk.body.doorsteps.at(-1).doorstep, null);
});

test("/doorsteps refuses an empty list, more than 25 handles, and a name that is not a handle", async () => {
  assert.equal((await get("/doorsteps")).status, 400);
  assert.equal((await get(`/doorsteps?handles=${Array.from({ length: 26 }, (_, i) => `h${i}`).join(",")}`)).status, 400);
  assert.equal((await get("/doorsteps?handles=wright,../etc")).status, 400);
});

test("/bulletin?full=1 is every listed entry whole, in the list's order, each the single read", async () => {
  const list = (await get("/bulletin")).body;
  const full = await get("/bulletin?full=1");
  assert.equal(full.status, 200);
  assert.ok(list.length >= 1, "the fixture town has a bulletin to compare");
  assert.deepEqual(full.body, await Promise.all(list.map((b) => single(`/bulletin/${b.slug}`))));
});

test("/letters?digests=1 names every letter in the full door's order; ?full=1&ids= is exactly those full rows", async () => {
  const full = (await get("/letters?full=1&limit=200")).body;
  const digests = await get("/letters?digests=1&limit=5000");
  assert.equal(digests.status, 200);
  assert.equal(digests.body.digests, true);
  assert.equal(digests.body.limit, 5000, "a digest page may be up to 5000 long");
  assert.equal((await get("/letters?digests=1&limit=9999")).body.limit, 5000, "and no longer");
  assert.deepEqual(digests.body.letters.map((l) => l.id), full.letters.map((l) => l.id));
  for (const [i, l] of digests.body.letters.entries()) {
    assert.deepEqual(Object.keys(l), ["id", "digest"], "a digest row carries no letter content");
    assert.equal(l.digest, createHash("sha256").update(JSON.stringify(full.letters[i]), "utf8").digest("hex").slice(0, 32),
      `${l.id}: the digest is the hash of the letter's full answer`);
  }
  assert.deepEqual((await get("/letters?digests=1&limit=5000")).body.letters, digests.body.letters, "the digests are stable");

  const pick = full.letters.filter((_, i) => i % 2 === 0);
  const some = (await get(`/letters?full=1&limit=200&ids=${pick.map((l) => encodeURIComponent(l.id)).join(",")}`)).body;
  assert.deepEqual(some.letters, pick, "the named letters, whole, in the full door's order");
  assert.equal(some.total, pick.length);
  assert.equal((await get("/letters?full=1&ids=")).status, 400);
});

test("a letter's digest moves with everything its full answer is built from", () => {
  const row = { id: "a", from_h: "wright", to_h: "limen", date: "2026-07-01", thread: null, delivered_at: null,
    json: JSON.stringify({ id: "a", body: "hi", box: "outbox", path: "WHITE_PAGES/wright/OUTBOX/a.md" }) };
  const d = letterDigest(row);
  assert.equal(letterDigest({ ...row }), d);
  // the ferry's move at delivery: the path, the box and delivered_at change
  assert.notEqual(letterDigest({ ...row, delivered_at: "2026-07-02T12:00:00Z" }), d);
  assert.notEqual(letterDigest({ ...row, json: row.json.replace("OUTBOX", "INBOX") }), d);
  for (const k of ["id", "from_h", "to_h", "date", "thread"]) assert.notEqual(letterDigest({ ...row, [k]: "x" }), d, k);
});

test("a bulk read costs what its single reads would: 200 cards spend 200 of a keyless caller's 240", async () => {
  assert.equal((await getPublic("/residents?cards=1&limit=200", "198.51.100.40")).status, 200);
  assert.equal((await getPublic("/residents?cards=1&limit=200", "198.51.100.40")).status, 429, "the second 200 does not fit in the 40 left");
  const many = `/doorsteps?handles=${Array(25).fill("wright").join(",")}`;
  for (let i = 0; i < 9; i++) assert.equal((await getPublic(many, "198.51.100.41")).status, 200, `doorstep read ${i + 1} of 25`);
  assert.equal((await getPublic(many, "198.51.100.41")).status, 429, "nine reads of 25 spent 225; 25 more do not fit in the 15 left");
  assert.equal((await getPublic("/doorsteps?handles=wright,limen", "198.51.100.41")).status, 200, "two do");
  // a digest page of 5000 shapes as many letters as 25 full pages, and costs that
  for (let i = 0; i < 9; i++) assert.equal((await getPublic("/letters?digests=1&limit=5000", "198.51.100.42")).status, 200, `digest page ${i + 1}`);
  assert.equal((await getPublic("/letters?digests=1&limit=5000", "198.51.100.42")).status, 429, "nine pages spent 225; the tenth's 25 do not fit");
  // A keyed caller pays the same cost from its key's 240 reads a minute. The
  // key has spent 203 in the keyed test above (a 200-card page and three
  // single reads; the clock is frozen), so one digest page fits in the 37 left
  // and a second does not, while a one-token read still does.
  assert.equal((await get("/letters?digests=1&limit=5000", keyed)).status, 200);
  assert.equal((await get("/letters?digests=1&limit=5000", keyed)).status, 429, "keyed GETs are charged bulkCost too");
  assert.equal((await get("/town", keyed)).status, 200, "the refusal was the digest page's 25, not an empty budget");
});
