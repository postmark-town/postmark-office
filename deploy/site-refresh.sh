#!/usr/bin/env bash
# site-refresh.sh — the town's data layer rebakes on the BOX, on the town's clock.
#
# WHY THIS EXISTS. postmark.town's mushy middle — every doorstep bundle, the mail
# pages, Ferry's Daily, the atlas mirrors — is rebaked today by two GitHub
# SCHEDULED workflows in postmark-site (.github/workflows/sync-atlas.yml extracts
# the town into main every */30; .github/workflows/deploy.yml rebuilds prod at the
# standing release tag every */30). GitHub's cron is best-effort and documents
# itself as such. On 2026-08-26 the delivery ran 97 minutes past a ferry crossing
# and 48 residents' doorstep pages served yesterday's mail while the ledger
# already carried today's.
#
# The freshness architecture (EPICS/POSTMARK/freshness-architecture.md, founder
# ruled 2026-08-26/27) moves the middle onto a box timer, verbatim:
#
#   "a 30-minute timer, phase-aligned ~:10 after the ferry crossings (the known
#    moments mail actually moves), lockfile single-flight, atomic
#    temp-build-then-symlink-swap (zero downtime; no stale-over-fresh ordering
#    race). GitHub Actions keeps only code releases."
#
# This file is that timer's hand. Its unit pair is postmark-site-refresh.service
# and .timer; the INSTALL block at the bottom of this header names every box-side
# step, assumption, and rollback.
#
# ── ONE RECIPE, TWO TRIGGERS ────────────────────────────────────────────────
#
# This script REIMPLEMENTS NOTHING. Every step below invokes the site's own
# script, with the site's own arguments, in deploy.yml/sync-atlas.yml's own
# order, and the step comments name the workflow step each one mirrors. If the
# site changes how it builds itself, this file inherits the change; if it grows a
# step, this file has to grow the same line, and the mirrored step names are what
# make that drift greppable. The recipe is the site's; only the trigger is ours.
#
#   sync-atlas.yml                        this script
#   ──────────────────────────────────    ─────────────────────────────────────
#   checkout postmark-site @ main         the extract tree ($ROOT/site @ main)
#   checkout postmark-town/postmark       $ROOT/town, pinned to origin/main's sha
#   npm install sharp                     ensure_deps, extract tree
#   extract-town.mjs --town               same
#   fetch-town.mjs --town                 same
#   sync-renditions.mjs --town            same
#   commit + push to main                 NOT DONE — see "no commit" below
#
#   deploy.yml (release lane)             this script
#   ──────────────────────────────────    ─────────────────────────────────────
#   checkout, pin to newest release/*     the build tree ($ROOT/build, detached)
#   overlay town data from main           rsync the extract tree's output in
#   take world-pin resolver from main     same three files, same `git checkout`
#   npm ci                                ensure_deps, build tree
#   resolve-world-pin.mjs                 same, plus the same install+verify
#   fetch-town.mjs                        already done in the extract tree
#   npm run build                         same
#   build-stamp.mjs --out dist-town/      same, plus BUILD_TOWN_SHA/BUILD_CROSSING
#   rsync --delete to the webroot         publish to a release dir + swap a link
#
# NO COMMIT. sync-atlas's output is committed to site main so that a later
# Actions run can find it; a box that builds and publishes in one pass has no
# such gap to bridge, so the extractor output stays ephemeral in the extract
# tree. That is the single biggest simplification here: no deploy key, no push
# race, no rebase-and-retry loop, and no half-hourly commit churn on main.
#
# ── THE TWO TREES, AND WHY IT IS NOT ONE ────────────────────────────────────
#
# The site has two tenses and they are not negotiable: CODE comes from the newest
# release/* tag (a human approved it), DATA comes from main's extractors (they
# move at the town's pace). deploy.yml reconciles them with an overlay.
#
# The tempting simplification is one tree at the tag with main's tools/ checked
# in over it. It is wrong: src/lib/pm.mjs line 149 does
# `export { threadTitle } from "../../tools/lib/ids.mjs"` — the SITE CODE imports
# out of tools/, so `git checkout origin/main -- tools/` would silently change
# what the tag's pages compile against. Two trees keeps the seam where deploy.yml
# already put it: main's extractors produce data, the tag's code renders it, and
# the only files that cross are the three deploy.yml already names by hand.
#
# ── WHAT THE SNAPSHOT KEY COVERS, AND WHY IT IS NOT JUST THE TOWN ───────────
#
# The quiet path is the whole point: on a tick where nothing moved this exits in
# seconds having done four fetches. But "nothing moved" cannot mean "the town did
# not move", because the box is now the ONLY thing that publishes prod content —
# so a newly cut release tag and a newly blessed settlement must wake it too, or
# they would sit unpublished until the town happened to change. The key is:
#
#   town origin/main · site origin/main · newest release/* tag · settlement tags
#
# Site main is in the key for the transition: while sync-atlas.yml is still
# enabled it commits every 30 minutes, so main moves every tick and the quiet
# path will rarely fire. That is correct — it means this timer keeps pace with
# the workflow it replaces — and it goes quiet on its own the moment sync-atlas
# is retired (INSTALL step 7).
#
# ── FAILURE POSTURE ─────────────────────────────────────────────────────────
#
# A failed build publishes NOTHING. The symlink still points at the last good
# release, so the floor keeps serving (freshness-architecture: "the floor may lag,
# but it must never lie about being current" — and the page's own generated-at
# disclosure is what keeps the lag honest). Exit 1 loudly; systemd records it;
# site-sentinel's crossing probe is what turns a run of failures into a Discord
# message. This script alarms nobody itself, by the same rule harbor-watch and
# site-sentinel follow: detection is mechanical, repair stays a hand.
#
# ── BOX FACTS THIS IS DESIGNED AROUND ───────────────────────────────────────
#
#  * /tmp on this box refuses hardlinks: a `git clone --local` there dies with
#    "failed to create link ... Operation not permitted" (diagnosed 2026-08-26).
#    So: no --local clones anywhere here, and TMPDIR is forced under $ROOT so
#    that node's mkdtempSync (resolve-world-pin.mjs clones the world repo into
#    one) never lands in /tmp either.
#  * nginx serves prod straight off /var/www/postmark-town-site
#    (deploy/nginx-postmark-town.conf line 68, and deploy.yml's rsync target).
#    INSTALL converts that path from a directory into a SYMLINK; nginx follows
#    symlinks by default and its config does not change, which keeps the
#    box-config drift surface at zero.
#
# Env (unit): SITE_REFRESH_ROOT, SITE_WEBROOT, SITE_REMOTE, TOWN_REMOTE,
#             WORLD_REMOTE, POSTMARK_API, SITE_REFRESH_REPORT,
#             SITE_REFRESH_KEEP, SITE_REFRESH_MAX_PASSES, GH_TOKEN (optional).
# Cwd: irrelevant — every path is absolute.
# Exit: 0 published / quiet / stood down behind the lock · 1 the build failed.
#
# ── INSTALL (Wright's hand; this script never touches the box itself) ────────
#
# Read the live copies before installing over them (the box-config drift law:
# the box's file is the truth, the repo's is the intent).
#
#   # 0. THE OFFICE GOES FIRST. This branch also teaches GET /api/ to serve the
#   #    town's crossing number, and both the page's disclosure and
#   #    site-sentinel's crossing probe read it from there. Until the office
#   #    carrying that change is deployed, every crossing is honestly null: the
#   #    doorstep omits the claim, /build.json stamps null, and the sentinel says
#   #    UNKNOWN rather than green. Nothing breaks — the feature is simply
#   #    absent — but there is no reason to install the timer and then wonder.
#   #    The falsifiable check, which only the new code can pass. Run against
#   #    both sides before trusting it: it prints a number on the new office and
#   #    says ABSENT on the standing one, which is what makes it a probe rather
#   #    than a formality (verified both ways 2026-08-27 — 152 on the branch,
#   #    ABSENT on prod). The manifest is pretty-printed, so a line-wise grep for
#   #    "crossing" is NOT a substitute; it comes back empty either way.
#   curl -sS https://postmark.town/api/ | node -e \
#     'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).crossing?.number ?? "ABSENT — the office has not shipped it yet"))'
#
#   # 1. the service's own root, owned by the office user
#   sudo mkdir -p /srv/postmark-site-refresh /srv/postmark-harbor
#   sudo chown meepo /srv/postmark-site-refresh /srv/postmark-harbor
#
#   # 2. the script itself
#   sudo install -o meepo -m 755 deploy/site-refresh.sh /srv/postmark-office/deploy/site-refresh.sh
#
#   # 3. meepo must be able to swap the link in /var/www (it owns nothing there today)
#   sudo chown meepo /var/www           # or: setfacl -m u:meepo:rwx /var/www
#
#   # 3b. the falsifiers, against a throwaway sandbox — they touch nothing real
#   #     and take about a minute. They are how the three bugs in this script's
#   #     first draft were found; run them before trusting a new copy of it.
#   bash /srv/postmark-office/deploy/site-refresh-selftest.sh
#
#   # 4. FIRST RUN BY HAND, publishing nowhere — proves the build works before
#   #    anything the public reads is touched. This writes a release dir and a
#   #    report and swaps a link inside the sandbox root, not the real webroot.
#   #
#   #    EXPECT THIS ONE TO BE SLOW: it clones the town (large — images) and the
#   #    site, runs two npm ci's, and builds every page. Ten to twenty minutes is
#   #    normal for the FIRST run and says nothing about the steady state, which
#   #    is a few fetches on a quiet tick. Watch it rather than backgrounding it.
#   sudo -u meepo env SITE_WEBROOT=/srv/postmark-site-refresh/sandbox-webroot \
#     /srv/postmark-office/deploy/site-refresh.sh
#   ls -l /srv/postmark-site-refresh/sandbox-webroot   # -> a symlink into releases/
#   cat /srv/postmark-harbor/site-refresh.json
#   # sanity: the built bytes carry the freshness stamp
#   cat "$(readlink -f /srv/postmark-site-refresh/sandbox-webroot)/build.json"
#
#   # 5. THE CUTOVER — directory becomes symlink. Keep the old bytes as the
#   #    rollback; do it in one rename so no request ever sees a missing root.
#   REL="$(readlink -f /srv/postmark-site-refresh/sandbox-webroot)"
#   sudo mv /var/www/postmark-town-site /var/www/postmark-town-site.pre-box
#   sudo -u meepo ln -sfn "$REL" /var/www/.postmark-town-site.next
#   sudo -u meepo mv -Tf /var/www/.postmark-town-site.next /var/www/postmark-town-site
#   curl -sS -o /dev/null -w '%{http_code}\n' https://postmark.town/
#   curl -sS https://postmark.town/build.json
#
#   # 6. the timer
#   sudo cp deploy/postmark-site-refresh.{service,timer} /etc/systemd/system/
#   sudo systemctl daemon-reload
#   sudo systemctl enable --now postmark-site-refresh.timer
#   systemctl list-timers postmark-site-refresh --no-pager     # expect :10 and :40
#
#   #    EXPECT THE FIRST TIMER TICK TO SAY "quiet", AND THAT IS CORRECT: step 4
#   #    already built this exact snapshot and wrote it into state.json, and step
#   #    5 pointed prod at it. The first tick that does real work is the one
#   #    after the town next moves — within thirty minutes, or at the next ferry.
#   #    If you would rather watch a real build now, `sudo -u meepo systemctl
#   #    start postmark-site-refresh` after any town commit lands.
#
#   # 7. ONLY AFTER a full ferry crossing has landed on the box timer and the
#   #    site's own crossing disclosure agrees with the office: retire GitHub's
#   #    two content schedules, so one writer owns prod content.
#   #      postmark-site .github/workflows/sync-atlas.yml   — drop `schedule:`
#   #      postmark-site .github/workflows/deploy.yml       — drop `schedule:`
#   #    Both keep workflow_dispatch and their push/tag triggers: code releases
#   #    stay on Actions, which is exactly what the architecture memo says. Doing
#   #    this BEFORE step 5 verifies would leave the site with no refresh at all.
#
#   # ROLLBACK, at any point, in one rename — the old directory is still there:
#   sudo systemctl disable --now postmark-site-refresh.timer
#   sudo rm -f /var/www/postmark-town-site        # removes the SYMLINK, not the bytes
#   sudo mv /var/www/postmark-town-site.pre-box /var/www/postmark-town-site
#   # then re-enable the two `schedule:` blocks if step 7 had been taken.
#
# ASSUMPTIONS, stated so they can be checked rather than hoped:
#   * user `meepo` may write /var/www (step 3) — it does not today.
#   * node >= 22.12 on PATH for meepo (the site's engines field).
#   * `rsync` and `flock` exist on the box (rsync is deploy.yml's own transport;
#     flock ships in util-linux).
#   * disk: a second full town clone plus two site trees plus KEEP release dirs.
#     The town clone is the big one (images). Budget ~2-3 GB and watch it once.
#   * the box can reach github.com over https unauthenticated (both repos are
#     public). GH_TOKEN is optional and only raises extract-town's PR-state
#     budget; without it those fields go null, exactly as they do in Actions.
#
# Repo copy of record: postmark-office deploy/site-refresh.sh

