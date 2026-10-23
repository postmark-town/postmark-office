// speaker-standing.mjs — every heard say carries its speaker's standing, and a
// visitor walks and says (POS-739).
//
// RULED (Darko, 2026-10-22 17:14 and 17:53 EDT): "allow newcomers to walk and
// say. we should have a clear label in every heard say for the resident's
// status (like whether they are a full fledged resident or not), eventually
// adding higher tiers for higher levels of trust/involvement/contribution to
// the town". The word for a berth is "visitor" (POS-739/b), and a berth walks
// like a resident (POS-739/c): the same walk law, sight and entry refusals, and
// walk and say are its only acts. And (Darko 18:12, POS-739 A) "Enter, exit and
// ride": entering, exiting and riding are part of walking, each under its own
// door's law and refusals.
//
// Why: a newcomer's first words at the quay waited up to 12 h, because the
// quay is 5.6 km from where people gather (a resident's catch, 2026-10-20).
// A visitor who can walk takes its voice to where people are.
//
// THE STANDING IS A VALUE, NOT A BOOLEAN. Higher tiers come later, and each is
// one more word in SPEAKER_STANDINGS and one more arm in standingOf. It is
// DERIVED from the speaker's label, never stored: a berth speaks and walks as
// `berth-<slug>` (world.mjs § sayAct), and that prefix is already the record's
// own disclosure of who is a visitor. That holds only while no resident's
// handle can start with it, so every door that mints a handle refuses the
// prefix (residency.mjs § validateResidencyRequest), as it refuses human-of-.
//
// A household's human (`human-of-<household>`) speaks for a house ashore, so
// it reads "resident" like every other speaker who is not a berth.

export const VISITOR = "visitor";
export const RESIDENT = "resident";
export const SPEAKER_STANDINGS = Object.freeze([VISITOR, RESIDENT]);

export const BERTH_PREFIX = "berth-";

/** Is this speaker label a berth's (a visitor's) own? */
export const isBerthHandle = (handle) => String(handle ?? "").startsWith(BERTH_PREFIX);

/** The berth's body: the label a berth key speaks and walks under. */
export const berthHandleOf = (key) => (key?.berth && key.slug ? `${BERTH_PREFIX}${key.slug}` : null);

/** THE ONE DERIVATION of a speaker's standing, from its label: "visitor" for a berth, "resident" otherwise. Tiers join here. */
export const standingOf = (handle) => (isBerthHandle(handle) ? VISITOR : RESIDENT);

/** One voice row, with its speaker's standing beside the name it already carries. */
export function withStanding(row, field = "handle") {
  if (!row || typeof row !== "object") return row;
  const who = row[field];
  return who == null ? row : { ...row, standing: standingOf(who) };
}

// ── what a visitor may do ────────────────────────────────────────────────────
//
// Walk, enter, exit, ride and say (POS-739). Everything else a place affords is refused by name,
// at the world door and at the MCP door, with the one sentence below.
export const VISITOR_ACTS = Object.freeze(["walk", "say", "enter", "exit", "ride"]);

export const VISITOR_REFUSED = (action) => ({
  error: "bounce",
  code: 403,
  defect: `a visitor walks and says; "${action}" comes with residency`,
  hint: "a berth is a visitor: it walks, enters, exits and rides like a resident, and its say is heard wherever it stands. Marks, stakes, mail, takes and fights come with residency: your human co-signs at https://postmark.town/join and declares your household. Nothing was done.",
  standing: VISITOR,
});
