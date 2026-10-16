// keep-history.test.mjs — the keeping tick's receipt log: its reader, its retention and its per-step streak (POS-524).
//
//   node --test --test-concurrency=1 test/keep-history.test.mjs
//
// PURE: deploy/keep-history.mjs over fixed-literal log text, and the roll-call's
// keep outcome (its manifest validation and judgeOutcome) over a snapshot built
// in memory. One temp folder for the manifest-validation files and the writer's
// log; no box path is read or written. The crossing outcome's own tests
// (test/box-rollcall.test.mjs) are untouched; the last test here only proves
// that the shipped crossing rows still load beside the keep row.

import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  STEPS, SOFT_STEPS, FATAL_STEPS, REASON_RE, RETAIN_SCHEDULED, RETAIN_OTHER, MAX_LINE_BYTES,
  sourceOf, invalidity, parseLog, buildReceipt, appendReceipt, judgeKeep, writeReceipt,
} from "../deploy/keep-history.mjs";
import { loadManifest, judgeOutcome, outcomesOf, DEFAULT_MANIFEST } from "../tools/box-rollcall.mjs";
// read through the namespace so this file still loads over an older module (the baseline-red run)
import * as keepHistory from "../deploy/keep-history.mjs";
const { RETAIN_EVIDENCE } = keepHistory;
import { tempDir } from "./helpers/temp-dir.mjs";

const T0 = Date.parse("2026-10-13T08:07:00Z");
const MIN = 60_000;
const iso = (ms) => new Date(ms).toISOString().replace(/\.\d+Z$/, "Z");
/** One receipt line. `steps` overrides; every other step is ok. `legacy: true` writes NO source field at all. */
function rec({ run, at, source = "scheduled", steps = {}, legacy = false }) {
  const all = {};
  for (const id of STEPS) all[id] = { s: "ok" };
  for (const [id, s] of Object.entries(steps)) all[id] = typeof s === "string" ? { s } : s;
  const o = { v: 1, kind: "office-keep", run, source, started: iso(at - MIN), at: iso(at), exit: 0, steps: all };
  if (legacy) delete o.source;
  return JSON.stringify(o);
}
const log = (...lines) => lines.join("\n") + "\n";
/** Scheduled ticks 15 minutes apart, the newest at T0; `stepsFor(i)` gives tick i's overrides (0 = oldest). */
function ticks(count, stepsFor = () => ({})) {
  const out = [];
  for (let i = 0; i < count; i++) out.push(rec({ run: `s${i}`, at: T0 - (count - 1 - i) * 15 * MIN, steps: stepsFor(i) }));
  return out;
}
const judge = (text, opt = {}) => judgeKeep(text, { steps: ["mint", "push", "settlements"], n: 3, staleMinutes: 45, now: T0 + MIN, ...opt });
const alarmsFor = (alarms, step) => alarms.filter((a) => a.startsWith(`${step} `));

// 26 since POS-627: settlements-backfill's four soft steps (carried and amends
// from POS-612, chests and drops from POS-627) are recorded apart from it, in the
// order it runs them, between settlements and positions (review-612). 27 since
// review-593 c: the world snapshot (POS-268 5b) is a soft step, after hhkeys_log.
test("the step list is the script's: 27 steps, 5 fatal and 22 soft, no step twice", () => {
  assert.equal(STEPS.length, 27);
  assert.equal(new Set(STEPS).size, 27);
  assert.deepEqual(STEPS.slice(STEPS.indexOf("settlements"), STEPS.indexOf("settlements") + 6), ["settlements", "carried", "chests", "amends", "drops", "positions"]);
  assert.deepEqual([...STEPS].sort(), [...FATAL_STEPS, ...SOFT_STEPS].sort());
  assert.deepEqual(STEPS.slice(0, 3), ["lock", "pull", "fetch"]);
  assert.equal(STEPS[16], "snapshot");
  assert.deepEqual(STEPS.slice(-3), ["hhkeys_log", "world", "publish"]);
});

