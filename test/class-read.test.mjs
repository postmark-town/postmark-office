// class-read.test.mjs — explain climbs the class (POS-659).
//
// One crafted class layer, written in each form the law allows, and the reader
// held to the brief:
//
//   C1  the climb on a deep chain: candy → consumable → thing → mark →
//       postmark-node, every step answered in the same shape, and the pointer
//       names the class and the two above it, never the root
//   C2  a makers-false class (parcel): false on parcel itself, true inherited
//       by candy from thing, the root's false never reaching past a true; and
//       the same answers whether makers is an inline dial or a property node
//   C3  the property rung and the label rung read the same way: one class
//       written three ways (inline dials, today's `kind: predicated` children,
//       part 2's `kind: property` nodes) answers the same name, tier and
//       default; a property's own children ride beneath it; a sovereign one is
//       open to the maker; a subclass standing under its class is no property
//   C4  afforded actions: who, where, the effect quoted from the residue class,
//       and the residue's `requires` as the condition, read by the grant reader
//       so explain's actions are the act cards' for the same class
//   C5  the world door: explain: "<class>" by slug and by full id, a read path
//       still answering first, an unknown name bounced with the nearest classes
//   C6  the pointer on a mark read (markPointer): class field, then kind, then
//       mark; a class node points at itself
//   C6b a failing statement throws to the door (an empty answer would read as
//       "no such class"); putting a catch back in `ask` reds it
//   C7  every statement this module registers is its SQL, row for row, over the
//       fixture (the census in world-graph-db.test.mjs holds them over the
//       blessed world too)
//
// The pointer on investigate itself (a resident through the world door) rides
// test/world-read-shape.test.mjs § PR-4, which has the hydrated rig.
//
// Run: node --test test/class-read.test.mjs

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

process.env.WORLD_APEX = "1";
const { withNoWorld, withWorld, writeFixtureDb } = await import("./helpers/world-rows.mjs");
const { graphDb, twinnedStatements } = await import("../src/world-graph-db.mjs");
const cr = await import("../src/class-read.mjs");
const { worldApex, gatherActions } = await import("../src/world-apex.mjs");

const WORKS = "WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-node";
let seq = 0;
const node = (id, props, { subkind = "class", tier = "constitution", by = "the-town" } = {}) => ({
  id, kind: "mark", subkind, tier, by, at_x: null, at_y: null, extent_w: null, extent_h: null,
  props: JSON.stringify(props),
});
const klass = (name, { extends: up = null, dials = {}, body = `the ${name} class`, actions = null, requires = null } = {}) =>
  node(`the-town/${name}`, { class: name, extends: up, dials, body, in_works: true, path: `${WORKS}/${name}`,
    ...(actions ? { actions } : {}), ...(requires ? { requires } : {}) });
const describes = (src, dst) => ({ seq: ++seq, src, dst, type: "describes", props: null, born_at: null });
const predicated = (id, slot, value, body, tier = "constitution") => node(id, { slot, value, body, path: `${WORKS}/${id}` }, { subkind: "predicated", tier });
const property = (id, name, dflt, body, tier = "constitution") => node(id, { name, default: dflt, body, path: `${WORKS}/${id}` }, { subkind: "property", tier });

/**
 * The class layer. `form` picks how makers and thing's three properties are
 * written: "label" (inline dials), "predicated" (today's children) or
 * "property" (part 2's nodes).
 */
