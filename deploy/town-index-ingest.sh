#!/bin/bash
# town-index-ingest.sh — the town index's runner (POS-268): office.db's tables,
# kept in the store by world2/tools/town-index-ingest.mjs (the law_ingester pen).
#
# Each run: fetch the town, then for every crossing's seal between the index's
# head and origin/main, oldest first, check the seal out and ingest it with
# --snapshot (the law: a snapshot per clearing); then ingest origin/main itself as
# the delta. The tool never moves a checkout, so this script does, in a clone
# that belongs to this script alone.
#
# ── TWO CALLERS, ONE RUN AT A TIME (POS-341) ─────────────────────────────────
# The timer's unit (postmark-town-index.service) runs this every 15 minutes, and
# in store mode the ferry runs it too, between the crossing and the mint
# (deploy/postmark-ferry.service). The pen's advisory lock serialises the two in
# the store, but only inside the tool: the checkout below happens before it, and
# readTown reads the WORKING TREE. A second run checking out another sha under a
# first run's derivation would ingest one commit's files under another's sha. So
# every run holds $WORLD2_STATE_DIR/.town-index.lock from before its first git
# step to its exit, and a run that cannot have it within 300 s exits 2 and
# writes no state (the state file belongs to the run that holds the lock).
#
# ── THE PASSWORD UNDER THE FERRY (POS-341) ──────────────────────────────────
# The timer's unit hands in the whole credential file (EnvironmentFile=). The
# ferry must never have that file: it also carries the owner's password. So the
# ferry's unit loads ONE systemd credential, postmark-law-ingester-password
# (LoadCredential=, from /etc/credstore/), and this reads it from
# $CREDENTIALS_DIRECTORY when the environment has no PG_LAW_INGESTER_PASSWORD.
# The environment still wins, so the timer's path is unchanged.
#
# ── ITS OWN CLONE, WITH HISTORY ──────────────────────────────────────────────
# $WORLD2_LAB/ingest-clones/town-index, a full clone. Not world2-refresh-clone's
# `town` clone: that one is `--depth 1`, and a delta is `git log head..sha`.
# Not the office's TOWN_CLONE either: this never takes the office's town lock.
#
# ── THE SEED IS A HAND STEP ──────────────────────────────────────────────────
# An index with no head exits 3 here and writes nothing. The seed (the one whole
# derivation) is run once by hand at install, as the runbook says:
#   node world2/tools/town-index-ingest.mjs --town-repo "$DIR" --sha "$(git -C "$DIR" rev-parse HEAD)" --seed
#
# Exit 0 ingested (or nothing new) · 1 the pen refused or failed (the reason is in
# $WORLD2_STATE_DIR/town-index.json) · 2 the lane could not run · 3 no head yet.
#
# ── THE SEAL'S AUDIT (POS-523) ───────────────────────────────────────────────
# A delta derives the letters, the threads and the mail ledger from what changed
# only; each seal's --snapshot run derives those four whole, writes any row the
# deltas missed, and prints the count (`· audit {...}`). The state file keeps
# every seal's count from this run as "audits": [{ "sha", "audit" }], until the
# next run; the record keeps it in the seal's town_index_snapshots row
# (digests.audit). A count above zero is a delta that missed a row, written
# back, and worth reading.

set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/world2-lib.sh"

STATE=town-index.json
TOOL="$WORLD2_OFFICE/world2/tools/town-index-ingest.mjs"
DIR="$WORLD2_LAB/ingest-clones/town-index"
URL="https://github.com/postmark-town/postmark.git"

# THE ONE SWITCH (POS-341 part 4). STAMP_LINES lives in /etc/postmark-office.env
# (the ferry and the keep tick read it there), and with it set the quest rows
# fold on the store's key base. The ferry's run inherits it; the timer's unit
# reads the dev env, so this reads that one line from its one home. Unset there,
# unset here, and unsetting it is the rollback.
if [ -z "${STAMP_LINES:-}" ] && [ -r /etc/postmark-office.env ]; then
  STAMP_LINES="$(sed -n 's/^STAMP_LINES=//p' /etc/postmark-office.env | tail -n 1 | tr -d "\"'")"
  export STAMP_LINES
fi

LOCK="$WORLD2_STATE_DIR/.town-index.lock"
if ! { mkdir -p "$WORLD2_STATE_DIR" && exec 9>>"$LOCK"; } 2>/dev/null; then
  echo "[town-index] cannot open $LOCK (is $WORLD2_STATE_DIR writable here?)" >&2
  exit 2
