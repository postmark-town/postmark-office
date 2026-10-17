// o1-prod-paths.test.mjs — the roads production reads LOGOS v2's class tree by (lane O1; review-606 B1).
//
// In production the class layer comes from law_projection, which law-ingest
// derives from the world checkout, and its fallback is the world graph
// snapshot, which the hydrator derives. So the property tree is driven here
// through BOTH real derivations, from one fixture world written as files (the
// world's own parser reads them), in W1's own shape:
//
//   postmark-node  makers: false
//   └ mark └ sited  makers: true
//            ├ thing  holder (sovereign, false) → capacity (sovereign, 30) → min 1, max 120; holder → open (sovereign, true)
//            │ ├ candy             a class node named by its SLUG (no `class:`)
//            │ └ halloween-candy-bag  holder (constitution, true) → capacity 200 → max 200
//            └ parcel  makers: false
//   resident  holder (constitution, true) → capacity (constitution, 24)
//   say       the OLD dials: frontmatter      sound  the NEW property node
//
// and three marks: a thing in each form, and a new-form candy.

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { WORLD_CLONE } from "../src/world-store.mjs";

const OFFICE = resolve(fileURLToPath(new URL("..", import.meta.url)));
const HAVE_WORLD = existsSync(join(WORLD_CLONE, "tools", "marks-fold.mjs"));
const gitq = (dir, args) => execFileSync("git", ["-C", dir, ...args], {
  encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" },
});

const K = "let-there-be-light/the-town-centre/the-keeping-works";
const PN = `${K}/postmark-node`, MARK = `${PN}/mark`, SITED = `${MARK}/sited`, THING = `${SITED}/thing`;
const town = (front) => `by: the-town\ntier: constitution\ndate: 2026-10-17\n${front}`;
const cls = (name, ext, extra = "") => town(`kind: class\n${name ? `class: ${name}\n` : ""}${ext ? `extends: ${ext}\n` : ""}version: 1${extra ? `\n${extra}` : ""}`);
const prop = (name, dflt, tier) => `kind: property\nby: the-town\ntier: ${tier}\ndate: 2026-10-17\nname: ${name}\ndefault: ${dflt}`;

