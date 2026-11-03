// invite-hold-store.mjs — THE HANDS' HOLD ON AN INVITER'S PAYOUT (POS-816): move, read.
//
// Darko, 2026-11-02 23:56 ("calls are good. continue with the calls as stated"):
// the hold is an office act checked by account, the bug-stage hands' pattern;
// Little Bird's account, with Darko as her backup. A held payout waits until it
// is lifted; lifting and cancelling each need a reason; a cancelled payout takes
// no place in the cap. And 2026-11-03 00:08: the inviter's 10 waits a week after
// the trigger, which is the window a hold is placed in.
//
//   hold    town { do: "advance", args: { post: "invite:<slug>", to: "held", note } }        the hands only
//   lift    town { do: "advance", args: { post: "invite:<slug>", to: "lifted", note } }      the hands only
//   cancel  town { do: "advance", args: { post: "invite:<slug>", to: "cancelled", note } }   the hands only
//   read    town { read: "posts", args: { class: "invite", post? } }                          the hands only
//
// THE BUG-STAGE HANDS' PATTERN: a bug moves by `advance`, by BUG_HANDS, checked
// by the credential (named-hand.mjs § holdsHand), and so does this. It rides
// `advance` and `read: "posts"` the way a report does (084): no new verb, so
// nothing is added to the act list every resident's agent reads (AGENTS.md § The
// MCP surface: "Hands-only verbs and fields never reach a resident"). Anyone who
// is not a hand gets one answer whether or not the invitation exists.
//
// The hold lives in `invite_holds` (086), private, never an act. The evidence a
// hand reads is src/invite-pay.mjs § planInvitePay's row for the invitation: the
// household and its inviter, when it came ashore and what its welcome paid,
// what activated it and when, when the inviter's 10 falls due, how many the
// inviter has been paid this month, and the reading's own time (Little Bird's
// list, CORE-26 2026-10-29: "the approval is made on the numbers and not on the
// summary").

import { officeRead, officeWrite } from "./world2-pen.mjs";
import { refuse } from "./events.mjs";
import { holdsHand } from "./named-hand.mjs";
import {
  INVITE_CLASS, INVITE_ID_RE, INVITE_HOLD_HANDS, HOLD_STATES, inviteId, judgeHoldMove, planInvitePay,
} from "./invite-pay.mjs";
import { inviteStoreFacts, townInviteLedger } from "./invite-facts.mjs";

const notYetLanded = (e) => e?.code === "42P01";
const STORE_NOT_READY = () => refuse(503, "the invitations' holds are not open yet",
  "the office's record does not hold them yet (migration 086); nothing was moved. Try again after it lands");
/** One answer for an invitation a caller may not see, whether or not it exists. */
export const INVITE_NOT_FOUND = (id) => refuse(404, `no post "${id}"`, "town { read: \"posts\", args: { class } } lists what you may read");

/** The hand this key moves a payout as, or null: `handle` when it names one, else the first the key holds. */
export function inviteHandOf(fields, key) {
  const named = String(fields?.handle ?? "").trim();
  if (named) return INVITE_HOLD_HANDS.includes(named) && holdsHand(key, named) ? named : null;
  return INVITE_HOLD_HANDS.find((h) => holdsHand(key, h)) ?? null;
}

const HOW = Object.freeze({
  hold: `town { do: "advance", args: { post: "invite:<slug>", to: "held", note } }: the inviter's 10 waits until it is lifted`,
  lift: `town { do: "advance", args: { post: "invite:<slug>", to: "lifted", note } }: it pays at the first settlement once its week is over`,
  cancel: `town { do: "advance", args: { post: "invite:<slug>", to: "cancelled", note } }: it is never paid, and takes no place in the inviter's 10 a month`,
  note: "every move carries a reason, kept with it",
});
export const INVITE_PRIVATE_NOTE = "internal: the town's hands read this and move it (Little Bird, and Darko as her backup); no one else reads it, and nothing here is published";

/**
 * The plan for the whole town, read now: the store's facts, the town's ledger
 * folded with the STORE's registry (its accounts are what fold a `gh:<id>` key to
 * its house, as the town's verifier folds it), and the holds.
 */
async function readPlan({ env, clone, now }) {
  const store = await officeRead(async (c) => inviteStoreFacts(async (sql, params) => (await c.query(sql, params)).rows), { env, by: "invitesAtOffice" });
  if (!store) return null;
  const { loadRegistryRows } = await import("./registry-store.mjs");
  const { registryFromRows } = await import("./registry-rows.mjs");
  const regRows = await loadRegistryRows(env);
  const households = regRows ? (registryFromRows(regRows).households ?? {}) : {};
  const town = clone ? await townInviteLedger(clone, households) : null;
  const ledger = town?.ledger ?? null;
  return { store, ledger, plan: ledger ? planInvitePay({ ...store, holds: store.holds ?? new Map(), ledger, now }) : null };
}

