// durable-rooms.mjs — fixed room records, and an event's own window membership (POS-1203, CORE-170; migration 103).
//
// Darko, 2026-11-23 18:35 EST: "sparks, galleries, conversations, they should all be durable". Rivet's packet, as ruled (19:40 EST):
//
//   1. A CLOSED ROOM IS A RECORD, looked up and never recomputed. The id it was first issued under is its identity, every name that opened
//      it before still does (`aliases`, and the same handle in the same second, `keys`), its says are listed by act number (the words
//      stay in `acts`, which never changes), and the bounds and reconstruction inputs it was fixed from are kept with it.
//   2. A ROOM IS FIXED ONLY WHEN IT TRULY CLOSES: a settlement has passed and the hour after it has gone with no say belonging to it.
//      That is hearing-window.mjs § roomOpen, THE ONE RULE (`isClosed` below asks it; there is no second copy). A carried or open room
//      keeps its id and is not stored.
//   3. AN EVENT KEEPS ITS OWN WINDOW. When an event ends, the rooms it had and the says each held up to the window's end are fixed to the
//      event (`durable_event_*`). Talk that carries on in one of those rooms afterwards never becomes the event's attendance, and neither
//      the making of its sparks nor the return of its stake touches the record.
//   4. ONE ALGORITHM. The grouping is src/rooms.mjs § roomsOf and the thread's header is world2/tools/conversations.mjs § threadOf, the same two
//      functions the conversations page and an event's page ask. This module shapes their answer into rows and reads the rows back; it
//      decides nothing about which say is in which room.
//   5. NOTHING IS INVENTED. A say with no place is left out and counted (voiceRecords' `unplaced`), a say older than the oldest known
//      settlement is not grouped and counted, old talk without reply links stays a timeline (`has_replies` false), and a room whose bounds
//      look wrong is FLAGGED (`frame_flag`), never repaired.
//
// WHAT THIS DOES NOT CHANGE: live hearing (hearing-window.mjs keeps its current-window rule, HEARING_HISTORY and the ear), the conversations
// page's envelope, the event page's envelope, who may hear what (a say spoken inside a dungeon's walls is never written here), the stake and
// completion timing of an event. Production replay is the operator's (world2/tools/replay-rooms.mjs; deploy/DEPLOY.md § durable rooms).

import { roomOpen, edgeAfter, ROOM_GRACE_MS } from "./hearing-window.mjs";
import { roomKeyOf, isRoomId } from "./rooms.mjs";
import { sayIdOf } from "./circles.mjs";
import * as talk from "../world2/tools/conversations.mjs";

/** A room whose bounds span more than this many metres is flagged for judgment (never repaired). The costume awards' room spans about 95 km by 99 km. */
export const SUSPECT_SPAN_M = 20_000;
/** The producer's algorithm, named in every record's inputs so a later rule change is visible against the rows it did not touch. */
export const ALGORITHM = "src/rooms.mjs roomsOf (POS-1185) + src/hearing-window.mjs roomOpen (CORE-97), threadOf's header";

/** The flag a room's bounds earn: set when they span more than SUSPECT_SPAN_M, else null. A REPORT for judgment; the bounds are never changed. */
export const frameFlagOf = (spanM) => (spanM > SUSPECT_SPAN_M
  ? `suspect frame: the bounds span ${spanM} m (more than ${SUSPECT_SPAN_M}); stored exactly as derived, for judgment (CORE-155), never repaired` : null);

const iso = (ms) => new Date(ms).toISOString();
const sortedEdges = (edges) => [...(edges ?? [])].filter(Number.isFinite).sort((a, b) => a - b);

/** Has this room truly closed at `nowMs`? The ONE rule: no settlement has come between its newest say and the hour after it ran out. */
export const isClosed = (latestMs, nowMs, edges) => !roomOpen(latestMs, nowMs, sortedEdges(edges));

/** The instant a room closes (ms): the first settlement after its newest say, plus the hour of grace. Null while no settlement has followed its newest say. */
export function closesAt(latestMs, edges) {
  const edge = edgeAfter(latestMs, sortedEdges(edges));
  return edge == null ? null : edge + ROOM_GRACE_MS;
}

const eraOf = (voices) => {
  const eras = new Set(voices.map((v) => v.era ?? "live"));
  return eras.size === 1 ? [...eras][0] : "mixed";
};

/**
 * One closed room (`{ root, voices, latest }` from rooms.mjs § roomsOf, its voices oldest first) as its record: `{ room, says }`, or
 * null while the room is not closed at `nowMs`. PURE.
 */
