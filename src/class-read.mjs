// class-read.mjs — explain climbs the class (POS-659, ruled 2026-10-16 09:53–09:57).
//
// "explain is like the ontology level. It's climbing the class whereas
// investigate is … diegetic" (Darko). `explain: "<class>"` answers what a thing
// IS from its class node: the body, the `extends` chain (each step up is the
// same move, `explain: "<the class above>"`), its properties with their tier,
// default and children, its afforded actions with who may take them, from where,
// their effect and their conditions, and `makers`, resolved up the chain and
// named where it came from (LOGOS/reads-and-affordances.md § Explain climbs the
// class; LOGOS/classes.md § Property and predicate, § Instantiation).
//
// ── ONE READER, BOTH FORMS THE LAW ALLOWS ───────────────────────────────────
// A class's properties stand in the record in two shapes while the class layer
// migrates (classes.md: "an inline `dials:` entry is a constitution property
// written inline until its class migrates"):
//
//   the label rung     an inline `dials: { name: value }` entry on the class
//                      node: a constitution property whose locked value is its
//                      default, and which carries no body of its own
//   the property rung  a child node under the class (`describes`): today the
//                      93 `kind: predicated` children (`slot`, `value`, tier,
//                      body), and from WLD-73 part 2 `kind: property` nodes
//                      (`name`, `tier`, `default`, body), which may have
//                      children of their own
//
// Both come out as ONE row shape — name, tier, default, body — so a class reads
// the same whichever form it is written in, and part 2's migration changes the
// record, never this file. Where one name stands in both, the property rung
// wins (world-classes § dialNumber: "predicate children first, frontmatter
// second — the migration's precedence").
//
// The class's MEANING is quoted through `residueOf` (world-apex.mjs), the reader
// every act card already uses; this file adds only the class's structure
// (extends, actions) and its children, which residueOf was never asked for.
// Every statement here has its twin beside it (world-graph-db.mjs), held to its
// SQL by test/world-graph-db.test.mjs.

import { CLASS_ROSTER_GATE_SQL } from "./world-store.mjs";
import { classRosterGate, classRosterGateValue, jx, registerTwin } from "./world-graph-db.mjs";
import { openStore, residueOf, requiresOf } from "./world-apex.mjs";
import { entriesOfClass } from "./world-grants.mjs";
import { CREATURE_CALLS, WHISPER_WORDS } from "./world-read-shape.mjs";

const parseJson = (s, fallback) => { if (s != null && typeof s === "object") return s; try { return JSON.parse(s ?? ""); } catch { return fallback; } };

// The class node a class NAME declares: the roster gate (a class-carrying town
// constitution mark standing in the Keeping Works), the first in record order
// (rowid in the file, the snapshot's own order in the twin).
const CLASS_ID_SQL = `SELECT id FROM nodes WHERE ${CLASS_ROSTER_GATE_SQL} AND json_extract(props, '$.class') = ? ORDER BY rowid LIMIT 1`;
registerTwin(CLASS_ID_SQL, (g, name) => g.nodes.filter((n) => classRosterGate(n) && jx(n.p, "class") === name).slice(0, 1).map((n) => ({ id: n.id })));

// The same gate asked of a full id, so a class answers by its id exactly when it answers by its name.
const CLASS_BY_ID_SQL = `SELECT id FROM nodes WHERE id = ? AND ${CLASS_ROSTER_GATE_SQL}`;
registerTwin(CLASS_BY_ID_SQL, (g, id) => {
  const n = g.byId.get(String(id));
  return n && classRosterGate(n) ? [{ id: n.id }] : [];
});

// Every class name the roster knows, for the nearest-names answer to an unknown one.
const CLASS_NAMES_SQL = `SELECT DISTINCT json_extract(props, '$.class') AS class FROM nodes WHERE ${CLASS_ROSTER_GATE_SQL} ORDER BY class`;
registerTwin(CLASS_NAMES_SQL, (g) => [...new Set(g.nodes.filter(classRosterGate).map((n) => jx(n.p, "class")))]
  .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).map((c) => ({ class: c })));

// THE KINDS UNDER A CLASS (POS-692): the roster's classes whose `extends` names
// this one, by name. "Each kind of candy is a subclass of candy … residents may
// make candy of any kind" — and a kind no read lists is a kind nobody finds.
const SUBCLASSES_SQL = `SELECT DISTINCT json_extract(props, '$.class') AS class FROM nodes
      WHERE ${CLASS_ROSTER_GATE_SQL} AND json_extract(props, '$.extends') = ? ORDER BY class`;
