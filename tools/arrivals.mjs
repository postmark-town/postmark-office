#!/usr/bin/env node
// arrivals.mjs — where arrivals come from, counted per day (POS-770).
//
//   sudo -n zcat -f /var/log/nginx/access.log* | node /srv/postmark-office/tools/arrivals.mjs --log - [--days 14] [--json]
//   node tools/arrivals.mjs [--days 14]          the store's counts only, with no log
//
//   env: WORLD2_PG_URL (or PG*), the office's own store. Reads only through
//        arrival_sources_daily() (086) and the berths' public counts; writes
//        nothing. The access log is root:adm on the box, so the operator pipes
//        it in with sudo rather than the office reading it.
//
// ── WHY ─────────────────────────────────────────────────────────────────────
// Darko, 2026-10-22 23:03: "is there any way that we can track where people
// will be coming? Because we did just post in a couple of places just now."
// Outreach links carry `?from=<tag>` (src/arrival-source.mjs § FROM_TAGS).
// A tag in the access log shows a visit; a household's private came_from shows
// a join. This prints both, side by side, per day on Darko's clock (US-Eastern):
//
//   · visits     page views whose link carried a listed `from=` tag, per tag
//                (GET requests answered 2xx/3xx, llms.txt and join/agent.md
//                included; the office's /api/ calls and static assets are not);
//   · settled    households whose declaration landed a tag, per tag (086);
//   · agents     keyless berths minted, per town each claimed to sail from
//                (chartered towns named, every other claim summed in other,
//                exactly as GET /berth counts them);
//   · referrers  page views arriving from another site, per referring host.
//
// COUNTS ONLY. No address, agent string, path beyond the tag, or person is
// printed or kept (POS-770: "Not this: any per-person tracking").

import { createReadStream, realpathSync } from "node:fs";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { FROM_TAGS } from "../src/arrival-source.mjs";

/** The day an instant falls on, on Darko's clock (US-Eastern), as YYYY-MM-DD. */
export function dayET(at) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(at));
}

const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
// The box's `vhost` format: $host $remote_addr - $remote_user [$time_local] "$request" $status $bytes "$referer" "$agent"
const LINE = /^(\S+) \S+ \S+ \S+ \[(\d{2})\/(\w{3})\/(\d{4}):(\d{2}):(\d{2}):(\d{2}) ([+-]\d{4})\] "(\S+) (\S+) [^"]*" (\d{3}) \S+ "([^"]*)"/;
const ASSET = /\.(js|mjs|css|png|jpe?g|gif|webp|svg|ico|woff2?|ttf|map|json|xml|mp4|webm)$/i; // llms.txt and agent.md are pages: the issue's first tagged links pointed at /llms.txt

/** One access-log line, read for counting: `{ at, path, query, status, method, referrer, host }`, or null. */
export function parseLine(line) {
  const m = LINE.exec(line);
  if (!m) return null;
  const [, host, dd, mon, yyyy, hh, mi, ss, tz, method, target, status, referrer] = m;
  const sign = tz[0] === "-" ? -1 : 1;
  const offsetMin = sign * (Number(tz.slice(1, 3)) * 60 + Number(tz.slice(3, 5)));
  const at = new Date(Date.UTC(Number(yyyy), MONTHS[mon], Number(dd), Number(hh), Number(mi), Number(ss)) - offsetMin * 60000);
  const q = target.indexOf("?");
  return { at, host, method, path: q < 0 ? target : target.slice(0, q), query: q < 0 ? "" : target.slice(q + 1), status: Number(status), referrer };
}

/** Is this request a page view (a GET answered 2xx/3xx, not the API, not an asset)? */
export const isPageView = (r) => r.method === "GET" && r.status >= 200 && r.status < 400
  && !r.path.startsWith("/api/") && !r.path.startsWith("/_astro/") && !ASSET.test(r.path);

/** The listed tag a request's query carries, or null. */
export function tagOf(query) {
  let raw = null;
  try { raw = new URLSearchParams(query).get("from"); } catch { return null; }
  const tag = String(raw ?? "").trim().toLowerCase();
  return FROM_TAGS.includes(tag) ? tag : null;
}

/** The referring host of an off-site page view, or null (none, ours, or unreadable). */
export function referrerHost(referrer, ownHost) {
  if (!referrer || referrer === "-") return null;
  try {
    const h = new URL(referrer).hostname.toLowerCase();
    return h && h !== ownHost && !h.endsWith(`.${ownHost}`) ? h : null;
  } catch { return null; }
}

/**
 * Fold parsed lines into per-day counts: `{ visits: {day: {tag: n}}, referrers: {day: {host: n}} }`.
 * `since` (a Date) drops older lines.
 */
export function foldLog(lines, { since = null } = {}) {
  const visits = {}, referrers = {};
  const bump = (o, day, k) => { (o[day] ??= {})[k] = (o[day][k] ?? 0) + 1; };
  for (const r of lines) {
    if (!r || !isPageView(r) || (since && r.at < since)) continue;
    const day = dayET(r.at);
    const tag = tagOf(r.query);
    if (tag) bump(visits, day, tag);
    const ref = referrerHost(r.referrer, r.host);
    if (ref) bump(referrers, day, ref);
  }
  return { visits, referrers };
}

/** The whole report, as rows per day, newest first. */
export function report({ visits = {}, referrers = {}, settled = [], agents = [] }) {
  const days = new Set([...Object.keys(visits), ...Object.keys(referrers), ...settled.map((s) => s.day), ...agents.map((a) => a.day)]);
  return [...days].sort().reverse().map((day) => ({
    day,
    visits: visits[day] ?? {},
    settled: Object.fromEntries(settled.filter((s) => s.day === day).map((s) => [s.tag, s.n])),
    agents: Object.fromEntries(agents.filter((a) => a.day === day).map((a) => [a.town, a.n])),
    referrers: referrers[day] ?? {},
  }));
}

const line = (label, counts) => {
  const parts = Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k, n]) => `${k} ${n}`);
  return `  ${label.padEnd(10)}${parts.length ? parts.join(" · ") : "none"}`;
};
export function printReport(rows, { log = true } = {}) {
  if (!rows.length) return "nothing in this range.\n";
  return rows.map((r) => [`${r.day} (ET)`,
    ...(log ? [line("visits", r.visits)] : []),
    line("settled", r.settled), line("agents", r.agents),
    ...(log ? [line("referrers", r.referrers)] : [])].join("\n")).join("\n\n") + "\n"
    + (log ? "" : "\n(no --log: visits and referrers need the access log piped in)\n");
}

