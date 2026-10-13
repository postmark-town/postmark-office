// activity-cache.test.mjs — WLD-29 independent review (b): ONE current activity
// answer per store, per activity clock C, for ACTIVITY_TTL_MS, single-flight;
// a failure is never kept; every caller gets its own copy.
//
// Spy stores answer the registry, the roll and last-active's statement from
// synthetic rows and COUNT the batches (one last-active statement = one batch).
// Clocks are pinned through `now`; every test starts from resetActivityCache().

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { currentCrossing } from "../src/crossings.mjs";
import { LAST_ACTIVE_SQL } from "../src/last-active.mjs";
import { rowsFromRegistry } from "../src/registry-rows.mjs";
import { readHouseholdActivity, resetActivityCache, ACTIVITY_TTL_MS, ACTIVITY_MEANS, ACTIVITY_UNAVAILABLE, ROLL_SQL } from "../src/household-activity.mjs";

const T0 = Date.parse("2026-10-13T12:00:00Z");
const C = currentCrossing(T0);
const CROSSING_MS = 12 * 3600e3;
const REG = rowsFromRegistry({ households: { "ash-house": { residents: ["ash", "ash-kin"], accounts: [{ login: "a", id: 1 }] } } }, {});

/** A store whose last-active answer is `ash-kin` at `lastAt`; `gate` holds a batch open until released. */
function spyStore({ lastAt = new Date(T0).toISOString(), fail = false } = {}) {
  const s = { batches: 0, statements: 0, fail, lastAt, gates: [] };
  s.q = {
    async query(sql) {
      const t = String(sql);
      s.statements += 1;
      if (/FROM households\b/.test(t)) return { rows: REG.households };
      if (/FROM household_pins\b|FROM registry_meta\b/.test(t)) return { rows: [] };
      if (t === ROLL_SQL) return { rows: [{ handle: "ash" }, { handle: "solo-sam" }] };
      if (t === LAST_ACTIVE_SQL) {
        s.batches += 1;
        if (s.gates.length) await s.gates.shift();
        if (s.fail) throw new Error("the store would not answer");
        return { rows: [{ handle: "ash-kin", at: s.lastAt, src: "act" }] };
      }
      throw new Error(`unexpected: ${t.slice(0, 60)}`);
    },
  };
  s.read = (opts = {}) => readHouseholdActivity({ read: (fn) => fn(s.q), backend: s, now: T0, ...opts });
  s.hold = () => { let open; s.gates.push(new Promise((r) => { open = r; })); return () => open(); };
  return s;
}

beforeEach(() => resetActivityCache());

test("COLD, THEN WARM: the first read runs one batch; five more inside the TTL run none; ten concurrent cold reads run ONE", async () => {
  const s = spyStore();
  const first = await s.read();
  assert.equal(s.batches, 1);
  assert.equal(first.clock, C);
  for (let i = 1; i <= 5; i++) await s.read({ now: T0 + i * 1000 });
  assert.equal(s.batches, 1, "inside the TTL the shared answer is served");
  resetActivityCache();
  const burst = spyStore();
  const answers = await Promise.all(Array.from({ length: 10 }, () => burst.read()));
  assert.equal(burst.batches, 1, "concurrent misses wait on the one batch in flight");
  assert.ok(answers.every((a) => a.households["hh:ash-house"] === C));
});

test("EXPIRY: at the TTL the next read asks again — once", async () => {
  const s = spyStore();
  await s.read();
  await s.read({ now: T0 + ACTIVITY_TTL_MS - 1 });
  assert.equal(s.batches, 1);
  await s.read({ now: T0 + ACTIVITY_TTL_MS });
  assert.equal(s.batches, 2);
  await s.read({ now: T0 + ACTIVITY_TTL_MS + 10 });
  assert.equal(s.batches, 2);
});

test("A NEW CROSSING reads afresh, and is answered with its own clock — never the old clock's entry", async () => {
  const s = spyStore();
  const a = await s.read();
  const b = await s.read({ now: T0 + CROSSING_MS });
  assert.equal(s.batches, 2);
  assert.equal(a.clock, C);
  assert.equal(b.clock, C + 1);
});

