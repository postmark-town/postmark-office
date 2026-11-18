// pos-1084-house-card-facts.test.mjs — POS-1084: the full house read carries each resident's holdings and own waiting-stance count (Darko, 2026-11-16: "Complete the read").
//
//   node --test test/pos-1084-house-card-facts.test.mjs
//
// The Hearth's two cards need, per resident, what the doorstep carries and the house's own blocks cannot give: `holds` (WLD-27, doorstep-bundle.mjs § holdsBlock, public,
// outside the owner gate) and the doorstep's `stances.stances_awaiting` (the resident's OWN count: the house-wide `stances` block counts the whole house's scope, and a page
// of candidates is not a total). The direct falsifier is on an invented house of three residents whose holdings and waiting counts differ, one count larger than a page of
// candidates, and an empty, an off and an unavailable case. Each fails on the code before this change (no `residents[h].stances`, no `residents[h].holds`).
//   1. PER-RESIDENT COUNTS ARE THE OWNING READER'S: each resident's count is `stancesForHandles([handle])`'s own `stances_awaiting`, different per resident, one larger than the page
//      bound, and not the house-wide block's count copied onto each; an unreadable resident says `unavailable` with NO count, never 0; a true zero stays 0 with its ground.
//   2. HOLDINGS ARE THE DOORSTEP'S PRODUCER: `residents[h].holds` equals `holdsBlock(h)` (the doorstep's own call), the block the doorstep puts under `holds`; empty hands add no key, an
//      unreadable record on an enabled feature says `unavailable` (never empty), and with the feature dark no resident carries the key.
//   3. SAME PUBLIC FACTS FOR EVERY CALLER: anonymous, the house's own key and a foreign key get the same two facts; the owner-only blocks keep their gate.
//   4. THE DEFAULT AND PAGED READS KEEP THEIR CONTRACT: the paged read carries neither fact; nothing in a full read that was there is gone.

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { storeIndexPooled } from "../src/town-index-store.mjs";
import { holdsBlock, doorstepBundle } from "../src/doorstep-bundle.mjs";
import { houseBundle, housePage, stanceCountsOf } from "../src/house-bundle.mjs";
import { DOORSTEP_STANCES } from "../src/queries.mjs";
import { CHESTS_CANDY_ENV } from "../src/chests-candy.mjs";
import { __setPoolForTest } from "../src/world2-acts.mjs";
import { poolFromClone, RECORD_ON } from "./registry-pool-stub.mjs";
import { indexStore } from "./helpers/office-under-test.mjs";
import { putValues, emptyTown } from "./fixture.mjs";

const AS_OF = "housefixture0000000000000000000000000000";
const HOUSE = "fixture-house";
const MEMBERS = ["r000", "r001", "r002"];
const NOW = Date.parse("2026-09-27T06:00:00Z");

