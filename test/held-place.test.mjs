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
import { HELD_BY, PLACED, heldBy, placeOf, viewOf, unplaceHeld, placedMark, placedCentreOfRow, isThingMark, groundChain, actIdOf } from "../src/held.mjs";
import { worldClone } from "./fixture-paths.mjs";
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
  const drops = new Map([["sb-ash/a-tin-box", { seq: 700, actor: "sb-ash", crossing: 258.2, at: { anchor: null, dx: 196, dy: -352 } }]]);
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
    drops: new Map([[CONE, { seq: 720, actor: "sb-ash", crossing: 259.1, at: { anchor: null, dx: 5, dy: 6 } }]]) });
  assert.deepEqual(back.prints[0].geometry, { at: { x: 5, y: 6 }, extent: { w: 1, h: 1 } });
  assert.equal(back.prints[0].data[PLACED], undefined);
  // the first clearing that prints (no earlier cutoff): held things only
  assert.deepEqual(holdPrintout({ attachments, drops, rows, from: null }).prints.map((p) => p.slug).sort(), [CONE].sort());
  // an author's amend after the drop: their word stands (act ids, one clock: the amend's act is later than the drop's)
  const amended = rows.map((r) => (r.slug === "sb-ash/a-tin-box" ? { ...r, data: { ...r.data, _act_id: "705" } } : r));
  assert.equal(holdPrintout({ attachments, drops, rows: amended, from: 600 }).prints.some((p) => p.slug === "sb-ash/a-tin-box"), false);
  assert.match(holdPrintout({ attachments, drops, rows: amended, from: 600 }).notes.join("\n"), /sb-ash\/a-tin-box: amended by act 705, after its set-down \(act 700\): the author's word stands/);
});

