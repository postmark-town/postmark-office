// world2-standing.test.mjs — the ported standing walk, held to 1.0's OWN cases.
//
// Every case below either IS one of world `tools/mark-standing.test.mjs`'s seven
// tests, re-expressed against `marks` rows, or is a rule mark-standing.mjs's
// header states that its own test file never exercised. Each asserts a quoted
// sentence of law, so a reader can check the assertion against the source rather
// than against this file's opinion of it.
//
// THE RE-EXPRESSION IS NOT COSMETIC and it is worth saying where it bites: 1.0's
// fixtures hand a SITED mark an authored `parent:`, which the loader would never
// produce and 2.0's schema cannot hold — "`parent` is the CONTINUATION edge,
// never containment … its containment is geometry" (seed-import's ruling). So
// the sited cases here carry real coordinates and let the containment answer
// derive the edge, which is the thing actually under test.

import test from "node:test";
import assert from "node:assert/strict";
import { computeStanding, admissionNotes, markStanding, recordOf,
  placementParent, rankCandidates, rect, contains } from "../world2/tools/standing.mjs";

// ── the fixture world, in `marks`-row shape ──────────────────────────────────
let n = 0;
const uuid = () => `00000000-0000-0000-0000-${String(++n).padStart(12, "0")}`;

/** A row the way `pg` hands one over: geometry/data as objects, parent as text. */
function row({ slug, kind, owner, household, at, extent, points, tier, consent, parent, parentMarkId, parentIsLaw, date }) {
  const geometry = at ? { at, extent: extent ?? { w: 1, h: 1 }, ...(points ? { points } : {}) } : null;
  const data = {};
  if (tier !== undefined) data.tier = tier;
  if (consent !== undefined) data.consent = consent;
  if (parentMarkId !== undefined) data._parentMarkId = parentMarkId;
  if (parentIsLaw !== undefined) data._parent_is_law = parentIsLaw;
  if (date !== undefined) data.date = date;
  return { id: uuid(), slug, kind, owner, household, geometry, parent: parent ?? null, data, status: "standing" };
}

const WRIGHT = "gh:67605380", REI = "gh:2", LIMEN = "solo:limen";

// The world root: every containment chain ends here, and it is the one mark
// `placementParent` refuses as a parent — "the world-root is the frame, never a
// parent → null means root" (marks-fold.mjs:418).
const ROOT = row({ slug: "the-town/let-there-be-light", kind: "sited", owner: "the-town",
  household: "solo:the-town", at: { x: 0, y: 0 }, extent: { w: 320000, h: 320000 }, tier: "constitution" });

const PARCEL = row({ slug: "wright/the-trueing-house-parcel", kind: "parcel", owner: "wright",
  household: WRIGHT, at: { x: 100, y: 100 }, extent: { w: 25, h: 25 }, date: "2026-07-24" });
// Sovereign by GEOMETRY, not by a flag: a sited mark wholly inside a parcel its
// own credential household holds. 1.0's fixture wrote `sovereign: true` by hand.
const HOUSE = row({ slug: "wright/the-trueing-house", kind: "sited", owner: "wright",
  household: WRIGHT, at: { x: 100, y: 100 }, extent: { w: 12, h: 12 } });

const base = () => [ROOT, PARCEL, HOUSE];
const tierOf = (rows) => computeStanding(rows);

// ── 1.0's seven, one for one ─────────────────────────────────────────────────

test("holder's own mark inside their parcel is home (mark-standing.test.mjs:11)", () => {
  const bench = row({ slug: "wright/the-bench", kind: "sited", owner: "wright", household: WRIGHT,
    at: { x: 94, y: 94 }, extent: { w: 2, h: 2 } });
  assert.equal(tierOf([...base(), bench]).get("wright/the-bench"), "home");
});

test("holder's predicated mark on their own sovereign structure is home (mark-standing.test.mjs:16)", () => {
  // "SAME HOUSEHOLD → home. Not a conferral at all: same-household composition is
  //  structural" — and the walk STOPS at the house, which is sovereign ground.
  const timber = row({ slug: "wright/exposed-timber", kind: "predicated", owner: "wright",
    household: WRIGHT, parent: HOUSE.id });
  const t = tierOf([...base(), timber]);
  assert.equal(t.get("wright/exposed-timber"), "home");
});

test("a guest's mark inside another household's parcel is market (mark-standing.test.mjs:21)", () => {
  // "ABSENT / OPPOSED → market, exactly as before. Absent is the resting state:
  //  a guest at the doorstep is a guest."
  const flower = row({ slug: "rei/a-flower", kind: "sited", owner: "rei", household: REI,
    at: { x: 108, y: 108 }, extent: { w: 2, h: 2 } });   // inside the parcel, outside the house
  assert.equal(tierOf([...base(), flower]).get("rei/a-flower"), "market");
});

test("a guest's predicated mark on another's sovereign structure is market (mark-standing.test.mjs:26)", () => {
  const ribbon = row({ slug: "rei/a-ribbon", kind: "predicated", owner: "rei", household: REI,
    parent: HOUSE.id });
  assert.equal(tierOf([...base(), ribbon]).get("rei/a-ribbon"), "market");
});

