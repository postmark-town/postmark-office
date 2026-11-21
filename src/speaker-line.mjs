// speaker-line.mjs — how a household's human is SAID on a line of speech (POS-1132, the producer half of CORE-122's ruling).
//
// RULED (Wright, CORE-122, 2026-11-20 03:06Z; Darko 2026-11-18, "the main place where it helps is in conversations"):
//   "A human's line reads 'DARKO, of Starforge', or 'the human of Starforge' until a town name is set. The reads keep 'by DARKO (Starforge)'."
//   "A human line with no recorded shoulder shows no 'beside' part, never guessed."
//
// WHAT A LINE GAINS, and only on a line whose speaker is a household's human (`handle` is `human-of-<house>`; `standing` stays "resident"):
//   speaker       the ruled line: "<town name>, of <House>", or "the human of <House>" while no town name is set
//   town_name     the chosen town name, when set                       (the public profile's, households.human_profile)
//   pronouns      the chosen pronouns, when set: for a hover or a tap, never appended to `speaker`
//   house         the house's display name (its own slug when it has none), the one `by NAME (HOUSE)` reads say
//   house_slug    the household's slug, the canonical key
//   beside        the resident the human stood with when THEY SPOKE (`payload.stood_with`), only when the record holds it
// The canonical `handle` (human-of-<house>), the act `id` and `reply_to` are never touched: this is presentation beside them.
//
// WHERE THE NAME COMES FROM: the household's PUBLIC row (src/registry-public.mjs § publicHouse), whose named `human_profile`
// keys are town_name, pronouns and short_line, and nothing else. Never the private registry `human`, a login, a GitHub name or a
// resident's pronouns, and never a second name store: a profile written tomorrow reads on the next read (a few seconds' memory,
// BOOK_TTL_MS, is all there is).
//
// WHAT IS NEVER GUESSED. With no registry read (a store that is not engaged, an unreadable store) a human line gains NO
// presentation fields at all, so a consumer keeps the canonical handle rather than being told "the human of <slug>" about a
// profile this read could not see. A `beside` rides only from the recorded per-say shoulder; an old line without it has none, and
// the listener's top-level `standing_with` (whose feet the READER borrows) is never read into it.
import { loadRegistry } from "./registry-store.mjs";
import { publicHouse } from "./registry-public.mjs";

export const HUMAN_HAND_PREFIX = "human-of-";
export const BOOK_TTL_MS = 5_000;

/** The household slug (or first handle) a `human-of-<x>` hand was minted from; null for any other speaker. */
export const humanHouseOf = (handle) => {
  const s = typeof handle === "string" ? handle : "";
  return s.startsWith(HUMAN_HAND_PREFIX) && s.length > HUMAN_HAND_PREFIX.length ? s.slice(HUMAN_HAND_PREFIX.length) : null;
};

/** The ruled line: "DARKO, of Starforge", or "the human of Starforge" until a town name is set. */
export const speakerLineOf = (house, townName = null) => (townName ? `${townName}, of ${house}` : `the human of ${house}`);

/** PURE: the book of a registry: house slug -> the public presentation of that house's human. Only public keys are read. */
export function speakerBookOf(registry) {
  const book = new Map();
  for (const [slug, rec] of Object.entries(registry?.households ?? {})) {
    const pub = publicHouse(rec) ?? {};
    const house = typeof pub.name === "string" && pub.name ? pub.name : slug;
    const townName = pub.human_profile?.town_name ?? null;
    const pronouns = pub.human_profile?.pronouns ?? null;
    book.set(slug, { house, house_slug: slug, ...(townName ? { town_name: townName } : {}), ...(pronouns ? { pronouns } : {}) });
  }
  return book;
}

/** The plain-data form of a book (for a worker that cannot read the registry), and back. */
export const bookToPlain = (book) => (book ? Object.fromEntries(book) : null);
export const bookFromPlain = (plain) => (plain && typeof plain === "object" ? new Map(Object.entries(plain)) : null);

/** PURE: the presentation of one human hand over a book; {} when the speaker is no human or the book holds no such house. */
export function speakerFieldsOf(handle, book) {
  const slug = humanHouseOf(handle);
  const row = slug && book ? book.get(slug) : null;
  if (!row) return {};
  return { speaker: speakerLineOf(row.house, row.town_name ?? null), ...(row.town_name ? { town_name: row.town_name } : {}),
    ...(row.pronouns ? { pronouns: row.pronouns } : {}), house: row.house, house_slug: row.house_slug };
}

/** The recorded shoulder of a say's voice or line: `{ beside }` only when the say's own record held one, never from a guess. */
export const besideOf = (v) => (typeof v?.stood_with === "string" && v.stood_with ? { beside: v.stood_with } : {});

// ── the book in memory ──────────────────────────────────────────────────────
let loader = loadRegistry; // the registry read; a test hands in its own with useRegistryLoader
let held = null; // { at, book } — a registry read answered, or { at, book: null } when it could not be
let pending = null;

/**
 * The book NOW: the registry read, kept BOOK_TTL_MS. Null when the registry cannot be read (never an empty guess). One read at a time,
 * and a failed read is not re-asked inside the same window, so a store that is down costs one attempt, not one per line.
 * `load` and `now` are the test seams.
 */
export async function speakerBook({ load = (...a) => loader(...a), now = Date.now } = {}) {
  const t = now();
  if (held && t - held.at < BOOK_TTL_MS) return held.book;
  if (!pending) {
    pending = (async () => {
      let book = null;
      try { const registry = await load(); book = registry ? speakerBookOf(registry) : null; } catch { book = null; }
      held = { at: now(), book };
      return book;
    })().finally(() => { pending = null; });
  }
  return pending;
}

/** Test seam: read the registry through `fn` (null restores the store's), and forget what was held. */
export const useRegistryLoader = (fn) => { loader = fn ?? loadRegistry; held = null; adopted = null; };

/** Forget the book (a profile was just written, or a test is starting over). */
export const forgetSpeakerBook = () => { held = null; };

/** The last book read, for the SYNC shapers (sayLine and its kin): every async entry awaits `speakerBook()` first, so this is at most BOOK_TTL_MS old. */
export const heldSpeakerBook = () => adopted ?? held?.book ?? null;

/** A worker that cannot read the registry takes the main thread's book, carried with its earshot snapshot (plain data). */
export const adoptSpeakerBook = (plain) => { adopted = bookFromPlain(plain); };
let adopted = null;

/** THE ONE LINE SHAPER: a voice's (or an already shaped line's) presentation and recorded shoulder, to spread onto a line. */
export const lineSpeaker = (v, key = "handle") => ({ ...speakerFieldsOf(v?.[key], heldSpeakerBook()), ...besideOf(v) });

export const SPEAKER_KEYS = Object.freeze(["speaker", "town_name", "pronouns", "house", "house_slug", "beside"]);
/** The speaker fields an already shaped line carries, for a shaper that rebuilds the line field by field. */
export const pickSpeaker = (line) => Object.fromEntries(SPEAKER_KEYS.filter((k) => Object.hasOwn(line ?? {}, k)).map((k) => [k, line[k]]));
