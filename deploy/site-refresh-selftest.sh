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
# The site's package.json ASKS for the floor, as the real one does (POS-601): the
# extract tree's pin reads this spec, so world_pin and world_spec are the floor F.
cat > "$SITE_SRC/package.json" <<EOF
{ "name": "fake-site", "version": "0.0.0", "private": true, "scripts": { "build": "true" },
  "dependencies": { "postmark-world": "github:postmark-town/postmark-world#$WORLD_FLOOR" } }
EOF
cat > "$SITE_SRC/package-lock.json" <<EOF
{ "name": "fake-site", "version": "0.0.0", "lockfileVersion": 3, "requires": true, "packages": {
  "node_modules/postmark-world": { "resolved": "git+ssh://git@github.com/postmark-town/postmark-world.git#$WORLD_FLOOR" } } }
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
import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
writeFileSync("src/data/postmark/stats.json", JSON.stringify({ api: process.env.POSTMARK_API ?? null }));
// The site's pin writer (tools/lib/world-pin-publish.mjs), reduced to its two reads: the floor from
// THIS tree's package.json and "installed" from THIS tree's package-lock.json. In the extract tree
// both are site main's floor, which is the defect POS-601 closes. SELFTEST_NO_PIN=1 writes none.
// (POS-601's own fixture, under the selftest's temp fake site, from fixed literals.)
if (!process.env.SELFTEST_NO_PIN) {
  const sha = (x) => /#([0-9a-f]{7,40})$/i.exec(String(x ?? ""))?.[1]?.toLowerCase() ?? null;
  const spec = JSON.parse(readFileSync("package.json", "utf8")).dependencies?.["postmark-world"] ?? null;
  let resolved = null;
  try { resolved = JSON.parse(readFileSync("package-lock.json", "utf8")).packages?.["node_modules/postmark-world"]?.resolved ?? null; } catch {}
  mkdirSync("public/atelier/postmark/data", { recursive: true });
  writeFileSync("public/atelier/postmark/data/pin.json", JSON.stringify({
    what: "stub pin", world_pin: sha(spec), world_installed: sha(resolved), world_installed_from: "package-lock.json",
    world_spec: spec, channel: process.env.PUBLIC_CHANNEL ?? null, code_ref: process.env.BUILD_CODE_REF ?? null,
    built_at: "2026-01-01T00:00:00.000Z",
    notes: ["stub extract note about the installed copy in package-lock.json", "stub extract note kept: code_ref comes from the lane"],
  }, null, 1) + "\n");
}
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
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
mkdirSync("dist-town", { recursive: true });
let worldSha = null; // like build-stamp.mjs: this tree's package-lock.json, never the extract tree's floor
try { worldSha = /#([0-9a-f]{7,40})$/i.exec(String(JSON.parse(readFileSync("package-lock.json", "utf8")).packages?.["node_modules/postmark-world"]?.resolved ?? ""))?.[1]?.toLowerCase() ?? null; } catch {}
writeFileSync("dist-town/build.json", JSON.stringify({
  world_sha: worldSha,
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
          node -e 'const{writeFileSync}=require("node:fs");const spec="git+ssh://git@github.com/postmark-town/postmark-world.git#"+process.argv[1];writeFileSync("node_modules/.package-lock.json",JSON.stringify({packages:{"node_modules/postmark-world":{resolved:spec}}},null,1));writeFileSync("package-lock.json",JSON.stringify({name:"fake-site",version:"0.0.0",lockfileVersion:3,requires:true,packages:{"node_modules/postmark-world":{resolved:spec}}},null,1))' "${a##*#}"
          ;;
      esac
    done
    exit 0;;
  run) if [ "${2:-}" = "build" ]; then mkdir -p dist-town; date -u +%s%N > dist-town/index.html; echo "build_crossing=${BUILD_CROSSING+set}:${BUILD_CROSSING-}" > dist-town/build-env.txt; fi; exit 0;;
esac
exit 0
EOF
chmod +x "$SANDBOX/bin/npm"
cp "$SANDBOX/bin/npm" "$SANDBOX/npm.default"   # § 11 puts the default shim back after §§ 9-10 swap it
export PATH="$SANDBOX/bin:$PATH"

# One field out of a JSON file, as text: "<null>" for null/absent, "<unreadable>" for a file that is not JSON.
jget() { node -e 'let j;try{j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))}catch{process.stdout.write("<unreadable>");process.exit(0)}const v=process.argv[2].split(".").reduce((o,k)=>o?.[k],j);process.stdout.write(v===null||v===undefined?"<null>":typeof v==="string"?v:JSON.stringify(v))' "$1" "$2"; }

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

head_ "7b · THE PIN SAYS WHAT BUILD INSTALLED, NOT THE FLOOR (POS-601)"
# THE DEFECT. fetch-town runs in the EXTRACT tree (site main), so its pin.json says
# world_installed = the floor even when the BUILD tree's resolver advanced and the
# page compiled against another world. /build.json (the BUILD tree's lockfile) was
# right and pin.json was not. The stubs below DISCRIMINATE: the floor F and the
# advanced world B are different shas, the stub extract pin really says installed=F,
# the stub stamp really says world_sha=B, and only the publish step can make the
# published pin agree with the stamp while keeping the floor fields.
PIN="$WEBROOT/data/pin.json"
EXT="$ROOT/site/public/atelier/postmark/data/pin.json"
[ "$WORLD_FLOOR" != "$WORLD_S47" ] && ok "the instrument can tell them apart: floor F and advanced B are different shas" || bad "F and B are the same sha, so nothing below discriminates"

echo "crossing 6" >> "$TOWN_SRC/WHITE_PAGES/mail-ledger.md"
git -C "$TOWN_SRC" commit -qam "the pin tick, advance"
run SELFTEST_PIN_DECISION=advance SELFTEST_PIN_SHA="$WORLD_S47" SELFTEST_PIN_SETTLEMENT=47
check "exit 0" "$RC" "0"
check "the EXTRACT tree's own pin still says installed = the floor (the defect's source, reproduced by the stub)" "$(jget "$EXT" world_installed)" "$WORLD_FLOOR"
check "the stamp says the BUILD compiled B" "$(jget "$WEBROOT/build.json" world_sha)" "$WORLD_S47"
check "PUBLISHED world_pin is the floor F" "$(jget "$PIN" world_pin)" "$WORLD_FLOOR"
check "PUBLISHED world_installed is what BUILD installed, B" "$(jget "$PIN" world_installed)" "$WORLD_S47"
check "and it equals build.json's world_sha" "$(jget "$PIN" world_installed)" "$(jget "$WEBROOT/build.json" world_sha)"
check "the floor spec is preserved" "$(jget "$PIN" world_spec)" "github:postmark-town/postmark-world#$WORLD_FLOOR"
check "the lane is preserved" "$(jget "$PIN" channel)" "release"
check "and so is code_ref, which is the stamp's" "$(jget "$PIN" code_ref)" "$(jget "$WEBROOT/build.json" code_ref)"
check "the extract's built_at is kept" "$(jget "$PIN" built_at)" "2026-01-01T00:00:00.000Z"
jget "$PIN" notes | grep -q "stub extract note about the installed copy" && bad "a note about the extract tree's installed reading survived: it would describe the floor as installed" || ok "the extract's note about ITS installed copy is gone"
jget "$PIN" notes | grep -q "stub extract note kept" && ok "a note that is not about installed is kept" || bad "an unrelated note was dropped: $(jget "$PIN" notes)"
jget "$PIN" notes | grep -q "the build installed" && ok "and the pin says the floor and the installed world differ" || bad "no note that they differ: $(jget "$PIN" notes)"
jget "$PIN" notes | grep -q "BUILD tree's package-lock.json" && ok "and where world_installed came from" || bad "no provenance note: $(jget "$PIN" notes)"

# THE STEADY STATE: the same advance decision again (the box's ordinary tick). The
# re-lock keeps the BUILD lockfile naming B, so the pin must keep saying B.
echo "crossing 7" >> "$TOWN_SRC/WHITE_PAGES/mail-ledger.md"
git -C "$TOWN_SRC" commit -qam "the pin tick, the same advance"
run SELFTEST_PIN_DECISION=advance SELFTEST_PIN_SHA="$WORLD_S47" SELFTEST_PIN_SETTLEMENT=47
check "exit 0" "$RC" "0"
check "repeated advance to the same B: world_installed is still B" "$(jget "$PIN" world_installed)" "$WORLD_S47"
check "and world_pin is still the floor" "$(jget "$PIN" world_pin)" "$WORLD_FLOOR"

# HOLD: the installed world IS the floor, and the pin says so without claiming a difference.
echo "crossing 8" >> "$TOWN_SRC/WHITE_PAGES/mail-ledger.md"
git -C "$TOWN_SRC" commit -qam "the pin tick, hold"
run SELFTEST_PIN_DECISION=hold
check "exit 0" "$RC" "0"
check "hold: world_installed is the floor F" "$(jget "$PIN" world_installed)" "$WORLD_FLOOR"
check "hold: and equals build.json's world_sha" "$(jget "$PIN" world_installed)" "$(jget "$WEBROOT/build.json" world_sha)"
check "hold: world_pin is F too" "$(jget "$PIN" world_pin)" "$WORLD_FLOOR"
jget "$PIN" notes | grep -q "the build installed" && bad "a hold that installed the floor still claims a difference: $(jget "$PIN" notes)" || ok "and says nothing about a difference"

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
[ -f "$STANDING/data/pin.json" ] && ok "a standing pin.json exists to compare against" || bad "no standing pin.json at $STANDING/data/pin.json, so the byte check below could pass vacuously"
PIN_STANDING_SUM="$(sha256sum < "$STANDING/data/pin.json" 2>/dev/null)"
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
[ -f "$STANDING/data/pin.json" ] && check "and the standing pin.json is byte-for-byte what it was" "$(sha256sum < "$STANDING/data/pin.json")" "$PIN_STANDING_SUM" || bad "the standing pin.json is gone after the failed build"
[ -s "$WEBROOT/index.html" ] && ok "which is still serving bytes" || bad "the floor stopped serving"
grep -q '"status": "failed"' "$REPORT" && ok "and the board says failed" || bad "board: $(cat "$REPORT")"
# and the state file was NOT advanced, so the next tick retries rather than
# believing it already built this town
grep -q "\"town_sha\": \"$FINAL_TOWN\"" "$ROOT/state.json" && ok "the state still names the last SUCCESSFUL build, so the next tick retries" || bad "state advanced past a failed build"

head_ "11 · AN UNKNOWN INSTALLED SOURCE NEVER CLAIMS THE FLOOR, AND A PIN FAILURE PUBLISHES NOTHING (POS-601)"
cp "$SANDBOX/npm.default" "$SANDBOX/bin/npm"
LOCK_WITH_FLOOR="$(cat "$SITE_SRC/package-lock.json")"
# A release whose lockfile holds no postmark-world entry, then main names the floor again: the
# EXTRACT tree still has F (so a floor fallback would be tempting), the BUILD tree cannot say.
printf '%s\n' '{ "name": "fake-site", "version": "0.0.0", "lockfileVersion": 3, "requires": true, "packages": {} }' > "$SITE_SRC/package-lock.json"
git -C "$SITE_SRC" commit -qam "a release whose lockfile names no world"
git -C "$SITE_SRC" tag -a release/2026-w37 -m "cut"
printf '%s\n' "$LOCK_WITH_FLOOR" > "$SITE_SRC/package-lock.json"
git -C "$SITE_SRC" commit -qam "main names the floor again"
run
check "exit 0 (the build is not stopped by a lockfile that cannot say)" "$RC" "0"
check "the extract's pin still says installed = F (the tempting wrong answer)" "$(jget "$EXT" world_installed)" "$WORLD_FLOOR"
check "PUBLISHED world_installed is null, not the floor" "$(jget "$PIN" world_installed)" "<null>"
[ "$(jget "$PIN" world_installed)" != "$WORLD_FLOOR" ] && ok "and in particular it is not F" || bad "THE FLOOR WAS CLAIMED AS INSTALLED"
check "world_pin is still the floor" "$(jget "$PIN" world_pin)" "$WORLD_FLOOR"
jget "$PIN" notes | grep -q "holds no postmark-world entry" && jget "$PIN" notes | grep -q "NOT substituted" && ok "and the pin says why, and that the floor was not substituted" || bad "no honest note: $(jget "$PIN" notes)"
check "build.json agrees that nothing is known" "$(jget "$WEBROOT/build.json" world_sha)" "<null>"

printf '%s\n' '{ this is not json' > "$SITE_SRC/package-lock.json"
git -C "$SITE_SRC" commit -qam "a release whose lockfile is unreadable"
git -C "$SITE_SRC" tag -a release/2026-w38 -m "cut"
printf '%s\n' "$LOCK_WITH_FLOOR" > "$SITE_SRC/package-lock.json"
git -C "$SITE_SRC" commit -qam "main names the floor again, again"
run
check "exit 0" "$RC" "0"
check "an UNREADABLE build lockfile: world_installed is null" "$(jget "$PIN" world_installed)" "<null>"
jget "$PIN" notes | grep -q "could not be read" && ok "and the pin says the lockfile could not be read" || bad "no unreadable note: $(jget "$PIN" notes)"

# A PIN THAT CANNOT NAME ITS FLOOR DOES NOT SHIP: the extract wrote none, the publish stops, the standing release serves on.
STANDING="$(readlink -f "$WEBROOT")"
[ -f "$PIN" ] && ok "a published pin.json exists before the failing tick" || bad "no published pin.json before the failing tick, so the byte check below could pass vacuously"
PIN_SUM_BEFORE="$(sha256sum < "$PIN" 2>/dev/null)"
echo "crossing 9" >> "$TOWN_SRC/WHITE_PAGES/mail-ledger.md"
git -C "$TOWN_SRC" commit -qam "a tick whose extract writes no pin"
run SELFTEST_NO_PIN=1
check "no pin from the extract: exit 1, loudly" "$RC" "1"
echo "$OUT" | grep -q "the world pin could not be written" && ok "and it says why" || bad "no pin failure line: $OUT"
check "the webroot still points at the standing release" "$(readlink -f "$WEBROOT")" "$STANDING"
[ -f "$PIN" ] && check "whose pin.json is byte-for-byte what it was" "$(sha256sum < "$PIN")" "$PIN_SUM_BEFORE" || bad "the published pin.json is gone after the failing tick"

# THE HELPER MISSING: a copy of the script with no site-refresh-pin.mjs beside it
# dies by NAME at the preflight, before any build, and publishes nothing.
mkdir -p "$SANDBOX/lonely"
cp "$SCRIPT" "$SANDBOX/lonely/site-refresh.sh"
SCRIPT_KEEP="$SCRIPT"; SCRIPT="$SANDBOX/lonely/site-refresh.sh"
STANDING="$(readlink -f "$WEBROOT")"
echo "crossing 10" >> "$TOWN_SRC/WHITE_PAGES/mail-ledger.md"
git -C "$TOWN_SRC" commit -qam "a tick on a box missing the helper"
run
SCRIPT="$SCRIPT_KEEP"
check "the helper missing: exit 1" "$RC" "1"
echo "$OUT" | grep -q "the pin helper is missing" && ok "and it names the helper, not the extract" || bad "no helper-missing line: $OUT"
echo "$OUT" | grep -q "pass 1 —" && bad "it started a build before saying the helper is missing" || ok "before any build was started"
check "the webroot still points at the standing release" "$(readlink -f "$WEBROOT")" "$STANDING"

# ═══════════════════════════════════════════════════════════════════════════

echo
echo "───────────────────────────────────────────"
echo "site-refresh selftest: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ] || exit 1
