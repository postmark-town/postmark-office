// settlement-receipt-parcel-captures.test.mjs — A PARCEL THAT NEWLY TOOK IN AN OLDER FOREIGN MARK REACHES THE KEEPER'S RECEIPT (WLD-224).
//
//   node --test test/settlement-receipt-parcel-captures.test.mjs
//
// Darko, 2026-11-20 15:48 EST: "isn't it just admit normally? and it gets flagged to the worldkeeper for coordination." The World
// admits the parcel and files the older mark under it as ever; its crossing report says when that happened
// (`parcel_captures`, World tools/parcel-captures.mjs). The keeper reads the whole latest receipt (GET /crossings/receipts), so this
// is where the flag is carried: by name, never as an outcome channel, a refusal, a quarantine or a status.
//
// Each case drives the receipt through its real entry point (the script, with the env `settlement-auto.sh § report` sets), so a
// fixture cannot pass by calling a function the crossing does not call. Invented residents and marks.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { parcelCapturesOf, CAPTURES_SHOWN } from "../deploy/parcel-captures-reading.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RECEIPT = join(ROOT, "deploy", "settlement-receipt.mjs");

const CHANNELS = ["published", "unpublished", "left_drafted", "withdrawn", "quarantined", "suite_quarantined", "dropped", "rebased"];
const sweepOf = (over = {}) => ({
  ...Object.fromEntries(CHANNELS.map((c) => [c, []])),
  surveyed: { branches: 5, delta_rows: 17, escrow_backed_deltas: 3 },
  ...over,
});

/** The sweep's own event, as World tools/parcel-captures.mjs writes it. */
const event = (over = {}) => ({
  parcel: "ola/the-low-house-parcel", parcel_household: "hh:ola", parcel_by: "ola", parcel_laid: "2026-11-18T09:00:00.000Z",
  mark: "pip/the-cafe", mark_household: "hh:pip", mark_by: "pip", mark_laid: "2026-11-06T08:00:00.000Z", mark_tier: "market",
  overlap_m2: 100, mark_area_m2: 100, ...over,
});
const captures = (events = [event()], over = {}) => ({ checked: true, parcels_checked: 1, events, ...over });

/** Compose a receipt the way settlement-auto.sh's `report` function does. */
function compose({ sweep = sweepOf(), status = "published", detail = "1 published" } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "receipt-captures-"));
  try {
    const env = {
      ...process.env,
      SETTLEMENT_STATUS: status, SETTLEMENT_DETAIL: detail, SETTLEMENT_AT: "2026-11-20T17:45:00Z", SETTLEMENT_SOURCE_MODE: "store",
      SETTLEMENT_TOWN_SHA: "5392664e1aa0f6e2f1e0f4a1a1f0c2d3e4f5a6b7",
      SETTLEMENT_WORLD_FROM: "49bd1829b8ebef37ef12428b3412982145b8af92", SETTLEMENT_WORLD_TO: "3a3a645c2c5411f0426fd045efcb3f2ea36e1611",
    };
    for (const k of ["SETTLEMENT_REFUSAL_JSON", "SETTLEMENT_STORE_JSON", "SETTLEMENT_DRAIN_JSON", "SETTLEMENT_RETIRE_JSON",
                     "SETTLEMENT_ISOLATE_JSON", "SETTLEMENT_HARM_JSON", "SETTLEMENT_SUITE_JSON", "SETTLEMENT_REGISTRY_JSON"]) delete env[k];
    const sweepPath = join(dir, "sweep.json");
    writeFileSync(sweepPath, JSON.stringify(sweep));
    env.SETTLEMENT_SWEEP_JSON = sweepPath;
    return JSON.parse(execFileSync(process.execPath, [RECEIPT], { encoding: "utf8", env }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("THE FALSIFIER: a parcel that took in an older foreign mark reaches the keeper's actual receipt, by name, and the crossing is otherwise what it was", () => {
  const quiet = compose();
  const r = compose({ sweep: sweepOf({ published: [{ id: "ola/the-low-house-parcel", household: "ola", class: "parcel" }], parcel_captures: captures() }) });
  assert.deepEqual(r.parcel_captures, {
    checked: true, parcels_checked: 1, events_total: 1,
    events: [{
      parcel: "ola/the-low-house-parcel", parcel_household: "hh:ola", parcel_by: "ola", parcel_laid: "2026-11-18T09:00:00.000Z",
      mark: "pip/the-cafe", mark_household: "hh:pip", mark_by: "pip", mark_laid: "2026-11-06T08:00:00.000Z", mark_tier: "market",
      overlap_m2: 100, mark_area_m2: 100,
    }],
  }, "both marks, both canonical households, who laid each and when, and the measured overlap");
  // a note, not a verdict: no status, class, refusal, quarantine or channel moved
  for (const k of ["status", "class", "refusal", "next_step", "quarantined", "harm", "suite", "isolated"]) assert.deepEqual(r[k], quiet[k], `${k} is as on a quiet night`);
  assert.equal(r.status, "published");
  assert.equal("refused" in r, false, "it is not a refused mark");
  assert.equal("channels_unnamed" in r, false, "and not an outcome channel the composer would name as unknown");
  assert.deepEqual(r.channels.quarantined, 0);
});

test("a quiet night is byte-identical: no key for a sweep that says nothing (a World without the check), nor for one that looked and found nothing", () => {
  const quiet = compose();
  assert.equal("parcel_captures" in quiet, false, "a World that predates the check: the receipt is exactly what it was");
  const lookedNone = compose({ sweep: sweepOf({ parcel_captures: { checked: true, parcels_checked: 3, events: [] } }) });
  assert.deepEqual(Object.keys(lookedNone), Object.keys(quiet), "looked, none taken in: the same key list as the frozen ordinary receipt");
  assert.deepEqual(lookedNone, quiet);
});

test("absent is not empty: a look that failed is carried with its reason, so a blind night is never read as a quiet one", () => {
  const r = compose({ sweep: sweepOf({ parcel_captures: { checked: false, why: "the folded world could not be read, so nobody looked for a parcel taking in an older mark" } }) });
  assert.deepEqual(r.parcel_captures, { checked: false, why: "the folded world could not be read, so nobody looked for a parcel taking in an older mark" });
  assert.equal(r.status, "published", "and it changes no status");
});

test("what the receipt copies is the whitelist, the cap says its total, and a malformed line is read as nothing rather than breaking the crossing", () => {
  const many = Array.from({ length: CAPTURES_SHOWN + 5 }, (_, i) => event({ mark: `pip/stall-${String(i).padStart(2, "0")}`, secret: "never copied", overlap_m2: "7" }));
  const got = parcelCapturesOf(sweepOf({ parcel_captures: captures(many) }));
  assert.equal(got.events.length, CAPTURES_SHOWN);
  assert.equal(got.events_total, CAPTURES_SHOWN + 5, "the total is always said");
  assert.equal("secret" in got.events[0], false, "a field the composer does not name is not carried");
  assert.equal(got.events[0].overlap_m2, null, "a number that is not one is null, not guessed");
  for (const bad of [undefined, null, "x", 3, [], [event()], { events: "no" }]) assert.equal(parcelCapturesOf(sweepOf({ parcel_captures: bad })), null, `parcel_captures ${JSON.stringify(bad)} says nothing`);
  assert.equal(parcelCapturesOf(null), null);
  const r = compose({ sweep: sweepOf({ parcel_captures: [event()] }) });
  assert.equal("parcel_captures" in r, false, "an array (an older shape of nothing) is not read as captures");
  assert.equal(r.channels_unnamed, undefined, "and is still no unnamed channel: the key is named, not a channel");
});