# -E (errtrace) is load-bearing, not decoration: without it bash does NOT inherit
# the ERR trap into shell functions, so a failure inside build_once() would exit
# with git's own status and write no board at all. The selftest caught it —
# ten reported failures against a report file three runs stale.
set -Eeuo pipefail

ROOT="${SITE_REFRESH_ROOT:-/srv/postmark-site-refresh}"
WEBROOT="${SITE_WEBROOT:-/var/www/postmark-town-site}"
SITE_REMOTE="${SITE_REMOTE:-https://github.com/postmark-town/postmark-site.git}"
TOWN_REMOTE="${TOWN_REMOTE:-https://github.com/postmark-town/postmark.git}"
WORLD_REMOTE="${WORLD_REMOTE:-https://github.com/postmark-town/postmark-world.git}"
API="${POSTMARK_API:-https://postmark.town/api}"
OUT="${SITE_REFRESH_REPORT:-/srv/postmark-harbor/site-refresh.json}"
KEEP="${SITE_REFRESH_KEEP:-5}"
MAX_PASSES="${SITE_REFRESH_MAX_PASSES:-3}"

TOWN="$ROOT/town"          # our own town clone — never the office's, never locked
SITE="$ROOT/site"          # the extract tree: site @ origin/main, runs the extractors
BUILD="$ROOT/build"        # the build tree: a worktree of SITE, detached at the tag
RELEASES="$ROOT/releases"
STATE="$ROOT/state.json"
LOCK="$ROOT/refresh.lock"

