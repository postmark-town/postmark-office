// town-feed.mjs — `town { read: "feed", args: { sort, kinds, limit, since, household, cursor } }`: THE TOWN AS ONE STREAM, PUBLIC (POS-1027).
//
// One row per THING the town did, from six public records: a letter that crossed, an idea, a bug, an event, a mark a crossing decided, a resident who arrived.
// Nothing here is a second record: each source is the read that already answers it (town-feed-sources.mjs), and a thing is one row, with the time its own source
// gives it. A time a source does not have is never invented: a date-only source (an arrival's `joined`) says `at_precision: "day"`, and a row with no time says `at: null`.
//
// SORT: `newest` (the row's time), `backed` (the stamps behind it: an idea's net backing, a mark's stamps; a letter, bug, event or arrival has none and ranks as 0),
// `near` (metres from the named house: `household` supplies the origin, the walkers roll its members stand on). A house whose position the town does not
// hold says so (`near_unavailable`) and the rows come newest, never ranked from a guessed origin; a row with no place has no distance and ranks last.
//
// THE CURSOR is a position in ONE total order, never an offset: every row's key is (the sort's value(s), its kind's rank, its id), which is unique, so a page
// is "the rows strictly after the last row of the previous page" and a thing can be neither skipped nor shown twice however the kinds interleave or the values
// tie. The sources are read again for each page, so a thing that arrives between two pages appears where it belongs and never displaces one already served.
//
// BOUNDED, SAID: each source is read at most FETCH_CAP rows at a time, newest first. A source cut at its cap is named in `incomplete`, and in a time-ordered
// page the rows older than that source's oldest returned row are held back for the next page (it re-reads the source below the cursor), so a cut source
// can never make the merged order skip one of its rows.

const bounce = (code, defect, hint) => ({ error: "bounce", code, defect, hint });

export const FEED_KINDS = Object.freeze(["letter", "idea", "bug", "event", "mark", "arrival"]);
export const FEED_SORTS = Object.freeze(["newest", "backed", "near"]);
export const FEED_LIMIT = 20;
export const FEED_MAX = 100;
export const FETCH_CAP = 500;
const RANK = Object.fromEntries(FEED_KINDS.map((k, i) => [k, i]));

/** An instant as ISO from an ISO string, a Date, or a bare date (which is that day's midnight, UTC, said so); `null` for nothing. */
export function instantOf(v) {
  if (v == null || v === "") return { at: null };
  if (v instanceof Date) return Number.isFinite(v.getTime()) ? { at: v.toISOString() } : { at: null };
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return Number.isFinite(Date.parse(`${s}T00:00:00Z`)) ? { at: `${s}T00:00:00.000Z`, at_precision: "day" } : { at: null };
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? { at: new Date(ms).toISOString() } : { at: null };
}

// ── the total order ──────────────────────────────────────────────────────────

const timeDesc = (x, y) => (x === y ? 0 : x == null ? 1 : y == null ? -1 : x < y ? 1 : -1);
const asc = (x, y) => (x === y ? 0 : x < y ? -1 : 1);
const distAsc = (x, y) => asc(x ?? Infinity, y ?? Infinity);

/** A row's key for a sort: the values that order it, ending with the kind's rank and the id (so two rows never share a key). */
export function keyOf(row, sort) {
  const tail = [RANK[row.kind], String(row.id)];
  if (sort === "backed") return [row.backed ?? 0, row.at ?? null, ...tail];
  if (sort === "near") return [row.distance_m ?? null, row.at ?? null, ...tail];
  return [row.at ?? null, ...tail];
}
const COMPARE = {
  newest: [timeDesc, asc, asc],
  backed: [(x, y) => asc(y, x), timeDesc, asc, asc],
  near: [distAsc, timeDesc, asc, asc],
};
/** Negative when key `a` comes before key `b` in `sort`'s order. */
export function compareKeys(a, b, sort) {
  const cmps = COMPARE[sort];
  for (let i = 0; i < cmps.length; i++) { const c = cmps[i](a[i], b[i]); if (c) return c; }
  return 0;
}

