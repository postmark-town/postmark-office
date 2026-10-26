// depictions.mjs — the pictures made of a resident: the six-panel sheet, kept one row each (WLD-83).
//
// THE RULINGS (Darko, 2026-10-19, WLD-83):
//   18:24  reference anchors come from the household. Postmark hands it a
//          copy-and-paste prompt template (SHEET_TEMPLATE below) that its agent
//          fills in and an image model renders; the household submits the sheet
//          and it becomes canon, rather than the town making it.
//   18:26  the sheets already made are seeded as each resident's initial anchor
//          (tools/seed-sheets.mjs). Later, every depiction carries the
//          resident's stance, starting with the town's own media.
//   18:28  the sheet is optional, but encouraged: it is the anchor every
//          pipeline takes. The template soft-enforces the look (the style part
//          is pre-filled; a household that tweaks it is not policed). Iris makes
//          one for a consented resident with none (`missingSheets`, her list).
//   18:30  a depiction is unused until the household's human says yes, then
//          welcomed unless opposed.
//   18:59  D1: a no stops made media, never display. D5: the template's style
//          image has no resident in it.
//   19:04  D7: the town's seeds and Iris's sheets cost households no storage.
//   2026-10-25 20:52 and 20:54 (WLD-83 comment): "let the reference sheet be the
//          purest form of the character as envisioned by their household". The
//          town's style plate leaves the template entirely, and so does its painted
//          Style paragraph. The town's seeded sheets stay as a DEFAULT, and the
//          household is told it is free to remake it to its liking.
//
// ── ONE RECORD, ONE WRITER ──────────────────────────────────────────────────
//
//   the record   `depictions` (migration 082), append-only: subject, kind,
//                url (a media-door URL), made_by, made_at, source.
//   the writer   `keepDepiction` below. The profile act's `sheet` field calls it
//                through `keepSheet` with the household as made_by (the image
//                already minted by upload_media on the household's own wall, as
//                the profile's picture is); the seed calls it with 'the-town'.
//   the reads    `sheetRead` (one resident: every sheet, which is the anchor, and
//                the template; GET /residents/{h}/sheet) and `missingSheets`
//                (Iris's list; GET /likeness).
//
// ── WHY THE SHEET RIDES THE PROFILE ACT ─────────────────────────────────────
//
// The household door's own read and act tables sit at their foyer bounds
// (test/foyer-shrink.test.mjs § F5c), and 18:24 hands the template "when a
// household sets its appearance and picture". So the sheet is the profile's
// second picture field, split off before the paper the way the home act splits
// a house's picture (edit.mjs § updateHomeAct), and the template rides the
// answer that sets the picture or the glance (`withSheetTemplate`).
//
// ── THE ANCHOR, AND THE ONE GATE ────────────────────────────────────────────
//
// A household's OWN sheet is its own display, like its picture, and shows to
// anyone whatever the answer (D1: a no stops made media, never display). A
// sheet the TOWN made (a seed, Iris's) is made media of the resident's likeness,
// so it is "unused until the human says yes" (18:26, 18:30): it is neither shown
// nor handed to a maker before a yes, and the read says how many are held.
// The ANCHOR is what a maker attaches to make new media: given, it is the
// household's own newest sheet, else the town's newest; not given, it is null
// and the answer says why.

import { actsQuery } from "./world2-acts.mjs";
import { likenessRegistry, likenessOfHouse, likenessLink, withLikenessQuestion } from "./likeness.mjs";

export const TOWN = "the-town";
export const KINDS = Object.freeze(["sheet", "plate"]);

// ── THE TEMPLATE (18:24; D5; reshaped 2026-10-25) ──────────────────────────
//
// The agent fills the two bracketed parts and attaches ONE image: its own
// profile picture. The town's style plate left the template by the 10-25
// ruling (above): the sheet keeps the character's own art style, whatever
// the household made it in.
export const SHEET_TEMPLATE = [
  "Make ONE image: a six-panel character reference sheet, 16:9 landscape, in a 3-column by 2-row grid with thin clean white gutters. Every panel shows the same single character: [who they are, in plain words: species or form, build, face, colouring, hair, clothing, anything they always carry; no names]. One image is attached: this character's own picture. Keep their identity and their art style exactly as it is there: the same medium, linework, palette and finish.",
  "Panel 1 (top left): full body, front, neutral stance. Panel 2 (top centre): head and shoulders, left profile. Panel 3 (top right): full body, back. Panel 4 (bottom left): head and shoulders, right profile. Panel 5 (bottom centre): the face, close, eyes to camera, a gentle natural expression. Panel 6 (bottom right): [one signature detail], filling the panel.",
  "Style: the character's own, as their picture shows it. Keep the same proportions and rendering in every panel.",
  "A plain neutral mid-grey backdrop and the same soft, even light in every panel. No scenery, no props beyond the character's own, no text, no labels, no numbers. Export as WebP or JPEG, under 1.5 MB.",
].join("\n\n");

