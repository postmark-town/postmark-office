// door-class.mjs — A DOOR IS THE TOWN'S: THE OFFICE HALF OF THE DOOR CLASS (POS-1238; WLD-253, CORE-129 layer 1).
//
// RULED (Darko, 2026-11-25): "the first layer we need to implement is the enforcement, which means whatever rule that we
// forgot to include that makes doors not instantiable by default by residents, we need to build first." The World made
// `door` a class of its own (World #444, b775f797): a sibling of thing under sited, `makers: false` for making AND for
// amending, and `into`, `lands_at` and `requires` declared on door alone. The office's cut (Wright, POS-1238): "the class
// gate does the work"; "they refuse into, lands_at and requires on any other class, by name"; "an ordinary amend of any
// mark never deletes or rewrites a door's fields"; "explain names door as the town's". And: "No new carrier in layer 1:
// refuse destination writes by name, and preserve an existing entry on amendment, with no new write surface for the
// welcome words."
//
// THE VERDICT IS THE WORLD'S, WHOLE (tools/door-law.mjs § doorWriteVerdict): the actual writer, the WHOLE record before
// and the WHOLE record after, and the class graph, so a subclass of door is a door and a town subclass that loosens
// makers is honoured by the World's own `mayMake`. The office keeps no second predicate, no field list and no copy of
// the 44: it reads the module through the World's own tool loader at the freshest main, as admin-role.mjs reads
// admin-makers.mjs. `doorStanding` is not asked here: it says whether a RECORD may stand and pass, never who may write
// it, so being one of the 44 grants no write.
//
// THE GRAPH is the office's own class layer (world-classes.mjs: the law at the newest blessing, else the world graph
// snapshot), the one the makers gate beside this already reads, handed to the World's verdict in the shape its class
// index takes (`byName`, `propsUnder`). A layer standing on its floor is no graph.
//
// `allowed: null` IS UNREAD, NEVER A YES. The World answers null when the writer is not a handle, or when the graph does
// not declare door or a record's class. A write that touches a door (a door field sent in any spelling, or a record that
// is a door by name or carries a door field) is then refused, and says the law could not be read. A write that touches
// none of that is not the door law's to judge, so its null stops nothing: until the blessing carries the door class
// every graph lacks it, and refusing every mark in the town over that would be a door outage, not a door rule.
//
// THE TOWN is the trusted operator acting as the town (mark-repair.mjs § `as: "town"`), never a `by` a caller sends and
// never a key (town-stance.mjs § AS_TOWN). A resident whose handle spells the town is judged as that resident.
//
// THE REGISTRY is not handed in. The World's `mayMake` consults it only for WLD-21's three admin classes, exactly
// (dungeon, stairs and portal-ground, never a subclass: G2), and door is none of them, so for every door verdict its
// answer is the same with or without one. Passing none adds no authority.

import { TOWN } from "./town-stance.mjs";
import { markClassOf } from "./world-grants.mjs"; // the office's one reader of a record's class, in either form (LOGOS v2, O1)

/** The World's door-law module, at the freshest main; null when the world does not carry it yet. */
export async function doorLaw() {
  try { return await (await import("./dynamic-entities.mjs")).worldToolModule("door-law.mjs"); }
  catch { return null; }
}

const isObject = (v) => v != null && typeof v === "object" && !Array.isArray(v);

/**
 * The office's class layer as the World's class index (`class-properties.mjs § classIndex`'s shape): each class node by
 * name, each property node under the node it belongs to. PURE over the three readers; null when the layer stands on its
 * floor (no record was read, so there is no graph to judge by).
 */
export function doorClassGraph({ roster, source, extendsOf, ownProperties }) {
  if (source === "floor" || !roster?.size) return null;
  const byName = new Map();
  const propsUnder = new Map();
  const put = (under, node) => { if (!propsUnder.has(under)) propsUnder.set(under, []); propsUnder.get(under).push(node); };
  for (const name of roster) {
    const id = `the-town/class:${name}`;
    const up = extendsOf(name);
    byName.set(String(name), { id, kind: "class", by: TOWN, class: String(name), ...(up == null ? {} : { extends: String(up) }) });
    const own = ownProperties(name) ?? {};
    const idOf = new Map(Object.entries(own).map(([n, p]) => [p.path ?? n, p.id ?? `${id}/${p.path ?? n}`]));
    for (const [n, p] of Object.entries(own))
      put(p.parent == null ? id : idOf.get(p.parent) ?? id, { id: idOf.get(p.path ?? n), kind: "property", name: n, default: p.default, tier: p.tier ?? null });
  }
  return { byName, propsUnder };
}

/** The class graph from the office's own class layer, as the makers gate reads it. */
export async function officeDoorGraph() {
  const { classRoster, classExtendsOf, classOwnProperties } = await import("./world-classes.mjs");
  const { roster, source } = classRoster();
  return doorClassGraph({ roster, source, extendsOf: classExtendsOf(), ownProperties: classOwnProperties });
}

