# Deploying the office to the atelier box (EC2, nginx/Ubuntu)

The same box that serves `starforge-atelier.online` and already pulls the town
repo ~every 30 min for the site extractor. The office rides that rhythm.

> **Live-truth note (2026-07-19):** the box's `/srv/postmark-office` is a plain
> file copy, NOT the git clone step 1 below describes — a code deploy is
> `scp src/<changed>.mjs meepo-ec2:/srv/postmark-office/src/` +
> `sudo systemctl restart postmark-office`, then probe a route whose response
> only the new code produces (a restart alone proves nothing). Discovered
> mid-deploy shipping POST /keys; this note is the backport.

## The weekly train (Keemin-directed 2026-08-23)

> **The whole of how code ships, in one place:** the maintainers' `SHIPPING.md`, private in `postmark-town/postmark-telemetry` at `docs/SHIPPING.md` since 2026-10-11 (each repo's PR base and route to live, hotfixes and their hand tag, the train taking main the same day, keeping the trains clean). This file keeps the office's deploy mechanics; the rules live there (2026-10-06). An outside contributor's route is public: postmark-blueprints `CONTRIBUTING.md` § Code.

Feature branches merge into `train/2026-wNN`; the DEV office runs the train
branch when it is hand-carried there (the workflow deploys tags only; SHIPPING.md § 3). ~Weekly the train PRs into `main`;
the founder's Approve is the merge word; the merge cuts `release/2026-wNN[.n]`
(`.github/workflows/release-train.yml`). PROD deploys go FROM THE TAG — since
POS-60 the same workflow carries them (§ below); before that they were
hand-carried by the procedure in the live-truth note above, which remains the
break-glass. Never from main tip or a feature branch. Branches are
`train/*`, tags are `release/*` — the namespaces never collide. The record
repos (world, town) are train-exempt: their main is live by nature; world
ENGINE changes reach prod through the site's world pin riding the site train.

## The auto-deploy (POS-60, 2026-08-26)

`.github/workflows/release-train.yml` no longer only cuts the tag — it deploys
it, in the same run. **Nothing about the procedure changed; only the hand did.**
The workflow does the three steps the live-truth note above prescribes, in that
order, and goes red if any of them cannot be proven:

| the hand-carry | the workflow |
|---|---|
| `scp src/<changed>.mjs` from the tag | `git archive <tag>` → rsync onto the box |
| `sudo systemctl restart postmark-office` | the same, over ssh, with `sudo -n` |
| "probe a route whose response only the new code produces" | polls `GET /release` until it names this run's tag and sha |

**Prod code still only moves when the founder approves a train PR.** The
workflow deploys the tag that approval cuts. A main push whose subject carries
no train name cuts no tag and deploys nothing.

### The adoption gate — merging this changes nothing

Until the repo variable `OFFICE_AUTODEPLOY` is `on`, an automatic trigger cuts
the tag exactly as it always did **and stops**. Today's behaviour, unchanged;
the hand-carry stays the way code reaches the box.

```sh
gh variable set OFFICE_AUTODEPLOY --body on  -R postmark-town/postmark-office   # adopt
gh variable set OFFICE_AUTODEPLOY --body off -R postmark-town/postmark-office   # back to hand-carry
```

The gate exists because of an awkward, specific fact: **`workflow_dispatch` does
not appear in the Actions tab until the file is on the default branch**, so this
cannot be rehearsed before it is merged. Without the gate, the first thing the
machinery ever did in anger would be deploying prod, unrehearsed, the moment a
train landed. With it, the order is:

1. merge — nothing changes, the tag cuts as before;
2. dispatch against **dev**, walk the sandbox;
3. dispatch against **prod** with the standing tag — a redeploy of what is
   already running, so a failure costs a restart, not a release;
4. then set `OFFICE_AUTODEPLOY=on`, and train merges carry themselves.

`workflow_dispatch` is never gated — it is a human deliberately asking.

### The receipt: `GET /release`

The office now serves its own deploy stamp. The workflow writes `release.json`
into the tree it ships, and `src/release.mjs` reads it **once, at boot** — so an
answer carrying this run's tag can only come from a process that started after
this run's copy landed. That is what makes the probe a proof of restart rather
than a proof of file-copy, and it is pinned by `test/release-door.test.mjs`.

```sh
curl -s https://postmark.town/api/release
```

An office placed by hand has no stamp and answers `deployed: false`. That is
legal and silent — it boots exactly as it always did — but it never reads green
to a probe.

### What the deploy does NOT touch

The office root is a shared directory, unlike the site's webroot. Root-level
files sync **without `--delete`**; only the tag's own top-level directories get
a `--delete` sync. Since the tag has no such directories, everything the box
keeps under `/srv/postmark-office` that the repo does not know about is out of
reach by construction: `town-clone/`, `world-clone/`, `world-clone-pool/`,
`settlement-clone/`, `shadow-clone/`, `draft-locks/`, `node_modules/`, and the
root-level `town.lock`, `office.db`, `oauth.db`, `dynamic.db`,
`.git-credentials`, `git-metrics-token`, `stamp-key.pem`.

Three directories are excluded by name:

- **`telemetry/`** — the trap. It is tracked (`telemetry/github/*.json`) *and*
  box-written (`access-*.jsonl`, plus fresh gh snapshots the hourly cron writes
  and commits back later). Deploying it from a tag would delete the live access
  logs and roll the snapshots back to whenever the train was cut. The box is the
  writer here; the repo is the archive.
- **`.github/`** — CI config; nothing on the box reads it.
- **`.omc/`** — the orchestration layer's per-operator session state, untracked
  and gitignored since 2026-09-21 (Keemin, ROLLOVER 25). The exclusion is the
  second net, not the fix: the first net is that the tag no longer carries the
  directory, so `git archive` never puts it in `stage/` and this list never sees
  it. **The box's own copy is not deleted by this.** A directory absent from
  `dirs.txt` gets no `--delete` sync, and root-level files sync without
  `--delete` — so whatever `/srv/postmark-office/.omc/` holds on dev and prod
  stays until somebody removes it by hand.

**Nothing is installed into `/etc`.** `deploy/*.service`, `deploy/*.timer` and
the nginx confs land in `/srv/postmark-office/deploy/` as ordinary files and go
no further. Installing a unit or a vhost stays a hand step, deliberately: the
live copies on the box have drifted from the repo copies before, so read the
live file and backport it before ever installing over it.

### Dependencies

`npm ci --omit=dev` runs only when `package-lock.json`'s hash differs from the
marker left by the last install. With no marker and an existing `node_modules`,
the deploy **adopts** rather than reinstalls — this box has served the town for
months, its install is correct by demonstration, and the first auto-deploy is
the wrong moment to tear it down. If it is in fact wrong, the probe fails loudly.

**`sharp` is a native dependency** (postmark#2940, the media door's small
copies): the lockfile pins a prebuilt `@img/sharp-linux-x64` + libvips for the
box, so `npm ci` needs no compiler — but it does need the network to fetch
that binary, and a lockfile change is what triggers the reinstall above. The
office loads it lazily: a box whose binary failed to land still opens the
door and logs `no small copies` on each upload instead of refusing it.
The one-time backfill for originals that predate the copies is
`tools/media-thumbnails-backfill.mjs` (dry by default; `--apply` with the R2
env), run by hand after the ship.

### Rehearsing, and the redeploy lane

- **`workflow_dispatch` → target `dev`** deploys a tag to `/srv/postmark-office-dev`
  (unit `postmark-office-dev`, port 4381). `dev` is the default on the dispatch
  form on purpose. Note dev is behind Cloudflare Access, so only the loopback
  probe can run there — a runner gets a 403 either way.
- **`workflow_dispatch` → target `prod`**, blank tag, redeploys the newest
  `release/*` tag. This is the "put it back" button.
- **Pushing a `release/*` tag by hand** also deploys. The train's own tag push
  cannot re-trigger a workflow (it is made with `GITHUB_TOKEN`), which is
  precisely why the deploy job chains onto the tag-cutting job inside one run
  rather than living in a separate tag-triggered file that would never fire.

### The dev rehearsal (POS-354, POS-366; first run Saturday 2026-10-10)

`tools/dev-rehearsal.mjs` drives one crossing through the dev office's doors and
the box's own jobs, and checks every step against the dev store. It gates the
office tag (wright-ship-week § 2.5). Dev's store is `w2_devsandbox_20260925`;
**`world2_dev` is PROD's**, and the tool refuses it before it connects. These are
box writes on dev only, with Darko present. The switch-3 half of Saturday (the
read-only pen and the world snapshot) is `G:/Starstory/docs/2026-10-04/rail/switch3/RUNBOOK.md`
§ The dev rehearsal; its steps 1 and 3 are steps 1 and 2 here, done once.

**1. Migrations 054–071 into dev's store, before the carry**, as `world2_owner`,
from Wright's machine (Git bash). Every file is additive or `IF NOT EXISTS`:
```sh
CLONE=G:/Postmark/repo-clones/wright/office; REF=origin/train/2026-w42
git -C $CLONE fetch -q origin
for f in $(git -C $CLONE ls-tree --name-only $REF world2/schema/ | grep -E '/0(5[45]|6[0-9]|7[01])_'); do
  echo "== $f"
  git -C $CLONE show "$REF:$f" | ssh meepo-ec2 'sudo -n -u postgres psql -q -v ON_ERROR_STOP=1 -d w2_devsandbox_20260925 -c "SET ROLE world2_owner;" -f -' \
    || { echo "FAILED at $f: stop here, nothing after it ran" >&2; break; }
done
```

**2. Carry the train:** `bash deploy/dev-office-carry.sh origin/train/2026-w42`.

**3. Dev's own stamp key** (Darko said yes on 10-07). On 10-07 the dev root's
`stamp-key.pem` was a byte-identical copy of PROD's. In a box shell:
```sh
sudo -u meepo bash -c 'umask 077 && openssl genpkey -algorithm ed25519 -out /srv/postmark-office-dev/stamp-key.dev.pem'
# both PUBLIC halves' fingerprints, never a private key of prod's: dev's new key, then prod's
# public key from its town clone. They must differ. pipefail makes a failed read an error, and
# e3b0c442… (the sha256 of nothing) also means a read failed: stop either way
sudo -u meepo bash -o pipefail -c 'openssl pkey -in /srv/postmark-office-dev/stamp-key.dev.pem -pubout | sha256sum'
sudo -u meepo bash -o pipefail -c 'openssl pkey -pubin -in /srv/postmark-office/town-clone/tools/stamp-pubkey.pem -pubout | sha256sum'
```
What this buys, plainly: dev and prod both run as `meepo`, so any dev-side
process can still read prod's key. Dev's own key guards against signing with
prod's key **by mistake**, not against a compromise. The tools compare keys by
their public halves only (the seed's `tools/stamp-pubkey.pem` is prod's public
key), so prod's private key is never read to make that check.

The old `/srv/postmark-office-dev/stamp-key.pem` is a second copy of prod's
signing key; prod's own stays at `/srv/postmark-office/stamp-key.pem`. Darko's
word on removing the copy, then the new key takes its path (the freshen and the
env line below name it):
```sh
sudo shred -u /srv/postmark-office-dev/stamp-key.pem
sudo -u meepo mv /srv/postmark-office-dev/stamp-key.dev.pem /srv/postmark-office-dev/stamp-key.pem
```

