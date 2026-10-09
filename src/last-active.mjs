// last-active.mjs — WHEN A RESIDENT LAST DID SOMETHING IN TOWN (POS-481).
//
// Darko, 2026-10-09: "to be able to see when that resident was last active on
// Postmark … so residents can get a sense of, if I'm new here and I send a
// letter to this one resident, would they likely be responsive or have they
// been gone for months?"
//
// ONE MEANING: the resident's newest act of their own. Wright ruled the
// sources (POS-481, 10-09): the store's `acts` (every world act, every post
// and its life, every ballot vote) UNION ALL the store's `town_letters` (a
// letter they sent, at the crossing that sailed it) UNION ALL the page edits,
// `office_town_journal` class `update` (address, home, profile, window:
// ruled in after the review, O3, so a resident who re-hangs a window or
// edits HOME reads active). Reads never count: a read is not recorded, and
// counting one would publish who is reading. Mail delivered TO them is not
// their act. Left out, by ruling and named: stakes on pots and marks
// (`stamp_lines` keeps the staker inside the signed line, with no actor
// column). The page edits are the store's since the paperwork moved there
// (OFFICE_PAPERWORK_STORE, prod since 10-04); an office still on oauth.db
// keeps them in that file, and this read does not see them.
//
// Until this file, `last_active` on the roster meant "the newest commit
// touching their own pages in the town repo" (town-index.mjs § readHistory),
// which never saw a say, a walk or a mark. The field keeps its name and its
// type, an ISO string, so nothing that reads it breaks (Wright's ruling B);
// what it means is this file's answer, and `last_active_crossing` rides beside
// it. The index's history value is still built and kept in the index; no door
// serves it any more.
//
// THE CROSSING is the town clock (crossings.mjs) read at the winning time:
// `currentCrossing(at)` for an act and for a letter alike (the spec as
// amended, Wright 2026-10-09), never `acts.crossing` (a backfilled row can
// carry another) and never a second counter. A letter's time is its
// `delivered_at`, the boat that sailed it, which lags the send by up to one
// crossing; Wright accepted that at the granularity of a date and a crossing.
//
// ONE STATEMENT PER PAGE, never one per resident: the handles of the page go
// in as one array and every one of them comes back from one round trip.

import { currentCrossing } from "./crossings.mjs";

/**
 * The newest act per handle from each source, one row per (handle, source).
 * `acts_actor_id_idx (actor, id)` serves the `actor = ANY` filter; letters
 * filter on `town_letters_from (from_h, date)`. `delivered_at` is text (UTC
 * ISO, town-index.mjs § readHistory), so its max is a string compare and the
 * instant is parsed here, never cast in SQL where one odd row would fail the
 * whole page. The act's instant is printed in the same UTC ISO, so the
 * sources compare as like for like. A page edit's `written_at` is the door's
 * own `toISOString()` (town-journal.mjs § appendTownJournal), and its
 * resident is `handle` (the page edited); the filter rides
 * `office_town_journal_handle (handle, seq)`.
 */
export const LAST_ACTIVE_SQL = `
SELECT handle, at, src FROM (
  SELECT DISTINCT ON (actor) actor AS handle,
         to_char(acts.at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS at,
         'act' AS src
    FROM acts
   WHERE actor = ANY($1::text[])
   ORDER BY actor, acts.at DESC
) newest_act
UNION ALL
SELECT from_h AS handle, max(delivered_at) AS at, 'letter' AS src
  FROM town_letters
 WHERE from_h = ANY($1::text[]) AND delivered_at IS NOT NULL
 GROUP BY from_h
UNION ALL
SELECT handle, max(written_at) AS at, 'update' AS src
  FROM office_town_journal
 WHERE class = 'update' AND handle = ANY($1::text[])
 GROUP BY handle`;

/** What a reader is told the two fields mean (the roster's and the card's own words). */
export const LAST_ACTIVE_MEANS =
  "the resident's newest act of their own in the store: a say, a walk, a mark left, amended or withdrawn, a post and its life, a ballot vote (acts), a letter they sent (town_letters, at the crossing that sailed it), or an edit to their own pages: address, home, profile or window (the town journal's updates). Reads never count, mail they received never counts; stakes on pots and marks are not counted. null: no act on record. last_active_crossing is the town clock's crossing it fell in";

const isoOf = (v) => {
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};

/** The winning act per handle from the statement's rows: Map handle → { at, crossing }. */
export function pickLastActive(rows) {
  const out = new Map();
  for (const r of rows) {
    const at = isoOf(r.at);
    if (!at) continue;
    const prev = out.get(r.handle);
    if (prev && prev.at >= at) continue;
    out.set(r.handle, { at, crossing: currentCrossing(Date.parse(at)) });
  }
  return out;
}

