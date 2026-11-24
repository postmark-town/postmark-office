#!/usr/bin/env bash
# deploy/uat/witness-anchor.sh — UAT's witness keeps its own chain, anchored to UAT's own key (POS-1215).
#
#   sudo bash deploy/uat/witness-anchor.sh
#
# The witness signs with WITNESS_KEY and publishes only when the town's WITNESS/witness-pubkey.pem is that
# key's public half (tools/witness-chain.mjs § THE KEY BINDING). UAT's town stub is seeded from prod's town, so
# it carries prod's anchor and prod's chain, and UAT's own key can never publish: every record stays owed.
# Ruled (Wright, POS-1215, 2026-11-24): UAT starts its own active chain with its own key and public anchor; the
# copied prod chain stays as an untouched archive; the witness and stamp keys stay distinct. No code changes.
#
# So, in UAT's stub only (it never reaches GitHub): the copied WITNESS/records and witness-pubkey.pem move
# unchanged to WITNESS/prod-copy-archive/, and WITNESS/witness-pubkey.pem becomes the public half of UAT's
# witness key. UAT's chain then starts at record 1 at its next publish, which pays the owed queue.
# Idempotent: if the stub's anchor is already UAT's key, it says so and changes nothing.
# Run after the stubs, UAT's keys and the frozen release are in place (README § The order).

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/lib.sh"
uat_require_root
uat_refuse_prod
uat_require_marker

STUB=/srv/uat-stubs/postmark.git
KEY=/srv/postmark-office/witness-key.pem
STAMP=/srv/postmark-office/stamp-key.pem
WC=/srv/postmark-office/src/town-pins/tools/witness-chain.mjs
[ -d "$STUB" ] || uat_die "no town stub at $STUB: run stubs.sh first"
[ -f "$KEY" ] || uat_die "no UAT witness key at $KEY (README § The order)"
[ -f "$STAMP" ] || uat_die "no UAT stamp key at $STAMP (README § The order)"
[ -f "$WC" ] || uat_die "no pinned witness-chain.mjs at $WC: carry the frozen release first"

# Key ids only, through the witness's own functions; no key is ever printed. The placeholder first argument keeps the module's path off
# argv[1]: witness-chain.mjs runs its own CLI when argv[1] is itself.
kid() { # <private|public> <pem file>
  node --input-type=module -e '
    import { readFileSync } from "node:fs";
    const { keyIdOf, publicPemOf } = await import(process.argv[2]);
    const pem = readFileSync(process.argv[4], "utf8");
    console.log(keyIdOf(process.argv[3] === "private" ? publicPemOf(pem) : pem));' uat-witness-anchor "$WC" "$1" "$2"
}
W_ID="$(kid private "$KEY")"
S_ID="$(kid private "$STAMP")"
[ "$W_ID" != "$S_ID" ] || uat_die "UAT's witness key is its stamp key: the witness signs with its own key (make a separate one)"

WORK="$(mktemp -d /tmp/uat-witness-anchor.XXXXXX)"; chown "$UAT_USER" "$WORK"
trap 'rm -rf "$WORK"' EXIT
asuat() { runuser -u "$UAT_USER" -- "$@"; }
asuat git clone -q -b main "$STUB" "$WORK/town"
cd "$WORK/town"

if [ -f WITNESS/witness-pubkey.pem ] && [ "$(kid public WITNESS/witness-pubkey.pem)" = "$W_ID" ]; then
  uat_say "the stub's witness anchor is already UAT's key ($W_ID): nothing to do"; exit 0
fi
[ ! -e WITNESS/prod-copy-archive ] || uat_die "WITNESS/prod-copy-archive exists but the anchor is not UAT's key: read the stub by hand"

asuat mkdir -p WITNESS/prod-copy-archive
[ -d WITNESS/records ] && asuat git mv WITNESS/records WITNESS/prod-copy-archive/records
[ -f WITNESS/witness-pubkey.pem ] && asuat git mv WITNESS/witness-pubkey.pem WITNESS/prod-copy-archive/witness-pubkey.pem
node --input-type=module -e '
  import { readFileSync, writeFileSync } from "node:fs";
  const { publicPemOf } = await import(process.argv[2]);
  writeFileSync(process.argv[4], publicPemOf(readFileSync(process.argv[3], "utf8")));' uat-witness-anchor "$WC" "$KEY" "$WORK/pub.pem"
grep -q PRIVATE "$WORK/pub.pem" && uat_die "the anchor would carry private material: stop"
asuat cp "$WORK/pub.pem" WITNESS/witness-pubkey.pem
asuat git add -A WITNESS
asuat git commit -q -m "UAT: its own witness chain, anchored to UAT's own witness key (POS-1215)

UAT only; this commit lives in UAT's local stub and never reaches GitHub. The copied prod chain and
prod's anchor move unchanged to WITNESS/prod-copy-archive/; WITNESS/witness-pubkey.pem is the public
half of UAT's WITNESS_KEY ($W_ID). The chain starts at record 1 at the next publish."
flock -w 300 /srv/postmark-office/town.lock runuser -u "$UAT_USER" -- git push -q origin HEAD:main
uat_say "the stub's witness anchor is UAT's key ($W_ID); prod's copied chain is archived under WITNESS/prod-copy-archive/"
