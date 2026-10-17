// bevel-stock-boundaries.test.mjs — WLD-27 first review (Bevel, 2026-10-13): the two
// stock probes Bevel wrote against office 01abca91, where they were 0/2.
//
// ADAPTED, and the adaptation is the whole of the difference: Bevel's adapter
// answered queries by CALL COUNT, which ties it to the old query order. This one
// answers by WHAT THE SQL ASKS, so the probes run against the corrected tick's
// real sequence (plan, then per chest BEGIN → the chest's lock → a re-read
// under it → insert). Probe 1's chest now names its admitting settlement — the
// admission gate (finding 7) would otherwise plan nothing and the race would
// pass without being run. The assertions are Bevel's, unchanged. The same race
// and admission on a REAL Postgres: chest-stock.test.mjs tests 6, 6b, 7, 7b.

import { test } from "node:test";
import assert from "node:assert/strict";
import { stockChests, planFromStore } from "../world2/tools/chest-stock.mjs";
import { UNIT_ACTION, foldUnits, totalOf } from "../src/world-stacks.mjs";

const chest = "review-maker/bowl";
const label = "review-comets";
function client({ race = false, admitted = 250 } = {}) {
  const acts = [];
  const law = ["candy", "chest", "thing"].map((key) => ({
    number: 250, tag_sha: "synthetic-sha", newest: 250, kind: "class", key,
    data: key === "candy"
      ? { class: key, extends: "consumable", labels: [{ label, name: "Review Comets", creator: "review-maker" }] }
      : { class: key, dials: { capacity: 30, capacity_min: 1, capacity_max: 120, first_stock: 30 } },
  }));
  const rowsOf = () => acts.map((a) => ({ at: new Date(), crossing: 250, actor: "x", object: a.object ?? null, witnesses: null, effect: null, household: null, ...a }));
  return { acts, query: async (sql, args) => {
    if (sql.includes("law_projection")) return { rows: law };
    if (sql.includes("mark_carried")) return { rows: [{ slug: chest, owner: "review-maker", data: { by: "review-maker", capacity: 20 }, ...(admitted == null ? {} : { settlement: admitted }) }] };
    if (sql === "BEGIN") {
      if (race) acts.push({ id: 1, class: "holding", action: UNIT_ACTION.give, payload: { units: true, moves: [{ from: null, to: chest, label, n: 4 }] } });
      return { rows: [] };
    }
    if (sql.includes("pg_advisory_xact_lock")) return { rows: [{}] };
    if (sql.includes("action = ANY")) return { rows: [] };                     // the attachments read: no whole things
    if (sql.includes("FROM acts")) return { rows: rowsOf() };                  // the unit rows, before and under the lock
    if (sql.includes("INSERT INTO acts")) {
      acts.push({ id: 2, class: "holding", action: args[2], object: args[3], payload: JSON.parse(args[4]) });
      return { rows: [{ id: 2 }] };
    }
    if (sql === "COMMIT" || sql === "ROLLBACK") return { rows: [] };
    throw new Error(`unexpected query in synthetic stock fixture: ${sql}`);
  } };
}

test("a give between stock planning and insertion must not overfill a capacity-20 chest", async () => {
  const c = client({ race: true });
  await stockChests(c, { crossing: 250 });
  assert.ok(c.acts.some((a) => a.action === UNIT_ACTION.stock), "the stock was actually written — the race was run, not skipped");
  assert.ok(totalOf(foldUnits(c.acts), chest) <= 20,
    `stock race left ${totalOf(foldUnits(c.acts), chest)} units in a capacity-20 chest`);
});

test("a standing chest not carried by any settlement must not yet receive a stock plan", async () => {
  // There is an older ingested settlement and a standing store chest, but NO
  // published admission/carried record. Store-standing can precede canon.
  const plan = await planFromStore(client({ admitted: null }));
  assert.equal(plan.stock.length, 0, "unpublished/unadmitted chest must not be attributed to the newest settlement");
});

// ── Bevel's revised first review (2026-10-13T02:15Z), controls carried VERBATIM from
// /tmp/bevel-wld27-r2-pf71t09r/test/bevel-stock-boundaries.test.mjs (appended there; red at ebef4f49).

test('Bevel R2: delayed zero-stock receipt names its eligible settlement, not its earlier admission', async () => {
  const c = client({ admitted: 250 });
  c.acts.push({ id: 1, class: 'holding', action: UNIT_ACTION.give,
    payload: { units: true, moves: [{ from: null, to: chest, label, n: 20 }] } });
  const query = c.query;
  c.query = async (sql, args) => {
    const r = await query(sql, args);
    if (sql.includes('law_projection')) r.rows = r.rows.map(x => ({ ...x, number: 251, newest: 251 }));
    return r;
  };
  const stocked = await stockChests(c, { crossing: 251.5 });
  const act = c.acts.find(a => a.action === UNIT_ACTION.stock);
  assert.equal(act.payload.label_found_at, 251, 'the label exists at the eligible settlement S251');
  assert.equal(act.payload.settlement, 250, 'retain the independent admitting-settlement provenance');
  assert.match(stocked.line, /chest-stock: 0, chest full at S251\b/,
    'do not say the full-chest decision happened at S250 before its label existed');
});
