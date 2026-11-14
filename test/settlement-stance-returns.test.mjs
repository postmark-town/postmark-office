// settlement-stance-returns.test.mjs — A STANCE RETURN TAKES THE OPPOSED MARK
// ALONE, in the World the office serves and in what git loses (Darko's ruling
// B, 2026-10-09, on POS-362; lane plumb-stance-returns, POS-364).
//
//   node --test test/settlement-stance-returns.test.mjs
//
// "When an opposition with standing returns a mark, the whole mark returns.
// Its nested marks don't go with it. Each child keeps its world position and is
// reparented to the next mark that contains it, or to open ground … A child
// that itself overlaps the opposer's older ground isn't spared: it's a mark over
// their ground in its own right, so it awaits that household and can be opposed
// on its own." Over-limit parcel returns (R11, the `law` returns) keep what
// they do today.
//
// THE RIG. test/helpers/settlement-seed.mjs: a real Postgres, S11 sealed over
// the marks below, and the world's own engine at the office's pinned world
// clone (test/clone-pins.json), which carries ruling B. The live shape, small:
// bo's grounds lie over ann's older plot, and inside the grounds stand bo's far
// tower (with a bell on it) and bo's near hut, which straddles ann's plot.
// cy's meadow, older than everything, contains it all.

import { after, test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { startStore } from "./helpers/embedded-store.mjs";
import { settlementRig, WORLD, LAW_SHA, MARKS, TOWN_SHA } from "./helpers/settlement-seed.mjs";
import { servedSettlement, settlementTakesAway, resetSettlementCaches, foldWithWords, stanceReturnsWhole } from "../src/world-settlement.mjs";
import { materializeAtRef } from "../src/world-branches.mjs";

const store = await startStore({ db: "settlement_stance_returns_test" });
after(() => store.stop());
const skip = store.skip ?? false;
const { owner, asOffice, seed, speak } = settlementRig(store);

const box = (x, y, w, h) => ({ at: { x, y }, extent: { w, h } });
const sited = (slug, owner, geometry, date) => ({ slug, kind: "sited", owner, body: `${slug}.`, geometry, parent: null, data: { date, tier: "market" } });
const B = {
  meadow: sited("cy/meadow", "cy", box(100, 0, 1000, 1000), "2026-08-01T00:00:00Z"),
  grounds: sited("bo/grounds", "bo", box(100, 0, 400, 300), "2026-10-01T00:00:00Z"),
  tower: sited("bo/tower", "bo", box(250, 100, 10, 10), "2026-10-01T00:00:01Z"),
  bell: sited("bo/bell", "bo", box(250, 100, 4, 4), "2026-10-01T00:00:02Z"),
  hut: sited("bo/hut", "bo", box(20, 0, 10, 10), "2026-10-01T00:00:03Z"),      // 15..25 on x: over ann's plot (-20..20)
  name: { slug: "bo/grounds-name", kind: "naming", owner: "bo", body: "The Listening Grounds.", geometry: null, parent: "bo/grounds", data: { date: "2026-10-01T00:00:04Z", tier: "market", name: "The Listening Grounds" } },
};
const S11 = [MARKS.plot, B.meadow, B.grounds, B.tower, B.bell, B.hut, B.name];
const serve = (opts = {}) => asOffice((p) => servedSettlement(p, { worldRepo: WORLD, ...opts }));
const markOf = (state, id) => state.marks.find((m) => m.id === id);
const ids = (state) => state.marks.map((m) => m.id).filter((id) => id !== "the-town/hall").sort();
const header = () => asOffice(async (p) => (await p.query("SELECT * FROM world_snapshots WHERE id = 2")).rows[0]);

test("the pinned engine carries ruling B (test/clone-pins.json's world sha)", async () => {
  const consent = await import(pathToFileURL(join(materializeAtRef(WORLD, LAW_SHA, "tools"), "tools", "consent.mjs")).href);
  assert.equal(consent.STANCE_RETURNS_ALONE, true, `the world clone at ${LAW_SHA.slice(0, 12)} predates ruling B: move test/clone-pins.json's world pin to the engine that carries it`);
});

test("RULING B · SERVED: ann opposes bo's grounds; the grounds and their name leave, the far tower and the near hut stand where they stood, reparented to cy's meadow", { skip }, async () => {
  await seed({ cutover: "S10", s11Marks: S11 });
  const before = await serve();
  assert.equal(markOf(before, "bo/tower").placementParent, "bo/grounds");
  assert.equal(markOf(before, "bo/hut").placementParent, "bo/grounds");

  await speak({ actor: "ann", on: "bo/grounds", stance: "opposed" });
  resetSettlementCaches();
  const now = await serve();
  assert.deepEqual(ids(now), ["ann/plot", "bo/bell", "bo/hut", "bo/tower", "cy/meadow"], "only the grounds and the name that continues them left");
  const r = now.returned.find((x) => x.mark === "bo/grounds");
  assert.ok(r, "returned, through the engine's own return path");
  assert.equal(r.returned_from, "ann/plot");
  assert.deepEqual(r.subtree, ["bo/grounds-name"]);
  assert.deepEqual(r.stays, ["bo/hut", "bo/tower"]);
  for (const id of ["bo/tower", "bo/hut"]) {
    assert.deepEqual(markOf(now, id).at, markOf(before, id).at, `${id} keeps its world position`);
    assert.deepEqual(markOf(now, id).extent, markOf(before, id).extent);
    assert.equal(markOf(now, id).placementParent, "cy/meadow", `${id} is reparented to the next mark that contains it`);
  }
  assert.equal(markOf(now, "bo/bell").placementParent, "bo/tower", "the grandchild stays with its own parent");
  assert.equal(now.meta.stance_returns_whole, undefined, "the engine carries ruling B, so nothing is disclosed");
});

test("RULING B · SERVED, cutover set: the near hut awaits ann's household in its own right; the far tower does not", { skip }, async () => {
  await seed({ cutover: "S10", s11Marks: S11 });               // S11 sealed under the cutover S10 (window 500): its marks cleared after it
  for (const [slug, by] of [["bo/hut", "bo"], ["bo/tower", "bo"]])
    await owner((c) => c.query(
      `INSERT INTO claims (window_id, class, claimant, household, status, body, geometry, stake, data, slug, decided_at)
       VALUES (501, 'sited', $2, $2, 'locked', 'x', '{}'::jsonb, 0, '{}'::jsonb, $1, '2026-10-02T06:00:00Z')`, [slug, by]));
  await speak({ actor: "ann", on: "bo/grounds", stance: "opposed" });
  resetSettlementCaches();
  const r = await serve();
  assert.equal(r.meta.labels_omitted, undefined);
  assert.ok(!r.marks.some((m) => m.id === "bo/grounds"));
  assert.deepEqual(markOf(r, "bo/hut").awaiting, ["the-town", "ann", "cy"], "a mark over ann's earlier ground in its own right: it awaits her household (and cy's, whose older meadow holds it)");
  assert.ok(!(markOf(r, "bo/tower").awaiting ?? []).includes("ann"), "the far tower stands on no ground of ann's");
});

test("RULING B · GIT: sealed at or after the cutover, ann's opposition at the seal takes the grounds and their name out of git, never the tower, the bell or the hut", { skip }, async () => {
  await seed({ cutover: "S10", s11Marks: S11, sealWords: [{ actor: "ann", on: "bo/grounds", stance: "opposed" }] });
  const away = await asOffice(async (p) => settlementTakesAway(p, await header(), { worldRepo: WORLD }));
  assert.deepEqual([...away.slugs].sort(), ["bo/grounds", "bo/grounds-name"]);
  assert.equal(away.stance_returns_whole, undefined);
  // and the asked S11 (its seal's words) is the same World git is written from
  const asked = await serve({ settlement: "S11" });
  assert.deepEqual(ids(asked), ["ann/plot", "bo/bell", "bo/hut", "bo/tower", "cy/meadow"]);
});

test("R11 · A LAW RETURN IS AS IT WAS: bo's second plot is opposed citing one-per-resident, and the mark on it still names that plot as its placement", { skip }, async () => {
  const plot = (slug, x, date) => ({ slug, kind: "parcel", owner: "bo", body: `${slug}.`, geometry: box(x, 500, 25, 25), parent: null, data: { date, tier: "market" } });
  const stall = sited("cy/stall", "cy", box(1000, 500, 4, 4), "2026-10-01T00:00:00Z");
  await seed({ cutover: "S10", s11Marks: [MARKS.plot, plot("bo/plot-one", 600, "2026-09-05T00:00:00Z"), plot("bo/plot-two", 1000, "2026-09-06T00:00:00Z"), stall] });
  const s = await serve({ settlement: "S11" });
  const r = s.returned.find((x) => x.mark === "bo/plot-two");
  assert.equal(r?.law, "the-town/one-per-resident", JSON.stringify(s.returned));
  assert.equal("stays" in r, false, "a law return names no `stays`: ruling B does not cover it");
  assert.ok(markOf(s, "cy/stall"), "another household's mark on it stands (POS-477)");
  assert.equal(markOf(s, "cy/stall").placementParent, "bo/plot-two", "and is not reparented: the law return keeps what it did");
});

test("AN ENGINE OLDER THAN RULING B is disclosed, never pretended: its stance returns carry their positioned children, and the answer names them", async () => {
  const marks = [{ id: "bo/grounds", kind: "sited", at: { x: 0, y: 0 } }, { id: "bo/tower", kind: "sited", at: { x: 1, y: 1 } }, { id: "bo/grounds-name", kind: "naming" }];
  const old = { args: { marks }, returnsAloneRead: false };
  const whole = { returned: [{ mark: "bo/grounds", state: "returned", subtree: ["bo/tower", "bo/grounds-name"] }] };
  assert.deepEqual(stanceReturnsWhole(old, whole), { stance_returns_whole: ["bo/grounds"] });
  assert.deepEqual(stanceReturnsWhole(old, { returned: [{ mark: "bo/grounds", state: "returned", subtree: ["bo/grounds-name"] }] }), {}, "a name alone would leave under ruling B too");
  assert.deepEqual(stanceReturnsWhole(old, { returned: [{ mark: "bo/plot", state: "returned", law: "the-town/claim-cap", subtree: ["bo/tower"] }] }), {}, "a law return is not a stance return");
  assert.deepEqual(stanceReturnsWhole({ ...old, returnsAloneRead: true }, whole), {});
});

test("THE LIMITS GO TO THE ENGINE AS LAWS: foldWithWords hands each limit in `townLaws` beside the town's word", async () => {
  const seen = [];
  const ONE = "this resident already holds a parcel; a household may hold up to three, one per resident (the-town/one-per-resident; relocation = replace, not add)";
  const fold = (args) => {
    seen.push(args.townLaws ?? null);
    const opposed = new Set([...(args.townWords ?? new Map())].filter(([, w]) => w === "opposed").map(([id]) => id));
    return { marks: args.marks.filter((m) => !opposed.has(m.id)), parcels: [], errors: opposed.size ? [] : [{ mark: "ash/second", error: ONE }],
      returned: [...opposed].map((mark) => ({ mark, state: "returned", subtree: [] })), households: {} };
  };
  const marks = [{ id: "ash/first", kind: "parcel" }, { id: "ash/second", kind: "parcel" }];
  const { vetoes } = foldWithWords({ fold, args: { marks }, townWordsRead: true, claimOrderRead: true, returnsAloneRead: true }, null);
  assert.deepEqual(vetoes.limits, [{ mark: "ash/second", law: "the-town/one-per-resident" }]);
  assert.deepEqual([...seen.at(-1)], [["ash/second", "the-town/one-per-resident"]]);
});

test("lawCarriesRulingB: the clearing's journal can tell a law with ruling B from one without (DEPLOY § 072, step 0)", async () => {
  const { lawCarriesRulingB } = await import("../src/world-settlement.mjs");
  assert.equal(lawCarriesRulingB(WORLD, LAW_SHA), true, "the pinned world (world#171's head) carries it");
  assert.equal(lawCarriesRulingB(WORLD, "0bcb9c1c55c0631ccf312af43b9f8f6533256cc4"), false, "the engine before #171 does not");
  assert.equal(lawCarriesRulingB(WORLD, "f".repeat(40)), null, "a sha the checkout lacks is unread, never a no");
  assert.equal(lawCarriesRulingB(null, LAW_SHA), null, "no checkout, no answer");
});

// ── POS-571 · THE SERVED LABEL READS SENIORITY CELL BY CELL, AS ITS FOLD DOES ──
//
// World LOGOS conflict-matrix § Roles from seniority (RULED 2026-10-04): "per-cell
// (whoever first covered a cell is that cell's incumbent)", and "an expansion is
// a newcomer on its new cells". The served label (world-settlement.mjs § labelsFor)
// asks the engine at the settlement's own law (header.law_sha) through the
// combinator the inbox and the door use (town-stance.mjs § elderByFirstCover), of
// copies decorated with the facts the fold reads (world-snapshot.mjs § withClaimedAt).
// The estate was first laid 08-01 over x 950..1050 and amended (locked 10-02) to
// reach x 1150; the mill was laid 08-15 at x 1100..1140, ground only the amend reached.
//
// FLIP: in labelsFor, hand labelMarks elderByFirstLaid(...) again → the mill is
// labelled as awaiting the estate and the estate as awaiting no one of the mill's.

const CELLS = {
  estate: sited("east/the-estate", "east", box(1050, 0, 200, 100), "2026-10-02T06:00:00Z"),
  mill: sited("miller/the-mill", "miller", box(1120, 0, 40, 40), "2026-08-15T00:00:00Z"),
};
const boxOf = ({ at, extent }) => `((${at.x - extent.w / 2},${at.y - extent.h / 2}),(${at.x + extent.w / 2},${at.y + extent.h / 2}))`;
const ESTATE_ID = "0e570000-0000-4000-8000-000000000001", ESTATE_AMEND = "0e570000-0000-4000-8000-000000000002", MILL_ID = "0e570000-0000-4000-8000-000000000003";
// P3: the estate's later amend (locked 10-04, after S11's seal) reaching x 1250, and a barn (09-05) only it reaches
const ESTATE_LATER = "0e570000-0000-4000-8000-000000000004", BARN_ID = "0e570000-0000-4000-8000-000000000005";
const LATER_SHAPE = box(1100, 0, 300, 100);
CELLS.estateLater = sited("east/the-estate", "east", LATER_SHAPE, "2026-10-04T06:00:00Z");
CELLS.barn = sited("barner/the-barn", "barner", box(1230, 0, 20, 20), "2026-09-05T00:00:00Z");
async function cellsInTheStore(c, { stake = null, amend = true, later = false } = {}) {
  await c.query("DELETE FROM marks WHERE slug = ANY($1)", [["east/the-estate", "miller/the-mill", "barner/the-barn"]]);
  const claim = (id, slug, by, geometry, date, decided, supersedes = null) => c.query(
    `INSERT INTO claims (id, window_id, class, claimant, household, status, body, geometry, stake, data, slug, decided_at, supersedes)
     VALUES ($1, 501, 'sited', $3, $3, 'locked', 'x', $4, 0, $5, $2, $6, $7)`, [id, slug, by, JSON.stringify(geometry), JSON.stringify({ date }), decided, supersedes]);
  await claim(ESTATE_ID, "east/the-estate", "east", box(1000, 0, 100, 100), "2026-08-01T00:00:00Z", "2026-10-01T06:00:00Z");
  if (amend) await claim(ESTATE_AMEND, "east/the-estate", "east", box(1050, 0, 200, 100), "2026-10-02T06:00:00Z", "2026-10-02T06:00:00Z", ESTATE_ID);
  await claim(MILL_ID, "miller/the-mill", "miller", box(1120, 0, 40, 40), "2026-08-15T00:00:00Z", "2026-10-01T06:00:00Z");
  if (later) {
    await claim(ESTATE_LATER, "east/the-estate", "east", LATER_SHAPE, "2026-10-04T06:00:00Z", "2026-10-04T06:00:00Z", ESTATE_ID);
    await claim(BARN_ID, "barner/the-barn", "barner", CELLS.barn.geometry, "2026-09-05T00:00:00Z", "2026-10-01T06:00:00Z");
  }
  // the store's row is the newest locked version, whatever a settlement has served
  for (const [id, m] of [[ESTATE_ID, later ? CELLS.estateLater : CELLS.estate], [MILL_ID, CELLS.mill], ...(later ? [[BARN_ID, CELLS.barn]] : [])])
    await c.query(
      `INSERT INTO marks (id, slug, kind, owner, household, body, geometry, bbox, status, locked_window, data)
       VALUES ($1, $2, 'sited', $3, $3, $4, $5, $6::box, 'standing', 501, $7)`,
      [id, m.slug, m.owner, m.body, JSON.stringify(m.geometry), boxOf(m.geometry), JSON.stringify(m.data)]);
  if (stake) await c.query("INSERT INTO escrow_projection (town_sha, mark, holder, household, own_household, n, weight_k) VALUES ($1, $2, $3, $3, $3, 100, 1)", [TOWN_SHA, stake.mark, stake.holder]);
}

test("POS-571 · SERVED: the label says the estate awaits the mill's word and the mill awaits none of the estate's, and the settlement's own fold agrees", { skip }, async () => {
  await seed({ cutover: "S10", s11Marks: [MARKS.plot, CELLS.estate, CELLS.mill], before: (c) => cellsInTheStore(c, { stake: { mark: "miller/the-mill", holder: "miller" } }) });
  const r = await serve();
  assert.equal(r.meta.labels_omitted, undefined);
  assert.ok((markOf(r, "east/the-estate").awaiting ?? []).includes("miller"), "on the cells the amend added, the mill was there first: the estate awaits its word");
  assert.ok(!(markOf(r, "miller/the-mill").awaiting ?? []).includes("east"), "and the mill awaits no word of the estate's");
  // THE FOLD AGREES, on S11's own fold input (world-snapshot.mjs § snapshotFoldArgs, decorated by
  // withClaimedAt from the same store) and the engine at its law: a market word rides the grantor's
  // `consent` (world consent.mjs § resolveConsent), so the mill's opposition is authored there.
  const { snapshotFoldArgs } = await import("../src/world-snapshot.mjs");
  const { args } = await asOffice(async (p) => snapshotFoldArgs(p, (await p.query("SELECT * FROM world_snapshots WHERE id = 2")).rows[0]));
  assert.equal(args.marks.find((m) => m.id === "east/the-estate")?.footprints?.length, 2, "the settlement's fold input carries the estate's footprints");
  const engine = await import(pathToFileURL(join(materializeAtRef(WORLD, LAW_SHA, "tools"), "tools", "marks-fold.mjs")).href);
  const millSays = engine.fold({ ...args, marks: args.marks.map((m) => (m.id === "miller/the-mill" ? { ...m, consent: { "east/the-estate": "opposed" } } : m)) });
  assert.equal(millSays.marks.some((m) => m.id === "east/the-estate"), false, "the fold counts the word the label says is owed");
  assert.equal(millSays.returned.find((x) => x.mark === "east/the-estate")?.returned_from, "miller/the-mill");
});

// P3 (round 3 of the review of office#1019; Bevel's FIX 17:35Z): served marks carry
// no footprints, so the label and the settlement's fold input rebuild them from the
// store, whose chain can run past what was served. They read through the served
// shape (mark-render.mjs § footprintsThroughShape). FLIP: in world-snapshot.mjs §
// withClaimedAt use footprintsFromChain again → the label loses the mill's seat
// and the fold input its history while the later amend waits.
test("POS-571 · SERVED, a LATER amend locked but not crossed: the label and the settlement's fold input keep the served history; served at the newer shape, they advance", { skip }, async () => {
  await seed({ cutover: "S10", s11Marks: [MARKS.plot, CELLS.estate, CELLS.mill, CELLS.barn], before: (c) => cellsInTheStore(c, { stake: { mark: "miller/the-mill", holder: "miller" }, later: true }) });
  const r = await serve();
  assert.ok((markOf(r, "east/the-estate").awaiting ?? []).includes("miller"), "the crossed expansion still makes the estate await the mill's word");
  assert.ok(!(markOf(r, "east/the-estate").awaiting ?? []).includes("barner"), "and not the barn's: the served estate does not reach it");
  const { snapshotFoldArgs } = await import("../src/world-snapshot.mjs");
  const foldInput = async () => (await asOffice(async (p) => snapshotFoldArgs(p, (await p.query("SELECT * FROM world_snapshots WHERE id = 2")).rows[0]))).args;
  const at11 = await foldInput();
  assert.deepEqual(at11.marks.find((m) => m.id === "east/the-estate")?.footprints?.map((f) => f.since), ["2026-08-01T00:00:00Z", "2026-10-02T06:00:00.000Z"],
    "S11's fold input carries the history through the shape it sealed, never the amend locked after it");

  // SERVED AT THE NEWER SHAPE: the same store, S11 sealing the later amend
  await seed({ cutover: "S10", s11Marks: [MARKS.plot, CELLS.estateLater, CELLS.mill, CELLS.barn], before: (c) => cellsInTheStore(c, { stake: { mark: "miller/the-mill", holder: "miller" }, later: true }) });
  const next = await serve();
  const awaits = markOf(next, "east/the-estate").awaiting ?? [];
  assert.ok(awaits.includes("barner") && awaits.includes("miller"), `the barn was first on the cells the later amend added, and the mill keeps its own (${awaits.join(", ")})`);
  assert.equal((await foldInput()).marks.find((m) => m.id === "east/the-estate")?.footprints?.length, 3, "and the fold input reads the whole chain through it");
});

test("POS-571 · SERVED, no history: without the amend's locked claim the label keeps the whole-mark answer", { skip }, async () => {
  await seed({ cutover: "S10", s11Marks: [MARKS.plot, CELLS.estate, CELLS.mill], before: (c) => cellsInTheStore(c, { amend: false }) });
  const r = await serve();
  assert.ok((markOf(r, "miller/the-mill").awaiting ?? []).includes("east"), "dated 08-01 as a whole, the estate is the mill's elder, as before");
  assert.ok(!(markOf(r, "east/the-estate").awaiting ?? []).includes("miller"));
});
