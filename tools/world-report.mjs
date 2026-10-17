#!/usr/bin/env node
// world-report.mjs — the postmark.town/ops/world dashboard generator.
//
// The operator's window on the World (silver: postmark-ops-world-dashboard;
// Keemin 2026-07-27: "who is staking on creating marks is definitely the
// first-class thing I need to be able to stay on top of"). v1 is the cheap
// generator route (the traffic-report pattern): one static page, hourly cron.
//
// Sources (all already on the box — this dashboard aggregates, it never logs):
//   1. world record  — git show origin/main:WORLD/world-state.json in the
//      office world-clone (marks: by/date/tier/household/stamps)
//   2. settlements   — settlement/* tags + origin/draft/* refs, same clone
//   3. stake ledger  — town-clone WHITE_PAGES/stamp-ledger.md
//      (`stake:world-mark/<id>` lines: date · staker · mark · amount)
//   4. office telemetry — telemetry/access-*.jsonl AND .jsonl.gz (cold days are
//      compressed), mcp tool names only
//      (aggregate counts; per-household read logs deliberately NOT rendered —
//      the silver's red-pen Q3, deferred on purpose)
//   5. site pin      — raw.githubusercontent postmark-site/main/package.json
//      (fail-soft: the chip reads "unfetched" rather than lying)
//
// Output: /var/www/postmark-ops/world/index.html (+ data.json beside it).
// Freshness is in-body (generated_at + source commits) — the doorstep-truth
// law applies to our own instruments first.

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync, createReadStream } from "node:fs";
import { join } from "node:path";
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import * as V from "./lib/ops-viz.mjs";

const WORLD_CLONE = process.env.WORLD_CLONE || "/srv/postmark-office/world-clone";
const TOWN_CLONE = process.env.TOWN_CLONE || "/srv/postmark-office/town-clone";
const OFFICE_TEL = process.env.OFFICE_TELEMETRY || "/srv/postmark-office/telemetry";
const OUT_DIR = process.env.OUT_DIR || "/var/www/postmark-ops/world";
const PIN_URL = "https://raw.githubusercontent.com/postmark-town/postmark-site/main/package.json";

const git = (repo, args) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" });

// ── 1. the world record, from origin/main (never the pen's working tree) ─────
const worldMainSha = git(WORLD_CLONE, ["rev-parse", "--short", "refs/remotes/origin/main"]).trim();
const state = JSON.parse(git(WORLD_CLONE, ["show", "refs/remotes/origin/main:WORLD/world-state.json"]));
const marks = Array.isArray(state.marks) ? state.marks : [];

// mark dates arrive in mixed grain (day-only and full ISO) — normalize to the
// day for grouping, keep the full string for ordering within a day.
const day = (d) => String(d ?? "").slice(0, 10);
const marksByDate = marks.slice().sort((a, b) => String(b.date).localeCompare(String(a.date)));
const householdCounts = {};
for (const m of marks) householdCounts[m.household ?? m.by ?? "?"] = (householdCounts[m.household ?? m.by ?? "?"] || 0) + 1;
const perDay = {};
for (const m of marks) if (m.date) perDay[day(m.date)] = (perDay[day(m.date)] || 0) + 1;

// ── 2. settlement health + draft census ──────────────────────────────────────
const tagLines = git(WORLD_CLONE, ["for-each-ref", "refs/tags/settlement", "--sort=creatordate",
  "--format=%(refname:short)\t%(creatordate:iso8601)\t%(objectname:short)"]).trim().split("\n").filter(Boolean);
const lastTag = tagLines.length ? tagLines[tagLines.length - 1].split("\t") : null;
const lastTagAgeH = lastTag ? (Date.now() - new Date(lastTag[1]).getTime()) / 36e5 : null;
// the law is twice daily (06/18 UTC): green under 14h, amber to 26h, red past.
const crossStatus = lastTagAgeH == null ? "red" : lastTagAgeH < 14 ? "ok" : lastTagAgeH < 26 ? "warn" : "red";

