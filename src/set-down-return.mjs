// set-down-return.mjs — A FULL HOLDER SET DOWN AND WITHDRAWN BEFORE IT PUBLISHED
// COMES BACK WHOLE (WLD-138 B).
//
// Wright, AUTHORITY 2026-11-04T12:01:08.382Z: "A pending full holder that's
// withdrawn before publication comes back whole to its household's hold, holder
// and contents together, exactly once, under the existing caps, in one act.
// Never split, never stranded at a dead id." And 16:00:21.585Z, the shape (B, a
// restoration-only hold fact): it keeps the original id, record and quantities,
// never creates a second thing, never takes a name, never costs the resident an
// extra act or stamp; its only writer is the withdrawal's own transaction, under
// the existing cap, owner, escrow and replay protection; it restores across a
// kept base or window boundary; every reader of holds, attachments and made
// things reads it.
//
// So the face is `put-back` (named-making.mjs § PUT_BACK_FACE, guard-reads §
// HOLD_FACES): one hold row, written by `putBackGuard` INSIDE the withdrawal's
// transaction, that puts the holder back in the hands it was set down from and
// carries the make's own record (`made`), so the made fold re-registers it. The
// contents need nothing: they never moved, and are held by the holder's id
// throughout (named things by their hold rows, counted units by the holder).
// The shape is the unit return's (drop-recovery.mjs § withdrawRestoreGuard,
// world-units.mjs § withdrawDroppedUnit): the room is judged in the hold queue's
// turn, then the guard reads the record again under the candle and the holder's
// lock and decides, once by its nonce, beside the docket half that removes the
// draft. Either the holder comes back and the draft goes, or neither.
//
// WHAT IT TOUCHES. Only a set-down holder that holds something: the last hold
// row for the id is a `set-down` naming this draft, by its maker, and the holder
// holds at least one unit or whole thing. Any other mark (an empty set-down, a
// published one, a mark never made in hand) withdraws exactly as before.
//
// A CLAIM THE CLEARING REFUSED (Wright, AUTHORITY 2026-11-04T21:57:51.368Z):
// "the 12:01 rule covers a clearing-refused claim … Its dropper gets it back,
// holder and contents together, by withdrawing it." The same face and the same
// writer: the withdrawal's guard accepts a refused claim beside a draft or a
// pending one, and the clearing still only refuses. Measured, not assumed:
// refusal is final IN THE CURRENT CODE, not by a schema guarantee. 007's
// transition guard gives the office pen no way out of `refused`, but it exempts
// `clearing_job` entirely; what keeps a refused row refused is that the clearing
// moves only the pending claims of the window it clears, and review-rule.mjs only
// `held_review` ones. The stake door cannot see a refused mark. So the withdrawal
// is the one way home; a future `clearing_job` path that touched refused rows
// would reopen the stake/withdraw race, and must answer for it.
// A claim held for review is not stranded but waiting, and is not withdrawn.

import { MAKE_FACE, SET_DOWN_FACE, PUT_BACK_FACE } from "./named-making.mjs";

const bounce = (code, defect, hint, extra = {}) => Object.assign(new Error(defect), { code, defect, hint, ...extra });
const LOCK_SQL = "SELECT pg_advisory_xact_lock(hashtext($1))";

/** The put-back's nonce: one per set-down, so a holder comes back from one set-down once, whoever asks. */
export const putBackNonce = (setDownActId) => `${PUT_BACK_FACE}:${String(setDownActId)}`;

/** The newest hold row naming this id (the thing's own hold history; units are not things). */
// `id` stays a bigint: an output column `id::text` would be what ORDER BY id sorts, and "10" < "8". The newest
// (or first) is also taken in code (`pick`), so a reader that ignores ORDER/LIMIT answers the same.
const LAST_HOLD_SQL = `
  SELECT id, actor, action, payload FROM acts
   WHERE class = $1 AND object = ANY($2) AND action = ANY($3)
   ORDER BY id DESC LIMIT 1`;
