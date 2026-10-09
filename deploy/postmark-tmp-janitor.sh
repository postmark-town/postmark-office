#!/bin/sh
# postmark-tmp-janitor — remove meepo's /tmp leftovers older than 3 days.
#
# Hand-run scratch (flips, drains, rehearsals, test fixtures) lands in /tmp and
# nothing owns its end. On 2026-10-09 it filled the disk (38G of 38G): Postgres
# went into crash recovery, sign-in failed and the 08:00 ferry refused.
# Removes only top-level /tmp entries that are owned by meepo, untouched for
# more than 3 days, held open by no process, and not on the keep list (caches
# the office prunes itself). Prints every removal, so the journal is the record.
set -u
KEEP="postmark-world-store postmark-engine"
DAYS="${TMP_JANITOR_DAYS:-3}"
removed=0
for p in $(find /tmp -maxdepth 1 -mindepth 1 -user meepo -mtime +"$DAYS" 2>/dev/null); do
  name=$(basename "$p")
  case " $KEEP " in *" $name "*) continue ;; esac
  if command -v fuser >/dev/null 2>&1 && fuser -s "$p" 2>/dev/null; then echo "held open, kept: $p"; continue; fi
  if [ -d "$p" ] && command -v lsof >/dev/null 2>&1 && [ -n "$(lsof +D "$p" 2>/dev/null | sed 1d | head -1)" ]; then echo "held open, kept: $p"; continue; fi
  size=$(du -sh "$p" 2>/dev/null | cut -f1)
  rm -rf -- "$p" && echo "removed $p ($size)" && removed=$((removed+1))
done
echo "janitor: removed $removed entries; $(df -h / | awk 'NR==2{print $5" used, "$4" free"}')"
printf '{"at":"%s","removed":%s,"disk_pct":%s}\n' "$(date -u +%FT%TZ)" "$removed" "$(df --output=pcent / | tail -1 | tr -dc 0-9)" > /var/lib/postmark-tmp-janitor.json
