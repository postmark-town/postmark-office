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
import { settlementRig, WORLD, LAW_SHA, MARKS } from "./helpers/settlement-seed.mjs";
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
  await seed({ cutover: "S10", s11Marks: S11 });
  const was = process.env.TOWN_STANCE_CUTOVER;
  process.env.TOWN_STANCE_CUTOVER = "S10";                // window 500: S11's marks cleared after it
  try {
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
  } finally {
    if (was === undefined) delete process.env.TOWN_STANCE_CUTOVER; else process.env.TOWN_STANCE_CUTOVER = was;
  }
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
