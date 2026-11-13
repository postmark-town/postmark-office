// household-settings.mjs — the household's ONE settings door (WLD-28).
//
// RULED (Darko, 2026-09-13 21:2x EDT: "one household settings system … unified from birth"; 2026-11-13 09:12 EST: "Build it with the second setting"; Wright's go,
// 2026-11-13 14:16Z): `GET` and `PATCH /households/<slug>/settings` for the household's signed-in human, covering `likeness` and `hearth`, and an MCP READ of the
// same settings (`household { read: "settings" }`). There is NO MCP write (residents writing settings is POS-1023). The existing columns stay behind the door
// (likeness: 081, live; hearth: 093); no data moves, so the consent record (`households.likeness`: answer, at, by, gh_id, words) stays exactly where it is.
//
// WHAT THIS IS: one door over the two existing writers, and nothing new under it.
//   · the likeness answer is `likeness.mjs § setLikeness` (consent recorded as before: who, when, which words), the Hearth choice is
//     `household-hearth.mjs § chooseHearth` (registered entries only; null / the default's own id clear the column), and each keeps its own store statement, which
//     repeats the household's binding. This file judges, orders and combines them; it writes nothing itself.
//   · the old doors are ALIASES of this one: `PATCH /households/<slug>/hearth` and the likeness form's answer call `changeSettings` with the one setting they
//     always carried and answer in the shape they always answered (`parts.hearth`, `parts.likeness`), so a caller of either sees no change.
//   · authority is unchanged: the credential must carry a GitHub account the household's own record BINDS and must not be an agent's own key (named-hand.mjs
//     § agentHeld, drawn at the route, as the Hearth's door always drew it). The likeness form's caller is the signed-in browser session, as before. No resident
//     key, Iris delegation or preview reaches a write.
//
// A COMBINED REQUEST IS ALL-OR-NOTHING AT THE JUDGMENT: every submitted setting is judged (its shape, the household, the binding, and for the Hearth the
// registered entries) BEFORE the first write, so an invalid combination keeps no part of itself. Only a submitted setting changes: an omitted one is left exactly
// as it was (an omitted `hearth` is not `hearth: null`, which means "back to the default"). The two writes are separate store statements, so the one that can
// fail for the store's own reasons (the Hearth, whose migration may not be on a store yet) is written FIRST; if it refuses, nothing was kept.

import { loadRegistryRows } from "./registry-store.mjs";
import { registryFromRows } from "./registry-rows.mjs";
import { accountBinds, likenessOfHouse, judgeLikeness, setLikeness } from "./likeness.mjs";
import { chooseHearth, judgeHearth, hearthOf, DEFAULT_HEARTH } from "./household-hearth.mjs";

/** The settings this door holds, in the order they are read and written. */
export const SETTINGS = Object.freeze(["likeness", "hearth"]);

const bounce = (code, defect, hint) => Object.assign(new Error(defect), { code, defect, hint });

/**
 * The household's settings as the record holds them, together. Pure.
 *   likeness  `answer` is "yes" | "no" | null (null: never answered), `effective` is what the town acts on ("given" | "not given": unanswered reads as not given)
 *   hearth    `choice` is the saved entry id or null (nothing chosen), `effective` is the entry the household's house is drawn with ("default" when nothing is chosen)
 * Settings only: no consent audit (who answered, when, with which words) and no human's identity ride this value.
 */
export function settingsOf(slug, rec) {
  const answer = rec?.likeness?.answer;
  const choice = hearthOf(rec);
  return {
    household: slug,
    likeness: { answer: answer === "yes" || answer === "no" ? answer : null, effective: likenessOfHouse(rec) },
    hearth: { choice, effective: choice ?? DEFAULT_HEARTH },
  };
}

/**
 * THE READ: one household's settings, from the record. Throws the named refusal when the record is not open or the household is not kept.
 * Who may ask is the caller's to decide (the route asks the human's binding; the MCP read answers the caller's own household).
 */
export async function readSettings({ slug } = {}, { env = process.env, loadRows = loadRegistryRows } = {}) {
  const s = String(slug ?? "").trim();
  if (!s) throw bounce(422, "which household?", "settings belong to one household: GET /households/<slug>/settings");
  const rows = await loadRows(env);
  if (rows === null) throw bounce(409, "the household record is not open", "the office is not pointed at the town's record right now; try again shortly");
  const rec = registryFromRows(rows).households?.[s];
  if (!rec) throw bounce(404, `no household "${s}"`, "settings are kept for a household the town keeps");
  return settingsOf(s, rec);
}

