// choose-once.test.mjs — A PROVISIONAL HOUSE CHOOSES ITS KEY ONCE (POS-159).
//
// RULED (Keemin, 2026-09-22): a house that never declared gets a PROVISIONAL key
// from its first resident's handle. At its human's FIRST co-sign — a declaration
// through `mintHousehold` naming a real slug — it chooses its key ONCE: the
// row's slug becomes the chosen one, the provisional key lands in `formerly`,
// `provisional` goes false, and from then on the key is immutable like everyone
// else's.
//
// ── WHY A RENAME AND NOT A SECOND MINT ──────────────────────────────────────
//
// Minting would leave the resident in TWO households — the provisional one
// nobody can now find, and the declared one — and no pen in this store holds
// DELETE (019), so nothing could clean it up afterwards. So the row moves in
// place, and the falsifiers below count rows rather than trust the call.
//
// ── "ITS PINS FOLLOW", AND WHAT THAT ACTUALLY MEANS HERE ────────────────────
//
// The ruling says the house's pins follow it. Measured against the schema:
// `household_pins` carries `handle`, `login`, `gh_id` and four legacy notes
// (019) and NO household reference of any kind. There is nothing in that table
// pointing at a slug, so a rename cannot leave anything pointing at the old one.
// The belonging lives in `households.residents`, which is a column OF the row
// being renamed and therefore travels with it. The falsifier below asserts the
// substance — every resident of the house still resolves to it under the new
// key, and not one pin row was written — rather than a re-pointing that the
// table has no column for.
//
// THE POOL IS STUBBED, NOT MOCKED AROUND, the way every suite in this lane's
// family does it. The stub answers the real UPDATE the rename sends and
// enforces the primary key, so "one row, renamed" is a measurement.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { __setPoolForTest } from "../src/world2-acts.mjs";
import { makePool } from "./registry-pool-stub.mjs";
import { rowsFromRegistry, registryFromRows, renderRegistry } from "../src/registry-rows.mjs";
import { houseForAccount } from "../src/residency.mjs";
import { mintHousehold, joinHousehold, REFUSALS, NO_DRAIN } from "../src/ceremony.mjs";
import { rowForHouse } from "../src/registry-backfill.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = join(HERE, "fixtures", "registry-2026-09-22");
const HOUSEHOLDS_RAW = readFileSync(join(FIX, "households.json"), "utf8");
const PINS_RAW = readFileSync(join(FIX, "github-ids.json"), "utf8");

const ENV_ON = { WORLD2_PG: "1", WORLD2_PG_URL: "postgres://stub/none" };

// The human who never declared, and their agent.
const HUMAN = { ghId: 770000123, ghLogin: "a-quiet-human" };
const HANDLE = "fernwood";

/**
 * The town, plus ONE provisional house exactly as the backfill would write it.
 *
 * Built through `rowForHouse` rather than by hand, so this suite and
 * `registry-backfill.test.mjs` cannot drift about what a backfilled row is.
 */
function townWithAProvisionalHouse() {
  const seed = rowsFromRegistry(JSON.parse(HOUSEHOLDS_RAW), JSON.parse(PINS_RAW));
  const ord = Math.max(...seed.households.map((r) => Number(r.ord))) + 1;
  const row = rowForHouse({
    slug: HANDLE,
    name: "Fernwood's household",
    accounts: [{ login: HUMAN.ghLogin, id: HUMAN.ghId }],
    residents: [HANDLE, "fern-sibling"],
    since: "2026-08-14",
    declared_by: "the POS-159 backfill",
    pins: [],
  });
  seed.households.push({ ...row, ord });
  seed.pins.push(
    { handle: HANDLE, login: HUMAN.ghLogin, gh_id: String(HUMAN.ghId), pinned: "2026-08-14",
      renamed: null, note: null, retired: null, renamed_to: null },
    { handle: "fern-sibling", login: HUMAN.ghLogin, gh_id: String(HUMAN.ghId), pinned: "2026-08-20",
      renamed: null, note: null, retired: null, renamed_to: null },
  );
  return seed;
}

const withTown = async (fn, seed = townWithAProvisionalHouse()) => {
  const pool = makePool(seed);
  __setPoolForTest(pool);
  try { return await fn(pool); } finally { __setPoolForTest(null); }
};

