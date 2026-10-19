// kind-rung.test.mjs — one class resolver, in both forms (LOGOS v2 part 2, lane O1).
//
// LOGOS/classes.md § The LOGOS ladder, verbatim (ruled 2026-10-16 15:43, 16:02):
//   "`kind` is a flat field naming the node's own class … a class node is
//    `kind: class`, a property node is `kind: property`, and `naming` is a
//    subclass of `predicate` … The `class:` field folds into `kind`: a class
//    node's name is its own slug, so `kind: candy` names `the-town/candy`."
// Until the instance migration lands, the record holds both spellings, and every
// reader must give one answer for both.

import test from "node:test";
import assert from "node:assert/strict";

import { classOfInstance, markClassOf, kindFieldOf, lineageOf, standingOf, isSited } from "../src/world-grants.mjs";

// The ruled tree (SITTING.md § 13:56–15:12), as `extends` edges.
const TREE = {
  mark: "postmark-node", post: "postmark-node", entity: "postmark-node",
  sited: "mark", predicate: "mark", naming: "predicate",
  thing: "sited", note: "sited", parcel: "sited", "portal-ground": "sited", vehicle: "portal-ground",
  consumable: "thing", candy: "consumable", "halloween-candy-bowl": "thing",
  idea: "post", bounty: "post", resident: "entity",
};
const extendsOf = (n) => TREE[n] ?? null;

test("the class a mark names: the old form's class:, the new form's kind, and the same answer for both", () => {
  for (const [old, neu, want] of [
    [{ kind: "sited", class: "thing" }, { kind: "thing" }, "thing"],
    [{ kind: "sited", class: "candy" }, { kind: "candy" }, "candy"],
    [{ kind: "sited", class: "portal-ground" }, { kind: "portal-ground" }, "portal-ground"],
    [{ kind: "sited", class: "idea" }, { kind: "idea" }, "idea"],
    [{ kind: "parcel" }, { kind: "parcel" }, "parcel"],
  ]) {
    assert.equal(markClassOf(old), want, `old form ${JSON.stringify(old)}`);
    assert.equal(markClassOf(neu), want, `new form ${JSON.stringify(neu)}`);
  }
  // a plain mark names no class in either form, exactly as `m.class` was undefined on it
  assert.equal(markClassOf({ kind: "sited" }), null);
  assert.equal(markClassOf({ kind: "predicated", slot: "x", value: "y" }), null);
  // class-space names no class of its own
  assert.equal(markClassOf({ kind: "class" }), null);
  assert.equal(markClassOf({ kind: "property" }), null);
});

test("the store's row keeps the file's kind as subkind (its own kind is `mark`), and both sources read alike", () => {
  assert.equal(kindFieldOf({ kind: "mark", subkind: "thing" }), "thing");
  assert.equal(kindFieldOf({ kind: "thing" }), "thing");
  assert.equal(markClassOf({ kind: "mark", subkind: "thing" }), "thing");
  assert.equal(markClassOf({ kind: "mark", subkind: "sited", class: "thing" }), "thing");
  assert.equal(markClassOf({ kind: "mark", subkind: "sited" }), null, "the store's own `mark` is never read as a class");
});

test("classOfInstance: unchanged on the old form, and the new form resolves to the same class", () => {
  // the old answers, held (test/world-grants.test.mjs § the instance's class)
  assert.equal(classOfInstance({ subkind: "parcel", class: null }), "parcel");
  assert.equal(classOfInstance({ subkind: "sited", class: null }), "mark");
  assert.equal(classOfInstance({ subkind: "sited", class: "portal-ground" }), "portal-ground");
  assert.equal(classOfInstance({ subkind: "class", class: "parcel", declares: true }), null);
  assert.equal(classOfInstance({ subkind: "predicated", class: null }), null);
  assert.equal(classOfInstance({ subkind: "naming", class: null }), null);
  // the new form
  assert.equal(classOfInstance({ subkind: "portal-ground", class: null }), "portal-ground");
  assert.equal(classOfInstance({ subkind: "thing" }), "thing");
  assert.equal(classOfInstance({ kind: "vehicle" }), "vehicle");
  assert.equal(classOfInstance({ subkind: "predicate" }), null, "a predicate resolves no grants, in either form");
  assert.equal(classOfInstance({ subkind: "thing", declares: true }), null, "a declaration is never an instance");
});

test("lineage walks extends to the root, and a cycle or a gap ends it", () => {
  assert.deepEqual(lineageOf("candy", extendsOf), ["candy", "consumable", "thing", "sited", "mark", "postmark-node"]);
  assert.deepEqual(lineageOf("unknown", extendsOf), ["unknown"]);
  assert.deepEqual(lineageOf("a", (n) => ({ a: "b", b: "a" })[n]), ["a", "b"]);
  assert.deepEqual(lineageOf("a", () => { throw new Error("unreadable"); }), ["a"]);
});

test("how a mark stands: the old form says it; the new form says it by lineage (ruled 13:56)", () => {
  // LOGOS § kind: "How a mark stands is which of `mark`'s two mutually exclusive
  // subclasses it is an instance of — `sited` or `predicate` … never a field and never a property."
  for (const [m, want] of [
    [{ kind: "sited", class: "thing" }, "sited"], [{ kind: "thing" }, "sited"],
    [{ kind: "sited" }, "sited"], [{ kind: "parcel" }, "sited"],
    [{ kind: "candy" }, "sited"], [{ kind: "vehicle" }, "sited"],
    [{ kind: "predicated" }, "predicate"], [{ kind: "naming" }, "predicate"], [{ kind: "predicate" }, "predicate"],
    [{ kind: "idea" }, "node"], [{ kind: "resident" }, "node"],
    [{ kind: "class" }, "class"], [{ kind: "property" }, "property"],
  ]) assert.equal(standingOf(m, extendsOf), want, JSON.stringify(m));
  assert.equal(standingOf({ kind: "thing" }, () => null), null, "an unreadable lineage is unknown, never guessed");
  assert.equal(isSited({ kind: "thing" }, extendsOf), true);
  assert.equal(isSited({ kind: "idea" }, extendsOf), false, "a post is not sited (ruled 15:12)");
  assert.equal(isSited({ kind: "parcel" }, () => null), true, "parcel is sited even where its class still extends mark");
});
