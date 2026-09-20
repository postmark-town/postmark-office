// traffic-snapshot.mjs — the operator round's step 6, mechanized (2026-07-28).
//
// Captures the trailing-14-day GitHub traffic window for the town's repos into
// telemetry/github/<repo>-<yyyy-MM-dd>.json (shape: first snapshots, 2026-07-11),
// commits + pushes the office repo, and ships the day's files to the box for the
// dashboard generator. The window evaporates, so daily capture is the whole game.
//
// Usage:  node tools/traffic-snapshot.mjs [--force]
//   --force  re-fetch today's files even if they already exist (overwrite with fresher data)
//
// Exit codes: 0 = captured + shipped · 1 = capture/validation failure (a finding —
// fix, don't skip) · 2 = captured + committed but the box ship failed (say so in
// the round; the box-side dashboard will run stale until shipped).

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// the town moved to its own org 2026-08-03 (postmark-town/postmark); the rest
// remain keeminlee's. Snapshot filenames stay on the bare repo name so the
// telemetry series is unbroken across the transfer.
const REPOS = [
  { owner: "postmark-town", name: "postmark" },
  { owner: "keeminlee", name: "starforge-atelier" },
  { owner: "keeminlee", name: "postmark-site" },
  { owner: "keeminlee", name: "postmark-world" },
];
const HERE = dirname(fileURLToPath(import.meta.url));
const OFFICE = resolve(HERE, "..");
const OUT_DIR = join(OFFICE, "telemetry", "github");
const BOX = "meepo-ec2";
const BOX_DIR = "/var/lib/postmark-traffic/github";
const FORCE = process.argv.includes("--force");

const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { encoding: "utf8", ...opts });

// Local-offset ISO stamp, matching the hand-captured shape (2026-07-28T08:41:22-04:00).
function localIso() {
  const d = new Date();
  const off = -d.getTimezoneOffset();
  const p = (n, w = 2) => String(Math.abs(n)).padStart(w, "0");
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` +
    `T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}` +
    `${off < 0 ? "-" : "+"}${p(Math.trunc(off / 60))}:${p(off % 60)}`
  );
}

const date = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
const wrote = [];
let failures = 0;

for (const { owner, name: repo } of REPOS) {
  const out = join(OUT_DIR, `${repo}-${date}.json`);
  if (existsSync(out) && !FORCE) {
    console.log(`= ${repo}: already captured (${repo}-${date}.json)`);
    continue;
  }
  try {
    const api = (p) => JSON.parse(run("gh", ["api", `repos/${owner}/${repo}/traffic/${p}`]));
    const snap = {
      repo: `${owner}/${repo}`,
      captured_at: localIso(),
      views: api("views"),
      clones: api("clones"),
      popular_paths: api("popular/paths"),
      popular_referrers: api("popular/referrers"),
    };
    // the probe that can fail: every part present and window-shaped
    if (!Array.isArray(snap.views.views) || !Array.isArray(snap.clones.clones) ||
        !Array.isArray(snap.popular_paths) || !Array.isArray(snap.popular_referrers))
      throw new Error("response missing an expected part");
    writeFileSync(out, JSON.stringify(snap, null, 2) + "\n");
    JSON.parse(readFileSync(out, "utf8")); // the written file itself parses
    wrote.push(out);
    console.log(`+ ${repo}: views ${snap.views.count}/${snap.views.uniques}u · clones ${snap.clones.count}/${snap.clones.uniques}u`);
  } catch (e) {
    failures++;
    console.error(`! ${repo}: capture FAILED — ${String(e.message ?? e).slice(0, 200)}`);
  }
}

if (failures) {
  console.error(`\n${failures} repo(s) failed to capture — a finding, not a skip.`);
  process.exit(1);
}

if (wrote.length) {
  // The office clone must be on main, or the telemetry commits onto whatever
  // branch a hotfix left checked out and the dashboard reads stale while the
  // run says exit 0 (2026-08-30/31: two days of snapshots landed on
  // hotfix-w35-7, one of them with no upstream to push to). A capture that
  // cannot be committed where it is read is a failed capture — exit 1.
  const branch = run("git", ["-C", OFFICE, "rev-parse", "--abbrev-ref", "HEAD"]).trim();
  if (branch !== "main" && !process.env.TRAFFIC_ALLOW_BRANCH) {
    console.error(`! office clone is on '${branch}', not main — refusing to commit telemetry off-main (checkout main, or set TRAFFIC_ALLOW_BRANCH=1 knowingly). Files written: ${wrote.length}.`);
    process.exit(1);
  }
  // office#83's sibling, office#84 (2026-09-17): main moves under this clone
  // between rounds (hotfix merges), and a refused non-fast-forward push read
  // as a green run — two days of telemetry sat committed and unpushed while
  // the round's tail said exit 0. Rebase onto origin/main BEFORE staging (the
  // telemetry files never conflict: one new file per repo per day; a rebase
  // refuses with staged changes, so it goes first), and after the push ASSERT
  // the remote moved: committed-but-not-pushed is its own exit (3), never 0,
  // and the box ship below still runs because the files are on disk.
  run("git", ["-C", OFFICE, "pull", "--rebase", "--quiet", "origin", "main"]);
  run("git", ["-C", OFFICE, "add", "telemetry/github"]);
  const staged = run("git", ["-C", OFFICE, "diff", "--cached", "--name-only"]).trim();
  if (staged) {
    run("git", ["-C", OFFICE, "commit", "-m", `telemetry: github traffic ${date}`]);
    let refusal = null;
    try { run("git", ["-C", OFFICE, "push"], { stdio: ["ignore", "pipe", "pipe"] }); }
    catch (e) { refusal = String(e?.stderr ?? e?.message ?? e).trim().split("\n").filter(Boolean).slice(-1)[0] ?? "push failed"; }
    const head = run("git", ["-C", OFFICE, "rev-parse", "HEAD"]).trim();
    const remote = run("git", ["-C", OFFICE, "rev-parse", "origin/main"]).trim();
    if (refusal || head !== remote) {
      console.error(`! office repo: committed but NOT pushed — HEAD ${head.slice(0, 9)}, origin/main ${remote.slice(0, 9)}${refusal ? ` (${refusal})` : ""}. Rebase and push by hand; the snapshots are on disk and ship to the box below. (office#84)`);
      process.exitCode = 3;
    } else {
      console.log(`office repo: committed + pushed (${staged.split("\n").length} file(s)) — origin/main ${remote.slice(0, 9)}`);
    }
  } else {
    console.log("office repo: nothing new to commit");
  }
} else {
  console.log("office repo: nothing fetched, nothing to commit");
}

// Ship today's files to the box (idempotent; mv overwrites). Failure here is exit 2:
// the capture is safe in git, but the box dashboard reads stale until shipped.
try {
  const todays = REPOS.map((r) => join(OUT_DIR, `${r.name}-${date}.json`)).filter(existsSync);
  if (!todays.length) throw new Error("no files for today on disk");
  run("scp", [...todays, `${BOX}:/tmp/`]);
  run("ssh", [BOX, `sudo mv /tmp/*-${date}.json ${BOX_DIR}/`]);
  console.log(`box: shipped ${todays.length} file(s) to ${BOX}:${BOX_DIR}`);
} catch (e) {
  console.error(`! box ship FAILED — ${String(e.message ?? e).slice(0, 200)}`);
  process.exit(2);
}
