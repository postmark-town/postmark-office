// world2-apex-reads.test.mjs — the APEX port, held to quoted law.
//
// No database. Everything `apex-reads.mjs` DECIDES is pure with respect to
// Postgres, and the rows here are shaped the way `pg` hands them over (jsonb
// as objects, text as strings) — the live-lane suite's rule, for its reason:
// "a test fed prettier inputs than the driver gives would prove something
// about a different program."
//
// The field-for-field equality against 1.0's own apex lives in
// `falsifier-apex-equality.mjs`, which needs a store, a clone and a Postgres.
// These are the cases that hold the shapes a live store cannot reach — and,
// first among them, THE TWO DEFECTS THIS LANE ACTUALLY SHIPPED AND FIXED. A
// falsifier that only runs on the box is a guard the suite cannot keep.
//
// ONE SECTION NEEDS A CHECKOUT — § records, at the bottom: the `records`
// block is composed by 1.0's own `markRecords` over an engine-assembled world,
// so its equality runs the door against a fixture pool with the engine read
// from `WORLD_CLONE`, and SKIPS by name without one (the investigate suite's
// shape). Run: WORLD_CLONE=<a world checkout> node --test test/world2-apex-reads.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import * as apex from "../world2/tools/apex-reads.mjs";

// ── fixtures, in `law_projection` / `marks` row shape ───────────────────────

const classRow = (data) => ({ kind: "class", key: data.class, path: `WORLD/marks/…/${data.class}/mark.md`, data });
const markRow = (over = {}) => ({
  slug: "someone/a-thing", kind: "sited", owner: "someone", household: "gh:1",
  body: "a body", geometry: { at: { x: 10, y: 20 }, extent: { w: 4, h: 4 } },
  data: { tier: "resident" }, status: "standing", parent: null, ...over,
});

const RESIDENT = {
  id: "the-town/resident", by: "the-town", tier: "constitution", class: "resident",
  class_version: 3, body: "every resident's standing capabilities",
  // ⚑ THE STRING, because that is what the store holds. See the test below.
  ambient: "true",
  actions: [{ action: "say", residue: "the-town/say" }, { action: "walk", residue: "the-town/depart" }],
};
const SAY_RESIDUE = {
  id: "the-town/say", by: "the-town", tier: "constitution", class: "say",
  body: "A saying is one utterance, heard where it was spoken.", dials: { earshot_m: 150 },
};

// ── the ambient spelling ────────────────────────────────────────────────────

test("ambient reaches everywhere when the projection spells it as the STRING the parser produced", () => {
  // world-hydrate.mjs:442-450, verbatim: marks-fold's parseRecord "coerces
  // objects, arrays and numbers but has NO boolean case, so `ambient: true` in
  // a mark file arrives here as the STRING". The hydrator normalises at :457;
  // law-ingest.mjs stores `recordData(m)` and does not. This test is the
  // receipt for the divergence AND the guard on the reading.
  const rows = [classRow(RESIDENT), classRow(SAY_RESIDUE)];
  const [cls] = apex.classRowsFromLaw(rows);
  assert.equal(cls.ambient, 1, "an ambient class spelled with the parser's string must still reach everywhere");

  // And it reaches a standpoint that contains and sees NOTHING — which is the
  // whole point of ambient reach: "jurisdiction travels the law, not the
  // address" (LOGOS/classes.md, 2026-08-09).
  const g = apex.gatherFromLaw({ classRows: apex.classRowsFromLaw(rows), lawRows: rows, markRecords: [], spineIds: [], reachIds: [] });
  assert.deepEqual(g.ambient.map((e) => e.action), ["say", "walk"]);
  assert.equal(g.ambient[0].via, "ambient");
});

test("ambient is the ONE spelling pair, never truthiness", () => {
  // world-hydrate.mjs's own comment refuses `ambient: 1`, `"yes"`, `"TRUE"`.
  // Widening here would make a future law-word silently world-wide.
  for (const bad of [1, "yes", "TRUE", "True", {}, []]) {
    const [cls] = apex.classRowsFromLaw([classRow({ ...RESIDENT, ambient: bad })]);
    assert.equal(cls.ambient, 0, `ambient: ${JSON.stringify(bad)} must reach only where the class stands`);
  }
  const [t] = apex.classRowsFromLaw([classRow({ ...RESIDENT, ambient: true })]);
  assert.equal(t.ambient, 1, "the boolean spelling is admitted too — the hydrator admits both");
});

// ── the mark record ─────────────────────────────────────────────────────────