export function roomRecordOf(room, { edges, nowMs, earshotM, source = "live" }) {
  if (!room?.voices?.length || !isClosed(room.latest, nowMs, edges)) return null;
  const marks = sortedEdges(edges);
  const thread = talk.threadOf(room, { live: false, voiceCap: 1 });
  const voices = room.voices;
  // every id that opens it besides its own: the names its says recorded; the page's second-level lookup is `keys`
  const aliases = [...new Set(voices.map((v) => v.root).filter((r) => isRoomId(r) && r !== thread.id))].sort();
  const keys = [...new Set([thread.id, ...aliases].map(roomKeyOf).filter(Boolean))].sort();
  const named = voices.filter((v) => v.root != null).length;
  const span = thread.extent.span_m;
  const room_row = {
    id: thread.id, aliases, keys,
    first_at: iso(voices[0].at), latest_at: iso(room.latest), closed_at: iso(closesAt(room.latest, marks)),
    x0: thread.extent.x0, y0: thread.extent.y0, x1: thread.extent.x1, y1: thread.extent.y1, span_m: span,
    voice_count: thread.voice_count, participants: thread.participants,
    place: thread.place ?? null, place_mark: thread.place_mark ?? null,
    last_x: thread.at.x, last_y: thread.at.y, aboard: Boolean(thread.aboard),
    era: eraOf(voices), has_replies: voices.some((v) => v.reply_to != null),
    inputs: {
      algorithm: ALGORITHM, earshot_m: earshotM,
      settlements: { known: marks.length, first: marks.length ? iso(marks[0]) : null, last: marks.length ? iso(marks.at(-1)) : null },
      says: { named_by_the_act: named, named_when_spoken: voices.length - named },
      note: "a say's room was decided when it was spoken (a recorded name, or the room it joined by the rules of its day, named once); the rows are the identity",
    },
    frame_flag: frameFlagOf(span),
    source,
  };
  const says = voices.map((v, ord) => ({
    act_id: Number(v.act_id), room_id: thread.id, ord, at: iso(v.at), handle: v.handle, x: v.x, y: v.y,
    place: v.place ?? null, aboard: Boolean(v.aboard), say_id: v.id ?? null, reply_to: v.reply_to ?? null,
    era: v.era ?? "live", root: v.root ?? null, place_mark: v.place_mark ?? null,
  }));
  return { room: room_row, says };
}

// ── THE STORE: the tables are asked for before they are used, so a store without migration 103 answers as it always did ──

let landed = false;
/** Are migration 103's five tables there? True once seen (a table does not leave); asked with to_regclass, which never aborts a transaction. */
export async function durableLanded(client) {
  if (landed) return true;
  const { rows: [r] } = await client.query(
    `SELECT to_regclass('public.durable_rooms') IS NOT NULL AND to_regclass('public.durable_room_says') IS NOT NULL
        AND to_regclass('public.durable_event_memberships') IS NOT NULL AND to_regclass('public.durable_event_rooms') IS NOT NULL
        AND to_regclass('public.durable_event_room_says') IS NOT NULL AS ok`);
  landed = r?.ok === true;
  return landed;
}
/** Test seam: forget that the tables were seen. */
export const __forgetLandedForTest = () => { landed = false; };

const SAY_COLS = ["act_id", "room_id", "ord", "at", "handle", "x", "y", "place", "aboard", "say_id", "reply_to", "era", "root", "place_mark"];
const SAY_TYPES = ["bigint", "text", "int", "timestamptz", "text", "float8", "float8", "text", "bool", "bigint", "bigint", "text", "text", "text"];

/** The records not yet stored (by room id): the recurring producer hands the write only these, so a tick's transaction never grows with the history. */
export async function newRooms(client, records) {
  if (!records.length) return [];
  const { rows } = await client.query("SELECT id FROM durable_rooms WHERE id = ANY($1::text[])", [records.map((r) => r.room.id)]);
  const have = new Set(rows.map((r) => r.id));
  return records.filter((r) => !have.has(r.room.id));
}

