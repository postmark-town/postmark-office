// letter-notes.mjs — A HOUSEHOLD'S PRIVATE NOTE ON A LETTER IT RECEIVED (POS-730).
//
// Ruled by Darko 2026-11-06 14:32 EDT ("Build that shape"), on the idea he ruled in
// the Hearth sitting (POS-845 call 7, 2026-11-01: "a waiting mark stays until the
// household removes it, and shows its age"): a household can mark a letter it
// received "no reply needed" or "waiting on <condition>", and the mark is private.
//
//     household { do: "letter-note", args: { letter, state: "no-reply" | "waiting" | "clear", on? } }
//
// WHAT IT DOES, and nothing else:
//   · `to_answer` skips a marked letter (household-read-v2.mjs § unansweredOf).
//   · the awaiting view still lists it, with its mark, its condition and its age
//     (§ annotateAwaiting), on the key that holds the resident and nowhere else.
//   · the age runs from when the mark was made; waiting never expires, and a reply
//     does not clear it. Only `clear` does.
//   · it never changes the letter, the ledger's sequence states or the unread count.
//
// ── PRIVATE BY THE ROW POLICY, ONE HOUSEHOLD AT A TIME ──────────────────────
//
// The note lives in `letter_notes` (088): one row per (household, letter), row level
// security on the acting household's spelling set, office_api's alone, in no export,
// and the act writes no row in `acts`. Every store question here runs inside a
// transaction that declared the recipient's household (`officeWrite`), exactly as
// unread-store.mjs does for `letter_opens`, so the policy, not this file, is what
// keeps a house's notes its own. Nothing here reads or writes git or a file, and
// nothing falls back to one: a store without the table REFUSES the write (503) and
// writes nothing.
//
// ── WHO MAY NOTE WHAT ───────────────────────────────────────────────────────
//
// Only a letter DELIVERED to a resident the key holds: the ferry's delivery row
// (`town_ledger` kind 'delivery', read through the index's `deliveredTo`). Another
// household's letter, a letter the house only sent, and a letter standing ahead of
// the crossing have no delivery row to a resident of the key's household, so they
// are refused, and the refusal says the same thing for each so it teaches nothing
// about whose letters exist. Any resident of the receiving household may set or
// clear it: the note is the house's, not the recipient's, so a housemate whose own
// key holds only themself may note a letter delivered to another of the house.
// "The receiving household" is each recipient's household as `householdKeyFor`
// spells it, compared with the households of the residents the key holds.

import { officeRead, officeWrite } from "./world2-pen.mjs";
import { householdKeyFor } from "./world2-claims.mjs";
import { refuse } from "./events.mjs";

export const NOTE_STATES = Object.freeze(["no-reply", "waiting"]);
export const NOTE_ACTS = Object.freeze([...NOTE_STATES, "clear"]);
/** `on` (the condition a letter waits on): at most this many characters. */
export const WAITING_ON_MAX = 140;
/** A letter id is the town's own, a short slug; this bounds what the door will look up. */
const LETTER_MAX = 200;

export const NOTE_PRIVATE = "private to your household: no other key sees it, the town's record does not hold it, and it never changes the letter";
export const NOTE_CLEARS = 'household { do: "letter-note", args: { letter, state: "clear" } } removes it; a reply does not';
export const NOTES_TABLE_ABSENT = "the office's private note table is not there yet (the migration has not been applied at this store), so nothing was written";

const isMissingTable = (e) => e?.code === "42P01";
const characters = (s) => Array.from(String(s)).length;

/**
 * The fields of a `letter-note`, judged: `{ letter, state, on, handle }` or a 4xx
 * refusal naming the field. `on` is the condition of `waiting` and of nothing
 * else: it is required for `waiting` (1 to 140 characters, not blank) and refused
 * on `no-reply` and `clear` rather than dropped, so a caller is never told a
 * condition was kept that was not.
 */
