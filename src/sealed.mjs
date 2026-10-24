// sealed.mjs — A SEALED SECRET: the rules public, the instances sealed, revealed
// afterwards so anyone can check them (POS-712, lupi's shape B).
//
// Asked for first by lupi (postmark-town/postmark#3531, "Hidden information in a
// public town — field notes from Undercover g1", 2026-10-08): a game in a public
// town needs commit before reveal, a host who can neither forge nor read early,
// checking by anyone afterwards, and no crypto tooling on the player's side. Of
// lupi's three shapes this is B, a commit/reveal held by the Office, made general
// from the creatures' own seed (WLD-56 W2: commit a hash, reveal the secret).
//
// THE SHAPE. A SCOPE (one thing that keeps secrets: a creature, a game table) has
// its own secret, HMAC(master, "sealed/" + scope), and the master key is the
// box's alone. An ITEM is (subject, number): the subject is whom it is for (a
// resident), the number which of theirs (1, 2, 3 …). Its value is drawn from a
// PUBLIC list by the scope's secret, and it carries a nonce, so its commitment
//
//     sha256(scope | subject | number | value | nonce)
//
// says nothing about the value (the nonce stops anyone from trying every word of
// a short public list against it) and binds the office to it. The commitment is
// published when the item is first given; the value goes only to its subject.
// The REVEAL publishes the scope's secret, and from it anyone re-derives every
// item of the scope and checks every commitment (`verifySealed`). One scope's
// reveal opens that scope alone.
//
// Everything here is PURE: no clock, no store, no env. The caller hands in the
// master key (the box's CREATURE_SEED_KEY, under its own label, so no new secret
// is kept on the box) or, to check, the revealed secret.

import { createHash, createHmac } from "node:crypto";

export const SEALED_LABEL = "sealed/";

/** A scope's own secret, from the box's master key. Hex. */
export function scopeSecret(master, scope) {
  if (!master) throw new Error("scopeSecret: no master key");
  if (typeof scope !== "string" || !scope) throw new Error("scopeSecret: no scope");
  return createHmac("sha256", String(master)).update(`${SEALED_LABEL}${scope}`).digest("hex");
}

const mac = (secret, msg) => createHmac("sha256", String(secret)).update(msg).digest();

/** The commitment a sealed item publishes. Hex. */
export function commitmentOf({ scope, subject, number, value, nonce }) {
  return createHash("sha256").update(`${scope}|${subject}|${number}|${value}|${nonce}`).digest("hex");
}

/**
 * One sealed item: { value, nonce, commitment }. `list` is the public list its
 * value is drawn from; the draw is the first 48 bits of HMAC(secret,
 * "subject|number|draw"), modulo the list's length.
 */
export function sealedItem(secret, { scope, subject, number, list }) {
  if (!secret) throw new Error("sealedItem: no secret");
  if (!Array.isArray(list) || !list.length) throw new Error("sealedItem: an empty list");
  if (!Number.isInteger(number) || number < 1) throw new Error("sealedItem: a number is 1 or more");
  const at = mac(secret, `${subject}|${number}|draw`).readUIntBE(0, 6) % list.length;
  const value = String(list[at]);
  const nonce = mac(secret, `${subject}|${number}|nonce`).toString("hex");
  return { value, nonce, commitment: commitmentOf({ scope, subject, number, value, nonce }) };
}

/**
 * Check a revealed scope: every published item `{ subject, number, commitment }`
 * against the revealed secret and the public list. Answers { ok, problems, items }
 * with each item's value, so a reader can see what each subject was given.
 */
export function verifySealed(secret, { scope, list }, published = []) {
  const problems = [], items = [];
  for (const p of published) {
    const it = sealedItem(secret, { scope, subject: p.subject, number: Number(p.number), list });
    items.push({ subject: p.subject, number: Number(p.number), value: it.value });
    if (it.commitment !== p.commitment) problems.push(`${p.subject} #${p.number}: the revealed secret does not open its commitment`);
  }
  return { ok: problems.length === 0, problems, items };
}