test("the parcel itself is its holder's home (mark-standing.test.mjs:31)", () => {
  assert.equal(tierOf(base()).get("wright/the-trueing-house-parcel"), "home");
});

test("a mark with no parcel or sovereign ancestor stays market (mark-standing.test.mjs:35)", () => {
  const region = row({ slug: "limen/the-threshold-district", kind: "sited", owner: "limen",
    household: LIMEN, at: { x: 900, y: 900 }, extent: { w: 60, h: 60 } });
  const hearth = row({ slug: "limen/hearth-room", kind: "sited", owner: "limen",
    household: LIMEN, at: { x: 900, y: 900 }, extent: { w: 6, h: 6 } });
  const t = tierOf([...base(), region, hearth]);
  assert.equal(t.get("limen/hearth-room"), "market");
  assert.equal(t.get("limen/the-threshold-district"), "market");
});

test("constitution tier holds when no ground governs (mark-standing.test.mjs:41)", () => {
  assert.equal(tierOf(base()).get("the-town/let-there-be-light"), "constitution");
});

// ── the rules the header states and 1.0's own test file never exercised ──────

test("WELCOMED is the one conferral: the holder's word in their own record", () => {
  // mark-standing.mjs:46 — "WELCOMED  home, under the ground-holder's name. The
  // holder's word about a cross-household mark standing on their ground, written
  // in their own record's `consent:` map. This is the conferral, and it is the
  // only one."
  const ribbon = row({ slug: "rei/a-ribbon", kind: "predicated", owner: "rei", household: REI,
    parent: HOUSE.id });
  const houseWelcoming = { ...HOUSE, data: { ...HOUSE.data, consent: { "rei/a-ribbon": "welcomed" } } };
  assert.equal(tierOf([ROOT, PARCEL, houseWelcoming, ribbon]).get("rei/a-ribbon"), "home");
});

test("`opposed` is not a conferral — it reads exactly as absent does here", () => {
  // "ABSENT / OPPOSED  market, exactly as before. … `opposed` is the return law
  //  and belongs to consent.mjs; nothing here touches it."
  const ribbon = row({ slug: "rei/a-ribbon", kind: "predicated", owner: "rei", household: REI,
    parent: HOUSE.id });
  const houseOpposing = { ...HOUSE, data: { ...HOUSE.data, consent: { "rei/a-ribbon": "opposed" } } };
  assert.equal(tierOf([ROOT, PARCEL, houseOpposing, ribbon]).get("rei/a-ribbon"), "market");
});

test("the grain is the HOUSEHOLD, not the handle: two handles of one house compose", () => {
  // "Two of one person's handles are one household, so their marks compose across
  //  handles and neither asks the other's permission." `rei` here shares WRIGHT's
  //  credential household, and the same row that was `market` above is `home`.
  const ribbon = row({ slug: "rei/a-ribbon", kind: "predicated", owner: "rei", household: WRIGHT,
    parent: HOUSE.id });
  assert.equal(tierOf([...base(), ribbon]).get("rei/a-ribbon"), "home");
});

test("sovereignty is credential-household wide: a sibling handle's parcel confers it", () => {
  // marks-fold.mjs:674 — "a mark is sovereign inside ANY parcel the household
  // holds, whichever of its handles authored either one. Before the grain ruling
  // this keyed on the handle, so a person with two handles was a stranger on
  // their own ground."
  // ISOLATED ON PURPOSE, because the parcel usually answers first and would mask
  // this: `reiHouse` fills its household's parcel EXACTLY, and `placementParent`
  // requires a parent to be "strictly larger than its child" — so the containment
  // chain skips the parcel entirely and reaches the world root. Only `_sovereign`,
  // which "is geometric and answers at hop 0", can hold the ground here.
  const reiHouse = row({ slug: "rei/the-lanternstep-house", kind: "sited", owner: "rei",
    household: WRIGHT, at: { x: 100, y: 100 }, extent: { w: 25, h: 25 } });
  const shelf = row({ slug: "rei/a-shelf", kind: "predicated", owner: "rei", household: WRIGHT,
    parent: reiHouse.id });
  const t = tierOf([...base(), reiHouse, shelf]);
  assert.equal(t.get("rei/the-lanternstep-house"), "home");
  assert.equal(t.get("rei/a-shelf"), "home");
});

test("the constitution shortcut is read BEFORE the walk, so a resident's ground cannot demote the town", () => {
  // mark-standing.mjs:27 — "it has to be answered before any ancestor is looked
  // at: a reach of the town's river filed inside a resident's parcel would
  // otherwise come back 'market' — a guest on their fence — and the whole tier
  // binding exists to make exactly that impossible."
  const reach = row({ slug: "the-town/a-reach-of-the-river", kind: "sited", owner: "the-town",
    household: "solo:the-town", at: { x: 100, y: 100 }, extent: { w: 3, h: 3 }, tier: "constitution" });
  assert.equal(tierOf([...base(), reach]).get("the-town/a-reach-of-the-river"), "constitution");
});

