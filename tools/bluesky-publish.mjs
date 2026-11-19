#!/usr/bin/env node
// bluesky-publish.mjs — post the town's day as @postmark.town (POS-904 Part 1).
//
//   node tools/bluesky-publish.mjs crossing   --town <town clone>  --state <dir> [--crossing <n>]   [--service <url>]
//   node tools/bluesky-publish.mjs settlement --world <world clone> --state <dir> [--settlement <n>] [--service <url>]
//
// One publisher (src/bluesky-publisher.mjs § publishEvent), two events:
//
//   crossing     a crossing whose Daily Ferry curated and committed: the town
//                clone's committed history of TOWN_BULLETIN/ferrys-daily.md
//                (never the working tree), its newest version for that crossing
//                that has a lead headline. "Crossing <n> · Ferry's Daily:
//                <headline>" and https://postmark.town/daily/, rkey crossing-<n>.
//                A crossing with no curated Daily has no post.
//   settlement   a BLESSED settlement, a `settlement/S<n>` tag in the world clone
//                (the keeper's pen; a mechanical publish is not a blessing). Its
//                changes are counted from the World's own record at S<n> against
//                the previous blessed tag; the link is
//                https://postmark.town/replay/#S<n>. rkey settlement-<n>.
//
// AFTER EACH, WITH NO AGE AND NO GAP (the lead's review at 054812e7; Rivet's
// technical settlement 2026-11-19 05:33Z). Each run, for its one kind:
//   1. CARRY. Every event whose state is not yet posted or failed (pending,
//      sending, waiting) is published again from its own state, with the words
//      first composed, before any source is read: a changed Daily or a newer
//      blessing never strands it, however old it is.
//   2. THE FLOOR is the highest event of this kind recorded in --state.
//      · No state for the kind: nothing is chosen for the operator. The run
//        answers `unstarted` until the operator names the first event with
//        --crossing <n> / --settlement <n>, which posts that one alone.
//      · Thereafter every eligible event above the floor is posted, oldest
//        first: two blessings, or two crossings, between runs are two posts.
//   3. NO GAP BELOW THE FLOOR. Discovery stops at the first eligible event it
//      cannot record: a record that cannot be read (`held`), a lock another run
//      holds (`busy`), no credential (`unconfigured`). Nothing above it is
//      posted, so the floor never passes an owed event; the next run starts
//      there again.
//   · --crossing <n> / --settlement <n> at or below the floor posts exactly that
//     event (or answers from its state) and moves no floor. Above the floor it
//     posts every eligible event up to and including n, oldest first, so it
//     never steps past an owed one.
//
// Safe to run on every tick and from a repeated or concurrent hook: an event
// already posted is answered from its state file with no network; an event
// another run holds is left to it.
//
// ENV: BSKY_IDENTIFIER and BSKY_APP_PASSWORD, from the posting unit's
// EnvironmentFile (Jetto's box half). Neither, nor the session's token, is ever
// printed or written. Without both: `unconfigured`, nothing read or sent.
//
// --state <dir>   the per-event state files and locks, REQUIRED: the hook names a
//                 directory the posting unit may write, outside any checkout (one
//                 directory for both events, so a post is single across hooks).
//                 It is each event's whole history, and the floor: keep it.
// --service <url> the account's PDS (default https://bsky.social); tests point it at a fake
//
// OUT: one JSON line per event the run acted on, oldest first:
//   { event, rkey, outcome, sends, uri?, detail? }   (publishEvent's receipt)
//   { event, rkey, outcome: "held", detail }          an owed event whose record cannot be read
//   { event, outcome: "skipped", detail }             a named event with nothing to post
// or, when it acted on none, one line { kind, outcome: "skipped" | "unstarted", detail }.
// EXIT: the most urgent line's: 1 failed (both sends spent, logged, never sent
// again) · 3 waiting, held, unconfigured or unstarted (nothing more sent; the
// next run asks again) · 0 posted, reconciled, already, busy or skipped ·
// 2 cannot run (usage).

import { execFileSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DEFAULT_SERVICE, crossingEvent, publishEvent, recordedEvents, rkeyFor, settlementChanges, settlementEvent } from "../src/bluesky-publisher.mjs";
import { parseSettlementTags, readSettlementTags } from "../src/settlements.mjs";
import { dailyFingerprint } from "./site-sentinel.mjs";

export const DAILY_PATH = "TOWN_BULLETIN/ferrys-daily.md";

const show = (repo, ref, path) => {
  try { return execFileSync("git", ["-C", repo, "show", `${ref}:${path}`], { encoding: "utf8", maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "ignore"] }); }
  catch { return null; }
};
const json = (text) => { try { return text == null ? null : JSON.parse(text); } catch { return null; } };

/**
 * The crossings with a curated Daily in the town clone's committed history, from
 * crossing `from` to `to`, oldest first: `{ events: [{ event }] }`, or `{ held }`
 * when the history cannot be read. Each crossing's words are its newest committed Daily
 * that has a lead headline. The walk runs newest first and stops at the first
 * Daily naming a crossing below `from`.
 */
export function crossingsFromTown(town, { from, to = Infinity }) {
  let log;
  try {
    log = execFileSync("git", ["-C", town, "log", "--format=%H", "--diff-filter=AM", "HEAD", "--", DAILY_PATH],
      { encoding: "utf8", maxBuffer: 1 << 26, stdio: ["ignore", "pipe", "ignore"] }).split("\n").filter(Boolean);
  } catch { return { held: `the committed history of ${DAILY_PATH} in ${town} cannot be read` }; }
  const byN = new Map();
  for (const sha of log) {
    const markdown = show(town, sha, DAILY_PATH);
    if (markdown == null) return { held: `${DAILY_PATH} at ${sha.slice(0, 12)} cannot be read` };
    const fp = dailyFingerprint(markdown);
    const found = crossingEvent({ markdown, headline: fp.kind === "headline" ? fp.value : null });
    const n = found.event?.n ?? found.n;
    if (n == null) continue;
    if (n < from) break;
    if (found.event && n <= to && !byN.has(n)) byN.set(n, found.event);
  }
  return { events: [...byN.values()].sort((a, b) => a.n - b.n).map((event) => ({ event })) };
}

/**
 * The blessed settlements from S`from` to S`to`, oldest first, each `{ event }`,
 * `{ n, held }` (its record cannot be read whole) or `{ n, skip }` (no earlier
 * blessing to count against). Counted at S<n> against the previous blessed tag.
 */
export function settlementsFromWorld(world, { from, to = Infinity }) {
  const tags = parseSettlementTags(readSettlementTags(world));          // newest first
  const record = (t) => ({
    published: json(show(world, `settlement/S${t.n}`, "WORLD/settlement-publications.json"))?.published ?? null,
    households: json(show(world, `settlement/S${t.n}`, "WORLD/households.json"))?.households ?? null,
  });
  return tags.filter((t) => t.n >= from && t.n <= to).reverse().map((at) => {
    const prev = tags.find((t) => t.n < at.n);
    if (!prev) return { n: at.n, skip: `S${at.n} has no earlier blessed settlement to count its changes against` };
    return settlementEvent({ n: at.n, changes: settlementChanges({ before: record(prev), after: record(at) }) });
  });
}

const URGENCY = { failed: 1, waiting: 3, held: 3, unconfigured: 3, unstarted: 3 };
const exitFor = (lines) => (lines.some((l) => URGENCY[l.outcome] === 1) ? 1 : lines.some((l) => URGENCY[l.outcome] === 3) ? 3 : 0);

