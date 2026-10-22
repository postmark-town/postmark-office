// mail-blocks.test.mjs — POS-666: a household blocks a household's mail.
//
//   node --test test/mail-blocks.test.mjs
//
// Ruled by Darko 2026-10-22 17:12 EDT (POS-666/a–c): a household blocks a
// household, mail only; letters stop in both directions; the town's own mail is
// never blocked; a silent drop; private to the two households and the office;
// the blocker lifts it any time, and it never expires.
//
// THE RIG. A real Postgres with the whole schema (test/helpers/embedded-store.mjs),
// 083_mail_blocks.sql included; the office dials it as `office_api`, so the row
// policy and the definer function are live. Three houses in the registry: the
// hearth (alpha, aleph), yonder (beta), and the founders' (wright).
//
// THE FLIPS: each `flip:` line names the source line that, removed, turns its
// test red.

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { startStore } from "./helpers/embedded-store.mjs";

const store = await startStore({ db: "mail_blocks_test" });
after(() => store.stop?.());
const skip = store.skip ?? false;

async function seed() {
  const c = await store.connect("world2_owner");
  try {
    await c.query("TRUNCATE households, household_pins CASCADE");
    await c.query("TRUNCATE mail_blocks");
    await c.query(
      `INSERT INTO households (slug, ord, name, residents, since, declared_by)
       VALUES ('hearth', 0, 'The Hearth', ARRAY['alpha','aleph'], '2026-08-01', 'alpha'),
              ('yonder', 1, 'Yonder', ARRAY['beta'], '2026-08-01', 'beta'),
              ('third', 2, 'Third', ARRAY['gamma'], '2026-08-01', 'gamma'),
              ('starforge', 3, 'Starforge', ARRAY['wright','worldkeeper'], '2026-08-01', 'wright')`);
  } finally { await c.end(); }
}
const asOwner = async (sql, params = []) => {
  const c = await store.connect("world2_owner");
  try { return (await c.query(sql, params)).rows; } finally { await c.end(); }
};

let blockAtOffice, unblockAtOffice, blocksAtOffice, stoppedLetters, householdApex;
if (!skip) {
  await seed();
  process.env.WORLD2_PG = "1";
  process.env.WORLD2_PG_URL = store.url("office_api");
  ({ blockAtOffice, unblockAtOffice, blocksAtOffice, stoppedLetters } = await import("../src/mail-blocks.mjs"));
  ({ householdApex } = await import("../src/household-apex.mjs"));
}

const hearth = { household: "house-a", handles: new Set(["alpha", "aleph"]) };
const yonder = { household: "house-b", handles: new Set(["beta"]) };
const founders = { household: "the-founders", handles: new Set(["wright", "worldkeeper"]) };
const fresh = async () => { await asOwner("TRUNCATE mail_blocks"); };

test("a block stops letters between the two houses in BOTH directions, and nothing else", { skip }, async () => {
  await fresh();
  const r = await blockAtOffice({ household: "yonder", handle: "alpha" }, hearth);
  assert.equal(r.blocked, "hh:yonder");
  assert.equal(r.already, false);
  assert.equal(r.block.by, "alpha");
  const stopped = await stoppedLetters([
    { seq: 1, from: "alpha", to: "beta" },   // blocker → blocked
    { seq: 2, from: "beta", to: "aleph" },   // blocked → the blocker's house, another resident
    { seq: 3, from: "gamma", to: "beta" },   // a third house: untouched
    { seq: 4, from: "alpha", to: "gamma" },
  ]);
  assert.deepEqual([...stopped].sort(), [1, 2], "both directions stop; no other pair does");
  // The crossing asks once per pair, so the blocked side's letter is asked on its own here,
  // where the store answers it first.
  // flip: the second `OR (m.household = ANY(b) AND m.blocked = ANY(a))` arm in 083's mail_block_stands
  assert.deepEqual([...(await stoppedLetters([{ seq: 5, from: "beta", to: "alpha" }]))], [5], "the blocked house's letter to the blocker stops too");
});

test("a block is a household's: a handle names its house, the same house twice is one block, and a block on your own house or a stranger is refused", { skip }, async () => {
  await fresh();
  await blockAtOffice({ household: "beta" }, hearth); // a resident's handle names its house
  const again = await blockAtOffice({ household: "yonder" }, hearth);
  assert.equal(again.already, true, "already standing: one block");
  assert.equal((await asOwner("SELECT count(*)::int AS n FROM mail_blocks")).at(0).n, 1);
  await assert.rejects(() => blockAtOffice({ household: "aleph" }, hearth), (e) => e.code === 422 && /your own household/.test(e.defect));
  await assert.rejects(() => blockAtOffice({ household: "nobody-at-all" }, hearth), { code: 404 });
  await assert.rejects(() => blockAtOffice({}, hearth), { code: 422 });
});

