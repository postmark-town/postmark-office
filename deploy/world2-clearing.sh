#!/bin/bash
# world2-clearing.sh — THE CANDLE CLOSES ITSELF.
#
# Windows 149..155 were closed by a person typing `node world2/tools/clearing-
# job.mjs --window N` at whatever hour they happened to look. That is not a
# cadence, it is a habit, and a habit does not survive the person. This is the
# runner that ends it.
#
# LAW (world main, `LOGOS/classes.md § crossing ②` — the keeper's settlement,
# amended 2026-09-17 by keeminlee/postmark-world#96): windows close 06:00Z and
# 18:00Z from the w39 ship (2026-09-21), 05:45Z and 17:45Z until then. The timer
# carries those two marks and nothing else.
#
# THE LAW LIVES IN THE WORLD TREE, NOT IN A PLAN. Earlier drafts of this header
# cited `census.md Decision 3`; that is the postmark-world-2 gold plan, signed
# 2026-08-28, kept in Starstory PULSE and absent from the world repo entirely —
# and its Decision 3 still reads "05:45Z / 17:45Z, one cadence for all claim
# classes", unamended. A plan that proposed a cadence is not the line that
# carries it, and a citation pointing at the plan cannot be checked by anyone
# holding the world.
#
# They were 05:45Z / 17:45Z from the cadence's birth until the w39 ship — fifteen
# minutes of head start so the Worldkeeper's :00 heartbeat would read a finished
# receipt — while his own constitution (Rulings 8 and 9) and the World's bulletin
# both said the town crosses at 06:00 and 18:00. The statement is now true. The
# heartbeat moved to :20 to keep its side of the bargain.
#
# ⚑ THE TIMER MOVE ALONE DOES NOT MOVE THE WINDOWS — see the chaining note
# below, which is the same property read from the other side. One deliberate
# write re-anchors the chain: `world2/tools/window-reanchor.mjs --apply`, by
# hand, once.
#
# ── WHICH WINDOW, AND WHY THE SCRIPT AND NOT THE TIMER DECIDES ──────────────
# clearing-job.mjs takes `--window N`. A timer cannot know N. So this asks the
# store: the open window whose closes_at has passed. That phrasing matters —
# it means a box that was down for two days closes the windows it owed, in
# order, on its next tick, instead of skipping them silently. The loop is
# bounded (W2_MAX_CATCHUP) because a runner that would close a hundred windows
# unattended is a runner nobody would let near prod.
#
# It also means the cadence self-heals rather than drifting: clearing-job opens
# N+1 at `win.closes_at`, not at now() —
#
#     INSERT INTO windows (id, opens_at, closes_at, status)
#     VALUES ($1, $2, $2::timestamptz + interval '12 hours', 'open')
#
# so a window closed eight hours late still leaves its successor on the marks it
# already had. A late run costs lateness, never alignment.
#
# ⚑ AND THAT IS WHY MOVING THE TIMER CANNOT MOVE THE WINDOWS. The same property
# that makes the cadence immune to a late box makes a DELIBERATE move impossible
# from here: a timer at :00 finds a window still due at :45, closes it fifteen
# minutes after its own boundary, and writes a successor due at :45 again —
# forever, with the store's rows contradicting the law. `world2/tools/window-
# reanchor.mjs` is the one write that moves the chain onto the law's mark; the
# `+ 12 hours` rule above is untouched and carries it from there.
#
# ── THE FIRST STEP IS NOT THIS TOOL ─────────────────────────────────────────
# clearing-job.mjs § its own header, verbatim:
#
#   LAW (census.md seams amendment): stamp ingest runs "again as clearing_job's
#   first step" at window close, then the window pins law_sha + town_sha —
#   outcomes reproducible from (claims, law_sha, town_sha).
#
# and it does it itself, in code, when handed a checkout:
#
#   if (townRepo && !has("--dry-run")) {
#     const sha = execFileSync("git", ["-C", townRepo, "rev-parse", "HEAD"], …);
#     execFileSync(process.execPath, [join(HERE, "stamp-ingest.mjs"), …
#
# THE CLEARING INGESTS FOR ITSELF, for the town half. That is why --town-repo
# is always passed here and never omitted as an optimization: the ingest timer
# is the advisory rail, this is the authoritative one, and a clearing must
# never depend on a poll having happened.
#
# NOTE THE ASYMMETRY, because it is the one thing this arrangement does not
# cover: there is no matching law-ingest first step. The clearing reads
# `projection_heads` for world-law and REFUSES if it is null. So a dead law
# ingest does not corrupt a clearing — it stops one, loudly. See below.
#
# ── A REFUSAL MUST BE LOUD ──────────────────────────────────────────────────
# The null-pin guard (clearing-job.mjs, verbatim):
#
#   if (pending.some((c) => (c.stake ?? 0) > 0) && !townSha)
#     throw new Error("no town projection head — staked claims cannot be judged…")
#   if (pending.length && !lawSha)
#     throw new Error("no world-law projection head — a clearing computes against law-as-of a sha…")
#
# When that fires, this script exits NON-ZERO. That is deliberate and it is the
# whole reporting design: the roll-call reads the service result, so a refusal
# surfaces on the 8am board as
#
#   ALARM-failed  postmark-world2-clearing.timer  … result=exit-code exit=1
#
# exactly the way the ferry's failure does. The state file carries the reason
# text so the operator does not have to open the journal to know which guard
# fired. A refusal that only wrote a state file would be a red nobody reads.
#
# NOTHING DUE is not a failure and exits 0 — but it still stamps the state
# file, because "ran, found nothing owed" and "did not run" must not look alike.

