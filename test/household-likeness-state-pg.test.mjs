// household-likeness-state-pg.test.mjs — slice B's one statement, on a REAL Postgres (POS-726).
//
// The stub answers the writer by its own rules; only a real store holds the statement's own words: the slug AND the bound account AND the
// state it was computed from (compare-and-swap) AND a yes in the row AND the roster AND a pointer/history that equals the row's own.
// The fixture pointer is planted by the owner role, because nothing the office runs can write one. Every house, id and proof is invented.
//
//   node --test test/household-likeness-state-pg.test.mjs

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { requestLikenessState, officialLikenessFor } from "../src/likeness.mjs";
import { setLikenessRequest } from "../src/registry-store.mjs";
import { startStore } from "./helpers/embedded-store.mjs";
import { seedRegistry, recordInProcess } from "./helpers/office-under-test.mjs";

const store = await startStore({ db: "likeness_state_pg_test" });
after(() => store.stop());
const skip = store.skip ?? false;
const restore = await recordInProcess(store);
after(restore);

const KEEPER = { login: "pg-keeper", id: 7780001 };
const OTHER = { login: "pg-other", id: 7780002 };
const REGISTRY = () => ({ schema_version: 1, households: {
  "pg-lane": { name: "Pg Lane", since: "2026-08-01", declared_by: "ash", accounts: [KEEPER], residents: ["ash", "birch"],
    likeness: { answer: "yes", at: "2026-11-09T11:00:00.000Z", by: "pg-keeper", gh_id: KEEPER.id, words: "1" } },
  "pg-hall": { name: "Pg Hall", since: "2026-08-02", declared_by: "fern", accounts: [OTHER], residents: ["fern"],
    likeness: { answer: "yes", at: "2026-11-09T11:00:00.000Z", by: "pg-other", gh_id: OTHER.id, words: "1" } },
} });
const PINS = () => ({ ash: { login: KEEPER.login, id: KEEPER.id }, birch: { login: KEEPER.login, id: KEEPER.id }, fern: { login: OTHER.login, id: OTHER.id } });
const POINTER = { version: 2, proof: "https://media.postmark.town/proofs/pg-one.png", since: "2026-11-01T10:00:00.000Z", depicts: ["ash"] };
const HISTORY = [{ version: 1, proof: "https://media.postmark.town/proofs/pg-old.png", since: "2026-10-01T10:00:00.000Z", until: "2026-11-01T10:00:00.000Z", ended: "replaced" }];
const owner = async (fn) => { const c = await store.connect("world2_owner"); try { return await fn(c); } finally { await c.end(); } };
const stateOfRow = (slug) => owner(async (c) => (await c.query("SELECT likeness_state AS s FROM households WHERE slug = $1", [slug])).rows[0].s);
const exec = (sql, args = []) => owner((c) => c.query(sql, args));
const fresh = () => seedRegistry(store, REGISTRY(), PINS());
const plant = () => exec("UPDATE households SET likeness_state = $1::jsonb WHERE slug = 'pg-lane'", [JSON.stringify({ official: POINTER, history: HISTORY })]);
const REQ = { request: { at: "2026-11-09T12:00:00.000Z", by: "pg-keeper", gh_id: KEEPER.id, depicts: ["ash"] } };
const w = (o) => setLikenessRequest({ slug: "pg-lane", from: null, to: REQ, ghId: KEEPER.id, depicts: ["ash"], ...o });

test("pg: the writer road as the office's own role (the grants hold): a request is kept, the pointer planted by the owner is untouched and read for its resident only", { skip }, async () => {
  await fresh(); await plant();
  const done = await requestLikenessState({ slug: "pg-lane", depicts: ["birch"], ghId: KEEPER.id, ghLogin: KEEPER.login }, { now: () => new Date("2026-11-09T12:00:00.000Z") });
  assert.deepEqual(done.likeness.request.depicts, ["birch"]);
  const row = await stateOfRow("pg-lane");
  assert.deepEqual(row.official, POINTER); assert.deepEqual(row.history, HISTORY);
  assert.deepEqual(row.request.depicts, ["birch"]);
  assert.equal((await officialLikenessFor("ash")).proof, POINTER.proof);
  assert.equal(await officialLikenessFor("birch"), null, "the request for birch gave birch nothing");
  assert.equal(await stateOfRow("pg-hall"), null, "the other house was not touched");
});

test("pg: the statement names the slug and a binding account", { skip }, async () => {
  await fresh();
  assert.deepEqual(await w({ ghId: OTHER.id }), { slug: null }, "another house's account");
  assert.deepEqual(await setLikenessRequest({ slug: "pg-hall", from: null, to: REQ, ghId: KEEPER.id, depicts: ["ash"] }), { slug: null }, "another house's slug");
  assert.equal(await stateOfRow("pg-lane"), null); assert.equal(await stateOfRow("pg-hall"), null);
  assert.deepEqual(await w({}), { slug: "pg-lane" });
});

test("pg: compare-and-swap: the second of two writers from the same state is refused, and key order does not matter", { skip }, async () => {
  await fresh();
  const other = { request: { ...REQ.request, by: "someone" } };
  assert.deepEqual(await w({}), { slug: "pg-lane" });
  assert.deepEqual(await w({ to: other }), { slug: null }, "stale from (null) loses");
  const reordered = { request: { depicts: ["ash"], gh_id: KEEPER.id, by: "pg-keeper", at: REQ.request.at } };
  assert.deepEqual(await w({ from: reordered, to: other }), { slug: "pg-lane" }, "jsonb equality, not text");
});

test("pg: a yes and the roster are checked in the row at the write", { skip }, async () => {
  await fresh();
  assert.deepEqual(await w({ depicts: ["ash", "fern"] }), { slug: null }, "an off-roster handle");
  await exec("UPDATE households SET likeness = jsonb_set(likeness, '{answer}', '\"no\"') WHERE slug = 'pg-lane'");
  assert.deepEqual(await w({}), { slug: null }, "a no blocks the write");
});

test("pg: the statement cannot write a pointer or history: any state that differs from the row's own matches nothing", { skip }, async () => {
  await fresh(); await plant();
  const stored = await stateOfRow("pg-lane");
  const attempts = {
    "a new pointer": { ...stored, ...REQ, official: { ...POINTER, version: 3, proof: "https://media.postmark.town/proofs/other.png" } },
    "a retargeted pointer": { ...stored, ...REQ, official: { ...POINTER, depicts: ["ash", "birch"] } },
    "a removed pointer": { ...REQ, history: HISTORY },
    "a removed history": { ...stored, ...REQ, history: undefined },
    "a planted pointer on a house with none": null,
  };
  for (const [what, to] of Object.entries(attempts)) {
    if (to === null) continue;
    assert.deepEqual(await w({ from: stored, to }), { slug: null }, `${what} writes nothing`);
  }
  assert.deepEqual(await stateOfRow("pg-lane"), stored);
  await fresh();
  assert.deepEqual(await w({ to: { ...REQ, official: POINTER } }), { slug: null }, "a pointer where the row has none");
  assert.equal(await stateOfRow("pg-lane"), null);
  await plant();
  assert.deepEqual(await w({ from: await stateOfRow("pg-lane"), to: { ...await stateOfRow("pg-lane"), ...REQ } }), { slug: "pg-lane" }, "the request alone, pointer and history carried as they are");
});
