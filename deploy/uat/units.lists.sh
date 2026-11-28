# deploy/uat/units.lists.sh — which of prod's units UAT enables, masks, asks about, or installs and leaves (CORE-165).
#
# Sourced by units.sh, and by lib.sh's uat_unclassified_units, which units.sh runs BEFORE it installs anything: every
# postmark-*.service, .timer and .socket in the carried release must be named below, or be the service of a timer or
# socket that is. A unit a later train adds and nobody has judged is refused by name, so it cannot be installed (the glob
# in units.sh would pick it up) and then run as root or against the meeps' box without a decision. test/uat-kit.test.mjs
# runs the same check over the unit files the repo carries. To add a unit: read it, then put it in ONE list.
#
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
  postmark-planned-restart.service postmark-planned-restart.timer  # prod's daily restart of Postgres and the office (STAR-253/d): on town-rig it would restart the box's Postgres and UAT's office; its script (/usr/local/sbin/postmark-planned-restart.sh) is not in this kit, so unmasked it only fails
  postmark-loop-lag-keep.service postmark-loop-lag-keep.timer   # POS-1098's loop-lag keeper: its service has no User=, so it runs as ROOT, every 5 minutes, executing /srv/postmark-office/deploy/loop-lag-keep.mjs, a file in the uat-owned tree (the class review tax 2 refused for the restore). Un-mask only with a drop-in that runs it as uat
)
# Left off, a person decides (README § Open): the sentinel posts to a Discord webhook (UAT's own, or none).
ASK=(postmark-site-sentinel.timer)
# Installed, never enabled by this kit, on purpose: started by hand, or by their socket. Each is the other half of a
# listed unit, or a by-hand service nothing schedules.
KEEP_UNSTARTED=(
  postmark-office-keep-by-hand.service    # the keep tick, run by a person (its timer is enabled above)
  postmark-settlement-by-hand.service     # a settlement, run by a person
  postmark-town-seal@.service             # the sandbox the town-seal socket starts
  postmark-town-tool@.service             # the sandbox the town-tool socket starts
)
