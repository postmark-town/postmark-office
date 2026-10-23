// world-law-shape.mjs — WHICH SHAPE THE WORLD TREE IS IN, decided in ONE place (WLD-116, lane 3).
//
// Classes are LAW NODES, never marks (`postmark-node` -> mark | post | law, ruled
// 2026-10-23). The world moved them out of WORLD/marks/ into
// WORLD/law/<foundry>/<path>/node.md (postmark-world#304), so the office has to read
// a world tree in EITHER of two shapes, and must never break on either, whichever
// of the two lands first:
//
//   class-marks   the OLD shape: a class is a `kind: class` mark filed under the
//                 Keeping Works (WORLD/marks/.../the-keeping-works/**/mark.md);
//                 the fold's state, containment.json and INDEX.md carry its row.
//   law-tree      the NEW shape: WORLD/law/<foundry>/foundry.json beside the
//                 class and property records; the marks tree and the fold's state
//                 hold no class row; WORLD/law-state.json is the derived list.
//
// THE DECISION IS MADE HERE AND NOWHERE ELSE. A reader that must know the shape
// (the ingest, the hydrator, the lint, a fold caller) asks `lawShapeOf` and reads
// the tree through `readWorldRecords`; it never tests a path or a version itself.
// The shape is a fact about the TREE (does WORLD/law/ exist), not about the tools
// (the tools of a sha always ship with its tree, so the world's own
// tools/law.mjs + tools/law-tree.mjs are imported FROM THE CHECKOUT BEING READ,
// the way world2/tools/law-ingest.mjs imports marks-fold.mjs; nothing here copies
// them).
//
// What the STORE holds is a different question and needs no detection: the
// hydrator writes a law node as a node of kind `law` (LAW_NODE_KIND), and a class
// mark of the old shape as a `mark` with subkind `class`. The store's gates
// (world-store.mjs § the declaration gates) accept the first outright and the
// second by the old position clause. The old arm is the compatibility read and is
// dropped, in that one place, when the old shape is gone.

import { existsSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

/** The store node `kind` of a law node (a class or one of its properties). Marks stay `mark`. */
export const LAW_NODE_KIND = "law";
/** The kinds a law node can be, as the world's tools/law.mjs names them (LAW_KINDS). */
export const LAW_SUBKINDS = Object.freeze(["class", "property"]);

/** The fold's derived list of every law node, beside world-state.json (the tree is the source; this is regenerated at every fold). */
export const LAW_STATE_FILE = "WORLD/law-state.json";

export const SHAPE_LAW_TREE = "law-tree";
export const SHAPE_CLASS_MARKS = "class-marks";

/** Where the law tree stands beside a marks tree: WORLD/marks -> WORLD/law; or `_law/` inside a fixture world's marks dir (the world's own lawDirFor, same rule). */
export function lawDirOf(marksDir) {
  const root = resolve(String(marksDir));
  const inside = join(root, "_law");
  return isDir(inside) ? inside : join(dirname(root), "law");
}

const isDir = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };

/** THE ONE DETECTION, over a marks directory: is there a law tree beside it? */
export const lawShapeOfMarksDir = (marksDir) => (isDir(lawDirOf(marksDir)) ? SHAPE_LAW_TREE : SHAPE_CLASS_MARKS);

/** THE ONE DETECTION, over a world checkout root (the directory that holds WORLD/): law tree or `WORLD/law-state.json` present -> law-tree. */
export function lawShapeOf(worldRoot) {
  const root = resolve(String(worldRoot));
  if (lawShapeOfMarksDir(join(root, "WORLD", "marks")) === SHAPE_LAW_TREE) return SHAPE_LAW_TREE;
  return existsSync(join(root, LAW_STATE_FILE)) ? SHAPE_LAW_TREE : SHAPE_CLASS_MARKS;
}

const toolUrl = (toolsDir, file) => pathToFileURL(join(resolve(toolsDir), file)).href;

