// household-activity.test.mjs — WLD-29: the porch light is household activity,
// from the store (Darko, 2026-10-08), by last-active.mjs's one definition, in
// the window C and C-1, folded over each house's non-emeritus residents
// (Wright, AUTHORITY 2026-10-13T11:04:36.763Z).
//
// The store is a SPY: it answers the registry, the town roll and last-active's
// own statement from synthetic rows, and records every statement it was asked.
// Which source rows count as "active" is last-active.mjs's statement, executed
// by Postgres; this suite proves the digest asks THAT statement (byte-identical,
// once, for every member) and folds its answer. No real letter, act or body.

import test from "node:test";
import assert from "node:assert/strict";
import { currentCrossing } from "../src/crossings.mjs";
import { LAST_ACTIVE_SQL } from "../src/last-active.mjs";
import { rowsFromRegistry } from "../src/registry-rows.mjs";
import {
  householdActivity, readHouseholdActivity, foldHouseholds, housesOf, litAt, isCurrentRead, isEmeritus,
  ROLL_SQL, ACTIVITY_HISTORICAL, ACTIVITY_UNAVAILABLE, LIT_WINDOW,
} from "../src/household-activity.mjs";

const NOW = Date.parse("2026-10-13T12:00:00Z");
const C = currentCrossing(NOW);
const atCrossing = (n) => new Date(Date.parse("2026-06-12T00:00:00Z") + n * 12 * 3600e3 + 3600e3).toISOString();
assert.equal(currentCrossing(Date.parse(atCrossing(C))), C, "the fixture's instant falls in the crossing it names");

const REGISTRY = rowsFromRegistry({ households: {
  "ash-house": { residents: ["ash", "ash-kin"], accounts: [{ login: "ash-gh", id: 1 }] },
  "birch-house": { residents: ["birch"], accounts: [{ login: "birch-gh", id: 2 }] },
  "cedar-house": { residents: ["cedar", "cedar-elder"], accounts: [{ login: "cedar-gh", id: 3 }] },
} }, { "cedar-elder": { login: "cedar-elder-gh", id: 9, retired: true } });

/** A store that answers four questions and records each. `active`: handle → [{ at, src }]. */
function spyStore({ active = {}, roll = ["ash", "birch", "cedar", "dune"], fail = null } = {}) {
  const asked = [];
  const q = {
    async query(sql, params = []) {
      const text = String(sql);
      asked.push({ sql: text, params });
      if (fail && fail.test(text)) throw new Error("the store would not answer");
      if (/FROM households\b/.test(text)) return { rows: REGISTRY.households };
      if (/FROM household_pins\b/.test(text)) return { rows: REGISTRY.pins };
      if (/FROM registry_meta\b/.test(text)) return { rows: [] };
      if (text === ROLL_SQL) return { rows: roll.map((handle) => ({ handle })) };
      if (text === LAST_ACTIVE_SQL) {
        const want = new Set(params[0]);
        return { rows: Object.entries(active).filter(([h]) => want.has(h)).flatMap(([handle, xs]) => xs.map((x) => ({ handle, ...x }))) };
      }
      throw new Error(`the spy store was asked something it does not answer: ${text.slice(0, 80)}`);
    },
  };
  return { q, asked };
}