function buildWorld() {
  const dir = mkdtempSync(join(tmpdir(), "pm-o1-paths-"));
  cpSync(join(WORLD_CLONE, "tools"), join(dir, "tools"), { recursive: true });
  const mark = (rel, front, body = "x") => { mkdirSync(join(dir, "WORLD", "marks", rel), { recursive: true }); writeFileSync(join(dir, "WORLD", "marks", rel, "mark.md"), `---\n${front}\n---\n\n${body}\n`); };
  mark("let-there-be-light", "kind: sited\nby: the-town\ntier: constitution\ndate: 2026-07-22\nat: { x: 0, y: 0 }\nextent: { w: 320000, h: 320000 }\ncoords: relative", "Let there be light.");
  mark("let-there-be-light/the-town-centre", "kind: sited\nby: the-town\ntier: constitution\ndate: 2026-07-23\nat: { x: 0, y: 0 }\nextent: { w: 4000, h: 4000 }", "The town centre.");
  mark(K, "kind: sited\nby: the-town\ntier: constitution\ndate: 2026-08-01\nat: { x: 0, y: 0 }\nextent: { w: 800, h: 800 }", "The Keeping Works.");
  gitq(dir, ["init", "-q", "."]); gitq(dir, ["add", "-A"]); gitq(dir, ["commit", "-qm", "root"]);

  mark(PN, cls("postmark-node", null), "The root.");
  mark(`${PN}/postmark-node-makers`, prop("makers", "false", "constitution"));
  mark(MARK, cls("mark", "postmark-node"), "A mark.");
  mark(SITED, cls("sited", "mark"), "Sited.");
  mark(`${SITED}/sited-makers`, prop("makers", "true", "constitution"));
  mark(THING, cls("thing", "sited"), "A thing.");
  mark(`${THING}/thing-holder`, prop("holder", "false", "sovereign"));
  mark(`${THING}/thing-holder/thing-capacity`, prop("capacity", "30", "sovereign"));
  mark(`${THING}/thing-holder/thing-capacity/thing-capacity-min`, prop("min", "1", "constitution"));
  mark(`${THING}/thing-holder/thing-capacity/thing-capacity-max`, prop("max", "120", "constitution"));
  mark(`${THING}/thing-holder/thing-open`, prop("open", "true", "sovereign"));
  mark(`${THING}/candy`, cls(null, "thing"), "Candy, a class node named by its slug.");
  mark(`${THING}/halloween-candy-bag`, cls("halloween-candy-bag", "thing"), "The Candy Bag.");
  mark(`${THING}/halloween-candy-bag/bag-holder`, prop("holder", "true", "constitution"));
  mark(`${THING}/halloween-candy-bag/bag-holder/bag-capacity`, prop("capacity", "200", "sovereign"));
  mark(`${THING}/halloween-candy-bag/bag-holder/bag-capacity/bag-capacity-max`, prop("max", "200", "constitution"));
  mark(`${SITED}/parcel`, cls("parcel", "sited"), "A parcel.");
  mark(`${SITED}/parcel/parcel-makers`, prop("makers", "false", "constitution"));
  mark(`${PN}/resident`, cls("resident", "postmark-node"), "A resident.");
  mark(`${PN}/resident/resident-holder`, prop("holder", "true", "constitution"));
  mark(`${PN}/resident/resident-holder/resident-capacity`, prop("capacity", "24", "constitution"));
  mark(`${PN}/say`, cls("say", "postmark-node", "dials: { presence_min: 15 }"), "Say, its dial in the OLD form.");
  mark(`${PN}/sound`, cls("sound", "postmark-node"), "Sound, its dial in the NEW form.");
  mark(`${PN}/sound/sound-radius-m`, prop("radius_m", "60", "constitution"));

  mark("wright/old-form-thing", "kind: sited\nby: wright\ndate: 2026-10-17\nat: { x: 1000, y: 1000 }\nextent: { w: 1, h: 1 }\nclass: thing", "Old form.");
  mark("wright/new-form-thing", "kind: thing\nby: wright\ndate: 2026-10-17\nat: { x: 1010, y: 1010 }\nextent: { w: 1, h: 1 }", "New form.");
  mark("wright/new-form-candy", "kind: candy\nby: wright\ndate: 2026-10-17\nat: { x: 1020, y: 1020 }\nextent: { w: 1, h: 1 }", "New form, a class named by its slug.");
  gitq(dir, ["add", "-A"]); gitq(dir, ["commit", "-qm", "W1's tree and both forms"]);
  return dir;
}

let WORLD = null;
const world = () => (WORLD ??= buildWorld());
test.after(() => { if (WORLD) rmSync(WORLD, { recursive: true, force: true }); });

function hydrateRows() {
  const out = join(world(), "rows.json");
  if (!existsSync(out)) {
    const r = spawnSync(process.execPath, [join(OFFICE, "src", "world-hydrate.mjs"), "--world", world(), "--no-db", "--rows-out", out, "--office", OFFICE, "--no-lints", "--no-gexf"], { encoding: "utf8" });
    if (r.status !== 0) assert.fail(`hydration exited ${r.status}\n${r.stdout}\n${r.stderr}`);
  }
  const t = JSON.parse(readFileSync(out, "utf8"));
  return t.tables ?? t;
}
const propsOf = (n) => (typeof n?.props === "string" ? JSON.parse(n.props) : n?.props ?? null);

