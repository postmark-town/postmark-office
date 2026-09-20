// settlement-history.mjs — one line per DECIDED crossing, appended, bounded.
//
// ── THE FAILURE THIS RETIRES (2026-08-30, the v1 settlement hardening) ───────
//
// /srv/postmark-harbor/settlement-auto.json answers exactly one question: what
// did the LAST crossing do. Nothing on the box could answer the other one —
// "has it published anything lately" — and that is the shape of the failure the
// receipt work of 08-27 was itself written about:
//
//   "On 2026-08-26 a crossing left 42 marks drafted and reported nothing; a
//    starving crossing printed '0 published, 0 unpublished' and read as a quiet
//    day for two days."
//
// Every individual receipt in that stretch was honest. The pattern across them
// was the finding, and a file that is overwritten twice a day cannot carry a
// pattern. The roll-call's settlement row reads this file to judge the crossing
// by its OUTPUT rather than by the fact that its timer fired.
//
// Bounded on purpose: the tail is what gets read, the head is what fills a disk
// nobody is watching. RETAIN crossings, not days — a rail that stops running
// must not be able to age its own evidence out of the window.
//
// Usage:
//   node deploy/settlement-history.mjs --receipt <receipt.json> --history <log.jsonl> [--retain 60]
// Exit is always 0. This is bookkeeping beside a crossing, and a bookkeeper
// that could fail the crossing would be a second way to lose a settlement.

