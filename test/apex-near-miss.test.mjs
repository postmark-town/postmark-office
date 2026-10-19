// apex-near-miss.test.mjs — the "did you mean" an unknown act field gets (POS-697 G1a).
//
// Wright's first walk sent `to` and bounced with the field list. Plain edit
// distance ranks `into` first for `to` (it, `to_x` and `to_y` are each two
// edits away), so the misses a newcomer makes are named per act in
// FIELD_NEAR, and anything else falls back to world-hold.mjs § nearestIds.
// The rig half (the bounce itself, through worldApex) is in world-apex.test.mjs.
//
// Run: node --test test/apex-near-miss.test.mjs

import test from "node:test";
import assert from "node:assert/strict";

import { didYouMean, FIELD_NEAR } from "../src/world-apex.mjs";
import { nearestIds } from "../src/world-hold.mjs";

const WALK = ["mark_id", "to_x", "to_y", "mode", "exit", "enter_on_arrival", "accept", "into"];

test("walk's `to` means a mark or a point, never `into` first", () => {
  const near = didYouMean("walk", ["to"], WALK);
  assert.deepEqual(near.to.fields, ["mark_id", "to_x", "to_y"]);
  assert.equal(near.to.says, "mark_id (a mark) or to_x + to_y (a point)");
  // the reason the row exists: edit distance alone would lead with `into`
  assert.equal(nearestIds("to", WALK)[0], "into");
});

test("a miss with no row falls back to edit distance; a far one gets no guess", () => {
  assert.deepEqual(didYouMean("say", ["txt"], ["text", "nonce"]), { txt: { fields: ["text"], says: "text" } });
  assert.deepEqual(didYouMean("say", ["zz_probe"], ["text", "nonce"]), {});
});

test("a row is only offered for fields the act really declares", () => {
  // say's row names text; an act whose schema lost `text` offers nothing from the row
  assert.deepEqual(didYouMean("say", ["message"], ["words_only"]), {});
  for (const [act, rows] of Object.entries(FIELD_NEAR))
    for (const [miss, row] of Object.entries(rows)) {
      const fields = Array.isArray(row) ? row : row.fields;
      assert.ok(fields.length && !fields.includes(miss), `${act}.${miss}`);
    }
});
