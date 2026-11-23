// settlement-late-clear.test.mjs — a clearing 12 h late, through the commit and the backfill (POS-940; POS-354 fix c).
//
// Darko, 2026-10-10: "a clearing 12 h or more late makes settlements-backfill
// name the successor window with a NULL snapshot, permanently (insert-only).
// Cheap guard: refuse a row whose window isn't closed. Durable fix:
// settlement-auto.sh writes a `Window: <id>` trailer, and the backfill prefers it."
//
// One bounded synthetic crossing, on a real store and a real world repo. Window
// 211 closes 2026-10-09 17:45:40Z and is cleared thirteen hours late, at
// 2026-10-10 06:50Z; its successor 212 closed by the clock at 05:45:40Z and is
// still OPEN (nothing has cleared it). The crossing that folded 211 publishes at
// 06:52Z. By time alone (`windowFor`) that crossing closed 212 — the defect.
//   · Without a trailer (the script as it was), the backfill's real tick
//     (`--apply --prod --quiet`, office-keep.sh's step) writes NOTHING and
//     says why: 212 is open.
//   · With settlement-auto.sh's own `name_window` run on the published commit
//     (the function itself, read out of the script, with DOCKET_WINDOW=211),
//     the commit says `Window: 211`, the tag blesses it, and the same tick
//     writes S90 at window 211 with 211's snapshot.
//
// ── THE FLIPS, run 2026-11-18 on this branch, each restored by hand and
//    `git diff --exit-code` clean afterwards ──────────────────────────────────
//   1 · the preference. In settlements-backfill.mjs § planFrom, take the window
//       by time alone (drop `d.stated_window ??`) → THE TRAILER NAMES IT goes
//       red: S90 is HELD at 212, nothing written.
//   2 · the guard. Make `heldWindow` return null → THE DEFECT, HELD goes red:
//       the tick exits 0 and writes S90 at window 212 with a NULL snapshot,
//       which is the 10-10 failure exactly.
//
// Run: node --test test/settlement-late-clear.test.mjs

import { after, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tempDir } from "./helpers/temp-dir.mjs";
import { startStore } from "./helpers/embedded-store.mjs";

import { printoutMessage } from "../world2/tools/settlement-printout.mjs"; // POS-1025: the printout commit says its window itself
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const store = await startStore({ db: "settlement_late_clear_test" });
after(async () => { await store.stop(); });
const skip = store.skip ?? false;

const DIGEST = "e".repeat(64);
async function owner(fn) { const c = await store.connect("world2_owner"); try { return await fn(c); } finally { await c.end(); } }

/** 210 cleared on time; 211 cleared 13 h late; 212 past its close and still open. Returns 211's snapshot id. */
async function seed() {
  return owner(async (c) => {
    await c.query("TRUNCATE settlements, world_snapshots, windows CASCADE");
    await c.query(`INSERT INTO windows (id, opens_at, closes_at, status, cleared_at) VALUES
      (210, '2026-10-08T17:45:40Z', '2026-10-09T05:45:40Z', 'closed', '2026-10-09T05:45:52Z'),
      (211, '2026-10-09T05:45:40Z', '2026-10-09T17:45:40Z', 'closed', '2026-10-10T06:50:00Z'),
      (212, '2026-10-09T17:45:40Z', '2026-10-10T05:45:40Z', 'open', NULL)`);
    return (await c.query("INSERT INTO world_snapshots (window_id, digest, marks_digest, marks) VALUES (211, $1, $1, 0) RETURNING id", [DIGEST])).rows[0].id;
  });
}
const rows = () => owner(async (c) => (await c.query("SELECT number, window_id, snapshot_id FROM settlements ORDER BY number")).rows);

/**
 * A world whose crossing folded window 211 and published its PRINTOUT at 06:52Z, tagged settlement/S90. With `trailer` the commit's message is
 * the printout's own (settlement-printout.mjs § printoutMessage, which ends in `Window: 211`); without it, the same message less its trailer
 * (a commit that names no window: what the retired sweep's commit was before name_window, and what a backfill must still hold rather than guess).
 */
