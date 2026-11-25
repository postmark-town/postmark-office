// static-filing.test.mjs — THE FREEZE, the office's half.
//
//   node --test test/static-filing.test.mjs
//
// THE LAW, quoted verbatim, because these falsifiers assert it and not a brief
// (LOGOS/state-and-time.md § "The freeze — filing is static, and the tree is a
// fossil"; founder-ruled 2026-08-25, world main 258af3d6):
//
//   "Filing is frozen as of 2026-08-25. A mark's directory is its historical
//    filing: it carries no claim, and it never moves again. New marks are filed
//    by identity — WORLD/marks/<household>/<slug>/ — and containment lives only
//    in the derived fold, emitted as an artifact each settlement."
//
//   "The re-home pass is DELETED from the settlement save. The settlement writes
//    a mark once; nothing moves it after."
//
//   "'The tree is the map' moves to where derived views live: the fold emits the
//    containment map beside `world-state.json` every settlement. The browsable
//    truth is generated; the source files rest."
//
// The office half is four changes and this file is their falsifier:
//
//   1. the live write door (world-journal.mjs `pathFor`) files sited/parcel at
//      the mark's id, and predication still nests;
//   2. `contains` edges are read from WORLD/containment.json, with a LOUD
//      fallback to directory nesting for a clone from before the freeze;
//   3. the keeping-works gate — whether a mark may MINT A VERB — is re-keyed
//      from a path substring to containment, in SQL and in JS, from ONE
//      implementation;
//   4. `containmentSpine` follows the re-keyed edges.
//
// Every check here flips: each one has a companion asserting the OTHER answer,
// so a gate that always says yes and a gate that always says no both go red.

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { MultiDirectedGraph } from "graphology";

import { pathFor, replayDrafts, ACTION_LEAVE, ACTION_WITHDRAW, CLASS_MARK } from "../src/world-journal.mjs";
import {
  CLASS_MARK_GATE_SQL, CLASS_ROSTER_GATE_SQL, worksClause, WORLD_CLONE,
  isClassMark, isClassDefinition, standsInTheWorks, containmentSpine,
} from "../src/world-store.mjs";

// ─────────────────────────────────────────────────────────────────────────────
// 1. THE WRITE DOOR FILES BY IDENTITY
// ─────────────────────────────────────────────────────────────────────────────

test("a sited mark files at its id — \"New marks are filed by identity — WORLD/marks/<household>/<slug>/\"", () => {
  assert.equal(
    pathFor({ id: "alpha/the-lamp", slug: "the-lamp", by: "alpha", kind: "sited" }),
    "WORLD/marks/alpha/the-lamp/mark.md");
});

test("a parcel files at its id too — the freeze binds the kinds whose directory was ever a containment claim", () => {
  assert.equal(
    pathFor({ id: "alpha/my-parcel", slug: "my-parcel", by: "alpha", kind: "parcel" }),
    "WORLD/marks/alpha/my-parcel/mark.md");
});

test("THE FLIP: a sited mark does NOT land at the pre-freeze root fallback", () => {
  // The rule this replaces put every draft under the world root's own
  // directory, on the reasoning that "the settlement re-homes by geometry
  // regardless of where the file sits". The freeze DELETED the mover, so where
  // this door files is where the mark lives forever. If this assertion ever
  // passes, the office is writing marks the settlement can no longer relocate
  // into a directory that claims a containment it does not have.
  const p = pathFor({ id: "alpha/the-lamp", slug: "the-lamp", by: "alpha", kind: "sited" });
  assert.notEqual(p, "WORLD/marks/let-there-be-light/the-lamp/mark.md");
  assert.doesNotMatch(p, /let-there-be-light/);
});

