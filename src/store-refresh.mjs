// store-refresh.mjs — the poll's store read: one in flight, and never forever.
//
// ONE STORE READ IN FLIGHT (POS-639). The office's poll used to start a roll
// and a probe read every RELOAD_POLL_MS whether the last pair had answered or
// not. On a loaded machine they piled up, and an older read finishing after a
// newer one put the older index back. A tick that finds the last pair still
// reading skips.
//
// THE BOUND IS POSTGRES'S, AND THE GUARD WAITS FOR IT (the reviews of office#591
// and #595). The pen pool sets no statement timeout, so a read that hung would
// have held the guard for good. #595's first answer, a JS race that freed the
// guard at the bound, freed the guard and NOT the connection: the next tick took
// a third connection and queued for a fourth, and the pen pool is three per
// thread (world2-pen.mjs § pool), shared with every resident read and write.
// The poll would have held the whole pen, and residents met StoreAcquireTimeout.
// So the bound rides each read itself: the poll's two reads run with
// statement_timeout = STORE_READ_BOUND_MS (server.mjs), Postgres cancels a read
// that runs past it, and the guard is freed only when the read has SETTLED. The
// poll therefore holds at most the pair's two connections. The JS timer here
// only names the moment the bound passed, in the journal.

/** The bound a store read gets, in the poll and at boot. */
export const STORE_READ_BOUND_MS = 10_000;

/**
 * A tick for the poll. `read()` is the roll+probe pair, answering a promise;
 * `onRead()` runs after it settles (answered or refused, as the poll's swallowed
 * errors always did). Answers `tick()`, which starts one read unless one is in
 * flight and resolves when that read settles, and `inFlight()`.
 */
export function storeRefresher({ read, onRead = () => {}, boundMs = STORE_READ_BOUND_MS, log = console.error,
  setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  let reading = false;
  async function tick() {
    if (reading) return "skipped";
    reading = true;
    let late = false;
    const timer = setTimer(() => {
      late = true;
      log(`[office] the store read has not answered within ${boundMs / 1000}s — the store's statement timeout ends it, and the poll waits for it before reading again`);
    }, boundMs);
    timer?.unref?.();
    try {
      await Promise.resolve().then(read).catch(() => {});
      onRead();
      return late ? "late" : "read";
    } finally {
      clearTimer(timer);
      reading = false;
    }
  }
  return { tick, inFlight: () => reading };
}
