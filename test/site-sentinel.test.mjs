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

// git ls-remote, stubbed: main tip, then the release tag list.
// The world's settlement tags too (§11): annotated, so each lists twice, and the
// newest by number is S50, peeled to `settleSha` — the fixture receipt's world.
const stubExec = ({ siteTip = "sitetip0000", townTip = "towntip0000", relSha = "relsha00000", settleSha = "worldtip0000" } = {}) =>
  (_bin, args) => {
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
const FIXTURE_CONFIG = {
  ..._CFG,
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

test("§10 OK is OK, and the watcher's summary is the reason", () => {
  const r = classifyMeeps({ raw: MEEPS_REC(), nowMs: T0, staleAfterMs: CONFIG.meeps.staleAfterMs });
  assert.equal(r.verdict, "OK");
  assert.match(r.reason, /all 9 meeps answering/);
});

test("§10 DEGRADED and DOWN are DOWN, and the reason is the record's one-line summary verbatim", () => {
  for (const status of ["DEGRADED", "DOWN"]) {
    const r = classifyMeeps({ raw: MEEPS_REC({ status, summary: STUCK_SUMMARY, problems: [{ kind: "STUCK", meep: "Rei" }] }), nowMs: T0, staleAfterMs: CONFIG.meeps.staleAfterMs });
    assert.equal(r.verdict, "DOWN", status);
    assert.equal(r.reason, STUCK_SUMMARY);
    assert.equal(r.detail.problems, 1);
  }
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
  _wf(path, MEEPS_REC({ status: "DEGRADED", summary: STUCK_SUMMARY }));
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
