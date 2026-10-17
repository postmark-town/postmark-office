#!/bin/sh
# office-world-hydrate.sh — the world hydration the keeping tick runs: the world
# graph snapshot per settlement in the store (037/038), at the newest blessing.
# world.db is retired (POS-270 lane W 3b, office #294): the office reads this
# snapshot and nothing else.
#
# It moved here from deploy/office-rehydrate.sh when the rehydrate unit was
# retired (POS-268 part 5b, 2026-10-08). That unit's other two jobs went with
# it: the office.db rebuild (nothing reads office.db once the office runs
# TOWN_INDEX_READS=store; the town index is the store's, kept by
# postmark-town-index.timer) and the door's as-of receipt (the as-of is the
# store's now). This step is the one the rehydrate did that something still
# reads, so deploy/office-keep.sh runs it, after the settlements row, from the
# world clone it fetched a few seconds earlier.
#
# AT THE NEWEST BLESSING, never main (Keemin, 2026-09-18, postmark#2934:
# "shouldn't the bless override the tick?" — yes). The crossing commits its
# candidate to main and the keeping tick's fetch carries it in; the keeper's
# `settlement/S<n>` tag is his judgment on it, and a refused crossing is never
# tagged. `--ref blessed` resolves the newest tag peeled to its commit
# (src/world-branches.mjs § blessed — the same resolution the fold serves, so
# store and fold agree), and the store stamps `as_of_settlement` /
# `candidate_ahead` for the doors. Never HEAD — the pen parks this clone on
# draft branches, and a draft-stamped store can never be eligible.
#
# THE STORE IS THE ONLY OUTPUT. The write connects as the law pen
# (deploy/world2-lib.sh § w2_pgenv — sed-read, never sourced; bash, for the
# lib). It exits with the hydration's own code (4: the credential unreadable)
# and says loudly which way it went; the keeping tick records it as its `world`
# step and never fails on it (review-593 c). A miss (the store refused or
# unreachable, or the credential unreadable) leaves the office on the snapshot
# it already has.
#
# Env: WORLD_CLONE (the keep unit's), and PG_LAW_INGESTER_PASSWORD, handed to
# this script alone by deploy/office-keep.sh, which takes it from
# /etc/postmark-world2-dev.env (root:root 0600, read by systemd; meepo never
# opens it) and unsets every store password before the tick's other children.
# Cwd: /srv/postmark-office (the unit's WorkingDirectory).

set -u

WORLD_RC=0
bash -c '
  . deploy/world2-lib.sh
  w2_pgenv law_ingester PG_LAW_INGESTER_PASSWORD || exit 4
  exec node src/world-hydrate.mjs --world "$WORLD_CLONE" --ref blessed --to-store' || WORLD_RC=$?
case "$WORLD_RC" in
  0) echo "[office-keep] the world graph snapshot written to the store" ;;
  4) echo "[office-keep] WORLD STORE NOT WRITTEN (non-fatal) — the law pen's credential is unreadable (PG_LAW_INGESTER_PASSWORD, /etc/postmark-world2-dev.env); the office keeps reading the snapshot it has" >&2 ;;
  *) echo "[office-keep] WORLD STORE NOT WRITTEN (non-fatal, exit $WORLD_RC) — the reason is in the hydrate's stderr above; the office keeps reading the snapshot it has" >&2 ;;
esac
exit "$WORLD_RC"