**4. The env, without the stamp switch yet, STAMP_KEY first.** `sudoedit /etc/postmark-office-dev.env`
and add (never in a shell line):
`TOWN_INDEX_READS=store` · `OFFICE_PAPERWORK_STORE=1` · `STATE_LOG_SOURCE=store` ·
`STAMP_KEY=/srv/postmark-office-dev/stamp-key.pem`. `GITHUB_API_URL` is already
there (10-07). Then `sudo systemctl restart postmark-office-dev`.
`OFFICE_PAPERWORK_STORE=1` moves dev's sign-ins from `oauth.db` to the store, so
testers signed in on dev sign in again. The key goes in before the freshen (step
5), so the dev office never signs with prod's default key path onto a clone
already carrying dev's public key. Until step 5 lands, a stamped dev write reds
the verifier (the clone still carries prod's public key): do none in between.

**5. The freshen moves the town clone onto dev's key.** The unit runs the root
copy, `/srv/postmark-office-dev/postmark-dev-freshen.sh`, and the carry does not
install it. `cp` onto the existing file keeps its owner and mode:
```sh
sudo cp /srv/postmark-office-dev/deploy/postmark-dev-freshen.sh /srv/postmark-office-dev/postmark-dev-freshen.sh
sudo systemctl start postmark-dev-freshen.service
journalctl -u postmark-dev-freshen.service -n 3 --no-pager   # "... the town ledger on the dev key"
sudo -u meepo git -C /srv/postmark-office-dev/town-clone log -1 --format='%an: %s'   # dev freshen: dev: the stamp ledger re-signed ...
```
The tool re-signs only a dev clone: every remote's push URL must be
`DISABLED-dev-channel-never-pushes` and its real path under
`/srv/postmark-office-dev` (it refuses prod's clone by both). Check the first before
this step: `sudo -u meepo git -C /srv/postmark-office-dev/town-clone remote get-url --push origin`.
Every night after, the freshen stands the clones on `sandbox/seed` and re-signs
with `tools/dev-ledger-resign.mjs`. The commit is the same each night (fixed
author and date, deterministic signatures). It refuses a key whose public half
is prod's, and a refusal fails the unit.

**6. The store's stamp chain, from the re-signed clone, once** (the box's switch
order: 066/067, the chain, the index, then `STAMP_LINES=store`). As the dev
office's own pen, with its env:
```sh
sudo systemd-run --uid=meepo -p EnvironmentFile=/etc/postmark-office-dev.env -p WorkingDirectory=/srv/postmark-office-dev --pipe --wait \
  node world2/tools/stamp-lines.mjs --sync --clone /srv/postmark-office-dev/town-clone
```
It says `stamp_lines: N line(s) recorded past the 0 held`. It must run after
step 5: a chain recorded from prod's signatures refuses dev's re-signed export
as a changed past.

**7. The town index, reseeded at the clone's head, as the law pen**, the stamp
switch on for the seed (its quest rows fold on the chain from step 6):
```sh
cd /srv/postmark-office-dev && sudo bash -c '
  export WORLD2_DB=w2_devsandbox_20260925 STAMP_LINES=store
  . deploy/world2-lib.sh && w2_pgenv law_ingester PG_LAW_INGESTER_PASSWORD || exit 4
  [ "$PGDATABASE" = w2_devsandbox_20260925 ] || { echo "REFUSED: $PGDATABASE is not the dev sandbox" >&2; exit 9; }
  SHA=$(runuser -u meepo -- git -C /srv/postmark-office-dev/town-clone rev-parse HEAD)
  exec runuser -u meepo -- node world2/tools/town-index-ingest.mjs --town-repo /srv/postmark-office-dev/town-clone --sha "$SHA" --seed'
```
`world2-lib.sh § w2_db` falls back to `world2_dev` (PROD) when `WORLD2_DB` is
unset, so the line sets it and asserts it before anything writes.

**8. The switch.** Add `STAMP_LINES=store` to `/etc/postmark-office-dev.env`
(sudoedit), then `sudo systemctl restart postmark-office-dev`.

**9. The pens file**, `/etc/postmark-dev-rehearsal.env` (root 0600, sudoedit),
both URLs naming dev's database (the tool refuses any other):
```
WORLD2_INGEST_URL=postgres://law_ingester:<PG_LAW_INGESTER_PASSWORD from /etc/postmark-world2-dev.env>@localhost:5432/w2_devsandbox_20260925
WORLD2_CLEARING_URL=postgres://clearing_job:<clearing_job's password, from the env file the box's clearing unit reads>@localhost:5432/w2_devsandbox_20260925
```
Roles are cluster-wide, so prod's `clearing_job` password is dev's too
(`systemctl cat postmark-world2-clearing.service` names its env file).

**10. The preflight, then the rehearsal.** In a box shell:
```sh
cd /srv/postmark-office-dev && sudo node tools/dev-rehearsal.mjs --user meepo --only preflight
cd /srv/postmark-office-dev && sudo node tools/dev-rehearsal.mjs --user meepo --report /tmp/dev-rehearsal-$(date +%F).txt
```
The first line names the store it writes. The preflight names anything still
missing: a migration, a flag, the key (dev's must not be prod's, and the clone's
`tools/stamp-pubkey.pem` must be its public half), the town index off the
clone's history, a stamp chain that disagrees with the clone.

The last step is the stamp sandbox (POS-366). It cannot run on the box (the
carry omits devDependencies, and it would share prod's CPU for 10–40 minutes),
so it reads CI's `stamp sandbox` check on the sha in `release.json` through
GitHub's public API, and is red unless the newest run there concluded success.
Before the rehearsal, label the train's ship PR (`train/<week>` into `main`)
`stamp-sandbox`: its runs report on the train's tip, which is the sha the carry
takes. A skipped or cancelled run (another label's event cancels a running
one) is never judged; if those are all there is, the step asks for a re-run.

**The merge-ref gap.** A PR's sandbox run checks out the PR's merge ref
(`refs/pull/N/merge`: main merged into the train), so a green attests main plus
the train, not exactly the tree carried to dev. A hotfix on main that the train
lacks is in what was tested and not in what dev runs. Close it by merging main
into the train before the ship (SHIPPING.md), or, once `sandbox.yml` is on main,
by a `workflow_dispatch` run on the train ref, which checks out the exact sha.

**Before each later rehearsal** (the nightly freshen stands the clone back on
the seed and the store keeps the last rehearsal's rows):
- the stamp chain is trimmed to the seed, then checked. The re-sign is the same
  every night, so the store's first N lines are the seed's exactly. In a box shell:
  ```sh
  N=$(sudo -u meepo node --input-type=module -e 'const e = await import("/srv/postmark-office-dev/town-clone/tools/stamp-mint.mjs"); const { readFileSync } = await import("node:fs"); console.log(e.parseStampLedger(readFileSync("/srv/postmark-office-dev/town-clone/WHITE_PAGES/stamp-ledger.md", "utf8")).length)')
  sudo -u postgres psql -d w2_devsandbox_20260925 -v ON_ERROR_STOP=1 -c "SET ROLE world2_owner; DELETE FROM stamp_lines WHERE seq > $N"
  sudo systemd-run --uid=meepo -p EnvironmentFile=/etc/postmark-office-dev.env -p WorkingDirectory=/srv/postmark-office-dev --pipe --wait \
    node world2/tools/stamp-lines.mjs --verify --clone /srv/postmark-office-dev/town-clone
  ```
- then step 7 again (the index at the clone's head), and step 10.

This trim is a recurring hand repair, and dev's stamped writes refuse every
night until someone runs it. Folding it into the freshen (or a dev-only unit
after it) is proposed, not built: it would give a dev unit the owner's DELETE on
`stamp_lines`, which is Wright's call
(`G:/Starstory/docs/2026-10-09/rail/plumb-dev-rehearsal/NOTES.md` § Proposal: the trim
in the freshen).

### Repo secrets it needs

`EC2_HOST`, `EC2_USER`, `EC2_SSH_KEY` — the same three names the site repo
already holds. Set them on `postmark-town/postmark-office`. The deploy user must own
`/srv/postmark-office` outright and hold passwordless sudo for `systemctl` on
the office units; the workflow's preflight checks both **before** copying a
single byte, and says which `chown` to run if the tree is not writable. A
permissions bounce is fixed by `chown`, never by escalating the copy to sudo.

### Rollback

`sudo systemctl stop postmark-office` (as below), or redeploy the previous tag
by `workflow_dispatch` with `target: prod` and that tag's name.

## One-time setup

```sh
# 1. code + clones (as the deploy user, e.g. under /srv)
sudo mkdir -p /srv/postmark-office && sudo chown $USER /srv/postmark-office
git clone https://github.com/postmark-town/postmark-office.git /srv/postmark-office
git clone https://github.com/postmark-town/postmark.git /srv/postmark-office/town-clone

# 2. secrets — NEVER in either repo
#    QUOTE ANY VALUE THAT HOLDS A SPACE OR A SHELL CHARACTER (; & | # $ ` ( ) < >),
#    in double quotes: BOT_NAME="Postmark Pen". systemd reads either form, but
#    the steps in this file that load an env into a shell (`set -a; . <file>`)
#    run an unquoted value's second word as a command ("line 5: Pen: command not
#    found"), and an unquoted `;` silently cuts the value at it, with no error at
#    all (POS-590). Double quotes, not single: the scripts that read these files
#    with sed (cron-postmark-activity-report.sh) strip double quotes only. A
#    value holding `"`, `$`, a backtick or `\` needs more than quotes; read the
#    file's consumers first.
#    A store URL and its switch go together: WORLD2_PG=1 with WORLD2_PG_URL, or
#    neither (src/world2-acts.mjs § world2Enabled). The roll-call's ALARM-env
#    row checks that pair for every unit (POS-581).
sudo tee /etc/postmark-office.env >/dev/null <<'EOF'
TOWN_CLONE=/srv/postmark-office/town-clone
TOWN_PUSH=1
BOT_NAME="postmark-office[bot]"
BOT_EMAIL=<bot-account-noreply-email>
EOF
sudo chmod 600 /etc/postmark-office.env
# static keys are store rows, not env lines (POS-352). Never put OFFICE_KEYS in
# this file. Each key goes in by one run of the import, as meepo, with THIS env
# loaded (it carries OFFICE_PAPERWORK_STORE=1, WORLD2_PG=1 and WORLD2_PG_URL, the
# store the office reads) and --oauth-db naming the office's own file; without
# them the key lands in the checkout's oauth.db and answers as anonymous. The
# full command, entry on stdin: deploy/DEPLOY.md § Static keys leave the env
# file, "Adding a static key later".

# 2b. pen credentials + identity on the town clone (the pen = the machine
#     GitHub account, e.g. postmark-pen: classic PAT, public_repo scope only,
#     write access to postmark-town/postmark and NOTHING else; token custody =
#     this box + the principal's password manager, never either repo)
git -C /srv/postmark-office/town-clone config credential.helper \
  "store --file /srv/postmark-office/.git-credentials"
printf 'https://postmark-pen:<TOKEN>@github.com\n' > /srv/postmark-office/.git-credentials
chmod 600 /srv/postmark-office/.git-credentials
git -C /srv/postmark-office/town-clone config user.name  "Postmark Pen"
git -C /srv/postmark-office/town-clone config user.email "<pen-noreply-email>"

# 3. units (office + the keeping tick + the ferry at the published crossings).
#    No rehydrate: office.db is retired (POS-268 part 5b) and the office reads
#    the store's town index. The keeping tick reads /etc/postmark-world2-dev.env
#    for the law pen (its world hydration), so that file comes first (§ The
#    World 2.0 box lanes, Install).
sudo cp deploy/postmark-office.service deploy/postmark-office-keep.{service,timer} \
        deploy/postmark-office-keep-by-hand.service \
        deploy/postmark-ferry.{service,timer} /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now postmark-office postmark-office-keep.timer postmark-ferry.timer

# 4. nginx — two surfaces, one snippet:
#    - install deploy/nginx-api.conf as /etc/nginx/snippets/postmark-api.conf
#    - include it from BOTH server{} stanzas: the starforge-atelier.online one
#      (legacy, kept serving) and deploy/nginx-postmark-town.conf (canonical
#      domain since 2026-07-08; install as sites-available/postmark-town,
#      symlink into sites-enabled, cert via certonly --webroot as in its header)
#    - the snippet names zones, a cache and two maps that live in http{}, so
#      the conf.d files go in first or `nginx -t` refuses it. The first four are
#      the box's live files, byte for byte, as they stood 2026-09-27 01:05Z
#      (POS-267); the fifth is the /api/ timing log, which is not on the box yet.
#      The keyless zone's source is still deploy/nginx-rate-limit.conf.snippet
#      (its http{} half), as installed 2026-08-14.
sudo cp deploy/nginx-worldcache.conf /etc/nginx/conf.d/postmark-worldcache.conf
sudo cp deploy/nginx-present-grid.conf /etc/nginx/conf.d/postmark-present-grid.conf
sudo cp deploy/nginx-present-zone.conf /etc/nginx/conf.d/postmark-present-zone.conf
sudo cp deploy/nginx-api.conf /etc/nginx/snippets/postmark-api.conf
sudo cp deploy/nginx-api-timing.conf /etc/nginx/conf.d/postmark-api-timing.conf
sudo nginx -t && sudo systemctl reload nginx

# 5. the panes origin (household windows — postmark-windows Phase 0)
#    isolated origin: pane scripts run on panes.postmark.town, never on the
#    OAuth-holding postmark.town (see deploy/nginx-postmark-panes.conf header).
sudo mkdir -p /var/www/postmark-panes && sudo chown meepo:meepo /var/www/postmark-panes
sudo cp deploy/nginx-postmark-panes.conf /etc/nginx/sites-available/postmark-panes
sudo ln -s /etc/nginx/sites-available/postmark-panes /etc/nginx/sites-enabled/
sudo certbot certonly --webroot -w /var/www/certbot -d panes.postmark.town
sudo nginx -t && sudo systemctl reload nginx
node deploy/publish-windows.mjs --town "$TOWN_CLONE" --out /var/www/postmark-panes/live
# (the keeping tick republishes on every pull — deploy/office-keep.sh)

# 6. the harbor's own domain (1f4ee.town — 📮 U+1F4EE, "1 ferry 4 everyone")
#    NO new webroot: this vhost is a second door onto the SAME site tree, with
#    `location = /` serving the built /harbor/index.html at the root. DNS (A
#    records, apex + www → the box) must resolve BEFORE certbot, and the port-80
#    stanza must be live to answer the acme challenge — so install, reload, then
#    cert, then reload again.
sudo cp deploy/nginx-1f4ee-town.conf /etc/nginx/sites-available/1f4ee-town
sudo ln -s /etc/nginx/sites-available/1f4ee-town /etc/nginx/sites-enabled/
# first reload will fail nginx -t on the missing cert; if so, comment the two 443
# stanzas, reload, run certbot, uncomment, reload.
sudo certbot certonly --webroot -w /var/www/certbot -d 1f4ee.town -d www.1f4ee.town
sudo nginx -t && sudo systemctl reload nginx
# re-install nginx-postmark-town.conf in the same pass — it now 301s /harbor/ here
```

## Domains

`https://postmark.town` is the canonical public base (Porkbun, registered
2026-07-08; A records apex + www → the box). `PUBLIC_BASE=https://postmark.town/api`
— the `/api` suffix matters: nginx strips it when proxying, and oauth.mjs builds
endpoint URLs from it. `starforge-atelier.online/api` keeps serving as a legacy
alias (bearer tokens don't care about origin), but OAuth discovery on both
domains now advertises postmark.town endpoints, and the GitHub OAuth App's
single callback URL points at `https://postmark.town/api/oauth/github/callback`.
Root `/` on postmark.town 302s (not 301 — it becomes the site-hub) to the atlas.

`https://1f4ee.town` is the HARBOR's own domain (registered 2026-08-16; A records
apex + www → the same box). Same webroot, no second build: the vhost serves the
built `/harbor/index.html` at its root and mirrors the rest of the site as a
safety net for the page's root-relative refs, noindexed so it never competes with
postmark.town in search. `postmark.town/harbor/` 301s here permanently; the
snapshot at `postmark.town/harbor/data/harbor-snapshot.json` deliberately does
NOT move, because it is a published data address with readers of its own.

## Smoke (from anywhere)

```sh
curl -s -H "Authorization: Bearer <key>" https://postmark.town/api/town
```

## Notes

- **The keeping tick, and the rehydrate retired (POS-268: split 2026-09-27,
  adopted 2026-10-04; part 5b 2026-10-08).** `postmark-office-keep.timer`
  (:07/:22/:37/:52, `deploy/office-keep.sh`) pulls the town clone, fetches the
  world's tags, runs the mint catch-up and welcome pass, writes the settlements
  row, hydrates the world (`deploy/office-world-hydrate.sh`: the store's world
  graph snapshot at the newest blessing; `world.db` is retired since switch 3,
  office #294) and publishes the panes.
  `postmark-office-rehydrate.timer`, which rebuilt `office.db` and `world.db`
  two minutes later, is retired: nothing reads `office.db` once the office runs
  `TOWN_INDEX_READS=store`, and its unit files, `office-rehydrate.sh` and the
  transitional `office-tick.sh` left the repo in part 5b. The box steps:
  § Retiring the rehydrate, below.
- **The town index (POS-268, 2026-09-30), adopted at the w41 ship (2026-10-04):
  switch 2 needed it and went on that day, then was rolled back (§ Switch 2's
  guard, below); the rollback is the env line, so the ingest keeps running.**
  The `postmark-town-index.timer` row of `box-rollcall-manifest.json` still
  says parked. office.db's tables have
  twins in the store (`world2/schema/033_town_index.sql`), kept by
  `postmark-town-index.timer` (:05/:20/:35/:50, `deploy/town-index-ingest.sh`,
  the `law_ingester` pen): a snapshot at each crossing's seal, then only the
  commits since. Nothing reads them until `TOWN_INDEX_READS=store`; the shape
  and what is left are in `docs/town-index-store.md`. The adoption, in order (for a
  rebuilt box): apply
  033 as `world2_owner`; copy the script to `/srv/world2-lab/ops/`; run the seed
  by hand (the script's header has the line); install and enable the timer.
- **A restart is for code deploys only; data flows without one.** The town
  index is the store's (`postmark-town-index.timer` above), and so is the world
  graph snapshot the keeping tick writes per settlement (switch 3, office #294).
  The operator's receipt:
  `systemctl show postmark-office -p ActiveEnterTimestamp` frozen at the last
  code deploy while `curl -sI .../api/town | grep -i as-of` keeps advancing. If
  that timestamp moves on the quarter-hour, something is restarting the
  service.
- `X-Postmark-As-Of` on every response tells you exactly how fresh the index is
  (on a switched office, the store's town index; POS-268 part 5a).
- **Incremental-hydration trip-wire** (history: `office.db`'s rebuild, retired
  with the rehydrate in POS-268 part 5b). The full rebuild-from-clone was deliberate:
  it exercises the constitution ("DB rebuildable from a clone") on every tick,
  so the rebuild path can't rot. Measured 2026-07-08: ~2.5 s at 31 residents /
  427 letters — leave it alone. If a full rebuild ever exceeds **~30 s**, add
  incremental hydration (`git diff --name-only <as_of>..HEAD` → re-parse only
  touched residents/letters, upsert) on the fast tick and demote the full
  rebuild to a nightly constitution check — never remove it entirely.
- Rollback: `systemctl stop postmark-office` — the site and the PR door are
  untouched by anything the office does.

### Sunday: adopting the tick split (POS-268)

> **DONE 2026-10-04, kept as history.** Its rollback below no longer applies: POS-268 part 5b deleted `office-tick.sh` and `office-rehydrate.sh` from the release, so the pre-split unit it restores would run a script that is not there. What the box does now, and the steps that end the rehydrate: § Retiring the rehydrate, below.

The split's unit files ride the w41 release, but a code deploy never installs a unit. Until someone copies the units, the box's installed `postmark-office-rehydrate` unit still runs `deploy/office-tick.sh`. After the split, that file is a wrapper that runs `office-keep.sh` and then `office-rehydrate.sh`, so the box does exactly what it did before. Adoption moves the keeping work onto its own timer and gives the rehydrate its new clock. Run it once, by hand, after the w41 release is live. Every step is on the box, as root unless it says meepo.

**0. Preconditions** (all must hold, or stop):

```sh
curl -s https://postmark.town/api/release                      # names release/2026-w41 (or later)
ls /srv/postmark-office/deploy/office-keep.sh /srv/postmark-office/deploy/office-rehydrate.sh \
   /srv/postmark-office/deploy/office-tick.sh                   # all three exist (the tree is the release)
systemctl show postmark-office-rehydrate.service -p ExecStart   # still names office-tick.sh (pre-split)
systemctl is-active postmark-office-rehydrate.service           # "inactive": no tick in flight
```

Pick a quiet minute between :10 and :20 (or :25–:35, :40–:50, :55–:05). The :07 tick and its two-minute tail have finished by then, and the next one is five or more minutes away.

**1. Keep the units you are replacing** (the rollback reads these):

```sh
sudo mkdir -p /var/backups/postmark-tick-split
sudo cp -p /etc/systemd/system/postmark-office-rehydrate.service /etc/systemd/system/postmark-office-rehydrate.timer \
        /var/backups/postmark-tick-split/
```

**2. Install all four and switch in one step.** The keep timer takes over :07/:22/:37/:52 and the rehydrate moves to :09/:24/:39/:54. Both switch at the same daemon-reload, so no tick runs the keeping work twice or not at all:

```sh
cd /srv/postmark-office
sudo cp deploy/postmark-office-keep.service deploy/postmark-office-keep.timer \
        deploy/postmark-office-rehydrate.service deploy/postmark-office-rehydrate.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now postmark-office-keep.timer
sudo systemctl restart postmark-office-rehydrate.timer
```

**3. Receipts, before walking away:**

```sh
systemctl list-timers postmark-office-keep.timer postmark-office-rehydrate.timer   # next fires at :x7 and :x9
systemctl show postmark-office-keep.service -p ExecStart        # office-keep.sh
systemctl show postmark-office-rehydrate.service -p ExecStart   # office-rehydrate.sh
# after the next :x7 and :x9 have fired:
journalctl -u postmark-office-keep -n 30 --no-pager             # "[office-keep] settlements: …", no FAILED
journalctl -u postmark-office-rehydrate -n 30 --no-pager        # "door is serving <sha> — hot reload confirmed", no STALE DOOR
curl -sI https://postmark.town/api/town | grep -i x-postmark-as-of   # the town's newest sha
```

**4. The roll-call manifest, in the repo right after** (one commit on the train, Wright's). The `postmark-office-keep.timer` row changes from parked to live:

```json
{
 "unit": "postmark-office-keep.timer",
 "label": "the office's keeping tick (clones, mint, settlements row, panes)",
 "stage": "live",
 "activation_owner": "<who> — adopted <date> by DEPLOY.md § Sunday: adopting the tick split (POS-268)",
 "cadence": "every 15 minutes at :07, :22, :37, :52",
 "cadence_source": "systemctl show postmark-office-keep.timer -p TimersCalendar",
 "heartbeat": { "kind": "unit_trigger", "stale_after_minutes": 45 },
 "stale_means": "the town clone stops pulling (the write pen and declare read a stale town), the mint catch-up and welcome pass stop, the settlements row stops following the keeper's tag, and the panes freeze. Three missed ticks is a stuck keeper, one is noise."
}
```

In the `postmark-office-rehydrate.timer` row, `cadence` becomes `"every 15 minutes at :09, :24, :39, :54, two minutes after postmark-office-keep.timer"`. Its label, heartbeat and `stale_means` are unchanged. The tree rows (`office-keep`, `office-rehydrate`) already exist.

**5. office-tick.sh stays** until a clean week has passed. The rollback below depends on it. Delete it in a later train, with the keep row's adopt note.

**Rollback** (anything in step 3 wrong, or a stuck keep row):

```sh
sudo systemctl disable --now postmark-office-keep.timer
sudo cp -p /var/backups/postmark-tick-split/postmark-office-rehydrate.service \
           /var/backups/postmark-tick-split/postmark-office-rehydrate.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl restart postmark-office-rehydrate.timer
systemctl show postmark-office-rehydrate.service -p ExecStart   # office-tick.sh again: both halves, the old clock
```

After that the box runs exactly what it ran before step 2, and the manifest rows go back to what they said (keep parked).

### The keeping tick's receipt (POS-524, proposal for the owner's box review)

Most of `office-keep.sh` is deliberately non-fatal: a step that fails prints a line and the tick goes on. That keeps the tick alive, but it also means a step can fail on every tick while the unit reads green. So every run now leaves **one receipt line** naming each step as `ok`, `refused`, `skip` or `notrun`, with a reason from a fixed list (never tool output, keys or bodies). The format, the reader and the judgement are all in `deploy/keep-history.mjs`. The roll-call's outcome rule on the `postmark-office-keep.timer` row raises ALARM-outcome when a step has not been `ok` on **three consecutive scheduled ticks**, judged step by step. It also alarms when the newest line is unreadable, when there is no scheduled receipt, or when the newest scheduled receipt is more than 45 minutes old.

- **Path (a proposal; nothing on the box has been checked or created):** `OFFICE_KEEP_LOG`, default `/srv/postmark-harbor/office-keep.jsonl`, plus its lock file `office-keep.jsonl.lock` beside it. Both must be writable by meepo. The owner confirms the directory and its permissions on the box, or sets `OFFICE_KEEP_LOG` in `/etc/postmark-office.env` and changes the manifest row's `history_path` to match.
- **Retention:** each write keeps the newest 96 scheduled receipts (a day of quarter-hour ticks) and, separately, the newest 32 other lines, so a burst of hand runs cannot push the scheduled window out. A line is at most 4096 bytes, so the file stays under about 280 KB. An unreadable line, or a receipt with an unknown source, written after the last scheduled receipt is **evidence**: it alarms until a later valid scheduled receipt, and a hand run can neither hide it from the reader nor erase it on its write. The writer keeps the newest 8 such lines apart from both caps, with an unreadable line rewritten as a small marker that names only its category, never its bytes. Once a scheduled receipt follows it, an unreadable line is dropped on the next write.
- **Writing:** the top-level EXIT trap writes the receipt once, after the work and before the SNAP cleanup. It takes its own lock (`flock -w 20`) on the lock file, not the town lock, and writes a temp file that it renames over the log. If the lock or the write fails, the journal gets a `[office-keep] RECEIPT NOT WRITTEN` line, the tick keeps its own exit status, and the roll-call then sees a stale outcome. SIGKILL and power loss write nothing; the 45-minute staleness check covers them.
- **Provenance (Wright, 2026-10-13):** `postmark-office-keep.service` is the scheduled unit by contract and always records `source: "scheduled"`. To run the tick by hand, use **`systemctl start postmark-office-keep-by-hand.service`**: it runs the same script and records `by-hand`. A by-hand run never extends or clears a scheduled streak and never counts as freshness. That unit has no `[Install]` section and no timer, so the roll-call's unit discovery does not list it. A line with no `source` field (older than this change) counts as scheduled. A source the reader does not know counts as unknown and never clears anything.
- **Accepted limitation:** starting `postmark-office-keep.service` itself by hand is recorded as **scheduled**, because the unit cannot tell who started it, and there is deliberately no `INVOCATION_ID` or `LastTrigger` detection. Use the by-hand unit instead. `/etc/postmark-office.env` must not set `POSTMARK_KEEP_SOURCE`: an `EnvironmentFile=` value overrides the unit's `Environment=` line.
- **Install day:** copy both units, as in One-time setup step 3 (the by-hand unit is copied, never enabled). Until the first receipt is written at `history_path`, this row is **expected** to show ALARM-outcome ("empty or unreadable"). The first scheduled tick after the release clears it, if every step is `ok`.

### Retiring the rehydrate (POS-268 part 5b, at the w43 deploy)

Part 5b (built on w42 as office #433, re-landed on w43) deleted `postmark-office-rehydrate.{service,timer}`, `deploy/office-rehydrate.sh` and the transitional `deploy/office-tick.sh` from the repo, and moved the rehydrate's world hydration (the store's world graph snapshot; `world.db` is retired since switch 3, office #294) into the keeping tick as `deploy/office-world-hydrate.sh`. A code deploy never removes an installed unit, so the box keeps firing the old rehydrate until these steps run. Every step is on the box, as root. **Wright or Darko runs them; no lane does.**

**When.** In the same sitting as the w43 deploy (`release/2026-w43` or later), once the release is live and step 0 reads true. **Never before it**: until the w43 tag is live the keeping tick has no world step, so retiring the rehydrate early freezes the store's world graph snapshot (the world every office door reads) until the deploy. Nothing on prod reads `office.db` any more (switch 2 on since the w42 ship, 10-11's Done check; part 5a's absent sweep and static inventory re-run green on the w43 tip, 10-15), so the timeline only matters for the world step. And not long after it: the deploy's `rsync --delete` takes `office-rehydrate.sh` off the box, so from the first :09 after the deploy the installed rehydrate unit fails (loud in its journal, harmless: the keeping tick has taken its world step), and the keeping tick's world step finds no law pen credential (`WORLD STORE NOT WRITTEN`, the office keeps the snapshot it has; the receipt records `world` refused `exit:4`, and three such scheduled ticks raise the keep row's alarm) until step 2 installs its new unit.

**What this ends.** After step 3 nothing rebuilds `office.db`. Switch 2's rollback (`TOWN_INDEX_READS=store` out of `/etc/postmark-office.env`, § Switch 2's guard) stops being a rollback: an unswitched office would read `office.db` as it stood at step 3. If switch 2 ever has to come off, the rehydrate comes back first (§ Rollback, below).

**0. Preconditions** (all must hold, or stop):

```sh
curl -s https://postmark.town/api/release                         # names release/2026-w43 or later (it carries part 5b)
sudo grep -c '^TOWN_INDEX_READS=store$' /etc/postmark-office.env  # 1: the office reads the store's town index (sudo: the file is root 0600)
sudo find /proc/[0-9]*/fd -lname '*/office.db' 2>/dev/null | wc -l  # 0: no process holds office.db open (part 5a's Done check; sudo, or only your own fds are seen)
ls /srv/postmark-office/deploy/office-world-hydrate.sh            # exists: the tree is the release
systemctl list-timers postmark-town-index.timer                   # fired within the last 15 minutes: the store's town index is kept
ls -d /etc/systemd/system/postmark-office-rehydrate.*.d 2>/dev/null   # nothing; a drop-in directory here is removed in step 3 too
systemctl is-active postmark-office-keep.service postmark-office-rehydrate.service   # inactive, inactive: no tick in flight
```

Pick a quiet minute, between :10 and :20 (or :25 to :35, :40 to :50, :55 to :05), so no tick starts while the units change.

**1. Keep the units you are replacing** (the rollback reads these):

```sh
sudo mkdir -p /var/backups/postmark-rehydrate-retire
sudo cp -p /etc/systemd/system/postmark-office-rehydrate.service /etc/systemd/system/postmark-office-rehydrate.timer \
           /etc/systemd/system/postmark-office-keep.service /var/backups/postmark-rehydrate-retire/
```

**2. The keep units that hand the world hydration the law pen**, the scheduled one and the by-hand one (POS-524). Each reads `/etc/postmark-world2-dev.env` first and `/etc/postmark-office.env` second, so a key both files carry keeps the office's value, which is what every step of the tick saw before. The world2 file is optional (`EnvironmentFile=-`): without it the tick still runs, and only the world step is refused. The file holds the store's four passwords, the owner's among them; `office-keep.sh` unsets all four before its first child and hands the law pen's to the world step alone (review-593):

```sh
sudo cp -p /etc/systemd/system/postmark-office-keep-by-hand.service /var/backups/postmark-rehydrate-retire/ 2>/dev/null || true
sudo cp /srv/postmark-office/deploy/postmark-office-keep.service /srv/postmark-office/deploy/postmark-office-keep-by-hand.service /etc/systemd/system/
sudo systemctl daemon-reload
```

**3. Retire the rehydrate: stop it, disable it, remove both unit files.**

```sh
sudo systemctl disable --now postmark-office-rehydrate.timer
sudo systemctl stop postmark-office-rehydrate.service
sudo rm /etc/systemd/system/postmark-office-rehydrate.service /etc/systemd/system/postmark-office-rehydrate.timer
sudo systemctl daemon-reload
sudo systemctl reset-failed postmark-office-rehydrate.service postmark-office-rehydrate.timer
```

**4. Receipts, before walking away:**

```sh
systemctl show postmark-office-rehydrate.timer postmark-office-rehydrate.service -p LoadState   # LoadState=not-found, twice
systemctl show postmark-office-keep.service -p EnvironmentFiles   # world2-dev.env, then postmark-office.env
# after the next :x7 tick has finished:
journalctl -u postmark-office-keep -n 60 --no-pager | grep -E 'world|FAILED|NOT WRITTEN'
#   "[office-keep] the world graph snapshot written to the store", and no NOT WRITTEN
tail -1 /srv/postmark-harbor/office-keep.jsonl   # the receipt: "world":{"s":"ok"} among its steps
sh /srv/postmark-office/deploy/box-rollcall.sh
#   "RETIRED  postmark-office-rehydrate.timer", the keep row OK (it carries two outcomes now: the tick's receipt and the household-keys line), and no ALARM;
#   the keep row reads ALARM-outcome ("empty or unreadable") until the first w43 tick writes /srv/postmark-harbor/office-keep.jsonl
#   (§ The keeping tick's receipt, Install day), so "keep row OK" holds only after that tick has finished;
#   ALARM-unretired on the rehydrate row means step 3 is not done
curl -sI https://postmark.town/api/town | grep -i x-postmark-as-of   # the town's newest sha, still moving
```

**5. The file.** Move `office.db` aside, so a reader nobody found fails loudly by name instead of reading a frozen copy, and the rollback still has it:

```sh
sudo -u meepo mv /srv/postmark-office/office.db /srv/postmark-office/office.db.retired-2026-10-18
ls /srv/postmark-office/office.db* 2>/dev/null   # office.db.retired-2026-10-18 only (no -wal, -shm or .new left beside it)
curl -s -o /dev/null -w '%{http_code}
' https://postmark.town/api/town   # 200: the office never opened it (a switched office opens no office.db, part 5a)
```

After a clean week (the roll-call green each morning, no `office.db` in the office's journal), delete it: `sudo rm /srv/postmark-office/office.db.retired-2026-10-18`. `/srv/postmark-office/world.db`, unread since switch 3 (POS-270, office #294), goes in the same later step.

**Rollback** (until the file is deleted). First the file: `sudo -u meepo mv /srv/postmark-office/office.db.retired-2026-10-18 /srv/postmark-office/office.db`. The rehydrate cannot come back on a w43 tree: its script is not there. Partial, for a keeping tick whose world step misbehaves with the new unit, is a **downgrade that freezes the world graph snapshot**: put the old keep unit back (`sudo cp -p /var/backups/postmark-rehydrate-retire/postmark-office-keep.service /etc/systemd/system/ && sudo systemctl daemon-reload`). The tick's world step then finds no credential and writes nothing, every office door reads the snapshot as it stood until the unit is fixed, and the keep row alarms on `world` (refused `exit:4`) after three scheduled ticks. Use it to stop a harmful write, never as a resting state. Whole, with the office rolled back to the w42.x release (the release workflow's rollback): put the file back as above, restore both rehydrate unit files and the old keep unit from `/var/backups/postmark-rehydrate-retire/`, remove the by-hand unit (`sudo rm /etc/systemd/system/postmark-office-keep-by-hand.service`: prod had none before step 2; if step 2's backup caught one, restore that instead), `sudo systemctl daemon-reload`, `sudo systemctl enable --now postmark-office-rehydrate.timer`. The first rehydrate run rebuilds `office.db` from the town clone. The roll-call manifest then reads the rehydrate row `retired` against a box that loads it (ALARM-unretired) until the w42.x manifest is the deployed one, which it is once the rollback deploy lands.

### Retiring SQLite 2: the office.db code path (POS-656, w43 if its batch is green)

The office no longer has an office.db reader. Every door, probe and pen reads the store's town index, as prod has done since the w42 ship under `TOWN_INDEX_READS=store`. The switch is no longer read; `src/hydrate.mjs`, `src/schema.mjs` and the SQLite readers in `src/queries.mjs` are deleted. The behaviour is unchanged. The PR shows the same status, body and as-of on 226 doors, asked of the w43 base and of this tree over one store.

**On prod, nothing to run.** Read on the box on 2026-10-16: `/etc/postmark-office.env` and `/etc/postmark-office-dev.env` both carry `TOWN_INDEX_READS=store`, and no installed unit passes `--db`. The office ignores a `--db` it is handed. § Retiring the rehydrate is unchanged and still runs at this deploy. Its rehydrate unit fails after the deploy, either way, until step 3 removes it.

**Keep the switch line in both env files** until this release has run a clean week. A rollback to a release before POS-656 reads office.db unless that line is there. With it, the older office reads the store exactly as this one does, and the rollback needs nothing else. Removing it afterwards is a no-op for this release. Undo: put the line back.

**The dev box.** `/srv/postmark-office-dev/office.db` (117 MB, unread since the dev office switched) is removed by `deploy/sandbox-reset.sh` the next time it runs. The script now reseeds the dev office's town index in its sandbox store from the seed, with the same law-pen `PG*` the world graph snapshot takes. It names both as not rebuilt when those are missing. Removing it by hand instead:

```sh
sudo -u meepo mv /srv/postmark-office-dev/office.db /srv/postmark-office-dev/office.db.retired-2026-10-18
# a week later, nothing having asked for it:
sudo rm /srv/postmark-office-dev/office.db.retired-2026-10-18
```

Undo, until the delete: move it back. Nothing reads it, so the undo changes nothing on dev.

### Switch 2's guard: the store never waits on a held transaction (POS-370, 2026-10-04)

On 2026-10-04 switch 2 (`TOWN_INDEX_READS=store`) went on at 16:52Z and the
office's index reads stalled for about an hour: nine `office_api` sessions sat
idle in transaction (three read workers times the pen's pool of three), every
one last running the quest board's `town_quest_progress` read. The board held
its pen connection while its world read rebuilt the positions projection through
a second one from the same pool. Wright rolled it back at 19:35Z. The code fix
and the guard ship on the w42 train; three things are the box's:

**1. The roles' idle-transaction limit (by hand, as `postgres`, once).** The
office's own pools already ask for `idle_in_transaction_session_timeout` as a
startup parameter (`WORLD2_PG_IDLE_TX_MS`, default 30 s; src/store-pool.mjs),
so this step is for every OTHER client that logs in as these roles (a psql
session, a tool). No migration can do it: this repo creates no roles, and
`world2_owner` cannot alter them.

    sudo -u postgres psql -v ON_ERROR_STOP=1 <<'SQL'
    ALTER ROLE office_api     SET idle_in_transaction_session_timeout = '30s';
    ALTER ROLE stance_reader  SET idle_in_transaction_session_timeout = '30s';
    -- snapshot_reader holds READ ONLY transactions across git reads (the
    -- era-one compare, position-snapshot.mjs --compare-era-one): a ceiling,
    -- not a 30 s limit, until its longest idle gap is measured
    ALTER ROLE snapshot_reader SET idle_in_transaction_session_timeout = '5min';
    SELECT rolname, rolconfig FROM pg_roles WHERE rolname IN ('office_api','stance_reader','snapshot_reader');
    SQL

A role setting applies to NEW sessions: restart the office afterwards (or wait
for the next deploy) so its pools reconnect. The tools that log in as
`office_api` from the keeping tick (settlements-backfill, position-snapshot)
build their rows before BEGIN and run their transactions statement after
statement, so 30 s does not touch them. Undo: `ALTER ROLE <role> RESET
idle_in_transaction_session_timeout;`.

**2. The watch.** The office writes
`/srv/postmark-office/telemetry/store-txn-4380.json` every minute
(src/store-txn-watch.mjs): `calm_at` is the last minute no `office_api` session
had been idle inside a transaction for 5 s or more. The roll-call's
"the office's store transactions" row alarms at 5 minutes. Live:
`curl -s https://postmark.town/api/ops/store-txn | jq '{calm_at, last_minute}'`.
By hand, as any role that may read pg_stat_activity in full:

    sudo -u postgres psql -c "SELECT pid, application_name, state, now() - state_change AS idle, now() - xact_start AS in_txn, left(query, 120) AS query FROM pg_stat_activity WHERE usename = 'office_api' AND state LIKE 'idle in transaction%' ORDER BY state_change;"

Zero rows is the healthy answer; `application_name` (`postmark-office:<pool>:t<thread>`)
says which pool and which worker holds a row that is not.

**3. The acquire timeout.** Every office pool refuses a request it cannot give a
connection to within `WORLD2_PG_ACQUIRE_MS` (default 10 s) with a sentence that
names the pool, instead of leaving it waiting. Nothing to install; the env line
is there to raise it, never to remove it (0 means no limit).

**Re-flipping switch 2** (only after this train is on the box and step 1 is done):

1. Dev first, under load. On the dev office (4381) set `TOWN_INDEX_READS=store`
   with the same `WORLD_POSITIONS=1` / `WORLD_MOVEMENT_V2=1` prod runs, restart
   it, and run the endurance replay (POS-267 / POS-354) against it, through the
   tunnel its header names:
   `node tools/party-replay.mjs --base http://127.0.0.1:14381 --steps 5:0,10:0,20:0,40:0`.
   The replay drives the world reads and the says but no index door, so run the
   index doors beside it for the same window, twenty at a time (the quest board
   is the one that stalled); it prints only a door that failed or took over 2 s:

       while sleep 1; do for i in $(seq 20); do for d in residents world/apex quests/wright quests/darko town; do
         curl -s -o /dev/null -m 10 -w "%{http_code} %{time_total} $d\n" "http://127.0.0.1:14381/$d" &
       done; done; wait; done | awk '$1 != 200 || $2 > 2'

   Pass: no 5xx or timeout from `/api/residents`, `/api/world/apex`,
   `/api/quests/{h}`, the doorstep or MCP `world`; the watch query above at zero
   rows on every sample; dev's `/api/ops/store-txn` `calm_at` never older than
   two minutes; and no `NestedStoreError` or `StoreAcquireTimeout` in its journal
   (`journalctl -u postmark-office-dev --since "-2h" | grep -E "NestedStoreError|StoreAcquireTimeout|nested-store|store-acquire"`).
2. Prod: back up `/etc/postmark-office.env` to `/var/backups`, add
   `TOWN_INDEX_READS=store`, `sudo systemctl restart postmark-office` (and the read
   workers, `postmark-office-read@{4391,4392,4393}`, if they are running).
3. Probes, at once and again at +5, +15 and +60 minutes: `/api/residents`,
   `/api/world/apex`, `/api/quests/wright`, a doorstep and MCP `world` each
   answer 200 under 2 s, with the `x-postmark-town-index-as-of` header on the
   switched doors; the watch query reads zero rows; `/api/ops/store-txn`
   `last_minute.stuck` is 0.
4. Roll back on the first stuck row or hung door: the env line out, the office
   restarted (the 2026-10-04 rollback, unchanged).
   SUPERSEDED for any release carrying POS-656: that office reads only the store,
   so the env line out changes nothing (§ Retiring SQLite 2).

### Static keys leave the env file (POS-352 part 2, w42)

RULED (Darko, 2026-10-06, 2a): static office keys become a `static` kind with
an explicit handles column and an explicit household column, imported from
`OFFICE_KEYS` by hash, nothing re-issued, no token printed.

From the release that carries this, the office no longer reads `OFFICE_KEYS`.
A static key is an `oauth_tokens` row with `kind = 'static'` (migration 070
adds its `household` and `handles` columns), written by
`tools/static-keys-import.mjs` and read by `src/static-keys.mjs §
staticLookup`. Every key keeps its value, its household, its handles and its
gh_id; nobody is handed a new key. An office from before this change reads only
the kinds `access`, `refresh` and `household`, so the rows are inert to it.
That is why the import runs BEFORE the deploy, and why the rollback leaves the
rows in place.

**The order.** Dev first, before the train that carries this reaches dev (dev's
office runs the train, and from that carry on it reads no env keys), then prod
at the ship. Every step is on the box, as root. Nothing here prints a key or a
hash.

**0. Preconditions:**

```sh
sudo grep -c '^OFFICE_KEYS=' /etc/postmark-office.env      # 1: the line is there to import
sudo grep '^OFFICE_KEYS=' /etc/postmark-office.env | cut -d= -f2- | tr ';' '\n' | grep -c .   # how many entries (no key printed)
# Anything ELSE on the box that reads the line (paths only). The office's own
# repos read it nowhere but server.mjs, checked 2026-10-08; a hand-installed
# script would show here, and must move to its own key before step 5.
sudo grep -rl 'OFFICE_KEYS' /etc /usr/local/bin /srv --include='*.sh' --include='*.mjs' --include='*.js' --include='*.service' --include='*.env' \
  --exclude-dir=node_modules --exclude-dir=town-clone --exclude-dir=world-clone --exclude-dir=.git --exclude-dir=test 2>/dev/null
# expected: the office trees' own src/ and tools/ files, and /etc/postmark-office.env and -dev.env themselves
```

**1. The migration, from the staged tip** (additive; the running office ignores
it). Prod's store is the database `world2_dev` (POS-243: the name lies):

```sh
cd <the staged tip>
sudo -n -u postgres psql -v ON_ERROR_STOP=1 -d world2_dev -c "SET ROLE world2_owner;" -f world2/schema/070_static_office_keys.sql
sudo -n -u postgres psql -d world2_dev -tAc "SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'oauth_tokens' AND column_name = 'handles');"   # t (070's own proof)
```

**2. The import, dry, then for real, from the same staged tip** (it needs that
checkout's node_modules for `pg`, and meepo must be able to read it). It runs
as **meepo**, the one hand that touches `/srv/postmark-office` (§ The one-hand
rule): a root-owned journal beside the office's `oauth.db` would break meepo's
next write. It loads the office's own env file, so it reads the same
`OFFICE_KEYS` and writes the book the office reads: with
`OFFICE_PAPERWORK_STORE=1`, `WORLD2_PG=1` and `WORLD2_PG_URL` (all three in
prod's env since 10-04) the store's `oauth_tokens`, then the office's `oauth.db`
as the mirror. `--oauth-db` must name the office's own file, because the
default is the checkout's root. Its first line says which book it wrote.

```sh
sudo bash -c 'set -a; . /etc/postmark-office.env; set +a; cd <the staged tip> && exec runuser -u meepo -- node tools/static-keys-import.mjs --dry --oauth-db /srv/postmark-office/oauth.db'
#   book: the store (oauth_tokens), mirrored to /srv/postmark-office/oauth.db
#   OFFICE_KEYS: N keys          <- N is step 0's count; "malformed entries skipped" means a line to fix first
#   would add N · would replace 0 · unchanged 0 · refused 0
#   households: ...              <- every household you expect, and no other
sudo bash -c 'set -a; . /etc/postmark-office.env; set +a; cd <the staged tip> && exec runuser -u meepo -- node tools/static-keys-import.mjs --oauth-db /srv/postmark-office/oauth.db'
#   added N · ... · refused 0. A second run says "unchanged N".
```

A first line that names a file (`book: /srv/...`) instead of the store means
the switch was not in the environment: stop, the rows went to the mirror only.
A `refused` count means a key's hash already belongs to a minted token. The
import then writes nothing; that entry needs a new key, issued by hand.

**3. The first real key to check: the Bug Catcher's** (Meeps Come Home step 3,
`the-town#301406700:bugcatcher`). Read-only, no hash printed:

```sh
sudo -n -u postgres psql -d world2_dev -c "SET ROLE world2_owner;" \
  -c "SELECT household, handles, gh_id, expires FROM oauth_tokens WHERE kind = 'static' ORDER BY household, handles;"
#   the-town | ["bugcatcher"] | 301406700 | (null)    <- first; then every other row against the env line
```

**4. Deploy** the release (the train ship). Then the Bug Catcher's key at the
door, which now answers only from the store. The key never reaches a command
line (`ps` shows argv): bash builtins write the header into a mode-600 file and
curl reads it with `-H @file`.

```sh
sudo bash -c 'set -a; . /etc/postmark-office.env; set +a; umask 077; h=$(mktemp); \
  printf "Authorization: Bearer %s\n" "$(printf %s "$OFFICE_KEYS" | tr ";" "\n" | grep ":bugcatcher$" | cut -d= -f1)" > "$h"; \
  curl -s -H @"$h" http://127.0.0.1:4380/me; rm -f "$h"' | jq '{household, handles, key_kind, verified_github}'
#   { "household": "the-town", "handles": ["bugcatcher"], "key_kind": "oauth", "verified_github": { "login": null, "id": 301406700 } }
#   (a pinned static key has always said key_kind "oauth"; that is unchanged)
journalctl -u postmark-office -n 50 --no-pager | grep 'OFFICE_KEYS is set'          # expected until step 5: the line is no longer read
journalctl -u postmark-office -n 50 --no-pager | grep -c 'holds no static keys'     # 0: the store holds the rows
```

Then the founder's key the same way (`grep ':wright$'`, or whichever handle
ends its entry), and one round of each Meep that carries a static key.

**5. Remove the line**, keeping a root-only copy for the rollback:

```sh
sudo install -d -m 700 /var/backups/postmark-static-keys
sudo install -m 600 /etc/postmark-office.env /var/backups/postmark-static-keys/postmark-office.env.pre-pos352
sudo sed -i '/^OFFICE_KEYS=/d' /etc/postmark-office.env
sudo grep -c '^OFFICE_KEYS=' /etc/postmark-office.env      # 0
sudo systemctl restart postmark-office
journalctl -u postmark-office -n 50 --no-pager | grep -c 'OFFICE_KEYS is set'   # 0 since the restart
# step 4's /me again, sourcing /var/backups/postmark-static-keys/postmark-office.env.pre-pos352
# instead of /etc/postmark-office.env (the key is only in the backup now)
```

Dev: the same steps with `/etc/postmark-office-dev.env`, `/srv/postmark-office-dev`
(its `oauth.db` in `--oauth-db`) and dev's port, the import as meepo too. Dev's
paperwork is on the file unless its env sets `OFFICE_PAPERWORK_STORE=1`; the
import's first line says which. Run 070 on dev's store too, so its switch finds
the columns.

The backup copy holds the same secrets the env file did. Delete it after a
clean week (`sudo shred -u /var/backups/postmark-static-keys/postmark-office.env.pre-pos352`).

**Adding a static key later** (Meeps Come Home). The env file no longer holds
`OFFICE_KEYS`, but it still holds the switch and the store's address, so load it
and hand the one new entry in on stdin, never on a command line. The
command, in full:

```sh
read -rs ENTRY    # <key>=<household>[#<gh_id>]:<handle>[,<handle>...]; not echoed, not in history
printf %s "$ENTRY" | sudo bash -c 'set -a; . /etc/postmark-office.env; set +a; \
  test "$OFFICE_PAPERWORK_STORE" = 1 && test "$WORLD2_PG" = 1 && test -n "$WORLD2_PG_URL" || { echo "the store switch is not in this env file: stop"; exit 1; }; \
  OFFICE_KEYS=$(cat); export OFFICE_KEYS; cd /srv/postmark-office && \
  exec runuser -u meepo -- node tools/static-keys-import.mjs --dry --oauth-db /srv/postmark-office/oauth.db'
#   book: the store (oauth_tokens), mirrored to /srv/postmark-office/oauth.db   <- the store, or stop
#   OFFICE_KEYS: 1 key · would add 1 · ... · static rows not in OFFICE_KEYS (left alone): N
# then the same line without --dry, then step 4's /me with the new key
unset ENTRY
```

Without the switch and `--oauth-db`, the import writes the checkout's own
`oauth.db` and the key answers as anonymous on prod. The import never revokes,
so the other rows are untouched. To remove one, see "Retiring a static key"
below: deleting the row by hand is not enough, because a later import writes it
back from `OFFICE_KEYS`.

**Retiring a static key** (POS-604). One verb, by household and handle. It takes
no key and no hash, on the command line or in the environment, and prints none.
It needs the store switch like the import (`OFFICE_PAPERWORK_STORE=1`,
`WORLD2_PG=1`, `WORLD2_PG_URL`), and runs as meepo with the office's own env file
loaded, naming the office's own file:

```sh
# the dry run first: advisory, writes nothing, binds nothing
sudo bash -c 'set -a; . /etc/postmark-office.env; set +a; cd <the staged tip> && exec runuser -u meepo -- node tools/static-keys-retire.mjs --household <slug> --handle <h> --dry --oauth-db /srv/postmark-office/oauth.db'
# then the same line without --dry
sudo bash -c 'set -a; . /etc/postmark-office.env; set +a; cd <the staged tip> && exec runuser -u meepo -- node tools/static-keys-retire.mjs --household <slug> --handle <h> --oauth-db /srv/postmark-office/oauth.db'
```

What it does, and what it will not:

- It retires exactly one `static` row whose handles are exactly `[<h>]`. No match,
  two exact matches (ambiguous), or only a row that holds `<h>` among other
  handles (widened) are refused and write nothing.
- ANOTHER working key must still cover THIS household and handle: another
  `static` row of the household that holds the handle, or a live human
  household key of the account the registry pins the handle to, where the
  registry also shows that account belongs to this household and the handle is
  its resident. Anything it cannot prove (the registry unreadable, a household
  string that is not a registry slug, an expired key) refuses. It never falls
  back to the login index the office uses at request time, so it can refuse a
  cover that would have worked.
- In ONE Postgres transaction it takes `LOCK TABLE oauth_tokens IN SHARE ROW
  EXCLUSIVE MODE` (2 s `lock_timeout`), rereads the selector and the cover, deletes
  the row (the delete must remove exactly one) and writes a `retired` row on the
  same hash. That mode makes every other WRITER of `oauth_tokens` (a mint, a
  rotation, the sweep, an import) wait while readers (bearer lookups) go on
  answering. Nothing but the database runs while it is held; the test run
  measured 8.5 ms on a synthetic store, which is a measurement of that run and
  not a promise. If the table is busy for the whole 2 s, nothing was changed:
  exit 6, run it again.
- Then, and only then, it replays the retirement into `oauth.db` (the temporary
  mirror, `paperwork.mjs` ⚑) in its own transaction and reads it back. **A
  missing file, a failed write or a wrong read-back is NOT a success**: exit 4,
  "STORE COMMITTED ... the file is NOT verified", and the exact command to
  repair it. Do not roll the office back to the file until that is repaired: the
  file would still hold the live key. The repair writes nothing in the store:

```sh
... node tools/static-keys-retire.mjs --household <slug> --handle <h> --mirror-only --oauth-db /srv/postmark-office/oauth.db
```

  `--mirror-only` reads the recorded retirements for that household and handle,
  never a `static` row (a new key for the same household and handle is counted
  and left alone), and refuses when none is recorded. A plain rerun with no
  static row left does not repair anything; it says so and names this command.
- Exit status: 0 retired and the file verified (or repaired); 1 refused, nothing
  written; 2 cannot run (usage, no store switch); 4 STORE COMMITTED, file not
  verified; 5 COMMIT not acknowledged, so the store may or may not hold it (check
  with `--dry`, then `--mirror-only` if it is recorded); 6 table busy, nothing
  changed.
- There is no un-retire. A household that needs a key again is issued a NEW key
  (a new hash), which the retired row does not touch.

**The import after a retirement.** A `retired` row keeps the key's hash, its
household, handles and gh_id (no secret), so `tools/static-keys-import.mjs`
refuses an `OFFICE_KEYS` entry for that hash BY NAME (`household:handles`) and
imports the rest. Its first line says which of three things happened: `complete`
(exit 0), `partial` (the rest committed; N entries refused as retired; exit 3),
or `rolled_back` (a key of another kind, `access`, `refresh` or `household`,
owns a hash, so NOTHING was written, even if a retired entry is also named; exit 1).

**What this does not cover.** A key deleted by hand BEFORE this verb existed has
no row, so it has no hash to refuse and no selector to find: nothing here can
tombstone it. Take its entry out of whatever `OFFICE_KEYS` text an import reads
(including a backup copy of the env file) before the import runs. Production
retirements, and shredding the backup copy that still holds every key, are the
owner's. When the mirror is deleted with `oauth.db` and `roles.db`, this tool
loses its file step in the same change; until then its exit 4 is the honest
answer for a missing file.

**Rollback.**

- Before step 5 (the line is still in the env file): redeploy the previous
  release tag (`workflow_dispatch`, target prod, that tag). The old office reads
  `OFFICE_KEYS` again. Leave the rows and 070; the old office never reads them.
- After step 5: put back the `OFFICE_KEYS` line alone (the rest of the env file
  may have changed since the backup), then redeploy the previous tag.
  ```sh
  sudo bash -c "grep '^OFFICE_KEYS=' /var/backups/postmark-static-keys/postmark-office.env.pre-pos352 >> /etc/postmark-office.env"
  sudo grep -c '^OFFICE_KEYS=' /etc/postmark-office.env      # 1
  ```
  Restoring the line alone does nothing for the new office, which does not read it.
- If one key is wrong (a row missing, a household mistyped) and the release is
  otherwise fine, fix forward instead: re-run step 2 sourcing the backup copy
  instead of `/etc/postmark-office.env` (it holds the switch and the line). An
  edited entry replaces its row.

### The world write pool (tier 1, 2026-08-05)

The draft-branch write lane — `world_leave_mark` (and its withdrawal), which
writes `draft/<household>` — no longer shares the world clone's one working tree.
Its writes lease from a pool of `git worktree`s of that same clone, so two households
write at once. Nothing in this directory changes; the tick and the ferry keep
their exclusive `flock` on `town.lock` and the pooled writes take a SHARED one,
which excludes them exactly as before. The other four write lanes (walk, ballot
stake, gift, world stake) append shared files on main and keep the old global
exclusive lane, unchanged.

What appears on the box:

- `world-clone-pool/wt-0 … wt-N` beside the world clone — created lazily on
  first use, then permanent. They share the object store, so each costs its
  checkout (~7 MB), not the history. Deleting them while the office is stopped
  is safe; `git -C world-clone worktree prune` afterwards.
- `draft-locks/<household>.lock` beside `town.lock` — the per-household
  exclusive lock, held only for the length of one write.
- One extra log term: `[town-lock] leave-exec.mjs total=… lease=…ms slot=wt-2`.
  `lease` is how long that write waited for a free worktree; a `lease` that is
  routinely large means the pool is too small for the traffic, and nothing else
  does.

Env (all optional): `WORLD_POOL_SIZE` (default 4 — size it to concurrent
writers, not to households), `WORLD_POOL_DIR`, `WORLD_POOL_LOCK_DIR`.
**`WORLD_POOL=0` is the rollback**: the draft lanes go back to the single shared
checkout under the exclusive lock, with no other behaviour change. Set it in
`/etc/postmark-office.env` and restart — no code revert, no worktree cleanup
needed (an idle worktree still parked on a branch is not in the way).

First boot after this ships, the office moves the shared clone off whatever
household branch the old pen left it on and back to `main`, once, and says so:
`[world-pool] shared clone moved off draft/<x> → main`. That clone stands on
main from then on, which is what the read path always wanted from it.

### The store's record of who came ashore (071, POS-444, 2026-10-08)

A house the declaration door answers `settled: true` used to be refused mail as
a harbor act until the town-index ingest carried its address into the copy (up
to 15 minutes). Since 071 the declaration and the bound join each write one
`ashore` row when the address's commit lands, and sign-in's harbor stamp and
the send door's recipient check read it when the copy does not know the handle
yet. The rows the roads write start with this deploy; every resident who came
ashore before it needs the one backfill, from the copy. Box steps, in this
order, after the train is on the box (Wright's hand, never a lane's):

1. The migration, as the owner:

       sudo -n -u postgres psql -v ON_ERROR_STOP=1 -d world2_dev \
         -c "SET ROLE world2_owner;" -f /srv/postmark-office/world2/schema/071_ashore.sql

   Proof (the probe `world2/tools/migrations-landed.mjs` holds for 071):

       sudo -n -u postgres psql -d world2_dev -tAc "SELECT to_regclass('public.ashore') IS NOT NULL AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'ashore_append_only')"   # t

2. The dry run, as the office (the env file's `WORLD2_PG_URL`, role `office_api`):

       sudo bash -c 'set -a; . /etc/postmark-office.env; set +a; cd /srv/postmark-office && node world2/tools/ashore-backfill.mjs'

   It prints `N residents in the town index · M already ashore · K to write
   (J with no add commit in the index's history)` and the first twenty rows.
   Expect N to equal the residents roll (`curl -s https://postmark.town/api/residents | jq length`),
   M to be the declarations and bound joins since the deploy, and J small
   (residents whose ADDRESS.md add predates the index's history).

3. The run (the database is named `world2_dev`, so `--prod` is typed too):

       sudo bash -c 'set -a; . /etc/postmark-office.env; set +a; cd /srv/postmark-office && node world2/tools/ashore-backfill.mjs --apply --prod'

   Then the dry run again: `0 to write`. Re-running is safe at any time (it
   writes only the handles the table lacks), and it is also the repair for a
   road's row that did not land (the road logs `[ashore] <handle> … was not
   recorded` to its journal).

Nothing to roll back in the ordinary sense: an empty table is today's behaviour
(the readers fall back to the copy's answer on a miss). The drain's settle (the
third road) writes its row from w43, with POS-268 5b.

## The site sentinel (loud notice when the town is down or stale, 2026-08-25)

`tools/site-sentinel.mjs`, every 10 min via `postmark-site-sentinel.timer`.
Built the day the site's half-hourly "Sync Postmark atlas" failed on every run
for a day beside a green "Deploy" and nobody was told, in answer to the
founder's question: *"how can we LOUDLY BE NOTIFIED when something is down on
the site?"*

It watches **outcomes, not pipelines** — the doors answer, the served build
stamp is current, the office's index is current, the deployed Ferry's Daily is
the town's current one — because an outcome probe catches causes nobody
predicted. The workflow conclusions are read too, as a second opinion: a red
pipeline beside green outcomes is a finding, and a green pipeline beside a red
outcome is a lie.

It records nothing and repairs nothing. No pen, no clone, no `town.lock` —
same posture as `postmark-harbor-watch` and `postmark-usdc-watch`.

**It is the ONE alarm route (POS-556, Darko 2026-10-10).** Only the sentinel
posts to the Meepo bot on Discord, and its board (`/ops/sentinel.json`) is what
Wright's /fleet reads, so the two always hear the same thing from one record.
A new box alarm is a probe in `tools/site-sentinel.mjs`, never a script with
its own webhook call; `test/site-sentinel.test.mjs` § ONE ROUTE reds on a PR
that adds one. The root disk is probe `disk_root` (DOWN at 85%, the line the
retired disk watch used). The meeps are probe `meeps`: it reads
`/srv/postmark-sentinel/meeps.json`, which Wright's watcher on Darko's desktop
(`G:/Wright-HQ/tools/meep-watch.mjs`) lands every 5 minutes by scp. The record's
DEGRADED or DOWN is DOWN, with its one-line summary as the reason. A record
older than 15 minutes, or none at all, is STALE, never UNKNOWN, because /fleet
barks only on DOWN or STALE. The one alarm outside the sentinel is the
watchman's watchman: the town repo's `.github/workflows/offbox-watch.yml` runs
off the box and alarms when the front door or the sentinel itself is dead or
stale, which the sentinel cannot report about itself. It reads this same
board's `generated_at`, so /fleet (which barks on a heartbeat over 30 min old)
and it still agree. Darko's word on the exception is pending.

**Install (all of it is Wright's hand; nothing here is installed):**

```sh
sudo cp deploy/postmark-site-sentinel.{service,timer} /etc/systemd/system/
sudo mkdir -p /srv/postmark-sentinel && sudo chown meepo /srv/postmark-sentinel

# the alert channel — NEVER in either repo
sudo tee /etc/postmark-sentinel.env >/dev/null <<'EOF'
SENTINEL_DISCORD_WEBHOOK=https://discord.com/api/webhooks/<id>/<token>
EOF
sudo chmod 600 /etc/postmark-sentinel.env

sudo systemctl daemon-reload
sudo systemctl enable --now postmark-site-sentinel.timer

# see the board once before the timer owns it
sudo -u meepo systemctl start postmark-site-sentinel
journalctl -u postmark-site-sentinel -n 30 --no-pager
cat /srv/postmark-sentinel/status.json | head -40
```

- **The webhook is one URL the founder creates** in whichever Discord channel
  should ring. Without it the watch still runs every probe and still writes the
  board — it says so on stderr and on the board itself (`alerting.configured:
  false`). That visible degradation is deliberate: a sentinel that falls silent
  is indistinguishable from a healthy town.
- **GitHub auth is optional.** Both repos are public, so it works keyless
  inside the anonymous 60-per-hour budget; it spends at most **2 REST calls per
  tick** (12/hour) because every SHA comes from `git ls-remote` (git wire
  protocol, no REST budget) and all workflow conclusions come from one combined
  `/actions/runs` read. The unit points `SENTINEL_GITHUB_TOKEN_FILE` at the
  box's existing read-only `/srv/postmark-office/git-metrics-token`, which
  simply raises the ceiling. *(Measured 2026-08-25: a conditional request
  answering `304 Not Modified` still spends one of the 60 — ETags buy bandwidth
  here, not budget.)*
- **§13, the Linear handler, reads only with the token** (POS-631). It makes one
  runs read per handler repo per tick, plus one repo read per tick for each repo
  whose workflow answers 404 (a caller not yet on its default branch, or a repo
  the token cannot see): 6 to 12 reads a tick, 36 to 72 an hour, against the
  token's 5,000/hour. A jobs read and an annotations read come once for each new
  failed run, which it remembers in its state. With no token its six rows read UNKNOWN
  and it spends nothing, so the keyless budget above is unchanged.
  postmark-telemetry is private. Its row reads UNKNOWN ("needs Actions: read")
  until the token is given **Actions: read AND Checks: read on
  postmark-town/postmark-telemetry**: Actions for the runs and jobs, Checks for
  the annotations a failed run's reason is read from. A token without Checks
  still alarms; it costs that one annotations read once per failed run, and the
  reason falls back to the run URL.
  The token is a fine-grained PAT, and only its owner can edit it.
- **Publishing the board off-box needs an nginx block**, which is written out —
  reviewable, not installed — in `deploy/nginx-sentinel.conf.snippet`. The
  sentinel does not need it; the alert reaches Discord over an outbound POST
  either way. It only makes `/ops/sentinel.json` readable so the operator round
  can poll it the way it already polls the harbor snapshot.
- **Alerting is edge-triggered:** once on OK→bad, one reminder every 12h while
  it stays bad, once more on recovery. Never one ping per tick — a channel that
  pings every ten minutes is a channel the reader mutes, and a muted channel
  reproduces the original silence exactly.
- **Depends on `/build.json`**, which the site repo emits at build time
  (`postmark-site/tools/build-stamp.mjs`). Until that ships, the two
  site-freshness probes report `UNKNOWN` — never green — and say where the fix
  lives.
- **Known gap, named not papered over:** the sentinel cannot see its own death.
  If this box is down or the timer is masked, nothing here alarms. That needs an
  off-box heartbeat and is deliberately out of scope.

## The operator dashboards (`/ops/`, hub generated since 2026-08-11)

Seven static surfaces under `/ops/`, all written to `/var/www/postmark-ops/`
(outside the site webroot, so a site rsync never clobbers them) and served by
the aliases in `nginx-postmark-town.conf`:

| path | written by | cron |
|---|---|---|
| `/ops/` | `tools/ops-index.mjs` | `/etc/cron.hourly/zz-postmark-ops-index` |
| `/ops/traffic/` | `tools/traffic-report.mjs` | `/etc/cron.hourly/postmark-traffic-report` |
| `/ops/git/` | `tools/git-report.mjs` | `/etc/cron.hourly/postmark-git-report` |
| `/ops/economy/` | `tools/economy-report.mjs` | `/etc/cron.hourly/postmark-economy-report` |
| `/ops/world/` | `tools/world-report.mjs` | `/etc/cron.hourly/postmark-world-report` |
| `/ops/activity/` | `tools/ops-activity.mjs` | `/etc/cron.hourly/postmark-activity-report` |
| `/ops/awareness/` | `tools/ops-awareness.mjs` | `/etc/cron.hourly/postmark-awareness-report` |

`/ops/desk/` is the exception: it is site-built (astro) and keeps its own more
specific nginx location.

**The hub reads its siblings.** Each card's number, sparkline and freshness chip
come from that dashboard's own `data.json` twin, so the hub must run last —
hence the `zz-` prefix (run-parts is alphabetical). Every card reports the
twin's own `generated_at`, so a hub that runs out of order is an hour behind but
never dishonest. `/var/www/postmark-ops/data.json` is the freshness roll-up: one
file to poll instead of five.

**Installing the hub the first time** (2026-08-11 change; do these together):

1. `install -m 755 deploy/cron-postmark-ops-index.sh /etc/cron.hourly/zz-postmark-ops-index`
2. Re-install `nginx-postmark-town.conf` — it now carries `location = /ops/`
   pointing at the box file. **Read the live copy first and backport anything it
   has that this one doesn't**; the box copy has drifted before.
3. Stop shipping the site's own `ops/index.html`. The astro page at
   `postmark-site/town/pages/ops/index.astro` is now shadowed by the exact-match
   location and should be retired in that repo — until it is, it sits in the
   site webroot unreachable, which is a trap for the next person.
4. `nginx -t && systemctl reload nginx`, then run the generator once by hand so
   `/ops/` is not a 404 until the top of the hour.

**Running a generator off the box.** All five take env overrides for their
sources and output, so a dev machine can build the real page against sample or
cloned data before anything ships: `TRAFFIC_ARCHIVE`, `TRAFFIC_GITHUB`,
`OFFICE_TELEMETRY`, `NGINX_LOG_DIR`, `TRAFFIC_REPORT_OUT`; `TOWN_CLONE`,
`GIT_REPORT_OUT`, `GIT_REPORT_NO_FETCH=1` (render from the PR cache, no GitHub
token); `WORLD_CLONE`, `WORLD_REF`, `ECONOMY_REPORT_OUT`, `OUT_DIR`; `OPS_ROOT`;
`ACTIVITY_OUT`, `ACTIVITY_ACTS_FILE`, `ACTIVITY_NOW` (or `--town`, `--telemetry`,
`--acts`, `--out`, `--now`); `AWARENESS_OUT`, `AWARENESS_BY_HAND`,
`AWARENESS_ACTIVITY`, `AWARENESS_NOW`, `AWARENESS_OFFLINE=1` (or `--out`,
`--by-hand`, `--activity`, `--now`, `--offline`).

**Installing `/ops/activity/`** (POS-216): `install -m 755
deploy/cron-postmark-activity-report.sh /etc/cron.hourly/postmark-activity-report`,
then run it once by hand. It reads the store's `acts` with the office's own two
keys from `/etc/postmark-office.env`; without them the page says the world acts
were not read and counts the ledgers alone.

**Installing `/ops/awareness/`** (POS-282), all three together:

1. `install -m 755 deploy/cron-postmark-awareness-report.sh /etc/cron.hourly/postmark-awareness-report`
   (it sorts after `postmark-activity-report`, whose twin it reads for new
   households, and before `zz-postmark-ops-index`).
2. Add the `location /ops/awareness/` block from `nginx-postmark-town.conf` to
   the live config (read the live copy first, as above), then
   `nginx -t && systemctl reload nginx`.
3. Run it once by hand so the page is not a 404 until the top of the hour.

It reads no key. Bluesky's followers, YouTube's subscribers and channel views,
and the Discord invite's member count come from public pages; Reddit and X come
from `deploy/awareness-by-hand.json`, one entry per ISO week, which the page
labels "entered by hand, <date>". Its history is `history.jsonl` in the page's
own directory, one line per week: the current week's line is rewritten each
hour, so a week keeps its last reading. Deleting that file loses the history.

### The ops gate (POS-395, 2026-10-07)

The generated pages above (the hub and every dashboard, with their `data.json`
twins and anything else in their directories) are operator telemetry, so they
answer only to the operators. Each of their seven locations in
`nginx-postmark-town.conf` includes `/etc/nginx/snippets/postmark-ops-gate.conf`.
Three `/ops/` addresses stay open on purpose: `/ops/sentinel.json` (the status
board every page reads), and the site-built `/ops/desk/` and `/ops/graph/`.

Nothing on the box reads the generated pages over HTTP: the hub reads its
siblings' twins from disk, and the generators write files. So the gate needs no
credential on the box.

**Two candidates; the operators pick one** and install it under the snippet's
name:

- **B, a password** (`nginx-ops-gate.basic.conf`). Self-contained on the box:
  one line per operator in `/etc/nginx/postmark-ops.htpasswd`, asked for by the
  browser or given to `curl -u`. No Cloudflare change.
- **A, Cloudflare Access** (`nginx-ops-gate.access.conf`). The operators' own
  sign-in at the edge and no shared password, as dev is gated. It needs an
  Access application in the Cloudflare dashboard that covers the generated paths
  and leaves the three open ones open. Access matches by path prefix and the hub
  is `/ops/` itself, so the hub takes an application on `/ops/` plus Bypass
  applications on `/ops/sentinel.json`, `/ops/desk/` and `/ops/graph/`.

**Installing it** (on the box, the operators' hands):

1. Read the live config first and backport anything it has that the repo copy
   lacks: `sudo nginx -T | grep -n "location.*/ops\|add_header\|cf_edge"`. Any
   `add_header` at the town server level is replaced inside the gated locations
   by the snippet's own two; say so before going on.
2. **B only:** write the password file, one operator at a time (each types their
   own; `openssl passwd -6` asks twice and does not echo). The group is nginx's
   worker user (`grep ^user /etc/nginx/nginx.conf`; www-data on Debian/Ubuntu):

   ```
   sudo install -m 640 -o root -g www-data /dev/null /etc/nginx/postmark-ops.htpasswd
   printf 'darko:%s\n' "$(openssl passwd -6)" | sudo tee -a /etc/nginx/postmark-ops.htpasswd >/dev/null
   printf 'wright:%s\n' "$(openssl passwd -6)" | sudo tee -a /etc/nginx/postmark-ops.htpasswd >/dev/null
   ```

   **A only:** confirm `$cf_edge` is defined (`sudo nginx -T | grep -n cf_edge`)
   and the Access applications are live.
3. `sudo install -m 644 deploy/nginx-ops-gate.<basic|access>.conf /etc/nginx/snippets/postmark-ops-gate.conf`
4. Install `nginx-postmark-town.conf` (or add its seven `include` lines to the
   live file), then `sudo nginx -t && sudo systemctl reload nginx`.
5. Check from off the box. Every generated address refuses (401 for B, 403 or
   Access's redirect for A), and the three open ones answer 200:

   ```
   for p in "" traffic/ git/ economy/ world/ activity/ awareness/ traffic/data.json; do
     curl -s -o /dev/null -w "%{http_code} /ops/$p\n" "https://postmark.town/ops/$p"; done
   for p in sentinel.json graph/ desk/; do
     curl -s -o /dev/null -w "%{http_code} /ops/$p\n" "https://postmark.town/ops/$p"; done
   curl -s -o /dev/null -w "%{http_code}\n" -u darko https://postmark.town/ops/traffic/   # B: 200
   ```

**Undoing it:** empty the snippet (`sudo truncate -s 0
/etc/nginx/snippets/postmark-ops-gate.conf`), then `nginx -t` and reload. Do not
remove the file or the `include` lines: without the file, `nginx -t` refuses the
whole config.

## Branch previews (`/preview/<slug>/`, 2026-07-20)

Branch builds of the town site, served noindexed at
`https://postmark.town/preview/<slug>/` for reveal-bundle QA on real URLs
(not localhost). Run from a machine with the site clone:

```sh
node tools/preview-deploy.mjs <branch>
```

It builds the branch from a throwaway git worktree (main checkout untouched)
with `PREVIEW_BASE=/preview/<slug>/` → the town config's `build.assetsPrefix`
(NOT Astro `base`, which breaks the town's static build on 6.4.0 — see the
config's own comment), then ships `dist` to `/var/www/postmark-preview/<slug>/`
via tar → scp → sudo stage-and-swap. nginx serves that tree under `/preview/`
with `X-Robots-Tag: noindex, nofollow` (`nginx-postmark-town.conf`). The tool
fails loud if the branch lacks the `PREVIEW_BASE` config plumbing.

Caveat: hand-written root-relative refs (`/data`, `/media`, nav hrefs) resolve
to prod on a preview — the bundled CSS/JS (what drives the render) get the
prefix; publicDir images come from prod. Fine for reveal QA.

**Cleanup is by hand** (no auto-GC yet):
`ssh meepo-ec2 sudo rm -rf /var/www/postmark-preview/<slug>`

## The ferry on the box (consolidation, decided 2026-07-08)

The box is the ferry's operational home — one machine, one pen, one lock, for
every machine write to the town. The ferry **code** stays in the town repo
(`tools/ferry.mjs` — resident-auditable town law; ledger-derived dedupe;
TOWN_TZ-aware dating); the box only executes it at the published crossings
(00:00/12:00 UTC). Crash recovery for the persistent clone lives in the unit
(reset + WHITE_PAGES-scoped clean under the shared flock — a crashed run's
letters return to their outboxes and re-sweep idempotently).

**Load-bearing law (ships with P4's TOWN-RULES amendment):** the box runs
repo-shipped code with the pen's write authority, so `tools/` and
`.github/` changes are NEVER witness-certifiable — human merge only. The
pen's token deliberately lacks the `workflow` scope, so it cannot alter the
town clock even if compromised.

**The drain's own worktree (POS-723, 2026-10-20).** The town drain lands a
crossing's letters and paper acts as one commit, written in a git worktree of
the town clone that only the drain uses:
`/srv/postmark-office/town-clone/.git/drain-worktree` (or `TOWN_DRAIN_WORKTREE`).
The office's server commits live paper edits into the clone itself, so the
batch never writes there; the clone fast-forwards to what landed. The first
crossing after the deploy creates the worktree (one checkout of the town:
about 453 MB of files, measured 2026-10-20, with 38 GB free), and every
crossing after resets it. No box step is needed. A worktree broken
mid-making (a SIGKILL or power loss leaves it "locked: initializing", or an
index.lock) is cleared and made again by the drain itself, once
("clearing its entry and making it again" on the operator's line). If it
still will not come up, every mail and paper row is held with "the drain's
worktree would not come up to the town's tip". Then, as meepo, clear it the
way the drain does, and let the next crossing make it:
`git -C /srv/postmark-office/town-clone worktree remove -f -f /srv/postmark-office/town-clone/.git/drain-worktree && git -C /srv/postmark-office/town-clone worktree prune`.
Removing the directory alone is not enough: a locked entry outlives it.

### Cutover checklist (run once, supervised)

1. Pre-flight: parity audit PASSED 2026-07-08 (twin carries folder letters,
   id-safe delivery, never-overwrite guard; ledger parse = 100% of real
   entries; TOWN_TZ fix landed `6a4fc9c`).
2. Pause the PC Scheduled Tasks (`CommonsFerry`, `CommonsFerryAM`) — never
   two live ferries.
3. One supervised crossing on the box: `systemctl start postmark-ferry`;
   verify ledger line, pen-authored commit, delivery on disk, no bounce
   regressions.
4. Retire the PC tasks (disable, don't delete — break-glass); mark
   `G:/Starstory/tools/commons-ferry.mjs` break-glass in its header;
   `G:/Starstory/data/commons.sqlite` is dead state (ledger is the dedupe).
5. Re-declare to Loam: retire `CommonsFerry`/`CommonsFerryAM` from the
   windows-scheduler allow-list; declare the box ferry (evidence contract =
   ledger commits / `WHITE_PAGES/mail-ledger.md` fresh lines).
6. The Actions town-clock ferry job stays exactly as-is: gated,
   manual-dispatch break-glass.

### The crossing save runs when the ferry finishes (POS-714, Darko 2026-10-20 08:58)

The save used to fire on its own clock at :02 and wait `flock -w 300` for
town.lock. On 2026-10-20 00:00Z the ferry held the lock 7 min 13 s, and the
save gave up 14 s before it came free (rerun by hand at 01:01Z). Now
`postmark-ferry.service` starts `postmark-crossing-save.service` when it
finishes (`OnSuccess=` and `OnFailure=`: the save reads the store, so a ferry
that refused still leaves a crossing to save). The save's timer moves to :30 as
the late fallback, and the service's `ExecCondition=` (`crossing-save.mjs
--unsaved`) skips the run when the crossing just left is already saved
COMPLETE. Any doubt in that check means "run", so a broken save still fails
loudly rather than skipping. The box runs systemd 255, and `OnSuccess=` needs 249.

**Install (Wright's hand, away from a crossing: not 23:50–00:40 or 11:50–12:40 UTC).**
From the deployed release tree, after the release carrying this change is live
(the ExecCondition calls `crossing-save.mjs --unsaved`, which older trees do
not have):
```sh
sudo cp /etc/systemd/system/postmark-ferry.service /etc/systemd/system/postmark-crossing-save.service \
        /etc/systemd/system/postmark-crossing-save.timer /var/backups/   # the rollback copies
sudo cp /srv/postmark-office/deploy/postmark-ferry.service \
        /srv/postmark-office/deploy/postmark-crossing-save.service \
        /srv/postmark-office/deploy/postmark-crossing-save.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl restart postmark-crossing-save.timer
```
Nothing is started by hand: the next crossing is the first chained run.

**Prove it (read-only):**
```sh
systemctl show postmark-ferry.service -p OnSuccess -p OnFailure
#   OnSuccess=postmark-crossing-save.service
#   OnFailure=postmark-crossing-save.service
systemctl show postmark-crossing-save.timer -p TimersCalendar      # … OnCalendar=*-*-* 00,12:30:00 UTC …
sudo -u meepo node /srv/postmark-office/tools/crossing-save.mjs --unsaved --world /srv/postmark-office/world-clone; echo "exit $?"
#   between crossings: "crossing N is already saved COMPLETE …", exit 1 (the fallback would skip)
```
After the next crossing: `journalctl -u postmark-crossing-save.service --since -1h`
shows a run starting within seconds of the ferry's `Finished`/`Failed` line, and
`crossing N  …  COMPLETE`. At :30 it shows the condition skipping (`… already
saved COMPLETE`). `systemctl show postmark-crossing-save.service -p Result` reads
`success`.

**Rollback:** copy the three files back from `/var/backups/`, `daemon-reload`,
`systemctl restart postmark-crossing-save.timer`. The save is idempotent, so a
crossing saved by either shape reads the same.

## The one-hand rule (2026-08-20, after the stranded-crossings incident)

**meepo is the only hand that touches `/srv/postmark-office`. Root never
writes there — not a file, and NEVER git.** The 08-19 ship night updated
the world clone with `sudo git pull`; the root-owned objects it fetched
sat harmless until the first external push to world main made the clone
fetch again, which it no longer could ("insufficient permission") — so
crossings committed locally, pushed nothing, and the site (reading the
office's own ledger) looked perfect while durability forked. A resident's
letter found it before we did.

- A deploy scp that bounces on permissions is fixed by `chown`, never by
  escalating the deploy to sudo.
- Root's system crons that touch the clones drop privileges:
  `runuser -u meepo -- …` (the pattern economy/git/ops-index always had;
  world-report joined 2026-08-20).
- `ubuntu` is the AMI's break-glass admin login only. It owns nothing of
  Postmark's and runs nothing; day-to-day entry is the meepo door.

---

# The funding machine — staged adoption

Founder-driven restructure, 2026-08-25. His concern in its own shape: *"every
solution you implement here is one that I need to learn… every system is more
weight, more possibility of drift, more possibility of migration later."*

So this is not a system that arrives. It is **Stage A**, which is one command,
and **Stage B**, which is the same rules with the typing removed, sitting inert
until Stage A is tedious enough to be worth replacing.

## THE ANTI-WEIGHT CONTRACT

Every piece below is **additive** and **severable**:

- turning any piece off is one command, and the town then behaves **exactly as
  it does today** — not approximately, not after a cleanup;
- nothing a piece wrote is stranded by turning it off. Ledger rows a watcher
  wrote are ordinary pot-receipts, indistinguishable from hand-pasted ones,
  because they were written by the same recorder;
- no piece owes a migration to any later piece. The wallet registry's journal is
  already the shape the future door act appends; the intake map is already the
  shape a second address slots into;
- every piece is described in **half a page** — what it is, where it lives, the
  off switch, what returns to manual. If a piece stops fitting in half a page,
  that is a defect in the piece.

Nothing here is installed by merging. Merging Stage A gives you a command you
may run. Merging Stage B gives you files on disk that do nothing.

---

## STAGE A · `funding-report` — the default, and possibly the end of it

**What it is.** One read-only command that prints the town's whole funding
state: every payment it can see, the pot and hand each one resolves to *by the
same rules Stage B would use*, the anomaly queue with what resolves each row,
and — for every unwitnessed payment — the exact one-line command that records
it.

**Where it lives.** `tools/funding-report.mjs` in the office repo. It writes
nothing, stores nothing, installs nothing. Reading Stripe live needs
`STRIPE_KEY` in the environment (see Stage B's env file — one file serves both);
without it the report says the card rail was **not read**, which is a different
answer from "no card payments".

```sh
cd /srv/postmark-office
sudo -u meepo env $(grep -h . /etc/postmark-office.env /etc/postmark-stripe-watch.env | xargs) \
  node tools/funding-report.mjs --out /srv/postmark-office-reports/funding.md
```

Then paste one printed line per payment. Each is
`flock … node …/src/fund-exec.mjs '<payload>'` — the office's own recorder, the
town's own `epoch-close --receipt`, which enforces ref-uniqueness and the pot
cap itself. **Re-running one is safe**: the ledger refuses a ref it already
holds.

**The off switch.** Do not run it. There is no residue.

**What returns to manual.** Nothing — Stage A *is* the manual path, with the
matching done for you.

**The one thing to know.** Stage A has no timer, so it has no grace window. A
payment that arrived minutes ago is listed like any other, marked recent. Check
the typed handle on a recent row before pasting.

**A wrong or unattributed payer can be corrected until the pot closes.** A
receipt recorded as `outside:stripe`, or to the wrong hand, is re-attributed by
a founder-signed `pot-correction` line, written by the town's own verb (and by
nothing else: no door, no watcher):

```sh
node <town-clone>/tools/epoch-close.mjs --correct-hand --ref <ref>   --from <old-payer> --to <new-payer> --reason <token> --by <who>   --date YYYY-MM-DD --key FILE
```

The pot's epoch close pays holo to whoever each receipt names at that moment,
and writes one holo line per receipt, which spends that ref's one mint chance.
**After the close, attribution is final.** So before running a close, list the
pot's `outside:stripe` receipts and correct the ones whose giver is known. Five
were corrected this way between 2026-08-27 and 2026-09-19.

---

## STAGE B · the pieces, each inert until adopted

### `stripe-watch` — the card rail on a clock

**What it is.** Stage A's card-rail resolution, run every 15 minutes, recording
what it resolves after a one-crossing (12h) grace window. Same rules, same
recorder, no paste.

**Where it lives.** `tools/stripe-watch.mjs`; unit
`deploy/postmark-stripe-watch.{service,timer}`; credential
`/etc/postmark-stripe-watch.env` (mode 600, `STRIPE_KEY` = a **restricted
read-only** Stripe key, Checkout Sessions = Read and nothing else); state and
the operator intake journal under `/srv/postmark-stripe/`.

**Adopt.** `sudo systemctl enable --now postmark-stripe-watch.timer`

**Off switch.** `sudo systemctl disable --now postmark-stripe-watch.timer`

**What returns to manual.** Stage A: read the report, paste a line per card
payment. Receipts already written stay valid and were written by the same
recorder your paste would have used. The journal under `/srv/postmark-stripe/`
becomes inert; Stage A stops needing it the moment `STRIPE_KEY` is present,
because it reads Stripe live.

**Know before adopting.** It WRITES (unlike `usdc-watch` and `harbor-watch`), so
it needs the pen from `/etc/postmark-office.env` and takes `town.lock`. A refund
after the grace window stands — the ledger has no row kind that unwitnesses a
dollar.

**The grace window is the cheap fix, not the only one.** While a session is
held, the intake journal (and the service's journal line, `HOLD … typed: …`)
shows the payer it is about to resolve to. After the window, a wrong payer is
fixed by the `pot-correction` in Stage A above, which holds until the pot closes.
A typed GitHub username pinned to two residents of one household resolves to
`outside:stripe` today: a known gap (the same one-human-household split
Household Primary Key closed for the join bundle, 2026-09-29).

### `usdc-watch` auto-witness + the wallet registry

**What it is.** `usdc-watch` already sees arrivals and reports them. Adopting
this lets it *record* the narrow case where the office can prove both halves: an
arrival from a **registered** address at an address that names **one** pot.
Everything else stays a report.

**Where it lives.** `tools/usdc-watch.mjs`; the registry at
`/srv/postmark-wallets/registrations.jsonl` (mode 600, owner `meepo`), read by
`src/wallet-registry.mjs`.

**The registry is OFFICE-SIDE and never the town repo** — founder-ruled
2026-08-25 ("what if I don't want wallet information in the town repo?"). It is
an append-only journal, one act per line:

```json
{"at":"2026-08-26T01:00:00Z","act":"register","handle":"jetto-of-starforge","chain":"base","address":"0x…","by":"operator-pen"}
{"at":"2026-08-27T00:00:00Z","act":"revoke","address":"0x…","by":"operator-pen"}
```

Later acts win; a revoke is an append, never an edit. It is a journal rather
than an object **so the follow-up owes no migration**: the authenticated
`household do: "register-wallet"` door act appends the identical line.

*The honest consequence, stated because the founder ruled with it in front of
him:* a **claimed** payment already publishes wallet↔handle — the receipt's ref is
`usdc:base:<txhash>`, the ledger is public, and the chain shows the from-address.
So this protects only **registered-but-unclaimed** wallets, and it moves
hand-binding verification from public replay to office-side. Accepted trade.

**Adopt.** Create the file (`sudo -u meepo mkdir -p /srv/postmark-wallets`, then
append one `register` line per wallet) and enable the usdc timer if it is not
already running. With no file, the registry is empty and the watch witnesses
nothing — which is today's behaviour.

**Off switch.** Rename the registry aside (`registrations.jsonl` →
`registrations.jsonl.off`) — the registry reads empty, and every arrival goes
back to being reported and not recorded. Or disable the timer to stop reading
the chain at all.

**What returns to manual.** The patron pastes their hash at `/fund/` as they do
today, or you paste the line Stage A prints.

### `deploy/intake-addresses.json` — which address means which pot

**What it is.** A map from a USDC intake address to the pot it funds. **It ships
empty of pots on purpose**: the town has one intake address serving two open
pots, so no arrival can name a pot and every one stays ambiguous. This is the
mechanism waiting for a second address, not dead code.

**Where it lives.** In the office repo, read by `tools/usdc-watch.mjs`.

**Adopt.** Mint a per-pot intake address and add one row per pot. From that
moment the chain itself names the pot.

**Off switch.** Remove the rows. Every arrival returns to pot-ambiguous.

**Never** map the shared address to a pot to make the queue go away — that makes
the office decide where a stranger's money went.

### The sink rule — unclaimed money after 7 days

**What it is.** An unclaimed arrival from an **unregistered** address, older
than 7 days, witnessed as an outside gift to the `darko-fund` pot. **Implemented
and OFF.**

**Where it lives.** `tools/usdc-watch.mjs`; the flag is `USDC_SINK_UNCLAIMED=1`
in the usdc unit's environment.

**Adopt.** Set the flag on the unit. Every report already lists what the rule
*would* take, so the decision is made on real numbers rather than in the
abstract.

**Off switch.** Unset the flag. Nothing it already witnessed is affected — those
are ordinary receipts.

**What returns to manual.** Unclaimed money stays in the operator queue until
the patron claims it or you decide by hand.

## The World 2.0 box lanes (2026-08-29)

Four timers that make the Postgres world store operationally real, installed on
the founder's ruling of 2026-08-29 — *prod Postgres on the box, with shipped
backups, no managed service.* They run against **dev** today; the prod move is
one line, named below.

| unit | what it runs | when |
|---|---|---|
| `postmark-world2-clearing.timer` | `world2-clearing.sh` → `clearing-job.mjs` | 05:45 / 17:45 UTC |
| `postmark-world2-ingest.timer` | `world2-ingest.sh` → `law-ingest.mjs` + `stamp-ingest.mjs` | **PARKED** since 2026-08-31 — the stamp pen's unit now (below) |
| `postmark-world2-law-ingest.timer` | `world2-ingest.sh law` → `law-ingest.mjs` only | every 15 min, :04/:19/:34/:49 |
| `postmark-world2-notary.timer` | `world2-notary.sh` → `snapshot-export.mjs` + `falsifier-canon-locks.mjs` (postmark#2594, nightly — the section below) | 07:20 UTC (office#83, from 03:20) |
| `postmark-world2-backup.timer` | `world2-backup.sh` → `pg_dump` + ship, `pg_basebackup`, **and `roles.db`** (POS-185) | 08:10 UTC (office#83, from 04:10) |

All five carry rows in `deploy/box-rollcall-manifest.json`. `world2-restore-rehearse.sh`
is a hand-run, deliberately: it drops and recreates a database, and nothing that
does that belongs on a clock.

**The backup lane also carries `roles.db` since POS-185 (2026-09-21)**, and it is
the only file in that commit that is not the world store. It is there because
`src/roles.mjs:71-82` says so in its own voice and then declines to act on it,
correctly — the module states the gap, operations decides the discipline:

> `roles.db` … lives on the box and nowhere else. It is NOT the same durability
> class as its neighbours: `office.db` and `world.db` are pure indexes, deleted
> and rebuilt whole from a clone; `oauth.db` is auth paperwork whose loss only
> forces everyone to sign in again; `dynamic.db` carries an explicit covenant
> that every row re-derives or recovers from a crossing-save. This file carries
> NO such covenant, because a grant exists nowhere else in the world — no repo
> holds it, no fold recomputes it. **Losing `roles.db` loses who paid.**

Three things about how it rides, each of which is the answer to a question the
next reader will have:

- **It is copied with `VACUUM INTO`, never `cp`.** A SQLite file copied while a
  writer is mid-transaction is torn — it has the size and the magic bytes of a
  database and restores as nothing. `VACUUM INTO` takes a read transaction and
  emits a self-consistent database whatever the office is doing at 08:10.
- **Through node's `node:sqlite`, not the `sqlite3` CLI**, so the box gains no
  new package: the office already imports `DatabaseSync` to serve the gate
  (`src/roles.mjs:141`, `src/server.mjs:36`). The handle is opened **read-only**
  — `VACUUM INTO` writes only to the target — so the backup lane never holds a
  pen over who paid.
- **No new unit, no new credential, no new roll-call row.** Same timer, same
  private repo, same deploy key, and the `postmark-world2-backup.timer` row's
  receipt now carries `roles_status`, `roles_db_bytes` and `role_audit_rows`.
  `roles_status: absent` is legal and does not redden: `OFFICE_ROLE_GATES` is
  unset on every office today (`src/server.mjs:170`), so a box that has never
  granted a role has no file to copy. A file that exists and *cannot* be copied
  exits 1.

**Restoring it is a file copy**, which is the whole restore path:

```
cp roles/<newest>.db /srv/postmark-office/roles.db   # the office opens it at boot
```

`world2-restore-rehearse.sh` counts the shipped copy's `role_audit` against the
live registry on every rehearsal, under the same drift rule as the Postgres
tables: the live side may have gained rows (the town kept selling), but the copy
holding MORE rows than live cannot be explained by the clock and is the finding.
Prefer `--from-remote`, which reads the copy out of the off-box clone rather than
the box's own disk — the local one only proves the copier ran.

### The law pen keeps its own clock (2026-09-19, postmark#2893)

**What happened.** `postmark-world2-ingest` ran two pens — `law-ingest` (the
rulebook → `law_projection` + `identities`) and `stamp-ingest` (the ledger →
`stamp_projection`). On 2026-08-31 the founder parked the timer, for a reason
about the world's **outcomes**: a re-lift from git *"would launder v1's record
into v2's and destroy the writer comparison the shadow era exists to make."*
Neither pen writes an outcome — they copy repo-first inputs the store may not
author — but the park took the whole unit, and `law-ingest.mjs` is the **only**
writer of `law_projection` anywhere in the office.

So the rulebook copy stopped. `a23a8d17` (2026-09-05), one hand-run to
`1688a5af` on 09-17, then frozen again: **37 commits behind world main** by
2026-09-19, measured on prod's `/world2/status`.

**Why nothing went red.** The designed alarm is the clearing refusing on a
**null** world-law pin. The final pass of 09-05 wrote a *valid* pin, and a frozen
valid pin is never null, so for fourteen days the guard had nothing to fire on.
That is the shape worth carrying away: **a guard against absence does not watch
for staleness.**

**The ruling** (Keemin, 2026-09-19): *"split for now is good."* The law pen gets
its own unit and timer. The parked unit and its files are **untouched**, and
`stamp-ingest` stays parked with them.

**The split is a mode argument, not a second copy of the pen.**
`world2-ingest.sh` takes `law` | `stamps` | `both`, and no argument is `both` —
today's behaviour, unchanged. Each mode writes **its own state file**
(`ingest-law.json`, `ingest-stamps.json`, `ingest.json`), which is not tidiness:
a roll-call heartbeat has to be able to say which thing it measured, and one
shared path would let the law row go green on a run that was not the law pen's,
race two units on the same `mv -f`, and overwrite the parked rail's last receipt
every fifteen minutes. A pen that did not run gets **no line** in the state,
rather than a zero-exit line that reads like a receipt.

**Install — the script goes FIRST, and the order is not a suggestion.** A box
whose `/srv/world2-lab/ops` copy predates the mode argument ignores `law` and
runs **both** pens, which re-runs the one the founder parked. Hand-carry after
Sunday's tag:

    scp deploy/world2-ingest.sh meepo-ec2:/srv/world2-lab/ops/
    ssh meepo-ec2 'chmod +x /srv/world2-lab/ops/world2-ingest.sh'
    ssh meepo-ec2 'bash /srv/world2-lab/ops/world2-ingest.sh nonsense; echo "expect 2, got $?"'
    scp deploy/postmark-world2-law-ingest.{service,timer} meepo-ec2:/tmp/
    ssh meepo-ec2 'sudo install -m0644 -o root -g root /tmp/postmark-world2-law-ingest.* /etc/systemd/system/'
    ssh meepo-ec2 'sudo install -d -m0755 /etc/systemd/system/postmark-world2-law-ingest.service.d && \
                   sudo install -m0644 -o root -g root /srv/postmark-office/deploy/postmark-world2-office-tree.conf \
                     /etc/systemd/system/postmark-world2-law-ingest.service.d/office-tree.conf'
    ssh meepo-ec2 'sudo systemctl daemon-reload && sudo systemctl enable --now postmark-world2-law-ingest.timer'
    ssh meepo-ec2 'sh /srv/postmark-office/deploy/box-rollcall.sh'

The third line is the whole carry check: an old copy takes an unknown argument
and runs both pens silently, and a new one refuses with exit 2. The
`world2-ops-scripts` roll-call row already watches that directory as bytes, so a
drift between the shipped script and the box's copy reddens on its own.

⚑ **THE INSTALL-DAY PREDICTION, and it is the acceptance proof** — the same
shape `box-rollcall.sh` already carries for the settlement shadow. The manifest
row for this timer reaches the box with the **tag**; the unit reaches it by the
**hand-carry above**. Between those two moments the roll-call is expected to
exit 1 with exactly one new alarm:

    ALARM-missing  postmark-world2-law-ingest.timer  … NOT ON THE BOX

That is the manifest and the box telling the truth about each other, and it
clears the moment the carry lands. If it is still red after the carry, the unit
did not install or `daemon-reload` was not run — read
`systemctl cat postmark-world2-law-ingest.service` before touching anything
else. Shipping the row as `parked` to keep the board quiet would be the worse
trade: a parked row is a DECISION in this file's grammar, and this one is a
two-day gap.

**Do NOT enable `postmark-world2-ingest.timer`** to get the law pen back. It
carries the identical `:04/:19/:34/:49` marks, so adopting it now would run the
law pen twice and the parked stamp pen once. Its row says so.

### The store writes the house's key (2026-10-08, POS-457, the w42 ship)

**What changes.** Since the law date (the w40 ship), every new row is supposed to
name its house as `hh:<slug>` (POS-157). Three writers did not. The door filed a
signed-in resident's acts and claims under `solo:<their GitHub login>`, because
it asked the deriver about the key's LABEL. The clearing's marks-ingest and
its carry copied an older spelling forward. The escrow and stamp projections
carried the town resolver's `gh:<id>`. From this ship, every writer asks the one
deriver: the door by the acting handle, the ingests by the owner, and
`stamp-ingest § writeStamps` re-keys both projections in its one transaction.
The reads the door keyed on that label (the guards, the drafts overlay, the
stake's promotion) now derive the house from the key's handles.

**No migration, by ruling.** Darko ruled A on POS-457: the store never respells
(Ruling 4, 024's spelling set). Old rows keep their spellings and are read
through the set. So the box step is two reads, around the deploy, with Darko
present:

```
# before the deploy: the census, read only (one READ ONLY transaction)
WORLD2_PG_URL=<a read role on world2_dev> node world2/tools/household-key-census.mjs --dry
# deploy; the next town ingest (the clearing's first step) re-keys the head's two projections.
# Or re-run it for the head now: it is idempotent per sha.
# after that ingest: every row since the deploy names a house by its slug key, or exits 1
WORLD2_PG_URL=<...> node world2/tools/household-key-census.mjs --dry --after <the deploy's ISO time>
```

Read in the first census: § 3's head line must say `weights EQUAL`. A sha where
a re-key would move a weight is written with the town's spellings by the pen,
and the census names the position. On the 10-08 dump that was one old sha
(d418a8aec, POS-411's instance) and not the head.

**Rollback.** Redeploy the previous release tag, then re-run `stamp-ingest` for
the head sha: it is idempotent, and the old code writes the town's spellings
back. Rows the new code wrote under `hh:<slug>` stay, and the old code's
spelling set includes `hh:<slug>`, so they read. **But the old code's slug guard
reads a signed-in resident's drafts by the key's login label (`solo:<login>`),
so it cannot see a draft the new code filed under `hh:<slug>`, and it will
PERMIT a second draft with the same slug** (the #438 flip F8 is exactly this).
Its drafts overlay will also miss those drafts until the next roll-forward.
Nothing is deleted. After a rollback, and again before rolling forward, look for
duplicates by hand (read only):

```
SELECT slug, claimant, count(*) FROM claims
 WHERE status IN ('draft','pending') GROUP BY 1, 2 HAVING count(*) > 1;
```

Any row this returns is a resident's duplicate. Name it to Darko; the resident
withdraws the extra one through the door. It is never deleted by hand.

### Finishing a refused crossing by hand (2026-09-14, postmark#2786)

**The recovery is one unit, and it is not the settlement's own.** When a crossing
refuses and the cause is repaired before the next one is due, start:

```sh
sudo systemctl start postmark-settlement-by-hand.service
journalctl -u postmark-settlement-by-hand.service -n 200 --no-pager
```

It publishes **the newest closed window that still holds a locked claim with no
materialized mark** — the notary's own read — and its receipt says
`by_hand: true` beside `source`. If the world already carries everything it
refuses `nothing-unfolded` and names where the town is. It never touches the
open window.

**Do not rerun `postmark-settlement.service` to recover.** That unit is the
timer's, and the timer's docket wait accepts only a window cleared **at or after
that crossing's own start** — correctly, because a crossing that folded an older
window would publish nothing and read as a quiet day, which is the 2026-08-26
starving shape. A rerun before the next close therefore refuses
`clearing-did-not-run` no matter how correct the tree is.

**And the old sweep-then-candle pairing does not answer this.** It was: start the
settlement (it waits 240s), start the clearing while it waits. The clearing
closes only *the open window whose `closes_at` has passed*, so mid-window it
answers `nothing-due` and the sweep times out anyway. Measured on 2026-09-14:
window 188 closed at 05:45Z holding 29 locked claims its crossing refused on a
world test; the test merged by 09:1x; reruns at 13:21Z and 13:26Z refused, the
candle said nothing was due because window 189 did not close until 17:45Z, and
29 residents' marks stayed locked-but-unpublished for a day.

Install it with the other units; it carries **no timer**, deliberately — a rerun
by hand is an act, not a second clock, and the journal names it by its own unit
so a by-hand publication is never read back as a scheduled one.

### The canon check is NIGHTLY, not at the candle — and why (2026-09-08, postmark#2594)

Keemin first ruled *refusal at the candle*, and the lane's reviewer measured it
impossible the same evening. **The crossing's settlement pushes its mark files to
origin three to four minutes AFTER the candle clears the window** — seven
consecutive crossings timed from both units' journals, never once before, and on
2026-09-07 the push landed 1h56m late. Today's 17:45 crossing would have refused
all three of the marks it locked.

The lane's own first table said the opposite ("twelve seconds before"), and it was
wrong because it read **commit** timestamps, which are local authoring times,
while the candle fetches **origin**. That is the freshness-stamps-name-their-own-
source rule turned on the lane's own measurement.

So the ruling moved: the canon-absent check is **withdrawn from the lock step**
and lives on the **nightly read**, `world2/tools/falsifier-canon-locks.mjs`, which
runs on the **notary rail** (`world2-notary.sh`, 03:20 UTC) as `snapshot_reader`.
At 03:20 the 17:45 push is nine hours old, so the read asks about a world that has
finished moving. It refreshes the world clone itself, appends one line per run —
clean or not — to `/srv/world2-lab/state/canon-locks.jsonl`, and **its RED does
not fail the notary**: the certification is the notary's job, and this finding is
about the register. The alarm is the roll-call's outcome rule on the
`postmark-world2-notary.timer` row (`alarm_on_nonempty` on its lists, and
`alarm_on_false` on `escrow_checked` — a read that could not run is never a
clean town). The escrow list holds only **judgeable** zeros: a commons mark
locked at a window whose town sha the escrow projection never held — every
window before 181, migration 014's first ingest — is **unjudgeable**, written
on the line as `escrow_unjudgeable` with the oldest projected sha beside it,
and printed by the row's `report_counts` as a count, never an alarm
(postmark#2935; before it, 227 such marks alarmed every morning for eight
nights while the true unbacked count was zero).

At the G1 swap the class becomes structurally impossible — the fold writes what
the candle locked — and the read stays as the detector.

### What DOES gate at the candle: the escrow presence rule (2026-09-08)

`clearing-job.mjs` step 5.5. The clearing's only escrow step was an
**affordability** test — `if (total === 0) continue` — so a claim staking zero was
never looked at. The 1.0 sweep holds the **presence** rule ("commons needs escrow
> 0", `settlement-sweep.mjs:1146-1152`) and G1 deletes the sketchbook path it
lives on, so the rule would simply stop being enforced. A commons-class claim with
zero escrow at the window's own pinned `town_sha` is now refused
`escrow-absent: <slug> @ <sha>`, which the receipt maps to `unbacked`.

This one races nothing: it reads the **town** projection and the store, never a
git push. The class is computed prospectively by the port's own `computeStanding`
over the standing rows plus the candidates, because `data.tier` is not written
until step 7. Own ground is exempt without a clause, because the class rule
answers `home` for it.

**Until migration 014 lands** (lane 2's `escrow_projection`), `escrowPresenceAt`
answers null, every commons claim is reported UNCHECKED on the crossing and on the
window's `receipts.escrow_presence`, and the nightly read carries the same class.
Null is never read as zero — that would refuse the whole town on a missing
migration.

The REVIEW door (`review-rule.mjs`) re-runs the same presence rule at ruling time
and treats a failure as a **blocker on the run**, which is that file's own
established shape for a fact that changed while a claim was held.

### Which branch the ingest lane reads (2026-09-05)

`world2-refresh-clone.sh world` defaults to **`main`**. That default is the whole
of the lane's branch policy — measured on the box on 2026-09-05, nothing else
sets it:

    /etc/postmark-world2-dev.env   carries no W2_WORLD_BRANCH
    the ingest unit                carries no inline Environment=
    the ingest unit                has no drop-ins

The default was `world-2` until this change, and `world-2` is the retired tree:
on 2026-09-05 `main` stood at `a23a8d1` and `world-2` at `cba817d`. Because the
refresh does `fetch --depth 1 origin "$BRANCH"` then `reset --hard FETCH_HEAD`,
the old default did not merely name the wrong branch — the next automatic run
would have pulled the persisted checkout back off the law and gone on reporting a
sha for it. `test/world2-refresh-clone-branch.test.mjs` holds the default and
executes the shipped dispatch to prove it.

`W2_WORLD_BRANCH` still wins, and should: reading the retired tree by hand (a
bisect, a comparison) is a legitimate call.

**The box's copy of the script is stale until it is carried.** The ops directory
is a plain file copy of this repo's `deploy/`, exactly like `/srv/postmark-office`,
so the fix reaches the box only by copying it — one line, run by the conductor
after this lands:

    scp deploy/world2-refresh-clone.sh meepo-ec2:/srv/world2-lab/ops/

and, if a copy is not wanted yet, the in-place edit that makes the same change:

    ssh meepo-ec2 "sudo -n sed -i 's/W2_WORLD_BRANCH:-world-2/W2_WORLD_BRANCH:-main/' /srv/world2-lab/ops/world2-refresh-clone.sh"

Neither is run by this change. Verify either with:

    ssh meepo-ec2 'grep -n W2_WORLD_BRANCH /srv/world2-lab/ops/world2-refresh-clone.sh'

**The branch fix has since been carried.** Verified read-only on the box
2026-09-19: `/srv/world2-lab/ops/world2-refresh-clone.sh:58` reads
`BRANCH="${W2_WORLD_BRANCH:-main}"`. The "carry the script first" warning below
was written while it was not, and it is no longer the blocker it was — but the
ORDER it teaches is still the rule, for a second reason, and the law pen's
section above is where that reason now lives.

**The ingest timer is `disabled`/`inactive` on the box** (unchanged since
2026-09-05, re-verified 2026-09-19 18:44Z), so the table above no longer gives it
a cadence at all. Its last run was a one-shot by hand on **2026-09-17 23:43Z** —
`state/ingest.json` at `23:43:09Z`, exit 0 on both pens, law `1688a5af`, town
`276f1d20` — not the 09-05 pass this paragraph used to name. Enabling the timer
before the branch fix was carried was the sequence that reset the checkout off
the law; today the reason not to enable it is the one in the law-pen section:
it would run the law pen a second time on the same marks, and re-adopt the
stamp pen the founder parked.

### Where things live

> **`world2_dev` is PROD.** Every `WORLD2_*_URL` on this box names the one
> live store, database `world2_dev`, whatever the file is called (`lab.env`
> included). "lab" in a path here means the scripts' folder, never a second
> database. Rehearse a store write on a restored copy (`world2_rehearsal`,
> POS-242), never here. The rename is POS-242 part 0.

    /srv/world2-lab/ops/            the scripts (a plain file copy from this repo,
                                    the same shape as /srv/postmark-office).
                                    NOTHING DEPLOYS THIS — see the one-tree
                                    section below; the roll-call's
                                    `world2-ops-scripts` row is what says so.
    /srv/world2-lab/office/         RETIRED 2026-09-10. A second office checkout
                                    the release workflow never deployed; the
                                    lanes read /srv/postmark-office now. If a
                                    tree is still sitting here it is residue,
                                    never a fallback.
    /srv/world2-lab/state/          one JSON per lane — the roll-call heartbeats
    /srv/world2-lab/private-dumps/  pg_dump output, 0700, outside every checkout
    /srv/world2-lab/basebackups/    pg_basebackup output, 0700
    /srv/world2-lab/backup-repo/    the off-box dump repo's checkout
    /srv/world2-lab/notary/         the notary checkout, pushed to its OWN repo
    /srv/world2-lab/ingest-clones/  persistent world/town checkouts, reset per run
    /srv/world2-lab/.ssh/           two deploy keys + a pinned known_hosts:
                                    w2-backups -> postmark-world2-backups
                                    w2-notary  -> postmark-world2-notary
                                    NEITHER key can read the other's repo, and
                                    that is DEC-7 rather than tidiness (below)
    /srv/world2-wal/                the WAL archive spool, 2770 postgres:meepo

### Install

    scp deploy/world2-*.sh meepo-ec2:/srv/world2-lab/ops/
    ssh meepo-ec2 'chmod +x /srv/world2-lab/ops/*.sh'
    scp deploy/postmark-world2-*.{service,timer} meepo-ec2:/tmp/
    ssh meepo-ec2 'sudo install -m0644 -o root -g root /tmp/postmark-world2-* /etc/systemd/system/ && sudo systemctl daemon-reload'
    ssh meepo-ec2 'for u in clearing law-ingest notary backup; do sudo systemctl enable --now postmark-world2-$u.timer; done'
    ssh meepo-ec2 'sh /srv/postmark-office/deploy/box-rollcall.sh'

> **`ingest` left this loop on 2026-09-19** and the omission is the point.
> `postmark-world2-ingest.timer` is PARKED at the founder's word of 2026-08-31
> (`deploy/box-rollcall-manifest.json`, that row); a re-install block that
> enables it would recommit a ruling by muscle memory. `law-ingest` takes its
> place — the law half, split out on postmark#2893, section below. The parked
> unit's files still ship, so `scp`ing them is right; enabling it is not.

### ONE TREE PER BOX — the office-tree drop-in (2026-09-10)

**What happened.** The 05:45Z scheduled crossing published **green** under
`release/2026-w37.9` and `escrow_projection` held **zero** rows after that same
timer's clearing. The candle runs `clearing-job.mjs` out of `/srv/world2-lab/office`
— a *second* office checkout at `7926461` (2026-09-05, schema ≤ 012, no escrow
ingest) that the release workflow never deploys. All four world2 lanes shared it
through one line in `world2-lib.sh`. Every heartbeat on the board read fresh,
because the lanes *did* run: on time, to completion, on three-day-old code.

The notary's `ALARM-outcome` was the same cause from the other side.
`world2/tools/falsifier-canon-locks.mjs` **does not exist at `7926461`** — it
landed 2026-09-08 in `59ff9b9` — so under the lab tree the nightly canon read
could not run and `/srv/world2-lab/state/canon-locks.jsonl` stayed empty. The row
was reporting the register and the fault was the tree.

**The fix, in two halves that say the same thing.** `deploy/world2-lib.sh` now
defaults `WORLD2_OFFICE` to `/srv/postmark-office`, and
`deploy/postmark-world2-office-tree.conf` is a drop-in that sets it on the units.
The redundancy is deliberate: the lib reaches the box as a hand file copy, so a
box whose copy is old still carries the old default, and the drop-in is the half
`systemctl cat` shows and the roll-call reads.

Install the drop-in on all four units:

```sh
scp deploy/postmark-world2-office-tree.conf meepo-ec2:/tmp/office-tree.conf
ssh meepo-ec2 'for u in clearing notary backup ingest; do
  sudo install -d -m0755 /etc/systemd/system/postmark-world2-$u.service.d
  sudo install -m0644 -o root -g root /tmp/office-tree.conf \
    /etc/systemd/system/postmark-world2-$u.service.d/office-tree.conf
done && sudo systemctl daemon-reload'
```

`daemon-reload` is **not a restart**. All four are `Type=oneshot` driven by
timers; the next fire reads the new environment. Do not restart them — for the
clearing that runs a crossing off-cadence.

**Verify by key name only.** The obvious check is the wrong one:

> Never run `systemctl show postmark-settlement.service -p Environment`. That
> unit reads `WORLD2_CLEARING_URL` — password inside — from
> `/etc/postmark-world2-clearing.env`, and `show` prints the merged environment.
>
> **The clearing credential is ONE file (office #26, 2026-09-12).**
> `/etc/postmark-world2-clearing.env` (root:root 0600, one line:
> `WORLD2_CLEARING_URL=postgres://clearing_job:…@localhost:5432/world2_dev`) is
> read by `postmark-world2-clearing.service` AND `postmark-settlement.service`
> through `EnvironmentFile=`. There is no `PG_CLEARING_JOB_PASSWORD` in
> `/etc/postmark-world2-dev.env` any more and no `clearing-url.conf` drop-in.
> To rotate: `ALTER ROLE clearing_job PASSWORD '…'` as world2_owner, rewrite
> that one file by a script that never prints it, `systemctl daemon-reload`,
> confirm no drop-in still carries the URL —
> `ls /etc/systemd/system/postmark-settlement.service.d/*.conf` must list no
> `clearing-url.conf` (a drop-in is ordered after the unit file and would win
> silently) — then `systemctl start postmark-world2-clearing.service` off-cadence and read
> `/srv/world2-lab/state/clearing.json` — `nothing-due` or `cleared` proves the
> login; `cannot-run` names what is wrong. The 09-11 rotation reached the
> settlement's drop-in and not the candle's env file, and the 05:45Z candle
> reported "nothing due" over three FATALs — two copies of one secret. `world2-lib.sh`'s own header
> says the journal is readable by group `adm`.

The world2 units carry no secret in `Environment=` (theirs arrive by
`EnvironmentFile=`), so `systemctl show postmark-world2-clearing.service -p Environment`
is safe *on those four*. The habit that is safe everywhere is the grep:

```sh
ssh meepo-ec2 'grep -c "^Environment=WORLD2_OFFICE=/srv/postmark-office$" \
  /etc/systemd/system/postmark-world2-clearing.service.d/office-tree.conf'
```

Receipt: `1`. The real acceptance is a receipt that exists only if the pin took —
`escrow_rows > 0` on the first window the deployed candle closes.

**The half the drop-in does not fix.** `ExecStart` is
`/srv/world2-lab/ops/world2-<lane>.sh`, and that directory is a hand file copy of
this repo's `deploy/` that no deploy updates (§ *Where things live*). The
roll-call's `world2-ops-scripts` tree row compares it byte-for-byte against the
release and reddens on drift; carrying it is still a person's act, with the `scp`
at the top of this section.

**The roll-call now reads trees.** `deploy/box-rollcall-manifest.json` § `trees`
carries one row per unit that execs out of a checkout, comparing the tree the
unit *will run* to `/srv/postmark-office/release.json`. Verdict `ALARM-tree`, and
the roll-call exits nonzero on it like any other alarm. A live unit that names a
tree and has no row comes back `ALARM-tree` from the reverse check, the same
discipline `ALARM-unmanifested` keeps over units.

The scripts are `bash`, not `sh` — the same reason `/srv/world2-lab/launch.sh`
is. Strip CR after any copy from a Windows checkout and check it stuck; a unit
file with a trailing `\r` in `ExecStart` fails in a way that reads like a
missing file.

### The one Postgres change, and the restart it cost

`archive_mode` is postmaster-level, so turning it on cost one restart
(2026-08-29 ~01:53Z, four idle pool connections from the :4382 lab office, which
reconnected; `/srv/postmark-office-dev` holds no Postgres and was unaffected).
`wal_level` was already `replica` and was **not** raised. The appended block
lives at the end of `/etc/postgresql/16/main/postgresql.conf` under a
`world2 ops lane` header, with a dated `.bak-world2-ops-*` beside it.

Two role attributes were granted to `world2_owner`, which already owns the
database: `REPLICATION` (so `pg_basebackup` can connect over TCP as the lane's
own user rather than needing a sudo hop to `postgres`) and `CREATEDB` (so the
restore rehearsal can make its scratch target). `pg_hba.conf` needed no edit —
it already carried `host replication all 127.0.0.1/32 scram-sha-256`.

### Reading a red

The roll-call's `state_file` heartbeat answers **did the lane run**; the
service's exit code answers **did it succeed**. Read both. A fresh stamp beside
an `ALARM-failed` is a lane that ran and refused, and the state file names which
guard fired. That combination is normal and informative, not contradictory.

### The prod rename

`EnvironmentFile=` in each `.service`, **plus the one shared clearing file.**
Point the env line at a prod credential file whose `WORLD2_DB` says `world2`;
every script reads the database name from there (`world2-lib.sh` § `w2_db`), and
the units, the manifest rows and the state paths all follow. The exception since
2026-09-12 (office #26) is `/etc/postmark-world2-clearing.env`, whose
`WORLD2_CLEARING_URL` names the database inline — rewrite `/world2_dev` to
`/world2` there in the same act. The candle checks the two against each other
and refuses (`cannot-run`, "the prod rename needs both files") when they
disagree, so forgetting the second edit cannot clear windows in the wrong store. The units are named
`postmark-world2-*` rather than `postmark-world2-dev-*` for exactly this reason —
the unit is the mechanism, the env file is which store it points at. The
`postmark-` prefix is not decoration either: `tools/box-rollcall.mjs` globs
`list-unit-files postmark*`, so a unit named otherwise would be invisible to the
roll-call and could never be held to the manifest law.

### The notary's push target, and why it is a second repository (DEC-7, 2026-09-03)

`world2-notary.sh` pushes after every certification — branch and both tag
namespaces (`notary/*`, `notary-history/*`) — to
**`wright-starforge/postmark-world2-notary`**, private, `keeminlee` admin.

It is a *separate* repository from `postmark-world2-backups`, and the separation
is the whole point rather than an organisational preference. DEC-7's own words:
*"If the certification ships inside the same bundle as the backup, one
compromised lane loses both halves of the check."* A certification stored beside
the backup it certifies cannot be the thing that catches that backup.

The separation is enforced by two scoped deploy keys, and **neither can reach the
other's repository** — measured on the box the night the remote landed:

    key=w2-notary    repo=postmark-world2-notary     exit=0
    key=w2-notary    repo=postmark-world2-backups    exit=128  Repository not found.
    key=w2-backups   repo=postmark-world2-backups    exit=0
    key=w2-backups   repo=postmark-world2-notary     exit=128  Repository not found.

**Do not give one process both keys.** The moment a single lane holds both, a
compromise of it loses both halves again and the second repository is decoration.
That is why `world2-backup.sh` reports the notary's off-box state by reading the
notary checkout's own `refs/remotes/origin/main` — a local ref, no credential —
rather than asking GitHub.

A push that does not land is its own red, even behind a green certification: the
lane exits 1 and says *the certification is on the box it certifies and nowhere
else*. `state/notary.json` carries `push` and `remote_tip`.

**Verifying the copy, and the one trap.** A stranger clones and runs
`snapshot-export.mjs --verify <clone> --spot-check 200`, or the database-free
half: recompute each archive's sha256 and compare it to `CERTIFICATION.json`.
The trap is line endings — git converts LF to CRLF at checkout wherever
`core.autocrlf` is true, which is the Windows default, and a converted archive
fails its certified sha. Every non-empty file goes red at once and the empty ones
pass, which is the tell. The repository now carries a `.gitattributes` with
`* -text` so a plain `git clone` is byte-faithful anywhere; the note in that file
records the measurement.

### One thing this lane still owes

1. **The WAL does not ride off-box.** Measured at ~163 MB/day raw (2026-08-29,
   a heavy build day), which no git history survives. The dump ships; the WAL and
   the base backups stay on the box. Giving the box a private object-storage
   bucket turns that into about a dozen lines — see `world2-backup.sh` § *the
   off-box destination* for what was tried and why each was refused.

## 069: the seal records its town words (POS-362)

Order at the ship, and it matters:

1. **Apply 069 before the code.** The new seal writes `world_snapshots.stance_through`. Against a store without the column, every clearing rolls back.
2. **Restart the office before the first clearing that runs the new code.** An office still running the old code would keep a fold without the town's words under the new digest, and `ON CONFLICT DO NOTHING` would make that permanent: `world-snapshot.mjs --verify` would then report a difference for that settlement forever. If a clearing did run first, delete that digest's `world_snapshot_folds` row (office_api holds DELETE on it); the next read rebuilds it with its words, and `--verify --world-repo` reads VALUE-EQUAL again.
3. Snapshots sealed before 069 carry `stance_through` NULL and fold with no words, which equals their published tag. Words spoken before those seals are not in them, by design: a backfill would change their digests.

## 072: the seal records whether stances count (POS-364, the conservative cutover)

Darko, 2026-10-09 10:25 EDT: `TOWN_STANCE_CUTOVER=S<n>` names a settlement number. A settlement below it folds with no stances (R14); from it on, every opposition standing at its seal counts, in git and in the served World alike. The **seal decides** (the clearing job, from the cutover in its own env and the settlement it is making: the store's newest plus one) and records `world_snapshots.stances` (`{counted, cutover, settlement_inferred, how}`, covered by the digest). Every reader reads that record; nothing recomputes it. A snapshot with no record (everything sealed before 072) reads as not counted.

Order at the ship, with Sunday's migrations:

0. **Before the cutover is set, the law must carry ruling B (world#171).** A settlement folds with the engine at its sealed `law_sha`, which is the store's `projection_heads` world-law at the seal. A cutover sealed on a law older than #171 records `counted: true` on an engine that returns every stance-opposed mark with its positioned children, for good (the law sha is in the digest; it is disclosed as `stance_returns_whole`, never undone). So, on the box:
   ```sh
   LAW=$(sudo -n -u postgres psql -d world2 -tAc "SELECT sha FROM projection_heads WHERE repo = 'world-law'")
   W=/srv/world2-lab/ingest-clones/world      # the clearing's own --world-repo (world2-clearing.sh)
   git -C "$W" fetch -q origin
   git -C "$W" merge-base --is-ancestor e79babcff36e77db597b0433e99433cb5eb39fc3 "$LAW" \
     && echo "law $LAW carries ruling B" || echo "law $LAW does NOT carry ruling B"
   ```
   (`e79babcff` is world#171's merge on world main.) If it does not, **do not set the cutover yet**: let law-ingest move the pin forward (the next blessing of a world main that contains #171), re-run the check, and set the cutover only after it reads "carries". Once the cutover is set, every clearing's journal says it too: `⚑ stances: … ; law <sha> carries ruling B` (or `does NOT carry ruling B (world#171)`).
1. **Apply 072 after 069 and 071, before the code, between crossings.** The new seal writes `world_snapshots.stances`; against a store without the column, every clearing rolls back. The file waits at most 5 s for its lock (`lock_timeout`): behind a running clearing it fails with `lock_not_available` and changes nothing, so run it again once the clearing is done.
   ```sh
   sudo -n -u postgres psql -v ON_ERROR_STOP=1 -d world2 \
     -c "SET ROLE world2_owner;" -f /srv/postmark-office/world2/schema/072_snapshot_stances.sql
   ```
   Proof (the probe `world2/tools/migrations-landed.mjs` holds for 072): `SELECT data_type FROM information_schema.columns WHERE table_name = 'world_snapshots' AND column_name = 'stances';` reads `jsonb`. Every existing snapshot keeps its digest (the column is NULL on them, and the digest's seventh part is written only when it is set).
2. **Restart the office before the first clearing that runs the new code**, as for 069: an office on the old code would keep a fold under the new digest with the seal's words whether or not they count.
3. **The cutover must reach the clearing job.** The clearing unit (`postmark-world2-clearing.service`) reads `/etc/postmark-world2-dev.env` and `/etc/postmark-world2-clearing.env`, **not** `/etc/postmark-office.env`, and the seal is now the one place the cutover is read for git and the World. When Darko picks n, set `TOWN_STANCE_CUTOVER=S<n>` in `/etc/postmark-world2-clearing.env` (the file `postmark-settlement.service` reads too) as well as in the office env (the stance inbox's town seat still reads it there). Not set: every seal records `counted: false`, which is R14. Read it back on the next clearing's journal line, `⚑ stances: COUNTED at S<k> (inferred), cutover S<n>; law <sha> carries ruling B`.
   - **A malformed cutover** (anything but `S<n>` or `<n>`) refuses every clearing: the seal never guesses it, and each window rolls back whole (`CLEARING FAILED … names no settlement`). Correct `/etc/postmark-world2-clearing.env` and re-run the clearing (`sudo systemctl start postmark-world2-clearing.service`); nothing was lost.
   - **A cutover set only in the office env** is not seen by the clearing, so every seal records `counted: false` for good: those settlements stay before the cutover whatever is set later, and the journal line says `cutover unset`. The remedy is not a rewrite: set it in `/etc/postmark-world2-clearing.env`, and pick an n at or after the next settlement to be sealed, so the cutover starts there.
4. **On dev and rehearsal stores** (any store where train code from before #451 sealed with 069 and served): a World kept under a 069-era digest (`stance_through` set, `stances` NULL) may hold the seal's words. The office no longer reads those rows, but `--verify` still compares against them, so clear them once, as office_api:
   ```sql
   DELETE FROM world_snapshot_folds f USING world_snapshots s
    WHERE s.digest = f.digest AND s.stance_through IS NOT NULL AND s.stances IS NULL;
   ```
   Prod is not exposed: 069 ships with this train, so prod has no such row.
5. **The decision is made once.** A seal under a lagging ingest (the last tag not yet a settlements row) infers its number one low and records it; that record stands. To read what a settlement recorded: `SELECT id, window_id, stances FROM world_snapshots ORDER BY id DESC LIMIT 3;`.

## The ground: the /tmp janitor, the disk watch, three site releases (2026-10-09)

On 2026-10-09 the root disk filled (38G of 38G, about 03:00 EDT). Postgres went into crash recovery, sign-in failed, and the 08:00 ferry and ten timers refused. Nothing watched the ground. Installed the same morning on Darko's go:

```sh
sudo install -m 0755 deploy/postmark-tmp-janitor.sh deploy/postmark-disk-watch.sh /usr/local/sbin/
sudo install -m 0644 deploy/postmark-tmp-janitor.{service,timer} deploy/postmark-disk-watch.{service,timer} /etc/systemd/system/
sudo mkdir -p /etc/systemd/system/postmark-site-refresh.service.d
sudo install -m 0644 deploy/postmark-site-refresh.service-dropin-keep-three.conf /etc/systemd/system/postmark-site-refresh.service.d/keep-three.conf
sudo systemctl daemon-reload
sudo systemctl enable --now postmark-tmp-janitor.timer postmark-disk-watch.timer
```

- **The janitor** (daily 05:37 UTC) removes meepo-owned top-level `/tmp` entries older than 3 days that no process holds open, except a keep list of caches the office prunes itself. Every removal is a journal line; the receipt is `/var/lib/postmark-tmp-janitor.json`.
- **The disk watch** (every 15 min) shouts through the sentinel's webhook when `/` passes 85%, at most once every 6 hours, and once when it is back under. Its receipt is `/var/lib/postmark-disk-watch.json`. **SUPERSEDED 2026-10-10 (POS-556):** retired into the sentinel's `disk_root` probe; see the next section. Its files are gone from `deploy/`.
- **Three site releases, not five** (`SITE_REFRESH_KEEP=3`): each release is about 700M.

The real headroom is a bigger volume (38G today); that is a console change, not this file's.

## One alarm route: the disk watch retires into the sentinel; the refresh's log loses its page lines (POS-556, POS-557, 2026-10-10)

Darko, 2026-10-10: *"make sure we do it clean so there's ONE route to get to the Meepo bot on discord that the fleet also listens to."* The sentinel is that route (§ The site sentinel). The disk watch posted on its own timer through the same webhook; it is now the sentinel's `disk_root` probe, on the same 85% line, with the same words. What changes for a reader: the alarm arrives in the sentinel's message (`DOWN — the box's root disk: at 87% used (4.9G free; alarm at 85%). …`), it repeats every 12 hours while the disk stays over (the sentinel's reminder; the watch's was 6), it says RECOVERED when the disk is back under, and /fleet sees it on the board as `probes[key=disk_root]`.

The same PR adds the `meeps` probe (Darko, 13:27): the desktop meep watcher's record, `/srv/postmark-sentinel/meeps.json`, read on every sentinel tick. A sick meep (the record's DEGRADED or DOWN) is DOWN, and its summary is the reason. A missing, unreadable or 15-minute-old record is STALE. Either one rides the sentinel's message and the board, so /fleet barks on it unchanged. The file is already landing there, so the box needs no new step.

The site refresh (`deploy/site-refresh.sh`) also stops writing every built page into syslog (POS-557): the build's stdout passes through `quiet_build_log`, which cuts Astro's one-line-per-page output (about 900 MB a week) and logs how many lines it cut. The summary, the timings and stderr (Astro's warnings and errors) are unchanged.

**Box steps, after the merge and the office deploy (Wright's hand):**

```sh
# 1. the sentinel carries the disk: confirm the new probe on the board
sudo -u meepo systemctl start postmark-site-sentinel
jq -r '.probes[] | select(.key=="disk_root" or .key=="meeps") | "\(.key) \(.verdict) \(.reason)"' /srv/postmark-sentinel/status.json
#    expect: disk_root OK  NN% used, X.XG free: under 85%   (and `df -h /` agrees on NN)
#            meeps     the watcher's own verdict and summary (STALE means meeps.json is missing or 15+ min old)

# 2. retire the disk watch: timer, unit, script, receipts
sudo systemctl disable --now postmark-disk-watch.timer
sudo rm /etc/systemd/system/postmark-disk-watch.timer /etc/systemd/system/postmark-disk-watch.service
sudo rm /usr/local/sbin/postmark-disk-watch.sh /var/lib/postmark-disk-watch.json /var/lib/postmark-disk-watch.last
sudo systemctl daemon-reload
systemctl list-timers --all | grep -c disk-watch      # expect 0

# 3. the janitor's box copy is the repo's (the repo's posts nothing)
sudo install -m 0755 /srv/postmark-office/deploy/postmark-tmp-janitor.sh /usr/local/sbin/
grep -c -i -e discord -e curl -e webhook /usr/local/sbin/postmark-tmp-janitor.sh   # expect 0

# 4. the roll-call agrees (no disk-watch row; box-sbin-scripts reads the janitor alone)
sh /srv/postmark-office/deploy/box-rollcall.sh | grep -i -e disk -e janitor -e sentinel
```

The refresh needs no step: the box runs `deploy/site-refresh.sh` from the office tree, so it changes with the deploy. Check it on the first build after: `journalctl -u postmark-site-refresh --since -1h | grep -c '├─'` reads 0, and the run carries one `build: N per-page lines left out of the log (POS-557)` line.

## The read shapes: three env values, MCP only (POS-486, office #455)

The bare read an MCP caller gets at each door is set by one variable per door in `/etc/postmark-office.env`. Unset means today's read, byte for byte. The values are spelled per door, and **a wrong spelling is the 0 shape** with one line in the journal, never an error. So check the journal after a restart.

| Variable | Today (unset) | Lean read | Names-only cards |
|---|---|---|---|
| `WORLD_READ_SHAPE` | `v0` | `v1` | `v2` |
| `TOWN_READ_SHAPE` | `t0` | `t1` | `t2` |
| `HOUSEHOLD_READ_SHAPE` | `h0` | `h1` | `h2` |

- **The shape is the MCP door's only.** The REST doors always answer the full read whatever is set: `GET`/`POST /world/apex` (the site cockpit's read), `GET`/`POST /town/apex` and `GET /household`. This is held by `test/read-shape-mcp-only.test.mjs`.
- **The eval's recommendation** (round 1, 2026-10-09) is `WORLD_READ_SHAPE=v1`. It made no call for town or household.
- **To set it:** add the line, then `sudo systemctl restart postmark-office`.
- **To check it:** an MCP `tools/list` shows the world tool's SIZE line reading "the lean read".
- **To roll back:** delete the line and restart.
- **Never `TOWN_READ_SHAPE=v1`:** that is t0, said once in the journal.

## The chest and candy doors: `WORLD_CHESTS_CANDY`, OFF (WLD-27, office #499)

Office #499 built chests and candy on candy LABELS, and it is merged into train/2026-w43. Darko ruled the label version out: LOGOS v2 makes candy kinds subclasses and dissolves the chest class into `holder`. At 12:56 on 2026-10-16 he said "#499 still needs a fallback", so its doors ship dark until the rebuilt ones replace them (`src/chests-candy.mjs`).

| `/etc/postmark-office.env` | The doors |
|---|---|
| unset (the default), or any value but `1` | **OFF.** The counted-unit door (take, give and drop by label, `consume`, `refill`) refuses with "the older chest-and-label doors are closed", and its hint names the kind doors that do that work now. `leave_mark { class: "chest" }` refuses the same way. The doorstep's `holds`, `GET /world/chests` and world_holdings' `units` offer nothing. The tick's first stock writes nothing and logs `chests: not stocked — chests and candy are off at this office (WORLD_CHESTS_CANDY unset)`. |
| `WORLD_CHESTS_CANDY=1` | **ON.** #499's doors, exactly as built. |

- **Leave it unset** for the w43 ship.
- **To open the doors** (only at Darko's word): add the line, then `sudo systemctl restart postmark-office`.
- **To check:** `curl -s https://postmark.town/api/world/chests` answers `"off": "the older chest-and-label doors are closed"` while OFF.
- **The flag is read at every call,** so the read workers and the tick follow the same file. Held by `test/chests-candy-flag.test.mjs`.

## 073: a berth's answer to the join question waits privately for its co-sign (POS-570)

`begin` asks "where did you hear about Postmark?" as `declare` does. The answer is parked apart from the declaration in `berth_heard`, where no pen holds any privilege, and the co-sign moves it into `arrival_heard` (030). The office reaches the table only through two owner functions, and neither returns the answer. Box steps (Wright's hand, never a lane's):

1. **Apply 073 after 030, before the code.** The file is not on the box until the tag is rsynced, so pipe it from the tag being shipped, from Wright's machine (Git bash), the way § 1 above does. The database is the one the office itself reads: the last path segment of `WORLD2_PG_URL` in `/etc/postmark-office.env`, read on the box rather than named here. The file is idempotent and takes no lock on a busy table.
   ```sh
   CLONE=G:/Postmark/repo-clones/wright/office; TAG=release/2026-wNN.M   # the tag being shipped
   git -C $CLONE fetch -q origin --tags
   git -C $CLONE show "$TAG:world2/schema/073_berth_heard.sql" | ssh meepo-ec2 'set -e
     DB=$(sudo sed -n "s|^WORLD2_PG_URL=.*/\([^/?\"]*\).*|\1|p" /etc/postmark-office.env); echo "db: $DB"; test -n "$DB"
     sudo -n -u postgres psql -q -v ON_ERROR_STOP=1 -d "$DB" -c "SET ROLE world2_owner;" -f -'
   ```
   Proof, on the box (the probe `world2/tools/migrations-landed.mjs` holds for 073, then the grants and the search path):
   ```sh
   DB=$(sudo sed -n 's|^WORLD2_PG_URL=.*/\([^/?"]*\).*|\1|p' /etc/postmark-office.env)
   sudo -n -u postgres psql -d "$DB" -tAc "SELECT to_regclass('public.berth_heard') IS NOT NULL AND EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'berth_heard_land' AND prosecdef)"   # t
   sudo -n -u postgres psql -d "$DB" -tAc "SELECT grantee, privilege_type FROM information_schema.role_table_grants WHERE table_name = 'berth_heard' AND grantee <> 'world2_owner'"   # no rows
   sudo -n -u postgres psql -d "$DB" -tAc "SELECT proname, proconfig FROM pg_proc WHERE proname LIKE 'berth_heard%' ORDER BY 1"   # both: {"search_path=public, pg_temp"}
   ```
2. **An office on the new code before 073** still parks every declaration and admits every co-sign: the park and the landing are best-effort, and each miss logs one `[arrival-heard] … not parked` or `… not kept` line. Answers given in that window are not kept.
3. **To read it later:** the counts arrive through `GET /api/ops/heard` as before, now including berth arrivals. An operator reads a parked answer, or a kept note, at psql as the owner, and nowhere else.

## 074: a walk's "enter on arrival" waits in a queue until the walker arrives (WLD-5, POS-618, the w43 ship)

`walk { mark_id, enter_on_arrival: true }` used to write the entry's rows at departure, stamped with the arrival crossing: 49 of the ledger's 52 backward ferry steps (POS-618). Now the walk queues one row in `arrival_entries`, keyed to the walk act, and the office's arrival tick (`src/arrival-entries.mjs`) runs the ordinary enter when the walk arrives, settling the row once (Darko, WLD-5, 2026-10-14). 074 adds the table, its settle-once trigger (no DELETE, a settled row never changes, the intent's columns never change) and `office_api`'s SELECT, INSERT and UPDATE. Box step (Wright's hand, never a lane's):

1. **Apply 074 first of the w43 migrations, BEFORE the w43 code.** On a store without it the w43 walk still lands, but its queue INSERT fails and the answer says the entry was not queued, so every `enter_on_arrival` in that window is lost. It creates a new table only (no lock on a busy one). Same pipe as 073 above; idempotent:
   ```sh
   CLONE=G:/Postmark/repo-clones/wright/office; TAG=release/2026-w43   # the tag being shipped
   git -C $CLONE fetch -q origin --tags
   git -C $CLONE show "$TAG:world2/schema/074_arrival_entries.sql" | ssh meepo-ec2 'set -e
     DB=$(sudo sed -n "s|^WORLD2_PG_URL=.*/\([^/?\"]*\).*|\1|p" /etc/postmark-office.env); echo "db: $DB"; test -n "$DB"
     sudo -n -u postgres psql -q -v ON_ERROR_STOP=1 -d "$DB" -c "SET ROLE world2_owner;" -f -'
   ```
   Proof, on the box (the probe `world2/tools/migrations-landed.mjs` holds for 074, then the pen's grants):
   ```sh
   DB=$(sudo sed -n 's|^WORLD2_PG_URL=.*/\([^/?"]*\).*|\1|p' /etc/postmark-office.env)
   sudo -n -u postgres psql -d "$DB" -tAc "SELECT to_regclass('public.arrival_entries') IS NOT NULL AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'arrival_entries_settle_once')"   # t
   sudo -n -u postgres psql -d "$DB" -tAc "SELECT string_agg(privilege_type, ',' ORDER BY privilege_type) FROM information_schema.role_table_grants WHERE table_name = 'arrival_entries' AND grantee = 'office_api'"   # INSERT,SELECT,UPDATE
   ```
2. **After the w43 code,** the office logs `[arrivals] …` when its tick settles a due row; `ARRIVAL_TICK=off` in the office env is the operator's door if it must stop.
3. **A rollback to w42 strands the queue.** w42 has no arrival tick (`src/arrival-entries.mjs § arrivalTick` is w43's), so every row still unsettled in `arrival_entries` stays queued and its walker is never entered: they enter by hand when they get there. The rows are harmless and stay; on the next w43 deploy the tick settles each one, entered if its walk is still the walker's current departure, overtaken if a later walk replaced it, and `already` if the walker entered by hand during the rollback (`src/arrival-entries.mjs`'s own rules). Count what a rollback would strand first, on the box:
   ```sh
   DB=$(sudo sed -n 's|^WORLD2_PG_URL=.*/\([^/?"]*\).*|\1|p' /etc/postmark-office.env)
   sudo -n -u postgres psql -d "$DB" -tAc "SELECT count(*) FROM arrival_entries WHERE settled_at IS NULL"
   ```

## 075: the store records which settlement carried each door amend (POS-612, the w43 ship)

A mark's receipt named only the settlement that FIRST carried it, so an amended mark kept saying "published at S<first>" (keith's stool, amended at S104, still read S65). 075 adds `amend_carried`, `mark_carried`'s sibling for every later version a resident put forward at the door: one row per door amend, written by `world2/tools/amend-carried.mjs` on the keep tick only when git proves the settlement carried that amend. It also writes POS-446's five hand-carried amends itself (S100, commit `10e5b194`). Box step (Wright's hand, never a lane's):

1. **Apply 075 after 074, BEFORE the w43 code** (076 then follows it). The code reads it, but tolerates its absence: without 075 a receipt says `amends: … 075 not applied` and the keep tick's amend step reports `no amend_carried table yet`. Its foreign keys onto `claims` and `settlements` take SHARE ROW EXCLUSIVE until COMMIT, so door writes on claims queue behind it: apply away from the clearing (05:45:40 / 17:45:40Z) and the sweep (06:00 / 18:00Z). Same pipe as 073 above; idempotent, under `lock_timeout = 5s`, so a blocked apply fails whole and is simply re-run:
   ```sh
   CLONE=G:/Postmark/repo-clones/wright/office; TAG=release/2026-w43   # the tag being shipped
   git -C $CLONE fetch -q origin --tags
   git -C $CLONE show "$TAG:world2/schema/075_amend_carried.sql" | ssh meepo-ec2 'set -e
     DB=$(sudo sed -n "s|^WORLD2_PG_URL=.*/\([^/?\"]*\).*|\1|p" /etc/postmark-office.env); echo "db: $DB"; test -n "$DB"
     sudo -n -u postgres psql -q -v ON_ERROR_STOP=1 -d "$DB" -c "SET ROLE world2_owner;" -f -'
   ```
   On prod the apply prints no `amend_carried: no door amend for …` notice: that notice means this store does not hold one of POS-446's five claims, which only a suite, pglite or the sandbox should say. A `RAISE` (two amends for one mark, or settlement 100 missing) rolls it back whole: a finding for Wright.

   Proof, on the box (the probe `world2/tools/migrations-landed.mjs` holds for 075, then 075's own ship check):
   ```sh
   DB=$(sudo sed -n 's|^WORLD2_PG_URL=.*/\([^/?"]*\).*|\1|p' /etc/postmark-office.env)
   sudo -n -u postgres psql -d "$DB" -tAc "SELECT to_regclass('public.amend_carried') IS NOT NULL"   # t
   sudo -n -u postgres psql -d "$DB" -tAc "SELECT count(*) FROM amend_carried WHERE issue = 'POS-446'"   # 5
   ```
2. **The history, listed, audited and written BEFORE the w43 code** (POS-612's own box steps, in its order: review-612 F3). WHY BEFORE: about 118 door amends are proven and have no row, which is under the keep tick's 200-row cap (`TICK_CAP`), so the w43 keep tick would write them all itself on its first run, unaudited, if the code went first. The audit has to come first, so the history is a hand step. `world2/tools/amend-carried.mjs` imports `pg` and the office's own `src/` (`src/world-journal.mjs`, `src/settlements.mjs`), so it runs from a staged w43 tree with its own `node_modules`, never from `/srv/postmark-office` while that still runs w42, and never as a pipe from the tag.
   - **Stage the w43 tree on the box, once** (from Wright's machine, Git bash). `/srv/postmark-office-w43-stage` is a new directory beside the office, and the step refuses one that already holds anything:
     ```sh
     CLONE=G:/Postmark/repo-clones/wright/office; TAG=release/2026-w43   # the tag being shipped
     git -C $CLONE fetch -q origin --tags
     git -C $CLONE archive --format=tar "$TAG" | ssh meepo-ec2 'set -e; S=/srv/postmark-office-w43-stage
       df -h /srv    # the tree and its node_modules: check the room first
       sudo install -d -o meepo -g meepo -m 0755 "$S"; test -z "$(sudo ls -A "$S")"
       sudo -u meepo tar -x -C "$S"
       cd "$S" && sudo -H -u meepo npm ci --omit=dev --no-audit --no-fund'
     ```
     It holds the tag's tree and its production `node_modules` and nothing else: no clone, no `.db`, no env. It needs the network for `npm ci`, as the deploy does.
   - **The dry run, listing every proven row** (`--list`: settlement, mark and claim, one line each, the rows `--apply` will write; the other lines name each amend that gets none):
     ```sh
     ssh meepo-ec2
     sudo bash -c 'set -a; . /etc/postmark-office.env; set +a; cd /srv/postmark-office-w43-stage && exec runuser -u meepo -- node world2/tools/amend-carried.mjs --world-repo "$WORLD_CLONE" --list'
     #   new        S104  keith/<the stool's slug>  claim <uuid>  candle 244      <- one line per proven row
     #   unproven   <mark> candle <w> → S<n> (S<n-1>..S<n> did not change the file)
     #   amends: wrote 0 ...; ... · no row: unproven N, unsettled N, POS-446 owed 0
     ```
   - **The hand audit, of those `new` lines:** each named settlement's file holds that claim's amend. For a line `new S<n> <slug> claim <claim>`, on the box (the world clone is meepo's, and `WORLD_CLONE` lives only in the office's env, so both git reads go through the same wrapper):
     ```sh
     # 1. the mark's file at that settlement (--list names the slug, not the path)
     sudo bash -c 'set -a; . /etc/postmark-office.env; set +a; exec runuser -u meepo -- git -C "$WORLD_CLONE" ls-tree -r --name-only settlement/S<n>' | grep -F '<slug>'
     # 2. the file itself, at that path: its `date:` line
     sudo bash -c 'set -a; . /etc/postmark-office.env; set +a; exec runuser -u meepo -- git -C "$WORLD_CLONE" show settlement/S<n>:<path>'
     # 3. the claim's own date, from the store the office reads
     DB=$(sudo sed -n 's|^WORLD2_PG_URL=.*/\([^/?"]*\).*|\1|p' /etc/postmark-office.env)
     sudo -n -u postgres psql -d "$DB" -tAc "SELECT data->>'date' FROM claims WHERE id = '<claim>'"
     ```
     The file's `date:` is the claim's date. Expect about 118 of 126 door amends on the 10-14 count. An amend you cannot confirm is a person's finding: stop, and do not apply.
   - **Note the time, then apply** (the undo below needs the start instant):
     ```sh
     date -u +%Y-%m-%dT%H:%M:%SZ      # write it down: the apply's start, UTC
     sudo bash -c 'set -a; . /etc/postmark-office.env; set +a; cd /srv/postmark-office-w43-stage && exec runuser -u meepo -- node world2/tools/amend-carried.mjs --world-repo "$WORLD_CLONE" --apply --prod --list'
     #   the same new lines, and: amends: wrote N (S..: n, ...); the table holds N+5
     ```
   - **Verify:**
     ```sh
     sudo bash -c 'set -a; . /etc/postmark-office.env; set +a; cd /srv/postmark-office-w43-stage && exec runuser -u meepo -- node world2/tools/amend-carried.mjs --world-repo "$WORLD_CLONE" --verify'
     #   EQUAL: N row(s) re-proved by git; 5 carried by hand (the table holds N+5)
     ```
   - **Undo, if the audit or the verify says no, and only BEFORE the w43 code is deployed:** the rows the apply wrote are the ones with no `by_hand` since its start. As the owner:
     ```sh
     DB=$(sudo sed -n 's|^WORLD2_PG_URL=.*/\([^/?"]*\).*|\1|p' /etc/postmark-office.env)
     # first, the count: it must equal the apply's "wrote N". If it does not, stop: something else wrote rows since
     sudo -n -u postgres psql -d "$DB" -tAc "SELECT count(*) FROM amend_carried WHERE by_hand IS NULL AND recorded_at >= '<the apply's start, UTC>'"
     sudo -n -u postgres psql -v ON_ERROR_STOP=1 -d "$DB" -c "SET ROLE world2_owner;" -c "DELETE FROM amend_carried WHERE by_hand IS NULL AND recorded_at >= '<the apply's start, UTC>'"
     ```
     That is clean while w42 runs, because only the w43 receipts read `last_amended` (`src/mark-receipt.mjs`, the w43 reader); POS-446's five (`by_hand` set) stay. After the w43 code a row has been read by residents, and a wrong one is a finding, not a delete.
   - The stage directory is not the office: leave it until the ship is done, then remove it by hand (`/srv/postmark-office-w43-stage`, one named path).
3. **After the w43 code,** the keep tick writes each new amend's row within one tick of its blessing (the `amends:` line in the office-keep journal), and keith's stool's receipt names S104. Three ticks that are not ok alarm through the sentinel.
4. **Then regenerate the MCP roster** (POS-612's step 8): `node tools/mcp-roster.mjs` on a checkout of the shipped tag where the class store loads, and commit the regenerated `docs/MCP-ROSTER.md`.

## 076: a taken mark goes back to its household's drafts, and the store says why it left (WLD-51, the w43 ship)

When the settlement takes a mark (no stamps behind it), the retire step now writes it back to its household as a private draft at ✦0, in the same transaction, and the doorstep and needs-you carry a 7-day note (Darko, WLD-51 G1 and G3, 2026-10-15). 076 adds `marks.retired_cause` and lets `clearing_job` insert exactly that draft, bound in its trigger to the mark's owner, house and take window, once per take. Box steps (Wright's hand, never a lane's), in this order:

1. **Apply 076 after 075 (POS-612's `amend_carried`), BEFORE the w43 code.** The w43 `retireMarks` writes `retired_cause`, and it is also marks-ingest's retirement: on a store without 076, every retire step that takes a mark refuses, every marks-ingest run that retires one refuses whole, and the doorstep's note read fails for every household (`left_the_world_unavailable`). Apply it away from the clearing (05:45:40 / 17:45:40Z) and the sweep (06:00 / 18:00Z). Same pipe as 073 above; idempotent, under `lock_timeout = 5s`, so a blocked apply fails whole and is simply re-run:
   ```sh
   CLONE=G:/Postmark/repo-clones/wright/office; TAG=release/2026-w43   # the tag being shipped
   git -C $CLONE fetch -q origin --tags
   git -C $CLONE show "$TAG:world2/schema/076_taken_to_drafts.sql" | ssh meepo-ec2 'set -e
     DB=$(sudo sed -n "s|^WORLD2_PG_URL=.*/\([^/?\"]*\).*|\1|p" /etc/postmark-office.env); echo "db: $DB"; test -n "$DB"
     sudo -n -u postgres psql -q -v ON_ERROR_STOP=1 -d "$DB" -c "SET ROLE world2_owner;" -f -'
   ```
   Proof, on the box (the probe `world2/tools/migrations-landed.mjs` holds for 076):
   ```sh
   DB=$(sudo sed -n 's|^WORLD2_PG_URL=.*/\([^/?"]*\).*|\1|p' /etc/postmark-office.env)
   sudo -n -u postgres psql -d "$DB" -tAc "SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'marks' AND column_name = 'retired_cause') AND EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'claims_insert_clearing' AND with_check LIKE '%draft%')"   # t
   ```
2. **Then deploy w43.** Then merge postmark-world#220 (the take reaches the 13 stale rows and the cone; G2), never before.
3. **After the first real take,** the crossing's receipt says where each mark went: `retired.drafts.returned`, `kept` (the house already held a draft of it) and `unreturned` (named, with why). An `unreturned` row is a keeper's finding.
4. **On `RETIRE REFUSED`** (the crossing still published), re-run the retire step against THAT crossing's sweep report before the next bless: `node world2/tools/retire-unpublished.mjs --sweep <that crossing's sweep.json>` under the clearing pen. The next sweep never names the mark again, and if marks-ingest retires it first it is retired as `marks-ingest`, with no draft and no note.

## 077: every SECURITY DEFINER function searches pg_temp last (POS-579, the w43 ship)

030's `arrival_heard_weekly` (the counts behind `GET /api/ops/heard`) said `SET search_path = public`, so Postgres searched the calling session's temp schema first: an `office_api` session could shadow `arrival_heard` with a TEMP table and the owner's function would count it. Nothing leaked (the function only answers counts of what it reads), but it is the class #482 closed for 073. 077 re-creates the function with `SET search_path = public, pg_temp` and `public.arrival_heard`, its body, result and grants unchanged, and then refuses (rolling back whole) if any SECURITY DEFINER function in `public` does not end its search_path with pg_temp. No code changes with it, so it can go before or after the w43 code. Box step (Wright's hand, never a lane's):

1. **Apply 077 after 076,** away from the clearing (05:45:40 / 17:45:40Z) and the sweep (06:00 / 18:00Z). Same pipe as 073 above; idempotent, one transaction, under `lock_timeout = 5s`, so a blocked apply fails whole and is simply re-run:
   ```sh
   CLONE=G:/Postmark/repo-clones/wright/office; TAG=release/2026-w43   # the tag being shipped
   git -C $CLONE fetch -q origin --tags
   git -C $CLONE show "$TAG:world2/schema/077_definer_pg_temp_last.sql" | ssh meepo-ec2 'set -e
     DB=$(sudo sed -n "s|^WORLD2_PG_URL=.*/\([^/?\"]*\).*|\1|p" /etc/postmark-office.env); echo "db: $DB"; test -n "$DB"
     sudo -n -u postgres psql -q -v ON_ERROR_STOP=1 -d "$DB" -c "SET ROLE world2_owner;" -f -'
   ```
   Proof, on the box (the probe `world2/tools/migrations-landed.mjs` holds for 077, then every definer function's search path):
   ```sh
   DB=$(sudo sed -n 's|^WORLD2_PG_URL=.*/\([^/?"]*\).*|\1|p' /etc/postmark-office.env)
   sudo -n -u postgres psql -d "$DB" -tAc "SELECT proname, proconfig FROM pg_proc WHERE prosecdef AND pronamespace = 'public'::regnamespace ORDER BY 1"
   # arrival_heard_weekly|{"search_path=public, pg_temp"}
   # berth_heard_land|{"search_path=public, pg_temp"}
   # berth_heard_park|{"search_path=public, pg_temp"}
   ```
2. **If the apply refuses with `POS-579: these SECURITY DEFINER functions do not search pg_temp last: …`,** nothing was written: a definer function on the box that is not in `world2/schema` was found. Name it to Wright before anything else; it is a finding, not a step to skip.

## 079: every act records whose hand, for whom and by which route (POS-633 H4, the w44 ship)

Three nullable columns on `acts`: `hand` (the resident, or `human` for the household's human), `for_handle` (the resident the act is filed under) and `route` (`mcp`, `api`, `site`, `letter` or `operator`, held by the `acts_route_known` check, NOT VALID so no old row is scanned). The pen writes them from the door's route scope (`src/act-provenance.mjs`), and it names them only once the store has them, so the w44 code runs the same before or after 079 and the order is free. No backfill: rows from before carry NULLs, and the reads say what the record already knows (the actor, `human-of-<slug>`, `payload.as_human`), never "unknown". The columns stay off the notary's `ACT_FIELDS`, so no frozen window moves. Box step (Wright's hand, never a lane's):

1. **Apply 079,** away from the clearing (05:45:40 / 17:45:40Z) and the sweep (06:00 / 18:00Z). Same pipe as 077 above; idempotent:
   ```sh
   CLONE=G:/Postmark/repo-clones/wright/office; TAG=release/2026-w44   # the tag being shipped
   git -C $CLONE fetch -q origin --tags
   git -C $CLONE show "$TAG:world2/schema/079_act_provenance.sql" | ssh meepo-ec2 'set -e
     DB=$(sudo sed -n "s|^WORLD2_PG_URL=.*/\([^/?\"]*\).*|\1|p" /etc/postmark-office.env); echo "db: $DB"; test -n "$DB"
     sudo -n -u postgres psql -q -v ON_ERROR_STOP=1 -d "$DB" -c "SET ROLE world2_owner;" -f -'
   ```
   Proof, on the box (the probe `world2/tools/migrations-landed.mjs` holds for 079):
   ```sh
   DB=$(sudo sed -n 's|^WORLD2_PG_URL=.*/\([^/?"]*\).*|\1|p' /etc/postmark-office.env)
   sudo -n -u postgres psql -d "$DB" -tAc "SELECT count(*) FROM information_schema.columns WHERE table_name = 'acts' AND column_name IN ('hand','for_handle','route')"   # 3
   ```
2. **A minute after the next act lands** (the office's probe re-asks within 60 s): `SELECT route, count(*) FROM acts WHERE id > <max id before the apply> GROUP BY 1` names `mcp` or `api` (and `site` for a browser's act), never anything else.
