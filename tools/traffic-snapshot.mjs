// traffic-snapshot.mjs — the operator round's step 6, mechanized (2026-07-28).
//
// Captures the trailing-14-day GitHub traffic window for the town's repos into
// github/<repo>-<yyyy-MM-dd>.json (shape: first snapshots, 2026-07-11) in a local
// clone of postmark-town/postmark-telemetry, commits + pushes that repo, and ships
// the day's files to the box for the dashboard generator. The window evaporates,
// so daily capture is the whole game.
//
// The snapshots left the office repo on 2026-10-07 (POS-428, Darko's option b):
// a daily data commit on office main put main ahead of the week's train every
// morning, against "the train contains main" (postmark-blueprints SHIPPING.md § 6
// and the ship-guard check). Data is not code and does not ride a code train. The
// tool never falls back to the office repo: no telemetry clone is a refusal.
//
// Usage:  node tools/traffic-snapshot.mjs [--force]
//   --force  re-fetch today's files even if they already exist (overwrite with fresher data)
//   TELEMETRY_REPO  the telemetry clone (default G:/Postmark/repo-clones/wright/telemetry)
//
// Exit codes: 0 = captured + shipped · 1 = capture/validation failure, or no
// usable telemetry clone (a finding — fix, don't skip) · 2 = captured + committed
// but the box ship failed (say so in the round; the box-side dashboard will run
// stale until shipped) · 3 = committed but not pushed (the box ship still runs).

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// the town moved to its own org 2026-08-03 (postmark-town/postmark); the site and
// the world followed 2026-09-18 (POS-115); starforge-atelier stays keeminlee's. Snapshot filenames stay on the bare repo name so the
// telemetry series is unbroken across the transfer.
const REPOS = [
  { owner: "postmark-town", name: "postmark" },
  { owner: "keeminlee", name: "starforge-atelier" },
  { owner: "postmark-town", name: "postmark-site" },
  { owner: "postmark-town", name: "postmark-world" },
];
export const TELEMETRY_REMOTE = "postmark-town/postmark-telemetry";
export const DEFAULT_TELEMETRY_REPO = "G:/Postmark/repo-clones/wright/telemetry";
const BOX = "meepo-ec2";
const BOX_DIR = "/var/lib/postmark-traffic/github";

const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { encoding: "utf8", ...opts });
const quiet = { stdio: ["ignore", "pipe", "pipe"] };
const samePath = (a, b) => resolve(a).replace(/\\/g, "/").toLowerCase() === resolve(b).replace(/\\/g, "/").toLowerCase();

// The clone the snapshots commit to: { ok: true, dir } or { ok: false, refusal }.
// It must be the root of its own work tree (a folder inside the office clone
// would commit to the office), its origin must be postmark-telemetry, and it must
// be on main — 2026-08-30/31: two days of snapshots landed on a hotfix branch the
// office clone was left on, one with no upstream, while the run said exit 0.
export function telemetryClone(env = process.env) {
  const dir = resolve(env.TELEMETRY_REPO || DEFAULT_TELEMETRY_REPO);
  const create = `Create it: gh repo clone ${TELEMETRY_REMOTE} "${dir.replace(/\\/g, "/")}" (or set TELEMETRY_REPO to an existing clone).`;
  const refuse = (why) => ({ ok: false, refusal: `! telemetry clone refused: ${why} The snapshots commit only to ${TELEMETRY_REMOTE}, never to the office repo (POS-428). Nothing captured.` });
  if (!existsSync(dir)) return refuse(`no clone at ${dir}. ${create}`);
  let top;
  try { top = run("git", ["-C", dir, "rev-parse", "--show-toplevel"], quiet).trim(); }
  catch { return refuse(`${dir} is not a git clone. ${create}`); }
  if (!samePath(top, dir)) return refuse(`${dir} sits inside another repo (${top}), not a clone of its own. ${create}`);
  let origin = "";
  try { origin = run("git", ["-C", dir, "remote", "get-url", "origin"], quiet).trim(); } catch {}
  if (!/(^|[/:])postmark-town\/postmark-telemetry(\.git)?\/?$/.test(origin.replace(/\\/g, "/")))
    return refuse(`${dir}'s origin is '${origin || "(none)"}', not ${TELEMETRY_REMOTE}. ${create}`);
  let branch = "";
  try { branch = run("git", ["-C", dir, "symbolic-ref", "--short", "HEAD"], quiet).trim(); } catch {}
  if (branch !== "main" && !env.TRAFFIC_ALLOW_BRANCH)
    return refuse(`${dir} is on '${branch || "a detached HEAD"}', not main (checkout main, or set TRAFFIC_ALLOW_BRANCH=1 knowingly).`);
  return { ok: true, dir };
}

// Commit github/ and push to origin/main: { code: 0 | 3, line }.
// office#83's sibling, office#84 (2026-09-17): the remote moves under this clone
// between rounds, and a refused non-fast-forward push read as a green run — two
// days of telemetry sat committed and unpushed while the round's tail said exit 0.
// Rebase onto origin/main BEFORE staging (the files never conflict: one new file
// per repo per day; a rebase refuses with staged changes, so it goes first), and
// after the push ASSERT the remote moved: committed-but-not-pushed is its own exit
// (3), never 0. A freshly created, empty repo has no main to rebase onto yet; the
// first push makes it.
export function commitSnapshots(dir, date) {
  const git = (...args) => run("git", ["-C", dir, ...args], quiet);
  if (git("ls-remote", "--heads", "origin", "main").trim()) git("pull", "--rebase", "--quiet", "origin", "main");
  git("add", "github");
  const staged = git("diff", "--cached", "--name-only").trim();
  if (!staged) return { code: 0, line: "telemetry repo: nothing new to commit" };
  git("commit", "-m", `telemetry: github traffic ${date}`);
  let refusal = null;
  try { git("push", "-u", "origin", "main"); }
  catch (e) { refusal = String(e?.stderr ?? e?.message ?? e).trim().split("\n").filter(Boolean).slice(-1)[0] ?? "push failed"; }
  const head = git("rev-parse", "HEAD").trim();
  let remote = "";
  try { remote = git("rev-parse", "origin/main").trim(); } catch {}
  if (refusal || head !== remote)
    return { code: 3, line: `! telemetry repo: committed but NOT pushed — HEAD ${head.slice(0, 9)}, origin/main ${remote.slice(0, 9) || "(none)"}${refusal ? ` (${refusal})` : ""}. Rebase and push by hand; the snapshots are on disk and ship to the box below. (office#84)` };
  return { code: 0, line: `telemetry repo: committed + pushed (${staged.split("\n").length} file(s)) — origin/main ${remote.slice(0, 9)}` };
}

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

function main() {
  const FORCE = process.argv.includes("--force");
  const clone = telemetryClone();
  if (!clone.ok) {
    console.error(clone.refusal);
    process.exit(1);
  }
  const OUT_DIR = join(clone.dir, "github");
  mkdirSync(OUT_DIR, { recursive: true });

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
    const { code, line } = commitSnapshots(clone.dir, date);
    (code ? console.error : console.log)(line);
    if (code) process.exitCode = code;
  } else {
    console.log("telemetry repo: nothing fetched, nothing to commit");
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
}

// The junction lesson (usdc-watch.mjs's entry guard): compare real paths, so the
// tool still runs when reached through a Windows junction, and importing it runs nothing.
const isMain = (() => {
  if (!process.argv[1]) return false;
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return pathToFileURL(process.argv[1]).href === import.meta.url; }
})();
if (isMain) main();
