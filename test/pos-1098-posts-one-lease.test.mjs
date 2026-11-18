// pos-1098-posts-one-lease.test.mjs — POS-1098: a doorstep asks the pen for one connection at a time for its posts, not one per post class at once.
//
//   node --import ./test/helpers/sparse-guard.mjs --test test/pos-1098-posts-one-lease.test.mjs
//
// WHAT WAS FOUND (office release/2026-w47.7 @ 7c62bf2b1; the PR body has the evidence labels). `householdPosts` (household-posts.mjs) read each post class with
// `Promise.all`, and every class read is its own pen transaction (`tableRows` → `officeRead`). POST_CLASSES holds four classes, so ONE doorstep asked a pool of THREE
// connections for four at once, and the site refresh's bulk read runs six doorsteps at a time: the extra asks wait in the pool's line for connections that other
// doorsteps' reads hold (and a worker whose loop is busy hands them back late). On the box the doorstep singles of 03:32-03:35Z each took 18-23 leases, waited 11-36 s
// to acquire them and failed 1-5 acquisitions at the 10 s bound; that is the `StoreAcquireTimeout` behind the 503s.
//
// THE CHANGE kept every class its own short READ ONLY transaction (a class that cannot be read is still said alone) and read them one after another.
// Since POS-1129 the classes share ONE transaction, each under its own savepoint (still said alone): one ask, so the peak is one by construction.
// Until 2026-11-18 the first test asserted one ask per class (four).
//
// THE MEASUREMENT: the pen's pool is a stand-in whose `connect()` records how many connections are asked for and not yet handed back (`asking`). The first test's
// peak is that number for one `householdPosts` call. A control (the second test) reads the same classes the old way, with `Promise.all` over the same `tableRows`
// path, through the same pool, and sees the peak at the class count: it shows the instrument can see a fan-out.

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { installActsPen, uninstallActsPen, RECORD_ON } from "./acts-pen-stub.mjs";

const NOW = Date.parse("2026-11-17T03:35:00Z");
const REGISTRY = { registry: { registry: { households: { starforge: { residents: ["wright", "rei"] } } }, pins: {} } };

// the posts table is empty here: each class read is the one SELECT, then done
const EMPTY = (q) => /FROM posts WHERE class = \$1/i.test(q);
const asking = { open: 0, peak: 0, asks: 0 };
let pen, restore;

before(async () => {
  // the modules are loaded BEFORE the record env is set: the world graph's import-time load dials the record when the env says there is one, and waits its bound out
  await import("../src/household-posts.mjs"); await import("../src/town-posts.mjs"); await import("../src/world2-pen.mjs");
  Object.assign(process.env, RECORD_ON);
  pen = installActsPen({ also: [[EMPTY, () => ({ rows: [], rowCount: 0 })]] });
  const connect = pen.connect;
  // the pool the pen's `officeRead` reaches (world2-pen.mjs § state.pool): a connection is ASKED FOR when connect() is called and handed back at release()
  pen.connect = async (...a) => {
    asking.open += 1; asking.asks += 1; asking.peak = Math.max(asking.peak, asking.open);
    const c = await connect(...a);
    await new Promise((r) => setImmediate(r));          // a real pool answers on a later turn: the other classes' asks arrive before this one is released
    return { query: c.query, on() {}, removeListener() {}, release: (...r) => { asking.open -= 1; return c.release(...r); } };
  };
  restore = () => { pen.connect = connect; };
});
after(() => { restore?.(); uninstallActsPen(); delete process.env.WORLD2_PG; delete process.env.WORLD2_PG_URL; });

const reset = () => { asking.open = 0; asking.peak = 0; asking.asks = 0; };

test("a doorstep's posts ask the pen for ONE connection at a time (a pool of three, four post classes)", async () => {
  const { householdPosts } = await import("../src/household-posts.mjs");
  const { POST_CLASSES } = await import("../src/town-posts.mjs");
  reset();
  const a = await householdPosts("wright", { now: NOW, townClone: "G:/no-such-town-clone", readers: REGISTRY });
  assert.ok(a && a.put_up && a.taking_part, `the posts did not compose: ${JSON.stringify(a)?.slice(0, 200)}`);
  const classes = Object.keys(POST_CLASSES).length;
  assert.ok(classes > 1, `POST_CLASSES holds ${classes} class(es): one lease for several classes is not being tested`);
  assert.equal(asking.asks, 1, `the read took ${asking.asks} pen connections for ${classes} classes; POS-1129 reads every class in one lease`);
  assert.equal(asking.open, 0, "a pen connection was still out when the read ended");
  assert.equal(asking.peak, 1, `one householdPosts call asked the pen for ${asking.peak} connections at once (the pool is three; every doorstep in flight on the thread does the same)`);
});

test("CONTROL: the same class reads through Promise.all ask for every class at once (the instrument sees a fan-out)", async () => {
  const { POST_CLASSES } = await import("../src/town-posts.mjs");
  const { officeRead } = await import("../src/world2-pen.mjs");
  reset();
  await Promise.all(Object.keys(POST_CLASSES).map((cls) => officeRead(async (c) => (await c.query("SELECT id, class, title, author, household, starts, ends, fields, state, last_act FROM posts WHERE class = $1 ORDER BY id", [cls])).rows)));
  assert.equal(asking.peak, Object.keys(POST_CLASSES).length, "the control's fan-out was not seen: the instrument cannot tell one ask from four");
});

// LAST in the file: it puts in a pen of its own (one that fails one class), which the tests above, on the counting pen, must not see.
test("POS-1129: a class that cannot be read inside the one lease is said ALONE, and every class after it is still read", async () => {
  const { householdPosts } = await import("../src/household-posts.mjs");
  const { POST_CLASSES } = await import("../src/town-posts.mjs");
  const classes = Object.keys(POST_CLASSES);
  const broken = classes[0];   // the first class read: a failure that poisoned the transaction would take every class after it
  uninstallActsPen();
  const failing = installActsPen({ also: [[EMPTY, () => ({ rows: [], rowCount: 0 })]],
    failOn: (q, p) => /FROM posts WHERE class = \$1/i.test(q) && p?.[0] === broken });
  const a = await householdPosts("wright", { now: NOW, townClone: "G:/no-such-town-clone", readers: REGISTRY });
  const gaps = (a.unavailable ?? []).filter((u) => /could not be read from the office's record/.test(u));
  assert.equal(gaps.length, 1, `one class failed and ${gaps.length} were said unreadable: ${JSON.stringify(a.unavailable)}`);
  const asked = failing.state.asked.filter((q) => /FROM posts WHERE class = \$1/i.test(q)).length;
  assert.equal(asked, classes.length, `${asked} of ${classes.length} classes were asked: the classes after the failed one were not read`);
  assert.ok(failing.state.asked.some((q) => /^ROLLBACK TO SAVEPOINT/i.test(q)), "the failed class was not rolled back to its savepoint");
});