registerTwin(SUBCLASSES_SQL, (g, name) => [...new Set(g.nodes.filter((n) => classRosterGate(n) && jx(n.p, "extends") === name).map((n) => jx(n.p, "class")))]
  .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).map((c) => ({ class: c })));

// The class's structure: what it extends and the actions it declares. Same
// authorship and tier gate as residueOf (only the town's constitutional record).
const CLASS_SHAPE_SQL = `SELECT id,
         json_extract(props, '$.class')       AS class,
         json_extract(props, '$.extends')     AS extends,
         json_extract(props, '$.actions')     AS actions,
         json_extract(props, '$.affordances') AS affordances
       FROM nodes
      WHERE id = ? AND by = 'the-town' AND tier = 'constitution'
        AND json_extract(props, '$.class') IS NOT NULL`;
registerTwin(CLASS_SHAPE_SQL, (g, id) => {
  const n = g.byId.get(String(id));
  return n && n.by === "the-town" && n.tier === "constitution" && jx(n.p, "class") !== null
    ? [{ id: n.id, class: jx(n.p, "class"), extends: jx(n.p, "extends"), actions: jx(n.p, "actions"), affordances: jx(n.p, "affordances") }] : [];
});

// The property rung: the town's nodes standing under a class (or under a
// property) by `describes`, in the record's order. Both child shapes ride the
// same columns: a predicated child's `slot`/`value`, a property node's
// `name`/`default`.
const CHILDREN_SQL = `SELECT p.id, p.subkind AS kind, p.tier,
         json_extract(p.props, '$.slug')    AS slug,
         json_extract(p.props, '$.name')    AS name,
         json_extract(p.props, '$.slot')    AS slot,
         json_extract(p.props, '$.value')   AS value,
         json_extract(p.props, '$.default') AS dflt,
         json_type(p.props, '$.default')    AS dflt_type,
         json_extract(p.props, '$.body')    AS body
       FROM edges e JOIN nodes p ON p.id = e.dst
      WHERE e.src = ? AND e.type = 'describes' AND p.by = 'the-town'
      ORDER BY e.seq`;
// `json_type(props, '$.<key>')`: json_extract answers a true/false as 1/0, so
// the type rides beside a default and a boolean stays one (the label rung's
// inline dials are parsed JSON, and keep theirs).
const jtype = (p, key) => {
  const v = p?.[key];
  if (v === undefined) return null;
  if (v === null) return "null";
  if (v === true) return "true";
  if (v === false) return "false";
  if (typeof v === "number") return Number.isInteger(v) ? "integer" : "real";
  if (typeof v === "string") return "text";
  return Array.isArray(v) ? "array" : "object";
};
registerTwin(CHILDREN_SQL, (g, id) => g.edges
  .filter((e) => e.src === String(id) && e.type === "describes")
  .sort((a, b) => a.seq - b.seq)
  .map((e) => g.byId.get(e.dst))
  .filter((p) => p && p.by === "the-town")
  .map((p) => ({ id: p.id, kind: p.subkind ?? null, tier: p.tier ?? null, slug: jx(p.p, "slug"), name: jx(p.p, "name"),
    slot: jx(p.p, "slot"), value: jx(p.p, "value"), dflt: jx(p.p, "default"), dflt_type: jtype(p.p, "default"), body: jx(p.p, "body") })));

// A statement that fails throws to the door, which logs it: an empty answer would read as "no such class".
const ask = (db, sql, ...args) => db.prepare(sql).all(...args);

/** The class node id a name (or a full id) declares, or null. */
export function classIdOf(db, name) {
  if (!db || name == null) return null;
  const s = String(name).trim();
  if (!s) return null;
  const byName = ask(db, CLASS_ID_SQL, s)[0]?.id ?? null;
  if (byName) return byName;
  // A full id (`the-town/thing`) means the class it declares, under the same gate as the name.
  return s.includes("/") ? (ask(db, CLASS_BY_ID_SQL, s)[0]?.id ?? null) : null;
}

const MAX_DEPTH = 3; // a property's children, and theirs: the regress stops at the four fixed fields

/** One child node as a property row, or null when it is neither shape. */
function propertyRow(db, c, depth) {
  // A property node names itself by `name`, else by its slug; a predicated child by its `slot`.
  // A subclass also stands under its class by `describes`, and carries neither: it is not a property.
  const name = c.name ?? c.slot ?? (c.kind === "property" ? c.slug : null);
  if (name == null) return null;
  const children = depth < MAX_DEPTH ? childProperties(db, c.id, depth + 1) : [];
  return {
    name: String(name),
    tier: c.tier ?? null,
    default: c.dflt_type === "true" ? true : c.dflt_type === "false" ? false : (c.dflt ?? c.value ?? null),
    body: String(c.body ?? ""),
    id: c.id,
    ...(children.length ? { children } : {}),
  };
}

