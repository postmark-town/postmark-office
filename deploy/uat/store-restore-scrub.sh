#!/usr/bin/env bash
# deploy/uat/store-restore-scrub.sh — UAT's store is last night's prod dump, restored and scrubbed (CORE-160). UNRUN.
#
#   sudo bash deploy/uat/store-restore-scrub.sh [--night YYYYMMDDTHHMMSSZ]
#
# Weekly, at the freeze, before the carry (the SHIPPING draft § 2.6: the seed advances once, at the freeze, and
# never while people are testing). It never touches prod: it reads the NIGHTLY DUMP the backup lane already ships
# to S3 (DEPLOY.md § The S3 route), with UAT's own AWS key, which may only list and read that bucket (Darko's step,
# 2026-11-23 09:27 EST; never the prod box's postmark-box-backup role, which can also put). The key lives in
# /etc/postmark-uat-aws.env (root:root 0600: AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_DEFAULT_REGION), is sourced
# into one subshell's environment and never printed or put on a command line. Then:
#   1. the store's roles, by prod's names, with UAT's own passwords (from UAT's /etc/postmark-world2-dev.env);
#   2. the dump into a NEW database (it carries no owners or grants: --no-owner --no-acl), then grants.sql;
#   3. scrub.sql inside it, refused until Darko has reviewed it (its REVIEWED line), with a readback of zeros;
#   4. the swap: the new database becomes world2_uat, the old one is kept as world2_uat_prev until the next run.
# The office and every store unit are stopped across the swap and started after it.

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/lib.sh"
uat_require_root
uat_refuse_prod
uat_require_marker

