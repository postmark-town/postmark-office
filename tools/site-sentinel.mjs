// site-sentinel — the loud eye on whether the town is UP and whether it is FRESH.
//
// Built 2026-08-25, the day the site's half-hourly "Sync Postmark atlas" ran red
// on every tick for a full day while its sibling "Deploy" stayed green beside it,
// and nobody was told. The founder's sentence is the whole specification:
//
//     "how can we LOUDLY BE NOTIFIED when something is down on the site?"
//
// The answer this file gives is a posture, not a feature: WATCH THE OUTCOMES,
// NOT THE PIPELINES. A pipeline probe can only catch the failures someone
// already imagined and wired a check for. An outcome probe — is the page
// answering, is the served bytes the current bytes — catches causes nobody
// predicted, including the ones that have not been invented yet. The workflow
// probe is here too (§5), but deliberately last and deliberately framed as a
// SECOND opinion: a red pipeline beside a green outcome is a finding, and a
// green pipeline beside a red outcome is a lie.
//
// Posture, borrowed verbatim from harbor-watch.mjs because it is the same
// posture: "This script only reads and reports — it never writes to any world."
// It writes to no clone (§8 READS the office's town clone, with git's optional
// locks off), holds no pen, takes no lock. Its only writes are its own
// state file, its own status board, its own change log (§20), and an HTTP POST
// to a Discord webhook.
//
// ── WHAT IT WILL NOT DO, AND WHY ────────────────────────────────────────────
//
// It does not restart anything, redeploy anything, or re-run a workflow. A
// watcher that acts on its own reading is a watcher whose reading nobody checks;
// the 2026-08-19 stranded-crossings incident is the town's own receipt for what
// an unwatched automatic hand costs. Detection is mechanical here; the repair
// stays a hand.
//
// It also cannot see its own death. If the box is down, or the timer is masked,
// this file does not run and therefore does not alarm — the classic watchman
// problem, and it is NOT solved here. Solving it needs an off-box heartbeat
// (a dead-man's switch someone else pings), which is a second machine and
// outside this lane. Named rather than papered over, because a sentinel that
// implies coverage it does not have is worse than no sentinel.
//
// ── THE THREE THINGS THAT MADE THE DESIGN, ALL MEASURED, NOT ASSUMED ────────
//
// 1. GitHub's UNAUTHENTICATED REST budget is 60/hour per IP, and a conditional
//    request that returns 304 STILL SPENDS ONE. Measured 2026-08-25 against the
//    live API: X-RateLimit-Used went 4 -> 5 across a request that answered
//    "304 Not Modified". So ETags buy bandwidth, not budget. This watch
//    therefore spends at most TWO REST calls per tick (12/hour at the 10-minute
//    cadence, a fifth of the budget, leaving room for whatever else on the box
//    shares the address): one combined /actions/runs read for every workflow at
//    once, and one commits?path= read for the daily's source. Every commit SHA
//    it needs comes from `git ls-remote`, which is the git wire protocol and
//    spends no REST budget at all. (§11 adds one compare call per NEW sweep-
//    and-tag pair, remembered in its state, so a few a day, never one a tick.)
//    §13, the Linear handler, reads ONLY WITH THE TOKEN (POS-631, W4): one runs
//    read per handler repo, six a tick, and one more repo read every tick for
//    each repo whose workflow 404s (a caller not yet on its default branch, or
//    a repo the token cannot see): 6 to 12 a tick, 36 to 72 an hour, against
//    the token's 5,000. Plus a jobs and an annotations read once per NEW
//    failed run, remembered in its state. Keyless, it spends nothing and its
//    rows read UNKNOWN, so the two reads above keep the anonymous 60.
//
// 2. PROD DOES NOT BUILD FROM MAIN, so "deployed sha vs main tip" is not a
//    staleness test — it is a permanent false alarm. deploy.yml's release lane
//    checks out the newest `release/*` tag and builds the CODE from there, then
//    overlays the town DATA from main (`git checkout origin/main -- ...`).
//    Prod lagging main on code is the design. Which is why the stamp this
//    watch reads carries TWO shas and the watch compares each against its own
//    reference: code against the release tag, town data against main.
//
// 3. THE 08-24 FREEZE IS THE PROOF THAT THE SECOND HALF MATTERS. deploy.yml's
//    own comment records it: "prod served Crossing 144 while main carried 146"
//    — the code was correctly pinned and the content was silently frozen behind
//    it. A one-sha stamp cannot express that failure. A two-sha stamp makes it
//    the first thing you see.
//
// ── THE PROBES ──────────────────────────────────────────────────────────────
//
//  1. UP        — the public doors answer 200. Cheapest API door is GET /api/,
//                 the capability manifest: static, public, no DB work, and it
//                 carries X-Postmark-As-Of, so probe 3 rides along on it for
//                 free. dev.postmark.town is INFO-only: it sits behind
//                 Cloudflare Access and a 302 to *.cloudflareaccess.com is its
//                 HEALTHY shape, so alarming on it would train the reader to
//                 ignore the channel.
//  2. FRESH/SITE — /build.json's code_sha vs the newest release/* tag, and its
//                 town_data_sha vs site main's tip. Time-anchored (below).
// 2b. FRESH/CROSSING — /build.json's `crossing` vs the office's own crossing
//                 number at GET /api/. THE EVENT-SHAPED QUESTION, added
//                 2026-08-26 with the box refresh timer: mail moves at
//                 crossings, not on a wall clock, so "has a ferry landed since
//                 this page was built" is a question no duration threshold can
//                 answer. Costs zero extra requests — it reads the body of the
//                 manifest probe 1 already opens. Probe 2 stays as the floor.
//  3. FRESH/DATA — the served X-Postmark-As-Of vs the town repo's main tip.
//                 This is the probe that would have caught the stuck rehydrate
//                 tick found BY HAND on 2026-08-25 (one distinct as-of across
//                 40 minutes and three scheduled tick slots).
//  4. FRESH/DAILY— the served /daily/ferrys-daily.html actually contains the
//                 current TOWN_BULLETIN/ferrys-daily.md's headline. Note the
//                 path: /daily/ is a WRAPPER page that links to the daily and
//                 does not inline its prose, so probing /daily/ for the daily's
//                 text answers a question nobody asked.
//  5. WORKFLOWS  — the latest run per workflow on main that actually DECIDED
//                 something. Cancellations are looked through, never counted as
//                 health: these two workflows cancel each other by concurrency
//                 group all day, and the first version of this probe called that
//                 green and reported the 08-25 fire itself as fine.
//  8. CLONES     — the office's town clone has no uncommitted tracked files
//                 and is not off the town's main past one tick. Dirt is DOWN:
//                 every write that pulls the clone refuses while it stands
//                 (2026-09-28, 4.5 hours, found by a resident). The reader is
//                 tools/clone-state.mjs, shared with the box roll-call.
//  9. DISK      — the box's root disk is under 85% used. The ground: on
//                 2026-10-09 a full disk took Postgres, sign-in and the ferry
//                 down two hours before anyone looked. This probe replaced
//                 postmark-disk-watch, which shouted into the same channel on its
//                 own timer (POS-556, Darko 2026-10-10: ONE route to the Meepo
//                 bot, the one /fleet also reads).
// 10. MEEPS     — the town's meeps on Letta are answering. Read from
//                 /srv/postmark-sentinel/meeps.json, the record the desktop
//                 watcher (starforge-rig's windows/meepops/meep-watch.mjs, on
//                 Darko's desktop, every 5 min) lands here by scp. A record
//                 the watcher marks DOWN is DOWN. One it marks DEGRADED is a
//                 WARN only when every one of its problems says severity
//                 "warn"; a DEGRADED record that cannot say so is DOWN, as it
//                 always was (POS-838). A WARN is announced once, as a notice
//                 and never as an outage, and the board rolls it up as
//                 DEGRADED. A record older than 15 min, or none at all, is
//                 STALE: the watcher or the desktop has stopped, and a silent
//                 watcher must not read as healthy meeps (Darko 2026-10-10
//                 13:27, POS-556).
// 11. SETTLEMENT — the newest sweep receipt (/srv/postmark-harbor/settlement-
//                 auto.json) settled within the hour: a publishing sweep whose
//                 world the newest settlement/S<n> tag covers, peeled, by
//                 equality or descent; a quiet sweep with no unblessed sweep
//                 publication between that tag and its world. A refusal, a
//                 publication no tag covers, or a
//                 06:00/18:00 slot with no receipt, an hour on, is DOWN (Darko
//                 2026-10-11: "it needs to bark"), and so is an unreadable
//                 receipt; a blessing that cannot be verified an hour on is
//                 STALE — past the hour, never silent. Tags over ls-remote; descent
//                 by ONE remembered compare call per new (world, tag) pair.
// 12. LAW PEN   — the law pen's state (/srv/world2-lab/state/ingest-law.json)
//                 reads `ok` within 45 min. A law the parser would read
//                 diminished is refused WHOLE (POS-619), which holds every law
//                 update until the mark is fixed, so a refusal is DOWN with the
//                 lint's sentence as its reason; a held pin (law-pin-held,
//                 POS-628) is DOWN with the pin it stays at; any other failed run is DOWN;
//                 none, unreadable or older than 45 min is STALE.
// 13. LINEAR HANDLER — one row per repo that carries the Starforge Linear
//                 handler's caller: its newest decisive run either succeeded,
//                 or failed only on its `done line` (the PR author's to fix),
//                 or it is DOWN, naming the repo, the run and the failed job's
//                 annotation. No run yet is INFO; a repo the token cannot see
//                 (postmark-telemetry is private) is UNKNOWN (POS-631).
// 14–19. POS-968 (the STAR-161 sitting, Darko 2026-11-08), each reading
//                 something the box already writes:
// 14. STORE     — the office's store watch (telemetry/store-txn-4380.json)
//                 and Postgres's idle-in-transaction kills as the office's
//                 journal logs them. A kill beside an office 500 is DOWN; a
//                 kill alone, or a session stuck idle in a transaction, WARN.
// 15. 5XX       — the office's own access log, per route with the handle
//                 masked: 5 or more 5xx on one route inside 10 minutes is DOWN.
// 16. CERTS     — the certificate nginx SERVES for each host, over TLS to
//                 127.0.0.1:443: under 21 days WARN, under 7 days or expired
//                 DOWN, and one that does not name its host DOWN.
// 17. UNITS     — systemctl's failed units: one the roll-call manifest names
//                 is DOWN, any other WARN, a transient run-u* only counted.
// 18. BACKUP    — the nightly backup's own receipt: not shipped is DOWN, past
//                 the roll-call's 1,560-minute allowance STALE.
// 19. TRIPS     — "the office tripped" lines in the office's journal, by door:
//                 any is WARN, 5 on one door inside 10 minutes DOWN. The MCP
//                 door wraps a trip in HTTP 200, so §15 cannot see it.
// §20 is the change log every transition is appended to, and §21 the
// acknowledgement a standing red may carry.
//
// ── ONE ALARM ROUTE (POS-556) ───────────────────────────────────────────────
//
// This file is the only thing on the box that posts an alarm to Discord, and
// /ops/sentinel.json (this file's --out board) is what Wright's /fleet reads.
// Discord and /fleet hear the same thing because they read one record. A new
// box alarm is a probe here, never a script with its own webhook call. The
// one alarm that cannot be a probe is the watch on this file's own death,
// which runs off the box (the town's .github/workflows/offbox-watch.yml) and
// reads this same board's generated_at.
//
// ── THE STALENESS CLOCK, AND WHY IT IS ANCHORED WHERE IT IS ─────────────────
//
// Every freshness probe compares a SERVED value against a REFERENCE value, and
// the naive rule ("alarm when they differ") is wrong twice over: it fires during
// the ordinary minutes between a push and its deploy, and — subtler — anchoring
// the clock to the PAIR means a repo that commits every 30 minutes resets the
// clock every 30 minutes and can never accumulate an alarm even while every
// deploy fails.
//
// So the clock is anchored to the DIVERGENCE: how long has the reference been
// somewhere the served value is not? It starts the moment the two first differ,
// PERSISTS while the reference keeps moving (a busy repo cannot hide a frozen
// site — the original anchoring law, kept), and clears the moment they agree
// or the served value advances (a progressing pipeline is never stale).
//
// HISTORY, because the previous anchor rang 6-7 false alarms a day and its
// header note claimed it couldn't (found 2026-08-31, Keemin's challenge): the
// clock used to be anchored to the SERVED value alone — "how long has the site
// answered with THIS value" — on the argument that a quiet repo never alarms
// since served equals reference. True while quiet; false at the first commit
// AFTER the quiet: the town sat unchanged for 59 minutes (01:32-02:31Z, an
// ordinary quiet hour), one stake landed, and nine minutes later the sentinel
// declared 49 minutes of staleness — the age of a perfectly current serve of a
// perfectly quiet repo. Serving an old sha of a repo that hasn't moved is
// health; only trailing a KNOWN-NEWER reference is staleness, and the clock
// now measures exactly that.
//
// Usage:
//   node tools/site-sentinel.mjs [--state <state.json>] [--out <status.json>]
//                                [--json] [--dry-run] [--now <iso>]
//                                [--history <history.jsonl>] [--acks <acks.json>]
//   (§20's history and §21's acks default to files beside the state.)

import { readFileSync, writeFileSync, mkdirSync, statSync, statfsSync, existsSync, realpathSync, appendFileSync, renameSync, openSync, readSync, closeSync } from "node:fs";
import { dirname, join } from "node:path";
import { execFileSync } from "node:child_process";
import { X509Certificate } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
// The town clock, imported rather than restated. crossings.mjs was split out of
// world.mjs for exactly this: a small tool that needs "how many crossings old is
// this?" gets the arithmetic without a second copy of it, and there stays
// exactly one place the ruling lives.
import { CROSSING_EPOCH_UTC, CROSSING_MS } from "../src/crossings.mjs";
import { DIRTY_GRACE_MS, readCloneState, judgeDirt, nameFiles } from "./clone-state.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

// ── configuration ───────────────────────────────────────────────────────────

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;

// §11 — the settlement. Here and not beside classifySettlement because CONFIG
// below reads them, and a const is not readable before its line.
/** The ruling's hour. Named because it is the number the founder said. */
export const SETTLEMENT_GRACE_MS = 60 * MINUTE;
/** postmark-settlement.timer's OnCalendar hours, UTC. The test reads the unit and refuses a mismatch. */
export const SETTLEMENT_SLOTS_UTC = Object.freeze([6, 18]);

export const CONFIG = {
  // Every door a reader actually opens. The API entry is GET /api/ and not
  // /api/residents/<handle>: the manifest is a constant in memory while a
  // resident read walks the index, and both carry the same as-of header, so the
  // cheap one is strictly better as a liveness probe.
  doors: [
    { key: "site_home", url: "https://postmark.town/", label: "postmark.town" },
    { key: "site_daily", url: "https://postmark.town/daily/", label: "the Daily page" },
    { key: "site_world", url: "https://postmark.town/world/", label: "the World page" },
    { key: "site_bulletin", url: "https://postmark.town/bulletin/", label: "the bulletin" },
    { key: "office_api", url: "https://postmark.town/api/", label: "the office API" },
  ],
  // INFO-ONLY BY CONSTRUCTION. dev sits behind Cloudflare Access; its healthy
  // answer is a 302 to an Access login. It is reported so a reader can see it,
  // and it can never raise an alert — see classifyUp's accessGate branch.
  devDoor: { key: "dev_site", url: "https://dev.postmark.town/", label: "dev.postmark.town" },

  buildStamp: "https://postmark.town/build.json",
  dailyServed: "https://postmark.town/daily/ferrys-daily.html",
  dailySource: "https://raw.githubusercontent.com/postmark-town/postmark/main/TOWN_BULLETIN/ferrys-daily.md",

  siteRepo: { owner: "postmark-town", name: "postmark-site" },
  townRepo: { owner: "postmark-town", name: "postmark" },
  dailyPath: "TOWN_BULLETIN/ferrys-daily.md",

  // Thresholds. Each is the cadence of the thing being watched plus enough
  // slack that an ordinary slow run is not an alarm.
  //   site code : the release train is roughly weekly, but a cut tag should
  //               reach prod within an hour of being cut.
  //   town data : sync-atlas runs every ~30 min and Deploy follows it.
  //   office    : the keeping timer fires every 15 min (*:07,22,37,52; the
  //               retired rehydrate timer fired at *:09,24,39,54; see
  //               deploy/DEPLOY.md § Sunday: adopting the tick split, step 2).
  //               30m under the divergence anchor is TWO DEAD TICKS behind a
  //               known-newer tip (Keemin-tightened 2026-08-31, the same
  //               night the anchor was fixed). History of the number: 45m
  //               under the old served-value anchor rang 6-7 false alarms a
  //               day — every quiet stretch plus one push — and was briefly
  //               widened to 60m before the real bug was found in the
  //               measurement, not the window. With the clock honest, tight
  //               is cheap: a real wedge pages in half an hour and a quiet
  //               hour pages nobody.
  //   daily     : sync + deploy, end to end.
  staleAfter: {
    site_code: 3 * HOUR,
    site_town_data: 3 * HOUR,
    office_as_of: 30 * MINUTE,
  },
  dailySlack: 90 * MINUTE,

  // §2b — how long a crossing may stand un-rebaked before it is a finding.
  //
  // Sixty minutes is not a round number, it is TWO CHANCES. The box timer fires
  // at :10 and :40 past the hour (postmark-site-refresh.timer); a crossing lands
  // on the hour, so the :10 tick is the first attempt and the :40 tick is the
  // recovery. An hour after a crossing, BOTH have had their turn and a site
  // still showing the previous crossing is not a slow build — it is a broken
  // one. Set it shorter and every ordinary build reports itself; set it longer
  // and the 2026-08-26 incident (97 minutes behind a ferry) stays quiet for
  // most of its life.
  crossingGrace: 60 * MINUTE,

  // §6 — the box's own watchers. The sentinel runs beside them, so their
  // state files are local facts. A watcher whose state is ABSENT while its
  // timer stands enabled is DOWN, never UNKNOWN: on 2026-08-26 usdc-watch
  // crash-looped on EACCES for 22 hours behind an all-green board, because
  // nothing asked whether the watchers themselves were alive.
  watchers: [
    // `unit` names the timer each cadence is copied FROM. It is not decoration:
    // the two numbers live in different files, and test/site-sentinel.test.mjs
    // reads the unit and refuses a cadence that does not match it. stripe_watch
    // said 10 minutes here while its timer has always fired every 15 (caught
    // 2026-08-27) — with a 3× tolerance that put a healthy rail one missed tick
    // from STALE, under a reason line quoting a cadence the box does not run.
    { key: "usdc_watch", label: "the usdc-watch timer", state: "/srv/postmark-usdc/state.json",
      unit: "postmark-usdc-watch.timer", cadenceMs: 10 * MINUTE },
    { key: "stripe_watch", label: "the stripe-watch timer", state: "/srv/postmark-stripe/state.json",
      unit: "postmark-stripe-watch.timer", cadenceMs: 15 * MINUTE,
      adoptedWhen: "/srv/postmark-stripe" }, // Stage B: parked until adopted — absence of the DIR is INFO, not DOWN
  ],

  // §7 — the box's own publisher, and why it is NOT a `watchers` row.
  //
  // A watcher is classified on its heartbeat alone: the state file's mtime
  // against a cadence. That is the right question for a rail whose only job is
  // to tick. It is the WRONG question here, and 2026-09-17 is the receipt: the
  // 08:10Z refresh wrote its report on time, from a run that had published a
  // 134-resident town, and a heartbeat probe would have called that fresh and
  // green. The refresh's report carries an OUTCOME, so the outcome is what gets
  // read. (deploy/box-rollcall-manifest.json already watches this same file's
  // heartbeat — `stamp_field: at`, 100 minutes — and that row stays: the pair
  // survives either half being the thing that broke, the same reason the
  // usdc_watch duplicate is deliberate.)
  //
  // `unit` is not decoration, exactly as in `watchers`: the cadence and the
  // timer live in different files, and test/site-sentinel.test.mjs reads the
  // unit and refuses a cadence that does not match it.
  siteRefresh: {
    key: "site_refresh",
    label: "the box's site refresh",
    report: "/srv/postmark-harbor/site-refresh.json",
    unit: "postmark-site-refresh.timer",
    cadenceMs: 30 * MINUTE,
  },

  // §8 — the office's own town clone, read from the disk this runs on. The
  // office's writes all begin `git pull --rebase` in it, so a tracked change
  // left uncommitted there bounces every write until a person clears it:
  // 2026-09-28, 18:37Z to 23:3xZ, thirty refusals, and only a resident said so.
  //
  // `behindAfterMs` is not one sentinel interval, and that was measured, not
  // relaxed: this clone only moves when something pulls it — an office write,
  // or the keeping tick at *:07,22,37,52 — so a town merge landing just after
  // a quiet tick leaves it honestly behind for up to fifteen minutes. Ten would
  // page on every such merge. Twenty-five is the tick's window plus one of
  // ours: past it, a tick has had its turn and did not land.
  //
  // THE WORLD CLONE IS NOT HERE, ON PURPOSE. The office writes it differently:
  // ensureDraftCheckout (src/world-branches.mjs) runs `reset --hard` and
  // `clean -fd` before every write and refuses a tree it could not clean, and
  // the tick only FETCHES it, because a pen branch diverged from origin is its
  // normal state between writes (deploy/office-keep.sh). Dirt there cannot
  // strand the next write, and "behind" there is the design.
  clones: [
    {
      key: "town_clone", label: "the office's town clone",
      path: process.env.TOWN_CLONE || "/srv/postmark-office/town-clone",
    },
  ],
  cloneDirtyGraceMs: DIRTY_GRACE_MS,
  cloneBehindAfterMs: 25 * MINUTE,

  // §9 — the root disk, read from the disk this runs on. 85% is
  // postmark-disk-watch's line, carried over unchanged when this probe
  // replaced it (POS-556): at 38G, 15% is under 6G, about eight site releases.
  disk: { key: "disk_root", label: "the box's root disk", path: "/", limitPct: 85 },

  // §10 — the meeps. The desktop watcher writes every 5 minutes, so 15 is two
  // missed pushes plus one of ours. The record's own path and freshness are
  // the probe's; what counts as a sick meep is the watcher's (its `status`).
  meeps: { key: "meeps", label: "the meeps", path: "/srv/postmark-sentinel/meeps.json", staleAfterMs: 15 * MINUTE },

  // §11 — the settlement. The receipt is the box's own file (owner meepo, which
  // this runs as); the tags are the world's, read over the wire. `unit` is not
  // decoration, exactly as in `watchers`: test/site-sentinel.test.mjs reads the
  // timer and refuses slots that do not match its OnCalendar lines.
  settlement: {
    key: "settlement", label: "the settlement",
    receipt: "/srv/postmark-harbor/settlement-auto.json",
    worldRepo: { owner: "postmark-town", name: "postmark-world" },
    unit: "postmark-settlement.timer",
    slotsUtc: SETTLEMENT_SLOTS_UTC,
    graceMs: SETTLEMENT_GRACE_MS,
  },

  // §12 — the law pen (POS-619). Its timer fires every 15 minutes and every fire
  // writes the state, so 45 is three missed fires: the roll-call's own
  // allowance for this unit (deploy/box-rollcall-manifest.json), carried over.
  lawPen: {
    key: "law_pen", label: "the law pen",
    path: "/srv/world2-lab/state/ingest-law.json",
    unit: "postmark-world2-law-ingest.timer",
    staleAfterMs: 45 * MINUTE,
  },

  // §13 — the Linear handler (POS-631). Every repo that carries the caller,
  // one row each (W1: alerts are per row, so one shared row would hide a second
  // repo failing behind the first). postmark-telemetry is private: its row
  // reads UNKNOWN until the token has Actions: read on it (and Checks: read, for
  // the annotations a failed run's reason comes from).
  linearHandler: {
    keyPrefix: "linear_handler",
    owner: "postmark-town",
    repos: ["postmark-office", "postmark-site", "postmark-world", "postmark", "postmark-blueprints", "postmark-telemetry"],
    workflowFile: "linear-handler.yml",
    step: "linear",
    perPage: 10,
  },

  // §14–§19 (POS-968). The events the store, 5xx and trip probes count are
  // judged over the last `lookbackMs`, in any `windowMs` span of it. Ten
  // minutes is the ruled window. The lookback is longer than one tick, on
  // purpose: the timer fires every 10 minutes with up to 45 s of jitter, and a
  // request's line lands when it is answered, so a burst that straddles two
  // ticks is counted whole on the second rather than halved across both (Darko
  // 2026-11-08 17:24, "don't accidentally drop any alarms"). The cost is that a
  // finished burst reads DOWN for one tick longer before it recovers.
  events: { windowMs: 10 * MINUTE, lookbackMs: 25 * MINUTE },
  // The prod office's journal: its kill and trip lines. It runs as meepo, as
  // this does, so journald keeps its lines in a journal meepo can read without
  // adm (measured 2026-11-09).
  officeJournal: { unit: "postmark-office.service" },
  // The prod office's access log, one file per UTC day, named by the moment
  // each request was ANSWERED (src/telemetry.mjs); `ts` is when it started.
  accessLog: { dir: "/srv/postmark-office/telemetry" },

  // §14 — written every minute by the office's src/store-txn-watch.mjs, named
  // by the prod office's port (deploy/postmark-office.service, --port 4380).
  // Five minutes is the roll-call's own allowance for this file's calm_at.
  storeHealth: {
    key: "store_health", label: "the office's store",
    path: "/srv/postmark-office/telemetry/store-txn-4380.json",
    staleAfterMs: 5 * MINUTE,
  },

  // §15 — the ruled line: 5 or more 5xx on one route inside the window.
  resident5xx: { key: "resident_5xx", label: "the residents' 5xx", threshold: 5 },

  // §16 — every host nginx serves over TLS on this box: the server_name of
  // every `listen 443` block. test/site-sentinel.test.mjs reads this repo's
  // deploy/nginx-*.conf and refuses a 443 name missing here. meepo.online,
  // starstory.online and starforge-atelier.online are served from nginx files
  // that live only on the box (sites-enabled/mio-web, meepo, starforge-atelier;
  // read 2026-11-09), so the test cannot read them: add a host here when one is
  // added there. pages.postmark.town is not here: it has no DNS and no block of
  // its own, and nginx answers its name with 1f4ee.town's certificate.
  certs: {
    keyPrefix: "cert",
    connect: "127.0.0.1:443",
    warnDays: 21,
    downDays: 7,
    timeoutMs: 10_000,
    hosts: [
      "postmark.town", "www.postmark.town", "dev.postmark.town", "panes.postmark.town",
      "1f4ee.town", "www.1f4ee.town",
      "meepo.online", "www.meepo.online", "starstory.online", "www.starstory.online",
      "starforge-atelier.online", "www.starforge-atelier.online",
    ],
  },

  // §17 — the roll-call's manifest is the list of units that matter. The box
  // runs this file from the office tree, so the manifest beside it is the one
  // the roll-call reads.
  failedUnits: {
    key: "failed_units", label: "the box's failed units",
    manifest: join(HERE, "..", "deploy", "box-rollcall-manifest.json"),
  },

  // §18 — `unit` is not decoration: the allowance is the roll-call manifest
  // row's stale_after_minutes for this unit, and the test refuses a mismatch.
  backup: {
    key: "backup_outcome", label: "the nightly backup",
    path: "/srv/world2-lab/state/backup.json",
    unit: "postmark-world2-backup.timer",
    staleAfterMs: 1560 * MINUTE,
  },

  // §19 — the same line as §15, on the door §15 cannot see (see classifyOfficeTripped).
  officeTripped: { key: "office_tripped", label: "the office's tripped doors", threshold: 5 },

  requestTimeoutMs: 20_000,
  // One reminder every twelve hours while a probe stays bad. Not per tick —
  // a channel that pings every ten minutes is a channel the reader mutes, and a
  // muted channel is exactly the silent failure this file exists to end.
  reminderMs: 12 * HOUR,
  userAgent: "postmark-site-sentinel",
};

