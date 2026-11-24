// settlement-dry-leg.test.mjs — SETTLEMENT_DRY=1 RUNS THE CROSSING AND WRITES NOTHING (POS-242; POS-1025).
//
//   node --test test/settlement-dry-leg.test.mjs
//
// ── WHAT IS UNDER TEST ──────────────────────────────────────────────────────
//
// The dry leg is the same script to the same receipt with every write that
// leaves the run withheld and named. Each withheld writer has one test below,
// and each test is paired with a CONTROL crossing in the same bottle with DRY
// unset, which shows the writer is live there. A "nothing was written" that was
// never shown to be something that COULD be written is a gate wired to nothing.
//
// Since the printout (POS-1025) the writers are: main's push, the printout's
// commit, the tag and its push, the store's record of the printout, the
// photograph, every escalation, the history line, and the suite log's home.
//
// ── THE BOTTLE ──────────────────────────────────────────────────────────────
//
// test/helpers/settlement-bottle.mjs: the receipt, the history and the retry
// are the REAL files; the store tools (the printout among them), the registry
// pair and the escalation are stubs that log their argv and, when not told to
// be dry, WRITE the way the real tool writes. The photograph is the REAL writer
// (its own dry run is pinned by test/state-log-write.test.mjs W6), and the tag
// is a real annotated tag the crossing itself pushes.

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { SH_OK, g, bottle, cross, SETTLEMENT } from "./helpers/settlement-bottle.mjs";

const skip = !SH_OK && "no POSIX sh";

const argvOf = (run, name) => run.stubs.filter((l) => l.startsWith(`${name} `));
const why = (run) => `exit ${run.res.status}\n${run.res.stderr}`;
const TAG = `settlement/S${SETTLEMENT}`;
const tagOnOrigin = (b) => { try { return g(b.origin, "rev-parse", "--verify", "--quiet", `refs/tags/${TAG}^{commit}`); } catch { return null; } };

// ── the control: every writer below is LIVE in this bottle ──────────────────

test("CONTROL · without DRY the bottle's crossing writes through every door the dry leg withholds", { skip }, () => {
  const b = bottle();
  const run = cross(b);
  assert.equal(run.res.status, 0, why(run));
  assert.equal(run.receipt.status, "published");
  assert.notEqual(run.after, run.before, "origin moved: main was pushed");
  assert.match(g(b.origin, "log", "--format=%s", "main"), /photograph: windows 213/, "the photograph landed on origin");
  assert.equal(g(b.origin, "log", "-1", "--format=%s", "main"), `settlement: S${SETTLEMENT} printout — 1 written, 1 removed, 0 re-framed`, "the printout landed on origin");
  assert.equal(tagOnOrigin(b), g(b.origin, "rev-parse", "main"), "the tag was cut at the pushed printout and pushed");
  assert.match(run.storeWrites ?? "", new RegExp(`RECORDED 213 ${g(b.origin, "rev-parse", "main")}`), "the store recorded the printout");
  assert.match(run.escalations ?? "", /FILED suite-warning/, "a person was told");
  assert.ok(run.history && run.history.trim().length, "the history log took a line");
  assert.ok(existsSync(join(b.office, "settlement-last-suite.log")), "the suite log was kept in the office");
  assert.match(g(run.clone, "config", "--local", "--get", "credential.helper"), /\.git-credentials/, "the live clone holds the pen's credential");
  assert.equal(run.receipt.dry, false, "and every receipt says whether it was dry");
  assert.deepEqual(run.receipt.withheld, []);
  assert.ok(argvOf(run, "await-clearing").every((l) => !l.includes("--rehearse")), "the timer's question");
});

// ── the dry leg ─────────────────────────────────────────────────────────────