set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/world2-lib.sh"

MAX_CATCHUP="${W2_MAX_CATCHUP:-6}"
TOWN_CLONE_DIR="$WORLD2_LAB/ingest-clones/town"
WORLD_CLONE_DIR="$WORLD2_LAB/ingest-clones/world"

# PG* becomes the LAW INGESTER, for the first step the clearing shells out to
# (world2-lib.sh § two connection shapes — the WORLD2_INGEST_URL hand-off in
# clearing-job.mjs:58 is inert, so this is what the stamp pen actually reads).
if ! w2_pgenv law_ingester PG_LAW_INGESTER_PASSWORD; then
  w2_state clearing.json '"status":"cannot-run","detail":"PG_LAW_INGESTER_PASSWORD unreadable"'
  exit 2
fi
# …and the clearing carries its own credential in its URL, where PG* cannot
# reach it and swap the role out from under the transaction.
#
# ── ONE FILE OWNS THE CLEARING CREDENTIAL (office #26, 2026-09-12) ──────────
# /etc/postmark-world2-clearing.env carries WORLD2_CLEARING_URL, and BOTH units
# that hold the clearing pen read it by EnvironmentFile= — this one and
# postmark-settlement.service. On 2026-09-11 the role was rotated and the new
# password reached the settlement's drop-in and not this script's env file, so
# the 05:45Z candle could not log in. Two copies of one secret is the class; the
# fix is that there is one. Rotation is: ALTER ROLE, rewrite that one file,
# systemctl daemon-reload — both units follow. The compose-from-password arm
# stays for a box that carries only the world2 env file (a rehearsal, a dev
# box); on prod that arm is never reached and PG_CLEARING_JOB_PASSWORD no
# longer exists in /etc/postmark-world2-dev.env.
if [ -n "${WORLD2_CLEARING_URL:-}" ]; then
  CLEARING_URL="$WORLD2_CLEARING_URL"
  # THE PROD RENAME HAS TWO EDITS NOW, AND THIS IS THE GUARD THAT SAYS SO. The
  # shared file carries the database name inline, so `w2_db` no longer governs
  # which store the clearing pen writes to. At cutover an env file that says
  # WORLD2_DB=world2 beside a shared file still naming world2_dev would clear
  # windows in the dev store while every other unit moved — and report
  # "cleared" the whole time (PR #29 review, 2026-09-12). So the two must agree,
  # and a disagreement is cannot-run, never a guess about which one is right.
  # NOTHING DERIVED FROM THE URL IS EVER PRINTED (PR #29 review, second pass):
  # "the part after the last slash" of a URL with no database path is the
  # authority, password included, and this script's stderr is the journal
  # (world2-lib.sh's header: readable by group adm). So the database is taken
  # as the path segment AFTER the authority — empty when there is none — and
  # only WORLD2_DB's own value is ever named, on either side of the compare.
  url_rest="${CLEARING_URL#*://}"
  case "$url_rest" in */*) url_db="${url_rest#*/}" ;; *) url_db="" ;; esac
  url_db="${url_db%%\?*}"; url_db="${url_db%%/*}"
  if [ -z "$url_db" ] || [ "$url_db" != "$(w2_db)" ]; then
    echo "[world2-clearing] the shared clearing file names no database, or one that is not WORLD2_DB ('$(w2_db)') — refusing to clear against a store the other units are not on" >&2
    w2_state clearing.json "\"status\":\"cannot-run\",\"detail\":$(printf '%s' "WORLD2_CLEARING_URL names no database, or one that is not WORLD2_DB ($(w2_db)) — the prod rename needs both files" | w2_json_escape)"
    exit 2
  fi