STARTED="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
TOWN_SHA=""; SITE_MAIN=""; TAG=""; PUBLISHED=""; PASSES=0

mkdir -p "$ROOT" "$RELEASES" "$(dirname "$OUT")"

# TMPDIR under our own root, not /tmp. This box's /tmp refuses hardlinks, and
# resolve-world-pin.mjs clones the world repo into node's tmpdir(); a git clone
# that lands there is the exact failure diagnosed on 2026-08-26.
export TMPDIR="$ROOT/tmp" TMP="$ROOT/tmp" TEMP="$ROOT/tmp"
mkdir -p "$TMPDIR"

# ── the status board ────────────────────────────────────────────────────────
# Same shape and same place as settlement-auto.sh's: a small JSON a human or a
# dashboard can read without journalctl. Never allowed to fail the run.
report() { # status detail
  printf '{\n "at": "%s",\n "status": "%s",\n "town_sha": "%s",\n "site_main": "%s",\n "release_tag": "%s",\n "published": "%s",\n "passes": %s,\n "detail": "%s"\n}\n' \
    "$STARTED" "$1" "$TOWN_SHA" "$SITE_MAIN" "$TAG" "$PUBLISHED" "$PASSES" \
    "$(printf '%s' "$2" | tr -d '\n' | tr '"' "'")" > "$OUT" 2>/dev/null || true
}
say() { echo "[site-refresh] $*"; }
die() { report failed "$1"; echo "[site-refresh] FAILED: $1" >&2; exit 1; }

