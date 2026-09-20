// world2-stake-reads.test.mjs — `/world2/stake?mark=`, the escrow twin, held to
// the town's own arithmetic AND made unable to go green off the tree (POS-104).
//
// ── WHY AN EQUALITY TEST ALONE WOULD BE WORTHLESS HERE ──────────────────────
//
// A twin that quietly read the town clone would answer the SAME numbers as 1.0,
// because 1.0 reads the town clone — so a field-for-field equality passes with
// the port doing nothing at all. That is the failure mode this whole lane exists
// to prevent, and it is invisible to an equality.
//
// So every case below rests on TWO legs, and the second is the load-bearing one:
//
//   1 · THE ARITHMETIC. `stakeAnswerFrom` is checked against the town's own
//       `deriveWorldMarkWeights` algebra, quoted in `stake-reads.mjs`'s header —
//       and, where it can be, against `fold-input.mjs § stakesFromStore`, a
//       SECOND reader of the same table written for the fold by another hand.
//       Two independent readers of one projection agreeing is a real check; a
//       function agreeing with itself is not.
//   2 · THE PLANTED STORE-ONLY ROW. The fixture pool answers
//       `STAKE_ROWS_SQL` with a holder — `only-in-the-store` — that stands in no
//       ledger, in no clone, and in no tree anywhere. If that holder is not in
//       the answer, the door did not read the store. The same pool COUNTS what
//       it was asked, so a door that never opened `escrow_projection` fails on
//       the count even if it somehow produced the right numbers.
//
// ── THE FLIP, run 2026-09-17 against commit `976b3de` of this branch ─────────
//
// In `src/world2-serve.mjs`'s `/world2/stake` arm, point the twin at the tree:
// replace the projection read
//
//     const { rows } = await p.query(stakeRead.STAKE_ROWS_SQL, [head.sha, mark]);
//
// with a tree-shaped constant — the shape a town-clone fold would hand back for
// this mark, `only-in-the-store` absent because no ledger holds it:
//
//     const rows = [{ mark, holder: "wright", household: "gh:67605380",
//                     own_household: "gh:1", n: 3, weight_k: 5 }];
//
// and 5 of these 12 go red — the planted row, the query count, the numbers it
// moves, the zero case and the torn-ingest refusal. The first is:
//
//   not ok 5 - THE PLANTED ROW: a holder that exists only in the store reaches the answer
//     error: |-
//       the twin did not see `only-in-the-store` — it is reading something that is not escrow_projection
//
// Restore with `git checkout -- src/world2-serve.mjs`.
//
// Run: node --test test/world2-stake-reads.test.mjs

import { test, before, after } from "node:test";
import assert from "node:assert/strict";

import { stakeAnswerFrom, STAKE_ROWS_SQL, STAKE_NOTE } from "../world2/tools/stake-reads.mjs";
import { stakesFromStore } from "../world2/tools/fold-input.mjs";

const env = { pg: process.env.WORLD2_PG, url: process.env.WORLD2_PG_URL };
before(() => {
  // The env gate decides whether these doors exist at all and is not under test;
  // the injected pool means no connection is ever opened, so the URL merely has
  // to be truthy. `world2-walks-window.test.mjs`'s own arrangement.
  process.env.WORLD2_PG = "1";
  process.env.WORLD2_PG_URL = "postgres://stake-reads-test/none";
});
after(() => {
  if (env.pg == null) delete process.env.WORLD2_PG; else process.env.WORLD2_PG = env.pg;
  if (env.url == null) delete process.env.WORLD2_PG_URL; else process.env.WORLD2_PG_URL = env.url;
});

const { world2Serve } = await import("../src/world2-serve.mjs");

// ── the fixture store ───────────────────────────────────────────────────────
//
// One mark, four positions, three households and the mark's own. Chosen so every
// term of the breadth arithmetic is exercised by a DIFFERENT row rather than by
// one row doing all the work:
//
//   wright            gh:67605380   3   external, first for its household → earns k
//   amber             gh:67605380   2   external, SECOND for the same household → earns nothing
//   only-in-the-store solo:ghost    7   external, first for its household → earns k
//   pando             gh:1          4   THE MARK'S OWN household → never earns k
//
//   escrow 16 · households 3 · households_external 2 · weight 16 + 5·2 = 26
//
// A fixture where every external holder were also the first of its household
// would pass with `firstForHousehold` deleted, which is the shape of check that
// proves nothing.
const TOWN_SHA = "610c43e7e5a7fabbcd340812b574c41ac31702f1";
const MARK = "pando/peak-family-excursion";
const K = 5;

