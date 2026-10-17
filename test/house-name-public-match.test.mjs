// house-name-public-match.test.mjs — a house is found by its key or public name, never by its private human (POS-609).
//
//   node --test --test-concurrency=1 test/house-name-public-match.test.mjs
//
// The name road (household-deriver § VIA.NAME, through residency § houseForName)
// is how a join's `household:` line finds the house it claims (planRegistryJoin)
// and how a declaration is refused as TAKEN (declare § conformance). Matching a
// household's private `human` there let anyone who knew that name claim the
// house, or learn it from a refusal. PURE: invented registry, invented accounts,
// a probe in place of the office db, no clone, no store, no network.

import test from "node:test";
import assert from "node:assert/strict";
import { resolveHouse, VIA } from "../src/household-deriver.mjs";
import { houseForName, houseForAccount, planRegistryJoin } from "../src/residency.mjs";
import { conformance } from "../src/declare.mjs";
import { REFUSALS } from "../src/ceremony.mjs";
import { rowsFromRegistry, renderRegistry, renderPublicRegistry } from "../src/registry-rows.mjs";

const SENTINEL = "Private Sentinel Qzrv";          // copper-gate's private human
const COLLIDER = "Brass Hollow";                   // low-field's private human, and brass-hollow's PUBLIC name

const REG = () => ({
  schema_version: 1,
  households: {
    "copper-gate": { name: "Copper Gate", human: SENTINEL, accounts: [{ login: "cg-gh", id: 9701 }], residents: ["tansy"], since: "2026-08-14" },
    "low-field": { name: "Low Field", human: COLLIDER, accounts: [{ login: "lf-gh", id: 9702 }], residents: ["sedge"], since: "2026-08-15" },
    "brass-hollow": { name: COLLIDER, accounts: [{ login: "bh-gh", id: 9703 }], residents: ["wren"], since: "2026-08-16" },
  },
});
const STRANGER = { ghId: 5555, ghLogin: "stranger-gh", household: "stranger-gh", handles: new Set(), visitor: true };
const NO_RESIDENTS = { hasResident: () => false };
const CARD = "I keep the ledger of small kindnesses for a person who forgets them. Write to me about one you remember.";
const declare = (household, registry) => {
  try { return { ok: conformance({ household, handle: "pos609-newcomer", card: CARD, agent: "Newcomer" }, { db: NO_RESIDENTS, registry, clone: null, key: STRANGER }) }; }
  catch (e) { return { err: e }; }
};
const mentions = (v, ...words) => words.some((w) => JSON.stringify(v ?? null).toLowerCase().includes(w.toLowerCase()));

test("the name road: key and public name find the house; the private human finds nothing", () => {
  const reg = REG();
  const before = JSON.stringify(reg);
  for (const spelled of [SENTINEL, SENTINEL.toLowerCase(), "  private  SENTINEL qzrv ", "private-sentinel-qzrv"]) {
    assert.equal(resolveHouse(spelled, reg, {}, { via: [VIA.SLUG, VIA.NAME] }).slug, null, `resolveHouse "${spelled}"`);
    assert.equal(houseForName(reg, spelled), null, `houseForName "${spelled}"`);
  }
  for (const [spelled, slug] of [["Copper Gate", "copper-gate"], ["copper-gate", "copper-gate"], ["  COPPER gate ", "copper-gate"], ["Low Field", "low-field"]]) {
    assert.equal(houseForName(reg, spelled), slug, `public "${spelled}"`);
  }
  assert.equal(JSON.stringify(reg), before, "the registry is read, never changed");
  assert.equal(reg.households["copper-gate"].human, SENTINEL, "CONTROL: the private human is still stored");
});

test("a private human that equals another house's PUBLIC name finds that house, not its own", () => {
  const reg = REG();
  assert.equal(houseForName(reg, COLLIDER), "brass-hollow");
  assert.equal(houseForName(reg, "brass-hollow"), "brass-hollow");
});

