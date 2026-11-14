// household-waiting-budget.mjs — CORE-88: the waiting read fits the connector, and what waits stays findable.
//
// THE MEASUREMENT (CORE-84, the founder household): household { read: "waiting" } answered 70,691 UTF-8 bytes of MCP
// text, and the client refused it. The agreed cap is 10,000 bytes (Wright, 2026-11-14: "Give the household waiting read a
// budget under the 10,000-byte connector cap and fold the rest into stubs with counts and the read that opens each group
// … Nothing waiting may be lost.").
//
// WHAT THIS IS. A bounded PRESENTATION of the answer householdWaiting already composes, never a different definition of
// who or what waits. An answer that already fits is returned as it was, byte for byte. One that does not is folded, and
// says so (`folded`):
//
//   non-mark parts  (set-downs, takes, key asks, at-risk marks, alerts, bounces, the likeness question): each row rides as
//                   an IDENTITY ROW, bodyless, so every item is named whatever its body weighs, with what acting on it
//                   takes. A part with rows not shown says how many, and names the call that pages them.
//   mark groups     whole (sample and all), then a STUB (counts, ids, act, the read that opens it, no body), then one
//                   line, then a count; the groups not named are reached by walking `stances`.
//
// EVERY CALL NAMED HERE PAGES BY SIZE (household-read-page.mjs): `stances` (marks, and its set_downs and takes parts),
// `needs-you` (its parts). Each page of them fits PAGE_BYTES whole, with a cursor; that is what makes the stub a recovery
// and not a pointer. A body is never cut: a sample that does not fit is folded whole.
//
// THE BUDGET. WAITING_BUDGET_BYTES is measured on the text the connector delivers: JSON.stringify(answer, null, 1), as
// mcp.mjs § contentFor writes it, in UTF-8 bytes. test/household-waiting-budget.test.mjs pins that this measure IS contentFor's.

import { textBytes } from "./household-read-page.mjs";

/** The delivered MCP text this read may take, in UTF-8 bytes. The connector's cap is 10,000; the rest is headroom for a field the door adds. */
export const WAITING_BUDGET_BYTES = 9000;
/** The connector's cap, for the test and the folded answer's own account. */
export const CONNECTOR_CAP_BYTES = 10000;
/** How much of the budget identity rows may take before the marks are placed (the rest is for the groups). */
export const ROWS_SHARE = 0.75;

/** The text the connector delivers for an answer (mcp.mjs § contentFor), in UTF-8 bytes. */
export const deliveredBytes = textBytes;
const bytes = (s) => Buffer.byteLength(String(s ?? ""), "utf8");

const pick = (row, keys) => Object.fromEntries(keys.filter((k) => row?.[k] !== undefined).map((k) => [k, row[k]]));

/** The call that pages a part from `cursor` (the rows already shown). */
const stancesPart = (part) => (cursor) => `household { read: "stances", args: { part: "${part}", cursor: "${cursor}" } }`;
const needsPart = (part) => (cursor) => `household { read: "needs-you", args: { part: "${part}", cursor: "${cursor}" } }`;

/** The non-mark parts, in the order they claim the budget; `identity` is the bodyless row. */
const PARTS = [
  { key: "alerts", rows: (a) => a.alerts, flat: true, call: needsPart("alerts"),
    identity: (r) => ({ ...pick(r, ["kind", "severity"]), about: r.about ? { mark: r.about.mark } : null, ...pick(r, ["message", "act", "since", "until"]) }) },
  { key: "key_asks", rows: (a) => a.key_asks?.rows, call: needsPart("key_asks"), identity: (r) => pick(r, ["handle", "asks_standing"]) },
  { key: "stakes_at_risk", rows: (a) => a.stakes_at_risk?.rows, call: needsPart("stakes_at_risk"), identity: (r) => pick(r, ["mark", "class", "escrow", "at_risk", "act"]) },
  { key: "set_downs_awaiting", rows: (a) => a.set_downs_awaiting?.rows, call: stancesPart("set_downs"), identity: (r) => pick(r, ["thing", "made_by", "owner", "set_down_by", "at", "act_id", "answer"]) },
  { key: "takes_awaiting", rows: (a) => a.takes_awaiting?.rows, optional: true, call: stancesPart("takes"), identity: (r) => pick(r, ["thing", "made_by", "owner", "act", "by", "act_id", "answer"]) },
  { key: "unplaced_bounces", rows: (a) => a.unplaced_bounces?.rows, call: needsPart("unplaced_bounces"), identity: (r) => pick(r, ["handle", "date", "path", "reason"]) },
  { key: "likeness_question", rows: (a) => a.likeness_question?.rows, call: needsPart("likeness_question"), identity: (r) => pick(r, ["household", "residents", "link"]) },
];

const OPEN = 'household { read: "stances", args: { by, over, limit: 100 } }';
const WALK = 'household { read: "stances", args: { limit: 100 } }';

