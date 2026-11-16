// site-refresh-term-and-budget.test.mjs — STAR-135: a site refresh run ends on
// its own report, whether the unit stops it or its own clock does.
//
// THE INSTANCE. On 2026-11-05 a three-pass run of deploy/site-refresh.sh was
// killed by systemd at exactly 45:00 (TimeoutStartSec=45min), during the survey
// after pass 3. The script trapped ERR but not TERM, so no report was written:
// /srv/postmark-harbor/site-refresh.json kept the previous run's "quiet" stamp
// and the sentinel's site_refresh check read STALE over a site that was fresh.
// Two changes, one test each:
//   (a) a TERM writes the board before the script exits (143);
//   (b) another pass starts only when the elapsed time plus the last pass's
//       duration fits inside SITE_REFRESH_MAX_MINUTES (default 40).
//
// The shipped pieces are run verbatim under bash: the env defaults, the run
// clock, report(), say(), both traps and the convergence loop. Only the long
// steps are fakes: survey() reports a town that keeps moving, build_once()
// counts and "publishes" a pass, and `date +%s` reads a fake clock that each
// pass moves by its own minutes, so a 45-minute evening runs in a second.
// deploy/site-refresh-selftest.sh drives the whole script on a POSIX box
// (flock, rsync); this file runs anywhere bash does.
//
//   node --test test/site-refresh-term-and-budget.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { tempDir } from "./helpers/temp-dir.mjs";

const SCRIPT = readFileSync(new URL("../deploy/site-refresh.sh", import.meta.url), "utf8").replace(/\r\n/g, "\n");

function piece(re, what) {
  const m = SCRIPT.match(re);
  assert.ok(m, `deploy/site-refresh.sh no longer has ${what}; this test reads it`);
  return m[0];
}