test("D1 · DRY crosses to a full receipt and nothing reaches origin — no push, no tag", { skip }, () => {
  const b = bottle();
  const run = cross(b, { SETTLEMENT_DRY: "1" });
  assert.equal(run.res.status, 0, why(run));
  assert.equal(run.after, run.before, "every ref on origin, tags included, is as it was");
  assert.equal(run.receipt.status, "published", "the crossing's own word for what it would have done");
  assert.equal(run.receipt.dry, true);
  assert.equal(run.receipt.detail, `DRY RUN, nothing written — S${SETTLEMENT} printed: 1 written, 1 removed, 0 re-framed`);
  assert.ok(run.receipt.withheld.some((l) => /^world main's push: [0-9a-f]{40} over origin\/main [0-9a-f]{40}$/.test(l)),
    `main's push is named: ${JSON.stringify(run.receipt.withheld)}`);
  assert.match(argvOf(run, "settlement-printout").find((l) => / print /.test(l)) ?? "", /--dry-run/);
  assert.ok(existsSync(join(run.clone, "WORLD", "marks", "alpha", "one", "mark.md")), "the printout DID render: its files are in the clone");
  assert.doesNotMatch(g(run.clone, "log", "--format=%s", "main"), /printout/, "and nothing was committed");
  assert.match(run.res.stdout, /DRY — would print S214/);
});

test("D2 · DRY renders the photograph and does not commit or push it", { skip }, () => {
  const b = bottle();
  const run = cross(b, { SETTLEMENT_DRY: "1" });
  assert.equal(run.res.status, 0, why(run));
  const argv = argvOf(run, "state-log-write");
  assert.equal(argv.length, 1, "the photograph step still runs");
  assert.match(argv[0], /--write --dry-run/);
  assert.doesNotMatch(g(run.clone, "log", "--format=%s", "main"), /photograph:/, "nothing committed");
  assert.ok(run.receipt.withheld.some((l) => l.startsWith("the photograph's commit and push (STATE/log, window 213)")));
});

test("D3 · DRY names the tag and the store's record, and writes neither", { skip }, () => {
  const b = bottle();
  const run = cross(b, { SETTLEMENT_DRY: "1" });
  assert.equal(run.res.status, 0, why(run));
  assert.equal(run.storeWrites, null, "the store was not written");
  assert.equal(tagOnOrigin(b), null, "no tag on origin");
  assert.match(argvOf(run, "settlement-printout").find((l) => / tag /.test(l) || l.startsWith("settlement-printout tag")) ?? "", /--dry-run/);
  assert.equal(argvOf(run, "settlement-printout").filter((l) => l.startsWith("settlement-printout record")).length, 0, "record never called");
  assert.ok(run.receipt.withheld.some((l) => l.startsWith(`the tag ${TAG} at `)), JSON.stringify(run.receipt.withheld));
  assert.ok(run.receipt.withheld.some((l) => l.startsWith("the store's record of the printout (record_printout, window 213")));
  assert.equal(run.receipt.tag.status, "would-tag");
  assert.equal(run.receipt.record, null);
});

test("D4 · DRY tells nobody: no escalation runs, and the receipt names the one it withheld", { skip }, () => {
  const b = bottle();
  const run = cross(b, { SETTLEMENT_DRY: "1" });
  assert.equal(run.res.status, 0, why(run));
  assert.equal(run.escalations, null, "the escalation tool never ran");
  assert.equal(argvOf(run, "settlement-escalate").length, 0);
  assert.ok(run.receipt.withheld.includes("escalation: suite-warning"), JSON.stringify(run.receipt.withheld));
  assert.equal(run.receipt.suite.red, true, "the checker still ran and its red is on the receipt");
});

test("D4b · harm under DRY is REPORTED (POS-1025/c): a published receipt whose harm-warning is named, not filed", { skip }, () => {
  const b = bottle({ harm: true });
  const control = cross(b, { REGISTRY_N: "2" });
  assert.equal(control.res.status, 0, why(control));
  assert.equal(control.receipt.status, "published", "control: harm no longer holds the town");
  assert.match(control.escalations ?? "", /FILED harm-warning/, "control: harm reaches a person");
  const run = cross(b, { SETTLEMENT_DRY: "1", REGISTRY_N: "3" });
  assert.equal(run.res.status, 0, why(run));
  assert.equal(run.receipt.status, "published");
  assert.equal(run.receipt.harm.ok, false);
  assert.equal(run.escalations, null);
  assert.ok(run.receipt.withheld.includes("escalation: harm-warning"), JSON.stringify(run.receipt.withheld));
});

test("D5 · DRY writes no history line — the roll-call's log never sees a rehearsal", { skip }, () => {
  const b = bottle();
  const run = cross(b, { SETTLEMENT_DRY: "1" });
  assert.equal(run.res.status, 0, why(run));
  assert.equal(run.history, null);
});

test("D6 · DRY keeps the suite log beside its own receipt, never in the office", { skip }, () => {
  const b = bottle();
  const run = cross(b, { SETTLEMENT_DRY: "1" });
  assert.equal(run.res.status, 0, why(run));
  assert.equal(existsSync(join(b.office, "settlement-last-suite.log")), false);
  assert.ok(existsSync(run.files.report.replace(/\.json$/, "-suite.log")));
  assert.equal(run.receipt.suite.log, `receipt-${run.files.report.match(/receipt-(\d+)\.json$/)[1]}-suite.log`);
});

test("D7 · a clone the dry leg makes holds no push credential", { skip }, () => {
  const b = bottle();
  const run = cross(b, { SETTLEMENT_DRY: "1" });
  assert.equal(run.res.status, 0, why(run));
  const helper = spawnSync("git", ["-C", run.clone, "config", "--local", "--get", "credential.helper"], { encoding: "utf8" });
  assert.equal(helper.stdout.trim(), "", "no credential helper on the dry clone");
});

test("D8 · DRY asks the shadow's question: the newest closed window", { skip }, () => {
  const b = bottle();
  const run = cross(b, { SETTLEMENT_DRY: "1" });
  assert.equal(run.res.status, 0, why(run));
  assert.match(argvOf(run, "await-clearing")[0] ?? "", /--rehearse/);
  const byHand = cross(b, { SETTLEMENT_DRY: "1", SETTLEMENT_BY_HAND: "1" });
  assert.match(argvOf(byHand, "await-clearing")[0] ?? "", /--by-hand/, "by hand, it rehearses the operator's door");
  assert.doesNotMatch(argvOf(byHand, "await-clearing")[0] ?? "", /--rehearse/);
});

test("D9 · a quiet settlement with a registry commit under DRY withholds main's push and its tag too", { skip }, () => {
  const b = bottle({ suiteRed: false });
  const control = cross(b, { REGISTRY_N: "2", PRINTOUT_SAYS: "quiet" });
  assert.equal(control.res.status, 0, why(control));
  assert.equal(control.receipt.status, "quiet");
  assert.notEqual(control.after, control.before, "control: the registry commit was pushed");
  assert.equal(tagOnOrigin(b), g(b.origin, "rev-parse", "main"), "control: a quiet settlement is tagged at the main it stands on");
  const b2 = bottle({ suiteRed: false });
  const run = cross(b2, { SETTLEMENT_DRY: "1", REGISTRY_N: "3", PRINTOUT_SAYS: "quiet" });
  assert.equal(run.res.status, 0, why(run));
  assert.equal(run.receipt.status, "quiet");
  assert.equal(run.after, run.before);
  assert.ok(run.receipt.withheld.some((l) => l.startsWith("world main's push: ")));
  assert.ok(run.receipt.withheld.some((l) => l.startsWith(`the tag ${TAG} at `)));
});

// ── what DRY refuses, and what every crossing refuses ───────────────────────

test("R1 · the retired git source refuses by name, DRY or not (POS-1025: one retirement, no legacy flag)", { skip }, () => {
  const b = bottle();
  for (const env of [{ SETTLEMENT_SOURCE: "git" }, { SETTLEMENT_DRY: "1", SETTLEMENT_SOURCE: "git" }]) {
    const run = cross(b, env);
    assert.equal(run.res.status, 1);
    assert.match(run.res.stderr, /the git source and its drain were retired at the printout cutover \(POS-1025\)/);
    assert.equal(run.after, run.before);
    assert.equal(run.receipt, null);
  }
  // and a unit file that still says `store` crosses as before
  const store = cross(b, { SETTLEMENT_SOURCE: "store", SETTLEMENT_DRY: "1" });
  assert.equal(store.res.status, 0, why(store));
});

test("R2 · DRY refuses the public receipt: no SETTLEMENT_REPORT, or one under /srv/postmark-harbor", { skip }, () => {
  const b = bottle();
  const none = cross(b, { SETTLEMENT_DRY: "1", SETTLEMENT_REPORT: "" });
  assert.equal(none.res.status, 1);
  assert.match(none.res.stderr, /needs its own SETTLEMENT_REPORT/);
  const harbor = cross(b, { SETTLEMENT_DRY: "1", SETTLEMENT_REPORT: "/srv/postmark-harbor/settlement-auto.json" });
  assert.equal(harbor.res.status, 1);
  assert.match(harbor.res.stderr, /will not write a receipt under \/srv\/postmark-harbor/);
  assert.equal(harbor.after, harbor.before);
});

test("R3 · DRY refuses the live clone", { skip }, () => {
  const b = bottle();
  const unset = cross(b, { SETTLEMENT_DRY: "1", SETTLEMENT_CLONE: "" });
  assert.equal(unset.res.status, 1);
  assert.match(unset.res.stderr, /needs its own SETTLEMENT_CLONE/);
  const live = cross(b, { SETTLEMENT_DRY: "1", SETTLEMENT_CLONE: `${b.office}/settlement-clone` });
  assert.equal(live.res.status, 1);
  assert.match(live.res.stderr, /needs its own SETTLEMENT_CLONE/);
});

test("R4 · an unrecognised SETTLEMENT_DRY refuses rather than guessing", { skip }, () => {
  const b = bottle();
  const run = cross(b, { SETTLEMENT_DRY: "yes" });
  assert.equal(run.res.status, 1);
  assert.match(run.res.stderr, /SETTLEMENT_DRY="yes" is not `0` or `1`/);
  assert.equal(run.after, run.before);
});
