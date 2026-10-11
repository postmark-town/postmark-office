#!/usr/bin/env bash
# site-refresh-selftest.sh — the falsifiers for deploy/site-refresh.sh.
#
#   bash deploy/site-refresh-selftest.sh
#
# WHY A SHELL HARNESS AND NOT A test/*.test.mjs. The three things that have to be
# true about the refresh script are things only a real POSIX environment can
# demonstrate: that `flock` actually excludes a second process, that a symlink
# swap is a rename and not a gap, and that a run whose inputs have not moved
# genuinely does nothing. A node test that re-implemented any of those would be
# asserting about its own re-implementation. So this drives the REAL script.
#
# It is deliberately NOT wired into `npm test`: this box's dev machine is
# Windows, and a falsifier that skips itself is not a falsifier. It runs by hand,
# and INSTALL step 4 in site-refresh.sh's header is where it earns its keep.
#
# THE SANDBOX. Three local git repos stand in for the town, the site and the
# world; `npm` is shimmed onto PATH so no network and no astro are involved. What
# is real: git, flock, rsync, the symlink swap, the state file, the snapshot key,
# the convergence loop — every decision the script makes.
#
# THE LAW THESE ASSERT, from EPICS/POSTMARK/freshness-architecture.md:
#
#   "a 30-minute timer, phase-aligned ~:10 after the ferry crossings (the known
#    moments mail actually moves), lockfile single-flight, atomic
#    temp-build-then-symlink-swap (zero downtime; no stale-over-fresh ordering
#    race)."
#
# Each clause is one test below, and the defect each closes is named in it.

set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="$HERE/site-refresh.sh"
SANDBOX="$(mktemp -d)"
PASS=0; FAIL=0

