// Falsifiers for site-sentinel.
//
// The law these assert is the founder's sentence of 2026-08-25, quoted verbatim
// wherever a test claims the alert fires:
//
//     "how can we LOUDLY BE NOTIFIED when something is down on the site?"
//
// Two sentences that shape what "loud" has to mean here, and which several of
// these tests exist specifically to hold:
//   - loud is not frequent. A per-tick ping is wallpaper; the reader mutes it,
//     and a muted channel reproduces the silence exactly. So the reminder
//     falsifier below is as load-bearing as the onset one.
//   - degrading must be visible. A watch that cannot reach its channel must
//     still take every reading, still write its board, and still SAY so.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import {
  classifyUp,
  classifyStamp,
  classifyCrossing,
  classifyDaily,
  dailyFingerprint,
  normalizeText,
  latestDecisiveRunPerWorkflow,
  classifyWorkflows,
  transition,
  composeMessage,
  composeBoard,
  alertingStatus,
  humanDuration,
  lsRemote,
  newestReleaseTag,
  tick,
  run,
  classifyProblems,
  classifyDisk,
  classifyMeeps,
  classifyLawPen,
  classifyLinearHandler,
  handlerFailureLine,
  diskUsage,
  readDiskState,
  MINUTE,
  HOUR,
  CONFIG,
} from "../tools/site-sentinel.mjs";
import { tempDir } from "./helpers/temp-dir.mjs";

const T0 = Date.parse("2026-08-25T12:00:00Z");
// §13 reads only with a token (W4), so the ticks below carry one; stubFetch ignores it.
const FIXTURE_TOKEN = "fixture-token";

// ── §1 up ───────────────────────────────────────────────────────────────────

test("classifyUp: 200 is up, 500 and a timeout and a 404 are all DOWN", () => {
  assert.equal(classifyUp({ status: 200 }).verdict, "OK");
  assert.equal(classifyUp({ status: 204 }).verdict, "OK");

  // 5xx — the server broke.
  const five = classifyUp({ status: 502 });
  assert.equal(five.verdict, "DOWN");
  assert.match(five.reason, /502/);

  // No response at all. This is the loudest case and must not be softened by a
  // sympathetic error string.
  const dead = classifyUp({ error: "The operation was aborted due to timeout" });
  assert.equal(dead.verdict, "DOWN");
  assert.match(dead.reason, /did not answer at all/);
  assert.equal(classifyUp({ error: "ECONNREFUSED" }).verdict, "DOWN");

  // 404 on a path that is supposed to exist is an outage wearing a tidy status
  // code — a deploy that shipped a tree without /daily/ looks exactly like this.
  assert.equal(classifyUp({ status: 404 }).verdict, "DOWN");
});

test("classifyUp: dev's 302 to the Access login is INFO, and a 302 anywhere else is still DOWN", () => {
  const gate = "https://raspy-frog-75d3.cloudflareaccess.com/cdn-cgi/access/login/dev.postmark.town?kid=abc";

  // dev.postmark.town's healthy shape — measured against the live host
  // 2026-08-25. Alarming on it would train the reader to ignore the channel,
  // which is the failure mode this whole file is against.
  const dev = classifyUp({ status: 302, location: gate, infoOnly: true });
  assert.equal(dev.verdict, "INFO");
  assert.match(dev.reason, /Access/);

  // THE CONTROL, and the reason the gate is recognised by DESTINATION HOST and
  // not by status code: a 302 that is NOT the Access login must not be
  // swallowed by the same branch, or a redirect loop on prod reads as healthy.
  const elsewhere = classifyUp({ status: 302, location: "https://example.com/oops" });
  assert.equal(elsewhere.verdict, "DOWN");
  assert.match(elsewhere.reason, /should serve, not redirect/);

  // And an info-only door that is genuinely dead still cannot raise an alert —
  // it reports, it does not alarm.
  assert.equal(classifyUp({ error: "ECONNREFUSED", infoOnly: true }).verdict, "INFO");
  assert.equal(classifyUp({ status: 500, infoOnly: true }).verdict, "INFO");
});

// ── §2/§3 the staleness math, against fixed fixtures ────────────────────────

test("classifyStamp: matching is OK, a fresh divergence is inside the window, a held one is STALE", () => {
  const base = { nowMs: T0, staleAfterMs: 45 * MINUTE, what: "the index", referenceName: "main" };

  // Agreement is green regardless of clocks — and clears the divergence memory.
  const ok = classifyStamp({ ...base, served: "aaa", reference: "aaa", seen: { value: "aaa", first_seen_at: T0 - 2 * HOUR, diverged_since: T0 - 30 * MINUTE } });
  assert.equal(ok.verdict, "OK");
  assert.equal(ok.seen.diverged_since, null, "agreement must clear the divergence clock, or a healed site stays pre-condemned");

  // Diverged ten minutes ago: an ordinary deploy in flight.
  const fresh = classifyStamp({ ...base, served: "aaa", reference: "bbb", seen: { value: "aaa", first_seen_at: T0 - 2 * HOUR, diverged_since: T0 - 10 * MINUTE } });
  assert.equal(fresh.verdict, "OK");
  assert.match(fresh.reason, /inside the 45m deploy window/);

  // The reference has been ahead for over an hour — the stuck rehydrate tick,
  // the shape found by hand on 2026-08-25 (one distinct as-of across three
  // tick slots). This is what "something is down" looks like with no error code.
  const stale = classifyStamp({ ...base, served: "aaa", reference: "bbb", seen: { value: "aaa", first_seen_at: T0 - 2 * HOUR, diverged_since: T0 - 70 * MINUTE } });
  assert.equal(stale.verdict, "STALE");
  assert.match(stale.reason, /1h10m/);
  assert.match(stale.reason, /moved on/);
});

test("classifyStamp: THE QUIET-HOUR INCIDENT (2026-08-31, 6-7 false alarms a day) — an old serve of a quiet repo is not stale", () => {
  // The exact live shape, replayed: the town committed nothing for 59 minutes,
  // so the served sha aged 49 minutes in perfect health; then one stake landed
  // and NINE minutes later the old anchoring declared 49 minutes of staleness.
  // The clock must start at the divergence, not at the served value's birth.
  const base = { nowMs: T0, staleAfterMs: 45 * MINUTE, what: "the index", referenceName: "main" };
  // Every quiet tick agreed, so the memory carries no divergence...
  const quiet = { value: "8216f1ce", first_seen_at: T0 - 49 * MINUTE, diverged_since: null };
  // ...and the first tick that sees the fresh push starts the clock NOW.
  const v = classifyStamp({ ...base, served: "8216f1ce", reference: "1cf42d0d", seen: quiet });
  assert.equal(v.verdict, "OK", "nine minutes behind a nine-minute-old tip is a deploy in flight, never an alarm");
  assert.equal(v.seen.diverged_since, T0, "the divergence clock starts at the divergence");
  // Had the push stayed unserved past the window, THEN it alarms:
  const later = classifyStamp({ ...base, nowMs: T0 + 50 * MINUTE, served: "8216f1ce", reference: "1cf42d0d", seen: v.seen });
  assert.equal(later.verdict, "STALE", "…and a divergence genuinely held past the window still fires");
});

test("classifyStamp: the divergence clock survives reference movement, so a busy repo cannot hide a frozen site", () => {
  // The original anchoring law, kept under the new anchor: if the clock reset
  // whenever the reference moved, a repo that commits every 30 minutes could
  // never accumulate an alarm even while every single deploy failed.
  const base = { nowMs: T0, staleAfterMs: 45 * MINUTE, what: "the index", referenceName: "main" };
  let seen = { value: "frozen", first_seen_at: T0 - 3 * HOUR, diverged_since: T0 - 3 * HOUR };

  // Reference keeps moving; served value does not. Still stale, every time.
  for (const reference of ["r1", "r2", "r3"]) {
    const v = classifyStamp({ ...base, served: "frozen", reference, seen });
    assert.equal(v.verdict, "STALE", `reference ${reference} must not reset the clock`);
    assert.equal(v.seen.diverged_since, T0 - 3 * HOUR, "the divergence memory must not advance while the served value is unchanged");
    seen = v.seen;
  }

  // And when the served value DOES change — a deploy landed — the clock resets:
  // a progressing pipeline is never stale.
  const moved = classifyStamp({ ...base, served: "thawed", reference: "r4", seen });
  assert.equal(moved.verdict, "OK");
  assert.equal(moved.seen.first_seen_at, T0);
  assert.equal(moved.seen.diverged_since, T0, "progress restarts the divergence clock");
});

test("classifyStamp: a pre-upgrade state file (no diverged_since) gets one tick of grace, not a false alarm", () => {
  const base = { nowMs: T0, staleAfterMs: 45 * MINUTE, what: "the index", referenceName: "main" };
  const old = { value: "aaa", first_seen_at: T0 - 2 * HOUR }; // written by the served-anchored era
  const v = classifyStamp({ ...base, served: "aaa", reference: "bbb", seen: old });
  assert.equal(v.verdict, "OK", "the watch does not know how long the divergence held — guessing would invent evidence");
  assert.equal(v.seen.diverged_since, T0);
});

test("classifyStamp: a cold start is quiet, and an unreadable side is UNKNOWN rather than green", () => {
  // Never-seen-before: the watch genuinely does not know how long that value
  // has been up. Guessing would be inventing evidence, so it starts the clock
  // and says OK this once.
  const cold = classifyStamp({ served: "aaa", reference: "bbb", seen: null, nowMs: T0, staleAfterMs: HOUR, what: "x", referenceName: "y" });
  assert.equal(cold.verdict, "OK");
  assert.equal(cold.seen.first_seen_at, T0);

  // An unreadable side must never read as green — a missing stamp is a blind
  // spot, and calling a blind spot healthy is the lie the whole file is against.
  assert.equal(classifyStamp({ served: null, reference: "b", seen: null, nowMs: T0, staleAfterMs: HOUR, what: "x", referenceName: "y" }).verdict, "UNKNOWN");
  assert.equal(classifyStamp({ served: "a", reference: null, seen: null, nowMs: T0, staleAfterMs: HOUR, what: "x", referenceName: "y" }).verdict, "UNKNOWN");
});

// ── §2b the crossing ────────────────────────────────────────────────────────
//
// THE LAW THESE ASSERT, verbatim from EPICS/POSTMARK/freshness-architecture.md
// § the mushy middle:
//
//   "mushiness must be disclosed — the page states when it was generated and
//    which ferry crossing it reflects, says 'a ferry has landed since this page
//    was made' when true, and never prints a cadence promise it does not
//    control."
//
// and, on why this probe exists at all beside the wall-clock ones:
//
//   "The crossing-aware watchdog: site-sentinel compares the site's crossing
//    number to reality's, instead of (only) a wall-clock age threshold — a
//    wall-clock threshold cannot see an event-shaped failure."
//
// THE DEFECT THEY CLOSE is the 2026-08-26 incident: prod's delivery stalled 97
// minutes past a ferry crossing and 48 residents' doorstep pages served
// yesterday's mail. Every wall-clock probe in this file was green throughout,
// because the site HAD rebuilt recently — it had just rebuilt the wrong side of
// a ferry. The first test below is that incident, to the minute.

// The town clock, in the falsifiers' own hands, so a test can place itself at
// an exact number of minutes past a crossing.
const CROSSING_AT = (n) => Date.parse("2026-06-12T00:00:00Z") + n * 12 * 60 * 60_000;

test("THE 08-26 INCIDENT: 97 minutes past a ferry with the site still on the old crossing is STALE, and says a ferry has landed", () => {
  const stale = classifyCrossing({
    servedCrossing: 148, officeCrossing: 149,
    nowMs: CROSSING_AT(149) + 97 * MINUTE, graceMs: CONFIG.crossingGrace,
  });
  assert.equal(stale.verdict, "STALE");
  assert.match(stale.reason, /a ferry has landed since the site was built/,
    "the founder's own sentence, said in the alert a reader actually gets");
  assert.match(stale.reason, /crossing 148/, "and it names the crossing the site is stuck on");
  assert.match(stale.reason, /1h37m/, "and how long the town has been past it");
});

test("THE FLIP: the same probe against a FRESH site is OK — it must not fire on a healthy town", () => {
  // caught up: the site baked the crossing the town is at
  const level = classifyCrossing({
    servedCrossing: 149, officeCrossing: 149,
    nowMs: CROSSING_AT(149) + 97 * MINUTE, graceMs: CONFIG.crossingGrace,
  });
  assert.equal(level.verdict, "OK", "a site showing the current crossing is never a finding");

  // and AHEAD is fine too: a build that straddled the ferry stamps the newer
  // number honestly, because the town data it read was on the far side of it.
  assert.equal(classifyCrossing({
    servedCrossing: 150, officeCrossing: 149,
    nowMs: CROSSING_AT(149) + 10 * MINUTE, graceMs: CONFIG.crossingGrace,
  }).verdict, "OK");
});

test("the rebuild window is TWO TICKS wide — quiet at :40, loud once both ticks have had their turn", () => {
  const one = (mins) => classifyCrossing({
    servedCrossing: 148, officeCrossing: 149,
    nowMs: CROSSING_AT(149) + mins * MINUTE, graceMs: CONFIG.crossingGrace,
  });
  // the :10 tick is still building
  assert.equal(one(12).verdict, "OK");
  assert.match(one(12).reason, /inside the 1h rebuild window/);
  // the :40 tick's turn — still inside
  assert.equal(one(45).verdict, "OK");
  // an hour on, both ticks have had their chance and neither landed
  assert.equal(one(61).verdict, "STALE");
});

test("two crossings behind is STALE whatever the clock says — no rebuild window excuses a whole missed ferry", () => {
  // one minute past a crossing is the most forgiving instant there is, and it
  // must still not forgive this: a full crossing came and went unseen.
  const said = classifyCrossing({
    servedCrossing: 147, officeCrossing: 149,
    nowMs: CROSSING_AT(149) + 1 * MINUTE, graceMs: CONFIG.crossingGrace,
  });
  assert.equal(said.verdict, "STALE");
  assert.match(said.reason, /2 ferries have landed/, "and it counts them, so the reader knows the size of the gap");
});

test("a crossing it cannot read is UNKNOWN and says which side went dark — never a green all-clear", () => {
  // Three different unreadables, three different repairs, three sentences. A
  // single "could not tell" would send the reader to the other probes to learn
  // which one it was, at the hour they are least able to.
  const noBuildJson = classifyCrossing({ haveStamp: false, servedCrossing: null, officeCrossing: 149, nowMs: CROSSING_AT(149), graceMs: CONFIG.crossingGrace });
  assert.equal(noBuildJson.verdict, "UNKNOWN");
  assert.match(noBuildJson.reason, /serves no \/build\.json at all/);

  const noStamp = classifyCrossing({ servedCrossing: null, officeCrossing: 149, nowMs: CROSSING_AT(149), graceMs: CONFIG.crossingGrace });
  assert.equal(noStamp.verdict, "UNKNOWN");
  assert.match(noStamp.reason, /build stamp names no crossing/);
  assert.notEqual(noStamp.reason, noBuildJson.reason,
    "a stamp that exists without a crossing is a DIFFERENT fix from no stamp at all");

  const noOffice = classifyCrossing({ servedCrossing: 149, officeCrossing: null, nowMs: CROSSING_AT(149), graceMs: CONFIG.crossingGrace });
  assert.equal(noOffice.verdict, "UNKNOWN");
  assert.match(noOffice.reason, /office did not serve a crossing number/);

  // THE FALSIFIER: folding "cannot tell" into "nothing is wrong" is the failure
  // that makes a sentinel worse than none — the reader is now trusting silence.
  for (const said of [noBuildJson, noStamp, noOffice]) assert.notEqual(said.verdict, "OK");
});

test("humanDuration reads inside a sentence", () => {
  assert.equal(humanDuration(30_000), "under a minute");
  assert.equal(humanDuration(45 * MINUTE), "45m");
  assert.equal(humanDuration(70 * MINUTE), "1h10m");
  assert.equal(humanDuration(3 * HOUR), "3h");
  assert.equal(humanDuration(26 * HOUR), "1d 2h");
});

// ── §4 the daily ────────────────────────────────────────────────────────────

const DAILY_MD = `<!-- Ferry's Daily -->
# The office — Ferry's Daily

*A curated look, tended each round; last on **2026-08-25**.*

### ⛴ **Crossing 149 · 45 letters over · no bounces**

## "An arithmetic that balances is not an arithmetic that agrees"

**The office told \`little-bird\` this week...**
`;

test("dailyFingerprint prefers the headline, which moves every tending, and falls back to the crossing line", () => {
  const fp = dailyFingerprint(DAILY_MD);
  assert.equal(fp.kind, "headline");
  assert.match(fp.value, /arithmetic that balances/);

  // No headline: the crossing line is the backstop. Second, not first, because
  // it only advances twice a day and is blind to a mid-crossing re-tending.
  const noHead = dailyFingerprint("# Daily\n\n### ⛴ **Crossing 150 · 3 letters**\n\ntext");
  assert.equal(noHead.kind, "crossing");
  assert.equal(noHead.value, "Crossing 150");

  assert.equal(dailyFingerprint("# nothing structural here").kind, "none");
});

test("normalizeText survives the markdown-to-HTML round trip that would otherwise report a stale daily every day", () => {
  // The same sentence, as authored and as rendered: smart quotes, an entity, a
  // tag boundary, an em-dash. Comparing raw bytes would call these different.
  const authored = `## "An arithmetic that balances" — really`;
  const rendered = `<h2 id="x">&#8220;An arithmetic that <em>balances</em>&#8221; &mdash; really</h2>`;
  assert.ok(normalizeText(rendered).includes(normalizeText("An arithmetic that balances")));
  assert.ok(normalizeText(authored).includes("an arithmetic that balances"));
});

test("classifyDaily: present is OK, absent-and-old is STALE, absent-and-fresh is the deploy window", () => {
  const fp = dailyFingerprint(DAILY_MD);
  const served = `<html><h1>The office — Ferry's Daily</h1><h2>&#8220;An arithmetic that balances is not an arithmetic that agrees&#8221;</h2></html>`;

  const ok = classifyDaily({ fingerprint: fp, servedHtml: served, sourceCommittedAtMs: T0 - 5 * HOUR, nowMs: T0, slackMs: 90 * MINUTE });
  assert.equal(ok.verdict, "OK");

  // The town moved five minutes ago; the site has not caught up yet. That is a
  // deploy in flight, not a failure, and alarming on it would make the channel
  // noise twice an hour.
  const inFlight = classifyDaily({ fingerprint: fp, servedHtml: "<html>yesterday's daily</html>", sourceCommittedAtMs: T0 - 5 * MINUTE, nowMs: T0, slackMs: 90 * MINUTE });
  assert.equal(inFlight.verdict, "OK");
  assert.match(inFlight.reason, /sync-and-deploy window/);

  // Past the window and still absent: "Ferry's Daily sat stale on display and
  // nobody was told" — the 2026-08-25 fire, caught as an OUTCOME with no
  // pipeline involved.
  const stale = classifyDaily({ fingerprint: fp, servedHtml: "<html>yesterday's daily</html>", sourceCommittedAtMs: T0 - 4 * HOUR, nowMs: T0, slackMs: 90 * MINUTE });
  assert.equal(stale.verdict, "STALE");
  assert.match(stale.reason, /newer Daily than the site is showing/);
  assert.match(stale.reason, /arithmetic that balances/, "the reason must quote the missing sentence so a reader can check it themselves");

  assert.equal(classifyDaily({ fingerprint: fp, servedHtml: null, nowMs: T0, slackMs: 90 * MINUTE }).verdict, "UNKNOWN");
});

// ── §5 workflows ────────────────────────────────────────────────────────────

test("latestDecisiveRunPerWorkflow looks through in-progress runs so a broken workflow cannot look clean while it runs", () => {
  const runs = [
    { name: "Sync Postmark atlas", status: "in_progress", conclusion: null, created_at: "T3" },
    { name: "Sync Postmark atlas", status: "completed", conclusion: "failure", created_at: "T2" },
    { name: "Sync Postmark atlas", status: "completed", conclusion: "success", created_at: "T1" },
    { name: "Deploy (snapshot -> dev, release -> prod)", status: "completed", conclusion: "success", created_at: "T2" },
  ];
  const latest = latestDecisiveRunPerWorkflow(runs);
  assert.equal(latest.get("Sync Postmark atlas").conclusion, "failure");
  assert.equal(latest.size, 2);
});

test("a cancellation ON TOP OF a failure must not turn the failure green — the live shape of 2026-08-25", () => {
  // ⚑ THE REGRESSION THIS EXISTS FOR. The first version of the probe took the
  // newest COMPLETED run and called `cancelled` healthy. Run against the live
  // town at 23:09Z on 2026-08-25 — with "Sync Postmark atlas" failing on every
  // run for hours — the newest completed run of BOTH workflows was a
  // cancellation, so the board came back all-green and the sentinel said
  // nothing whatsoever about the fire it was built for.
  //
  // "how can we LOUDLY BE NOTIFIED when something is down on the site?" — not
  // if a concurrency group can silence the answer.
  const runs = [
    { name: "Sync Postmark atlas", status: "completed", conclusion: "cancelled", created_at: "2026-08-25T22:41:34Z" },
    { name: "Sync Postmark atlas", status: "completed", conclusion: "failure", created_at: "2026-08-25T22:42:41Z", html_url: "https://x/runs/32907437534" },
    { name: "Deploy (snapshot -> dev, release -> prod)", status: "completed", conclusion: "cancelled", created_at: "2026-08-25T22:42:42Z" },
    { name: "Deploy (snapshot -> dev, release -> prod)", status: "completed", conclusion: "success", created_at: "2026-08-25T22:39:33Z" },
  ];
  const rows = classifyWorkflows(latestDecisiveRunPerWorkflow(runs));
  assert.equal(rows.find((r) => r.workflow.startsWith("Sync")).verdict, "DOWN", "the cancellation must be looked THROUGH to the failure beneath it");
  assert.equal(rows.find((r) => r.workflow.startsWith("Deploy")).verdict, "OK", "and looked through to the success beneath it, too — transparency both ways");
});

test("a red workflow is a finding EVEN WHEN every outcome is green — the 2026-08-25 shape, verbatim", () => {
  // On 2026-08-25 the site answered 200 everywhere and served the current
  // daily, while "Sync Postmark atlas" had failed on every run for hours. The
  // outcome probes were correct to say nothing. This probe is why the town
  // still finds out.
  const runs = [
    { name: "Sync Postmark atlas", status: "completed", conclusion: "failure", created_at: "2026-08-25T22:42:41Z", html_url: "https://github.com/x/y/actions/runs/32907437534" },
    { name: "Deploy (snapshot -> dev, release -> prod)", status: "completed", conclusion: "success", created_at: "2026-08-25T22:44:59Z" },
  ];
  const rows = classifyWorkflows(latestDecisiveRunPerWorkflow(runs));
  const sync = rows.find((r) => r.workflow.startsWith("Sync"));
  const deploy = rows.find((r) => r.workflow.startsWith("Deploy"));
  assert.equal(sync.verdict, "DOWN");
  assert.match(sync.reason, /32907437534/, "the reason must carry the run link, or the reader cannot go look");
  assert.equal(deploy.verdict, "OK", "the green sibling must stay green — this probe reports each workflow, it does not average them");
});

test("nothing but cancellations is UNKNOWN, never OK — 'nobody has checked' must not render as 'checked and fine'", () => {
  const rows = classifyWorkflows(latestDecisiveRunPerWorkflow([
    { name: "Sync Postmark atlas", status: "completed", conclusion: "cancelled", created_at: "T2" },
    { name: "Sync Postmark atlas", status: "completed", conclusion: "skipped", created_at: "T1" },
    { name: "Sync Postmark atlas", status: "in_progress", conclusion: null, created_at: "T3" },
  ]));
  const sync = rows.find((r) => r.workflow.startsWith("Sync"));
  assert.equal(sync.verdict, "UNKNOWN");
  assert.match(sync.reason, /nothing has been decided/);
  // And a workflow with no runs at all in the window is UNKNOWN too, never green.
  assert.equal(rows.find((r) => r.key === "workflow_deploy").verdict, "UNKNOWN");
});

// ── the edge-triggered machine ──────────────────────────────────────────────

test("LOUDLY BE NOTIFIED: the alert fires on the transition into bad, including a cold start into an outage", () => {
  // "how can we LOUDLY BE NOTIFIED when something is down on the site?"
  const onset = transition({ prev: { verdict: "OK", reason: "HTTP 200", since: T0 - HOUR, last_alert_at: null }, next: { verdict: "DOWN", reason: "HTTP 502" }, nowMs: T0 });
  assert.ok(onset.alert, "a good->bad transition MUST alert, or nothing is notified at all");
  assert.equal(onset.alert.kind, "onset");
  assert.equal(onset.state.since, T0);

  // A sentinel that boots into an existing outage and says nothing has failed
  // at its only job — so never-seen -> bad alerts too.
  const cold = transition({ prev: null, next: { verdict: "DOWN", reason: "HTTP 502" }, nowMs: T0 });
  assert.ok(cold.alert);
  assert.equal(cold.alert.kind, "onset");
});

test("no repeat alert within the reminder window, and exactly one when it elapses", () => {
  // Loud is not frequent. A ping every ten minutes is wallpaper, the reader
  // mutes the channel, and a muted channel reproduces the original silence.
  const bad = { verdict: "DOWN", reason: "HTTP 502", since: T0, last_alert_at: T0 };

  const soon = transition({ prev: bad, next: { verdict: "DOWN", reason: "HTTP 502" }, nowMs: T0 + 10 * MINUTE });
  assert.equal(soon.alert, null, "still bad ten minutes later must be SILENT");
  assert.equal(soon.state.since, T0, "the since-clock must survive the silence");
  assert.equal(soon.state.last_alert_at, T0, "and so must the last-alert clock, or the reminder never comes");

  const justUnder = transition({ prev: bad, next: { verdict: "DOWN", reason: "HTTP 502" }, nowMs: T0 + 12 * HOUR - MINUTE });
  assert.equal(justUnder.alert, null);

  const due = transition({ prev: bad, next: { verdict: "DOWN", reason: "HTTP 502" }, nowMs: T0 + 12 * HOUR });
  assert.equal(due.alert.kind, "reminder");
  assert.equal(due.state.last_alert_at, T0 + 12 * HOUR);

  // And the reminder does not restart: twelve hours after the REMINDER, not
  // twelve hours after the onset.
  const after = transition({ prev: due.state, next: { verdict: "DOWN", reason: "HTTP 502" }, nowMs: T0 + 13 * HOUR });
  assert.equal(after.alert, null);
});

test("recovery says so, and a change of failure is not the same failure", () => {
  const bad = { verdict: "DOWN", reason: "HTTP 502", since: T0, last_alert_at: T0 };

  const back = transition({ prev: bad, next: { verdict: "OK", reason: "HTTP 200" }, nowMs: T0 + 34 * MINUTE });
  assert.equal(back.alert.kind, "recovered");
  assert.equal(back.alert.downFor, 34 * MINUTE);
  assert.equal(back.state.last_alert_at, T0 + 34 * MINUTE);

  // DOWN becoming STALE is new information about what is wrong. Suppressing it
  // because "it was already bad" hides a change of failure behind a sameness of
  // mood.
  const changed = transition({ prev: bad, next: { verdict: "STALE", reason: "index frozen 2h" }, nowMs: T0 + HOUR });
  assert.equal(changed.alert.kind, "changed");
  assert.equal(changed.alert.from, "DOWN");
  assert.equal(changed.state.since, T0 + HOUR, "a different failure starts its own clock");
});

test("INFO and UNKNOWN never alert — an Access-gated door and an unreadable reference are not site outages", () => {
  assert.equal(transition({ prev: { verdict: "OK", since: T0 }, next: { verdict: "INFO", reason: "gated" }, nowMs: T0 }).alert, null);
  assert.equal(transition({ prev: null, next: { verdict: "UNKNOWN", reason: "GitHub did not answer" }, nowMs: T0 }).alert, null);
  // But going bad -> UNKNOWN must not silently read as recovered either.
  const murky = transition({ prev: { verdict: "DOWN", reason: "502", since: T0, last_alert_at: T0 }, next: { verdict: "UNKNOWN", reason: "unreadable" }, nowMs: T0 + HOUR });
  assert.equal(murky.alert, null);
  assert.equal(murky.state.verdict, "UNKNOWN");
});

// ── the message and the board ───────────────────────────────────────────────

test("the Discord message is plain prose with no markdown table, and names what/since/why", () => {
  const board = composeBoard({ probes: [{ key: "a", label: "x", verdict: "DOWN", reason: "r" }], nowIso: "2026-08-25T12:00:00Z", alerting: {} });
  const msg = composeMessage({
    nowIso: "2026-08-25T12:00:00Z",
    board,
    alerts: [
      { label: "the Daily page", alert: { kind: "onset", verdict: "DOWN", reason: "HTTP 502 — the server broke", since: T0 - 20 * MINUTE } },
      { label: "the office's read index", alert: { kind: "recovered", verdict: "OK", reason: "matches main", since: T0 - HOUR, downFor: 90 * MINUTE } },
    ],
  });
  // Discord renders markdown tables as garbage, so the loudest message must
  // never be the least readable one.
  assert.ok(!msg.includes("|---"), "no markdown table separators");
  assert.ok(!/^\s*\|/m.test(msg), "no markdown table rows");
  assert.match(msg, /DOWN — the Daily page: HTTP 502/);
  assert.match(msg, /RECOVERED — the office's read index is healthy again after 1h30m/);

  assert.equal(composeMessage({ alerts: [], board, nowIso: "x" }), null, "nothing to say means nothing is sent");
});

test("the board carries one headline line the operator round can read without reducing the array itself", () => {
  const probes = [
    { key: "a", label: "home", verdict: "OK", reason: "HTTP 200" },
    { key: "b", label: "daily", verdict: "DOWN", reason: "HTTP 502" },
    { key: "c", label: "dev", verdict: "INFO", reason: "gated" },
  ];
  const board = composeBoard({ probes, nowIso: "2026-08-25T12:00:00Z", alerting: { configured: true } });
  assert.equal(board.status, "DOWN");
  assert.match(board.headline, /^DOWN · /);
  assert.equal(board.counts.OK, 1);
  assert.equal(board.probes.length, 3);

  assert.equal(composeBoard({ probes: [{ verdict: "OK" }, { verdict: "STALE" }], nowIso: "x", alerting: {} }).status, "STALE");
  assert.equal(composeBoard({ probes: [{ verdict: "OK" }, { verdict: "UNKNOWN" }], nowIso: "x", alerting: {} }).status, "DEGRADED");
  assert.equal(composeBoard({ probes: [{ verdict: "OK" }, { verdict: "INFO" }], nowIso: "x", alerting: {} }).status, "OK");
});

// ── the whole tick, and the loud degradation ────────────────────────────────

/**
 * A fetch stub that answers by URL prefix, LONGEST PREFIX WINS.
 *
 * The "longest" is not a nicety — the first version matched in insertion order,
 * so `https://postmark.town/` shadowed `https://postmark.town/daily/` and every
 * outage this file installs on the Daily page came back green. The apparatus
 * needs its own falsifier as much as the code does.
 *
 * Anything unlisted 404s through the probe path rather than throwing, so a test
 * that forgets a door gets a legible verdict instead of a stack trace.
 */
function stubFetch(table) {
  return async (url) => {
    const hit = Object.entries(table)
      .filter(([k]) => String(url).startsWith(k))
      .sort((a, b) => b[0].length - a[0].length)[0];
    const r = hit ? hit[1] : { status: 404, body: "" };
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      headers: { get: (h) => (r.headers ?? {})[String(h).toLowerCase()] ?? null },
      text: async () => r.body ?? "",
      json: async () => JSON.parse(r.body ?? "null"),
    };
  };
}