/**
 * THE RECORD THE CALLER ASKED FOR, WHOLE, before any field is picked: the record as it stands (`before`, for an amend) with
 * the class this write names and every door field it sends, in the spelling and the place it sent it. The leave door
 * carries a class's own named fields and its declared properties and drops the rest, so a door field must be judged here,
 * from the payload, or the filter would hide an attempted write behind a quiet drop. A sent `entry`'s door fields stay
 * inside `entry` (the old carrier, which the World refuses by name); what else a sent entry says is not this door's to
 * write (no welcome carrier, layer 1), so it is neither judged nor written.
 */
export function askedRecord({ payload, before = null, klass, kind, id, by, law }) {
  const after = { ...(isObject(before) ? before : {}), id, by: before?.by ?? by };
  delete after.class;
  if (klass !== undefined) { after.kind = kind; after.class = String(klass); }
  else after.kind = kind;
  const door = (obj) => (isObject(obj) ? law.doorFieldWrites(obj).filter((w) => w.where === "flat").map((w) => w.key) : []);
  for (const k of door(payload)) after[k] = payload[k];
  const props = isObject(payload.properties) ? payload.properties : null;
  if (props) for (const k of door(props)) after[k] = props[k];
  for (const sent of [payload.entry, props?.entry]) {
    const keys = door(sent);
    if (keys.length) after.entry = { ...(isObject(after.entry) ? after.entry : {}), ...Object.fromEntries(keys.map((k) => [k, sent[k]])) };
  }
  return after;
}

// what an unread law can still see: whether a write names the door at all. The World's spellings are the law's to know;
// these are only enough to refuse in the strict direction when the law itself cannot be read.
const UNREAD_NAMES = /^(into|lands[_-]?at|requires)$/i;
const touchesDoorUnread = (payload, before) => {
  const named = (o) => isObject(o) && Object.keys(o).some((k) => UNREAD_NAMES.test(k));
  return named(payload) || named(payload?.properties) || named(payload?.entry) || named(payload?.properties?.entry)
    || named(before) || named(before?.entry) || [payload?.kind, payload?.class, before?.kind, before?.class].some((k) => String(k ?? "") === "door");
};

/** The refusal's hint, one sentence for every door the verdict refuses. */
const DOOR_HINT = "a door is the town's to make and to change: where it leads (into), where it sets you down (lands_at) and what it asks to hold first (requires) are door's alone, and no other class carries them. Moving or withdrawing your own door stays yours. world { explain: \"door\" } says so. Nothing was written.";

/**
 * IS THIS CLASS PROVABLY NO DOOR, by the graph alone? Its chain is walked up `extends` to the root, and it is no door only
 * when every class on the way is declared and none is door (`law.isDoorClass` decides when the law is read; with no law,
 * the name the law gives its class). A class the graph does not declare, or a chain that dangles, is not proved: it may
 * be a door's subclass. This decides only what an UNREAD answer may let pass; it grants nothing.
 */
function provedNoDoor(klass, graph, law) {
  if (klass == null) return true;
  if (!graph?.byName) return false;
  const seen = new Set();
  for (let c = graph.byName.get(String(klass)); ; c = graph.byName.get(String(c.extends))) {
    if (!c || seen.has(c.class)) return false;                       // undeclared, or a cycle: not proved
    seen.add(c.class);
    const door = typeof law?.isDoorClass === "function" ? law.isDoorClass(c.class) : String(c.class) === "door";
    if (door) return false;
    if (c.extends == null) return true;                              // the root, reached with no door on the way
  }
}

/**
 * Why this leave or amend may not be written, or null; and whether this is an amend of a door INTO THE SAME door class with
 * every door field as it was (`doorAmend`), the one write the makers gate then does not refuse.
 *   `payload` what the caller sent · `before` the whole record as it stands (null for a new mark) · `klass`/`kind` as the door
 *   resolved them · `id`/`by` the mark's · `town` true only for the operator acting as the town.
 * Returns `{ refusal: { code, defect, hint } | null, doorAmend: boolean, verdict }`.
 *
 * TWO THINGS THE WORLD'S `no-door-change` IS NOT. It is also the World's answer for a door that leaves the door class when
 * both classes may be made by this writer, so it is no permission for the target class: the makers gate still judges
 * that one. And an UNREAD answer about a record that HAD a class is not a question the target's own gates can answer:
 * they read the class the write names, and an amend that names none, or another, would drop the old class without
 * anyone asking whether it was a door's. So an unread answer refuses that transition unless the graph proves the old
 * class is no door; a known non-door write, and a write that keeps its class, are left exactly as before.
 */
