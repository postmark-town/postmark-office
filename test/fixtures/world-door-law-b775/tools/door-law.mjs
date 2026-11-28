// door-law.mjs — DOORS ARE THE TOWN'S: DOOR IS A CLASS (WLD-253; CORE-129 layer 1, ruled 2026-11-25). One definition, read by the lint, the
// gate's board grammar, the passage (enter-exit.mjs § entryLawOf, world-verbs.mjs § enterThroughPortal, portals.mjs § landingOf) and the
// office's leave-mark and amend (POS-1238, through the engine at the blessed ref).
//
// RULED (Darko, 2026-11-25): "the first layer we need to implement is the enforcement, which means whatever rule that we forgot to include that
// makes doors not instantiable by default by residents, we need to build first. And then if we want doors to be instantiable, we need to also then
// implement the specific allowance under governance for why this is allowed, instead of just blanket allowing." The shape, from the sitting
// ("does the shape seem pretty clear to you? If it does, I think I'm fine to just try implementing it"; "we need to implement is an override rule
// … explicitly setting the override version of that property on the subclass"), LOGOS/classes.md § The door:
//   · `the-town/door` is a class under sited, a sibling of thing, and answers makers: false. makers governs AMENDING as well as making: a
//     resident may neither create a door nor change a door's door fields. Moving or withdrawing the mark stays its maker's.
//   · `into`, `lands_at` and `requires` are declared on door alone, as a door's own flat fields. Any other class carrying them, or a door
//     carrying them inside `entry` (where they rode before), is refused. `entry` keeps how a mark is received: its word and its terms.
//   · The 44 doors that stood are re-kinded to door by the town, keeping every value and their makers (3 little-bird, 41 wright). That act is
//     their grandfathering, named here the way the gate names every exception by ruling: by exact id, never by prefix, author or date.
//   · thing declares `entry: none`, locked (the override rule's first use: the nearest declaration wins, and only the town's subclass may
//     loosen it), so a thing has no way in.
// THE TOWN'S ACT (WLD-253/town-act, Darko 2026-11-25, "yes to bevel's open question"): a World PR merged by a founder is the town's act. A tree
// has no writer to ask, so the lint and the passage read what the record says (its class, its fields, its `by`, its id); who wrote it is the
// office's question, `doorWriteVerdict`, where the writer and the record before are known.

import { classChain, classIndex, propertyOf } from "./class-properties.mjs";
import { instanceClassOf } from "./mark-kind.mjs";
import { mayMake } from "./admin-makers.mjs";

/** The class every door is, or extends. */
export const DOOR_CLASS = "door";
/** The fields declared on door alone: where it leads, where you land, and what it asks to hold first. */
export const DOOR_FIELDS = Object.freeze(["into", "lands_at", "requires"]);
/** thing's locked `entry` (the-town/thing-entry): a thing has no way in. */
export const NO_WAY_IN = "none";
const TOWN = "the-town";
// every spelling a writer may try for each door field: case, and `-` or no separator in `lands_at`. Any of them is the field, wherever it rides.
const SPELLINGS = Object.freeze({ into: /^into$/i, lands_at: /^lands[_-]?at$/i, requires: /^requires$/i });

/** THE 44 THE TOWN RE-KINDED (2026-11-25): the explicit doors that stood at World main ce368dbb903bbf2da8da4578eecdf1666c0742bd (its committed
 *  fold and its raw records agree), Little Bird's three (world #416, #427, #434) and the Starforge Spire's 41, each now `kind: door` with its
 *  maker kept. An exception by ruling, by exact id: the set grows only by another ruling, never by drift. */