const GREEN_TABLE = {
  // T0 is 2026-08-25T12:00:00Z, which IS the start of crossing 149 (the town
  // clock: 12h since 2026-06-12) — the same crossing DAILY_MD above names, so
  // the whole green fixture describes one coherent moment in the town.
  "https://postmark.town/api/": { status: 200, headers: { "x-postmark-as-of": "towntip0000" }, body: JSON.stringify({ crossing: { number: 149 } }) },
  "https://postmark.town/build.json": { status: 200, body: JSON.stringify({ channel: "release", code_sha: "relsha00000", town_data_sha: "sitetip0000", crossing: 149 }) },
  "https://postmark.town/daily/ferrys-daily.html": { status: 200, body: `<h2>"An arithmetic that balances is not an arithmetic that agrees"</h2>` },
  "https://raw.githubusercontent.com/postmark-town/postmark/main/TOWN_BULLETIN/ferrys-daily.md": { status: 200, body: DAILY_MD },
  "https://api.github.com/repos/postmark-town/postmark/commits": { status: 200, body: JSON.stringify([{ commit: { committer: { date: "2026-08-25T06:00:00Z" } } }]) },
  // One read per watched workflow, by its file (the false DOWN of 2026-09-29).
  "https://api.github.com/repos/postmark-town/postmark-site/actions/workflows/deploy.yml/runs": {
    status: 200,
    body: JSON.stringify({ workflow_runs: [
      { name: "Deploy (snapshot -> dev, release -> prod)", status: "completed", conclusion: "success", created_at: "2026-08-25T11:44:00Z" },
    ] }),
  },
  // §13: every handler repo's newest finished run succeeded, so no jobs are read.
  ...Object.fromEntries(CONFIG.linearHandler.repos.map((repo) => [
    `https://api.github.com/repos/postmark-town/${repo}/actions/workflows/linear-handler.yml/runs`,
    { status: 200, body: JSON.stringify({ total_count: 1, workflow_runs: [{ id: 1, run_attempt: 1, status: "completed", conclusion: "success", created_at: "2026-08-25T11:30:00Z", html_url: `https://github.com/postmark-town/${repo}/actions/runs/1` }] }) },
  ])),
  "https://postmark.town/": { status: 200, body: "<html/>" },
  "https://dev.postmark.town/": { status: 302, headers: { location: "https://x.cloudflareaccess.com/cdn-cgi/access/login/dev.postmark.town" }, body: "" },
};

// §14–§19 (POS-968) read the box's journal, its failed units and the certificates nginx serves through `exec`, the
// seam every tick here already drives, so stubExec answers journalctl, systemctl and openssl as well: green unless a
// test hands it something else. The journal is one ordinary office line five minutes before the fixed clock, so the
// reader can see the journal and nothing in it is a kill or a trip.
const JOURNAL_LINE = (atMs, message) => JSON.stringify({ __REALTIME_TIMESTAMP: String(Math.round(atMs * 1000)), MESSAGE: message });
const GREEN_JOURNAL = [JOURNAL_LINE(T0 - 5 * MINUTE, "[office] index reloaded — as-of 17338e0a6fc1 (was 1939f69d30e6)")];
// A self-signed certificate naming every host CONFIG.certs lists, valid to 2036-11-06, made for this suite with
// openssl (its key was not kept). The §16 tests read its notAfter back rather than restate it.
const FIXTURE_CERT = `-----BEGIN CERTIFICATE-----
MIICfTCCAiOgAwIBAgIUf1CX4pSWYXZAjyBCajjusMLJ1+YwCgYIKoZIzj0EAwIw
GDEWMBQGA1UEAwwNcG9zdG1hcmsudG93bjAeFw0yNjExMDkwMDM3MjNaFw0zNjEx
MDYwMDM3MjNaMBgxFjAUBgNVBAMMDXBvc3RtYXJrLnRvd24wWTATBgcqhkjOPQIB
BggqhkjOPQMBBwNCAAR/xG4W6jgtqrlVmU02VdrdxeNYXdgk7T+K7FU6l9JOczlg
TW/CcnTNV/8d5qNxGi9QBrx8qiR1d9MHS+yC7p5Xo4IBSTCCAUUwHQYDVR0OBBYE
FM+gMY6hAXZL+u93/wwgc2hDMqP/MB8GA1UdIwQYMBaAFM+gMY6hAXZL+u93/wwg
c2hDMqP/MA8GA1UdEwEB/wQFMAMBAf8wgfEGA1UdEQSB6TCB5oINcG9zdG1hcmsu
dG93boIRd3d3LnBvc3RtYXJrLnRvd26CEWRldi5wb3N0bWFyay50b3dughNwYW5l
cy5wb3N0bWFyay50b3duggoxZjRlZS50b3dugg53d3cuMWY0ZWUudG93boIMbWVl
cG8ub25saW5lghB3d3cubWVlcG8ub25saW5lghBzdGFyc3Rvcnkub25saW5lghR3
d3cuc3RhcnN0b3J5Lm9ubGluZYIYc3RhcmZvcmdlLWF0ZWxpZXIub25saW5lghx3
d3cuc3RhcmZvcmdlLWF0ZWxpZXIub25saW5lMAoGCCqGSM49BAMCA0gAMEUCIQC4
cuxAM6Xia/TncaM2Bh0rgaCUTHuD4Sm+jemajt6wrQIgNN2ADkNgFgJslXW/8A9I
NORGYmukSt2nuNeUaWIjCDg=
-----END CERTIFICATE-----`;
// What `openssl s_client` prints on stdout around the server's certificate, in the shape the box's openssl 3 prints it.
const S_CLIENT = (pem) => `CONNECTED(00000003)\n---\nCertificate chain\n---\nServer certificate\n${pem}\nsubject=CN = postmark.town\nissuer=CN = postmark.town\n---\n`;

// git ls-remote, stubbed: main tip, then the release tag list.
// The world's settlement tags too (§11): annotated, so each lists twice, and the
// newest by number is S50, peeled to `settleSha` — the fixture receipt's world.
// And the box's three readers for §14–§19 (above): `journal` is journalctl's json lines, `failed` is systemctl's
// failed-units text, and `cert(host)` is the PEM openssl prints for a host, or an Error it dies with.
const stubExec = ({ siteTip = "sitetip0000", townTip = "towntip0000", relSha = "relsha00000", settleSha = "worldtip0000", journal = GREEN_JOURNAL, failed = "", cert = () => FIXTURE_CERT } = {}) =>
  (_bin, args) => {
    if (_bin === "journalctl") return journal.map((l) => `${l}\n`).join("");
    if (_bin === "systemctl") return failed;
    if (_bin === "openssl") {
      const c = cert(args[args.indexOf("-servername") + 1]);
      if (c instanceof Error) throw c;
      return S_CLIENT(c);
    }
    const repo = args.find((a) => a.startsWith("https://")) ?? "";
    if (repo.includes("postmark-world")) {
      return [
        "tagobj49\trefs/tags/settlement/S49", "older0049\trefs/tags/settlement/S49^{}",
        "tagobj50\trefs/tags/settlement/S50", `${settleSha}\trefs/tags/settlement/S50^{}`,
      ].join("\n") + "\n";
    }
    if (args.includes("--tags")) return `${relSha}\trefs/tags/release/2026-w35.1\n`;
    return repo.includes("postmark-site") ? `${siteTip}\trefs/heads/main\n` : `${townTip}\trefs/heads/main\n`;
  };

// §6 fixture: a real temp state file with a fresh mtime, so the healthy tick
// exercises the watcher probe instead of skipping it, and a config that points
// the sentinel at it rather than at the box's /srv paths.
import { writeFileSync as _wf } from "node:fs";
import { CONFIG as _CFG } from "../tools/site-sentinel.mjs";
const _wdir = tempDir("sentinel-watcher-");
const _wstate = join(_wdir, "state.json");
_wf(_wstate, "{}");
import { utimesSync as _ut } from "node:fs";
// pin the mtime relative to the tests' fixed clock, so the probe's verdict is
// deterministic instead of riding the wall clock the rest of the suite avoids
_ut(_wstate, new Date((T0 - 5 * 60_000)), new Date((T0 - 5 * 60_000)));
// §7 fixture, same discipline: a real temp report with a published outcome, so
// the healthy tick EXERCISES the refresh probe rather than skipping it — and so
// the suite does not read /srv/postmark-harbor/site-refresh.json, whose verdict
// would otherwise ride whatever the box last published. This suite runs on the
// box too.
const _rrep = join(_wdir, "site-refresh.json");
_wf(_rrep, JSON.stringify({
  at: new Date(T0 - 4 * 60_000).toISOString(),
  status: "published",
  town_sha: "9468d6e3419b1c6b03d10c82cd19ff6c0a1917a4",
  site_main: "26d75407b7cc9bfb7bf79008a23380d217939d49",
  release_tag: "release/2026-w38.2",
  published: "/srv/postmark-site-refresh/releases/20260917T081659Z-9468d6e3",
  passes: 2,
  detail: "converged after 2 pass(es) at town 9468d6e3",
}, null, 1));
// §8 fixture, same discipline again: a real, clean git clone in a temp dir, so
// the healthy tick EXERCISES the clone probe — and the suite never reads the
// box's own /srv/postmark-office/town-clone when it runs there.
import { execFileSync as _ex } from "node:child_process";
const _clone = join(_wdir, "town-clone");
_ex("git", ["init", "-q", "-b", "main", _clone]);
_wf(join(_clone, "ledger.md"), "line\n");
_ex("git", ["-C", _clone, "add", "ledger.md"]);
_ex("git", ["-C", _clone, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "seed"]);
// §9 fixture: the disk is read through an injected reader, so the suite's
// verdicts never ride the disk of whatever machine runs it (CI's or the box's).
const GREEN_DISK = () => ({ path: "/", usedPct: 62, freeBytes: 14 * 2 ** 30 });
// §10 fixture: a real temp meeps record, written a minute before the fixed
// clock, so the healthy tick exercises the probe and never reads the box's
// /srv/postmark-sentinel/meeps.json. Its window is 6h IN THE FIXTURE ONLY, for
// the same reason the watcher's is: tests that walk the clock forward must not
// trip it; its own verdicts are pinned in §10 below.
const _meeps = join(_wdir, "meeps.json");
_wf(_meeps, JSON.stringify({ schema: 1, generated_at: new Date(T0 - 60_000).toISOString(), status: "OK", summary: "all 9 meeps answering; every round due in the last 3 h fired", problems: [], meeps: {} }));
// §11 fixture, same discipline: a real temp settlement receipt from the 06:00Z
// sweep before the fixed clock, published to the world S50 peels to, so the
// healthy tick exercises the probe and never reads the box's own
// /srv/postmark-harbor/settlement-auto.json.
const _settle = join(_wdir, "settlement-auto.json");
_wf(_settle, JSON.stringify({ at: "2026-08-25T06:00:02Z", status: "published", world_from: "worldprev000", world_to: "worldtip0000", refusal: null, detail: "3 published" }));
// §12 fixture, same discipline: a real temp law pen state, an ok run a minute
// before the fixed clock, so the healthy tick exercises the probe and never
// reads the box's own /srv/world2-lab/state/ingest-law.json. 6h IN THE FIXTURE
// ONLY, for the clock-walking tests; its own verdicts are pinned in §12 below.
const _law = join(_wdir, "ingest-law.json");
_wf(_law, JSON.stringify({ at: new Date(T0 - 60_000).toISOString(), mode: "law", status: "ok", law: { exit: 0, sha: "a".repeat(40) }, detail: "law: ingested law" }));
// §14, §15 and §18 fixtures (POS-968), same discipline: real temp files, so the healthy tick exercises each probe and
// the suite never reads the box's own /srv files. The store watch looks every minute and the access log carries the
// sentinel's own GET /api/ every five, from an hour before the fixed clock to three hours after it, so the tests that
// walk the clock forward always find a fresh minute and a fresh line (each probe reads nothing past its own clock).
// The backup shipped at 08:00Z, four hours before it.
const _txn = join(_wdir, "store-txn-4380.json");
const TXN_MINUTE = (atMs, over = {}) => ({ at: new Date(atMs).toISOString(), looked: true, stuck: 0, stuck_sessions: [], sessions: { idle: 24, active: 1 }, ...over });
const TXN_RECORD = (minutes) => JSON.stringify({ stuck_after_s: 5, judged_on: "a minute is calm when …", started_at: new Date(T0 - 2 * HOUR).toISOString(), calm_at: minutes.at(-1).at, last_minute: minutes.at(-1), worst_24h: null, minutes }, null, 1);
_wf(_txn, TXN_RECORD(Array.from({ length: 240 }, (_, i) => TXN_MINUTE(T0 - HOUR + i * MINUTE))));
const _access = join(_wdir, "telemetry");
const ACCESS_LINE = (startMs, over = {}) => JSON.stringify({ ts: new Date(startMs).toISOString(), ip: "127.0.0.1", method: "GET", path: "/", status: 200, ms: 4, ua: "postmark-site-sentinel", household: null, mcp: null, ...over });
import { mkdirSync as _mk } from "node:fs";
_mk(_access, { recursive: true });
_wf(join(_access, "access-2026-08-25.jsonl"), Array.from({ length: 48 }, (_, i) => ACCESS_LINE(T0 - HOUR + i * 5 * MINUTE)).join("\n") + "\n");
const _backup = join(_wdir, "backup.json");
const BACKUP = (over = {}) => JSON.stringify({ at: "2026-08-25T08:00:00Z", status: "shipped", database: "world2_dev", dump_bytes: 117391155, toc_entries: 444, basebackup_ok: true, ...over });
_wf(_backup, BACKUP());
const FIXTURE_CONFIG = {
  ..._CFG,
  storeHealth: { ..._CFG.storeHealth, path: _txn },
  accessLog: { dir: _access },
  backup: { ..._CFG.backup, path: _backup },
  lawPen: { ..._CFG.lawPen, path: _law, staleAfterMs: 6 * 60 * 60_000 },
  settlement: { ..._CFG.settlement, receipt: _settle },
  clones: [{ key: "town_clone", label: "the office's town clone", path: _clone }],
  watchers: [{ key: "usdc_watch", label: "the usdc-watch timer", state: _wstate, cadenceMs: 6 * 60 * 60_000 }],
  siteRefresh: { ..._CFG.siteRefresh, report: _rrep, cadenceMs: 6 * 60 * 60_000 },
  meeps: { ..._CFG.meeps, path: _meeps, staleAfterMs: 6 * 60 * 60_000 },
};
// cadence is 6h IN THE FIXTURE ONLY: the LOUDLY test advances its clock ~1h to
// exercise held-alert semantics, and the watcher must stay inside its window
// across that whole timeline — its own verdicts are covered by the four
// classifyWatcher tests above, not by riding along here.

test("a healthy tick is entirely green and says nothing", async () => {
  const { probes, alerts } = await tick({ token: FIXTURE_TOKEN, fetchImpl: stubFetch(GREEN_TABLE), exec: stubExec(), state: {}, nowMs: T0, config: FIXTURE_CONFIG, readDisk: GREEN_DISK });
  const bad = probes.filter((p) => p.verdict !== "OK" && p.verdict !== "INFO");
  assert.deepEqual(bad.map((p) => `${p.key}:${p.verdict} ${p.reason}`), [], "a green town must produce no findings");
  assert.equal(alerts.length, 0, "and therefore nothing to say");
});

test("LOUDLY BE NOTIFIED: an outage and a frozen index both surface from one tick, with reasons a reader can act on", async () => {
  // "how can we LOUDLY BE NOTIFIED when something is down on the site?"
  const broken = {
    ...GREEN_TABLE,
    "https://postmark.town/daily/": { status: 502, body: "" },
    // the office answers, but with an index that has not moved
    "https://postmark.town/api/": { status: 200, headers: { "x-postmark-as-of": "frozen00000" }, body: "{}" },
  };
  const state = { probes: {}, stamps: { office_as_of: { value: "frozen00000", first_seen_at: T0 - 2 * HOUR, diverged_since: T0 - 2 * HOUR } } };
  const { probes, alerts } = await tick({ token: FIXTURE_TOKEN, fetchImpl: stubFetch(broken), exec: stubExec(), state, nowMs: T0, config: FIXTURE_CONFIG, readDisk: GREEN_DISK });

  const daily = probes.find((p) => p.key === "site_daily");
  assert.equal(daily.verdict, "DOWN");
  const index = probes.find((p) => p.key === "office_as_of");
  assert.equal(index.verdict, "STALE");
  assert.match(index.reason, /2h/);

  const keys = alerts.map((a) => a.key).sort();
  assert.deepEqual(keys, ["office_as_of", "site_daily"], "both must alert, and nothing else may");
});

test("env-missing degrades LOUDLY: every reading is still taken, the board is still written, and it says nothing was sent", async () => {
  const dir = tempDir("sentinel-degrade-");
  const statePath = join(dir, "state.json");
  const outPath = join(dir, "status.json");
  const errs = [];

  const { board, message } = await run({
    argv: ["node", "site-sentinel.mjs", "--state", statePath, "--out", outPath],
    env: {},                       // no SENTINEL_DISCORD_WEBHOOK, no token file
    fetchImpl: stubFetch({ ...GREEN_TABLE, "https://postmark.town/daily/": { status: 502, body: "" } }),
    exec: stubExec(),
    nowMs: T0,
    log: () => {},
    errLog: (m) => errs.push(String(m)),
  });

  // It said so, out loud, on stderr.
  assert.ok(errs.some((e) => /LOUD DEGRADATION/.test(e) && /SENTINEL_DISCORD_WEBHOOK/.test(e)), "stderr must name the missing variable");
  // The alert text is not lost — an undeliverable alert still reaches the journal.
  assert.ok(errs.some((e) => /DOWN — the Daily page/.test(e)), "the undelivered alert must still be printed in full");
  assert.ok(message.includes("DOWN"));

  // Every reading was still taken, and the board still landed on disk.
  assert.ok(existsSync(outPath), "the board must be written even with no channel");
  const written = JSON.parse(readFileSync(outPath, "utf8"));
  assert.equal(written.status, "DOWN");
  assert.equal(written.alerting.configured, false);
  assert.match(written.alerting.note, /SENTINEL_DISCORD_WEBHOOK is unset/);
  assert.match(written.alerting.note, /NOTHING WAS SENT/, "the board itself must say the channel was silent, or a reader trusts a board nobody was told about");
  assert.ok(written.probes.length >= 8);

  // And the state advanced, so the next tick does not re-announce this onset.
  const st = JSON.parse(readFileSync(statePath, "utf8"));
  assert.equal(st.probes.site_daily.verdict, "DOWN");
  assert.equal(st.probes.site_daily.last_alert_at, T0);
});

test("alertingStatus is data, not a side effect", () => {
  assert.equal(alertingStatus({ SENTINEL_DISCORD_WEBHOOK: "https://discord.com/api/webhooks/x" }).status.configured, true);
  assert.equal(alertingStatus({}).status.configured, false);
  assert.equal(alertingStatus({ SENTINEL_DISCORD_WEBHOOK: "" }).status.configured, false, "an empty string is not a channel");
});

test("no /build.json means UNKNOWN and a note naming the fix — never a green site-freshness verdict", async () => {
  const noStamp = { ...GREEN_TABLE };
  delete noStamp["https://postmark.town/build.json"];
  const { probes, notes } = await tick({ token: FIXTURE_TOKEN, fetchImpl: stubFetch(noStamp), exec: stubExec(), state: {}, nowMs: T0 });
  assert.equal(probes.find((p) => p.key === "site_code").verdict, "UNKNOWN");
  assert.equal(probes.find((p) => p.key === "site_town_data").verdict, "UNKNOWN");
  assert.ok(notes.some((n) => /build-stamp\.mjs/.test(n)), "the note must name where the fix lives");
});

test("prod's code is compared against the RELEASE TAG, not main — lagging main is the design, not an outage", async () => {
  // deploy.yml's release lane checks out the newest release/* tag and builds
  // code from there. Comparing that code against main's tip would report a
  // permanent, meaningless STALE and teach the reader to ignore the channel.
  const exec = stubExec({ siteTip: "mainmoved00", relSha: "relsha00000" });
  // Both halves are seeded as long-held: a cold start is quiet by design, so a
  // test that wants the STALE branch must supply the memory that earns it.
  const state = { stamps: {
    site_code: { value: "relsha00000", first_seen_at: T0 - 5 * HOUR, diverged_since: T0 - 5 * HOUR },
    site_town_data: { value: "sitetip0000", first_seen_at: T0 - 5 * HOUR, diverged_since: T0 - 5 * HOUR },
  } };
  const { probes } = await tick({ token: FIXTURE_TOKEN, fetchImpl: stubFetch(GREEN_TABLE), exec, state, nowMs: T0 });

  const code = probes.find((p) => p.key === "site_code");
  assert.equal(code.verdict, "OK", "code pinned to the newest release tag is correct, however far main has run ahead");
  assert.match(code.reason, /release tag/);

  // THE CONTROL: the town-data half of the same stamp IS compared against main,
  // and it is the half that froze on 2026-08-24 ("prod served Crossing 144
  // while main carried 146") behind a correctly-pinned code sha.
  const data = probes.find((p) => p.key === "site_town_data");
  assert.equal(data.verdict, "STALE");
  assert.match(data.reason, /main/);
});

test("lsRemote and newestReleaseTag read the wire protocol, and answer null rather than throwing", () => {
  const exec = () => "abc123\trefs/heads/main\n";
  assert.equal(lsRemote("https://x/y.git", "main", { exec }), "abc123");

  const tags = () => [
    "s1\trefs/tags/release/2026-w34",
    "s2\trefs/tags/release/2026-w35.1",
    "s3\trefs/tags/release/2026-w35",
  ].join("\n") + "\n";
  const newest = newestReleaseTag("https://x/y.git", { exec: tags });
  assert.equal(newest.tag, "release/2026-w35.1", "numeric-aware sort, so w35.1 beats w35 and w34");

  // THE ANNOTATED-TAG CASE (2026-08-26, caught live): the wire lists the tag
  // object AND its peeled commit; the deploy checks out the COMMIT, so the
  // probe must answer the peeled sha or it calls a current site stale — which
  // it did, for 9 hours, the morning after release/2026-w35.3 shipped.
  const annotated = () => [
    "tagobj35_3\trefs/tags/release/2026-w35.3",
    "commit35_3\trefs/tags/release/2026-w35.3^{}",
    "s2\trefs/tags/release/2026-w35.1",
  ].join("\n") + "\n";
  const peeled = newestReleaseTag("https://x/y.git", { exec: annotated });
  assert.equal(peeled.tag, "release/2026-w35.3", "the peeled line must not create a phantom second tag");
  assert.equal(peeled.sha, "commit35_3", "an annotated tag answers its PEELED commit, never the tag object");

  const boom = () => { throw new Error("no network"); };
  assert.equal(lsRemote("https://x/y.git", "main", { exec: boom }), null, "an unreachable remote is UNKNOWN upstream, not a crash");
  assert.equal(newestReleaseTag("https://x/y.git", { exec: boom }), null);
});

// ── §6: the watchers' own pulse (added 2026-08-26 after the EACCES crashloop) ──
// The founder's sentence, which these assert: "how can we LOUDLY BE NOTIFIED
// when something is down" — and on 2026-08-26 usdc-watch crash-looped on
// EACCES for 22 hours behind an all-green board, because no probe asked
// whether the watchers themselves were alive.
import { classifyWatcher } from "../tools/site-sentinel.mjs";

test("an enabled watcher with NO state file is DOWN — a crashloop, never a quiet rail", () => {
  const r = classifyWatcher({ exists: false, nowMs: 1000, cadenceMs: 600_000, label: "the usdc-watch timer" });
  assert.equal(r.verdict, "DOWN");
  assert.match(r.reason, /never run or cannot write/);
});

test("a watcher silent past 3x its cadence is STALE", () => {
  const now = 10_000_000;
  const r = classifyWatcher({ exists: true, mtimeMs: now - 31 * 60_000, nowMs: now, cadenceMs: 600_000, label: "the usdc-watch timer" });
  assert.equal(r.verdict, "STALE");
});

test("a watcher inside its cadence window is OK", () => {
  const now = 10_000_000;
  const r = classifyWatcher({ exists: true, mtimeMs: now - 8 * 60_000, nowMs: now, cadenceMs: 600_000, label: "the usdc-watch timer" });
  assert.equal(r.verdict, "OK");
});

test("an UNADOPTED Stage-B watcher is INFO — parked is not broken", () => {
  const r = classifyWatcher({ adopted: false, exists: false, nowMs: 1000, cadenceMs: 600_000, label: "the stripe-watch timer" });
  assert.equal(r.verdict, "INFO");
});


// ── §6b: the watch's expectation must match the unit it watches ─────────────

test("every watcher's expected cadence is the cadence its own shipped timer fires at", () => {
  // LAW (tools/site-sentinel.mjs § classifyWatcher, verbatim): a watcher is
  //     STALE when it "last wrote its state ${...} min ago against a ${...}-min
  //     cadence". The sentence is only true if the number it quotes is the
  //     number the unit actually uses.
  //
  // THE DRIFT THIS CAUGHT, live on this branch: stripe_watch was configured at
  // a 10-minute cadence while deploy/postmark-stripe-watch.timer has always
  // fired `OnCalendar=*:7/15`. The tolerance is 3× the cadence, so the watch
  // allowed 30 minutes for a rail that ticks every 15 — ONE missed tick short
  // of alarming, and the reason line it would print names a cadence the box
  // does not run. A probe that cries wolf is a probe the reader mutes, and a
  // muted channel is the silent failure this whole file exists to end.
  //
  // Reading the unit rather than a second constant is the point: these two
  // numbers live in different files and nothing but this test makes them agree.
  const OFFICE = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
  for (const w of _CFG.watchers ?? []) {
    assert.ok(w.unit, `${w.key} names the unit it watches`);
    const unitPath = join(OFFICE, "deploy", w.unit);
    assert.ok(existsSync(unitPath), `${w.unit} is a unit this repo ships`);
    const unit = readFileSync(unitPath, "utf8");
    const m = unit.match(/^OnCalendar=\*:(\d+)\/(\d+)\s*$/m);
    assert.ok(m, `${w.unit} declares an OnCalendar this test can read`);
    const everyMin = Number(m[2]);
    assert.equal(
      w.cadenceMs, everyMin * 60_000,
      `${w.key} expects ${Math.round(w.cadenceMs / 60_000)} min but ${w.unit} fires every ${everyMin} min`,
    );
  }
});


test("a probe PARKED BY DESIGN is admitted in the one line the operator reads", () => {
  // LAW (tools/site-sentinel.mjs § the board, verbatim, on the summary field):
  //     "The one line the operator round reads. Kept as its own field so a
  //     reader never has to reduce the array themselves and get a different
  //     answer."
  //
  // THE HOLE THIS CLOSES. `classifyWatcher` answers INFO for a Stage-B watcher
  // that was never adopted — correctly, because parked-by-design is not a
  // failure. But the summary said `All ${counts.OK} probes green.`, which
  // counted only the OK ones while the word "All" claimed the whole board. So a
  // rail that was built, shipped inert, and then forgotten reported as a clean
  // all-green tick forever — which is precisely the "staged inert, silently, for
  // good" failure the Stage-A/Stage-B split was designed to make impossible.
  //
  // A parked probe must never ALARM (that trains the reader to mute the
  // channel) and must never be INVISIBLE either. Counted, not alarmed.
  const probes = [
    { key: "a", label: "a public door", verdict: "OK", reason: "200" },
    { key: "stripe_watch", label: "the stripe-watch timer", verdict: "INFO", reason: "not adopted (Stage B parked) — nothing to watch yet" },
  ];
  const board = composeBoard({ probes, nowIso: "2026-08-27T12:00:00Z", alerting: {} });

  assert.equal(board.status, "OK", "parked by design is not a failure");
  assert.equal(board.counts.INFO, 1);
  assert.doesNotMatch(board.summary, /^All /, "'All' may not describe a board it did not count");
  assert.match(board.summary, /1 parked/, "the parked probe is named in the line that gets read");

  // and with nothing parked, the old sentence is untouched
  const clean = composeBoard({ probes: [{ key: "a", verdict: "OK" }], nowIso: "x", alerting: {} });
  assert.match(clean.summary, /^All 1 probes green\./);
});

test("a hand-run sentinel prints the parked rails too, not only the broken ones", () => {
  // Same hole, the other surface: the console loop skipped every verdict that
  // was not OK-or-INFO, so an operator running this by hand saw nothing at all
  // about a rail that had never been switched on. The board and the terminal
  // must agree about what is worth saying.
  const src = readFileSync(new URL("../tools/site-sentinel.mjs", import.meta.url), "utf8");
  assert.match(src, /PARKED/, "the console names parked probes");
});


// ── §7: the site refresh's OUTCOME (2026-09-17, postmark-town/postmark#2884) ─
//
// THE INSTANCE. At 08:12:35Z the box published a town with 48 doors missing,
// from a three-week-old committed snapshot. The board read 14 green at
// 08:20:02Z. Nothing on the board was wrong — nothing on it was looking at the
// refresh at all. The refresh writes its own report; this is the probe that
// reads it.
//
// THE REPORT'S SHAPE IS THE BOX'S, NOT ONE INVENTED HERE. Copied from
// /srv/postmark-harbor/site-refresh.json as it stood at 2026-09-17T08:10:00Z,
// which is the run of the instance itself:
//
//   { "at": "2026-09-17T08:10:00Z", "status": "published",
//     "town_sha": "9468d6e3...", "site_main": "26d75407...",
//     "release_tag": "release/2026-w38.2",
//     "published": "/srv/postmark-site-refresh/releases/20260917T081659Z-9468d6e3",
//     "passes": 2, "detail": "converged after 2 pass(es) at town 9468d6e3" }
//
// A STANDING FINDING THAT BELONGS BESIDE THESE TESTS: that report — the
// instance's OWN report — says `published`. The report is written once, at the
// end of a run, and a run whose first pass published short and whose second
// pass converged ends `published`. So THIS PROBE ALONE WOULD HAVE BEEN GREEN
// FOR THE 08:10Z RUN. It is postmark-site#97's exit that makes the pair work: a
// short fetch there dies the run at deploy/site-refresh.sh L428, `die` writes
// `report failed`, and this probe reads it. Neither half is the guard on its
// own, and this comment is here so nobody later reads this probe as one.