test("predication still NESTS — \"it is its parent continued\", and the freeze does not touch authorship", () => {
  // A predicated/naming mark carries no at/extent, has no footprint to be
  // contained by anything, and takes its subject from the mark it is nested
  // inside. The world's own gate B draws exactly this line: bind these kinds to
  // their id path and no predicate could ever attach to a MARK again.
  const nested = pathFor(
    { id: "alpha/lamp-colour", slug: "lamp-colour", by: "alpha", kind: "predicated", parent_id: "alpha/the-lamp" },
    { parentPathOf: (pid) => pid === "alpha/the-lamp" ? "WORLD/marks/alpha/the-lamp" : null });
  assert.equal(nested, "WORLD/marks/alpha/the-lamp/lamp-colour/mark.md");

  const named = pathFor(
    { id: "alpha/its-name", slug: "its-name", by: "alpha", kind: "naming", parent_id: "alpha/the-lamp" },
    { parentPathOf: () => "WORLD/marks/alpha/the-lamp" });
  assert.equal(named, "WORLD/marks/alpha/the-lamp/its-name/mark.md");
});

test("THE FLIP: a predicated mark whose parent cannot be resolved has NO filing (held by name), NOT the root and NOT the id path", () => {
  // The one place the two rules must not be collapsed into "always file at the id". An unresolvable declared parent is a resolution failure, and filing the
  // predicate at its own id would silently turn a description of a mark into a top-level record describing nothing. Since POS-1212 (Wright, 2026-11-24 13:21Z)
  // the root fallback is gone too: the answer is null, and the write-down's planner holds the mark by name (store-writedown.mjs § filingHolds).
  assert.equal(
    pathFor({ id: "alpha/lamp-colour", slug: "lamp-colour", by: "alpha", kind: "predicated", parent_id: "alpha/the-lamp" },
      { parentPathOf: () => null }),
    null);
});

test("GATE A BEFORE GATE B: a mark that already has a filing keeps it — \"it never moves again\"", () => {
  // Filing by identity is the rule for a mark with NO filing yet. Amending a
  // mark filed before the freeze must not send the record to a new directory
  // while the old file stands: two files, one id, and the world's own gate A
  // refusing the result. That is the publish+re-home wedge (#1862) in a new coat.
  const fossil = "WORLD/marks/let-there-be-light/the-town-centre/the-lamp/mark.md";
  assert.equal(
    pathFor({ id: "alpha/the-lamp", slug: "the-lamp", by: "alpha", kind: "sited" },
      { publishedPathOf: (id) => id === "alpha/the-lamp" ? fossil : null }),
    fossil);
});

test("THE FLIP: with no existing filing to keep, the same lookup yields the id path", () => {
  // The gate-A arm must be able to NOT fire, or the test above would pass on a
  // pathFor that had simply stopped filing by identity altogether.
  assert.equal(
    pathFor({ id: "alpha/the-lamp", slug: "the-lamp", by: "alpha", kind: "sited" },
      { publishedPathOf: () => null }),
    "WORLD/marks/alpha/the-lamp/mark.md");
});

test("replayDrafts reports the FOSSIL path when canon already holds the mark being amended", () => {
  const fossil = "WORLD/marks/let-there-be-light/the-town-centre/the-lamp/mark.md";
  const { marks } = replayDrafts(
    [markRow(1, "alpha/the-lamp", { by: "alpha", slug: "the-lamp", kind: "sited", at: { x: 1, y: 1 }, extent: { w: 1, h: 1 }, body: "amended" })],
    { publishedIds: new Set(["alpha/the-lamp"]), publishedPathOf: (id) => id === "alpha/the-lamp" ? fossil : null });
  assert.equal(marks[0].status, "modified");
  assert.equal(marks[0].path, fossil,
    "the overlay must name where the record actually lands, or the author is shown a move that will not happen");
});

// ─────────────────────────────────────────────────────────────────────────────
// 1d. FOSSIL-AWARE FILING — the manifest is the first answer
// ─────────────────────────────────────────────────────────────────────────────
//
// THE RULE (founder-ruled; addendum 2026-08-25): a mark's path is wherever it
// was born, forever. For a mark named in the world repo's
// `WORLD/filing-freeze.json`, the computed path IS its manifest path — so an
// amend of a fossil never computes a new directory and never tries to move.
// Only marks the manifest does not name file at `WORLD/marks/<by>/<slug>/`.