/** The make that made it: the first, and by G2 the only one. Read from the record, never from a kept fold. */
const MAKE_SQL = `SELECT id, payload FROM acts WHERE class = $1 AND object = ANY($2) AND action = ANY($3) ORDER BY id LIMIT 1`;
const pick = (rows, newest) => (rows ?? []).reduce((best, r) => (best == null || (newest ? BigInt(r.id) > BigInt(best.id) : BigInt(r.id) < BigInt(best.id)) ? r : best), null);
const lastHoldRow = async (client, id) => {
  const r = pick((await client.query(LAST_HOLD_SQL, ["holding", [id], HOLD_ROW_FACES])).rows, true);
  return r ? { ...r, id: String(r.id) } : null;
};
/** Its draft on the docket: the newest claim at this id by its maker. `marks` and a locked claim are publication. */
const CLAIM_SQL = `SELECT id::text, status, window_id FROM claims WHERE slug = $1 AND claimant = $2 ORDER BY submitted_at DESC LIMIT 1`;
const PUBLISHED_SQL = `
  SELECT EXISTS (SELECT 1 FROM marks WHERE slug = $1)
      OR EXISTS (SELECT 1 FROM claims WHERE slug = $1 AND status = 'locked') AS published`;
const OPEN_WINDOW_SQL = "SELECT id FROM windows WHERE status = 'open' ORDER BY id DESC LIMIT 1";
/** The docket half's own predicates (world2-claims.mjs § withdraw): a draft is deleted, a pending claim on the open window retracted. */
const REMOVED_DRAFT_SQL = `SELECT 1 FROM claims WHERE status = 'draft' AND slug = $1 AND claimant = $2 AND household = ANY($3) LIMIT 1`;
const RETRACTED_PENDING_SQL = `SELECT 1 FROM claims WHERE window_id = $1 AND status = 'pending' AND geometry->>'slug' = $2 AND claimant = $3 LIMIT 1`;

const obj = (v) => (typeof v === "string" ? JSON.parse(v) : (v ?? {}));
const HOLD_ROW_FACES = ["give", "drop", "take", MAKE_FACE, "consume", SET_DOWN_FACE, PUT_BACK_FACE];

/**
 * What the record says of `mark` as a set-down holder of `by`'s, read on `client`
 * (no lock): null when its last hold row is not a set-down of this draft by its
 * maker. Otherwise `{ mark, setDown, from, made, contents: { units, things },
 * status, window, open, published, putBack }`, `putBack` the put-back already
 * written for this set-down, if any.
 */
export async function setDownHolderOf(client, { mark, by }) {
  const id = String(mark);
  const last = await lastHoldRow(client, id);
  if (!last) return null;
  const p = obj(last.payload);
  if (last.action === PUT_BACK_FACE) {
    // a set-down already put back: the replay's answer, never a fresh one
    return p.put_back?.draft === id && String(p.made_by ?? "") === String(by)
      ? { mark: id, done: { act: last.id, set_down: String(p.put_back.set_down) } } : null;
  }
  if (last.action !== SET_DOWN_FACE || p.set_down?.draft !== id || String(p.made_by ?? "") !== String(by)) return null;
  const make = pick((await client.query(MAKE_SQL, ["holding", [id], [MAKE_FACE]])).rows, false);
  const made = make ? obj(make.payload).made : null;
  if (!made || made.id !== id) return null; // not a thing made in hand: no record to put back
  const { lockedChestUse } = await import("./chest-lock.mjs");
  const use = await lockedChestUse(client, id);
  const { rows: [c] } = await client.query(CLAIM_SQL, [id, String(by)]);
  const { rows: [pub] } = await client.query(PUBLISHED_SQL, [id]);
  const { rows: [w] } = await client.query(OPEN_WINDOW_SQL);
  return {
    mark: id, setDown: last.id, from: p.previous_holder == null ? null : String(p.previous_holder), made, make: String(make.id),
    contents: { units: use.units, things: use.things },
    status: c?.status ?? null, window: c?.window_id ?? null, open: w?.id ?? null, published: pub?.published === true,
  };
}

/** Holds anything: a unit of any label, or a whole thing. An empty set-down withdraws as before. */
export const holdsAnything = (h) => Boolean(h) && (Number(h.contents?.units) > 0 || Number(h.contents?.things) > 0);
/**
 * Not published, and the withdrawal is its way home: its draft, its pending claim on the open window (the unit
 * return's own predicate), or its claim the clearing REFUSED. Wright, AUTHORITY 2026-11-04T21:57:51.368Z: "a
 * refused full holder is never stranded. Its dropper gets it back, holder and contents together, by withdrawing
 * it" — the withdrawal's guard accepts a refused claim, and nothing on the clearing side writes. Refusal is final
 * in the current code: 007's transition guard gives the office pen no transition out of `refused` (it exempts
 * `clearing_job`), the clearing moves only its window's pending claims, review-rule.mjs only `held_review` ones, and
 * the stake door cannot see a refused mark. So no stake can race this return for the refused claim today. A held
 * claim (`held_review`) is not here: it awaits its outcome.
 */