function layer(form) {
  seq = 0;
  const dialsFor = (pairs) => (form === "label" ? pairs : {});
  const nodes = [
    klass("postmark-node", { dials: dialsFor({ makers: false }), body: "Every node is a postmark-node." }),
    klass("mark", { extends: "postmark-node", body: "A mark is a signed claim on the world." }),
    klass("thing", { extends: "mark", body: "A thing is made, held or set down.",
      dials: dialsFor({ makers: true, carry_cap: 24, take_requires_welcome: false }) }),
    klass("consumable", { extends: "thing", body: "A consumable is used up when consumed." }),
    klass("candy", { extends: "consumable", body: "Candy is a consumable sweet." }),
    klass("parcel", { extends: "mark", dials: dialsFor({ makers: false, extent_m: 25 }), body: "A parcel is sovereign ground." }),
    klass("entity", { extends: "postmark-node", body: "An entity acts." }),
    // the article goes by the sound: a unit, an hour
    klass("unit", { extends: "mark" }), klass("widget", { extends: "unit" }),
    // a town constitution class standing OUTSIDE the Keeping Works is an instance's spelling, not a class
    node("the-town/stray-class", { class: "stray", body: "not in the works", in_works: false, path: "WORLD/marks/elsewhere/stray" }),
    klass("resident", { extends: "entity", body: "A household's living voice.",
      actions: [{ action: "say", residue: "the-town/say" }, { action: "strike", residue: "the-town/strike" },
        { action: "walk", for: "human", scope: "own-ground", residue: "the-town/depart" }, { action: "wave", residue: "the-town/no-such-residue" }] }),
    klass("say", { body: "Say is the speaking verb." }),
    klass("depart", { body: "A departure is one line written when you set out." }),
    klass("strike", { body: "A strike is a blow in an encounter.", requires: { within_class: "portal-ground", phase: "spent" } }),
    // an instance of candy, a sited plain mark and a parcel instance (kind names the class)
    node("kai/a-gloamcap", { class: "candy", body: "a candy" }, { subkind: "sited", tier: "resident", by: "kai" }),
    node("kai/a-plain-mark", { body: "here" }, { subkind: "sited", tier: "resident", by: "kai" }),
    node("kai/the-parcel", { body: "kai's ground" }, { subkind: "parcel", tier: "resident", by: "kai" }),
  ];
  const edges = [
    // the directory nests a subclass under its class by describes too: never a property
    describes("the-town/thing", "the-town/consumable"),
  ];
  const child = (cls, n) => { nodes.push(n); edges.push(describes(cls, n.id)); };
  if (form === "predicated") {
    child("the-town/postmark-node", predicated("the-town/makers-root", "makers", "false", "Nothing is anyone's to make unless a class says so."));
    child("the-town/thing", predicated("the-town/makers-thing", "makers", "true", "A resident may make a thing."));
    child("the-town/thing", predicated("the-town/carry-cap", "carry_cap", 24, "A resident carries at most 24."));
    child("the-town/thing", predicated("the-town/take-welcome", "take_requires_welcome", "false", "A take needs no welcome."));
    child("the-town/parcel", predicated("the-town/makers-parcel", "makers", "false", "Nothing you control mints."));
  }
  if (form === "property") {
    child("the-town/postmark-node", property("the-town/makers-root", "makers", false, "Nothing is anyone's to make unless a class says so."));
    child("the-town/thing", property("the-town/makers-thing", "makers", true, "A resident may make a thing."));
    child("the-town/thing", property("the-town/carry-cap", "carry_cap", 24, "A resident carries at most 24."));
    child("the-town/thing", property("the-town/take-welcome", "take_requires_welcome", false, "A take needs no welcome."));
    child("the-town/parcel", property("the-town/makers-parcel", "makers", "false", "Nothing you control mints."));
    // a sovereign property with constitution children of its own (classes.md § `holder`)
    child("the-town/thing", property("the-town/capacity", "capacity", 30, "How many it can hold.", "sovereign"));
    child("the-town/capacity", property("the-town/capacity-min", "min", 1, "At least one."));
    child("the-town/capacity", property("the-town/capacity-max", "max", 120, "At most 120."));
  }
  if (form === "label") nodes.push(klass("extent-free", { extends: "mark" })); // a class with nothing to say of its own
  return { meta: [], nodes, edges, events: [], geometryVersions: [], lintFindings: [] };
}

const FORMS = ["label", "predicated", "property"];
const dbOf = (form) => graphDb(layer(form));