test("a mark record carries the WHOLE parser record, not a field allowlist", () => {
  // The defect this replaces: the wheelhouse's `mechanic: timetable` rode and
  // its structured `timetable:` record did not, so `servicesFromFold` refused
  // with "timetable must be a structured record, got undefined" and the apex's
  // `departures` block was silently absent at every landing.
  const timetable = { pace: 405, stops: [{ mark: "the-town/the-post-office", departs: ["06:00Z", "18:00Z"] }] };
  const rec = apex.markRecordOf(markRow({
    slug: "the-town/the-wheelhouse",
    data: { tier: "constitution", class: "timetable", mechanic: "timetable", timetable, mobility: "derived" },
  }));
  assert.deepEqual(rec.timetable, timetable, "a field no reader in this file names must still reach the reader that does");
  assert.equal(rec.mechanic, "timetable");
  assert.equal(rec.mobility, "derived");
});

test("the columns win over the record's own copies of them", () => {
  // `data` carries `kind` and `by` on some rows (34 and 34 on world2_dev). The
  // COLUMN is the cleared truth; the record's copy is whatever the mark file
  // said. A record that took the data's spelling could file a parcel as a
  // sited mark and lose it from `parcelsFor`.
  const rec = apex.markRecordOf(markRow({ kind: "parcel", owner: "rei", data: { kind: "sited", by: "someone-else", tier: "resident" } }));
  assert.equal(rec.kind, "parcel");
  assert.equal(rec.by, "rei");
});

test("the two households stay two facts", () => {
  // live-reads.mjs § the sharpest edge: the fold's `household` is a HANDLE and
  // `_cred` is the RESOLVED key. Swapping them files a household's own
  // residents as strangers to each other.
  const rec = apex.markRecordOf(markRow({ owner: "wright", household: "gh:67605380" }));
  assert.equal(rec.household, "wright");
  assert.equal(rec._cred, "gh:67605380");
});

test("geometry lifts to the fold's own names, ring included", () => {
  const points = [[0, 0], [10, 0], [10, 10]];
  const rec = apex.markRecordOf(markRow({ geometry: { at: { x: 1, y: 2 }, extent: { w: 8, h: 8 }, points } }));
  assert.deepEqual(rec.at, { x: 1, y: 2 });
  assert.deepEqual(rec.extent, { w: 8, h: 8 });
  assert.deepEqual(rec.points, points, "a points ring must survive — without it containment falls back to the bbox and admits too much");
});

test("weight is 0 and the answer says so", () => {
  // Not an estimate. There is no escrow view (P-006, ruled and unbuilt), so the
  // honest value is the one that ranks nothing, disclosed.
  assert.equal(apex.markRecordOf(markRow()).weight, 0);
  assert.ok(apex.apexDisclosures({ weightless: true }).includes(apex.DISCLOSURES.weight));
  assert.ok(!apex.apexDisclosures({ weightless: false }).includes(apex.DISCLOSURES.weight));
});

// ── the gate ────────────────────────────────────────────────────────────────

test("a class that mints no verb is still law, and mints nothing", () => {
  // world-store.mjs: "`the-town/parcel` and `the-town/attachment` carry no
  // `affordances:` and are unquestionably law; requiring one here would make
  // `class: parcel` a lie on the record."
  const parcel = classRow({ id: "the-town/parcel", by: "the-town", tier: "constitution", class: "parcel", dials: { extent_m: 25 } });
  assert.equal(apex.classRowsFromLaw([parcel]).length, 0, "the verb-minting gate excludes it");
  assert.equal(apex.classRowsFromLaw([parcel], { mintingOnly: false }).length, 1, "the roster gate keeps it");
});

test("the pre-rename `affordances:` spelling still opens its doors", () => {
  const old = classRow({ id: "the-town/bounty", by: "the-town", tier: "constitution", class: "bounty",
    affordances: [{ subverb: "claim", blurb: "take up a bounty" }] });
  const [row] = apex.classRowsFromLaw([old]);
  assert.equal(apex.entriesFromClass(row, [old])[0].action, "claim");
});

// ── the ground channel ──────────────────────────────────────────────────────

test("a ground grants through its class, one entry per GROUND", () => {
  // world-apex.mjs § seam 5: "Two parcels in your spine are two grounds and the
  // relation scope must be asked of each — collapsing them would let a guest
  // inherit their host's grant."
  const bounty = classRow({ id: "the-town/bounty", by: "the-town", tier: "constitution", class: "bounty",
    actions: [{ action: "claim", residue: "the-town/say" }] });
  const rows = [bounty, classRow(SAY_RESIDUE)];
  const marks = [
    apex.markRecordOf(markRow({ slug: "a/one", data: { tier: "resident", class: "bounty" } })),
    apex.markRecordOf(markRow({ slug: "a/two", data: { tier: "resident", class: "bounty" } })),
  ];
  const g = apex.gatherFromLaw({ classRows: apex.classRowsFromLaw(rows), lawRows: rows, markRecords: marks,
    spineIds: ["a/one"], reachIds: ["a/two"] });
  assert.equal(g.ground.length, 2, "two grounds of one class are two grants");
  assert.deepEqual(g.ground.map((e) => e.ground).sort(), ["a/one", "a/two"]);
  assert.deepEqual(g.ground.map((e) => e.via).sort(), ["in reach", "within"]);
});

