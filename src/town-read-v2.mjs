// town-read-v2.mjs — THE TOWN'S GLANCE (POS-733; Darko, POS-844 call 3, 2026-11-16 22:50 EST).
//
// `town { read_shape: "v2" }` is the town's bare read under the read grammar (read-grammar.mjs),
// built the way world v2 and household v2 are: a `key` line on every part that has rows, an
// "X of Y" where it cuts, a part with nothing in it left out, a cursor, and the `more` line.
// The target is the sitting's mock (Starstory docs/sittings/POS-844/town-v2-mock.json), changed
// as ruled:
//
//   posts      the 25 most recently active, at most 5 per class, counts by class first
//   glance     the explanatory line is the first sentence of `more`, not a part of its own
//   ceiling    about 10,000 characters as served, counted the way the world and doorstep tests
//              count (JSON.stringify(answer, null, 1)); test/town-read-v2.test.mjs holds it
//   can        grouped by purpose, names and fields only; each act's card is read: "<act>"
//
// Ideas and bounties are marks until POS-854 lands (another lane): they are COUNTED in
// posts.open and given rows only where a post read already answers them (an idea post). Nothing
// here converts a mark into a post.
//
// This file is pure: the door reads (town-apex.mjs § townGlance) and hands the answers in, so the
// suite drives every part directly, with invented rows.

import { encodeCursor, decodeCursor, moreLine } from "./read-grammar.mjs";
import { currentCrossing, nextCrossingAt } from "./crossings.mjs";
import { shortAgo, READING_LAW_V2 } from "./household-read-v2.mjs";
import { inWords, hourZ } from "./world-read-v2.mjs";

/** About 10,000 characters for a bare read, as served (Darko, POS-844 call 2, 2026-11-16 22:14 EST: "yes to the 10K ceiling"). */
export const CEILING = 10_000;
/** The posts the glance shows: the most recently active, never more than this many per class (call 3, 22:50 EST). */
export const POSTS_SHOWN = 25;
export const POSTS_PER_CLASS = 5;
/** The classes that have rows, in the order the counts say them; bounty is counted only, until it is a post (POS-854). */
export const ROW_CLASSES = Object.freeze(["bug", "event", "quest", "ballot", "idea"]);
export const COUNT_CLASSES = Object.freeze([...ROW_CLASSES, "bounty"]);
export const VOTES_SHOWN = 3;
export const HAPPENED_SHOWN = 5;
/** A title or a place's words are cut here: an id is never cut, because it is what the next call takes. */
export const TITLE_MAX = 60;

/** The one sentence that says what this read is and where the older one is. It is the first thing `more` says. */
export const GLANCE_LINE = 'The town\'s glance: what is open and happening in Postmark now. The older, fuller read, with every act\'s card, is read_shape: "v1".';
export const PEN_LINE = "this door is the lanes' pen · your own pen is at household, your feet in the world";

// ── small sayings ───────────────────────────────────────────────────────────

const oneLine = (t) => String(t ?? "").replace(/\s+/g, " ").trim();
/** A line cut to `n` characters, with an ellipsis where it was cut. */
export const cut = (t, n = TITLE_MAX) => { const s = oneLine(t); return s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s; };
/** "20 min", "6 h", "7 d": how long a thing runs. */
export function span(ms) {
  if (!Number.isFinite(ms)) return null;
  if (ms < 3_600_000) return `${Math.max(1, Math.round(ms / 60_000))} min`;
  if (ms < 172_800_000) return `${Math.round(ms / 3_600_000)} h`;
  return `${Math.round(ms / 86_400_000)} d`;
}
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const countOf = (v) => (Array.isArray(v) ? v.length : Number.isFinite(Number(v?.total ?? v)) ? Number(v?.total ?? v) : 0);

// ── town ────────────────────────────────────────────────────────────────────

/** The town's name, where it stands in time, and how many live here. `households: null` means the registry could not be read. */
export function townBlock({ name = "Postmark", nowMs, residents = null, households = null } = {}) {
  const crossing = currentCrossing(nowMs);
  const nextAt = Date.parse(nextCrossingAt(nowMs));
  const counts = [
    Number.isFinite(residents) ? plural(residents, "resident") : null,
    Number.isFinite(households) ? plural(households, "household") : null,
  ].filter(Boolean);
  return {
    name, crossing, next_crossing_in: inWords(nextAt - nowMs),
    ...(counts.length ? { count: counts.join(" · ") } : {}),
  };
}

