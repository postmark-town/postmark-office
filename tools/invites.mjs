#!/usr/bin/env node
// invites.mjs — the households that joined with an invitation (POS-576), for
// Wright's hand mint at each settlement.
//
//   node /srv/postmark-office/tools/invites.mjs [--since <ISO instant>] [--json]
//
//   env: WORLD2_PG_URL (or PG*), the office's own store. Reads `households`
//        (085's `invited_by`, and every house's `formerly`), `ashore` (071),
//        `town_residents`, `town_letters` and `marks`/`windows`, and writes
//        nothing.
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
//   · who it is and who invited it: the inviting household AS IT IS CALLED
//     NOW (a house that renamed is found through its `formerly`, and the name
//     the credit was written under is kept beside it), and the name the join
//     gave;
//   · `settled`: whether the invitee is ashore yet, which is when ITS 10 is due.
//     Ashore is the store's own record (071: the declaration door and the join
//     bind, with the instant) or an address in the town's roll
//     (`town_residents`, the crossing's road, no instant). Not settled: its 10
//     waits;
//   · `real`: the 30-day check the inviter's 10 waits on (Wright's G5). Its
//     first letter is the earliest delivered letter any of its residents sent
//     (`town_letters.delivered_at`); its home is its first parcel, the town's
//     home (`marks` of kind parcel, in its name, at the close of the window
//     that locked it). `status` is real (within 30 days of the invite), late
//     (after), waiting (neither yet, the 30 days still running) or lapsed;
//   · `paid`: for a REAL invite only, the inviter's place among its REAL
//     invites in the month the 10 falls due (the month of `real.at`, on
//     Darko's clock, US-Eastern), so the cap of 10 paid a month is read off.
//     An invite that never became real takes no place in the cap.

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { actsQuery } from "../src/world2-acts.mjs";

const SWEEP_HOURS_UTC = [6, 18];
export const REAL_WITHIN_MS = 30 * 864e5;
export const PAID_PER_MONTH = 10;
const isoOrNull = (v) => { const t = v == null ? NaN : new Date(v).getTime(); return Number.isFinite(t) ? new Date(t).toISOString() : null; };

/** The month an instant falls in on Darko's clock (US-Eastern), as YYYY-MM. */
export function monthET(at) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit" }).formatToParts(new Date(at));
  return `${parts.find((p) => p.type === "year").value}-${parts.find((p) => p.type === "month").value}`;
}

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
 * The rows, grouped by window. `rows` are `{ slug, name, residents,
 * invited_by }`. `facts`: `ashore` maps a handle to its instant; `rolled` is
 * the set of handles the town's roll holds; `letters` and `homes` map a
 * household's slug to its first; `current` maps an inviter's slug to its slug
 * now (through `formerly`).
 */
export function planInvites(rows, { ashore = new Map(), rolled = new Set(), letters = new Map(), homes = new Map(), current = (s) => s } = {}, { since = null, now = new Date() } = {}) {
  const invited = rows
    .filter((r) => r.invited_by?.by && r.invited_by?.at)
    .map((r) => ({ ...r, at: new Date(r.invited_by.at).toISOString() }))
    .sort((a, b) => a.at.localeCompare(b.at) || a.slug.localeCompare(b.slug));
  const all = invited.map((r) => {
    const first = (r.residents ?? [])[0] ?? null;
    const shore = first && ashore.has(first) ? ashore.get(first) : null;
    const settled = shore ? { yes: true, at: shore, by: "the store's ashore record" }
      : (r.residents ?? []).some((h) => rolled.has(h)) ? { yes: true, at: null, by: "an address in the town's roll" }
        : { yes: false };
    const inviter = current(r.invited_by.by);
    return {
      window: windowOf(r.at),
      household: r.slug,
      name: r.name ?? null,
      first_resident: first,
      invited_by: inviter,
      ...(inviter !== r.invited_by.by ? { invited_by_was: r.invited_by.by } : {}),
      named: r.invited_by.named ?? null,
      at: r.at,
      settled,
      real: realOf({ at: r.at, letter: letters.get(r.slug) ?? null, home: homes.get(r.slug) ?? null, now }),
      paid: null,
    };
  });
  // THE CAP COUNTS REAL INVITES ONLY, in the month each 10 falls due (US-Eastern)
  const placed = new Map();
  for (const p of [...all].filter((x) => x.real.status === "real").sort((a, b) => a.real.at.localeCompare(b.real.at) || a.household.localeCompare(b.household))) {
    const month = monthET(p.real.at);
    const k = `${p.invited_by}|${month}`;
    placed.set(k, (placed.get(k) ?? 0) + 1);
    p.paid = { month, nth: placed.get(k), over_cap: placed.get(k) > PAID_PER_MONTH };
  }
  return since ? all.filter((p) => p.at >= since) : all;
}

