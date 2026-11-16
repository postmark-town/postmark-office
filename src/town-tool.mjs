// town-tool.mjs — THE OFFICE RUNS ONLY THE TOWN CODE IT PINNED (POS-994 /a /b).
//
// Ruled by Darko, 2026-11-15 18:03 EST (POS-994): every place the office runs
// town code next to a key or the store, it runs a reviewed copy pinned in the
// office, and if the town's copy differs, that step stops and says so. Mint
// changes ride an office pin.
//
// ── WHAT A PIN IS ───────────────────────────────────────────────────────────
// `src/town-pins/` holds byte-exact copies of the town modules the office
// reaches (stamp-mint, ballot, witness-chain, …) plus every file they import
// by a relative path, read at ONE town commit by `tools/town-pins.mjs --write`.
// `src/town-pins/PINS.json` names that commit and each file's git blob sha and
// closure. The copies keep the town's layout (`tools/x.mjs`,
// `PROJECTS/the-town-seal/seal.mjs`), so their relative imports resolve among
// the pinned copies, never into a clone.
//
// ── WHAT THE LOADER DOES ────────────────────────────────────────────────────
// `townTool(clone, "stamp-mint.mjs")` hashes the clone's copy of the module AND
// of its whole closure (git blob sha of the working file) against the pins.
// Every one equal: it returns the PINNED path, and that is what runs or loads.
// Any one different or missing: it throws `TownPinMismatch` naming the file,
// both blobs and the pin's town commit. Each caller already turns a thrown
// load into its own named refusal: that is "the step stops and says so".
//
// Why a copy and not "hash the clone's file, then load the clone's file": the
// office's servers import stamp-mint while the ferry's `git pull` can change
// the clone under them. A hash-then-load races; a pinned copy cannot change
// between the check and the load.
//
// ── THE CLONE MUST BE NAMED, ALWAYS ─────────────────────────────────────────
// The town's modules default their repo to their own folder's parent
// (`DEFAULT_REPO = resolve(dirname(import.meta.url), '..')`). A pinned copy's
// parent is `src/town-pins`, which holds no ledger, no roll and no rooms, and
// some read verbs answer an empty town there without failing. So a child
// process gets its argv only from `townToolArgv`, which always names the clone
// (`--repo <clone>`); the town's library functions take the repo as an argument
// and only their CLI entries fall back to the default. test/town-tool.test.mjs
// holds both: the unnamed run answers an empty town (why the argv is built
// here), and no office file spawns a pinned path any other way.
//
// ── A TOWN CHANGE TO A PINNED FILE ──────────────────────────────────────────
// Rides with its office pin PR in the same train (`tools/town-pins.mjs --write
// --ref <the train's town head>`), reviewed as office code. Until the pin moves,
// a clone at the new town code stops each pinned step by name.

import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, isAbsolute, join, posix, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const PIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), "town-pins");

// The office suite reads a town clone pinned by test/clone-pins.json, which is
// not the commit these pins were read at, so its helper writes pins for THAT
// clone (test/helpers/town-pins-env.mjs) and names them here. Nothing on the box
// sets it; a root inside the clone is refused below, so it can never point the
// loader back at the code it checks.
const pinRoot = () => process.env.TOWN_PINS_DIR || PIN_ROOT;

// `from "./x.mjs"`, `import("./x.mjs")`, `import "./x.mjs"`: a relative specifier only.
const RELATIVE = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)['"](\.{1,2}\/[^'"]+)['"]/g;
/** The repo-relative paths `text` (the file at `path`) imports by a relative specifier. */
export const relativeImports = (path, text) =>
  [...text.matchAll(RELATIVE)].map((m) => posix.normalize(posix.join(posix.dirname(path), m[1])));

/** git's blob id for these bytes (what `git hash-object` prints). */
export function gitBlobSha(buf) {
  return createHash("sha1").update(`blob ${buf.length}\0`).update(buf).digest("hex");
}

export class TownPinMismatch extends Error {
  constructor({ file, pinned, found, townCommit, clone }) {
    super(`the town's ${file} is not the copy the office pinned ` +
      `(pinned ${pinned.slice(0, 12)} from town ${String(townCommit).slice(0, 12)}; ` +
      `${found ? `the clone at ${clone} holds ${found.slice(0, 12)}` : `the clone at ${clone} has no such file`}): ` +
      `this step stops. A town change to pinned code rides an office pin PR (tools/town-pins.mjs).`);
    this.name = "TownPinMismatch";
    this.code = "TOWN_PIN_MISMATCH";
    Object.assign(this, { file, pinned, found, townCommit, clone });
  }
}

export class TownToolUnpinned extends Error {
  constructor(file, root) {
    super(`${file} is not pinned in ${root}/PINS.json: the office runs no town code it has not pinned (POS-994)`);
    this.name = "TownToolUnpinned";
    this.code = "TOWN_TOOL_UNPINNED";
    this.file = file;
  }
}

