// world2-standing-kind-rung.test.mjs — the store's standing walk asks the CLASS
// CHAIN how a row stands, as the world's own fold does (LOGOS v2 part 2, W2 · G12).
//
//   node --import ./test/helpers/sparse-guard.mjs --test test/world2-standing-kind-rung.test.mjs
//
// W2 (postmark-world #236) migrates instance marks from `kind: sited` +
// `class: thing` to `kind: thing` (and `portal-ground`, `town`, `timetable`,
// `vehicle`, `note`, …). The bless puts those rows in the store as they are. The
// port in world2/tools/standing.mjs treated only `kind === "sited" || "parcel"`
// as ground, so every migrated row stopped being anyone's ground, and the
// marks standing on it were re-parented to the root at the first crossing.
//
// The world's fold (tools/mark-kind.mjs § standingOf, at W2 b12b7156) says:
//   "A kind that names a class is answered by that class's chain, when the chain
//    reaches the root. Only a chain that cannot answer (no class nodes in hand,
//    or a fixture's partial tree) falls back to the record's place."
// Every case here is one of those sentences, over `marks` rows.

import test from "node:test";
import assert from "node:assert/strict";
import { computeStanding, containmentParentOf, recordOf, rankCandidates, worldRootOf,
  standsAs, isGround, classLayerOf } from "../world2/tools/standing.mjs";
import { carryPlan } from "../world2/tools/carry.mjs";
import { isCandyClaim } from "../world2/tools/drop-provenance.mjs";
import { markRecordOf } from "../world2/tools/apex-reads.mjs";
import { resolveParent } from "../world2/tools/seed-import.mjs";

let n = 0;
const uuid = () => `10000000-0000-0000-0000-${String(++n).padStart(12, "0")}`;
function row({ slug, kind, owner, household, at, extent, tier, consent }) {
  const geometry = at ? { at, extent: extent ?? { w: 1, h: 1 } } : null;
  const data = {};
  if (tier !== undefined) data.tier = tier;
  if (consent !== undefined) data.consent = consent;
  return { id: uuid(), slug, kind, owner, household, geometry, parent: null, data, status: "standing" };
}

// The class layer as law_projection carries it at W2: one row per class, keyed by
// its name, its `extends` in `data` (law-ingest.mjs § kind: class).
const LAW = [
  ["postmark-node", null], ["mark", "postmark-node"], ["sited", "mark"], ["parcel", "sited"],
  ["predicate", "mark"], ["naming", "predicate"], ["post", "postmark-node"],
  ["thing", "sited"], ["consumable", "thing"], ["candy", "consumable"],
  ["portal-ground", "sited"], ["vehicle", "portal-ground"], ["town", "sited"],
  ["notice", "post"],
].map(([key, ext]) => ({ kind: "class", key, data: ext == null ? { class: key } : { class: key, extends: ext } }));
const W2 = classLayerOf(LAW);

const RIGHT = "hh:starforge", SABLE = "hh:rabbit";
const ROOT = row({ slug: "the-town/let-there-be-light", kind: "sited", owner: "the-town",
  household: "solo:the-town", at: { x: 0, y: 0 }, extent: { w: 320000, h: 320000 }, tier: "constitution" });
const PARCEL = row({ slug: "rei/the-parcel", kind: "parcel", owner: "rei", household: RIGHT,
  at: { x: 1000, y: 1000 }, extent: { w: 25, h: 25 } });
// The candle vault's shape: a THING on its holder's own parcel, welcoming a guest's letter.
const CHEST = row({ slug: "rei/the-chest", kind: "thing", owner: "rei", household: RIGHT,
  at: { x: 1000, y: 1000 }, extent: { w: 6, h: 6 }, consent: { "sable/the-letter": "welcomed" } });
const LETTER = row({ slug: "sable/the-letter", kind: "sited", owner: "sable", household: SABLE,
  at: { x: 1001, y: 1001 }, extent: { w: 1, h: 1 } });
const world = () => [ROOT, PARCEL, CHEST, LETTER];

test("a W2 thing is ground: the holder's welcome on it confers home on a guest's mark inside it", () => {
  // At 674430cce the thing was no ground at all, so the walk passed it by and
  // stopped at the parcel, whose consent map does not name the letter: market.
  const t = computeStanding(world(), { classes: W2 });
  assert.equal(t.get("sable/the-letter"), "home", "the walk stops at the sovereign thing, whose holder welcomed the letter");
  assert.equal(t.get("rei/the-chest"), "home", "the thing itself stands on its own house's parcel");
});

test("with no class layer in hand the place answers, as the world's fold falls back to it", () => {
  // mark-kind.mjs § standingOf: "Only a chain that cannot answer (no class nodes
  // in hand …) falls back to the record's place."
  assert.equal(computeStanding(world()).get("sable/the-letter"), "home");
  assert.equal(computeStanding(world(), { classes: new Map() }).get("sable/the-letter"), "home");
});