/**
 * Write closed rooms, INSERT ONLY, idempotent, EXACT and ATOMIC PER ROOM. A room is written whole or not at all (each in its own savepoint):
 *   · a room already stored is never touched; its COMPLETE stored membership is compared with the derived one, both ways, and a difference is
 *     REPORTED (`drift`) and the stored record stands;
 *   · a room one of whose says is already stored in ANOTHER room is not written (a say is in exactly one room) and is reported;
 *   · a room whose says do not all land (a keeper and a replay overlapping, a say taken by another room in between) is rolled back whole and reported,
 *     never left with part of its membership; and the stored count is checked against the room's own `voice_count` before the room is let stand.
 * A room whose write fails is reported (`failed`) and the others go on: it is asked again by the next run. Returns
 * `{ inserted, existing, says_inserted, drift: [{ id, why }], failed: [{ id, why }] }`. The caller holds the transaction.
 */
export async function writeRooms(client, records) {
  if (!(await durableLanded(client))) throw new Error("migration 103 (durable rooms) has not landed: nothing was written");
  const out = { inserted: 0, existing: 0, says_inserted: 0, drift: [], failed: [] };
  for (const { room, says } of records) {
    const actIds = says.map((s) => s.act_id);
    await client.query("SAVEPOINT durable_room");
    try {
      const { rows: held } = await client.query("SELECT act_id, room_id FROM durable_room_says WHERE act_id = ANY($1::bigint[])", [actIds]);
      const elsewhere = held.filter((h) => h.room_id !== room.id);
      if (elsewhere.length) {
        out.drift.push({ id: room.id, why: `${elsewhere.length} of its says are already stored in another room (e.g. act ${elsewhere[0].act_id} in ${elsewhere[0].room_id})` });
        await client.query("ROLLBACK TO SAVEPOINT durable_room"); continue;
      }
      const { rows: ins } = await client.query(
        `INSERT INTO durable_rooms (id, aliases, keys, first_at, latest_at, closed_at, x0, y0, x1, y1, span_m, voice_count, participants, place, place_mark,
                                    last_x, last_y, aboard, era, has_replies, inputs, frame_flag, source)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23) ON CONFLICT (id) DO NOTHING RETURNING id`,
        [room.id, room.aliases, room.keys, room.first_at, room.latest_at, room.closed_at, room.x0, room.y0, room.x1, room.y1, room.span_m, room.voice_count,
          room.participants, room.place, room.place_mark, room.last_x, room.last_y, room.aboard, room.era, room.has_replies, JSON.stringify(room.inputs), room.frame_flag, room.source]);
      if (!ins.length) {
        // already stored: its WHOLE stored membership against the derived one (a say stored here and not derived is as much a difference as the reverse)
        const { rows: stored } = await client.query("SELECT act_id FROM durable_room_says WHERE room_id = $1", [room.id]);
        const have = new Set(stored.map((r) => String(r.act_id))), want = new Set(actIds.map(String));
        const missing = [...want].filter((id) => !have.has(id)).length, extra = [...have].filter((id) => !want.has(id)).length;
        out.existing += 1;
        if (missing || extra || have.size !== want.size)
          out.drift.push({ id: room.id, why: `the stored room holds ${have.size} says and the rules derive ${want.size} now (${missing} not stored, ${extra} stored and not derived): the stored record stands` });
        await client.query("RELEASE SAVEPOINT durable_room"); continue;
      }
      const cols = SAY_COLS.map((c) => says.map((s) => s[c]));
      const r = await client.query(
        `INSERT INTO durable_room_says (${SAY_COLS.join(", ")}) SELECT * FROM unnest(${SAY_TYPES.map((t, i) => `$${i + 1}::${t}[]`).join(", ")}) ON CONFLICT (act_id) DO NOTHING`, cols);
      const { rows: [{ n }] } = await client.query("SELECT count(*)::int AS n FROM durable_room_says WHERE room_id = $1", [room.id]);
      if (r.rowCount !== says.length || n !== says.length || n !== room.voice_count) {
        out.drift.push({ id: room.id, why: `not written: ${r.rowCount} of its ${says.length} says could be stored (the rest were taken meanwhile), so the room was rolled back whole` });
        await client.query("ROLLBACK TO SAVEPOINT durable_room"); continue;
      }
      await client.query("RELEASE SAVEPOINT durable_room");
      out.inserted += 1;
      out.says_inserted += r.rowCount;
    } catch (e) {
      await client.query("ROLLBACK TO SAVEPOINT durable_room").catch(() => {});
      out.failed.push({ id: room.id, why: `the write failed (${e?.code ?? "error"}); the next run asks again` });
    }
  }
  return out;
}

