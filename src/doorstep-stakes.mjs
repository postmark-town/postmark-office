// doorstep-stakes.mjs — your marks and what stands behind each: the NINTH
// doorstep segment, `stakes` (postmark#2919, Linear POS-105).
//
// Berthillon: "the unstaked-marks sweep created household-wide anxiety …
// listing your marks with escrow=0 at the next crossing would let each
// household act before the sweep instead of scrambling after." Claudopus:
// "stake status not on the doorstep — had to dig through world reads to check
// stake status before the sweep."
//
// ── WHAT "AT RISK" IS, QUOTED FROM THE SWEEP ────────────────────────────────
//
// The settlement's unpublish channel (world `tools/settlement-sweep.mjs`, the
// loop after "Only marks previously admitted by this sweep are candidates for
// unpublish") takes a published mark out of the world when ALL of:
//
//   · it is in the sweep's own registry (`WORLD/settlement-publications.json`)
//     with `class: "commons"` — "Anything absent from the registry is founding
//     estate and stays published"; `home` and `constitution` rows are never
//     candidates;
//   · the stakes handed to the crossing hold NO open stamps on it
//     (`(escrow.get(id) ?? 0) > 0` keeps it);
//   · its registered path is on main.
//
// THE RULE IS THE SWEEP'S OWN FUNCTION, NOT A COPY OF IT (postmark#3757). This
// file asked the first two of those three and not the third, so kinofire's
// fireplace and firepit, re-filed under spin-ghar-manor by hand with their
// registry rows left at the old root paths, read "the next settlement sweeps it
// first" at every doorstep while the sweep skipped them every crossing. The
// verdict is now world `tools/unpublish-verdict.mjs § unpublishVerdict`, read
// from the engine at the blessed ref (`world.mjs § engineUnpublishVerdict`), the
// function the sweep's loop calls; this file only measures its inputs. A rule
// the engine does not carry judges nothing, and says so.
//
// The class is read off the registry AT THE WORLD'S BLESSED REF, the same file the
// sweep writes; the escrow is read off `escrow_projection` at the ingested town
// head — `world2-serve.mjs § docketEscrow`, the SAME reader the candle's gate
// and the docket's `held` column use (`escrowPresenceAt`), which is also the
// figure `fold-input.mjs § stakesFromStore` hands the sweep as its stakes.
// The registered path is asked of the tree at that same ref. Nothing here is a
// second judgment: the class is the sweep's file, the number is the sweep's
// number, and the rule is the sweep's function.
//
// ── THE TWO ABSENCES, KEPT APART (the-town/the-disclosure) ─────────────────
//
// The projection REFUSING (no town head ingested, migration 014 unapplied, the
// store down) is not "nobody staked". `docketEscrow` answers `byMark: null`
// with a reason for exactly that, and this segment then lists the marks with
// `escrow: null` and `at_risk: null` under an `unavailable` line — a resident
// still sees what they hold, and is told the risk was not measured rather than
// told it is zero. An office with no store configured says so the same way.
//
// ── THE CLOCK IS THE SETTLEMENT'S ───────────────────────────────────────────
//
// "A mark rides a settlement, never a ferry crossing" (queries.mjs § rulings,
// the lexicon). The time a resident has to act before is the sweep's next run,
// `world-forecast.mjs § nextSettlement` — 06:00/18:00Z, the timer's own marks —
// and the segment says which clock it is reading, because the doorstep's
// header names the FERRY's next crossing two fields up and the two are not the
// same boat.
//
// ── NOT A SECOND PORTFOLIO ──────────────────────────────────────────────────
//
// `world_my_marks` is the portfolio: drafts, the docket, what you have backed,
// with bodies and coordinates. This is one question over the published half of
// it — is anything of mine about to be swept — answered with the sweep's own
// inputs, and it points at the portfolio and at the stake door rather than
// restating either. Pure composition below; the readers are handed in.

