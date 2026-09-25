#!/bin/sh
# settlement-shadow.sh — the next crossing, rehearsed hourly with the pen denied.
#
# The world is a pure function of fetchable inputs, so the next settlement is
# computable at any moment. This runs the EXACT settlement recipe — same fetch,
# same stakes derive, same sweep, same full grammar suite — in its own clone,
# and publishes NOTHING. Its one output is a verdict: would the next crossing
# settle, or would it refuse, and over what.
#
# Born 2026-08-21, the morning after three composed faults were discovered only
# by the production settlement (the goodie-bag crossing): every gate we had
# judged a different tree than the one that failed, and the eligible-subset
# compose existed nowhere until the crossing constructed it in prod. This
# script constructs it every hour instead. A WOULD-REFUSE here is a finding
# with a ~12h head start on the clock, not an outage.
#
# Flags: exit 1 + unit failure (journalctl / systemctl --failed) + the harbor
# verdict JSON (/settlement-shadow.json beside settlement-auto.json) — polled
# by the ops page and read on the operator round.
#
# The verification tiers (world repo): `npm run gate` is the ITERATION tier —
# mark-lint plus the falsifier subset, under a minute, for the dev loop. The
# full `npm test` suite is the PUBLISH tier: what this shadow rehearses and
# what the settlement itself runs before its pen touches main. The fast gate
# never substitutes for the suite on anything that ships.
#
# ── IT REHEARSES THE PATH THE BOX RUNS (2026-09-25) ─────────────────────────
#
# Since G1 the crossing folds from the store (`SETTLEMENT_SOURCE=store`), and
# this script went on rehearsing the git path: town stakes, and every git-era
# drawer on origin. The store crossing never reads those drawers —
# `store-writedown.mjs § clearGitSketchbooks` deletes them from its clone before
# it writes — so the rehearsal judged a crossing the box does not run. On
# 2026-09-25 it said WOULD-REFUSE over `duplicate id "neth/warm-stone"`: S81 had
# published the store's copy at `WORLD/marks/neth/warm-stone/`, and neth's
# drawer `draft/xf3s` still held the door's 09-11 copy at
# `WORLD/marks/let-there-be-light/warm-stone/`, with a different position and
# extent. True of a rollback crossing; false of the one at 17:45Z.
#
# So the source is read exactly as settlement-auto.sh reads it, and under
# `store` the chain is the crossing's own: the newest closed window's docket
# (`await-clearing.mjs --rehearse` — between crossings no window clears after
# this run starts, which is the timer's question), the fold input from the store
# (read-only), the write-down into this clone's local sketchbooks (it pushes
# nothing, and it clears the drawers first), then the same sweep and suite.
# Under `git` it is what it was. The verdict names which one it rehearsed.
#
# Env (unit): TOWN_CLONE, WORLD_CLONE (origin URL discovery only);
#   SETTLEMENT_SOURCE — `git` (the default) or `store`, the settlement unit's own
#   value; under `store`, WORLD2_PG / WORLD2_PG_URL for the store read;
#   OFFICE_ROOT, SHADOW_CLONE, SHADOW_REPORT — the defaults below.
# Cwd: /srv/postmark-office. Exit: 0 would-settle · 1 would-refuse.

set -eu
OFFICE="${OFFICE_ROOT:-/srv/postmark-office}"
TOWN="${TOWN_CLONE:-$OFFICE/town-clone}"
SHADOW="${SHADOW_CLONE:-$OFFICE/shadow-clone}"
OUT="${SHADOW_REPORT:-/srv/postmark-harbor/settlement-shadow.json}"
STAMP="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT

# Read once, and an unrecognised value refuses — settlement-auto.sh's rule for
# the same variable, so the rehearsal and the crossing cannot read a typo two ways.
SOURCE="${SETTLEMENT_SOURCE:-git}"
case "$SOURCE" in
  store|git) ;;
  *) echo "[settlement-shadow] SETTLEMENT_SOURCE=\"$SOURCE\" is not \`store\` or \`git\` — refusing rather than guessing which crossing to rehearse" >&2; exit 1 ;;
esac
WINDOW=""

# One-time: the shadow's own clone — never the sweep's, never the write pen's.
if [ ! -d "$SHADOW/.git" ]; then
  ORIGIN="$(git -C "${WORLD_CLONE:-/srv/postmark-office/world-clone}" remote get-url origin)"
  git clone -q "$ORIGIN" "$SHADOW"
  git -C "$SHADOW" config user.name  "the settlement shadow (box)"
  git -C "$SHADOW" config user.email "postmark-shadow@users.noreply.github.com"
fi

