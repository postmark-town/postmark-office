// pos-1070-house-companions.test.mjs — the full house read carries each declared member's PUBLIC outbox and quest board (POS-1070; POS-1061, Darko 2026-11-15 17:25 EST:
// "almost 2 minutes for the entire thing to load, which is not really all that usable"; Wright 23:37Z: "Rivet completes the office's full house read … with the companion
// data the Hearth still asks for separately, each resident's outbox and quests, so one office read returns what readHouse() returns today").
//
//   node --test test/pos-1070-house-companions.test.mjs
//
// The site's readHouse() asks, per declared handle: the doorstep (the bearer only on an owned one), `GET /mail/<h>?box=outbox` and `GET /quests/<h>` (both ALWAYS anonymous).
// The full house read already answers the doorstep half; these tests hold the other two to the legacy doors' own reads, on one fixture:
//   1. THE FALSIFIER: the full house answer has nonempty `outboxes` and `quests` maps keyed by every DECLARED member (the house's order), and fails on the code before this change;
//   2. EQUAL TO THE CANONICAL LEGACY READS: `outboxes[h]` is `mailList(h, "outbox").letters` (the bare array), `quests[h]` is `questIndexRows` then `questBoardOfRows` (after the
//      connection is back), byte for byte, for every declared member, including one the town index holds no resident card for;
//   3. ALWAYS ANONYMOUS: the maps are the same for an anonymous caller, the house's own key and a foreign key, while the doorstep's owner gate is untouched (owner-only blocks
//      still ride only the owner's residents);
//   4. UNAVAILABLE IS NULL, EMPTY IS EMPTY: a companion that could not be read is `null` for that member only; a successful empty outbox is `[]`;
//   5. THE REAL DISPATCH: household { read: "house", args: { full: true } } and a GET's `full: "true"` carry the maps; the default page (ten members) does not, and is unchanged;
//   6. ONE OFFICE REQUEST: exactly one outbox read and one board read per declared member, and no fetch (no HTTP fan-out, internal or otherwise).

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import * as store from "../src/town-index-store.mjs";
import { houseBundle, housePage } from "../src/house-bundle.mjs";
import { householdApex } from "../src/household-apex.mjs";
import { houseCompanions } from "../src/house-companions.mjs";
import { __setPoolForTest } from "../src/world2-acts.mjs";
import { poolFromClone, RECORD_ON } from "./registry-pool-stub.mjs";
import { indexStore } from "./helpers/office-under-test.mjs";
import { fixtureTown, put, putValues } from "./fixture.mjs";
import { townClone, townModuleUrl } from "./fixture-paths.mjs";

const TOWN = townClone();
const SKIP = TOWN ? false : "no town clone beside the office: the quest board reads the town's own tools from it";
const AS_OF = "fixturesha000000000000000000000000000000";
const NOW = Date.parse("2026-07-13T12:00:00Z");

// ── the fixture: the house `keemin` declares wright, limen, harbor (no resident card in the index, but letters it wrote and a quest row) and quiet (nothing at all) ─────────
const db = fixtureTown();
const meta = (...v) => putValues(db, "meta", v);
if (TOWN) {
  const { townDay } = await import(townModuleUrl("tools", "quest-progress.mjs"));
  meta("quest_registry", readFileSync(join(TOWN, "quest-registry.json"), "utf8"));
  meta("quest_day", townDay());
}
const qp = (...v) => putValues(db, "quest_progress", v, ["handle", "send", "receive", "house_size", "house_send", "house_receive", "sent_to", "heard_from"]);
qp("wright", 2, 1, 3, 2, 1, JSON.stringify(["limen", "errant"]), JSON.stringify(["limen"]));
qp("limen", 0, 3, 3, 1, 3, JSON.stringify([]), JSON.stringify(["wright"]));
qp("harbor", 1, 0, 3, 1, 0, JSON.stringify(["limen"]), JSON.stringify([]));
// harbor has no `residents` row, so it is a declared member the index holds no card for, and it wrote one letter that has not sailed
put(db, "letters", { id: "harbor-2026-07-10-to-limen-from-the-water", from_h: "harbor", to_h: "limen", date: "2026-07-10", thread: "new", box: "outbox", owner: "harbor",
  path: "WHITE_PAGES/harbor/outbox/letter-2026-07-10-to-limen-from-the-water.md",
  json: JSON.stringify({ id: "harbor-2026-07-10-to-limen-from-the-water", from: "harbor", to: "limen", date: "2026-07-10", body: "# From the water\n\nThe tide is out." }), delivered_at: null });

