// law-classes.mjs — the class layer, read from law_projection at the newest
// blessing instead of from world.db (POS-270, 2026-09-27).
//
// "The bless overrides the tick" (Keemin, 2026-09-18, postmark#2934): world.db
// was hydrated at the newest `settlement/S<n>` tag, never at main, and a class
// read that moves to the store keeps that tense. The law pen ingests the blessed
// sha on its own run (`world2-ingest.sh law` → `law-ingest.mjs --blessed`), and
// the store's `settlements` table names the tag. So the pin is the newest
// settlement whose sha the law pen has ingested — and when the newest settlement
// is NOT yet ingested, the answer comes from the one before it and SAYS so,
// rather than reaching for main.
//
// PURE below the query: rows in, answers out, the same answers world-classes.mjs
// gives off world.db. Measured at S83 against a world.db hydrated at the same
// sha: roster 155/155, frontmatter dials 155/155, predicate children 155/155
// classes (89 slots), dial nodes 89/89 (test/law-classes-parity.test.mjs holds
// it per class and per slot).

// Every row the class readers need, at the pin. `number`/`tag_sha` ride on each
// row so one round trip answers both "which blessing" and "what it says".
// `newest` is the newest settlement at all, so a pin behind it is disclosed.
export const LAW_AT_BLESSING_SQL = `
  WITH newest AS (SELECT max(number) AS n FROM settlements),
       pin AS (
         SELECT s.number, s.tag_sha FROM settlements s
          WHERE EXISTS (SELECT 1 FROM law_projection l WHERE l.law_sha = s.tag_sha)
          ORDER BY s.number DESC LIMIT 1)
  SELECT pin.number, pin.tag_sha, newest.n AS newest, l.kind, l.key, l.data
    FROM pin CROSS JOIN newest
    JOIN law_projection l ON l.law_sha = pin.tag_sha AND l.kind IN ('class', 'predicate', 'property')
   ORDER BY l.kind, l.key`;

/**
 * The query's rows → one snapshot of the class layer.
 * `{ pin: { settlement, sha, newest }, classes: Map<name, record>, predicates: Map<name, Map<slot, {value, id}>>, disclosed }`
 * or null when the store holds no ingested blessing at all.
 */
export function lawSnapshotFromRows(rows) {
  if (!rows?.length) return null;
  const { number, tag_sha, newest } = rows[0];
  const classes = new Map();
  const predicates = new Map();
  for (const r of rows) if (r.kind === "class") classes.set(String(r.key), r.data ?? {});
  // Two children may name one slot. world.db answers the pair by row order —
  // classPredicates keeps the LAST value, dialNode's `LIMIT 1` the FIRST node —
  // so the rows are walked in the loader's order (`ord`) and answered the same.
  const preds = rows.filter((r) => r.kind === "predicate").map((r) => r.data ?? {})
    .sort((a, b) => (Number(a.ord ?? 0) - Number(b.ord ?? 0)));
  for (const d of preds) {
    const k = String(d.class), slot = String(d.slot);
    if (!predicates.has(k)) predicates.set(k, new Map());
    const seen = predicates.get(k).get(slot);
    predicates.get(k).set(slot, { value: d.value ?? null, id: seen ? seen.id : (d.id ?? null) });
  }
  // A class's PROPERTY NODES (LOGOS v2: `kind: property`, filed under their
  // class; a child property under its property). `class → name → {default,
  // tier, id, children: name → {default, tier, id}}`. Empty on a law that has
  // none yet, and every reader then stands on the predicate children and dials.
  const properties = new Map();
  const props = rows.filter((r) => r.kind === "property").map((r) => r.data ?? {})
    .sort((a, b) => (Number(a.ord ?? 0) - Number(b.ord ?? 0)));
  // Properties nest (holder → capacity → min, max), and a class names each
  // once, so they are held BY NAME within their class, each with its parent's
  // name and its direct children.
  for (const d of props) {
    const k = String(d.class);
    if (!properties.has(k)) properties.set(k, new Map());
    const own = properties.get(k);
    const name = String(d.name);
    if (own.has(name) && own.get(name).id != null) continue; // a second statement of one name: the first stands
    const prior = own.get(name);
    own.set(name, { default: d.default ?? null, tier: d.tier ?? null, id: d.id ?? null, parent: d.parent == null ? null : String(d.parent), children: prior?.children ?? new Map() });
  }
  for (const own of properties.values()) {
    for (const [name, p] of own) {
      if (p.parent == null) continue;
      if (!own.has(p.parent)) own.set(p.parent, { default: null, tier: null, id: null, parent: null, children: new Map() });
      own.get(p.parent).children.set(name, { default: p.default, tier: p.tier, id: p.id });
    }
  }
  const settlement = Number(number);
  const newestN = newest == null ? settlement : Number(newest);
  return {
    pin: { settlement, sha: String(tag_sha), newest: newestN },
    classes, predicates, properties,
    disclosed: newestN > settlement
      ? `the class layer answers from S${settlement} (${String(tag_sha).slice(0, 12)}); S${newestN} is blessed but its law is not ingested yet`
      : null,
  };
}