test("the containment parent of a mark standing in a thing is the thing, not the parcel or the root", () => {
  const records = world().map(recordOf);
  const letter = records.find((r) => r.slug === "sable/the-letter");
  const chest = records.find((r) => r.slug === "rei/the-chest");
  const root = worldRootOf(records);
  assert.equal(containmentParentOf(letter, records, root, rankCandidates(records, { classes: W2 }), W2), "rei/the-chest");
  assert.equal(containmentParentOf(chest, records, root, rankCandidates(records, { classes: W2 }), W2), "rei/the-parcel",
    "the thing itself is placed by geometry, never by its directory edge");
});

test("how a row stands, every rung of the world's standingOf", () => {
  const at = { x: 5, y: 5 };
  const r = (kind, place = at) => ({ kind, at: place });
  // the standing words answer for themselves
  assert.equal(standsAs(r("sited"), W2), "sited");
  assert.equal(standsAs(r("parcel"), W2), "parcel");
  assert.equal(standsAs(r("predicated", null), W2), "predicate");
  assert.equal(standsAs(r("predicate", null), W2), "predicate");
  assert.equal(standsAs(r("naming", null), W2), "naming");
  assert.equal(standsAs(r("property", null), W2), "property");
  // a class kind is its chain's answer, nearest standing first
  assert.equal(standsAs(r("thing"), W2), "sited");
  assert.equal(standsAs(r("candy"), W2), "sited", "candy > consumable > thing > sited");
  assert.equal(standsAs(r("vehicle"), W2), "sited", "vehicle > portal-ground > sited");
  assert.equal(standsAs(r("notice"), W2), "post", "a post's kind is no ground, even with a place");
  // a chain that cannot reach the root falls back to the place
  assert.equal(standsAs(r("lantern-kind"), W2), "sited", "no class row: the place answers");
  assert.equal(standsAs(r("lantern-kind", null), W2), null, "no class row and no place: nothing");
  // ground is a place AND a sited or parcel standing
  assert.equal(isGround(r("thing"), W2), true);
  assert.equal(isGround(r("thing", null), W2), false, "a thing with no place contains nothing");
  assert.equal(isGround(r("notice"), W2), false);
});

test("the carry: a moving parcel carries its household's thing, and the guest's letter stays", () => {
  // carry.mjs § who rides: "A positioned (sited or parcel) mark rides a moving
  // mark". At 674430cce `positioned` asked the records for class nodes, which
  // the store never holds (they are law, in law_projection), so a thing was not
  // positioned and stayed behind while its parcel moved.
  const rows = world();
  const plans = carryPlan({
    rows, classes: W2,
    movers: [{ claimId: "c1", slug: "rei/the-parcel", next: { at: { x: 1100, y: 960 }, extent: { w: 25, h: 25 } } }],
  });
  const plan = plans.get("c1");
  assert.deepEqual(plan.riders.map((r) => [r.slug, r.to]), [["rei/the-chest", { x: 1100, y: 960 }]]);
  assert.deepEqual(plan.stayed, [{ slug: "sable/the-letter", household: SABLE }]);
});

test("a candy claim in the new form (`kind: candy`) is still proved against its drop act", () => {
  // drop-provenance.mjs § isCandyClaim. The office's own drop writes the old
  // form (kind: sited + class: candy); a resident filing `kind: candy` with a
  // `dropped:` line must not slip past the check.
  assert.equal(isCandyClaim({ class: "sited", claimant: "rei", data: { class: "candy", dropped: "act:7" } }), true, "the old form");
  assert.equal(isCandyClaim({ class: "candy", claimant: "rei", data: { dropped: "act:7" } }), true, "the new form");
  assert.equal(isCandyClaim({ class: "candy", claimant: "the-town", data: {} }), false, "the town's own candy is not a resident's drop");
  assert.equal(isCandyClaim({ class: "thing", claimant: "rei", data: {} }), false);
});

test("a W2 `kind: predicate` continues its parent, as `predicated` did (apex-reads § markRecordOf, seed-import § resolveParent)", () => {
  // Not geometry, the same migration: W2 writes `kind: predicate` where the old
  // form wrote the standing word `predicated`, and both readers asked for the word.
  for (const kind of ["predicated", "predicate", "naming"]) {
    const rec = markRecordOf({ slug: "rei/a-ribbon", kind, owner: "rei", geometry: null, data: { parent_id: "rei/the-chest" } });
    assert.equal(rec.parent, "rei/the-chest", `${kind}: the edge the pen wrote`);
    const byId = new Map([["rei/the-chest", { id: "rei/the-chest", kind: "thing" }]]);
    assert.ok(resolveParent({ id: "rei/a-ribbon", kind, parent: "rei/the-chest" }, byId).parent, `${kind}: seeded with its parent`);
  }
  assert.equal(markRecordOf({ slug: "rei/the-chest", kind: "thing", owner: "rei", data: { _parentMarkId: "rei/the-parcel" } }).parent, null,
    "a sited kind's directory is no edge");
});