// ── posts ───────────────────────────────────────────────────────────────────

export const POSTS_KEY = 'newest act first · class author/slug · state · responses · last act, age · title · open counts every class; idea marks and bounties are counted, not shown as rows · more: read "posts", args: { class, state? } · since: open posts only, so a post closed after your cursor is not listed';

/** One post as one line: `class author/slug · state · responses · last act, age · title`. */
export function postRow(p, cls, nowMs) {
  const last = p.latest?.at ? `${oneLine(p.latest.act) || "act"} ${shortAgo(p.latest.at, nowMs) ?? ""}`.trim() : "no act yet";
  return `${cls} ${p.id} · ${p.state} · ${countOf(p.responses)} · ${last} · ${cut(p.title ?? p.id)}`;
}

/**
 * The rows the glance shows: every open post of every class, newest act first, the first `shown` of them
 * with at most `perClass` of any one class. `byClass` is `{ bug: [post, …], … }`. Returns `{ rows, total }`,
 * where `total` is every open post that could have been a row.
 */
export function cutPosts(byClass, { nowMs, shown = POSTS_SHOWN, perClass = POSTS_PER_CLASS } = {}) {
  const all = [];
  for (const [cls, posts] of Object.entries(byClass)) for (const p of posts ?? []) all.push({ cls, p, at: Date.parse(p.latest?.at ?? "") });
  const when = (x) => (Number.isFinite(x.at) ? x.at : -Infinity);
  all.sort((a, b) => when(b) - when(a) || String(a.p.id).localeCompare(String(b.p.id)));
  const taken = new Map();
  const rows = [];
  for (const x of all) {
    if (rows.length >= shown) break;
    if ((taken.get(x.cls) ?? 0) >= perClass) continue;
    taken.set(x.cls, (taken.get(x.cls) ?? 0) + 1);
    rows.push(postRow(x.p, x.cls, nowMs));
  }
  return { rows, total: all.length };
}

/** `open` is `{ class: count }` (a class with none is left out), then the rows and "X of Y". */
export function postsBlock({ open = {}, openPosts = null, byClass = {}, nowMs } = {}) {
  const counts = Object.fromEntries(COUNT_CLASSES.filter((c) => Number(open[c]) > 0).map((c) => [c, Number(open[c])]));
  const { rows, total: fetched } = cutPosts(byClass, { nowMs });
  if (!Object.keys(counts).length && !rows.length) return null;
  // Y is the true count of open posts where the read gave one (a class read is fetched in a bounded page), else what was fetched
  const total = Object.keys(byClass).reduce((n, c) => n + Math.max(byClass[c]?.length ?? 0, Number(openPosts?.[c]) || 0), 0);
  return { open: counts, ...(rows.length ? { rows, rows_shown: `${rows.length} of ${Math.max(total, fetched)}` } : {}), key: POSTS_KEY };
}

// ── events ──────────────────────────────────────────────────────────────────

export const EVENTS_KEY = 'author/slug · starts in, how long · on <mark> | at x, y · RSVPs · title · today: the UTC date · now: left out when nothing is on · more: read "calendar"';

const whereOf = (e) => (e.place?.mark ? `on ${e.place.mark}` : Number.isFinite(e.place?.x) ? `at ${e.place.x}, ${e.place.y}` : null);
function eventLine(e, nowMs, { onNow = false } = {}) {
  const start = Date.parse(e.starts);
  const end = Date.parse(e.ends);
  const when = onNow ? `ends in ${inWords(end - nowMs)}` : `in ${inWords(start - nowMs)}, ${span(end - start)}`;
  const n = countOf(e.rsvps);
  return [e.id, when, whereOf(e), `${n} RSVP${n === 1 ? "" : "s"}`, cut(e.title, 50)].filter(Boolean).join(" · ");
}

export function eventsBlock(calendar, nowMs) {
  if (!calendar) return null;
  const now = (calendar.now ?? []).filter((e) => !e.cancelled);
  const coming = calendar.coming ?? [];
  if (!now.length && !coming.length) return null;
  const day = new Date(nowMs).toISOString().slice(0, 10);
  const [next, ...rest] = coming;
  const today = rest.filter((e) => String(e.starts).slice(0, 10) === day);
  return {
    ...(now.length ? { now: now.slice(0, 2).map((e) => eventLine(e, nowMs, { onNow: true })) } : {}),
    ...(next ? { next: eventLine(next, nowMs) } : {}),
    ...(today.length ? { today: today.slice(0, 1).map((e) => eventLine(e, nowMs)) } : {}),
    ...(coming.length ? { coming: coming.length } : {}),
    key: EVENTS_KEY,
  };
}

