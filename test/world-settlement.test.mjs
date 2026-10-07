// world-settlement.test.mjs — /world/state SERVES THE NEWEST SETTLEMENT, MINUS
// WHAT HAS BEEN OPPOSED (POS-359; rulings R2, R3, R5, R10, R16).
//
//   node --test test/world-settlement.test.mjs
//
// THE RIG. A real Postgres (test/helpers/embedded-store.mjs) holding two
// settlements, each naming a snapshot, and the office's own read of them as
// `office_api`. The engine is the world's own, materialised from the office's
// world clone at its HEAD (the snapshot's law_sha), so a return is the engine's
// return path, never a stand-in. One test hands a stand-in engine instead, to
// prove the town's words reach the engine as its own `townWords` argument,
// because the pinned world clone's engine predates world#146.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startStore } from "./helpers/embedded-store.mjs";
import { foldOfSnapshot, canonicalJson } from "../src/world-snapshot.mjs";
import { settlementRig, WORLD, LAW_SHA, TOWN_SHA, git } from "./helpers/settlement-seed.mjs";
import {
  servedSettlement, settlementOrFile, settlementNumberOf, withHolderWords, vetoKey,
  resetSettlementCaches, foldText,
} from "../src/world-settlement.mjs";

const store = await startStore({ db: "world_settlement_test" });
const skip = store.skip ?? false;
const { owner, asOffice, seed, speak } = settlementRig(store);

const serve = (opts = {}) => asOffice((p) => servedSettlement(p, { worldRepo: WORLD, ...opts }));
// The marks a resident placed (the class mark the law brings is the law's, and stands in every fold).
const ids = (state) => state.marks.map((m) => m.id).filter((id) => id !== "the-town/hall").sort();

test("a settlement is named S<n>; anything else refuses, and absent means the newest", () => {
  assert.equal(settlementNumberOf("S95"), 95);
  assert.equal(settlementNumberOf("s7"), 7);
  assert.equal(settlementNumberOf("12"), 12);
  assert.equal(settlementNumberOf(""), null);
  assert.equal(settlementNumberOf(null), null);
  assert.throws(() => settlementNumberOf("newest"), (e) => e.code === 422);
  assert.throws(() => settlementNumberOf("S-1"), (e) => e.code === 422);
});

