// backed-reads-the-store.test.mjs — the leave-mark read's `backed` list and its
// `yours` read the store's registry, the roster `residents` reads (POS-573,
// POS-545's remainder; the store is the record, ruled 10-04).
//
// Until POS-573 `backed` asked the town ledger's pins (`currentHouseholdOf`)
// which stakes were the caller's household's, while `residents` asked the
// store. Here the two registries disagree on purpose:
//
//   · gamma: the pins file them under house-a, the store under house-c.
//   · delta: the pins know them only as themselves, the store houses them in house-a.
//
// THE FLIP: put `belongs` (the pins) back as the filter and `yours`, and gamma's
// stake comes back as the caller's while delta's drops off.
//
//   node --test test/backed-reads-the-store.test.mjs

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

const OFFICE = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scratch = mkdtempSync(join(tmpdir(), "postmark-backed-store-"));
after(() => { try { rmSync(scratch, { recursive: true, force: true }); } catch { /* litter */ } });

// ── the town: its stake derive, with the PINS' households ──────────────────
const town = join(scratch, "town");
mkdirSync(join(town, "tools"), { recursive: true });
const PINS_HOUSE = { alpha: "house-a", gamma: "house-a", delta: "solo:delta" };
writeFileSync(join(town, "tools", "world-stake.mjs"), `
const PINS_HOUSE = ${JSON.stringify(PINS_HOUSE)};
export function worldStakeState() { return { currentHouseholdOf: (h) => PINS_HOUSE[h] ?? "solo:" + h }; }
export function deriveWorldMarkWeights() {
  return { rows: [
    { holder: "alpha", mark: "alpha/own-note", n: 1, weight: 1 },
    { holder: "gamma", mark: "gamma/far-note", n: 2, weight: 2 },
    { holder: "delta", mark: "delta/near-note", n: 3, weight: 3 },
  ] };
}
export function retirementBlocked() { return null; }
`);

// ── the record: the store's registry, which the roster reads ───────────────
const REGISTERED = { schema_version: 1, households: {
  "house-a": { name: "house-a", accounts: [], residents: ["alpha", "delta"] },
  "house-c": { name: "house-c", accounts: [], residents: ["gamma"] } } };
const { installActsPen, uninstallActsPen, RECORD_ON } = await import("./acts-pen-stub.mjs");
const { rowsFromRegistry } = await import("../src/registry-rows.mjs");
const STORE = rowsFromRegistry(REGISTERED, {});
process.env.WORLD2_PG = RECORD_ON.WORLD2_PG;
process.env.WORLD2_PG_URL = RECORD_ON.WORLD2_PG_URL;
installActsPen({ households: STORE.households, pins: STORE.pins, meta: [] });
after(() => { uninstallActsPen(); delete process.env.WORLD2_PG; delete process.env.WORLD2_PG_URL; });

process.env.TOWN_CLONE = town;
const { worldPortfolioStakeSlice } = await import(pathToFileURL(join(OFFICE, "src", "world-stake.mjs")).href);

const MARKS = [
  { id: "alpha/own-note", by: "alpha" },
  { id: "gamma/far-note", by: "gamma" },
  { id: "delta/near-note", by: "delta" },
];

test("POS-573: backed and yours read the store's registry, the roster residents reads", async () => {
  const key = { household: "house-a", handles: new Set(["alpha"]) };
  const slice = await worldPortfolioStakeSlice(key, MARKS);
  assert.deepEqual(slice.residents, ["alpha", "delta"], "the roster is the store's house-a (POS-545)");
  assert.deepEqual(slice.backed.map((row) => ({ id: row.id, holder: row.holder, yours: row.yours })), [
    { id: "alpha/own-note", holder: "alpha", yours: true },
    { id: "delta/near-note", holder: "delta", yours: true },
  ], "delta's stake is this house's by the store, and gamma's is not, whatever the pins say");
});

test("POS-573: with no store to ask, backed narrows to the key's own handles, as residents does", async () => {
  uninstallActsPen();
  delete process.env.WORLD2_PG;
  delete process.env.WORLD2_PG_URL;
  try {
    const key = { household: "house-a", handles: new Set(["alpha"]) };
    const slice = await worldPortfolioStakeSlice(key, MARKS);
    assert.deepEqual(slice.residents, ["alpha"]);
    assert.deepEqual(slice.backed.map((row) => row.holder), ["alpha"], "the pins are not asked in the store's place");
  } finally {
    process.env.WORLD2_PG = RECORD_ON.WORLD2_PG;
    process.env.WORLD2_PG_URL = RECORD_ON.WORLD2_PG_URL;
    installActsPen({ households: STORE.households, pins: STORE.pins, meta: [] });
  }
});
