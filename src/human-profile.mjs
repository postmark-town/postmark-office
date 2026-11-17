// human-profile.mjs — the household's human's town name, short line and pronouns (POS-721, small).
//
// SETTLED (Wright, 2026-11-06 00:51:44Z, on POS-721), verbatim: "POS-721,
// rebuilt small. Darko's ask (10-19, 10-20, POS-845 "Town name only") is three
// optional fields on the household's human: a town name, a short line and
// pronouns. The human sets them by their own act on the site, and the public
// reads show them ("by <alias> for rei"). No real-world name is stored."
// RULED (Darko, 2026-10-20 08:44 EDT, on POS-721): the mini profile carries
// pronouns too: "DARKO (he/him), Starforge's human".
//
// ── ONE RECORD, ONE WRITER, ONE READ ────────────────────────────────────────
//
//   the record   `households.human_profile` (migration 098), NULL until a field
//                is set. PUBLIC by design: the drain prints it into the town's
//                tools/households.json and GET /households carries it, because
//                src/registry-public.mjs NAMES it (POS-845's named public list).
//   the writer   `setHumanProfile` below, reached ONLY from the office's own
//                signed-in form (`GET /oauth/human?household=<slug>`, GitHub,
//                the form, `POST /oauth/consent`; src/oauth.mjs), the likeness
//                answer's road. RULED (Darko, 2026-11-17 00:31Z, POS-721/c,
//                "Human only, like likeness"): no bearer sets it, neither a
//                household key nor an OAuth/MCP access token, because a key
//                cannot tell its human from an agent holding it and a browser
//                sign-in can. The writer refuses any caller that does not say
//                `browserSignIn`, and `PATCH /households/{slug}/human` refuses
//                every key and points at the form.
//   the read     `humanPhrase` (src/household-read-v2.mjs, D2): every read that
//                names a house's human says the town name and pronouns when set
//                beside the house ("DARKO (he/him), Lantern Row's human";
//                "by DARKO (Lantern Row) for rei": POS-721/b, Darko 2026-11-17
//                00:31Z, "DARKO (Starforge) is fine", so the house always tells
//                two DARKOs apart), else "<House>'s human", as before.
//
// ── THE FIELDS, AS THE RESIDENT'S PROFILE DOOR TAKES ITS OWN ────────────────
//
// Each is text, trimmed, counted in code points against its cap, and an empty
// string clears it (edit.mjs § profileValue's rules). A field left out keeps its
// value. Each is ONE LINE: no line break, line or paragraph separator, or other
// control character, since every phrase that says the human's name sits inside
// one line of a read. And no text-direction control (U+202A to U+202E, U+2066 to
// U+2069), refused by name: one at the end of a town name would turn the rest of
// "by … for rei" around wherever bidi is honoured. Other format characters pass
// (the zero-width joiner holds emoji together). The caps are POS-721's marked ones: town name 72, short
// line 240, pronouns 56 (the resident's own pronouns cap, edit.mjs PROFILE_CAPS).
// No other field exists, a real-world name least of all: `households.human` (the
// private name) is untouched, and retiring it is its own later step.
//
// ── WHO MAY SET THEM ────────────────────────────────────────────────────────
//
// An account the household's row binds (`accounts`, by GitHub id), signed in,
// judged against the record before the write and repeated in the statement that
// writes (the Hearth's test, household-hearth.mjs). Any of the house's bound
// accounts may set them.

import { penTransaction } from "./write.mjs";
import { loadRegistryRows, setHouseholdHumanProfile } from "./registry-store.mjs";
import { registryFromRows, HUMAN_PROFILE_KEYS } from "./registry-rows.mjs";
import { accountBinds } from "./likeness.mjs";
import { drainRegistry } from "../tools/registry-drain.mjs";

export const HUMAN_PROFILE_CAPS = Object.freeze({ town_name: 72, short_line: 240, pronouns: 56 });
const FIELDS = HUMAN_PROFILE_KEYS;
export const HUMAN_PROFILE_HOW = "send any of town_name (up to 72 characters), short_line (up to 240) and pronouns (up to 56), each one line of text; an empty string clears that field, and a field you leave out keeps its value";
// not one line: a control character (Cc: line breaks and tabs among them), or a line (Zl) or paragraph (Zp) separator
const NOT_ONE_LINE = /[\p{Cc}\p{Zl}\p{Zp}]/u;
// the text-direction controls, built from their code points so this source holds none of them raw
const ch = (n) => String.fromCharCode(n);
const TURNS_TEXT = new RegExp(`[${ch(0x202a)}-${ch(0x202e)}${ch(0x2066)}-${ch(0x2069)}]`, "u");
// A TOWN NAME HOLDS NO ROUND BRACKET (Wright's call on #929's review, 2026-11-17): the reads put the true house in
// brackets beside the name, "by DARKO (Starforge) for rei", so a name set to "DARKO (Starforge)" by another house's
// human would read "by DARKO (Starforge) (Lantern Row) for rei" and pass for the founder's house. So ( and ), and the
// characters that look like them (fullwidth, small, superscript, subscript, ornamental), are refused by name in a town
// name. The short line and pronouns are never put beside a house, so they keep them.
const ROUND_BRACKETS = [0x28, 0x29, 0xff08, 0xff09, 0xfe59, 0xfe5a, 0x207d, 0x207e, 0x208d, 0x208e, 0x2768, 0x2769, 0x276a, 0x276b];
const BRACKETED = new RegExp(`[${ROUND_BRACKETS.map((n) => `\\u{${n.toString(16)}}`).join("")}]`, "u");

