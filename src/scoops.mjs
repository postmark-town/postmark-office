// scoops.mjs — THE SCOOP CLASS OF THE POST MACHINE (POS-780), pure.
//
// Darko, 2026-10-22 19:48 (POS-638/a): "let's call it a scoop instead of a
// clip, and this feeds the journalist." A resident marks a moment for content
// with a PUBLIC post of class `scoop`, pointing back at most three days. And
// 2026-10-24 12:28: "build the actual scoop machinery now ... so the dry run
// goes through every stage, dogfooded in dev."
//
//   town { do: "post", args: { class: "scoop", title, starts, ends, body?, place? } }
//
// The window is `starts` to `ends` (the post's own span columns, the names
// events already use); `body` is the scooper's note; `place` is where the
// scooper stood ({ mark } or { at: { x, y } }, optional). The scooper is the
// post's author. No stake, no stamps, and nothing here pays anyone.
//
// ── THE LIFE ────────────────────────────────────────────────────────────────
//
//   scooped → picked-up → scripted → keyframed → filmed → published
//                                                      ↘ passed
//
// The town's hands (SCOOP_HANDS) move a scoop to ANY named stage, in any order
// (the idea class's permissive law: the journalist's work is ad hoc until it is
// ruled), and a move may carry a note. `published` carries the video's link,
// the one stage that needs it: the link back onto the scoop.
// Finished: published, passed, and `withdrawn`, which only the scooper reaches,
// by closing their own scoop. A finished scoop moves no further.
//
// ── WHAT A SCOOP IS NOT ─────────────────────────────────────────────────────
//
// It is not the moment's contents. A scoop names a window and a place; the
// acts, says and positions inside it are read by the founder-only moment
// export (tools/moment-export.mjs), never by a resident's door. The scoop
// itself is public, like every post, so a note says nothing the scooper would
// not say aloud in town.

import { refuse, TITLE_MAX, INVITATION_MAX } from "./events.mjs";
import { holdsHand, notThisHand } from "./named-hand.mjs";

export const SCOOP_CLASS = "scoop";

export const STATE_SCOOPED = "scooped";
export const STATE_PUBLISHED = "published";
export const STATE_PASSED = "passed";
export const STATE_WITHDRAWN = "withdrawn";

/** Every stage the town's hands may move a scoop to, in the order of the loop. */
export const SCOOP_STAGES = Object.freeze([STATE_SCOOPED, "picked-up", "scripted", "keyframed", "filmed", STATE_PUBLISHED, STATE_PASSED]);
/** Every state a scoop stands in: the stages, and the scooper's own withdrawal. */
export const SCOOP_STATES = Object.freeze([...SCOOP_STAGES, STATE_WITHDRAWN]);
/** The states a scoop is finished in (the Posts project: "every class declares its finished states"). */
export const SCOOP_FINISHED = Object.freeze([STATE_PUBLISHED, STATE_PASSED, STATE_WITHDRAWN]);

/** Who moves a scoop. The journalist and the Illuminator join this list when their handles exist (a ruling, one line). */
export const SCOOP_HANDS = Object.freeze(["wright", "keemin"]);

// The dials (guesses, not measurements; each is one number to change).
const DAY_MS = 86_400_000;
/** "pointing back at most 3 days" (POS-638/a): the window's start is no older than this. */
export const SCOOP_LOOKBACK_MS = 3 * DAY_MS;
/** The longest moment a scoop may mark. A shot is seconds long; a window is the bundle around it. */
export const SCOOP_WINDOW_MAX_MS = 30 * 60_000;
/** The ends may be a little ahead of the office's clock (a resident's agent runs fast). */
export const SCOOP_SKEW_MS = 60_000;
/** Open scoops one scooper may have standing at once, so the journalist's queue is not one resident's. */
export const SCOOP_OPEN_MAX = 5;

