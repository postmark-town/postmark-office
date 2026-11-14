// room-carryover.test.mjs — CORE-97: a room carries across a settlement when anyone contributes in the hour after it (Darko 2026-11-14; Wright's settlement 15:54Z).
//
// THIS FILE IS BUILT IN SLICES. Slice 1 (here): the one shared policy, `roomOpen` / `edgeAfter` / ROOM_GRACE_MS in src/hearing-window.mjs, with invented instants.
// The readers (voices.mjs clustering and hearing, the stored record, the stored say read) follow in the next slices and are tested in this file too.
//
//   node --test test/room-carryover.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { ROOM_GRACE_MS, edgeAfter, roomOpen } from "../src/hearing-window.mjs";

const H = 3600_000;
const S1 = Date.UTC(2026, 10, 14, 6, 0, 0);   // an invented settlement
const S2 = S1 + 12 * H;                        // the next

test("the grace is one hour", () => { assert.equal(ROOM_GRACE_MS, H); });

test("edgeAfter: the first settlement strictly after an instant", () => {
  assert.equal(edgeAfter(S1 - 1, [S1, S2]), S1);
  assert.equal(edgeAfter(S1, [S1, S2]), S2, "a say AT a settlement is in the new epoch: the next edge is the one after");
  assert.equal(edgeAfter(S2 + 1, [S1, S2]), null);
  assert.equal(edgeAfter(0, []), null);
});

test("a room is open inside its settlement, for an hour past the one after its newest say, and then closed", () => {
  const marks = [S1, S2];
  assert.equal(roomOpen(S1 - 10 * 60_000, S1 - 1, marks), true, "before the settlement: open");
  assert.equal(roomOpen(S1 - 10 * 60_000, S1 + 30 * 60_000, marks), true, "inside the hour after: still open, nothing said yet");
  assert.equal(roomOpen(S1 - 10 * 60_000, S1 + H, marks), true, "at the hour exactly: open");
  assert.equal(roomOpen(S1 - 10 * 60_000, S1 + H + 1, marks), false, "past the hour with no say: closed");
  assert.equal(roomOpen(S1 + 30 * 60_000, S2 - 1, marks), true, "a room carried by a say in the hour lives to the next settlement with no idle timeout");
  assert.equal(roomOpen(S1 + 30 * 60_000, S2 + H + 1, marks), false, "and the same hour test applies again at the next settlement");
  assert.equal(roomOpen(5, 10, []), true, "no settlement known: open");
});
