// world-households-pinned-ids.test.mjs — WLD-122: the export binds a GitHub
// account by its PINNED NUMERIC ID, and by nothing a person can choose.
//
// "Bind pinned ids" (Darko, AUTHORITY 2026-10-27T17:33:26.677Z). The World's PR
// lane must know which household a pull request's author belongs to. `logins`
// is not that table: it also binds sketchbook names (a house's own slug, a solo
// resident's handle), so a GitHub account named like a house would read as the
// house. `pinned_ids` is the table, and the rule is Bevel's Settled reading of
// the EXISTING derivation (2026-10-30 03:53Z):
//   · only a pin seeds an id; a declared account list alone never does;
//   · the house is the exported household of the id's pinned handles and, for a
//     pinned id, the declared house listing it — exactly one, or none at all;
//   · a retired pin is a pin (055 keeps it in its house);
//   · two houses (incl. two unhoused handles = two solo: houses) bind nothing.
//
// Synthetic registry rows only. The integration test renders through the real
// export on the suite's Postgres (helpers/office-under-test.mjs).
//
// THE FLIPS: make the projection last-wins and the conflict tests go red; seed
// ids from declared accounts and the account-list-only test goes red; drop the
// field from the export and the integration test goes red.
//
//   node --test test/world-households-pinned-ids.test.mjs

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { pinnedAccountKeys, worldHouseholdsFromStore, sketchbookKeys } from "../src/household-logins.mjs";
import { registryStoreForTowns, seedRegistry } from "./helpers/office-under-test.mjs";

const OFFICE = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// ── the projection, pure ─────────────────────────────────────────────────────

test("A SHARED HOUSE: two handles pinned to one account in one house bind that account to the house", () => {
  const r = pinnedAccountKeys({
    pins: { ana: { login: "ana-gh", id: 11 }, kin: { login: "ana-gh", id: 11 } },
    households: { ana: "hh:ana-house", kin: "hh:ana-house", bo: "hh:bo-house" },
    declared: { households: { "ana-house": { accounts: [{ login: "ana-gh", id: 11 }] } } },
  });
  assert.deepEqual(r, { ids: { 11: "hh:ana-house" }, conflicts: [], malformed: [] });
});

test("A RETIRED PIN IS A PIN: an account whose only pin is retired still binds its house (055 keeps it)", () => {
  const r = pinnedAccountKeys({
    pins: { old: { login: "old-gh", id: 21, retired: "2026-10-01" } },
    households: { old: "hh:old-house" },
    declared: { households: {} },
  });
  assert.deepEqual(r.ids, { 21: "hh:old-house" });
});

test("AN ACCOUNT LIST ALONE NEVER SEEDS AN ID; a removed pin binds nothing", () => {
  const r = pinnedAccountKeys({
    pins: { ana: { login: "ana-gh", id: 11 } },
    // 99 is on a declared house's account list but no pin names it; bo's pin was removed
    households: { ana: "hh:ana-house", bo: "hh:bo-house" },
    declared: { households: { "bo-house": { accounts: [{ login: "bo-gh", id: 99 }], residents: ["bo"] } } },
  });
  assert.deepEqual(r.ids, { 11: "hh:ana-house" });
  assert.equal(r.ids[99], undefined, "an id only an account list names is not bound");
});

test("AN UNHOUSED SOLO resident's pin binds its solo: house", () => {
  const r = pinnedAccountKeys({ pins: { wren: { login: "wren-gh", id: 31 } }, households: { wren: "solo:wren" }, declared: {} });
  assert.deepEqual(r.ids, { 31: "solo:wren" });
});

