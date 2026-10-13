// porch-lights.test.mjs — WLD-29, the pointer model: WHAT LEAVES THE OFFICE.
//
// The office keeps the town's household activity to itself (household-
// activity.mjs § what leaves). Out of it come three small things, and this
// file holds each to its shape:
//   · lightsAnswer — GET /world/lights: { crossing, window, lit: [keys] }, the
//     lit household keys only; a past crossing or an unread store says so with
//     `lit: null`, never an empty list;
//   · litOf — a shown house's `lit`, joined by the parcel's own
//     `declared_household` (the fold's key, `hh:<slug>` or `solo:<handle>`);
//   · houseFocus — "lit; last active crossing N; what lights a house".
// And the caller's bound: a reader waits CALLER_WAIT_MS, then is told so by
// name, while the one batch it was waiting on runs on into the cache.
//
// Synthetic only: a spy store answers the registry, the roll and last-active's
// own statement. The held-lock proof on a real Postgres is
// porch-lights-store.test.mjs's.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { currentCrossing } from "../src/crossings.mjs";
import { LAST_ACTIVE_SQL } from "../src/last-active.mjs";
import { rowsFromRegistry } from "../src/registry-rows.mjs";
import {
  lightsAnswer, litOf, houseFocus, houseKeyOf, lightsUnknownWhy, readHouseholdActivity, resetActivityCache,
  LIGHT_MEANS, ACTIVITY_HISTORICAL, ACTIVITY_UNAVAILABLE, ACTIVITY_SLOW, CALLER_WAIT_MS, BATCH_STATEMENT_TIMEOUT_MS, ROLL_SQL, LIT_WINDOW,
} from "../src/household-activity.mjs";

const T0 = Date.parse("2026-10-13T12:00:00Z");
const C = currentCrossing(T0);

// A working answer as the fold makes it: ash's house lit at C-1, birch's dark,
// cedar's house has no act on record, dune lives alone and acted at C.
const ACT = {
  clock: C,
  households: { "hh:ash-house": C - 1, "hh:birch-house": C - 4, "hh:cedar-house": null, "solo:dune": C, "solo:eve": C + 2 },
  house_of: { ash: "hh:ash-house", "ash-kin": "hh:ash-house", birch: "hh:birch-house", cedar: "hh:cedar-house", dune: "solo:dune", eve: "solo:eve" },
};
const parcel = (by, declared) => ({ id: `${by}/plot`, kind: "parcel", by, ...(declared === undefined ? {} : { declared_household: declared }) });

beforeEach(() => resetActivityCache());

test("GET /world/lights: { crossing, window, lit } and nothing else — the lit keys only, sorted, solo houses among them; no member, no house map, no act", () => {
  const a = lightsAnswer(structuredClone(ACT), C);
  assert.deepEqual(a, { crossing: C, window: LIT_WINDOW, lit: ["hh:ash-house", "solo:dune"] });
  const text = JSON.stringify(a);
  assert.doesNotMatch(text, /ash-kin|"house_of"|"households"|birch|cedar|"at"|"src"/, "no member, no map, no act");
  // dark, never-acted and a future-dated house are not lit, and not listed
  assert.ok(!a.lit.includes("hh:birch-house") && !a.lit.includes("hh:cedar-house") && !a.lit.includes("solo:eve"));
});

test("GET /world/lights: a past crossing and an unread or slow store SAY so — `lit: null`, never [] (a dark town)", () => {
  const past = lightsAnswer({ clock: null, households: null, house_of: null, historical: true, note: ACTIVITY_HISTORICAL }, C - 3);
  assert.deepEqual(past, { crossing: C - 3, window: LIT_WINDOW, lit: null, historical: true, note: ACTIVITY_HISTORICAL });
  for (const why of [ACTIVITY_UNAVAILABLE, ACTIVITY_SLOW]) {
    const down = lightsAnswer({ clock: C, households: null, house_of: null, unavailable: why }, C);
    assert.deepEqual(down, { crossing: C, window: LIT_WINDOW, lit: null, unavailable: why });
  }
  assert.equal(lightsAnswer(null, C).lit, null, "no answer at all is unknown too");
  // and a town where nobody is lit IS the empty list — known, and said as known
  assert.deepEqual(lightsAnswer({ clock: C, households: { "hh:a": C - 9 }, house_of: {} }, C).lit, []);
});

test("A SHOWN HOUSE'S `lit`: the parcel's own declared_household first (hh: and solo: alike), its owner's house otherwise; unknown is null, never false", () => {
  assert.equal(litOf(parcel("ash", "hh:ash-house"), ACT), true, "C-1 lights");
  assert.equal(litOf(parcel("dune", "solo:dune"), ACT), true, "a solo house by its own key");
  assert.equal(litOf(parcel("birch", "hh:birch-house"), ACT), false, "an older act is dark");
  assert.equal(litOf(parcel("cedar", "hh:cedar-house"), ACT), false, "no act on record is dark — known");
  assert.equal(litOf(parcel("eve", "solo:eve"), ACT), false, "an act dated after the clock is not lit");
  assert.equal(litOf(parcel("ash-kin"), ACT), true, "no declared key: the owner's house in the registry");
  assert.equal(litOf(parcel("ash-kin", "solo:ash-kin"), ACT), true, "a declared key the answer does not know (registry lag): the owner's house");
  assert.equal(houseKeyOf(parcel("ash-kin", "solo:ash-kin"), ACT), "hh:ash-house");
  assert.equal(litOf(parcel("stranger"), ACT), null, "a house nobody's registry or roll names is unknown");
  assert.equal(litOf(parcel("ash", "hh:ash-house"), { clock: C, households: null, house_of: null, unavailable: ACTIVITY_UNAVAILABLE }), null, "an unread store is unknown");
  assert.equal(litOf(parcel("ash", "hh:ash-house"), { clock: null, households: null, house_of: null, historical: true, note: ACTIVITY_HISTORICAL }), null, "a past crossing is unknown");
  assert.equal(lightsUnknownWhy(ACT), null);
});

