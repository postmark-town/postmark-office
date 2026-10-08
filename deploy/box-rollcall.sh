#!/bin/sh
# box-rollcall.sh — run the roll-call ON THE BOX and print one line per unit.
#
# Reads /etc/systemd/system and the state files under /srv. Writes nothing,
# enables nothing, restarts nothing. Exit 0 = every row OK, PARKED or RETIRED; exit 1 =
# at least one ALARM; exit 2 = the roll-call itself could not run.
#
# ════════════════════════════════════════════════════════════════════════════
#  INSTALL — WRIGHT'S HAND, ONCE. Three steps and none of them need sudo.
# ════════════════════════════════════════════════════════════════════════════
#
#  STEP 1 — get the code onto the box. It rides the ordinary office deploy;
#  nothing here is special. Either wait for the next deploy, or pull by hand:
#
#      ssh meepo-ec2 'cd /srv/postmark-office && git pull --ff-only'
#
#  STEP 2 — run it once, and READ WHAT IT SAYS:
#
#      ssh meepo-ec2 'sh /srv/postmark-office/deploy/box-rollcall.sh'
#
#  ⚑ THE INSTALL-DAY PREDICTION, AND IT IS THE ACCEPTANCE PROOF. This first run
#    is expected to EXIT 1 with exactly one alarm:
#
#      ALARM-disabled  postmark-settlement-shadow.timer  the settlement shadow is
#      installed but disabled (inactive) — it will not fire again.
#
#    That alarm is the point. On 2026-08-27 the box carried that timer disabled
#    while the repo's own commit 998c5d1 said "reactivated 2026-08-23 after the
#    outage-day disable", and the verdict rotting on disk at
#    /srv/postmark-harbor/settlement-shadow.json read
#    {"at":"2026-08-24T22:23:00Z","status":"would-refuse","detail":"grammar suite
#    would go red"} — the exact finding the shadow exists to raise, two and a
#    half days old, unread by anything. A roll-call that came up clean on its
#    first run would have proved only that it cannot fail.
#
#    If it comes up CLEAN instead, that is itself a finding, not a pass: it means
#    somebody enabled the shadow between 2026-08-27 and install day, and the
#    right move is to say so and then break something deliberately to confirm the
#    checker still reddens (disable a timer, run, re-enable).
#
#  STEP 3 — wire it into the daily operator round. The exact edit is proposed in
#  the handback for G:/Wright-HQ/.claude/skills/wright-postmark-operator-round/
#  SKILL.md as a new step 4.9, and it is one ssh line plus "paste the ALARM
#  lines". That skill file is Wright's; this kit does not edit it.
#
#  There is NO systemd unit for the roll-call itself, and that is deliberate. A
#  watchman that runs on the box it watches cannot report the box being down —
#  putting it on a timer would produce a board that is silently correct and
#  silently absent in exactly the same way. Running it from the operator round
#  over ssh means an unreachable box fails the ssh, in front of a person.
#
# ── JUDGING OFF-BOX, IF YOU EVER WANT TO ───────────────────────────────────
#  Collection and judgment are separate on purpose, so a board can be captured
#  on the box and read anywhere:
#
#      ssh meepo-ec2 'sh /srv/postmark-office/deploy/box-rollcall.sh --dump-snapshot /tmp/box.json'
#      ssh meepo-ec2 'cat /tmp/box.json' > box.json
#      node tools/box-rollcall.mjs --snapshot box.json
#
#  --dump-snapshot still judges and still returns the real exit code; it saves the
#  reading in addition to reporting it, never instead of.
#
#  ⚑ NOTE ON WHAT IS *NOT* USED HERE. An earlier shape of this tool was to parse
#    `systemctl list-timers --all`. It was dropped after two measurements on the
#    box, both on 2026-08-27, and both would have been silent failures:
#      · a DISABLED timer does not appear in `list-timers --all` at all — the
#        settlement shadow, the whole reason this exists, was simply absent from
#        that listing rather than shown as dead;
#      · the NEXT column reads "-" while a timer's own service is mid-run, so
#        postmark-site-sentinel.timer appeared to have no next elapse at the exact
#        moment it was healthiest.
#    `systemctl show` answers key=value, merges drop-ins, and is honest about
#    both cases, so that is what the collector uses.
#
# ── ADDING A UNIT LATER ─────────────────────────────────────────────────────
#  Install the unit, then add its row to deploy/box-rollcall-manifest.json. The
#  order does not matter: between the two, the roll-call reports
#  ALARM-unmanifested for a unit with no row, which is the reminder. A row you
#  are not ready to run is legal — set stage to "parked" and say why. A unit you
#  have ENDED keeps its row with stage "retired", retired_because and retire_steps:
#  it reads RETIRED once the box no longer loads it, and ALARM-unretired until then.
#
#  If the unit EXECS OUT OF A CHECKOUT, it also wants a row in the manifest's
#  `trees` block naming the tree it runs and the release it must be. The reverse
#  check is the reminder there too: a live unit whose service names a tree and
#  has no tree row comes back ALARM-tree. That section exists because on
#  2026-09-10 the World 2.0 candle ran a three-day-old second checkout through a
#  board on which every row was individually correct.

set -eu

OFFICE="${OFFICE_DIR:-/srv/postmark-office}"

if [ ! -f "$OFFICE/tools/box-rollcall.mjs" ]; then
  echo "[box-rollcall] no checker at $OFFICE/tools/box-rollcall.mjs — has the office deployed since it was merged?" >&2
  exit 2
fi

exec node "$OFFICE/tools/box-rollcall.mjs" \
  --manifest "$OFFICE/deploy/box-rollcall-manifest.json" \
  "$@"
