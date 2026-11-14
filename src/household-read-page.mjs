// household-read-page.mjs — CORE-88: bounded pages of the household reads the waiting stubs open.
//
// THE RULING (Wright, Settled 2026-11-14 07:23Z on CORE-88): "Give each read a stub that points to (stances, stakes'
// at-risk set, needs-you) a bounded page with a cursor, using the read's existing limit/cursor where it has them, and the
// same pattern where it doesn't. Every page stays under the 10,000-byte cap. No new read names unless an existing one can't
// take a page. Keep today's unpaged answers byte-for-byte for callers who don't pass a cursor, unless that alone breaks the
// cap. If it does, name the change in the Build."
//
// WHAT THIS IS: presentation of answers the reads already derive. Nothing here reads a store, judges eligibility or changes
// what waits: it takes the answer a read built and, only when that answer's delivered text would not fit a page, hands it
// back in pages. A page is the largest run of rows whose WHOLE answer (the read's own context included) fits PAGE_BYTES,
// with the cursor of the first row not on it. A page always carries at least one row; a row that cannot fit even alone has
// its over-long strings folded and counted (a mark's body is ≤ 150 characters by the class grammar, so this is the law's
// own bound being checked, not a case the data reaches).
//
// THE MEASURE is the connector's own text: JSON.stringify(answer, null, 1) in UTF-8 bytes (mcp.mjs § contentFor).

/** The connector's cap on a tool result's text, in UTF-8 bytes. An answer at or under it is deliverable, so it is returned untouched. */
export const CAP_BYTES = 10000;
/** What a page is BUILT to once paging is needed (headroom under the cap for a field the door adds). It is not the threshold: an answer of 9,001 to 10,000 bytes fits and is not paged. */
export const PAGE_BYTES = 9000;

/** The text the connector delivers for an answer, in UTF-8 bytes. */
export const textBytes = (answer) => Buffer.byteLength(JSON.stringify(answer, null, 1), "utf8");