test("C1: the climb on a deep chain: each step up is the same move, and the pointer stops above the root", () => {
  const db = dbOf("label");
  const candy = cr.explainClass(db, "candy");
  assert.equal(candy.class, "the-town/candy");
  assert.equal(candy.what, "Candy is a consumable sweet.");
  assert.deepEqual(candy.extends.map((c) => c.class), ["consumable", "thing", "mark", "postmark-node"]);
  assert.deepEqual(candy.extends.map((c) => c.explain), ['explain: "consumable"', 'explain: "thing"', 'explain: "mark"', 'explain: "postmark-node"']);
  assert.match(candy.deeper, /^explain: "consumable"/);
  // every rung answers in the one shape, and each rung's own extends is the rest of the chain
  const keys = Object.keys(candy);
  for (const [i, step] of candy.extends.entries()) {
    const up = cr.explainClass(db, step.class);
    assert.deepEqual(Object.keys(up), keys, `${step.class} answers in candy's shape`);
    assert.deepEqual(up.extends.map((c) => c.class), candy.extends.slice(i + 1).map((c) => c.class), `${step.class} climbs the rest`);
  }
  assert.match(cr.explainClass(db, "postmark-node").deeper, /root/);
  assert.equal(cr.classPointer(db, "candy"), 'kind: candy · a consumable · a thing — explain: "candy"', "the law's own example");
  assert.equal(cr.classPointer(db, "thing"), 'kind: thing · a mark — explain: "thing"');
  assert.equal(cr.classPointer(db, "resident"), 'kind: resident · an entity — explain: "resident"');
  assert.equal(cr.classPointer(db, "no-such-class"), null);
});

test("C1c: a class lists its kinds, the classes under it by name (POS-692: candy's kinds are found here)", () => {
  for (const form of FORMS) {
    const db = dbOf(form);
    assert.deepEqual(cr.explainClass(db, "consumable").kinds, ["candy"], `${form}: candy is a kind of consumable`);
    assert.deepEqual(cr.explainClass(db, "unit").kinds, ["widget"]);
    assert.deepEqual(cr.explainClass(db, "candy").kinds, [], "a class with nothing under it lists none, and still answers the key");
    assert.ok(cr.explainClass(db, "mark").kinds.includes("thing") && !cr.explainClass(db, "mark").kinds.includes("consumable"), "only the classes directly under it");
  }
});

test("C1b: a chain that loops or names an unknown class stops there, and says no more than the record", () => {
  const t = layer("label");
  t.nodes.push(klass("loop-a", { extends: "loop-b" }), klass("loop-b", { extends: "loop-a" }), klass("orphan", { extends: "nothing-declares-me" }));
  const db = graphDb(t);
  assert.deepEqual(cr.explainClass(db, "loop-a").extends.map((c) => c.class), ["loop-b"]);
  assert.deepEqual(cr.explainClass(db, "orphan").extends, []);
});

test("C2: makers: parcel is false, candy inherits thing's true, and both forms answer the same", () => {
  for (const form of FORMS) {
    const db = dbOf(form);
    assert.deepEqual(cr.explainClass(db, "parcel").makers, { value: false, from: "the-town/parcel" }, `${form}: parcel declares its own false`);
    assert.deepEqual(cr.explainClass(db, "candy").makers, { value: true, from: "the-town/thing", inherited: true }, `${form}: candy inherits thing's true`);
    assert.deepEqual(cr.explainClass(db, "mark").makers, { value: false, from: "the-town/postmark-node", inherited: true }, `${form}: mark inherits the root's false`);
    assert.deepEqual(cr.explainClass(db, "resident").makers, { value: false, from: "the-town/postmark-node", inherited: true }, `${form}: a resident is the town's alone`);
  }
});

test("C2b: a chain that declares no makers says so, and never answers from code", () => {
  const t = layer("label");
  for (const n of t.nodes) { const p = JSON.parse(n.props); if (p.dials) delete p.dials.makers; n.props = JSON.stringify(p); }
  const m = cr.explainClass(graphDb(t), "parcel").makers;
  assert.equal(m.value, null);
  assert.equal(m.from, null);
  assert.match(m.note, /^not declared on this chain yet/, "the settled words (POS-659 gap 3)");
});

