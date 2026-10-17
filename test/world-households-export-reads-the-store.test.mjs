// world-households-export-reads-the-store.test.mjs — the world's registry is rendered from the store.
//
// POS-350: tools/world-households-export.mjs is the RENDERER of
// WORLD/households.json, and the registry it renders is the store's
// (`households` / `household_pins`), never the town clone's printouts
// (tools/households.json, tools/github-ids.json). A store it cannot read is a
// refusal (exit 2, nothing written), so the crossing publishes nothing rather
// than a file from a printout.
//
// The export's other suites re-state the store FROM their fixture towns, so
// there the store and the printouts always agree and neither half of that rule
// could go red. Here they disagree: the printouts file kin in a house of their
// own and pin only ana, and the store has moved kin into ana's house and pins
// both. Since 2026-10-13 the derivation is the store's alone
// (src/household-logins.mjs § worldHouseholdsFromStore: `identities`, the pins,
// the declared houses); the settlement snapshot keeps the ledger's road for a
// past register (§ worldHouseholdsAt, POS-410).
//
// THE FLIPS: read the printouts instead of the store and the first test goes
// red; drop the exit-2 guards and the refusals write a file; read the town
// ledger again and the empty-town test goes red.
//
//   node --test test/world-households-export-reads-the-store.test.mjs

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { registryStoreForTowns, seedRegistry } from "./helpers/office-under-test.mjs";

const OFFICE = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scratch = mkdtempSync(join(tmpdir(), "postmark-export-store-"));
after(() => { try { rmSync(scratch, { recursive: true, force: true }); } catch { /* litter */ } });
const REG = await registryStoreForTowns({ db: "export_store_test" });
after(() => REG.stop());

// The ledger's keys (the town's own resolver), one per account.
const LEDGER = { ana: "gh:1", kin: "gh:2" };
const ANA = { login: "ana-gh", id: 1 }, KIN = { login: "kin-gh", id: 2 };

// THE PRINTOUTS: kin alone, and only ana pinned.
const town = join(scratch, "town");
mkdirSync(join(town, "tools"), { recursive: true });
writeFileSync(join(town, "tools", "stamp-mint.mjs"),
  `export function currentHouseholds() { return new Map(${JSON.stringify(Object.entries(LEDGER).map(([h, key]) => [h, { key }]))}); }\n`);
writeFileSync(join(town, "tools", "github-ids.json"), JSON.stringify({ ana: ANA }));
writeFileSync(join(town, "tools", "households.json"), JSON.stringify({ schema_version: 1, households: {
  "ana-house": { name: "Ana House", accounts: [ANA], residents: ["ana"] },
  "kin-alone": { name: "Kin Alone", accounts: [KIN], residents: ["kin"] },
} }));

// THE RECORD: the ceremony has moved kin into ana's house, and both are pinned.
await seedRegistry(REG.store, { schema_version: 1, households: {
  "ana-house": { name: "Ana House", accounts: [ANA, KIN], residents: ["ana", "kin"], since: "2026-01-01", declared_by: "ana" },
} }, { ana: ANA, kin: KIN });

function exportTo(label, env) {
  const world = join(scratch, `${label}-world`);
  mkdirSync(join(world, "WORLD"), { recursive: true });
  const base = { ...process.env };
  delete base.WORLD2_PG; delete base.WORLD2_PG_URL;
  const res = spawnSync(process.execPath, [join(OFFICE, "tools", "world-households-export.mjs"), "--town", town, "--world", world],
    { encoding: "utf8", env: { ...base, ...env }, timeout: 60_000 });
  const file = join(world, "WORLD", "households.json");
  return { res, file, emitted: existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null };
}

test("the world file renders the store's houses and pins, not the printouts'", () => {
  const { res, emitted } = exportTo("store", REG.env);
  assert.equal(res.status, 0, `the export must complete: ${res.stderr}`);
  assert.equal(emitted.households.kin, "hh:ana-house", "the store files kin in ana's house; the printout's kin-alone is not the record");
  assert.equal(emitted.households.ana, "hh:ana-house");
  assert.equal(emitted.logins["kin-gh"], "hh:ana-house", "kin's pin is the store's; the printout never pinned kin");
  assert.equal(emitted.logins["kin-alone"], undefined, "a house only the printout holds binds no sketchbook");
});

