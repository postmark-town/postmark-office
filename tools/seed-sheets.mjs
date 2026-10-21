#!/usr/bin/env node
// seed-sheets — the six-panel sheets already made, kept ONCE as each resident's first reference (WLD-83).
//
// THE RULINGS (Darko, 2026-10-19, WLD-83): 18:26, the sheets made for the Snug
// Harbour episode are seeded as each resident's initial reference asset rather
// than having residents redo the work; 18:30, unused until the household's
// human says yes, then welcomed unless opposed; 18:59 D6, seed all the sheets
// that exist; D5, the template's style image has no resident in it; 19:04 D7,
// the town's seeds cost households no storage.
//
// So each sheet is re-encoded to WebP (the originals are ~2.8 MB PNGs, over the
// media door's 1.5 MB), minted through `uploadMedia` on THE TOWN's own wall
// (`media/the-town/…`, never a household's quota), and kept by `keepDepiction`
// with made_by 'the-town' and its source line. The style plate is kept the same
// way as kind 'plate'. A handle the record does not hold is refused, never
// guessed. Nothing is USED until the household says yes: the anchor read gates
// it (src/depictions.mjs § anchorOf).
//
// Wright runs it on the box, after 081 lands, from a staging folder holding the
// files the manifest names: `--dry-run` first, then `--apply`. Running it twice
// keeps nothing twice: the same bytes re-encode to the same object, and
// (subject, url) is unique.
//
//   node tools/seed-sheets.mjs --dry-run --manifest seed-sheets.json --from ./staging --oauth-db ./oauth.db
//   node tools/seed-sheets.mjs --apply   --manifest seed-sheets.json --from ./staging --oauth-db ./oauth.db
//
// The manifest: { "plate": { "file", "source" }, "sheets": [{ "handle", "file", "source" }] }

import { copyFileSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

export const TOWN = "the-town";
// Comfortably under the media door's 1.5 MB for a 1672 × 941 sheet.
export const WEBP_QUALITY = 82;

/** PNG (or any raster sharp reads) → WebP bytes. */
export async function toWebp(bytes, { sharp = null } = {}) {
  const s = sharp ?? (await (await import("../src/edit.mjs")).loadSharp());
  return s(bytes).webp({ quality: WEBP_QUALITY }).toBuffer();
}

/**
 * The seed, injectable end to end so a test needs no box.
 *
 * `holds(handle)` says whether the record holds the handle; `upload` is
 * uploadMedia; `keep` is keepDepiction; `read(file)` reads a staged file.
 */
export async function seedSheets({ manifest, read, holds, upload, keep, encode = toWebp, odb = null, put, onEntry = () => {} }) {
  const kept = [], already = [], refused = [];
  const entries = [
    ...(manifest.plate ? [{ subject: TOWN, kind: "plate", file: manifest.plate.file, source: manifest.plate.source ?? null }] : []),
    ...(manifest.sheets ?? []).map((s) => ({ subject: s.handle, kind: "sheet", file: s.file, source: s.source ?? null })),
  ];
  for (const e of entries) {
    try {
      if (e.kind === "sheet" && !(await holds(e.subject))) throw Object.assign(new Error(`the record holds no resident "${e.subject}"`), { code: 404 });
      const bytes = await encode(read(e.file));
      // The town's own wall: the key is the town's, and the uploader is the
      // depicted resident by name (the media ledger's `by`), so the shelf says
      // whose likeness each object is.
      const key = { household: TOWN, handles: new Set([e.subject]) };
      const minted = await upload({ by: e.subject }, key, odb, { bytes, ...(put ? { put } : {}) });
      const row = await keep({ subject: e.subject, kind: e.kind, url: minted.url, made_by: TOWN, source: e.source });
      (row?.kept === false ? already : kept).push({ ...e, url: minted.url, bytes: bytes.length });
      onEntry({ ok: true, ...e, url: minted.url, bytes: bytes.length, already: row?.kept === false });
    } catch (err) {
      const row = { ...e, code: err?.code ?? null, why: err?.defect ?? err?.message ?? String(err) };
      refused.push(row);
      onEntry({ ok: false, ...row });
    }
  }
  return { kept, already, refused };
}

// ── entry guard (backfill-home-shelf.mjs § the junction lesson) ─────────────
const isMain = (() => {
  if (!process.argv[1]) return false;
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return pathToFileURL(process.argv[1]).href === import.meta.url; }
})();
if (isMain) {
  const argv = process.argv.slice(2);
  const opt = (name, def) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : def; };
  const DRY = argv.includes("--dry-run");
  const APPLY = argv.includes("--apply");
  if (DRY === APPLY) { console.error("seed-sheets: pass exactly one of --dry-run or --apply"); process.exit(2); }
  const MANIFEST = opt("--manifest", null);
  const FROM = resolve(opt("--from", "."));
  const OAUTH_DB = resolve(opt("--oauth-db", "oauth.db"));
  if (!MANIFEST || !existsSync(MANIFEST)) { console.error("seed-sheets: --manifest must name the seed's JSON manifest"); process.exit(2); }
  const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));

  if (DRY) for (const k of ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"]) if (!process.env[k]) process.env[k] = "dry-run";
  const { uploadMedia, mediaConfigured } = await import("../src/media.mjs");
  const { openOauthDb, oauthSchema } = await import("../src/oauth.mjs");
  const { openPaper } = await import("../src/paperwork.mjs");
  const { keepDepiction } = await import("../src/depictions.mjs");
  const { likenessRegistry } = await import("../src/likeness.mjs");
  if (!DRY && !mediaConfigured()) { console.error("the media door has no credentials here — run this on the box"); process.exit(2); }
  const reg = await likenessRegistry();
  if (!reg) { console.error("seed-sheets: this office is not pointed at the record (WORLD2_PG=1 and WORLD2_PG_URL), so no handle can be checked — nothing seeded"); process.exit(2); }

  let dbPath = OAUTH_DB, tmp = null;
  if (DRY) { tmp = mkdtempSync(join(tmpdir(), "seed-sheets-")); dbPath = join(tmp, "oauth.db"); if (existsSync(OAUTH_DB)) copyFileSync(OAUTH_DB, dbPath); }
  const odb = DRY ? openOauthDb(dbPath) : await openPaper(OAUTH_DB, { schema: oauthSchema });
  const put = DRY ? async () => {} : undefined;
  const keep = DRY ? async () => ({ kept: true }) : (row) => keepDepiction(row);

  console.log(`${DRY ? "[dry-run] " : ""}seeding sheets from ${FROM} onto the town's own wall`);
  const { kept, already, refused } = await seedSheets({
    manifest, read: (f) => readFileSync(join(FROM, f)), holds: (h) => Boolean(reg.houseOf(h)),
    upload: uploadMedia, keep, odb, put,
    onEntry: (e) => console.log(e.ok ? `  ${e.already ? "=" : "✓"} ${e.subject}  ${e.kind}  ${e.file} → ${e.url} (${e.bytes} B)` : `  ✗ ${e.subject}  ${e.code ?? "-"}: ${e.why}`),
  });
  console.log(`\n${DRY ? "[dry-run] would keep" : "kept"} ${kept.length}; already kept ${already.length}; refused ${refused.length}`);
  if (tmp) rmSync(tmp, { recursive: true, force: true });
  process.exit(refused.length ? 1 : 0);
}
