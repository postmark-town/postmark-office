// drop-stakes-on-commons.test.mjs — A DROP OFF THE MAKER'S GROUND STAKES 1✦ (POS-688 D4 step 3).
//
//   node --test test/drop-stakes-on-commons.test.mjs
//
// Darko, 2026-10-19 09:27: "dropping a held thing on commons ground stakes 1
// stamp from the dropper onto the thing, the same as leave-mark's 'elsewhere you
// stake 1✦'. A drop on the dropper's own ground is free." The door asks
// leave-mark's own amendment verdict (`dropStakeVerdict`: the ground's minimum,
// less the stamps already behind the thing), leave-mark's purse, terms block and
// stake door. These are the two halves the door calls, with each collaborator
// handed in; the real door is driven in kind-door-carried-holder.test.mjs (D4
// step 3 · THE DOOR), and the settlement's half in the world's
// settlement-sweep.test.mjs (a backed commons drop stands; unbacked, it leaves).

import test from "node:test";
import assert from "node:assert/strict";

import { dropStakeTerms, stakeTheDrop, DROP_STAKE } from "../src/world-hold.mjs";

const CONE = "berthillon/a-cone";
const STOOD = { x: 2000, y: 2000 };

function deps({ need = 1, liquid = 3, unread = null } = {}) {
  const calls = { verdict: [], held: [], block: [] };
  return {
    calls,
    verdict: async (a) => { calls.verdict.push(a); return { min: need, need, ground: null, escrow_behind: 0 }; },
    held: async (h) => { calls.held.push(h); return { liquid, staked: 0, ...(unread ? { unread } : {}) }; },
    block: async (a) => { calls.block.push(a); return { you_hold: { liquid, staked: 0 }, this_act: { stamps: Math.min(1, liquid) }, after: { liquid: liquid - 1, staked: 1 }, to_confirm: a.to_confirm }; },
    extentOf: async () => ({ w: 1, h: 1 }),
  };
}

test("the stake is ✦1, the ruled number", () => assert.equal(DROP_STAKE, 1));

test("ON THE COMMONS, WITHOUT accept: the terms name ✦1, say nothing was recorded, and give the call that accepts", async () => {
  const d = deps();
  const out = await dropStakeTerms({ thing: CONE, actor: "sb-ash", stood: STOOD }, d);
  assert.ok(out.terms, JSON.stringify(out));
  const t = out.terms;
  assert.deepEqual([t.handle, t.thing, t.recorded, t.stake], ["sb-ash", CONE, false, 1]);
  assert.match(t.terms, /^setting berthillon\/a-cone down here stakes ✦1 from you onto it\. This is not berthillon's ground/);
  assert.match(t.note, /^nothing was recorded\. Call again with accept: true to set it down and stake ✦1, or set it down on berthillon's ground, where it is free\.$/);
  assert.match(t.stamps.to_confirm, /world \{ do: "drop", args: \{ thing: "berthillon\/a-cone", accept: true \} \}/);
  assert.deepEqual(d.calls.block.map((b) => [b.handle, b.stamps]), [["sb-ash", 1]], "leave-mark's own terms block, asked for ✦1");
});

test("THE GROUND IS JUDGED FOR THE MAKER, at the dropper's spot: the settlement walks a mark's ground by its author", async () => {
  const d = deps();
  await dropStakeTerms({ thing: CONE, actor: "sb-ash", stood: STOOD }, d);
  assert.deepEqual(d.calls.verdict, [{ thing: CONE, by: "berthillon", at: STOOD, extent: { w: 1, h: 1 } }]);
});

test("ON THE COMMONS, WITH accept: true: the door is told to stake ✦1 after the drop", async () => {
  const out = await dropStakeTerms({ thing: CONE, actor: "sb-ash", stood: STOOD, accept: true }, deps());
  assert.deepEqual(out, { stake: 1 });
});

test("ON THE MAKER'S OWN GROUND (or with stamps already behind it): free, and the purse is never read", async () => {
  const d = deps({ need: 0 });
  assert.equal(await dropStakeTerms({ thing: CONE, actor: "berthillon", stood: STOOD }, d), null);
  assert.equal(await dropStakeTerms({ thing: CONE, actor: "berthillon", stood: STOOD, accept: true }, d), null);
  assert.deepEqual(d.calls.held, []);
});

test("ZERO STAMPS IS REFUSED, with or without accept, in a plain line, and nothing was recorded", async () => {
  for (const accept of [false, true]) {
    await assert.rejects(dropStakeTerms({ thing: CONE, actor: "sb-ash", stood: STOOD, accept }, deps({ liquid: 0 })), (e) => {
      assert.equal(e.code, 422);
      assert.equal(e.defect, "you hold 0 stamps, and setting berthillon/a-cone down here stakes ✦1");
      assert.match(e.hint, /a commons mark stands only with a stamp behind it; without one it would leave the world at the next settlement/);
      assert.match(e.hint, /Set it down on berthillon's ground, where it is free/);
      assert.match(e.hint, /Nothing was recorded\.$/);
      return true;
    });
  }
});

test("A PURSE THAT CANNOT BE READ is not taken as empty: the terms still answer, and the stake door decides", async () => {
  const out = await dropStakeTerms({ thing: CONE, actor: "sb-ash", stood: STOOD }, deps({ liquid: 0, unread: "no ledger here" }));
  assert.equal(out.terms.stake, 1);
});

test("NO STANDPOINT: nothing to judge here, and the drop's own path answers", async () => {
  const d = deps();
  assert.equal(await dropStakeTerms({ thing: CONE, actor: "sb-ash", stood: null }, d), null);
  assert.deepEqual(d.calls.verdict, []);
});

test("THE STAKE goes through the stake door, ✦1 on the thing in the dropper's name, and its block rides the receipt", async () => {
  const asked = [];
  const out = await stakeTheDrop({ thing: CONE, actor: "sb-ash", key: { household: "ash" } }, {
    stake: async (a, k) => { asked.push([a, k]); return { mark: CONE, stamps: { this_act: { stamps: 1 } } }; },
  });
  assert.deepEqual(asked, [[{ mark: CONE, stamps: 1, handle: "sb-ash" }, { household: "ash" }]]);
  assert.deepEqual(out.stamps, { this_act: { stamps: 1 } });
  assert.equal(out.stake_bounce, undefined);
});

test("A STAKE THAT BOUNCES never unwrites the drop: the receipt says the thing leaves at the settlement unless a stamp stands, and gives the call", async () => {
  for (const stake of [async () => ({ error: true, defect: "your balance has no stamps free to stake" }), async () => { throw new Error("ledger down"); }]) {
    const out = await stakeTheDrop({ thing: CONE, actor: "sb-ash", key: null }, { stake });
    assert.ok(out.stake_bounce.defect);
    assert.equal(out.stake_bounce.hint,
      `${CONE} is set down, but no stamp stands behind it yet, so it leaves the world at the next settlement unless one does: world { do: "stake", args: { mark: "${CONE}", stamps: 1 } }`);
  }
});
