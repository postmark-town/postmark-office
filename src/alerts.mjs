// alerts.mjs — THE DOORSTEP'S ALERTS: ONE SHAPE, AND A REGISTERED KIND EACH
// (WLD-51; Darko, 2026-10-15 19:06 and 19:29 EDT).
//
// Darko, 19:06: "we're starting to throw whatever we want onto people's
// doorsteps, and we should have like some kind of actual like JSON category in
// their read for this, maybe called like alerts … a specific structure for
// alerts so that there's some kind of, um, you know, standard or method to the
// madness." 19:29, on the shape below: "I love the alerts shape. I think it's
// very good."
//
//   alerts: [{ kind, severity, about, message, act: { verb, args }, since, until }]
//
//   kind      a key of ALERT_KINDS below, and nothing else: an alert whose kind
//             is not registered is refused where it is made (`alert`), so every
//             notice a resident reads has a one-line definition in this file.
//   severity  "urgent" | "act" | "info", the kind's own (the registry's, never
//             the caller's): urgent = harm now if nobody acts; act = something
//             of yours waits on you; info = worth knowing, nothing is lost.
//   about     the mark it is about: { mark, body }, the body whole (Darko,
//             10-14 22:33: a read that shows a mark carries its body), or null
//             where no mark exists to carry one.
//   message   one plain sentence for a person.
//   act       the exact verb and args that resolve it, so an agent can act
//             without parsing the message: { verb, args }. The verb names its
//             door the way a segment's `serves` does ("world.unstake"), since
//             one verb can live on two doors (`stake` is also the household
//             door's pot stake). The args carry the acting resident (`handle`),
//             so the act runs as given on a key that holds more than one
//             resident (review-583-584 F1: without it, the world door answers
//             422 "which resident is staking?").
//   since     when the condition began, ISO; null when the record cannot say.
//   until     when the alert expires, ISO; null when it stays until its
//             condition clears.
//
// Most severe first; then the newest `since`; then by `about`. The doorstep
// carries the array always, empty when nothing waits, so a reader can count on
// the key. A kind whose source could not be read is named in `unread` beside
// it: "not read" never reads as "nothing".
//
// The older doorstep notices (the at-risk stakes warning, and the rest) fold in
// as a follow-up; this file starts with the two kinds WLD-51 ruled.

import { nextSettlement } from "./world-forecast.mjs";
import { plainReason } from "./fault-words.mjs"; // POS-657: a read's plain reason, the raw error to the log

export const SEVERITIES = Object.freeze(["urgent", "act", "info"]);

/** THE REGISTRY: one home for every kind, each with its severity and its definition. */
export const ALERT_KINDS = Object.freeze({
  "mark-taken": Object.freeze({
    severity: "act",
    definition: "A mark of yours had no stamps behind it, so a settlement took it out of the world. It is back in your household's drafts at ✦0, and its author can stake it to bring it back. Shown for 14 settlements (7 days), or until it is put forward again.",
    ruled: "Darko, WLD-51 G1 and G3, 2026-10-15 12:59 and 13:00; an alert since 19:29",
  }),
  "escrow-on-missing-mark": Object.freeze({
    severity: "info",
    definition: "Stamps you staked on a mark that isn't in the world: it was retired, or it never stood. They are still yours, and an unstake brings them home. Read from the store's copy of the ledger, so an unstake clears it at the next clearing.",
    ruled: "Darko, WLD-51, 2026-10-15 19:06 and 19:29",
  }),
});

/** One alert, in the shape. Throws on a kind the registry does not hold. */
export function alert(kind, { about = null, message, act, since = null, until = null }) {
  const reg = ALERT_KINDS[kind];
  if (!reg) throw new Error(`alerts: "${kind}" is not a registered kind (src/alerts.mjs § ALERT_KINDS)`);
  if (typeof message !== "string" || !message) throw new Error(`alerts: a "${kind}" alert needs its message`);
  if (!act || typeof act.verb !== "string" || typeof act.args !== "object") throw new Error(`alerts: a "${kind}" alert needs its act { verb, args }`);
  return { kind, severity: reg.severity, about, message, act: { verb: act.verb, args: act.args }, since, until };
}

