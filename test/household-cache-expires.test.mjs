// household-cache-expires.test.mjs — THE HOUSEHOLD CACHE EXPIRES, AND THE CEREMONY CLEARS IT (POS-860).
//
//   node --import ./test/helpers/sparse-guard.mjs --test --test-concurrency=1 test/household-cache-expires.test.mjs
//
// THE INSTANCE. `household-deriver.mjs` read the registry once per thread and
// kept it for the life of the database pool, misses included, and nothing in
// `src/` ever dropped it (only test files called `__clearHouseCache`). So a
// house founded after a thread's copy was taken read as `solo:<handle>` on
// leave-mark, amend, withdraw, drafts, staking and my-marks until the office
// restarted. Measured on the box, read-only, 2026-11-02: 9 office restarts in 7
// days, finished lifetimes 0.7 h to 66.5 h (median 11.3 h); the 22 houses
// founded this week that have since seen a restart waited a median 7.8 h for it.
//
// LAW (POS-860, the shape Rivet chose, 2026-11-02): "A thread re-reads the
// registry when its cached copy is older than a short time-to-live (about 60 s;
// one named constant), and drops its cached answers, misses included, with it."
// "ceremony.mjs calls __clearHouseCache() after it writes the registry, so the
// founding thread sees the house at once." "The answer cache at
// world2-claims.mjs resets at the same moment the registry copy does."
//
// THE RIG. Every case drives the REAL resolver (`houseOfVia`, `houseRows`,
// `householdKeyFor`) and, for the ceremony, the REAL `mintHousehold` and
// `joinHousehold`, over an in-memory store that answers the registry's own
// SELECTs and APPLIES the ceremony's writes (`registry-pool-stub.mjs`). A house
// "founded elsewhere" is written straight into that store, the way the
// backfill tool, the rekey tool or another process writes it: this thread is
// not told. THE CLOCK IS PINNED (`Date.now`), never slept on: every instant
// below is `T0` plus a multiple of the time-to-live, so no case has a
// wall-clock margin.
//
// THE CONTROLS. Each "it resolves now" assertion is preceded by the same
// question one tick earlier, answered the old way ("still unknown inside the
// time-to-live"). That is what keeps a green from being vacuous: it proves the
// copy being healed really was cached.

import { test } from "node:test";
import assert from "node:assert/strict";

import * as deriver from "../src/household-deriver.mjs";
import { houseOfVia, houseRows, houseRowsVia, resolveHouse, VIA, __clearHouseCache } from "../src/household-deriver.mjs";
import { householdKeyFor } from "../src/world2-claims.mjs";
import { mintHousehold, joinHousehold, NO_DRAIN, NO_ADOPT } from "../src/ceremony.mjs";
import { __setPoolForTest } from "../src/world2-acts.mjs";
import { rowsFromRegistry } from "../src/registry-rows.mjs";
import { makePool, RECORD_ON } from "./registry-pool-stub.mjs";

// The time-to-live under test, read from the module so a retune moves every
// case with it. The fallback only lets this file load and measure against a tree
// that does not name the constant yet; the first test fails there.
const TTL = deriver.HOUSE_CACHE_TTL_MS ?? 60_000;

const T0 = Date.UTC(2026, 10, 2, 12, 0, 0);
const ROOKERY_ID = 265401358;

const HOUSES = {
  "the-rookery": {
    name: "The Rookery",
    accounts: [{ login: "CrowAndClock", id: ROOKERY_ID }],
    residents: ["darko", "rei", "mover"],
  },
  "the-lantern-house": {
    name: "The Lantern House",
    accounts: [{ login: "lantern-keeper", id: 777001 }],
    residents: ["wick"],
  },
};
const PINS = {
  darko: { login: "CrowAndClock", id: ROOKERY_ID, pinned: "2026-07-01" },
  rei: { login: "CrowAndClock", id: ROOKERY_ID, pinned: "2026-07-01" },
  wick: { login: "lantern-keeper", id: 777001, pinned: "2026-07-01" },
  // pinned, and in no house: a join that finds the pin already there writes no pin
  drifter: { login: "drifter-login", id: 990001, pinned: "2026-07-01" },
};