function childProperties(db, id, depth = 1) {
  return ask(db, CHILDREN_SQL, id).map((c) => propertyRow(db, c, depth)).filter(Boolean);
}

/**
 * A class's own properties, both forms as one row shape: `{ name, tier,
 * default, body, id?, children?, form }`. The property rung first, in record
 * order; then each label-rung dial the property rung does not already name.
 */
export function propertiesOf(db, id, dials = null) {
  const out = childProperties(db, id).map((p) => ({ ...p, form: "property" }));
  const named = new Set(out.map((p) => p.name));
  const inline = dials && typeof dials === "object" && !Array.isArray(dials) ? dials : {};
  for (const [name, value] of Object.entries(inline)) {
    if (named.has(name)) continue;
    out.push({ name, tier: "constitution", default: value, body: "", form: "label" });
  }
  return out;
}

/** "true"/"false" as the record spells them (a predicated value is text), else null. */
const truth = (v) => (v === true || v === 1 || v === "true" ? true : v === false || v === 0 || v === "false" ? false : null);

const conditionWords = (req) => {
  if (!req || typeof req !== "object") return null;
  const parts = [];
  if (req.within_class) parts.push(`within a ${req.within_class}`);
  if (req.phase) parts.push(`while it is ${req.phase}`);
  for (const [k, v] of Object.entries(req)) if (k !== "within_class" && k !== "phase") parts.push(`${k}: ${JSON.stringify(v)}`);
  return parts.length ? parts.join(", ") : null;
};

const EFFECT_MAX = 150; // the class grammar's own cap, as the act cards quote it

/**
 * The afforded actions a class declares, each with who, where, its effect and
 * its conditions. The entries are the grant reader's own (world-grants.mjs §
 * entriesOfClass: `actions ?? affordances`, `for` by kindOf), so explain and
 * the act cards cannot read one class two ways; the effect is quoted as the act
 * card quotes its blurb (world-apex § entriesFrom), and the conditions are the
 * residue's `requires`.
 */
export function actionsOf(db, shape) {
  // A CREATURE'S AFFORDED ACTIONS (POS-672) declare their own who, from where and
  // effect, and are aimed at a creature, never granted at a standpoint: they are
  // read as declared, with the exact call an agent makes (CREATURE_CALLS, the
  // same words `can` teaches). The grant reader keeps `from` for the class, so
  // the declaration is read beside it.
  const declared = new Map((parseJson(shape?.actions, null) ?? []).filter((a) => a && typeof a.action === "string").map((a) => [a.action, a]));
  return entriesOfClass(shape, { channel: "class", parse: (x) => parseJson(x, null) }).map((e) => {
    const own = Object.hasOwn(CREATURE_CALLS, e.action) ? declared.get(e.action) : null;
    if (own) return {
      action: e.action, who: String(own.who ?? "anyone"), where: String(own.from ?? "unscoped"),
      effect: String(own.effect ?? "").slice(0, EFFECT_MAX), call: CREATURE_CALLS[e.action], conditions: null,
      ...(e.action === "whisper" ? { words: WHISPER_WORDS } : {}), // review-692 F1: what a whisper's words are, said where it is taught
    };
    const residueId = String(e.residue ?? "").trim() || null;
    const meaning = residueId ? residueOf(db, residueId) : null;
    const requires = residueId ? requiresOf(db, residueId) : null;
    return {
      action: e.action,
      who: e.for,
      where: e.scope == null || String(e.scope).trim() === "" ? "unscoped" : String(e.scope),
      effect: meaning ? meaning.text.slice(0, EFFECT_MAX) : String(e.blurb ?? "").slice(0, EFFECT_MAX),
      ...(meaning ? { effect_from: meaning.from } : residueId ? { residue_unresolved: residueId } : {}),
      conditions: conditionWords(requires),
      ...(requires ? { requires } : {}),
    };
  });
}

/** The extends chain above a class: `[{ class, id }]`, nearest first, stopping at a loop or an unknown name. */
export function chainOf(db, id) {
  const out = [];
  const seen = new Set([String(id)]);
  let shape = ask(db, CLASS_SHAPE_SQL, id)[0];
  while (shape?.extends) {
    const up = classIdOf(db, shape.extends);
    if (!up || seen.has(up)) break;
    seen.add(up);
    out.push({ class: String(shape.extends), id: up });
    shape = ask(db, CLASS_SHAPE_SQL, up)[0];
  }
  return out;
}

