// arrival-invite.mjs — "who invited you?" (POS-576), a public credit.
//
// Ruled by Darko, 2026-10-11 09:53 (the referral quest) and 2026-10-22 20:40
// (the invitation link, `postmark.town/join/?invite=<handle>`). The join
// carries one optional field, `invited_by`: the handle of the resident or
// household that brought this one here. It is PUBLIC, unlike "where did you
// hear" (arrival-heard.mjs), and the form says so: the credit is printed on
// the new household's row in the town's tools/households.json.
//
// ── IT NEVER REFUSES A JOIN ─────────────────────────────────────────────────
//
// A bad invite records nothing and the join goes through unchanged; the
// answer says why in one sentence. Refused by name:
//   · your own household (the house this join founds, or its first handle);
//   · a meep (the town's own meep law, read from its stamp ledger);
//   · the town's own house and names (the-town, office, postmaster, ferry);
//   · a name the town does not know.
// Naming a resident credits their HOUSEHOLD, because a household is what
// joins and what is paid.
//
// ── A HANDLE FIRST; `hh:<slug>` NAMES A HOUSE ─────────────────────────────
//
// The ruling's field takes a handle, and a house's slug can be spelled the same
// as another house's resident (review of #751, B1: `mari` is Starforge's
// resident and ev-attractor's house; `moth` is a Rookery resident and
// Mothlingxx's house). So a bare name is a RESIDENT'S HANDLE when the roll has
// one, and only otherwise a house's slug. `hh:<slug>` is the unambiguous
// spelling of a house, the town's own house key.
//
// ── THE MEEP LAW FAILS CLOSED ───────────────────────────────────────────────
//
// A credit is permanent and public. When the town's meep law cannot be read,
// nothing is credited ("the meep law is unreadable"), never "nobody is a meep".
//
// ── THE WRITE ───────────────────────────────────────────────────────────────
//
// `declare` and the berth co-sign both reach `src/declare-exec.mjs`, which
// judges the invite against the registers it re-read under the town flock and
// calls `recordInvite` after the house's row is minted and BEFORE the drain,
// so the credit lands in the same commit as the household. `begin` parks the
// field with the declaration (household-apex.mjs § doBegin); it is public, so
// it rides the parked row like `from_town` does.
//
// ── THE PAYING IS NOT HERE ──────────────────────────────────────────────────
//
// 10 stamps to the invited household at settle, 10 to the inviter when the
// new household is real (its first letter or a home within 30 days), at most
// 10 paid invitations per inviting household a month. This weekend Wright
// mints by hand at each settlement, from `tools/invites.mjs`; nothing here
// mints.

import { setHouseholdInvitedBy } from "./registry-store.mjs";
import { isReservedHandle } from "./residency.mjs";

export const INVITE_MAX = 64;
/**
 * The town's own house: its stamps are the town's, never a referral's. An
 * invitation that resolves into it is refused as "town" and pays neither side:
 * the invitee joins and settles as anyone does, on the ordinary bundle. A
 * refusal carries `named`, NEVER `by` (the follow-up review of #751): `by` is
 * the field a credit pays, so a caller that read judged.by without checking
 * `refused` could pay it.
 *
 * THE FOUNDERS PAY LIKE ANY OTHER HOUSEHOLD (POS-816/d, Darko 2026-11-03 09:31
 * EDT: "this should pay like any other under the new NOMOS"). Until 2026-11-03
 * this module held FOUNDERS = ["starforge", "the-town"] (POS-576/e, 2026-10-22
 * 22:07, "No, never"): an invitation naming the Starforge household was refused
 * with its own reason and paid neither side. That half is repealed; the town's
 * own house stays out, and so do meeps (POS-655, "meeps are credited, not
 * paid"), who live in both houses: a meep named by handle is refused as "meep"
 * below, and a house named whole pays a resident who is not one
 * (invite-pay.mjs § inviterRecipient).
 */
export const TOWN_HOUSE = "the-town";

export const INVITE_GROUP = Object.freeze({
  "x-group": "invite",
  "x-group-title": "Who invited you",
  "x-group-hint": "Optional, and public: the name you give here is printed on your household's record as the one who brought you.",
});
export const INVITE_FIELDS = Object.freeze({
  invited_by: { type: "string", title: "Who invited you?", ...INVITE_GROUP, "x-multiline": false, maxLength: INVITE_MAX, examples: ["wright"],
    description: "Optional: the handle of the resident who invited you, or hh:<slug> for a household (an invitation link fills it in). This is a public credit: it shows on your household's record. You get 10 stamps instead of 5 when your household settles. Theirs gets 10 a week after your first letter or home (within 30 days), unless the town holds it for review. Your own household, the town's own household, a meep or a name the town doesn't know records nothing, and your join goes through either way." },
});
export const INVITE_FIELD_NAMES = Object.freeze(Object.keys(INVITE_FIELDS));

/** The prefix that names a house rather than a resident (the town's own house key). */
export const HOUSE_PREFIX = "hh:";