const rank = (a) => SEVERITIES.indexOf(a.severity);
const aboutKey = (a) => String(a.about?.mark ?? "");
/** Most severe first; then the newest `since` (a null since last); then by the mark. */
export function sortAlerts(list = []) {
  return [...list].sort((a, b) => (rank(a) - rank(b))
    || (String(b.since ?? "").localeCompare(String(a.since ?? "")))
    || aboutKey(a).localeCompare(aboutKey(b))
    || a.kind.localeCompare(b.kind));
}

// ── mark-taken: a mark the settlement took (WLD-51 G1, G3) ─────────────────
//
// The store retired it by the sweep's door (`marks.retired_cause =
// 'settlement-unpublish'`, 076; a file-side retirement by marks-ingest is not a
// take); it is the asked handles' own (its owner); it is not put forward again
// (no pending claim on the open docket) and not standing again (a revive sets
// `standing`). It shows for 14 settlements after the one that took it.

export const MARK_TAKEN_SETTLEMENTS = 14;
const SETTLEMENT_MS = 12 * 3600e3;

/**
 * THE SETTLEMENT THAT TOOK IT (review-220-577 4a). The retire step runs in the
 * window the settlement opened, and windows open at 05:45:40 / 17:45:40Z while
 * the settlement runs at 06:00 / 18:00Z. The settlement is the next one on the
 * sweep's own clock, asked a millisecond before the opening, so a window that
 * opens on the dot names its own settlement.
 */
export function settlementOfWindow(opensAt) {
  const t = opensAt instanceof Date ? opensAt.getTime() : Date.parse(String(opensAt));
  return Number.isFinite(t) ? nextSettlement(new Date(t - 1)) : null;
}
/** An instant in the town's time, in words: "Oct 15, 2:00 pm EDT". */
export function townWhen(iso, tz = process.env.TOWN_TZ ?? "America/New_York") {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true, timeZoneName: "short" })
    .formatToParts(new Date(iso));
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  return `${p.month} ${p.day}, ${p.hour}:${p.minute} ${String(p.dayPeriod).toLowerCase()} ${p.timeZoneName}`;
}

/** The words (ruled by Wright 10-15 18:37, Darko may veto): true for every viewer, since only the author's stake promotes the draft. */
export const markTakenMessage = (mark, by, when) =>
  `${mark} had no stamps behind it, so it left the world at the ${when} settlement. It's back in your household's drafts, and its author, ${by}, can stake it, or leave it again with a stamp, to bring it back.`;

// A day of margin past the 14 settlements; `until` decides, in markTakenAlerts.
export const MARK_TAKEN_SQL = `
  SELECT m.slug, m.owner, m.body, w.opens_at
    FROM marks m JOIN windows w ON w.id = m.retired_window
   WHERE m.status = 'retired' AND m.retired_cause = 'settlement-unpublish'
     AND m.owner = ANY($1)
     AND w.opens_at > $2::timestamptz - interval '8 days'
     AND NOT EXISTS (SELECT 1 FROM claims c JOIN windows cw ON cw.id = c.window_id
                      WHERE c.slug = m.slug AND c.status = 'pending' AND cw.status = 'open')
   ORDER BY w.opens_at DESC, m.slug`;

/** The alerts, pure: `found` is MARK_TAKEN_SQL's rows, `now` the read's instant. */
export function markTakenAlerts(found = [], now = new Date()) {
  const out = [];
  for (const r of found ?? []) {
    const at = settlementOfWindow(r.opens_at);
    if (!at) continue;
    const until = new Date(Date.parse(at) + MARK_TAKEN_SETTLEMENTS * SETTLEMENT_MS).toISOString();
    if (Date.parse(until) <= now.getTime()) continue;
    const by = r.owner ?? String(r.slug).split("/")[0];
    out.push(alert("mark-taken", {
      about: { mark: r.slug, body: r.body ?? null },
      message: markTakenMessage(r.slug, by, townWhen(at)),
      // the AUTHOR acts: only the author's stake promotes the draft (world2-claims.mjs § promoteDraftOnStake)
      act: { verb: "world.stake", args: { mark: r.slug, stamps: 1, handle: by } },
      since: at, until,
    }));
  }
  return out;
}

