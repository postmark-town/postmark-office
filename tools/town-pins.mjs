#!/usr/bin/env node
// town-pins.mjs — WRITE OR CHECK THE OFFICE'S PINNED COPIES OF TOWN CODE (POS-994).
//
//   node tools/town-pins.mjs --write --town <town checkout> --ref <town commit> [--out <dir>]
//   node tools/town-pins.mjs --check [--town <town checkout>] [--out <dir>]
//
// --out    the pins' folder; the default is the office's own, src/town-pins/. The
//          dev office pins ITS OWN re-signed town into one outside its clone
//          (deploy/postmark-dev-freshen.sh, /srv/postmark-office-dev/town-pins-dev;
//          Wright, POS-994, 2026-11-16), since dev's ledger re-sign rewrites
//          signatures inside the town's own tools. An --out inside the --town
//          checkout is refused: the office never checks town code against the
//          town's own folder (src/town-tool.mjs refuses such a root too). An --out
//          folder is written in place, as the office's own is; it pins the modules
//          the town holds at <ref> (the office's own must hold every one). A running
//          office reads its pins once, so the dev freshen restarts the dev office
//          after it re-pins (deploy/postmark-dev-freshen.service).
//
// --write  reads every module in MODULES, and every file each one imports by a
//          relative path (its closure, followed to the end), from the town repo
//          AT <ref> (`git show <ref>:<path>`, never the working tree), and writes
//          them byte for byte under src/town-pins/ in the town's own layout,
//          with PINS.json naming the commit, each file's blob and closure. Files
//          a previous pin held and this one does not are named, not deleted:
//          remove them in the same PR.
// --check  every pinned file's bytes hash to the blob PINS.json names, and each
//          closure is complete. With --town, also every blob equals the town
//          repo's at PINS.json's commit (the pin is what the town held then).
//          Exit 0 green, 1 a named difference.
//
// The pin moves only in an office PR, reviewed as office code; a town PR that
// changes a pinned file rides with that PR in the same train (SHIPPING).

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, posix, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { PIN_ROOT, gitBlobSha, relativeImports } from "../src/town-tool.mjs";

/** The town modules the office reaches next to a key or the store (POS-994's inventory). */
export const MODULES = [
  "stamp-mint.mjs", "stamp-verify.mjs", "ballot.mjs", "world-stake.mjs", "quest-progress.mjs",
  "envelope.mjs", "mail-state.mjs", "epoch-close.mjs", "witness-chain.mjs", "crossings.mjs",
  "household-keys.mjs",
];

// The relative-import reader is the loader's own (src/town-tool.mjs), so the pins
// and the historical check follow one closure rule.
export { relativeImports };

/** { path: { bytes, deps } } for the modules and their closures, read by `read(path)`. */
export function collect(read, modules = MODULES) {
  const files = new Map();
  const walk = (p) => {
    if (files.has(p)) return;
    if (p.startsWith("..")) throw new Error(`${p} is outside the town repo`);
    const bytes = read(p);
    const deps = relativeImports(p, bytes.toString("utf8"));
    files.set(p, { bytes, deps });
    deps.forEach(walk);
  };
  for (const m of modules) walk(`tools/${m}`);
  return files;
}

export function closureOf(files, p, seen = new Set()) {
  for (const d of files.get(p).deps) if (!seen.has(d)) { seen.add(d); closureOf(files, d, seen); }
  return seen;
}

export function manifest(files, { townCommit, readAt }) {
  const out = { town_repo: "postmark-town/postmark", town_commit: townCommit, read_at: readAt, files: {} };
  for (const p of [...files.keys()].sort()) {
    out.files[p] = { blob: gitBlobSha(files.get(p).bytes), closure: [...closureOf(files, p)].sort() };
  }
  return out;
}

function listPinned(root) {
  const out = [];
  const walk = (d) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (n !== "PINS.json") out.push(relative(root, p).split(sep).join("/"));
    }
  };
  if (existsSync(root)) walk(root);
  return out.sort();
}

