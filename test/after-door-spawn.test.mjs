// after-door-spawn.test.mjs — a named creature that waits on a door (`after_door`,
// WLD-25/k): the creature tick's namedSpawns brings it out at the first settlement
// whose blessed world shows its door open. The question is the world's
// (tools/creatures.mjs § afterDoorOpen, reading the door's `requires` from the
// printed `held_by`); this office asks it of the blessed world-state's marks, holds
// a declaration whose engine cannot ask (saying why), and says nothing of a door
// that is only shut. The last two cases ask the REAL engine at the clone's newest
// blessing and skip, saying why, on one that predates after_door.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { namedSpawns } from "../src/creature-tick.mjs";
import { engineDirAt } from "../src/world-branches.mjs";
import { NO_WORLD, worldClone } from "./fixture-paths.mjs";

const NOW = Date.parse("2026-10-26T08:00:00Z");
const ID = "creature:tempter-den";
const DOOR = "tw/inner-door";
const HOLDERS = ["tw/holder-1", "tw/holder-2", "tw/holder-3"];
const ASKS = ["tw/token-a", "tw/token-b", "tw/token-c"];
/** The blessed world-state's marks: the door, and the first n tokens printed in their holders' hands. */
const printed = (n) => [
  { id: DOOR, kind: "thing", by: "tw", at: { x: 0, y: 0 }, extent: { w: 2, h: 2 }, body: "A door.",
    entry: { word: "neutral", into: "tw/room", requires: { holds: ASKS, in: HOLDERS, at: "settlement" } } },
  ...ASKS.map((id, i) => ({ id, kind: "thing", by: "the-town", body: "A token.", ...(i < n ? { held_by: HOLDERS[i] } : {}) })),
];
const inputsWith = (creaturesMod, marks) => ({
  law: { named: [{ id: ID, kind: "tempter", x: 0, y: 0, after_door: DOOR, declared: "x" }], fromCrossing: 0 },
  creaturesMod: { creaturesOn: () => true, isCreatureId: (i) => String(i).startsWith("creature:"), ...creaturesMod },
  starts: { tempter: { moods: {} } },
  inputs: { marks },
});
const spawnsOf = async (w) => { const held = []; const out = await namedSpawns({ now: NOW, N: 300, inputsAt: async () => w, blessed: () => "sha", held }); return { ids: out.map((d) => d.id), held }; };

test("the tick asks the world's afterDoorOpen of the blessed marks: shut is a quiet wait, open brings it out", async () => {
  const asked = [];
  const open = (n) => ({ afterDoorOpen: (d, marks) => { asked.push([d.after_door, marks.length]); return n === 3 ? { open: true } : { open: false, shut: true, why: "shut" }; } });
  const two = await spawnsOf(inputsWith(open(2), printed(2)));
  assert.deepEqual(two, { ids: [], held: [] }, "two of three: it waits, and a shut door is no held line");
  assert.deepEqual(asked, [[DOOR, 4]], "asked of the blessed world-state's marks");
  assert.deepEqual((await spawnsOf(inputsWith(open(3), printed(3)))).ids, [ID]);
});

test("FAIL CLOSED: an engine that cannot ask, a door that is no lock, or a throw holds it, saying why", async () => {
  const none = await spawnsOf(inputsWith({}, printed(3)));
  assert.deepEqual(none.ids, []);
  assert.match(none.held[0], /waits on the door tw\/inner-door, and the engine at this blessing cannot read a door/);
  const fault = await spawnsOf(inputsWith({ afterDoorOpen: () => ({ open: false, why: "its after_door reads the live record" }) }, printed(3)));
  assert.deepEqual(fault.ids, []);
  assert.match(fault.held[0], /creature:tempter-den: its after_door reads the live record/);
  const threw = await spawnsOf(inputsWith({ afterDoorOpen: () => { throw new Error("boom"); } }, printed(3)));
  assert.deepEqual(threw.ids, []);
  assert.match(threw.held[0], /its door could not be read/);
});

// ── through the REAL engine ──────────────────────────────────────────────────
const CLONE = worldClone();
const ENGINE = CLONE ? engineDirAt(CLONE) : null;
const HAVE = !!ENGINE && existsSync(join(ENGINE, "tools", "creatures.mjs"))
  && readFileSync(join(ENGINE, "tools", "creatures.mjs"), "utf8").includes("export function afterDoorOpen");
const SKIP = !HAVE && (CLONE ? `the engine at ${ENGINE} predates a creature that waits on a door (no afterDoorOpen)` : NO_WORLD);

test("THE REAL ENGINE: two printed, the creature stays in; the settlement that prints the third brings it out", { skip: SKIP }, async () => {
  const real = await import(pathToFileURL(join(ENGINE, "tools", "creatures.mjs")).href);
  const mod = { afterDoorOpen: real.afterDoorOpen };
  for (const n of [0, 2]) assert.deepEqual(await spawnsOf(inputsWith(mod, printed(n))), { ids: [], held: [] }, `${n} printed: it waits`);
  assert.deepEqual((await spawnsOf(inputsWith(mod, printed(3)))).ids, [ID]);
});

test("THE REAL ENGINE: a door that reads the live record never brings it out, and says so", { skip: SKIP }, async () => {
  const real = await import(pathToFileURL(join(ENGINE, "tools", "creatures.mjs")).href);
  const live = printed(3).map((m) => (m.id === DOOR ? { ...m, entry: { ...m.entry, requires: { holds: ASKS, in: HOLDERS } } } : m));
  const r = await spawnsOf(inputsWith({ afterDoorOpen: real.afterDoorOpen }, live));
  assert.deepEqual(r.ids, []);
  assert.match(r.held[0], /reads the live record/);
});