test("ONE DEFINITION, ONE ROUND: the digest asks last-active.mjs's own statement, once, for every member of every house — and that statement counts acts, sent letters and page updates, never reads, received mail or stakes", async () => {
  const { q, asked } = spyStore({ active: { ash: [{ at: atCrossing(C), src: "act" }] } });
  await householdActivity(q, { now: NOW });
  const la = asked.filter((a) => a.sql === LAST_ACTIVE_SQL);
  assert.equal(la.length, 1, "one statement for the whole town, never one per resident or per house");
  assert.deepEqual([...la[0].params[0]].sort(), ["ash", "ash-kin", "birch", "cedar", "cedar-elder", "dune"].sort());
  assert.equal(asked.length, 5, "the registry's three reads, the roll, and last-active: nothing else");
  // the statement's sources, as last-active.mjs rules them (POS-481): the
  // statement is that module's, byte for byte, so its own falsifiers hold here
  assert.match(LAST_ACTIVE_SQL, /FROM acts/);
  assert.match(LAST_ACTIVE_SQL, /FROM town_letters\s+WHERE from_h = ANY/, "letters the resident SENT");
  assert.match(LAST_ACTIVE_SQL, /FROM office_town_journal\s+WHERE class = 'update'/, "their page updates");
  assert.doesNotMatch(LAST_ACTIVE_SQL, /to_h|stamp_lines|reads?\b/i, "mail received, stakes and reads are not sources");
});

test("THE WINDOW: C and C-1 lit; C-2, a future crossing and no act on record dark; an unknown answer is unknown, not dark", () => {
  assert.equal(LIT_WINDOW, 1);
  assert.equal(litAt(C, C), true);
  assert.equal(litAt(C - 1, C), true);
  assert.equal(litAt(C - 2, C), false);
  assert.equal(litAt(C + 1, C), false, "a crossing after the clock is not lit");
  assert.equal(litAt(null, C), false, "known: nobody in the house has an act on record");
  assert.equal(litAt(undefined, C), null, "a house the digest does not know is unknown");
  assert.equal(litAt(C, null), null, "no clock (a historical read) knows no light");
});

test("THE FOLD: each house's crossing is the newest over its residents; the roll's residents of no house are houses of one; house_of maps every handle", async () => {
  const { q } = spyStore({ active: {
    ash: [{ at: atCrossing(C - 5), src: "act" }],
    "ash-kin": [{ at: atCrossing(C - 1), src: "letter" }, { at: atCrossing(C - 3), src: "act" }],
    birch: [{ at: atCrossing(C - 2), src: "update" }],
    dune: [{ at: atCrossing(C), src: "act" }],
  } });
  const a = await householdActivity(q, { now: NOW });
  assert.equal(a.clock, C);
  assert.deepEqual(a.households, { "hh:ash-house": C - 1, "hh:birch-house": C - 2, "hh:cedar-house": null, "solo:dune": C });
  assert.deepEqual(a.house_of, { ash: "hh:ash-house", "ash-kin": "hh:ash-house", birch: "hh:birch-house", cedar: "hh:cedar-house", "cedar-elder": "hh:cedar-house", dune: "solo:dune" });
  assert.deepEqual(Object.keys(a).sort(), ["clock", "house_of", "households", "means", "window"].sort(),
    "metadata only: no instants, no sources, no per-actor history");
  assert.equal(litAt(a.households["hh:ash-house"], a.clock), true, "an active co-resident lights the house");
  assert.equal(litAt(a.households["hh:birch-house"], a.clock), false);
});

test("EMERITUS, BEFORE THE MAX: an emeritus-only recent act is dark; a non-emeritus co-resident's recent act lights; emeritus recent + ordinary old stays dark", () => {
  const houses = new Map([["hh:a", ["old-a", "new-a"]], ["hh:b", ["em-b", "live-b"]], ["hh:c", ["em-c", "old-c"]]]);
  const found = new Map([
    ["new-a", { crossing: C }], ["old-a", { crossing: C - 9 }],               // emeritus-only recent
    ["em-b", { crossing: C - 30 }], ["live-b", { crossing: C }],               // a live co-resident's recent act
    ["em-c", { crossing: C }], ["old-c", { crossing: C - 7 }],                 // emeritus recent, ordinary old
  ]);
  const EMERITUS = new Set(["new-a", "em-b", "em-c"]);
  const { households } = foldHouseholds({ houses, found, isEmeritus: (h) => EMERITUS.has(h) });
  assert.deepEqual(households, { "hh:a": C - 9, "hh:b": C, "hh:c": C - 7 });
  assert.deepEqual(Object.values(households).map((x) => litAt(x, C)), [false, true, false]);
  // the same rows, nobody emeritus: the first and third light — the predicate is what darkened them
  const plain = foldHouseholds({ houses, found }).households;
  assert.deepEqual(Object.values(plain).map((x) => litAt(x, C)), [true, true, true]);
});

