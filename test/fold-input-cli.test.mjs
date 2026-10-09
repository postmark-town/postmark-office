// fold-input-cli.test.mjs — THE DOCKET IS REQUIRED (G1 lane 3, repair 11).
//
//   node --test test/fold-input-cli.test.mjs
//
// The reviewer's finding: `--delta-window` existed only as a word in a usage
// comment. A documented flag with no reader is this lane's own recurring class,
// and its consequence here was that the shipped chain could not reach the
// configuration the report's headline described. The narrowing that WAS running
// was the byte comparison, which is the control configuration: 956 written and a
// red suite.
//
// So the flag is real now, it is spelled the same in the usage line and the
// parser, and its absence REFUSES. This is the falsifier the ruling names:
// offer the full standing set with no window and the chain must never reach a
// sketchbook.

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { ingestOrdering } from "../world2/tools/fold-input-cli.mjs";

const OFFICE = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(OFFICE, "world2", "tools", "fold-input-cli.mjs");

const run = (args, env = {}) => spawnSync(process.execPath, [CLI, ...args], {
  encoding: "utf8",
  env: {
    ...process.env,
    WORLD2_PG: "1",
    // A URL that cannot connect, deliberately: every assertion below is about a
    // refusal that must happen BEFORE a connection is attempted. If one of them
    // ever starts failing with a connection error, the check has drifted past
    // the point it was meant to guard.
    WORLD2_PG_URL: "postgres://nobody@127.0.0.1:1/nowhere",
    ...env,
  },
});

test("no --window REFUSES, and refuses before it opens a database", () => {
  const r = run(["--world-sha", "a".repeat(40), "--town-clone", OFFICE, "--town-sha", "b".repeat(40)]);
  assert.equal(r.status, 1);
  const body = JSON.parse(r.stdout);
  assert.equal(body.refused, "no-docket-window");
  assert.match(body.detail, /docket is the selector/);
  assert.doesNotMatch(`${r.stdout}${r.stderr}`, /ECONNREFUSED|connect/i,
    "a refusal that first opens a database has a second way to fail, and on the night the store is also down the "
    + "operator would read the wrong cause");
});

test("a --window that is not a number is an ARGUMENT error, not a refusal", () => {
  // Exit 2 rather than 1, and no JSON body: a malformed invocation is the
  // operator's typo, not the store's answer, and the receipt must not carry it
  // as though the register had said something.
  const r = run(["--world-sha", "a".repeat(40), "--town-clone", OFFICE, "--town-sha", "b".repeat(40), "--window", "lately"]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--window must be a number/);
  assert.equal(r.stdout.trim(), "");
});

test("no store credential refuses under its own name, ahead of everything else", () => {
  const r = run(["--world-sha", "a".repeat(40), "--town-clone", OFFICE, "--town-sha", "b".repeat(40), "--window", "177"],
    { WORLD2_PG: "0" });
  assert.equal(r.status, 1);
  assert.equal(JSON.parse(r.stdout).refused, "no-store-credential");
});

