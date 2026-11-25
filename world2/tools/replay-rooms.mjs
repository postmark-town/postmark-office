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
import { everyPublishedSettlementAt } from "../../src/hearing-window.mjs";
import { writeRooms } from "../../src/durable-rooms.mjs";
import { planDurable, fixEvent } from "../../src/durable-keep.mjs";

/**
 * The replay. `edges` are the published settlements (ms, ascending), `nowMs` the instant "closed" is judged at, `apply` whether anything is written.
 * Returns the report. The caller owns the connection. The derivation is the producer's own (src/durable-keep.mjs § planDurable) and runs OUTSIDE the
 * write; the write is one transaction, rolled back whole on any error. Unlike the keeping tick's producer it hands EVERY closed room to the write, so a
 * stored room the rules would now derive differently is compared and reported under `drift`.
 */
export async function replayRooms(client, { edges, nowMs = Date.now(), apply = false, events = true } = {}) {
  const plan = await planDurable(client, { edges, nowMs, events, newOnly: false });
  const report = { mode: apply ? "apply" : "dry-run", ...plan.report };
  if (!plan.landed && apply) throw new Error("migration 103 (durable rooms) has not landed: nothing was written");
  if (!apply) return report;

  await client.query("BEGIN");
  try {
    report.written = { rooms: await writeRooms(client, plan.records), events: [] };
    for (const item of plan.toFix) {
      const out = await fixEvent(client, item, "replay");
      report.written.events.push({ event: item.row.id, rooms: item.m.rooms.length, ...out });
      report.events.fixed.push(item.row.id);
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
