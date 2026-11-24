// durable-keep.mjs — the one derivation of "what can be fixed now", for the keeping tick's producer and for the first-say replay (POS-1203, CORE-170).
//
// Darko's ruling is continuous durability, not a one-time backfill: a room that truly closes, and an event that ends, must be FIXED by the office's own
// recurring work, whatever else the tick does. Two callers, one derivation:
//
//   · `keepDurable` (deploy/durable-rooms-pass.mjs, a step of the existing keeping tick, deploy/office-keep.sh): NEW ONLY. The reads and the whole
//     reconstruction run in the pen's read-only transaction, outside every write; the records already stored are filtered out BEFORE any write; the
//     rooms are written in one small transaction (each room whole or not at all) and each event in its own, so a tick's write never grows with the
//     history and one failure holds up nothing else. A failed write is REPORTED and asked again by the next tick: the producer decides nothing
//     it cannot recompute, and it needs no cursor, because "not yet stored" is the cursor.
//   · `replayRooms` (world2/tools/replay-rooms.mjs): the explicit first-say backfill, every closed room (stored ones compared, so `drift` is
//     reported) and every ended event with no membership.
//
// The producer is independent of the event completion (event-sparks.mjs § completeEvent): an ended event is fixed whether or not it had a stake,
// came due in DUE_EVENTS_SQL, or had free-event drafting configured. Nothing here is a prerequisite of a spark or a stake's return.

import * as talk from "../world2/tools/conversations.mjs";
import { roomRecordOf, writeRooms, writeEventMembership, durableLanded, isClosed, newRooms, eventsAlreadyFixed } from "./durable-rooms.mjs";
import { eventEvidence, eventWindow } from "./event-sparks.mjs";
import { POST_COLUMNS, rowOf } from "./events-store.mjs";
import { EVENT_CLASS } from "./events.mjs";
import { faultLogged } from "./fault-words.mjs";

const PAGE = 2000;
const iso = (ms) => new Date(ms).toISOString();
/** A say spoken inside a dungeon room is on no public read, and in no room of one (WLD-74). */
const spokenInRoom = (row) => Boolean(row?.payload?.room ?? row?.payload?.payload?.room);

/** Every voice act, by act number, a page at a time (the same read the door's kept rooms build from, with its words). */
async function everyVoiceAct(client) {
  const rows = [];
  for (let after = 0; ;) {
    const { rows: page } = await client.query(
      "SELECT id, at, actor, action, at_anchor, at_dx, at_dy, payload FROM acts WHERE action = ANY($1) AND id > $2 ORDER BY id LIMIT $3", [talk.VOICE_ACTIONS, after, PAGE]);
    rows.push(...page);
    if (page.length < PAGE) break;
    after = Number(page.at(-1).id);
  }
  return rows;
}

export const EVENT_BASIS = "the rooms with a say spoken inside the event's window within earshot of its place (event-sparks.mjs § eventRoomFrom), as they stood at the window's end; the says each held up to then";

/** An event's membership (what eventEvidence collected beside its evidence) as the rows `writeEventMembership` takes. */
export const membershipRows = (m) => m.rooms.map(({ frame, frame_flag, ...header }) => ({
  id: header.id, header, frame, frame_flag, says: m.members.find((x) => x.id === header.id)?.says ?? [] }));

/**
 * READ ONLY. What can be fixed now, from `client`'s view of the store and the published settlements `edges` (ms): the closed rooms as records, the
 * ended events whose rooms can be told and are not yet fixed, and the report's counts. `newOnly` drops the records already stored (rooms by id, events
 * by event id) BEFORE the events' reconstruction and before any write is asked; without it the stored rooms stay in so the replay can compare them.
 */