test("N-1 refused scheduled ticks are quiet; the Nth alarms; a skip, a notrun or a missing status never resets", () => {
  for (const bad of ["refused", "skip", "notrun", { s: "refused", r: "prereq:mint" }]) {
    const two = ticks(5, (i) => (i >= 3 ? { push: bad } : {}));
    assert.deepEqual(judge(log(...two)), [], `two ${JSON.stringify(bad)} ticks are N-1`);
    const three = ticks(5, (i) => (i >= 2 ? { push: bad } : {}));
    const a = judge(log(...three));
    assert.equal(a.length, 1, JSON.stringify(a));
    assert.match(a[0], /^push has not been ok on the last 3 scheduled ticks/);
  }
  // a mixed run of non-ok states is one streak: none of them is ok
  const mixed = ticks(4, (i) => ({ 1: { mint: "refused" }, 2: { mint: "skip" }, 3: { mint: "notrun" } }[i] ?? {}));
  assert.equal(alarmsFor(judge(log(...mixed)), "mint").length, 1);
  // a step with no status at all on the line reads "missing", which never clears
  const missing = ticks(3).map((l) => { const o = JSON.parse(l); delete o.steps.settlements; return JSON.stringify(o); });
  assert.match(alarmsFor(judge(log(...missing)), "settlements")[0], /missing, missing, missing/);
});

test("only the SAME step's scheduled ok resets it; another step's ok does not; alternating steps never reach N", () => {
  // push refused, then ok, then refused twice: the streak is 2
  const reset = ticks(4, (i) => (i === 1 ? {} : { push: "refused" }));
  assert.deepEqual(judge(log(...reset)), []);
  // push refused three times while mint was ok every time: push alarms, mint does not
  const other = ticks(3, () => ({ push: "refused" }));
  const a = judge(log(...other));
  assert.equal(alarmsFor(a, "push").length, 1);
  assert.equal(alarmsFor(a, "mint").length, 0);
  // mint and push take turns refusing for six ticks: each step's streak stays 1
  const alt = ticks(6, (i) => (i % 2 ? { mint: "refused" } : { push: "refused" }));
  assert.deepEqual(judge(log(...alt)), []);
  // a step that is not judged never alarms
  assert.deepEqual(judge(log(...ticks(4, () => ({ welcome: "refused" })))), []);
});