fi
flock -w 300 9
rc=$?
if [ "$rc" -eq 1 ]; then
  echo "[town-index] another run held $LOCK for 300 s; this run did nothing" >&2
  exit 2
elif [ "$rc" -ne 0 ]; then
  echo "[town-index] could not take $LOCK (flock exit $rc); this run did nothing" >&2
  exit 2
fi

CRED="${CREDENTIALS_DIRECTORY:-}/postmark-law-ingester-password"
if [ -z "${PG_LAW_INGESTER_PASSWORD:-}" ] && [ -n "${CREDENTIALS_DIRECTORY:-}" ] && [ -r "$CRED" ]; then
  PG_LAW_INGESTER_PASSWORD="$(tr -d '\r\n' < "$CRED")"   # not exported: w2_pgenv hands it on as PGPASSWORD
fi

if ! w2_pgenv law_ingester PG_LAW_INGESTER_PASSWORD; then
  w2_state "$STATE" '"status":"cannot-run","detail":"PG_LAW_INGESTER_PASSWORD unreadable"'
  exit 2
fi

if [ ! -d "$DIR/.git" ]; then
  mkdir -p "$(dirname "$DIR")"
  git clone --quiet "$URL" "$DIR" || { w2_state "$STATE" '"status":"cannot-run","detail":"first clone failed"'; exit 2; }
fi
git -C "$DIR" fetch --quiet origin main || { w2_state "$STATE" '"status":"cannot-run","detail":"fetch failed"'; exit 2; }
TARGET="$(git -C "$DIR" rev-parse origin/main)"

# stdout is the tool's answer and nothing else; stderr (node's own warnings, a
# stack) goes to its own file and only into a failure's detail. A seal list read
# from 2>&1 once took node's "(node:NNNN) ExperimentalWarning" line for a sha.
ERR="$(mktemp)"
trap 'rm -f "$ERR"' EXIT
detail() { { printf '%s\n' "$1"; tail -n 20 "$ERR"; } | w2_json_escape; }   # a quoted JSON string

seals="$(cd "$WORLD2_OFFICE" && node "$TOOL" --town-repo "$DIR" --seals-to "$TARGET" 2>"$ERR")"
rc=$?
if [ "$rc" -eq 3 ]; then
  echo "[town-index] no head yet — seed it by hand first (this script's header)" >&2
  w2_state "$STATE" '"status":"no-head","detail":"seed by hand first"'
  exit 3
elif [ "$rc" -ne 0 ]; then
  echo "[town-index] could not list the seals (exit $rc): $(tail -n 5 "$ERR")" >&2
  w2_state "$STATE" "\"status\":\"failed\",\"detail\":$(detail "$seals")"
  exit 1
fi

run() {                          # run <sha> [--snapshot]
  git -C "$DIR" checkout --quiet --detach "$1" && git -C "$DIR" clean -qfdx || return 2
  (cd "$WORLD2_OFFICE" && node "$TOOL" --town-repo "$DIR" --sha "$1" "${@:2}" 2>"$ERR")
}

audits=""
for seal in $seals; do
  if ! out="$(run "$seal" --snapshot)"; then
    echo "[town-index] the crossing at $seal did not ingest: $(tail -n 5 "$ERR")" >&2
    w2_state "$STATE" "\"status\":\"failed\",\"at_sha\":\"$seal\",\"detail\":$(detail "$out")"
    exit 1
  fi
  echo "[town-index] $out"
  audit="$(printf '%s' "$out" | sed -n 's/.* · audit \({[^}]*}\).*/\1/p')"
  audits="${audits:+$audits,}{\"sha\":\"$seal\",\"audit\":${audit:-null}}"
done

if ! out="$(run "$TARGET")"; then
  echo "[town-index] the delta to $TARGET did not ingest: $(tail -n 5 "$ERR")" >&2
  w2_state "$STATE" "\"status\":\"failed\",\"at_sha\":\"$TARGET\",\"detail\":$(detail "$out")"
  exit 1
fi
echo "[town-index] $out"
w2_state "$STATE" "\"status\":\"ok\",\"sha\":\"$TARGET\",\"audits\":[$audits],\"detail\":$(printf '%s' "$out" | w2_json_escape)"