ok()   { PASS=$((PASS+1)); echo "  ok   $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL $1"; }
check(){ if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 — expected [$3], got [$2]"; fi; }
head_() { echo; echo "── $1"; }

cleanup() { rm -rf "$SANDBOX"; }
trap cleanup EXIT

# ── the sandbox ─────────────────────────────────────────────────────────────

mkgit() { # dir
  mkdir -p "$1"; git -C "$1" init -q -b main
  git -C "$1" config user.name t; git -C "$1" config user.email t@t
}

TOWN_SRC="$SANDBOX/remote-town"
SITE_SRC="$SANDBOX/remote-site"
WORLD_SRC="$SANDBOX/remote-world"
ROOT="$SANDBOX/srv"
WEBROOT="$SANDBOX/www/postmark-town-site"
REPORT="$SANDBOX/report.json"
mkdir -p "$SANDBOX/www" "$SANDBOX/bin"

mkgit "$TOWN_SRC"
mkdir -p "$TOWN_SRC/WHITE_PAGES"
echo "crossing 1" > "$TOWN_SRC/WHITE_PAGES/mail-ledger.md"
git -C "$TOWN_SRC" add -A && git -C "$TOWN_SRC" commit -qm "the town, at rest"

mkgit "$WORLD_SRC"
echo world > "$WORLD_SRC/w"; git -C "$WORLD_SRC" add -A; git -C "$WORLD_SRC" commit -qm w
git -C "$WORLD_SRC" tag settlement/S45
# THE RELEASE FLOOR, as a sha the fake site's lockfile can name. Without a world
# in the lockfile there is no floor to hold AT, and § 7 would be asserting about
# an empty string.
WORLD_FLOOR="$(git -C "$WORLD_SRC" rev-parse settlement/S45)"

mkgit "$SITE_SRC"
mkdir -p "$SITE_SRC/tools/lib" "$SITE_SRC/public/atelier/postmark" "$SITE_SRC/src/data/postmark" "$SITE_SRC/public/renditions"
# git stores no empty directories, and the real site repo has committed files in
# all three of these — so without placeholders the sandbox would test a tree the
# extractors could not write into. (It caught itself on the first run: the very
# first pass died on ENOENT writing a doorstep bundle.)
echo "placeholder" > "$SITE_SRC/public/atelier/postmark/.keep"
echo "placeholder" > "$SITE_SRC/src/data/postmark/.keep"
echo "placeholder" > "$SITE_SRC/public/renditions/.keep"
cat > "$SITE_SRC/package.json" <<'EOF'
{ "name": "fake-site", "version": "0.0.0", "private": true, "scripts": { "build": "true" } }
EOF
cat > "$SITE_SRC/package-lock.json" <<EOF
{ "name": "fake-site", "version": "0.0.0", "lockfileVersion": 3, "requires": true, "packages": {
  "node_modules/postmark-world": { "resolved": "git+ssh://git@github.com/keeminlee/postmark-world.git#$WORLD_FLOOR" } } }
EOF
# The site's own recipe, stubbed to the smallest thing that proves it RAN and
# proves what it was handed. extract-town writes the crossing it was given, so
# the crossing-threading assertion below is reading the real env plumbing.
cat > "$SITE_SRC/tools/extract-town.mjs" <<'EOF'
import { writeFileSync } from "node:fs";
const town = process.argv[process.argv.indexOf("--town") + 1];
writeFileSync("public/atelier/postmark/doorstep.md",
  `town=${town}\ncrossing=${process.env.POSTMARK_CROSSING ?? ""}\n`);
console.log("stub extract-town ran");
EOF
cat > "$SITE_SRC/tools/fetch-town.mjs" <<'EOF'
import { writeFileSync } from "node:fs";
writeFileSync("src/data/postmark/stats.json", JSON.stringify({ api: process.env.POSTMARK_API ?? null }));
EOF
cat > "$SITE_SRC/tools/sync-renditions.mjs" <<'EOF'
import { writeFileSync } from "node:fs";
writeFileSync("public/renditions/a.html", "<p>a rendition merged after the tag</p>");
EOF
# The resolver, stubbed and DRIVEABLE. The real one asks a remote and applies the
# founder's hold; what the script downstream can be falsified about is the two
# answers it gives, so the sandbox hands them over by env. Defaults to hold, which
# is what every test above this line was written against.
cat > "$SITE_SRC/tools/resolve-world-pin.mjs" <<'EOF'
const sha = process.env.SELFTEST_PIN_SHA ?? "";
const settlement = process.env.SELFTEST_PIN_SETTLEMENT ?? "";
console.log(JSON.stringify({
  decision: process.env.SELFTEST_PIN_DECISION || "hold",
  sha,
  settlement: settlement === "" ? null : Number(settlement),
  reason: "stub",
}));
EOF
cat > "$SITE_SRC/tools/build-stamp.mjs" <<'EOF'
import { writeFileSync, mkdirSync } from "node:fs";
mkdirSync("dist-town", { recursive: true });
writeFileSync("dist-town/build.json", JSON.stringify({
  code_ref: process.env.BUILD_CODE_REF ?? null,
  town_data_sha: process.env.BUILD_TOWN_DATA_SHA ?? null,
  town_sha: process.env.BUILD_TOWN_SHA ?? null,
  crossing: process.env.BUILD_CROSSING === "" ? null : Number(process.env.BUILD_CROSSING),
}, null, 1));
EOF
git -C "$SITE_SRC" add -A && git -C "$SITE_SRC" commit -qm "the site"
git -C "$SITE_SRC" tag -a release/2026-w35 -m "cut"

# `npm`, shimmed. No network, no astro — the recipe's shape is what is under
# test here, not npm's behaviour. `run build` produces the dist the publish step
# then has to carry, so the swap below is swapping real bytes.
cat > "$SANDBOX/bin/npm" <<'EOF'
#!/usr/bin/env bash
# The one npm behaviour the world-pin falsifiers turn on: WHAT ENDS UP INSTALLED,
# recorded where npm actually records it — node_modules/.package-lock.json. `ci`
# installs what package-lock.json names; `install pkg@github:...#sha` installs that
# sha AND rewrites package-lock.json, which is exactly how one tick's advance
# outlives the tick that made it. Everything else stays the no-op it was.
case "${1:-}" in
  ci)
    mkdir -p node_modules
    node -e 'const{readFileSync,writeFileSync}=require("node:fs");let r="";try{r=JSON.parse(readFileSync("package-lock.json","utf8")).packages?.["node_modules/postmark-world"]?.resolved??""}catch{};writeFileSync("node_modules/.package-lock.json",JSON.stringify({packages:{"node_modules/postmark-world":{resolved:r}}},null,1))'
    exit 0;;
  install)
    mkdir -p node_modules
    for a in "$@"; do
      case "$a" in
        postmark-world@github:*)
          node -e 'const{writeFileSync}=require("node:fs");const spec="git+ssh://git@github.com/keeminlee/postmark-world.git#"+process.argv[1];writeFileSync("node_modules/.package-lock.json",JSON.stringify({packages:{"node_modules/postmark-world":{resolved:spec}}},null,1));writeFileSync("package-lock.json",JSON.stringify({name:"fake-site",version:"0.0.0",lockfileVersion:3,requires:true,packages:{"node_modules/postmark-world":{resolved:spec}}},null,1))' "${a##*#}"
          ;;
      esac
    done
    exit 0;;
  run) if [ "${2:-}" = "build" ]; then mkdir -p dist-town; date -u +%s%N > dist-town/index.html; echo "build_crossing=${BUILD_CROSSING+set}:${BUILD_CROSSING-}" > dist-town/build-env.txt; fi; exit 0;;