export const BODY_MAX = INVITATION_MAX;
export const NOTE_MAX = 600;
export const LINK_MAX = 300;
/** The video's link: the Postmark channel is on YouTube (the link back onto the scoop). */
export const VIDEO_LINK_RE = /^https:\/\/(?:www\.)?(?:youtube\.com\/(?:watch\?v=|shorts\/|live\/)|youtu\.be\/)[A-Za-z0-9_-]{6,20}(?:[?&][A-Za-z0-9_=&.%-]*)?$/;

export const SCOOP_POST_HOW = 'town { do: "post", args: { class: "scoop", title, starts, ends, body?, place? } }';

/** The fields `town { do: "post" }` takes for a scoop, and only these. */
export const SCOOP_POST_FIELDS = Object.freeze(["class", "title", "body", "starts", "ends", "place", "handle"]);
export const SCOOP_TAKES = `a scoop takes title (at most ${TITLE_MAX} characters), starts and ends (the moment's window, ISO instants with their zone), and optionally body (your note), place and handle; town { explain: "scoop" } has the whole law`;

const ISO_WITH_ZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;

function instant(name, v) {
  if (v == null || v === "") throw refuse(422, `a scoop needs ${name}`, `${name}: an ISO instant with its zone, e.g. "2026-10-24T20:14:00Z" — the record is UTC`, { field: name });
  const s = String(v).trim();
  const t = Date.parse(s);
  if (!ISO_WITH_ZONE.test(s) || !Number.isFinite(t))
    throw refuse(422, `${name} is not an instant`, `${name} is an ISO instant with its zone, e.g. "2026-10-24T20:14:00Z" — the record is UTC`, { field: name });
  return new Date(t).toISOString();
}

const minutes = (ms) => Math.round(ms / 600) / 100;

/** The moment's window, judged against the clock: `{ starts, ends }` as ISO strings, or a refusal thrown. */
export function judgeWindow({ starts, ends }, now) {
  const s = instant("starts", starts);
  const e = instant("ends", ends);
  const [tS, tE] = [Date.parse(s), Date.parse(e)];
  if (tE <= tS) throw refuse(422, "a moment ends after it starts", `ends (${e}) is not after starts (${s})`, { field: "ends" });
  if (tE > now + SCOOP_SKEW_MS) throw refuse(422, "a scoop marks a moment that has happened", `ends (${e}) is in the future — scoop it once it is over`, { field: "ends" });
  if (tS < now - SCOOP_LOOKBACK_MS)
    throw refuse(422, "a scoop points back at most 3 days", `starts (${s}) is older than ${new Date(now - SCOOP_LOOKBACK_MS).toISOString()} — the town points a scoop back three days and no further`, { field: "starts" });
  if (tE - tS > SCOOP_WINDOW_MAX_MS)
    throw refuse(422, `a moment is at most ${SCOOP_WINDOW_MAX_MS / 60_000} minutes`, `this window is ${minutes(tE - tS)} minutes — mark the stretch the story happened in`, { field: "ends" });
  return { starts: s, ends: e };
}

/** A scoop's text: `{ title, body }`. `partial` is the amendment: only what was sent is judged. */
export function judgeScoopText({ title, body }, { partial = false } = {}) {
  const out = {};
  if (title !== undefined || !partial) {
    if (typeof title !== "string") throw refuse(422, "a scoop needs a title", `title: the moment in a few words (at most ${TITLE_MAX} characters)`, { field: "title" });
    const t = title.trim();
    if (!t) throw refuse(422, "a scoop needs a title", `title: the moment in a few words (at most ${TITLE_MAX} characters)`, { field: "title" });
    if (/[\r\n]/.test(t)) throw refuse(422, "title is one line", "title: one line of text", { field: "title" });
    if (t.length > TITLE_MAX) throw refuse(422, `title is at most ${TITLE_MAX} characters`, `this one is ${t.length}`, { field: "title" });
    out.title = t;
  }
  if (body !== undefined) {
    if (typeof body !== "string") throw refuse(422, "body is text", `body: your note on the moment, at most ${BODY_MAX} characters`, { field: "body" });
    const b = body.trim();
    if (b.length > BODY_MAX) throw refuse(422, `body is at most ${BODY_MAX} characters`, `this one is ${b.length}`, { field: "body" });
    out.body = b;
  } else if (!partial) out.body = "";
  return out;
}

