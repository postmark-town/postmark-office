#!/usr/bin/env node
// replay-rooms.mjs — fix the closed rooms and the ended events' own windows, from the first say to now (POS-1203, CORE-170; migration 103).
//
//   node world2/tools/replay-rooms.mjs --world <world clone>                 # a DRY RUN: the report, nothing written
//   node world2/tools/replay-rooms.mjs --world <world clone> --apply          # write what is not yet written
//   [--now <ISO instant>] [--json]
//
// Connects as the pg environment says (WORLD2_PG_URL, else PG*), as `office_api`: the only role holding INSERT on the five tables.
//
// WHAT IT DOES. The store's says (`acts`) and the World's published settlements (every `settlement: sweep` commit on world main, the settlements
// hearing-window.mjs § everyPublishedSettlementAt reads) are grouped with THE ONE ALGORITHM the conversations page and an event's page use
// (src/rooms.mjs § roomsOf), and then:
//   · every room that has TRULY CLOSED (a settlement has passed and the hour after it ran out with no say in it; hearing-window.mjs § roomOpen)
//     is written as a fixed record (src/durable-rooms.mjs § writeRooms). A room still open or carried is not written.
//   · every ENDED event whose rooms can be told, and which has no fixed membership yet, has its rooms fixed to its own window
//     (event-sparks.mjs § eventEvidence → durable-rooms.mjs § writeEventMembership). An event whose window opens before the oldest settlement is
//     reported UNKNOWN and left as it was, never written as none.
//
// IDEMPOTENT, AND IDENTITY-PRESERVING. INSERT ONLY with ON CONFLICT DO NOTHING: a second run writes nothing new, a stored room is never edited, and a
// stored room that the rules would now derive differently is REPORTED under `drift` and left standing (the stored record is the identity).
//
// WHAT IT NEVER DOES. It invents nothing: a say whose place cannot be composed is left out and counted (`unplaced`), a say older than the oldest
// known settlement is not grouped and counted (`ungrouped`), talk with no reply links stays a timeline (`timeline_only`), a room whose bounds look
// wrong (more than SUSPECT_SPAN_M across: the costume awards' `t1793353930000-seraphina`) is written as derived and LISTED under `suspect_frames`
// for the lead's judgment, and a say spoken inside a dungeon's walls is never read. It writes no say's words (they stay in `acts`).
//
// The production run is the operator's (deploy/DEPLOY.md § durable rooms). Nothing in the code lane runs it against production.

import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as talk from "../tools/conversations.mjs";
import { everyPublishedSettlementAt } from "../../src/hearing-window.mjs";
import { roomRecordOf, writeRooms, writeEventMembership, durableLanded, isClosed, SUSPECT_SPAN_M } from "../../src/durable-rooms.mjs";
import { eventEvidence, eventWindow } from "../../src/event-sparks.mjs";
import { POST_COLUMNS, rowOf } from "../../src/events-store.mjs";
import { EVENT_CLASS } from "../../src/events.mjs";

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

/**
 * The replay. `edges` are the published settlements (ms, ascending), `nowMs` the instant "closed" is judged at, `apply` whether anything is written.
 * Returns the report. The caller owns the connection; a write happens in ONE transaction here, rolled back whole on any error.
 */
