// scoop-store.mjs — THE SCOOP CLASS'S PEN (POS-780).
//
// The rules are scoops.mjs's, pure. This file is where they meet the record, in
// the bug and idea pens' shape (events-store.mjs, idea-store.mjs): every act is
// ONE `officeWrite` transaction that reads what it needs, inserts the act
// through the pen's `insertAct`, and writes the row `applyPostAct` derives from
// it on the same client. A refusal thrown inside rolls the whole thing back.
//
// A scoop's `post` act carries the moment: the window rides the post's own
// span columns (starts, ends) and the scooper's place its place columns, the
// way an event's do, so a scoop with a place is anchored in the act log like an
// event is, and one without is anchorless. The actor is the scooper (the one
// fold makes them the author and their household the post's). Every act a hand
// makes carries `hand` in the payload.

import { officeRead, officeWrite, insertAct, PenUnreachableError } from "./world2-pen.mjs";
import { householdKeyFor } from "./world2-claims.mjs";
import { rungWords } from "./post-words.mjs";
import { apiUrl } from "./public-base.mjs";
import { currentCrossing } from "./crossings.mjs";
import { WORLD_ANCHOR } from "./world-journal.mjs";
import {
  refuse, applyPostAct, slugFromTitle, anchorForPlace, judgePlaceShape,
  ACT_POST, ACT_AMEND_POST, ACT_ADVANCE, ACT_CLOSE,
} from "./events.mjs";
import { POST_COLUMNS, rowOf, insertPost, updatePost, standpointHandle, placeFor } from "./events-store.mjs";
import {
  SCOOP_CLASS, SCOOP_HANDS, SCOOP_FINISHED, SCOOP_OPEN_MAX, STATE_SCOOPED, STATE_WITHDRAWN, SCOOP_POST_HOW,
  judgeWindow, judgeScoopText, judgeScoopHand, judgeScoopAdvance, SCOOP_NO_CLOSE_BY_OTHERS,
} from "./scoops.mjs";

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

export async function scoopRow(client, id) {
  const { rows } = await client.query(`SELECT ${POST_COLUMNS} FROM posts WHERE id = $1 AND class = $2`, [id, SCOOP_CLASS]);
  return rowOf(rows[0]);
}

/** Is this id a scoop? For the class router; a store that cannot be read answers no. */
export async function isScoopPost(id, { env = process.env } = {}) {
  try { return Boolean(await officeRead((client) => scoopRow(client, String(id)), { env })); }
  catch { return false; }
}

function actRow({ action, actor, object, payload, place = null, now }) {
  const at = place ? anchorForPlace(place, WORLD_ANCHOR) : { anchor: null, dx: null, dy: null };
  return {
    written_at: new Date(now).toISOString(), crossing: currentCrossing(now),
    actor, action, object,
    at_anchor: at.anchor, at_dx: at.dx, at_dy: at.dy, witnesses: null,
    class: SCOOP_CLASS, payload: JSON.stringify(payload),
    effect: null, household: actor,   // insertAct resolves the actor's house
  };
}

const readHint = (id) => `town { read: "posts", args: { class: "scoop", post: "${id}" } } — or GET ${apiUrl(`/posts/${id}?class=scoop`)}`;
const answerOf = (row) => ({ id: row.id, class: SCOOP_CLASS, title: row.title, body: row.body, author: row.author,
  household: row.household ?? null, state: row.state, starts: row.starts, ends: row.ends,
  place: row.place_x == null ? null : { mark: row.place_mark ?? null, x: row.place_x, y: row.place_y }, fields: row.fields });

async function mustScoop(client, id) {
  const prev = await scoopRow(client, id);
  if (!prev) throw refuse(404, `no scoop "${id}"`, 'town { read: "posts", args: { class: "scoop" } } lists them');
  return prev;
}

