// record-printout-serial.test.mjs — TWO RECORDS AT ONCE NEVER MOVE THE WORLD-MARKS HEAD BACKWARDS (POS-1025, the
// review of #1022 F1).
//
//   node --test test/record-printout-serial.test.mjs
//
// 095's record_printout locks the snapshot row it records, and two records for DIFFERENT windows lock different
// rows. Without more, each reads max(sealed_settlement) over the committed printed rows, sees itself as the highest,
// and upserts the head: the newer one first, the older one waiting on the head row, then writing over it once the
// newer commits. The head would stand at the older printout. Nothing serializes the callers (the scheduled and the
// by-hand settlement units run the same script, and `settlement-printout.mjs record` is one autocommit call), so the
// function serializes itself: a transaction-scoped advisory lock before it reads anything.
//
// THE INTERLEAVING, made, not hoped for: session B records the NEWER settlement and holds its transaction open;
// session A records the OLDER one and is SEEN waiting (pg_locks: a lock it has not been granted); then B commits
// first, then A. The head must end at B's printout and A must say it did not advance it.
//
// THE CAN-FAIL FLIP: drop the PERFORM pg_advisory_xact_lock line from 095's record_printout and this test reds with
// the head at A's sha (run receipt in the PR).

import { after, test } from "node:test";
import assert from "node:assert/strict";
import { startStore } from "./helpers/embedded-store.mjs";

const store = await startStore({ db: "record_printout_serial_test" });
after(() => store.stop());
const skip = store.skip ?? false;

const hex = (c, n) => c.repeat(n);
const SHA_OLDER = hex("a", 40), SHA_NEWER = hex("b", 40);
const W_OLDER = 501, W_NEWER = 502;

async function owner(fn) {
  const c = await store.connect("world2_owner");
  try { return await fn(c); } finally { await c.end(); }
}
const head = () => owner(async (c) => (await c.query("SELECT sha FROM projection_heads WHERE repo = 'world-marks'")).rows[0]?.sha ?? null);

async function seed() {
  await owner(async (c) => {
    // two closed windows that tile (the candle's own law), each sealed and numbered
    for (const [w, n, d, from, to] of [[W_OLDER, 5, "1", "2026-11-01T05:45:40Z", "2026-11-01T17:45:40Z"], [W_NEWER, 6, "2", "2026-11-01T17:45:40Z", "2026-11-02T05:45:40Z"]]) {
      await c.query("INSERT INTO windows (id, opens_at, closes_at, status) VALUES ($1, $2, $3, 'closed') ON CONFLICT (id) DO NOTHING", [w, from, to]);
      await c.query(
        "INSERT INTO world_snapshots (window_id, digest, marks_digest, marks, sealed_settlement) VALUES ($1, $2, $3, 0, $4) ON CONFLICT (window_id) DO NOTHING",
        [w, hex(d, 64), hex(d, 64), n]);
    }
  });
}

test("the newer record commits first while the older one waits: the head stays at the newer printout", { skip, timeout: 60_000 }, async () => {
  await seed();
  const A = await store.connect("clearing_job");
  const B = await store.connect("clearing_job");
  try {
    await B.query("BEGIN");
    const [b] = (await B.query("SELECT * FROM record_printout($1, $2)", [W_NEWER, SHA_NEWER])).rows;
    assert.equal(b.advanced, true, "S6, alone so far, is the highest printed");

    const [{ pid }] = (await A.query("SELECT pg_backend_pid() AS pid")).rows;
    await A.query("BEGIN");
    const older = A.query("SELECT * FROM record_printout($1, $2)", [W_OLDER, SHA_OLDER]);
    // A is in its record, waiting on a lock B holds: the interleaving the review named, made and seen
    let waiting = 0;
    for (let i = 0; i < 100 && !waiting; i++) {
      waiting = (await owner((c) => c.query("SELECT count(*)::int AS n FROM pg_locks WHERE pid = $1 AND NOT granted", [pid]))).rows[0].n;
      if (!waiting) await new Promise((ok) => setTimeout(ok, 50));
    }
    assert.equal(waiting, 1, "the older record is waiting on the newer one's open transaction");

    await B.query("COMMIT");
    const [a] = (await older).rows;
    await A.query("COMMIT");

    assert.equal(a.settlement, 5);
    assert.equal(await head(), SHA_NEWER, "the world-marks head stands at the newer printout, never the older");
    assert.equal(a.advanced, false, "S5 is recorded, and says it did not move the head: S6 is printed above it");
    const rows = await owner(async (c) => (await c.query("SELECT sealed_settlement, printout_sha FROM world_snapshots WHERE window_id = ANY($1) ORDER BY sealed_settlement", [[W_OLDER, W_NEWER]])).rows);
    assert.deepEqual(rows.map((r) => [r.sealed_settlement, r.printout_sha]), [[5, SHA_OLDER], [6, SHA_NEWER]], "both printouts are recorded");
  } finally {
    await A.query("ROLLBACK").catch(() => {});
    await B.query("ROLLBACK").catch(() => {});
    await A.end(); await B.end();
  }
});

test("one at a time, in either order, the head is the highest printed; a re-record is the same record", { skip }, async () => {
  // the control: the same two records, already committed above; again, each changes nothing
  const c = await store.connect("clearing_job");
  try {
    const [older] = (await c.query("SELECT * FROM record_printout($1, $2)", [W_OLDER, SHA_OLDER])).rows;
    const [newer] = (await c.query("SELECT * FROM record_printout($1, $2)", [W_NEWER, SHA_NEWER])).rows;
    assert.deepEqual([older.advanced, newer.advanced], [false, true]);
    assert.equal(await head(), SHA_NEWER);
    await assert.rejects(c.query("SELECT * FROM record_printout($1, $2)", [W_NEWER, SHA_OLDER]), /already printed at/);
  } finally { await c.end(); }
});