/** Keyless berths minted per day (ET) and town, chartered towns named and the rest in `other` (GET /berth's rule). */
export function agentsByDay(rows, chartered) {
  const named = new Set(chartered);
  const out = new Map();
  for (const r of rows) {
    const day = dayET(Number(r.created) * 1000);
    const town = r.from_town == null ? "none" : named.has(r.from_town) ? r.from_town : "other";
    const k = `${day}|${town}`;
    out.set(k, (out.get(k) ?? 0) + Number(r.n ?? 1));
  }
  return [...out].map(([k, n]) => { const [day, town] = k.split("|"); return { day, town, n }; });
}

const isMain = (() => {
  if (!process.argv[1]) return false;
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
})();
if (isMain) {
  const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
  const days = Number(arg("--days") ?? 14);
  if (!Number.isInteger(days) || days < 1 || days > 400) { console.error(`--days takes a whole number of days, 1 to 400, not "${arg("--days")}"`); process.exit(2); }
  const since = new Date(Date.now() - days * 864e5);
  const logArg = arg("--log");
  let folded = { visits: {}, referrers: {} };
  if (logArg) {
    const parsed = [];
    const input = logArg === "-" ? process.stdin : createReadStream(logArg);
    for await (const l of createInterface({ input, crlfDelay: Infinity })) { const r = parseLine(l); if (r) parsed.push(r); }
    folded = foldLog(parsed, { since });
  }
  const { actsQuery } = await import("../src/world2-acts.mjs");
  const { dailySources } = await import("../src/arrival-source.mjs");
  const { CHARTERED_SHORES } = await import("./harbor-watch.mjs");
  const settled = (await dailySources({ since: since.toISOString() })) ?? [];
  const berths = (await actsQuery(
    "SELECT created, from_town, count(*)::int AS n FROM oauth_berths WHERE created >= $1 GROUP BY created, from_town", [Math.floor(since.getTime() / 1000)])) ?? [];
  const rows = report({ ...folded, settled, agents: agentsByDay(berths, CHARTERED_SHORES) });
  process.stdout.write(process.argv.includes("--json") ? JSON.stringify(rows, null, 1) + "\n" : printReport(rows, { log: Boolean(logArg) }));
  process.exit(0);
}
