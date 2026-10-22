// wld7-taken-reads.test.mjs — a class taken by the town's own act, in `can` and in the
// chest tick's first stock (WLD-7, G3 and G4; Wright 2026-10-21, the lane's recs).
//
//   G4 · "verbs show only when usable": while a class is taken, `can` offers no verb on a
//        thing of it, on a unit of it in your hands, or on a holder only for what of it
//        it holds; behind ONE switch (TAKEN_IN_CAN, "hide" by default; "show" is world
//        design, Darko's).
//   G3 · the town's first stock MAKES units, and making refuses while their class is
//        taken (2026-10-17, ruling (2)): it waits, says so on its line (read ok by the
//        keep tick), and stocks at the first tick after the return.
//
// THE CAN-FAIL FLIPS: switch TAKEN_IN_CAN to "show"; drop the stock's wait.

import { test } from "node:test";
import assert from "node:assert/strict";
import { usablePairs, canVerbs, canOn, TAKEN_IN_CAN } from "../src/usable-verbs.mjs";
import { classViewOf } from "../src/world-units.mjs";
import { foldUnits, UNIT_ACTION } from "../src/world-stacks.mjs";
import { lawSnapshotFromRows } from "../src/law-classes.mjs";
import { stockChests } from "../world2/tools/chest-stock.mjs";
import { softStepStatus } from "../world2/tools/settlements-backfill.mjs";
import { RESTORE_ROWS_SQL, CLASS_RUN_SQL } from "../src/restored-classes.mjs";

const SHA = "d".repeat(40);
const cls = (key, data = {}) => ({ number: 300, tag_sha: SHA, newest: 300, kind: "class", key, data: { class: key, ...data } });
const prop = (klass, name, dflt, tier, parent = null) => ({ number: 300, tag_sha: SHA, newest: 300, kind: "property",
  key: `${klass}/${name}`, data: { class: klass, parent, name, tier, default: dflt, id: `the-town/${klass}-${name}` } });
const viewWith = (dials) => classViewOf(lawSnapshotFromRows([
  cls("postmark-node"), cls("mark", { extends: "postmark-node" }), cls("sited", { extends: "mark" }), cls("thing", { extends: "sited" }),
  cls("consumable", { extends: "thing" }), cls("trinket", { extends: "consumable", dials }), cls("glass-bead", { extends: "trinket" }),
  cls("biscuit", { extends: "consumable" }), cls("entity", { extends: "postmark-node" }), cls("resident", { extends: "entity" }),
  cls("bowl", { extends: "thing" }),
  prop("postmark-node", "makers", false, "constitution"), prop("thing", "makers", true, "constitution"),
  prop("resident", "holder", true, "constitution"), prop("resident", "capacity", 24, "constitution", "holder"),
  prop("thing", "holder", false, "sovereign"), prop("thing", "capacity", 30, "sovereign", "holder"),
  prop("thing", "min", 1, "constitution", "capacity"), prop("thing", "max", 120, "constitution", "capacity"),
  prop("thing", "open", true, "sovereign", "holder"), prop("thing", "portable", true, "sovereign"), prop("bowl", "holder", true, "constitution"),
]));
const ORDINARY = viewWith({}), TAKEN = viewWith({ stolen: true, clue: "a synthetic clue" });

const HERE = { x: 0, y: 0 };
const mk = (id, over = {}) => ({ id, by: id.split("/")[0], kind: "thing", at: { x: 1, y: 1 }, extent: { w: 2, h: 2 }, ...over });
const make = (to, n, kind) => ({ class: "holding", action: UNIT_ACTION.make, payload: { moves: [{ from: null, to, kind, n }] } });
const BEAD = mk("cy/a-bead", { kind: "glass-bead" }), BOWL = mk("ana/a-bowl", { kind: "bowl" });
const pairsOf = (view, units = [], takenInCan = undefined) => usablePairs({ actor: "cy", here: HERE, view, householdOf: (h) => ({ key: h, house: h }),
  fold: foldUnits(units), attachments: [], marks: [BEAD, BOWL], residents: [], ...(takenInCan ? { takenInCan } : {}) });

test("can, while a class is taken (WLD-7/b, ruled \"Show and refuse\"): the verbs stay listed as on any day; the door refuses them with the clue", () => {
  assert.equal(TAKEN_IN_CAN.value, "show");
  const units = [make("cy", 2, "glass-bead"), make("ana/a-bowl", 3, "glass-bead")];
  const ordinary = pairsOf(ORDINARY, units);
  assert.deepEqual(pairsOf(TAKEN, units), ordinary, "the same matrix while taken");
  assert.deepEqual(canOn(ordinary, BEAD.id), ["take"]);
  assert.ok(canVerbs(ordinary).includes("consume"));
  assert.ok(canOn(ordinary, BOWL.id).includes("take"));
});

