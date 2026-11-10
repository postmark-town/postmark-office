// cache-lifecycle.mjs — the office prunes its OWN disposable caches under tmpdir (POS-989).
//
// Two caches grow one directory per world revision and nothing ever removed one:
//   · `<tmp>/postmark-settlement-town/<40-hex sha>`   a sparse town clone (world-settlement.mjs § townAtSha)
//   · `<tmp>/postmark-engine/<sha>--<subdir>`          extracted engine source (world-branches.mjs § materializeAtRef)
// On 2026-11-10 the first held 7.3 G (71 dirs since 10-14) and the disk sentinel barked at 87%. A directory of either is
// DISPOSABLE: its name is its key, so a removed one is rebuilt on the next ask. This file keeps what is recent or in use
// and removes the rest, whole. It is the one small lifecycle both owners share; it is not a framework and runs no daemon.
//
// IT PRUNES ONLY WHAT IT OWNS. The entries (and their leases) live in a versioned subfolder of each existing root,
// `<root>/lease-v1/<key>` (`ownedRoot`), with the same sha/subdir keys. An older helper (a staged or one-shot process on the
// same host) reads `<root>/<key>` and takes no lease, so those paths are never read, copied or pruned here, and a seven-day
// grace is never claimed to be liveness for them. Callers use the path a lookup returns, not the layout.
//
// WHAT "RECENT" AND "IN USE" MEAN HERE, AND WHY AGE ALONE IS NOT ENOUGH
//   recent   `<root>/.cache-state/<name>.used`'s mtime, touched on every lookup (throttled), within RETENTION_MS (seven days).
//            An entry that has never been touched is dated by its own marker file (`.git`, `.materialized`).
//   in use   a LEASE: `<root>/.cache-state/<name>.lease.<pid>.<n>`, created before a reader touches an entry and removed when
//            it is done (a scoped read, `leaseEntry`'s release) or kept for the life of the process (`pinEntry`: an imported engine module
//            can load a sibling file long after the lookup that found it). A lease of a live pid keeps its entry.
//   Another Office process or worker sharing the root is protected by those files, not by the pruner remembering a sha: the
//   pruner and a reader never share memory.
//
// THE HANDSHAKE (two flags, each side writes its own and then reads the other's, so at least one of them sees the other):
//   reader  lease created → no live CLAIM on the entry → entry's marker still there → read.  (a claim or a missing marker
//           releases the lease and tries again, which rebuilds the entry)
//   pruner  CLAIM created (O_EXCL) → no live lease → still stale → rename the entry away (atomic) → remove it → drop the claim.
// A claim or lease of a dead pid is stale and ignored (and removed). Nothing is deleted that is not a well-formed entry name
// holding its marker as a regular file, inside the root, and not a link: unknown names, links and anything else stay as found.
//
// Dependency-free (node:fs, node:path only), so a test can import a MUTATED COPY of this file and show its oracle red.

import { closeSync, constants, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, utimesSync, writeSync } from "node:fs";
import { rm } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { threadId } from "node:worker_threads";

export const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
export const STATE_DIR = ".cache-state";
/** The versioned subfolder of an existing cache root that holds the entries this file prunes; an older helper's paths beside it are never touched. */
export const LEASE_NAMESPACE = "lease-v1";
export const ownedRoot = (root) => join(root, LEASE_NAMESPACE);
const TOUCH_EVERY_MS = 60 * 60 * 1000;       // a lookup refreshes `.used` at most this often (a stat per call, a write per hour)
const CLAIM_STALE_MS = 10 * 60 * 1000;       // a pruner's claim older than this is a crashed pruner's
const TOMBSTONE_STALE_MS = 60 * 60 * 1000;
const WAIT_MS = 25;
const WAITS = 40;

/** A cache family: how its entries are named and which file inside an entry proves it is a finished one. */
export const TOWN_CLONES = Object.freeze({ name: "town clone", pattern: /^[0-9a-f]{40}$/, marker: ".git" });
export const ENGINE_CHECKOUTS = Object.freeze({ name: "engine checkout", pattern: /^[0-9a-f]{40}--[\w.-]+$/, marker: ".materialized" });