test("C3: the property rung and the label rung read the same way", () => {
  const strip = (ps) => ps.filter((p) => p.name !== "capacity").map(({ name, tier, default: d }) => ({ name, tier, default: String(d) }))
    .sort((a, b) => (a.name < b.name ? -1 : 1));
  const thing = Object.fromEntries(FORMS.map((f) => [f, cr.explainClass(dbOf(f), "thing")]));
  assert.deepEqual(strip(thing.label.properties), [
    { name: "carry_cap", tier: "constitution", default: "24" },
    { name: "makers", tier: "constitution", default: "true" },
    { name: "take_requires_welcome", tier: "constitution", default: "false" },
  ]);
  assert.deepEqual(strip(thing.predicated.properties), strip(thing.label.properties), "today's predicated children read as the dials do");
  assert.deepEqual(strip(thing.property.properties), strip(thing.label.properties), "part 2's property nodes read as the dials do");
  assert.ok(thing.label.properties.every((p) => p.form === "label"));
  assert.ok(thing.property.properties.every((p) => p.form === "property"));
  assert.ok(thing.property.properties.find((p) => p.name === "carry_cap").body.length > 0, "the property rung carries its body");
  // a property's own children, and the slot it leaves to the maker
  const cap = thing.property.properties.find((p) => p.name === "capacity");
  assert.deepEqual({ tier: cap.tier, default: cap.default }, { tier: "sovereign", default: 30 });
  assert.deepEqual(cap.children.map((c) => [c.name, c.tier, c.default]), [["min", "constitution", 1], ["max", "constitution", 120]]);
  assert.deepEqual(thing.property.open, ["capacity"]);
  assert.deepEqual(thing.label.open, []);
  // the subclass standing under thing by describes is no property of it
  for (const f of FORMS) assert.ok(!thing[f].properties.some((p) => p.id === "the-town/consumable"), `${f}: consumable is a subclass, not a property`);
});

test("C3b: where one name stands in both forms, the property rung wins", () => {
  const t = layer("property");
  const thing = t.nodes.find((n) => n.id === "the-town/thing");
  thing.props = JSON.stringify({ ...JSON.parse(thing.props), dials: { carry_cap: 99, extra_dial: 3 } });
  const ps = cr.explainClass(graphDb(t), "thing").properties;
  assert.deepEqual(ps.filter((p) => p.name === "carry_cap").map((p) => [p.default, p.form]), [[24, "property"]]);
  assert.deepEqual(ps.filter((p) => p.name === "extra_dial").map((p) => [p.default, p.form]), [[3, "label"]]);
});

test("C4: afforded actions: who, where, the effect quoted from the residue, and its conditions", () => {
  const acts = cr.explainClass(dbOf("label"), "resident").actions;
  assert.deepEqual(acts.map((a) => a.action), ["say", "strike", "walk", "wave"]);
  const [say, strike, walk, wave] = acts;
  assert.deepEqual(say, { action: "say", who: "resident", where: "unscoped", effect: "Say is the speaking verb.", effect_from: "the-town/say", conditions: null });
  assert.equal(strike.conditions, "within a portal-ground, while it is spent");
  assert.deepEqual(strike.requires, { within_class: "portal-ground", phase: "spent" });
  assert.deepEqual([walk.who, walk.where], ["human", "own-ground"]);
  assert.deepEqual([wave.effect, wave.residue_unresolved], ["", "the-town/no-such-residue"], "a residue nothing declares is said, never papered over");
  assert.deepEqual(cr.explainClass(dbOf("label"), "candy").actions, [], "a class declaring none answers none");
});