test("THE FOCUSED HOUSE: lit, last active crossing and what lights a house — when, never who or what; unknown says why", () => {
  assert.deepEqual(houseFocus(parcel("ash", "hh:ash-house"), ACT), { lit: true, last_active_crossing: C - 1, crossing: C, means: LIGHT_MEANS });
  assert.deepEqual(houseFocus(parcel("cedar", "hh:cedar-house"), ACT), { lit: false, last_active_crossing: null, crossing: C, means: LIGHT_MEANS });
  assert.doesNotMatch(JSON.stringify(houseFocus(parcel("ash", "hh:ash-house"), ACT)), /ash-kin|"at"|"src"|house_of/);
  const past = houseFocus(parcel("ash", "hh:ash-house"), { clock: null, households: null, house_of: null, historical: true, note: ACTIVITY_HISTORICAL });
  assert.deepEqual(past, { lit: null, last_active_crossing: null, unknown: ACTIVITY_HISTORICAL, means: LIGHT_MEANS }, "a past crossing's lights are not rebuilt from the newest act");
  const stranger = houseFocus(parcel("stranger"), ACT);
  assert.equal(stranger.lit, null);
  assert.match(stranger.unknown, /not one the store's registry or roll names/);
  assert.match(LIGHT_MEANS, /C or C-1/);
  assert.match(LIGHT_MEANS, /not emeritus/);
});

// ── THE CALLER'S BOUND, on a spy store whose batch can be held open ──────────
const REG = rowsFromRegistry({ households: { "ash-house": { residents: ["ash", "ash-kin"], accounts: [{ login: "a", id: 1 }] } } }, {});
function heldStore() {
  const s = { batches: 0, gates: [], fail: false };
  s.q = {
    async query(sql) {
      const t = String(sql);
      if (/FROM households\b/.test(t)) return { rows: REG.households };
      if (/FROM household_pins\b|FROM registry_meta\b/.test(t)) return { rows: [] };
      if (t === ROLL_SQL) return { rows: [{ handle: "ash" }] };
      if (t === LAST_ACTIVE_SQL) {
        s.batches += 1;
        if (s.gates.length) await s.gates.shift();
        if (s.fail) throw new Error("canceling statement due to statement timeout");
        return { rows: [{ handle: "ash-kin", at: new Date(T0).toISOString(), src: "act" }] };
      }
      throw new Error(`unexpected: ${t.slice(0, 60)}`);
    },
  };
  s.read = (opts = {}) => readHouseholdActivity({ read: (fn) => fn(s.q), backend: s, now: T0, ...opts });
  s.hold = () => { let open; s.gates.push(new Promise((r) => { open = r; })); return () => open(); };
  return s;
}

test("A SLOW STORE: the caller is told ACTIVITY_SLOW at CALLER_WAIT_MS, the batch runs on into the cache, and nobody starts a second one", async () => {
  assert.equal(CALLER_WAIT_MS, 1500);
  assert.equal(BATCH_STATEMENT_TIMEOUT_MS, 5000);
  const s = heldStore();
  const release = s.hold();
  const t0 = performance.now();
  const [a, b, c] = await Promise.all([s.read({ waitMs: 120 }), s.read({ waitMs: 120 }), s.read({ waitMs: 120 })]);
  const waited = performance.now() - t0;
  for (const r of [a, b, c]) assert.deepEqual(r, { clock: C, households: null, house_of: null, unavailable: ACTIVITY_SLOW });
  assert.ok(waited >= 100 && waited < 1000, `the callers waited ${waited.toFixed(0)} ms for a 120 ms bound`);
  assert.equal(s.batches, 1, "three waiting callers, one batch");
  release();
  const known = await s.read({ waitMs: 1000 });
  assert.equal(known.households["hh:ash-house"], C, "the held batch landed in the cache");
  assert.equal(s.batches, 1, "the next reader was served by it, not by a second batch");
});

test("A SLOW BATCH THAT THEN FAILS is not kept: the timed-out callers were told slow, the failure is quiet, and the next read asks again", async () => {
  const s = heldStore();
  const release = s.hold();
  s.fail = true;
  const slow = await s.read({ waitMs: 50 });
  assert.equal(slow.unavailable, ACTIVITY_SLOW);
  release();
  await new Promise((r) => setTimeout(r, 20));   // the batch fails behind the caller; no unhandled rejection
  s.fail = false;
  const again = await s.read({ waitMs: 1000 });
  assert.equal(s.batches, 2, "a failure is not cached");
  assert.equal(again.households["hh:ash-house"], C);
});

test("THE DEFAULT BOUND is the real one: an unanswered batch holds a reader about 1.5 s, not longer", async () => {
  const s = heldStore();
  const release = s.hold();
  const t0 = performance.now();
  const r = await s.read();
  const waited = performance.now() - t0;
  release();
  assert.equal(r.unavailable, ACTIVITY_SLOW);
  assert.ok(waited >= 1400 && waited < 2500, `waited ${waited.toFixed(0)} ms`);
});