test("AN OLD CLOCK'S REPLY landing late cannot replace the newer clock's entry, nor be relabelled with it", async () => {
  const s = spyStore();
  const release = s.hold();
  const old = s.read();                                   // clock C, held open
  await new Promise((r) => setImmediate(r));
  const fresh = await s.read({ now: T0 + CROSSING_MS });  // clock C+1, completes
  release();
  const late = await old;
  assert.equal(late.clock, C, "the late reply is still its own clock's answer");
  assert.equal(fresh.clock, C + 1);
  const again = await s.read({ now: T0 + CROSSING_MS + 1000 });
  assert.equal(s.batches, 2, "the C+1 entry was kept; the late C reply did not clear or replace it");
  assert.equal(again.clock, C + 1);
});

test("HISTORICAL stays explicit null and asks nothing — even with a warm current answer", async () => {
  const s = spyStore();
  await s.read();
  const before = s.statements;
  const h = await s.read({ current: false });
  assert.deepEqual([h.historical, h.clock, h.households], [true, null, null]);
  assert.match(h.note, /isn't kept per crossing/);
  assert.equal(s.statements, before);
});

test("UNAVAILABLE is never kept: a failed read answers unavailable (never {} or dark), and the very next read asks again and recovers", async () => {
  const s = spyStore({ fail: true });
  const down = await s.read();
  assert.deepEqual(down, { clock: C, households: null, house_of: null, unavailable: ACTIVITY_UNAVAILABLE });
  s.fail = false;
  const up = await s.read({ now: T0 + 1 });
  assert.equal(s.batches, 2, "no cached outage");
  assert.equal(up.households["hh:ash-house"], C);
});

test("A SHARED ANSWER IS NOT A SHARED OBJECT: mutating one caller's answer leaves the next caller's whole", async () => {
  const s = spyStore();
  const a = await s.read();
  a.households["hh:ash-house"] = -1; a.house_of.ash = "hh:elsewhere"; delete a.house_of["solo-sam"];
  const b = await s.read({ now: T0 + 1 });
  assert.equal(s.batches, 1);
  assert.equal(b.households["hh:ash-house"], C);
  assert.equal(b.house_of.ash, "hh:ash-house");
  assert.equal(b.house_of["solo-sam"], "solo:solo-sam", "the solo mapping stays (Wright 15:44:10.855Z)");
});

test("ONE STORE, ONE ANSWER — whoever asks: a fresh read closure per call (the store door's shape) still shares; a different store never does", async () => {
  const s = spyStore();
  await readHouseholdActivity({ read: (fn) => fn(s.q), backend: s, now: T0 });
  await readHouseholdActivity({ read: (fn) => fn(s.q), backend: s, now: T0 + 1 });   // another closure, same store
  assert.equal(s.batches, 1, "keyed by the store, not by the caller's closure");
  const other = spyStore();
  await other.read();
  assert.equal(other.batches, 1, "another store reads its own");
  // and the default key is the office's own store, by its URL: two calls with no
  // backend and no injected read share it (the compatibility path's shape)
  resetActivityCache();
  const env = { WORLD2_PG_URL: "postgres://cache-test/none" };
  let n = 0;
  const read = (fn) => { n += 1; return fn(s.q); };
  await readHouseholdActivity({ read, env, now: T0 });
  await readHouseholdActivity({ read: (fn) => { n += 1; return fn(s.q); }, env, now: T0 + 5 });
  assert.equal(n, 1, "two callers of the office's own store, one batch");
});

test("THE STALENESS BOUND is said where a reader reads it", () => {
  assert.equal(ACTIVITY_TTL_MS, 60_000);
  assert.match(ACTIVITY_MEANS, /at most once per 60 s/);
  assert.match(ACTIVITY_MEANS, /up to about 60 s \(plus that read's own duration\)/);
  assert.match(ACTIVITY_MEANS, /a new crossing reads afresh, and a failed read is not kept/);
});
