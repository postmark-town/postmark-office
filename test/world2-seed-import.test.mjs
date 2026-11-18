// world2-seed-import.test.mjs — the genesis seed's derivation, without a database.
//
// Everything `seed-import.mjs` DECIDES happens in `deriveSeed` / `deriveActs` /
// `genesisWindow`, which are pure with respect to the checkout. So the tests build
// a checkout: a real git repo with a real commit, a `tools/marks-fold.mjs` the
// importer will import out of it, and the four files it reads. That is not a mock
// of the seam — it IS the seam ("the code that parses sha X is the code that
// shipped at sha X"), exercised with a reader small enough to reason about.
//
// The DB half is proved on the box instead, by `--verify` and `--can-fail-proof`;
// see world2/tools/README.md § The seed.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tempDir } from "./helpers/temp-dir.mjs";
import { join } from "node:path";

import {
  deriveSeed, deriveActs, genesisWindow, assertRef, uuid5, boxOf, boxNumbers, canonicalJson,
  resolveParent, orderByParent,
} from "../world2/tools/seed-import.mjs";

// A `loadMarks` with the world's own contract: world coordinates on `at`, `id` =
// `<by>/<slug>`, `kind` verbatim, everything else the frontmatter said — and the
// `fold` beside it, because the seed asks the FOLD for the two DERIVED fields
// (A/B findings AB-R.tier and AB-R.household; see seed-import § foldOracle).
//
// The fixture's fold is small enough to reason about and keeps the three
// properties the seam depends on:
//   · it publishes `tier` and `declared_household`, the two fields the seed reads;
//   · `declared_household` is the real rule — `households[handle] ?? solo:<handle>`;
//   · it MUTATES the records it is handed, exactly as the real fold does when it
//     stamps `_cred`/`_sovereign`/`_containedBy`. That is what proves the seed
//     folds a clone: if it ever folded its own records, `_folded` would appear in
//     831 rows of stored `data`.
// The real walk's semantics are the world repo's own tests' job, not this
// fixture's — what is tested here is that the seed asks the fold and stores its
// answer.
const FIXTURE_READER = `
export function fold({ marks, households }) {
  for (const m of marks) m._folded = true;   // the fold mutates its input, as the real one does
  return {
    marks: marks.map((m) => ({
      id: m.id,
      tier: m.tier ?? "market",
      declared_household: households?.[m.household ?? m.by] ?? ("solo:" + (m.household ?? m.by)),
    })),
  };
}

export function loadMarks() {
  return [
    { id: "wren/the-yard", slug: "the-yard", by: "wren", kind: "parcel", tier: "market",
      at: { x: 10, y: 20 }, extent: { w: 4, h: 6 }, body: "A yard.", date: "2026-07-01",
      _parentMarkId: null, _explicitParent: undefined },
    { id: "wren/the-shed", slug: "the-shed", by: "wren", kind: "sited", tier: "market",
      at: { x: 0, y: 0 }, extent: { w: 2, h: 2 }, body: "A shed.", date: "2026-07-02",
      points: [[-1, -1], [1, -1], [1, 1]], image: "shed.png",
      _parentMarkId: "wren/the-yard" },
    { id: "stranger/the-rock", slug: "the-rock", by: "stranger", kind: "sited",
      at: { x: -5, y: -5 }, extent: { w: 1, h: 1 }, body: "A rock.", date: "2026-07-03" },
    { id: "the-town/resident", slug: "resident", by: "the-town", kind: "class",
      tier: "constitution", class: "resident", body: "The class." },
    { id: "wren/the-light", slug: "the-light", by: "wren", kind: "predicated",
      body: "The light shifts.", date: "2026-07-04", slot: "light",
      parent: "wren/the-shed", _parentMarkId: "wren/the-shed" },
    // a de-sited mark nested under another de-sited mark — the ordering case
    { id: "wren/the-glow", slug: "the-glow", by: "wren", kind: "naming",
      body: "They call it the glow.", value: "GLOW",
      parent: "wren/the-light", _parentMarkId: "wren/the-light" },
    // predicated on a CLASS mark: its parent lives in law_projection, not marks
    { id: "the-town/resident-engine", slug: "resident-engine", by: "the-town",
      kind: "predicated", tier: "constitution", slot: "engine", body: "The corridor.",
      parent: "the-town/resident", _parentMarkId: "the-town/resident" },
  ];
}
`;

