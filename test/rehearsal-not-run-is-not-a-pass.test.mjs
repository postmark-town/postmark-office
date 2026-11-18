// rehearsal-not-run-is-not-a-pass.test.mjs — POS-1121. The restore rehearsal's
// verdict, RUN rather than read.
//
// LAW (the falsifier's own words, deploy/world2-restore-rehearse.sh header):
//   "A 2 is reported as NOT-RUN and never as a pass — 'There is no exit code for
//   checked nothing and found nothing'."
// On 11-18 08:33Z the --from-s3 rehearsal printed "falsifier: NOT-RUN (exit 2)" and
// then "== rehearsal finished in 67s · PASS". A reader (or a watcher grepping PASS)
// took an unproven rehearsal as proven. Wright, 11-18 08:35Z: a NOT-RUN falsifier
// makes the rehearsal FAIL, never PASS; any step that reports not-run is the same.
//
//   falsifier exit 0         PASS, exit 0
//   falsifier exit 1 (RED)   FAIL (1 finding(s)), exit 1          (unchanged)
//   falsifier exit 2 (or any other) NOT-RUN   FAIL (falsifier not run), exit 2
//   roles check NOT-RUN      FAIL (roles not run), exit 2
//   a finding AND a not-run  FAIL (N finding(s); not run: ...), exit 1
//
// THE PROGRAM UNDER TEST IS THE SCRIPT'S OWN: the region between its
// "# >>> verdict" and "# <<< verdict" markers is cut out and run in bash against a
// stub falsifier that exits with the code under test, and the harness reads the
// final line and the exit code the way a watcher would. The script's other steps
// need a Postgres, an S3 bucket and a dump, so they are not run here.
//
//   node --test test/rehearsal-not-run-is-not-a-pass.test.mjs

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REHEARSE = readFileSync("deploy/world2-restore-rehearse.sh", "utf8");
const scratch = mkdtempSync(join(tmpdir(), "pos1121-"));
after(() => { try { rmSync(scratch, { recursive: true, force: true, maxRetries: 5 }); } catch { /* litter */ } });
const bash = spawnSync("bash", ["-c", "exit 0"]).status === 0 ? false : "no bash on this machine";

function region() {
  const a = REHEARSE.indexOf("# >>> verdict\n");
  const b = REHEARSE.indexOf("# <<< verdict\n");
  assert.ok(a > 0 && b > a, "the rehearsal has no verdict region between its markers: it moved and this test measures nothing");
  return REHEARSE.slice(a, b);
}

// stub: the falsifier's exit code. bad: findings already counted. notrun: checks that
// already reported NOT-RUN before the falsifier (the roles step).
function run({ stub, bad = 0, notrun = "" }) {
  const stubFile = join(scratch, `falsifier-${stub}.sh`);
  writeFileSync(stubFile, `exit ${stub}\n`);
  const harness = join(scratch, "harness.sh");
  writeFileSync(harness, [
    "set -uo pipefail",
    'say() { printf "%s\\n" "$*"; }',
    "t0=$(date +%s)",
    `bad=${bad}; NOTRUN="${notrun}"`,
    `bash "${stubFile.replaceAll("\\", "/")}"; FRC=$?`,
    region(),
    // the script's last act is `exit "$VRC"`; the cleanup trap runs on it, as here
    'cleanup() { echo "== drop scratch"; }; trap cleanup EXIT',
    'exit "$VRC"',
  ].join("\n"));
  const r = spawnSync("bash", [harness.replaceAll("\\", "/")], { encoding: "utf8" });
  const lines = r.stdout.split("\n").filter(Boolean);
  const final = lines.find((l) => l.startsWith("== rehearsal finished")) || "";
  return { r, final, status: r.status, out: r.stdout };
}

test("a falsifier that did not run (exit 2) ends FAIL and exits non-zero, never PASS", { skip: bash }, () => {
  const x = run({ stub: 2 });
  assert.match(x.out, /falsifier: NOT-RUN \(exit 2\) — reported as not-run, never as a pass/, "the stub never reached the NOT-RUN arm");
  assert.match(x.final, /· FAIL \(falsifier not run\)$/, `the final line was: ${x.final}`);
  assert.ok(!/PASS/.test(x.final), "a NOT-RUN falsifier still printed PASS");
  assert.equal(x.status, 2, "a rehearsal whose falsifier did not run must exit non-zero (2: could not prove it)");
  assert.match(x.out, /== drop scratch/, "the cleanup did not run after a not-run verdict");
});

test("a falsifier that found drift (exit 1) keeps the existing FAIL and exit 1", { skip: bash }, () => {
  const x = run({ stub: 1 });
  assert.match(x.out, /falsifier: RED — drift \(exit 1\)/);
  assert.match(x.final, /· FAIL \(1 finding\(s\)\)$/, `the final line was: ${x.final}`);
  assert.equal(x.status, 1);
  assert.match(x.out, /== drop scratch/);
});

test("a falsifier that ran equal (exit 0) is the only PASS, and exits 0", { skip: bash }, () => {
  const x = run({ stub: 0 });
  assert.match(x.out, /falsifier: EQUAL \(exit 0\)/);
  assert.match(x.final, /· PASS$/, `the final line was: ${x.final}`);
  assert.equal(x.status, 0);
});

test("any other falsifier exit is a check that did not run, not a pass", { skip: bash }, () => {
  const x = run({ stub: 137 });
  assert.match(x.final, /· FAIL \(falsifier not run\)$/, `the final line was: ${x.final}`);
  assert.equal(x.status, 2);
});

test("the generalised case: a roles check that reported NOT-RUN fails the rehearsal too, with the falsifier equal", { skip: bash }, () => {
  const x = run({ stub: 0, notrun: " roles" });
  assert.match(x.final, /· FAIL \(roles not run\)$/, `the final line was: ${x.final}`);
  assert.equal(x.status, 2);
});

test("a finding and a not-run together say both, and exit 1 (the finding keeps its code)", { skip: bash }, () => {
  const x = run({ stub: 2, bad: 2 });
  assert.match(x.final, /· FAIL \(2 finding\(s\); not run: falsifier\)$/, `the final line was: ${x.final}`);
  assert.equal(x.status, 1);
});

// A TEXT PIN, the weakest instrument (WIRING-AND-PINS): the roles step needs a Postgres and a roles copy to run,
// so no behavioural test reaches its NOT-RUN arm here. It sees that the arm which prints "NOT-RUN: no roles-*.db"
// records itself in NOTRUN on the next line; the harness test above shows what NOTRUN=" roles" does to the verdict.
test("text pin: the roles step's NOT-RUN arm records itself in NOTRUN", () => {
  const lines = REHEARSE.split("\n");
  const i = lines.findIndex((l) => l.includes('say "   NOT-RUN: no roles-*.db'));
  assert.ok(i >= 0, "the roles NOT-RUN arm moved: this pin sees nothing");
  assert.match(lines[i + 1], /^\s*NOTRUN="\$NOTRUN roles"$/, "the roles NOT-RUN arm prints NOT-RUN but does not count it, so the rehearsal can still end PASS");
});

test("the script ends by exiting the verdict's code (wiring), and the state file's status follows it", () => {
  assert.match(REHEARSE, /^exit "\$VRC"$/m, "the script does not exit with the verdict's code");
  assert.match(REHEARSE, /"\$\(\[ "\$VRC" -eq 0 \] && echo pass \|\| echo fail\)"/, "the state file's status is not read from the verdict");
});
