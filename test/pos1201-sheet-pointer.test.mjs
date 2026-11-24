// pos1201-sheet-pointer.test.mjs — POS-1201: the profile points to its official sheet.
//
// Darko: "what made it tough to know where to find the residents' official appearance sheets?" The resident card now carries, beside
// `appearance`, `official_sheet: { exists, anchor, why?, read }` on BOTH skins (REST /residents/{h} and the MCP read_resident the town
// facade reads), from ONE helper (depictions.mjs § sheetPointerOf) that is `sheetRead`'s own answer narrowed: the anchor is anchorOf's
// choice, so the skins cannot invent different likeness rules. A failed lookup is not known absence: no pointer at all.
//
// Two layers. The helper against a real store and the canonical sheet read (a known sheet, none, a likeness not yet given, a failed
// lookup). Then a real office, both skins over HTTP, each agreeing with the canonical `/residents/{h}/sheet` read, and a lookup that
// really fails leaving the card without a pointer rather than saying "none". Every house, handle and URL here is invented.
//
//   node --import ./test/helpers/sparse-guard.mjs --test test/pos1201-sheet-pointer.test.mjs

import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

import { keepDepiction, sheetPointerOf, sheetRead, TOWN } from "../src/depictions.mjs";
import { fixtureTown } from "./fixture.mjs";
import { bootOnFreePort } from "./spawn-office.mjs";
import { indexStore } from "./helpers/office-under-test.mjs";
import { seedStaticKeys } from "./helpers/static-keys.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const KEY = "pos1201-key";
const M = "https://media.postmark.town/media";
const OWN = `${M}/lantern-row/own-newest.webp`, OWN_OLD = `${M}/lantern-row/own-old.webp`, TOWN_URL = `${M}/the-town/seed.webp`, HELD = `${M}/moss-cottage/held.webp`;

// the fixture town's three residents: wright (house yes, an own sheet and the town's), limen (house yes, no sheet), postmaster (no answer, a sheet)
async function seed(s) {
  const o = await s.connect("world2_owner");
  try {
    await o.query("TRUNCATE depictions, households CASCADE");
    await o.query(`INSERT INTO households (slug, ord, name, residents, since, declared_by, likeness) VALUES
      ('lantern-row', 0, 'Lantern Row', ARRAY['wright'], '2026-07-01', 'wright', '{"answer":"yes"}'),
      ('mill-house', 1, 'Mill House', ARRAY['limen'], '2026-07-01', 'limen', '{"answer":"yes"}'),
      ('moss-cottage', 2, 'Moss Cottage', ARRAY['postmaster'], '2026-07-01', 'postmaster', NULL)`);
  } finally { await o.end(); }
  const api = await s.connect("office_api");
  try {
    const q = async (t, p) => (await api.query(t, p)).rows;
    await keepDepiction({ subject: "wright", url: TOWN_URL, made_by: TOWN, source: "a seed" }, {}, q);
    await keepDepiction({ subject: "wright", url: OWN_OLD, made_by: "lantern-row", source: "the household's own" }, {}, q);
    await keepDepiction({ subject: "wright", url: OWN, made_by: "lantern-row", source: "the household's own" }, {}, q);
    await keepDepiction({ subject: "postmaster", url: HELD, made_by: "moss-cottage", source: "the household's own" }, {}, q);
  } finally { await api.end(); }
}

let IX = null, tmp = null, proc = null, base = null, skip = false;

