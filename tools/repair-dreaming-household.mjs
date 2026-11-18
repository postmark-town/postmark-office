// repair-dreaming-household.mjs — POS-1055: Fen joins The Dreaming; the house reads "not given"; nothing else.
//
// Darko, 2026-11-15 15:28 EST: "Re-key, after they say". They said (both letters are in the town's
// WHITE_PAGES/wright/inbox/): Fen, 11-16 — "Move me into the-dreaming at the next settlement"; Q, 11-17 —
// "The move: welcome it", "The likeness: not given". Wright, 2026-11-18: Fen's history, letters and stamps stay
// Fen's, only the household key moves; the emptied house is retired the way the registry retires one; no deletion
// of record; one daily mint cap thereafter.
//
// This is NOT a general move. It is tools/move-resident.mjs (the existing road: the owner's one store
// transaction, the registry drain, the card line and the signed key line in one pen commit, resumable, planHouseKey
// first) with three things pinned, and one thing added:
//
//   · the resident is `the-fen`, the house they leave is `the-dreaming-fenofthedreaming`, the house they join is
//     `the-dreaming`. Any other house they live in refuses (WRONG_HOUSE) and writes nothing.
//   · THE ANSWER. A plain move would leave the joined house's own answer standing, and Q's was "given": Fen would be
//     read as "given" for as long as it took to set it down. So the same owner transaction that moves the resident
//     writes the house's answer: the recorded NO of the house Fen leaves (their no of 26 Oct, by their own account) is
//     carried onto the joined row. It is one row write with the move, so there is no moment the combined house reads
//     "given", and no credential is made for anyone. A leaving house that has not recorded a no refuses (NO_SOURCE_NO).
//   · likeness STATE (a request, a selection, an official pointer) on either house still refuses by name: it is neither
//     moved nor discarded, and no policy for it is ruled. An invitation credit on the leaving house still refuses.
//
//   node tools/repair-dreaming-household.mjs [--dry-run]
//
// Run it where move-resident runs (the box, under the town lock, the office's env and the owner's PG* env), at the
// settlement boundary, only by the authorized operator. A dry run writes nothing and never connects as the owner.
// Rerunning after a push that could not land resumes the publication, as move-resident does. After it lands, the
// operator reads back what the town says (see the operator plan in the PR).

import { realpathSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { moveResident, main as moveMain } from "./move-resident.mjs";

export const DREAMING = Object.freeze({
  handle: "the-fen",
  from: "the-dreaming-fenofthedreaming",
  to: "the-dreaming",
});

/** move-resident, pinned to the one correction, settling the house's answer with the move. */
export const repairDreaming = (args) =>
  moveResident({ ...args, handle: DREAMING.handle, to: DREAMING.to, onlyFrom: DREAMING.from, settleLikeness: true });

export async function main(argv = process.argv.slice(2), opts = {}) {
  const extra = argv.filter((a) => a !== "--dry-run");
  if (extra.length) { (opts.err ?? console.error)("repair-dreaming-household: no arguments but --dry-run — this corrects one household and names it itself"); return 2; }
  return moveMain(["--handle", DREAMING.handle, "--to", DREAMING.to, ...argv], { ...opts, act: repairDreaming });
}

const isMain = (() => {
  if (!process.argv[1]) return false;
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return pathToFileURL(process.argv[1]).href === import.meta.url; }
})();
if (isMain) process.exit(await main());
