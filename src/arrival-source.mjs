// arrival-source.mjs — where a household came from (POS-770), privately.
//
// Darko, 2026-10-22 23:03: "is there any way that we can track where people
// will be coming?" An outreach link carries `?from=<tag>`; the site keeps the
// tag in the visitor's browser for 30 days (site src/lib/join-source.mjs,
// localStorage `pm.from`). This file is the office's half:
//
//   · THE CARRIER. The office's consent pages (the berth co-sign, the visitor
//     pass a human without a household authorizes) are served on the site's own
//     origin, so a few lines of inline script read the keep and fill one hidden
//     input. Nothing is shown; a page with no keep sends nothing.
//   · THE PARK. POST /oauth/consent parks a listed tag against the clicking
//     human's GitHub id (086 § arrival_source_park), on an approve only.
//   · THE LAND. declare-exec, which every road that founds a house walks with
//     the declarer's GitHub id, lands the park as the new household's
//     `came_from` (086 § arrival_source_land) after the commit, best-effort.
//
// NEVER SHOWN, NEVER ECHOED TO AN AGENT, NEVER ON THE PUBLIC RECORD: no field
// asks for it, no answer says it, and the store's functions never return it.
// The one read is counts per day and tag (arrival_sources_daily), for
// tools/arrivals.mjs.

import { actsQuery } from "./world2-acts.mjs";

/** The tags an outreach link may carry (POS-770; the site's list is the same). */
export const FROM_TAGS = Object.freeze([
  "reddit", "bsky", "x", "discord", "youtube", "substack", "1f3d9", "1f916",
  "mongoose", "obend", "commons", "delve", "gsb", "harbor",
]);
/** The browser keep the site writes and the carrier reads. */
export const FROM_KEY = "pm.from";
export const FROM_TTL_MS = 30 * 864e5;

/** A listed tag from a form's raw value, or null. */
export function fromTag(raw) {
  const tag = String(raw ?? "").trim().toLowerCase();
  return FROM_TAGS.includes(tag) ? tag : null;
}

/**
 * The carrier: one hidden input and the script that fills it from the keep,
 * for a consent form. The script checks what the site checks (the list, 30
 * days, not in the future) and never writes; with no keep the input is empty.
 */
export function fromCarrier() {
  return `<input type="hidden" name="from" value="" data-pm-from>
          <script>(function(){try{var k=JSON.parse(localStorage.getItem(${JSON.stringify(FROM_KEY)})||"null");var t=${JSON.stringify(FROM_TAGS)};var a=Date.now()-Number(k&&k.at);if(k&&t.indexOf(k.tag)>=0&&a>=0&&a<=${FROM_TTL_MS}){var i=document.querySelector("[data-pm-from]");if(i)i.value=k.tag;}}catch(e){}})();</script>`;
}

const isoOf = (at) => (at instanceof Date ? at.toISOString() : at);

/** Park a listed tag against a GitHub id. Best-effort: never throws, never reads back. */
export async function parkSource({ ghId, tag, at = new Date(), query = actsQuery, env = process.env, log = console.error } = {}) {
  const t = fromTag(tag);
  if (!t || ghId == null) return { parked: false };
  try {
    const rows = await query("SELECT arrival_source_park($1, $2, $3)", [ghId, t, isoOf(at)], env);
    return { parked: rows !== null };
  } catch (e) {
    log(`[arrival-source] gh ${ghId}: not parked — ${String(e?.message ?? e).slice(0, 200)}`);
    return { parked: false };
  }
}

/** Land a GitHub id's park as a new household's came_from. Best-effort: never throws, never reads the tag. */
export async function landSource({ ghId, household, at = new Date(), query = actsQuery, env = process.env, log = console.error } = {}) {
  if (ghId == null || !household) return { kept: false };
  try {
    const rows = await query("SELECT arrival_source_land($1, $2, $3) AS kept", [ghId, household, isoOf(at)], env);
    return { kept: rows?.[0]?.kept === true };
  } catch (e) {
    log(`[arrival-source] ${household}: not landed — ${String(e?.message ?? e).slice(0, 200)}`);
    return { kept: false };
  }
}

/** The word a folded cell is printed as: the store answers a day × tag cell under 3 with no count. */
export const SMALL_CELL = "<3";

/**
 * Counts per day (US-Eastern) and tag since an instant; a cell under 3 is
 * SMALL_CELL, folded by the store itself. null when the office is not pointed
 * at the record.
 */
export async function dailySources({ since, query = actsQuery, env = process.env } = {}) {
  const rows = await query("SELECT day::text AS day, tag, n::int AS n FROM arrival_sources_daily($1)", [since], env);
  if (rows === null) return null;
  return rows.map((r) => ({ day: String(r.day).slice(0, 10), tag: r.tag, n: r.n == null ? SMALL_CELL : Number(r.n) }));
}
