#!/usr/bin/env bash
# deploy/uat/stubs.sh — UAT's remotes are local bare repos, never GitHub's (CORE-160). UNRUN.
#
#   sudo bash deploy/uat/stubs.sh <town-ref> <world-ref>     e.g.  main  settlement/S187
#
# UAT runs its own ferry, crossings and settlements against its copy of the store (the point of UAT: most of
# 2026-11-22's prod failures were exactly there). Those write commits and tags. On prod they go to GitHub; on
# UAT they must go nowhere real. So every repo prod PUSHES to gets a bare stub under /srv/uat-stubs, seeded
# from GitHub once (read-only, public), and the box's clones point their origin at the stub.
#
# Prod's pushed remotes, read from its clones and deploy scripts on 2026-11-23:
#   postmark-town/postmark            the town (the ferry, the mint, the witness)   -> stub, seeded at <town-ref>
#   postmark-town/postmark-world      the world (settlement tags, the sweep)       -> stub, seeded at <world-ref>
#   wright-starforge/postmark-world2-notary   the notary's record (private)         -> stub, EMPTY: UAT's notary
#                                                                                       starts its own history
# Not stubbed because UAT never runs them: the nightly backups (postmark-world2-backups; UAT is a copy, it is
# not backed up). Read-only remotes stay GitHub's: postmark-site (the site refresh pulls the frozen release's
# tag) and postmark-office (the frozen release's code).

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/lib.sh"
uat_require_root
uat_refuse_prod
uat_require_marker

TOWN_REF="${1:?the town ref to seed from, e.g. main}"
WORLD_REF="${2:?the world ref to seed from, e.g. settlement/S187}"
S=/srv/uat-stubs

seed() { # <name> <github url> <ref>
  local name="$1" url="$2" ref="$3" bare="$S/$1.git"
  if [ -d "$bare" ]; then uat_say "$name: stub exists, left as it is"; return; fi
  uat_say "$name: seeding a bare stub from $url at $ref"
  sudo -u meepo git init -q --bare "$bare"
  sudo -u meepo git -C "$bare" fetch -q --tags "$url" "+refs/heads/*:refs/heads/*"
  sudo -u meepo git -C "$bare" rev-parse -q --verify "$ref^{commit}" >/dev/null || uat_die "$name: $ref is not in $url"
  # the stub's default branch stays main; the ref is what the clone below checks out
}

seed postmark https://github.com/postmark-town/postmark.git "$TOWN_REF"
seed postmark-world https://github.com/postmark-town/postmark-world.git "$WORLD_REF"
[ -d "$S/postmark-world2-notary.git" ] || { uat_say "postmark-world2-notary: an empty stub (UAT's notary starts its own record)"; sudo -u meepo git init -q --bare "$S/postmark-world2-notary.git"; }

# The clones prod's units read (TOWN_CLONE and WORLD_CLONE in /etc/postmark-office.env; the env template
# names these same paths). Cloned from the stubs, so `origin` IS the stub and a push lands there.
clone() { # <stub> <path> <ref>
  local stub="$S/$1.git" path="$2" ref="$3"
  if [ -d "$path/.git" ]; then
    local o; o="$(git -C "$path" remote get-url origin)"
    [ "$o" = "$stub" ] || uat_die "$path exists with origin $o, not the stub $stub. Never point a UAT clone at GitHub."
    uat_say "$path: already cloned from its stub"; return
  fi
  sudo -u meepo git clone -q "$stub" "$path"
  sudo -u meepo git -C "$path" checkout -q "$ref"
  uat_say "$path: cloned from $stub at $ref"
}
clone postmark /srv/postmark-office/town-clone "$TOWN_REF"
clone postmark-world /srv/postmark-office/world-clone "$WORLD_REF"

# The last guard: neither pushed clone may reach GitHub, by any remote.
for p in /srv/postmark-office/town-clone /srv/postmark-office/world-clone; do
  if git -C "$p" remote -v | grep -q 'github\.com'; then uat_die "$p has a GitHub remote. UAT's pushed clones point only at /srv/uat-stubs."; fi
done
uat_say "stubs ready under $S"