export const unpublished = (h) => Boolean(h) && !h.published
  && (h.status === "draft" || h.status === "refused" || (h.status === "pending" && h.open != null && Number(h.window) === Number(h.open)));

async function docketHalfRemoves(client, h, by) {
  if (h.status === "draft") {
    const { declaredKeys } = await import("./world2-claims.mjs");
    return (await client.query(REMOVED_DRAFT_SQL, [h.mark, String(by), await declaredKeys(client, null)])).rows.length > 0;
  }
  // refused, read under the candle and the holder's lock: the docket already holds it off the world, the office pen
  // may not move it (007), and the current clearing and review code do not (see `unpublished`), so the withdrawal
  // has nothing to take off the docket
  if (h.status === "refused") return true;
  return h.open != null && (await client.query(RETRACTED_PENDING_SQL, [h.open, h.mark, String(by)])).rows.length > 0;
}

const notNow = (h) => h.status === "held_review"
  ? bounce(409, `"${h.mark}" is a holder set down full, and its claim is held for review`,
    `it holds ${describe(h.contents)}, and it is not stranded, only waiting: a mind rules on it. Published, it prints with all it holds inside it; ` +
    `refused, withdrawing it then brings it back whole to the hands it was set down from. It cannot be withdrawn while the review is open. ` +
    `Nothing was withdrawn and nothing was recorded.`)
  : bounce(409, `"${h.mark}" is a holder set down full, and it cannot be withdrawn now`,
    `it holds ${describe(h.contents)}, and withdrawn it comes back whole to the hands it was set down from, with all it holds; ` +
    `that return can only be written while its draft is still a draft, pending on the open candle, or refused by the clearing${h.status ? ` (it is ${h.status} now)` : ""}. ` +
    `Nothing was withdrawn and nothing was recorded.`);
const howUnpublished = (h) => (h.status === "refused" ? "its claim refused at the clearing" : `withdrawn before it was published (${h.status})`);
const describe = ({ units = 0, things = 0 } = {}) => [units ? `${units} unit${units === 1 ? "" : "s"}` : null,
  things ? `${things} whole thing${things === 1 ? "" : "s"}` : null].filter(Boolean).join(" and ") || "nothing";

/**
 * THE WITHDRAWAL'S GUARD for a full set-down holder: in the withdrawal's own
 * transaction, under the candle (shared, as every docket write: a clearing
 * either published it first or waits) and the holder's lock, the record is read
 * again and decides. A full set-down holder of `by`'s whose draft this very
 * transaction removes → the put-back is written, once by its nonce; anything
 * else that is a full set-down holder → refused, so the draft never goes
 * without it. `out` receives what happened, for the receipt.
 */
export const putBackGuard = ({ mark, by, household, crossing = null, withdrawnBy = null, expect = false, out = {} }) => async (client) => {
  const { DOOR_SHARES_THE_CANDLE } = await import("../world2/tools/candle-lock.mjs");
  await client.query(DOOR_SHARES_THE_CANDLE);
  await client.query(LOCK_SQL, [`wld138-put-back:${String(mark)}`]);
  const h = await setDownHolderOf(client, { mark, by }); // read under the locks: this is the answer
  if (!h || h.done || !holdsAnything(h)) {
    // `expect`: the door read a full set-down holder and asked for its return, so this write is the return or
    // nothing — a withdrawal that raced it here and lost writes no second deed (exactly once)
    if (expect) throw bounce(409, h?.done ? `"${mark}" already came back whole (act ${h.done.act})` : `"${mark}" is no longer a holder set down full`,
      "another withdrawal of it landed first. Nothing was withdrawn now and nothing was recorded.");
    out.put_back = 0; return;
  }
  if (!unpublished(h) || !(await docketHalfRemoves(client, h, by))) throw notNow(h);
  if (!h.from) throw bounce(409, `"${h.mark}" was set down from no one's hands`, "there is no hold to put it back in. Nothing was withdrawn and nothing was recorded.");
  const [{ insertAct }, { normalizeRow }] = await Promise.all([import("./world2-pen.mjs"), import("./world-journal.mjs")]);
  const payload = {
    thing: h.mark, holder: h.from, previous_holder: null, made_by: String(by), policy: "cascade",
    made: h.made, put_back: { set_down: h.setDown, draft: h.mark, make: h.make }, ...(withdrawnBy ? { withdrawn_by: String(withdrawnBy) } : {}),
  };
  const row = normalizeRow({
    crossing, actor: String(by), action: PUT_BACK_FACE, object: h.mark, cls: "holding", household, nonce: putBackNonce(h.setDown), payload,
    effect: h.status === "refused"
      ? `${h.mark}'s claim was refused at the clearing and its maker withdrew it, so it came back to ${h.from}, whole, with ${describe(h.contents)} inside`
      : `${h.mark} was withdrawn before it was published, so it came back to ${h.from}, whole, with ${describe(h.contents)} inside`,
  });
  out.put_back = 1;
  out.act = String(await insertAct(client, row));
  out.holder = h;
};

