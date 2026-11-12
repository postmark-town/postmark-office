// household-hearth.mjs — the Hearth a household CHOSE, kept by the office (POS-962).
//
// RULED (Darko 2026-10-22 23:04 EDT, POS-684/c): "An office setting" — set by a site act, read on every load, changeable any time. And, at the
// 2026-11-09 sitting, the household's design draws the house for everyone at /households/<slug>/; the signed-in human picks it in the site's band.
//
// WHAT IS HERE: the one writer (chooseHearth) and the one reader of the saved answer (hearthOf), nothing else.
//
//   THE SETTING   `households.hearth` (migration 093): the id of a REGISTERED entry, or NULL (chosen nothing: every reader gets the default).
//                 It is public: the drain prints it as `hearth` in the town's households.json and GET /households carries it, which is how the
//                 site reads the saved choice signed out (registry-public.mjs; the key is NAMED there, not inferred).
//   THE WRITE     PATCH /households/<slug>/hearth { "hearth": "<id>" | null }, from a GitHub-signed-in credential that the household's own record
//                 BINDS (accountBinds, the same test as the likeness answer's page, 081). The store statement repeats the binding. This is NOT a new
//                 grant, a new consent or a new ownership rule: no resident key, no Iris delegation and no preview reaches it, and the household
//                 acts on its own row only. A preview is the site's page state and makes no request at all.
//   REGISTERED    an id is accepted only if it is an entry on the town repo's PROJECTS/household-hearths/ (a folder with a regular hearth.html,
//                 registered by merge), read from the town clone at the write. An id that is not registered is refused by name, and an
//                 unreadable clone refuses 503 rather than guessing: "validate against registered entries" is the server's, not the picker's.
//   UNSET         `hearth: null` (or the default's own id) is "back to the default": it clears the column, so unset and default read the same.
//
// The setting never carries markup, a URL or a template: an id. The site resolves it against the entries it built (src/lib/hearth/choice.mjs).

import { lstatSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { penTransaction } from "./write.mjs";
import { loadRegistryRows, setHouseholdHearth } from "./registry-store.mjs";
import { registryFromRows } from "./registry-rows.mjs";
import { accountBinds } from "./likeness.mjs";
import { drainRegistry } from "../tools/registry-drain.mjs";

/** An entry id's own spelling: the folder name (the site's ENTRY_ID, the column's CHECK). */
export const HEARTH_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
/** The entry every unchosen house draws. Choosing it is the same as choosing nothing. */
export const DEFAULT_HEARTH = "default";
const ENTRIES_DIR = ["PROJECTS", "household-hearths"];

const bounce = (code, defect, hint) => Object.assign(new Error(defect), { code, defect, hint });

/**
 * The ids registered on the town clone: each lowercase folder of PROJECTS/household-hearths holding a REGULAR hearth.html (a link is no entry).
 * Capital-named folders (STARTER) are infrastructure. Throws when the folder cannot be read.
 */
export function registeredHearths(clone) {
  const dir = join(clone, ...ENTRIES_DIR);
  const out = new Set();
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory() || e.isSymbolicLink() || !HEARTH_ID.test(e.name)) continue;
    try {
      const file = join(dir, e.name, "hearth.html");
      if (lstatSync(file).isFile() && statSync(file).isFile()) out.add(e.name);
    } catch { /* no hearth.html: not an entry */ }
  }
  return out;
}

/** The household's saved choice as the record holds it: an id, or null (nothing chosen, or a spelling that is no id). */
export const hearthOf = (rec) => (typeof rec?.hearth === "string" && HEARTH_ID.test(rec.hearth) ? rec.hearth : null);

/**
 * THE WRITE. `hearth` is a registered entry's id, or null to go back to the default. The account must be the GitHub-signed-in one the household's
 * record binds. Answers `{ household, hearth, registry, commit }`; `hearth` is what is now saved (null: the default).
 */
export async function chooseHearth({ slug, hearth, ghId, ghLogin } = {},
  { clone = null, env = process.env, registered = registeredHearths, write = setHouseholdHearth, drain = drainRegistry } = {}) {
  const s = String(slug ?? "").trim();
  if (!s) throw bounce(422, "which household?", "a Hearth is chosen for one household: PATCH /households/<slug>/hearth");
  if (ghId == null) throw bounce(403, "a Hearth is chosen by the household's human", "this credential carries no verified GitHub account; sign in on the site and choose there");
  if (hearth !== null && typeof hearth !== "string") throw bounce(422, "hearth is an entry id, or null for the default", '{"hearth": "<id>"} — the id of a registered Hearth, or {"hearth": null} to go back to the default');

  const rows = await loadRegistryRows(env);
  if (rows === null) throw bounce(409, "the household record is not open", "the office is not pointed at the town's record right now: nothing was kept; try again shortly");
  const rec = registryFromRows(rows).households?.[s];
  if (!rec) throw bounce(404, `no household "${s}"`, "a Hearth is chosen for a household the town keeps");
  if (!accountBinds(rec, ghId)) throw bounce(403, `this account does not keep "${s}"`, "only an account the town's record binds to this household can choose its Hearth");

  const id = hearth === null || hearth === "" || hearth === DEFAULT_HEARTH ? null : hearth;
  if (id !== null) {
    if (!HEARTH_ID.test(id)) throw bounce(422, "that is not an entry id", "an entry id is lowercase letters, digits and hyphens, at most 40: the name of its folder in PROJECTS/household-hearths");
    let known;
    try { known = registered(clone); } catch { throw bounce(503, "the town's Hearth entries cannot be read right now", "nothing was kept; try again shortly"); }
    if (!known.has(id)) throw bounce(422, `"${id}" is not a registered Hearth`, `choose one of: ${[...known].sort().join(", ") || "(none)"}`);
  }

  const written = await write({ slug: s, hearth: id, ghId: Number(ghId) }, env);
  if (written === null) throw bounce(409, "the household record is not open", "the office is not pointed at the town's record right now: nothing was kept; try again shortly");
  if (written.missingColumn) throw bounce(503, "the household Hearth setting is not on this store yet", "the migration world2/schema/093_household_hearth.sql has not been applied here: nothing was kept");
  if (!written.slug) throw bounce(403, `this account does not keep "${s}"`, "the household's record no longer binds this account: nothing was kept");

  const drained = await penTransaction(clone, () => drain({ clone, env, note: `${s}: the household's Hearth ${id === null ? "set back to the default" : `chosen: ${id}`} (POS-962)` }));
  return { household: s, hearth: id, registry: drained?.refused ? { rendered: false, refused: drained.refused } : { rendered: Boolean(drained?.ran) }, commit: drained?.commit ?? null };
}