const pinsCache = new Map();
/**
 * The pin manifest at `root`, read once per process. A pin folder never changes
 * under a running office: prod's is carried with the release, and the dev office
 * is restarted by its freshen after every re-pin (deploy/postmark-dev-freshen.service).
 */
export function readPins(root = pinRoot()) {
  if (!pinsCache.has(root)) pinsCache.set(root, JSON.parse(readFileSync(join(root, "PINS.json"), "utf8")));
  return pinsCache.get(root);
}

// A clone file's blob, cached on (size, mtime) so a server's repeated loads do
// not re-hash 150 KB each time; any write to the file changes one of the two.
const blobCache = new Map();
function cloneBlob(path) {
  if (!existsSync(path)) return null;
  const st = statSync(path);
  const key = `${st.size}:${st.mtimeMs}`;
  const hit = blobCache.get(path);
  if (hit && hit.key === key) return hit.blob;
  const blob = gitBlobSha(readFileSync(path));
  blobCache.set(path, { key, blob });
  return blob;
}

/**
 * The pinned path of the town's `tools/<name>`, after the clone's copy of it and
 * of its whole closure are found equal to the pins. Throws TownPinMismatch or
 * TownToolUnpinned; never returns a path into the clone.
 */
export function townTool(clone, name, { root = pinRoot() } = {}) {
  if (!clone) throw new Error(`townTool(${name}): no town clone was named`);
  const inside = relative(resolve(clone), resolve(root));
  if (!inside.startsWith("..") && !isAbsolute(inside)) {
    throw new Error(`townTool(${name}): the pins (${root}) are inside the clone (${clone}); the office never checks town code against the town's own folder`);
  }
  const pins = readPins(root);
  const rel = name.includes("/") ? name : `tools/${name}`;
  const entry = pins.files[rel];
  if (!entry) throw new TownToolUnpinned(rel, root);
  for (const file of [rel, ...entry.closure]) {
    const pinned = pins.files[file]?.blob;
    if (!pinned) throw new TownToolUnpinned(file, root);
    const found = cloneBlob(join(clone, file));
    if (found !== pinned) throw new TownPinMismatch({ file, pinned, found, townCommit: pins.town_commit, clone });
  }
  return join(root, rel);
}

/** Did the pin stop this (a mismatch, or a module the office never pinned)? A caller answers it by name, never as "the town has no such module". */
export const isPinStop = (e) => e?.code === "TOWN_PIN_MISMATCH" || e?.code === "TOWN_TOOL_UNPINNED";

// What a resident reads when the pin stops a door (the defect is
// `town-pin-mismatch`): the office's own words. What differs, the file, both
// blobs and the clone's path on the box, goes to the office's log, never into an
// answer (POS-568's rule, fault-words.mjs).
export const PIN_STOP_HINT = "the office runs only town code it has reviewed, and the town's copy of the code this act needs is not the copy the office reviewed, so nothing was written. What differs is in the office's log; the office's next release carries the review.";
/** Logs the pin stop's own words and hands back PIN_STOP_HINT for the answer. */
export function pinStopHint(e) {
  console.error(`[town-tool] ${e?.message ?? e}`);
  return PIN_STOP_HINT;
}

/** `import()` of the pinned module, checked as townTool checks it. */
export async function importTownTool(clone, name, opts) {
  return import(pathToFileURL(townTool(clone, name, opts)).href);
}

// ── A TOWN CHECKOUT AT A PAST POSITION (Wright, POS-994, 2026-11-16 08:5x EST) ─
// A snapshot's replay reads the town AT its ledger position (world-snapshot.mjs §
// householdsAt, parcel-room.mjs § houseFactsAt). Today's pin would stop every
// replay of a window whose engine has since changed. So a checkout's OWN engine
// may load, but only when its commit is already inside what the office reviewed:
// the snapshot's sha is the pin's town commit or one of its ancestors
// (`git merge-base --is-ancestor <sha> <pin commit>`, exit 0). And the files that
// load must be that commit's: the module and its relative-import closure, read
// from the checkout, are held to git's blobs at <sha>, so a checkout edited by
// hand never runs. Anything else, a sha after the pin (exit 1) or one git cannot
// place at all (exit 128: the repo lacks the pin commit or the sha), goes through
// the pins as usual: equal loads the pinned copy, different stops by name. An
// unknown answer is never "allowed".

/** The `git merge-base --is-ancestor` exit for sha → the pin's commit: 0 inside the review, 1 after it, 128 git could not tell. */
export function ancestorOfPin(gitRepo, sha, { root = pinRoot() } = {}) {
  const pin = readPins(root).town_commit;
  const r = spawnSync("git", ["-C", gitRepo, "merge-base", "--is-ancestor", String(sha), pin], { stdio: "ignore" });
  return r.status ?? 128;
}

