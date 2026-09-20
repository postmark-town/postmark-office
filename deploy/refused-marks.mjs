// refused-marks.mjs — WHICH MARK THE CROSSING REFUSED, AND IN WHOSE WORDS.
//
// ── THE INSTANCE THIS ANSWERS (S71, 2026-09-15) ──────────────────────────────
//
// Mari's first parcel was refused by the world's parcel-claim cap: the cap
// counts per CREDENTIAL household, hers resolves to the founder's, and that one
// already held five. The cause was a complete sentence and the sweep wrote it:
//
//   {"mark":"mari/marigold-house-parcel","error":"parcel claim capped — this
//    credential household already holds 5 (cap 3 per household, ruled
//    2026-07-30; prior estate stands, new claims wait on the founder's word)"}
//
// Nobody outside the box journal could read it. The sweep puts that sentence in
// the quarantined row's `detail`, and `settlement-receipt.mjs` mapped the row to
// `{ household, ref, reason, row }` — four fields, none of them `detail`. So the
// public receipt carried the GENERIC sentence ("this sketchbook's own published
// rows could not be admitted, so it was set aside and the rest of the town
// settled without it") and `row: null`, and a resident learned which of her
// marks had died, and why, twelve hours later from a person.
//
// ── AND THE CROSSING SAID `published` ────────────────────────────────────────
//
// Measured on the box: the S71 crossing's own history row is
//
//   {"at":"2026-09-15T17:45:00Z","status":"published","class":null,
//    "published":16,"left_drafted":0,"quarantined":1, …}
//
// `status: "published"`, `class: null`, `refusal: null`. A refusal-only surface
// would have missed this instance entirely — a quarantine is one household's
// refusal inside a crossing that otherwise succeeded, which is precisely the
// shape that reaches nobody. So this file reads BOTH inputs, and the receipt
// carries the block on any crossing that has one.
//
// ── ONE PARSER, TWO INPUTS, BECAUSE IT IS ONE SENTENCE ───────────────────────
//
// The fold writes its errors in exactly one grammar — `{"mark": …, "error": …}`
// (postmark-world tools/marks-fold.mjs, both holders of the cap gate) — and that
// grammar reaches this side embedded in a string, twice over:
//
//   · a QUARANTINED row's `detail`, composed at settlement-sweep.mjs:1160 as
//     `${branch} publishes ${n} inadmissible row(s): ${JSON.stringify(first)}`;
//   · a whole-crossing REFUSAL's `cause`, when the refusing throw is the fold's
//     own (settlement-sweep.mjs:315-316, `${ref} folds with ${n} error(s):
//     ${JSON.stringify(state.errors[0])}`).
//
// Same shape, same `JSON.stringify(first)`, same "N error(s)/row(s)" count. Two
// readers of one grammar would drift; this is one.
//
// ── WHAT IT DELIBERATELY DOES NOT CLAIM ──────────────────────────────────────
//
// THE SWEEP FORWARDS ITS FIRST ERROR ONLY. Both call sites stringify `first` and
// print the count beside it, so a sketchbook with four inadmissible rows arrives
// here as one named mark and the number four. Naming one and reporting four
// would be a lie of arithmetic, and naming one silently would be the omission
// this whole file exists to end — so `claimed` and `named` are separate fields
// and the gap is stated, exactly as `settlement-classify.mjs` already states it
// for `errors_claimed` vs `errors_seen`.
//
// `check` IS A SLICE, NOT A TAXONOMY. It is the head of the sweep's own
// sentence — everything before its first em dash — so the cap's rows group under
// `parcel claim capped` without this file inventing a single word of its own. It
// is not a classification and must not be read as one: a few of the fold's
// sentences carry their subject in the head (`parent 'x' not found`), so those
// rows group per-subject rather than per-rule. Naming them properly is the
// world's to do, in the fold, and a guess made here would be a second opinion
// about a law this side does not hold.

/** The cap on how many refused marks a receipt names. The total is always exact. */
export const REFUSED_MARKS_SHOWN = 20;

/** Each sentence is bounded — the sweep already slices `detail` at 400. */
const SENTENCE_MAX = 300;

