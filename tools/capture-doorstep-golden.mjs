// capture-doorstep-golden.mjs — regenerate test/golden/doorstep-bundle.json.
//
// The golden is the finished doorstep bundle for the fixture town's `wright`,
// captured under the same pinned inputs test/foyer-shrink.test.mjs runs
// everything under (no world store, a frozen world block, AND A FROZEN CLOCK)
// so it is the same on every machine AT EVERY HOUR. It exists for ONE law, and
// the law is the morning page's:
//
//     the doorstep bundle does not fatten.
//
// The household door's shadow reads (`address`, `home`, `window`) grew a card
// beside their domain on 2026-08-31. `window` is a doorstep SEGMENT
// (src/town-index-store.mjs § doorstep), so a card that leaked into the read's composed
// form would land on every morning page ever served. This file is the
// before-picture that makes "it did not" a receipt rather than a claim.
//
//   node tools/capture-doorstep-golden.mjs > test/golden/doorstep-bundle.json
//
// ⚠ REGENERATE IT ONLY FROM A COMMIT YOU MEAN TO FREEZE. Re-capturing after a
// change makes the assertion say your change equals your change, which is the
// shape of a test that cannot fail. The one in the tree was captured at
// c552296 — the w37 train tip, BEFORE the shadow-read parity — from office.db;
// since POS-656 the page reads the store seeded from the same fixture rows, and
// the frozen picture is unchanged.
import { mkdtempSync, rmSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { fixtureTown } from "../test/fixture.mjs";
import { indexStore } from "../test/helpers/office-under-test.mjs";
// THE STANCE SEGMENT READS THE STORE (POS-195, 2026-09-22). `worldForStances`
// moved off the sqlite journal onto `claims` through `stance_reader`, so this
// page needs an office that HOLDS that credential — which is the office that
// exists after 023 is applied and `WORLD2_STANCE_URL` is set, and the one the
// morning page is actually served from. Without it the segment answers
// `unavailable`, which is a true sentence about a misconfigured office and the
// wrong picture to freeze.
//
// The stub reads a dynamic store of the capture's own, fresh and empty, so the
// live half of this page is the same on every machine (it read the tree's
// `dynamicDbPath()` until POS-491; see the capture below). Imported from `test/`
// like `fixtureTown` above, for the same reason: this tool and the falsifier must
// compose from ONE fixture.
import { stancePoolFromJournal, STANCE_ON } from "../test/stance-pool-stub.mjs";
import { doorstepBundle } from "../src/doorstep-bundle.mjs";

// ── THE FROZEN CLOCK (POS-168) ───────────────────────────────────────────────
//
// The third input that varied by machine, and the only one that also varied by
// HOUR. Six leaves of the page are a function of the wall clock —
// `next_crossing`'s number, instant and sentence, `rulings.since_crossing` and
// `rulings.through_crossing`, and `stakes.next_settlement.at` — so a golden
// captured at any real instant is red by the next crossing, which is what had
// happened: F7c5 was red at the baseline of every lane for days, and a golden
// that is always red gates nothing.
//
// It is exported because the falsifier must drive the door at the SAME instant
// this file captured at. Two files spelling one instant is how a doorstep and a
// receipt come to name different boats (crossings.mjs says exactly that about
// its own clock); there is one spelling, and the test imports it.
//
// WHY THIS INSTANT. The page's windows are six hours wide — crossings at
// 00:00/12:00Z (crossings.mjs § CROSSING_DERIVATION), settlements at 06:00/
// 18:00Z (world-forecast.mjs § SETTLEMENT_CLOCK) — so the boundaries fall at
// 00, 06, 12 and 18. 09:00Z is the midpoint of the 06:00–12:00 window: three
// hours of margin on either side, the most any instant can have. Freezing makes
// any instant reproducible; the midpoint makes the expected values re-derivable
// by hand without anyone being one millisecond from a different answer.
export const GOLDEN_NOW_MS = Date.parse("2026-09-21T09:00:00.000Z");

/**
 * The two skins, composed at the frozen instant under the pinned inputs.
 *
 * BOTH SKINS, because the shrink rides `slim` and the morning page has two
 * shapes: the unabridged one REST serves and the abridged one the connector
 * gets. A card leaking onto either is the regression this golden exists for.
 */
export async function captureDoorstepGolden({ nowMs = GOLDEN_NOW_MS } = {}) {
  delete process.env.TOWN_PUSH;
  delete process.env.TOWN_SINGLE_LOG;
  const dir = mkdtempSync(join(tmpdir(), "pm-doorstep-golden-"));
  // The fourth pinned input (POS-195): the stance credential, and a store that
  // answers from a dynamic store of its OWN, fresh and empty (POS-491). It read
  // `dynamicDbPath()`, the TREE's dynamic.db: whatever marks a machine's office
  // or a neighbouring test had left there rode onto the golden, so a capture on
  // one tree was red on every other, and on CI (no dynamic.db at all) always.
  Object.assign(process.env, STANCE_ON);
  stancePoolFromJournal(join(dir, "dynamic.db"));
  // the town index: a store seeded from the fixture town, read in this process
  const ix = await indexStore(fixtureTown(), { db: "doorstep_golden" });
  const restore = await ix.useInProcess();

  const ctx = { key: null, asOf: "fixturesha000000000000000000000000000000", canWrite: false, clone: null, pen: null, odb: null, nowMs };

  try {
    return {
      full: await doorstepBundle("wright", ctx),
      slim: await doorstepBundle("wright", { ...ctx, slim: true }),
    };
  } finally {
    await restore();
    await ix.stop();
    rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
  }
}

// The capture runs only when this file is the ENTRY POINT, so the falsifier can
// import `GOLDEN_NOW_MS` above and drive the door at the very instant that
// wrote the golden — a test that re-spells the tool's instant is testing its
// own copy.
// ── entry guard ──────────────────────────────────────────────────────────────
// The junction lesson (2026-09-05, HQ memory `junctions-defeat-main-guards`):
// `pathToFileURL(process.argv[1]).href === import.meta.url` is FALSE when the
// entry path reaches this file through a Windows junction — the ESM loader
// realpaths the entry, argv[1] is not — so the tool exits 0 having done nothing.
// Compare real paths (world2/tools/await-clearing.mjs's idiom); the URL compare is
// only the fallback for an argv[1] that cannot be realpath'd. The office's
// test/cli-guard.test.mjs imports this file and spawns it through a junction.
const isMain = (() => {
  if (!process.argv[1]) return false;
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return pathToFileURL(process.argv[1]).href === import.meta.url; }
})();
if (isMain) process.stdout.write(JSON.stringify(await captureDoorstepGolden()));
