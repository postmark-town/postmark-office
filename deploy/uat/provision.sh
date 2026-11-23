#!/usr/bin/env bash
# deploy/uat/provision.sh — a fresh Ubuntu 24.04 machine becomes the UAT box's base (CORE-160). UNRUN.
#
#   sudo bash deploy/uat/provision.sh
#
# Run once, by hand, on a machine launched from a FRESH Ubuntu 24.04 image (never prod's AMI or a snapshot of
# prod's disk: a clone boots with prod's units enabled and prod's credentials in /etc, and its ferry would push
# to the real town before anyone logged in). It installs what prod runs, at prod's versions as read on the box
# 2026-11-23 (Ubuntu 24.04.4, node v22.22.1, PostgreSQL 16.15, nginx 1.24.0), makes the service user, and
# writes the marker the other scripts require. It writes no credential and starts no Postmark unit.
#
# Idempotent: a second run changes nothing it already did.

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/lib.sh"
uat_require_root
uat_refuse_prod

. /etc/os-release
[ "${VERSION_ID:-}" = "24.04" ] || uat_die "this is ${PRETTY_NAME:-an unknown OS}; prod runs Ubuntu 24.04, and UAT is prod-shaped."

uat_say "packages (prod's set)"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q nginx postgresql-16 rsync git jq curl ca-certificates gnupg unzip util-linux

uat_say "node 22 (prod: v22.22.1)"
if ! node --version 2>/dev/null | grep -q '^v22\.'; then
  install -d -m 0755 /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" > /etc/apt/sources.list.d/nodesource.list
  apt-get update -q && apt-get install -y -q nodejs
fi
node --version

uat_say "the AWS CLI (the store's nightly dump is pulled from S3 by store-restore-scrub.sh)"
command -v aws >/dev/null || snap install aws-cli --classic
# a unit's PATH has no /snap/bin (DEPLOY.md § The S3 route, step 2)
[ -e /usr/local/bin/aws ] || ln -s /snap/bin/aws /usr/local/bin/aws

uat_say "the service user and the trees prod's units expect"
id meepo >/dev/null 2>&1 || useradd --create-home --shell /bin/bash meepo
for d in /srv/postmark-office /srv/postmark-site-refresh /srv/uat-stubs /var/www/postmark-town-site /var/www/certbot; do
  install -d -o meepo -g meepo -m 0755 "$d"
done

uat_say "the marker"
{
  echo "This machine is Postmark's UAT box (CORE-160). Provisioned $(date -u +%FT%TZ) by deploy/uat/provision.sh."
  echo "Its store is $UAT_DB. It never pushes to GitHub's town, world, notary or witness repos: its remotes are /srv/uat-stubs."
} > "$UAT_MARKER"
chmod 0644 "$UAT_MARKER"

uat_say "done. Next: deploy/uat/README.md § The order (the stubs, the store, the office, the units, nginx)."