/**
 * `makers` resolved up the chain: the nearest class that declares it, in
 * either form, answers. `{ value: true|false, from }`, or `{ value: null,
 * from: null }` when no class on the chain declares it yet.
 */
export function makersOf(db, id, chain = chainOf(db, id)) {
  for (const cid of [String(id), ...chain.map((c) => c.id)]) {
    const own = residueOf(db, cid);
    const p = propertiesOf(db, cid, own?.dials).find((x) => x.name === "makers");
    const v = p ? truth(p.default) : null;
    if (v !== null) return { value: v, from: cid };
  }
  return { value: null, from: null };
}

// "an" by the sound, not the letter: a unit, a user, a one-off; an hour, an heir.
const article = (w) => {
  const x = String(w).toLowerCase();
  if (/^(hour|heir|honest|honou?r)/.test(x)) return "an";
  if (/^(uni|use|usu|uti|ure|eu|ewe|one|once)/.test(x)) return "a";
  return /^[aeiou]/.test(x) ? "an" : "a";
};
const ROOT = "postmark-node"; // the root of every chain, named by no pointer

/** The one-line class pointer an instance read carries: `kind: thing · a mark — explain: "thing"`. Null when the class is unknown. */
export function classPointer(db, name) {
  const id = classIdOf(db, name);
  if (!id) return null;
  const klass = residueOf(db, id)?.class ?? String(name);
  const above = chainOf(db, id).map((c) => c.class).filter((c) => c !== ROOT).slice(0, 2);
  return [`kind: ${klass}`, ...above.map((c) => `${article(c)} ${c}`)].join(" · ") + ` — explain: "${klass}"`;
}

/** Levenshtein, for the nearest names to an unknown class. */
function distance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

