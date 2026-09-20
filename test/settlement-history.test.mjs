// Falsifiers for the crossing log.
//
//   node --test test/settlement-history.test.mjs
//
// THE LAW. /srv/postmark-harbor/settlement-auto.json answers one question —
// what did the LAST crossing do — and it is overwritten twice a day, so it
// structurally cannot hold a pattern. The patterns are the findings:
//
//   "On 2026-08-26 a crossing left 42 marks drafted and reported nothing; a
//    starving crossing printed '0 published, 0 unpublished' and read as a quiet
//    day for two days."  (deploy/settlement-receipt.mjs, its own header)
//
//   "These two were the sweep's standing 2-error lint refusal (every crossing
//    since 08-28 re-drained them, dropped one, tripped on the other)."
//    (postmark-world 7f866059, the repair that finally cleared it)
//
// Every receipt in both stretches was individually honest. This file is the
// only place either pattern can exist, so its two obligations are that a
// crossing lands here exactly once, and that a NON-crossing does not land at all.

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { append, lineFor, readHistory, isDecision, recurringUnsettled, RETAIN } from "../deploy/settlement-history.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const TOOL = join(HERE, "..", "deploy", "settlement-history.mjs");

const receipt = (over = {}) => ({
  at: "2026-08-31T05:45:00Z",
  status: "published",
  class: null,
  world_from: "aaaa",
  world_to: "bbbb",
  channels: { published: 4, left_drafted: 20, quarantined: 1 },
  ...over,
});

// ── §0 THE CONTROL ──────────────────────────────────────────────────────────

test("THE CONTROL: a decided crossing lands as exactly one line, carrying the fields a pattern needs", () => {
  const line = lineFor(receipt());
  assert.deepEqual(line, {
    at: "2026-08-31T05:45:00Z", status: "published", class: null,
    // `by_hand: false` on a receipt that did not say otherwise — the timer's
    // crossing, said out loud rather than implied by an absence. (Added with
    // #2974, after the by-hand door's first live run wrote a refused receipt
    // that the log could not tell from a scheduled refusal.)
    by_hand: false,
    published: 4, left_drafted: 20, quarantined: 1,
    // `retired: null` on a receipt with no retire block — the crossing did not
    // run the step, which is not the same fact as running it and retiring none.
    // (Added with the G1 retire step; this control asserts the exact field set,
    // so it is the test that notices when the line's shape moves.)
    retired: null,
    world_from: "aaaa", world_to: "bbbb",
  });
  assert.deepEqual(readHistory(append("", receipt())), [line]);
});

// ── the retirement on the rolling line (G1 lane 1) ──────────────────────────

test("the rolling line carries what the store retired, so a week of them is readable", () => {
  const line = lineFor(receipt({ retired: { ran: true, count: 2 } }));
  assert.equal(line.retired, 2);
});

test("a crossing that ran the step and retired nothing reads 0, not null", () => {
  const line = lineFor(receipt({ retired: { ran: true, count: 0 } }));
  assert.equal(line.retired, 0, "0 is the receipt that the step RAN");
});

test("a crossing that never ran the step reads null, and the two zeroes stay apart", () => {
  // This file's founding lesson, applied to its own new field: a zero meaning
  // "nothing to retire" and a zero meaning "nobody looked" must not print the
  // same way, or a store falling behind canon reads as a quiet week.
  const notRun = lineFor(receipt({ retired: { ran: false, reason: "no store pen" } }));
  const ranEmpty = lineFor(receipt({ retired: { ran: true, count: 0 } }));
  assert.equal(notRun.retired, null);
  assert.equal(ranEmpty.retired, 0);
  assert.notEqual(notRun.retired, ranEmpty.retired);
});

// ── §1 a lost race inside the retry is not a decision ───────────────────────

test("a race INSIDE the retry does not land — the wrapper writes the crossing's last word", () => {
  // deploy/settlement-retry.sh re-runs the whole crossing from fresh inputs on a
  // race, so an attempt that raced is not an outcome yet. If each attempt logged
  // its own race, ONE raced-then-published crossing would put three `race` lines
  // in the log — and `unsettled_runs` in the roll-call would alarm on a crossing
  // that went on to publish, which is the single wrong answer a starvation check
  // must never give.
  assert.equal(isDecision(receipt({ status: "race" }), "1"), false);
  assert.equal(isDecision(receipt({ status: "race" }), "3"), false);
});

test("the SAME race outside the retry DOES land — the wrapper's own last word", () => {
  // A crossing that raced out of all three attempts is a real, terminal exit 2
  // and must be visible to the roll-call. SETTLEMENT_ATTEMPT is unset in the
  // wrapper, and that is the whole difference.
  assert.equal(isDecision(receipt({ status: "race" }), ""), true);
  assert.equal(isDecision(receipt({ status: "race" }), undefined), true);
});

test("nothing else is ever withheld — a refusal from inside the retry still lands", () => {
  // Only a race is retried. A refusal reached inside the retry is already
  // terminal for that crossing, and withholding it would hide the recurring
  // refusal that `unsettled_runs` exists to catch.
  for (const status of ["published", "refused", "starving", "quiet"]) {
    assert.equal(isDecision(receipt({ status }), "1"), true, `${status} was withheld from the log`);
  }
});

test("end to end: three raced attempts and the wrapper's verdict leave ONE line", () => {
  const dir = mkdtempSync(join(tmpdir(), "settlement-history-"));
  const rp = join(dir, "receipt.json");
  const hp = join(dir, "history.jsonl");

  writeFileSync(rp, JSON.stringify(receipt({ status: "race" })));
  for (const attempt of ["1", "2", "3"]) {
    execFileSync(process.execPath, [TOOL, "--receipt", rp, "--history", hp, "--attempt", attempt], { stdio: "ignore" });
  }
  assert.equal(existsSync(hp), false, "an attempt inside the retry wrote to the log");

  execFileSync(process.execPath, [TOOL, "--receipt", rp, "--history", hp, "--attempt", ""], { stdio: "ignore" });
  const rows = readHistory(readFileSync(hp, "utf8"));
  assert.equal(rows.length, 1, "the crossing did not land exactly once");
  assert.equal(rows[0].status, "race");
});