/** Each file's blob at <sha> in gitRepo, or null when that path is not there. */
function blobAt(gitRepo, sha, path) {
  const r = spawnSync("git", ["-C", gitRepo, "rev-parse", "--verify", "-q", `${sha}:${path}`], { encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : null;
}

/**
 * `import()` of the town's `tools/<name>` from a checkout at a past ledger
 * position. `repoAtSha` holds the files that load (the checkout, or a scratch
 * copy of its tools/), `sha` is the commit they are, `gitRepo` the repository
 * that can answer for it (default: repoAtSha). Inside the pin's history and
 * byte-equal to git at <sha>: the checkout's own module. Otherwise: the pins,
 * checked against `repoAtSha` as importTownTool checks a clone.
 */
export async function importTownToolAt(repoAtSha, sha, name, { gitRepo = repoAtSha, root = pinRoot() } = {}) {
  if (!sha) throw new Error(`importTownToolAt(${name}): no sha was named for the checkout at ${repoAtSha}`);
  if (ancestorOfPin(gitRepo, sha, { root }) !== 0) return importTownTool(repoAtSha, name, { root });
  const rel = name.includes("/") ? name : `tools/${name}`;
  const seen = new Set();
  const walk = (p) => {
    if (seen.has(p)) return;
    seen.add(p);
    const at = join(repoAtSha, p);
    const want = blobAt(gitRepo, sha, p);
    const found = existsSync(at) ? gitBlobSha(readFileSync(at)) : null;
    if (!want || found !== want) {
      throw new TownPinMismatch({ file: p, pinned: want ?? "(absent at that commit)", found, townCommit: sha, clone: repoAtSha });
    }
    for (const d of relativeImports(p, readFileSync(at, "utf8"))) walk(d);
  };
  walk(rel);
  return import(pathToFileURL(join(repoAtSha, rel)).href);
}

/**
 * importTownToolAt for a checkout at whatever commit it stands on (its HEAD):
 * the ingests read the town where its clone stands, today's or a past one. A
 * folder git cannot name a commit for is checked against the pins as a clone.
 */
export async function importTownToolAtHead(repo, name, opts = {}) {
  const r = spawnSync("git", ["-C", repo, "rev-parse", "--verify", "-q", "HEAD"], { encoding: "utf8" });
  const sha = r.status === 0 ? r.stdout.trim() : null;
  return sha ? importTownToolAt(repo, sha, name, opts) : importTownTool(repo, name, opts);
}

// The town CLIs whose repo, unnamed, is their own folder's parent. Run from the
// pins, unnamed means `src/town-pins`, and three of their read verbs do NOT
// fail there (`stamp-mint --derive`/`--balances`, `world-stake --escrow` exit 0
// on an empty town: measured on town 2470d732). So the argv is never left to
// the caller's memory: `townToolArgv` always names the clone.
export const REPO_DEFAULTING = new Set([
  "stamp-mint.mjs", "stamp-verify.mjs", "ballot.mjs", "world-stake.mjs",
  "quest-progress.mjs", "epoch-close.mjs", "household-keys.mjs",
]);

/**
 * `[pinned path, ...args]` for a child `node` process, checked as townTool
 * checks it. For a CLI in REPO_DEFAULTING, `--repo <clone>` is appended when
 * absent, and a `--repo` naming anything but the clone is refused: the pin
 * vouches for the code, the clone is the only town it may read.
 */
export function townToolArgv(clone, name, args = [], opts) {
  const path = townTool(clone, name, opts);
  const at = args.indexOf("--repo");
  if (at !== -1 && args[at + 1] !== clone) {
    throw new Error(`townToolArgv(${name}): --repo ${args[at + 1]} is not the clone the pin was checked against (${clone})`);
  }
  const named = at === -1 && REPO_DEFAULTING.has(name) ? [...args, "--repo", clone] : [...args];
  return [path, ...named];
}

// ── THE SHELL'S DOOR ────────────────────────────────────────────────────────
//   node src/town-tool.mjs run <name> --clone <town clone> -- <args…>
// Runs the pinned copy as townToolArgv builds it, stdio passed through, and
// exits with its exit. A mismatch exits 3 with the named sentence on stderr and
// runs nothing, so a unit can tell "the pin stopped this" (3) from the tool's
// own failure. The ferry unit's witness steps go through here.
async function main(argv) {
  const [verb, name] = argv;
  const ci = argv.indexOf("--clone");
  const dd = argv.indexOf("--");
  if (verb !== "run" || !name || ci === -1 || !argv[ci + 1] || dd === -1) {
    console.error("usage: town-tool.mjs run <name> --clone <town clone> -- <args…>");
    return 2;
  }
  let child;
  try { child = townToolArgv(argv[ci + 1], name, argv.slice(dd + 1)); }
  catch (e) { console.error(`[town-tool] ${e.message}`); return 3; }
  const { spawnSync } = await import("node:child_process");
  const r = spawnSync(process.execPath, child, { stdio: "inherit" });
  return r.status ?? 1;
}

// The junction lesson (test/cli-guard.test.mjs): compare real paths, so the entry fires through a link too.
const isMain = (() => {
  if (!process.argv[1]) return false;
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url)); }
})();
if (isMain) process.exit(await main(process.argv.slice(2)));
