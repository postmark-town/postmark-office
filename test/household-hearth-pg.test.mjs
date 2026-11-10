// household-hearth-pg.test.mjs — the Hearth setting's statement and migration on a REAL Postgres (POS-962).
//
//   node --test test/household-hearth-pg.test.mjs

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { setHouseholdHearth } from "../src/registry-store.mjs";
import { startStore } from "./helpers/embedded-store.mjs";
import { seedRegistry, recordInProcess } from "./helpers/office-under-test.mjs";

const store = await startStore({ db: "hearth_pg_test" });
after(() => store.stop());
const skip = store.skip ?? false;
const restore = await recordInProcess(store);
after(restore);

const A = { login: "pg-a", id: 8201 }, B = { login: "pg-b", id: 8202 };
const REGISTRY = () => ({ schema_version: 1, households: {
  "pg-a-house": { name: "A", since: "2026-08-01", declared_by: "ash", accounts: [A], residents: ["ash"] },
  "pg-b-house": { name: "B", since: "2026-08-02", declared_by: "fern", accounts: [B], residents: ["fern"] },
} });
const PINS = () => ({ ash: { login: A.login, id: A.id }, fern: { login: B.login, id: B.id } });
const owner = async (fn) => { const c = await store.connect("world2_owner"); try { return await fn(c); } finally { await c.end(); } };
const hearthOf = (slug) => owner(async (c) => (await c.query("SELECT hearth FROM households WHERE slug = $1", [slug])).rows[0].hearth);

test("pg: the statement names the slug AND a binding account; unset clears; the office's own role holds the grant", { skip }, async () => {
  await seedRegistry(store, REGISTRY(), PINS());
  assert.equal(await hearthOf("pg-a-house"), null, "unset");
  assert.deepEqual(await setHouseholdHearth({ slug: "pg-a-house", hearth: "ledger", ghId: B.id }), { slug: null }, "B's account cannot write A's row");
  assert.deepEqual(await setHouseholdHearth({ slug: "pg-b-house", hearth: "ledger", ghId: A.id }), { slug: null }, "nor A's write B's");
  assert.equal(await hearthOf("pg-a-house"), null);
  assert.deepEqual(await setHouseholdHearth({ slug: "pg-a-house", hearth: "ledger", ghId: A.id }), { slug: "pg-a-house" });
  assert.equal(await hearthOf("pg-a-house"), "ledger"); assert.equal(await hearthOf("pg-b-house"), null);
  assert.deepEqual(await setHouseholdHearth({ slug: "pg-a-house", hearth: null, ghId: A.id }), { slug: "pg-a-house" });
  assert.equal(await hearthOf("pg-a-house"), null, "unset again");
});

test("pg: the column holds only an id's own spelling (the CHECK), and the registry read answers the saved id", { skip }, async () => {
  await seedRegistry(store, REGISTRY(), PINS());
  await assert.rejects(setHouseholdHearth({ slug: "pg-a-house", hearth: "Not An Id", ghId: A.id }), (e) => e.code === "23514");
  await setHouseholdHearth({ slug: "pg-a-house", hearth: "orchard", ghId: A.id });
  const { loadRegistryRows } = await import("../src/registry-store.mjs");
  const rows = await loadRegistryRows(process.env);
  assert.equal(rows.households.find((r) => r.slug === "pg-a-house").hearth, "orchard");
  assert.equal(rows.households.find((r) => r.slug === "pg-b-house").hearth, null);
});
