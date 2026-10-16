// clone-sparse.mjs — the office's clones check out only what is read (POS-652, Darko
// 2026-10-15 19:51: "sparse checkout 100% ... We should never be checking out the full
// town clone at this point").
//
// THE COST IT REMOVES (measured 2026-10-15): every office pool tree nested a full town
// clone (16,949 files, 14,362 of them letters) and a full world clone (8,471), against
// the office's own 1,579; the sandbox and the playground wrote fresh full clones on every
// setup or reset. Windows Defender scans each written file, and that evening it pinned
// the machine while the meeps' rounds ran.
//
// TWO SETS, ONE HOME EACH.
//   · The pinned clones (town-clone/, world-clone/ at test/clone-pins.json's shas): the
//     patterns in test/clone-sparse.json, each naming who reads it, measured from a full
//     CI suite. CI (.github/scripts/suite-clones.sh), the pool's provisioning
//     (G:/Postmark/pool/claims-lib.mjs) and test/clone-sparse.test.mjs read them here.
//   · The stand-ins (test/helpers/dev-target.mjs: the dev rehearsal's, tools/sandbox.mjs's
//     and so the playground's scratch clones): standinPatterns() below. A stand-in runs a
//     whole office that WRITES, and git refuses `git add` of a new file outside a clone's
//     patterns, so a stand-in keeps the whole tree except what was written before it and
//     is never written again: the town's letters dated before the clone, and the world's
//     STATE/log/*.meta.json of the crossings before its newest two.
// Each clone records which set it holds in its own config (`postmark.sparse`): `town` or
// `world` for a pinned clone, which test/helpers/sparse-guard.mjs guards, `standin-town`
// or `standin-world` for a stand-in, which it leaves alone.
//
// The objects are always whole: only the working tree is sparse. `git show <sha>:<path>`,
// tags and history read exactly as before, outside the patterns too.
//
//   node test/helpers/clone-sparse.mjs patterns town|world       the pinned set, one per line
//   node test/helpers/clone-sparse.mjs apply <clone> town|world  make a clone sparse (in place)
//   node test/helpers/clone-sparse.mjs check <clone> town|world  exit 1, naming the gap, unless it is

import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const OFFICE = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const SPARSE_FILE = join(OFFICE, "test", "clone-sparse.json");
export const CLONES = Object.freeze(["town", "world"]);

const git = (repo, args, input) => execFileSync("git", ["-C", repo, ...args],
  { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, input, stdio: [input == null ? "ignore" : "pipe", "pipe", "pipe"] }).trim();

/** test/clone-sparse.json, parsed (an office checkout's own, by default). */
export function readSparse(officeRoot = OFFICE) {
  return JSON.parse(readFileSync(join(officeRoot, "test", "clone-sparse.json"), "utf8"));
}

/** The pinned set's patterns for one clone, in order. */
export function patternsOf(which, spec = readSparse()) {
  if (!CLONES.includes(which)) throw new Error(`a clone is town or world, not ${which}`);
  return spec[which].patterns.map((p) => p.pattern);
}

/** The entries whose absence from a directory listing is measured safe, for one clone. */
export function unlistedOf(which, spec = readSparse()) {
  return (spec[which]?.unlisted ?? []).map((u) => u.entry);
}

/** A glob over one repo-relative path: `*` stays within a path segment. PURE. */
export function globMatch(glob, path) {
  const re = new RegExp(`^${glob.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join("[^/]*")}$`);
  return re.test(path);
}

/**
 * Make `clone` sparse with `patterns` (non-cone), and record `set` in its config. On a
 * full checkout this removes the files outside the patterns from the working tree, in
 * place: nothing is re-cloned or fetched, and the HEAD does not move.
 */
export function applySparse(clone, patterns, set) {
  git(clone, ["sparse-checkout", "set", "--no-cone", "--stdin"], patterns.join("\n") + "\n");
  git(clone, ["config", "postmark.sparse", set]);
}

/** What a clone holds: whether it is sparse, its patterns, the set its config names. */
export function sparseState(clone) {
  const get = (k) => { try { return git(clone, ["config", "--get", k]); } catch { return null; } };
  const sparse = get("core.sparseCheckout") === "true";
  let patterns = [];
  if (sparse) {
    try {
      const file = resolve(clone, git(clone, ["rev-parse", "--git-path", "info/sparse-checkout"]));
      patterns = readFileSync(file, "utf8").split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
    } catch {}
  }
  return { sparse, cone: get("core.sparseCheckoutCone") === "true", patterns, set: get("postmark.sparse") };
}

