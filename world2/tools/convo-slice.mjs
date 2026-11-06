// convo-slice.mjs — A COOPERATIVE SLICE (POS-779): after `ms` of synchronous work, give the event loop a turn.
//
// The conversations door runs on the main thread, so a loop over 32,000 voices must not run to the end in one go. A loop
// calls `maybeYield()` every few dozen items; it costs one clock read, and only a slice that has run long enough costs an
// await. The clock and the yield are injectable, so a test counts yields on a call-driven clock instead of timing anything.
// (convo-components.mjs keeps its own, older one: it also enforces the work fuse in the same check.)

export function makeSlicer({ ms = 4, now = () => performance.now(), yieldFn = () => new Promise((r) => setImmediate(r)) } = {}) {
  let start = now();
  return {
    async maybeYield() {
      if (now() - start >= ms) { await yieldFn(); start = now(); }
    },
  };
}
