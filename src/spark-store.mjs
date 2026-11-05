// spark-store.mjs — THE SPARK CLASS'S PEN (POS-780).
//
// The rules are sparks.mjs's, pure. This file is where they meet the record, in
// the post pens' shape (events-store.mjs, idea-store.mjs): every act is ONE
// `officeWrite` transaction that reads what it needs, inserts the act through
// the pen's `insertAct`, and writes the row `applyPostAct` derives from it on
// the same client. A refusal thrown inside rolls the whole thing back.
//
// A spark's `post` act carries the moment: the window rides the post's own span
// columns (starts, ends) and the place its place columns, the way an event's do,
// so a spark is anchored in the act log at the point it names. The actor is the
// authenticated sparker (the fold makes them the author and their household the
// post's).
//
// ── WHERE THE SPARKER STOOD (Wright, AUTHORITY 2026-11-05T07:19:33Z) ────────
//
// "where the sparker stood when the moment ended, read from the record. Not the
// call-time standpoint, and never a place the caller supplies ... Read the
// sparker's position at `to` from the office's own walk record (`positionAt`
// over the walk rows)." `placeAtTo` below is that read and nothing more: the
// office's own departure record cut at `to` (world.mjs § departuresAcrossEras,
// both eras), and the world's own `whereIs` at `to`'s fractional crossing, which
// takes the governing walk and asks the engine's `positionAt` (mid-road, a
// walker stands where the road had carried them). A resident the record places
// nowhere at `to` stands where the office stands every such resident (the
// groundless default, groundless.mjs), as every read of "where are you" does.
// An amended `to` is placed again by the same read, so a spark never keeps a
// place from a moment it no longer marks.
//
// Measured before it was written (POS-780 lane, invented walk acts in a real
// Postgres, the pinned clone's frozen ledger): this read answered in a median
// of 30 ms over 2,000 walk acts, 205 ms over 20,000 and 638 ms over 100,000,
// growing with the town's whole departure record, and equal at each scale to
// the engine's positionAt over the probe's own last walk.

import { officeRead, officeWrite, insertAct, PenUnreachableError } from "./world2-pen.mjs";
import { householdKeyFor } from "./world2-claims.mjs";
import { apiUrl } from "./public-base.mjs";
import { currentCrossing } from "./crossings.mjs";
import { WORLD_ANCHOR } from "./world-journal.mjs";
import { importEngineAt } from "./world-branches.mjs";
import { isGroundlessDefault, groundlessStandpoint } from "./groundless.mjs";
import { refuse, applyPostAct, slugFromTitle, anchorForPlace, ACT_POST, ACT_AMEND_POST, ACT_CLOSE } from "./events.mjs";
import { POST_COLUMNS, rowOf, insertPost, updatePost, standpointHandle } from "./events-store.mjs";
import {
  SPARK_CLASS, SPARK_FINISHED, STATE_SPARKED, STATE_WITHDRAWN, SPARK_FIELDS, SPARK_HOW,
  judgeWindow, judgeSparkText, SPARK_NO_CLOSE_BY_OTHERS,
} from "./sparks.mjs";

const isRefusal = (e) => e && typeof e.code === "number" && typeof e.defect === "string";

async function write(fn, env) {
  try {
    return await officeWrite(fn, { env });
  } catch (e) {
    if (isRefusal(e)) throw e;
    if (e?.name === "LateCrossingError") throw refuse(409, e.message, "the act was stamped for a candle the record will not take; nothing was written");
    const pen = new PenUnreachableError(e);
    throw refuse(503, pen.message,
      "this door's pen is the office's record; when it cannot be reached the door refuses rather than writing anywhere else, and the act is safe to try again");
  }
}

async function read(fn, env) {
  try {
    return await officeRead(fn, { env });
  } catch (e) {
    if (isRefusal(e)) throw e;
    const pen = new PenUnreachableError(e);
    throw refuse(503, pen.message, "this door reads the office's record; when it cannot be reached the door refuses rather than guessing, and the act is safe to try again");
  }
}

export async function sparkRow(client, id) {
  const { rows } = await client.query(`SELECT ${POST_COLUMNS} FROM posts WHERE id = $1 AND class = $2`, [id, SPARK_CLASS]);
  return rowOf(rows[0]);
}

// ── where the sparker stood at `to` ─────────────────────────────────────────

/**
 * The sparker's place at `to`, from the record: `{ x, y, source }`, `source`
 * being whereIs's own word for how the record placed them (walk, parcel) or the
 * groundless default's. Throws a 503 refusal when the record cannot be read in
 * full: a place derived from half a record is a wrong place, and no other
 * source stands in for it.
 */
