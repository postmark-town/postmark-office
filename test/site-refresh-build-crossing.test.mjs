// site-refresh-build-crossing.test.mjs — the box's site refresh hands the
// crossing to the BUILD, not only to the stamp.
//
// THE INSTANCE. Pages that key what they show to the crossing (the season's line
// under the home page's ferry clock) read BUILD_CROSSING at build time. The
// refresh asked the office for the crossing once and passed it to the extract
// and to build-stamp.mjs, but ran `npm run build` without it, so on prod those
// pages rendered as if no crossing were known.
//
// ONE ENV, TWO INVOCATIONS (POS-1191). build_once() sets the build's environment
// once, in the build_env array, and runs either the release's
// tools/incremental-build.mjs (which runs the Astro build itself) or, for a
// release without it, `npm run build`. Both take the same array, and the
// incremental build keys its season on that same BUILD_CROSSING.
//
// The shipped lines are run verbatim, under bash, with `node` and `npm` shimmed
// onto PATH to record what they were handed. deploy/site-refresh-selftest.sh
// holds the same fact end to end on a POSIX box (flock); this file runs anywhere.
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
// the build's env: one array, set once
function buildEnvLine() {
  const line = buildOnce().split("\n").find((l) => /^\s*local build_env=\(/.test(l));
  assert.ok(line, "build_once() no longer sets the build's env in one build_env array");
  return line.trim().replace(/^local /, "");
}
// an invocation: the subshell that runs the incremental tool, or `npm run build`, up to its closing paren
function invocation(which) {
  const re = which === "incremental" ? /node tools\/incremental-build\.mjs/ : /npm run build/;
  const line = buildOnce().split("\n").find((l) => re.test(l) && /^\s*\(/.test(l));
  assert.ok(line, `build_once() no longer runs ${which === "incremental" ? "tools/incremental-build.mjs" : "npm run build"} in a subshell`);
  return line.trim().replace(/\)\s*\\$/, ")");
}

test("the crossing is asked once, before the build, and both builds are handed it", () => {
  const body = buildOnce();
  const asked = body.indexOf('crossing="$(crossing_now)"');
  const built = Math.min(body.indexOf("tools/incremental-build.mjs"), body.indexOf("npm run build"));
  assert.ok(asked > 0 && asked < built, "the crossing is asked before the build runs");
  assert.equal(body.split('crossing="$(crossing_now)"').length - 1, 1, "and asked once: extract, build and stamp share one number");
  assert.match(buildEnvLine(), /"BUILD_CROSSING=\$crossing"/, "the build's env carries BUILD_CROSSING");
  for (const w of ["incremental", "full"]) assert.match(invocation(w), /env "\$\{build_env\[@\]\}"/, `the ${w} build runs under that env`);
});

function runBuildLine(crossing, which) {
  const dir = tempDir("site-refresh-build-crossing-");
  const bin = join(dir, "bin"), build = join(dir, "build");
  mkdirSync(bin); mkdirSync(build);
  // node and npm, shimmed: record whether BUILD_CROSSING was set, and to what
  for (const tool of ["node", "npm"]) {
    writeFileSync(join(bin, tool), '#!/usr/bin/env bash\necho "set=${BUILD_CROSSING+yes} value=${BUILD_CROSSING-}" > "$PWD/build-env.txt"\n');
    chmodSync(join(bin, tool), 0o755);
  }
  const script = [
    "set -e",
    `BUILD=${JSON.stringify(build.replace(/\\/g, "/"))}`,
    `crossing=${JSON.stringify(crossing)}`,
    "git() { echo 0000000; }",   // the env asks git for the build sha; a stand-in answers
    "incr_args=()",
    buildEnvLine(),
    invocation(which),
  ].join("\n");
  const r = spawnSync("bash", ["-c", script], { encoding: "utf8", env: { ...process.env, PATH: `${bin.replace(/\\/g, "/")}:${process.env.PATH}` } });
  assert.equal(r.status, 0, r.stderr);
  return readFileSync(join(build, "build-env.txt"), "utf8").trim();
}

for (const which of ["incremental", "full"]) {
  test(`run verbatim (${which}): a known crossing reaches the build`, () => {
    assert.equal(runBuildLine("244", which), "set=yes value=244");
  });
  test(`run verbatim (${which}): an office that did not answer reaches the build as the honest empty, never a guess`, () => {
    assert.equal(runBuildLine("", which), "set=yes value=");
  });
}
