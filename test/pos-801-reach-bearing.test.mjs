// pos-801-reach-bearing.test.mjs — the reach's compass word uses the world's axes.
//
// POS-801. `bearingWord` (src/reach.mjs) computed atan2(dx, dy) and called +y
// north. The world's grid is x east, y SOUTH: "Compass: N = -y, E = +x, S = +y,
// W = -x" (postmark-world tools/world-engine.mjs, bearingDeg = atan2(dx, -dy)).
// So a thing north of you read "S" in a refusal, and one south of you "N".
//
// HOW IT IS RUN. src/reach.mjs imports src/voices.mjs, whose own imports
// (world-classes, town-journal, hearing-window, speaker-standing) are not
// classified for import-time I/O. So this file does not import the module. It
// reads the module's own text, drops the one import line and the export
// keywords, and runs the REST in a node:vm context with EARSHOT_M and SAY_DIALS
// shimmed. The functions under test are the file's own bytes, not a copy; the
// slice is asserted to have found them. The only I/O is reading that one file.
//
// THE EXPECTED WORDS are not taken from the implementation. Each is built from
// a compass angle as a world vector (east = sin, south = -cos of the angle), the
// inverse of the way bearingWord goes, from invented numbers only.
//
//   node --test test/pos-801-reach-bearing.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "src", "reach.mjs"), "utf8");
const POINTS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];

