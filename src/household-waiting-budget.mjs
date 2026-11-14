// household-waiting-budget.mjs — CORE-88: the waiting read fits the connector, and what waits stays findable.
//
// THE MEASUREMENT (CORE-84, the founder household): household { read: "waiting" }
// answered 70,691 UTF-8 bytes of MCP text, and the client refused it. The agreed
// cap is 10,000 bytes (Wright, 2026-11-14: "Give the household waiting read a
// budget under the 10,000-byte connector cap and fold the rest into stubs with
// counts and the read that opens each group … Nothing waiting may be lost.").
//
// WHAT THIS IS. A bounded PRESENTATION of the answer householdWaiting already
// composes, never a different definition of who or what waits. An answer that
// already fits is returned as it was, byte for byte. One that does not is
// folded, and says so (`folded`):
//
//   non-mark parts  (set-downs, takes, key asks, at-risk marks, alerts, bounces,
//                   the likeness question): each row rides as an IDENTITY ROW,
//                   bodyless (the mark's body, a cause that is constant text),
//                   so every item is named whatever its body weighs, with what
//                   acting on it takes. A body rides the read of its own part.
//   mark groups     whole (sample and all), then a STUB (counts, ids, act, the
//                   read that opens it, no body), then one line, then a count.
//
// A body is never cut: a sample that does not fit is folded whole. A row past
// the budget is counted, with the existing read that lists it and what that
// read costs, said plainly where it is not bounded.
//
// WHAT A RECOVERY READ COSTS. `stances` carries every body of the marks it
// lists, so a group's `open` and the walk name a `limit` taken from the page's
// own bodies (GROUP_PAGE_BYTES of them). `stances` also carries its teaching
// block and the stances already spoken, which this fold cannot size: said so.
//
// THE BUDGET. WAITING_BUDGET_BYTES is measured on the text the connector
// delivers: JSON.stringify(answer, null, 1), as mcp.mjs § contentFor writes it,
// in UTF-8 bytes (a character is up to four). test/household-waiting-budget.test.mjs
// pins that this measure IS contentFor's.

import { STANCE_WORDS } from "./household-read-v2.mjs";

/** The delivered MCP text this read may take, in UTF-8 bytes. The connector's cap is 10,000; the rest is headroom for a field the door adds. */
export const WAITING_BUDGET_BYTES = 9000;
/** The connector's cap, for the test and the folded answer's own account. */
export const CONNECTOR_CAP_BYTES = 10000;
/** How much of the budget identity rows may take before the marks are placed (the rest is for the groups). */
export const ROWS_SHARE = 0.75;
/** The bodies one recovery page of `stances` is sized to carry, in UTF-8 bytes (its teaching block and spoken stances come on top). */
export const GROUP_PAGE_BYTES = 4000;

/** The text the connector delivers for an answer (mcp.mjs § contentFor), in UTF-8 bytes. */
export const deliveredBytes = (answer) => Buffer.byteLength(JSON.stringify(answer, null, 1), "utf8");
const bytes = (s) => Buffer.byteLength(String(s ?? ""), "utf8");

const pick = (row, keys) => Object.fromEntries(keys.filter((k) => row?.[k] !== undefined).map((k) => [k, row[k]]));

const NEEDS_YOU = { read: 'household { read: "needs-you" }', cost: "unbudgeted: its rows ride whole, bodies and all, so it can exceed the connector's cap on a big house" };
const STANCES_SETDOWNS = { read: 'household { read: "stances", args: { limit: 1 } }', cost: "every set-down and take rides whole on it beside one mark; it also carries a teaching block and the stances already spoken, which the connector's cap may not hold" };
const MAIL = { read: 'household { read: "mail", args: { view: "awaiting", handle: "<resident>" } }', cost: "one resident's mail, paged" };
const NO_STAKES_READ = { read: null, cost: 'no bounded read lists the at-risk marks past these: household { read: "stakes" } lists every published mark, at-risk first, bodies whole (unbudgeted), and its limit: answers the newest rows, not the at-risk ones' };

/** The non-mark parts, in the order they claim the budget; `identity` is the bodyless row. */
const PARTS = [
  { key: "alerts", rows: (a) => a.alerts, flat: true, ...NEEDS_YOU,
    identity: (r) => ({ ...pick(r, ["kind", "severity"]), about: r.about ? { mark: r.about.mark } : null, ...pick(r, ["message", "act", "since", "until"]) }) },
  { key: "key_asks", rows: (a) => a.key_asks?.rows, ...NEEDS_YOU, identity: (r) => pick(r, ["handle", "asks_standing"]) },
  { key: "stakes_at_risk", rows: (a) => a.stakes_at_risk?.rows, ...NO_STAKES_READ, identity: (r) => pick(r, ["mark", "class", "escrow", "at_risk", "act"]) },
  { key: "set_downs_awaiting", rows: (a) => a.set_downs_awaiting?.rows, ...STANCES_SETDOWNS, identity: (r) => pick(r, ["thing", "made_by", "owner", "set_down_by", "at", "act_id", "answer"]) },
  { key: "takes_awaiting", rows: (a) => a.takes_awaiting?.rows, optional: true, ...STANCES_SETDOWNS, identity: (r) => pick(r, ["thing", "made_by", "owner", "act", "by", "act_id", "answer"]) },
  { key: "unplaced_bounces", rows: (a) => a.unplaced_bounces?.rows, ...MAIL, identity: (r) => pick(r, ["handle", "date", "path", "reason"]) },
  { key: "likeness_question", rows: (a) => a.likeness_question?.rows, ...NEEDS_YOU, identity: (r) => pick(r, ["household", "residents", "link"]) },
];