const db = emptyTown();
{
  const meta = (...v) => putValues(db, "meta", v);
  meta("as_of", AS_OF); meta("town_path", "fixture"); meta("hydrated_counts", JSON.stringify({}));
  for (const h of MEMBERS) putValues(db, "residents", [h, JSON.stringify({ handle: h, is_office: false, last_active: "2026-09-20T10:00:00.000Z",
    address: { data: { since: "2026-01-01", joined: "2026-06-10" } }, window_state: { hand_set: "2026-08-24", sections: [{ title: "what I need", body: `pane of ${h}` }] } })]);
  putValues(db, "stamps", ["r000", 12, 30, 3]);
}
const IX = await indexStore(db, { db: "pos1084" });
const IX_RESTORE = await IX.useInProcess();
const scratch = mkdtempSync(join(tmpdir(), "postmark-pos1084-"));
mkdirSync(join(scratch, "tools"), { recursive: true });
writeFileSync(join(scratch, "tools", "households.json"), JSON.stringify({ households: {
  [HOUSE]: { name: "Fixture", human: "FIX", accounts: [{ login: "fixture", id: 1 }], residents: MEMBERS },
  other: { name: "Other", human: "OTH", accounts: [{ login: "other", id: 2 }], residents: ["r-stranger"] },
} }));
__setPoolForTest(poolFromClone(scratch));
const keep = { on: process.env.WORLD2_PG, url: process.env.WORLD2_PG_URL, chests: process.env[CHESTS_CANDY_ENV] };
process.env.WORLD2_PG = RECORD_ON.WORLD2_PG;
process.env.WORLD2_PG_URL = RECORD_ON.WORLD2_PG_URL;
const restoreEnv = (k, v) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; };
after(async () => {
  __setPoolForTest(null);
  restoreEnv("WORLD2_PG", keep.on); restoreEnv("WORLD2_PG_URL", keep.url); restoreEnv(CHESTS_CANDY_ENV, keep.chests);
  await IX_RESTORE(); await IX.stop();
  rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

// ── the invented world: each resident's waiting count and holdings DIFFER; the house scope's count is neither's ───────────────────────────────────────────────────────────
const WAITING = { r000: 12, r001: 0, r002: null /* the consent inbox could not be read */ };
const HOUSE_COUNT = 31;   // what the house scope answers: not any one resident's
const holdsOf = { r000: { holds: { count: 18, units: [{ label: "Pocket Comets", count: 18 }] }, chests: [], label: "Pocket Comets: 18" },
  r001: { holds: { count: 0, units: [] }, chests: [], label: null }, r002: "throws" };
const stancesFn = async (handles, opts) => {
  if (handles.length > 1) return { stances_awaiting: HOUSE_COUNT, stances_awaiting_ground: "the house", awaiting: [], standing: [], cursor: null, complete: true, set_downs_awaiting: [], limit: opts.limit };
  const [h] = handles;
  if (WAITING[h] == null) return { unavailable: "the consent inbox could not be read (the record did not answer)", awaiting: [], standing: [] };
  const n = WAITING[h];
  const rows = Array.from({ length: Math.min(n, opts.limit) }, (_, i) => ({ mark: `r-stranger/m${i}`, by: "r-stranger", on_your_ground: [`${h}/garden`] }));
  return { stances_awaiting: n, stances_awaiting_ground: `${h}'s ground`, awaiting: rows, cursor: n > opts.limit ? String(opts.limit) : null, complete: n <= opts.limit, standing: [], set_downs_awaiting: [] };
};
// The batch reader (world-stance.mjs § stanceCountsForHandles) answered from the same per-resident table: each invented resident is its own world-household here, so
// each asks for themselves. One house of several residents on one pass is § 5 below, and the old-against-new equivalence on a real world is test/pos-1084-one-pass.test.mjs.
const countsFn = async (handles) => new Map(await Promise.all(handles.map(async (h) => {
  const a = await stancesFn([h], { limit: DOORSTEP_STANCES });
  return [h, a.unavailable ? { unavailable: a.unavailable } : { stances_awaiting: a.stances_awaiting, stances_awaiting_ground: a.stances_awaiting_ground }];
})));
const readers = {
  stances: stancesFn,
  stanceCounts: countsFn,
  stakesFor: async () => ({ next_settlement: { at: "2026-09-28T00:00:00.000Z" }, count: 0, at_risk: 0, rows: [] }),
  lastActiveFor: async () => new Map(),
  walkers: async () => ({ at: 190.5, walkers: [] }),
  claimEffects: async () => ({ readable: true, store: "docket", events: [] }),
  residentHolds: async (h) => { if (holdsOf[h] === "throws") throw new Error("the record did not answer"); return holdsOf[h]; },
};
const ixFor = () => ({ ...storeIndexPooled(scratch), lastActiveFor: async () => new Map() });
const ctx = (over = {}) => ({ key: null, asOf: AS_OF, clone: scratch, odb: null, nowMs: NOW, ix: ixFor(), readers, ...over });
const OWNER = { household: HOUSE, handles: new Set(["r000", "r001"]) };
const FOREIGN = { household: "other", handles: new Set(["r-stranger"]) };
const json = (v) => JSON.parse(JSON.stringify(v));

test("1 · FALSIFIER, stances: each resident carries their OWN waiting count, taken whole (past one page), not the house scope's, and an unreadable one says so with no count", async () => {
  const h = await houseBundle({ household: HOUSE }, ctx());
  assert.ok(WAITING.r000 > DOORSTEP_STANCES, "the invented count is larger than one page of candidates");
  assert.equal(h.stances.stances_awaiting, HOUSE_COUNT, "the house block is the house scope's, unchanged");
  const r0 = h.residents.r000.stances, r1 = h.residents.r001.stances, r2 = h.residents.r002.stances;
  assert.equal(r0.stances_awaiting, 12, "r000's own count, more than a page's worth, not a page's length and not the house's");
  assert.equal(r0.stances_awaiting_ground, "r000's ground");
  assert.equal(r0.serves, "household.stances");
  assert.deepEqual(r0.args, { handle: "r000" });
  assert.equal(r1.stances_awaiting, 0, "a true zero is 0, with its ground");
  assert.equal(r1.stances_awaiting_ground, "r001's ground");
  assert.ok(!("stances_awaiting" in r2), "an unreadable inbox carries no count at all");
  assert.match(r2.unavailable, /consent inbox could not be read/);
  for (const who of MEMBERS) assert.notEqual(h.residents[who].stances.stances_awaiting, HOUSE_COUNT, `${who}: the house count is not copied onto a resident`);
  // each is the owning reader's own answer for that one resident (the doorstep's call: stancesForHandles([handle]))
  for (const who of MEMBERS) {
    const own = await stancesFn([who], { limit: DOORSTEP_STANCES });
    assert.equal(h.residents[who].stances.stances_awaiting, own.stances_awaiting, `${who}: the doorstep reader's count`);
  }
  // the reader that throws is unavailable too, never zero
  const boom = (await stanceCountsOf(["r000"], { readers: { stanceCounts: async () => { throw new Error("down"); } } })).r000;
  assert.ok(!("stances_awaiting" in boom) && /could not be read/.test(boom.unavailable));
});

test("2 · FALSIFIER, holdings: residents[h].holds is the doorstep's producer's block; empty hands add no key; an unreadable record is `unavailable`, never empty", async () => {
  process.env[CHESTS_CANDY_ENV] = "1";
  const h = await houseBundle({ household: HOUSE }, ctx());
  assert.deepEqual(json(h.residents.r000.holds), json(await holdsBlock("r000", { readers })), "the doorstep's own block");
  assert.deepEqual(h.residents.r000.holds, { serves: "world.holdings", args: { handle: "r000" }, ...holdsOf.r000 });
  assert.ok(!("holds" in h.residents.r001), "empty hands add no key, as on the doorstep");
  assert.match(h.residents.r002.holds.unavailable, /what r002 holds could not be read .* unknown, not empty/);
  assert.ok(!("holds" in h.residents.r002.holds), "and it is not a holdings block");
  assert.equal(h.residents.r002.holds.holds, undefined);
  // the doorstep itself puts the same block under `holds` (one producer, two callers)
  const d = await doorstepBundle("r000", { key: null, asOf: AS_OF, clone: scratch, odb: null, nowMs: NOW, ix: ixFor(), holdsReaders: readers });
  assert.deepEqual(json(d.holds), json(h.residents.r000.holds), "the doorstep's holds is the house's");
  delete process.env[CHESTS_CANDY_ENV];
  const off = await houseBundle({ household: HOUSE }, ctx());
  for (const who of MEMBERS) assert.ok(!("holds" in off.residents[who]), `${who}: feature dark, no holds key anywhere`);
  assert.equal(await holdsBlock("r000", { readers }), null);
});

test("3 · SAME PUBLIC FACTS FOR EVERY CALLER: anonymous, the house's own key and a foreign key; the owner gate is the doorstep's, unchanged", async () => {
  process.env[CHESTS_CANDY_ENV] = "1";
  const anon = await houseBundle({ household: HOUSE }, ctx());
  const owner = await houseBundle({ household: HOUSE }, ctx({ key: OWNER }));
  const foreign = await houseBundle({ household: HOUSE }, ctx({ key: FOREIGN }));
  for (const who of MEMBERS) for (const other of [owner, foreign]) {
    assert.deepEqual(json(other.residents[who].stances), json(anon.residents[who].stances), `${who}.stances`);
    assert.deepEqual(json(other.residents[who].holds ?? null), json(anon.residents[who].holds ?? null), `${who}.holds`);
  }
  assert.ok("unread" in owner.residents.r000 && !("unread" in anon.residents.r000) && !("unread" in foreign.residents.r000), "owner-only blocks keep their gate");
  delete process.env[CHESTS_CANDY_ENV];
});

test("3b · ONE CALL FOR THE WHOLE HOUSE: the house read asks the batch reader once, for every resident ashore, and each resident's block is that one answer's", async () => {
  const calls = [];
  const oneHouse = async (handles) => { calls.push([...handles]); return new Map(handles.map((h) => [h, { stances_awaiting: 7, stances_awaiting_ground: h === "r000" ? "resident:r000" : "household" }])); };
  const h = await houseBundle({ household: HOUSE }, ctx({ readers: { ...readers, stanceCounts: oneHouse } }));
  assert.deepEqual(calls, [MEMBERS], "one call, with all three residents (a per-resident loop would be three calls)");
  assert.equal(h.residents.r000.stances.stances_awaiting_ground, "resident:r000");
  for (const who of MEMBERS) {
    assert.equal(h.residents[who].stances.stances_awaiting, 7, `${who}: the house's one pass, their own block`);
    assert.deepEqual(h.residents[who].stances.args, { handle: who });
  }
  assert.equal(h.residents.r001.stances.stances_awaiting_ground, "household");
});

test("4 · THE PAGED READ KEEPS ITS CONTRACT, and the full read keeps what it had", async () => {
  const page = await housePage({ household: HOUSE }, ctx());
  assert.ok(!JSON.stringify(page).includes("stances_awaiting_ground"), "the paged rows carry neither fact");
  for (const m of page.members) assert.ok(!("holds" in m) && !("stances" in m));
  const full = await houseBundle({ household: HOUSE }, ctx());
  for (const k of ["stances", "outcomes", "stakes", "stands", "outboxes", "quests", "residents", "ashore", "last_active"]) assert.ok(k in full, `the full read still has ${k}`);
  assert.deepEqual(Object.keys(full.residents.r000).filter((k) => ["mail", "awaiting", "stamps", "window", "pending_outbox", "counts", "stands"].includes(k)).sort(),
    ["awaiting", "counts", "mail", "pending_outbox", "stamps", "stands", "window"]);
  assert.match(full.shape, /residents\[<handle>\]\.stances/);
  assert.match(full.shape, /residents\[<handle>\]\.holds/);
});
