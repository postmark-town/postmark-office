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

import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startStore } from "./helpers/embedded-store.mjs";
import { foldOfSnapshot, canonicalJson } from "../src/world-snapshot.mjs";
import { settlementRig, WORLD, LAW_SHA, TOWN_SHA, git } from "./helpers/settlement-seed.mjs";
import {
  servedSettlement, settlementOrFile, settlementNumberOf, withHolderWords, vetoKey,
  resetSettlementCaches, foldText, settlementTakesAway,
} from "../src/world-settlement.mjs";

const store = await startStore({ db: "world_settlement_test" });
after(() => store.stop()); // a store never stopped left its server running on every run (POS-479)
const skip = store.skip ?? false;
const { owner, asOffice, seed, speak } = settlementRig(store);

const serve = (opts = {}) => asOffice((p) => servedSettlement(p, { worldRepo: WORLD, ...opts }));
// The marks a resident placed (the class mark the law brings is the law's, and stands in every fold).
const ids = (state) => state.marks.map((m) => m.id).filter((id) => id !== "the-town/hall").sort();
// The fold as the snapshot holds it: the served marks less the two labels this read adds (R9, R14).
const unlabelled = (state) => ({ ...state, marks: state.marks.map(({ town_stance, awaiting, ...m }) => m) });
const markOf = (state, id) => state.marks.find((m) => m.id === id);

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
  assert.equal(canonicalJson(unlabelled(served)), canonicalJson(state), "the served World equals the snapshot's fold, beside each mark's labels");

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

test("with TOWN_STANCE_CUTOVER unset, no mark is labelled: the old blessing carries over (R14), and meta says why", { skip }, async () => {
  await seed();
  const before = process.env.TOWN_STANCE_CUTOVER;
  delete process.env.TOWN_STANCE_CUTOVER;
  try {
    resetSettlementCaches();
    const r = await serve();
    for (const m of r.marks) {
      assert.equal(m.town_stance, undefined, `${m.id} carries no stance label`);
      assert.equal(m.awaiting, undefined, `${m.id} awaits no one on this answer`);
    }
    assert.match(r.meta.labels_omitted, /TOWN_STANCE_CUTOVER is not set/);
  } finally {
    if (before === undefined) delete process.env.TOWN_STANCE_CUTOVER; else process.env.TOWN_STANCE_CUTOVER = before;
  }
});