test("an office not pointed at the store refuses: exit 2, nothing written", () => {
  const { res, file } = exportTo("off", {});
  assert.equal(res.status, 2, `expected the refusal, got ${res.status}: ${res.stderr}`);
  assert.match(res.stderr, /not pointed at the store/);
  assert.equal(existsSync(file), false, "a refusal writes no world file");
});

test("a store the export cannot read refuses: exit 2, nothing written", () => {
  const { res, file } = exportTo("dead", { WORLD2_PG: "1", WORLD2_PG_URL: "postgres://office_api@127.0.0.1:9/none" });
  assert.equal(res.status, 2, `expected the refusal, got ${res.status}: ${res.stderr}`);
  assert.match(res.stderr, /could not be read/);
  assert.equal(existsSync(file), false, "a refusal writes no world file");
});

// ── THE STORE ALONE (POS-350 gap 3, Wright 2026-10-13) ───────────────────────
//
// The export's base was the town ledger's resolver (`currentHouseholds` over the
// town checkout); it is now the store's `identities`. So no value may come from a
// town checkout at all: with an EMPTY town directory the export still renders the
// store. THE FLIP: put `worldHouseholdsAt(TOWN, { currentHouseholds }, …)` back
// and this exits 1 (there is no stamp-mint.mjs to import).
test("no town checkout is read: an empty town still renders the store's registry", () => {
  const empty = join(scratch, "no-town");
  mkdirSync(empty, { recursive: true });
  const world = join(scratch, "empty-town-world");
  mkdirSync(join(world, "WORLD"), { recursive: true });
  const base = { ...process.env };
  delete base.WORLD2_PG; delete base.WORLD2_PG_URL;
  const res = spawnSync(process.execPath, [join(OFFICE, "tools", "world-households-export.mjs"), "--town", empty, "--world", world],
    { encoding: "utf8", env: { ...base, ...REG.env }, timeout: 60_000 });
  assert.equal(res.status, 0, `the export must complete without a town: ${res.stderr}`);
  const emitted = JSON.parse(readFileSync(join(world, "WORLD", "households.json"), "utf8"));
  assert.deepEqual(emitted.households, { ana: "hh:ana-house", kin: "hh:ana-house" });
  assert.equal(emitted.logins["ana-gh"], "hh:ana-house");
  assert.equal(emitted.logins["kin-gh"], "hh:ana-house");
  assert.equal(emitted.town_sha, null, "no town was read, so none is named");
  assert.deepEqual(Object.keys(emitted), ["generated_at", "town_sha", "source", "note", "logins_note", "households", "logins"],
    "the file's shape does not move");
});

// Where the ledger and the store agree (every handle housed, every account on
// its house), the two derivations answer byte-equal maps. Measured on prod's
// own store on 2026-10-13 the same way: 262 households and 307 logins, equal.
test("the store's derivation and the ledger's agree byte for byte on an agreeing registry", async () => {
  const { worldHouseholdsFromStore, worldHouseholdsAt } = await import("../src/household-logins.mjs");
  const declared = { households: { "ana-house": { accounts: [ANA, KIN], residents: ["ana", "kin"], formerly: ["anas-old-name"] } } };
  const pins = { ana: ANA, kin: KIN };
  const fromStore = worldHouseholdsFromStore({ identities: [{ handle: "kin", household: "hh:ana-house" }, { handle: "ana", household: "hh:ana-house" }], pins, declared });
  const fromLedger = worldHouseholdsAt(scratch, { currentHouseholds: () => new Map(Object.entries(LEDGER).map(([h, key]) => [h, { key }])) }, { pins, declared });
  assert.equal(JSON.stringify(fromStore), JSON.stringify(fromLedger));
});
