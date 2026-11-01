// walk-aboard-deposits.test.mjs — A WALK DECLARED ABOARD FOLLOWS THE DEPOSIT RULE (WLD-139).
//
// Volt (the-anchorage) and Cloud-Phi rode the Post Office from the Snug Jetty and, mid-run, tried
// every way to leave: exit:true, mark_id+exit, a bare walk. Each was refused "the mist is too thick
// to walk into", at a wall point that moved with the hull, because the Mists were read from the
// hull's standpoint BEFORE the vehicle's exit set the rider down.
//
// LOGOS/classes.md § The vehicle: "A walk declared aboard is the choice to leave: the deposit, then
// the walk from it" -- at the destination once the ride timer has run, otherwise at the stop boarded
// through. The deposit itself is world-ride.test.mjs's ("exit BEFORE the timer ...", "exit AT OR
// AFTER the timer ..."); this file holds what the WALK does with it, and what a refusal names.
//
//   node --test test/walk-aboard-deposits.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ABOARD_TERMS, mistsRefusal, walkDepositsFirst } from "../src/world.mjs";

const SOURCE = readFileSync(new URL("../src/world.mjs", import.meta.url), "utf8");
const door = SOURCE.slice(SOURCE.indexOf("async function walkAct("), SOURCE.indexOf("export async function worldWalkers"));
const bounce = (code, defect, hint, extra = {}) => Object.assign(new Error(defect), { code, defect, hint, ...extra });

const SHIP = "the-town/the-post-office";
const ROOM = "the-town/a-room";
const byId = new Map([
  [SHIP, { id: SHIP, class: "vehicle", kind: "sited" }],
  [ROOM, { id: ROOM, kind: "sited" }],
]);

test("a walk that leaves only a vehicle deposits first; so does exit:true with a vehicle among the marks", () => {
  assert.equal(walkDepositsFirst([SHIP], byId, false), true, "aboard mid-run, a bare walk");
  assert.equal(walkDepositsFirst([SHIP], byId, true), true, "aboard mid-run, exit:true");
  assert.equal(walkDepositsFirst([ROOM, SHIP], byId, true), true, "a room boarded from, exit:true");
});

test("nothing else deposits first: no marks left, a room alone, or a room and a vehicle without exit:true", () => {
  assert.equal(walkDepositsFirst([], byId, true), false, "a walk that leaves nothing");
  assert.equal(walkDepositsFirst([ROOM], byId, true), false, "a room is DEC-5's refusal, read before its exit");
  assert.equal(walkDepositsFirst([ROOM, SHIP], byId, false), false, "a room in the way keeps its 409");
});

test("THE ORDER: a deposit-first walk is not refused from the hull; the road is read again from the deposit", () => {
  const first = door.indexOf("let mistRoad = await mistsOnTheRoad(");
  const early = door.indexOf("if (mistRoad?.refused && !depositFirst) throw mistsRefusal(");
  const exits = door.indexOf("await exitViaOffice(");
  const again = door.indexOf("if (setDownFirst || depositFirst) {");
  const refusedAgain = door.indexOf("if (mistRoad?.refused) throw mistsRefusal(", again);
  const pen = door.indexOf("walkEntry({");
  assert.match(door, /const depositFirst = occupying \? walkDepositsFirst\(occupying\.leaving, occupying\.byId, payload\.exit === true\) : false;/);
  assert.ok(first > 0 && early > first, "the hull's road is read, and its refusal is conditioned on there being no deposit first");
  assert.ok(exits > early && again > exits && refusedAgain > again && pen > refusedAgain,
    `the exit deposits (${exits}), then the road is read from it (${again}) and refused or walked (${refusedAgain}), before the pen (${pen})`);
});

test("the deposit's point is where the road begins: the set-down point replaces `from` before the second read", () => {
  const exit = door.indexOf("await exitViaOffice(");
  const fromSet = door.indexOf("from = { x: stepped.set_down.x, y: stepped.set_down.y };", exit);
  const again = door.indexOf("if (setDownFirst || depositFirst) {");
  assert.ok(exit > 0 && fromSet > exit && again > fromSet, "from is the deposit, then the road is read");
});

test("a refusal inside a vehicle names the two acts that work there", () => {
  const e = mistsRefusal(bounce, { x: -12211, y: -12173 }, { aboard: true });
  assert.equal(e.code, 422);
  assert.match(e.hint, /world \{ do: "ride", args: \{ to: "<stop>" \} \}/);
  assert.match(e.hint, /world \{ do: "exit" \}/);
  assert.equal(e.hint.endsWith(ABOARD_TERMS), true);
  assert.equal("aboard" in e, false, "the marker is not a field of the answer");
});

test("a refusal outside a vehicle reads exactly as it did", () => {
  const e = mistsRefusal(bounce, { x: 0, y: -4600 });
  assert.doesNotMatch(e.hint, /"ride"/);
  assert.doesNotMatch(e.hint, /do: "exit"/);
});

test("both Mists refusals in the door carry the aboard marker", () => {
  const calls = door.match(/throw mistsRefusal\([^\n]*aboardNow \? \{ aboard: true \}/g) ?? [];
  assert.equal(calls.length, 2);
});
