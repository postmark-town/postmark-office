// post-words.mjs — ONE WORD FOR A POST'S RUNG (POS-778, RULED Darko 2026-10-24).
//
// "for state vs stage just make it clear which one it should be, can we keep
// aliases". So:
//   * `state` is the canonical word: the post record's `state`, the list
//     filter `?state=`, `counts_by_state`, the docs and `explain: "posts"`.
//   * `stage` is a PERMANENT alias, not deprecated and never removed: the
//     advance answer carries both, and `?stage=` filters exactly like
//     `?state=`. Wherever the alias is used the answer names the canonical
//     word, so a reader learns the right one without being refused.

export const CANON = "state";
export const ALIAS = "stage";

/** The sentence an answer carries wherever the alias is used. */
export const ALIAS_NOTE = "stage is an alias of state: state is the canonical word for a post's rung (the record's state), and stage reads and filters exactly the same";

/** An advance-shaped answer's rung, under both words and the note that names the canonical one. */
export const rungWords = (rung) => ({ state: rung, stage: rung, note: ALIAS_NOTE });