/**
 * The public withdrawal of `mark` (by its author `by`), when it is a full
 * set-down holder: null for any other mark (the ordinary withdrawal runs, its
 * chest guard included). `withdraw` is the door's journalWithdraw, given the
 * guard it must hold in its write; `guard` the door's own (the escrow), held
 * after this one. `deps` are world-units.mjs § liveUnitDeps's.
 */
export async function withdrawSetDownHolder({ mark, by, household, key, caller = null, guard = null, withdraw }, deps) {
  const h = await deps.setDownHolder({ mark, by, household });
  if (!h) return null;
  // A SECOND WITHDRAWAL IS REFUSED (Wright, AUTHORITY 2026-11-04T21:57:51.368Z: "a second withdraw is refused
  // (exactly once)"; WLD-138 R1): the same 409 a raced loser gets, before anything is read for a write. The set-down
  // unit's replay answer (world-units.mjs § withdrawDroppedUnit) is that door's own, and stays.
  if (h.done) throw bounce(409, `"${mark}" already came back whole (act ${h.done.act})`,
    `its withdrawal already brought it back, holder and contents together, to the hands it was set down from; a second withdrawal is refused. Nothing was withdrawn now and nothing was recorded.`,
    { already: true, put_back_before: h.done.act });
  if (!holdsAnything(h)) return null; // an empty set-down withdraws as before
  if (h.published) return null;       // published: a holder on the world, withdrawn only empty (chest-lock.mjs § chestEmptyGuard)
  if (!unpublished(h)) throw notNow(h);
  if (!h.from || !key?.handles?.has(h.from))
    throw bounce(403, `"${mark}" was set down from ${h.from ?? "no one"}'s hands, and they are not on this key`,
      `withdrawn before it is published, a full holder comes back whole to the hands it was set down from, and those must be your household's: ` +
      `${h.from ?? "(none)"} is not among ${[...(key?.handles ?? [])].join(", ") || "(none)"}. Nothing was withdrawn and nothing was recorded.`);
  const view = deps.classes();
  if (!view.readable) throw bounce(503, "the class layer could not be read, so the carry cap cannot be asked",
    "withdrawing a full holder set down before it published brings it back to the hands it came from, and that add is judged against the carry cap; nothing was withdrawn — try again when the law is loaded");
  const { holdTurn, holdingsOf } = await import("./world-hold.mjs");
  const { refuseOverCarry, foldUnits, totalOf } = await import("./world-stacks.mjs");
  const { inFlightFor, carryCapOf } = await import("./world-units.mjs");
  const cap = carryCapOf(view);
  return holdTurn(async () => {
    const inFlight = await inFlightFor(h.from, deps); // BEFORE the rows (world-units § inFlightFor)
    const { units, attachments } = await deps.readRows();
    // the holder counts 1 toward its carrier, whatever it holds (LOGOS classes.md § holders, ruled 16:02)
    try { refuseOverCarry({ who: h.from, units: totalOf(foldUnits(units), h.from) + inFlight, things: holdingsOf(attachments, h.from).length, adding: 1, cap }); }
    catch (e) {
      if (e?.cap == null) throw e;
      throw bounce(409, `${h.from}'s hands are full (${e.carried}/${e.cap}) — the holder this mark is would come back to them, whole`,
        `${caller === h.from ? "your hands are full" : `${h.from}'s hands are full`} (${e.carried}/${e.cap}): drop, give or consume one, then withdraw. Nothing was withdrawn and nothing was recorded.`,
        { carried: e.carried, cap: e.cap });
    }
    const out = {};
    const back = putBackGuard({ mark, by, household, crossing: deps.crossing(), withdrawnBy: caller, expect: true, out });
    const both = guard ? async (c) => { await back(c); await guard(c); } : back;
    const r = await withdraw({ guard: both, holderReturns: true, refused: h.status === "refused" });
    return { ...r, put_back: out.put_back ?? 0,
      ...(out.put_back ? { holder: { thing: String(mark), to: out.holder.from, act: out.act, holds: out.holder.contents },
        put_back_note: `${howUnpublished(out.holder)}, so ${mark} came back to ${out.holder.from}, whole, with ${describe(out.holder.contents)} inside` } : {}) };
  });
}

