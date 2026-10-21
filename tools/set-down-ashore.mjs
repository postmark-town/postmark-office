#!/usr/bin/env node
// set-down-ashore.mjs — file a resident's first position where they stood, by hand (POS-740).
//
//   node tools/set-down-ashore.mjs --handle <h> [--at <mark id>] [--household <slug>] [--apply] [--json]
//
// The co-sign does this itself since POS-740 (src/oauth.mjs, src/set-down.mjs).
// This is the hand repair, for a berth that came ashore before it did, or whose
// co-sign could not write it (the office logs "came ashore with no position").
// It writes the SAME record the co-sign writes: one zero-length departure at the
// mark's place, `declared_by: "the-town"`, with the note "set down where the
// berth stood (POS-740 hand repair)".
//
//   --at       the mark to set them down on (default the-town/the-quay, the
//              quay stone every keyless berth speaks from). Not read from the
//              manifest: after a co-sign HARBOR/berths/<h>.md exists for every
//              resident, so it no longer says where they stood.
//   --apply    write it. Without it, a DRY RUN: it says what it would write and
//              whether the guard passes, and writes nothing.
//
// THE GUARD: it refuses by name when the handle has ANY departure on record (a
// walk, a ground's landing, an earlier set-down), so it can never undo a real
// move, and a second --apply is a no-op that says so.
//
// Needs the store: WORLD2_PG=1 and WORLD2_PG_URL in this process's environment
// (on the box: the office's own env file, run as meepo).
//
// EXIT: 0 written, or a dry run whose guard passes · 1 refused (already placed,
//       no such mark, not written) · 2 cannot run (usage)

import { realpathSync } from "node:fs";

export const HAND_REPAIR_NOTE = "set down where the berth stood (POS-740 hand repair)";
export const DEFAULT_MARK = "the-town/the-quay";

const isMain = process.argv[1] && realpathSync(process.argv[1]).replace(/\\/g, "/").endsWith("/set-down-ashore.mjs");

if (isMain) {
  const argv = process.argv.slice(2);
  const arg = (name) => { const i = argv.indexOf(`--${name}`); return i === -1 ? null : argv[i + 1] ?? null; };
  const handle = arg("handle");
  const json = argv.includes("--json");
  const say = (o, text) => console.log(json ? JSON.stringify(o) : text);
  if (!handle || handle.startsWith("--")) {
    console.error("usage: node tools/set-down-ashore.mjs --handle <h> [--at <mark id>] [--household <slug>] [--apply] [--json]");
    process.exit(2);
  }
  const markId = arg("at") ?? DEFAULT_MARK;
  const { markPlace } = await import("../src/world.mjs");
  const place = await markPlace(markId).catch(() => null);
  if (!place) {
    say({ written: false, why: `no mark ${markId} with a place in the world` }, `REFUSED: no mark ${markId} with a place in the world; nothing written`);
    process.exit(1);
  }
  const { setDownWhereItStood } = await import("../src/set-down.mjs");
  const apply = argv.includes("--apply");
  const r = await setDownWhereItStood({ handle, household: arg("household"), place, note: HAND_REPAIR_NOTE, dry: !apply });
  if (r.would) {
    say({ dry: true, ...r }, `DRY RUN: would set ${handle} down at ${markId} (${place.x}, ${place.y}), crossing ${r.would.crossing}, declared by ${r.would.declared_by}. The guard passes: no departure on record. Nothing written; --apply writes it.`);
    process.exit(0);
  }
  if (r.written) {
    say(r, `set ${handle} down at ${markId} (${place.x}, ${place.y}): act ${r.actId ?? "(no id)"}`);
    process.exit(0);
  }
  say(r, `REFUSED: ${r.why}; nothing written`);
  process.exit(1);
}
