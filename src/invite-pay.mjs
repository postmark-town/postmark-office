// invite-pay.mjs — Bring a neighbour: what the office owes, and when (POS-816).
//
// ── THE RULINGS ─────────────────────────────────────────────────────────────
//
// POS-576 (Darko 2026-10-11 09:53; amended 2026-10-22 20:40 and 22:06):
//   · "an invited household's join bundle is 10 stamps, 5 more than an ordinary
//     join", paid at settle ("Invitee now");
//   · its inviter gets 10 when the new household sends its first letter or
//     claims its home, "within 30 days" ("inviter when real");
//   · at most 10 paid invitations per household a month ("let's do 10 a month");
//   · the founders' household and the town earn none ("No, never"); meeps
//     can't be named.
// POS-816 (Darko 2026-10-28 23:07 "otherwise little bird will drown";
// 2026-11-02 23:56 "calls are good. continue with the calls as stated";
// 2026-11-03 00:08 EDT in the picker):
//   · the office pays both sides BY RULE at settlement: no meep and no human sits
//     in the paying path, and nobody names an amount or a recipient;
//   · the invitee's 5 more is its own ledger line, paid at settle with no wait;
//   · the inviter's 10 waits "A week" after the trigger, and Little Bird, with
//     Darko as her backup, may hold it in that week: an office act checked by
//     account (the bug-stage hands' pattern, invite-hold-store.mjs). A held
//     payout waits until it is lifted; lifting and cancelling each need a
//     reason; a cancelled payout takes no place in the cap;
//   · the cap counts a payout in the month it is paid ("Month paid").
//
// The word "real" stays out of the town's words (Little Bird, 2026-10-30): the
// trigger is a household ACTIVATING, its first letter or its home.
//
// ── WHAT THIS FILE IS ───────────────────────────────────────────────────────
//
// Pure law and one plan, read by three callers so they cannot disagree:
// deploy/invite-pass.mjs (which pays), the hands' hold view
// (invite-hold-store.mjs § invitesAtOffice) and tools/invites.mjs (the
// operator's report). Nothing here writes, reads a store or spawns anything.
// The amounts and the ledger's own terms live in the town (stamp-mint.mjs §
// INVITE); this file decides only WHO is owed WHAT side, and WHEN.

export const INVITE_CLASS = "invite";
/** An invitation's id: `invite/<the invited household's slug>`. */
export const INVITE_ID_RE = /^invite\/[a-z0-9][a-z0-9-]*$/;
export const inviteId = (slug) => `invite/${slug}`;

/** The hands that hold, lift and cancel (Little Bird, and Darko as her backup: POS-816, Little Bird 2026-10-30). */
export const INVITE_HOLD_HANDS = Object.freeze(["little-bird", "keemin"]);

export const INVITE_WITHIN_MS = 30 * 864e5;         // the first letter or home "within 30 days" (POS-576/b)
export const INVITE_HOLD_MS = 7 * 864e5;            // "A week" (POS-816/a)
export const INVITE_CAP_PER_MONTH = 10;             // "let's do 10 a month" (POS-576/c), in the month paid (POS-816/b)
export const SETTLEMENT_HOURS_UTC = Object.freeze([6, 18]);

/** The founders' household and the town's own (POS-576/e); arrival-invite.mjs § FOUNDERS is the one list. */
export { FOUNDERS } from "./arrival-invite.mjs";
import { FOUNDERS } from "./arrival-invite.mjs";

const TZ = () => process.env.TOWN_TZ ?? "America/New_York";
const iso = (v) => { const t = v == null ? NaN : new Date(v).getTime(); return Number.isFinite(t) ? new Date(t).toISOString() : null; };

/** The town day an instant falls on: the clock the town's ledger dates its lines on. */
export const townDay = (at, tz = TZ()) => new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date(at));

/** The first settlement (06:00 or 18:00 UTC) at or after an instant. */
export function settlementAtOrAfter(at) {
  const t = new Date(at);
  for (let day = 0; day < 2; day += 1)
    for (const h of SETTLEMENT_HOURS_UTC) {
      const s = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate() + day, h));
      if (s >= t) return s.toISOString();
    }
  return null;
}