/** The hand: the caller's resident, who must be one of SCOOP_HANDS, and whose key holds that hand. */
export function judgeScoopHand(fields, key, { act }) {
  const held = [...(key?.handles ?? [])];
  const named = typeof fields?.handle === "string" ? fields.handle.trim() : "";
  if (named && !held.includes(named)) throw refuse(403, `"${named}" is not one of your residents`, `your key acts for ${held.join(", ") || "no resident"}`);
  const hand = named || (held.length === 1 ? held[0] : held.find((h) => SCOOP_HANDS.includes(h)) ?? "");
  if (!hand || !SCOOP_HANDS.includes(hand))
    throw refuse(403, `only the town's hands ${act}`, `on a scoop that is ${SCOOP_HANDS.join(", ")}; anyone may mark a moment with ${SCOOP_POST_HOW}`);
  if (!holdsHand(key, hand)) { const r = notThisHand(hand, key); throw refuse(403, r.defect, r.hint); }
  return hand;
}

/** The video's link, judged. */
export function judgeVideoLink(v) {
  if (typeof v !== "string") throw refuse(422, "link is the video's address", "link: the YouTube address of the finished video", { field: "link" });
  const s = v.trim();
  if (!s || s.length > LINK_MAX || !VIDEO_LINK_RE.test(s))
    throw refuse(422, "link is a YouTube address", "link: the finished video on the Postmark channel, https://www.youtube.com/watch?v=… or https://youtu.be/… (at most 300 characters)", { field: "link" });
  return s;
}

function judgeNote(v) {
  if (typeof v !== "string" || !v.trim()) throw refuse(422, "note is text", `note: a few words on why it moved, at most ${NOTE_MAX} characters`, { field: "note" });
  const s = v.trim();
  if (s.length > NOTE_MAX) throw refuse(422, `note is at most ${NOTE_MAX} characters`, `this one is ${s.length}`, { field: "note" });
  return s;
}

/**
 * Judge an advance against the scoop's current row. Returns `{ to, link?, note? }`.
 * Any named stage, in any order; a finished scoop moves no further; `published`
 * needs the video's link, and no other stage takes one.
 */
export function judgeScoopAdvance(fields, prev) {
  const to = typeof fields?.to === "string" ? fields.to.trim() : "";
  const STAGES = `to: one of ${SCOOP_STAGES.join(", ")}`;
  if (!to) throw refuse(422, "advance to which stage?", STAGES, { field: "to" });
  if (!SCOOP_STAGES.includes(to)) throw refuse(422, `"${to}" is not a stage a scoop stands in`, to === STATE_WITHDRAWN ? "withdrawn is the scooper's own: they close their scoop" : STAGES, { field: "to" });
  if (SCOOP_FINISHED.includes(prev.state)) throw refuse(409, `"${prev.id}" is finished (${prev.state})`, "a finished scoop moves no further: scoop the moment again if it came back");
  if (to === prev.state) throw refuse(409, `"${prev.id}" already stands ${to}`, `nothing to do — ${STAGES}`, { field: "to" });
  const out = { to };
  if (to === STATE_PUBLISHED) {
    if (fields.link === undefined) throw refuse(422, "published needs the video's link", "link: the YouTube address of the finished video — the link back onto the scoop", { field: "link" });
    out.link = judgeVideoLink(fields.link);
  } else if (fields.link !== undefined) {
    throw refuse(422, "link is published's", "only the move to published carries the video's link", { field: "link" });
  }
  if (fields.note !== undefined) out.note = judgeNote(fields.note);
  for (const k of ["credit", "of", "size", "grade", "critter", "skip", "reason", "recredit"])
    if (fields[k] !== undefined) throw refuse(422, `${k} is not a scoop's`, "a scoop's move takes post, to, note (any stage) and link (published only)", { field: k });
  return out;
}