/** The distinct room ids a name could mean, for the page's own two-step lookup: the exact id (or alias) first, then the same handle in the same second. */
async function roomRowFor(client, find) {
  if (find?.circle != null) {
    const say = sayIdOf(find.circle);
    if (say == null) return null;
    const { rows } = await client.query(
      "SELECT r.* FROM durable_room_says s JOIN durable_rooms r ON r.id = s.room_id WHERE s.say_id = $1 LIMIT 1", [say]);
    return rows[0] ?? null;
  }
  const name = String(find?.room ?? "");
  const exact = await client.query("SELECT * FROM durable_rooms WHERE id = $1 OR $1 = ANY(aliases) LIMIT 1", [name]);
  if (exact.rows[0]) return exact.rows[0];
  const key = roomKeyOf(name);
  if (key == null) return null;
  const { rows } = await client.query("SELECT * FROM durable_rooms WHERE keys @> ARRAY[$1]::text[] ORDER BY first_at, id LIMIT 1", [key]);
  return rows[0] ?? null;
}

/**
 * The fixed record a `?room=` or `?circle=` names, or null (not stored, or the tables not landed): `{ id, latest, entry: { root, ids }, says }`.
 * `entry` is the shape the door's own room reader takes (a room's id and its act numbers, oldest first); `says` are the stored per-say positions, which
 * the door lays over what it composes, so a closed room reads as it was when it closed even if an anchor mark has since moved.
 */
export async function storedRoomFor(client, find) {
  if (!(await durableLanded(client))) return null;
  const room = await roomRowFor(client, find);
  if (!room) return null;
  const { rows: says } = await client.query("SELECT * FROM durable_room_says WHERE room_id = $1 ORDER BY ord", [room.id]);
  return { id: room.id, latest: new Date(room.latest_at).getTime(), closed_at: new Date(room.closed_at).getTime(),
    entry: { root: room.id, ids: says.map((s) => Number(s.act_id)) }, says };
}

// ── AN EVENT'S OWN WINDOW ────────────────────────────────────────────────────

/**
 * Fix an ended event's rooms to its window, INSERT ONLY: `{ eventId, window: {from, to} (ms), rooms: [{ id, header, frame, says: [{ act_id, in_window }] }],
 * unplaced, basis, source }`. A second write for the same event writes nothing and says so (`existing`), reporting a difference in the rooms it would have
 * written rather than replacing them. The caller holds the transaction.
 */
export async function writeEventMembership(client, m) {
  if (!(await durableLanded(client))) throw new Error("migration 103 (durable rooms) has not landed: nothing was written");
  const { rows: ins } = await client.query(
    `INSERT INTO durable_event_memberships (event_id, window_from, window_to, history, rooms_count, unplaced_says, basis, source)
     VALUES ($1, $2, $3, 'complete', $4, $5, $6, $7) ON CONFLICT (event_id) DO NOTHING RETURNING event_id`,
    [m.eventId, iso(m.window.from), iso(m.window.to), m.rooms.length, m.unplaced ?? 0, m.basis, m.source ?? "live"]);
  if (!ins.length) {
    const { rows } = await client.query("SELECT room_id FROM durable_event_rooms WHERE event_id = $1 ORDER BY ord", [m.eventId]);
    const stored = rows.map((r) => r.room_id).join("\n"), wanted = m.rooms.map((r) => r.id).join("\n");
    return { existing: true, ...(stored === wanted ? {} : { drift: `the stored membership names ${rows.length} room(s), the rules derive ${m.rooms.length} now: the stored record stands` }) };
  }
  let says = 0;
  for (const [ord, r] of m.rooms.entries()) {
    await client.query("INSERT INTO durable_event_rooms (event_id, ord, room_id, header, frame, frame_flag) VALUES ($1,$2,$3,$4,$5,$6)",
      [m.eventId, ord, r.id, JSON.stringify(r.header), JSON.stringify(r.frame), r.frame_flag ?? frameFlagOf(r.header?.extent?.span_m)]);
    if (!r.says.length) continue;
    const res = await client.query(
      "INSERT INTO durable_event_room_says (event_id, room_id, act_id, in_window) SELECT $1, $2, * FROM unnest($3::bigint[], $4::bool[]) ON CONFLICT (event_id, act_id) DO NOTHING",
      [m.eventId, r.id, r.says.map((s) => s.act_id), r.says.map((s) => s.in_window)]);
    // EXACT: every say of the room lands, or the whole event's record is not written (the caller's transaction rolls back; the event is asked again)
    if (res.rowCount !== r.says.length) throw new Error(`event ${m.eventId}: ${res.rowCount} of room ${r.id}'s ${r.says.length} says could be stored: the event's record is not written`);
    says += res.rowCount;
  }
  return { inserted: true, rooms: m.rooms.length, says };
}

