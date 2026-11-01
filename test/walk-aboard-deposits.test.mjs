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
import { ABOARD_TERMS, mistsRefusal, roadFromTheDeposit, walkDepositsFirst } from "../src/world.mjs";

const SOURCE = readFileSync(new URL("../src/world.mjs", import.meta.url), "utf8");
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

test("nothing else deposits first: no marks left, a room alone, or a room and a vehicle without exit:true (that last one is the 409)", () => {
  assert.equal(walkDepositsFirst([], byId, true), false, "a walk that leaves nothing");
  assert.equal(walkDepositsFirst([ROOM], byId, true), false, "a room is DEC-5's refusal, read before its exit");
  assert.equal(walkDepositsFirst([ROOM, SHIP], byId, false), false, "a room in the way keeps its 409");
});

// ── the real order, driven: roadFromTheDeposit is the code walkAct calls, with the office's effects injected ──
const HULL = { x: 500, y: -12000 };   // the moving hull, out in the Mists
const STOP = { x: 0, y: 0 };          // the stop they boarded through
const DEST = { x: 900, y: 100 };      // the ride's destination
const WALL_Y = -10000;                // the Mists' wall: a road that begins or ends beyond it is refused
const road = (log) => async (pt) => { log.push({ ...pt }); return pt.y < WALL_Y ? { refused: { x: pt.x, y: pt.y } } : { factor: 1, deepest: 0 }; };
const setDown = (pt, at, arrived) => async () => ({ set_down: { recorded: true, x: pt.x, y: pt.y, at, arrived } });

test("aboard mid-run, the timer not yet run: set down at the boarding stop, then the road is read from it (not the hull)", async () => {
  const reads = [], exits = [];
  const out = await roadFromTheDeposit({ from: HULL, leaving: [SHIP], byId, exit: false, readRoad: road(reads),
    exitOne: async (id) => { exits.push(id); return setDown(STOP, "the-town/the-snug-jetty", false)(); } });
  assert.equal(out.refused, undefined, "Volt's refusal is gone");
  assert.deepEqual(out.from, STOP);
  assert.equal(out.setDownFirst.arrived, false);
  assert.deepEqual(exits, [SHIP]);
  assert.deepEqual(reads.at(-1), STOP, "the road the walk is stamped with was read from the deposit");
});

test("the timer run: set down at the destination, and the road begins there", async () => {
  const reads = [];
  const out = await roadFromTheDeposit({ from: HULL, leaving: [SHIP], byId, exit: true, readRoad: road(reads),
    exitOne: setDown(DEST, "the-town/the-pando-landing", true) });
  assert.deepEqual(out.from, DEST);
  assert.equal(out.setDownFirst.arrived, true);
  assert.deepEqual(reads.at(-1), DEST);
});

test("a ringed target is aimed again from the deposit, before the second read", async () => {
  const order = [];
  await roadFromTheDeposit({ from: HULL, leaving: [SHIP], byId, exit: true,
    readRoad: async (pt) => { order.push(["read", pt.y]); return { factor: 1, deepest: 0 }; },
    exitOne: async () => { order.push(["exit"]); return setDown(STOP, "s", false)(); },
    afterDeposit: (pt) => order.push(["aim", pt.y]) });
  assert.deepEqual(order.map((o) => o[0]), ["read", "exit", "aim", "read"]);
  assert.equal(order[2][1], STOP.y, "aimed from the deposit point");
});

test("a bare walk from [room, vehicle] reaches the 409 before any road is read or any exit written", async () => {
  const reads = [], exits = [];
  const out = await roadFromTheDeposit({ from: HULL, leaving: [ROOM, SHIP], byId, exit: false, readRoad: road(reads),
    exitOne: async (id) => { exits.push(id); return {}; } });
  assert.equal(out.blocked, true);
  assert.equal(reads.length, 0, "the hull's road is never read");
  assert.equal(exits.length, 0, "and nothing is written");
});

test("the same stack with exit:true deposits first and walks", async () => {
  const reads = [], exits = [];
  const out = await roadFromTheDeposit({ from: HULL, leaving: [ROOM, SHIP], byId, exit: true, readRoad: road(reads),
    exitOne: async (id) => { exits.push(id); return id === SHIP ? setDown(STOP, "s", false)() : {}; } });
  assert.equal(out.refused, undefined);
  assert.deepEqual(exits, [ROOM, SHIP]);
  assert.deepEqual(out.from, STOP);
});

test("a walker who leaves only a room is read first and refused first, as before: no exit is written", async () => {
  const reads = [], exits = [];
  const out = await roadFromTheDeposit({ from: HULL, leaving: [ROOM], byId, exit: true, readRoad: road(reads),
    exitOne: async (id) => { exits.push(id); return {}; } });
  assert.deepEqual(out.refused, { x: HULL.x, y: HULL.y });
  assert.equal(out.afterExit, false);
  assert.equal(exits.length, 0);
});

test("a road from the deposit that still meets the wall is refused AFTER the exit, and says they are ashore", async () => {
  const wallStop = { x: 0, y: -11000 };
  const exits = [];
  const out = await roadFromTheDeposit({ from: HULL, leaving: [SHIP], byId, exit: false, readRoad: road([]),
    exitOne: async (id) => { exits.push(id); return setDown(wallStop, "the-town/the-snug-jetty", false)(); } });
  assert.deepEqual(exits, [SHIP], "the exit act was written");
  assert.equal(out.afterExit, true);
  assert.deepEqual(out.exitedFirst, [SHIP]);
  const e = mistsRefusal(bounce, out.refused, { exited_first: out.exitedFirst, left: out.setDownFirst.at });
  assert.doesNotMatch(e.hint, /Aboard a vehicle/);
  assert.ok(e.hint.includes("already stepped off at the-town/the-snug-jetty, so you stand ashore and the road from there meets the Mists"));
  assert.deepEqual(e.exited_first, [SHIP]);
});

test("the door passes the deposit-aware fields: aboard before the exit, left after it", () => {
  const door = SOURCE.slice(SOURCE.indexOf("async function walkAct("), SOURCE.indexOf("export async function worldWalkers"));
  assert.ok(door.includes("roadRead.afterExit ? { exited_first: roadRead.exitedFirst, left: roadRead.setDownFirst?.at ?? true } : (aboardNow ? { aboard: true } : {})"));
  assert.doesNotMatch(door, /a refused road writes no act at all/, "the stale comment is gone");
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