/** A cursor is an index into a list, as a string (stances' own: world-stance.mjs § stanceShadow). Unreadable is the start. */
export const startOf = (cursor) => {
  const n = Number.parseInt(String(cursor ?? "0"), 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

// ── a single field over the cap (Wright, verified 2026-11-14 08:37Z) ────────
//
// "A single field over the cap is cut off with a plain marker that says how many bytes were cut and where the full text lives.
// That's the read or source that already holds it whole … 'Nothing waiting is lost' means every item is reachable, not that every
// byte comes through this read. If there's no such read for a field, name it in the Build." No fragment paging, no field cursor.
//
// A row is cut ONLY when it cannot be delivered whole: a lone row that fits the hard cap goes out whole even past the 9,000 page
// target. Then the longest string anywhere in it (top level or nested) is cut at a character boundary, just enough that the whole
// answer, markers included, is ≤ CAP_BYTES, and says in the field itself how many UTF-8 bytes were cut and where the whole text is.

/** A string shorter than this is never cut (its marker would cost about as much). */
const CUT_MIN_BYTES = 200;
const bytesOf = (s) => Buffer.byteLength(String(s), "utf8");

/** The first `keep` bytes of `s`, ending on a whole character. */
function prefixOf(s, keep) {
  if (keep <= 0) return "";
  const out = Buffer.from(s, "utf8").subarray(0, keep).toString("utf8");
  return out.endsWith("�") ? out.slice(0, -1) : out;
}

/** The marker a cut field ends with: the exact bytes cut, and where the whole text lives (or that no existing read holds it). */
export const cutMarker = (cutBytes, source) => ` […cut ${cutBytes} bytes; ${source ? `the whole text: ${source}` : "no existing read holds this field whole"}]`;

/** Every string in `value`, as `{ path, value }` (paths are dotted keys and array indices). */
function stringLeaves(value, path = []) {
  if (typeof value === "string") return [{ path, value }];
  if (Array.isArray(value)) return value.flatMap((v, i) => stringLeaves(v, [...path, String(i)]));
  if (value && typeof value === "object") return Object.entries(value).flatMap(([k, v]) => stringLeaves(v, [...path, k]));
  return [];
}
const setAt = (root, path, v) => { let o = root; for (const k of path.slice(0, -1)) o = o[k]; o[path.at(-1)] = v; };

/**
 * `row` made to fit: `build(row)` is the whole answer carrying it. Returns `{ answer, cuts }`, `cuts` being
 * `[{ path, cut_bytes, source }]` for the report; `answer` is ≤ cap unless the row holds no string long enough to cut.
 * `sourceOf(path, row)` is the read or source that holds that field whole, or null.
 */
export function cutToCap(row, build, { cap = CAP_BYTES, sourceOf = () => null } = {}) {
  const cur = structuredClone(row);
  const cuts = new Map();
  for (let i = 0; i < 200; i++) {
    const answer = build(cur);
    const over = textBytes(answer) - cap;
    if (over <= 0) return { answer, cuts: [...cuts.values()] };
    const leaf = stringLeaves(cur).filter((l) => bytesOf(l.value) > CUT_MIN_BYTES).sort((a, b) => bytesOf(b.value) - bytesOf(a.value))[0];
    if (!leaf) return { answer, cuts: [...cuts.values()] };
    const key = leaf.path.join(".");
    const was = cuts.get(key);
    // the original text, whole, so the count is of the field and not of its last cut
    const original = was ? was.original : leaf.value;
    const source = sourceOf(leaf.path, row);
    const now = was ? was.kept : original;
    const keep = Math.max(0, bytesOf(now) - over - bytesOf(cutMarker(bytesOf(original), source)) - 8);
    const kept = prefixOf(original, Math.min(keep, bytesOf(now)));
    const cutBytes = bytesOf(original) - bytesOf(kept);
    setAt(cur, leaf.path, kept + cutMarker(cutBytes, source));
    cuts.set(key, { path: key, cut_bytes: cutBytes, source, original, kept });
  }
  return { answer: build(cur), cuts: [...cuts.values()] };
}

/**
 * The largest page of `rows` from `start` whose whole answer fits `budget`.
 * `build(pageRows, next)` is the read's answer for those rows: `next` is the cursor of the first row not on it, or null.
 * `sourceOf(path, row)` names where a row's long field lives whole, for a row that has to be cut.
 * Returns `{ answer, taken, next }`.
 */
export function fitRows(rows, start, build, { budget = PAGE_BYTES, sourceOf } = {}) {
  const avail = rows.slice(start);
  const nextOf = (n) => (start + n < rows.length ? String(start + n) : null);
  const at = (n) => build(avail.slice(0, n), nextOf(n));
  if (!avail.length) return { answer: at(0), taken: 0, next: null };
  let lo = 0, hi = avail.length; // the most rows that fit: lo fits (or is 0), hi is the most there are
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (textBytes(at(mid)) <= budget) lo = mid; else hi = mid - 1;
  }
  if (lo >= 1) return { answer: at(lo), taken: lo, next: nextOf(lo) };
  // not even one row fits the page target: it goes out whole if it fits the cap (never cut merely to reach 9,000), else cut to the cap
  const whole = at(1);
  if (textBytes(whole) <= CAP_BYTES) return { answer: whole, taken: 1, next: nextOf(1) };
  const { answer } = cutToCap(avail[0], (r) => build([r], nextOf(1)), { sourceOf });
  return { answer, taken: 1, next: nextOf(1) };
}

/** The read that holds a mark's body whole: the world's bare mark focus (world-apex.mjs, `world { mark: "<id>" }`). */
export const markSource = (id) => (id ? `world { mark: ${JSON.stringify(String(id))} }` : null);

const call = (read, args) => `household { read: "${read}"${args ? `, args: { ${args} }` : ""} }`;

// ── stances ─────────────────────────────────────────────────────────────────

/** The parts of a stances answer that are lists a page can walk, each with its answer key. */
export const STANCE_PARTS = Object.freeze({
  set_downs: (a) => a.set_downs_awaiting ?? [],
  // `awaiting_your_word` holds every word the house owes (set-downs too); the takes are the ones needs-you's `takes_awaiting` names
  takes: (a) => (a.awaiting_your_word ?? []).filter((r) => r.act === "take"),
  standing: (a) => a.standing ?? [],
  ground: (a) => a.ground ?? [],
});
/** The keys that ride every page of a stances answer today and are the read's context, not its rows. */
const CONTEXT_KEYS = ["standing", "ground", "law", "teach", "set_downs_awaiting", "awaiting_your_word", "set_downs_unavailable"];

/**
 * `household { read: "stances" }` as pages. The answer is `stancesForHandles`' own.
 *  - no `part`, and the answer fits the connector (≤ CAP_BYTES): returned as it was, byte for byte;
 *  - no `part`, and it does not: the marks page that fits, the read's context counted and named instead of carried
 *    (`context`), each context list readable by its `part`;
 *  - `part`: one context list, paged by size with its own cursor (set_downs, takes, standing, ground), or `teach`.
 * `args` are the read's own fields (cursor, limit, by, over, part).
 */
export function pageStances(answer, args = {}) {
  if (!answer || answer.unavailable || !Array.isArray(answer.awaiting)) return answer;
  const part = args.part == null || args.part === "" ? null : String(args.part);
  if (part == null) {
    if (textBytes(answer) <= CAP_BYTES) return answer;
    return marksPage(answer, startOf(args.cursor));
  }
  if (part === "teach") return teachPage(answer);
  const listOf = STANCE_PARTS[part];
  if (!listOf) return { error: "bounce", code: 422, defect: `part: "${part}" is not a part of the stances read`, hint: `part is one of ${Object.keys(STANCE_PARTS).join(" | ")} | teach; omit it for the marks` };
  const rows = listOf(answer);
  const unavailable = part === "set_downs" || part === "takes" ? answer.set_downs_unavailable : null;
  const { answer: out } = fitRows(rows, startOf(args.cursor), (page, next) => ({
    read: "stances", part, total: rows.length, shown: page.length, offset: startOf(args.cursor),
    ...(unavailable ? { unavailable } : {}), rows: page, cursor: next, complete: next == null,
  }));
  return out;
}

/**
 * The teaching block, whole when it fits the cap, else its longest strings cut with the marker (never paged: it is one block).
 * Where each string lives whole: the response-function file named in `teach.from` (the strings quoted from it), and the law mark
 * `teach.after_it_is_published.law_mark` (`the_law_reaches`). `unruled` is composed from both. A string with no such source says so.
 */
function teachPage(answer) {
  const teach = answer.teach ?? {};
  const law = teach.after_it_is_published?.law_mark ?? teach.law_mark ?? null;
  const file = typeof teach.from === "string" && teach.from ? `${teach.from} in the world checkout` : null;
  const lawRead = markSource(law);
  const sourceOf = (path) => {
    const p = path.join(".");
    if (["what_opposed_does", "until_you_speak", "any_latency"].includes(p)) return file;
    if (p === "after_it_is_published.the_law_reaches") return lawRead;
    if (p.startsWith("after_it_is_published.unruled")) return [file, lawRead].filter(Boolean).join(" and ") || null;
    return null;
  };
  const build = (t) => ({ read: "stances", part: "teach", law: answer.law, teach: t });
  const whole = build(teach);
  if (textBytes(whole) <= CAP_BYTES) return whole;
  return cutToCap(teach, build, { sourceOf }).answer;
}

/** Where a stance row's long field lives whole: its mark's body is the world's bare mark focus. */
const stanceSource = (path, row) => (path.join(".") === "body" ? markSource(row?.mark) : null);

function marksPage(answer, start) {
  const { awaiting, cursor: _c, complete: _k, ids: _i, ...rest } = answer;
  const lean = Object.fromEntries(Object.entries(rest).filter(([k]) => !CONTEXT_KEYS.includes(k)));
  const narrowed = answer.only != null;
  // the upstream page is `awaiting`, from `start` of the (narrowed) inbox; its own cursor says whether the inbox goes on past it
  const upstreamNext = answer.cursor;
  const context = {
    note: "this answer is paged to fit the connector: its context is counted here and read by part",
    ...Object.fromEntries(Object.entries(STANCE_PARTS).map(([part, listOf]) => [part, { total: listOf(answer).length, read: call("stances", `part: "${part}"`) }])),
    teach: { read: call("stances", 'part: "teach"') },
    ...(answer.set_downs_unavailable ? { unavailable: answer.set_downs_unavailable } : {}),
  };
  const { answer: out } = fitRows(awaiting, 0, (page, next) => ({
    ...lean,
    ...(narrowed ? { ids: page.map((c) => c.mark) } : {}),
    awaiting: page,
    cursor: next != null ? String(start + page.length) : upstreamNext,
    complete: next == null && answer.complete,
    context,
  }), { sourceOf: stanceSource });
  return out;
}

// ── needs-you ───────────────────────────────────────────────────────────────

/** The parts of a needs-you answer a page can walk: the part name is the answer's own key. */
export const NEEDS_PARTS = Object.freeze({
  set_downs_awaiting: (a) => a.set_downs_awaiting?.rows, takes_awaiting: (a) => a.takes_awaiting?.rows,
  unplaced_bounces: (a) => a.unplaced_bounces?.rows, key_asks: (a) => a.key_asks?.rows,
  likeness_question: (a) => a.likeness_question?.rows, stakes_at_risk: (a) => a.stakes_at_risk?.rows, alerts: (a) => a.alerts,
});

/**
 * `household { read: "needs-you" }` as pages. The answer is `needsYou`'s own.
 *  - no `part`, and it fits the connector (≤ CAP_BYTES): returned as it was, byte for byte;
 *  - no `part`, and it does not: every part counted (its total, its unavailable word) and the call that pages it;
 *  - `part`: that part's rows, whole as needs-you gives them, paged by size, with its own cursor.
 */
export function pageNeeds(answer, args = {}) {
  if (!answer || answer.refused) return answer;
  const part = args.part == null || args.part === "" ? null : String(args.part);
  if (part == null) {
    if (textBytes(answer) <= CAP_BYTES) return answer;
    return needsSkeleton(answer);
  }
  const rows = NEEDS_PARTS[part]?.(answer);
  if (!NEEDS_PARTS[part]) return { error: "bounce", code: 422, defect: `part: "${part}" is not a part of the needs-you read`, hint: `part is one of ${Object.keys(NEEDS_PARTS).join(" | ")}` };
  const was = answer[part];
  const extras = {
    ...(was && !Array.isArray(was) && was.unavailable ? { unavailable: was.unavailable } : {}),
    ...(part === "stakes_at_risk" ? { next_settlement: was?.next_settlement ?? null } : {}),
    ...(part === "alerts" && answer.alerts_unread?.length ? { alerts_unread: answer.alerts_unread } : {}),
  };
  const list = rows ?? [];
  const start = startOf(args.cursor);
  const { answer: out } = fitRows(list, start, (page, next) => ({
    read: "needs-you", household: answer.household, part, total: list.length, shown: page.length, offset: start,
    ...extras, rows: page, cursor: next, complete: next == null,
  }), { sourceOf: needsSource(part) });
  return out;
}

/**
 * Where a needs-you row's long field lives whole, by part. A mark's body is the world's bare mark focus. An alert's `about.body` is
 * the mark's body too, except for escrow-on-missing-mark, whose mark is not in the world or the store (alerts.mjs): no existing read
 * holds that body whole, and it is said so. Fields the office composes itself (a message, a reason) have no other copy.
 */
function needsSource(part) {
  return (path, row) => {
    const p = path.join(".");
    if (part === "alerts" && p === "about.body") return row?.kind === "escrow-on-missing-mark" ? null : markSource(row?.about?.mark);
    if (part === "stakes_at_risk" && p === "body") return markSource(row?.mark);
    return null;
  };
}

function needsSkeleton(a) {
  const part = (k) => {
    const was = a[k];
    const rows = NEEDS_PARTS[k]?.(a) ?? [];
    return { total: rows.length, ...(was && !Array.isArray(was) && was.unavailable ? { unavailable: was.unavailable } : {}),
      ...(rows.length ? { read: call("needs-you", `part: "${k}"`) } : {}) };
  };
  return {
    read: a.read, household: a.household, residents: a.residents, as_of: a.as_of, count: a.count,
    paged: "this answer would not fit the connector, so each part is counted here and read by part, a page at a time (cursor)",
    stances_awaiting: { total: a.stances_awaiting?.total ?? 0, shown: a.stances_awaiting?.shown ?? 0,
      ...(a.stances_awaiting?.unavailable ? { unavailable: a.stances_awaiting.unavailable } : {}),
      ...((a.stances_awaiting?.total ?? 0) ? { read: call("stances", "limit: 100") } : {}) },
    ...Object.fromEntries(Object.keys(NEEDS_PARTS).filter((k) => k !== "takes_awaiting" || a.takes_awaiting).map((k) => [k, part(k)])),
    ...(a.alerts_unread ? { alerts_unread: a.alerts_unread } : {}),
    ...(a.note ? { note: a.note } : {}),
  };
}