test("a resident cannot declare their own standing — `tier:` on a non-town record states nothing", () => {
  // "STANDING IS DERIVED HERE AND NOWHERE ELSE, AND NEVER DECLARED BY A RESIDENT.
  //  A `tier:` line on a resident's record states nothing."
  const boast = row({ slug: "rei/a-flower", kind: "sited", owner: "rei", household: REI,
    at: { x: 108, y: 108 }, extent: { w: 2, h: 2 }, tier: "constitution" });
  assert.equal(tierOf([...base(), boast]).get("rei/a-flower"), "market");
});

test("the directory edge is the LAST thing the walk believes", () => {
  // "That lint is repealed — 'the tree's paths make no assertion' — so the
  //  directory is now historical filing and is the LAST thing this walk should
  //  believe."
  //
  // The stray filing carries a WELCOMED word, so believing the path and
  // believing the ground give different answers: filed under wright's parcel and
  // welcomed there, but standing 800 m away. The ground answers, and the answer
  // is market. (A stray filing with no word would read market either way, which
  // is a test that cannot fail — the first draft of this one was exactly that,
  // and the flip pass caught it.)
  const strayFiling = row({ slug: "rei/a-lantern", kind: "sited", owner: "rei", household: REI,
    at: { x: 900, y: 900 }, extent: { w: 2, h: 2 }, parentMarkId: PARCEL.slug });
  const parcelWelcoming = { ...PARCEL, data: { ...PARCEL.data, consent: { "rei/a-lantern": "welcomed" } } };
  assert.equal(computeStanding([ROOT, parcelWelcoming, HOUSE, strayFiling]).get("rei/a-lantern"), "market");
});

// ── the le-petit-berthillon shape: the ruling's own receipt ──────────────────

test("a NEIGHBOUR's new parcel moves a standing mark market → home, with no authored byte changed", () => {
  // The replay gate's finding 4, verbatim: "One mark in this range,
  // `berthillon/le-petit-berthillon`, is `market` in the store and `home` in 1.0."
  // And what moves it (replay-ingest.mjs § authoredSubstance): "`berthillon/
  // chez-antoine` (a new PARCEL, someone else's claim in the same window) gives
  // the standing walk sovereign ground to stop at."
  //
  // Same household here — berthillon is `solo:berthillon` on both records — so
  // this is the SAME-HOUSEHOLD case arriving late, which is exactly why it is a
  // recompute question and not a consent question.
  const shop = row({ slug: "berthillon/le-petit-berthillon", kind: "sited", owner: "berthillon",
    household: "solo:berthillon", at: { x: 221, y: 95.5 }, extent: { w: 15, h: 12 } });
  const before = [ROOT, shop];
  assert.equal(computeStanding(before).get("berthillon/le-petit-berthillon"), "market");

  const chezAntoine = row({ slug: "berthillon/chez-antoine", kind: "parcel", owner: "berthillon",
    household: "solo:berthillon", at: { x: 221, y: 95.5 }, extent: { w: 25, h: 25 }, date: "2026-08-26" });
  const after = [ROOT, shop, chezAntoine];
  assert.equal(computeStanding(after).get("berthillon/le-petit-berthillon"), "home");

  // and nothing about the shop's own record moved — the point of the case
  assert.deepEqual(recordOf(shop).at, { x: 221, y: 95.5 });
});

// ── the recompute's own properties ───────────────────────────────────────────

test("the recompute is idempotent: writing the answer back does not change the answer", () => {
  // The constitution shortcut reads `data.tier`, which is the column this
  // recompute writes (seed-import: "The DERIVED tier overrides the raw
  // frontmatter"). That is a fixpoint, not a loop — see standing.mjs § the
  // constitution shortcut reads the column it writes — and this is the assertion
  // rather than the argument.
  const flower = row({ slug: "rei/a-flower", kind: "sited", owner: "rei", household: REI,
    at: { x: 108, y: 108 }, extent: { w: 2, h: 2 } });
  const timber = row({ slug: "wright/exposed-timber", kind: "predicated", owner: "wright",
    household: WRIGHT, parent: HOUSE.id });
  let rows = [...base(), flower, timber];
  const first = computeStanding(rows);
  for (let pass = 0; pass < 3; pass++) {
    rows = rows.map((r) => ({ ...r, data: { ...r.data, tier: first.get(r.slug) } }));
    const again = computeStanding(rows);
    for (const [slug, t] of first) assert.equal(again.get(slug), t, `${slug} moved on pass ${pass + 1}`);
  }
});

test("every standing row gets an answer, and only the three words", () => {
  const rows = [...base(), row({ slug: "rei/a-flower", kind: "sited", owner: "rei", household: REI,
    at: { x: 108, y: 108 }, extent: { w: 2, h: 2 } })];
  const t = computeStanding(rows);
  assert.equal(t.size, rows.length);
  for (const v of t.values()) assert.ok(["home", "market", "constitution"].includes(v), `unknown standing ${v}`);
});

// ── `only`: the answer set the escrow gate asks for ─────────────────────────
//
// standing.mjs § `only` states the law this pair holds it to: "`only` can
// therefore only ever REMOVE entries from the returned Map; it can never change
// one." The first test is that sentence; the second is the refusal that keeps a
// mistyped set from reaching `escrowAbsentAmong`, which reads a missing tier as
// "not commons, skip".