test("provenance is four cases: absent counts as scheduled, scheduled, by-hand is ignored, unknown never clears", () => {
  assert.equal(sourceOf({}), "scheduled", "a legacy line with no source field");
  assert.equal(sourceOf({ source: "scheduled" }), "scheduled");
  assert.equal(sourceOf({ source: "by-hand" }), "by-hand");
  for (const s of ["manual", "", "Scheduled", null, 3]) assert.equal(sourceOf({ source: s }), "unknown", JSON.stringify(s));

  const refused = (run, at, source) => rec({ run, at, source, steps: { push: "refused" } });
  const ok = (run, at, source) => rec({ run, at, source });
  // absent: a REAL legacy line (no source property at all) counts as scheduled: N-1 quiet, N alarms, its ok resets
  const legacy = (run, at, steps = {}) => rec({ run, at, steps, legacy: true });
  for (const l of [legacy("a", T0), legacy("b", T0, { push: "refused" })]) assert.equal(Object.hasOwn(JSON.parse(l), "source"), false, "the line has no source property");
  const L = (i, s) => legacy(`l${i}`, T0 - (3 - i) * 15 * MIN, s);
  assert.deepEqual(judge(log(L(0), L(1), L(2, { push: "refused" }), L(3, { push: "refused" }))), [], "two legacy refusals are N-1");
  assert.equal(alarmsFor(judge(log(L(0), L(1, { push: "refused" }), L(2, { push: "refused" }), L(3, { push: "refused" }))), "push").length, 1, "three are N");
  assert.deepEqual(judge(log(L(0, { push: "refused" }), L(1, { push: "refused" }), L(2), L(3, { push: "refused" }))), [], "a legacy ok resets the streak");
  assert.deepEqual(judge(log(L(0), L(1), L(2), L(3))).filter((x) => /source this roll-call does not know/.test(x)), [], "absent is never unknown");
  // by-hand: hand oks between scheduled refusals do NOT clear the streak...
  const handOks = log(refused("a", T0 - 30 * MIN), ok("h1", T0 - 20 * MIN, "by-hand"), refused("b", T0 - 15 * MIN), ok("h2", T0 - 5 * MIN, "by-hand"), refused("c", T0));
  assert.equal(alarmsFor(judge(handOks), "push").length, 1, "a manual success cannot mask a scheduled failure");
  // ...and hand refusals do NOT extend one
  const handRefusals = log(refused("a", T0 - 15 * MIN), refused("h1", T0 - 10 * MIN, "by-hand"), refused("h2", T0 - 8 * MIN, "by-hand"), refused("b", T0));
  assert.deepEqual(judge(handRefusals), [], "two scheduled refusals plus any number of hand ones is still N-1");
  // unknown: an unknown-source ok between scheduled refusals clears nothing
  const unknownOk = log(refused("a", T0 - 30 * MIN), ok("u1", T0 - 20 * MIN, "cron"), refused("b", T0 - 15 * MIN), refused("c", T0 - 2 * MIN), ok("u2", T0 - MIN, "cron"));
  const u = judge(unknownOk);
  assert.equal(alarmsFor(u, "push").length, 1, "an unknown source never clears a streak");
  assert.ok(u.some((x) => /1 keep receipt\(s\) since the last scheduled receipt name a source this roll-call does not know/.test(x)), "and an unknown line after the last scheduled one is itself a finding");
  // a log of only by-hand and unknown lines has no scheduled evidence at all
  assert.ok(judge(log(ok("h", T0, "by-hand"), ok("u", T0, "cron"))).some((x) => /no scheduled keep receipt/.test(x)));
});

