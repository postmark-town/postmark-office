// held-place.test.mjs — POS-688 (Darko, 2026-10-18 20:58): a held thing is
// PUBLISHED BUT UNPLACED. One answer to "where is this thing" (held.mjs §
// placeOf, over the kept hold record), laid over the one world for every reader;
// the settlement prints the held state through (world2/tools/hold-through.mjs).
//
// The playground's finding this closes: after a take, `world { mark }` answered
// `focus.at` (221, 95.5) AND `focus.stands.where` (221, -352.5) in one reply, and
// the World page drew the cone as a mark of its own at its holder.
//
// ── THE CAN-FAIL FLIPS ─────────────────────────────────────────────────────
//   placeOf ignoring a cascade row                  → 2, 3, 4 red
//   placeOf laying a printed drop over canon        → 2 reds
//   unplaceHeld keeping at/extent on a held mark    → 3, 4 red
//   holdPrintout printing a POS-138-era drop        → 6 reds
//   holdPrintout unplacing a thing that frames marks → 6 reds
//   the witness stamp anchoring on a thing          → 8 reds
//   anchorCentres reading geometry only             → 9 reds
//   refuseTakeOfHeld answering a take as a give     → 10 reds
//   a reader running its own place derivation again → 11 reds

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { HELD_BY, PLACED, heldBy, placeOf, viewOf, unplaceHeld, placedMark, placedCentreOfRow, isThingMark, actIdOf } from "../src/held.mjs";
import { holdPrintout } from "../world2/tools/hold-through.mjs";
import { anchorCentres } from "../world2/tools/conversations.mjs";
import { refuseTakeOfHeld } from "../src/world-hold.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const CONE = "berthillon/cone-melon-de-charente-2026-08-25";
const coneMark = { id: CONE, kind: "thing", by: "berthillon", at: { x: 221, y: 95.5 }, extent: { w: 1, h: 1 }, body: "A paper cone." };
const take = (id, entity, act) => ({ target: id, entity, policy: "cascade", act_id: String(act), born_at: new Date(act * 1000).toISOString() });
const drop = (id, entity, act) => ({ target: id, entity, policy: "detach", act_id: String(act), born_at: new Date(act * 1000).toISOString() });
const view = ({ attachments = [], places = new Map(), from = null, through = null, placed = new Map() } = {}) =>
  viewOf({ record: { attachments, places, drops: new Map() }, from, through, placed });

test("1. one name, the world's: held_by (holder: true is a thing's own can-hold property)", async () => {
  assert.equal(HELD_BY, "held_by");
  assert.equal(heldBy({ holder: true }), null);
  const worldKind = join(ROOT, "world-clone", "tools", "mark-kind.mjs");
  const mod = existsSync(worldKind) ? await import(pathToFileURL(worldKind).href) : null;
  if (mod?.HELD_BY === undefined) return; // the pinned clone predates postmark-world's POS-688 PR; the pin moves with it
  assert.equal(mod.HELD_BY, HELD_BY, "the office's printed field is the world's");
});

test("2. THE ONE ANSWER: held, set down past the printout, printed, and the POS-138 era", () => {
  const places = new Map([[CONE, { x: 10, y: 20 }]]);
  assert.deepEqual(placeOf(CONE, view({ attachments: [take(CONE, "sb-ash", 660)] }), coneMark), { [HELD_BY]: "sb-ash" });
  assert.deepEqual(placeOf(CONE, view({ attachments: [take(CONE, "sb-ash/a-bowl", 660)] }), coneMark), { [HELD_BY]: "sb-ash/a-bowl" }, "a thing in a chest is held by the chest");
  // a drop since the last printout: where it was set down, printed at the next settlement
  const late = view({ attachments: [take(CONE, "sb-ash", 660), drop(CONE, "sb-ash", 700)], places, from: 600, through: 650 });
  assert.deepEqual(placeOf(CONE, late, coneMark), { at: { x: 10, y: 20 }, extent: { w: 1, h: 1 }, source: "set-down" });
  // printed: canon has it, and a later author's amend is never undone by the old drop
  assert.equal(placeOf(CONE, view({ attachments: [drop(CONE, "sb-ash", 640)], places, from: 600, through: 650 }), coneMark), null);
  // the POS-138 era (before the first printout, and before any printout at all): it stands where it was set down, as before
  assert.equal(placeOf(CONE, view({ attachments: [drop(CONE, "x", 500)], places, from: 600, through: 650 }), coneMark).before_printout, true);
  assert.equal(placeOf(CONE, view({ attachments: [drop(CONE, "x", 500)], places }), coneMark).before_printout, true);
  assert.equal(placeOf(CONE, view(), coneMark), null, "never held: canon");
  assert.equal(actIdOf({ seq: 99 }), -Infinity, "a frozen-era row has no act id: it is the oldest");
});