export const REKINDED_DOORS = Object.freeze([
  "little-bird/a-paper-bag-of-crumbs",
  "little-bird/a-ring-in-the-pantry",
  "little-bird/a-ring-of-black-stone",
  "wright/spire-blue-room-to-north-walk",
  "wright/spire-cold-landing-to-hall-of-keepers",
  "wright/spire-dining-hall-to-guests-walk",
  "wright/spire-dining-hall-to-mirror-room",
  "wright/spire-gilded-doors",
  "wright/spire-gilded-doors-inside",
  "wright/spire-gilded-vestibule-to-rose-hall",
  "wright/spire-guests-walk-to-dining-hall",
  "wright/spire-guests-walk-to-little-stair",
  "wright/spire-guests-walk-to-rose-hall",
  "wright/spire-hall-of-keepers-to-cold-landing",
  "wright/spire-hall-of-keepers-to-rose-hall",
  "wright/spire-hall-of-keepers-to-star-chapel",
  "wright/spire-little-stair-to-guests-walk",
  "wright/spire-lumber-room-to-register-room",
  "wright/spire-mirror-room-to-dining-hall",
  "wright/spire-mirror-room-to-south-walk",
  "wright/spire-north-arch-to-star-chapel",
  "wright/spire-north-turret-to-north-walk",
  "wright/spire-north-walk-to-blue-room",
  "wright/spire-north-walk-to-north-turret",
  "wright/spire-red-stair-hall-to-rose-hall",
  "wright/spire-register-room-to-lumber-room",
  "wright/spire-rose-hall-to-gilded-vestibule",
  "wright/spire-rose-hall-to-guests-walk",
  "wright/spire-rose-hall-to-hall-of-keepers",
  "wright/spire-rose-hall-to-red-stair-hall",
  "wright/spire-round-court-to-south-walk",
  "wright/spire-servants-door",
  "wright/spire-servants-door-inside",
  "wright/spire-south-arch-to-star-chapel",
  "wright/spire-south-arch-to-well-stair",
  "wright/spire-south-turret-to-south-walk",
  "wright/spire-south-walk-to-mirror-room",
  "wright/spire-south-walk-to-round-court",
  "wright/spire-south-walk-to-south-turret",
  "wright/spire-star-chapel-to-hall-of-keepers",
  "wright/spire-star-chapel-to-north-arch",
  "wright/spire-star-chapel-to-south-arch",
  "wright/spire-well-stair-to-south-arch",
  "wright/the-starforge-spire",
]);
const REKINDED = new Set(REKINDED_DOORS);
export const isRekindedDoor = (id) => REKINDED.has(id);

/** Is class `klass` door, or a class that extends it? `marks` (records or a class index) answers for a subclass; without it, only `door`. */
export function isDoorClass(klass, marks = null) {
  if (klass == null) return false;
  if (String(klass) === DOOR_CLASS) return true;
  return !!marks && classChain(marks, String(klass)).some((c) => String(c.class) === DOOR_CLASS);
}
/** Is this record an instance of door (or of a class extending it)? */
export const isDoorMark = (mark, marks = null) => isDoorClass(instanceClassOf(mark), marks);

/** Does class `klass` say it has no way in (its effective `entry` is the locked `none`: thing, and what extends it unless the town's subclass
 *  loosens it)? Read from the class graph in `marks`; a graph that does not declare the class cannot answer, and says no. */
export function classHasNoWayIn(klass, marks) {
  if (klass == null || !marks) return false;
  return String(propertyOf(marks, String(klass), "entry")?.value) === NO_WAY_IN;
}

// a door field's value in one comparable spelling: `into` a list (a string is a list of one), an object's keys in order
const canon = (v) => (Array.isArray(v) ? v.map(canon) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);
const valueOf = (field, v) => JSON.stringify(canon(field === "into" && typeof v === "string" ? [v] : v === undefined ? null : v));

/**
 * EVERY place a record writes a door field, by PRESENCE and in any recognised spelling: `[{ field, key, where, value }]`, flat fields first,
 * then those riding inside `entry` (`where: "entry"`, the old carrier). null, "" and [] are written (a removal written as a value is still a
 * write). Nothing is folded together or dropped, so two spellings of one field are two writes, and a write that adds, re-spells, moves or
 * re-values any one of them is seen (the alias lesson of 2026-11-25 19:33Z).
 */
export function doorFieldWrites(mark) {
  const out = [];
  const scan = (obj, where) => {
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return;
    for (const [key, value] of Object.entries(obj)) {
      if (value === undefined) continue; // no record carries undefined (a written null does count)
      for (const field of DOOR_FIELDS) if (SPELLINGS[field].test(key)) out.push({ field, key, where, value: valueOf(field, value) });
    }
  };
  scan(mark, "flat");
  scan(mark?.entry, "entry");
  return out;
}