test("missing, malformed, torn or oversize newest evidence is a finding, never healthy", () => {
  assert.match(judge("")[0], /empty or unreadable/);
  assert.match(judge("\n\n")[0], /empty or unreadable/);
  const good = ticks(3);
  const torn = log(...good) + good[2].slice(0, 40); // a write cut off mid-line
  assert.ok(judge(torn).some((x) => /since the last scheduled receipt are unreadable \(not JSON/.test(x)));
  const notKeep = log(...good, JSON.stringify({ v: 2, kind: "office-keep" }));
  assert.ok(judge(notKeep).some((x) => /unreadable \(not keep-v1\)/.test(x)));
  const badStatus = log(...good, rec({ run: "z", at: T0, steps: { push: "fine" } }));
  assert.ok(judge(badStatus).some((x) => /unreadable \(bad status for push\)/.test(x)));
  const badReason = log(...good, rec({ run: "z", at: T0, steps: { push: { s: "refused", r: "fatal: could not read Username" } } }));
  assert.ok(judge(badReason).some((x) => /unreadable \(bad reason for push\)/.test(x)), "a raw tool message is never a reason");
  const oversize = log(...good, "x".repeat(MAX_LINE_BYTES + 1));
  assert.ok(judge(oversize).some((x) => /unreadable \(oversize line\)/.test(x)));
  // a malformed line that is NOT the newest is skipped by the streak, not fatal
  assert.deepEqual(judge(log(good[0], "{torn", good[1], good[2])), []);
});

test("evidence is not laundered: a hand run after a torn, invalid or unknown line neither hides it nor erases it on append", () => {
  const good = ticks(3);
  const handOk = (run, at) => JSON.parse(rec({ run, at, source: "by-hand" }));
  const schedOk = (run, at) => JSON.parse(rec({ run, at }));
  const cases = [
    ["torn", good[2].slice(0, 40) + "ghp_NOT_A_TOKEN", /unreadable \(not JSON \(torn or truncated\)\)/],
    ["invalid status, scheduled", rec({ run: "z", at: T0, steps: { push: "fine" } }), /unreadable \(bad status for push\)/],
    ["unknown step id", JSON.stringify({ ...JSON.parse(good[2]), run: "z", steps: { ghp_NOT_A_TOKEN: { s: "ok" } } }), /unreadable \(unknown step\)/],
    ["unknown source", rec({ run: "u", at: T0, source: "cron" }), /source this roll-call does not know/],
  ];
  for (const [name, line, finding] of cases) {
    const before = log(...good, line);
    assert.ok(judge(before).some((x) => finding.test(x)), `${name}: alarms as the newest line`);
    // the JUDGE alone: a hand line written after it does not hide it
    const behindHand = before + rec({ run: "h0", at: T0 + MIN, source: "by-hand" }) + "\n";
    assert.ok(judge(behindHand).some((x) => finding.test(x)), `${name}: still alarms behind a hand run`);
    // the WRITER: hand appends keep it, through a flood
    let text = before;
    for (let i = 0; i < 60; i++) text = appendReceipt(text, handOk(`h${i}`, T0 + MIN + i * 1000));
    const after = judge(text);
    assert.ok(after.some((x) => finding.test(x)), `${name}: still alarms after 60 hand appends: ${after}`);
    assert.doesNotMatch(text, /ghp_NOT_A_TOKEN/, `${name}: the bad line's bytes are not kept`);
    assert.doesNotMatch(after.join(" "), /ghp_NOT_A_TOKEN/, `${name}: nor echoed`);
    assert.equal(parseLog(text).filter((e) => e.row && sourceOf(e.row) === "unknown").length + parseLog(text).filter((e) => e.bad).length, 1, `${name}: the one piece of evidence, once`);
    // a legitimate scheduled recovery retires it (no permanent poison)...
    const recovered = appendReceipt(text, schedOk("s9", T0 + 2 * MIN));
    assert.deepEqual(judge(recovered, { now: T0 + 3 * MIN }), [], `${name}: a later valid scheduled receipt recovers`);
    // ...and the unknown line never counted as scheduled on the way
    if (name === "unknown source") assert.ok(judge(log(rec({ run: "u", at: T0, source: "cron" }))).some((x) => /no scheduled keep receipt/.test(x)));
  }
  // evidence is capped apart from the other caps: a flood of torn lines keeps the newest 8, never zero
  let flood = log(...good);
  for (let i = 0; i < 20; i++) flood += "{torn\n";
  flood = appendReceipt(flood, handOk("h", T0 + MIN));
  assert.equal(parseLog(flood).filter((e) => e.bad).length, RETAIN_EVIDENCE);
  assert.ok(judge(flood).some((x) => /8 keep receipt line\(s\) since the last scheduled receipt are unreadable/.test(x)));
});

test("stale: the newest SCHEDULED receipt older than the allowance alarms, and hand runs cannot freshen it", () => {
  const old = rec({ run: "s", at: T0 - 50 * MIN });
  assert.ok(judge(log(old)).some((x) => /newest scheduled keep receipt is 51 min old \(allowance 45\)/.test(x)));
  assert.deepEqual(judge(log(rec({ run: "s", at: T0 - 44 * MIN }))), [], "inside the allowance");
  const freshHand = log(old, rec({ run: "h", at: T0, source: "by-hand" }));
  assert.ok(judge(freshHand).some((x) => /51 min old/.test(x)), "a fresh hand run does not count as the timer having run");
});

test("timestamp order and duplicate run ids: the streak walks by `at`, and a run written twice counts once, as its later line", () => {
  // three refusals written out of order, with the ok in the middle of the FILE but the oldest by time
  const outOfOrder = log(
    rec({ run: "c", at: T0, steps: { push: "refused" } }),
    rec({ run: "a", at: T0 - 45 * MIN }),
    rec({ run: "b2", at: T0 - 15 * MIN, steps: { push: "refused" } }),
    rec({ run: "b1", at: T0 - 30 * MIN, steps: { push: "refused" } }),
  );
  assert.equal(alarmsFor(judge(outOfOrder), "push").length, 1, "sorted by time, the last three are refusals");
  // one run id written three times (a retried finisher) is ONE tick, not three
  const dup = log(rec({ run: "a", at: T0 - 15 * MIN }), ...[0, 1, 2].map(() => rec({ run: "r", at: T0, steps: { push: "refused" } })));
  assert.deepEqual(judge(dup), []);
  // and its later line wins: refused then ok under one id reads ok
  const later = log(...ticks(2, () => ({ push: "refused" })), rec({ run: "r", at: T0, steps: { push: "refused" } }), rec({ run: "r", at: T0, steps: {} }));
  assert.deepEqual(judge(later), []);
  // equal timestamps keep file order
  const tie = log(rec({ run: "x", at: T0 - 15 * MIN, steps: { push: "refused" } }), rec({ run: "y", at: T0, steps: { push: "refused" } }), rec({ run: "z", at: T0, steps: {} }));
  assert.deepEqual(judge(tie), []);
});

test("N and steps are validated: a non-positive or fractional N, or no steps, throws", () => {
  for (const n of [0, -1, 1.5, NaN, "3", undefined]) assert.throws(() => judge(log(...ticks(3)), { n }), /n must be a positive integer/, String(n));
  for (const steps of [[], undefined, "push"]) assert.throws(() => judge(log(...ticks(3)), { steps }), /steps must name at least one step/);
  assert.equal(alarmsFor(judge(log(...ticks(1, () => ({ push: "refused" }))), { n: 1 }), "push").length, 1, "N=1 alarms on one refusal");
});

test("retention: 96 scheduled are kept through a flood of hand runs; other lines are capped at 32; malformed lines are dropped", () => {
  let text = "";
  for (let i = 0; i < 100; i++) text = appendReceipt(text, JSON.parse(rec({ run: `s${i}`, at: T0 - (200 - i) * MIN })));
  for (let i = 0; i < 500; i++) text = appendReceipt(text, JSON.parse(rec({ run: `h${i}`, at: T0 - (100 - i / 10) * MIN, source: "by-hand" })));
  text = appendReceipt("{torn\n" + text, JSON.parse(rec({ run: "u0", at: T0, source: "cron" })));
  const rows = parseLog(text);
  assert.ok(rows.every((e) => e.row), "no malformed line survives a write");
  const sched = rows.filter((e) => sourceOf(e.row) === "scheduled");
  const hand = rows.filter((e) => sourceOf(e.row) === "by-hand");
  const unknown = rows.filter((e) => sourceOf(e.row) === "unknown");
  assert.equal(sched.length, RETAIN_SCHEDULED);
  assert.equal(sched[0].row.run, "s4", "the OLDEST scheduled went first");
  assert.equal(sched.at(-1).row.run, "s99");
  assert.equal(hand.length, RETAIN_OTHER, "hand runs are capped at 32");
  assert.deepEqual(unknown.map((e) => e.row.run), ["u0"], "the unknown line after the last scheduled one is evidence, kept apart from that cap");
  assert.equal(rows.at(-1).row.run, "u0");
  assert.ok(Buffer.byteLength(text) < (RETAIN_SCHEDULED + RETAIN_OTHER + RETAIN_EVIDENCE) * 2048, `bounded: ${Buffer.byteLength(text)} bytes`);
  assert.ok(Math.max(...text.trim().split("\n").map((l) => Buffer.byteLength(l))) < 2048, "a full receipt is under 2 KB");
});

test("buildReceipt fills every unrecorded step as notrun, always names a source, and keeps only enum reasons", () => {
  const r = buildReceipt({
    stepsText: "lock\tok\t\npull\tok\t\nmint\trefused\tledger-red\npush\trefused\tfatal: Authentication failed\nnope\tok\t\nsettle\tbogus\t\nregistry\tok",
    source: undefined, run: "inv-1", started: "2026-10-13T08:07:00Z", at: "2026-10-13T08:08:00Z", exit: 0,
  });
  assert.equal(r.source, "unknown", "the writer names a source even when the env gave none it knows");
  assert.deepEqual(r.steps.mint, { s: "refused", r: "ledger-red" });
  assert.deepEqual(r.steps.push, { s: "refused" }, "a raw message is dropped, the status kept");
  assert.deepEqual(r.steps.settle, { s: "notrun" }, "a torn step line records nothing");
  assert.deepEqual(r.steps.registry, { s: "ok" });
  assert.equal(Object.hasOwn(r.steps, "nope"), false);
  assert.deepEqual(Object.keys(r.steps).sort(), [...STEPS].sort());
  assert.equal(r.steps.publish.s, "notrun");
  assert.equal(invalidity(r), null);
  assert.equal(buildReceipt({ source: "by-hand", run: "a b", started: "2026-10-13T08:07:00Z", at: "2026-10-13T08:08:00Z", exit: 1 }).run, "unnamed");
  assert.equal(buildReceipt({ source: "scheduled", run: "a", started: "2026-10-13T08:07:00Z", at: "2026-10-13T08:08:00Z", exit: 143, signal: "TERM" }).signal, "TERM");
  assert.throws(() => buildReceipt({ source: "scheduled", run: "a", started: "yesterday", at: "2026-10-13T08:08:00Z", exit: 0 }), /bad timestamps/);
  assert.throws(() => buildReceipt({ source: "scheduled", run: "a", started: "2026-10-13T08:07:00Z", at: "2026-10-13T08:08:00Z", exit: 256 }), /bad exit/);
  for (const ok of ["exit:1", "exit:128", "ledger-red", "prereq:mint", "signal:TERM", "no-change", "switch-off", "unchecked", "write-failed"]) assert.match(ok, REASON_RE);
  for (const bad of ["exit:1234", "prereq:Mint", "signal:KILL", "ledger-red ", "error: see log", ""]) assert.doesNotMatch(bad, REASON_RE);
});

test("the writer CLI: one receipt per call into the named log, through a temp file renamed over it", () => {
  const dir = tempDir("keep-history-");
  const logPath = join(dir, "office-keep.jsonl");
  const stepsPath = join(dir, "keep-steps");
  writeFileSync(stepsPath, "lock\tok\t\nmint\trefused\tmint-failed\n");
  const args = (extra = []) => ["--log", logPath, "--steps", stepsPath, "--source", "scheduled", "--run", "w1", "--started", "2026-10-13T08:07:00Z", "--exit", "0", ...extra];
  writeReceipt(args());
  writeReceipt([...args(["--signal", "TERM"])].map((a) => (a === "w1" ? "w2" : a)));
  const rows = parseLog(readFileSync(logPath, "utf8"));
  assert.deepEqual(rows.map((e) => e.row?.run), ["w1", "w2"]);
  assert.equal(rows[1].row.signal, "TERM");
  assert.deepEqual(rows[0].row.steps.mint, { s: "refused", r: "mint-failed" });
  assert.equal(existsSync(`${logPath}.tmp-${process.pid}`), false, "no temp file left behind");
  // no steps file at all: still one receipt, every step notrun
  writeReceipt(["--log", logPath, "--steps", join(dir, "absent"), "--source", "by-hand", "--run", "w3", "--started", "2026-10-13T08:07:00Z", "--exit", "1"]);
  const last = parseLog(readFileSync(logPath, "utf8")).at(-1).row;
  assert.ok(Object.values(last.steps).every((s) => s.s === "notrun"));
  assert.throws(() => writeReceipt(["--steps", stepsPath]), /--log is required/);
});

// ── the roll-call's side: manifest validation and the dispatch ──

const KEEP_ROW = {
  unit: "postmark-office-keep.timer", stage: "live", activation_owner: "test",
  outcome: { history_path: "/fixture/office-keep.jsonl", kind: "keep_steps", steps: ["mint", "push"], step_refused_runs: 3, stale_after_minutes: 45, why: "fixture.", means: "read the newest line." },
};
function loads(row) {
  const dir = tempDir("keep-manifest-");
  const p = join(dir, "m.json");
  writeFileSync(p, JSON.stringify({ units: [row] }));
  return () => loadManifest(p);
}
const withOutcome = (o) => ({ ...KEEP_ROW, outcome: { ...KEEP_ROW.outcome, ...o } });

test("the manifest validates the keep outcome on its own fields, with no dummy unsettled_runs", () => {
  assert.doesNotThrow(loads(KEEP_ROW));
  assert.throws(loads(withOutcome({ steps: [] })), /not a non-empty list of the tick's soft steps/);
  assert.throws(loads(withOutcome({ steps: ["push", "lock"] })), /soft steps/, "a fatal step is judged by the unit, not the streak");
  assert.throws(loads(withOutcome({ steps: ["psuh"] })), /soft steps/);
  for (const n of [0, 2.5, "3", undefined]) assert.throws(loads(withOutcome({ step_refused_runs: n })), /positive integer step_refused_runs/, String(n));
  for (const m of [0, -5, "45", undefined]) assert.throws(loads(withOutcome({ stale_after_minutes: m })), /positive stale_after_minutes/, String(m));
  assert.throws(loads(withOutcome({ unsettled_runs: 3 })), /unsettled_runs on a keep outcome/);
  assert.throws(loads(withOutcome({ kind: "keep_stpes" })), /outcome kind "keep_stpes" this roll-call does not know/);
  // a crossing outcome (no kind) still needs its unsettled_runs, exactly as before
  assert.throws(loads({ ...KEEP_ROW, outcome: { history_path: "/fixture/x.jsonl" } }), /no unsettled_runs/);
});

test("the shipped manifest's keep row loads, judges the 22 soft steps at N=3 and 45 minutes, beside unchanged crossing rows", () => {
  const m = loadManifest(DEFAULT_MANIFEST);
  const keepRow = m.units.find((r) => r.unit === "postmark-office-keep.timer");
  // the keep row carries two blocks since POS-268 5b: this receipt, and the household-keys line
  const keep = { outcome: outcomesOf(keepRow).find((o) => o.kind === "keep_steps") };
  assert.equal(keep.outcome.kind, "keep_steps");
  assert.deepEqual(keep.outcome.steps, [...SOFT_STEPS]);
  assert.equal(keep.outcome.step_refused_runs, 3);
  assert.equal(keep.outcome.stale_after_minutes, 45);
  assert.equal(Object.hasOwn(keep.outcome, "unsettled_runs"), false);
  assert.match(keep.outcome.means, /INSTALL-DAY/);
  for (const r of m.units) for (const o of outcomesOf(r)) {
    if (o === keep.outcome) continue;
    assert.equal(Object.hasOwn(o, "kind"), false, `${r.unit}: a crossing row keeps its shape`);
    assert.ok(Number.isFinite(Number(o.unsettled_runs)), r.unit);
  }
});

test("judgeOutcome sends a keep row to judgeKeep over the snapshot's raw text, with the roll-call's own clock", () => {
  const snap = (text, exists = true) => ({ files: { "/fixture/office-keep.jsonl": { exists, text } } });
  const now = T0 + MIN;
  assert.equal(judgeOutcome(KEEP_ROW, snap(log(...ticks(3))), now), null);
  const red = judgeOutcome(KEEP_ROW, snap(log(...ticks(3, () => ({ mint: "refused" })))), now);
  assert.match(red, /^mint has not been ok on the last 3 scheduled ticks \(refused, refused, refused\)\. read the newest line\.$/);
  assert.match(judgeOutcome(KEEP_ROW, snap("", false), now), /empty or unreadable/, "a missing log is the install-day alarm");
  assert.match(judgeOutcome(KEEP_ROW, { files: {} }, now), /empty or unreadable/);
  assert.match(judgeOutcome(KEEP_ROW, snap(log(...ticks(3))), T0 + 60 * MIN), /60 min old/, "now is passed through");
});
