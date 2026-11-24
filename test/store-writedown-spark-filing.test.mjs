// store-writedown-spark-filing.test.mjs — A SPARK FILES AT ITS ID, SITED OR NOT (POS-1209; WLD-173's mark-lint rule).
//
// THE INCIDENT (2026-11-24 06:00Z, window 330). The settlement sweep refused all publication: "the crossing does not lint clean: 25 error(s) — a spark is
// never anchored: it writes no parent: and files at its id". Twenty-five of wright's sparks (owner `wright`, drawn in the sketchbook `let-there-be-light`,
// unsited and parentless in the store) were filed by the store's write-down at `WORLD/marks/let-there-be-light/halloween-…/mark.md`, the root fallback,
// instead of at their own id `WORLD/marks/wright/halloween-…/mark.md`. `pathFor`'s own-id filing (Gate B) was `isSited`-only; a spark stands "spark", never
// sited, and has no parent, so it fell through to the parent-or-root branch. These were the first sparks whose owner's handle is not their sketchbook's name.
//
// THE FIX files a spark at its id. It is not made sited and given no parent; every other kind files as it did, and an existing (published) filing still wins.
//
// WHAT THIS RUNS. The store's REAL write-down plan (`planStoreWriteDown`: the path decision the write-down files by) over mark rows in the shape the store
// hands it (`kind: spark`, no parent, a place and a frame as the door wrote them), the journal's own replay (`replayDrafts`, the resident-facing `dir`),
// and the controls: sited, nested, an unsited non-spark, and a published spark. Every name here is invented.
//   node --test test/store-writedown-spark-filing.test.mjs
//
// FALSIFIER (run, see the PR): take the spark branch out of `pathFor` (`isSpark ||`) and the owner-different-from-sketchbook tests go red at the
// let-there-be-light path.

import test from "node:test";
import assert from "node:assert/strict";
import { planStoreWriteDown } from "../src/store-writedown.mjs";
import { pathFor, replayDrafts, CLASS_MARK, ACTION_LEAVE } from "../src/world-journal.mjs";

const SKETCHBOOK_ROOT = "WORLD/marks/let-there-be-light";
const pathsOf = (plan) => Object.fromEntries(plan.households.flatMap((h) => h.upserts.map((u) => [u.id, u.path])));
const row = (id, kind, fileRec = {}) => {
  const [by, ...rest] = id.split("/");
  return { id, by, slug: rest.join("/"), household: "hh:starforge", kind, plannedPath: null, locked_window: 330,
    fileRec: { kind, by, date: "2026-11-24", ...fileRec }, bytes: null };
};
// the door's own spark: the owner's handle (`wright`) is NOT the sketchbook's name (`let-there-be-light`), an unsited spark carries a place and a frame and writes no parent
const spark = (id, extra = {}) => row(id, "spark", { at: { x: 120, y: -40 }, extent: { w: 20, h: 20 }, body: "The bowls are full, but sealed.", household: "hh:starforge", ...extra });

test("an unsited, parentless spark whose owner differs from its sketchbook files at <owner>/<slug>, in the write-down plan the store files by", () => {
  const m = spark("wright/halloween-the-bowls-are-full-but-sealed");
  assert.equal(m.fileRec.parent_id, undefined, "no parent was invented for it");
  assert.equal(m.fileRec.at.anchor, undefined, "and it is not sited: no anchor, no `kind: sited`");
  const plan = planStoreWriteDown([m]);
  const path = pathsOf(plan)["wright/halloween-the-bowls-are-full-but-sealed"];
  assert.equal(path, "WORLD/marks/wright/halloween-the-bowls-are-full-but-sealed/mark.md");
  assert.ok(!path.startsWith(SKETCHBOOK_ROOT), "never the sketchbook's folder");
});

test("a whole crossing of them (the window-330 shape: several owners' sparks, one sketchbook) files each at its own id", () => {
  const ids = ["wright/halloween-the-bowls-are-full-but-sealed", "wright/the-starforge-spire-mystery", "wright/darko-s-dinner-night-one", "quill/chest-hunt-clue-3"];
  const plan = planStoreWriteDown(ids.map((id) => spark(id)));
  const p = pathsOf(plan);
  for (const id of ids) assert.equal(p[id], `WORLD/marks/${id}/mark.md`, id);
  assert.equal(Object.values(p).filter((x) => x.startsWith(SKETCHBOOK_ROOT)).length, 0);
});

test("the journal's own filing (the resident-facing dir) agrees: a spark's draft files at its id", () => {
  assert.equal(pathFor({ id: "wright/halloween-x", kind: "spark" }), "WORLD/marks/wright/halloween-x/mark.md");
  const rows = [{ seq: 1, class: CLASS_MARK, action: ACTION_LEAVE, object: "wright/halloween-x", payload: { kind: "spark", by: "wright", at: { x: 1, y: 2 }, extent: { w: 20, h: 20 } } }];
  const { marks } = replayDrafts(rows, {});
  assert.equal(marks.length, 1);
  assert.match(JSON.stringify(marks[0]), /WORLD\/marks\/wright\/halloween-x\/mark\.md/);
});

test("CONTROLS: nothing else changes: sited and nested filing, an unsited non-spark at its maker's id (POS-1212), and a published spark keeps its filing", () => {
  // a sited mark files at its id, as ever
  assert.equal(pathFor({ id: "alpha/garden", kind: "sited", by: "alpha", slug: "garden" }), "WORLD/marks/alpha/garden/mark.md");
  // a naming mark nests under its parent, as ever
  assert.equal(pathFor({ id: "alpha/call-it-garden", kind: "naming", parent_id: "alpha/garden" }, { parentPathOf: () => "WORLD/marks/alpha/garden" }),
    "WORLD/marks/alpha/garden/call-it-garden/mark.md");
  // POS-1212: the spark's own-id filing is now the default for every parentless kind, so an unsited, parentless non-spark files at its maker's id too (this test stays as the control)
  assert.equal(pathFor({ id: "alpha/a-note", kind: "note" }), "WORLD/marks/alpha/a-note/mark.md");
  // gate A: a spark canon already holds keeps the filing it has (an existing filing never moves)
  assert.equal(pathFor({ id: "wright/old-spark", kind: "spark" }, { publishedPathOf: () => "WORLD/marks/let-there-be-light/old-spark/mark.md" }),
    "WORLD/marks/let-there-be-light/old-spark/mark.md");
  // a sited mark in the same batch as a spark: both file as they should
  const plan = planStoreWriteDown([row("alpha/garden", "sited", { at: { x: 0, y: 0 }, extent: { w: 10, h: 10 } }), spark("wright/halloween-y")]);
  const p = pathsOf(plan);
  assert.equal(p["alpha/garden"], "WORLD/marks/alpha/garden/mark.md");
  assert.equal(p["wright/halloween-y"], "WORLD/marks/wright/halloween-y/mark.md");
});
