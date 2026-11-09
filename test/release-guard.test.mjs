// release-guard.test.mjs — the release train's rollback guard (POS-971).
//
// On 2026-11-09 at 01:28Z a release tag cut by hand at an old commit (4a823b9f,
// from before w46) was pushed, and the release train deployed it to prod. The
// guard has two halves, and this file runs both from the shipped text:
//
//   the runner's half   deploy/release-guard.sh, run whole under bash against a
//                       fixture repository: A → B → C on main, D branched off A.
//                       It passes a candidate that descends from what prod runs
//                       and refuses one that does not (tonight's case, and a
//                       divergent line). With prod unreadable it measures against
//                       the newest release tag that is not the candidate's own.
//   the box's half      deploy/remote-deploy.sh preflight, which every version of
//                       release-train.yml takes from main. Called the old way,
//                       with three arguments, it refuses before any box check.
//   the wiring          release-train.yml runs the guard after the tag resolves
//                       and before the door to the box opens, skips it only for
//                       workflow_dispatch, reads only the top-level sha of a
//                       stamped office, and passes the sha and event to preflight.
//
//   node --test test/release-guard.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { tempDir } from "./helpers/temp-dir.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const GUARD = join(ROOT, "deploy", "release-guard.sh");
const REMOTE = join(ROOT, "deploy", "remote-deploy.sh");
const WORKFLOW = readFileSync(join(ROOT, ".github", "workflows", "release-train.yml"), "utf8");
const posix = (p) => p.replaceAll("\\", "/");
const skip = spawnSync("bash", ["-c", "exit 0"]).status === 0 ? false : "no bash on this host";

// ── the fixture: A → B → C on main, D off A ─────────────────────────────────
function fixture({ tags = true } = {}) {
  const dir = tempDir("release-guard-");
  let clock = Date.UTC(2026, 10, 1) / 1000;
  const git = (...a) => {
    clock += 60; // creatordate orders the tags, so every write gets its own minute
    const date = `${clock} +0000`;
    return execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", "-c", "tag.gpgsign=false", "-c", "core.autocrlf=false", ...a], {
      cwd: dir, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
    }).trim();
  };
  const commit = (name) => {
    writeFileSync(join(dir, `${name}.txt`), `${name}\n`);
    git("add", ".");
    git("commit", "-qm", name);
    return git("rev-parse", "HEAD");
  };
  git("init", "-q", "-b", "main");
  const A = commit("A");
  const B = commit("B");
  const C = commit("C");
  git("checkout", "-q", "-b", "side", A);
  const D = commit("D");
  git("checkout", "-q", "main");
  if (tags) {
    git("tag", "-a", "release/2026-w45", A, "-m", "w45");
    git("tag", "-a", "release/2026-w46", B, "-m", "w46");
    // tonight's stray tag: the newest, cut at the old commit
    git("tag", "-a", "release/2026-w46.2", A, "-m", "w46.2, cut by mistake");
  }
  return { dir, A, B, C, D };
}

// Built once and only read: every test below asks the same repository a different question.
let shared;
const tagged = () => (shared ??= fixture());

const guard = (dir, ...args) => spawnSync("bash", [posix(GUARD), ...args], { cwd: dir, encoding: "utf8" });

test("the guard passes a candidate that descends from what prod runs, and the one prod already runs", { skip }, () => {
  const { dir, B, C } = tagged();
  const forward = guard(dir, C, B);
  assert.equal(forward.status, 0, forward.stdout + forward.stderr);
  assert.match(forward.stdout, new RegExp(`descends from the commit prod runs \\(${B}\\)`));
  const same = guard(dir, B, B);
  assert.equal(same.status, 0, same.stdout + same.stderr);
});

test("the guard refuses tonight's case: an old commit over a newer live one", { skip }, () => {
  const { dir, A, C } = tagged();
  const r = guard(dir, A, C);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /::error::the rollback guard \(POS-971\) refuses/);
  assert.match(r.stdout, new RegExp(`refuses release/2026-w45,release/2026-w46\\.2 @ ${A}`), "names the candidate by its tags and sha");
  assert.match(r.stdout, new RegExp(`not a descendant of the commit prod runs \\(${C}\\)`));
  assert.match(r.stdout, /workflow_dispatch from main with the tag named/);
});

test("the guard refuses a divergent line: a commit prod never ran beside the one it runs", { skip }, () => {
  const { dir, C, D } = tagged();
  const r = guard(dir, D, C);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, new RegExp(`refuses ${D}:`));
});

test("with prod unreadable, the guard measures against the newest release tag that is not the candidate's own", { skip }, () => {
  const { dir, A, B, C } = tagged();
  // the stray w46.2 at A is the newest tag; it is the candidate's own, so w46 at B stands in, and A refuses
  const stray = guard(dir, A, "");
  assert.equal(stray.status, 1, stray.stdout + stray.stderr);
  assert.match(stray.stdout, /prod's live commit could not be read/);
  assert.match(stray.stdout, new RegExp(`not a descendant of release/2026-w46, the newest other release tag \\(${B}\\)`));
  // the newest tag, w46.2, stands in for C, and C descends from it
  const next = guard(dir, C, "");
  assert.equal(next.status, 0, next.stdout + next.stderr);
  assert.match(next.stdout, /descends from release\/2026-w46\.2, the newest other release tag/);
  // a live sha this repository does not hold is measured the same way
  const unknown = guard(dir, C, "f".repeat(40));
  assert.equal(unknown.status, 0, unknown.stdout + unknown.stderr);
  assert.match(unknown.stdout, /is not a commit in this repository/);
});

test("with no live commit and no other release tag, the guard passes with a notice", { skip }, () => {
  const { dir, A } = fixture({ tags: false });
  const r = guard(dir, A, "");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /::notice::the rollback guard \(POS-971\) has no live commit and no other release tag/);
});

