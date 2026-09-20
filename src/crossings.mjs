// crossings.mjs — the town clock, in one place.
//
// The RATIFIED derivation (Keemin, 2026-07-29), lifted VERBATIM out of
// src/world.mjs when a second reader needed it. Its own words, unchanged:
//
//   "Fog is the crossing's weather and seeds from the crossing number
//    (ENGINE.md). The ruling: crossings run 00:00 / 12:00 UTC (the ferry's
//    clock), counted from the mail-ledger's first delivery day (2026-06-12).
//    This derivation IS the town clock; raw ferry-run counts (which include
//    off-timetable catch-up boats) are operational history, not the calendar.
//    Crossing 100 lands 2026-08-01 00:00 UTC."
//
// WHY IT MOVED. `world.mjs` is 1,600 lines that open a sqlite store, resolve a
// world clone, and pull in graphology at import — so a small tool that needs
// nothing but "how many crossings old is this?" could not import it without
// dragging the whole world in. The two honest options were a second copy of the
// arithmetic (which is how two clocks are born) or this file. `world.mjs` now
// imports and re-exports `currentCrossing`, so every existing caller is
// untouched and there is still exactly one place the ruling lives.
//
// FIRST OUTSIDE CALLER: tools/stripe-watch.mjs, whose grace window before a card
// payment becomes a receipt is measured in crossings.

// 2026-06-12T00:00Z — the mail-ledger's first delivery day.
export const CROSSING_EPOCH_UTC = Date.UTC(2026, 5, 12);
export const CROSSING_MS = 12 * 3600 * 1000;
export const CROSSING_DERIVATION =
  "12h crossings (00:00/12:00 UTC) since the ledger's first delivery day 2026-06-12";

export function currentCrossing(now = Date.now()) {
  return Math.max(0, Math.floor((now - CROSSING_EPOCH_UTC) / CROSSING_MS));
}

// ── THE NEXT CROSSING, AS A THING A WRITER CAN READ (postmark#2922) ──────────
//
// Pica: "show when the next ferry crossing is on the doorstep or send receipt,
// so you know if your letter makes this crossing or waits." The office already
// kept this clock in two files — the number here, and `write.mjs § nextCrossing`
// walking its own `CROSSINGS_UTC = [0, 12]` for the next instant — and two
// files with one clock is how a doorstep and a receipt come to name different
// boats. The instant is derived HERE, from the same epoch and interval the
// number is, and write.mjs's `nextCrossing` now reads it.
//
// `crossing` is the number of the boat: the ratified derivation above says
// "Crossing 100 lands 2026-08-01 00:00 UTC" — crossing N lands at
// epoch + N × 12h — so the boat that sails at the end of the current interval
// is `currentCrossing() + 1`. The doorstep and the receipt both name it, which
// is what lets a writer tell whether the boat their morning page named is the
// one their letter caught: same number, same boat.
//
// A letter rides the first crossing after the instant it is written. There is
// no cutoff to invent: the ferry drains the town log when it runs
// (deploy/postmark-ferry.service), so a letter logged before 00:00Z is aboard
// and one logged after waits for 12:00Z — exactly what "the next crossing after
// now" says. `minutes_away` is rounded UP so a reader at 11:59:30Z is told 1,
// never 0, and it is a number about the instant the page was composed.

/** The instant the next crossing sails, as ISO, from the town clock's own epoch. */
export function nextCrossingAt(now = Date.now()) {
  const n = typeof now === "number" ? now : new Date(now).getTime();
  return new Date(CROSSING_EPOCH_UTC + (currentCrossing(n) + 1) * CROSSING_MS).toISOString();
}

/** `{ crossing, at, minutes_away }` — the boat's number, when it sails, how far off. */
export function nextCrossingBlock(now = Date.now()) {
  const n = typeof now === "number" ? now : new Date(now).getTime();
  const at = nextCrossingAt(n);
  return {
    crossing: currentCrossing(n) + 1,
    at,
    minutes_away: Math.max(1, Math.ceil((Date.parse(at) - n) / 60000)),
  };
}

/**
 * The doorstep's block: the page is read BEFORE a letter is written.
 *
 * NO `minutes_away` HERE, and the reason is the page's own law. The doorstep is
 * one implementation behind two doors (REST and the connector), and the suite
 * holds the two answers deep-equal — "the tense must not be a property of the
 * skin you read from". A minute counter composed at two instants a few seconds
 * apart straddles a minute boundary often enough to make that law flap
 * (measured: the parity leg reddened on its first run with the counter on). The
 * boat's number and instant are stable for twelve hours; the minutes ride the
 * RECEIPT, which is composed exactly once, for one act.
 */
export function nextCrossingForDoorstep(now = Date.now()) {
  const { crossing, at } = nextCrossingBlock(now);
  return { crossing, at,
    sentence: `crossing ${crossing} sails at ${at}. A letter written before then rides it; one written after goes on the crossing after.` };
}

/**
 * The receipt's sentence: the letter is written, and the boat it rides is the
 * first one after `writtenAt`. The ordinary receipt says so. A receipt handed
 * back for a letter STILL STANDING after its own boat has sailed — a retry with
 * the same nonce, read after the crossing the first receipt named — says that
 * instead, and names the boat it goes on now: "this crossing has sailed".
 */
export function nextCrossingForReceipt(now = Date.now(), { writtenAt = null } = {}) {
  const n = typeof now === "number" ? now : new Date(now).getTime();
  const b = nextCrossingBlock(n);
  const w = writtenAt == null ? null : (typeof writtenAt === "number" ? writtenAt : Date.parse(writtenAt));
  const first = Number.isFinite(w) ? nextCrossingAt(w) : null;
  const sailed = first !== null && Date.parse(first) <= n;
  return { ...b,
    sentence: sailed
      ? `this crossing has sailed (${first}); yours goes at ${b.at} — crossing ${b.crossing}, ${b.minutes_away} minute${b.minutes_away === 1 ? "" : "s"} away`
      : `sails at the next crossing, ${b.at} — crossing ${b.crossing}, ${b.minutes_away} minute${b.minutes_away === 1 ? "" : "s"} away` };
}