import { BAD, classifySiteRefresh } from "../tools/site-sentinel.mjs";

const REFRESH_LABEL = "the box's site refresh";
const CADENCE = 30 * MINUTE;
const NOW = Date.parse("2026-09-17T08:20:00Z");
const freshAt = (minAgo) => NOW - minAgo * MINUTE;
const boxReport = (over = {}) => ({
  at: "2026-09-17T08:10:00Z",
  status: "published",
  town_sha: "9468d6e3419b1c6b03d10c82cd19ff6c0a1917a4",
  site_main: "26d75407b7cc9bfb7bf79008a23380d217939d49",
  release_tag: "release/2026-w38.2",
  published: "/srv/postmark-site-refresh/releases/20260917T081659Z-9468d6e3",
  passes: 2,
  detail: "converged after 2 pass(es) at town 9468d6e3",
  ...over,
});
const classify = (over = {}, { atMinAgo = 10, ...rest } = {}) => classifySiteRefresh({
  exists: true,
  report: boxReport(over),
  atMs: freshAt(atMinAgo),
  mtimeMs: freshAt(atMinAgo),
  nowMs: NOW,
  cadenceMs: CADENCE,
  label: REFRESH_LABEL,
  ...rest,
});

test("§7 FAILED is DOWN, and the report's own detail is the reason VERBATIM", () => {
  // The detail is the sentence the founder reads on Discord and now in the
  // site's header popover, so it may not be summarised, reworded or truncated.
  const detail = "fetch-town.mjs tripped";
  const r = classify({ status: "failed", detail });
  assert.equal(r.verdict, "DOWN");
  assert.ok(r.reason.includes(detail), `the DOWN reason must CONTAIN the report's detail verbatim; got: ${r.reason}`);
  assert.equal(r.detail, detail, "and it rides onto the board so the site's popover can print it");
  assert.ok(BAD.has(r.verdict), "DOWN is in the sentinel's own BAD set, so this alerts and shows on the site");

  // a longer, real-shaped detail survives whole
  const long = "SNAPSHOT SHORT — residents.json keeps 134 rows; the checkout has 182 households; 48 doors are missing from /residents/ until the office answers";
  assert.ok(classify({ status: "failed", detail: long }).reason.includes(long));
});

test("§7 PUBLISHED is OK, and it names the release and how long ago", () => {
  const r = classify({ status: "published" }, { atMinAgo: 3 });
  assert.equal(r.verdict, "OK");
  assert.match(r.reason, /^published 20260917T081659Z-9468d6e3 3 min ago$/,
    `the release dir's own name, not the whole path; got: ${r.reason}`);
  assert.equal(r.detail, "converged after 2 pass(es) at town 9468d6e3");
});

test("§7 QUIET is OK — nothing moved is not nothing working", () => {
  const r = classify({ status: "quiet", published: "", detail: "nothing moved since the last build (town 9468d6e3, release/2026-w38.2)" }, { atMinAgo: 7 });
  assert.equal(r.verdict, "OK");
  assert.match(r.reason, /nothing to publish 7 min ago/);
  assert.match(r.reason, /nothing moved since the last build/);
});

test("§7 NO REPORT AT ALL is INFO — a fresh box is not a broken one", () => {
  const r = classifySiteRefresh({ exists: false, nowMs: NOW, cadenceMs: CADENCE, label: REFRESH_LABEL });
  assert.equal(r.verdict, "INFO");
  assert.ok(!BAD.has(r.verdict), "INFO never alerts — and composeBoard still counts it and names it as parked");
  assert.match(r.reason, /has written no report yet/);
});