test("PRODUCTION'S SEAM: isEmeritus is false for everyone until POS-453 wires its field — a retired pin does not make a resident emeritus", async () => {
  for (const h of ["ash", "cedar-elder", "anyone", "", null]) assert.equal(isEmeritus(h), false);
  assert.ok(REGISTRY.pins.some((p) => p.handle === "cedar-elder" && p.retired), "the fixture's elder has a retired pin");
  const { q } = spyStore({ active: { "cedar-elder": [{ at: atCrossing(C), src: "act" }] } });
  const a = await householdActivity(q, { now: NOW });
  assert.equal(litAt(a.households["hh:cedar-house"], a.clock), true, "the retired pin's resident still lights the house in production");
});

test("A HISTORICAL READ carries no lit state, and says why; a current read is one with no crossing, or today's", async () => {
  const { q, asked } = spyStore();
  const h = await householdActivity(q, { current: false, now: NOW });
  assert.deepEqual(h, { clock: null, households: null, house_of: null, historical: true, note: ACTIVITY_HISTORICAL });
  assert.equal(asked.length, 0, "a historical read asks the store nothing — today's activity is not painted onto it");
  assert.match(ACTIVITY_HISTORICAL, /activity isn't kept per crossing/);
  assert.equal(isCurrentRead(undefined, NOW), true);
  assert.equal(isCurrentRead("", NOW), true);
  assert.equal(isCurrentRead(String(C), NOW), true);
  assert.equal(isCurrentRead(C - 3, NOW), false);
  assert.equal(isCurrentRead(C + 4, NOW), false);
});

test("AN UNREAD STORE IS NOT A DARK TOWN: a failing read is disclosed, every house unknown, nothing filled from another source", async () => {
  for (const fail of [new RegExp(LAST_ACTIVE_SQL.slice(0, 20).replace(/[()*]/g, "\\$&")), /FROM households\b/, /town_roll/]) {
    const { q } = spyStore({ fail });
    const a = await readHouseholdActivity({ read: (fn) => fn(q), backend: q, now: NOW });
    assert.deepEqual(a, { clock: C, households: null, house_of: null, unavailable: ACTIVITY_UNAVAILABLE }, String(fail));
    assert.equal(litAt(a.households?.["hh:ash-house"], a.clock), null, "unknown, not dark");
  }
  const ok = await readHouseholdActivity({ read: (fn) => fn(spyStore().q), backend: {}, now: NOW });
  assert.equal(ok.unavailable, undefined);
});

test("housesOf: the registry's houses keyed hh:<slug>; a roll resident already housed is not a second house", () => {
  const houses = housesOf({ households: { "a-house": { residents: ["a", "b"] }, empty: { residents: [] } } }, ["a", "z"]);
  assert.deepEqual([...houses.entries()], [["hh:a-house", ["a", "b"]], ["solo:z", ["z"]]]);
});

test("SOLO MAPPINGS STAY (Wright, AUTHORITY 2026-10-13T15:44:10.855Z): house_of names every resident, a solo one too — the viewer looks up house_of[who], it infers no solo key", () => {
  const houses = housesOf({ households: { "a-house": { residents: ["a", "b"] } } }, ["a", "solo-sam"]);
  const { households, house_of } = foldHouseholds({ houses, found: new Map([["solo-sam", { crossing: 9 }]]) });
  assert.equal(house_of["solo-sam"], "solo:solo-sam", "a solo resident's mapping is kept, not deduplicated away");
  assert.equal(households["solo:solo-sam"], 9);
  assert.deepEqual(Object.keys(house_of).sort(), ["a", "b", "solo-sam"]);
});
