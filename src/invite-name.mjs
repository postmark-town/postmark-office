// invite-name.mjs — a household names who invited it, after it joined (POS-947).
//
// RULED (Darko 2026-11-07 23:05 EST, POS-816/c): "yeah i think we can actually
// open to any amount of time for the backfill for referrals, and we just check
// basic logic preventing loops (which would be impossible)"; "oh but let's say
// 10 max for the backfill". 2026-11-08 09:02 EST, POS-947: the backfill's terms
// are taught to the town's judge too, and "joined before" is the order the town
// recorded households (`households.ord`). Asked for by Little Bird: households
// that joined without naming anyone saw their friends' invitations pay.
//
// `household { do: "invited-by", args: { invited_by } }`. The credit is the
// join's own (`households.invited_by`, written by the store's one NULL-only
// writer) with `backfill: true`, and `at` the instant of this naming. The invite
// pass pays both halves from it as it pays a join's (src/invite-pay.mjs), and
// the town's judge holds the late terms (tools/stamp-mint.mjs § judgeInviteLine).
//
// THE SHAPE IS `src/join-bind.mjs`'s (Wright 2026-11-08 04:42): the critical
// section runs as a child under the town lock (`invite-name-exec.mjs`), after a
// pull; it re-reads the record, judges, writes the row, prints the registry with
// `collectingDrain`, and lands the printed files in ONE `penCommit`.
//
// WHOLE OR NOTHING. A naming that cannot reach the town's printout (the drain
// refuses, or the commit cannot land) takes its row back and refuses, so the
// store and the public registry never disagree about who invited a house, and
// asking again is safe. The invite pass pays only inside the same town flock,
// so nothing can have paid on a credit taken back.

import { loadRegistryRows, setHouseholdInvitedBy, unsetUnpublishedInvitedBy } from "./registry-store.mjs";
import { registryFromRows } from "./registry-rows.mjs";
import { judgeLateInvite, lateInvitedBy, lateInviteRefusal, lateInviteReceipt, LATE_INVITE_ACT } from "./arrival-invite.mjs";
import { meepLawAtOffice } from "./fund-holder.mjs";
import { collectingDrain, REFUSALS } from "./ceremony.mjs";
import { penCommit, landOrRefuse } from "./write.mjs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const refusal = (code, defect, hint, field = null) => ({ error: { code, field, defect, hint } });

const NOT_PRINTED = (why) => refusal(503, "the town's registry could not be printed, so nothing was recorded",
  `${why} — your household's record is as it was; ask again shortly`);

/**
 * Which house is naming, from the verified key alone: `handle` when given (one
 * of the key's residents), else the one house the key's residents keep. A key
 * whose residents keep two houses is asked which. Answers `{ slug, handle }` or
 * `{ error }`. Body text never decides whose record is written.
 */
export function namingHouse(registry, handles = [], handle = null) {
  const held = [...(handles ?? [])].map(String);
  const houses = registry?.households ?? {};
  const homeOf = (h) => Object.keys(houses).find((s) => (houses[s]?.residents ?? []).map(String).includes(h)) ?? null;
  const asked = String(handle ?? "").trim();
  if (asked) {
    if (!held.includes(asked))
      return refusal(403, `"${asked}" is not one of your residents`, `this key acts for: ${held.join(", ") || "nobody"}`, "handle");
    const slug = homeOf(asked);
    return slug ? { slug, handle: asked } : refusal(403, `"${asked}" keeps no household on the town's record`, "a household names who invited it; join one first", "handle");
  }
  const homes = [...new Set(held.map(homeOf).filter(Boolean))];
  if (!homes.length) return refusal(403, "this key speaks for no household on the town's record", "a household names who invited it; join one first", "handle");
  if (homes.length > 1)
    return refusal(422, "which of your residents?", `your key acts for ${held.join(", ")}, in more than one household — name one with handle:`, "handle");
  return { slug: homes[0], handle: held.find((h) => homeOf(h) === homes[0]) };
}

/**
 * The critical section: run under the town lock, after the clone is pulled.
 * `key` is `{ handles }` from the verified sign-in. Answers what landed, or
 * `{ error }`; a refusal writes nothing.
 */
