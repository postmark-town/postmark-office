// settlement-registry.mjs — the crossing's household registry, decided rather
// than copied.
//
//   node deploy/settlement-registry.mjs --fresh <exported households.json> \
//        --world <sweep clone> --town-sha <the sha this crossing pinned>
//
// ── WHY THIS IS A FILE AND NOT A `node -e` IN THE CHAIN ──────────────────────
//
// Same argument deploy/settlement-retry.sh makes for itself: a decision inlined
// in settlement-auto.sh can only ever be exercised by a real crossing on a real
// box, which is to say never. As its own module it is a falsifier's first
// argument (test/crossing-refreshes-the-registry.test.mjs drives it with a
// registry that moved, one that did not, and a stamp that names the wrong tree).
//
// ── WHAT IT DECIDES ──────────────────────────────────────────────────────────
//
// 1. THE STAMP MUST NAME THIS CROSSING'S OWN TOWN. The export resolves
//    `town_sha` from the town clone it actually read. This asserts that sha is
//    the one the crossing pinned, and REFUSES otherwise. A registry stamped with
//    a tree other than the one its values came out of is a confident lie in
//    precisely the shape the receipt's own `rehearsal` field already guards
//    against ("the same defect as a freshness stamp naming a source it did not
//    come from") — and it is worse here, because the file outlives the crossing
//    on world main where three readers take it as live.
//
// 2. THE FILE IS REWRITTEN ONLY WHEN THE MAPPING MOVED. The export stamps a
//    fresh `generated_at` on every run, so copying it in unconditionally would
//    put a commit on world main every twelve hours forever, whether or not one
//    household changed — and would turn every quiet crossing into a crossing
//    that moved main. So the SUBSTANCE (`households` + `logins`) is compared
//    against the copy already committed in the sweep clone, and only a real
//    difference is written.
//
//    WHAT THAT MAKES `town_sha` MEAN, said out loud because a reader will ask:
//    it is the town this registry was DERIVED from, not the last town that was
//    CHECKED. An older sha means the mapping has not moved since — it does not
//    mean nobody looked. The receipt is where "did this crossing look" is
//    answered, on every crossing, including the ones that changed nothing.
//
// 3. IT SAYS WHAT MOVED. `added`, `removed` and `rekeyed` are carried by name
//    rather than as counts: a handle that LOST its household grouping, or was
//    re-keyed under a different credential, changes which parcels the fold
//    admits and which sketchbooks the wall can bind. A count would make an
//    ordinary new resident and a re-key look the same on the receipt.
//
// Output: one JSON object on stdout. Exit 0 decided, 1 refused (with `refused`
// and `detail` on the object, the shape the chain's other helpers use).

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

const args = process.argv.slice(2);
const opt = (name, def = null) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };

const FRESH = opt("--fresh");
const WORLD = opt("--world");
const TOWN_SHA = opt("--town-sha");
const REL = "WORLD/households.json";

const refuse = (reason, detail) => {
  process.stdout.write(`${JSON.stringify({ refused: reason, detail }, null, 1)}\n`);
  process.exit(1);
};

if (!FRESH || !WORLD || !TOWN_SHA)
  refuse("usage", "settlement-registry.mjs --fresh <file> --world <clone> --town-sha <sha>");

let fresh;
try { fresh = JSON.parse(readFileSync(FRESH, "utf8")); }
catch (e) { refuse("the export produced no readable registry", `${FRESH}: ${String(e?.message ?? e).slice(0, 200)}`); }

// ── 1. the stamp names its own source, or nothing is written ────────────────
if (fresh.town_sha !== TOWN_SHA)
  refuse("the registry's freshness stamp names a different town than this crossing pinned",
    `the export stamped town_sha ${JSON.stringify(fresh.town_sha)} and this crossing pinned ${TOWN_SHA} — `
    + "a registry whose stamp names a tree its values did not come from is worse than a stale one, "
    + "because the staleness is no longer visible to anyone reading it");

if (!fresh.households || typeof fresh.households !== "object")
  refuse("the export produced no households map", `keys: ${Object.keys(fresh).join(", ")}`);

// ── 2. what is already committed in the clone ───────────────────────────────
const dest = join(WORLD, REL);
let prior = null;
try { prior = JSON.parse(readFileSync(dest, "utf8")); } catch { /* first refresh, or no registry in this world */ }

// `admins` (WLD-21) is substance too: a role granted or revoked with no handle moving is a change the World's gates read.
const substance = (r) => JSON.stringify([r?.households ?? null, r?.logins ?? null, r?.admins ?? []]);

// ── WRITE WHEN THE MAPPING MOVED, *OR* WHEN THE STANDING FILE IS UNSTAMPED ───
//
// The second clause is what makes "verified" imply "stamped" on the world's
// side, and it is not a tidy-up. A registry with no `town_sha` has never been
// written by this export — it is the 2026-08-07 file exactly — and the world
// refuses a crossing that claims to have verified such a file, because a
// verified registry is a written one. Without this clause a first refresh that
// happened to find the mapping already correct would leave the file unstamped
// and unattributable while the crossing declared it verified, which is a claim
// nothing on either side could check.
//
// It fires at most once per world: the moment it writes, the file is stamped.
const unstamped = !prior?.town_sha;
const changed = substance(prior) !== substance(fresh) || unstamped;

