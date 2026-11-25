// durable-rooms-pass.mjs — the keeping tick's step that FIXES the rooms that have closed and the events that have ended (POS-1203, CORE-170; migration 103).
//
//   node deploy/durable-rooms-pass.mjs --world <world clone>
//
// Darko's ruling is that rooms, galleries and conversations are durable, which is a standing duty and not one backfill. This is the standing half: it runs in
// deploy/office-keep.sh, in the tick that already runs (no timer, no service, no new authority), and asks src/durable-keep.mjs § keepDurable, which
//
//   · fixes every room that has TRULY CLOSED (hearing-window.mjs § roomOpen, the one rule) and is not yet stored,
//   · fixes every ENDED event's own window that is not yet stored, whatever its stake, whether it came due in DUE_EVENTS_SQL, and whether free-event
//     drafting is configured (the event-sparks pass's cohort is the money's; this one is the archive's),
//   · reads and reconstructs OUTSIDE its writes, and hands the write only what is not stored, so the tick's work does not grow with the history,
//   · reports a failed write and asks again next tick; and never makes a spark's production or a stake's return wait on it (it runs after both).
//
// It takes no town lock and signs nothing: it reads the store and the World's published settlements, and writes insert-only rows as the pen (`office_api`).
// The first backfill of the history is the explicit replay (world2/tools/replay-rooms.mjs), which the operator runs once, dry first.
//
// Its one output line carries counts and ids, never a say's words. Exit: 0 every closed room and ended event it found is fixed (or already was);
// 1 something it tried to write failed, or a stored record differs from what the rules derive now (reported, never replaced); 2 usage;
// 3 nothing could be told: migration 103 has not landed here, or the World holds no published settlement.

import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const arg = (argv, name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };

export async function main(argv = process.argv.slice(2), env = process.env, { keep = null, settlementsOf = null } = {}) {
  const world = arg(argv, "--world");   // named by the caller, never read from the environment: a bare run is usage
  if (!world) { console.error("usage: node deploy/durable-rooms-pass.mjs --world <world clone>"); return 2; }
  let edges;
  try {
    const read = settlementsOf ?? (await import("../src/hearing-window.mjs")).everyPublishedSettlementAt;
    edges = await read(resolve(world));
  } catch { console.error("[durable-rooms] the World's published settlements could not be read: nothing is fixed; the next tick asks again"); return 1; }
  if (!edges?.length) { console.error("[durable-rooms] the World holds no published settlement: no room's epoch is known, so nothing is fixed"); return 3; }
  const keepDurable = keep ?? (await import("../src/durable-keep.mjs")).keepDurable;
  let out;
  try { out = await keepDurable({ edges, nowMs: Date.now(), env }); }
  catch { console.error("[durable-rooms] the store could not be read this tick: nothing is fixed; the next tick asks again"); return 1; }
  if (out.landed === false) { console.error("[durable-rooms] migration 103 has not landed in this store: nothing is fixed"); return 3; }
  const failed = (out.rooms?.failed?.length ?? 0) + (out.events?.failed?.length ?? 0);
  const drift = out.rooms?.drift?.length ?? 0;
  console.log(JSON.stringify({
    durable_rooms: { closed: out.rooms?.closed, fixed_now: out.rooms?.written?.inserted ?? 0, already_stored: out.rooms?.already_stored, failed: out.rooms?.failed?.length ?? 0, drift: out.rooms?.drift ?? [] },
    durable_events: { ended: out.events?.ended, fixed_now: out.events?.fixed?.length ?? 0, already_fixed: out.events?.already_fixed, unknown: out.events?.unknown?.length ?? 0, failed: out.events?.failed?.length ?? 0 },
    suspect_frames: [...(out.suspect_frames ?? []).map((r) => ({ room: r.id, span_m: r.span_m })), ...(out.events?.suspect_frames ?? []).map((r) => ({ event: r.event, room: r.room, span_m: r.span_m }))],
  }));
  if (failed) console.error(`[durable-rooms] ${failed} write(s) failed this tick — the next tick asks again`);
  return failed || drift ? 1 : 0;
}

const isMain = (() => {
  if (!process.argv[1]) return false;
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return false; }
})();
if (isMain) main().then((code) => process.exit(code), (e) => { console.error(String(e?.stack ?? e)); process.exit(1); });