export function judgeNote(fields = {}) {
  const letter = typeof fields.letter === "string" ? fields.letter.trim() : "";
  if (!letter) throw refuse(422, "which letter?", 'pass letter: — ids come from household { read: "mail" } and your doorstep', { field: "letter" });
  if (letter.length > LETTER_MAX || /\s/.test(letter))
    throw refuse(422, "that is not a letter id", 'letter: takes the id household { read: "mail" } names, as written', { field: "letter" });
  const state = typeof fields.state === "string" ? fields.state.trim() : "";
  if (!NOTE_ACTS.includes(state))
    throw refuse(422, `state: takes "no-reply", "waiting" or "clear"; got ${JSON.stringify(fields.state ?? null)}`, 'no-reply: nothing is owed; waiting: needs `on` (what it waits on); clear: removes the note', { field: "state" });
  const hasOn = fields.on !== undefined && fields.on !== null;
  if (state !== "waiting") {
    if (hasOn) throw refuse(422, `on: is the condition of "waiting" only`, `drop it, or set state: "waiting"`, { field: "on" });
    return { letter, state, on: null };
  }
  const on = typeof fields.on === "string" ? fields.on.trim() : "";
  if (!on) throw refuse(422, '"waiting" needs `on`: what the letter waits on', 'e.g. args: { letter, state: "waiting", on: "the food order" }', { field: "on" });
  if (characters(on) > WAITING_ON_MAX)
    throw refuse(422, `on: is at most ${WAITING_ON_MAX} characters; got ${characters(on)}`, "say it shorter", { field: "on" });
  return { letter, state, on };
}

/** Group handles by their household key, one read-only resolution per handle (unread-store.mjs § byHousehold). */
async function byHousehold(handles, env) {
  const keys = await officeRead(async (c) => {
    const out = [];
    for (const h of handles) out.push([h, await householdKeyFor(c, h)]);
    return out;
  }, { env });
  const groups = new Map();
  for (const [h, hh] of keys) groups.set(hh, [...(groups.get(hh) ?? []), h]);
  return groups;
}

/**
 * The household that received `letter` AND is the key's own: `{ household, actor }`, or null.
 * The ferry's delivery rows (the town's public ledger) name who a letter reached; each
 * recipient's household and each held resident's household are resolved in one
 * read-only transaction, before any write (the pen's one connection per chain).
 * `actor` is the held resident of that household who is acting.
 */
async function receivedBy(letter, held, env) {
  return officeRead(async (c) => {
    const { rows } = await c.query("SELECT DISTINCT to_h FROM town_ledger WHERE kind = 'delivery' AND id = $1", [letter]);
    if (!rows.length) return null;
    const mine = new Map();                                  // household key → the key's residents in it
    for (const h of held) { const hh = await householdKeyFor(c, h); mine.set(hh, [...(mine.get(hh) ?? []), h]); }
    for (const r of rows) {
      const hh = await householdKeyFor(c, r.to_h);
      const group = mine.get(hh);
      if (group) return { household: hh, actor: group[0] };
    }
    return null;
  }, { env });
}

/** An age in whole days, from `marked_at` to `nowMs`; never negative. */
export const ageDays = (markedAt, nowMs = Date.now()) => {
  const t = Date.parse(markedAt instanceof Date ? markedAt.toISOString() : markedAt);
  return Number.isFinite(t) ? Math.max(0, Math.floor((nowMs - t) / 86_400_000)) : null;
};

const noteRow = (r, nowMs) => ({
  state: r.state,
  ...(r.waiting_on != null ? { on: r.waiting_on } : {}),
  age_days: ageDays(r.marked_at, nowMs),
});

/**
 * household { do: "letter-note", args: { letter, state, on? } }. The acting resident
 * (recorded as who marked it) is the first resident the key holds in the
 * receiving household.
 */
export async function letterNoteAtOffice(fields, key, { env = process.env, now = Date.now() } = {}) {
  const held = [...(key?.handles ?? [])];
  if (!held.length) throw refuse(403, "a letter's note is a household's act", "your key holds no resident — declare a household first");
  const { letter, state, on } = judgeNote(fields);
  let got;
  try { got = await receivedBy(letter, held, env); }
  catch (e) {
    if (e?.name === "NoRecordError") throw refuse(503, NOTES_TABLE_ABSENT, "the office is pointed at no record, so nothing was written");
    throw e;
  }
  if (!got)
    throw refuse(403, "that is not a letter your household has received", 'notes are for letters delivered to your household: household { read: "mail", view: "inbox" } lists them');
  const { household, actor: by } = got;
  try {
    if (state === "clear") {
      const cleared = await officeWrite(async (c) => {
        const r = await c.query("DELETE FROM letter_notes WHERE household = $1 AND letter = $2", [household, letter]);
        return (r.rowCount ?? 0) > 0;
      }, { env, household });
      return {
        letter, state: "clear", cleared,
        receipt: cleared ? "note cleared: the letter counts again where it did before" : "there was no note on this letter",
        note: NOTE_PRIVATE,
      };
    }
    const row = await officeWrite(async (c) => (await c.query(
      `INSERT INTO letter_notes (household, letter, state, waiting_on, marked_at, marked_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (household, letter) DO UPDATE SET
         state = EXCLUDED.state,
         waiting_on = EXCLUDED.waiting_on,
         marked_at = CASE WHEN letter_notes.state = EXCLUDED.state AND letter_notes.waiting_on IS NOT DISTINCT FROM EXCLUDED.waiting_on
                          THEN letter_notes.marked_at ELSE EXCLUDED.marked_at END,
         marked_by = CASE WHEN letter_notes.state = EXCLUDED.state AND letter_notes.waiting_on IS NOT DISTINCT FROM EXCLUDED.waiting_on
                          THEN letter_notes.marked_by ELSE EXCLUDED.marked_by END
       RETURNING state, waiting_on, marked_at, marked_by`,
      [household, letter, state, on, new Date(now).toISOString(), by])).rows[0], { env, household });
    return {
      letter,
      ...noteRow(row, now),
      receipt: state === "waiting" ? `noted: waiting on ${row.waiting_on} — it stays until you clear it, and a reply does not clear it` : "noted: no reply needed — it stays until you clear it, and a reply does not clear it",
      note: NOTE_PRIVATE,
      clears: NOTE_CLEARS,
    };
  } catch (e) {
    if (e?.name === "NoRecordError" || isMissingTable(e)) throw refuse(503, NOTES_TABLE_ABSENT, "nothing was written, and nothing was lost; the operator applies world2/schema/088_letter_notes.sql");
    throw e;
  }
}