test("TWO foldDeltas REFUSE rather than one winning silently", () => {
  // The conductor's ownership ruling (2026-09-09) makes `fold-delta.mjs` the
  // canonical selector and tells lane 2 not to build a second. This is the guard
  // for the day somebody does anyway — by a merge, a rebase, or a good
  // intention. Two functions answering "which marks are this crossing's" can
  // disagree, and nothing downstream could say which one answered.
  //
  // Exercised by shadowing lane 2's module in a throwaway copy of the tools
  // directory, so the real files are untouched.
  const dir = mkdtempSync(join(tmpdir(), "twodelta-"));
  try {
    const tools = join(dir, "world2", "tools");
    execFileSync("node", ["-e", `require("node:fs").mkdirSync(${JSON.stringify(tools)},{recursive:true})`]);
    // THE CLOSURE, NOT THE THREE FILES THE LANE STARTED WITH. `fold-delta.mjs`
    // imports `canon-locks.mjs` (which imports `escrow-presence.mjs`) for the
    // 2026-09-12 carry, and this CLI imports `canon-register.mjs` to build the
    // register from `--world-repo`. A copy list that has fallen behind the
    // imports fails as a module that will not LOAD — which arrives here as an
    // empty stdout and an unparseable JSON, not as the refusal this test is
    // about, so the guard would read broken exactly when it was still fine.
    for (const f of ["fold-input-cli.mjs", "fold-delta.mjs", "mark-render.mjs",
      "canon-locks.mjs", "canon-register.mjs", "escrow-presence.mjs"]) {
      copyFileSync(join(OFFICE, "world2", "tools", f), join(tools, f));
    }
    // A stand-in for lane 2's module that exports BOTH names.
    writeFileSync(join(tools, "fold-input.mjs"),
      "export async function foldInputFromStore() { return {}; }\n"
      + "export async function stakesFromStore() { return []; }\n"
      + "export async function foldDelta() { return {}; }\n");
    // `mark-render.mjs` imports ../../src/mark-record.mjs; give it the real one.
    mkdirSync(join(dir, "src"), { recursive: true });
    copyFileSync(join(OFFICE, "src", "mark-record.mjs"), join(dir, "src", "mark-record.mjs"));

    const r = spawnSync(process.execPath, [join(tools, "fold-input-cli.mjs"),
      "--world-sha", "a".repeat(40), "--town-clone", OFFICE, "--town-sha", "b".repeat(40), "--window", "177"], {
      encoding: "utf8",
      env: { ...process.env, WORLD2_PG: "1", WORLD2_PG_URL: "postgres://nobody@127.0.0.1:1/nowhere" },
    });
    assert.equal(r.status, 1, `expected a refusal; stdout=${r.stdout} stderr=${r.stderr.slice(0, 300)}`);
    assert.equal(JSON.parse(r.stdout).refused, "two-fold-deltas");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── the ingest ordering, as a pure function over a real repo ─────────────────

test("ingestOrdering: a head that is not an object in the town REFUSES", () => {
  const o = ingestOrdering(OFFICE, { storeSha: "0".repeat(40), fetchedSha: "HEAD" });
  assert.equal(o.ok, false);
  assert.equal(o.reason, "unknown-object");
});

test("ingestOrdering: the same sha is `current`, behind 0", () => {
  const head = execFileSync("git", ["-C", OFFICE, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const o = ingestOrdering(OFFICE, { storeSha: head, fetchedSha: head });
  assert.deepEqual({ ok: o.ok, reason: o.reason, behind: o.behind }, { ok: true, reason: "current", behind: 0 });
});

test("ingestOrdering: an ancestor is `behind`, with the distance NAMED", () => {
  // `behind` climbing across successive receipts is the only surface a stopped
  // ingest has, so the number matters more than the boolean.
  //
  // The repo is built here, not read off the office's own history. An earlier
  // form took the office's `HEAD~2` and asserted `behind === 2`, which is true
  // only while HEAD~2..HEAD is a straight line of two: on a tree where this
  // branch sits behind two --no-ff merges the same walk counts 26, so the test
  // went red on the merged train and would have stayed red on main for good.
  // A test whose oracle is the repository it lives in measures that
  // repository's shape, not the function (the class: calendar-pinned controls).
  const dir = mkdtempSync(join(tmpdir(), "foldcli-behind-"));
  try {
    const g = (...a) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    g("init", "-q", "-b", "main");
    g("config", "user.email", "t@x.invalid"); g("config", "user.name", "t");
    g("commit", "-q", "--allow-empty", "-m", "one");
    const first = g("rev-parse", "HEAD").trim();
    g("commit", "-q", "--allow-empty", "-m", "two");
    g("commit", "-q", "--allow-empty", "-m", "three");
    const head = g("rev-parse", "HEAD").trim();
    const o = ingestOrdering(dir, { storeSha: first, fetchedSha: head });
    assert.equal(o.ok, true);
    assert.equal(o.reason, "behind");
    assert.equal(o.behind, 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("ingestOrdering: a head that is NOT an ancestor refuses — a rewritten branch or the wrong clone", () => {
  const dir = mkdtempSync(join(tmpdir(), "foldcli-"));
  try {
    const g = (...a) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    g("init", "-q", "-b", "main");
    g("config", "user.email", "t@x.invalid"); g("config", "user.name", "t");
    g("commit", "-q", "--allow-empty", "-m", "one");
    const a = g("rev-parse", "HEAD").trim();
    g("checkout", "-q", "--orphan", "other");
    g("commit", "-q", "--allow-empty", "-m", "elsewhere");
    const b = g("rev-parse", "HEAD").trim();
    const o = ingestOrdering(dir, { storeSha: b, fetchedSha: a });
    assert.equal(o.ok, false);
    assert.equal(o.reason, "not-an-ancestor");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── POS-364: git is written from the settlement ─────────────────────────────

test("withholdTakenAway: the settlement's returns leave the fold input, counted apart for the docket and the carry", async () => {
  const { withholdTakenAway } = await import("../world2/tools/fold-input-cli.mjs");
  const marks = [{ slug: "a/plot" }, { slug: "b/over-cap" }, { slug: "b/over-cap-name" }, { slug: "c/carried-opposed" }, { slug: "d/carried" }];
  const selection = { entry: "fold-delta.mjs § foldDelta", docket_claims: 3, carried_absent: { checked: true, count: 2, slugs: ["c/carried-opposed", "d/carried"] } };
  const w = withholdTakenAway({ marks, selection }, new Set(["b/over-cap", "b/over-cap-name", "c/carried-opposed", "z/not-offered"]));
  assert.deepEqual(w.marks.map((m) => m.slug), ["a/plot", "d/carried"]);
  assert.equal(w.fromDocket, 2, "the opposed parcel and the name that continues it");
  assert.equal(w.fromCarry, 1);
  assert.deepEqual(w.selection.carried_absent, { checked: true, count: 1, slugs: ["d/carried"] }, "the carry stays a subset of what is offered");
  assert.equal(selection.carried_absent.count, 2, "the input is not edited");
  const none = withholdTakenAway({ marks, selection }, new Set());
  assert.equal(none.marks.length, 5);
  assert.equal(none.selection, selection, "nothing taken away: the selection is the same object");
});