export async function main(argv, { env = process.env, fetch = globalThis.fetch, now = Date.now, out = (l) => console.log(l) } = {}) {
  const arg = (name) => { const i = argv.indexOf(`--${name}`); return i === -1 ? null : argv[i + 1]; };
  const [kind] = argv;
  if (!arg("state")) { console.error("--state <dir> is required: the per-event state the hook keeps outside any checkout"); return 2; }
  const source = kind === "crossing" ? arg("town") : kind === "settlement" ? arg("world") : null;
  if (!source) {
    console.error("usage: bluesky-publish.mjs crossing --town <town clone> --state <dir> [--crossing <n>] | settlement --world <world clone> --state <dir> [--settlement <n>]  [--service <url>]");
    return 2;
  }
  const named = arg(kind) == null ? null : Number(String(arg(kind)).replace(/^S/, ""));
  if (named != null && !(Number.isInteger(named) && named >= 0)) { console.error(`--${kind} takes a ${kind} number`); return 2; }

  const stateDir = resolve(arg("state"));
  const lines = [];
  const say = (line) => { lines.push(line); out(JSON.stringify(line)); };
  const publish = (event) => publishEvent(event, { stateDir, env, fetch, service: arg("service") ?? DEFAULT_SERVICE, now: () => new Date(now()) });
  const recorded = (n) => existsSync(join(stateDir, `${rkeyFor(kind, n)}.json`));

  // 1. CARRY every owed event from its own state, before any source is read
  const history = recordedEvents(stateDir, kind);
  const carried = new Set();
  for (const { n, state } of history) {
    if (state?.status === "posted" || state?.status === "failed") continue;
    const r = await publish({ kind, n, text: state?.payload?.text, link: state?.payload?.link });
    carried.add(n);
    say(r);
    if (r.outcome === "unconfigured") return exitFor(lines);
  }

  // 2. THE FLOOR, and what this run may post above it
  const floor = history.at(-1)?.n ?? null;
  const from = named != null && (floor == null || named <= floor) ? named : floor == null ? null : floor + 1;
  const to = named ?? Infinity;
  if (from == null) {
    say({ kind, outcome: "unstarted", detail: `no ${kind} has been posted from ${stateDir} yet: nothing is chosen for the operator; name the first with --${kind} <n>` });
    return exitFor(lines);
  }
  if (named != null && named === from && recorded(named)) {
    // a named event already recorded: answered from its state (carried above if it was owed)
    if (!carried.has(named)) say(await publish({ kind, n: named }));
    return exitFor(lines);
  }
  const single = named != null && named === from;

  // 3. DISCOVER, oldest first, never past an event this run could not record
  const found = kind === "crossing"
    ? crossingsFromTown(resolve(source), { from, to: single ? named : to })
    : { events: settlementsFromWorld(resolve(source), { from, to: single ? named : to }) };
  if (found.held) say({ kind, outcome: "held", detail: `${found.held}: nothing more is posted until it can be` });
  const events = found.events ?? [];
  const nOf = (e) => e.event?.n ?? e.n;
  if (single && !found.held && !events.some((e) => nOf(e) === named))
    say({ event: `${kind} ${named}`, outcome: "skipped", detail: kind === "crossing" ? `no committed Daily with a lead headline names crossing ${named}` : `no settlement/S${named} in ${source}: not blessed` });
  for (const e of events) {
    const n = nOf(e);
    if (recorded(n)) continue;
    if (e.held) { say({ event: `${kind} ${n}`, rkey: rkeyFor(kind, n), outcome: "held", detail: e.held }); break; }
    if (e.skip) { say({ event: `${kind} ${n}`, outcome: "skipped", detail: e.skip }); continue; }
    say(await publish(e.event));
    if (!recorded(n)) break;                   // busy or unconfigured: nothing past an event this run could not record
  }
  if (!lines.length) say({ kind, outcome: "skipped", detail: `nothing new above ${kind} ${floor}` });
  return exitFor(lines);
}

const isMain = (() => {
  if (!process.argv[1]) return false;
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return pathToFileURL(process.argv[1]).href === import.meta.url; }
})();
if (isMain) process.exitCode = await main(process.argv.slice(2));
