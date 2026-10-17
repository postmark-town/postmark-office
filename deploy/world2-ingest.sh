#!/bin/bash
# world2-ingest.sh — the two projection pens on a poll.
#
#   law-ingest    world-law repo -> law_projection (`identities` is the registry's
#                 VIEW since 055, POS-350; no pen writes it)
#   stamp-ingest  town repo      -> stamp_projection
#
# ── WHY A POLL AT ALL, AND WHAT A DEAD ONE COSTS ────────────────────────────
# world2/tools/README.md is explicit that on-merge is the shape and the poll is
# the fallback, and equally explicit about the blast radius, verbatim:
#
#   "A dead webhook degrades only the door's advisory sufficiency read — never
#    a clearing."
#
# That sentence is what makes 15 minutes an acceptable number rather than a
# guess. The doors read these projections to tell a resident whether they have
# the stamps for a stake BEFORE they commit to one; fifteen minutes of
# staleness there is a slightly-behind answer to an advisory question. The
# authoritative read happens at the candle, where the clearing does the town
# ingest itself and REFUSES on a null law pin. Nothing this timer can do wrong
# reaches an outcome.
#
# ── ONE UNIT, TWO PENS — AND WHY THAT STOPPED BEING TRUE (2026-09-19) ───────
# This file used to argue that the two pens belong on one unit: shared cadence,
# shared blast radius, and splitting them would be "structure bought before the
# pain (keep-simple)". The pain arrived, and it was not the one that paragraph
# was watching for.
#
# On 2026-08-31 the founder parked `postmark-world2-ingest.timer` — for a reason
# about the world's OUTCOMES (acts, claims, marks): a re-lift from git "would
# launder v1's record into v2's and destroy the writer comparison the shadow era
# exists to make". Neither pen here writes an outcome. They copy the rulebook and
# the ledger, repo-first inputs the store may not author. But the park took the
# whole unit, and `law-ingest` is the ONLY writer of `law_projection` anywhere in
# the office, so the law copy simply stopped: `a23a8d17` (2026-09-05) until one
# hand-run on 2026-09-17 set it to `1688a5af`, then frozen again — 37 commits
# behind world main by 2026-09-19 (postmark#2893).
#
# The designed alarm could not fire either. The paragraph below still says a dead
# law pen "shows up as the clearing refusing" on a NULL pin — true, and the final
# pass of 09-05 wrote a VALID pin. A frozen non-null pin is never null, so the
# guard that was supposed to be the louder alarm never made a sound. That is the
# real cost of one unit: the town could not park one pen without parking both,
# and the one it did not mean to park was the one with no second watcher.
#
# RULED (Keemin, 2026-09-19): "split for now is good." The law pen gets its own
# unit and its own clock — `postmark-world2-law-ingest.{service,timer}`, `law`
# mode, the same :04/:19/:34/:49 marks. The parked unit and its files are
# UNTOUCHED, and `stamp-ingest` stays parked with it.
#
# There is still only ONE copy of each pen, and this is still the only script
# that runs them. The mode argument is the whole of the split.
#
# The law pen is the one with teeth, and not because of this timer: a null
# world-law pin is the guard that STOPS a clearing. That guard is real and it is
# not a freshness check — see above for the case it cannot see.

set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/world2-lib.sh"