/** The reach module's own text, run without its import. */
function load(text = SRC) {
  const body = text
    .split(/\r?\n/)
    .filter((l) => !/^import\s/.test(l) && !/^export\s*\{/.test(l))
    .map((l) => l.replace(/^export (async )?(function|const) /, "$1$2 "))
    .join("\n");
  assert.doesNotMatch(body, /^(import|export)\s/m, "no import or export is left to run");
  const ctx = vm.createContext({ EARSHOT_M: 60, SAY_DIALS: {}, Math, Number, Boolean });
  return vm.runInContext(`${body}\n({ bearingWord, metresBetween, standsWithin, withinArmsLength });`, ctx);
}

/** A point `m` metres from the origin on compass angle `deg` (0 = north, clockwise), in the world's grid. */
const toward = (deg, m = 10) => ({ x: m * Math.sin((deg * Math.PI) / 180), y: -m * Math.cos((deg * Math.PI) / 180) });
const O = { x: 0, y: 0 };

test("the slice found the real functions", () => {
  const r = load();
  for (const f of ["bearingWord", "metresBetween", "standsWithin", "withinArmsLength"]) assert.equal(typeof r[f], "function", f);
});

test("north is -y, south +y, east +x, west -x: the four cardinals", () => {
  const { bearingWord } = load();
  assert.equal(bearingWord(O, { x: 0, y: -10 }), "N");
  assert.equal(bearingWord(O, { x: 0, y: 10 }), "S");
  assert.equal(bearingWord(O, { x: 10, y: 0 }), "E");
  assert.equal(bearingWord(O, { x: -10, y: 0 }), "W");
});

test("the diagonals follow the same axes", () => {
  const { bearingWord } = load();
  assert.equal(bearingWord(O, { x: 7, y: -7 }), "NE");
  assert.equal(bearingWord(O, { x: 7, y: 7 }), "SE");
  assert.equal(bearingWord(O, { x: -7, y: 7 }), "SW");
  assert.equal(bearingWord(O, { x: -7, y: -7 }), "NW");
});

test("all sixteen points, each built from its compass angle and from a second origin", () => {
  const { bearingWord } = load();
  const from = { x: 130, y: -45 };
  POINTS.forEach((word, i) => {
    const t = toward(i * 22.5);
    assert.equal(bearingWord(O, t), word, `${word} from the origin`);
    assert.equal(bearingWord(from, { x: from.x + t.x, y: from.y + t.y }), word, `${word} from an offset origin`);
  });
});

test("reversing the vector gives the opposite word, and the word needs no distance", () => {
  const { bearingWord } = load();
  POINTS.forEach((word, i) => {
    const t = toward(i * 22.5, 3);
    assert.equal(bearingWord({ x: 2, y: 5 }, { x: 2 + t.x, y: 5 + t.y }), word);
    assert.equal(bearingWord({ x: 2 + t.x, y: 5 + t.y }, { x: 2, y: 5 }), POINTS[(i + 8) % 16], `back from ${word}`);
    assert.equal(bearingWord(O, toward(i * 22.5, 5000)), word, `${word} far out`);
  });
});

test("the rounding edge between N and NNE sits at 11.25 degrees, as before", () => {
  const { bearingWord } = load();
  assert.equal(bearingWord(O, toward(11.0)), "N");
  assert.equal(bearingWord(O, toward(11.5)), "NNE");
  assert.equal(bearingWord(O, toward(-11.0)), "N");
  assert.equal(bearingWord(O, toward(-11.5)), "NNW");
});

test("the same point, and unreadable inputs, have no bearing", () => {
  const { bearingWord } = load();
  assert.equal(bearingWord({ x: 4, y: 4 }, { x: 4, y: 4 }), null);
  assert.equal(bearingWord(null, { x: 1, y: 1 }), null);
  assert.equal(bearingWord(O, undefined), null);
  assert.equal(bearingWord(O, { x: "far", y: 1 }), null);
  assert.equal(bearingWord(O, { x: NaN, y: 1 }), null);
  assert.equal(bearingWord(O, { x: 1, y: Infinity }), null);
  assert.equal(bearingWord(O, { x: 1 }), null);
});

test("the refusal and the beside answer carry the corrected word, with their distance and decision unchanged", () => {
  const { standsWithin, withinArmsLength } = load();
  const north = { at: { x: 0, y: -90 } };
  const refused = standsWithin(O, north);
  assert.equal(refused.bearing, "N");
  assert.equal(refused.stands, false);
  assert.equal(refused.distance_m, 90);
  assert.equal(refused.earshot_m, 60);
  const south = standsWithin(O, { at: { x: 0, y: 30 } });
  assert.equal(south.bearing, "S");
  assert.equal(south.stands, true);
  assert.equal(south.how, "reach");
  const beside = withinArmsLength(O, { x: 0, y: -40 });
  assert.equal(beside.bearing, "N");
  assert.equal(beside.stands, true);
  assert.equal(withinArmsLength(O, { x: -40, y: 0 }).bearing, "W");
  assert.equal(standsWithin(O, { at: null }).bearing, null, "an unreadable anchor has no bearing and no distance");
  assert.equal(standsWithin(O, { at: null }).distance_m, null);
});

// ── THE SIGN-BACK FLIP, PERMANENT ───────────────────────────────────────────
// The original convention (atan2(dx, dy)) put back into the module's text. It
// must be caught by exactly the cases that have a vertical part, and leave east
// and west alone.
test("the original vertical sign, put back, fails every case with a vertical part and no other", () => {
  assert.equal(SRC.split("Math.atan2(dx, -dy)").length - 1, 1, "the fixed line is present exactly once");
  const back = load(SRC.replace("Math.atan2(dx, -dy)", "Math.atan2(dx, dy)"));
  assert.equal(back.bearingWord(O, { x: 0, y: -10 }), "S", "north now reads south: the flip is live");
  assert.equal(back.bearingWord(O, { x: 0, y: 10 }), "N");
  const wrong = [], right = [];
  POINTS.forEach((word, i) => (back.bearingWord(O, toward(i * 22.5)) === word ? right : wrong).push(word));
  assert.deepEqual(right, ["E", "W"], "only the two points with no vertical part survive the flip");
  assert.equal(wrong.length, 14);
  assert.equal(back.standsWithin(O, { at: { x: 0, y: -90 } }).bearing, "S");
});
