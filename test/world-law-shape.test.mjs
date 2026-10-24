// world-law-shape.test.mjs — THE OFFICE READS A WORLD IN EITHER SHAPE (WLD-116, lane 3).
//
//   node --test test/world-law-shape.test.mjs
//
// Classes are law nodes, never marks. The same little town is filed twice (test/helpers/
// law-shape-world.mjs): classes as marks under the Keeping Works (the OLD shape), and classes
// as WORLD/law/<foundry>/**/node.md (the NEW shape). Every leg below runs the office over both
// and holds the answers equal, so the office can go live before or after postmark-world#304.

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { WORLD_CLONE } from "../src/world-store.mjs";
import { CLASS_MARKS, LAW_TREE, buildWorld } from "./helpers/law-shape-world.mjs";
import {
  LAW_NODE_KIND, RECORD_FILE_RE, SHAPE_CLASS_MARKS, SHAPE_LAW_TREE, lawShapeOf, lawShapeOfMarksDir, readWorldRecords, recordsOf,
} from "../src/world-law-shape.mjs";
import { classRosterGate, classMarkGate, declaresValue, classRosterGateValue } from "../src/world-graph-db.mjs";
import { isClassDefinition, isClassMark } from "../src/world-store.mjs";
import { carriersFrom } from "../src/world-frames.mjs";
import { deriveLaw } from "../world2/tools/law-ingest.mjs";
import { readLawPairing } from "../src/world-lints.mjs";

const OFFICE = resolve(fileURLToPath(new URL("..", import.meta.url)));
const HAVE_WORLD = existsSync(join(WORLD_CLONE, "tools", "marks-fold.mjs"));
const SLOW = { timeout: 240_000 };

const worlds = {};
const worldIn = (shape) => (worlds[shape] ??= buildWorld({ shape, worldClone: WORLD_CLONE }));

test("the shape is decided in one place, from the tree", (t) => {
  if (!HAVE_WORLD) return t.skip(`no world clone at ${WORLD_CLONE}`);
  assert.equal(lawShapeOf(worldIn(CLASS_MARKS)), SHAPE_CLASS_MARKS);
  assert.equal(lawShapeOf(worldIn(LAW_TREE)), SHAPE_LAW_TREE);
  assert.equal(lawShapeOfMarksDir(join(worldIn(LAW_TREE), "WORLD", "marks")), SHAPE_LAW_TREE);
  // a derived law-state.json alone is the new shape too (the staged artifact a viewer reads)
  const lone = mkdtempSync(join(tmpdir(), "pm-law-state-"));
  mkdirSync(join(lone, "WORLD"), { recursive: true });
  writeFileSync(join(lone, "WORLD", "law-state.json"), "{}");
  assert.equal(lawShapeOf(lone), SHAPE_LAW_TREE);
  // the file-name rule creature readers share
  assert.ok(RECORD_FILE_RE.test("x/node.md") && RECORD_FILE_RE.test("x/mark.md") && !RECORD_FILE_RE.test("x/notes.md"));
});

test("readWorldRecords: old shape keeps classes among the marks, new shape holds them as law", async (t) => {
  if (!HAVE_WORLD) return t.skip("no world clone");
  const read = async (shape) => {
    const dir = worldIn(shape);
    const { loadMarks } = await import(`file:///${join(dir, "tools", "marks-fold.mjs").replace(/\\/g, "/")}`);
    return readWorldRecords({ marksDir: join(dir, "WORLD", "marks"), toolsDir: join(dir, "tools"), loadMarks });
  };
  const old = await read(CLASS_MARKS), neu = await read(LAW_TREE);
  assert.equal(old.shape, SHAPE_CLASS_MARKS);
  assert.deepEqual(old.law, []);
  assert.ok(old.marks.some((m) => m.kind === "class" && m.class === "thing"));
  assert.equal(neu.shape, SHAPE_LAW_TREE);
  assert.ok(!neu.marks.some((m) => m.kind === "class" || m.kind === "property"), "the new shape's marks tree holds no class");
  assert.deepEqual(neu.law.filter((n) => n.kind === "class").map((n) => n.class).sort(), ["mark", "sited", "thing"]);
  assert.ok(neu.tools.isClass(neu.law.find((n) => n.class === "thing")));
  assert.equal(recordsOf(neu).length, neu.marks.length + neu.law.length);
});