/**
 * The notes of the households `handles` belong to, as `{ notes: Map(letter → row) }`
 * or `{ notes: empty Map, unavailable }`. A store with no `letter_notes` table has
 * no notes, truly (a note can only have been written by a successful write, and
 * there is none), so that reads as none, said nowhere; any OTHER failure is
 * `unavailable`, said, never presented as none. Private: the caller owns the
 * question of whose handles these are (only a key's own), and the row policy
 * answers it again, one household at a time.
 */
export async function notesFor(handles, { env = process.env } = {}) {
  const notes = new Map();
  if (!handles.length) return { notes };
  try {
    for (const [household] of await byHousehold(handles, env)) {
      const rows = await officeWrite(async (c) => (await c.query(
        "SELECT letter, state, waiting_on, marked_at, marked_by FROM letter_notes WHERE household = $1", [household])).rows, { env, household });
      for (const r of rows) notes.set(r.letter, r);
    }
    return { notes };
  } catch (e) {
    // A missing table is NOT "no notes": a lost table can hide marks that exist (POS-730/c), so it is said like any other failure.
    return { notes: new Map(), unavailable: `letter notes unreadable — marked letters may still be counted` };
  }
}

/**
 * The notes of the letters the key may read: those delivered to a resident it holds.
 * A note belongs to the household, but what an awaiting read may SHOW is bounded by
 * the key's own mail (never widened to a letter the key could not read anyway).
 * `{ notes }` in, `{ notes }` out; an unreadable ledger is `unavailable`.
 */
export async function inScope(got, held, { env = process.env } = {}) {
  if (!got?.notes?.size || !held?.length) return { ...got, notes: new Map() };
  try {
    const ids = await officeRead(async (c) => (await c.query(
      "SELECT DISTINCT id FROM town_ledger WHERE kind = 'delivery' AND id = ANY($1) AND to_h = ANY($2)", [[...got.notes.keys()], held])).rows.map((r) => r.id), { env });
    const keep = new Set(ids);
    return { ...got, notes: new Map([...got.notes].filter(([k]) => keep.has(k))) };
  } catch {
    return { notes: new Map(), unavailable: "letter notes unreadable — marked letters may still be counted" };
  }
}

/**
 * The awaiting view with the household's still-marked letters on it, once, as
 * `letter_notes: [{ letter, state, on?, age_days }]` (oldest mark first). A mark stays
 * until it is cleared, so it is listed even after a newer letter has replaced its
 * conversation's row or a reply has arrived. The view's own rows, counts and order
 * are untouched, and no resident or absolute time is shown. Pure; a view with no
 * marked letter comes back as the same object.
 */
export function annotateAwaiting(view, notes, { nowMs = Date.now() } = {}) {
  if (!view || typeof view !== "object" || !notes?.size) return view;
  const letter_notes = [...notes].map(([letter, n]) => ({ letter, ...noteRow(n, nowMs) }))
    .sort((a, b) => (b.age_days - a.age_days) || (a.letter < b.letter ? -1 : 1));
  return {
    ...view,
    letter_notes,
    notes_note: `letter_notes are your household's own marks on letters (${NOTE_PRIVATE}); ${NOTE_CLEARS}`,
  };
}
