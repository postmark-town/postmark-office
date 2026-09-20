// one-standpoint-for-the-groundless.test.mjs — a resident with no ground stands
// at the Origin EVERYWHERE the office answers the question
// (postmark-town/postmark#2900; the founder, 2026-09-17: "Agreed with the Origin").
//
// THE DEFECT, MEASURED AT THE TRAIN TIP BEFORE ANYTHING WAS BUILT. The office
// held two deliberate answers for one groundless handle, 5,833 m apart:
//
//   homeCoords          (0, 0)         read by orient, eyes, apex
//   residentStandpoint  (1390, 5665)   read by walk, say  — source "quay"
//   everyonePlaced row  (1390, 5665)   read by presence, walkers
//
// So one call told kogane he stood at the Origin while the same session's walk
// line departed the Long Run harbour 6.5 km away (#2889, his first item).
//
// WHAT IS UNDER TEST is the OFFICE's answer, not the engine's. The engine is
// stubbed at the import seam the office loads it from — the pattern
// test/origin-name.test.mjs and test/no-ground-neighbourhood-disclosed.test.mjs
// both use — and the stub still answers the porch, exactly as the real
// tools/where-is.mjs does. Every assertion below is therefore about the office
// OVERRIDING a porch it can still read, which is the only shape that can fail:
// a stub that had been taught the ruling would make these green for free.
//
// WHAT IS DELIBERATELY NOT TOUCHED, and asserted so:
//   - the-town/the-standing-porch is still world law and the-town/the-quay is
//     still a mark. The stub says so and nothing here edits it.
//   - a resident WITH ground. Every assertion has a placed twin.
//   - what the Origin IS. test/origin-name.test.mjs holds that and stays green.
//
//   node --test test/one-standpoint-for-the-groundless.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tmpdir } from "node:os";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// ── the engine, stubbed at the office's own import seam ──────────────────────
// ONE stub drives both sides of every assertion: `placed-*` holds ground, every
// other handle is the porch. Neither side can be green because the stub only
// ever says one thing, and the porch arm is the REAL engine's arm — verbatim
// `source: "quay"` with the quay's own mark id at its recorded coordinates.
const QUAY = { x: 1390, y: 5665, id: "the-town/the-quay" };
const clone = mkdtempSync(join(tmpdir(), "postmark-one-standpoint-"));
mkdirSync(join(clone, "tools"), { recursive: true });
writeFileSync(join(clone, "tools", "where-is.mjs"), [
  "export const NOWHERE = Object.freeze({ x: null, y: null, placed: false, source: null, mark_id: null });",
  "const GROUND = (h) => ({ x: 11, y: -22, placed: true, source: 'parcel', mark_id: h + '/the-parcel',",
  "  parcel: { id: h + '/the-parcel', at: { x: 11, y: -22 }, extent: { w: 25, h: 25 } } });",
  "const PORCH = { x: " + QUAY.x + ", y: " + QUAY.y + ", placed: true, source: 'quay', mark_id: '" + QUAY.id + "' };",
  "export function homeOf(h) { return String(h).startsWith('placed-') ? GROUND(String(h)) : { ...NOWHERE }; }",
  "export function whereIs(h) { return String(h).startsWith('placed-') ? GROUND(String(h)) : { ...PORCH }; }",
  "export function publicResidents(handles) {",
  "  return (handles ?? []).map((h) => { const w = whereIs(h);",
  "    return { handle: h, x: w.x, y: w.y, source: w.source, moving: false, toward: null,",
  "             remaining_m: 0, eta_crossings: 0, mark_id: w.mark_id }; });",
  "}",
].join("\n"));
process.env.WORLD_CLONE = clone;
process.on("exit", () => rmSync(clone, { recursive: true, force: true }));

const where = await import(pathToFileURL(join(clone, "tools", "where-is.mjs")).href);
const { homeCoords, residentStandpoint, NO_GROUND_NEIGHBOURHOOD } = await import("../src/world.mjs");
const { everyonePlaced } = await import("../src/positions.mjs");

const GROUNDLESS = "no-ground-here", PLACED = "placed-resident";
const FOLD = { marks: [{ id: QUAY.id, kind: "sited", at: { x: QUAY.x, y: QUAY.y } }], parcels: [], households: {} };
const rowFor = (h) => everyonePlaced({ world: FOLD, departures: [], at: 0, where, roll: [GROUNDLESS, PLACED] })
  .find((r) => r.handle === h);
const point = (o) => ({ x: o.x, y: o.y });

// ── THE FOUR-WAY EQUALITY — the falsifier the ruling asked for ───────────────