test("law_projection: both shapes derive the same class, grant and property rows (keys and data shape)", SLOW, async (t) => {
  if (!HAVE_WORLD) return t.skip("no world clone");
  const a = await deriveLaw({ lawRepo: worldIn(CLASS_MARKS) });
  const b = await deriveLaw({ lawRepo: worldIn(LAW_TREE) });
  const pick = (rows) => rows.filter((r) => ["class", "grant", "property", "threshold"].includes(r.kind));
  assert.deepEqual(pick(a.rows).map((r) => `${r.kind}|${r.key}`), pick(b.rows).map((r) => `${r.kind}|${r.key}`), "the same rows, in the same order");
  // the path column is the one place the shape shows; the data differs only by what the law loader adds or cannot have
  const SHAPE_ONLY = new Set(["foundry", "_parentMarkId", "parent", "_frameId", "_origin", "ord"]);
  for (const [x, y] of pick(a.rows).map((r, i) => [r, pick(b.rows)[i]])) {
    const keep = (d) => Object.fromEntries(Object.entries(d ?? {}).filter(([k]) => !SHAPE_ONLY.has(k)));
    assert.deepEqual(keep(y.data), keep(x.data), `${x.kind} ${x.key}`);
    if (x.kind === "class" || x.kind === "grant" || x.kind === "property") {
      assert.match(x.path, /^WORLD\/marks\/.*\/mark\.md$/);
      assert.match(y.path, /^WORLD\/law\/the-keeping-works\/.*\/node\.md$/);
    }
  }
  const thing = b.rows.find((r) => r.kind === "class" && r.key === "thing");
  assert.equal(thing.data.dials.carry_cap, 10, "a class's dials are its property nodes, in the law tree as among the marks");
  assert.equal(thing.data._law, undefined, "the loader's own stamp is not row data");
  assert.equal(thing.data.foundry, "the-keeping-works");
  assert.equal(b.rows.filter((r) => r.kind === "grant").length, 2);
});

function hydrate(dir) {
  const out = join(dir, "rows.json");
  const r = spawnSync(process.execPath, [join(OFFICE, "src", "world-hydrate.mjs"), "--world", dir, "--rows-out", out, "--office", OFFICE, "--no-lints", "--no-gexf"], { encoding: "utf8" });
  if (r.status !== 0) assert.fail(`hydration exited ${r.status}\n${r.stdout}\n${r.stderr}`);
  const t = JSON.parse(readFileSync(out, "utf8"));
  return { t, nodes: t.nodes.map((n) => ({ ...n, p: JSON.parse(n.props ?? "{}") })) };
}

