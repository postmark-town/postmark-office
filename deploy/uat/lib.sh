# deploy/uat/lib.sh — the guards every UAT script sources first (CORE-160, CORE-165).
#
# UAT runs a frozen release for a week of testing (Darko, 2026-11-22 21:59 and 22:05 EST: "a separate UAT makes a
# lot of sense"; "keep the prod box under as little load possible from non-resident operations"). It runs on the
# Beelink, town-rig (Darko, 2026-11-23 08:50 EST: "beelink becomes UAT and heavy work runs"), beside the town's meeps,
# capped to prod's size by uat.slice and run by its own system user, `uat`, which is never `meepo`, the meeps' Letta user.
#
# It is prod-shaped on purpose: the repo's own unit files, paths and schedule, so what is tested is what ships. That
# makes two harms plain, and every script refuses both before it does anything:
#   · run on PROD's box, it would point prod's units at UAT's settings;
#   · run as, or for, `meepo` on town-rig, it would hand UAT the meeps' files and keys, or theirs to UAT.

set -euo pipefail

UAT_MARKER=/etc/postmark-uat
UAT_DB=world2_uat
UAT_USER=uat
UAT_SLICE=uat.slice

uat_die() { echo "UAT REFUSED: $*" >&2; exit 1; }
uat_say() { echo "[uat] $*"; }

# Prod's box, named three ways. Any one refuses.
#   1. prod's store is named world2_dev (the name hazard, CORE-160): a box that has it is prod or a copy of it;
#   2. before provisioning only: a live office's access log under /srv/postmark-office/telemetry. After provisioning,
#      UAT's own office writes there, and the marker (which provision.sh writes only after these checks) stands instead;
#   3. prod's private hostname on 2026-11-23 (us-east-2c).
uat_refuse_prod() {
  if command -v psql >/dev/null 2>&1 && sudo -n -u postgres psql -tAc "select 1 from pg_database where datname = 'world2_dev'" 2>/dev/null | grep -q 1; then
    uat_die "this box holds a database named world2_dev, which is prod's store. UAT never runs where prod's store is."
  fi
  if [ ! -f "$UAT_MARKER" ] && ls /srv/postmark-office/telemetry/access-*.jsonl >/dev/null 2>&1; then
    uat_die "/srv/postmark-office/telemetry holds a live office's access logs and this box has no UAT marker. That is prod, or a clone of its disk."
  fi
  case "$(hostname)" in ip-172-31-39-65*) uat_die "hostname $(hostname) is prod's." ;; esac
}

# Every script but provision.sh also needs the marker provision.sh writes.
uat_require_marker() {
  [ -f "$UAT_MARKER" ] || uat_die "$UAT_MARKER is missing: run deploy/uat/provision.sh on this box first (it checks the box is not prod and writes the marker)."
}

uat_require_root() { [ "$(id -u)" = 0 ] || uat_die "run as root (sudo)."; }

# The scrub's gate (CORE-165). scrub.sql is Darko's call. It carries a `-- REVIEWED: <his ruling, dated>` line, and
# one `-- AWAITING:` line for each delete or scrub of it that has not reached him. Any AWAITING line refuses, and so
# does a REVIEWED line that is empty or `no`. Prints nothing and returns 0 only when the file may run.
uat_scrub_gate() { # <scrub.sql>
  local f="$1"
  [ -r "$f" ] || { echo "cannot read $f"; return 1; }
  if grep -qE '^-- REVIEWED: (no|)$' "$f"; then echo "scrub.sql is not reviewed yet (its REVIEWED line). The scrub is Darko's call: CORE-160."; return 1; fi
  if ! grep -qE '^-- REVIEWED: .+' "$f"; then echo "scrub.sql has no REVIEWED line."; return 1; fi
  if grep -qE '^-- AWAITING:' "$f"; then
    echo "scrub.sql still has deletes Darko has not reviewed (its AWAITING lines): $(grep -cE '^-- AWAITING:' "$f") of them. The scrub is Darko's call: CORE-165."
    return 1
  fi
  return 0
}

# The readback's check (CORE-165, Truey's finding 5). scrub.sql's last query prints one `<label> <count>` line per label
# it names (`SELECT 'label'` and `UNION ALL SELECT 'label'`). Every one of those labels must come back exactly once
# in the script's output; `zero_*` must read 0 and `present_*` must read above 0. So a readback that printed nothing,
# lost a line, printed one twice, or counted an empty store as clean, fails. Prints each failure; returns 1 on any.
uat_check_readback() { # <scrub.sql> <the psql output>
  local f="$1" out="$2" labels
  labels="$(grep -oE "^(SELECT|UNION ALL SELECT) '[a-z0-9_]+'" "$f" | grep -oE "'[a-z0-9_]+'" | tr -d "'" | tr '\n' ' ')" || true
  [ -n "$labels" ] || { echo "the readback names no label in $f"; return 1; }
  # one pass: a label counts only as a line of exactly `<label> <integer>`; anything else is a line that is not there
  printf '%s\n' "$out" | awk -v labels="$labels" '
    BEGIN { n = split(labels, L, " "); for (i = 1; i <= n; i++) want[L[i]] = 1 }
    NF == 2 && ($1 in want) && $2 ~ /^[0-9]+$/ { hits[$1]++; val[$1] = $2 + 0 }
    END {
      bad = 0
      for (i = 1; i <= n; i++) {
        l = L[i]
        if (hits[l] != 1) { printf "readback \047%s\047: expected one line, got %d\n", l, hits[l] + 0; bad = 1; continue }
        if (l ~ /^present_/) { if (val[l] <= 0) { printf "readback \047%s\047 is 0: the copy holds none of the public record it should\n", l; bad = 1 } }
        else if (val[l] != 0) { printf "readback \047%s\047 is %d, not 0\n", l, val[l]; bad = 1 }
      }
      exit bad
    }'
}

# The SQL that makes one store role with UAT's own password, for psql's STANDARD INPUT: the password is data in a
# pipe, never an argument (CORE-165, Truey's finding 2: `psql -v pw=...` put it in the process list for every user
# on the box). It is a SQL string literal built here: single quotes doubled; backslashes are literal because the
# server's standard_conforming_strings is on. An empty password makes the role NOLOGIN.
uat_role_sql() { # <role name> <password or empty>
  local r="$1" pw="$2" q
  case "$r" in ''|*[!a-z0-9_]*) echo "bad role name" >&2; return 1 ;; esac
  q="${pw//\'/\'\'}"
  printf 'DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = %s) THEN CREATE ROLE %s; END IF; END $do$;\n' "'$r'" "$r"
  if [ -z "$pw" ]; then printf 'ALTER ROLE %s NOLOGIN;\n' "$r"
  else printf "ALTER ROLE %s LOGIN PASSWORD '%s';\n" "$r" "$q"
  fi
}

# UAT's user is its own: never the meeps' `meepo`, and it must exist (provision.sh makes it).
uat_require_user() {
  [ "$UAT_USER" != meepo ] || uat_die "UAT_USER is meepo, the meeps' Letta user on this box. UAT runs as its own user."
  id "$UAT_USER" >/dev/null 2>&1 || uat_die "no user $UAT_USER: run deploy/uat/provision.sh first."
}