test("TWO HOUSES BIND NOTHING: handles in two houses, two unhoused handles (two solo: houses), or a pin that disagrees with a declared account list — each named, never a winner", () => {
  const cross = pinnedAccountKeys({
    pins: { a: { login: "x", id: 41 }, b: { login: "x", id: 41 } },
    households: { a: "hh:one", b: "hh:two" }, declared: {},
  });
  assert.deepEqual(cross, { ids: {}, conflicts: [{ id: "41", keys: ["hh:one", "hh:two"] }], malformed: [] });
  const solos = pinnedAccountKeys({
    pins: { p: { login: "y", id: 42 }, q: { login: "y", id: 42 } },
    households: { p: "solo:p", q: "solo:q" }, declared: {},
  });
  assert.deepEqual(solos.ids, {});
  assert.deepEqual(solos.conflicts, [{ id: "42", keys: ["solo:p", "solo:q"] }]);
  const disagree = pinnedAccountKeys({
    pins: { r: { login: "z", id: 43 } },
    households: { r: "hh:r-house" },
    declared: { households: { "other-house": { accounts: [{ login: "z", id: 43 }] } } },
  });
  assert.deepEqual(disagree.ids, {});
  assert.deepEqual(disagree.conflicts, [{ id: "43", keys: ["hh:other-house", "hh:r-house"] }]);
  // the same rows in any order give the same answer: nothing hangs on iteration order
  const flipped = pinnedAccountKeys({ pins: { b: { login: "x", id: 41 }, a: { login: "x", id: 41 } }, households: { b: "hh:two", a: "hh:one" }, declared: {} });
  assert.deepEqual(flipped, cross);
});

test("A PIN WITH NO USABLE NUMERIC ID binds nothing and is named; a digit string is an id", () => {
  const pins = {};
  const households = {};
  const bad = ["abc", 0, -5, 1.5, null, "12a", "", " ", "007", Number.MAX_SAFE_INTEGER + 2];
  bad.forEach((id, i) => { pins[`h${i}`] = { login: `l${i}`, id }; households[`h${i}`] = `solo:h${i}`; });
  pins.ok = { login: "ok-gh", id: "512" };
  households.ok = "hh:ok-house";
  const r = pinnedAccountKeys({ pins, households, declared: {} });
  assert.deepEqual(r.ids, { 512: "hh:ok-house" });
  assert.deepEqual(r.malformed.sort(), bad.map((_, i) => `h${i}`).sort());
  assert.deepEqual(r.conflicts, []);
});

test("A LOGIN IS NOT AN ID: an account named like a house or a solo resident binds only through its own pin", () => {
  // the sketchbook aliases a login map carries are not in this table at all
  const declared = { households: { "rose-house": { accounts: [{ login: "rose", id: 51 }], residents: ["rose"] } } };
  const households = { rose: "hh:rose-house", wren: "solo:wren" };
  const pins = { rose: { login: "rose", id: 51 }, wren: { login: "wren", id: 52 } };
  const { ids } = pinnedAccountKeys({ pins, households, declared });
  assert.deepEqual(ids, { 51: "hh:rose-house", 52: "solo:wren" });
  assert.ok(!Object.keys(ids).some((k) => !/^[1-9][0-9]*$/.test(k)), "every key is a numeric id, never a login or a house name");
});

test("DETERMINISTIC: ids sort numerically and the answer does not depend on input order", () => {
  const households = { a: "solo:a", b: "solo:b", c: "solo:c" };
  const one = pinnedAccountKeys({ pins: { a: { id: 100 }, b: { id: 9 }, c: { id: 20 } }, households, declared: {} });
  const two = pinnedAccountKeys({ pins: { c: { id: 20 }, a: { id: 100 }, b: { id: 9 } }, households, declared: {} });
  assert.deepEqual(Object.keys(one.ids), ["9", "20", "100"]);
  assert.equal(JSON.stringify(one), JSON.stringify(two));
});

// ── the export, on the suite's store ─────────────────────────────────────────

const scratch = mkdtempSync(join(tmpdir(), "postmark-pinned-ids-"));
after(() => { try { rmSync(scratch, { recursive: true, force: true }); } catch { /* litter */ } });
const REG = await registryStoreForTowns({ db: "pinned_ids_test" });
after(() => REG.stop());

