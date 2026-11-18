// wld68-enter-unavailable.test.mjs — WLD-68: an enter target you cannot enter
// from here is explained without disclosing it.
//
// The clone answers a mark a dungeon hides from you exactly as it answers an id
// that does not exist (`no mark '<id>' to enter`, world-verbs.mjs § enter), so
// naming one from the wrong room learns nothing. The office used to hang "a
// point has no inside" on that answer, which is false for a hidden portal: it
// has an inside, just not from where you stand. What is under test is the
// office's bounce through the REAL enterViaOffice against the REAL clone verbs:
// the settled neutral hint, the same for missing and hidden, naming no room or
// portal; still a 422 with the clone's defect; nothing recorded, nobody moved;
// and every other enter answer as before. All names are synthetic.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { enterViaOffice } from "../src/world-crossings.mjs";
import { actCaught } from "../src/world-apex.mjs";
import { NO_WORLD, worldClone } from "./fixture-paths.mjs";

const CLONE = worldClone();
const HAVE = !!CLONE && existsSync(join(CLONE, "tools", "portals.mjs"));
const SKIP = !HAVE && (CLONE ? `the world clone at ${CLONE} predates WLD-5 (no tools/portals.mjs)` : NO_WORLD);
const grammarOf = async () => import(pathToFileURL(join(CLONE, "tools", "enter-exit.mjs")).href);

// the settled words (Bevel, WLD-68 brief, under Wright's 2026-10-26 delegation)
const HINT = "That mark is not available to enter from here. Choose a doorway visible from where you stand. Nothing was recorded.";
const POINT = "a mark you can step inside has a place and an extent; a point has no inside";

const KEEP = "quill/the-keep";
const marks = () => [
  { id: "quill/yard", kind: "sited", by: "quill", at: { x: 1000, y: 1000 }, extent: { w: 500, h: 400 }, body: "The open yard." },
  { id: KEEP, kind: "sited", by: "quill", class: "dungeon", at: { x: 1000, y: 1000 }, extent: { w: 300, h: 300 }, body: "The keep." },
  { id: "quill/porch", kind: "sited", by: "quill", at: { x: 880, y: 1000 }, extent: { w: 50, h: 50 }, body: "The porch." },
  { id: "quill/gallery", kind: "sited", by: "quill", at: { x: 1030, y: 1000 }, extent: { w: 200, h: 200 }, body: "The gallery." },
  { id: "quill/lane", kind: "sited", by: "quill", at: { x: 820, y: 1000 }, extent: { w: 30, h: 30 }, body: "The lane." },
  { id: "quill/gate-out", kind: "sited", by: "quill", at: { x: 845, y: 1000 }, extent: { w: 4, h: 2 }, body: "The gate.",
    entry: { word: "neutral", into: "quill/porch", lands_at: "quill/gate-in" } },
  { id: "quill/gate-in", kind: "sited", by: "quill", at: { x: 860, y: 1000 }, extent: { w: 4, h: 2 }, body: "From inside.",
    entry: { word: "neutral", into: "quill/lane" } },
  { id: "quill/gallery-door", kind: "sited", by: "quill", at: { x: 900, y: 1000 }, extent: { w: 2, h: 2 }, body: "To the gallery.",
    entry: { word: "neutral", into: ["quill/gallery", "quill/lane"] } },
  // a portal with a real extent, in the gallery: from the porch it is on the far side of a wall
  { id: "quill/gallery-back", kind: "sited", by: "quill", at: { x: 935, y: 1000 }, extent: { w: 2, h: 2 }, body: "Back.",
    entry: { word: "neutral", into: "quill/porch", lands_at: "quill/gallery-door" } },
  // a genuine point, out in the open: a place and no extent
  { id: "quill/lamp", kind: "sited", by: "quill", at: { x: 300, y: 300 }, body: "A lamp post." },
];
const key = (...h) => ({ handles: new Set(h) });
const row = (act, mark) => `- 2026-10-30T06:00:00.000Z · ann · ${act} ${mark} · ferry 299.0000${act === "enters" ? " · word neutral" : ""}`;
const inThePorch = [row("enters", KEEP), row("enters", "quill/porch")].join("\n") + "\n";

/** one office in a closure: the fixture world, the resident standing where we
 *  put them, an in-memory ledger, and every pen that could write or move */
