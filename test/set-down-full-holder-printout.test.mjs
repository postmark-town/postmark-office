// set-down-full-holder-printout.test.mjs — WLD-138 (Darko 2026-11-03 00:09 EDT, "Yes, at settlement"):
// a filled holder is set down WITH its contents, and holder and contents appear together at the next settlement.
//
// The door's half is proved on a real store in kind-door-at-the-hold-door.test.mjs (WLD-138 · SET DOWN FULL): one
// set-down act, the contents' rows untouched, the contents still held by the holder's id. This file is the
// clearing's half, on hold-through's own pure planner (`holdPrintout`) over INVENTED records only — no store, no
// settlement, no real record, nothing read from a clone:
//
//   · the holder's own place is its draft's (the set-down act is in `setDowns`), so it is never printed from a drop;
//   · every thing the record says the holder holds prints `held_by: <the holder>` with no place of its own, whether
//     the holder's draft has been published yet or not, and none is printed loose, dropped or twice;
//   · what the printout carries is exactly what the record holds (counts and ids), so nothing is lost or invented.
//
// THE CAN-FAIL FLIPS (each run by hand at this head; the claim is in the PR body):
//   restore P2-d in world-hold § setDownMade        → the door tests red (kind-door-at-the-hold-door.test.mjs)
//   drop the contents' cascade rows (a lost carry)   → "the contents print held_by" and the conservation test red
//   hold-through ignoring `setDowns`                 → "the holder is not printed from a drop" red

import { test } from "node:test";
import assert from "node:assert/strict";
import { holdPrintout } from "../world2/tools/hold-through.mjs";
import { HELD_BY } from "../src/held.mjs";

const MAKER = "sbx-cy", BAG = "sbx-cy/a-bag", PEBBLE = "sbx-cy/a-pebble", SHELL = "sbx-cy/a-shell";
const standing = (id, at, data = {}) => ({
  id: `${id.length}`, slug: id, kind: "thing", owner: MAKER, household: MAKER, parent: null, body: "invented",
  geometry: at ? { at, extent: { w: 1, h: 1 } } : null, data,
});
// the hold record, as guard-reads hands it: the latest row per thing wins (held.mjs § latestRows)
const inBag = (target, act_id) => ({ target, entity: BAG, policy: "cascade", act_id });
const bagSetDown = (act_id) => ({ target: BAG, entity: null, policy: "detach", act_id });
const heldOf = (plan) => Object.fromEntries(plan.prints.map((p) => [p.slug, { held_by: p.data[HELD_BY] ?? null, at: p.geometry?.at ?? null }]));

test("the contents print held_by the holder, unplaced, while the holder's own draft is still waiting (no standing row for it yet)", () => {
  const plan = holdPrintout({
    attachments: [inBag(PEBBLE, 7), inBag(SHELL, 8), bagSetDown(12)],
    rows: [standing(PEBBLE, { x: 3, y: 4 }), standing(SHELL, { x: 5, y: 6 })],
    from: 1, setDowns: new Set(["12"]),
  });
  assert.deepEqual(heldOf(plan), { [PEBBLE]: { held_by: BAG, at: null }, [SHELL]: { held_by: BAG, at: null } });
  assert.deepEqual(plan.notes, []);
  // where each last stood is kept unprinted, as for any held thing
  assert.deepEqual(plan.prints.map((p) => p.data._placed?.at), [{ x: 3, y: 4 }, { x: 5, y: 6 }]);
});

test("the holder is not printed from a drop (its draft places it), and the contents already printed are left alone: no churn, no note", () => {
  const rows = [
    standing(BAG, { x: 9, y: 9 }),
    standing(PEBBLE, null, { [HELD_BY]: BAG }), standing(SHELL, null, { [HELD_BY]: BAG }),
  ];
  const attachments = [inBag(PEBBLE, 7), inBag(SHELL, 8), bagSetDown(12)];
  const plan = holdPrintout({ attachments, rows, from: 1, setDowns: new Set(["12"]) });
  assert.deepEqual(plan.prints, []);
  assert.deepEqual(plan.notes, []);
  // the flip's positive control: without the set-down on record the same row is a drop with nowhere to compose, and says so
  const flipped = holdPrintout({ attachments, rows, from: 1, setDowns: new Set() });
  assert.match(flipped.notes.join("\n"), /a-bag: its set-down could not be placed/);
});

test("conservation: what the printout carries is exactly what the record holds: same ids, same count, none loose, none twice", () => {
  const record = [inBag(PEBBLE, 7), inBag(SHELL, 8), bagSetDown(12)];
  const holds = (att) => [...new Set(att.map((r) => r.target))].filter((t) => t !== BAG);
  const plan = holdPrintout({ attachments: record, rows: [standing(PEBBLE, { x: 3, y: 4 }), standing(SHELL, { x: 5, y: 6 })], from: 1, setDowns: new Set(["12"]) });
  assert.deepEqual(plan.prints.map((p) => p.slug).sort(), holds(record).sort());
  assert.equal(new Set(plan.prints.map((p) => p.slug)).size, plan.prints.length, "none printed twice");
  assert.ok(plan.prints.every((p) => p.data[HELD_BY] === BAG && p.geometry === null), "all held by the holder, none on the ground");
  // negative control: a lost carry (the contents' rows gone from the record) prints nothing, so the assertions above can fail
  const lost = holdPrintout({ attachments: [bagSetDown(12)], rows: [standing(PEBBLE, { x: 3, y: 4 }), standing(SHELL, { x: 5, y: 6 })], from: 1, setDowns: new Set(["12"]) });
  assert.notDeepEqual(lost.prints.map((p) => p.slug).sort(), holds(record).sort());
});

test("an EMPTY holder set down prints no contents and no churn (the ordinary case is unchanged)", () => {
  const plan = holdPrintout({ attachments: [bagSetDown(12)], rows: [standing(BAG, { x: 9, y: 9 })], from: 1, setDowns: new Set(["12"]) });
  assert.deepEqual(plan.prints, []);
  assert.deepEqual(plan.notes, []);
});
