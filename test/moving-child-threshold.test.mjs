// #2712 — a threshold nested in a carrier moves with that carrier.
// The resident standpoint already composes through the carrier frame; the
// threshold reach must compose through the same frame before measuring.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { enterViaOffice } from "../src/world-crossings.mjs";

const WHO = "sophia-familiaris";
const SHIP_ID = "the-town/the-post-office";
const key = { handles: new Set([WHO]) };

// `carrierInChain` added on review (2026-09-13), defaulting to the behaviour
// every test above already had: the engine's threshold chain names the carrier.
// Passing false gives an engine whose chain does NOT — a mark ashore, which the
// resident is not aboard — which is the only way to exercise the ancestor gate.
function fakeLawClone({ carrierInChain = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "postmark-2712-"));
  mkdirSync(join(dir, "tools"), { recursive: true });
  writeFileSync(join(dir, "tools", "enter-exit.mjs"), `
    export const stampAt = (x) => x;
    export const parseEnterExitLedger = () => ({ acts: [] });
    export const occupancyAt = () => new Map([["${WHO}", ["${SHIP_ID}"]]]);
  `);
  writeFileSync(join(dir, "tools", "world-verbs.mjs"), `
    function pointInBox(pos, mark) {
      if (Array.isArray(mark?.points) && mark.points.length >= 3) {
        const pts = mark.points.map((p) => Array.isArray(p) ? { x: p[0], y: p[1] } : p);
        const xs = pts.map((p) => Number(p.x)), ys = pts.map((p) => Number(p.y));
        return Number(pos?.x) >= Math.min(...xs) && Number(pos?.x) <= Math.max(...xs)
          && Number(pos?.y) >= Math.min(...ys) && Number(pos?.y) <= Math.max(...ys);
      }
      const x = Number(mark?.at?.x), y = Number(mark?.at?.y);
      const w = Number(mark?.extent?.w), h = Number(mark?.extent?.h);
      return Number(pos?.x) >= x - w / 2 && Number(pos?.x) <= x + w / 2
        && Number(pos?.y) >= y - h / 2 && Number(pos?.y) <= y + h / 2;
    }
    export const pointWithinMark = pointInBox;
    export function enter(state, targetId, world, { occupancy, handle }) {
      const target = world.marks.find((m) => m.id === targetId);
      if (!target) return { error: "missing target" };
      const chain = ${carrierInChain ? '["' + SHIP_ID + '", targetId]' : "[targetId]"};
      const held = occupancy.get(handle) ?? [];
      const links = chain.filter((id) => !held.includes(id));
      const standing = pointInBox(state, target);
      return {
        target: targetId, chain, links, held,
        walk: standing || !links.length ? null : { to: { ...target.at }, mark: targetId },
        crossings: links.map((id) => ({ mark: id, effect: "entered", terms: [] })),
        rows: links.map((id) => handle + " enters " + id),
        entered: links, within: [...held, ...links],
        stranded: null, refused: null, awaiting: null,
      };
    }
  `);
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function deps(world, here) {
  return {
    world: async () => world,
    ledger: async () => "",
    standpointOf: async () => ({ ...here, name: WHO }),
    now: () => 185,
    record: async ({ lines }) => ({
      lines, within: [SHIP_ID, lines.at(-1)?.split(" ").at(-1)].filter(Boolean),
      commit: "fixture", pushed: false,
    }),
  };
}

