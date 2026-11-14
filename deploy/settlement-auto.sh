#!/bin/sh
# settlement-auto.sh — the settlement's MECHANISM, box-side (Keemin-ruled
# 2026-08-17: settlements run like mail crossings, a timer on the box).
#
# ── WHAT IT IS SINCE POS-1025: THE SETTLEMENT PRINTS ITSELF ─────────────────
#
# Darko, 2026-11-13 09:08 EST, POS-365/a "Printout only": git becomes a printout
# of each settlement, and the settlement cuts its own tag. POS-1025/a "Every
# settlement": every seal is numbered, a retry keeps its number, a settlement
# never printed leaves a gap, the tag is cut only once the printout succeeds,
# and old tags are never rewritten. POS-1025/c "Report only": what publishes
# is decided inside the settlement and stays fixed; after the seal the checks
# only raise alarms.
#
# So every decision is made before this script runs. The clearing
# (world2/tools/clearing-job.mjs) folds the window, decides the owner's
# withdrawals and the commons unpublish (step 7.5, settlement-decides.mjs),
# keeps the publications registry, numbers the settlement and seals it. This
# script waits for that seal and prints it:
#
#   fetch the town at a pinned sha, and world main
#   re-derive the household registry (its own commit, as before)
#   wait for the candle to seal the closing window (await-clearing)
#   photograph the window's acts (STATE/log), as before
#   PRINT the sealed snapshot onto main   world2/tools/settlement-printout.mjs print
#   the harm gate, REPORTED               an alarm on the receipt, never a hold
#   push main (fast-forward, with the disjoint-path salvage)
#   TAG settlement/S<n> at the pushed printout, and push the tag (never moved)
#   RECORD the printout in the store      record_printout: the world-marks head
#   the grammar suite, REPORTED           a warning, as since 2026-09-16
#
# ── WHAT WENT, AT THIS CUTOVER (one retirement, no legacy flag) ─────────────
#
# The git source (`SETTLEMENT_SOURCE=git`) and its drain; the store's
# write-down into local sketchbooks; the World's sweep, which decided after the
# seal; the isolation pass and the surveyed reading, which read the sweep; the
# retire step (retire-unpublished.mjs), whose decision the clearing now makes
# before its seal. `SETTLEMENT_SOURCE` is still read so a unit file that sets
# `store` keeps working; any other value refuses, by name. There is no rollback
# flag: the rollback is the release before this one, with DEPLOY § 095's notes.
#
# A crossing that refuses publishes nothing and exits 1 loudly. A refused
# printout leaves its settlement unprinted, a gap in the tags; the next
# crossing's delta is measured from the last printout that succeeded, so it
# carries every canonical change since then and nothing is lost.
#
# Env (unit): TOWN_CLONE, WORLD_CLONE (origin URL discovery only);
#   WORLD2_PG=1 + WORLD2_PG_URL (the docket, the photograph and the receipt
#   record read the store); WORLD2_CLEARING_URL (the printout reads the seal
#   and records the printout as clearing_job, /etc/postmark-world2-clearing.env).
#   OFFICE_ROOT        the office checkout (default /srv/postmark-office)
#   SETTLEMENT_CLONE   the printout's own clone (default $OFFICE_ROOT/settlement-clone)
#   SETTLEMENT_REPORT  the receipt path (default /srv/postmark-harbor/settlement-auto.json)
#   SETTLEMENT_HISTORY the rolling receipt log (default beside the receipt, .jsonl)
#   SETTLEMENT_REGISTRY 0 disables the household registry refresh (a bypass, named
#                      on the receipt as `ran: false`)
#   SETTLEMENT_ADMIN_REFRESH 1 runs tools/admin-refresh.mjs --apply first (WLD-21)
#   SETTLEMENT_SINCE_WINDOW  the cutover's one argument: the window whose world the
#                      last sweep printed, so the first printout has a base
#                      (DEPLOY § 095). Unset on every later crossing.
#   SETTLEMENT_RACE_ATTEMPTS  how many times a LOST RACE re-runs the whole crossing (default 3)
#   SETTLEMENT_ATTEMPT set by the retry wrapper on each child; never set it by hand
#   SETTLEMENT_DRY     1 runs the whole crossing to its receipt and writes nothing
#                      outside its own clone and that receipt — see § THE DRY LEG.
# Cwd: $OFFICE_ROOT. Exit: 0 published/quiet · 1 refused · 2 race.

set -eu
OFFICE="${OFFICE_ROOT:-/srv/postmark-office}"
TOWN="${TOWN_CLONE:-$OFFICE/town-clone}"
CLONE="${SETTLEMENT_CLONE:-$OFFICE/settlement-clone}"
OUT="${SETTLEMENT_REPORT:-/srv/postmark-harbor/settlement-auto.json}"
HISTORY="${SETTLEMENT_HISTORY:-${OUT%.json}-history.jsonl}"
STAMP="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT

# THE SOURCE IS THE STORE, AND THAT IS NO LONGER A SWITCH. Read once so a unit
# file that still says `store` keeps working, and so a box that still says `git`
# is told the path is gone rather than silently crossing another way.
case "${SETTLEMENT_SOURCE:-store}" in
  store) ;;
  *) echo "[settlement-auto] SETTLEMENT_SOURCE=\"${SETTLEMENT_SOURCE:-}\" — the git source and its drain were retired at the printout cutover (POS-1025); the settlement prints from the store's sealed snapshot. Remove the line from the unit's environment; refusing" >&2; exit 1 ;;
esac

