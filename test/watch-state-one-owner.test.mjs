// watch-state-one-owner.test.mjs — ONE FILE ANSWERS "WHERE DOES THIS RAIL KEEP
// ITS STATE", AND IT IS THE FILE THAT WRITES IT.
//
//   node --test test/watch-state-one-owner.test.mjs
//
// ── THE FAILURE THIS RETIRES (postmark#2972, 2026-09-19 13:55Z, prod) ───────
//
// `node tools/funding-report.mjs` on the box printed
//
//   stripe-watch (journal) · last tick 2026-08-27T06:23Z · ⚠ last ticked 33573 minutes ago
//   usdc-watch · never · ⚠ has never run
//
// while `systemctl list-timers` showed postmark-stripe-watch.timer at 13:52:06Z
// and postmark-usdc-watch.timer at 13:50:17Z that same day, and the watcher's
// own journal carried witnessed rows from 03:37Z that morning. Both rails were
// alive. The report was reading a twin: its own default was
// <office>/.stripe-watch-state.json, last written 2026-08-27 and never again,
// while the watcher writes /srv/postmark-stripe/state.json beside its journal.
//
// WHY A COSMETIC ⚠ IS NOT COSMETIC. The report's own header says a rail that
// has not ticked makes every queue below it a lie. Read literally, that page
// told the operator the town had been blind to card payments for three weeks —
// and a warning that is always wrong teaches its reader to skim the one that
// will matter the day a watcher really dies.
//
// ── WHAT IS PINNED HERE ─────────────────────────────────────────────────────
//
// S1  the report's defaults ARE the watchers' exported paths — object identity,
//     not two strings that happen to match today.
// S2  no literal twin survives anywhere in the report's source. A path that
//     agrees by being typed twice is the defect; this is the assertion that
//     notices it coming back.
// S3  the UNIT and the tool agree. deploy/postmark-*.service passes `--state`,
//     and that argument is the box's actual truth — if it ever names a path the
//     tool does not own, the twin is back with an extra step.
// S4  the behaviour, driven for real: a live state file makes the rail line
//     name that tick; a path with nothing at it still says so honestly rather
//     than reporting a quiet rail.
//
// The paths under test are absolute box paths. NOTHING here writes to one:
// every behavioural case passes `--stripe-state` / `--usdc-state` into a temp
// directory, and the ownership cases are pure reads. A test that littered /srv
// to prove where /srv is would be its own kind of lie.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

import { railHealth } from "../tools/funding-report.mjs";
import { STATE_PATH as STRIPE_STATE, JOURNAL_PATH as STRIPE_JOURNAL, JOURNAL_NAME } from "../tools/stripe-watch.mjs";
import { STATE_PATH as USDC_STATE, REPORT_NAME as USDC_REPORT_NAME } from "../tools/usdc-watch.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OFFICE = join(HERE, "..");
const REPORT_SRC = readFileSync(join(OFFICE, "tools", "funding-report.mjs"), "utf8");

const unitStateArg = (unit) => {
  const text = readFileSync(join(OFFICE, "deploy", unit), "utf8");
  // The ExecStart line, continuations and all — the `--state <path>` the box
  // really runs with, read out of the unit rather than remembered.
  const m = /--state\s+(\S+)/.exec(text.slice(text.indexOf("ExecStart=")));
  return m ? m[1] : null;
};

test("S1 · the report's rail state paths are the watchers' own exports, not copies", () => {
  assert.equal(typeof STRIPE_STATE, "string");
  assert.equal(typeof USDC_STATE, "string");
  // The report names neither path; it names the imported binding. Both forms
  // are asserted because either alone can be satisfied by the other's bug.
  assert.match(REPORT_SRC, /arg\("stripe-state",\s*STRIPE_STATE\)/,
    "the card rail's state path is the one stripe-watch.mjs exports");
  assert.match(REPORT_SRC, /arg\("usdc-state",\s*USDC_STATE\)/,
    "the Base rail's state path is the one usdc-watch.mjs exports");
  assert.match(REPORT_SRC, /arg\("stripe-journal",\s*STRIPE_JOURNAL\)/,
    "and the journal beside it, derived by the watcher rather than typed here");
  assert.equal(STRIPE_JOURNAL, join(dirname(STRIPE_STATE), JOURNAL_NAME),
    "the journal is derived from the state path, which is how the watcher itself derives it");
});

