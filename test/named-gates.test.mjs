// named-gates.test.mjs — a gate written for one NAMED hand, or for the founder,
// asks whose hand the credential is, not which house it is in (POS-389).
//
// Every credential that resolves to a household carries the whole house in
// `key.handles`. A key in a resident's own hand (a claim, its rotation) or a
// co-signed berth is the agent's, and stands at a named gate only as the hand
// it was granted for. The human's own credential and an operator's static key
// are exactly where they were.
//
// Falsifiers: drop the `holdsHand` line from any judge, or the `agentHeld`
// test from ops/human-actor, and the matching leg goes red.

import test from "node:test";
import assert from "node:assert/strict";

import { agentHeld, handsOf, holdsHand } from "../src/named-hand.mjs";
import { isPrincipal, principalNow } from "../src/ops.mjs";
import { judgeBugHand } from "../src/bugs.mjs";
import { judgeQuestHand } from "../src/quests.mjs";
import { judgeTownHand } from "../src/town-stance.mjs";
import { callerMaySettle } from "../src/settle-join.mjs";
import { callerMayStand, callerHand } from "../src/standing-door.mjs";
import { resolveHumanActor } from "../src/human-actor.mjs";
import { callerMayGangway } from "../src/gangway-door.mjs";

const FOUNDER_ID = 1000001;
const HOUSE = ["architect", "illuminator", "mari", "registrar", "worldkeeper", "wright"];
const human = { household: "starforge", handles: new Set(HOUSE), ghId: FOUNDER_ID, ghLogin: "founder" };
const humansKey = { ...human, keyKind: "household" };
const claimOf = (handle) => ({ ...human, keyKind: "claim", heldBy: "resident", claimedHandle: handle,
  cosignedBy: { login: "founder", id: FOUNDER_ID } });
const rotatedOf = (handle) => ({ ...claimOf(handle), keyKind: "household" });
const berth = { ...human, keyKind: "berth-upgraded", cosigned: true };
const staticKey = { household: "the-town", handles: new Set(["bugcatcher"]), ghId: 301406700 };

const refusal = (fn) => { try { fn(); } catch (e) { return { code: e.code, defect: e.defect ?? e.message, hint: e.hint }; } return null; };

test("handsOf: a resident's own key is its claimed hand; a berth names none; the human's and a static key list theirs", () => {
  assert.deepEqual([...handsOf(claimOf("mari"))], ["mari"]);
  assert.deepEqual([...handsOf(rotatedOf("registrar"))], ["registrar"]);
  assert.deepEqual([...handsOf(berth)], []);
  assert.deepEqual([...handsOf(human)], HOUSE);
  assert.deepEqual([...handsOf(humansKey)], HOUSE);
  assert.deepEqual([...handsOf(staticKey)], ["bugcatcher"]);
  assert.deepEqual([...handsOf({ ...claimOf("stranger") })], [], "a claimed hand the house does not hold is no hand");
  assert.equal(holdsHand(null, "wright"), false);
  assert.equal(agentHeld(claimOf("mari")), true);
  assert.equal(agentHeld(berth), true);
  assert.equal(agentHeld(humansKey), false);
  assert.equal(agentHeld(staticKey), false);
});

test("the principal: an agent's own key carrying the founder's id is never the principal; the human's is", async () => {
  assert.equal(isPrincipal(human, FOUNDER_ID), true);
  assert.equal(isPrincipal(humansKey, FOUNDER_ID), true);
  assert.equal(isPrincipal(claimOf("mari"), FOUNDER_ID), false);
  assert.equal(isPrincipal(rotatedOf("mari"), FOUNDER_ID), false);
  assert.equal(isPrincipal(berth, FOUNDER_ID), false);
  // The spending door's read refuses before it asks the registry, so no registry is needed to prove it.
  assert.equal(await principalNow(null, claimOf("wright")), false);
  assert.equal(await principalNow(null, berth), false);
  assert.equal(await callerMayGangway(claimOf("wright")), false, "the gangway is the principal's desk too");
});

test("settle-join and standing: the Registrar's own key may; a housemate's own key may not", () => {
  assert.equal(callerMaySettle(claimOf("registrar")), true);
  assert.equal(callerMaySettle(claimOf("mari")), false);
  assert.equal(callerMaySettle(berth), false);
  assert.equal(callerMaySettle(human), true, "the founder's own key standing as either is his own hand");
  assert.equal(callerMayStand(claimOf("registrar")), true);
  assert.equal(callerHand(claimOf("registrar")), "registrar");
  assert.equal(callerMayStand(claimOf("worldkeeper")), false);
  assert.equal(callerHand(claimOf("worldkeeper")), null);
  assert.equal(callerHand(human), "registrar", "the human's key: list order, as before");
});

test("the bug, quest and town hands: a resident's own key is its own hand only", () => {
  // named
  for (const [judge, hand] of [
    [(k, h) => judgeBugHand({ handle: h }, k, { act: "advance a bug" }), "wright"],
    [(k, h) => judgeQuestHand({ handle: h }, k), "wright"],
    [(k, h) => judgeTownHand({ handle: h }, k), "worldkeeper"],
  ]) {
    const r = refusal(() => judge(claimOf("mari"), hand));
    assert.equal(r?.code, 403, JSON.stringify(r));
    assert.equal(r.defect, `"${hand}" is not this key's own hand`);
    assert.match(r.hint, /resident's own hand \(mari\)/);
    assert.equal(judge(claimOf(hand), hand), hand, "the hand's own key passes");
    assert.equal(judge(human, hand), hand, "the human's key passes, as before");
  }
  // unnamed: a resident's own key defaults to its own hand, never a housemate's
  const bug = refusal(() => judgeBugHand({}, claimOf("mari"), { act: "advance a bug" }));
  assert.equal(bug?.code, 403);
  assert.match(bug.defect, /only the town's hands/);
  assert.equal(judgeBugHand({}, claimOf("wright"), { act: "advance a bug" }), "wright");
  assert.match(refusal(() => judgeQuestHand({}, claimOf("mari")))?.defect ?? "", /only the town posts/);
  assert.match(refusal(() => judgeTownHand({}, berth))?.defect ?? "", /only the town's hands speak/);
  assert.equal(judgeBugHand({}, staticKey, { act: "advance a bug" }), "bugcatcher", "a static key's one hand, unchanged");
});

test("the human's voice: a resident's own key and a berth do not act as the human; the human's credential does", () => {
  for (const key of [claimOf("mari"), rotatedOf("wright"), berth]) {
    const r = resolveHumanActor({ action: "say", as: "human", key });
    assert.equal(r?.error, "bounce", JSON.stringify(r));
    assert.equal(r.code, 403);
    assert.equal(r.defect, "this key is an agent's own, not the household's human");
  }
  assert.equal(resolveHumanActor({ action: "say", as: "human", key: humansKey })?.kind, "human");
  assert.equal(resolveHumanActor({ action: "say", as: "human", key: human })?.kind, "human");
  assert.equal(resolveHumanActor({ action: "say", key: claimOf("mari") }), null, "acting as the resident is untouched");
});
