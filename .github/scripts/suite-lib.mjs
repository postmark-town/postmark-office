// suite-lib.mjs — the office suite in CI (POS-417): the plan, the reading of a
// shard's events, and the verdict. Pure functions over plain data, so
// test/suite-ci.test.mjs can drive every branch without a runner. Workflow
// machinery for .github/workflows/suite.yml, not an office tool.
//
// THE PLAN. Every test/*.test.mjs, sorted, dealt across N shards by each file's
// measured seconds (.github/suite/timings.json): longest first, each to the
// shard with the least time so far. A file with no timing (new, or never run in
// CI) is dealt at the median, so a new file never lands unplanned. Every shard
// computes the same plan from the same committed inputs, so no job hands file
// lists to another.
//
// THE VERDICT. A red is a leaf: a test that failed for its own reason, not a
// parent that failed because a subtest did. The run fails on
//   · a red that is not on test/known-failures.json (a new red);
//   · a listed test that passed (the list shrinks: delete its row), unless the
//     row is `flaky`. A flaky test that reds is run again once (its whole
//     file, by the shard): green on the retry is a flake and allowed, red twice
//     is a red and fails the run;
//   · a listed test that did not run at all (renamed or deleted: the row is stale);
//   · a planned file with no result, or a file that exited non-zero with no red
//     of its own (it crashed, or was killed: its tests vanished, they did not pass);
//   · a shard that reported nothing.
// Everything it counts is printed with its denominator.

import { readdirSync } from "node:fs";
import { join } from "node:path";

/** The suite's files, as `npm test` globs them: test/*.test.mjs, sorted. */
export function listTestFiles(root) {
  return readdirSync(join(root, "test"))
    .filter((n) => n.endsWith(".test.mjs"))
    .sort()
    .map((n) => `test/${n}`);
}

