// world2-fold-parent-id.test.mjs — THE RECORDED `parent_id` IS CARRIED THROUGH marksFromRows (POS-1180, a leaf of WLD-237).
//
//   node --test test/world2-fold-parent-id.test.mjs
//
// Wright, 2026-11-22 12:43Z: "restore the declaration carry (marksFromRows reading the parent_id alias), not a forced tier."
// A continuation (predicate / predicated / naming) whose row carries its parent only as the record's own `data.parent_id`
// lost it in the converter: the continuation branch read the resolved row parent, the law parent, `_explicitParent` and
// `_parentMarkId`, and not the alias, so the fold framed it on the world instead of on the mark it continues. The carry is
// the alias as the LAST source, for the continuations only, and nothing else: no `home`, no forced tier, no row rewritten.
//
// SYNTHETIC records throughout (invented ids and words): no resident's text, no store, no live row.
//   · the alias-only regression (the falsifier: remove only the carry and these go red);
//   · the controls: every stronger parent source still wins, and the kinds that take no authored parent still take none;
//   · the fold arm, against the world's own `marks-fold.mjs` when the tree has a world clone (skipped without one): the
//     alias-only record folds EXACTLY as the same record written the way a file is loaded (`_parentMarkId`).

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { marksFromRows } from "../src/world2-fold.mjs";
import { WORLD_CLONE } from "../src/world-store.mjs";

const PARENT = "aurex-test/the-lantern-house";
const CHILD = "aurex-test/the-lantern-house-notes";
const OTHER = "aurex-test/another-house";

const house = (id, slug) => ({ id, slug, kind: "home", owner: "aurex-test", body: "a house", geometry: { at: { x: 100, y: 100 }, extent: { w: 40, h: 30 } }, parent: null, data: { tier: "market" } });
const child = (kind, data, over = {}) => ({ id: "u-child", slug: CHILD, kind, owner: "aurex-test", body: "notes", geometry: null, parent: null, data, ...over });
const recordOf = (rows, id = CHILD) => marksFromRows(rows, []).find((r) => r.id === id);
const withParents = (c, extra = []) => [house("u-parent", PARENT), house("u-other", OTHER), ...extra, c];

test("THE ALIAS-ONLY CONTINUATION KEEPS ITS PARENT: parent_id alone, in each of the three continuation kinds, is the record's parent and the fold's directory parent, and no `home` is made up", () => {
  for (const kind of ["predicate", "predicated", "naming"]) {
    const rec = recordOf(withParents(child(kind, { parent_id: PARENT })));
    assert.equal(rec.parent, PARENT, `${kind}: the declared parent is carried`);
    assert.equal(rec._parentMarkId, PARENT, `${kind}: and is the parent the fold frames it under`);
    assert.ok(!("home" in rec), `${kind}: no home is set as a substitute`);
    assert.equal(rec.parent_id, PARENT, `${kind}: the declaration itself stays on the record, as the rest of data does`);
  }
});

test("NO ROW IS REWRITTEN AND NO TIER IS FORCED: the input is untouched, and the tier is whatever the record already says", () => {
  const rows = withParents(child("predicate", { parent_id: PARENT, tier: "sovereignty" }));
  const before = JSON.stringify(rows);
  const rec = recordOf(rows);
  assert.equal(JSON.stringify(rows), before, "marksFromRows reads its rows and changes none");
  assert.equal(rec.tier, "sovereignty", "the record's own tier is kept, not replaced by the parent's or a forced one");
  assert.equal(recordOf(withParents(child("predicate", { parent_id: PARENT }))).tier, "market", "and with none, the converter's existing default");
});

test("CONTROLS: every stronger parent source still wins over the alias, in the converter's existing order", () => {
  // the resolved row parent (marks.parent → that row's slug)
  const byRow = recordOf(withParents(child("predicate", { parent_id: OTHER, _parentMarkId: "x/y", _explicitParent: "x/z" }, { parent: "u-parent" })));
  assert.equal(byRow.parent, PARENT);
  // the law parent
  assert.equal(recordOf(withParents(child("predicate", { parent_id: OTHER, _parent_is_law: "class/the-law", _explicitParent: "x/z" }))).parent, "class/the-law");
  // the as-authored parent
  assert.equal(recordOf(withParents(child("naming", { parent_id: OTHER, _explicitParent: PARENT, _parentMarkId: "x/y" }))).parent, PARENT);
  // the directory's parent
  const byDir = recordOf(withParents(child("predicated", { parent_id: OTHER, _parentMarkId: PARENT })));
  assert.equal(byDir.parent, PARENT);
  assert.equal(byDir._parentMarkId, PARENT);
  // and the alias is not preferred over them even when it names a mark that exists
  assert.equal(recordOf(withParents(child("predicate", { parent_id: PARENT, _parentMarkId: OTHER }))).parent, OTHER);
});

