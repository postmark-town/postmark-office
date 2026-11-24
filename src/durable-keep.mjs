// durable-keep.mjs — the one derivation of "what can be fixed now", for the keeping tick's producer and for the first-say replay (POS-1203, CORE-170).
//
// Darko's ruling is continuous durability, not a one-time backfill: a room that truly closes, and an event that ends, must be FIXED by the office's own
// recurring work, whatever else the tick does. Two callers, one derivation:
//
//   · `keepDurable` (deploy/durable-rooms-pass.mjs, a step of the existing keeping tick, deploy/office-keep.sh): NEW ONLY. The reads and the whole
//     reconstruction run OUTSIDE every write: the inputs (the says no fixed room holds, the ended events not yet fixed) are read in one short read-only
//     lease that is RELEASED, and the unfixed talk is composed with no connection held; the records already stored are never handed to a write; the
//     rooms are written in one small transaction (each room whole or not at all) and each event in its own, so a tick's write never grows with the
//     history and one failure holds up nothing else. A failed write is REPORTED and asked again by the next tick: the producer decides nothing
//     it cannot recompute, and it needs no cursor, because "not yet stored" is the cursor.
//   · `replayRooms` (world2/tools/replay-rooms.mjs): the explicit first-say backfill, every closed room (stored ones compared, so `drift` is
//     reported) and every ended event with no membership.
//
// The producer is independent of the event completion (event-sparks.mjs § completeEvent): an ended event is fixed whether or not it had a stake,
// came due in DUE_EVENTS_SQL, or had free-event drafting configured. Nothing here is a prerequisite of a spark or a stake's return.

import * as talk from "../world2/tools/conversations.mjs";
import { roomRecordOf, writeRooms, writeEventMembership, durableLanded, isClosed, eventsAlreadyFixed, composeProbe } from "./durable-rooms.mjs";
import { eventEvidenceInputs, composeEventEvidence, eventWindow } from "./event-sparks.mjs";
import { POST_COLUMNS, rowOf } from "./events-store.mjs";
import { EVENT_CLASS } from "./events.mjs";
import { faultLogged } from "./fault-words.mjs";

const PAGE = 2000;
const iso = (ms) => new Date(ms).toISOString();
/** A say spoken inside a dungeon room is on no public read, and in no room of one (WLD-74). */
const spokenInRoom = (row) => Boolean(row?.payload?.room ?? row?.payload?.payload?.room);

/**
 * Every voice act, by act number, a page at a time (the same read the door's kept rooms build from, with its words). `unfixedOnly` leaves out the says a fixed
 * room already holds: the recurring producer composes only what is not yet fixed, so a tick's work follows the unfixed talk and not the history.
 */
