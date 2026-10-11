// site-refresh-build-crossing.test.mjs — the box's site refresh hands the
// crossing to the BUILD, not only to the stamp.
//
// THE INSTANCE. Pages that key what they show to the crossing (the season's line
// under the home page's ferry clock) read BUILD_CROSSING at build time. The
// refresh asked the office for the crossing once and passed it to the extract
// and to build-stamp.mjs, but ran `npm run build` without it, so on prod those
// pages rendered as if no crossing were known.
//
// The shipped build line is run verbatim, under bash, with `npm` shimmed onto
// PATH to record what it was handed. deploy/site-refresh-selftest.sh holds the
// same fact end to end on a POSIX box (flock); this file runs anywhere.
//
//   node --test test/site-refresh-build-crossing.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { join } from "node:path";

import { tempDir } from "./helpers/temp-dir.mjs";

const SCRIPT = readFileSync(new URL("../deploy/site-refresh.sh", import.meta.url), "utf8").replace(/\r\n/g, "\n");

function buildOnce() {
  const m = SCRIPT.match(/^build_once\(\) \{\n[\s\S]*?\n\}\n/m);
  assert.ok(m, "deploy/site-refresh.sh no longer defines build_once()");
  return m[0];
}
// the build step: the subshell that runs `npm run build`, up to its closing paren
function buildLine() {
  const line = buildOnce().split("\n").find((l) => /npm run build/.test(l) && /^\s*\(/.test(l));
  assert.ok(line, "build_once() no longer runs `npm run build` in a subshell");
  return line.trim().replace(/\)\s*\\$/, ")");
}

test("the crossing is asked once, before the build, and the build is handed it", () => {
  const body = buildOnce();
  const asked = body.indexOf('crossing="$(crossing_now)"');
  const built = body.indexOf("npm run build");
  assert.ok(asked > 0 && asked < built, "the crossing is asked before the build runs");
  assert.equal(body.split('crossing="$(crossing_now)"').length - 1, 1, "and asked once: extract, build and stamp share one number");
  assert.match(buildLine(), /BUILD_CROSSING="\$crossing" npm run build/, "the build line passes BUILD_CROSSING");
});

function runBuildLine(crossing) {
  const dir = tempDir("site-refresh-build-crossing-");
  const bin = join(dir, "bin"), build = join(dir, "build");
  mkdirSync(bin); mkdirSync(build);
  // npm, shimmed: record whether BUILD_CROSSING was set, and to what
  writeFileSync(join(bin, "npm"), '#!/usr/bin/env bash\necho "set=${BUILD_CROSSING+yes} value=${BUILD_CROSSING-}" > "$PWD/npm-env.txt"\n');
  chmodSync(join(bin, "npm"), 0o755);
  const script = [
    "set -e",
    `BUILD=${JSON.stringify(build.replace(/\\/g, "/"))}`,
    `crossing=${JSON.stringify(crossing)}`,
    'git() { echo 0000000; }',   // the line asks git for the build sha; a stand-in answers
    buildLine(),
  ].join("\n");
  const r = spawnSync("bash", ["-c", script], { encoding: "utf8", env: { ...process.env, PATH: `${bin.replace(/\\/g, "/")}:${process.env.PATH}` } });
  assert.equal(r.status, 0, r.stderr);
  return readFileSync(join(build, "npm-env.txt"), "utf8").trim();
}

test("run verbatim: a known crossing reaches npm run build", () => {
  assert.equal(runBuildLine("244"), "set=yes value=244");
});

test("run verbatim: an office that did not answer reaches the build as the honest empty, never a guess", () => {
  assert.equal(runBuildLine(""), "set=yes value=");
});
