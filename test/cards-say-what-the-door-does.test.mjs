// cards-say-what-the-door-does.test.mjs — POS-483 (+ the 10-09 lean-read audit).
//
//   node --test test/cards-say-what-the-door-does.test.mjs
//
// THE INSTANCE. Six sentences an agent reads before it acts said things the
// door does not do on the lane prod runs (WORLD_SINGLE_LOG=1):
//
//   · world_enter (the enter card's schema source, world-crossings.mjs; it
//     is no flat MCP tool, so the harm was the sentence being copied into new
//     hints, which it nearly was in #448's ride bounce): "Entering from outside bundles the walk to the threshold
//     in." The door refuses an enter from outside the extent (409, "you are not
//     at that door"); R15 keeps walk and entry decoupled. The composed act is
//     world_walk with mark_id and enter_on_arrival: true.
//   · the doorstep's transport line: "Enter a stop to board." Same refusal.
//   · leave-mark's `amend`: "an amend that MOVES a published mark is refused
//     for now (#1862)". Only the git lane (leave-exec.mjs) refuses that; on the
//     single-log lane a published mark moves, and the move carries the
//     household's marks inside it (POS-441, ruled by Darko 2026-10-07).
//   · the overhang remedy: "(a published mark cannot move)". Same.
//   · leave-mark: "your household's private draft branch". The single-log lane
//     has no branch (POS-392).
//
// So this reads what an agent reads — tools/list, every flat a caller can still
// call, every act card's fields, the transport line and the overhang remedy on
// the single-log lane — and fails on any of the old phrases. THE FLIP: put any
// one sentence back and its test goes red. The door's own behaviour behind the
// amend sentence is pinned in leave-door-region-filed-parcel.test.mjs § LEG 8.

import test, { after } from "node:test";
import assert from "node:assert/strict";

const saved = process.env.WORLD_APEX;
process.env.WORLD_APEX = "1";
after(() => { if (saved === undefined) delete process.env.WORLD_APEX; else process.env.WORLD_APEX = saved; });

const { toolList, TOOLS } = await import("../src/mcp.mjs");
const { DISPATCHABLE, fieldsFor } = await import("../src/world-apex.mjs");
const { doorstepTransport } = await import("../src/world-ride.mjs");
const { overhangOf } = await import("../src/world.mjs");
const { CROSSING_TOOLS } = await import("../src/world-crossings.mjs");

const FALSE_ON_THE_LIVE_LANE = [
  /refused for now/i,
  /#1862/,
  /bundles the walk/i,
  /Enter a stop to board/i,
  /private draft branch/i,
  /a published mark cannot move/i,
];

function assertTrue(text, where) {
  for (const re of FALSE_ON_THE_LIVE_LANE)
    assert.doesNotMatch(text, re, `${where} says ${re}, which the door does not do on the single-log lane`);
}

test("tools/list says nothing the door refuses", () => {
  const listed = toolList();
  assert.ok(listed.some((t) => t.name === "world"), "the apex is listed with WORLD_APEX=1");
  for (const t of listed) assertTrue(JSON.stringify(t), `tools/list → ${t.name}`);
});

test("nor does any flat a caller can still call (a delisted tool is unadvertised, never unplugged), nor the crossing doors the enter card is drawn from", () => {
  for (const name of ["world_walk", "world_leave_mark"])
    assert.ok(TOOLS.some((t) => t.name === name), `${name} is still callable`);
  for (const t of [...TOOLS, ...CROSSING_TOOLS]) assertTrue(JSON.stringify(t), `flat ${t.name}`);
});

test("nor does any act card's fields", () => {
  assert.ok(DISPATCHABLE.includes("leave-mark") && DISPATCHABLE.includes("enter"), "the cards under test are dispatchable");
  for (const action of DISPATCHABLE) assertTrue(JSON.stringify(fieldsFor(action)), `the ${action} card's fields`);
  const amend = fieldsFor("leave-mark").amend?.description ?? "";
  assert.match(amend, /MOVE the mark, draft or published/, "the amend field says a published mark moves");
  assert.match(amend, /belong to your household/, "…and what the move carries");
});

test("world_enter names the composed walk instead of promising to bundle it", () => {
  const enter = CROSSING_TOOLS.find((t) => t.name === "world_enter");
  assert.match(enter.description, /world_walk with mark_id and enter_on_arrival: true/);
  assert.match(enter.description, /from outside it, the enter is refused and records nothing/);
});

test("the doorstep's transport line names the composed walk to the nearest stop", () => {
  const service = { vessel: { markId: "the-town/the-post-office" },
    stops: [{ markId: "the-town/the-quay", at: { x: 0, y: 0 } }, { markId: "sol/grove-wharf", at: { x: 400, y: 0 } }] };
  const near = doorstepTransport(service, { x: 390, y: 5 });
  assertTrue(near.line, "the transport line");
  assert.match(near.line, /mark_id: "sol\/grove-wharf", enter_on_arrival: true/, "the nearest stop, in the composed walk");
  assert.match(near.line, /accept: true/, "and the word her door asks for");
  const nowhere = doorstepTransport(service, null);
  assertTrue(nowhere.line, "the transport line with no standpoint");
  assert.match(nowhere.line, /mark_id: "<a stop>", enter_on_arrival: true/, "no nearest is invented");
});

test("the overhang remedy on the single-log lane says a published mark moves, and what it carries", () => {
  const r = overhangOf({
    id: "a/the-cup", kind: "sited", parent: "a/the-yard", at: { x: 10, y: 10 }, extent: { w: 4, h: 4 },
    standing: { placed: true, x: 10, y: 10 }, spine: [{ id: "a/the-yard" }, { id: "a/the-shed" }], singleLog: true,
  });
  assert.ok(r, "an overhang is disclosed");
  assertTrue(r.remedy, "the overhang remedy");
  assert.match(r.remedy, /draft or published/);
  assert.match(r.remedy, /amend: true/);
});