// a write as its literal field name: `into`, `entry.into`, `Into`
const nameOf = (w) => (w.where === "entry" ? `entry.${w.key}` : w.key);
const uniq = (xs) => [...new Set(xs)];
const listOf = (xs) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);
// the writes that are not a door's own field as declared: riding in entry, misspelled, or written twice
const oddWrites = (writes) => writes.filter((w, i) => w.where === "entry" || w.key !== w.field || writes.findIndex((x) => x.field === w.field) !== i);

/** The one sentence a refusal ends with, with the literal field names (the office's refusal and the passage both quote it). */
export const DOOR_LAW = "into, lands_at and requires are door's alone, and door answers makers: false for making and for amending: a door is the town's, or one of the 44 the town re-kinded (the-town/door, WLD-253)";

/**
 * MAY THIS RECORD STAND, as it is written now? `{ door, allowed, why, fields?, klass? }`:
 *   not-a-door      no door field, and not a door
 *   town            a door the town made
 *   rekinded        one of the 44 the town re-kinded, by name
 *   fields-off-door a class other than door writes a door field (`fields` names them, as written)
 *   field-spelling  a door writes a door field inside `entry`, misspelled, or twice (`fields` names them)
 *   makers          a door no rule allows: door answers makers: false
 * `marks` (records or a class index) lets a subclass of door count as door. This reads the record only: it is no permission to write.
 */
export function doorStanding(mark, { marks = null } = {}) {
  const klass = instanceClassOf(mark) ?? null;
  const door = isDoorClass(klass, marks);
  const writes = doorFieldWrites(mark);
  if (!door && !writes.length) return { door: false, allowed: true, why: "not-a-door" };
  if (!door) return { door: false, allowed: false, why: "fields-off-door", fields: uniq(writes.map(nameOf)), klass };
  const odd = oddWrites(writes);
  if (odd.length) return { door: true, allowed: false, why: "field-spelling", fields: uniq(odd.map(nameOf)) };
  if (mark?.by === TOWN) return { door: true, allowed: true, why: "town" };
  if (isRekindedDoor(mark?.id)) return { door: true, allowed: true, why: "rekinded" };
  return { door: true, allowed: false, why: "makers" };
}

/** The refusal for a record that may not stand, in words with the literal field names, or null. */
export function doorRefusal(mark, opts = {}) {
  const s = doorStanding(mark, opts);
  if (s.allowed) return null;
  const id = mark?.id ?? "this mark";
  const words = {
    "fields-off-door": () => `${id} writes ${listOf(s.fields)}, and it is ${s.klass ? `a ${s.klass}` : "no class's instance"}, not a door`,
    "field-spelling": () => `${id} writes ${listOf(s.fields)}: a door writes into:, lands_at: and requires: as its own fields, once each, never inside entry`,
    makers: () => `${id} is a door, and it is not the town's or one of the 44 the town re-kinded`,
  }[s.why]();
  return { why: s.why, fields: s.fields ?? [], words: `${words} — ${DOOR_LAW}` };
}

/**
 * MAY THIS WRITE BE MADE (the office's leave-mark and amend, POS-1238)? Actor `by` writes the record `after` over the record `before` (whole
 * records, as the office would store them; `before` null for a new mark, `after` null for a withdrawal). `marks` is the World tree the classes
 * are read from (records or a class index); `registry` is the household registry admin-makers reads (WORLD/households.json).
 *   actor-unread     `by` is not a handle: `allowed: null`, and a null is never a yes
 *   withdraw         `after` null: moving and withdrawing stay the maker's (who may withdraw is the office's own rule)
 *   classes-unread   no class graph in `marks`, one that does not declare door, or a record whose class it does not declare
 *                    (`classes` names them): `allowed: null`. Whether a record is a door is the graph's answer (a town subclass of
 *                    door is a door), so a write the graph cannot place is never judged as no door; a null is never a yes
 *   fields-off-door  `after` writes a door field on a class other than door (any writer)
 *   field-spelling   `after` is a door writing a door field inside entry, misspelled or twice (any writer)
 *   town             the town may make and amend doors
 *   makers           door answers makers: false for this writer: creating a door, making a mark a door or no longer one, or changing,
 *                    adding, re-spelling or removing any door field (`changed` names them) is refused, on one of the 44 too
 *   no-door-change   a door amended with every door field as it was (its words, its place): allowed
 *   not-a-door       neither record is a door, and `after` writes no door field
 * `{ allowed: true|false|null, why, changed?, words? }`. Being one of the 44, or holding WLD-21's admin classes, grants no write.
 */
