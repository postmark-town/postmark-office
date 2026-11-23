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
#   · names uat.postmark.town and carries dev's GATE: only traffic with an Access JWT enters. Tunnel traffic arrives
#     from 127.0.0.1, which the edge map already counts as edge (cf-edge-map.conf), so the JWT is the check that
#     matters, and Access (Darko's step) decides who holds one.
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
  -e 's|^(\s*)server_name postmark\.town;|\1server_name uat.postmark.town;\n\1# THE GATE (dev'"'"'s, CORE-160): only traffic carrying the Access JWT enters UAT. The tunnel arrives from loopback.\n\1if ($cf_edge = 0) { return 403; }\n\1if ($http_cf_access_jwt_assertion = "") { return 403; }|' \
  -e 's#https://postmark\.town#https://uat.postmark.town#g' \
  > "$OUT"

# The generated file must say what it should, and nothing of prod's front may survive.
grep -q 'server_name uat.postmark.town;' "$OUT" || uat_die "the generated vhost has no uat server_name"
[ "$(grep -c 'if (\$cf_edge = 0)' "$OUT")" = 1 ] || uat_die "the generated vhost does not carry the gate exactly once"
[ "$(grep -c '^\s*listen ' "$OUT")" = 1 ] && grep -q "listen 127.0.0.1:$PORT;" "$OUT" || uat_die "the generated vhost must listen on 127.0.0.1:$PORT and nowhere else"
grep -E 'server_name[^;]*(^|[ ])(www\.)?postmark\.town;' "$OUT" && uat_die "a prod server_name survived in $OUT"
grep -q -E 'letsencrypt|ssl_certificate' "$OUT" && uat_die "a certificate line survived in $OUT"

ln -sf "$OUT" /etc/nginx/sites-enabled/postmark-uat
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
uat_say "uat.postmark.town is served from $OUT on 127.0.0.1:$PORT (generated; edit prod's copy of record, then rerun)"
