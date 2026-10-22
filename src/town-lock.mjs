// town-lock.mjs — the one lane a write takes to the pen (tier 0 of the
// write-path plan; blueprints: the-town-writes-at-once).
//
// Every write verb runs its critical section as a child exec under the ferry's
// flock (linux; direct on dev/test). Until 2026-08-05 each call-site spawned
// that child with execFileSync, which parked the WHOLE office on the child's
// exit: one resident's mark froze every reader at every door for the length of
// a fetch + lint + fold + push. Same lock, same child, same law — but async
// execFile, so the event loop keeps answering readers while a write waits its
// turn in line.
//
// Tier 1 (2026-08-05) narrows the lane without leaving this file: the two
// draft-branch lanes (marks, notes) pass `{ shared: true, alsoLock }` and take a
// SHARED flock on the same town.lock plus an exclusive per-household file, so
// two households write at once while the tick and the crossing — which take
// town.lock exclusively — stay excluded exactly as before. The four
// shared-ledger lanes pass nothing and keep the exclusive lane unchanged.
//
// The flock ceremony and the busy-lock sentence live HERE and nowhere else
// (one file, one writer). Six call-sites each carried their own copy of a 503
// blaming the tick's "couple of minutes" index rebuild — false since the
// 2026-07-30 snapshot-under-lock fix cut the tick's hold to seconds. A 30-second
// lock wait now means the pen is busy with other writes, and that is what the
// bounce says.