test("with the cutover set: a mark from before it carries nothing, a town-neutral one says so, and `awaiting` names who has not spoken (R9, R14; one taxonomy)", { skip }, async () => {
  await seed();
  const before = process.env.TOWN_STANCE_CUTOVER;
  process.env.TOWN_STANCE_CUTOVER = "S10";              // window 500
  try {
    // The bench's and the shed's current versions locked in window 501, after the cutover.
    for (const [slug, by] of [["cy/bench", "cy"], ["bo/shed", "bo"]])
      await owner((c) => c.query(
        `INSERT INTO claims (window_id, class, claimant, household, status, body, geometry, stake, data, slug, decided_at)
         VALUES (501, 'sited', $2, $2, 'locked', 'x', '{}'::jsonb, 0, '{}'::jsonb, $1, '2026-10-02T06:00:00Z')`, [slug, by]));
    resetSettlementCaches();
    let r = await serve();
    assert.equal(r.meta.labels_omitted, undefined);
    assert.ok(r.marks.every((m) => !("ratification" in m)), "no ratification field anywhere (R7/R15 superseded)");
    assert.deepEqual(markOf(r, "the-town/hall"), unlabelled(r).marks.find((m) => m.id === "the-town/hall"), "the law is not a cleared mark");
    const plot = markOf(r, "ann/plot");
    assert.equal(plot.town_stance, undefined, "it stood at the cutover: the old blessing carries over");
    assert.equal(plot.awaiting, undefined);
    assert.equal(markOf(r, "cy/bench").town_stance, undefined, "the town has not spoken");
    assert.deepEqual(markOf(r, "cy/bench").awaiting, ["the-town"]);
    assert.deepEqual(markOf(r, "bo/shed").awaiting, ["the-town", "ann"], "the shed stands on ann's earlier ground");

    // The town declares neutral on the bench; ann welcomes the shed.
    const { TOWN_SPEAKER } = await import("../src/town-stance.mjs");
    await speak({ actor: TOWN_SPEAKER, on: "cy/bench", stance: "neutral", as: "town" });
    await speak({ actor: "ann", on: "bo/shed", stance: "welcomed" });
    resetSettlementCaches();
    r = await serve();
    assert.equal(markOf(r, "cy/bench").town_stance, "neutral");
    assert.equal(markOf(r, "cy/bench").awaiting, undefined, "the field appears only when it is not empty");
    assert.deepEqual(markOf(r, "bo/shed").awaiting, ["the-town"], "ann's word clears her household's seat");
    assert.equal(markOf(r, "bo/shed").town_stance, undefined);

    // A cutover AFTER the served settlement: it is the old blessing, and carries
    // no label (the cutover is a settlement number, Darko 2026-10-09).
    process.env.TOWN_STANCE_CUTOVER = "S77";
    resetSettlementCaches();
    r = await serve();
    assert.equal(markOf(r, "bo/shed").awaiting, undefined);
    assert.match(r.meta.labels_omitted ?? "", /S11 is below the cutover S77/);
    // A cutover at or before it that the store holds no row for is said, never labelled.
    process.env.TOWN_STANCE_CUTOVER = "S5";
    resetSettlementCaches();
    r = await serve();
    assert.equal(markOf(r, "bo/shed").awaiting, undefined);
    assert.match(r.meta.labels_unread ?? "", /S5/);
  } finally {
    if (before === undefined) delete process.env.TOWN_STANCE_CUTOVER; else process.env.TOWN_STANCE_CUTOVER = before;
  }
});

test("labelMarks: before the cutover nothing, even on another's ground; after it, only the town's neutral and who awaits", async () => {
  const { labelMarks } = await import("../src/world-settlement.mjs");
  const { TOWN_SPEAKER } = await import("../src/town-stance.mjs");
  const ground = { id: "g/plot", kind: "parcel", by: "g", date: "2026-09-01", at: { x: 0, y: 0 }, extent: { w: 9, h: 9 } };
  const mark = { id: "x/a", kind: "sited", by: "x", date: "2026-10-02", at: { x: 0, y: 0 }, extent: { w: 1, h: 1 } };
  const cutover = { number: 10, window_id: 500 };
  const overlaps = (a, b) => a.id !== b.id;
  const at = (w) => new Map([["x/a", { current: { id: "9", status: "locked", window_id: w } }], ["g/plot", { current: { id: "1", status: "locked", window_id: 400 } }]]);
  const [, old] = await labelMarks([ground, mark], { townWords: new Map(), cutover, versions: at(499), overlaps });
  assert.deepEqual(old, mark, "a mark that stood at the cutover carries no label at all");
  const [, after] = await labelMarks([ground, mark], { townWords: new Map(), cutover, versions: at(501), overlaps });
  assert.deepEqual(after.awaiting, ["the-town", "g"]);
  assert.equal(after.town_stance, undefined);
  const spoken = [{ on: "x/a", by: TOWN_SPEAKER, as: "town", stance: "neutral" }, { on: "x/a", by: "g", stance: "welcomed" }];
  const [, cleared] = await labelMarks([ground, mark], { townWords: new Map([["x/a", "neutral"]]), cutover, versions: at(501), words: spoken, overlaps });
  assert.equal(cleared.town_stance, "neutral");
  assert.equal(cleared.awaiting, undefined, "everyone with standing has spoken");
});