/** Problems with the pins at `root`, as sentences. Empty is green. The office's own pins must hold every MODULE (`complete`). */
export function checkPins(root = PIN_ROOT, { townBlob, complete = resolve(root) === resolve(PIN_ROOT) } = {}) {
  const problems = [];
  const pins = JSON.parse(readFileSync(join(root, "PINS.json"), "utf8"));
  for (const [p, e] of Object.entries(pins.files)) {
    const at = join(root, p);
    if (!existsSync(at)) { problems.push(`${p}: named in PINS.json, no file`); continue; }
    const blob = gitBlobSha(readFileSync(at));
    if (blob !== e.blob) problems.push(`${p}: the file is ${blob.slice(0, 12)}, PINS.json says ${e.blob.slice(0, 12)}`);
    for (const c of e.closure) if (!pins.files[c]) problems.push(`${p}: imports ${c}, which is not pinned`);
    if (townBlob) {
      const t = townBlob(pins.town_commit, p);
      if (t !== e.blob) problems.push(`${p}: the town at ${pins.town_commit.slice(0, 12)} holds ${t ? t.slice(0, 12) : "no such file"}, the pin ${e.blob.slice(0, 12)}`);
    }
  }
  for (const p of listPinned(root)) if (!pins.files[p]) problems.push(`${p}: a file under the pins that PINS.json does not name`);
  if (complete) for (const m of MODULES) if (!pins.files[`tools/${m}`]) problems.push(`tools/${m}: in MODULES, not pinned`);
  return problems;
}

/** Null, or the sentence refusing pins at `root` because they lie inside the `town` checkout. */
export function outInsideTown(town, root) {
  const rel = relative(resolve(town), resolve(root));
  return !rel.startsWith("..") && !isAbsolute(rel)
    ? `--out ${root} is inside the --town checkout ${town}: the office never checks town code against the town's own folder`
    : null;
}

async function main(argv) {
  const arg = (n) => { const i = argv.indexOf(n); return i === -1 ? null : argv[i + 1]; };
  const git = (town, args) => execFileSync("git", ["-C", town, ...args], { maxBuffer: 1 << 26 });
  const out = arg("--out");
  const root = out ? resolve(out) : PIN_ROOT;
  if (argv.includes("--write")) {
    const town = arg("--town"), ref = arg("--ref");
    if (!town || !ref || (argv.includes("--out") && !out)) { console.error("usage: town-pins.mjs --write --town <town checkout> --ref <town commit> [--out <dir>]"); return 2; }
    const refused = outInsideTown(town, root);
    if (refused) { console.error(`town-pins: ${refused}`); return 2; }
    const commit = git(town, ["rev-parse", "--verify", `${ref}^{commit}`]).toString().trim();
    const held = (m) => { try { git(town, ["cat-file", "-e", `${commit}:tools/${m}`]); return true; } catch { return false; } };
    const modules = out ? MODULES.filter(held) : MODULES;
    const files = collect((p) => git(town, ["show", `${commit}:${p}`]), modules);
    const manifestText = JSON.stringify(manifest(files, { townCommit: commit, readAt: new Date().toISOString() }), null, 2) + "\n";
    const before = listPinned(root);
    for (const [p, { bytes }] of files) {
      mkdirSync(dirname(join(root, p)), { recursive: true });
      writeFileSync(join(root, p), bytes);
    }
    writeFileSync(join(root, "PINS.json"), manifestText);
    const absent = MODULES.filter((m) => !modules.includes(m));
    console.log(`pinned ${files.size} files from town ${commit.slice(0, 12)} into ${relative(process.cwd(), root) || root}${absent.length ? ` (not in the town at that commit: ${absent.join(", ")})` : ""}`);
    const stale = before.filter((p) => !files.has(p));
    if (stale.length) console.log(`no longer pinned: ${stale.join(", ")}${out ? " (left in place; PINS.json does not name them, so nothing loads them)" : " (remove them in this PR)"}`);
    return 0;
  }
  if (argv.includes("--check")) {
    const town = arg("--town");
    const townBlob = town ? (commit, p) => {
      try { return git(town, ["rev-parse", `${commit}:${p}`]).toString().trim(); } catch { return null; }
    } : undefined;
    const problems = checkPins(root, { townBlob, complete: !out });
    for (const p of problems) console.error(`town-pins: ${p}`);
    if (problems.length) return 1;
    const pins = JSON.parse(readFileSync(join(root, "PINS.json"), "utf8"));
    console.log(`town-pins: ${Object.keys(pins.files).length} files green at town ${pins.town_commit.slice(0, 12)}${town ? " (and equal to the town's)" : ""}`);
    return 0;
  }
  console.error("usage: town-pins.mjs --write --town <town checkout> --ref <town commit> [--out <dir>] | --check [--town <town checkout>] [--out <dir>]");
  return 2;
}

// The junction lesson (test/cli-guard.test.mjs): compare real paths, so the entry fires through a link too.
const isMain = (() => {
  if (!process.argv[1]) return false;
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url)); }
})();
if (isMain) process.exit(await main(process.argv.slice(2)));