const pos = (holder, household, n) => ({ mark: MARK, holder, household, own_household: "gh:1", n, weight_k: K });
const ROWS = [
  pos("amber", "gh:67605380", 2),
  pos("only-in-the-store", "solo:ghost", 7),
  pos("pando", "gh:1", 4),
  pos("wright", "gh:67605380", 3),
];

/**
 * A pool that answers the escrow read and NOTHING else, and remembers what it
 * was asked. The discrimination is the point: a door that stopped querying
 * `escrow_projection` gets nothing back from this fixture, which is exactly what
 * a door reading the tree would deserve.
 */
function fixturePool({ rows = ROWS, townSha = TOWN_SHA } = {}) {
  const asked = [];
  return {
    asked,
    query: async (sql, params) => {
      asked.push({ sql: String(sql).replace(/\s+/g, " ").trim(), params });
      if (/FROM projection_heads/i.test(sql)) return { rows: townSha ? [{ sha: townSha }] : [] };
      if (/FROM escrow_projection/i.test(sql)) return { rows };
      return { rows: [] };
    },
  };
}

const stake = (qs, pool) => world2Serve("/world2/stake", new URLSearchParams(qs), { p: pool });

// ═════════════════════════════════════════════════════════════════════════════
// 1 · THE ARITHMETIC IS THE TOWN'S
// ═════════════════════════════════════════════════════════════════════════════

test("escrow is Σn, households counts the mark's OWN household too, and k is paid per EXTERNAL household", () => {
  const a = stakeAnswerFrom(ROWS, { mark: MARK, townSha: TOWN_SHA });
  assert.equal(a.escrow, 16, "Σn over the open positions");
  assert.equal(a.stamps, a.escrow, "`stamps` is raw own escrow — world-stake.mjs's own word");
  // deriveWorldMarkWeights: `households: group.households.size` — every unique
  // household with escrow here, the mark's own included. The town's comment
  // refuses the narrower count in place: "Reporting less must never mean
  // counting wrong."
  assert.equal(a.breadth.households, 3);
  assert.equal(a.breadth.external_households, 2, "gh:67605380 and solo:ghost; gh:1 is the mark's own");
  assert.equal(a.ledger_weight, 16 + K * 2, "escrow + k × households_external");
  assert.equal(a.breadth.bonus, K * 2);
  assert.equal(a.breadth.k, K);
});

test("a SECOND holder from a household already counted adds escrow and no bonus", () => {
  // Delete `amber` — same household as `wright`, which already drew k — and the
  // bonus must not move. This is the case a fixture with one holder per
  // household cannot express, and `firstForHousehold` is the line it guards.
  const without = ROWS.filter((r) => r.holder !== "amber");
  const a = stakeAnswerFrom(without, { mark: MARK, townSha: TOWN_SHA });
  assert.equal(a.breadth.bonus, K * 2, "the bonus is per household, not per holder");
  assert.equal(a.escrow, 14, "the escrow moves by amber's 2 and only by that");
});

test("the twin's ledger_weight equals what stakesFromStore folds — two readers, one table", async () => {
  // `stakesFromStore` is `fold-input.mjs`'s reader of the SAME projection,
  // written for the crossing's fold and held to the town by
  // `world2-fold-input.test.mjs`. Summing its per-position `weight` over this
  // mark must equal the door's `ledger_weight`. A function agreeing with itself
  // proves nothing; two independently-written readers agreeing is a check.
  const client = { query: async () => ({ rows: ROWS }) };
  const folded = await stakesFromStore(client, { townSha: TOWN_SHA });
  const summed = folded.filter((r) => r.mark === MARK).reduce((n, r) => n + r.weight, 0);
  assert.equal(stakeAnswerFrom(ROWS, { mark: MARK, townSha: TOWN_SHA }).ledger_weight, summed);
});

test("holders descend by stamps, and the tie is broken by handle rather than by the planner", () => {
  const tied = [pos("zeta", "solo:z", 3), pos("alfa", "solo:a", 3), pos("mid", "solo:m", 9)];
  const a = stakeAnswerFrom(tied, { mark: MARK, townSha: TOWN_SHA });
  assert.deepEqual(a.holders.map((h) => h.handle), ["mid", "alfa", "zeta"]);
});