/**
 * When the inviter's 10 falls due: the first settlement at or after the
 * activation plus a week. Never sooner than a week, and at a settlement, so the
 * town day it is paid on is always at least seven after the activation's
 * (stamp-mint.mjs § INVITE holds that floor at verify).
 */
export const inviterDueAt = (activatedAt) => settlementAtOrAfter(new Date(new Date(activatedAt).getTime() + INVITE_HOLD_MS));

/**
 * The 30-day trigger for one invited household: its first delivered letter,
 * its first home, and what they make it. `status` is activated (the first of
 * the two came within 30 days of the invitation), late (it came after), waiting
 * (neither yet, the 30 days still running) or lapsed (neither, and the 30 days
 * are over).
 */
export function activationOf({ at, letter = null, home = null, now = new Date() }) {
  const by = new Date(new Date(at).getTime() + INVITE_WITHIN_MS).toISOString();
  const firstLetter = iso(letter), firstHome = iso(home);
  const first = [firstLetter, firstHome].filter(Boolean).sort()[0] ?? null;
  const status = first ? (first <= by ? "activated" : "late") : (iso(now) > by ? "lapsed" : "waiting");
  return { first_letter: firstLetter, first_home: firstHome, by, status,
    ...(first ? { at: first, through: first === firstLetter ? "first letter" : "first home" } : {}) };
}

/** A house's slug now, from any name it has carried: `houses` is `[{ slug, formerly }]`. */
export function currentSlugOf(houses) {
  const now = new Map();
  for (const h of houses) {
    now.set(h.slug, h.slug);
    for (const f of h.formerly ?? []) if (!now.has(f)) now.set(f, h.slug);
  }
  return (slug) => now.get(slug) ?? slug;
}

/**
 * What the town's ledger already says, read with the town's own classifier
 * (`engine`, the clone's stamp-mint.mjs) and its own one-house-two-spellings
 * map (`canon`, engine.houseCanonOf over the store's registry). Answers, by the
 * invited and inviting households' slugs:
 *   welcomes      invited slug -> { handle, key, date }    its welcome line
 *   invitedPaid   invited slug -> { handle, date }         its 5 more
 *   inviterPaid   invited slug -> { handle, date, inviter } its inviter's 10
 *   paidInMonth   "<inviter slug>|<YYYY-MM>" -> n          the cap, by the month paid
 */
export function ledgerFacts(entries, { engine, canon = (k) => k }) {
  const slugOf = (key) => { const c = canon(key); return c?.startsWith("hh:") ? c.slice(3) : null; };
  const welcomes = new Map(), invitedPaid = new Map(), inviterPaid = new Map(), paidInMonth = new Map();
  for (const e of entries) {
    const c = engine.classifyEntry(e.canonical);
    if (c.kind === "welcome") {
      const slug = slugOf(c.household);
      if (slug && !welcomes.has(slug)) welcomes.set(slug, { handle: c.handle, key: c.household, date: c.date });
    }
    if (c.kind !== "invite") continue;
    const invited = slugOf(c.invited), inviter = slugOf(c.inviter);
    if (!invited) continue;
    if (c.side === "invited") invitedPaid.set(invited, { handle: c.handle, date: c.date });
    else {
      inviterPaid.set(invited, { handle: c.handle, date: c.date, inviter });
      const k = `${inviter}|${c.date.slice(0, 7)}`;
      paidInMonth.set(k, (paidInMonth.get(k) ?? 0) + 1);
    }
  }
  return { welcomes, invitedPaid, inviterPaid, paidInMonth };
}

/** Who in the inviting house is paid: the resident the join named when it is one of that house's, else the house's first. */
export function inviterRecipient(named, residents = []) {
  const n = String(named ?? "").replace(/^hh:/, "");
  return residents.includes(n) ? n : (residents[0] ?? null);
}

