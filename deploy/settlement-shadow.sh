#!/bin/sh
# settlement-shadow.sh — the next printout, rehearsed with the pen denied.
#
# Born 2026-08-21, the morning after three composed faults were discovered only
# by the production settlement: every gate we had judged a different tree than
# the one that failed. So this runs the crossing's own recipe, in its own clone,
# and publishes NOTHING. Its one output is a verdict: would the next crossing
# settle, or would it refuse, and over what.
#
# ── SINCE POS-1025: IT REHEARSES THE PRINTOUT ───────────────────────────────
#
# The settlement decides inside the clearing and seals; the crossing prints the
# sealed snapshot (settlement-auto.sh § THE PRINTOUT). So the rehearsal is the
# printout's: the newest closed window's docket (`await-clearing.mjs --rehearse`
# — between crossings no window clears after this run starts), the printout of
# that window's seal into this clone with `--dry-run` (it writes the files and
# commits nothing, and reads the store as the clearing's pen, writing nothing
# there), the harm gate over the printed tree, and the world's grammar suite.
#
# THE VERDICT FOLLOWS THE RULINGS. Only a printout that would REFUSE is a
# would-refuse: that is the one thing that holds the town. After the seal the
# harm gate and the suite only raise alarms (POS-1025/c), so a harm finding or a
# red suite is a would-settle WITH its warning named in the verdict, and the
# crossing will escalate it. A window whose seal is already printed is a
# would-settle with nothing to print: the next crossing prints the next seal.
#
# The git path and the store write-down's sketchbooks went with the cutover:
# there is no SETTLEMENT_SOURCE to read and no drawer to rehearse.
#
# Flags: exit 1 + unit failure on a would-refuse, and the harbor verdict JSON
# (/settlement-shadow.json beside settlement-auto.json), polled by the ops page
# (tools/world-report.mjs) and read on the operator round.
#
# Env (unit): TOWN_CLONE, WORLD_CLONE (origin URL discovery only); WORLD2_PG /
#   WORLD2_PG_URL (the docket), WORLD2_CLEARING_URL (the printout reads the seal,
#   /etc/postmark-world2-clearing.env); OFFICE_ROOT, SHADOW_CLONE, SHADOW_REPORT.
# Cwd: /srv/postmark-office. Exit: 0 would-settle · 1 would-refuse.

set -eu
OFFICE="${OFFICE_ROOT:-/srv/postmark-office}"
TOWN="${TOWN_CLONE:-$OFFICE/town-clone}"
SHADOW="${SHADOW_CLONE:-$OFFICE/shadow-clone}"
OUT="${SHADOW_REPORT:-/srv/postmark-harbor/settlement-shadow.json}"
STAMP="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
WINDOW=""
SETTLEMENT_N=""

# One-time: the shadow's own clone — never the crossing's, never the write pen's.
if [ ! -d "$SHADOW/.git" ]; then
  ORIGIN="$(git -C "${WORLD_CLONE:-/srv/postmark-office/world-clone}" remote get-url origin)"
  git clone -q "$ORIGIN" "$SHADOW"
  git -C "$SHADOW" config user.name  "the settlement shadow (box)"
  git -C "$SHADOW" config user.email "postmark-shadow@users.noreply.github.com"
fi

report() { # status detail
  # Backslashes go too: a tool's detail can carry JSON of its own, and an escaped
  # quote with its quote translated away is not JSON (measured 2026-09-25).
  set -- "$1" "$(printf '%s' "$2" | tr -d '\\')"
  printf '{\n "at": "%s",\n "status": "%s",\n "window": %s,\n "settlement": %s,\n "town_sha": "%s",\n "world_main": "%s",\n "detail": "%s"\n}\n' \
    "$STAMP" "$1" "${WINDOW:-null}" "${SETTLEMENT_N:-null}" "${TOWN_SHA:-}" "${WORLD_FROM:-}" "$2" > "$OUT" 2>/dev/null || true
}
refusal_of() { # json-file err-file — the tool's own "refused — detail", else its stderr
  if said="$(node -e 'const r=require(process.argv[1]);process.stdout.write(String(r.refused||"unknown")+" — "+String(r.detail||""))' "$1" 2>/dev/null)"; then
    printf '%s' "$said"
  else
    cat "$2"
  fi | head -c 300 | tr '\n"' ' .'
}

# Immutable inputs, exactly as the real crossing takes them.
git -C "$TOWN" fetch -q origin
TOWN_SHA="$(git -C "$TOWN" rev-parse origin/main)"

# THE CLONE IS PUT BACK TO EXACTLY WHAT ORIGIN HOLDS (its own script says why a
# hard reset is right here and wrong in settlement-auto.sh).
sh "$(dirname "$0")/shadow-refs-reset.sh" "$SHADOW"
WORLD_FROM="$(git -C "$SHADOW" rev-parse origin/main)"