test("the graph's mark nodes are the served settlement's: an opposed mark and its edges leave, other kinds stay, counts follow (Wright's option A)", async () => {
  const { filterPayload } = await import("../src/world-graph.mjs");
  const { graphOnSettlement } = await import("../src/world-settlement.mjs");
  const node = (id, kind) => ({ data: { id, kind } });
  const payload = {
    as_of: { world: "w", as_of_settlement: "S98" }, counts: {},
    elements: {
      nodes: [node("ann/plot", "mark"), node("bo/shed", "mark"), node("the-town/hall", "class"), node("tools/x.mjs", "code")],
      edges: [{ data: { source: "bo/shed", target: "ann/plot", type: "contains" } }, { data: { source: "the-town/hall", target: "tools/x.mjs", type: "implements" } }],
    },
  };
  const settled = { ids: new Set(["ann/plot", "the-town/hall"]), settlement: "S11", digest: "d".repeat(64) };
  const view = graphOnSettlement(filterPayload(payload, { keepMarks: settled.ids }), settled);
  assert.deepEqual(view.elements.nodes.map((n) => n.data.id), ["ann/plot", "the-town/hall", "tools/x.mjs"]);
  assert.deepEqual(view.elements.edges.map((e) => e.data.type), ["implements"], "the opposed mark's edge left with it");
  assert.equal(view.counts.nodes, 3);
  assert.equal(view.as_of.settlement, "S11");
  assert.equal(view.as_of.digest, "d".repeat(64));
  assert.equal(filterPayload(payload, {}), payload, "no settlement, no narrowing: the payload as hydrated");
  assert.match(graphOnSettlement(payload, { unread: "boom" }).as_of.settlement_unread, /not narrowed to a settlement: boom/);
  assert.equal(graphOnSettlement(payload, null), payload);
});

// ── POS-362 (Darko 2026-10-08, option A): THE SETTLEMENT FOLDS ITS SEAL'S WORDS ──
//
// The seal records the newest stance act (069 stance_through). The settlement's
// World is its sources folded with the words standing at the seal; an asked
// ?settlement=S<n> serves exactly that, and the newest World (nothing asked)
// takes the words standing now. A holder's word is the engine's parcel veto at
// the pinned world clone; the town's needs world#146, so it is carried by a
// stand-in engine here, as above.

const keptOf = async (digest) => {
  const [r] = await owner(async (c) => (await c.query("SELECT state FROM world_snapshot_folds WHERE digest = $1", [digest])).rows);
  return r ? JSON.parse(r.state) : null;
};

test("an opposition spoken before the seal is in the settlement itself: the asked S<n>, the kept World, and the derivation --verify runs", { skip }, async () => {
  const { s11 } = await seed({ sealWords: [{ actor: "ann", on: "bo/shed", stance: "opposed" }] });
  const asked = await serve({ settlement: "S11" });
  assert.deepEqual(ids(asked), ["ann/plot", "cy/bench", "cy/yard"], "the shed and the name that continues it left the settlement");
  assert.equal(asked.meta.words.as_of, "the seal");
  assert.ok(asked.meta.words.stance_through, "it names how far the words reached");
  assert.deepEqual(asked.meta.opposed.holders, [{ by: "ann", on: "bo/shed" }]);
  assert.equal(asked.returned.find((r) => r.mark === "bo/shed")?.returned_from, "ann/plot", "through the engine's own return path");

  const kept = await keptOf(s11);
  assert.ok(kept && !kept.marks.some((m) => m.id === "bo/shed"), "the World kept under the digest is the settlement, words and all");

  // --verify's road: the sources and the seal's words, folded again, are the kept World.
  const { settlementFoldInputs, wordsAtSeal, foldWithWords } = await import("../src/world-settlement.mjs");
  const header = await asOffice(async (p) => (await p.query("SELECT * FROM world_snapshots WHERE id = 2")).rows[0]);
  const derived = await asOffice(async (p) => foldWithWords(
    await settlementFoldInputs(p, header, { worldRepo: WORLD, townRepo: null }), await wordsAtSeal(p, header, { worldRepo: WORLD })));
  assert.equal(canonicalJson(derived.state), canonicalJson(kept));

  const newest = await serve();
  assert.deepEqual(ids(newest), ids(asked), "the same words stand now: the newest World is the kept one");
  assert.equal(newest.meta.words.as_of, "now");
});