const PUBLIC_BASE = (process.env.PUBLIC_BASE ?? "https://postmark.town/api").replace(/\/+$/, "");
/** The household's human's own form: a browser sign-in, the one road that sets the profile (POS-721/c). */
export const humanProfileLink = (slug) => `${PUBLIC_BASE}/oauth/human?household=${encodeURIComponent(slug)}`;

const bounce = (code, defect, hint) => Object.assign(new Error(defect), { code, defect, hint });

/** The refusal every bearer gets (POS-721/c): the profile is the human's own, set through a browser sign-in, never through a key. */
export const notByKey = (slug) => bounce(403, "the household's human sets their profile through a GitHub sign-in, never through a key",
  `open ${humanProfileLink(slug)} in a browser and set it there; a household key or an access token (an MCP connector's included) cannot set it. Nothing was kept`);

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
    if (NOT_ONE_LINE.test(value)) throw bounce(422, `${f} is one line`, `send ${f} as one line of text, without a line break, tab or other control character`);
    if (TURNS_TEXT.test(value)) throw bounce(422, `${f} carries a text-direction control`, `send ${f} without the invisible characters that turn text around (U+202A to U+202E, U+2066 to U+2069)`);
    if (f === "town_name" && BRACKETED.test(value))
      throw bounce(422, "town_name holds no brackets", "the town's reads put your house in brackets beside your town name, \"DARKO (Starforge)\", so a bracket in the name itself could pass for another house's: send it without ( or ) or anything that looks like them");
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
 * THE ONE WRITER. Called only by the office's signed-in form (oauth.mjs § the
 * human's own profile), with the GitHub identity that sign-in proved in a
 * browser and `browserSignIn: true`. Any other caller is refused 403 before
 * anything is read (POS-721/c, as changeSettings refuses a bearer's likeness).
 *
 *   1. the fields are judged (`judgeHumanProfile`), before the record is read;
 *   2. the household must be one the town keeps (404) and must bind this account
 *      (403), read from the record;
 *   3. the store changes the row that has this slug AND binds this account, or
 *      nothing (`setHouseholdHumanProfile`), in one statement; a store without
 *      migration 098 refuses 503 by name and keeps nothing;
 *   4. the drain renders the town's households.json inside `penTransaction`, so
 *      the fields land on the public record; a refused drain leaves them kept in
 *      the store and the file a crossing behind, said so in the result.
 *
 * @returns {Promise<{ household, human_profile, registry, commit }>}
 */
export async function setHumanProfile({ slug, body, ghId } = {},
  { clone = null, env = process.env, loadRows = loadRegistryRows, write = setHouseholdHumanProfile, drain = drainRegistry, browserSignIn = false } = {}) {
  const s = String(slug ?? "").trim();
  if (!s) throw bounce(422, "which household?", "the human's profile belongs to one household: open its form at /oauth/human?household=<slug>");
  if (browserSignIn !== true) throw notByKey(s);
  if (ghId == null)
    throw bounce(401, "no signed-in account", `the household's human sets their profile after a GitHub sign-in in a browser: ${humanProfileLink(s)}`);
  const { set, clear } = judgeHumanProfile(body);

  const rows = await loadRows(env);
  if (rows === null) throw bounce(409, "the household record is not open", "the office is not pointed at the town's record right now: nothing was kept; try again shortly");
  const rec = registryFromRows(rows).households?.[s];
  if (!rec) throw bounce(404, `no household "${s}"`, "the human's profile is kept for a household the town keeps");
  if (!accountBinds(rec, ghId)) throw bounce(403, `this account does not keep "${s}"`, "only an account the town's record binds to this household can set its human's profile");

  const written = await write({ slug: s, set, clear, ghId: Number(ghId) }, env);
  if (written === null)
    throw bounce(409, "the household record is not open", "the office is not pointed at the town's record right now: nothing was kept; try again shortly");
  if (written.missingColumn)
    throw bounce(503, "the human's profile is not on this store yet", "the migration world2/schema/098_household_human_profile.sql has not been applied here: nothing was kept");
  if (!written.slug)
    throw bounce(403, `this account does not keep "${s}"`, "the household's record no longer binds this account: nothing was kept");
  const what = [...Object.keys(set).map((f) => `${f} set`), ...clear.map((f) => `${f} cleared`)].join(", ");
  const drained = await penTransaction(clone, () => drain({ clone, env, note: `${s}: the human's profile (${what}) (POS-721)` }));
  return {
    household: written.slug,
    human_profile: profileShown(written.human_profile),
    registry: drained?.refused ? { rendered: false, refused: drained.refused } : { rendered: Boolean(drained?.ran) },
    commit: drained?.commit ?? null,
  };
}