const cursorOf = (text) => /cursor: "([^"]*)"/.exec(String(text))?.[1] ?? "";

const byResident = (rows) => {
  const by = {};
  for (const r of rows) by[r.handle ?? "?"] = (by[r.handle ?? "?"] ?? 0) + 1;
  return by;
};

/**
 * Fold a composed waiting answer to the budget. `answer` is householdWaiting's:
 * needs-you's answer with `read: "waiting"` and `groups` (needGroups, none cut).
 * `marks` is the stance page those groups were drawn from (rows with their
 * bodies), used only to size the recovery reads.
 */
export function foldWaiting(answer, { budget = WAITING_BUDGET_BYTES, marks = [] } = {}) {
  const fullBytes = deliveredBytes(answer);
  if (fullBytes <= budget) return answer;

  const groups = answer.groups ?? [];
  const stanceTotal = answer.stances_awaiting?.total ?? 0;
  const pageMarks = answer.stances_awaiting?.shown ?? 0;

  // how many of a run of marks one `stances` page can carry: their bodies, GROUP_PAGE_BYTES at most, at least one
  const pageOf = (rows) => {
    let used = 0, n = 0;
    for (const r of rows) { used += bytes(r.body); if (n > 0 && used > GROUP_PAGE_BYTES) break; n += 1; if (n >= 100) break; }
    return Math.max(1, n);
  };
  const inGroup = (g) => marks.filter((m) => m.by === g.by && (m.on_your_ground ?? [])[0] === g.over);
  const walkLimit = pageOf(marks);
  const limits = groups.map((g) => pageOf(inGroup(g)));
  const open = (g, i) => `household { read: "stances", args: { by: ${JSON.stringify(g.by)}, over: ${JSON.stringify(g.over)}, limit: ${limits[i]} } }${limits[i] < g.count ? ` (${limits[i]} a page: cursor ${limits[i]}, ${2 * limits[i]}, …)` : ""}`;
  // the group's own act, its read bounded the same way (needGroups' groupAct names limit: 100)
  const actOf = (g, i) => (g.count <= g.ids.length ? g.act
    : `${open(g, i)}, then declare-stance-on { on: <ids>, stance: ${STANCE_WORDS} }`);
  const stub = (g, i) => {
    const { sample, ...rest } = g;
    return { ...rest, act: actOf(g, i), sample_folded: `${bytes(sample)} bytes of body not shown`, open: open(g, i) };
  };
  const whole = (g, i) => ({ ...g, act: actOf(g, i) });
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
        note: 'folded to fit the connector; nothing waiting is dropped. Each part says its total and how many identity rows ride (named, with what acting on them takes, and no body: a mark\'s body rides stances, an alert\'s rides needs-you); what is not here is counted with the read that lists it. count is the whole house\'s.',
      },
    };
    out.stances_awaiting = {
      total: stanceTotal, shown: pageMarks,
      in_groups: "the marks read are grouped below by author and place; a group not named is counted in groups_more",
      ...(answer.stances_awaiting?.more ? { more: `household { read: "stances", args: { cursor: ${JSON.stringify(cursorOf(answer.stances_awaiting.more))}, limit: ${walkLimit} } }` } : {}),
      ...(answer.stances_awaiting?.unavailable ? { unavailable: answer.stances_awaiting.unavailable } : {}),
    };
    out.groups = groups.flatMap((g, i) => (tier[i] === 3 ? [whole(g, i)] : tier[i] === 2 ? [stub(g, i)] : []));
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
        open: `household { read: "stances", args: { limit: ${walkLimit} } } walks every mark in inbox order, ${walkLimit} a page (cursor ${walkLimit}, ${2 * walkLimit}, …), bodies whole and beside its teaching block and your spoken stances, which the connector's cap may not hold; one group: args { by, over, limit }`,
      };
    }
    // the composer's scope sentence stands; its walk is bounded the way the others are
    if (answer.groups_note) out.groups_note = answer.groups_note.replace(/household \{ read: "stances", args: \{ cursor: ("[^"]*") \} \}/, `household { read: "stances", args: { cursor: $1, limit: ${walkLimit} } }`);
    for (const p of parts) {
      const was = answer[p.key];
      const shown = p.all.slice(0, p.rows).map(p.identity);
      const cut = p.all.length - shown.length;
      const body = {
        total: p.all.length, shown: shown.length,
        ...(p.key === "stakes_at_risk" && was?.next_settlement !== undefined ? { next_settlement: was.next_settlement } : {}),
        ...(was?.unavailable ? { unavailable: was.unavailable } : {}),
        ...(p.key === "unplaced_bounces" && cut ? { by_resident: byResident(p.all) } : {}),
        ...(cut ? { rows_not_shown: cut, read: p.read, read_cost: p.cost } : {}),
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