const median = (xs) => {
  if (!xs.length) return 1;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

/**
 * Deal `files` across `n` shards by `timings` ({ file: seconds }).
 * Returns [{ shard: 1..n, files: [...], seconds }], each shard's files sorted.
 */
export function planShards(files, timings, n) {
  if (!Number.isInteger(n) || n < 1) throw new Error(`shard count must be a positive integer, got ${n}`);
  const known = files.map((f) => timings[f]).filter((s) => typeof s === "number" && s > 0);
  const fallback = median(known);
  const cost = (f) => (typeof timings[f] === "number" && timings[f] > 0 ? timings[f] : fallback);
  const shards = Array.from({ length: n }, (_, i) => ({ shard: i + 1, files: [], seconds: 0 }));
  // longest first; ties by name, so the plan is the same on every runner
  const order = [...files].sort((a, b) => cost(b) - cost(a) || (a < b ? -1 : a > b ? 1 : 0));
  for (const f of order) {
    const s = shards.reduce((lo, x) => (x.seconds < lo.seconds ? x : lo));
    s.files.push(f);
    s.seconds += cost(f);
  }
  for (const s of shards) { s.files.sort(); s.seconds = Math.round(s.seconds * 10) / 10; }
  return shards;
}

/**
 * Read one file's reporter events (suite-reporter.mjs JSON lines) into its
 * counts and its leaf reds. `type: "suite"` events (describe) are not tests,
 * as node's own `# tests` count leaves them out. A failure node reports for
 * the FILE (it would not load, a top-level hook threw) carries the file's
 * absolute path as its name, which differs per checkout; given `file`, that
 * name is read as the file's repo path, so a row can name it.
 */
export function readEvents(lines, file = null) {
  const own = (name) => (file && String(name).replaceAll("\\", "/").endsWith(`/${file}`) ? file : name);
  const counts = { tests: 0, pass: 0, fail: 0, skipped: 0, todo: 0, cancelled: 0, suites: 0 };
  const reds = [];
  const skips = [];
  const ran = [];
  for (const raw of lines) {
    const e = { ...raw, name: own(raw.name) };
    if (e.type === "suite") { counts.suites++; continue; }
    counts.tests++;
    ran.push(e.name);
    if (e.outcome === "pass") {
      if (e.skip) { counts.skipped++; skips.push({ name: e.name, reason: e.skip }); }
      else if (e.todo) counts.todo++;
      else counts.pass++;
    } else if (e.outcome === "fail") {
      if (e.todo) { counts.todo++; continue; }
      if (e.failureType === "cancelledByParent") { counts.cancelled++; continue; }
      counts.fail++;
      // a parent that failed only because a subtest did is not a red of its own
      if (e.failureType !== "subtestsFailed") reds.push({ name: e.name, failureType: e.failureType ?? null, error: e.error ?? null });
    }
  }
  return { counts, reds, skips, ran };
}

const key = (file, name) => `${file}\u0000${name}`;

// A KNOWN ROW'S SHAPE (POS-419, 2026-10-09). Every row names its file, test and
// reason; `owner` is the Linear issue that owns the fix (a child of POS-419 per
// cause); `date` is the day it was listed and `until` the day it is reviewed by.
// A row past its `until` is OVERDUE: printed as such, never a failure of the run,
// because a quarantine's deadline is a question for its owner, not for every PR.
const DAY = /^\d{4}-\d{2}-\d{2}$/;
export function rowShapeProblems(row) {
  const out = [];
  for (const k of ["file", "name", "reason", "owner", "date", "until"])
    if (typeof row[k] !== "string" || !row[k].trim()) out.push(`no ${k}`);
  if (typeof row.owner === "string" && row.owner.trim() && !/^POS-\d+$/.test(row.owner)) out.push(`owner "${row.owner}" is not a Linear issue (POS-N)`);
  for (const k of ["date", "until"])
    if (typeof row[k] === "string" && row[k].trim() && !DAY.test(row[k])) out.push(`${k} "${row[k]}" is not YYYY-MM-DD`);
  if (DAY.test(row.date ?? "") && DAY.test(row.until ?? "") && row.until < row.date) out.push(`until ${row.until} is before date ${row.date}`);
  return out;
}

/**
 * The verdict over a whole run.
 *   planned:  [file]                          every file some shard was dealt
 *   results:  { file: { exit, seconds, counts, reds, skips, ran, retry? } }
 *             retry: { ran, reds } from the file's one re-run, when a flaky row red
 *   known:    [{ file, name, reason, owner, date, until, flaky? }]
 *   shards:   { planned: n, reported: [shard numbers that uploaded] }
 *   today:    "YYYY-MM-DD" (UTC today by default), the day `until` is read against
 * Returns { ok, totals, problems: [{ kind, file, name?, detail }], listed: [...], overdue: [row] }.
 */
export function verdict({ planned, results, known, shards, today = new Date().toISOString().slice(0, 10) }) {
  const problems = [];
  const totals = { files: 0, tests: 0, pass: 0, fail: 0, skipped: 0, todo: 0, cancelled: 0, suites: 0, reds: 0 };
  const redKeys = new Map();
  const ranKeys = new Set();

  if (shards) {
    for (let i = 1; i <= shards.planned; i++)
      if (!shards.reported.includes(i)) problems.push({ kind: "shard-missing", file: null, detail: `shard ${i} of ${shards.planned} reported nothing` });
  }

  for (const file of planned) {
    const r = results[file];
    if (!r) { problems.push({ kind: "file-missing", file, detail: "planned, but no result came back" }); continue; }
    totals.files++;
    for (const k of Object.keys(r.counts)) totals[k] += r.counts[k];
    for (const n of r.ran ?? []) ranKeys.add(key(file, n));
    for (const red of r.reds) { redKeys.set(key(file, red.name), { file, ...red }); ranKeys.add(key(file, red.name)); }
    if (r.exit !== 0 && r.reds.length === 0)
      problems.push({ kind: "file-crashed", file, detail: `exited ${r.exit} with no red of its own (${r.counts.tests} tests reported)` });
  }
  totals.reds = redKeys.size;

  const listed = [];
  const knownKeys = new Set();
  const overdue = [];
  for (const row of known) {
    const k = key(row.file, row.name);
    knownKeys.add(k);
    const shape = rowShapeProblems(row);
    if (shape.length) problems.push({ kind: "row-malformed", file: row.file ?? null, name: row.name, detail: shape.join("; ") });
    else if (row.until < today) overdue.push(row);
    if (!planned.includes(row.file)) {
      problems.push({ kind: "listed-not-run", file: row.file, name: row.name, detail: "its file is not in the suite: delete the row" });
      continue;
    }
    if (!results[row.file]) continue; // file-missing already says so
    if (redKeys.has(k) && row.flaky) {
      const retry = results[row.file].retry;
      if (!retry) { listed.push({ ...row, outcome: "red (flaky, not retried)" }); continue; }
      if (retry.reds.some((x) => x.name === row.name)) {
        problems.push({ kind: "flaky-red-twice", file: row.file, name: row.name, detail: "red, and red again on its one retry: that is a red, not a flake" });
        listed.push({ ...row, outcome: "red twice (a flaky row, so the run fails)" });
        continue;
      }
      if (!retry.ran.includes(row.name)) {
        problems.push({ kind: "flaky-red-twice", file: row.file, name: row.name, detail: "red, and its retry never ran it (the file crashed on the retry)" });
        continue;
      }
      listed.push({ ...row, outcome: "flake: red, then green on its retry" });
      continue;
    }
    if (redKeys.has(k)) { listed.push({ ...row, outcome: "red" }); continue; }
    if (!ranKeys.has(k)) {
      problems.push({ kind: "listed-not-run", file: row.file, name: row.name, detail: "no test by this name ran: renamed or deleted, so the row is stale" });
      continue;
    }
    if (row.flaky) { listed.push({ ...row, outcome: "green (flaky, allowed)" }); continue; }
    problems.push({ kind: "listed-now-passes", file: row.file, name: row.name, detail: "listed as known-red and it passed: delete its row" });
  }
  for (const [k, red] of redKeys)
    if (!knownKeys.has(k)) problems.push({ kind: "new-red", file: red.file, name: red.name, detail: red.error ?? red.failureType ?? "failed" });

  return { ok: problems.length === 0, totals, problems, listed, overdue };
}

/** A fresh timings map from a run's results: { file: seconds }, sorted by file. */
export function timingsOf(results) {
  const out = {};
  for (const f of Object.keys(results).sort()) {
    const s = results[f].seconds;
    if (typeof s === "number") out[f] = Math.round(s * 10) / 10;
  }
  return out;
}

// ── a file's own cap (POS-354, Wright 2026-10-09) ────────────────────────────
//
// Every file runs as `node --test --test-timeout=<ms> <file>`, and under
// node --test that timeout is the WHOLE FILE's, not each test's: the file runs
// as one test of the parent, and its own `{ timeout }` options never get a say.
// npm test's 180 s fits nearly every file. A file that is minutes by design (the
// dev rehearsal's local proof runs a whole crossing) declares its own cap in its
// header, one line within its first 40:
//
//   // suite-file-timeout: 600000
//
// The declaration is honoured up to FILE_CAP_MS and clamped there, and the
// summary prints every file running under one, with its value, so a long file
// is visible rather than silent. Declare about 3× the file's measured CI time,
// and raise it when the file grows.

export const TEST_TIMEOUT_MS = 180_000;
/** Past this a file is killed and reads as crashed, never as passed; no declaration goes beyond it. */
export const FILE_CAP_MS = 25 * 60 * 1000;
const DECLARED_CAP = /^\s*\/\/\s*suite-file-timeout:\s*(\d+)\s*$/;
/** A declaration below this is no declaration. */
export const MIN_DECLARED_MS = 1000;

/** The timeout a file runs under, from its source text: `{ ms, declared, clamped }` (declared null when it declares none). */
export function fileTimeoutOf(text) {
  const line = String(text ?? "").split(/\r?\n/).slice(0, 40).map((l) => DECLARED_CAP.exec(l)).find(Boolean);
  const declared = line ? Number(line[1]) : null;
  // under a second is no declaration (#453 review F4): --test-timeout=0 is NO timeout in node,
  // so a 0 would run the file to the 25-minute kill instead of failing at its declared value
  if (declared == null || declared < MIN_DECLARED_MS) return { ms: TEST_TIMEOUT_MS, declared: null, clamped: false };
  return { ms: Math.min(declared, FILE_CAP_MS), declared, clamped: declared > FILE_CAP_MS };
}