// The words an ALIAS door keeps for the refusals this file raises before a writer is reached, so that the old routes answer exactly as they always did.
const ALIAS_WORDS = Object.freeze({
  hearth: {
    noAccount: () => bounce(403, "a Hearth is chosen by the household's human", "this credential carries no verified GitHub account; sign in on the site and choose there"),
    noHousehold: (s) => bounce(404, `no household "${s}"`, "a Hearth is chosen for a household the town keeps"),
    notBound: (s) => bounce(403, `this account does not keep "${s}"`, "only an account the town's record binds to this household can choose its Hearth"),
  },
  likeness: {
    noAccount: () => bounce(401, "no signed-in account", "the likeness question is answered after a GitHub sign-in, never with a key"),
    noHousehold: (s) => bounce(403, `this account does not keep "${s}"`, "only an account the town's record binds to this household can answer for it"),
    notBound: (s) => bounce(403, `this account does not keep "${s}"`, "only an account the town's record binds to this household can answer for it"),
  },
});

/**
 * THE WRITE. `changes` is `{ likeness?: "yes" | "no", hearth?: "<registered id>" | null }`: only what is present changes. Judged whole, then written Hearth-first.
 * Answers `{ household, settings, changed, registry, commit, parts }`; `settings` is the household's settings as they now stand, `parts` is each writer's own answer
 * (the alias doors answer in those shapes). `alias` ("hearth" | "likeness") keeps that old door's own words for the refusals raised before its writer is reached.
 */
export async function changeSettings({ slug, changes, ghId, ghLogin } = {},
  { clone = null, env = process.env, loadRows = loadRegistryRows, registered, writeHearth, writeLikeness, drain, now, alias = null } = {}) {
  const words = ALIAS_WORDS[alias] ?? null;
  const s = String(slug ?? "").trim();
  if (!s) throw bounce(422, "which household?", "settings are changed for one household: PATCH /households/<slug>/settings");
  if (ghId == null) throw words?.noAccount() ?? bounce(403, "settings are changed by the household's human", "this credential carries no verified GitHub account; sign in on the site and change them there");
  if (changes === null || typeof changes !== "object" || Array.isArray(changes))
    throw bounce(422, "say what to change", '{"likeness": "yes" | "no", "hearth": "<registered entry id>" | null} — only what you send changes');
  const named = Object.keys(changes);
  const unknown = named.filter((k) => !SETTINGS.includes(k));
  if (unknown.length) throw bounce(422, `no setting called ${unknown.map((k) => `"${k}"`).join(", ")}`, `the settings are: ${SETTINGS.join(", ")}`);
  const submitted = SETTINGS.filter((k) => Object.hasOwn(changes, k));
  if (!submitted.length) throw bounce(422, "say what to change", '{"likeness": "yes" | "no", "hearth": "<registered entry id>" | null} — only what you send changes');

  // 1. the shapes, before the record is read (as each writer always judged them first)
  if (submitted.includes("likeness")) judgeLikeness(changes.likeness);
  if (submitted.includes("hearth") && changes.hearth !== null && typeof changes.hearth !== "string") judgeHearth(changes.hearth);

  // 2. the household and the binding, from the record
  const rows = await loadRows(env);
  if (rows === null) throw bounce(409, "the household record is not open", "the office is not pointed at the town's record right now: nothing was kept; try again shortly");
  const rec = registryFromRows(rows).households?.[s];
  if (!rec) throw words?.noHousehold(s) ?? bounce(404, `no household "${s}"`, "settings are changed for a household the town keeps");
  if (!accountBinds(rec, ghId)) throw words?.notBound(s) ?? bounce(403, `this account does not keep "${s}"`, "only an account the town's record binds to this household can change its settings");

  // 3. every submitted value judged in full BEFORE the first write (the Hearth's must be a registered entry)
  if (submitted.includes("hearth")) judgeHearth(changes.hearth, { clone, ...(registered ? { registered } : {}) });

  // 4. the writes, each the existing writer: the Hearth first (it can refuse for the store's own reasons), then the likeness answer
  const parts = {};
  if (submitted.includes("hearth"))
    parts.hearth = await chooseHearth({ slug: s, hearth: changes.hearth, ghId, ghLogin },
      { clone, env, ...(registered ? { registered } : {}), ...(writeHearth ? { write: writeHearth } : {}), ...(drain ? { drain } : {}) });
  if (submitted.includes("likeness"))
    parts.likeness = await setLikeness({ slug: s, answer: changes.likeness, ghId, ghLogin },
      { clone, env, ...(writeLikeness ? { write: writeLikeness } : {}), ...(drain ? { drain } : {}), ...(now ? { now } : {}) });

  const after = { ...rec };
  if (parts.hearth) after.hearth = parts.hearth.hearth;
  if (parts.likeness) after.likeness = { answer: parts.likeness.likeness.answer };
  const written = Object.values(parts);
  const refused = written.map((p) => p.registry?.refused).find(Boolean);
  return {
    household: s,
    settings: settingsOf(s, after),
    changed: submitted,
    registry: refused ? { rendered: false, refused } : { rendered: written.every((p) => p.registry?.rendered) },
    commit: written.map((p) => p.commit).filter(Boolean).at(-1) ?? null,
    parts,
  };
}