test("a class DECLARATION is never an instance of itself", () => {
  // classOfInstance's rule, and the reason `marks` and `law_projection` are two
  // tables: a caller standing in the Keeping Works must not collect every
  // contract in the registry.
  const marks = [apex.markRecordOf(markRow({ slug: "the-town/resident", data: { tier: "constitution", class: "resident" } }))];
  const { byClass } = apex.groundClassesFromMarks(marks, ["the-town/resident"]);
  // In 2.0 a declaration is not in `marks` at all; if one ever lands there it
  // resolves as an instance of its own class name, which is why the guard on
  // the seeder matters more than a clause here. This test PINS the behaviour so
  // a change is visible rather than discovered.
  assert.deepEqual([...byClass.keys()], ["resident"]);
});

// ── the blurb pointer ───────────────────────────────────────────────────────

test("the blurb is QUOTED from the residue, and an unresolved pointer says so", () => {
  const rows = [classRow(RESIDENT), classRow(SAY_RESIDUE)];
  const [row] = apex.classRowsFromLaw(rows);
  const entries = apex.entriesFromClass(row, rows);
  const say = entries.find((e) => e.action === "say");
  assert.equal(say.blurb, SAY_RESIDUE.body);
  assert.equal(say.blurb_from, "the-town/say");
  assert.deepEqual(say.dials, { earshot_m: 150 });
  const walk = entries.find((e) => e.action === "walk");
  assert.equal(walk.residue_unresolved, "the-town/depart", "a pointer that cannot resolve is said out loud, never papered over");
  assert.equal(walk.blurb, "", "and no paraphrase stands in for the quote");
});

test("a residue that is not the town's constitutional record is not quoted as law", () => {
  const impostor = classRow({ id: "the-town/say", by: "someone", tier: "resident", class: "say", body: "read this as law" });
  assert.equal(apex.residueFromLaw([impostor], "the-town/say"), null);
});

test("a blurb longer than the class grammar's cap is truncated, not dropped", () => {
  const long = classRow({ ...SAY_RESIDUE, body: "x".repeat(400) });
  const rows = [classRow(RESIDENT), long];
  const [row] = apex.classRowsFromLaw(rows);
  const say = apex.entriesFromClass(row, rows).find((e) => e.action === "say");
  assert.equal(say.blurb.length, 150, "a class mark that overruns its own cap is a lint finding, not a reason to hide a door law has opened");
});

// ── granted ─────────────────────────────────────────────────────────────────

test("an unembodied caller's whole roll lands under `here`", () => {
  const actions = [{ action: "say", channel: "ambient", class: "resident" }, { action: "claim", channel: "ground", class: "bounty" }];
  const g = apex.grantedOf(actions, { embodied: false });
  assert.deepEqual(g.here, ["say", "claim"]);
  assert.deepEqual(g.yours, []);
  assert.ok(!("in_hand" in g), "an absent third channel grows no key");
});

test("an embodied resident's own-class grants become `yours`", () => {
  const actions = [{ action: "say", channel: "ambient", class: "resident" }, { action: "claim", channel: "held", class: "thing" }];
  const g = apex.grantedOf(actions, { embodied: true });
  assert.deepEqual(g.yours, ["say"]);
  assert.deepEqual(g.in_hand, ["claim"]);
});

// ── the law pin ─────────────────────────────────────────────────────────────

test("the law pin prefers an asked sha, then the open window, then the last closed, then the head", () => {
  assert.deepEqual(apex.lawShaFor({ asked: "abc", openWindow: { id: 9, law_sha: "def" }, head: "ghi" }),
    { law_sha: "abc", source: "asked" });
  assert.equal(apex.lawShaFor({ openWindow: { id: 9, law_sha: "def" }, lastClosed: { id: 8, law_sha: "old" }, head: "ghi" }).law_sha, "def");
  // The live shape, and the reason rung 3 exists: `windows.law_sha` is written
  // AT THE CLEARING, so an OPEN window carries NULL. Verified on world2_dev
  // 2026-09-03: window 168 open with no pin, 167 closed pinned cba817d7.
  const pin = apex.lawShaFor({ openWindow: { id: 168, law_sha: null }, lastClosed: { id: 167, law_sha: "cba817d7" }, head: "cba817d7" });
  assert.equal(pin.law_sha, "cba817d7");
  assert.match(pin.source, /window 167 \(last closed\)/);
  assert.equal(apex.lawShaFor({ head: "ghi" }).source, "projection_heads['world-law']");
  assert.equal(apex.lawShaFor({}).law_sha, null, "no law is a refusal to compose, never a default");
});

// ── the skeleton ────────────────────────────────────────────────────────────

