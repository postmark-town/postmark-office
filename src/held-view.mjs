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

/**
 * The same view, read from ONE STORE the caller names (the store twin's pool,
 * world2-serve.mjs): its hold rows, its cutoffs and its places, never the
 * office's own store. The twin answers from the pool it is handed, and the
 * hold record is part of that answer. `null` when the store cannot say.
 */
export async function heldViewFrom(p, { markRows = null } = {}) {
  if (!p) return null;
  try {
    const [port, { composeAnchor }, { placedCentreOfRow }] = await Promise.all([
      import("../world2/tools/guard-reads.mjs"), import("./world-journal.mjs"), import("./held.mjs"),
    ]);
    const client = { query: (text, args) => p.query(text, args) };
    const [atts, holding, cut, rows] = await Promise.all([
      port.pgAttachmentsFor(client, {}), port.pgHoldingRows(client, {}),
      p.query(HOLD_THROUGH_SQL).then((r) => r.rows ?? r).catch(() => []),
      // the caller's own read of the rows when it has one: the twin reads `marks` once per answer
      markRows ?? p.query("SELECT slug, geometry, data FROM marks WHERE status = 'standing'").then((r) => r.rows ?? r),
    ]);
    const bySlug = new Map((rows ?? []).map((r) => [String(r.slug), r]));
    const drops = new Map();
    for (const r of holding) if (r.action === "drop" && r.object != null) drops.set(String(r.object), r);
    const places = new Map();
    for (const [id, r] of drops) {
      const at = composeAnchor(r.at ?? {}, (mid) => placedCentreOfRow(bySlug.get(String(mid)) ?? null));
      if (at) places.set(id, at);
    }
    const placed = new Map([...bySlug].map(([s, r]) => [s, (typeof r.data === "string" ? JSON.parse(r.data) : r.data)?.[PLACED]]).filter(([, v]) => v));
    const num = (v) => (v == null || !Number.isFinite(Number(v)) ? null : Number(v));
    return viewOf({ record: { attachments: atts.rows ?? [], drops, places }, from: num(cut?.[0]?.from), through: num(cut?.[0]?.through), placed });
  } catch { return null; }
}

/**
 * "CARRYING N THINGS" ON THE HOLDER'S ROW (POS-688 D5, ruled by Darko 2026-10-19
 * 09:21). A held thing never appears as a mark of its own; it reads as its
 * holder's contents, so the holder's row in anyone's view says how many: the
 * things in their hands in all, a carried holder counting 1 plus everything in it
 * (world-units.mjs § heldLoadOf, the hands read's "things in all"). Never which:
 * looking closer at the holder lists them (investigate). A resident carrying
 * nothing gets no field; an unread hold record changes nothing.
 */
export async function withCarrying(present) {
  if (!Array.isArray(present?.residents) || !present.residents.length || !world2Enabled()) return present;
  try {
    const [{ holdRecordNow }, { heldLoadOf }] = await Promise.all([import("./world-kinds.mjs"), import("./world-units.mjs")]);
    const { fold, attachments } = await holdRecordNow();
    let changed = false;
    const residents = present.residents.map((r) => {
      const n = r?.handle ? heldLoadOf(attachments, fold, String(r.handle)) : 0;
      if (!(n > 0)) return r;
      changed = true;
      return { ...r, carrying: n };
    });
    return changed ? { ...present, residents } : present;
  } catch { return present; }
}
