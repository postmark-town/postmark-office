#!/usr/bin/env bash
# deploy/uat/store-restore-scrub.sh — UAT's store is last night's prod dump, restored and scrubbed (CORE-160). UNRUN
# since the finding-1 and finding-7 changes of CORE-165; the first run after them is the freeze's.
#
#   sudo bash deploy/uat/store-restore-scrub.sh [--night YYYYMMDDTHHMMSSZ]
#
# Weekly, at the freeze, before the carry (the SHIPPING draft § 2.6: the seed advances once, at the freeze, and
# never while people are testing). It never touches prod: it reads the NIGHTLY DUMP the backup lane already ships
# to S3 (DEPLOY.md § The S3 route), with UAT's own AWS key, which may only list and read that bucket (Darko's step,
# 2026-11-23 09:27 EST; never the prod box's postmark-box-backup role, which can also put). The key lives in
# /etc/postmark-uat-aws.env (root:root 0600: AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_DEFAULT_REGION), is sourced
# into one subshell's environment and never printed or put on a command line. The store roles' passwords reach psql
# through its standard input, never its arguments (lib.sh § uat_role_sql). Then:
#   0. the gate: scrub.sql must carry Darko's REVIEWED line and no AWAITING line (lib.sh § uat_scrub_gate);
#   1. the store's roles, by prod's names, with UAT's own passwords (from UAT's /etc/postmark-world2-dev.env);
#   2. the dump into a NEW database, restored as postgres (the dump is --no-owner --no-acl), then own.sql hands every
#      object to world2_owner, as on prod, and grants.sql gives prod's grants;
#   3. the frozen release's migrations the copy lacks, as world2_owner (migrate-plan.mjs): the copy is prod's schema of
#      last night and the code is a week newer;
#   4. scrub.sql inside it, then its readback, which must name every label scrub.sql names, each once (lib.sh §
#      uat_check_readback);
#   5. the swap, in one transaction: the new database becomes world2_uat, the old one is kept as world2_uat_prev until
#      the next run, and the one before it goes. The office and every store unit are stopped across it and started
#      after it, and started again if the run dies in between.

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/lib.sh"
uat_require_root
uat_refuse_prod
uat_require_marker