test("the skeleton reassembles from its per-key rows, exactly and losslessly", () => {
  const rows = [
    { kind: "skeleton", key: "features", data: [{ id: "a" }] },
    { kind: "skeleton", key: "light", data: { from: "NE" } },
    { kind: "class", key: "resident", data: RESIDENT },
  ];
  assert.deepEqual(apex.skeletonFromLawRows(rows), { features: [{ id: "a" }], light: { from: "NE" } });
  assert.equal(apex.skeletonFromLawRows([]), null, "no skeleton is null — the door refuses rather than standing somewhere with no terrain");
});

// ═════════════════════════════════════════════════════════════════════════════
// records — the full mark record, in the fold's published shape (#2896)
// ═════════════════════════════════════════════════════════════════════════════
//
// A7 on prod found `/world2/apex` answering twelve top-level keys to 1.0's
// thirteen, at every one of fourteen standpoints, and the missing one was
// `records`. The cases below hold the three pieces that block is made of: the
// projection (a row, spelled the way world-state.json spells it), the authored
// `parent` edge under its three store spellings, and the ground set the
// town's own readers select. Then the door itself, against 1.0's own
// composition over the same world.

// ── the projection ──────────────────────────────────────────────────────────

test("a published record is the FOLD's key set, and the seven fields no row holds are absent — not zero", () => {
  const rec = apex.markRecordOf(markRow({
    slug: "wright/the-trueing-house", owner: "wright", household: "gh:67605380",
    data: { tier: "home", date: "2026-08-01", mechanic: "light", _fileAt: { x: 1, y: 1 }, _origin: { x: 0, y: 0 }, _stray: {},
            coords: "relative", pre: "true", derived_from: "somewhere", locked_by: "x", founder_commit: "y", _journal_seq: 3 },
  }));
  const pub = apex.publishedRecordOf(rec);
  assert.deepEqual(pub, {
    id: "wright/the-trueing-house", kind: "sited", by: "wright", tier: "home", household: "wright",
    declared_household: "gh:67605380", date: "2026-08-01", at: { x: 10, y: 20 }, extent: { w: 4, h: 4 },
    body: "a body", mechanic: "light",
  });
  // The parser's residue rides the ENGINE record (the timetable lesson) and
  // never the published one: the fold publishes a named set, and 1.0's
  // `records` is the fold's spelling.
  for (const k of ["_fileAt", "_origin", "_stray", "_cred", "coords", "pre", "derived_from", "locked_by", "founder_commit", "_journal_seq"])
    assert.ok(!(k in pub), `${k} is not a published key`);
  // The seven the store cannot answer: absent, and named as such, so a reader
  // can tell "no stake" from "not answered here".
  for (const k of Object.keys(apex.RECORD_FIELDS_NOT_ANSWERED))
    assert.ok(!(k in pub), `${k} must be absent, never a number that reads as real`);
  assert.deepEqual(Object.keys(apex.RECORD_FIELDS_NOT_ANSWERED).sort(),
    ["kept", "ledger_weight", "placementParent", "sovereign", "stamps", "weight", "weight_parts"]);
});

test("null is absent in the published shape, and `tier` alone survives as null", () => {
  // world-state.json is JSON: a fold that computed `far: undefined` publishes
  // no `far`. The engine record spells `at`/`extent`/`class`/`parent` as null
  // so no engine reader has to guard; the published record drops them.
  const pub = apex.publishedRecordOf(apex.markRecordOf(markRow({ kind: "predicated", geometry: null, data: {} })));
  assert.ok(!("at" in pub) && !("extent" in pub) && !("class" in pub) && !("parent" in pub));
  assert.equal(pub.tier, null, "1.0 publishes `tier` on every mark; a row with none says so with null");
  assert.equal(apex.publishedRecordOf(null), null);
});

// ── the authored parent edge, in its three store spellings ──────────────────

test("`parent` is the AUTHORED line, resolved from the uuid column when the seed lifted it there", () => {
  const rows = [
    markRow({ id: "aaaa-1", slug: "sable/the-left-turning-beetle" }),
    markRow({ id: "bbbb-2", slug: "sable/the-second-failed-lap", kind: "predicated", geometry: null, parent: "aaaa-1",
      data: { tier: "market", _parentMarkId: "sable/the-left-turning-beetle" } }),
  ];
  const { marks } = apex.worldStateFromMarkRows(rows);
  assert.equal(marks[1].parent, "sable/the-left-turning-beetle");
});

test("`parent` falls to `data.parent_id` — the docket pen's spelling — when the column is NULL (#2895's rows)", () => {
  // Measured 2026-09-17 on prod: 16 standing predicated/naming rows carry the
  // edge as `data.parent_id` and nowhere else, because world2-claims.mjs's
  // INSERT names no `parent` and materializeClaims copies the claim's NULL.
  const row = markRow({ slug: "vermillion/pando-peak-home", kind: "predicated", geometry: { slug: "vermillion/pando-peak-home" }, parent: null,
    data: { by: "vermillion", kind: "predicated", slot: "home", tier: "market", value: "yes", parent_id: "vermillion/the-pando-peak-parcel", _journal_seq: 9 } });
  assert.equal(apex.markRecordOf(row).parent, "vermillion/the-pando-peak-parcel");
  // and the class-parented edge, which has no row at the other end
  assert.equal(apex.markRecordOf(markRow({ kind: "predicated", geometry: null, data: { _parent_is_law: "the-town/resident" } })).parent, "the-town/resident");
});

