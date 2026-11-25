// door-destination.mjs — A DOOR'S DESTINATION IS THE TOWN'S TO SET (POS-1238, WLD-253's office half; CORE-129 layer 1).
//
// RULED (Darko, 2026-11-25): "the first layer we need to implement is the enforcement, which means whatever rule that we
// forgot to include that makes doors not instantiable by default by residents, we need to build first. And then if we want
// doors to be instantiable, we need to also then implement the specific allowance under governance for why this is allowed,
// instead of just blanket allowing." Then: "yes, file layer 1". The office's cut (POS-1238): leave-mark and amend refuse a
// non-town `into` or `lands_at` by name, with one line, "a door's destination is the town's to set (LOGOS, WLD-253)".
//
// THE LAW IS THE WORLD'S (tools/door-law.mjs, World #444): which keys are a door's children, in every spelling a writer
// tries (`doorChildrenOf`), and whether a write changes them (`entryWriteVerdict`). It is read through the world's own tool
// loader, as admin-role.mjs reads admin-makers.mjs, so the office keeps no second predicate and no list. The 44 grandfathered
// doors are the passage's question (`doorStanding`, asked by the engine), never a write's: being grandfathered is permission
// for a door to remain, not permission to write it.
//
// EVERY ROAD A CHILD CAN ARRIVE BY (measured at f0afecb2): this door wrote no `entry` for a resident. REST and the apex
// dropped it without a word, the MCP schema refused it as an unknown field, and `properties.entry` was accepted only for a
// class that declares `entry` as its own (`mark`, town-only by makers). Each road is judged here, before anything is written:
// `entry`; a child spelled at the top level (`into`, `lands_at`, `lands-at`, …); and `properties` (its `entry`, and a child
// spelled in it). A removal is a write: `entry: null` over a door, `into: ""`, `lands_at: null`.
//
// THE TOWN is the trusted operator acting as the town (mark-repair.mjs § `as: "town"`), never a `by` a caller sends and never
// a key (town-stance.mjs § AS_TOWN). WLD-21's admin households gain nothing here: their three classes are making, not this.
// AN UNREAD LAW REFUSES (the strict direction, as admin-role's unread module answers no): a write that names entry, into or
// lands_at while the world's door law cannot be read is refused and says so; a write that names none is never asked.

import { TOWN } from "./town-stance.mjs";

/** The one-line reason, as POS-1238 rules it. */
export const DOOR_DESTINATION = "a door's destination is the town's to set (LOGOS, WLD-253)";

// ── the seam the suite sets (the world's door-law module) ───────────────────
let seam = null;
/** Tests hand in `{ doorLaw }` (a module, or null for one the world does not carry); null restores the world's own. */
export function __doorLawSeam(deps) { seam = deps; }

/** The world's door-law module, at the freshest main; null when the world does not carry it yet. */
async function doorLaw() {
  if (seam && "doorLaw" in seam) return seam.doorLaw;
  try { return await (await import("./dynamic-entities.mjs")).worldToolModule("door-law.mjs"); }
  catch { return null; }
}

const isObject = (v) => v != null && typeof v === "object" && !Array.isArray(v);
// what an unread law can still see: the canonical names (every other spelling is the law's to know)
const NAMED = Object.freeze(["entry", "into", "lands_at"]);

// THE ENTRY A SENT ONE MAKES, laid over the one standing: what it does not name is kept (as an amend keeps the whole entry
// when it sends none, `keptEntry` below), so a welcome-only entry leaves a door's children as they were. A child it names,
// in any spelling, replaces the standing one's, so a re-spelling is seen as the law sees it. An entry that is not an object
// (null, "", a word) is the whole entry gone, a removal.
function laidOver(law, before, sent) {
  if (!isObject(sent)) return null;
  if (!isObject(before)) return sent;
  const named = law.doorChildrenOf(sent);
  const kept = Object.entries(before).filter(([k, v]) => !Object.keys(law.doorChildrenOf({ [k]: v })).some((c) => named[c]));
  return { ...Object.fromEntries(kept), ...sent };
}

/**
 * Why this leave or amend may not be written, or null. `payload` is what the caller sent; `beforeOf` answers the mark's
 * `entry` as it stands (null for a new mark), asked only when an `entry` is sent; `actor` is the resident it is written as;
 * `town` is true only for the trusted operator acting as the town. Returns `{ code, defect, hint }`.
 */
export async function doorWriteRefusal({ payload, beforeOf = async () => null, actor = null, town = false } = {}) {
  if (town === true || !isObject(payload)) return null;
  const props = isObject(payload.properties) ? payload.properties : null;
  const places = [payload, props].filter(Boolean);
  const law = await doorLaw();
  if (typeof law?.doorChildrenOf !== "function" || typeof law?.entryWriteVerdict !== "function") {
    const named = NAMED.filter((k) => places.some((p) => k in p));
    return named.length ? {
      code: 503, defect: "the town's door law could not be read, so this door cannot tell whether the write sets a door's destination",
      hint: `it names ${named.join(", ")}, and ${DOOR_DESTINATION}: the office asks the world's own rule (tools/door-law.mjs), and an unread rule is never a yes. Nothing was written; try again shortly, or leave the mark without them.`,
    } : null;
  }
  const changed = new Set();
  // a child spelled where no mark keeps one (the top level, or properties): sending it at all is the write
  for (const p of places) for (const c of Object.keys(law.doorChildrenOf(p))) changed.add(c);
  // `entry` itself, judged against the entry as it stands, so a removal is a change and an unchanged door is not.
  // `by` is never the town here: `town` above is the only road to it, so a resident named the-town is judged as a resident.
  const by = actor === TOWN ? `${TOWN}, not acting as the town` : actor;
  for (const p of places) {
    if (!("entry" in p)) continue;
    const before = await beforeOf();
    const v = law.entryWriteVerdict({ by, before, after: laidOver(law, before, p.entry) });
    if (v?.allowed !== true) for (const c of v?.changed ?? law.DOOR_CHILDREN ?? ["into", "lands_at"]) changed.add(c);
  }
  if (!changed.size) return null;
  const fields = [...changed].sort().map((c) => `entry.${c}`).join(" and ");
  return {
    code: 422, defect: `${fields}: ${DOOR_DESTINATION}`,
    hint: "a door is the town's, or one of the 44 that stood before the rule, by name; where a door leads and where it sets you down are set by the town alone, and no class grant changes that. world { explain: \"mark\" } names them. Nothing was written.",
  };
}

/** The `entry` an amend keeps when it sends none: the prior record's, unchanged (a door stays a door across new words). */
export const keptEntry = (sent, prior) => (sent === undefined && prior?.entry != null ? prior.entry : undefined);
