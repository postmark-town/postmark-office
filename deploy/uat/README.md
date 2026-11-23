# UAT: the machine a frozen release is tested on (CORE-160)

**Why it exists.** Darko, 2026-11-22, at the weekly review:
- 21:59 EST: "maybe we just need a separate UAT environment. because I do think if dev is frozen, then we can't actually test things out flexibly on dev."
- 22:05 EST: "Yeah, I think a separate UAT makes a lot of sense, and ideally, I think we would try to leverage the UAT box as much as possible to keep the prod box under as little load possible from non-resident operations."

From w50, the frozen release runs here for its week of testing, and dev goes back to following the open train (postmark-telemetry SHIPPING, draft § 2.6). w49 is tested on dev.

**Status: every script here is UNRUN.** They were written on 2026-11-23 so that the machine can be built in an afternoon once Darko's steps below are done. Each one refuses to run on prod's box (`lib.sh`).

## What UAT is

UAT is **prod-shaped on purpose**. It runs the repo's own unit files, paths, ports and schedule, and the frozen release's code. What makes it UAT, not prod:

| | prod | UAT |
|---|---|---|
| the store | `world2_dev` (the live record) | `world2_uat`: last night's prod dump, restored and scrubbed (`store-restore-scrub.sh`, `scrub.sql`) |
| what it pushes to | GitHub's town, world and notary repos | local bare stubs in `/srv/uat-stubs` (`stubs.sh`); no GitHub token on the box |
| sign-in | the GitHub OAuth app for postmark.town | its own OAuth app for uat.postmark.town; no prod token survives the scrub |
| who can reach it | everyone | Cloudflare Access, as dev (`nginx-uat.sh` generates the vhost from prod's, plus dev's gate) |
| units | all | prod's set minus what reaches real people or money: the payment watches, the earpiece, the media sweep, the backup, the settlement shadow (`units.sh`) |
| clock | crossings at 00:00 and 12:00 UTC | the same: the crossing is town law, and its clock is part of what's tested |

It is also a place to run heavy work that should not run on prod's box. A full-against-incremental site build compare (POS-1191) needs about 4.4 GB and a whole build's CPU, which prod's disk alarm and Darko's 22:05 ruling both say should not happen there.

## Darko's steps (credentials and money: none of these are the kit's to take)

1. **AWS.**
   - Launch a **t3.large with 60 GB gp3** from a **fresh Ubuntu 24.04 image**: never prod's AMI or a snapshot of prod's disk. `provision.sh` refuses a clone, because a clone boots with prod's units and credentials.
   - Attach an instance role that may **list and get** the backup bucket (`DEPLOY.md` § The S3 route), and nothing else.
   - Rough cost (CORE-160): about $66 a month.
2. **Cloudflare.** A `uat.postmark.town` DNS record (proxied), an **origin certificate** at `/etc/ssl/uat.postmark.town-origin.pem` and `/etc/ssl/private/uat.postmark.town-origin.key`, and an **Access application** saying who may sign in, like dev's.
3. **GitHub.** A GitHub **OAuth app** for `https://uat.postmark.town` (its client id and secret go in `office.env`), and a way for the frozen release to reach the box. Until `release-train.yml` learns a `uat` target, that's a hand-carry (below).
4. **Keys of UAT's own**, never copies of prod's: a witness key, the creature seed key, store role passwords, and optionally an R2 bucket for uploads. No Bluesky, PayPal, Stripe or USDC credential, ever.
5. **The scrub review.** `scrub.sql` is a draft. `store-restore-scrub.sh` refuses to run until its `REVIEWED:` line names his ruling. Two questions are still open in its header: are there private parts beyond the listed ones, and what about `arrival_source_pending`?

## The order (after Darko's steps)

```
sudo bash deploy/uat/provision.sh                      # packages, node 22, Postgres 16, the user, the marker
sudo bash deploy/uat/stubs.sh main settlement/S<N>     # bare stubs for town, world, notary; the clones point at them
#   the env files, from env/*.template (root:root 0600)
#   the frozen release into /srv/postmark-office. The FIRST time, as meepo (the carry's preflight refuses an
#   empty root): curl -sL https://github.com/postmark-town/postmark-office/archive/<sha>.tar.gz |
#   tar -xz --strip-components=1 -C /srv/postmark-office && (cd /srv/postmark-office && npm ci)
#   Every time after: deploy/dev-office-carry.sh with
#   BOX=<uat host> DEV_ROOT=/srv/postmark-office DEV_SERVICE=postmark-office DEV_PORT=4380
sudo bash deploy/uat/store-restore-scrub.sh            # last night's dump -> world2_uat, scrubbed (needs REVIEWED)
sudo bash deploy/uat/units.sh --start                  # prod's units, minus the masked set
sudo bash deploy/uat/nginx-uat.sh                      # the vhost, generated from prod's, behind the gate
```

At each freeze: carry the frozen release, run `store-restore-scrub.sh` (a fresh scrubbed copy), and rerun `units.sh` (the unit files ride the release).

## Open (a person decides; the kit doesn't guess)

- **The sentinel.** It posts to a Discord webhook. Give UAT its own channel, or leave it off (`units.sh` leaves it off).
- **`TOWN_PUSH`, `POSTMARK_TOWN_REPO` and the human tokens** are marked CHECK in `env/office.env.template`. Confirm what the office does with each before the first boot.
- **The UAT box's own roll-call row and sentinel probe**, so it can't drift unseen the way dev's store did (a 09-25 copy).
- **`release-train.yml` with a `uat` target**, so a frozen release reaches UAT the way a tag reaches prod, with rollback as dispatching the previous tag.
