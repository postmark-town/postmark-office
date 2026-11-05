// sparks.mjs — THE SPARK CLASS OF THE POST MACHINE (POS-780), pure.
//
// Darko, 2026-10-22 19:48 (POS-638/a): a resident marks a moment for content
// with a PUBLIC post, pointing back at most three days. 2026-10-27 14:50: "I
// want to rename 'scoop' to 'spark', and try to fit things under the
// Illuminator's lane that would be more about the visual generations". And
// 2026-10-24 13:44 (POS-780/a), on the window: "no hard cap, more of a 'one arc
// we can tell'. could even happen over the course of a full settlement or
// multiple."
//
//   world { do: "spark", args: { from, to, title, note? } }
//
// Wright's content packet (POS-780, 2026-11-05 03:51Z, § 3 step 1): "It's a
// public post of class `spark` (the post machinery the quests use), holding a
// time window, the place where the resident stood, and who sparked it." And his
// settlement of 07:19Z: the place is "where the sparker stood when the moment
// ended, read from the record ... Not the call-time standpoint, and never a
// place the caller supplies"; step 1 "keeps post, amend and withdraw only, and
// the unasked five-cap, later lifecycle and export-state gate come out."
//
// So a spark has two states: it stands `sparked` from its post, and its sparker
// may withdraw it (`withdrawn`, finished). Nobody advances it; its later life
// (the moment export, the Illuminator's keyframes) is not built here. No stake,
// no stamps, and nothing here pays anyone.
//
// The window is `from` to `to`, kept in the post's own span columns (starts,
// ends); `note` is the sparker's note, kept as the post's body. The place is
// derived by the pen (spark-store.mjs § placeAtTo), never taken from the call.

import { refuse, TITLE_MAX, INVITATION_MAX } from "./events.mjs";

export const SPARK_CLASS = "spark";

export const STATE_SPARKED = "sparked";
export const STATE_WITHDRAWN = "withdrawn";
/** Every state a spark stands in. */
export const SPARK_STATES = Object.freeze([STATE_SPARKED, STATE_WITHDRAWN]);
/** The states a spark is finished in (the Posts project: "every class declares its finished states"). */
export const SPARK_FINISHED = Object.freeze([STATE_WITHDRAWN]);

const DAY_MS = 86_400_000;
/** "pointing back at most 3 days" (POS-638/a): the window's start is no older than this. */
export const SPARK_LOOKBACK_MS = 3 * DAY_MS;
// `to` is never in the future, not by a minute (Wright, AUTHORITY 2026-11-05T09:33:28Z: "The 60-second future
// allowance goes, since `to` can't be in the future"). Until 2026-11-05 a 60 s skew carried from office #770 stood here.

export const NOTE_MAX = INVITATION_MAX;

export const SPARK_HOW = 'world { do: "spark", args: { from, to, title, note? } }';

/** The act's own fields, and only these (the door's `handle` aside). */
export const SPARK_FIELDS = Object.freeze(["from", "to", "title", "note"]);

const ISO_WITH_ZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;

function instant(name, v) {
  if (v == null || v === "") throw refuse(422, `a spark needs ${name}`, `${name}: an ISO instant with its zone, e.g. "2026-11-05T03:14:00Z" (the record is UTC)`, { field: name });
  const s = String(v).trim();
  const t = Date.parse(s);
  if (!ISO_WITH_ZONE.test(s) || !Number.isFinite(t))
    throw refuse(422, `${name} is not an instant`, `${name} is an ISO instant with its zone, e.g. "2026-11-05T03:14:00Z" (the record is UTC)`, { field: name });
  return new Date(t).toISOString();
}

/**
 * The moment's window, judged against the clock: `{ from, to }` as ISO strings,
 * or a refusal thrown. At most three days back, over, and with no cap on its
 * length (POS-638/a; POS-780/a).
 */
export function judgeWindow({ from, to }, now) {
  const f = instant("from", from);
  const t = instant("to", to);
  const [tF, tT] = [Date.parse(f), Date.parse(t)];
  if (tT <= tF) throw refuse(422, "a moment ends after it starts", `to (${t}) is not after from (${f})`, { field: "to" });
  if (tT > now) throw refuse(422, "a spark marks a moment that has happened", `to (${t}) is in the future: spark it once it is over`, { field: "to" });
  if (tF < now - SPARK_LOOKBACK_MS)
    throw refuse(422, "a spark points back at most 3 days", `from (${f}) is older than ${new Date(now - SPARK_LOOKBACK_MS).toISOString()}: the town points a spark back three days and no further`, { field: "from" });
  return { from: f, to: t };
}

/** A spark's text: `{ title, note }`. `partial` is the amendment: only what was sent is judged. */
export function judgeSparkText({ title, note }, { partial = false } = {}) {
  const out = {};
  if (title !== undefined || !partial) {
    if (typeof title !== "string" || !title.trim()) throw refuse(422, "a spark needs a title", `title: the moment in a few words (at most ${TITLE_MAX} characters)`, { field: "title" });
    const t = title.trim();
    if (/[\r\n]/.test(t)) throw refuse(422, "title is one line", "title: one line of text", { field: "title" });
    if (t.length > TITLE_MAX) throw refuse(422, `title is at most ${TITLE_MAX} characters`, `this one is ${t.length}`, { field: "title" });
    out.title = t;
  }
  if (note !== undefined) {
    if (typeof note !== "string") throw refuse(422, "note is text", `note: your note on the moment, at most ${NOTE_MAX} characters`, { field: "note" });
    const n = note.trim();
    if (n.length > NOTE_MAX) throw refuse(422, `note is at most ${NOTE_MAX} characters`, `this one is ${n.length}`, { field: "note" });
    out.note = n;
  } else if (!partial) out.note = "";
  return out;
}

/** A spark is made at the world door, through the resident class's grant; the town's flat post door does not make one. */
export const SPARK_NOT_AT_TOWN = () => refuse(422, "a spark is made at the world door",
  `${SPARK_HOW}: the act is granted by your resident class and placed where you stood when the moment ended, so it is not posted here. Amend or withdraw your own spark with town { do: "amend" } or town { do: "close" }`,
  { field: "class" });

/** Withdrawing is the sparker's own, while the spark stands. */
export const SPARK_NO_CLOSE_BY_OTHERS = (id, author) => refuse(403, `"${id}" is not yours to withdraw`, `its sparker is ${author}, and only they withdraw it`);

/** A spark has no stages to move through: it stands, or its sparker withdraws it. */
export const SPARK_NO_ADVANCE = (id) => refuse(422, `"${id}" is a spark, and a spark is not advanced`,
  'it stands as it was sparked; its sparker withdraws it with town { do: "close", args: { post } }');
