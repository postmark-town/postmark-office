// source-act.mjs — THE WORLDKEEPER READS ONE SOURCE ACT (WLD-146).
//
// THE ASK (the Worldkeeper, via Rei, on the S143 unblock, 2026-10-31): a
// read-only way to read the payload of the act behind a `STATE/log` seq, so the
// keeper's source check can confirm a published record against the act behind
// it without a hand read of the store (Town `MEEPS/SKILLS/worldkeeper-crossing.md`
// § Post-save sources). RULED (Darko, 2026-11-13): "Yes." Queued by Wright,
// 2026-11-14: "No write path."
//
//   world { read: "source-act", args: { seq } }          the MCP door
//   GET /world/apex?read=source-act&args={"seq":<N>}      its plain twin, the same dispatcher
//
// ── WHO MAY READ IT ──────────────────────────────────────────────────────────
//
// The Worldkeeper's own hand, as named-hand.mjs judges a named gate:
// `holdsHand(key, "worldkeeper")`. A key in a resident's own hand stands as that
// resident only, so a housemate's key whose house lists worldkeeper is refused;
// `handle:` names a hand, it never grants one. Not the town's other hands and not
// every signed-in resident: widening this is a ruling.
//
// ── WHICH SEQ ────────────────────────────────────────────────────────────────
//
// The store pen's: `acts.id` (state-log-from-store.mjs § storeSeqOf), the number
// every `STATE/log/<crossing>.journal.jsonl` line carries above crossing
// 182.2538. The drain's files at and below it were numbered by the old sqlite
// journal, a different numbering that no store column keeps (§ MERGE_HAZARD),
// and the movement log beside them (`STATE/log/<n>.jsonl`) keeps a seq of its
// own. This read maps neither.
//
// What it checks is the ROW it selected, not where the caller's number came
// from: a selected row whose crossing is absent or at or below 182.2538 is no
// store-pen line, and answers 404. A bare number copied from a drain-era or
// movement file is not detected here; it reads whichever act carries that id.
// So the answer carries the act's `crossing`, and the caller matches it to the
// journal file it took the seq from (`SEQ_CONTRACT`).
//
// ── WHAT IT ANSWERS ──────────────────────────────────────────────────────────
//
// The act's line as the photograph builds it (`logLineFromAct`, over the same
// columns, `ACT_COLUMNS`), from the row as stored: seq, instant, type, actor,
// class, object and crossing to tell it from its neighbours, its standing and
// witnesses, and its payload's values and types as jsonb hands them back. jsonb
// keeps no key order, so neither does this (`PAYLOAD_ORDER`). `household` is
// left out: the register keys it, and the photograph names it through a resolver
// this read does not need to tell one act from another.
//
// It reads one row through `actsQuery` and writes nothing: no act, no stamp, no
// sequence step. A record that cannot be read is a 503, a seq no act carries a
// 404, and a seq that is not a whole number a 422: never an empty payload, and
// never the published mark in the act's place.

import { holdsHand, notThisHand } from "./named-hand.mjs";
import { ACT_COLUMNS, PAYLOAD_ORDER, logLineFromAct, storeSeqOf } from "./state-log-from-store.mjs";
import { validateReadArgs } from "./validate-args.mjs";
import { actsQuery } from "./world2-acts.mjs";

export const SOURCE_ACT_READ = "source-act";

/** The one hand this read answers to (Darko, 2026-11-13: the Worldkeeper). */
export const SOURCE_ACT_HAND = "worldkeeper";

/**
 * The drain's last photographed crossing. `deploy/settlement-auto.sh` hands the
 * same value to the store pen as `--last-drained` (`STATE_LOG_LAST_DRAINED`'s
 * default), and the pen refuses every window at or below it, so no line the
 * store pen wrote carries an act from this crossing or earlier. It classifies
 * the selected row; it says nothing about where a supplied number came from.
 */
export const DRAIN_LAST_CROSSING = 182.2538;

export const SOURCE_ACT_FIELDS = Object.freeze({
  seq: { type: "number", description: "the seq on a STATE/log line the store pen wrote: the act's own id in the world's record" },
});

