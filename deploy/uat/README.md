# UAT: the frozen release's week of testing, on the Beelink (CORE-160, CORE-165)

**Why it exists.** Darko, 2026-11-22:
- 21:59 EST: "maybe we just need a separate UAT environment. because I do think if dev is frozen, then we can't actually test things out flexibly on dev."
- 22:05 EST: "Yeah, I think a separate UAT makes a lot of sense, and ideally, I think we would try to leverage the UAT box as much as possible to keep the prod box under as little load possible from non-resident operations."

**Where it runs.** Darko, 2026-11-23 08:50 EST: "yeah beelink becomes UAT and heavy work runs, perfect. we paid a lot for the beelink; might as well make use of it". That's town-rig (Ubuntu 24.04.5, 16 cores, 27 GB), which also runs the town's meeps (Letta, as `meepo`). Prod stays on EC2. From w49's freeze (Friday 2026-11-27), the frozen release is tested here, and dev stays flexible (SHIPPING § 2.6).

## What UAT is

UAT is **prod-shaped on purpose**: the repo's own unit files, paths, ports and schedule, and the frozen release's code. What makes it UAT, and keeps it apart from the meeps it shares the box with:

| | prod (EC2) | UAT (town-rig) |
|---|---|---|
| who runs it | `meepo` | **`uat`**, its own system user: not in meepo's group, no right to meepo's home. On town-rig, `meepo` is the meeps' Letta user. |
| size | t3.xlarge, 4 vCPU, 16 GB | **`uat.slice`**: cores 12–15 only (`AllowedCPUs`), 16 GB (`MemoryMax`), no swap. A load run's numbers mean something for prod, and the other twelve cores stay the meeps'. |
| Node | v22 | Node 22 at `/usr/bin/node`; each unit's PATH puts it first. The meeps' `/usr/local/bin/node` (v25) isn't touched. |
| the store | `world2_dev` (the live record) | `world2_uat`: last night's prod dump, restored and scrubbed (`store-restore-scrub.sh`, `scrub.sql`), read with UAT's own read-only AWS key |
| what it pushes to | GitHub's town, world and notary | local bare stubs in `/srv/uat-stubs` (`stubs.sh`); no GitHub token on it |
| how it's reached | its public address | **a Cloudflare tunnel** (`tunnel.sh`): uat.postmark.town to nginx on 127.0.0.1:8080, behind Access. No public port, DNS record or certificate on the box. |
| units | all | prod's set minus what reaches real people, money or the meeps: the payment watches, the earpiece, the media sweep, the backup, the shadow, the tmp janitor (it deletes *meepo's* `/tmp` files) |
| clock | crossings at 00:00 and 12:00 UTC | the same: the crossing is town law, and its clock is part of what's tested |

It's also where heavy work that shouldn't run on prod's box goes. The POS-1191 build compares ran on the seat house for that reason.

## Darko's steps (credentials and accounts: none of these are the kit's to take)

1. ~~**AWS:** an IAM user that may only list and read the backup bucket.~~ **Done 2026-11-23 09:27 EST** (the key in Darko's vault file; it goes to `/etc/postmark-uat-aws.env`).
2. **Cloudflare:** ~~install `cloudflared` on town-rig~~ (**done 09:30 EST**). Then make the tunnel, with public hostname `uat.postmark.town` → `http://localhost:8080`, and its **Access application** (who may sign in, like dev's). The tunnel's token goes to Jetto as a file, never pasted.
3. **GitHub:** an OAuth app for `https://uat.postmark.town` (its client id and secret go in `office.env`).
4. **UAT's own keys,** never copies of prod's: a witness key, the creature seed key, the store role passwords. No Bluesky, PayPal, Stripe or USDC credential, ever.
5. **The scrub review.** `scrub.sql` is a draft. `store-restore-scrub.sh` refuses until its `REVIEWED:` line names his ruling. The open questions are in its header.

## The order (on town-rig, as root)

```
sudo bash deploy/uat/provision.sh                      # the slice, Node 22, Postgres 16, nginx, the uat user, the marker
sudo bash deploy/uat/stubs.sh main settlement/S<N>     # bare stubs for town, world, notary; the clones point at them
#   the env files from env/*.template (root:root 0600), and /etc/postmark-uat-aws.env from Darko's key
#   the frozen release into /srv/postmark-office, as uat. The FIRST time:
#     sudo -u uat sh -c 'curl -sL https://github.com/postmark-town/postmark-office/archive/<sha>.tar.gz | tar -xz --strip-components=1 -C /srv/postmark-office && cd /srv/postmark-office && PATH=/usr/bin:/bin npm ci'
#   after that: deploy/dev-office-carry.sh with BOX=town-rig DEV_ROOT=/srv/postmark-office DEV_SERVICE=postmark-office DEV_PORT=4380
sudo bash deploy/uat/store-restore-scrub.sh            # last night's dump -> world2_uat, scrubbed (needs REVIEWED)
sudo bash deploy/uat/units.sh --start                  # prod's units as uat in uat.slice, minus the masked set
sudo bash deploy/uat/nginx-uat.sh                      # the vhost, generated from prod's, on 127.0.0.1:8080 behind the gate
sudo bash deploy/uat/tunnel.sh <the tunnel-token file> # the connector; the token never reaches a command line
```

At each freeze: carry the frozen release, run `store-restore-scrub.sh` (a fresh scrubbed copy), and rerun `units.sh` (the unit files ride the release).

## Checked before UAT is trusted

- **The cap holds, and the meeps aren't slowed:** a load inside `uat.slice` stays on cores 12–15 and under 16 GB, while the meeps' rounds keep their timings. The receipt goes on CORE-160 before UAT's first load run.
- `systemctl show -p User` on every UAT unit reads `uat`, never `meepo` (`units.sh` refuses otherwise).

## Open (a person decides; the kit doesn't guess)

- **The sentinel.** It posts to a Discord webhook. Give UAT its own channel, or leave it off (`units.sh` leaves it off).
- **`TOWN_PUSH`, `POSTMARK_TOWN_REPO` and the human tokens** are marked CHECK in `env/office.env.template`.
- **The site refresh's `POSTMARK_API`** (prod's unit points at a read pool on :4390). Point it at UAT's office, or bring the read pool too.
- **UAT's own roll-call row and sentinel probe,** so it can't drift unseen.
- **`release-train.yml` with a `uat` target,** so a frozen release reaches UAT the way a tag reaches prod.
- **After UAT is up (Darko's 22:05 EST idea, scoping first):** run the settlement, its shadow and the site builds here, with prod receiving only results.