/**
 * Read a world tree in whichever shape it is in.
 *
 *   { marksDir, toolsDir, loadMarks }   the checkout's marks directory, its tools/
 *                                       directory and ITS OWN loadMarks (the caller
 *                                       already imports marks-fold from there)
 *
 * Returns { shape, marks, law, problems, tools }:
 *   marks  the marks, as loadMarks reads them (the old shape's still include the class marks)
 *   law    the law nodes in reading order (the new shape's classes and properties; [] in the old shape)
 *   tools  { isClass, isProperty, isLawNode, classRoster, foundryOf } from the checkout's
 *          tools/law.mjs, plus `kindIndexOf` (tools/mark-kind.mjs: the class lineage the fold,
 *          the placement and the containment walks take as their `kindIndex`); null in the old shape
 *
 * A tree that has WORLD/law/ but no tools/law-tree.mjs is a refusal, named: reading it
 * as the old shape would silently find no class at all.
 */
export async function readWorldRecords({ marksDir, toolsDir, loadMarks }) {
  const shape = lawShapeOfMarksDir(marksDir);
  const marks = loadMarks(marksDir);
  if (shape === SHAPE_CLASS_MARKS) return { shape, marks, law: [], problems: [], tools: null };
  let treeMod, lawMod, kindMod;
  try {
    [treeMod, lawMod, kindMod] = await Promise.all([import(toolUrl(toolsDir, "law-tree.mjs")), import(toolUrl(toolsDir, "law.mjs")), import(toolUrl(toolsDir, "mark-kind.mjs"))]);
  } catch (e) {
    throw new Error(`${lawDirOf(marksDir)} exists, but the world's own tools/law-tree.mjs and tools/law.mjs cannot be imported from ${toolsDir} (${String(e.message).split("\n")[0]}) — a law tree is read by the tools that shipped with it`);
  }
  const { nodes, problems } = treeMod.loadLaw(lawDirOf(marksDir));
  const { isClass, isProperty, isLawNode, classRoster, foundryOf } = lawMod;
  return { shape, marks, law: nodes, problems, tools: { isClass, isProperty, isLawNode, classRoster, foundryOf, kindIndexOf: kindMod.kindIndexOf } };
}

/**
 * A record's file name, in either shape: `node.md` in the law tree (a class is a law node,
 * WLD-116), `mark.md` in the marks tree. A reader that lists a directory the WORLD names (the
 * creature class's, `CREATURE_LAW_DIR`, which moves with the world's own tools) asks these two,
 * never a name it was written with. The directory the world's own tools name is what decides
 * the shape there; the file name is how the office finds the records in it.
 */
export const RECORD_FILE_NAMES = Object.freeze(["node.md", "mark.md"]);
export const RECORD_FILE_RE = /(^|[\\/])(mark|node)\.md$/;
/** The first of RECORD_FILE_NAMES that `exists(relPath)` finds under `dir`, or null. */
export const recordFileIn = (dir, exists) => RECORD_FILE_NAMES.map((f) => `${dir}/${f}`).find((p) => exists(p)) ?? null;

/**
 * The law a PUBLISHED world carries: the nodes of WORLD/law-state.json (the fold's derived list
 * of every law node), or none. The readers that cannot read the tree (the office reads the blessed
 * ref over git, the viewer reads a staged file) read the law here. A ref in the old shape has no
 * such file and its classes are among its marks, so `[]` is the right answer there, not a gap.
 */
export const lawNodesOfState = (doc) => (Array.isArray(doc?.nodes) ? doc.nodes : []);

/** Every record the tree holds in ONE list (marks then law). What a fold takes in either shape: the new fold splits the law out itself, the old fold has no law to split. */
export const recordsOf = ({ marks, law }) => (law?.length ? [...marks, ...law] : marks);

/** The law nodes of a store row list or node list: is this attr a law node? (`kind` is the store's node kind.) */
export const isLawNodeAttr = (attr) => attr?.kind === LAW_NODE_KIND;
