// stamps-on-an-amend-adds.test.mjs: `stamps` on an amend ADDS to the stake,
// the field says so, and the publishing note counts the escrow the call leaves
// (postmark#3593, kogane).
//
// kogane passed `stamps: 1` meaning "keep this mark at the one stamp it has".
// Balance 8 -> 7, escrow 1 -> 2. The field read "stake this many", and the same
// receipt's publishing note said "✦1 already stand in escrow behind it",
// counted against the escrow it found, not the ✦2 the call left. Darko ruled
// 2026-10-09: adding is by design; the field says it adds ("adds this many to
// your stake"), and the note counts the escrow the call would leave.
//
// THE FLIP: drop `staked`/`escrow_after` from putForwardVerdict, or the staked
// branch of amendmentPublishNote, and kogane's case below reds with the old
// "✦1 already stand" sentence. Put back "stake this many" and the field test
// reds.
//
//   node --test test/stamps-on-an-amend-adds.test.mjs

import test from "node:test";
import assert from "node:assert/strict";

process.env.WORLD_STORE_DB ??= "/nonexistent/postmark-no-world-store.db";

const { putForwardVerdict, amendmentPublishNote, amendmentStakeBounceNote, WORLD_TOOLS } = await import("../src/world.mjs");

const COMMONS = 1;
const OWN_GROUND = 0;

test("kogane's case: stamps: 1 on a mark holding ✦1 leaves ✦2, and the note says ✦2", () => {
  const v = putForwardVerdict({ staking: true, stamps: 1, amending: true, escrowBehind: 1, groundMin: COMMONS });
  assert.equal(v.put_forward, true);
  assert.equal(v.escrow_behind, 1, "what was found is still reported as found");
  assert.equal(v.staked, 1);
  assert.equal(v.escrow_after, 2, "stamps: adds to the stake; it does not set it");
  const note = amendmentPublishNote(v);
  assert.match(note, /^✦2 will stand in escrow behind it after this act: ✦1 already there and ✦1 added now/);
  assert.match(note, /stamps: adds to the stake and does not set it/);
  assert.doesNotMatch(note, /^✦1 already stand/, "the old note counted the escrow it found");
});

test("a staked amend on a mark with nothing behind it counts only what this act adds", () => {
  const v = putForwardVerdict({ staking: true, stamps: 2, amending: true, escrowBehind: 0, groundMin: COMMONS });
  assert.equal(v.escrow_after, 2);
  const note = amendmentPublishNote(v);
  assert.match(note, /^✦2 will stand in escrow behind it after this act, all of it added now\./);
  assert.doesNotMatch(note, /own household's ground/,
    "a commons amend carried by its own stake is not told it stands on its own ground");
});

test("an amend with no stamps is unchanged: the escrow it found is the escrow it leaves", () => {
  const v = putForwardVerdict({ staking: false, amending: true, escrowBehind: 3, groundMin: COMMONS });
  assert.equal(v.staked, 0);
  assert.equal(v.escrow_after, 3);
  assert.equal(amendmentPublishNote(v), "✦3 already stand in escrow behind it — the amendment publishes at the next crossing.");
  const own = putForwardVerdict({ staking: true, stamps: 0, amending: true, escrowBehind: 0, groundMin: OWN_GROUND });
  assert.match(amendmentPublishNote(own), /own household's ground/, "stamps: 0 on own ground stakes nothing and says so as before");
});

test("a held draft still gets no note, staked or not", () => {
  for (const stamps of [0, 1, 2]) {
    const v = putForwardVerdict({ staking: true, stamps, amending: true, escrowBehind: 0, groundMin: 3 });
    if (!v.put_forward) assert.equal(amendmentPublishNote(v), null);
  }
});

test("a stake that bounced after the mark stood: the note falls back to the escrow found", () => {
  const v = putForwardVerdict({ staking: true, stamps: 1, amending: true, escrowBehind: 1, groundMin: COMMONS });
  assert.equal(amendmentStakeBounceNote(v), "this act's stake did not land (see stake_bounce), so ✦1 stand in escrow behind it, as before.");
  const none = putForwardVerdict({ staking: true, stamps: 2, amending: true, escrowBehind: 0, groundMin: COMMONS });
  assert.equal(amendmentStakeBounceNote(none), "this act's stake did not land (see stake_bounce), so no escrow stands behind it.");
  assert.equal(amendmentStakeBounceNote(putForwardVerdict({ amending: true, escrowBehind: 2, groundMin: COMMONS })), null,
    "nothing staked, nothing to take back");
  assert.equal(amendmentStakeBounceNote(null), null);
});

test("the stamps field says it adds, and still says a stake is what publishes a new mark", () => {
  const d = WORLD_TOOLS.find((t) => t.name === "world_leave_mark").inputSchema.properties.stamps.description;
  assert.match(d, /^adds this many of your ✦ to your stake on the mark, in the same act\. It adds and never sets/);
  assert.match(d, /stamps: 1 on a mark with ✦1 already behind it leaves ✦2/);
  assert.match(d, /On a new mark, the stake IS WHAT PUBLISHES IT/);
  assert.doesNotMatch(d, /stake this many/);
});