// ── the rig ─────────────────────────────────────────────────────────────────

/** `Date.now` pinned for the length of one test. `advance` moves it; nothing else does. */
function pinClock(t) {
  let now = T0;
  t.mock.method(Date, "now", () => now);
  return { advance: (ms) => { now += ms; }, set: (ms) => { now = ms; } };
}

/** A fresh in-memory registry store, with this thread's copy dropped, and a count of the registry reads it answers. */
function store({ houses = HOUSES, pins = PINS } = {}) {
  __clearHouseCache();
  const pool = makePool(rowsFromRegistry({ schema_version: 1, households: structuredClone(houses) }, structuredClone(pins)));
  let registryReads = 0;
  const query = pool.query.bind(pool);
  pool.query = (text, params) => {
    if (/^\s*SELECT slug, ord/.test(text)) registryReads++;
    return query(text, params);
  };
  Object.defineProperty(pool, "registryReads", { get: () => registryReads });
  return pool;
}

/** Point the office's own module pool (what `houseRows` and the ceremony's writers reach) at this store. */
function officeUses(t, pool) {
  __setPoolForTest(pool);
  t.after(() => { __setPoolForTest(null); __clearHouseCache(); });
}

/** A house founded by a writer this thread is not told about. */
function foundedElsewhere(pool, slug, rec) {
  const [row] = rowsFromRegistry({ schema_version: 1, households: { [slug]: rec } }, {}).households;
  pool.state.households.push({ ...row, ord: Math.max(-1, ...pool.state.households.map((r) => r.ord)) + 1 });
}

/** An identity added elsewhere: the handle joins an existing house and gets its pin. */
function identityAddedElsewhere(pool, slug, handle, pin) {
  const house = pool.state.households.find((r) => r.slug === slug);
  house.residents = [...house.residents, handle];
  pool.state.pins.push({ handle, login: pin.login, gh_id: pin.id, pinned: "2026-11-02", renamed: null, note: null, retired: null, renamed_to: null });
}

/** A resident who moves house, written elsewhere. */
function movedElsewhere(pool, handle, from, to) {
  const out = pool.state.households.find((r) => r.slug === from);
  const into = pool.state.households.find((r) => r.slug === to);
  out.residents = out.residents.filter((h) => h !== handle);
  into.residents = [...into.residents, handle];
}

const MINT = (over = {}) => ({
  slug: "founders-nest", name: "Founders Nest", coSign: { ghId: 880001, ghLogin: "founder-login" },
  residents: ["founder"], since: "2026-11-02", declaredBy: "founder",
  drain: NO_DRAIN, adopt: NO_ADOPT, env: RECORD_ON, ...over,
});

/** The two doors that store a copy: the queryable's copy (`houseOfVia`) and the module pool's fold (`houseRows`). */
const DOORS = [
  { name: "the queryable's copy", ask: async (pool) => (await houseOfVia(pool, "founder")).slug },
  { name: "the module pool's fold", ask: async () => { const rows = await houseRows(RECORD_ON); return resolveHouse("founder", rows.registry, rows.pins).slug; } },
];

/** Hold the next registry read at the store's door: it takes its rows now and hands them over when `release()` is called. */
function holdTheNextRegistryRead(pool) {
  const query = pool.query;
  let release; const mayLeave = new Promise((resolve) => { release = resolve; });
  const gate = { held: false, release: () => release() };
  pool.query = async (text, params) => {
    const out = await query(text, params);
    if (!gate.held && /^\s*SELECT slug, ord/.test(text)) { gate.held = true; await mayLeave; }
    return out;
  };
  return gate;
}

/**
 * The store is in memory, so by the next macrotask every step a read needs has
 * run: the read is held at the store's door, or no read was needed and none will
 * be. Nothing here waits on a clock.
 */
const settle = () => new Promise((resolve) => setImmediate(resolve));

// ── the named constant ──────────────────────────────────────────────────────

test("THE TIME-TO-LIVE IS ONE NAMED CONSTANT, a short number of milliseconds", () => {
  assert.equal(typeof deriver.HOUSE_CACHE_TTL_MS, "number",
    "household-deriver.mjs names its time-to-live as HOUSE_CACHE_TTL_MS");
  assert.ok(TTL >= 10_000 && TTL <= 300_000, `Rivet: "about 60 s"; got ${TTL} ms, which is not a short wait for a house to be seen`);
});

