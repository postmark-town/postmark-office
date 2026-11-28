#!/usr/bin/env bash
# deploy/uat/nginx-uat.sh — UAT's front door is prod's, behind dev's gate, reached only through a Cloudflare
# tunnel (CORE-160, CORE-165).
#
#   sudo bash deploy/uat/nginx-uat.sh
#
# The vhost is GENERATED from the frozen release's copy of prod's (deploy/nginx-postmark-town.conf), never kept as a
# second hand-edited copy, so the two cannot drift. On town-rig (Darko, 2026-11-23 08:50 EST) UAT has no public
# address, DNS record or certificate of its own: cloudflared (tunnel.sh) carries uat.postmark.town from Cloudflare's
# edge to this nginx on loopback. So the generated vhost:
#   · keeps only prod's main server block (the port-80 redirect and the www block have no meaning behind a tunnel);
#   · listens on 127.0.0.1:8480 only, plain HTTP (TLS ends at Cloudflare's edge, and the tunnel is encrypted);
#   · names uat.postmark.town and carries dev's GATE, which on UAT admits a request that reached this listener AND
#     carries a non-empty Cf-Access-Jwt-Assertion header. WHAT THAT IS, AND IS NOT (CORE-165, finding 3):
#       - Tunnel traffic arrives from 127.0.0.1, which the edge map counts as edge (the operator on the box), so
#         `$cf_edge` is 1 for every request that can reach this listener. The first `if` can never refuse here; it is
#         kept so the vhost stays dev's, line for line.
#       - The JWT is tested for PRESENCE only. Nothing here checks its signature, audience or expiry, so any process on
#         this box (the meeps are on it) can curl 127.0.0.1:8480 with any header value and be let in.
#       - Who may sign in is therefore decided by Cloudflare Access, in front of the tunnel (Darko's step), and by
#         nothing on this box. From the internet the only road to this listener is the tunnel, so that is the gate; from
#         the box itself there is none. Verifying the JWT against Cloudflare's keys would need an nginx module the box
#         does not have: an open item in README § Open, for a person to decide.
#       - The machine endpoints an agent's connector calls without a browser (/api/mcp, the OAuth register and
#         token endpoints, the .well-known discovery documents) pass WITHOUT the header: uat-gate-map.conf names
#         them, and Cloudflare Access bypasses the same paths (Darko, 2026-11-28: "unblock agent access"). The
#         browser half of the sign-in stays behind Access, so only a uat-tester can mint an agent's token.
# The http{}-level files go in first, as DEPLOY.md § 4 says.

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/lib.sh"
uat_require_root
uat_refuse_prod
uat_require_marker

SRC=/srv/postmark-office/deploy
PORT="${UAT_NGINX_PORT:-8480}"
[ -f "$SRC/nginx-postmark-town.conf" ] || uat_die "$SRC has no nginx copies: carry the frozen release first."

uat_say "http{}-level files (DEPLOY.md § 4, plus the edge map the gate reads)"
install -m 0644 "$HERE/cf-edge-map.conf"        /etc/nginx/conf.d/cf-edge-map.conf
# the machine endpoints an agent's connector reaches without an Access JWT (CORE-165; Darko 2026-11-28)
install -m 0644 "$HERE/uat-gate-map.conf"       /etc/nginx/conf.d/uat-gate-map.conf
install -m 0644 "$SRC/nginx-worldcache.conf"    /etc/nginx/conf.d/postmark-worldcache.conf
install -m 0644 "$SRC/nginx-present-grid.conf"  /etc/nginx/conf.d/postmark-present-grid.conf
install -m 0644 "$SRC/nginx-present-zone.conf"  /etc/nginx/conf.d/postmark-present-zone.conf
install -m 0644 "$SRC/nginx-api-timing.conf"    /etc/nginx/conf.d/postmark-api-timing.conf
# the front door (CORE-160; office #1200): present once the frozen release carries it
[ -f "$SRC/nginx-front-door.conf" ] && install -m 0644 "$SRC/nginx-front-door.conf" /etc/nginx/conf.d/postmark-front-door.conf
# the keyless zone's http{} half: the snippet's lines up to its limit_req_zone (DEPLOY.md § 4)
awk '{ print } /^limit_req_zone/ { exit }' "$SRC/nginx-rate-limit.conf.snippet" > /etc/nginx/conf.d/postmark-rate-limit.conf
install -d /var/cache/nginx/pmworld
install -m 0644 "$SRC/nginx-api.conf"           /etc/nginx/snippets/postmark-api.conf
# the /ops/ gate: the vhost refuses to load without it (DEPLOY.md § The ops gate). UAT already sits behind Access.
install -m 0644 "$SRC/nginx-ops-gate.access.conf" /etc/nginx/snippets/postmark-ops-gate.conf