// ═════════════════════════════════════════════════════════════════════════════
// 2 · THE DOOR READ THE STORE — the leg an equality cannot supply
// ═════════════════════════════════════════════════════════════════════════════

test("THE PLANTED ROW: a holder that exists only in the store reaches the answer", async () => {
  const p = fixturePool();
  const { code, body } = await stake(`mark=${MARK}`, p);
  assert.equal(code, 200);
  const seen = body.holders.some((h) => h.handle === "only-in-the-store");
  assert.ok(seen, "the twin did not see `only-in-the-store` — it is reading something that is not escrow_projection");
  assert.equal(body.holders.find((h) => h.handle === "only-in-the-store").stamps, 7);
});

test("THE QUERY COUNT: the door asked escrow_projection for THIS mark at the pinned sha", async () => {
  const p = fixturePool();
  await stake(`mark=${MARK}`, p);
  const escrowAsks = p.asked.filter((a) => /FROM escrow_projection/i.test(a.sql));
  assert.equal(escrowAsks.length, 1, "exactly one escrow read — a door that read the tree would ask none");
  assert.deepEqual(escrowAsks[0].params, [TOWN_SHA, MARK],
    "the read is pinned to the ingested town sha and scoped to the mark asked about");
  assert.equal(escrowAsks[0].sql, STAKE_ROWS_SQL.replace(/\s+/g, " ").trim());
});

test("the planted row moves the NUMBERS, not only the list", async () => {
  // A door could carry the holder through and still compute off something else.
  // Removing the planted row must move escrow by 7 and the bonus by one k.
  const withGhost = await stake(`mark=${MARK}`, fixturePool());
  const without = await stake(`mark=${MARK}`, fixturePool({ rows: ROWS.filter((r) => r.holder !== "only-in-the-store") }));
  assert.equal(withGhost.body.escrow - without.body.escrow, 7);
  assert.equal(withGhost.body.breadth.bonus - without.body.breadth.bonus, K);
});

// ═════════════════════════════════════════════════════════════════════════════
// 3 · THE REFUSALS, AND THE ABSENCES THAT ARE NOT THE SAME ABSENCE
// ═════════════════════════════════════════════════════════════════════════════

test("no mark bounces 422 rather than answering about the whole town", async () => {
  const { code, body } = await stake("", fixturePool());
  assert.equal(code, 422);
  assert.equal(body.defect, "which mark?");
});

test("an UN-INGESTED town refuses 503 — it cannot tell an unstaked mark from an unread store", async () => {
  const { code, body } = await stake(`mark=${MARK}`, fixturePool({ townSha: null }));
  assert.equal(code, 503);
  assert.match(body.hint, /no 'latest'/);
});

test("a mark nobody stakes answers ZERO, and its k has no source to name", async () => {
  const { code, body } = await stake("mark=nobody/cares", fixturePool({ rows: [] }));
  assert.equal(code, 200);
  assert.equal(body.escrow, 0);
  assert.deepEqual(body.holders, []);
  // `markEscrow` is `state.escrow.get(mark) ?? 0`, so the NUMBER is zero at both
  // doors. The dial is a different matter: an empty row set names no k, and
  // reporting the ruled default as a pinned one is the thing escrow-ingest
  // refuses one tier up.
  assert.equal(body.breadth.k, null);
  assert.equal(body.breadth.bonus, 0);
});

test("A TORN INGEST REFUSES rather than folding with whichever k came back first", async () => {
  const torn = [pos("wright", "gh:67605380", 3), { ...pos("amber", "solo:a", 2), weight_k: 9 }];
  const { code, body } = await stake(`mark=${MARK}`, fixturePool({ rows: torn }));
  assert.equal(code, 503);
  assert.match(body.hint, /torn ingest/);
});

test("the two tree-only fields are named on the answer, and the note is 1.0's own sentence", async () => {
  const { body } = await stake(`mark=${MARK}`, fixturePool());
  assert.equal(body._note, STAKE_NOTE);
  assert.ok(body.tree_only.retirement, "an absent field that says nothing is an absent field nobody can act on");
  assert.ok(body.tree_only.proposed);
  assert.equal(body.escrow_at_town_sha, TOWN_SHA, "the freshness stamp names its own source");
});
