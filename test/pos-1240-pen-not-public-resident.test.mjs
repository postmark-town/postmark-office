// pos-1240-pen-not-public-resident.test.mjs — postmark-pen is not on the PUBLIC residents roll; real office meeps are (POS-1240; CORE-187).
//
// Darko: "postmark-pen shouldn't appear under residents (as it isn't one)". A public-population filter, nothing else: the Pen keeps its identity, its stored row and its
// history, and stays in the office's OPERATIONAL roll; real office meeps remain residents; the admission grammar is untouched.
//
// THE ACTUAL DOORS, over a real Postgres whose town_residents holds the Pen, ordinary people and real office meeps (the Pen is NOT removed from the fixture input):
//   · REST `/residents` (server.mjs → fromTownIndex → storeAnswer → residentPage → last-active), spawned over loopback HTTP, bare, paged and `?office=` filtered;
//   · MCP `list_residents` and `read_town` (mcp.mjs → fromStore → the same page / townSummary), in process;
//   · repeated same-head reads (the page is memoized per head and ask: the kept copy is the filtered page and no caller's copy changes it);
//   · the Pen's own record and its authored history still resolve (`resident`, the letters it wrote), and the operational roll (`residentList`, the position doors' handles) still holds it.
//
// FALSIFIER (run, see the PR): restore the old population predicate (`isResidentHandle` in residentPage) and the REST/MCP/page tests go red at the Pen.
//
//   node --import ./test/helpers/sparse-guard.mjs --test test/pos-1240-pen-not-public-resident.test.mjs

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { fixtureTown, putValues, put } from "./fixture.mjs";
import { startStore } from "./helpers/embedded-store.mjs";
import { seedTownIndex } from "./helpers/index-to-store.mjs";
import * as store from "../src/town-index-store.mjs";
import { openOauthDb } from "../src/oauth.mjs";
import { isResidentHandle, isPublicResident, PEN_HANDLE } from "../src/residency.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tmp = mkdtempSync(join(tmpdir(), "pos1240-"));
const AS_OF = "pos1240sha000000000000000000000000000000";
let s = null, skip = false, api = null, office = null;

const card = (handle, joined, extra = {}) => JSON.stringify({ handle, display: `Resident ${handle}`, address: { data: { joined, ...extra }, body: `# ${handle}` } });
const PEN_LETTER = "postmark-pen-2026-03-01-to-amber-hello";
const PEOPLE = ["amber", "birch", "dune", "elm", "fern"];
const MEEPS = ["cedar", "illuminator"];           // real office meeps: residents
const ALL_PUBLIC = [...PEOPLE.slice(0, 2), "cedar", ...PEOPLE.slice(2), "illuminator"].sort((a, b) => (a < b ? -1 : 1));

