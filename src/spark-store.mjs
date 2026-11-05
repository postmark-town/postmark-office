// spark-store.mjs — THE SPARK CLASS'S PEN (POS-780).
//
// The rules are sparks.mjs's, pure. This file is where they meet the record, in
// the post pens' shape (events-store.mjs, idea-store.mjs): every act is ONE
// `officeWrite` transaction that reads what it needs, inserts the act through
// the pen's `insertAct`, and writes the row `applyPostAct` derives from it on
// the same client. A refusal thrown inside rolls the whole thing back.
//
// A spark's `post` act carries the moment: the window rides the post's own span
// columns (starts, ends) and, when the record establishes it, the place its
// place columns, the way an event's do, so a placed spark is anchored in the act
// log at the point it names. The actor is the authenticated sparker (the fold
// makes them the author and their household the post's).
//
// ── WHERE THE SPARKER STOOD, OR THAT THE RECORD DOES NOT SAY ────────────────
//
// Wright, AUTHORITY 2026-11-05T07:19:33Z: "where the sparker stood when the
// moment ended, read from the record. Not the call-time standpoint, and never a
// place the caller supplies." And 09:33:28Z: "when the record doesn't establish
// the place, the spark says so. It never substitutes, and never refuses the
// resident ... a stamped walk establishes the sparker's place at `to`, and
// that's the post's place. Every other case is 'unknown', never today's world:
// no stamped walk row ... no `homeOf` in the current world, and no porch. An
// unstamped old departure: today's default pace doesn't count. A rider at `to`:
// their place is the vehicle, at its own recorded position at `to`. If that
// isn't recorded, unknown. Never the wharf." The post then carries `place: null`
// with a plain `place_unknown` reason, plus the call-time standpoint labelled
// `sparked_from`, "as where they pressed it from, never as where the moment was".
//
// `placeAtTo` below is that read and nothing more:
//   1. The office's own departure record cut at `to` (world.mjs §
//      departuresAcrossEras, both eras). A record that did not answer in full
//      is unknown: half a record is no record of the moment.
//   2. Occupancy at `to` (the enter/exit record, enter-exit-ledger.mjs §
//      servedEnterExitLedger, folded by the world's own occupancyAt at `to`'s
//      stamp), asked only in a world that has vehicles at all. A sparker inside a
//      vehicle at `to` is a rider, however they walked before boarding, and no
//      record this office keeps gives a vehicle's past position (a timetable is
//      today's world, not a record of then), so a rider's place is unknown. An
//      enter record that did not answer in full is unknown too.
//   3. The governing departure at `to` (the world's walk.mjs § currentDeparture)
//      establishes the place only when its stride is stamped, or when it is a
//      landing (from = toward: "it names no stride, because nobody walked",
//      world.mjs § landEntry), which needs none. Then the engine's `positionAt`
//      at `to` is the place: mid-road, where the road had carried them.
//   Anything else is unknown, with its reason. Nothing falls back to a home, a
//   porch, the Origin or a default pace.
//
// `sparked_from` is the office's one standpoint derivation (world.mjs §
// residentStandpoint) at the moment of the post, written once on the post act and
// never by an amendment: it says where the spark was pressed, whatever it marks.
// An amended `to` is placed again by `placeAtTo`, so a spark never keeps a place
// (or an unknown reason) from a moment it no longer marks.
//
// Measured before it was first written (POS-780 lane, invented walk acts in a
// real Postgres, the pinned clone's frozen ledger): the departure read answered
// in a median of 30 ms over 2,000 walk acts, 205 ms over 20,000 and 638 ms over
// 100,000, growing with the town's whole departure record.

import { officeRead, officeWrite, insertAct, PenUnreachableError } from "./world2-pen.mjs";
import { householdKeyFor } from "./world2-claims.mjs";
import { apiUrl } from "./public-base.mjs";
import { currentCrossing } from "./crossings.mjs";
import { WORLD_ANCHOR } from "./world-journal.mjs";
import { importEngineAt } from "./world-branches.mjs";
import { markClassOf } from "./world-grants.mjs";
import { VEHICLE_CLASS, worldHasVehicle } from "./world-movement.mjs";
import { servedEnterExitLedger } from "./enter-exit-ledger.mjs";
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

