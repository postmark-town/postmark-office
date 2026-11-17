// pos-1086-segment-timing.test.mjs — per-segment timing of the doorstep composition (POS-1086, step 1: MEASUREMENT ONLY).
//
// `doorstepBundleOf` times each segment (core, stances, rulings, stakes, alerts, posts, holds, votes, and the owner gate's pieces) under its request, into
// `timing.bundle.seg = { <name>: { n, sum_ms, max_ms } }` (read-timing.mjs § segSpan). The body returned must be byte-identical with timing on or off.
//
// FLIP: in src/doorstep-bundle.mjs, change the `stances` line to call `stancesForHandles(...)` directly (drop its `segSpan("stances", ...)` wrapper): the
// `seg` assertion for "stances" reddens. Drop the wrapper on `ix.doorstep` and "core" goes.
//   node --test test/pos-1086-segment-timing.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { fixtureTown } from "./fixture.mjs";
import { indexStore } from "./helpers/office-under-test.mjs";
import { doorstepBundle } from "../src/doorstep-bundle.mjs";
import { newTiming, runTiming, timingLine } from "../src/read-timing.mjs";

delete process.env.TOWN_PUSH;
const IX = await indexStore(fixtureTown(), { db: "pos1086_seg" });
const RESTORE = await IX.useInProcess();
test.after(async () => { await RESTORE(); await IX.stop(); });
const tis = await import("../src/town-index-store.mjs");

const NOW = Date.parse("2026-07-12T09:30:00Z");
const compose = (key) => doorstepBundle("wright", { key, asOf: undefined, canWrite: false, clone: null, odb: null, ix: tis.storeIndexPooled(null), nowMs: NOW });

const PUBLIC = ["core", "fresh", "stances", "rulings", "stakes", "alerts", "posts", "holds"];
const GATE = ["gate_next_steps"];
const OWN = ["gate_hot_tense", "gate_unread", "gate_paper_gaps"];

test("the body is byte-identical with timing on, and `seg` carries the named segments (public read)", async () => {
  const off = await compose(null);
  const tm = newTiming();
  const on = await runTiming(tm, () => compose(null));
  assert.equal(JSON.stringify(on), JSON.stringify(off), "measurement only: the doorstep body does not change");
  const line = timingLine(tm, { door: "doorstep", status: 200 });
  assert.equal(line.bundle.n, 1);
  const seg = line.bundle.seg;
  assert.ok(seg && typeof seg === "object", "bundle.seg is on the access line's timing");
  for (const name of [...PUBLIC, ...GATE]) {
    assert.ok(seg[name], `segment ${name} was timed`);
    assert.ok(seg[name].n >= 1, `${name}.n >= 1`);
    assert.ok(Number.isFinite(seg[name].sum_ms) && Number.isFinite(seg[name].max_ms), `${name} carries sum_ms and max_ms`);
  }
  assert.equal(seg.stances.n, 1, "one stances composition per doorstep");
});

test("the owner gate's pieces are timed on a read by the house's own key, body unchanged", async () => {
  const key = { household: "h", handles: new Set(["wright"]) };
  const off = await compose(key);
  const tm = newTiming();
  const on = await runTiming(tm, () => compose(key));
  assert.equal(JSON.stringify(on), JSON.stringify(off));
  const seg = timingLine(tm, { door: "doorstep", status: 200 }).bundle.seg;
  for (const name of [...PUBLIC, ...GATE, ...OWN]) assert.ok(seg[name]?.n >= 1, `segment ${name} was timed`);
});

test("no request in scope: nothing is recorded and the call is the bare one", async () => {
  const tm = newTiming();
  await compose(null); // outside runTiming
  assert.equal(tm.bundle.seg, undefined);
});