// ── §1 up: classification ───────────────────────────────────────────────────

/**
 * One door's verdict.
 *
 * `error` is set when the request never produced a response at all (DNS,
 * refused, TLS, timeout). That is the loudest case and it is DOWN without
 * qualification — a door that does not answer is down however sympathetic the
 * reason.
 *
 * A 4xx is DOWN too, deliberately. These are five paths that are supposed to
 * exist; a 404 on /daily/ means the deploy shipped a tree without it, which is
 * an outage wearing a tidy status code.
 */
export function classifyUp({ status = null, location = null, error = null, infoOnly = false } = {}) {
  if (error) {
    return infoOnly
      ? { verdict: "INFO", reason: `did not answer (${String(error).slice(0, 120)}) — info-only door, not alarmed` }
      : { verdict: "DOWN", reason: `did not answer at all: ${String(error).slice(0, 120)}` };
  }
  // The Access gate. A 302 whose Location is a cloudflareaccess.com login is
  // dev's HEALTHY shape, not a redirect loop — recognised by the destination
  // host rather than by the status code, because a 302 anywhere else is a
  // finding and must not be swallowed by the same branch.
  const accessGate = status === 302 && /(^|\.)cloudflareaccess\.com\//.test(String(location ?? ""));
  if (accessGate) return { verdict: "INFO", reason: "302 to the Cloudflare Access login — its healthy shape, gated as designed" };
  if (infoOnly) {
    return status >= 200 && status < 400
      ? { verdict: "INFO", reason: `HTTP ${status}` }
      : { verdict: "INFO", reason: `HTTP ${status} — info-only door, not alarmed` };
  }
  if (status >= 200 && status < 300) return { verdict: "OK", reason: `HTTP ${status}` };
  if (status >= 300 && status < 400) return { verdict: "DOWN", reason: `HTTP ${status} to ${String(location ?? "an unnamed location")} — this path should serve, not redirect` };
  if (status >= 500) return { verdict: "DOWN", reason: `HTTP ${status} — the server broke on a path that should serve` };
  return { verdict: "DOWN", reason: `HTTP ${status} — a page that is supposed to exist did not` };
}

// ── §2/§3 freshness: the time-anchored comparison ───────────────────────────

/**
 * Compare a SERVED value against a REFERENCE, with the clock anchored to the
 * DIVERGENCE (see the header's staleness-clock note, and its history — the
 * served-value anchor this replaces alarmed on every quiet-hour-then-one-push).
 *
 * `seen` is the caller's memory: { value, first_seen_at, diverged_since }.
 * `diverged_since` is when the reference was first observed somewhere the
 * served value is not; null while they agree. It persists while the reference
 * keeps moving (a busy repo cannot hide a frozen site) and clears when the
 * served value advances (a progressing pipeline is never stale). Returned
 * updated, so a falsifier can run the whole comparison and prove the memory
 * advanced (or did not) without owning a filesystem.
 *
 * A divergence the watch has never seen before starts its clock NOW and cannot
 * be stale on that tick — the same cold-start honesty as before: the watch
 * genuinely does not know how long the reference has been ahead, and guessing
 * would be inventing evidence. (A pre-upgrade state file, which carries no
 * diverged_since, gets the same one-tick grace for the same reason.)
 */
export function classifyStamp({ served, reference, seen = null, nowMs, staleAfterMs, what, referenceName }) {
  if (served == null) {
    return { verdict: "UNKNOWN", reason: `could not read ${what} from the live site`, seen: seen ?? null };
  }
  if (reference == null) {
    return { verdict: "UNKNOWN", reason: `could not read ${referenceName} to compare ${what} against`, seen: seen ?? null };
  }
  const sameValue = seen && seen.value === served;
  const firstSeenAt = sameValue ? seen.first_seen_at : nowMs;
  const shortS = String(served).slice(0, 10);
  const shortR = String(reference).slice(0, 10);

  if (served === reference) {
    return { verdict: "OK", reason: `${what} matches ${referenceName} (${shortS})`,
      seen: { value: served, first_seen_at: firstSeenAt, diverged_since: null } };
  }

  // Diverged. The clock starts at the first observed divergence and survives
  // further reference movement; a changed served value restarts it (progress).
  const divergedSince = (sameValue ? seen.diverged_since : null) ?? nowMs;
  const nextSeen = { value: served, first_seen_at: firstSeenAt, diverged_since: divergedSince };
  const behindFor = nowMs - divergedSince;
  if (behindFor < staleAfterMs) {
    return {
      verdict: "OK",
      reason: `${what} is ${shortS} and ${referenceName} moved ahead to ${shortR} ${humanDuration(behindFor)} ago — inside the ${humanDuration(staleAfterMs)} deploy window`,
      seen: nextSeen,
    };
  }
  return {
    verdict: "STALE",
    reason: `${what} has trailed ${referenceName} for ${humanDuration(behindFor)} (serving ${shortS}, source at ${shortR}) — the source moved on and the site has not followed`,
    seen: nextSeen,
  };
}

// ── §2b the crossing: the event-shaped freshness question ───────────────────

/**
 * Is the site showing the CURRENT ferry crossing?
 *
 * WHY A WALL-CLOCK THRESHOLD IS NOT ENOUGH, which is this probe's whole reason
 * to exist. Every other freshness probe here asks "how long has the served value
 * been frozen?" — a duration question. But mail does not move on a duration; it
 * moves at crossings, 00:00 and 12:00 UTC, and everything a resident cares about
 * changes in that one instant. A three-hour threshold measured from whenever the
 * site last happened to change cannot see that: on 2026-08-26 the site had
 * rebuilt recently enough to look healthy by the clock while the ferry that had
 * landed 97 minutes earlier was nowhere on it, and 48 doorstep pages served
 * yesterday's mail. The freshness architecture names the repair directly:
 * "a wall-clock threshold cannot see an event-shaped failure."
 *
 * So this asks the event question instead: the site's build stamp carries the
 * crossing it was baked at, the office serves the crossing it is now, and the
 * gap between them is either zero or a finding. The wall-clock probes stay
 * exactly as they were — they are the floor under this, and they catch the
 * failures that have nothing to do with crossings.
 *
 * NO MEMORY. Every other freshness probe needs a `seen` record because it cannot
 * know when its reference moved. This one can: a crossing is a pure function of
 * time (src/crossings.mjs — 12h since 2026-06-12), so "how long has crossing N
 * been the current one?" is arithmetic, not history. That is worth saying out
 * loud, because a probe with no state cannot be wrong about its own past.
 *
 * @param {number|null} servedCrossing  from the site's /build.json
 * @param {number|null} officeCrossing  from GET /api/'s crossing.number
 */
export function classifyCrossing({ servedCrossing, officeCrossing, nowMs, graceMs, haveStamp = true, epochMs = CROSSING_EPOCH_UTC, crossingMs = CROSSING_MS }) {
  // The two ways the site's half can be unreadable are different repairs, so
  // they are different sentences. "No stamp at all" is a deploy that did not
  // emit one; "a stamp with no crossing" is an old stamper or a build that
  // could not reach the office. A reader at 3am should not have to open the
  // other probes to learn which.
  if (!haveStamp)
    return { verdict: "UNKNOWN", reason: "the deployed site serves no /build.json at all, so there is no baked crossing to compare" };
  if (!Number.isInteger(servedCrossing))
    return { verdict: "UNKNOWN", reason: "the site's build stamp names no crossing — an older build stamper, or a build that could not reach the office to ask" };
  if (!Number.isInteger(officeCrossing))
    return { verdict: "UNKNOWN", reason: "the office did not serve a crossing number to compare against (GET /api/ crossing.number)" };

  const gap = officeCrossing - servedCrossing;
  // Ahead is not a failure. A build that started before a crossing and finished
  // after it stamps the newer number, which is honest — the town data it baked
  // was read on the far side of the ferry.
  if (gap <= 0) return { verdict: "OK", reason: `the site is baked at crossing ${servedCrossing} and the town is at ${officeCrossing}` };

  // How long has the town been at this crossing? Not "how long has the site been
  // frozen" — the question is how much of the current crossing the site has
  // already missed.
  const landedMs = nowMs - (epochMs + officeCrossing * crossingMs);

  if (gap === 1 && landedMs < graceMs) {
    return {
      verdict: "OK",
      reason: `crossing ${officeCrossing} landed ${humanDuration(landedMs)} ago and the site is still baked at ${servedCrossing} — inside the ${humanDuration(graceMs)} rebuild window`,
    };
  }
  // Two or more behind is stale whatever the clock says: a whole crossing came
  // and went without the site noticing, so no rebuild window can excuse it.
  const behind = gap === 1 ? "a ferry has landed" : `${gap} ferries have landed`;
  return {
    verdict: "STALE",
    reason: `${behind} since the site was built — the site is baked at crossing ${servedCrossing}, the town is at ${officeCrossing}, and crossing ${officeCrossing} landed ${humanDuration(landedMs)} ago`,
  };
}

// ── §2c THE BUILD THAT PUBLISHED WITH PROBLEMS (POS-180, 2026-09-21) ────────
//
// Every other freshness probe here asks "is the site CURRENT?". This one asks
// a question none of them can: the site is current, and something inside it is
// not. On 2026-09-21 the town shed a bulletin entry, the entry door 404'd, and
// the site build refused to publish at all — every page on postmark.town froze
// for thirty minutes over one deleted entry. POS-166 and POS-180 make that a
// DROP instead of an outage: the build publishes, the shed thing leaves, a
// 404'd resident keeps the row they had, and the build writes down what it
// could not get.
//
// The founder's ruling is the whole design of this probe: "We just need to know
// this happened, not block things on it." A drop that nothing can see is not a
// fix, it is a silence — and until this probe existed, `problems` was assembled
// by the site's fetch and written only to a build log nobody reads on a
// schedule. This is the half that makes the drop safe.
//
// WHY STALE AND NOT DOWN. The site is up, fresh, and serving. What is wrong is
// that one row in it is held over from an earlier build, or one entry the town
// still names is missing. DOWN would say the site is unreachable, which is
// false, and a probe that cries outage over a shed handle is the alarm a reader
// learns to ignore. STALE is already this file's word for "what is served is
// behind what it should be", it is already in BAD so it alarms and reminds, and
// it is the true sentence here. No new severity is invented for it.
//
// FOUR STATES, AND THE DEPLOY-ORDER TRAP IS THE THIRD ONE.
//   a list with rows  the build published and could not get these things.
//   an empty list     the build asked for everything and got it.
//   `problems: null`  a POS-180 stamper that could not read its own manifest.
//                     Unread, never clean — UNKNOWN, the same way every other
//                     null on that stamp is read.
//   NO KEY AT ALL     an older stamper. This is not a fault and MUST NOT red:
//                     the two repos deploy independently, so between the office
//                     shipping this probe and the site shipping the field,
//                     every build.json prod serves is keyless. A probe that
//                     alarmed there would page the founder for the duration of
//                     an ordinary rollout, about a site that is working. INFO
//                     is this file's existing word for a probe that is counted,
//                     never alarmed and never silent, and it is exactly right
//                     while the field is not adopted yet.
export function classifyProblems({ haveStamp = false, problems = undefined } = {}) {
  if (!haveStamp) {
    return { verdict: "UNKNOWN", reason: "the deployed site serves no /build.json at all, so it cannot say what its build could not get" };
  }
  if (problems === undefined) {
    return { verdict: "INFO", reason: "this build's stamp predates the `problems` field (postmark-site tools/build-stamp.mjs, POS-180) — an older build is still being served, which is an ordinary rollout and not a fault" };
  }
  if (problems === null) {
    return { verdict: "UNKNOWN", reason: "the build stamp carries `problems: null` — the build could not read its own town manifest, so it cannot say what it failed to get; unread is never clean" };
  }
  if (!Array.isArray(problems)) {
    return { verdict: "UNKNOWN", reason: `the build stamp's \`problems\` is a ${typeof problems}, not a list — the stamp cannot be read on this point` };
  }
  if (problems.length === 0) {
    return { verdict: "OK", reason: "the build that published this site got everything it asked the office for" };
  }
  // NAMED, NOT COUNTED. A reader who is paged at 3am needs the entity and the
  // door, because the action differs completely: a shed handle is nothing to do,
  // a resident whose card has been 404ing for a week is an office bug. The
  // count leads so the shape of the failure is readable at a glance, and the
  // lines follow so it is actionable without a second lookup.
  const shown = problems.slice(0, 3).map((p) => String(p).slice(0, 200));
  const more = problems.length - shown.length;
  return {
    verdict: "STALE",
    reason: `the site published with ${problems.length} problem${problems.length > 1 ? "s" : ""} its build could not get: ${shown.join(" · ")}${more > 0 ? ` · and ${more} more` : ""}`,
  };
}

/** "1h12m" / "45m" / "3d 2h" — short enough to read inside a sentence. */
export function humanDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "an unknown time";
  const m = Math.floor(ms / MINUTE);
  if (m < 1) return "under a minute";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60), rm = m % 60;
  if (h < 24) return rm ? `${h}h${rm}m` : `${h}h`;
  const d = Math.floor(h / 24), rh = h % 24;
  return rh ? `${d}d ${rh}h` : `${d}d`;
}

// ── §4 the daily: an outcome fingerprint, not a timestamp ───────────────────

/**
 * Squash text to lowercase alphanumerics and single spaces.
 *
 * Load-bearing, not tidiness: the source is markdown and the served page is
 * HTML through a renderer, so the SAME sentence differs by smart quotes, by
 * &amp; and &#39;, by em-dash normalisation and by tag boundaries. Comparing
 * raw bytes would report a stale daily every single day. Comparing squashed
 * text compares what a reader would say is the same sentence.
 *
 * TAGS AND ENTITIES COME OUT FIRST, AND THAT ORDER IS THE WHOLE CORRECTNESS.
 * Squashing straight to alphanumerics leaves the DIGITS of a numeric entity
 * behind — `&#8220;An` becomes ` 8220 an `, which silently fails to contain
 * `an`, so a perfectly current daily reads as stale. Its falsifier caught this
 * on the first run.
 */