/**
 * THE PLAN. One row per invitation, oldest invitation first, each side with
 * its status and, where something is owed now, the line the town's verb is
 * asked for. Inputs:
 *   rows    the invited households: [{ slug, name, residents, invited_by: { by, named, at } }]
 *   houses  every household: [{ slug, residents, formerly }] (the inviter's
 *           residents, and renamed houses)
 *   facts   { letters, homes, ashore }: maps of the invited slug to its first
 *           delivered letter, its first home, and when it came ashore
 *   ledger  ledgerFacts(...)
 *   holds   invited slug -> { state, moves } (invite-hold-store.mjs)
 *   now     the instant the plan is for; the line's date is its town day
 *
 * THE INVITED SIDE is owed once its house holds a welcome line, to that
 * line's own recipient, and has no 5-more line yet. No wait, no hold, no cap.
 * THE INVITER SIDE is owed once the house activated within 30 days, the week
 * has passed to a settlement, no hold stands on it (held waits; cancelled is
 * never paid), no line pays it yet, and the inviting house has paid fewer than
 * 10 this town month. Over the cap, it waits for a month with room, oldest due
 * first (Rivet's 10-29 reading of "Month paid": "enforce the cap in the payment
 * month, with deterministic oldest-eligible ordering").
 * FOUNDERS: an invitation into the founders' household or the town's own pays
 * neither side.
 */
export function planInvitePay({ rows = [], houses = [], facts = {}, ledger, holds = new Map(), now = new Date() }) {
  const current = currentSlugOf(houses);
  const residentsOf = new Map(houses.map((h) => [h.slug, h.residents ?? []]));
  const payDay = townDay(now);
  const month = payDay.slice(0, 7);
  const nowIso = iso(now);
  const plan = rows
    .filter((r) => r.invited_by?.by && r.invited_by?.at)
    .map((r) => ({ ...r, at: iso(r.invited_by.at) }))
    .sort((a, b) => a.at.localeCompare(b.at) || a.slug.localeCompare(b.slug))
    .map((r) => {
      const inviter = current(r.invited_by.by);
      const founders = FOUNDERS.includes(inviter);
      const welcome = ledger.welcomes.get(r.slug) ?? null;
      const act = activationOf({ at: r.at, letter: facts.letters?.get(r.slug) ?? null, home: facts.homes?.get(r.slug) ?? null, now });
      const hold = holds.get(r.slug) ?? null;
      const row = {
        invitation: inviteId(r.slug), household: r.slug, name: r.name ?? null, invited_by: inviter,
        ...(inviter !== r.invited_by.by ? { invited_by_was: r.invited_by.by } : {}),
        named: r.invited_by.named ?? null, at: r.at,
        ashore: facts.ashore?.get(r.slug) ?? null,
        welcome: welcome ? { paid: welcome.date, to: welcome.handle } : null,
        activation: act,
        hold: hold ? { state: hold.state, moves: hold.moves ?? [] } : null,
        ...(founders ? { refused: "founders" } : {}),
      };
      // ── the invited side ──
      const paidInvited = ledger.invitedPaid.get(r.slug);
      row.invited_side = founders ? { status: "refused", why: "founders" }
        : paidInvited ? { status: "paid", to: paidInvited.handle, on: paidInvited.date }
          : welcome ? { status: "owed", to: welcome.handle, amount: 5, line: { side: "invited", handle: welcome.handle, invited: `hh:${r.slug}`, inviter: `hh:${inviter}` } }
            : { status: "waiting", why: "its welcome bundle is not on the ledger yet" };
      // ── the inviter side, before the cap ──
      const paidInviter = ledger.inviterPaid.get(r.slug);
      const due = act.status === "activated" ? inviterDueAt(act.at) : null;
      row.inviter_side = founders ? { status: "refused", why: "founders" }
        : paidInviter ? { status: "paid", to: paidInviter.handle, on: paidInviter.date }
          : act.status !== "activated" ? { status: act.status }
            : hold?.state === "cancelled" ? { status: "cancelled", due }
              : hold?.state === "held" ? { status: "held", due }
                : nowIso < due ? { status: "in-week", due }
                  : { status: "due", due };
      return row;
    });
  // ── the cap: what is due pays in due order while the inviting house has room this month ──
  const placed = new Map();
  for (const row of plan.filter((p) => p.inviter_side.status === "due").sort((a, b) => a.inviter_side.due.localeCompare(b.inviter_side.due) || a.household.localeCompare(b.household))) {
    const k = `${row.invited_by}|${month}`;
    const before = (ledger.paidInMonth.get(k) ?? 0) + (placed.get(k) ?? 0);
    if (before >= INVITE_CAP_PER_MONTH) { row.inviter_side = { status: "over-cap", due: row.inviter_side.due, month, paid_this_month: before }; continue; }
    placed.set(k, (placed.get(k) ?? 0) + 1);
    const to = inviterRecipient(row.named, residentsOf.get(row.invited_by) ?? []);
    row.inviter_side = to
      ? { status: "owed", due: row.inviter_side.due, to, amount: 10, nth_this_month: before + 1,
        line: { side: "inviter", handle: to, invited: `hh:${row.household}`, inviter: `hh:${row.invited_by}`, activated: townDay(row.activation.at) } }
      : { status: "waiting", due: row.inviter_side.due, why: `${row.invited_by} has no resident on record to receive it` };
  }
  return { at: nowIso, pay_day: payDay, month, invitations: plan };
}

