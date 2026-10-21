// ownership.test.mjs — MAKER AND OWNER; THE THREE WORDS (POS-688, Darko
// 2026-10-19 16:39–16:45; D-O1..D-O6 at 17:14). The fold every reader calls.
//
//   node --test test/ownership.test.mjs
//
// THE FLIPS (each red on its guard):
//   a take moving the owner (borrowing as giving)          → 2 reds
//   a give by a borrower passing ownership                 → 3 reds
//   welcomed not final (a later word reaching back)        → 4 reds
//   a word from outside the owner's house counted          → 5 reds
//   an earlier outing's word reaching a later outing       → 6 reds
//   the open-holder take ignoring payload.owns             → 7 reds

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { OWNED_BY, ownedBy, foldOwners, ownershipEvents, ownershipOf, latestOutingAct, awaitsWord, opposedNow, answeredAct } from "../src/ownership.mjs";
import { worldClone } from "./fixture-paths.mjs";

const CONE = "berthillon/a-cone";
// berthillon and berthillon-jr are one household; sb-ash and sb-cleo are each their own
const HOUSES = { berthillon: "hh:b", "berthillon-jr": "hh:b", "sb-ash": "hh:ash", "sb-cleo": "hh:cleo" };
const houseOf = (h) => HOUSES[h] ?? `solo:${h}`;

let seq = 100;
const hold = (action, actor, payload = {}) => ({ seq: ++seq, actor, action, object: CONE, payload: { thing: CONE, ...payload } });
const take = (actor, extra = {}) => hold("take", actor, { holder: actor, ...extra });
const give = (actor, to) => hold("give", actor, { holder: to });
const drop = (actor) => hold("drop", actor, { holder: null });
const word = (actor, stance, act) => ({ seq: ++seq, actor, object: CONE, payload: { on: CONE, stance, answers: act.payload.holder === null ? "set-down" : "take", act: { act_id: String(act.seq), by: act.actor } } });
const fold = (holding, stances = []) => ownershipOf(foldOwners(ownershipEvents(holding, stances), { houseOf }), CONE);

test("0. one name, the world's: owned_by", () => {
  assert.equal(OWNED_BY, "owned_by");
  assert.equal(ownedBy({ owned_by: " sb-ash " }), "sb-ash");
  assert.equal(ownedBy({}), null);
  const WORLD = worldClone();
  const kind = WORLD && join(WORLD, "tools", "mark-kind.mjs");
  if (kind && existsSync(kind) && readFileSync(kind, "utf8").includes("OWNED_BY"))
    assert.match(readFileSync(kind, "utf8"), /export const OWNED_BY = "owned_by";/, "the world's name is the same");
});

test("1. the owner starts as the maker, and a record that says nothing leaves it there", () => {
  assert.deepEqual(fold([]), { owner: "berthillon", outing: null });
});

test("2. BORROWING IS JUST TAKING: a take moves the holding, never the owner, and opens an outing awaiting the owner's word", () => {
  const t = take("sb-ash");
  const st = fold([t]);
  assert.equal(st.owner, "berthillon");
  assert.equal(latestOutingAct(st).act_id, String(t.seq));
  assert.equal(latestOutingAct(st).kind, "take");
  assert.equal(awaitsWord(st), true, "silence is borrowed, and the owner is asked");
});

test("3. the OWNER's give passes ownership (a housemate's counts: the grain is the household); a borrower's give moves the holding only", () => {
  assert.equal(fold([give("berthillon", "sb-ash")]).owner, "sb-ash");
  assert.equal(fold([give("berthillon-jr", "sb-ash")]).owner, "sb-ash", "the owner's household acts for the owner");
  const st = fold([take("sb-ash"), give("sb-ash", "sb-cleo")]);
  assert.equal(st.owner, "berthillon", "sb-ash borrowed it; giving it on lends it on");
  assert.equal(awaitsWord(st), true, "still out, still the owner's to answer");
  assert.equal(fold([take("sb-ash"), give("sb-ash", "berthillon")]).outing, null, "given back home: the outing ends");
});

