// Falsifiers for the settlement's race retry.
//
//   node --test test/settlement-retry.test.mjs
//
// THE LAW THESE ASSERT, quoted from the receipt that already gave the
// instruction nothing carried out — settlement-auto.sh, at all three of its
// race sites, verbatim:
//
//   report race "lease refused delivering the drain to $b (door write mid-run) — rerun"
//   report race "world main moved underneath the sweep — rerun"
//   report race "one or more sketchbook leases refused — rerun"
//
// And the night it cost, from the box's own journal:
//
//   Aug 30 17:54:23  ! [rejected]  draft/foundoutanyway -> draft/foundoutanyway (stale info)
//   Aug 30 17:54:23  [settlement-auto] lease refused on draft/foundoutanyway (door write mid-run) — rerun
//   Aug 30 17:54:45  postmark-settlement.service: Main process exited, code=exited, status=2
//
// Eighteen minutes of finished, suite-green work discarded, and nine hours of
// nothing until the next timer mark.
//
// The loop is its own script precisely so these tests can exist: inlined in
// settlement-auto.sh it could only ever be exercised by a real lost race on a
// real box, which is to say never.

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tempDir } from "./helpers/temp-dir.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const RETRY = join(HERE, "..", "deploy", "settlement-retry.sh");

/**
 * Run the real script with a command that logs each attempt then exits `codes`
 * in order (the last code repeats). Returns { exit, attempts, stderr }.
 */
function drive(max, codes) {
  const dir = tempDir("settlement-retry-");
  const log = join(dir, "attempts.log");
  const script = [
    `printf '%s\\n' "$SETTLEMENT_ATTEMPT" >> '${log.replace(/\\/g, "/")}'`,
    `n=$(wc -l < '${log.replace(/\\/g, "/")}')`,
    `set -- ${codes.join(" ")}`,
    `while [ "$n" -gt 1 ] && [ "$#" -gt 1 ]; do shift; n=$((n-1)); done`,
    `exit "$1"`,
  ].join("\n");

  // stderr is captured on BOTH paths: the narration of a retry that eventually
  // WON is exactly the evidence that a retry happened, and a harness that only
  // kept stderr from failures could not see it.
  const errFile = join(dir, "stderr.txt");
  let exit = 0;
  try {
    execFileSync("sh", ["-c", `sh "$1" "$2" sh -c "$3" 2> "$4"`, "sh", RETRY, String(max), script, errFile], {
      encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    exit = err.status ?? -1;
  }
  const stderr = existsSync(errFile) ? readFileSync(errFile, "utf8") : "";
  const attempts = existsSync(log)
    ? readFileSync(log, "utf8").split("\n").filter((l) => l.trim())
    : [];
  return { exit, attempts, stderr };
}

// ── §0 THE CONTROL ──────────────────────────────────────────────────────────

test("THE CONTROL: a crossing that succeeds runs exactly once, and the harness can count", () => {
  // Without this, every "ran N times" assertion below could be measuring a
  // harness that never ran the command at all.
  const r = drive(3, [0]);
  assert.equal(r.exit, 0);
  assert.deepEqual(r.attempts, ["1"], "a green crossing was run more than once");
});

// ── §1 the law: a race is re-run WHOLE, up to the cap ───────────────────────

test("a lost race re-runs the WHOLE crossing, and a second attempt that wins ends it there", () => {
  // "lease refused on draft/foundoutanyway (door write mid-run) — rerun" — the
  // rerun the receipt asked for, actually happening. A race is transient by
  // definition: the whole point is that the second look sees a settled origin.
  const r = drive(3, [2, 0]);
  assert.equal(r.exit, 0, "the retried crossing did not get to publish");
  assert.deepEqual(r.attempts, ["1", "2"]);
  assert.match(r.stderr, /attempt 1 of 3 lost a race/);
  assert.match(r.stderr, /from fresh inputs/,
    "the operator must be able to tell a retry from a resume — a resumed half-run would push against a tip that no longer exists");
});

test("a race that survives every attempt is a REAL exit 2, and says all of them were tried", () => {
  // The terminal case: a door write landing on every single pass is contention,
  // not a transient, and it must stop looking rather than spin. Three is the
  // cap; the third exit is the one that stands.
  const r = drive(3, [2]);
  assert.equal(r.exit, 2);
  assert.deepEqual(r.attempts, ["1", "2", "3"], "the cap was not three attempts");
  assert.match(r.stderr, /all 3 attempts lost a race/);
});

test("the cap is the caller's number, not a constant baked in here", () => {
  const r = drive(5, [2]);
  assert.deepEqual(r.attempts, ["1", "2", "3", "4", "5"]);
  assert.equal(r.exit, 2);
});

// ── §2 the law's other half: ONLY a race comes back around ──────────────────

test("a REFUSAL is passed straight through — a rerun composes the same red", () => {
  // settlement-auto.sh's own header: "A red suite publishes nothing and exits 1
  // loudly — a refusal is a finding for the keeper's judgment, never a retry."
  // Retrying it would multiply the cost of one fault by three and change no
  // outcome; worse, on a canon-bad refusal it would do so twice a day forever.
  const r = drive(3, [1]);
  assert.equal(r.exit, 1);
  assert.deepEqual(r.attempts, ["1"], "a refusal was retried");
  assert.ok(!/lost a race/.test(r.stderr), "a refusal was narrated as a race");
});

test("a machinery failure is passed straight through too — 2 is the only retriable code", () => {
  // A git that cannot reach origin exits 128; a node that throws exits 1 or 7.
  // None of them mean "somebody else wrote, look again", and a retry loop that
  // swallowed them would turn one visible crash into three invisible ones.
  for (const code of [1, 3, 64, 127]) {
    const r = drive(3, [code]);
    assert.equal(r.exit, code, `exit ${code} did not pass through unchanged`);
    assert.deepEqual(r.attempts, ["1"], `exit ${code} was retried`);
  }
});

// ── §3 each attempt knows which one it is ───────────────────────────────────

test("every attempt is told its own number — the body must be able to tell it is the body", () => {
  // settlement-auto.sh reads SETTLEMENT_ATTEMPT to know it is the inner run
  // rather than the wrapper. If it arrived unset the body would re-enter the
  // wrapper and fork a retry loop inside every retry.
  const r = drive(3, [2, 2, 0]);
  assert.deepEqual(r.attempts, ["1", "2", "3"]);
});
