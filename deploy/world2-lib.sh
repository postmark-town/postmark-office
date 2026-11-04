#!/bin/bash
# world2-lib.sh — what every World 2.0 box lane needs before it can do anything.
#
# Sourced, never executed. Four jobs:
#   1. put the store's credentials in the environment WITHOUT a shell expansion
#   2. hand each lane the connection shape its own tool documents
#   3. give every lane the same state-file writer, so the roll-call can read them
#   4. name the DB in exactly one place, so the prod rename is one line
#
# ── THE ONE LINE THE PROD RENAME TOUCHES ────────────────────────────────────
# WORLD2_ENV_FILE below. Today it is /etc/postmark-world2-dev.env, whose
# WORLD2_DB says world2_dev. At cutover a prod env file says world2, and every
# unit, script and manifest row here follows it without an edit. That is why
# the units are named postmark-world2-* and not postmark-world2-DEV-* — the
# unit is the mechanism, the env file is which store it points at.
#
# ── WHY THE CREDENTIALS ARE READ WITH sed AND NOT `.` ───────────────────────
# Measured on the box 2026-08-29, sourcing a sibling env file the ordinary way:
#
#     $ set -a; . /etc/postmark-office.env; set +a
#     line 2: pm_…=jennuhh:limen: command not found
#
# `.` on an env file whose values contain spaces EXECUTES fragments of the
# values. /etc/postmark-world2-dev.env happens to be clean today, but a reader
# cannot tell that from here, and the failure is silent-then-catastrophic
# rather than loud. sed extracts a value; it never runs one.
#
# ── TWO CONNECTION SHAPES, BECAUSE THE PENS DISAGREE ────────────────────────
# This is not a style choice; it is a fact about the tools, found by reading
# them rather than by trusting the call that passes between them.
#
#   law-ingest.mjs:429   const client = new pg.Client();   // PGHOST/PGDATABASE/PGUSER/PGPASSWORD
#   stamp-ingest.mjs:161 const client = new pg.Client();   // the same
#   clearing-job.mjs:62  new pg.Client({ connectionString: process.env.WORLD2_CLEARING_URL })
#   snapshot-export.mjs  new pg.Client({ connectionString: process.env.WORLD2_PG_URL })
#
# and clearing-job.mjs:58, handing off to the stamp pen for its first step:
#
#   { stdio: "inherit", env: { ...process.env, WORLD2_PG_URL: process.env.WORLD2_INGEST_URL } }
#
# THAT HAND-OFF IS INERT. stamp-ingest never reads WORLD2_PG_URL — it takes
# PG*. So the clearing's own first step connects as whatever PG* says, and if
# PG* says nothing it connects as the OS user to a database named after them
# and dies. The clearing lane therefore sets PG* to law_ingester deliberately,
# and carries clearing_job's own credential IN its URL where the PG* fallback
# cannot reach it. Get that backwards and the clearing connects as the ingester
# — which has no grant to transition a claim, so it would fail loudly rather
# than quietly, but it would fail every window until someone read this note.
#
# The password rides inside WORLD2_CLEARING_URL / WORLD2_PG_URL because those
# two clients take a connection string and PG* is already spoken for. The
# passwords were checked against [A-Za-z0-9._~-] on the box (all five, 48 chars,
# all URL-safe), so no percent-encoding pass stands between the file and the
# URL. If a future rotation issues a password with a `@` or `/` in it, THIS is
# the line that has to learn encoding first.
#
# Nothing here runs under `set -x`, and that is load-bearing rather than
# incidental: the journal is readable by group adm, and a trace of these
# functions would print the URLs.

WORLD2_ENV_FILE="${WORLD2_ENV_FILE:-/etc/postmark-world2-dev.env}"
WORLD2_LAB="${WORLD2_LAB:-/srv/world2-lab}"

# ── ONE TREE PER BOX (2026-09-10) ───────────────────────────────────────────
# This default was `$WORLD2_LAB/office` and it cost a crossing.
#
# THE MEASUREMENT. On 2026-09-10 the 05:45Z scheduled crossing published GREEN
# under release/2026-w37.9 and `escrow_projection` held ZERO rows after the same
# timer's clearing. `$WORLD2_LAB/office` is a SECOND office checkout at 7926461
# (2026-09-05, schema <= 012, no escrow ingest) that the release workflow never
# deploys — release-train.yml rsyncs the tag into /srv/postmark-office and
# nowhere else. Four lanes read this one line, so all four were running a tree
# three days behind the release while every heartbeat on the board read fresh.
#
# /srv/postmark-office IS the deployed release, and it is the only tree on this
# box that anything keeps up to date. `$WORLD2_LAB/office` is named here ONLY as
# the retired one: do not point a lane back at it, and if a checkout is still
# sitting there, it is residue rather than a fallback.
#
# THE UNITS SAY IT TOO, and that redundancy is deliberate: this file reaches the
# box as a HAND FILE COPY (DEPLOY.md § Where things live — "a plain file copy
# from this repo"), so a box whose copy is old still has the old default. The
# drop-in `deploy/postmark-world2-office-tree.conf` sets WORLD2_OFFICE in the
# units, where `systemctl cat` shows it and the roll-call's tree rows read it
# back. Between the two, the environment is the one that wins here — the
# roll-call therefore judges the environment and refuses to guess this default
# (deploy/box-rollcall-manifest.json § trees, `require_env`).
WORLD2_OFFICE="${WORLD2_OFFICE:-/srv/postmark-office}"