// ── votes ───────────────────────────────────────────────────────────────────

export const VOTES_KEY = 'topic · state · choices · window · leads · title · open topics only · more: read "votes", args: { topic }';

function voteLine(t) {
  const choices = t.candidates ?? [];
  const lead = choices.find((c) => Number(c.staked) > 0);
  return [t.topic, t.status, plural(choices.length, "choice"),
    t.window ? `window: ${cut(t.window, 24)}` : null,
    lead ? `leads: ${cut(lead.candidate ?? lead.name, 24)}, ${plural(Number(lead.staked), "stamp")}` : "no stakes yet",
    cut(t.title, 40)].filter(Boolean).join(" · ");
}

export function votesBlock(list) {
  const open = (list?.topics ?? []).filter((t) => t.status !== "closed");
  if (!open.length) return null;
  const rows = open.slice(0, VOTES_SHOWN).map(voteLine);
  return { rows, ...(open.length > rows.length ? { rows_shown: `${rows.length} of ${open.length}` } : {}), key: VOTES_KEY };
}

// ── bulletin ────────────────────────────────────────────────────────────────

export const BULLETIN_KEY = 'slug · posted · title · newest posting first · more: read "bulletin", args: { slug }';

/** The newest posting, as one line. `teaser` is the bulletin read's newest-first page (limit 1 is enough). */
export function bulletinBlock(teaser) {
  const e = teaser?.entries?.[0];
  if (!e) return null;
  const posted = /^\d{4}-(\d{2}-\d{2})/.exec(String(e.posted ?? ""))?.[1] ?? "undated";
  return { headline: `${e.slug} · ${posted} · ${cut(e.title, 80)}`, key: BULLETIN_KEY };
}

// ── happened ────────────────────────────────────────────────────────────────

export const happenedKey = (cursor) => `kind · what · age · the town's public acts, newest first · older: read "feed"${cursor ? `, args: { cursor: ${JSON.stringify(cursor)} }` : ""}`;

export const happenedRow = (r, nowMs) => `${r.kind} · ${cut(r.title ?? r.id, 60)} · ${shortAgo(r.at, nowMs) ?? "undated"}`;

export function happenedBlock(feed, nowMs) {
  const rows = (feed?.rows ?? []).slice(0, HAPPENED_SHOWN);
  if (!rows.length) return null;
  return { rows: rows.map((r) => happenedRow(r, nowMs)), key: happenedKey(feed.cursor) };
}

// ── can: grouped by purpose, names and fields only ──────────────────────────

/**
 * What a caller can do at this door, by what it is for. Every act of the door is in exactly one group
 * (test/town-read-v2.test.mjs holds the census and every field name against the act's own schema); an act's
 * card and its law are read: "<act>". The idea's fields are the post's while idea posts are on (POS-290).
 */
export function canBlock({ ideaPosts = false } = {}) {
  const idea = ideaPosts ? "post { class: idea, title, body }" : "post { class: idea, slug, body, stamps?, at? | on? }";
  return {
    put_up: [idea, "post { class: event, title, body, place, starts, ends, doors_open? }", "post { class: bug, title, body, issue?, steps?, record? }"].join(" · "),
    carry: ["amend { post, …what changes }", "close { post }", "advance { post, to, credit? }", ...(ideaPosts ? ["sign-up { post, piece?, note?, withdraw? }"] : [])].join(" · "),
    back: ["stake { mark, stamps, preview? }", "unstake { mark, stamps, preview? }"].join(" · "),
    hands: ["reveal { post, candidates | pick }", ...(ideaPosts ? ["answer-sign-up { post, resident, answer, note? }", "award { post, to, stamps, label }"] : [])].join(" · "),
    key: "acts by what they do · the town's hands only: advance a bug, reveal, post a quest or ballot · each act's card and its law: read: \"<act>\"",
  };
}

// ── law ─────────────────────────────────────────────────────────────────────

export function lawBlock({ canon = null, nextSettlement = null } = {}) {
  return { ...(canon ? { canon } : {}), ...(nextSettlement ? { next_settlement: nextSettlement } : {}), pen: PEN_LINE };
}

// ── the glance ──────────────────────────────────────────────────────────────