NIGHT=""
while [ $# -gt 0 ]; do case "$1" in --night) NIGHT="$2"; shift 2 ;; *) uat_die "unknown argument $1" ;; esac; done

ENVF=/etc/postmark-world2-dev.env   # the path the store scripts read (world2-lib.sh), on UAT holding UAT's values
[ -r "$ENVF" ] || uat_die "$ENVF is missing: UAT's store credentials (deploy/uat/env/other.env.template)."
val() { sed -n "s/^$1=//p" "$ENVF" | head -n1; }
[ "$(val WORLD2_DB)" = "$UAT_DB" ] || uat_die "$ENVF must say WORLD2_DB=$UAT_DB (it says '$(val WORLD2_DB)'). The store scripts default to world2_dev, prod's name."
BUCKET="$(val W2_S3_BUCKET)"; [ -n "$BUCKET" ] || uat_die "W2_S3_BUCKET is not in $ENVF."

grep -qE '^-- REVIEWED: (no|)$' "$HERE/scrub.sql" && uat_die "scrub.sql is not reviewed yet (its REVIEWED line). The scrub is Darko's call: CORE-160."
grep -qE '^-- REVIEWED: .+' "$HERE/scrub.sql" || uat_die "scrub.sql has no REVIEWED line."

AWS="$(command -v aws || echo /snap/bin/aws)"
AWSENV=/etc/postmark-uat-aws.env
[ -r "$AWSENV" ] && [ "$(stat -c '%U:%a' "$AWSENV")" = "root:600" ] || uat_die "$AWSENV must exist, root:root 0600 (UAT's read-only key: Darko's step)."
# every aws call goes through this: the key enters one subshell's environment, nowhere else
uaws() ( set -a; . "$AWSENV"; set +a; "$AWS" "$@" )
uaws sts get-caller-identity --query Arn --output text >/dev/null || uat_die "UAT's AWS key does not authenticate."

WORK="$(mktemp -d /var/tmp/uat-restore.XXXXXX)"; trap 'rm -rf "$WORK"' EXIT
chmod 0755 "$WORK"   # root fetches (the key is root's); postgres restores (it reads the dump)
if [ -z "$NIGHT" ]; then
  NIGHT="$(uaws s3 ls "s3://$BUCKET/world2/" | awk '$1 == "PRE" { sub("/$", "", $2); print $2 }' | grep -E '^[0-9]{8}T[0-9]{6}Z$' | sort | tail -n1)"
fi
[ -n "$NIGHT" ] || uat_die "no night found under s3://$BUCKET/world2/"
uat_say "night $NIGHT: fetching the dump and its sum"
uaws s3 cp --recursive --only-show-errors --no-progress --exclude '*' --include 'world2-*.dump' --include 'world2-*.dump.sha256' "s3://$BUCKET/world2/$NIGHT/" "$WORK/"
chmod 0644 "$WORK"/*
DUMP="$(ls -1 "$WORK"/world2-*.dump | head -n1)"; [ -f "$DUMP" ] || uat_die "the night has no world2-*.dump"
( cd "$WORK" && sha256sum -c "$(basename "$DUMP").sha256" ) || uat_die "the dump does not match its sum"

uat_say "the roles (prod's names, UAT's passwords)"
role() { # <name> <password key in ENVF or empty>
  local pw=""; [ -n "$2" ] && pw="$(val "$2")"
  sudo -u postgres psql -v ON_ERROR_STOP=1 -q -v r="$1" -v pw="$pw" <<'SQL'
SELECT format('CREATE ROLE %I', :'r') WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'r') \gexec
SELECT CASE WHEN :'pw' = '' THEN format('ALTER ROLE %I NOLOGIN', :'r') ELSE format('ALTER ROLE %I LOGIN PASSWORD %L', :'r', :'pw') END \gexec
SQL
}
role world2_owner PG_WORLD2_OWNER_PASSWORD
role office_api PG_OFFICE_API_PASSWORD
role law_ingester PG_LAW_INGESTER_PASSWORD
role snapshot_reader PG_SNAPSHOT_READER_PASSWORD
role clearing_job PG_CLEARING_JOB_PASSWORD
role stance_reader PG_STANCE_READER_PASSWORD
role rehearsal_runner ""

NEW="${UAT_DB}_new"
uat_say "restore into $NEW (owners and grants kept)"
sudo -u postgres dropdb --if-exists "$NEW"
sudo -u postgres createdb --owner world2_owner "$NEW"
sudo -u postgres pg_restore --exit-on-error --dbname "$NEW" "$DUMP" || uat_die "pg_restore failed; $NEW is left for a look, $UAT_DB is untouched"

# The nightly dump is taken --no-owner --no-acl (deploy/world2-backup.sh), so prod's grants are not in it: without
# them every role but the owner is refused every table. grants.sql is prod's GRANT/REVOKE set, read from a
# schema-only dump of prod (see its header); it is applied before the scrub, in one transaction.
[ -f "$HERE/grants.sql" ] || uat_die "grants.sql is missing: the dump carries no grants (its header says how to make it)"
uat_say "the grants (prod's, from grants.sql: the dump carries none)"
sudo -u postgres psql -q -v ON_ERROR_STOP=1 -1 -d "$NEW" -f "$HERE/grants.sql" || uat_die "the grants failed; $NEW is left for a look, $UAT_DB is untouched"

uat_say "scrub (scrub.sql), then the readback: every count must be 0"
OUT="$(sudo -u postgres psql -q -v ON_ERROR_STOP=1 -d "$NEW" -tA -F' ' -f "$HERE/scrub.sql")" || uat_die "the scrub failed; $UAT_DB is untouched"
echo "$OUT" | grep -E ' [0-9]+$' | sed 's/^/  /'
echo "$OUT" | grep -E ' [0-9]+$' | awk '$NF != 0 { bad = 1 } END { exit bad }' || uat_die "a scrub readback is not 0; $NEW is left for a look, $UAT_DB is untouched"

uat_say "the swap: stop the store's users, rename, start them"
UNITS="$(systemctl list-units --plain --no-legend --state=active 'postmark-*' | awk '{print $1}' | grep -v -E '\.(timer|socket)$' || true)"
TIMERS="$(systemctl list-units --plain --no-legend --state=active 'postmark-*.timer' | awk '{print $1}' || true)"
[ -n "$TIMERS" ] && systemctl stop $TIMERS
[ -n "$UNITS" ] && systemctl stop $UNITS
sudo -u postgres psql -v ON_ERROR_STOP=1 -q <<SQL
DROP DATABASE IF EXISTS ${UAT_DB}_prev;
SELECT 'ALTER DATABASE $UAT_DB RENAME TO ${UAT_DB}_prev' WHERE EXISTS (SELECT 1 FROM pg_database WHERE datname = '$UAT_DB') \gexec
ALTER DATABASE $NEW RENAME TO $UAT_DB;
SQL
[ -n "$UNITS" ] && systemctl start $UNITS
[ -n "$TIMERS" ] && systemctl start $TIMERS
echo "{\"night\":\"$NIGHT\",\"restored_at\":\"$(date -u +%FT%TZ)\",\"scrub\":\"$(sed -n 's/^-- REVIEWED: //p' "$HERE/scrub.sql")\"}" > /srv/postmark-office/uat-store.json
chown uat:uat /srv/postmark-office/uat-store.json
uat_say "UAT's store is prod's night $NIGHT, scrubbed. The previous copy is ${UAT_DB}_prev until the next run."