const ANA = { login: "ana-gh", id: 1 }, KIN = { login: "kin-gh", id: 2 };
// ana and kin share ana-house under two accounts; rose's account is both rose's
// pin and on rose-house's list; dual is one account pinned to two unhoused
// handles (two solo: houses); listed-only (77) is on a house list with no pin.
await seedRegistry(REG.store, { schema_version: 1, households: {
  "ana-house": { name: "Ana House", accounts: [ANA, KIN], residents: ["ana", "kin"], since: "2026-01-01", declared_by: "ana" },
  "rose-house": { name: "Rose House", accounts: [{ login: "rose", id: 3 }, { login: "listed-only", id: 77 }], residents: ["rose"], since: "2026-01-01", declared_by: "rose" },
} }, {
  ana: ANA, kin: KIN, rose: { login: "rose", id: 3 },
  "dual-a": { login: "dual", id: 4 }, "dual-b": { login: "dual", id: 4 },
  wren: { login: "wren", id: 5, retired: "2026-10-01" },
});

function exportTo(label) {
  const world = join(scratch, `${label}-world`);
  mkdirSync(join(world, "WORLD"), { recursive: true });
  const base = { ...process.env };
  delete base.WORLD2_PG; delete base.WORLD2_PG_URL;
  const res = spawnSync(process.execPath, [join(OFFICE, "tools", "world-households-export.mjs"), "--town", join(scratch, "no-town"), "--world", world],
    { encoding: "utf8", env: { ...base, ...REG.env }, timeout: 60_000 });
  const file = join(world, "WORLD", "households.json");
  return { res, emitted: existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null };
}

test("THE EXPORT emits pinned_ids from the store: shared house, a retired pin, a solo house; the two-solo account and the list-only id are left out and named", () => {
  const { res, emitted } = exportTo("pinned");
  assert.equal(res.status, 0, `the export must complete: ${res.stderr}`);
  assert.deepEqual(emitted.pinned_ids, { 1: "hh:ana-house", 2: "hh:ana-house", 3: "hh:rose-house", 5: "solo:wren" });
  assert.equal(emitted.pinned_ids[4], undefined, "one account behind two unhoused handles binds nothing");
  assert.equal(emitted.pinned_ids[77], undefined, "an account list alone seeds nothing");
  assert.match(res.stderr, /PINNED ID NOT BOUND — account 4 resolves to solo:dual-a, solo:dual-b/);
  assert.match(emitted.pinned_ids_note, /never falls back to logins or households/);
});

test("THE EXPORT'S EXISTING MAPS DO NOT MOVE: households, logins (sketchbook aliases included) and admins are what the existing derivation gives; the new fields ride after them", () => {
  const { emitted } = exportTo("same");
  assert.deepEqual(Object.keys(emitted), ["generated_at", "town_sha", "source", "note", "logins_note", "households", "logins", "admins_note", "admins", "pinned_ids_note", "pinned_ids"]);
  // recompute the old maps from the same rows with the unchanged functions
  const identities = Object.entries(emitted.households).map(([handle, household]) => ({ handle, household }));
  const pins = { ana: ANA, kin: KIN, rose: { login: "rose", id: 3 }, "dual-a": { login: "dual", id: 4 }, "dual-b": { login: "dual", id: 4 }, wren: { login: "wren", id: 5 } };
  const one = worldHouseholdsFromStore({ identities, pins, declared: { households: {
    "ana-house": { accounts: [ANA, KIN], residents: ["ana", "kin"] },
    "rose-house": { accounts: [{ login: "rose", id: 3 }, { login: "listed-only", id: 77 }], residents: ["rose"] },
  } } });
  assert.deepEqual(emitted.households, { ana: "hh:ana-house", "dual-a": "solo:dual-a", "dual-b": "solo:dual-b", kin: "hh:ana-house", rose: "hh:rose-house", wren: "solo:wren" });
  for (const [login, key] of Object.entries(one.logins)) assert.equal(emitted.logins[login], key, `logins[${login}] keeps its meaning`);
  // the sketchbook aliases stay in logins: a house's own slug and a solo resident's handle
  assert.equal(emitted.logins["ana-house"], "hh:ana-house");
  assert.equal(emitted.logins["dual-a"], "solo:dual-a");
  assert.ok(sketchbookKeys(emitted.households, emitted.logins).additions, "the second-key pass still composes on the exported map");
  assert.deepEqual(emitted.admins, []);
});