before(async () => {
  s = await startStore();
  if (s.skip) { skip = s.skip; return; }
  const db = fixtureTown();
  db.residents = [];
  PEOPLE.forEach((h, i) => putValues(db, "residents", [h, card(h, `2026-0${1 + i}-01`)]));
  MEEPS.forEach((h, i) => putValues(db, "residents", [h, card(h, `2026-07-0${1 + i}`, { office: "true" })]));
  // THE PEN, as an office card with the town's own household: on the table, on the roll's source, and never removed from the input
  putValues(db, "residents", [PEN_HANDLE, card(PEN_HANDLE, "2026-09-01", { office: "true" })]);
  // history the Pen AUTHORED: a letter from it, which must still list under its authorship
  put(db, "letters", { id: PEN_LETTER, from_h: PEN_HANDLE, to_h: "amber", date: "2026-03-01", thread: null, box: "inbox", owner: "amber", path: `WHITE_PAGES/amber/inbox/${PEN_LETTER}.md`,
    json: JSON.stringify({ id: PEN_LETTER, from: PEN_HANDLE, to: "amber", date: "2026-03-01", box: "inbox", body: "# From the Pen\n\nA letter the town's hand wrote.", delivered_at: "2026-03-01T08:00:00.000Z" }), delivered_at: "2026-03-01T08:00:00.000Z" });
  db.meta = db.meta.filter((r) => r.key !== "as_of");
  putValues(db, "meta", ["as_of", AS_OF]);
  const w = await s.connect("law_ingester");
  await seedTownIndex(w, db);
  await w.end();
  api = await s.connect("office_api");
  process.env.WORLD2_PG = "1";
  process.env.WORLD2_PG_URL = s.url("office_api");
  const child = spawn(process.execPath, [join(ROOT, "src", "server.mjs"), "--port", "0",
    "--oauth-db", (() => { const p = join(tmp, "oauth.db"); openOauthDb(p).close(); return p; })(), "--roles-db", join(tmp, "roles.db")], {
    env: { ...process.env, TOWN_CLONE: join(tmp, "no-clone-here"), WORLD_CLONE: join(tmp, "no-world-clone"), VOICES_LOG: join(tmp, "voices.jsonl"),
      TOWN_PUSH: "", WORLD_STORE_DB: join(tmp, "no-world.db"), OFFICE_READ_WORKERS: "0", WORLD2_PG: "1", WORLD2_PG_URL: s.url("office_api") },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise((ok, no) => {
    const t = setTimeout(() => no(new Error("the office never listened")), 30_000);
    child.stdout.on("data", (d) => { const m = /listening on :(\d+)/.exec(String(d)); if (m) { clearTimeout(t); office = { child, base: `http://127.0.0.1:${m[1]}` }; ok(); } });
    child.on("exit", (c) => no(new Error(`the office exited early (${c})`)));
  });
});
after(async () => {
  if (office?.child.exitCode === null) { const gone = new Promise((ok) => office.child.on("exit", ok)); office.child.kill(); await gone; }
  await api?.end().catch(() => {});
  await s?.stop?.();
  rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

const rest = async (path) => { const r = await fetch(office.base + path); return { status: r.status, body: await r.json() }; };
const handles = (page) => page.residents.map((r) => r.handle);

test("the predicate: the Pen is the one handle left out; the admission grammar is untouched, so the Pen's records still resolve", () => {
  assert.equal(isResidentHandle(PEN_HANDLE), true, "the grammar still admits it: nothing is invalidated");
  assert.equal(isPublicResident(PEN_HANDLE), false);
  for (const h of [...PEOPLE, ...MEEPS, "postmaster", "the-pen", "postmark-pen-2"]) assert.equal(isPublicResident(h), isResidentHandle(h), h);
});

test("REST /residents omits the Pen: the bare list, a later page, and the office filters, with totals and continuation coherent", async (t) => {
  if (skip) return t.skip(skip);
  const all = (await rest("/residents?limit=200")).body;
  assert.deepEqual(handles(all), ALL_PUBLIC, "ordinary people and real office meeps, never the Pen");
  assert.ok(!JSON.stringify(all).includes(PEN_HANDLE), "not anywhere on the answer");
  assert.equal(all.town_total, ALL_PUBLIC.length);
  assert.equal(all.shown, ALL_PUBLIC.length);
  // a later page: the Pen is left out BEFORE the paging, so the pages tile the public roll with no gap and no short page
  const p1 = (await rest("/residents?limit=3&offset=0")).body, p2 = (await rest("/residents?limit=3&offset=3")).body, p3 = (await rest("/residents?limit=3&offset=6")).body;
  assert.deepEqual([...handles(p1), ...handles(p2), ...handles(p3)], ALL_PUBLIC);
  assert.deepEqual([p1.shown, p2.shown, p3.shown], [3, 3, 1]);
  assert.equal(p1.town_total, ALL_PUBLIC.length, "the town total is the public one on every page");
  assert.equal(p1.complete, false); assert.equal(p3.complete, true);
  assert.equal(p1.next_offset, 3);
  // the existing filters: office=true is the real meeps (not the Pen); office=false the people
  const meeps = (await rest("/residents?office=true&limit=200")).body, people = (await rest("/residents?office=false&limit=200")).body;
  assert.deepEqual(handles(meeps), MEEPS.slice().sort());
  assert.deepEqual(handles(people), PEOPLE);
  assert.equal(meeps.total, MEEPS.length);
});

test("MCP list_residents and read_town agree: the same page without the Pen, and the town card's counts and offices", async (t) => {
  if (skip) return t.skip(skip);
  const { callTool } = await import("../src/mcp.mjs");
  const unwrap = (r) => (typeof r === "string" ? JSON.parse(r) : r?.content?.[0]?.text ? JSON.parse(r.content[0].text) : r);
  const list = unwrap(await callTool("list_residents", { limit: 200 }, {}));
  assert.deepEqual(handles(list), ALL_PUBLIC);
  assert.ok(!JSON.stringify(list).includes(PEN_HANDLE));
  const later = unwrap(await callTool("list_residents", { limit: 3, offset: 3 }, {}));
  assert.deepEqual(handles(later), ALL_PUBLIC.slice(3, 6));
  const town = unwrap(await callTool("read_town", {}, {}));
  const text = JSON.stringify(town);
  assert.ok(!text.includes(PEN_HANDLE), "the town card lists the Pen neither as a resident nor among the offices");
  assert.equal(town.counts.residents, ALL_PUBLIC.length, "the town card's resident count is the public one");
  assert.deepEqual(town.offices, MEEPS.slice().sort(), "and its offices are the real meeps");
});

test("SEARCH (REST /search, MCP search_town): the resident bucket and its matching count leave the Pen out, before the count and the cap; the letters it authored are still found", async (t) => {
  if (skip) return t.skip(skip);
  const { callTool } = await import("../src/mcp.mjs");
  const unwrap = (r) => (typeof r === "string" ? JSON.parse(r) : r?.content?.[0]?.text ? JSON.parse(r.content[0].text) : r);
  // a term every card carries ("Resident <handle>"): the bucket is the public roll, 7 not 8
  const all = (await rest("/search?q=Resident")).body;
  assert.deepEqual(all.residents.slice().sort(), ALL_PUBLIC, "every public resident, never the Pen");
  assert.equal(all.matches.residents, ALL_PUBLIC.length, "the matching count is the public one");
  assert.equal(all.capped.residents, false);
  // the term IS the Pen's handle: the Pen is not a resident hit (not even leading the bucket), its authored letter is a letter hit
  const pen = (await rest(`/search?q=${PEN_HANDLE}`)).body;
  assert.deepEqual(pen.residents, [], "no resident answers to the Pen's handle");
  assert.equal(pen.matches.residents, 0);
  assert.ok(JSON.stringify(pen.letters).includes(PEN_LETTER), "but the letter the Pen wrote is found, by its author");
  assert.ok(pen.matches.letters >= 1);
  // the cap is applied AFTER the exclusion: one fewer shown and counted, never a short bucket padded by the Pen
  const mcp = unwrap(await callTool("search_town", { q: "Resident" }, {}));
  assert.deepEqual([mcp.matches.residents, mcp.shown.residents], [ALL_PUBLIC.length, ALL_PUBLIC.length]);
  assert.ok(!JSON.stringify(mcp.residents).includes(PEN_HANDLE));
  const mcpPen = unwrap(await callTool("search_town", { q: PEN_HANDLE }, {}));
  assert.deepEqual([mcpPen.residents, mcpPen.matches.residents], [[], 0]);
  assert.ok(JSON.stringify(mcpPen.letters).includes(PEN_LETTER));
});

test("MAIL METRICS (REST /metrics/mail, MCP read_metrics): totals.residents is the public population's; every other total, the daily series and the active threads are unchanged", async (t) => {
  if (skip) return t.skip(skip);
  const { callTool } = await import("../src/mcp.mjs");
  const unwrap = (r) => (typeof r === "string" ? JSON.parse(r) : r?.content?.[0]?.text ? JSON.parse(r.content[0].text) : r);
  const viaRest = await rest("/metrics/mail");
  assert.equal(viaRest.status, 200, JSON.stringify(viaRest.body).slice(0, 200));
  assert.equal(viaRest.body.totals.residents, ALL_PUBLIC.length, "the Pen is not a resident in the mail pulse's count");
  const viaMcp = unwrap(await callTool("read_metrics", {}, {}));
  assert.equal(viaMcp.totals.residents, ALL_PUBLIC.length);
  // the other totals are the table's, untouched: the same read straight from the store, field for field
  const direct = (await store.storeAnswer((c) => store.metricsMail(c, {}))).out;
  const { residents: _r1, ...restDirect } = direct.totals, { residents: _r2, ...restRest } = viaRest.body.totals;
  assert.deepEqual(restRest, restDirect, "deliveries, bounces, letters and threads are not touched");
  assert.ok(Array.isArray(viaRest.body.days) && viaRest.body.days.length > 0);
  assert.deepEqual(viaRest.body.days, direct.days, "nor is the daily series");
  assert.equal(direct.totals.residents, ALL_PUBLIC.length);
});

test("REPEATED SAME-HEAD READS: the kept page is the filtered one, each reader has its own copy, and the operational roll is not changed by the kept page", async (t) => {
  if (skip) return t.skip(skip);
  store.__resetRosterForTest();
  const read = async (o = {}) => (await store.storeAnswer((c) => store.residentPage(c, o))).out;
  const first = await read({ limit: 200 });
  const second = await read({ limit: 200 });
  const third = await read({ limit: 200 });
  assert.deepEqual([handles(first), handles(second), handles(third)], [ALL_PUBLIC, ALL_PUBLIC, ALL_PUBLIC]);
  assert.deepEqual([store.residentCacheStats().page_misses, store.residentCacheStats().page_hits], [1, 2], "one composition, then hits: all of them filtered");
  first.residents.push({ handle: PEN_HANDLE });
  assert.deepEqual(handles(await read({ limit: 200 })), ALL_PUBLIC, "what a caller does to its copy never reaches the kept page");
  // the raw roster is untouched: the Pen is still an entry the roster holds (nothing was mutated or removed)
  const roster = (await store.storeAnswer((c) => store.roster(c))).out;
  assert.ok(roster.some((e) => e.handle === PEN_HANDLE), "the raw roster still holds the Pen");
});

test("OPERATIONAL MEMBERSHIP AND HISTORY ARE UNCHANGED: the operational roll and the position doors' handles still hold the Pen; its record and authored letters resolve", async (t) => {
  if (skip) return t.skip(skip);
  store.__resetRosterForTest();
  const op = (await store.storeAnswer((c) => store.residentList(c))).out;
  assert.ok(op.some((e) => e.handle === PEN_HANDLE), "residentList (refreshStoreRoll, the position doors) is the operational roll and keeps the Pen");
  assert.equal(op.length, ALL_PUBLIC.length + 1);
  const pub = (await store.storeAnswer((c) => store.publicResidentList(c))).out;
  assert.deepEqual(pub.map((e) => e.handle), ALL_PUBLIC);
  const rolled = await store.refreshStoreRoll({});
  assert.ok(rolled.includes(PEN_HANDLE), "the held roll the sync readers use still names the Pen");
  const rec = (await store.storeAnswer((c) => store.resident(c, PEN_HANDLE, {}))).out;
  assert.ok(rec, "direct record resolution: the Pen's own card still answers");
  assert.match(JSON.stringify(rec), /postmark-pen/);
  // the doorstep's latest arrivals are the PUBLIC residents': the Pen, though it is the newest joiner in this fixture, is not among them
  const door = (await store.storeAnswer((c) => store.doorstep(c, "amber", "ignored", { nowMs: Date.parse("2026-12-01T12:00:00Z"), fresh: {} }))).out;
  const arrivals = JSON.stringify(door.town.latestArrivals);
  assert.ok(arrivals.includes("illuminator"), `the doorstep names its arrivals: ${arrivals.slice(0, 200)}`);
  assert.equal(door.town.residents, ALL_PUBLIC.length, "and its resident count is the public roll's, not the table's");
  assert.ok(!arrivals.includes(PEN_HANDLE), "and the Pen is not one");
  // history it authored is not rewritten: the letter it wrote still lists under its authorship
  const letters = (await store.storeAnswer((c) => store.letterList(c, { resident: PEN_HANDLE, limit: 50 }))).out;
  assert.ok(JSON.stringify(letters).includes(PEN_LETTER), "the Pen's own letter still answers, by its author");
});