export async function placeAtTo(handle, toIso) {
  const atMs = Date.parse(toIso);
  const { departuresAcrossEras, worldStateRaw, WORLD_CLONE } = await import("./world.mjs");
  const { departures, disclosed } = await departuresAcrossEras(WORLD_CLONE, { atMs });
  const unread = (disclosed ?? []).find((d) => /^(record-unreadable|walk-ledger-unreadable):/.test(d));
  if (unread) throw refuse(503, "where you stood when the moment ended cannot be read from the record just now",
    `the spark is placed where you stood at \`to\`, from the office's own walk record, and that record did not answer in full (${unread.split(":")[0]}). Nothing was written; the act is safe to try again`);
  const [{ whereIs }, walk] = await Promise.all([importEngineAt(WORLD_CLONE, "where-is.mjs"), importEngineAt(WORLD_CLONE, "walk.mjs")]);
  const here = whereIs(handle, { world: await worldStateRaw(), departures, at: walk.fractionalCrossing(atMs) });
  const stand = !here?.placed || isGroundlessDefault(here) ? groundlessStandpoint(handle) : here;
  return { x: stand.x, y: stand.y, source: stand.source };
}

function actRow({ action, actor, object, payload, place = null, now }) {
  const at = place ? anchorForPlace(place, WORLD_ANCHOR) : { anchor: null, dx: null, dy: null };
  return {
    written_at: new Date(now).toISOString(), crossing: currentCrossing(now),
    actor, action, object,
    at_anchor: at.anchor, at_dx: at.dx, at_dy: at.dy, witnesses: null,
    class: SPARK_CLASS, payload: JSON.stringify(payload),
    effect: null, household: actor,   // insertAct resolves the actor's house
  };
}

const readHint = (id) => `town { read: "posts", args: { class: "spark", post: "${id}" } } (or GET ${apiUrl(`/posts/${id}?class=spark`)})`;
const placeOf = (row) => (row.place_x == null ? null : { x: row.place_x, y: row.place_y });
const answerOf = (row) => ({ id: row.id, class: SPARK_CLASS, title: row.title, note: row.body, author: row.author,
  household: row.household ?? null, state: row.state, from: row.starts, to: row.ends, place: placeOf(row) });

async function mustSpark(client, id) {
  const prev = await sparkRow(client, id);
  if (!prev) throw refuse(404, `no spark "${id}"`, 'town { read: "posts", args: { class: "spark" } } lists them');
  return prev;
}

/** The id a new spark takes: `<sparker>/<slug>` from its title, never reused (`-2`, `-3`, … while held). */
function mintSparkId(sparker, title, held) {
  const slug = slugFromTitle(title);
  if (!slug) throw refuse(422, "the title mints no id", "a spark's id is <sparker>/<slug>, and the slug comes from the title's letters and digits: give the title at least one", { field: "title" });
  const base = `${sparker}/${slug}`;
  if (!held.has(base)) return base;
  for (let n = 2; n < 1000; n++) if (!held.has(`${base}-${n}`)) return `${base}-${n}`;
  throw refuse(409, `"${base}" has been used too many times`, "give this spark a different title");
}

function strays(fields, allowed) {
  const hit = Object.keys(fields ?? {}).filter((k) => fields[k] !== undefined && !allowed.includes(k));
  if (hit.length) throw refuse(422, `a spark does not take: ${hit.join(", ")}`,
    `${SPARK_HOW}: the place is where you stood when the moment ended, read from the record, and who sparked it is you`, { field: hit[0] });
}

// ── post: world { do: "spark" } ─────────────────────────────────────────────

/** Mark a moment: one `post` act, one `posts` row, sparked, placed where the sparker stood at `to`. */
export async function postSpark(fields, key, { now = Date.now(), env = process.env } = {}) {
  strays(fields, [...SPARK_FIELDS, "handle"]);
  const sparker = standpointHandle(fields, key);
  const text = judgeSparkText({ title: fields.title, note: fields.note });
  const window = judgeWindow({ from: fields.from, to: fields.to }, now);
  const place = await placeAtTo(sparker, window.to);
  return write(async (client) => {
    const { rows: held } = await client.query("SELECT id FROM posts WHERE id LIKE $1", [`${sparker}/%`]);
    const id = mintSparkId(sparker, text.title, new Set(held.map((r) => r.id)));
    const payload = { post: id, class: SPARK_CLASS, title: text.title, body: text.note, state: STATE_SPARKED,
      place: { mark: null, x: place.x, y: place.y }, starts: window.from, ends: window.to, fields: {} };
    const actId = await insertAct(client, actRow({ action: ACT_POST, actor: sparker, object: id, payload, place: payload.place, now }));
    const household = await householdKeyFor(client, sparker);
    const row = applyPostAct({ posts: new Map(), responses: new Map() },
      { id: actId, action: ACT_POST, actor: sparker, object: id, payload, household });
    await insertPost(client, row);
    return { post: answerOf(row), act_id: actId,
      receipt: `sparked: ${id}, ${window.from} to ${window.to}, at (${place.x}, ${place.y}), where ${sparker} stood when the moment ended, by ${sparker}. `
        + "It stands in public. Change its title, note or window with town { do: \"amend\" }, or withdraw it with town { do: \"close\" }, while it stands. A spark pays nothing.",
      read: readHint(id) };
  }, env);
}

// ── amend ───────────────────────────────────────────────────────────────────

/**
 * Amend a spark's title, note or window: its sparker only, while it stands. A
 * changed `to` is placed again from the record; the place is never sent.
 */