test("a SITED mark filed under another's directory publishes NO parent — the directory is filing, not a line", () => {
  // The first cut read `_parentMarkId` here, and every nested sited mark grew a
  // parent 1.0 never gave it — 365 of 365 records at the berth, on prod.
  const rec = apex.markRecordOf(markRow({ slug: "the-town/the-quay", data: { tier: "constitution", _parentMarkId: "the-town/the-long-run-harbor" } }));
  assert.equal(rec.parent, null);
  assert.ok(!("parent" in apex.publishedRecordOf(rec)));
  // …while a predicate's directory IS its parent's, so for it the filing is
  // the last fallback the door itself would have produced.
  assert.equal(apex.markRecordOf(markRow({ kind: "naming", geometry: null, data: { _parentMarkId: "neth/little-free-library" } })).parent, "neth/little-free-library");
});

// ── the ground set ──────────────────────────────────────────────────────────

test("the ground set is the region roster in order, then the water, by leaf slug and ring — and a sentinel ring is not ground", () => {
  const ring = (x) => [{ x, y: 0 }, { x: x + 10, y: 0 }, { x: x + 10, y: 10 }];
  const marks = [
    { id: "wright/the-trueing-terrace", points: ring(100) },
    { id: "the-town/the-town-centre", points: ring(0) },
    { id: "the-town/the-sea", points: ring(300) },
    { id: "the-town/the-lochan", points: ring(200) },
    { id: "spar/the-doubled-coast", points: [{ x: 99999, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }] },   // past the sentinel: positionless, never ground
    { id: "who/the-headland" },                                                                     // no ring: not ground
    { id: "somebody/the-town-centre", points: ring(500) },                                          // a second match — the FIRST wins, as 1.0's `find`
  ];
  const skeleton = { features: [{ id: "the-lochan", kind: "lake" }, { id: "the-sea", kind: "sea", ring_m: ring(300) }, { id: "the-locks", kind: "locks" }] };
  const ids = apex.groundMarkIdsOf({
    marks, skeleton,
    regionSlugs: ["the-town-centre", "the-trueing-terrace", "the-doubled-coast", "the-headland"],
    polygonOf: (m) => m.points ?? null,
    waterFeatures: (s) => s.features.filter((f) => f.kind === "lake"),
    seaFeature: (s) => s.features.find((f) => f.kind === "sea") ?? null,
  });
  assert.deepEqual(ids, ["the-town/the-town-centre", "wright/the-trueing-terrace", "the-town/the-lochan", "the-town/the-sea"]);
  assert.deepEqual(apex.groundMarkIdsOf({ marks, skeleton: null, regionSlugs: [], polygonOf: (m) => m.points ?? null, waterFeatures: () => [], seaFeature: () => null }), []);
});

test("the records block is keyed by id, skips an id with no record, never repeats one, and appends the extras after the named", () => {
  const marks = [apex.markRecordOf(markRow({ slug: "a/one" })), apex.markRecordOf(markRow({ slug: "a/two" })), apex.markRecordOf(markRow({ slug: "the-town/the-sea" }))];
  const block = apex.recordsBlock({ marks, ids: ["a/two", "nobody/never-was", "a/one", "a/two"], extra: ["the-town/the-sea", "a/one"] });
  assert.deepEqual(Object.keys(block), ["a/two", "a/one", "the-town/the-sea"]);
  assert.deepEqual(block["a/one"], apex.publishedRecordOf(marks[0]));
});

test("the mover's class is read from its law row in the same shape the fold publishes it", () => {
  const rec = apex.classRecordOf({ kind: "class", key: "resident", data: {
    id: "the-town/resident", kind: "class", by: "the-town", household: "the-town", tier: "constitution", date: "2026-08-09",
    parent: "the-town/entity", class: "resident", class_version: 3, ambient: "true", dials: { pace_km_per_crossing: 60 },
    actions: [{ action: "walk" }], body: "A household's living voice.", _dir: "/nowhere" } });
  assert.deepEqual(rec, {
    id: "the-town/resident", kind: "class", by: "the-town", tier: "constitution", household: "the-town",
    declared_household: "solo:the-town", date: "2026-08-09", parent: "the-town/entity",
    body: "A household's living voice.", class: "resident", dials: { pace_km_per_crossing: 60 }, signal: false,
  });
  assert.equal(apex.classRecordOf({ kind: "skeleton", key: "light", data: {} }), null);
});

