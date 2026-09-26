#!/bin/bash
# world2-rehearse.sh — ONE COMMAND: a fresh copy of prod's store, a train's
# migrations on it, and the next window's clearing (POS-242 parts 1-2).
#
#   world2-rehearse.sh <train ref> [--arm <sql file>] [--no-copy] [--no-clear]
#
#     <train ref>   a branch or sha of postmark-town/postmark-office, e.g.
#                   train/2026-w40. Its migrations and its clearing are what run.
#     --arm <sql>   applied to the copy, as its owner, AFTER the migrations and
#                   BEFORE the clearing — the falsifier's door
#                   (world2/tools/rehearsal-falsifier-212.sql).
#     --no-copy     reuse the copy as it stands (a second clearing on it).
#     --no-clear    migrations only.
#
# Everything lives under $REHEARSAL_DIR (/srv/world2-lab/rehearsal, 0700):
#   tree/    the office at <train ref> — the code under test
#   town/    world/   the checkouts the clearing reads (its stamp-ingest first
#                     step, and the parcel cap), at their origin's main — the
#                     same refresh the clearing lane does, into its OWN clones.
#                     First made from the lab's ingest clones (a local read),
#                     then fetched from GitHub; the live lane's clones are never
#                     checked out, fetched or cleaned from here.
#   receipt-<utc>.json   the runner's receipt, kept.
# The runner is THIS checkout's `world2/tools/rehearse.mjs`, not the tree's —
# so a train that predates the runner can still be rehearsed.
#
# NOTHING HERE WRITES OUTSIDE $REHEARSAL_DIR AND THE COPY. No state file (the
# roll-call does not know this lane and must not be told it ran), no push, no
# issue, no unit. The one network write is none: every git operation is a
# clone or a fetch.

set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNNER_ROOT="$(cd "$HERE/.." && pwd)"
REHEARSAL_DIR="${REHEARSAL_DIR:-/srv/world2-lab/rehearsal}"
LAB="${WORLD2_LAB:-/srv/world2-lab}"
DB="world2_rehearsal"

REF=""; ARM=""; COPY=true; CLEAR=true
while [ $# -gt 0 ]; do
  case "$1" in
    --arm) ARM="${2:-}"; shift 2 ;;
    --no-copy) COPY=false; shift ;;
    --no-clear) CLEAR=false; shift ;;
    -*) echo "unknown flag $1" >&2; exit 2 ;;
    *) REF="$1"; shift ;;
  esac
done
[ -n "$REF" ] || { echo "usage: world2-rehearse.sh <train ref> [--arm <sql>] [--no-copy] [--no-clear]" >&2; exit 2; }
[ -z "$ARM" ] || [ -f "$ARM" ] || { echo "--arm: no such file $ARM" >&2; exit 2; }

mkdir -p "$REHEARSAL_DIR" && chmod 0700 "$REHEARSAL_DIR" || exit 1
say() { printf '%s\n' "$*"; }

# ── the tree under test ─────────────────────────────────────────────────────
T="$REHEARSAL_DIR/tree"
if [ ! -d "$T/.git" ]; then
  git clone -q https://github.com/postmark-town/postmark-office.git "$T" || exit 1
fi
git -C "$T" fetch -q origin "$REF" || { echo "cannot fetch $REF" >&2; exit 1; }
git -C "$T" checkout -q --detach FETCH_HEAD || exit 1
git -C "$T" clean -qfdx -e node_modules || exit 1
( cd "$T" && npm ci --omit=dev --no-audit --no-fund --silent ) || { echo "npm ci failed in the tree" >&2; exit 1; }
say "== tree: $REF = $(git -C "$T" rev-parse HEAD)"

# ── the town and world checkouts the clearing reads ─────────────────────────
for r in town world; do
  case "$r" in
    town)  URL="https://github.com/postmark-town/postmark.git" ;;
    world) URL="https://github.com/postmark-town/postmark-world.git" ;;
  esac
  D="$REHEARSAL_DIR/$r"
  if [ ! -d "$D/.git" ]; then
    git clone -q --depth 1 "file://$LAB/ingest-clones/$r" "$D" || exit 1
    git -C "$D" remote set-url origin "$URL"
  fi
  git -C "$D" fetch -q --depth 1 origin main || { echo "cannot fetch $r" >&2; exit 1; }
  git -C "$D" reset -q --hard FETCH_HEAD && git -C "$D" clean -qfdx || exit 1
  say "== $r: $(git -C "$D" rev-parse HEAD)"
done

# ── the copy ────────────────────────────────────────────────────────────────
if [ "$COPY" = true ]; then
  REHEARSAL_DIR="$REHEARSAL_DIR" bash "$HERE/world2-rehearsal-copy.sh" --target "$DB" || exit 1
fi

# ── the runner ──────────────────────────────────────────────────────────────
RECEIPT="$REHEARSAL_DIR/receipt-$(date -u +%Y%m%dT%H%M%SZ).json"
ARGS=(--tree "$T" --db "$DB" --password-file "$REHEARSAL_DIR/runner.pw"
      --town-repo "$REHEARSAL_DIR/town" --world-repo "$REHEARSAL_DIR/world" --json "$RECEIPT")
[ -n "$ARM" ] && ARGS+=(--arm "$ARM")
[ "$CLEAR" = true ] || ARGS+=(--no-clear)
( cd "$RUNNER_ROOT" && env -i PATH="$PATH" HOME="${HOME:-/tmp}" node world2/tools/rehearse.mjs "${ARGS[@]}" )
rc=$?
say "== receipt kept: $RECEIPT"
exit "$rc"