const b64 = (s) => Buffer.from(s, "utf8").toString("base64url");
export const encodeFeedCursor = (sort, key) => `f1.${b64(JSON.stringify([sort, key]))}`;
export function decodeFeedCursor(s) {
  const m = /^f1\.([A-Za-z0-9_-]+)$/.exec(String(s ?? ""));
  if (!m) return null;
  try {
    const [sort, key] = JSON.parse(Buffer.from(m[1], "base64url").toString("utf8"));
    if (!FEED_SORTS.includes(sort) || !Array.isArray(key) || key.length !== COMPARE[sort].length) return null;
    return { sort, key };
  } catch { return null; }
}

// ── the read ─────────────────────────────────────────────────────────────────

const wholeIn = (v, lo, hi, fallback) => { const n = Number(v); return Number.isFinite(n) && n >= lo ? Math.min(Math.floor(n), hi) : fallback; };

/** The kinds asked for: an array or a comma list, each one of FEED_KINDS; absent is all six. `{ kinds }` or `{ refused }`. */
export function judgeKinds(raw) {
  if (raw === undefined || raw === null || raw === "") return { kinds: [...FEED_KINDS] };
  const list = (Array.isArray(raw) ? raw : String(raw).split(",")).map((s) => String(s).trim()).filter(Boolean);
  const bad = list.find((k) => !FEED_KINDS.includes(k));
  if (bad !== undefined || !list.length) return { refused: [422, `kinds: ${JSON.stringify(bad ?? raw)} is not a kind of feed row`, `kinds: any of ${FEED_KINDS.join(", ")}, as a list or comma-separated`] };
  return { kinds: FEED_KINDS.filter((k) => list.includes(k)) };
}

/**
 * The read. `sources` is { letter, idea, bug, event, mark, arrival, origin, asOf } (town-feed-sources.mjs builds the real ones; a suite passes its own):
 *   sources[kind]({ since, before, cap }) → { rows, cut }   rows: { id, kind, at, at_precision?, href, title, by?, backed?, place?, state? }, newest first
 *   sources.origin(household)             → { x, y, from } | { unavailable }
 *   sources.asOf()                        → the record's own date
 * A source that throws is named in `unavailable` and its kind is left out of this answer, never read as empty; TownIndexUnreachable is the door's 503.
 */