// ── escrow-on-missing-mark: stamps on a mark that isn't in the world ──────
//
// An open position in the store's copy of the ledger (`escrow_projection` at
// the ingested town head: the stakes segment's own source) held by one of the
// asked handles, on a mark that does not stand on world main, does not stand in
// the store, and has no pending claim (a mark being put forward, whose stamps
// are the putting-forward). A draft is not asked about: it holds no escrow
// (staking a draft promotes it), and the doorstep's pen cannot see one anyway
// (024's row policy, with no house declared; review-583-584 F2). On 10-15:
// ✦12 on 7 such marks.

export const ESCROW_ON_MISSING_SQL = `
  SELECT e.mark, e.holder, sum(e.n)::int AS n,
         (SELECT m.body FROM marks m WHERE m.slug = e.mark ORDER BY m.locked_window DESC LIMIT 1) AS body
    FROM escrow_projection e
   WHERE e.town_sha = (SELECT sha FROM projection_heads WHERE repo = 'town')
     AND e.holder = ANY($1)
     AND NOT EXISTS (SELECT 1 FROM marks m WHERE m.slug = e.mark AND m.status = 'standing')
     AND NOT EXISTS (SELECT 1 FROM claims c WHERE c.slug = e.mark AND c.status = 'pending')
   GROUP BY e.mark, e.holder
  HAVING sum(e.n) > 0
   ORDER BY e.mark, e.holder`;

/** The alerts, pure: `found` is ESCROW_ON_MISSING_SQL's rows; `inWorld(id)` is world main's answer. */
export function escrowOnMissingAlerts(found = [], inWorld = () => false) {
  return (found ?? []).filter((r) => !inWorld(r.mark)).map((r) => alert("escrow-on-missing-mark", {
    about: { mark: r.mark, body: r.body ?? null },
    message: `✦${r.n} on ${r.mark}, which isn't in the world; unstake to bring it home`,
    // the HOLDER acts: an unstake clips to the staker's own position
    act: { verb: "world.unstake", args: { mark: r.mark, stamps: r.n, handle: r.holder } },
  }));
}

// ── the readers, and the composition ────────────────────────────────────────

const defaultStore = async () => {
  const { world2ServeEnabled, world2Pool } = await import("./world2-serve.mjs");
  return world2ServeEnabled() ? world2Pool() : null;
};
const defaultWorldIds = async () => {
  const [{ publishedState }, { WORLD_CLONE }] = await Promise.all([import("./world-branches.mjs"), import("./world.mjs")]);
  return new Set((publishedState(WORLD_CLONE)?.state?.marks ?? []).map((m) => m.id));
};

/**
 * Every alert for a set of handles: `{ alerts, unread }`. Never throws: a kind
 * whose source cannot be read is named in `unread` and adds no alert. An office
 * with no store has retired nothing and holds no copy of the ledger, so it
 * answers none (its other segments already say the store is absent).
 */
export async function alertsFor(handles, { now = new Date(), store = defaultStore, worldIds = defaultWorldIds } = {}) {
  const scope = [...new Set((handles ?? []).filter(Boolean))];
  const alerts = [], unread = [];
  if (!scope.length) return { alerts, unread };
  let p = null;
  try { p = await store(); }
  catch (e) { const why = plainReason(e, "record", "the alerts' store"); for (const kind of Object.keys(ALERT_KINDS)) unread.push({ kind, reason: `the store could not be reached (${why})` }); }
  if (!p) return { alerts, unread };
  try { alerts.push(...markTakenAlerts((await p.query(MARK_TAKEN_SQL, [scope, now.toISOString()])).rows, now)); }
  catch (e) { unread.push({ kind: "mark-taken", reason: plainReason(e, "record", "the mark-taken alerts") }); }
  try {
    const found = (await p.query(ESCROW_ON_MISSING_SQL, [scope])).rows;
    if (found.length) {
      const ids = await worldIds();
      alerts.push(...escrowOnMissingAlerts(found, (id) => ids.has(id)));
    }
  } catch (e) { unread.push({ kind: "escrow-on-missing-mark", reason: plainReason(e, "record", "the escrow-on-missing-mark alerts") }); }
  return { alerts: sortAlerts(alerts), unread };
}