const drafts = git(WORLD_CLONE, ["for-each-ref", "refs/remotes/origin/draft", "--format=%(refname:short)"])
  .trim().split("\n").filter(Boolean).map((ref) => {
    let ahead = 0;
    try { ahead = Number(git(WORLD_CLONE, ["rev-list", "--count", `refs/remotes/origin/main..${ref}`]).trim()); } catch {}
    return { household: ref.replace(/^origin\/draft\//, ""), ahead };
  });

// ── 3. the stake feed (first-class) ──────────────────────────────────────────
const ledgerText = readFileSync(join(TOWN_CLONE, "WHITE_PAGES", "stamp-ledger.md"), "utf8");
const townSha = git(TOWN_CLONE, ["rev-parse", "--short", "HEAD"]).trim();
const stakes = [];
for (const ln of ledgerText.split("\n")) {
  const m = ln.match(/^- (\d{4}-\d{2}-\d{2}) · (\S+) → stake:world-mark\/(\S+) · (\d+)/);
  if (m) stakes.push({ date: m[1], staker: m[2], mark: m[3], stamps: Number(m[4]) });
}
stakes.reverse(); // ledger is append-only; newest first for the feed
const stakerTotals = {};
for (const s of stakes) stakerTotals[s.staker] = (stakerTotals[s.staker] || 0) + s.stamps;

// ── 4. world tool traffic, aggregate only ────────────────────────────────────
const WRITE_TOOLS = new Set(["world_leave_mark", "world_walk", "world_stake", "world_gift", "world_edit"]);
const toolDays = {}; // date -> tool -> count
// .jsonl AND .jsonl.gz, mirroring traffic-report's 2026-08-09 loop. A day's
// telemetry is gzipped once it goes cold, and this panel used to lose those days
// twice over: `startsWith("access-")` matched the .gz files, so they were read
// as utf8 text, split on newlines, and every binary "line" silently failed the
// `"mcp":"world_` test — AND they still counted against the 14-file budget, so
// each cold day also pushed a readable day out of the window. The panel was
// therefore under-reporting on both edges, quietly, on a live page.
//
// Streamed rather than read whole for the same reason the traffic sources are:
// a gunzipped day can be large, and this runs on a 1.9 GB box.
if (existsSync(OFFICE_TEL)) {
  const files = readdirSync(OFFICE_TEL)
    .filter((f) => f.startsWith("access-") && (f.endsWith(".jsonl") || f.endsWith(".jsonl.gz")))
    .sort().slice(-14);
  for (const f of files) {
    const input = f.endsWith(".gz")
      ? createReadStream(join(OFFICE_TEL, f)).pipe(createGunzip())
      : createReadStream(join(OFFICE_TEL, f));
    try {
      for await (const ln of createInterface({ input, crlfDelay: Infinity })) {
        if (!ln.includes('"mcp":"world_')) continue;
        try {
          const r = JSON.parse(ln);
          if (!r.mcp || !r.mcp.startsWith("world_")) continue;
          const d = String(r.ts).slice(0, 10);
          (toolDays[d] ??= {})[r.mcp] = (toolDays[d][r.mcp] || 0) + 1;
        } catch {}
      }
    } catch {} // a truncated or half-written .gz must not take the whole page down
  }
}
const toolTotals = {};
for (const d of Object.values(toolDays)) for (const [t, n] of Object.entries(d)) toolTotals[t] = (toolTotals[t] || 0) + n;
const readCount = Object.entries(toolTotals).filter(([t]) => !WRITE_TOOLS.has(t)).reduce((s, [, n]) => s + n, 0);
const writeCount = Object.entries(toolTotals).filter(([t]) => WRITE_TOOLS.has(t)).reduce((s, [, n]) => s + n, 0);

// ── 5. the site pin (fail-soft) ──────────────────────────────────────────────
let pin = null;
try {
  const pkg = await (await fetch(PIN_URL, { signal: AbortSignal.timeout(8000) })).json();
  pin = String(pkg.dependencies?.["postmark-world"] ?? "").split("#")[1]?.slice(0, 7) ?? null;
} catch {}
const worldMainFull = git(WORLD_CLONE, ["rev-parse", "refs/remotes/origin/main"]).trim();
const pinStatus = pin == null ? "warn" : worldMainFull.startsWith(pin) ? "ok" : "warn";



// ── render ───────────────────────────────────────────────────────────────────
// RECENCY FIRST (2026-08-11). "612 marks in the world" led this page; it is a
// stock, and it will read 612 tomorrow whatever anybody does today. The page
// now opens on the week — marks left, stamps staked, who was at the door — and
// the totals sit under "the long view".
//
// One thing stays a list on purpose: the stake feed. A stake is an EVENT with a
// who and a when — Keemin's stated first-class thing for this dash — and events
// are read, not measured; the measuring is in the chart beside it.
const now = new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC";
const { esc, comma, chip } = V;
const top = (obj, n) => Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, n);
const days14 = [...Array(14)].map((_, i) => new Date(Date.now() - i * 864e5).toISOString().slice(0, 10)).reverse();
const days30 = [...Array(30)].map((_, i) => new Date(Date.now() - i * 864e5).toISOString().slice(0, 10)).reverse();
const dd = (d) => d.slice(5);

const WIN = V.windows(7);
const W7 = WIN.size;

// ── the week ─────────────────────────────────────────────────────────────────
const markWin = WIN.sum(perDay);
const stakeWin = { cur: 0, prev: 0 }, stakeLines = { cur: 0, prev: 0 };
const stakedByMarkWin = {}, stakersWin = {};
for (const s of stakes) {
  const side = WIN.inCur(s.date) ? "cur" : WIN.inPrev(s.date) ? "prev" : null;
  if (!side) continue;
  stakeWin[side] += s.stamps; stakeLines[side] += 1;
  if (side === "cur") {
    stakedByMarkWin[s.mark] = (stakedByMarkWin[s.mark] || 0) + s.stamps;
    stakersWin[s.staker] = (stakersWin[s.staker] || 0) + s.stamps;
  }
}
// marks left this week, by household — who is building right now
const markHouseWin = {};
for (const m of marks) {
  const d = day(m.date);
  if (WIN.inCur(d)) markHouseWin[m.household ?? m.by ?? "?"] = (markHouseWin[m.household ?? m.by ?? "?"] || 0) + 1;
}
// world door: the tool feed is a trailing 14 days by construction, so the
// window here is 7d against the 7 before it inside that same feed.
const toolWin = { cur: 0, prev: 0 }, writeWin = { cur: 0, prev: 0 }, toolsCur = {};
for (const [d, tools] of Object.entries(toolDays)) {
  const side = WIN.inCur(d) ? "cur" : WIN.inPrev(d) ? "prev" : null;
  if (!side) continue;
  for (const [t, n] of Object.entries(tools)) {
    toolWin[side] += n;
    if (WRITE_TOOLS.has(t)) writeWin[side] += n;
    if (side === "cur") toolsCur[t] = (toolsCur[t] || 0) + n;
  }
}
const draftsAhead = drafts.reduce((s, d) => s + d.ahead, 0);
const stakedTotal = stakes.reduce((s, x) => s + x.stamps, 0);

let shadow = null;
try { shadow = JSON.parse(readFileSync("/srv/postmark-harbor/settlement-shadow.json", "utf8")); } catch { /* absent until the first run — the card says so */ }
const shadowAgeH = shadow ? (Date.now() - Date.parse(shadow.at)) / 3.6e6 : null;
const shadowStatus = !shadow ? "warn" : shadow.status === "would-settle" ? (shadowAgeH > 2.5 ? "warn" : "ok") : "bad";

const kpiRow = V.kpis([
  { label: `marks left · last ${W7}d`, value: comma(markWin.cur),
    sub: V.deltaLine(markWin.cur, markWin.prev, { size: W7 }),
    spark: V.sparkline(days30.map((d) => perDay[d] || 0), { title: "new marks per day, last 30d" }) },
  { label: `staked · last ${W7}d`, value: `${comma(stakeWin.cur)}✦`,
    sub: stakeLines.cur ? V.deltaLine(stakeWin.cur, stakeWin.prev, { size: W7, unit: "✦" }) : `no stake in the last ${W7}d` },
  { label: "last crossing", value: lastTagAgeH == null ? "—" : `${lastTagAgeH.toFixed(1)}h`,
    sub: lastTag ? `${lastTag[0]} · ${lastTag[1].slice(0, 16)}` : "no settlement tag found",
    status: crossStatus },
  { label: "next crossing (shadow)", value: !shadow ? "no verdict yet" : shadow.status,
    sub: !shadow ? "the shadow has not run on this box" : `${shadowAgeH.toFixed(1)}h old · ${String(shadow.detail ?? "").slice(0, 80)}`,
    status: shadowStatus },
  { label: "drafts ahead of main", value: comma(draftsAhead),
    sub: `${drafts.filter((d) => d.ahead > 0).length} household branch(es) unsettled`,
    status: draftsAhead > 20 ? "warn" : "ok" },
  { label: `door calls · last ${W7}d`, value: comma(toolWin.cur),
    sub: `${comma(writeWin.cur)} of them writes · ${V.deltaLine(toolWin.cur, toolWin.prev, { size: W7 })}`,
    spark: V.sparkline(days14.map((d) => Object.values(toolDays[d] || {}).reduce((a, b) => a + b, 0)), { title: "world_* calls per day, last 14d" }) },
]);

// ── crossing health as a meter against its own law ───────────────────────────
const crossColor = crossStatus === "ok" ? V.OK : crossStatus === "warn" ? V.WARN : V.BAD;
const crossMeter = V.meter({
  value: Math.min(lastTagAgeH ?? 40, 40), max: 40, color: crossColor,
  valueText: lastTagAgeH == null ? "no settlement tag found" : `${lastTagAgeH.toFixed(1)}h since the last crossing`,
  ticks: [{ at: 14, label: "14h" }, { at: 26, label: "26h" }, { at: 40, label: "40h+" }],
});

// ── the draft census ─────────────────────────────────────────────────────────
// Only branches actually ahead get a bar: a settled draft is a zero-length bar,
// and a column of those is noise standing where the signal should be.
const ahead = drafts.filter((d) => d.ahead > 0).sort((a, b) => b.ahead - a.ahead);
const settled = drafts.length - ahead.length;
const draftBars = V.bars({
  rows: ahead.map((d) => ({ label: d.household, values: { n: d.ahead } })),
  keys: ["n"], colors: { n: V.SERIES[0] }, unit: " commits", empty: "every household draft branch is level with main",
});

// ── staking: this week's totals as a chart, the feed as a feed ───────────────
const stakerBars = V.bars({
  rows: Object.entries(stakersWin).sort((a, b) => b[1] - a[1]).map(([w, n]) => ({ label: w, values: { n } })),
  keys: ["n"], colors: { n: V.SERIES[3] }, unit: "✦", empty: `nobody staked on a mark in the last ${W7} days`,
});
const markStakeBars = V.bars({
  rows: Object.entries(stakedByMarkWin).sort((a, b) => b[1] - a[1]).slice(0, 14).map(([m, n]) => ({ label: m, values: { n } })),
  keys: ["n"], colors: { n: V.SERIES[1] }, unit: "✦", empty: `no mark gained backing in the last ${W7} days`,
});
const stakeFeed = stakes.length
  ? `<div class="tablewrap">${V.table(["date", "staker", "mark", "✦"], stakes.slice(0, 24).map((s) =>
      [`<span class="dim">${esc(s.date)}</span>`, `<span class="who">${esc(s.staker)}</span>`, esc(s.mark),
        `<span class="num">${s.stamps}</span>`]))}</div>`
  : `<p class="none">no world-mark stakes yet</p>`;

// ── mark creation ────────────────────────────────────────────────────────────
const markChart = V.columns({
  rows: days30.map((d) => ({ label: dd(d), values: { marks: perDay[d] || 0 } })),
  keys: ["marks"], colors: { marks: V.SERIES[1] }, fmt: comma,
});
const markWeekBars = V.bars({
  rows: Object.entries(markHouseWin).sort((a, b) => b[1] - a[1]).slice(0, 16).map(([h, n]) => ({ label: h, values: { n } })),
  keys: ["n"], colors: { n: V.SERIES[1] }, empty: `no household left a mark in the last ${W7} days`,
});
const markTable = V.table(["date", "by", "tier", "mark", "✦"], marksByDate.slice(0, 60).map((m) =>
  [`<span class="dim">${esc(day(m.date))}</span>`, `<span class="who">${esc(m.by ?? "")}</span>`,
    `<span class="dim">${esc(m.tier ?? "")}</span>`, esc(m.id ?? ""), `<span class="num">${m.stamps ?? 0}</span>`]));

// ── door traffic ─────────────────────────────────────────────────────────────
const doorBar = V.bars({
  rows: [{ label: `world_* calls · ${W7}d`, values: { reads: toolWin.cur - writeWin.cur, writes: writeWin.cur } }],
  keys: ["reads", "writes"], colors: { reads: V.SERIES[2], writes: V.SERIES[0] },
  empty: `no world tool call in the last ${W7} days`,
});
const toolBars = V.bars({
  rows: top(toolsCur, 14).map(([t, n]) => ({ label: t, values: { n }, note: WRITE_TOOLS.has(t) ? "write" : "read" })),
  keys: ["n"], colors: { n: V.SERIES[2] }, empty: `no world tool call in the last ${W7} days`,
});

const body = `
${kpiRow}

<h2>crossing health</h2>
<p class="note">The law is two crossings daily (06:00 / 18:00 UTC): green under 14h, amber to 26h, red past. The bar is the clock since the last settlement tag, drawn against those thresholds rather than left as a number to compare in your head.</p>
<div class="plotwrap">${crossMeter}</div>
<p>${chip(pinStatus, pin == null ? "site pin: unfetched" : pinStatus === "ok" ? `site pin ${pin} = world main` : `site pin ${pin} ≠ world main ${worldMainSha}`)}</p>

${V.figure({
  title: "draft census — commits ahead of main, by household",
  note: `Work that exists but has not settled. A bar that keeps growing across days is a household whose draft is not crossing. ${settled} of ${drafts.length} draft branch(es) are level with main and are not drawn.`,
  chart: draftBars,
})}

<h2>who is staking — the first-class feed</h2>
<p class="note">${comma(stakeWin.cur)}✦ staked in the last ${W7} days across ${stakeLines.cur} line(s), by ${Object.keys(stakersWin).length} household(s). The charts are the week; the feed beneath is the last 24 stakes whenever they happened, and it stays a list on purpose — a stake is an event with a who and a when, and events are read, not measured.</p>
<div class="grid2">
<div>${V.figure({ title: `stakers · last ${W7}d`, chart: stakerBars })}</div>
<div>${V.figure({ title: `marks backed · last ${W7}d`, chart: markStakeBars })}</div>
</div>
${stakeFeed}

${V.figure({
  title: "mark creation — new marks per day (last 30d)",
  chart: markChart, detail: markTable, detailLabel: `the newest 60 of ${marks.length} marks`,
})}

${V.figure({
  title: `who is building — marks left in the last ${W7} days, by household`,
  note: `Ranked by the window, not by lifetime: the all-time table has sat at the same order for weeks, and it is under the long view now.`,
  chart: markWeekBars,
})}

<h2>world door traffic — last ${W7} days</h2>
<p class="note">MCP <code>world_*</code> tools, counts only — per-household read logs are deliberately not rendered (the silver's red-pen Q3, deferred on purpose). Reads and writes share one bar because the <em>ratio</em> is the reading: a world being looked at, or a world being changed. The telemetry feed itself is a trailing 14 days, so the prior window is the older half of it.</p>
${V.legend([{ name: `reads (${comma(toolWin.cur - writeWin.cur)})`, color: V.SERIES[2] }, { name: `writes (${comma(writeWin.cur)})`, color: V.SERIES[0] }])}
${doorBar}
<h3>calls by tool · last ${W7}d</h3>
${toolBars}

${V.longView(
  `Everything above reads the last ${W7} days. These are the world's totals — the register's size and the whole staking history — kept because the shape of the world matters, moved down because it is not what changed today.`,
  V.kpis([
    { label: "marks in the world", value: comma(marks.length), sub: `${Object.keys(householdCounts).length} households have left one` },
    { label: "stakes, all time", value: comma(stakes.length), sub: `${comma(stakedTotal)}✦ escrowed on marks` },
    { label: "door calls, 14d feed", value: comma(readCount + writeCount), sub: `${comma(writeCount)} writes · ${comma(readCount)} reads` },
  ]) + V.figure({
    title: "marks per household, all time",
    chart: V.bars({
      rows: top(householdCounts, 18).map(([h, n]) => ({ label: h, values: { n }, note: markHouseWin[h] ? `${markHouseWin[h]} this week` : "none this week" })),
      keys: ["n"], colors: { n: V.MUTED },
    }),
    detail: V.table(["household", "all time", `last ${W7}d`], Object.entries(householdCounts).sort((a, b) => b[1] - a[1])
      .map(([h, n]) => [`<span class="who">${esc(h)}</span>`, `<span class="num">${n}</span>`,
        `<span class="num dim">${markHouseWin[h] || 0}</span>`])),
    detailLabel: `all ${Object.keys(householdCounts).length} households`,
  }),
)}
`;

const html = V.page({
  title: "postmark · ops · world",
  h1: "the World — operator dashboard", sub: "postmark.town/ops/world",
  here: "/ops/world/",
  stamp: `generated ${esc(now)} · world origin/main <code>${esc(worldMainSha)}</code> · town <code>${esc(townSha)}</code> · regenerates hourly · <a href="data.json">data.json</a>`,
  body,
  footer: `Sources: the world record at origin/main (marks, never telemetry) · settlement tags + draft refs · the town's stamp-ledger (stake lines) · office telemetry (tool names only, aggregated) · the site's pin via raw.githubusercontent (fail-soft). Windows are measured against the clock, so a quiet week reads as a quiet week rather than sliding back to wherever the data stops. A fetch is a fetch; git-clone readership is invisible in principle. Unlinked + noindex; the operator hub is <a href="/ops/">/ops/</a>.`,
});

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, "index.html"), html);
writeFileSync(join(OUT_DIR, "data.json"), JSON.stringify({
  generated_at: now, world_main: worldMainSha, town: townSha,
  crossing: { last: lastTag, age_hours: lastTagAgeH == null ? null : Number(lastTagAgeH.toFixed(2)), status: crossStatus },
  pin: { sha: pin, status: pinStatus }, drafts,
  stakes: { count: stakes.length, totals: stakerTotals, feed: stakes.slice(0, 100) },
  marks: { total: marks.length, per_household: householdCounts, per_day_14: Object.fromEntries(days14.map((d) => [d, perDay[d] || 0])) },
  tools: { totals: toolTotals, reads: readCount, writes: writeCount },
  // added 2026-08-11 beside every pre-existing field: the window the page leads with
  recent: {
    window_days: W7, from: WIN.curFrom, to: WIN.curTo, prior_from: WIN.prevFrom, prior_to: WIN.prevTo,
    marks: markWin, staked: stakeWin, stake_lines: stakeLines,
    door_calls: toolWin, door_writes: writeWin,
    marks_by_household: markHouseWin, staked_by_mark: stakedByMarkWin, stakers: stakersWin,
  },
}, null, 2));
console.log(`world-report: wrote ${OUT_DIR}/index.html (${markWin.cur} marks + ${stakeWin.cur}✦ staked in the last ${W7}d; ${marks.length} marks all time, crossing ${crossStatus})`);