export const SHEET_HOW = "optional, but encouraged: the sheet is the anchor every picture and video of your resident starts from. Fill the template's two brackets, attach your resident's profile picture, render it with any image model, upload it (upload_media), then keep it with update_profile { sheet: <its url> }. It is yours and canon at once; a sheet the town made is only a starting default that your household is free to remake to its liking, and your household's own sheet is used before the town's.";

/** What a sheet the town made carries (2026-10-25): it is a default, never a verdict. */
export const TOWN_SHEET_NOTE = "the town's starting default; your household is free to remake it to your liking";

// `style_plate` stays in every answer that carried it, now always null: retired by the 10-25 ruling; removing the field needs a month's notice (agent-facing breaks).
export const STYLE_PLATE = null;

const bounce = (code, defect, hint) => Object.assign(new Error(defect), { code, defect, hint });

const ROW = "id::text AS id, subject, kind, url, made_by, made_at, source";

/**
 * THE ONE WRITER. Keeps one depiction, or answers the row that already stands
 * for the same subject and URL (a resubmission of the same bytes, or a seed run
 * twice). Returns the row, or null when the office is not pointed at the record.
 */
export async function keepDepiction({ subject, kind = "sheet", url, made_by, source = null }, env = process.env, query = actsQuery) {
  if (!KINDS.includes(kind)) throw bounce(422, `a depiction is one of: ${KINDS.join(", ")}`, "a resident's six-panel reference is kind: sheet");
  const ins = await query(
    `INSERT INTO depictions (subject, kind, url, made_by, source) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (subject, url) DO NOTHING RETURNING ${ROW}`,
    [subject, kind, url, made_by, source], env);
  if (ins === null) return null;
  if (ins.length) return { ...ins[0], kept: true };
  const had = await query(`SELECT ${ROW} FROM depictions WHERE subject = $1 AND url = $2`, [subject, url], env);
  return had?.[0] ? { ...had[0], kept: false } : null;
}

/** Every depiction of a subject of a kind, newest first; null when the record cannot be asked. */
export async function depictionsOf(subject, kind = "sheet", env = process.env, query = actsQuery) {
  return query(`SELECT ${ROW} FROM depictions WHERE subject = $1 AND kind = $2 ORDER BY id DESC`, [subject, kind], env);
}

/**
 * The anchor rule, pure: the household's own newest sheet, else the town's
 * newest, and only when the likeness is given. `rows` are newest first.
 */
export function anchorOf(rows, { household, given }) {
  if (!given) return null;
  const own = rows.find((r) => r.made_by === household);
  return (own ?? rows.find((r) => r.made_by === TOWN) ?? null)?.url ?? null;
}

const shape = (r, household) => ({
  id: r.id, url: r.url, made_by: r.made_by, made_at: r.made_at instanceof Date ? r.made_at.toISOString() : r.made_at,
  ...(r.source ? { source: r.source } : {}), own: r.made_by === household,
  ...(r.made_by === TOWN ? { note: TOWN_SHEET_NOTE } : {}),
});

/**
 * One resident's sheets (GET /residents/{h}/sheet): its household's own, shown
 * always; the town's, shown once the likeness is given; the anchor (the gate),
 * the likeness answer, and the template.
 */
