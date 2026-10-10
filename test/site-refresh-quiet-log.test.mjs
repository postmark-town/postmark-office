// site-refresh-quiet-log.test.mjs — POS-557: the box's site refresh stops
// writing every built page into syslog.
//
// THE INSTANCE. Astro prints one line per page it writes, about 5,300 a build,
// and the refresh's journal carried them all into syslog: some 900 MB a week.
// deploy/site-refresh.sh now pipes the build's stdout through quiet_build_log,
// which cuts those lines, counts them, and passes everything else.
//
// The shipped function is run verbatim, under bash, against Astro's own line
// shapes: coloured (a TTY build, copied from a real astro 6.4 build log) and
// plain (the journal's, where nothing is a TTY).
//
//   node --test test/site-refresh-quiet-log.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { tempDir } from "./helpers/temp-dir.mjs";

const SCRIPT = readFileSync(new URL("../deploy/site-refresh.sh", import.meta.url), "utf8");

function shippedFilter() {
  const m = SCRIPT.match(/^quiet_build_log\(\) \{\n[\s\S]*?\n\}\n/m);
  assert.ok(m, "deploy/site-refresh.sh no longer defines quiet_build_log() — the reader is wrong or the filter is gone");
  return m[0];
}

const ESC = "\u001b";
const BUILD_STDOUT = [
  "",
  "> postmark-site@0.0.1 build",
  "> astro build --config astro.config.town.mjs",
  "",
  `${ESC}[2m10:51:49${ESC}[22m ${ESC}[34m[build]${ESC}[39m output: ${ESC}[34m"static"${ESC}[39m`,
  `${ESC}[42m${ESC}[30m generating static routes ${ESC}[39m${ESC}[49m`,
  // the coloured page lines, verbatim from a real build
  `${ESC}[2m10:52:05${ESC}[22m   ${ESC}[34m├─${ESC}[39m ${ESC}[2m/atlas/index.html${ESC}[22m ${ESC}[2m(+37ms)${ESC}[22m`,
  `${ESC}[2m10:52:05${ESC}[22m   ${ESC}[34m├─${ESC}[39m ${ESC}[2m/bulletin/index.html${ESC}[22m ${ESC}[2m(+99ms)${ESC}[22m`,
  // the journal's plain page lines
  "13:10:01   ├─ /mail/the-first-letter/index.html (+3ms)",
  "13:10:01   └─ /mail/the-last-letter/index.html (+2ms)",
  // a tree glyph that is not at the head of a page line stays
  "[world-engine-island] staged 140 files ├─ not a page line",
  `${ESC}[2m10:52:48${ESC}[22m ${ESC}[34m[build]${ESC}[39m 3483 page(s) built in ${ESC}[1m58.56s${ESC}[22m`,
  `${ESC}[2m10:52:48${ESC}[22m ${ESC}[34m[build]${ESC}[39m ${ESC}[1mComplete!${ESC}[22m`,
].join("\n") + "\n";

function bashOr(t) {
  try { execFileSync("bash", ["-c", "exit 0"], { stdio: "ignore" }); return true; }
  catch {
    t.skip("bash is not on PATH here, so the shipped filter cannot be executed");
    return false;
  }
}

test("POS-557: the per-page lines are cut and counted; the summary, the timings and every other line pass", (t) => {
  if (!bashOr(t)) return;
  const dir = tempDir("quiet-log-");
  const probe = join(dir, "probe.sh");
  writeFileSync(probe, `set -Eeuo pipefail\n${shippedFilter()}quiet_build_log\n`);
  const out = execFileSync("bash", [probe], { input: BUILD_STDOUT, encoding: "utf8" });

  assert.doesNotMatch(out, /index\.html/, "a page line reached the log");
  assert.match(out, /3483 page\(s\) built in/, "the build's summary must pass");
  assert.match(out, /Complete!/);
  assert.match(out, /generating static routes/);
  assert.match(out, /> astro build/);
  assert.match(out, /not a page line/, "only a line that IS a page line is cut");
  assert.match(out, /\[site-refresh\] build: 4 per-page lines left out of the log \(POS-557\)/, "the cut is counted, so the log says what it left out");
  // nothing but the four page lines went
  assert.equal(out.split("\n").length, BUILD_STDOUT.split("\n").length - 4 + 1);
});

test("POS-557: a build with no page lines says nothing extra", (t) => {
  if (!bashOr(t)) return;
  const dir = tempDir("quiet-log-");
  const probe = join(dir, "probe.sh");
  writeFileSync(probe, `set -Eeuo pipefail\n${shippedFilter()}quiet_build_log\n`);
  const out = execFileSync("bash", [probe], { input: "a\nb\n", encoding: "utf8" });
  assert.equal(out, "a\nb\n");
});

test("POS-557: a failed build still fails the run — the pipe hands back the build's own exit code", (t) => {
  if (!bashOr(t)) return;
  const dir = tempDir("quiet-log-");
  const probe = join(dir, "probe.sh");
  writeFileSync(probe, `set -Eeuo pipefail\n${shippedFilter()}( printf '13:10:01   ├─ /x/index.html (+1ms)\\n'; exit 3 ) | quiet_build_log || { echo "died"; exit 9; }\necho survived\n`);
  const r = spawnSync("bash", [probe], { encoding: "utf8" });
  assert.equal(r.status, 9, `the run went on past a failed build: ${r.stdout}${r.stderr}`);
  assert.match(r.stdout, /died/);
});

test("POS-557: the build pipes ONLY its stdout through the filter — stderr, where Astro warns and errors, is never cut", () => {
  const line = SCRIPT.split("\n").findIndex((l) => /npm run build --silent \) \\$/.test(l));
  assert.ok(line > -1, "the build line moved; this test reads it");
  assert.doesNotMatch(SCRIPT.split("\n")[line], /2>&1/, "stderr was merged into the filtered stream");
  assert.match(SCRIPT.split("\n")[line + 1], /^\s*\| quiet_build_log \|\| die "the site build tripped"$/);
});
