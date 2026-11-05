// STAR-130: the deploy's "GET /town answers" probe (deploy/remote-deploy.sh § 6, town_answers) waits out a cold start
// and still fails a door that never answers. On 2026-11-05 release/2026-w45.6 booted at 03:29:47Z and its first /town
// came back about 40 s later; the old single 10 s try failed a healthy office (run 41961880156).
//
// The function is lifted from the shipped script, not copied, and run in bash with a stand-in curl on PATH: it counts
// its calls in a file and fails the first N, the way a warming office times out its first tries.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRIPT = readFileSync(new URL("../deploy/remote-deploy.sh", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const fn = /^town_answers\(\) \{[\s\S]*?^\}$/m.exec(SCRIPT)?.[0];
const posix = (p) => p.replace(/\\/g, "/").replace(/^([A-Za-z]):/, (_, d) => `/${d.toLowerCase()}`);

function probe({ failFirst, window, per = 1 }) {
  const dir = mkdtempSync(join(tmpdir(), "town-probe-"));
  try {
    const curl = join(dir, "curl");
    writeFileSync(curl, `#!/usr/bin/env bash\nn=$(( $(cat "${posix(dir)}/calls" 2>/dev/null || echo 0) + 1 ))\necho "$n" > "${posix(dir)}/calls"\necho "$*" >> "${posix(dir)}/args"\n[ "$n" -gt ${failFirst} ]\n`);
    chmodSync(curl, 0o755);
    const r = spawnSync("bash", ["-c", `${fn}\nPATH="${posix(dir)}:$PATH" TOWN_PROBE_PAUSE=0.2 town_answers 8080 ${window} ${per}`], { encoding: "utf8" });
    const calls = Number(readFileSync(join(dir, "calls"), "utf8").trim());
    const args = readFileSync(join(dir, "args"), "utf8").trim().split("\n");
    return { ok: r.status === 0, calls, args };
  } finally {
    rmSync(dir, { recursive: true, force: true }); // this test's own fresh temp folder
  }
}

test("the probe is in the shipped script and the deploy calls it with 75 s of tries, 20 s each", () => {
  assert.ok(fn, "town_answers() is in deploy/remote-deploy.sh");
  assert.match(SCRIPT, /^town_answers "\$PORT" 75 20 \\$/m);
  assert.doesNotMatch(SCRIPT, /curl -fsS --max-time 10 "http:\/\/127\.0\.0\.1:\$PORT\/town"/, "the old single 10 s try is gone");
});

test("a cold start: the first tries time out, a later one answers, and the probe passes", () => {
  const r = probe({ failFirst: 3, window: 10 });
  assert.equal(r.ok, true);
  assert.equal(r.calls, 4);
  assert.match(r.args[0], /--max-time 1 http:\/\/127\.0\.0\.1:8080\/town$/);
});

test("a warm office answers on the first try", () => {
  const r = probe({ failFirst: 0, window: 10 });
  assert.deepEqual([r.ok, r.calls], [true, 1]);
});

test("a door that never answers still fails, once its window has passed", () => {
  const t0 = Date.now();
  const r = probe({ failFirst: 1e9, window: 1 });
  assert.equal(r.ok, false);
  assert.ok(r.calls >= 2, `it kept trying through the window (${r.calls} tries)`);
  assert.ok(Date.now() - t0 < 10_000, "and stopped soon after it");
});