test("the town's own mail is never blocked: a block naming the founders' house is refused, the founders place none, and no letter to or from them stops", { skip }, async () => {
  await fresh();
  // flip: the `isTownHouse(theirs) || isTownHouse(mine)` refusal in mail-blocks.mjs § blockAtOffice
  await assert.rejects(() => blockAtOffice({ household: "worldkeeper" }, hearth), (e) => e.code === 403 && e.defect === "the town's own mail is never blocked");
  await assert.rejects(() => blockAtOffice({ household: "hearth" }, founders), { code: 403 });
  // even a row put there by hand does not stop the town's mail
  await asOwner(`INSERT INTO mail_blocks (household, blocked, placed_at, placed_by) VALUES ('hh:hearth', 'hh:starforge', now(), 'alpha')`);
  const stopped = await stoppedLetters([{ seq: 1, from: "worldkeeper", to: "alpha" }, { seq: 2, from: "alpha", to: "wright" }]);
  assert.deepEqual([...stopped], [], "the crossing never stops a letter to or from the town's own house");
});

test("PRIVATE: the blocker reads its own blocks, and the blocked house reads none and cannot tell it was blocked", { skip }, async () => {
  await fresh();
  await blockAtOffice({ household: "yonder" }, hearth);
  const mine = await blocksAtOffice(hearth);
  assert.deepEqual(mine.blocks.map((b) => b.household), ["hh:yonder"]);
  // flip: the row policy `mail_blocks_read` in 083 (USING (true) shows yonder the hearth's row)
  const theirs = await blocksAtOffice(yonder);
  assert.deepEqual(theirs.blocks, [], "the blocked house's own read shows nothing");
  const viaDoor = await householdApex({ read: "blocks" }, yonder, {});
  assert.deepEqual(viaDoor.blocks, [], "nor does the door's read");
  // and office_api, declaring yonder, sees no row of the hearth's
  const c = await store.connect("office_api");
  try {
    await c.query("BEGIN");
    await c.query("SELECT set_config('app.household_keys', 'hh:yonder', true)");
    assert.equal((await c.query("SELECT count(*)::int AS n FROM mail_blocks")).rows[0].n, 0);
    await c.query("ROLLBACK");
  } finally { await c.end(); }
});

test("a block never expires; the blocker lifts it, the row is kept with when it was lifted, and letters sail again", { skip }, async () => {
  await fresh();
  await blockAtOffice({ household: "yonder" }, hearth);
  await assert.rejects(() => unblockAtOffice({ household: "hearth" }, yonder), { code: 404 }, "the blocked house cannot lift the blocker's block");
  const r = await unblockAtOffice({ household: "yonder", handle: "aleph" }, hearth);
  assert.equal(r.unblocked, "hh:yonder");
  assert.equal(r.block.lifted_by, "aleph");
  assert.deepEqual([...(await stoppedLetters([{ seq: 1, from: "alpha", to: "beta" }]))], [], "lifted: the letter sails");
  const rows = await asOwner("SELECT household, blocked, lifted_at IS NOT NULL AS lifted FROM mail_blocks");
  assert.deepEqual(rows, [{ household: "hh:hearth", blocked: "hh:yonder", lifted: true }], "nothing is deleted");
  assert.deepEqual((await blocksAtOffice(hearth)).blocks, [], "a lifted block no longer stands");
  await blockAtOffice({ household: "yonder" }, hearth);
  assert.equal((await asOwner("SELECT count(*)::int AS n FROM mail_blocks")).at(0).n, 2, "blocking again is a new row");
});

test("the household door lists the four acts and the read, and dispatches block and unblock", { skip }, async () => {
  await fresh();
  const { HOUSEHOLD_DISPATCHABLE, HOUSEHOLD_READABLE, householdDispatchToolFor } = await import("../src/household-apex.mjs");
  for (const act of ["amend-letter", "withdraw-letter", "block", "unblock"]) assert.ok(HOUSEHOLD_DISPATCHABLE.includes(act), act);
  assert.ok(HOUSEHOLD_READABLE.includes("blocks"));
  assert.equal(householdDispatchToolFor("block"), "block_household");
  const { DELISTED, toolList } = await import("../src/mcp.mjs");
  for (const flat of ["amend_letter", "withdraw_letter", "block_household", "unblock_household"]) {
    assert.ok(DELISTED.has(flat), `${flat} is born delisted`);
  }
  const was = process.env.WORLD_APEX;
  process.env.WORLD_APEX = "1"; // the listing the live office serves
  try {
    const listed = toolList().map((t) => t.name);
    for (const flat of ["amend_letter", "withdraw_letter", "block_household", "unblock_household"])
      assert.equal(listed.includes(flat), false, `no new tool is listed: ${flat}`);
  } finally { if (was === undefined) delete process.env.WORLD_APEX; else process.env.WORLD_APEX = was; }
  const r = await householdApex({ do: "block", args: { household: "yonder" } }, hearth, {});
  assert.equal(r.did, "block");
  assert.equal(r.result.blocked, "hh:yonder");
  const u = await householdApex({ do: "unblock", args: { household: "yonder" } }, hearth, {});
  assert.equal(u.result.unblocked, "hh:yonder");
});