test("the switch's other arm, \"hide\": no take of a thing of it, no consume of only it, no take from a holder holding only it; the rest as on any day", () => {
  const units = [make("cy", 2, "glass-bead"), make("ana/a-bowl", 3, "glass-bead")];
  const taken = pairsOf(TAKEN, units, "hide");
  assert.deepEqual(canOn(taken, BEAD.id), [], "a thing of the taken class is not offered");
  assert.equal(canVerbs(taken).includes("consume"), false, "only taken consumables in hand: no consume");
  assert.equal(canOn(taken, BOWL.id).includes("take"), false, "a bowl of only taken units offers no take");
  assert.equal(canOn(taken, BOWL.id).includes("give"), false, "and nothing of yours to give into it but taken units");
  // a biscuit in hand: consume and give come back, the bead stays hidden
  const mixed = pairsOf(TAKEN, [...units, make("cy", 1, "biscuit")], "hide");
  assert.ok(canVerbs(mixed).includes("consume"));
  assert.ok(canOn(mixed, BOWL.id).includes("give"));
  assert.deepEqual(canOn(mixed, BEAD.id), []);
});

/** A store for the chest tick: the law at the pin (the class it stocks taken, or not), one admitted chest of cy's, cy's label. */
function stockStore({ taken, restoredAt = null, asProperty = false }) {
  const labelled = { class: "candy", extends: "consumable", labels: [{ label: "test-beads", name: "Test Beads", creator: "cy" }], dials: {} };
  if (taken && !asProperty) labelled.dials = { stolen: true, clue: "a synthetic clue" }; // the class the chest stocks, taken
  // ...or taken by its own top-level property node (LOGOS v2, property first), which the snapshot reads over the frontmatter
  const prop = taken && asProperty ? { class: labelled.class, parent: null, name: "stolen", tier: "sovereign", default: true, id: "the-town/candy-stolen" } : null;
  const law = [
    { number: 120, tag_sha: SHA, newest: 120, kind: "class", key: labelled.class, data: labelled },
    { number: 120, tag_sha: SHA, newest: 120, kind: "class", key: "consumable", data: { class: "consumable", extends: "thing", dials: {} } },
    { number: 120, tag_sha: SHA, newest: 120, kind: "class", key: "chest", data: { class: "chest", extends: "thing", dials: { first_stock: 30, capacity: 30 } } },
    ...(prop ? [{ number: 120, tag_sha: SHA, newest: 120, kind: "property", key: `${labelled.class}/stolen`, data: prop }] : []),
  ];
  const writes = [];
  const client = { query: async (sql, params = []) => {
    const q = String(sql);
    // the restore read (restored-classes.mjs): the town's restore acts, and the class's run of laws
    if (q === RESTORE_ROWS_SQL) return { rows: restoredAt ? [{ id: "9", action: "restore", actor: "the-town", object: labelled.class, at: restoredAt }] : [] };
    if (q === CLASS_RUN_SQL) return { rows: [{ number: 120, blessed_at: "2026-10-26T06:30:00Z", data: labelled, prop }] };
    if (/law_projection|LAW_AT|kind = 'class'/i.test(q) || /FROM settlements/i.test(q) && /law/i.test(q)) return { rows: law };
    if (/INSERT INTO acts/i.test(q)) { writes.push(params); return { rows: [{ id: 1 }] }; }
    return { rows: [] };
  } };
  return { client, writes };
}

test("the chest tick's first stock waits while the class it stocks is taken: nothing made, its line read ok; once returned, the plan runs as before", async () => {
  const t = stockStore({ taken: true });
  const r = await stockChests(t.client, { crossing: 265 });
  assert.equal(r.waits, true);
  assert.match(r.line, /^chests: not stocked — a class is taken by the town's own act \(\w+\) — the first stock makes units of the class this chest stocks/);
  assert.equal(softStepStatus(r.line, "chests"), "ok switch-off");
  assert.deepEqual(t.writes, [], "nothing was made");
  const o = stockStore({ taken: false });
  const back = await stockChests(o.client, { crossing: 266 });
  assert.equal(back.waits, undefined, "returned: the stock's own plan, whatever it finds");
});

test("given back by the town's own act since the dial went on, the class it stocks is stocked again though the dial still stands (WLD-25/j)", async () => {
  const back = stockStore({ taken: true, restoredAt: "2026-10-27T18:31:00Z" });
  assert.equal((await stockChests(back.client, { crossing: 267 })).waits, undefined);
  const before = stockStore({ taken: true, restoredAt: "2026-10-25T18:00:00Z" });
  assert.equal((await stockChests(before.client, { crossing: 267 })).waits, true, "a restore from before the dial went on lifts nothing");
});

test("the dial written as the class's own property node: the chest tick waits on it, and a restore lifts it, the same as the frontmatter dial", async () => {
  const t = stockStore({ taken: true, asProperty: true });
  assert.equal((await stockChests(t.client, { crossing: 265 })).waits, true);
  assert.deepEqual(t.writes, []);
  const back = stockStore({ taken: true, asProperty: true, restoredAt: "2026-10-27T18:31:00Z" });
  assert.equal((await stockChests(back.client, { crossing: 267 })).waits, undefined, "given back: stocked again");
});
