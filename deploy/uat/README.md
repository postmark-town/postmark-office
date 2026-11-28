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
| size | t3.xlarge, 4 vCPU, 16 GB | **`uat.slice`**: cores 12–15 only (`AllowedCPUs`), `CPUWeight=25` there (the live box has `letta-town` at 1000: CORE-72 step 1, 2026-11-24), 16 GB (`MemoryMax`), no swap. UAT can't use more than four cores. It doesn't own them: nothing keeps a meep or a system job off cores 12–15, and where they meet, the meeps win and UAT yields (see § Open). |
| Node | v22 | Node 22 at `/usr/bin/node`; each unit's PATH puts it first. The meeps' `/usr/local/bin/node` (v25) isn't touched. |
| the store | `world2_dev` (the live record) | `world2_uat`: last night's prod dump, restored and scrubbed (`store-restore-scrub.sh`, `scrub.sql`), read with UAT's own read-only AWS key |
| what it pushes to | GitHub's town, world and notary | local bare stubs in `/srv/uat-stubs` (`stubs.sh`); no GitHub token on it |
| how it's reached | its public address | **a Cloudflare tunnel** (`tunnel.sh`): uat.postmark.town to nginx on 127.0.0.1:8480, behind Access. No public port, DNS record or certificate on the box. |
| units | all | prod's set minus what reaches real people, money or the meeps: the payment watches, the earpiece, the media sweep, the backup, the shadow, the tmp janitor (it deletes *meepo's* `/tmp` files) |
| clock | crossings at 00:00 and 12:00 UTC | the same: the crossing is town law, and its clock is part of what's tested |

It's also where heavy work that shouldn't run on prod's box goes. The POS-1191 build compares ran on the seat house for that reason.

## Darko's steps (credentials and accounts: none of these are the kit's to take)