// ── the door, against 1.0's own composition over the same world ─────────────
//
// THE ORACLE IS 1.0's OWN FUNCTION: `markRecords(ids, w)` (src/world.mjs), run
// over a world assembled by the engine from the SAME marks in world-state.json
// shape — the fixture written twice, once as the rows a store holds and once as
// the fold would publish them. The twin is the door over the rows through a
// fixture pool. Same engine, same standpoint, two sources; a divergence names
// the projection or the composition, never a difference of opinion.
//
// WHY AN EQUALITY ALONE WOULD BE WORTHLESS: a door that folded `WORLD_CLONE`
// would answer 1.0's records exactly. So the rows carry `ghost/only-in-the-store`,
// a sited mark standing in NO tree, right beside the standpoint — if the twin's
// `records` cannot name it, the twin is not reading the store.
//
// THE FLIP, run 2026-09-17 against this branch: in `src/world2-serve.mjs §
// world2Apex`, delete the `records,` line from the returned body. The equality
// below reds with `records` undefined against the oracle's keyed block; the
// planted-row case reds on `undefined !== 'ghost/only-in-the-store'`. Restore
// with `git checkout -- src/world2-serve.mjs`.

const REC_ENV = { pg: process.env.WORLD2_PG, url: process.env.WORLD2_PG_URL };
let RECORDS_DOOR = null, RECORDS_ENGINE = null, RECORDS_WHY = null, RECORDS_SKELETON = null, markRecords1 = null;
test.before(async () => {
  process.env.WORLD2_PG = "1"; process.env.WORLD2_PG_URL ??= "postgres://apex-reads-test/none";
  try {
    const clone = process.env.WORLD_CLONE;
    if (!clone) throw new Error("WORLD_CLONE is unset");
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { pathToFileURL } = await import("node:url");
    const branches = await import("../src/world-branches.mjs");
    const doc = JSON.parse(readFileSync(join(clone, "WORLD", "skeleton.json"), "utf8"));
    RECORDS_SKELETON = Object.entries(doc).map(([key, data]) => ({ kind: "skeleton", key, path: "WORLD/skeleton.json", data }));
    const dir = branches.materializeAtRef(clone, branches.freshestMainRef(clone), "tools");
    const at = (f) => import(pathToFileURL(join(dir, "tools", f)).href);
    const [verbs, build] = await Promise.all([at("world-verbs.mjs"), at("world-build.mjs")]);
    RECORDS_ENGINE = { verbs, build };
    ({ world2Apex: RECORDS_DOOR } = await import("../src/world2-serve.mjs"));
    ({ markRecords: markRecords1 } = await import("../src/world.mjs"));
  } catch (e) { RECORDS_WHY = String(e?.message ?? e); }
});
test.after(() => {
  if (REC_ENV.pg == null) delete process.env.WORLD2_PG; else process.env.WORLD2_PG = REC_ENV.pg;
  if (REC_ENV.url == null) delete process.env.WORLD2_PG_URL; else process.env.WORLD2_PG_URL = REC_ENV.url;
});

