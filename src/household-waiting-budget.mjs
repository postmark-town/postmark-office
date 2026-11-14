// household-waiting-budget.mjs — CORE-88: the waiting read fits the connector,
// and nothing that waits is lost.
//
// THE MEASUREMENT (CORE-84, the founder household): household { read: "waiting" }
// answered 70,691 UTF-8 bytes of MCP text, and the client refused it. The agreed
// cap is 10,000 bytes (Wright, 2026-11-14: "Give the household waiting read a
// budget under the 10,000-byte connector cap and fold the rest into stubs with
// counts and the read that opens each group … Nothing waiting may be lost.").
//
// WHAT THIS IS. A bounded PRESENTATION of the answer householdWaiting already
// composes, never a different definition of who or what waits: the same needs-you
// parts and the same needGroups, folded when they do not fit. An answer that
// already fits is returned as it was, byte for byte, so a small house reads what
// it always read. A folded answer says so (`folded`), and every part is one of:
//   whole   its rows, bodies uncut;
//   counted its rows are not here, `total` says how many wait, `shown` how many
//           rows ride, and `read` is the existing read that lists the rest;
//   marks   each group of marks whole, then a stub (counts, ids, act, the read
//           that opens it, no body), then one compact line, then a count.
// A body is never cut: a row or sample that does not fit is folded whole.
//
// THE BUDGET. WAITING_BUDGET_BYTES is measured on the text the connector
// delivers: JSON.stringify(answer, null, 1), as mcp.mjs § contentFor writes it,
// in UTF-8 bytes (a character is up to four). test/household-waiting-budget.test.mjs
// pins that this measure IS contentFor's.

/** The delivered MCP text this read may take, in UTF-8 bytes. The connector's cap is 10,000; the rest is headroom for a field the door adds. */
export const WAITING_BUDGET_BYTES = 9000;
/** The connector's cap, for the test and the folded answer's own account. */
export const CONNECTOR_CAP_BYTES = 10000;
/** Rows of one non-mark part that ride before its rest is counted (the budget decides below this). */
export const PART_ROWS = 3;

/** The text the connector delivers for an answer (mcp.mjs § contentFor), in UTF-8 bytes. */
export const deliveredBytes = (answer) => Buffer.byteLength(JSON.stringify(answer, null, 1), "utf8");

// The read that opens each part, all existing reads (CORE-88: no new read).
const STANCES = 'household { read: "stances" }';
const NEEDS_YOU = 'household { read: "needs-you" }';
const STAKES = 'household { read: "stakes" }';
const MAIL_AWAITING = 'household { read: "mail", args: { view: "awaiting", handle: "<resident>" } }';
const OPEN_GROUP = 'household { read: "stances", args: { by, over, limit: 100 } }';
const WALK_MARKS = 'household { read: "stances", args: { limit: 100, cursor } }';

/** The parts of a needs-you answer that are rows, in the order they claim the budget. */
const PARTS = [
  { key: "set_downs_awaiting", rows: (a) => a.set_downs_awaiting?.rows, read: STANCES },
  { key: "takes_awaiting", rows: (a) => a.takes_awaiting?.rows, read: STANCES },
  { key: "key_asks", rows: (a) => a.key_asks?.rows, read: NEEDS_YOU },
  { key: "stakes_at_risk", rows: (a) => a.stakes_at_risk?.rows, read: STAKES },
  { key: "alerts", rows: (a) => a.alerts, read: NEEDS_YOU, flat: true },
  { key: "unplaced_bounces", rows: (a) => a.unplaced_bounces?.rows, read: MAIL_AWAITING },
  { key: "likeness_question", rows: (a) => a.likeness_question?.rows, read: NEEDS_YOU },
];