/** The id a new scoop takes: `<scooper>/<slug>` from its title, never reused (`-2`, `-3`, … while held). */
function mintScoopId(scooper, title, held) {
  const slug = slugFromTitle(title);
  if (!slug) throw refuse(422, "the title mints no id", "a scoop's id is <scooper>/<slug>, and the slug comes from the title's letters and digits — give the title at least one", { field: "title" });
  const base = `${scooper}/${slug}`;
  if (!held.has(base)) return base;
  for (let n = 2; n < 1000; n++) if (!held.has(`${base}-${n}`)) return `${base}-${n}`;
  throw refuse(409, `"${base}" has been used too many times`, "give this scoop a different title");
}

// ── post ────────────────────────────────────────────────────────────────────

/** Mark a moment: one `post` act, one `posts` row, scooped. */
export async function postScoop(fields, key, { now = Date.now(), env = process.env } = {}) {
  const scooper = standpointHandle(fields, key);
  const text = judgeScoopText({ title: fields.title, body: fields.body });
  const window = judgeWindow({ starts: fields.starts, ends: fields.ends }, now);
  const shape = fields.place !== undefined ? judgePlaceShape(fields.place) : null;
  return write(async (client) => {
    const place = shape ? await placeFor(client, shape) : null;
    const { rows: held } = await client.query("SELECT id FROM posts WHERE id LIKE $1", [`${scooper}/%`]);
    const { rows: open } = await client.query(
      "SELECT count(*)::int AS n FROM posts WHERE class = $1 AND author = $2 AND NOT (state = ANY($3))", [SCOOP_CLASS, scooper, [...SCOOP_FINISHED]]);
    if (open[0].n >= SCOOP_OPEN_MAX)
      throw refuse(409, `${scooper} already has ${open[0].n} scoops standing`, `at most ${SCOOP_OPEN_MAX} at once: withdraw one with town { do: "close", args: { post } }, or wait until the journalist has taken one up`);
    const id = mintScoopId(scooper, text.title, new Set(held.map((r) => r.id)));
    const payload = { post: id, class: SCOOP_CLASS, title: text.title, body: text.body, state: STATE_SCOOPED,
      ...(place ? { place: { mark: place.mark, x: place.x, y: place.y } } : {}),
      starts: window.starts, ends: window.ends, fields: {} };
    const actId = await insertAct(client, actRow({ action: ACT_POST, actor: scooper, object: id, payload, place, now }));
    const household = await householdKeyFor(client, scooper);
    const row = applyPostAct({ posts: new Map(), responses: new Map() },
      { id: actId, action: ACT_POST, actor: scooper, object: id, payload, household });
    await insertPost(client, row);
    return { post: answerOf(row), act_id: actId,
      receipt: `scooped: ${id}, ${window.starts} to ${window.ends}${place ? ` at ${place.mark ?? "a point"} (${place.x}, ${place.y})` : ""}, by ${scooper}. `
        + `It stands scooped, in public; the town's hands (${SCOOP_HANDS.join(", ")}) move it along, and the journalist may take it up. You can change its title or note with town { do: "amend" } or withdraw it with town { do: "close" } while it stands. A scoop pays nothing.`,
      read: readHint(id) };
  }, env);
}

// ── amend ───────────────────────────────────────────────────────────────────

