// keep-history.mjs — the keeping tick's receipt log, and the one judgement of it (POS-524).
//
// deploy/office-keep.sh runs a dozen steps whose failures are deliberately
// non-fatal: each one prints a line and the tick goes on. That was right for
// the tick and wrong for the town, because a step can then fail on every tick
// forever while the unit reads green. So every run leaves ONE receipt line here
// naming every step's status, and the roll-call judges each step on its own:
// a step that has not been `ok` on N consecutive SCHEDULED ticks alarms
// (tools/box-rollcall.mjs § the keep outcome; N=3, Wright 2026-10-10).
//
// PROVENANCE (Wright 2026-10-13 08:24): postmark-office-keep.service is the
// scheduled unit by contract and writes source "scheduled";
// postmark-office-keep-by-hand.service runs the same script with source
// "by-hand", and a by-hand run neither extends nor clears a scheduled streak,
// so a manual success can never mask a scheduled failure. A line with NO source
// (older than this field) counts as scheduled; a line with a source this module
// does not know is "unknown" and never clears anything. Those are two rules.
//
// The reader here is this log's own: it judges the RAW text, so a line that is
// torn, oversize or not a keep-v1 receipt is a finding, never skipped. EVIDENCE
// IS NOT LAUNDERED (Rivet, first review): an unreadable line, or a receipt with
// a source this module does not know, written AFTER the last valid scheduled
// receipt stays an alarm until a later valid scheduled receipt recovers it. A
// by-hand run can neither hide it from the judge nor erase it on append: the
// writer keeps it (an unreadable line as a fixed marker naming only its
// category, never its bytes) outside the retention caps that a flood of hand
// runs fills.