test("the newest settlement is served, as_of names it, and its World is the snapshot's fold, built once and kept", { skip }, async () => {
  const { s11 } = await seed();
  const first = await serve();
  assert.equal(first.meta.source, "settlement");
  assert.equal(first.meta.as_of.settlement, "S11");
  assert.equal(first.meta.as_of.digest, s11);
  assert.equal(first.meta.as_of.window, 501);
  assert.match(first.meta.built ?? "", /derived from the snapshot's sources/);
  assert.deepEqual(ids(first), ["ann/plot", "bo/shed", "bo/shed-name", "cy/bench", "cy/yard"]);

  // The served World IS the snapshot's: the one derivation --verify runs.
  const { materializeAtRef } = await import("../src/world-branches.mjs");
  const { filingAt } = await import("../src/world-filing-order.mjs");
  const { pathToFileURL } = await import("node:url");
  const tools = materializeAtRef(WORLD, LAW_SHA, "tools");
  const { fold } = await import(pathToFileURL(join(tools, "tools", "marks-fold.mjs")).href);
  const header = await asOffice(async (p) => (await p.query("SELECT * FROM world_snapshots WHERE id = 2")).rows[0]);
  const { state } = await asOffice((p) => foldOfSnapshot(p, header, { fold, filing: filingAt(WORLD, LAW_SHA) }));
  const { meta, ...served } = first;
  assert.equal(canonicalJson(served), canonicalJson(state), "the served World equals the snapshot's fold");

  // Kept under the snapshot's digest, as office_api, and read back from there.
  const [kept] = await owner(async (c) => (await c.query("SELECT state FROM world_snapshot_folds WHERE digest = $1", [s11])).rows);
  assert.ok(kept, "the World was kept in world_snapshot_folds");
  assert.equal(canonicalJson(JSON.parse(kept.state)), canonicalJson(state));
  resetSettlementCaches();
  const second = await serve();
  assert.equal(second.meta.built, undefined, "the second read comes from the cache");
  assert.equal(canonicalJson({ ...second, meta: null }), canonicalJson({ ...first, meta: null }));
});

test("?settlement=S<n> serves that settlement; one the store holds no snapshot for refuses by name", { skip }, async () => {
  const { s10 } = await seed();
  const older = await serve({ settlement: "S10" });
  assert.equal(older.meta.as_of.settlement, "S10");
  assert.equal(older.meta.as_of.digest, s10);
  assert.deepEqual(ids(older), ["ann/plot", "cy/bench"]);
  assert.equal(await serve({ settlement: "S12" }), null);
  await assert.rejects(
    settlementOrFile({ asked: "S12", engaged: true, pool: async () => ({ query: (...a) => asOffice((p) => p.query(...a)) }), worldRepo: WORLD, fileAnswer: async () => ({ marks: [] }) }),
    (e) => e.code === 404 && /S12/.test(e.defect));
});

test("a newer settlement with no snapshot yet is said, not skipped silently", { skip }, async () => {
  await seed();
  await owner((c) => c.query("INSERT INTO settlements (number, tag_sha, published_at, window_id) VALUES (12, $1, now(), NULL)", [LAW_SHA]));
  const r = await serve();
  assert.equal(r.meta.as_of.settlement, "S11");
  assert.equal(r.meta.newer_unsealed, "S12");
});

test("a parcel holder's opposed word takes the mark and its subtree away AT ONCE, through the engine's own return path (R10, R16)", { skip }, async () => {
  await seed();
  const before = await serve();
  assert.ok(ids(before).includes("bo/shed"));
  await speak({ actor: "ann", on: "bo/shed", stance: "opposed" });
  resetSettlementCaches();                                   // the refresh, without waiting for it
  const after = await serve();
  assert.equal(after.meta.as_of.settlement, "S11", "still the same settlement: nothing waited for a clearing");
  assert.deepEqual(ids(after), ["ann/plot", "cy/bench", "cy/yard"], "the shed and the name that continues it are gone");
  const ret = after.returned.find((r) => r.mark === "bo/shed");
  assert.ok(ret, "returned, not dropped: the engine names it");
  assert.equal(ret.returned_from, "ann/plot");
  assert.deepEqual(ret.subtree, ["bo/shed-name"]);
  assert.deepEqual(after.meta.opposed.holders, [{ by: "ann", on: "bo/shed" }]);
  // The cache is the settlement's, untouched by the word.
  const [kept] = await owner(async (c) => (await c.query("SELECT state FROM world_snapshot_folds")).rows);
  assert.ok(JSON.parse(kept.state).marks.some((m) => m.id === "bo/shed"), "the kept World is the snapshot's, never the opposed view");
});

test("a word on ground the speaker does not hold takes nothing away: the engine asks, not this office", { skip }, async () => {
  await seed();
  await speak({ actor: "cy", on: "bo/shed", stance: "opposed" });    // cy holds a parcel, but not under the shed
  const { withHolderWords: w } = await import("../src/world-settlement.mjs");
  assert.ok(w([{ id: "cy/yard" }], [{ by: "cy", on: "bo/shed" }], { parcels: [{ id: "cy/yard", household: "cy" }] })[0].consent, "the word is written on cy's parcel; the engine is the one that weighs the ground");
  resetSettlementCaches();
  const r = await serve();
  assert.ok(ids(r).includes("bo/shed"));
  assert.deepEqual(r.returned, []);
});

test("an opposed mark with open stakes stands until they unwind (the escrow guard)", { skip }, async () => {
  await seed();
  await owner((c) => c.query(
    `INSERT INTO escrow_projection (town_sha, mark, holder, household, own_household, n, weight_k) VALUES ($1, 'bo/shed', 'bo', 'bo', 'bo', 2, 1)`, [TOWN_SHA]));
  await speak({ actor: "ann", on: "bo/shed", stance: "opposed" });
  resetSettlementCaches();
  const r = await serve();
  assert.ok(ids(r).includes("bo/shed"), "it stands");
  assert.equal(r.returned.find((x) => x.mark === "bo/shed")?.state, "pending-escrow");
});

test("a later word revises an earlier one: latest wins, and a welcomed takes nothing away", { skip }, async () => {
  await seed();
  await speak({ actor: "ann", on: "bo/shed", stance: "opposed", at: "2026-10-03T00:00:00Z" });
  await speak({ actor: "ann", on: "bo/shed", stance: "welcomed", at: "2026-10-04T00:00:00Z" });
  resetSettlementCaches();
  const r = await serve();
  assert.ok(ids(r).includes("bo/shed"));
  assert.deepEqual(r.meta.opposed.holders, []);
});

test("the town's opposed word reaches the engine as its own `townWords`; an engine older than world#146 is disclosed, never pretended", { skip }, async () => {
  // A stand-in engine at a law sha of its own: it returns whatever the town opposes.
  const repo = mkdtempSync(join(tmpdir(), "settlement-engine-"));
  try {
    mkdirSync(join(repo, "tools"));
    writeFileSync(join(repo, "tools", "consent.mjs"), 'export const TOWN_WORDS = new Set(["neutral", "opposed"]);\n');
    writeFileSync(join(repo, "tools", "marks-fold.mjs"), [
      "export function fold({ marks, townWords = null }) {",
      "  const opposed = new Set([...(townWords ?? new Map())].filter(([, w]) => w === 'opposed').map(([id]) => id));",
      "  return { marks: marks.filter((m) => !opposed.has(m.id)).map((m) => ({ id: m.id })), parcels: [], returned: [...opposed].map((mark) => ({ mark, returned_from: 'the-town' })) };",
      "}", ""].join("\n"));
    git(repo, "init", "-q");
    git(repo, "-c", "user.name=t", "-c", "user.email=t@t", "add", ".");
    git(repo, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "stand-in engine");
    const stand = git(repo, "rev-parse", "HEAD");
    await seed({ lawSha: stand });
    const { TOWN_SPEAKER } = await import("../src/town-stance.mjs");
    await speak({ actor: TOWN_SPEAKER, on: "cy/bench", stance: "opposed", as: "town" });
    resetSettlementCaches();
    const r = await serve({ worldRepo: repo });
    assert.ok(!ids(r).includes("cy/bench"), "the town's opposition took the bench away");
    assert.deepEqual(r.meta.opposed.town, ["cy/bench"]);
    assert.equal(r.meta.opposed_unread, undefined);
  } finally { rmSync(repo, { recursive: true, force: true }); }

  // The pinned clone's engine has no TOWN_WORDS: the word is named as not carried.
  await seed();
  const { TOWN_SPEAKER } = await import("../src/town-stance.mjs");
  await speak({ actor: TOWN_SPEAKER, on: "cy/bench", stance: "opposed", as: "town" });
  resetSettlementCaches();
  const old = await serve();
  const { TOWN_WORDS } = await import(`${(await import("node:url")).pathToFileURL(join((await import("../src/world-branches.mjs")).materializeAtRef(WORLD, LAW_SHA, "tools"), "tools", "consent.mjs")).href}`);
  if (TOWN_WORDS instanceof Set) assert.ok(!ids(old).includes("cy/bench"));
  else assert.match(old.meta.opposed_unread ?? "", /predates the town's word/);
});

test("withHolderWords writes a household's word on every parcel it holds, copying, never editing", () => {
  const marks = [{ id: "ann/plot", kind: "parcel" }, { id: "ann/other", kind: "parcel", consent: { "x/y": "welcomed" } }, { id: "bo/shed" }];
  const parcels = [{ id: "ann/plot", household: "ann" }, { id: "ann/other", household: "ann2" }];
  const householdOf = (h) => (h === "ann2" ? "hh:ann" : h === "ann" ? "hh:ann" : h);
  const out = withHolderWords(marks, [{ by: "ann", on: "bo/shed" }], { parcels, householdOf });
  assert.deepEqual(out[0].consent, { "bo/shed": "opposed" });
  assert.deepEqual(out[1].consent, { "x/y": "welcomed", "bo/shed": "opposed" });
  assert.equal(out[2], marks[2]);
  assert.equal(marks[0].consent, undefined, "the input is not edited");
  assert.equal(withHolderWords(marks, [], { parcels }), marks);
});

test("the served view's key moves with the opposed words and nothing else", () => {
  const a = vetoKey(new Map([["x", "opposed"], ["y", "neutral"]]), []);
  assert.equal(a, vetoKey(new Map([["x", "opposed"]]), []), "a neutral word moves nothing here");
  assert.notEqual(a, vetoKey(new Map(), []));
  assert.notEqual(a, vetoKey(new Map([["x", "opposed"]]), [{ by: "ann", on: "z" }]));
});

test("a store with no settlement falls to the file and says why; an office with no store serves the file as before", { skip }, async () => {
  await owner((c) => c.query("TRUNCATE world_snapshot_folds, settlements, world_snapshots CASCADE"));
  resetSettlementCaches();
  const pool = async () => ({ query: (...a) => asOffice((p) => p.query(...a)) });
  const r = await settlementOrFile({ asked: null, engaged: true, pool, worldRepo: WORLD, fileAnswer: async () => ({ marks: [{ id: "f" }] }) });
  assert.equal(r.meta.source, "file");
  assert.match(r.meta.not_settlement, /no settlement that names a snapshot/);
  const bare = await settlementOrFile({ asked: null, engaged: false, pool, worldRepo: WORLD, fileAnswer: async () => ({ marks: [{ id: "f" }] }) });
  assert.deepEqual(bare, { marks: [{ id: "f" }] }, "no store: the file's bytes, untouched");
  await assert.rejects(settlementOrFile({ asked: "S3", engaged: false, pool, worldRepo: WORLD, fileAnswer: async () => ({}) }), (e) => e.code === 404);
});

test("foldText is the fold's own file form", () => {
  assert.equal(foldText({ a: 1 }), '{\n  "a": 1\n}\n');
});