esac
exit 0
EOF
chmod +x "$SANDBOX/bin/npm"
export PATH="$SANDBOX/bin:$PATH"

run() { # extra env... -> stdout+stderr, exit code in $RC
  set +e
  OUT="$(env SITE_REFRESH_ROOT="$ROOT" SITE_WEBROOT="$WEBROOT" \
      SITE_REMOTE="$SITE_SRC" TOWN_REMOTE="$TOWN_SRC" WORLD_REMOTE="$WORLD_SRC" \
      SITE_REFRESH_REPORT="$REPORT" POSTMARK_API="http://127.0.0.1:9/api" \
      "$@" bash "$SCRIPT" 2>&1)"
  RC=$?
  set -e
}

echo "sandbox: $SANDBOX"

# ═══════════════════════════════════════════════════════════════════════════

head_ "1 · the first build publishes, and publishes through a SYMLINK"
run
check "exit 0" "$RC" "0"
if [ -L "$WEBROOT" ]; then ok "the webroot is a symlink, not a directory"; else bad "the webroot is not a symlink (got: $(ls -ld "$WEBROOT" 2>&1 | head -1))"; fi
TARGET1="$(readlink -f "$WEBROOT")"
case "$TARGET1" in "$ROOT/releases/"*) ok "it points into releases/";; *) bad "it points at $TARGET1";; esac
[ -s "$WEBROOT/index.html" ] && ok "and the built bytes are served through it" || bad "no index.html behind the link"