# ── MODE ────────────────────────────────────────────────────────────────────
# No argument is today's behaviour, byte-for-byte: both pens, `ingest.json`.
#
# EACH MODE WRITES ITS OWN STATE FILE, and that is not tidiness. A heartbeat is
# an instrument, and it has to be able to say which thing it measured: if the
# law unit and the (parked, one day maybe resumed) both-pens unit wrote one
# path, the law row's heartbeat would go green on a run that was not its own,
# two units would race on the same `mv -f`, and every law tick would overwrite
# the parked rail's last receipt — the 2026-09-17 hand-run evidence that its
# stamp pen exited 0. A pen that did not run gets NO LINE in the state, rather
# than a zero-exit line that reads like a receipt.
#
# Nothing in this repo reads any of these files today (`grep -rn ingest.json`:
# this script and one DEPLOY.md sentence). The law file's first reader is the
# roll-call row this change adds.
case "${1:-both}" in
  law)    MODE=law;    RUN_LAW=1; RUN_STAMPS=0; RUN_BLESSED=0; STATE=ingest-law.json ;;
  stamps) MODE=stamps; RUN_LAW=0; RUN_STAMPS=1; RUN_BLESSED=0; STATE=ingest-stamps.json ;;
  both)   MODE=both;   RUN_LAW=1; RUN_STAMPS=1; RUN_BLESSED=0; STATE=ingest.json ;;
  *)      echo "usage: world2-ingest.sh [law|stamps|both]   (no argument = both)" >&2; exit 2 ;;
esac

# ── `at` IS THE LAST RUN; `ok_at` IS THE LAST HEALTHY ONE (POS-628) ─────────
# `at` is stamped on every run, the refused and the held ones included, so a
# heartbeat on `at` says only that the timer fires. The roll-call's law row
# reads `ok_at` instead: stamped when a run ends `ok`, and otherwise carried
# forward from the previous state file, so three unhealthy runs in a row age
# it past the row's 45 minutes. A file that never had one carries none.
prev_ok_at() {
  local f="$WORLD2_STATE_DIR/$STATE"
  [ -f "$f" ] && sed -n 's/.*"ok_at":"\([0-9TZ:-]*\)".*/\1/p' "$f" | head -n1
}
ok_at_line() {                  # ok_at_line <status>
  local t
  if [ "$1" = ok ]; then t="$(date -u +%Y-%m-%dT%H:%M:%SZ)"; else t="$(prev_ok_at)"; fi
  [ -n "$t" ] && printf ',"ok_at":"%s"' "$t"
}

# Both pens are `new pg.Client()` with no argument — PG*, not a URL
# (world2-lib.sh § two connection shapes). Both connect as the same role, so
# this guard is every mode's, not the law mode's.
if ! w2_pgenv law_ingester PG_LAW_INGESTER_PASSWORD; then
  w2_state "$STATE" "\"mode\":\"$MODE\",\"status\":\"cannot-run\"$(ok_at_line cannot-run),\"detail\":\"PG_LAW_INGESTER_PASSWORD unreadable\""
  exit 2
fi

# A JSON string of stdin's first 2000 bytes, escaped in bash: no python, and
# no `node` (a stubbed PATH may own it). w2_json_escape keeps the TAIL; a
# refusal's head is the part that says what was refused (POS-619).
json_head() {
  local s
  s="$(head -c 2000)"
  s="${s//\\/\\\\}"; s="${s//\"/\\\"}"; s="${s//$'\t'/\\t}"; s="${s//$'\r'/}"; s="${s//$'\n'/\\n}"
  printf '"%s"' "$s"
}

run_pen() {                     # run_pen <world|town|world-blessed> <tool> <repo-flag> [extra flag]
  local which="$1" tool="$2" flag="$3" extra="${4:-}" dir="$WORLD2_LAB/ingest-clones/$1" sha out rc
  sha="$("$HERE/world2-refresh-clone.sh" "$which" 2>&1 | tail -n1)"
  if [ "${#sha}" -ne 40 ]; then
    echo "[world2-ingest] $which: checkout refresh failed — $sha" >&2
    PEN_RC=2; PEN_SHA=""; PEN_OUT="checkout refresh failed: $sha"
    return
  fi
  out="$(cd "$WORLD2_OFFICE" && node "world2/tools/$tool" "$flag" "$dir" --sha "$sha" ${extra:+"$extra"} 2>&1)"
  rc=$?                         # captured BEFORE anything pipes it
  echo "$out"
  PEN_RC=$rc; PEN_SHA=$sha; PEN_OUT=$out
}

