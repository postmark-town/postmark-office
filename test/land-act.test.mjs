// land-act.test.mjs — WLD-63 row 68 B: a placement is a LANDING, never a walk.
//
// Darko 2026-10-16 19:15 ("recs for A1 B and a"; 18:55: "we can put that in the
// ledger as unique from a walk because you went through a portal"). One act,
// `land` (the-town/land), for every set-down: a door passed, a whole-dungeon
// exit, the Post Office's deposit, a ground's landing point. It is class move and
// reads as a departure that has already arrived, from = toward, so every reader
// of position takes it through the one list (live-reads § DEPARTURE_ACTIONS).

import { test } from "node:test";
import assert from "node:assert/strict";

import { landEntry, walkerLandings } from "../src/world.mjs";
import { CLASS_MOVE } from "../src/world-journal.mjs";
import { DEPARTURE_ACTIONS, departureRecordOf } from "../world2/tools/live-reads.mjs";
import { storedShapeOf } from "../src/world-movement.mjs";
import { recordOfMovement } from "../src/position-projection.mjs";
import { foldWalks, arrivals } from "../src/creatures-hook.mjs";
import { PUBLIC_ACTS } from "../src/world-read-v2.mjs";
import { LIVE_KINDS } from "../src/world-happened.mjs";

const P = { x: 3817.5, y: -5523.5 };

test("a landing is its own act: action land, class move, from = toward, no stride, and what set you down", () => {
  const e = landEntry({ crossing: 253.9275, who: "visitor", at: P, via: "darko/spire-red-stair-hall-to-rose-hall", why: "passage", writtenAt: "2026-10-16T23:07:51.945Z" });
  assert.equal(e.action, "land");
  assert.equal(e.cls, CLASS_MOVE, "the walk lane's class, so the pen's lane census is unchanged");
  assert.equal(e.object, "darko/spire-red-stair-hall-to-rose-hall");
  assert.deepEqual(e.payload.from, P);
  assert.deepEqual(e.payload.toward, P);
  assert.equal(e.payload.pace, null, "nobody walked");
  assert.deepEqual([e.payload.via, e.payload.why], ["darko/spire-red-stair-hall-to-rose-hall", "passage"]);
});

test("every reader of position reads it: land is in the one departure list, and its record is an arrived leg that says it landed", () => {
  assert.ok(DEPARTURE_ACTIONS.includes("land"));
  assert.ok(DEPARTURE_ACTIONS.includes("walk"), "and walks are still read");
  const e = landEntry({ crossing: 253.9275, who: "visitor", at: P, via: "darko/x", why: "passage" });
  const row = { id: "247", at: new Date("2026-10-16T23:07:51.945Z"), crossing: "253.9275878935185", actor: "visitor", action: "land", payload: e.payload };
  const r = departureRecordOf(row);
  assert.equal(r.refused, undefined, r.reason);
  assert.equal(r.era, "movement-store", "the era a live pen's row already reads as");
  assert.deepEqual([r.record.from, r.record.toward], [P, P]);
  assert.deepEqual(r.record.landed, { via: "darko/x", why: "passage" });
  // a walk's record carries no such key: every walk reads as it always did
  const walk = departureRecordOf({ ...row, action: "walk", payload: { from: P, toward: { x: 0, y: 0 }, pace: 60 } });
  assert.equal("landed" in walk.record, false);
  // and the key survives both roads a record travels: the store's shape and the projection's
  assert.deepEqual(storedShapeOf(r.record).landed, { via: "darko/x", why: "passage" });
  assert.equal("landed" in storedShapeOf(walk.record), false);
  assert.deepEqual(recordOfMovement({ actor: "visitor", from: P, toward: P, crossing: 253.9, at: "t", landed: { via: "darko/x", why: "passage" } }).landed,
    { via: "darko/x", why: "passage" });
});

test("the walkers read says who was just set down, and nothing for anyone walking or carried", () => {
  const departures = [{ handle: "visitor", iso: "2026-10-16T23:07:51.945Z", landed: { via: "darko/x", why: "passage" } }];
  const walk = { currentDeparture: (ds, h) => ds.find((d) => d.handle === h) ?? null };
  const rows = walkerLandings([{ handle: "visitor", standing: true }, { handle: "ann", moving: true }], departures, walk);
  assert.deepEqual(rows[0].landed, { via: "darko/x", why: "passage", iso: "2026-10-16T23:07:51.945Z" });
  assert.equal("landed" in rows[1], false);
});

test("a landing replaces a walk still on its way, as a stop does: no creature waits for an arrival that will not come", () => {
  arrivals.byActor.clear(); arrivals.cursor = "0";
  arrivals.byActor.set("visitor", { walk: "245", actor: "visitor", dueMs: 1 });
  foldWalks([{ id: "247", actor: "visitor", action: "land", payload: { from: P, toward: P } }], {});
  assert.equal(arrivals.byActor.has("visitor"), false);
  assert.equal(arrivals.cursor, "247");
});

test("the reads name it as a landing, never a walk", () => {
  assert.equal(PUBLIC_ACTS.land, "landed");
  assert.equal(LIVE_KINDS.land, "landing");
});