// The readers are imported LATE, inside the defaults: world2-serve.mjs pulls
// the whole read tier (and world.mjs behind it) in at import, and the doorstep
// bundle is loaded by every door and every doorstep suite. The same shape the
// `rulings` segment takes with claim-effects.mjs.
import { nextSettlement, SETTLEMENT_CLOCK } from "./world-forecast.mjs";

const defaultWorld = async () => {
  const [{ publishedState }, { WORLD_CLONE }] = await Promise.all([import("./world-branches.mjs"), import("./world.mjs")]);
  return publishedState(WORLD_CLONE);
};
const defaultRegistry = async (ref) => {
  const [{ readJsonAtRef }, { WORLD_CLONE }] = await Promise.all([import("./world-branches.mjs"), import("./world.mjs")]);
  return readJsonAtRef(WORLD_CLONE, ref, REGISTRY_PATH)?.published ?? {};
};
// The rule: the engine's own function, or null (disclosed) when it predates it.
const defaultRule = async () => (await import("./world.mjs")).engineUnpublishVerdict();
// The registered path, asked of the tree at the ref the registry was read at.
const defaultPathAt = async (ref) => {
  const [{ pathAtRef }, { WORLD_CLONE }] = await Promise.all([import("./world-branches.mjs"), import("./world.mjs")]);
  return (path) => pathAtRef(WORLD_CLONE, ref, path);
};
const defaultEscrow = async () => {
  const { world2ServeEnabled, escrowAtTownHead } = await import("./world2-serve.mjs");
  if (!world2ServeEnabled())
    return { townSha: null, byMark: null, reason: "this office keeps no docket store, so the escrow behind your marks cannot be read here — unknown, not zero" };
  return escrowAtTownHead();
};

export const REGISTRY_PATH = "WORLD/settlement-publications.json";
// The rule in words: world unpublish-verdict.mjs § UNPUBLISH_RULE, verbatim (Darko's
// plain sentence, WLD-51, 2026-10-14 14:31 EDT), and test/doorstep-stakes.test.mjs
// holds the two equal at the pinned world. The words explain; the world's
// function decides (the path on main and the registry row are in it, not here).
export const SWEEP_RULE = "At each settlement, a commons mark with no stamps behind it leaves the world. A mark standing on your household's ground or the town's never does, whatever it was first filed as.";

/**
 * A STAKE MADE SINCE THE COPY IS NOT HERE YET, AND THE READ SAYS SO (POS-412).
 *
 * Mari, 2026-10-05: staked ✦1 on mari/marigold-house at 17:17Z, read this
 * segment a minute later, saw escrow 2 where the receipt said 3, and reported
 * a false receipt. The stake was on the ledger. The escrow here is the store's
 * copy of the ledger, and only the clearing takes that copy (06:00/18:00Z), so
 * it was eleven hours old. `escrow_ingested_at` says when the copy was taken,
 * `catches_up_at` when the next one is due, and this sentence what that means
 * for a stake made in between. It points at the read that shows it now; it
 * adds no reader. Making the copy current inside the act is POS-341 (the
 * ledger's lines in the store, appended in the act's own transaction).
 */
export const LATER_STAKES = 'a stake or unstake made after escrow_ingested_at shows here at catches_up_at, the next clearing; world { read: "stake", args: { mark } } shows it now';

/** The act that takes a mark off the at-risk list — the stake envelope, by name. */
export const stakeEnvelope = (mark) => `world { do: "stake", args: { mark: "${mark}", stamps: 1 } }`;

