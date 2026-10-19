#!/usr/bin/env node
// world-households-export.mjs — render the store's household registry into the
// World as WORLD/households.json.
//
// THE STORE IS THE RECORD, THE FILE IS ITS RENDERING (POS-350; Darko 2026-10-04,
// Wright 2026-10-13). The mapping is the store's `identities` view (055: the
// registry walked by the office's one deriver, household-deriver.mjs §
// resolveHouse), the store's pins' logins and its declared houses — composed by
// src/household-logins.mjs § worldHouseholdsFromStore. Until 2026-10-13 its base
// was the town clone's ledger resolver (stamp-mint.mjs currentHouseholds()), a
// second derivation of a fact the store already held. The World's fold consumes it for the parcel-claim cap (Keemin's ruling,
// 2026-07-30: at most 3 parcel claims per credential household; prior estate
// stands). A handle absent from the registry folds as its own household
// (solo:<handle>) — registry lag never blocks a new resident, it only groups
// them once the pins know them.
//
// Run: node tools/world-households-export.mjs [--town <town-clone>] [--world <world-clone>]
//      node tools/world-households-export.mjs --check    (says what would move, writes nothing)
// Writes the file only; committing and pushing the world clone is the caller's.
//
// ── WHO THE CALLER IS, CORRECTED 2026-09-09 ─────────────────────────────────
//
// This header used to say the refresh "belongs with pin churn, not on a timer"
// and is "the caller's act (founder hand or the keeper's crossing sweep)". That
// sentence named no mechanism, so nothing performed it: the file went 33 days
// without a run while `marks-fold.mjs` read it for the parcel cap,
// `mark-lint.mjs` for the consent gate, and `settlement-sweep.mjs` /
// `lane-wall.mjs` for the authorship wall — the last of which has no flag with
// which to read anything else and fails SILENTLY, standing down rather than
// refusing.
//
// THE CALLER IS THE CROSSING. `deploy/settlement-auto.sh` runs this at the start
// of every settlement, against the town clone it pinned, and commits the result
// ahead of the fold when the mapping moved. A hand-run against another town is
// still perfectly legal — that is what the flags are for — which is exactly why
// the emission stamps `town_sha` below rather than trusting its caller.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { sketchbookKeys, worldHouseholdsFromStore } from "../src/household-logins.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const TOWN = resolve(opt("--town", process.env.TOWN_CLONE ?? join(HERE, "..", "town-clone")));
const WORLD = resolve(opt("--world", process.env.WORLD_CLONE ?? join(HERE, "..", "world-clone")));

// THE STORE, AND NOTHING ELSE (POS-350). `identities` (handle → hh:<slug> or
// solo:<handle>), the pins (login → the house holding the account, else its
// gh:<id>) and the declared houses (one key per house, every former slug bound
// to it). The office's household readers ask the store: the store fold, the 1.0
// apex's household (world-apex.mjs § worldHouseholds) and every reader of
// `identities`. What still reads this file: the sweep and lane.yml (until
// POS-365), the rehydrate's walk (office#433 retires it) and law-ingest's
// `roster` rows (the pre-064 snapshot fallback, POS-410). A store this tool cannot read is a refusal (exit 2):
// the crossing then publishes nothing (settlement-auto.sh § REGISTRY EXPORT
// TRIPPED), never a file from a printout.
//
// The ledger's dated `registry:` re-keys (the cadaeic.space unification,
// 2026-08-07) were why the ledger was the base. The switch was measured on
// prod's own store on 2026-10-13: this derivation and the ledger's answered
// byte-equal `households` and `logins` (POS-350, office#518).
const { loadRegistry, loadPins } = await import("../src/registry-store.mjs");
const { actsQuery } = await import("../src/world2-acts.mjs");
const { IDENTITIES_SQL } = await import("../src/world2-fold.mjs");
const [storeRegistry, storePins, identities] = await Promise.all([loadRegistry(), loadPins(), actsQuery(IDENTITIES_SQL)]).catch((e) => {
  console.error(`world-households-export: the store's registry could not be read (${e?.message ?? e}) — nothing written`); process.exit(2);
});
if (storeRegistry === null || storePins === null || identities === null) {
  console.error("world-households-export: this office is not pointed at the store (WORLD2_PG=1 and WORLD2_PG_URL), so it cannot render the registry — nothing written");
  process.exit(2);
}
const one = worldHouseholdsFromStore({ identities, pins: storePins, declared: storeRegistry });
const households = one.households;
const logins = one.logins;

