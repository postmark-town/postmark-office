// clone-fresh.mjs — THE ONE PRE-WRITE FRESHENING OF THE TOWN CLONE, AND THE NAMED REFUSAL WHEN IT CANNOT BE DONE (POS-382; postmark-office#252).
//
// Every write that lands a file on the town clone begins by bringing the clone up to the town: `git pull --rebase`. Git refuses that on any uncommitted change to
// a tracked file ("cannot pull with rebase: You have unstaged changes"), and each write let the refusal escape as the machinery's own: a raw 500 on a stake, with
// the resident left to wonder whether the stamps were spent (neth, 2026-09-28, twice; the household acts of 2026-11-09 at 00:01Z). Seventeen call sites spelled the
// pull; this is the one place that does, and the one refusal it gives.
//
//   · THE CLONE IS READ BEFORE ANYTHING IS DONE TO IT. Tracked dirt, or a rebase/merge left half-way, is what the pull would refuse on (untracked files are not:
//     a pull does not refuse on them, and the files the office keeps beside the tree must never bark). The same definition tools/clone-state.mjs gives the roll-call.
//   · A WRITER IN FLIGHT IS WAITED FOR, A CLONE THAT STAYS DIRTY IS REFUSED. The execs hold the town lock, so every writer that takes it has finished; what can still
//     be mid-write is one that does not. The dirt gets a short, bounded wait (WAIT_MS) to clear. Dirt that is still there is not a write in flight: it is abandoned.
//   · THE REFUSAL IS A 503 THAT SAYS NOTHING WAS WRITTEN, and it is true: this runs first inside the pen's transaction, before the write touches the clone, the
//     ledger, the store or a balance. The dirt is NEVER touched: no stash, no reset, no rebase of signed lines. A person tends it, and the roll-call (the site
//     sentinel's town_clone probe, tools/site-sentinel.mjs) already says so after its grace.
//   · A PULL THAT REFUSES ON DIRT THE READ MISSED (a writer slipped in between the read and the pull) is the same refusal, not a trip. Any other pull failure
//     (the network, a conflict) is the machinery's, as it always was.

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

export const NEEDS_TENDING = "needs-tending";

/** How long an in-flight writer outside the town lock is waited for before the dirt is called abandoned. Measured: a pen write's write-then-commit is a fraction of a second. */
export const WAIT_MS = 6_000;
const STEP_MS = 200;

const DEFECT = "the office's town copy needs tending; nothing was written";
const HINT = "the office's copy of the town record has changes it cannot write over, so this request was refused before anything was recorded: nothing was written and no stamps moved. A keeper has been shown it on the roll-call; try again once the copy is tended";

/** The refusal's defect, for a caller that has to tell it from another 503 (world-stake.mjs takes back a promotion it had already made). */
export const TENDING_DEFECT = DEFECT;

/**
 * A READ-ONLY LOOK, FOR A DOOR THAT WRITES BEFORE IT SPAWNS THE EXEC: the typed refusal when the clone already holds dirt a pull would refuse on, else null. It waits for
 * nothing and touches nothing, so a door can say the named 503 BEFORE its own first write (world-stake promotes a draft onto the docket ahead of the ledger exec). The exec
 * still freshens under the lock and still decides; this only keeps the door from writing what the exec will then refuse. Only when the office pushes.
 */
export function tendingBefore(clone) {
  if (process.env.TOWN_PUSH !== "1") return null;
  let dirt;
  try { dirt = cloneDirt(clone); } catch { return null; }   // a clone the read cannot see is the exec's to judge, as it always was
  return dirt.length ? needsTendingError(dirt) : null;
}

/** The typed refusal (code 503, `pen: NEEDS_TENDING`): the bounce vocabulary every door and exec already turns into an answer. `dirt` is for the log, never the answer. */
export const needsTendingError = (dirt = []) => Object.assign(new Error(DEFECT), { code: 503, pen: NEEDS_TENDING, defect: DEFECT, hint: HINT, dirt });
export const isNeedsTending = (e) => e?.pen === NEEDS_TENDING;

const git = (clone, args, opts = {}) => execFileSync("git", ["-C", clone, "--no-optional-locks", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts });

/**
 * What a `pull --rebase` would refuse on: every tracked path with uncommitted changes (modified, staged, deleted, conflicted), and a rebase or merge left half-way
 * (as `rebase-merge`, `rebase-apply` or MERGE_HEAD). Read-only (`--no-optional-locks`: a plain status rewrites the index and would hold the lock a write needs).
 * Untracked files are not read. Returns the paths (a half-way operation is named by its marker); empty when the clone is clean.
 */
export function cloneDirt(clone) {
  const out = git(clone, ["status", "--porcelain=v1", "-z", "--untracked-files=no"]);
  const paths = out.split("\0").filter(Boolean).map((entry) => entry.slice(3));
  const gitDir = resolve(clone, git(clone, ["rev-parse", "--git-dir"]).trim());
  for (const marker of ["rebase-merge", "rebase-apply", "MERGE_HEAD"]) if (existsSync(join(gitDir, marker))) paths.push(`.git/${marker}`);
  return paths;
}

const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
// the text git's pull gives when dirt (or a half-way operation) stops it
const DIRT_REFUSAL = /unstaged changes|uncommitted changes|index contains uncommitted|already a rebase|rebase-merge|rebase-apply|you have unmerged|cannot pull with rebase/i;

/**
 * Bring the town clone up to the town before a write, or refuse by name. Sync, because the pen's transaction callbacks are. `waitMs`/`sleep` are for a test.
 * Call it FIRST inside the write's transaction; it touches nothing but the pull itself.
 */
export function freshenClone(clone, { waitMs = Number(process.env.TOWN_CLEAN_WAIT_MS ?? WAIT_MS), sleep = sleepSync } = {}) {
  const deadline = Date.now() + Math.max(0, waitMs);
  let dirt = cloneDirt(clone);
  while (dirt.length && Date.now() < deadline) { sleep(STEP_MS); dirt = cloneDirt(clone); }
  if (dirt.length) throw needsTendingError(dirt);
  try {
    git(clone, ["pull", "--rebase", "-q"]);
  } catch (e) {
    if (DIRT_REFUSAL.test(String(e?.stderr ?? e?.message ?? ""))) throw needsTendingError(cloneDirt(clone));
    throw e;
  }
}

/** The pull every writer does when the office pushes (TOWN_PUSH=1): freshen, or refuse by name. With no push there is no remote to catch up with. */
export const freshenIfPush = (clone) => { if (process.env.TOWN_PUSH === "1") freshenClone(clone); };

/**
 * What an exec does at its pull: freshen, or ANSWER the refusal and stop. The refusal is its one JSON line (the answer the door reads, exit 0), logged with the dirt to its own
 * stderr; it comes before the write has touched anything, so there is nothing for the pen's undo to put back. Any other failure is the machinery's trip, as before.
 */
export function freshenExec(clone) {
  try { freshenIfPush(clone); }
  catch (e) {
    if (!isNeedsTending(e)) throw e;
    console.error(`[clone-fresh] refused: the town clone has ${e.dirt?.length ?? 0} path(s) a pull cannot write over: ${(e.dirt ?? []).slice(0, 8).join(", ")}`);
    console.log(JSON.stringify({ error: { code: e.code, defect: e.defect, hint: e.hint } }));
    process.exit(0);
  }
}