export async function replayRooms(client, { edges, nowMs = Date.now(), apply = false, events = true } = {}) {
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
  const ungrouped = voices.length - grouped.length;
  const rooms = talk.roomsOf(grouped, { earshotM, boundaries: marks });
  const closed = rooms.filter((r) => isClosed(r.latest, nowMs, marks));
  const records = closed.map((r) => roomRecordOf(r, { edges: marks, nowMs, earshotM, source: "replay" }));

  let existingIds = new Set();
  if (landed && records.length) {
    const { rows: have } = await client.query("SELECT id FROM durable_rooms WHERE id = ANY($1::text[])", [records.map((r) => r.room.id)]);
    existingIds = new Set(have.map((r) => r.id));
  }
  const report = {
    mode: apply ? "apply" : "dry-run", now: iso(nowMs), migration_landed: landed,
    settlements: { known: marks.length, first: marks.length ? iso(marks[0]) : null, last: marks.length ? iso(marks.at(-1)) : null },
    says: { voice_acts: rows.length, placed: voices.length, grouped: grouped.length, unplaced: unplaced.length, refused: refusals.length, ungrouped_before_first_settlement: ungrouped,
      dungeon_interior_never_read: interior, first_say: voices.length ? iso(Math.min(...voices.map((v) => v.at))) : null },
    rooms: { derived: rooms.length, closed: closed.length, open_or_carried: rooms.length - closed.length, already_stored: existingIds.size, to_write: records.length - existingIds.size,
      timeline_only: records.filter((r) => !r.room.has_replies).length },
    suspect_frames: records.filter((r) => r.room.frame_flag).map((r) => ({ id: r.room.id, span_m: r.room.span_m, extent: [r.room.x0, r.room.y0, r.room.x1, r.room.y1], note: r.room.frame_flag })),
    unplaced_examples: unplaced.slice(0, 5).map((u) => ({ act_id: u.act_id, anchor: u.anchor })),
    refused_examples: refusals.slice(0, 5),
  };
  if (!landed && apply) throw new Error("migration 103 (durable rooms) has not landed: nothing was written");

  // the ended events whose rooms can be told and are not yet fixed
  const eventReport = { ended: 0, already_fixed: 0, to_fix: 0, unknown: [], fixed: [] };
  const toFix = [];
  if (events) {
    const { rows: ended } = await client.query(`SELECT ${POST_COLUMNS} FROM posts WHERE class = $1 AND ends <= $2 AND state <> 'cancelled' ORDER BY ends, id`, [EVENT_CLASS, iso(nowMs)]);
    const done = landed ? new Set((await client.query("SELECT event_id FROM durable_event_memberships")).rows.map((r) => r.event_id)) : new Set();
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
    }
    eventReport.to_fix = toFix.length;
  }
  report.events = eventReport;
  if (!apply) return report;

  await client.query("BEGIN");
  try {
    report.written = { rooms: await writeRooms(client, records), events: [] };
    for (const { row, m } of toFix) {
      const rooms = m.rooms.map(({ frame, ...header }) => ({ id: header.id, header, frame, says: m.members.find((x) => x.id === header.id)?.says ?? [] }));
      const out = await writeEventMembership(client, { eventId: row.id, window: m.window, unplaced: m.unplaced, source: "replay", rooms,
        basis: "the rooms with a say spoken inside the event's window within earshot of its place (event-sparks.mjs § eventRoomFrom), as they stood at the window's end; the says each held up to then" });
      report.written.events.push({ event: row.id, rooms: rooms.length, ...out });
      eventReport.fixed.push(row.id);
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  }
  return report;
}

const argOf = (name) => { const i = process.argv.indexOf(name); return i === -1 ? null : process.argv[i + 1] ?? null; };
const flag = (name) => process.argv.includes(name);

async function main() {
  const world = argOf("--world");
  if (!world) {
    console.error("usage: replay-rooms.mjs --world <world clone> [--apply] [--now <ISO instant>] [--json]   (a dry run unless --apply)");
    return 2;
  }
  const nowArg = argOf("--now");
  const nowMs = nowArg ? Date.parse(nowArg) : Date.now();
  if (!Number.isFinite(nowMs)) { console.error(`--now ${nowArg} is not an instant`); return 2; }
  let edges;
  try { edges = await everyPublishedSettlementAt(resolve(world)); }
  catch (e) { console.error(`the World's published settlements could not be read (${String(e?.message ?? e).slice(0, 160)}): without them no room's epoch is known, so nothing is replayed`); return 3; }
  if (!edges.length) { console.error("the World holds no published settlement: no room's epoch is known, so nothing is replayed"); return 3; }
  const { default: pg } = await import("pg");
  const client = new pg.Client(process.env.WORLD2_PG_URL ? { connectionString: process.env.WORLD2_PG_URL } : undefined);
  await client.connect();
  try {
    const report = await replayRooms(client, { edges, nowMs, apply: flag("--apply") });
    console.log(JSON.stringify(report, null, flag("--json") ? 0 : 2));
    return 0;
  } finally { await client.end(); }
}

const isMain = (() => {
  if (!process.argv[1]) return false;
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return pathToFileURL(process.argv[1]).href === import.meta.url; }
})();
if (isMain) main().then((code) => { process.exitCode = code; }, (e) => { console.error(String(e?.stack ?? e)); process.exitCode = 1; });