test("`only` narrows the answer set and never changes an answer", () => {
  // A world where the answers are not all the same word, so a narrowing that
  // returned a DEFAULT rather than the walk's own verdict would be caught: the
  // town's constitution, a mark on its own household's ground (`home`), and a
  // mark on nobody's ground (`market`).
  const flower = row({ slug: "rei/a-flower", kind: "sited", owner: "rei", household: REI,
    at: { x: 108, y: 108 }, extent: { w: 2, h: 2 } });
  const stray = row({ slug: "rei/a-stray", kind: "sited", owner: "rei", household: REI,
    at: { x: 9000, y: 9000 }, extent: { w: 2, h: 2 } });
  const rows = [...base(), flower, stray];

  const full = computeStanding(rows);
  for (const slug of full.keys()) {
    const narrowed = computeStanding(rows, { only: new Set([slug]) });
    assert.equal(narrowed.size, 1, `only asked for ${slug} and got ${narrowed.size} answer(s)`);
    assert.equal(narrowed.get(slug), full.get(slug), `${slug} moved when it was asked about alone`);
  }
  // and asking for several at once is the same restriction, not a different walk
  const some = new Set([flower.slug, stray.slug]);
  const many = computeStanding(rows, { only: some });
  assert.deepEqual([...many.keys()].sort(), [...some].sort());
  for (const slug of some) assert.equal(many.get(slug), full.get(slug));
  // the three words are all still reachable through the narrow path, so this
  // world would have caught a narrowing that answered one word for everything
  assert.deepEqual([...new Set(full.values())].sort(), ["constitution", "home", "market"]);
});

test("`only` answers about the CANDIDATE when a claim carries a standing mark's slug", () => {
  // THE AMENDMENT, which is the one shape at step 5.5 where two records share a
  // slug — and the shape this office opened on purpose. `clearing-job.mjs`'s
  // step 1 refuses a claim whose slug already stands, EXCEPT an amendment:
  //
  //   if (c.supersedes && String(c.supersedes) === rows[0].id) { amends.set(…); continue; }
  //
  // No `decide()`, so the claim stays undecided, so it is in `candidates` at
  // step 5.5 carrying a slug a standing mark already holds. Step 1's own comment
  // names the live instance: "settlement/S49 published 14 claims, four of them
  // amendments of standing marks (vellix/casa-nera, vermillion's three
  // space-program marks)."
  //
  // `records` there is `[...standingRows, ...candidates]`, and the base walk's
  // `out.set` is LAST-wins, so the answer is the CANDIDATE's — which is what the
  // gate is asking about ("in the shape `materializeClaims` is about to insert").
  // A narrowing that resolved the slug FIRST-wins would answer with the standing
  // mark instead, and the two answers differ exactly when the amendment moves
  // the mark off its own ground — which is what an amendment is for.
  //
  // CAN FAIL: this is red on `ffbd9850`'s `standing.mjs`, where `bySlug` keeps
  // the first record. Found by the reviewer on the real tool: the amended claim
  // dropped out of `escrow: 51 commons claim(s) LOCKED UNCHECKED` and locked
  // with nothing staked behind it, silently.
  const standing = row({ slug: "wright/the-bench", kind: "sited", owner: "wright",
    household: WRIGHT, at: { x: 100, y: 100 }, extent: { w: 2, h: 2 } });   // on wright's own parcel
  const amended = row({ slug: "wright/the-bench", kind: "sited", owner: "wright",
    household: WRIGHT, at: { x: 9000, y: 9000 }, extent: { w: 2, h: 2 } });  // moved to open ground
  const rows = [...base(), standing, amended];

  // the premise: the two records really do answer differently, or this fixture
  // proves nothing about which one `only` picked
  assert.equal(computeStanding([...base(), standing]).get("wright/the-bench"), "home");
  assert.equal(computeStanding([...base(), amended]).get("wright/the-bench"), "market");

  const full = computeStanding(rows);
  const narrowed = computeStanding(rows, { only: new Set(["wright/the-bench"]) });
  assert.equal(narrowed.get("wright/the-bench"), full.get("wright/the-bench"),
    "`only` resolved the shared slug to a different record than the full walk did");
  assert.equal(narrowed.get("wright/the-bench"), "market",
    "the shared slug must answer as the CANDIDATE — the shape the gate is about to materialize");
});

test("`only` refuses a slug that is not among the rows — it does not answer null", () => {
  // CAN FAIL: delete the throw in standing.mjs and this test goes red, because
  // the Map would come back holding `undefined` for the missing slug and
  // `escrowAbsentAmong` reads that as "the walk had no verdict, skip" — a commons
  // claim locking with nothing staked behind it, silently.
  const rows = base();
  assert.throws(() => computeStanding(rows, { only: new Set(["rei/never-submitted"]) }),
    /only.*rei\/never-submitted.*not among/s);
  // the guard is about ABSENCE, not about narrowing: a slug that IS there passes
  assert.doesNotThrow(() => computeStanding(rows, { only: new Set([rows[0].slug]) }));
});

