// part2-words.test.mjs — the words a resident's agent read wrong in the playground's QA of LOGOS v2
// part 2 (Starstory docs/2026-10-18/w43-ship/PART2-MCP-QA.md § Reads confusing to a resident's agent).
//
// Each one was true of an older door and false of part 2's:
//   · a failed give by kind hinted `drop { thing: "units" }`, and a set-down by kind answers 501 (G8, w44);
//   · `refill { chest: … }` answered "chests and candy aren't open in town yet" beside a candy refill that
//     works: #499's label doors are dark (Darko 2026-10-17 10:22), the kind doors are live;
//   · the v2 `can` lines said "take: Pick up a thing where you stand" and nothing named making by count,
//     taking from a holder or giving into one, so an agent reading v2 first would not find part 2.
// (The refill "(null, null)" hint is driven through the apex in kind-door-carried-holder.test.mjs.)

import test from "node:test";
import assert from "node:assert/strict";
import { armsLengthOrThrow } from "../src/world-hold.mjs";
import { CHESTS_CANDY_OFF } from "../src/chests-candy.mjs";
import { ONE_LINERS } from "../src/world-read-shape.mjs";
import { ACT_GROUPS } from "../src/world-read-v2.mjs";

const refusal = async (p) => { try { await p; return null; } catch (e) { return e; } };

test("B2 · a give by kind out of arm's length never offers a drop by kind: it offers a holder, and says the set-down is not built", async () => {
  const far = await refusal(armsLengthOrThrow({ thing: "units", to: "sb-ash", here: { x: 0, y: 0 }, actor: "darko", standpointOfOther: async () => ({ placed: true, x: 6000, y: 0 }) }));
  assert.equal(far?.code, 409);
  assert.doesNotMatch(far.hint, /do: "drop"|thing: "units"/, far.hint);
  assert.match(far.hint, /give it into a holder/);
  const unplaced = await refusal(armsLengthOrThrow({ thing: "units", to: "sb-ash", here: { x: 0, y: 0 }, actor: "darko", standpointOfOther: async () => ({ placed: false }) }));
  assert.doesNotMatch(unplaced.hint, /do: "drop"|thing: "units"/, unplaced.hint);
  // a whole thing still sets down: its hint is unchanged
  const thing = await refusal(armsLengthOrThrow({ thing: "darko/a-lamp", to: "sb-ash", here: { x: 0, y: 0 }, actor: "darko", standpointOfOther: async () => ({ placed: true, x: 6000, y: 0 }) }));
  assert.match(thing.hint, /do: "drop", args: \{ thing: "darko\/a-lamp" \}/);
});

test("I1c · the dark chest-and-label door says what is closed and where candy works now, not that candy isn't open", () => {
  assert.doesNotMatch(CHESTS_CANDY_OFF.defect, /candy aren't open/);
  assert.match(CHESTS_CANDY_OFF.defect, /chest/);
  assert.match(CHESTS_CANDY_OFF.hint, /by kind/);
  assert.match(CHESTS_CANDY_OFF.hint, /thing:/, "a holder is named with thing:, to: or from:");
  assert.match(CHESTS_CANDY_OFF.hint, /nothing was changed/);
});

test("v2 · the carry lines name part 2's acts: making by count, taking from a holder, giving into one, consume and refill", () => {
  assert.match(ONE_LINERS["leave-mark"].says, /by kind/, ONE_LINERS["leave-mark"].says);
  assert.ok(ONE_LINERS["leave-mark"].fields.some((f) => /count/.test(f)) && ONE_LINERS["leave-mark"].fields.some((f) => /\bto\b/.test(f)));
  assert.match(ONE_LINERS.take.says, /holder/, ONE_LINERS.take.says);
  assert.ok(ONE_LINERS.take.fields.some((f) => /from/.test(f)) && ONE_LINERS.take.fields.some((f) => /kind/.test(f)));
  assert.match(ONE_LINERS.give.says, /holder/, ONE_LINERS.give.says);
  assert.ok(ONE_LINERS.give.fields.some((f) => /kind/.test(f)));
  assert.ok(ONE_LINERS.consume, "consume has its line");
  assert.ok(ONE_LINERS.refill, "refill has its line");
  assert.match(ONE_LINERS.refill.says, /made/, "refill is the maker's");
  for (const v of ["consume", "refill"]) assert.ok(ACT_GROUPS.carry.includes(v), `${v} rides with the carry acts, not under more`);
});

test("review-616 nit · the dark door's hint gives consume no holder: it uses up a kind you carry", () => {
  assert.doesNotMatch(CHESTS_CANDY_OFF.hint, /consume names? a kind and a holder/);
  assert.match(CHESTS_CANDY_OFF.hint, /consume names the kind you carry/);
});

test("review-616 SF2 · a class node's grant says \"or carry it\" only of a thing, with the article its name takes", async () => {
  const { elsewhereHint } = await import("../src/world-apex.mjs");
  const tree = { "halloween-candy-bowl": "thing", thing: "sited", sited: "mark", arena: "portal-ground", "portal-ground": "sited", mark: "postmark-node" };
  const extendsOf = (c) => tree[c] ?? null;
  const at = { x: null, y: null };
  const bowl = elsewhereHint([{ mark: "the-town/halloween-candy-bowl", class: "halloween-candy-bowl", at, who: "maker" }], { extendsOf });
  assert.equal(bowl, "It is a halloween-candy-bowl's own action, for its maker: stand within a halloween-candy-bowl's footprint, or carry it, and it appears.");
  const arena = elsewhereHint([{ mark: "the-town/arena", class: "arena", at }], { extendsOf });
  assert.equal(arena, "It is an arena's own action: stand within an arena's footprint, and it appears.", "an arena is no thing: nobody carries it, and it takes an");
  assert.doesNotMatch(elsewhereHint([{ mark: "the-town/halloween-candy-bowl", class: "halloween-candy-bowl", at }]), /carry/, "with the class tree unread, nothing is promised to carry");
  assert.match(elsewhereHint([{ mark: "x/a-lamp-post", at: { x: 3, y: 4 } }], { extendsOf }), /^It is afforded at x\/a-lamp-post \(3, 4\) — walk there and it appears\.$/, "a placed grant keeps its walk");
});
