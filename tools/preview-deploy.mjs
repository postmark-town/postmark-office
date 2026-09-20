#!/usr/bin/env node
// preview-deploy.mjs — branch preview deploys for postmark.town.
//
// Builds the town site from a given branch and ships it to the box, served
// (noindexed) at https://postmark.town/preview/<slug>/ — real, shareable URLs
// for reveal-bundle QA (atlas v2, later "the world") instead of localhost.
//
//   node tools/preview-deploy.mjs <branch> [options]
//
// Options:
//   --site <path>      town site clone   (default: G:/Postmark/repo-clones/wright/site — keeminlee/postmark-site since the P3 flip 2026-07-27)
//   --worktree <path>  throwaway build dir (default: G:/pmprev-wt) — SHORT on purpose
//   --host <ssh>       box ssh alias     (default: meepo-ec2)
//   --webroot <path>   box preview root  (default: /var/www/postmark-preview)
//   --keep-worktree    leave the worktree in place (debugging)
//
// How it works
//   1. Sanitize <branch> → <slug> (path/URL-safe). The real branch name drives
//      git; the slug drives the deploy dir + the /preview/<slug>/ URL + the
//      asset prefix. They must agree — that's the whole point of one slug.
//   2. Build from a DETACHED git worktree at origin/<branch> (or the local
//      branch if unpushed), so the main checkout is never touched. The worktree
//      lives at a SHORT path because the town has media filenames long enough to
//      blow past Windows MAX_PATH (260) under a deep dir; -c core.longpaths=true
//      is also set. node_modules is shared into the worktree via a junction
//      (no reinstall).
//   3. Build with PREVIEW_BASE=/preview/<slug>/ — the town config reads it as
//      build.assetsPrefix (NOT Astro `base`; base breaks the town's static
//      build on 6.4.0 — see astro.config.town.mjs for the why). Two guards:
//      FAIL LOUD if the branch's astro.config.town.mjs doesn't read
//      PREVIEW_BASE (a silent unprefixed build would LOOK deployed but 404 its
//      assets), and assert after the build that _astro actually got prefixed.
//   4. Ship dist to the box: tar → scp → sudo stage-and-swap into
//      <webroot>/<slug>/ (the office.db.new idiom — build <slug>.new complete,
//      then swap; a failed transfer never leaves a half-written live dir).
//
// nginx serves <webroot>/ at /preview/ with X-Robots-Tag noindex,nofollow
// (deploy/nginx-postmark-town.conf). This tool only writes the files.
//
// CLEANUP — stale previews are removed BY HAND (no auto-GC yet; add one only
// when the manual step actually hurts):
//   ssh meepo-ec2 sudo rm -rf /var/www/postmark-preview/<slug>
//
// Provenance: 2026-07-20, the preview-deploy target (Keemin via Wright → Jetto).

import { execFileSync, execSync } from "node:child_process";
import { existsSync, readFileSync, rmdirSync, symlinkSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ── args ─────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : argv[i + 1];
};
const flag = (name) => argv.includes(`--${name}`);

const branch = argv.find((a) => !a.startsWith("--") && argv[argv.indexOf(a) - 1] !== "--site"
  && argv[argv.indexOf(a) - 1] !== "--worktree" && argv[argv.indexOf(a) - 1] !== "--host"
  && argv[argv.indexOf(a) - 1] !== "--webroot");
const SITE = opt("site", "G:/Postmark/repo-clones/wright/site"); // keeminlee/postmark-site — the extraction moved the town here (P3 flip 2026-07-27)
const WT = opt("worktree", "G:/pmprev-wt");
const HOST = opt("host", "meepo-ec2");
const WEBROOT = opt("webroot", "/var/www/postmark-preview");
const KEEP = flag("keep-worktree");

if (!branch) {
  console.error("usage: node tools/preview-deploy.mjs <branch> [--site <p>] [--worktree <p>] [--host <ssh>] [--webroot <p>] [--keep-worktree]");
  process.exit(2);
}

// ── slug: path/URL-safe, and NOT a traversal ─────────────────────────────────
const slug = branch
  .toLowerCase()
  .replace(/[^a-z0-9._-]+/g, "-")
  .replace(/^[-._]+|[-._]+$/g, "")
  .slice(0, 60)
  .replace(/[-._]+$/g, "");
if (!slug || slug === "." || slug === "..") {
  console.error(`refusing: branch "${branch}" sanitizes to an unsafe slug ("${slug}")`);
  process.exit(2);
}
const PREVIEW_BASE = `/preview/${slug}/`;
const URL_ = `https://postmark.town${PREVIEW_BASE}`;

const sh = (cmd, args, o = {}) =>
  execFileSync(cmd, args, { stdio: "inherit", ...o });
const shOut = (cmd, args, o = {}) =>
  execFileSync(cmd, args, { encoding: "utf8", ...o }).trim();
const git = (args, o = {}) => sh("git", ["-C", SITE, ...args], o);
const gitOut = (args, o = {}) => shOut("git", ["-C", SITE, ...args], o);

console.log(`\n▸ preview-deploy: branch "${branch}" → ${URL_}\n`);