/** The name a join carries, normalised (trimmed, one leading @ dropped, lowercased), or null. */
export function inviteNamed(args = {}) {
  const raw = args?.invited_by;
  if (raw == null) return null;
  const named = String(raw).trim().replace(/^@/, "").toLowerCase();
  return named ? [...named].slice(0, INVITE_MAX).join("") : null;
}

/**
 * Whose house the invite credits, judged against the registers. `registry` is
 * `{ households: { <slug>: { residents } } }`; `own` is the founding house's
 * `{ slug, handle }`; `isMeep(handle)` is the town's meep law, or null when it
 * could not be read (which refuses: the law fails closed).
 *
 * Answers `{ by, named }` to credit, `{ refused, named }` to record nothing,
 * or null when no invite was given.
 */
export function judgeInvite(args, { registry, own = {}, isMeep } = {}) {
  const named = inviteNamed(args);
  if (!named) return null;
  const refuse = (refused) => ({ refused, named });
  const house = named.startsWith(HOUSE_PREFIX) ? named.slice(HOUSE_PREFIX.length) : null;
  if (named === own.handle || named === own.slug || (house != null && house === own.slug)) return refuse("own");
  if (named === TOWN_HOUSE || house === TOWN_HOUSE) return refuse("town");
  if (isReservedHandle(named)) return refuse("town");
  if (typeof isMeep !== "function") return refuse("law");
  const houses = registry?.households ?? {};
  const residentOf = (h) => Object.keys(houses).find((slug) => (houses[slug]?.residents ?? []).map(String).includes(h)) ?? null;
  let owner;
  if (house != null) owner = Object.hasOwn(houses, house) ? house : null;
  else {
    const home = residentOf(named);
    if (home != null) {
      if (isMeep(named)) return refuse("meep");
      owner = home;
    } else owner = Object.hasOwn(houses, named) ? named : null;
  }
  if (!owner) return refuse("unknown");
  if (owner === own.slug) return refuse("own");
  if (owner === TOWN_HOUSE) return refuse("town");
  return { by: owner, named };
}

/**
 * Keep the credit on the new house's row. Best-effort by contract: never
 * throws, answers what happened. `write` is the store's one writer.
 */
export async function recordInvite({ slug, judged, at = new Date(), write = setHouseholdInvitedBy, env = process.env, log = console.error } = {}) {
  if (!judged?.by) return { kept: false };
  const invitedBy = { by: judged.by, named: judged.named, at: at instanceof Date ? at.toISOString() : at };
  try {
    const r = await write({ slug, invitedBy }, env);
    if (r === null) {
      log(`[arrival-invite] ${slug}: not kept (by ${invitedBy.by}, named ${invitedBy.named}, at ${invitedBy.at}) — the office is not pointed at the record`);
      return { kept: false, why: "no record" };
    }
    return { kept: r.slug === slug, ...(r.slug === slug ? { invited_by: invitedBy } : {}) };
  } catch (e) {
    log(`[arrival-invite] ${slug}: not kept (by ${invitedBy.by}, named ${invitedBy.named}, at ${invitedBy.at}) — ${String(e?.message ?? e).slice(0, 200)}`);
    return { kept: false, why: "the store refused" };
  }
}

const REFUSED = Object.freeze({
  own: "names your own household",
  town: "names the town's own house, which is not credited for invitations",
  unknown: "names nobody the town knows: give a resident's handle, or hh:<slug> for a household",
  law: "could not be judged: the town's meep law is unreadable right now, so no invitation is credited",
});

// ── NAMED AFTER JOINING (POS-947) ───────────────────────────────────────────
//
// RULED (Darko 2026-11-07 23:05 EST, POS-816/c): "yeah i think we can actually
// open to any amount of time for the backfill for referrals, and we just check
// basic logic preventing loops (which would be impossible)"; and 2026-11-08
// 09:02 EST, POS-947/b: "joined before" is "The order the town recorded
// households", `households.ord`, never the `since` dates (not in order).
//
// A household that joined without naming anyone names its inviter later with
// `household { do: "invited-by", args: { invited_by } }`, once, with no window
// (src/invite-name.mjs writes it). Unlike the join, this act IS the naming, so a
// bad name refuses it by name and writes nothing. Judged as the join judges
// (judgeInvite: own, town, meep, unknown, an unreadable law), and also:
//   · already: its record names an inviter already; named once, never changed;
//   · younger: the house named was recorded after this one (or is it), so a loop
//     can never close.
// The credit is the join's own shape plus `backfill: true`, and its `at` is the
// naming: the town's judge counts its pay clock from the house's join day and
// holds the 10-in-all cap on it (the town's stamp-mint.mjs § INVITE_BACKFILL_CAP).
export const LATE_INVITE_ACT = "invited-by";

/**
 * Judge a naming made after joining. `own` is `{ slug, handle }`, the naming
 * house and its acting resident; `ordOf(slug)` is the house's place in the
 * order the town recorded households (`households.ord`), or null; `current` is
 * the house's own `invited_by` now. Answers `{ by, named }`, or `{ refused,
 * named, by? }` naming why.
 */