// POS-688 acceptance F1 (Wright, 2026-10-21): the amend rule compared a WINDOW with a CROSSING. On prod the two share
// numbers but not hours: window W opens 05:45Z and clears at 17:45Z, while crossing W runs 12:00Z–24:00Z. A thing
// locked at W's clearing (locked_window W), then taken and dropped before midnight (the drop's crossing W.6), read as
// amended past its drop, "amended in window W, after its set-down in W", and was held back at every clearing after.
test("6b. F1: a drop after a lock at the clearing, before the crossing ends, prints; only an amend by a later act holds it back", () => {
  const CROSSING_263 = Date.UTC(2026, 9, 21, 12);   // crossing 263 runs 12:00Z–24:00Z on 10-21 (prod's clock)
  const crossingAt = (ms) => 263 + (ms - CROSSING_263) / (12 * 3600_000);
  const clearing = Date.UTC(2026, 9, 21, 17, 45);   // window 263 clears at 17:45Z
  const dropAt = Date.UTC(2026, 9, 21, 20, 0);      // the drop, before midnight: crossing 263.67
  assert.ok(Math.floor(crossingAt(dropAt)) === 263 && crossingAt(clearing) < crossingAt(dropAt));
  const KEY = "sb-ash/a-brass-key";
  const row = { id: "u-key", slug: KEY, kind: "thing", owner: "sb-ash", household: "hh", body: "b",
    locked_window: 263, // locked at window 263's clearing
    geometry: { at: { x: 196, y: -356 }, extent: { w: 1, h: 1 } }, data: { date: "2026-10-21", _act_id: "21400" } };
  const attachments = [take(KEY, "sb-ash", 21410), drop(KEY, "sb-ash", 21420)];
  const drops = new Map([[KEY, { seq: 21420, actor: "sb-ash", crossing: crossingAt(dropAt), at: { anchor: null, dx: 230, dy: -350 } }]]);
  const out = holdPrintout({ attachments, drops, rows: [row], from: 21000 });
  assert.deepEqual(out.prints.map((p) => [p.slug, p.geometry?.at]), [[KEY, { x: 230, y: -350 }]], `it prints where it was set down: ${out.notes.join(" | ")}`);
  assert.doesNotMatch(out.notes.join("\n"), /author's word stands/);
  // and the rule still holds an author's real amend after the drop
  const amended = holdPrintout({ attachments, drops, rows: [{ ...row, data: { ...row.data, _act_id: "21430" } }], from: 21000 });
  assert.equal(amended.prints.length, 0);
  assert.match(amended.notes.join("\n"), /amended by act 21430, after its set-down \(act 21420\)/);
  // a row from before the act-id era has had no amend since (an amend writes one): the drop prints
  const legacy = holdPrintout({ attachments, drops, rows: [{ ...row, data: { date: "2026-08-01" } }], from: 21000 });
  assert.equal(legacy.prints.length, 1);
});

test("7. a thing is a thing by its class chain", () => {
  const ext = { "halloween-candy-bowl": "thing", thing: "sited" };
  const opts = { classOf: (m) => m.class ?? (["sited", "parcel"].includes(m.kind) ? null : m.kind), extendsOf: (c) => ext[c] ?? null };
  assert.equal(isThingMark({ kind: "thing" }, opts), true);
  assert.equal(isThingMark({ kind: "sited", class: "halloween-candy-bowl" }, opts), true);
  assert.equal(isThingMark({ kind: "sited" }, opts), false);
  assert.equal(isThingMark({ kind: "parcel" }, opts), false);
});

test("8. W4: the witness stamp never anchors an act on a thing (the call sites)", () => {
  const src = readFileSync(join(ROOT, "src", "world.mjs"), "utf8");
  assert.ok(src.includes("const groundAt = (p) => groundChain(chainAt(p), byId, thingOpts);") && src.includes("const at = anchorAt(here, { chain: groundAt(here), centreOf });") && src.includes("chainAt: groundAt }"), "the actor and every witness are pinned to ground");
});

// THE PLAYGROUND'S FIND (2026-10-19): the engine's chain links are slim, so the
// first W4 asked a link with no kind and no class, and a tin box on the ground
// anchored two drops. Driven on the world engine's own containmentChain.
const WORLD = worldClone();
test("8b. W4 on the engine's own chain: a thing standing in a parcel is never the anchor, its full record is asked", { skip: WORLD ? false : "no world clone with tools/world-verbs.mjs" }, async () => {
  const { containmentChain } = await import(pathToFileURL(join(WORLD, "tools", "world-verbs.mjs")).href);
  const ground = { id: "sb-ash/sb-lantern-ground", kind: "parcel", by: "sb-ash", tier: "home", at: { x: 200, y: -350 }, extent: { w: 25, h: 25 }, body: "ground" };
  // the old form (kind: sited + class), which every engine chains; world main chains `kind: thing` too (mark-kind § isGround)
  const box = { id: "sb-ash/a-tin-box", kind: "sited", class: "thing", by: "sb-ash", tier: "home", at: { x: 202, y: -355 }, extent: { w: 1, h: 1 }, body: "A dented tin box.", holder: "true" };
  const marks = [ground, box];
  const chain = containmentChain({ x: 202, y: -355 }, marks);
  assert.deepEqual(chain.map((l) => l.id), [ground.id, box.id], "the engine nests the box inside the ground");
  assert.deepEqual([chain[1].kind, chain[1].class], [undefined, undefined], "and its links carry no kind and no class: the shape that hid the thing");
  const opts = { classOf: (m) => (m.kind === "thing" ? "thing" : m.class ?? null), extendsOf: () => null };
  assert.deepEqual(groundChain(chain, new Map(marks.map((m) => [m.id, m])), opts).map((l) => l.id), [ground.id], "known by its full record, the box is not ground");
  assert.deepEqual(chain.filter((l) => !isThingMark(l, opts)).map((l) => l.id), [ground.id, box.id], "THE FLIP: asked of the link itself, the box anchors");
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
  assert.match(world, /async function sightFor\(w, handle, key = null, \{ lens = null \} = \{\}\) \{\n  w = await heldPlaced\(w\);/, "orient, the eyes, investigate and find read the placed world");
  assert.match(world, /export async function worldMarkById\(id\) \{\n  const w = await heldPlaced\(await world\(\)\);/, "the take door and the hold reads read the placed world");
  const block = world.slice(world.indexOf("export async function thingStandsBlock"), world.indexOf("export async function thingStandsBlock") + 3000);
  assert.doesNotMatch(block, /standsRowsFromStore/, "the stands block runs no store read of its own");
  assert.doesNotMatch(hold, /export const heldPositionOf/, "the unused derivation is gone");
  assert.doesNotMatch(hold, /a held thing rides its holder \(the-town\/the-anchor\)`/, "whereThingStands derives no place from a holder");
  const holderPlace = units.slice(units.indexOf("holderPlace:"), units.indexOf("holderPlace:") + 600);
  assert.match(holderPlace, /placeOf\(/); assert.doesNotMatch(holderPlace, /standsRowsFromStore|composeAnchor/);
  assert.doesNotMatch(apex, /async function holdingRecord\(/, "the ground read's own record read is gone");
  assert.ok(read("src/world2-serve.mjs").includes("await heldPlaced(eng.build.assembleWorld({ worldState, skeleton }), { pool: p, markRows })"), "the store twin places its world too, by its own store's holds");
});

test("12. a drop the settlement could not print: canon still names a holder, so the record's place stands (found on the playground, window 274)", () => {
  const places = new Map([[CONE, { x: 10, y: 20 }]]);
  const printedHeld = { id: CONE, kind: "thing", [HELD_BY]: "sb-ash", body: "A paper cone." };
  const v = view({ attachments: [take(CONE, "sb-ash", 660), drop(CONE, "sb-ash", 665)], places, from: 600, through: 665,
    placed: new Map([[CONE, { at: { x: 221, y: 95.5 }, extent: { w: 1, h: 1 } }]]) });
  assert.deepEqual(placeOf(CONE, v, printedHeld), { at: { x: 10, y: 20 }, extent: { w: 1, h: 1 }, source: "set-down" });
  const m = placedMark(printedHeld, v);
  assert.equal(m[HELD_BY], undefined); assert.deepEqual(m.at, { x: 10, y: 20 }); assert.deepEqual(m.extent, { w: 1, h: 1 });
  assert.equal(placeOf(CONE, v, coneMark), null, "printed (canon has a place): canon's answer");
});

test("13. D5: the holder's row in anyone's view says how many things are in their hands, never which (Darko 2026-10-19 09:21)", async () => {
  const { holdingAct, withActs } = await import("./stands-store-fixture.mjs");
  const { withCarrying } = await import("../src/held-view.mjs");
  const acts = [
    holdingAct({ id: 9001, at: "2026-10-19T01:00:00Z", actor: "sb-ash", action: "take", thing: CONE, holder: "sb-ash", made_by: "berthillon" }),
    holdingAct({ id: 9002, at: "2026-10-19T01:05:00Z", actor: "sb-ash", action: "take", thing: "sb-ash/a-bag", holder: "sb-ash", made_by: "sb-ash" }),
  ];
  const present = { radius_m: 500, residents: [{ handle: "sb-ash", distance_m: 0 }, { handle: "sb-cleo", distance_m: 3 }] };
  const out = await withActs(acts, () => withCarrying(present));
  assert.equal(out.residents[0].carrying, 2, "two things in sb-ash's hands");
  assert.equal("carrying" in out.residents[1], false, "a resident carrying nothing gets no field");
  assert.equal(JSON.stringify(out).includes(CONE), false, "how many, never which");
  const src = readFileSync(join(ROOT, "src", "world.mjs"), "utf8");
  assert.equal((src.match(/withCarryingNow\(await presen(t|ce)Near\(/g) ?? []).length, 3, "orient, the eyes and GET /world/present all carry it");
  assert.ok(src.includes(", carrying ${r.carrying} ${r.carrying === 1 ? \"thing\" : \"things\"}"), "and the telling says it");
});