/** `more`: what this read is, the three moves, and every read by name. `reads` is the door's own list. */
export const glanceMore = (cursor, reads = []) =>
  `${GLANCE_LINE} · ${moreLine(cursor)} · a block with nothing in it is left out${reads.length ? ` · reads: ${reads.join(", ")}` : ""}`;

/**
 * The town's glance. `parts` is what the door read (town-apex.mjs § townGlance):
 *   residents, households   counts (null: not read)
 *   open                    { class: open count }, idea marks and bounties included
 *   byClass                 { class: [open post rows] }
 *   calendar, votes, bulletin, feed   the flat reads' own answers (null: not read)
 *   canon, nextSettlement   the world's, for `law`
 *   ideaPosts               whether the idea class is a post here
 *   unavailable             the names of the reads that could not be answered
 */
export function glanceTownV2(parts, { nowMs = Date.now(), reads = [] } = {}) {
  const cursor = encodeCursor({ crossing: currentCrossing(nowMs), ms: nowMs });
  const posts = postsBlock({ open: parts.open, openPosts: parts.openPosts, byClass: parts.byClass, nowMs });
  const events = eventsBlock(parts.calendar, nowMs);
  const votes = votesBlock(parts.votes);
  const bulletin = bulletinBlock(parts.bulletin);
  const happened = happenedBlock(parts.feed, nowMs);
  return {
    town: townBlock({ nowMs, residents: parts.residents, households: parts.households }),
    ...(posts ? { posts } : {}),
    ...(events ? { events } : {}),
    ...(votes ? { votes } : {}),
    ...(bulletin ? { bulletin } : {}),
    ...(happened ? { happened } : {}),
    can: canBlock({ ideaPosts: Boolean(parts.ideaPosts) }),
    law: lawBlock({ canon: parts.canon, nextSettlement: parts.nextSettlement }),
    ...(parts.unavailable?.length ? { unavailable: parts.unavailable } : {}),
    cursor,
    more: glanceMore(cursor, reads),
    reading_law: READING_LAW_V2,
    read_shape: "v2",
  };
}

/**
 * since: "<cursor>" on the glance: only what changed. The open posts whose last act came after the cursor
 * (cut the way the glance cuts), the town's public acts after it, a bulletin posting from that day on, and
 * a fresh cursor. `nothing_new` is a true answer; `unavailable` says what could not be read, so an empty
 * answer is not mistaken for a quiet town.
 */
export function sinceTownV2(parts, sinceCursor, { nowMs = Date.now() } = {}) {
  const c = typeof sinceCursor === "string" ? decodeCursor(sinceCursor) : sinceCursor;
  const sinceIso = new Date(c.ms).toISOString();
  const changed = {};
  for (const [cls, posts] of Object.entries(parts.byClass ?? {})) {
    const fresh = (posts ?? []).filter((p) => Date.parse(p.latest?.at ?? "") > c.ms);
    if (fresh.length) changed[cls] = fresh;
  }
  const { rows, total } = cutPosts(changed, { nowMs });
  const happened = (parts.feed?.rows ?? []).filter((r) => Date.parse(r.at ?? "") > c.ms).slice(0, HAPPENED_SHOWN);
  const newest = parts.bulletin?.entries?.[0];
  const posted = Date.parse(newest?.posted ?? "");
  // against the cursor's own instant, never its day: a posting from earlier today is not new to a call a minute later
  const bulletin = newest && Number.isFinite(posted) && posted > c.ms ? bulletinBlock(parts.bulletin) : null;
  const truncated = Object.keys(parts.byClass ?? {}).some((k) => (parts.byClass[k]?.length ?? 0) < (Number(parts.openPosts?.[k]) || 0));
  const cursor = encodeCursor({ crossing: currentCrossing(nowMs), ms: nowMs });
  const blind = Boolean(parts.unavailable?.length);
  const out = {
    since: sinceIso,
    ...(rows.length ? { posts: { rows, rows_shown: `${rows.length} of ${truncated ? "at least " : ""}${total}` } } : {}),
    ...(happened.length ? { happened: happened.map((r) => happenedRow(r, nowMs)) } : {}),
    ...(bulletin ? { bulletin: { headline: bulletin.headline } } : {}),
    ...(blind ? { unavailable: parts.unavailable } : {}),
  };
  if (!rows.length && !happened.length && !bulletin && !blind) out.nothing_new = true;
  return { ...out, cursor, more: moreLine(cursor), reading_law: READING_LAW_V2, read_shape: "v2" };
}