1. ~~**AWS:** an IAM user that may only list and read the backup bucket.~~ **Done 2026-11-23 09:27 EST** (the key in Darko's vault file; it goes to `/etc/postmark-uat-aws.env`).
2. **Cloudflare:** ~~install `cloudflared` on town-rig~~ (**done 09:30 EST**). Then make the tunnel, with public hostname `uat.postmark.town` → `http://127.0.0.1:8480`, and its **Access application** (who may sign in, like dev's). The tunnel's token goes to Jetto as a file, never pasted.
3. **GitHub:** an OAuth app for `https://uat.postmark.town` (its client id and secret go in `office.env`). **Its callback URL is `https://uat.postmark.town/api/oauth/github/callback`**, with `/api`: the office sends `${PUBLIC_BASE}/oauth/github/callback` and `PUBLIC_BASE` carries `/api` as on prod. It is a GitHub-side setting no script here can check; a wrong one fails sign-in with "redirect_uri not associated with the app".
4. **UAT's own keys,** never copies of prod's: a witness key, the creature seed key, the store role passwords. No Bluesky, PayPal, Stripe or USDC credential, ever.
5. **The scrub review.** `scrub.sql` is reviewed for the tables its `REVIEWED:` line names (the sign-ins, harnesses, payers, `resident_notes`, `letter_notes`). Every other delete and scrub in it (drafts, reports, mail blocks, invite holds, letter opens, earpiece wakes, refused acts, the arrival answers, the town journal, the operator notes on roles, `oauth_berths.card`, `households.human` and the likeness request) is `awaiting` his review in the table at its top, with an `AWAITING:` line. `store-restore-scrub.sh` refuses while any `AWAITING:` line stands, and until the `REVIEWED:` line names his ruling for all of it. The UNSURE rows are his to call too.

## The order (on town-rig, as root)

```
sudo bash deploy/uat/provision.sh                      # the slice, Node 22, Postgres 16, nginx, the uat user, the marker
sudo bash deploy/uat/stubs.sh main settlement/S<N>     # bare stubs for town, world, notary; the clones point at them
#   the env files from env/*.template (root:root 0600), and /etc/postmark-uat-aws.env from Darko's key
#   the frozen release into /srv/postmark-office, as uat. The FIRST time:
#     sudo -u uat sh -c 'curl -sL https://github.com/postmark-town/postmark-office/archive/<sha>.tar.gz | tar -xz --strip-components=1 -C /srv/postmark-office && cd /srv/postmark-office && PATH=/usr/bin:/bin npm ci'
#   after that: deploy/dev-office-carry.sh with BOX=town-rig DEV_ROOT=/srv/postmark-office DEV_SERVICE=postmark-office DEV_PORT=4380
#   then /srv/postmark-office/release.json (as uat), naming the tag and sha carried: /release reads it, and the hydrate
#   takes as_of_office from it (the tree has no .git), without which the world graph is never written to the store:
#     {"tag":"release/<…>","sha":"<full sha>","deployed_at":"<now>","run":null}
#   UAT's own ed25519 keys: /srv/postmark-office/witness-key.pem and stamp-key.pem (openssl genpkey -algorithm
#   ed25519; uat:uat 0600), never prod's
sudo bash deploy/uat/witness-anchor.sh                # UAT's own witness chain: anchor = UAT's witness key, prod's copied chain archived (POS-1215)
sudo bash deploy/uat/store-restore-scrub.sh            # last night's dump -> world2_uat: owners, grants, the release's missing migrations, scrubbed (needs REVIEWED, and no AWAITING)
sudo bash deploy/uat/units.sh --start                  # prod's units as uat in uat.slice, minus the masked set
sudo bash deploy/uat/nginx-uat.sh                      # the vhost, generated from prod's, on 127.0.0.1:8480 behind the gate
sudo bash deploy/uat/tunnel.sh <the tunnel-token file> # the connector; the token never reaches a command line
```

At each freeze: carry the frozen release, run `store-restore-scrub.sh` (a fresh scrubbed copy), and rerun `units.sh` (the unit files ride the release).

**The notary is masked on UAT, on purpose.** Its job is to push a certified snapshot off-box, and nothing from UAT pushes off-box (Wright, CORE-165, 2026-11-24). Its first runs failed only because UAT had no notary checkout, and the fix is not to give it one. Leave it masked.

## Checked before UAT is trusted

- **The cap holds, and the meeps aren't slowed:** a load inside `uat.slice` stays on cores 12–15 and under 16 GB, while the meeps' rounds keep their timings. The receipt goes on CORE-160 before UAT's first load run.
- `systemctl show -p User` on every UAT unit reads `uat`, never `meepo` (`units.sh` refuses otherwise).

## Open (a person decides; the kit doesn't guess)

- **The scrub's open rulings:** every `awaiting` and UNSURE row in `scrub.sql`'s table (CORE-165).
- **The gate does not verify the Access JWT.** `nginx-uat.sh` admits any request to `127.0.0.1:8480` with a non-empty `Cf-Access-Jwt-Assertion`; from the internet that is Cloudflare Access's doing, from the box itself (the meeps share it) there is no gate. Verifying the JWT would need an nginx module.
- **Cores 12–15 are not reserved.** `CPUWeight=25` makes UAT yield to the meeps (CORE-72), so a load run on a busy box can read slower than prod would; a reservation is `AllowedCPUs=0-11` on `system.slice` and `user.slice`, which changes the box's other tenants.
- **The sentinel.** It posts to a Discord webhook. Give UAT its own channel, or leave it off (`units.sh` leaves it off).
- **`TOWN_PUSH`, `POSTMARK_TOWN_REPO` and the human tokens** are marked CHECK in `env/office.env.template`.
- **The site refresh's `POSTMARK_API`** (prod's unit points at a read pool on :4390). Point it at UAT's office, or bring the read pool too.
- **UAT's own roll-call row and sentinel probe,** so it can't drift unseen.
- **`release-train.yml` with a `uat` target,** so a frozen release reaches UAT the way a tag reaches prod.
- **After UAT is up (Darko's 22:05 EST idea, scoping first):** run the settlement, its shadow and the site builds here, with prod receiving only results.