const shipped = () => [
  piece(/^OUT="\$\{SITE_REFRESH_REPORT[\s\S]*?^MAX_MINUTES=.*\n/m, "the env defaults ending at MAX_MINUTES"),
  piece(/^STARTED=.*\n[\s\S]*?^TOWN_SHA="".*\n/m, "the run clock (STARTED, RUN_START) and the run's variables"),
  piece(/^report\(\) \{.*\n[\s\S]*?\n\}\n/m, "report()"),
  piece(/^say\(\) .*\n/m, "say()"),
  piece(/^on_err\(\)[\s\S]*?^trap on_term TERM\n/m, "the ERR and TERM traps"),
].join("");
const loop = () => piece(/^while :; do\n[\s\S]*?\n^done\n/m, "the convergence loop");

const posix = (p) => p.replace(/\\/g, "/");

function bashOr(t) {
  try { execFileSync("bash", ["-c", "exit 0"], { stdio: "ignore" }); return true; }
  catch {
    t.skip("bash is not on PATH here, so the shipped loop cannot be executed");
    return false;
  }
}

// The probe: the shipped pieces between fakes. PASS_MINUTES is each pass's
// length ("15 15 15"); HANG_IN_PASS makes that pass hang until it is killed.
function writeProbe(dir) {
  const probe = join(dir, "probe.sh");
  writeFileSync(probe, [
    "set -Eeuo pipefail",
    `DIR=${JSON.stringify(posix(dir))}`,
    'CLOCK="$DIR/clock"; echo 1000000 > "$CLOCK"',
    // `date -u +%s` reads the fake clock; every other date call is the real one
    'date() { if [ "${*: -1}" = "+%s" ]; then cat "$CLOCK"; else command date "$@"; fi; }',
    shipped(),
    'N=0',
    'survey() { N=$((N + 1)); TOWN_SHA="$(printf "%08d" "$N")feedface"; KEY="town:$TOWN_SHA"; }',
    'build_once() {',
    '  PASSES=$((PASSES + 1))',
    '  say "pass $PASSES"',
    '  if [ "$PASSES" = "${HANG_IN_PASS:-0}" ]; then : > "$DIR/hanging"; while :; do sleep 0.2; done; fi',
    '  set -- $PASS_MINUTES; shift $((PASSES - 1)); echo $(( $(cat "$CLOCK") + $1 * 60 )) > "$CLOCK"',
    '  PUBLISHED="$DIR/releases/20261105T2310Z-$(echo "$TOWN_SHA" | cut -c1-8)"',
    '}',
    'survey',
    loop(),
    "exit 0",
    "",
  ].join("\n"));
  return probe;
}

function run(env) {
  const dir = tempDir("site-refresh-star135-");
  const probe = writeProbe(dir);
  const report = join(dir, "site-refresh.json");
  const r = spawnSync("bash", [probe], {
    encoding: "utf8",
    timeout: 30_000,
    env: { ...process.env, SITE_REFRESH_REPORT: posix(report), SITE_REFRESH_MAX_PASSES: "3", ...env },
  });
  return { ...r, report: existsSync(report) ? JSON.parse(readFileSync(report, "utf8")) : null };
}

// A TERM sent from bash, as systemd sends it, once the hanging pass has begun.
function runAndTerm(env) {
  const dir = tempDir("site-refresh-star135-");
  const probe = writeProbe(dir);
  const report = join(dir, "site-refresh.json");
  // a stale "quiet" board from the run before, as on 11-05
  writeFileSync(report, JSON.stringify({ at: "2026-11-05T22:40:00Z", status: "quiet", detail: "the run before" }));
  const driver = join(dir, "driver.sh");
  writeFileSync(driver, [
    `bash ${JSON.stringify(posix(probe))} > ${JSON.stringify(posix(join(dir, "out.txt")))} 2>&1 &`,
    "P=$!",
    `for i in $(seq 1 150); do [ -f ${JSON.stringify(posix(join(dir, "hanging")))} ] && break; sleep 0.1; done`,
    "kill -TERM $P",
    "wait $P; echo \"rc=$?\"",
    "",
  ].join("\n"));
  const r = spawnSync("bash", [driver], {
    encoding: "utf8",
    timeout: 30_000,
    env: { ...process.env, SITE_REFRESH_REPORT: posix(report), SITE_REFRESH_MAX_PASSES: "3", ...env },
  });
  const out = readFileSync(join(dir, "out.txt"), "utf8");
  return { rc: Number(/rc=(\d+)/.exec(r.stdout)?.[1]), out, report: JSON.parse(readFileSync(report, "utf8")) };
}

test("STAR-135 (a): a TERM mid-run writes the board, names the last release, and exits non-zero", (t) => {
  if (!bashOr(t)) return;
  // pass 1 publishes, the town moves, pass 2 hangs until the unit's TERM
  const r = runAndTerm({ PASS_MINUTES: "15 15 15", HANG_IN_PASS: "2", SITE_REFRESH_MAX_MINUTES: "40" });
  assert.equal(r.rc, 143, `a TERM'd run exits 143: ${r.out}`);
  assert.notEqual(r.report.detail, "the run before", "the board still holds the previous run's stamp: the TERM wrote nothing");
  assert.equal(r.report.status, "published", "pass 1 published, so the site is fresh and the board says so");
  assert.match(r.report.detail, /^stopped at the unit's limit after 2 pass\(es\); last published 20261105T2310Z-00000001/);
  assert.equal(r.report.passes, 2);
  assert.match(r.out, /STOPPED: TERM at the unit's limit/);
});

test("STAR-135 (a): a TERM before anything was published says failed, never published", (t) => {
  if (!bashOr(t)) return;
  const r = runAndTerm({ PASS_MINUTES: "15 15 15", HANG_IN_PASS: "1" });
  assert.equal(r.rc, 143, r.out);
  assert.equal(r.report.status, "failed");
  assert.match(r.report.detail, /^stopped at the unit's limit after 1 pass\(es\); nothing was published this run/);
});

test("STAR-135 (b): a pass that would overrun the time budget is not started, and the board says why", (t) => {
  if (!bashOr(t)) return;
  // 15-minute passes: after pass 2 the run is 30 min in, and 30 + 15 > 40
  const r = run({ PASS_MINUTES: "15 15 15", SITE_REFRESH_MAX_MINUTES: "40" });
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
  assert.equal(r.report.passes, 2, `the third pass was started: ${r.stdout}`);
  assert.equal(r.report.status, "published");
  assert.match(r.report.detail, /^published at town 00000002; the town moved again mid-build and the run's time is spent \(30 min gone, the last pass took 15, the budget is 40\) — the next tick takes it$/);
  assert.match(r.stdout, /the time budget is spent — the next tick converges/);
});

test("STAR-135 (b): the budget is the default 40 minutes when the unit names none", (t) => {
  if (!bashOr(t)) return;
  const r = run({ PASS_MINUTES: "15 15 15", SITE_REFRESH_MAX_MINUTES: undefined });
  assert.equal(r.report.passes, 2, r.stdout);
  assert.match(r.report.detail, /the budget is 40\)/);
});

test("STAR-135 (b): a pass that fits is started, and the pass budget still stops the run as before", (t) => {
  if (!bashOr(t)) return;
  // 10-minute passes: 20 + 10 = 30 fits, so pass 3 runs and MAX_PASSES ends it
  const r = run({ PASS_MINUTES: "10 10 10", SITE_REFRESH_MAX_MINUTES: "40" });
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
  assert.equal(r.report.passes, 3);
  assert.match(r.report.detail, /3 passes are spent — the next tick takes it$/);
  assert.doesNotMatch(r.stdout, /time budget/);
});
