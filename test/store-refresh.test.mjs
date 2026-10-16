// store-refresh.test.mjs — the poll's store read: one in flight, and never
// forever (POS-639; the review of office#591).
//
// THE DEFECT THIS CLOSES. office#591 gave the poll a guard so a tick skips while
// the last roll+probe pair is still reading. The guard had no time bound, and
// the pen pool has no statement timeout, so one hung read would have stopped
// every index refresh for good, silently. The bound is the boot path's own
// (STORE_READ_BOUND_MS). Past it, the timeout is logged by name, the guard is
// freed, and the next tick reads again.
//
// THE FLIP: race the read against nothing (drop the bound in storeRefresher)
// and the first test hangs on the hung read until its own timeout.

import test from "node:test";
import assert from "node:assert/strict";
import { storeRefresher, STORE_READ_BOUND_MS } from "../src/store-refresh.mjs";

const never = () => new Promise(() => {});

test("a hung store read is released after the bound, named in the log, and the next tick reads again", { timeout: 5_000 }, async (t) => {
  // The bound's timer is unref'd, as it must be in the office (a pending bound
  // never keeps a process up), so here something has to hold the event loop
  // open the way the office's own server does. Without it, node 22 sees an
  // empty loop while the bound is pending and cancels the file (office#595's
  // first CI run: "Promise resolution is still pending but the event loop has
  // already resolved").
  const alive = setInterval(() => {}, 1_000);
  t.after(() => clearInterval(alive));
  const lines = [];
  let reads = 0, applied = 0;
  const r = storeRefresher({
    read: () => (++reads === 1 ? never() : Promise.resolve()),
    onRead: () => { applied++; },
    boundMs: 50,
    log: (l) => lines.push(l),
  });

  assert.equal(await r.tick(), "timed-out");
  assert.equal(r.inFlight(), false, "the guard is free again after the bound");
  assert.equal(applied, 0, "a read that never answered applied nothing");
  assert.deepEqual(lines, ["[office] the store read did not answer within 0.05s — the poll reads again on its next tick"]);

  assert.equal(await r.tick(), "read", "the next tick reads the store again");
  assert.equal(reads, 2);
  assert.equal(applied, 1, "and its answer is applied");
  assert.equal(lines.length, 1, "an answered read logs nothing");
});

test("one store read in flight: a tick while the last read is still reading skips", async () => {
  let release, reads = 0;
  const r = storeRefresher({ read: () => { reads++; return new Promise((ok) => { release = ok; }); }, boundMs: 5_000 });
  const first = r.tick();
  assert.equal(r.inFlight(), true);
  assert.equal(await r.tick(), "skipped");
  assert.equal(reads, 1, "the skipped tick started no second read");
  release();
  assert.equal(await first, "read");
  assert.equal(r.inFlight(), false);
});

test("a read that fails still frees the guard and applies, as the poll's swallowed errors always did", async () => {
  let applied = 0;
  const r = storeRefresher({ read: () => Promise.reject(new Error("the store refused")), onRead: () => { applied++; }, boundMs: 5_000 });
  assert.equal(await r.tick(), "read");
  assert.equal(r.inFlight(), false);
  assert.equal(applied, 1);
});

test("the poll's bound is the boot path's: 10 s", () => {
  assert.equal(STORE_READ_BOUND_MS, 10_000);
});