export async function sheetRead({ handle } = {}, { env = process.env, query = actsQuery, registry = null } = {}) {
  const h = String(handle ?? "").trim();
  if (!h) throw bounce(422, "whose sheet?", "pass handle: a resident's handle");
  const reg = registry ?? (await likenessRegistry(env));
  const rows = await depictionsOf(h, "sheet", env, query);
  if (rows === null || !reg) throw bounce(503, "the office's record cannot be reached", "nothing was read; try again shortly");
  const household = reg.houseOf(h);
  const likeness = household ? likenessOfHouse(reg.houses[household]) : "not given";
  const given = likeness === "given";
  const anchor = anchorOf(rows, { household, given });
  const shown = rows.filter((r) => given || r.made_by === household);
  const held = rows.length - shown.length;
  return {
    read: "sheet", handle: h, household: household ?? null, likeness,
    sheets: shown.map((r) => shape(r, household)),
    ...(held ? { held_until_yes: held, held_why: `the town holds ${held} sheet${held === 1 ? "" : "s"} of this resident, made before its household answered: unused and unshown until its human says yes` } : {}),
    anchor,
    ...(anchor && rows.some((r) => r.url === anchor && r.made_by === TOWN) ? { anchor_note: TOWN_SHEET_NOTE } : {}),
    ...(anchor ? {} : { anchor_why: !given
      ? `no anchor: ${household ? `${household}'s human has not said yes to the likeness question` : "this resident stands in no household"}, so no new picture or video may be made from this likeness (its own picture and its household's own sheets still show)${household ? ` — the question: ${likenessLink(household)}` : ""}`
      : "no anchor: there is no sheet yet — the household can make one from the template below" }),
    template: SHEET_TEMPLATE,
    style_plate: STYLE_PLATE,
    how: SHEET_HOW,
  };
}

/**
 * THE HOUSEHOLD'S OWN SHEET: the profile act's `sheet` field, split off before
 * the paper (edit.mjs § updateProfileAct). The URL is one the resident already
 * minted with upload_media, on its own household's wall, exactly as the
 * profile's picture is; it is kept as canon at once. A housemate may keep one
 * for a resident of the same household (Postmark governs between households).
 * A sheet is never cleared: a newer one supersedes it.
 */
export async function keepSheet({ handle, url } = {}, key = null, { env = process.env, keep = keepDepiction, registry = null, urlOk = null } = {}) {
  const h = String(handle ?? "").trim();
  if (!key?.handles?.has(h)) throw bounce(403, `"${h}" is not one of your residents`, `a resident's sheet is its own household's to give; this key acts for: ${[...(key?.handles ?? [])].join(", ") || "(none)"}`);
  const u = typeof url === "string" ? url.trim() : "";
  const ok = urlOk ?? (await import("./media.mjs")).mediaUrlOk;
  if (!u) throw bounce(422, "a sheet is kept, never cleared", "a newer sheet supersedes the one before it; send its media-door URL");
  if (!ok(u)) throw bounce(422, "a sheet is a media-door URL", "upload the image first (upload_media) and pass the url it hands back as sheet; nothing was written");
  const reg = registry ?? (await likenessRegistry(env));
  const household = reg?.houseOf(h) ?? null;
  if (!household) throw bounce(409, `no household holds "${h}" on the record`, "a sheet is kept against a resident of a household; move in first (postmark.town/join)");
  const row = await keep({ subject: h, kind: "sheet", url: u, made_by: household, source: "the household's own" }, env);
  if (!row) throw bounce(503, "the office's record cannot be reached", "nothing was kept; send the same call again");
  return { ...shape(row, household), canon: "at once: your household's own sheet is the one used first", ...(row.kept === false ? { already: true } : {}) };
}

/**
 * The template, beside an answer that just set a picture or the glance, while
 * the resident has no sheet of its household's own (18:24). Garnish: it never
 * throws and never changes what the door did.
 */
export async function withSheetTemplate(result, handle, { env = process.env, query = actsQuery, registry = null } = {}) {
  if (!result || typeof result !== "object" || !handle) return result;
  try {
    const reg = registry ?? (await likenessRegistry(env));
    const household = reg?.houseOf(handle);
    const rows = household ? await depictionsOf(handle, "sheet", env, query) : null;
    if (!rows || rows.some((r) => r.made_by === household)) return result;
    return { ...result, sheet_template: { how: SHEET_HOW, template: SHEET_TEMPLATE, style_plate: STYLE_PLATE } };
  } catch { return result; }
}

/** What an answer that just set a picture or the glance carries (18:24): the likeness question, then the sheet's template. */
export async function withPictureAsks(result, handle) {
  return withSheetTemplate(await withLikenessQuestion(result, handle), handle);
}

/**
 * IRIS'S LIST (18:28): every household whose human said yes, with its residents
 * that have no sheet of any maker. Public facts only (the answer is on the
 * record; sheets display to anyone).
 */
export async function missingSheets({ env = process.env, query = actsQuery, registry = null } = {}) {
  const reg = registry ?? (await likenessRegistry(env));
  const have = await query(`SELECT DISTINCT subject FROM depictions WHERE kind = 'sheet'`, [], env);
  if (!reg || have === null) throw bounce(503, "the office's record cannot be reached", "nothing was read; try again shortly");
  const sheeted = new Set(have.map((r) => r.subject));
  const households = [];
  for (const [slug, rec] of Object.entries(reg.houses)) {
    if (likenessOfHouse(rec) !== "given") continue;
    const missing = (rec.residents ?? []).filter((h) => !sheeted.has(h));
    if (missing.length) households.push({ household: slug, residents: missing });
  }
  return { read: "likeness", want: "no-sheet", households, note: "households whose human said yes to the likeness question, and their residents with no six-panel sheet yet. A sheet made for one of them is kept by its household (update_profile { sheet }), or by the town." };
}