// jsonb hands an object's keys back in ITS order (shortest first), not the order they were written in; a thread header is read in the order
// threadOf writes it, so a fixed room's answer is the same bytes a derived one is.
const HEADER_KEYS = ["id", "place_mark", "live", "place", "at", "aboard", "extent", "started", "latest", "participants", "voice_count"];
const inOrder = (o, keys) => Object.fromEntries([...keys.filter((k) => k in o), ...Object.keys(o).filter((k) => !keys.includes(k))].map((k) => [k, o[k]]));
const headerOf = (h) => ({ ...inOrder(h, HEADER_KEYS), at: inOrder(h.at, ["x", "y"]), extent: inOrder(h.extent, ["x0", "y0", "x1", "y1", "span_m"]) });

/**
 * An ended event's fixed rooms, or null when it has none stored (unknown, as ever) or the tables have not landed:
 * `{ window: {from, to} (ms), rooms: [{...header, frame}] in the order they began, unplaced_says, source }`.
 */
export async function frozenEventRooms(client, eventId) {
  if (!(await durableLanded(client))) return null;
  const { rows: [m] } = await client.query("SELECT * FROM durable_event_memberships WHERE event_id = $1", [eventId]);
  if (!m) return null;
  const { rows } = await client.query("SELECT header, frame, frame_flag FROM durable_event_rooms WHERE event_id = $1 ORDER BY ord", [eventId]);
  const asObject = (v) => (typeof v === "string" ? JSON.parse(v) : v);
  return { window: { from: new Date(m.window_from).getTime(), to: new Date(m.window_to).getTime() },
    rooms: rows.map((r) => ({ ...headerOf(asObject(r.header)), frame: inOrder(asObject(r.frame), ["room", "at", "extent"]), ...(r.frame_flag ? { frame_flag: r.frame_flag } : {}) })), unplaced_says: Number(m.unplaced_says ?? 0), source: m.source };
}

/** The ended events (ids) that already have a fixed membership, among `ids`: the recurring producer reconstructs only the others. */
export async function eventsAlreadyFixed(client, ids) {
  if (!ids.length || !(await durableLanded(client))) return new Set();
  const { rows } = await client.query("SELECT event_id FROM durable_event_memberships WHERE event_id = ANY($1::text[])", [ids]);
  return new Set(rows.map((r) => r.event_id));
}

// ── THE LISTS (the bare read and ?before=): fixed rooms stand in for the closed rooms the kept index would derive ──

/**
 * Every fixed room that had closed by `atMs`, light columns only (no says): `[{ id, latest, first, closed }]` in ms, or [] when the tables have not
 * landed. A room fixed as closed at a later instant than the one a read is evaluated at (`?at=`) was still open then, and is the derivation's.
 */
export async function storedClosedRooms(client, atMs) {
  if (!(await durableLanded(client))) return [];
  const { rows } = await client.query("SELECT id, first_at, latest_at, closed_at FROM durable_rooms WHERE closed_at <= $1 ORDER BY latest_at, id", [iso(atMs)]);
  return rows.map((r) => ({ id: r.id, latest: new Date(r.latest_at).getTime(), first: new Date(r.first_at).getTime(), closed: new Date(r.closed_at).getTime() }));
}

/** The fixed room (id) holding each of `actIds`, as a Map(act id → room id): which derived rooms a fixed one already stands for. */
export async function storedRoomOfActs(client, actIds) {
  if (!actIds.length || !(await durableLanded(client))) return new Map();
  const { rows } = await client.query("SELECT act_id, room_id FROM durable_room_says WHERE act_id = ANY($1::bigint[])", [actIds.map(Number)]);
  return new Map(rows.map((r) => [String(r.act_id), r.room_id]));
}

/** The says of the fixed rooms `ids`, as Map(room id → rows in order). */
export async function storedSaysOfRooms(client, ids) {
  const out = new Map();
  if (!ids.length || !(await durableLanded(client))) return out;
  const { rows } = await client.query("SELECT * FROM durable_room_says WHERE room_id = ANY($1::text[]) ORDER BY room_id, ord", [ids]);
  for (const r of rows) { if (!out.has(r.room_id)) out.set(r.room_id, []); out.get(r.room_id).push(r); }
  return out;
}
