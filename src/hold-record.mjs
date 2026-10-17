// hold-record.mjs — THE HOLD LANE'S RECORD, KEPT AND MOVED BY ITS DELTA
// (LOGOS v2, lane O2; review-610 S5 and F1).
//
// "Snapshot per settlement, compute only the delta" (POS-277's rule). A bare
// read asks who holds what — the units fold, the hold rows, where set-down
// things stand — and used to re-read and re-fold the hold lane's whole history
// each time. Here that history is folded once into a BASE, and each change
// after it is applied as a delta:
//
//   · the base is every act at or below `cutoff`, folded (counts are additive)
//     and compacted (attachments are last-row-wins per thing, set-downs are the
//     latest drop per thing);
//   · the WINDOW is every act above `cutoff`, re-read whole on each change, so
//     an act whose id was assigned before a neighbour's but committed after it
//     (acts.id is taken at INSERT, not at COMMIT) is still picked up the next
//     time the window is read;
//   · when the window grows past twice its width, its older half moves into
//     the base and `cutoff` advances — an act that late (thousands of hold acts
//     behind) is past any commit's lag.
//
// One rebuild at a time (single-flight): reads that arrive while a change is
// being applied share that application rather than each starting their own.
// No table and no DDL: the base lives in the process, and a restart folds it
// once again. Every reader is injected, so the keeping itself is falsifiable
// without a store.

import { foldUnits, isUnitRow } from "./world-stacks.mjs";

/** An act's id, from either reader's row: a holding row's `seq`, a live hold row's `act_id`; a frozen-era row has none (always base). */
const idOf = (r) => { const v = r?.act_id ?? r?.seq ?? r?.id; const n = v == null ? NaN : Number(v); return Number.isFinite(n) ? n : -Infinity; };

/**
 * A keeper over three readers:
 *   readTop()                       → the hold lane's high-water act id, or null
 *   readHolding({ afterId })        → holding rows (class holding), oldest first
 *   readAttachments({ afterId })    → hold rows (who holds what), in their order
 * `placesOf(drops)` turns `Map(thing → drop row)` into `Map(thing → {x, y})`.
 */
export function holdRecordKeeper({ readTop, readHolding, readAttachments, placesOf = async () => new Map(), width = 500 } = {}) {
  let state = null;
  let inflight = null;
  let rebuilds = 0;

  const compose = async (s) => {
    const fold = foldUnits(s.window.holding.filter(isUnitRow), s.baseFold);
    const attachments = [...s.baseAtt.values(), ...s.window.attachments];
    const drops = new Map(s.baseDrops);
    for (const r of s.window.holding) if (r.action === "drop" && r.object != null) drops.set(String(r.object), r);
    return { top: s.top, cutoff: s.cutoff, fold, attachments, places: await placesOf(drops) };
  };
  const intoBase = (s, holding, attachments) => {
    s.baseFold = foldUnits(holding.filter(isUnitRow), s.baseFold);
    for (const r of attachments) s.baseAtt.set(String(r.target), r);
    for (const r of holding) if (r.action === "drop" && r.object != null) s.baseDrops.set(String(r.object), r);
  };

  async function apply(top) {
    rebuilds += 1;
    if (!state) {
      const [holding, attachments] = await Promise.all([readHolding({}), readAttachments({})]);
      const high = Math.max(top ?? -Infinity, ...holding.map(idOf), ...attachments.map(idOf));
      const cutoff = Number.isFinite(high) ? high - width : -Infinity;
      state = { top, cutoff, baseFold: null, baseAtt: new Map(), baseDrops: new Map(), window: { holding: [], attachments: [] } };
      intoBase(state, holding.filter((r) => idOf(r) <= cutoff), attachments.filter((r) => idOf(r) <= cutoff));
      state.window = { holding: holding.filter((r) => idOf(r) > cutoff), attachments: attachments.filter((r) => idOf(r) > cutoff) };
    } else {
      // THE DELTA: everything above the cutoff, re-read — late commits inside the window included
      const after = Number.isFinite(state.cutoff) ? state.cutoff : null;
      const [holding, attachments] = await Promise.all([readHolding({ afterId: after }), readAttachments({ afterId: after })]);
      const next = { ...state, top, window: { holding, attachments } };
      const high = Math.max(top ?? -Infinity, ...holding.map(idOf), ...attachments.map(idOf));
      if (Number.isFinite(high) && high - (Number.isFinite(next.cutoff) ? next.cutoff : -Infinity) > 2 * width) {
        const cut = high - width;
        next.baseAtt = new Map(next.baseAtt);
        next.baseDrops = new Map(next.baseDrops);
        intoBase(next, holding.filter((r) => idOf(r) <= cut), attachments.filter((r) => idOf(r) <= cut));
        next.cutoff = cut;
        next.window = { holding: holding.filter((r) => idOf(r) > cut), attachments: attachments.filter((r) => idOf(r) > cut) };
      }
      state = next;
    }
    state.record = await compose(state);
    return state.record;
  }

  return {
    /** The record now: the kept one when the lane has not moved, else the delta applied — once, however many ask. */
    async now() {
      const top = await readTop();
      if (state?.record && top != null && state.top === top) return state.record;
      if (!inflight) inflight = apply(top).finally(() => { inflight = null; });
      return inflight;
    },
    /** For a falsifier: how many times a change was applied, and the cutoff the base stands at. */
    stats: () => ({ rebuilds, cutoff: state?.cutoff ?? null, top: state?.top ?? null }),
  };
}

// ── THE HIGH-WATER MARK, BY THE INDEX ───────────────────────────────────────
//
// Every hold act is `class = 'holding'` (holdingEntry; the units acts), and the
// frozen era's attachment events are `class = 'legacy'` (seed-import.mjs files
// them so). `acts_class_idx (class, id)` answers each max by one index step;
// the earlier `class = 'holding' OR action = ANY($1)` could not use it (no index
// on action) and scanned acts. Pinned by EXPLAIN in hold-record.test.mjs.
export const HOLD_TOP_SQL = `SELECT GREATEST((SELECT max(id) FROM acts WHERE class = 'holding'),
                                     (SELECT max(id) FROM acts WHERE class = 'legacy'))::text AS top`;