// ── where the sparker stood at `to`, or that the record does not say ────────

const unknown = (why) => ({ place: null, place_unknown: why });
const samePoint = (a, b) => Number(a?.x) === Number(b?.x) && Number(a?.y) === Number(b?.y);

/**
 * The sparker's place at `to`, only as the record establishes it: `{ place:
 * { x, y }, place_unknown: null }`, or `{ place: null, place_unknown: <why> }`.
 * Never throws for a gap in the record: an unread or silent record is unknown.
 */
export async function placeAtTo(handle, toIso) {
  const atMs = Date.parse(toIso);
  const { departuresAcrossEras, worldStateRaw, WORLD_CLONE } = await import("./world.mjs");
  let departures;
  try {
    const read = await departuresAcrossEras(WORLD_CLONE, { atMs });
    if ((read.disclosed ?? []).some((d) => /^(record-unreadable|walk-ledger-unreadable):/.test(d)))
      return unknown("the walk record could not be read in full");
    departures = read.departures ?? [];
  } catch { return unknown("the walk record could not be read"); }
  let walk, world;
  try { [walk, world] = await Promise.all([importEngineAt(WORLD_CLONE, "walk.mjs"), worldStateRaw()]); }
  catch { return unknown("the world's walk arithmetic could not be read"); }
  const fc = walk.fractionalCrossing(atMs);

  // a rider at `to` stands where the vehicle stood, and no record here keeps that
  if (worldHasVehicle(world)) {
    let stack;
    try {
      const { crossingLaw } = await import("./world-crossings.mjs");
      const { thresholds } = await crossingLaw(WORLD_CLONE);
      const served = await servedEnterExitLedger(WORLD_CLONE);
      if (served?.derived?.incomplete) return unknown("who was aboard what at the moment's end could not be read in full");
      stack = thresholds.occupancyAt(thresholds.parseEnterExitLedger(served.ledger).acts, thresholds.stampAt(fc)).get(handle) ?? [];
    } catch { return unknown("who was aboard what at the moment's end could not be read"); }
    const byId = new Map((world.marks ?? []).map((m) => [m.id, m]));
    const vehicle = [...stack].reverse().find((id) => byId.has(id) && markClassOf(byId.get(id)) === VEHICLE_CLASS);
    if (vehicle) return unknown(`aboard ${vehicle} at the moment's end, and where it was then is not on the record`);
  }

  const dep = walk.currentDeparture(departures, handle);
  if (!dep) return unknown("no stamped walk at the moment's end: the record holds no walk of theirs before it");
  const landing = samePoint(dep.from, dep.toward);
  if (!landing && !(Number(dep.pace) > 0)) return unknown("the walk that governed the moment's end carries no stamped pace");
  const p = walk.positionAt(dep, fc);
  if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return unknown("the walk record gives no position at the moment's end");
  return { place: { x: p.x, y: p.y }, place_unknown: null };
}