// ── §2 the log is bounded, and survives its own damage ──────────────────────

test("the log keeps the last N crossings and no more — a rail that stops must not age its own evidence out", () => {
  let text = "";
  for (let i = 0; i < RETAIN + 10; i++) text = append(text, receipt({ at: `t${i}` }));
  const rows = readHistory(text);
  assert.equal(rows.length, RETAIN);
  assert.equal(rows[rows.length - 1].at, `t${RETAIN + 9}`, "the newest crossing was the one trimmed");
});

test("a torn line in yesterday's bookkeeping does not swallow today's receipt", () => {
  // This runs at the END of a crossing that has already done its work. A parse
  // error in the log is not permitted to be the thing that loses the record of
  // what the crossing did.
  const damaged = `{"at":"t0","status":"published"}\n{not json at all\n`;
  const rows = readHistory(append(damaged, receipt({ at: "t2" })));
  assert.deepEqual(rows.map((r) => r.at), ["t0", "t2"]);
});

test("a receipt with no channels at all still lands, with zeros rather than holes", () => {
  // A refused crossing never reaches the point of having channel counts. Its
  // line must still exist — it is exactly what `unsettled_runs` counts.
  const line = lineFor({ at: "t", status: "refused", class: "input-bad" });
  assert.equal(line.published, 0);
  assert.equal(line.left_drafted, 0);
  assert.equal(line.status, "refused");
  assert.equal(line.class, "input-bad");
});

// ── §3 the recurring-refusal query, asked at CROSSING time ──────────────────
//
// The same question the roll-call asks on the operator round, asked here on the
// box — because the round runs at 8:05 ET and the settlement crosses twice a
// day, so an EVENING refusal has no round behind it until the next morning. The
// operator round's own skill file names that gap and says the terminal-refusal
// auto-issue is what covers it: "a missing auto-issue mechanism is itself a
// finding here."

const unsettledRow = (status = "refused") => ({ at: "t", status, class: "input-bad", published: 0, left_drafted: 0 });

test("three crossings in a row that did not complete IS the pattern", () => {
  // "every crossing since 08-28 re-drained them, dropped one, tripped on the
  // other" — postmark-world 7f866059. Three days of individually-rerunnable
  // refusals, none of which ever cleared.
  assert.equal(recurringUnsettled([unsettledRow(), unsettledRow(), unsettledRow()], 3), true);
  assert.equal(recurringUnsettled([unsettledRow("race"), unsettledRow("starving"), unsettledRow()], 3), true);
});

test("a SUCCESS anywhere in the window breaks it — the machinery fixed itself", () => {
  // The 02:39-refuse / 02:59:28Z-publish night. Escalating on that would file an
  // issue every time a rerun worked, which is most of them.
  assert.equal(recurringUnsettled([unsettledRow(), { at: "t", status: "published" }, unsettledRow()], 3), false);
  assert.equal(recurringUnsettled([unsettledRow(), unsettledRow(), { at: "t", status: "quiet" }], 3), false);
});

test("a SHORT log is not a pattern — a fresh install must not escalate about its own age", () => {
  // On deploy day the log is empty and fills one line per crossing. Two
  // refusals in a two-line log is not evidence of anything yet.
  assert.equal(recurringUnsettled([unsettledRow(), unsettledRow()], 3), false);
  assert.equal(recurringUnsettled([], 3), false);
  assert.equal(recurringUnsettled([unsettledRow()], 1), true, "a window of one is still answerable");
});

test("the query answers with an EXIT CODE, because its caller is a POSIX `if`", () => {
  const dir = mkdtempSync(join(tmpdir(), "settlement-recurring-"));
  const write = (name, rows) => {
    const p = join(dir, name);
    writeFileSync(p, `${rows.map((r) => JSON.stringify(r)).join("\n")}\n`);
    return p;
  };
  const ask = (p) => {
    try {
      execFileSync(process.execPath, [TOOL, "--history", p, "--recurring", "3"], { stdio: "ignore" });
      return 0;
    } catch (err) { return err.status ?? -1; }
  };

  assert.equal(ask(write("three.jsonl", [unsettledRow(), unsettledRow(), unsettledRow()])), 0, "the pattern did not answer 0");
  assert.equal(ask(write("two.jsonl", [unsettledRow(), unsettledRow()])), 1);
  assert.equal(ask(write("mixed.jsonl", [unsettledRow(), { at: "t", status: "published" }, unsettledRow()])), 1);
  // A log that is not there is not a pattern. An absent file answering 0 would
  // make a fresh box escalate on its very first refusal.
  assert.equal(ask(join(dir, "absent.jsonl")), 1);
});

test("the query mode NEVER writes — it is asked from inside a refusing crossing", () => {
  const dir = mkdtempSync(join(tmpdir(), "settlement-recurring-ro-"));
  const p = join(dir, "h.jsonl");
  const rows = [unsettledRow(), unsettledRow(), unsettledRow()];
  writeFileSync(p, `${rows.map((r) => JSON.stringify(r)).join("\n")}\n`);
  const before = readFileSync(p, "utf8");
  try { execFileSync(process.execPath, [TOOL, "--history", p, "--recurring", "3"], { stdio: "ignore" }); } catch { /* exit code is the answer */ }
  assert.equal(readFileSync(p, "utf8"), before, "the query appended to the log it was asked about");
});
