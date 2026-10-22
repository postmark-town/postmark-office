// letter-amend.mjs — AMEND AND WITHDRAW A LETTER THAT HAS NOT SAILED (POS-666).
//
// Ruled by Darko 2026-10-22 (17:12–17:19 EDT): parity with git-era letters,
// where a sender could edit a letter with a commit or retract it with a commit
// before the crossing moved it. Two acts on the household door, beside send:
//
//   household { do: "amend-letter",    args: { id, body } }
//   household { do: "withdraw-letter", args: { id } }
//
// Only your own letter, and only while it is pending (its row not yet drained
// by a crossing). A letter may be amended any number of times; only the last
// version sails, and the letter's own record keeps every earlier one. A
// withdrawn letter never sails, and the record keeps the withdrawal. Both are
// rows appended to the town log (letter-fold.mjs says why nothing is rewritten
// or deleted).
//
// ── NEVER AGAINST A BOAT THAT IS LOADING ────────────────────────────────────
//
// The crossing reads the pending rows and replays them while it holds
// town.lock, so a later word written after that read would be answered
// "amended" or "withdrawn" and then sail as it was: the office telling a
// sender something false. So the judgement and the write happen together under
// the town lock, held shared (town-lock.mjs § withTownLockHeld): a crossing
// that is under way makes this door wait, and if it does not finish within the
// wait the door refuses and changes nothing. The letter is then judged against
// the log as it stands after the crossing, so a letter that sailed is refused
// as sailed, never amended.
//
// A letter whose file already stands in the town's record has sailed even if
// its row is still pending (a crossing that landed it and held its cursor for
// another row), and is refused the same way.

import { existsSync } from "node:fs";
import { join } from "node:path";

import { appendTownJournal, pendingRows, townLogEnabled } from "./town-journal.mjs";
import { foldLetters, AMEND_ACT, WITHDRAW_ACT } from "./letter-fold.mjs";
import { STANDING, SETTLES_AT } from "./town-mail.mjs";
import { nextCrossing, validateLetter } from "./write.mjs";
import { nextCrossingForReceipt } from "./crossings.mjs";
import { refuse } from "./events.mjs";
import { recipientProbe } from "./send-at-door.mjs"; // the send's own recipient check, store-aware (POS-332)

export { AMEND_ACT, WITHDRAW_ACT };

/** The words a sender is told when the crossing holds the lock past the wait. */
export const CROSSING_UNDER_WAY = {
  code: 503,
  defect: "a crossing is under way, and nothing was changed",
  hint: "if your letter was on this boat it sailed as written; if not, it is still yours to change once the crossing finishes, in a few minutes — try again then",
};

const NO_TENSE = () => refuse(503, "this office keeps no standing-mail tense",
  "a letter here is a committed file the moment it conforms, so there is no pending letter to amend or withdraw");

const NOT_PENDING = (id) => refuse(404, `no letter of yours by the id "${id}" is waiting for the crossing`,
  'what you have written that has not sailed: household { read: "mail", view: "pending" }. A letter that has sailed is the town\'s record and is not changed here');

/**
 * Find the caller's own pending letter by id, from a fresh fold of the log.
 * `seq` picks one when two of your pending letters share an id.
 */
export async function ownPendingLetter(odb, key, { id, seq = null } = {}) {
  const mine = new Set([...(key?.handles ?? [])].filter(Boolean));
  const rows = (await pendingRows(odb)).filter((r) => r.cls === "letter" && r.handle && mine.has(r.handle));
  const hits = foldLetters(rows).letters.filter((l) => l.row.payload?.id === id && (seq == null || l.row.seq === Number(seq)));
  return hits;
}

/** One letter of yours, pending, by id: refused by name when it is not, or is not only one. */
async function judgeTarget(odb, key, fields, clone) {
  const id = String(fields?.id ?? "").trim();
  if (!id) throw refuse(422, "which letter?", 'pass id: — the letter_id your send returned, or household { read: "mail", view: "pending" }');
  const hits = await ownPendingLetter(odb, key, { id, seq: fields?.seq ?? null });
  if (!hits.length) throw NOT_PENDING(id);
  if (hits.length > 1)
    throw refuse(409, `${hits.length} of your pending letters carry the id "${id}"`,
      `name one with seq: (${hits.map((h) => h.row.seq).join(", ")}), as household { read: "mail", view: "pending" } lists them`);
  const l = hits[0];
  if (l.withdrawn) throw refuse(409, `"${id}" is already withdrawn`, "it will not sail; the withdrawal is kept in the town log beside it");
  if (clone && l.row.payload?.file && existsSync(join(clone, l.row.payload.file)))
    throw refuse(409, `"${id}" has already sailed`, "the crossing has taken it into the town's record, which is not changed here");
  return l;
}