test("the account road is untouched: a verified account still finds its own house", () => {
  const reg = REG();
  assert.equal(houseForAccount(reg, 9701, "cg-gh"), "copper-gate");
  assert.equal(houseForAccount(reg, 9702, "lf-gh"), "low-field");
  assert.equal(houseForAccount(reg, 5555, "stranger-gh"), null);
});

test("residency: a join that types a house's private human does not claim that house", () => {
  const reg = REG();
  const before = JSON.stringify(reg);
  const plan = planRegistryJoin(reg, { handle: "pos609-newcomer", household: SENTINEL, ghId: 5555, ghLogin: "stranger-gh", date: "2026-10-13" });
  assert.ok(plan?.registry, "the join still plans (a house of its own words), it is not dropped");
  assert.notEqual(plan.slug, "copper-gate", "the private name routed no claim onto copper-gate");
  assert.notEqual(plan.action, "appended", "nothing was appended to an existing house");
  assert.equal(mentions({ slug: plan.slug, houseLine: plan.houseLine, name: plan.name, siblings: plan.siblings }, "copper-gate", "Copper Gate", "tansy"), false,
    "what the join prints (slug, house line, name, siblings) does not disclose the house");
  const cg = plan.registry.households["copper-gate"];
  assert.deepEqual(cg.residents, ["tansy"], "copper-gate gained no resident");
  assert.deepEqual(cg.accounts, [{ login: "cg-gh", id: 9701 }], "copper-gate gained no account");
  assert.equal(cg.human, SENTINEL, "the private human is preserved in storage");
  assert.equal(JSON.stringify(reg), before, "the registry handed in is unchanged");

  // CONTROL: the public name still claims (a cold, unvouched join, as before)
  const claim = planRegistryJoin(reg, { handle: "pos609-newcomer", household: "Copper Gate", ghId: 5555, ghLogin: "stranger-gh", date: "2026-10-13" });
  assert.equal(claim.slug, "copper-gate");
  assert.equal(claim.action, "appended");
  assert.equal(claim.vouched, false);
});

test("declaration: a house's private human is not TAKEN — the declaration goes on to its own new slug", () => {
  const reg = REG();
  const before = JSON.stringify(reg);
  for (const spelled of [SENTINEL, "private-sentinel-qzrv", "private.sentinel.qzrv", "  PRIVATE sentinel QZRV "]) {
    const { ok, err } = declare(spelled, reg);
    assert.equal(err, undefined, `"${spelled}" passes the gate (got: ${err?.field} ${err?.refusal === REFUSALS.TAKEN ? "TAKEN" : ""})`);
    assert.equal(ok.slug, "private-sentinel-qzrv", `"${spelled}" plans its OWN new house`);
    assert.equal(ok.handle, "pos609-newcomer");
    assert.equal(mentions(ok, "copper-gate", "Copper Gate"), false, "nothing in the plan points at the house");
  }
  for (const spelled of ["Copper Gate", "copper-gate", "  COPPER gate ", COLLIDER, "brass-hollow"]) {
    assert.equal(declare(spelled, reg).err?.refusal, REFUSALS.TAKEN, `CONTROL: the public "${spelled}" is taken`);
  }
  assert.equal(JSON.stringify(reg), before, "the registry handed in is unchanged");
});

test("not a word blacklist: a PUBLIC name equal to the sentinel text still matches, and is still TAKEN", () => {
  const reg = REG();
  reg.households["sentinel-hall"] = { name: SENTINEL, accounts: [{ login: "sh-gh", id: 9704 }], residents: ["moss"], since: "2026-08-17" };
  assert.equal(houseForName(reg, SENTINEL), "sentinel-hall", "the public name finds its own house (not copper-gate, whose human it is)");
  assert.equal(declare(SENTINEL, reg).err?.refusal, REFUSALS.TAKEN, "and a declaration of it is TAKEN, by the public name");
});

test("the private drain fold still carries the human; the public render does not", () => {
  const rows = rowsFromRegistry(REG(), {});
  assert.ok(renderRegistry(rows).households.includes(SENTINEL), "the private render keeps the human");
  assert.equal(renderPublicRegistry(rows).households.includes(SENTINEL), false, "the public render leaves it out (POS-394, unchanged)");
});
