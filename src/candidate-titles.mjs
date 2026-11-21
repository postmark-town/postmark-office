// candidate-titles.mjs — a ballot candidate's Hearth design title, for the votes reads (POS-1140; CORE-126's API half).
//
// Darko, 2026-11-18 16:57 EST: "the ballot box shows household names instead of theme/design names for each entry, it should show the theme
// name and by {household}". The hearth-default ballot's candidates are design folders (`the-window-household`, `kilmartin`), and each design names
// itself in PROJECTS/household-hearths/<candidate>/hearth.md frontmatter (`title: The Working Window`). The votes reads (GET /votes, GET
// /votes/{topic}, town { read: "votes" }) add that title to each candidate as `title`.
//
// ONE PROJECTION, TWO READERS. `candidateTitle` is the only place the title is read, and votes.mjs § voteList and § voteView both ask it, so REST and
// MCP, the list and one topic, cannot answer differently. It reads the SUPPLIED town clone only (the pinned town the reads already stand on), never the
// site's output, a live fetch or another ref, and never the ballot's own display words.
//
// OPTIONAL AND ADDITIVE. A candidate with no hearth.md (the Illuminator names, a bare-name ballot's names, an id that is no folder name) carries NO
// `title` key: not null, not the candidate's name, not a guess. A file that is a link, unreadable, oversized, fenceless or titleless answers the same.
// PUBLIC DESIGN METADATA ONLY: the title line of a merged public file. The author line is not read (the ballot's `credit` stays the one source for who).
// A candidate's id is its stake's identity and is never touched.
//
// Sync reads of a small file or two per candidate; no cache, no new dependency, no pin refresh.

import { lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { frontmatterScalar } from "./profiles.mjs";

/** A Hearth entry's folder name: lowercase letters, digits, hyphens, at most 40 (household-hearth.mjs § HEARTH_ID, held equal by test). Anything else is no folder. */
export const ENTRY_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
/** Where the designs live in the town repo. */
export const HEARTH_DIR = ["PROJECTS", "household-hearths"];
/** A design's frontmatter is a few lines; a larger file is not one this reads. */
export const MAX_HEARTH_MD_BYTES = 64 * 1024;

/** The design title of one candidate at this town clone, or null (no entry, or nothing readable to say). Never throws. */
export function candidateTitle(clone, candidate) {
  if (typeof clone !== "string" || !clone || typeof candidate !== "string" || !ENTRY_ID.test(candidate)) return null;
  try {
    const file = join(clone, ...HEARTH_DIR, candidate, "hearth.md");
    const st = lstatSync(file); // lstat: a link is no entry (as registeredHearths reads hearth.html)
    if (!st.isFile() || st.size > MAX_HEARTH_MD_BYTES) return null;
    return frontmatterScalar(readFileSync(file, "utf8"), "title");
  } catch { return null; }
}

/** The key a candidate row gains: `{ title }` when the design has one, else nothing at all. */
export const titleOf = (clone, candidate) => {
  const title = candidateTitle(clone, candidate);
  return title === null ? {} : { title };
};