/** The fold's error grammar, wherever it is embedded: `{"mark":…,"error":…}`. */
const FOLD_ERROR = /\{"mark":\s*"(?:[^"\\]|\\.)*"\s*,\s*"error":\s*"(?:[^"\\]|\\.)*"\s*\}/;

/** The sweep's own count, from either phrasing it writes. */
export function inadmissibleClaimed(text) {
  const m = /(\d+)\s+(?:inadmissible\s+row|error)\(s\)/.exec(String(text ?? ""));
  return m ? Number(m[1]) : null;
}

/**
 * The one `{mark, error}` the sweep stringified into a message, or null.
 *
 * Parsed, never regex-scraped field by field: the error sentence carries commas,
 * quotes and em dashes, and a pattern that picked the two values apart by hand
 * would truncate the cap's sentence at its first comma — which is the half that
 * names the cap.
 */
export function foldErrorIn(text) {
  const m = FOLD_ERROR.exec(String(text ?? ""));
  if (!m) return null;
  try {
    const row = JSON.parse(m[0]);
    if (typeof row?.mark !== "string" || typeof row?.error !== "string") return null;
    return { mark: row.mark, error: row.error };
  } catch { return null; }
}

/** The head of the sweep's sentence — a slice of its words, never a class of ours. */
export function checkOf(error) {
  const s = String(error ?? "").trim();
  if (!s) return null;
  const head = s.split(" — ")[0].trim();
  return head.slice(0, SENTENCE_MAX) || null;
}

/**
 * The refused marks a crossing can name, from the two places the fold's sentence
 * reaches this side.
 *
 * @param sweep    the sweep's report (`SETTLEMENT_SWEEP_JSON`), or null.
 * @param refusal  the classify verdict (`SETTLEMENT_REFUSAL_JSON`), or null.
 *
 * Returns null when neither input carries a refused mark — an absent block and a
 * block saying "none" are different states only when the question was asked, and
 * on an ordinary crossing it is not asked at all.
 */
export function refusedMarks(sweep, refusal) {
  const rows = [];
  const unparsed = [];
  let claimed = 0;

  for (const q of sweep?.quarantined ?? []) {
    const n = inadmissibleClaimed(q?.detail);
    const row = foldErrorIn(q?.detail);
    // A QUARANTINE THIS PARSER CANNOT READ IS NAMED, NOT DROPPED. The sweep has
    // exactly one quarantine site today and it always carries the fold's
    // grammar, so this arm is unreachable now — and it is the arm that decides
    // what happens the day the sweep grows a second one. Silently skipping it
    // would rebuild, inside the fix, the omission the fix exists to end.
    if (n === null && !row) {
      if (q?.detail || q?.reason) unparsed.push({ household: q?.household ?? null, ref: q?.ref ?? null });
      continue;
    }
    claimed += n ?? (row ? 1 : 0);
    if (!row) { unparsed.push({ household: q?.household ?? null, ref: q?.ref ?? null }); continue; }
    rows.push({
      mark: row.mark,
      // THE HOUSEHOLD IS THE SWEEP'S, NOT THE MARK ID'S PREFIX. A mark id reads
      // `<handle>/<slug>` and the sweep's `household` is the sketchbook's — they
      // agree today and they are different facts, and deriving one from the
      // other here would put this file in the business of resolving identity.
      household: q?.household ?? null,
      ref: q?.ref ?? null,
      check: checkOf(row.error),
      error: row.error.slice(0, SENTENCE_MAX),
    });
  }

  // The whole-crossing refusal, when the refusing throw was the fold's own. The
  // cause names no household — `${ref} folds with …` is about a tree, not a
  // sketchbook — so household stays null rather than being guessed from the id.
  const cause = refusal?.cause;
  const causeRow = foldErrorIn(cause);
  if (causeRow) {
    claimed += inadmissibleClaimed(cause) ?? 1;
    rows.push({
      mark: causeRow.mark,
      household: null,
      ref: refusal?.ref ?? null,
      check: checkOf(causeRow.error),
      error: causeRow.error.slice(0, SENTENCE_MAX),
    });
  }

  if (!rows.length && !claimed && !unparsed.length) return null;
  return {
    // WHAT THE SWEEP SAID IT REFUSED, and what it gave this side enough to name.
    // Two numbers, never folded into one: the sweep forwards its first error per
    // message, so `claimed > named` is the ordinary case and not an alarm — but a
    // reader acting on `named` has to know it is a floor.
    claimed,
    named: rows.length,
    ...(claimed > rows.length
      ? { withheld: `the sweep reported ${claimed} inadmissible row(s) and forwards its FIRST error per message, ` +
          `so ${rows.length} of them can be named here (postmark-world tools/settlement-sweep.mjs:1160, :315)` }
      : {}),
    marks: rows.slice(0, REFUSED_MARKS_SHOWN),
    ...(rows.length > REFUSED_MARKS_SHOWN ? { shown: REFUSED_MARKS_SHOWN } : {}),
    // The sketchbooks set aside whose detail this parser could not read. Empty
    // on every crossing the sweep can compose today; present the day it cannot.
    ...(unparsed.length ? { unparsed } : {}),
  };
}