/** Amend a scoop's title or note: its scooper, or a hand, until it is finished. The window and place are the moment. */
export async function amendScoop(fields, key, id, { now = Date.now(), env = process.env } = {}) {
  const acting = standpointHandle(fields, key);
  for (const k of ["starts", "ends", "place"])
    if (fields[k] !== undefined) throw refuse(422, `a scoop's ${k} is not amended`, "the window and the place are the moment you marked: scoop the right moment as a new post, and withdraw this one", { field: k });
  const t = judgeScoopText({ title: fields.title, body: fields.body }, { partial: true });
  return write(async (client) => {
    const prev = await mustScoop(client, id);
    if (SCOOP_FINISHED.includes(prev.state)) throw refuse(409, `"${id}" is finished (${prev.state})`, "a finished scoop is not amended");
    const isHand = SCOOP_HANDS.includes(acting);
    if (!isHand && acting !== prev.author)
      throw refuse(403, `"${id}" is not yours to amend`, `its scooper is ${prev.author}; after them, only the town's hands (${SCOOP_HANDS.join(", ")}) amend a scoop`);
    if (isHand && acting !== prev.author) judgeScoopHand({ handle: acting }, key, { act: "amend someone else's scoop" });
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

// ── close: the scooper withdraws ────────────────────────────────────────────

/** Withdraw a scoop: its scooper only, while it stands. It finishes as `withdrawn` and stays on the record. */
export async function closeScoop(fields, key, id, { now = Date.now(), env = process.env } = {}) {
  const acting = standpointHandle(fields, key);
  return write(async (client) => {
    const prev = await mustScoop(client, id);
    if (acting !== prev.author) throw SCOOP_NO_CLOSE_BY_OTHERS(id, prev.author);
    if (SCOOP_FINISHED.includes(prev.state)) throw refuse(409, `"${id}" is finished (${prev.state})`, "a finished scoop is not withdrawn");
    const payload = { post: id, state: STATE_WITHDRAWN, from: prev.state };
    const actId = await insertAct(client, actRow({ action: ACT_CLOSE, actor: acting, object: id, payload, now }));
    const row = applyPostAct({ posts: new Map([[id, prev]]), responses: new Map() },
      { id: actId, action: ACT_CLOSE, actor: acting, object: id, payload, household: prev.household });
    await updatePost(client, row);
    return { post: answerOf(row), act_id: actId, ...rungWords(STATE_WITHDRAWN),
      receipt: `withdrawn: ${id}, by ${acting}. It stays on the record as withdrawn, and moves no further.`,
      read: readHint(id) };
  }, env);
}

// ── advance ─────────────────────────────────────────────────────────────────

/** Move a scoop to any named stage, by a hand, with a note; `published` carries the video's link. It mints nothing. */
export async function advanceScoop(fields, key, id, { now = Date.now(), env = process.env } = {}) {
  const hand = judgeScoopHand(fields, key, { act: "move a scoop" });
  return write(async (client) => {
    const prev = await mustScoop(client, id);
    const j = judgeScoopAdvance(fields, prev);
    const set = j.link ? { video_url: j.link } : {};
    const payload = { post: id, from: prev.state, to: j.to, ...(j.link ? { link: j.link } : {}), ...(j.note ? { note: j.note } : {}),
      ...(Object.keys(set).length ? { fields: set } : {}), hand };
    const actId = await insertAct(client, actRow({ action: ACT_ADVANCE, actor: hand, object: id, payload, now }));
    const row = applyPostAct({ posts: new Map([[id, prev]]), responses: new Map() },
      { id: actId, action: ACT_ADVANCE, actor: hand, object: id, payload, household: prev.household });
    await updatePost(client, row);
    const finished = SCOOP_FINISHED.includes(j.to);
    return { post: answerOf(row), act_id: actId, hand, ...rungWords(j.to),
      receipt: `advanced: ${id} ${prev.state} → ${j.to} by ${hand}'s hand${j.link ? `; the video is at ${j.link}` : ""}. A stage pays nothing.${finished ? " It is finished, and moves no further." : ""}`,
      read: readHint(id) };
  }, env);
}

export { SCOOP_POST_HOW };

// ── the read's extras ───────────────────────────────────────────────────────

/**
 * What a scoop's list row joins to the general row: the note, the window and
 * the place. `{ byId: Map(id → { body, window: { starts, ends }, place }) }`.
 * One query on the caller's client, beside the one that reads the rows.
 */
export async function scoopExtrasVia(client, ids) {
  const byId = new Map();
  if (!ids.length) return { byId };
  const { rows } = await client.query(
    "SELECT id, body, starts, ends, place_mark, place_x, place_y FROM posts WHERE id = ANY($1) AND class = $2", [ids, SCOOP_CLASS]);
  for (const r of rows) {
    const iso = (v) => (v == null ? null : new Date(v).toISOString());
    byId.set(r.id, { body: r.body ?? "", window: { starts: iso(r.starts), ends: iso(r.ends) },
      place: r.place_x == null ? null : { mark: r.place_mark ?? null, x: Number(r.place_x), y: Number(r.place_y) } });
  }
  return { byId };
}