export const normalizeText = (s) =>
  String(s ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&#x[0-9a-f]+;|&#\d+;|&[a-z]+;/gi, " ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/**
 * The daily's fingerprint: its lead headline.
 *
 * Ferry's Daily is rewritten every round and its lead `## "…"` heading changes
 * with it, so the headline is the field that moves whenever the daily moves.
 * The crossing line is the fallback because it always exists but only advances
 * twice a day — good as a backstop, blind to a mid-crossing re-tending, which
 * is why it is second and not first.
 */
export function dailyFingerprint(markdown) {
  const text = String(markdown ?? "");
  const heading = text.match(/^##\s+(?!#)(.+)$/m)?.[1];
  if (heading && normalizeText(heading).length >= 12) return { kind: "headline", value: heading.trim() };
  const crossing = text.match(/Crossing\s+\d+/)?.[0];
  if (crossing) return { kind: "crossing", value: crossing };
  return { kind: "none", value: null };
}

/**
 * Is the deployed daily the current daily?
 *
 * The pipeline gets its window: if the source changed five minutes ago, its
 * absence downstream is a deploy in flight, not a failure. Past the window,
 * absence is the outcome failing and the reason quotes the sentence that is
 * missing, so the reader can paste it into the page and see for themselves.
 */
export function classifyDaily({ fingerprint, servedHtml, sourceCommittedAtMs = null, nowMs, slackMs }) {
  if (servedHtml == null) return { verdict: "UNKNOWN", reason: "could not read the served daily page" };
  if (!fingerprint || fingerprint.kind === "none")
    return { verdict: "UNKNOWN", reason: "could not find a headline or crossing line in the town's ferrys-daily.md to fingerprint" };

  const present = normalizeText(servedHtml).includes(normalizeText(fingerprint.value));
  if (present) return { verdict: "OK", reason: `the served daily carries the town's current ${fingerprint.kind} (${String(fingerprint.value).slice(0, 60)})` };

  const age = sourceCommittedAtMs == null ? null : nowMs - sourceCommittedAtMs;
  if (age != null && age < slackMs)
    return { verdict: "OK", reason: `the town's daily changed ${humanDuration(age)} ago and has not reached the site yet — inside the ${humanDuration(slackMs)} sync-and-deploy window` };

  const since = age == null ? "an unknown time" : humanDuration(age);
  return {
    verdict: "STALE",
    reason: `the served daily does not carry the town's current ${fingerprint.kind} — "${String(fingerprint.value).slice(0, 70)}" — committed ${since} ago; the town has a newer Daily than the site is showing`,
  };
}

// ── §5 the workflows: the second opinion ────────────────────────────────────

// Conclusions that carry no verdict about the workflow's health. `cancelled`
// and `skipped` say only that this particular run stopped; they are the
// concurrency group's fingerprints, not the workflow's condition.
export const INDECISIVE = new Set([null, undefined, "cancelled", "skipped"]);

/**
 * The newest run per workflow that actually DECIDED something.
 *
 * ⚑ THIS FUNCTION'S FIRST VERSION MADE THE EXACT MISTAKE THE FILE EXISTS TO
 * PREVENT, and only running it against the live town found it. It took the
 * newest COMPLETED run and treated `cancelled` as healthy — reasonable-sounding,
 * because these two workflows cancel each other through their concurrency
 * groups all day. But on 2026-08-25, with "Sync Postmark atlas" failing on every
 * run for hours, the newest completed run of BOTH workflows happened to be a
 * cancellation, so the board came back green and the sentinel said nothing about
 * the fire it was built for. A probe that cannot fail on the thing it names is
 * not a probe.
 *
 * The repair is to make cancellations TRANSPARENT rather than green: look
 * through them to the last run that reached a real verdict. In-progress runs
 * (conclusion `null`) are looked through for the same reason — letting a null
 * overwrite yesterday's `failure` would make a permanently broken workflow look
 * clean for the minutes it spends running.
 *
 * A workflow whose whole recent history is cancellations therefore reports
 * UNKNOWN, not OK: no run decided anything, and "nobody has checked" must never
 * render as "checked and fine".
 */
export function latestDecisiveRunPerWorkflow(runs) {
  const out = new Map();
  for (const r of runs ?? []) {
    if (r?.status !== "completed" || INDECISIVE.has(r?.conclusion)) continue;
    if (!out.has(r.name)) out.set(r.name, r);
  }
  return out;
}

/**
 * A red latest-conclusion is a finding EVEN WHEN THE OUTCOMES LOOK GREEN — that
 * is this probe's entire reason to exist. On 2026-08-25 the site's outcomes were
 * all healthy while "Sync Postmark atlas" had failed every run for hours; the
 * outcome probes above would (correctly) have said nothing, and the town would
 * have gone on not knowing until the freeze surfaced.
 *
 * Reads the last DECISIVE run (see above) — cancellations are looked through,
 * never counted as health.
 */
// §6 — a watcher's own pulse, from its state file's mtime. Pure so the
// falsifiers can drive every branch. The law, from the night that earned it:
// "a rail that has not ticked is not a quiet rail" — and a watcher with no
// state at all is the loudest kind of not-ticking there is.
export function classifyWatcher({ adopted = true, exists, mtimeMs = null, nowMs, cadenceMs, label }) {
  if (!adopted) return { verdict: "INFO", reason: `${label} is not adopted (Stage B parked) — nothing to watch yet` };
  if (!exists) return { verdict: "DOWN", reason: `${label} has no state file — it has never run or cannot write (an enabled timer with no state is a crashloop, not a quiet rail)` };
  const age = nowMs - mtimeMs;
  if (age > 3 * cadenceMs) return { verdict: "STALE", reason: `${label} last wrote its state ${Math.round(age / 60000)} min ago against a ${Math.round(cadenceMs / 60000)}-min cadence` };
  return { verdict: "OK", reason: `ticked ${Math.round(age / 60000)} min ago` };
}

/** The site workflows the sentinel watches, by name (for its rows) and file (for its read). */
export const WATCHED_WORKFLOWS = Object.freeze([
  Object.freeze({ name: "Deploy", file: "deploy.yml" }),
]);

export function classifyWorkflows(latest, { watch = ["Sync Postmark atlas", "Deploy"] } = {}) {
  const rows = [];
  for (const wanted of watch) {
    const key = `workflow_${slug(wanted)}`;
    const hit = [...latest.entries()].find(([name]) => name.toLowerCase().startsWith(wanted.toLowerCase()));
    if (!hit) {
      rows.push({ key, workflow: wanted, verdict: "UNKNOWN", reason: `no run of "${wanted}" on main reached a verdict in the window read — every recent run was cancelled or is still going, so nothing has been decided` });
      continue;
    }
    const [name, run] = hit;
    if (run.conclusion === "success" || run.conclusion === "neutral") {
      rows.push({ key, workflow: name, verdict: "OK", reason: `last decisive run on main succeeded (${run.created_at})` });
      continue;
    }
    rows.push({
      key,
      workflow: name,
      verdict: "DOWN",
      reason: `last decisive run on main was "${run.conclusion}" at ${run.created_at} — ${run.html_url ?? "see the repo's Actions tab"}`,
    });
  }
  return rows;
}

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

// ── §7 the site refresh: the OUTCOME, not the heartbeat ─────────────────────
//
// Reads deploy/site-refresh.sh's own report — `report()` writes
// `at · status · town_sha · site_main · release_tag · published · passes ·
// detail` to /srv/postmark-harbor/site-refresh.json, once per run, and every
// failure path writes it too (`die`, and the ERR trap's `on_err`).
//
// THE INSTANCE THIS EXISTS FOR (postmark-town/postmark#2884). At 08:12:35Z on
// 2026-09-17 the box published a town with 48 doors missing, from a three-week-
// old committed snapshot, because fetch-town.mjs warned and exited 0. The board
// read 14 green at 08:20:02Z. Nothing on it was wrong; nothing on it was
// looking at the refresh at all.
//
// FOUR THINGS THIS CLASSIFIER REFUSES TO DO, each one a lesson with a date:
//
//   - IT NEVER MAPS AN UNKNOWN STATUS WORD TO HEALTHY. A `status` this watch
//     does not recognise is UNKNOWN and says the word it saw. The 2026-08-25
//     cancellation finding is the whole reason: a value meaning "nothing was
//     decided" mapped to OK, and the board went all-green on the afternoon the
//     atlas sync was failing on every tick. Nobody-has-checked must never
//     render as checked-and-fine.
//   - IT NEVER CALLS A STALE `published` GREEN. A four-hour-old "published" is
//     a stopped publisher wearing a good verdict.
//   - A FAILURE OUTRANKS ITS AGE. When the newest report is both `failed` and
//     old, the verdict is DOWN and the reason carries BOTH facts — the founder
//     reads "the last refresh failed" and the operator reads "…and nothing has
//     reported since". One verdict, two clocks named, because a thing with two
//     clocks needs two numbers (2026-08-25, (vvv)).
//   - IT SAYS WHICH STAMP IT MEASURED. The age comes from the report's own `at`
//     when that parses and from the file's mtime when it does not, and the
//     STALE sentence names which, because an instrument that will not say what
//     it measured cannot be checked.
//
// Pure, like every classifier above it, so the falsifiers drive every branch
// without a box.
export function classifySiteRefresh({
  exists,
  report = null,
  readError = null,
  atMs = null,
  mtimeMs = null,
  nowMs,
  cadenceMs,
  label,
}) {
  if (!exists) {
    // A fresh box, or a timer installed and not yet fired. Not a failure — and
    // not invisible either: INFO is counted and named in the board's summary.
    return { verdict: "INFO", reason: `${label} has written no report yet — a fresh box, or the timer has not fired since it was installed`, detail: null };
  }
  if (readError != null || report == null || typeof report !== "object") {
    return { verdict: "UNKNOWN", reason: `${label}'s report could not be read${readError ? ` (${readError})` : ""}`, detail: null };
  }

  const detail = typeof report.detail === "string" && report.detail !== "" ? report.detail : null;
  const stampMs = Number.isFinite(atMs) ? atMs : (Number.isFinite(mtimeMs) ? mtimeMs : null);
  const stampName = Number.isFinite(atMs) ? "its own `at` stamp" : "the report file's mtime";
  const ageMin = stampMs == null ? null : Math.round((nowMs - stampMs) / 60_000);
  const stale = stampMs != null && nowMs - stampMs > 3 * cadenceMs;
  const cadenceMin = Math.round(cadenceMs / 60_000);
  const oldTail = stale ? `; and nothing has reported since — ${ageMin} min by ${stampName}, against a ${cadenceMin}-min cadence` : "";
  const ago = ageMin == null ? "at an unreadable time" : `${ageMin} min ago`;

  if (report.status === "failed") {
    // THE `detail` VERBATIM. It is the sentence the founder reads on Discord and
    // now on the site, so it is not summarised, reworded or truncated here.
    return {
      verdict: "DOWN",
      reason: `${label} failed: ${detail ?? "no detail was written"}${oldTail}`,
      detail,
    };
  }

  if (report.status === "published" || report.status === "quiet") {
    if (stale) {
      return {
        verdict: "STALE",
        reason: `${label} last reported ${ageMin} min ago by ${stampName}, against a ${cadenceMin}-min cadence — its newest word is "${report.status}", which stopped being news ${Math.max(0, ageMin - cadenceMin)} min ago`,
        detail,
      };
    }
    if (report.status === "quiet") {
      return { verdict: "OK", reason: `nothing to publish ${ago}${detail ? ` — ${detail}` : ""}`, detail };
    }
    const rel = typeof report.published === "string" && report.published !== ""
      ? report.published.split("/").filter(Boolean).pop()
      : "a release it did not name";
    return { verdict: "OK", reason: `published ${rel} ${ago}`, detail };
  }

  return {
    verdict: "UNKNOWN",
    reason: `${label} reported a status this watch does not know: "${report.status ?? "(absent)"}" — read as unread rather than as healthy${oldTail}`,
    detail,
  };
}

// ── the edge-triggered alert machine ────────────────────────────────────────

// §8 — a clone the office writes through. PURE: `state` is what
// tools/clone-state.mjs read, `seen` is this probe's divergence memory.
//
// DIRT IS DOWN, not STALE, because it is not a freshness question: while a
// tracked file sits uncommitted, the write doors that pull this clone are
// refusing residents. BEHIND is STALE, on classifyStamp's own divergence
// clock — the law is not restated here — with the reason reworded to say which
// side of the upstream the clone is on, because the repairs differ: behind is
// a pull that is not landing; ahead is signed rows the pen never pushed, which
// the tick's `pull --ff-only` then refuses on too (the 2026-08-26 race).
export function classifyClone({ state, seen = null, nowMs, dirtyGraceMs = DIRTY_GRACE_MS, behindAfterMs, label = "the clone" }) {
  if (!state || state.exists === false) {
    return { verdict: "UNKNOWN", reason: `there is no clone at ${state?.path ?? "the configured path"} — this probe reads the office box's own clone (TOWN_CLONE in the sentinel's unit)`, seen };
  }
  if (!state.readable) {
    return { verdict: "UNKNOWN", reason: `git could not read ${state.path}: ${state.error ?? "no reason given"}`, seen };
  }

  const clock = state.remote_tip
    ? classifyStamp({ served: state.head, reference: state.remote_tip, seen, nowMs, staleAfterMs: behindAfterMs, what: label, referenceName: "the town's main" })
    : { verdict: "UNKNOWN", seen };

  const dirt = judgeDirt(state, { nowMs, graceMs: dirtyGraceMs });
  if (dirt.dirty && !dirt.in_grace) {
    const age = dirt.age_ms == null ? "an unknown time (every changed path is a deletion, so there is no mtime to read)" : humanDuration(dirt.age_ms);
    return {
      verdict: "DOWN",
      reason: `${state.path} has ${dirt.files.length} uncommitted tracked file${dirt.files.length > 1 ? "s" : ""}, the oldest changed ${age} ago: ${nameFiles(state)}. Every office write that pulls this clone (git pull --rebase) refuses until a person commits the change or restores the file`,
      seen: clock.seen,
      detail: { files: dirt.files, dirty_since: dirt.since_ms == null ? null : new Date(dirt.since_ms).toISOString() },
    };
  }

  if (!state.remote_tip) {
    return { verdict: "UNKNOWN", reason: `${state.path} is clean, but the town's main tip could not be read to say whether it is current`, seen };
  }
  const side = state.against_remote;
  const at = String(state.head).slice(0, 10);
  const tip = String(state.remote_tip).slice(0, 10);
  const inFlight = dirt.dirty ? ` (${dirt.files.length} tracked change${dirt.files.length > 1 ? "s" : ""} under ${humanDuration(dirtyGraceMs)} old — a write in flight)` : "";
  if (side === "at" || clock.verdict === "OK") {
    const where = side === "at" ? `clean and at the town's main (${at})` : `${side} the town's main (clone ${at}, main ${tip}) — inside the ${humanDuration(behindAfterMs)} pull window`;
    return { verdict: "OK", reason: `${state.path} is ${where}${inFlight}`, seen: clock.seen };
  }
  const behindFor = humanDuration(nowMs - clock.seen.diverged_since);
  const why = side === "ahead"
    ? "it holds commits the pen never landed on the town, and the tick's --ff-only pull refuses on them"
    : side === "diverged"
      ? "it holds commits the pen never landed AND lacks the town's newer ones, and neither the tick nor a write can fast-forward it"
      : "the pulls that should carry it forward are not landing";
  return {
    verdict: "STALE",
    reason: `${state.path} has been ${side} the town's main for ${behindFor} (clone ${at}, main ${tip}): ${why}`,
    seen: clock.seen,
  };
}

// §9 — the ground. statfs's numbers turned into df's, so the percent here is
// the percent `df /` prints and the line sits exactly where disk-watch's did:
// used is blocks less free, the percent is used over used-plus-available
// (root's reserved blocks are in neither), rounded UP, as GNU df rounds.
export function diskUsage({ bsize, blocks, bfree, bavail }) {
  const used = (blocks - bfree) * bsize;
  const avail = bavail * bsize;
  const total = used + avail;
  return { usedPct: total > 0 ? Math.ceil((used * 100) / total) : null, freeBytes: avail };
}

export function readDiskState(path, { statfs = statfsSync } = {}) {
  try { return { path, ...diskUsage(statfs(path)) }; }
  catch (e) { return { path, error: e?.message ?? String(e) }; }
}

/** df -h's way of saying a size: 1024s, one decimal under ten, "4.9G". */
export function humanBytes(n) {
  const units = ["B", "K", "M", "G", "T"];
  let v = n, i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v < 10 && i > 0 ? v.toFixed(1) : Math.round(v)}${units[i]}`;
}

// PURE. DOWN at the line, never STALE: a full disk is not late, it is broken,
// and every writer on the box fails with it. The reason is disk-watch's own
// sentence, so a reader who knew that alarm reads the same words here.
export function classifyDisk({ usedPct = null, freeBytes = null, error = null, limitPct = 85 } = {}) {
  if (error || !Number.isFinite(usedPct)) {
    return { verdict: "UNKNOWN", reason: `could not read the root disk${error ? ` (${String(error).slice(0, 120)})` : ""}` };
  }
  const free = Number.isFinite(freeBytes) ? humanBytes(freeBytes) : "unknown";
  const detail = { used_pct: usedPct, free_bytes: freeBytes, limit_pct: limitPct };
  if (usedPct >= limitPct) {
    return {
      verdict: "DOWN",
      reason: `at ${usedPct}% used (${free} free; alarm at ${limitPct}%). On 10-09 a full disk took Postgres and sign-in down. Look at /tmp, /srv/postmark-site-refresh and /srv/world2-lab first`,
      detail,
    };
  }
  return { verdict: "OK", reason: `${usedPct}% used, ${free} free: under ${limitPct}%`, detail };
}

// §10 — the meeps. PURE: `raw` is the file's text, or null when there is none.
//
// MISSING AND UNREADABLE ARE STALE, NEVER UNKNOWN, on purpose: UNKNOWN never
// alerts here and /fleet's sentinelBark barks only on DOWN or STALE, so an
// UNKNOWN would be a dead watcher read as silence on both of the routes this
// file feeds. The watcher's `summary` is already the one line that names the
// meep, the kind and the evidence, so it is the reason verbatim.
//
// A DEGRADED RECORD IS A WARN ONLY WHEN IT SAYS SO (POS-838, Wright 2026-10-30
// 23:42, STAR-84 option B). Until then both DEGRADED and DOWN were DOWN, so a
// lone missed round barked as an outage: the Registrar's 559-second late fire of
// 10-31 was announced as a meep down. The watcher's severity split gives every
// problem a severity, "down" or "warn", and marks the record DOWN if any is "down". So a
// DEGRADED record is a WARN when it lists problems and every one carries severity
// "warn", and DOWN otherwise, which is what it always was. The failure is on the
// safe side on purpose: the watcher that ran before the severity split marked
// STUCK and CUT OFF meeps DEGRADED too, with no severity on anything, and a stuck
// meep must never read as a warning because a field was missing. Only the exact
// word "warn" counts. A WARN is announced once as a notice (see transition), and
// composeBoard rolls it up as DEGRADED, never as DOWN.
export function classifyMeeps({ raw = null, readError = null, nowMs, staleAfterMs = 15 * MINUTE, path = "the meeps record" } = {}) {
  const watcher = "the desktop watcher (starforge-rig's windows/meepops/meep-watch.mjs, every 5 min by scp)";
  if (raw == null) {
    return { verdict: "STALE", reason: `there is no meeps record at ${path}${readError ? ` (${String(readError).slice(0, 80)})` : ""} — ${watcher} has not landed one, so nothing is watching the meeps` };
  }
  let rec;
  try { rec = JSON.parse(raw); } catch (e) {
    return { verdict: "STALE", reason: `the meeps record at ${path} does not parse (${String(e?.message ?? e).slice(0, 80)}) — nothing readable is watching the meeps` };
  }
  const at = Date.parse(rec?.generated_at ?? "");
  if (!Number.isFinite(at)) {
    return { verdict: "STALE", reason: `the meeps record at ${path} carries no readable generated_at — it cannot say when the meeps were last seen` };
  }
  const age = nowMs - at;
  const detail = { status: rec.status ?? null, generated_at: rec.generated_at, problems: Array.isArray(rec.problems) ? rec.problems.length : null };
  if (age > staleAfterMs) {
    return { verdict: "STALE", reason: `the meeps record is ${humanDuration(age)} old (written ${rec.generated_at}; stale after ${humanDuration(staleAfterMs)}) — ${watcher} or the desktop has stopped`, detail };
  }
  const summary = String(rec.summary ?? "").trim() || "no summary in the record";
  if (rec.status === "OK") return { verdict: "OK", reason: summary, detail };
  if (rec.status === "DOWN") return { verdict: "DOWN", reason: summary, detail };
  if (rec.status === "DEGRADED") {
    const problems = Array.isArray(rec.problems) ? rec.problems : [];
    const allWarn = problems.length > 0 && problems.every((p) => p?.severity === "warn");
    return { verdict: allWarn ? "WARN" : "DOWN", reason: summary, detail };
  }
  return { verdict: "STALE", reason: `the meeps record's status is ${JSON.stringify(rec.status ?? null)}, which this probe does not read — unread is never healthy`, detail };
}

// §12 — the law pen. PURE: `raw` is the state file's text, or null when there
// is none (deploy/world2-ingest.sh writes /srv/world2-lab/state/ingest-law.json
// at every fire, the idle ones included).
//
// WHY IT PAGES (POS-619, Wright 2026-10-14): law-ingest refuses a law the
// parser would read diminished WHOLE, so one lossy class mark holds EVERY law
// update until it is fixed (the heist's dial is a class mark). The roll-call
// reads it as ALARM-failed, but only when somebody runs the roll-call; this
// file is the one alarm route, so the held law is a probe here. The refusal
// is the reason verbatim: the lint's own sentence names the mark and the fix.
// Missing and unreadable are STALE, never UNKNOWN, as with the meeps.
export function classifyLawPen({ raw = null, readError = null, nowMs, staleAfterMs = 45 * MINUTE, path = "the law pen's state" } = {}) {
  if (raw == null) {
    return { verdict: "STALE", reason: `there is no law pen state at ${path}${readError ? ` (${String(readError).slice(0, 80)})` : ""} — the law pen has not run, so nothing is carrying the world's law into the store` };
  }
  let st;
  try { st = JSON.parse(raw); } catch (e) {
    return { verdict: "STALE", reason: `the law pen state at ${path} does not parse (${String(e?.message ?? e).slice(0, 80)}) — unread is never healthy` };
  }
  const at = Date.parse(st?.at ?? "");
  if (!Number.isFinite(at)) return { verdict: "STALE", reason: `the law pen state at ${path} carries no readable at — it cannot say when the law pen last ran` };
  const age = nowMs - at;
  const detail = { status: st.status ?? null, at: st.at, sha: st.law?.sha ?? null, exit: st.law?.exit ?? null };
  if (age > staleAfterMs) {
    return { verdict: "STALE", reason: `the law pen last wrote ${humanDuration(age)} ago (${st.at}; stale after ${humanDuration(staleAfterMs)}) — the store's law stops advancing and nothing says so`, detail };
  }
  if (st.status === "ok") return { verdict: "OK", reason: `ingested the law at ${String(st.law?.sha ?? "?").slice(0, 9)} (${st.at})`, detail };
  if (typeof st.refusal === "string" && st.refusal.trim()) {
    const [first, ...rest] = st.refusal.trim().split("\n");
    const marks = rest.filter((l) => l.startsWith("  ")).map((l) => l.trim());
    return { verdict: "DOWN", reason: `the law pen REFUSED the law, and every law update waits until the mark is fixed: ${first}${marks.length ? ` — ${marks.join(" · ")}` : ""}`, detail };
  }
  // A HELD PIN (POS-628/POS-635): the rows were written and the run exited 0,
  // but the clearing's pin did not move, so every settlement seals the old law.
  if (st.status === "law-pin-held") {
    const pin = String(st.pin?.sha ?? "?").slice(0, 9);
    const why = String(st.pin?.why ?? "").replace(/^\[law-ingest\] PIN HELD — /, "").trim();
    return { verdict: "DOWN", reason: `the law pen HELD the clearing's pin at ${pin}, so every settlement seals that law until it moves${why ? `: ${why.slice(0, 240)}` : ""}`, detail: { ...detail, pin: st.pin?.sha ?? null } };
  }
  const tail = String(st.detail ?? "").trim().split("\n").slice(-1)[0] ?? "";
  return { verdict: "DOWN", reason: `the law pen's last run reads ${JSON.stringify(st.status ?? null)}${st.law?.exit != null ? ` (exit ${st.law.exit})` : ""} — the store's law did not advance${tail ? `: ${tail.slice(0, 200)}` : ""}`, detail };
}

// ── §13 the Linear handler: did its last finished run act? ───────────────────
//
// The Starforge Linear handler (keeminlee/starforge-linear-handler) is the only
// automatic mover of Linear states. Each caller repo runs it as
// .github/workflows/linear-handler.yml on pull_request_target, and the job has
// two steps of ours: `linear` (acts on Linear; it fails only when the handler
// could not act) and `done line` (fails when the PR's done line needs fixing:
// the author's to fix, never an alarm). If its runs fail, issues silently stop
// moving, so a failure is a probe here (POS-631; the shape is Jetto's, 10-14).
//
// THE RULE (Wright, 10-14, G1): DOWN when the newest DECISIVE run did not
// succeed and its `linear` step is not `success`. That counts a checkout that
// failed first (linear skipped), a startup_failure (no jobs at all) and a
// timeout: in each one the handler did not act. A `done line` failure after a
// successful `linear` is OK, and says so.
//
// WHAT IT LEARNED FROM THE LIVE RUNS (10-14):
//   - A `done line` failure makes the whole run's conclusion `failure`, so the
//     conclusion alone cannot tell the steps apart. A run that SUCCEEDED does
//     prove `linear` did (neither step is continue-on-error), so the jobs are
//     read only for a run that did not succeed.
//   - Cancellations are looked through (INDECISIVE, §5's law): the caller's
//     concurrency group still cancels a superseded pending run, and a cancelled
//     newest run must not hide the failure beneath it.
//   - The job summary, where the handler writes why it failed, has no REST read
//     (the check run's output.summary is null). The reason comes from the failed
//     job's annotations instead, past GitHub's generic "Process completed with
//     exit code N"; the run URL is always there.
//   - 404 is two answers: the workflow has no run yet (its caller is not on the
//     repo's default branch, which is where pull_request_target reads it), or
//     the token cannot see a private repo (postmark-telemetry). One read of the
//     repo itself tells them apart: the first is INFO, the second UNKNOWN.
//
// PURE: the caller reads GitHub, so every branch is falsifiable offline.

/** GitHub's own line for a step that exited non-zero: true, and no reason. */
const GENERIC_EXIT = /^Process completed with exit code \d+\.?$/;

/**
 * The reason's last clause: the first failure annotation that says more than
 * the generic exit line, else the generic line, else a pointer to the summary.
 */
export function handlerFailureLine(annotations) {
  const failures = (Array.isArray(annotations) ? annotations : []).filter((a) => a?.annotation_level === "failure");
  const told = failures.find((a) => a?.message && !GENERIC_EXIT.test(firstLine(a.message)));
  if (told) return firstLine(told.message).slice(0, 200);
  const generic = failures.find((a) => a?.message);
  return `${generic ? `${firstLine(generic.message).replace(/\.$/, "")}; ` : ""}the reason is in the job summary`;
}

/**
 * One repo's row. Inputs, as the adapter read them:
 *   haveToken   false: nothing was read (W4: keyless, this probe spends nothing).
 *   readError   the runs read failed for a reason other than 404.
 *   notFound    the runs read answered 404; `repoVisible` is then true (the repo
 *               answered: no run yet), false (it 404'd too: the token cannot see
 *               it) or null (that read failed).
 *   runs        the workflow's newest completed runs, newest first.
 *   jobs        the decisive run's jobs, or null when unread (only asked for a
 *               run that did not succeed).
 *   annotations the failed job's annotations, or null when unread.
 */
export function classifyLinearHandler({ repo, haveToken = true, readError = null, notFound = false, repoVisible = null, runs = [], jobs = null, annotations = null, step = "linear" } = {}) {
  if (!haveToken) return { verdict: "UNKNOWN", reason: `no GitHub token, so ${repo}'s handler runs are unread: this probe reads only with the token, which leaves the keyless budget to the others` };
  if (notFound) {
    if (repoVisible === true) return { verdict: "INFO", reason: `no handler run in ${repo} yet: its caller is not on the default branch, or no PR event has come since it landed` };
    if (repoVisible === false) return { verdict: "UNKNOWN", reason: `the sentinel's token cannot see ${repo} (404), so its handler runs are unread: the token needs Actions: read and Checks: read on it` };
    return { verdict: "UNKNOWN", reason: `${repo}'s handler workflow answered 404, and the repo itself could not be read to say why` };
  }
  if (readError) return { verdict: "UNKNOWN", reason: `GitHub did not answer for ${repo}'s handler runs: ${firstLine(readError).slice(0, 160)}` };
  const finished = (runs ?? []).filter((r) => r?.status === "completed");
  const run = finished.find((r) => !INDECISIVE.has(r?.conclusion));
  if (!run) {
    return finished.length
      ? { verdict: "UNKNOWN", reason: `every recent handler run in ${repo} was cancelled or skipped, so nothing has been decided` }
      : { verdict: "INFO", reason: `no finished handler run in ${repo} yet` };
  }
  const detail = { repo, run_id: run.id ?? null, attempt: run.run_attempt ?? 1, conclusion: run.conclusion, url: run.html_url ?? null };
  const url = run.html_url ?? `${repo}'s Actions tab`;
  if (run.conclusion === "success") return { verdict: "OK", reason: `the last finished run succeeded (${run.created_at})`, detail };
  if (jobs == null) return { verdict: "UNKNOWN", reason: `the last finished run in ${repo} was "${run.conclusion}" and its jobs could not be read, so which step failed is unknown — ${url}`, detail };
  const steps = (jobs ?? []).flatMap((j) => j?.steps ?? []);
  const ours = steps.find((s) => s?.name === step);
  if (ours?.conclusion === "success") {
    return { verdict: "OK", reason: `the last finished run failed on its done line, which is the PR author's to fix and never an alarm (${run.created_at}) — ${url}`, detail: { ...detail, step: "success" } };
  }
  const what = !ours ? "never ran" : ours.conclusion === "skipped" ? "was skipped (a step before it failed)" : `was "${ours.conclusion ?? ours.status}"`;
  // No jobs at all (a startup_failure): there is no job summary to point at (review N2).
  const why = (jobs ?? []).length ? `its ${step} step ${what}: ${handlerFailureLine(annotations)}` : "the run never started a job";
  return {
    verdict: "DOWN",
    reason: `the handler could not act in ${repo}: the last finished run was "${run.conclusion}" and ${why} — ${url}`,
    detail: { ...detail, step: ours?.conclusion ?? null },
  };
}

// ── §11 the settlement: the sweep and its blessing ──────────────────────────
//
// THE RULING (Darko, 2026-10-11): "If the settlement that we expect has not
// gone through an hour after its expected time … it needs to bark." A blocked
// settlement is the town's top priority, and this file is the ONE alarm route,
// so the bark is a probe here.
//
// THE INSTANCES. The 2026-10-10T18:00Z sweep published world 33306f30 and no
// settlement tag covered it until S102 (on 0cca7f2b, a descendant) at about
// 06:38Z the next morning — twelve hours with nothing ringing. The
// 2026-10-11T18:00Z sweep published 5d878f3c and was held: an hour later the
// newest tag was still S102. The roll-call's ALARM-unblessed (tools/box-
// rollcall.mjs) asks a different question — how OLD is the newest tag — on the
// operator round's clock; this asks the per-sweep question on the sentinel's
// ten-minute one: did THE sweep we expected settle within the hour?
//
// WHAT "SETTLED" MEANS. The box's sweep (deploy/settlement-auto.sh, 06:00 and
// 18:00 UTC, postmark-settlement.timer) writes ONE receipt, overwritten each
// run, at /srv/postmark-harbor/settlement-auto.json. The keeper's blessing is
// an annotated tag `settlement/S<N>` on postmark-world, normally cut by ~:40.
// A later tag covers every earlier sweep, so only the NEWEST receipt and the
// NEWEST tag (by number, never by text: S10 sorts before S9) matter, and the
// sweep is settled when that tag's peeled commit IS the receipt's world_to or
// descends from it.
//
// THE STATUSES are settlement-auto.sh's own `report` words: `published` and
// `quiet` are the clean ones; `refused`, `race` and `starving` are
// deploy/settlement-history.mjs's UNSETTLED set. A status this probe does not
// know is NOT read as clean — the same law as classifySiteRefresh's, but louder,
// because "nothing settled" is the ruling's whole question and an unknown word
// cannot answer it yes.
//
// A QUIET SWEEP ASKS A DIFFERENT QUESTION. The keeper tags PUBLICATIONS — S80
// to S103 are every one a `settlement: sweep N published, …` commit (plus the
// by-hand S93) — and never a quiet crossing. And main always moves between
// sweeps: the Pen's crossing-save (~00:05Z / 12:04Z), merged PRs, the sweep's
// own "household registry re-derived" commit. So a quiet sweep's world_to is
// almost never a tagged commit, it is a DESCENDANT of the newest tag, and
// asking "does a tag cover it" would page on every quiet sweep. (The first
// version of this probe did, and its quiet test hid it behind a fixture whose
// world was the tag's own commit — a state postmark-world never reaches.)
//
// The quiet question is: between the newest tag and the world this sweep
// stands on, is there a PUBLICATION nobody blessed? GitHub's compare, base =
// the tag, head = world_to, lists that range (up to 250 commits); a commit
// whose subject is `settlement: sweep …` with a nonzero count is a held
// publication. None there: OK. One there: DOWN past the hour, exactly as for
// the publishing sweep itself — a quiet morning must not clear a held night.
// A range longer than GitHub lists, or no answer, is unread: STALE past the
// hour. judgeQuietRange below is that reading, pure.
//
// THE CLOCK runs from the receipt's own `at` (the run's start stamp). Sixty
// minutes is the keeper's ~:40 plus slack, and it is the ruling's number. Inside
// it a held sweep is OK ("awaiting the blessing"); past it, DOWN. DOWN and not
// STALE: the town is not behind, it is blocked, and the repair is a person
// (postmark-telemetry docs/SHIPPING.md § 9: ours to unblock, never the keeper's).
//
// PAST THE HOUR, SILENCE IS NOT POSSIBLE (coordinator, 2026-10-11). UNKNOWN
// never alerts here and /fleet barks only on DOWN or STALE, so an unread input
// that stayed UNKNOWN would let a blocked settlement sit silent for as long as
// the input stayed unread. Inside the hour, unread is UNKNOWN — this file's
// rule for an unread reference (classifyStamp, classifyDisk), and nothing is
// overdue yet. Past it:
//   - NO RECEIPT (missing, unreadable, unparseable, no `at`) is DOWN, the same
//     sentence as the MISSING SLOT: a readable receipt whose `at` is older than
//     a slot an hour gone means the slot did not run, did not finish, or died
//     before writing — "the settlement we expect has not gone through" — and a
//     receipt nobody can read is no evidence that it did.
//   - A SWEEP WE CANNOT VERIFY (tags unlisted, the compare call failed, no
//     world named) is STALE and names the error: the sweep may well be blessed,
//     so DOWN would overstate it, but the blessing is overdue to be SEEN.
//
// PURE: the caller reads the file, the tags and GitHub's compare answer, so
// every branch below is falsifiable with no box and no network.

/** settlement-auto.sh's clean outcomes. Everything else, including an absent status, is not. */
export const SETTLEMENT_CLEAN = new Set(["published", "quiet"]);

/** The newest scheduled sweep slot at or before `nowMs`. */
export function newestSettlementSlot(nowMs, hoursUtc = SETTLEMENT_SLOTS_UTC) {
  const DAY = 24 * HOUR;
  const day = Math.floor(nowMs / DAY) * DAY;
  let best = null;
  for (const d of [day, day - DAY]) {
    for (const h of hoursUtc) {
      const s = d + h * HOUR;
      if (s <= nowMs && (best == null || s > best)) best = s;
    }
  }
  return best;
}

const hhmmZ = (ms) => `${new Date(ms).toISOString().slice(11, 16)}Z`;
const shortSha = (sha) => String(sha ?? "").slice(0, 8);
const firstLine = (s) => String(s ?? "").split("\n").map((l) => l.trim()).find(Boolean) ?? "";
// "74 min" while it reads as minutes; "12h38m" once minutes stop being a number a reader can hold.
const minutesOrDuration = (ms) => (ms < 2 * HOUR ? `${Math.floor(ms / MINUTE)} min` : humanDuration(ms));

const SHIPPING_9 = "blocked, ours to unblock (postmark-telemetry SHIPPING.md § 9)";

/**
 * @param {object|null} receipt      settlement-auto.json, parsed; null when unread
 * @param {{n:number, sha:string}|null} newestTag  the highest-numbered settlement/S<n>, PEELED to its commit
 * @param {boolean|null} covered     PUBLISHED: does newestTag.sha equal or descend from the world? QUIET: is
 *                                   every publication past the tag blessed (judgeQuietRange)? null = unanswered
 * @param {number|null} writtenAtMs  the receipt file's mtime — when the sweep finished — for the reason line only
 * @param {string|null} tagError     why the tags could not be listed, when they could not
 * @param {string|null} coverError   why GitHub's compare did not answer, when it did not
 * @param {object|null} held         a quiet sweep's unblessed publication { sha, subject }, from judgeQuietRange
 */
export function classifySettlement({
  receipt = null,
  readError = null,
  newestTag = null,
  covered = null,
  nowMs,
  writtenAtMs = null,
  tagError = null,
  coverError = null,
  held = null,
  graceMs = SETTLEMENT_GRACE_MS,
  slotsUtc = SETTLEMENT_SLOTS_UTC,
  path = "the settlement receipt",
} = {}) {
  const slotMs = newestSettlementSlot(nowMs, slotsUtc);
  const slotOverdue = slotMs != null && nowMs - slotMs > graceMs;

  // NO READABLE RECEIPT. Past the newest slot's hour it is the missing-slot
  // sentence, DOWN; inside it, UNKNOWN (see the header: silence is not
  // possible past the hour, and nothing is overdue before it).
  const unread = receipt == null || typeof receipt !== "object"
    ? `could not read ${path}${readError ? ` (${String(readError).slice(0, 80)})` : ""}`
    : !Number.isFinite(Date.parse(receipt.at ?? "")) ? `${path} carries no readable \`at\`, so it cannot say which sweep it is` : null;
  if (unread) {
    if (slotOverdue) {
      return {
        verdict: "DOWN",
        reason: `no sweep receipt for the ${hhmmZ(slotMs)} slot after ${minutesOrDuration(nowMs - slotMs)}: ${unread}, and a receipt nobody can read is no evidence the sweep settled; ${SHIPPING_9}`,
      };
    }
    return { verdict: "UNKNOWN", reason: `${unread}, so nothing can say whether the last sweep settled` };
  }
  const atMs = Date.parse(receipt.at);
  const status = receipt.status ?? null;
  const world = receipt.world_to || receipt.world_from || null;
  const detail = {
    at: receipt.at, status, world_to: world,
    newest_tag: newestTag ? `S${newestTag.n}` : null, newest_tag_sha: newestTag?.sha ?? null,
    covered: newestTag && world && newestTag.sha === world ? true : covered,
  };
  const sweep = `the ${hhmmZ(atMs)} sweep`;

  // THE MISSING SLOT, first: it needs neither the tags nor the status, and a
  // receipt from the slot before is not evidence about this one.
  if (slotOverdue && atMs < slotMs) {
    return {
      verdict: "DOWN",
      reason: `no sweep receipt for the ${hhmmZ(slotMs)} slot after ${minutesOrDuration(nowMs - slotMs)}: the newest receipt is still the ${receipt.at} sweep (${status ?? "no status"}). The timer did not fire, the sweep is still running, or it died before writing; ${SHIPPING_9}`,
      detail,
    };
  }

  const since = nowMs - atMs;
  const late = since > graceMs;

  if (!SETTLEMENT_CLEAN.has(status)) {
    // The refusal's own first line — the classifier's `cause` when there is
    // one, the report's `detail` otherwise — so the bark says WHAT refused.
    const why = (firstLine(receipt.refusal?.cause) || firstLine(receipt.detail) || "no refusal was written").slice(0, 200);
    const word = status == null ? "with no status" : `"${status}"`;
    if (!late) {
      return { verdict: "OK", reason: `${sweep} ended ${word} ${minutesOrDuration(since)} ago (${why}); inside the ${humanDuration(graceMs)} window for a rerun`, detail };
    }
    return { verdict: "DOWN", reason: `${sweep} ended ${word} and nothing has settled after ${minutesOrDuration(since)}: ${why}; ${SHIPPING_9}`, detail };
  }

  // ── THE PRINTOUT'S REPORT-ONLY FINDINGS (POS-1025/c) ──────────────────────
  //
  // Since the settlement prints its sealed snapshot, the harm gate and the tag
  // can no longer hold a crossing: the town publishes, and the finding is an
  // alarm. This probe is the one alarm route, so it barks on them at once, with
  // no grace: a harm finding over a published printout is the 2026-09-16 crisis
  // class (a resident's mark moved or lost with no act naming it), and a
  // refused tag or record is a settlement that published and is not blessed —
  // both already final, neither cleared by waiting. DOWN, for §11's reason: a
  // person must act (SHIPPING.md § 9).
  const printedS = receipt.settlement != null ? `S${receipt.settlement}` : "the settlement";
  if (receipt.harm && receipt.harm.ok === false) {
    const named = (receipt.harm.checks ?? []).filter((c) => c && c.ok === false)
      .map((c) => `${c.name}: ${(c.rows ?? []).slice(0, 2).join("; ")}${(c.count ?? 0) > 2 ? ` … and ${c.count - 2} more` : ""}`).join(" | ");
    const why = named || `the gate could not gate (${String(receipt.harm.could_not_gate ?? "no report").slice(0, 120)})`;
    return { verdict: "DOWN", reason: `${sweep} published ${printedS}, and the harm gate named harm over its printout: ${why.slice(0, 300)}; ${SHIPPING_9}`, detail };
  }
  const tagRefused = receipt.tag?.status === "refused" ? receipt.tag : receipt.record?.status === "refused" ? receipt.record : null;
  if (tagRefused) {
    const which = receipt.tag?.status === "refused" ? "its tag" : "the store's record of it";
    return {
      verdict: "DOWN",
      reason: `${sweep} published ${printedS}, and ${which} refused (${tagRefused.refused ?? "refused"}: ${String(tagRefused.detail ?? "").slice(0, 200)}); a settlement tag is never moved — ${SHIPPING_9}`,
      detail,
    };
  }

  // A SWEEP WE CANNOT VERIFY: UNKNOWN inside the hour, STALE past it, and the
  // error is in the sentence so the reader knows which instrument failed.
  const unverifiable = (error) => (late
    ? { verdict: "STALE", reason: `cannot verify ${sweep}'s blessing for ${minutesOrDuration(since)}: ${error}`, detail }
    : { verdict: "UNKNOWN", reason: `cannot verify ${sweep}'s blessing yet: ${error}`, detail });

  if (!world) {
    return unverifiable(`the receipt reports "${status}" but names no world_to, so no tag can be checked against it`);
  }
  if (!newestTag || !Number.isInteger(newestTag.n) || !newestTag.sha) {
    return unverifiable(`could not list the world's settlement/S<n> tags (${String(tagError ?? "no tag was listed").slice(0, 160)}) to say whether anything covers ${shortSha(world)}`);
  }

  const tag = `S${newestTag.n}`;
  const newest = `newest is ${tag} on ${shortSha(newestTag.sha)}`;
  const isCovered = newestTag.sha === world ? true : covered;

  if (status === "quiet") {
    // The quiet question (see the header): is a PUBLICATION between the newest
    // tag and this world unblessed? `covered` answers it (judgeQuietRange), and
    // `held` names the publication when there is one.
    const what = `${sweep} was quiet, standing on ${shortSha(world)}`;
    if (isCovered === true) {
      return {
        verdict: "OK",
        reason: newestTag.sha === world
          ? `${sweep} had nothing to publish, and ${tag} is the world it stood on (${shortSha(world)})`
          : `${sweep} had nothing to publish, and no publication since ${tag} is unblessed (world at ${shortSha(world)})`,
        detail,
      };
    }
    if (isCovered == null) {
      return unverifiable(`${what}, and GitHub did not list what lies between ${tag} (${shortSha(newestTag.sha)}) and it (${String(coverError ?? "not asked").slice(0, 160)})`);
    }
    const pub = held?.sha ? `${shortSha(held.sha)} "${String(held.subject ?? "").slice(0, 120)}"` : "a sweep publication";
    const heldDetail = { ...detail, held: held ?? null };
    if (!late) {
      return { verdict: "OK", reason: `${what}; ${pub} since ${tag} is awaiting the blessing, ${minutesOrDuration(since)} since the sweep (it barks at ${hhmmZ(atMs + graceMs)})`, detail: heldDetail };
    }
    return {
      verdict: "DOWN",
      reason: `${what}, and ${pub} still has no settlement tag after ${minutesOrDuration(since)} (${newest}): an earlier sweep's publication is still unblessed: ${SHIPPING_9}`,
      detail: heldDetail,
    };
  }

  const what = `${sweep} published ${shortSha(world)}${Number.isFinite(writtenAtMs) ? ` at ${hhmmZ(writtenAtMs)}` : ""}`;
  if (isCovered === true) {
    return { verdict: "OK", reason: `${tag} covers ${sweep} (${shortSha(world)})`, detail };
  }
  if (isCovered == null) {
    return unverifiable(`${what}, and GitHub did not say whether ${tag} (${shortSha(newestTag.sha)}) descends from it (${String(coverError ?? "not asked").slice(0, 160)})`);
  }
  if (!late) {
    return { verdict: "OK", reason: `${what}; awaiting the blessing, ${minutesOrDuration(since)} since the sweep (${newest}; it barks at ${hhmmZ(atMs + graceMs)})`, detail };
  }
  return {
    verdict: "DOWN",
    reason: `${what} and no settlement tag covers it after ${minutesOrDuration(since)} (${newest}): ${SHIPPING_9}`,
    detail,
  };
}

/**
 * A world commit a settlement writes when it PUBLISHED: the sweep's `settlement: sweep 6 published, 0 unpublished, …`,
 * or, since the printout (POS-1025), `settlement: S214 printout — 3 written, 1 removed, 0 re-framed`. The settlement's
 * own number is not a count, so a printout is judged on the three counts after the dash.
 */
export function isSweepPublication(message) {
  const s = firstLine(message);
  const printout = /^settlement: S\d+ printout\b(.*)$/.exec(s);
  if (printout) return (printout[1].match(/\d+/g) ?? []).some((n) => Number(n) > 0);
  return /^settlement: sweep\b/.test(s) && (s.match(/\d+/g) ?? []).some((n) => Number(n) > 0);
}

/**
 * The quiet sweep's question, read off GitHub's compare with base = the newest
 * tag's commit and head = the quiet sweep's world. PURE.
 *   identical / behind  the world is the tag, or behind it: nothing unblessed.
 *   ahead / diverged    `commits` is what the tag does not cover; any sweep
 *                       publication among them is held.
 * Unread — no list, a range longer than GitHub lists (250), a status not named
 * here — is covered: null with the reason, never a guess.
 *
 * @returns {{covered: boolean|null, held: {sha:string, subject:string}|null, error: string|null}}
 */
export function judgeQuietRange(cmp) {
  const st = cmp?.status;
  if (st === "identical" || st === "behind") return { covered: true, held: null, error: null };
  if (st !== "ahead" && st !== "diverged") return { covered: null, held: null, error: `the compare answered status ${JSON.stringify(st ?? null)}` };
  const commits = cmp.commits;
  if (!Array.isArray(commits)) return { covered: null, held: null, error: "the compare listed no commits" };
  const total = Number.isInteger(cmp.total_commits) ? cmp.total_commits : commits.length;
  if (total > commits.length) {
    return { covered: null, held: null, error: `${total} commits lie past the tag and GitHub lists only ${commits.length}` };
  }
  const hit = commits.find((c) => isSweepPublication(c?.commit?.message));
  return hit
    ? { covered: false, held: { sha: hit.sha, subject: firstLine(hit.commit.message) }, error: null }
    : { covered: true, held: null, error: null };
}

// ── §14–§19 what nothing watched (POS-968, the STAR-161 sitting) ─────────────
//
// THE RULING (Darko, 2026-11-08 17:13–17:24 EST): one alarm system, and this
// file stays the town's half of it and its one Discord route. These probes are
// the box's gaps the sitting's packet measured: Postgres killed an office read
// and a resident got a 500 with nothing ringing (POS-963), the quest board
// answered residents 503 in bursts all evening with nothing ringing (POS-965),
// certbot failed on every run while dev's origin certificate ran out, a unit
// failed 52 times unseen, and a backup that did not ship reached nobody. The
// condition over all of it, verbatim: "make sure that we don't accidentally
// drop any alarms in the move. false alarms are fine as long as we iterate and
// fix them as we find them."
//
// So each starts at full strength, and AN UNREAD SOURCE IS STALE, never OK and
// never UNKNOWN, for the reason the meeps and the law pen give: UNKNOWN never
// alerts here and /fleet barks only on DOWN or STALE, so an unread source
// read as UNKNOWN would be a blind probe read as silence.
//
// Each reads something the box already writes; nothing new runs. THE BOARD IS
// PUBLIC (/ops/sentinel.json), so no reason below carries a handle, a query,
// an error's text or a unit's name: a route is masked, a trip is named by its
// door, a stuck session by its pid and pool, and the failed units by count (their
// names ride `said`, which only the post, the change log and state.json carry) (POS-568 keeps the raw error out of what a
// resident reads, and the board is read by anyone).

/** The most events inside any one `windowMs` span. PURE: two pointers over the sorted times. */
export function mostInWindow(times, windowMs) {
  const t = [...(times ?? [])].filter(Number.isFinite).sort((a, b) => a - b);
  let best = 0;
  for (let lo = 0, hi = 0; hi < t.length; hi++) {
    while (t[hi] - t[lo] > windowMs) lo++;
    best = Math.max(best, hi - lo + 1);
  }
  return best;
}

const hhmmssZ = (ms) => `${new Date(ms).toISOString().slice(11, 19)}Z`;
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
/** Up to `n` items, then how many were held back: a remainder that is not counted is a silent truncation. */
const listSome = (items, n = 3) => `${items.slice(0, n).join("; ")}${items.length > n ? `; and ${items.length - n} more` : ""}`;

// ── §14/§19 the office's journal: one read for the kills and the trips ───────
//
// The office logs Postgres's kill of an idle transaction as
// `[store-pool pen] a held connection failed (officeRead): terminating
// connection due to idle-in-transaction timeout`, and every last-resort catch
// as `[office] <door>: the office tripped: <error>` (src/fault-words.mjs
// faultLogged) or, at a REST door, `[office] answered 500 (the office tripped):
// <error>` (src/server.mjs bounce). Postgres's own log is `postgres:adm 0640`
// and this runs as meepo, which is not in adm; the office's journal is
// meepo's, so this is the source the sentinel can read (measured 2026-11-09).
export const KILL_LINE = /terminating connection due to idle-in-transaction timeout/;
export const TRIP_LINE = /the office tripped/;

/** journalctl's `-o json` lines, as { atMs, message }. MESSAGE is an array of bytes when it is not text. */
export function parseJournalJson(text) {
  const out = [];
  for (const line of String(text ?? "").split("\n")) {
    if (!line.trim()) continue;
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    const atMs = Number(e?.__REALTIME_TIMESTAMP) / 1000;
    const m = e?.MESSAGE;
    const message = Array.isArray(m) ? Buffer.from(m).toString("utf8") : String(m ?? "");
    if (Number.isFinite(atMs)) out.push({ atMs, message });
  }
  return out;
}

/**
 * The unit's journal since `sinceMs`: { entries, seen, error }.
 *
 * AN EMPTY WINDOW IS TWO ANSWERS. A quiet office logs nothing for a while; a
 * reader that cannot see the office's journal at all gets nothing either, and
 * journalctl exits 0 for both (it only prints a hint for the second). So an
 * empty window asks once more for the newest line of any age: one line means
 * the reader can see, none means it is blind (`seen: false`), which §14 and
 * §19 read as STALE.
 */
export function readOfficeJournal(unit, sinceMs, { exec = execFileSync, timeoutMs = CONFIG.requestTimeoutMs } = {}) {
  const ask = (args) => String(exec("journalctl", ["-q", "-u", unit, ...args, "-o", "json", "--output-fields=MESSAGE", "--no-pager"], {
    encoding: "utf8", timeout: timeoutMs, maxBuffer: 64 * 2 ** 20, stdio: ["ignore", "pipe", "pipe"],
  }));
  try {
    const entries = parseJournalJson(ask(["--since", `@${Math.floor(sinceMs / 1000)}`]));
    if (entries.length) return { entries, seen: true, error: null };
    return { entries, seen: parseJournalJson(ask(["-n", "1"])).length > 0, error: null };
  } catch (e) {
    return { entries: null, seen: false, error: (firstLine(e?.stderr) || firstLine(e?.message ?? e)).slice(0, 160) };
  }
}

// ── §15 the office's access log ─────────────────────────────────────────────

/** When a request was ANSWERED: its start plus its duration. A line lands in the log at that moment. */
export function answeredAt(row) {
  const t = Date.parse(row?.ts ?? "");
  return Number.isFinite(t) ? t + (Number.isFinite(row?.ms) ? row.ms : 0) : NaN;
}

/**
 * A route as the board may name it: the method, the door, and every segment
 * past it masked. `/quests/<h>` is one route however many residents knock on
 * it, which is the whole point (POS-965 was 398 503s spread across handles).
 * The town's namespaced doors keep their second segment, since `/world/apex`
 * and `/world/walkers` are different doors, not one door and a handle.
 */
const NAMESPACED = new Set(["world", "world2", "town", "ops", "oauth", ".well-known"]);
export function routeOf(method, path) {
  const segs = String(path ?? "").split("/").filter(Boolean);
  const keep = segs.length && NAMESPACED.has(segs[0]) ? 2 : 1;
  return `${method ?? "?"} /${segs.map((s, i) => (i < keep ? s : "<h>")).join("/")}`;
}

/**
 * Every 5xx the office answered between `sinceMs` and `nowMs`, from the day
 * files those moments fall in: { rows, newestMs, error }. `newestMs` is the
 * newest line of any status answered in that span, or null: the sentinel's
 * own GET /api/ lands one every tick, so an office that is answering is never
 * without one, and none is a blind log, not a calm one.
 *
 * Reads whole day files (about 18 MB at a day's end), parsing only the lines a
 * cheap test says are 5xx. Unread (a file that exists and cannot be read, or no
 * file at all for the span) is `rows: null` with the reason.
 */
export function readAccessErrors(dir, { sinceMs, nowMs, read = readFileSync } = {}) {
  const DAY = 24 * HOUR;
  const days = [];
  for (let d = Math.floor(sinceMs / DAY) * DAY; d <= nowMs; d += DAY) days.push(new Date(d).toISOString().slice(0, 10));
  const rows = [];
  let newestMs = null, found = 0;
  for (const day of days) {
    const file = join(dir, `access-${day}.jsonl`);
    let text;
    try { text = String(read(file, "utf8")); } catch (e) {
      if (e?.code === "ENOENT") continue;
      return { rows: null, newestMs: null, error: `${file} could not be read (${e?.code ?? e?.message ?? e})` };
    }
    found++;
    const lines = text.split("\n");
    for (const line of lines) {
      if (!line.includes('"status":5')) continue;
      let r;
      try { r = JSON.parse(line); } catch { continue; }
      if (!(r?.status >= 500 && r.status < 600)) continue;
      const at = answeredAt(r);
      if (at >= sinceMs && at <= nowMs) rows.push({ at, method: r.method ?? null, path: r.path ?? "", status: r.status });
    }
    // The newest line answered inside the span. Lines land in answer order, so
    // the walk back from the end stops at the first one older than the span.
    for (let i = lines.length - 1; i >= 0; i--) {
      if (!lines[i]) continue;
      const ts = /"ts":"([^"]*)"/.exec(lines[i])?.[1];
      const ms = Number(/"ms":(\d+)/.exec(lines[i])?.[1] ?? 0);
      const at = Date.parse(ts ?? "") + ms;
      if (!Number.isFinite(at) || at > nowMs) continue;
      if (at >= sinceMs) newestMs = Math.max(newestMs ?? at, at);
      break;
    }
  }
  if (!found) return { rows: null, newestMs: null, error: `there is no access log in ${dir} for ${days.join(" or ")}` };
  return { rows, newestMs, error: null };
}

