#!/usr/bin/env bash
# deploy/uat/tunnel.sh — uat.postmark.town reaches town-rig through a Cloudflare tunnel (CORE-165).
#
#   sudo bash deploy/uat/tunnel.sh /path/to/tunnel-token-file
#
# Darko made the tunnel and its Access application in Cloudflare (his step). Its public hostname, uat.postmark.town,
# points at http://localhost:8080 (nginx-uat.sh). This installs the connector without the token ever reaching a
# command line, a process list or a log. `cloudflared service install <token>` would put it on a command line, so:
# the token file's one line goes, as TUNNEL_TOKEN=..., into /etc/cloudflared/uat.env (root:root 0600). A unit of
# this kit's own (cloudflared-uat.service, in uat.slice) runs `cloudflared tunnel run`, which reads TUNNEL_TOKEN from
# its environment. The token file is read once, by this script, and never printed; delete it afterwards if it was a
# copy. cloudflared itself is installed from Cloudflare's apt repository (done 2026-11-23 by Darko's command).

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/lib.sh"
uat_require_root
uat_refuse_prod
uat_require_marker

TOKEN_FILE="${1:?usage: tunnel.sh <a file holding the tunnel token, one line>}"
[ -r "$TOKEN_FILE" ] || uat_die "cannot read $TOKEN_FILE"
command -v cloudflared >/dev/null || uat_die "cloudflared is not installed (Cloudflare's apt repo; README § Darko's steps)."

install -d -m 0755 /etc/cloudflared
umask 077
# one line, whitespace trimmed; refuse anything that doesn't look like a single token, and print nothing of it
tok="$(head -n1 "$TOKEN_FILE" | tr -d '[:space:]')"
[ -n "$tok" ] && [ "$(wc -l < "$TOKEN_FILE")" -le 1 ] && printf '%s' "$tok" | grep -qE '^[A-Za-z0-9_=+/.-]{40,}$' \
  || uat_die "$TOKEN_FILE does not hold one token on one line (nothing from it is printed)"
printf 'TUNNEL_TOKEN=%s\n' "$tok" > /etc/cloudflared/uat.env
unset tok
chown root:root /etc/cloudflared/uat.env; chmod 0600 /etc/cloudflared/uat.env

cat > /etc/systemd/system/cloudflared-uat.service <<'UNIT'
[Unit]
Description=cloudflared: uat.postmark.town to this box's UAT nginx (CORE-165; token in /etc/cloudflared/uat.env)
After=network-online.target
Wants=network-online.target

[Service]
Type=notify
Slice=uat.slice
EnvironmentFile=/etc/cloudflared/uat.env
ExecStart=/usr/bin/cloudflared --no-autoupdate tunnel run
Restart=on-failure
RestartSec=5
DynamicUser=yes
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now cloudflared-uat.service
sleep 5
systemctl is-active --quiet cloudflared-uat.service || uat_die "cloudflared-uat did not stay up: journalctl -u cloudflared-uat (the token is not in it)"
uat_say "the tunnel connector is up. Cloudflare's dashboard shows it HEALTHY; uat.postmark.town answers through Access once nginx-uat.sh has run."