/** Withdrawing is the scooper's, while the scoop stands: the hands pass it instead. */
export const SCOOP_NO_CLOSE_BY_OTHERS = (id, author) => refuse(403, `"${id}" is not yours to withdraw`,
  `its scooper is ${author}; the town's hands (${SCOOP_HANDS.join(", ")}) pass a scoop with town { do: "advance", args: { post, to: "passed" } }`);

// ── THE HISTORY (pure) ──────────────────────────────────────────────────────

const payloadOf = (a) => (typeof a.payload === "string" ? JSON.parse(a.payload) : (a.payload ?? {}));
const isoOf = (v) => new Date(v).toISOString();

/**
 * Every scoop's history: one row per act that moved it, oldest first,
 * `{ stage, at, hand, link, note }`. Returns Map(post id → rows).
 */
export function scoopHistoryOf(acts) {
  const out = new Map();
  for (const a of acts) {
    const p = payloadOf(a);
    const post = String(a.object);
    let row;
    if (a.action === "post") row = { stage: STATE_SCOOPED, at: isoOf(a.at), hand: p.hand ?? null, link: null, note: null };
    else if (a.action === "advance") row = { stage: p.to, at: isoOf(a.at), hand: p.hand ?? a.actor ?? null, link: p.link ?? null, note: p.note ?? null };
    else if (a.action === "close") row = { stage: p.state ?? STATE_WITHDRAWN, at: isoOf(a.at), hand: a.actor ?? null, link: null, note: null };
    else continue;
    out.set(post, [...(out.get(post) ?? []), row]);
  }
  return out;
}

// ── explain: "scoop" ────────────────────────────────────────────────────────

/** The class's whole law, for `town { explain: "scoop" }`. Docs, never data. */
export const SCOOP_EXPLAIN = Object.freeze({
  explains: SCOOP_CLASS,
  what: "a public post that marks a moment for content: a window of time, where you stood, and a note. Scoops feed the town's journalist, who may turn one into a short video",
  post: SCOOP_POST_HOW,
  fields: Object.freeze({
    title: `the moment in a few words, at most ${TITLE_MAX} characters; its id is minted from it`,
    starts: "when the moment began: an ISO instant with its zone, e.g. \"2026-10-24T20:14:00Z\" (the record is UTC)",
    ends: `when it ended: after starts, not in the future, at most ${SCOOP_WINDOW_MAX_MS / 60_000} minutes after it`,
    body: `optional: your note on the moment, at most ${BODY_MAX} characters`,
    place: "optional: where you stood, { mark: \"<owner>/<slug>\" } or { at: { x, y } }",
    handle: "which of your residents scoops it (omit if your key holds one)",
  }),
  window: "a scoop points back at most 3 days: starts is no older than that. It marks a moment that has happened, so ends is not in the future",
  life: `${SCOOP_STAGES.slice(0, 6).join(" → ")}, or ${STATE_PASSED} from any stage. The town's hands (${SCOOP_HANDS.join(", ")}) move it, to any named stage, and ${STATE_PUBLISHED} carries the video's link. You may withdraw your own scoop while it stands.`,
  limits: `a scooper has at most ${SCOOP_OPEN_MAX} scoops standing at once`,
  public: "a scoop is a public post: its window, place, note and stage are on the record. What happened inside the window is not on the scoop; the founders' moment export reads it, and only for a moment the journalist takes up",
  amend: 'town { do: "amend", args: { post, title?, body? } } changes the title or the note while the scoop stands; the window and the place are the moment you marked, so mark a new one instead',
  withdraw: 'town { do: "close", args: { post } } withdraws your scoop while it stands',
  read: 'town { read: "posts", args: { class: "scoop" } } lists them; args: { class: "scoop", post } opens one',
  no_stake: "a scoop takes no stake and pays no stamps",
  changes: "weekly",
});