// ── 3. what moved, by name ──────────────────────────────────────────────────
const ph = prior?.households ?? {};
const fh = fresh.households;
const added = Object.keys(fh).filter((h) => !(h in ph)).sort();
const removed = Object.keys(ph).filter((h) => !(h in fh)).sort();
const rekeyed = Object.keys(fh).filter((h) => h in ph && ph[h] !== fh[h])
  .sort().map((h) => ({ handle: h, from: ph[h], to: fh[h] }));
const pa = new Set(prior?.admins ?? []), fa = new Set(fresh.admins ?? []);
const adminsGained = [...fa].filter((k) => !pa.has(k)).sort();
const adminsLost = [...pa].filter((k) => !fa.has(k)).sort();

if (changed) {
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, `${JSON.stringify(fresh, null, 2)}\n`);
}

// ── 4. the sentences the crossing says about it ─────────────────────────────
//
// Composed HERE and not in the shell, for settlement-receipt.mjs's own reason:
// a message assembled with printf is a message nobody extends. The commit is
// what a resident reads months later when they ask why their household changed
// grouping on that date, so it names the town it came from and what moved.
const short = String(fresh.town_sha).slice(0, 9);
const movedLine = [
  added.length ? `${added.length} handle(s) added` : null,
  removed.length ? `${removed.length} removed` : null,
  rekeyed.length ? `${rekeyed.length} re-keyed` : null,
  adminsGained.length ? `admin: ${adminsGained.join(", ")}` : null,
  adminsLost.length ? `admin no longer: ${adminsLost.join(", ")}` : null,
].filter(Boolean).join(", ") || "no membership change";

const commitMessage = `settlement: household registry re-derived from the town at ${short}

${Object.keys(fh).length} handle(s) → ${new Set(Object.values(fh)).size} household(s), `
  + `${Object.keys(fresh.logins ?? {}).length} login(s). ${movedLine}.
${prior?.generated_at ? `The copy this replaces was generated ${prior.generated_at}.` : "There was no registry in this world before."}

Derived by postmark-office/tools/world-households-export.mjs from the town clone
this crossing pinned, and committed BEFORE the fold — which reads this file for
the parcel-claim cap and the consent gate, and before the sweep, whose authorship
wall has no flag with which to read anything else.
${added.length ? `\nadded: ${added.join(", ")}` : ""}${removed.length ? `\nremoved: ${removed.join(", ")}` : ""}${rekeyed.length ? `\nre-keyed: ${rekeyed.map((r) => `${r.handle} ${r.from} -> ${r.to}`).join(", ")}` : ""}
`;

process.stdout.write(`${JSON.stringify({
  ran: true,
  changed,
  // THE SHA THIS REGISTRY WAS VERIFIED AGAINST ON THIS CROSSING, which is the
  // town the crossing pinned — NOT the stamp the file carries. A registry the
  // refresh re-derived and found unchanged keeps an older stamp and is fresh;
  // the world reads this field and never compares the two for equality. That
  // comparison was the first cut of this lane and it would have refused every
  // crossing after a quiet one.
  verified_at: TOWN_SHA,
  commit_message: commitMessage,
  summary: changed
    ? `verified against town ${TOWN_SHA.slice(0, 9)} and REWRITTEN: ${Object.keys(fh).length} handle(s) → ${new Set(Object.values(fh)).size} household(s), ${Object.keys(fresh.logins ?? {}).length} login(s); ${movedLine}${unstamped ? " (the standing file carried no town_sha — first refresh)" : ""}`
    : `verified against town ${TOWN_SHA.slice(0, 9)} and IDENTICAL to what world main already carries — nothing committed, and the file's older stamp is not staleness`,
  // THE STAMP THE FILE THAT NOW STANDS ACTUALLY CARRIES — not the stamp of the
  // derivation this crossing threw away. When nothing changed, the standing file
  // keeps its older stamp, and reporting the fresh derivation's would name a
  // value from a different source than the thing the field names. That is the
  // very class this lane exists to end, and the receipt had it: a crossing that
  // wrote nothing reported a town_sha the committed file did not carry. Caught
  // by reading the two-crossing rehearsal's own receipt against origin.
  town_sha: changed ? fresh.town_sha : (prior?.town_sha ?? null),
  generated_at: fresh.generated_at ?? null,
  // The stamp the file carried BEFORE this crossing. On the first refresh after
  // the 2026-08-07 export this reads `2026-08-07T12:58:17.724Z`, which is the
  // number that made this step necessary; leaving it on the receipt is how the
  // next reader can see the gap closing rather than take it on trust.
  previous_generated_at: prior?.generated_at ?? null,
  previous_town_sha: prior?.town_sha ?? null,
  handles: Object.keys(fh).length,
  households: new Set(Object.values(fh)).size,
  logins: Object.keys(fresh.logins ?? {}).length,
  added,
  removed,
  rekeyed,
  admins: fresh.admins ?? [],
  admins_gained: adminsGained,
  admins_lost: adminsLost,
}, null, 1)}\n`);
