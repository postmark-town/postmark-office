// pair-read.mjs — `town { read: "pair", args: { a, b } }`: TWO RESIDENTS' CORRESPONDENCE, PUBLIC (POS-1027; Darko, POS-1024/c: "By rule").
//
// Letters are the town's public record (a delivered letter reads whole at town { read: "letter" }), so this read adds no consent gate: it puts a pair's
// delivered letters together. When they first wrote, how many each way, the newest each way, the milestones the pair reached (the quest board's own
// `earned_with` rungs), and a QUOTE by rule: the literal first line of the newest delivered letter each way. No act keeps a quote, and nobody manages one.
//
// THE QUOTE IS NOT `letterExcerpt`. queries.mjs § letterExcerpt (the field `first_line`) picks a SUBSTANTIVE PARAGRAPH, skipping greetings and headings and
// cutting at 200 characters; a pair's quote is the first line of the body, as written. `firstLine` below is that, and the test pins a letter on which the two
// differ.
//
// WHICH LETTERS: every DELIVERED letter between the two, either way, as the public letter index holds them (a letter that never arrived is no
// correspondence). A letter to several counts for each recipient, so a multi-recipient letter from a to (b, c) is a→b. The order is the public letter
// index's own (NEWEST: `delivered_at` as text, a bare date as that day's midnight, ties on id ascending), which also supplies "latest" and its tie-break.

import { apiUrl } from "./public-base.mjs";
import { recipientsOf } from "./town-index-store.mjs";

const bounce = (code, defect, hint) => ({ error: "bounce", code, defect, hint });

/** The longest literal line a quote carries; a longer one is cut and says so (`line_cut: true`). */
export const QUOTE_MAX = 600;

/** The first non-blank line of a letter's body, exactly as written (a heading stays a heading, a greeting a greeting). */
export function firstLine(body) {
  for (const line of String(body ?? "").split(/\r?\n/)) if (line.trim() !== "") return line.trim();
  return "";
}

/** A letter's sort key in the public index's order (newest first): the instant as text, the id breaking ties. Returns a comparator. */
const when = (r) => String(r.delivered_at ?? r.date ?? "");
export const newestFirst = (x, y) => (when(x) < when(y) ? 1 : when(x) > when(y) ? -1 : x.id < y.id ? -1 : x.id > y.id ? 1 : 0);

/** The milestones of a pair from the quest board's `earned_with` rows, as `{ threshold, date, by }`, oldest first, one per (threshold, by). */
export function pairMilestones(boards, a, b) {
  const out = new Map();
  for (const [by, board] of boards) {
    const other = by === a ? b : a;
    for (const q of board?.quests ?? []) for (const e of q.earned_with ?? []) {
      if ((e.with ?? e.handle) !== other) continue;
      const m = { threshold: e.threshold ?? e.rung ?? null, date: e.date ?? e.day ?? e.since ?? null, by };
      out.set(`${m.by}:${m.threshold}:${m.date}`, m);
    }
  }
  return [...out.values()].sort((x, y) => String(x.date ?? "").localeCompare(String(y.date ?? "")) || String(x.by).localeCompare(String(y.by)) || (Number(x.threshold) || 0) - (Number(y.threshold) || 0));
}

/**
 * The read. `ix` is the door's pooled index; `{ a, b }` are two different residents the index holds. Returns the answer or `{ error: "bounce", ... }`.
 * A store that cannot be reached throws TownIndexUnreachable (the door's 503), never an empty pair.
 */
export async function pairRead({ a, b } = {}, { ix } = {}) {
  const A = typeof a === "string" ? a.trim() : "";
  const B = typeof b === "string" ? b.trim() : "";
  if (!A || !B) return bounce(422, "which pair?", 'town { read: "pair", args: { a: "<resident>", b: "<resident>" } } — two residents\' handles');
  if (A === B) return bounce(422, "a pair is two residents", `a and b are both "${A}": name two different residents`);
  for (const h of [A, B]) if (!(await ix.hasResident(h))) return bounce(404, `no resident "${h}"`, 'a resident is named by handle; town { read: "residents" } lists them');

  const rows = (await ix.lettersBetween(A, B)).slice().sort(newestFirst);
  const dir = (r) => (r.from_h === A ? "a_to_b" : "b_to_a");
  const mine = { a_to_b: rows.filter((r) => dir(r) === "a_to_b"), b_to_a: rows.filter((r) => dir(r) === "b_to_a") };
  const newest = { a_to_b: mine.a_to_b[0] ?? null, b_to_a: mine.b_to_a[0] ?? null };
  const oldest = rows.length ? rows[rows.length - 1] : null;
  const wanted = [newest.a_to_b, newest.b_to_a].filter(Boolean).map((r) => r.id);
  const bodies = await ix.letterBodies(wanted);
  const quote = (r) => {
    if (!r) return null;
    const line = firstLine(bodies.get(r.id)?.body);
    const cut = line.length > QUOTE_MAX;
    return { id: r.id, date: r.date ?? null, delivered_at: r.delivered_at ?? null, href: apiUrl(`/letters/${r.id}`), line: cut ? line.slice(0, QUOTE_MAX) : line, ...(cut ? { line_cut: true } : {}) };
  };

  // the milestones the pair reached together: the quest board's own rows, read for each side (they are symmetric; a missing side is said, not guessed)
  const boards = new Map();
  let milestonesUnavailable = null;
  for (const h of [A, B]) {
    try { boards.set(h, await ix.questBoard(h)); } catch (e) { if (e?.name === "TownIndexUnreachable") throw e; milestonesUnavailable = "the quest board could not be read for every side, so the milestones below may be short: unknown, not none"; }
  }

  return {
    read: "pair", a: A, b: B,
    first: oldest ? { id: oldest.id, date: oldest.date ?? null, delivered_at: oldest.delivered_at ?? null, from: oldest.from_h, href: apiUrl(`/letters/${oldest.id}`) } : null,
    letters: { a_to_b: mine.a_to_b.length, b_to_a: mine.b_to_a.length },
    latest: { a_to_b: quote(newest.a_to_b), b_to_a: quote(newest.b_to_a) },
    milestones: pairMilestones(boards, A, B),
    ...(milestonesUnavailable ? { milestones_unavailable: milestonesUnavailable } : {}),
    quote_rule: "by rule: the literal first line of the newest delivered letter each way; nobody keeps or edits a quote",
    letters_from: "the public letter index: delivered letters only, newest first (delivered_at, a bare date as that day's midnight, ties on id)",
    as_of: await ix.asOf(),   // the index's own head: the same answer for the same record, however many times it is asked
  };
}
