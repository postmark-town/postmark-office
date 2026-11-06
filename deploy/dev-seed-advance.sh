#!/usr/bin/env bash
# dev-seed-advance.sh — advance dev's sandbox/seed: one deliberate step, by hand (POS-791).
#
#   WORLD2_DB=w2_devsandbox_20260925 bash deploy/dev-seed-advance.sh --town <sha> --world <sha> [--go]
#
# A person runs this on the box, from the dev office's carried tree, on its own
# day and never on ship morning. No unit or timer runs it. Without --go it prints
# the plan and runs nothing. It stops at the first failing step and names it;
# every step is safe to repeat, so the remedy is the same line again.
#
# WHY THE RETAG IS PRINTED, NOT RUN. The freshen reads the pair from origin
# (`fetch --tags --force`, then `reset --hard refs/tags/sandbox/seed`), so a tag
# moved in a dev clone is overwritten by the next fetch, and a dev clone cannot
# push (its push URL is DISABLED-dev-channel-never-pushes). So step 1 reads origin.
# When origin's pair isn't the one given, it stops, having written nothing, and
# prints the retag for someone whose clone can push.
#
# WHY THE TRIM IS NOT TO THE LEDGER'S LENGTH, AND WHY A SYNC FOLLOWS IT. The store
# holds the old seed's lines and then the last rehearsal's. Trimming to the new
# ledger's length leaves those rehearsal lines in the new seed's place, and leaves
# the store behind its export, and --verify reds on either
# (src/stamp-lines.mjs § verifyStampLinesVia). So the trim keeps the lines the
# store and the re-signed clone agree on, and --sync (DEPLOY step 6) records the
# new seed's lines past them. On an unchanged seed the two trims are the same
# DELETE and the sync records nothing.
#
# law-ingest exits 0 when it holds the pin, so step 5 reads the pin back.
#
# DEV_SEED_ADVANCE_TEST_ROOT is test/dev-seed-advance.test.mjs's seam, and it can't
# name anything else under /srv. Nothing on the box sets it.
set -uo pipefail

DEV_TREE=/srv/postmark-office-dev
SANDBOX_DB=w2_devsandbox_20260925
NO_PUSH=DISABLED-dev-channel-never-pushes
OFFICE_ENV=/etc/postmark-office-dev.env
D="${DEV_SEED_ADVANCE_TEST_ROOT:-$DEV_TREE}"

usage() { echo "usage: WORLD2_DB=$SANDBOX_DB bash deploy/dev-seed-advance.sh --town <40-hex sha> --world <40-hex sha> [--go]" >&2; exit 2; }

TOWN_SHA="" WORLD_SHA="" GO=0
while [ $# -gt 0 ]; do
  case "$1" in
    --town)  [ $# -ge 2 ] || usage; TOWN_SHA=$2; shift 2 ;;
    --world) [ $# -ge 2 ] || usage; WORLD_SHA=$2; shift 2 ;;
    --go)    GO=1; shift ;;
    *)       usage ;;
  esac
done
is_sha() { [[ "$1" =~ ^[0-9a-f]{40}$ ]]; }
is_sha "$TOWN_SHA" && is_sha "$WORLD_SHA" || usage

if [ "$GO" -ne 1 ]; then
  cat <<PLAN
The plan: dev's sandbox/seed moves to town $TOWN_SHA, world $WORLD_SHA.

  1. the retag: read sandbox/seed on origin in both repos; if it isn't this pair, stop and print the retag
  2. the freshen: sudo systemctl start postmark-dev-freshen.service (the clones stand on the seed, re-signed)
  3. the stamp chain: trim the store to the lines it shares with the clone, stamp-lines --sync, then --verify
  4. the town index: town-index-ingest --seed --reseed at the town clone's head, as the law pen
  5. the world law: law-ingest at $WORLD_SHA, as the law pen, and the world-law pin reads back as that sha
  6. the preflight: sudo node tools/dev-rehearsal.mjs --user meepo --only preflight

Before any of that it refuses a database that isn't $SANDBOX_DB and a clone that isn't dev's.
Nothing ran. To run it:
  WORLD2_DB=$SANDBOX_DB bash deploy/dev-seed-advance.sh --town $TOWN_SHA --world $WORLD_SHA --go
PLAN
  exit 0
fi

