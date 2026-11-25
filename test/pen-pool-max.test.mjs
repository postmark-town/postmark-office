// pen-pool-max.test.mjs — POS-1095: the office's pen pool holds six connections.
//
//   node --test test/pen-pool-max.test.mjs
//
// LAW (Darko, 2026-11-16 22:43 EST, POS-1095): "I'm pretty in favor of widening the pool to maybe like 6
// different database connection capacity". The pen was three: the 503s of 2026-11-17 were
// `StoreAcquireTimeout: the store's pen pool had no free connection ... (it holds 3)`.
//
// This drives the pen's real door (officeRead) with no pool injected, so it traverses pool() itself,
// the way store-pool-guard.test.mjs § POS-821 does: the real pg.Pool is wrapped only to read the
// options the pen builds it with, and every pool built is ended. The store is a closed port, so no pool
// here reaches a database, and the door's refusal (the store being unreachable) is not what is judged.
// The tests that build their own `max: 3` pen stand-ins do not read this line; this is the one that does.

import test from "node:test";
import assert from "node:assert/strict";

const PEN_MAX = 6;
const NO_STORE_ENV = { WORLD2_PG: "1", WORLD2_PG_URL: "postgres://u@127.0.0.1:1/d" };

test("the pen's real pool is built with max 6, under the pen's name", async () => {
  const { default: pg } = await import("pg");
  const pen = await import("../src/world2-pen.mjs");
  const Real = pg.Pool;
  const built = [];
  pg.Pool = class extends Real {
    constructor(o) { super(o); built.push({ options: o, pool: this }); }
  };
  pen.__setPoolForTest(null);
  try {
    const [r] = await Promise.allSettled([pen.officeRead(async (c) => c.query("SELECT 1"), { env: NO_STORE_ENV })]);
    assert.equal(r.status, "rejected", "the closed port refuses: the store is unreachable, which is not what is judged");
    assert.equal(built.length, 1, "the door built exactly one pool: the pen's");
    assert.match(built[0].options.application_name, /^postmark-office:pen:t\d+$/, "the pool built is the pen's");
    assert.equal(built[0].options.max, PEN_MAX, "the pen's pool holds six connections (POS-1095), not the three it held until then");
  } finally {
    pen.__setPoolForTest(null);
    pg.Pool = Real;
    await Promise.all(built.map((b) => b.pool.end().catch(() => {})));
  }
});
