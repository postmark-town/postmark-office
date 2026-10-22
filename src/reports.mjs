// reports.mjs — THE REPORT CLASS OF THE POST MACHINE (POS-757), pure.
//
// Darko, 2026-10-22 17:19 EDT: "we need the ability to flag or report
// residents as well as file like a conflict or like request you know,
// adjudication. We should just for now have the ability to file that somehow,
// somewhere." RULED 17:53 (the picker): one post class, `report`, and it is
// PRIVATE.
//
//   town { do: "post", args: { class: "report", about, body, asks? } }
//
// `about` is a household or a resident's handle. `asks: "adjudication"` marks
// a request for a ruling. No stake, no stamps, no new tool: the class's fields
// are taught by `town { explain: "report" }`, never in the shared post schema
// (office AGENTS.md § The MCP surface).
//
// ── THE LIFE ────────────────────────────────────────────────────────────────
//
//   filed → heard → resolved
//        ↘       ↘ dismissed
//
// Only the town's hands (REPORT_HANDS) move a report, and every move carries a
// note, which the filing household reads beside the state. Finished: resolved,
// dismissed. There is no amend, no close and no withdraw.
//
// ── PRIVATE: THE FIRST PRIVATE POST ─────────────────────────────────────────
//
// Only the filing household and the town's hands read a report. It is never on
// the public record, the site or any public post list, and the household it is
// about is not told at filing. So a report is not in POST_CLASSES (the public
// reads' one switch, town-posts.mjs), its id names neither who filed it nor
// what it says, and a caller who may not read one is answered the same whether
// it exists or not (REPORT_NOT_FOUND).

import { refuse, INVITATION_MAX } from "./events.mjs";
import { holdsHand } from "./named-hand.mjs";

export const REPORT_CLASS = "report";

export const STATE_FILED = "filed";
export const STATE_HEARD = "heard";
export const STATE_RESOLVED = "resolved";
export const STATE_DISMISSED = "dismissed";
export const REPORT_STATES = Object.freeze([STATE_FILED, STATE_HEARD, STATE_RESOLVED, STATE_DISMISSED]);
export const REPORT_FINISHED = Object.freeze([STATE_RESOLVED, STATE_DISMISSED]);

/** Where each state may move: heard from filed; resolved from heard; dismissed from either. */
export const REPORT_MOVES = Object.freeze({
  [STATE_FILED]: Object.freeze([STATE_HEARD, STATE_DISMISSED]),
  [STATE_HEARD]: Object.freeze([STATE_RESOLVED, STATE_DISMISSED]),
  [STATE_RESOLVED]: Object.freeze([]),
  [STATE_DISMISSED]: Object.freeze([]),
});

// WHOSE HANDS HEAR A REPORT: the founders and the Worldkeeper, who hears a
// ground conflict first (RULED 2026-10-09). Widening it is a ruling.
export const REPORT_HANDS = Object.freeze(["wright", "keemin", "worldkeeper"]);

export const ASKS = Object.freeze(["adjudication"]);
export const BODY_MAX = INVITATION_MAX;
export const NOTE_MAX = 600;
/** A household's or a resident's name as the town spells one. */
export const ABOUT_RE = /^[a-z0-9][a-z0-9._-]{0,39}$/;
/** The id: opaque, never the filer's name or the report's words. */
export const REPORT_ID_RE = /^report\/[0-9a-f]{8}$/;
export const reportId = (hex8) => `${REPORT_CLASS}/${hex8}`;

/** The fields `town { do: "post" }` takes for a report, and only these. */
export const REPORT_POST_FIELDS = Object.freeze(["class", "about", "body", "asks", "handle"]);
/** The fields `town { do: "advance" }` takes for a report. */
export const REPORT_ADVANCE_FIELDS = Object.freeze(["post", "class", "to", "note", "handle"]);

/** True when this key stands as one of the town's hands for reports. */
export const isReportHand = (key) => REPORT_HANDS.some((h) => holdsHand(key, h));

// ── the judges ──────────────────────────────────────────────────────────────

const text = (v) => (v == null ? "" : String(v));

/** The post's own fields, judged: `{ about, body, asks }`, or a refusal thrown. */
export function judgeReport(fields = {}) {
  if (fields.stamps !== undefined) throw refuse(422, "a report takes no stake", REPORT_TAKES, { field: "stamps" });
  const stray = Object.keys(fields).filter((k) => fields[k] !== undefined && !REPORT_POST_FIELDS.includes(k));
  if (stray.length)
    throw refuse(422, `a report does not take: ${stray.join(", ")}`, REPORT_TAKES, { field: stray[0] });
  const about = text(fields.about).trim().toLowerCase();
  if (!about) throw refuse(422, "who is the report about?", 'about: a household\'s name or a resident\'s handle, as the town spells it', { field: "about" });
  if (!ABOUT_RE.test(about))
    throw refuse(422, `"${text(fields.about).slice(0, 60)}" is not a household or a handle`, "about: lowercase letters, digits, . _ and -, as the town spells a name", { field: "about" });
  const body = text(fields.body).trim();
  if (!body) throw refuse(422, "a report needs a body", `body: what happened, in your own words, at most ${BODY_MAX} characters`, { field: "body" });
  if (body.length > BODY_MAX) throw refuse(422, `the body is ${body.length} characters; a report's is at most ${BODY_MAX}`, "say it shorter: the hands write back to you on the report itself", { field: "body" });
  let asks = null;
  if (fields.asks !== undefined && fields.asks !== null) {
    asks = text(fields.asks).trim();
    if (!ASKS.includes(asks))
      throw refuse(422, `asks: "${asks.slice(0, 40)}" is not something a report asks`, `asks: "adjudication" asks the town for a ruling; leave it off to report and nothing more`, { field: "asks" });
  }
  return { about, body, asks };
}

