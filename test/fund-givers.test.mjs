// fund-givers.test.mjs — POS-550: a gift shows the household that gave it.
//
// Gifts to a pot are household-scoped (POS-317), but the ledger files each one
// under the household's first resident (`pot-receipt · … · from: keith`), so
// every read that named a giver named one resident for the whole house's money.
// DISPLAY ONLY (Darko, 2026-10-09): the ledger line, the close and the holo mint
// still read the handle. Each giver a door shows is now
// `{ household, household_key, handle }`, read from the store's registry; an
// `outside:*` payer is still an outside gift.
//
// The registry here is the store's (acts-pen-stub's three registry SELECTs), and
// the pot rows are office.db's, so the only way a read can name the house is to
// ask the store.
//
// THE FLIP: make queries.mjs § withGivers return the board it was handed (drop
// the lookup) and the household tests go red.
//
//   node --test test/fund-givers.test.mjs

import test, { after } from "node:test";
import assert from "node:assert/strict";

const { installActsPen, uninstallActsPen, RECORD_ON } = await import("./acts-pen-stub.mjs");
const { rowsFromRegistry } = await import("../src/registry-rows.mjs");

// Shard House holds two residents; keith is its first, so the ledger files the
// house's gifts under him. Lone holds no house at all.
const STORE = rowsFromRegistry({ schema_version: 1, households: {
  "shard-house": { name: "shard-house", residents: ["keith", "quill"], accounts: [{ login: "noprotocol-keith", id: 302359603 }] },
  "deva-commons": { name: "Deva's Commons", residents: ["deva"], accounts: [{ login: "deva-gh", id: 7 }] },
} }, { keith: { login: "noprotocol-keith", id: 302359603 }, deva: { login: "deva-gh", id: 7 } });
process.env.WORLD2_PG = RECORD_ON.WORLD2_PG;
process.env.WORLD2_PG_URL = RECORD_ON.WORLD2_PG_URL;
delete process.env.TOWN_INDEX_READS; // the office.db door; the store's twin shares withGivers
installActsPen({ households: STORE.households, pins: STORE.pins, meta: [] });
after(() => { uninstallActsPen(); delete process.env.WORLD2_PG; delete process.env.WORLD2_PG_URL; });

const { giversOf, giverLookup, OUTSIDE_GIFT } = await import("../src/households.mjs");
const { officeIndex, potBoard } = await import("../src/queries.mjs");
const { fundRead } = await import("../src/household-stamps.mjs");
const { householdApex } = await import("../src/household-apex.mjs");

// office.db's pot rows: keith's gift (settled, so it is on the roll too), an
// outside gift, deva's, and lone's.
const POT = { pot: "meeps-fund", status: "open", title: "The meeps' fund", beneficiary: "the-town", target_usd_per_epoch: 100, received_usd: 0, epoch_cadence: "monthly", close: "epoch" };
const RECEIPTS = [
  { rail: "stripe", usd: 15, date: "2026-10-05", receipt: "cs_keith", payer: "keith" },
  { rail: "stripe", usd: 10, date: "2026-10-06", receipt: "cs_out", payer: "outside:stripe" },
  { rail: "paypal", usd: 20, date: "2026-10-07", receipt: "pp_deva", payer: "deva" },
  { rail: "paypal", usd: 5, date: "2026-10-08", receipt: "pp_lone", payer: "lone" },
];
const ROLL = [{ patron: "keith", usd: 15, date: "2026-10-05", receipt: "cs_keith", holo: 2 }];
const potDb = {
  prepare: (sql) => ({
    all: () => (/FROM pots\b/.test(sql) ? [{ id: POT.pot, json: JSON.stringify(POT) }]
      : /FROM pot_receipts\b/.test(sql) ? RECEIPTS
      : /FROM funding_roll\b/.test(sql) ? ROLL : []),
    get: () => undefined,
  }),
};

const SHARD = { household: "shard-house", household_key: "hh:shard-house", handle: "keith" };
const OUTSIDE = { outside: true, says: OUTSIDE_GIFT };

test("giversOf: a resident's gift names their household; an outside payer stays an outside gift", () => {
  const of = giversOf(STORE);
  assert.deepEqual(of("keith"), SHARD, "keith's gift is Shard House's, the house of two");
  assert.deepEqual(of("quill"), { ...SHARD, handle: "quill" }, "the second resident names the same house");
  assert.deepEqual(of("deva"), { household: "Deva's Commons", household_key: "hh:deva-commons", handle: "deva" }, "the row's own name, as written");
  assert.deepEqual(of("lone"), { household: null, household_key: "solo:lone", handle: "lone" }, "a handle no house holds has no house name");
  assert.deepEqual(of("outside:stripe"), OUTSIDE);
  assert.equal(OUTSIDE_GIFT, "an outside gift");
});

test("the pot board a door reads names every giver's household, on the roll and on the receipts", async () => {
  const board = await officeIndex(potDb, {}, null).potBoard();
  const pot = board.list.find((p) => p.id === "meeps-fund");
  assert.deepEqual(pot.patrons.roll[0].giver, SHARD, "the roll's patron is keith; the giver is his house");
  assert.equal(pot.patrons.roll[0].patron, "keith", "the ledger's handle is kept beside it, unchanged");
  const byRef = Object.fromEntries(pot.receipts.list.map((x) => [x.receipt, x]));
  assert.deepEqual(byRef.cs_keith.giver, SHARD);
  assert.equal(byRef.cs_keith.payer, "keith", "display only: the receipt's payer is still the handle the ledger filed");
  assert.deepEqual(byRef.cs_out.giver, OUTSIDE);
  assert.equal(byRef.pp_deva.giver.household, "Deva's Commons");
  assert.equal(pot.receipts.sum_usd, 50, "the money is untouched");
  // the index's own board carries no giver: the household is added at the door
  assert.equal(potBoard(potDb).list[0].receipts.list[0].giver, undefined);
});

test("household { read: \"fund\" } names the household behind each gift", async () => {
  const answer = await householdApex({ read: "fund" }, { household: "hh:shard-house", handles: new Set(["keith", "quill"]) }, { db: potDb });
  assert.equal(answer.read, "fund");
  const pot = answer.pots.find((p) => p.pot === "meeps-fund");
  assert.deepEqual(pot.gifts.list.map((g) => [g.usd, g.giver.outside ? g.giver.says : g.giver.household]),
    [[15, "shard-house"], [10, OUTSIDE_GIFT], [20, "Deva's Commons"], [5, null]]);
  assert.deepEqual(pot.gifts.list[0], { date: "2026-10-05", usd: 15, giver: SHARD });
  assert.equal(pot.gifts.total, 4);
});

test("a store that cannot be asked leaves the board as the index answered it, and the fund read says null", async () => {
  uninstallActsPen();
  delete process.env.WORLD2_PG; delete process.env.WORLD2_PG_URL;
  try {
    assert.equal(await giverLookup(), null);
    const board = await officeIndex(potDb, {}, null).potBoard();
    assert.equal(board.list[0].receipts.list[0].giver, undefined);
    const answer = await fundRead(null, { db: potDb });
    assert.equal(answer.pots[0].gifts.list[0].giver, null, "null is could-not-look, never a guessed house");
  } finally {
    process.env.WORLD2_PG = RECORD_ON.WORLD2_PG; process.env.WORLD2_PG_URL = RECORD_ON.WORLD2_PG_URL;
    installActsPen({ households: STORE.households, pins: STORE.pins, meta: [] });
  }
});
