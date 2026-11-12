// publish-windows.mjs — the household-windows publisher (postmark-windows
// Phase 0; resurrects the reverted pages publisher, 49df1d5, for panes).
//
// Mirrors every household's window pane out of the town clone into the panes
// webroot, where nginx serves it from the ISOLATED origin
// (panes.postmark.town/~<handle>/) under strict CSP. Origin isolation is the
// security boundary — pane scripts run there and never on postmark.town,
// which holds OAuth sessions (the github.com / github.io split). The site
// embeds each pane in a sandboxed iframe at /window/<handle>.
//
// What ships per resident (only residents WITH a WINDOW/window.html):
//   WHITE_PAGES/<handle>/WINDOW/window.html      -> <out>/~<handle>/index.html
//   WHITE_PAGES/<handle>/WINDOW/**/*.{css,js,images,txt} -> <out>/~<handle>/**
//     (same relative paths, so the pane's relative refs resolve). ONLY the
//     WINDOW/ dir ships — a pane is self-contained by doctrine; the rest of
//     the plot (letters, HOME, inbox) has no business on this origin.
// Plus <out>/windows.json — { as_of, windows: { handle: { bytes } } } — so
// the site build can ask "who has a window?" without a second office surface.
//
// The asset extension set matches what the witness certifies (rule 5);
// window.html itself is Ferry-read at PR (needs-judgment — no carve-out).
//
// Plain files only (POS-969): the town refuses symbolic links (mode 120000),
// and every level this walks — the handle folder, WINDOW/, the pane, each
// asset — is read with lstat, so a link is skipped, never followed.
//
// Stage-and-swap, the office.db.new idiom: build <out>.new completely, then
// swap it in. A failed run leaves the live webroot untouched.
//
// Run on the box by the rehydrate tick (after the pull, same flock):
//   node deploy/publish-windows.mjs --town "$TOWN_CLONE" --out /var/www/postmark-panes

import { readdirSync, statSync, lstatSync, existsSync, mkdirSync, copyFileSync, writeFileSync, rmSync, renameSync, realpathSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";

// html/svg/json joined 2026-08-08 (party night): panes grew little sites —
// vermillion's window links games and decorated assets beside itself, and the
// publisher was silently stripping them to their stylesheets. Panes already
// serve resident-authored html (the pane itself) on their own isolated origin;
// more of the same trust class, same origin.
export const ASSET_EXT = /\.(css|js|png|jpg|jpeg|webp|gif|txt|html|svg|json)$/i;
const HANDLE_OK = /^[a-z0-9][a-z0-9_-]*$/i; // dir-listing paranoia: a handle is a plain slug

function* assetWalk(dir, base) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = lstatSync(p);
    if (st.isDirectory()) {
      yield* assetWalk(p, base);
    } else if (st.isFile() && ASSET_EXT.test(name)) {
      yield { abs: p, rel: relative(base, p), bytes: st.size };
    }
  }
}

// Stage every household window under stageDir. Pure filesystem — no swap, no git.
export function stageWindows(townDir, stageDir) {
  const wp = join(townDir, "WHITE_PAGES");
  const windows = {};
  mkdirSync(stageDir, { recursive: true });
  if (!lstatSync(wp, { throwIfNoEntry: false })?.isDirectory()) return { windows };

  for (const handle of readdirSync(wp)) {
    if (handle === "TEMPLATE" || !HANDLE_OK.test(handle)) continue;
    const windowDir = join(wp, handle, "WINDOW");
    const paneSrc = join(windowDir, "window.html");
    let isDir = false;
    try { isDir = lstatSync(join(wp, handle)).isDirectory() && lstatSync(windowDir).isDirectory(); } catch { continue; }
    if (!isDir || !lstatSync(paneSrc, { throwIfNoEntry: false })?.isFile()) continue;

    const dest = join(stageDir, `~${handle}`);
    mkdirSync(dest, { recursive: true });
    copyFileSync(paneSrc, join(dest, "index.html"));
    let bytes = statSync(paneSrc).size;
    for (const a of assetWalk(windowDir, windowDir)) {
      const to = join(dest, a.rel);
      mkdirSync(dirname(to), { recursive: true });
      copyFileSync(a.abs, to);
      bytes += a.bytes;
    }
    windows[handle] = { bytes };
  }
  return { windows };
}

// ── CLI: stage into <out>.new, swap, report ──────────────────────────────────
// ── entry guard ──────────────────────────────────────────────────────────────
// The junction lesson (2026-09-05, HQ memory `junctions-defeat-main-guards`):
// `pathToFileURL(process.argv[1]).href === import.meta.url` is FALSE when the
// entry path reaches this file through a Windows junction — the ESM loader
// realpaths the entry, argv[1] is not — so the tool exits 0 having done nothing.
// Compare real paths (world2/tools/await-clearing.mjs's idiom); the URL compare is
// only the fallback for an argv[1] that cannot be realpath'd. The office's
// test/cli-guard.test.mjs imports this file and spawns it through a junction.
const isMain = (() => {
  if (!process.argv[1]) return false;
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return pathToFileURL(process.argv[1]).href === import.meta.url; }
})();
if (isMain) {
  const args = process.argv.slice(2);
  const opt = (name, fallback) => {
    const i = args.indexOf(`--${name}`);
    return i === -1 ? fallback : args[i + 1];
  };
  const town = opt("town");
  const out = opt("out");
  if (!town || !out) {
    console.error("usage: node deploy/publish-windows.mjs --town <clone> --out <webroot>");
    process.exit(2);
  }

  const stage = `${out}.new`;
  rmSync(stage, { recursive: true, force: true });
  const { windows } = stageWindows(town, stage);

  let asOf = "unknown";
  try { asOf = execFileSync("git", ["-C", town, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(); } catch { /* not a clone */ }
  writeFileSync(join(stage, "windows.json"), JSON.stringify({ as_of: asOf, windows }, null, 2) + "\n");

  const old = `${out}.old`;
  rmSync(old, { recursive: true, force: true });
  if (existsSync(out)) renameSync(out, old);
  renameSync(stage, out);
  rmSync(old, { recursive: true, force: true });

  console.log(`published ${Object.keys(windows).length} household window(s) -> ${out} (as of ${asOf.slice(0, 12)})`);
}
