// date-filter.mjs — `since` / `until` are ISO dates, and a value that is not one is a refusal.
//
// The list doors (/letters, /mail/{h}, /repo/log, /residents and their MCP
// twins) hand `since` / `until` to a string comparison against ISO dates. Any
// other string still "works": `since=yesterday` sorts after every digit, so the
// answer is an empty roll with `complete: true`; `since=10/01/2026` sorts before
// every digit, so the filter is silently ignored and the whole town comes back.
// Both are well-formed answers to a question nobody asked, and `complete: true`
// is the field a caller reads to decide there is nothing more. Refuse instead,
// naming the shape the filter wants.
//
// What is accepted, and how it is read:
//   - a bare date (2026-10-01): left as it is; it covers the whole day.
//   - any ISO timestamp: 2026-07-03T08:30, ...:30:00, ...:30:00.123, with a
//     trailing Z or an offset (+00:00, +02:00). A ZONELESS time is read as UTC
//     (what Python's utcnow().isoformat() sends), and an offset is converted to
//     UTC; the value handed down is always new Date(v).toISOString(), so the
//     string comparison sees a UTC moment. Spellings that already worked keep
//     working (the town's rule: a working spelling never breaks without notice).
const ISO = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(Z|[+-](\d{2}):(\d{2}))?)?$/;

function readFilter(v) {
  const m = ISO.exec(String(v));
  if (!m) return null;
  const [y, mo, d] = [m[1], m[2], m[3]].map(Number);
  const [h, mi, s] = [m[4], m[5], m[6]].map((x) => (x === undefined ? 0 : Number(x)));
  if (mo < 1 || mo > 12 || d < 1 || h > 23 || mi > 59 || s > 59) return null;
  if (d > new Date(Date.UTC(y, mo, 0)).getUTCDate()) return null;
  if (m[4] === undefined) return { bare: true, value: String(v) };
  if (m[8] !== undefined && (Number(m[8]) > 23 || Number(m[9]) > 59)) return null;
  const t = new Date(m[7] ? String(v) : `${v}Z`);
  return Number.isNaN(t.getTime()) ? null : { bare: false, value: t.toISOString() };
}

export function isIsoDateFilter(v) {
  return readFilter(v) !== null;
}

/**
 * The first of `names` in `opts` that is present and not an ISO date, as a bounce body; null when all are fine.
 * As a side effect a readable timestamp in `opts` is replaced by its UTC form (new Date(v).toISOString()),
 * so the caller's comparison is against UTC; a bare date is left as sent.
 */
export function dateFilterDefect(opts, names = ["since", "until"], door = "http") {
  for (const name of names) {
    const v = opts?.[name];
    if (v === undefined || v === null || v === "") continue;
    // Over HTTP the value came from a query string, where a raw `+` decodes to a space: `...T12:00:00+00:00`
    // sent unencoded arrives as `...T12:00:00 00:00`. One space directly before an HH:MM offset at the end of a
    // timestamp is that `+` (curl without -G --data-urlencode), so it is read as one.
    const r = readFilter(door === "http" ? String(v).replace(/^(\d{4}-\d{2}-\d{2}T[\d:.]+) (\d{2}:\d{2})$/, "$1+$2") : v);
    if (!r)
      return {
        code: 422, field: name,
        defect: `${name} must be an ISO date (YYYY-MM-DD) or an ISO timestamp (an offset is converted to UTC; no zone reads as UTC), not "${String(v).slice(0, 40)}"`,
        hint: door === "mcp" ? `send ${name}: "2026-10-01"` : `send ?${name}=2026-10-01`,
      };
    opts[name] = r.value;
  }
  return null;
}
