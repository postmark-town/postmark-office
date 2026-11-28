#!/usr/bin/env bash
# deploy/uat/units.sh — UAT runs prod's own unit files, on prod's clock, as `uat`, inside uat.slice, minus what
# reaches real people or money, or the meeps (CORE-160, CORE-165).
#
#   sudo bash deploy/uat/units.sh            install, override, mask, enable (starts nothing that isn't already running)
#   sudo bash deploy/uat/units.sh --start    the same, then start the enabled set
#
# The unit files come from the office tree the frozen release was carried into (/srv/postmark-office/deploy), byte
# for byte, so a unit change rides the release like any code. What makes them UAT's is a drop-in per unit
# (`uat.conf`), never an edited copy:
#   · a service written `User=meepo` runs as `uat` (on town-rig, meepo is the meeps' Letta user). A service that
#     runs as a DynamicUser (the town seal's sandbox, a uid that owns nothing) keeps that; its isolation is the point;
#   · every service runs in uat.slice (4 cores, 16 GB: prod's size, and the meeps' protection);
#   · PATH puts /usr/bin first, so every bare `node` in prod's scripts is Node 22 (prod's), never the meeps'
#     /usr/local/bin/node (v25);
#   · a socket written for meepo belongs to uat;
#   · the stubs (/srv/uat-stubs) are writable to the units that already write /srv/postmark-office, since UAT's pushes
#     land there, not on GitHub; a sandboxed unit (the town seal and tool) gets nothing added.
# UAT keeps prod's schedule: the ferry's crossings at 00:00 and 12:00 UTC are town law (the crossing is named by its
# hour), and that clock is part of what UAT tests.

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/lib.sh"
uat_require_root
uat_refuse_prod
uat_require_marker
uat_require_user

SRC=/srv/postmark-office/deploy
[ -f "$SRC/postmark-office.service" ] || uat_die "$SRC has no unit files: carry the frozen release into /srv/postmark-office first (README § The order)."

# Which units run, which are masked, which wait for a person, which are installed and left: units.lists.sh. The check
# below refuses a unit in the carried release that no list names, BEFORE the glob installs it (CORE-165, review note 4).
. "$HERE/units.lists.sh"
UNCLASSIFIED="$(uat_unclassified_units "$SRC")"
[ -z "$UNCLASSIFIED" ] || uat_die "these units in $SRC are in no list of units.lists.sh (read each, then put it in ONE list): $(echo $UNCLASSIFIED)"

uat_say "install the unit files from $SRC (the frozen release's)"
for f in "$SRC"/postmark-*.service "$SRC"/postmark-*.timer "$SRC"/postmark-*.socket; do
  install -m 0644 "$f" /etc/systemd/system/
done

uat_say "the world2 ops scripts the store's units run (/srv/world2-lab/ops), from the same tree"
for f in "$SRC"/world2-*.sh; do install -o "$UAT_USER" -g "$UAT_USER" -m 0755 "$f" /srv/world2-lab/ops/; done

uat_say "a uat.conf drop-in for every unit: user, slice, PATH"
for f in "$SRC"/postmark-*.service "$SRC"/postmark-*.socket; do
  u="$(basename "$f")"; d="/etc/systemd/system/$u.d"; install -d "$d"
  case "$u" in
    *.socket)
      if grep -q '^SocketUser=meepo' "$f"; then printf '[Socket]\nSocketUser=%s\nSocketGroup=%s\n' "$UAT_USER" "$UAT_USER" > "$d/uat.conf"; else rm -f "$d/uat.conf"; fi ;;
    *.service)
      {
        echo "[Service]"
        echo "Slice=$UAT_SLICE"
        echo "Environment=PATH=/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/sbin"
        # prod pushes to GitHub over the network; UAT pushes to its local stubs, which a ProtectSystem=strict
        # unit can't write unless they are named (crossing-save, 2026-11-24 00:00Z: "unable to create
        # temporary object directory"). The leading - ignores the path on a box without stubs.
        # Only the units whose own file already opens /srv/postmark-office for writing get it: those are the ones
        # that write the town clone and push it (the office, the ferry, crossing-save). A sandbox whose isolation
        # is the point (the town seal, the town tool) is left exactly as prod's file has it (CORE-165, finding 10).
        if grep -q '^ReadWritePaths=/srv/postmark-office' "$f"; then echo "ReadWritePaths=-/srv/uat-stubs"; fi
        # Under memory pressure UAT is stopped, never the meeps beside it (CORE-72, Darko 2026-11-24 08:33 EST).
        echo "OOMScoreAdjust=500"
        if grep -q '^User=meepo' "$f"; then echo "User=$UAT_USER"; echo "Group=$UAT_USER"; fi
      } > "$d/uat.conf" ;;
  esac
done
systemctl daemon-reload

# The last guard: no unit this kit installed may still resolve to meepo.
bad=""
for f in "$SRC"/postmark-*.service; do
  u="$(basename "$f")"; case "$u" in *@.service) continue ;; esac
  [ "$(systemctl show -p User --value "$u")" = meepo ] && bad="$bad $u"
done
[ -z "$bad" ] || uat_die "these units still run as meepo:$bad"

uat_say "mask what never runs here"
# A unit installed as a real file in /etc/systemd/system cannot be masked (systemctl refuses to replace it), so the
# installed copy goes first; its source stays in $SRC. Every mask is then CHECKED: a silent failure here left the
# payment watchers merely disabled on the first bring-up (CORE-165, 2026-11-24).
for u in "${MASK[@]}"; do
  systemctl disable --now --quiet "$u" 2>/dev/null || true
  [ -f "/etc/systemd/system/$u" ] && [ ! -L "/etc/systemd/system/$u" ] && rm -f "/etc/systemd/system/$u"
  systemctl mask --quiet "$u"
  [ "$(systemctl is-enabled "$u" 2>/dev/null)" = masked ] || uat_die "$u is not masked"
done
systemctl daemon-reload

uat_say "enable the UAT set"
systemctl enable --quiet "${ENABLE[@]}"
for u in "${ASK[@]}"; do uat_say "left off for a person to decide: $u"; done

if [ "${1:-}" = "--start" ]; then
  [ -f /srv/postmark-office/uat-store.json ] || uat_die "the store is not restored yet (store-restore-scrub.sh writes /srv/postmark-office/uat-store.json)."
  systemctl start "${ENABLE[@]}"
  uat_say "started. systemctl list-timers 'postmark-*' shows the clock; systemctl status uat.slice shows the cap."
fi
