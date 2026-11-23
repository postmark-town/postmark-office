# deploy/uat/lib.sh — the guards every UAT script sources first (CORE-160).
#
# UAT is a separate machine that runs a frozen release for a week of testing (Darko, 2026-11-22 21:59 and
# 22:05 EST: "a separate UAT makes a lot of sense"; "keep the prod box under as little load possible from
# non-resident operations"). It is prod-shaped on purpose: the repo's own unit files, paths and ports, so
# what is tested is what ships. That makes the one way this kit can do harm plain: run on PROD's box, it
# would point prod's units at UAT's settings. So every script here refuses prod three ways, before anything.

set -euo pipefail

UAT_MARKER=/etc/postmark-uat
UAT_DB=world2_uat

uat_die() { echo "UAT REFUSED: $*" >&2; exit 1; }
uat_say() { echo "[uat] $*"; }

# Prod's box, named three ways. Any one refuses.
#   1. prod's store is named world2_dev (the name hazard, CORE-160): a box that has it is prod or a copy of it;
#   2. prod's live office writes its access log under /srv/postmark-office/telemetry;
#   3. prod's private hostname on 2026-11-23 (us-east-2c).
uat_refuse_prod() {
  if command -v psql >/dev/null 2>&1 && sudo -n -u postgres psql -tAc "select 1 from pg_database where datname = 'world2_dev'" 2>/dev/null | grep -q 1; then
    uat_die "this box holds a database named world2_dev, which is prod's store. UAT never runs where prod's store is."
  fi
  if ls /srv/postmark-office/telemetry/access-*.jsonl >/dev/null 2>&1; then
    uat_die "/srv/postmark-office/telemetry holds a live office's access logs. That is prod (or a clone of its disk): launch UAT from a fresh Ubuntu 24.04 image, never from prod's AMI or snapshot."
  fi
  case "$(hostname)" in ip-172-31-39-65*) uat_die "hostname $(hostname) is prod's." ;; esac
}

# Every script but provision.sh also needs the marker provision.sh writes.
uat_require_marker() {
  [ -f "$UAT_MARKER" ] || uat_die "$UAT_MARKER is missing: run deploy/uat/provision.sh on this box first (it checks the box is not prod and writes the marker)."
}

uat_require_root() { [ "$(id -u)" = 0 ] || uat_die "run as root (sudo)."; }
