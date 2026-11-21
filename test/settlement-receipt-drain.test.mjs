// settlement-receipt-drain.test.mjs — a replaced drain is not a missed step (POS-1127).
//
// The Worldkeeper's S178 review read every receipt's `drain: { ran: false, reason: "the drain step did not
// run for this crossing" }` as a fault and went looking for a drain to run. The store's write-down (G1) does
// that work; the journal drain (`src/world-drain.mjs`) has no caller at settlement. So when no drain report
// came and this crossing's STORE report did, the receipt says what replaced it (`superseded_by: "store"`);
// when neither came, it is a real miss and keeps its words. A real drain's own record is its own.
//
// "The store ran" is the PRESENCE of its report: no `ran` field on the input, and no positive write count
// (a store crossing that wrote nothing still ran).
//
// This drives the actual writer (deploy/settlement-receipt.mjs) over invented reports, the way
// settlement-receipt-reason.test.mjs composes a receipt. Invented content only.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RECEIPT = join(ROOT, "deploy", "settlement-receipt.mjs");

const MISS = { ran: false, reason: "the drain step did not run for this crossing" };
const REPLACED = { ran: false, superseded_by: "store", reason: "the store's write-down replaces the journal drain since G1" };

/** Compose a receipt the way settlement-auto.sh's `report` function does: each report is a JSON file named by its env variable. */
function compose({ drain, store } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "receipt-drain-"));
  try {
    const env = { ...process.env, SETTLEMENT_STATUS: "published", SETTLEMENT_AT: "2026-11-21T06:00:00Z" };
    for (const k of ["SETTLEMENT_TOWN_SNAPSHOT", "SETTLEMENT_DRAIN_JSON", "SETTLEMENT_STORE_JSON"]) delete env[k];
    const put = (name, body) => { const p = join(dir, name); writeFileSync(p, JSON.stringify(body)); return p; };
    env.SETTLEMENT_SWEEP_JSON = put("sweep.json", { published: [], unpublished: [] });
    if (drain !== undefined) env.SETTLEMENT_DRAIN_JSON = put("drain.json", drain);
    if (store !== undefined) env.SETTLEMENT_STORE_JSON = put("store.json", store);
    return JSON.parse(execFileSync(process.execPath, [RECEIPT], { encoding: "utf8", env }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("no drain report and the store's report present: replaced by the store, ran stays false, not a fault", () => {
  const r = compose({ store: { marks: 12, written: 3 } });
  assert.deepEqual(r.drain, REPLACED);
  assert.equal(r.store.ran, true, "the store ran");
});

test("the store's own `ran` field and a positive write count are not the evidence: its report is. A store that wrote nothing still ran", () => {
  const zero = compose({ store: { marks: 0, written: 0 } });
  assert.deepEqual(zero.drain, REPLACED, "zero store writes still means the step ran");
  const bare = compose({ store: {} });
  assert.deepEqual(bare.drain, REPLACED, "an empty report is still a report");
  const liar = compose({ store: { ran: false, marks: 0 } });
  assert.deepEqual(liar.drain, REPLACED, "no `ran` property on the input is consulted");
});

test("neither report: the real miss keeps its words", () => {
  const r = compose({});
  assert.deepEqual(r.drain, MISS);
  assert.equal(r.store.ran, false, "and the store did not run either");
});

test("a real drain's record is its own: success and refusal are never turned into 'superseded'", () => {
  const ok = compose({ drain: { drained: 4, cursor: "c1", head: "h1", remaining: 0, households: [{ household: "ana-one", changed: true }, { household: "bo-three", changed: false }], state_commit: "abc" }, store: { marks: 1 } });
  assert.deepEqual(ok.drain, { ran: true, drained: 4, cursor: "c1", head: "h1", remaining: 0, households: ["ana-one"], state_commit: "abc" });
  assert.equal("superseded_by" in ok.drain, false);
  const zero = compose({ drain: { drained: 0 } });
  assert.equal(zero.drain.ran, true, "'drained: 0' is the receipt that it RAN");
  const refused = compose({ drain: { refused: "the journal is behind", detail: "d" }, store: { marks: 1 } });
  assert.deepEqual(refused.drain, { ran: true, refused: "the journal is behind", detail: "d" });
});

test("CAN-FAIL: wrongly marking every miss superseded, or never marking the replaced case, is red here", () => {
  // the two cases must differ, in both directions
  assert.notDeepEqual(compose({ store: { marks: 1 } }).drain, compose({}).drain);
  assert.equal(compose({}).drain.superseded_by, undefined, "a real miss is never called superseded");
  assert.equal(compose({ store: { marks: 1 } }).drain.superseded_by, "store");
});