test("#2712 — an aboard resident can enter a child threshold at the carrier's live position", async (t) => {
  const c = fakeLawClone(); t.after(c.cleanup);
  const ship = { id: SHIP_ID, kind: "sited", at: { x: 0, y: 0 }, extent: { w: 10, h: 26 } };
  const wheelhouse = { id: "the-town/the-wheelhouse", kind: "sited", at: { x: 0, y: 1 }, extent: { w: 4, h: 2 } };
  const world = { marks: [ship, wheelhouse] };
  // Carrier origin is now (1800, 400); Sophia stands at the wheelhouse's
  // canonical +1 m y offset inside that moving frame.
  const here = { x: 1800, y: 401, aboard: true, frame: SHIP_ID, frame_offset: { x: 0, y: 1 }, moving: false };
  const answer = await enterViaOffice(c.dir, { mark: wheelhouse.id, handle: WHO }, key, deps(world, here));
  assert.deepEqual(answer.entered, [wheelhouse.id]);
  assert.equal(answer.walk_bundled, undefined, "no stale walk back to the canonical quay is returned after a live-frame admission");
});

test("#2712 — irregular child geometry is translated with its carrier, not just its anchor", async (t) => {
  const c = fakeLawClone(); t.after(c.cleanup);
  const ship = { id: SHIP_ID, kind: "sited", at: { x: 0, y: 0 }, extent: { w: 400, h: 400 } };
  const gallery = {
    id: "the-town/the-gallery", kind: "sited", at: { x: 0, y: 0 }, extent: { w: 200, h: 200 },
    points: [[-100, -100], [100, -100], [100, 100], [-100, 100]],
  };
  const world = { marks: [ship, gallery] };
  // 80 m from the translated anchor: outside the 60 m reach margin but
  // inside the translated polygon. Moving only `at` would still refuse.
  const here = { x: 1080, y: 1000, aboard: true, frame: SHIP_ID, frame_offset: { x: 80, y: 0 }, moving: false };
  const answer = await enterViaOffice(c.dir, { mark: gallery.id, handle: WHO }, key, deps(world, here));
  assert.deepEqual(answer.entered, [gallery.id]);
});

test("#2712 — a real refusal points at the child's live-frame coordinates", async (t) => {
  const c = fakeLawClone(); t.after(c.cleanup);
  const ship = { id: SHIP_ID, kind: "sited", at: { x: 0, y: 0 }, extent: { w: 500, h: 500 } };
  const farDoor = { id: "the-town/the-far-door", kind: "sited", at: { x: 150, y: 0 }, extent: { w: 2, h: 2 } };
  const world = { marks: [ship, farDoor] };
  const here = { x: 1000, y: 1000, aboard: true, frame: SHIP_ID, frame_offset: { x: 0, y: 0 }, moving: false };
  const e = await enterViaOffice(c.dir, { mark: farDoor.id, handle: WHO }, key, deps(world, here)).then(() => null, (err) => err);
  assert.equal(e?.code, 409);
  assert.deepEqual(e.walk?.to, { x: 1150, y: 1000 }, "the remedy follows the carrier instead of sending the resident to the stale canonical mark");
  assert.match(e.hint ?? "", /\(1150, 1000\)/);
});

// ── THE WIRING, ADDED ON REVIEW (2026-09-13) ────────────────────────────────
//
// The three tests above prove the composition is right. They cannot prove the
// office ever reaches it, because they hand the door a standpoint they build
// themselves — and the office's own projection was answering `{ x, y, name }`
// and dropping `aboard`, `frame` and `frame_offset` on the floor. So the repair
// was correct and unreachable: `thresholdAtStandpointFrame` returned the target
// untranslated on every real call and Sophia would still have been refused.
//
// `standpointForCrossing` is that projection, named so a test can hand the door
// exactly what `crossingDeps` hands it. These two drive the same scenario
// through it. Revert the projection to its three keys and both go red.

import { standpointForCrossing } from "../src/world-apex.mjs";

test("#2712 — the office's OWN standpoint projection carries the frame the door composes with", () => {
  const projected = standpointForCrossing(
    { x: 1800, y: 401, placed: true, aboard: true, moving: false, frame: SHIP_ID, frame_offset: { x: 0, y: 1 } }, WHO);
  assert.equal(projected.aboard, true, "the door is not told the resident is aboard anything");
  assert.equal(projected.frame, SHIP_ID, "the door is not told WHICH carrier");
  assert.deepEqual(projected.frame_offset, { x: 0, y: 1 }, "the door is not told where inside it they stand");
  assert.equal(projected.x, 1800); assert.equal(projected.y, 401);
});