// ── 1. WARM CACHE, NEW HOUSE ────────────────────────────────────────────────

test("WARM CACHE, NEW HOUSE: a house founded after the copy was taken is resolved once the copy is older than the time-to-live (the queryable's door)", async (t) => {
  const clock = pinClock(t);
  const pool = store();
  assert.equal((await houseOfVia(pool, "darko")).slug, "the-rookery", "the cache is filled");
  assert.equal((await houseOfVia(pool, "newcomer")).slug, null, "and it holds a miss for the handle that is about to be housed");

  foundedElsewhere(pool, "the-newcomers", { name: "The Newcomers", accounts: [{ login: "newcomer-login", id: 880002 }], residents: ["newcomer"] });

  clock.advance(TTL - 1);
  assert.equal((await houseOfVia(pool, "newcomer")).slug, null,
    "control: one tick inside the time-to-live the copy is reused, so the new house is not seen yet");
  clock.advance(2);
  assert.deepEqual(await houseOfVia(pool, "newcomer"), { slug: "the-newcomers", via: "resident" },
    "POS-860: \"a house founded after a thread's cache filled reads as solo:<handle> ... until the office restarts\" (today: unknown, for the life of the pool)");
});

test("WARM CACHE, NEW IDENTITY: a handle added to a house after the copy was taken is resolved once the copy is older than the time-to-live", async (t) => {
  const clock = pinClock(t);
  const pool = store();
  assert.equal((await houseOfVia(pool, "joiner")).slug, null, "the cache is filled with a miss for the handle that is about to join");

  identityAddedElsewhere(pool, "the-rookery", "joiner", { login: "CrowAndClock", id: ROOKERY_ID });

  clock.advance(TTL - 1);
  assert.equal((await houseOfVia(pool, "joiner")).slug, null, "control: inside the time-to-live the copy is reused");
  clock.advance(2);
  assert.equal((await houseOfVia(pool, "joiner")).slug, "the-rookery", "the joiner stands in the house once the copy is re-read");
  assert.equal((await houseOfVia(pool, "joiner", { via: [VIA.PIN] })).slug, "the-rookery", "and so does their pin, by its id");
});

test("WARM CACHE, NEW HOUSE (the module pool's fold, which the admin check reads): resolved once the fold is older than the time-to-live", async (t) => {
  const clock = pinClock(t);
  const pool = store();
  officeUses(t, pool);
  const was = await houseRows(RECORD_ON);
  assert.equal(resolveHouse("newcomer", was.registry, was.pins).slug, null, "the fold is taken without the newcomer");

  foundedElsewhere(pool, "the-newcomers", { name: "The Newcomers", accounts: [{ login: "newcomer-login", id: 880002 }], residents: ["newcomer"] });

  clock.advance(TTL - 1);
  const inside = await houseRows(RECORD_ON);
  assert.equal(resolveHouse("newcomer", inside.registry, inside.pins).slug, null, "control: inside the time-to-live the fold is reused");
  clock.advance(2);
  const after = await houseRows(RECORD_ON);
  assert.equal(resolveHouse("newcomer", after.registry, after.pins).slug, "the-newcomers",
    "the admin check's registry (admin-role.mjs § householdIsAdmin) sees a new house without a restart");
});

// ── 2. EXPIRY ───────────────────────────────────────────────────────────────

test("EXPIRY: a copy younger than the time-to-live is reused with no re-read; an older one re-reads", async (t) => {
  const clock = pinClock(t);
  const pool = store();
  await houseOfVia(pool, "darko");
  assert.equal(pool.registryReads, 1, "the first ask reads the registry once");

  clock.advance(TTL - 1);
  await houseOfVia(pool, "rei");
  await houseOfVia(pool, "wick");
  await houseOfVia(pool, "stranger");
  assert.equal(pool.registryReads, 1, "inside the time-to-live, other askers share the one copy: no re-read");

  clock.advance(2);
  await houseOfVia(pool, "darko");
  assert.equal(pool.registryReads, 2, "once the copy is older than the time-to-live the next ask re-reads it");
});