# ── A RERUN BY HAND IS A FLAGGED ACT, NEVER A LOOSER TIMER (postmark#2786) ────
#
# The operator's second door: with this set, the docket read takes the newest
# CLOSED window that is still unprinted rather than a window that cleared during
# this crossing's own wait. It is never the unit's default and never the
# timer's: `postmark-settlement-by-hand.service` sets it, carries no timer, and
# is started by a person, and the receipt carries `by_hand: true`.
BY_HAND="${SETTLEMENT_BY_HAND:-0}"
case "$BY_HAND" in
  0|1) ;;
  *) echo "[settlement-auto] SETTLEMENT_BY_HAND=\"$BY_HAND\" is not \`0\` or \`1\` — refusing rather than guessing whether this crossing is a person's act" >&2; exit 1 ;;
esac
# `if`, not `[ … ] && echo`: under `set -e` a one-liner whose test is false is
# a non-zero last command and takes the whole crossing down.
if [ "$BY_HAND" = "1" ]; then
  echo "[settlement-auto] BY HAND — this crossing is an operator's act; the docket is the newest unprinted window, not a fresh close" >&2
fi

# ── THE DRY LEG (POS-242) ────────────────────────────────────────────────────
#
# `SETTLEMENT_DRY=1` runs the same steps in the same order to the same receipt,
# and every act that leaves this run is WITHHELD and named on that receipt:
#
#   world main's push            publish_main
#   the printout's commit        `print --dry-run` writes the files and commits
#                                nothing, so the harm gate still reads them
#   the tag and its push         `tag --dry-run` names the tag it would cut
#   the store's record           record_printout is not called
#   the photograph's commit      state-log-write --write gets --dry-run
#   every escalation             no GitHub issue, and no lookup either
#   the history line             the roll-call and `--recurring` read that log
#   the public receipt           /srv/postmark-harbor is served
#   the suite log                beside the dry receipt, never in the office
#
# ITS OWN CLONE AND ITS OWN RECEIPT, NAMED, and a clone the dry leg makes for
# itself is given no credential helper, so even a push this list missed has
# nothing to push with.
DRY="${SETTLEMENT_DRY:-0}"
case "$DRY" in
  0|1) ;;
  *) echo "[settlement-auto] SETTLEMENT_DRY=\"$DRY\" is not \`0\` or \`1\` — refusing rather than guessing whether this crossing may write" >&2; exit 1 ;;