else
  CLEARING_URL="$(w2_url clearing_job PG_CLEARING_JOB_PASSWORD)" || {
    w2_state clearing.json '"status":"cannot-run","detail":"neither WORLD2_CLEARING_URL (the shared file) nor PG_CLEARING_JOB_PASSWORD is readable"'
    exit 2
  }
fi

# The town checkout the first step needs. Refreshed here rather than trusted,
# because a stale checkout would pin the window to a sha the town has moved
# past — the outcome would still be reproducible, just reproducibly wrong.
if ! "$HERE/world2-refresh-clone.sh" town >/tmp/w2-clearing-town.log 2>&1; then
  echo "[world2-clearing] town checkout refresh FAILED — refusing to clear against a sha I cannot vouch for" >&2
  cat /tmp/w2-clearing-town.log >&2
  w2_state clearing.json "\"status\":\"cannot-run\",\"detail\":$(w2_json_escape < /tmp/w2-clearing-town.log)"
  exit 2
fi

# due_window — sets DUE to the id of the open window past its close, or to the
# empty string when there is none. Deliberately NOT a `$(...)` function: a
# subshell cannot end the script, and a failed ask must.
#
# ── THE CHECK THAT COULD NOT FAIL (office #26, the refused 05:45Z crossing) ──
# Until 2026-09-12 this was `psql … 2>/dev/null` inside a `$(...)`, so a query
# that FAILED and a query that found NOTHING were the same empty string: the
# candle could not log in, read the silence as "nothing due", and exited 0 with
# a plausible sentence while Postgres logged three FATALs in the same minute.
# The settlement's 240 s wait caught it; the candle should have. Now psql's
# exit is read, and non-zero ends the run as cannot-run (exit 2) with the
# stderr in the state file — the same shape as the two credential guards above.
due_window() {
  local err rc
  err="$(mktemp)"
  DUE="$(psql "$CLEARING_URL" -tAc \
    "SELECT id FROM windows WHERE status = 'open' AND closes_at <= now() ORDER BY id LIMIT 1" 2>"$err")"
  rc=$?
  if [ "$rc" -ne 0 ]; then
    echo "[world2-clearing] the store could not be asked which window is due (psql exit $rc): $(tr '\n' ' ' < "$err")" >&2
    w2_state clearing.json "\"status\":\"cannot-run\",\"detail\":$( { printf 'due_window: psql exit %s: ' "$rc"; cat "$err"; } | w2_json_escape)"
    rm -f "$err"
    exit 2
  fi
  rm -f "$err"
}

# ── THE BOUNDARY WAIT (the founder's clock catch, 2026-09-02) ───────────────
# The windows' boundaries rode at :45:40 — the genesis offset — while the
# timer fired on the :45:00 marks. So "the open window whose closes_at has
# passed" found only the PREVIOUS window, and every close ran a full cycle
# late: 163 closed 09-02 05:45Z, twelve hours after its own boundary; 164 the
# same at 17:45Z. The marks stay the timer's (`LOGOS/classes.md § crossing ②`
# is the law); this
# waits out the offset instead of moving the marks. Bounded at 90s, and a run
# that starts with a window already due (catch-up, a hand run) waits zero.
#
# ⚑ AFTER THE w39 SHIP, IN TWO STAGES, AND THIS LOOP IS RIGHT FOR BOTH. With the
# timer on :00 and the chain still on :45:40, the boundary is fourteen minutes
# BEHIND the timer, so `due_window` answers on the first check and this waits
# zero. Once `window-reanchor.mjs` puts the chain on :00:00 the genesis offset is
# gone entirely and boundary and timer coincide, which is a race of milliseconds
# rather than forty seconds — still a race, so the loop stays exactly as it is.
for _ in $(seq 1 18); do
  due_window; [ -n "$DUE" ] && break
  sleep 5