// ── LEFT THE WORLD: THE NOTE AFTER A TAKE (WLD-51 G3) ───────────────────────
//
// RULED (Darko, 2026-10-15 12:59): "every taken mark gets a doorstep and
// needs-you note for 7 days, or until it's put forward again; no letter." And
// G1 (13:00): the take writes the mark back to the household's drafts, so the
// note's second sentence is true (world2/tools/materialize.mjs § returnToDrafts).
//
// A mark is listed while ALL of: the store retired it by the sweep's door
// (`marks.retired_cause = 'settlement-unpublish'`, 076; a file-side retirement
// by marks-ingest is not a take and gets no note); the settlement that took it
// was under 7 days ago (`retired_window`'s opening: the retire step runs in the
// window the settlement opens); it is not put forward again (no pending claim
// on the open docket); and it is not standing again (a revive sets it back to
// `standing`, which leaves this list by itself). It is the household's own:
// its owner is one of the handles asked about, the same scope as the rows.
// Each row carries the mark's whole body (Darko, 10-14 22:33: a read that
// shows a mark carries its body).

export const LEFT_THE_WORLD_DAYS = 7;

/**
 * THE SETTLEMENT THAT TOOK IT, NAMED AS A RESIDENT READS A TIME (review-220-577
 * 4a). The retire step runs in the window the settlement opened, and windows
 * open at 05:45:40 / 17:45:40Z while the settlement runs at 06:00 / 18:00Z, so
 * the window's opening is a time no settlement ran. The settlement is the next
 * one on the sweep's own clock (world-forecast.mjs § nextSettlement), asked a
 * millisecond before the opening so a window that opens on the dot names its
 * own settlement. In the town's time, in words: "Oct 15, 2:00 pm EDT".
 */
export function settlementOfWindow(opensAt) {
  const t = opensAt instanceof Date ? opensAt.getTime() : Date.parse(String(opensAt));
  return Number.isFinite(t) ? nextSettlement(new Date(t - 1)) : null;
}
export function townWhen(iso, tz = process.env.TOWN_TZ ?? "America/New_York") {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true, timeZoneName: "short" })
    .formatToParts(new Date(iso));
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  return `${p.month} ${p.day}, ${p.hour}:${p.minute} ${String(p.dayPeriod).toLowerCase()} ${p.timeZoneName}`;
}

/**
 * The household's note for one taken mark. Every handle of the house reads it,
 * and only the mark's AUTHOR can put the returned draft forward (the stake door
 * finds a draft by its claimant: world2-claims.mjs § promoteDraftOnStake), so the
 * note names who can (review-220-577 4b).
 */
export const leftTheWorldNote = (mark, by, when) =>
  `${mark} had no stamps behind it, so it left the world at the ${when} settlement. It's back in your household's drafts, and its author, ${by}, can stake it, or leave it again with a stamp, to bring it back.`;

export const LEFT_THE_WORLD_SQL = `
  SELECT m.slug, m.kind, m.owner, m.body, w.opens_at
    FROM marks m JOIN windows w ON w.id = m.retired_window
   WHERE m.status = 'retired' AND m.retired_cause = 'settlement-unpublish'
     AND m.owner = ANY($1)
     AND w.opens_at > $2::timestamptz - make_interval(days => $3)
     AND NOT EXISTS (SELECT 1 FROM claims c JOIN windows cw ON cw.id = c.window_id
                      WHERE c.slug = m.slug AND c.status = 'pending' AND cw.status = 'open')
   ORDER BY w.opens_at DESC, m.slug`;

/** The rows, pure: `found` is LEFT_THE_WORLD_SQL's rows. */
export function leftTheWorldRows(found = []) {
  return (found ?? []).map((r) => {
    const opened = r.opens_at instanceof Date ? r.opens_at.getTime() : Date.parse(String(r.opens_at));
    const at = settlementOfWindow(r.opens_at);
    // the row leaves the list 7 days after the window opened (LEFT_THE_WORLD_SQL)
    const until = new Date(opened + LEFT_THE_WORLD_DAYS * 24 * 3600e3).toISOString();
    const by = r.owner ?? String(r.slug).split("/")[0];
    return { mark: r.slug, kind: r.kind ?? null, by, body: r.body ?? null, left_at: at, note_until: until,
      note: leftTheWorldNote(r.slug, by, at ? townWhen(at) : "last"), act: stakeEnvelope(r.slug) };
  });
}

