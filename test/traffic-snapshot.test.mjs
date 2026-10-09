// traffic-snapshot — the daily GitHub traffic capture commits to its own repo,
// postmark-town/postmark-telemetry, never to the office (POS-428, Darko's option
// b, 2026-10-07). The clone check and the commit-and-push half run against
// scratch repositories; nothing here calls GitHub or the box.

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync, execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { telemetryClone, commitSnapshots, TELEMETRY_REMOTE } from "../tools/traffic-snapshot.mjs";
import { removeTempDirSync } from "./helpers/temp-dir.mjs";

const TOOL = resolve(dirname(fileURLToPath(import.meta.url)), "..", "tools", "traffic-snapshot.mjs");
const git = (dir, ...args) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const fwd = (p) => p.replace(/\\/g, "/");

// A scratch "GitHub": <root>/postmark-town/postmark-telemetry.git, bare and empty
// on main, as Darko's new repo will be, plus a clone of it ready to commit.
function scratch(t) {
  const root = mkdtempSync(join(tmpdir(), "traffic-snapshot-"));
  t.after(() => removeTempDirSync(root));
  const bare = join(root, "postmark-town", "postmark-telemetry.git");
  mkdirSync(bare, { recursive: true });
  execFileSync("git", ["init", "--quiet", "--bare", "--initial-branch=main", bare]);
  const clone = (name) => {
    const dir = join(root, name);
    execFileSync("git", ["clone", "--quiet", fwd(bare), dir], { stdio: ["ignore", "pipe", "pipe"] });
    git(dir, "config", "user.name", "test");
    git(dir, "config", "user.email", "test@example.invalid");
    git(dir, "symbolic-ref", "HEAD", "refs/heads/main");
    return dir;
  };
  return { root, bare, clone };
}
const snap = (dir, file) => {
  mkdirSync(join(dir, "github"), { recursive: true });
  writeFileSync(join(dir, "github", file), "{}\n");
};

