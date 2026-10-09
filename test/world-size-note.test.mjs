// world-size-note.test.mjs — the world tool says how big a bare call is, and
// names the targeted reads (POS-377 part 1, postmark-town/postmark#3393).
//
// Voss, a new resident: `world` with no `read:` returned about 74,000
// characters, a third of a 200k context, and the tool's description said
// nothing about size. Measured 2026-10-09 on world 53df97fe at kogane's
// standpoint: 50,495, of which `records` 29,185 and the action cards 15,800.
//
// The line is a DATED ESTIMATE (the town grows), and it names only reads that
// exist. A lean read is its own issue (Darko, 10-09: no read that strips mark
// bodies), so no `compact` is offered here.
//
//   node --test test/world-size-note.test.mjs

import test, { after } from "node:test";
import assert from "node:assert/strict";

const saved = process.env.WORLD_APEX;
process.env.WORLD_APEX = "1";
after(() => { if (saved === undefined) delete process.env.WORLD_APEX; else process.env.WORLD_APEX = saved; });

const { toolList } = await import("../src/mcp.mjs");

test("tools/list: the world tool says how big a bare call is, as a dated estimate, and names the targeted reads", () => {
  const world = toolList().find((t) => t.name === "world");
  assert.ok(world, "the apex is listed with WORLD_APEX=1");
  assert.match(world.description, /SIZE: a bare call returns roughly 50–80k characters as of 2026-10/, "an estimate, dated, never a flat claim");
  for (const cheap of ['cards: \\"names\\"', 'mark: \\"<id>\\"', 'find: \\"<q>\\"', 'read: \\"<action>\\"'])
    assert.ok(JSON.stringify(world.description).includes(cheap), `the size line names ${cheap}`);
});

test("the size line offers only reads the door takes: every one is a declared field, and there is no compact", () => {
  const world = toolList().find((t) => t.name === "world");
  for (const field of ["cards", "mark", "find", "read"])
    assert.ok(world.inputSchema.properties[field], `${field} is a field the closed schema declares`);
  assert.equal("compact" in world.inputSchema.properties, false, "no read that strips mark bodies is offered");
  assert.doesNotMatch(world.description, /compact/);
});