// ── `containment`: the GiST prefilter, held to the scan it replaces ─────────
//
// standing.mjs § the spatial index states the prefilter's law: "`outer` can
// contain `inner` only if their EFFECTIVE extents touch", with two measured
// escapes — a ring outside its own extent, and a degenerate inner. These build
// the prefilter by hand (the database's answer, without a database) and hold the
// indexed walk to the scanning one, including on both escapes.

/** The prefilter `gistContainment` would return for `world`, computed honestly. */
function containmentOver(world, { loose = [] } = {}) {
  const looseSet = new Set(loose);
  const geometric = world.filter((m) => (m.kind === "sited" || m.kind === "parcel") && m.at);
  const covered = new Set(geometric.map((m) => m.slug).filter((s) => !looseSet.has(s)));
  const box = (m) => {
    const r = { x: m.at?.x ?? 0, y: m.at?.y ?? 0, w: m.extent?.w ?? 1, h: m.extent?.h ?? 1 };
    return { x0: r.x - r.w / 2, x1: r.x + r.w / 2, y0: r.y - r.h / 2, y1: r.y + r.h / 2 };
  };
  const touch = (a, b) => a.x0 <= b.x1 && b.x0 <= a.x1 && a.y0 <= b.y1 && b.y0 <= a.y1;
  const pairs = new Map();
  for (const s of covered) pairs.set(s, []);
  for (const a of geometric) {
    if (!covered.has(a.slug)) continue;
    for (const b of geometric)
      if (b.slug !== a.slug && covered.has(b.slug) && touch(box(a), box(b))) pairs.get(a.slug).push(b.slug);
  }
  return { covered, pairs, loose, indexed: true };
}

// THE FIXTURES BELOW ARE BUILT SO THE VERDICT MOVES, not merely the chain.
//
// The first cut of all three compared `computeStanding` against `computeStanding`
// over worlds where every candidate container answered the same WORD — so the
// prefilter could drop a container, the containment parent could change, and the
// tier came out identical. The reviewer ran the flips: dropping `extras`,
// starving the uncovered path, and reversing the sub-ranking all left the suite
// GREEN. Three of fix 3's four mechanisms had no witness anywhere.
//
// Each fixture now puts a DIFFERENT VERDICT on either side of the mechanism it
// names — a parcel that confers `home` against ground that answers `market` —
// and each names the flip that turns it red.

test("the GiST prefilter gives the scan's own answer, and smallest-containing still wins", () => {
  // SMALLEST-CONTAINING-WINS IS THE THING UNDER TEST, so the two candidate
  // containers must answer differently: the tight one is ground that welcomes
  // the child (`home`), the loose one is ground that does not (`market`).
  // `placementParent` reads its answer off ASCENDING AREA and a stable sort, so
  // reversing the sub-ranking picks the big parcel and the tier moves.
  //
  // CAN FAIL: replace the rank re-sort in standing.mjs's `rankedFor` with
  // `sub.reverse()` and this goes red — `c/thing` answers `market` on the
  // indexed walk and `home` on the scan.
  const world = [ROOT,
    // the tight container: G's ground, welcoming C's thing by name
    row({ slug: "g/near-ground", kind: "parcel", owner: "g", household: "solo:g",
      at: { x: 0, y: 0 }, extent: { w: 20, h: 20 }, consent: { "c/thing": "welcomed" } }),
    // the loose container: B's ground, welcoming nobody
    row({ slug: "b/far-ground", kind: "parcel", owner: "b", household: "solo:b",
      at: { x: 0, y: 0 }, extent: { w: 200, h: 200 } }),
    // C holds no parcel, so `_sovereign` is false and the walk MUST read
    // `_containedBy` — the trap the other two fixtures fell into
    row({ slug: "c/thing", kind: "sited", owner: "c", household: "solo:c",
      at: { x: 0, y: 0 }, extent: { w: 2, h: 2 } }),
    row({ slug: "c/far", kind: "sited", owner: "c", household: "solo:c",
      at: { x: 9000, y: 9000 }, extent: { w: 2, h: 2 } }),
  ];
  const records = world.map(recordOf);

  // the premise, stated as an assertion: the two containers really do disagree,
  // so a fixture that stopped distinguishing them would say so here
  const ranked = rankCandidates(records);
  assert.equal(placementParent(records[3], records, { ranked }), "g/near-ground");
  assert.equal(
    placementParent(records[3], records, { ranked: ranked.filter((e) => e.m.slug !== "g/near-ground") }),
    "b/far-ground");

  const scanned = computeStanding(world);
  const indexed = computeStanding(world, { containment: containmentOver(records) });
  assert.deepEqual([...indexed.entries()].sort(), [...scanned.entries()].sort());
  assert.equal(scanned.get("c/thing"), "home");     // the TIGHT ground's word
  assert.equal(scanned.get("c/far"), "market");     // and the world is not all one word
});