const houseIn = (pool, slug) => pool.state.households.find((h) => h.slug === slug);

test("the fixture this suite reasons about is the shape the backfill writes", async () => {
  await withTown(async (pool) => {
    const row = houseIn(pool, HANDLE);
    assert.equal(row.provisional, true);
    assert.deepEqual(row.formerly, []);
    assert.equal(pool.state.households.length, 119);
  });
});

// ── THE CHOICE ──────────────────────────────────────────────────────────────

test("the first co-sign RENAMES the provisional house instead of founding a second", async () => {
  await withTown(async (pool) => {
    const before = houseIn(pool, HANDLE).ord;

    const r = await mintHousehold({
      slug: "fernwood-hollow", name: "Fernwood Hollow", coSign: HUMAN,
      since: "2026-09-22", declaredBy: "the first co-sign", env: ENV_ON, drain: NO_DRAIN,
    });

    assert.equal(r.slug, "fernwood-hollow");
    assert.deepEqual(r.chose, { from: HANDLE, confirmed: false }, "the answer SAYS it was a choice, not a founding");

    // ONE ROW. This is the whole falsifier: a mint would have made 120.
    assert.equal(pool.state.households.length, 119, "still 119 houses — nothing was founded");
    assert.equal(houseIn(pool, HANDLE), undefined, "the provisional key is gone from the record");

    const row = houseIn(pool, "fernwood-hollow");
    assert.ok(row, "and the house stands under the chosen key");
    assert.deepEqual(row.formerly, [HANDLE], "the old key is KEPT, not dropped");
    assert.equal(row.provisional, false);
    assert.equal(row.name, "Fernwood Hollow", "a declaration that states a name states it");
    assert.equal(row.ord, before, "and the house keeps its standing place in the file");
    assert.deepEqual(row.residents, [HANDLE, "fern-sibling"], "its residents came with it");
    assert.deepEqual(row.accounts, [{ login: HUMAN.ghLogin, id: HUMAN.ghId }]);
    assert.equal(row.since, "2026-08-14", "and its own since, not the declaration's");
  });
});

test("the pins follow, which here means not one of them had to move", async () => {
  await withTown(async (pool) => {
    const pinsBefore = JSON.parse(JSON.stringify(pool.state.pins));
    await mintHousehold({
      slug: "fernwood-hollow", coSign: HUMAN, since: "2026-09-22",
      declaredBy: "x", env: ENV_ON, drain: NO_DRAIN,
    });

    assert.equal(pool.state.writes.pins, 0, "no pin row was written — the table has no household column");
    assert.deepEqual(pool.state.pins, pinsBefore);

    // and the substance: every resident still reaches the house, under the new key
    const registry = registryFromRows({
      meta: pool.state.meta,
      households: pool.state.households,
      pins: pool.state.pins,
    });
    assert.equal(houseForAccount(registry, HUMAN.ghId, HUMAN.ghLogin), "fernwood-hollow");
    assert.deepEqual(registry.households["fernwood-hollow"].residents, [HANDLE, "fern-sibling"]);
  });
});

test("a house confirming the key it already carries keeps it, and appends nothing", async () => {
  // A resident declaring the very slug the backfill lent them is not a
  // collision — it is "this borrowed name is the one". The answer is to stop
  // calling it borrowed, not to refuse them with TAKEN.
  await withTown(async (pool) => {
    const r = await mintHousehold({
      slug: HANDLE, coSign: HUMAN, since: "2026-09-22", declaredBy: "x",
      env: ENV_ON, drain: NO_DRAIN,
    });
    assert.equal(r.slug, HANDLE);
    assert.deepEqual(r.chose, { from: HANDLE, confirmed: true });

    const row = houseIn(pool, HANDLE);
    assert.equal(row.provisional, false, "it is no longer borrowed");
    assert.deepEqual(row.formerly, [], "and it never had a different key to remember");
    assert.equal(pool.state.households.length, 119);
  });
});

test("a declaration that states NO name leaves the borrowed nameplate standing", async () => {
  await withTown(async (pool) => {
    await mintHousehold({
      slug: "fernwood-hollow", coSign: HUMAN, since: "2026-09-22",
      declaredBy: "x", env: ENV_ON, drain: NO_DRAIN,
    });
    assert.equal(houseIn(pool, "fernwood-hollow").name, "Fernwood's household",
      "silence is not an instruction to clear the house's name");
  });
});

