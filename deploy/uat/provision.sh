#!/usr/bin/env bash
# deploy/uat/provision.sh — town-rig (the Beelink) gets UAT's base beside the meeps (CORE-165).
#
#   sudo bash deploy/uat/provision.sh
#
# Run once, by hand, on town-rig (Ubuntu 24.04.5, 16 cores, 27 GB). The town's meeps already live there: Letta's
# server runs as `meepo` on /usr/local/bin/node (v25). UAT must touch none of that. So this:
#   · installs what prod runs, at prod's versions as read on prod 2026-11-23 (node v22.22.1, PostgreSQL 16.15,
#     nginx 1.24.0). Node 22 goes to /usr/bin/node from NodeSource; /usr/local/bin/node (the meeps' v25) is left
#     exactly as it is, and UAT's units pin PATH to /usr/bin first (units.sh);
#   · makes UAT's own system user, `uat`: not in meepo's group, with no right to meepo's home (750, rei's ACL only);
#   · installs uat.slice (4 cores, 16 GB: prod's size, which is also the meeps' protection) and puts Postgres and
#     nginx inside it, since only UAT uses them here;
#   · writes the marker the other scripts require.
# It writes no credential and starts no Postmark unit. Idempotent: a second run changes nothing it already did.

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/lib.sh"
uat_require_root
uat_refuse_prod

. /etc/os-release
[ "${VERSION_ID:-}" = "24.04" ] || uat_die "this is ${PRETTY_NAME:-an unknown OS}; prod runs Ubuntu 24.04, and UAT is prod-shaped."
[ "$UAT_USER" != meepo ] || uat_die "UAT_USER is meepo, the meeps' Letta user here."

uat_say "the slice first, so Postgres and nginx start inside it"
install -m 0644 "$HERE/uat.slice" /etc/systemd/system/uat.slice
for svc in postgresql@16-main nginx; do
  install -d /etc/systemd/system/$svc.service.d
  printf '[Service]\nSlice=%s\n' "$UAT_SLICE" > /etc/systemd/system/$svc.service.d/uat-slice.conf
done
systemctl daemon-reload

uat_say "packages (prod's set)"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q nginx postgresql-16 rsync git jq curl ca-certificates gnupg unzip util-linux
# nginx's default site listens on every address; UAT is reached only through the Cloudflare tunnel (nginx-uat.sh)
rm -f /etc/nginx/sites-enabled/default

uat_say "node 22 at /usr/bin/node (prod: v22.22.1); the meeps' /usr/local/bin/node is not touched"
if ! /usr/bin/node --version 2>/dev/null | grep -q '^v22\.'; then
  install -d -m 0755 /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" > /etc/apt/sources.list.d/nodesource.list
  apt-get update -q && apt-get install -y -q nodejs
fi
/usr/bin/node --version
[ -x /usr/local/bin/node ] && uat_say "the meeps' node stays: /usr/local/bin/node $(/usr/local/bin/node --version)"

uat_say "the AWS CLI (store-restore-scrub.sh reads the nightly dump with UAT's own read-only key)"
command -v aws >/dev/null || snap install aws-cli --classic
[ -e /usr/local/bin/aws ] || ln -s /snap/bin/aws /usr/local/bin/aws

uat_say "UAT's own user, and the trees prod's units expect, all its own"
id "$UAT_USER" >/dev/null 2>&1 || useradd --system --create-home --home-dir /home/$UAT_USER --shell /bin/bash "$UAT_USER"
if id -nG "$UAT_USER" | tr ' ' '\n' | grep -qx meepo; then uat_die "$UAT_USER is in meepo's group; it must not be."; fi
for d in /srv/postmark-office /srv/postmark-site-refresh /srv/uat-stubs /srv/world2-lab /srv/world2-lab/ops \
         /srv/postmark-harbor /srv/postmark-sentinel /var/www/postmark-panes /var/www/postmark-ops; do
  install -d -o "$UAT_USER" -g "$UAT_USER" -m 0755 "$d"
done
# /var/www is the office user's on prod (meepo there, uat here): the site refresh makes .postmark-town-site.next
# BESIDE the webroot and renames that symlink over it, so /var/www/postmark-town-site must NOT exist as a directory.
chown "$UAT_USER":root /var/www
# uat's git identity, as prod's meepo has its own (~/.gitconfig): the ferry's town tools commit with it, and
# with none git refuses ("unable to auto-detect email address", 2026-11-24 00:00Z). Never a real address: UAT
# pushes only to its stubs.
sudo -u "$UAT_USER" -H git config --global user.name "uat (postmark UAT box)"
sudo -u "$UAT_USER" -H git config --global user.email "uat@uat.postmark.town.invalid"
[ -d /var/www/postmark-town-site ] && [ ! -L /var/www/postmark-town-site ] && rmdir /var/www/postmark-town-site 2>/dev/null || true
# the meeps' home stays closed to UAT (750, and only rei's ACL besides): say so rather than assume it
if sudo -n -u "$UAT_USER" test -r /home/meepo 2>/dev/null; then uat_die "$UAT_USER can read /home/meepo; close it before going on."; fi

uat_say "the marker"
{
  echo "This machine runs Postmark's UAT (CORE-165) beside the town's meeps: town-rig. Provisioned $(date -u +%FT%TZ) by deploy/uat/provision.sh."
  echo "UAT runs as $UAT_USER inside $UAT_SLICE (4 cores, 16 GB). Its store is $UAT_DB. It never pushes to GitHub: its remotes are /srv/uat-stubs."
} > "$UAT_MARKER"
chmod 0644 "$UAT_MARKER"

uat_say "done. Next: deploy/uat/README.md § The order."
