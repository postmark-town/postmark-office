// set-down-strands.mjs — A SET-DOWN THAT COULD NOT BE UNDONE, SAID WHERE AN
// OPERATOR LOOKS (POS-766/e; #760 review, item 2).
//
// A thing made in hand is set down in two writes on two pens: its draft (filed
// by leave-mark), then the hold lane's `set-down` act (world-hold.mjs §
// setDownMade). When the second write fails, the first is withdrawn again, so
// the thing is never both in hand and on the ground. When the withdrawal ALSO
// fails, the thing is stranded in both places, and nothing a resident does
// undoes it. That must never pass as a log line nobody reads.
//
// So a strand is said twice:
//   · one `[office] ESCALATION` line in the office's journal, with the thing,
//     its maker, who set it down and both failures, the tag an operator greps;
//   · `telemetry/set-down-strands.json`, rewritten whole (temp + rename), the
//     newest 50 strands, newest first, with `last_strand_at`; GET
//     /ops/set-down-strands answers it, as /ops/loop-lag answers loop-lag's.
// The fix for a strand is by hand: withdraw the draft (world_withdraw_mark as
// its maker), or write the set-down act, whichever the record shows missing.
//
// Only the writer process holds the hold lane (the read workers refuse a
// hold), so one file, unnamed by port. A file that cannot be written is said
// in the journal line too, and never throws into the door.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const KEEP = 50;
export const STRANDS_FILE = join(dirname(fileURLToPath(import.meta.url)), "..", "telemetry", "set-down-strands.json");

/** The file as it stands: `{ strands, last_strand_at }`, empty when there is none or it cannot be read. */
export function readStrands({ file = STRANDS_FILE } = {}) {
  try {
    const doc = JSON.parse(readFileSync(file, "utf8"));
    return { strands: Array.isArray(doc?.strands) ? doc.strands : [], last_strand_at: doc?.last_strand_at ?? null };
  } catch { return { strands: [], last_strand_at: null }; }
}

/**
 * Say one strand: the journal line and the file. `why` and `undo` are the two
 * failures in the office's own words (fault-words § plainReason); the raw
 * errors went to the log where they happened. Returns the entry written.
 */
export function recordStrand({ thing, maker, actor, why, undo }, { file = STRANDS_FILE, now = new Date(), log = console.error } = {}) {
  const entry = { at: now.toISOString(), thing: String(thing), maker: String(maker), set_down_by: String(actor),
    set_down_failed: String(why), withdraw_failed: String(undo),
    fix: `by hand: withdraw the draft ${thing} as ${maker}, or write its set-down act, whichever the record shows missing` };
  let written = true;
  try {
    const { strands } = readStrands({ file });
    mkdirSync(dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify({ last_strand_at: entry.at, strands: [entry, ...strands].slice(0, KEEP) }, null, 1) + "\n");
    renameSync(tmp, file);
  } catch { written = false; }
  log(`[office] ESCALATION set-down stranded: ${entry.thing} (made by ${entry.maker}, set down by ${entry.set_down_by}) is both in hand and a draft: the set-down act failed (${entry.set_down_failed}) and its draft could not be withdrawn (${entry.withdraw_failed}). ${entry.fix}. ${written ? `Recorded in ${file}` : "The strands file could not be written either"}.`);
  return entry;
}