// ── §14 the store ───────────────────────────────────────────────────────────
//
// THE RULE (the sitting's call 2, option (i), ruled as recommended): "DOWN when
// residents get 5 or more 5xx on one route in a 10-minute run, or a kill
// coincides with a 500; WARN on a kill with no 500." This is the second half;
// §15 is the first. A kill COINCIDES with a 500 when the office answered a 500
// within the window of it: the journal and the access log share no request id,
// so nearness in time is the one honest pairing. POS-963 is the shape: the read
// started 18:09:03Z, Postgres killed its connection at 18:09:33Z, the office
// logged the kill at 18:09:50Z and answered the resident 500 the same second.
// A kill beside only 503s is a WARN here, by the ruling's word "500"; the 503s
// are §15's to count.
//
// The store watch (src/store-txn-watch.mjs) adds what the kill line cannot: a
// session idle inside a transaction for 5 s or more is a WARN the minute it is
// seen, before the 30 s timeout kills it (it saw 18:09:10Z, pid 1730459, the
// session Postgres killed at 18:09:33Z). A minute the watch could not ask the
// store is a WARN too, in the watch's own words: it is not calm.
//
// PURE: `kills` and `answered500` are times (ms), or null when their source
// was unread, with `journalWhy` / `accessError` saying why.
const RANK = { DOWN: 4, STALE: 3, WARN: 2, OK: 1 };
const worstOf = (parts) => parts.reduce((w, p) => (RANK[p.verdict] > RANK[w] ? p.verdict : w), "OK");
const sayParts = (parts) => [...parts].sort((a, b) => RANK[b.verdict] - RANK[a.verdict]).map((p) => p.text).join("; ");

