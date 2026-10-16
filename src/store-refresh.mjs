// store-refresh.mjs — the poll's store read: one in flight, and never forever.
//
// ONE STORE READ IN FLIGHT (POS-639). The office's poll used to start a roll
// and a probe read every RELOAD_POLL_MS whether the last pair had answered or
// not. On a loaded machine they piled up, and an older read finishing after a
// newer one put the older index back. A tick that finds the last pair still
// reading skips.
//
// AND THE GUARD IS BOUNDED (the review of office#591). The pen pool sets no
// statement timeout, so a read that hangs would hold the guard for good and the
// office would stop reading its index without a word. The boot path already
// races its first read against 10 s (server.mjs § AT BOOT); the poll uses the
// same bound. Past it the tick logs the timeout by name and frees the guard, so
// the next tick reads again. The hung read is not cancelled. If it ever answers
// it may hold an older probe for a moment, which the next tick replaces: a probe
// re-reads whenever the store's as-of differs from the one it holds.

/** The bound a store read gets, in the poll and at boot. */
export const STORE_READ_BOUND_MS = 10_000;

/**
 * A tick for the poll. `read()` is the roll+probe pair, answering a promise;
 * `onRead()` runs after it answers. Answers `tick()`, which starts one read
 * unless one is in flight, and resolves when that read answers or the bound
 * passes. `inFlight()` says whether a read holds the guard.
 */
export function storeRefresher({ read, onRead = () => {}, boundMs = STORE_READ_BOUND_MS, log = console.error,
  setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  let reading = false;
  async function tick() {
    if (reading) return "skipped";
    reading = true;
    let timer;
    const bound = new Promise((ok) => {
      timer = setTimer(() => ok("timed-out"), boundMs);
      timer?.unref?.();
    });
    try {
      const how = await Promise.race([Promise.resolve().then(read).then(() => "read", () => "read"), bound]);
      if (how === "timed-out") {
        log(`[office] the store read did not answer within ${boundMs / 1000}s — the poll reads again on its next tick`);
        return how;
      }
      onRead();
      return how;
    } finally {
      clearTimer(timer);
      reading = false;
    }
  }
  return { tick, inFlight: () => reading };
}
