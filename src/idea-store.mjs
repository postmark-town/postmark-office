// idea-store.mjs — THE IDEA CLASS'S PEN AND ITS READ HELPERS (POS-290).
//
// The rules are ideas.mjs's, pure. This file is where they meet the record, in
// the bug pen's shape (events-store.mjs § the bug class): every act is ONE
// `officeWrite` transaction that reads what it needs, inserts the act through
// the pen's `insertAct`, and writes the row `applyPostAct` derives from it on
// the same client. A refusal thrown inside rolls the whole thing back, so a
// refused act leaves the acts count where it was.
//
// An idea's acts are anchorless (class `idea`): it has no place and no span.
// The act's actor is who did it. A post names its author as the actor (so the
// one fold makes them the author and their household the post's), and when a
// hand put it up on their behalf (`for`) the payload names the hand. Every act a
// hand makes carries `hand` in the payload.
//
// ── THE SWITCH ──────────────────────────────────────────────────────────────
//
// Every act here answers IDEAS_NOT_POSTS while IDEA_POSTS is off. The reads
// are not switched: they report what the store holds, which is nothing until
// the switch has been on.

import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { officeRead, officeWrite, insertAct, PenUnreachableError } from "./world2-pen.mjs";
import { householdKeyFor } from "./world2-claims.mjs";
import { currentCrossing } from "./crossings.mjs";
import {
  refuse, applyPostAct, slugFromTitle, ACT_POST, ACT_AMEND_POST, ACT_ADVANCE, ACT_SIGN_UP, ACT_WITHDRAW_SIGN_UP,
  ACT_ANSWER_SIGN_UP, ACT_AWARD, RESPONSE_BUILD, RESPONSE_STAKE,
} from "./events.mjs";
import { POST_COLUMNS, rowOf, insertPost, updatePost, standpointHandle } from "./events-store.mjs";
import { judgeHandleField } from "./bugs.mjs";
import {
  IDEA_CLASS, IDEA_HANDS, AWARD_HANDS, IDEA_FINISHED, STATE_POSTED, STATE_DUPLICATE, ideaPostsOn, IDEAS_NOT_POSTS,
  judgeIdeaText, judgeIdeaAdvance, judgeHand, judgeSignUp, judgeSignUpAnswer, judgeAward, awardLabelsOf,
} from "./ideas.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const TOWN_CLONE = () => process.env.TOWN_CLONE ?? resolve(HERE, "..", "town-clone");

const isRefusal = (e) => e && typeof e.code === "number" && typeof e.defect === "string";

async function write(fn, env) {
  try {
    return await officeWrite(fn, { env });
  } catch (e) {
    if (isRefusal(e)) throw e;
    if (e?.name === "LateCrossingError") throw refuse(409, e.message, "the act was stamped for a candle the record will not take; nothing was written");
    const pen = new PenUnreachableError(e);
    throw refuse(503, pen.message,
      "this door's pen is the office's record; when it cannot be reached the door refuses rather than writing anywhere else — the act is safe to try again");
  }
}

function on(env) {
  if (!ideaPostsOn(env)) throw IDEAS_NOT_POSTS();
}

export async function ideaRow(client, id) {
  const { rows } = await client.query(`SELECT ${POST_COLUMNS} FROM posts WHERE id = $1 AND class = $2`, [id, IDEA_CLASS]);
  return rowOf(rows[0]);
}

/** Is this id an idea post? For the class router; a store that cannot be read answers no. */
export async function isIdeaPost(id, { env = process.env } = {}) {
  try { return Boolean(await officeRead((client) => ideaRow(client, String(id)), { env })); }
  catch { return false; }
}

function actRow({ action, actor, object, payload, now }) {
  return {
    written_at: new Date(now).toISOString(), crossing: currentCrossing(now),
    actor, action, object,
    at_anchor: null, at_dx: null, at_dy: null, witnesses: null,
    class: IDEA_CLASS, payload: JSON.stringify(payload),
    effect: null, household: actor,   // insertAct resolves the actor's house
  };
}

const readHint = (id) => `town { read: "posts", args: { class: "idea", post: "${id}" } } — or GET /posts/${id}?class=idea`;
const answerOf = (row) => ({ id: row.id, class: IDEA_CLASS, title: row.title, body: row.body, author: row.author,
  household: row.household ?? null, state: row.state, fields: row.fields });