/** Where the sparker pressed it from: the office's one standpoint derivation, now, with its own word for how it knows. */
async function sparkedFrom(handle) {
  try {
    const { residentStandpoint } = await import("./world.mjs");
    const here = await residentStandpoint(handle);
    return here?.placed && Number.isFinite(here.x) && Number.isFinite(here.y) ? { x: here.x, y: here.y, source: here.source ?? null } : null;
  } catch { return null; }
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
/** The spark as its post row stands: the place, or why there is none, and where it was pressed from. */
const answerOf = (row) => ({ id: row.id, class: SPARK_CLASS, title: row.title, note: row.body, author: row.author,
  household: row.household ?? null, state: row.state, from: row.starts, to: row.ends, place: placeOf(row),
  place_unknown: row.fields?.place_unknown ?? null, sparked_from: row.fields?.sparked_from ?? null });
const placeWords = (where, who) => (where.place ? `at (${where.place.x}, ${where.place.y}), where ${who} stood when the moment ended` : `with no place: ${where.place_unknown}`);

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

/** Mark a moment: one `post` act, one `posts` row, sparked, placed as the record establishes, labelled where it was pressed. */
export async function postSpark(fields, key, { now = Date.now(), env = process.env } = {}) {
  strays(fields, [...SPARK_FIELDS, "handle"]);
  const sparker = standpointHandle(fields, key);
  const text = judgeSparkText({ title: fields.title, note: fields.note });
  const window = judgeWindow({ from: fields.from, to: fields.to }, now);
  const [where, pressed] = await Promise.all([placeAtTo(sparker, window.to), sparkedFrom(sparker)]);
  return write(async (client) => {
    const { rows: held } = await client.query("SELECT id FROM posts WHERE id LIKE $1", [`${sparker}/%`]);
    const id = mintSparkId(sparker, text.title, new Set(held.map((r) => r.id)));
    const place = where.place ? { mark: null, x: where.place.x, y: where.place.y } : null;
    const payload = { post: id, class: SPARK_CLASS, title: text.title, body: text.note, state: STATE_SPARKED,
      place, starts: window.from, ends: window.to,
      fields: { sparked_from: pressed, ...(where.place_unknown ? { place_unknown: where.place_unknown } : {}) } };
    const actId = await insertAct(client, actRow({ action: ACT_POST, actor: sparker, object: id, payload, place, now }));
    const household = await householdKeyFor(client, sparker);
    const row = applyPostAct({ posts: new Map(), responses: new Map() },
      { id: actId, action: ACT_POST, actor: sparker, object: id, payload, household });
    await insertPost(client, row);
    return { post: answerOf(row), act_id: actId,
      receipt: `sparked: ${id}, ${window.from} to ${window.to}, ${placeWords(where, sparker)}, by ${sparker}. `
        + "It stands in public. Change its title, note or window with town { do: \"amend\" }, or withdraw it with town { do: \"close\" }, while it stands. A spark pays nothing.",
      read: readHint(id) };
  }, env);
}

// ── amend ───────────────────────────────────────────────────────────────────

/**
 * Amend a spark's title, note or window: its sparker only, while it stands. A
 * changed `to` is placed again from the record (a place, or why there is none);
 * the place is never sent, and where it was pressed from never changes.
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
  const where = window && window.to !== prev0.ends ? await placeAtTo(acting, window.to) : null;
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
    if (where) {
      // known → unknown clears the place; unknown → known clears the reason; never `sparked_from`
      payload.place = where.place ? { mark: null, x: where.place.x, y: where.place.y } : null;
      payload.fields = { place_unknown: where.place_unknown };
    }
    const actId = await insertAct(client, actRow({ action: ACT_AMEND_POST, actor: acting, object: id, payload, now }));
    const row = applyPostAct({ posts: new Map([[id, prev]]), responses: new Map() },
      { id: actId, action: ACT_AMEND_POST, actor: acting, object: id, payload, household: prev.household });
    await updatePost(client, row);
    const words = { body: "note", starts: "from", ends: "to" };
    return { post: answerOf(row), act_id: actId, amended: changed.map((k) => words[k] ?? k),
      receipt: `amended: ${id} (${changed.map((k) => words[k] ?? k).join(", ")})${where ? `; placed again ${placeWords(where, acting).replace(" when the moment ended", " at the new to")}` : ""}. Revision ${row.revised}; the act log keeps every revision`,
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
 * What a spark's list row joins to the general row: the note, the window, the
 * place or why there is none, and where it was pressed from. `{ byId: Map(id →
 * { note, window: { from, to }, place, place_unknown, sparked_from }) }`. One
 * query on the caller's client, beside the one that reads the rows.
 */
export async function sparkExtrasVia(client, ids) {
  const byId = new Map();
  if (!ids.length) return { byId };
  const { rows } = await client.query(
    "SELECT id, body, starts, ends, place_x, place_y, fields FROM posts WHERE id = ANY($1) AND class = $2", [ids, SPARK_CLASS]);
  for (const r of rows) {
    const iso = (v) => (v == null ? null : new Date(v).toISOString());
    const f = typeof r.fields === "string" ? JSON.parse(r.fields) : (r.fields ?? {});
    byId.set(r.id, { note: r.body ?? "", window: { from: iso(r.starts), to: iso(r.ends) },
      place: r.place_x == null ? null : { x: Number(r.place_x), y: Number(r.place_y) },
      place_unknown: f.place_unknown ?? null, sparked_from: f.sparked_from ?? null });
  }
  return { byId };
}
