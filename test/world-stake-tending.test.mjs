// world-stake-tending.test.mjs — A STAKE ON A DIRTY TOWN COPY WRITES NOTHING, NOT EVEN THE DOCKET CLAIM (POS-382).
//
//   node --test test/world-stake-tending.test.mjs
//
// world { do: "stake" } is the one write that touches the record BEFORE it spawns its ledger exec: it promotes the draft onto the docket first, in one transaction that
// replaces the author's earlier pending claim and releases the draft's act. Nothing can undo that, and nothing here tries (Darko, 2026-11-13: "Honest partial answer").
//   1. the door looks at the clone first (tendingBefore, with the execs' bounded wait) and answers the named 503 before it promotes anything or asks the ledger;
//   2. the one race left (a writer slips in after the look, the exec refuses): the REAL promotion stands as it left the record, the answer says the mark was put forward and
//      this stake moved no new stamps, and it never claims nothing was written or what stands behind the mark;
//   3. a stake that promoted nothing keeps the full no-write promise; a clean copy is untouched.

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { startStore } from "./helpers/embedded-store.mjs";

// A REAL store: the promotion is the real one (the fake pen does not model its draft read), so the state a refused stake leaves is the state the record really has.
const store = await startStore({ db: "world_stake_tending" });
after(async () => { await store.stop(); });
process.env.WORLD2_PG = "1";
process.env.WORLD2_PG_URL = store.url("office_api");
process.env.WORLD2_CANDLE = "1";
after(() => { delete process.env.WORLD2_PG; delete process.env.WORLD2_PG_URL; delete process.env.WORLD2_CANDLE; });

const { worldStakeViaOffice } = await import("../src/world-stake.mjs");
const { needsTendingError, TENDING_DEFECT } = await import("../src/clone-fresh.mjs");

const W = 211;
const MARK = "mari/first-night-garland";
const KEY = { handles: new Set(["mari"]), household: "mari" };
const NAMED = "the office's town copy needs tending; nothing was written";

// The earlier pending claim (✦1, backing the mark) and a newer DRAFT of the same mark. Putting the draft forward replaces the earlier claim ("replaced") and makes the draft
// pending, in one transaction; that is the state the refused stake must leave exactly as it stands.
const HH = "hh:mari";
async function seed({ draft = true } = {}) {
  const c = await store.connect("world2_owner");
  try {
    await c.query("TRUNCATE escrow_projection, claims, marks, windows, households, household_pins CASCADE");
    await c.query("INSERT INTO windows (id, opens_at, closes_at, status, cleared_at) VALUES ($1, now(), now() + interval '12 hours', 'open', null)", [W]);
    await c.query("INSERT INTO households (slug, ord, name, residents, since, declared_by) VALUES ('mari', 0, 'mari', ARRAY['mari'], '2026-08-01', 'mari')");
    await c.query("INSERT INTO household_pins (handle, login, gh_id, pinned) VALUES ('mari', 'mari', 9000009, '2026-08-01')");
    const add = (status, stake, body) => c.query(
      `INSERT INTO claims (window_id, class, claimant, household, status, body, geometry, bbox, stake, data, slug)
       VALUES ($1, 'sited', 'mari', $2, $3, $6, '{"at":{"x":1,"y":1},"slug":"mari/first-night-garland"}', '(1,1),(0,0)'::box, $4, '{}', $5)`, [W, HH, status, stake, MARK, body]);
    await add("pending", 1, "earlier.");
    if (draft) await add("draft", 0, "newer.");
  } finally { await c.end(); }
}
const rowsOf = async () => {
  const c = await store.connect("world2_owner");
  try { return (await c.query("SELECT body, status, stake::int AS stake, refusal_check FROM claims ORDER BY body")).rows; }
  finally { await c.end(); }
};
function door({ tending = async () => null, ledger } = {}) {
  const calls = { ledger: 0 };
  return { calls, deps: {
    exists: async () => ({ known: true, exists: true, record: null }),
    left: async () => null,
    standing: async () => ({ known: true, found: true, status: "standing", retired: false }),
    ground: async () => ({ known: true, ground: "own" }),
    held: async () => ({ liquid: 48, staked: 5 }),
    ledger: async (p) => { calls.ledger += 1; return ledger ? ledger(p) : { applied: p.n, requested: p.n, clipped: false, balance_before: 48 }; },
    tending,
  } };
}
const REFUSED_BY_EXEC = async () => ({ error: "bounce", code: 503, defect: TENDING_DEFECT, hint: "tended" });

