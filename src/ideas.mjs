// ideas.mjs — THE IDEA CLASS OF THE POST MACHINE (POS-290), pure.
//
// Darko, 2026-10-09 20:09 (POS-290's re-scope): "We should build all the
// plumbing for the idea stuff so that we're not literally manually
// bookkeeping what stage everything's at, because that's what the posts are
// for… but the actual movement through that workflow needs to be fully ad hoc
// and case by case for now." And 20:12: the plumbing ships on the w42 train,
// behind an IDEA_POSTS switch; off means today's idea marks, unchanged.
//
// ── A PERMISSIVE LAW ────────────────────────────────────────────────────────
//
//   posted · in-conversation · ruled-in · building · built · shipped
//   · declined · duplicate
//
// The town's hands (IDEA_HANDS) move an idea to ANY named stage, in any order,
// each move carrying an optional credit, link and note. Nothing gates a stage
// and nothing mints by itself. The one rule is that a finished idea (shipped,
// declined, duplicate) moves no further (Wright, 2026-10-09: finishing is what
// returns the stakes, so it is final).
//
// ── SIGN-UPS ARE RESPONSES ──────────────────────────────────────────────────
//
// "I'm building this part" is a `build` response on the post: one per resident
// per post (the responses key), a second one replacing the first; `piece` may
// name several parts. A resident withdraws their own; the hands accept or
// decline it. None of it pays.
//
// ── THE AWARD RECORDS; A REVIEWED PASS WRITES ───────────────────────────────
//
// An award is a hands-only act naming a resident, an amount and a label. It
// moves no stamps: the reviewed award pass (tools/post-award-plan.mjs, run by
// hand, never on the tick) reads the award acts and writes the town's line
//
//   - <date> · MINT → <who> · N · for: post:<author>/<slug>/<label> · by: <hand>
//
// so every award is traceable to its post. Only wright and keemin award: an
// award moves money, and a meep never handles stamps (Wright, 2026-10-09).

import {
  refuse, TITLE_MAX, INVITATION_MAX, ACT_POST, ACT_ADVANCE, ACT_SIGN_UP, ACT_WITHDRAW_SIGN_UP, ACT_ANSWER_SIGN_UP,
  ACT_AWARD, ACT_STAKE, ACT_UNSTAKE, ACT_RETURN, RESPONSE_BUILD, RESPONSE_STAKE,
} from "./events.mjs";
import { handsOf, holdsHand, notThisHand } from "./named-hand.mjs";
import { LINK_RE, PAID_STAGES, judgeHandleField } from "./bugs.mjs";

export const IDEA_CLASS = "idea";

export const STATE_POSTED = "posted";
export const STATE_SHIPPED = "shipped";
export const STATE_DECLINED = "declined";
export const STATE_DUPLICATE = "duplicate";

/** Every stage an idea may stand in. The hands move it to any of them, in any order. */
export const IDEA_STAGES = Object.freeze([STATE_POSTED, "in-conversation", "ruled-in", "building", "built",
  STATE_SHIPPED, STATE_DECLINED, STATE_DUPLICATE]);
/** The stages an idea is finished in (the Posts project: "every class declares its finished states"). */
export const IDEA_FINISHED = Object.freeze([STATE_SHIPPED, STATE_DECLINED, STATE_DUPLICATE]);

/** Who moves an idea and answers its sign-ups (Wright, 2026-10-09). */
export const IDEA_HANDS = Object.freeze(["wright", "keemin", "architect"]);
/** Who awards stamps on an idea: an award moves money, and meeps never handle stamps. */
export const AWARD_HANDS = Object.freeze(["wright", "keemin"]);
/** The most one award may carry: the pool's ceiling dial (the 10-09 pay ruling). */
export const AWARD_MAX = 200;

// The idea's own acts and response kinds are named in events.mjs beside the
// post machine's, where the one fold (applyPostAct) reads them.
export { ACT_SIGN_UP, ACT_WITHDRAW_SIGN_UP, ACT_ANSWER_SIGN_UP, ACT_AWARD, ACT_STAKE, ACT_UNSTAKE, ACT_RETURN,
  RESPONSE_BUILD, RESPONSE_STAKE };
export const SIGN_UP_ANSWERS = Object.freeze(["accepted", "declined"]);
export const STAKE_SIDES = Object.freeze(["for", "against"]);

