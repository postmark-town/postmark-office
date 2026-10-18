// chest-lock.mjs — ONE CHEST, ONE WRITER AT A TIME, ACROSS PROCESSES (WLD-27).
//
// Bevel's first review, finding 6: the settlement tick's first stock read the
// chest's count BEFORE its transaction and the office's gives read it in
// another process, so a give of 4 landing between the stock's plan and its
// insert left 24 in a chest of 20. The hold queue serializes one process; the
// stock nonce serializes stock against stock. Neither sees the other writer.
//
// So every write that ADDS to a chest — a give into it, a refill, a whole thing
// put in, and the tick's stock — takes the same Postgres advisory lock for that
// chest INSIDE its own write transaction, re-reads the chest there, and only
// then decides. A transaction-scoped advisory lock is released by its COMMIT or
// ROLLBACK, so nothing is left held if a writer dies. Takes (which only
// subtract) take no lock: they can never overfill.

import { pgHoldingRows, pgAttachmentsFor } from "../world2/tools/guard-reads.mjs";
import { foldUnits, totalOf, isUnitRow } from "./world-stacks.mjs";
import { liveHolders, wholeLoadOf } from "./holder-tree.mjs";

/** The lock's key text; Postgres hashes it to the advisory key. */
export const chestLockKey = (chest) => `wld27-chest:${chest}`;
export const CHEST_LOCK_SQL = "SELECT pg_advisory_xact_lock(hashtext($1))";

/** Whole things a chest holds now, from attachment rows (latest per thing wins). */
export function thingsIn(attachmentRows, chest) {
  const last = new Map();
  for (const r of attachmentRows) last.set(String(r.target), r);
  let n = 0;
  for (const r of last.values()) if (r.policy === "cascade" && String(r.entity) === String(chest)) n += 1;
  return n;
}

// THE CHEST'S OWN LAST WORD on the record: its newest leave or withdraw act. A
// chest whose last word is a withdrawal is leaving the world — it takes
// nothing more, whatever a writer planned before that decision (F1). `acts`
// has no row-level security, so every writer's guard reads the same answer.
const LAST_WORD_SQL = `
  SELECT action FROM acts
   WHERE class = 'mark' AND object = $1 AND action IN ('leave-mark', 'withdraw')
   ORDER BY id DESC LIMIT 1`;

/**
 * Inside a transaction: take the chest's lock (and, in order, the lock of each
 * holder named in `also`, the holders above it), then read how full it is and
 * whether it is being withdrawn. `load` is everything inside it as its room
 * counts it: its units, and each whole thing at any depth as 1 plus what that
 * holds (counts confer up, Darko 2026-10-17 23:29; holder-tree.mjs). `loads`
 * answers the same for each holder in `also`.
 */
export async function lockedChestUse(client, chest, { also = [] } = {}) {
  for (const h of [chest, ...also]) await client.query(CHEST_LOCK_SQL, [chestLockKey(h)]);
  const fold = foldUnits((await pgHoldingRows(client, {})).filter(isUnitRow));
  const { rows: held } = await pgAttachmentsFor(client);
  const word = (await client.query(LAST_WORD_SQL, [String(chest)])).rows[0]?.action ?? null;
  const up = liveHolders(held);
  const loadOf = (h) => totalOf(fold, h) + wholeLoadOf({ up, holder: h, unitsOf: (x) => totalOf(fold, x) });
  return { units: totalOf(fold, chest), things: thingsIn(held, chest), load: loadOf(chest), loads: also.map(loadOf), withdrawn: word === "withdraw" };
}

const bounce = (code, defect, hint, extra = {}) => {
  const e = new Error(defect);
  Object.assign(e, { code, defect, hint, ...extra });
  return e;
};

/**
 * The pen guard for an office write that adds `adding` to `chest`: run inside
 * the write's own transaction, before its act is inserted (world2-pen.mjs §
 * penWrite `guard`). Refuses — and so rolls the transaction back, writing
 * nothing — when the chest has no room for it under the lock.
 *
 * `above` (the holders the chest sits inside, with their capacities) and
 * `adding` (for a whole thing, its weight: 1 and all it holds) are derived by
 * the door BEFORE this lock, from the rows it read. That is safe because
 * holdTurn serialises every live door in this one process, so no other door
 * moves the chest, the thing or a holder above between that read and this
 * write; the lock is for the other process (the tick's stock), whose loads
 * are re-read here.
 */
export const chestRoomGuard = ({ chest, capacity, adding, above = [] }) => async (client) => {
  const used = await lockedChestUse(client, chest, { also: above.map((a) => a.holder) });
  if (used.withdrawn)
    throw bounce(409, `${chest} was withdrawn`, "its maker took it off the world before this reached it; it takes nothing more. Nothing was recorded.", { room: 0 });
  const total = used.load;
  if (total + adding > capacity)
    throw bounce(409, `${chest} has room for ${Math.max(capacity - total, 0)}, not ${adding}`,
      `its capacity is ${capacity} and it holds ${total} now (units of every label and whole things, each holder 1 and all it holds); another hand reached it first. Nothing was recorded.`,
      { room: Math.max(capacity - total, 0) });
  // COUNTS CONFER UP: every holder it sits inside takes the same `adding`, judged here under its own lock
  above.forEach(({ holder, capacity: cap }, i) => {
    const load = used.loads[i];
    if (load + adding > cap)
      throw bounce(409, `${holder} has room for ${Math.max(cap - load, 0)}, not ${adding}`,
        `${chest} is inside it, and a holder counts 1 and everything it holds: ${holder} holds ${load} of ${cap} now; another hand reached it first. Nothing was recorded.`,
        { room: Math.max(cap - load, 0), at: holder });
  });
};

/**
 * THE PEN GUARD FOR WITHDRAWING A CHEST (Wright's independent review, F1): a
 * chest that holds ANYTHING — counted units of any label, or a whole thing —
 * is not withdrawn, or what is inside would be stranded in a mark that is
 * gone. Judged under the chest's lock inside the withdrawal's own transaction,
 * so a give, refill, thing-put or stock either landed first (and is counted
 * here) or waits and then finds the chest withdrawn (chestRoomGuard). Refuses —
 * rolling back, writing nothing — with the contents named.
 */
export const chestEmptyGuard = ({ chest }) => async (client) => {
  const used = await lockedChestUse(client, chest);
  if (used.units + used.things > 0) {
    const parts = [used.units ? `${used.units} unit${used.units === 1 ? "" : "s"}` : null, used.things ? `${used.things} whole thing${used.things === 1 ? "" : "s"}` : null].filter(Boolean);
    throw bounce(409, `${chest} still holds ${parts.join(" and ")}`,
      "a chest is withdrawn only when it is empty — take out what is inside first (units by a take, a whole thing by a take aimed at the chest). Nothing was recorded.",
      { holds: { units: used.units, things: used.things } });
  }
};