test("no clone at the path: refused by name, with the instruction to create it", (t) => {
  const { root } = scratch(t);
  const missing = join(root, "telemetry");
  const v = telemetryClone({ TELEMETRY_REPO: missing });
  assert.equal(v.ok, false);
  assert.match(v.refusal, /no clone at/);
  assert.match(v.refusal, new RegExp(`gh repo clone ${TELEMETRY_REMOTE} "${fwd(missing).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
  assert.match(v.refusal, /never to the office repo \(POS-428\)/);
});

test("a folder inside another repo (the office's own telemetry/) is refused, never committed to", (t) => {
  const { root } = scratch(t);
  const office = join(root, "office");
  execFileSync("git", ["init", "--quiet", "--initial-branch=main", office]);
  mkdirSync(join(office, "telemetry"), { recursive: true });
  const v = telemetryClone({ TELEMETRY_REPO: join(office, "telemetry") });
  assert.equal(v.ok, false);
  assert.match(v.refusal, /sits inside another repo/);
});

test("a clone of any other repo is refused (the office clone itself included)", (t) => {
  const { root } = scratch(t);
  const office = join(root, "office");
  execFileSync("git", ["init", "--quiet", "--initial-branch=main", office]);
  git(office, "remote", "add", "origin", "https://github.com/postmark-town/postmark-office.git");
  const v = telemetryClone({ TELEMETRY_REPO: office });
  assert.equal(v.ok, false);
  assert.match(v.refusal, /origin is 'https:\/\/github\.com\/postmark-town\/postmark-office\.git', not postmark-town\/postmark-telemetry/);
});

test("the telemetry clone off main is refused unless TRAFFIC_ALLOW_BRANCH is set", (t) => {
  const { clone } = scratch(t);
  const dir = clone("telemetry");
  git(dir, "symbolic-ref", "HEAD", "refs/heads/hotfix-w35-7");
  const v = telemetryClone({ TELEMETRY_REPO: dir });
  assert.equal(v.ok, false);
  assert.match(v.refusal, /on 'hotfix-w35-7', not main/);
  assert.equal(telemetryClone({ TELEMETRY_REPO: dir, TRAFFIC_ALLOW_BRANCH: "1" }).ok, true);
});

test("a clone of postmark-telemetry on main is accepted, by https or ssh origin", (t) => {
  const { clone } = scratch(t);
  const dir = clone("telemetry");
  assert.deepEqual(telemetryClone({ TELEMETRY_REPO: dir }), { ok: true, dir: resolve(dir) });
  for (const url of ["https://github.com/postmark-town/postmark-telemetry.git", "git@github.com:postmark-town/postmark-telemetry.git", "https://github.com/postmark-town/postmark-telemetry"]) {
    git(dir, "remote", "set-url", "origin", url);
    assert.equal(telemetryClone({ TELEMETRY_REPO: dir }).ok, true, url);
  }
});

test("the first snapshot into the empty repo commits and pushes main", (t) => {
  const { bare, clone } = scratch(t);
  const dir = clone("telemetry");
  snap(dir, "postmark-2026-10-07.json");
  const r = commitSnapshots(dir, "2026-10-07");
  assert.equal(r.code, 0, r.line);
  assert.match(r.line, /committed \+ pushed \(1 file\(s\)\)/);
  assert.equal(git(bare, "rev-parse", "main"), git(dir, "rev-parse", "HEAD"));
  assert.equal(git(bare, "log", "-1", "--format=%s", "main"), "telemetry: github traffic 2026-10-07");
});

test("the remote moved since the last round: rebase first, then push, and the remote holds both", (t) => {
  const { bare, clone } = scratch(t);
  const dir = clone("telemetry");
  snap(dir, "postmark-2026-10-06.json");
  assert.equal(commitSnapshots(dir, "2026-10-06").code, 0);
  const other = clone("other");
  snap(other, "postmark-site-2026-10-06.json");
  assert.equal(commitSnapshots(other, "2026-10-06").code, 0);
  snap(dir, "postmark-2026-10-07.json");
  const r = commitSnapshots(dir, "2026-10-07");
  assert.equal(r.code, 0, r.line);
  assert.deepEqual(git(bare, "ls-tree", "--name-only", "main", "github/").split("\n"),
    ["github/postmark-2026-10-06.json", "github/postmark-2026-10-07.json", "github/postmark-site-2026-10-06.json"]);
});

test("nothing new staged: no commit, exit 0", (t) => {
  const { clone } = scratch(t);
  const dir = clone("telemetry");
  snap(dir, "postmark-2026-10-07.json");
  commitSnapshots(dir, "2026-10-07");
  const r = commitSnapshots(dir, "2026-10-07");
  assert.deepEqual(r, { code: 0, line: "telemetry repo: nothing new to commit" });
});

test("a refused push is committed-but-not-pushed, exit 3, never 0 (office#84)", (t) => {
  const { bare, clone } = scratch(t);
  const dir = clone("telemetry");
  writeFileSync(join(bare, "hooks", "pre-receive"), "#!/bin/sh\necho 'refused by test hook' >&2\nexit 1\n", { mode: 0o755 });
  snap(dir, "postmark-2026-10-07.json");
  const r = commitSnapshots(dir, "2026-10-07");
  assert.equal(r.code, 3);
  assert.match(r.line, /committed but NOT pushed/);
  assert.match(r.line, /origin\/main \(none\)/);
});

test("the tool run with no clone exits 1 before any capture and leaves the office tree alone", (t) => {
  const { root } = scratch(t);
  const office = resolve(dirname(TOOL), "..");
  const before = spawnSync("git", ["-C", office, "status", "--porcelain", "--", "telemetry"], { encoding: "utf8" }).stdout;
  const r = spawnSync(process.execPath, [TOOL], { encoding: "utf8", env: { ...process.env, TELEMETRY_REPO: join(root, "telemetry") } });
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stderr, /telemetry clone refused: no clone at/);
  assert.match(r.stderr, /Nothing captured\./);
  assert.doesNotMatch(r.stdout + r.stderr, /views|capture FAILED|box:/);
  assert.equal(spawnSync("git", ["-C", office, "status", "--porcelain", "--", "telemetry"], { encoding: "utf8" }).stdout, before);
});