test("C4b: explain's actions are the act cards' for the same class: the same verbs, the same quote, the same residue", () => {
  for (const form of FORMS) {
    const db = dbOf(form);
    const cards = gatherActions(db, { spineIds: ["the-town/resident"] }).entries.filter((e) => e.from === "the-town/resident");
    const explained = cr.explainClass(db, "resident").actions;
    assert.ok(cards.length >= 4, `${form}: the act cards read the class (${cards.length})`);
    assert.deepEqual(explained.map((a) => [a.action, a.effect, a.effect_from ?? null, a.residue_unresolved ?? null]),
      cards.map((c) => [c.action, c.blurb, c.blurb_from ?? null, c.residue_unresolved ?? null]), `${form}: one class, one reading`);
  }
});

test("C5: the world door: explain: a class by slug and by full id; a read path answers first; an unknown name bounces with the nearest", async () => {
  await withWorld(layer("label"), async () => {
    const candy = await worldApex({ explain: "candy" }, null, {});
    assert.equal(candy.class, "the-town/candy");
    assert.deepEqual(await worldApex({ explain: "the-town/candy" }, null, {}), candy, "the full id means the class");
    assert.equal((await worldApex({ explain: "who" }, null, {})).explains, "who", "a read path answers first");
    const typo = await worldApex({ explain: "cand" }, null, {});
    assert.equal(typo.code, 422);
    assert.match(typo.defect, /no class is either/);
    assert.deepEqual(typo.nearest_classes, ["candy"]);
    assert.ok(typo.explainable.includes("who"), "the grammar's list still rides");
    assert.match(typo.hint, /class_pointer/);
    assert.ok(!("nearest_classes" in await worldApex({ explain: "zzzzzzzzzz" }, null, {})), "no near name, no list");
    assert.equal((await worldApex({ explain: "candy", do: "say" }, null, {})).code, 422, "one call does one thing");
    assert.equal((await worldApex({ explain: "kai/a-gloamcap" }, null, {})).code, 422, "an instance is not a class: investigate it");
  });
});

test("C5b: a class answers by its id exactly when it answers by its name, and an article goes by the sound", () => {
  const db = dbOf("label");
  assert.equal(cr.explainClass(db, "stray"), null, "outside the Works, not a class by name");
  assert.equal(cr.explainClass(db, "the-town/stray-class"), null, "nor by its id");
  assert.equal(cr.explainClass(db, "the-town/thing").class, "the-town/thing");
  assert.equal(cr.classPointer(db, "widget"), 'kind: widget · a unit · a mark — explain: "widget"');
});

test("C5c: with no world store loaded, a class explain is an outage (503), and a path still answers", async () => {
  await withNoWorld(async () => {
    const out = await worldApex({ explain: "candy" }, null, {});
    assert.equal(out.code, 503, JSON.stringify(out).slice(0, 200));
    assert.match(out.defect, /class layer cannot be read/);
    assert.equal((await worldApex({ explain: "who" }, null, {})).explains, "who");
  });
});

test("C6: the pointer on a mark read: its class, else its kind, else mark; a class node points at itself", async () => {
  await withWorld(layer("label"), async () => {
    assert.equal(cr.markPointer("kai/a-gloamcap"), 'kind: candy · a consumable · a thing — explain: "candy"');
    assert.equal(cr.markPointer("kai/the-parcel"), 'kind: parcel · a mark — explain: "parcel"', "kind names the class");
    assert.equal(cr.markPointer("kai/a-plain-mark"), 'kind: mark — explain: "mark"', "a standing no class carries yet falls to mark");
    assert.equal(cr.markPointer("the-town/thing"), 'kind: class — explain: "thing"');
    assert.equal(cr.markPointer("nobody/never-was"), null);
    assert.equal(cr.namedPointer("resident"), 'kind: resident · an entity — explain: "resident"');
    assert.deepEqual(cr.withPointer({ id: "x" }, "p"), { id: "x", class_pointer: "p" });
    assert.deepEqual(cr.withPointer({ error: "bounce" }, "p"), { error: "bounce" }, "a bounce carries no pointer");
    assert.deepEqual(cr.withPointer({ id: "x" }, null), { id: "x" });
  });
});