NIGHT=""
while [ $# -gt 0 ]; do case "$1" in --night) NIGHT="$2"; shift 2 ;; *) uat_die "unknown argument $1" ;; esac; done

RELEASE=/srv/postmark-office   # the carried frozen release: its schema files and migrations-landed.mjs
NODE=/usr/bin/node             # Node 22, prod's (provision.sh)
ENVF=/etc/postmark-world2-dev.env   # the path the store scripts read (world2-lib.sh), on UAT holding UAT's values
[ -r "$ENVF" ] || uat_die "$ENVF is missing: UAT's store credentials (deploy/uat/env/other.env.template)."
val() { sed -n "s/^$1=//p" "$ENVF" | head -n1; }
[ "$(val WORLD2_DB)" = "$UAT_DB" ] || uat_die "$ENVF must say WORLD2_DB=$UAT_DB (it says '$(val WORLD2_DB)'). The store scripts default to world2_dev, prod's name."
BUCKET="$(val W2_S3_BUCKET)"; [ -n "$BUCKET" ] || uat_die "W2_S3_BUCKET is not in $ENVF."

GATE="$(uat_scrub_gate "$HERE/scrub.sql")" || uat_die "$GATE"

AWS="$(command -v aws || echo /snap/bin/aws)"
AWSENV=/etc/postmark-uat-aws.env
[ -r "$AWSENV" ] && [ "$(stat -c '%U:%a' "$AWSENV")" = "root:600" ] || uat_die "$AWSENV must exist, root:root 0600 (UAT's read-only key: Darko's step)."
# every aws call goes through this: the key enters one subshell's environment, nowhere else
uaws() ( set -a; . "$AWSENV"; set +a; "$AWS" "$@" )
uaws sts get-caller-identity --query Arn --output text >/dev/null || uat_die "UAT's AWS key does not authenticate."

# One exit path. A run that stopped the store's units and then died (a failed rename, a signal, a bug) must not leave
# them stopped: UAT would sit dark all week with the old database still in place (CORE-165, finding 6).
WORK="$(mktemp -d /var/tmp/uat-restore.XXXXXX)"
UNITS=""; TIMERS=""; STOPPED=0
finish() {
  local rc=$?
  if [ "$STOPPED" = 1 ]; then
    echo "[uat] this run stopped the store's units and did not finish: starting them again" >&2
    [ -n "$UNITS" ] && { systemctl start $UNITS || echo "[uat] could not start: $UNITS" >&2; }
    [ -n "$TIMERS" ] && { systemctl start $TIMERS || echo "[uat] could not start: $TIMERS" >&2; }
  fi
  rm -rf "$WORK"
  exit $rc
}
trap finish EXIT
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

uat_say "the roles (prod's names, UAT's passwords, through psql's standard input)"
role() { # <name> <password key in ENVF, or empty for a role nobody logs in as>
  local pw=""
  if [ -n "$2" ]; then pw="$(val "$2")"; [ -n "$pw" ] || uat_die "$2 is empty or missing in $ENVF (a role made without it could not log in)."; fi
  uat_role_sql "$1" "$pw" | sudo -u postgres psql -q -v ON_ERROR_STOP=1
}
role world2_owner PG_WORLD2_OWNER_PASSWORD
role office_api PG_OFFICE_API_PASSWORD
role law_ingester PG_LAW_INGESTER_PASSWORD
role snapshot_reader PG_SNAPSHOT_READER_PASSWORD
role clearing_job PG_CLEARING_JOB_PASSWORD
role stance_reader PG_STANCE_READER_PASSWORD
role rehearsal_runner ""

NEW="${UAT_DB}_new"
uat_say "restore into $NEW (as postgres: the dump carries no owners or grants)"
sudo -u postgres dropdb --if-exists "$NEW"
sudo -u postgres createdb --owner world2_owner "$NEW"
sudo -u postgres pg_restore --exit-on-error --dbname "$NEW" "$DUMP" || uat_die "pg_restore failed; $NEW is left for a look, $UAT_DB is untouched"

uat_say "ownership (own.sql): every object to world2_owner, as on prod"
OWN_OUT="$(sudo -u postgres psql -q -v ON_ERROR_STOP=1 -d "$NEW" -tA -F' ' -f "$HERE/own.sql")" || uat_die "own.sql failed; $NEW is left for a look, $UAT_DB is untouched"
OWN_BAD="$(uat_check_readback "$HERE/own.sql" "$OWN_OUT")" || { echo "$OWN_BAD" >&2; uat_die "objects are still not world2_owner's; $NEW is left for a look, $UAT_DB is untouched"; }

# The nightly dump is taken --no-owner --no-acl (deploy/world2-backup.sh), so prod's grants are not in it: without
# them every role but the owner is refused every table. grants.sql is prod's GRANT/REVOKE set, read from a
# schema-only dump of prod (see its header); it is applied before the scrub, in one transaction.
[ -f "$HERE/grants.sql" ] || uat_die "grants.sql is missing: the dump carries no grants (its header says how to make it)"
uat_say "the grants (prod's, from grants.sql: the dump carries none)"
sudo -u postgres psql -q -v ON_ERROR_STOP=1 -1 -d "$NEW" -f "$HERE/grants.sql" || uat_die "the grants failed; $NEW is left for a look, $UAT_DB is untouched"

# The code is the frozen release's, a week newer than last night's prod. Prod takes a week's migrations by hand at the
# ship, so the copy lacks them, and the carried office refuses to boot or reads a missing table. migrate-plan.mjs asks
# the release's own landed-probes (world2/tools/migrations-landed.mjs) which files the copy lacks; each is applied as
# world2_owner (every file's header says so), and the plan is asked again: it must now be empty.
[ -f "$RELEASE/world2/tools/migrations-landed.mjs" ] && [ -d "$RELEASE/world2/schema" ] || uat_die "the frozen release is not carried into $RELEASE (no world2/tools/migrations-landed.mjs): carry it first (README § The order)."
uat_say "the frozen release's migrations the copy lacks"
PLAN="$("$NODE" "$HERE/migrate-plan.mjs" --db "$NEW" --release "$RELEASE")" || uat_die "the migration plan refused (a schema file has no landed-probe, or the copy could not be read); $NEW is left for a look, $UAT_DB is untouched"
while IFS= read -r f; do
  [ -n "$f" ] || continue
  uat_say "migrate: $f, as world2_owner"
  sudo -u postgres psql -q -v ON_ERROR_STOP=1 -d "$NEW" -c "SET ROLE world2_owner;" -f "$RELEASE/world2/schema/$f" || uat_die "$f failed; $NEW is left for a look, $UAT_DB is untouched"
done <<< "$PLAN"
AFTER="$("$NODE" "$HERE/migrate-plan.mjs" --db "$NEW" --release "$RELEASE" 2>/dev/null)" || uat_die "the second migration plan refused; $NEW is left for a look, $UAT_DB is untouched"
[ -z "$AFTER" ] || uat_die "after applying, these migrations still read as not landed: $(echo $AFTER); $NEW is left for a look, $UAT_DB is untouched"

uat_say "scrub (scrub.sql), then the readback: every label it names, once; zero_* must be 0 and present_* above 0"
OUT="$(sudo -u postgres psql -q -v ON_ERROR_STOP=1 -d "$NEW" -tA -F' ' -f "$HERE/scrub.sql")" || uat_die "the scrub failed; $UAT_DB is untouched"
echo "$OUT" | grep -E ' [0-9]+$' | sed 's/^/  /' || true
RB="$(uat_check_readback "$HERE/scrub.sql" "$OUT")" || { echo "$RB" >&2; uat_die "the scrub readback failed; $NEW is left for a look, $UAT_DB is untouched"; }

uat_say "the swap: stop the store's users, rename in one transaction, start them"
UNITS="$(systemctl list-units --plain --no-legend --state=active 'postmark-*' | awk '{print $1}' | grep -v -E '\.(timer|socket)$' || true)"
TIMERS="$(systemctl list-units --plain --no-legend --state=active 'postmark-*.timer' | awk '{print $1}' || true)"
STOPPED=1   # from here until the units are started again, finish() starts them if this run dies
[ -n "$TIMERS" ] && systemctl stop $TIMERS
[ -n "$UNITS" ] && systemctl stop $UNITS
# A leftover from a run that died after its swap, before this drop: nothing reads it.
sudo -u postgres dropdb --if-exists "${UAT_DB}_prev_old"
# One transaction, so there is no moment with no live database and no half-done rename: live -> prev, prev -> prev_old,
# new -> live. A rename that fails (a session still connected) rolls the three back and the units start again.
# Only after it commits is the oldest copy dropped; it is never dropped first.
sudo -u postgres psql -v ON_ERROR_STOP=1 -q <<SQL || uat_die "the swap failed and rolled back: $UAT_DB is as it was; $NEW is left for a look"
BEGIN;
SELECT format('ALTER DATABASE %I RENAME TO %I', '${UAT_DB}_prev', '${UAT_DB}_prev_old') WHERE EXISTS (SELECT 1 FROM pg_database WHERE datname = '${UAT_DB}_prev') \gexec
SELECT format('ALTER DATABASE %I RENAME TO %I', '$UAT_DB', '${UAT_DB}_prev') WHERE EXISTS (SELECT 1 FROM pg_database WHERE datname = '$UAT_DB') \gexec
ALTER DATABASE $NEW RENAME TO $UAT_DB;
COMMIT;
SQL
sudo -u postgres dropdb --if-exists "${UAT_DB}_prev_old" || uat_say "could not drop ${UAT_DB}_prev_old (a session holds it); the swap itself is done"
[ -n "$UNITS" ] && systemctl start $UNITS
[ -n "$TIMERS" ] && systemctl start $TIMERS
STOPPED=0
echo "{\"night\":\"$NIGHT\",\"restored_at\":\"$(date -u +%FT%TZ)\",\"scrub\":\"$(sed -n 's/^-- REVIEWED: //p' "$HERE/scrub.sql")\"}" > /srv/postmark-office/uat-store.json
chown uat:uat /srv/postmark-office/uat-store.json
uat_say "UAT's store is prod's night $NIGHT, scrubbed. The previous copy is ${UAT_DB}_prev until the next run."