import { readFileSync, writeFileSync, renameSync, openSync, fsyncSync, closeSync, realpathSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

export const KEEP_V = 1;
export const KIND = "office-keep";

// Every step the tick records, in the script's order. The fatal ones already
// fail the unit (and so the roll-call's unit check); they are recorded for the
// receipt's provenance, not judged by streak.
export const FATAL_STEPS = Object.freeze(["lock", "pull", "fetch", "snapshot", "publish"]);
export const SOFT_STEPS = Object.freeze([
  "registry", "settle", "standing", "gangway",
  "mint", "welcome", "bugstage", "ballots", "verify", "commit", "push", "sync", "rollback",
  // carried, chests, amends and drops: settlements-backfill's four soft steps,
  // in the order it runs them, recorded apart from it because each is
  // non-fatal by design (POS-612 and POS-627, review-612).
  "settlements", "carried", "chests", "amends", "drops",
  // a named creature's ending at the settlement (WLD-25), the same run's fifth soft step
  "endings",
  "positions", "hhkeys", "hhkeys_log",
  // the world graph snapshot (POS-268 5b moved it off the rehydrate; review-593 c)
  "world",
]);
export const STEPS = Object.freeze(["lock", "pull", "fetch", ...SOFT_STEPS.slice(0, 13), "snapshot", ...SOFT_STEPS.slice(13), "publish"]);
export const STATUSES = Object.freeze(["ok", "refused", "skip", "notrun"]);
export const SOURCES = Object.freeze(["scheduled", "by-hand"]);
export const SIGNALS = Object.freeze(["TERM", "INT", "HUP"]);
// A fixed vocabulary: a receipt never carries tool output, keys or bodies.
export const REASON_RE = /^(?:exit:\d{1,3}|ledger-red|prep-failed|mint-failed|verify-red|commit-failed|push-failed|sync-failed|rolled-back|rollback-failed|not-needed|no-change|switch-off|unchecked|write-failed|prereq:[a-z_]{1,16}|signal:(?:TERM|INT|HUP))$/;
const RUN_RE = /^[A-Za-z0-9._:-]{1,80}$/;

// RETENTION: the last 96 scheduled receipts (a day of quarter-hour ticks; a
// streak of 3 plus the staleness allowance needs far fewer) are kept whatever
// else arrives, and other lines (by-hand, unknown) are capped apart at 32, so a
// burst of hand runs can never push the scheduled window out. A line is at most
// MAX_LINE_BYTES; with every field bounded below, a receipt is well under 2 KB,
// so the log (with at most 8 evidence lines, below) stays under ~280 KB.
export const RETAIN_SCHEDULED = 96;
export const RETAIN_OTHER = 32;
export const MAX_LINE_BYTES = 4096;
// Evidence the judge must keep seeing is capped apart: one line is enough to
// alarm, so the newest 8 bound the file without ever emptying the finding.
export const RETAIN_EVIDENCE = 8;

const isIso = (s) => typeof s === "string" && s.length <= 40 && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(s) && Number.isFinite(Date.parse(s));

/** The provenance a line counts as: "scheduled" (incl. a legacy line with no source), "by-hand" or "unknown". */
export function sourceOf(row) {
  if (!row || typeof row !== "object" || !Object.hasOwn(row, "source")) return "scheduled";
  return SOURCES.includes(row.source) ? row.source : "unknown";
}

/** null for a valid keep-v1 receipt, else why it is not one. */
export function invalidity(o) {
  if (!o || typeof o !== "object" || Array.isArray(o)) return "not an object";
  if (o.v !== KEEP_V) return "not keep-v1";
  if (o.kind !== KIND) return "not an office-keep receipt";
  if (typeof o.run !== "string" || !RUN_RE.test(o.run)) return "bad run id";
  if (!isIso(o.started) || !isIso(o.at)) return "bad timestamps";
  if (!Number.isInteger(o.exit) || o.exit < 0 || o.exit > 255) return "bad exit";
  if (Object.hasOwn(o, "signal") && !SIGNALS.includes(o.signal)) return "bad signal";
  if (Object.hasOwn(o, "source") && (typeof o.source !== "string" || o.source.length > 32)) return "bad source";
  if (!o.steps || typeof o.steps !== "object" || Array.isArray(o.steps)) return "no steps";
  for (const [id, st] of Object.entries(o.steps)) {
    if (!STEPS.includes(id)) return "unknown step";
    if (!st || typeof st !== "object" || !STATUSES.includes(st.s)) return `bad status for ${id}`;
    if (Object.hasOwn(st, "r") && (typeof st.r !== "string" || !REASON_RE.test(st.r))) return `bad reason for ${id}`;
  }
  return null;
}

// The writer's stand-in for an unreadable line it must keep: its category, never its bytes.
export const MARK_KIND = "office-keep-unreadable";
const BAD_WHY_RE = /^(?:not an object|not keep-v1|not an office-keep receipt|bad run id|bad timestamps|bad exit|bad signal|bad source|no steps|unknown step|bad (?:status|reason) for [a-z_]{1,16}|oversize line|not JSON \(torn or truncated\))$/;
const marker = (why) => ({ v: KEEP_V, kind: MARK_KIND, why: BAD_WHY_RE.test(why) ? why : "not an office-keep receipt" });

/** Every non-blank line of the raw log, oldest first: { row } or { bad }. */
export function parseLog(text) {
  const out = [];
  for (const line of String(text ?? "").split("\n")) {
    if (!line.trim()) continue;
    if (Buffer.byteLength(line, "utf8") > MAX_LINE_BYTES) { out.push({ bad: "oversize line" }); continue; }
    let o;
    try { o = JSON.parse(line); } catch { out.push({ bad: "not JSON (torn or truncated)" }); continue; }
    if (o && o.kind === MARK_KIND && o.v === KEEP_V && BAD_WHY_RE.test(o.why)) { out.push({ bad: o.why }); continue; }
    const why = invalidity(o);
    out.push(why ? { bad: why } : { row: o });
  }
  return out;
}

/** The receipt for one run, from the tick's step lines ("id<TAB>status<TAB>reason"). */
export function buildReceipt({ stepsText = "", source, run, started, at, exit, signal = null }) {
  const steps = {};
  for (const line of String(stepsText).split("\n")) {
    const [id, s, r] = line.split("\t");
    if (!STEPS.includes(id) || !STATUSES.includes(s)) continue; // a torn step line records nothing; the step reads notrun
    steps[id] = r && REASON_RE.test(r) ? { s, r } : { s };
  }
  for (const id of STEPS) if (!steps[id]) steps[id] = { s: "notrun" };
  const receipt = {
    v: KEEP_V, kind: KIND,
    run: RUN_RE.test(String(run ?? "")) ? String(run) : "unnamed",
    source: SOURCES.includes(source) ? source : "unknown", // the writer ALWAYS names a source
    started, at, exit: Number(exit),
    ...(SIGNALS.includes(signal) ? { signal } : {}),
    steps,
  };
  const why = invalidity(receipt);
  if (why) throw new Error(`the receipt would not be keep-v1 (${why})`);
  return receipt;
}

/** The index of the last valid scheduled receipt in parsed entries (file order), or -1. */
function lastScheduledAt(entries) {
  let last = -1;
  entries.forEach((e, i) => { if (e.row && sourceOf(e.row) === "scheduled") last = i; });
  return last;
}
/** An entry the judge must still see: unreadable, or an unknown source, after the last scheduled receipt. */
const isEvidence = (e, i, last) => i > last && (e.bad || sourceOf(e.row) === "unknown");

/**
 * The log with one receipt added, the scheduled window protected. Evidence (an
 * unreadable line or an unknown source after the last scheduled receipt) is
 * KEPT apart from both caps, the newest RETAIN_EVIDENCE of it, so a hand run
 * can never erase it; an unreadable line is kept as a marker naming its
 * category. Only a later valid scheduled receipt retires it.
 */
export function appendReceipt(existingText, receipt) {
  const entries = parseLog(existingText);
  entries.push({ row: receipt });
  const last = lastScheduledAt(entries);
  let keepSched = RETAIN_SCHEDULED, keepOther = RETAIN_OTHER, keepEvidence = RETAIN_EVIDENCE;
  const kept = [];
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (isEvidence(e, i, last)) { if (keepEvidence-- > 0) kept.push(e); continue; }
    if (e.bad) continue; // recovered: a valid scheduled receipt came after it
    if (sourceOf(e.row) === "scheduled" ? keepSched-- > 0 : keepOther-- > 0) kept.push(e);
  }
  return kept.reverse().map((e) => JSON.stringify(e.row ?? marker(e.bad))).join("\n") + "\n";
}

