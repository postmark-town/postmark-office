// post-history.mjs — EVERY POST'S HISTORY, ONE READER (POS-547, generalized for POS-290).
//
// POS-547 gave the bug read its `history` (Darko, 2026-10-09: credit is the
// public record). This is that reader for every class: one acts query for the
// posts asked, kept to the acts that move a post's state, and one read of the
// signed stamp chain for what each post line paid. The rows are the class's
// own to shape, so each class keeps its mapper beside its law:
//
//   bug    bugs.mjs § bugHistoryOf     { stage, at, hand, credit, link, stamps_paid }
//   idea   ideas.mjs § ideaHistoryOf   { stage, at, hand, credit, link, note }
//                     § ideaAwardsOf   { label, to, stamps, hand, at, note, stamps_paid }
//   event, quest    § plainHistoryOf   { stage, at, hand }: posted, and closed
//
// ── THE CHAIN IS READ AS A DELTA ────────────────────────────────────────────
//
// What a post line paid is on the store's `stamp_lines` (066), the town's
// signed chain: `MINT → <who> · N · for: post:<id>/<stage or label>`. POS-547
// read it with `canonical LIKE '%· for: post:%'`, a scan of the whole chain on
// every uncached read (Wright's review of #462). The chain is append-only by
// construction, and every writer takes the `stamp_lines` advisory lock before
// it reads the head and inserts head + 1 (stamp-lines.mjs § lockStampLinesVia;
// the one INSERT is insertStampRowsVia), so no lower seq can commit after a
// higher one. So each process keeps what it has read — the seq it reached, that
// row's seal, and the post lines' payments — and a read asks only for the rows
// past it: a primary-key range, nothing more. A store whose row at the
// remembered seq is gone or carries another seal (a restore, a test store) is a
// different chain, and the memo starts again from the top. Each office process
// (the main one, each read worker) keeps its own.

import { ACT_POST, ACT_ADVANCE, ACT_CLOSE, ACT_HOST, ACT_CANCEL, EVENT_CLASS, STATE_ANNOUNCED, STATE_CANCELLED } from "./events.mjs";
import { BUG_CLASS, bugHistoryOf, stagePaidOf } from "./bugs.mjs";
import { IDEA_CLASS, ideaHistoryOf, ideaAwardsOf, awardPaidOf, ACT_AWARD } from "./ideas.mjs";
import { QUEST_CLASS, STATE_OPEN, STATE_CLOSED } from "./quests.mjs";

/** The text `unavailable` carries when the store holds no stamp chain to read. */
export const NO_CHAIN = "the store holds no stamp chain yet (stamp_lines), so every history row's stamps_paid is null";
// The post lines only: every stage and award line carries this, and nothing else does.
const POST_LINES_LIKE = "%· for: post:%";

/** A ledger line's payment on a post: `{ post, part, handle, n }` (part: a bug's stage or an award's label), or null. */
export function postLineOf(canonical) {
  const s = stagePaidOf(canonical);
  if (s) return { post: s.post, part: s.stage, handle: s.handle, n: s.n };
  const a = awardPaidOf(canonical);
  return a ? { post: a.post, part: a.label, handle: a.handle, n: a.n } : null;
}

// ── the chain, by delta ─────────────────────────────────────────────────────

let memo = { seq: 0, seal: null, paid: new Map() };
/** For a falsifier: forget what this process has read of the chain. */
export const resetChainMemo = () => { memo = { seq: 0, seal: null, paid: new Map() }; };

/**
 * What each post line on the chain paid, `{ paid: Map("<post>/<part>" → n),
 * unavailable }`, reading only the rows past the last read. A store with no
 * chain answers `paid: null` and says so.
 */