/** Null when `clone` holds exactly the pinned set for `which`; else the gap, as a sentence. */
export function sparseProblem(clone, which, spec = readSparse()) {
  const want = patternsOf(which, spec);
  const s = sparseState(clone);
  if (!s.sparse) return `${which}-clone is a full checkout, not sparse per test/clone-sparse.json`;
  if (s.cone) return `${which}-clone is a cone-mode sparse checkout; test/clone-sparse.json's patterns are non-cone`;
  if (s.patterns.join("\n") !== want.join("\n")) return `${which}-clone's sparse patterns are not test/clone-sparse.json's ${which} set`;
  if (s.set !== which) return `${which}-clone's config names the set ${s.set ?? "(none)"}, not ${which} (git config postmark.sparse ${which})`;
  return null;
}

// ── the stand-ins ────────────────────────────────────────────────────────────

/** YYYY-MM-DD, `days` before `now`, in UTC. PURE. */
const dayBefore = (now, days) => new Date(now.getTime() - days * 86400000).toISOString().slice(0, 10);

/**
 * A stand-in's patterns for a clone of `source` (its HEAD). The whole tree, less:
 *   town  · each letter in a WHITE_PAGES/<room>/inbox/ whose name carries a date more than
 *           two days before `now` (a letter the office writes is named by the day it is
 *           sent, so it always falls inside the patterns and `git add` takes it);
 *   world · STATE/log/<N>.meta.json and <N>.*.meta.json for every crossing N but the
 *           newest two in the source (the drain writes the current crossing's).
 * Each exclusion is a whole name or a date, never a directory, so a stand-in's office can
 * write anywhere it could before.
 */
export function standinPatterns(which, source, { now = new Date() } = {}) {
  if (which === "town") {
    const cutoff = dayBefore(now, 2);
    const dates = new Set();
    for (const p of git(source, ["ls-tree", "-r", "--name-only", "HEAD", "WHITE_PAGES"]).split("\n")) {
      const m = /^WHITE_PAGES\/[^/]+\/inbox\/([^/]+)/.exec(p);
      const d = m && /(\d{4}-\d{2}-\d{2})/.exec(m[1]);
      if (d && d[1] < cutoff) dates.add(d[1]);
    }
    return ["/*", ...[...dates].sort().map((d) => `!/WHITE_PAGES/*/inbox/*${d}*`)];
  }
  if (which === "world") {
    const crossings = new Set();
    for (const p of git(source, ["ls-tree", "--name-only", "HEAD", "STATE/log/"]).split("\n")) {
      const m = /^STATE\/log\/(\d+)\.(?:.*\.)?meta\.json$/.exec(p);
      if (m) crossings.add(Number(m[1]));
    }
    const sorted = [...crossings].sort((a, b) => a - b);
    return ["/*", ...sorted.slice(0, -2).flatMap((n) => [`!/STATE/log/${n}.meta.json`, `!/STATE/log/${n}.*.meta.json`])];
  }
  throw new Error(`a clone is town or world, not ${which}`);
}

/**
 * A stand-in clone of `source` at `dest`: `git clone --local --no-checkout`, its
 * stand-in patterns, then the checkout. Answers `dest`, on the source's HEAD.
 */
export function standinClone(which, source, dest, { now } = {}) {
  execFileSync("git", ["-c", "core.autocrlf=false", "clone", "--local", "--quiet", "--no-checkout", "--config", "core.autocrlf=false", source, dest]);
  applySparse(dest, standinPatterns(which, source, { now }), `standin-${which}`);
  git(dest, ["-c", "advice.detachedHead=false", "checkout", "-q", "--detach", "HEAD"]);
  return dest;
}

// ── the CLI ──────────────────────────────────────────────────────────────────

const isMain = (() => { try { return realpathSync(process.argv[1] ?? "") === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } })();
if (isMain) {
  const [cmd, a, b] = process.argv.slice(2);
  const usage = "usage: clone-sparse.mjs patterns town|world | apply <clone> town|world | check <clone> town|world";
  try {
    if (cmd === "patterns" && CLONES.includes(a)) process.stdout.write(patternsOf(a).join("\n") + "\n");
    else if (cmd === "apply" && a && CLONES.includes(b)) { applySparse(a, patternsOf(b), b); console.log(`${a}: sparse per test/clone-sparse.json's ${b} set`); }
    else if (cmd === "check" && a && CLONES.includes(b)) {
      const problem = sparseProblem(a, b);
      if (problem) { console.error(`${a}: ${problem}`); process.exitCode = 1; }
      else console.log(`${a}: sparse per test/clone-sparse.json's ${b} set`);
    } else { console.error(usage); process.exitCode = 2; }
  } catch (e) { console.error(`clone-sparse: ${e.message}`); process.exitCode = 1; }
}