test("a FOSSIL mark computes its manifest path, not its id path", () => {
  const manifest = new Map([["alpha/the-lamp", "WORLD/marks/let-there-be-light/the-town-centre/the-lamp/mark.md"]]);
  assert.equal(
    pathFor({ id: "alpha/the-lamp", slug: "the-lamp", by: "alpha", kind: "sited" },
      { publishedPathOf: (id) => manifest.get(id) ?? null }),
    "WORLD/marks/let-there-be-light/the-town-centre/the-lamp/mark.md");
});

test("THE FLIP: a mark the manifest does NOT name files at its id", () => {
  const manifest = new Map([["alpha/the-lamp", "WORLD/marks/let-there-be-light/the-town-centre/the-lamp/mark.md"]]);
  assert.equal(
    pathFor({ id: "alpha/born-after", slug: "born-after", by: "alpha", kind: "sited" },
      { publishedPathOf: (id) => manifest.get(id) ?? null }),
    "WORLD/marks/alpha/born-after/mark.md");
});

test("the fossil's directory is taken VERBATIM — never recomposed from parent + slug", () => {
  // A fossil's leaf directory is not guaranteed to equal its slug, and
  // recomposing would quietly relocate any mark where they differ. The manifest
  // names the whole path; use it whole.
  const odd = "WORLD/marks/let-there-be-light/a-quarter/an-old-leaf-name/mark.md";
  assert.equal(
    pathFor({ id: "alpha/the-lamp", slug: "the-lamp", by: "alpha", kind: "sited" },
      { publishedPathOf: () => odd }),
    odd);
});

test("a record with no `by` and no id to read one from has NO filing: not WORLD/marks/undefined, and not the root (POS-1212)", () => {
  assert.equal(pathFor({ slug: "orphan", kind: "sited" }), null);
  assert.equal(pathFor({ id: "", slug: "", kind: "sited" }), null);
});

test("`by` is read off the id when the payload does not carry it", () => {
  assert.equal(pathFor({ id: "alpha/the-lamp", kind: "sited" }), "WORLD/marks/alpha/the-lamp/mark.md");
});

// ─────────────────────────────────────────────────────────────────────────────
// 1b. THE FRAME IS UNCHANGED — this is a FILING change, not a geometry change
// ─────────────────────────────────────────────────────────────────────────────
//
// `WORLD/marks/<by>/<slug>/` has no mark.md above it, so the loader frames it on
// the world origin. `WORLD/marks/let-there-be-light/<slug>/` is framed on the
// root mark's centre — and the root's centre IS the world origin (`at: {x: 0,
// y: 0}` in WORLD/marks/let-there-be-light/mark.md). Same digits either way.
//
// The two "is this record nested?" detectors downstream must therefore both read
// an id path as ROOT-FRAMED, or the drain would apply a parent-offset conversion
// to numbers that are already world numbers. They are asserted here rather than
// trusted, because they are spelled as path-prefix tests that nobody re-read
// when the paths changed.

const DRAIN_ROOT_PREFIX = "WORLD/marks/let-there-be-light";

/** world-drain.mjs `planDrain`'s nested test, verbatim. */
const drainSaysNested = (path) => Boolean(path)
  && path.startsWith(`${DRAIN_ROOT_PREFIX}/`)
  && path.slice(DRAIN_ROOT_PREFIX.length + 1).split("/").length > 2;

/** world-branches.mjs `draftDeltaForKey`'s nested test, verbatim. */
const branchesSayNested = (path) => {
  const P = "WORLD/marks/let-there-be-light/";
  return path.startsWith(P) && path.slice(P.length).split("/").length > 2;
};

test("the drain reads an id-filed path as ROOT-FRAMED — no parent-offset conversion is applied", () => {
  assert.equal(drainSaysNested("WORLD/marks/alpha/the-lamp/mark.md"), false);
  // ...and it still reads a genuinely nested predicate as nested, or the
  // detector has simply stopped detecting.
  assert.equal(drainSaysNested("WORLD/marks/let-there-be-light/the-quay/a-bollard/mark.md"), true);
});

