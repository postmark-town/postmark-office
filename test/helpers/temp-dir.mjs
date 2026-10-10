// temp-dir.mjs — a test's scratch folder, removed when the test file's process ends.
//
// A test that makes its town, its ledger or its clone in `mkdtempSync(join(tmpdir(), …))`
// and never removes it leaves one folder per run; on 10-09, 72,921 of them were swept from
// G:/temp (POS-479). `tempDir(prefix)` makes the same folder and removes it, with
// everything in it, when the process exits: each file under `node --test` is its own
// process, so that is the file's teardown, after every test and hook in it. A process
// killed outright (taskkill /F) runs no exit handler; its folders are what is left.
//
//   import { tempDir } from "./helpers/temp-dir.mjs";
//   const repo = tempDir("stripe-town-");
//
// THE TEARDOWN RACE (POS-419, 2026-10-09). Four files went red on CI in one day,
// on PRs that never touched them, with the same line: `ENOTEMPTY: directory not
// empty, rmdir '/tmp/<scratch>/…/.git/objects'` (hydrate-bounty, world-pool,
// traffic-snapshot, world2-replay-ingest). On Linux, a commit or a push into a
// repo runs git's `gc --auto` / `maintenance run --auto` DETACHED: the git
// command returns while its background child is still writing packs into
// objects/, and the test's rmSync races it. Windows git cannot detach, which is
// why none of them is red here. Two parts, both in this one module:
//   1. On import, this process's git (and every child that inherits the env)
//      runs that maintenance in the FOREGROUND (gc.autoDetach and
//      maintenance.autoDetach false, through GIT_CONFIG_COUNT), so the command
//      that wrote the repo has finished with it when it returns.
//   2. `removeTempDir(dir, { children })` waits for the children it is handed to
//      exit, then removes with retries; `removeTempDirSync(dir)` is the same
//      removal for a synchronous after(). Neither throws: a folder that still
//      cannot go is named on stderr, never a red on the test that used it.

import { mkdtempSync, rmSync } from "node:fs";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";

const FOREGROUND = [["gc.autoDetach", "false"], ["maintenance.autoDetach", "false"]];
function gitInForeground(env = process.env) {
  const n = Number(env.GIT_CONFIG_COUNT ?? 0) || 0;
  for (let i = 0; i < n; i++) if (env[`GIT_CONFIG_KEY_${i}`] === FOREGROUND[0][0]) return; // already (an inheriting child)
  FOREGROUND.forEach(([k, v], i) => { env[`GIT_CONFIG_KEY_${n + i}`] = k; env[`GIT_CONFIG_VALUE_${n + i}`] = v; });
  env.GIT_CONFIG_COUNT = String(n + FOREGROUND.length);
}
gitInForeground();

/** Remove a scratch dir now, with retries; a folder that still cannot go is named, not thrown. */
export function removeTempDirSync(dir) {
  try { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
  catch (e) { console.error(`[temp-dir] left ${dir} (${e.code ?? e.message})`); }
}

/** Remove a scratch dir once every child handed in has exited (a child still writing there is the race). */
export async function removeTempDir(dir, { children = [] } = {}) {
  await Promise.all(children.filter((c) => c && c.exitCode === null && c.signalCode === null).map((c) => once(c, "exit")));
  removeTempDirSync(dir);
}

const made = [];
let hooked = false;

function removeAll() {
  for (const dir of made.splice(0)) removeTempDirSync(dir);
}

/** `mkdtempSync(join(tmpdir(), prefix))`, removed when this process exits. */
export function tempDir(prefix) {
  if (!hooked) { process.on("exit", removeAll); hooked = true; }
  const dir = mkdtempSync(join(tmpdir(), prefix));
  made.push(dir);
  return dir;
}
