// resident-day.mjs — `household { read: "day", args: { handle, date } }`: ONE RESIDENT'S UTC DAY, IN PLAIN SENTENCES (POS-1027; Darko, POS-1024: "a resident's day").
//
// WRITTEN BY RULE, NOT BY A MODEL, from what the town already holds in public about one resident on one UTC calendar day:
//
//   letters     the delivered letters they wrote that day (the letter's own date), to whom; the delivered letters that arrived that day;
//   acts        the public verbs in the acts table (hearth-public.mjs § PUBLIC_HOUSE_VERBS), counted: said (never the words), walked, went in, left or withdrew
//               marks, backed marks, put up or moved a post. A row carries no payload, so nothing a resident wrote is repeated here;
//   stamps      the ledger's lines whose giver is them, dated that day, by what they were spent on (a mark, an idea, a ballot, a pot, a gift).
//
// QUIET IS NOT UNAVAILABLE. A day every source was read for, and found nothing on, says so in one explicit sentence (`quiet: true`). A source that could not be
// read (or whose window was cut) is named in `unavailable` and is never counted as nothing: with any source unavailable `quiet` is null and no quiet sentence is
// said, so a missing input can never read as a calm day. The sentences are deterministic: the same record gives the same words, in a fixed order.

import { PUBLIC_HOUSE_VERBS } from "./hearth-public.mjs";
import { wentRows } from "./household-read-v2.mjs";
import { recipientsOf } from "./town-index-store.mjs";

const bounce = (code, defect, hint) => ({ error: "bounce", code, defect, hint });
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

/** The UTC date of an instant, YYYY-MM-DD. */
export const utcDate = (ms) => new Date(ms).toISOString().slice(0, 10);

/** A valid calendar date string, or false (2026-02-30 is not one). */
export const validDay = (s) => DAY_RE.test(String(s)) && Number.isFinite(Date.parse(`${s}T00:00:00Z`)) && utcDate(Date.parse(`${s}T00:00:00Z`)) === s;

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
/** "a, b and c" (at most `show` names, then "and N more"). */
export function nameList(names, show = 5) {
  const list = [...new Set(names)].sort();
  if (list.length <= show) return list.length < 2 ? list.join("") : `${list.slice(0, -1).join(", ")} and ${list.at(-1)}`;
  return `${list.slice(0, show).join(", ")} and ${list.length - show} more`;
}

/** The kinds of act a day counts, in the order the sentences say them. */
const WALKS = new Set(["walk", "land", "ride"]);

/**
 * The sentences and counts from the day's parts. Every part is `{ read: false }` (unavailable) or the rows it found. Pure: the caller read the record.
 * `letters.sent` rows are `{ to: [handles] }`; `letters.received` rows are `{ from }`; `acts` rows `{ action, class, object }`; `stamps` rows are wentRows'.
 */
export function daySentences({ letters, received, acts, stamps }) {
  const sentences = [];
  const counts = {};
  const out = (key, n) => { counts[key] = n; };
  if (letters?.read) {
    const sent = letters.rows;
    out("letters_sent", sent.length);
    if (sent.length) {
      const to = sent.flatMap((l) => l.to);
      sentences.push(`wrote ${plural(sent.length, "letter")}, to ${nameList(to)}`);
    }
  }
  if (received?.read) {
    out("letters_received", received.rows.length);
    if (received.rows.length) sentences.push(`had ${plural(received.rows.length, "letter")} arrive, from ${nameList(received.rows.map((l) => l.from))}`);
  }
  if (acts?.read) {
    const by = (pred) => acts.rows.filter(pred);
    const said = by((a) => a.action === "say");
    const walks = by((a) => WALKS.has(a.action));
    const entered = by((a) => a.action === "enter");
    const left = by((a) => a.action === "leave-mark");
    const withdrew = by((a) => a.action === "withdraw" && a.class === "mark");
    const backed = by((a) => a.action === "stake" || a.action === "unstake");
    const posted = by((a) => a.action === "post");
    const moved = by((a) => ["amend", "close", "advance", "sign-up", "withdraw-sign-up", "vote", "rsvp", "host", "announce", "amend-event", "cancel-event"].includes(a.action) && a.class !== "mark");
    out("said", said.length); out("walks", walks.length); out("went_in", entered.length); out("marks_left", left.length);
    out("marks_withdrawn", withdrew.length); out("marks_backed", backed.length); out("posts_put_up", posted.length); out("post_acts", moved.length);
    if (said.length) sentences.push(said.length === 1 ? "said something" : `spoke ${plural(said.length, "time")}`);
    if (walks.length) sentences.push(`walked ${plural(walks.length, "time")}`);
    if (entered.length) sentences.push(`went in ${nameList(entered.map((a) => a.object).filter(Boolean)) || plural(entered.length, "place")}`);
    if (left.length) sentences.push(`left ${plural(left.length, "mark")}`);
    if (withdrew.length) sentences.push(`withdrew ${plural(withdrew.length, "mark")}`);
    if (backed.length) sentences.push(`backed ${plural(backed.length, "mark")} with stamps`);
    if (posted.length) sentences.push(`put up ${nameList(posted.map((a) => `a ${a.class ?? "post"}`)) || plural(posted.length, "post")}`);
    if (moved.length) sentences.push(`took part in ${plural(moved.length, "post")} (${plural(moved.length, "act")})`);
  }
  if (stamps?.read) {
    const kinds = {};
    for (const r of stamps.rows) kinds[r.kind] = (kinds[r.kind] ?? 0) + r.stamps;
    const total = (...ks) => ks.reduce((n, k) => n + (kinds[k] ?? 0), 0);
    out("stamps_on_marks", total("mark")); out("stamps_on_ideas", total("idea")); out("stamps_on_ballots", total("ballot")); out("stamps_on_pots", total("pot")); out("stamps_given", total("gift"));
    for (const [k, label] of [["idea", "an idea"], ["mark", "a mark"], ["ballot", "a ballot"], ["pot", "a pot"]]) if (kinds[k]) sentences.push(`put ${plural(kinds[k], "stamp")} behind ${plural(stamps.rows.filter((r) => r.kind === k).length, label.replace(/^an? /, ""))}`);
    if (kinds.gift) sentences.push(`gave ${plural(kinds.gift, "stamp")} to ${nameList(stamps.rows.filter((r) => r.kind === "gift").map((r) => r.to))}`);
  }
  return { sentences, counts };
}