# EVERY failure writes the board, not just the ones with a `|| die` on them.
# Without this, an unguarded command failing under `set -e` exits with its own
# code and leaves the LAST run's report standing — so a dashboard reading the
# board sees a stale "quiet" beside a service that has been dying for hours,
# which is the same silent-green shape site-sentinel exists to end. (The
# selftest found exactly that: ten failures reported against a board written
# three runs earlier.) Commands with `|| die` are exempt from ERR, so they keep
# their own better message.
on_err() { local rc=$?; report failed "the run stopped unexpectedly at line $1 (exit $rc) — see journalctl -u postmark-site-refresh"; echo "[site-refresh] FAILED at line $1 (exit $rc)" >&2; exit 1; }
trap 'on_err $LINENO' ERR

# ── SINGLE-FLIGHT ───────────────────────────────────────────────────────────
# Non-blocking on purpose. A second trigger arriving mid-build must STAND DOWN,
# not queue: a queued build would start against inputs the running one has
# already passed, and two 30-minute timers stacking behind one slow build is how
# a box eats itself. Convergence is what makes standing down safe — the running
# build re-checks the town when it finishes and runs again if it moved, so the
# work this tick declined to do is not lost, only deferred to the pass that can
# actually see the newer state.
exec 9>"$LOCK"
if ! flock -n 9; then
  say "a build is already running — this tick stands down (the running pass converges)"
  exit 0
fi

# ── one-time clones (never --local: this box's /tmp and hardlinks, see header) ─
[ -d "$TOWN/.git" ] || { say "first run: cloning the town"; git clone -q "$TOWN_REMOTE" "$TOWN"; }
[ -d "$SITE/.git" ] || { say "first run: cloning the site"; git clone -q "$SITE_REMOTE" "$SITE"; }

# ── what the world looks like right now ─────────────────────────────────────
survey() {
  git -C "$TOWN" fetch -q --prune origin
  TOWN_SHA="$(git -C "$TOWN" rev-parse origin/main)"
  git -C "$SITE" fetch -q --prune --tags --force origin
  SITE_MAIN="$(git -C "$SITE" rev-parse origin/main)"
  # Newest release tag, by the same rule deploy.yml uses (creatordate, newest
  # first). No tag at all is deploy.yml's own sleeping case, not an error.
  TAG="$(git -C "$SITE" tag -l 'release/*' --sort=-creatordate | head -1)"
  # The settlement listing, hashed. One ls-remote, no clone: enough to notice a
  # blessing, cheap enough to spend on every quiet tick. The real decision (the
  # three guardrails) is still resolve-world-pin.mjs's, inside the build.
  WORLD_TAGS="$(git ls-remote "$WORLD_REMOTE" 'refs/tags/settlement/*' 2>/dev/null | sha1sum | cut -d' ' -f1)"
  KEY="town:$TOWN_SHA site:$SITE_MAIN tag:$TAG@$(git -C "$SITE" rev-parse -q --verify "refs/tags/$TAG^{commit}" 2>/dev/null || echo none) world:$WORLD_TAGS"
}

survey
if [ -z "$TAG" ]; then
  report quiet "no release/* tag exists yet — the release lane sleeps until the first one"
  say "no release/* tag — nothing to build from (deploy.yml sleeps here too)"
  exit 0
fi

LAST="$( [ -f "$STATE" ] && sed -n 's/.*"key": "\(.*\)".*/\1/p' "$STATE" || true )"
if [ "$KEY" = "$LAST" ]; then
  report quiet "nothing moved since the last build (town $(echo "$TOWN_SHA" | cut -c1-8), $TAG)"
  say "quiet: town, site main, $TAG and the settlement tags are all where the last build left them"
  exit 0
fi

