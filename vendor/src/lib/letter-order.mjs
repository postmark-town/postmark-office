// VENDORED from postmark-town/postmark-site src/lib/letter-order.mjs (upstream sha256 83eea2c3077f05499b9e2befd0052db65167dbf4bdaf493e0e7b10064ebd8bc3, LF, vendored 2026-10-09).
// Do not edit here — fix upstream and re-vendor; scripts/check-vendor-drift.mjs compares hashes.
// letter-order.mjs — the order a conversation's letters read in (POS-318).
//
// A pure module, with no imports, so the build-time town reader
// (tools/lib/town.mjs, which the office vendors) and the pages' own libraries
// (src/lib/mail.mjs, which the browser also bundles) can share ONE order
// instead of each keeping a copy.
//
// ── THE RULE (Keemin, 2026-10-02) ────────────────────────────────────────────
//
//   1. The crossing a letter sailed on, earlier first.
//   2. On a tie (the same crossing), a reply comes after the letter its
//      `thread:` names.
//   3. Id is the last tiebreak only.
//
// Before this, letters sorted by their written date and then by id, so on one
// day `current-…` came before `postmaster-…` whatever answered what. Keemin's
// case: Current's 09-05 thank-you sat above the Postmaster's 09-05 answer it
// replies to.
//
// ── WHERE THE CROSSING COMES FROM ────────────────────────────────────────────
//
// The mail ledger (WHITE_PAGES/mail-ledger.md, the site's ledger.json) is
// append-only and written by the ferry one crossing at a time, so its LINE
// ORDER is the crossing order the record already holds. A delivered letter's
// place is its ledger line. The ledger stamps each line with its run's date,
// and that date is the tie unit for rule 2. Crossing NUMBERS exist only since
// crossing 182 (WHITE_PAGES/crossing-ledger.md, 2026-09-10), and ledger.json
// carries none. Measured over the whole record on 2026-10-02, grouping by the
// line's date gives the same answer as grouping by the ferry run that wrote
// it. Of 8,471 delivered reply edges, 333 share a run with their parent, and
// line order gets 180 of those backwards. Only one reply crossed in an EARLIER
// run on the SAME date: a catch-up boat (00:00Z, then 01:53Z), which the town
// clock counts as the same crossing.
//
// Line order (not id) decides inside a date, because one date holds two
// crossings and the ledger's lines are the only record of which came first.
// Within one crossing the ferry writes its lines in id order (31 of the 45
// receipted crossings exactly), so id still decides there in practice. Id
// decides outright only for letters with no ledger line: a letter still on the
// water, or a bounce notice the ferry never carried. Such a letter stands on
// its own written date, after that date's deliveries.

/** id -> { date, line } for every delivered letter, from the ledger's entries in file order. */
export function ledgerPlaces(ledger) {
  const places = new Map();
  (ledger ?? []).forEach((e, line) => {
    if (e?.kind === "delivery" && e.id && !places.has(e.id)) places.set(e.id, { date: e.date ?? "", line });
  });
  return places;
}

/**
 * `letters` (each `{ id, date, thread }`) in the order they read: crossing,
 * then reply order inside a crossing, then id. Returns a new array; the input
 * is not touched. `ledger` is ledger.json's entries (or the `ledgerPlaces`
 * map); without it every letter stands on its written date, and rule 2 still
 * holds inside a day.
 */
export function conversationOrder(letters, ledger = null) {
  const places = ledger instanceof Map ? ledger : ledgerPlaces(ledger);
  const list = [...(letters ?? [])];
  const placeOf = (l) => places.get(l.id) ?? { date: l.date ?? "", line: Infinity };
  const keyed = list.map((l) => ({ l, ...placeOf(l) }));
  keyed.sort((x, y) =>
    x.date.localeCompare(y.date) ||
    (x.line === y.line ? 0 : x.line < y.line ? -1 : 1) ||
    String(x.l.id ?? "").localeCompare(String(y.l.id ?? "")));

  // Rule 2, one date at a time: a letter waits until the letter its `thread:`
  // names (when that letter is in the same date) has been placed; among the
  // letters free to go, the earliest in the order above goes first. A cycle in
  // the record (two letters naming each other) cannot wait forever: the
  // earliest remaining letter goes.
  const out = [];
  for (let i = 0; i < keyed.length;) {
    let j = i;
    while (j < keyed.length && keyed[j].date === keyed[i].date) j++;
    const day = keyed.slice(i, j);
    if (day.length === 1) out.push(day[0].l);
    else {
      const inDay = new Set(day.map((k) => k.l.id));
      const placed = new Set();
      const left = [...day];
      while (left.length) {
        let at = left.findIndex((k) => !k.l.thread || k.l.thread === k.l.id || !inDay.has(k.l.thread) || placed.has(k.l.thread));
        if (at < 0) at = 0;
        const [k] = left.splice(at, 1);
        placed.add(k.l.id);
        out.push(k.l);
      }
    }
    i = j;
  }
  return out;
}