test("the guard cannot run without a candidate, or with one that is not a commit", { skip }, () => {
  const { dir } = tagged();
  assert.equal(guard(dir).status, 2);
  const bogus = guard(dir, "e".repeat(40), "");
  assert.equal(bogus.status, 2);
  assert.match(bogus.stderr, /is not a commit in this checkout/);
});

// ── the box's half: remote-deploy.sh preflight ──────────────────────────────
const preflight = (...args) => spawnSync("bash", [posix(REMOTE), "preflight", ...args], { encoding: "utf8" });

test("preflight called the old way (three arguments) refuses with POS-971 before any box check", { skip }, () => {
  const r = preflight("/nonexistent", "svc", "1");
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /DEPLOY FAILED: this run's workflow predates the rollback guard \(POS-971\)/);
  assert.match(r.stderr, /workflow_dispatch from main/);
  assert.doesNotMatch(r.stderr, /does not exist on this box/, "the guard comes before the root check");
  assert.doesNotMatch(r.stdout, /== preflight:/, "nothing past the guard ran");
});

test("preflight refuses a sha that is not a full commit id, and admits a full one to the existing checks", { skip }, () => {
  const short = preflight("/nonexistent", "svc", "1", "a21e262f", "push");
  assert.notEqual(short.status, 0);
  assert.match(short.stderr, /needs the full 40-character sha/);
  const full = preflight("/nonexistent", "svc", "1", "a".repeat(40), "push");
  assert.notEqual(full.status, 0);
  assert.match(full.stdout, new RegExp(`brings ${"a".repeat(40)} \\(push\\)`));
  assert.match(full.stderr, /\/nonexistent does not exist on this box/, "the existing checks run unchanged after the guard");
});

// ── the wiring in release-train.yml ─────────────────────────────────────────
/** One step of the deploy job, sliced from its `- name:` line to the next step. */
function step(name) {
  const at = WORKFLOW.indexOf(`      - name: ${name}\n`);
  assert.notEqual(at, -1, `release-train.yml has no step named "${name}"`);
  const next = WORKFLOW.slice(at + 1).search(/\n {6}- (name|uses):/);
  return { at, text: next === -1 ? WORKFLOW.slice(at) : WORKFLOW.slice(at, at + 1 + next) };
}

test("release-train.yml runs the guard after the tag resolves and before the door to the box opens, except for a dispatch", () => {
  const resolved = step("Resolve the tag and its commit");
  const guardStep = step("The rollback guard (POS-971)");
  const door = step("Open the door to the box");
  assert.ok(resolved.at < guardStep.at && guardStep.at < door.at, "order: resolve, guard, open the door");
  assert.ok(guardStep.at < step("Copy the release onto the box").at);
  assert.match(guardStep.text, /if: steps\.lane\.outputs\.deploy == 'true' && github\.event_name != 'workflow_dispatch'/);
  assert.match(guardStep.text, /SHA: \$\{\{ steps\.pin\.outputs\.sha \}\}/);
  assert.match(guardStep.text, /curl -fsS --max-time 10 https:\/\/postmark\.town\/api\/release/);
  assert.match(guardStep.text, /bash deploy\/release-guard\.sh "\$SHA" "\$LIVE"/);
});

test("release-train.yml passes the sha and the event to preflight", () => {
  const pre = step("Preflight the box").text;
  assert.match(pre, /SHA: \$\{\{ steps\.pin\.outputs\.sha \}\}/);
  assert.match(pre, /EVENT: \$\{\{ github\.event_name \}\}/);
  assert.match(pre, /' preflight '\$ROOT' '\$SERVICE' '\$PORT' '\$SHA' '\$EVENT'"/);
});

test("the guard step reads only the top-level sha of a stamped office", () => {
  const m = step("The rollback guard (POS-971)").text.match(/node -e '\n([\s\S]*?)\n\s*'\)/);
  assert.ok(m, "the guard step no longer parses /release with an inline node program");
  const read = (body) => execFileSync(process.execPath, ["-e", m[1]], { input: body, encoding: "utf8" });
  const live = "a21e262f29e1bf7506d0a5f3b91c821e99f1815a";
  // the shape prod answers, with the nested shas that must not be taken for the office's
  const stamped = { deployed: true, tag: "release/2026-w46.1", sha: live, law: { sha: "9".repeat(40) }, world_graph: { office_sha: "8".repeat(40) } };
  assert.equal(read(JSON.stringify(stamped)), live);
  assert.equal(read(JSON.stringify({ deployed: false, reason: "no release.json", law: { sha: "9".repeat(40) } })), "");
  assert.equal(read("<html>502 Bad Gateway</html>"), "");
});