export async function amendSpark(fields, key, id, { now = Date.now(), env = process.env } = {}) {
  const { post: _post, class: _class, ...rest } = fields ?? {};
  strays(rest, [...SPARK_FIELDS, "handle"]);
  const acting = standpointHandle(fields, key);
  const t = judgeSparkText({ title: fields.title, note: fields.note }, { partial: true });
  const windowSent = fields.from !== undefined || fields.to !== undefined;
  // the window is judged, and a new `to` placed, before the write: the place read is the record's, outside this pen
  const prev0 = await read((client) => mustSpark(client, id), env);
  if (acting !== prev0.author) throw refuse(403, `"${id}" is not yours to amend`, `its sparker is ${prev0.author}, and only they change it`);
  const window = windowSent ? judgeWindow({ from: fields.from ?? prev0.starts, to: fields.to ?? prev0.ends }, now) : null;
  const place = window && window.to !== prev0.ends ? await placeAtTo(acting, window.to) : null;
  return write(async (client) => {
    const prev = await mustSpark(client, id);
    if (SPARK_FINISHED.includes(prev.state)) throw refuse(409, `"${id}" is finished (${prev.state})`, "a withdrawn spark is not amended");
    if (acting !== prev.author) throw refuse(403, `"${id}" is not yours to amend`, `its sparker is ${prev.author}, and only they change it`);
    // the window read outside the transaction must still be the one that stands (a second amend in between re-judges)
    if (window && (prev.starts !== prev0.starts || prev.ends !== prev0.ends)) throw refuse(409, `"${id}" changed while this amendment was judged`, "read it again and amend what stands");
    const next = { title: t.title, body: t.note, starts: window?.from, ends: window?.to };
    const changed = ["title", "body", "starts", "ends"].filter((k) => next[k] !== undefined && next[k] !== prev[k]);
    if (!changed.length) throw refuse(422, "nothing to amend", `every field you sent already stands on "${id}"`);
    const payload = { post: id, changed };
    for (const k of changed) payload[k] = next[k];
    if (place) payload.place = { mark: null, x: place.x, y: place.y };
    const actId = await insertAct(client, actRow({ action: ACT_AMEND_POST, actor: acting, object: id, payload, now }));
    const row = applyPostAct({ posts: new Map([[id, prev]]), responses: new Map() },
      { id: actId, action: ACT_AMEND_POST, actor: acting, object: id, payload, household: prev.household });
    await updatePost(client, row);
    const words = { body: "note", starts: "from", ends: "to" };
    return { post: answerOf(row), act_id: actId, amended: changed.map((k) => words[k] ?? k),
      receipt: `amended: ${id} (${changed.map((k) => words[k] ?? k).join(", ")})${place ? `; placed again at (${place.x}, ${place.y}), where ${acting} stood at the new to` : ""}. Revision ${row.revised}; the act log keeps every revision`,
      read: readHint(id) };
  }, env);
}

// ── close: the sparker withdraws ────────────────────────────────────────────

/** Withdraw a spark: its sparker only, while it stands. It finishes as `withdrawn` and stays on the record. */
export async function closeSpark(fields, key, id, { now = Date.now(), env = process.env } = {}) {
  const acting = standpointHandle(fields, key);
  return write(async (client) => {
    const prev = await mustSpark(client, id);
    if (acting !== prev.author) throw SPARK_NO_CLOSE_BY_OTHERS(id, prev.author);
    if (SPARK_FINISHED.includes(prev.state)) throw refuse(409, `"${id}" is finished (${prev.state})`, "a withdrawn spark is not withdrawn again");
    const payload = { post: id, state: STATE_WITHDRAWN, from: prev.state };
    const actId = await insertAct(client, actRow({ action: ACT_CLOSE, actor: acting, object: id, payload, now }));
    const row = applyPostAct({ posts: new Map([[id, prev]]), responses: new Map() },
      { id: actId, action: ACT_CLOSE, actor: acting, object: id, payload, household: prev.household });
    await updatePost(client, row);
    return { post: answerOf(row), act_id: actId,
      receipt: `withdrawn: ${id}, by ${acting}. It stays on the record as withdrawn, and moves no further.`,
      read: readHint(id) };
  }, env);
}

// ── the read's extras ───────────────────────────────────────────────────────

/**
 * What a spark's list row joins to the general row: the note, the window and
 * the place. `{ byId: Map(id → { note, window: { from, to }, place }) }`. One
 * query on the caller's client, beside the one that reads the rows.
 */
export async function sparkExtrasVia(client, ids) {
  const byId = new Map();
  if (!ids.length) return { byId };
  const { rows } = await client.query(
    "SELECT id, body, starts, ends, place_x, place_y FROM posts WHERE id = ANY($1) AND class = $2", [ids, SPARK_CLASS]);
  for (const r of rows) {
    const iso = (v) => (v == null ? null : new Date(v).toISOString());
    byId.set(r.id, { note: r.body ?? "", window: { from: iso(r.starts), to: iso(r.ends) },
      place: r.place_x == null ? null : { x: Number(r.place_x), y: Number(r.place_y) } });
  }
  return { byId };
}