// ── ONCE ────────────────────────────────────────────────────────────────────

test("a SECOND choice is refused — the key is immutable from the first one", async () => {
  await withTown(async (pool) => {
    await mintHousehold({ slug: "fernwood-hollow", coSign: HUMAN, since: "2026-09-22",
      declaredBy: "x", env: ENV_ON, drain: NO_DRAIN });

    await assert.rejects(
      () => mintHousehold({ slug: "a-better-name", coSign: HUMAN, since: "2026-09-22",
        declaredBy: "x", env: ENV_ON, drain: NO_DRAIN }),
      (e) => e.refusal === REFUSALS.CHOSEN && e.code === 409);

    assert.equal(pool.state.households.length, 119, "and nothing was founded on the way out");
    assert.ok(houseIn(pool, "fernwood-hollow"), "the house still stands under the key it chose");
    assert.equal(houseIn(pool, "a-better-name"), undefined);
  });
});

test("re-declaring the very key it just chose is refused too", async () => {
  await withTown(async (pool) => {
    await mintHousehold({ slug: "fernwood-hollow", coSign: HUMAN, since: "2026-09-22",
      declaredBy: "x", env: ENV_ON, drain: NO_DRAIN });
    await assert.rejects(
      () => mintHousehold({ slug: "fernwood-hollow", coSign: HUMAN, since: "2026-09-22",
        declaredBy: "x", env: ENV_ON, drain: NO_DRAIN }),
      (e) => e.refusal === REFUSALS.CHOSEN || e.refusal === REFUSALS.TAKEN);
    assert.equal(pool.state.households.length, 119);
  });
});

test("the CHOSEN refusal is frozen, exported, and says what a person should do", () => {
  assert.ok(Object.isFrozen(REFUSALS.CHOSEN));
  assert.equal(REFUSALS.CHOSEN.code, 409);
  assert.equal(REFUSALS.CHOSEN.field, "household");
  assert.ok(REFUSALS.CHOSEN.defect.length && REFUSALS.CHOSEN.hint.length);
  assert.notEqual(REFUSALS.CHOSEN, REFUSALS.TAKEN, "it is its own sentence, not an alias");
});

// ── WHO MAY CHOOSE ──────────────────────────────────────────────────────────

test("ANOTHER account naming the provisional house's key is refused exactly as today", async () => {
  // The choice belongs to the house's own human. A stranger naming the
  // provisional slug meets the ordinary collision, and nothing renames.
  const STRANGER = { ghId: 880000999, ghLogin: "not-their-human" };
  await withTown(async (pool) => {
    await assert.rejects(
      () => mintHousehold({ slug: HANDLE, coSign: STRANGER, since: "2026-09-22",
        declaredBy: "x", env: ENV_ON, drain: NO_DRAIN }),
      (e) => e.refusal === REFUSALS.TAKEN);
    assert.equal(houseIn(pool, HANDLE).provisional, true, "the house is still provisional");
    assert.deepEqual(houseIn(pool, HANDLE).formerly, []);
  });
});

test("a stranger founding a DIFFERENT house is untouched by any of this", async () => {
  const STRANGER = { ghId: 880000999, ghLogin: "not-their-human" };
  await withTown(async (pool) => {
    const r = await mintHousehold({ slug: "a-stranger-house", coSign: STRANGER,
      since: "2026-09-22", declaredBy: "x", env: ENV_ON, drain: NO_DRAIN });
    assert.equal(r.slug, "a-stranger-house");
    assert.ok(!("chose" in r), "an ordinary mint does not claim to have chosen anything");
    assert.equal(pool.state.households.length, 120, "THIS one really is a new house");
    assert.equal(houseIn(pool, "a-stranger-house").provisional, false);
    assert.equal(houseIn(pool, HANDLE).provisional, true, "and the provisional house is untouched");
  });
});