import { readFileSync, writeFileSync, existsSync, realpathSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

export const RETAIN = 60; // ~30 days at two crossings a day

/**
 * Is this receipt a DECISION, or an attempt that is about to be re-run?
 *
 * A lost race inside deploy/settlement-retry.sh is not a decision: the wrapper
 * re-runs the whole crossing from fresh inputs and writes the crossing's real
 * last word itself. A child logging its own race would put three lines in the
 * log for one crossing — and `unsettled_runs` in the roll-call would then alarm
 * on a crossing that went on to publish, which is the one wrong answer a
 * starvation check must never give. The receipt FILE is still written by the
 * child either way; only the log waits.
 *
 * `attempt` is SETTLEMENT_ATTEMPT: a number inside the retry, empty outside it.
 */
export function isDecision(receipt, attempt) {
  const inRetry = attempt !== undefined && attempt !== null && String(attempt).trim() !== "";
  return !(inRetry && String(receipt?.status) === "race");
}

/** The one line a crossing leaves in the log — the fields a pattern is made of. */
export function lineFor(receipt) {
  const ch = receipt?.channels ?? {};
  return {
    at: receipt?.at ?? null,
    status: receipt?.status ?? null,
    class: receipt?.class ?? null,
    // WHOSE ACT THIS WAS (#2974, 2026-09-19; the rule is #2786's).
    //
    // The by-hand door's first live run — release/2026-w38.15, 14:05:02Z — wrote
    // a receipt saying `status: refused · by_hand: true · nothing-unfolded`,
    // exactly as designed, and a history line saying `"status":"refused"` and
    // nothing else. The receipt honoured the distinction and the log did not, so
    // settlement-history's own refusal query, the roll-call manifest and
    // anything else counting refusals from this file read an operator's
    // "nothing to publish" as a crossing that refused. A week of by-hand probes
    // would have shown as a week of refusals.
    //
    // ON EVERY LINE, `false` INCLUDED — the receipt composer's own argument for
    // the same field, quoted because it is the same argument: "a field that
    // appears only when the answer is interesting teaches its reader that
    // absence means scheduled, and then the first receipt missing it for some
    // other reason hands them a wrong answer about who published the town."
    //
    // `=== true` and not a truthy read: this is a boolean on the receipt, and a
    // line built from a receipt that predates the field must come out `false`
    // rather than `undefined`. Contrast `retired` two fields down, where null
    // and 0 are DIFFERENT facts and the absence has to survive — here there is
    // no third state, because a crossing is either a person's act or the
    // timer's.
    by_hand: receipt?.by_hand === true,
    published: ch.published ?? 0,
    left_drafted: ch.left_drafted ?? 0,
    quarantined: ch.quarantined ?? 0,
    // THE RETIREMENT, on the rolling line and not only in the last receipt
    // (G1 lane 1). This log exists to answer "has it published anything in
    // three days", and the store falling behind canon is the same shape of
    // question: a single receipt says what the last crossing retired, and
    // nothing could say whether the register has heard anything in a week.
    //
    // `null` rather than 0 when the step did not run, because a crossing that
    // retired nothing and a crossing that holds no store pen are different
    // facts, and this is the file whose founding lesson is that a zero which
    // means two things reads as a quiet day.
    retired: receipt?.retired?.ran === true ? (receipt.retired.count ?? 0) : null,
    world_from: receipt?.world_from ?? "",
    world_to: receipt?.world_to ?? "",
  };
}

/**
 * Append, keeping the last `retain`.
 *
 * A malformed existing line is DROPPED rather than thrown on: this runs at the
 * end of a crossing that has already done its work, and a parse error in
 * yesterday's bookkeeping must not be the thing that swallows today's receipt.
 */
export function append(existingText, receipt, retain = RETAIN) {
  const rows = [];
  for (const line of String(existingText ?? "").split(/\r?\n/)) {
    if (!line.trim()) continue;
    try { rows.push(JSON.parse(line)); } catch { /* a torn line is not a crossing */ }
  }
  rows.push(lineFor(receipt));
  return `${rows.slice(-retain).map((r) => JSON.stringify(r)).join("\n")}\n`;
}

/** The statuses that mean a crossing ended without completing. */
export const UNSETTLED = new Set(["refused", "starving", "race"]);

/**
 * Was this line a PERSON'S act rather than the timer's? (#2974)
 *
 * A MISSING KEY IS SCHEDULED, and that is a decision rather than a default.
 * Every line written before 2026-09-19 has no `by_hand` key at all, including
 * the one line that really was by-hand — the door's first live run at 14:05:02Z,
 * which is the fixture this tolerance was written against. Reading an absence
 * as by-hand would silently mute those, and muting a real refusal is the one
 * wrong answer a starvation check must never give; reading it as scheduled is
 * exactly today's behaviour for exactly today's lines, and the new field starts
 * doing its work as soon as a crossing writes it. No install-day exception.
 */
export const isByHand = (row) => row?.by_hand === true;

/**
 * The lines the TIMER wrote — the only ones a question about the schedule can
 * honestly be asked of.
 */
export const scheduledRuns = (rows) => (rows ?? []).filter((r) => !isByHand(r));

/**
 * Have the last `n` DECIDED crossings all ended without completing?
 *
 * The same question tools/box-rollcall.mjs asks on the operator round, asked
 * here at crossing time — because the round runs at 8:05 ET and the settlement
 * crosses twice a day, so the EVENING refusal has no round behind it until the
 * next morning. The operator round's own skill file says this is the gap the
 * terminal-refusal escalation covers, "so a missing auto-issue mechanism is
 * itself a finding here." A canon-bad refusal announces itself; a refusal that
 * simply keeps coming back does not, and postmark-world 7f866059 is the receipt
 * that the second kind ran for three days (08-28 to 08-30) with every crossing
 * refusing identically.
 *
 * Deliberately false on a SHORT history: a fresh log with two lines has not yet
 * shown a pattern, and escalating on it would file an issue about the log's
 * age rather than about the town.
 *
 * BY-HAND LINES ARE NOT IN THE WINDOW AT ALL (#2974). The question is whether
 * the SCHEDULE is stuck, and an operator's act is not evidence either way:
 *
 *   a by-hand refusal ("nothing to publish") is not the timer refusing, and a
 *   week of by-hand probes must not read as a week of refusals;
 *
 *   and a by-hand PUBLICATION does not clear a streak either — before this, a
 *   person publishing by hand between two refusals broke the run and silenced
 *   the escalation, which is precisely the reading #2786 exists to forbid: a
 *   person rescuing the town by hand is not the timer being healthy.
 *
 * Filtered rather than skipped, so the window is the last `n` SCHEDULED
 * crossings and not the last `n` lines with some of them thrown away — a
 * by-hand line between two refusals must not shorten the evidence.
 */
export function recurringUnsettled(rows, n) {
  const runs = scheduledRuns(rows);
  if (!Number.isFinite(n) || n <= 0 || runs.length < n) return false;
  return runs.slice(-n).every((r) => UNSETTLED.has(String(r.status)));
}

/**
 * The rows, newest LAST, from a history file's text. The reader half.
 */
export function readHistory(text) {
  const rows = [];
  for (const line of String(text ?? "").split(/\r?\n/)) {
    if (!line.trim()) continue;
    try { rows.push(JSON.parse(line)); } catch { /* skip */ }
  }
  return rows;
}

function argOf(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

export function run() {
  const receiptPath = argOf("receipt");
  const historyPath = argOf("history");

  // THE QUERY MODE, for settlement-auto.sh's escalation decision. Exit 0 = the
  // last N decided crossings all ended without completing; exit 1 = they did
  // not. An exit code rather than a printed answer because the caller is a
  // POSIX `if`, and `if <cmd>` is the one shape that cannot be misparsed.
  const askN = argOf("recurring");
  if (askN) {
    if (!historyPath) return 1;
    let rows = [];
    try { rows = readHistory(readFileSync(historyPath, "utf8")); } catch { return 1; }
    return recurringUnsettled(rows, Number(askN)) ? 0 : 1;
  }

  if (!receiptPath || !historyPath) return 0;
  let receipt;
  try { receipt = JSON.parse(readFileSync(receiptPath, "utf8")); } catch { return 0; }
  if (!isDecision(receipt, argOf("attempt", ""))) return 0;
  const existing = existsSync(historyPath) ? readFileSync(historyPath, "utf8") : "";
  try {
    writeFileSync(historyPath, append(existing, receipt, Number(argOf("retain", RETAIN)) || RETAIN));
  } catch { /* the crossing is not lost over its own logbook */ }
  return 0;
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
if (isMain) process.exit(run());