test("the branches overlay reads an id-filed path as ROOT-FRAMED, and a nested one as nested", () => {
  assert.equal(branchesSayNested("WORLD/marks/alpha/the-lamp/mark.md"), false);
  assert.equal(branchesSayNested("WORLD/marks/let-there-be-light/the-quay/a-bollard/mark.md"), true);
});

test("the collision case is harmless: a household literally handled `let-there-be-light` still reads root-framed", () => {
  // `WORLD/marks/let-there-be-light/<slug>/mark.md` is two segments past the
  // prefix, so neither detector calls it nested. It would COLLIDE with the world
  // root's own directory, which is a registrar question, not a frame bug.
  assert.equal(drainSaysNested("WORLD/marks/let-there-be-light/the-lamp/mark.md"), false);
  assert.equal(branchesSayNested("WORLD/marks/let-there-be-light/the-lamp/mark.md"), false);
});

// ─────────────────────────────────────────────────────────────────────────────
// 1c. THE §1c OVERLAY REPORTS THE SAME PATH THE DRAIN WILL WRITE
// ─────────────────────────────────────────────────────────────────────────────

const markRow = (seq, id, payload, action = ACTION_LEAVE) => ({
  seq, crossing: 1, actor: id.split("/")[0], action, object: id,
  at: { anchor: null, dx: null, dy: null }, witnesses: null,
  class: CLASS_MARK, payload, effect: null, household: id.split("/")[0], written_at: "2026-08-25T00:00:00Z",
});

test("replayDrafts reports the id path for a sited draft, and the nested path for the predicate that describes it", () => {
  const { marks } = replayDrafts([
    markRow(1, "alpha/the-lamp", { by: "alpha", slug: "the-lamp", kind: "sited", at: { x: 10, y: 10 }, extent: { w: 2, h: 2 }, body: "a lamp" }),
    markRow(2, "alpha/lamp-colour", { by: "alpha", slug: "lamp-colour", kind: "predicated", parent_id: "alpha/the-lamp", slot: "colour", value: "green", body: "green" }),
  ]);
  const byId = Object.fromEntries(marks.map((m) => [m.id, m.path]));
  assert.equal(byId["alpha/the-lamp"], "WORLD/marks/alpha/the-lamp/mark.md");
  assert.equal(byId["alpha/lamp-colour"], "WORLD/marks/alpha/the-lamp/lamp-colour/mark.md",
    "the predicate follows the mark it describes to the mark's NEW home, or the two halves of one write disagree about where they are");
});