WORLD2_STATE_DIR="${WORLD2_STATE_DIR:-$WORLD2_LAB/state}"

# Reads one key. THE ENVIRONMENT WINS, and that is the ordinary path under
# systemd: /etc/postmark-world2-dev.env is root:root 0600 and these units run
# as meepo, so the units carry `EnvironmentFile=` and systemd — which is root —
# does the reading. meepo never needs the file open, and the file never needs
# its mode loosened to make a lane work. That was the alternative and it is the
# wrong trade: a credential file relaxed for a timer stays relaxed for
# everything else on the box forever.
#
# The sed fallback is for a HAND-RUN by someone who can already read the file
# (`sudo -u meepo` will find nothing; `sudo bash world2-backup.sh` will).
# Never sources it — see the note above. Prints nothing on a miss, so the
# caller's own check is the one that speaks.
w2_secret() {
  local from_env="${!1:-}"
  if [ -n "$from_env" ]; then printf '%s' "$from_env"; return 0; fi
  sed -n "s/^$1=//p" "$WORLD2_ENV_FILE" 2>/dev/null | head -n1
}

# The database name lives in the credential file when it is there, and falls
# back to the dev store's name so a hand-run on today's box needs no argument.
w2_db() {
  local d; d="$(w2_secret WORLD2_DB)"
  echo "${d:-world2_dev}"
}

# w2_url <role> <PG_..._PASSWORD key> — the connection-string shape, for the
# two pens that take one.
w2_url() {
  local pw; pw="$(w2_secret "$2")"
  [ -n "$pw" ] || { echo "[world2] $2 unreadable from $WORLD2_ENV_FILE" >&2; return 2; }
  echo "postgres://$1:$pw@${WORLD2_PGHOST:-localhost}:${WORLD2_PGPORT:-5432}/$(w2_db)"
}

# w2_pgenv <role> <PG_..._PASSWORD key> — the PG* shape, for the two pens that
# take that instead. Exports; call it before the tool, not in a subshell.
w2_pgenv() {
  local pw; pw="$(w2_secret "$2")"
  [ -n "$pw" ] || { echo "[world2] $2 unreadable from $WORLD2_ENV_FILE" >&2; return 2; }
  export PGHOST="${WORLD2_PGHOST:-localhost}" PGPORT="${WORLD2_PGPORT:-5432}"
  export PGDATABASE="$(w2_db)" PGUSER="$1" PGPASSWORD="$pw"
}

# THE STATE FILE. Every lane writes one, because the roll-call's state_file
# heartbeat is the strong one — it proves the run REACHED ITS END, where a
# unit_trigger heartbeat only proves systemd tried. Written atomically so a
# reader never catches a half-file, and written on failure too: a lane that
# ran and refused must be distinguishable from a lane that never ran, and only
# the file can tell those apart.
#
# Usage: w2_state <name> <json-object-without-braces>
w2_state() {
  local name="$1"; shift
  mkdir -p "$WORLD2_STATE_DIR"
  local tmp="$WORLD2_STATE_DIR/.$name.$$"
  printf '{"at":"%s",%s}\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" > "$tmp"
  mv -f "$tmp" "$WORLD2_STATE_DIR/$name"
}

# JSON string escaping for detail text that came from a tool's stderr.
w2_json_escape() {
  python3 -c 'import json,sys; sys.stdout.write(json.dumps(sys.stdin.read().strip()[-600:]))'
}

# Ship one night's files to S3 (STAR-118; Darko 2026-11-04 09:03: "the real solution is 2", an S3 bucket in the
# box's own account, written by the instance's role, which can put and get but never delete; versioning keeps an
# overwritten object, and the bucket's lifecycle trims, so the box holds no delete right at all).
# Usage: w2_ship_s3 <bucket> <prefix> <file>...  each existing file goes to s3://<bucket>/<prefix>/<its name>; a
# missing file is skipped. Prints how many went; returns 3 with no aws CLI, 1 on the first failed upload.
w2_ship_s3() {
  local bucket="$1" prefix="$2"; shift 2
  command -v aws >/dev/null 2>&1 || { echo "no aws CLI on this box" >&2; return 3; }
  local n=0 f
  for f in "$@"; do
    [ -f "$f" ] || continue
    aws s3 cp --only-show-errors --no-progress "$f" "s3://$bucket/$prefix/$(basename "$f")" || return 1
    n=$((n + 1))
  done
  echo "$n"
}