test("an opposition placed AFTER S11's seal is absent from S11-as-asked and present in what is served now (R16)", { skip }, async () => {
  await seed({ sealWords: [{ actor: "cy", on: "bo/shed", stance: "welcomed" }] });
  await speak({ actor: "ann", on: "bo/shed", stance: "opposed", at: "2026-10-04T00:00:00Z" });
  resetSettlementCaches();
  const asked = await serve({ settlement: "S11" });
  assert.ok(ids(asked).includes("bo/shed"), "S11 is what it was sealed with: ann had not spoken");
  assert.deepEqual(asked.meta.opposed.holders, []);
  const newest = await serve();
  assert.ok(!ids(newest).includes("bo/shed"), "the newest World takes ann's word at once");
  assert.deepEqual(newest.meta.opposed.holders, [{ by: "ann", on: "bo/shed" }]);
  assert.equal(newest.meta.as_of.settlement, "S11", "nothing waited for a clearing");
});

test("a word taken back after the seal: the newest World gives the mark back, the asked settlement keeps its seal's word", { skip }, async () => {
  await seed({ sealWords: [{ actor: "ann", on: "bo/shed", stance: "opposed" }] });
  await speak({ actor: "ann", on: "bo/shed", stance: "welcomed", at: "2026-10-04T00:00:00Z" });
  resetSettlementCaches();
  assert.ok(ids(await serve()).includes("bo/shed"), "today ann welcomes it");
  assert.ok(!ids(await serve({ settlement: "S11" })).includes("bo/shed"), "at S11's seal she had opposed it");
});

test("a word counts on the version that stood at the seal: an amendment cleared after it reopens the word now, never in the settlement (R15)", { skip }, async () => {
  const V1 = "51000000-0000-4000-8000-000000000501", V2 = "52000000-0000-4000-8000-000000000502";
  await seed({
    // The shed's version at the seal locked in window 501. Its amendment was submitted BEFORE the seal
    // (pending then) and DECIDED after it: only the decision's instant says it was not yet current.
    before: async (c) => {
      await c.query("INSERT INTO windows (id, opens_at, closes_at, status, cleared_at) VALUES (502, '2026-10-02T06:00Z', '2026-10-02T18:00Z', 'closed', '2026-10-04T18:00Z')");
      await c.query(
        `INSERT INTO claims (id, window_id, class, claimant, household, status, body, geometry, stake, data, slug, submitted_at, decided_at) VALUES
           ($1, 501, 'sited', 'bo', 'bo', 'locked', 'x', '{}'::jsonb, 0, '{}'::jsonb, 'bo/shed', '2026-10-02T00:00:00Z', '2026-10-02T06:00:00Z'),
           ($2, 502, 'sited', 'bo', 'bo', 'locked', 'y', '{}'::jsonb, 0, '{}'::jsonb, 'bo/shed', '2026-10-02T20:00:00Z', '2026-10-04T18:00:00Z')`, [V1, V2]);
    },
    // ann's word was spoken on the version that stood (V1).
    sealWords: [{ actor: "ann", on: "bo/shed", stance: "opposed", at: "2026-10-02T12:00:00Z", version: V1 }],
  });
  assert.ok(!ids(await serve({ settlement: "S11" })).includes("bo/shed"), "at the seal the word stood on the shed's version");
  resetSettlementCaches();
  assert.ok(ids(await serve()).includes("bo/shed"), "now the shed's version is the amendment: the word is on an older one, so it is absent");
});

