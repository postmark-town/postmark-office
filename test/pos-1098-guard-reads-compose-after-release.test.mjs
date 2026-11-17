// pos-1098-guard-reads-compose-after-release.test.mjs — POS-1098: the keeper's holding and attachment reads (the public doorstep's stances with set-downs) read their rows under
// the pen's connection and hydrate them after it is back.
//
//   node --import ./test/helpers/sparse-guard.mjs --test test/pos-1098-guard-reads-compose-after-release.test.mjs
//
// WHAT WAS FOUND (Rivet, POS-1064 comment of 11-17 04:27Z, checked here against the source at release/2026-w47.7 @ 7c62bf2b1): `storeAttachmentRows` and `storeHoldingRows`
// (world2-guards.mjs) wrapped `pgAttachmentsFor` / `pgHoldingRows` whole inside `officeRead`, so the whole town's holding acts were hydrated (`attachmentRecords`,
// `holdingRowOf`) and filtered with the pen's READ ONLY transaction open. They are asked for the whole record on every doorstep's stances read.
//
// THE MEASUREMENT: the reader stand-in (`useGuardReader`, the seam hold-wirings.test.mjs uses) marks "the pen is held" for exactly as long as the callback runs, and the
// rows' own fields are getters that record whether the pen was held at the moment the hydration read them. On the one-pass readers every read is under the hold; now
// none is. The answers are checked beside it, so a split that dropped or reordered a row is red too.

import test from "node:test";
import assert from "node:assert/strict";
import { HOLD_FACES } from "../world2/tools/guard-reads.mjs";

const state = { held: false, reads: [] };
const watched = (row, key, value) => Object.defineProperty(row, key, { enumerable: true, get() { state.reads.push(state.held); return value; } });

const attachment = (id, holder, thing, at) => watched({ id, action: HOLD_FACES[0], at: new Date(at), actor: holder }, "payload", { thing, holder, policy: "keep" });
const holding = (id, thing) => watched({ crossing: 3, actor: "wright", action: "drop", object: thing, class: "holding", payload: {}, at: new Date("2026-11-17T03:00:00Z") }, "id", id);

const client = {
  query: async (sql) => {
    if (/class = 'holding'\)/.test(sql) || /action = ANY/.test(sql)) return { rows: [attachment(1, "rei", "wright/lamp", "2026-11-16T10:00:00Z"), attachment(2, "wright", "rei/book", "2026-11-16T11:00:00Z")] };
    return { rows: [holding(7, "wright/lamp"), holding(8, "rei/book")] };
  },
};

async function withReader(fn) {
  const guards = await import("../src/world2-guards.mjs");
  const prev = { pg: process.env.WORLD2_PG, url: process.env.WORLD2_PG_URL };
  process.env.WORLD2_PG = "1";
  process.env.WORLD2_PG_URL = "postgres://the-reader-override-never-dials-this";
  const undo = guards.useGuardReader(async (run) => { state.held = true; try { return await run(client); } finally { state.held = false; } });
  state.reads = [];
  try { return await fn(guards); }
  finally { undo(); for (const [k, v] of [["WORLD2_PG", prev.pg], ["WORLD2_PG_URL", prev.url]]) if (v === undefined) delete process.env[k]; else process.env[k] = v; }
}

test("storeAttachmentRows hydrates its rows after the pen's connection is back, and answers the same rows", async () => {
  await withReader(async (g) => {
    const rows = await g.storeAttachmentRows();
    assert.ok(state.reads.length > 0, "the hydration read nothing: this test is not looking at what it claims to");
    assert.equal(state.reads.filter(Boolean).length, 0, `${state.reads.filter(Boolean).length} of ${state.reads.length} row reads ran while the pen was held`);
    assert.deepEqual(rows.map((r) => [r.entity, r.target, r.policy, r.era]), [["rei", "wright/lamp", "keep", "live"], ["wright", "rei/book", "keep", "live"]]);
    const until = await g.storeAttachmentRows({ until: Date.parse("2026-11-16T10:30:00Z") });
    assert.deepEqual(until.map((r) => r.target), ["wright/lamp"], "`until` still bounds the answer");
  });
});

test("storeHoldingRows maps its rows after the pen's connection is back, and answers the same rows", async () => {
  await withReader(async (g) => {
    const rows = await g.storeHoldingRows();
    assert.ok(state.reads.length > 0, "the mapping read nothing: this test is not looking at what it claims to");
    assert.equal(state.reads.filter(Boolean).length, 0, `${state.reads.filter(Boolean).length} of ${state.reads.length} row reads ran while the pen was held`);
    assert.deepEqual(rows.map((r) => [r.seq, r.object, r.action, r.crossing]), [[7, "wright/lamp", "drop", 3], [8, "rei/book", "drop", 3]]);
  });
});

test("a strict refusal still reaches the caller, from after the release", async () => {
  await withReader(async (g) => {
    const bad = { query: async () => ({ rows: [{ id: 9, action: HOLD_FACES[0], at: new Date("2026-11-16T10:00:00Z"), actor: "x", payload: { holder: "x" } }] }) };
    const undo = g.useGuardReader(async (run) => { state.held = true; try { return await run(bad); } finally { state.held = false; } });
    try { await assert.rejects(() => g.storeAttachmentRows(), /match no known era|naming no thing/); }
    finally { undo(); }
  });
});
