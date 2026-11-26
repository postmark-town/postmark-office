// class-properties.mjs — A CLASS'S PROPERTIES, READ FROM THE RECORD (LOGOS v2 part 2).
//
// LOGOS/classes.md § Property and predicate (ruled 2026-10-16): a property is
// the class side. It is a node of its own, `kind: property`, standing under the
// class it belongs to, and it carries four fixed fields: its `name`, its `tier`
// (whose word decides the value on an instance: `constitution`, the town's and
// locked; `sovereign`, the maker's), its `default`, and its body. "Every dial is
// a property, and a locked value is its default" (16:02), so what the class
// nodes once wrote inline as `dials:` is read here, from the property nodes.
//
// A property may have child properties (its caps and bounds). A child names its
// parent property in its own `of:` field and files beside it in the class's
// directory (a few older clauses are filed under their parent instead). A class inherits its ancestors' properties down `extends`, and a
// subclass that declares a property of the same name shadows the ancestor's
// (the Halloween Candy Bag's `capacity` 200 over thing's).
//
// Browser-pure on purpose: the viewer reads the stride through this, from the
// store, and the store carries `name`, `default`, `parent` and `extends` for
// exactly that reason. `marks` is either loader records (`loadMarks`) or the
// store's rows (world-state.json); both carry the four fields this reads.

const TOWN = "the-town";

// The record grammar keeps every value as text except numbers and JSON, so a
// default of `true`, `false` or `null` arrives as the word. A property's value
// is a number, a true/false or free text (no one-of values, ruled 15:12).
export function propertyValue(raw) {
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (raw === "null") return null;
  return raw;
}

// A store row carries the derived standing as `tier` and the property's own as
// `property_tier`; a loader record carries the property's own as `tier`.
const tierOf = (node) => node.property_tier ?? node.tier;

const isClassNode = (m) => m?.kind === "class" && (m.by ?? m.household) === TOWN;
const isProperty = (m) => m?.kind === "property";

/** One reusable index over the marks: classes by name, properties by parent. */
export function classIndex(marks) {
  const byName = new Map();
  const propsUnder = new Map();
  for (const m of marks ?? []) {
    if (isClassNode(m) && m.class != null && !byName.has(String(m.class))) byName.set(String(m.class), m);
    // a child property names its parent property in `of:` and files flat in its
    // class's directory (the layout, 2026-10-17); a property without `of:`
    // belongs to the node it is filed under
    const under = isProperty(m) ? (m.of ?? m.parent) : null;
    if (under) {
      if (!propsUnder.has(under)) propsUnder.set(under, []);
      propsUnder.get(under).push(m);
    }
  }
  return { byName, propsUnder };
}

const indexOf = (marksOrIndex) => (marksOrIndex?.byName && marksOrIndex?.propsUnder ? marksOrIndex : classIndex(marksOrIndex));

/** The class chain from `name` up `extends`, nearest first. Guarded against a cycle. */
export function classChain(marksOrIndex, name) {
  const { byName } = indexOf(marksOrIndex);
  const out = [];
  const seen = new Set();
  for (let c = byName.get(String(name)); c && !seen.has(c.id); c = c.extends ? byName.get(String(c.extends)) : null) {
    seen.add(c.id);
    out.push(c);
  }
  return out;
}

/** The property nodes standing directly under one node (a class or a property). */
export function ownProperties(marksOrIndex, nodeId) {
  return indexOf(marksOrIndex).propsUnder.get(nodeId) ?? [];
}

/**
 * The property `name` as class `className` has it: its own, or the nearest
 * ancestor's down `extends`. `{ node, value, tier, from }` (`from` is the class
 * that declares it), or null when no class in the chain declares it.
 */
export function propertyOf(marksOrIndex, className, name) {
  return propertyAt(marksOrIndex, className, [name]);
}

/**
 * A child property by its path from the class, `["holder", "capacity"]`: the
 * nearest class in the chain that declares the WHOLE path answers. So a
 * subclass that sets only `holder` (the Candy Bowl) still has thing's capacity
 * beneath it, and one that sets `holder` → `capacity` (the Candy Bag) has its
 * own.
 */
export function propertyAt(marksOrIndex, className, path) {
  const idx = indexOf(marksOrIndex);
  const names = Array.isArray(path) ? path : [path];
  for (const c of classChain(idx, className)) {
    let node = null;
    let under = c.id;
    for (const n of names) {
      node = ownProperties(idx, under).find((p) => p.name === n) ?? null;
      if (!node) break;
      under = node.id;
    }
    if (node) return { node, value: propertyValue(node.default), tier: tierOf(node), from: String(c.class) };
  }
  return null;
}

/**
 * Every property name class `className` declares at any depth, inherited: the
 * names an instance's flat fields may use (`holder`, and `capacity` and `open`
 * beneath it).
 */
export function propertyNames(marksOrIndex, className) {
  const idx = indexOf(marksOrIndex);
  const out = new Set();
  const walk = (id, hops) => {
    if (hops > 16) return;
    for (const p of ownProperties(idx, id)) { out.add(p.name); walk(p.id, hops + 1); }
  };
  for (const c of classChain(idx, className)) walk(c.id, 0);
  return out;
}

/** A child property of a property node, by name: capacity's `min` and `max`. */
export function childProperty(marksOrIndex, propertyNode, name) {
  const node = propertyNode ? ownProperties(marksOrIndex, propertyNode.id).find((p) => p.name === name) : null;
  return node ? { node, value: propertyValue(node.default), tier: tierOf(node) } : null;
}

/**
 * Every property class `className` has, inherited and shadowed: a Map from name
 * to `{ node, value, tier, from }`, nearest declaration winning.
 */
export function propertiesOf(marksOrIndex, className) {
  const idx = indexOf(marksOrIndex);
  const out = new Map();
  for (const c of classChain(idx, className))
    for (const node of ownProperties(idx, c.id))
      if (!out.has(node.name)) out.set(node.name, { node, value: propertyValue(node.default), tier: tierOf(node), from: String(c.class) });
  return out;
}