test("1 · the door looks first: a dirty copy is the named 503 before the promotion and before the ledger, and the docket is as it was", async () => {
  await seed();
  const before = await rowsOf();
  const { deps, calls } = door({ tending: async () => needsTendingError(["WHITE_PAGES/stamp-ledger.md"], { waitedMs: 6000 }) });
  const out = await worldStakeViaOffice({ mark: MARK, stamps: 1 }, KEY, deps);
  assert.deepEqual([out.error, out.code, out.defect], ["bounce", 503, NAMED]);
  assert.equal(calls.ledger, 0, "nothing was asked of the ledger");
  assert.deepEqual(await rowsOf(), before, "the draft is still a draft and the earlier claim still pending: the real promotion never ran");
  assert.doesNotMatch(JSON.stringify(out), /stamp-ledger/, "the dirt is not in the answer");
  assert.match(out.hint, /waited 6\.0 s/, "and it says it waited");
});

test("2 · THE ONE RACE (ruled, \"Honest partial answer\"): the exec refuses after the promotion; the promotion STANDS, nothing is taken back, and the answer says so", async () => {
  await seed();
  await worldStakeViaOffice({ mark: MARK, stamps: 1 }, KEY, door().deps);   // the same stake, the ledger answering: what the real promotion leaves
  const standing = await rowsOf();
  assert.deepEqual(standing.map((c) => [c.body, c.status]), [["earlier.", "retracted"], ["newer.", "pending"]], "the real promotion replaced the earlier claim and put the draft forward");

  await seed();
  const { deps, calls } = door({ ledger: REFUSED_BY_EXEC });
  const out = await worldStakeViaOffice({ mark: MARK, stamps: 1 }, KEY, deps);
  assert.equal(calls.ledger, 1);
  assert.deepEqual(await rowsOf(), standing, "exactly the promotion's own state: no retraction of the promoted claim, none of anyone's earlier claim beyond what the promotion itself did");
  assert.deepEqual([out.error, out.code], ["bounce", 503]);
  assert.match(out.defect, /needs tending; "mari\/first-night-garland" was put forward, but this stake moved no new stamps/);
  assert.match(out.hint, /took no stamps: any backing it already had is untouched/);
  assert.match(out.hint, /Try the same stake again/);
  assert.doesNotMatch(JSON.stringify(out), /nothing was written|held: 0|nothing behind|nothing is behind/i, "it does not claim nothing was written, and never says the mark has no backing");
  assert.equal(out.held, undefined);
});

test("3 · a stake that promoted nothing (an ordinary stake on a public mark) and is refused by the exec keeps the full no-write promise", async () => {
  await seed({ draft: false });   // no draft: the promotion has nothing to put forward
  const before = await rowsOf();
  const { deps } = door({ ledger: REFUSED_BY_EXEC });
  const out = await worldStakeViaOffice({ mark: MARK, stamps: 1 }, KEY, deps);
  assert.deepEqual([out.code, out.defect], [503, NAMED], "the exec's own refusal, unchanged");
  assert.deepEqual(await rowsOf(), before);
});

test("4 · a clean copy: the stake goes through as it always did", async () => {
  await seed();
  const { deps, calls } = door();
  const out = await worldStakeViaOffice({ mark: MARK, stamps: 1 }, KEY, deps);
  assert.ok(!out.error, JSON.stringify(out));
  assert.equal(calls.ledger, 1);
  assert.equal((await rowsOf()).find((c) => c.body === "newer.")?.status, "pending");
});