test("#2712 — ashore, the projection says so plainly and the door composes nothing", () => {
  const ashore = standpointForCrossing({ x: 5, y: 6, placed: true, moving: false }, WHO);
  assert.equal(ashore.aboard, false, "an absent carrier must read as ashore by answer, not by undefined");
  assert.equal(ashore.frame, null);
  assert.equal(ashore.frame_offset, null);
  // and an unplaced resident still lands at the origin, as before
  assert.deepEqual(standpointForCrossing(null, WHO), { x: 0, y: 0, name: WHO });
});

test("#2712 — the entry succeeds through the OFFICE'S projection, not only through a hand-built standpoint", async (t) => {
  const c = fakeLawClone(); t.after(c.cleanup);
  const ship = { id: SHIP_ID, kind: "sited", at: { x: 0, y: 0 }, extent: { w: 10, h: 26 } };
  const wheelhouse = { id: "the-town/the-wheelhouse", kind: "sited", at: { x: 0, y: 1 }, extent: { w: 4, h: 2 } };
  const world = { marks: [ship, wheelhouse] };
  const standpoint = { x: 1800, y: 401, placed: true, aboard: true, moving: false, frame: SHIP_ID, frame_offset: { x: 0, y: 1 } };
  const d = deps(world, standpoint);
  d.standpointOf = async () => standpointForCrossing(standpoint, WHO);   // the office's own words
  const answer = await enterViaOffice(c.dir, { mark: wheelhouse.id, handle: WHO }, key, d);
  assert.deepEqual(answer.entered, [wheelhouse.id],
    "the door refused a resident standing at the door — the composition is unreachable through the office's own standpoint, which is #2712 still open");
});

test("#2712 — a mark the resident is NOT aboard is never dragged along by the carrier", async (t) => {
  // THE GATE'S OWN FALSIFIER, added on review. Removing the engine's ancestor
  // check (`plan.chain.includes(here.frame)`) left every test above green,
  // because their fixture engine always names the carrier in the chain — so the
  // one line standing between "compose the frame" and "translate any mark the
  // asker happens to be riding past" was unguarded.
  //
  // Here the chain does NOT name the carrier: a shore door, at the town centre,
  // while the resident is 1.8 km away on a boat. It must be measured where it
  // stands. Composed instead, the boat's displacement would carry the door to
  // the resident's feet and let her walk through a building she is nowhere near.
  const c = fakeLawClone({ carrierInChain: false }); t.after(c.cleanup);
  const ship = { id: SHIP_ID, kind: "sited", at: { x: 0, y: 0 }, extent: { w: 10, h: 26 } };
  const shoreDoor = { id: "the-town/the-counting-house", kind: "sited", at: { x: 0, y: 0 }, extent: { w: 4, h: 4 } };
  const world = { marks: [ship, shoreDoor] };
  const standpoint = { x: 1800, y: 400, placed: true, aboard: true, moving: false, frame: SHIP_ID, frame_offset: { x: 0, y: 0 } };
  const d = deps(world, standpoint);
  d.standpointOf = async () => standpointForCrossing(standpoint, WHO);
  const e = await enterViaOffice(c.dir, { mark: shoreDoor.id, handle: WHO }, key, d).then(() => null, (err) => err);
  assert.equal(e?.code, 409, "a door ashore was entered from a boat 1.8 km away — the carrier frame was applied to a mark not aboard it");
  assert.deepEqual(e.walk?.to, { x: 0, y: 0 },
    "the remedy points somewhere other than where the shore door actually stands");
  assert.match(e.hint ?? "", /\(0, 0\)/);
});
