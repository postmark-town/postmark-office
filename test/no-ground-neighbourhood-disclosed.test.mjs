// no-ground-neighbourhood-disclosed.test.mjs — a placeholder standpoint says so
// where its consequences are (postmark-town/postmark#2889, kogane's first item).
//
// THE DEFECT AS REPORTED. `world` placed him at the Origin and disclosed it in
// `standpoint.from` — and then answered `within`, `nearby` and `present` off
// that same point with nothing marking them as the placeholder's. His words:
// "A resident with no ground has no neighbours; eighteen shown is worse than
// none."
//
// MEASURED BEFORE ANYTHING WAS BUILT, against the live fold at
// G:/Postmark/repo-clones/wright/postmark-world for a handle holding no ground:
//
//     standpoint.from  "<handle> has no ground on the map yet — the Origin"
//     you.within       the-town/let-there-be-light, the-town/the-town-centre,
//                      the-town/the-quay-reach, the-town/the-town-centre-crossing
//     you.region       the-town-centre
//     you.standingOn   the-main-channel, 125 m
//
// Four fields of somebody else's neighbourhood, and one field saying the point
// was a default — with nothing joining the two.
//
// WHAT IS UNDER TEST is the office's own vocabulary, exactly as
// test/origin-name.test.mjs tests the sibling string: the engine is stubbed at
// the import seam the office loads it from, and what is asserted is the phrasing
// the office puts over the engine's answer.
//
// WHAT IS DELIBERATELY NOT UNDER TEST: which point a groundless resident stands
// on. The Origin is the founder's ruling (#2752) and the engine's own
// `residentStandpoint` answers the quay for the same resident — a live collision
// reported on #2889, not settled here. These tests would pass unchanged if that
// collision were resolved either way; what they hold is that a DEFAULT standpoint
// is never handed over silently.
//
//   node --test test/no-ground-neighbourhood-disclosed.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ── the engine, stubbed at the office's own import seam ──────────────────────
// `homeOf` is the whole engine input this branch reads. The stub answers placed
// or unplaced off the handle's name, so ONE stub drives both sides of every
// assertion below and neither side can be passing because the stub only ever
// says one thing.
const clone = mkdtempSync(join(tmpdir(), "postmark-no-ground-"));
mkdirSync(join(clone, "tools"), { recursive: true });
writeFileSync(join(clone, "tools", "where-is.mjs"),
  "export const NOWHERE = Object.freeze({ x: null, y: null, placed: false, source: null, mark_id: null });\n"
  + "export function homeOf(handle) {\n"
  + "  if (String(handle).startsWith('placed-')) return { x: 11, y: -22, placed: true, source: 'parcel',\n"
  + "    mark_id: handle + '/the-parcel', parcel: { id: handle + '/the-parcel', at: { x: 11, y: -22 }, extent: { w: 25, h: 25 } } };\n"
  + "  return { ...NOWHERE };\n"
  + "}\n"
  + "export function whereIs(handle, o) { return homeOf(handle, o?.world); }\n");
process.env.WORLD_CLONE = clone;
process.on("exit", () => rmSync(clone, { recursive: true, force: true }));

const { homeCoords, NO_GROUND_NEIGHBOURHOOD } = await import("../src/world.mjs");
const W = { marks: [], parcels: [] };

test("FALSIFIER — a groundless standpoint is MARKED a placeholder, not merely worded as one", async () => {
  const at = await homeCoords("nobody-lives-here-xyz", W);

  // THE RED LINE. Before this repair the return held exactly {x, y, from}; the
  // only account of the default was inside a prose string, and nothing a reader
  // of `within`/`nearby`/`present` could branch on. Both keys are new and both
  // are the fix.
  assert.equal(at.placeholder, true,
    "a default standpoint must be machine-legible as one — a sentence in `from` is not a field a reader can act on");
  assert.equal(typeof at.placeholder_note, "string");
  assert.ok(at.placeholder_note.length > 0);

  // ANTI-VACUITY, the same run, the same stub: a resident WITH ground must carry
  // neither key, so the assertions above cannot be passing because the function
  // decorates everything it returns.
  const placed = await homeCoords("placed-somebody", W);
  assert.equal(placed.placeholder, undefined,
    "a resident standing on their own ground has no placeholder to disclose");
  assert.equal(placed.placeholder_note, undefined);
  assert.match(placed.from, /your ground/);
});

test("FALSIFIER — the note names the DERIVED fields, which is the whole of kogane's complaint", async () => {
  const at = await homeCoords("nobody-lives-here-xyz", W);

  // The report is not "the standpoint was wrong"; it is that the fields computed
  // FROM the standpoint carried no trace of it. A note that discloses the point
  // and never names its consequences would leave the defect exactly where it was,
  // so each of the four fields he read off the placeholder is named here by the
  // key a caller actually sees.
  for (const field of ["within", "region", "standingOn", "nearby", "present"])
    assert.match(at.placeholder_note, new RegExp(`\`${field}\``),
      `the note must name \`${field}\` — it is one of the fields derived from the placeholder`);

  // And it must say the residents are not neighbours, which is the sentence that
  // would have stopped him writing to the town about them.
  assert.match(at.placeholder_note, /not your neighbours/);
  assert.equal(at.placeholder_note, NO_GROUND_NEIGHBOURHOOD,
    "one sentence, exported, so the doors cannot drift into two");
});

test("the disclosure is ADDITIVE — `from`, x and y are byte-identical to before", async () => {
  const at = await homeCoords("nobody-lives-here-xyz", W);

  // test/origin-name.test.mjs pins this string and these coordinates against the
  // founder's #2752 ruling. Restating them here is deliberate: this repair rides
  // the same object, and a future edit that "improves" the wording while adding
  // the disclosure would break that ruling from inside this file's change.
  assert.equal(at.from, "nobody-lives-here-xyz has no ground on the map yet — the Origin");
  assert.deepEqual({ x: at.x, y: at.y }, { x: 0, y: 0 });
  assert.doesNotMatch(at.from, /quay/i);
});
