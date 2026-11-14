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

/** What one page's delivered text may take, in UTF-8 bytes. The connector's cap is 10,000. */
export const PAGE_BYTES = 9000;
/** The connector's cap, for the tests' and the answers' own account. */
export const CAP_BYTES = 10000;

/** The text the connector delivers for an answer, in UTF-8 bytes. */
export const textBytes = (answer) => Buffer.byteLength(JSON.stringify(answer, null, 1), "utf8");

/** A cursor is an index into a list, as a string (stances' own: world-stance.mjs § stanceShadow). Unreadable is the start. */
export const startOf = (cursor) => {
  const n = Number.parseInt(String(cursor ?? "0"), 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

const FOLD_OVER = 600;
/** A row that cannot fit a page alone: each string over 600 bytes is said, counted and left out, never cut. */
function foldRow(row) {
  if (!row || typeof row !== "object") return row;
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (typeof v === "string" && Buffer.byteLength(v, "utf8") > FOLD_OVER) out[`${k}_folded`] = `${Buffer.byteLength(v, "utf8")} bytes not shown`;
    else out[k] = v;
  }
  return out;
}

/**
 * The largest page of `rows` from `start` whose whole answer fits `budget`.
 * `build(pageRows, next)` is the read's answer for those rows: `next` is the cursor of the first row not on it, or null.
 * Returns `{ answer, taken, next }`.
 */
export function fitRows(rows, start, build, { budget = PAGE_BYTES } = {}) {
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
  // not even one row fits: the row, folded, alone
  const answer = build([foldRow(avail[0])], nextOf(1));
  return { answer, taken: 1, next: nextOf(1) };
}

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
 *  - no `part`, and the answer fits a page: returned as it was, byte for byte;
 *  - no `part`, and it does not: the marks page that fits, the read's context counted and named instead of carried
 *    (`context`), each context list readable by its `part`;
 *  - `part`: one context list, paged by size with its own cursor (set_downs, takes, standing, ground), or `teach`.
 * `args` are the read's own fields (cursor, limit, by, over, part).
 */
export function pageStances(answer, args = {}) {
  if (!answer || answer.unavailable || !Array.isArray(answer.awaiting)) return answer;
  const part = args.part == null || args.part === "" ? null : String(args.part);
  if (part == null) {
    if (textBytes(answer) <= PAGE_BYTES) return answer;
    return marksPage(answer, startOf(args.cursor));
  }
  if (part === "teach") return { read: "stances", part, law: answer.law, teach: answer.teach };
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
  }));
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
 *  - no `part`, and it fits a page: returned as it was, byte for byte;
 *  - no `part`, and it does not: every part counted (its total, its unavailable word) and the call that pages it;
 *  - `part`: that part's rows, whole as needs-you gives them, paged by size, with its own cursor.
 */
export function pageNeeds(answer, args = {}) {
  if (!answer || answer.refused) return answer;
  const part = args.part == null || args.part === "" ? null : String(args.part);
  if (part == null) {
    if (textBytes(answer) <= PAGE_BYTES) return answer;
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
  }));
  return out;
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
