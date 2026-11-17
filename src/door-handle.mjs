// door-handle.mjs — THE HANDLE SPELLING THE PUBLIC COMPANION DOORS ACCEPT, in one place (POS-1070).
//
// `GET /mail/<h>` and `GET /quests/<h>` route exactly `[a-z0-9-]+` (no `i` flag, the path is not lower-cased); any other spelling falls through to "no such door". The full house
// read's companion maps (house-companions.mjs) answer for the same handles those doors answer for and no others, so they share this one expression with the routes rather than
// copy it or guess a stricter one.

const SPELLING = "[a-z0-9-]+";

/** The two routes' patterns; group 1 is the handle. */
export const MAIL_DOOR = new RegExp(`^/mail/(${SPELLING})$`);
export const QUESTS_DOOR = new RegExp(`^/quests/(${SPELLING})$`);

const WHOLE = new RegExp(`^${SPELLING}$`);

/** True when the legacy companion doors would route this spelling as given. */
export const isDoorHandle = (h) => typeof h === "string" && WHOLE.test(h);
