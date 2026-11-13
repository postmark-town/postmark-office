// world-stake-tending.test.mjs — A STAKE ON A DIRTY TOWN COPY WRITES NOTHING, NOT EVEN THE DOCKET CLAIM (POS-382).
//
//   node --test test/world-stake-tending.test.mjs
//
// world { do: "stake" } is the one write that touches the record BEFORE it spawns its ledger exec: it promotes the draft onto the docket first. A refusal that came
// only from the exec (clone-fresh.mjs § freshenClone) would leave that claim standing with nothing behind it, and "nothing was written" would be false. So:
//   1. the door looks at the clone first (tendingBefore) and answers the named 503 before it promotes anything or asks the ledger;
//   2. if a writer slips in after the look and the exec refuses, the promotion this act made is taken back by this act;
//   3. a clean clone is untouched by all of it.

import { registerHooks } from "node:module";
const FAKE_PEN = new URL("./helpers/fake-pen.mjs", import.meta.url).href;
registerHooks({ resolve(spec, ctx, next) { if (spec === "pg") return { url: FAKE_PEN, shortCircuit: true }; return next(spec, ctx); } });

import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";

const unflip = () => { delete process.env.W2_PEN; delete process.env.WORLD2_PG; delete process.env.WORLD2_PG_URL; delete process.env.WORLD2_CANDLE; };
const candleOn = () => { process.env.WORLD2_PG = "1"; process.env.WORLD2_PG_URL = "postgres://fake/pen"; process.env.WORLD2_CANDLE = "1"; };
unflip();
after(unflip);
beforeEach(() => candleOn());

const { resetStore } = await import("./helpers/fake-pen.mjs");
const { worldStakeViaOffice } = await import("../src/world-stake.mjs");
const { needsTendingError, TENDING_DEFECT } = await import("../src/clone-fresh.mjs");

const W = 211;
const MARK = "mari/first-night-garland";
const KEY = { handles: new Set(["mari"]), household: "mari" };
const NAMED = "the office's town copy needs tending; nothing was written";

const store = () => {
  const s = resetStore({ identities: { mari: "gh:9000009" } });
  s.windows = [{ id: W, status: "open" }];
  s.marks = [{ slug: MARK, status: "standing", retired_window: null }];
  s.claims.push({ id: 1, window_id: W, class: "mark", claimant: "mari", household: "gh:9000009", slug: MARK, geometry: { slug: MARK }, status: "pending", stake: 1, data: {}, submitted_at: "now" });
  s.nextClaimId = 2;
  return s;
};
function door({ tending = () => null, ledger } = {}) {
  const calls = { promote: 0, ledger: 0 };
  return { calls, deps: {
    exists: async () => ({ known: true, exists: true, record: null }),
    left: async () => null,
    standing: async () => ({ known: true, found: true, status: "standing", retired: false }),
    promote: async () => { calls.promote += 1; return { promoted: true, window: W }; },
    ground: async () => ({ known: true, ground: "own" }),
    held: async () => ({ liquid: 48, staked: 5 }),
    ledger: async (p) => { calls.ledger += 1; return ledger ? ledger(p) : { applied: p.n, requested: p.n, clipped: false, balance_before: 48 }; },
    tending,
  } };
}

test("1 · the door looks first: a dirty copy is the named 503 before the promotion and before the ledger", async () => {
  const s = store();
  const { deps, calls } = door({ tending: () => needsTendingError(["WHITE_PAGES/stamp-ledger.md"]) });
  const out = await worldStakeViaOffice({ mark: MARK, stamps: 1 }, KEY, deps);
  assert.deepEqual([out.error, out.code, out.defect], ["bounce", 503, NAMED]);
  assert.deepEqual(calls, { promote: 0, ledger: 0 }, "nothing was asked of the record or the ledger");
  assert.equal(s.claims.length, 1, "the docket is as it was");
  assert.doesNotMatch(JSON.stringify(out), /stamp-ledger/, "the dirt is not in the answer");
});

test("2 · a writer slips in after the look: the exec refuses, and the promotion THIS act made is taken back", async () => {
  const s = store();
  const { deps, calls } = door({ ledger: async () => ({ error: "bounce", code: 503, defect: TENDING_DEFECT, hint: "tended" }) });
  const out = await worldStakeViaOffice({ mark: MARK, stamps: 1 }, KEY, deps);
  assert.deepEqual([out.code, out.defect], [503, NAMED]);
  assert.deepEqual(calls, { promote: 1, ledger: 1 });
  assert.ok(!s.claims.some((c) => c.status === "pending" && c.slug === MARK), "no pending claim is left on the docket with nothing behind it");
  assert.equal(s.claims.find((c) => c.slug === MARK).status, "retracted", "retracted, the row kept as every retraction's is");
});

test("3 · a clean copy: the stake goes through as it always did", async () => {
  const s = store();
  const { deps, calls } = door();
  const out = await worldStakeViaOffice({ mark: MARK, stamps: 1 }, KEY, deps);
  assert.ok(!out.error, JSON.stringify(out));
  assert.deepEqual(calls, { promote: 1, ledger: 1 });
  assert.ok(s.claims.some((c) => c.slug === MARK && c.status === "pending"), "the claim stands");
});