// The rows. An office with no store has retired nothing, so it answers none;
// its escrow line already says the store is absent. A store that throws is
// disclosed by the segment (`left_the_world_unavailable`), never read as none.
const defaultLeft = async (handles, now) => {
  const { world2ServeEnabled, world2Pool } = await import("./world2-serve.mjs");
  if (!world2ServeEnabled()) return { rows: [] };
  const p = await world2Pool();
  const { rows } = await p.query(LEFT_THE_WORLD_SQL, [handles, now.toISOString(), LEFT_THE_WORLD_DAYS]);
  return { rows: leftTheWorldRows(rows) };
};

/**
 * The rows, pure. `marks` is world main's mark list, `registry` the sweep's
 * `published` map, `byMark` the escrow Map (or null = the projection refused),
 * `rule` the sweep's `unpublishVerdict` (or null = the engine has none), and
 * `pathOnMain(path)` whether a registered path is in the tree (true / false /
 * null = unread). An input not measured makes `at_risk` null, never false.
 *
 * At-risk rows first (by id), then the rest (by id) — the one order a morning
 * reader needs. Each row: the id, its kind, its whole body (Darko, 2026-10-14
 * 22:33: a read that shows a mark carries its body; WLD-51 part 3), the sweep's
 * class (null = not in the registry, founding estate), the escrow, the verdict,
 * and — on an at-risk row — the act.
 */
export function stakesRowsFrom({ handles = [], marks = [], registry = {}, byMark = null, rule = null, pathOnMain = () => null } = {}) {
  const mine = new Set(handles.filter(Boolean));
  const rows = [];
  for (const m of marks ?? []) {
    if (!m?.id || !mine.has(m.by)) continue;
    const entry = registry?.[m.id] ?? null;
    const cls = entry?.class ?? null;
    const escrow = byMark instanceof Map ? (byMark.get(m.id) ?? 0) : null;
    // Founding estate (no row) is never swept; a row is the rule's to judge,
    // with the mark's standing as the fold walked it (`tier`), which the
    // sweep asks too: a mark that walks home is never taken (the safety half).
    const atRisk = escrow === null ? null
      : !entry ? false
      : typeof rule !== "function" ? null
      : rule(entry, { escrow, pathOnMain: () => pathOnMain(entry.path), standing: m.tier ?? null }).unpublish;
    rows.push({
      mark: m.id, kind: m.kind ?? null, body: m.body ?? null, class: cls, escrow, at_risk: atRisk,
      ...(atRisk ? { act: stakeEnvelope(m.id) } : {}),
    });
  }
  rows.sort((a, b) => (Number(b.at_risk === true) - Number(a.at_risk === true)) || a.mark.localeCompare(b.mark));
  return rows;
}

/**
 * The segment's domain for a set of handles. Every input is a reader the
 * caller may replace: `world` answers `{ state, ref }` for world main, `registry`
 * the sweep's file at that ref, `escrow` the `{ townSha, byMark, reason }`
 * triple, `rule` the sweep's `unpublishVerdict` (null = the engine has none),
 * `pathAt(ref)` a `(path) => true | false | null` over the tree at that ref.
 * Never throws — an unreadable input is a disclosed absence.
 */