# A pen that does not run in this mode contributes exit 0 and no line, so the
# STATUS ladder and the unit's exit code keep exactly the shape they had.
LAW_RC=0;  LAW_SHA="";  LAW_LINE="";  LAW_OUT="";  REFUSAL_LINE=""; PIN_HELD=0; PIN_LINE=""
BLESSED_RC=0; BLESSED_SHA=""; BLESSED_LINE=""; BLESSED_OUT=""
TOWN_RC=0; TOWN_SHA=""; TOWN_LINE=""; TOWN_OUT=""

# ── THE SETTLEMENT'S LAW, NOT WORLD MAIN ON A CLOCK (POS-364; R2) ───────────
# "Everyone reads the newest snapshot, minus what has been opposed" (R2), and
# the law is part of what a settlement is. So the law pen reads the checkout at
# the NEWEST SETTLEMENT (world2-refresh-clone.sh world-blessed), not world main:
# a law merged to main governs from the first settlement that carries it, and
# the clearing's pin (projection_heads['world-law'], which the seal stamps as
# the snapshot's law_sha) is that settlement's law. One run now writes both
# the rows and the pin, so the separate `--blessed` run below (POS-270) has
# nothing left to add in `law` mode and does not run there.
if [ "$RUN_LAW" -eq 1 ]; then
  run_pen world-blessed law-ingest.mjs --law-repo
  LAW_RC=$PEN_RC; LAW_SHA=$PEN_SHA; LAW_OUT=$PEN_OUT
  LAW_LINE="$(printf ',"law":{"exit":%d,"sha":"%s"}' "$LAW_RC" "$LAW_SHA")"
  [ "$LAW_RC" -ne 0 ] && echo "[world2-ingest] LAW INGEST FAILED (exit $LAW_RC)" >&2
  # ── A LAW THE PARSER WOULD READ DIMINISHED IS REFUSED WHOLE (POS-619) ──────
  # law-ingest exits 1 with "REFUSED: …" and the lint's sentence per lossy mark,
  # and nothing is written: every law update is held until the mark is fixed.
  # So the refusal rides the state file in its OWN field, from its head:
  # `detail` keeps only the output's last 600 characters, which can cut the
  # REFUSED line itself. The sentinel's law_pen probe reads this field
  # (tools/site-sentinel.mjs § 12), so a held law pages; it never stalls quietly.
  if [ "$LAW_RC" -ne 0 ]; then
    refusal="$(printf '%s\n' "$LAW_OUT" | sed -n '/^REFUSED: /,$p')"
    [ -n "$refusal" ] && REFUSAL_LINE=",\"refusal\":$(printf '%s' "$refusal" | json_head)"
  fi
  # ── A HELD PIN IS NOT OK (POS-628, POS-635) ───────────────────────────────
  # law-ingest can write the rows and still HOLD the clearing's pin (§ pinMove)
  # and exit 0. From 2026-10-11 15:04Z the box held it at b0db90f for three
  # days while this file read `ok` and both alarms read green. Since POS-364
  # the pin is always a settlement's law, and settlements descend from each
  # other, so a hold is a fault every time: its own status, exit still 0 (the
  # rows were written), and `pin` says where the pin stands and why.
  if [ "$LAW_RC" -eq 0 ]; then
    pin_sha="$(printf '%s\n' "$LAW_OUT" | sed -n "s/.*projection_heads\['world-law'\] = \([0-9a-f]\{40\}\).*/\1/p" | head -n1)"
    held="$(printf '%s\n' "$LAW_OUT" | grep -m1 '^\[law-ingest\] PIN HELD' || true)"
    if [ -n "$held" ]; then
      PIN_HELD=1
      PIN_LINE=",\"pin\":{\"state\":\"held\",\"sha\":\"$pin_sha\",\"why\":$(printf '%s' "$held" | json_head)}"
    elif [ -n "$pin_sha" ]; then
      PIN_LINE=",\"pin\":{\"state\":\"current\",\"sha\":\"$pin_sha\"}"
    fi
  fi
fi