export async function feedRead(args = {}, { sources } = {}) {
  const sort = args.sort === undefined || args.sort === null || args.sort === "" ? "newest" : String(args.sort);
  if (!FEED_SORTS.includes(sort)) return bounce(422, `sort: ${JSON.stringify(args.sort)} is not a feed sort`, `sort: ${FEED_SORTS.join(" | ")}`);
  const k = judgeKinds(args.kinds);
  if (k.refused) return bounce(...k.refused);
  const limit = wholeIn(args.limit, 1, FEED_MAX, FEED_LIMIT);
  const limitNote = args.limit != null && args.limit !== "" && limit !== Number(args.limit) ? { limit_note: `limit ${JSON.stringify(args.limit)} is not a whole number from 1 to ${FEED_MAX}: this page carries ${limit}` } : {};
  let sinceAt = null;
  if (args.since !== undefined && args.since !== null && args.since !== "") {
    sinceAt = instantOf(args.since).at;
    if (!sinceAt) return bounce(422, `since: ${JSON.stringify(args.since)} is not a time`, "since: an ISO instant (2026-11-13T00:00:00Z) or a date (2026-11-13): only rows from then on");
  }
  let cursor = null;
  if (args.cursor !== undefined && args.cursor !== null && args.cursor !== "") {
    cursor = decodeFeedCursor(args.cursor);
    if (!cursor) return bounce(422, "cursor: that is not a feed cursor", "pass the `cursor` a feed page handed you, unchanged");
    if (cursor.sort !== sort) return bounce(422, `cursor: that cursor is for sort "${cursor.sort}", this call asks "${sort}"`, "a cursor continues the sort it came from");
  }
  const household = typeof args.household === "string" ? args.household.trim() : "";

  // the near origin: said, never guessed
  let origin = null, nearUnavailable = null;
  if (sort === "near") {
    if (!household) nearUnavailable = 'near ranks from a house: pass household: "<slug>" (its own position is the origin)';
    else {
      const o = await sources.origin(household);
      if (o?.x != null && o?.y != null) origin = o; else nearUnavailable = o?.unavailable ?? `the town holds no position for ${household}'s residents, so near cannot be ranked from it`;
    }
  }
  const effective = nearUnavailable ? "newest" : sort;   // an unranked near is newest, said
  if (cursor && nearUnavailable && cursor.sort === "near") cursor = null;   // a near cursor cannot continue an unranked page

  // each source, once per page, below the cursor's time when the order is by time (so a cut source is read on down, never skipped)
  const before = cursor && effective === "newest" ? cursor.key[0] : null;
  const unavailable = [], incomplete = [];
  const gathered = [];
  const horizons = [];
  for (const kind of k.kinds) {
    try {
      const r = await sources[kind]({ since: sinceAt, before, cap: FETCH_CAP });
      for (const row of r.rows ?? []) gathered.push(row);
      if (r.cut) { incomplete.push(kind); const oldest = (r.rows ?? []).map((x) => x.at).filter(Boolean).sort()[0]; if (oldest) horizons.push(oldest); }
    } catch (e) {
      if (e?.name === "TownIndexUnreachable") throw e;
      unavailable.push({ kind, reason: `the ${kind} source could not be read (${String(e?.message ?? e).slice(0, 100)}): its rows are missing here, not absent from the town` });
    }
  }
  // the rows that exist: no duplicate thing (a kind's id is unique), a time before `since` is out, the distance and backing are the row's own
  const seen = new Set();
  let rows = [];
  for (const r of gathered) {
    const id = `${r.kind}\0${r.id}`;
    if (seen.has(id)) continue;
    seen.add(id);
    if (sinceAt && (r.at == null || r.at < sinceAt)) continue;
    const out = { ...r };
    if (origin && r.place && Number.isFinite(r.place.x) && Number.isFinite(r.place.y)) out.distance_m = Math.round(Math.hypot(r.place.x - origin.x, r.place.y - origin.y));
    rows.push(out);
  }
  rows.sort((x, y) => compareKeys(keyOf(x, effective), keyOf(y, effective), effective));
  if (cursor) rows = rows.filter((r) => compareKeys(keyOf(r, effective), cursor.key, effective) > 0);

  // a time-ordered page holds back the rows below the oldest reach of a cut source: that source may have more there
  let heldBack = false, horizon = null;
  if (effective === "newest" && horizons.length) {
    horizon = horizons.sort().at(-1);
    const kept = rows.filter((r) => r.at != null && r.at >= horizon);
    heldBack = kept.length < rows.length;
    rows = kept;
  }
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  // where the next page begins: below the last row served, or (a page that held everything back) at the horizon the cut source reached
  const nextKey = page.length && (rows.length > limit || heldBack) ? keyOf(last, effective)
    : !page.length && heldBack ? [horizon, FEED_KINDS.length, "\uffff"] : null;
  const more = nextKey !== null;
  return {
    read: "feed", sort: effective, ...(effective !== sort ? { sort_asked: sort } : {}), kinds: k.kinds,
    ...(sinceAt ? { since: sinceAt } : {}), limit, ...limitNote,
    ...(nearUnavailable ? { near_unavailable: nearUnavailable } : origin ? { near_from: origin.from ?? `${household}'s position` } : {}),
    shown: page.length, rows: page,
    complete: !more && !unavailable.length && !(incomplete.length && effective !== "newest"),
    ...(more ? { cursor: encodeFeedCursor(effective, nextKey), more_note: 'pass cursor back: town { read: "feed", args: { cursor, sort, kinds, limit } } continues below the last row' } : {}),
    ...(incomplete.length ? { incomplete: incomplete.map((kind) => ({ kind, cap: FETCH_CAP, note: effective === "newest" ? `the ${kind} source holds more than ${FETCH_CAP} rows at once; older ones come on later pages` : `the ${kind} source holds more than ${FETCH_CAP} rows; this ranking is over its newest ${FETCH_CAP}` })) } : {}),
    ...(unavailable.length ? { unavailable } : {}),
    as_of: await sources.asOf(),
  };
}