export function classifyStoreHealth({
  txnRaw = null, txnError = null, kills = null, journalWhy = null, answered500 = null, accessError = null,
  nowMs, sinceMs, windowMs = 10 * MINUTE, staleAfterMs = 5 * MINUTE, path = "the store watch's record",
} = {}) {
  const parts = [];
  const lookback = humanDuration(nowMs - sinceMs);

  // The store watch's record. Its minutes past `nowMs` are not read, so a test can replay an hour against one file.
  let txn = null;
  let unread = null;
  if (txnRaw == null) unread = `there is no store watch record at ${path}${txnError ? ` (${String(txnError).slice(0, 80)})` : ""}`;
  else {
    try { txn = JSON.parse(txnRaw); } catch (e) { unread = `the store watch record at ${path} does not parse (${String(e?.message ?? e).slice(0, 80)})`; }
  }
  const minutes = [...(Array.isArray(txn?.minutes) ? txn.minutes : []), ...(txn?.last_minute ? [txn.last_minute] : [])]
    .filter((m) => Number.isFinite(Date.parse(m?.at ?? "")) && Date.parse(m.at) <= nowMs);
  const lastMs = minutes.length ? Math.max(...minutes.map((m) => Date.parse(m.at))) : null;
  if (!unread && lastMs == null) unread = `the store watch record at ${path} carries no minute it looked`;
  if (unread) {
    parts.push({ verdict: "STALE", tag: "watch-unread", text: `${unread}, so nothing is watching for sessions stuck in a transaction` });
  } else if (nowMs - lastMs > staleAfterMs) {
    parts.push({ verdict: "STALE", tag: "watch-stale", text: `the office's store watch last looked ${humanDuration(nowMs - lastMs)} ago, against a minute's cadence (stale after ${humanDuration(staleAfterMs)}): the office is down, is not pointed at the store, or its watch stopped` });
  } else {
    const recent = minutes.filter((m) => Date.parse(m.at) >= sinceMs);
    const seen = new Set();
    const once = recent.filter((m) => !seen.has(m.at) && seen.add(m.at));
    const stuck = once.filter((m) => m.looked === true && Number(m.stuck) > 0);
    const blind = once.filter((m) => m.looked === false);
    if (stuck.length) {
      const worst = stuck.reduce((w, m) => (Number(m.stuck) > Number(w.stuck) ? m : w));
      const s = Array.isArray(worst.stuck_sessions) ? worst.stuck_sessions[0] : null;
      const who = s ? `, pid ${s.pid} (${String(s.application_name ?? "no pool named").slice(0, 60)}) idle ${s.idle_s} s` : "";
      parts.push({ verdict: "WARN", tag: "stuck", text: `${plural(stuck.length, "minute")} in the last ${lookback} found a session idle inside a transaction for ${txn.stuck_after_s ?? 5} s or more, the most at ${hhmmssZ(Date.parse(worst.at))}: ${plural(Number(worst.stuck), "session")}${who}` });
    }
    if (blind.length) {
      parts.push({ verdict: "WARN", tag: "unasked", text: `${plural(blind.length, "minute")} in the last ${lookback} the store watch could not ask the store, the latest at ${hhmmssZ(Date.parse(blind.at(-1).at))}` });
    }
  }

  // The kills, and the 500s beside them.
  const detail = { last_minute_at: lastMs == null ? null : new Date(lastMs).toISOString(), kills: [], answered_500_beside: [] };
  if (kills == null) {
    parts.push({ verdict: "STALE", tag: "journal-unread", text: `the office's journal could not be read for Postgres's idle-in-transaction kills (${journalWhy ?? "no reason given"})` });
  } else if (kills.length) {
    const ks = [...kills].sort((a, b) => a - b);
    const beside = answered500 == null ? [] : [...new Set(answered500.filter((r) => ks.some((k) => Math.abs(r - k) <= windowMs)))].sort((a, b) => a - b);
    detail.kills = ks.map((k) => new Date(k).toISOString());
    detail.answered_500_beside = beside.map((r) => new Date(r).toISOString());
    const killed = `Postgres killed ${plural(ks.length, "office connection")} for idling in a transaction (${listSome(ks.map(hhmmssZ))})`;
    if (beside.length) {
      parts.push({ verdict: "DOWN", tag: "kill+500", text: `${killed} and the office answered a resident 500 beside it (${listSome(beside.map(hhmmssZ))}): POS-963's shape` });
    } else {
      const why = answered500 == null ? `, and the access log could not be read to say whether a 500 came of it (${String(accessError ?? "no reason given").slice(0, 120)})` : `, with no 500 within ${humanDuration(windowMs)} of it`;
      parts.push({ verdict: "WARN", tag: "kill", text: `${killed}${why}` });
    }
  }

  const verdict = worstOf(parts);
  if (verdict === "OK") {
    const last = minutes.find((m) => Date.parse(m.at) === lastMs);
    const sessions = last?.sessions && typeof last.sessions === "object"
      ? Object.entries(last.sessions).map(([k, n]) => `${n} ${k}`).join(", ") : "no session count";
    return { verdict, reason: `no session stuck in a transaction and no kill in the last ${lookback} (the watch looked at ${hhmmssZ(lastMs)}: ${sessions})`, finding: "ok", detail };
  }
  return { verdict, reason: sayParts(parts), finding: parts.map((p) => p.tag).sort().join(" "), detail };
}

// ── §15 the residents' 5xx ─────────────────────────────────────────────────
//
// The office_api door (§1) reads GET /api/, an in-memory manifest that never
// touches the store, so it stays green while a store-backed route fails. This
// counts what residents were actually answered, from the office's own log.
// THE LINE IS THE RULING'S: 5 or more 5xx on one route inside 10 minutes is
// DOWN. Fewer is named and not alarmed. POS-965 is the instance: GET
// /quests/<h> answered 503 70 times in the 18:00 hour on 11-08, and 11 inside
// ten minutes by 18:17Z, with nothing ringing.
//
// WHAT IT CANNOT SEE, named: a 502 or 504 nginx answers for an office that is
// down or slow never reaches the office's log (nginx's own log is adm's). The
// doors (§1) catch the office down; a slow one is not counted here.
export function classifyResident5xx({ rows = null, newestMs = null, readError = null, nowMs, sinceMs, windowMs = 10 * MINUTE, threshold = 5, dir = "the office's telemetry" } = {}) {
  const lookback = humanDuration(nowMs - sinceMs);
  if (rows == null) {
    return { verdict: "STALE", reason: `could not read the office's access log (${String(readError ?? "no reason given").slice(0, 160)}), so the 5xx residents were answered cannot be counted`, finding: "unread" };
  }
  if (newestMs == null) {
    return { verdict: "STALE", reason: `the office's access log in ${dir} has no line answered in the last ${lookback}: the office is not answering, or not writing its log, so its 5xx cannot be counted`, finding: "silent" };
  }
  const byRoute = new Map();
  for (const r of rows) {
    const route = routeOf(r.method, r.path);
    const g = byRoute.get(route) ?? { route, times: [], statuses: {} };
    g.times.push(r.at);
    g.statuses[r.status] = (g.statuses[r.status] ?? 0) + 1;
    byRoute.set(route, g);
  }
  const groups = [...byRoute.values()].map((g) => ({
    ...g, count: g.times.length, most: mostInWindow(g.times, windowMs), last: Math.max(...g.times),
    said: Object.entries(g.statuses).map(([s, n]) => `${s} ×${n}`).join(", "),
  })).sort((a, b) => b.most - a.most || b.count - a.count || a.route.localeCompare(b.route));
  const detail = {
    since: new Date(sinceMs).toISOString(), total_5xx: rows.length,
    routes: groups.map((g) => ({ route: g.route, count: g.count, most_in_window: g.most, statuses: g.statuses, last: new Date(g.last).toISOString() })),
  };
  const over = groups.filter((g) => g.most >= threshold);
  if (over.length) {
    return {
      verdict: "DOWN",
      reason: `the office answered residents ${threshold} or more 5xx on one route inside ${humanDuration(windowMs)}: ${listSome(over.map((g) => `${g.route} ${g.said} (${g.most} inside ${humanDuration(windowMs)}, the latest at ${hhmmssZ(g.last)})`))}`,
      finding: over.map((g) => `${g.route} ${Object.keys(g.statuses).sort().join("/")}`).sort().join("; "),
      detail,
    };
  }
  if (!rows.length) return { verdict: "OK", reason: `no 5xx answered in the last ${lookback}`, finding: "ok", detail };
  return {
    verdict: "OK",
    reason: `${plural(rows.length, "5xx answer")} in the last ${lookback}, none ${threshold} times on one route inside ${humanDuration(windowMs)}: ${listSome(groups.map((g) => `${g.route} ${g.said}`))}`,
    finding: "ok",
    detail,
  };
}

// ── §16 the certificates nginx serves ───────────────────────────────────────
//
// What is SERVED is what a browser meets, so it is read over TLS from nginx
// itself, not from /etc/letsencrypt (root's): on 11-08 panes had been renewed
// on disk while nginx still served the old one, because the webroot renewals
// have no deploy hook. One row per host, as §13 is one row per repo: alerts
// are per row, so one shared row would hide a second host failing behind the
// first. A certificate that does not name its host is DOWN whatever its date:
// that is nginx answering the name from a block that is not its own. A served
// certificate that cannot be read is STALE, never a guess.
//
// openssl, not node:tls, because `exec` is the seam every falsifier already
// drives; the PEM it prints is parsed here with node:crypto.
const PEM = /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/;

/** The certificate served for `host`: { host, notAfterMs, matches, names } or { host, error }. */
export function readServedCert(host, { exec = execFileSync, connect = "127.0.0.1:443", timeoutMs = 10_000 } = {}) {
  let out;
  try {
    out = String(exec("openssl", ["s_client", "-connect", connect, "-servername", host], {
      input: "", encoding: "utf8", timeout: timeoutMs, stdio: ["pipe", "pipe", "pipe"],
    }));
  } catch (e) {
    out = String(e?.stdout ?? "");
    if (!PEM.test(out)) return { host, error: (firstLine(e?.stderr) || firstLine(e?.message ?? e)).slice(0, 160) };
  }
  const pem = PEM.exec(out)?.[0];
  if (!pem) return { host, error: `the handshake with ${connect} for ${host} printed no certificate` };
  try {
    const c = new X509Certificate(pem);
    return { host, notAfterMs: Date.parse(c.validTo), matches: c.checkHost(host) !== undefined, names: c.subjectAltName ?? c.subject ?? null };
  } catch (e) {
    return { host, error: `the served certificate does not parse (${firstLine(e?.message ?? e).slice(0, 120)})` };
  }
}

export function classifyCert({ host, notAfterMs = null, matches = null, names = null, error = null, nowMs, warnDays = 21, downDays = 7, connect = "127.0.0.1:443" } = {}) {
  const DAY = 24 * HOUR;
  if (error) return { verdict: "STALE", reason: `could not read the certificate ${connect} serves for ${host}: ${error}`, finding: "unread" };
  if (matches === false) {
    return { verdict: "DOWN", reason: `${connect} serves ${host} a certificate that does not name it (it names ${String(names ?? "nothing readable").slice(0, 160)}), so a browser refuses it`, finding: "mismatch" };
  }
  if (!Number.isFinite(notAfterMs)) return { verdict: "STALE", reason: `the certificate ${connect} serves for ${host} carries no readable expiry`, finding: "unread" };
  const at = new Date(notAfterMs).toISOString();
  const left = notAfterMs - nowMs;
  const detail = { host, not_after: at, days_left: Math.floor((left / DAY) * 10) / 10 };
  if (left <= 0) return { verdict: "DOWN", reason: `the certificate served for ${host} expired ${humanDuration(-left)} ago (${at})`, finding: `expired ${at}`, detail };
  const days = `${(Math.floor((left / DAY) * 10) / 10).toFixed(1)} days`;
  if (left < downDays * DAY) return { verdict: "DOWN", reason: `the certificate served for ${host} expires in ${days} (${at}), under ${downDays} days`, finding: `under-${downDays} ${at}`, detail };
  if (left < warnDays * DAY) return { verdict: "WARN", reason: `the certificate served for ${host} expires in ${days} (${at}), under ${warnDays} days`, finding: `under-${warnDays} ${at}`, detail };
  return { verdict: "OK", reason: `valid to ${at} (${days})`, finding: "ok", detail };
}

// ── §17 the box's failed units ──────────────────────────────────────────────
//
// `systemctl list-units --failed` is readable by any user. The roll-call's
// manifest is the allowlist of units that matter, so one it names that failed
// is DOWN. One it does not name is still a failure nobody manifested (on 11-04
// starstory-sync failed 49 times and nobody saw), so it is a WARN: named, said
// once, never an outage. A transient unit systemd-run made by hand (run-u*) is
// counted in the reason and never alarmed: those are a person's one-off
// commands, and they stay failed until somebody resets them.
//
// NO UNIT'S NAME REACHES THE PUBLIC BOARD (Wright, #978 review, 11-09). The
// `reason` and `detail` the board prints carry only counts and the verdict.
// `said` names the units, and goes where only the operators read: the
// Discord post, the change log and state.json (tick routes it there). A change
// in the set of failed units re-barks (see rebarkOnChange): a standing WARN must
// not hide a second unit failing under it.
//
// The manifest is read as data here, not through tools/box-rollcall.mjs: this
// file is the one alarm route, and it must not fail to load because the
// roll-call or anything it imports did.
export const TRANSIENT_UNIT = /^run-(u\d+|r[0-9a-f]+|p\d+-i\d+)\.(service|scope)$/;

/** Every unit name the manifest's units[] rows mean: the row's own, the service a timer starts, and `triggers`. */
export function manifestUnitNames(manifest) {
  const names = new Map();
  for (const row of Array.isArray(manifest?.units) ? manifest.units : []) {
    if (typeof row?.unit !== "string") continue;
    const label = String(row.label ?? row.unit);
    for (const n of [row.unit, row.unit.replace(/\.timer$/, ".service"), row.triggers]) if (typeof n === "string" && n) names.set(n, label);
  }
  return names;
}

