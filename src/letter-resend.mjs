// letter-resend.mjs — `household { do: "send", args: { …, resend: "<id of your bounced letter>" } }` (POS-1027).
//
// A resend is a NEW LETTER that goes in the place of one of yours that bounced, and says so. It is nothing more:
//
//   · the original is NEVER touched. A bounced letter stays in the sender's outbox, its ledger line stays, its row stays; no file, row or ledger line is rewritten.
//   · the link is the replacement's own send row: the town log keeps a send row's arguments verbatim (payload.args), so `payload.args.resend` IS the record that
//     this letter stands in for that one. The bounce is reported as resent by a JOIN over those rows (resendsBy), never by a write to the original.
//   · the replacement is an ordinary letter. It takes the ordinary letter's identity (sender, town-local day, recipient, title slug), so a resend on the same day
//     with the same title meets the same duplicate-id guard as any second letter and is refused by it; a different title, or tomorrow, is a fresh identity. Nothing here
//     mints, suffixes or bypasses an id, and the envelope the ferry reads is unchanged (the ferry never sees the field).
//   · the nonce is the retry key it always was: a retry with the same nonce is answered with the first call's receipt BEFORE this check runs (town-mail.mjs §
//     sendRow), so a retry after the crossing cannot fail here, and cannot write a second letter or a second delivery.
//
// WHAT MAKES A LETTER RESENDABLE: it is the sender's own (a letter of anyone else's reads exactly as an unknown id: nothing about another house's mail is
// confirmed), it is still in the outbox and was never delivered, and the ledger holds a BOUNCE line for that sender's file (the same file-name join the
// town's own mail law uses). A letter that is merely waiting for its crossing is not a bounce, and a delivered one needs no resend. One replacement per bounce:
// while a replacement stands (it is not withdrawn), a second resend of the same bounce is refused, naming the first.

import { readTownJournal } from "./town-journal.mjs";
import { SEND_ACT, standingLetters } from "./letter-fold.mjs";

const refuse = (code, defect, hint) => Object.assign(new Error(defect), { code, defect, hint });
const baseOf = (p) => String(p ?? "").split("/").pop();
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;

/**
 * The letters a sender's replacements stand in for: Map<original letter id, { letter_id, seq, written_at }>, from the town log's send rows carrying
 * `args.resend`, folded so a withdrawn replacement no longer counts. `handle` scopes it to one sender; a key's other residents are not read.
 */
export async function resendsBy(odb, handle) {
  if (!odb) return new Map();
  const rows = (await readTownJournal(odb)).filter((r) => r.cls === "letter" && r.handle === handle);
  const standing = standingLetters(rows);
  const out = new Map();
  for (const r of standing) {
    const of = r.payload?.args?.resend;
    if (typeof of === "string" && of && r.act === SEND_ACT) out.set(of, { letter_id: r.payload?.id ?? null, seq: r.seq, written_at: r.writtenAt ?? null });
  }
  return out;
}

/**
 * Judge `args.resend` for the send being made. Returns `null` when none was offered, else `{ id, state }` for the bounce; throws in the bounce vocabulary
 * (code, defect, hint). `ix` is the door's pooled index (letterBounceState), `odb` the town log.
 */
export async function judgeResend(args, { from, ix, odb, logOn }) {
  const raw = args?.resend;
  if (raw === undefined || raw === null || raw === "") return null;
  if (typeof raw !== "string" || !ID_RE.test(raw.trim()))
    throw refuse(422, "resend: is the id of a letter of yours that bounced", 'resend: "<letter id>" — the id of the bounced letter, as household { read: "mail", view: "outbox" } lists it');
  if (!logOn || !odb)
    throw refuse(422, "resend needs the town log", "this office writes letters straight into the record rather than the log, so the link between a resend and its bounce has nowhere to be kept: write the letter without resend:");
  const id = raw.trim();
  const state = await ix.letterBounceState(id);
  // another house's letter, or none: the same answer, so nothing about anyone else's mail is confirmed
  if (!state || state.from !== from)
    throw refuse(404, `no letter "${id}" of yours`, 'resend takes the id of a letter YOU sent that bounced: household { read: "mail", view: "outbox" } lists your letters');
  if (state.delivered)
    throw refuse(409, `"${id}" was delivered: there is nothing to resend`, "a letter that arrived needs no second letter; write a new one if you have more to say");
  if (!state.bounced)
    throw refuse(409, `"${id}" has not bounced`, "it is still waiting for its crossing. If it bounces, resend it then; to change it before it sails, amend-letter or withdraw-letter");
  const have = (await resendsBy(odb, from)).get(id);
  if (have)
    throw refuse(409, `"${id}" was already resent${have.letter_id ? ` as ${have.letter_id}` : ""}`, `one replacement per bounce while it stands (seq ${have.seq}); withdraw that letter first to resend again, or resend the replacement if it bounced too`);
  return { id, state };
}

/** The sentence the receipt carries for a resend. */
export const resendNote = (id) => `this letter goes in the place of ${id}, which bounced; ${id} itself is unchanged, and the bounce now reports that it was resent. This is a new letter: it sails at the next crossing and is judged like any other.`;
export { baseOf };
