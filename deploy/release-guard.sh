#!/usr/bin/env bash
# release-guard.sh — the release train's rollback guard (POS-971), the runner's half.
#
# On 2026-11-09 at 01:28Z a release tag was cut by hand at an old commit
# (4a823b9f, main from before w46) and pushed. The tag push deployed it, and prod
# ran pre-w46 code for about 1m10s until w46.1 was redeployed by
# workflow_dispatch. This refuses that: a pushed release deploys only if it
# descends from the commit prod runs now. Going back is a person's act, by
# workflow_dispatch, and .github/workflows/release-train.yml does not run this
# guard for a dispatch.
#
# This half runs from the tag's own workflow file, so a tag cut before it
# existed never runs it. Those are stopped on the box: remote-deploy.sh is taken
# from main by every version of the workflow, and its preflight refuses a caller
# that does not name the commit it brings.
#
# USAGE (from a full checkout: fetch-depth 0, tags included)
#   release-guard.sh <candidate-sha> <live-sha-or-empty>
#
#   passes   the live commit is the candidate or one of its ancestors
#   refuses  it is not: deploying the candidate would roll prod back, or across
#            to a line prod never ran
#
# When the live sha is empty (prod's /release could not be read) or names a
# commit this repository does not hold, the guard measures against the newest
# release/* tag whose commit is not the candidate's own. With neither it passes
# with a notice: there is nothing to measure against, and refusing would strand
# the first deploy.
#
# Exit 0 passes · 1 refuses · 2 cannot run.

set -euo pipefail

CANDIDATE_IN="${1:-}"
LIVE_IN="${2:-}"
[ -n "$CANDIDATE_IN" ] || { echo "usage: release-guard.sh <candidate-sha> <live-sha-or-empty>" >&2; exit 2; }

commit_of() { git rev-parse -q --verify "$1^{commit}" 2>/dev/null; }

CANDIDATE="$(commit_of "$CANDIDATE_IN")" \
  || { echo "::error::the rollback guard (POS-971) cannot run: the candidate $CANDIDATE_IN is not a commit in this checkout" >&2; exit 2; }
NAMES="$(git tag --points-at "$CANDIDATE" -l 'release/*' | paste -sd, -)"
WHAT="${NAMES:+$NAMES @ }$CANDIDATE"

BASE=""
BASE_NAME=""
if [ -n "$LIVE_IN" ]; then
  if BASE="$(commit_of "$LIVE_IN")"; then
    BASE_NAME="the commit prod runs"
  else
    BASE=""
    echo "::notice::prod reports $LIVE_IN, which is not a commit in this repository; the guard measures against the newest release tag instead"
  fi
else
  echo "::notice::prod's live commit could not be read; the guard measures against the newest release tag instead"
fi

if [ -z "$BASE" ]; then
  while read -r t; do
    [ -n "$t" ] || continue
    c="$(commit_of "refs/tags/$t")" || continue
    [ "$c" = "$CANDIDATE" ] && continue
    BASE="$c"
    BASE_NAME="$t, the newest other release tag"
    break
  done < <(git tag -l 'release/*' --sort=-creatordate)
fi

if [ -z "$BASE" ]; then
  echo "::notice::the rollback guard (POS-971) has no live commit and no other release tag to measure $WHAT against; it passes"
  exit 0
fi

set +e
git merge-base --is-ancestor "$BASE" "$CANDIDATE"
rc=$?
set -e

case "$rc" in
  0)
    echo "rollback guard (POS-971): $WHAT descends from $BASE_NAME ($BASE); it moves prod forward"
    exit 0
    ;;
  1)
    echo "::error::the rollback guard (POS-971) refuses $WHAT: it is not a descendant of $BASE_NAME ($BASE), so deploying it would roll prod back or across to another line. To go back on purpose, run this workflow by workflow_dispatch from main with the tag named."
    exit 1
    ;;
  *)
    echo "::error::the rollback guard (POS-971) cannot run: git merge-base --is-ancestor $BASE $CANDIDATE exited $rc" >&2
    exit 2
    ;;
esac