test("a held_review claim granted AFTER the seal keeps its window, and still cannot reach back into the settlement (Wright's review of #432)", { skip }, async () => {
  // review-rule.mjs locks a held_review claim in a LATER clearing and keeps the
  // window it was submitted in. Held at 501 (S11's own window), granted after
  // S11's seal: by window it would read as S11's current version, and the word
  // ann spoke on the version that stood would drop out of a sealed settlement.
  const V1 = "61000000-0000-4000-8000-000000000501", V2 = "62000000-0000-4000-8000-000000000501";
  await seed({
    before: async (c) => {
      await c.query(
        `INSERT INTO claims (id, window_id, class, claimant, household, status, body, geometry, stake, data, slug, submitted_at, decided_at) VALUES
           ($1, 501, 'sited', 'bo', 'bo', 'locked', 'x', '{}'::jsonb, 0, '{}'::jsonb, 'bo/shed', '2026-10-02T00:00:00Z', '2026-10-02T06:00:00Z'),
           ($2, 501, 'sited', 'bo', 'bo', 'locked', 'y', '{}'::jsonb, 0, '{}'::jsonb, 'bo/shed', '2026-10-02T10:00:00Z', '2026-10-04T18:00:00Z')`, [V1, V2]);
    },
    sealWords: [{ actor: "ann", on: "bo/shed", stance: "opposed", at: "2026-10-02T12:00:00Z", version: V1 }],
  });
  const asked = await serve({ settlement: "S11" });
  assert.ok(!ids(asked).includes("bo/shed"), "S11 is unchanged by a grant decided after its seal: ann's word stands on the version it was spoken on");
  assert.deepEqual(asked.meta.opposed.holders, [{ by: "ann", on: "bo/shed" }]);
  resetSettlementCaches();
  assert.ok(ids(await serve()).includes("bo/shed"), "the newest World reads the grant: the word is on an older version now");
});

test("--verify derives a settlement carrying stance_through: the seal's words, and the kept World VALUE-EQUAL to it", { skip }, async () => {
  const { spawnSync } = await import("node:child_process");
  const { s11 } = await seed({ sealWords: [{ actor: "ann", on: "bo/shed", stance: "opposed" }] });
  await serve({ settlement: "S11" });                     // the office keeps S11's World under its digest
  const r = spawnSync(process.execPath, [join(WORLD, "..", "world2", "tools", "world-snapshot.mjs"), "--verify", "--window", "501", "--world-repo", WORLD],
    { encoding: "utf8", env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, WORLD2_PG_URL: store.url("office_api") } });
  const out = `${r.stdout}\n${r.stderr}`;
  assert.match(out, /digests: .* hash to what they say/, out);
  assert.match(out, /words: the stance acts up to \d+ — the town opposes 0 mark\(s\), holders 1 word\(s\)/, out);
  assert.match(out, new RegExp(`the settlement \\(with its seal's words\\) vs the cached fold of ${s11.slice(0, 12)}: VALUE-EQUAL`), out);
});

test("the town's word at the seal reaches the engine as `townWords`, and the asked settlement serves it", { skip }, async () => {
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
    const { TOWN_SPEAKER } = await import("../src/town-stance.mjs");
    await seed({ lawSha: stand, sealWords: [{ actor: TOWN_SPEAKER, on: "cy/bench", stance: "opposed", as: "town" }] });
    const r = await serve({ worldRepo: repo, settlement: "S11" });
    assert.ok(!ids(r).includes("cy/bench"), "the town's opposition at the seal took the bench out of S11");
    assert.deepEqual(r.meta.opposed.town, ["cy/bench"]);
  } finally { rmSync(repo, { recursive: true, force: true }); }
});

// ── R14 (POS-364 delta review): NO STANCE TAKES A MARK OUT OF GIT BEFORE THE CUTOVER ──
//
// Everything before TOWN_STANCE_CUTOVER counts as ratified. A stance act already
// in the store at the deploy must not withhold its mark (and the mark's subtree)
// from the sweep while the cutover is unset; once it is set, it does.