async function officeWith({ standing, ledger = "" }) {
  const thresholds = await grammarOf();
  const worldState = { marks: marks() };
  let text = ledger;
  const records = [], stops = [], lands = [];
  return {
    records, stops, lands,
    deps: {
      world: async () => worldState,
      ledger: async () => text,
      standpointOf: async (who) => ({ ...standing, name: who }),
      acts: async () => [],
      now: () => 300,
      record: async (payload) => {
        records.push(payload);
        text += payload.lines.join("\n") + "\n";
        const folded = thresholds.parseEnterExitLedger(text).acts;
        return { lines: payload.lines, within: thresholds.occupancyAt(folded, 300).get(payload.handle) ?? [], commit: "deadbeef", pushed: false };
      },
      stop: async (who, to) => { stops.push({ who, to }); },
      land: async (who, to) => { lands.push({ who, to }); },
    },
  };
}
const refusal = async (o, payload) => {
  try { await enterViaOffice(CLONE, payload, key("ann"), o.deps); }
  catch (e) { return e; }
  assert.fail(`enter ${JSON.stringify(payload)} was not refused`);
};
const nothingHappened = (o, what) => {
  assert.deepEqual(o.records, [], `${what}: no act recorded`);
  assert.deepEqual(o.stops, [], `${what}: nobody walked`);
  assert.deepEqual(o.lands, [], `${what}: nobody landed`);
};

test("a portal with an extent, in a room you are not in: 422, the neutral hint, never 'a point has no inside', nothing recorded", { skip: SKIP }, async () => {
  const o = await officeWith({ standing: { x: 935, y: 1000 }, ledger: inThePorch });
  const e = await refusal(o, { mark: "quill/gallery-back" });
  assert.equal(e.code, 422);
  assert.equal(e.defect, "no mark 'quill/gallery-back' to enter", "the clone's own defect, unchanged");
  assert.equal(e.hint, HINT);
  assert.doesNotMatch(e.hint, /no inside|point/, "the old, false explanation is gone");
  nothingHappened(o, "out-of-room portal");
});

test("missing and hidden answer alike: the same hint and the same body but for the caller's own id, naming no room, portal or way", { skip: SKIP }, async () => {
  const o = await officeWith({ standing: { x: 1000, y: 1000 } });
  const hidden = await refusal(o, { mark: "quill/gallery" });      // a room inside the keep, from outside it
  const missing = await refusal(o, { mark: "quill/no-such-room" }); // no mark at all
  assert.equal(hidden.code, 422); assert.equal(missing.code, 422);
  assert.equal(hidden.hint, HINT); assert.equal(missing.hint, HINT);
  const shape = (e, id) => {
    const body = actCaught(e, { did: "enter" });
    assert.equal(body.defect, `no mark '${id}' to enter`);
    return { ...body, defect: body.defect.replace(id, "<id>") };
  };
  assert.deepEqual(shape(hidden, "quill/gallery"), shape(missing, "quill/no-such-room"), "nothing tells the two apart");
  const told = JSON.stringify(actCaught(hidden, {}));
  for (const m of marks()) if (m.id !== "quill/gallery") assert.ok(!told.includes(m.id), `no other mark is named (${m.id})`);
  for (const word of ["keep", "porch", "gate", "dungeon"]) assert.ok(!told.toLowerCase().includes(word), `nothing about ${word}`);
  nothingHappened(o, "missing and hidden");
});

test("a genuine point still says it has no inside, and a visible portal at hand still enters", { skip: SKIP }, async () => {
  const atLamp = await officeWith({ standing: { x: 300, y: 300 } });
  const point = await refusal(atLamp, { mark: "quill/lamp" });
  assert.equal(point.code, 422);
  assert.match(point.defect, /has no extent/);
  assert.equal(point.hint, POINT, "the no-inside guidance stays where it is true");
  nothingHappened(atLamp, "point");

  const atGate = await officeWith({ standing: { x: 845, y: 1000 } });
  const a = await enterViaOffice(CLONE, { mark: "quill/gate-out" }, key("ann"), atGate.deps);
  assert.deepEqual(a.entered, [KEEP, "quill/porch"]);
  assert.equal(atGate.records.length, 1, "the passage is written once, as before");
});

test("the special refusals keep their status, hint and fields", { skip: SKIP }, async () => {
  const outside = await officeWith({ standing: { x: 1000, y: 1000 } });
  const d = await refusal(outside, { mark: KEEP });
  assert.equal(d.code, 403);
  assert.equal(d.dungeon, KEEP);
  assert.deepEqual(d.portals, ["quill/gate-out"]);
  assert.match(d.hint, /reached one portal at a time/);
  nothingHappened(outside, "dungeon");

  const atDoor = await officeWith({ standing: { x: 900, y: 1000 }, ledger: inThePorch });
  const c = await refusal(atDoor, { mark: "quill/gallery-door", into: "quill/elsewhere" });
  assert.equal(c.code, 422);
  assert.equal(c.hint, "name one of the portal's ways with into: <id>. Nothing was recorded");
  assert.deepEqual(c.choose.map((w) => w.id), ["quill/gallery", "quill/lane"]);
  nothingHappened(atDoor, "choose");
});