export const BODY_MAX = INVITATION_MAX;   // "an idea is a title plus a body of up to 600 characters" (09-28)
export const NOTE_MAX = 600;
export const PIECE_MAX = 300;
/** A slug as the town spells one; the id is `<author>/<slug>`. */
export const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,59}$/;
/** An award's label: never one of the bug's paid stages, so the town's stage line and the award line cannot claim each other. */
export const LABEL_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;

// ── THE SWITCH ──────────────────────────────────────────────────────────────

/** Is the idea class open on this office? Only the exact value `IDEA_POSTS=1` opens it. */
export const ideaPostsOn = (env = process.env) => env.IDEA_POSTS === "1";

export const IDEA_POST_HOW = 'town { do: "post", args: { class: "idea", title, body } }';
/** The refusal every idea-post act answers while the switch is off. */
export const IDEAS_NOT_POSTS = () => refuse(409, "ideas are not posts on this office yet",
  'an idea still stands as a mark at the Think Tank: town { do: "post", args: { class: "idea", slug, body } } publishes one, and town { read: "ideas" } lists them');

// ── the text an idea carries ────────────────────────────────────────────────

function text(name, v, max, { line = false } = {}) {
  if (typeof v !== "string") throw refuse(422, `${name} is text`, `${name}: plain text, at most ${max} characters`, { field: name });
  const s = v.trim();
  if (!s) throw refuse(422, `${name} is empty`, `leave ${name} off rather than sending it empty`, { field: name });
  if (s.length > max) throw refuse(422, `${name} is at most ${max} characters`, `this one is ${s.length}`, { field: name });
  if (line && /[\r\n]/.test(s)) throw refuse(422, `${name} is one line`, `${name}: one line of text`, { field: name });
  return s;
}

/**
 * Judge an idea's text. `partial` is the amendment: only what was sent is
 * judged. `titleOf(body, slug)` names the title when none was sent (the legacy
 * card's `{ slug, body }` keeps working: the title is the claim's first clause).
 * Returns `{ title?, body?, slug? }`.
 */
export function judgeIdeaText(input, { partial = false, titleOf = null } = {}) {
  const out = {};
  if (input.body !== undefined || !partial) {
    if (input.body === undefined) throw refuse(422, "an idea needs a body", `body: the idea, at most ${BODY_MAX} characters`, { field: "body" });
    out.body = text("body", input.body, BODY_MAX);
  }
  if (input.slug !== undefined) {
    const s = typeof input.slug === "string" ? input.slug.trim() : "";
    if (!SLUG_RE.test(s)) throw refuse(422, "slug is the idea's id within your name", "slug: lowercase letters, digits and -, at most 60 — or leave it off and the title names it", { field: "slug" });
    out.slug = s;
  }
  if (input.title !== undefined) out.title = text("title", input.title, TITLE_MAX, { line: true });
  else if (!partial) {
    const t = titleOf ? String(titleOf(out.body, out.slug) ?? "").trim() : "";
    if (!t) throw refuse(422, "an idea needs a title", `title: the idea in a few words (at most ${TITLE_MAX} characters)`, { field: "title" });
    out.title = t.slice(0, TITLE_MAX);
  }
  return out;
}

/** The note an advance, a sign-up's answer or an award may carry. */
export const judgeNote = (v) => text("note", v, NOTE_MAX);

/** An idea's link: the town's own repos, as a bug's (its Discussion, a blueprint, a PR, a tag). */
export function judgeIdeaLink(v) {
  const s = text("link", v, 300, { line: true });
  if (!LINK_RE.test(s))
    throw refuse(422, "link points at the town's own repos", "link: one URL on github.com/postmark-town/ — the Discussion, the blueprint, the PR or the tag that this stage points at", { field: "link" });
  return s;
}

// ── the hands ───────────────────────────────────────────────────────────────

/**
 * The hand: the caller's resident, who must be one of `hands`. The bug's rule
 * (bugs.mjs § judgeBugHand): the named handle if it is yours, your only one, or
 * the one of yours that is a hand; and the hand is this credential's own.
 */
export function judgeHand(fields, key, { hands = IDEA_HANDS, act }) {
  const held = [...(key?.handles ?? [])];
  const named = typeof fields?.handle === "string" ? fields.handle.trim() : "";
  if (named && !held.includes(named)) throw refuse(403, `"${named}" is not one of your residents`, `your key acts for ${held.join(", ") || "no resident"}`);
  const hand = named || (held.length === 1 ? held[0] : [...handsOf(key)].find((h) => hands.includes(h)) ?? "");
  if (!hand || !hands.includes(hand))
    throw refuse(403, `only the town's hands ${act}`, `on an idea that is ${hands.join(", ")}; anyone may post one with ${IDEA_POST_HOW}`);
  if (!holdsHand(key, hand)) { const r = notThisHand(hand, key); throw refuse(403, r.defect, r.hint); }
  return hand;
}