async function voiceActs(client, { unfixedOnly }) {
  const rows = [];
  for (let after = 0; ;) {
    const { rows: page } = await client.query(
      `SELECT id, at, actor, action, at_anchor, at_dx, at_dy, payload FROM acts WHERE action = ANY($1) AND id > $2
         ${unfixedOnly ? "AND NOT EXISTS (SELECT 1 FROM durable_room_says d WHERE d.act_id = acts.id)" : ""} ORDER BY id LIMIT $3`, [talk.VOICE_ACTIONS, after, PAGE]);
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
 * THE INPUTS (queries only, so the caller can RELEASE its connection before any composition: the pen's idle-in-transaction bound is 30 s and grouping history is
 * CPU). `newOnly` (the recurring producer) reads only the says no fixed room holds and the ended events not yet fixed, so what follows composes the unfixed
 * portion and never the fixed history; without it (the explicit replay) everything is read, so the stored rooms can be compared and `drift` reported.
 */
export async function loadDurableInputs(client, { edges, nowMs = Date.now(), events = true, newOnly = false } = {}) {
  const marks = [...edges].filter(Number.isFinite).sort((a, b) => a - b);
  const landed = await durableLanded(client);
  const unfixedOnly = newOnly && landed;
  const rows = await voiceActs(client, { unfixedOnly });
  const { rows: markRows } = await client.query(talk.ANCHOR_MARKS_SQL);
  let existingIds = new Set();
  const input = { marks, landed, nowMs, newOnly, rows, markRows, existingIds, ended: [], done: new Set(), eventInputs: [], events };
  if (events) {
    const { rows: ended } = await client.query(`SELECT ${POST_COLUMNS} FROM posts WHERE class = $1 AND ends <= $2 AND state <> 'cancelled' ORDER BY ends, id`, [EVENT_CLASS, iso(nowMs)]);
    input.ended = ended.map(rowOf);
    input.done = landed ? await eventsAlreadyFixed(client, input.ended.map((r) => r.id)) : new Set();
    // the unfixed says as the event read takes them, in the order it groups them (at, id)
    const sorted = [...rows].sort((x, y) => Date.parse(x.at) - Date.parse(y.at) || Number(x.id) - Number(y.id));
    for (const row of input.ended) {
      if (input.done.has(row.id) || !eventWindow(row)) { input.eventInputs.push(null); continue; }
      input.eventInputs.push(await eventEvidenceInputs(client, row, { now: nowMs, edges: marks, sayRows: sorted, archive: unfixedOnly }));
    }
  }
  return input;
}

/** The stored ids among the records (the replay's comparison only; the producer's rows are the unfixed ones already). */
export async function storedRoomIds(client, records) {
  if (!records.length || !(await durableLanded(client))) return new Set();
  const { rows } = await client.query("SELECT id FROM durable_rooms WHERE id = ANY($1::text[])", [records.map((r) => r.room.id)]);
  return new Set(rows.map((r) => r.id));
}

/**
 * PURE. What can be fixed now, composed from the inputs: the closed rooms as records, the ended events whose rooms can be told and are not yet fixed, and the
 * report's counts. `stored` is the set of room ids already stored (the replay's comparison; empty for the producer).
 */
export function composeDurablePlan(input, { stored = new Set() } = {}) {
  composeProbe.hook?.("rooms");
  const { marks, landed, nowMs, newOnly, rows, markRows } = input;
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
  const records = closed.map((r) => roomRecordOf(r, { edges: marks, nowMs, earshotM, source: newOnly ? "live" : "replay" }));
  const existingIds = new Set(records.filter((r) => stored.has(r.room.id)).map((r) => r.room.id));
  const report = {
    now: iso(nowMs), migration_landed: landed,
    settlements: { known: marks.length, first: marks.length ? iso(marks[0]) : null, last: marks.length ? iso(marks.at(-1)) : null },
    says: { voice_acts: rows.length, placed: voices.length, grouped: grouped.length, unplaced: unplaced.length, refused: refusals.length,
      ungrouped_before_first_settlement: voices.length - grouped.length, dungeon_interior_never_read: interior,
      first_say: voices.length ? iso(Math.min(...voices.map((v) => v.at))) : null },
    // the producer composes only the unfixed says, so every room it derives is one to write; the replay compares against what is stored
    rooms: { derived: rooms.length, closed: closed.length, open_or_carried: rooms.length - closed.length,
      already_stored: existingIds.size, to_write: records.length - existingIds.size, timeline_only: records.filter((r) => !r.room.has_replies).length },
    suspect_frames: records.filter((r) => r.room.frame_flag).map((r) => ({ id: r.room.id, span_m: r.room.span_m, extent: [r.room.x0, r.room.y0, r.room.x1, r.room.y1], note: r.room.frame_flag })),
    unplaced_examples: unplaced.slice(0, 5).map((u) => ({ act_id: u.act_id, anchor: u.anchor })),
    refused_examples: refusals.slice(0, 5),
  };

  // every ended event the public event read covers (not cancelled, ended): whatever its stake, its due state or the free-event cutoff
  const eventReport = { ended: 0, already_fixed: 0, to_fix: 0, unknown: [], fixed: [], suspect_frames: [] };
  const toFix = [];
  if (input.events) {
    input.ended.forEach((row, i) => {
      eventReport.ended += 1;
      if (input.done.has(row.id)) { eventReport.already_fixed += 1; return; }
      if (!eventWindow(row)) { eventReport.unknown.push({ event: row.id, why: "no window" }); return; }
      const collect = {};
      const evidence = input.eventInputs[i] ? composeEventEvidence(input.eventInputs[i], { collect }) : null;
      if (!evidence?.complete || evidence.room_history !== "complete" || !collect.membership) {
        eventReport.unknown.push({ event: row.id, why: evidence?.room_note ?? "its rooms cannot be told" });
        return;
      }
      toFix.push({ row, m: collect.membership });
      for (const r of collect.membership.rooms) if (r.frame_flag) eventReport.suspect_frames.push({ event: row.id, room: r.id, span_m: r.extent?.span_m, note: r.frame_flag });
    });
    eventReport.to_fix = toFix.length;
  }
  report.events = eventReport;
  return { marks, landed, records, toFix, report };
}

/** Both halves, for a caller on its own connection (the explicit replay): the inputs, then the composition, with the stored rooms compared. */
export async function planDurable(client, opts = {}) {
  const input = await loadDurableInputs(client, opts);
  const plan0 = composeDurablePlan(input);
  const stored = opts.newOnly ? new Set() : await storedRoomIds(client, plan0.records);
  return stored.size ? composeDurablePlan(input, { stored }) : plan0;
}

/** One ended event's fixed record, in the caller's transaction. */
export const fixEvent = (client, { row, m }, source) => writeEventMembership(client, {
  eventId: row.id, window: m.window, unplaced: m.unplaced, source, rooms: membershipRows(m), basis: EVENT_BASIS });

/**
 * THE RECURRING PRODUCER. Fixes every room that has truly closed and every ended event, NEW ONLY, from the pen (`office_api`). The inputs are read in one
 * short read-only lease that is released, and the unfixed talk is composed after it, with no connection held; the rooms land in one small transaction and each event in its own. Never throws for a
 * write: a failure is in the report (`rooms.failed`, `events.failed`) and the next tick asks again. A store without migration 103 answers
 * `{ landed: false }` and writes nothing. `edges` are the published settlements (ms); with none known nothing can be told, and nothing is written.
 */
export async function keepDurable({ edges, nowMs = Date.now(), env = process.env, pen = null } = {}) {
  const w = pen ?? (await import("./world2-pen.mjs"));
  if (!edges?.length) return { landed: null, wrote: false, note: "no published settlement is known, so no room's epoch is: nothing was fixed" };
  // the lease reads the inputs and is RELEASED; the composition of the unfixed talk runs with no connection held (POS-1203)
  const input = await w.officeRead((client) => loadDurableInputs(client, { edges, nowMs, newOnly: true }), { env, by: "durableKeep" });
  const plan = composeDurablePlan(input);
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
