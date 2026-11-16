// house-companions.mjs — THE PUBLIC COMPANIONS A FULL HOUSE READ CARRIES: each declared member's outbox and quest board (POS-1070; POS-1061, Darko 2026-11-15 17:25 EST:
// "almost 2 minutes for the entire thing to load, which is not really all that usable").
//
// The site's `readHouse()` asked the office for three things per declared resident: the doorstep, the outbox (`GET /mail/<h>?box=outbox`) and the quest board
// (`GET /quests/<h>`), 27 requests for a house of nine. The full house read already answered the doorstep half in one request; this is the other two, so one office
// request supplies all resident data (walkers, conversations and the calendar stay their own three reads).
//
//   · EACH IS THE LEGACY PUBLIC DOOR'S OWN READ, called, not copied: the outbox is `mailList(h, "outbox").letters` (the bare array `/mail/<h>?box=outbox` answers, at its
//     default page), the board is `questIndexRows` then `questBoardOfRows` after the connection is back (`/quests/<h>`). Both go through the pooled index, so each is its own
//     short READ ONLY transaction, no transaction is held across a composition, and nothing here claims the maps are one snapshot.
//   · ALWAYS ANONYMOUS, EVEN FOR THE HOUSE'S OWN KEY: neither read takes a key (the legacy doors take none; only an owned doorstep carries a bearer), so no owner-enriched
//     outbox and no owner overlay can ride them, and the owner gets exactly what a stranger gets.
//   · THE DECLARED MEMBER LIST, NOT `ashore`: a member the town index holds no resident card for may still have a public outbox or a quest row its legacy door answers, and a
//     missing card must not erase it. `residents` and `not_ashore` keep their meanings; these maps are keyed by every declared member, in the house's order.
//   · THE DOORS' OWN HANDLE GRAMMAR: a declared member spelled outside what `GET /mail/<h>` and `GET /quests/<h>` route (door-handle.mjs) is `null` in both maps, key kept, no read made.
//   · UNAVAILABLE IS NULL, EMPTY IS EMPTY: a read that could not be made (the store, the clone) is `null` for that member, as the legacy door's non-answer was; a read that
//     succeeded and found nothing is `[]` (an outbox) or the board it composed. A failure for one member never takes another's down, and never reads as an empty answer.

import { isDoorHandle } from "./door-handle.mjs";

/** One companion read: its answer, or `null` (logged by name only, never by the error's text) when it could not be made. */
async function soft(read, { what, handle, log }) {
  try { return await read(); }
  catch (e) { log(`[house-companions] ${what} for ${handle} unavailable (${e?.name ?? "error"})`); return null; }
}

/**
 * `{ outboxes, quests }`, each a map from every one of `members` to that member's public companion (or `null`). `ix` is the door's pooled index
 * (town-index-store.mjs § storeIndexPooled): `mailList` and `questBoard`. Members are read one after another, so a house never holds more than one of the pool's
 * connections at a time for this.
 */
export async function houseCompanions(members, { ix, log = (line) => console.error(line) } = {}) {
  // entries, then `Object.fromEntries`: every declared spelling is an OWN data key (assigning into a plain `{}` would run the prototype setter for a declared `__proto__` and keep no key)
  const outboxes = [];
  const quests = [];
  for (const handle of members ?? []) {
    // a spelling the legacy doors refuse (not `[a-z0-9-]+`, as declared: no lower-casing, no alias) is `null` in both maps and no reader is called
    if (!isDoorHandle(handle)) { outboxes.push([handle, null]); quests.push([handle, null]); continue; }
    outboxes.push([handle, await soft(async () => (await ix.mailList(handle, "outbox", {})).letters, { what: "outbox", handle, log })]);
    quests.push([handle, await soft(() => ix.questBoard(handle), { what: "quest board", handle, log })]);
  }
  return { outboxes: Object.fromEntries(outboxes), quests: Object.fromEntries(quests) };
}