refuse() { echo "REFUSED: $1; nothing was written" >&2; exit 9; }
STEP=0 STEP_NAME=""
step() { STEP=$1; STEP_NAME=$2; echo; echo "== step $STEP of 6: $STEP_NAME =="; }
stop() { echo "STOPPED at step $STEP ($STEP_NAME): $1. The steps after it did not run; fix it and run this line again." >&2; exit 1; }

# ── the refusals: every one before anything writes ─────────────────────────────

[ -n "${WORLD2_DB:-}" ] || refuse "no WORLD2_DB is set, and world2-lib.sh § w2_db falls back to world2_dev, PROD's store; set WORLD2_DB=$SANDBOX_DB"
[ "$WORLD2_DB" = "$SANDBOX_DB" ] || refuse "WORLD2_DB is $WORLD2_DB, not the dev sandbox ($SANDBOX_DB)"

D_REAL="$(realpath -m -- "$D")" || refuse "could not resolve $D"
case "$D_REAL" in
  "$DEV_TREE") ;;
  /srv|/srv/*) refuse "$D is not the dev office's tree ($DEV_TREE)" ;;
esac
cd "$D" || refuse "could not enter $D"

as_meepo() { sudo -n -u meepo "$@"; }

for c in "$D/town-clone" "$D/world-clone"; do
  c_real="$(realpath -m -- "$c")" || refuse "could not resolve $c"
  case "$c_real" in
    "$D_REAL"/*) ;;
    *) refuse "$c is really $c_real, outside the dev tree ($D_REAL)" ;;
  esac
  remotes="$(as_meepo git -C "$c" remote)" && [ -n "$remotes" ] || refuse "could not read $c's remotes"
  for r in $remotes; do
    url="$(as_meepo git -C "$c" remote get-url --push "$r")" || refuse "could not read $c's push URL for $r"
    [ "$url" = "$NO_PUSH" ] || refuse "$c's remote $r can push: its push URL is not $NO_PUSH"
  done
done

# law_pen <command...>: as meepo with the law pen's PG*, the database asserted
# where it writes (DEPLOY step 7's line).
law_pen() {
  sudo -n bash -c '
    export WORLD2_DB="$1" STAMP_LINES=store; shift
    . deploy/world2-lib.sh && w2_pgenv law_ingester PG_LAW_INGESTER_PASSWORD || exit 4
    [ "$PGDATABASE" = "$WORLD2_DB" ] || { echo "REFUSED: $PGDATABASE is not the dev sandbox" >&2; exit 9; }
    exec runuser -u meepo -- "$@"
  ' law-pen "$SANDBOX_DB" "$@"
}
law_pen true || refuse "the law pen does not reach $SANDBOX_DB"
# stamp-lines reaches the store through this file's URL, so it is checked too. -q prints nothing of it.
sudo -n grep -qE "^WORLD2_PG_URL=\"?postgres(ql)?://[^[:space:]]*/$SANDBOX_DB(\"|\\?|\$)" "$OFFICE_ENV" \
  || refuse "$OFFICE_ENV does not name $SANDBOX_DB as its WORLD2_PG_URL"

store_read() { sudo -n -u postgres psql -d "$SANDBOX_DB" -XAt -v ON_ERROR_STOP=1 -c "$1"; }
# systemd-run's --wait gives back the command's exit code.
as_dev_office() {
  sudo -n systemd-run --uid=meepo -p EnvironmentFile="$OFFICE_ENV" -p WorkingDirectory="$D" --pipe --wait "$@"
}

# ── 1. the retag ───────────────────────────────────────────────────────────────

step 1 "the retag"
# origin's tag, peeled when annotated: ls-remote lists the peeled line last. Read-only.
origin_seed() {
  as_meepo git -C "$1" ls-remote origin refs/tags/sandbox/seed 'refs/tags/sandbox/seed^{}' | tail -n1 | cut -f1
}
town_on_origin="$(origin_seed "$D/town-clone")" || stop "could not read sandbox/seed from the town's origin"
world_on_origin="$(origin_seed "$D/world-clone")" || stop "could not read sandbox/seed from the world's origin"
if [ "$town_on_origin" != "$TOWN_SHA" ] || [ "$world_on_origin" != "$WORLD_SHA" ]; then
  {
    echo "STOPPED at step $STEP ($STEP_NAME): sandbox/seed on origin is not this pair, and this box cannot move it. Nothing was written."
    echo "From a clone that can push, then run this line again:"
    if [ "$town_on_origin" != "$TOWN_SHA" ]; then
      echo "  # postmark-town/postmark: origin has ${town_on_origin:-no tag}"
      echo "  git fetch origin && git tag -f sandbox/seed $TOWN_SHA && git push --force origin refs/tags/sandbox/seed"
    fi
    if [ "$world_on_origin" != "$WORLD_SHA" ]; then
      echo "  # postmark-town/postmark-world: origin has ${world_on_origin:-no tag}"
      echo "  git fetch origin && git tag -f sandbox/seed $WORLD_SHA && git push --force origin refs/tags/sandbox/seed"
    fi
  } >&2
  exit 3
fi
echo "origin's sandbox/seed is this pair"

# ── 2. the freshen ─────────────────────────────────────────────────────────────

step 2 "the freshen"
sudo -n systemctl start postmark-dev-freshen.service || stop "postmark-dev-freshen.service failed: journalctl -u postmark-dev-freshen.service"

# ── 3. the store's stamp chain ─────────────────────────────────────────────────

step 3 "the stamp chain: trim, sync, verify"
# Prints "<lines the store and the clone agree on> <the ledger's lines> <the store's lines>".
# A signature signs the seal, and the seal chains every line before it, so equal
# signatures mean an equal past.
chain_counts() {
  store_read "SELECT sig FROM stamp_lines ORDER BY seq" | as_meepo node --input-type=module -e '
    import { readFileSync } from "node:fs";
    import { join } from "node:path";
    import { pathToFileURL } from "node:url";
    const clone = process.argv[1];
    const { parseStampLedger } = await import(pathToFileURL(join(clone, "tools", "stamp-mint.mjs")).href);
    const ledger = parseStampLedger(readFileSync(join(clone, "WHITE_PAGES", "stamp-ledger.md"), "utf8"));
    const store = readFileSync(0, "utf8").split("\n").filter(Boolean);
    let k = 0;
    while (k < store.length && k < ledger.length && store[k] === ledger[k].sig) k++;
    console.log(k, ledger.length, store.length);
  ' "$D/town-clone"
}
counts="$(chain_counts)" || stop "could not compare the store's chain with the clone's ledger"
read -r KEEP LEDGER HELD <<<"$counts"
[[ "${KEEP:-}" =~ ^[0-9]+$ ]] || stop "the chain comparison printed '$counts', not three counts"
echo "the store holds $HELD line(s), the clone's ledger $LEDGER, and they agree through line $KEEP"
sudo -n -u postgres psql -d "$SANDBOX_DB" -v ON_ERROR_STOP=1 -c "SET ROLE world2_owner; DELETE FROM stamp_lines WHERE seq > $KEEP" \
  || stop "the trim failed"
as_dev_office node world2/tools/stamp-lines.mjs --sync --clone "$D/town-clone" || stop "stamp-lines --sync failed"
as_dev_office node world2/tools/stamp-lines.mjs --verify --clone "$D/town-clone" || stop "stamp-lines --verify is red"

# ── 4. the town index ──────────────────────────────────────────────────────────

step 4 "the town index, reseeded at the clone's head"
town_head="$(as_meepo git -C "$D/town-clone" rev-parse HEAD)" || stop "could not read the town clone's head"
law_pen node world2/tools/town-index-ingest.mjs --town-repo "$D/town-clone" --sha "$town_head" --seed --reseed \
  || stop "town-index-ingest --seed --reseed failed"

# ── 5. the world law ───────────────────────────────────────────────────────────

step 5 "the world law, ingested forward"
law_pen node world2/tools/law-ingest.mjs --law-repo "$D/world-clone" --sha "$WORLD_SHA" || stop "law-ingest failed"
pin="$(store_read "SELECT sha FROM projection_heads WHERE repo = 'world-law'")" || stop "could not read the world-law pin"
[ "$pin" = "$WORLD_SHA" ] || stop "the world-law pin stands at ${pin:-nothing}, not $WORLD_SHA: law-ingest held it (a pin moves only to a descendant)"

# ── 6. the preflight ───────────────────────────────────────────────────────────

step 6 "the preflight"
sudo -n node tools/dev-rehearsal.mjs --user meepo --only preflight || stop "the preflight is red"

echo
echo "dev stands on the seed: town $TOWN_SHA (clone head $town_head), world $WORLD_SHA; the preflight is green."
echo 'Next, the full rehearsal is yours: cd /srv/postmark-office-dev && sudo node tools/dev-rehearsal.mjs --user meepo --report /tmp/dev-rehearsal-$(date +%F).txt'