const openGroup = (g) => `household { read: "stances", args: { by: ${JSON.stringify(g.by)}, over: ${JSON.stringify(g.over)}, limit: 100 } }`;
const stub = (g) => {
  const { sample, ...rest } = g;
  return { ...rest, sample_folded: `${Buffer.byteLength(String(sample ?? ""), "utf8")} bytes of body not shown`, open: openGroup(g) };
};
const compact = (g) => ({ by: g.by, over: g.over, count: g.count });

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
  // 0 = counted only, 1 = a compact line, 2 = a stub, 3 = whole
  const tier = groups.map(() => 0);
  const parts = PARTS.map((p) => ({ ...p, all: p.rows(answer) ?? [], rows: 0 }));

  const build = () => {
    const out = {
      read: answer.read, household: answer.household, residents: answer.residents, as_of: answer.as_of,
      count: answer.count,
      folded: {
        budget_bytes: budget, cap_bytes: CONNECTOR_CAP_BYTES, full_bytes: fullBytes,
        note: "folded to fit the connector; nothing waiting is dropped. Each part says its total, how many rows ride (shown) and the read that lists the rest; a group stub names the read that opens it. count is the whole house's.",
      },
    };
    out.stances_awaiting = {
      total: stanceTotal, shown: pageMarks, in_groups: "the marks read are the groups below, grouped by author and place",
      ...(answer.stances_awaiting?.more ? { more: answer.stances_awaiting.more } : {}),
      ...(answer.stances_awaiting?.unavailable ? { unavailable: answer.stances_awaiting.unavailable } : {}),
    };
    out.groups = groups.flatMap((g, i) => (tier[i] === 3 ? [g] : tier[i] === 2 ? [stub(g)] : []));
    const listed = groups.flatMap((g, i) => (tier[i] === 1 ? [compact(g)] : []));
    const left = groups.flatMap((g, i) => (tier[i] === 0 ? [g] : []));
    if (listed.length || left.length) {
      out.groups_more = {
        groups: listed.length + left.length, marks: [...listed, ...left].reduce((n, g) => n + g.count, 0),
        ...(listed.length ? { listed } : {}),
        ...(left.length ? { unlisted: { groups: left.length, marks: left.reduce((n, g) => n + g.count, 0) } } : {}),
        open: `${OPEN_GROUP} lists one group's marks and their bodies; ${WALK_MARKS} walks every mark`,
      };
    }
    if (answer.groups_note) out.groups_note = answer.groups_note;
    for (const p of parts) {
      const was = answer[p.key];
      const shown = p.all.slice(0, p.rows);
      const body = {
        total: p.all.length, shown: shown.length,
        ...(p.key === "stakes_at_risk" && was?.next_settlement !== undefined ? { next_settlement: was.next_settlement } : {}),
        ...(was?.unavailable ? { unavailable: was.unavailable } : {}),
        ...(p.key === "unplaced_bounces" && p.all.length > shown.length ? { by_resident: byResident(p.all) } : {}),
        ...(p.all.length > shown.length ? { read: p.read, rows_folded: p.all.length - shown.length } : {}),
        rows: shown,
      };
      if (p.flat) { if (p.all.length) out[p.key] = body; }
      else if (p.key === "takes_awaiting" ? p.all.length : true) out[p.key] = body;
    }
    if (answer.alerts_unread) out.alerts_unread = answer.alerts_unread;
    if (answer.note) out.note = answer.note;
    return out;
  };

  const fits = () => deliveredBytes(build()) <= budget;
  // a part's first row each, so no kind of waiting is only a count while there is room
  for (const p of parts) if (p.all.length) { p.rows = 1; if (!fits()) p.rows = 0; }
  // the marks, largest group first (needGroups' order): whole, else a stub, else a line
  groups.forEach((_, i) => {
    for (const t of [3, 2, 1]) { tier[i] = t; if (fits()) return; }
    tier[i] = 0;
  });
  // what room is left, to each part's next rows
  for (const p of parts) while (p.rows < Math.min(p.all.length, PART_ROWS)) { p.rows += 1; if (!fits()) { p.rows -= 1; break; } }
  return build();
}

/** A bounce's resident, counted, so each count names the call that opens it. */
function byResident(rows) {
  const by = {};
  for (const r of rows) by[r.handle ?? "?"] = (by[r.handle ?? "?"] ?? 0) + 1;
  return by;
}