test("the house's human choosing a key SOMEBODY ELSE holds is refused", async () => {
  // One choice is not a claim on the roll. The ordinary collision sentence
  // applies, and the house stays provisional so they can choose again.
  await withTown(async (pool) => {
    await assert.rejects(
      () => mintHousehold({ slug: "fox-hearth", coSign: HUMAN, since: "2026-09-22",
        declaredBy: "x", env: ENV_ON, drain: NO_DRAIN }),
      (e) => e.refusal === REFUSALS.TAKEN);
    assert.equal(houseIn(pool, HANDLE).provisional, true, "still theirs to choose");
    assert.equal(pool.state.households.length, 119);
  });
});

test("an unlawful key is refused BEFORE the record is read, provisional house or not", async () => {
  await withTown(async (pool) => {
    await assert.rejects(
      () => mintHousehold({ slug: "Not A Slug", coSign: HUMAN, since: "2026-09-22",
        declaredBy: "x", env: ENV_ON, drain: NO_DRAIN }),
      (e) => e.refusal === REFUSALS.BAD_SLUG);
    assert.equal(houseIn(pool, HANDLE).provisional, true);
  });
});

// ── A RESIDENT JOINING DOES NOT CHOOSE ──────────────────────────────────────

test("a resident joining a provisional house leaves it provisional", async () => {
  // The choice is the HUMAN's co-sign at the mint, not an admission. And this
  // is the probe for the other half: `joinHousehold` writes the whole row back
  // through `upsertHousehold`, so a `provisional` it failed to carry would be
  // silently cleared by an ordinary join.
  await withTown(async (pool) => {
    const r = await joinHousehold({ slug: HANDLE, handle: "a-new-fern", coSign: HUMAN,
      pinnedOn: "2026-09-22", env: ENV_ON, drain: NO_DRAIN });
    assert.deepEqual(r.residents, [HANDLE, "fern-sibling", "a-new-fern"]);
    assert.equal(houseIn(pool, HANDLE).provisional, true, "still provisional after an admission");
    assert.deepEqual(houseIn(pool, HANDLE).formerly, []);
  });
});

test("a resident joining an ORDINARY house does not make it provisional either", async () => {
  await withTown(async (pool) => {
    await joinHousehold({ slug: "fox-hearth", handle: "a-new-sibling", coSign: HUMAN,
      env: ENV_ON, drain: NO_DRAIN });
    assert.equal(houseIn(pool, "fox-hearth").provisional, false);
  });
});

// ── THE STOP: NO DOOR REACHES THIS PATH YET ─────────────────────────────────
//
// MEASURED, not assumed. All three callers of `mintHousehold` — `declare-exec.mjs`,
// `residency.mjs` and `town-drain.mjs` — call it only when their plan says
// `action === "created"`, and that plan comes from `planRegistryJoin`. For an
// account whose house is PROVISIONAL, `houseForAccount` finds that house, and
// the planner returns `appended` — so the mint is never called and the house
// never chooses. The ceremony below is complete and falsified above; the ROUTE
// to it is not built, and wiring one is a change to the declaration door's plan
// shape rather than a line in this lane.
//
// THIS TEST ASSERTS TODAY'S BEHAVIOUR ON PURPOSE. It is not approval of it. The
// day somebody wires the route, this reds and hands them this paragraph, which
// is the whole reason to write down a gap rather than only mention it.

test("THE STOP: a provisional house's human does not reach the mint through the door", async () => {
  const { planRegistryJoin } = await import("../src/residency.mjs");
  const seed = townWithAProvisionalHouse();
  const registry = registryFromRows(seed);
  assert.equal(registry.households[HANDLE].provisional, true);

  for (const household of ["Fernwood Hollow", HANDLE, ""]) {
    const plan = planRegistryJoin(registry, {
      handle: "fernwood-two", household, ghId: HUMAN.ghId, ghLogin: HUMAN.ghLogin, date: "2026-09-22",
    });
    assert.equal(plan?.action, "appended",
      `naming ${JSON.stringify(household)} appends to the provisional house rather than founding`);
    assert.equal(plan?.slug, HANDLE, "and the borrowed key stands");
    assert.notEqual(plan?.action, "created", "so no caller of mintHousehold fires");
  }

  // AND THE CONTROL, so the probe is measuring reachability and not just
  // agreeing with itself: a human with NO house does reach the mint.
  const control = planRegistryJoin(registry, {
    handle: "somebody-new", household: "A Brand New House",
    ghId: 880000999, ghLogin: "a-total-stranger", date: "2026-09-22",
  });
  assert.equal(control?.action, "created", "a houseless human still founds");
});