const MEMBERS = ["wright", "limen", "harbor", "quiet"];
const IX = await indexStore(db, { db: "pos1070" });
const IX_RESTORE = await IX.useInProcess();
const scratch = mkdtempSync(join(tmpdir(), "postmark-pos1070-"));
mkdirSync(join(scratch, "tools"), { recursive: true });
const HOUSES = {
  keemin: { name: "Keemin", human: "KEE", accounts: [{ login: "keemin", id: 1 }], residents: MEMBERS },
  other: { name: "Other", human: "OTH", accounts: [{ login: "other", id: 2 }], residents: ["postmaster"] },
};
writeFileSync(join(scratch, "tools", "households.json"), JSON.stringify({ households: HOUSES }));
__setPoolForTest(poolFromClone(scratch));
const keep = { on: process.env.WORLD2_PG, url: process.env.WORLD2_PG_URL };
process.env.WORLD2_PG = RECORD_ON.WORLD2_PG;
process.env.WORLD2_PG_URL = RECORD_ON.WORLD2_PG_URL;
after(async () => {
  __setPoolForTest(null);
  if (keep.on === undefined) delete process.env.WORLD2_PG; else process.env.WORLD2_PG = keep.on;
  if (keep.url === undefined) delete process.env.WORLD2_PG_URL; else process.env.WORLD2_PG_URL = keep.url;
  await IX_RESTORE(); await IX.stop();
  rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

// the world's reads, stubbed (they are not the companions' business), and the registry injected for the assembler
const readers = {
  stances: async (_h, opts) => ({ stances_awaiting: 0, awaiting: [], standing: [], cursor: null, complete: true, set_downs_awaiting: [], limit: opts.limit }),
  stakesFor: async () => ({ next_settlement: { at: "2026-07-15T00:00:00.000Z" }, count: 0, at_risk: 0, rows: [] }),
  walkers: async () => ({ at: 190.5, walkers: [] }),
  claimEffects: async () => ({ readable: true, store: "docket", events: [] }),
  claimState: async () => null,
  registry: { registry: { households: HOUSES }, pins: {} },
};
const OWNER = { household: "keemin", handles: new Set(["wright", "limen"]) };
const FOREIGN = { household: "other", handles: new Set(["postmaster"]) };
const ctxFor = (key, over = {}) => ({ key, asOf: AS_OF, clone: TOWN ?? scratch, odb: null, nowMs: NOW, readers, ...over });
const bundle = (key, over) => houseBundle({ household: "keemin" }, ctxFor(key, { ix: store.storeIndexPooled(TOWN ?? scratch), ...over }));
const json = (v) => JSON.parse(JSON.stringify(v));

/** The canonical legacy reads, exactly as the legacy public doors call them (server.mjs `/mail/<h>?box=outbox` and `/quests/<h>`). */
async function legacyOutbox(handle) { return (await store.storeAnswer((c) => store.mailList(c, handle, "outbox", {}))).out.letters; }
async function legacyBoard(handle) {
  return (await store.storeAnswer((c) => store.questIndexRows(c, handle), { then: (rows) => store.questBoardOfRows(rows, TOWN) })).out;
}

test("1 · FALSIFIER: the full house carries nonempty outbox and quest maps for EVERY declared member, in the house's order, and `residents`/`not_ashore` keep their meaning", { skip: SKIP }, async () => {
  const h = await bundle(null);
  assert.equal(h.read, "house", JSON.stringify(h).slice(0, 200));
  assert.deepEqual(Object.keys(h.outboxes), MEMBERS, "every declared member, in the house's order, not only those ashore");
  assert.deepEqual(Object.keys(h.quests), MEMBERS);
  assert.deepEqual(h.ashore, ["wright", "limen"]);
  assert.deepEqual(h.not_ashore, ["harbor", "quiet"], "not_ashore is unchanged");
  assert.deepEqual(Object.keys(h.residents), ["wright", "limen"], "residents is unchanged: no card, no resident block");
  assert.ok(h.outboxes.wright.length > 0 && h.outboxes.limen.length > 0, "the old full house had no such block: this is nonempty");
  assert.ok(h.quests.wright && Object.keys(h.quests.wright).length > 0, "a real board, not a stand-in");
  assert.match(h.shape, /`outboxes\[<handle>\]` and `quests\[<handle>\]` are each declared member's PUBLIC outbox/);
});

test("2 · EQUAL TO THE CANONICAL LEGACY READS, byte for byte, for every declared member (a member with no resident card included)", { skip: SKIP }, async () => {
  const h = await bundle(null);
  for (const handle of MEMBERS) {
    assert.deepEqual(json(h.outboxes[handle]), json(await legacyOutbox(handle)), `outbox ${handle}: mailList(…, "outbox").letters, the bare array`);
    assert.deepEqual(json(h.quests[handle]), json(await legacyBoard(handle)), `quest board ${handle}: questIndexRows then questBoardOfRows`);
  }
  assert.ok(Array.isArray(h.outboxes.harbor) && h.outboxes.harbor.length === 1 && h.outboxes.harbor[0].id === "harbor-2026-07-10-to-limen-from-the-water",
    "a declared member with no resident card keeps the outbox its legacy door answers");
  assert.ok(h.quests.harbor?.quests !== undefined || Object.keys(h.quests.harbor ?? {}).length > 0, "and its board");
  assert.deepEqual(h.outboxes.quiet, [], "a successful empty outbox is [], not null");
});

test("3 · ALWAYS ANONYMOUS: the maps are identical for anonymous, the house's own key and a foreign key; the doorstep's owner gate is unchanged", { skip: SKIP }, async () => {
  const anon = await bundle(null);
  const owner = await bundle(OWNER);
  const foreign = await bundle(FOREIGN);
  for (const other of [owner, foreign]) {
    assert.deepEqual(json(other.outboxes), json(anon.outboxes));
    assert.deepEqual(json(other.quests), json(anon.quests));
  }
  // no owner-enriched letter rides the outbox: the rows are the public list's own keys
  const publicKeys = Object.keys((await legacyOutbox("wright"))[0]);
  for (const l of owner.outboxes.wright) assert.deepEqual(Object.keys(l), publicKeys);
  // the owner gate is the doorstep's, as before: owner-only blocks ride only a key that holds that resident
  assert.ok("unread" in owner.residents.wright, "the owner's own resident carries the owner-only block");
  assert.ok(!("unread" in anon.residents.wright) && !("unread" in foreign.residents.wright), "an anonymous or foreign caller does not");
  assert.deepEqual(Object.keys(anon.residents), Object.keys(owner.residents));
});

test("4 · UNAVAILABLE IS NULL, EMPTY IS EMPTY: one companion that cannot be read is null for that member only", { skip: SKIP }, async () => {
  const real = store.storeIndexPooled(TOWN);
  const lines = [];
  const ix = { ...real,
    mailList: async (handle, box, opts) => { if (handle === "limen") throw new Error("the outbox read broke"); return real.mailList(handle, box, opts); },
    questBoard: async (handle, opts) => { if (handle === "wright") throw Object.assign(new Error("the board broke"), { name: "TownIndexUnreachable" }); return real.questBoard(handle, opts); } };
  const { outboxes, quests } = await houseCompanions(MEMBERS, { ix, log: (l) => lines.push(l) });
  assert.equal(outboxes.limen, null, "the unavailable outbox is null");
  assert.equal(quests.wright, null, "the unavailable board is null, even when the store says unreachable: that member's, never the house's");
  assert.deepEqual(outboxes.quiet, [], "a successful empty outbox is not null");
  assert.ok(Array.isArray(outboxes.wright) && outboxes.wright.length > 0 && quests.limen && Object.keys(quests.limen).length > 0, "every other member's companions are untouched");
  assert.equal(lines.length, 2, "each failure is logged once, by name");
  assert.ok(lines.every((l) => !/broke/.test(l)), "and never by the error's own text");
  // through the whole bundle too: the house still answers, the one member's block is null
  const h = await houseBundle({ household: "keemin" }, ctxFor(null, { ix }));
  assert.equal(h.read, "house");
  assert.equal(h.outboxes.limen, null);
  assert.ok(h.outboxes.wright.length > 0);
});

test("5 · THE REAL DISPATCH: household { read: \"house\", full: true } carries the maps (args and a GET's string); the default page does not, and still pages ten", { skip: SKIP }, async () => {
  const door = (args, key = null) => householdApex(args, key, { clone: TOWN, asOf: AS_OF });
  const viaArgs = await door({ read: "house", args: { household: "keemin", full: true } });
  assert.deepEqual(Object.keys(viaArgs.outboxes ?? {}), MEMBERS, JSON.stringify(viaArgs).slice(0, 300));
  assert.deepEqual(Object.keys(viaArgs.quests ?? {}), MEMBERS);
  const viaGet = await door({ read: "house", household: "keemin", full: "true" });
  assert.deepEqual(Object.keys(viaGet.outboxes ?? {}), MEMBERS);
  const viaOwner = await door({ read: "house", args: { household: "keemin", full: true } }, OWNER);
  assert.deepEqual(json(viaOwner.outboxes), json(viaArgs.outboxes), "the real door's owner call is the anonymous call's maps");
  assert.deepEqual(json(viaOwner.quests), json(viaArgs.quests));
  // the default page: ten members at most, no companions, no new field
  const page = await door({ read: "house", household: "keemin" });
  assert.ok(Array.isArray(page.members), JSON.stringify(page).slice(0, 200));
  assert.ok(!("outboxes" in page) && !("quests" in page) && !("residents" in page), "paging is unchanged");
  assert.deepEqual(page.members.map((m) => m.handle), ["wright", "limen"], "the page lists the members ashore, as before");
  const direct = await housePage({ household: "keemin" }, ctxFor(null, { ix: store.storeIndexPooled(TOWN) }));
  assert.ok(!("outboxes" in direct));
});

test("6 · ONE OFFICE REQUEST: one outbox read and one board read per declared member, and no fetch", { skip: SKIP }, async () => {
  const real = store.storeIndexPooled(TOWN);
  const calls = { mailList: [], questBoard: [] };
  const ix = { ...real,
    mailList: async (handle, box, opts) => { calls.mailList.push([handle, box]); return real.mailList(handle, box, opts); },
    questBoard: async (handle, opts) => { calls.questBoard.push([handle, opts]); return real.questBoard(handle, opts); } };
  const realFetch = globalThis.fetch;
  let fetched = 0;
  globalThis.fetch = (...a) => { fetched += 1; return realFetch(...a); };
  try { await houseBundle({ household: "keemin" }, ctxFor(null, { ix })); } finally { globalThis.fetch = realFetch; }
  assert.deepEqual(calls.mailList, MEMBERS.map((m) => [m, "outbox"]), "each declared member's outbox, once");
  // the companion's board is the canonical one (no options); the doorstep's own compact board (`givers: false`, queries.mjs) is a different read and is not what rides here
  assert.deepEqual(calls.questBoard.filter(([, opts]) => opts === undefined).map(([h]) => h), MEMBERS, "each declared member's canonical board, once");
  assert.ok(calls.questBoard.filter(([, opts]) => opts !== undefined).every(([, opts]) => opts.givers === false), "the only other board reads are the doorstep's compact ones");
  assert.equal(fetched, 0, "no HTTP fan-out from the office, internal or external");
});
