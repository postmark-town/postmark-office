// hold-record.mjs — THE HOLD LANE'S RECORD, KEPT AND MOVED BY ITS DELTA
// (LOGOS v2, lane O2; review-610 S5, F1 and round 3).
//
// "Snapshot per settlement, compute only the delta" (POS-277's rule). A bare
// read asks who holds what — the units fold, the hold rows, where set-down
// things stand — and used to re-read and re-fold the hold lane's whole history
// each time. Here that history is folded into a BASE once per settlement, and
// each change after it is applied as a delta:
//
//   · ONE FULL READ PER SETTLEMENT. The base is re-built from the whole record
//     the first time a read lands in a new settlement window (`readEpoch`, the
//     crossing the office already counts by). Whatever any delta below could
//     ever miss is therefore missed for one settlement at most.
//   · the base is every act at or below `cutoff`, folded (counts are additive)
//     and compacted (attachments last-row-wins per thing, set-downs the latest
//     drop per thing);
//   · the WINDOW is every act above `cutoff`, re-read whole on each change, so
//     an act whose id was assigned before a neighbour's but committed after it
//     (acts.id is taken at INSERT, not at COMMIT) is still picked up the next
//     time the window is read;
//   · when the window grows past twice its width, its older half moves into the
//     base and `cutoff` advances. The width is in acts.id, and acts.id is the
//     WHOLE record's (every say and walk takes one), not the hold lane's: an act
//     still open when the cutoff passes it would be missed by the deltas — and is
//     picked up at the next settlement's full read (above). That is the bound.
//
// A change is applied whole or not at all: the kept record, and the top it
// answers for, move only after the new record composed (a failed read leaves
// the last good record standing, and the next read tries again). One rebuild at
// a time (single-flight): reads that arrive while a change is being applied
// share it. No table and no DDL: the base lives in the process, and a restart
// folds it once again. Every reader is injected, so the keeping itself is
// falsifiable without a store.
//
// ORDER. The readers return rows in their own ORDER BY — attachments by
// (born_at, era, id), holding rows by (acts.at, acts.id). The base/window split
// is by id (the only bound a delta read can push), so a row whose clock runs
// earlier than a base row's can sit above the cutoff. Attachments are merged
// back into the readers' order (`attachmentOrder`, born_at first) before
// last-row-wins, so such a row never outranks a later one. The units fold is
// additive and its order matters only to a refused move's anomaly note; a
// holding row (holdingRowOf) carries no time, so it is applied base-then-window.

import { foldUnits, isUnitRow } from "./world-stacks.mjs";
import { foldOwners, ownershipEvents } from "./ownership.mjs"; // POS-688: maker and owner, folded with the holds
import { foldMade } from "./named-making.mjs"; // POS-766: the things made straight into hands or a holder, by their make act

/** An act's id, from either reader's row: a holding row's `seq`, a live hold row's `act_id`; a frozen-era row has none (always base). */
const idOf = (r) => { const v = r?.act_id ?? r?.seq ?? r?.id; const n = v == null ? NaN : Number(v); return Number.isFinite(n) ? n : -Infinity; };

/** The attachment readers' order (guard-reads § ATTACHMENT_ORDER_SQL): born_at, the frozen era first, then the act's id. */
export const attachmentOrder = (a, b) => {
  const ta = Date.parse(a?.born_at ?? ""), tb = Date.parse(b?.born_at ?? "");
  if (ta !== tb) return (Number.isFinite(ta) ? ta : -Infinity) - (Number.isFinite(tb) ? tb : -Infinity);
  const la = a?.era === "legacy" || a?.act_id == null ? 0 : 1, lb = b?.era === "legacy" || b?.act_id == null ? 0 : 1;
  if (la !== lb) return la - lb;
  return (idOf(a) === idOf(b) ? 0 : idOf(a) < idOf(b) ? -1 : 1) || (Number(a?.seq ?? 0) - Number(b?.seq ?? 0));
};

/**
 * A keeper over four readers:
 *   readTop()                       → the hold lane's high-water act id, or null
 *   readEpoch()                     → the settlement window now (a crossing), or null
 *   readHolding({ afterId })        → holding rows (class holding), oldest first
 *   readAttachments({ afterId })    → hold rows (who holds what), in their order
 * `placesOf(drops)` turns `Map(thing → drop row)` into `Map(thing → {x, y})`.
 */
