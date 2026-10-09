#!/bin/sh
# postmark-disk-watch — shout into Discord when the root disk passes 85%.
#
# Nothing watched the ground: on 2026-10-09 "full" surfaced as Postgres in
# crash recovery, a dead sign-in and a refused ferry, two hours before anyone
# looked. Uses the sentinel's own webhook (/etc/postmark-sentinel.env). Shouts
# at most once every 6 hours while the disk stays over the line, and says so
# once when it comes back under.
set -u
LIMIT="${DISK_WATCH_LIMIT:-85}"
STATE=/var/lib/postmark-disk-watch.last
HOOK="${SENTINEL_DISCORD_WEBHOOK:-}"
pct=$(df --output=pcent / | tail -1 | tr -dc 0-9)
free=$(df -h --output=avail / | tail -1 | tr -d ' ')
now=$(date +%s)
last=$(cat "$STATE" 2>/dev/null || echo 0)
say() { [ -n "$HOOK" ] && curl -sS --max-time 20 -H 'Content-Type: application/json' -d "{\"content\":\"$1\"}" "$HOOK" >/dev/null; }
if [ "$pct" -ge "$LIMIT" ]; then
  echo "disk ${pct}% (limit ${LIMIT}%), ${free} free"
  if [ $((now - last)) -ge 21600 ]; then
    say "🛑 **disk-watch**: the box's root disk is at ${pct}% (${free} free; alarm at ${LIMIT}%). On 10-09 a full disk took Postgres and sign-in down. Look at /tmp, /srv/postmark-site-refresh and /srv/world2-lab first."
    echo "$now" > "$STATE"
  fi
else
  echo "disk ${pct}%, ${free} free: under ${LIMIT}%"
  if [ "$last" != 0 ]; then say "✅ **disk-watch**: the root disk is back under ${LIMIT}% (${pct}%, ${free} free)."; echo 0 > "$STATE"; fi
fi
printf '{"at":"%s","disk_pct":%s,"limit_pct":%s,"free":"%s"}\n' "$(date -u +%FT%TZ)" "$pct" "$LIMIT" "$free" > /var/lib/postmark-disk-watch.json
