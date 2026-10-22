// letter-fold.mjs — A PENDING LETTER IS ITS SEND ROW PLUS ITS LATER WORD (POS-666).
//
// Ruled by Darko 2026-10-22 (17:12–17:19 EDT, POS-666): "We just need parity"
// with git-era letters, where a sender could edit a letter with a commit or
// retract it with a commit before the crossing moved it. The town log had
// neither: a letter sent through the door was a row that sailed at the next
// crossing as written.
//
// ── THE LOG STAYS A LOG ─────────────────────────────────────────────────────
//
// An amendment and a withdrawal are rows of their own, appended after the
// letter's send row (class `letter`, acts `amend-letter` and `withdraw-letter`,
// each naming the send row's seq). Nothing is rewritten and nothing is deleted:
// the send row keeps the body as first written, every amendment keeps the body
// it set, and a withdrawal keeps the moment it was made. That is the letter's
// own record, kept the way a commit log keeps one, and it is why the first
// withdrawal, on 10-17 (a row deleted by hand), was the stopgap and this is not.
//
// ── ONE FOLD, TWO READERS ───────────────────────────────────────────────────
//
// The sender's reads (town-mail.mjs § hotLetters) and the crossing
// (town-bridge.mjs § the letters) both fold the pending rows through THIS
// function, so what a sender reads as standing is exactly what the boat takes:
// the last version's body, and nothing that was withdrawn. Two folds would be
// two answers to "what sails", and the first divergence would be a sender told
// one thing while the town received another.
//
// A row names its letter by the send row's seq and must come from that
// letter's own sender. An amendment or withdrawal whose letter is not among the
// rows folded (it has already sailed), is from another hand, or follows a
// withdrawal changes nothing: the door never writes one (it judges under the
// town lock, src/letter-amend.mjs), and the fold refuses it anyway, because a
// row reaching the table by another road must not move someone's letter.

/** The send act (town-mail.mjs § MAIL_ACT is this value). */
export const SEND_ACT = "send-letter";
/** The two later words a sender may say about a letter that has not sailed. */
export const AMEND_ACT = "amend-letter";
export const WITHDRAW_ACT = "withdraw-letter";

const isLaterWord = (r) => r?.cls === "letter" && (r.act === AMEND_ACT || r.act === WITHDRAW_ACT);

/**
 * Fold rows (any classes, in seq order) into their letters.
 *
 * Returns `{ letters, words }`: one entry per send row, `{ row, args, versions,
 * withdrawn }` where `args` is the send's arguments with the last amendment's
 * body, `versions` is every body in order (the send's first, each with its seq
 * and when it was written), and `withdrawn` is the withdrawal row or null; and
 * one entry per later-word row, `{ row, letter }` where `letter` is the send
 * row's seq it applied to, or null when it applied to nothing.
 */
export function foldLetters(rows) {
  const sends = new Map();
  const words = [];
  for (const r of rows ?? []) {
    if (r?.cls !== "letter") continue;
    if (r.act === SEND_ACT) {
      sends.set(r.seq, { row: r, amendments: [], withdrawn: null });
      continue;
    }
    if (!isLaterWord(r)) continue;
    const target = sends.get(Number(r.payload?.letter_seq));
    if (!target || target.row.handle !== r.handle || target.withdrawn) { words.push({ row: r, letter: null }); continue; }
    if (r.act === AMEND_ACT) target.amendments.push(r);
    else target.withdrawn = r;
    words.push({ row: r, letter: target.row.seq });
  }
  const letters = [...sends.values()].map(({ row, amendments, withdrawn }) => {
    const first = row.payload?.args ?? {};
    const last = amendments.at(-1);
    return {
      row,
      args: last ? { ...first, body: last.payload?.body } : first,
      versions: [
        { version: 1, seq: row.seq, written_at: row.writtenAt, body: first.body ?? null },
        ...amendments.map((a, i) => ({ version: i + 2, seq: a.seq, written_at: a.writtenAt, body: a.payload?.body ?? null })),
      ],
      withdrawn,
    };
  });
  return { letters, words };
}

/**
 * The send rows as they now stand: each with its folded arguments in
 * `payload.args`, and `amended` listing its amendments (seq and time) when it
 * has any. Withdrawn letters are gone from this list, because they will not
 * sail. Every row that is not a send is left out.
 */
export function standingLetters(rows) {
  return foldLetters(rows).letters
    .filter((l) => !l.withdrawn)
    .map(({ row, args, versions }) => ({
      ...row,
      payload: { ...row.payload, args },
      ...(versions.length > 1 ? { amended: versions.slice(1).map((v) => ({ seq: v.seq, written_at: v.written_at })) } : {}),
    }));
}
