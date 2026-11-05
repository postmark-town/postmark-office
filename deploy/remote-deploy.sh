#!/usr/bin/env bash
# remote-deploy.sh — the box-side half of the office's auto-deploy (POS-60).
#
# Runs ON THE BOX, as the deploy user, invoked over ssh by
# .github/workflows/release-train.yml. It never fetches, clones or checks out:
# the code arrives by rsync from the runner, which has already checked out the
# release tag. This script only installs deps if the lockfile moved, restarts the
# service, and then PROVES the restart served the new code.
#
# ─────────────────────────────────────────────────────────────────────────────
# THE LAWS THIS SCRIPT IS BUILT FROM, quoted so a later reader can check it
# against them rather than against my summary of them.
#
# deploy/DEPLOY.md, the live-truth note (2026-07-19):
#
#   "the box's `/srv/postmark-office` is a plain file copy, NOT the git clone
#    step 1 below describes — a code deploy is
#    `scp src/<changed>.mjs meepo-ec2:/srv/postmark-office/src/` +
#    `sudo systemctl restart postmark-office`, then probe a route whose response
#    only the new code produces (a restart alone proves nothing)."
#
# deploy/DEPLOY.md § The one-hand rule (2026-08-20):
#
#   "meepo is the only hand that touches `/srv/postmark-office`. Root never
#    writes there — not a file, and NEVER git."
#   "A deploy scp that bounces on permissions is fixed by `chown`, never by
#    escalating the deploy to sudo."
#
# That pair is why the file copy runs as the deploy user with no sudo anywhere
# near it, while `systemctl restart` — which is not a write to /srv — uses
# `sudo -n`. The `-n` is deliberate: without it a box that wants a password
# HANGS the deploy until the job times out, and a deploy that hangs reads as a
# slow deploy rather than a broken one. `-n` makes it fail in a second, loudly.
#
# deploy/DEPLOY.md § Notes (2026-08-11):
#
#   "A restart is now for code deploys only; data flows by hot-reload."
#
# which is why nothing here touches town-clone/, world-clone*/, office.db or any
# other derived state. The rehydrate timer owns the data tense; this owns code.
#
# OPERATIONS.md § Deploys (founder-ruled 2026-08-26):
#
#   "code moves on trains; the record is never promoted — it is either alive
#    (prod) or certified-frozen (dev)."
#
# ─────────────────────────────────────────────────────────────────────────────
# USAGE
#   remote-deploy.sh preflight <root> <service> <port>
#   remote-deploy.sh apply     <root> <service> <port> <tag> <sha>
#
# Preflight runs BEFORE the rsync on purpose. Every reason a deploy can fail for
# permissions is knowable before a single byte is copied, and finding out
# afterwards is how you end up with new code on disk and the old process serving
# it — the one state worse than not deploying at all.

set -euo pipefail

MODE="${1:?mode required: preflight|apply}"
ROOT="${2:?office root required}"
SERVICE="${3:?service name required}"
PORT="${4:?loopback port required}"

die() { echo "DEPLOY FAILED: $*" >&2; exit 1; }
say() { echo "  $*"; }

