import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../src/world.mjs", import.meta.url), "utf8");

test("#2859: enter_on_arrival does not re-stop the walk that already arrived", () => {
  const start = source.indexOf("if (enterOnArrival) {");
  assert.notEqual(start, -1, "walkViaOffice still has the enter_on_arrival branch");

  const end = source.indexOf("\n  return {", start);
  assert.notEqual(end, -1, "the enter_on_arrival branch is bounded before the walk reply");

  // The branch composes its deps in ONE function (WLD-5 moved them there, so a
  // test can drive the composition itself): the ordinary crossing deps go in.
  const block = source.slice(start, end);
  assert.notEqual(block.indexOf("arrivalEntryDeps(crossingDeps(),"), -1,
    "arrival entry still starts from the ordinary crossing dependencies, through arrivalEntryDeps");

  const fn = source.indexOf("export function arrivalEntryDeps(");
  assert.notEqual(fn, -1, "arrivalEntryDeps is where the arrival's overrides live");
  const body = source.slice(fn, source.indexOf("\n}\n", fn));
  const spread = body.indexOf("...base,");
  const walking = body.indexOf("walking: null,");
  const stop = body.indexOf("stop: typeof base?.stop");
  const now = body.indexOf("now: () => arrivedAtCrossing,");

  assert.notEqual(spread, -1, "the overrides start from the base deps");
  assert.ok(walking > spread, "arrival entry explicitly disables the manual-entry walking hook after spreading the base");
  // WLD-5: the stop is no longer null. With `walking` null the only stop an
  // entry can issue is a portal's landing, and that one is dated at the arrival.
  assert.ok(stop > walking, "the stop is overridden after the spread too: the base's stop, dated at the arrival");
  assert.notEqual(body.indexOf("at: arrivedAtCrossing"), -1, "and its date is the arrival crossing");
  assert.ok(now > stop, "the arrival-time override remains after the hooks");
});

// ── THE SAME RULING, READ AS BEHAVIOUR ──────────────────────────────────────
//
// The test above reads src/world.mjs as text. That is the one job no behavioural
// check can do here — `walkViaOffice` composes its deps with a spread and two
// overrides, and if `...crossingDeps()` ever moved BELOW them it would put the
// hooks back with nothing to notice. It is also all that test can do: it never
// runs an entry, so it cannot see whether nulling those two hooks actually stops
// the second stop. A green light on the shape of the wiring is not a green light
// on the behaviour, so the rest of this file runs the door.
//
// What Sophia Familiaris reported is reproduced here first, then shown absent:
// an entry that SUCCEEDS while `walk_ended.recorded` is false, because the stop
// issued after it is judged as a fresh outbound walk out of the room the
// resident just entered.
//
// The harness is test/world-crossings.test.mjs's, deliberately: the same real
// clone, the same injected pen, so a drift between office and world fails here
// rather than in front of a resident. No clone, and these SKIP rather than pass.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { NO_WORLD, worldClone } from "./fixture-paths.mjs";

// It resolved `join(process.cwd(), "..", "postmark-world")` — a different
// directory in every tree, and in a pool tree a sibling slot that is not
// there, so every case below SKIPPED while a world clone sat beside the
// office the whole time. A silent skip is not a pass.
const CLONE = worldClone();
const GRAMMAR = CLONE && ["enter-exit.mjs", "thresholds.mjs"].find((n) => existsSync(join(CLONE, "tools", n)));
const HAVE_CLONE = !!GRAMMAR;
const WHY_NOT = CLONE ? `the world clone at ${CLONE} is missing the enter-exit grammar or WORLD/world-state.json` : NO_WORLD;
const SHIP = "the-town/the-post-office";
const WHO = "postmaster";
const AT = 200;

// The exact bounce the resident saw, quoted from the letter on
// postmark-town/postmark#2859 — the stop is refused because the entry that
// preceded it already put the walker inside the room the stop would leave.
const THE_REFUSAL = "You are within current-the-reader/the-taproom — this walk would carry you out of it without leaving.";

/** One office in a closure, with the walk hooks made observable.
 *  `hooks: "manual"` is what crossingDeps() hands an ordinary entry;
 *  `hooks: "arrival"` is the composition walkViaOffice itself hands the door
 *  (world.mjs § arrivalEntryDeps, over these same manual hooks). */
