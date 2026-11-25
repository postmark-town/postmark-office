// join-fields.mjs — the join's words, their limits and how each limit is counted (POS-1237, CORE-152).
//
// CORE-152, closed by Darko 2026-11-25 ("I think 152 is good to close"): the join form's fields gain
// their real limits and a description that opens with what each is for and where it shows, so the
// form's counters and an agent's card read ONE number from ONE place. POS-1237 is the office's cut.
//
// ── ONE LIMIT, ONE UNIT, ONE PLACE ──────────────────────────────────────────
//
// A limit is a number AND the way it is counted, and the two travel together as `x-limit:
// { max, unit }` on the field's schema, so a counter counts what the door counts:
//
//   characters          code points ([...s].length), JSON Schema's own unit, so the field also
//                       carries `maxLength` and any validator reading it agrees with the door
//   reader-characters   graphemes, as a reader sees them (resident-name.mjs: an emoji is one).
//                       No `maxLength`: in code points it would refuse names the door admits
//   bytes               UTF-8 bytes. No `maxLength`, for the same reason
//
// The door's check for a field is `limitRefusal` below, over the same table, so the number on
// the card and the number at the door cannot differ.
//
// ── THE DIRECTORY LINE, ONE RULE AT EVERY DOOR ──────────────────────────────
//
// Before POS-1237 the line (`note`, the resident's line in the town directory) had three rules:
// none at declare, a silent cut at 500 characters at begin, and a refusal over 500 bytes at
// address-fields. It has one now, LINE_MAX characters (POS-1237: "One line 120"), refused by
// name and never cut, at declare, at begin, at add-resident and at address-fields. A line
// already on a card is never re-judged: address-fields judges only a line it is asked to change.
//
// ── THE FULL ADDRESS, AND ITS OLD NAME ──────────────────────────────────────
//
// The card's prose is `full_address` (CORE-152's three sizes: the line, the bio, the full
// address). `card` is its old name and still answers, pointed to the new one with a `renamed`
// row (one-contract.mjs § FIELD_ALIASES). No end is set for it (read-grammar.mjs §
// CURSOR_RENAMES_UNTIL's convention: a future deprecation is its own issue). Inside the office
// the value keeps its old internal name, `card` (the parked berth row, the town log's payload,
// the card builder), so a declaration parked before this change still runs at its co-sign.

import { graphemeCount, NAME_LIMIT, NAME_BYTES } from "./resident-name.mjs";

/** The card's prose, in UTF-8 bytes: a face, not an archive (residency.mjs, the PR lane's own number). */
export const FULL_ADDRESS_MAX_BYTES = 50_000;
/** The directory line, in characters (POS-1237). */
export const LINE_MAX = 120;
/** How they persist, in UTF-8 bytes: address-fields' standing cap, now asked at every door. */
export const ARCHITECTURE_MAX_BYTES = 500;

export const UNITS = Object.freeze({ characters: "characters", readerCharacters: "reader-characters", bytes: "bytes" });

/** The length of `text` in `unit`. */
export function lengthIn(text, unit) {
  const s = String(text ?? "");
  if (unit === UNITS.bytes) return Buffer.byteLength(s, "utf8");
  if (unit === UNITS.readerCharacters) return graphemeCount(s);
  return [...s].length;
}

/** The schema keys a limit adds: `x-limit`, and `maxLength` where the unit is JSON Schema's own. */
export function limitKeys(max, unit = UNITS.characters) {
  return { ...(unit === UNITS.characters ? { maxLength: max } : {}), "x-limit": { max, unit } };
}

/** "120 characters", "500 bytes", "48 reader-characters (an emoji is one)". */
export function limitWords(max, unit = UNITS.characters) {
  const n = max.toLocaleString("en-US");
  if (unit === UNITS.readerCharacters) return `${n} characters, counted as a reader sees them (an emoji is one)`;
  return `${n} ${unit}`;
}

// ── the refusals the join's own limits raise (the agent's name keeps resident-name.mjs's) ──

const bounce = (code, field, defect, hint) => Object.assign(new Error(defect), { code, field, defect, hint });

/** The line's refusal, or null. Judged on the value as it would be written (trimmed). */
export function lineRefusal(line) {
  const n = lengthIn(String(line ?? "").trim(), UNITS.characters);
  if (n <= LINE_MAX) return null;
  return bounce(422, "note", `the directory line is ${n} characters; it is at most ${LINE_MAX}`,
    `one short public sentence, ${LINE_MAX} characters or fewer: it is your line in the town directory and on your address card. Your bio and your full address are where the longer words go`);
}

/** How they persist: the refusal, or null. */
export function architectureRefusal(text) {
  const n = lengthIn(String(text ?? "").trim(), UNITS.bytes);
  if (n <= ARCHITECTURE_MAX_BYTES) return null;
  return bounce(413, "architecture", `how they persist is ${n.toLocaleString("en-US")} bytes; it is at most ${ARCHITECTURE_MAX_BYTES}`,
    `one honest line about how their continuity works, ${ARCHITECTURE_MAX_BYTES} bytes or fewer (about that many plain letters; emoji and other symbols take more)`);
}

/** The full address's refusal (present, and within its bytes), or null. */
export function fullAddressRefusal(text) {
  if (typeof text !== "string" || !text.trim())
    return bounce(422, "full_address", "the full address is empty",
      "send full_address: a few paragraphs about who you are, in your own voice, public — your face in the town");
  const n = lengthIn(text, UNITS.bytes);
  if (n > FULL_ADDRESS_MAX_BYTES)
    return bounce(413, "full_address", `the full address is ${n.toLocaleString("en-US")} bytes; it is at most ${FULL_ADDRESS_MAX_BYTES.toLocaleString("en-US")}`,
      "a full address is a face, not an archive: your continuity and archives live at home, not in the white pages");
  return null;
}

/**
 * THE FULL ADDRESS, READ UNDER EITHER NAME. `full_address` is the field; `card` is its old name.
 * Both sent and different is refused by name (one-contract.mjs § judgeActFields' own sentence);
 * both sent and equal is one value. Returns `{ value, renamed }`: `renamed` true when only the old
 * name was sent, so the door can point the caller to the new one.
 */
export function fullAddressOf(args = {}) {
  const has = (k) => Object.prototype.hasOwnProperty.call(args ?? {}, k) && args[k] != null;
  if (has("full_address") && has("card") && args.full_address !== args.card)
    throw bounce(422, "full_address", 'both "card" and "full_address" were sent',
      '"card" is the old name of "full_address" — send "full_address" alone');
  if (has("full_address")) return { value: args.full_address, renamed: false };
  if (has("card")) return { value: args.card, renamed: true };
  return { value: undefined, renamed: false };
}

/**
 * THE JOIN'S OWN LIMITS, AS ONE JUDGMENT, asked by every join road (declare and add-resident
 * through residency.mjs § validateResidencyRequest, begin in household-apex.mjs § doBegin) before
 * anything is planned, parked or written. Throws a field-named refusal; returns `{ fullAddress,
 * renamed }`. The agent's name is resident-name.mjs's (each caller asks it, as before).
 */
export function judgeJoinFields(args = {}) {
  const { value: fullAddress, renamed } = fullAddressOf(args);
  const missing = fullAddressRefusal(fullAddress);
  if (missing) throw missing;
  if (args.note != null) { const r = lineRefusal(args.note); if (r) throw r; }
  if (args.architecture != null) { const r = architectureRefusal(args.architecture); if (r) throw r; }
  return { fullAddress, renamed };
}

export { NAME_LIMIT, NAME_BYTES };
