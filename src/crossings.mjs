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

// ── WHAT THE OFFICE'S COPY HAS CAUGHT UP TO (POS-332) ────────────────────────
//
// The doorstep's `as_of` is a COMMIT: the town record the office's copy (the
// store's town index, or office.db) was built from. Kogane, office hours
// 2026-10-02: "as_of came back as a commit, not a time", and Little Bird had
// nothing to hold it against. Nyx logged ten reads that trailed a crossing and
// asked for "the settle stamp the index is serving, on the doorstep read".
//
// So beside the commit the page says, from the copy's OWN record of the town's
// commits (repo_log, the index's history table), two times: the newest change
// the copy holds, and the newest crossing it holds, which is the crossing's
// seal. The Postmark Pen closes every crossing with one commit of this subject
// (the town index's ingest snapshots at exactly these commits,
// world2/tools/town-index-ingest.mjs), after the delivery, the mint and the
// quests. A copy that holds the seal holds the whole crossing. Its number is
// the town clock's for the instant it was sealed, so it is the same number
// `next_crossing` and a send receipt name: the copy is caught up when it holds
// the last crossing the timetable has sailed.
export const CROSSING_SEAL_SUBJECT = "seal: re-seal at the crossing";

/**
 * WHEN A WALK ARRIVES, ON THE WALL CLOCK (POS-331 part 3; Office Hours Q8).
 *
 * Amia dispatched a walk at crossing 225.44, worked out 0.04 crossings, and
 * arrived two hours before she meant to: the conversion to her own clock was
 * hers to do, and a timezone slipped in it. So the answers that give
 * `eta_crossings` give the instant too: `fromCrossing + etaCrossings` on this
 * clock, as ISO UTC. `eta_crossings` is in hundredths of a crossing (7.2
 * minutes), so the instant is good to about four minutes either way and is said
 * to the minute, no finer. Null when either is unreadable.
 */
export function arrivesAt(fromCrossing, etaCrossings) {
  if (fromCrossing == null || etaCrossings == null) return null;
  const c = Number(fromCrossing) + Number(etaCrossings);
  if (!Number.isFinite(c)) return null;
  return new Date(Math.round((CROSSING_EPOCH_UTC + c * CROSSING_MS) / 60_000) * 60_000).toISOString();
}

/** The instant crossing `n` sails by the timetable, as ISO. */
export const crossingSailsAt = (n) => new Date(CROSSING_EPOCH_UTC + n * CROSSING_MS).toISOString();

/**
 * The crossing a copy holds, from its newest seal (`{ at }`, or null): its
 * number on the town clock and the seal's instant. ONE place says it, so the
 * doorstep's `copy` and a lookup's 404 cannot name two different crossings.
 */
export function copyCrossing(seal) {
  const at = seal?.at ? Date.parse(seal.at) : NaN;
  if (!Number.isFinite(at)) return null;
  const n = currentCrossing(at);
  return { crossing: n, sailed_at: crossingSailsAt(n), sealed_at: new Date(at).toISOString() };
}

/**
 * What the copy holds, in words, the ONE source for every page that says it
 * (the doorstep's `copy`, its fallback, a lookup's 404): "has caught up to
 * crossing N, sealed T"; that it holds no seal (`null`); or, when its history
 * could not be read (`undefined`), that it could not say.
 */
export const copyHoldsWords = (crossing) => crossing === undefined
  ? "could not say what it has caught up to just now"
  : crossing
    ? `has caught up to crossing ${crossing.crossing}, sealed ${crossing.sealed_at}`
    : "holds no crossing's seal, so it cannot name a crossing it has caught up to";

/**
 * A lookup's 404 when the office's copy holds no letter by the id (POS-332).
 * "no letter by that id" alone was a claim about the town that only the copy
 * could make: Nyx's read-backs bounced on letters that had sailed after it. The
 * defect names the copy and the crossing it holds, in the doorstep's words.
 * `crossing` is copyCrossing's answer; `undefined` when the copy's history
 * could not be read.
 */
export function notInCopyDefect(crossing) {
  const tail = crossing === undefined ? ""
    : crossing ? "; a letter that sailed after that crossing is not in it yet" : "; a letter newer than the copy is not in it yet";
  return `no letter by that id in the office's copy of the town record, which ${copyHoldsWords(crossing)}${tail}`;
}

/**
 * The doorstep's `copy` block, from what the index read: `newest` (the newest
 * commit time in the copy, ISO, or null) and `seal` (`{ sha, at }` of the newest
 * crossing seal in the copy, or null). `asOf` is the copy's commit, as the page
 * names it. `now` is the page's one clock.
 */
export function copyBlock({ newest = null, seal = null } = {}, asOf = null, now = Date.now()) {
  const n = typeof now === "number" ? now : new Date(now).getTime();
  const last = currentCrossing(n);
  const crossing = copyCrossing(seal);
  const caughtUp = crossing ? crossing.crossing >= last : null;
  const commit = asOf && asOf !== "unknown" ? `commit ${String(asOf).slice(0, 12)}` : "a commit it cannot name";
  const held = newest ? `its newest change was recorded at ${newest}` : "it holds no dated change";
  const verdict = caughtUp === true
    ? ": the last crossing by the timetable."
    : caughtUp === false
      ? `; crossing ${last} was due at ${crossingSailsAt(last)} by the timetable and is not in this copy yet, so read again once the copy catches up.`
      : ".";
  return {
    newest_change_at: newest,
    crossing,
    last_crossing_by_timetable: last,
    caught_up: caughtUp,
    sentence: `This page reads the office's copy of the town record at ${commit}; ${held}. The copy ${copyHoldsWords(crossing)}${verdict}`,
  };
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
