// registry-public.mjs — the household registry as a PUBLIC read may show it (POS-394, POS-726).
//
// RULED (Darko, 2026-10-05): household and resident pages print the household's
// display name, NEVER the private human name. Wright, 2026-10-12, on the same
// issue: the office's public /households, and any public read that carries a
// registry row, omit `human` first.
//
// RULED (Darko's picker answer, POS-845, 2026-11-03 05:53Z): the public line is a
// "Named list". Wright's hand-back on POS-726: only fields named public are
// sent; a new field is private until named. So since POS-726 this file is an
// ALLOWLIST: every level of the public answer carries the keys named below and
// nothing else, where until then it copied everything except `human`.
//
// So a registry row has two faces. The PRIVATE one is the store's: `human` stays
// in the rows, the fold (`registryFromRows`), the private render
// (`renderRegistry`, the round trip), the ceremonies that write it and the
// deriver that resolves a house by it. This file is the PUBLIC one. GET
// /households uses it (src/households-read.mjs), and so does the drain that
// prints the town's files (`renderPublicRegistry`): the printout in the town
// repo is public, so it is cut the same way.
//
// ── THE NAMED LIST, AND WHY IT IS WRITTEN OUT HERE ──────────────────────────
//
// Each level is cut to the keys named for it, in the record's own order. A key
// that is not named does not ride, whatever it holds and however it reached the
// record. The lists are spelled out by hand on purpose: registry-rows.mjs's
// HOUSEHOLD_KEYS, PIN_KEYS and nested templates are the FILE'S GRAMMAR, what the
// store can hold and the private render must print. Grammar is not permission.
// A column added there for a private fact must not turn public by itself, so
// nothing below is derived from those templates; a field joins the public
// answer when someone names it here.
//
// WHAT A NAMED FIELD MAY HOLD. Naming a key is not naming whatever is put under
// it: the fold hands a named column's value over as it arrived
// (registry-rows.mjs § registryFromRows, § pinsFromRows). So every named field
// carries a single value (a string, number, boolean or null), or a list of
// them where the column is a list (`residents`, `formerly`), or its declared
// shape below. Anything else under a named key has no named shape, so the
// field is left out. Today's columns (text, text[], bigint, boolean: 019 and
// its successors) only ever hold those.
//
// THE JSONB COLUMNS. `accounts`, `home_images`, `likeness` and `invited_by` are
// jsonb, which accepts any shape, and the private render keeps a key their
// template does not name (registry-rows.mjs § orderNested) rather than lose it.
// So here each is cut to its declared shape, and what does not fit it is left
// out (POS-726's FIX round, 2026-11-03):
//   - `accounts` is a list of account objects (019). Each object, in the list's
//     own order, is cut to `login` and `id`; an element that is not an object
//     is no account, and a value that is not a list carries none.
//   - `home_images` is what its one writer writes (registry-store.mjs §
//     setHomeImage: a resident's handle -> URL text, on the house that holds
//     that resident) and its reader reads (registry-rows.mjs § homePictureIn).
//     So a handle rides only while it is one of THIS house's `residents`, and
//     only with a non-empty string: a picture left behind when its resident
//     moved house reads as none there and is not shown here, and a number,
//     boolean, null, list or object under a handle is no URL. The URL itself is
//     not judged here; the writer and every door that draws it judge it. A map
//     left with no picture is no key, as the fold renders an empty one
//     (registry-rows.mjs § EMPTY_MAP_KEYS).
//   - `likeness` and `invited_by` are cut as before: an object to its named
//     keys, each holding a single value (a list is walked, and a single value
//     passes as it is).
// A pin is cut to its named keys, each holding a single value.
//
// A HOUSE OR A PIN THAT IS NOT AN OBJECT has no named shape, so nothing of it
// rides: it reads as null. The fold only ever builds objects, so this changes
// no printed byte; it keeps these functions from passing a list or a value
// through whole.
//
// It copies; it never mutates. The objects handed in are the private record's
// (a caller may hold them, a memo may share them), so a projection that deleted
// a key in place would take it out of the PRIVATE answer too.

/** The one key POS-394 named private. Since POS-726 the cut is the named list below, so a key on neither list is private too. */
export const PRIVATE_HOUSE_KEYS = Object.freeze(["human"]);

