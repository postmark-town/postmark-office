// office-tick-split.test.mjs — the office tick, split in two (POS-268, 2026-09-27),
// and the rehydrate half retired (POS-268 part 5b, 2026-10-08).
//
// The rehydrate unit used to run everything the office does on a clock: pull
// the clones, catch the mint up, write the settlements row, publish the panes,
// AND rebuild office.db + world.db. The split moved the keeping work to its own
// unit; part 5b deleted the rehydrate. office.db is no longer built anywhere,
// and the world hydration, the one rehydrate step something still reads, runs
// in the keeping tick.
//
// ⚑ TEXT PINS, like welcome-pass.test.mjs and settlements-backfill.test.mjs:
// nothing in a unit test can run a systemd unit, and what these hold is which
// file carries which line.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const at = (f) => new URL(`../deploy/${f}`, import.meta.url);
const read = (f) => readFileSync(at(f), "utf8");
const calendarOf = (timer) => read(timer).split(/\r?\n/).filter((l) => l.startsWith("OnCalendar=")).map((l) => l.slice(11));
const execOf = (svc) => read(svc).split(/\r?\n/).find((l) => l.startsWith("ExecStart="));

const KEEPING = [
  ['git -C "$TOWN_CLONE" pull --ff-only', "the town pull"],
  ['git -C "$WORLD_CLONE" fetch --prune', "the world fetch (it carries the keeper's tag)"],
  // POS-341: both branches of the STAMP_LINES switch: the town's own --append unset, the store's runner set
  ["stamp-mint.mjs --append", "the mint catch-up (STAMP_LINES unset)"],
  ["stamp-mint-run.mjs --append", "the mint catch-up (STAMP_LINES=store, POS-341)"],
  ["[ \"${STAMP_LINES:-}\" = store ]", "the STAMP_LINES switch"],
  ["deploy/welcome-pass.mjs", "the welcome pass"],
  ["/srv/postmark-office/tools/bug-stage-plan.mjs", "the bug stage pass (Darko, 2026-10-07: payment rides the acceptance)"],
  ["--apply --quiet --key /srv/postmark-office/stamp-key.pem", "the bug stage pass's apply, quiet, with the box's stamp key"],
  ["settlements-backfill.mjs --apply", "the settlements row"],
  ["sh deploy/office-world-hydrate.sh", "the world hydration (moved off the rehydrate, POS-268 5b)"],
  ["deploy/publish-windows.mjs", "the panes"],
];
const RETIRED = [
  "postmark-office-rehydrate.service",
  "postmark-office-rehydrate.timer",
  "office-rehydrate.sh",
  "office-tick.sh",
];

test("the keeping tick carries every keeping step, the world hydration among them, and never builds office.db", () => {
  const sh = read("office-keep.sh");
  for (const [line, what] of KEEPING) assert.ok(sh.includes(line), `office-keep.sh lost ${what}`);
  assert.ok(!sh.includes("node src/hydrate.mjs"), "office-keep.sh rebuilds office.db, which nothing reads any more (POS-268 5b)");
  assert.ok(!read("office-world-hydrate.sh").includes("src/hydrate.mjs"), "the world hydration builds office.db too");
});

test("the world hydration runs after the settlements row and before the panes, and cannot stop the tick", () => {
  const sh = read("office-keep.sh");
  const settled = sh.indexOf("settlements-backfill.mjs --apply");
  const world = sh.indexOf("sh deploy/office-world-hydrate.sh");
  const panes = sh.indexOf("node deploy/publish-windows.mjs");
  assert.ok(settled < world, "the hydration ran after the settlements row before the move (two minutes after the keeping tick); it still does");
  assert.ok(world < panes, "the panes publish fails the tick loudly (set -e), so a step after it would be skipped whenever the panes fail");
  // its own line can never trip the tick's set -e: the script exits 0, and a tree missing it says so
  assert.match(sh, /sh deploy\/office-world-hydrate\.sh \\\n\s*\|\| echo "\[office-keep\] the world hydration step did not run \(non-fatal\)/);
  assert.match(read("office-world-hydrate.sh"), /\nexit 0\n$/, "every outcome is a journal line, never a failed tick");
});

test("the rehydrate unit, its timer and both of its scripts are gone from deploy/", () => {
  for (const f of RETIRED) assert.equal(existsSync(at(f)), false, `deploy/${f} is still in the repo; the rehydrate was retired (POS-268 5b)`);
});

test("the keep unit runs the keeping tick, as meepo, with the law pen's credential and the office's values winning", () => {
  assert.match(execOf("postmark-office-keep.service"), /deploy\/office-keep\.sh$/);
  const unit = read("postmark-office-keep.service");
  assert.match(unit, /^User=meepo$/m, "the User= line is load-bearing (the 2026-07-09 outage)");
  const files = unit.split(/\r?\n/).filter((l) => l.startsWith("EnvironmentFile=")).map((l) => l.slice(16));
  assert.deepEqual(files, ["/etc/postmark-world2-dev.env", "/etc/postmark-office.env"],
    "the world2 file for PG_LAW_INGESTER_PASSWORD, read FIRST, so a key both carry is the office's and no step the tick ran before sees a new value");
});

test("the keeping tick keeps the old clock", () => {
  assert.deepEqual(calendarOf("postmark-office-keep.timer"), ["*:07,22,37,52"],
    "the pulls, the mint, the settlements row and the panes keep the freshness they had");
});