test("§7 A STALE `published` IS NOT GREEN — three cadences and the publisher has stopped", () => {
  const ok = classify({}, { atMinAgo: 89 });
  assert.equal(ok.verdict, "OK", "89 minutes is inside three 30-minute cadences");
  const stale = classify({}, { atMinAgo: 91 });
  assert.equal(stale.verdict, "STALE", "91 is not");
  assert.ok(BAD.has(stale.verdict));
  assert.match(stale.reason, /91 min ago/);
  assert.match(stale.reason, /30-min cadence/);
  // AND IT SAYS WHICH STAMP IT MEASURED. An instrument that will not name what
  // it read cannot be checked against the thing it claims to have read.
  assert.match(stale.reason, /its own `at` stamp/);
  const byMtime = classifySiteRefresh({
    exists: true, report: boxReport({ at: "not a date" }),
    atMs: null, mtimeMs: freshAt(120), nowMs: NOW, cadenceMs: CADENCE, label: REFRESH_LABEL,
  });
  assert.equal(byMtime.verdict, "STALE");
  assert.match(byMtime.reason, /the report file's mtime/, "and when the stamp is unreadable it says it fell back");
});

test("§7 A FAILURE OUTRANKS ITS AGE, and the reason carries both clocks", () => {
  // A thing with two clocks needs two numbers (2026-08-25, (vvv)). The founder
  // needs "the last refresh failed"; the operator needs "and nothing has
  // reported since". One verdict, both facts, neither hiding the other.
  const r = classify({ status: "failed", detail: "the site build tripped" }, { atMinAgo: 240 });
  assert.equal(r.verdict, "DOWN", "a failure does not become merely stale by waiting");
  assert.match(r.reason, /the site build tripped/);
  assert.match(r.reason, /nothing has reported since — 240 min/);
});

test("§7 AN UNKNOWN STATUS WORD IS UNKNOWN, NEVER OK — nobody-has-checked must not render as checked-and-fine", () => {
  // The 2026-08-25 cancellation finding, in this file's own words: a value
  // meaning "nothing was decided" was mapped to OK, and the board went
  // all-green on the afternoon the atlas sync was failing on every tick.
  for (const status of ["running", "skipped", "", null, undefined, 0, "PUBLISHED"]) {
    const r = classify({ status });
    assert.equal(r.verdict, "UNKNOWN", `status ${JSON.stringify(status)} must not be read as healthy`);
    assert.match(r.reason, /read as unread rather than as healthy/);
  }
  assert.match(classify({ status: "running" }).reason, /"running"/, "and it quotes the word it actually saw");
  // UNKNOWN is not in BAD (it does not page, by this file's own doctrine) but
  // composeBoard turns it into DEGRADED and says so in the one line read.
  const board = composeBoard({ probes: [{ key: "site_refresh", verdict: "UNKNOWN", reason: "x" }], nowIso: "t", alerting: {} });
  assert.equal(board.status, "DEGRADED");
  assert.match(board.summary, /could not be read/);
});

test("§7 A HALF-WRITTEN REPORT IS UNKNOWN, and reading it throws nothing", () => {
  const r = classifySiteRefresh({ exists: true, report: null, readError: "Unexpected end of JSON input", nowMs: NOW, cadenceMs: CADENCE, label: REFRESH_LABEL });
  assert.equal(r.verdict, "UNKNOWN");
  assert.match(r.reason, /could not be read \(Unexpected end of JSON input\)/);
  assert.equal(r.detail, null);
});

test("§7 the expected cadence is the cadence the shipped timer fires at", () => {
  // Same law as §6b, and the same reason: the two numbers live in different
  // files and nothing but this test makes them agree. The refresh timer does
  // not use the `*:M/N` spelling the §6b reader parses — it is `OnCalendar=*:10,40`,
  // two marks an hour — so this derives the interval from the marks themselves.
  const OFFICE = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
  const sr = _CFG.siteRefresh;
  assert.ok(sr, "the config declares the refresh it watches");
  assert.ok(sr.unit, "and names the unit the cadence comes from");
  const unitPath = join(OFFICE, "deploy", sr.unit);
  assert.ok(existsSync(unitPath), `${sr.unit} is a unit this repo ships`);
  const unit = readFileSync(unitPath, "utf8");
  const m = unit.match(/^OnCalendar=\*:([\d,]+)\s*$/m);
  assert.ok(m, `${sr.unit} declares an OnCalendar this test can read`);
  const marks = m[1].split(",").map(Number);
  assert.ok(marks.length >= 1 && marks.every((n) => Number.isInteger(n) && n >= 0 && n < 60), "the marks are minutes past the hour");
  assert.equal(sr.cadenceMs, (60 / marks.length) * 60_000,
    `the watch expects ${Math.round(sr.cadenceMs / 60_000)} min but ${sr.unit} fires ${marks.length} times an hour (${m[1]})`);
});

test("§7 the probe reaches the BOARD, with its detail, and its first tick says nothing", async () => {
  // End to end through `tick`, against a real temp report — the fixture config
  // above points the probe at it. Two things are asserted that a classifier
  // test cannot: that the probe is IN the probe list at all, and that `detail`
  // survives onto the board entry the site's popover reads.
  const { probes, alerts } = await tick({ token: FIXTURE_TOKEN, fetchImpl: stubFetch(GREEN_TABLE), exec: stubExec(), state: {}, nowMs: T0, config: FIXTURE_CONFIG, readDisk: GREEN_DISK });
  const p = probes.find((x) => x.key === "site_refresh");
  assert.ok(p, "the refresh probe is on the board, beside usdc_watch");
  assert.equal(p.kind, "refresh");
  assert.equal(p.verdict, "OK");
  assert.equal(p.detail, "converged after 2 pass(es) at town 9468d6e3", "the report's detail rides onto the board entry");
  assert.ok(!alerts.some((a) => a.key === "site_refresh"),
    "FIRST TICK, HEALTHY: transition() takes its `prev == null && !alertable` branch and says nothing");

  // and the other side of that same branch: never-seen -> bad DOES fire, because
  // a sentinel that boots into an outage and stays quiet has failed at its job.
  const onset = transition({ prev: null, next: { key: "site_refresh", verdict: "DOWN", reason: "failed: fetch-town.mjs tripped" }, nowMs: T0 });
  assert.equal(onset.alert.kind, "onset");
});

test("§7 the new probe's line reads as a SENTENCE in the Discord message", () => {
  // composeMessage prints `${verdict} — ${label}: ${reason}.` and the label and
  // reason were written to sit in that frame rather than beside it.
  const msg = composeMessage({
    alerts: [{
      key: "site_refresh",
      label: REFRESH_LABEL,
      alert: { kind: "onset", verdict: "DOWN", reason: classify({ status: "failed", detail: "fetch-town.mjs tripped" }).reason, since: NOW },
    }],
    board: { summary: "1 down, 0 stale, 14 green.", published_at: "/srv/postmark-sentinel/status.json" },
    nowIso: "2026-09-17T08:20:00Z",
  });
  assert.match(msg, /DOWN — the box's site refresh: the box's site refresh failed: fetch-town\.mjs tripped\./);
});

// ── §2c the build that published WITH problems (POS-180, 2026-09-21) ────────
//
// Keemin, 2026-09-21: "Could we just let the site publish, but have the
// postmark sentinel bark about the 404?" This is the bark.
//
// The site half (postmark-site POS-180) stops a single named entity's 404 from
// freezing the whole town: the build publishes, the shed thing leaves, a 404'd
// resident keeps the row they had, and the build writes down what it could not
// get. That record only becomes actionable if something reads it — and until
// POS-180 `problems` was assembled by the site's fetch and written to a build
// log nobody reads on a schedule. These falsifiers hold the reading end.

test("a build.json carrying problems REDS the sentinel — a published-with-problems build is a finding", () => {
  const table = {
    ...GREEN_TABLE,
    "https://postmark.town/build.json": {
      status: 200,
      body: JSON.stringify({
        channel: "release", code_sha: "relsha00000", town_data_sha: "sitetip0000", crossing: 149,
        problems: ['residents: the roll named "wright" and the card door answered 404 — the row is HELD OVER'],
      }),
    },
  };
  const p = classifyProblems({ haveStamp: true, problems: ['residents: the roll named "wright" and the card door answered 404 — the row is HELD OVER'] });
  assert.equal(p.verdict, "STALE", "a finding, not an outage — the site is fresh and something in it is not");
  assert.ok(BAD.has(p.verdict), "and STALE is in BAD, so it actually alarms rather than only colouring a board");
  // NAMED, NOT COUNTED: the reason must carry the entity and the door, because
  // "1 problem" tells a reader nothing they can act on.
  assert.match(p.reason, /the roll named "wright"/);
  assert.match(p.reason, /404/);
  return tick({ fetchImpl: stubFetch(table), exec: stubExec(), state: {}, nowMs: T0, config: FIXTURE_CONFIG })
    .then(({ probes, alerts }) => {
      const probe = probes.find((x) => x.key === "site_build_problems");
      assert.ok(probe, "the probe must exist in a real tick, not only as a pure function");
      assert.equal(probe.verdict, "STALE");
      assert.ok(alerts.some((a) => a.key === "site_build_problems"), "and it must reach the alert channel");
    });
});

test("the SAME build.json with an empty problems list does NOT red", () => {
  const table = {
    ...GREEN_TABLE,
    "https://postmark.town/build.json": {
      status: 200,
      body: JSON.stringify({ channel: "release", code_sha: "relsha00000", town_data_sha: "sitetip0000", crossing: 149, problems: [] }),
    },
  };
  assert.equal(classifyProblems({ haveStamp: true, problems: [] }).verdict, "OK");
  return tick({ fetchImpl: stubFetch(table), exec: stubExec(), state: {}, nowMs: T0, config: FIXTURE_CONFIG })
    .then(({ probes, alerts }) => {
      const probe = probes.find((x) => x.key === "site_build_problems");
      assert.equal(probe.verdict, "OK", "a build that got everything it asked for is green, not merely un-alarmed");
      assert.deepEqual(alerts.filter((a) => a.key === "site_build_problems"), []);
    });
});

test("THE DEPLOY-ORDER TRAP: a build.json with NO problems key at all must NOT red", () => {
  // The two repos deploy independently. Between this probe shipping in the
  // office and the `problems` field shipping in postmark-site, EVERY build.json
  // prod serves is keyless — and prod keeps serving the last release for as
  // long as it takes the site's train to land. A probe that alarmed there would
  // page the founder for the whole rollout, about a site that is working
  // correctly, which is precisely the alarm a reader learns to mute.
  //
  // INFO is this file's existing word for a probe that is counted, never
  // alarmed and never silent. UNKNOWN would have been the other candidate and
  // is deliberately NOT used: it would paint the whole board DEGRADED for the
  // duration of an ordinary rollout.
  const keyless = { channel: "release", code_sha: "relsha00000", town_data_sha: "sitetip0000", crossing: 149 };
  assert.equal("problems" in keyless, false, "the fixture must actually be keyless or this proves nothing");
  const p = classifyProblems({ haveStamp: true, problems: keyless.problems });
  assert.equal(p.verdict, "INFO");
  assert.equal(BAD.has(p.verdict), false, "an older stamper is not a fault");
  assert.match(p.reason, /predates/, "and it says WHY, so a reader knows the field is new rather than the site being clean");

  const table = { ...GREEN_TABLE, "https://postmark.town/build.json": { status: 200, body: JSON.stringify(keyless) } };
  return tick({ fetchImpl: stubFetch(table), exec: stubExec(), state: {}, nowMs: T0, config: FIXTURE_CONFIG })
    .then(({ probes, alerts }) => {
      const probe = probes.find((x) => x.key === "site_build_problems");
      assert.equal(probe.verdict, "INFO");
      assert.deepEqual(alerts, [], "a keyless build.json must produce NO alert of any kind");
    });
});

test("`problems: null` is UNREAD, not clean — UNKNOWN, and it never reads as green", () => {
  // The site's stamper writes null when it could not read its own town
  // manifest. Treating that as [] would be a false all-clear arriving exactly
  // when the build had stopped being able to look.
  const p = classifyProblems({ haveStamp: true, problems: null });
  assert.equal(p.verdict, "UNKNOWN");
  assert.equal(BAD.has(p.verdict), false, "unreadable is not itself an alarm");
  assert.notEqual(p.verdict, "OK", "…but it must never be mistaken for a clean build");
  assert.match(p.reason, /unread is never clean/);
  // A shape that is neither list nor null is the same answer, not a crash.
  assert.equal(classifyProblems({ haveStamp: true, problems: "one problem" }).verdict, "UNKNOWN");
  assert.equal(classifyProblems({ haveStamp: true, problems: 3 }).verdict, "UNKNOWN");
});

test("no /build.json at all speaks in its own words rather than vanishing", () => {
  const p = classifyProblems({ haveStamp: false });
  assert.equal(p.verdict, "UNKNOWN");
  assert.match(p.reason, /serves no \/build\.json/);
});

test("the bark names EVERY problem it can and says how many it held back", () => {
  // A held-back remainder that is not counted is a silent truncation, and the
  // reader would act on three when there were nine.
  const nine = Array.from({ length: 9 }, (_, i) => `residents: handle-${i} answered 404`);
  const p = classifyProblems({ haveStamp: true, problems: nine });
  assert.equal(p.verdict, "STALE");
  assert.match(p.reason, /published with 9 problems/);
  assert.match(p.reason, /and 6 more/, "the remainder is counted, never dropped");
  // and the singular reads as English
  assert.match(classifyProblems({ haveStamp: true, problems: ["one thing"] }).reason, /published with 1 problem its build/);
});

// ── the false DOWN of 2026-09-29 ─────────────────────────────────────────────
// The retired atlas sync (dispatch-only since the box took over publishing) was
// still watched, and read from a stale anonymous mixed list: DOWN, citing a run
// from 2026-08-06. The watched set is now named, each with the file its own read
// uses, and the atlas sync is not in it.
test("the sentinel watches Deploy by its workflow file, and no longer the retired atlas sync", async () => {
  const { WATCHED_WORKFLOWS } = await import("../tools/site-sentinel.mjs");
  assert.deepEqual(WATCHED_WORKFLOWS.map((w) => w.name), ["Deploy"]);
  for (const w of WATCHED_WORKFLOWS) assert.match(w.file, /^[a-z0-9-]+\.ya?ml$/, `${w.name} names its workflow file`);
  assert.ok(!WATCHED_WORKFLOWS.some((w) => /atlas/i.test(w.name)), "the atlas sync is dispatch-only; watching it can only raise stale alarms");
});

// ── §9: the ground (POS-556, ONE alarm route) ───────────────────────────────
//
// THE INSTANCE. On 2026-10-09 the root disk filled (38G of 38G): Postgres went
// into crash recovery, sign-in failed and the 08:00 ferry refused, two hours
// before anyone looked. postmark-disk-watch was installed that morning and
// shouted into Discord on its own timer. Darko, 2026-10-10: "make sure we do it
// clean so there's ONE route to get to the Meepo bot on discord that the fleet
// also listens to." The disk is a sentinel probe now, on disk-watch's line.

const GIB = 2 ** 30;

test("§9 THE LINE: 84% is OK, 85% is DOWN, 90% is DOWN — disk-watch's own threshold, carried over", () => {
  const at = (usedPct) => classifyDisk({ usedPct, freeBytes: 5.2 * GIB, limitPct: CONFIG.disk.limitPct });
  assert.equal(CONFIG.disk.limitPct, 85);
  assert.equal(at(84).verdict, "OK");
  assert.equal(at(85).verdict, "DOWN");
  assert.equal(at(90).verdict, "DOWN");
  assert.match(at(84).reason, /84% used, 5\.2G free: under 85%/);
});

test("§9 the DOWN reason names the percent, the free space and where to look first — disk-watch's words", () => {
  const { reason, detail } = classifyDisk({ usedPct: 91, freeBytes: 3.4 * GIB, limitPct: 85 });
  assert.match(reason, /91% used/);
  assert.match(reason, /3\.4G free; alarm at 85%/);
  assert.match(reason, /Look at \/tmp, \/srv\/postmark-site-refresh and \/srv\/world2-lab first/);
  assert.deepEqual(detail, { used_pct: 91, free_bytes: 3.4 * GIB, limit_pct: 85 });
});

test("§9 the percent is df's: used over used-plus-available, root's reserve in neither, rounded UP", () => {
  // 84.01% by the arithmetic is 85% on df, and so DOWN here, exactly where
  // disk-watch's `df --output=pcent` put it.
  const u = diskUsage({ bsize: 4096, blocks: 10_500, bfree: 2_099, bavail: 1_599 });
  assert.equal(u.usedPct, 85);
  assert.equal(u.freeBytes, 1_599 * 4096);
  assert.equal(diskUsage({ bsize: 4096, blocks: 10_500, bfree: 2_100, bavail: 1_600 }).usedPct, 84);
  assert.equal(diskUsage({ bsize: 1, blocks: 0, bfree: 0, bavail: 0 }).usedPct, null, "an empty answer is unread, not 0%");
});

test("§9 an unreadable disk is UNKNOWN and never alerts — and a real read answers a percent", () => {
  const r = readDiskState("/no/such/mount", { statfs: () => { throw new Error("ENOENT"); } });
  assert.equal(r.error, "ENOENT");
  assert.equal(classifyDisk({ ...r, limitPct: 85 }).verdict, "UNKNOWN");
  assert.equal(classifyDisk({ usedPct: null }).verdict, "UNKNOWN");
  const live = readDiskState(".");
  assert.ok(Number.isInteger(live.usedPct) && live.usedPct >= 0 && live.usedPct <= 100, `statfs on this machine answered ${JSON.stringify(live)}`);
});

test("§9 a full disk reaches the board as disk_root and the sentinel's own Discord message carries it — onset, then recovery", async () => {
  const full = () => ({ path: "/", usedPct: 87, freeBytes: 4.9 * GIB });
  const first = await tick({ token: FIXTURE_TOKEN, fetchImpl: stubFetch(GREEN_TABLE), exec: stubExec(), state: {}, nowMs: T0, config: FIXTURE_CONFIG, readDisk: full });
  const probe = first.probes.find((p) => p.key === "disk_root");
  assert.equal(probe.verdict, "DOWN");
  assert.equal(probe.kind, "disk");
  assert.equal(probe.detail.used_pct, 87);
  assert.deepEqual(first.alerts.map((a) => a.key), ["disk_root"], "a full disk on an otherwise green town alerts, and nothing else does");

  // /fleet's sentinelBark reads status, probes[].verdict, probes[].key and generated_at
  const board = composeBoard({ probes: first.probes, nowIso: first.nowIso, alerting: {} });
  assert.equal(board.status, "DOWN");
  assert.equal(board.generated_at, first.nowIso);
  assert.ok(board.probes.some((p) => p.key === "disk_root" && p.verdict === "DOWN"));
  const msg = composeMessage({ alerts: first.alerts, board, nowIso: first.nowIso });
  assert.match(msg, /DOWN — the box's root disk: at 87% used \(4\.9G free; alarm at 85%\)/);

  // the same full disk ten minutes on says nothing: the edge, not the tick
  const held = await tick({ token: FIXTURE_TOKEN, fetchImpl: stubFetch(GREEN_TABLE), exec: stubExec(), state: first.nextState, nowMs: T0 + 10 * MINUTE, config: FIXTURE_CONFIG, readDisk: full });
  assert.deepEqual(held.alerts, []);

  const back = await tick({ token: FIXTURE_TOKEN, fetchImpl: stubFetch(GREEN_TABLE), exec: stubExec(), state: held.nextState, nowMs: T0 + 20 * MINUTE, config: FIXTURE_CONFIG, readDisk: GREEN_DISK });
  assert.deepEqual(back.alerts.map((a) => `${a.key}:${a.alert.kind}`), ["disk_root:recovered"]);
});

// THE RULING, HELD: no other file the box runs posts to Discord. A new alarm is
// a probe in this file; a script with its own webhook call reds here on the PR
// that adds it. (The watch on the sentinel's own death is off the box, in the
// town's .github/workflows/offbox-watch.yml, and reads this file's board.)
test("ONE ROUTE: nothing the office ships to the box posts to Discord except the sentinel (POS-556)", async () => {
  const { readdirSync, statSync: st } = await import("node:fs");
  const ROOT = new URL("..", import.meta.url);
  const POSTER = /SENTINEL_DISCORD_WEBHOOK|DISCORD_WEBHOOK|discord(app)?\.com\/api\/webhooks/;
  const ALLOWED = new Set(["tools/site-sentinel.mjs", "deploy/postmark-site-sentinel.service"]);
  const walk = (rel) => {
    const out = [];
    for (const name of readdirSync(new URL(rel + "/", ROOT))) {
      if (name === "node_modules" || name.startsWith(".")) continue;
      const r = `${rel}/${name}`;
      if (st(new URL(r, ROOT)).isDirectory()) out.push(...walk(r));
      else if (/\.(sh|mjs|js|cjs|service|timer|conf|snippet)$/.test(name)) out.push(r);
    }
    return out;
  };
  const posters = (files) => files.filter((f) => !ALLOWED.has(f) && POSTER.test(readFileSync(new URL(f, ROOT), "utf8")));
  const files = ["deploy", "tools", "src", "world2"].filter((d) => existsSync(new URL(d, ROOT))).flatMap(walk);
  assert.ok(files.length > 100, `read ${files.length} files; the walk is wrong`);
  assert.deepEqual(posters(files), [], "a box script posts to Discord on its own — make it a sentinel probe instead");

  // not vacuous: the retired disk watch's own line is caught
  const dir = tempDir("one-route-");
  const planted = join(dir, "planted.sh");
  _wf(planted, `HOOK="\${SENTINEL_DISCORD_WEBHOOK:-}"\ncurl -d '{}' "$HOOK"\n`);
  assert.ok(POSTER.test(readFileSync(planted, "utf8")));
});

// ── §10: the meeps (POS-556, Darko 2026-10-10 13:27) ────────────────────────
//
// The record is the one G:/Wright-HQ/tools/meep-watch.mjs writes every five
// minutes and lands on the box by scp. Its summary below is copied in shape
// from that watcher's own status.json of 2026-10-10T17:32:41Z.

const MEEPS_REC = (over = {}) => JSON.stringify({
  schema: 1,
  generated_at: new Date(T0 - 2 * MINUTE).toISOString(),
  status: "OK",
  summary: "all 9 meeps answering; every round due in the last 3 h fired",
  problems: [],
  meeps: {},
  ...over,
});
const STUCK_SUMMARY = "STUCK Rei: an input in local-conv-333 at 13:06 EDT has had no reply for 26 min (summary: Thread in wright-starforge)";
// The shape of the watcher's MISSED line (`<job> was due <time> and never fired (no entry in its run log)`): the kind
// of record POS-838 stops from barking DOWN. The meep and the job are the town's own names; no resident data.
const MISSED_SUMMARY = "MISSED Registrar: registrar-round was due 21:05 EDT and never fired (no entry in its run log)";

test("§10 OK is OK, and the watcher's summary is the reason", () => {
  const r = classifyMeeps({ raw: MEEPS_REC(), nowMs: T0, staleAfterMs: CONFIG.meeps.staleAfterMs });
  assert.equal(r.verdict, "OK");
  assert.match(r.reason, /all 9 meeps answering/);
});

// The shape of a problem on the watcher that splits severity (rig branch k/meep-watch, 23583c8): every problem is
// stamped with `severity`, "down" or "warn" (STUCK, CUT OFF and DOWN are "down"; MISSED, FAILED and the memory words are
// "warn"), and the record is DOWN if any problem is "down", else DEGRADED. The watcher that ran before the split
// stamped nothing, and marked a STUCK or CUT OFF meep DEGRADED just as it did a lone MISSED round.
const WARN_PROBLEM = { kind: "MISSED", meep: "Registrar", severity: "warn" };
const DOWN_PROBLEM = { kind: "STUCK", meep: "Rei", severity: "down" };
const UNSTAMPED_PROBLEM = { kind: "MISSED", meep: "Registrar" }; // as the watcher before the split wrote it

// POS-838 (Wright 2026-10-30 23:42, Jetto's STAR-84 option B): the sentinel learns WARN. Until 2026-11-02 the next
// test asserted that DEGRADED and DOWN were BOTH DOWN (POS-556, 10-10), so a lone missed round barked as an outage:
// the Registrar's 559-second late fire of 10-31. Darko, 2026-11-01 22:59 EST, on the noise: "the spam is a bit too
// much isn't it?".
// LAW (POS-838 issue, "The change" item 1, verbatim): "DEGRADED becomes its own verdict, `WARN`, and DOWN stays DOWN."
// LAW (POS-838 ruling of 2026-11-02, PARAPHRASE, not verbatim): a DEGRADED record reads WARN only when every problem
// in the record carries severity "warn", and DOWN otherwise. So a record whose problems carry no severity, as the
// running watcher writes them, reads DOWN, today's behaviour.
test("§10 DOWN is DOWN, and the reason is the record's one-line summary verbatim", () => {
  const r = classifyMeeps({ raw: MEEPS_REC({ status: "DOWN", summary: STUCK_SUMMARY, problems: [DOWN_PROBLEM] }), nowMs: T0, staleAfterMs: CONFIG.meeps.staleAfterMs });
  assert.equal(r.verdict, "DOWN", 'LAW (POS-838 issue, verbatim): "DOWN stays DOWN"');
  assert.equal(r.reason, STUCK_SUMMARY);
  assert.equal(r.detail.problems, 1);
});

test("§10 a DEGRADED record whose every problem says severity warn is a WARN, not DOWN, and the reason is the summary verbatim (POS-838)", () => {
  const r = classifyMeeps({ raw: MEEPS_REC({ status: "DEGRADED", summary: MISSED_SUMMARY, problems: [WARN_PROBLEM, { ...WARN_PROBLEM, kind: "FAILED" }] }), nowMs: T0, staleAfterMs: CONFIG.meeps.staleAfterMs });
  assert.equal(r.verdict, "WARN", 'LAW (POS-838 issue, verbatim): "DEGRADED becomes its own verdict, `WARN`"');
  assert.notEqual(r.verdict, "DOWN", "a warning never barks as an outage");
  assert.equal(r.reason, MISSED_SUMMARY);
  assert.equal(r.detail.status, "DEGRADED");
  assert.equal(r.detail.problems, 2);
});

test("§10 FAIL SAFE: a DEGRADED record with no severity on its problems is DOWN, today's behaviour (POS-838)", () => {
  // The watcher that ran before the severity split wrote exactly these: a stuck meep, a cut-off one and a lone missed
  // round alike came out DEGRADED, with nothing on the problem to tell them apart. None of them may read as a warning.
  for (const [problem, summary] of [
    [{ kind: "STUCK", meep: "Rei" }, STUCK_SUMMARY],
    [{ kind: "CUT OFF", meep: "Rei" }, STUCK_SUMMARY],
    [UNSTAMPED_PROBLEM, MISSED_SUMMARY],
  ]) {
    const r = classifyMeeps({ raw: MEEPS_REC({ status: "DEGRADED", summary, problems: [problem] }), nowMs: T0, staleAfterMs: CONFIG.meeps.staleAfterMs });
    assert.equal(r.verdict, "DOWN", `LAW (POS-838 ruling, paraphrase): a record with no severity on its problems reads DOWN (${problem.kind})`);
    assert.equal(r.reason, summary, "and the reason is still the summary verbatim");
    // The old loop test asserted the count for DEGRADED and for DOWN alike; the split left it only on the DOWN record
    // and the WARN verdict, and this arm is the one every running-watcher record takes. The board entry carries it.
    assert.equal(r.detail?.status, "DEGRADED", "and the board entry still carries the record's own status");
    assert.equal(r.detail?.problems, 1, "and how many problems it listed");
  }
});

test("§10 FAIL SAFE: one problem that is not a warning keeps a DEGRADED record DOWN (POS-838)", () => {
  for (const [what, problems] of [
    ["a down beside a warn", [WARN_PROBLEM, DOWN_PROBLEM]],
    ["a down first", [DOWN_PROBLEM, WARN_PROBLEM]],
    ["a warn beside a problem with no severity", [WARN_PROBLEM, UNSTAMPED_PROBLEM]],
  ]) {
    const r = classifyMeeps({ raw: MEEPS_REC({ status: "DEGRADED", summary: STUCK_SUMMARY, problems }), nowMs: T0, staleAfterMs: CONFIG.meeps.staleAfterMs });
    assert.equal(r.verdict, "DOWN", `every problem must say warn, and ${what} does not`);
    assert.equal(r.detail?.problems, problems.length, `${what}: the board entry still counts the problems the record listed`);
  }
});

test("§10 FAIL SAFE: a DEGRADED record that lists no problems is DOWN, because nothing in it says warn (POS-838)", () => {
  // `counted` is what the board entry's detail.problems says: the length of a list, null for anything that is not one.
  for (const [what, over, counted] of [
    ["an empty list", { problems: [] }, 0],
    ["no list at all", { problems: undefined }, null],
    ["a null list", { problems: null }, null],
    ["something that is not a list", { problems: "MISSED Registrar" }, null],
  ]) {
    const r = classifyMeeps({ raw: MEEPS_REC({ status: "DEGRADED", summary: MISSED_SUMMARY, ...over }), nowMs: T0, staleAfterMs: CONFIG.meeps.staleAfterMs });
    assert.equal(r.verdict, "DOWN", `a DEGRADED record with ${what} cannot say it is only a warning`);
    assert.equal(r.detail?.status, "DEGRADED", `${what}: the board entry still carries the record's own status`);
    assert.equal(r.detail?.problems, counted, `${what}: and counts what it can`);
  }
});

test("§10 FAIL SAFE: only the exact word warn counts as a warning (POS-838)", () => {
  for (const severity of ["WARN", "Warn", "warning", " warn", "", "info", "down", null, true, 1]) {
    const r = classifyMeeps({ raw: MEEPS_REC({ status: "DEGRADED", summary: MISSED_SUMMARY, problems: [{ ...WARN_PROBLEM, severity }] }), nowMs: T0, staleAfterMs: CONFIG.meeps.staleAfterMs });
    assert.equal(r.verdict, "DOWN", `severity ${JSON.stringify(severity)} is not the word warn`);
  }
});

test("§10 FAIL SAFE: a null or other non-object entry among the problems reads DOWN and never throws (POS-838)", () => {
  // `p?.severity` is the first code to read inside a problems entry, and a record is JSON, so a null can sit in the list.
  // Without the `?.` the TypeError would leave classifyMeeps; tick has no catch around it, so run() would end with no
  // board and no posts for that tick.
  for (const [what, problems] of [
    ["a null alone", [null]],
    ["a warn, then a null", [WARN_PROBLEM, null]],
    ["a null, then a warn", [null, WARN_PROBLEM]],
    ["a number", [1]],
    ["a bare string", ["warn"]],
    ["an array", [[]]],
  ]) {
    let r;
    assert.doesNotThrow(() => { r = classifyMeeps({ raw: MEEPS_REC({ status: "DEGRADED", summary: MISSED_SUMMARY, problems }), nowMs: T0, staleAfterMs: CONFIG.meeps.staleAfterMs }); }, `${what} among the problems must not throw`);
    assert.equal(r.verdict, "DOWN", `${what}: nothing in it says warn`);
    assert.equal(r.detail?.problems, problems.length, `${what}: and the board entry counts it`);
  }
});

test("§10 a WARN alone rolls the board up to DEGRADED, never DOWN, and the headline names it (POS-838)", () => {
  // LAW (POS-838 issue, "The change" item 2, verbatim): a WARN counts toward DEGRADED, as UNKNOWN does, never toward
  // DOWN. The headline at `:1545` names it, e.g. "1 warning".
  const ok = { key: "a", label: "home", verdict: "OK", reason: "HTTP 200" };
  const warn = { key: "meeps", label: "the meeps", verdict: "WARN", reason: MISSED_SUMMARY };
  const one = composeBoard({ probes: [ok, warn], nowIso: "2026-11-02T05:00:00Z", alerting: {} });
  assert.equal(one.status, "DEGRADED", "a WARN alone is DEGRADED, as an UNKNOWN is");
  assert.equal(one.counts.WARN, 1);
  assert.equal(one.counts.DOWN, 0, "and it is not counted as down");
  assert.equal(one.summary, "1 green, 1 warning.");
  assert.equal(one.headline, "DEGRADED · 1 green, 1 warning. (2026-11-02T05:00:00Z)");

  assert.equal(composeBoard({ probes: [ok, warn, { ...warn, key: "other" }], nowIso: "x", alerting: {} }).summary, "1 green, 2 warnings.");

  // a warning and an unread probe are two different sentences, and the board says both
  const both = composeBoard({ probes: [ok, warn, { key: "u", label: "u", verdict: "UNKNOWN", reason: "unread" }], nowIso: "x", alerting: {} });
  assert.equal(both.status, "DEGRADED");
  assert.equal(both.summary, "1 green, 1 warning, 1 could not be read.");

  // CONTROL: a board with no WARN keeps its old sentences, byte for byte
  assert.equal(composeBoard({ probes: [ok, { key: "u", verdict: "UNKNOWN" }], nowIso: "x", alerting: {} }).summary, "1 green, 1 could not be read.");
  assert.equal(composeBoard({ probes: [ok, { key: "d", verdict: "DOWN" }], nowIso: "x", alerting: {} }).summary, "1 down, 0 stale, 1 green.");
  assert.equal(composeBoard({ probes: [ok], nowIso: "x", alerting: {} }).summary, "All 1 probes green.");
  // and counts.WARN is seeded at 0 on every board, as the other verdicts' counts are, so a reader never has to guess
  // whether a missing key means none
  assert.equal(composeBoard({ probes: [ok], nowIso: "x", alerting: {} }).counts.WARN, 0);
});

test("§10 a WARN beside a DOWN rolls up to DOWN, and beside a STALE to STALE, and is still named (POS-838)", () => {
  const ok = { key: "a", label: "home", verdict: "OK", reason: "HTTP 200" };
  const warn = { key: "meeps", label: "the meeps", verdict: "WARN", reason: MISSED_SUMMARY };
  const withDown = composeBoard({ probes: [ok, warn, { key: "d", label: "daily", verdict: "DOWN", reason: "HTTP 502" }], nowIso: "x", alerting: {} });
  assert.equal(withDown.status, "DOWN", 'LAW (POS-838 issue, "Tests", verbatim): "a WARN beside a DOWN rolls up to DOWN"');
  assert.equal(withDown.summary, "1 down, 0 stale, 1 warning, 1 green.");
  const withStale = composeBoard({ probes: [ok, warn, { key: "s", label: "index", verdict: "STALE", reason: "frozen" }], nowIso: "x", alerting: {} });
  assert.equal(withStale.status, "STALE", "a WARN does not outrank a STALE either");
  assert.equal(withStale.summary, "0 down, 1 stale, 1 warning, 1 green.");
});

test("§10 a 16-minute-old record is STALE: the watcher or the desktop has stopped", () => {
  assert.equal(CONFIG.meeps.staleAfterMs, 15 * MINUTE);
  const old = classifyMeeps({ raw: MEEPS_REC({ generated_at: new Date(T0 - 16 * MINUTE).toISOString() }), nowMs: T0, staleAfterMs: CONFIG.meeps.staleAfterMs });
  assert.equal(old.verdict, "STALE");
  assert.match(old.reason, /16m old/);
  const fresh = classifyMeeps({ raw: MEEPS_REC({ generated_at: new Date(T0 - 14 * MINUTE).toISOString() }), nowMs: T0, staleAfterMs: CONFIG.meeps.staleAfterMs });
  assert.equal(fresh.verdict, "OK", "inside the window is the record's own verdict");
});

test("§10 MISSING, UNPARSEABLE, UNDATED or an unread status is STALE, never UNKNOWN — /fleet barks only on DOWN or STALE", () => {
  const missing = classifyMeeps({ raw: null, readError: "ENOENT", nowMs: T0, path: "/srv/postmark-sentinel/meeps.json" });
  assert.equal(missing.verdict, "STALE");
  assert.match(missing.reason, /no meeps record at \/srv\/postmark-sentinel\/meeps\.json \(ENOENT\)/);
  assert.equal(classifyMeeps({ raw: "{ half a recor", nowMs: T0 }).verdict, "STALE");
  assert.equal(classifyMeeps({ raw: MEEPS_REC({ generated_at: null }), nowMs: T0 }).verdict, "STALE");
  assert.equal(classifyMeeps({ raw: MEEPS_REC({ status: "WEIRD" }), nowMs: T0 }).verdict, "STALE");
  // and STALE alarms, on the sentinel's own edge
  assert.equal(transition({ prev: null, next: missing, nowMs: T0 }).alert?.kind, "onset");
});

test("§10 the probe reaches the board as `meeps` and the sentinel's message carries a stuck meep; a missing record alarms too", async () => {
  const dir = tempDir("sentinel-meeps-");
  const path = join(dir, "meeps.json");
  // A stuck meep is a DOWN record. (Until 2026-11-02 this wrote DEGRADED, which was DOWN too. Now a DEGRADED record reads
  // WARN only when every problem in it carries severity "warn" (POS-838); this fixture lists no problems, so even as
  // DEGRADED it would read DOWN. It says DOWN outright because that is what a stuck meep's record says.)
  _wf(path, MEEPS_REC({ status: "DOWN", summary: STUCK_SUMMARY }));
  const cfg = { ...FIXTURE_CONFIG, meeps: { ...CONFIG.meeps, path } };
  const t1 = await tick({ token: FIXTURE_TOKEN, fetchImpl: stubFetch(GREEN_TABLE), exec: stubExec(), state: {}, nowMs: T0, config: cfg, readDisk: GREEN_DISK });
  const probe = t1.probes.find((p) => p.key === "meeps");
  assert.equal(probe.verdict, "DOWN");
  assert.equal(probe.kind, "meeps");
  assert.deepEqual(t1.alerts.map((a) => a.key), ["meeps"], "a stuck meep on an otherwise green town alerts, and nothing else does");
  const board = composeBoard({ probes: t1.probes, nowIso: t1.nowIso, alerting: {} });
  assert.equal(board.status, "DOWN");
  assert.match(composeMessage({ alerts: t1.alerts, board, nowIso: t1.nowIso }), /DOWN — the meeps: STUCK Rei: an input in local-conv-333/);

  const gone = { ...FIXTURE_CONFIG, meeps: { ...CONFIG.meeps, path: join(dir, "never-landed.json") } };
  const t2 = await tick({ token: FIXTURE_TOKEN, fetchImpl: stubFetch(GREEN_TABLE), exec: stubExec(), state: {}, nowMs: T0, config: gone, readDisk: GREEN_DISK });
  assert.equal(t2.probes.find((p) => p.key === "meeps").verdict, "STALE");
  assert.deepEqual(t2.alerts.map((a) => a.key), ["meeps"]);
  assert.equal(composeBoard({ probes: t2.probes, nowIso: t2.nowIso, alerting: {} }).status, "STALE");
});

// ── POS-838, the notice: a WARN is announced once, in its own words ──────────
//
// LAW (POS-838 ruling of 2026-11-02, PARAPHRASE, not verbatim): a WARN posts once when the verdict enters WARN, never
// repeats, and clears silently. BAD stays {DOWN, STALE}, and INFO and UNKNOWN still never alert. The header reads
// "a warning, as of <time>." and the line is `the meeps: warning: <summary>.` A DOWN or STALE easing into WARN posts one
// closing line, such as `the meeps: no longer down after 1h27m, still a warning: <summary>.`, and that line is the
// WARN episode's one post.
// LAW (POS-838 issue, "The change" item 3, verbatim): "It clears quietly when the record goes back to OK."
const WARN_NEXT = { verdict: "WARN", reason: MISSED_SUMMARY };
const OK_NEXT = { verdict: "OK", reason: "all 9 meeps answering; every round due in the last 3 h fired" };

test("§10 BAD stays DOWN and STALE: a WARN is a notice, not an alarm (POS-838)", () => {
  assert.deepEqual([...BAD].sort(), ["DOWN", "STALE"], "LAW (POS-838 ruling, paraphrase): BAD stays {DOWN, STALE}");
});

test("§10 a WARN posts once on the way in, never repeats however long it lasts, and clears silently (POS-838)", () => {
  const cold = transition({ prev: null, next: WARN_NEXT, nowMs: T0 });
  assert.equal(cold.alert?.kind, "warn", "a sentinel that boots into a warning says so once");
  assert.equal(cold.alert.verdict, "WARN");
  assert.equal(cold.alert.reason, MISSED_SUMMARY);
  const fromOk = transition({ prev: { verdict: "OK", reason: "fine", since: T0 - HOUR, last_alert_at: null }, next: WARN_NEXT, nowMs: T0 });
  assert.equal(fromOk.alert?.kind, "warn", "LAW (POS-838 ruling, paraphrase): a WARN posts once when the verdict enters WARN");
  assert.equal(fromOk.state.since, T0);
  assert.equal(fromOk.state.last_alert_at, T0);

  // however long it lasts: no reminder
  for (const later of [10 * MINUTE, 11 * HOUR, 12 * HOUR, 13 * HOUR, 30 * HOUR]) {
    const held = transition({ prev: fromOk.state, next: WARN_NEXT, nowMs: T0 + later });
    assert.equal(held.alert, null, `LAW (POS-838 ruling, paraphrase): a WARN never repeats (${later / MINUTE} minutes on)`);
    assert.equal(held.state.since, T0, "the episode's clock survives the silence");
    assert.equal(held.state.last_alert_at, T0, "and so does the time it spoke");
  }
  // CONTROL: twelve hours on a DOWN does remind, so the silence above is the WARN's own
  const down = { verdict: "DOWN", reason: "x", since: T0, last_alert_at: T0 };
  assert.equal(transition({ prev: down, next: { verdict: "DOWN", reason: "x" }, nowMs: T0 + 12 * HOUR }).alert?.kind, "reminder");

  // it clears silently: no recovery for a notice
  const clear = transition({ prev: fromOk.state, next: OK_NEXT, nowMs: T0 + 3 * HOUR });
  assert.equal(clear.alert, null, 'LAW (POS-838 issue, "The change" item 3, verbatim): "It clears quietly when the record goes back to OK."');
  assert.equal(clear.state.verdict, "OK");
  // so the next WARN is a new episode and speaks again
  assert.equal(transition({ prev: clear.state, next: WARN_NEXT, nowMs: T0 + 4 * HOUR }).alert?.kind, "warn");
});

test("§10 a DOWN or STALE easing into a WARN gets one closing line, and that line is the WARN's one post (POS-838)", () => {
  for (const from of ["DOWN", "STALE"]) {
    const bad = { verdict: from, reason: "x", since: T0, last_alert_at: T0 };
    const eased = transition({ prev: bad, next: WARN_NEXT, nowMs: T0 + 87 * MINUTE });
    assert.equal(eased.alert?.kind, "eased", `LAW (POS-838 ruling, paraphrase): a DOWN or STALE easing into WARN posts one closing line (${from})`);
    assert.equal(eased.alert.from, from);
    assert.equal(eased.alert.verdict, "WARN");
    assert.equal(eased.alert.reason, MISSED_SUMMARY);
    assert.equal(eased.alert.downFor, 87 * MINUTE, "the closing line says how long the outage lasted");
    assert.equal(eased.state.since, T0 + 87 * MINUTE, "and the WARN episode starts there");
    // the closing line was the episode's one post: the WARN that goes on says nothing, and clearing it says nothing
    assert.equal(transition({ prev: eased.state, next: WARN_NEXT, nowMs: T0 + 100 * MINUTE }).alert, null, `${from} to WARN to WARN`);
    assert.equal(transition({ prev: eased.state, next: OK_NEXT, nowMs: T0 + 3 * HOUR }).alert, null, `${from} to WARN to OK posts no recovery`);
  }
});

test("§10 a WARN going bad is the ordinary onset, and an outage that eases and returns speaks each time (POS-838)", () => {
  const warn = transition({ prev: null, next: WARN_NEXT, nowMs: T0 }).state;
  const down = transition({ prev: warn, next: { verdict: "DOWN", reason: STUCK_SUMMARY }, nowMs: T0 + 10 * MINUTE });
  assert.equal(down.alert?.kind, "onset");
  assert.equal(down.alert.verdict, "DOWN");
  assert.equal(down.state.since, T0 + 10 * MINUTE, "a DOWN is its own episode, with its own clock");
  const eased = transition({ prev: down.state, next: WARN_NEXT, nowMs: T0 + 40 * MINUTE });
  assert.equal(eased.alert?.kind, "eased");
  assert.equal(eased.alert.downFor, 30 * MINUTE);
  const again = transition({ prev: eased.state, next: { verdict: "DOWN", reason: STUCK_SUMMARY }, nowMs: T0 + 50 * MINUTE });
  assert.equal(again.alert?.kind, "onset", "DOWN, WARN, DOWN: the second DOWN is announced too");
});

test("§10 INFO and UNKNOWN still never alert beside a WARN (POS-838)", () => {
  // The earlier test's law, kept true by the settled shape: a third class was added, nothing was loosened.
  assert.equal(transition({ prev: null, next: { verdict: "INFO", reason: "gated" }, nowMs: T0 }).alert, null);
  assert.equal(transition({ prev: null, next: { verdict: "UNKNOWN", reason: "x" }, nowMs: T0 }).alert, null);
  const warn = transition({ prev: null, next: WARN_NEXT, nowMs: T0 }).state;
  const murky = transition({ prev: warn, next: { verdict: "UNKNOWN", reason: "unreadable" }, nowMs: T0 + HOUR });
  assert.equal(murky.alert, null, "a warning that goes unreadable says nothing, and does not read as a recovery");
  assert.equal(murky.state.verdict, "UNKNOWN");
});

test("§10 a WARN is posted in its own words, under its own header, and nothing in it says DOWN (POS-838)", () => {
  const nowIso = "2026-11-02T01:07:44Z";
  const board = composeBoard({ probes: [{ key: "a", label: "home", verdict: "OK", reason: "200" }, { key: "meeps", label: "the meeps", verdict: "WARN", reason: MISSED_SUMMARY }], nowIso, alerting: {} });
  const warn = { key: "meeps", label: "the meeps", alert: { kind: "warn", verdict: "WARN", reason: MISSED_SUMMARY, since: T0 } };
  const msg = composeMessage({ alerts: [warn], board, nowIso });
  const lines = msg.split("\n");
  assert.ok(lines[0].startsWith("**") && lines[0].endsWith("Postmark sentinel** — a warning, as of 2026-11-02T01:07:44Z."), `LAW (POS-838 ruling, paraphrase): the header reads "a warning, as of <time>.", got: ${lines[0]}`);
  assert.ok(lines.includes(`the meeps: warning: ${MISSED_SUMMARY}.`), "LAW (POS-838 ruling, paraphrase): the line is `the meeps: warning: <summary>.`");
  assert.doesNotMatch(msg, /DOWN|wrong on the site|RECOVERED/, "no outage framing, and no recovery");
  assert.doesNotMatch(msg, /TOP PRIORITY/i);
  assert.ok(!msg.includes("|---") && !/^\s*\|/m.test(msg), "still plain prose, no markdown table");
  assert.match(msg, /1 green, 1 warning\. The full board is /, "and the board's own sentence still closes it");

  // two warnings read as two
  const two = composeMessage({ alerts: [warn, { ...warn, key: "other", label: "the box" }], board, nowIso });
  assert.ok(two.split("\n")[0].endsWith("2 warnings, as of 2026-11-02T01:07:44Z."), two);
  assert.ok(two.split("\n").includes(`the box: warning: ${MISSED_SUMMARY}.`));
});

test("§10 the closing line of an outage that eased into a WARN reads as the settled sentence (POS-838)", () => {
  const nowIso = "2026-11-02T01:07:44Z";
  const board = composeBoard({ probes: [{ key: "meeps", label: "the meeps", verdict: "WARN", reason: MISSED_SUMMARY }], nowIso, alerting: {} });
  for (const [from, word] of [["DOWN", "down"], ["STALE", "stale"]]) {
    const eased = { key: "meeps", label: "the meeps", alert: { kind: "eased", verdict: "WARN", reason: MISSED_SUMMARY, since: T0, from, downFor: 87 * MINUTE } };
    const msg = composeMessage({ alerts: [eased], board, nowIso });
    const lines = msg.split("\n");
    assert.ok(lines[0].endsWith("Postmark sentinel** — a warning, as of 2026-11-02T01:07:44Z."), lines[0]);
    assert.ok(lines.includes(`the meeps: no longer ${word} after 1h27m, still a warning: ${MISSED_SUMMARY}.`), `LAW (POS-838 ruling, paraphrase of its example): the meeps: no longer ${word} after 1h27m, still a warning: <summary>. (${from})`);
    assert.doesNotMatch(msg, /DOWN|RECOVERED|wrong on the site/);
  }
});

test("§10 a WARN rides beside a DOWN or a recovery without borrowing their framing, and every older header is unchanged (POS-838)", () => {
  const nowIso = "2026-11-02T01:07:44Z";
  const board = composeBoard({ probes: [{ key: "a", label: "home", verdict: "OK", reason: "200" }], nowIso, alerting: {} });
  const onset = { key: "disk_root", label: "the box's root disk", alert: { kind: "onset", verdict: "DOWN", reason: "at 87% used", since: T0 } };
  const back = { key: "site_daily", label: "the Daily page", alert: { kind: "recovered", verdict: "OK", reason: "HTTP 200", since: T0, downFor: 20 * MINUTE } };
  const warn = { key: "meeps", label: "the meeps", alert: { kind: "warn", verdict: "WARN", reason: MISSED_SUMMARY, since: T0 } };
  const first = (alerts) => composeMessage({ alerts, board, nowIso }).split("\n")[0];

  // beside a DOWN: the post is still about a DOWN, and the warning line is its own sentence, not a DOWN line
  const withDown = composeMessage({ alerts: [onset, warn], board, nowIso });
  assert.ok(first([onset, warn]).endsWith("Postmark sentinel** — something is wrong on the site, as of 2026-11-02T01:07:44Z."));
  assert.ok(withDown.split("\n").includes("DOWN — the box's root disk: at 87% used."));
  assert.ok(withDown.split("\n").includes(`the meeps: warning: ${MISSED_SUMMARY}.`));
  assert.doesNotMatch(withDown, /DOWN — the meeps/, "the warning never takes a DOWN line");
  // beside a recovery
  assert.ok(first([warn, back]).endsWith("Postmark sentinel** — 1 warning and 1 recovery, as of 2026-11-02T01:07:44Z."), first([warn, back]));
  // two warnings beside a recovery: the noun is the warning's, and it pluralises. (One recovery on purpose: the older
  // header spells two of them "recoveryies", which POS-838 leaves as it found it.)
  const warn2 = { ...warn, key: "other", label: "the box" };
  assert.ok(first([warn, warn2, back]).endsWith("Postmark sentinel** — 2 warnings and 1 recovery, as of 2026-11-02T01:07:44Z."), first([warn, warn2, back]));

  // CONTROL: with no notice in the post, the three older headers are word for word what they were
  assert.ok(first([onset]).endsWith("Postmark sentinel** — something is wrong on the site, as of 2026-11-02T01:07:44Z."));
  assert.ok(first([onset, back]).endsWith("Postmark sentinel** — 1 problem and 1 recovery, as of 2026-11-02T01:07:44Z."));
  assert.ok(first([back]).endsWith("Postmark sentinel** — recovered, as of 2026-11-02T01:07:44Z."));
});

// One real tick, the meeps record rewritten for that tick (a minute old, so never stale). The fixture's town clone is
// never at the town's tip, so past 25 minutes its own probe would speak too: these tests are about the meeps alone,
// so the tick runs without it. Clocks stay inside two hours, short of the 18:00Z settlement slot.
async function meepsTick(path, rec, state, nowMs) {
  _wf(path, MEEPS_REC({ generated_at: new Date(nowMs - MINUTE).toISOString(), ...rec }));
  const config = { ...FIXTURE_CONFIG, clones: [], meeps: { ...CONFIG.meeps, path } };
  return tick({ token: FIXTURE_TOKEN, fetchImpl: stubFetch(GREEN_TABLE), exec: stubExec(), state, nowMs, config, readDisk: GREEN_DISK });
}
const DEGRADED_REC = { status: "DEGRADED", summary: MISSED_SUMMARY, problems: [WARN_PROBLEM] };
const DOWN_REC = { status: "DOWN", summary: STUCK_SUMMARY, problems: [DOWN_PROBLEM] };
const said = (t) => t.alerts.map((a) => `${a.key}:${a.alert.kind}`);
const wordsOf = (t) => composeMessage({ alerts: t.alerts, board: composeBoard({ probes: t.probes, nowIso: t.nowIso, alerting: {} }), nowIso: t.nowIso });

test("§10 THE TICK: a WARN episode posts once and clears without a DOWN post (POS-838)", async () => {
  // LAW (POS-838 issue, "Tests", verbatim): "A WARN episode posts once and clears without a DOWN post."
  const path = join(tempDir("sentinel-meeps-warn-"), "meeps.json");
  const t1 = await meepsTick(path, DEGRADED_REC, {}, T0);
  const probe = t1.probes.find((p) => p.key === "meeps");
  assert.equal(probe.verdict, "WARN");
  assert.equal(probe.kind, "meeps");
  assert.equal(probe.reason, MISSED_SUMMARY);
  const board = composeBoard({ probes: t1.probes, nowIso: t1.nowIso, alerting: {} });
  assert.equal(board.status, "DEGRADED", "an otherwise green town with one warning is DEGRADED, not DOWN");
  assert.match(board.headline, /^DEGRADED · .*1 warning/);
  assert.deepEqual(said(t1), ["meeps:warn"], "the first tick speaks once, and nothing else on the town does");
  const msg = wordsOf(t1);
  assert.ok(msg.split("\n").includes(`the meeps: warning: ${MISSED_SUMMARY}.`), msg);
  assert.doesNotMatch(msg, /DOWN/, "the old mapping barked this very record as DOWN");

  // ten minutes on, and half an hour on: the same warning says nothing
  const t2 = await meepsTick(path, DEGRADED_REC, t1.nextState, T0 + 10 * MINUTE);
  const t3 = await meepsTick(path, DEGRADED_REC, t2.nextState, T0 + 30 * MINUTE);
  assert.deepEqual(said(t2), [], "never repeats");
  assert.deepEqual(said(t3), [], "never repeats");
  // the record goes back to OK: it clears silently, with no recovery and no message at all
  const t4 = await meepsTick(path, {}, t3.nextState, T0 + 40 * MINUTE);
  assert.equal(t4.probes.find((p) => p.key === "meeps").verdict, "OK");
  assert.deepEqual(said(t4), [], "clears silently");
  assert.equal(wordsOf(t4), null);
  // and nothing the episode ever said was a DOWN or a recovery
  for (const t of [t1, t2, t3, t4]) assert.ok(t.alerts.every((a) => a.alert.verdict !== "DOWN" && a.alert.kind !== "recovered"));
  // a new episode speaks again
  const t5 = await meepsTick(path, DEGRADED_REC, t4.nextState, T0 + 50 * MINUTE);
  assert.deepEqual(said(t5), ["meeps:warn"]);
});

test("§10 THE TICK: a DOWN that eases into a WARN gets one closing line, and the WARN says nothing more (POS-838)", async () => {
  const path = join(tempDir("sentinel-meeps-eased-"), "meeps.json");
  const t1 = await meepsTick(path, DOWN_REC, {}, T0);
  assert.deepEqual(said(t1), ["meeps:onset"], "a stuck meep still barks DOWN, as before");
  assert.match(wordsOf(t1), /DOWN — the meeps: STUCK Rei: an input in local-conv-333/);

  const t2 = await meepsTick(path, DEGRADED_REC, t1.nextState, T0 + 87 * MINUTE);
  assert.equal(t2.probes.find((p) => p.key === "meeps").verdict, "WARN");
  assert.deepEqual(said(t2), ["meeps:eased"]);
  const msg = wordsOf(t2);
  assert.ok(msg.split("\n")[0].endsWith("Postmark sentinel** — a warning, as of " + t2.nowIso + "."), msg);
  assert.ok(msg.split("\n").includes(`the meeps: no longer down after 1h27m, still a warning: ${MISSED_SUMMARY}.`), msg);
  assert.doesNotMatch(msg, /DOWN|RECOVERED/);

  const t3 = await meepsTick(path, DEGRADED_REC, t2.nextState, T0 + 100 * MINUTE);
  assert.deepEqual(said(t3), [], "the closing line was the WARN episode's one post");
});

test("§10 THE TICK: DOWN, then WARN, then OK posts no stray recovery and no stray alarm (POS-838)", async () => {
  const path = join(tempDir("sentinel-meeps-down-warn-ok-"), "meeps.json");
  const t1 = await meepsTick(path, DOWN_REC, {}, T0);
  const t2 = await meepsTick(path, DEGRADED_REC, t1.nextState, T0 + 20 * MINUTE);
  const t3 = await meepsTick(path, {}, t2.nextState, T0 + 40 * MINUTE);
  assert.equal(t3.probes.find((p) => p.key === "meeps").verdict, "OK");
  assert.deepEqual([said(t1), said(t2), said(t3)], [["meeps:onset"], ["meeps:eased"], []], "one onset, one closing line, and then quiet");
  assert.equal(wordsOf(t3), null, "no RECOVERED for an outage that was already closed by its closing line");
  // the same road with a flap in the middle: DOWN, WARN, DOWN, WARN each speak once, and the end is still quiet
  const f2 = await meepsTick(path, DEGRADED_REC, t1.nextState, T0 + 20 * MINUTE);
  const f3 = await meepsTick(path, DOWN_REC, f2.nextState, T0 + 30 * MINUTE);
  const f4 = await meepsTick(path, DEGRADED_REC, f3.nextState, T0 + 50 * MINUTE);
  const f5 = await meepsTick(path, {}, f4.nextState, T0 + 60 * MINUTE);
  assert.deepEqual([said(f2), said(f3), said(f4), said(f5)], [["meeps:eased"], ["meeps:onset"], ["meeps:eased"], []]);
});

test("§10 THE TICK: a DEGRADED record from the watcher before the severity split still barks DOWN (POS-838 fail safe)", async () => {
  // The record the running watcher writes for a stuck meep: DEGRADED, and nothing on the problem to say it is only a warning.
  const path = join(tempDir("sentinel-meeps-unstamped-"), "meeps.json");
  const t1 = await meepsTick(path, { status: "DEGRADED", summary: STUCK_SUMMARY, problems: [{ kind: "STUCK", meep: "Rei" }] }, {}, T0);
  const probe = t1.probes.find((p) => p.key === "meeps");
  assert.equal(probe.verdict, "DOWN");
  assert.equal(probe.detail?.status, "DEGRADED", "the board entry still carries the record's own status");
  assert.equal(probe.detail?.problems, 1, "and how many problems it listed");
  assert.deepEqual(said(t1), ["meeps:onset"]);
  assert.match(wordsOf(t1), /DOWN — the meeps: STUCK Rei: an input in local-conv-333/);
  assert.equal(composeBoard({ probes: t1.probes, nowIso: t1.nowIso, alerting: {} }).status, "DOWN");
});

test("§10 THE TICK: a null entry among the problems still gives the tick its board, and the meep reads DOWN (POS-838)", async () => {
  // Without the `?.` in classifyMeeps the TypeError would end the tick: run() would exit 1 with no board and no posts.
  const path = join(tempDir("sentinel-meeps-null-entry-"), "meeps.json");
  let t1;
  await assert.doesNotReject(async () => {
    t1 = await meepsTick(path, { status: "DEGRADED", summary: STUCK_SUMMARY, problems: [WARN_PROBLEM, null] }, {}, T0);
  }, "a null entry among the problems must not end the tick");
  const probe = t1.probes.find((p) => p.key === "meeps");
  assert.equal(probe.verdict, "DOWN", "nothing in it says warn, so it reads DOWN");
  assert.equal(probe.detail?.problems, 2);
  assert.deepEqual(said(t1), ["meeps:onset"], "and it barks, as it does today");
  assert.equal(composeBoard({ probes: t1.probes, nowIso: t1.nowIso, alerting: {} }).status, "DOWN", "with a board for the tick");
});

// ── §11: the settlement (Darko 2026-10-11) ──────────────────────────────────
//
// "If the settlement that we expect has not gone through an hour after its
// expected time … it needs to bark." The two real cases are pinned with their
// real shas: the 2026-10-10T18:00Z sweep (33306f30, uncovered until S102 on
// 0cca7f2b, a descendant, cut 10-11 ~06:38Z) and the 2026-10-11T18:00Z sweep
// (5d878f3c, held, newest still S102 an hour on).

import {
  classifySettlement,
  newestSettlementTag,
  newestSettlementSlot,
  SETTLEMENT_GRACE_MS,
  SETTLEMENT_SLOTS_UTC,
  BAD as _BAD,
  judgeQuietRange,
  isSweepPublication,
} from "../tools/site-sentinel.mjs";

const W_1010 = "33306f30851b245fb5ced97e28062c92e770293c";
const W_1011 = "5d878f3c55bf6de671ed66b3c7688b05e34c1dec";
const S102 = { n: 102, sha: "0cca7f2b08a330462d90d2b54c9c66c7f1cb4764" };
const S101 = { n: 101, sha: "53b918de6783cea4f55d001ed47686e2d6faca15" };
const RECEIPT = (over = {}) => ({ at: "2026-10-11T18:00:00Z", status: "published", world_from: "aaaa0000", world_to: W_1011, refusal: null, detail: "9 published", ...over });
const at = (iso) => Date.parse(iso);

test("§11 the hour is the ruling's, named; the slots are the timer's own OnCalendar lines", () => {
  assert.equal(SETTLEMENT_GRACE_MS, 60 * MINUTE);
  assert.equal(CONFIG.settlement.graceMs, SETTLEMENT_GRACE_MS);
  const OFFICE = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
  const unit = readFileSync(join(OFFICE, "deploy", CONFIG.settlement.unit), "utf8");
  const hours = [...unit.matchAll(/^OnCalendar=\*-\*-\* (\d\d):00:00 UTC\s*$/gm)].map((m) => Number(m[1])).sort((a, b) => a - b);
  assert.deepEqual(hours, [...SETTLEMENT_SLOTS_UTC], `${CONFIG.settlement.unit} fires at ${hours} UTC; the probe expects ${SETTLEMENT_SLOTS_UTC}`);
  assert.equal(newestSettlementSlot(at("2026-10-11T19:14:00Z")), at("2026-10-11T18:00:00Z"));
  assert.equal(newestSettlementSlot(at("2026-10-11T05:59:00Z")), at("2026-10-10T18:00:00Z"), "before 06:00 the newest slot is yesterday's 18:00");
  assert.equal(newestSettlementSlot(at("2026-10-11T06:00:00Z")), at("2026-10-11T06:00:00Z"));
});

test("§11 REAL CASE 10-11 18:00Z: published 5d878f3c, newest still S102, 74 min on — DOWN, and the reason says what to do", () => {
  const r = classifySettlement({
    receipt: RECEIPT(), newestTag: S102, covered: false,
    nowMs: at("2026-10-11T19:14:00Z"), writtenAtMs: at("2026-10-11T18:01:30Z"),
  });
  assert.equal(r.verdict, "DOWN");
  assert.equal(r.reason, "the 18:00Z sweep published 5d878f3c at 18:01Z and no settlement tag covers it after 74 min (newest is S102 on 0cca7f2b): blocked, ours to unblock (postmark-telemetry SHIPPING.md § 9)");
  assert.equal(r.detail.newest_tag, "S102");
  assert.equal(r.detail.covered, false);
  assert.ok(_BAD.has(r.verdict), "DOWN alarms, and /fleet barks on it");
});

test("§11 the same sweep inside the hour is OK: awaiting the blessing, with the minute it will bark", () => {
  const r = classifySettlement({ receipt: RECEIPT(), newestTag: S102, covered: false, nowMs: at("2026-10-11T18:40:00Z") });
  assert.equal(r.verdict, "OK");
  assert.match(r.reason, /awaiting the blessing, 40 min since the sweep \(newest is S102 on 0cca7f2b; it barks at 19:00Z\)/);
  // the hour exactly is still inside; a minute past is not
  assert.equal(classifySettlement({ receipt: RECEIPT(), newestTag: S102, covered: false, nowMs: at("2026-10-11T19:00:00Z") }).verdict, "OK");
  assert.equal(classifySettlement({ receipt: RECEIPT(), newestTag: S102, covered: false, nowMs: at("2026-10-11T19:01:00Z") }).verdict, "DOWN");
});

test("§11 REAL CASE 10-10 18:00Z: 33306f30 uncovered by S101 is DOWN overnight; S102 on a descendant covers it", () => {
  const receipt = RECEIPT({ at: "2026-10-10T18:00:00Z", world_to: W_1010 });
  const night = classifySettlement({ receipt, newestTag: S101, covered: false, nowMs: at("2026-10-10T23:00:00Z") });
  assert.equal(night.verdict, "DOWN");
  assert.match(night.reason, /published 33306f30 and no settlement tag covers it after 5h \(newest is S101 on 53b918de\)/);

  // the tag is NOT the world's own commit — covered by descent (compare: ahead)
  const morning = classifySettlement({ receipt, newestTag: S102, covered: true, nowMs: at("2026-10-11T05:59:00Z") });
  assert.equal(morning.verdict, "OK");
  assert.equal(morning.reason, "S102 covers the 18:00Z sweep (33306f30)");
});

test("§11 a tag ON the world covers it with no question asked — `covered` unread does not matter", () => {
  const r = classifySettlement({ receipt: RECEIPT(), newestTag: { n: 103, sha: W_1011 }, covered: null, nowMs: at("2026-10-11T19:30:00Z") });
  assert.equal(r.verdict, "OK");
  assert.equal(r.reason, "S103 covers the 18:00Z sweep (5d878f3c)");
  assert.equal(r.detail.covered, true);
});

test("§11 a refused, raced or starving sweep is DOWN an hour on, naming the slot, the status and the refusal's first line", () => {
  const refused = RECEIPT({
    status: "refused", world_to: "",
    refusal: { cause: "lint: 2 errors in marks/foo.md\nsecond line never shown" },
    detail: "sweep tripped: lint …",
  });
  const r = classifySettlement({ receipt: refused, newestTag: S102, covered: null, nowMs: at("2026-10-11T19:05:00Z") });
  assert.equal(r.verdict, "DOWN");
  assert.equal(r.reason, `the 18:00Z sweep ended "refused" and nothing has settled after 65 min: lint: 2 errors in marks/foo.md; blocked, ours to unblock (postmark-telemetry SHIPPING.md § 9)`);
  assert.doesNotMatch(r.reason, /second line/);

  // no classifier verdict: the report's own detail is the line
  const race = classifySettlement({ receipt: RECEIPT({ status: "race", detail: "world main moved underneath the sweep — rerun" }), newestTag: S102, nowMs: at("2026-10-11T19:05:00Z") });
  assert.equal(race.verdict, "DOWN");
  assert.match(race.reason, /ended "race" .*: world main moved underneath the sweep — rerun;/);
  assert.equal(classifySettlement({ receipt: RECEIPT({ status: "starving" }), newestTag: S102, nowMs: at("2026-10-11T19:05:00Z") }).verdict, "DOWN");

  // a status nobody knows is not clean — it cannot answer "did it settle" yes
  assert.equal(classifySettlement({ receipt: RECEIPT({ status: "weird" }), newestTag: S102, covered: true, nowMs: at("2026-10-11T19:05:00Z") }).verdict, "DOWN");

  // inside the hour a refusal still has its rerun window
  const early = classifySettlement({ receipt: refused, newestTag: S102, nowMs: at("2026-10-11T18:20:00Z") });
  assert.equal(early.verdict, "OK");
  assert.match(early.reason, /ended "refused" 20 min ago \(lint: 2 errors in marks\/foo\.md\); inside the 1h window for a rerun/);
});

// THE REAL SHAPE OF A QUIET SWEEP. The keeper tags publications, never quiet
// crossings, and main always moves between sweeps — so a quiet sweep's world is
// a DESCENDANT of the newest tag. Copied in shape from postmark-world between
// S102 (0cca7f2b, `settlement: sweep 11 published`) and 5d878f3c: a crossing-
// save, a PR merge, the registry re-derive. (The first version of this test
// stood the quiet sweep ON the tag's own commit, which the world never does,
// and so hid a probe that paged on every quiet sweep.)
const commit = (sha, message) => ({ sha, commit: { message } });
const PAST_S102 = [
  commit("63114299aaaa", "crossing-save 243: 152 entities, 189 events"),
  commit("b0db90f0aaaa", "Merge pull request #185 from postmark-town/w43/conflict-matrix\n\nconsent: …"),
  commit("532655adaaaa", "settlement: household registry re-derived from the town at dcb5dbc89"),
];
const QUIET_HEAD = "532655adaaaa";
const QUIET = (over = {}) => RECEIPT({ at: "2026-10-12T06:00:00Z", status: "quiet", world_from: "6cd9ef91aaaa", world_to: QUIET_HEAD, detail: "nothing eligible; the household registry was refreshed and published", ...over });

test("§11 judgeQuietRange: a range of saves, merges and registry commits is covered; a sweep publication in it is held", () => {
  assert.deepEqual(judgeQuietRange({ status: "ahead", total_commits: 3, commits: PAST_S102 }), { covered: true, held: null, error: null });
  const withPub = [...PAST_S102.slice(0, 2), commit("5d878f3c55bf", "settlement: sweep 3 published, 0 unpublished, 0 left drafted, 0 withdrawn, 0 quarantined, 0 dropped, 0 re-framed"), PAST_S102[2]];
  assert.deepEqual(judgeQuietRange({ status: "ahead", total_commits: 4, commits: withPub }),
    { covered: false, held: { sha: "5d878f3c55bf", subject: "settlement: sweep 3 published, 0 unpublished, 0 left drafted, 0 withdrawn, 0 quarantined, 0 dropped, 0 re-framed" }, error: null });
  assert.deepEqual(judgeQuietRange({ status: "identical" }), { covered: true, held: null, error: null });
  assert.deepEqual(judgeQuietRange({ status: "behind", commits: [] }), { covered: true, held: null, error: null }, "a world behind the tag is blessed by it");
  // unread is never a guess
  assert.equal(judgeQuietRange({ status: "ahead", total_commits: 256, commits: PAST_S102 }).covered, null);
  assert.match(judgeQuietRange({ status: "ahead", total_commits: 256, commits: PAST_S102 }).error, /256 commits lie past the tag and GitHub lists only 3/);
  assert.equal(judgeQuietRange({ status: "ahead" }).covered, null);
  assert.equal(judgeQuietRange(null).covered, null);
  // what counts as a publication: the sweep's own subject with a nonzero count
  assert.equal(isSweepPublication("settlement: sweep 6 published, 0 unpublished, 0 left drafted"), true);
  assert.equal(isSweepPublication("settlement: sweep 0 published, 2 unpublished, 0 left drafted"), true, "an unpublication moves the record too");
  assert.equal(isSweepPublication("settlement: household registry re-derived from the town at dcb5dbc89"), false);
  assert.equal(isSweepPublication("crossing-save 243: 152 entities, 189 events"), false);
  // POS-1025: the printout's subject. The settlement's own number is not a count, so S214 alone never makes it one.
  assert.equal(isSweepPublication("settlement: S214 printout — 3 written, 0 removed, 0 re-framed"), true);
  assert.equal(isSweepPublication("settlement: S214 printout — 0 written, 1 removed, 0 re-framed"), true, "a removal moves the record too");
  assert.equal(isSweepPublication("settlement: S214 printout — 0 written, 0 removed, 0 re-framed"), false);
});

// ── §11 THE PRINTOUT'S REPORT-ONLY FINDINGS (POS-1025/c) ────────────────────
test("§11 a published printout whose harm gate named harm is DOWN at once, naming the check and the marks — no grace", () => {
  const receipt = RECEIPT({
    settlement: 214,
    harm: { ok: false, checks: [{ name: "moved", ok: false, count: 1, rows: ["neth/warm-stone: 10,10 -> 64,10 (no act names it)"] }, { name: "lint", ok: true, count: 0, rows: [] }] },
  });
  // the tag covers the world, and it is only five minutes after the sweep: neither saves it
  const r = classifySettlement({ receipt, newestTag: { n: 214, sha: W_1011 }, covered: true, nowMs: at("2026-10-11T18:05:00Z") });
  assert.equal(r.verdict, "DOWN");
  assert.match(r.reason, /published S214, and the harm gate named harm over its printout: moved: neth\/warm-stone: 10,10 -> 64,10/);
  assert.match(r.reason, /SHIPPING\.md § 9/);
  const couldNot = classifySettlement({ receipt: RECEIPT({ harm: { ok: false, ran: false, could_not_gate: "world 1234567 carries no tools/harm-gate.mjs" } }), newestTag: S102, covered: true, nowMs: at("2026-10-11T18:05:00Z") });
  assert.equal(couldNot.verdict, "DOWN");
  assert.match(couldNot.reason, /could not gate \(world 1234567 carries no tools\/harm-gate\.mjs\)/);
});

test("§11 a published printout whose tag or record refused is DOWN at once, and says a tag is never moved", () => {
  const tagged = classifySettlement({
    receipt: RECEIPT({ settlement: 214, tag: { status: "refused", refused: "tag-conflict", detail: "settlement/S214 already stands at 0cca7f2b08a3" } }),
    newestTag: S102, covered: false, nowMs: at("2026-10-11T18:05:00Z"),
  });
  assert.equal(tagged.verdict, "DOWN");
  assert.match(tagged.reason, /published S214, and its tag refused \(tag-conflict: settlement\/S214 already stands at 0cca7f2b08a3\); a settlement tag is never moved/);
  const recorded = classifySettlement({
    receipt: RECEIPT({ settlement: 214, tag: { status: "tagged" }, record: { status: "refused", refused: "record-tripped", detail: "no pen" } }),
    newestTag: { n: 214, sha: W_1011 }, covered: true, nowMs: at("2026-10-11T18:05:00Z"),
  });
  assert.equal(recorded.verdict, "DOWN");
  assert.match(recorded.reason, /the store's record of it refused \(record-tripped: no pen\)/);
});

test("§11 CONTROL: a published printout with no harm, tagged and recorded, under its own tag, is OK", () => {
  const receipt = RECEIPT({ settlement: 214, harm: { ok: true, checks: [] }, tag: { status: "tagged" }, record: { status: "recorded" } });
  const r = classifySettlement({ receipt, newestTag: { n: 214, sha: W_1011 }, covered: true, nowMs: at("2026-10-11T18:05:00Z") });
  assert.equal(r.verdict, "OK");
  assert.match(r.reason, /S214 covers the 18:00Z sweep/);
});

test("§11 a QUIET sweep on a world past the tag, with no publication in between, is OK — never a page", () => {
  const { covered, held } = judgeQuietRange({ status: "ahead", total_commits: 3, commits: PAST_S102 });
  const r = classifySettlement({ receipt: QUIET(), newestTag: S102, covered, held, nowMs: at("2026-10-12T09:00:00Z") });
  assert.equal(r.verdict, "OK");
  assert.equal(r.reason, "the 06:00Z sweep had nothing to publish, and no publication since S102 is unblessed (world at 532655ad)");
  // and standing ON the tag is OK with no question asked
  assert.equal(classifySettlement({ receipt: QUIET({ world_to: S102.sha }), newestTag: S102, nowMs: at("2026-10-12T09:00:00Z") }).verdict, "OK");
});

test("§11 a quiet morning does not clear a held night: a sweep publication past the tag is DOWN an hour on", () => {
  const range = [...PAST_S102.slice(0, 2), commit("5d878f3c55bf", "settlement: sweep 3 published, 0 unpublished, 0 left drafted, 0 withdrawn, 0 quarantined, 0 dropped, 0 re-framed"), PAST_S102[2]];
  const { covered, held } = judgeQuietRange({ status: "ahead", total_commits: 4, commits: range });
  const r = classifySettlement({ receipt: QUIET(), newestTag: S102, covered, held, nowMs: at("2026-10-12T07:10:00Z") });
  assert.equal(r.verdict, "DOWN");
  assert.equal(r.reason, `the 06:00Z sweep was quiet, standing on 532655ad, and 5d878f3c "settlement: sweep 3 published, 0 unpublished, 0 left drafted, 0 withdrawn, 0 quarantined, 0 dropped, 0 re-framed" still has no settlement tag after 70 min (newest is S102 on 0cca7f2b): an earlier sweep's publication is still unblessed: blocked, ours to unblock (postmark-telemetry SHIPPING.md § 9)`);
  assert.equal(r.detail.held.sha, "5d878f3c55bf");
  // inside the hour it waits, naming what it waits on
  const early = classifySettlement({ receipt: QUIET(), newestTag: S102, covered, held, nowMs: at("2026-10-12T06:30:00Z") });
  assert.equal(early.verdict, "OK");
  assert.match(early.reason, /5d878f3c "settlement: sweep 3 published.*" since S102 is awaiting the blessing, 30 min since the sweep \(it barks at 07:00Z\)/);
  // a range GitHub will not list in full is unread: STALE past the hour
  const long = judgeQuietRange({ status: "ahead", total_commits: 256, commits: range });
  const s = classifySettlement({ receipt: QUIET(), newestTag: S102, covered: long.covered, coverError: long.error, nowMs: at("2026-10-12T07:10:00Z") });
  assert.equal(s.verdict, "STALE");
  assert.match(s.reason, /cannot verify the 06:00Z sweep's blessing for 70 min: .*did not list what lies between S102 \(0cca7f2b\) and it \(256 commits lie past the tag/);
});

test("§11 wired, quiet: the compare is asked base=tag head=world, unpaginated, once; a held publication pages", async () => {
  const dir = tempDir("sentinel-settle-quiet-");
  const receipt = join(dir, "settlement-auto.json");
  _wf(receipt, JSON.stringify(QUIET({ at: "2026-08-25T06:00:01Z" })));
  const cfg = { ...FIXTURE_CONFIG, settlement: { ...CONFIG.settlement, receipt } };
  const urls = [];
  const clean = stubFetch({ ...GREEN_TABLE, [`https://api.github.com/repos/postmark-town/postmark-world/compare/worldtip0000...${QUIET_HEAD}`]: { status: 200, body: JSON.stringify({ status: "ahead", total_commits: 3, commits: PAST_S102 }) } });
  const t1 = await tick({ token: FIXTURE_TOKEN, fetchImpl: async (u, o) => { urls.push(String(u)); return clean(u, o); }, exec: stubExec(), state: {}, nowMs: T0, config: cfg, readDisk: GREEN_DISK });
  assert.equal(t1.probes.find((p) => p.key === "settlement").verdict, "OK");
  assert.deepEqual(t1.alerts, [], "a quiet sweep on a moved, clean world says nothing");
  assert.deepEqual(urls.filter((u) => u.includes("/compare/")), [`https://api.github.com/repos/postmark-town/postmark-world/compare/worldtip0000...${QUIET_HEAD}`]);
  assert.deepEqual(t1.nextState.stamps.settlement, { world: QUIET_HEAD, tag_sha: "worldtip0000", mode: "quiet", covered: true });

  const range = [commit("5d878f3c55bf", "settlement: sweep 3 published, 0 unpublished"), ...PAST_S102];
  const heldBase = stubFetch({ ...GREEN_TABLE, [`https://api.github.com/repos/postmark-town/postmark-world/compare/worldtip0000...${QUIET_HEAD}`]: { status: 200, body: JSON.stringify({ status: "ahead", total_commits: 4, commits: range }) } });
  let compares = 0;
  const heldFetch = async (u, o) => { if (String(u).includes("/compare/")) compares++; return heldBase(u, o); };
  const t2 = await tick({ token: FIXTURE_TOKEN, fetchImpl: heldFetch, exec: stubExec(), state: {}, nowMs: T0, config: cfg, readDisk: GREEN_DISK });
  const p2 = t2.probes.find((p) => p.key === "settlement");
  assert.equal(p2.verdict, "DOWN");
  assert.match(p2.reason, /5d878f3c "settlement: sweep 3 published, 0 unpublished" still has no settlement tag/);
  assert.deepEqual(t2.alerts.map((a) => a.key), ["settlement"]);
  // remembered WITH its held publication: the next tick names it without asking again
  const t3 = await tick({ token: FIXTURE_TOKEN, fetchImpl: heldFetch, exec: stubExec(), state: t2.nextState, nowMs: T0 + 10 * MINUTE, config: cfg, readDisk: GREEN_DISK });
  assert.equal(compares, 1);
  assert.match(t3.probes.find((p) => p.key === "settlement").reason, /5d878f3c "settlement: sweep 3 published/);
  assert.deepEqual(t3.alerts, []);
});

test("§11 a slot with no receipt an hour on is DOWN; inside the hour the previous receipt still speaks", () => {
  const morning = RECEIPT({ at: "2026-10-11T06:00:00Z", world_to: S102.sha });
  const r = classifySettlement({ receipt: morning, newestTag: S102, covered: null, nowMs: at("2026-10-11T19:14:00Z") });
  assert.equal(r.verdict, "DOWN");
  assert.match(r.reason, /^no sweep receipt for the 18:00Z slot after 74 min: the newest receipt is still the 2026-10-11T06:00:00Z sweep \(published\)/);
  assert.match(r.reason, /ours to unblock/);

  const inside = classifySettlement({ receipt: morning, newestTag: S102, covered: null, nowMs: at("2026-10-11T18:30:00Z") });
  assert.equal(inside.verdict, "OK", "the 18:00 sweep may still be running; the 06:00 one is covered");
  assert.match(inside.reason, /S102 covers the 06:00Z sweep/);
});

test("§11 INSIDE the hour, unread is UNKNOWN and never OK: no receipt, no `at`, no tags, no world, or coverage GitHub would not answer", () => {
  const now = at("2026-10-11T18:30:00Z");
  const none = classifySettlement({ receipt: null, readError: "ENOENT", nowMs: now, path: "/srv/postmark-harbor/settlement-auto.json" });
  assert.equal(none.verdict, "UNKNOWN");
  assert.match(none.reason, /could not read \/srv\/postmark-harbor\/settlement-auto\.json \(ENOENT\)/);
  assert.equal(classifySettlement({ receipt: RECEIPT({ at: "not a time" }), newestTag: S102, nowMs: now }).verdict, "UNKNOWN");
  assert.equal(classifySettlement({ receipt: RECEIPT(), newestTag: null, tagError: "git ls-remote failed: timeout", nowMs: now }).verdict, "UNKNOWN");
  assert.equal(classifySettlement({ receipt: RECEIPT({ world_to: "", world_from: "" }), newestTag: S102, nowMs: now }).verdict, "UNKNOWN");
  const unasked = classifySettlement({ receipt: RECEIPT(), newestTag: S102, covered: null, coverError: "GET /compare -> HTTP 502", nowMs: now });
  assert.equal(unasked.verdict, "UNKNOWN");
  assert.match(unasked.reason, /cannot verify the 18:00Z sweep's blessing yet: .*GitHub did not say whether S102 \(0cca7f2b\) descends from it \(GET \/compare -> HTTP 502\)/);
});

test("§11 PAST the hour, silence is not possible: a missing or unreadable receipt is DOWN as the missing slot", () => {
  const now = at("2026-10-11T19:14:00Z");
  for (const [receipt, readError, why] of [
    [null, "ENOENT", /could not read \/srv\/postmark-harbor\/settlement-auto\.json \(ENOENT\)/],
    [null, "Unexpected token } in JSON", /\(Unexpected token \} in JSON\)/],
    [RECEIPT({ at: "not a time" }), null, /carries no readable `at`/],
  ]) {
    const r = classifySettlement({ receipt, readError, newestTag: S102, nowMs: now, path: "/srv/postmark-harbor/settlement-auto.json" });
    assert.equal(r.verdict, "DOWN", String(why));
    assert.match(r.reason, /^no sweep receipt for the 18:00Z slot after 74 min: /);
    assert.match(r.reason, why);
    assert.match(r.reason, /ours to unblock/);
    assert.ok(_BAD.has(r.verdict));
  }
  // the hour is the newest SLOT's: at 18:59 the 18:00 slot is still inside it
  assert.equal(classifySettlement({ receipt: null, readError: "ENOENT", nowMs: at("2026-10-11T18:59:00Z") }).verdict, "UNKNOWN");
});

test("§11 PAST the hour, a sweep we cannot verify is STALE and names the error: tags unlisted, compare failed, no world", () => {
  const now = at("2026-10-11T19:14:00Z");
  const tags = classifySettlement({ receipt: RECEIPT(), newestTag: null, tagError: "git ls-remote failed: Could not resolve host: github.com", nowMs: now });
  assert.equal(tags.verdict, "STALE");
  assert.equal(tags.reason, "cannot verify the 18:00Z sweep's blessing for 74 min: could not list the world's settlement/S<n> tags (git ls-remote failed: Could not resolve host: github.com) to say whether anything covers 5d878f3c");

  const cmp = classifySettlement({ receipt: RECEIPT(), newestTag: S102, covered: null, coverError: "GET /repos/postmark-town/postmark-world/compare/x...y -> HTTP 502", nowMs: now });
  assert.equal(cmp.verdict, "STALE");
  assert.match(cmp.reason, /^cannot verify the 18:00Z sweep's blessing for 74 min: the 18:00Z sweep published 5d878f3c, and GitHub did not say whether S102 \(0cca7f2b\) descends from it \(GET .* -> HTTP 502\)$/);

  const noWorld = classifySettlement({ receipt: RECEIPT({ world_to: "", world_from: "" }), newestTag: S102, nowMs: now });
  assert.equal(noWorld.verdict, "STALE");
  assert.match(noWorld.reason, /names no world_to/);
  for (const r of [tags, cmp, noWorld]) assert.ok(_BAD.has(r.verdict), "STALE alarms, and /fleet barks on it");
});

test("§11 wired: a dead remote past the hour reaches the board STALE with git's own error, and a missing receipt DOWN", async () => {
  const dir = tempDir("sentinel-settle-dead-");
  const receipt = join(dir, "settlement-auto.json");
  _wf(receipt, JSON.stringify(RECEIPT({ at: "2026-08-25T06:00:01Z", world_to: "heldworld00" })));
  const deadWorld = (bin, args) => {
    if (args.some((a) => String(a).includes("postmark-world"))) throw new Error("fatal: unable to access 'https://github.com/postmark-town/postmark-world.git/': Could not resolve host");
    return stubExec()(bin, args);
  };
  const t1 = await tick({ token: FIXTURE_TOKEN, fetchImpl: stubFetch(GREEN_TABLE), exec: deadWorld, state: {}, nowMs: T0, config: { ...FIXTURE_CONFIG, settlement: { ...CONFIG.settlement, receipt } }, readDisk: GREEN_DISK });
  const p1 = t1.probes.find((p) => p.key === "settlement");
  assert.equal(p1.verdict, "STALE");
  assert.match(p1.reason, /cannot verify the 06:00Z sweep's blessing for 5h59m: could not list .*git ls-remote failed: fatal: unable to access .*Could not resolve host/);
  assert.deepEqual(t1.alerts.map((a) => a.key), ["settlement"]);

  const t2 = await tick({ token: FIXTURE_TOKEN, fetchImpl: stubFetch(GREEN_TABLE), exec: stubExec(), state: {}, nowMs: T0, config: { ...FIXTURE_CONFIG, settlement: { ...CONFIG.settlement, receipt: join(dir, "never-written.json") } }, readDisk: GREEN_DISK });
  const p2 = t2.probes.find((p) => p.key === "settlement");
  assert.equal(p2.verdict, "DOWN");
  assert.match(p2.reason, /^no sweep receipt for the 06:00Z slot after 6h: could not read .*never-written\.json \(ENOENT\)/);
  assert.deepEqual(t2.alerts.map((a) => a.key), ["settlement"]);
});

test("§11 newestSettlementTag: newest by NUMBER, peeled, and null rather than throwing", () => {
  const wire = () => [
    "t99\trefs/tags/settlement/S99", "c99\trefs/tags/settlement/S99^{}",
    "c102\trefs/tags/settlement/S102^{}", "t102\trefs/tags/settlement/S102",
    "t10\trefs/tags/settlement/S10", "c10\trefs/tags/settlement/S10^{}",
    "x\trefs/tags/settlement/S7-draft",
  ].join("\n") + "\n";
  assert.deepEqual(newestSettlementTag("https://x/w.git", { exec: wire }), { n: 102, tag: "settlement/S102", sha: "c102" },
    "S102 beats S99 and S10 (text order would pick S99), and the peeled line wins even when it lists first");
  assert.deepEqual(newestSettlementTag("https://x/w.git", { exec: () => "light\trefs/tags/settlement/S3\n" }), { n: 3, tag: "settlement/S3", sha: "light" }, "a lightweight tag's sha is its commit");
  assert.equal(newestSettlementTag("https://x/w.git", { exec: () => "" }), null);
  assert.equal(newestSettlementTag("https://x/w.git", { exec: () => { throw new Error("no network"); } }), null);
});

test("§11 wired: a held sweep reaches the board as `settlement`, asks GitHub ONCE per (world, tag) pair, and the bark says why", async () => {
  const dir = tempDir("sentinel-settle-");
  const receipt = join(dir, "settlement-auto.json");
  // T0 is 2026-08-25T12:00Z; the 06:00Z sweep published a world S50 is behind.
  _wf(receipt, JSON.stringify(RECEIPT({ at: "2026-08-25T06:00:01Z", world_to: "heldworld00" })));
  const cfg = { ...FIXTURE_CONFIG, settlement: { ...CONFIG.settlement, receipt } };
  let compares = 0;
  const table = {
    ...GREEN_TABLE,
    "https://api.github.com/repos/postmark-town/postmark-world/compare/heldworld00...worldtip0000": { status: 200, body: JSON.stringify({ status: "behind" }) },
  };
  const base = stubFetch(table);
  const fetchImpl = async (url, o) => { if (String(url).includes("/compare/")) compares++; return base(url, o); };

  const t1 = await tick({ token: FIXTURE_TOKEN, fetchImpl, exec: stubExec(), state: {}, nowMs: T0, config: cfg, readDisk: GREEN_DISK });
  const probe = t1.probes.find((p) => p.key === "settlement");
  assert.equal(probe.verdict, "DOWN");
  assert.equal(probe.kind, "settlement");
  assert.match(probe.reason, /the 06:00Z sweep published heldworl at \d\d:\d\dZ and no settlement tag covers it after 5h59m \(newest is S50 on worldtip\)/);
  assert.deepEqual(t1.alerts.map((a) => a.key), ["settlement"], "a held settlement on an otherwise green town alerts, and nothing else does");
  assert.deepEqual(t1.nextState.stamps.settlement, { world: "heldworld00", tag_sha: "worldtip0000", mode: "published", covered: false });
  const board = composeBoard({ probes: t1.probes, nowIso: t1.nowIso, alerting: {} });
  assert.equal(board.status, "DOWN");
  assert.match(composeMessage({ alerts: t1.alerts, board, nowIso: t1.nowIso }), /DOWN — the settlement: the 06:00Z sweep published heldworl/);

  // ten minutes on: same pair, remembered — no second compare, no second bark
  const t2 = await tick({ token: FIXTURE_TOKEN, fetchImpl, exec: stubExec(), state: t1.nextState, nowMs: T0 + 10 * MINUTE, config: cfg, readDisk: GREEN_DISK });
  assert.equal(compares, 1, "whether a commit descends from another never changes; ask once");
  assert.deepEqual(t2.alerts, []);

  // the keeper blesses ON the world: covered by equality, recovered, still one compare
  const t3 = await tick({ token: FIXTURE_TOKEN, fetchImpl, exec: stubExec({ settleSha: "heldworld00" }), state: t2.nextState, nowMs: T0 + 20 * MINUTE, config: cfg, readDisk: GREEN_DISK });
  assert.equal(t3.probes.find((p) => p.key === "settlement").reason, "S50 covers the 06:00Z sweep (heldworl)");
  assert.deepEqual(t3.alerts.map((a) => `${a.key}:${a.alert.kind}`), ["settlement:recovered"]);
  assert.equal(compares, 1);
});

// ── §12: the law pen (POS-619, Wright 2026-10-14) ───────────────────────────
//
// The state is the one deploy/world2-ingest.sh writes at every law fire. A
// refusal holds EVERY law update until the mark is fixed, so it pages with
// the lint's own sentence (test/world2-ingest-modes.test.mjs pins the field).

const LAW_REFUSAL = [
  `REFUSED: the law at ${"b".repeat(40)} carries 1 mark(s) with a value the parser would silently lose, so law_projection would hold less than the law says. Nothing was written; the law stays where it was (POS-619).`,
  '  WORLD/marks/the-keeping-works/candy/mark.md: dials: { stolen: true, clue: "No such thing as candy exists" } is not strict JSON, so the record keeps only its number pairs and silently drops stolen, clue (it reads as {}) — write it as strict JSON, every key quoted: dials: { "stolen": true, "clue": "No such thing as candy exists" }',
].join("\n");
const LAW_STATE = (over = {}) => JSON.stringify({ at: new Date(T0 - 2 * MINUTE).toISOString(), mode: "law", status: "ok", law: { exit: 0, sha: "a".repeat(40) }, detail: "law: ingested law", ...over });

test("§12 an ok run is OK", () => {
  assert.equal(CONFIG.lawPen.path, "/srv/world2-lab/state/ingest-law.json");
  const r = classifyLawPen({ raw: LAW_STATE(), nowMs: T0, staleAfterMs: CONFIG.lawPen.staleAfterMs });
  assert.equal(r.verdict, "OK");
  assert.match(r.reason, /^ingested the law at aaaaaaaaa/);
});

test("§12 a REFUSED law is DOWN, and the reason carries the refusal and the lint's sentence", () => {
  const r = classifyLawPen({ raw: LAW_STATE({ status: "law-failed", law: { exit: 1, sha: "b".repeat(40) }, refusal: LAW_REFUSAL }), nowMs: T0 });
  assert.equal(r.verdict, "DOWN");
  assert.match(r.reason, /^the law pen REFUSED the law, and every law update waits until the mark is fixed: REFUSED: the law at b{40} carries 1 mark/);
  assert.ok(r.reason.includes('WORLD/marks/the-keeping-works/candy/mark.md: dials: { stolen: true, clue: "No such thing as candy exists" } is not strict JSON'), r.reason);
});

test("§12 any other failed run is DOWN with its status; a 46-minute-old state is STALE; none is STALE, never UNKNOWN", () => {
  const failed = classifyLawPen({ raw: LAW_STATE({ status: "law-failed", law: { exit: 2, sha: "" }, detail: "law: checkout refresh failed: no clone" }), nowMs: T0 });
  assert.equal(failed.verdict, "DOWN");
  assert.match(failed.reason, /reads "law-failed" \(exit 2\) — the store's law did not advance: law: checkout refresh failed/);
  assert.equal(CONFIG.lawPen.staleAfterMs, 45 * MINUTE);
  assert.equal(classifyLawPen({ raw: LAW_STATE({ at: new Date(T0 - 46 * MINUTE).toISOString() }), nowMs: T0, staleAfterMs: CONFIG.lawPen.staleAfterMs }).verdict, "STALE");
  assert.equal(classifyLawPen({ raw: LAW_STATE({ at: new Date(T0 - 44 * MINUTE).toISOString() }), nowMs: T0, staleAfterMs: CONFIG.lawPen.staleAfterMs }).verdict, "OK");
  const missing = classifyLawPen({ raw: null, readError: "ENOENT", nowMs: T0, path: CONFIG.lawPen.path });
  assert.equal(missing.verdict, "STALE");
  assert.match(missing.reason, /no law pen state at \/srv\/world2-lab\/state\/ingest-law\.json \(ENOENT\)/);
  assert.equal(classifyLawPen({ raw: "{ half", nowMs: T0 }).verdict, "STALE");
});

test("§12 a HELD pin (law-pin-held, exit 0) is DOWN, and the reason names the pin and why (POS-628)", () => {
  const why = "[law-ingest] PIN HELD — projection_heads['world-law'] stays at b0db90f0644ee4a0719f4d02c3c4e3b2cc10fe22: this checkout cannot place the pin b0db90f0644e against ac5e54e0ce92 (a shallow checkout, or a pin it does not hold): the pin stays, and the rows for ac5e54e0ce92 are written beside it";
  const r = classifyLawPen({ raw: LAW_STATE({ status: "law-pin-held", law: { exit: 0, sha: "a".repeat(40) }, pin: { state: "held", sha: "b0db90f0644ee4a0719f4d02c3c4e3b2cc10fe22", why } }), nowMs: T0 });
  assert.equal(r.verdict, "DOWN", "a held pin read green: the 10-11 freeze, again");
  assert.match(r.reason, /^the law pen HELD the clearing's pin at b0db90f06, so every settlement seals that law until it moves: projection_heads\['world-law'\] stays at b0db90f/);
  assert.match(r.reason, /this checkout cannot place the pin/);
  assert.equal(r.detail.pin, "b0db90f0644ee4a0719f4d02c3c4e3b2cc10fe22");
});

test("§12 THE TICK: a refused law on the box pages through the one route, alone", async () => {
  const dir = tempDir("sentinel-lawpen-");
  const refused = join(dir, "ingest-law.json");
  _wf(refused, LAW_STATE({ status: "law-failed", law: { exit: 1, sha: "b".repeat(40) }, refusal: LAW_REFUSAL }));
  const config = { ...FIXTURE_CONFIG, lawPen: { ...FIXTURE_CONFIG.lawPen, path: refused } };
  const { probes, alerts } = await tick({ token: FIXTURE_TOKEN, fetchImpl: stubFetch(GREEN_TABLE), exec: stubExec(), state: {}, nowMs: T0, config, readDisk: GREEN_DISK });
  assert.equal(probes.find((p) => p.key === "law_pen").verdict, "DOWN");
  assert.deepEqual(alerts.map((a) => a.key), ["law_pen"], "the held law alerts, and nothing else does");
});

// ── §13: the Linear handler (POS-631, Wright 2026-10-14) ────────────────────
//
// Shapes copied from postmark-world's live run 38663576279 and its job
// 116190227156 (10-14): the job is `linear / linear`, and its steps are the
// checkout, setup-node, `linear` and `done line`.

const LH_URL = (repo) => `https://github.com/postmark-town/${repo}/actions/runs/38663576279`;
const LH_RUN = (over = {}) => ({ id: 38663576279, run_attempt: 1, name: "linear-handler", status: "completed", conclusion: "failure", event: "pull_request_target", created_at: "2026-08-25T11:40:00Z", html_url: LH_URL("postmark-world"), ...over });
const LH_JOB = ({ checkout = "success", linear = "success", doneLine = "skipped", conclusion = "failure" } = {}) => ({
  id: 116190227156, name: "linear / linear", status: "completed", conclusion,
  steps: [
    { name: "Set up job", conclusion: "success" },
    { name: "Run actions/checkout@11d5960a326750d5838078e36cf38b85af677262", conclusion: checkout },
    { name: "Run actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020", conclusion: checkout === "success" ? "success" : "skipped" },
    { name: "linear", conclusion: checkout === "success" ? linear : "skipped" },
    { name: "done line", conclusion: doneLine },
    { name: "Complete job", conclusion: "success" },
  ],
});
const LH_GENERIC = { annotation_level: "failure", message: "Process completed with exit code 2." };
const LH_TOLD = { annotation_level: "failure", title: "linear", message: "handler: Linear answered 401 (the app's secret was refused)" };
const LH_NOISE = { annotation_level: "warning", message: "Node.js 20 is deprecated." };

test("§13 a run that succeeded is OK; a failure in `linear` is DOWN naming the repo, the run and the handler's own line", () => {
  const ok = classifyLinearHandler({ repo: "postmark-world", runs: [LH_RUN({ conclusion: "success" })] });
  assert.equal(ok.verdict, "OK");
  const down = classifyLinearHandler({ repo: "postmark-world", runs: [LH_RUN()], jobs: [LH_JOB({ linear: "failure" })], annotations: [LH_NOISE, LH_GENERIC, LH_TOLD] });
  assert.equal(down.verdict, "DOWN");
  assert.equal(down.reason, `the handler could not act in postmark-world: the last finished run was "failure" and its linear step was "failure": handler: Linear answered 401 (the app's secret was refused) — ${LH_URL("postmark-world")}`);
  assert.deepEqual(down.detail, { repo: "postmark-world", run_id: 38663576279, attempt: 1, conclusion: "failure", url: LH_URL("postmark-world"), step: "failure" });
});

test("§13 a `done line` failure after a successful `linear` is the PR author's to fix, and NEVER an alarm", () => {
  const r = classifyLinearHandler({ repo: "postmark-site", runs: [LH_RUN()], jobs: [LH_JOB({ linear: "success", doneLine: "failure" })] });
  assert.equal(r.verdict, "OK");
  assert.match(r.reason, /failed on its done line, which is the PR author's to fix and never an alarm/);
});

test("§13 G1: the handler did not act when a step before `linear` failed, at a startup_failure and at a timeout — all DOWN", () => {
  const checkout = classifyLinearHandler({ repo: "postmark", runs: [LH_RUN()], jobs: [LH_JOB({ checkout: "failure" })], annotations: [LH_GENERIC] });
  assert.equal(checkout.verdict, "DOWN");
  assert.match(checkout.reason, /its linear step was skipped \(a step before it failed\): Process completed with exit code 2; the reason is in the job summary — /);
  const startup = classifyLinearHandler({ repo: "postmark", runs: [LH_RUN({ conclusion: "startup_failure" })], jobs: [] });
  assert.equal(startup.verdict, "DOWN");
  assert.equal(startup.reason, `the handler could not act in postmark: the last finished run was "startup_failure" and the run never started a job — ${LH_URL("postmark-world")}`, "no jobs, so no job summary to point at (review N2)");
  const timeout = classifyLinearHandler({ repo: "postmark", runs: [LH_RUN({ conclusion: "timed_out" })], jobs: [LH_JOB({ linear: "cancelled", conclusion: "timed_out" })] });
  assert.equal(timeout.verdict, "DOWN");
});

test("§13 W2: a cancelled newest run is looked THROUGH to the failure beneath it; nothing but cancellations is UNKNOWN; no run at all is INFO", () => {
  const runs = [LH_RUN({ id: 3, conclusion: "cancelled" }), LH_RUN({ id: 2, conclusion: "failure" }), LH_RUN({ id: 1, conclusion: "success" })];
  const r = classifyLinearHandler({ repo: "postmark-office", runs, jobs: [LH_JOB({ linear: "failure" })], annotations: [LH_TOLD] });
  assert.equal(r.verdict, "DOWN");
  assert.equal(r.detail.run_id, 2, "the run judged is the newest DECISIVE one");
  assert.equal(classifyLinearHandler({ repo: "postmark-office", runs: [LH_RUN({ conclusion: "cancelled" }), LH_RUN({ conclusion: "skipped" })] }).verdict, "UNKNOWN");
  assert.equal(classifyLinearHandler({ repo: "postmark-office", runs: [] }).verdict, "INFO");
});

test("§13 a 404 is two answers: no run yet is INFO, a repo the token cannot see is UNKNOWN; no token at all is UNKNOWN", () => {
  assert.equal(classifyLinearHandler({ repo: "postmark-office", notFound: true, repoVisible: true }).verdict, "INFO");
  const blind = classifyLinearHandler({ repo: "postmark-telemetry", notFound: true, repoVisible: false });
  assert.equal(blind.verdict, "UNKNOWN");
  assert.match(blind.reason, /cannot see postmark-telemetry \(404\).*needs Actions: read and Checks: read on it/);
  assert.equal(classifyLinearHandler({ repo: "postmark-telemetry", notFound: true, repoVisible: null }).verdict, "UNKNOWN");
  assert.equal(classifyLinearHandler({ repo: "postmark-world", haveToken: false, runs: [LH_RUN()] }).verdict, "UNKNOWN");
  assert.equal(classifyLinearHandler({ repo: "postmark-world", readError: "GET x -> HTTP 502" }).verdict, "UNKNOWN");
  assert.equal(classifyLinearHandler({ repo: "postmark-world", runs: [LH_RUN()], jobs: null }).verdict, "UNKNOWN", "a failed run whose jobs went unread names no step, so it is unread, never a guess");
});

test("§13 the reason's last clause: the handler's own failure line, past GitHub's generic exit line and any warning", () => {
  assert.equal(handlerFailureLine([LH_NOISE, LH_GENERIC, LH_TOLD]), "handler: Linear answered 401 (the app's secret was refused)");
  assert.equal(handlerFailureLine([LH_GENERIC]), "Process completed with exit code 2; the reason is in the job summary");
  assert.equal(handlerFailureLine(null), "the reason is in the job summary");
});

/** stubFetch that also writes down every URL it was asked for. */
function countingFetch(table) {
  const inner = stubFetch(table);
  const urls = [];
  const f = async (url, init) => { urls.push(String(url)); return inner(url, init); };
  f.handler = () => urls.filter((u) => /linear-handler\.yml|\/actions\/runs\/|\/check-runs\/|^https:\/\/api\.github\.com\/repos\/postmark-town\/[^/]+$/.test(u));
  return f;
}
const LH_KEYS = ["postmark_office", "postmark_site", "postmark_world", "postmark", "postmark_blueprints", "postmark_telemetry"].map((r) => `linear_handler_${r}`);
const lhRuns = (repo, runs) => ({ [`https://api.github.com/repos/postmark-town/${repo}/actions/workflows/linear-handler.yml/runs`]: { status: 200, body: JSON.stringify({ total_count: runs.length, workflow_runs: runs }) } });
const WORLD_DOWN = {
  ...GREEN_TABLE,
  ...lhRuns("postmark-world", [LH_RUN()]),
  "https://api.github.com/repos/postmark-town/postmark-world/actions/runs/38663576279/jobs": { status: 200, body: JSON.stringify({ total_count: 1, jobs: [LH_JOB({ linear: "failure" })] }) },
  "https://api.github.com/repos/postmark-town/postmark-world/check-runs/116190227156/annotations": { status: 200, body: JSON.stringify([LH_NOISE, LH_GENERIC, LH_TOLD]) },
};

test("§13 THE TICK, healthy: one row per repo, kind workflow, all OK, and only the six runs reads (no jobs for a run that succeeded)", async () => {
  const f = countingFetch(GREEN_TABLE);
  const { probes, alerts } = await tick({ token: FIXTURE_TOKEN, fetchImpl: f, exec: stubExec(), state: {}, nowMs: T0, config: FIXTURE_CONFIG, readDisk: GREEN_DISK });
  const rows = probes.filter((p) => p.key.startsWith("linear_handler_"));
  assert.deepEqual(rows.map((p) => p.key), LH_KEYS);
  assert.deepEqual(rows.map((p) => `${p.kind}:${p.verdict}`), Array(6).fill("workflow:OK"));
  assert.equal(rows[0].label, "the Linear handler in postmark-office");
  assert.equal(f.handler().length, 6);
  assert.equal(alerts.length, 0);
});

test("§13 W4: with no token the six rows are UNKNOWN and the probe spends NOTHING", async () => {
  const f = countingFetch(GREEN_TABLE);
  const { probes, alerts } = await tick({ fetchImpl: f, exec: stubExec(), state: {}, nowMs: T0, config: FIXTURE_CONFIG, readDisk: GREEN_DISK });
  assert.deepEqual(probes.filter((p) => p.key.startsWith("linear_handler_")).map((p) => p.verdict), Array(6).fill("UNKNOWN"));
  assert.deepEqual(f.handler(), [], "not one handler read without a token");
  assert.equal(alerts.length, 0);
});

test("§13 THE TICK: a failed `linear` pages once through the one route; the next tick reads no jobs; a green re-run recovers it", async () => {
  const f1 = countingFetch(WORLD_DOWN);
  const one = await tick({ token: FIXTURE_TOKEN, fetchImpl: f1, exec: stubExec(), state: {}, nowMs: T0, config: FIXTURE_CONFIG, readDisk: GREEN_DISK });
  const row = one.probes.find((p) => p.key === "linear_handler_postmark_world");
  assert.equal(row.verdict, "DOWN");
  assert.match(row.reason, /handler: Linear answered 401/);
  assert.deepEqual(one.alerts.map((a) => `${a.key}:${a.alert.kind}`), ["linear_handler_postmark_world:onset"], "the failed handler alerts, and nothing else does");
  assert.equal(f1.handler().length, 8, "six runs reads, then the failed run's jobs and its annotations");
  assert.equal(one.nextState.stamps.linear_handler["postmark-world"].run_id, 38663576279);

  // Ten minutes on, the same failed attempt: remembered, so no jobs read, and the same bad says nothing new.
  const f2 = countingFetch(WORLD_DOWN);
  const two = await tick({ token: FIXTURE_TOKEN, fetchImpl: f2, exec: stubExec(), state: one.nextState, nowMs: T0 + 10 * MINUTE, config: FIXTURE_CONFIG, readDisk: GREEN_DISK });
  assert.equal(two.probes.find((p) => p.key === "linear_handler_postmark_world").reason, row.reason);
  assert.equal(f2.handler().length, 6, "a finished attempt is read once");
  assert.equal(two.alerts.length, 0);

  // Re-run: the same run id, attempt 2, succeeded.
  const back = { ...WORLD_DOWN, ...lhRuns("postmark-world", [LH_RUN({ run_attempt: 2, conclusion: "success" })]) };
  const three = await tick({ token: FIXTURE_TOKEN, fetchImpl: stubFetch(back), exec: stubExec(), state: two.nextState, nowMs: T0 + 20 * MINUTE, config: FIXTURE_CONFIG, readDisk: GREEN_DISK });
  assert.deepEqual(three.alerts.map((a) => `${a.key}:${a.alert.kind}`), ["linear_handler_postmark_world:recovered"]);
  assert.equal(three.nextState.stamps.linear_handler["postmark-world"], undefined, "nothing to remember about a run that succeeded");
});

test("§13 W1: a second repo failing while the first is still down speaks for itself", async () => {
  const one = await tick({ token: FIXTURE_TOKEN, fetchImpl: stubFetch(WORLD_DOWN), exec: stubExec(), state: {}, nowMs: T0, config: FIXTURE_CONFIG, readDisk: GREEN_DISK });
  const site = { ...WORLD_DOWN,
    ...lhRuns("postmark-site", [LH_RUN({ id: 77, html_url: LH_URL("postmark-site") })]),
    "https://api.github.com/repos/postmark-town/postmark-site/actions/runs/77/jobs": { status: 200, body: JSON.stringify({ jobs: [LH_JOB({ linear: "failure" })] }) },
    "https://api.github.com/repos/postmark-town/postmark-site/check-runs/116190227156/annotations": { status: 200, body: JSON.stringify([LH_GENERIC]) },
  };
  const two = await tick({ token: FIXTURE_TOKEN, fetchImpl: stubFetch(site), exec: stubExec(), state: one.nextState, nowMs: T0 + 10 * MINUTE, config: FIXTURE_CONFIG, readDisk: GREEN_DISK });
  assert.deepEqual(two.alerts.map((a) => `${a.key}:${a.alert.kind}`), ["linear_handler_postmark_site:onset"]);
});

test("§13 THE TICK: a repo with no run yet is INFO, the private repo the token cannot see is UNKNOWN, and neither pages", async () => {
  const table = { ...GREEN_TABLE,
    // office: the workflow 404s, the repo answers (the caller is not on main yet)
    "https://api.github.com/repos/postmark-town/postmark-office/actions/workflows/linear-handler.yml/runs": { status: 404, body: "{}" },
    "https://api.github.com/repos/postmark-town/postmark-office": { status: 200, body: JSON.stringify({ full_name: "postmark-town/postmark-office" }) },
    // telemetry: both 404 (the token cannot see a private repo)
    "https://api.github.com/repos/postmark-town/postmark-telemetry/actions/workflows/linear-handler.yml/runs": { status: 404, body: "{}" },
  };
  const f = countingFetch(table);
  const { probes, alerts } = await tick({ token: FIXTURE_TOKEN, fetchImpl: f, exec: stubExec(), state: {}, nowMs: T0, config: FIXTURE_CONFIG, readDisk: GREEN_DISK });
  assert.equal(f.handler().length, 8, "each workflow 404 costs one repo read, every tick: the budget's upper end is 12");
  assert.equal(probes.find((p) => p.key === "linear_handler_postmark_office").verdict, "INFO");
  const tel = probes.find((p) => p.key === "linear_handler_postmark_telemetry");
  assert.equal(tel.verdict, "UNKNOWN");
  assert.match(tel.reason, /needs Actions: read/);
  assert.equal(alerts.length, 0);
});

test("§13 the memory is keyed by ATTEMPT: a re-run that fails only on its done line is read again and goes OK", async () => {
  const one = await tick({ token: FIXTURE_TOKEN, fetchImpl: stubFetch(WORLD_DOWN), exec: stubExec(), state: {}, nowMs: T0, config: FIXTURE_CONFIG, readDisk: GREEN_DISK });
  assert.equal(one.probes.find((p) => p.key === "linear_handler_postmark_world").verdict, "DOWN");
  // The same run id comes back as attempt 2: `linear` succeeded, the done line failed.
  const rerun = { ...WORLD_DOWN,
    ...lhRuns("postmark-world", [LH_RUN({ run_attempt: 2 })]),
    "https://api.github.com/repos/postmark-town/postmark-world/actions/runs/38663576279/jobs": { status: 200, body: JSON.stringify({ jobs: [LH_JOB({ linear: "success", doneLine: "failure" })] }) },
  };
  const f = countingFetch(rerun);
  const two = await tick({ token: FIXTURE_TOKEN, fetchImpl: f, exec: stubExec(), state: one.nextState, nowMs: T0 + 10 * MINUTE, config: FIXTURE_CONFIG, readDisk: GREEN_DISK });
  const row = two.probes.find((p) => p.key === "linear_handler_postmark_world");
  assert.equal(row.verdict, "OK", "attempt 1's DOWN must not be served for attempt 2");
  assert.match(row.reason, /failed on its done line/);
  assert.ok(f.handler().some((u) => u.endsWith("/actions/runs/38663576279/jobs")), "the new attempt's jobs are read");
  assert.deepEqual(two.alerts.map((a) => `${a.key}:${a.alert.kind}`), ["linear_handler_postmark_world:recovered"]);
  assert.equal(two.nextState.stamps.linear_handler["postmark-world"].attempt, 2);
});

test("§13 an annotations read refused with a 4xx (no Checks: read) is asked ONCE: the row is remembered and still DOWN", async () => {
  const noChecks = { ...WORLD_DOWN, "https://api.github.com/repos/postmark-town/postmark-world/check-runs/116190227156/annotations": { status: 403, body: "{}" } };
  const one = await tick({ token: FIXTURE_TOKEN, fetchImpl: stubFetch(noChecks), exec: stubExec(), state: {}, nowMs: T0, config: FIXTURE_CONFIG, readDisk: GREEN_DISK });
  const row = one.probes.find((p) => p.key === "linear_handler_postmark_world");
  assert.equal(row.verdict, "DOWN", "a token without Checks still alarms");
  assert.match(row.reason, /its linear step was "failure": the reason is in the job summary — https:/);
  assert.equal(one.nextState.stamps.linear_handler["postmark-world"].run_id, 38663576279);
  const f = countingFetch(noChecks);
  await tick({ token: FIXTURE_TOKEN, fetchImpl: f, exec: stubExec(), state: one.nextState, nowMs: T0 + 10 * MINUTE, config: FIXTURE_CONFIG, readDisk: GREEN_DISK });
  assert.equal(f.handler().length, 6, "no jobs and no annotations read on the next tick");
});

test("§13 N1: a failed runs read keeps the repo's memory, so the blip costs no re-read when GitHub answers again", async () => {
  const one = await tick({ token: FIXTURE_TOKEN, fetchImpl: stubFetch(WORLD_DOWN), exec: stubExec(), state: {}, nowMs: T0, config: FIXTURE_CONFIG, readDisk: GREEN_DISK });
  const blip = { ...WORLD_DOWN, "https://api.github.com/repos/postmark-town/postmark-world/actions/workflows/linear-handler.yml/runs": { status: 502, body: "" } };
  const two = await tick({ token: FIXTURE_TOKEN, fetchImpl: stubFetch(blip), exec: stubExec(), state: one.nextState, nowMs: T0 + 10 * MINUTE, config: FIXTURE_CONFIG, readDisk: GREEN_DISK });
  assert.equal(two.probes.find((p) => p.key === "linear_handler_postmark_world").verdict, "UNKNOWN");
  assert.deepEqual(two.nextState.stamps.linear_handler["postmark-world"], one.nextState.stamps.linear_handler["postmark-world"]);
  const f = countingFetch(WORLD_DOWN);
  const three = await tick({ token: FIXTURE_TOKEN, fetchImpl: f, exec: stubExec(), state: two.nextState, nowMs: T0 + 20 * MINUTE, config: FIXTURE_CONFIG, readDisk: GREEN_DISK });
  assert.equal(three.probes.find((p) => p.key === "linear_handler_postmark_world").verdict, "DOWN");
  assert.equal(f.handler().length, 6, "the remembered attempt is not read again");
});

// ── §14–§21: the store, the residents' 5xx, the certificates, the units, the backup, the trips, the change log and
//    the acknowledgement (POS-968, the STAR-161 sitting) ─────────────────────────────────────────────────────────────
//
// LAW (Darko, 2026-11-08 17:24 EST, verbatim, the condition over the whole sitting): "make sure that we don't
// accidentally drop any alarms in the move. false alarms are fine as long as we iterate and fix them as we find them."
// LAW (the sitting's call 2, option (i), ruled as the packet recommended, verbatim from the packet): "DOWN when
// residents get 5 or more 5xx on one route in a 10-minute run, or a kill coincides with a 500; WARN on a kill with no
// 500."
// THE INSTANCES these hold, measured on the box (G:/Starstory/docs/2026-11-08/alarms/packet.md § 2):
//   POS-965  GET /quests/<h> answered 503 70 times in the 18:00Z hour of 11-08, in bursts, with nothing ringing.
//   POS-963  a resident's GET /residents/<h> started 18:09:03.551Z and was answered 500 after 46,728 ms, beside
//            Postgres's idle-in-transaction kill, which the office logged at 18:09:50.275Z.
// The residents' handles are not in these fixtures: a route is masked on the board, and so it is here.

import {
  mostInWindow, routeOf, answeredAt, readAccessErrors, parseJournalJson, readOfficeJournal,
  classifyStoreHealth, classifyResident5xx, readServedCert, classifyCert, manifestUnitNames, parseFailedUnits,
  classifyFailedUnits, TRANSIENT_UNIT, classifyBackup, tripDoor, classifyOfficeTripped, judgeAcks, findingOf, applyAck,
  ACK_MAX_MS, appendHistory, besideState, readAcks,
} from "../tools/site-sentinel.mjs";
import { X509Certificate } from "node:crypto";
import { readdirSync as _rd } from "node:fs";

const OFFICE_ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const NEW_PROBE = /^(store_health|resident_5xx|cert_|failed_units|backup_outcome|office_tripped)/;
const newAlerts = (t) => t.alerts.filter((a) => NEW_PROBE.test(a.key)).map((a) => `${a.key}:${a.alert.kind}`);
const probeOf = (t, key) => t.probes.find((p) => p.key === key);
const at11 = (hms) => Date.parse(`2026-11-08T${hms}Z`);

// POS-965, the 70 quest-board 503s of 11-08 18:00Z, as the office's access log has them: each request's start and
// how long it took (start+ms).
const POS965 = `
  18:05:34.939+50 18:05:35.571+81 18:09:04.989+1085 18:10:14.531+3274 18:14:38.406+33 18:14:38.554+177
  18:14:38.750+156 18:14:39.059+157 18:14:44.577+27 18:14:49.375+14 18:17:34.917+215 18:17:41.168+24 18:17:41.395+184
  18:26:53.196+30 18:26:54.228+64 18:27:36.231+27 18:27:36.422+146 18:28:10.123+105 18:29:24.063+80 18:29:24.640+21
  18:30:04.185+106 18:30:04.875+754 18:30:04.877+758 18:30:04.877+764 18:30:08.141+9833 18:30:54.603+93
  18:30:55.817+80 18:34:45.548+61 18:34:46.065+56 18:34:46.560+13 18:35:53.964+160 18:35:53.965+205 18:35:53.964+236
  18:37:36.901+223 18:37:49.164+15 18:41:27.852+242 18:41:27.864+232 18:41:28.156+235 18:41:28.978+372
  18:41:35.808+211 18:41:35.808+215 18:41:35.813+227 18:41:37.166+10303 18:42:36.332+138 18:42:36.986+368
  18:42:36.508+880 18:42:36.666+723 18:44:20.229+118 18:44:22.534+62 18:44:33.646+26 18:44:33.646+38 18:44:33.709+87
  18:46:41.121+372 18:46:41.122+376 18:46:41.146+353 18:46:41.156+343 18:46:41.164+335 18:46:41.174+348
  18:46:41.501+1842 18:46:41.530+1918 18:46:41.543+1933 18:46:48.388+2574 18:47:03.251+16 18:47:21.370+95
  18:48:55.580+144 18:48:56.072+52 18:52:37.947+67 18:52:39.972+46 18:59:51.801+17 18:59:52.851+1889`
  .trim().split(/\s+/).map((s, i) => {
    const [hms, ms] = s.split("+");
    return { ts: `2026-11-08T${hms}Z`, method: "GET", path: `/quests/resident-${i % 7}`, status: 503, ms: Number(ms) };
  });
const POS963_500 = { ts: "2026-11-08T18:09:03.551Z", method: "GET", path: "/residents/a-resident", status: 500, ms: 46728 };
const KILL_MSG = "[store-pool pen] a held connection failed (officeRead): terminating connection due to idle-in-transaction timeout";
const POS963_KILL = JOURNAL_LINE(at11("18:09:50.275"), KILL_MSG);
const POS963_REST_TRIP = JOURNAL_LINE(at11("18:09:50.325"), "[office] answered 500 (the office tripped): Client has encountered a connection error and is not queryable");
const rowsOf = (lines) => lines.map((r) => ({ at: answeredAt(r), method: r.method, path: r.path, status: r.status }));

/**
 * The box at any clock: the store watch looks every minute and the sentinel's own GET /api/ lands every five, from
 * half an hour before `fromMs` to `toMs`, beside the test's own access lines; the backup shipped four hours before
 * `fromMs`. The probes outside §14–§19 that read the clock are left out; the rest keep their green fixtures.
 */
function boxAt(fromMs, toMs, { access = [], minutes = null, backup = null } = {}) {
  const dir = tempDir("sentinel-box-");
  const txn = join(dir, "store-txn-4380.json");
  const start = fromMs - 30 * MINUTE;
  _wf(txn, TXN_RECORD(minutes ?? Array.from({ length: Math.floor((toMs - start) / MINUTE) + 1 }, (_, i) => TXN_MINUTE(start + i * MINUTE))));
  const tel = join(dir, "telemetry");
  _mk(tel, { recursive: true });
  const own = Array.from({ length: Math.floor((toMs - start) / (5 * MINUTE)) + 1 }, (_, i) => JSON.parse(ACCESS_LINE(start + i * 5 * MINUTE)));
  const byDay = new Map();
  for (const r of [...own, ...access].sort((a, b) => answeredAt(a) - answeredAt(b))) {
    const day = new Date(answeredAt(r)).toISOString().slice(0, 10);
    byDay.set(day, [...(byDay.get(day) ?? []), JSON.stringify(r)]);
  }
  for (const [day, lines] of byDay) _wf(join(tel, `access-${day}.jsonl`), lines.join("\n") + "\n");
  const bk = join(dir, "backup.json");
  _wf(bk, backup ?? BACKUP({ at: new Date(fromMs - 4 * HOUR).toISOString().replace(/\.\d{3}Z$/, "Z") }));
  return {
    ...FIXTURE_CONFIG, settlement: null, linearHandler: null, lawPen: null, meeps: null, watchers: [], siteRefresh: null, clones: [], disk: null,
    storeHealth: { ...CONFIG.storeHealth, path: txn }, accessLog: { dir: tel }, backup: { ...CONFIG.backup, path: bk },
  };
}
const boxTick = (config, nowMs, { state = {}, acks = null, ...execOpts } = {}) =>
  tick({ token: FIXTURE_TOKEN, fetchImpl: stubFetch(GREEN_TABLE), exec: stubExec(execOpts), state, nowMs, config, acks });

test("§14–§19 the healthy tick carries every new probe, and every one is green", async () => {
  const t = await tick({ token: FIXTURE_TOKEN, fetchImpl: stubFetch(GREEN_TABLE), exec: stubExec(), state: {}, nowMs: T0, config: FIXTURE_CONFIG, readDisk: GREEN_DISK });
  const mine = t.probes.filter((p) => NEW_PROBE.test(p.key));
  assert.deepEqual(mine.map((p) => p.key), [
    "store_health", "resident_5xx", ...CONFIG.certs.hosts.map((h) => `cert_${h.replace(/[^a-z0-9]+/g, "_")}`), "failed_units", "backup_outcome", "office_tripped",
  ]);
  assert.deepEqual(mine.filter((p) => p.verdict !== "OK").map((p) => `${p.key}:${p.verdict} ${p.reason}`), []);
  assert.equal(CONFIG.certs.hosts.length, 12);
  assert.deepEqual(newAlerts(t), []);
});

// ── §15 ──

test("§15 routeOf masks every segment past the door, and the town's namespaced doors keep their second", () => {
  assert.equal(routeOf("GET", "/quests/ari"), "GET /quests/<h>");
  assert.equal(routeOf("GET", "/residents/ari/sheet"), "GET /residents/<h>/<h>");
  assert.equal(routeOf("POST", "/world/apex"), "POST /world/apex");
  assert.equal(routeOf("GET", "/world/conversations/t1794005139810-joy"), "GET /world/conversations/<h>");
  assert.equal(routeOf("GET", "/.well-known/oauth-protected-resource/api/mcp"), "GET /.well-known/oauth-protected-resource/<h>/<h>");
  assert.equal(routeOf("POST", "/mcp"), "POST /mcp");
  assert.equal(routeOf("GET", "/"), "GET /");
  assert.notEqual(routeOf("GET", "/world/apex"), routeOf("GET", "/world/walkers"), "two doors, not one door and a handle");
});

test("§15 mostInWindow counts the busiest span, its edges inside it", () => {
  assert.equal(mostInWindow([0, MINUTE, 2 * MINUTE, 11 * MINUTE], 10 * MINUTE), 3);
  assert.equal(mostInWindow([0, 10 * MINUTE], 10 * MINUTE), 2, "ten minutes apart is inside ten minutes");
  assert.equal(mostInWindow([0, 10 * MINUTE + 1], 10 * MINUTE), 1);
  assert.equal(mostInWindow([5, 1, 3], 10), 3, "unsorted in, counted sorted");
  assert.equal(mostInWindow([], 10 * MINUTE), 0);
});

test("§15 POS-965: the quest board's 503s are DOWN by 18:20Z, eleven inside ten minutes, named by route and never by handle", () => {
  const classify = (nowMs) => classifyResident5xx({ rows: rowsOf(POS965).filter((r) => r.at <= nowMs && r.at >= nowMs - CONFIG.events.lookbackMs), newestMs: nowMs - MINUTE, nowMs, sinceMs: nowMs - CONFIG.events.lookbackMs, windowMs: CONFIG.events.windowMs, threshold: CONFIG.resident5xx.threshold });
  const early = classify(at11("18:10:00"));
  assert.equal(early.verdict, "OK", "three by 18:10Z is under the ruled line");
  assert.match(early.reason, /^3 5xx answers in the last 25m, none 5 times on one route inside 10m: GET \/quests\/<h> 503 ×3$/);
  const r = classify(at11("18:20:00"));
  assert.equal(r.verdict, "DOWN", 'LAW (call 2 (i)): "5 or more 5xx on one route in a 10-minute run"');
  assert.equal(r.reason, "the office answered residents 5 or more 5xx on one route inside 10m: GET /quests/<h> 503 ×13 (11 inside 10m, the latest at 18:17:41Z)");
  assert.doesNotMatch(r.reason, /resident-\d/, "the board is public: no handle");
  assert.equal(r.finding, "GET /quests/<h> 503");
  assert.equal(r.detail.routes[0].most_in_window, 11);
});

test("§15 THE TICK replays 11-08 18:00Z every ten minutes: DOWN at 18:20Z, silent while it holds, recovered at 19:20Z", async () => {
  const config = boxAt(at11("18:00:00"), at11("19:40:00"), { access: POS965 });
  let state = {};
  const said = [];
  for (let m = 10; m <= 90; m += 10) {
    const nowMs = at11("18:00:00") + m * MINUTE;
    const t = await boxTick(config, nowMs, { state });
    said.push(`${new Date(nowMs).toISOString().slice(11, 16)} ${probeOf(t, "resident_5xx").verdict} ${newAlerts(t).join(",")}`.trim());
    state = t.nextState;
  }
  assert.deepEqual(said, [
    "18:10 OK", "18:20 DOWN resident_5xx:onset", "18:30 DOWN", "18:40 DOWN", "18:50 DOWN", "19:00 DOWN", "19:10 DOWN",
    "19:20 OK resident_5xx:recovered", "19:30 OK",
  ], "one bark within ten minutes of the burst, the same DOWN silent, one recovery");
});

test("§15 a burst split across two ticks is counted whole on the second (Darko: \"don't accidentally drop any alarms\")", async () => {
  const tickA = at11("12:00:00");
  const burst = [-3, -2, -1, 2, 3, 4].map((m) => ({ ts: new Date(tickA + m * MINUTE).toISOString(), method: "GET", path: "/mail/someone", status: 502, ms: 10 }));
  const config = boxAt(tickA, tickA + 20 * MINUTE, { access: burst });
  const a = await boxTick(config, tickA);
  assert.equal(probeOf(a, "resident_5xx").verdict, "OK", "three before the tick");
  const b = await boxTick(config, tickA + 10 * MINUTE, { state: a.nextState });
  assert.equal(probeOf(b, "resident_5xx").verdict, "DOWN", "six inside seven minutes, though only three landed since tick A");
  assert.match(probeOf(b, "resident_5xx").reason, /GET \/mail\/<h> 502 ×6 \(6 inside 10m/);
});

test("§15 under the line is named and never alarmed: 4 on one route, 5 over two routes, 5 on one route 11 minutes apart", () => {
  const nowMs = at11("12:30:00");
  const r = (spec) => classifyResident5xx({ rows: spec.map(([min, path, status = 503]) => ({ at: nowMs - min * MINUTE, method: "GET", path, status })), newestMs: nowMs, nowMs, sinceMs: nowMs - 25 * MINUTE, windowMs: 10 * MINUTE, threshold: 5 });
  assert.equal(r([[1, "/me"], [2, "/me"], [3, "/me"], [4, "/me"]]).verdict, "OK");
  const two = r([[1, "/me"], [2, "/me"], [3, "/me"], [1, "/mail/a"], [2, "/mail/b"]]);
  assert.equal(two.verdict, "OK");
  assert.match(two.reason, /GET \/me 503 ×3; GET \/mail\/<h> 503 ×2/);
  assert.equal(r([[1, "/me"], [2, "/me"], [3, "/me"], [13, "/me"], [14, "/me"]]).verdict, "OK", "five in the lookback, never five inside ten minutes");
  assert.equal(r([[1, "/me"], [2, "/me"], [3, "/me"], [9, "/me"], [10, "/me"]]).verdict, "DOWN");
  assert.equal(r([[1, "/me", 500], [2, "/me", 502], [3, "/me", 503], [4, "/me", 504], [5, "/me", 500]]).verdict, "DOWN", "any 5xx counts, mixed");
});

test("§15 an unread log and a silent log are STALE, never OK; the day files read cover a request answered past midnight", () => {
  const nowMs = Date.parse("2026-11-09T00:10:00Z");
  const sinceMs = nowMs - 25 * MINUTE;
  const unread = classifyResident5xx({ rows: null, readError: "EACCES", nowMs, sinceMs });
  assert.equal(unread.verdict, "STALE");
  assert.match(unread.reason, /could not read the office's access log \(EACCES\)/);
  const silent = classifyResident5xx({ rows: [], newestMs: null, nowMs, sinceMs, dir: "/srv/postmark-office/telemetry" });
  assert.equal(silent.verdict, "STALE");
  assert.match(silent.reason, /has no line answered in the last 25m/);

  const empty = tempDir("sentinel-access-none-");
  const none = readAccessErrors(empty, { sinceMs, nowMs });
  assert.equal(none.rows, null);
  assert.match(none.error, /no access log in .* for 2026-11-08 or 2026-11-09/);

  // A request that started 23:59:59 and was answered 00:00:01 lands in the next day's file, and is counted.
  const dir = tempDir("sentinel-access-midnight-");
  _wf(join(dir, "access-2026-11-08.jsonl"), `${ACCESS_LINE(Date.parse("2026-11-08T23:50:00Z"), { status: 503, path: "/me" })}\n`);
  _wf(join(dir, "access-2026-11-09.jsonl"), [
    ACCESS_LINE(Date.parse("2026-11-08T23:59:59Z"), { status: 500, path: "/me", ms: 2000 }),
    ACCESS_LINE(Date.parse("2026-11-09T00:05:00Z")),
    `{"ts":"2026-11-09T00:06:00.000Z","method":"GET","path":"/me","stat`,
  ].join("\n") + "\n");
  const read = readAccessErrors(dir, { sinceMs, nowMs });
  assert.deepEqual(read.rows.map((r) => `${new Date(r.at).toISOString()} ${r.status}`), ["2026-11-08T23:50:00.004Z 503", "2026-11-09T00:00:01.000Z 500"]);
  assert.equal(read.newestMs, Date.parse("2026-11-09T00:06:00.000Z"), "a torn last line throws nothing, and its ts still says the log is being written");
});

// ── §14 ──

const STORE_AT = (nowMs, over = {}) => classifyStoreHealth({
  txnRaw: TXN_RECORD(Array.from({ length: 30 }, (_, i) => TXN_MINUTE(nowMs - 29 * MINUTE + i * MINUTE))),
  kills: [], answered500: [], nowMs, sinceMs: nowMs - 25 * MINUTE, windowMs: 10 * MINUTE, staleAfterMs: 5 * MINUTE, path: "/srv/postmark-office/telemetry/store-txn-4380.json", ...over,
});

test("§14 POS-963: the kill at 18:09:50Z beside the resident's 500 is DOWN; the 20:09Z kill with no 500 beside it is a WARN", () => {
  const r = STORE_AT(at11("18:12:00"), { kills: [at11("18:09:50.275")], answered500: [answeredAt(POS963_500)] });
  assert.equal(r.verdict, "DOWN", 'LAW (call 2 (i)): "a kill coincides with a 500"');
  assert.equal(r.reason, "Postgres killed 1 office connection for idling in a transaction (18:09:50Z) and the office answered a resident 500 beside it (18:09:50Z): POS-963's shape");
  assert.deepEqual(r.detail.answered_500_beside, ["2026-11-08T18:09:50.279Z"]);
  const alone = STORE_AT(at11("20:12:00"), { kills: [at11("20:09:24.943")] });
  assert.equal(alone.verdict, "WARN", 'LAW (call 2 (i)): "WARN on a kill with no 500"');
  assert.match(alone.reason, /^Postgres killed 1 office connection for idling in a transaction \(20:09:24Z\), with no 500 within 10m of it$/);
  // a 500 eleven minutes from the kill is not beside it
  assert.equal(STORE_AT(at11("18:30:00"), { kills: [at11("18:09:50")], answered500: [at11("18:21:00")] }).verdict, "WARN");
  // and an access log it could not read cannot pair: still a WARN, saying why
  const blind = STORE_AT(at11("18:12:00"), { kills: [at11("18:09:50")], answered500: null, accessError: "EACCES" });
  assert.equal(blind.verdict, "WARN");
  assert.match(blind.reason, /the access log could not be read to say whether a 500 came of it \(EACCES\)/);
});

test("§14 the store watch: a stuck minute is a WARN naming the pid and the pool, never the query; an unasked minute too", () => {
  const nowMs = at11("18:12:00");
  const minutes = Array.from({ length: 30 }, (_, i) => TXN_MINUTE(nowMs - 29 * MINUTE + i * MINUTE + 10_605));
  // the store watch's worst_24h of 11-08, in its own words
  minutes[26] = TXN_MINUTE(at11("18:09:10.605"), { stuck: 1, stuck_sessions: [{ pid: 1730459, application_name: "postmark-office:pen:t2", state: "idle in transaction", idle_s: 6, xact_s: 6, query: "SELECT json FROM town_residents WHERE handle = $1" }] });
  const r = STORE_AT(nowMs, { txnRaw: TXN_RECORD(minutes) });
  assert.equal(r.verdict, "WARN");
  assert.equal(r.reason, "1 minute in the last 25m found a session idle inside a transaction for 5 s or more, the most at 18:09:10Z: 1 session, pid 1730459 (postmark-office:pen:t2) idle 6 s");
  assert.doesNotMatch(r.reason, /SELECT|town_residents/, "the board is public: no query");
  minutes[27] = TXN_MINUTE(at11("18:10:10.605"), { looked: false, error: "timeout expired" });
  const both = STORE_AT(nowMs, { txnRaw: TXN_RECORD(minutes) });
  assert.match(both.reason, /; 1 minute in the last 25m the store watch could not ask the store, the latest at 18:10:10Z$/);
  assert.doesNotMatch(both.reason, /timeout expired/);
  // a stuck minute beside a kill and a 500: DOWN leads, and the stuck minute is still said
  const down = STORE_AT(nowMs, { txnRaw: TXN_RECORD(minutes), kills: [at11("18:09:50.275")], answered500: [answeredAt(POS963_500)] });
  assert.equal(down.verdict, "DOWN");
  assert.match(down.reason, /^Postgres killed .*POS-963's shape; 1 minute .*idle 6 s; 1 minute .*could not ask the store/);
});

test("§14 a missing, torn or stale store watch, and an unread journal, are STALE: unread is never calm", () => {
  const nowMs = at11("18:12:00");
  const missing = STORE_AT(nowMs, { txnRaw: null, txnError: "ENOENT" });
  assert.equal(missing.verdict, "STALE");
  assert.match(missing.reason, /^there is no store watch record at \/srv\/postmark-office\/telemetry\/store-txn-4380\.json \(ENOENT\)/);
  assert.equal(STORE_AT(nowMs, { txnRaw: "{ half" }).verdict, "STALE");
  const old = STORE_AT(nowMs, { txnRaw: TXN_RECORD([TXN_MINUTE(nowMs - 6 * MINUTE)]) });
  assert.equal(old.verdict, "STALE");
  assert.match(old.reason, /last looked 6m ago, against a minute's cadence \(stale after 5m\)/);
  assert.equal(STORE_AT(nowMs, { txnRaw: TXN_RECORD([TXN_MINUTE(nowMs - 4 * MINUTE)]) }).verdict, "OK");
  const deaf = STORE_AT(nowMs, { kills: null, journalWhy: "spawnSync journalctl ENOENT" });
  assert.equal(deaf.verdict, "STALE");
  assert.match(deaf.reason, /the office's journal could not be read for Postgres's idle-in-transaction kills \(spawnSync journalctl ENOENT\)/);
  assert.equal(STORE_AT(nowMs).verdict, "OK");
  assert.match(STORE_AT(nowMs).reason, /^no session stuck in a transaction and no kill in the last 25m \(the watch looked at 18:12:00Z: 24 idle, 1 active\)$/);
});

test("§14 THE TICK, POS-963 end to end: the store reads DOWN, the REST door's trip WARNs, and §15 alone would have stayed OK", async () => {
  const nowMs = at11("18:12:00");
  const before = POS965.filter((r) => answeredAt(r) <= nowMs);
  const config = boxAt(at11("17:50:00"), nowMs, { access: [POS963_500, ...before] });
  const t = await boxTick(config, nowMs, { journal: [...GREEN_JOURNAL, POS963_KILL, POS963_REST_TRIP] });
  assert.equal(probeOf(t, "store_health").verdict, "DOWN");
  assert.match(probeOf(t, "store_health").reason, /POS-963's shape/);
  assert.equal(probeOf(t, "resident_5xx").verdict, "OK", "one 500 and four 503s are under the ruled line, so the store probe is the one that catches it");
  assert.equal(probeOf(t, "office_tripped").verdict, "WARN");
  assert.match(probeOf(t, "office_tripped").reason, /a REST door \(answered 500\) ×1 \(18:09:50Z\)/);
  assert.deepEqual(newAlerts(t), ["store_health:onset", "office_tripped:warn"]);
  const msg = composeMessage({ alerts: t.alerts, board: composeBoard({ probes: t.probes, nowIso: t.nowIso, alerting: {} }), nowIso: t.nowIso });
  assert.match(msg, /DOWN — the office's store: Postgres killed 1 office connection/);
  assert.match(msg, /the office's tripped doors: warning: the office tripped 1 time/);
  // a kill beside only 503s is a WARN, by the ruling's word 500
  const only503 = await boxTick(boxAt(at11("17:50:00"), nowMs, { access: before }), nowMs, { journal: [...GREEN_JOURNAL, POS963_KILL] });
  assert.equal(probeOf(only503, "store_health").verdict, "WARN");
});

test("§14/§19 a journal this user cannot see is STALE on both, and so is one journalctl cannot read", async () => {
  const nowMs = at11("18:12:00");
  const config = boxAt(at11("17:50:00"), nowMs);
  const blind = await boxTick(config, nowMs, { journal: [] });
  for (const key of ["store_health", "office_tripped"]) {
    assert.equal(probeOf(blind, key).verdict, "STALE", key);
    assert.match(probeOf(blind, key).reason, /journalctl shows no line of postmark-office\.service at all, so this user cannot see its journal/);
  }
  const quiet = readOfficeJournal("postmark-office.service", nowMs - 25 * MINUTE, { exec: stubExec() });
  assert.deepEqual([quiet.entries.length, quiet.seen], [1, true], "an old line proves sight: a quiet window is calm");
  const dead = readOfficeJournal("postmark-office.service", nowMs, { exec: () => { throw Object.assign(new Error("spawnSync journalctl ENOENT"), { code: "ENOENT" }); } });
  assert.deepEqual([dead.entries, dead.error], [null, "spawnSync journalctl ENOENT"]);
  assert.deepEqual(parseJournalJson(`${JSON.stringify({ __REALTIME_TIMESTAMP: "1794183242495395", MESSAGE: [104, 105] })}\nnot json\n`), [{ atMs: 1794183242495.395, message: "hi" }], "a MESSAGE of bytes is read as text");
});

// ── §16 ──

const CERT_NOT_AFTER = Date.parse(new X509Certificate(FIXTURE_CERT).validTo);
const DAY_MS = 24 * HOUR;

test("§16 readServedCert reads what openssl prints: the expiry, whether it names the host, and why it could not", () => {
  const read = readServedCert("dev.postmark.town", { exec: stubExec() });
  assert.deepEqual([read.notAfterMs, read.matches], [CERT_NOT_AFTER, true]);
  assert.equal(readServedCert("pages.postmark.town", { exec: stubExec() }).matches, false, "the fixture does not name pages, as 1f4ee's certificate does not");
  const refused = readServedCert("postmark.town", { exec: () => { throw Object.assign(new Error("Command failed: openssl s_client"), { stdout: "", stderr: "40C70C24EC7E0000:error:8000006F:system library:BIO_connect:Connection refused:../crypto/bio/bio_sock2.c:114:calling connect()\n" }); } });
  assert.match(refused.error, /^40C70C24EC7E0000:error:8000006F:system library:BIO_connect:Connection refused/);
  assert.match(readServedCert("postmark.town", { exec: () => "CONNECTED(00000003)\n---\nno peer certificate available\n" }).error, /printed no certificate/);
  assert.match(readServedCert("postmark.town", { exec: () => S_CLIENT("-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----") }).error, /does not parse/);
});

test("§16 the lines: under 21 days WARN, under 7 days or expired DOWN, a certificate that does not name its host DOWN, unread STALE", () => {
  const at = (daysLeft) => classifyCert({ host: "postmark.town", notAfterMs: CERT_NOT_AFTER, matches: true, nowMs: CERT_NOT_AFTER - daysLeft * DAY_MS, warnDays: 21, downDays: 7 });
  assert.equal(at(21.1).verdict, "OK");
  assert.equal(at(20.9).verdict, "WARN");
  assert.equal(at(7.1).verdict, "WARN");
  assert.equal(at(6.9).verdict, "DOWN");
  assert.equal(at(-1).verdict, "DOWN");
  assert.match(at(-1).reason, /^the certificate served for postmark\.town expired 1d ago \(2036-11-06T00:37:23\.000Z\)$/);
  const wrong = classifyCert({ host: "pages.postmark.town", notAfterMs: CERT_NOT_AFTER, matches: false, names: "DNS:1f4ee.town, DNS:www.1f4ee.town", nowMs: CERT_NOT_AFTER - 60 * DAY_MS });
  assert.equal(wrong.verdict, "DOWN", "a far expiry does not save a certificate that names another host");
  assert.match(wrong.reason, /serves pages\.postmark\.town a certificate that does not name it \(it names DNS:1f4ee\.town, DNS:www\.1f4ee\.town\)/);
  assert.equal(classifyCert({ host: "x", error: "Connection refused", nowMs: 0 }).verdict, "STALE");
  assert.equal(classifyCert({ host: "x", matches: true, notAfterMs: NaN, nowMs: 0 }).verdict, "STALE");
});

test("§16 dev's origin certificate as it stood on 11-09: a WARN now, DOWN from 11-12 22:42Z, STAR-151's deadline", () => {
  const dev = (nowIso) => classifyCert({ host: "dev.postmark.town", notAfterMs: Date.parse("2026-11-19T22:42:14Z"), matches: true, nowMs: Date.parse(nowIso), warnDays: CONFIG.certs.warnDays, downDays: CONFIG.certs.downDays });
  const now = dev("2026-11-09T00:46:31Z");
  assert.equal(now.verdict, "WARN");
  assert.equal(now.reason, "the certificate served for dev.postmark.town expires in 10.9 days (2026-11-19T22:42:14.000Z), under 21 days");
  assert.equal(dev("2026-11-12T22:41:00Z").verdict, "WARN");
  assert.equal(dev("2026-11-12T22:43:00Z").verdict, "DOWN");
});

test("§16 the host list covers every 443 server_name this repo's nginx files serve, and never pages.postmark.town", () => {
  const served = new Set();
  for (const f of _rd(join(OFFICE_ROOT, "deploy")).filter((n) => /^nginx-.*\.conf$/.test(n))) {
    const text = readFileSync(join(OFFICE_ROOT, "deploy", f), "utf8").replace(/#.*$/gm, "");
    for (const block of text.split(/^\s*server\s*\{/m).slice(1)) {
      if (!/^\s*listen\s+(\[::\]:)?443\b/m.test(block)) continue;
      for (const name of /^\s*server_name\s+([^;]+);/m.exec(block)?.[1].trim().split(/\s+/) ?? []) served.add(name);
    }
  }
  assert.ok(served.size >= 6, `read ${[...served]}; the parse is wrong`);
  for (const name of served) assert.ok(CONFIG.certs.hosts.includes(name), `${name} is served on 443 by deploy/nginx-*.conf and CONFIG.certs does not watch it`);
  assert.ok(!CONFIG.certs.hosts.includes("pages.postmark.town"), "pages has no DNS and no block of its own");
});

test("§16 THE TICK: one row per host, so a host that goes wrong speaks alone", async () => {
  const t = await tick({ token: FIXTURE_TOKEN, fetchImpl: stubFetch(GREEN_TABLE), exec: stubExec({ cert: (h) => (h === "meepo.online" ? new Error("Command failed: openssl s_client -connect 127.0.0.1:443 -servername meepo.online") : FIXTURE_CERT) }), state: {}, nowMs: T0, config: FIXTURE_CONFIG, readDisk: GREEN_DISK });
  const rows = t.probes.filter((p) => p.kind === "cert");
  assert.equal(rows.length, 12);
  assert.deepEqual(rows.filter((p) => p.verdict !== "OK").map((p) => `${p.key}:${p.verdict}`), ["cert_meepo_online:STALE"]);
  assert.equal(probeOf(t, "cert_meepo_online").label, "the certificate for meepo.online");
  assert.deepEqual(newAlerts(t), ["cert_meepo_online:onset"]);
});

// ── §17 ──

const RUN_U = [30367, 30370, 33555, 33565, 33566, 33570, 35758, 35860, 41136, 41158, 49892, 49901, 50323, 54397, 55707, 67445, 67468]
  .map((n) => `run-u${n}.service                  loaded failed failed /usr/bin/node a one-off by hand`);
const FAILED_1109 = ["certbot.service                     loaded failed failed Certbot", ...RUN_U,
  "wright-rerun-s83-1790426624.service loaded failed failed /usr/bin/systemctl start postmark-settlement.service"].join("\n") + "\n";
const MANIFEST = JSON.parse(readFileSync(CONFIG.failedUnits.manifest, "utf8"));

test("§17 the box's list of 11-09: certbot and a leftover rerun are a WARN, and 17 run-u* units are counted, never alarmed", () => {
  const r = classifyFailedUnits({ text: FAILED_1109, manifestNames: manifestUnitNames(MANIFEST) });
  assert.equal(r.verdict, "WARN");
  assert.equal(r.reason, "2 failed units, none the roll-call manifest names; and 17 transient run-u* units (counted, never alarmed)", "the public text: counts and the verdict, no name");
  assert.equal(r.said, "2 units outside the manifest failed: certbot.service; wright-rerun-s83-1790426624.service; and 17 transient run-u* units (counted, never alarmed)", "the private text names them");
  assert.deepEqual(r.detail, { failed: 2, in_manifest: 0, transient: 17 });
  const transientOnly = classifyFailedUnits({ text: RUN_U.join("\n"), manifestNames: manifestUnitNames(MANIFEST) });
  assert.equal(transientOnly.verdict, "OK", "a transient unit is never DOWN, nor a WARN");
  assert.match(transientOnly.reason, /^no unit has failed; and 17 transient run-u\* units/);
});

test("§17 a unit the roll-call manifest names is DOWN, by the service its timer starts: the 11-04 backup's failure", () => {
  const r = classifyFailedUnits({ text: "● postmark-world2-backup.service loaded failed failed World 2.0 durability\ncertbot.service loaded failed failed Certbot\n", manifestNames: manifestUnitNames(MANIFEST) });
  assert.equal(r.verdict, "DOWN");
  assert.equal(r.reason, "2 failed units, 1 the roll-call manifest names");
  assert.equal(r.said, "1 unit the roll-call manifest names failed: postmark-world2-backup.service (the World 2.0 durability lane); 1 unit outside the manifest failed: certbot.service");
  assert.equal(r.finding, "postmark-world2-backup.service|certbot.service");
  const names = manifestUnitNames(MANIFEST);
  for (const row of MANIFEST.units) {
    assert.ok(names.has(row.unit), row.unit);
    assert.ok(names.has(row.unit.replace(/\.timer$/, ".service")), `${row.unit}'s service`);
  }
  assert.ok(MANIFEST.units.length > 20);
  assert.ok(TRANSIENT_UNIT.test("run-u30367.service") && TRANSIENT_UNIT.test("run-r6f3e9a.scope"));
  assert.ok(!TRANSIENT_UNIT.test("postmark-run-u1.service") && !TRANSIENT_UNIT.test("runner.service"));
  assert.deepEqual(parseFailedUnits("● a.service loaded failed failed A\n  b.timer loaded failed failed B\n\n"), ["a.service", "b.timer"]);
});

test("§17 none failed is OK; a systemctl that cannot answer is STALE; an unread manifest is STALE and still names the units", () => {
  assert.equal(classifyFailedUnits({ text: "", manifestNames: new Map() }).verdict, "OK");
  const blind = classifyFailedUnits({ text: null, error: "System has not been booted with systemd as init system (PID 1). Can't operate." });
  assert.equal(blind.verdict, "STALE");
  assert.match(blind.reason, /could not list the box's failed units \(System has not been booted/);
  const noManifest = classifyFailedUnits({ text: "certbot.service loaded failed failed Certbot\n", manifestNames: null, manifestError: "ENOENT", manifestPath: "/srv/postmark-office/deploy/box-rollcall-manifest.json" });
  assert.equal(noManifest.verdict, "STALE");
  assert.equal(noManifest.reason, "1 failed unit, and the roll-call manifest could not be read (ENOENT) to say which matter");
  assert.match(noManifest.said, /box-rollcall-manifest\.json could not be read \(ENOENT\) to say which matter: certbot\.service/);
});

// ── §18 ──

test("§18 shipped is OK; the 11-04 failure is DOWN by its stage, its stderr kept off the board; a dump without its base backup WARNs", () => {
  const nowMs = Date.parse("2026-11-04T09:00:00Z");
  const r = (over) => classifyBackup({ raw: BACKUP(over), nowMs, staleAfterMs: CONFIG.backup.staleAfterMs, path: CONFIG.backup.path });
  const ok = r({ at: "2026-11-04T08:15:20Z" });
  assert.equal(ok.verdict, "OK");
  assert.equal(ok.reason, "shipped, a 112M dump off the box 44m ago (2026-11-04T08:15:20Z)");
  const failed = r({ at: "2026-11-04T08:12:02Z", status: "failed", stage: "ship", detail: "push failed — the dump is on the box and NOWHERE ELSE" });
  assert.equal(failed.verdict, "DOWN");
  assert.equal(failed.reason, "the nightly backup failed at its ship stage (2026-11-04T08:12:02Z): the store has no off-box copy of that night, and the receipt's detail and journalctl -u postmark-world2-backup say why");
  assert.doesNotMatch(failed.reason, /NOWHERE/, "a tool's stderr stays off the public board");
  assert.equal(r({ at: "2026-11-04T08:15:20Z", status: "shipped-no-basebackup" }).verdict, "WARN");
  assert.equal(r({ at: "2026-11-04T08:15:20Z", status: "skipped" }).verdict, "DOWN", "a word that is not shipped is read as not shipped");
  assert.equal(r({ at: "2026-11-04T08:15:20Z", status: undefined }).verdict, "DOWN");
});

test("§18 past the roll-call's 1,560-minute allowance is STALE, a failure outranks its age, and an unread receipt is STALE", () => {
  const row = MANIFEST.units.find((u) => u.unit === CONFIG.backup.unit);
  assert.equal(CONFIG.backup.staleAfterMs, row.heartbeat.stale_after_minutes * MINUTE, `the allowance is ${CONFIG.backup.unit}'s row in the roll-call manifest`);
  const at = Date.parse("2026-11-04T08:15:20Z");
  const r = (over, nowMs) => classifyBackup({ raw: BACKUP({ at: "2026-11-04T08:15:20Z", ...over }), nowMs, staleAfterMs: CONFIG.backup.staleAfterMs });
  assert.equal(r({}, at + 1559 * MINUTE).verdict, "OK");
  const stale = r({}, at + 1561 * MINUTE);
  assert.equal(stale.verdict, "STALE");
  assert.match(stale.reason, /last shipped 1d 2h ago \(2026-11-04T08:15:20Z\), past its 1d 2h allowance: the lane has stopped/);
  const oldFail = r({ status: "failed", stage: "dump" }, at + 30 * HOUR);
  assert.equal(oldFail.verdict, "DOWN");
  assert.match(oldFail.reason, /; and nothing has run since, 1d 6h by its own at \(allowance 1d 2h\)$/);
  assert.equal(classifyBackup({ raw: null, readError: "ENOENT", nowMs: at }).verdict, "STALE");
  assert.equal(classifyBackup({ raw: "{ half", nowMs: at }).verdict, "STALE");
  assert.equal(classifyBackup({ raw: JSON.stringify({ status: "shipped" }), nowMs: at }).verdict, "STALE");
});

// ── §19 ──

const TRIP = (iso, door = "mcp household") => ({ atMs: Date.parse(iso), door });

test("§19 Wright's first instance: two trips at the household door are a WARN, naming the door and never the error", () => {
  const lines = parseJournalJson([
    JOURNAL_LINE(Date.parse("2026-11-09T00:01:04Z"), "[office] mcp household: the office tripped: error: cannot pull with rebase: You have unstaged changes."),
    JOURNAL_LINE(Date.parse("2026-11-09T00:01:21Z"), "[office] mcp household: the office tripped: error: cannot pull with rebase: You have unstaged changes."),
  ].join("\n"));
  const nowMs = Date.parse("2026-11-09T00:05:00Z");
  const r = classifyOfficeTripped({ trips: lines.map((e) => ({ atMs: e.atMs, door: tripDoor(e.message) })), nowMs, sinceMs: nowMs - 25 * MINUTE, windowMs: 10 * MINUTE, threshold: CONFIG.officeTripped.threshold });
  assert.equal(r.verdict, "WARN");
  assert.equal(r.reason, "the office tripped 2 times in the last 25m: mcp household ×2 (00:01:04Z; 00:01:21Z)");
  assert.doesNotMatch(r.reason, /rebase|unstaged/, "the error stays off the public board");
});

test("§19 five on one door inside ten minutes is DOWN; five over two doors is a WARN; no trip is OK; an unread journal STALE", () => {
  const nowMs = Date.parse("2026-11-09T00:20:00Z");
  const c = (trips) => classifyOfficeTripped({ trips, nowMs, sinceMs: nowMs - 25 * MINUTE, windowMs: 10 * MINUTE, threshold: 5 });
  const five = ["00:10:00", "00:11:00", "00:12:00", "00:13:00", "00:19:59"].map((t) => TRIP(`2026-11-09T${t}Z`));
  const down = c(five);
  assert.equal(down.verdict, "DOWN");
  assert.match(down.reason, /^a door tripped 5 or more times inside 10m: mcp household ×5 \(00:10:00Z; 00:11:00Z; 00:12:00Z; 00:13:00Z; and 1 more\)$/);
  assert.equal(c([...five.slice(0, 3), TRIP("2026-11-09T00:14:00Z", "mcp world"), TRIP("2026-11-09T00:15:00Z", "mcp world")]).verdict, "WARN");
  assert.equal(c([]).verdict, "OK");
  assert.equal(classifyOfficeTripped({ trips: null, journalWhy: "spawnSync journalctl ENOENT", nowMs, sinceMs: nowMs }).verdict, "STALE");
  assert.equal(tripDoor("[office] mcp household: the office tripped: error: x"), "mcp household");
  assert.equal(tripDoor("[office] answered 500 (the office tripped): Client has encountered a connection error"), "a REST door (answered 500)");
  assert.equal(tripDoor("[office] something new about the office tripped"), "a door the line does not name");
});

// ── §21 the acknowledgement ──

const ACK = (over = {}) => ({ probe: "failed_units", issue: "STAR-151", until: new Date(T0 + 6 * DAY_MS).toISOString(), ...over });

test("§21 judgeAcks: an issue and an expiry within 7 days, or refused with a note on the board", () => {
  const keys = new Set(["failed_units", "cert_dev_postmark_town"]);
  const j = (rows, over = {}) => judgeAcks({ acks: rows }, { nowMs: T0, keys, ...over });
  assert.deepEqual([...j([ACK()]).live], [["failed_units", { issue: "STAR-151", until: new Date(T0 + 6 * DAY_MS).toISOString() }]]);
  assert.equal(j([ACK({ issue: "https://linear.app/postmark-town/issue/POS-968" })]).live.size, 1, "a link is an issue too");
  const refused = j([
    ACK({ issue: "" }), ACK({ issue: "soon" }), ACK({ until: new Date(T0 + ACK_MAX_MS + MINUTE).toISOString() }),
    ACK({ until: new Date(T0 - MINUTE).toISOString() }), ACK({ probe: "no_such_probe" }), ACK({ until: "whenever" }), { issue: "STAR-1" },
  ]);
  assert.equal(refused.live.size, 0);
  assert.deepEqual(refused.notes.map((n) => n.replace(/^acks\[\d\] (\(\w+\) )?/, "")), [
    "carries no issue link or id; refused", "carries no issue link or id; refused",
    `runs to ${new Date(T0 + ACK_MAX_MS + MINUTE).toISOString()}, more than 7 days out; refused`,
    `expired at ${new Date(T0 - MINUTE).toISOString()} and applies to nothing; take it out of the file`,
    "names a probe the board does not carry; refused", "has no readable until; refused", "names no probe; refused",
  ]);
  assert.equal(j([ACK(), ACK({ issue: "POS-1" })]).notes[0], "acks[1] (failed_units) is a second ack for one probe; the first stands");
  assert.deepEqual(judgeAcks(null, { nowMs: T0 }), { live: new Map(), notes: [] });
  assert.match(judgeAcks(null, { nowMs: T0, error: "acks.json could not be read (Unexpected token)" }).notes[0], /^acks: acks\.json could not be read .*; no acknowledgement applies until it reads$/);
  assert.match(judgeAcks({ nope: 1 }, { nowMs: T0 }).notes[0], /holds no `acks` list/);
});

test("§21 with no ack and none held, applyAck hands back transition's own answer, untouched", () => {
  const cases = [
    [null, { verdict: "DOWN", reason: "x" }, T0],
    [{ verdict: "DOWN", reason: "x", since: T0, last_alert_at: T0 }, { verdict: "DOWN", reason: "x" }, T0 + 12 * HOUR],
    [{ verdict: "DOWN", reason: "x", since: T0, last_alert_at: T0 }, { verdict: "OK", reason: "y" }, T0 + HOUR],
    [{ verdict: "OK", reason: "y", since: T0, last_alert_at: null }, { verdict: "WARN", reason: "w" }, T0 + HOUR],
    [{ verdict: "OK", reason: "y", since: T0, last_alert_at: null }, { verdict: "OK", reason: "y" }, T0 + HOUR],
  ];
  for (const [prev, next, nowMs] of cases) {
    const t = transition({ prev, next, nowMs });
    const a = applyAck({ prev, next, alert: t.alert, state: t.state, ack: null, nowMs });
    assert.equal(a.alert, t.alert);
    assert.equal(a.state, t.state);
  }
  assert.equal(findingOf({ verdict: "DOWN", reason: "at 87% used (4.9G free)" }), "DOWN: at #% used (#.#G free)", "a number in the sentence is not a change");
  assert.equal(findingOf({ verdict: "WARN", reason: "r", finding: "|certbot.service" }), "WARN: |certbot.service");
});

test("§21 THE TICK: an acked standing red reads as before and says nothing, its reminder is held, and a change in its finding re-barks", async () => {
  const one = "postmark-world2-backup.service loaded failed failed World 2.0 durability\n";
  const two = `${one}postmark-ferry.service loaded failed failed the ferry\n`;
  const acks = { acks: [ACK({ issue: "POS-968" })] };
  const at = (failed, state, nowMs, a = acks) => tick({ token: FIXTURE_TOKEN, fetchImpl: stubFetch(GREEN_TABLE), exec: stubExec({ failed }), state, nowMs, config: FIXTURE_CONFIG, readDisk: GREEN_DISK, acks: a });
  const fu = (t) => t.alerts.filter((x) => x.key === "failed_units").map((x) => x.alert.kind);
  const t1 = await at(one, {}, T0, null);
  assert.deepEqual(fu(t1), ["onset"]);
  const t2 = await at(one, t1.nextState, T0 + 10 * MINUTE);
  assert.deepEqual(fu(t2), []);
  const p2 = probeOf(t2, "failed_units");
  assert.equal(p2.verdict, "DOWN", "it reads on the board as before");
  assert.deepEqual(p2.ack, { issue: "POS-968", until: ACK().until }, "the board shows the ack, never the finding it binds (it names units)");
  assert.equal(t2.nextState.probes.failed_units.ack.finding, "DOWN: postmark-world2-backup.service|", "the binding sees the names, in state.json");
  // Twelve hours on, the reminder an unacked DOWN would send is held, and the change log says it was.
  const t3 = await at(one, t2.nextState, T0 + 12 * HOUR);
  assert.deepEqual(fu(t3), []);
  assert.deepEqual(t3.history.filter((h) => h.key === "failed_units").map((h) => [h.alert, h.held_by_ack, h.ack]), [[null, "reminder", "POS-968"]]);
  // A second unit fails: the finding changed, so it barks, says why, and the ack is spent.
  const t4 = await at(two, t3.nextState, T0 + 12 * HOUR + 10 * MINUTE);
  assert.deepEqual(fu(t4), ["onset"]);
  const msg = composeMessage({ alerts: t4.alerts.filter((x) => x.key === "failed_units"), board: { summary: "s" }, nowIso: t4.nowIso });
  assert.match(msg, /DOWN — the box's failed units: 2 units the roll-call manifest names failed: .*\. Its acknowledgement \(POS-968\) covered an earlier finding, so this one barks\./);
  assert.equal(probeOf(t4, "failed_units").ack, undefined, "a spent ack is not shown as holding anything");
  // Spent: the same two units now say nothing more, as any DOWN that stays the same.
  const t5 = await at(two, t4.nextState, T0 + 12 * HOUR + 20 * MINUTE);
  assert.deepEqual(fu(t5), []);
});

test("§21 an ack that expires while its finding stands barks once at once, and then the probe is an ordinary DOWN", async () => {
  const one = "postmark-world2-backup.service loaded failed failed World 2.0 durability\n";
  const acks = { acks: [ACK({ until: new Date(T0 + HOUR).toISOString() })] };
  const at = (state, nowMs, failed = one) => tick({ token: FIXTURE_TOKEN, fetchImpl: stubFetch(GREEN_TABLE), exec: stubExec({ failed }), state, nowMs, config: FIXTURE_CONFIG, readDisk: GREEN_DISK, acks });
  const fu = (t) => t.alerts.filter((x) => x.key === "failed_units").map((x) => `${x.alert.kind} ${x.alert.note ?? ""}`.trim());
  const t1 = await at({}, T0);
  assert.deepEqual(fu(t1), [], "acked from its first tick: bound to the finding as it stands, so even the onset is held");
  const t2 = await at(t1.nextState, T0 + 70 * MINUTE);
  assert.deepEqual(fu(t2), [`onset Its acknowledgement (STAR-151) ended at ${new Date(T0 + HOUR).toISOString()} and it still reads DOWN.`]);
  assert.ok(t2.notes.some((n) => /expired at .* take it out of the file/.test(n)));
  const t3 = await at(t2.nextState, T0 + 80 * MINUTE);
  assert.deepEqual(fu(t3), []);
  // a recovery under an ack still says so
  const back = await at(t1.nextState, T0 + 20 * MINUTE, "");
  assert.deepEqual(fu(back), ["recovered"]);
});

// ── §20 the change log ──

test("§20 run() keeps the change log beside the state: every probe on its first tick, then only what moved or spoke, with delivery", async () => {
  assert.equal(besideState("/srv/postmark-sentinel/state.json", "history.jsonl"), "/srv/postmark-sentinel/history.jsonl");
  assert.equal(besideState("/srv/postmark-sentinel/state.json", "acks.json"), "/srv/postmark-sentinel/acks.json");
  assert.equal(besideState("/x/.site-sentinel-state.json", "history.jsonl"), "/x/.site-sentinel-history.jsonl");
  assert.equal(besideState("/x/s", "acks.json"), "/x/s.acks.json");

  const dir = tempDir("sentinel-history-");
  const statePath = join(dir, "state.json");
  const history = join(dir, "history.jsonl");
  const go = (nowMs) => run({
    argv: ["node", "site-sentinel.mjs", "--state", statePath, "--out", join(dir, "status.json")],
    env: { SENTINEL_DISCORD_WEBHOOK: "https://discord.test/hook" },
    fetchImpl: stubFetch({ ...GREEN_TABLE, "https://postmark.town/daily/": { status: 502, body: "" }, "https://discord.test/hook": { status: 204 } }),
    exec: stubExec(), nowMs, log: () => {}, errLog: () => {}, readDisk: GREEN_DISK,
  });
  const r1 = await go(T0);
  const lines1 = readFileSync(history, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(lines1.length, r1.board.probes.length, "the first tick is every probe's first verdict");
  const daily = lines1.find((h) => h.key === "site_daily");
  assert.deepEqual([daily.from, daily.to, daily.alert, daily.delivered], [null, "DOWN", "onset", true]);
  assert.ok(lines1.every((h) => h.at === new Date(T0).toISOString() && typeof h.reason === "string"));
  await go(T0 + 10 * MINUTE);
  const lines2 = readFileSync(history, "utf8").trim().split("\n").slice(lines1.length).map((l) => JSON.parse(l));
  assert.ok(lines2.every((h) => h.from !== h.to || h.alert), JSON.stringify(lines2));
  assert.ok(!lines2.some((h) => h.key === "site_daily"), "the same DOWN ten minutes on is not a change");
});

test("§20 appendHistory keeps a year and stays inside its byte cap", () => {
  const dir = tempDir("sentinel-history-prune-");
  const path = join(dir, "history.jsonl");
  const now = Date.parse("2027-11-09T00:00:00Z");
  _wf(path, [
    { at: "2026-11-01T00:00:00Z", key: "old", to: "DOWN" }, { at: "2026-11-20T00:00:00Z", key: "kept", to: "OK" },
  ].map((e) => JSON.stringify(e)).join("\n") + "\n");
  assert.deepEqual(appendHistory(path, [{ at: "2027-11-09T00:00:00Z", key: "new", to: "OK" }], { nowMs: now }), { appended: 1, pruned: true });
  assert.deepEqual(readFileSync(path, "utf8").trim().split("\n").map((l) => JSON.parse(l).key), ["kept", "new"], "354 days back is kept, 373 is not");
  assert.deepEqual(appendHistory(path, [{ at: "2027-11-09T00:10:00Z", key: "next", to: "OK" }], { nowMs: now }), { appended: 1, pruned: false }, "an ordinary tick only appends");
  assert.deepEqual(appendHistory(path, [], { nowMs: now }), { appended: 0, pruned: false });
  // the byte cap: past it, the next append keeps the newest lines inside half of it
  const capped = join(dir, "capped.jsonl");
  for (let i = 0; i < 40; i++) appendHistory(capped, [{ at: "2027-11-09T00:00:00Z", key: `k${i}`, reason: "x".repeat(40) }], { nowMs: now, maxBytes: 1000 });
  const kept = readFileSync(capped, "utf8").trim().split("\n");
  assert.ok(Buffer.byteLength(readFileSync(capped)) <= 1000, "never past the cap");
  assert.equal(JSON.parse(kept.at(-1)).key, "k39", "the newest line is always kept");
});

test("§21 the ack file beside the state: none is no acks; one that cannot be read is said on the board, and nothing is acked", async () => {
  const dir = tempDir("sentinel-acks-");
  assert.deepEqual(readAcks(join(dir, "acks.json")), { acks: null, error: null });
  _wf(join(dir, "acks.json"), "{ not json");
  assert.match(readAcks(join(dir, "acks.json")).error, /acks\.json could not be read/);
  const { board } = await run({
    argv: ["node", "site-sentinel.mjs", "--state", join(dir, "state.json"), "--out", join(dir, "status.json")],
    env: {}, fetchImpl: stubFetch(GREEN_TABLE), exec: stubExec(), nowMs: T0, log: () => {}, errLog: () => {}, readDisk: GREEN_DISK,
  });
  assert.ok(board.alerting.notes.some((n) => /^acks: .*acks\.json could not be read .*no acknowledgement applies until it reads$/.test(n)), board.alerting.notes.join(" | "));
  assert.ok(!board.probes.some((p) => p.ack));
});

// ── #978 review (Wright, 11-09): no unit's name on the public board, a changed failed list re-barks, the post's cut ──

import { fitMessage, postDiscord, DISCORD_MAX, rebarkOnChange } from "../tools/site-sentinel.mjs";

const MANIFEST_FAILED = "● postmark-world2-backup.service loaded failed failed World 2.0 durability\n";
const UNIT_NAMES = ["postmark-world2-backup.service", "certbot.service", "wright-rerun-s83-1790426624.service", "run-u30367", "the World 2.0 durability lane"];

test("§17 THE PUBLIC BOARD names no unit, on any probe, acked or not; the post, the change log and state.json do", async () => {
  // LAW (Wright, #978 review, 11-09, blocking): the public text carries only the count and the verdict; the names go
  // to the change log, the Discord post and state.json's ack binding. /ops/sentinel.json is served to anyone.
  const dir = tempDir("sentinel-public-");
  const posted = [];
  const fetchImpl = async (url, init) => {
    if (String(url) === "https://discord.test/hook") { posted.push(JSON.parse(init.body).content); return { ok: true, status: 204 }; }
    return stubFetch(GREEN_TABLE)(url, init);
  };
  const go = (nowMs) => run({
    argv: ["node", "site-sentinel.mjs", "--state", join(dir, "state.json"), "--out", join(dir, "status.json")],
    env: { SENTINEL_DISCORD_WEBHOOK: "https://discord.test/hook" }, fetchImpl,
    exec: stubExec({ failed: MANIFEST_FAILED + FAILED_1109 }), nowMs, log: () => {}, errLog: () => {}, readDisk: GREEN_DISK,
  });
  await go(T0);
  _wf(join(dir, "acks.json"), JSON.stringify({ acks: [ACK({ issue: "POS-968" })] }));
  await go(T0 + 10 * MINUTE);
  const board = readFileSync(join(dir, "status.json"), "utf8");
  const fu = JSON.parse(board).probes.find((p) => p.key === "failed_units");
  assert.equal(fu.verdict, "DOWN");
  assert.equal(fu.reason, "3 failed units, 1 the roll-call manifest names; and 17 transient run-u* units (counted, never alarmed)");
  assert.deepEqual(fu.ack, { issue: "POS-968", until: ACK().until }, "the ack is on the board, its finding is not");
  for (const name of UNIT_NAMES) assert.ok(!board.includes(name), `the public board carries "${name}"`);
  // and where only operators read, the names are there
  assert.match(posted[0], /DOWN — the box's failed units: 1 unit the roll-call manifest names failed: postmark-world2-backup\.service \(the World 2\.0 durability lane\); 2 units outside the manifest failed: certbot\.service; wright-rerun-s83-1790426624\.service/);
  assert.ok(readFileSync(join(dir, "history.jsonl"), "utf8").includes("certbot.service"), "the change log names them");
  assert.match(JSON.parse(readFileSync(join(dir, "state.json"), "utf8")).probes.failed_units.ack.finding, /postmark-world2-backup\.service\|certbot\.service wright-rerun-s83-1790426624\.service/);
});

test("§17 a change in the set of failed units re-barks: a second unit failing under a standing WARN speaks, and so does one clearing", async () => {
  // LAW (Wright, #978 review, 11-09, as the lead relayed it): "Make a change in the set of failed units a new finding
  // that re-barks, the same rule call 4 gives acks ('any change re-barks')." The 11-04 shape: starstory-sync, outside
  // the manifest, failed 52 times under a WARN that had already spoken.
  const line = (u) => `${u} loaded failed failed x\n`;
  const at = (failed, state, nowMs) => tick({ token: FIXTURE_TOKEN, fetchImpl: stubFetch(GREEN_TABLE), exec: stubExec({ failed }), state, nowMs, config: FIXTURE_CONFIG, readDisk: GREEN_DISK });
  const said = (t) => t.alerts.filter((a) => a.key === "failed_units").map((a) => (a.alert.note ? `${a.alert.kind}: ${a.alert.note}` : a.alert.kind));
  const t1 = await at(line("certbot.service"), {}, T0);
  assert.deepEqual(said(t1), ["warn"]);
  const t2 = await at(line("certbot.service"), t1.nextState, T0 + 10 * MINUTE);
  assert.deepEqual(said(t2), [], "the same WARN says nothing more");
  const t3 = await at(line("certbot.service") + line("starstory-sync.service"), t2.nextState, T0 + 20 * MINUTE);
  assert.deepEqual(said(t3), ["warn: What it names changed since it last spoke (newly failed: starstory-sync.service)."]);
  const msg = composeMessage({ alerts: t3.alerts.filter((a) => a.key === "failed_units"), board: { summary: "s" }, nowIso: t3.nowIso });
  assert.match(msg, /the box's failed units: warning: 2 units outside the manifest failed: certbot\.service; starstory-sync\.service\. What it names changed since it last spoke \(newly failed: starstory-sync\.service\)\./);
  assert.deepEqual(said(await at(line("certbot.service") + line("starstory-sync.service"), t3.nextState, T0 + 30 * MINUTE)), []);
  const t5 = await at(line("starstory-sync.service"), t3.nextState, T0 + 40 * MINUTE);
  assert.deepEqual(said(t5), ["warn: What it names changed since it last spoke (no longer failed: certbot.service)."], "any change, a clearing too");
  // WARN to DOWN is transition's own onset, said once; a second manifest unit under the DOWN re-barks
  const t6 = await at(line("starstory-sync.service") + MANIFEST_FAILED, t5.nextState, T0 + 50 * MINUTE);
  assert.deepEqual(said(t6), ["onset"]);
  const t7 = await at(line("starstory-sync.service") + MANIFEST_FAILED + line("postmark-ferry.service"), t6.nextState, T0 + 60 * MINUTE);
  assert.deepEqual(said(t7), ["onset: What it names changed since it last spoke (newly failed: postmark-ferry.service)."]);
  assert.equal(t7.nextState.probes.failed_units.last_alert_at, T0 + 60 * MINUTE, "and the twelve-hour reminder counts from it");
  // the first tick after an upgrade remembers no finding yet, so it invents no change
  const upgraded = structuredClone(t6.nextState);
  delete upgraded.probes.failed_units.finding;
  assert.deepEqual(said(await at(line("starstory-sync.service") + MANIFEST_FAILED + line("postmark-ferry.service"), upgraded, T0 + 60 * MINUTE)), []);
  // PURE: with an alert already made, or an ack holding the finding, it adds nothing
  const st = { verdict: "WARN", since: T0, last_alert_at: T0 };
  const next = { verdict: "WARN", reason: "r", finding: "|a.service b.service" };
  assert.equal(rebarkOnChange({ prev: { ...st, finding: "|a.service" }, next, alert: null, state: st, acked: true, nowMs: T0 }).alert, null);
  const own = { kind: "warn", verdict: "WARN", reason: "r", since: T0 };
  assert.equal(rebarkOnChange({ prev: { ...st, finding: "|a.service" }, next, alert: own, state: st, nowMs: T0 }).alert, own);
});

test("§1 THE POST'S CUT: past 1,900 characters the post keeps whole lines and ends \"…and N more\", so the count survives", async () => {
  // Wright, #978 review: postDiscord cut at 1,900 characters with nothing to say what was cut, and twelve certificate
  // rows going STALE at once can fill a post. The board and the journal carry every alert; the post says how many it left.
  const alerts = Array.from({ length: 30 }, (_, i) => ({ key: `k${i}`, label: `the certificate for host-${i}.example`, alert: { kind: "onset", verdict: "STALE", reason: `could not read the certificate 127.0.0.1:443 serves for host-${i}.example: 40C70C24EC7E0000:error:8000006F:system library:BIO_connect:Connection refused`, since: T0 } }));
  const full = composeMessage({ alerts, board: { summary: "0 down, 30 stale, 12 green.", published_at: "/srv/postmark-sentinel/status.json" }, nowIso: "2026-11-09T02:00:00Z" });
  assert.ok(full.length > DISCORD_MAX, "the fixture is long enough to be cut");
  const cut = fitMessage(full);
  assert.ok(cut.length <= DISCORD_MAX, `${cut.length} characters`);
  const m = /\n…and (\d+) more not shown here; the board has every one\.$/.exec(cut);
  assert.ok(m, `the post ends with the count: ${cut.slice(-120)}`);
  const kept = cut.split("\n").filter((l) => l.startsWith("STALE — ")).length;
  assert.equal(kept + Number(m[1]), 30, "every alert is either in the post or counted");
  assert.ok(cut.startsWith(full.split("\n")[0]), "the header stays");
  assert.ok(cut.includes("0 down, 30 stale, 12 green."), "and the board's sentence");
  assert.ok(cut.split("\n").every((l) => full.includes(l) || l.startsWith("…and ")), "no line is cut in half");
  // a post that fits is untouched; one line too long for any post still ends with the count
  assert.equal(fitMessage("short"), "short");
  const huge = fitMessage(`**h**\n\nDOWN — x: ${"y".repeat(3000)}.\n\nboard.`);
  assert.ok(huge.length <= DISCORD_MAX && /…and 1 more not shown here; the board has every one\.$/.test(huge));
  // and postDiscord sends the fitted post
  let body = null;
  await postDiscord("https://discord.test/hook", full, { fetchImpl: async (_u, init) => { body = JSON.parse(init.body).content; return { ok: true, status: 204 }; } });
  assert.equal(body, cut);
});
