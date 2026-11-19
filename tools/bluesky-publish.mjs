#!/usr/bin/env node
// bluesky-publish.mjs — post the town's day as @postmark.town (POS-904 Part 1).
//
//   node tools/bluesky-publish.mjs crossing   --town <town clone>  --state <dir> [--service <url>]
//   node tools/bluesky-publish.mjs settlement --world <world clone> --state <dir> [--settlement <n>] [--service <url>]
//
// One publisher (src/bluesky-publisher.mjs § publishEvent), two events:
//
//   crossing     the Daily Ferry curated for the current crossing (or the one
//                before), read from the town clone's HEAD
//                (TOWN_BULLETIN/ferrys-daily.md): "Crossing <n> · Ferry's Daily:
//                <its lead headline>" and https://postmark.town/daily/, at rkey
//                crossing-<n>.
//   settlement   the newest BLESSED settlement, a `settlement/S<n>` tag in the
//                world clone (the keeper's pen; a mechanical publish is not a
//                blessing), blessed within the last day; or exactly S<n> with
//                --settlement. Its changes are counted from the World's own
//                record at S<n> against the previous blessed tag; the link is
//                https://postmark.town/replay/#S<n>. rkey settlement-<n>.
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
//                 directory for both events, so a post is single across hooks)
// --service <url> the account's PDS (default https://bsky.social); tests point it at a fake
//
// OUT: one JSON line on stdout, { event, rkey, outcome, sends, uri?, detail? },
// or { outcome: "skipped", detail } when there is nothing to post.
// EXIT: 0 posted, reconciled, already, busy or skipped · 1 failed (both sends
// spent, logged, never sent again) · 3 waiting or unconfigured (nothing sent;
// the next run asks again) · 2 cannot run (usage, an unreadable clone).

import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DEFAULT_SERVICE, crossingEvent, publishEvent, settlementChanges, settlementEvent } from "../src/bluesky-publisher.mjs";
import { currentCrossing } from "../src/crossings.mjs";
import { parseSettlementTags, readSettlementTags } from "../src/settlements.mjs";
import { dailyFingerprint } from "./site-sentinel.mjs";

const OFFICE = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const DAILY_PATH = "TOWN_BULLETIN/ferrys-daily.md";
export const BLESSED_WITHIN_MS = 24 * 3600 * 1000;

const show = (repo, ref, path) => {
  try { return execFileSync("git", ["-C", repo, "show", `${ref}:${path}`], { encoding: "utf8", maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "ignore"] }); }
  catch { return null; }
};
const json = (text) => { try { return text == null ? null : JSON.parse(text); } catch { return null; } };

/** The crossing event from the town clone's committed Daily. */
export function crossingFromTown(town, { now = Date.now() } = {}) {
  const markdown = show(town, "HEAD", DAILY_PATH);
  if (markdown == null) return { skip: `no ${DAILY_PATH} at ${town}'s HEAD` };
  const fp = dailyFingerprint(markdown);
  return crossingEvent({ markdown, headline: fp.kind === "headline" ? fp.value : null, current: currentCrossing(now) });
}

/** The settlement event: S<n> (or the newest, blessed within a day) against the previous blessed tag. */
export function settlementFromWorld(world, { n = null, now = Date.now() } = {}) {
  const tags = parseSettlementTags(readSettlementTags(world));
  if (!tags.length) return { skip: `${world} carries no settlement/S<n> tag` };
  const at = n == null ? tags[0] : tags.find((t) => t.n === n);
  if (!at) return { skip: `no settlement/S${n} in ${world}: not blessed` };
  if (n == null && !(at.date && now - Date.parse(at.date) <= BLESSED_WITHIN_MS))
    return { skip: `the newest blessing, S${at.n} (${at.date ?? "no date"}), is more than a day old: never posted late` };
  const prev = tags.find((t) => t.n < at.n);
  if (!prev) return { skip: `S${at.n} has no earlier blessed settlement to count its changes against` };
  const record = (t) => ({
    published: json(show(world, `settlement/S${t.n}`, "WORLD/settlement-publications.json"))?.published ?? null,
    households: json(show(world, `settlement/S${t.n}`, "WORLD/households.json"))?.households ?? null,
  });
  const after = record(at);
  const kindOf = (key) => {
    const path = after.published?.[key]?.path;
    const md = path ? show(world, `settlement/S${at.n}`, path) : null;
    return md == null ? null : (/^kind:\s*(\S+)/m.exec(md)?.[1] ?? null);
  };
  return settlementEvent({ n: at.n, changes: settlementChanges({ before: record(prev), after, kindOf }) });
}

const EXIT = { posted: 0, reconciled: 0, already: 0, busy: 0, skipped: 0, failed: 1, waiting: 3, unconfigured: 3 };

export async function main(argv, { env = process.env, fetch = globalThis.fetch, now = Date.now, out = (l) => console.log(l) } = {}) {
  const arg = (name) => { const i = argv.indexOf(`--${name}`); return i === -1 ? null : argv[i + 1]; };
  const [kind] = argv;
  let found;
  if (!arg("state")) { console.error("--state <dir> is required: the per-event state the hook keeps outside any checkout"); return 2; }
  if (kind === "crossing" && arg("town")) found = crossingFromTown(resolve(arg("town")), { now: now() });
  else if (kind === "settlement" && arg("world")) {
    const n = arg("settlement") == null ? null : Number(String(arg("settlement")).replace(/^S/, ""));
    if (n != null && !Number.isInteger(n)) { console.error("--settlement takes a settlement number"); return 2; }
    found = settlementFromWorld(resolve(arg("world")), { n, now: now() });
  } else {
    console.error("usage: bluesky-publish.mjs crossing --town <town clone> --state <dir> | settlement --world <world clone> --state <dir> [--settlement <n>]  [--service <url>]");
    return 2;
  }
  if (found.skip) { out(JSON.stringify({ outcome: "skipped", detail: found.skip })); return 0; }
  const receipt = await publishEvent(found.event, {
    stateDir: resolve(arg("state")), env, fetch, service: arg("service") ?? DEFAULT_SERVICE, now: () => new Date(now()),
  });
  out(JSON.stringify(receipt));
  return EXIT[receipt.outcome] ?? 1;
}

const isMain = (() => {
  if (!process.argv[1]) return false;
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return pathToFileURL(process.argv[1]).href === import.meta.url; }
})();
if (isMain) process.exitCode = await main(process.argv.slice(2));
