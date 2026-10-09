// door-read-shape.test.mjs — the town and household doors' shape switches (POS-486).
//
// TOWN_READ_SHAPE=t0|t1|t2 and HOUSEHOLD_READ_SHAPE=h0|h1|h2 pick each door's
// default bare read while fresh test agents measure the candidates. Unset (or
// the 0 shape), the read and the tool's schema are the very objects they were.
//
//   node --test test/door-read-shape.test.mjs

import test, { after } from "node:test";
import assert from "node:assert/strict";

const saved = { WORLD_APEX: process.env.WORLD_APEX, TOWN_READ_SHAPE: process.env.TOWN_READ_SHAPE, HOUSEHOLD_READ_SHAPE: process.env.HOUSEHOLD_READ_SHAPE };
const setEnv = (k, v) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; };
setEnv("WORLD_APEX", "1"); setEnv("TOWN_READ_SHAPE", undefined); setEnv("HOUSEHOLD_READ_SHAPE", undefined);
after(() => { for (const [k, v] of Object.entries(saved)) setEnv(k, v); });

const { TOOLS, toolList } = await import("../src/mcp.mjs");
const { townApex, TOWN_TOOL } = await import("../src/town-apex.mjs");
const { capabilityIndex, HOUSEHOLD_TOOL } = await import("../src/household-apex.mjs");
const { actionFields } = await import("../src/world-apex.mjs");
const shape = await import("../src/door-read-shape.mjs");

const schemas = Object.fromEntries(TOOLS.map((t) => [t.name, t.inputSchema?.properties ?? {}]));
const schemaRequired = Object.fromEntries(TOOLS.map((t) => [t.name, t.inputSchema?.required ?? []]));
const at = async (k, v, fn) => { setEnv(k, v); try { return await fn(); } finally { setEnv(k, undefined); } };
// the town's bare read as the MCP door makes it: the door passes the shape in ctx
const townBare = (v, args = {}) => at("TOWN_READ_SHAPE", v, () => townApex(args, null, { schemas, schemaRequired, ...(v ? { readShape: shape.doorShape("town") } : {}) }));

test("the 0 shapes are the defaults: unset, empty or unknown, and the switch hands back the very answer", () => {
  assert.equal(shape.doorShape("town", {}), "t0");
  assert.equal(shape.doorShape("household", { HOUSEHOLD_READ_SHAPE: "" }), "h0");
  assert.equal(shape.doorShape("town", { TOWN_READ_SHAPE: "t2" }), "t2");
  assert.equal(shape.doorShape("household", { HOUSEHOLD_READ_SHAPE: "h7" }), "h0", "an unknown shape is the control, never a guess");
  const a = { acts: [{ act: "send", teaches: "x" }], papers: {} };
  assert.equal(shape.shapeHouseholdRead(a, { shape: "h0" }), a);
  assert.equal(shape.shapeTownRead(a, { shape: "t0" }), a);
});

test("t0 and h0: the town's bare read and both doors' schemas are byte-identical with the var unset and set to the 0 shape", async () => {
  assert.equal(JSON.stringify(await townBare("t0")), JSON.stringify(await townBare(undefined)));
  const listed = async (k, v) => at(k, v, () => JSON.stringify(toolList().filter((t) => t.name === "town" || t.name === "household")));
  assert.equal(await listed("TOWN_READ_SHAPE", "t0"), await listed("TOWN_READ_SHAPE", undefined));
  assert.equal(await listed("HOUSEHOLD_READ_SHAPE", "h0"), await listed("HOUSEHOLD_READ_SHAPE", undefined));
  assert.ok(!("cards" in TOWN_TOOL.inputSchema.properties) && !("cards" in HOUSEHOLD_TOOL.inputSchema.properties), "no cards field at the 0 shapes");
});

test("every field a town one-liner names is a field of that act's real schema, and every required field is named", async () => {
  const bare = await townBare(undefined);
  for (const card of bare.acts) {
    const l = shape.TOWN_LINES[card.act];
    assert.ok(l, `${card.act} has a line`);
    const named = new Set(shape.lineFields(l.fields));
    for (const f of named) assert.ok(f in card.fields, `town ${card.act}'s line names "${f}", which its schema (${Object.keys(card.fields).join(", ")}) does not take`);
    for (const [f, spec] of Object.entries(card.fields))
      if (spec?.required && f !== "handle") assert.ok(named.has(f), `town ${card.act}'s line leaves out its required field "${f}"`);
  }
  assert.ok(actionFields, "the world apex's field generation is the cards' source");
});