test("LAW-INGEST (prod's class layer): the property tree projects nested, and makers, holding and dials read right off it", { timeout: 180_000 }, async (t) => {
  if (!HAVE_WORLD) return t.skip(`no world clone at ${WORLD_CLONE}`);
  const { deriveLaw } = await import("../world2/tools/law-ingest.mjs");
  const { lawSnapshotFromRows, snapProperty, dialsOf } = await import("../src/law-classes.mjs");
  const { makersOf, holdingOf } = await import("../src/holding-law.mjs");
  const derived = await deriveLaw({ lawRepo: world() });
  const rows = Array.isArray(derived) ? derived : derived.rows;
  const keys = rows.filter((r) => r.kind === "property").map((r) => r.key).sort();
  for (const k of ["thing/holder", "thing/holder/capacity", "thing/holder/capacity/max", "thing/holder/capacity/min", "thing/holder/open",
    "halloween-candy-bag/holder/capacity/max", "postmark-node/makers", "sited/makers", "parcel/makers", "resident/holder/capacity", "sound/radius_m"])
    assert.ok(keys.includes(k), `law-ingest projects ${k} (got ${keys.join(", ")})`);
  assert.ok(rows.some((r) => r.kind === "class" && r.key === "candy"), "a class node named by its slug is declared under its slug");
  const snap = lawSnapshotFromRows(rows.map((r) => ({ number: 1, tag_sha: "fixture", newest: 1, ...r })));
  const cp = (n, p) => snapProperty(snap, n, p);
  for (const [c, want, from] of [["thing", true, "sited"], ["candy", true, "sited"], ["halloween-candy-bag", true, "sited"], ["sited", true, "sited"],
    ["parcel", false, "parcel"], ["resident", false, "postmark-node"], ["mark", false, "postmark-node"], ["no-such-class", false, null]]) {
    const m = makersOf(c, cp);
    assert.equal(m.may, want, `makers of ${c}`);
    assert.equal(m.from, from, `makers of ${c} is set on ${from}`);
  }
  assert.deepEqual(((h) => [h.holder, h.capacity, h.min, h.max, h.open])(holdingOf({ className: "thing", mark: { holder: true }, classProperty: cp })), [true, 30, 1, 120, true]);
  assert.deepEqual(((h) => [h.holder, h.capacity, h.min, h.max])(holdingOf({ className: "halloween-candy-bag", classProperty: cp })), [true, 200, 1, 200]);
  assert.equal(holdingOf({ className: "resident", mark: { capacity: 99 }, classProperty: cp }).capacity, 24, "constitution: the resident's own field never moves it");
  assert.deepEqual(dialsOf(snap, "say"), { presence_min: 15 }, "an old dial projects as it did");
  assert.equal(Number(dialsOf(snap, "sound").radius_m), 60, "a new dial reads off its property node");
});

test("THE HYDRATOR (the store's fallback): both forms project one class, one instance-of edge, and the declarations' dials", { timeout: 180_000 }, (t) => {
  if (!HAVE_WORLD) return t.skip(`no world clone at ${WORLD_CLONE}`);
  const tables = hydrateRows();
  const node = (id) => tables.nodes.find((n) => n.id === id);
  const io = (id) => tables.edges.filter((e) => e.src === id && e.type === "instance-of").map((e) => e.dst);
  for (const id of ["wright/old-form-thing", "wright/new-form-thing"]) {
    const n = node(id);
    assert.ok(n, `${id} hydrated`);
    assert.equal(propsOf(n).class, "thing", `${id}: the store's class prop is thing in either form`);
    assert.ok(n.at_x != null, `${id} is placed: sited by the lineage in the new form`);
    assert.deepEqual(io(id), ["the-town/thing"], `${id} is an instance of the thing declaration`);
  }
  assert.equal(node("wright/old-form-thing").subkind, "sited");
  assert.equal(node("wright/new-form-thing").subkind, "thing", "the file's own kind stays in subkind");
  const candy = node("the-town/candy");
  assert.equal(propsOf(candy).class, "candy", "a class node named by its slug stores its class");
  assert.equal(propsOf(candy).declares, true);
  assert.deepEqual(io("wright/new-form-candy"), ["the-town/candy"]);
  assert.deepEqual(propsOf(node("the-town/say")).dials, { presence_min: 15 }, "an old dial projects as it did");
  assert.equal(Number(propsOf(node("the-town/sound")).dials?.radius_m), 60, "a new dial projects off its property node");
  const problems = tables.nodes.flatMap((n) => propsOf(n)?.frontmatter_problems ?? []).join(" ");
  assert.doesNotMatch(problems, /unknown kind: (thing|candy|property)/, "a new-form kind naming a declared class is no unknown kind");
});