# ── preflight ────────────────────────────────────────────────────────────────
if [ "$MODE" = "preflight" ]; then
  echo "== preflight: $SERVICE at $ROOT (loopback :$PORT) =="

  [ -d "$ROOT" ] || die "$ROOT does not exist on this box. This deploy does not create an office; the one-time setup in deploy/DEPLOY.md does."
  [ -d "$ROOT/src" ] || die "$ROOT/src is missing — this does not look like an office tree."

  # The one-hand rule, checked rather than assumed: the deploy user must own the
  # tree outright. If this fails the fix is `chown`, never `sudo rsync`.
  probe="$ROOT/.deploy-write-probe.$$"
  if ! touch "$probe" 2>/dev/null; then
    die "$ROOT is not writable as $(whoami). DEPLOY.md § The one-hand rule: 'A deploy scp that bounces on permissions is fixed by chown, never by escalating the deploy to sudo.' Run: sudo chown -R $(whoami) $ROOT"
  fi
  rm -f "$probe"
  say "writable as $(whoami) — the one hand"

  command -v node >/dev/null || die "node is not on PATH for $(whoami)"
  command -v curl >/dev/null || die "curl is not on PATH for $(whoami)"
  say "node $(node --version), curl present"

  # Passwordless sudo for THIS unit only is all that is needed. `-n` never prompts.
  sudo -n systemctl show "$SERVICE" -p ActiveEnterTimestamp >/dev/null 2>&1 \
    || die "\`sudo -n systemctl show $SERVICE\` failed. The deploy needs passwordless sudo for systemctl on this unit. Without it the restart cannot happen and the deploy would leave new code under the old process."
  say "passwordless sudo for systemctl: yes"

  systemctl is-active --quiet "$SERVICE" \
    || die "$SERVICE is not active right now. Deploying onto a stopped office would make the probe's failure ambiguous — start it, or fix why it is down, first."
  say "$SERVICE is active"

  # DEPLOY.md's live-truth note (2026-07-19) says the box's office "is a plain
  # file copy, NOT the git clone step 1 below describes". If a .git turns up
  # here, that premise has stopped holding for this root and an rsync will leave
  # the checkout dirty — recoverable, not destructive, but nobody should find out
  # by surprise. Warn rather than fail: the copy is still safe, and refusing
  # would strand a deploy over a condition the operator may already know about.
  #
  # This fires loudest for /srv/postmark-office-dev, whose code-update mechanism
  # is documented NOWHERE in this repo — DEPLOY.md says only "deploy dev src from
  # the train tip" without saying how, so whether dev is a copy or a checkout is
  # genuinely unknown until this line answers it.
  if [ -e "$ROOT/.git" ]; then
    echo "  WARNING: $ROOT is a git checkout, not a plain file copy."
    echo "           The deploy will rsync over it and leave the working tree dirty."
    echo "           Nothing is destroyed; \`git -C $ROOT status\` will show the drift."
    echo "           If this root is meant to be updated by git, this deploy is the wrong hand for it."
  fi

  if [ -f "$ROOT/release.json" ]; then
    say "currently deployed: $(node -e 'const s=require(process.argv[1]);console.log(`${s.tag} @ ${String(s.sha).slice(0,12)} (${s.target||"?"}, ${s.deployed_at||"?"})`)' "$ROOT/release.json" 2>/dev/null || echo "release.json present but unreadable")"
  else
    say "currently deployed: UNSTAMPED (placed by hand — this will be the first train-carried deploy)"
  fi

  echo "== preflight OK =="
  exit 0
fi

[ "$MODE" = "apply" ] || die "unknown mode '$MODE' (expected preflight|apply)"

TAG="${5:?tag required}"
SHA="${6:?sha required}"

echo "== deploy: $TAG @ ${SHA:0:12} -> $SERVICE at $ROOT =="
cd "$ROOT"

# ── 1. the rsync landed ──────────────────────────────────────────────────────
# Checked before the restart, so a torn or partial copy is caught while the old
# process is still happily serving rather than after it has been bounced.
[ -f release.json ] || die "release.json is not on the box — the rsync did not land."
node -e '
  const s = require("./release.json");
  const [tag, sha] = process.argv.slice(1);
  if (s.tag !== tag || s.sha !== sha) {
    console.error(`stamp on disk says ${s.tag} @ ${s.sha}, expected ${tag} @ ${sha}`);
    process.exit(1);
  }
' "$TAG" "$SHA" || die "the release stamp on the box does not match what this run shipped."
say "stamp on disk matches the run"

# ── 2. dependencies, only if the lockfile actually moved ─────────────────────
# `npm ci` deletes node_modules and rebuilds it. Doing that on every deploy would
# put the prod office through a needless teardown for a one-line src change, so
# it runs only when the lock's content hash differs from the marker left by the
# last install.
#
# NO MARKER + an existing node_modules = ADOPT, do not reinstall. This box has
# been serving the town for months; its node_modules is correct by demonstration,
# and the first auto-deploy is the wrong moment to find out otherwise. If the
# install is in fact wrong, the probe below fails loudly and nothing is hidden.
MARKER="node_modules/.postmark-lock-sha"
LOCK_SHA="$(sha256sum package-lock.json | cut -d' ' -f1)"
if [ ! -d node_modules ]; then
  say "no node_modules — installing"
  npm ci --omit=dev --no-audit --no-fund
  echo "$LOCK_SHA" > "$MARKER"
elif [ ! -f "$MARKER" ]; then
  say "no lock marker — adopting the box's existing node_modules without reinstalling (see the comment in this script)"
  echo "$LOCK_SHA" > "$MARKER"
elif [ "$(cat "$MARKER")" != "$LOCK_SHA" ]; then
  say "package-lock.json moved — reinstalling"
  npm ci --omit=dev --no-audit --no-fund
  echo "$LOCK_SHA" > "$MARKER"
