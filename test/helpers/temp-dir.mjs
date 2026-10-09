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

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const made = [];
let hooked = false;

function removeAll() {
  for (const dir of made.splice(0)) {
    // A child that still holds a file there (Windows) gets a moment; past that the folder is named, not thrown.
    try { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
    catch (e) { console.error(`[temp-dir] left ${dir} (${e.code ?? e.message})`); }
  }
}

/** `mkdtempSync(join(tmpdir(), prefix))`, removed when this process exits. */
export function tempDir(prefix) {
  if (!hooked) { process.on("exit", removeAll); hooked = true; }
  const dir = mkdtempSync(join(tmpdir(), prefix));
  made.push(dir);
  return dir;
}