/**
 * The judgement: [] when every judged step is healthy, else one sentence per
 * finding. `steps` are the judged step ids, `n` the scheduled streak that
 * alarms, `staleMinutes` how old the newest SCHEDULED receipt may be.
 */
export function judgeKeep(text, { steps, n, staleMinutes, now = Date.now() }) {
  if (!Number.isInteger(n) || n < 1) throw new Error("judgeKeep: n must be a positive integer");
  if (!Array.isArray(steps) || !steps.length) throw new Error("judgeKeep: steps must name at least one step");
  const entries = parseLog(text);
  if (!entries.length) return ["the keep log is empty or unreadable — no tick has left a receipt"];
  const alarms = [];
  // every line after the last valid scheduled receipt, not only the newest: a
  // hand run written after a torn or unknown line must not hide it
  const lastSched = lastScheduledAt(entries);
  const evidence = entries.filter((e, i) => isEvidence(e, i, lastSched));
  const bad = evidence.filter((e) => e.bad);
  const unknown = evidence.length - bad.length;
  if (bad.length) alarms.push(`${bad.length} keep receipt line(s) since the last scheduled receipt are unreadable (${bad[bad.length - 1].bad})`);
  if (unknown) alarms.push(`${unknown} keep receipt(s) since the last scheduled receipt name a source this roll-call does not know`);

  // scheduled rows (legacy no-source lines included), oldest first; a run id
  // written twice counts once, as its LATER line
  const byRun = new Map();
  entries.forEach((e, i) => { if (e.row && sourceOf(e.row) === "scheduled") byRun.set(e.row.run, { row: e.row, i }); });
  const scheduled = [...byRun.values()]
    .sort((a, b) => (Date.parse(a.row.at) - Date.parse(b.row.at)) || (a.i - b.i))
    .map((x) => x.row);
  if (!scheduled.length) return [...alarms, "no scheduled keep receipt — hand runs cannot stand in for the timer"];

  const last = scheduled[scheduled.length - 1];
  const ageMin = (now - Date.parse(last.at)) / 60_000;
  if (ageMin > staleMinutes) alarms.push(`the newest scheduled keep receipt is ${Math.round(ageMin)} min old (allowance ${staleMinutes})`);

  for (const id of steps) {
    const seen = [];
    for (let i = scheduled.length - 1; i >= 0; i--) {
      const s = scheduled[i].steps?.[id]?.s;
      if (s === "ok") break;
      seen.push(s ?? "missing"); // refused, notrun, skip or absent: none of them is ok, none clears
    }
    if (seen.length >= n) alarms.push(`${id} has not been ok on the last ${seen.length} scheduled ticks (${seen.slice(0, n).join(", ")})`);
  }
  return alarms;
}

// ── the writer: one receipt, read-modify-replace (the caller holds the log's lock) ──
function argOf(argv, name) { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; }

export function writeReceipt(argv) {
  const log = argOf(argv, "log");
  if (!log) throw new Error("--log is required");
  let stepsText = "";
  try { stepsText = readFileSync(argOf(argv, "steps") ?? "", "utf8"); } catch { /* no step lines: every step reads notrun */ }
  const receipt = buildReceipt({
    stepsText, source: argOf(argv, "source"), run: argOf(argv, "run"),
    started: argOf(argv, "started"), at: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
    exit: Number(argOf(argv, "exit")), signal: argOf(argv, "signal") ?? null,
  });
  let existing = "";
  try { existing = readFileSync(log, "utf8"); } catch (e) { if (e.code !== "ENOENT") throw e; }
  const tmp = `${log}.tmp-${process.pid}`;
  writeFileSync(tmp, appendReceipt(existing, receipt), { mode: 0o644 });
  const fd = openSync(tmp, "r"); try { fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(tmp, log);
  return receipt;
}

// The realpath compare (test/cli-guard.test.mjs): an import is inert, and the
// entry is recognised through a junction too.
const isMain = (() => {
  if (!process.argv[1]) return false;
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return pathToFileURL(process.argv[1]).href === import.meta.url; }
})();
if (isMain) {
  if (process.argv[2] !== "write") { console.error("usage: keep-history.mjs write --log <path> --steps <file> --source <s> --run <id> --started <iso> --exit <n> [--signal NAME]"); process.exit(2); }
  try { writeReceipt(process.argv.slice(3)); }
  catch (e) { console.error(`keep-history: ${String(e?.message ?? e).slice(0, 200)}`); process.exit(1); }
}