/** The failed units' names, from `--plain --no-legend` lines (one can lead with a "●"). */
export function parseFailedUnits(text) {
  return String(text ?? "").split("\n").map((l) => l.replace(/^[\s●*]+/, "").split(/\s+/)[0]).filter(Boolean);
}

export function classifyFailedUnits({ text = null, error = null, manifestNames = null, manifestError = null, manifestPath = "the roll-call manifest" } = {}) {
  if (text == null) return { verdict: "STALE", reason: `could not list the box's failed units (${String(error ?? "no reason given").slice(0, 160)})`, finding: "unread" };
  const failed = parseFailedUnits(text);
  const transient = failed.filter((u) => TRANSIENT_UNIT.test(u));
  const rest = failed.filter((u) => !TRANSIENT_UNIT.test(u)).sort();
  const counted = transient.length ? `; and ${plural(transient.length, "transient run-u* unit")} (counted, never alarmed)` : "";
  if (!rest.length) return { verdict: "OK", reason: `no unit has failed${counted}`, finding: "ok", detail: { failed: 0, transient: transient.length } };
  const units = plural(rest.length, "failed unit");
  if (manifestNames == null) {
    const why = `the roll-call manifest could not be read (${String(manifestError ?? "no reason given").slice(0, 120)}) to say which matter`;
    return {
      verdict: "STALE", reason: `${units}, and ${why}${counted}`,
      said: `${plural(rest.length, "unit")} failed, and ${manifestPath} could not be read (${String(manifestError ?? "no reason given").slice(0, 120)}) to say which matter: ${listSome(rest, 6)}${counted}`,
      finding: rest.join(" "), detail: { failed: rest.length, transient: transient.length },
    };
  }
  const named = rest.filter((u) => manifestNames.has(u));
  const other = rest.filter((u) => !manifestNames.has(u));
  const said = [];
  if (named.length) said.push(`${plural(named.length, "unit")} the roll-call manifest names failed: ${listSome(named.map((u) => `${u} (${manifestNames.get(u)})`), 6)}`);
  if (other.length) said.push(`${plural(other.length, "unit")} outside the manifest failed: ${listSome(other, 6)}`);
  return {
    verdict: named.length ? "DOWN" : "WARN",
    reason: `${units}, ${named.length ? named.length : "none"} the roll-call manifest names${counted}`,
    said: `${said.join("; ")}${counted}`,
    finding: `${named.join(" ")}|${other.join(" ")}`,
    detail: { failed: rest.length, in_manifest: named.length, transient: transient.length },
  };
}

// ── §18 the nightly backup's outcome ────────────────────────────────────────
//
// The roll-call reads this receipt's `at` only, so on 11-04 a dump over
// GitHub's 100 MB limit failed to ship and reached nobody. deploy/world2-
// backup.sh writes the receipt on every run: `shipped`, `shipped-no-basebackup`
// (the dump shipped off-box, the on-box base backup did not), or `failed` with
// its stage and detail. Not shipped is DOWN, and a failure outranks its age,
// as §7's does. A shipped receipt older than the roll-call's allowance is
// STALE: the lane stopped. A dump that shipped without its base backup is a
// WARN: the off-box copy is there, the on-box restore point is not. The
// failure's detail stays off the board (it is a tool's stderr); its stage is
// the reason.
export function classifyBackup({ raw = null, readError = null, nowMs, staleAfterMs = 1560 * MINUTE, path = "the backup receipt" } = {}) {
  if (raw == null) return { verdict: "STALE", reason: `there is no backup receipt at ${path}${readError ? ` (${String(readError).slice(0, 80)})` : ""}, so nothing says the store has an off-box copy`, finding: "unread" };
  let b;
  try { b = JSON.parse(raw); } catch (e) { return { verdict: "STALE", reason: `the backup receipt at ${path} does not parse (${String(e?.message ?? e).slice(0, 80)})`, finding: "unread" }; }
  const at = Date.parse(b?.at ?? "");
  if (!Number.isFinite(at)) return { verdict: "STALE", reason: `the backup receipt at ${path} carries no readable at, so it cannot say when the store was last copied off the box`, finding: "unread" };
  const age = nowMs - at;
  const stale = age > staleAfterMs;
  const status = typeof b.status === "string" ? b.status : null;
  const detail = { at: b.at, status, stage: b.stage ?? null, dump_bytes: Number.isFinite(b.dump_bytes) ? b.dump_bytes : null };
  const oldTail = stale ? `; and nothing has run since, ${humanDuration(age)} by its own at (allowance ${humanDuration(staleAfterMs)})` : "";
  if (status === "failed") {
    return { verdict: "DOWN", reason: `the nightly backup failed${b.stage ? ` at its ${b.stage} stage` : ""} (${b.at}): the store has no off-box copy of that night, and the receipt's detail and journalctl -u postmark-world2-backup say why${oldTail}`, finding: `failed ${b.stage ?? ""}`.trim(), detail };
  }
  if (status !== "shipped" && status !== "shipped-no-basebackup") {
    return { verdict: "DOWN", reason: `the nightly backup's receipt reads ${JSON.stringify(status)} (${b.at}), not shipped: read as not shipped rather than as healthy${oldTail}`, finding: `status ${status}`, detail };
  }
  if (stale) return { verdict: "STALE", reason: `the nightly backup last shipped ${humanDuration(age)} ago (${b.at}), past its ${humanDuration(staleAfterMs)} allowance: the lane has stopped`, finding: "stale", detail };
  const size = Number.isFinite(b.dump_bytes) ? `, a ${humanBytes(b.dump_bytes)} dump` : "";
  if (status === "shipped-no-basebackup") return { verdict: "WARN", reason: `the nightly backup shipped${size} off the box ${humanDuration(age)} ago, but its on-box base backup failed`, finding: "no-basebackup", detail };
  return { verdict: "OK", reason: `shipped${size} off the box ${humanDuration(age)} ago (${b.at})`, finding: "ok", detail };
}

// ── §19 the office tripped ──────────────────────────────────────────────────
//
// Added by Wright, 11-09 00:2xZ (POS-968, under STAR-163's rule): the first
// instance was 00:01:04Z and 00:01:21Z, `mcp household: the office tripped:
// error: cannot pull with rebase: You have unstaged changes`. A trip is the
// office's last resort: a resident's act or read failed with no refusal of its
// own. THE MCP DOOR WRAPS IT IN HTTP 200 (src/mcp.mjs, the answer), so §15's
// count of 5xx never sees it.
//
// THE THRESHOLDS. Any trip is a WARN: it is a bug a resident met, worth saying
// once, and a WARN is said once per episode, never as an outage. Five on one
// door inside ten minutes is DOWN: that is §15's ruled line for one route,
// held here for the door §15 cannot see, because a trip at the MCP door is a
// 500 in all but its status code. A REST door's trip is a 500 that §15 counts
// too; it is counted here as well, under its own name.
//
// The door is the words before ": the office tripped"; the error after it stays
// off the board (POS-568: it can be a SQL fragment or a path on the box).
export function tripDoor(message) {
  const m = String(message ?? "");
  const named = /^\[office\] (.+?): the office tripped\b/.exec(m);
  if (named) return named[1].slice(0, 80);
  const rest = /^\[office\] answered (\d{3}) \(the office tripped/.exec(m);
  if (rest) return `a REST door (answered ${rest[1]})`;
  return "a door the line does not name";
}

export function classifyOfficeTripped({ trips = null, journalWhy = null, nowMs, sinceMs, windowMs = 10 * MINUTE, threshold = 5 } = {}) {
  const lookback = humanDuration(nowMs - sinceMs);
  if (trips == null) return { verdict: "STALE", reason: `the office's journal could not be read for "the office tripped" (${journalWhy ?? "no reason given"})`, finding: "unread" };
  if (!trips.length) return { verdict: "OK", reason: `no door tripped in the last ${lookback}`, finding: "ok" };
  const byDoor = new Map();
  for (const t of trips) byDoor.set(t.door, [...(byDoor.get(t.door) ?? []), t.atMs]);
  const doors = [...byDoor.entries()].map(([door, times]) => ({ door, count: times.length, most: mostInWindow(times, windowMs), times: [...times].sort((a, b) => a - b) }))
    .sort((a, b) => b.most - a.most || b.count - a.count || a.door.localeCompare(b.door));
  const said = (d) => `${d.door} ×${d.count} (${listSome(d.times.map(hhmmssZ), 4)})`;
  const detail = { doors: doors.map((d) => ({ door: d.door, count: d.count, most_in_window: d.most, at: d.times.map((t) => new Date(t).toISOString()) })) };
  const over = doors.filter((d) => d.most >= threshold);
  if (over.length) {
    return { verdict: "DOWN", reason: `a door tripped ${threshold} or more times inside ${humanDuration(windowMs)}: ${listSome(over.map(said))}`, finding: `down ${over.map((d) => d.door).sort().join(", ")}`, detail };
  }
  return { verdict: "WARN", reason: `the office tripped ${plural(trips.length, "time")} in the last ${lookback}: ${listSome(doors.map(said))}`, finding: `warn ${doors.map((d) => d.door).sort().join(", ")}`, detail };
}

// ── §21 the acknowledgement a standing red may carry (POS-968, call 4) ──────
//
// THE RULING (the sitting's call 4, option (b), ruled as recommended): a
// standing red carries an acknowledgement with an issue link and an expiry
// within a week, so it cannot go stale, and any change re-barks. Until this a
// red that never cleared, the notary's or certbot's, said nothing new and
// trained the reader to stop reading.
//
// The operator writes /srv/postmark-sentinel/acks.json (beside state.json):
//     { "acks": [ { "probe": "failed_units", "issue": "STAR-151",
//                   "until": "2026-11-15T00:00:00Z" } ] }
// `issue` is a link or an issue's id; `until` is no more than 7 days out, and
// an ack that runs further is refused, not shortened. An ack that is refused,
// expired or unreadable says so in the board's notes and applies to nothing:
// the probe barks as if it were not there.
//
// WHAT IT DOES. The first tick that reads an ack binds it to the probe's
// finding as it stands (its verdict, and the probe's `finding` or, for a probe
// that names none, its reason with every number masked, so a clock in the
// sentence is not a change). While that finding holds, the probe reads on the
// board exactly as before, with the ack beside it, and says nothing: no
// onset, no reminder. ANY CHANGE IN THE FINDING RE-BARKS, and spends the ack:
// it covered the finding it was given, and a new one is new news. An ack that
// expires, or is taken out of the file, while its finding still stands barks
// once at once, so a standing red never goes quiet by an ack running out.
export const ACK_MAX_MS = 7 * 24 * HOUR;
const ISSUE_LINK = /^(https?:\/\/\S+|[A-Z][A-Z0-9]*-\d+)$/;

/** The acks that apply this tick: { live: Map(probe → { issue, until }), notes }. PURE. */
export function judgeAcks(raw, { nowMs, keys = null, error = null } = {}) {
  const live = new Map();
  const notes = [];
  if (error) { notes.push(`acks: ${error}; no acknowledgement applies until it reads`); return { live, notes }; }
  if (raw == null) return { live, notes };
  const rows = Array.isArray(raw) ? raw : Array.isArray(raw?.acks) ? raw.acks : null;
  if (!rows) { notes.push("acks: the file holds no `acks` list; no acknowledgement applies"); return { live, notes }; }
  rows.forEach((r, i) => {
    const who = `acks[${i}]${typeof r?.probe === "string" ? ` (${r.probe})` : ""}`;
    const untilMs = Date.parse(r?.until ?? "");
    if (typeof r?.probe !== "string" || !r.probe) return notes.push(`${who} names no probe; refused`);
    if (keys && !keys.has(r.probe)) return notes.push(`${who} names a probe the board does not carry; refused`);
    if (!ISSUE_LINK.test(String(r?.issue ?? ""))) return notes.push(`${who} carries no issue link or id; refused`);
    if (!Number.isFinite(untilMs)) return notes.push(`${who} has no readable until; refused`);
    if (untilMs <= nowMs) return notes.push(`${who} expired at ${r.until} and applies to nothing; take it out of the file`);
    if (untilMs - nowMs > ACK_MAX_MS) return notes.push(`${who} runs to ${r.until}, more than 7 days out; refused`);
    if (live.has(r.probe)) return notes.push(`${who} is a second ack for one probe; the first stands`);
    live.set(r.probe, { issue: String(r.issue), until: new Date(untilMs).toISOString() });
  });
  return { live, notes };
}

/** What an ack binds to: the verdict, and the probe's own finding or its reason with every number masked. */
export const findingOf = (p) => `${p.verdict}: ${p.finding ?? String(p.reason ?? "").replace(/\d+/g, "#")}`;

/**
 * Apply one probe's ack, if any, to what transition() decided. PURE. With no
 * ack and none held, it returns transition's answer untouched, so a probe
 * nobody acknowledged speaks exactly as it did before acks existed.
 */
export function applyAck({ prev = null, next, alert, state, ack = null, nowMs }) {
  const held = prev?.ack ?? null;
  const loud = (note) => (BAD.has(next.verdict) ? { kind: "onset", verdict: next.verdict, reason: next.reason, since: state.since, note }
    : next.verdict === "WARN" ? { kind: "warn", verdict: "WARN", reason: next.reason, since: state.since, note } : null);
  if (!ack) {
    if (held && !held.spent) {
      const note = `Its acknowledgement (${held.issue}) ended at ${held.until} and it still reads ${next.verdict}.`;
      const out = alert ? { ...alert, note } : loud(note);
      if (out && alert?.kind !== "recovered") return { alert: out, state: { ...state, last_alert_at: nowMs } };
    }
    return { alert, state };
  }
  const bound = held && held.issue === ack.issue && held.until === ack.until
    ? held : { issue: ack.issue, until: ack.until, finding: findingOf(next), spent: false };
  if (bound.spent) return { alert, state: { ...state, ack: bound } };
  if (bound.finding === findingOf(next)) return { alert: null, state: { ...state, ack: bound }, acked: true, suppressed: alert?.kind ?? null };
  const spent = { ...bound, spent: true };
  if (alert?.kind === "recovered") return { alert, state: { ...state, ack: spent } };
  const note = `Its acknowledgement (${bound.issue}) covered an earlier finding, so this one barks.`;
  if (alert) return { alert: { ...alert, note }, state: { ...state, ack: spent } };
  const fresh = loud(note);
  return { alert: fresh, state: { ...state, ack: spent, ...(fresh ? { last_alert_at: nowMs } : {}) } };
}

/**
 * ANY CHANGE IN WHAT IT NAMES RE-BARKS, for a probe that lists things (§17's
 * failed units; Wright, #978 review). transition() speaks on a change of
 * verdict and a WARN speaks once per episode, so a second unit failing under a
 * standing WARN said nothing: the 11-04 starstory-sync shape. This is call 4's
 * rule for acks ("any change re-barks"), held for the probe itself. PURE: the
 * finding rides in state.json (never the public board), and a change while it
 * is bad or a warning speaks once, naming what came and went. A probe with no
 * finding remembered yet (the first tick after an upgrade) says nothing new.
 */
const UNIT_NAME = /\.(service|timer|socket|mount|automount|scope|path|target|slice|swap|device)$/;
export function rebarkOnChange({ prev = null, next, alert, state, acked = false, nowMs }) {
  const out = { alert, state: { ...state, finding: next.finding } };
  const was = prev?.finding;
  if (alert || acked || was == null || was === next.finding) return out;
  if (!BAD.has(next.verdict) && next.verdict !== "WARN") return out;
  const units = (f) => new Set(String(f ?? "").split(/[|\s]+/).filter((u) => UNIT_NAME.test(u)));
  const before = units(was), now = units(next.finding);
  const came = [...now].filter((u) => !before.has(u)), went = [...before].filter((u) => !now.has(u));
  const what = [came.length ? `newly failed: ${came.join(", ")}` : "", went.length ? `no longer failed: ${went.join(", ")}` : ""].filter(Boolean).join("; ");
  const note = `What it names changed since it last spoke${what ? ` (${what})` : ""}.`;
  out.alert = BAD.has(next.verdict)
    ? { kind: "onset", verdict: next.verdict, reason: next.reason, since: state.since, note }
    : { kind: "warn", verdict: "WARN", reason: next.reason, since: state.since, note };
  out.state.last_alert_at = nowMs;
  return out;
}

// ── §20 the change log (POS-968, call 7) ────────────────────────────────────
//
// Until this the sentinel kept only its last verdict per probe; its history
// was the journal's, capped at 300 MB, so the sitting's packet could count its
// barks back only to 10-26 23:35Z. Every tick appends one line per probe whose
// verdict changed or that spoke (an alert, or one an ack held back) to
// history.jsonl beside state.json, and the run adds whether the post was
// delivered. It is kept a year: when the oldest line is past 366 days, or the
// file past HISTORY_MAX_BYTES, the next append rewrites it with the year's
// newest lines inside half the cap, so it is bounded both ways.
export const HISTORY_KEEP_MS = 366 * 24 * HOUR;
export const HISTORY_MAX_BYTES = 64 * 2 ** 20;

export function appendHistory(path, entries, { nowMs = Date.now(), keepMs = HISTORY_KEEP_MS, maxBytes = HISTORY_MAX_BYTES } = {}) {
  if (!entries?.length) return { appended: 0, pruned: false };
  mkdirSync(dirname(path), { recursive: true });
  const add = entries.map((e) => JSON.stringify(e)).join("\n") + "\n";
  let size = 0, head = "";
  try {
    size = statSync(path).size;
    const fd = openSync(path, "r");
    try { const buf = Buffer.alloc(Math.min(size, 4096)); readSync(fd, buf, 0, buf.length, 0); head = buf.toString("utf8"); } finally { closeSync(fd); }
  } catch { size = 0; }
  const atOf = (line) => { try { return Date.parse(JSON.parse(line)?.at ?? ""); } catch { return NaN; } };
  const firstAt = head ? atOf(head.split("\n")[0]) : NaN;
  const cutoff = nowMs - keepMs;
  if (!size || ((!Number.isFinite(firstAt) || firstAt >= cutoff) && size + add.length <= maxBytes)) {
    appendFileSync(path, add);
    return { appended: entries.length, pruned: false };
  }
  const kept = String(readFileSync(path, "utf8")).split("\n").filter((l) => l && atOf(l) >= cutoff);
  let bytes = kept.reduce((n, l) => n + l.length + 1, 0);
  while (kept.length && bytes + add.length > maxBytes / 2) bytes -= kept.shift().length + 1;
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, (kept.length ? `${kept.join("\n")}\n` : "") + add);
  renameSync(tmp, path);
  return { appended: entries.length, pruned: true };
}

// What alarms, reminds and recovers. WARN is deliberately not in it (POS-838): a
// warning is not an outage, and every alert BAD makes is shaped like one. A WARN
// has its own, quieter post in transition: once, with no reminder and no recovery.
export const BAD = new Set(["DOWN", "STALE"]);

/**
 * Decide what to SAY, given what was true last tick and what is true now.
 *
 * The whole point is that a bad state speaks once when it arrives, again only
 * on the long reminder, and once more when it clears. A per-tick ping is not
 * "loud" — it is wallpaper, and the reader stops seeing it, which reproduces
 * the silence this file was built to end.
 *
 * Four edges fire, and one deliberately does not:
 *   - never-seen -> bad ........ fires. A sentinel that boots into an outage
 *                                and says nothing has failed at its only job.
 *   - good -> bad .............. fires.
 *   - bad -> a DIFFERENT bad ... fires. DOWN becoming STALE is new information
 *                                about what is wrong; suppressing it would hide
 *                                a change of failure behind a sameness of mood.
 *   - bad -> OK ................ fires, as a recovery.
 *   - bad -> the SAME bad ...... silent until reminderMs has passed.
 * INFO and UNKNOWN never alert: an info-only door and an unreadable reference
 * are not site outages, and alarming on them teaches the reader to ignore the
 * channel.
 *
 * A WARN (POS-838) is a notice, not an alarm. It is not in BAD, so none of the
 * edges above fire for it, and it speaks once per episode, however long it lasts:
 *   - anything else -> WARN .... fires "warn": the episode's one post.
 *   - DOWN or STALE -> WARN .... fires "eased": one closing line for the outage
 *                                that has ended, which is also the WARN
 *                                episode's one post.
 *   - WARN -> WARN ............. silent. No reminder, ever.
 *   - WARN -> OK ............... silent. A notice clears quietly, and a DOWN that
 *                                eased into it was already closed by its line.
 * WARN -> bad is the ordinary onset of that bad.
 */
export function transition({ prev = null, next, nowMs, reminderMs = CONFIG.reminderMs }) {
  const alertable = BAD.has(next.verdict);
  const wasBad = prev != null && BAD.has(prev.verdict);
  const isWarn = next.verdict === "WARN";
  const wasWarn = prev != null && prev.verdict === "WARN";
  // A clock survives only inside one episode: the same bad, or the same WARN.
  const since = (wasBad && prev.verdict === next.verdict) || (wasWarn && isWarn) ? prev.since : nowMs;

  let alert = null;
  if (alertable) {
    if (!wasBad) alert = { kind: "onset", verdict: next.verdict, reason: next.reason, since };
    else if (prev.verdict !== next.verdict) alert = { kind: "changed", verdict: next.verdict, reason: next.reason, since, from: prev.verdict };
    else if (nowMs - (prev.last_alert_at ?? 0) >= reminderMs) alert = { kind: "reminder", verdict: next.verdict, reason: next.reason, since };
  } else if (isWarn) {
    if (wasBad) alert = { kind: "eased", verdict: "WARN", reason: next.reason, since, from: prev.verdict, downFor: nowMs - prev.since };
    else if (!wasWarn) alert = { kind: "warn", verdict: "WARN", reason: next.reason, since };
  } else if (wasBad && next.verdict === "OK") {
    alert = { kind: "recovered", verdict: "OK", reason: next.reason, since: prev.since, downFor: nowMs - prev.since };
  }

  const state = {
    verdict: next.verdict,
    reason: next.reason,
    since,
    last_alert_at: alert ? nowMs : (((alertable && wasBad) || (isWarn && wasWarn)) ? prev.last_alert_at ?? null : null),
  };
  return { alert, state };
}

// ── the message ─────────────────────────────────────────────────────────────

/**
 * Plain prose. No markdown tables — Discord renders them as garbage, so a table
 * here would make the loudest message the least readable one.
 */