before(async () => {
  IX = await indexStore(fixtureTown(), { db: "pos1201_pointer" });
  if (IX?.store?.skip) { skip = IX.store.skip; return; }
  await seed(IX.store);
  tmp = mkdtempSync(join(tmpdir(), "pos1201-"));
  const { openDynamic } = await import("../src/dynamic-store.mjs");
  openDynamic(join(tmp, "dynamic.db")).close();
  const { openOauthDb } = await import("../src/oauth.mjs");
  openOauthDb(join(tmp, "oauth.db")).close();
  seedStaticKeys(join(tmp, "oauth.db"), `${KEY}=keemin:wright`);
  const booted = await bootOnFreePort((port) => spawn(process.execPath, [
    join(ROOT, "src", "server.mjs"), "--port", String(port),
    "--oauth-db", join(tmp, "oauth.db"), "--roles-db", join(tmp, "roles.db"),
  ], {
    env: { ...process.env, ...IX.env, WORLD_GRAPH_NONE: "1", OFFICE_READ_WORKERS: "1", WORLD_APEX: "1",
      WORLD_DYNAMIC_DB: join(tmp, "dynamic.db"), TOWN_CLONE: join(tmp, "town"), TOWN_PUSH: "" },
    stdio: ["ignore", "pipe", "pipe"],
  }), { budgetMs: 30_000 });
  proc = booted.child;
  base = `http://127.0.0.1:${booted.port}`;
  let ready = 0;
  for (let i = 0; i < 300 && ready !== 1; i++) {
    ready = (await (await fetch(`${base}/release`)).json()).read_workers?.ready ?? 0;
    if (ready !== 1) await new Promise((r) => setTimeout(r, 200));
  }
  assert.equal(ready, 1, "the office's worker never came up");
});