const PUBLIC_REGISTRY_KEYS = Object.freeze(["schema_version", "note", "households"]);
const PUBLIC_HOUSE_KEYS = Object.freeze([
  "name", "accounts", "residents", "since", "member_of", "declared_by", "formerly",
  "provisional", "home_images", "likeness", "invited_by",
]);
const PUBLIC_PIN_KEYS = Object.freeze(["login", "id", "pinned", "renamed", "note", "retired", "renamed_to"]);
const PUBLIC_ACCOUNT_KEYS = Object.freeze(["login", "id"]);
const PUBLIC_LIKENESS_KEYS = Object.freeze(["answer", "at", "by", "gh_id", "words"]);
const PUBLIC_INVITED_BY_KEYS = Object.freeze(["by", "named", "at"]);

// The named house keys that are jsonb and cut by `cut`, and which of an object's keys may ride in each.
// `accounts` and `home_images` have shapes of their own (`publicAccounts`, `publicHomeImages`).
const JSONB_SHAPES = Object.freeze({
  likeness: (k) => PUBLIC_LIKENESS_KEYS.includes(k),
  invited_by: (k) => PUBLIC_INVITED_BY_KEYS.includes(k),
});
const ACCOUNT_ADMITS = (k) => PUBLIC_ACCOUNT_KEYS.includes(k);
const PIN_ADMITS = (k) => PUBLIC_PIN_KEYS.includes(k);

/** A single value: nothing with keys of its own. */
const isLeaf = (v) => v === null || typeof v !== "object";
/** A single value, or a list of them (a text[] column). */
const isLeaves = (v) => isLeaf(v) || (Array.isArray(v) && v.every(isLeaf));
/** An object with keys of its own: not a single value, not a list. */
const isRecord = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/** A value cut to its declared shape: arrays walked, each object to its admitted keys holding single values. */
const cut = (v, admits) => {
  if (Array.isArray(v)) return v.map((x) => cut(x, admits));
  if (isLeaf(v)) return v;
  const out = {};
  for (const [k, x] of Object.entries(v)) if (admits(k) && isLeaf(x)) out[k] = x;
  return out;
};

/** `accounts`, a list: its objects in order, each cut to `login` and `id`; anything else in it is no account. */
const publicAccounts = (list) => list.filter(isRecord).map((a) => cut(a, ACCOUNT_ADMITS));

/** `home_images`: each of THIS house's residents' handles with its URL text, in order; undefined when none is left. */
const publicHomeImages = (v, residents) => {
  if (!isRecord(v)) return undefined;
  const members = Array.isArray(residents) ? residents : [];
  const out = {};
  for (const [handle, url] of Object.entries(v)) if (members.includes(handle) && typeof url === "string" && url) out[handle] = url;
  return Object.keys(out).length ? out : undefined;
};

/** One house row, cut to its named keys; key order kept. A house that is not an object reads as null. */
export function publicHouse(rec) {
  if (!isRecord(rec)) return null;
  const out = {};
  for (const [k, v] of Object.entries(rec)) {
    if (!PUBLIC_HOUSE_KEYS.includes(k)) continue;
    if (k === "accounts") { if (Array.isArray(v)) out[k] = publicAccounts(v); }
    else if (k === "home_images") { const pictures = publicHomeImages(v, rec.residents); if (pictures) out[k] = pictures; }
    else if (Object.hasOwn(JSONB_SHAPES, k)) out[k] = cut(v, JSONB_SHAPES[k]);
    else if (isLeaves(v)) out[k] = v;
  }
  return out;
}

/** `{ ...meta, households: { slug: rec } }` -> the named meta and every house public. A new object. */
export function publicRegistry(registry) {
  if (registry === null || typeof registry !== "object") return registry;
  const out = {};
  for (const [k, v] of Object.entries(registry)) {
    if (!PUBLIC_REGISTRY_KEYS.includes(k)) continue;
    if (k !== "households") { if (isLeaf(v)) out[k] = v; continue; }
    const houses = {};
    for (const [slug, rec] of Object.entries(v ?? {})) houses[slug] = publicHouse(rec);
    out[k] = houses;
  }
  return out;
}

/** `{ handle: pin }` -> the same handles, each pin cut to its named keys holding single values (null when it is not an object). A new object. */
export function publicPins(pins) {
  if (pins === null || typeof pins !== "object") return pins;
  const out = {};
  for (const [handle, pin] of Object.entries(pins)) out[handle] = isRecord(pin) ? cut(pin, PIN_ADMITS) : null;
  return out;
}