test("R14 · CUTOVER UNSET: ann's opposition to bo/shed is in the seal, and git still carries the shed and its name", { skip }, async () => {
  await seed({ sealWords: [{ actor: "ann", on: "bo/shed", stance: "opposed" }] });
  const header = await asOffice(async (p) => (await p.query("SELECT * FROM world_snapshots WHERE id = 2")).rows[0]);
  const away = await asOffice((p) => settlementTakesAway(p, header, { worldRepo: WORLD, env: {} }));
  assert.deepEqual([...away.slugs], [], "nothing is taken away by a word before the cutover");
  assert.ok(away.stances_not_counted.startsWith("TOWN_STANCE_CUTOVER is not set: before the cutover every mark counts as ratified (R14)"), away.stances_not_counted);
});

test("R14 · CUTOVER SET: the same opposition takes the shed and the name that continues it out of git", { skip }, async () => {
  await seed({ sealWords: [{ actor: "ann", on: "bo/shed", stance: "opposed" }] });
  const header = await asOffice(async (p) => (await p.query("SELECT * FROM world_snapshots WHERE id = 2")).rows[0]);
  const away = await asOffice((p) => settlementTakesAway(p, header, { worldRepo: WORLD, env: { TOWN_STANCE_CUTOVER: "S11" } }));
  assert.deepEqual([...away.slugs].sort(), ["bo/shed", "bo/shed-name"]);
  assert.equal(away.stances_not_counted, undefined);
});

// ── THE CUTOVER IS A SETTLEMENT NUMBER (Darko, 2026-10-09 10:25 EDT) ─────────
//
// "A settlement numbered below n folds with no stances; this is R14, everything
// ratified. From S<n> on, every opposition standing at that settlement's seal
// counts, earlier acts included. So a sealed settlement always folds the same
// way, whatever the env var says today."

test("THE CUTOVER IS A SETTLEMENT NUMBER: one sealed S11, its write-down folded under a cutover at or below 11 and one above it", { skip }, async () => {
  await seed({ sealWords: [{ actor: "ann", on: "bo/shed", stance: "opposed" }] });
  const header = await asOffice(async (p) => (await p.query("SELECT * FROM world_snapshots WHERE id = 2")).rows[0]);
  const at = (cutover) => asOffice((p) => settlementTakesAway(p, header, { worldRepo: WORLD, env: cutover ? { TOWN_STANCE_CUTOVER: cutover } : {} }));
  for (const cutover of ["S10", "S11"]) {
    const away = await at(cutover);
    assert.deepEqual([...away.slugs].sort(), ["bo/shed", "bo/shed-name"], `cutover ${cutover}: S11 is at or after it, so ann's word counts`);
    assert.equal(away.settlement, 11);
    assert.equal(away.stances_not_counted, undefined);
  }
  const above = await at("S12");
  assert.deepEqual([...above.slugs], [], "cutover S12: S11 is before it, so every mark counts as ratified, the word included");
  assert.equal(above.stances_not_counted, "S11 is below the cutover S12 (TOWN_STANCE_CUTOVER): a settlement before the cutover counts every mark as ratified (R14), so no stance takes one out of git");
  assert.deepEqual([...(await at(null)).slugs], [], "unset: none counts");
  assert.deepEqual([...(await at("S11")).slugs].sort(), ["bo/shed", "bo/shed-name"], "and the same number gives the same git again");
});

