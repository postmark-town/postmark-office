// held-view.mjs — the store's half of `held.mjs` (POS-688): the kept hold record,
// the last clearing's `hold_through`, and the places held things last stood.
//
// Never throws. A store that is not configured or will not answer is `null`, and
// every reader then answers as it did before POS-688 (canon's record as it stands):
// an unread hold record is "could not look", never "nobody holds anything", and
// the one thing it must not do is take a read down with it.
//
// CHEAP BY CONSTRUCTION. The hold record is the keeper's (one full read per
// settlement, deltas between; world-kinds.mjs § keeper). The cutoff and the
// places are one small query each, kept for a minute or until the hold record
// moves, whichever comes first.

import { world2Enabled } from "./world2-acts.mjs";
import { viewOf, PLACED } from "./held.mjs";

/** The printout cutoffs: the first clearing's and the newest's (the last hold act each wrote through; world2/tools/hold-through.mjs). */
export const HOLD_THROUGH_SQL = `SELECT min((receipts->>'hold_through')::bigint) AS "from", max((receipts->>'hold_through')::bigint) AS through
                                  FROM windows WHERE receipts ? 'hold_through'`;
/** Where each held thing last stood (kept in its row's data by the write-through; never printed). */
export const PLACED_SQL = `SELECT slug, data->'${PLACED}' AS placed FROM marks WHERE status = 'standing' AND data ? '${PLACED}'`;

const KEEP_MS = 60_000;
let kept = { key: null, at: 0, from: null, through: null, placed: new Map() };

async function keptFor(key) {
  if (kept.key === key && Date.now() - kept.at < KEEP_MS) return kept;
  const { actsQuery } = await import("./world2-acts.mjs");
  const [t, p] = await Promise.all([actsQuery(HOLD_THROUGH_SQL), actsQuery(PLACED_SQL)]);
  const num = (v) => (v == null || !Number.isFinite(Number(v)) ? null : Number(v));
  const placed = new Map((p ?? []).map((r) => [String(r.slug), typeof r.placed === "string" ? JSON.parse(r.placed) : r.placed]));
  kept = { key, at: Date.now(), from: num(t?.[0]?.from), through: num(t?.[0]?.through), placed };
  return kept;
}

/** The places held things last stood, `Map(slug → { at, extent })`, or an empty map when the store cannot say. Never reads the hold record. */
export async function placedNow() {
  if (!world2Enabled()) return new Map();
  try { return (await keptFor(kept.key ?? "placed")).placed; } catch { return new Map(); }
}

/** The view `held.mjs § placeOf` reads, or null when the store cannot say. */
export async function heldView() {
  if (!world2Enabled()) return null;
  try {
    const { holdRecordNow } = await import("./world-kinds.mjs");
    const record = await holdRecordNow();
    // the cutoffs and places are a second, small read: unread, no drop is laid over as printed
    // and no held anchor's last place is known, while who holds what (the record) still stands
    const k = await keptFor(`${record?.top ?? "-"}|${record?.epoch ?? "-"}`).catch(() => ({ from: null, through: null, placed: new Map() }));
    return viewOf({ record, from: k.from, through: k.through, placed: k.placed });
  } catch { return null; }
}

/** Tests only: forget the kept cutoff and places. */
export function __resetHeldViewForTest() { kept = { key: null, at: 0, from: null, through: null, placed: new Map() }; }