export async function planDurable(client, { edges, nowMs = Date.now(), events = true, newOnly = false } = {}) {
  const marks = [...edges].filter(Number.isFinite).sort((a, b) => a - b);
  const landed = await durableLanded(client);
  const rows = await everyVoiceAct(client);
  const { rows: markRows } = await client.query(talk.ANCHOR_MARKS_SQL);
  const centres = talk.anchorCentres(markRows);
  const dials = talk.sayDials(markRows.filter((m) => m.status === "standing"));
  const earshotM = dials.earshot_m.value;
  const interior = rows.filter(spokenInRoom).length;
  const open = rows.filter((r) => !spokenInRoom(r));
  const { voices, unplaced, refusals } = talk.voiceRecords(open, { centreOf: (id) => centres.get(id) ?? null, strict: false });
  const oldest = marks[0] ?? null;
  const grouped = oldest == null ? voices : voices.filter((v) => v.at >= oldest);
  const rooms = talk.roomsOf(grouped, { earshotM, boundaries: marks });
  const closed = rooms.filter((r) => isClosed(r.latest, nowMs, marks));
  const allRecords = closed.map((r) => roomRecordOf(r, { edges: marks, nowMs, earshotM, source: newOnly ? "live" : "replay" }));
  const records = newOnly && landed ? await newRooms(client, allRecords) : allRecords;
  let existingIds = new Set();
  if (!newOnly && landed && records.length) {
    const { rows: have } = await client.query("SELECT id FROM durable_rooms WHERE id = ANY($1::text[])", [records.map((r) => r.room.id)]);
    existingIds = new Set(have.map((r) => r.id));
  }
  const report = {
    now: iso(nowMs), migration_landed: landed,
    settlements: { known: marks.length, first: marks.length ? iso(marks[0]) : null, last: marks.length ? iso(marks.at(-1)) : null },
    says: { voice_acts: rows.length, placed: voices.length, grouped: grouped.length, unplaced: unplaced.length, refused: refusals.length,
      ungrouped_before_first_settlement: voices.length - grouped.length, dungeon_interior_never_read: interior,
      first_say: voices.length ? iso(Math.min(...voices.map((v) => v.at))) : null },
    rooms: { derived: rooms.length, closed: closed.length, open_or_carried: rooms.length - closed.length,
      already_stored: newOnly ? closed.length - records.length : existingIds.size, to_write: newOnly ? records.length : records.length - existingIds.size,
      timeline_only: records.filter((r) => !r.room.has_replies).length },
    suspect_frames: records.filter((r) => r.room.frame_flag).map((r) => ({ id: r.room.id, span_m: r.room.span_m, extent: [r.room.x0, r.room.y0, r.room.x1, r.room.y1], note: r.room.frame_flag })),
    unplaced_examples: unplaced.slice(0, 5).map((u) => ({ act_id: u.act_id, anchor: u.anchor })),
    refused_examples: refusals.slice(0, 5),
  };

  // every ended event the public event read covers (not cancelled, ended): whatever its stake, its due state or the free-event cutoff
  const eventReport = { ended: 0, already_fixed: 0, to_fix: 0, unknown: [], fixed: [], suspect_frames: [] };
  const toFix = [];
  if (events) {
    const { rows: ended } = await client.query(`SELECT ${POST_COLUMNS} FROM posts WHERE class = $1 AND ends <= $2 AND state <> 'cancelled' ORDER BY ends, id`, [EVENT_CLASS, iso(nowMs)]);
    const done = landed ? await eventsAlreadyFixed(client, ended.map((r) => r.id)) : new Set();
    for (const row of ended.map(rowOf)) {
      eventReport.ended += 1;
      if (done.has(row.id)) { eventReport.already_fixed += 1; continue; }
      if (!eventWindow(row)) { eventReport.unknown.push({ event: row.id, why: "no window" }); continue; }
      const collect = {};
      const evidence = await eventEvidence(client, row, { now: nowMs, edges: marks, collect });
      if (!evidence?.complete || evidence.room_history !== "complete" || !collect.membership) {
        eventReport.unknown.push({ event: row.id, why: evidence?.room_note ?? "its rooms cannot be told" });
        continue;
      }
      toFix.push({ row, m: collect.membership });
      for (const r of collect.membership.rooms) if (r.frame_flag) eventReport.suspect_frames.push({ event: row.id, room: r.id, span_m: r.extent?.span_m, note: r.frame_flag });
    }
    eventReport.to_fix = toFix.length;
  }
  report.events = eventReport;
  return { marks, landed, records, toFix, report };
}

/** One ended event's fixed record, in the caller's transaction. */
export const fixEvent = (client, { row, m }, source) => writeEventMembership(client, {
  eventId: row.id, window: m.window, unplaced: m.unplaced, source, rooms: membershipRows(m), basis: EVENT_BASIS });

/**
 * THE RECURRING PRODUCER. Fixes every room that has truly closed and every ended event, NEW ONLY, from the pen (`office_api`). Reads (and the whole
 * reconstruction) are in the pen's read-only transaction; the rooms land in one small transaction and each event in its own. Never throws for a
 * write: a failure is in the report (`rooms.failed`, `events.failed`) and the next tick asks again. A store without migration 103 answers
 * `{ landed: false }` and writes nothing. `edges` are the published settlements (ms); with none known nothing can be told, and nothing is written.
 */
export async function keepDurable({ edges, nowMs = Date.now(), env = process.env, pen = null } = {}) {
  const w = pen ?? (await import("./world2-pen.mjs"));
  if (!edges?.length) return { landed: null, wrote: false, note: "no published settlement is known, so no room's epoch is: nothing was fixed" };
  const plan = await w.officeRead((client) => planDurable(client, { edges, nowMs, newOnly: true }), { env, by: "durableKeep" });
  const out = { landed: plan.landed, wrote: false, ...plan.report, rooms: { ...plan.report.rooms, written: null, failed: [], drift: [] },
    events: { ...plan.report.events, fixed: [], failed: [] } };
  if (!plan.landed) return out;
  if (plan.records.length) {
    try {
      const wrote = await w.officeWrite((client) => writeRooms(client, plan.records), { env });
      out.rooms.written = { inserted: wrote.inserted, says_inserted: wrote.says_inserted };
      out.rooms.failed.push(...wrote.failed); out.rooms.drift.push(...wrote.drift);
      out.wrote = out.wrote || wrote.inserted > 0;
    } catch (e) { out.rooms.failed.push({ id: "*", why: faultLogged("the closed rooms could not be fixed this tick (the next tick asks again)", e) }); }
  }
  for (const item of plan.toFix) {
    try {
      await w.officeWrite((client) => fixEvent(client, item, "live"), { env });
      out.events.fixed.push(item.row.id); out.wrote = true;
    } catch (e) { out.events.failed.push({ event: item.row.id, why: faultLogged(`event ${item.row.id} could not have its rooms fixed this tick (the next tick asks again)`, e) }); }
  }
  return out;
}
