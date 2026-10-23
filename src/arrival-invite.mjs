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
/** The town's own house: its stamps are the town's, never a referral's. */
export const TOWN_HOUSE = "the-town";
/**
 * THE FOUNDERS NEVER EARN (POS-576/e, Darko 2026-10-22 22:07): the founders'
 * household and the town's own. An invitation that resolves into either is
 * refused with its own reason and pays neither side: the invitee joins and
 * settles as anyone does, on the ordinary bundle. (the-town is also the town's
 * own name, refused as such before it is ever resolved.)
 */
export const FOUNDERS = Object.freeze(["starforge", TOWN_HOUSE]);

export const INVITE_GROUP = Object.freeze({
  "x-group": "invite",
  "x-group-title": "Who invited you",
  "x-group-hint": "Optional, and public: the name you give here is printed on your household's record as the one who brought you.",
});
export const INVITE_FIELDS = Object.freeze({
  invited_by: { type: "string", title: "Who invited you?", ...INVITE_GROUP, "x-multiline": false, maxLength: INVITE_MAX, examples: ["wright"],
    description: "Optional: the handle of the resident who invited you, or hh:<slug> for a household (an invitation link fills it in). This is a public credit: it shows on your household's record. When your household settles you get 10 stamps instead of 5, and they get 10 when you write your first letter or claim your home parcel within 30 days. Your own household, a meep or a name the town doesn't know records nothing, and your join goes through either way." },
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
  if (named === TOWN_HOUSE || house === TOWN_HOUSE || isReservedHandle(named)) return refuse("town");
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
  if (FOUNDERS.includes(owner)) return { refused: "founders", named, by: owner };
  return { by: owner, named };
}

/**
 * Keep the credit on the new house's row. Best-effort by contract: never
 * throws, answers what happened. `write` is the store's one writer.
 */
export async function recordInvite({ slug, judged, at = new Date(), write = setHouseholdInvitedBy, env = process.env, log = console.error } = {}) {
  // A founders' invite is a miss with its own reason, logged like the others (POS-576/e): nothing is written.
  if (judged?.refused === "founders") {
    log(`[arrival-invite] ${slug}: not kept (by ${judged.by}, named ${judged.named}, at ${at instanceof Date ? at.toISOString() : at}) — the founders never earn invitation stamps (POS-576/e)`);
    return { kept: false, why: "founders" };
  }
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
  meep: "names a meep, and meeps can't be credited for invitations",
  unknown: "names nobody the town knows: give a resident's handle, or hh:<slug> for a household",
  law: "could not be judged: the town's meep law is unreadable right now, so no invitation is credited",
  founders: "names the founders' household, which never earns invitation stamps, so this invitation pays neither side",
});

/** The one sentence the declaration's answer carries about the invite, or null. */
export function inviteReceipt(judged, outcome) {
  if (!judged) return null;
  if (judged.refused) return `Not recorded: "${judged.named}" ${REFUSED[judged.refused]}. Your join is unaffected.`;
  if (!outcome?.kept) return `Not recorded this time: "${judged.named}" could not be written to your household's record. Your join is unaffected.`;
  const plain = judged.named === judged.by || judged.named === `${HOUSE_PREFIX}${judged.by}`;
  return `Recorded publicly: invited by ${judged.by}${plain ? "" : ` (${judged.named})`}.`;
}
