// #2690 — a scheduled enter_on_arrival must not become occupancy before arrival.
//
// The DEC-5 walk guard and the explicit enter/exit door read the same passage
// ledger. The guard therefore has to ask that ledger at the town's fractional
// crossing clock, not at Unix half-days. The original defect used
// Date.now() / 43200000 here, making a future crossing (~185) look older than
// an absolute Unix half-day count (~41k) and producing phantom occupancy.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../src/world.mjs", import.meta.url), "utf8");

// ── ADAPTED, NOT REPLACED (2026-09-13) ──────────────────────────────────────
//
// All three assertions below are the author's own, with their wording kept. The
// only change is WHERE each one looks. The clock line was lifted out of the
// guard into `occupiedNowBy` (src/world.mjs § DEC-5, THE WALK GUARD — THE
// OCCUPANCY READ) so that a test could execute it rather than only read it —
// see test/dec5-walk-clock-behaviour.test.mjs, which drives the real engine
// with a ledger row from the future. The fix itself is untouched; so is the
// intent of this file, which is that the guard shares the enter/exit door's
// clock. It now checks that in the two places the code actually lives.

test("#2690 — the DEC-5 occupancy guard uses the same town clock dependency as enter/exit", () => {
  const start = source.indexOf("DEC-5, THE WALK GUARD");
  assert.notEqual(start, -1, "the DEC-5 guard still exists");
  const guard = source.slice(start, start + 5000);
  const readStart = source.indexOf("export async function occupiedNowBy");
  assert.notEqual(readStart, -1, "the guard's occupancy read still exists");
  const read = source.slice(readStart, readStart + 800);

  assert.match(source.slice(source.indexOf("DEC-5, THE WALK GUARD (founder-ruled")), /const deps = crossingDeps\(\);/,
    "the guard obtains the enter/exit door's dependency set");
  assert.match(read, /thresholds\.stampAt\(deps\.now\(\)\)/,
    "occupancy is evaluated at the town's fractional crossing clock");
  assert.doesNotMatch(guard + read, /Date\.now\(\)\s*\/\s*43200000/,
    "Unix half-days are not the ferry clock and would make future arrivals look current");
});