// ── resolve the build ref (origin/<branch> preferred; local fallback) ─────────
if (!existsSync(join(SITE, "node_modules", "astro"))) {
  console.error(`✗ ${SITE} has no node_modules — run \`npm install\` in the site clone first.`);
  process.exit(1);
}
console.log("• fetching origin…");
git(["fetch", "origin", "--prune"]);
let ref = null;
for (const cand of [`origin/${branch}`, branch]) {
  try { execFileSync("git", ["-C", SITE, "rev-parse", "--verify", "--quiet", cand], { stdio: "ignore" }); ref = cand; break; }
  catch { /* not this one */ }
}
if (!ref) {
  console.error(`✗ no such branch: neither origin/${branch} nor local ${branch} exists.`);
  process.exit(1);
}
const sha = gitOut(["rev-parse", "--short", ref]);
console.log(`• build ref: ${ref} @ ${sha}`);

// ── worktree (detached) + node_modules junction ──────────────────────────────
function removeJunction(p) {
  try { rmdirSync(p); return; } catch { /* fall through */ }
  try { execFileSync("cmd", ["/c", "rmdir", p.replace(/\//g, "\\")], { stdio: "ignore" }); } catch { /* best effort */ }
}
function teardownWorktree() {
  removeJunction(join(WT, "node_modules"));
  try { execFileSync("git", ["-C", SITE, "-c", "core.longpaths=true", "worktree", "remove", "--force", WT], { stdio: "ignore" }); } catch {}
  try { execFileSync("git", ["-C", SITE, "worktree", "prune"], { stdio: "ignore" }); } catch {}
  try { rmSync(WT, { recursive: true, force: true }); } catch {}
}

teardownWorktree(); // clean any prior run
console.log(`• worktree: ${WT}`);
git(["-c", "core.longpaths=true", "worktree", "add", "--detach", WT, ref]);
// share the main checkout's deps (junction, no reinstall). Node 'junction' type
// needs no admin on Windows.
symlinkSync(join(SITE, "node_modules"), join(WT, "node_modules"), "junction");

let ok = false;
try {
  // ── GUARD 1: the branch must carry the PREVIEW_BASE plumbing ───────────────
  const cfgPath = join(WT, "astro.config.town.mjs");
  if (!existsSync(cfgPath) || !/process\.env\.PREVIEW_BASE/.test(readFileSync(cfgPath, "utf8"))) {
    throw new Error(
      `branch "${branch}" has no PREVIEW_BASE read in astro.config.town.mjs.\n` +
      `  Its build would silently ignore the prefix and ship a preview whose\n` +
      `  assets 404. Merge/rebase the preview-base config into this branch first.`
    );
  }

  // ── build with the asset prefix ────────────────────────────────────────────
  console.log(`• building (assetsPrefix=${PREVIEW_BASE})…`);
  execFileSync("npx", ["--no-install", "astro", "build", "--config", "astro.config.town.mjs"], {
    cwd: WT, stdio: "inherit", env: { ...process.env, PREVIEW_BASE }, shell: true,
  });

  // ── GUARD 2: assert the prefix actually landed ─────────────────────────────
  const dist = join(WT, "dist-town");
  const indexHtml = readFileSync(join(dist, "index.html"), "utf8");
  if (!indexHtml.includes(`${PREVIEW_BASE}_astro/`)) {
    throw new Error(`built index.html has no ${PREVIEW_BASE}_astro/ references — the prefix did not apply. Refusing to ship.`);
  }
  console.log("• prefix verified in built output ✓");

  // ── ship: tar → scp → sudo stage-and-swap ──────────────────────────────────
  const stage = mkdtempSync(join(tmpdir(), "pmprev-"));
  const tarName = `${slug}.tgz`;
  const tarball = join(stage, tarName);
  console.log("• packing…");
  // Run from the stage dir with a RELATIVE -f name: a Windows drive path like
  // C:\…\x.tgz makes GNU tar (Git Bash) read the colon as a remote host. cwd +
  // bare name sidesteps it for both GNU tar and Windows bsdtar. Only -f triggers
  // the remote heuristic, so -C with a drive letter is fine.
  execFileSync("tar", ["-C", dist, "-czf", tarName, "."], { stdio: "inherit", cwd: stage });
  console.log(`• shipping to ${HOST}…`);
  execFileSync("scp", ["-q", tarball, `${HOST}:/tmp/pmprev-${slug}.tgz`], { stdio: "inherit" });
  const remote = [
    "set -e",
    `rm -rf /tmp/pmprev-${slug} && mkdir -p /tmp/pmprev-${slug}`,
    `tar -C /tmp/pmprev-${slug} -xzf /tmp/pmprev-${slug}.tgz`,
    `sudo mkdir -p ${WEBROOT}`,
    `sudo rm -rf ${WEBROOT}/${slug}.new`,
    `sudo mv /tmp/pmprev-${slug} ${WEBROOT}/${slug}.new`,
    `sudo rm -rf ${WEBROOT}/${slug}`,
    `sudo mv ${WEBROOT}/${slug}.new ${WEBROOT}/${slug}`,
    `sudo chown -R root:root ${WEBROOT}/${slug}`,
    `rm -f /tmp/pmprev-${slug}.tgz`,
  ].join(" && ");
  execFileSync("ssh", [HOST, remote], { stdio: "inherit" });
  rmSync(stage, { recursive: true, force: true });

  ok = true;
  console.log(`\n✓ deployed: ${URL_}  (${ref} @ ${sha})`);
  console.log(`  remove later:  ssh ${HOST} sudo rm -rf ${WEBROOT}/${slug}\n`);
} finally {
  if (KEEP) console.log(`• (worktree kept at ${WT})`);
  else teardownWorktree();
}
process.exit(ok ? 0 : 1);