/** town { do: "advance", args: { post: "invite:<slug>", to, note } }, by the hands. */
export async function advanceInvite(fields = {}, key = null, id, { now = Date.now(), env = process.env, clone = null } = {}) {
  const hand = inviteHandOf(fields, key);
  if (!hand || !INVITE_ID_RE.test(id)) throw INVITE_NOT_FOUND(id);
  const slug = id.slice("invite:".length);
  const at = new Date(now).toISOString();
  try {
    // the invitation must be one the store records, and not yet paid to its inviter
    const read = await readPlan({ env, clone, now }).catch((e) => { if (notYetLanded(e)) throw e; return { error: e }; });
    const row = read?.plan?.invitations.find((p) => p.household === slug)
      ?? (read?.store?.rows.some((r) => r.slug === slug) ? { household: slug, inviter_side: { status: "unknown" } } : null);
    if (!row) throw INVITE_NOT_FOUND(id);
    if (row.inviter_side?.status === "paid") throw refuse(409, `${id}'s inviter was paid on ${row.inviter_side.on}`, "a payout already on the ledger is not held, lifted or cancelled; the ledger is append-only");
    if (row.inviter_side?.status === "refused") throw refuse(409, `${id} pays neither side (the founders' household or the town's own)`, "there is no payout to hold");
    return await officeWrite(async (c) => {
      const { rows: [prev] } = await c.query("SELECT * FROM invite_holds WHERE household = $1 FOR UPDATE", [slug]);
      const from = prev?.state ?? "open";
      const judged = judgeHoldMove(fields, from);
      if (judged.defect) throw refuse(judged.code, judged.defect, judged.hint, judged.field ? { field: judged.field } : undefined);
      const move = { from, to: judged.to, note: judged.note, hand, at };
      const { rows: [saved] } = await c.query(
        `INSERT INTO invite_holds (household, state, moves, updated_at) VALUES ($1, $2, $3::jsonb, $4)
         ON CONFLICT (household) DO UPDATE SET state = EXCLUDED.state, moves = invite_holds.moves || EXCLUDED.moves, updated_at = EXCLUDED.updated_at
         RETURNING *`, [slug, judged.to, JSON.stringify([move]), at]);
      return { moved: id, from, to: judged.to, by: hand, hold: { state: saved.state, moves: saved.moves }, how: HOW, note: INVITE_PRIVATE_NOTE };
    }, { env });
  } catch (e) { if (notYetLanded(e)) throw STORE_NOT_READY(); throw e; }
}

/**
 * town { read: "posts", args: { class: "invite", post? } } — the hands' view.
 * Every invitation (or one), each with its evidence and both sides' status.
 */
export async function invitesAtOffice(fields = {}, key = null, { env = process.env, clone = null, now = Date.now() } = {}) {
  const one = String(fields?.post ?? "").trim();
  if (!key || !inviteHandOf(fields, key)) throw refuse(403, "the invitations' review is the town's hands'", "this read is Little Bird's and Darko's; your own household's stamps are at household { read: \"stamps\" }");
  if (one && !INVITE_ID_RE.test(one)) throw INVITE_NOT_FOUND(one);
  try {
    const read = await readPlan({ env, clone, now });
    if (!read) return { class: INVITE_CLASS, invitations: null, note: INVITE_PRIVATE_NOTE, unavailable: "the office is not pointed at its record, so this read cannot say which invitations stand" };
    const base = { class: INVITE_CLASS, read_at: new Date(now).toISOString(), holds_readable: read.store.holds !== null, how: HOW, note: INVITE_PRIVATE_NOTE };
    if (!read.plan) return { ...base, invitations: null, unavailable: "the town's ledger could not be read with an invite grammar, so this read cannot say what is paid" };
    if (one) {
      const row = read.plan.invitations.find((p) => p.invitation === one);
      if (!row) throw INVITE_NOT_FOUND(one);
      return { ...base, pay_day: read.plan.pay_day, invitation: row };
    }
    return { ...base, pay_day: read.plan.pay_day, month: read.plan.month, states: HOLD_STATES, total: read.plan.invitations.length, invitations: read.plan.invitations };
  } catch (e) {
    if (notYetLanded(e)) return { class: INVITE_CLASS, invitations: null, note: INVITE_PRIVATE_NOTE, unavailable: "the holds are not open on this office's record (migration 086)" };
    throw e;
  }
}

export { inviteId };