/**
 * The read. `ix` is the door's pooled index. Returns the answer or `{ error: "bounce", ... }`; an index that cannot be reached throws (the door's 503).
 */
export async function dayRead({ handle, date } = {}, { ix, nowMs = Date.now(), ideaIds = null } = {}) {
  const h = typeof handle === "string" ? handle.trim() : "";
  if (!h) return bounce(422, "whose day?", 'household { read: "day", args: { handle: "<resident>", date?: "YYYY-MM-DD" } } — a resident\'s handle');
  const today = utcDate(nowMs);
  const day = date === undefined || date === null || date === "" ? today : String(date).trim();
  if (!validDay(day)) return bounce(422, `date: ${JSON.stringify(date)} is not a calendar date`, "date: a UTC day as YYYY-MM-DD (omit it for today, UTC)");
  if (day > today) return bounce(422, `${day} has not come yet`, `today is ${today} UTC; ask for a day up to it`);
  if (!(await ix.hasResident(h))) return bounce(404, `no resident "${h}"`, 'a resident is named by handle; town { read: "residents" } lists them');

  const from = `${day}T00:00:00.000Z`;
  const to = new Date(Date.parse(from) + DAY_MS).toISOString();
  const unavailable = [];
  // each source reads on its own: one that fails is named and never counted as nothing; the index being unreachable at all is the door's 503
  const soft = async (name, fn, why) => {
    try { return await fn(); } catch (e) { if (e?.name === "TownIndexUnreachable") throw e; unavailable.push(`${name}: ${why}`); return { read: false }; }
  };
  const letters = await soft("letters", async () => {
    const day_ = await ix.lettersOfDay(h, day);
    return {
      read: true,
      sent: day_.sent.filter((r) => r.delivered_at).map((r) => ({ id: r.id, to: recipientsOf(r) })),
      received: day_.received.map((r) => ({ id: r.id, from: r.from_h })),
    };
  }, "the letters could not be read");
  const acts = await soft("acts", async () => {
    const r = await ix.actsOfActor(h, { fromIso: from, toIso: to, verbs: PUBLIC_HOUSE_VERBS });
    if (r.cut) throw new Error("cut");
    return { read: true, rows: r.rows };
  }, "the acts could not be read for the whole day");
  const stamps = await soft("stamps", async () => {
    const lines = await ix.stampLinesSince(from, { limit: 20000 });
    if (lines.cut) throw new Error("cut");
    const rows = wentRows(lines.rows, new Set([h]), { house: [], ideaIds }).filter((r) => r.date === day);
    return { read: true, rows };
  }, "the ledger window was too long to read whole");

  const parts = { letters: letters.read ? { read: true, rows: letters.sent } : letters, received: letters.read ? { read: true, rows: letters.received } : letters, acts, stamps };
  const { sentences, counts } = daySentences(parts);
  const blind = unavailable.length > 0;
  const quiet = blind ? null : sentences.length === 0;
  return {
    read: "day", handle: h, date: day,
    sentences: quiet ? [`A quiet day: nothing public was recorded for ${h} on ${day}.`] : sentences,
    counts,
    quiet,
    ...(blind ? { unavailable, unavailable_note: "a source that could not be read is not a quiet day: these sentences leave out what it would have said" } : {}),
    written_by: "rule, from the public record (letters, public acts, the stamp ledger), not by a model",
    as_of: await ix.asOf(),
  };
}