test("THE STOP's second half: the name they declare is dropped on the floor", async () => {
  // The resident types "Fernwood Hollow" on the household line. The plan
  // appends them to `fernwood`, keeps the borrowed nameplate, and nothing
  // anywhere tells them the name they chose was not taken.
  const { planRegistryJoin } = await import("../src/residency.mjs");
  const registry = registryFromRows(townWithAProvisionalHouse());
  const plan = planRegistryJoin(registry, {
    handle: "fernwood-two", household: "Fernwood Hollow",
    ghId: HUMAN.ghId, ghLogin: HUMAN.ghLogin, date: "2026-09-22",
  });
  assert.equal(plan.houseLine, "Fernwood's household", "the borrowed name is what the card will read");
  assert.notEqual(plan.houseLine, "Fernwood Hollow");
});

// ── THE FILE THE TOWN SEES ──────────────────────────────────────────────────

test("a provisional house renders its key, and a chosen one renders `formerly` instead", async () => {
  await withTown(async (pool) => {
    const render = () => registryFromRows({
      meta: pool.state.meta, households: pool.state.households, pins: pool.state.pins,
    }).households;

    const before = render()[HANDLE];
    assert.equal(before.provisional, true, "the town's file SAYS the key is borrowed");
    assert.ok(!("formerly" in before));

    await mintHousehold({ slug: "fernwood-hollow", coSign: HUMAN, since: "2026-09-22",
      declaredBy: "x", env: ENV_ON, drain: NO_DRAIN });

    const after = render()["fernwood-hollow"];
    assert.ok(!("provisional" in after), "and stops saying it once the key is chosen");
    assert.deepEqual(after.formerly, [HANDLE], "the old key is readable in the town's own file");
    assert.equal(Object.keys(after).at(-1), "formerly");
  });
});

test("the other 118 houses are untouched, and the renamed one keeps its PLACE", async () => {
  // The rename names no `ord`, so the house does not move. A rename that
  // re-derived one would push the house to the end of the file and rewrite
  // every row after it — 118 blocks of diff for one house stating its name.
  await withTown(async (pool) => {
    const fold = () => registryFromRows({
      meta: pool.state.meta, households: pool.state.households, pins: pool.state.pins,
    }).households;

    const before = fold();
    const wasAt = Object.keys(before).indexOf(HANDLE);
    assert.ok(wasAt >= 0);

    await mintHousehold({ slug: "fernwood-hollow", coSign: HUMAN, since: "2026-09-22",
      declaredBy: "x", env: ENV_ON, drain: NO_DRAIN });

    const after = fold();
    assert.equal(Object.keys(after).indexOf("fernwood-hollow"), wasAt, "same place in the file");
    assert.equal(Object.keys(after).length, Object.keys(before).length, "same number of houses");

    // every OTHER house, byte for byte, in the same order
    const others = (o) => Object.entries(o).filter(([s]) => s !== HANDLE && s !== "fernwood-hollow");
    assert.deepEqual(others(after), others(before), "118 houses, not one key moved");

    // and the renamed one really did change — the probe can fail
    assert.notDeepEqual(after["fernwood-hollow"], before[HANDLE]);
  });
});

test("the rendered file changes by exactly the renamed house's own lines", async () => {
  await withTown(async (pool) => {
    const render = () => renderRegistry({
      meta: pool.state.meta, households: pool.state.households, pins: pool.state.pins,
    }).households;

    const before = render();
    await mintHousehold({ slug: "fernwood-hollow", coSign: HUMAN, since: "2026-09-22",
      declaredBy: "x", env: ENV_ON, drain: NO_DRAIN });
    const after = render();

    assert.notEqual(before, after, "the file DID change");
    // The house sheds one line (`"provisional": true`) and gains three
    // (`"formerly": [`, the old key, `]`), so the file is two lines longer.
    assert.equal(after.split("\n").length, before.split("\n").length + 2);
    assert.ok(!after.includes(`"${HANDLE}": {`), "the old key is no longer a household key");
    assert.ok(after.includes(`"fernwood-hollow": {`));
    assert.ok(after.includes(`"${HANDLE}"`), "but it is still readable, in `formerly`");
    assert.ok(!after.includes('"provisional"'), "and nothing in the file is provisional any more");
  });
});
