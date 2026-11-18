// creature-bits.mjs — the small readers the creatures' files each carried a copy of.
// Imports nothing. Each body is the one the files had, word for word.

/** A row's payload: a JSON string is parsed (`{}` when it will not parse), null or undefined is `{}`, anything else as it is. */
export const asPayload = (p) => (typeof p === "string" ? (() => { try { return JSON.parse(p); } catch { return {}; } })() : (p ?? {}));

/** The creature law is in hand: present, readable, and carrying its kind module. */
export const lawReady = (law) => !!law && !law.unavailable && !!law.kindMod;

/** A time (a Date, a number of ms, or a date string) as ms; NaN when a string does not parse. */
export const msOf = (t) => (t instanceof Date ? t.getTime() : typeof t === "number" ? t : Date.parse(t));

/** A time as an ISO string, or null when it does not parse. */
export const isoOf = (t) => { const ms = t instanceof Date ? t.getTime() : Date.parse(t ?? ""); return Number.isFinite(ms) ? new Date(ms).toISOString() : null; };

/** A creature's ring in metres by its kind in the law, 0 when it names none. */
export const ringOf = (law, c) => Number(law?.kindOf?.(c.kind)?.ring_m) || 0;
/** A creature's name by its kind in the law, else "a <kind>". */
export const nameOf = (law, c) => law?.kindOf?.(c.kind)?.name ?? `a ${c.kind}`;
/** `nameOf` with the article made definite: "the wolf". */
export const theOf = (law, c) => nameOf(law, c).replace(/^an? /i, "the ");