test("the hydrator: a class is a law node in the new shape and a mark in the old; the gates answer both", SLOW, (t) => {
  if (!HAVE_WORLD) return t.skip("no world clone");
  const old = hydrate(worldIn(CLASS_MARKS)), neu = hydrate(worldIn(LAW_TREE));
  const rosterIds = (h) => h.nodes.filter(classRosterGate).map((n) => n.id).sort();
  assert.deepEqual(rosterIds(neu), rosterIds(old), "the roster gate selects the same classes in either shape");
  assert.deepEqual(rosterIds(neu), ["the-town/mark", "the-town/sited", "the-town/thing"]);
  const thingNew = neu.nodes.find((n) => n.id === "the-town/thing"), thingOld = old.nodes.find((n) => n.id === "the-town/thing");
  assert.equal(thingNew.kind, LAW_NODE_KIND);
  assert.equal(thingNew.subkind, "class");
  assert.equal(thingOld.kind, "mark");
  assert.equal(thingNew.p.declares, true);
  assert.equal(thingNew.p.in_works, true, "stamped outright: the law path contains /the-keeping-works/ by accident, never by test");
  assert.deepEqual(thingNew.p.dials, thingOld.p.dials);
  assert.equal(classMarkGate(thingNew), true);
  assert.equal(classMarkGate(neu.nodes.find((n) => n.id === "the-town/sited")), false, "no actions, no verb");
  assert.equal(classRosterGateValue(thingNew), 1);
  assert.equal(declaresValue(thingNew), 1);
  // the property is a law node under the class, drawn as a describes edge in both shapes
  const prop = neu.nodes.find((n) => n.subkind === "property");
  assert.equal(prop.kind, LAW_NODE_KIND);
  const describes = (h) => h.t.edges.filter((e) => e.type === "describes" && e.src === "the-town/thing").map((e) => e.dst);
  assert.deepEqual(describes(neu), describes(old));
  // an instance edges to its class's declaration in both
  const inst = (h) => h.t.edges.filter((e) => e.type === "instance-of" && e.src === "rei/a-pebble").map((e) => e.dst);
  assert.deepEqual(inst(neu), ["the-town/thing"]);
  assert.deepEqual(inst(old), ["the-town/thing"]);
  // classes are not marks: the new shape's marks carry none
  assert.ok(!neu.nodes.some((n) => n.kind === "mark" && n.subkind === "class"));
});

test("the store predicates ask the law kind first and the position clause as the old shape's read", () => {
  const lawNode = { kind: LAW_NODE_KIND, by: "the-town", tier: "biome", props: { class: "x", actions: [{ action: "a" }] } };
  assert.equal(isClassDefinition(lawNode), true, "a biome-tier class is law all the same");
  assert.equal(isClassMark(lawNode), true);
  const oldMark = { kind: "mark", by: "the-town", tier: "constitution", props: { class: "x", in_works: true, actions: [{ action: "a" }] } };
  assert.equal(isClassMark(oldMark), true);
  assert.equal(isClassDefinition({ ...oldMark, props: { class: "x", in_works: false } }), false, "an instance outside the works declares nothing");
  assert.equal(isClassDefinition({ kind: "mark", by: "rei", tier: "market", props: { class: "x", in_works: true } }), false);
});

test("carriers: a class's mobility is read off the law when the fold's marks carry no class", () => {
  const marks = [
    { id: "the-town/wheelhouse", class: "vehicle", mechanic: "timetable", timetable: { vessel: "the-town/hull", stops: [] }, at: { x: 0, y: 0 }, extent: { w: 5, h: 5 } },
    { id: "the-town/hull", at: { x: 0, y: 0 }, extent: { w: 10, h: 5 } },
  ];
  const law = [{ id: "the-town/vehicle", kind: "class", class: "vehicle", mobility: "derived", by: "the-town" }];
  assert.equal(carriersFrom({ marks }).length, 0, "without the law nothing is carried (the silent break this closes)");
  assert.equal(carriersFrom({ marks, law }).length, 1);
});

test("L0's citation check reads the invariants in the law tree (node.md, the lint dial a property node)", (t) => {
  const root = mkdtempSync(join(tmpdir(), "pm-inv-"));
  const law = { L9: { slug: "the-x", id: "the-town/the-x", text: "Claim." } };
  const dir = join(root, "WORLD", "law", "the-keeping-works", "postmark-invariant", "the-x");
  mkdirSync(join(dir, "the-x-lint"), { recursive: true });
  writeFileSync(join(dir, "node.md"), "---\nkind: class\nby: the-town\n---\n\nClaim.\n");
  writeFileSync(join(dir, "the-x-lint", "node.md"), "---\nkind: property\nname: lint\ndefault: L9\n---\n\nThe lint.\n");
  const r = readLawPairing(root, law);
  assert.equal(r.status, "read");
  assert.deepEqual(r.drift, []);
  writeFileSync(join(dir, "the-x-lint", "node.md"), "---\nkind: property\nname: lint\ndefault: L1\n---\n\nThe lint.\n");
  assert.equal(readLawPairing(root, law).drift[0].why, "dial mismatch");
});