/**
 * THE MAKER'S READ of a full set-down holder whose claim the clearing refused or holds (Wright 21:57:51, "the
 * honest read"): the words for the receipt's `next`, or null for any other mark. Only what works is offered:
 * refusal is final, so a refused holder is pointed at its withdrawal, never at a stake; a held one waits.
 * `cause` is the receipt's own word for the refusal (mark-receipt.mjs § causeOf).
 */
export async function setDownHolderNext({ mark, by, household, cause = null }, deps) {
  const h = await deps.setDownHolder({ mark, by, household });
  if (!h || h.done || !holdsAnything(h) || h.published) return null;
  if (h.status === "refused") {
    const why = cause === "unbacked" ? " (unbacked: a mark on ground that is not its maker's publishes only with a stamp behind it)" : "";
    return `it was not set down: the clearing refused its claim${why}, and a refused claim does not go back on the docket, so staking it now puts nothing forward. ` +
      `It still holds ${describe(h.contents)}, inside it and keyed to it: withdraw it (world_withdraw_mark { mark: "${h.mark}" }) and it comes back whole to ${h.from}'s hands, with all it holds, if they have room`;
  }
  if (h.status === "held_review")
    return `it holds ${describe(h.contents)} and is not stranded, only waiting: a mind rules on its claim. Published, it prints with all it holds inside it; ` +
      `refused, withdrawing it then brings it back whole. It cannot be withdrawn while the review is open`;
  return null;
}

/**
 * THE SET-DOWN'S OWN UNDO (setDownMade's compensation, world-hold.mjs): the set-down act did not land,
 * so its draft goes back out while the thing, and all it holds, are still in hand. Withdrawing that shell
 * strands nothing, so the empty-holder guard does not apply to it. This guard proves it in the
 * withdrawal's own transaction, under the same lock as a put-back: refused if a set-down of this draft did land.
 */
export const stillInHandGuard = ({ mark }) => async (client) => {
  await client.query(LOCK_SQL, [`wld138-put-back:${String(mark)}`]);
  const last = await lastHoldRow(client, String(mark));
  if (last?.action === SET_DOWN_FACE && obj(last.payload).set_down?.draft === String(mark))
    throw bounce(409, `"${mark}" was set down, so its draft is not an undone set-down's`,
      "a set-down that landed is withdrawn by its maker (a full holder comes back whole); this undo is only for one that did not land. Nothing was withdrawn and nothing was recorded.");
};

export const STORE_ONLY = "set-down-holder-withdraw-store-only";

/**
 * On the git (non-single-log) withdraw lane: the named refusal for a full
 * set-down holder's mark, or null for any other mark. That lane has no
 * transaction for the put-back to share, so it refuses before anything is
 * written, as it does a set-down unit's (world-units.mjs § droppedUnitOnGitLane).
 * A store that cannot be asked refuses too.
 */
export async function setDownHolderOnGitLane({ mark, by, household }, deps = null) {
  const { world2Enabled } = await import("./world2-acts.mjs");
  if (!world2Enabled()) return null; // no hold record here: nothing can have been made in hand
  let h;
  try { h = await (deps ?? await (await import("./world-units.mjs")).liveUnitDeps()).setDownHolder({ mark, by, household }); }
  catch (e) {
    const { faultLogged } = await import("./fault-words.mjs");
    return { code: 503, reason: STORE_ONLY, defect: `the store could not say whether "${mark}" is a holder set down full`,
      hint: `a full set-down holder is withdrawn only on the store's path, and this lane cannot tell without asking it; nothing was written — try again; ${faultLogged(`the store could not say whether "${mark}" is a holder set down full`, e)}` };
  }
  if (!h || h.done || !holdsAnything(h) || h.published) return null;
  return { code: 409, reason: STORE_ONLY, defect: `"${mark}" is a holder set down full, and it is withdrawn only on the store's path (${STORE_ONLY})`,
    hint: `it holds ${describe(h.contents)}. Withdrawn before it is published, it comes back whole to the hands it was set down from, and only the single-log store path (WORLD_SINGLE_LOG=1) writes that return in the withdrawal's own transaction; this office writes marks on the git lane, so nothing was written.` };
}
