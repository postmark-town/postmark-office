#!/usr/bin/env node
// invites.mjs — the households that joined with an invitation (POS-576), for
// Wright's hand mint at each settlement.
//
//   node /srv/postmark-office/tools/invites.mjs [--since <ISO instant>] [--json]
//
//   env: WORLD2_PG_URL (or PG*), the office's own store. Reads `households`
//        (085's `invited_by`) and `ashore` (071), and writes nothing.
//
// ── WHY ─────────────────────────────────────────────────────────────────────
// Darko, 2026-10-22 20:40 (POS-576/a–d): an invited household's join bundle is
// 10 stamps (5 more than an ordinary join) and its inviter gets 10 when the new
// household is real (its first letter or a home within 30 days), at most 10
// paid invitations per inviting household a month. This weekend the join only
// REMEMBERS the invite (src/arrival-invite.mjs); Wright mints by hand at each
// settlement, and this is the list he mints from. Nothing here mints.
//
// ── WHAT IT PRINTS ──────────────────────────────────────────────────────────
// One block per settlement window, oldest first. A window ends at a sweep
// (06:00 or 18:00 UTC), so an invite lands in the window of the next sweep
// after its declaration. Per household:
//   · who it is and who invited it (the inviting household, and the name the
//     join gave when that was a resident's handle);
//   · `ashore`: when its first resident came ashore by the store's own record
//     (071 records the declaration door and the join bind; a house settled at a
//     crossing reads "no record", and the town says whether it stands);
//   · `month`: the inviter's invited households this calendar month (UTC), with
//     this one's place among them, so the cap of 10 paid a month is read off;
//   · `real`: the 30-day check the inviter's 10 waits on (Wright, 2026-10-22,
//     G5: "so my hand mint can check 'real within 30 days' from one read"). Its
//     first letter is the earliest delivered letter any of its residents sent
//     (`town_letters.delivered_at`); its home is its first parcel, the town's
//     home (`marks` of kind parcel, in its name, at the close of the window
//     that locked it). `status` is real (within 30 days of the invite), late
//     (after), waiting (neither yet, the 30 days still running) or lapsed.

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { actsQuery } from "../src/world2-acts.mjs";

const SWEEP_HOURS_UTC = [6, 18];
export const REAL_WITHIN_MS = 30 * 864e5;
const isoOrNull = (v) => { const t = v == null ? NaN : new Date(v).getTime(); return Number.isFinite(t) ? new Date(t).toISOString() : null; };

/** The 30-day check for one invited household: its first letter, its first home, and what they make it. */
export function realOf({ at, letter = null, home = null, now = new Date() }) {
  const deadline = new Date(new Date(at).getTime() + REAL_WITHIN_MS).toISOString();
  const first = [isoOrNull(letter), isoOrNull(home)].filter(Boolean).sort()[0] ?? null;
  const status = first ? (first <= deadline ? "real" : "late") : (new Date(now).toISOString() > deadline ? "lapsed" : "waiting");
  return { first_letter: isoOrNull(letter), first_home: isoOrNull(home), by: deadline, status, ...(first ? { at: first } : {}) };
}

/** The sweep that closes the window an instant falls in: the next 06:00 or 18:00 UTC, at or after it. */
export function windowOf(at) {
  const t = new Date(at);
  for (const day of [0, 1]) {
    for (const h of SWEEP_HOURS_UTC) {
      const sweep = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate() + day, h));
      if (sweep >= t) return sweep.toISOString();
    }
  }
  return null;
}

/**
 * The rows, grouped by window, with each inviter's monthly count. `rows` are
 * `{ slug, name, residents, invited_by }`. `facts`: `ashore` maps a handle to
 * its instant; `letters` and `homes` map a household's slug to its first.
 */
export function planInvites(rows, { ashore = new Map(), letters = new Map(), homes = new Map() } = {}, { since = null, now = new Date() } = {}) {
  const invited = rows
    .filter((r) => r.invited_by?.by && r.invited_by?.at)
    .map((r) => ({ ...r, at: new Date(r.invited_by.at).toISOString() }))
    .sort((a, b) => a.at.localeCompare(b.at) || a.slug.localeCompare(b.slug));
  const monthCount = new Map();
  const out = [];
  for (const r of invited) {
    const month = `${r.invited_by.by}|${r.at.slice(0, 7)}`;
    monthCount.set(month, (monthCount.get(month) ?? 0) + 1);
    if (since && r.at < since) continue;
    const first = (r.residents ?? [])[0] ?? null;
    out.push({
      window: windowOf(r.at),
      household: r.slug,
      name: r.name ?? null,
      first_resident: first,
      invited_by: r.invited_by.by,
      named: r.invited_by.named ?? null,
      at: r.at,
      ashore: first && ashore.has(first) ? ashore.get(first) : null,
      month: { of: r.at.slice(0, 7), nth: monthCount.get(month) },
      real: realOf({ at: r.at, letter: letters.get(r.slug) ?? null, home: homes.get(r.slug) ?? null, now }),
    });
  }
  return out;
}

