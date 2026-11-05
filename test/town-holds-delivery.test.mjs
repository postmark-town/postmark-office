// town-holds-delivery.test.mjs — the store's holder and owner REACH the hold-owed term by the TYPE they are stored with (WLD-5).
//
// The fourth term (fold-delta.mjs § TOWN_HOLDS_SELECT, `holdsOwed`) offers a town-signed mark again until canon carries the same
// holder and owner as the store. Its canon side is `canon-register.mjs § townHoldsOf`, which reads a holder or owner ONLY as a
// non-blank string (anything else is null), and `holdsOwed` applies the same string-only reading to the store's rows. If the SQL casts
// the stored JSON to text (`->>`), a stored `false` or object arrives as the text "false" or "{…}", a non-blank string, and the two
// sides can never agree: the mark is offered again at every crossing and no print can make canon "null" match it.
//
// So this file puts INVENTED town-signed marks in a REAL Postgres (helpers/embedded-store.mjs: this tree's own server or an own
// one, never WORLD2_PG_URL), runs the PRODUCTION `TOWN_HOLDS_SELECT` and `holdsOwed`, and builds the canon map with the real
// `townHoldsOf`. Nothing about the rows is stubbed.
//
// THE CAN-FAIL FLIPS (each reds its own rows):
//   `data->'held_by'`  back to `data->>'held_by'`    → the held_by-only rows are owed, and arrive as text
//   `data->'owned_by'` back to `data->>'owned_by'`   → the owned_by-only rows are owed, and arrive as text
//
// Every slug and handle is invented. Run: node --test test/town-holds-delivery.test.mjs

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { startStore } from "./helpers/embedded-store.mjs";
import { TOWN_HOLDS_SELECT, holdsOwed } from "../world2/tools/fold-delta.mjs";
import { townHoldsOf } from "../world2/tools/canon-register.mjs";

const store = await startStore({ db: "town_holds_delivery_test" });
after(() => store.stop());
const skip = store.skip ?? false;

const WIN = 177;
// [slug, stored held_by, stored owned_by]; `undefined` = the key is absent from the stored data
const STORED = [
  ["the-town/hb-false", false, undefined],
  ["the-town/ob-false", undefined, false],
  ["the-town/both-false", false, false],
  ["the-town/both-object", { by: "sbx-bo" }, { by: "sbx-cy" }],
  ["the-town/hb-array", ["sbx-bo"], undefined],
  ["the-town/ob-number", undefined, 7],
  ["the-town/both-true", true, true],
  ["the-town/json-null", null, null],
  ["the-town/absent", undefined, undefined],
  ["the-town/blank", "", "   "],
  ["the-town/string-false", "false", "false"],
  ["the-town/real", "sbx-bo", "sbx-cy"],
];
const slugs = STORED.map(([s]) => s);

async function seed() {
  const c = await store.connect("world2_owner");
  try {
    await c.query("TRUNCATE escrow_projection, claims, marks, windows CASCADE");
    await c.query(`INSERT INTO windows (id, opens_at, closes_at, status, cleared_at, town_sha)
                   VALUES ($1, '2026-10-19T00:00:00Z', '2026-10-19T12:00:00Z', 'closed', '2026-10-19T12:00:00Z', $2)`, [WIN, "a".repeat(40)]);
    let n = 0;
    for (const [slug, held, owned] of STORED) {
      n += 1;
      const data = { tier: "constitution" };
      if (held !== undefined) data.held_by = held;
      if (owned !== undefined) data.owned_by = owned;
      await c.query(`INSERT INTO marks (id, slug, kind, owner, household, body, geometry, bbox, status, locked_window, data)
                     VALUES ($1, $2, 'thing', 'the-town', NULL, 'An invented town thing.', NULL, NULL, 'standing', $3, $4)`,
        [`d0000000-0000-4000-8000-0000000002${String(n).padStart(2, "0")}`, slug, WIN, JSON.stringify(data)]);
    }
  } finally { await c.end(); }
}

async function storeRows() {
  const c = await store.connect("world2_owner");
  try { return (await c.query(TOWN_HOLDS_SELECT)).rows; } finally { await c.end(); }
}

/** the canon side, through the real townHoldsOf: what canon prints for each slug (a holder and an owner, or none) */
const canonOf = (printed = {}) => townHoldsOf(slugs.map((id) => ({ id, by: "the-town", ...(printed[id] ?? {}) })));

test("WLD-5 · the stored holder and owner arrive by TYPE, not as text", { skip }, async () => {
  await seed();
  const by = new Map((await storeRows()).map((r) => [r.slug, r]));
  assert.strictEqual(by.get("the-town/hb-false").held_by, false, "a stored JSON false stays false");
  assert.strictEqual(by.get("the-town/hb-false").owned_by, null, "an absent key arrives as null");
  assert.strictEqual(by.get("the-town/ob-false").owned_by, false);
  assert.deepEqual(by.get("the-town/both-object").held_by, { by: "sbx-bo" }, "a stored object stays an object");
  assert.deepEqual(by.get("the-town/both-object").owned_by, { by: "sbx-cy" });
  assert.deepEqual(by.get("the-town/hb-array").held_by, ["sbx-bo"]);
  assert.strictEqual(by.get("the-town/ob-number").owned_by, 7, "a stored number stays a number");
  assert.strictEqual(by.get("the-town/both-true").held_by, true);
  assert.strictEqual(by.get("the-town/json-null").held_by, null);
  assert.strictEqual(by.get("the-town/absent").held_by, null);
  assert.strictEqual(by.get("the-town/blank").held_by, "", "a stored string stays a string, blank or not");
  assert.strictEqual(by.get("the-town/string-false").held_by, "false", "the STRING \"false\" is a string");
  assert.strictEqual(by.get("the-town/real").owned_by, "sbx-cy");
});

test("WLD-5 · a non-string holder or owner agrees with canon's null, on BOTH fields; only real strings are differences", { skip }, async () => {
  await seed();
  const owed = holdsOwed(await storeRows(), canonOf());   // canon prints no holder and no owner for any of them
  assert.deepEqual(owed.sort(), ["the-town/real", "the-town/string-false"].sort(),
    "false, objects, arrays, numbers, true, JSON null, absent and blank strings all read as null on both sides; "
    + "a non-blank string (even \"false\") is a holder or owner reference, so it differs from canon's null");
});

test("WLD-5 · the hold-owed term still terminates when the print lands: the same strings agree, a released string differs until then", { skip }, async () => {
  await seed();
  const rows = await storeRows();
  const printed = {
    "the-town/string-false": { held_by: "false", owned_by: "false" },
    "the-town/real": { held_by: "sbx-bo", owned_by: "sbx-cy" },
  };
  assert.deepEqual(holdsOwed(rows, canonOf(printed)), [], "canon prints what the store holds: nothing is owed, so the print ends the term");
  // the holder is released in the store (a string -> null) before canon has printed it: owed until the print lands
  const c = await store.connect("world2_owner");
  try { await c.query(`UPDATE marks SET data = data - 'held_by' WHERE slug = 'the-town/real'`); } finally { await c.end(); }
  const after = holdsOwed(await storeRows(), canonOf(printed));
  assert.deepEqual(after, ["the-town/real"], "store null vs canon's old string: offered again until canon prints the release");
  assert.deepEqual(holdsOwed(await storeRows(), canonOf({ ...printed, "the-town/real": { held_by: null, owned_by: "sbx-cy" } })), [],
    "once canon prints the release the term ends");
});