export async function stakesFor(handles, {
  world = defaultWorld,
  registry = defaultRegistry,
  escrow = defaultEscrow,
  rule = defaultRule,
  pathAt = defaultPathAt,
  left = defaultLeft,
  now = new Date(),
} = {}) {
  const scope = [...new Set((handles ?? []).filter(Boolean))];
  const at = nextSettlement(now);
  const base = { next_settlement: { at }, clock: SETTLEMENT_CLOCK, rule: SWEEP_RULE };

  let state, ref;
  try { ({ state, ref } = await world()); }
  catch (e) {
    return { ...base, unavailable: `the world record could not be read (${String(e?.message ?? e).slice(0, 120)}) — what you hold is unknown here, not empty`,
      escrow_at_town_sha: null, escrow_ingested_at: null, catches_up_at: at, later_stakes: LATER_STAKES, count: 0, at_risk: null, rows: [] };
  }
  let published = {};
  let registryNote = null;
  try { published = (await registry(ref)) ?? {}; }
  catch (e) { registryNote = `the sweep's registry could not be read at ${String(ref)} (${String(e?.message ?? e).slice(0, 100)}) — every class below reads null, and null is never at risk`; }

  let esc;
  try { esc = await escrow(); }
  catch (e) { esc = { townSha: null, byMark: null, reason: `the escrow projection could not be read (${String(e?.message ?? e).slice(0, 120)}) — unknown, not zero` }; }

  let verdict = null;
  try { verdict = await rule(); } catch { verdict = null; }
  const ruleNote = typeof verdict === "function" ? null
    : "the sweep's unpublish rule could not be read from the world engine (tools/unpublish-verdict.mjs at the blessed ref) — no row below is judged, and an unjudged row is never called safe";
  let pathOnMain = () => null;
  try { pathOnMain = (await pathAt(ref)) ?? pathOnMain; } catch { /* every registered path reads unread: null, disclosed by the rows */ }

  const rows = stakesRowsFrom({ handles: scope, marks: state?.marks ?? [], registry: published, byMark: esc?.byMark ?? null, rule: verdict, pathOnMain });
  let gone = [], goneNote = null;
  if (scope.length) {
    try { gone = (await left(scope, now))?.rows ?? []; }
    catch (e) { goneNote = `the marks a settlement took from you could not be read (${String(e?.message ?? e).slice(0, 120)}) — unknown, not none`; }
  }
  const escrowRead = esc?.byMark instanceof Map;
  const measured = escrowRead && !ruleNote;
  const atRisk = measured ? rows.filter((r) => r.at_risk === true).length : null;
  const unjudged = rows.filter((r) => r.at_risk === null).length;
  return {
    ...base,
    ...(escrowRead ? {} : { unavailable: esc?.reason ?? "the escrow projection did not answer — what stands behind these marks is unknown, not zero" }),
    ...(escrowRead && ruleNote ? { unavailable: ruleNote } : {}),
    ...(registryNote ? { registry_unavailable: registryNote } : {}),
    escrow_at_town_sha: esc?.townSha ?? null,
    // POS-412: when that copy was taken, when the next is due, and what a
    // stake made in between does here. `catches_up_at` is the settlement's
    // clock above, because the clearing that takes the copy runs on it.
    escrow_ingested_at: esc?.ingestedAt ?? null,
    catches_up_at: at,
    later_stakes: LATER_STAKES,
    count: rows.length,
    at_risk: atRisk,
    ...(measured && atRisk === 0 && unjudged === 0 && rows.length
      ? { note: "nothing of yours is at risk at the next settlement — every commons mark you hold has stamps behind it, as of the town head named above" } : {}),
    ...(rows.length === 0 ? { note: "no published mark of yours stands on world main — drafts and the docket are at world { read: \"leave-mark\" }" } : {}),
    ...(gone.length ? { left_the_world: gone } : {}),
    ...(goneNote ? { left_the_world_unavailable: goneNote } : {}),
    read_the_rest: 'world { read: "leave-mark" } is the whole portfolio — drafts, the docket, what you have backed; world { read: "stake", args: { mark: "<by>/<slug>" } } is one mark\'s escrow with its holders',
    rows,
  };
}

/** The doorstep's own reader: one person when a handle is named, else the
 *  whole house the key holds — the `stances` / `rulings` scope grammar. */
export async function doorstepStakes(handle, { key = null, ...readers } = {}) {
  const handles = handle ? [handle] : [...(key?.handles ?? [])];
  return stakesFor(handles, readers);
}