function fixture({ log = { 6: [], 7: [] }, meta = { 7: { crossing: 7, covers_from: "2026-08-26T00:00:00.000Z" } } } = {}) {
  const dir = tempDir("w2seed-");
  mkdirSync(join(dir, "tools"));
  mkdirSync(join(dir, "WORLD", "marks"), { recursive: true });
  mkdirSync(join(dir, "STATE", "log"), { recursive: true });
  writeFileSync(join(dir, "tools", "marks-fold.mjs"), FIXTURE_READER);
  writeFileSync(join(dir, "WORLD", "households.json"),
    JSON.stringify({ households: { wren: "gh:12345" }, logins: { wrenbird: "gh:12345" } }));
  for (const [n, lines] of Object.entries(log)) {
    writeFileSync(join(dir, "STATE", "log", `${n}.jsonl`), lines.map((l) => JSON.stringify(l)).join("\n"));
  }
  for (const [n, m] of Object.entries(meta)) {
    writeFileSync(join(dir, "STATE", "log", `${n}.meta.json`), JSON.stringify(m));
  }
  // The seed reads the COMMITTER date (`%cI`) as the moment the window closed —
  // that is when the settlement commit landed, which is the fact we want.
  const when = "2026-08-26T05:45:16+00:00";
  const env = { ...process.env, GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when };
  const git = (...a) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8", env }).trim();
  git("init", "-q");
  git("config", "user.email", "seed@test");
  git("config", "user.name", "seed");
  git("add", "-A");
  git("commit", "-qm", "fixture");
  git("tag", "-a", "sandbox/seed", "-m", "the pair");
  return { dir, sha: git("rev-parse", "HEAD"), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const seedOf = (f, townSha = "TOWNSHA") => deriveSeed({ worldRepo: f.dir, lawSha: f.sha, townSha });

test("uuid5 is deterministic, versioned, and slug-derived", () => {
  assert.equal(uuid5("wren/the-yard"), uuid5("wren/the-yard"));
  assert.notEqual(uuid5("wren/the-yard"), uuid5("wren/the-shed"));
  assert.match(uuid5("wren/the-yard"), /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test("boxOf centres the rect on `at` and compares through Postgres's normalisation", () => {
  assert.equal(boxOf({ x: 10, y: 20 }, { w: 4, h: 6 }), "((8,17),(12,23))");
  // What Postgres hands back for that box: upper-right corner first.
  assert.deepEqual(boxNumbers("(12,23),(8,17)"), boxNumbers("((8,17),(12,23))"));
  assert.equal(boxNumbers("nonsense"), null);
});

test("a geometric mark becomes one locked claim and one standing mark", async () => {
  const f = fixture();
  try {
    const { claims, marks, window } = await seedOf(f);
    assert.equal(marks.length, 6);      // every non-class record, placed or not (004)
    assert.equal(claims.length, 6);
    const yard = marks.find((m) => m.slug === "wren/the-yard");
    assert.equal(yard.kind, "parcel");            // the constraint's WHERE reads this word
    assert.equal(yard.owner, "wren");
    assert.equal(yard.household, "gh:12345");     // the KEY, as identities holds it
    assert.equal(yard.status, "standing");
    assert.equal(yard.locked_window, window.id);
    assert.equal(yard.bbox, "((8,17),(12,23))");
    assert.deepEqual(yard.geometry, { at: { x: 10, y: 20 }, extent: { w: 4, h: 6 } });

    const claim = claims.find((c) => c.id === yard.id);   // marks.id = the locking claim's id
    assert.ok(claim, "every mark's id is a claim's id");
    assert.equal(claim.status, "locked");
    assert.equal(claim.class, "parcel");                  // one vocabulary across both columns
    assert.equal(claim.window_id, window.id);
  } finally { f.cleanup(); }
});

// A/B finding AB-R.household, Wright's ruling 2026-08-28. This test asserted the
// OPPOSITE until the A/B pass: "an owner the roster does not name gets NULL, not
// an invented household". `solo:<handle>` is not invented — it is the town's own
// answer, and 1.0's register has always spelled it that way. NULL threw the
// answer away on 358 of 831 marks.
test("an owner the roster does not name is solo:<handle>, never NULL", async () => {
  const f = fixture();
  try {
    const { marks } = await seedOf(f);
    assert.equal(marks.find((m) => m.slug === "stranger/the-rock").household, "solo:stranger");
    // and a roster owner still keeps the KEY, not the handle
    assert.equal(marks.find((m) => m.slug === "wren/the-yard").household, "gh:12345");
    assert.equal(marks.filter((m) => m.household == null).length, 0);
  } finally { f.cleanup(); }
});

// The seed folds a CLONE. The fixture's fold stamps `_folded` on every record it
// is handed, exactly as the real fold stamps `_cred`/`_sovereign`/`_containedBy`;
// `recordData` copies every non-column key into `data`, so folding the seed's own
// records would plant the fold's scratch fields in every stored row.
test("the fold's scratch fields do not reach stored `data`", async () => {
  const f = fixture();
  try {
    const { marks } = await seedOf(f);
    for (const m of marks) {
      assert.ok(!("_folded" in m.data), `${m.slug} carries the fold's scratch field in data`);
    }
  } finally { f.cleanup(); }
});

test("a `points:` ring rides in geometry; bbox stays the analytic rect", async () => {
  const f = fixture();
  try {
    const shed = (await seedOf(f)).marks.find((m) => m.slug === "wren/the-shed");
    assert.deepEqual(shed.geometry.points, [[-1, -1], [1, -1], [1, 1]]);
    assert.equal(shed.bbox, "((-1,-1),(1,1))");
  } finally { f.cleanup(); }
});

test("class marks are law and are the only records not seeded", async () => {
  const f = fixture();
  try {
    const { marks, census, notPlaced } = await seedOf(f);
    assert.ok(!marks.some((m) => m.kind === "class"), "no class mark is seeded into `marks`");
    assert.deepEqual(notPlaced.law, ["the-town/resident"]);
    assert.equal(census.not_carried.class_marks_are_law, 1);
    assert.equal(census.records, 7);
    assert.equal(census.marks, 6);
  } finally { f.cleanup(); }
});

test("a de-sited mark is a row now: NULL geometry, NULL bbox, its parent as a uuid", async () => {
  const f = fixture();
  try {
    const { marks, census } = await seedOf(f);
    const light = marks.find((m) => m.slug === "wren/the-light");
    assert.equal(light.kind, "predicated");
    assert.equal(light.geometry, null, "sited_marks_have_a_where permits NULL for a predicated mark");
    assert.equal(light.bbox, null);
    assert.equal(light.parent, uuid5("wren/the-shed"), "parent is the uuid of the mark it continues");
    assert.equal(light.data.slot, "light", "the remainder rides data");
    assert.equal(census.placed, 3);
    assert.equal(census.de_sited, 3);
  } finally { f.cleanup(); }
});

test("a placed mark gets NO parent — its containment is geometry, and filing is frozen", async () => {
  const f = fixture();
  try {
    const { marks } = await seedOf(f);
    // the-shed IS nested under the-yard in the tree, and still carries no parent edge
    const shed = marks.find((m) => m.slug === "wren/the-shed");
    assert.equal(shed.data._parentMarkId, "wren/the-yard", "the tree's word is kept in data");
    assert.equal(shed.parent, null, "but `parent` is the continuation edge, not containment");
  } finally { f.cleanup(); }
});

test("a mark predicated on a CLASS mark keeps its edge in data, because the FK cannot hold it", async () => {
  const f = fixture();
  try {
    const { marks, census, notPlaced, window } = await seedOf(f);
    const engine = marks.find((m) => m.slug === "the-town/resident-engine");
    assert.equal(engine.parent, null, "a class mark has no marks row for the FK to point at");
    assert.equal(engine.data._parent_is_law, "the-town/resident", "the edge is kept, verbatim");
    assert.equal(census.not_carried.parent_is_law, 1);
    assert.deepEqual(notPlaced.parentIsLaw, [{ id: "the-town/resident-engine", parent: "the-town/resident" }]);
    assert.deepEqual(window.receipts.parent_is_law, notPlaced.parentIsLaw);
  } finally { f.cleanup(); }
});

test("parents are emitted before children, because marks.parent is a non-deferrable self-FK", async () => {
  const f = fixture();
  try {
    const { marks } = await seedOf(f);
    const seen = new Set();
    for (const m of marks) {
      if (m.parent) assert.ok(seen.has(m.parent), `${m.slug} was emitted before its parent`);
      seen.add(m.id);
    }
    // the-glow continues the-light, which continues the-shed: a real chain
    const order = marks.map((m) => m.slug);
    assert.ok(order.indexOf("wren/the-light") < order.indexOf("wren/the-glow"));
  } finally { f.cleanup(); }
});

test("orderByParent names a cycle instead of leaving Postgres to name one row of it", () => {
  assert.throws(() => orderByParent([
    { id: "a", slug: "a", parent: "b" },
    { id: "b", slug: "b", parent: "a" },
  ]), /form a cycle among 2 record\(s\)/);
});

test("a predicated mark whose parent the register cannot explain STOPS the seed", () => {
  const byId = new Map([["wren/the-shed", { id: "wren/the-shed", kind: "sited" }]]);
  assert.throws(() => resolveParent({ id: "x/y", kind: "predicated", parent: "nobody/nothing" }, byId),
    /is predicated on 'nobody\/nothing', which is not in the marks register/);
  assert.throws(() => resolveParent({ id: "x/y", kind: "predicated" }, byId),
    /names no parent/);
});

test("since 004 NOTHING is dropped: the remainder rides `data`, and the loss census is empty", async () => {
  const f = fixture();
  try {
    const { census, marks } = await seedOf(f);
    assert.deepEqual(census.not_carried.fields_with_no_column, {},
      "a non-empty loss census means the remainder rule was edited — it cannot mean the law grew a field");
    assert.equal(census.fields_in_data.date, 4);   // the two records that state none are not counted
    assert.equal(census.fields_in_data.image, 1);
    assert.equal(census.fields_in_data.points, undefined, "`points` is carried inside geometry, not data");
    const shed = marks.find((m) => m.slug === "wren/the-shed");
    assert.equal(shed.data.image, "shed.png");
    assert.equal(shed.data.date, "2026-07-02");
    assert.equal(shed.data._dir, undefined, "`_dir` is the one field dropped — it differs between checkouts");
    assert.equal(shed.data.at, undefined, "a column holds it, so it does not double into data");
  } finally { f.cleanup(); }
});

test("a claim carries the same remainder and the same parent as its mark (004)", async () => {
  const f = fixture();
  try {
    const { marks, claims } = await seedOf(f);
    for (const m of marks) {
      const c = claims.find((x) => x.id === m.id);
      assert.deepEqual(c.data, m.data);
      assert.equal(c.parent, m.parent);
    }
  } finally { f.cleanup(); }
});

test("the census and the loss list are written into windows.receipts", async () => {
  const f = fixture();
  try {
    const { window } = await seedOf(f);
    assert.equal(window.receipts.note, "genesis seed");
    assert.equal(window.receipts.seeded_from.world_sha, f.sha);
    assert.equal(window.receipts.seeded_from.town_sha, "TOWNSHA");
    assert.equal(window.receipts.census.marks, 6);
  } finally { f.cleanup(); }
});

test("the genesis window is the highest crossing in STATE/log, closed at the commit", async () => {
  const f = fixture();
  try {
    const w = genesisWindow({ repo: f.dir, lawSha: f.sha, townSha: null });
    assert.equal(w.id, 7);
    assert.equal(w.status, "closed");
    assert.equal(w.opens_at, "2026-08-26T00:00:00.000Z");
    assert.equal(w.closes_at, "2026-08-26T05:45:16.000Z");
    assert.equal(w.cleared_at, w.closes_at);
    assert.equal(w.law_sha, f.sha);
  } finally { f.cleanup(); }
});

// The successor is written by `writeSeed`, inside the transaction, and there is no
// database here — so what this asserts is the one thing a pure test can: the
// genesis window states the two facts the successor is derived FROM. The row
// itself is proved on the box, by `--verify`, which reds if the candle is unlit.
test("the genesis window states where its successor must open (005: the candle tiles time)", async () => {
  const f = fixture();
  try {
    const w = genesisWindow({ repo: f.dir, lawSha: f.sha, townSha: null });
    assert.equal(w.id + 1, 8, "the successor is the next crossing number");
    assert.equal(w.closes_at, "2026-08-26T05:45:16.000Z", "and opens where this one closed");
  } finally { f.cleanup(); }
});

test("a meta file that disagrees with its own filename about the clock is refused", async () => {
  const f = fixture({ meta: { 7: { crossing: 9, covers_from: "2026-08-26T00:00:00.000Z" } } });
  try {
    assert.throws(() => genesisWindow({ repo: f.dir, lawSha: f.sha, townSha: null }),
      /says crossing 9 — the filename and the file disagree/);
  } finally { f.cleanup(); }
});

test("legacy events ride as action 'legacy:<type>' with the original body in payload", async () => {
  const emission = { at: "2026-08-25T03:20:55.471Z", type: "emission", actor: "aion-solare", id: "sound:1:x", payload: { class: "sound", x: -24.8, y: 45.2, text: "probe" } };
  const departure = { at: "2026-08-25T12:22:04.490Z", type: "departure", actor: "rowan", seq: 732, payload: { from: { x: 1, y: 2 }, crossing: 7.0306 } };
  const f = fixture({ log: { 6: [emission], 7: [departure] } });
  try {
    const { rows, byType, crossings } = deriveActs({ worldRepo: f.dir });
    assert.equal(rows.length, 2);
    assert.deepEqual(byType, { emission: 1, departure: 1 });
    assert.deepEqual(crossings, [6, 7]);

    const [e, d] = rows;                                  // sorted by `at`
    assert.equal(e.action, "legacy:emission");
    assert.equal(e.class, "legacy");
    assert.deepEqual(e.payload, emission, "the original event rides whole");
    assert.equal(e.crossing, 6, "an emission states no crossing — the file's number is the window");
    assert.equal(d.crossing, 7.0306, "a departure states its own fractional crossing");

    // The witnessed-line ruling: a raw world x,y is a photograph, never an anchor.
    for (const r of rows) {
      assert.equal(r.at_anchor, null);
      assert.equal(r.at_dx, null);
      assert.equal(r.at_dy, null);
      assert.equal(r.object, null);
      assert.equal(r.journal_seq, null);
    }
  } finally { f.cleanup(); }
});

test("a log line the seed cannot read stops the seed — it is never skipped", async () => {
  const f = fixture({ log: { 7: [] } });
  try {
    writeFileSync(join(f.dir, "STATE", "log", "7.jsonl"), '{"at":"2026-08-26T00:00:00Z","type":"emission"}\n');
    assert.throws(() => deriveActs({ worldRepo: f.dir }), /has no 'actor'/);
    writeFileSync(join(f.dir, "STATE", "log", "7.jsonl"), "{not json}\n");
    assert.throws(() => deriveActs({ worldRepo: f.dir }), /is not JSON/);
  } finally { f.cleanup(); }
});

test("a checkout that is not at the declared ref is refused, not corrected", async () => {
  const f = fixture();
  try {
    assert.equal(assertRef(f.dir, { tag: "sandbox/seed" }), f.sha, "an ANNOTATED tag resolves to its commit");
    assert.equal(assertRef(f.dir, { sha: f.sha }), f.sha);
    assert.throws(() => assertRef(f.dir, { sha: "0".repeat(40) }), /does not match/);
    assert.throws(() => assertRef(f.dir, { tag: "no-such-tag" }), /does not exist/);
  } finally { f.cleanup(); }
});

test("jsonb sorts object keys — the comparator asks about the value, not the spelling", async () => {
  // What Postgres hands back for `{"w":4,"h":6}`. The verifier's first live run
  // called all 409 marks drift over exactly this.
  assert.equal(canonicalJson({ w: 4, h: 6 }), canonicalJson({ h: 6, w: 4 }));
  assert.notEqual(canonicalJson({ w: 4, h: 6 }), canonicalJson({ w: 4, h: 7 }));
  // Arrays are ordered — a ring reordered IS a different ring.
  assert.notEqual(canonicalJson([[0, 0], [1, 1]]), canonicalJson([[1, 1], [0, 0]]));
  assert.equal(canonicalJson({ at: { y: 2, x: 1 } }), canonicalJson({ at: { x: 1, y: 2 } }));
});