# ── dependencies, installed only when the lockfile actually changed ─────────
# npm ci is a minute we do not want on every build, and the lockfile is the only
# thing that decides whether it is needed. The stamp lives beside node_modules so
# a hand-deleted node_modules re-triggers it.
ensure_deps() { # tree label
  local tree="$1" label="$2" want have
  want="$(sha1sum "$tree/package-lock.json" | cut -d' ' -f1)"
  have="$( [ -f "$tree/node_modules/.site-refresh-lock" ] && cat "$tree/node_modules/.site-refresh-lock" || true )"
  if [ "$want" != "$have" ] || [ ! -d "$tree/node_modules" ]; then
    say "$label: npm ci (lockfile moved)"
    ( cd "$tree" && npm ci --no-audit --no-fund --silent )
    # sharp is not a site dependency — sync-atlas.yml installs it --no-save for
    # extract-town.mjs's image processing (tools/lib/images.mjs imports it at the
    # top, so its absence is a hard failure, not a degraded image pass). Same
    # pinned version, same reason.
    if [ "$label" = "extract" ]; then
      ( cd "$tree" && npm install --no-save --no-audit --no-fund --silent sharp@0.33.5 )
    fi
    printf '%s' "$want" > "$tree/node_modules/.site-refresh-lock"
  fi
}

# ── what postmark-world a lockfile NAMES, or empty ────────────────────────
# TWO LOCKFILES, TWO DIFFERENT QUESTIONS, and keeping them apart is why this is a
# function rather than one inlined read:
#
#   package-lock.json                 what this tree ASKED FOR
#   node_modules/.package-lock.json   what npm actually PUT ON DISK
#
# They diverge on every tick that skips `npm ci` — which is most of them, for the
# reason the world-pin block below sets out — and prod served a world nobody had
# asked for because only the first of the two was ever read.
world_sha_of() { # lockfile-path
  [ -f "$1" ] || return 0
  node -e '
    const { readFileSync } = require("node:fs");
    try {
      const lock = JSON.parse(readFileSync(process.argv[1], "utf8"));
      const got = lock.packages?.["node_modules/postmark-world"]?.resolved ?? "";
      const m = /#([0-9a-f]{40})$/.exec(String(got));
      if (m) process.stdout.write(m[1]);
    } catch {}
  ' "$1" 2>/dev/null || true
}

# ── the crossing this build reflects ────────────────────────────────────────
# Read from the OFFICE, never derived here. crossings.mjs exists precisely
# because the alternative to one reader is two clocks; the office serves the
# number at GET /api/ and the site's live island reads the same field from the
# same door, so "a ferry has landed since this page was made" is one clock
# compared against itself. Unreachable is an honest null, never a guess: an
# absent BUILD_CROSSING makes build-stamp.mjs say so in its notes, and the
# page's disclosure falls back to plain generated-at.
crossing_now() {
  curl -fsS --max-time 10 "$API/" 2>/dev/null \
    | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const n=JSON.parse(s)?.crossing?.number;if(Number.isInteger(n))process.stdout.write(String(n));}catch{}})' \
    2>/dev/null || true
}