uat_say "the vhost, generated from prod's main server block"
OUT=/etc/nginx/sites-available/postmark-uat
# Generated beside the live vhost and checked THERE; only a file that passed its checks is moved into place, and a
# config nginx refuses puts the previous vhost back (CORE-165, finding 4). Before this, the live file was overwritten
# first and checked after, and `nginx -t && systemctl reload nginx` in a `set -e` script could fail and still fall
# through to the success line below.
NEWV="$(mktemp /etc/nginx/sites-available/.postmark-uat.XXXXXX)"
PREV=""; [ -e "$OUT" ] && PREV="$(mktemp /etc/nginx/sites-available/.postmark-uat-prev.XXXXXX)" && cat "$OUT" > "$PREV"
# 1. keep what precedes the first server block (the maps) and the one block whose server_name is postmark.town;
awk '
  BEGIN { depth = 0; inblock = 0; seen = 0 }
  !seen && !inblock && /^server[ \t]*\{/ { seen = 1 }
  !seen { print; next }
  !inblock && /^server[ \t]*\{/ { inblock = 1; buf = ""; depth = 0 }
  inblock {
    buf = buf $0 "\n"
    n = gsub(/\{/, "{"); m = gsub(/\}/, "}"); depth += n - m
    if (depth == 0) { if (buf ~ /server_name postmark\.town;/) printf "%s", buf; inblock = 0 }
    next
  }
' "$SRC/nginx-postmark-town.conf" |
# 2. loopback, plain HTTP, the UAT name, the gate; no certificate lines
sed -E \
  -e "s#^(\s*)listen 443 ssl http2;#\1listen 127.0.0.1:$PORT;#" \
  -e '/^\s*listen \[::\]:443/d' \
  -e '/^\s*ssl_certificate(_key)? /d' \
  -e '/^\s*include \/etc\/letsencrypt\/options-ssl-nginx\.conf;/d' \
  -e '/^\s*ssl_dhparam /d' \
  -e 's|^(\s*)server_name postmark\.town;|\1server_name uat.postmark.town;\n\1# THE GATE (dev'"'"'s, CORE-160): a request must carry a non-empty Access JWT header. PRESENCE ONLY: Cloudflare Access in front of the tunnel is the gate, and nothing here verifies the JWT. The machine endpoints in uat-gate-map.conf pass without one (CORE-165, agents).\n\1if ($cf_edge = 0) { return 403; }\n\1if ($uat_gate_refuse) { return 403; }|' \
  -e 's#https://postmark\.town#https://uat.postmark.town#g' \
  > "$NEWV"

# The generated file must say what it should, and nothing of prod's front may survive.
grep -q 'server_name uat.postmark.town;' "$NEWV" || uat_die "the generated vhost has no uat server_name (left at $NEWV; $OUT is untouched)"
[ "$(grep -c 'if (\$cf_edge = 0)' "$NEWV")" = 1 ] || uat_die "the generated vhost does not carry the gate exactly once (left at $NEWV; $OUT is untouched)"
[ "$(grep -c 'if (\$uat_gate_refuse) { return 403; }' "$NEWV")" = 1 ] || uat_die "the generated vhost does not carry the JWT gate (uat_gate_refuse) exactly once (left at $NEWV; $OUT is untouched)"
grep -q 'http_cf_access_jwt_assertion = ""' "$NEWV" && uat_die "the old presence-only JWT if survived beside the map's gate (left at $NEWV; $OUT is untouched)"
[ "$(grep -c '^\s*listen ' "$NEWV")" = 1 ] && grep -q "listen 127.0.0.1:$PORT;" "$NEWV" || uat_die "the generated vhost must listen on 127.0.0.1:$PORT and nowhere else (left at $NEWV; $OUT is untouched)"
grep -E 'server_name[^;]*(^|[ ])(www\.)?postmark\.town;' "$NEWV" && uat_die "a prod server_name survived in $NEWV ($OUT is untouched)"
grep -q -E 'letsencrypt|ssl_certificate' "$NEWV" && uat_die "a certificate line survived in $NEWV ($OUT is untouched)"

# Into place, then nginx's own verdict on the whole config. On a refusal the previous vhost goes back (or, on a first
# run, the link and the file come out) and the script says so and stops: it never prints the success line below.
cat "$NEWV" > "$OUT"
ln -sf "$OUT" /etc/nginx/sites-enabled/postmark-uat
rm -f /etc/nginx/sites-enabled/default
if ! nginx -t; then
  if [ -n "$PREV" ]; then cat "$PREV" > "$OUT"; uat_say "nginx refused the new vhost: the previous $OUT is back"
  else rm -f /etc/nginx/sites-enabled/postmark-uat "$OUT"; uat_say "nginx refused the new vhost: it is taken out again (there was none before)"; fi
  uat_die "nginx -t refused the generated vhost, so nothing was reloaded (nginx's own reason is above). The refused vhost is kept at $NEWV${PREV:+, the previous one at $PREV}"
fi
systemctl reload nginx || uat_die "nginx accepted the config but systemctl reload nginx failed: see journalctl -u nginx. The generated vhost is $OUT"
rm -f "$NEWV" ${PREV:+"$PREV"}   # this script's own temp files
uat_say "uat.postmark.town is served from $OUT on 127.0.0.1:$PORT (generated; edit prod's copy of record, then rerun)"