export function holdRecordKeeper({ readTop, readEpoch = async () => null, readHolding, readAttachments, placesOf = async () => new Map(), width = 500,
  // THE OWNER'S WORDS (POS-688): stance acts answering a take or set-down, and the household map the fold reads
  readWords = async () => [], houses = async () => (h) => h } = {}) {
  let state = null;
  let inflight = null;
  let rebuilds = 0, fullReads = 0;

  const compose = async (s) => {
    const fold = foldUnits(s.window.holding.filter(isUnitRow), s.baseFold);
    const owners = foldOwners(ownershipEvents(s.window.holding, s.window.words ?? []), { houseOf: s.houseOf, state: s.baseOwners });
    const attachments = [...s.baseAtt.values(), ...s.window.attachments].sort(attachmentOrder);
    const drops = new Map(s.baseDrops);
    for (const r of s.window.holding) if (r.action === "drop" && r.object != null) drops.set(String(r.object), r);
    const made = foldMade(s.window.holding, s.baseMade);
    return { top: s.top, epoch: s.epoch, cutoff: s.cutoff, fold, attachments, drops, places: await placesOf(drops), owners, made };
  };
  /** Fold rows into a base COPY: the kept base is never touched until the whole change has composed. */
  const intoBase = (s, holding, attachments, words = []) => {
    s.baseFold = foldUnits(holding.filter(isUnitRow), s.baseFold);
    s.baseOwners = foldOwners(ownershipEvents(holding, words), { houseOf: s.houseOf, state: s.baseOwners });
    s.baseAtt = new Map(s.baseAtt);
    for (const r of [...[...s.baseAtt.values()], ...attachments].sort(attachmentOrder)) s.baseAtt.set(String(r.target), r);
    s.baseDrops = new Map(s.baseDrops);
    for (const r of holding) if (r.action === "drop" && r.object != null) s.baseDrops.set(String(r.object), r);
    s.baseMade = foldMade(holding, s.baseMade);
  };

  async function apply(top, epoch) {
    rebuilds += 1;
    let next;
    if (!state || (epoch != null && state.epoch !== epoch)) {
      // THE SETTLEMENT'S FULL READ: the base re-built from the whole record
      fullReads += 1;
      const [holding, attachments, words, houseOf] = await Promise.all([readHolding({}), readAttachments({}), readWords({}), houses()]);
      const high = Math.max(top ?? -Infinity, ...holding.map(idOf), ...attachments.map(idOf));
      const cutoff = Number.isFinite(high) ? high - width : -Infinity;
      next = { top, epoch, cutoff, houseOf, baseFold: null, baseAtt: new Map(), baseDrops: new Map(), baseMade: new Map(), baseOwners: null, window: { holding: [], attachments: [], words: [] } };
      intoBase(next, holding.filter((r) => idOf(r) <= cutoff), attachments.filter((r) => idOf(r) <= cutoff), words.filter((r) => idOf(r) <= cutoff));
      next.window = { holding: holding.filter((r) => idOf(r) > cutoff), attachments: attachments.filter((r) => idOf(r) > cutoff), words: words.filter((r) => idOf(r) > cutoff) };
    } else {
      // THE DELTA: everything above the cutoff, re-read — late commits inside the window included
      const after = Number.isFinite(state.cutoff) ? state.cutoff : null;
      const [holding, attachments, words] = await Promise.all([readHolding({ afterId: after }), readAttachments({ afterId: after }), readWords({ afterId: after })]);
      next = { ...state, top, window: { holding, attachments, words } };
      const high = Math.max(top ?? -Infinity, ...holding.map(idOf), ...attachments.map(idOf));
      if (Number.isFinite(high) && high - (Number.isFinite(next.cutoff) ? next.cutoff : -Infinity) > 2 * width) {
        const cut = high - width;
        intoBase(next, holding.filter((r) => idOf(r) <= cut), attachments.filter((r) => idOf(r) <= cut), words.filter((r) => idOf(r) <= cut));
        next.cutoff = cut;
        next.window = { holding: holding.filter((r) => idOf(r) > cut), attachments: attachments.filter((r) => idOf(r) > cut), words: words.filter((r) => idOf(r) > cut) };
      }
    }
    // WHOLE OR NOT AT ALL: the kept state, its top included, moves only once the record composed
    const record = await compose(next);
    next.record = record;
    state = next;
    return record;
  }

  return {
    /** The record now: the kept one when the lane has not moved in this settlement, else the change applied — once, however many ask. */
    async now() {
      const [top, epoch] = await Promise.all([readTop(), readEpoch()]);
      if (state?.record && top != null && state.top === top && state.epoch === epoch) return state.record;
      if (!inflight) inflight = apply(top, epoch).finally(() => { inflight = null; });
      return inflight;
    },
    /** For a falsifier: how many changes were applied, how many were full reads, and where the base stands. */
    stats: () => ({ rebuilds, fullReads, cutoff: state?.cutoff ?? null, top: state?.top ?? null, epoch: state?.epoch ?? null }),
  };
}

// ── THE HIGH-WATER MARK, BY THE INDEX ───────────────────────────────────────
//
// Every hold act is `class = 'holding'` (holdingEntry; the units acts), and the
// frozen era's attachment events are `class = 'legacy'` (seed-import.mjs files
// them so). `acts_class_idx (class, id)` answers each max by one index step;
// the earlier `class = 'holding' OR action = ANY($1)` could not use it (no index
// on action) and walked acts backward by the primary key, filtering. Pinned by
// EXPLAIN in hold-record.test.mjs.
export const HOLD_TOP_SQL = `SELECT GREATEST((SELECT max(id) FROM acts WHERE class = 'holding'),
                                     (SELECT max(id) FROM acts WHERE class = 'legacy'))::text AS top`;

/** The keeper's high water: the hold acts', or a newer stance (an owner's word moves the record too, POS-688). */
export const KEEPER_TOP_SQL = `SELECT GREATEST((SELECT max(id) FROM acts WHERE class = 'holding'),
                                       (SELECT max(id) FROM acts WHERE class = 'legacy'),
                                       (SELECT max(id) FROM acts WHERE class = 'stance'))::text AS top`;

/** THE OWNER'S WORDS (POS-688): every stance answering a take or a set-down (`payload.act`), oldest first; `$1` the kept base's cutoff, or null. */
export const OWNER_WORDS_SQL = `SELECT id, at, actor, object, payload FROM acts
                                 WHERE class = 'stance' AND payload ? 'act' AND payload->>'answers' IN ('take', 'set-down')
                                   AND ($1::bigint IS NULL OR id > $1::bigint)
                                 ORDER BY id`;
