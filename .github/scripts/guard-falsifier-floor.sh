#!/usr/bin/env bash
# guard-falsifier-floor.sh — make a world2 database on the CI Postgres and apply
# the floor to it. Used by .github/workflows/guard-falsifier.yml and by nothing
# else; it is workflow machinery, not an office tool, and no unit lists it.
#
#   guard-falsifier-floor.sh <database> [--fresh]
#
#   --fresh   drop the database first. The falsifier plants its population through
#             the live pen, so every run after the first gets a fresh scratch — a
#             rerun over the first run's rows would be measuring leftovers.
#
# The floor is every world2/schema/NNN_*.sql in name order, as world2_owner (the
# prod idiom is `SET ROLE world2_owner` — README § Applying a migration; the same
# owner either way), except 003, which is not a migration: it is the three-pens
# falsifier query. A migration that fails here fails the run, by name.
#
# libpq's PGHOST/PGPORT/PGUSER/PGPASSWORD come from the job's env (PGUSER is the
# service's superuser; the migrations themselves run as the owner).
set -euo pipefail

DB="${1:?usage: guard-falsifier-floor.sh <database> [--fresh]}"
FRESH="${2:-}"

if [ "$FRESH" = "--fresh" ]; then
  psql -v ON_ERROR_STOP=1 -d postgres -qc "DROP DATABASE IF EXISTS $DB"
fi
psql -v ON_ERROR_STOP=1 -d postgres -qc "CREATE DATABASE $DB OWNER world2_owner"

n=0
for f in world2/schema/[0-9]*.sql; do
  case "$f" in *003_falsifier_roles.sql) continue ;; esac
  PGUSER=world2_owner psql -v ON_ERROR_STOP=1 -q -d "$DB" -f "$f"
  n=$((n + 1))
done
echo "$DB: ${FRESH:+fresh, }$n migrations applied"