export function printInvites(plan) {
  if (!plan.length) return "no household has joined with an invitation in this range.\n";
  const lines = [];
  let window = null;
  for (const p of plan) {
    if (p.window !== window) { window = p.window; lines.push(`\nwindow closing ${window} (the settlement sweep)`); }
    const named = p.named && p.named !== p.invited_by ? ` (named ${p.named})` : "";
    const cap = p.month.nth > 10 ? `, OVER the 10-a-month cap` : "";
    lines.push(`  ${p.household}${p.name ? ` "${p.name}"` : ""} · invited by ${p.invited_by}${named} · at ${p.at}`
      + ` · ashore ${p.ashore ?? "no record"} · ${p.invited_by}'s invite ${p.month.nth} in ${p.month.of}${cap}`);
    lines.push(`      first letter ${p.real.first_letter ?? "none"} · first home ${p.real.first_home ?? "none"} · ${p.real.status.toUpperCase()}`
      + (p.real.status === "real" ? `: the inviter's 10 is owed` : p.real.status === "waiting" ? `, until ${p.real.by}` : p.real.status === "late" ? `, after ${p.real.by}: nothing owed` : `: nothing came by ${p.real.by}`));
  }
  return lines.join("\n").trimStart() + `\n\n${plan.length} invited household(s) listed. The invitee is minted 10 at settle; the inviter 10 when the invitee's first letter or home lands within 30 days (REAL).\n`;
}

const isMain = (() => {
  if (!process.argv[1]) return false;
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
})();
if (isMain) {
  const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
  const since = arg("--since");
  if (since && Number.isNaN(Date.parse(since))) { console.error(`--since takes an ISO instant, not "${since}"`); process.exit(2); }
  const rows = await actsQuery(
    `SELECT slug, name, residents, to_jsonb(households) -> 'invited_by' AS invited_by
       FROM households
      WHERE to_jsonb(households) -> 'invited_by' IS NOT NULL
        AND to_jsonb(households) -> 'invited_by' <> 'null'::jsonb`, []);
  if (rows === null) { console.error("the office is not pointed at the record (WORLD2_PG_URL)"); process.exit(2); }
  const firsts = rows.map((r) => (r.residents ?? [])[0]).filter(Boolean);
  const shore = firsts.length ? await actsQuery("SELECT handle, at FROM ashore WHERE handle = ANY($1)", [firsts]) : [];
  const ashore = new Map((shore ?? []).map((r) => [r.handle, new Date(r.at).toISOString()]));
  // THE 30-DAY FACTS, one query each. A letter is any resident's; a home is a
  // parcel in the house's name, under either spelling a new house carries.
  const houseOf = new Map(rows.flatMap((r) => (r.residents ?? []).map((h) => [h, r.slug])));
  const sent = houseOf.size ? await actsQuery(
    "SELECT from_h, min(delivered_at) AS at FROM town_letters WHERE from_h = ANY($1) AND delivered_at IS NOT NULL GROUP BY from_h", [[...houseOf.keys()]]) : [];
  const letters = new Map();
  for (const s of sent ?? []) {
    const slug = houseOf.get(s.from_h), at = isoOrNull(s.at);
    if (at && (!letters.has(slug) || at < letters.get(slug))) letters.set(slug, at);
  }
  const spellings = rows.flatMap((r) => [r.slug, `hh:${r.slug}`]);
  const parcels = spellings.length ? await actsQuery(
    `SELECT m.household, min(w.closes_at) AS at FROM marks m JOIN windows w ON w.id = m.locked_window
      WHERE m.kind = 'parcel' AND m.household = ANY($1) GROUP BY m.household`, [spellings]) : [];
  const homes = new Map();
  for (const p of parcels ?? []) {
    const slug = String(p.household).replace(/^hh:/, ""), at = isoOrNull(p.at);
    if (at && (!homes.has(slug) || at < homes.get(slug))) homes.set(slug, at);
  }
  const plan = planInvites(rows, { ashore, letters, homes }, { since: since ? new Date(since).toISOString() : null });
  process.stdout.write(process.argv.includes("--json") ? JSON.stringify(plan, null, 1) + "\n" : printInvites(plan));
  process.exit(0);
}