if ! (cd "$OFFICE" && node "$OFFICE/world2/tools/await-clearing.mjs" --since "$STAMP" --rehearse) > "$WORK/docket.json" 2>"$WORK/docket.err"; then
  report would-refuse "no docket to rehearse: $(refusal_of "$WORK/docket.json" "$WORK/docket.err")"
  echo "[settlement-shadow] WOULD REFUSE (no docket)" >&2; cat "$WORK/docket.json" "$WORK/docket.err" >&2 || true
  exit 1
fi
WINDOW="$(node -e 'const d=require(process.argv[1]);process.stdout.write(String(d.window))' "$WORK/docket.json")"

# The printout, dry: the files land in this clone and nothing is committed or recorded.
if ! (cd "$OFFICE" && node "$OFFICE/world2/tools/settlement-printout.mjs" print \
      --world "$SHADOW" --window "$WINDOW" --dry-run) > "$WORK/printout.json" 2>"$WORK/printout.err"; then
  report would-refuse "the printout would refuse: $(refusal_of "$WORK/printout.json" "$WORK/printout.err")"
  echo "[settlement-shadow] WOULD REFUSE (printout)" >&2; cat "$WORK/printout.json" "$WORK/printout.err" >&2 || true
  exit 1
fi
PRINT_STATUS="$(node -e 'const r=require(process.argv[1]);process.stdout.write(String(r.status))' "$WORK/printout.json")"
SETTLEMENT_N="$(node -e 'const r=require(process.argv[1]);process.stdout.write(String(r.settlement??""))' "$WORK/printout.json")"
if [ "$PRINT_STATUS" != "dry" ]; then
  report would-settle "window $WINDOW's seal (S$SETTLEMENT_N) is $PRINT_STATUS; the next crossing prints the next seal"
  echo "[settlement-shadow] clean — S$SETTLEMENT_N is $PRINT_STATUS"
  exit 0
fi
SUMMARY="$(node -e 'const s=require(process.argv[1]).summary||{};process.stdout.write(s.written+" written, "+s.removed+" removed, "+s.reframed+" re-framed")' "$WORK/printout.json")"

# The harm gate over the printed tree, against main, reading the printout's delta
# as the declared acts — the crossing's own call. REPORTED, never a refusal.
WARN=""
node -e 'const r=require(process.argv[1]);const ids=(xs)=>(xs||[]).map((x)=>x&&(x.id||x.slug)).filter(Boolean).map((id)=>({id}));require("node:fs").writeFileSync(process.argv[2],JSON.stringify({published:ids(r.written),unpublished:ids(r.removed),withdrawn:[],reframed:ids(r.reframed)})+"\n")' \
  "$WORK/printout.json" "$WORK/acts.json"
if [ ! -f "$SHADOW/tools/harm-gate.mjs" ]; then
  WARN="the harm gate could not gate (no tools/harm-gate.mjs at this world sha); "
elif ! (cd "$SHADOW" && node tools/harm-gate.mjs --repo "$SHADOW" --sweep "$WORK/acts.json" --base "$WORLD_FROM" \
          --stakes "$SHADOW/.git/printout-stakes.json" --json) > "$WORK/harm.json" 2>"$WORK/harm.err"; then
  WARN="the harm gate would name harm or could not gate ($(node -e 'const r=require(process.argv[1]);process.stdout.write((r.checks||[]).filter(c=>!c.ok).map(c=>c.name+": "+(c.rows||[]).slice(0,2).join("; ")).join(" | "))' "$WORK/harm.json" 2>/dev/null || head -c 160 "$WORK/harm.err" | tr '\n"' ' .')) — an alarm, POS-1025/c; "
fi

# The suite's scratch lives and dies with this run (2026-09-01, the day the box
# filled). A red is a warning: the crossing publishes and files it.
SUITE_TMP="$WORK/tmp"; mkdir -p "$SUITE_TMP"
if ! (cd "$SHADOW" && TMPDIR="$SUITE_TMP" TMP="$SUITE_TMP" TEMP="$SUITE_TMP" npm run test:candle --silent) > "$WORK/suite.log" 2>&1; then
  WARN="${WARN}the grammar suite would go red ($(grep -c '^not ok' "$WORK/suite.log" || true) not ok) — a warning; "
  grep -E "^not ok" "$WORK/suite.log" >&2 || tail -20 "$WORK/suite.log" >&2
fi

report would-settle "S$SETTLEMENT_N (window $WINDOW) would print $SUMMARY over world $WORLD_FROM${WARN:+; WARNINGS: $WARN}"
echo "[settlement-shadow] clean — the next crossing would print S$SETTLEMENT_N ($SUMMARY)${WARN:+, with warnings: $WARN}"
exit 0
