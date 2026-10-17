#!/bin/sh
# regenerate the postmark git-activity dashboard (postmark-office/tools/git-report.mjs)
# Runs as meepo (the town clone + token are meepo's). Installed at
# /etc/cron.hourly/postmark-git-report. 2026-07-18.
# Token: /srv/postmark-office/git-metrics-token (meepo 600) — fine-grained
# READ-ONLY PAT on postmark-town/postmark (PRs: read, Issues: read).
exec /usr/sbin/runuser -u meepo -- /usr/bin/node /srv/postmark-office/tools/git-report.mjs >> /var/log/postmark-git-report.log 2>&1