export function printInvites(plan) {
  if (!plan.length) return "no household has joined with an invitation in this range.\n";
  const lines = [];
  let window = null;
  for (const p of plan) {
    if (p.window !== window) { window = p.window; lines.push(`\nwindow closing ${window} (the settlement sweep)`); }
    const named = p.named && p.named !== p.invited_by && p.named !== `hh:${p.invited_by}` ? ` (named ${p.named})` : "";
    const was = p.invited_by_was ? ` (credited as ${p.invited_by_was}, renamed since)` : "";
    lines.push(`  ${p.household}${p.name ? ` "${p.name}"` : ""} · invited by ${p.invited_by}${was}${named} · at ${p.at}`);
    lines.push(p.settled.yes
      ? `      SETTLED${p.settled.at ? ` ${p.settled.at}` : ""} (${p.settled.by}): the invitee's 10 is due`
      : `      NOT SETTLED (no ashore record, no address in the roll): the invitee's 10 waits`);
    lines.push(`      first letter ${p.real.first_letter ?? "none"} · first home ${p.real.first_home ?? "none"} · ${p.real.status.toUpperCase()}`
      + (p.real.status === "real"
        ? `: the inviter's 10 is owed, ${p.invited_by}'s paid invite ${p.paid.nth} in ${p.paid.month} (ET)${p.paid.over_cap ? `, OVER the ${PAID_PER_MONTH}-a-month cap: not owed` : ""}`
        : p.real.status === "waiting" ? `, until ${p.real.by}` : p.real.status === "late" ? `, after ${p.real.by}: nothing owed` : `: nothing came by ${p.real.by}`));
  }
  return lines.join("\n").trimStart() + `\n\n${plan.length} invited household(s) listed. The invitee is minted 10 at settle; the inviter 10 when the invitee's first letter or home lands within 30 days (REAL), at most ${PAID_PER_MONTH} a month (ET).\n`;
}

const isMain = (() => {
  if (!process.argv[1]) return false;
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
})();
if (isMain) {
  const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
  const since = arg("--since");
  if (since && Number.isNaN(Date.parse(since))) { console.error(`--since takes an ISO instant, not "${since}"`); process.exit(2); }
  const houses = await actsQuery(
    `SELECT slug, name, residents, formerly, to_jsonb(households) -> 'invited_by' AS invited_by FROM households`, []);
  if (houses === null) { console.error("the office is not pointed at the record (WORLD2_PG_URL)"); process.exit(2); }
  const rows = houses.filter((r) => r.invited_by != null && typeof r.invited_by === "object");
  const current = currentSlugOf(houses);
  const firsts = rows.map((r) => (r.residents ?? [])[0]).filter(Boolean);
  const shore = firsts.length ? await actsQuery("SELECT handle, at FROM ashore WHERE handle = ANY($1)", [firsts]) : [];
  const ashore = new Map((shore ?? []).map((r) => [r.handle, new Date(r.at).toISOString()]));
  // THE 30-DAY FACTS AND THE ROLL, one query each. A letter is any resident's;
  // a home is a parcel in the house's name, under either spelling a new house carries.
  const houseOf = new Map(rows.flatMap((r) => (r.residents ?? []).map((h) => [h, r.slug])));
  const handles = [...houseOf.keys()];
  const roll = handles.length ? await actsQuery("SELECT handle FROM town_residents WHERE handle = ANY($1)", [handles]) : [];
  const rolled = new Set((roll ?? []).map((r) => r.handle));
  const sent = handles.length ? await actsQuery(
    "SELECT from_h, min(delivered_at) AS at FROM town_letters WHERE from_h = ANY($1) AND delivered_at IS NOT NULL GROUP BY from_h", [handles]) : [];
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
  const plan = planInvites(rows, { ashore, rolled, letters, homes, current }, { since: since ? new Date(since).toISOString() : null });
  process.stdout.write(process.argv.includes("--json") ? JSON.stringify(plan, null, 1) + "\n" : printInvites(plan));
  process.exit(0);
}