test("every field a household one-liner names is a field of that act's real schema, and every required field is named", () => {
  for (const { act, fields } of capabilityIndex({ schemas, schemaRequired })) {
    const l = shape.HOUSEHOLD_LINES[act];
    assert.ok(l, `${act} has a line`);
    const named = new Set(shape.lineFields(l.fields));
    for (const f of named) assert.ok(f in fields, `household ${act}'s line names "${f}", which its schema (${Object.keys(fields).join(", ")}) does not take`);
    for (const [f, spec] of Object.entries(fields))
      if (spec?.required && f !== "handle") assert.ok(named.has(f), `household ${act}'s line leaves out its required field "${f}"`);
  }
});

test("t1: the reads by name with one line, each act one line, handle said once, no teaches; cards: \"full\" gives today's acts", async () => {
  const full = await townBare(undefined);
  const t1 = await townBare("t1");
  assert.equal(t1.read_shape, "t1");
  assert.deepEqual(t1.reading.map((r) => r.read), full.reading.map((r) => r.read));
  for (const r of t1.reading) assert.deepEqual(Object.keys(r), ["read", "line"]);
  assert.deepEqual(t1.acts.map((a) => a.act), full.acts.map((a) => a.act));
  for (const a of t1.acts) assert.match(a.line, /Fields: .+\.$|No fields\.$/);
  assert.match(t1.handle, /picks which resident acts/);
  assert.ok(!JSON.stringify(t1).includes('"teaches"'));
  assert.deepEqual(t1.the_register_law, full.the_register_law, "the register law stays");
  assert.deepEqual(t1.named_not_built, full.named_not_built, "named_not_built stays");
  assert.ok(JSON.stringify(t1).length < JSON.stringify(full).length / 2);
  assert.deepEqual((await townBare("t1", { cards: "full" })).acts, full.acts);
  assert.deepEqual((await townBare("t2")).acts, full.acts.map((a) => a.act));
  await at("TOWN_READ_SHAPE", "t1", () => assert.deepEqual(TOWN_TOOL.inputSchema.properties.cards.enum, ["full"]));
});

test("h1/h2: papers lean (settled, gaps, parcel; no transport), declare only without a household, begin only from a berth", () => {
  const acts = capabilityIndex({ schemas, schemaRequired });
  const resident = {
    tier: "resident", household: "the-garrison", residents: ["sol-of-garrison"],
    papers: { "sol-of-garrison": { settled: true, gaps: ["tend your home"], // the world block's real shape, read from the local office on 10-09
      world: { mark_id: "sol-of-garrison/the-heart-house-parcel", x: -1380, y: -2543, sited: true, via: "own", parcel_id: "sol-of-garrison/the-heart-house-parcel",
        transport: { vehicle: "the-town/the-post-office", stops: 4, nearest: { mark: "sol-of-garrison/grove-wharf", distance_m: 13 }, line: "the-town/the-post-office: stops at 4 places" } } } },
    acts, reading_law: "x",
  };
  const h1 = shape.shapeHouseholdRead(resident, { shape: "h1" });
  assert.deepEqual(h1.papers["sol-of-garrison"], { settled: true, gaps: ["tend your home"], parcel: "sol-of-garrison/the-heart-house-parcel" });
  assert.ok(!h1.acts.some((a) => a.act === "declare" || a.act === "begin"), "a resident sees neither declare nor begin");
  assert.match(h1.handle, /picks which resident acts/);
  assert.ok(!JSON.stringify(h1).includes('"teaches"'));
  const berth = shape.shapeHouseholdRead({ tier: "berth", household: null, acts }, { shape: "h2" });
  assert.ok(berth.acts.includes("begin") && !berth.acts.includes("declare"), "a berth sees begin only");
  const visitor = shape.shapeHouseholdRead({ tier: "visitor", household: null, acts }, { shape: "h2" });
  assert.ok(visitor.acts.includes("declare") && !visitor.acts.includes("begin"), "a caller with no household sees declare");
  assert.deepEqual(shape.shapeHouseholdRead(resident, { shape: "h1", cards: "full" }).acts, acts, "cards: full gives today's index");
});