test("3. a held mark keeps its maker, words and id, and loses its place", () => {
  const v = view({ attachments: [take(CONE, "sb-ash", 660)] });
  const m = placedMark(coneMark, v);
  assert.equal(m.id, CONE); assert.equal(m.by, "berthillon"); assert.equal(m.body, "A paper cone.");
  assert.equal(m.at, undefined); assert.equal(m.extent, undefined);
  assert.equal(m[HELD_BY], "sb-ash");
});

test("4. the one world, placed: held things unplaced, the rest untouched, and the same object when nothing moves", () => {
  const other = { id: "berthillon/le-mur-des-cornets", kind: "sited", at: { x: 221, y: 95.5 }, extent: { w: 2, h: 2 } };
  const w = { marks: [coneMark, other], terrain: {} };
  assert.equal(unplaceHeld(w, view()), w, "no hand-off: the very same world");
  assert.equal(unplaceHeld(w, null), w, "an unread record: canon, as before");
  const placed = unplaceHeld(w, view({ attachments: [take(CONE, "sb-ash", 660)] }));
  assert.notEqual(placed, w);
  assert.equal(placed.marks[1], other, "the wall is canon's own object");
  assert.equal(placed.marks[0].at, undefined);
  assert.equal(placed.terrain, w.terrain);
});