test("THE CROSSING'S OWN NUMBER: a snapshot no settlement names yet is read as the settlement this crossing makes, the store's newest plus one, and says so", { skip }, async () => {
  await seed({ sealWords: [{ actor: "ann", on: "bo/shed", stance: "opposed" }] });
  await owner((c) => c.query("DELETE FROM settlements WHERE number = 11"));     // the clearing sealed it; the keeper has not tagged it yet
  const header = await asOffice(async (p) => (await p.query("SELECT * FROM world_snapshots WHERE id = 2")).rows[0]);
  const away = await asOffice((p) => settlementTakesAway(p, header, { worldRepo: WORLD, env: { TOWN_STANCE_CUTOVER: "S11" } }));
  assert.equal(away.settlement, 11);
  assert.match(away.settlement_inferred, /names no settlement yet, so it is read as the settlement this crossing makes: S11, the store's newest plus one/);
  assert.deepEqual([...away.slugs].sort(), ["bo/shed", "bo/shed-name"]);
  const later = await asOffice((p) => settlementTakesAway(p, header, { worldRepo: WORLD, env: { TOWN_STANCE_CUTOVER: "S12" } }));
  assert.deepEqual([...later.slugs], [], "a cutover after it counts nothing at it");
});

test("THE LABELS READ THE NUMBER TOO: a settlement below the cutover carries no label, and meta says why", { skip }, async () => {
  await seed();
  resetSettlementCaches();
  const r = await serve({ env: { TOWN_STANCE_CUTOVER: "S12" } });
  assert.equal(r.meta.as_of.settlement, "S11");
  assert.match(r.meta.labels_omitted ?? "", /^town_stance and awaiting are omitted: S11 is below the cutover S12/);
  assert.ok(r.marks.every((m) => m.awaiting === undefined && m.town_stance === undefined));
});

test("a settlement with no stance_through (sealed before 069, or back-filled) folds with no words", { skip }, async () => {
  await seed();
  await speak({ actor: "ann", on: "bo/shed", stance: "opposed" });
  resetSettlementCaches();
  const asked = await serve({ settlement: "S11" });
  assert.ok(ids(asked).includes("bo/shed"), "no word was read at its seal");
  assert.equal(asked.meta.words.stance_through, null);
  assert.ok(!ids(await serve()).includes("bo/shed"), "the newest World still takes today's word");
});

// ── POS-364 (R11 as Darko amended it 10-04): THE SETTLEMENT APPLIES THE LIMITS ──
//
// "The settlement applies limits in chronological order of the acts. The first
// N welcomed stand; the rest are opposed, citing the limit." The engine here is
// a stand-in with the world fold's two limits in claim order (marks-fold §
// admissibility: one parcel per resident, then the household cap, each an
// `errors` entry in the fold's own sentence) and world#146's town veto with the
// subtree; the pinned clone predates #146. The real engine's run is in the PR.

const ONE_PER_RESIDENT = "this resident already holds a parcel; a household may hold up to three, one per resident (the-town/one-per-resident; relocation = replace, not add)";
function limitEngine({ marks, townWords = null }) {
  const opposed = new Set([...(townWords ?? new Map())].filter(([, w]) => w === "opposed").map(([id]) => id));
  const errors = [], parcels = [], byResident = new Set(), byHouse = new Map();
  for (const m of [...marks].filter((x) => x.kind === "parcel").sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))) {
    if (byResident.has(m.by)) { errors.push({ mark: m.id, error: ONE_PER_RESIDENT }); continue; }
    const held = byHouse.get(m.household) ?? 0;
    if (held >= 3) { errors.push({ mark: m.id, error: `parcel claim capped — this credential household already holds ${held} (cap 3 per household, ruled 2026-07-30; prior estate stands, new claims wait on the founder's word)` }); continue; }
    byResident.add(m.by); byHouse.set(m.household, held + 1); parcels.push({ id: m.id, household: m.by });
  }
  const kids = (id) => marks.filter((m) => m.parent === id).map((m) => m.id);
  const returned = [], gone = new Set();
  for (const id of [...opposed].sort()) {
    if (!marks.some((m) => m.id === id)) continue;
    const subtree = kids(id);
    returned.push({ mark: id, returned_from: "the-town", authority: "the town (absolute)", subtree, state: "returned" });
    gone.add(id); for (const k of subtree) gone.add(k);
  }
  return { marks: marks.filter((m) => !gone.has(m.id)).map((m) => ({ id: m.id })), parcels: parcels.filter((p) => !gone.has(p.id)), errors, returned, households: {} };
}

