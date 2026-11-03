// named-creature-ending-store.test.mjs — who "took part" in a named creature's
// ending, read by the real ANSWERED_SQL on a real store (WLD-5/t: only residents
// whose acts were AIMED at it; presence alone never counts).
//
// Rows are written straight into `acts`: a spawn, an act aimed at the creature
// that it never answered, a walk toward it that it never answered, a walk that
// was not toward it, an act on something else, and a reaction to an aimed act.

import { test as nodeTest } from "node:test";
import assert from "node:assert/strict";

import { ANSWERED_SQL, supportersOf, tookPart } from "../world2/tools/creature-endings.mjs";
import { startStore } from "./helpers/embedded-store.mjs";

const ID = "creature:a-named-one";

nodeTest("ON THE STORE · ANSWERED_SQL reads aimed acts and walks toward the creature, answered or not, and nothing else", async () => {
  const s = await startStore({ db: "creature_took_part" });
  const owner = await s.connect("world2_owner");
  try {
    const put = async (at, actor, action, object, cls, payload = {}) => (await owner.query(
      `INSERT INTO acts (at, crossing, actor, action, object, class, payload, effect) VALUES ($1, 1, $2, $3, $4, $5, $6::jsonb, 'x') RETURNING id::text`,
      [at, actor, action, object, cls, JSON.stringify(payload)])).rows[0].id;
    const T = (m) => new Date(Date.UTC(2026, 9, 24, 12, m)).toISOString();
    await put(T(0), "the-town", "spawn", ID, "creature", { kind: "wolf", stays: true });
    await put(T(2), "watcher", "watch", ID, "creature", {});                                       // aimed, never answered
    await put(T(3), "walker", "walk", "some/mark", "move", { approach: ID });                      // a walk toward it, never answered
    await put(T(4), "passer", "walk", "some/mark", "move", { to: "some/mark" });                   // a walk that is not toward it
    await put(T(5), "passer2", "build", "other/thing", "mark", {});                                // an act on something else
    await put(T(6), "elsewhere", "walk", "some/mark", "move", { approach: "creature:another" });   // toward a different creature
    const aimed = await put(T(7), "striker", "strike", ID, "creature", {});
    await put(T(8), ID, "react", aimed, "creature", {});                                           // answered: the join branch
    await put(T(9), "late", "watch", ID, "creature", {});                                          // after the cutoff
    const { rows } = await owner.query(ANSWERED_SQL, [ID, T(9)]);
    const actors = rows.map((r) => r.actor);
    assert.deepEqual(actors.sort(), ["striker", "walker", "watcher"],
      "the unanswered watch and approach are named; the passers, the other creature's approach and the late act are not");
    assert.deepEqual(tookPart(ID, rows, []).sort(), ["striker", "walker", "watcher"]);
    // THE SCAN IS BOUNDED BY THE EXISTING INDEXES: the walk branch reads the (class, id) index from the spawn row on
    const { rows: plan } = await owner.query(`EXPLAIN ${ANSWERED_SQL.replace(/\$1/g, `'${ID}'`).replace(/\$2/g, `'${T(9)}'`)}`);
    const text = plan.map((r) => r["QUERY PLAN"]).join("\n");
    assert.match(text, /acts_class_idx|acts_object_idx|Index/, `an index serves the reads:\n${text}`);
  } finally {
    await owner.end().catch(() => {});
    await s.stop();
  }
});

nodeTest("ON THE STORE · WLD-129: ANSWERED_SQL carries a steady or a shield the record puts in the creature's ring, and supportersOf names the givers", async () => {
  const s = await startStore({ db: "creature_supporters" });
  const owner = await s.connect("world2_owner");
  try {
    const put = async (at, actor, action, object, cls, payload = {}) => (await owner.query(
      `INSERT INTO acts (at, crossing, actor, action, object, class, payload, effect) VALUES ($1, 1, $2, $3, $4, $5, $6::jsonb, 'x') RETURNING id::text`,
      [at, actor, action, object, cls, JSON.stringify(payload)])).rows[0].id;
    const T = (m) => new Date(Date.UTC(2026, 9, 29, 12, m)).toISOString();
    const OTHER = "creature:another";
    await put(T(0), "the-town", "spawn", ID, "creature", { kind: "wolf", stays: true });
    await put(T(1), "fighter", "strike", ID, "creature", {});                                                  // took part (aimed)
    await put(T(2), "limen", "steady", "fighter", "creature", { creature: ID, cost: 1, gives: 2 });           // steadied a fighter, in its ring: named
    await put(T(3), "umber", "shield", "fighter", "creature", { creature: ID, cost: 1 });                      // shielded a fighter, in its ring: named
    await put(T(4), "bystander-friend", "steady", "bystander", "creature", { creature: ID, cost: 1 });         // for someone who never fought: read, not named
    await put(T(5), "elsewhere", "shield", "fighter", "creature", { creature: OTHER, cost: 1 });               // in another creature's ring: not read
    const overlapped = await put(T(6), "overlap", "steady", "fighter", "creature", { creature: OTHER, cost: 1 }); // attributed to another, but this one answered it
    await put(T(7), ID, "react", overlapped, "creature", {});
    await put(T(9), "late", "steady", "fighter", "creature", { creature: ID, cost: 1 });                       // after the cutoff
    const { rows } = await owner.query(ANSWERED_SQL, [ID, T(9)]);
    const fought = tookPart(ID, rows, []);
    assert.deepEqual(fought, ["fighter"], "a support is never a fighter's aim");
    assert.deepEqual(supportersOf(rows, fought), ["limen", "umber", "overlap"],
      "limen and umber by the payload's creature, overlap by this creature's reaction; not the bystander's friend, the other ring's shield or the late steady");
    assert.deepEqual(rows.filter((r) => r.actor === "limen").map((r) => [r.object, r.support]), [["fighter", "steady"]]);
  } finally {
    await owner.end().catch(() => {});
    await s.stop();
  }
});