report() { # status detail
  # Backslashes go too: the sweep's SETTLEMENT-SWEEP-REFUSAL line carries JSON of
  # its own, and once a detail's 300 characters reach it, an escaped quote with
  # its quote translated away leaves `\.` in this file. That is not JSON, and the
  # ops card then reads no verdict at all on the refusal it exists to show
  # (measured 2026-09-25 on a fixture: `main folds with 1 error(s)`).
  set -- "$1" "$(printf '%s' "$2" | tr -d '\\')"
  printf '{\n "at": "%s",\n "status": "%s",\n "source": "%s",\n "window": %s,\n "town_sha": "%s",\n "world_main": "%s",\n "detail": "%s"\n}\n' \
    "$STAMP" "$1" "$SOURCE" "${WINDOW:-null}" "${TOWN_SHA:-}" "${WORLD_FROM:-}" "$2" > "$OUT" 2>/dev/null || true
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
git clone -q --local --no-checkout "$TOWN" "$WORK/town"
git -C "$WORK/town" checkout -qf "$TOWN_SHA"

# THE CLONE IS PUT BACK TO EXACTLY WHAT ORIGIN HOLDS — including the drawers
# origin no longer has. The reset used to walk origin's refs and reset each one,
# which leaves a local sketchbook whose origin ref was pruned standing forever;
# the sweep unions refs/heads/draft/* with refs/remotes/origin/draft/* when it
# looks for candidates, so that residue is swept as though it were a live drawer
# and the rehearsal's verdict is about a town that does not exist. Its own script
# says why a hard reset is right here and wrong in settlement-auto.sh.
sh "$(dirname "$0")/shadow-refs-reset.sh" "$SHADOW"
WORLD_FROM="$(git -C "$SHADOW" rev-parse origin/main)"

if [ "$SOURCE" = "store" ]; then
  if ! (cd "$OFFICE" && node "$OFFICE/world2/tools/await-clearing.mjs" --since "$STAMP" --rehearse) > "$WORK/docket.json" 2>"$WORK/docket.err"; then
    report would-refuse "no docket to rehearse: $(refusal_of "$WORK/docket.json" "$WORK/docket.err")"
    echo "[settlement-shadow] WOULD REFUSE (no docket)" >&2; cat "$WORK/docket.json" "$WORK/docket.err" >&2 || true
    exit 1
  fi
  WINDOW="$(node -e 'const d=require(process.argv[1]);process.stdout.write(String(d.window))' "$WORK/docket.json")"

  if ! (cd "$OFFICE" && node "$OFFICE/world2/tools/fold-input-cli.mjs" \
        --world-sha "$WORLD_FROM" --town-clone "$TOWN" --town-sha "$TOWN_SHA" \
        --window "$WINDOW" --world-repo "$SHADOW") > "$WORK/fold-input.json" 2>"$WORK/fold.err"; then
    report would-refuse "the store could not answer: $(refusal_of "$WORK/fold-input.json" "$WORK/fold.err")"
    echo "[settlement-shadow] WOULD REFUSE (store read)" >&2; cat "$WORK/fold-input.json" "$WORK/fold.err" >&2 || true
    exit 1
  fi
  node -e 'const fs=require("node:fs");const i=require(process.argv[1]);fs.writeFileSync(process.argv[2],JSON.stringify(i.stakes,null,1)+"\n")' \
    "$WORK/fold-input.json" "$WORK/stakes.json"

  if ! (cd "$OFFICE" && node "$OFFICE/src/store-writedown.mjs" \
        --input "$WORK/fold-input.json" --world "$SHADOW") > "$WORK/store.json" 2>"$WORK/store.err"; then
    report would-refuse "the store write-down would refuse: $(refusal_of "$WORK/store.json" "$WORK/store.err")"
    echo "[settlement-shadow] WOULD REFUSE (write-down)" >&2; cat "$WORK/store.json" "$WORK/store.err" >&2 || true
    exit 1
  fi
  echo "[settlement-shadow] store: window $WINDOW — $(node -e 'const r=require(process.argv[1]);process.stdout.write(String(r.written||0)+" of "+String(r.marks||0)+" mark(s) written, "+String(r.unchanged_skipped||0)+" already in canon; cleared "+String((r.sketchbooks_cleared||{}).removed_remote||0)+" git-era drawer ref(s)")' "$WORK/store.json")" >&2
else
  (cd "$WORK/town" && node tools/world-stake.mjs --escrow --json) > "$WORK/stakes.json"
fi

# The sweep, local only — it never pushes, and this script has no push step.
if ! (cd "$SHADOW" && node tools/settlement-sweep.mjs --stakes "$WORK/stakes.json" --json) > "$WORK/sweep.json" 2>"$WORK/sweep.err"; then
  report would-refuse "sweep would trip: $(head -c 300 "$WORK/sweep.err" | tr '\n"' ' .')"
  echo "[settlement-shadow] WOULD REFUSE (sweep)" >&2; cat "$WORK/sweep.err" >&2
  exit 1
fi

# The suite's scratch lives and dies with this run — see settlement-auto.sh's
# note of the same date (2026-09-01): the world suite's fixture helpers leak
# under the system TMPDIR, and this shadow runs the suite twice a day on top of
# the settlement's own runs. $WORK is trap-removed at EXIT.
SUITE_TMP="$WORK/tmp"; mkdir -p "$SUITE_TMP"
if ! (cd "$SHADOW" && TMPDIR="$SUITE_TMP" TMP="$SUITE_TMP" TEMP="$SUITE_TMP" npm test --silent) > "$WORK/suite.log" 2>&1; then
  report would-refuse "grammar suite would go red"
  echo "[settlement-shadow] WOULD REFUSE (suite red)" >&2
  grep -E "^not ok" "$WORK/suite.log" >&2 || tail -20 "$WORK/suite.log" >&2
  exit 1
fi

report would-settle "the next crossing composes, lints and folds clean from $SOURCE; suite green over world $WORLD_FROM"
echo "[settlement-shadow] clean — the next crossing would settle"
exit 0
