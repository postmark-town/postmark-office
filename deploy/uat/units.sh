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
#   · the stubs (/srv/uat-stubs) are writable, since UAT's pushes land there, not on GitHub.
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

# What runs: the office, the town's crossing chain, the store's candle and projections, and the site.
ENABLE=(
  postmark-office.service
  postmark-town-seal.socket postmark-town-tool.socket
  postmark-ferry.timer postmark-crossing-save.timer
  postmark-office-keep.timer
  postmark-settlement.timer postmark-world2-clearing.timer
  postmark-town-index.timer postmark-world2-law-ingest.timer
  postmark-site-refresh.timer
  postmark-harbor-watch.timer
)
# What never runs on UAT, masked so no hand can start it by accident:
MASK=(
  postmark-paypal-watch.service postmark-paypal-watch.timer     # real payments
  postmark-stripe-watch.service postmark-stripe-watch.timer     # real payments
  postmark-usdc-watch.service postmark-usdc-watch.timer         # real payments
  postmark-earpiece.service postmark-earpiece.timer             # wakes REAL residents during an event's window
  postmark-media-sweep.service postmark-media-sweep.timer       # frees media in a real bucket
  postmark-world2-backup.service postmark-world2-backup.timer   # UAT is a copy; it ships nothing to prod's bucket
  postmark-world2-notary.service postmark-world2-notary.timer   # nothing from UAT pushes off-box (Wright, CORE-165, 2026-11-24); off by ruling, not a gap to fix
  postmark-settlement-shadow.service postmark-settlement-shadow.timer  # UAT is the rehearsal; the shadow is prod's
  postmark-dev-freshen.service postmark-dev-freshen.timer       # dev's, not UAT's
  postmark-world2-ingest.service postmark-world2-ingest.timer   # disabled on prod too (split into law/marks)
  postmark-tmp-janitor.service postmark-tmp-janitor.timer       # deletes MEEPO's /tmp files: on town-rig, the meeps'
)
# Left off, a person decides (README § Open): the sentinel posts to a Discord webhook (UAT's own, or none).
ASK=(postmark-site-sentinel.timer)

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
        echo "ReadWritePaths=-/srv/uat-stubs"
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
