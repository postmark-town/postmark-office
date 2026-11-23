# deploy/uat/lib.sh — the guards every UAT script sources first (CORE-160, CORE-165).
#
# UAT runs a frozen release for a week of testing (Darko, 2026-11-22 21:59 and 22:05 EST: "a separate UAT makes a
# lot of sense"; "keep the prod box under as little load possible from non-resident operations"). It runs on the
# Beelink, town-rig (Darko, 2026-11-23 08:50 EST: "beelink becomes UAT and heavy work runs"), beside the town's meeps,
# capped to prod's size by uat.slice and run by its own system user, `uat`, which is never `meepo`, the meeps' Letta user.
#
# It is prod-shaped on purpose: the repo's own unit files, paths and schedule, so what is tested is what ships. That
# makes two harms plain, and every script refuses both before it does anything:
#   · run on PROD's box, it would point prod's units at UAT's settings;
#   · run as, or for, `meepo` on town-rig, it would hand UAT the meeps' files and keys, or theirs to UAT.

set -euo pipefail

UAT_MARKER=/etc/postmark-uat
UAT_DB=world2_uat
UAT_USER=uat
UAT_SLICE=uat.slice

uat_die() { echo "UAT REFUSED: $*" >&2; exit 1; }
uat_say() { echo "[uat] $*"; }

# Prod's box, named three ways. Any one refuses.
#   1. prod's store is named world2_dev (the name hazard, CORE-160): a box that has it is prod or a copy of it;
#   2. before provisioning only: a live office's access log under /srv/postmark-office/telemetry. After provisioning,
#      UAT's own office writes there, and the marker (which provision.sh writes only after these checks) stands instead;
#   3. prod's private hostname on 2026-11-23 (us-east-2c).
uat_refuse_prod() {
  if command -v psql >/dev/null 2>&1 && sudo -n -u postgres psql -tAc "select 1 from pg_database where datname = 'world2_dev'" 2>/dev/null | grep -q 1; then
    uat_die "this box holds a database named world2_dev, which is prod's store. UAT never runs where prod's store is."
  fi
  if [ ! -f "$UAT_MARKER" ] && ls /srv/postmark-office/telemetry/access-*.jsonl >/dev/null 2>&1; then
    uat_die "/srv/postmark-office/telemetry holds a live office's access logs and this box has no UAT marker. That is prod, or a clone of its disk."
  fi
  case "$(hostname)" in ip-172-31-39-65*) uat_die "hostname $(hostname) is prod's." ;; esac
}

# Every script but provision.sh also needs the marker provision.sh writes.
uat_require_marker() {
  [ -f "$UAT_MARKER" ] || uat_die "$UAT_MARKER is missing: run deploy/uat/provision.sh on this box first (it checks the box is not prod and writes the marker)."
}

uat_require_root() { [ "$(id -u)" = 0 ] || uat_die "run as root (sudo)."; }

# UAT's user is its own: never the meeps' `meepo`, and it must exist (provision.sh makes it).
uat_require_user() {
  [ "$UAT_USER" != meepo ] || uat_die "UAT_USER is meepo, the meeps' Letta user on this box. UAT runs as its own user."
  id "$UAT_USER" >/dev/null 2>&1 || uat_die "no user $UAT_USER: run deploy/uat/provision.sh first."
}
