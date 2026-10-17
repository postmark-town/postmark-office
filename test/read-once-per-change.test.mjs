// read-once-per-change.test.mjs — a whole read the office paid per call,
// now paid per change (POS-272).
//
// (The ROLL half, office.db's residentList kept per sqlite handle, went with
// office.db, POS-656: the store's roll is held per store head,
// town-index-store.mjs § roster.)
//
//   PASSAGES  `enter-exit-ledger.mjs § livePassageRows` read every passage act
//             from the record on every call (the say's aboard-by-occupancy
//             branch, the crossing doors). It is kept under the passage set's
//             high-water mark and re-read when that moves, including for a
//             passage whose id is below the mark (drawn earlier, committed
//             later).
//
// ── THE FLIPS (run after the commit; the red lines go in the report) ────────
//
//   1. `passageMark` keys on `max(id)` alone: "a passage committed below the
//      mark" goes red.
//   2. `livePassageRows` never answers from the memo: the two "reads once"
//      counts go red.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { livePassageRows, __forgetPassages } from "../src/enter-exit-ledger.mjs";
import { __setPoolForTest } from "../src/world2-acts.mjs";

after(() => { __setPoolForTest(null); __forgetPassages(); });

// ── PASSAGES ─────────────────────────────────────────────────────────────────

const RECORD_ON = Object.freeze({ WORLD2_PG: "1", WORLD2_PG_URL: "postgres://read-once/none" });
const passage = (id, line) => ({
  id, at: new Date(Date.UTC(2026, 8, 26, 12, 0, id)), crossing: 210 + id / 1000, actor: "alder", action: "enter",
  payload: { ledger: "WORLD/enter-exit-ledger.md", lines: [line] },
});

// A record that answers the two questions the door asks, the way Postgres
// would: the mark over the passage rows, and the rows in id order. Anything
// else throws, so a new question cannot pass unseen.
function recordOf(acts) {
  const asked = { mark: 0, rows: 0 };
  const pool = { async query(sql, params) {
    const text = String(sql).replace(/\s+/g, " ");
    const want = new Set(params?.[0] ?? []);
    const rows = acts.filter((a) => want.has(a.action) && a.payload?._ledger == null);
    if (/max\(id\) AS hw, count\(\*\) AS n FROM acts/.test(text) && /payload->>'_ledger' IS NULL/.test(text)) {
      asked.mark += 1;
      return { rows: [{ hw: rows.length ? String(Math.max(...rows.map((r) => r.id))) : null, n: String(rows.length) }] };
    }
    if (/SELECT id, at, crossing, actor, action, payload FROM acts/.test(text) && /ORDER BY/.test(text)) {
      asked.rows += 1;
      return { rows: [...rows].sort((a, b) => a.id - b.id).map((r) => ({ ...r, payload: structuredClone(r.payload) })) };
    }
    throw new Error(`the record was asked something it does not answer: ${text.slice(0, 160)}`);
  } };
  return { pool, asked };
}

test("PASSAGES: read once while nothing crosses, and again when a passage lands", async () => {
  __forgetPassages();
  const acts = [passage(1, "- a enters b"), passage(2, "- a exits b")];
  const { pool, asked } = recordOf(acts);
  __setPoolForTest(pool);
  const first = await livePassageRows({ env: RECORD_ON });
  for (let i = 0; i < 4; i++) assert.deepEqual(await livePassageRows({ env: RECORD_ON }), first);
  assert.equal(asked.rows, 1, "the passages were read again with no passage made");
  assert.equal(asked.mark, 5, "every call asks the mark");

  acts.push(passage(3, "- a enters c"));
  const after3 = await livePassageRows({ env: RECORD_ON });
  assert.equal(asked.rows, 2, "a new passage did not move the read");
  assert.deepEqual(after3.rows.map((r) => r.seq), [1, 2, 3]);
});

test("PASSAGES: a passage committed below the mark is still seen", async () => {
  __forgetPassages();
  const acts = [passage(1, "- a enters b"), passage(3, "- a enters c")];
  const { pool } = recordOf(acts);
  __setPoolForTest(pool);
  assert.deepEqual((await livePassageRows({ env: RECORD_ON })).rows.map((r) => r.seq), [1, 3]);
  // Identity 2 was drawn before 3 and committed after it: `max(id)` does not move.
  acts.push(passage(2, "- a exits b"));
  assert.deepEqual((await livePassageRows({ env: RECORD_ON })).rows.map((r) => r.seq), [1, 2, 3],
    "the late commit is missing: the mark did not see the row set change");
});

test("PASSAGES: a record that cannot say its mark is read in full, and its failure is still named", async () => {
  __forgetPassages();
  const acts = [passage(1, "- a enters b")];
  const honest = recordOf(acts);
  let rowsRead = 0;
  __setPoolForTest({ async query(sql, params) {
    if (/max\(id\)/.test(sql)) throw new Error("the mark is not answerable here");
    rowsRead += 1;
    return honest.pool.query(sql, params);
  } });
  await livePassageRows({ env: RECORD_ON });
  await livePassageRows({ env: RECORD_ON });
  assert.equal(rowsRead, 2, "with no mark, nothing may be kept");

  __setPoolForTest({ async query() { throw new Error("connection refused"); } });
  const down = await livePassageRows({ env: RECORD_ON });
  assert.deepEqual(down.rows, []);
  assert.match(down.unread, /could not be read/);
});
