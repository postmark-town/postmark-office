#!/usr/bin/env node
// avatar-carry — every profile picture carried ONCE into the one picture key (WLD-83).
//
// THE RULING (Darko, 2026-10-19 18:24, WLD-83): "one picture, not two". A
// profile kept its picture in two keys: `avatar:` (a file beside PROFILE.md,
// written by the byte door) and `avatar_url:` (a town-media URL, written by
// update_profile). Since the w44 train both doors write `avatar_url` only and
// clear `avatar:` (src/edit.mjs § ONE PICTURE, ONE KEY), and the readers keep
// reading `avatar:` until AVATAR_KEY_READ_UNTIL. This tool carries every
// profile that still holds only a file, so nobody's face is lost on that date.
// Wright runs it on the box: `--dry-run` first, then `--apply`. A lane never
// runs it against the real town or store.
//
// ── PER PROFILE ─────────────────────────────────────────────────────────────
//
//   avatar_url and no avatar:    nothing to do (already one key)
//   avatar_url AND avatar:       the URL is the picture every reader shows (the
//                                site since postmark-site#281, the office
//                                always), so avatar: is cleared, nothing minted
//   avatar: alone                the file's bytes are minted through
//                                `uploadMedia` on the household's own wall (the
//                                door's resolver's key, as the home carry asks
//                                it), and the URL kept by update_profile's own
//                                writer, which clears avatar: in the same write
//   avatar: naming no file       reported, untouched (a person looks)
//
// ── THE SAME WRITERS, NOTHING OVERWRITTEN ───────────────────────────────────
//
// The mint is `uploadMedia` and the write is `updateProfile`, the door every
// resident's own picture goes through, called with no town-log handle (a
// carry is not a resident's act, so it leaves no row for the drain to replay).
// The file stays in the repo as history. A picture is never chosen for anyone:
// the carry keeps exactly the face each resident shows today.
//
//   node tools/avatar-carry.mjs --dry-run --town ./town-clone --oauth-db ./oauth.db
//   node tools/avatar-carry.mjs --apply   --town ./town-clone --oauth-db ./oauth.db

import { copyFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { readProfile } from "../src/profiles.mjs";

const said = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);

/** What the carry would do for one profile, from the checkout alone. Pure over the clone. */
export function avatarPlan(clone, handle) {
  const p = readProfile(clone, handle);
  if (!p) return { handle, act: "none" };
  const url = said(p.avatar_url), file = said(p.avatar);
  if (!file) return { handle, act: "none" };
  if (url) return { handle, act: "clear", url };
  const path = join(clone, "WHITE_PAGES", handle, file);
  if (!existsSync(path)) return { handle, act: "missing", file };
  return { handle, act: "mint", file, path };
}

/**
 * The carry, injectable end to end so a test needs no box.
 *
 * `householdFor(handle)` is the door's resolver's answer (a key: household +
 * handles); `upload` is uploadMedia; `write(args, key)` is update_profile's
 * writer bound to the clone.
 */