else
  say "package-lock.json unchanged — node_modules left alone"
fi

# ── 3. restart ───────────────────────────────────────────────────────────────
BEFORE="$(sudo -n systemctl show "$SERVICE" -p ActiveEnterTimestamp --value)"
say "was up since: ${BEFORE:-<unknown>}"

sudo -n systemctl restart "$SERVICE" || die "systemctl restart $SERVICE failed."

# ── 4. the probe that only the new code passes ───────────────────────────────
# DEPLOY.md: "probe a route whose response only the new code produces (a restart
# alone proves nothing)". GET /release is that route — src/release.mjs reads the
# stamp ONCE at boot, so an answer carrying this run's tag and sha can only come
# from a process that started after this run's rsync. See test/release-door.test.mjs,
# whose load-bearing case pins exactly that (rewriting the stamp under a live
# office must NOT change the answer).
say "probing http://127.0.0.1:$PORT/release for $TAG @ ${SHA:0:12}"
deadline=$(( $(date +%s) + 90 ))
served=""
while [ "$(date +%s)" -lt "$deadline" ]; do
  if body="$(curl -fsS --max-time 5 "http://127.0.0.1:$PORT/release" 2>/dev/null)"; then
    if printf '%s' "$body" | node -e '
      let raw = "";
      process.stdin.on("data", (d) => { raw += d; });
      process.stdin.on("end", () => {
        const [tag, sha] = process.argv.slice(1);
        let s; try { s = JSON.parse(raw); } catch { process.exit(1); }
        process.exit(s.deployed === true && s.tag === tag && s.sha === sha ? 0 : 1);
      });
    ' "$TAG" "$SHA"; then
      served="$body"
      break
    fi
  fi
  sleep 2
done

[ -n "$served" ] || die "after 90s the office at :$PORT is still not serving $TAG @ ${SHA:0:12}. Last answer: $(curl -fsS --max-time 5 "http://127.0.0.1:$PORT/release" 2>&1 | head -c 400). The bytes are on disk; the process is not serving them. Check: journalctl -u $SERVICE -n 50"
say "the door reports the new release"

# ── 5. the restart really happened ───────────────────────────────────────────
# Belt to the probe's braces, and it catches the one case the probe cannot: a
# unit that answers correctly because something else restarted it. If this ever
# fails while the probe passed, do not paper over it — the two receipts have
# stopped agreeing and one of them is lying.
AFTER="$(sudo -n systemctl show "$SERVICE" -p ActiveEnterTimestamp --value)"
[ "$AFTER" != "$BEFORE" ] || die "$SERVICE reports the same ActiveEnterTimestamp ($AFTER) before and after the restart — it did not actually bounce."
say "up since: $AFTER (moved)"

systemctl is-active --quiet "$SERVICE" || die "$SERVICE is not active after the restart."

# ── 6. the town's own door still answers ─────────────────────────────────────
# The release probe proves the new code booted; this proves it can still do the
# job. /town is the read the whole site is built on, and DEPLOY.md's own smoke.
# A cold start's first /town takes 30–40 s to warm (STAR-130: w45.6 on 11-05 booted
# at 03:29:47, its first request lines came at 03:30:29, and the old single 10 s try
# failed a healthy office). So the probe tries every 5 s, each try given 20 s, until
# 75 s have passed; a door that never answers in that time still fails, as before.
# test/remote-deploy-town-probe.test.mjs runs this function with a stand-in curl.
town_answers() { # <port> <window seconds> <seconds per try>
  local port=$1 window=$2 per=$3 deadline=$(( $(date +%s) + $2 ))
  while :; do
    curl -fsS --max-time "$per" "http://127.0.0.1:$port/town" >/dev/null 2>&1 && return 0
    [ "$(date +%s)" -lt "$deadline" ] || return 1
    sleep "${TOWN_PROBE_PAUSE:-5}" # the test shortens the pause; the box never sets it
  done
}
town_answers "$PORT" 75 20 \
  || die "$SERVICE booted the new release but GET /town does not answer (75 s of tries, 20 s each). The office is up and broken — this is the state to roll back from (deploy/DEPLOY.md: 'Rollback: systemctl stop postmark-office')."
say "GET /town answers"

echo "== deployed $TAG @ ${SHA:0:12} to $SERVICE =="
printf '%s\n' "$served"