test("5. THE ENGINE OVER THE PLACED WORLD: the cone in sb-ash's hands is in no one's field of view, and its close look names its holder", async () => {
  const clone = join(ROOT, "world-clone");
  const verbsPath = join(clone, "tools", "world-verbs.mjs"), buildPath = join(clone, "tools", "world-build.mjs");
  if (!existsSync(verbsPath)) return;
  const verbs = await import(pathToFileURL(verbsPath).href);
  const { assembleWorld } = await import(pathToFileURL(buildPath).href);
  const worldState = JSON.parse(readFileSync(join(clone, "WORLD", "world-state.json"), "utf8"));
  const skeleton = JSON.parse(readFileSync(join(clone, "WORLD", "skeleton.json"), "utf8"));
  const w = assembleWorld({ worldState, skeleton });
  assert.ok(w.marks.some((m) => m.id === CONE && m.at), "the fixture: the cone stands on the wall");
  const placed = unplaceHeld(w, view({ attachments: [take(CONE, "sb-ash", 660)] }));
  const here = { x: 221, y: 95.5 };
  const seen = (world) => {
    const o = verbs.orient(here, world, { crossing: 258 });
    return JSON.stringify([o.nearby ?? [], o.you?.within ?? [], o.records ?? {}]);
  };
  assert.doesNotMatch(seen(placed), new RegExp(CONE.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")), "never in the field of view as its own mark");
  const r = verbs.investigate(CONE, placed, { depth: 1 });
  assert.equal(r.error, undefined, "still the same mark: the close look answers it");
  assert.equal(r.at, undefined, "and gives it no place");
  const wall = verbs.investigate("berthillon/le-mur-des-cornets", placed, { depth: 1 });
  assert.ok(!(wall.children ?? []).some((c) => c.id === CONE), "nor among the wall's children");
});

test("6. THE PRINTOUT (W1 a): held printed unplaced with where it last stood; a drop since the first printout prints a fresh at", () => {
  const row = (slug, extra = {}) => ({ id: `u-${slug}`, slug, kind: "thing", owner: slug.split("/")[0], household: "hh", body: "b", locked_window: 250,
    geometry: { at: { x: 221, y: 95.5 }, extent: { w: 1, h: 1 } }, data: { date: "2026-08-26", _fileAt: { x: 0, y: 0 } }, ...extra });
  const rows = [row(CONE), row("sb-ash/a-tin-box"), row("x/old-set-down"), row("sable/a-box"),
    row("sable/a-boat", { data: { _parentMarkId: "sable/a-box", _fileAt: { x: 0, y: 0 } } })];
  const drops = new Map([["sb-ash/a-tin-box", { id: 700, actor: "sb-ash", crossing: 258.2, at_anchor: "world", at_dx: 196, at_dy: -352 }]]);
  const attachments = [take(CONE, "sb-ash", 660), take("sb-ash/a-tin-box", "sb-ash", 610), drop("sb-ash/a-tin-box", "sb-ash", 700),
    drop("x/old-set-down", "x", 400), take("sable/a-box", "sable", 690), take("u/a-draft", "u", 691)];
  const { prints, notes } = holdPrintout({ attachments, drops, rows, from: 600 });
  const by = new Map(prints.map((p) => [p.slug, p]));
  const cone = by.get(CONE);
  assert.equal(cone.geometry, null, "no at, no extent");
  assert.equal(cone.data[HELD_BY], "sb-ash");
  assert.deepEqual(cone.data[PLACED], { at: { x: 221, y: 95.5 }, extent: { w: 1, h: 1 } }, "where it last stood, kept in the store, never printed");
  assert.equal(cone.data._fileAt, undefined, "world numbers now; the write-down frames them");
  assert.deepEqual(by.get("sb-ash/a-tin-box").geometry, { at: { x: 196, y: -352 }, extent: { w: 1, h: 1 } }, "set down where the dropper stood");
  assert.equal(by.get("sb-ash/a-tin-box").data[HELD_BY], undefined);
  assert.equal(by.has("x/old-set-down"), false, "a POS-138-era set-down is left alone (D2)");
  assert.equal(by.has("sable/a-box"), false, "a thing that frames a mark filed inside it stays placed…");
  assert.match(notes.join("\n"), /sable\/a-box stays placed: 1 mark\(s\) filed inside it/, "…by name");
  assert.equal(by.has("u/a-draft"), false, "no standing row: nothing to print");
  // printed already: nothing again
  const printed = rows.map((r) => (r.slug === CONE ? { ...r, geometry: null, data: { [HELD_BY]: "sb-ash", [PLACED]: r.geometry } } : r));
  assert.equal(holdPrintout({ attachments, drops, rows: printed, from: 600 }).prints.some((p) => p.slug === CONE), false);
  // a held cone set down later prints its extent back from where it last stood
  const back = holdPrintout({ attachments: [take(CONE, "sb-ash", 660), drop(CONE, "sb-ash", 720)], rows: printed, from: 600,
    drops: new Map([[CONE, { id: 720, actor: "sb-ash", crossing: 259.1, at_anchor: "world", at_dx: 5, at_dy: 6 }]]) });
  assert.deepEqual(back.prints[0].geometry, { at: { x: 5, y: 6 }, extent: { w: 1, h: 1 } });
  assert.equal(back.prints[0].data[PLACED], undefined);
  // the first clearing that prints (no earlier cutoff): held things only
  assert.deepEqual(holdPrintout({ attachments, drops, rows, from: null }).prints.map((p) => p.slug).sort(), [CONE].sort());
  // an author's amend after the drop: their word stands
  const amended = rows.map((r) => (r.slug === "sb-ash/a-tin-box" ? { ...r, locked_window: 259 } : r));
  assert.equal(holdPrintout({ attachments, drops, rows: amended, from: 600 }).prints.some((p) => p.slug === "sb-ash/a-tin-box"), false);
});

test("7. a thing is a thing by its class chain", () => {
  const ext = { "halloween-candy-bowl": "thing", thing: "sited" };
  const opts = { classOf: (m) => m.class ?? (["sited", "parcel"].includes(m.kind) ? null : m.kind), extendsOf: (c) => ext[c] ?? null };
  assert.equal(isThingMark({ kind: "thing" }, opts), true);
  assert.equal(isThingMark({ kind: "sited", class: "halloween-candy-bowl" }, opts), true);
  assert.equal(isThingMark({ kind: "sited" }, opts), false);
  assert.equal(isThingMark({ kind: "parcel" }, opts), false);
});

test("8. W4: the witness stamp never anchors an act on a thing (source pin; the probe is the playground's)", () => {
  const src = readFileSync(join(ROOT, "src", "world.mjs"), "utf8");
  assert.ok(src.includes("const at = anchorAt(here, { chain: chainAt(here).filter((m) => !isThingMark(m, thingOpts)), centreOf });"));
});

test("9. W4: an act anchored on a thing now in someone's hands still composes, against where it last stood", () => {
  const rows = [{ slug: CONE, geometry: null, data: { [HELD_BY]: "sb-ash", [PLACED]: { at: { x: 221, y: 95.5 }, extent: { w: 1, h: 1 } } } },
    { slug: "a/wall", geometry: { at: { x: 1, y: 2 } }, data: {} }];
  assert.deepEqual(anchorCentres(rows).get(CONE), { x: 221, y: 95.5 });
  assert.deepEqual(anchorCentres(rows).get("a/wall"), { x: 1, y: 2 });
  assert.deepEqual(placedCentreOfRow({ geometry: JSON.stringify({ at: { x: 3, y: 4 } }), data: null }), { x: 3, y: 4 });
});

test("10. W6: a take of a thing in someone else's hands answers as a take", () => {
  assert.throws(() => refuseTakeOfHeld({ thing: CONE, verb: "take", actor: "sb-cleo", holder: "sb-ash" }), (e) => {
    assert.equal(e.code, 403);
    assert.equal(e.defect, `sb-ash is holding ${CONE}, not sb-cleo`);
    assert.equal(e.hint, "sb-ash is holding it: a thing in someone's hands changes hands only when they give it. Ask them. Nothing was recorded.");
    assert.doesNotMatch(e.hint, /give or set down what you are holding/);
    return true;
  });
  assert.equal(refuseTakeOfHeld({ thing: CONE, verb: "drop", actor: "sb-cleo", holder: "sb-ash" }), undefined, "a drop's refusal is the adjudicator's own");
  assert.equal(refuseTakeOfHeld({ thing: CONE, verb: "take", actor: "sb-ash", holder: "sb-ash" }), undefined);
  assert.equal(refuseTakeOfHeld({ thing: CONE, verb: "take", actor: "sb-cleo", holder: null }), undefined);
  // and the door asks it, before the faces are derived (the face of a take of a held thing is "drop")
  const door = readFileSync(join(ROOT, "src", "world-hold.mjs"), "utf8");
  const asks = door.indexOf("refuseTakeOfHeld({ thing: args.thing, verb, actor, holder: preHolder });");
  assert.ok(asks > 0 && asks < door.indexOf("const face = faceOf(preHolder, args.to ?? null);"), "the door asks it before the face");
});

test("11. ONE OWNER: every reader of a thing's place reads the one answer, and the copies are deleted (source pins)", () => {
  const read = (f) => readFileSync(join(ROOT, f), "utf8");
  const world = read("src/world.mjs"), hold = read("src/world-hold.mjs"), units = read("src/world-units.mjs"), apex = read("src/world-apex.mjs");
  assert.match(world, /async function sightFor\(w, handle, key = null\) \{\n  w = await heldPlaced\(w\);/, "orient, the eyes, investigate and find read the placed world");
  assert.match(world, /export async function worldMarkById\(id\) \{\n  const w = await heldPlaced\(await world\(\)\);/, "the take door and the hold reads read the placed world");
  const block = world.slice(world.indexOf("export async function thingStandsBlock"), world.indexOf("export async function thingStandsBlock") + 3000);
  assert.doesNotMatch(block, /standsRowsFromStore/, "the stands block runs no store read of its own");
  assert.doesNotMatch(hold, /export const heldPositionOf/, "the unused derivation is gone");
  assert.doesNotMatch(hold, /a held thing rides its holder \(the-town\/the-anchor\)`/, "whereThingStands derives no place from a holder");
  const holderPlace = units.slice(units.indexOf("holderPlace:"), units.indexOf("holderPlace:") + 600);
  assert.match(holderPlace, /placeOf\(/); assert.doesNotMatch(holderPlace, /standsRowsFromStore|composeAnchor/);
  assert.doesNotMatch(apex, /async function holdingRecord\(/, "the ground read's own record read is gone");
  assert.match(read("src/world2-serve.mjs"), /await heldPlaced\(eng\.build\.assembleWorld\(\{ worldState, skeleton \}\)\)/, "the store twin places its world too");
});