const later = (l, act, payload, key, odb) => appendTownJournal(odb, {
  cls: "letter", act,
  household: String(key?.household ?? ""),
  handle: l.row.handle,
  ghId: key?.ghId ?? null, ghLogin: key?.ghLogin ?? null,
  payload: { letter_seq: l.row.seq, id: l.row.payload?.id ?? null, ...payload },
  channel: key?.channel ?? null,
});

/**
 * household { do: "amend-letter", args: { id, body, seq? } }
 *
 * The new body is judged by the send's own fence (validateLetter, with the
 * letter's accepted identity), so a body the crossing would refuse is refused
 * here, now. A body equal to the one that stands writes nothing.
 */
export async function amendLetterAtOffice(fields, key, { db, clone, odb, lock, now = Date.now() } = {}) {
  if (!odb || !townLogEnabled()) throw NO_TENSE();
  if (typeof fields?.body !== "string" || !fields.body.trim())
    throw refuse(422, "what does it say now?", "pass body: the letter's whole new body; it replaces the one that stands");
  const held = lock ?? (await import("./town-lock.mjs")).withTownLockHeld;
  return held(async () => {
    const l = await judgeTarget(odb, key, fields, clone);
    const id = l.row.payload?.id ?? null;
    if (fields.body === l.args.body)
      return { letter_id: id, amended: false, version: l.versions.length,
        note: "this is already the body that stands, so nothing was written" };
    validateLetter({ ...l.args, body: fields.body }, key, await recipientProbe(db, l.args.to), { id, file: l.row.payload?.file ?? null });
    const seq = await later(l, AMEND_ACT, { body: fields.body }, key, odb);
    return {
      letter_id: id,
      amended: true,
      version: l.versions.length + 1,
      standing: STANDING,
      expected_crossing: nextCrossing(new Date(now)),
      next_crossing: nextCrossingForReceipt(now, { writtenAt: l.row.writtenAt }),
      logged: { seq, settles_at: SETTLES_AT },
      note: "only this version sails. Every earlier version stays in the town log, in your letter's own record: household { read: \"letter\", args: { id } } shows them while it stands",
    };
  }, { busy: CROSSING_UNDER_WAY });
}

/** household { do: "withdraw-letter", args: { id, seq? } } */
export async function withdrawLetterAtOffice(fields, key, { clone, odb, lock } = {}) {
  if (!odb || !townLogEnabled()) throw NO_TENSE();
  const held = lock ?? (await import("./town-lock.mjs")).withTownLockHeld;
  return held(async () => {
    const l = await judgeTarget(odb, key, fields, clone);
    const seq = await later(l, WITHDRAW_ACT, {}, key, odb);
    return {
      letter_id: l.row.payload?.id ?? null,
      withdrawn: true,
      logged: { seq },
      note: "it will not sail. The withdrawal is kept in the town log beside the letter; nothing was deleted",
    };
  }, { busy: CROSSING_UNDER_WAY });
}

/**
 * The sender's own pending letter, whole, for household { read: "letter" }:
 * the body that stands and every version before it, or its withdrawal. Null
 * when the key holds no pending letter by this id.
 */
export async function pendingLetterRead(odb, key, id) {
  if (!odb || !townLogEnabled() || !id) return null;
  const [l] = await ownPendingLetter(odb, key, { id });
  if (!l) return null;
  const a = l.args;
  return {
    id, from: l.row.handle, to: a.to ?? null, title: a.title ?? null, thread: a.thread || "new", body: a.body ?? null,
    standing: l.withdrawn ? null : STANDING,
    ...(l.withdrawn ? { withdrawn: { seq: l.withdrawn.seq, at: l.withdrawn.writtenAt }, note: "withdrawn: it will not sail" } : {}),
    written_at: l.row.writtenAt, seq: l.row.seq,
    versions: l.versions,
  };
}
