#!/usr/bin/env bash
# deploy/uat/nginx-uat.sh — UAT's front door is prod's, behind dev's gate (CORE-160). UNRUN.
#
#   sudo bash deploy/uat/nginx-uat.sh
#
# The vhost is GENERATED from the frozen release's copy of prod's (deploy/nginx-postmark-town.conf), never kept
# as a second hand-edited copy, so the two cannot drift. What changes: the host is uat.postmark.town; the
# certificate is a Cloudflare origin certificate, as dev's (Darko's Cloudflare step puts it at the two paths
# below); and the GATE dev has carries over, so only Cloudflare-edge traffic with an Access JWT enters (who may
# sign in is the Access application, Darko's step). The http{}-level files go in first, as DEPLOY.md § 4 says.

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/lib.sh"
uat_require_root
uat_refuse_prod
uat_require_marker

SRC=/srv/postmark-office/deploy
CERT=/etc/ssl/uat.postmark.town-origin.pem
KEY=/etc/ssl/private/uat.postmark.town-origin.key
[ -f "$SRC/nginx-postmark-town.conf" ] || uat_die "$SRC has no nginx copies: carry the frozen release first."
[ -f "$CERT" ] && [ -f "$KEY" ] || uat_die "the origin certificate is not at $CERT and $KEY (Darko's Cloudflare step)."

uat_say "http{}-level files (DEPLOY.md § 4, plus the edge map the gate reads)"
install -m 0644 "$HERE/cf-edge-map.conf"        /etc/nginx/conf.d/cf-edge-map.conf
install -m 0644 "$SRC/nginx-worldcache.conf"    /etc/nginx/conf.d/postmark-worldcache.conf
install -m 0644 "$SRC/nginx-present-grid.conf"  /etc/nginx/conf.d/postmark-present-grid.conf
install -m 0644 "$SRC/nginx-present-zone.conf"  /etc/nginx/conf.d/postmark-present-zone.conf
install -m 0644 "$SRC/nginx-api-timing.conf"    /etc/nginx/conf.d/postmark-api-timing.conf
# the front door (CORE-160; office #1197): present once the frozen release carries it
[ -f "$SRC/nginx-front-door.conf" ] && install -m 0644 "$SRC/nginx-front-door.conf" /etc/nginx/conf.d/postmark-front-door.conf
# the keyless zone's http{} half: the snippet's lines up to its limit_req_zone (DEPLOY.md § 4)
awk '{ print } /^limit_req_zone/ { exit }' "$SRC/nginx-rate-limit.conf.snippet" > /etc/nginx/conf.d/postmark-rate-limit.conf
install -d /var/cache/nginx/pmworld
install -m 0644 "$SRC/nginx-api.conf"           /etc/nginx/snippets/postmark-api.conf
# the /ops/ gate: the vhost refuses to load without it (DEPLOY.md § The ops gate). UAT already sits behind
# Cloudflare Access, so the Access variant; the operators may choose the basic one instead.
install -m 0644 "$SRC/nginx-ops-gate.access.conf" /etc/nginx/snippets/postmark-ops-gate.conf

uat_say "the vhost, generated from prod's"
OUT=/etc/nginx/sites-available/postmark-uat
sed -E \
  -e 's#server_name postmark\.town www\.postmark\.town;#server_name uat.postmark.town;#' \
  -e 's#server_name www\.postmark\.town;#server_name www.uat.postmark.town;#' \
  -e 's|^(\s*)server_name postmark\.town;|\1server_name uat.postmark.town;\n\1# THE GATE (dev'"'"'s, CORE-160): only Cloudflare-edge traffic carrying the Access JWT enters UAT.\n\1if ($cf_edge = 0) { return 403; }\n\1if ($http_cf_access_jwt_assertion = "") { return 403; }|' \
  -e 's#https://postmark\.town#https://uat.postmark.town#g' \
  -e "s#/etc/letsencrypt/live/postmark\.town/fullchain\.pem#$CERT#g" \
  -e "s#/etc/letsencrypt/live/postmark\.town/privkey\.pem#$KEY#g" \
  -e 's#^(\s*)(include /etc/letsencrypt/options-ssl-nginx\.conf;)#\1\# \2  (UAT: a Cloudflare origin certificate, no certbot)#' \
  -e 's#^(\s*)(ssl_dhparam /etc/letsencrypt/ssl-dhparams\.pem;)#\1\# \2#' \
  "$SRC/nginx-postmark-town.conf" > "$OUT"

# The generated file must say what it should, and nothing of prod's host may survive in a server_name.
grep -q 'server_name uat.postmark.town;' "$OUT" || uat_die "the generated vhost has no uat server_name"
[ "$(grep -c 'if (\$cf_edge = 0)' "$OUT")" = 1 ] || uat_die "the generated vhost does not carry the gate exactly once"
grep -E 'server_name[^;]*(^|[ ])(www\.)?postmark\.town;' "$OUT" && uat_die "a prod server_name survived in $OUT"
grep -q letsencrypt/live "$OUT" && uat_die "a letsencrypt path survived in $OUT"

ln -sf "$OUT" /etc/nginx/sites-enabled/postmark-uat
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
uat_say "uat.postmark.town is served from $OUT (generated; edit prod's copy of record, then rerun)"