export async function postPaymentsVia(client) {
  const { rows: [table] } = await client.query("SELECT to_regclass('stamp_lines') IS NOT NULL AS ok");
  const { rows: [head] } = table?.ok
    ? await client.query("SELECT seq, seal FROM stamp_lines ORDER BY seq DESC LIMIT 1") : { rows: [] };
  if (!head) { resetChainMemo(); return { paid: null, unavailable: NO_CHAIN }; }
  const top = Number(head.seq);
  let base = memo;
  if (base.seq) {
    const { rows: [at] } = base.seq <= top
      ? await client.query("SELECT seal FROM stamp_lines WHERE seq = $1", [base.seq]) : { rows: [] };
    if (!at || at.seal !== base.seal) base = { seq: 0, seal: null, paid: new Map() };
  }
  if (top === base.seq) { memo = base; return { paid: base.paid, unavailable: null }; }
  const { rows } = await client.query(
    "SELECT seq, canonical FROM stamp_lines WHERE seq > $1 AND seq <= $2 AND canonical LIKE $3 ORDER BY seq",
    [base.seq, top, POST_LINES_LIKE]);
  const paid = new Map(base.paid);
  for (const r of rows) {
    const p = postLineOf(r.canonical);
    if (p) paid.set(`${p.post}/${p.part}`, p.n);
  }
  // Two reads in flight may race; the later chain wins, and the answer either
  // gives is a prefix of the chain, so neither is wrong.
  if (top >= memo.seq) memo = { seq: top, seal: head.seal, paid };
  return { paid, unavailable: null };
}

// ── the acts, and each class's rows ─────────────────────────────────────────

/** The acts that make each class's history rows. */
export const HISTORY_ACTIONS = Object.freeze({
  [BUG_CLASS]: Object.freeze([ACT_POST, ACT_ADVANCE]),
  [IDEA_CLASS]: Object.freeze([ACT_POST, ACT_ADVANCE, ACT_AWARD]),
  [EVENT_CLASS]: Object.freeze([ACT_HOST, ACT_POST, ACT_CANCEL, ACT_CLOSE]),
  [QUEST_CLASS]: Object.freeze([ACT_POST, ACT_CLOSE]),
});

const payloadOf = (a) => (typeof a.payload === "string" ? JSON.parse(a.payload) : (a.payload ?? {}));

/**
 * An event's or a quest's history, PURE: the post, and the close. `{ stage,
 * at, hand }`: the state each act left it in, and whose hand (the pen's
 * `hand` when a hand acted for the town, else the act's actor).
 */
export function plainHistoryOf(cls, acts) {
  const posted = cls === QUEST_CLASS ? STATE_OPEN : STATE_ANNOUNCED;
  const closed = cls === QUEST_CLASS ? STATE_CLOSED : STATE_CANCELLED;
  const out = new Map();
  for (const a of acts) {
    const isPost = a.action === ACT_POST || a.action === ACT_HOST;
    const isClose = a.action === ACT_CLOSE || a.action === ACT_CANCEL;
    if (!isPost && !isClose) continue;
    const p = payloadOf(a);
    const post = String(a.object);
    const row = { stage: isPost ? (p.state ?? posted) : (p.state ?? closed), at: new Date(a.at).toISOString(), hand: p.hand ?? a.actor ?? null };
    out.set(post, [...(out.get(post) ?? []), row]);
  }
  return out;
}

/**
 * The history of `cls`'s posts `ids`, on the caller's read: `{ byPost,
 * awardsByPost, unavailable }`. awardsByPost is the idea's; null for any other
 * class. A class this reader does not know answers no rows.
 */
export async function postHistoryVia(client, cls, ids) {
  const actions = HISTORY_ACTIONS[cls];
  if (!ids.length || !actions) return { byPost: new Map(), awardsByPost: cls === IDEA_CLASS ? new Map() : null, unavailable: null };
  const { rows: acts } = await client.query(
    "SELECT id, object, action, actor, at, payload FROM acts WHERE class = $1 AND object = ANY($2) AND action = ANY($3) ORDER BY id",
    [cls, ids, [...actions]]);
  // Only the classes that pay read the chain.
  const pays = cls === BUG_CLASS || cls === IDEA_CLASS;
  const { paid, unavailable } = pays ? await postPaymentsVia(client) : { paid: null, unavailable: null };
  if (cls === BUG_CLASS) return { byPost: bugHistoryOf(acts, paid ?? new Map()), awardsByPost: null, unavailable };
  if (cls === IDEA_CLASS) return { byPost: ideaHistoryOf(acts), awardsByPost: ideaAwardsOf(acts, paid), unavailable };
  return { byPost: plainHistoryOf(cls, acts), awardsByPost: null, unavailable: null };
}
