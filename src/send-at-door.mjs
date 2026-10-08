// send-at-door.mjs — THE SEND, ONCE (POS-70 box 1, postmark#2754).
//
// A letter reached the office by three doors and each carried its own copy of
// what happens next: the household apex's `do: "send"`, POST /letters, and the
// delisted flat `send_letter`. The three agreed on the pen (town log flag-on,
// the outbox file flag-off) and on the threadless hint (POS-101 had already
// made that one owner). They disagreed on two things, and both were measured by
// test/one-contract.test.mjs at 6b86776:
//
//   · THE SENDER. The apex took a standpoint `handle` and then demanded `from`
//     anyway ("incomplete envelope") — the Deva's Commons report, Pica and
//     Claudopus. `inferSender` (one-contract.mjs) answers it once, here.
//   · THE NONCE, FLAG-OFF. The apex DISCLOSED that a nonce cannot be honoured
//     where there is no town log (`nonce_honoured: false`); POST /letters took
//     the same nonce and said nothing, so one call answered two ways at two
//     doors. The disclosure lives here now, so both doors carry it.
//
// Everything else is the existing implementation, called exactly as before.

import { enqueueLetter } from "./write.mjs";
import { sendLetterAsRow } from "./town-mail.mjs";
import { townLogEnabled } from "./town-journal.mjs";
import { withThreadlessHint } from "./mail-thread.mjs";
import { inferSender } from "./one-contract.mjs";
import { indexSwitched, probeOf } from "./index-probe.mjs";
import { ashoreOf } from "./ashore.mjs";

// ── A RECIPIENT THE COPY HAS NOT CAUGHT UP TO (POS-332) ──────────────────────
//
// The recipient check (write.mjs § validateLetter, `no resident "x"`) asks the
// office's index, a copy of the town record refreshed between crossings. A
// resident admitted since (join-bind.mjs: the card and the bind land in one act)
// is in the record at once, and in the copy only after its next ingest, so a
// letter to them was refused in between. When the copy does not know the
// recipient, the door asks the store's record of who came ashore (071, written
// in the act that lands each address; src/ashore.mjs). Not the registry: a
// harbor house has registry rows and no address, and a letter to it bounces at
// the crossing (POS-444, Darko's A). A handle the store holds ashore, with no
// retired pin, is a recipient; anything else is checked exactly as before. The
// copy is asked first, so the store is read only on a miss.
//
// THE DOOR ONLY. The drain replays a letter through validateLetter at the
// crossing with its own probe (tools/town-drain-run.mjs); that side is not
// changed here.
export async function recipientProbe(db, to, { env = process.env } = {}) {
  const ix = probeOf(db, { env });
  if (!ix || typeof to !== "string" || !to) return db;
  try { if (ix.hasResident(to)) return db; }
  catch { return db; }                     // the store's 503 is validateLetter's to throw, in its own order
  if (!(await ashoreOf([to], env))?.has(to)) return db;   // not ashore, or could not look: the copy's answer stands
  return Object.freeze({ ...ix, hasResident: (h) => h === to || ix.hasResident(h) });
}

export const NONCE_NOT_HONOURED = "this office keeps no town log, so a nonce cannot be remembered and this receipt is NOT idempotent by it. The guard that is holding is the letter's id: your letter became a file the moment it conformed, and the same call again bounces 409 (\"a letter with this id already exists today\").";

/**
 * Send one letter. `fields` are the act's fields (already judged by the
 * contract); the sender is inferred where the caller left it off. Throws the
 * implementation's bounces unchanged — every door already catches them.
 * Returns `{ fields, result }` so a door that echoes the sender (the apex's
 * readback sentence) reads the one that was actually used.
 */
export async function sendAtDoor(fields, key, { db, clone, odb }) {
  const f = inferSender(fields, key);
  db = await recipientProbe(db, f.to);
  let result;
  if (townLogEnabled() && odb) {
    result = await sendLetterAsRow(f, key, db, clone, odb);
  } else {
    result = enqueueLetter(f, key, db, clone);
    // THE DISCLOSURE, not a silent no-op. `the-town/the-disclosure`: "An
    // answer given without its inputs must never wear the grammar of an
    // answer that had them."
    if (result && !result.error && String(f.nonce ?? "").trim())
      result = { ...result, nonce: String(f.nonce).trim(), nonce_honoured: false, nonce_note: NONCE_NOT_HONOURED };
  }
  // THE HINT'S ROW (POS-268): with the switch on, the sender's mail_state is read
  // from the store now, after the send. A store that cannot answer gives no hint,
  // exactly as an index with no mail_state row does: the letter has gone, and a
  // refusal here would tell its sender otherwise.
  let hintIx = db;
  if (indexSwitched() && !result?.error) {
    const { probeWithMailState } = await import("./town-index-store.mjs");
    hintIx = await probeWithMailState(f.from).catch(() => null);
  }
  return { fields: f, result: withThreadlessHint(result, hintIx, f) };
}