test("4. WELCOMED IS FINAL: the one whose take it answered owns it, and the old owner's later words reach nothing", () => {
  const t = take("sb-ash");
  const st = fold([t], [word("berthillon", "welcomed", t), word("berthillon", "opposed", t)]);
  assert.equal(st.owner, "sb-ash");
  assert.equal(st.outing, null);
  const d = drop("sb-cleo");
  assert.equal(fold([d], [word("berthillon", "welcomed", d)]).owner, "sb-cleo", "welcomed on a set-down is yours too (D-O3)");
});

test("5. only the owner's house speaks: a word from anyone else changes nothing", () => {
  const t = take("sb-ash");
  const st = fold([t], [word("sb-cleo", "opposed", t), word("sb-ash", "welcomed", t)]);
  assert.equal(st.owner, "berthillon");
  assert.equal(awaitsWord(st), true);
  assert.equal(opposedNow(fold([t], [word("berthillon-jr", "opposed", t)])), true, "a housemate speaks for the house");
});

test("6. NEUTRAL AND OPPOSED ARE REVISABLE, the latest wins, across the outing's acts; an earlier outing's word never reaches a later one", () => {
  const t1 = take("sb-ash");
  const d = drop("sb-ash");
  const t2 = take("sb-cleo");
  const stances = [word("berthillon", "opposed", t1), word("berthillon", "neutral", d)];
  const st = fold([t1, d, t2], stances);
  assert.equal(st.outing.word.stance, "neutral", "the latest word, on another act of the same outing");
  assert.equal(opposedNow(st), false);
  assert.equal(awaitsWord(st), false, "a declared neutral clears awaiting");
  assert.equal(opposedNow(fold([t1, d, t2], [...stances, word("berthillon", "opposed", t2)])), true, "and opposed again");
  // home and out again: a new outing, and the old word is gone
  const home = take("berthillon");
  const t3 = take("sb-cleo");
  const later = fold([t1, home, t3], [word("berthillon", "opposed", t1)]);
  assert.equal(opposedNow(later), false);
  assert.equal(awaitsWord(later), true);
  assert.equal(fold([t1, t3], [word("berthillon", "opposed", t1)]).outing.acts.length, 2, "without a homecoming it is one outing");
});

test("7. OUT OF AN OPEN HOLDER THE OWNER PUT IT IN: the taker owns it (the door decides, payload.owns); otherwise a take from a holder is a borrow", () => {
  assert.equal(fold([give("berthillon", "berthillon/the-bowl"), take("sb-ash", { previous_holder: "berthillon/the-bowl", owns: true })]).owner, "sb-ash");
  const st = fold([take("sb-ash"), give("sb-ash", "sb-ash/a-bag"), take("sb-cleo", { previous_holder: "sb-ash/a-bag" })]);
  assert.equal(st.owner, "berthillon", "a borrower's bag gives nothing away");
});

test("8. the town's return closes the outing, and a word on a closed outing reaches nothing", () => {
  const t = take("sb-ash");
  const back = hold("give", "the-town", { holder: "berthillon", returned: { act: String(t.seq), stance_act: "1" } });
  const st = fold([t, back], [word("berthillon", "opposed", t)]);
  assert.equal(st.outing, null);
  assert.equal(st.owner, "berthillon");
});

test("9. the events: units and frozen-era rows are not ownership; a stance with no act answers nothing", () => {
  const ev = ownershipEvents([{ seq: 1, actor: "a", action: "units:make", object: "a/x" }, { seq: 2, actor: "a", action: "take", object: "a/x", payload: {} }],
    [{ id: 3, actor: "a", object: "a/x", payload: { stance: "opposed", answers: "set-down", set_down: { act_id: "2" } } }]);
  assert.deepEqual(ev.map((e) => e.seq), [2], "the POS-138 set-down stances (set_down:) are history, not words");
  assert.equal(answeredAct({ answers: "take", act: { act_id: 7, by: "x" } }).act_id, "7");
});

test("10. folding in two parts lands where one read does (the kept base and its window)", () => {
  const t = take("sb-ash"), d = drop("sb-ash"), t2 = take("sb-cleo");
  const all = ownershipEvents([t, d, t2], [word("berthillon", "opposed", t)]);
  const whole = foldOwners(all, { houseOf });
  const base = foldOwners(all.slice(0, 2), { houseOf });
  const parts = foldOwners(all.slice(2), { houseOf, state: base });
  assert.deepEqual(parts.get(CONE), whole.get(CONE));
  assert.equal(base.get(CONE).outing.acts.length, 2, "the base was not touched by the window");
});