# ── THE BLESSED LAW (POS-270, 2026-09-27) ────────────────────────────────────
# The law mode ALSO ingests the rulebook at the newest blessing. The office's
# class reads ask law_projection at the newest settlements.tag_sha — "the bless
# overrides the tick" (Keemin, 2026-09-18, postmark#2934) — and main runs ahead
# of the tag between a crossing and its blessing. `--blessed` writes only that
# sha's law_projection rows: projection_heads['world-law'] stays the main
# run's, so the clearing's pin never moves backwards. After the main
# run, so a failure here can never hold the clearing's rulebook hostage.
if [ "$RUN_BLESSED" -eq 1 ]; then
  run_pen world-blessed law-ingest.mjs --law-repo --blessed
  BLESSED_RC=$PEN_RC; BLESSED_SHA=$PEN_SHA; BLESSED_OUT=$PEN_OUT
  BLESSED_LINE="$(printf ',"law_blessed":{"exit":%d,"sha":"%s"}' "$BLESSED_RC" "$BLESSED_SHA")"
  [ "$BLESSED_RC" -ne 0 ] && echo "[world2-ingest] BLESSED LAW INGEST FAILED (exit $BLESSED_RC) — the office's class reads stay at the last blessed sha that was ingested" >&2
fi

if [ "$RUN_STAMPS" -eq 1 ]; then
  run_pen town stamp-ingest.mjs --town-repo
  TOWN_RC=$PEN_RC; TOWN_SHA=$PEN_SHA; TOWN_OUT=$PEN_OUT
  TOWN_LINE="$(printf ',"stamp":{"exit":%d,"sha":"%s"}' "$TOWN_RC" "$TOWN_SHA")"
  [ "$TOWN_RC" -ne 0 ] && echo "[world2-ingest] STAMP INGEST FAILED (exit $TOWN_RC)" >&2
fi

if   [ "$LAW_RC" -ne 0 ] && [ "$TOWN_RC" -ne 0 ]; then STATUS=both-failed
elif [ "$LAW_RC" -ne 0 ];                        then STATUS=law-failed
elif [ "$TOWN_RC" -ne 0 ];                       then STATUS=stamp-failed
elif [ "$BLESSED_RC" -ne 0 ];                    then STATUS=law-blessed-failed
elif [ "$PIN_HELD" -eq 1 ];                      then STATUS=law-pin-held
else                                                  STATUS=ok
fi

DETAIL=""
if [ "$RUN_LAW" -eq 1 ]; then DETAIL="$(printf 'law: %s' "$LAW_OUT")"; fi
if [ "$RUN_BLESSED" -eq 1 ]; then DETAIL="$(printf '%s\nlaw_blessed: %s' "$DETAIL" "$BLESSED_OUT")"; fi
if [ "$RUN_STAMPS" -eq 1 ]; then
  if [ -n "$DETAIL" ]; then DETAIL="$(printf '%s\nstamp: %s' "$DETAIL" "$TOWN_OUT")"
  else                      DETAIL="$(printf 'stamp: %s' "$TOWN_OUT")"; fi
fi

w2_state "$STATE" "$(printf '"mode":"%s","status":"%s"%s%s%s%s%s,"detail":%s' \
  "$MODE" "$STATUS" "$(ok_at_line "$STATUS")" "$LAW_LINE$BLESSED_LINE" "$TOWN_LINE" "$REFUSAL_LINE" "$PIN_LINE" \
  "$(printf '%s' "$DETAIL" | w2_json_escape)")"

if [ "$LAW_RC" -ne 0 ] || [ "$TOWN_RC" -ne 0 ] || [ "$BLESSED_RC" -ne 0 ]; then exit 1; fi
if [ "$PIN_HELD" -eq 1 ]; then
  echo "[world2-ingest] law-pin-held — the rows for $LAW_SHA are written, the clearing's pin stays at $pin_sha" >&2
  exit 0
fi
case "$MODE" in
  law)    echo "[world2-ingest] ok — law $LAW_SHA / blessed $BLESSED_SHA" ;;
  stamps) echo "[world2-ingest] ok — town $TOWN_SHA" ;;
  both)   echo "[world2-ingest] ok — law $LAW_SHA / town $TOWN_SHA" ;;
esac
exit 0