export function judgeLateInvite(args, { registry, own = {}, isMeep, ordOf, current = null } = {}) {
  const named = inviteNamed(args);
  if (!named) return { refused: "none", named: null };
  if (current?.by) return { refused: "already", named, by: current.by };
  const judged = judgeInvite(args, { registry, own, isMeep });
  if (judged.refused) return judged;
  const theirs = ordOf(judged.by), mine = ordOf(own.slug);
  if (!Number.isInteger(theirs) || !Number.isInteger(mine) || theirs >= mine) return { refused: "younger", named, by: judged.by };
  return judged;
}

/**
 * Could this house lawfully name anyone at all? (Wright 2026-11-08 19:56Z: "suppress the offer when no household could
 * lawfully be named", by the EXISTING rule, "A test each way".) Asks `judgeLateInvite` itself, once per house as
 * hh:<slug>, so the offer and the act can never disagree: true at the first house it would credit. A house's own
 * slug is never a meep's handle, so the meep law plays no part here; the act still judges it anew.
 */
export function anyLawfulInviter({ registry, own = {}, ordOf, current = null } = {}) {
  if (current?.by) return false;
  return Object.keys(registry?.households ?? {}).some((slug) =>
    !judgeLateInvite({ invited_by: `${HOUSE_PREFIX}${slug}` }, { registry, own, isMeep: () => false, ordOf, current }).refused);
}

/** The credit a naming after joining writes: the join's shape, `at` the naming, and `backfill`. */
export const lateInvitedBy = (judged, at = new Date()) =>
  ({ by: judged.by, named: judged.named, at: at instanceof Date ? at.toISOString() : at, backfill: true });

const LATE_REFUSED = Object.freeze({
  none: [422, "which household invited you?", "invited_by: the handle of the resident who invited you, or hh:<slug> for a household"],
  already: [409, "your household's record already names who invited it", "an invitation is named once and never changed"],
  younger: [409, "can name only a household that joined before yours", "the town's order of recording households decides it, so no two households can name each other"],
  meep: [422, "is one of the town's meeps, and meeps can't be named", "name a resident who isn't a meep, or their household as hh:<slug>"],
});

/** A naming's refusal, `{ code, defect, hint, field }`, in the join's words where they apply. */
export function lateInviteRefusal(judged) {
  const r = judged.refused;
  if (r === "none") return { code: LATE_REFUSED.none[0], defect: LATE_REFUSED.none[1], hint: LATE_REFUSED.none[2], field: "invited_by" };
  if (r === "already") return { code: 409, defect: `${LATE_REFUSED.already[1]} (${judged.by})`, hint: LATE_REFUSED.already[2], field: "invited_by" };
  if (r === "younger") return { code: 409, defect: `"${judged.named}" is ${judged.by}, and you ${LATE_REFUSED.younger[1]}`, hint: LATE_REFUSED.younger[2], field: "invited_by" };
  if (r === "meep") return { code: 422, defect: `"${judged.named}" ${LATE_REFUSED.meep[1]}`, hint: LATE_REFUSED.meep[2], field: "invited_by" };
  if (r === "law") return { code: 503, defect: `"${judged.named}" ${REFUSED.law}`, hint: "nothing was written; ask again shortly", field: "invited_by" };
  return { code: r === "unknown" ? 404 : 422, defect: `"${judged.named}" ${REFUSED[r]}`, hint: "nothing was written", field: "invited_by" };
}

/** The answer's sentence for a naming that landed. */
export const lateInviteReceipt = (judged) => {
  const plain = judged.named === judged.by || judged.named === `${HOUSE_PREFIX}${judged.by}`;
  return `Recorded publicly: invited by ${judged.by}${plain ? "" : ` (${judged.named})`}, named after you joined. `
    + "Your household gets its 5 more once its welcome is on the ledger. Theirs gets 10 a week after this naming, "
    + "if your household sent its first letter or claimed its home within 30 days of joining, unless the town holds it for review.";
};

/**
 * The one sentence the declaration's answer carries about the invite, or null.
 *
 * A MEEP INVITER (POS-816/d, Darko 2026-11-03 09:31 EDT; the line is the
 * founders' option A, in the town's meeps' words): meeps earn no stamps
 * (POS-655), so the invitation is not recorded and the newcomer keeps the
 * standard 5. Until 2026-11-03 this said `Not recorded: "<handle>" names a
 * meep, and meeps can't be credited for invitations.`, and the founders' household
 * had its own line: `names the founders' household, which never earns invitation
 * stamps, so this invitation pays neither side`.
 */
export function inviteReceipt(judged, outcome) {
  if (!judged) return null;
  if (judged.refused === "meep") return `"${judged.named}" is one of the town's meeps, so this invitation doesn't earn stamps: you get the standard 5. Your join is unaffected.`;
  if (judged.refused) return `Not recorded: "${judged.named}" ${REFUSED[judged.refused]}. Your join is unaffected.`;
  if (!outcome?.kept) return `Not recorded this time: "${judged.named}" could not be written to your household's record. Your join is unaffected.`;
  const plain = judged.named === judged.by || judged.named === `${HOUSE_PREFIX}${judged.by}`;
  return `Recorded publicly: invited by ${judged.by}${plain ? "" : ` (${judged.named})`}.`;
}