after(async () => {
  if (proc && proc.exitCode === null) { const gone = new Promise((ok) => proc.on("exit", ok)); proc.kill(); await gone; }
  await IX?.stop?.();
  if (tmp) rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

const rest = async (path) => { const r = await fetch(`${base}${path}`); return { status: r.status, body: await r.json() }; };
const mcp = async (name, args) => {
  const r = await fetch(`${base}/mcp`, { method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${KEY}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) });
  const text = await r.text();
  const j = JSON.parse(text.startsWith("{") ? text : text.split("\n").find((l) => l.startsWith("data:")).slice(5));
  return JSON.parse(j.result.content[0].text);
};

/** What the pointer must say, from the CANONICAL sheet read (never a second rule). */
const canonical = async (handle) => {
  const s = await rest(`/residents/${handle}/sheet`);
  assert.equal(s.status, 200, `the canonical sheet read for ${handle}`);
  return { exists: (s.body.sheets ?? []).length > 0, anchor: s.body.anchor ?? null, ...(s.body.anchor ? {} : { why: s.body.anchor_why }), read: `GET /residents/${handle}/sheet` };
};

test("a known sheet: both skins carry the canonical anchor (the household's own newest, never the town's), exists true, no why", async (t) => {
  if (skip) return t.skip(skip);
  const want = await canonical("wright");
  assert.deepEqual(want, { exists: true, anchor: OWN, read: "GET /residents/wright/sheet" }, "the canonical read picks the household's own newest sheet");
  const viaRest = await rest("/residents/wright");
  assert.equal(viaRest.status, 200);
  assert.deepEqual(viaRest.body.official_sheet, want, "REST profile");
  const viaMcp = await mcp("read_resident", { handle: "wright" });
  assert.deepEqual(viaMcp.official_sheet, want, "MCP read_resident (what town { read: 'resident' } reaches)");
  assert.equal(viaRest.body.handle, "wright", "existing card fields intact beside it");
  assert.equal(viaMcp.handle, "wright");
  assert.doesNotMatch(JSON.stringify(viaRest.body.official_sheet), /sheets|template|how|held_until/, "a pointer, not the sheet catalogue");
});

test("no sheet: exists false; a household's own sheet whose likeness is not given: exists TRUE with no anchor; the two whys stay distinct, on both skins", async (t) => {
  if (skip) return t.skip(skip);
  const expect = { limen: { exists: false }, postmaster: { exists: true } };   // limen has none; postmaster's household has its own sheet but no yes
  for (const handle of ["limen", "postmaster"]) {
    const want = await canonical(handle);
    assert.equal(want.exists, expect[handle].exists, `${handle}: exists follows the canonical read's shown sheets`);
    assert.equal(want.anchor, null, `${handle}: no anchor without the likeness (consent unchanged)`);
    assert.ok(typeof want.why === "string" && want.why.length > 0);
    assert.deepEqual((await rest(`/residents/${handle}`)).body.official_sheet, want, `REST ${handle}`);
    assert.deepEqual((await mcp("read_resident", { handle })).official_sheet, want, `MCP ${handle}`);
  }
  const limen = (await canonical("limen")).why, post = (await canonical("postmaster")).why;
  assert.match(limen, /no sheet yet|no anchor: there is no sheet/, "no sheet is not the same sentence as");
  assert.match(post, /has not said yes to the likeness question/, "a likeness not given");
  assert.notEqual(limen, post, "the two refusals stay distinct");
});

test("a sheet the canonical read HIDES is not counted: the town's sheet held for a household with no yes is exists false, the same as no sheet", async (t) => {
  if (skip) return t.skip(skip);
  const o = await IX.store.connect("world2_owner");
  const api = await IX.store.connect("office_api");
  try {
    const q = async (t2, p) => (await api.query(t2, p)).rows;
    await keepDepiction({ subject: "limen", url: `${M}/the-town/held-for-limen.webp`, made_by: TOWN, source: "a seed" }, {}, q);
    await o.query("UPDATE households SET likeness = NULL WHERE slug = 'mill-house'");   // limen's household has not said yes: the town's sheet is held
    const canon = (await rest("/residents/limen/sheet")).body;
    assert.deepEqual(canon.sheets, [], "the public read shows none of it");
    assert.ok(canon.held_until_yes >= 1, "and says it is held");
    const want = await canonical("limen");
    assert.equal(want.exists, false, "a held sheet is not a shown sheet");
    assert.deepEqual((await rest("/residents/limen")).body.official_sheet, want, "REST");
    assert.deepEqual((await mcp("read_resident", { handle: "limen" })).official_sheet, want, "MCP");
  } finally {
    await o.query("UPDATE households SET likeness = '{\"answer\":\"yes\"}' WHERE slug = 'mill-house'");
    await o.query("DELETE FROM depictions WHERE subject = 'limen'").catch(() => {});
    await o.end(); await api.end();
  }
});

test("a lookup that really fails leaves no pointer on either skin: it is not known absence, and the rest of the card stands", async (t) => {
  if (skip) return t.skip(skip);
  const o = await IX.store.connect("world2_owner");
  try {
    await o.query("ALTER TABLE depictions RENAME TO depictions_away");
    try {
      const viaRest = await rest("/residents/wright");
      assert.equal(viaRest.status, 200, "the card stands");
      assert.equal(viaRest.body.handle, "wright");
      assert.equal("official_sheet" in viaRest.body, false, "REST: no pointer, rather than exists:false");
      const viaMcp = await mcp("read_resident", { handle: "wright" });
      assert.equal(viaMcp.handle, "wright");
      assert.equal("official_sheet" in viaMcp, false, "MCP: the same");
    } finally { await o.query("ALTER TABLE depictions_away RENAME TO depictions"); }
  } finally { await o.end(); }
});

test("the helper alone, against the store and the canonical read: the same answer for a known sheet, none and not-given; null on a failed lookup", async (t) => {
  if (skip) return t.skip(skip);
  const api = await IX.store.connect("office_api");
  const query = async (t2, p) => (await api.query(t2, p)).rows;
  const env = {};
  const houses = { "lantern-row": { residents: ["wright"], likeness: { answer: "yes" } }, "moss-cottage": { residents: ["postmaster"], likeness: null } };
  const registry = { houses, houseOf: (h) => Object.entries(houses).find(([, r]) => r.residents.includes(h))?.[0] ?? null };
  try {
    for (const handle of ["wright", "postmaster", "nobody"]) {
      const sheet = await sheetRead({ handle }, { env, query, registry });
      const got = await sheetPointerOf(handle, { env, query, registry });
      assert.equal(got.exists, sheet.sheets.length > 0, handle);
      assert.equal(got.anchor, sheet.anchor ?? null, handle);
      assert.equal(got.why, sheet.anchor_why, handle);
    }
    assert.equal(await sheetPointerOf("wright", { env, query: async () => null, registry }), null, "the record cannot be asked");
    assert.equal(await sheetPointerOf("", { env, query, registry }), null, "no handle, no pointer");
  } finally { await api.end(); }
});
