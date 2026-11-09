// household-likeness-state-pg.test.mjs — slice B's one statement, on a REAL Postgres (POS-726).
//
// The stub answers the writer by its own rules; only a real store holds the statement's own words: the slug AND the bound account AND
// the state it was computed from (compare-and-swap) AND a yes in the row. Every house, id and proof here is invented.
//
//   node --test test/household-likeness-state-pg.test.mjs

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { rowsFromRegistry } from "../src/registry-rows.mjs";
import { changeLikenessState } from "../src/likeness.mjs";
import { setLikenessState } from "../src/registry-store.mjs";
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
  "pg-lane": { name: "Pg Lane", since: "2026-08-01", declared_by: "ash", accounts: [KEEPER], residents: ["ash"],
    likeness: { answer: "yes", at: "2026-11-09T11:00:00.000Z", by: "pg-keeper", gh_id: KEEPER.id, words: "1" } },
  "pg-hall": { name: "Pg Hall", since: "2026-08-02", declared_by: "fern", accounts: [OTHER], residents: ["fern"],
    likeness: { answer: "yes", at: "2026-11-09T11:00:00.000Z", by: "pg-other", gh_id: OTHER.id, words: "1" } },
} });
const PINS = () => ({ ash: { login: KEEPER.login, id: KEEPER.id }, fern: { login: OTHER.login, id: OTHER.id } });
const P1 = "https://media.postmark.town/proofs/pg-one.png";
const stateOfRow = async (slug) => {
  const c = await store.connect("world2_owner");
  try { return (await c.query("SELECT likeness_state AS s FROM households WHERE slug = $1", [slug])).rows[0].s; } finally { await c.end(); }
};
const setAnswer = async (slug, answer) => {
  const c = await store.connect("world2_owner");
  try { await c.query("UPDATE households SET likeness = jsonb_set(likeness, '{answer}', to_jsonb($2::text)) WHERE slug = $1", [slug, answer]); } finally { await c.end(); }
};
const fresh = () => seedRegistry(store, REGISTRY(), PINS());
const REQ = { request: { at: "2026-11-09T12:00:00.000Z", by: "pg-keeper", gh_id: KEEPER.id, depicts: "ash" } };

test("pg: the writer road, request to select to withdraw, as the office's own role (the grants hold)", { skip }, async () => {
  await fresh();
  const drain = async () => ({ ran: true, commit: "c0ffee" });
  const deps = { drain, now: () => new Date("2026-11-09T12:00:00.000Z") };
  await changeLikenessState({ slug: "pg-lane", kind: "request", args: { depicts: "ash" }, ghId: KEEPER.id, ghLogin: KEEPER.login }, deps);
  const s = await changeLikenessState({ slug: "pg-lane", kind: "select", args: { proof: P1 }, ghId: KEEPER.id, ghLogin: KEEPER.login }, deps);
  assert.equal(s.official.version, 1);
  assert.equal((await stateOfRow("pg-lane")).official.proof, P1);
  await changeLikenessState({ slug: "pg-lane", kind: "withdraw", args: {}, ghId: KEEPER.id, ghLogin: KEEPER.login }, deps);
  const end = await stateOfRow("pg-lane");
  assert.equal(end.official, undefined);
  assert.equal(end.history[0].ended, "withdrawn");
  assert.equal((await stateOfRow("pg-hall")), null, "the other house was not touched");
});

test("pg: the statement names the slug and a binding account", { skip }, async () => {
  await fresh();
  assert.deepEqual(await setLikenessState({ slug: "pg-lane", from: null, to: REQ, ghId: OTHER.id, needsYes: true }), { slug: null }, "another house's account");
  assert.deepEqual(await setLikenessState({ slug: "pg-hall", from: null, to: REQ, ghId: KEEPER.id, needsYes: true }), { slug: null }, "another house's slug");
  assert.equal(await stateOfRow("pg-lane"), null); assert.equal(await stateOfRow("pg-hall"), null);
  assert.deepEqual(await setLikenessState({ slug: "pg-lane", from: null, to: REQ, ghId: KEEPER.id, needsYes: true }), { slug: "pg-lane" });
});

test("pg: compare-and-swap: the second of two writers from the same state is refused, and key order does not matter", { skip }, async () => {
  await fresh();
  const other = { request: { ...REQ.request, depicts: "ash", by: "someone" } };
  assert.deepEqual(await setLikenessState({ slug: "pg-lane", from: null, to: REQ, ghId: KEEPER.id, needsYes: true }), { slug: "pg-lane" });
  assert.deepEqual(await setLikenessState({ slug: "pg-lane", from: null, to: other, ghId: KEEPER.id, needsYes: true }), { slug: null }, "stale from (null) loses");
  const reordered = { request: { depicts: "ash", gh_id: KEEPER.id, by: "pg-keeper", at: REQ.request.at } };
  assert.deepEqual(await setLikenessState({ slug: "pg-lane", from: reordered, to: other, ghId: KEEPER.id, needsYes: true }), { slug: "pg-lane" }, "jsonb equality, not text");
});

test("pg: a yes is checked in the row at the write: request and select need it, withdrawal does not", { skip }, async () => {
  await fresh();
  await setAnswer("pg-lane", "no");
  assert.deepEqual(await setLikenessState({ slug: "pg-lane", from: null, to: REQ, ghId: KEEPER.id, needsYes: true }), { slug: null });
  assert.deepEqual(await setLikenessState({ slug: "pg-lane", from: null, to: REQ, ghId: KEEPER.id, needsYes: false }), { slug: "pg-lane" });
});