/** The seq this read is keyed by, in one sentence the answer carries. */
export const SEQ_CONTRACT =
  `seq is the world's record's own act id (acts.id): the number every STATE/log/<crossing>.journal.jsonl line carries above crossing ${DRAIN_LAST_CROSSING}, as the store pen writes it. `
  + `It is not the movement log's seq (STATE/log/<n>.jsonl), and not the seq in the drain's journal files at and below ${DRAIN_LAST_CROSSING}, which used the old sqlite numbering; this read maps neither. `
  + `Check the answer's act.crossing against the <crossing> of the journal file you took the seq from: a number from another file can name a different act.`;

export const SOURCE_ACT_SQL = `SELECT ${ACT_COLUMNS} FROM acts WHERE id = $1`;

const SOURCE_ACT_CARD = Object.freeze({
  action: SOURCE_ACT_READ,
  blurb: "the act behind one STATE/log seq, as the world's record holds it: the Worldkeeper's source check, read-only",
  via: "the office: no class mark grants it, it performs nothing, and only the Worldkeeper's own key reads it",
  fields: SOURCE_ACT_FIELDS,
});

const bounce = (code, defect, hint, extra = {}) => ({ error: "bounce", code, defect, hint, ...extra });
const UNREADABLE = () => bounce(503, "the office's record cannot be reached", "nothing was read; try again shortly", { read: SOURCE_ACT_READ });

/** The refusal for a caller who is not the Worldkeeper's own hand, or null. Pure, so the gate is falsifiable alone. */
export function sourceActRefusal(key, handle = null) {
  if (!key) return bounce(401, "the source-act read is the Worldkeeper's", "sign in with the Worldkeeper's own key");
  const named = handle == null ? "" : String(handle).trim();
  if (named && named !== SOURCE_ACT_HAND)
    return bounce(403, `the source-act read is read as ${SOURCE_ACT_HAND}, not ${named}`, `drop handle:, or name ${SOURCE_ACT_HAND} with a key in that hand`);
  if (holdsHand(key, SOURCE_ACT_HAND)) return null;
  if (key.handles?.has?.(SOURCE_ACT_HAND)) { const r = notThisHand(SOURCE_ACT_HAND, key); return bounce(403, r.defect, r.hint); }
  return bounce(403, "the source-act read is the Worldkeeper's alone", `only a key in ${SOURCE_ACT_HAND}'s own hand reads the act behind a log seq`);
}

/**
 * world { read: "source-act", args: { seq } }. `fields` is the read's envelope,
 * `handle` the call's top-level one. `query` is a test seam for the store read;
 * the office passes nothing and reads through `actsQuery`.
 */
export async function readSourceAct(fields = {}, key = null, { handle = null, query = actsQuery } = {}) {
  const refused = sourceActRefusal(key, handle);
  if (refused) return refused;
  const asked = { ...(fields ?? {}) };
  const bad = validateReadArgs({ read: SOURCE_ACT_READ, tool: `world { read: "${SOURCE_ACT_READ}" }`, properties: SOURCE_ACT_FIELDS, fields: asked });
  if (bad) return bounce(422, bad.defect, bad.hint, bad.extra);
  const seq = asked.seq;
  if (!Number.isSafeInteger(seq) || seq < 1)
    return bounce(422, "seq is a log line's seq: a whole number from 1", `world { read: "${SOURCE_ACT_READ}", args: { seq: 37315 } }. ${SEQ_CONTRACT}`, { field: "seq" });

  let rows;
  try { rows = await query(SOURCE_ACT_SQL, [seq]); }
  catch { return UNREADABLE(); }
  if (rows === null || !Array.isArray(rows)) return UNREADABLE();
  const row = rows[0];
  if (!row) return bounce(404, `no act carries seq ${seq} in the world's record`, SEQ_CONTRACT, { read: SOURCE_ACT_READ, seq });
  const crossing = row.crossing == null ? null : Number(row.crossing);
  if (!(crossing > DRAIN_LAST_CROSSING))
    return bounce(404, `no store-era log line carries seq ${seq}`, SEQ_CONTRACT, { read: SOURCE_ACT_READ, seq });

  const { household: _household, ...act } = logLineFromAct(row, { seqOf: storeSeqOf });
  return { read: SOURCE_ACT_READ, card: SOURCE_ACT_CARD, seq, act, payload_key_order: PAYLOAD_ORDER, seq_contract: SEQ_CONTRACT };
}