const REC_LAW_SHA = "a23a8d174776db4d325631a3b9ecf9380cecb722";
const REC_STANDPOINT = { x: 4000, y: 4000 };
const rrow = ({ id, slug, kind = "sited", owner, household, body = "", at = null, extent = null, points = null, parent = null, data = {} }) => ({
  id, slug, kind, owner, household, body,
  geometry: at || points ? { ...(at ? { at } : {}), ...(extent ? { extent } : {}), ...(points ? { points } : {}) } : null,
  data, status: "standing", parent,
});
// The same world twice. ROWS is what the store holds; PUBLISHED is what the
// fold would write to world-state.json for the same marks (the seven walk and
// escrow fields included, as the fold always writes them).
const REC_ROWS = [
  rrow({ id: "u-root", slug: "the-town/let-there-be-light", owner: "the-town", household: "solo:the-town", body: "the light",
    at: { x: 0, y: 0 }, extent: { w: 320000, h: 320000 }, data: { tier: "constitution", date: "2026-07-22", mechanic: "light", _fileAt: { x: 0, y: 0 } } }),
  rrow({ id: "u-parcel", slug: "wright/the-trueing-house-parcel", kind: "parcel", owner: "wright", household: "gh:67605380", body: "wright's ground",
    at: { x: 4000, y: 4000 }, extent: { w: 25, h: 25 }, data: { tier: "home", date: "2026-08-01" } }),
  rrow({ id: "u-house", slug: "wright/the-trueing-house", owner: "wright", household: "gh:67605380", body: "a house that stands in the record",
    at: { x: 4000, y: 4000 }, extent: { w: 12, h: 12 }, data: { tier: "home", date: "2026-08-02", image: "https://x/y.png", _parentMarkId: "wright/the-trueing-house-parcel" } }),
  // a predicate carrying the docket pen's spelling of its parent, and nothing else
  rrow({ id: "u-lamp", slug: "wright/the-amber-lamp", kind: "predicated", owner: "wright", household: "gh:67605380", body: "an amber lamp",
    data: { tier: "home", date: "2026-08-03", slot: "window", value: "amber", parent_id: "wright/the-trueing-house", _journal_seq: 4 } }),
  // ⚑ THE PLANTED MARK — in the rows, in no tree.
  rrow({ id: "u-ghost", slug: "ghost/only-in-the-store", owner: "ghost", household: "solo:ghost", body: "a mark that stands in the store and nowhere else",
    at: { x: 4006, y: 4006 }, extent: { w: 2, h: 2 }, data: { tier: "market", date: "2026-09-17" } }),
  // a region mark with a ring far from the standpoint — the town's ground
  rrow({ id: "u-centre", slug: "the-town/the-town-centre", owner: "the-town", household: "solo:the-town", body: "the centre",
    at: { x: -8000, y: -8000 }, extent: { w: 200, h: 200 }, points: [[-8100, -8100], [-7900, -8100], [-7900, -7900], [-8100, -7900]],
    data: { tier: "constitution", date: "2026-07-23" } }),
];
const pubOf = (over) => ({ sovereign: false, stamps: 0, weight: 0, ...over });
const REC_PUBLISHED = [
  pubOf({ id: "the-town/let-there-be-light", kind: "sited", by: "the-town", tier: "constitution", household: "the-town", declared_household: "solo:the-town",
    date: "2026-07-22", at: { x: 0, y: 0 }, extent: { w: 320000, h: 320000 }, body: "the light", mechanic: "light" }),
  pubOf({ id: "wright/the-trueing-house-parcel", kind: "parcel", by: "wright", tier: "home", household: "wright", declared_household: "gh:67605380",
    date: "2026-08-01", at: { x: 4000, y: 4000 }, extent: { w: 25, h: 25 }, body: "wright's ground", placementParent: "the-town/let-there-be-light" }),
  pubOf({ id: "wright/the-trueing-house", kind: "sited", by: "wright", tier: "home", household: "wright", declared_household: "gh:67605380",
    date: "2026-08-02", at: { x: 4000, y: 4000 }, extent: { w: 12, h: 12 }, body: "a house that stands in the record", image: "https://x/y.png",
    sovereign: true, placementParent: "wright/the-trueing-house-parcel" }),
  pubOf({ id: "wright/the-amber-lamp", kind: "predicated", by: "wright", tier: "home", household: "wright", declared_household: "gh:67605380",
    date: "2026-08-03", parent: "wright/the-trueing-house", slot: "window", value: "amber", body: "an amber lamp", placementParent: "wright/the-trueing-house" }),
  pubOf({ id: "ghost/only-in-the-store", kind: "sited", by: "ghost", tier: "market", household: "ghost", declared_household: "solo:ghost",
    date: "2026-09-17", at: { x: 4006, y: 4006 }, extent: { w: 2, h: 2 }, body: "a mark that stands in the store and nowhere else", placementParent: "wright/the-trueing-house-parcel" }),
  pubOf({ id: "the-town/the-town-centre", kind: "sited", by: "the-town", tier: "constitution", household: "the-town", declared_household: "solo:the-town",
    date: "2026-07-23", at: { x: -8000, y: -8000 }, extent: { w: 200, h: 200 }, points: [[-8100, -8100], [-7900, -8100], [-7900, -7900], [-8100, -7900]],
    body: "the centre", placementParent: "the-town/let-there-be-light" }),
  // the mover's class, as the fold publishes a class mark
  pubOf({ id: "the-town/resident", kind: "class", by: "the-town", tier: "constitution", household: "the-town", declared_household: "solo:the-town",
    date: "2026-08-09", parent: "the-town/entity", body: "A household's living voice.", class: "resident", dials: { pace_km_per_crossing: 60 }, placementParent: "the-town/entity" }),
];
const REC_CLASS_ROW = { kind: "class", key: "resident", path: "WORLD/marks/the-town/resident/mark.md", data: {
  id: "the-town/resident", kind: "class", by: "the-town", household: "the-town", tier: "constitution", date: "2026-08-09", parent: "the-town/entity",
  class: "resident", class_version: 3, ambient: "true", dials: { pace_km_per_crossing: 60 }, body: "A household's living voice.",
  actions: [{ action: "say", residue: "the-town/say" }, { action: "walk", residue: "the-town/depart" }] } };

