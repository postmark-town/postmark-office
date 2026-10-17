#!/usr/bin/env bash
# sandbox-reset.sh — reset the DEV office to the declared sandbox seed.
#
# THE DESIGN (founder-ruled 2026-08-26): the dev instance's default state is a
# certified settlement snapshot, declared as the `sandbox/seed` tag PAIR —
# postmark-town/postmark + postmark-town/postmark-world (first pair: S47's, town
# 830a6996 / world 52c281b8). Both clones hard-reset to their tag, derived
# state is deleted and rebuilt, the dev service restarts. Local rehearsal
# commits (TOWN_PUSH=0 keeps them local by construction) are DISCARDED —
# that is the point. To advance the default: retag sandbox/seed in both
# repos (founder's word) and run this again.
#
# oauth.db is deliberately KEPT: sign-ins are box-side state, not town state,
# and wiping it would lock every tester out after each reset.
set -euo pipefail
D="${SANDBOX_DIR:-/srv/postmark-office-dev}"   # the dev office's tree (a test points it elsewhere)
SEED=sandbox/seed
SANDBOX_DB=w2_devsandbox_20260925

# THE SANDBOX, AND NOTHING ELSE (review-606). The rebuild below reseeds the town
# index and rewrites the world graph snapshot in whatever PGDATABASE names, and
# dev and prod share one cluster: world2-lib.sh § w2_db falls back to world2_dev,
# PROD's store, when WORLD2_DB is unset. So an exported PG* that names any other
# database is refused here, before anything is stopped or reset (DEPLOY.md § the
# dev box, step 7, asserts the same).
if [ -n "${PGDATABASE:-}" ] && [ "$PGDATABASE" != "$SANDBOX_DB" ]; then
  echo "REFUSED: PGDATABASE is $PGDATABASE, not the dev sandbox ($SANDBOX_DB); nothing was stopped, reset or written" >&2
  exit 9
fi

echo "== sandbox reset -> $SEED =="
sudo systemctl stop postmark-office-dev.service
for C in "$D/town-clone" "$D/world-clone"; do
  git -C "$C" fetch origin --tags --force -q
  git -C "$C" reset --hard "refs/tags/$SEED" -q
  git -C "$C" clean -fd -q
  echo "  $(basename "$C") -> $(git -C "$C" rev-parse --short HEAD)"
done

echo "== derived state: delete + rebuild =="
# office.db is retired (POS-656) and nothing reads it; a leftover copy goes here too
rm -f "$D"/office.db* "$D"/dynamic.db* "$D"/world.db*
cd "$D"
# world.db is retired (POS-270 lane W 3b) and office.db too (POS-656): the dev
# office reads the world graph snapshot and the town index from its sandbox
# store, both written as that store's law pen. The operator supplies PG* for
# it; without them neither is rebuilt, and this says so rather than leave the
# dev office on an older town or world quietly.
if [ -n "${PGDATABASE:-}" ] && [ -n "${PGUSER:-}" ]; then
  # asserted again where it writes: the guard at the top is this line's reason
  [ "$PGDATABASE" = "$SANDBOX_DB" ] || { echo "REFUSED: $PGDATABASE is not the dev sandbox ($SANDBOX_DB)" >&2; exit 9; }
  # the town index, reseeded at the seed's head (DEPLOY.md § the dev box, step 7:
  # the quest rows fold on the store's stamp chain, STAMP_LINES=store)
  STAMP_LINES=store node world2/tools/town-index-ingest.mjs --town-repo "$D/town-clone" --sha "$(git -C "$D/town-clone" rev-parse HEAD)" --seed --reseed >/dev/null
  echo "  the town index reseeded from the seed (store $PGDATABASE, as $PGUSER)"
  node src/world-hydrate.mjs --world "$D/world-clone" --office "$D" --to-store >/dev/null
  echo "  the world graph snapshot rebuilt from the seed (store $PGDATABASE, as $PGUSER)"
else
  echo "  TOWN INDEX AND WORLD GRAPH NOT REBUILT: export the sandbox store's law-pen PG* (PGHOST, PGDATABASE=$SANDBOX_DB, PGUSER, PGPASSWORD) and run again" >&2
fi

echo "== start dev office =="
sudo systemctl start postmark-office-dev.service
sleep 2
systemctl is-active postmark-office-dev.service
echo "== sandbox at seed. rehearse freely; run this again to forget. =="
