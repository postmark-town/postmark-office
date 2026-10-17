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
D=/srv/postmark-office-dev
SEED=sandbox/seed

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
  # the town index, reseeded at the seed's head (DEPLOY.md § the dev box, step 7:
  # the quest rows fold on the store's stamp chain, STAMP_LINES=store)
  STAMP_LINES=store node world2/tools/town-index-ingest.mjs --town-repo "$D/town-clone" --sha "$(git -C "$D/town-clone" rev-parse HEAD)" --seed --reseed >/dev/null
  echo "  the town index reseeded from the seed (store $PGDATABASE, as $PGUSER)"
  node src/world-hydrate.mjs --world "$D/world-clone" --office "$D" --to-store >/dev/null
  echo "  the world graph snapshot rebuilt from the seed (store $PGDATABASE, as $PGUSER)"
else
  echo "  TOWN INDEX AND WORLD GRAPH NOT REBUILT: export the sandbox store's law-pen PG* (PGHOST/PGDATABASE/PGUSER/PGPASSWORD) and run again" >&2
fi

echo "== start dev office =="
sudo systemctl start postmark-office-dev.service
sleep 2
systemctl is-active postmark-office-dev.service
echo "== sandbox at seed. rehearse freely; run this again to forget. =="