export function composeMessage({ alerts, board, nowIso }) {
  if (!alerts.length) return null;
  // A notice (a WARN's one post, or the closing line of an outage that eased into
  // one) is not an alarm, so it has its own header and its own words, and nothing
  // in it says DOWN (POS-838).
  const isNotice = (a) => a.alert.kind === "warn" || a.alert.kind === "eased";
  const notices = alerts.filter(isNotice);
  const bad = alerts.filter((a) => a.alert.kind !== "recovered" && !isNotice(a));
  const back = alerts.filter((a) => a.alert.kind === "recovered");

  const lines = [];
  const trouble = bad.length || notices.length;
  if (trouble && back.length) lines.push(`**📮 Postmark sentinel** — ${trouble} ${bad.length ? "problem" : "warning"}${trouble > 1 ? "s" : ""} and ${back.length} recovery${back.length > 1 ? "ies" : ""}, as of ${nowIso}.`);
  else if (bad.length) lines.push(`**📮 Postmark sentinel** — ${bad.length === 1 ? "something is" : `${bad.length} things are`} wrong on the site, as of ${nowIso}.`);
  else if (notices.length) lines.push(`**📮 Postmark sentinel** — ${notices.length === 1 ? "a warning" : `${notices.length} warnings`}, as of ${nowIso}.`);
  else lines.push(`**📮 Postmark sentinel** — recovered, as of ${nowIso}.`);
  lines.push("");

  // An alert an acknowledgement (§21) or a changed finding (rebarkOnChange)
  // shaped says so at its end; every other line is unchanged.
  const acked = (alert) => (alert.note ? ` ${alert.note}` : "");
  for (const { label, alert } of bad) {
    const tail = alert.kind === "reminder" ? ` Still bad after ${humanDuration(Date.parse(nowIso) - alert.since)}; this is the twelve-hourly reminder.`
      : alert.kind === "changed" ? ` (it was ${alert.from} before this)`
      : "";
    lines.push(`${alert.verdict} — ${label}: ${alert.reason}.${tail}${acked(alert)}`);
  }
  for (const { label, alert } of notices) {
    lines.push((alert.kind === "eased"
      ? `${label}: no longer ${String(alert.from).toLowerCase()} after ${humanDuration(alert.downFor)}, still a warning: ${alert.reason}.`
      : `${label}: warning: ${alert.reason}.`) + acked(alert));
  }
  for (const { label, alert } of back) {
    lines.push(`RECOVERED — ${label} is healthy again after ${humanDuration(alert.downFor)}: ${alert.reason}.`);
  }

  lines.push("");
  lines.push(`${board.summary} The full board is ${board.published_at ?? "on the box at /srv/postmark-sentinel/status.json"}.`);
  return lines.join("\n");
}

// ── the board ───────────────────────────────────────────────────────────────

export function composeBoard({ probes, nowIso, alerting }) {
  const counts = { OK: 0, DOWN: 0, STALE: 0, INFO: 0, UNKNOWN: 0, WARN: 0 };
  for (const p of probes) counts[p.verdict] = (counts[p.verdict] ?? 0) + 1;
  // A WARN degrades the board, as an unread probe does, and never takes it to DOWN
  // (POS-838): it ranks below DOWN and STALE, and above OK.
  const worst = counts.DOWN ? "DOWN" : counts.STALE ? "STALE" : (counts.UNKNOWN || counts.WARN) ? "DEGRADED" : "OK";
  // A PARKED PROBE IS COUNTED, NEVER ALARMED, AND NEVER SILENT. INFO is the
  // right verdict for a Stage-B watcher nobody has adopted and for dev's
  // healthy Access redirect — neither is a failure, and alarming on them trains
  // the reader to mute the channel. But `All ${counts.OK} probes green` counted
  // only the OK ones while the word "All" claimed the whole board, so a rail
  // that was built, shipped inert and then forgotten read as a clean tick
  // forever. That is the exact failure the Stage-A/Stage-B split exists to make
  // impossible, and the board was quietly underwriting it.
  const parked = counts.INFO ? ` ${counts.INFO} parked (see the board).` : "";
  // A WARN is named in the line that gets read, whatever else is on the board
  // (POS-838): a count the sentence leaves out is a warning the reader never sees.
  // With no WARN, both sentences below are byte-for-byte what they were.
  const warned = counts.WARN ? `${counts.WARN} warning${counts.WARN === 1 ? "" : "s"}` : "";
  const unread = counts.UNKNOWN ? `${counts.UNKNOWN} could not be read` : "";
  const summary =
    worst === "OK" ? (counts.INFO ? `${counts.OK} green.${parked}` : `All ${counts.OK} probes green.`)
      : worst === "DEGRADED" ? `${[`${counts.OK} green`, warned, unread].filter(Boolean).join(", ")}.${parked}`
        : `${counts.DOWN} down, ${counts.STALE} stale, ${warned ? `${warned}, ` : ""}${counts.OK} green.${parked}`;
  return {
    schema: 1,
    generated_at: nowIso,
    status: worst,
    summary,
    // The one line the operator round reads. Kept as its own field so a reader
    // never has to reduce the array themselves and get a different answer.
    headline: `${worst} · ${summary} (${nowIso})`,
    alerting,
    counts,
    probes,
  };
}

// ── adapters (every one injectable, so the whole tick is testable offline) ──

export async function probeUrl(url, { fetchImpl = fetch, timeoutMs = CONFIG.requestTimeoutMs, method = "GET" } = {}) {
  try {
    const res = await fetchImpl(url, {
      method,
      redirect: "manual",
      headers: { "user-agent": CONFIG.userAgent },
      signal: AbortSignal.timeout(timeoutMs),
    });
    return { status: res.status, location: res.headers?.get?.("location") ?? null, headers: res.headers, res };
  } catch (e) {
    return { error: e?.message ?? String(e) };
  }
}

/**
 * A ref's SHA over the git wire protocol.
 *
 * `git ls-remote` and not the REST API on purpose — see the header's budget
 * note. It also means the reference for "is the site current" never depends on
 * the box's own clone, which matters: a clone the box failed to pull is exactly
 * the condition being tested for, and using it as the reference would compare
 * a stale answer against itself and call them equal.
 */
export function lsRemote(repoUrl, ref, { exec = execFileSync } = {}) {
  try {
    const out = String(exec("git", ["ls-remote", repoUrl, ref], { encoding: "utf8", timeout: CONFIG.requestTimeoutMs }));
    const line = out.split("\n").find((l) => l.trim());
    return line ? line.split(/\s+/)[0] : null;
  } catch { return null; }
}

/** The newest release/* tag's name, by version-ish sort over the tag list. */
export function newestReleaseTag(repoUrl, { exec = execFileSync } = {}) {
  try {
    // NO --refs, on purpose (2026-08-26). An ANNOTATED tag lists twice on the
    // wire: `refs/tags/X` (the tag OBJECT's sha) and `refs/tags/X^{}` (the
    // peeled COMMIT the deploy actually checks out). `--refs` strips the
    // peeled lines, so this probe compared the deployed build against the tag
    // object and called a perfectly current site STALE for 9 hours. The
    // peeled sha wins whenever it exists; a lightweight tag has no ^{} line
    // and its ref sha IS the commit, unchanged.
    const out = String(exec("git", ["ls-remote", "--tags", repoUrl, "release/*"], { encoding: "utf8", timeout: CONFIG.requestTimeoutMs }));
    const byTag = new Map();
    for (const l of out.split("\n").filter(Boolean)) {
      const [sha, ref] = l.split(/\s+/);
      const peeled = /\^\{\}$/.test(ref);
      const tag = String(ref).replace("refs/tags/", "").replace(/\^\{\}$/, "");
      const row = byTag.get(tag) ?? { tag, sha: null };
      if (peeled || row.sha === null) row.sha = sha;
      byTag.set(tag, row);
    }
    const rows = [...byTag.values()];
    if (!rows.length) return null;
    rows.sort((a, b) => a.tag.localeCompare(b.tag, undefined, { numeric: true }));
    return rows[rows.length - 1];
  } catch { return null; }
}

/**
 * The newest `settlement/S<n>` blessing on the world, PEELED: { n, tag, sha }.
 *
 * Newest by NUMBER (S102 beats S99; as text S10 sorts before S9 — the same
 * reason deploy/world2-refresh-clone.sh sorts with `sort -n`). Peeled for the
 * annotated-tag reason newestReleaseTag gives: the keeper's tags are annotated,
 * the wire lists the tag object AND `^{}`, and only the peeled line is the
 * commit a sweep's world_to can be compared to. Null when git cannot list them
 * or there are none — unread either way, which §11 reads as UNKNOWN.
 */
export function newestSettlementTag(repoUrl, { exec = execFileSync, onError = () => {} } = {}) {
  try {
    const out = String(exec("git", ["ls-remote", "--tags", repoUrl, "refs/tags/settlement/S*"], { encoding: "utf8", timeout: CONFIG.requestTimeoutMs }));
    const byN = new Map();
    for (const l of out.split("\n").filter(Boolean)) {
      const [sha, ref] = l.split(/\s+/);
      const m = /^refs\/tags\/settlement\/S(\d+)(\^\{\})?$/.exec(String(ref));
      if (!m) continue;
      const n = Number(m[1]);
      const row = byN.get(n) ?? { n, tag: `settlement/S${n}`, sha: null };
      if (m[2] || row.sha === null) row.sha = sha;
      byN.set(n, row);
    }
    if (!byN.size) { onError("the world lists no settlement/S<n> tag"); return null; }
    return byN.get(Math.max(...byN.keys()));
  } catch (e) { onError(`git ls-remote failed: ${firstLine(e?.message ?? e)}`); return null; }
}

export async function ghJson(path, { fetchImpl = fetch, token = null } = {}) {
  const headers = {
    accept: "application/vnd.github+json",
    "user-agent": CONFIG.userAgent,
    "x-github-api-version": "2022-11-28",
  };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetchImpl(`https://api.github.com${path}`, { headers, signal: AbortSignal.timeout(CONFIG.requestTimeoutMs) });
  // The status rides on the error: §13 reads a 404 as an answer, not a failure.
  if (!res.ok) throw Object.assign(new Error(`GET ${path} -> HTTP ${res.status}`), { status: res.status });
  return res.json();
}

/**
 * A post that fits Discord's limit and still says how many alerts it left out
 * (Wright, #978 review): the lines composeMessage writes are kept whole from
 * the top until the next one would not fit, and the post ends "…and N more".
 * The board and the journal (run's errLog on a refused post) carry every one.
 */
export const DISCORD_MAX = 1900;
export function fitMessage(content, max = DISCORD_MAX) {
  const text = String(content ?? "");
  if (text.length <= max) return text;
  const lines = text.split("\n");
  // composeMessage's shape: the header, a blank, one line per alert, a blank, the board's sentence.
  const head = lines.slice(0, 2), body = lines.slice(2, -2), foot = lines.slice(-2);
  for (let keep = body.length - 1; keep >= 0; keep--) {
    const more = `…and ${body.length - keep} more not shown here; the board has every one.`;
    const out = [...head, ...body.slice(0, keep), ...foot, more].join("\n");
    if (out.length <= max) return out;
  }
  const more = `\n…and ${Math.max(body.length, 1)} more not shown here; the board has every one.`;
  return text.slice(0, max - more.length) + more;
}

export async function postDiscord(webhook, content, { fetchImpl = fetch } = {}) {
  const res = await fetchImpl(webhook, {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": CONFIG.userAgent },
    body: JSON.stringify({ content: fitMessage(content), allowed_mentions: { parse: [] } }),
    signal: AbortSignal.timeout(CONFIG.requestTimeoutMs),
  });
  if (!res.ok) throw new Error(`webhook -> HTTP ${res.status}`);
  return true;
}

// ── one tick ────────────────────────────────────────────────────────────────

/**
 * Read everything, classify everything, decide what to say. Persists NOTHING —
 * the caller owns the filesystem and the webhook, so a falsifier can run a
 * whole tick, inspect the alerts it WOULD have sent, and prove the state it
 * would have written, without a box or a network.
 */