// THE SECOND KEY — every household key no login binds, bound by the sketchbook
// name it will actually carry (src/household-logins.mjs § THE SECOND KEY, which
// carries the whole reasoning). Without it the authorship wall is blind to every
// key shape but `gh:` and `login:`, and blind SILENTLY: the sweep leaves a branch
// it cannot bind alone rather than refusing it, so those households' marks
// publish with their authorship unchecked and nothing on any surface says so.
//
// Merged UNDER the real logins, never over them: a login is a binding the town
// wrote down under review, and this projection may add to the map but must never
// answer a question the pins already answered.
const second = sketchbookKeys(households, logins);

// Each declared house's own sketchbook name (and each former one) binds its key,
// under the real logins: the store writes a house's marks to `draft/<slug>`
// even when a login already binds the house's key.
const houseNames = {};
const carried = new Set(Object.values(households));
for (const [name, key] of Object.entries(one.names)) {
  if (!carried.has(key)) continue;                 // a house no handle here wears binds nothing

  if (Object.prototype.hasOwnProperty.call(logins, name)) {
    if (logins[name] !== key)
      console.error(`[households-export] NOT BOUND — house name "${name}" is already the login of ${logins[name]}, not ${key}`);
    continue;
  }
  houseNames[name] = key;
}
const allLogins = { ...second.additions, ...houseNames, ...logins };

for (const c of second.collisions) {
  console.error(`[households-export] NOT BOUND — "${c.name}" is wanted by ${c.keys.join(", ")}`
    + `${c.holds ? ` and is already the login of ${c.holds}` : ""}; binding it would put one household's `
    + "sketchbook under another household's wall, so it is left unbindable and said out loud");
}
for (const u of second.unnameable) {
  console.error(`[households-export] NOT BOUND — ${u.key} is ${u.reason}`
    + `${u.bound?.length ? ` (${u.bound.join(", ")})` : ""}; there is no honest name to bind it under`);
}