/** The class names law knows — world-classes § classRoster's ROSTER_SQL. */
export const rosterOf = (snap) => new Set(snap.classes.keys());

/** A class's frontmatter `dials` object — world-classes § classDials. */
export function dialsOf(snap, name) {
  const d = snap.classes.get(String(name))?.dials;
  const v = typeof d === "string" ? (() => { try { return JSON.parse(d); } catch { return null; } })() : d;
  const old = (v && typeof v === "object" && !Array.isArray(v)) ? v : {};
  // PROPERTY FIRST (LOGOS v2, W1 G3/G5): the class's own top-level property
  // nodes, each named by its dial's key, over the old frontmatter.
  const props = {};
  for (const [n, p] of snap.properties?.get(String(name)) ?? []) if (p.parent == null && p.default !== undefined && p.id != null) props[n] = p.default;
  return Object.keys(props).length ? { ...old, ...props } : old;
}

/** A class's predicate children as `slot -> value` — world-classes § classPredicates. */
export function predicatesOf(snap, name) {
  const out = {};
  for (const [slot, p] of snap.predicates.get(String(name)) ?? []) out[slot] = p.value;
  return out;
}

/** A class's own property nodes as `name -> {default, tier, id, children}` — world-classes § classOwnProperties. */
export function propertiesOf(snap, name) {
  const out = {};
  for (const [n, p] of snap.properties?.get(String(name)) ?? []) {
    const children = {};
    for (const [c, v] of p.children ?? []) children[c] = { ...v };
    out[n] = { default: p.default, tier: p.tier, id: p.id, parent: p.parent ?? null, children };
  }
  return out;
}

/**
 * A property as a class reads it, over ONE snapshot: the nearest class in its
 * lineage that states it, property node first, predicate child second, dial
 * third — world-classes § classProperty, pure, for a reader holding one
 * snapshot (the unit door's class view). Child bounds are read nearest first.
 */
export function snapProperty(snap, className, prop) {
  const line = [];
  for (let at = className == null ? "" : String(className); at && !line.includes(at) && line.length < 32;) {
    line.push(at);
    const up = snap?.classes?.get(at)?.extends;
    at = up == null ? "" : String(up);
  }
  let found = null;
  for (const c of line) {
    const own = snap?.properties?.get(c)?.get(String(prop));
    if (own) { found = { value: own.default, tier: own.tier, from: c, source: "property", id: own.id, children: {} }; break; }
    const pred = snap?.predicates?.get(c)?.get(String(prop));
    if (pred) { found = { value: pred.value, tier: null, from: c, source: "predicate", id: pred.id, children: {} }; break; }
    const dial = dialsOf(snap, c)[prop];
    if (dial !== undefined) { found = { value: dial, tier: null, from: c, source: "dial", id: null, children: {} }; break; }
  }
  if (!found) return null;
  for (const c of line) {
    for (const [k, v] of snap?.properties?.get(c)?.get(String(prop))?.children ?? []) if (!(k in found.children)) found.children[k] = { value: v.default, tier: v.tier, from: c, id: v.id };
  }
  return found;
}

/** Where a class's slot lives, as the record spells it — world-classes § dialNode. */
export function predicateNodeOf(snap, name, slot) {
  return snap.predicates.get(String(name))?.get(String(slot))?.id ?? null;
}
