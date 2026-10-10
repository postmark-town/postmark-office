// named-hand.mjs — the hand a credential is FOR, as a named gate asks it (POS-389).
//
// Every credential that resolves to a household carries the WHOLE house in
// `key.handles`: the human's sign-in, the human's household key, a resident's
// own claim key and its rotation, a co-signed berth. That is right for the
// ordinary doors (a resident's own key acts at the same doors as its human's,
// oauth.mjs § claimLookup), and wrong for a gate written for one NAMED hand or
// for the founder: there the question is not "is this hand in your house" but
// "is this credential that hand's". So the named gates ask here:
//
//   · a key in a resident's own hand (`heldBy: "resident"`) is the hand it was
//     granted for, `claimedHandle`, and no other;
//   · a co-signed berth is an agent's self-mint; it names no hand here;
//   · the human's own credential (a sign-in, the household key the human
//     minted) and an operator's static key hold every handle they list. A
//     founder's key standing as a hand in his house is his own hand
//     (settle-join.mjs § WHO MAY CALL IT).
//
// Only an agent's own key is narrowed. Nothing here can widen a credential.

/** A key minted in an agent's own hand: a resident's claim or its rotation, or a co-signed berth. */
export const agentHeld = (key) => key?.heldBy === "resident" || key?.keyKind === "berth-upgraded";

/** The handles this credential may stand as at a named gate. */
export function handsOf(key) {
  const held = key?.handles ?? new Set();
  if (key?.heldBy === "resident") return key.claimedHandle && held.has(key.claimedHandle) ? new Set([key.claimedHandle]) : new Set();
  if (key?.keyKind === "berth-upgraded") return new Set();
  return held;
}

/** Is `hand` this credential's own at a named gate? */
export const holdsHand = (key, hand) => handsOf(key).has(hand);

/** The refusal's words when a named hand is in the house but not this credential's. */
export const notThisHand = (hand, key) => ({
  defect: `"${hand}" is not this key's own hand`,
  hint: key?.heldBy === "resident"
    ? `this key is in a resident's own hand${key.claimedHandle ? ` (${key.claimedHandle})` : ""}, and it stands as that resident only; ${hand} acts with their own key or the household's`
    : `this key is a berth's own and names no hand here; ${hand} acts with their own key or the household's`,
});