test("EXPIRY COUNTS FROM THE READ, not from the last use: a thread that is asked all the time still re-reads", async (t) => {
  const clock = pinClock(t);
  const pool = store();
  await houseOfVia(pool, "darko");
  for (let i = 0; i < 3; i++) { clock.advance(Math.floor(TTL / 4)); await houseOfVia(pool, "darko"); }
  assert.equal(pool.registryReads, 1, "control: asked every quarter of the time-to-live, the young copy is reused each time");
  clock.advance(Math.floor(TTL / 4) + 2);
  await houseOfVia(pool, "darko");
  assert.equal(pool.registryReads, 2, "the copy was read a full time-to-live ago, however recently it was used: a busy thread must not hold it forever");
});

test("EXPIRY DROPS THE ANSWERS DRAWN FROM THE OLD COPY, a cached miss included and a cached yes too", async (t) => {
  const clock = pinClock(t);
  const pool = store();
  assert.equal((await houseOfVia(pool, "ghost")).slug, null, "a miss is cached");
  assert.equal((await houseOfVia(pool, "mover")).slug, "the-rookery", "and so is a yes");

  identityAddedElsewhere(pool, "the-lantern-house", "ghost", { login: "lantern-keeper", id: 777001 });
  movedElsewhere(pool, "mover", "the-rookery", "the-lantern-house");

  clock.advance(TTL - 1);
  assert.equal((await houseOfVia(pool, "ghost")).slug, null, "control: inside the time-to-live the cached miss stands");
  assert.equal((await houseOfVia(pool, "mover")).slug, "the-rookery", "control: and the cached yes stands");
  clock.advance(2);
  assert.equal((await houseOfVia(pool, "ghost")).slug, "the-lantern-house", "the old copy's miss went with the old copy");
  assert.equal((await houseOfVia(pool, "mover")).slug, "the-lantern-house", "and a resident who moved reads at the new house, not the old one");
});

test("THE PEN'S ANSWER MEMO (world2-claims § householdKeyFor) goes with the registry copy: after the time-to-live, and at once after a clear", async (t) => {
  const clock = pinClock(t);
  const pool = store();
  assert.equal(await householdKeyFor(pool, "mover"), "hh:the-rookery", "a yes is remembered");

  movedElsewhere(pool, "mover", "the-rookery", "the-lantern-house");
  clock.advance(TTL - 1);
  assert.equal(await householdKeyFor(pool, "mover"), "hh:the-rookery", "control: inside the time-to-live the remembered yes stands");
  clock.advance(2);
  assert.equal(await householdKeyFor(pool, "mover"), "hh:the-lantern-house",
    "\"The answer cache ... resets at the same moment the registry copy does\" (it was a module-level Map that nothing ever emptied)");

  movedElsewhere(pool, "mover", "the-lantern-house", "the-rookery");
  __clearHouseCache();
  assert.equal(await householdKeyFor(pool, "mover"), "hh:the-rookery", "and a clear empties it with the copy, with no wait");
});

test("A COPY STAMPED IN THE FUTURE IS NOT TRUSTED: when the clock steps back, the thread re-reads", async (t) => {
  const clock = pinClock(t);
  const pool = store();
  clock.advance(60 * TTL);
  assert.equal((await houseOfVia(pool, "newcomer")).slug, null, "a copy is taken late, with a miss in it");
  foundedElsewhere(pool, "the-newcomers", { name: "The Newcomers", accounts: [{ login: "newcomer-login", id: 880002 }], residents: ["newcomer"] });
  clock.set(T0);
  assert.equal((await houseOfVia(pool, "newcomer")).slug, "the-newcomers",
    "an age below zero is not \"young\": it would hold the copy until the clock caught up with it");
});

test("A RE-READ THAT FAILS THROWS like a first read does, serves nothing stale in its place, and poisons nothing", async (t) => {
  const clock = pinClock(t);
  const pool = store();
  await houseOfVia(pool, "darko");
  clock.advance(TTL + 1);

  const query = pool.query;
  pool.query = async (text, params) => {
    if (/^\s*SELECT slug, ord/.test(text)) throw new Error("the store went away");
    return query(text, params);
  };
  await assert.rejects(() => houseOfVia(pool, "darko"), /the store went away/,
    "the copy is older than the time-to-live, so it is not served; the failure reaches the caller as a first read's would");

  pool.query = query;
  assert.equal((await houseOfVia(pool, "darko")).slug, "the-rookery", "the store is back and the next ask reads again: the failure was not cached");
});