test("a LOOSE mark is still offered as a container, and it is the one that confers home", () => {
  // `d/lake` is LOOSE: its `points:` ring reaches well past its own extent, the
  // case `bbox` cannot bound (standing.mjs § the prefilter's own law, escape 1).
  //
  // IT IS A PARCEL, AND THE CHILD IS ITS OWN HOUSEHOLD'S. That is what makes the
  // fixture bite: losing the lake as a container does not merely lengthen the
  // chain, it changes the WORD. With `extras` the skiff stops at D's own ground
  // and answers `home`; without it the skiff walks to the world root and answers
  // `market`.
  //
  // The skiff is NOT sovereign — `_sovereign` tests the parcel's RECT, and the
  // skiff sits under the ring and outside the rect — so `_containedBy` is what
  // has to answer, which is the mechanism under test.
  //
  // CAN FAIL: delete the `extras` term from `rankedFor` in standing.mjs (both
  // the loose-outer loop and the `extras.length` guard) and this goes red.
  const lake = row({ slug: "d/lake", kind: "parcel", owner: "d", household: "solo:d",
    at: { x: 0, y: 0 }, extent: { w: 10, h: 10 },
    points: [[-100, -100], [100, -100], [100, 100], [-100, 100]] });
  const skiff = row({ slug: "d/skiff", kind: "sited", owner: "d", household: "solo:d",
    at: { x: 60, y: 60 }, extent: { w: 2, h: 2 } });
  const world = [ROOT, lake, skiff];
  const records = world.map(recordOf);

  // the two premises this fixture stands on, both asserted rather than assumed
  assert.equal(placementParent(records[2], records, { ranked: rankCandidates(records) }), "d/lake");
  // sovereignty is tested against the parcel's RECT, and the skiff is outside it
  // — so `markStanding` cannot answer before it reads `_containedBy`
  assert.equal(contains(rect(records[1]), rect(records[2])), false,
    "the skiff must not be sovereign, or the walk answers before it reads containment");

  const scanned = computeStanding(world);
  const indexed = computeStanding(world, { containment: containmentOver(records, { loose: ["d/lake"] }) });
  assert.deepEqual([...indexed.entries()].sort(), [...scanned.entries()].sort());
  assert.equal(scanned.get("d/skiff"), "home");

  // AND THE OTHER READING IS THE MARKET ONE. A prefilter that trusted `bbox`
  // over the ring would call the lake COVERED — so it is not a loose extra
  // offered to everyone, and the bbox pair query never pairs it with a skiff
  // sixty metres outside its ten-metre extent. That is this containment, and it
  // is the walk run rather than described.
  const bbox_trusting = computeStanding(world, {
    containment: {
      covered: new Set(["d/lake", "d/skiff"]),
      pairs: new Map([["d/lake", []], ["d/skiff", []]]),
      loose: [], indexed: true,
    },
  });
  assert.equal(bbox_trusting.get("d/skiff"), "market",
    "the fixture no longer distinguishes the two readings");
});

test("a mark not in the index at all — a claim, at step 5.5 — keeps the full scan", () => {
  // The clearing walks standing rows PLUS candidate claims, and no index over
  // `marks` has ever seen a claim, so `pairs.get(slug)` is `undefined` and the
  // walk falls back to the JS `boxesTouch` filter over the whole ranking.
  //
  // THE CANDIDATE IS ON SOMEONE ELSE'S GROUND, welcomed by name. Its own
  // household holds no parcel, so `_sovereign` is false and cannot answer first
  // — the trap that made the first cut of this fixture green no matter what.
  // The consent word is what turns G's ground into `home` for H's bench, and the
  // walk can only read it if containment found the ground.
  //
  // CAN FAIL: make the uncovered branch of `rankedFor` return `[]` in
  // standing.mjs and this goes red — the bench answers `market`.
  const ground = row({ slug: "g/ground", kind: "parcel", owner: "g", household: "solo:g",
    at: { x: 300, y: 300 }, extent: { w: 25, h: 25 }, consent: { "h/a-bench": "welcomed" } });
  const store = [ROOT, ground];
  const candidate = row({ slug: "h/a-bench", kind: "sited", owner: "h", household: "solo:h",
    at: { x: 300, y: 300 }, extent: { w: 2, h: 2 } });
  const world = [...store, candidate];

  // the prefilter knows only the store's two rows — the candidate is absent from
  // `covered` and from every pair list, exactly as the database would have it
  const containment = containmentOver(store.map(recordOf));
  assert.ok(!containment.covered.has("h/a-bench"));
  assert.equal(containment.pairs.get("h/a-bench"), undefined);

  const indexed = computeStanding(world, { containment });
  assert.equal(indexed.get("h/a-bench"), computeStanding(world).get("h/a-bench"));
  assert.equal(indexed.get("h/a-bench"), "home");   // welcomed onto G's ground

  // and the same claim with the welcome withdrawn answers `market`, so this
  // fixture is reading the ground the walk found and not a default
  const unwelcome = world.map((r) => (r.slug === "g/ground" ? { ...r, data: {} } : r));
  assert.equal(computeStanding(unwelcome, { containment }).get("h/a-bench"), "market");
});

test("a NULL household column falls back to solo:<owner>, never to a bare handle", () => {
  // The household-spelling ruling: "A roster owner keeps the household KEY
  // (`gh:<id>`); a non-roster owner is `solo:<handle>`, never NULL." A pre-repair
  // row must not silently compare a handle against a key.
  const p = row({ slug: "nobody/a-parcel", kind: "parcel", owner: "nobody", household: null,
    at: { x: 500, y: 500 }, extent: { w: 25, h: 25 } });
  const m = row({ slug: "nobody/a-thing", kind: "predicated", owner: "nobody", household: "solo:nobody",
    parent: p.id });
  assert.equal(computeStanding([ROOT, p, m]).get("nobody/a-thing"), "home");
});

