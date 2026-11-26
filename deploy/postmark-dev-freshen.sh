#!/usr/bin/env bash
# postmark-dev-freshen.sh — the dev channel stands back on the SANDBOX SEED.
#
# RE-AIMED 2026-08-26 (founder-ruled): the dev instance's default state is no
# longer origin/main but the declared snapshot — the sandbox/seed tag PAIR
# (first pair: S47's certified town 830a6996 / world 52c281b8). Advance the
# default by retagging sandbox/seed in both repos. Cadence dropped 10min ->
# nightly so a day's rehearsal is never yanked mid-act; on-demand forget is
# ./sandbox-reset.sh (which also rebuilds the derived DBs and restarts).
#
# The dev office commits acts into its LOCAL clones only (TOWN_PUSH=0; the push
# URL is DISABLED by design). Those local acts are rehearsal, not record. This
# script wipes them and stands both clones back on origin/main, under the dev
# office's own town lock so it never races a pen mid-write. Runs from
# postmark-dev-freshen.timer every 10 minutes.
#
# The world-clone ALSO refreshes draft/* remote-tracking refs (pruned), because
# the signed-in draft-overlay lens reads them — main-only fetching left dev's
# draft lens frozen at clone time (found 2026-08-22, the sketchbook-clean pass).
# Remote-tracking refs only; no local branches, no working-tree change.
#
# Repo copy of record: postmark-office deploy/postmark-dev-freshen.sh
#
# FAILS LOUD (2026-09-22, POS-192). The `set -euo pipefail` above never reached
# the work: everything below runs in the `bash -c` child that flock starts, and
# a child shell does not inherit -e. So when 1,918 root-owned files under
# world-clone and town-clone refused `git reset` (Permission denied), the loop
# carried on, the echo printed "stood back", and the unit exited 0 for as long
# as nobody looked. The child now sets its own `-euo pipefail`: the first failed
# git ends it with git's own exit code, flock returns that code, and exec makes
# it this script's — so the unit reads failed, the roll-call's freshen row sees
# Result=exit-code, and the success line prints only after every step succeeded.
# `switch ... || true` stays tolerated on purpose: the reset after it is the
# stand-back, and it is the step that must not fail silently.
#
# DEV SIGNS WITH ITS OWN KEY (POS-354, Darko 2026-10-07). The seed's ledger is
# prod's, signed with prod's key, and on 10-07 the dev root's stamp-key.pem was
# a byte-identical copy of prod's. So after the stand-back, the town clone is
# moved onto dev's own key (tools/dev-ledger-resign.mjs, from the dev office's
# carried tree): every signed line re-signed, seals unchanged, dev's public key
# installed, committed locally and never pushed. The commit is the same every
# night (fixed author and date, deterministic signatures), so the store's
# town-index head still finds it. It refuses a key whose public half is prod's:
# the seed's own tools/stamp-pubkey.pem, and prod's clone's public key passed as
# --not-key. Prod's PRIVATE key is never read (#453 review, F2). It re-signs only a
# clone whose push URL is disabled, under this root (F1).
# It runs last, so a refusal leaves the clones stood back and the unit failed.
#
# DEV PINS ITS OWN RE-SIGNED TOWN (POS-994; Wright, 2026-11-16). The office runs
# only the town code it pinned (src/town-tool.mjs), and dev's re-sign rewrites
# signatures inside the town's own tools (the ruled exceptions stamp-verify
# names by signature), so a dev clone never equals the office's pins. So dev pins
# its own town, into a folder OUTSIDE the clone, $DEV/town-pins-dev, which every
# dev unit names as TOWN_PINS_DIR (deploy/postmark-office-dev.service.d/
# town-pins.conf, postmark-dev-freshen.service). Three writes, in order:
#   1. the seed, as stood back: the engine the re-sign itself loads;
#   2. after the re-sign (committed), the re-signed town: what dev runs from now on;
#   3. the town's verifier, the pinned copy, over the re-signed ledger. Red puts the
#      clone back on the seed, pins the seed again, and fails the unit, as the
#      re-sign's own --verify used to (it ran before the second pin could exist).
# There is no switch that skips this: an unpinned dev clone stops every pinned step.
# A running office reads its pins once, so the unit restarts the dev office after
# this script exits 0 (postmark-dev-freshen.service § ExecStartPost); the script
# itself restarts nothing, so a failed freshen leaves the dev office as it was.
#
# DEV MAY TRY ONE WORLD (POS-1256). If $DEV/dev-world-ref exists and holds anything
# but whitespace, the WORLD clone (never the town clone) is reset to what it names,
# a full 40-hex sha or refs/tags/<name>, instead of sandbox/seed; an absent or empty
# file is the seed, as before. A sha is fetched by name first, so a head that is no
# branch tip can be named. Any other content stops the unit before a clone is touched.
# The file is meepo-owned and read only here (and by sandbox-reset.sh through this unit);
# prod and UAT never read it. It moves the CLONE only: the dev store's world-law pin and
# graph snapshot follow only by dev-seed-advance.sh steps 6 and 7 (DEPLOY.md § The dev world ref).
#
# POSTMARK_DEV_ROOT, POSTMARK_DEV_FLOCK and the two key paths exist for
# test/box-rollcall.test.mjs only; the unit sets none, so the box runs the
# defaults below.
set -euo pipefail
DEV="${POSTMARK_DEV_ROOT:-/srv/postmark-office-dev}"
FLOCK="${POSTMARK_DEV_FLOCK:-/usr/bin/flock}"
DEV_KEY="${POSTMARK_DEV_STAMP_KEY:-$DEV/stamp-key.pem}"
PROD_PUBKEY="${POSTMARK_PROD_PUBKEY:-/srv/postmark-office/town-clone/tools/stamp-pubkey.pem}"
exec "$FLOCK" -x -w 120 "$DEV/town.lock" bash -c '
  set -euo pipefail
  dev=$1 key=$2 prodpub=$3
  pins="$dev/town-pins-dev"
  export TOWN_PINS_DIR="$pins"
  pin() { node "$dev/tools/town-pins.mjs" --write --town "$dev/town-clone" --ref HEAD --out "$pins"; }
  seed=refs/tags/sandbox/seed
  world_ref=$seed
  if [ -f "$dev/dev-world-ref" ]; then
    want=$(sed "s/^[[:space:]]*//;s/[[:space:]]*$//" < "$dev/dev-world-ref")
    if [ -n "$want" ]; then
      if [[ "$want" =~ ^[0-9a-f]{40}$ ]] || { [[ "$want" =~ ^refs/tags/[A-Za-z0-9._/-]+$ ]] && [[ "$want" != *..* ]]; }; then
        world_ref=$want
      else
        echo "dev-world-ref names $want, which is neither a full sha nor refs/tags/<name>: nothing was reset" >&2
        exit 1
      fi
    fi
  fi
  for c in "$dev/world-clone" "$dev/town-clone"; do
    ref=$seed
    if [ "$c" = "$dev/world-clone" ]; then ref=$world_ref; fi
    git -C "$c" fetch -q --tags --force origin
    if [[ "$ref" =~ ^[0-9a-f]{40}$ ]]; then git -C "$c" fetch -q origin "$ref"; fi
    git -C "$c" switch -q main 2>/dev/null || true
    git -C "$c" reset -q --hard "$ref"
  done
  if [ "$world_ref" != "$seed" ]; then echo "dev world-clone stands on $world_ref, named by $dev/dev-world-ref, not on the seed"; fi
  git -C "$dev/world-clone" fetch -q --prune origin "+refs/heads/draft/*:refs/remotes/origin/draft/*"
  pin
  node "$dev/tools/dev-ledger-resign.mjs" --town "$dev/town-clone" --key "$key" --not-key "$prodpub"
  pin
  if ! node "$dev/src/town-tool.mjs" run stamp-verify.mjs --clone "$dev/town-clone" --; then
    git -C "$dev/town-clone" reset -q --hard refs/tags/sandbox/seed
    pin
    echo "the town verifier is red on the re-signed ledger: the town clone is back on sandbox/seed and pinned as such; nothing re-signed stands" >&2
    exit 1
  fi
  echo "dev clones stood back on sandbox/seed (+ world draft/* refs), the town ledger on the dev key, pinned at $pins"
' freshen "$DEV" "$DEV_KEY" "$PROD_PUBKEY"