test("a withdrawal of a published mark canon cannot locate still guesses the id path, not the pre-freeze fallback", () => {
  const { marks } = replayDrafts(
    [
      markRow(1, "alpha/the-lamp", { by: "alpha", slug: "the-lamp", kind: "sited", at: { x: 1, y: 1 }, extent: { w: 1, h: 1 }, body: "a lamp" }),
      markRow(2, "alpha/the-lamp", { by: "alpha", slug: "the-lamp" }, ACTION_WITHDRAW),
    ],
    { publishedIds: new Set(["alpha/the-lamp"]), publishedPathOf: () => null });
  assert.equal(marks.length, 1);
  assert.equal(marks[0].status, "deleted");
  assert.equal(marks[0].path, "WORLD/marks/alpha/the-lamp/mark.md");
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. THE KEEPING-WORKS GATE READS CONTAINMENT, NOT THE PATH
// ─────────────────────────────────────────────────────────────────────────────
//
// THE QUIET BITE this closes: whether a mark may MINT A VERB was a
// `/the-keeping-works/` substring in its stored path. Under the freeze a class
// mark filed at `WORLD/marks/<by>/<slug>/` stands in the works by containment,
// fails the substring, and mints nothing — with no refusal, no log line, and a
// door that simply is not there.
//
// `props.in_works` is stamped at hydration from the fold's own containment
// chain. The path arm survives ONLY where the key is absent — a store hydrated
// before the stamp existed — so a pre-freeze index keeps its doors.

const NODES_DDL = `CREATE TABLE nodes (
  id TEXT PRIMARY KEY, kind TEXT, subkind TEXT, tier TEXT, by TEXT,
  at_x REAL, at_y REAL, extent_w REAL, extent_h REAL, props TEXT)`;

const WORKS_PATH = "WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/a-law";
const OUTSIDE_PATH = "WORLD/marks/let-there-be-light/the-town-centre/a-law";
const ID_PATH = "WORLD/marks/the-town/a-law";

/** A town-authored, constitution-tier, verb-minting class mark. */
const lawMark = (id, props) => ({
  id, kind: "mark", tier: "constitution", by: "the-town",
  props: { class: "bounty", actions: ["post"], ...props },
});

const storeWith = (rows) => {
  const db = new DatabaseSync(":memory:");
  db.exec(NODES_DDL);
  const ins = db.prepare("INSERT INTO nodes (id,kind,tier,by,props) VALUES (?,?,?,?,?)");
  for (const r of rows) ins.run(r.id, r.kind, r.tier, r.by, JSON.stringify(r.props));
  return db;
};
const selected = (db, sql) => db.prepare(`SELECT id FROM nodes WHERE ${sql}`).all().map((r) => r.id);
const attrOf = (db, id) => {
  const r = db.prepare("SELECT id, kind, tier, by, props FROM nodes WHERE id = ?").get(id);
  return { kind: r.kind, tier: r.tier, by: r.by, props: JSON.parse(r.props) };
};

test("a class mark FILED AT ITS ID, inside the works BY CONTAINMENT, mints its verb", () => {
  // Its path names no works directory. Only the containment stamp says it is
  // standing there, and that is now the question the gate asks.
  const db = storeWith([lawMark("the-town/a-law", { path: ID_PATH, in_works: true })]);
  assert.deepEqual(selected(db, CLASS_MARK_GATE_SQL), ["the-town/a-law"]);
  assert.equal(isClassMark(attrOf(db, "the-town/a-law")), true);
  assert.equal(isClassDefinition(attrOf(db, "the-town/a-law")), true);
  db.close();
});

test("THE FLIP: the same mark OUTSIDE the works mints nothing — position is still a real clause", () => {
  const db = storeWith([lawMark("the-town/a-law", { path: ID_PATH, in_works: false })]);
  assert.deepEqual(selected(db, CLASS_MARK_GATE_SQL), []);
  assert.equal(isClassMark(attrOf(db, "the-town/a-law")), false);
  assert.equal(isClassDefinition(attrOf(db, "the-town/a-law")), false);
  db.close();
});

test("THE FLIP: a stamp of `false` beats a path that says works — the containment answer is the answer", () => {
  // A mark whose historical filing sits inside the works directory but whose
  // ground puts it elsewhere. Under the old law the fossil would have kept
  // minting; under the freeze the directory "carries no claim".
  const db = storeWith([lawMark("the-town/a-law", { path: WORKS_PATH, in_works: false })]);
  assert.deepEqual(selected(db, CLASS_MARK_GATE_SQL), []);
  assert.equal(standsInTheWorks(attrOf(db, "the-town/a-law")), false);
  db.close();
});

test("the FALLBACK: a store hydrated before the stamp existed still answers off the path, both ways", () => {
  const db = storeWith([
    lawMark("the-town/legacy-in", { path: WORKS_PATH }),
    lawMark("the-town/legacy-out", { path: OUTSIDE_PATH }),
  ]);
  assert.deepEqual(selected(db, CLASS_MARK_GATE_SQL), ["the-town/legacy-in"]);
  assert.equal(standsInTheWorks(attrOf(db, "the-town/legacy-in")), true);
  assert.equal(standsInTheWorks(attrOf(db, "the-town/legacy-out")), false);
  db.close();
});

test("SQL and predicate select the same nodes — one boundary, never two answers", () => {
  // The comment on CLASS_MARK_GATE_SQL says a test asserts this. It does, and it
  // now has to hold across the stamp, its absence, and an explicit false.
  const rows = [
    lawMark("the-town/stamped-in", { path: ID_PATH, in_works: true }),
    lawMark("the-town/stamped-out", { path: WORKS_PATH, in_works: false }),
    lawMark("the-town/legacy-in", { path: WORKS_PATH }),
    lawMark("the-town/legacy-out", { path: OUTSIDE_PATH }),
    { id: "someone/not-the-town", kind: "mark", tier: "constitution", by: "someone",
      props: { class: "bounty", actions: ["post"], path: ID_PATH, in_works: true } },
  ];
  const db = storeWith(rows);
  const bySql = new Set(selected(db, CLASS_MARK_GATE_SQL));
  const byPredicate = new Set(rows.filter((r) => isClassMark(attrOf(db, r.id))).map((r) => r.id));
  assert.deepEqual([...bySql].sort(), [...byPredicate].sort());
  assert.deepEqual([...bySql].sort(), ["the-town/legacy-in", "the-town/stamped-in"]);
  db.close();
});

test("the roster gate re-keys with it — a class NAME filed at its id is still a lawful name", () => {
  const db = storeWith([
    { id: "the-town/a-classless-law", kind: "mark", tier: "constitution", by: "the-town",
      props: { class: "parcel", path: ID_PATH, in_works: true } },   // no actions: — roster, not verb-minting
  ]);
  assert.deepEqual(selected(db, CLASS_ROSTER_GATE_SQL), ["the-town/a-classless-law"]);
  assert.deepEqual(selected(db, CLASS_MARK_GATE_SQL), [], "the roster gate is WIDER than the verb gate — it must not have collapsed into it");
  db.close();
});

test("worksClause takes its alias, so a joined query reads the same clause without a hand-copy", () => {
  const db = storeWith([lawMark("the-town/a-law", { path: ID_PATH, in_works: true })]);
  const aliased = db.prepare(`SELECT c.id FROM nodes AS c WHERE ${worksClause("c")}`).all().map((r) => r.id);
  const bare = selected(db, worksClause());
  assert.deepEqual(aliased, bare);
  db.close();
});

test("THE FLIP: worksClause can refuse — a clause that selected everything would prove nothing above", () => {
  const db = storeWith([
    lawMark("the-town/in", { path: ID_PATH, in_works: true }),
    lawMark("the-town/out", { path: OUTSIDE_PATH, in_works: false }),
  ]);
  assert.deepEqual(selected(db, worksClause()), ["the-town/in"]);
  db.close();
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. THE CONTAINMENT SPINE FOLLOWS THE RE-KEYED EDGES
// ─────────────────────────────────────────────────────────────────────────────

test("containmentSpine walks an id-filed mark up to the root through the map's edges", () => {
  // The whole point of re-keying `contains`: this mark's DIRECTORY is
  // `WORLD/marks/alpha/the-lamp`, one level under WORLD/marks and nested inside
  // nothing. Its spine is the ground's answer, and the ground says it stands in
  // the quay, in the town centre, in the light.
  const g = new MultiDirectedGraph();
  for (const id of ["the-town/let-there-be-light", "the-town/the-town-centre", "the-town/the-quay", "alpha/the-lamp"])
    g.addNode(id, { kind: "mark" });
  const contains = (src, dst) => g.addDirectedEdge(src, dst, { type: "contains", nesting: "containment-map" });
  contains("the-town/let-there-be-light", "the-town/the-town-centre");
  contains("the-town/the-town-centre", "the-town/the-quay");
  contains("the-town/the-quay", "alpha/the-lamp");

  assert.deepEqual(containmentSpine(g, "alpha/the-lamp"),
    ["the-town/the-quay", "the-town/the-town-centre", "the-town/let-there-be-light"]);
});

test("THE FLIP: with no contains edge the spine is empty — an unre-keyed hydration leaves id-filed marks orphaned", () => {
  // This is what the office did before the re-key: a mark with no directory
  // parent got no `contains` edge at all, so its standpoint had no spine and
  // every ambient-vs-spine reach question about it answered from nowhere.
  const g = new MultiDirectedGraph();
  g.addNode("alpha/the-lamp", { kind: "mark" });
  assert.deepEqual(containmentSpine(g, "alpha/the-lamp"), []);
});