// ── the tripwires ────────────────────────────────────────────────────────────

test("admissionNotes is silent on a register whose premises hold", () => {
  assert.deepEqual(admissionNotes([...base(),
    row({ slug: "wright/a-slot", kind: "predicated", owner: "the-town", household: "solo:the-town",
      tier: "constitution", parentIsLaw: "the-town/exposure" })]), []);
});

test("admissionNotes fires on a class-parented mark the constitution shortcut does not catch", () => {
  const orphan = row({ slug: "rei/a-slot", kind: "predicated", owner: "rei", household: REI,
    parentIsLaw: "the-town/exposure" });
  const notes = admissionNotes([...base(), orphan]);
  assert.equal(notes.length, 1);
  assert.match(notes[0], /predicated on a CLASS mark/);
  assert.match(notes[0], /rei\/a-slot/);
  // and the walk really does dead-end on it, which is what the note is warning about
  assert.equal(computeStanding([...base(), orphan]).get("rei/a-slot"), "market");
});

test("admissionNotes fires when a household outgrows 1.0's parcel claim cap after the law date", () => {
  // marks-fold.mjs:612 — the cap 2.0's candle does not enforce. Inert across the
  // frozen register (every >3 household's parcels are dated 2026-07-24, prior
  // estate); this is what fires the day that stops being true.
  const ps = [1, 2, 3, 4].map((i) => row({ slug: `h${i}/p`, kind: "parcel", owner: `h${i}`,
    household: "gh:9", at: { x: 2000 + i * 100, y: 2000 }, extent: { w: 25, h: 25 }, date: "2026-08-11" }));
  const notes = admissionNotes([ROOT, ...ps]);
  assert.equal(notes.length, 1);
  assert.match(notes[0], /holds 4 standing parcels, 4 of them dated after 2026-07-30/);
});

test("admissionNotes fires when one handle holds two parcels", () => {
  const a = row({ slug: "twice/one", kind: "parcel", owner: "twice", household: "solo:twice",
    at: { x: 3000, y: 3000 }, extent: { w: 25, h: 25 }, date: "2026-07-24" });
  const b = row({ slug: "twice/two", kind: "parcel", owner: "twice", household: "solo:twice",
    at: { x: 3100, y: 3000 }, extent: { w: 25, h: 25 }, date: "2026-07-24" });
  const notes = admissionNotes([ROOT, a, b]);
  assert.equal(notes.length, 1);
  assert.match(notes[0], /handle twice holds 2 standing parcels/);
});

// ── the port's own seam: the row → record mapping ────────────────────────────

test("recordOf reads the RESOLVED household from the column, and the handle from owner", () => {
  // The port's sharpest edge: in 1.0 `mark.household` is the HANDLE and `_cred`
  // is the resolved key; in 2.0 the `household` COLUMN is the resolved key. A
  // port that read `household` as the handle would compare a key against a
  // handle and answer market for every same-household mark in the town.
  const r = recordOf(row({ slug: "wright/x", kind: "sited", owner: "wright", household: WRIGHT,
    at: { x: 1, y: 1 }, extent: { w: 1, h: 1 } }));
  assert.equal(r.by, "wright");
  assert.equal(r._cred, WRIGHT);
});

test("recordOf lifts geometry to the top level, where every containment primitive reads it", () => {
  // A record that leaves at/extent nested is a record `rect()` answers
  // {x:0,y:0,w:1,h:1} about — silently, for the whole register.
  const r = recordOf(row({ slug: "wright/x", kind: "sited", owner: "wright", household: WRIGHT,
    at: { x: 7, y: 9 }, extent: { w: 3, h: 4 }, points: [[0, 0], [1, 0], [1, 1]] }));
  assert.deepEqual(r.at, { x: 7, y: 9 });
  assert.deepEqual(r.extent, { w: 3, h: 4 });
  assert.equal(r.points.length, 3);
});