async function mustIdea(client, id) {
  const prev = await ideaRow(client, id);
  if (!prev) throw refuse(404, `no idea "${id}"`, 'town { read: "posts", args: { class: "idea" } } lists them');
  return prev;
}

/**
 * The id a new idea takes: `<author>/<slug>`, never reused, and never one a
 * Think Tank mark already holds (the tank shows both, so an id names one thing).
 * A slug the caller chose is theirs or refused; one minted from the title takes
 * `-2`, `-3`, … while held.
 */
async function mintIdeaId(client, author, { slug, title }) {
  const { rows: posts } = await client.query("SELECT id FROM posts WHERE id LIKE $1", [`${author}/%`]);
  const { rows: marks } = await client.query("SELECT slug FROM marks WHERE slug LIKE $1", [`${author}/%`]);
  const held = new Set([...posts.map((r) => r.id), ...marks.map((r) => r.slug)]);
  if (slug) {
    const id = `${author}/${slug}`;
    if (held.has(id)) throw refuse(409, `"${id}" is taken`, "an id is never reused, and a Think Tank mark holds some — choose another slug, or leave slug off and the title names it", { field: "slug" });
    return id;
  }
  const base = slugFromTitle(title);
  if (!base) throw refuse(422, "the title mints no id", "an idea's id is <author>/<slug>, from the title's letters and digits — give the title at least one, or send slug", { field: "title" });
  if (!held.has(`${author}/${base}`)) return `${author}/${base}`;
  for (let n = 2; n < 1000; n++) if (!held.has(`${author}/${base}-${n}`)) return `${author}/${base}-${n}`;
  throw refuse(409, `"${author}/${base}" has been used too many times`, "give this idea a different title");
}

// ── post ────────────────────────────────────────────────────────────────────

