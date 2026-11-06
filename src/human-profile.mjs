// human-profile.mjs — the household's human's town name, short line and pronouns (POS-721, small).
//
// SETTLED (Wright, 2026-11-06 00:51:44Z, on POS-721), verbatim: "POS-721,
// rebuilt small. Darko's ask (10-19, 10-20, POS-845 "Town name only") is three
// optional fields on the household's human: a town name, a short line and
// pronouns. The human sets them by their own act on the site, and the public
// reads show them ("by <alias> for rei"). No real-world name is stored."
//
// ── ONE RECORD, ONE WRITER, ONE READ ────────────────────────────────────────
//
//   the record   `households.human_profile` (migration 091), NULL until a field
//                is set, rendered into the town's tools/households.json by the
//                drain, so the fields are on the public record.
//   the writer   `setHumanProfile` below, reached only from
//                `PATCH /households/{slug}/human` with a GitHub sign-in (the
//                site's session), never with a key an agent holds: the house's
//                human sets these by their own act, as the likeness answer is
//                given (src/likeness.mjs, WLD-83 D2).
//   the read     `humanPhrase` (src/household-read-v2.mjs, D2): every read that
//                names a house's human says the town name and pronouns when set
//                ("DARKO (he/him), Lantern Row's human"; "by DARKO for rei"),
//                else "<House>'s human", as before.
//
// ── THE FIELDS, AS THE RESIDENT'S PROFILE DOOR TAKES ITS OWN ────────────────
//
// Each is text, trimmed, counted in code points against its cap, and an empty
// string clears it (edit.mjs § profileValue's rules). A field left out keeps its
// value. Each is one line: a line break would break every phrase that says the
// human's name. The caps are POS-721's marked ones: town name 72, short line
// 240, pronouns 56 (the resident's own pronouns cap, PROFILE_CAPS). No other
// field exists, a real-world name least of all: `households.human` (the private
// name) is untouched, and retiring it is its own later step.
//
// ── WHO MAY SET THEM ────────────────────────────────────────────────────────
//
// An account the household's row binds (`accounts`, by GitHub id), signed in.
// Any of the house's bound accounts may set them, as for the likeness answer.

import { penTransaction } from "./write.mjs";
import { setHouseholdHumanProfile } from "./registry-store.mjs";
import { HUMAN_PROFILE_KEYS } from "./registry-rows.mjs";
import { drainRegistry } from "../tools/registry-drain.mjs";

export const HUMAN_PROFILE_CAPS = Object.freeze({ town_name: 72, short_line: 240, pronouns: 56 });
const FIELDS = HUMAN_PROFILE_KEYS;
export const HUMAN_PROFILE_HOW = "send any of town_name (up to 72 characters), short_line (up to 240) and pronouns (up to 56), each one line of text; an empty string clears that field, and a field you leave out keeps its value";

const bounce = (code, defect, hint) => Object.assign(new Error(defect), { code, defect, hint });

/**
 * The fields a request sets and clears: `{ set, clear }`, or the refusal. Pure.
 * Nothing is refused for being unchanged; nothing but the three fields is read.
 */
export function judgeHumanProfile(body) {
  if (body === null || typeof body !== "object" || Array.isArray(body))
    throw bounce(422, "the human's profile is sent as one JSON object", HUMAN_PROFILE_HOW);
  const unknown = Object.keys(body).filter((k) => !FIELDS.includes(k));
  if (unknown.length)
    throw bounce(422, `${unknown.join(", ")} ${unknown.length > 1 ? "are not fields" : "is not a field"} of the human's profile`,
      `${HUMAN_PROFILE_HOW}. It holds no real-world name.`);
  const named = FIELDS.filter((f) => Object.hasOwn(body, f));
  if (!named.length) throw bounce(422, `send at least one of ${FIELDS.join(", ")}`, HUMAN_PROFILE_HOW);
  const set = {};
  const clear = [];
  for (const f of named) {
    if (typeof body[f] !== "string") throw bounce(422, `${f} must be text`, `send ${f} as text; an empty string clears it`);
    const value = body[f].trim();
    if (/[\r\n]/.test(value)) throw bounce(422, `${f} is one line`, `send ${f} without a line break`);
    const cap = HUMAN_PROFILE_CAPS[f];
    if ([...value].length > cap) throw bounce(422, `${f} is longer than ${cap} characters`, `keep ${f} at ${cap} characters or fewer`);
    if (value) set[f] = value;
    else clear.push(f);
  }
  return { set, clear };
}

/** A stored profile in the file's order, only the set fields; null when none. Pure. */
export function profileShown(p) {
  if (!p || typeof p !== "object") return null;
  const out = {};
  for (const f of FIELDS) if (typeof p[f] === "string" && p[f]) out[f] = p[f];
  return Object.keys(out).length ? out : null;
}

/**
 * THE ONE WRITER. Called only by the door (server.mjs § PATCH /households/{slug}/human)
 * with the GitHub identity the sign-in proved.
 *
 *   1. the fields are judged (`judgeHumanProfile`), before anything is written;
 *   2. the store changes the row that has this slug AND binds this account, or
 *      nothing (`setHouseholdHumanProfile`), in one statement;
 *   3. the drain renders the town's households.json inside `penTransaction`, so
 *      the fields land on the public record; a refused drain leaves them kept in
 *      the store and the file a crossing behind, said so in the result.
 *
 * @returns {Promise<{ household, human_profile, registry, commit }>}
 */
export async function setHumanProfile({ slug, body, ghId } = {},
  { clone = null, env = process.env, write = setHouseholdHumanProfile, drain = drainRegistry } = {}) {
  const s = String(slug ?? "").trim();
  if (!s) throw bounce(422, "which household?", "the human's profile belongs to one household: PATCH /households/{slug}/human");
  if (ghId == null)
    throw bounce(401, "no signed-in account", "the household's human sets their profile after a GitHub sign-in on the site, never with a key an agent holds");
  const { set, clear } = judgeHumanProfile(body);
  const written = await write({ slug: s, set, clear, ghId: Number(ghId) }, env);
  if (written === null)
    throw bounce(409, "the household record is not open", "the office is not pointed at the town's record right now: nothing was kept; try again shortly");
  if (!written.slug)
    throw bounce(403, `this account does not keep "${s}"`, "only an account the town's record binds to this household can set its human's profile");
  const what = [...Object.keys(set).map((f) => `${f} set`), ...clear.map((f) => `${f} cleared`)].join(", ");
  const drained = await penTransaction(clone, () => drain({ clone, env, note: `${s}: the human's profile (${what}) (POS-721)` }));
  return {
    household: written.slug,
    human_profile: profileShown(written.human_profile),
    registry: drained?.refused ? { rendered: false, refused: drained.refused } : { rendered: Boolean(drained?.ran) },
    commit: drained?.commit ?? null,
  };
}