// ── 3. CEREMONY INVALIDATION ────────────────────────────────────────────────
//
// The clock is pinned and NEVER ADVANCED in these cases, so the time-to-live
// cannot explain what they see: only the ceremony's own clear can.

test("CEREMONY: a house founded here is seen by this thread at once, with no wait (mintHousehold)", async (t) => {
  pinClock(t);
  const pool = store();
  officeUses(t, pool);
  assert.equal((await houseOfVia(pool, "founder")).slug, null, "the queryable's copy holds a miss for the founder");
  assert.equal(await householdKeyFor(pool, "founder"), "solo:founder", "the pen files them under solo: (a miss is not remembered)");
  const fold = await houseRows(RECORD_ON);
  assert.equal(resolveHouse("founder", fold.registry, fold.pins).slug, null, "and the module pool's fold holds a miss too");

  await mintHousehold(MINT());

  assert.deepEqual(await houseOfVia(pool, "founder"), { slug: "founders-nest", via: "resident" },
    "\"ceremony.mjs calls __clearHouseCache() after it writes the registry, so the founding thread sees the house at once\"");
  assert.equal(await householdKeyFor(pool, "founder"), "hh:founders-nest", "the pen files their next act under the house");
  const after = await houseRows(RECORD_ON);
  assert.equal(resolveHouse("founder", after.registry, after.pins).slug, "founders-nest", "and the module pool's fold has it");
});

test("CEREMONY: a house choosing its key (the choose-once rename) is seen at once", async (t) => {
  pinClock(t);
  const pool = store({
    houses: { ...HOUSES, "chooser": { accounts: [{ login: "choosing-login", id: 555002 }], residents: ["chooser"], provisional: true } },
  });
  officeUses(t, pool);
  assert.equal((await houseOfVia(pool, "hh:the-chosen-key")).slug, null, "nobody holds the chosen key yet, and that is cached");

  await mintHousehold(MINT({ slug: "the-chosen-key", coSign: { ghId: 555002, ghLogin: "choosing-login" }, residents: [], declaredBy: "chooser" }));

  assert.deepEqual(await houseOfVia(pool, "hh:the-chosen-key"), { slug: "the-chosen-key", via: "slug" },
    "the renamed house answers to its chosen key at once");
  assert.deepEqual(await houseOfVia(pool, "hh:chooser"), { slug: "the-chosen-key", via: "formerly" },
    "and to the provisional key it wore, through the alias list");
});

test("CEREMONY: a resident joining a house is seen at once (joinHousehold's house row, for a handle whose pin is already on record)", async (t) => {
  pinClock(t);
  const pool = store();
  officeUses(t, pool);
  assert.equal((await houseOfVia(pool, "drifter")).slug, null, "the drifter is a cached miss: pinned, and in no house");

  await joinHousehold({
    slug: "the-rookery", handle: "drifter", coSign: { ghId: ROOKERY_ID, ghLogin: "CrowAndClock" },
    pinnedOn: "2026-11-02", drain: NO_DRAIN, adopt: NO_ADOPT, env: RECORD_ON,
  });
  assert.equal(pool.state.writes.pins, 0, "control: the pin was already on record, so the join wrote no pin and only its house write can have cleared the copy");

  assert.equal((await houseOfVia(pool, "drifter")).slug, "the-rookery", "the house lists the drifter and this thread sees it at once");
});