export async function carryAvatars({ clone, householdFor, upload, write, odb = null, put, onEntry = () => {} }) {
  const minted = [], cleared = [], skipped = { missing: [], noHousehold: [], refused: [] };
  const handles = readdirSync(join(clone, "WHITE_PAGES"), { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name !== "TEMPLATE" && !e.name.startsWith("_")).map((e) => e.name).sort();
  for (const handle of handles) {
    const plan = avatarPlan(clone, handle);
    if (plan.act === "none") continue;
    if (plan.act === "missing") { skipped.missing.push(plan); onEntry({ handle, ok: false, why: `avatar: names ${plan.file}, which is not there` }); continue; }
    const key = await householdFor(handle);
    if (!key?.household || !key.handles?.has(handle)) {
      skipped.noHousehold.push(handle);
      onEntry({ handle, ok: false, why: "the door's resolver knows no household holding this handle" });
      continue;
    }
    try {
      if (plan.act === "clear") {
        await write({ handle, image: plan.url }, key);
        cleared.push({ handle, url: plan.url });
        onEntry({ handle, ok: true, cleared: true, url: plan.url });
        continue;
      }
      const bytes = readFileSync(plan.path);
      const m = await upload({ by: handle }, key, odb, { bytes, clone, ...(put ? { put } : {}) });
      await write({ handle, image: m.url }, key);
      minted.push({ handle, file: plan.file, url: m.url, already: m.already === true });
      onEntry({ handle, ok: true, file: plan.file, url: m.url });
    } catch (e) {
      const row = { handle, file: plan.file ?? null, code: e?.code ?? null, why: e?.defect ?? e?.message ?? String(e) };
      skipped.refused.push(row);
      onEntry({ handle, ok: false, ...row });
    }
  }
  return { minted, cleared, skipped };
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
  if (DRY === APPLY) { console.error("avatar-carry: pass exactly one of --dry-run or --apply"); process.exit(2); }
  const TOWN = resolve(opt("--town", process.env.TOWN_CLONE ?? "town-clone"));
  const OAUTH_DB = resolve(opt("--oauth-db", "oauth.db"));
  if (!existsSync(join(TOWN, "WHITE_PAGES"))) { console.error(`--town must name a town clone holding WHITE_PAGES/ (got: ${TOWN})`); process.exit(2); }

  process.env.TOWN_CLONE = TOWN;
  if (DRY) for (const k of ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"]) if (!process.env[k]) process.env[k] = "dry-run";
  const { uploadMedia, mediaConfigured } = await import("../src/media.mjs");
  const { openOauthDb, oauthSchema, householdFor } = await import("../src/oauth.mjs");
  const { openPaper } = await import("../src/paperwork.mjs");
  const { updateProfile } = await import("../src/edit.mjs");
  const { loadPins } = await import("../src/registry-store.mjs");
  if (!DRY && !mediaConfigured()) { console.error("the media door has no credentials here — run this on the box"); process.exit(2); }

  // The door's resolver, asked the way home-picture-carry.mjs asks it: the
  // store's pins first, the residents index's ADDRESS github binding second.
  const { refreshStoreProbe } = await import("../src/town-index-store.mjs");
  const { heldStoreProbe } = await import("../src/index-probe.mjs");
  if (!(await refreshStoreProbe({ letters: false }))) { console.error("avatar-carry: the store's town index could not be read (WORLD2_PG=1 and WORLD2_PG_URL), so the residents' GitHub lines are unknown — nothing carried"); process.exit(2); }
  const idx = heldStoreProbe();
  const pins = await loadPins();
  if (pins === null) { console.error("avatar-carry: this office is not pointed at the store (WORLD2_PG=1 and WORLD2_PG_URL), so it cannot read the pins — nothing carried"); process.exit(2); }
  const loginOf = (handle) => {
    try { return idx.loginRows().find((r) => r.handle === handle)?.github || null; } catch { return null; }
  };
  const doorHouseholdFor = (handle) => {
    const pin = pins[handle];
    const ghId = pin?.id ?? null, ghLogin = pin?.login ?? loginOf(handle);
    return ghId == null && !ghLogin ? null : householdFor(idx, ghId, ghLogin);
  };

  let dbPath = OAUTH_DB, tmp = null;
  if (DRY) { tmp = mkdtempSync(join(tmpdir(), "avatar-carry-")); dbPath = join(tmp, "oauth.db"); if (existsSync(OAUTH_DB)) copyFileSync(OAUTH_DB, dbPath); }
  // The media ledger, opened as home-picture-carry.mjs opens it: --apply the
  // way the server does, --dry-run a throwaway copy.
  const odb = DRY ? openOauthDb(dbPath) : await openPaper(OAUTH_DB, { schema: oauthSchema });
  const put = DRY ? async () => {} : undefined;
  const write = DRY ? async () => ({}) : (args, key) => updateProfile(args, key, null, TOWN);

  console.log(`${DRY ? "[dry-run] " : ""}carrying file avatars into avatar_url — town ${TOWN}`);
  const { minted, cleared, skipped } = await carryAvatars({
    clone: TOWN, householdFor: doorHouseholdFor, upload: uploadMedia, write, odb, put,
    onEntry: (e) => console.log(e.cleared ? `  = ${e.handle}  already shows its URL — avatar: cleared`
      : e.ok ? `  ✓ ${e.handle}  ${e.file} → ${e.url}` : `  ✗ ${e.handle}  ${e.code ?? "-"}: ${e.why}`),
  });
  console.log(`\n${DRY ? "[dry-run] would mint" : "minted"} ${minted.length}; ${DRY ? "would clear" : "cleared"} ${cleared.length}; file missing ${skipped.missing.length}; no household ${skipped.noHousehold.length}; refused ${skipped.refused.length}`);
  if (tmp) rmSync(tmp, { recursive: true, force: true });
  process.exit(skipped.refused.length ? 1 : 0);
}
