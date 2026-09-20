// dec5-walk-clock-behaviour.test.mjs — a scheduled arrival is not occupancy yet.
//
// THE COMPANION to test/dec5-walk-clock.test.mjs (kadakatzenberg, #2690). That
// file reads the source and asserts the guard asks the town's clock. This one
// EXECUTES the guard's occupancy read against the world engine's own fold, with
// a passage ledger holding an `enter_on_arrival` row stamped at the NEXT ferry
// crossing, and asserts the resident is not inside anything yet.
//
// WHY BOTH. A one-line clock repair that no test can run is a repair that can
// be undone in silence: restore `Date.now() / 43200000` and a source-text check
// reddens, but nothing proves the town would have behaved wrongly. Here it is
// the behaviour that reddens — the future row folds into occupancy and the
// resident is judged to be inside a mark they have not reached.
//
// THE DEFECT IN ONE LINE OF ARITHMETIC. `deps.now()` counts fractional ferry
// crossings from the ledger's first delivery day, so it reads about 186 today.
// `Date.now() / 43200000` counts Unix half-days, so it reads about 41,400. The
// engine's fold keeps every row with `at <= asked`, and 187 <= 41,400 — so
// tomorrow's arrival was already history.
//
// NOTHING HERE IS STUBBED but the ledger text and the clock, which are the two
// inputs under test. `parseEnterExitLedger`, `occupancyAt`, `stampAt` and
// `formatEnterExit` are the world clone's own, so this cannot drift from what
// the door adjudicates with. It SKIPS where no clone is present, the shape
// test/the-crossing-reaches-the-engine.test.mjs already uses for engine tests.

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { WORLD_CLONE, occupiedNowBy } from "../src/world.mjs";

const LAW = join(WORLD_CLONE, "tools", "enter-exit.mjs");
const HAVE = existsSync(LAW);
const NO_CLONE = `no enter/exit law at ${LAW}`;
const law = () => import(pathToFileURL(LAW));

// The two clocks, named as the code names them. `TOWN` is what `crossingDeps`
// hands the guard; `UNIX_HALF_DAYS` is the expression the fix removed.
const TOWN = () => (Date.now() - Date.UTC(2026, 5, 12)) / (12 * 3600 * 1000);
const UNIX_HALF_DAYS = () => Date.now() / 43200000;

const WHO = "a-walker";
const MARK = "town/the-ferry";

// One resident, one scheduled entry, at whichever crossing the caller names.
async function ledgerWithEntryAt(at) {
  const { formatEnterExit } = await law();
  return [
    "# the passage ledger (derived)",
    "",
    formatEnterExit({ handle: WHO, act: "enters", mark: MARK, at, word: "welcomed", iso: new Date().toISOString() }),
    "",
  ].join("\n");
}
const depsWith = (text, now) => ({ now, ledger: async () => text });

test("the two clocks are the ones this file claims they are", { skip: !HAVE && NO_CLONE }, () => {
  const town = TOWN(), unix = UNIX_HALF_DAYS();
  assert.ok(town > 100 && town < 5000, `the town clock reads ${town}, which is not a ferry crossing count`);
  assert.ok(unix > 40000, `the Unix half-day clock reads ${unix}, which is not what the defect produced`);
  assert.ok(unix > town + 1000, "the two clocks must be far apart, or this file proves nothing");
});

test("A SCHEDULED ARRIVAL IS NOT OCCUPANCY YET: a row at the NEXT crossing folds out at the town's clock", async (t) => {
  if (!HAVE) return t.skip(NO_CLONE);
  const { parseEnterExitLedger, occupancyAt, stampAt } = await law();
  const next = Math.floor(TOWN()) + 1;
  const text = await ledgerWithEntryAt(next);

  // the row parsed as the engine parses it, so the fixture cannot be wrong
  const { acts, unrecognized } = parseEnterExitLedger(text);
  assert.deepEqual(unrecognized, [], "the fixture ledger is not in the engine's own grammar");
  assert.equal(acts.length, 1);
  assert.equal(acts[0].at, stampAt(next));

  const within = await occupiedNowBy(WHO, { parseEnterExitLedger, occupancyAt, stampAt }, depsWith(text, TOWN));
  assert.deepEqual(within, [],
    `the walker was judged to be inside ${within.join(", ")} on the strength of an arrival scheduled for crossing ${next} — occupancy before arrival, which is #2690`);
});

test("THE FOLD CAN STILL SAY YES: a row from a PAST crossing is occupancy at the same clock", async (t) => {
  if (!HAVE) return t.skip(NO_CLONE);
  const { parseEnterExitLedger, occupancyAt, stampAt } = await law();
  const past = Math.floor(TOWN()) - 1;
  const text = await ledgerWithEntryAt(past);
  const within = await occupiedNowBy(WHO, { parseEnterExitLedger, occupancyAt, stampAt }, depsWith(text, TOWN));
  assert.deepEqual(within, [MARK],
    "a passage already crossed is not being counted — this test's negative case would then be vacuous");
});

test("THE DEFECT, REPRODUCED: the removed clock folds tomorrow's arrival in as though it were history", async (t) => {
  if (!HAVE) return t.skip(NO_CLONE);
  const { parseEnterExitLedger, occupancyAt, stampAt } = await law();
  const next = Math.floor(TOWN()) + 1;
  const text = await ledgerWithEntryAt(next);
  const within = await occupiedNowBy(WHO, { parseEnterExitLedger, occupancyAt, stampAt }, depsWith(text, UNIX_HALF_DAYS));
  assert.deepEqual(within, [MARK],
    "the old expression no longer reproduces #2690 — if this is failing, the arithmetic of the defect has changed and the test above needs re-deriving, not deleting");
});

test("THE RELATION: at the town's clock, a row counts exactly when its crossing has come", async (t) => {
  if (!HAVE) return t.skip(NO_CLONE);
  const { parseEnterExitLedger, occupancyAt, stampAt } = await law();
  const engine = { parseEnterExitLedger, occupancyAt, stampAt };
  const here = Math.floor(TOWN());
  let inside = 0, outside = 0;
  for (const offset of [-3, -1, 1, 3]) {
    const text = await ledgerWithEntryAt(here + offset);
    const within = await occupiedNowBy(WHO, engine, depsWith(text, TOWN));
    const shouldBeInside = offset < 0;
    assert.equal(within.length > 0, shouldBeInside,
      `a row at crossing ${here + offset} (now ${here}) was ${within.length ? "inside" : "outside"} and should have been ${shouldBeInside ? "inside" : "outside"}`);
    shouldBeInside ? inside++ : outside++;
  }
  assert.ok(inside > 0 && outside > 0, `one-sided matrix: ${inside} inside / ${outside} outside`);
});