export async function tick({
  fetchImpl = fetch,
  exec = execFileSync,
  state = {},
  nowMs = Date.now(),
  config = CONFIG,
  token = null,
  readClone = readCloneState,
  readDisk = readDiskState,
  acks = null,
  acksError = null,
} = {}) {
  const nowIso = new Date(nowMs).toISOString();
  const probes = [];
  const stamps = { ...(state.stamps ?? {}) };
  const notes = [];

  // §1 — the doors, all at once. The API's response is kept: probe 3 reads its
  // as-of header rather than opening the door a second time.
  const doorResults = await Promise.all(config.doors.map((d) => probeUrl(d.url, { fetchImpl })));
  let servedAsOf = null;
  let officeApiRes = null;
  config.doors.forEach((d, i) => {
    const r = doorResults[i];
    const { verdict, reason } = classifyUp(r);
    probes.push({ key: d.key, label: d.label, kind: "up", verdict, reason, url: d.url });
    if (d.key === "office_api") {
      servedAsOf = r.headers?.get?.("x-postmark-as-of") ?? null;
      officeApiRes = r.res ?? null;
    }
  });

  // The crossing rides the manifest we ALREADY opened for §1 and §3 — the same
  // response object, read for its body this time, so the event-shaped probe
  // below costs the watch not one extra request. An office that answers without
  // a crossing field (an older office) leaves this null, and classifyCrossing
  // reads null as UNKNOWN, never as green.
  let officeCrossing = null;
  try {
    const manifest = officeApiRes ? await officeApiRes.json() : null;
    if (Number.isInteger(manifest?.crossing?.number)) officeCrossing = manifest.crossing.number;
  } catch { /* a body that will not parse is an unread crossing, not a site outage */ }

  const devR = await probeUrl(config.devDoor.url, { fetchImpl });
  {
    const { verdict, reason } = classifyUp({ ...devR, infoOnly: true });
    probes.push({ key: config.devDoor.key, label: config.devDoor.label, kind: "up", verdict, reason, url: config.devDoor.url });
  }

  // §2 — the site's two shas, each against its own reference.
  const siteUrl = `https://github.com/${config.siteRepo.owner}/${config.siteRepo.name}.git`;
  const townUrl = `https://github.com/${config.townRepo.owner}/${config.townRepo.name}.git`;
  const stamp = await readJson(config.buildStamp, { fetchImpl });
  const siteMainTip = lsRemote(siteUrl, "main", { exec });
  const releaseTag = newestReleaseTag(siteUrl, { exec });

  // §2b — THE CROSSING, and it is deliberately outside the `if (!stamp)` branch
  // below: an absent stamp is exactly the condition this probe must still speak
  // about, and classifyCrossing's own UNKNOWN says why in words a reader can act
  // on, rather than being folded into a generic "no /build.json".
  const cr = classifyCrossing({
    haveStamp: Boolean(stamp),
    servedCrossing: Number.isInteger(stamp?.crossing) ? stamp.crossing : null,
    officeCrossing, nowMs, graceMs: config.crossingGrace,
  });
  probes.push({ key: "site_crossing", label: "the crossing the site is showing", kind: "fresh", verdict: cr.verdict, reason: cr.reason });

  // §2c — WHAT THE BUILD THAT PUBLISHED THIS SITE COULD NOT GET. Outside the
  // `if (!stamp)` branch for the same reason §2b is: an absent stamp is a
  // condition this probe must speak about in its own words, not one it should
  // vanish into. `stamp.problems` is `undefined` when the key is absent (an
  // older stamper) and `null` when a POS-180 stamper could not read its own
  // manifest, and those are two different sentences — see classifyProblems.
  const pr = classifyProblems({ haveStamp: Boolean(stamp), problems: stamp ? stamp.problems : undefined });
  probes.push({ key: "site_build_problems", label: "what the site's build could not get", kind: "fresh", verdict: pr.verdict, reason: pr.reason });

  if (!stamp) {
    notes.push(`no build stamp at ${config.buildStamp} — the site's own freshness cannot be read until the site repo emits one (see tools/build-stamp.mjs in postmark-site)`);
    probes.push({ key: "site_code", label: "the deployed site code", kind: "fresh", verdict: "UNKNOWN", reason: `no /build.json on the deployed site` });
    probes.push({ key: "site_town_data", label: "the deployed town data", kind: "fresh", verdict: "UNKNOWN", reason: `no /build.json on the deployed site` });
  } else {
    // Prod rides the release tag; comparing its code against MAIN would alarm
    // forever, because lagging main is the design (deploy.yml's release lane).
    const codeRef = stamp.channel === "release" ? (releaseTag?.sha ?? null) : siteMainTip;
    const codeRefName = stamp.channel === "release" ? `the newest release tag (${releaseTag?.tag ?? "none cut yet"})` : "site main's tip";
    const c = classifyStamp({
      served: stamp.code_sha ?? null, reference: codeRef, seen: stamps.site_code, nowMs,
      staleAfterMs: config.staleAfter.site_code, what: "the deployed site code", referenceName: codeRefName,
    });
    stamps.site_code = c.seen; probes.push({ key: "site_code", label: "the deployed site code", kind: "fresh", verdict: c.verdict, reason: c.reason });

    // The half that froze on 2026-08-24 while the code was correctly pinned.
    //
    // KEPT AS THE FLOOR, not replaced by §2b. Once the box timer owns prod's
    // content and sync-atlas.yml's schedule is retired, site main stops moving
    // every half hour — so this comparison spends most of its life served ===
    // reference, which the file's own staleness-clock note already covers: "a
    // quiet repo never alarms, because when nothing is pushed the served value
    // equals the reference and the comparison never opens." It stays because it
    // is the probe that still speaks when the crossing probe cannot: no office,
    // no crossing field, an old stamper. Three hours of wall clock under an
    // event-shaped hour.
    const t = classifyStamp({
      served: stamp.town_data_sha ?? null, reference: siteMainTip, seen: stamps.site_town_data, nowMs,
      staleAfterMs: config.staleAfter.site_town_data, what: "the deployed town data", referenceName: "site main's tip",
    });
    stamps.site_town_data = t.seen; probes.push({ key: "site_town_data", label: "the deployed town data", kind: "fresh", verdict: t.verdict, reason: t.reason });
  }

  // §3 — the office index against the town's own tip.
  const townTip = lsRemote(townUrl, "main", { exec });
  const a = classifyStamp({
    served: servedAsOf, reference: townTip, seen: stamps.office_as_of, nowMs,
    staleAfterMs: config.staleAfter.office_as_of, what: "the office's served index (X-Postmark-As-Of)", referenceName: "the town repo's main tip",
  });
  stamps.office_as_of = a.seen;
  probes.push({ key: "office_as_of", label: "the office's read index", kind: "fresh", verdict: a.verdict, reason: a.reason });

  // §4 — the daily, as an outcome. REST call 1 of 2 (the source's commit date).
  const sourceMd = await readText(config.dailySource, { fetchImpl });
  const servedDaily = await readText(config.dailyServed, { fetchImpl });
  let dailyCommittedAt = null;
  try {
    const commits = await ghJson(`/repos/${config.townRepo.owner}/${config.townRepo.name}/commits?path=${encodeURIComponent(config.dailyPath)}&per_page=1`, { fetchImpl, token });
    dailyCommittedAt = Date.parse(commits?.[0]?.commit?.committer?.date ?? "") || null;
  } catch (e) { notes.push(`daily commit date unread: ${e.message}`); }
  const d = classifyDaily({
    fingerprint: sourceMd ? dailyFingerprint(sourceMd) : null,
    servedHtml: servedDaily, sourceCommittedAtMs: dailyCommittedAt, nowMs, slackMs: config.dailySlack,
  });
  probes.push({ key: "site_daily_content", label: "Ferry's Daily on the site", kind: "fresh", verdict: d.verdict, reason: d.reason });

  // §5 — the workflows: one read PER WATCHED WORKFLOW, by its file.
  //
  // FIXED 2026-09-29 (a false DOWN). This used to be ONE read of the 50 newest
  // runs on main across every workflow, unauthenticated. Two things broke it:
  // the busy workflows pushed a quiet one off the page, and GitHub answered that
  // anonymous, branch-filtered, mixed list from a stale view (measured: its
  // newest row was 2026-08-07), so the sentinel reported the atlas sync's
  // 2026-08-06 failure as today's. A per-workflow read answers each workflow's
  // own newest runs, and it is correct without a token (measured the same day).
  // And "Sync Postmark atlas" is no longer watched: its schedule was retired
  // when the box took over publishing, so it runs only by hand.
  try {
    const runs = [];
    for (const w of WATCHED_WORKFLOWS) {
      const page = await ghJson(`/repos/${config.siteRepo.owner}/${config.siteRepo.name}/actions/workflows/${w.file}/runs?branch=main&per_page=10`, { fetchImpl, token });
      runs.push(...(page?.workflow_runs ?? []));
    }
    for (const row of classifyWorkflows(latestDecisiveRunPerWorkflow(runs), { watch: WATCHED_WORKFLOWS.map((w) => w.name) })) {
      probes.push({ ...row, label: `the "${row.workflow}" workflow`, kind: "workflow" });
    }
  } catch (e) {
    notes.push(`workflow conclusions unread: ${e.message}`);
    probes.push({ key: "workflow_read", label: "the site's workflow conclusions", kind: "workflow", verdict: "UNKNOWN", reason: `GitHub did not answer: ${e.message}` });
  }

  // §6 — the watchers themselves. Local stat, no network, no budget.
  for (const w of config.watchers ?? []) {
    const adopted = w.adoptedWhen ? existsSync(w.adoptedWhen) : true;
    const exists = adopted && existsSync(w.state);
    const mtimeMs = exists ? statSync(w.state).mtimeMs : null;
    const { verdict, reason } = classifyWatcher({ adopted, exists, mtimeMs, nowMs, cadenceMs: w.cadenceMs, label: w.label });
    probes.push({ key: w.key, label: w.label, kind: "watcher", verdict, reason });
  }

  // §7 — the box's own publisher. A local read, no network, no keyless budget:
  // the report sits on the same disk this process runs on.
  const sr = config.siteRefresh;
  if (sr) {
    const exists = existsSync(sr.report);
    let report = null;
    let readError = null;
    let atMs = null;
    let mtimeMs = null;
    if (exists) {
      mtimeMs = statSync(sr.report).mtimeMs;
      try {
        report = JSON.parse(readFileSync(sr.report, "utf8"));
      } catch (e) {
        readError = e.message;
      }
      const parsed = Date.parse(report?.at ?? "");
      atMs = Number.isFinite(parsed) ? parsed : null;
    }
    const r = classifySiteRefresh({ exists, report, readError, atMs, mtimeMs, nowMs, cadenceMs: sr.cadenceMs, label: sr.label });
    // `detail` rides onto the board so the site's header popover can say "48
    // doors are missing" rather than only "failed" — postmark-site#97 reads it.
    probes.push({ key: sr.key, label: sr.label, kind: "refresh", verdict: r.verdict, reason: r.reason, ...(r.detail ? { detail: r.detail } : {}) });
  }

  // §8 — the clones the office writes through. A local read of the working
  // tree; the reference is the town tip §3 already read over ls-remote, so
  // this costs no request and never fetches into the clone it is judging.
  for (const c of config.clones ?? []) {
    const cs = classifyClone({
      state: readClone(c.path, { remoteTip: townTip }),
      seen: stamps[c.key] ?? null, nowMs,
      dirtyGraceMs: config.cloneDirtyGraceMs, behindAfterMs: config.cloneBehindAfterMs, label: c.label,
    });
    if (cs.seen) stamps[c.key] = cs.seen;
    probes.push({ key: c.key, label: c.label, kind: "clone", verdict: cs.verdict, reason: cs.reason, ...(cs.detail ? { detail: cs.detail } : {}) });
  }

  // §9 — the ground. A local statfs, no network, no budget.
  if (config.disk) {
    const dk = classifyDisk({ ...readDisk(config.disk.path), limitPct: config.disk.limitPct });
    probes.push({ key: config.disk.key, label: config.disk.label, kind: "disk", verdict: dk.verdict, reason: dk.reason, ...(dk.detail ? { detail: dk.detail } : {}) });
  }

  // §10 — the meeps. A local read of the record the desktop watcher lands.
  if (config.meeps) {
    let raw = null, readError = null;
    try { raw = readFileSync(config.meeps.path, "utf8"); } catch (e) { readError = e?.code ?? e?.message ?? String(e); }
    const mp = classifyMeeps({ raw, readError, nowMs, staleAfterMs: config.meeps.staleAfterMs, path: config.meeps.path });
    probes.push({ key: config.meeps.key, label: config.meeps.label, kind: "meeps", verdict: mp.verdict, reason: mp.reason, ...(mp.detail ? { detail: mp.detail } : {}) });
  }

  // §12 — the law pen. A local read of the state its unit writes.
  if (config.lawPen) {
    let raw = null, readError = null;
    try { raw = readFileSync(config.lawPen.path, "utf8"); } catch (e) { readError = e?.code ?? e?.message ?? String(e); }
    const lp = classifyLawPen({ raw, readError, nowMs, staleAfterMs: config.lawPen.staleAfterMs, path: config.lawPen.path });
    probes.push({ key: config.lawPen.key, label: config.lawPen.label, kind: "law_pen", verdict: lp.verdict, reason: lp.reason, ...(lp.detail ? { detail: lp.detail } : {}) });
  }

  // §11 — the settlement. A local read of the sweep's receipt, the world's tags
  // over ls-remote (no REST budget), and AT MOST ONE compare call per new
  // (world, tag) pair: whether a commit descends from another never changes,
  // so the answer is remembered in `stamps.settlement` and a held sweep costs
  // one REST call, not one per tick. No call at all when the tag IS the world,
  // or when the sweep did not end clean (its verdict does not need the answer).
  if (config.settlement) {
    const st = config.settlement;
    let receipt = null, readError = null, writtenAtMs = null;
    try {
      receipt = JSON.parse(readFileSync(st.receipt, "utf8"));
      writtenAtMs = statSync(st.receipt).mtimeMs;
    } catch (e) { readError = e?.code ?? e?.message ?? String(e); }
    const worldUrl = `https://github.com/${st.worldRepo.owner}/${st.worldRepo.name}.git`;
    let tagError = null, coverError = null;
    const newestTag = newestSettlementTag(worldUrl, { exec, onError: (m) => { tagError = m; } });
    const world = receipt?.world_to || receipt?.world_from || null;
    let covered = null, held = null;
    if (world && newestTag?.sha && SETTLEMENT_CLEAN.has(receipt?.status)) {
      // The two clean statuses ask two different questions (see §11's header),
      // so the memory carries which one it answered.
      const mode = receipt.status === "quiet" ? "quiet" : "published";
      const memo = stamps.settlement;
      if (newestTag.sha === world) covered = true;
      else if (memo && memo.world === world && memo.tag_sha === newestTag.sha && memo.mode === mode && typeof memo.covered === "boolean") {
        covered = memo.covered; held = memo.held ?? null;
      } else {
        const repo = `/repos/${st.worldRepo.owner}/${st.worldRepo.name}`;
        try {
          if (mode === "quiet") {
            // base = the tag, head = the world: the range the tag does not
            // cover. No per_page: unpaginated, GitHub lists up to 250 commits.
            const q = judgeQuietRange(await ghJson(`${repo}/compare/${newestTag.sha}...${world}`, { fetchImpl, token }));
            covered = q.covered; held = q.held; coverError = q.error;
          } else {
            const cmp = await ghJson(`${repo}/compare/${world}...${newestTag.sha}?per_page=1`, { fetchImpl, token });
            // base = the world, head = the tag: `ahead` = the tag descends from it, `identical` = it is it.
            covered = cmp?.status === "identical" || cmp?.status === "ahead" ? true
              : cmp?.status === "behind" || cmp?.status === "diverged" ? false : null;
            if (covered == null) coverError = `the compare answered status ${JSON.stringify(cmp?.status ?? null)}`;
          }
        } catch (e) { coverError = e.message; notes.push(`settlement coverage unread: ${e.message}`); }
        if (typeof covered === "boolean") stamps.settlement = { world, tag_sha: newestTag.sha, mode, covered, ...(held ? { held } : {}) };
      }
    }
    const se = classifySettlement({ receipt, readError, newestTag, covered, held, nowMs, writtenAtMs, tagError, coverError, graceMs: st.graceMs, slotsUtc: st.slotsUtc, path: st.receipt });
    probes.push({ key: st.key, label: st.label, kind: "settlement", verdict: se.verdict, reason: se.reason, ...(se.detail ? { detail: se.detail } : {}) });
  }

  // §13 — the Linear handler, one row per repo. With a token only (W4): one
  // runs read per repo a tick, and the jobs and annotations of a run that did
  // not succeed are read ONCE per (run, attempt) and remembered in
  // `stamps.linear_handler`, because a finished attempt never changes. A re-run
  // is a new attempt, so it is read again.
  if (config.linearHandler) {
    const lh = config.linearHandler;
    const memo = stamps.linear_handler ?? {};
    const nextMemo = {};
    for (const repo of lh.repos) {
      const key = `${lh.keyPrefix}_${slug(repo)}`;
      const label = `the Linear handler in ${repo}`;
      const base = `/repos/${lh.owner}/${repo}`;
      let row;
      if (!token) {
        row = classifyLinearHandler({ repo, haveToken: false });
      } else {
        let runs = [], readError = null, notFound = false, repoVisible = null;
        try {
          runs = (await ghJson(`${base}/actions/workflows/${lh.workflowFile}/runs?status=completed&per_page=${lh.perPage}`, { fetchImpl, token }))?.workflow_runs ?? [];
        } catch (e) {
          if (e.status === 404) {
            notFound = true;
            try { await ghJson(base, { fetchImpl, token }); repoVisible = true; }
            catch (e2) { repoVisible = e2.status === 404 ? false : null; }
          } else readError = e.message;
        }
        // One GitHub blip must not cost a re-read: the memory outlives an unread tick (review N1).
        if (readError && memo[repo]) nextMemo[repo] = memo[repo];
        const run = notFound || readError ? null : runs.find((r) => r?.status === "completed" && !INDECISIVE.has(r?.conclusion));
        const seen = memo[repo];
        if (run && run.conclusion !== "success" && seen && seen.run_id === run.id && seen.attempt === (run.run_attempt ?? 1)) {
          row = { verdict: seen.verdict, reason: seen.reason, detail: seen.detail };
          nextMemo[repo] = seen;
        } else {
          let jobs = null, annotations = null, annotationsRefused = false;
          if (run && run.conclusion !== "success") {
            try { jobs = (await ghJson(`${base}/actions/runs/${run.id}/jobs`, { fetchImpl, token }))?.jobs ?? []; }
            catch (e) { notes.push(`${repo} handler jobs unread: ${e.message}`); }
            const failed = (jobs ?? []).find((j) => (j?.steps ?? []).some((s) => s?.name === lh.step) && j.conclusion !== "success") ?? (jobs ?? [])[0];
            const ok = (failed?.steps ?? []).find((s) => s?.name === lh.step)?.conclusion === "success";
            if (failed?.id != null && !ok) {
              try { annotations = await ghJson(`${base}/check-runs/${failed.id}/annotations`, { fetchImpl, token }); }
              catch (e) {
                notes.push(`${repo} handler annotations unread: ${e.message}`);
                // A 4xx is the token's answer (no Checks: read), and it will not change by asking again.
                annotationsRefused = e.status >= 400 && e.status < 500;
              }
            }
            row = classifyLinearHandler({ repo, runs, jobs, annotations, step: lh.step });
            // Remembered once both reads answered (a 4xx on the annotations counts as an answer), so
            // only an unread one is asked again next tick.
            if (jobs != null && (row.verdict !== "DOWN" || annotations != null || annotationsRefused || failed?.id == null)) {
              nextMemo[repo] = { run_id: run.id, attempt: run.run_attempt ?? 1, verdict: row.verdict, reason: row.reason, detail: row.detail };
            }
          } else {
            row = classifyLinearHandler({ repo, runs, readError, notFound, repoVisible, step: lh.step });
          }
        }
      }
      probes.push({ key, label, kind: "workflow", verdict: row.verdict, reason: row.reason, ...(row.detail ? { detail: row.detail } : {}) });
    }
    stamps.linear_handler = nextMemo;
  }

  // §14–§19 (POS-968). Local reads and one journalctl call, no network and no
  // REST budget. The journal serves both §14's kills and §19's trips; the
  // access log serves §15, and §14's 500s.
  const ev = config.events ?? { windowMs: 10 * MINUTE, lookbackMs: 25 * MINUTE };
  const sinceMs = nowMs - ev.lookbackMs;
  // What a probe says only where operators read (the Discord post, the change
  // log, state.json): its finding, and for §17 the text that names the units.
  // The board's probe objects never carry either; it is public.
  const inner = new Map();
  const keep = (key, r, more = {}) => inner.set(key, { said: r.said ?? r.reason, finding: r.finding, ...more });
  let journal = null, journalWhy = "no office journal is configured";
  if (config.officeJournal && (config.storeHealth || config.officeTripped)) {
    const j = readOfficeJournal(config.officeJournal.unit, sinceMs, { exec });
    if (j.error) journalWhy = j.error;
    else if (!j.seen) journalWhy = `journalctl shows no line of ${config.officeJournal.unit} at all, so this user cannot see its journal`;
    else { journalWhy = null; journal = j.entries.filter((e) => e.atMs >= sinceMs && e.atMs <= nowMs); }
  }
  const access = config.accessLog && (config.resident5xx || config.storeHealth) ? readAccessErrors(config.accessLog.dir, { sinceMs, nowMs }) : null;

  if (config.storeHealth) {
    const sh = config.storeHealth;
    let raw = null, readError = null;
    try { raw = readFileSync(sh.path, "utf8"); } catch (e) { readError = e?.code ?? e?.message ?? String(e); }
    const r = classifyStoreHealth({
      txnRaw: raw, txnError: readError,
      kills: journal ? journal.filter((e) => KILL_LINE.test(e.message)).map((e) => e.atMs) : null, journalWhy,
      answered500: access?.rows ? access.rows.filter((x) => x.status === 500).map((x) => x.at) : null, accessError: access?.error ?? "no access log is configured",
      nowMs, sinceMs, windowMs: ev.windowMs, staleAfterMs: sh.staleAfterMs, path: sh.path,
    });
    probes.push({ key: sh.key, label: sh.label, kind: "store", verdict: r.verdict, reason: r.reason, detail: r.detail });
    keep(sh.key, r);
  }

  if (config.resident5xx) {
    const rx = config.resident5xx;
    const r = classifyResident5xx({ rows: access?.rows ?? null, newestMs: access?.newestMs ?? null, readError: access?.error ?? "no access log is configured", nowMs, sinceMs, windowMs: ev.windowMs, threshold: rx.threshold, dir: config.accessLog?.dir });
    probes.push({ key: rx.key, label: rx.label, kind: "errors", verdict: r.verdict, reason: r.reason, ...(r.detail ? { detail: r.detail } : {}) });
    keep(rx.key, r);
  }

  if (config.certs) {
    const c = config.certs;
    for (const host of c.hosts) {
      const r = classifyCert({ ...readServedCert(host, { exec, connect: c.connect, timeoutMs: c.timeoutMs }), nowMs, warnDays: c.warnDays, downDays: c.downDays, connect: c.connect });
      const key = `${c.keyPrefix}_${slug(host)}`;
      probes.push({ key, label: `the certificate for ${host}`, kind: "cert", verdict: r.verdict, reason: r.reason, ...(r.detail ? { detail: r.detail } : {}) });
      keep(key, r);
    }
  }

  if (config.failedUnits) {
    const fu = config.failedUnits;
    let text = null, error = null, manifestNames = null, manifestError = null;
    try {
      text = String(exec("systemctl", ["list-units", "--failed", "--plain", "--no-legend"], { encoding: "utf8", timeout: config.requestTimeoutMs, stdio: ["ignore", "pipe", "pipe"] }));
    } catch (e) { error = (firstLine(e?.stderr) || firstLine(e?.message ?? e)).slice(0, 160); }
    try { manifestNames = manifestUnitNames(JSON.parse(readFileSync(fu.manifest, "utf8"))); } catch (e) { manifestError = e?.code ?? firstLine(e?.message ?? e); }
    const r = classifyFailedUnits({ text, error, manifestNames, manifestError, manifestPath: fu.manifest });
    probes.push({ key: fu.key, label: fu.label, kind: "units", verdict: r.verdict, reason: r.reason, ...(r.detail ? { detail: r.detail } : {}) });
    keep(fu.key, r, { rebark: true });
  }

  if (config.backup) {
    const bk = config.backup;
    let raw = null, readError = null;
    try { raw = readFileSync(bk.path, "utf8"); } catch (e) { readError = e?.code ?? e?.message ?? String(e); }
    const r = classifyBackup({ raw, readError, nowMs, staleAfterMs: bk.staleAfterMs, path: bk.path });
    probes.push({ key: bk.key, label: bk.label, kind: "backup", verdict: r.verdict, reason: r.reason, ...(r.detail ? { detail: r.detail } : {}) });
    keep(bk.key, r);
  }

  if (config.officeTripped) {
    const ot = config.officeTripped;
    const trips = journal ? journal.filter((e) => TRIP_LINE.test(e.message)).map((e) => ({ atMs: e.atMs, door: tripDoor(e.message) })) : null;
    const r = classifyOfficeTripped({ trips, journalWhy, nowMs, sinceMs, windowMs: ev.windowMs, threshold: ot.threshold });
    probes.push({ key: ot.key, label: ot.label, kind: "trips", verdict: r.verdict, reason: r.reason, ...(r.detail ? { detail: r.detail } : {}) });
    keep(ot.key, r);
  }

  // the edges. An acknowledgement (§21) may shape what a probe says, a probe
  // that lists things re-barks when the list changes, and the change log (§20)
  // records every probe whose verdict moved or that spoke. Each sees the
  // probe's private text and finding where it has one; the board does not.
  const prevProbes = state.probes ?? {};
  const nextProbes = {};
  const alerts = [];
  const history = [];
  const ackBook = judgeAcks(acks, { nowMs, keys: new Set(probes.map((p) => p.key)), error: acksError });
  notes.push(...ackBook.notes);
  for (const p of probes) {
    const prev = prevProbes[p.key] ?? null;
    const own = inner.get(p.key);
    const seen = own ? { ...p, reason: own.said, finding: own.finding } : p;
    const t = transition({ prev, next: seen, nowMs, reminderMs: config.reminderMs });
    let { alert, state: st, acked = false, suppressed = null } = applyAck({ prev, next: seen, alert: t.alert, state: t.state, ack: ackBook.live.get(p.key) ?? null, nowMs });
    if (own?.rebark) ({ alert, state: st } = rebarkOnChange({ prev, next: seen, alert, state: st, acked, nowMs }));
    nextProbes[p.key] = st;
    if (alert) alerts.push({ key: p.key, label: p.label, alert });
    if (acked) p.ack = { issue: st.ack.issue, until: st.ack.until };
    if (!prev || prev.verdict !== p.verdict || alert || suppressed) {
      history.push({
        at: nowIso, key: p.key, label: p.label, from: prev?.verdict ?? null, to: p.verdict, reason: seen.reason,
        alert: alert?.kind ?? null, ...(suppressed ? { held_by_ack: suppressed } : {}), ...(st.ack ? { ack: st.ack.issue } : {}),
      });
    }
  }

  return { probes, alerts, notes, history, nextState: { schema: 1, probes: nextProbes, stamps, last_run: nowIso }, nowIso };
}

async function readText(url, { fetchImpl = fetch } = {}) {
  try {
    const res = await fetchImpl(url, { headers: { "user-agent": CONFIG.userAgent }, signal: AbortSignal.timeout(CONFIG.requestTimeoutMs) });
    return res.ok ? await res.text() : null;
  } catch { return null; }
}

async function readJson(url, opts) {
  const t = await readText(url, opts);
  if (t == null) return null;
  try { return JSON.parse(t); } catch { return null; }
}

// ── the CLI ─────────────────────────────────────────────────────────────────

export const readState = (p) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return {}; } };
export function writeJson(p, o) { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, JSON.stringify(o, null, 2) + "\n"); }

/** A file beside the state: /srv/postmark-sentinel/state.json → …/history.jsonl; any other name gains a suffix. */
export const besideState = (statePath, name) => (/state\.json$/.test(statePath) ? statePath.replace(/state\.json$/, name) : `${statePath}.${name}`);

/** The operator's ack file (§21): { acks } parsed, or { error } when it exists and cannot be read. None at all is no acks. */
export function readAcks(path) {
  try { return { acks: JSON.parse(readFileSync(path, "utf8")), error: null }; } catch (e) {
    return e?.code === "ENOENT" ? { acks: null, error: null } : { acks: null, error: `${path} could not be read (${firstLine(e?.message ?? e).slice(0, 120)})` };
  }
}

/**
 * Whether the alert channel exists, said as data.
 *
 * Degrading VISIBLY is the point. A watch whose channel is unconfigured must
 * still take every reading and still write its board, and must say — on stderr
 * AND on the board itself — that nothing was sent. The one thing it must never
 * do is fall quiet, because a silent sentinel is indistinguishable from a
 * healthy town, and that indistinguishability IS the failure this file exists
 * to end: "how can we LOUDLY BE NOTIFIED when something is down on the site?"
 */
export function alertingStatus(env = process.env) {
  const webhook = env.SENTINEL_DISCORD_WEBHOOK || null;
  return webhook
    ? { webhook, status: { channel: "discord", configured: true } }
    : {
      webhook: null,
      status: {
        channel: "discord",
        configured: false,
        note: "SENTINEL_DISCORD_WEBHOOK is unset — every reading on this board was taken and NOTHING WAS SENT. Set it in /etc/postmark-sentinel.env (deploy/DEPLOY.md § the sentinel).",
      },
    };
}

/**
 * The whole CLI, with every dependency injectable so a falsifier can run the
 * real thing — state file, board file, delivery decision, exit path — with no
 * network and no box.
 */
export async function run({
  argv = process.argv,
  env = process.env,
  fetchImpl = fetch,
  exec = execFileSync,
  nowMs = null,
  log = console.log,
  errLog = console.error,
  readDisk = readDiskState,
} = {}) {
  const a = (name, dflt = null) => {
    const i = argv.indexOf(`--${name}`);
    return i > -1 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : dflt;
  };
  const statePath = a("state", join(HERE, "..", ".site-sentinel-state.json"));
  const outPath = a("out", null);
  // §20 and §21 live beside the state, so the unit needs no new flag.
  const historyPath = a("history", besideState(statePath, "history.jsonl"));
  const acksPath = a("acks", besideState(statePath, "acks.json"));
  const dryRun = argv.includes("--dry-run");
  const at = nowMs ?? (a("now") ? Date.parse(a("now")) : Date.now());

  const { webhook, status: alerting } = alertingStatus(env);
  if (!webhook) errLog("site-sentinel: LOUD DEGRADATION — SENTINEL_DISCORD_WEBHOOK is unset; probes ran, the board was written, and no alert could be delivered.");

  // Optional for §1–§12: both repos are public, so they work keyless at 60
  // REST/hour and merely spend less of the shared budget with the box's
  // existing read-only token. §13 (the Linear handler) reads only with it.
  let token = null;
  try { token = readFileSync(env.SENTINEL_GITHUB_TOKEN_FILE ?? "/srv/postmark-office/git-metrics-token", "utf8").trim() || null; } catch { token = null; }

  const ackFile = readAcks(acksPath);
  const { probes, alerts, notes, history, nextState, nowIso } = await tick({ fetchImpl, exec, state: readState(statePath), nowMs: at, token, readDisk, acks: ackFile.acks, acksError: ackFile.error });
  const board = composeBoard({ probes, nowIso, alerting: { ...alerting, notes } });
  if (outPath) { board.published_at = outPath; writeJson(outPath, board); }

  const message = composeMessage({ alerts, board, nowIso });
  let delivered = null;
  if (message && webhook && !dryRun) {
    try { await postDiscord(webhook, message, { fetchImpl }); delivered = true; }
    catch (e) { delivered = false; errLog(`site-sentinel: the webhook refused the alert (${e.message}) — the alert text follows so it is not lost:\n${message}`); }
  } else if (message) {
    errLog(`site-sentinel: ${dryRun ? "--dry-run" : "no webhook"}; the alert that would have been sent:\n${message}`);
  }

  // The state advances even when delivery failed: a delivery that failed twice
  // must not re-announce an onset it already announced once. The failure is
  // loud on stderr and the journal keeps it.
  writeJson(statePath, nextState);
  // The change log (§20). A log that cannot be written is said on stderr and
  // never stops the run: the board and the state are already written.
  try {
    appendHistory(historyPath, history.map((h) => (h.alert ? { ...h, delivered } : h)), { nowMs: at });
  } catch (e) { errLog(`site-sentinel: the change log at ${historyPath} could not be written (${e.message}); the board and the state were`); }

  if (argv.includes("--json")) { log(JSON.stringify(board, null, 2)); return { board, alerts, delivered, message }; }
  log(`site-sentinel: ${board.headline}`);
  for (const p of probes) if (p.verdict !== "OK" && p.verdict !== "INFO") log(`  ${p.verdict}  ${p.label} — ${p.reason}`);
  // The terminal and the board must agree about what is worth saying. This loop
  // used to skip INFO with everything else that was not broken, so an operator
  // running the sentinel by hand saw NOTHING about a rail that had never been
  // switched on. Printed last and named PARKED, not alarmed.
  for (const p of probes) if (p.verdict === "INFO") log(`  PARKED  ${p.label} — ${p.reason}`);
  for (const n of notes) log(`  note: ${n}`);
  if (alerts.length) log(`  ${alerts.length} alert(s) ${delivered === true ? "delivered" : delivered === false ? "NOT delivered (webhook refused)" : "not sent"}`);
  return { board, alerts, delivered, message };
}

// ── entry guard ──────────────────────────────────────────────────────────────
// The junction lesson (2026-09-05, HQ memory `junctions-defeat-main-guards`):
// `pathToFileURL(process.argv[1]).href === import.meta.url` is FALSE when the
// entry path reaches this file through a Windows junction — the ESM loader
// realpaths the entry, argv[1] is not — so the tool exits 0 having done nothing.
// Compare real paths (world2/tools/await-clearing.mjs's idiom); the URL compare is
// only the fallback for an argv[1] that cannot be realpath'd. The office's
// test/cli-guard.test.mjs imports this file and spawns it through a junction.
const isMain = (() => {
  if (!process.argv[1]) return false;
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return pathToFileURL(process.argv[1]).href === import.meta.url; }
})();
if (isMain) {
  run().catch((e) => { console.error(`site-sentinel FATAL: ${e?.stack ?? e}`); process.exit(1); });
}