// ── 4. THE CLEAR COMES AFTER THE COMMIT ─────────────────────────────────────
//
// A clear that comes BEFORE its write is worth nothing. A request that lands
// between the clear and the commit reads the registry as it stood before the
// write and stores that, and nobody clears again, so the house stays unseen for
// a time-to-live: the very window the clear exists to close. So each case lands
// such a request while the ceremony's write is IN FLIGHT: the statement reaches
// the store, a request reads the registry through the deriver, and only then is
// the write applied. The clear after the commit drops what that request stored;
// a clear moved above the write, or none at all, leaves it, and the ceremony
// hands back a thread that still cannot see what it just wrote.
const WRITES = [
  {
    name: "the mint's new house",
    write: /^\s*INSERT INTO households \(ord,/,
    run: () => mintHousehold(MINT()),
    seen: async (pool) => (await houseOfVia(pool, "founder")).slug,
    want: "founders-nest",
  },
  {
    name: "the choose-once rename",
    store: { houses: { ...HOUSES, "chooser": { accounts: [{ login: "choosing-login", id: 555002 }], residents: ["chooser"], provisional: true } } },
    write: /^\s*UPDATE households\s+SET slug/,
    run: () => mintHousehold(MINT({ slug: "the-chosen-key", coSign: { ghId: 555002, ghLogin: "choosing-login" }, residents: [], declaredBy: "chooser" })),
    seen: async (pool) => (await houseOfVia(pool, "hh:the-chosen-key")).slug,
    want: "the-chosen-key",
  },
  {
    name: "the join's house row",
    write: /^\s*INSERT INTO households \(slug,/,
    run: () => joinHousehold({
      slug: "the-rookery", handle: "drifter", coSign: { ghId: ROOKERY_ID, ghLogin: "CrowAndClock" },
      pinnedOn: "2026-11-02", drain: NO_DRAIN, adopt: NO_ADOPT, env: RECORD_ON,
    }),
    // the drifter's pin is already on record, so this join writes no pin and its house row's clear stands alone
    control: (pool) => assert.equal(pool.state.writes.pins, 0, "control: the join wrote no pin, so no later clear can hide the house row's"),
    seen: async (pool) => (await houseOfVia(pool, "drifter")).slug,
    want: "the-rookery",
  },
  {
    name: "the join's pin",
    write: /^\s*INSERT INTO household_pins/,
    run: () => joinHousehold({
      slug: "the-rookery", handle: "joiner", coSign: { ghId: ROOKERY_ID, ghLogin: "CrowAndClock" },
      pinnedOn: "2026-11-02", drain: NO_DRAIN, adopt: NO_ADOPT, env: RECORD_ON,
    }),
    // a pin is read by its id, so ask the pin's road alone: the house row, written first, already lists the joiner
    seen: async (pool) => (await houseOfVia(pool, "joiner", { via: [VIA.PIN] })).slug,
    want: "the-rookery",
  },
];

for (const w of WRITES) {
  test(`THE CLEAR COMES AFTER THE COMMIT: ${w.name} is seen at once even by a request that read while the write was in flight`, async (t) => {
    pinClock(t);
    const pool = store(w.store);
    officeUses(t, pool);
    const query = pool.query;
    let landed = 0;
    pool.query = async (text, params) => {
      if (w.write.test(text)) { landed++; await houseRowsVia(pool); }   // the request lands; the write is applied after it
      return query(text, params);
    };

    await w.run();

    assert.equal(landed, 1, `control: a request read the registry while ${w.name} was in flight`);
    w.control?.(pool);
    assert.equal(await w.seen(pool), w.want,
      "ceremony.mjs calls __clearHouseCache() AFTER it writes the registry: a clear before the commit leaves the pre-write copy the request stored");
  });
}

// A read that began before a clear may have read the registry before the write
// the clear answers. It may hand what it read to its own caller; it must not
// store it, or the clear is undone and the house stays unseen for a
// time-to-live. One case per door that stores a copy.
for (const door of DOORS) {
  test(`A CLEAR IS NOT UNDONE BY A READ IN FLIGHT: ${door.name} is not refilled with what the read took before the write`, async (t) => {
    pinClock(t);
    const pool = store();
    officeUses(t, pool);
    const gate = holdTheNextRegistryRead(pool);   // the read takes its rows now and hands them over when released

    const inFlight = door.ask(pool);
    await settle();
    assert.ok(gate.held, "control: the read reached the store and is held at its door (a copy that answered it would leave no read in flight to test)");
    foundedElsewhere(pool, "founders-nest", { name: "Founders Nest", accounts: [{ login: "founder-login", id: 880001 }], residents: ["founder"] });
    __clearHouseCache();           // the ceremony's clear, landing while that read is still out
    gate.release();
    await inFlight;                // (its own answer is the pre-write one; the next ask is what matters)

    assert.equal(await door.ask(pool), "founders-nest",
      "an invalidation that a read in flight can undo is not one: the stale copy must not be stored after the clear");
  });
}

// ── 5. THE AGE COUNTS FROM WHEN THE READ BEGAN ──────────────────────────────
//
// A copy's age is stamped before its read goes to the store, not after, so a slow
// read does not lengthen its copy's life by its own duration: the data is as old
// as the moment the read took it. The clock is pinned and the read is HELD at the
// store while the pinned clock moves, so the two stamps differ by a known amount
// and the test waits on nothing. One pair of cases per door that stores a copy.
for (const door of DOORS) {
  test(`THE AGE COUNTS FROM WHEN THE READ BEGAN (${door.name}): a read that ends inside the time-to-live gives a copy that expires a time-to-live after the read BEGAN`, async (t) => {
    const clock = pinClock(t);
    const pool = store();
    officeUses(t, pool);
    const gate = holdTheNextRegistryRead(pool);

    const inFlight = door.ask(pool);                 // the read begins at T0 ...
    await settle();
    assert.ok(gate.held, "control: the read began and is held at the store");
    clock.advance(Math.floor(TTL / 2));              // ... and is slow: half a time-to-live passes inside it
    gate.release();
    await inFlight;                                  // it ends at T0 + TTL/2, and its copy is stored
    assert.equal(pool.registryReads, 1, "control: one read so far");

    clock.set(T0 + TTL - 1);
    await door.ask(pool);
    assert.equal(pool.registryReads, 1, "control: counted from when the read began, the copy is a tick short of a time-to-live old, so it is still young");
    clock.set(T0 + TTL + 1);
    await door.ask(pool);
    assert.equal(pool.registryReads, 2,
      "the copy is a time-to-live old a tick after the read BEGAN, though the read ENDED only half a time-to-live ago: stamping at the end would extend its life by the read's own duration");
  });

  test(`THE AGE COUNTS FROM WHEN THE READ BEGAN (${door.name}): a read that outlasts the time-to-live gives a copy that is already too old to reuse`, async (t) => {
    const clock = pinClock(t);
    const pool = store();
    officeUses(t, pool);
    const gate = holdTheNextRegistryRead(pool);

    const inFlight = door.ask(pool);                 // the read begins at T0 ...
    await settle();
    assert.ok(gate.held, "control: the read began and is held at the store");
    clock.advance(TTL + 5);                          // ... and its start and its end straddle the time-to-live boundary
    gate.release();
    await inFlight;
    assert.equal(pool.registryReads, 1, "control: one read so far");

    await door.ask(pool);                            // the same instant it ended
    assert.equal(pool.registryReads, 2,
      "what the read took is already older than the time-to-live when it arrives: the next ask reads again, it is not served a copy stamped at the end");
  });
}

test("THE OTHER THREADS hear no clear and heal by age alone (a read worker is a thread with its own copy of the module)", async (t) => {
  const clock = pinClock(t);
  const worker = await import(new URL("../src/household-deriver.mjs?thread=read-worker", import.meta.url).href);
  worker.__clearHouseCache();
  t.after(() => worker.__clearHouseCache());
  const pool = store();
  officeUses(t, pool);
  assert.equal((await houseOfVia(pool, "founder")).slug, null, "the main thread holds a miss");
  assert.equal((await worker.houseOfVia(pool, "founder")).slug, null, "and so does the worker");

  await mintHousehold(MINT());   // the founding runs inside the office, on the main thread

  assert.equal((await houseOfVia(pool, "founder")).slug, "founders-nest", "the founding thread: at once");
  assert.equal((await worker.houseOfVia(pool, "founder")).slug, null,
    "control: nothing tells the worker, and its copy is still young, so it has not heard");
  clock.advance(TTL + 1);
  assert.equal((await worker.houseOfVia(pool, "founder")).slug, "founders-nest",
    "the worker's own copy ages out and it reads the house with no message and no restart");
});