export function doorWriteVerdict({ by = null, before = null, after = null, marks = null, registry = null } = {}) {
  if (typeof by !== "string" || by === "") return { allowed: null, why: "actor-unread" };
  if (after == null) return { allowed: true, why: "withdraw" };
  const refuse = (why, changed, words) => ({ allowed: false, why, ...(changed ? { changed } : {}), words: `${words} — ${DOOR_LAW}` });
  const afterKlass = instanceClassOf(after) ?? null, beforeKlass = before ? instanceClassOf(before) ?? null : null;
  // FAIL CLOSED on the class graph: a create or amend is judged only where the graph can say what each record is
  const idx = marks && marks.byName && marks.propsUnder ? marks : marks ? classIndex(marks) : null;
  if (!idx || !idx.byName.has(DOOR_CLASS)) return { allowed: null, why: "classes-unread", classes: [DOOR_CLASS] };
  const unread = uniq([afterKlass, beforeKlass].filter((k) => k != null && !idx.byName.has(String(k))));
  if (unread.length) return { allowed: null, why: "classes-unread", classes: unread };
  marks = idx;
  const afterDoor = isDoorClass(afterKlass, marks), beforeDoor = before ? isDoorClass(beforeKlass, marks) : false;
  const writes = doorFieldWrites(after);
  if (!afterDoor && writes.length)
    return refuse("fields-off-door", uniq(writes.map(nameOf)), `${listOf(uniq(writes.map(nameOf)))} on ${afterKlass ? `a ${afterKlass}` : "a mark of no class"}`);
  const odd = afterDoor ? oddWrites(writes) : [];
  if (odd.length) return refuse("field-spelling", uniq(odd.map(nameOf)), `${listOf(uniq(odd.map(nameOf)))}: a door writes into:, lands_at: and requires: as its own fields, once each`);
  if (by === TOWN) return { allowed: true, why: "town" };
  if (!afterDoor && !beforeDoor) return { allowed: true, why: "not-a-door" };
  const may = (klass) => mayMake({ klass, by, marks, registry }).may;
  if (afterDoor && !beforeDoor && !may(afterKlass)) return refuse("makers", [...DOOR_FIELDS], before ? `making ${before.id ?? "a mark"} a door` : "a new door");
  if (beforeDoor && !afterDoor && !may(beforeKlass)) return refuse("makers", [...DOOR_FIELDS], `${before.id ?? "a door"} made no longer a door`);
  if (beforeDoor && afterDoor) {
    const key = (w) => `${w.where}:${w.key}`;
    const was = new Map(doorFieldWrites(before).map((w) => [key(w), w])), now = new Map(writes.map((w) => [key(w), w]));
    const changed = uniq([...was.keys(), ...now.keys()].filter((k) => was.get(k)?.value !== now.get(k)?.value).map((k) => (was.get(k) ?? now.get(k)).field));
    const changedClass = afterKlass !== beforeKlass;
    if ((changed.length || changedClass) && !(may(afterKlass) && may(beforeKlass)))
      return refuse("makers", changed.length ? DOOR_FIELDS.filter((f) => changed.includes(f)) : [...DOOR_FIELDS], changed.length ? `${listOf(DOOR_FIELDS.filter((f) => changed.includes(f)))} of ${before.id ?? "a door"}` : `${before.id ?? "a door"}'s class`);
    return { allowed: true, why: "no-door-change" };
  }
  return { allowed: true, why: "no-door-change" };
}

/** The doors among `marks` that stand, by id: what the passage honors (the town's, and the 44 by name). The dry run's list. */
export function allowedDoors(marks) {
  const live = (marks ?? []).filter((m) => m && !m._error);
  const idx = classIndex(live);
  return live.filter((m) => { const s = doorStanding(m, { marks: idx }); return s.door && s.allowed; }).map((m) => m.id).sort();
}