head_ "2 · THE ONE-RECIPE RULE: the site's own scripts ran, with what they were owed"
[ -f "$WEBROOT/../../$(basename "$TARGET1")/index.html" ] 2>/dev/null || true
DOOR="$ROOT/site/public/atelier/postmark/doorstep.md"
grep -q "town=$ROOT/town" "$DOOR" && ok "extract-town.mjs was handed the box's own town clone" || bad "extract-town.mjs did not see the town clone ($(cat "$DOOR" 2>&1 | head -2))"
# THE HONEST NULL. The sandbox's office is a closed port, so the crossing could
# not be asked — and the whole design says that must arrive as ABSENCE, never as
# a guess. `Number("")` is 0, and crossing 0 is the town's first ferry in June:
# a build that could not ask must not claim it.
grep -q "^crossing=$" "$DOOR" && ok "an unreachable office threads through as EMPTY, never as a guessed number" || bad "crossing was not empty: $(grep '^crossing' "$DOOR")"
STAMP="$TARGET1/build.json"
grep -q '"code_ref": "release/2026-w35"' "$STAMP" && ok "the stamp names the release tag the code came from" || bad "no code_ref in $STAMP"
grep -q "\"town_sha\": \"$(git -C "$TOWN_SRC" rev-parse HEAD)\"" "$STAMP" && ok "the stamp names the TOWN commit that was read" || bad "town_sha wrong: $(cat "$STAMP")"
grep -q '"crossing": null' "$STAMP" && ok "and an unasked crossing is null in the stamp, not zero" || bad "crossing not null: $(cat "$STAMP")"
# THE BUILD IS HANDED THE SAME CROSSING: pages that key what they show to the
# crossing read BUILD_CROSSING at build time, so it must reach `npm run build` as
# well as the stamp: set, and here the honest empty (the office is a closed port).
grep -q "^build_crossing=set:$" "$TARGET1/build-env.txt" && ok "the build itself was handed BUILD_CROSSING (empty, as the stamp's null)" || bad "the build was not handed BUILD_CROSSING: $(cat "$TARGET1/build-env.txt" 2>&1)"
[ -f "$TARGET1/../../site/public/renditions/a.html" ] || [ -f "$ROOT/build/public/renditions/a.html" ] && ok "approved renditions were overlaid onto the tag build" || bad "renditions did not reach the build tree"

head_ "3 · THE NO-OP PATH: nothing moved, so nothing is done"
BEFORE="$TARGET1"
run
check "exit 0" "$RC" "0"
echo "$OUT" | grep -q "quiet: town, site main" && ok "it says out loud that it stood down" || bad "no quiet line: $OUT"
echo "$OUT" | grep -q "pass 1 —" && bad "IT BUILT ANYWAY — the snapshot key is not being honoured" || ok "no build pass was started"
check "the published release is untouched" "$(readlink -f "$WEBROOT")" "$BEFORE"
grep -q '"status": "quiet"' "$REPORT" && ok "and the status board says quiet" || bad "board: $(cat "$REPORT")"

head_ "4 · THE FLIP: the town moves, and the SAME script builds"
# A no-op path that no-ops unconditionally would pass test 3 and be useless.
echo "crossing 2" >> "$TOWN_SRC/WHITE_PAGES/mail-ledger.md"
git -C "$TOWN_SRC" commit -qam "a ferry landed"
run
check "exit 0" "$RC" "0"
echo "$OUT" | grep -q "pass 1 —" && ok "a moved town DOES start a build" || bad "the town moved and nothing happened: $OUT"
TARGET2="$(readlink -f "$WEBROOT")"
[ "$TARGET2" != "$BEFORE" ] && ok "and the webroot swung to a new release dir" || bad "the link did not move off $BEFORE"
grep -q "\"town_sha\": \"$(git -C "$TOWN_SRC" rev-parse HEAD)\"" "$TARGET2/build.json" && ok "carrying the new town commit" || bad "stale town_sha after the move"

head_ "5 · A NEW RELEASE TAG WAKES IT TOO — the box is the only publisher now"
# If the key were the town alone, a tag cut on a quiet town would sit unpublished
# until the town happened to change. That is the failure this clause prevents.
git -C "$SITE_SRC" tag -a release/2026-w36 -m "cut"
run
echo "$OUT" | grep -q "code release/2026-w36" && ok "a fresh release tag starts a build on an unchanged town" || bad "the new tag did not wake it: $OUT"
grep -q '"code_ref": "release/2026-w36"' "$(readlink -f "$WEBROOT")/build.json" && ok "and prod now serves the new tag" || bad "the new tag did not reach the stamp"

head_ "6 · A BLESSED SETTLEMENT WAKES IT TOO"
git -C "$WORLD_SRC" tag settlement/S46
run
echo "$OUT" | grep -q "pass 1 —" && ok "a new settlement tag starts a build" || bad "a blessing did not wake it: $OUT"