test("S2 · no literal twin of either path survives in the report", () => {
  // `assert.ok` over a tested regex rather than `doesNotMatch`, because a
  // doesNotMatch failure prints the whole 20 KB subject and buries its own
  // message — the reader of a red needs the sentence, not the file.
  const absent = (re, why) => assert.ok(!re.test(REPORT_SRC), why);

  // The dead file the report used to read, by name. This is the assertion that
  // notices the bug coming back, and it is deliberately about the OLD spellings
  // rather than about the new ones: a fix is not proven by the presence of the
  // right path, only by the absence of the wrong one.
  absent(/\.stripe-watch-state\.json/, "the <office>/.stripe-watch-state.json twin, dead since 2026-08-27, is gone");
  absent(/\.usdc-watch-state\.json/, "and its Base-rail sibling with it");

  // …and no fresh literal in its place. Scoped to the two WATCHERS' own
  // directories on purpose: /srv/postmark-office is this file's own business
  // (TOWN_LOCK and OFFICE_DIR, the lock and the pen in the witness command it
  // prints), and a blanket ban on "/srv" would have failed over those — an
  // assertion that is wrong about which paths it owns is the same defect as a
  // path typed twice, one level up.
  absent(/\/srv\/postmark-stripe\//, "no literal card-rail path — it is imported from stripe-watch.mjs, which writes it");
  absent(/\/srv\/postmark-usdc\//, "no literal Base-rail path — it is imported from usdc-watch.mjs, which writes it");
});

test("S3 · the unit and the tool name the same file, so the box cannot drift from the repo", () => {
  assert.equal(unitStateArg("postmark-stripe-watch.service"), STRIPE_STATE,
    "deploy/postmark-stripe-watch.service --state is the path stripe-watch.mjs owns");
  assert.equal(unitStateArg("postmark-usdc-watch.service"), USDC_STATE,
    "deploy/postmark-usdc-watch.service --state is the path usdc-watch.mjs owns");
  // The journal and the arrivals report ride the same line for the same reason.
  const stripeUnit = readFileSync(join(OFFICE, "deploy", "postmark-stripe-watch.service"), "utf8");
  assert.ok(stripeUnit.includes(`--journal ${STRIPE_JOURNAL.replace(/\\/g, "/")}`),
    "the unit's journal is the one the watcher derives from its state path");
  const usdcUnit = readFileSync(join(OFFICE, "deploy", "postmark-usdc-watch.service"), "utf8");
  assert.ok(usdcUnit.includes(`--out ${join(dirname(USDC_STATE), USDC_REPORT_NAME).replace(/\\/g, "/")}`),
    "and the arrivals report sits beside the state, which is why the report may derive it");
});

test("S4 · a live state file makes the rail line name that tick, and an absent one still says so honestly", () => {
  const now = Date.parse("2026-09-19T13:55:00Z");

  // THE LIVE FILE. railHealth is the sentence the operator reads; handed the
  // watcher's real state it must say ticking, not ⚠.
  const live = railHealth("stripe-watch (journal)", { last_run: "2026-09-19T13:52:06Z" }, { now });
  assert.equal(live.ok, true);
  assert.match(live.note, /ticking/);

  // THE DEAD TWIN, for contrast — this is the exact sentence prod printed, and
  // it is correct ABOUT THAT FILE. The defect was never railHealth; it was
  // which file it was handed.
  const twin = railHealth("stripe-watch (journal)", { last_run: "2026-08-27T06:23:00Z" }, { now });
  assert.equal(twin.ok, false);
  assert.match(twin.note, /last ticked \d+ minutes ago/);

  // NEITHER FILE PRESENT. An unread rail and a quiet rail are different answers
  // and only one of them is good news — so an empty state says "never run"
  // rather than showing a clean tick.
  const none = railHealth("usdc-watch", {}, { now });
  assert.equal(none.ok, false);
  assert.match(none.note, /has never run/);
});

test("S4b · driven for real: the report names the tick in the state file it is handed", () => {
  const scratch = mkdtempSync(join(tmpdir(), "one-owner-"));
  const statePath = join(scratch, "state.json");
  const twinPath = join(scratch, ".stripe-watch-state.json");
  writeFileSync(statePath, JSON.stringify({ cursor: 1, last_run: new Date().toISOString() }));
  writeFileSync(twinPath, JSON.stringify({ cursor: 1, last_run: "2026-08-27T06:23:00Z" }));
  // A journal with one seen row, so the report takes its journal branch (no
  // STRIPE_KEY here — the live read is not what is under test).
  const journalPath = join(scratch, JOURNAL_NAME);
  writeFileSync(journalPath, "");

  const out = execFileSync(process.execPath, [
    join(OFFICE, "tools", "funding-report.mjs"),
    "--clone", scratch,
    "--stripe-state", statePath,
    "--stripe-journal", journalPath,
    "--usdc-state", join(scratch, "usdc-state.json"),
    "--usdc-report", join(scratch, USDC_REPORT_NAME),
  ], { encoding: "utf8", env: { ...process.env, STRIPE_KEY: "", TOWN_CLONE: "" }, maxBuffer: 16 * 1024 * 1024 });

  // The live file's tick is minutes old, so no staleness ⚠ for the card rail;
  // the twin beside it, three weeks dead, is never read.
  assert.doesNotMatch(out, /33573/, "the dead twin's number never appears — it is not the file being read");
  assert.match(out, /usdc-watch/, "and the rails are still both reported");
});