// ── the advance ─────────────────────────────────────────────────────────────

/**
 * Judge an advance against the idea's current row. Returns `{ to, credit?,
 * link?, note?, of? }`. Any named stage, in any order; a finished idea moves
 * no further, and an advance to where it stands is nothing to do.
 */
export function judgeIdeaAdvance(fields, prev, roll) {
  const to = typeof fields?.to === "string" ? fields.to.trim() : "";
  const STAGES = `to: one of ${IDEA_STAGES.join(", ")}`;
  if (!to) throw refuse(422, "advance to which stage?", STAGES, { field: "to" });
  if (!IDEA_STAGES.includes(to)) throw refuse(422, `"${to}" is not a stage an idea stands in`, STAGES, { field: "to" });
  if (IDEA_FINISHED.includes(prev.state))
    throw refuse(409, `"${prev.id}" is finished (${prev.state})`, "a finished idea moves no further: finishing it is what returns its stakes. Post a new one if it came back");
  if (to === prev.state) throw refuse(409, `"${prev.id}" already stands ${to}`, `nothing to do — ${STAGES}`, { field: "to" });
  const out = { to };
  if (fields.credit !== undefined) out.credit = judgeHandleField("credit", fields.credit, roll);
  if (fields.link !== undefined) out.link = judgeIdeaLink(fields.link);
  if (fields.note !== undefined) out.note = judgeNote(fields.note);
  if (fields.of !== undefined && to !== STATE_DUPLICATE) throw refuse(422, "of is duplicate's", "only an advance to duplicate names the idea it duplicates", { field: "of" });
  if (to === STATE_DUPLICATE) {
    const of = typeof fields.of === "string" ? fields.of.trim() : "";
    if (!of) throw refuse(422, "a duplicate names the idea it duplicates", 'of: "<author>/<slug>", the idea post or the Think Tank mark it repeats', { field: "of" });
    if (of === prev.id) throw refuse(422, "an idea is not a duplicate of itself", "of: the other idea", { field: "of" });
    out.of = of;
  }
  return out;
}

// ── the sign-up ─────────────────────────────────────────────────────────────

/** A sign-up's text: `{ piece, note? }`. */
export function judgeSignUp(fields) {
  if (fields.piece === undefined) throw refuse(422, "which part are you building?", `piece: the part (or parts) you are taking on, at most ${PIECE_MAX} characters`, { field: "piece" });
  return { piece: text("piece", fields.piece, PIECE_MAX), ...(fields.note !== undefined ? { note: judgeNote(fields.note) } : {}) };
}

/** A hand's answer to a sign-up: `{ resident, answer, note? }`. */
export function judgeSignUpAnswer(fields, roll) {
  const resident = judgeHandleField("resident", fields.resident, roll);
  const answer = typeof fields.answer === "string" ? fields.answer.trim() : "";
  if (!SIGN_UP_ANSWERS.includes(answer)) throw refuse(422, "answer the sign-up", `answer: ${SIGN_UP_ANSWERS.join(" or ")}`, { field: "answer" });
  return { resident, answer, ...(fields.note !== undefined ? { note: judgeNote(fields.note) } : {}) };
}

// ── the award ───────────────────────────────────────────────────────────────

/**
 * Judge an award. `used` is the labels already awarded on this post; `isMeep`
 * the town's meep law for today. Returns `{ to, stamps, label, note? }`.
 */
export function judgeAward(fields, roll, { used = new Set(), isMeep = () => false } = {}) {
  const to = judgeHandleField("to", fields.to, roll);
  if (isMeep(to)) throw refuse(422, `"${to}" is a meep, and a meep never receives stamps`, "award the resident who did the work");
  const n = Number(fields.stamps);
  if (!Number.isInteger(n) || n < 1 || n > AWARD_MAX)
    throw refuse(422, `stamps is a whole number from 1 to ${AWARD_MAX}`, `this award's stamps: ${JSON.stringify(fields.stamps)}`, { field: "stamps" });
  const label = typeof fields.label === "string" ? fields.label.trim() : "";
  if (!LABEL_RE.test(label))
    throw refuse(422, "label names what the award is for", "label: lowercase letters, digits and -, at most 40 — e.g. design, the-map-piece", { field: "label" });
  if (PAID_STAGES.includes(label))
    throw refuse(422, `"${label}" is a bug's stage, and an award's label is never one`, `the ledger reads post:<id>/${label} as a bug's stage pay; name the award something else`, { field: "label" });
  if (used.has(label)) throw refuse(409, `"${label}" is already awarded on this idea`, "one award per label per idea: name this one differently", { field: "label" });
  return { to, stamps: n, label, ...(fields.note !== undefined ? { note: judgeNote(fields.note) } : {}) };
}