function worldRepo({ trailer }) {
  const repo = tempDir("pos940-world-");
  const git = (args, env = {}) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ...env } });
  git(["init", "-q", "-b", "main"]);
  writeFileSync(join(repo, "README"), "a fixture world\n");
  git(["add", "-A"]);
  git(["-c", "user.name=fixture", "-c", "user.email=fixture@test.invalid", "commit", "-q", "-m", "crossing-save 210"], { GIT_COMMITTER_DATE: "2026-10-09T06:00:00Z", GIT_AUTHOR_DATE: "2026-10-09T06:00:00Z" });
  const from = git(["rev-parse", "main"]).trim();
  writeFileSync(join(repo, "swept"), "211\n");
  git(["add", "-A"]);
  const full = printoutMessage({ settlement: 90, window: 211, snapshotId: 1, digest: DIGEST, townSha: null, written: 1, removed: 0, reframed: 0, from: { sealed_settlement: 89, window_id: 210 }, quiet: false });
  const message = trailer ? full : full.replace(/\n\nWindow: 211$/, "");
  git(["-c", "user.name=Postmark Pen", "-c", "user.email=pen@test.invalid", "commit", "-q", "-m", message],
    { GIT_COMMITTER_DATE: "2026-10-10T06:52:00Z", GIT_AUTHOR_DATE: "2026-10-10T06:52:00Z" });
  git(["-c", "user.name=keeper", "-c", "user.email=keeper@test.invalid", "tag", "-a", "settlement/S90", "-m", "S90"], { GIT_COMMITTER_DATE: "2026-10-10T07:10:00Z" });
  return { repo, message: git(["log", "-1", "--format=%B", "main"]), committed: git(["log", "-1", "--format=%cI", "main"]).trim() };
}
const tick = (repo) => {
  const r = spawnSync(process.execPath, [join(ROOT, "world2", "tools", "settlements-backfill.mjs"), "--apply", "--prod", "--quiet", "--world-repo", repo, "--pg-url", store.url("office_api")],
    { cwd: ROOT, encoding: "utf8", env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot } });
  return { code: r.status, out: `${r.stdout}\n${r.stderr}` };
};

test("THE DEFECT, HELD: a crossing that folded 211 thirteen hours late and says no window is NOT written — the time rule names 212, which is open", { skip }, async () => {
  await seed();
  const w = worldRepo({ trailer: false });
  assert.doesNotMatch(w.message, /^Window:/m, "a commit that names no window");
  const r = tick(w.repo);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /HELD: 1 settlement row\(s\) not written — S90 \(window 212 is open, not closed\)/, r.out);
  assert.match(r.out, /wrote 0 row\(s\)/, r.out);
  assert.deepEqual(await rows(), [], "nothing inserted: no row names the successor with a NULL snapshot");
});

test("THE TRAILER NAMES IT: the printout's own message ends in Window: 211 on the published commit, keeping its date, and the tick writes S90 at 211 with 211's snapshot", { skip }, async () => {
  const snapshot = await seed();
  const w = worldRepo({ trailer: true });
  assert.match(w.message, /\n\nWindow: 211\s*$/,`the published commit's message ends in the trailer:\n${w.message}`);
  assert.equal(new Date(w.committed).toISOString(), "2026-10-10T06:52:00.000Z", "the committer date (the row's published_at) is the printout's own");
  const r = tick(w.repo);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /wrote 1 row\(s\) — S90/, r.out);
  assert.deepEqual(await rows(), [{ number: 90, window_id: 211, snapshot_id: snapshot }]);
  // the next tick finds it present and writes nothing: the guard never touches a row that stands
  const again = tick(w.repo);
  assert.equal(again.code, 0, again.out);
  assert.match(again.out, /wrote 0 row\(s\)/, again.out);
});