test("FALSIFIER — orient/eyes/apex, walk, presence and say name ONE standpoint for a groundless resident, and it is the Origin", async () => {
  // 1/2/3 — orient, eyes and the apex. All three reach `standCoords`, whose
  // DERIVED_SOURCES rejects the porch, so all three land on `homeCoords`.
  const readByOrientEyesApex = await homeCoords(GROUNDLESS, FOLD);
  // 4/6 — the walk's departure (walkViaOffice's Stage D override) and say's
  // earshot (the voices deps' `standpoint`). Both read `residentStandpoint`.
  const readByWalkAndSay = await residentStandpoint(GROUNDLESS, FOLD);
  // 5 — presence's 500 m list and the walkers door. Both read `everyonePlaced`.
  const readByPresence = rowFor(GROUNDLESS);

  const AT_ORIGIN = { x: 0, y: 0 };
  assert.deepEqual(point(readByOrientEyesApex), AT_ORIGIN, "orient/eyes/apex");
  assert.deepEqual(point(readByWalkAndSay), AT_ORIGIN, "walk and say");
  assert.deepEqual(point(readByPresence), AT_ORIGIN, "presence and walkers");

  // stated as the equality and not only as three constants, because the defect
  // was never a wrong number — it was two right numbers that disagreed
  assert.deepEqual(point(readByWalkAndSay), point(readByOrientEyesApex));
  assert.deepEqual(point(readByPresence), point(readByOrientEyesApex));
});

test("FALSIFIER — each of the three carries the placeholder disclosure, so no reader takes the Origin's neighbourhood for their own", async () => {
  for (const [name, answer] of [
    ["orient/eyes/apex", await homeCoords(GROUNDLESS, FOLD)],
    ["walk and say", await residentStandpoint(GROUNDLESS, FOLD)],
    ["presence and walkers", rowFor(GROUNDLESS)],
  ]) {
    assert.equal(answer.placeholder, true, `${name} must say the point is a default`);
    assert.equal(answer.placeholder_note, NO_GROUND_NEIGHBOURHOOD,
      `${name} must carry the one disclosure, not a second wording of it`);
  }
});

test("FALSIFIER — a resident WITH ground is untouched at all three readers", async () => {
  const GROUND = { x: 11, y: -22 };
  const byHome = await homeCoords(PLACED, FOLD);
  const byStand = await residentStandpoint(PLACED, FOLD);
  const byRow = rowFor(PLACED);

  assert.deepEqual(point(byHome), GROUND);
  assert.deepEqual(point(byStand), GROUND);
  assert.deepEqual(point(byRow), GROUND);
  // provenance still says HOW we know, and it is not the groundless word
  assert.equal(byStand.source, "parcel");
  assert.equal(byRow.source, "parcel");
  assert.equal(byRow.mark_id, `${PLACED}/the-parcel`);
  // and none of them is told they are standing on a default
  assert.equal(byHome.placeholder, undefined);
  assert.equal(byStand.placeholder, undefined);
  assert.equal(byRow.placeholder, undefined);
  assert.equal(byHome.from, `your ground (${PLACED}/the-parcel)`);
});

// ── THE OVERRIDE IS AN OVERRIDE ─────────────────────────────────────────────

test("FALSIFIER — the-standing-porch is untouched: the engine still answers the quay, and the office corrects it", () => {
  // If this ever goes green by the ENGINE having changed its mind, the three
  // tests above stop measuring the office at all. This is the line that keeps
  // them honest — and it is also the promise that a mark was left alone.
  const engine = where.whereIs(GROUNDLESS);
  assert.equal(engine.source, "quay", "the porch is world law and this lane did not touch it");
  assert.equal(engine.mark_id, QUAY.id);
  assert.deepEqual(point(engine), { x: QUAY.x, y: QUAY.y },
    "the-town/the-quay is still a mark at its recorded place — a place you can walk to, just not one you are given");

  // and the office's answer is 5,833 m from it, which is the whole distance
  // this lane closed
  assert.equal(Math.round(Math.hypot(QUAY.x, QUAY.y)), 5833);
});

test("FALSIFIER — `source` says how we know, and the groundless word is not borrowed from the porch", async () => {
  const stand = await residentStandpoint(GROUNDLESS, FOLD);
  assert.equal(stand.source, "origin");
  assert.equal(stand.mark_id, null, "the Origin is the grid's corner, not a mark to stand on");
  assert.notEqual(stand.source, "quay", "a placement is not an act its subject performed");
  assert.notEqual(stand.source, "parcel", "and it is not ground they do not hold");
  assert.equal(rowFor(GROUNDLESS).source, "origin");
});

// ── ONE OWNER, structurally ─────────────────────────────────────────────────

test("FALSIFIER — the three derivations ask one module rather than each holding a copy", () => {
  // A law with two holders is a law whose falsifier goes green at one holder
  // while the other is still wrong. That is exactly how the Origin and the quay
  // survived side by side, so the single owner is asserted and not assumed.
  const src = (p) => readFileSync(join(ROOT, "src", p), "utf8");
  for (const f of ["world.mjs", "positions.mjs"])
    assert.match(src(f), /from "\.\/groundless\.mjs"/,
      `${f} must ask groundless.mjs where the groundless stand, not answer it itself`);

  // and the two doors the ruling moved must still route through the one
  // standpoint derivation rather than deriving a second one locally
  const world = src("world.mjs");
  assert.match(world, /if \(isGroundlessDefault\(here\)\) return groundlessStandpoint\(handle\);/,
    "residentStandpoint is the seam walk and say read; the correction belongs on it");
  assert.match(world, /const standing = await residentStandpoint\(who, w\)/,
    "the walk's departure override must keep reading residentStandpoint");
  assert.match(world, /const here = await residentStandpoint\(handle\);\s*\n\s*if \(here\?\.placed\) return here;/,
    "the say deps' standpoint must keep reading residentStandpoint");
});