// ── THE FRESHNESS STAMP NAMES ITS OWN SOURCE ────────────────────────────────
//
// `generated_at` says WHEN this file was written and nothing at all about WHAT
// it was written from, so a reader who finds a date three days old cannot tell a
// registry that is merely unchanged from one that nobody re-derived. That is not
// hypothetical: this file sat at `2026-08-07T12:58Z` for thirty-three days while
// three consumers read it as live, and the date alone could not say so.
//
// `town_sha` is the commit of the town clone the caller pointed this run at
// (since POS-350 no value is read from it; the stamp stays, so the file's shape
// does not move and the crossing's guard can still match its pinned town). Resolved
// HERE, from $TOWN itself, and deliberately NOT accepted as a `--town-sha` flag:
// a stamp a caller hands in can name a different tree from the one the values
// came out of, and a stamp naming a source it did not come from is a confident
// lie rather than a missing one. The settlement chain, which is now the caller
// on every crossing, REFUSES to commit a registry whose stamp is not the sha it
// pinned (deploy/settlement-registry.mjs), so this is checked and not trusted.
//
// Null when $TOWN is not a git checkout — a fixture town, an unpacked tarball.
// Null is the honest answer there, and it is the one the chain's guard rejects.
//
// WHAT IT MEANS, because a reader will ask: the town this registry was DERIVED
// from, not the last town that was CHECKED. The crossing re-derives every time
// and rewrites this file only when the mapping itself moves, so an older
// `town_sha` means the mapping has not changed since — never that nobody looked.
// "Did anyone look" is answered on the crossing's receipt, every crossing.
const town_sha = (() => {
  try {
    return execFileSync("git", ["-C", TOWN, "rev-parse", "HEAD"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || null;
  } catch { return null; }
})();

const dest = join(WORLD, "WORLD", "households.json");

// ── THE ADMIN HOUSEHOLDS (WLD-21, Darko 2026-10-18 19:52) ───────────────────
//
// "Derived in ONE record that every gate reads … not by each gate asking
// GitHub." The record is the role book's role `admin` (src/admin-role.mjs, one
// writer: tools/admin-refresh.mjs, run just before this at the crossing); this
// prints it for the World's gates (world tools/admin-makers.mjs, read by
// lane-wall and the live-tree test): the hh:<slug> of every house whose OWN
// account list holds an account with the role. A book this run cannot read keeps
// the file's last answer, said on stderr, and never refuses the crossing (G4).
const admins = await (async () => {
  const { DEFAULT_ROLES_DB, listRoles } = await import("../src/roles.mjs");
  const { openPaper } = await import("../src/paperwork.mjs");
  const { adminHouseholdKeys, ROLE_ADMIN } = await import("../src/admin-role.mjs");
  try {
    const book = await openPaper(DEFAULT_ROLES_DB, { readOnly: true });
    const held = (await listRoles(book, { role: ROLE_ADMIN })).map((r) => r.subject);
    return adminHouseholdKeys(storeRegistry, held);
  } catch (e) {
    let last = [];
    try { last = JSON.parse(readFileSync(join(WORLD, "WORLD", "households.json"), "utf8")).admins ?? []; } catch {}
    console.error(`[households-export] the role book could not be read (${String(e?.message ?? e).slice(0, 120)}); admins keeps the file's last answer: ${last.join(", ") || "none"}`);
    return Array.isArray(last) ? last : [];
  }
})();

const out = {
  generated_at: new Date().toISOString(),
  town_sha,
  source: "the store's household registry (POS-350): identities (055, the office's one deriver over households + household_pins) for every handle, the pins' logins, and one key per declared house — every spelling of a house resolves to its hh:<slug>; no town checkout is read",
  note: "DERIVED registry, refreshed by postmark-office/tools/world-households-export.mjs. Handles absent here fold as their own household (solo:<handle>) — a new resident is never blocked by registry lag, only grouped once the pins know them. Consumed by marks-fold.mjs § parcel admissibility (the claim cap, ruled 2026-07-30); logins consumed by the PR lane (lane-wall, settlement-sweep authorship wall).",
  logins_note: "logins is NOT only GitHub logins. It is the map the authorship wall reads a sketchbook's NAME through, and it binds every household key this registry holds: a pinned handle under its pin's login, and any other key (hh:<house>, solo:<handle>) under the sketchbook name that key carries — the part after its colon. Before 2026-09-09 only gh:/login: keys were bound, so a household of any other shape was invisible to the wall, and invisible SILENTLY: the sweep leaves a branch it cannot bind alone rather than refusing it, so those marks published with their authorship unchecked. A key this file does not bind is a key the export could not name honestly, and it says so on stderr when it happens.",
  households,
  logins: Object.fromEntries(Object.entries(allLogins).sort(([a], [b]) => a.localeCompare(b))),
  admins_note: "admins: the admin households (WLD-21, Darko 2026-10-18), whose GitHub account on the house's own list owns the postmark-town organisation. They may make the three passage classes, dungeon, stairs and portal-ground (world tools/admin-makers.mjs). Printed from the office's role book (role admin, written at each settlement by tools/admin-refresh.mjs); no gate asks GitHub itself.",
  admins,
};


// -- `--check`: SAY WHAT WOULD MOVE, WRITE NOTHING (POS-160) ----------------
//
// The registry drain has had this shape since POS-155/187 -- render, compare,
// name the FIRST difference -- and this export had no equivalent, so the only
// way to learn what a refresh would do to the world's copy was to let it do it.
// That is not good enough for a file three consumers read as live: the parcel
// cap (marks-fold.mjs § admissibility), the consent gate (mark-lint.mjs) and
// the authorship wall (settlement-sweep.mjs / lane-wall.mjs, which fails
// SILENTLY, standing down rather than refusing).
//
// IT COMPARES THE MAPPING, NOT THE BYTES, and the reason is in the file's own
// first two keys. `generated_at` is a clock and `town_sha` is the source this
// run read, so both differ on every honest re-run, and a byte comparison would
// report "differs" every single time -- the cried-wolf red the drain's own
// `--check` is careful not to be. What this compares is the two maps the
// consumers actually read: `households` (handle -> household key) and `logins`
// (sketchbook name -> household key). A difference in either is a difference in
// what the world folds; a difference in the stamps is not.
//
// Exit 1 when the mapping moved, 0 when it did not. Neither is a verdict on
// whether it SHOULD move -- that is a person's call, and on the w40 ship it is
// the open question POS-160 stopped on (finding 3: the parcel cap groups by the
// key STRING over the full history, so a re-spelling that merges two credential
// keys into one declared house re-counts that house's whole estate).
if (args.includes("--check")) {
  let had = null;
  try { had = JSON.parse(readFileSync(dest, "utf8")); }
  catch (e) {
    console.error(`households-export --check: cannot read ${dest} -- ${e?.message}`);
    process.exit(1);
  }
  const compare = (name, mine, theirs) => {
    const keys = [...new Set([...Object.keys(mine ?? {}), ...Object.keys(theirs ?? {})])].sort();
    return { name, total: keys.length, moved: keys.filter((k) => (mine ?? {})[k] !== (theirs ?? {})[k]) };
  };
  const both = [
    compare("households", households, had.households),
    compare("logins", out.logins, had.logins),
    compare("admins", Object.fromEntries(admins.map((k) => [k, true])), Object.fromEntries((had.admins ?? []).map((k) => [k, true]))),
  ];
  const movedAll = both.filter((c) => c.moved.length);
  if (!movedAll.length) {
    console.log(`households-export --check: the mapping is unchanged -- `
      + both.map((c) => `${c.total} ${c.name}`).join(", "));
    console.log("  (generated_at and town_sha are excluded: both differ on every honest re-run)");
    process.exit(0);
  }
  console.error("households-export --check: THE MAPPING MOVED");
  for (const c of movedAll) {
    const mine = c.name === "households" ? households : c.name === "logins" ? out.logins : Object.fromEntries(admins.map((k) => [k, "admin"]));
    const theirs = c.name === "households" ? had.households : c.name === "logins" ? had.logins : Object.fromEntries((had.admins ?? []).map((k) => [k, "admin"]));
    console.error(`  ${c.name}: ${c.moved.length} of ${c.total} entries differ`);
    for (const k of c.moved.slice(0, 10)) {
      console.error(`    ${k}: file has ${theirs?.[k] ?? "(absent)"} -- this run derives ${mine?.[k] ?? "(absent)"}`);
    }
    if (c.moved.length > 10) console.error(`    ... and ${c.moved.length - 10} more`);
  }
  console.error(`  nothing written. Drop --check to write ${dest}.`);
  process.exit(1);
}

writeFileSync(dest, JSON.stringify(out, null, 2) + "\n");
const planted = Object.keys(second.additions).length;
console.log(`households: ${Object.keys(households).length} handles → ${dest}`);
console.log(`admins: ${admins.length ? admins.join(", ") : "none"}`);
console.log(`logins: ${Object.keys(logins).length} from pins + ${planted} second key(s) `
  + `for households no login binds = ${Object.keys(allLogins).length} the wall can read`
  + `${second.collisions.length || second.unnameable.length
    ? ` · ${second.collisions.length + second.unnameable.length} key(s) LEFT UNBINDABLE, named above` : ""}`);
// The store pool keeps the loop alive for its idle timeout; the file is written.
process.exit(0);
