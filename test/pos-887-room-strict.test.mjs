// pos-887-room-strict.test.mjs — the long listeners' strict room read (world.mjs § roomOfNowStrict), on an invented world.
//
//   node --test test/pos-887-room-strict.test.mjs
//
// A world with no dungeon is a VALID answer (nobody is in a room: the open) and touches no ledger; a world with a dungeon and a readable
// ledger answers the room or the open; the unreadable cases (the world, the ledger) are in say-push.test.mjs where the real swallowing
// reads are exercised. The fixture is the one dungeon-reach.test.mjs uses: a keep with a hall and a vault, invented.

import test from "node:test";
import assert from "node:assert/strict";
import { __setOccupancyForTest } from "../src/creature-sight.mjs";
import { NO_WORLD } from "./fixture-paths.mjs";

const KEEP = "fortholders/the-fort", HALL = "fortholders/the-great-room", VAULT = "fortholders/the-cellar", BENCH = "townsfolk/a-bench";
const mark = (id, kind, x, y, w, h, by = id.split("/")[0]) => ({ id, kind, by, household: by, tier: "market", at: { x, y }, extent: { w, h }, body: id, date: "2026-09-02T00:00:00Z" });
const WITH_KEEP = [mark(KEEP, "dungeon", 2000, 2000, 400, 400), mark(HALL, "sited", 2000, 2000, 60, 60), mark(VAULT, "sited", 2150, 2150, 60, 60), mark(BENCH, "thing", 100, 100, 2, 1)];
const NO_KEEP = [mark(BENCH, "thing", 100, 100, 2, 1)];

const withWorld = async (marks, fn) => {
  const world = await import("../src/world.mjs");
  world.__setWorldForTest({ marks });
  try { return await fn(world); } finally { world.__setWorldForTest(null); __setOccupancyForTest(null); }
};

test("roomOfNowStrict: the innermost room of the reader's stack, or the open", { skip: NO_WORLD || false }, async () => {
  await withWorld(WITH_KEEP, async (world) => {
    __setOccupancyForTest(() => new Map([["ann", [KEEP, HALL]], ["bo", [KEEP]]]));
    assert.equal(await world.roomOfNowStrict("ann"), HALL, "ann stands in the hall");
    assert.equal(await world.roomOfNow("ann"), HALL, "the ordinary read agrees where both can read");
    assert.equal(await world.roomOfNowStrict("bo"), null, "bo entered the keep but no room of it: the open, a known answer");
    assert.equal(await world.roomOfNowStrict("cy"), null, "a reader who entered nothing is in the open");
  });
});

test("roomOfNowStrict: a world with no dungeon is a valid answer (the open) and reads no ledger", { skip: NO_WORLD || false }, async () => {
  await withWorld(NO_KEEP, async (world) => {
    let reads = 0;
    __setOccupancyForTest(() => { reads += 1; return new Map([["ann", [KEEP, HALL]]]); });
    assert.equal(await world.roomOfNowStrict("ann"), null);
    assert.equal(reads, 0, "nobody needs the ledger when no room exists");
  });
});