/** The lines a plan asks the town's verb for, invited sides first (each follows its welcome), then inviter sides in due order. */
export function owedLines(plan) {
  const inv = plan.invitations.filter((p) => p.invited_side.status === "owed").map((p) => p.invited_side.line);
  const inr = plan.invitations.filter((p) => p.inviter_side.status === "owed")
    .sort((a, b) => a.inviter_side.due.localeCompare(b.inviter_side.due) || a.household.localeCompare(b.household))
    .map((p) => p.inviter_side.line);
  return [...inv, ...inr];
}

// ── the hold's moves (POS-816: Little Bird's answers, 2026-10-30, as ruled 2026-11-02 23:56) ──
export const HOLD_HELD = "held";
export const HOLD_LIFTED = "lifted";
export const HOLD_CANCELLED = "cancelled";
export const HOLD_STATES = Object.freeze([HOLD_HELD, HOLD_LIFTED, HOLD_CANCELLED]);
export const HOLD_NOTE_MAX = 600;
// held waits until it is lifted; lifted pays when due and may be held again in
// the week; cancelled is never paid and is final. "open" is no hold at all.
const HOLD_FROM = Object.freeze({ [HOLD_HELD]: ["open", HOLD_LIFTED], [HOLD_LIFTED]: [HOLD_HELD], [HOLD_CANCELLED]: ["open", HOLD_HELD, HOLD_LIFTED] });

/** A hold move, judged: `{ to, note }`, or a refusal (`{ code, defect, hint }`) naming why. */
export function judgeHoldMove(fields = {}, current = "open") {
  const to = String(fields?.to ?? "").trim();
  const note = String(fields?.note ?? "").trim();
  if (!HOLD_STATES.includes(to))
    return { code: 422, defect: `to: "${to}" is not a move of an invitation's payout`, hint: `to: "held" (it waits until lifted), "lifted" (it pays when due) or "cancelled" (it is never paid), each with a note saying why`, field: "to" };
  if (!note) return { code: 422, defect: "a hold, a lift and a cancel each carry a reason", hint: "note: why, in a sentence (at most 600 characters); it is kept with the move", field: "note" };
  if (note.length > HOLD_NOTE_MAX) return { code: 422, defect: `the note is ${note.length} characters, over ${HOLD_NOTE_MAX}`, hint: "say it in fewer words; it is kept whole", field: "note" };
  if (!HOLD_FROM[to].includes(current))
    return { code: 409, defect: current === HOLD_CANCELLED ? "this payout was cancelled, and a cancelled payout is final" : `this payout is ${current === "open" ? "not held" : current}, so it cannot move to ${to}`,
      hint: `from ${current}: ${Object.entries(HOLD_FROM).filter(([, from]) => from.includes(current)).map(([t]) => t).join(" or ") || "no move"}` };
  return { to, note };
}