done

# ── THE WORLD CHECKOUT THE PARCEL CAP IS READ FROM (POS-98 box 4) ───────────
#
# The candle's new step 5.6 asks the world's own `PARCEL_CLAIM_CAP`,
# `PARCEL_CAP_LAW_DATE` and `PARCEL_CAP_EXCEPTIONS` out of a checkout — the same
# route the notary already takes for `falsifier-canon-locks.mjs --world-repo`,
# and the same clone. It is an ARGUMENT and not an env key: `WORLD_CLONE` lives
# in /etc/postmark-office.env and this unit reads
# /etc/postmark-world2-dev.env plus -/etc/postmark-world2-clearing.env, so an env
# key would simply have been absent and the gate would have been quietly off.
#
# ⚑ A REFRESH THAT FAILS OMITS THE ARGUMENT RATHER THAN PASSING A STALE TREE,
# and that direction is the whole judgement here. A stale checkout is not a
# slightly-old cap — it is an old EXCEPTIONS MAP, and the exceptions are the
# founder's individual rulings: Mari's parcel, the Reeves' gauge house, deva's
# household's five. Asking a law that predates a grant refuses ground its owner
# was given by name. Omitting the argument instead leaves the claim to lock and
# the sweep to judge it, which is exactly what happens today — no worse than the
# state this step improves on, and the window's receipt says `checked: false`
# with the reason rather than going quiet.
if "$HERE/world2-refresh-clone.sh" world >/tmp/w2-clearing-world.log 2>&1; then
  WORLD_REPO_ARG=(--world-repo "$WORLD_CLONE_DIR")
else
  WORLD_REPO_ARG=()
  echo "[world2-clearing] world checkout refresh FAILED — the parcel cap will not be asked this run; parcel claims lock unchecked and the sweep remains their gate. The window receipt carries \`parcel_cap.checked: false\`." >&2
  cat /tmp/w2-clearing-world.log >&2
fi

closed=0
last_out=""
rc=0
for _ in $(seq 1 "$MAX_CATCHUP"); do
  due_window; win="$DUE"
  [ -n "$win" ] || break

  echo "[world2-clearing] closing window $win"
  # errexit is deliberately OFF for this whole script (see `set -uo pipefail`
  # above, with no -e): a non-zero from the clearing is a VERDICT this script
  # has to read, record and re-raise with its reason attached, not a signal to
  # die at the call site with nothing written down.
  last_out="$(cd "$WORLD2_OFFICE" && \
    WORLD2_CLEARING_URL="$CLEARING_URL" \
    node world2/tools/clearing-job.mjs --window "$win" --town-repo "$TOWN_CLONE_DIR" "${WORLD_REPO_ARG[@]}" 2>&1)"
  rc=$?          # BEFORE any pipe. $? after `cmd | tee` is tee's, not the tool's.
  echo "$last_out"

  if [ "$rc" -ne 0 ]; then
    echo "[world2-clearing] REFUSED/FAILED on window $win (exit $rc) — nothing moved (one transaction)" >&2
    w2_state clearing.json \
      "\"status\":\"refused\",\"window\":$win,\"exit\":$rc,\"closed_this_run\":$closed,\"detail\":$(printf '%s' "$last_out" | w2_json_escape)"
    exit "$rc"
  fi
  closed=$((closed + 1))
done

if [ "$closed" -eq 0 ]; then
  w2_state clearing.json '"status":"nothing-due","closed_this_run":0'
  echo "[world2-clearing] no window past its close — nothing due"
  exit 0
fi

w2_state clearing.json \
  "\"status\":\"cleared\",\"closed_this_run\":$closed,\"detail\":$(printf '%s' "$last_out" | w2_json_escape)"
echo "[world2-clearing] closed $closed window(s)"
exit 0