test("the ranked search and the exhaustive one give the same parent, mark for mark", () => {
  // `placementParent`'s `ranked` path is an optimisation, and an optimisation on
  // a law function is a place drift hides. This asserts the equivalence over a
  // world built to make it interesting: nested containers, equal-area twins (the
  // tie-break the stable sort has to preserve), a same-size sibling that must NOT
  // be a parent ("a parent is strictly larger than its child"), and the world root
  // that must never be one.
  const world = [ROOT,
    row({ slug: "a/outer", kind: "sited", owner: "a", household: "solo:a", at: { x: 0, y: 0 }, extent: { w: 100, h: 100 } }),
    row({ slug: "a/mid", kind: "sited", owner: "a", household: "solo:a", at: { x: 0, y: 0 }, extent: { w: 40, h: 40 } }),
    row({ slug: "b/mid-twin", kind: "sited", owner: "b", household: "solo:b", at: { x: 0, y: 0 }, extent: { w: 40, h: 40 } }),
    row({ slug: "a/inner", kind: "sited", owner: "a", household: "solo:a", at: { x: 0, y: 0 }, extent: { w: 4, h: 4 } }),
    row({ slug: "a/twin", kind: "sited", owner: "a", household: "solo:a", at: { x: 0, y: 0 }, extent: { w: 4, h: 4 } }),
    row({ slug: "c/far", kind: "sited", owner: "c", household: "solo:c", at: { x: 9000, y: 9000 }, extent: { w: 2, h: 2 } }),
    row({ slug: "d/ringed", kind: "sited", owner: "d", household: "solo:d", at: { x: 0, y: 0 }, extent: { w: 20, h: 20 },
      points: [[-10, -10], [10, -10], [10, 10], [-10, 10]] }),
  ].map(recordOf);
  const ranked = rankCandidates(world);
  for (const m of world)
    assert.equal(placementParent(m, world, { ranked }), placementParent(m, world),
      `ranked and exhaustive disagree about what holds ${m.slug}`);
  // and the ranked answer is the TIGHT one, not merely some container
  assert.equal(placementParent(world.find((m) => m.slug === "a/inner"), world, { ranked }), "d/ringed");
});

test("markStanding on a bare record still answers, and answers market", () => {
  assert.equal(markStanding(null, new Map()), "market");
  assert.equal(markStanding({ id: "x", kind: "sited" }, new Map()), "market");
});

// ── the docket pen's spelling of the parent edge (postmark#2895) ─────────────
//
// THE TEN, on prod, 2026-09-17: six were candle-born predicates whose only
// edge is `data.parent_id` — `marks.parent` NULL, no `_parentMarkId` — and the
// walk climbed nothing, stopped at the world root, and said market where the
// fold, reading the same line as `parent:`, said home. The rows below are the
// store's rows as `pg` hands them over: `vermillion/pando-peak-home`'s shape,
// key for key, standing on a parcel the same household holds.
//
// THE FLIP, run 2026-09-17 against this branch: in `standing.mjs § recordOf`,
// restore `_parentMarkId: data._parentMarkId ?? null` and drop `_parentId` —
// the first case reds `'market' !== 'home'` and the second reds on the stop.
// Restore with `git checkout -- world2/tools/standing.mjs`.

/** A row the DOCKET PEN wrote: `parent` NULL, the edge in `data.parent_id`, no loader keys. */
const docketRow = ({ slug, kind, owner, household, parentId, tier = "market" }) => ({
  id: uuid(), slug, kind, owner, household, geometry: { slug }, parent: null, status: "standing",
  data: { by: owner, kind, tier, slot: "home", value: "yes", parent_id: parentId, _journal_seq: 9 },
});

test("a candle-born predicate carries its parent as `data.parent_id`, and the walk climbs it (#2895)", () => {
  const home = docketRow({ slug: "wright/pando-peak-home", kind: "predicated", owner: "wright", household: WRIGHT, parentId: PARCEL.slug });
  assert.equal(tierOf([...base(), home]).get("wright/pando-peak-home"), "home",
    "the walk stopped at the world root: it did not read the edge the docket pen wrote");
  // and a naming mark, the other kind the pen files this way (3 of the 16)
  const name = docketRow({ slug: "wright/the-fitting-room", kind: "naming", owner: "wright", household: WRIGHT, parentId: HOUSE.slug });
  assert.equal(tierOf([...base(), name]).get("wright/the-fitting-room"), "home");
});

test("the walk stops where 1.0 stops: the parent the pen named, not the root", () => {
  const rec = recordOf(docketRow({ slug: "wright/pando-peak-home", kind: "predicated", owner: "wright", household: WRIGHT, parentId: PARCEL.slug }));
  assert.equal(rec._parentId, PARCEL.slug);
  assert.equal(rec._parentMarkId, PARCEL.slug, "the filing agrees with the line — the drain files a predicate under the mark it describes");
  // the uuid column, when present, still wins: the seed's rows never change answer
  const seeded = recordOf({ id: uuid(), slug: "wright/a-seeded-one", kind: "predicated", owner: "wright", household: WRIGHT, geometry: null,
    parent: PARCEL.id, status: "standing", data: { tier: "home", _parentMarkId: PARCEL.slug } });
  assert.equal(seeded._parentId, null);
  assert.equal(seeded._parentMarkId, PARCEL.slug);
});

test("a guest's candle-born predicate on another's ground is still market — the edge is read, the verdict is the ground's", () => {
  // The fix reads an edge; it confers nothing. rei's predicate on wright's
  // parcel now climbs to the parcel and reads the holder's word, which is absent.
  const guest = docketRow({ slug: "rei/a-plaque", kind: "predicated", owner: "rei", household: REI, parentId: PARCEL.slug });
  assert.equal(tierOf([...base(), guest]).get("rei/a-plaque"), "market");
  const welcoming = { ...PARCEL, data: { ...PARCEL.data, consent: { "rei/a-plaque": "welcomed" } } };
  assert.equal(computeStanding([ROOT, welcoming, HOUSE, guest]).get("rei/a-plaque"), "home", "and the holder's word reaches it, exactly as it reaches a seeded predicate");
});
