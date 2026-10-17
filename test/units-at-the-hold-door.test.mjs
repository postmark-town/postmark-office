// units-at-the-hold-door.test.mjs — WLD-27: counted units reach the unit door
// through the REAL `world_hold` door, behind the same key check and the same
// lane refusal every give, drop and take already answers to.
//
// No store: the flags are prod's (the hold lane flipped, the guards on) with a
// URL nothing answers, so any read would fail loudly — and these refusals land
// before any read, which is the point: a wrong key and an off lane write nothing.

import test, { after } from "node:test";
import assert from "node:assert/strict";

const FLAGS = ["WORLD2_PG", "WORLD2_PG_URL", "W2_PEN", "W2_GUARDS"];
const saved = Object.fromEntries(FLAGS.map((k) => [k, process.env[k]]));
after(() => { for (const k of FLAGS) { if (saved[k] == null) delete process.env[k]; else process.env[k] = saved[k]; } });
const prod = () => Object.assign(process.env, { WORLD2_PG: "1", WORLD2_PG_URL: "postgres://units-door-test/none", W2_PEN: "hold", W2_GUARDS: "1" });

const { callHoldTool } = await import("../src/world-hold.mjs");
const KEY = { household: "hh:sbx-cy", handles: new Set(["sbx-cy"]) };

test("a wrong actor key is refused by name before any unit is read or written", async () => {
  prod();
  for (const args of [{ from: "sbx-ana/the-bowl", handle: "sbx-ana" }, { act: "consume", handle: "sbx-ana" }, { act: "refill", chest: "sbx-ana/the-bowl", handle: "sbx-ana" }, { label: "test-comets", handle: "zeta" }])
    await assert.rejects(callHoldTool("world_hold", args, KEY), (e) => e.code === 403 && /is not one of your residents/.test(e.defect), JSON.stringify(args));
});

test("off the hold lane the unit door refuses exactly as the thing door does — nothing held nowhere", async () => {
  prod(); delete process.env.W2_PEN;
  await assert.rejects(callHoldTool("world_hold", { from: "sbx-ana/the-bowl" }, KEY), (e) => e.code === 503 && /hold lane's record/.test(e.defect));
});

test("a call naming no thing and no units is asked which", async () => {
  prod();
  await assert.rejects(callHoldTool("world_hold", {}, KEY), (e) => e.code === 422 && /which thing/.test(e.defect));
});

test("an act that is neither consume nor refill is refused by name", async () => {
  prod();
  await assert.rejects(callHoldTool("world_hold", { act: "eat" }, KEY), (e) => e.code === 422 && /consume or refill/.test(e.defect));
});