head_ "7 · A HOLD IS AN INSTALL, NOT A NO-OP — node_modules does not remember for you"
# THE DEFECT, worn by prod for eight hours on 2026-09-10. `ensure_deps` keys on
# package-lock.json's sha1; the `checkout -qf --detach` at the top of build_once
# has just restored that lockfile to the TAG's copy; node_modules survives the
# tick. So a tick resolving HOLD skipped npm ci, installed nothing, and shipped
# whatever world the last ADVANCE had left on disk — while /build.json, which
# reads the restored package-lock.json, swore it was serving the floor. The
# founder's HOLD_AT_SETTLEMENT = 63 landed at 14:37Z and prod kept publishing
# S64's world, and S64's world page, through every tick after it.
#
# Driven end to end: advance to a settlement, then hold, then ask npm's OWN
# record of what is installed — never the ask — which world is really there.
echo "a settlement's worth of world" > "$WORLD_SRC/w2"
git -C "$WORLD_SRC" add -A && git -C "$WORLD_SRC" commit -qm "S47's world"
git -C "$WORLD_SRC" tag settlement/S47
WORLD_S47="$(git -C "$WORLD_SRC" rev-parse settlement/S47)"
INSTALLED="$ROOT/build/node_modules/.package-lock.json"

run SELFTEST_PIN_DECISION=advance SELFTEST_PIN_SHA="$WORLD_S47" SELFTEST_PIN_SETTLEMENT=47
check "exit 0" "$RC" "0"
echo "$OUT" | grep -q "advancing to settlement S47" && ok "the resolver's advance is taken" || bad "no advance line: $OUT"
grep -q "$WORLD_S47" "$INSTALLED" 2>/dev/null \
  && ok "and node_modules really holds S47 afterwards" \
  || bad "S47 was never installed: $(cat "$INSTALLED" 2>&1 | head -3)"

# THE STEADY STATE (reviewer, 2026-09-11). The box's ordinary tick is the SAME
# advance decision again — no new tag, no new floor — and build-stamp.mjs reads
# the build tree's package-lock.json first. A guard that installs only when
# node_modules disagrees would skip this tick and leave the lockfile naming the
# floor over a tree serving S47: the receipt lie on the path that was honest.
echo "crossing 4" >> "$TOWN_SRC/WHITE_PAGES/mail-ledger.md"
git -C "$TOWN_SRC" commit -qam "the next ordinary tick, same decision"
run SELFTEST_PIN_DECISION=advance SELFTEST_PIN_SHA="$WORLD_S47" SELFTEST_PIN_SETTLEMENT=47
check "exit 0" "$RC" "0"
grep -q "$WORLD_S47" "$ROOT/build/package-lock.json" 2>/dev/null   && ok "THE RECEIPT HOLDS: on the second advance tick the build tree's package-lock.json still names S47, which is what /build.json reads"   || bad "THE RECEIPT LIE: the build tree's package-lock.json does not name S47 after a repeated advance"

# THE FLIP. The founder's hold lands. Nothing else about the tree changes — the
# tag is the same tag, its lockfile is the same lockfile, and npm ci will be
# skipped exactly as it is on the box.
echo "crossing 5" >> "$TOWN_SRC/WHITE_PAGES/mail-ledger.md"
git -C "$TOWN_SRC" commit -qam "the tick after the hold landed"
run SELFTEST_PIN_DECISION=hold
check "exit 0" "$RC" "0"
echo "$OUT" | grep -q "holding at the release floor" && ok "the resolver's hold is taken" || bad "no hold line: $OUT"
grep -q "$WORLD_FLOOR" "$INSTALLED" 2>/dev/null \
  && ok "THE POINT: a hold REINSTALLS the floor, so node_modules carries $(echo "$WORLD_FLOOR" | cut -c1-8)" \
  || bad "THE 2026-09-10 DEFECT: the hold changed nothing on disk — $(cat "$INSTALLED" 2>&1 | head -3)"
grep -q "$WORLD_S47" "$INSTALLED" 2>/dev/null \
  && bad "the advanced world OUTLIVED the hold — prod would still be serving S47" \
  || ok "and the advanced world is gone from disk"