import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { basename, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

export const townLockPath = () => process.env.TOWN_LOCK ?? resolve(HERE, "..", "town.lock");
export const useFlock = () => process.platform === "linux" && existsSync("/usr/bin/flock");

// Build the argv for one locked child. Split out from the runner because the
// lock MODE is now the whole tier-1 argument and a claim about it should be
// testable on any platform, not only where /usr/bin/flock exists.
//
//   exclusive (default) — the town-global lane every write took before tier 1,
//     and the lane the shared-ledger execs (walk, stake, gift, world stake)
//     still take. Excludes everything, including the tick and the crossing.
//   shared + alsoLock  — the pooled draft lane. SHARED on town.lock keeps the
//     tick and the ferry excluded (they take it exclusively, and flock's
//     LOCK_SH/LOCK_EX compose on one file) while admitting other draft writes;
//     the per-household file is what those writes exclude each other on.
export function lockArgv(exec, payload, { shared = false, alsoLock = null } = {}, flock = useFlock()) {
  const child = [process.execPath, exec, payload];
  if (!flock) return [child[0], child.slice(1)];
  return ["/usr/bin/flock", [
    ...(shared ? ["-s"] : []), "-w", "30", townLockPath(),
    ...(alsoLock ? ["/usr/bin/flock", "-w", "30", alsoLock] : []),
    ...child,
  ]];
}

// Run one exec script under the town lock, off the event loop. Resolves with
// the child's stdout; rejects with the child's error carrying .status (exit
// code) and .stderr — the same shape execFileSync threw, so call-sites keep
// their own bounce grammar.
//
// Every run logs `[town-lock] <exec> total=<ms>`; an exec that stamps its own
// `[timing] child=<ms> …` stderr line (leave-exec does) makes the decomposition
// readable in one place: total − child ≈ spawn + lock wait. A pooled lane adds
// `lease=<ms> slot=wt-<n>` through `note`, so the fourth term — how long this
// write waited for a worktree — is readable on the same line. These lines ARE
// the write-path instrumentation.
export function execUnderTownLock(exec, payload, env, { note = "", ...lock } = {}) {
  const [file, args] = lockArgv(exec, payload, lock);
  const t0 = performance.now();
  return new Promise((res, rej) => {
    execFile(file, args, { encoding: "utf8", env }, (error, stdout, stderr) => {
      const total = Math.round(performance.now() - t0);
      // the child's stderr is its log (timing + push-pending lines); surface it —
      // execFileSync used to swallow it on success
      if (!error && String(stderr ?? "").trim()) console.error(String(stderr).trimEnd());
      console.error(`[town-lock] ${basename(exec)} total=${total}ms${note ? ` ${note}` : ""}${error ? ` exit=${error.code ?? error.signal}` : ""}`);
      if (error) {
        if (typeof error.code === "number") error.status = error.code;
        error.stderr = stderr;
        return rej(error);
      }
      res(stdout);
    });
  });
}

// flock -w 30 gave up: exit 1 with silent stderr (a crashed exec prints a stack).
export function lockTimedOut(e) {
  return e?.status === 1 && !String(e.stderr ?? "").trim();
}

export const LOCK_BUSY = {
  code: 503,
  defect: "the office pen is busy — other writes hold the town lock",
  hint: "nothing was recorded; the pen frees in seconds — try again",
};

// ── THE LOCK HELD AROUND AN IN-PROCESS SECTION (POS-666) ────────────────────
//
// The execs above run their whole critical section in a child, because they
// write the clone. A letter's amendment and withdrawal write only the town log
// (a store row), and what they must not do is race the CROSSING: the drain
// reads the pending rows and replays them under town.lock (postmark-ferry
// .service holds it exclusively for the whole chain), so a change written
// after that read would be told "amended" and then sail as it was. So the door
// holds town.lock SHARED, the draft lanes' mode, for the length of its own read
// and write: the crossing and the tick are excluded, other shared writers are
// not.
//
// The holder is a child that takes the lock, prints one word, then waits on its
// stdin. The section runs here, in this process, on the office's own store
// connections, and is handed an AbortSignal. Closing stdin ends the child and
// frees the lock, and so does this process dying.
//
// ── BOUNDED, SO A HUNG SECTION NEVER FAILS A CROSSING (review of #742) ──────
//
// The ferry waits `flock -w 300` for town.lock. A section that hung on a store
// call would hold the lock shared past that wait and the crossing would fail.
// So the hold is bounded twice: at `holdSec` (60 s) this process aborts the
// section's signal, lets the lock go and refuses; and the child itself lets go
// at `holdSec + 30` (coreutils `timeout`), whatever this process is doing.
// Both sit well under 300 s. A section must check its signal before it writes
// (`signal.aborted`), so nothing it writes lands after the lock is let go.
//
// ── THE REFUSALS SAY WHICH THING HAPPENED ───────────────────────────────────
//
// flock exits 1 when the wait runs out: something holds town.lock (a crossing,
// the keep tick, or an exclusive write such as a walk or a stake), and the
// caller's `busy` words say so. Any other exit, or a child that will not start,
// is the office failing to take the lock at all (`unlockable`), never a
// crossing. A section that outran its bound is `slow`. In all three, nothing the
// section had not yet written was written. Off linux (dev, tests) there is no
// flock and the section runs directly, as lockArgv's execs do, with the bound.
export const HOLD_SEC = 60;

export const LOCK_UNLOCKABLE = {
  code: 503,
  defect: "the office could not take the town lock, and nothing was changed",
  hint: "this is the office's fault, not your act's — try again in a few minutes",
};

export const LOCK_HELD_TOO_LONG = {
  code: 503,
  defect: "the office could not finish this in time and let go of the town lock",
  hint: "nothing is written after the lock is let go; read back what stands before you try again",
};

export function heldLockArgv({ shared = true, waitSec = 30, holdSec = HOLD_SEC } = {}) {
  return ["/usr/bin/flock", [...(shared ? ["-s"] : []), "-w", String(waitSec), townLockPath(),
    "/bin/sh", "-c", `echo held; exec timeout ${holdSec + 30} cat >/dev/null`]];
}

export async function withTownLockHeld(fn, {
  shared = true, waitSec = 30, holdSec = HOLD_SEC, flock = useFlock(), spawnImpl = spawn,
  busy = LOCK_BUSY, unlockable = LOCK_UNLOCKABLE, slow = LOCK_HELD_TOO_LONG,
} = {}) {
  const refusal = (r) => Object.assign(new Error(r.defect), r);
  const ac = new AbortController();
  const bounded = (release) => new Promise((res, rej) => {
    const t = setTimeout(() => { ac.abort(); release(); rej(refusal(slow)); }, holdSec * 1000);
    Promise.resolve().then(() => fn({ signal: ac.signal })).then(
      (v) => { clearTimeout(t); res(v); },
      (e) => { clearTimeout(t); rej(e); });
  });
  if (!flock) return bounded(() => {});
  const [file, args] = heldLockArgv({ shared, waitSec, holdSec });
  const child = spawnImpl(file, args, { stdio: ["pipe", "pipe", "ignore"] });
  await new Promise((res, rej) => {
    let out = "";
    child.stdout.on("data", (d) => { out += d; if (out.includes("held")) res(); });
    // an exit before "held": 1 is flock's wait running out; anything else is the lock not taken at all
    child.on("exit", (code) => rej(refusal(code === 1 ? busy : unlockable)));
    child.on("error", () => rej(refusal(unlockable)));
  });
  const release = () => { try { child.stdin.end(); } catch { /* already gone */ } };
  try { return await bounded(release); }
  finally { release(); }
}