export async function doorWriteRefusal({ payload, before = null, klass, kind, id, by, town = false, law: given, graph: givenGraph } = {}) {
  const law = given === undefined ? await doorLaw() : given;
  const unread = (why, instead = "leave the mark without into, lands_at or requires") => ({
    refusal: { code: 503, defect: "the town's door law could not be read, so this door cannot tell whether the write changes a door",
      hint: `${why}. A door is the town's to make and to change, and an unread law is never a yes. Nothing was written; try again shortly, or ${instead}.` },
    doorAmend: false, verdict: null });
  const KEEP_CLASS = "amend it keeping the class it has";
  // the record's class leaves: an amend of a classed record naming no class, or another one. Both sides are read by the one
  // resolver, so a parcel amended as a parcel (a standing kind the leave door keeps as `kind`) keeps its class
  const beforeClass = before == null ? null : markClassOf(before);
  const afterClass = klass !== undefined ? String(klass) : markClassOf({ kind });
  const leaves = beforeClass != null && afterClass !== beforeClass;
  const graphFor = async () => (givenGraph === undefined ? officeDoorGraph() : givenGraph);
  if (typeof law?.doorWriteVerdict !== "function" || typeof law?.doorFieldWrites !== "function") {
    if (touchesDoorUnread(payload, before)) return unread("the World's door law (tools/door-law.mjs) is not readable here");
    if (leaves && !provedNoDoor(beforeClass, await graphFor(), null))
      return unread(`${id} is a ${beforeClass}, and the World's door law (tools/door-law.mjs) is not readable here to say whether that class is a door's`, KEEP_CLASS);
    return { refusal: null, doorAmend: false, verdict: null };
  }
  const after = askedRecord({ payload, before, klass, kind, id, by, law });
  const graph = await graphFor();
  // the town is the operator acting as the town and no one else: a handle that spells it is a resident's
  const actor = town === true ? TOWN : by === TOWN ? `${TOWN} (a resident, not acting as the town)` : by;
  const verdict = law.doorWriteVerdict({ by: actor, before, after, marks: graph });
  if (verdict?.allowed === true) {
    // the exemption is a door amended into its own door class with its door fields as they were, and nothing wider
    const sameDoor = before != null && !leaves && law.isDoorMark(before, graph) && law.isDoorMark(after, graph);
    return { refusal: null, doorAmend: verdict.why === "no-door-change" && sameDoor, verdict };
  }
  if (verdict?.allowed === false)
    return { refusal: { code: 422, defect: verdict.words, hint: DOOR_HINT }, doorAmend: false, verdict };
  // null: unread. It stops a write that touches a door, and an amend that drops a class the graph cannot prove is no door's.
  const why = verdict?.why === "classes-unread"
    ? `the class layer does not declare ${(verdict.classes ?? []).join(" or ")} yet (the door class arrives with the blessing that carries World #444)`
    : "the writer could not be read as a resident";
  const touches = law.doorFieldWrites(after).length > 0 || (before != null && law.doorFieldWrites(before).length > 0)
    || [after, before].some((r) => r != null && String(r.class ?? r.kind ?? "") === law.DOOR_CLASS);
  if (touches) return unread(why);
  if (leaves && !provedNoDoor(beforeClass, graph, law)) return unread(`${id} is a ${beforeClass}, which may be a door's subclass, and ${why}`, KEEP_CLASS);
  return { refusal: null, doorAmend: false, verdict };
}

/**
 * WHAT AN AMEND KEEPS: the record's `entry`, and each door field it carries, wherever the amend sends none. This door has
 * no road to write either (the welcome words have no carrier in layer 1, and a door's fields are the town's), so an amend
 * that superseded the whole record used to delete them: a door lost where it leads to new words on its card. `doorFields`
 * is the World's DOOR_FIELDS when its law is read; the record's own spellings of them are kept as they are.
 */
export function keptDoorFields(sent, prior, { law = null } = {}) {
  if (!isObject(prior)) return {};
  const out = {};
  if (prior.entry !== undefined && sent?.entry === undefined) out.entry = prior.entry;
  const keys = typeof law?.doorFieldWrites === "function"
    ? law.doorFieldWrites(prior).filter((w) => w.where === "flat").map((w) => w.key)
    : Object.keys(prior).filter((k) => UNREAD_NAMES.test(k));
  for (const k of keys) if (sent?.[k] === undefined) out[k] = prior[k];
  return out;
}

/** explain's `makers` for door and every class that extends it: the town's, for making and for amending (WLD-253). */
export async function withDoorMakers(answer, { law: given, graph: givenGraph } = {}) {
  if (!answer?.explains || !answer?.makers) return answer;
  const law = given === undefined ? await doorLaw() : given;
  if (typeof law?.isDoorClass !== "function") return answer;
  const graph = givenGraph === undefined ? await officeDoorGraph() : givenGraph;
  if (!law.isDoorClass(answer.explains, graph)) return answer;
  return { ...answer, makers: { ...answer.makers,
    who: `false: the town's, for making and for amending. A door's into, lands_at and requires are door's alone, and only the town writes them; moving or withdrawing a door stays its maker's (the-town/door, WLD-253)` } };
}