esac
if [ "$DRY" = "1" ]; then
  case "${SETTLEMENT_REPORT:-}" in
    "") echo "[settlement-auto] SETTLEMENT_DRY=1 needs its own SETTLEMENT_REPORT — the default is the public receipt; refusing" >&2; exit 1 ;;
    /srv/postmark-harbor/*) echo "[settlement-auto] SETTLEMENT_DRY=1 will not write a receipt under /srv/postmark-harbor — that directory is served; refusing" >&2; exit 1 ;;
  esac
  if [ -z "${SETTLEMENT_CLONE:-}" ] || [ "$CLONE" = "$OFFICE/settlement-clone" ]; then
    echo "[settlement-auto] SETTLEMENT_DRY=1 needs its own SETTLEMENT_CLONE — the live clone is the timer's working tree; refusing" >&2; exit 1
  fi
  echo "[settlement-auto] *** DRY RUN *** every write that leaves this run is withheld and named on the receipt at $OUT" >&2
fi
# One line per withheld act, read by the receipt. Under DRY=0 nothing calls it.
withheld() {
  printf '%s\n' "$1" >> "$WORK/withheld"
  echo "[settlement-auto] DRY — withheld: $1" >&2
}

# One-time: a dedicated settlement clone — never the write pen's checkout.
if [ ! -d "$CLONE/.git" ]; then
  ORIGIN="$(git -C "${WORLD_CLONE:-$OFFICE/world-clone}" remote get-url origin)"
  git clone -q "$ORIGIN" "$CLONE"
  git -C "$CLONE" config user.name  "the settlement (box)"
  git -C "$CLONE" config user.email "postmark-settlement@users.noreply.github.com"
  if [ "$DRY" != "1" ]; then
    git -C "$CLONE" config credential.helper "store --file $OFFICE/.git-credentials"
  fi
fi

# A tool's own "refused — detail" from its JSON answer, else the head of its stderr.
refusal_of() { # json-file err-file
  node -e 'const r=require(process.argv[1]);process.stdout.write(String(r.refused||"unknown")+" — "+String(r.detail||""))' "$1" 2>/dev/null \
    || head -c 200 "$2" | tr '\n"' ' .'
}

# THE RECEIPT. Every channel the crossing has a word for, or the honest absence
# of one — composed by a node helper, never printf'd.
report() { # status detail
  LAST_STATUS="$1"; LAST_DETAIL="$2"
  SETTLEMENT_STATUS="$1" SETTLEMENT_DETAIL="$2" \
  SETTLEMENT_DRY="$DRY" SETTLEMENT_WITHHELD="$WORK/withheld" \
  SETTLEMENT_AT="$STAMP" SETTLEMENT_TOWN_SHA="${TOWN_SHA:-}" \
  SETTLEMENT_WORLD_FROM="${WORLD_FROM:-}" SETTLEMENT_WORLD_TO="${WORLD_TO:-}" \
  SETTLEMENT_TOWN_SNAPSHOT="$([ -d "$WORK/town/.git" ] && printf %s "$WORK/town" || true)" \
  SETTLEMENT_DOCKET_JSON="${DOCKET_JSON:-}" SETTLEMENT_PRINTOUT_JSON="${PRINTOUT_JSON:-}" \
  SETTLEMENT_TAG_JSON="${TAG_JSON:-}" SETTLEMENT_RECORD_JSON="${RECORD_JSON:-}" \
  SETTLEMENT_HARM_JSON="${HARM_JSON:-}" SETTLEMENT_SUITE_JSON="${SUITE_JSON:-}" \
  SETTLEMENT_STATE_LOG_JSON="${STATE_LOG_JSON:-}" SETTLEMENT_STATE_LOG_MODE="${STATE_LOG_MODE:-}" \
  SETTLEMENT_BY_HAND="$BY_HAND" \
  SETTLEMENT_REGISTRY_JSON="${REGISTRY_JSON:-}" SETTLEMENT_REGISTRY_COMMIT="${REGISTRY_COMMIT:-}" \
    node "$OFFICE/deploy/settlement-receipt.mjs" > "$OUT" 2>/dev/null || true
  # THE HISTORY. One line per DECIDED crossing, appended, bounded; the
  # roll-call's settlement row and `--recurring` read it. A dry crossing decided
  # nothing, so it is no line in that log.
  if [ "$DRY" = "1" ]; then return 0; fi
  node "$OFFICE/deploy/settlement-history.mjs" \
    --receipt "$OUT" --history "$HISTORY" --attempt "${SETTLEMENT_ATTEMPT:-}" >/dev/null 2>&1 || true
  record_receipt "${SETTLEMENT_ATTEMPT:-}"
}

# THE RECEIPT IN THE STORE (POS-352): a `crossing_receipts` row for every
# DECIDED crossing. Bookkeeping, so it never fails one.
record_receipt() { # [attempt]
  node "$OFFICE/world2/tools/crossing-receipt.mjs" --receipt "$OUT" --attempt "${1:-}" \
    || echo "[settlement-auto] the receipt was NOT recorded in the store (non-fatal) — the line above names why; the file at $OUT still holds it" >&2
  witness_settlement "${1:-}"
}

# THE WITNESS RECORD (POS-907; town WITNESS.md): every DECIDED crossing is a
# record in the town's witness chain. Never fails the crossing.
witness_settlement() { # [attempt]
  node "$OFFICE/world2/tools/witness-settlement.mjs" --receipt "$OUT" --attempt "${1:-}" \
    --event "$SETTLEMENT_EVENT" --town "$TOWN" --sweep "$CLONE" --lock "${TOWN_LOCK:-$OFFICE/town.lock}" \
    || echo "[settlement-auto] the witness step tripped (non-fatal) — the crossing's outcome stands; the line above names why" >&2
}

# THE ESCALATION, in one place. A crossing is never failed by its own alarm, so
# every call is `|| true`. Under DRY the alarm is named and nobody is told.
escalate() { # --class <class> [args…]
  if [ "$DRY" = "1" ]; then
    withheld "escalation: $2"
    if [ -n "${LAST_STATUS:-}" ]; then report "$LAST_STATUS" "$LAST_DETAIL"; fi
    return 0
  fi
  node "$OFFICE/deploy/settlement-escalate.mjs" "$@" >&2 || true
}

# THE REFUSAL THAT KEEPS COMING BACK: three unsettled crossings in a row reach a
# person, whatever each one said (postmark-world 7f866059, 08-28 to 08-30).
recurring_check() {
  if node "$OFFICE/deploy/settlement-history.mjs" --history "$HISTORY" --recurring 3 >/dev/null 2>&1; then
    echo "[settlement-auto] THIRD UNSETTLED CROSSING IN A ROW — escalating" >&2
    escalate --class recurring-refusal --receipt "$OUT"
  fi
}

# ── THE RACE RETRY (v1 #7, 2026-08-30) ───────────────────────────────────────
#
# A lost race on main is transient by definition, so the whole crossing re-runs
# from FRESH inputs, never a resume. The loop is deploy/settlement-retry.sh (a
# falsifier's first argument); what stays here needs this script's context.
: "${SETTLEMENT_RACE_ATTEMPTS:=3}"
# ONE EVENT, EVERY ATTEMPT (POS-907): set before the wrapper re-execs.
: "${SETTLEMENT_EVENT:=$STAMP}"
export SETTLEMENT_EVENT
if [ -z "${SETTLEMENT_ATTEMPT:-}" ]; then
  sh "$OFFICE/deploy/settlement-retry.sh" "$SETTLEMENT_RACE_ATTEMPTS" sh "$0" "$@" && exit 0
  rc=$?
  [ "$rc" = "2" ] || exit "$rc"
  # THE LAST ATTEMPT'S RECEIPT IS AMENDED, NOT REPLACED: this process fetched
  # nothing, and recomposing would overwrite the child's evidence.
  node -e 'const fs=require("node:fs");const p=process.argv[1];let r={};try{r=JSON.parse(fs.readFileSync(p,"utf8"))}catch{}r.status="race";r.detail=process.argv[2];fs.writeFileSync(p,JSON.stringify(r,null,1)+"\n")' \
    "$OUT" "raced on all $SETTLEMENT_RACE_ATTEMPTS attempts — a write is landing on world main on every pass, so this is contention and not a transient. The settlement stays sealed and unprinted; the next crossing prints it (its delta runs from the last printout), and an operator wanting it sooner can run the unit by hand once the writes quiet down" \
    || true
  node "$OFFICE/deploy/settlement-history.mjs" --receipt "$OUT" --history "$HISTORY" --attempt "" >/dev/null 2>&1 || true
  record_receipt ""
  echo "[settlement-auto] RACED OUT after $SETTLEMENT_RACE_ATTEMPTS attempts — printing nothing" >&2
  escalate --class race --receipt "$OUT"
  exit 2
fi

# THE WITNESS IS OWED FROM HERE (POS-907): this attempt opens its entry before
# it fetches, pushes or writes anything. A dry run decides nothing and opens nothing.
if [ "$DRY" != "1" ]; then
  node "$OFFICE/world2/tools/witness-settlement.mjs" --open --attempt "$SETTLEMENT_ATTEMPT" \
    --event "$SETTLEMENT_EVENT" --town "$TOWN" --pid $$ \
    || echo "[settlement-auto] the witness could not open this attempt (non-fatal) — the line above names why" >&2
fi

# Immutable inputs: the town at a pinned sha. The long-lived town clone is only
# FETCHED here, so its working tree is whatever another hand last left; the
# registry export and the receipt's ledger read are given a private checkout of
# exactly `$TOWN_SHA` (measured 2026-09-09: `5fa468e9` on disk, `4c234d47` on origin).
git -C "$TOWN" fetch -q origin
TOWN_SHA="$(git -C "$TOWN" rev-parse origin/main)"
git clone -q --local --no-checkout "$TOWN" "$WORK/town"
git -C "$WORK/town" checkout -qf "$TOWN_SHA"

# World: main only. The clone's git-era sketchbook refs are inert now (nothing
# reads them), and nothing fetches new ones.
git -C "$CLONE" fetch -qp origin '+refs/heads/main:refs/remotes/origin/main'
WORLD_FROM="$(git -C "$CLONE" rev-parse origin/main)"
git -C "$CLONE" checkout -qf -B main origin/main
git -C "$CLONE" clean -fdq  # a killed run leaves untracked debris; the clone is disposable

# ── THE HOUSEHOLD REGISTRY IS RE-DERIVED AT THE START OF EVERY CROSSING ──────
#                                                        (founder, 2026-09-09)
#
# `WORLD/households.json` is the World's only knowledge of which handles form one
# household, and the fold, the lint and the authorship wall read it as live. It
# is an export of this office's resolver; thirty-three days without a caller
# left it naming 101 handles in 73 households while the town named 157 in 108.
# So the crossing is the caller, here, before the printout's fold reads it. It
# refuses rather than print over a registry it cannot vouch for, and it commits
# on its own (the printout requires a clean world), only when the substance moved.
#
# THE ADMIN ROLE FIRST (WLD-21): tools/admin-refresh.mjs is the role's one
# writer, and nothing here can refuse the crossing (G4). Not on the dry leg.
if [ "${SETTLEMENT_ADMIN_REFRESH:-0}" = "1" ] && [ "$DRY" != "1" ]; then
  if (cd "$OFFICE" && node "$OFFICE/tools/admin-refresh.mjs" --apply) > "$WORK/admin-refresh.log" 2>&1; then
    echo "[settlement-auto] $(tail -n 1 "$WORK/admin-refresh.log")"
  else
    echo "[settlement-auto] ADMIN REFRESH did not run (non-fatal; the last answer stands): $(head -c 300 "$WORK/admin-refresh.log" | tr '\n' ' ')" >&2
  fi
fi
REGISTRY_JSON=""
REGISTRY_COMMIT=""
if [ "${SETTLEMENT_REGISTRY:-1}" = "1" ]; then
  mkdir -p "$WORK/registry/WORLD"
  # The export writes into a SCRATCH world, never straight into the clone.
  if ! (cd "$OFFICE" && node "$OFFICE/tools/world-households-export.mjs" \
        --town "$WORK/town" --world "$WORK/registry") > "$WORK/registry.log" 2>&1; then
    REGISTRY_JSON="$WORK/registry.json"
    node -e 'const fs=require("node:fs");fs.writeFileSync(process.argv[1],JSON.stringify({refused:"the household export tripped",detail:process.argv[2]},null,1)+"\n")' \
      "$REGISTRY_JSON" "$(head -c 400 "$WORK/registry.log" | tr '\n"' ' .')" 2>/dev/null || REGISTRY_JSON=""
    report refused "the household registry could not be re-derived: $(head -c 200 "$WORK/registry.log" | tr '\n"' ' .')"
    echo "[settlement-auto] REGISTRY EXPORT TRIPPED — printing nothing" >&2
    cat "$WORK/registry.log" >&2; recurring_check; exit 1
  fi
  REGISTRY_JSON="$WORK/registry.json"
  if ! node "$OFFICE/deploy/settlement-registry.mjs" \
        --fresh "$WORK/registry/WORLD/households.json" --world "$CLONE" --town-sha "$TOWN_SHA" \
        > "$REGISTRY_JSON" 2>"$WORK/registry.err"; then
    report refused "the household registry refused: $(refusal_of "$REGISTRY_JSON" "$WORK/registry.err")"
    echo "[settlement-auto] REGISTRY REFUSED — printing nothing" >&2
    cat "$REGISTRY_JSON" >&2 2>/dev/null || true; cat "$WORK/registry.err" >&2; recurring_check; exit 1
  fi
  # A REFRESH THAT CHANGED NOTHING COMMITS NOTHING (the export stamps a new
  # `generated_at` every run; settlement-registry.mjs compares the substance).
  if [ "$(node -e 'const r=require(process.argv[1]);process.stdout.write(String(r.changed===true))' "$REGISTRY_JSON")" = "true" ]; then
    node -e 'const r=require(process.argv[1]);process.stdout.write(r.commit_message)' "$REGISTRY_JSON" > "$WORK/registry.msg"
    git -C "$CLONE" add -- WORLD/households.json
    git -C "$CLONE" commit -q -F "$WORK/registry.msg"
    REGISTRY_COMMIT="$(git -C "$CLONE" rev-parse HEAD)"
  fi
  echo "[settlement-auto] registry: $(node -e 'const r=require(process.argv[1]);process.stdout.write(String(r.summary||""))' "$REGISTRY_JSON")" >&2
else
  REGISTRY_JSON="$WORK/registry.json"
  node -e 'const fs=require("node:fs");fs.writeFileSync(process.argv[1],JSON.stringify({ran:false,bypass:true,reason:"SETTLEMENT_REGISTRY=0 — this crossing printed over whatever WORLD/households.json world main already carried"},null,1)+"\n")' \
    "$REGISTRY_JSON" 2>/dev/null || REGISTRY_JSON=""
  echo "[settlement-auto] *** REGISTRY UNVERIFIED (bypass) *** SETTLEMENT_REGISTRY=0 — nothing checked WORLD/households.json against the town this crossing; the printout's fold reads whatever world main already carries" >&2
fi

# ── WAIT FOR THE SEAL ────────────────────────────────────────────────────────
#
# The printout's input IS the clearing's sealed output, so this crossing waits
# for the candle to clear and seal the closing window, then prints it. It WAITS
# rather than INVOKES: the settlement holds no pen on the candle, and a wait that
# times out is a loud finding where an invocation that failed would be a
# settlement holding a half-cleared window. `$STAMP` is this crossing's own
# start, which makes the condition unambiguous (see the tool's header).
# `--by-hand` swaps the QUESTION, not the guard (postmark#2786), and a DRY
# crossing asks the shadow's question (`--rehearse`, the newest closed window).
DOCKET_JSON="$WORK/docket.json"
BY_HAND_FLAG=""
if [ "$BY_HAND" = "1" ]; then BY_HAND_FLAG="--by-hand"; fi
if [ "$DRY" = "1" ] && [ "$BY_HAND" != "1" ]; then BY_HAND_FLAG="--rehearse"; fi
if ! (cd "$OFFICE" && node "$OFFICE/world2/tools/await-clearing.mjs" \
      --since "$STAMP" --timeout-s "${SETTLEMENT_CLEARING_WAIT_S:-240}" $BY_HAND_FLAG) > "$DOCKET_JSON" 2>"$WORK/docket.err"; then
  report refused "this crossing has no sealed window to print: $(refusal_of "$DOCKET_JSON" "$WORK/docket.err")"
  echo "[settlement-auto] NO DOCKET — printing nothing" >&2
  cat "$DOCKET_JSON" >&2 2>/dev/null || true; cat "$WORK/docket.err" >&2
  recurring_check; exit 1
fi
echo "[settlement-auto] docket: window $(node -e 'const d=require(process.argv[1]);process.stdout.write(String(d.window)+" locked at "+String(d.cleared_at)+(d.by_hand?" (TAKEN BY HAND — the newest unfolded window)":" (waited "+String(d.waited_s)+"s)"))' "$DOCKET_JSON")" >&2
DOCKET_WINDOW="$(node -e 'const d=require(process.argv[1]);process.stdout.write(String(d.window))' "$DOCKET_JSON")"

# ── THE ARCHIVE'S EVENT LOG, WRITTEN FROM THE STORE (POS-155) ────────────────
#
# Unchanged by the printout: `world2/tools/state-log-write.mjs` renders the
# window's acts through the drain's own `writeJournalWindow`. `STATE_LOG_SOURCE`
# `sqlite` (the default) only checks and never fails a crossing; `store` writes,
# and the files ride this crossing's push. `SETTLEMENT_STATE_LOG=0` is the
# operator's off switch, so it is read first. The photograph is a commit before
# the printout's, which the harm gate's base below already includes.
STATE_LOG_JSON=""
STATE_LOG_MODE="${STATE_LOG_SOURCE:-sqlite}"
if [ "${SETTLEMENT_STATE_LOG:-1}" = "1" ]; then
  case "$STATE_LOG_MODE" in
    store|sqlite) ;;
    *)
      report refused "STATE_LOG_SOURCE=\"$STATE_LOG_MODE\" is not \`store\` or \`sqlite\` — refusing rather than guessing whether to write the archive; SETTLEMENT_STATE_LOG=0 turns the step off"
      echo "[settlement-auto] STATE_LOG_SOURCE=\"$STATE_LOG_MODE\" is not \`store\` or \`sqlite\` — printing nothing" >&2
      exit 1 ;;
  esac
  STATE_LOG_JSON="$WORK/state-log.json"
  if [ "$STATE_LOG_MODE" = "store" ]; then
    # Committed here and pushed by publish_main, or nowhere: the pen is told
    # TOWN_PUSH=0 (test/settlement-push-after-gate.test.mjs).
    STATE_LOG_DRY_FLAG=""
    if [ "$DRY" = "1" ]; then
      STATE_LOG_DRY_FLAG="--dry-run"
      withheld "the photograph's commit and push (STATE/log, window $DOCKET_WINDOW): rendered, not written"
    fi
    if (cd "$OFFICE" && TOWN_PUSH=0 node "$OFFICE/world2/tools/state-log-write.mjs" \
          --world "$CLONE" --window "$DOCKET_WINDOW" --write $STATE_LOG_DRY_FLAG \
          --last-drained "${STATE_LOG_LAST_DRAINED:-182.2538}" \
          --as-of-world "$WORLD_FROM") > "$STATE_LOG_JSON" 2>"$WORK/state-log.err"; then
      echo "[settlement-auto] photograph: $(node -e 'const r=require(process.argv[1]);const w=r.windows||[];process.stdout.write("window "+String(r.window)+" -> "+w.length+" journal file(s) ["+w.map((x)=>x.crossing).join(", ")+"], "+w.reduce((n,x)=>n+x.lines,0)+" line(s)"+(r.state_commit?" at "+String(r.state_commit).slice(0,9):" (unchanged: "+String(r.state_note||"")+")"))' "$STATE_LOG_JSON" 2>/dev/null || echo 'written')" >&2
    else
      report refused "the photograph could not be written: $(refusal_of "$STATE_LOG_JSON" "$WORK/state-log.err")"
      echo "[settlement-auto] PHOTOGRAPH REFUSED — printing nothing" >&2
      cat "$STATE_LOG_JSON" >&2 2>/dev/null || true; cat "$WORK/state-log.err" >&2
      recurring_check; exit 1
    fi
  else
    # `--check` exits 1 on "not clean", which is a VERDICT; the receipt carries it.
    if (cd "$OFFICE" && node "$OFFICE/world2/tools/state-log-write.mjs" \
          --world "$CLONE" --window "$DOCKET_WINDOW" --check \
          --last-drained "${STATE_LOG_LAST_DRAINED:-182.2538}") > "$STATE_LOG_JSON" 2>"$WORK/state-log.err"; then
      echo "[settlement-auto] state-log check: window $DOCKET_WINDOW clean" >&2
    else
      echo "[settlement-auto] state-log check: window $DOCKET_WINDOW NOT CLEAN or unread (the check never fails a crossing; the receipt carries its verdict)" >&2
    fi
  fi
fi

# THE BASE THE PRINTOUT IS MEASURED AGAINST: main after the registry and the
# photograph, before the printout. The harm gate's `--base`, and what the quiet
# test compares, so neither of those commits can read as a publication.
WORLD_BASE="$(git -C "$CLONE" rev-parse main)"

# ── THE PRINTOUT ─────────────────────────────────────────────────────────────
#
# The sealed snapshot of `$DOCKET_WINDOW`, applied to main as a delta on the last
# printout that succeeded (world2/tools/settlement-printout.mjs § WHAT IT
# PRINTS). It decides nothing. It answers:
#   printed          one `settlement: S<n> printout …` commit on the clone
#   quiet            the seal changed nothing on main; nothing to commit
#   already-printed  this window's printout is recorded: a retry after the
#                    record, so the crossing has nothing left to do but say so
#   dry              DRY: the files are written and nothing is committed
#   refused          by name (a frame that cannot keep a nested mark, a stale
#                    replay, a seal with no number or no base): nothing prints,
#                    the settlement stays unprinted, and the next crossing's
#                    delta carries it
PRINTOUT_JSON="$WORK/printout.json"
PRINT_DRY_FLAG=""
if [ "$DRY" = "1" ]; then PRINT_DRY_FLAG="--dry-run"; fi
if ! (cd "$OFFICE" && node "$OFFICE/world2/tools/settlement-printout.mjs" print \
      --world "$CLONE" --window "$DOCKET_WINDOW" ${SETTLEMENT_SINCE_WINDOW:+--since-window "$SETTLEMENT_SINCE_WINDOW"} $PRINT_DRY_FLAG) \
      > "$PRINTOUT_JSON" 2>"$WORK/printout.err"; then
  report refused "the printout refused: $(refusal_of "$PRINTOUT_JSON" "$WORK/printout.err")"
  echo "[settlement-auto] PRINTOUT REFUSED — window $DOCKET_WINDOW stays sealed and unprinted; the next crossing's delta carries it" >&2
  cat "$PRINTOUT_JSON" >&2 2>/dev/null || true; cat "$WORK/printout.err" >&2
  escalate --class printout --receipt "$OUT"
  recurring_check; exit 1
fi
PRINT_STATUS="$(node -e 'const r=require(process.argv[1]);process.stdout.write(String(r.status))' "$PRINTOUT_JSON")"
SETTLEMENT_N="$(node -e 'const r=require(process.argv[1]);process.stdout.write(String(r.settlement??""))' "$PRINTOUT_JSON")"
echo "[settlement-auto] printout: S$SETTLEMENT_N (window $DOCKET_WINDOW) $PRINT_STATUS$(node -e 'const r=require(process.argv[1]);const s=r.summary;process.stdout.write(s?" — "+s.written+" written, "+s.removed+" removed, "+s.reframed+" re-framed":"")' "$PRINTOUT_JSON")" >&2

# ── THE HARM GATE, REPORTED (POS-1025/c) ─────────────────────────────────────
#
# Founder-ruled 2026-09-16: a crossing was refused only for what it did to
# residents. Since the printout, what publishes was decided inside the
# settlement and sealed, so the gate can no longer hold it; it judges the
# printout and RAISES AN ALARM (the receipt's `harm`, the sentinel's §11 and an
# issue), and the town publishes. `tools/harm-gate.mjs` compares the printed
# tree with `$WORLD_BASE`, reading the printout's delta as the declared acts.
# Only a printout that wrote something is judged: a quiet or already-printed
# settlement changed no mark.
HARM_JSON=""
HARM_RED=0
if [ "$PRINT_STATUS" = "printed" ] || [ "$PRINT_STATUS" = "dry" ]; then
  HARM_JSON="$WORK/harm.json"
  node -e 'const r=require(process.argv[1]);const ids=(xs)=>(xs||[]).filter((x)=>x&&x.id).map((x)=>({id:x.id}));require("node:fs").writeFileSync(process.argv[2],JSON.stringify({published:ids(r.written),unpublished:ids(r.removed),withdrawn:[],reframed:ids(r.reframed)},null,1)+"\n")' \
    "$PRINTOUT_JSON" "$WORK/acts.json"
  if [ ! -f "$CLONE/tools/harm-gate.mjs" ]; then
    node -e 'require("node:fs").writeFileSync(process.argv[1],JSON.stringify({ran:false,could_not_gate:"world "+process.argv[2]+" carries no tools/harm-gate.mjs"},null,1)+"\n")' "$HARM_JSON" "$(git -C "$CLONE" rev-parse --short main)"
    HARM_RED=1
    echo "[settlement-auto] HARM GATE COULD NOT GATE (no tools/harm-gate.mjs at this world sha) — reported; the printout stands" >&2
  elif (cd "$CLONE" && node tools/harm-gate.mjs --repo "$CLONE" --sweep "$WORK/acts.json" --base "$WORLD_BASE" \
          --stakes "$CLONE/.git/printout-stakes.json" --json) > "$HARM_JSON" 2>"$WORK/harm.err"; then
    echo "[settlement-auto] harm gate: NO HARM — $(node -e 'const r=require(process.argv[1]);process.stdout.write(r.checks.map(c=>c.name+(c.note?" ("+c.note+")":"")).join(" · "))' "$HARM_JSON" 2>/dev/null)" >&2
  else
    HARM_RC=$?
    HARM_RED=1
    cat "$WORK/harm.err" >&2
    if [ "$HARM_RC" != "1" ] || [ ! -s "$HARM_JSON" ]; then
      node -e 'require("node:fs").writeFileSync(process.argv[1],JSON.stringify({ran:false,could_not_gate:process.argv[2]},null,1)+"\n")' "$HARM_JSON" "$(head -c 300 "$WORK/harm.err" | tr '\n"' ' .')"
    fi
    echo "[settlement-auto] HARM NAMED, OR THE GATE COULD NOT GATE — reported and escalated after the receipt; the printout stands (POS-1025/c)" >&2
  fi
fi

# ── PUBLISHING MAIN, IN ONE PLACE ────────────────────────────────────────────
#
# THE CHEAP SALVAGE (founder, 2026-08-22): on a rejected push, fetch, and if
# every raced-in change touches only paths DISJOINT from this crossing's own
# writes, rebase the finished commits onto the moved main and push once more.
# The printout's bytes do not change, only its parent. Any overlap, any
# conflict, any second rejection is the whole re-run (exit 2), and the re-run
# prints the same sealed settlement under the same number.
publish_main() {
  if [ "$DRY" = "1" ]; then
    withheld "world main's push: $(git -C "$CLONE" rev-parse main) over origin/main $WORLD_FROM"
    return 0
  fi
  [ "$(git -C "$CLONE" rev-parse main)" = "$WORLD_FROM" ] && return 0
  git -C "$CLONE" push -q origin main:main || {
    git -C "$CLONE" fetch -q origin main
    MB="$(git -C "$CLONE" merge-base main origin/main)"
    git -C "$CLONE" diff --name-only "$MB" main | sort > "$WORK/printed-paths"
    git -C "$CLONE" diff --name-only "$MB" origin/main | sort > "$WORK/raced-paths"
    if [ -s "$WORK/raced-paths" ] && [ -z "$(comm -12 "$WORK/printed-paths" "$WORK/raced-paths")" ] \
       && git -C "$CLONE" rebase -q origin/main >/dev/null 2>&1 \
       && git -C "$CLONE" push -q origin main:main; then
      echo "[settlement-auto] main raced by disjoint paths ($(tr '\n' ' ' < "$WORK/raced-paths")) — rebased and pushed" >&2
    else
      git -C "$CLONE" rebase --abort >/dev/null 2>&1 || true
      report race "world main moved underneath the printout — rerun"
      echo "[settlement-auto] RACE on main — rerun" >&2; exit 2
    fi
  }
}

publish_main
WORLD_TO="$(git -C "$CLONE" rev-parse main)"

# ── THE TAG AND THE RECORD ───────────────────────────────────────────────────
#
# `settlement/S<n>` is cut at the commit that now stands on origin (the
# printout's, or main itself when the settlement changed nothing), naming the
# number, the window, the snapshot and its digest. The local tag is set aside
# and the remote's is fetched first, so an existing tag is judged as it stands
# on origin: the same commit and digest is done, anything else is REFUSED and
# never moved. Then the store records the printout once, and moves the
# world-marks head only for the highest printed settlement. A tag or record
# that fails does not unpublish anything (main is already pushed); it is
# reported, escalated, and the settlement reads as not yet printed, so a by-hand
# crossing prints it again under the same number.
TAG_JSON=""
RECORD_JSON=""
TAG_OK=1
if [ "$PRINT_STATUS" != "already-printed" ] && [ -n "$SETTLEMENT_N" ]; then
  TAG="settlement/S$SETTLEMENT_N"
  TAG_JSON="$WORK/tag.json"
  TAG_DRY_FLAG=""
  if [ "$DRY" = "1" ]; then TAG_DRY_FLAG="--dry-run"; fi
  git -C "$CLONE" tag -d "$TAG" >/dev/null 2>&1 || true
  git -C "$CLONE" fetch -q origin "refs/tags/$TAG:refs/tags/$TAG" >/dev/null 2>&1 || true
  if (cd "$OFFICE" && node "$OFFICE/world2/tools/settlement-printout.mjs" tag \
        --world "$CLONE" --window "$DOCKET_WINDOW" --commit "$WORLD_TO" $TAG_DRY_FLAG) > "$TAG_JSON" 2>"$WORK/tag.err"; then
    TAG_STATUS="$(node -e 'const r=require(process.argv[1]);process.stdout.write(String(r.status))' "$TAG_JSON")"
    if [ "$TAG_STATUS" = "would-tag" ]; then
      withheld "the tag $TAG at $WORLD_TO, and its push"
    elif [ "$TAG_STATUS" = "tagged" ] && ! git -C "$CLONE" push -q origin "refs/tags/$TAG"; then
      TAG_OK=0
      node -e 'const fs=require("node:fs");const p=process.argv[1];const r=JSON.parse(fs.readFileSync(p,"utf8"));r.status="refused";r.refused="tag-push-refused";r.detail="origin refused the tag push (a tag of that name arrived since the fetch); it is never forced";fs.writeFileSync(p,JSON.stringify(r,null,1)+"\n")' "$TAG_JSON" || true
    fi
  else
    TAG_OK=0
  fi
  if [ "$TAG_OK" = "1" ] && [ "$DRY" = "1" ]; then
    withheld "the store's record of the printout (record_printout, window $DOCKET_WINDOW at $WORLD_TO)"
  elif [ "$TAG_OK" = "1" ]; then
    RECORD_JSON="$WORK/record.json"
    if ! (cd "$OFFICE" && node "$OFFICE/world2/tools/settlement-printout.mjs" record \
          --window "$DOCKET_WINDOW" --commit "$WORLD_TO") > "$RECORD_JSON" 2>"$WORK/record.err"; then
      TAG_OK=0
      [ -s "$RECORD_JSON" ] || node -e 'require("node:fs").writeFileSync(process.argv[1],JSON.stringify({status:"refused",refused:"record-tripped",detail:process.argv[2]},null,1)+"\n")' "$RECORD_JSON" "$(head -c 300 "$WORK/record.err" | tr '\n"' ' .')"
    fi
  fi
  if [ "$TAG_OK" != "1" ]; then
    cat "$WORK/tag.err" "$WORK/record.err" >&2 2>/dev/null || true
    echo "[settlement-auto] THE TAG OR THE RECORD REFUSED — main is published, S$SETTLEMENT_N is not recorded as printed; reported and escalated after the receipt" >&2
  fi
fi

# ── THE GRAMMAR SUITE, AFTER THE PUSH, AS A CHECKER (founder-ruled 2026-09-16) ─
#
# Everything the harm gate does not ask still runs here, over the tree that just
# published. A red is a WARNING: on the receipt (`suite.red`), an issue on the
# first occurrence, and it holds nothing. The suite's scratch lives and dies
# with this run (2026-09-01, the day the box filled).
SUITE_TMP="$WORK/tmp"; mkdir -p "$SUITE_TMP"
SUITE_JSON="$WORK/suite.json"
SUITE_WORD="suite not run"
if [ "$PRINT_STATUS" = "printed" ] || [ "$PRINT_STATUS" = "dry" ]; then
  if (cd "$CLONE" && TMPDIR="$SUITE_TMP" TMP="$SUITE_TMP" TEMP="$SUITE_TMP" npm run test:candle --silent) > "$WORK/suite.log" 2>&1; then
    node -e 'const fs=require("node:fs");fs.writeFileSync(process.argv[1],JSON.stringify({ran:true,red:false,reds:[],reds_total:0,log:null},null,1)+"\n")' "$SUITE_JSON" 2>/dev/null || SUITE_JSON=""
    SUITE_WORD="suite green"
  else
    SUITE_KEEP="$OFFICE/settlement-last-suite.log"
    if [ "$DRY" = "1" ]; then SUITE_KEEP="${OUT%.json}-suite.log"; fi
    cp "$WORK/suite.log" "$SUITE_KEEP" 2>/dev/null || true
    node -e 'const fs=require("node:fs");const log=fs.readFileSync(process.argv[2],"utf8");const reds=log.split(/\r?\n/).filter((l)=>/^not ok\b/.test(l));fs.writeFileSync(process.argv[1],JSON.stringify({ran:true,red:true,reds:reds.slice(0,40),reds_total:reds.length,log:process.argv[3]},null,1)+"\n")' "$SUITE_JSON" "$WORK/suite.log" "$(basename "$SUITE_KEEP")" 2>/dev/null || SUITE_JSON=""
    echo "[settlement-auto] SUITE WARNING — the town is published; the grammar suite went red after the push, and a person is told" >&2
    grep -E "^not ok" "$WORK/suite.log" >&2 || tail -40 "$WORK/suite.log" >&2
    SUITE_WORD="suite RED after the push — a warning, filed"
  fi
else
  SUITE_JSON=""
fi

# ── THE OUTCOME ──────────────────────────────────────────────────────────────
#
# `published` when the printout wrote marks; `quiet` when the settlement changed
# nothing on main (a registry or photograph commit may still have been pushed:
# neither is a publication, so neither may answer `--recurring`'s question yes).
# The report-only findings ride both words, and each is escalated AFTER the
# receipt, so the issue quotes a receipt that says what published.
case "$PRINT_STATUS" in
  printed|dry)
    report published "S$SETTLEMENT_N printed: $(node -e 'const r=require(process.argv[1]);const s=r.summary||{};process.stdout.write(s.written+" written, "+s.removed+" removed, "+s.reframed+" re-framed")' "$PRINTOUT_JSON" 2>/dev/null || echo 'printed')" ;;
  quiet)
    report quiet "S$SETTLEMENT_N sealed with nothing to print; main stands at $WORLD_TO" ;;
  already-printed)
    report quiet "S$SETTLEMENT_N was already printed at $(node -e 'const r=require(process.argv[1]);process.stdout.write(String(r.commit||"").slice(0,12))' "$PRINTOUT_JSON" 2>/dev/null); nothing left to do" ;;
  *)
    report refused "the printout answered a status this crossing does not know: $PRINT_STATUS"
    echo "[settlement-auto] UNKNOWN PRINTOUT STATUS \"$PRINT_STATUS\"" >&2
    recurring_check; exit 1 ;;
esac
if [ "$HARM_RED" = "1" ]; then escalate --class harm-warning --receipt "$OUT"; fi
if [ "$TAG_OK" != "1" ]; then escalate --class tag --receipt "$OUT"; fi
if [ -n "$SUITE_JSON" ] && [ "$(node -e 'const r=require(process.argv[1]);process.stdout.write(String(r.red===true))' "$SUITE_JSON" 2>/dev/null)" = "true" ]; then
  escalate --class suite-warning --receipt "$OUT" --suite-log "$WORK/suite.log"
fi
if [ "$DRY" = "1" ]; then
  echo "[settlement-auto] DRY — would print S$SETTLEMENT_N: $WORLD_FROM -> $(git -C "$CLONE" rev-parse main) ($SUITE_WORD); nothing left this run — receipt at $OUT"
  exit 0
fi
echo "[settlement-auto] S$SETTLEMENT_N $PRINT_STATUS: $WORLD_FROM -> $WORLD_TO ($SUITE_WORD)"
exit 0