const pidAlive = (pid) => {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e?.code === "EPERM"; }
};
const stateDir = (root) => join(root, STATE_DIR);
const usedFile = (root, name) => join(stateDir(root), `${name}.used`);
const claimFile = (root, name) => join(stateDir(root), `${name}.claim`);
const leasePrefix = (name) => `${name}.lease.`;
const mtimeOf = (path) => { try { return statSync(path).mtimeMs; } catch { return null; } };
const sleepSync = (ms) => { try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch { /* no wait available: spin once */ } };

/** The pid a state file names (`<name>.lease.<pid>.<n>`, `<name>.claim` holding its pid), or null. */
const leasePid = (file, name) => { const m = new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.lease\\.(\\d+)\\.\\d+\\.[0-9a-f]+$`).exec(file); return m ? Number(m[1]) : null; };

function claimLive(root, name, now) {
  const file = claimFile(root, name);
  const m = mtimeOf(file);
  if (m === null) return false;
  let pid = null;
  try { pid = Number(readFileSync(file, "utf8").trim()); } catch { /* unreadable: judged by age alone */ }
  if ((pid && pidAlive(pid)) && now - m < CLAIM_STALE_MS) return true;
  try { unlinkSync(file); } catch { /* another reader got there */ }
  return false;
}
/** The live leases on an entry: the pids that hold it. Leases of dead pids are removed as they are found. */
export function liveLeases(root, name) {
  const dir = stateDir(root);
  let files = [];
  try { files = readdirSync(dir); } catch { return []; }
  const pids = [];
  for (const f of files) {
    if (!f.startsWith(leasePrefix(name))) continue;
    const pid = leasePid(f, name);
    if (pid !== null && pidAlive(pid)) pids.push(pid);
    else { try { unlinkSync(join(dir, f)); } catch { /* gone already */ } }
  }
  return pids;
}

const pinned = new Set();   // `${root}\0${name}` this process holds for its whole life

/**
 * A lease on an entry, taken BEFORE any read of it. Returns `release()`; throws nothing a caller must handle: when the entry
 * is gone or a pruner is claiming it the lease is dropped and `null` is returned, and the caller rebuilds the entry and asks again.
 */
export function leaseEntry(root, name, spec, { now = Date.now } = {}) {
  mkdirSync(stateDir(root), { recursive: true });
  // UNIQUE ACROSS PROCESSES AND ACROSS WORKER ISOLATES: the Office's read workers are worker_threads, which share a pid and
  // not a module-local counter, so the name carries the thread id and a random token; a release removes only ITS file.
  const file = join(stateDir(root), `${leasePrefix(name)}${process.pid}.${threadId}.${randomBytes(6).toString("hex")}`);
  const fd = openSync(file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o644);
  try { writeSync(fd, String(process.pid)); } finally { closeSync(fd); }
  const drop = () => { try { unlinkSync(file); } catch { /* already gone */ } };
  for (let i = 0; i < WAITS && claimLive(root, name, now()); i += 1) sleepSync(WAIT_MS);
  if (claimLive(root, name, now())) { drop(); return null; }
  if (!markerPresent(join(root, name), spec)) { drop(); return null; }
  return drop;
}

/** The process-lifetime form: held until this process exits (its pid then dies and the lease is stale). Once per process per entry. */
export function pinEntry(root, name, spec) {
  const key = `${root}\0${name}`;
  if (pinned.has(key)) return true;
  const release = leaseEntry(root, name, spec);
  if (!release) return false;
  pinned.add(key);
  return true;
}

function markerPresent(dir, spec) {
  try { return lstatSync(join(dir, spec.marker)).isFile() || (spec.marker === ".git" && statSync(join(dir, spec.marker)).isDirectory()); }
  catch { return false; }
}

/** Mark an entry as used now. A stat per call; a write at most once an hour. */
export function touchUsed(root, name, { now = Date.now } = {}) {
  const file = usedFile(root, name);
  const was = mtimeOf(file);
  if (was !== null && now() - was < TOUCH_EVERY_MS) return;
  try {
    mkdirSync(stateDir(root), { recursive: true });
    if (was === null) closeSync(openSync(file, "a"));
    const at = new Date(now());
    utimesSync(file, at, at);
  } catch { /* a bookkeeping failure never fails a read: the entry is then dated by its marker */ }
}

/** When an entry was last used: its `.used` stamp, else its marker's own mtime (an entry from before this file). */
function lastUsed(root, name, spec) {
  const used = mtimeOf(usedFile(root, name));
  const made = mtimeOf(join(root, name, spec.marker));
  return Math.max(used ?? 0, made ?? 0) || null;
}

/**
 * Remove stale, unused entries of one cache family under `root`, whole. Returns what it did. Never throws for a cache it
 * cannot read: an unreadable root prunes nothing.
 *   removed  entries deleted          kept  entries left, with the reason
 */
export async function pruneCache(root, spec, { now = Date.now, retentionMs = RETENTION_MS } = {}) {
  const result = { removed: [], kept: [], swept: [] };
  let names;
  try { names = readdirSync(root); } catch { return result; }
  const t = now();
  for (const name of names) {
    // our own leftovers: a tombstone or a half-made clone of a pruner / builder that died
    if (new RegExp(`\\.(pruning|tmp)-(\\d+)-\\d+$`).test(name) && spec.pattern.test(name.replace(/\.(pruning|tmp)-\d+-\d+$/, ""))) {
      const dead = Number(/-(\d+)-\d+$/.exec(name)?.[1]);
      const full = join(root, name);
      const m = mtimeOf(full);
      if (m !== null && t - m > TOMBSTONE_STALE_MS && !pidAlive(dead)) { await rm(full, { recursive: true, force: true }).catch(() => {}); result.swept.push(name); }
      continue;
    }
    if (!spec.pattern.test(name)) continue;                       // not an entry of this family: untouched
    const full = join(root, name);
    let st;
    try { st = lstatSync(full); } catch { continue; }
    if (st.isSymbolicLink() || !st.isDirectory()) { result.kept.push({ name, why: "not a plain directory" }); continue; }
    if (!markerPresent(full, spec)) { result.kept.push({ name, why: "no finished marker (being built, or not ours)" }); continue; }
    const used = lastUsed(root, name, spec);
    if (used === null || t - used <= retentionMs) { result.kept.push({ name, why: "recent" }); continue; }
    if (liveLeases(root, name).length) { result.kept.push({ name, why: "in use" }); continue; }
    // THE CLAIM, then the second look: a reader that leased after the first look is seen now, or sees this claim itself
    const claim = claimFile(root, name);
    try {
      mkdirSync(stateDir(root), { recursive: true });
      const fd = openSync(claim, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o644);
      try { writeSync(fd, String(process.pid)); } finally { closeSync(fd); }
    } catch { result.kept.push({ name, why: "claimed by another pruner" }); continue; }
    try {
      if (liveLeases(root, name).length) { result.kept.push({ name, why: "in use" }); continue; }
      const again = lastUsed(root, name, spec);
      if (again === null || now() - again <= retentionMs) { result.kept.push({ name, why: "recent" }); continue; }
      const away = join(root, `${name}.pruning-${process.pid}-${t}`);
      try { renameSync(full, away); } catch { result.kept.push({ name, why: "could not be claimed" }); continue; }
      await rm(away, { recursive: true, force: true }).catch(() => {});
      for (const f of [usedFile(root, name)]) { try { unlinkSync(f); } catch { /* none */ } }
      result.removed.push(name);
    } finally { try { unlinkSync(claim); } catch { /* gone */ } }
  }
  return result;
}

const lastRun = new Map();
/** Prune in the background, at most once an hour per root per process: a growth event (a new entry) asks, nothing waits for it. */
export function pruneSoon(root, spec, { every = TOUCH_EVERY_MS, now = Date.now } = {}) {
  const t = now();
  if (t - (lastRun.get(root) ?? 0) < every) return null;
  lastRun.set(root, t);
  const run = pruneCache(root, spec, { now }).catch(() => null);
  return run;
}
export const __resetPruneSoonForTest = () => lastRun.clear();
