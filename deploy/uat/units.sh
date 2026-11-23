#!/usr/bin/env bash
# deploy/uat/units.sh — UAT runs prod's own unit files, on prod's clock, minus what reaches real people or money (CORE-160). UNRUN.
#
#   sudo bash deploy/uat/units.sh            install, mask, enable (starts nothing that is not already running)
#   sudo bash deploy/uat/units.sh --start    the same, then start the enabled set
#
# The unit files come from the office tree the frozen release was carried into (/srv/postmark-office/deploy),
# byte for byte, so a unit change rides the release like any code. UAT keeps prod's schedule: the ferry's
# crossings at 00:00 and 12:00 UTC are town law (the crossing is named by its hour), and that clock is part of
# what UAT tests. UAT's box is its own, so nothing collides.

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/lib.sh"
uat_require_root
uat_refuse_prod
uat_require_marker

SRC=/srv/postmark-office/deploy
[ -f "$SRC/postmark-office.service" ] || uat_die "$SRC has no unit files: carry the frozen release into /srv/postmark-office first (README § The order)."

# What runs: the office, the town's crossing chain, the store's candle and projections, the site, and the janitor.
ENABLE=(
  postmark-office.service
  postmark-town-seal.socket postmark-town-tool.socket
  postmark-ferry.timer postmark-crossing-save.timer
  postmark-office-keep.timer
  postmark-settlement.timer postmark-world2-clearing.timer
  postmark-town-index.timer postmark-world2-law-ingest.timer postmark-world2-marks-ingest.timer
  postmark-world2-notary.timer
  postmark-site-refresh.timer
  postmark-harbor-watch.timer
  postmark-tmp-janitor.timer
)
# What never runs on UAT, masked so no hand can start it by accident:
MASK=(
  postmark-paypal-watch.service postmark-paypal-watch.timer     # real payments
  postmark-stripe-watch.service postmark-stripe-watch.timer     # real payments
  postmark-usdc-watch.service postmark-usdc-watch.timer         # real payments
  postmark-earpiece.service postmark-earpiece.timer             # wakes REAL residents during an event's window
  postmark-media-sweep.service postmark-media-sweep.timer       # frees media in a real bucket
  postmark-world2-backup.service postmark-world2-backup.timer   # UAT is a copy; it ships nothing to prod's bucket
  postmark-settlement-shadow.service postmark-settlement-shadow.timer  # UAT is the rehearsal; the shadow is prod's
  postmark-dev-freshen.service postmark-dev-freshen.timer       # dev's, not UAT's
  postmark-world2-ingest.service postmark-world2-ingest.timer   # disabled on prod too (split into law/marks)
)
# Left off, a person decides (README § Open): the sentinel posts to a Discord webhook (UAT's own, or none).
ASK=(postmark-site-sentinel.timer)

uat_say "install the unit files from $SRC (the frozen release's)"
for f in "$SRC"/postmark-*.service "$SRC"/postmark-*.timer "$SRC"/postmark-*.socket; do
  install -m 0644 "$f" /etc/systemd/system/
done
systemctl daemon-reload

uat_say "mask what never runs here"
for u in "${MASK[@]}"; do systemctl mask --quiet "$u" 2>/dev/null || true; done

uat_say "enable the UAT set"
systemctl enable --quiet "${ENABLE[@]}"
for u in "${ASK[@]}"; do uat_say "left off for a person to decide: $u"; done

if [ "${1:-}" = "--start" ]; then
  [ -f /srv/postmark-office/uat-store.json ] || uat_die "the store is not restored yet (store-restore-scrub.sh writes /srv/postmark-office/uat-store.json)."
  systemctl start "${ENABLE[@]}"
  uat_say "started. systemctl list-timers 'postmark-*' shows the clock."
fi