head_ "8 · SINGLE-FLIGHT: a second trigger mid-build STANDS DOWN, it does not queue"
# The defect: two 30-minute timers stacking behind one slow build is how a box
# eats itself, and a queued build starts against inputs the running one already
# passed. Held here with a real flock from a second process, exactly as a second
# systemd trigger would arrive.
echo "crossing 3" >> "$TOWN_SRC/WHITE_PAGES/mail-ledger.md"
git -C "$TOWN_SRC" commit -qam "more mail"
( flock -x 9; sleep 6 ) 9>"$ROOT/refresh.lock" &
HOLDER=$!
sleep 1
run
check "exit 0 — a stood-down tick is not a failure" "$RC" "0"
echo "$OUT" | grep -q "a build is already running" && ok "it stood down and said so" || bad "it did NOT stand down: $OUT"
echo "$OUT" | grep -q "pass 1 —" && bad "IT BUILT ANYWAY — the lock excludes nothing" || ok "and started no competing build"
wait $HOLDER

head_ "9 · CONVERGENCE: a town that moves DURING a build is built again"
# The defect: publishing a snapshot that was already stale when it landed and
# then sleeping thirty minutes is the same failure this file exists to end, only
# faster. The seam is a slow `npm run build` that commits to the town mid-flight.
cat > "$SANDBOX/bin/npm" <<EOF
#!/usr/bin/env bash
case "\${1:-}" in
  ci|install) mkdir -p node_modules; exit 0;;
  run) if [ "\${2:-}" = "build" ]; then
         mkdir -p dist-town; date -u +%s%N > dist-town/index.html
         if [ ! -f "$SANDBOX/raced" ]; then
           touch "$SANDBOX/raced"
           echo "a letter arrived mid-build" >> "$TOWN_SRC/WHITE_PAGES/mail-ledger.md"
           git -C "$TOWN_SRC" commit -qam "mid-build ferry"
         fi
       fi; exit 0;;
esac
exit 0
EOF
chmod +x "$SANDBOX/bin/npm"
run
FINAL_TOWN="$(git -C "$TOWN_SRC" rev-parse HEAD)"
echo "$OUT" | grep -q "the town moved during the build" && ok "it noticed the town move under it" || bad "no convergence line: $OUT"
echo "$OUT" | grep -q "pass 2 —" && ok "and ran a second pass" || bad "it did not build again"
grep -q "\"town_sha\": \"$FINAL_TOWN\"" "$(readlink -f "$WEBROOT")/build.json" \
  && ok "THE POINT: it ends at the NEWER town, not the one it started on" \
  || bad "converged on the wrong state: $(cat "$(readlink -f "$WEBROOT")/build.json")"

head_ "10 · A FAILED BUILD PUBLISHES NOTHING — the last good release keeps serving"
STANDING="$(readlink -f "$WEBROOT")"
echo "crossing 4" >> "$TOWN_SRC/WHITE_PAGES/mail-ledger.md"
git -C "$TOWN_SRC" commit -qam "yet more"
cat > "$SANDBOX/bin/npm" <<'EOF'
#!/usr/bin/env bash
case "${1:-}" in
  ci|install) mkdir -p node_modules; exit 0;;
  run) exit 1;;
esac
exit 0
EOF
chmod +x "$SANDBOX/bin/npm"
run
check "exit 1, loudly" "$RC" "1"
check "the webroot still points at the last good build" "$(readlink -f "$WEBROOT")" "$STANDING"
[ -s "$WEBROOT/index.html" ] && ok "which is still serving bytes" || bad "the floor stopped serving"
grep -q '"status": "failed"' "$REPORT" && ok "and the board says failed" || bad "board: $(cat "$REPORT")"
# and the state file was NOT advanced, so the next tick retries rather than
# believing it already built this town
grep -q "\"town_sha\": \"$FINAL_TOWN\"" "$ROOT/state.json" && ok "the state still names the last SUCCESSFUL build, so the next tick retries" || bad "state advanced past a failed build"

# ═══════════════════════════════════════════════════════════════════════════

echo
echo "───────────────────────────────────────────"
echo "site-refresh selftest: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ] || exit 1