/**
 * Fold a composed waiting answer to the budget. `answer` is householdWaiting's:
 * needs-you's answer with `read: "waiting"` and `groups` (needGroups, none cut).
 */
export function foldWaiting(answer, { budget = WAITING_BUDGET_BYTES } = {}) {
  const fullBytes = deliveredBytes(answer);
  if (fullBytes <= budget) return answer;

  const groups = answer.groups ?? [];
  const stanceTotal = answer.stances_awaiting?.total ?? 0;
  const pageMarks = answer.stances_awaiting?.shown ?? 0;

  const openOf = (g) => `household { read: "stances", args: { by: ${JSON.stringify(g.by)}, over: ${JSON.stringify(g.over)}, limit: 100 } }`;
  const stub = (g) => {
    const { sample, ...rest } = g;
    return { ...rest, sample_folded: `${bytes(sample)} bytes of body not shown`, open: openOf(g) };
  };
  const line = (g) => ({ by: g.by, over: g.over, count: g.count });

  // 0 = counted only, 1 = a line, 2 = a stub, 3 = whole
  const tier = groups.map(() => 0);
  const parts = PARTS.map((p) => ({ ...p, all: p.rows(answer) ?? [], rows: 0 }));

  const build = () => {
    const out = {
      read: answer.read, household: answer.household, residents: answer.residents, as_of: answer.as_of,
      count: answer.count,
      folded: {
        budget_bytes: budget, cap_bytes: CONNECTOR_CAP_BYTES, full_bytes: fullBytes,
        note: "folded to fit the connector; nothing waiting is dropped. Each part says its total and how many identity rows ride (named, with what acting on them takes, and no body); the rest is read by the call the part names, a page at a time (each page fits, and carries its cursor). count is the whole house's.",
      },
    };
    out.stances_awaiting = {
      total: stanceTotal, shown: pageMarks,
      in_groups: "the marks read are grouped below by author and place; a group not named is counted in groups_more",
      ...(answer.stances_awaiting?.more ? { more: answer.stances_awaiting.more } : {}),
      ...(answer.stances_awaiting?.unavailable ? { unavailable: answer.stances_awaiting.unavailable } : {}),
    };
    out.groups = groups.flatMap((g, i) => (tier[i] === 3 ? [g] : tier[i] === 2 ? [stub(g)] : []));
    const listed = groups.flatMap((g, i) => (tier[i] === 1 ? [line(g)] : []));
    const left = groups.flatMap((g, i) => (tier[i] === 0 ? [g] : []));
    if (listed.length || left.length) {
      out.groups_more = {
        groups: listed.length + left.length, marks: [...listed, ...left].reduce((n, g) => n + g.count, 0),
        ...(listed.length ? { listed } : {}),
        ...(left.length ? { unlisted: {
          groups: left.length, marks: left.reduce((n, g) => n + g.count, 0),
          note: "not named here: each is one author's marks over one place of yours, listed by the walk below",
        } } : {}),
        open: `${OPEN} lists one group's marks; ${WALK} walks every mark in inbox order. Both come in pages that fit the connector: follow the cursor each hands back`,
      };
    }
    if (answer.groups_note) out.groups_note = answer.groups_note;
    for (const p of parts) {
      const was = answer[p.key];
      const shown = p.all.slice(0, p.rows).map(p.identity);
      const cut = p.all.length - shown.length;
      const body = {
        total: p.all.length, shown: shown.length,
        ...(p.key === "stakes_at_risk" && was?.next_settlement !== undefined ? { next_settlement: was.next_settlement } : {}),
        ...(was?.unavailable ? { unavailable: was.unavailable } : {}),
        ...(cut ? { rows_not_shown: cut, read: p.call(shown.length) } : {}),
        rows: shown,
      };
      if (p.flat) { if (p.all.length) out[p.key] = body; }
      else if (!p.optional || p.all.length) out[p.key] = body;
    }
    if (answer.alerts_unread) out.alerts_unread = answer.alerts_unread;
    if (answer.note) out.note = answer.note;
    return out;
  };

  const fits = (limit = budget) => deliveredBytes(build()) <= limit;
  // identity rows, one part at a time in turn (a row each, then a second row each, …), so no kind of waiting is named after another has taken the room
  const grow = (limit) => {
    for (let more = true; more;) {
      more = false;
      for (const p of parts) {
        if (p.rows >= p.all.length) continue;
        p.rows += 1;
        if (fits(limit)) more = true; else p.rows -= 1;
      }
    }
  };
  // 1. identity rows, while they take no more than their share
  grow(budget * ROWS_SHARE);
  // 2. the marks, largest group first (needGroups' order): whole, else a stub, else a line
  groups.forEach((_, i) => {
    for (const t of [3, 2, 1]) { tier[i] = t; if (fits()) return; }
    tier[i] = 0;
  });
  // 3. what room is left, to the rows the share held back
  grow(budget);
  return build();
}
