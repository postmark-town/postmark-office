// sandbox-reset-guard.test.mjs — the dev sandbox's reset writes the sandbox and
// nothing else (review-606).
//
// deploy/sandbox-reset.sh reseeds the town index and rewrites the world graph
// snapshot in whatever PGDATABASE names, and dev and prod share one cluster
// (world2-lib.sh § w2_db falls back to world2_dev, PROD's store). So a PG* that
// names any other database is refused before the script stops a unit, resets a
// clone or writes a row. The script runs here whole, with `sudo`, `git` and
// `node` stubbed on PATH, so the refusal is the script's own and a run that got
// past it would be seen. The tree it resets is the dev office's, and the one
// seam that moves it (SANDBOX_RESET_TEST_DIR, this file's) cannot name prod's.

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = join(ROOT, "deploy", "sandbox-reset.sh");
const which = (n) => { const r = spawnSync("which", [n], { encoding: "utf8" }); return r.status === 0 ? r.stdout.trim() : null; };
const BASH = process.platform === "win32" ? null : which("bash");
const skip = process.platform === "win32" ? "the stubbed PATH needs a POSIX shell (CI runs it)" : !BASH ? "no bash on this machine" : false;

/** A PATH whose sudo, git and node only record that they were called. */
function stubs() {
  const bin = mkdtempSync(join(tmpdir(), "sandbox-reset-guard-"));
  const calls = join(bin, "calls.log");
  for (const name of ["sudo", "git", "node", "sleep", "systemctl"]) {
    writeFileSync(join(bin, name), `#!/bin/sh\necho "${name} $*" >> "${calls}"\n`);
    chmodSync(join(bin, name), 0o755);
  }
  return { bin, calls };
}

const run = (env) => {
  const { bin, calls } = stubs();
  const dir = mkdtempSync(join(tmpdir(), "sandbox-reset-dev-"));
  const r = spawnSync(BASH, [SCRIPT], { env: { PATH: `${bin}:/usr/bin:/bin`, SANDBOX_RESET_TEST_DIR: dir, ...env }, encoding: "utf8", timeout: 30_000 });
  return { ...r, called: existsSync(calls) ? readFileSync(calls, "utf8") : "" };
};

test("a PGDATABASE that is not the sandbox is refused before anything runs — prod's world2_dev among them", { skip }, () => {
  for (const db of ["world2_dev", "postgres", "w2_devsandbox_20260925x"]) {
    const r = run({ PGDATABASE: db, PGUSER: "law_ingester" });
    assert.equal(r.status, 9, `${db}: ${r.stderr}`);
    assert.match(r.stderr, new RegExp(`REFUSED: PGDATABASE is ${db}, not the dev sandbox`));
    assert.equal(r.called, "", `${db}: nothing was stopped, reset or written`);
  }
});

test("the sandbox's own PGDATABASE passes the guard and reaches the rebuild", { skip }, () => {
  const r = run({ PGDATABASE: "w2_devsandbox_20260925", PGUSER: "law_ingester" });
  assert.doesNotMatch(r.stderr, /REFUSED/);
  assert.match(r.called, /node world2\/tools\/town-index-ingest\.mjs .*--seed --reseed/, "the reseed ran, against the stubbed node");
  assert.match(r.called, /node src\/world-hydrate\.mjs .*--to-store/);
});

// The tree the script resets, cleans and deletes *.db in is steered only by a
// test-only name, and never at prod's tree: a stray value naming
// /srv/postmark-office, or anything below it however spelled (a trailing slash,
// a doubled slash, a `..`, a symlink), is refused with the sandbox's own
// PGDATABASE exported, so the tree guard is the only thing that can refuse it.
test("the test seam never reaches prod's tree, however it is spelled", { skip }, () => {
  const link = join(mkdtempSync(join(tmpdir(), "sandbox-reset-link-")), "looks-like-a-temp-dir");
  symlinkSync("/srv/postmark-office", link);
  for (const tree of ["/srv/postmark-office", "/srv/postmark-office/", "/srv//postmark-office", "//srv//postmark-office", "/srv/postmark-office/town-clone",
    "/srv/postmark-office-dev/../postmark-office", link]) {
    const r = run({ SANDBOX_RESET_TEST_DIR: tree, PGDATABASE: "w2_devsandbox_20260925", PGUSER: "law_ingester" });
    assert.equal(r.status, 9, `${tree}: ${r.stderr}`);
    assert.match(r.stderr, /REFUSED: .* is prod's office tree, not the dev sandbox/, tree);
    assert.equal(r.called, "", `${tree}: nothing was stopped, reset or written`);
  }
});

test("the old seam name steers nothing: the script reads only SANDBOX_RESET_TEST_DIR", () => {
  const text = readFileSync(SCRIPT, "utf8");
  assert.doesNotMatch(text, /\bSANDBOX_DIR\b/);
  assert.match(text, /D="\$\{SANDBOX_RESET_TEST_DIR:-\$DEV_TREE\}"/);
});

test("no PG* at all rebuilds nothing, and says so", { skip }, () => {
  const r = run({});
  assert.match(r.stderr, /TOWN INDEX AND WORLD GRAPH NOT REBUILT/);
  assert.doesNotMatch(r.called, /node /);
});

// POS-940 (POS-354 fix e, Darko 2026-10-10): run as root, the reset and clean left ~9,900 root-owned files in the
// dev clones and the next freshen failed with EACCES. Every git step on a clone runs as meepo, the clones' owner.
test("every git step on the clones runs as meepo, never as whoever ran the script (POS-940)", { skip }, () => {
  const r = run({ PGDATABASE: "w2_devsandbox_20260925", PGUSER: "law_ingester" });
  assert.equal(r.status, 0, r.stderr);
  const lines = r.called.split("\n").filter(Boolean);
  assert.deepEqual(lines.filter((l) => l.startsWith("git ")), [], "no git ran bare (as root, on the box)");
  for (const clone of ["town-clone", "world-clone"])
    for (const step of [/fetch origin --tags --force -q$/, /reset --hard refs\/tags\/sandbox\/seed -q$/, /clean -fd -q$/])
      assert.ok(lines.some((l) => l.startsWith(`sudo -u meepo git -C `) && l.includes(`/${clone} `) && step.test(l)), `${clone}: ${step} as meepo\n${r.called}`);
});

test("the retired world-hydrate step stays gone: no --db, and the store's snapshot is rebuilt --to-store (POS-940)", () => {
  // POS-354 fix e: the 10-10 reset failed on `world-hydrate --db` (world.db retired, POS-270); it was replaced by
  // the live --to-store rebuild in the w42 ship, which stays: nothing else writes dev's snapshot (dev-seed-advance.sh, step 7)
  const text = readFileSync(SCRIPT, "utf8");
  assert.doesNotMatch(text, /world-hydrate\.mjs[^\n]*--db\b/);
  assert.match(text, /node src\/world-hydrate\.mjs --world "\$D\/world-clone" --office "\$D" --to-store/);
});