export async function nameInviterUnderLock({ args = {}, key = {}, clone, env = process.env, now = () => new Date(),
  meepLaw = meepLawAtOffice, write = setHouseholdInvitedBy, unset = unsetUnpublishedInvitedBy, commit = penCommit } = {}) {
  const rows = await loadRegistryRows(env);
  if (rows === null) return refusal(REFUSALS.NO_RECORD.code, REFUSALS.NO_RECORD.defect, REFUSALS.NO_RECORD.hint);
  const registry = registryFromRows(rows);
  const own = namingHouse(registry, key.handles, args.handle);
  if (own.error) return own;

  // THE ORDER THE TOWN RECORDED HOUSEHOLDS (POS-947/b): `ord`, never `since`.
  const ords = new Map(rows.households.map((r) => [r.slug, r.ord]));
  const current = rows.households.find((r) => r.slug === own.slug)?.invited_by ?? null;
  // THE LAW FAILS CLOSED: unread, it is null, and the judge refuses (`law`).
  let isMeep = null;
  try { isMeep = await meepLaw(clone, { strict: true }); }
  catch (e) { console.error(`[invite-name] ${own.slug}: the meep law is unreadable — ${String(e?.message ?? e).slice(0, 200)}`); }

  const judged = judgeLateInvite(args, { registry, own, isMeep, ordOf: (s) => ords.get(s) ?? null, current });
  if (judged.refused) {
    const r = lateInviteRefusal(judged);
    return refusal(r.code, r.defect, r.hint, r.field);
  }

  const invitedBy = lateInvitedBy(judged, now());
  const written = await write({ slug: own.slug, invitedBy }, env);
  if (written === null) return refusal(REFUSALS.NO_RECORD.code, REFUSALS.NO_RECORD.defect, REFUSALS.NO_RECORD.hint);
  // NAMED ONCE: another naming landed between the read above and this write.
  if (!written.slug) {
    const r = lateInviteRefusal({ refused: "already", named: judged.named, by: "named a moment ago" });
    return refusal(r.code, r.defect, r.hint, r.field);
  }

  const takeBack = async (answer) => { await unset({ slug: own.slug, invitedBy }, env); return answer; };
  const { drain, paths } = collectingDrain({ clone, env });
  let drained;
  try { drained = await drain(); }
  catch (e) { await unset({ slug: own.slug, invitedBy }, env); throw e; }
  if (!drained?.ran) return takeBack(NOT_PRINTED(drained?.refused ?? drained?.skipped ?? "the drain did not run"));
  if (!paths.length) return takeBack(NOT_PRINTED("the printed registry did not change"));

  let sha;
  try {
    sha = landOrRefuse(() => commit(clone, paths, `household: ${own.slug} names who invited it · ${judged.by} (via postmark-office, ${LATE_INVITE_ACT})`));
  } catch (e) { await unset({ slug: own.slug, invitedBy }, env); throw e; }
  if (sha?.error) return takeBack({ error: { field: null, ...sha.error } });

  return { household: own.slug, invited_by: invitedBy, commit: sha, invite: lateInviteReceipt(judged) };
}

const EXEC = join(dirname(fileURLToPath(import.meta.url)), "invite-name-exec.mjs");

/** The default runner: the exec, as a child under the town lock. */
export async function runNameInviterUnderTownLock(payload, { clone }) {
  const { runLockedExec } = await import("./town-lock.mjs");
  return runLockedExec(EXEC, payload, { clone, tripped: "the naming tripped", keepField: true });
}

/**
 * The door's half: the act is the verified key's, never the body's. Throws the
 * refusal (the household door's catch speaks it), or answers what landed.
 */
export async function nameInviterViaOffice(clone, fields = {}, key, { run = runNameInviterUnderTownLock } = {}) {
  if (!clone) throw Object.assign(new Error("not-yet-open"), { code: 503, defect: "not-yet-open", hint: "the office has no town clone configured; nothing was recorded" });
  const handles = [...(key?.handles ?? [])];
  if (!handles.length)
    throw Object.assign(new Error("no resident"), { code: 403, defect: "this key speaks for no resident", hint: "a household names who invited it, signed in as one of its residents" });
  return run({ args: { invited_by: fields.invited_by, ...(fields.handle != null ? { handle: fields.handle } : {}) }, key: { handles } }, { clone });
}