# ── one build pass ──────────────────────────────────────────────────────────
build_once() {
  PASSES=$((PASSES + 1))
  say "pass $PASSES — town $(echo "$TOWN_SHA" | cut -c1-8) · site main $(echo "$SITE_MAIN" | cut -c1-8) · code $TAG"

  # THE TOWN AT A PINNED SHA. Detached at exactly the sha the key names, so the
  # bytes this build reads are the bytes the receipt claims — a fetch landing
  # mid-extract cannot smear two town states into one page.
  git -C "$TOWN" checkout -qf --detach "$TOWN_SHA"
  git -C "$TOWN" clean -qfd

  # ── the extract tree: site @ main, exactly what sync-atlas.yml checks out ──
  git -C "$SITE" checkout -qf -B refresh-main "$SITE_MAIN"
  # -e node_modules: the clean is for stale extractor output, not for the
  # dependencies we just spent a minute installing. No -x, so nothing ignored
  # (node_modules, dist-town) is touched and every TRACKED data file is already
  # restored by the -f checkout above.
  git -C "$SITE" clean -qfd -e node_modules
  ensure_deps "$SITE" extract

  # THE CROSSING, ASKED ONCE. Both the doorstep bundles and the build stamp
  # carry it, and they must carry the SAME one — asking twice across a build
  # that straddles a ferry would put two different crossings on one page's
  # worth of bytes, which is the two-clocks bug in miniature.
  local crossing
  crossing="$(crossing_now)"
  say "crossing: ${crossing:-unreadable (the office did not answer — the page will omit the claim)}"

  # sync-atlas.yml's three steps, its order, its arguments.
  say "extract: the checkout-coupled half (media, atlas, daily, works, doorstep bundles)"
  ( cd "$SITE" && GH_TOKEN="${GH_TOKEN:-}" POSTMARK_CROSSING="$crossing" node tools/extract-town.mjs --town "$TOWN" ) \
    || die "extract-town.mjs tripped"
  say "extract: the API-fed half"
  # fetch-town.mjs also writes /data/pin.json (the site's tools/lib/world-pin-publish.mjs),
  # which names its lane and ref from PUBLIC_CHANNEL and BUILD_CODE_REF. deploy.yml
  # started passing both on 2026-09-08 (postmark-site #62); this script did not,
  # so every BOX build — which is every prod build — kept writing `code_ref: null`
  # with its own note saying so. Same two values the stamp step below passes, so
  # the two files cannot disagree about which ref and which lane built the site.
  # (What pin.json CANNOT say is which world the BUILD tree compiled: it reads
  # this extract tree's lockfile, i.e. site main's floor, and the build tree may
  # have advanced past it. /build.json's world_sha is that answer — see the stamp.)
  ( cd "$SITE" && POSTMARK_API="$API" PUBLIC_CHANNEL=release BUILD_CODE_REF="$TAG" node tools/fetch-town.mjs --town "$TOWN" ) \
    || die "fetch-town.mjs tripped"
  say "extract: approved renditions"
  ( cd "$SITE" && node tools/sync-renditions.mjs --town "$TOWN" ) \
    || die "sync-renditions.mjs tripped"

  # ── the build tree: site @ the newest release tag ─────────────────────────
  #
  # `-e` AND NOT `-d`, and it is not a nicety: a git WORKTREE's .git is a FILE
  # holding a gitdir pointer, not a directory. `[ -d "$BUILD/.git" ]` is false
  # for a perfectly good worktree, so the guard never held, `worktree add` ran
  # on every tick, and every run after the very first one died with
  # "fatal: '.../build' already exists" (exit 128, before any report was
  # written). Found by deploy/site-refresh-selftest.sh § 4 on its first pass —
  # the first build would have looked like a clean install and the site would
  # have frozen from the second tick onward.
  # NOT "prune -q": git worktree prune takes -n/-v/--expire and nothing else,
  # and an unknown switch here is a hard 129 on every tick (the selftest's
  # second finding, in the same run as the .git-is-a-file one).
  git -C "$SITE" worktree prune >/dev/null 2>&1 || true
  if [ ! -e "$BUILD/.git" ]; then
    rm -rf "$BUILD"   # a killed run can leave a half-made tree that `add` refuses
    git -C "$SITE" worktree add -f --detach "$BUILD" "refs/tags/$TAG" >/dev/null \
      || die "could not make the build worktree at $BUILD"
  fi
  git -C "$BUILD" checkout -qf --detach "refs/tags/$TAG" || die "could not check out $TAG in the build tree"
  git -C "$BUILD" clean -qfd -e node_modules

  # THE OVERLAY — deploy.yml's `git checkout origin/main -- public/atelier/postmark
  # src/data/postmark`, except the source is the extractor output we just made
  # rather than whatever main last committed, which is the entire point of moving
  # this to the box: no commit sits between the town changing and prod seeing it.
  #
  # public/renditions/ is overlaid too, and that is a DEVIATION from deploy.yml
  # (it overlays only the two paths above). Grounds: src/data/postmark/
  # renditions.json — the picker INDEX — is inside the overlay, while the HTML
  # files it points at are not, so a rendition merged after the tag was cut is
  # currently listed on prod with a 404 behind it. Overlaying the index without
  # the pages is not a smaller change than overlaying both; it is a broken one.
  # Flagged for review rather than done quietly.
  for p in public/atelier/postmark src/data/postmark public/renditions; do
    [ -d "$SITE/$p" ] || continue
    mkdir -p "$BUILD/$p"
    rsync -a --delete "$SITE/$p/" "$BUILD/$p/"
  done

  ensure_deps "$BUILD" build

  # DEPLOY MACHINERY TRAVELS WITH THE LANE, NOT WITH THE RELEASE — deploy.yml's
  # own words and its own three files. The build tree sits at a tag that may
  # predate any of them; the `||` is the same bootstrap it uses, and its
  # consequence is the same (the pin holds at the release floor, /build.json is
  # not emitted and the sentinel reads UNKNOWN rather than green).
  git -C "$BUILD" checkout "$SITE_MAIN" -- \
    tools/resolve-world-pin.mjs tools/lib/world-pin.mjs tools/build-stamp.mjs \
    2>/dev/null || say "warn: the tag predates the deploy machinery on main — pin holds at the floor, no build stamp"

  # ── the world pin (POS-55): rebuild-time DATA, not release-time config ────
  #
  # npm ci above already installed THE FLOOR — ON A TICK WHERE IT RAN. It very
  # often does not run, and that is not a bug in ensure_deps: it keys on
  # package-lock.json's sha1, the `checkout -qf --detach` at the top of this
  # function has just restored that lockfile to the TAG's copy, and node_modules
  # SURVIVES from tick to tick. So the comparison matches, npm ci is skipped, and
  # what is on disk is whatever the last `npm install` below left there.
  #
  # 2026-09-10, and this is why the block below changed shape. The 06:40Z tick
  # advanced prod to settlement/S64 and installed it. The founder landed
  # HOLD_AT_SETTLEMENT = 63 in site main at 14:37Z. The 14:41Z and 15:10Z ticks
  # resolved "hold", printed "holding at the release floor", installed NOTHING —
  # and went on publishing S64's world, because holding was implemented as doing
  # nothing to a directory that already held S64. Meanwhile /build.json read
  # world_sha 256db2fe (S63) the whole time: the stamper reads package-lock.json,
  # which git had just restored, so the receipt described the ASK while prod
  # served the ANSWER. Two files, two questions, and nothing comparing them. What
  # the founder saw was the world page's painted ground gone — S64's viewer
  # replaces the /atlas/town.html fetch with townGround() — under a hold landed
  # precisely to keep S64 off prod until he had seen it.
  #
  # SO: DECIDE, THEN INSTALL, ON BOTH PATHS. `want` is the sha this build has
  # decided on — the resolver's on advance, the tag's own lockfile floor on hold.
  # `have` is read from node_modules/.package-lock.json, npm's record of WHAT IS
  # INSTALLED, never from package-lock.json, which only says what was asked for.
  # The install is a no-op exactly when the two already agree, so a steady tick
  # costs one file read — and a hold now means something on disk.
  local pin decision sha settlement want have
  # The settlement tag the build tree's world sits at, when the resolver just
  # put it there. Stays EMPTY on hold: the floor sha is whatever site main's
  # package.json froze, which is not necessarily a tag's commit, and a ref that
  # was not verified is a guess. The stamp reads the SHA itself from the build
  # tree's lockfile; this only lends it the tag's name when that name is known.
  local world_ref=""
  if [ -f "$BUILD/tools/resolve-world-pin.mjs" ]; then
    pin="$( cd "$BUILD" && WORLD_REMOTE="$WORLD_REMOTE" node tools/resolve-world-pin.mjs 2>/dev/null || true )"
    decision="$(printf '%s' "$pin" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(String(JSON.parse(s).decision??""))}catch{}})' || true)"
    sha="$(printf '%s' "$pin" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(String(JSON.parse(s).sha??""))}catch{}})' || true)"
    settlement="$(printf '%s' "$pin" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(String(JSON.parse(s).settlement??""))}catch{}})' || true)"
    want=""
    if [ "$decision" = "advance" ] && [ -n "$sha" ]; then
      want="$sha"
      say "world: advancing to settlement S$settlement ($(echo "$sha" | cut -c1-8))"
      world_ref="settlement/S$settlement"
    else
      want="$(world_sha_of "$BUILD/package-lock.json")"
      say "world: holding at the release floor (${want:-unpinned})"
    fi

    have="$(world_sha_of "$BUILD/node_modules/.package-lock.json")"
    # THE ADVANCE RE-LOCKS EVERY TICK (reviewer, 2026-09-11 § 3). `npm install
    # pkg@github:…#sha` is what rewrites the build tree's package-lock.json, and
    # build-stamp.mjs reads THAT file first. Guarded on want != have alone, the
    # second advance tick with the same decision would skip the install and
    # leave the lockfile naming the floor while node_modules carries the
    # settlement — /build.json publishing the floor over a tree serving S47,
    # the 2026-09-10 receipt lie by a different route. So: install when the
    # worlds differ, OR whenever the decision is advance. A hold that already
    # agrees stays the one-file-read no-op.
    if [ -n "$want" ] && { [ "$want" != "$have" ] || [ "$decision" = "advance" ]; }; then
      say "world: node_modules carries ${have:-nothing}, this build wants $(echo "$want" | cut -c1-8) — installing"
      ( cd "$BUILD" && npm install --no-audit --no-fund --silent "postmark-world@github:postmark-town/postmark-world#$want" ) \
        || die "the world this build decided on would not install"
    fi

    # deploy.yml's verify, WIDENED to the failure that actually happened: a build
    # that silently ships the wrong world is worse than a build that does not
    # ship, and "wrong" now includes a world inherited from an earlier tick that
    # nobody asked for on this one. Prod keeps serving the standing symlink and
    # the next tick tries again. Read from npm's INSTALLED record, because that
    # is the file that answers "what will world-engine-island stage into dist".
    if [ -n "$want" ]; then
      have="$(world_sha_of "$BUILD/node_modules/.package-lock.json")"
      [ "$want" = "$have" ] \
        || die "world pin mismatch — refusing to ship the wrong world: this build decided on $want, node_modules carries ${have:-nothing}"
    fi
  fi

  say "build: astro, release channel"
  ( cd "$BUILD" && PUBLIC_CHANNEL=release PUBLIC_BUILD_SHA="$(git -C "$BUILD" rev-parse HEAD)" npm run build --silent ) \
    || die "the site build tripped"

  # ── the stamp: what this page was built from, in its own bytes ────────────
  # BUILD_TOWN_SHA and BUILD_CROSSING are new (postmark-site
  # jetto/freshness-disclosure); an older stamper ignores them and emits the
  # two-sha stamp it always did. BUILD_TOWN_DATA_SHA keeps naming site main so
  # the sentinel's existing comparison is unchanged during the transition.
  #
  # world_sha (2026-09-08, the night prod served the record-drawn ground): the
  # stamper reads which postmark-world this BUILD tree compiled from the build
  # tree's own package-lock.json — it runs `cd "$BUILD"`, so that is the tree it
  # sees, never the extract tree's floor. BUILD_WORLD_REF is the settlement tag's
  # name when the resolver advanced to one, otherwise empty (unknown, not guessed).
  # An older stamper ignores both, as before.
  if [ -f "$BUILD/tools/build-stamp.mjs" ]; then
    ( cd "$BUILD" && \
      PUBLIC_CHANNEL=release \
      BUILD_CODE_REF="$TAG" \
      BUILD_TOWN_DATA_SHA="$SITE_MAIN" \
      BUILD_TOWN_SHA="$TOWN_SHA" \
      BUILD_CROSSING="$crossing" \
      BUILD_WORLD_REF="$world_ref" \
      node tools/build-stamp.mjs --out dist-town/build.json ) || die "the build stamp tripped"
  fi

  [ -d "$BUILD/dist-town" ] || die "the build produced no dist-town/"

  # ── publish: a whole new release dir, then one rename ─────────────────────
  # A RELEASE DIR IS NEVER REUSED, and that is what makes the swap below atomic
  # rather than nearly atomic. Two publishes inside one second with an unchanged
  # town produce the same timestamp-and-sha name — which happens whenever
  # something OTHER than the town wakes a build (a cut tag, a blessed
  # settlement) right after a town build. Rsyncing into the directory the
  # symlink already points at overwrites LIVE bytes: for the length of that
  # rsync the public site is a half-written tree, which is precisely the
  # stale-over-fresh ordering race the temp-build-then-swap shape exists to
  # prevent. The suffix loop costs nothing and closes it.
  local rel base n link tmplink
  base="$RELEASES/$(date -u +%Y%m%dT%H%M%SZ)-$(echo "$TOWN_SHA" | cut -c1-8)"
  rel="$base"; n=0
  while [ -e "$rel" ]; do n=$((n + 1)); rel="$base.$n"; done
  mkdir -p "$rel"
  rsync -a --delete "$BUILD/dist-town/" "$rel/"

  # ATOMICITY, and why it is a rename and not `ln -sfn`. `ln -sfn` over an
  # existing symlink unlinks and re-links: there is a window, however short, in
  # which the webroot does not exist and nginx answers 404 for everything.
  # `mv -T` is rename(2) — the swap is a single kernel operation and no request
  # can see between the two states. The temp link is created BESIDE the webroot
  # so both are on one filesystem; rename(2) across filesystems is EXDEV.
  link="$WEBROOT"
  tmplink="$(dirname "$link")/.$(basename "$link").next"
  mkdir -p "$(dirname "$link")"
  ln -sfn "$rel" "$tmplink"
  mv -Tf "$tmplink" "$link"
  PUBLISHED="$rel"
  say "published: $link -> $rel ($(du -sh "$rel" | cut -f1))"

  printf '{\n "key": "%s",\n "built_at": "%s",\n "town_sha": "%s",\n "site_main": "%s",\n "release_tag": "%s",\n "release_dir": "%s"\n}\n' \
    "$KEY" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$TOWN_SHA" "$SITE_MAIN" "$TAG" "$rel" > "$STATE"

  # Prune, never the one being served. readlink -f resolves through the symlink
  # we just swapped, so "current" is read from the world rather than remembered.
  local current
  current="$(readlink -f "$link" || true)"
  ls -1dt "$RELEASES"/*/ 2>/dev/null | tail -n +$((KEEP + 1)) | while read -r old; do
    old="${old%/}"
    [ "$old" = "$current" ] && continue
    rm -rf "$old"
  done
}

# ── build, then converge ────────────────────────────────────────────────────
# THE CONVERGENCE RULE. A build takes minutes; the town can move inside them, and
# a ferry crossing is exactly the moment it is most likely to. Publishing a
# snapshot that was already stale when it landed, then sleeping 30 minutes, is
# the same failure this file exists to end — only faster. So after every publish
# the town is re-surveyed against the snapshot just built, and a moved town is
# built again. Bounded by MAX_PASSES because "keep going while the town moves" is
# an unbounded loop in a town that is busy, and a timer that never returns is
# worse than one that lands a minute late; the next tick picks up the remainder.
while :; do
  BUILT_TOWN="$TOWN_SHA"; BUILT_KEY="$KEY"
  build_once
  survey
  if [ "$KEY" = "$BUILT_KEY" ]; then
    report published "converged after $PASSES pass(es) at town $(echo "$BUILT_TOWN" | cut -c1-8)"
    say "converged: nothing moved during the build"
    break
  fi
  if [ "$PASSES" -ge "$MAX_PASSES" ]; then
    report published "published at town $(echo "$BUILT_TOWN" | cut -c1-8); the town moved again mid-build and $MAX_PASSES passes are spent — the next tick takes it"
    say "the town moved again and the pass budget is spent — the next tick converges"
    break
  fi
  say "the town moved during the build ($(echo "$BUILT_TOWN" | cut -c1-8) -> $(echo "$TOWN_SHA" | cut -c1-8)) — building once more"
done

exit 0
