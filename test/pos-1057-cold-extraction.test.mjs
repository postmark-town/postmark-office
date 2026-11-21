// pos-1057-cold-extraction.test.mjs — POS-1057: what blocked a read worker's loop for a minute, and the registry read on a held client.
//
// THE CAUSE, MEASURED (local, this box; the box's own numbers are Jetto's on POS-1057). The first read after a new blessing (or after a deploy that moved the
// engine cache to its new `lease-v1` namespace) finds no engine checkout for the blessed sha and extracts the world repo's `tools/` (326 files) with ONE
// SYNCHRONOUS `git show` PER FILE (world-branches.mjs § materializeAtRef). A spawn forks the calling process, and a fork costs in proportion to its address
// space: the same extraction took 1.1 s in a small process and 13.6 s in one holding 2 GB (this is the number the fix's note quotes), so in the office, which
// sat at 3.4 to 4.6 GB resident, it ran for tens of seconds per thread, in every read worker at once, each with its event loop stopped. A held pen connection
// waits for its next statement while the loop is stopped, which is what Postgres calls idle in transaction until it ends the session, and the quest board
// (which reads the engine on the same first call) and the household reads queued behind the stopped loops until the pen pool gave up (StoreAcquireTimeout).
//
// THE REGRESSION is the count of git processes a cold extraction forks, on an invented 300-file repo, through a `git` that counts its own launches: the
// fork count is the cost's cause and does not depend on this machine's speed. Red on `git show` per file (about 300), green on the batched read (a few).
// The second test is POS-963's: the registry read on a held client runs its three statements one at a time (pg queues a second query on a busy client and
// warns that pg 9 will not).
//
//   node --test test/pos-1057-cold-extraction.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "./helpers/temp-dir.mjs";

const tmp = tempDir("pos1057-");
const REAL_GIT = execFileSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).trim();

/** An invented repo: `n` small files under tools/ (some nested, one binary), one commit. Answers { repo, sha, files }. */
function inventedRepo(n) {
  const repo = join(tmp, `repo-${n}`);
  mkdirSync(join(repo, "tools", "deep", "er"), { recursive: true });
  const files = {};
  for (let i = 0; i < n; i++) {
    const rel = i % 7 === 0 ? `tools/deep/er/f${i}.mjs` : i % 3 === 0 ? `tools/deep/f${i}.mjs` : `tools/f${i}.mjs`;
    files[rel] = Buffer.from(`export const n = ${i}; // ${"x".repeat(i % 40)}\n`);
  }
  files["tools/blob.bin"] = Buffer.from([0, 255, 10, 13, 0, 1, 2, 10, 10, 200]);   // binary, with the bytes a line reader would mangle
  for (const [rel, bytes] of Object.entries(files)) writeFileSync(join(repo, rel), bytes);
  const git = (...a) => execFileSync(REAL_GIT, ["-C", repo, "-c", "user.name=fixture", "-c", "user.email=fixture@test.invalid", ...a], { encoding: "utf8" });
  git("init", "-q", "-b", "main");
  git("add", "-A");
  git("commit", "-qm", "invented tools");
  return { repo, sha: git("rev-parse", "HEAD").trim(), files };
}

/** A directory holding a `git` that appends a line to `log` for every launch and then runs the real one. */
function countingGit() {
  const bin = join(tmp, "bin"), log = join(tmp, "launches.log");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "git"), `#!/bin/sh\necho x >> "${log}"\nexec "${REAL_GIT}" "$@"\n`);
  chmodSync(join(bin, "git"), 0o755);
  writeFileSync(log, "");
  return { bin, launches: () => readFileSync(log, "utf8").split("\n").filter(Boolean).length, reset: () => writeFileSync(log, "") };
}

test("a cold engine extraction forks a handful of git processes, not one per file, and writes every byte as it was", async () => {
  const { repo, sha, files } = inventedRepo(300);
  const counter = countingGit();
  const was = process.env.PATH;
  process.env.PATH = `${counter.bin}:${was}`;
  try {
    const { materializeAtRef } = await import("../src/world-branches.mjs");
    counter.reset();
    const cache = join(tmp, "cache-cold");
    const dir = materializeAtRef(repo, sha, "tools", cache);
    const forks = counter.launches();
    assert.ok(forks <= 6, `${forks} git processes for a ${Object.keys(files).length}-file cold extraction (a git show per file was ~${Object.keys(files).length + 2}); each fork costs in proportion to the whole process`);
    for (const [rel, bytes] of Object.entries(files)) assert.ok(readFileSync(join(dir, rel)).equals(bytes), `${rel} is byte for byte what git holds`);
    assert.equal(readdirSync(join(dir, "tools")).length > 0, true);
    // warm: no git at all
    counter.reset();
    materializeAtRef(repo, sha, "tools", cache);
    assert.ok(counter.launches() <= 1, `a warm lookup forked ${counter.launches()} git processes (the one that peels the ref is the most it may ask)`);
  } finally { process.env.PATH = was; }
});

test("a path with a newline in it still extracts (the per-file route)", async () => {
  const repo = join(tmp, "repo-nl");
  mkdirSync(join(repo, "tools"), { recursive: true });
  writeFileSync(join(repo, "tools", "plain.mjs"), "export const a = 1;\n");
  writeFileSync(join(repo, "tools", "odd\nname.mjs"), "export const b = 2;\n");
  const git = (...a) => execFileSync(REAL_GIT, ["-C", repo, "-c", "user.name=fixture", "-c", "user.email=fixture@test.invalid", ...a], { encoding: "utf8" });
  git("init", "-q", "-b", "main"); git("add", "-A"); git("commit", "-qm", "odd");
  const { materializeAtRef } = await import("../src/world-branches.mjs");
  const dir = materializeAtRef(repo, git("rev-parse", "HEAD").trim(), "tools", join(tmp, "cache-nl"));
  assert.equal(readFileSync(join(dir, "tools", "odd\nname.mjs"), "utf8"), "export const b = 2;\n");
  assert.equal(readFileSync(join(dir, "tools", "plain.mjs"), "utf8"), "export const a = 1;\n");
});

test("POS-963: the registry read on a held client runs its three statements one at a time", async () => {
  const { registryRowsVia } = await import("../src/registry-store.mjs");
  let inFlight = 0, peak = 0;
  const q = { query: async () => { inFlight += 1; peak = Math.max(peak, inFlight); await new Promise((ok) => setImmediate(ok)); inFlight -= 1; return { rows: [] }; } };
  await registryRowsVia(q);
  assert.equal(peak, 1, `${peak} statements were in flight on one client at once (pg queues the second and warns that pg 9 will not)`);
});

test.after(() => { rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });
