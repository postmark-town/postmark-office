// order-by-id-store.test.mjs — act ids sort as numbers, across a digit boundary (POS-742).
//
// Found by plumb-combat (2026-10-21): `SELECT id::text AS id … ORDER BY id` binds
// the bare `id` to the OUTPUT alias, the text, so "1000000" sorted before
// "999999" and a cursor or a LIMIT took the wrong rows. Every such read now orders
// by the table's own column, `acts.id`. This drives each one on a real Postgres
// whose acts ids cross 999,999 → 1,000,000, and keeps a can-fail control: the
// same read ordered by the alias sorts wrong on the same rows.

import { test } from "node:test";
import assert from "node:assert/strict";

import { startStore } from "./helpers/embedded-store.mjs";
import { PRIOR_SQL } from "../src/arrival-entries.mjs";
import { PRIOR_ROW_SQL, TICK_ROWS_SQL } from "../src/creature-tick.mjs";
import { WALKS_BOOT_SQL, WALKS_SQL } from "../src/creatures-hook.mjs";
import { REACTIONS_SQL } from "../src/creatures-read.mjs";
import { LIVE_AFTER_SQL, LIVE_NEWEST_SQL } from "../src/world-happened.mjs";

const numeric = (ids) => ids.every((id, i) => i === 0 || BigInt(ids[i - 1]) < BigInt(id));
const numericDesc = (ids) => ids.every((id, i) => i === 0 || BigInt(ids[i - 1]) > BigInt(id));

test("POS-742 · every act read orders by the number, across 999,999 → 1,000,000", async () => {
  const s = await startStore({ db: "order_by_id_digits" });
  const owner = await s.connect("world2_owner");
  const api = await s.connect("office_api");
  try {
    const { rows: [{ seq }] } = await owner.query("SELECT pg_get_serial_sequence('acts', 'id') AS seq");
    await owner.query("SELECT setval($1::regclass, 999996)", [seq]);
    const at = "2026-10-21T12:00:00Z";
    const ins = async (cls, actor, action, object, payload = {}) => (await api.query(
      `INSERT INTO acts (at, crossing, actor, action, object, class, payload, effect, household)
       VALUES ($1, 270, $2, $3, $4, $5, $6::jsonb, 'a test row', 'a-house') RETURNING id::text AS id`,
      [at, actor, action, object, cls, JSON.stringify(payload)])).rows[0].id;
    const ids = { creature: [], move: [], react: [], enter: [], said: [] };
    for (let i = 0; i < 6; i += 1) {
      ids.creature.push(await ins("creature", "the-town", "spawn", `creature:wolf-270-${i}`, { kind: "wolf" }));
      ids.move.push(await ins("move", "kai", "walk", null, { pace: 60 }));
      ids.react.push(await ins("creature", "creature:wolf-270-0", "react", String(i)));
      ids.enter.push(await ins("move", "kai", "enter", "a/room", { arrival_of: "77" }));
      ids.said.push(await ins("voice", "kai", "say", null));
    }
    const all = [...Object.values(ids).flat()];
    assert.ok(all.some((id) => id.length === 6) && all.some((id) => id.length === 7), "the rows cross the digit boundary");

    // the can-fail control: the same read by the alias sorts the text
    const byAlias = (await api.query(TICK_ROWS_SQL.replace("ORDER BY acts.id", "ORDER BY id"), [["spawn"], "2000-01-01T00:00:00Z"])).rows.map((r) => r.id);
    assert.equal(numeric(byAlias), false, `ordered by the alias, the text sorts first: ${byAlias.join(", ")}`);

    const q = async (sql, params) => (await api.query(sql, params)).rows.map((r) => r.id);
    assert.ok(numeric(await q(TICK_ROWS_SQL, [["spawn", "react"], "2000-01-01T00:00:00Z"])), "creature-tick § TICK_ROWS_SQL");
    assert.deepEqual(await q(PRIOR_ROW_SQL, ["react", "0"]), [ids.react[0]], "creature-tick § PRIOR_ROW_SQL: the first by number");
    assert.ok(numeric(await q(WALKS_SQL, ["0", 100])), "creatures-hook § WALKS_SQL");
    const firstTwo = await q(WALKS_SQL, ["0", 2]);
    assert.deepEqual(firstTwo, [ids.move[0], ids.enter[0]], "a LIMIT takes the lowest ids (walks and enters are both moves), not the shortest text");
    assert.ok(numeric(await q(WALKS_BOOT_SQL, [0])), "creatures-hook § WALKS_BOOT_SQL");
    assert.ok(numericDesc(await q(REACTIONS_SQL, ["creature:wolf-270-0", 100])), "creatures-read § REACTIONS_SQL (newest first)");
    assert.deepEqual(await q(REACTIONS_SQL, ["creature:wolf-270-0", 1]), [ids.react.at(-1)], "its LIMIT takes the newest by number");
    assert.ok(numericDesc(await q(LIVE_AFTER_SQL, ["0", ["say", "walk"], 100])), "world-happened § LIVE_AFTER_SQL");
    assert.ok(numericDesc(await q(LIVE_NEWEST_SQL, [["say", "walk"], 100])), "world-happened § LIVE_NEWEST_SQL");
    assert.deepEqual(await q(LIVE_NEWEST_SQL, [["say"], 1]), [ids.said.at(-1)]);
    assert.deepEqual(await q(PRIOR_SQL, ["kai", "77"]), [ids.enter[0]], "arrival-entries § PRIOR_SQL: the first by number");
  } finally {
    await api.end();
    await owner.end();
    await s.stop();
  }
});
