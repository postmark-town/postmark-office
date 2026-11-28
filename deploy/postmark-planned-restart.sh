#!/bin/bash
# /usr/local/sbin/postmark-planned-restart.sh: installed by Jetto 2026-11-26 on Darko's yes (STAR-253/d).
# The planned half of 50-postmark.conf: once a day, in a quiet window, restart Postgres and then the office if (and only
# if) needrestart says they run replaced libraries. It refuses inside the town's busy windows and while the town's pen is
# held, so it never lands mid-settlement, mid-crossing or mid-write. It writes one line to the journal either way.
#   postmark-planned-restart.sh            act (the timer's run)
#   postmark-planned-restart.sh --dry      say what it would do, change nothing
set -uo pipefail
DRY=0; [ "${1:-}" = "--dry" ] && DRY=1
say() { echo "[planned-restart] $*"; }

# The busy windows, UTC (crossings at 00:00 and 12:00, settlements at 06:00 and 18:00, with their lead-ups and tails).
hm=$((10#$(date -u +%H%M)))
for w in "2330 0045" "1130 1245" "0530 0645" "1730 1845"; do
  set -- $w; a=$((10#$1)); b=$((10#$2))
  if { [ $a -le $b ] && [ $hm -ge $a ] && [ $hm -le $b ]; } || { [ $a -gt $b ] && { [ $hm -ge $a ] || [ $hm -le $b ]; }; }; then
    say "refused: inside the busy window $1-$2Z; the next daily run will try again"; exit 0; fi
done

# The town's pen: never restart under a held write. /srv/postmark-office/town.lock is the office's flock file (read on the
# box 2026-11-26); a holder keeps it open, so fuser sees a held lock.
PEN_LOCK="${PEN_LOCK:-/srv/postmark-office/town.lock}"
if [ -e "$PEN_LOCK" ] && command -v fuser >/dev/null && fuser -s "$PEN_LOCK" 2>/dev/null; then
  say "refused: the town's pen lock is held ($PEN_LOCK); the next daily run will try again"; exit 0; fi

# What needrestart says, read-only (-r l lists, it restarts nothing).
svcs=$(needrestart -b -r l 2>/dev/null | sed -n 's/^NEEDRESTART-SVC: //p')
pg=$(printf '%s\n' "$svcs" | grep -E '^postgresql' || true)
office=$(printf '%s\n' "$svcs" | grep -E '^postmark-office' || true)
if [ -z "$pg$office" ]; then say "nothing to do: Postgres and the office run current libraries"; exit 0; fi

if [ $DRY = 1 ]; then say "would restart: ${pg:+$pg }${office:+$office} (Postgres first, then the office)"; exit 0; fi

# Postgres first (a clean restart; clients reconnect), then the office, so it reconnects to the new Postgres.
for u in $pg $office; do
  say "restarting $u (replaced libraries)"
  systemctl restart "$u" || { say "FAILED: systemctl restart $u"; exit 1; }
done
sleep 5
for u in $pg $office; do systemctl is-active --quiet "$u" || { say "FAILED: $u is not active after the restart"; exit 1; }; done
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 http://127.0.0.1/api/ || echo 000)
[ "$code" = 200 ] || { say "FAILED: /api/ answered $code after the restart"; exit 1; }
say "done: ${pg:+$pg }${office:+$office} restarted; /api/ answers 200"