test("C6b: a statement that fails throws to the door, never answering as if no class were there (review-602)", () => {
  const broken = { prepare() { throw new Error("the store would not answer"); } };
  assert.throws(() => cr.explainClass(broken, "candy"), /the store would not answer/, "explain: the throw reaches the caller");
  assert.throws(() => cr.classPointer(broken, "candy"), /the store would not answer/, "the pointer: the same");
  assert.throws(() => cr.nearestClasses(broken, "cand"), /the store would not answer/, "the nearest names: the same");
});

const dir = mkdtempSync(join(tmpdir(), "class-read-"));
after(() => rmSync(dir, { recursive: true, force: true }));

test("C7: every statement class-read registers is its SQL, row for row, over each form", () => {
  const mine = cr.CLASS_READ_STATEMENTS;
  const census = new Set(twinnedStatements());
  for (const sql of mine) assert.ok(census.has(sql.replace(/\s+/g, " ").trim()), `a twin is registered for ${sql.slice(0, 60)}`);
  const plain = (rows) => JSON.stringify(rows.map((r) => ({ ...r })));
  for (const form of FORMS) {
    const tables = layer(form);
    const file = join(dir, `${form}.db`);
    writeFixtureDb(tables, file);
    const sqlite = new DatabaseSync(file, { readOnly: true });
    const store = graphDb(tables);
    try {
      const ids = [...tables.nodes.map((n) => n.id), "no/such-node"];
      const names = ["candy", "thing", "parcel", "no-such-class"];
      for (const sql of mine) {
        const marks = (sql.match(/\?/g) ?? []).length;
        const argSets = marks === 0 ? [[]] : /'\$\.(class|extends)'\) = \?/.test(sql) ? names.map((n) => [n]) : ids.map((id) => [id]);
        for (const args of argSets)
          assert.equal(plain(store.prepare(sql).all(...args)), plain(sqlite.prepare(sql).all(...args)), `${form}: ${sql.slice(0, 70)} ${JSON.stringify(args)}`);
      }
    } finally { sqlite.close(); }
  }
});

test("POS-672 W3: a creature's afforded actions are explained on its class, and never granted at a standpoint", () => {
  const shape = layer("label");
  shape.nodes.push(
    klass("creature", { extends: "entity", body: "A creature comes out of the Mists.",
      actions: [{ action: "watch", who: "anyone", from: "sight", effect: "you watch it; its reaction is your reply", residue: "the-town/creature" }] }),
    klass("bat", { extends: "creature", body: "A bat of the Mists.",
      actions: [{ action: "whisper", who: "anyone", from: "ring", effect: "you whisper to it; its reaction is your reply", residue: "the-town/bat" }] }));
  const db = graphDb(shape);
  // explain climbs the class: the bat's own action, and the creature's above it
  assert.deepEqual(cr.explainClass(db, "bat").actions.map((a) => a.action), ["whisper"]);
  assert.deepEqual(cr.explainClass(db, "creature").actions.map((a) => a.action), ["watch"]);
  // read as declared, with the exact call an agent makes (the words `can` teaches)
  assert.deepEqual(cr.explainClass(db, "bat").actions[0], { action: "whisper", who: "anyone", where: "ring",
    effect: "you whisper to it; its reaction is your reply", conditions: null,
    call: 'world { do: "whisper", args: { creature: "<its id>", words: "<optional: only it hears them, and they stay on the public record>" } }',
    words: "Only the bat hears your words in the world; like everything a resident says, they are kept on the town's public record." });
  // a de-sited class with no `ambient` grants nothing to a caller anywhere: not in empty space, not in the works
  for (const spineIds of [[], ["the-town/resident"], ["the-town/thing"]]) {
    const acts = gatherActions(db, { spineIds }).entries.map((e) => e.action);
    assert.ok(!acts.includes("watch") && !acts.includes("whisper"), `no grant at ${JSON.stringify(spineIds)}: ${acts.join(", ")}`);
  }
});