function recordsPool({ rows = REC_ROWS } = {}) {
  const asked = [];
  return {
    asked,
    query: async (sql, params) => {
      asked.push({ sql: String(sql).replace(/\s+/g, " ").trim(), params });
      if (/FROM windows/i.test(sql)) return { rows: /status = 'open'/.test(sql) ? [] : [{ id: 194, law_sha: REC_LAW_SHA }] };
      if (/FROM projection_heads/i.test(sql)) return { rows: [{ sha: REC_LAW_SHA }] };
      if (/FROM law_projection/i.test(sql)) return { rows: [...(RECORDS_SKELETON ?? []), REC_CLASS_ROW] };
      if (/FROM marks/i.test(sql)) return { rows };
      return { rows: [] };   // acts, town_roll — nobody is about
    },
  };
}

/** 1.0's `records` for the standpoint, over the published fixture, by 1.0's own composition. */
async function oracleRecords() {
  const skeleton = apex.skeletonFromLawRows(RECORDS_SKELETON);
  const w = RECORDS_ENGINE.build.assembleWorld({ worldState: { marks: structuredClone(REC_PUBLISHED), parcels: [] }, skeleton });
  w._raw = { skeleton };   // src/world.mjs § world() stamps this, and groundMarkIds reads the skeleton from it
  const state = { x: REC_STANDPOINT.x, y: REC_STANDPOINT.y };
  const spine = RECORDS_ENGINE.verbs.orient(state, w, { crossing: 1 }).you?.within ?? [];
  const seen = RECORDS_ENGINE.verbs.openYourEyes(state, w, { crossing: 1 });
  const nearby = [...(seen.fov?.carried ?? []), ...(seen.fov?.far ?? [])];
  return markRecords1([...spine.map((m) => m.id), ...nearby.map((o) => o.id)], w);
}
const stripUnanswered = (rec) => { const out = { ...rec }; for (const k of Object.keys(apex.RECORD_FIELDS_NOT_ANSWERED)) delete out[k]; return out; };

test("RECORDS: the door's block is 1.0's own `markRecords` over the same world — ids, order and every published field", async (t) => {
  if (!RECORDS_ENGINE) return t.skip(`no world engine: ${RECORDS_WHY}`);
  const r = await RECORDS_DOOR(new URLSearchParams({ x: String(REC_STANDPOINT.x), y: String(REC_STANDPOINT.y), crossing: "1" }), { p: recordsPool() });
  assert.ok(!r.error, `the door bounced: ${JSON.stringify(r.error?.body)}`);
  const mine = r.body.records;
  const theirs = await oracleRecords();
  assert.ok(mine && typeof mine === "object", "the door answered no `records` block — A7's sixty reds, one standpoint at a time");
  assert.deepEqual(Object.keys(mine), Object.keys(theirs), "the id set and its order are 1.0's: the spine, the field of view, the ground, the mover's class");
  for (const id of Object.keys(theirs)) {
    assert.deepEqual(mine[id], stripUnanswered(theirs[id]), `records[${id}]`);
    for (const k of Object.keys(apex.RECORD_FIELDS_NOT_ANSWERED)) assert.ok(!(k in mine[id]), `records[${id}].${k} must be absent, not approximated`);
  }
  // the ground and the class rode along, as 1.0 appends them
  assert.ok("the-town/the-town-centre" in mine, "the town's ground is in the block whether or not the field of view reached it");
  assert.ok("the-town/resident" in mine, "the mover's own class travels with every reader");
  assert.equal(mine["the-town/resident"].parent, "the-town/entity", "a class mark's authored parent is the fold's, read from its law row");
  // A predicate carries no geometry, so no field of view names it and no
  // `records` carries it — its `parent` reaches a reader through
  // `/world2/investigate`, which lists a mark's predicates by exactly that edge.
  assert.ok(!("wright/the-amber-lamp" in mine) && !("wright/the-amber-lamp" in theirs));
  assert.ok(r.body.disclosed.some((d) => /records/.test(d) && /stamps, weight/.test(d)), "the answer names what it does not carry");
});

test("RECORDS · THE PLANTED MARK: a mark that stands only in the store is in the block — the door read the rows", async (t) => {
  if (!RECORDS_ENGINE) return t.skip(`no world engine: ${RECORDS_WHY}`);
  const r = await RECORDS_DOOR(new URLSearchParams({ x: String(REC_STANDPOINT.x), y: String(REC_STANDPOINT.y), crossing: "1" }), { p: recordsPool() });
  assert.equal(r.body.records?.["ghost/only-in-the-store"]?.id, "ghost/only-in-the-store",
    "the twin's records could not name a mark that exists only in the rows — it is reading a tree");
  const p = recordsPool({ rows: REC_ROWS.filter((x) => x.slug !== "ghost/only-in-the-store") });
  const again = await RECORDS_DOOR(new URLSearchParams({ x: String(REC_STANDPOINT.x), y: String(REC_STANDPOINT.y), crossing: "1" }), { p });
  assert.ok(!("ghost/only-in-the-store" in again.body.records), "withdrawing the planted mark from the store withdraws it from the block");
  assert.equal(p.asked.filter((a) => /FROM marks/i.test(a.sql)).length, 1, "one `marks` read composes the world, the spine, the view and the records");
});