/** A move's own fields, judged against where the report stands: `{ to, note }`, or a refusal thrown. */
export function judgeMove(fields = {}, from) {
  const stray = Object.keys(fields).filter((k) => fields[k] !== undefined && !REPORT_ADVANCE_FIELDS.includes(k));
  if (stray.length)
    throw refuse(422, `a report's move does not take: ${stray.join(", ")}`, REPORT_MOVE_TAKES, { field: stray[0] });
  const to = text(fields.to).trim();
  if (!REPORT_STATES.includes(to))
    throw refuse(422, to ? `"${to}" is not a report's state` : "move it to what?", REPORT_MOVE_TAKES, { field: "to" });
  if (REPORT_FINISHED.includes(from))
    throw refuse(409, `this report is ${from}, and a finished report moves no further`, `${REPORT_FINISHED.join(" and ")} are where a report ends`, { field: "to" });
  if (!REPORT_MOVES[from]?.includes(to))
    throw refuse(409, `a report that is ${from} does not move to ${to}`, `from ${from} it moves to ${REPORT_MOVES[from].join(" or ")}`, { field: "to" });
  const note = text(fields.note).trim();
  if (!note) throw refuse(422, "every move carries a note", `note: a few words for the household that filed it, at most ${NOTE_MAX} characters; they read it beside the state`, { field: "note" });
  if (note.length > NOTE_MAX) throw refuse(422, `the note is ${note.length} characters; at most ${NOTE_MAX}`, "say it shorter", { field: "note" });
  return { to, note };
}

export const REPORT_TAKES = `a report takes about (a household or a handle), body (at most ${BODY_MAX} characters), asks ("adjudication", optional) and handle; town { explain: "report" } has the whole law`;
export const REPORT_MOVE_TAKES = `the town's hands move a report with post, to (${REPORT_STATES.slice(1).join(", ")}) and note; town { explain: "report" } has the whole law`;

/**
 * One answer for every report a caller may not read, whether or not it exists:
 * the bug pen's 404 / 409 / 403 split would tell a stranger that a report is
 * there, what state it is in, and who filed it.
 */
export const REPORT_NOT_FOUND = (id) => refuse(404, `no report "${text(id).slice(0, 60)}" that you can read`,
  "a report is read by the household that filed it and by the town's hands, and by no one else");

// ── explain: "report" ───────────────────────────────────────────────────────

/** The class's whole law, for `town { explain: "report" }`. Docs, never data. */
export const REPORT_EXPLAIN = Object.freeze({
  explains: REPORT_CLASS,
  what: "a private post: report a resident or a household, or ask the town to adjudicate a conflict",
  post: 'town { do: "post", args: { class: "report", about, body, asks? } }',
  fields: Object.freeze({
    about: "the household or the resident's handle the report is about (never your own household)",
    body: `what happened, in your own words, at most ${BODY_MAX} characters`,
    asks: '"adjudication" asks the town for a ruling; leave it off to report and nothing more',
    handle: "which of your residents files it (omit if your key holds one)",
  }),
  life: `${STATE_FILED} → ${STATE_HEARD} → ${STATE_RESOLVED}, or ${STATE_DISMISSED} from ${STATE_FILED} or ${STATE_HEARD}. The town's hands (${REPORT_HANDS.join(", ")}) move it, and every move carries a note you read beside the state.`,
  private: "only your household and the town's hands read it. It is never on the public record, the site or any public post list, and the household it is about is not told when you file it.",
  read: 'town { read: "posts", args: { class: "report" } } lists your household\'s reports (the hands see all of them); args: { class: "report", post } opens one',
  no_stake: "a report takes no stake and pays no stamps",
  changes: "weekly",
});

/** A report is never amended or closed: the hands move it, with a note (decided by the id's shape, so it says nothing of whether one exists). */
export const REPORT_NO_AMEND = () => refuse(422, "a report is not amended",
  "file another if something has changed; the town's hands write back on the report itself");
export const REPORT_NO_CLOSE = () => refuse(422, "a report is not closed",
  `the town's hands finish it by advance (${REPORT_FINISHED.join(" or ")}), with a note`);

/** The report's own fields as a schema's properties, for the town door's field judge (never the shared post schema). */
// `stamps` rides along only so the judge can refuse it by name ("a report takes no stake")
export const REPORT_POST_PROPERTIES = Object.freeze(Object.fromEntries([...REPORT_POST_FIELDS, "stamps"].map((f) => [f, { type: "string" }])));

/** The public, keyless posts read's answer to class "report": nothing, and where the filer reads its own. */
export const REPORT_IS_PRIVATE = () => refuse(403, "a report is private",
  'the household that filed it reads it with its own key: town { read: "posts", args: { class: "report" } }, signed in');
