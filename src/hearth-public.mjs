// hearth-public.mjs — THE PUBLIC HALF OF THE HOUSE'S HEARTH READS (POS-1027; Darko, POS-1024/b: "Yes, minus private acts").
//
// `household { read: "closer" | "happened" | "stamps" (view: "went") }` answered only for the key that holds the house. For a house NAMED in the
// call (`args.household`) they now answer anyone, from what the town's record already holds in public, and a key with no `household` keeps its
// whole owner read exactly as before. The pieces here are the rules that make the public answer a projection of the owner's and never a second
// record: which acts are public, who an act's hand may be asked for, and how far back the ties go. They are pure; the door
// (household-apex.mjs § householdDeep) does the reading.

/**
 * THE VERBS THAT ARE PUBLIC RECORD, for a public read of a house's acts. An ALLOWLIST: an act the town has not said is public is not shown, however it
 * came to be in the table.
 *
 *   the world's own public set (world-read-v2.mjs § PUBLIC_ACTS): say (only the fact of it, never its words: a row carries no payload), walk, land,
 *     enter, exit, take, give, drop, leave-mark, withdraw, stake — plus ride and unstake, the same acts' other halves;
 *   the post machine's (events.mjs § ACTION_*): post, amend, close, advance, vote (the fact of voting: an act row names the ballot, never the choice),
 *     sign-up, withdraw-sign-up and the legacy event verbs host, amend-event, cancel-event, rsvp, announce.
 *
 * LEFT OUT, by name: award and recredit (they carry what is owed), answer-sign-up (a hand's), the creature, encounter and set-piece verbs and the
 * units:* bookkeeping (no ruling says they are public), adopt, solo-counted and restore (bookkeeping). The acts that never reach the `acts` table at
 * all (a private note, a block, a letter note, a read mark, a drafted letter's amendment, a private report) cannot appear here whatever this list says.
 */
export const PUBLIC_HOUSE_VERBS = Object.freeze([
  "say", "walk", "land", "enter", "exit", "take", "give", "drop", "leave-mark", "withdraw", "stake", "ride", "unstake",
  "post", "amend", "close", "advance", "vote", "sign-up", "withdraw-sign-up", "host", "amend-event", "cancel-event", "rsvp", "announce",
]);

/** The house's acts a public read may name, as a Set (the filter the verbs option gives the store, kept for the doors that filter rows). */
export const PUBLIC_VERB_SET = new Set(PUBLIC_HOUSE_VERBS);

/**
 * `hand:` on happened: "human" (the acts the house's human took) or a resident of the house (their own). Returns `{ hand }` or `{ refused: [code, defect, hint] }`.
 * Absent is no filter.
 */
export function judgeHand(raw, members = []) {
  if (raw === undefined || raw === null || raw === "") return { hand: null };
  const hand = typeof raw === "string" ? raw.trim() : "";
  if (hand === "human" || members.includes(hand)) return { hand };
  return { refused: [422, `hand: "${typeof raw === "string" ? raw : JSON.stringify(raw)}" is neither "human" nor a resident of this house`,
    `hand: "human" is the acts the house's human took; hand: "<resident>" is that resident's own (${members.length ? members.join(", ") : "this house has no resident ashore"})`] };
}

/** The rows whose hand is `hand` (a row's hand is "human" or the acting resident). No `hand`, no filter. */
export const byHand = (rows, hand) => (hand ? rows.filter((r) => r.hand === hand) : rows);

/**
 * `days:` on closer: a whole number of days (1 to 90, the owner's read as it was), or "all" for every letter on record. Returns
 * `{ all: true }`, `{ days }` or `{ refused }`. Absent is the default fortnight (the caller's).
 */
export function judgeDays(raw, { fallback, max = 90 } = {}) {
  if (raw === undefined || raw === null || raw === "") return { days: fallback };
  if (raw === "all") return { all: true };
  const n = Number(raw);
  // the owner's read as it was: a number is kept within 1..max, and zero falls back to the default
  if (typeof raw !== "boolean" && Number.isFinite(n) && String(raw).trim() !== "") return { days: Math.min(Math.max(n || fallback, 1), max) };
  return { refused: [422, `days: ${JSON.stringify(raw)} is not a number of days or "all"`, 'days: a whole number from 1 to 90, or "all" for every letter on record'] };
}

/** closer's `since_day` for "all": the answer says it reaches back to the start of the record, with no date. */
export const ALL_DAYS_SINCE = "0000-01-01";