test("CONTROLS: the kinds that take no authored parent from this alias still take none", () => {
  // a property's parent is its enclosing mark, from the row, the law or `_parentMarkId`, never `parent_id`
  const property = recordOf(withParents(child("property", { parent_id: PARENT })));
  assert.ok(!("parent" in property), "a property with only the alias has no parent");
  assert.equal(property._parentMarkId, null);
  assert.equal(recordOf(withParents(child("property", { parent_id: OTHER, _parentMarkId: PARENT }))).parent, PARENT, "a property's existing sources are as they were");
  // sited and parcel marks never carry an authored parent: containment is geometry
  for (const kind of ["home", "parcel"]) {
    const rec = recordOf(withParents(child(kind, { parent_id: PARENT })));
    assert.ok(!("parent" in rec), `${kind} carries no authored parent`);
    assert.equal(rec._parentMarkId, null);
  }
});

test("AN ALIAS THAT NAMES NOTHING IS NO PARENT: empty, blank-typed, absent", () => {
  for (const parent_id of ["", null, undefined, 7, {}, []]) {
    const rec = recordOf(withParents(child("predicate", { parent_id })));
    assert.ok(!("parent" in rec), `parent_id ${JSON.stringify(parent_id)}`);
    assert.equal(rec._parentMarkId, null);
  }
  assert.ok(!("parent" in recordOf(withParents(child("predicate", {})))), "no alias, no parent, as before");
});

test("AN EXPLICIT NULL `_parentMarkId` IS NO PARENT, so the declared one is the fold's directory parent; a real one is never displaced", () => {
  const rec = recordOf(withParents(child("predicate", { _parentMarkId: null, parent_id: PARENT })));
  assert.equal(rec.parent, PARENT);
  assert.equal(rec._parentMarkId, PARENT);
  const none = recordOf(withParents(child("predicate", { _parentMarkId: null })));
  assert.equal(none._parentMarkId, null, "with no alias the explicit null stays null");
  assert.equal(recordOf(withParents(child("predicate", { _parentMarkId: OTHER, parent_id: PARENT })))._parentMarkId, OTHER);
});

// ── the fold arm: the alias-only record folds as the file-loaded form does ───────────────────────────────────────

const MF = join(WORLD_CLONE, "tools", "marks-fold.mjs");
const SKELETON = join(WORLD_CLONE, "WORLD", "skeleton.json");
const WHY_SKIP = existsSync(MF) && existsSync(SKELETON) ? false : `no world clone with tools/marks-fold.mjs at ${WORLD_CLONE} (set WORLD_CLONE)`;

test("THROUGH THE WORLD'S OWN FOLD: an alias-only continuation folds exactly as the same record written the way a file is loaded, framed under its parent, with no home", { skip: WHY_SKIP }, async () => {
  const mf = await import(pathToFileURL(MF).href);
  const terrain = JSON.parse(readFileSync(SKELETON, "utf8"));
  const fold = (data) => mf.fold({ marks: marksFromRows(withParents(child("predicate", data)), []), terrain, stakes: [], households: null });
  const foldedChild = (state) => state.marks.find((m) => m.id === CHILD);
  const viaAlias = foldedChild(fold({ parent_id: PARENT }));
  const viaFile = foldedChild(fold({ _parentMarkId: PARENT }));
  const orphaned = foldedChild(fold({}));
  assert.equal(viaAlias.parent, PARENT, "the fold sees the parent");
  assert.equal(viaAlias._frameId, viaFile._frameId, "framed under the same mark as the file form");
  assert.deepEqual(Object.fromEntries(Object.entries(viaAlias).filter(([k]) => k !== "parent_id")),
    Object.fromEntries(Object.entries(viaFile).filter(([k]) => k !== "parent_id")), "every derived field (tier, placement, frame) is the file form's");
  assert.ok(!("home" in viaAlias));
  assert.equal(orphaned.parent, undefined, "and without the carry the same row has no parent at all");
  // the whole fold is the same, the other marks too
  assert.deepEqual(fold({ parent_id: PARENT }).marks.filter((m) => m.id !== CHILD), fold({ _parentMarkId: PARENT }).marks.filter((m) => m.id !== CHILD));
});