/** The award line's grammar (the town's stamp-mint.mjs § the award line), read only to find what an award paid. */
const AWARD_LINE_RE = new RegExp(String.raw`^- \d{4}-\d{2}-\d{2} · MINT → (\S+) · ([1-9]\d*) · for: post:([a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9-]*)\/(?!(?:${PAID_STAGES.join("|")}) )([a-z0-9][a-z0-9-]{0,39}) · by: (${AWARD_HANDS.join("|")})$`);

/** A ledger line's award, `{ post, label, handle, n, by }`, or null for any other line. */
export function awardPaidOf(canonical) {
  const m = AWARD_LINE_RE.exec(String(canonical ?? ""));
  return m ? { handle: m[1], n: Number(m[2]), post: m[3], label: m[4], by: m[5] } : null;
}

// ── THE HISTORY, THE AWARDS, THE BACKING (pure) ─────────────────────────────

const payloadOf = (a) => (typeof a.payload === "string" ? JSON.parse(a.payload) : (a.payload ?? {}));
const isoOf = (v) => new Date(v).toISOString();

/**
 * Every idea's history: one row per post or advance act, oldest first,
 * `{ stage, at, hand, credit, link, note }`. Returns Map(post id → rows).
 */
export function ideaHistoryOf(acts) {
  const out = new Map();
  for (const a of acts) {
    if (a.action !== ACT_POST && a.action !== ACT_ADVANCE) continue;
    const p = payloadOf(a);
    const post = String(a.object);
    const row = a.action === ACT_POST
      ? { stage: STATE_POSTED, at: isoOf(a.at), hand: p.hand ?? null, credit: a.actor ?? null, link: null, note: null }
      : { stage: p.to, at: isoOf(a.at), hand: p.hand ?? a.actor ?? null, credit: p.credit ?? null, link: p.link ?? null, note: p.note ?? null };
    out.set(post, [...(out.get(post) ?? []), row]);
  }
  return out;
}

/**
 * Every idea's awards, oldest first, `{ label, to, stamps, hand, at, note,
 * stamps_paid }`. `paid` is Map("<post>/<label>" → n) from the store's stamp
 * chain, or null when the store holds none (stamps_paid is then null).
 */
export function ideaAwardsOf(acts, paid = null) {
  const out = new Map();
  for (const a of acts) {
    if (a.action !== ACT_AWARD) continue;
    const p = payloadOf(a);
    const post = String(a.object);
    out.set(post, [...(out.get(post) ?? []), { label: p.label, to: p.to, stamps: Number(p.stamps), hand: p.hand ?? a.actor ?? null,
      at: isoOf(a.at), note: p.note ?? null, stamps_paid: paid?.get(`${post}/${p.label}`) ?? null }]);
  }
  return out;
}

/** The labels already awarded on one post, from its award acts. */
export const awardLabelsOf = (acts) => new Set(acts.filter((a) => a.action === ACT_AWARD).map((a) => payloadOf(a).label));

/**
 * The backing and the sign-ups, from the post's responses (`{ handle, kind,
 * state, fields }`). Backing counts the stakes that stand: `{ for, against,
 * net, stakers }`.
 */
export function ideaResponsesOf(responses) {
  const backing = { for: 0, against: 0, net: 0, stakers: 0 };
  const sign_ups = [];
  for (const r of [...responses].sort((a, b) => a.handle.localeCompare(b.handle))) {
    const f = typeof r.fields === "string" ? JSON.parse(r.fields) : (r.fields ?? {});
    if (r.kind === RESPONSE_STAKE && r.state === "standing" && Number(f.n) > 0 && STAKE_SIDES.includes(f.side)) {
      backing[f.side] += Number(f.n);
      backing.stakers += 1;
    }
    if (r.kind === RESPONSE_BUILD)
      sign_ups.push({ handle: r.handle, piece: f.piece ?? null, note: f.note ?? null, state: r.state, ...(f.answer_note ? { answer_note: f.answer_note } : {}) });
  }
  backing.net = backing.for - backing.against;
  return { backing, sign_ups };
}
