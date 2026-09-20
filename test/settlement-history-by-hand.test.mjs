// settlement-history-by-hand.test.mjs — A PERSON'S ACT IS NEVER READ BACK AS
// THE TIMER'S.
//
//   node --test test/settlement-history-by-hand.test.mjs
//
// ── THE FAILURE THIS RETIRES (postmark#2974, 2026-09-19 14:05Z) ─────────────
//
// The by-hand settlement door's FIRST live run, on release/2026-w38.15, wrote a
// receipt saying
//
//   status: refused · by_hand: true · nothing-unfolded
//
// exactly as #2786 designed it — and a history line saying
//
//   {"at":"2026-09-19T14:05:02Z","status":"refused","class":null,"published":0,…}
//
// with no `by_hand` anywhere in it. #2786's whole point was that a by-hand act
// is never read back as a scheduled one. The receipt honoured that; the log did
// not — so this file's own refusal query, the roll-call manifest and anything
// else counting refusals out of the history read an operator's "nothing to
// publish" as a crossing that refused. A week of by-hand probes would have read
// as a week of refusals, and the escalation they would eventually trigger would
// have been an issue filed about the operator.
//
// ── THE SECOND HALF, WHICH THE ISSUE DOES NOT SAY OUT LOUD ──────────────────
//
// Excluding by-hand lines from the refusal window is not only about not
// counting them. It also stops a by-hand PUBLICATION clearing a streak of real
// ones: before this, a person rescuing the town by hand between two refusals
// broke the run and silenced the escalation. That is the same misreading from
// the other side — a person publishing is not the timer being healthy — and
// B4 below is the case for it.
//
// ── THE FIXTURE IS THE REAL LINE ────────────────────────────────────────────
//
// `LEGACY` below is today's line, verbatim from the issue, and it is what the
// reader's tolerance of old lines is measured against: every line in the live
// log predates the field, including the one line that really WAS by-hand, and a
// reader that treated a missing key as by-hand would mute real refusals.

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

import { lineFor, readHistory, append, recurringUnsettled, isByHand, scheduledRuns } from "../deploy/settlement-history.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const TOOL = join(HERE, "..", "deploy", "settlement-history.mjs");

// The by-hand door's first live run, as the receipt composer really wrote it.
const byHandReceipt = () => ({
  at: "2026-09-19T14:05:02Z",
  status: "refused",
  class: null,
  by_hand: true,
  detail: "nothing-unfolded",
  world_from: "", world_to: "",
});

const timerReceipt = (over = {}) => ({
  at: "2026-09-19T17:45:00Z",
  status: "refused",
  class: null,
  by_hand: false,
  channels: { published: 0, left_drafted: 12, quarantined: 0 },
  world_from: "aaaa", world_to: "bbbb",
  ...over,
});

// TODAY'S LINE, VERBATIM — no `by_hand` key, because the writer did not have
// the field when it was written. This exact string is the fixture.
const LEGACY = '{"at":"2026-09-19T14:05:02Z","status":"refused","class":null,"published":0,"left_drafted":0,"quarantined":0,"retired":null,"world_from":"","world_to":""}';

test("B1 · the history line carries by_hand, on the timer's crossings too", () => {
  assert.equal(lineFor(byHandReceipt()).by_hand, true,
    "an operator's crossing says so on the line, not only in the receipt beside it");
  assert.equal(lineFor(timerReceipt()).by_hand, false,
    "and the timer's says so too — a field that shows up only when it is interesting teaches its reader that absence means scheduled");
  // A receipt from before the field existed still lands, and lands as the
  // timer's: there is no third state, and `undefined` on a line would push the
  // question back onto every reader.
  assert.equal(lineFor({ at: "t", status: "refused" }).by_hand, false);
  assert.equal("by_hand" in lineFor({ at: "t", status: "refused" }), true,
    "present on every line — the reader must never have to distinguish absent from false");
});

test("B2 · today's real line, with no by_hand key at all, reads as the timer's", () => {
  const [row] = readHistory(LEGACY + "\n");
  assert.equal(row.at, "2026-09-19T14:05:02Z");
  assert.equal(row.by_hand, undefined, "the fixture is the real thing: the key is not there");
  assert.equal(isByHand(row), false,
    "a missing key is SCHEDULED — reading it as by-hand would mute every refusal in the existing log");
  assert.deepEqual(scheduledRuns([row]), [row]);
});

test("B3 · a run of by-hand refusals is not a run of refusals", () => {
  const rows = readHistory(append(append(append("", byHandReceipt()), byHandReceipt()), byHandReceipt()));
  assert.equal(rows.length, 3);
  assert.equal(rows.every((r) => r.status === "refused"), true, "all three ended without completing");
  assert.equal(recurringUnsettled(rows, 3), false,
    "…and none of them was the schedule: the count of scheduled refusals is 0, so nothing escalates");
  assert.deepEqual(scheduledRuns(rows), []);
});

test("B4 · a by-hand line neither BREAKS a real streak nor SHORTENS the window", () => {
  // Three scheduled refusals with a person's successful publication in the
  // middle. Before #2974 the middle line broke the run and the escalation went
  // quiet — a person rescuing the town by hand read as the timer recovering.
  const text = [timerReceipt({ at: "t1" }), byHandReceipt2("published"), timerReceipt({ at: "t3" }), timerReceipt({ at: "t4" })]
    .reduce((acc, r) => append(acc, r), "");
  const rows = readHistory(text);
  assert.equal(rows.length, 4);
  assert.equal(recurringUnsettled(rows, 3), true,
    "the three SCHEDULED crossings all refused; the operator's publication is not evidence the timer is well");
  // and the filter is a filter, not a skip: the window is still three real ones
  assert.deepEqual(scheduledRuns(rows).map((r) => r.at), ["t1", "t3", "t4"]);
});

function byHandReceipt2(status) {
  return { ...byHandReceipt(), at: "t2", status, channels: { published: 3, left_drafted: 1, quarantined: 0 } };
}

test("B5 · the escalation query the crossing actually runs sees the same thing", () => {
  // `--recurring N` is a POSIX `if` in deploy/settlement-auto.sh: exit 0 means
  // "escalate". The rule above is only true of the town if the CLI carries it,
  // and the CLI is what the crossing runs.
  const scratch = mkdtempSync(join(tmpdir(), "by-hand-"));
  const run = (text) => {
    const p = join(scratch, `h-${Math.random().toString(36).slice(2)}.jsonl`);
    writeFileSync(p, text);
    try { execFileSync(process.execPath, [TOOL, "--history", p, "--recurring", "3"], { stdio: "ignore" }); return 0; }
    catch (e) { return e.status ?? 1; }
  };

  const byHandRun = [byHandReceipt(), byHandReceipt(), byHandReceipt()].reduce((a, r) => append(a, r), "");
  assert.equal(run(byHandRun), 1, "three by-hand refusals do not escalate");

  const timerRun = [timerReceipt({ at: "t1" }), timerReceipt({ at: "t2" }), timerReceipt({ at: "t3" })].reduce((a, r) => append(a, r), "");
  assert.equal(run(timerRun), 0, "three scheduled ones still do — the fix must not have muted the alarm it was narrowing");

  // AND THE LEGACY LOG STILL ESCALATES. The whole live file predates the field;
  // if the tolerance had gone the other way this would be 1 and three weeks of
  // real refusals would sit silent.
  assert.equal(run([LEGACY, LEGACY, LEGACY].join("\n") + "\n"), 0,
    "old lines carry no by_hand and are judged exactly as they are today");
});