test("THE STORE PATH (no law snapshot): classProperty, makers, holding and dials read the graph's property nodes", { timeout: 180_000 }, async (t) => {
  if (!HAVE_WORLD) return t.skip(`no world clone at ${WORLD_CLONE}`);
  const tables = hydrateRows();
  const { publishWorldGraphForTest } = await import("../src/world-graph-snapshot.mjs");
  const { resetLawSnapshot } = await import("../src/law-snapshot.mjs");
  const { classProperty, classOwnProperties, classDials, dialNumber, resetClassRosterCache } = await import("../src/world-classes.mjs");
  const { makersOf, holdingOf } = await import("../src/holding-law.mjs");
  resetLawSnapshot();
  publishWorldGraphForTest(tables, { label: "o1-prod-paths" });
  resetClassRosterCache();
  assert.deepEqual(Object.keys(classOwnProperties("thing")).sort(), ["capacity", "holder", "max", "min", "open"], "the store walks the nesting");
  assert.equal(classProperty("candy", "makers")?.from, "sited");
  assert.equal(makersOf("candy", classProperty).may, true);
  assert.equal(makersOf("parcel", classProperty).may, false);
  assert.equal(makersOf("resident", classProperty).may, false);
  assert.deepEqual(((h) => [h.holder, h.capacity, h.min, h.max, h.open])(holdingOf({ className: "thing", mark: { holder: true, capacity: 50 }, classProperty })), [true, 50, 1, 120, true]);
  assert.equal(holdingOf({ className: "halloween-candy-bag", classProperty }).max, 200);
  assert.equal(holdingOf({ className: "resident", classProperty }).capacity, 24);
  assert.equal(Number(classDials("sound").radius_m), 60);
  assert.deepEqual(dialNumber("say", "presence_min", 99), { value: 15, read: true, source: "record" });
});

test("THE CIVIC PREDICATES (world-classes § civicQuarter): a plaque's predicate children read in both forms (`predicated` and `predicate`)", async () => {
  const { publishWorldGraphForTest } = await import("../src/world-graph-snapshot.mjs");
  const { civicQuarter } = await import("../src/world-classes.mjs");
  const n = (id, subkind, props) => ({ id, kind: "mark", subkind, tier: "constitution", by: "the-town", at_x: null, at_y: null, extent_w: null, extent_h: null, props: JSON.stringify(props) });
  const tables = {
    meta: [{ key: "hydration_status", value: "OK" }],
    nodes: [n("the-town/the-think-tank", "sited", { body: "The Think Tank." }),
      n("the-town/think-tank-old", "predicated", { slot: "lane", value: "ideas" }),
      n("the-town/think-tank-new", "predicate", { slot: "stage", value: "one" })],
    edges: [{ seq: 1, src: "the-town/the-think-tank", dst: "the-town/think-tank-old", type: "describes", props: "{}" },
      { seq: 2, src: "the-town/the-think-tank", dst: "the-town/think-tank-new", type: "describes", props: "{}" }],
    events: [], geometryVersions: [], lintFindings: [],
  };
  publishWorldGraphForTest(tables, { label: "o1-civic" });
  const tank = civicQuarter().quarter.find((l) => l.place === "the-town/the-think-tank");
  assert.deepEqual(tank.predicates, { lane: "ideas", stage: "one" }, "the old form's `predicated` and the new form's `predicate` both read");
});