/** Post an idea: one `post` act, one `posts` row, posted. `titleOf(body, slug)` names a title when none is sent. */
export async function postIdea(fields, key, { now = Date.now(), env = process.env, roll = null, titleOf = null } = {}) {
  on(env);
  let author;
  let hand = null;
  if (fields.for !== undefined) {
    hand = judgeHand(fields, key, { act: "post an idea on a resident's behalf" });
    author = judgeHandleField("for", fields.for, roll);
  } else {
    author = standpointHandle(fields, key);
  }
  const t = judgeIdeaText({ title: fields.title, body: fields.body, slug: fields.slug }, { titleOf });
  return write(async (client) => {
    const id = await mintIdeaId(client, author, t);
    const payload = { post: id, class: IDEA_CLASS, title: t.title, body: t.body, state: STATE_POSTED, fields: {}, ...(hand ? { hand } : {}) };
    const actId = await insertAct(client, actRow({ action: ACT_POST, actor: author, object: id, payload, now }));
    const household = await householdKeyFor(client, author);
    const row = applyPostAct({ posts: new Map(), responses: new Map() },
      { id: actId, action: ACT_POST, actor: author, object: id, payload, household });
    await insertPost(client, row);
    return { post: answerOf(row), act_id: actId, ...(hand ? { hand } : {}),
      receipt: `posted: ${id} (an idea), by ${author}${hand ? `, put up by ${hand}'s hand` : ""}. It stands posted; the town's hands (${IDEA_HANDS.join(", ")}) move it along, and anyone may sign up to build a part with town { do: "sign-up", args: { post: "${id}", piece } }. It is a post, not a mark: it is in the Think Tank now, and it never crosses the settlement.`,
      read: readHint(id) };
  }, env);
}

// ── amend ───────────────────────────────────────────────────────────────────

/** Amend an idea's title or body: its author, or a hand, until it is finished. Only what changes is recorded. */
export async function amendIdea(fields, key, id, { now = Date.now(), env = process.env } = {}) {
  on(env);
  const acting = standpointHandle(fields, key);
  const t = judgeIdeaText({ title: fields.title, body: fields.body }, { partial: true });
  return write(async (client) => {
    const prev = await mustIdea(client, id);
    if (IDEA_FINISHED.includes(prev.state)) throw refuse(409, `"${id}" is finished (${prev.state})`, "a finished idea is not amended");
    const isHand = IDEA_HANDS.includes(acting);
    if (!isHand && acting !== prev.author)
      throw refuse(403, `"${id}" is not yours to amend`, `its author is ${prev.author}; after them, only the town's hands (${IDEA_HANDS.join(", ")}) amend an idea`);
    if (isHand && acting !== prev.author) judgeHand({ handle: acting }, key, { act: "amend someone else's idea" });
    const changed = ["title", "body"].filter((k) => t[k] !== undefined && t[k] !== prev[k]);
    if (!changed.length) throw refuse(422, "nothing to amend", `every field you sent already stands on "${id}"`);
    const payload = { post: id, changed };
    for (const k of changed) payload[k] = t[k];
    if (acting !== prev.author) payload.hand = acting;
    const actId = await insertAct(client, actRow({ action: ACT_AMEND_POST, actor: acting, object: id, payload, now }));
    const row = applyPostAct({ posts: new Map([[id, prev]]), responses: new Map() },
      { id: actId, action: ACT_AMEND_POST, actor: acting, object: id, payload, household: prev.household });
    await updatePost(client, row);
    return { post: answerOf(row), act_id: actId, amended: changed,
      receipt: `amended: ${id} (${changed.join(", ")}) — revision ${row.revised}; only these fields changed, and the act log keeps every revision`,
      read: readHint(id) };
  }, env);
}

// ── advance ─────────────────────────────────────────────────────────────────

/** Move an idea to any named stage, by a hand, with credit, link and note. It mints nothing. */
export async function advanceIdea(fields, key, id, { now = Date.now(), env = process.env, roll = null } = {}) {
  on(env);
  const hand = judgeHand(fields, key, { act: "move an idea" });
  return write(async (client) => {
    const prev = await mustIdea(client, id);
    const j = judgeIdeaAdvance(fields, prev, roll);
    if (j.of) {
      const isPost = Boolean(await ideaRow(client, j.of));
      const { rows: mark } = isPost ? { rows: [true] } : await client.query("SELECT slug FROM marks WHERE slug = $1", [j.of]);
      if (!mark.length) throw refuse(404, `no idea "${j.of}" to be a duplicate of`, "of: an idea post or a Think Tank mark — town { read: \"ideas\" } lists both", { field: "of" });
    }
    const set = { ...(j.link ? { links: { ...(prev.fields?.links ?? {}), [j.to]: j.link } } : {}), ...(j.of ? { of: j.of } : {}) };
    const payload = { post: id, from: prev.state, to: j.to, ...(j.credit ? { credit: j.credit } : {}), ...(j.link ? { link: j.link } : {}),
      ...(j.note ? { note: j.note } : {}), ...(Object.keys(set).length ? { fields: set } : {}), hand };
    const actId = await insertAct(client, actRow({ action: ACT_ADVANCE, actor: hand, object: id, payload, now }));
    const row = applyPostAct({ posts: new Map([[id, prev]]), responses: new Map() },
      { id: actId, action: ACT_ADVANCE, actor: hand, object: id, payload, household: prev.household });
    await updatePost(client, row);
    const finished = IDEA_FINISHED.includes(j.to);
    return { post: answerOf(row), act_id: actId, hand, stage: j.to, ...(j.credit ? { credit: j.credit } : {}),
      receipt: `advanced: ${id} ${prev.state} → ${j.to} by ${hand}'s hand${j.credit ? `, crediting ${j.credit}` : ""}${j.link ? `; it points at ${j.link}` : ""}${j.to === STATE_DUPLICATE ? `; it repeats ${j.of}` : ""}. A stage pays nothing by itself: stamps are awarded by hand (town { do: "award" }).${finished ? " It is finished, and moves no further." : ""}`,
      read: readHint(id) };
  }, env);
}

// ── sign-up · withdraw · answer ─────────────────────────────────────────────

async function buildResponse(client, id, handle) {
  const { rows } = await client.query(
    "SELECT post, handle, household, kind, state, fields, act FROM responses WHERE post = $1 AND handle = $2 AND kind = $3",
    [id, handle, RESPONSE_BUILD]);
  const r = rows[0];
  return r ? { ...r, act: Number(r.act), fields: typeof r.fields === "string" ? JSON.parse(r.fields) : { ...(r.fields ?? {}) } } : null;
}

async function writeResponse(client, r) {
  await client.query(
    `INSERT INTO responses (post, handle, household, kind, state, fields, act) VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (post, handle, kind) DO UPDATE SET household = EXCLUDED.household, state = EXCLUDED.state,
       fields = EXCLUDED.fields, act = EXCLUDED.act`,
    [r.post, r.handle, r.household, r.kind, r.state, JSON.stringify(r.fields ?? {}), r.act]);
}

/**
 * `town { do: "sign-up", args: { post, piece, note? } }` — "I'm building this
 * part", as a `build` response. A second sign-up replaces the first; `withdraw:
 * true` withdraws it.
 */
export async function signUpAtTown(fields, key, { now = Date.now(), env = process.env } = {}) {
  on(env);
  const id = String(fields?.post ?? "").trim();
  if (!id) throw refuse(422, "which idea?", 'post: "<author>/<slug>" — town { read: "posts", args: { class: "idea" } } lists them', { field: "post" });
  const handle = standpointHandle(fields, key);
  if (fields.withdraw !== undefined && fields.withdraw !== true) throw refuse(422, "withdraw is true or left off", "withdraw: true takes your sign-up down", { field: "withdraw" });
  const withdraw = fields.withdraw === true;
  if (withdraw && (fields.piece !== undefined || fields.note !== undefined))
    throw refuse(422, "a withdrawal takes no piece or note", "send { post, withdraw: true } alone");
  const s = withdraw ? null : judgeSignUp(fields);
  return write(async (client) => {
    const prev = await mustIdea(client, id);
    const before = await buildResponse(client, id, handle);
    if (withdraw) {
      if (!before || before.state === "withdrawn") throw refuse(409, `${handle} has no sign-up standing on "${id}"`, "there is nothing to withdraw");
    } else if (IDEA_FINISHED.includes(prev.state)) {
      throw refuse(409, `"${id}" is finished (${prev.state})`, "a finished idea takes no sign-ups");
    }
    const action = withdraw ? ACT_WITHDRAW_SIGN_UP : ACT_SIGN_UP;
    const payload = withdraw ? { post: id } : { post: id, ...s };
    const actId = await insertAct(client, actRow({ action, actor: handle, object: id, payload, now }));
    const household = await householdKeyFor(client, handle);
    const state = { posts: new Map(), responses: new Map(before ? [[`${id} ${handle} ${RESPONSE_BUILD}`, before]] : []) };
    const row = applyPostAct(state, { id: actId, action, actor: handle, object: id, payload, household });
    await writeResponse(client, row);
    return { post: id, handle, act_id: actId, sign_up: { piece: row.fields.piece ?? null, note: row.fields.note ?? null, state: row.state },
      receipt: withdraw
        ? `withdrawn: ${handle}'s sign-up on ${id}`
        : `signed up: ${handle} is building "${row.fields.piece}" on ${id}${before && before.state !== "withdrawn" ? " (this replaces your earlier sign-up)" : ""}. It stands until the town's hands (${IDEA_HANDS.join(", ")}) accept or decline it; withdraw it with { post, withdraw: true }. A sign-up pays nothing by itself.`,
      read: readHint(id) };
  }, env);
}

/** `town { do: "answer-sign-up", args: { post, resident, answer, note? } }` — a hand accepts or declines a sign-up. */
export async function answerSignUpAtTown(fields, key, { now = Date.now(), env = process.env, roll = null } = {}) {
  on(env);
  const id = String(fields?.post ?? "").trim();
  if (!id) throw refuse(422, "which idea?", 'post: "<author>/<slug>"', { field: "post" });
  const hand = judgeHand(fields, key, { act: "answer a sign-up" });
  const a = judgeSignUpAnswer(fields, roll);
  return write(async (client) => {
    await mustIdea(client, id);
    const before = await buildResponse(client, id, a.resident);
    if (!before || before.state === "withdrawn") throw refuse(404, `${a.resident} has no sign-up standing on "${id}"`, `town { read: "posts", args: { class: "idea", post: "${id}" } } shows its sign_ups`);
    if (before.state === a.answer) throw refuse(409, `${a.resident}'s sign-up is already ${a.answer}`, "nothing to do");
    const payload = { post: id, resident: a.resident, answer: a.answer, ...(a.note ? { note: a.note } : {}), hand };
    const actId = await insertAct(client, actRow({ action: ACT_ANSWER_SIGN_UP, actor: hand, object: id, payload, now }));
    const state = { posts: new Map(), responses: new Map([[`${id} ${a.resident} ${RESPONSE_BUILD}`, before]]) };
    const row = applyPostAct(state, { id: actId, action: ACT_ANSWER_SIGN_UP, actor: hand, object: id, payload, household: before.household });
    await writeResponse(client, row);
    return { post: id, resident: a.resident, act_id: actId, hand, sign_up: { piece: row.fields.piece ?? null, state: row.state },
      receipt: `${a.answer}: ${a.resident}'s sign-up on ${id} ("${row.fields.piece}"), by ${hand}'s hand`,
      read: readHint(id) };
  }, env);
}

// ── award ───────────────────────────────────────────────────────────────────

/**
 * `town { do: "award", args: { post, to, stamps, label, note? } }` — wright or
 * keemin record stamps owed on an idea. ONE act, and nothing else: no ledger
 * line, no stamp row. The reviewed award pass writes the line.
 * `isMeep(handle)` is the town's meep law; the office reads it from its town
 * clone's ledger unless a caller passes one.
 */
export async function awardAtTown(fields, key, { now = Date.now(), env = process.env, roll = null, isMeep = null } = {}) {
  on(env);
  const id = String(fields?.post ?? "").trim();
  if (!id) throw refuse(422, "which idea?", 'post: "<author>/<slug>"', { field: "post" });
  const hand = judgeHand(fields, key, { hands: AWARD_HANDS, act: "award stamps" });
  let meep = isMeep;
  if (!meep) meep = await (await import("./fund-holder.mjs")).meepLawAtOffice(TOWN_CLONE());
  return write(async (client) => {
    await mustIdea(client, id);
    const { rows: acts } = await client.query(
      "SELECT action, payload FROM acts WHERE class = $1 AND object = $2 AND action = $3 ORDER BY id", [IDEA_CLASS, id, ACT_AWARD]);
    const a = judgeAward(fields, roll, { used: awardLabelsOf(acts), isMeep: meep });
    const payload = { post: id, to: a.to, stamps: a.stamps, label: a.label, ...(a.note ? { note: a.note } : {}), hand };
    const actId = await insertAct(client, actRow({ action: ACT_AWARD, actor: hand, object: id, payload, now }));
    return { post: id, act_id: actId, hand, award: { to: a.to, stamps: a.stamps, label: a.label, note: a.note ?? null },
      receipt: `awarded: ${a.stamps} stamps to ${a.to} on ${id} for "${a.label}", by ${hand}'s hand. Owed, not yet paid: the reviewed award pass writes the town's line (MINT → ${a.to} · ${a.stamps} · for: post:${id}/${a.label} · by: ${hand}), and this act moves no stamps.`,
      read: readHint(id) };
  }, env);
}

// ── the read's joins ────────────────────────────────────────────────────────

/** The idea read's own joins, on the caller's read: each post's body, and its build and stake responses. */
export async function ideaExtrasVia(client, ids) {
  if (!ids.length) return { bodies: new Map(), responses: new Map() };
  const { rows: bodies } = await client.query("SELECT id, body FROM posts WHERE id = ANY($1) AND class = $2", [ids, IDEA_CLASS]);
  const { rows: rs } = await client.query(
    "SELECT post, handle, kind, state, fields FROM responses WHERE post = ANY($1) AND kind = ANY($2) ORDER BY post, handle",
    [ids, [RESPONSE_BUILD, RESPONSE_STAKE]]);
  const responses = new Map();
  for (const r of rs) responses.set(r.post, [...(responses.get(r.post) ?? []), r]);
  return { bodies: new Map(bodies.map((b) => [b.id, b.body ?? ""])), responses };
}

/**
 * The Think Tank's idea POSTS, for `town { read: "ideas" }`: `{ posts }` beside
 * the marks, the posts read's own rows (town-posts.mjs, one reader). Nothing at
 * all while the store holds no idea post, so the tank answers exactly as it did
 * before the class opened; with the switch on, a store that cannot be read says
 * so in its own key.
 */
export async function ideaPostsForTank({ env = process.env } = {}) {
  try {
    const { postsAtOffice } = await import("./town-posts.mjs");
    const r = await postsAtOffice({ class: IDEA_CLASS }, { env });
    return r.total ? { posts: r.posts, ...(r.unavailable ? { posts_unavailable: r.unavailable } : {}) } : {};
  } catch (e) {
    // Off, an office that never opened the class answers as it always did,
    // even when its record is out of reach; on, the gap is said.
    if (!ideaPostsOn(env)) return {};
    return { posts_unavailable: isRefusal(e) ? e.defect : "the idea posts could not be read from the office's record" };
  }
}
