// hold-record.test.mjs — the hold lane's record kept and moved by its delta
// (src/hold-record.mjs; LOGOS v2 lane O2, review-610 S5 and F1).
//
// "Compute only the delta": the keeper folds the history once into a base and
// applies each change as the acts above its cutoff. Proven here with injected
// readers (the keeping itself) and, on the embedded store, the high-water read's
// plan (EXPLAIN: by the class index, no scan of acts).

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { holdRecordKeeper, HOLD_TOP_SQL } from "../src/hold-record.mjs";
import { foldUnits, kindEdgesOf, totalOf, UNIT_ACTION } from "../src/world-stacks.mjs";
import { liveHolder } from "../src/world-hold.mjs";
import { startStore } from "./helpers/embedded-store.mjs";

const make = (id, to, n, kind = "pocket-comet") => ({ seq: id, class: "holding", action: UNIT_ACTION.make, object: to, payload: { moves: [{ from: null, to, kind, n }] } });
const move = (id, from, to, n, kind = "pocket-comet") => ({ seq: id, class: "holding", action: UNIT_ACTION.give, object: to, payload: { moves: [{ from, to, kind, n }] } });
const hold = (id, thing, entity) => ({ act_id: String(id), entity, target: thing, policy: "cascade", born_at: new Date(1_800_000_000_000 + id).toISOString() });

/** A record whose acts become visible (commit) in an order of the test's choosing. */
function record() {
  const holding = [], attachments = [];
  const calls = { holding: [], attachments: [], top: 0 };
  return {
    commit: (r) => (r.target ? attachments : holding).push(r),
    calls,
    readers: {
      readTop: async () => { calls.top += 1; const ids = [...holding.map((r) => r.seq), ...attachments.map((r) => Number(r.act_id))]; return ids.length ? String(Math.max(...ids)) : null; },
      readHolding: async ({ afterId = null } = {}) => { calls.holding.push(afterId); return holding.filter((r) => afterId == null || r.seq > afterId).sort((a, b) => a.seq - b.seq); },
      readAttachments: async ({ afterId = null } = {}) => { calls.attachments.push(afterId); return attachments.filter((r) => afterId == null || Number(r.act_id) > afterId).sort((a, b) => Number(a.act_id) - Number(b.act_id)); },
    },
    full: () => foldUnits([...holding].sort((a, b) => a.seq - b.seq)),
  };
}

test("between two hold acts a read reuses the kept record; a change applies only the acts above the cutoff", async () => {
  const rec = record();
  for (let i = 1; i <= 20; i++) rec.commit(make(i, "x/bowl", 1));
  const k = holdRecordKeeper({ ...rec.readers, width: 5 });
  const a = await k.now();
  assert.equal(totalOf(a.fold, "x/bowl"), 20);
  assert.equal(a.cutoff, 15, "the base is folded through 20 − 5");
  const b = await k.now();
  assert.equal(b, a, "no change: the same record, no re-read");
  assert.deepEqual(rec.calls.holding, [null], "one full read, ever, so far");
  rec.commit(make(21, "x/bowl", 2));
  const c = await k.now();
  assert.equal(totalOf(c.fold, "x/bowl"), 22);
  assert.deepEqual(rec.calls.holding, [null, 15], "the change read only the acts above the cutoff");
});

test("F1 · THE OVERLAP: an act whose id was taken before a neighbour's but committed after it is picked up by the next read", async () => {
  const rec = record();
  for (const i of [1, 2, 3, 4, 5, 6, 8, 9, 10]) rec.commit(make(i, "x/bowl", 1)); // 7 has its id but has not committed
  const k = holdRecordKeeper({ ...rec.readers, width: 5 });
  assert.equal(totalOf((await k.now()).fold, "x/bowl"), 9);
  rec.commit(make(7, "x/bowl", 10)); // 7 commits late — after 10 was read
  rec.commit(make(11, "x/bowl", 1));
  const r = await k.now();
  assert.equal(totalOf(r.fold, "x/bowl"), 20, "act 7 is in: the window above the cutoff is re-read whole");
  assert.deepEqual(r.fold.kinds, rec.full().kinds, "the kept record equals a fold of the whole history");
});

test("F1 · SINGLE-FLIGHT: reads that arrive while a change is applied share one application", async () => {
  const rec = record();
  for (let i = 1; i <= 10; i++) rec.commit(make(i, "x/bowl", 1));
  let release;
  const gate = new Promise((ok) => { release = ok; });
  const slow = { ...rec.readers, readHolding: async (o) => { await gate; return rec.readers.readHolding(o); } };
  const k = holdRecordKeeper({ ...slow, width: 5 });
  const reads = [k.now(), k.now(), k.now(), k.now()];
  release();
  const out = await Promise.all(reads);
  assert.ok(out.every((r) => r === out[0]), "one record for all four");
  assert.equal(k.stats().rebuilds, 1, "one application, however many asked");
  assert.deepEqual(rec.calls.holding, [null]);
});

test("the base advances when the window outgrows it, and stays equal to the whole fold — moves, holds and set-downs", async () => {
  const rec = record();
  let id = 0;
  const k = holdRecordKeeper({ ...rec.readers, width: 4, placesOf: async (drops) => new Map([...drops].map(([t, r]) => [t, { x: r.seq, y: 0 }])) });
  for (let round = 0; round < 12; round++) {
    rec.commit(make(++id, "x/bowl", 3));
    rec.commit(move(++id, "x/bowl", "cy", 1));
    rec.commit(hold(++id, `x/thing-${round % 3}`, round % 2 ? "cy" : "x/bowl"));
    if (round % 4 === 0) rec.commit({ seq: ++id, class: "holding", action: "drop", object: "x/thing-0", payload: {} });
    const r = await k.now();
    assert.deepEqual(r.fold.kinds, rec.full().kinds, `round ${round}: the fold`);
    for (let t = 0; t < 3; t++) {
      const all = [];
      // the whole history's holder, last row wins
      for (const a of (await rec.readers.readAttachments({}))) all.push(a);
      assert.equal(liveHolder(r.attachments, `x/thing-${t}`), liveHolder(all, `x/thing-${t}`), `round ${round}: who holds x/thing-${t}`);
    }
  }
  assert.ok(k.stats().cutoff > 0, "the base advanced");
  assert.ok(rec.calls.holding.filter((x) => x == null).length === 1, "and the whole history was read once");
});

const store = await startStore({ db: "hold_record_top" });
after(async () => { await store.stop(); });
test("F1 · the high-water read is answered by the class index, never a scan of acts", { skip: store.skip ?? false }, async () => {
  const c = await store.connect("world2_owner");
  try {
    await c.query("SET enable_seqscan = off"); // a plan that can only scan says so: it costs off the scale, and the plan shows it
    const plan = (await c.query(`EXPLAIN (COSTS OFF) ${HOLD_TOP_SQL}`)).rows.map((r) => r["QUERY PLAN"]).join("\n");
    assert.match(plan, /acts_class_idx/, plan);
    assert.doesNotMatch(plan, /Seq Scan on acts/, plan);
    assert.match(plan, /Index Cond: \(class = 'holding'::text\)/, plan);
    // the old form, for the record: an OR across class and action has no index to stand on, so the plan
    // walks acts backward from the newest by its primary key, filtering: every say and walk since the last hold act
    const old = (await c.query("EXPLAIN (COSTS OFF) SELECT max(id) FROM acts WHERE class = 'holding' OR action = ANY($1)", [["give", "take"]])).rows.map((r) => r["QUERY PLAN"]).join("\n");
    assert.match(old, /Filter: .*OR/, old);
  } finally { await c.end(); }
});