/** Up to five class names nearest `name`: a name containing it (or contained by it), else within a third of its letters in edits. */
export function nearestClasses(db, name, n = 5) {
  const s = String(name).toLowerCase().replace(/^the-town\//, "");
  return ask(db, CLASS_NAMES_SQL).map((r) => String(r.class))
    .map((c) => ({ c, d: c.includes(s) || s.includes(c) ? 0 : distance(s, c) }))
    .filter((x) => x.d <= Math.max(1, Math.floor(s.length / 3)))
    .sort((a, b) => a.d - b.d || (a.c < b.c ? -1 : 1))
    .slice(0, n).map((x) => x.c);
}

// ── THE OPEN SLOTS: everything left to the maker (Darko, 2026-10-20 11:22, WLD-83) ──
//
// `properties` are what a class ADDS: its own rows, as they always were. `open`
// is everything an instance's maker fills, which is every SOVEREIGN property the
// class has, its own and every one it inherits up `extends`. Until 10-20 open
// was the own sovereign names only, so `explain: "resident"` never said that an
// entity's appearance slots were there to fill; now it does, and `thing` lists
// mark's body, sited's at and extent beside its own portable (intended).
//
// A NESTED property is named by its PATH, dotted from the class: `appearance`,
// `appearance.form`. The path rule is the one the world's propertyAt keeps (the
// nearest class in the chain that declares the whole path answers), so an own
// path shadows an inherited one of the same path and is listed once, as own.
// `open_from` maps each INHERITED path to the class that declares it; an own
// path is absent from it. Descent stops where `properties` stops (MAX_DEPTH).
//
// The nearest declaration answers WHATEVER ITS TIER (propertyAt; mark-lint § BY
// PATH): a class that re-declares an inherited sovereign path as constitution
// LOCKS it, so the farther sovereign one is not open there. So every declared
// path is seen, sovereign or not, label-rung dials included (an ancestor's dials
// read the way makersOf reads them), and only the sovereign ones are open.
// halloween-candy-bowl's constitution `holder` over thing's sovereign one is
// the case in the law.
function declaredPaths(rows, prefix = "", out = []) {
  for (const p of rows) {
    const path = prefix ? `${prefix}.${p.name}` : String(p.name);
    out.push({ path, sovereign: p.tier === "sovereign" });
    if (p.children?.length) declaredPaths(p.children, path, out);
  }
  return out;
}

/** The open slots and where each inherited one comes from: `{ open: [path], open_from: { path: class } }`. */
export function openSlotsOf(db, properties, chain) {
  const open = [];
  const seen = new Set();
  const from = {};
  const take = (rows, klass) => {
    for (const { path, sovereign } of declaredPaths(rows)) {
      if (seen.has(path)) continue;   // a nearer class declared it: that declaration answers
      seen.add(path);
      if (!sovereign) continue;       // declared and locked: never open
      open.push(path);
      if (klass) from[path] = klass;
    }
  };
  take(properties, null);
  for (const c of chain) take(propertiesOf(db, c.id, residueOf(db, c.id)?.dials), c.class);   // nearest class first
  return { open, open_from: from };
}

/**
 * The answer to `explain: "<class>"`, or null when `name` declares no class
 * (the caller then answers its own bounce). One shape at every rung, so each
 * step up the chain is the same move: `properties` are what the class adds,
 * and `open` is everything left to the maker, inherited slots included.
 */
export function explainClass(db, name) {
  const id = classIdOf(db, name);
  if (!id) return null;
  const own = residueOf(db, id);
  const shape = ask(db, CLASS_SHAPE_SQL, id)[0] ?? null;
  const chain = chainOf(db, id);
  const properties = propertiesOf(db, id, own?.dials);
  const makers = makersOf(db, id, chain);
  const klass = own?.class ?? String(name);
  const up = chain[0]?.class ?? null;
  const kinds = ask(db, SUBCLASSES_SQL, klass).map((r) => String(r.class));
  return {
    explains: klass,
    class: id,
    what: own?.text ?? "",
    extends: chain.map((c) => ({ class: c.class, explain: `explain: "${c.class}"` })),
    properties,
    // Everything left to the maker: every sovereign property, own and inherited, by
    // path; open_from names the class each inherited one comes from (§ THE OPEN SLOTS).
    ...openSlotsOf(db, properties, chain),
    actions: actionsOf(db, shape),
    makers: makers.value === null
      ? { value: null, from: null, note: "not declared on this chain yet (WLD-73 part 2 writes it)" }
      : { value: makers.value, from: makers.from, ...(makers.from !== id ? { inherited: true } : {}) },
    deeper: up ? `explain: "${up}" — the class above, read the same way; its properties are what it adds, and open is everything left to the maker` : "this is the root: every class climbs to it",
    // the classes under this one, by name (explain: "<kind>" reads one); every class answers the key, so the climb keeps one shape
    kinds,
    changes: "at a settlement that changes the class layer",
  };
}

// ── THE POINTER ON AN INSTANCE READ ─────────────────────────────────────────
// "Every instance read carries a one-line class pointer" (ruled 16:02). The
// reads that answer one instance ask here: a mark (world_investigate, the world
// read's `mark:` focus), a resident and a creature (`investigate:`). Off the
// store's graph snapshot, like the class layer itself; absent, never guessed,
// when the store or the class cannot answer.

// What a mark names as its class: its `class:` field, its `kind` (which names
// the node's own class from 2026-10-16: "`kind: candy` names the-town/candy",
// classes.md § The LOGOS ladder), and whether it is itself a class node.
const MARK_KIND_SQL = `SELECT json_extract(props, '$.class') AS class, subkind AS kind,
              (${CLASS_ROSTER_GATE_SQL}) AS defines_class
         FROM nodes WHERE id = ?`;
registerTwin(MARK_KIND_SQL, (g, id) => {
  const n = g.byId.get(String(id));
  return n ? [{ class: jx(n.p, "class"), kind: n.subkind ?? null, defines_class: classRosterGateValue(n) }] : [];
});

/**
 * The pointer for a mark by id: the first of its `class:` and its `kind` that
 * names a class, else `mark` (a `kind: sited` or `predicated` record names
 * the standing it was written with, which no class node carries yet: WLD-73
 * part 2). A class node points at itself.
 */
export function markPointer(markId) {
  const store = openStore();
  if (!store?.db) return null;
  const row = ask(store.db, MARK_KIND_SQL, String(markId))[0];
  if (!row) return null;
  if (row.defines_class === 1 && row.class) return `kind: class — explain: "${row.class}"`;
  const named = [row.class, row.kind].find((c) => c && classIdOf(store.db, c));
  return classPointer(store.db, named ?? "mark");
}

/** The pointer for a class by name (a resident's `resident`, a creature's kind). */
export function namedPointer(name) {
  const store = openStore();
  return store?.db && name ? classPointer(store.db, name) : null;
}

/** `answer` with its pointer beside it; an error or a missing pointer leaves it as it was. */
export const withPointer = (answer, pointer) =>
  answer && !answer.error && pointer ? { ...answer, class_pointer: pointer } : answer;

/** The statements this module asks, each with its twin, for the tests to hold to their SQL. */
export const CLASS_READ_STATEMENTS = Object.freeze([CLASS_ID_SQL, CLASS_BY_ID_SQL, CLASS_NAMES_SQL, CLASS_SHAPE_SQL, CHILDREN_SQL, MARK_KIND_SQL, SUBCLASSES_SQL]);