test("the settlement applies the limits in act order: fifteen pending parcels, a limit of three — the first three stand, twelve are opposed citing the-town/claim-cap (R11)", async () => {
  const { foldWithWords, limitOppositions } = await import("../src/world-settlement.mjs");
  // One household, fifteen residents, one parcel each, filed an hour apart and handed over shuffled.
  const marks = Array.from({ length: 15 }, (_, i) => ({
    id: `r${String(i).padStart(2, "0")}/plot`, kind: "parcel", by: `r${String(i).padStart(2, "0")}`, household: "one-house",
    date: `2026-10-08T${String(i).padStart(2, "0")}:00:00Z`,
  })).reverse();
  marks.push({ id: "r14/plot-name", kind: "naming", by: "r14", household: "one-house", parent: "r14/plot", date: "2026-10-08T23:00:00Z" });
  const inputs = { fold: limitEngine, args: { marks }, townWordsRead: true, claimOrderRead: true };
  const cleared = limitEngine({ marks: structuredClone(marks) });
  assert.equal(limitOppositions(cleared).length, 12, "the fold names twelve over the cap");
  const { state, vetoes } = foldWithWords(inputs, null);
  const standing = state.marks.map((m) => m.id).filter((id) => id.endsWith("/plot")).sort();
  assert.deepEqual(standing, ["r00/plot", "r01/plot", "r02/plot"], "the FIRST three by act order stand");
  assert.equal(vetoes.limits.length, 12);
  assert.ok(vetoes.limits.every((l) => l.law === "the-town/claim-cap"), "each cites the cap's law mark");
  assert.ok(!state.marks.some((m) => m.id === "r14/plot-name"), "the opposed parcel's subtree goes with it");
  const r14 = state.returned.find((r) => r.mark === "r14/plot");
  assert.equal(r14.law, "the-town/claim-cap");
  assert.match(r14.limit, /parcel claim capped/);
  assert.deepEqual(state.errors, [], "each limit's error is answered by its return");
});

test("one parcel per resident is applied the same way: a resident's second parcel is opposed citing the-town/one-per-resident; the first stands", async () => {
  const { foldWithWords } = await import("../src/world-settlement.mjs");
  const marks = [
    { id: "ash/first", kind: "parcel", by: "ash", household: "ash-house", date: "2026-10-01T00:00:00Z" },
    { id: "ash/second", kind: "parcel", by: "ash", household: "ash-house", date: "2026-10-02T00:00:00Z" },
  ];
  const { state, vetoes } = foldWithWords({ fold: limitEngine, args: { marks }, townWordsRead: true, claimOrderRead: true }, null);
  assert.deepEqual(state.marks.map((m) => m.id), ["ash/first"]);
  assert.deepEqual(vetoes.limits, [{ mark: "ash/second", law: "the-town/one-per-resident" }]);
});

test("an engine without world#146 or world#166 applies no limit: the World is the cleared one, and the answer names what was not applied", async () => {
  const { foldWithWords } = await import("../src/world-settlement.mjs");
  const marks = [
    { id: "ash/first", kind: "parcel", by: "ash", household: "ash-house", date: "2026-10-01T00:00:00Z" },
    { id: "ash/second", kind: "parcel", by: "ash", household: "ash-house", date: "2026-10-02T00:00:00Z" },
  ];
  for (const engine of [{ townWordsRead: false, claimOrderRead: true }, { townWordsRead: true, claimOrderRead: false }]) {
    // Either half missing (world#146's town word, world#166's first-claim order) applies no limit.
    const { state, vetoes } = foldWithWords({ fold: limitEngine, args: { marks }, ...engine }, null);
    assert.ok(state.marks.some((m) => m.id === "ash/second"), "nothing is subtracted by hand");
    assert.deepEqual(vetoes.limits_unread, [{ mark: "ash/second", law: "the-town/one-per-resident" }], JSON.stringify(engine));
  }
});