async function officeWith({ hooks, stopThrows = false, standing = { x: -9, y: 35.5 } }) { // POS-220: the post office's anchor — a door is entered only from within its extent, so the walker stands AT it (the old { -30, 40 } was ~21 m off, inside the retired 60 m reach)
  const worldState = JSON.parse(readFileSync(join(CLONE, "WORLD", "world-state.json"), "utf8"));
  const mod = await import(`file:///${join(CLONE, "tools", GRAMMAR).replace(/\\/g, "/")}`);
  const thresholds = mod.parseEnterExitLedger ? mod : { ...mod, parseEnterExitLedger: mod.parseThresholdLedger };
  let text = "";
  const stops = [];
  const walkHook = async () => ({ live: true, x: standing.x, y: standing.y });
  const stopHook = async (who, here) => {
    stops.push({ who, here });
    if (stopThrows) { const e = new Error(THE_REFUSAL); e.defect = THE_REFUSAL; throw e; }
    return {};
  };
  return {
    stops,
    deps: {
      world: async () => worldState,
      ledger: async () => text,
      standpointOf: async (who) => ({ ...standing, name: who }),
      now: () => AT,
      // The one line under test. An ordinary entry gets the hooks; the
      // arrival-bundled entry is handed null for both, which is exactly the
      // override src/world.mjs writes after spreading crossingDeps().
      walking: walkHook,
      stop: stopHook,
      record: async ({ lines, handle }) => {
        text += lines.join("\n") + "\n";
        const acts = thresholds.parseEnterExitLedger(text).acts;
        return { lines, within: thresholds.occupancyAt(acts, AT).get(handle) ?? [], commit: "deadbeef", pushed: false };
      },
    },
  };
}

const { arrivalEntryDeps } = await import("../src/world.mjs");
const enter = (deps) => import("../src/world-crossings.mjs")
  .then((m) => m.enterViaOffice(CLONE, { mark: SHIP, handle: WHO, accept: true }, { handles: new Set([WHO]) }, deps));

test("an ORDINARY entry still ends the walk that carried you there — the fix takes nothing away from it",
  { skip: !HAVE_CLONE && WHY_NOT }, async () => {
  const o = await officeWith({ hooks: "manual" });
  const answer = await enter(o.deps);

  assert.ok(answer.entered.length > 0, "the fixture must actually enter, or nothing below is exercised");
  assert.equal(o.stops.length, 1, "a manual entry by a walking resident writes the stop — #2685, and it is still law");
  assert.equal(answer.walk_ended?.recorded, true);
  assert.deepEqual(answer.walk_ended.at, { x: -9, y: 35.5 });
});

test("#2859 · the reported contradiction, reproduced: a successful entry whose own stop is refused",
  { skip: !HAVE_CLONE && WHY_NOT }, async () => {
  // This is the answer the resident was handed. It is the manual-entry wiring
  // reaching an arrival that has already happened — entry succeeds, and the
  // same response says the walk could not be terminated.
  const o = await officeWith({ hooks: "manual", stopThrows: true });
  const answer = await enter(o.deps);

  assert.ok(answer.entered.length > 0, "entry succeeds");
  assert.equal(answer.walk_ended.recorded, false, "and the same answer refuses its own stop");
  assert.match(answer.walk_ended.error, /would carry you out of it without leaving/);
});

test("#2859 · the arrival-bundled entry attempts no stop at all, so it cannot contradict itself",
  { skip: !HAVE_CLONE && WHY_NOT }, async () => {
  // The same door, the same refusing stop hook available in principle — but
  // walkViaOffice hands the arrival composition `walking: null` (world.mjs §
  // arrivalEntryDeps, driven here over the very hooks that refuse), so the
  // walk-ending stop is never consulted, and a hook that is never consulted
  // cannot refuse. The walk needs no stop here: it is a departure whose position
  // is a function of the clock, and it has already arrived. (Its `stop` is still
  // there, dated at the arrival, for the one stop an entry can still issue: a
  // portal's landing, test/wld5-walk-enter-landing.test.mjs. The Post Office is
  // a vehicle stop, not a WLD-5 portal, so it issues none.)
  const o = await officeWith({ hooks: "arrival", stopThrows: true });
  const answer = await enter(arrivalEntryDeps(o.deps, { arrivedAtCrossing: AT, toward: { x: -9, y: 35.5 }, who: WHO }));

  assert.ok(answer.entered.length > 0, "entry still succeeds — the fix changes nothing about the threshold");
  assert.equal(o.stops.length, 0, "no second stop is attempted after an arrival that already happened");
  assert.equal("walk_ended" in answer, false,
    "and the answer carries no walk_ended at all — there is no half-truth for a reader to trip over");
});