/** The newest act for each of `handles`, in one statement on the caller's client. */
export async function lastActiveFor(q, handles) {
  const list = [...new Set((handles ?? []).filter(Boolean))];
  if (!list.length) return new Map();
  return pickLastActive((await q.query(LAST_ACTIVE_SQL, [list])).rows);
}

/** Write the two fields onto one row (a roster line or a card), from the map. */
export function stampLastActive(row, found) {
  if (!row || typeof row !== "object") return row;
  const v = found?.get?.(row.handle) ?? null;
  row.last_active = v?.at ?? null;
  row.last_active_crossing = v?.crossing ?? null;
  return row;
}

/** Said when the store could not be read: both fields are null, and this says why rather than "no acts". */
export const LAST_ACTIVE_UNAVAILABLE =
  "last_active could not be read from the store just now, so every last_active on this answer is null for that reason, not because nobody acted";

/**
 * Stamp `rows` from the client the caller already holds (the store path: one
 * connection per chain, POS-370). A failure is disclosed, never thrown: the
 * statement runs under a savepoint so the caller's transaction stays usable.
 * Answers `null` when every row was stamped, or the disclosure sentence.
 */
export async function stampRowsOn(q, rows) {
  const list = (rows ?? []).filter((r) => r && typeof r === "object");
  let found = null;
  try {
    await q.query("SAVEPOINT last_active");
    found = await lastActiveFor(q, list.map((r) => r.handle));
    await q.query("RELEASE SAVEPOINT last_active");
  } catch {
    try { await q.query("ROLLBACK TO SAVEPOINT last_active"); } catch { /* the caller's own read says what broke */ }
    found = null;
  }
  for (const r of list) stampLastActive(r, found);
  return found ? null : LAST_ACTIVE_UNAVAILABLE;
}

/**
 * Stamp `rows` with ONE store read of their own (the office.db path, whose
 * composed read holds no store connection). `find(handles)` answers the Map;
 * by default it is the pen's officeRead around lastActiveFor, and the house
 * bundle hands the town index's pooled reader instead.
 */
export async function stampRows(rows, { find = null, env = process.env } = {}) {
  const list = (rows ?? []).filter((r) => r && typeof r === "object");
  let found = null;
  if (list.length) {
    try {
      const handles = list.map((r) => r.handle);
      if (find) found = await find(handles);
      else {
        const { officeRead } = await import("./world2-pen.mjs");
        found = await officeRead((c) => lastActiveFor(c, handles), { env, by: "lastActive" });
      }
    } catch { found = null; }
  } else found = new Map();
  for (const r of list) stampLastActive(r, found);
  return found ? null : LAST_ACTIVE_UNAVAILABLE;
}


// ── THE THREE ANSWER SHAPES THE DOORS STAMP ─────────────────────────────────
//
// `page`: a roster page (`residents: [rows]`). `card`: one resident's card.
// `search`: search_town, whose `residents` are bare handles; its stamp rides
// beside them as `residents_last_active`, keyed by handle, so the list keeps
// its shape. A disclosure rides the answer as `last_active_unavailable`.
const SHAPES = {
  page: {
    rows: (a) => (Array.isArray(a?.residents) ? a.residents : []),
    finish: () => {},
  },
  card: {
    rows: (a) => (a ? [a] : []),
    finish: () => {},
  },
  search: {
    rows: (a) => (Array.isArray(a?.residents) ? a.residents.map((handle) => ({ handle })) : []),
    finish: (a, rows) => {
      a.residents_last_active = Object.fromEntries(rows.map((r) =>
        [r.handle, { last_active: r.last_active, last_active_crossing: r.last_active_crossing }]));
    },
  },
};

async function stampAnswer(kind, answer, stamp) {
  const shape = SHAPES[kind];
  if (!shape) throw new Error(`last-active: no answer shape "${kind}"`);
  if (!answer || typeof answer !== "object") return answer;
  const rows = shape.rows(answer);
  const unavailable = await stamp(rows);
  shape.finish(answer, rows);
  if (unavailable) answer.last_active_unavailable = unavailable;
  return answer;
}

/** The office.db path: stamp a door's answer with one store read of its own. */
export function withLastActive(kind, answer, opts = {}) {
  return stampAnswer(kind, answer, (rows) => stampRows(rows, opts));
}

/** The store path: stamp a door's answer on the client its read already holds. */
export function withLastActiveOn(q, kind, answer) {
  return stampAnswer(kind, answer, (rows) => stampRowsOn(q, rows));
}
