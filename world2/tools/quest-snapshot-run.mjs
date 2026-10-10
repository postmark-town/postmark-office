#!/usr/bin/env node
// quest-snapshot-run.mjs — THE QUEST LEADERBOARD FOLDS ON THE STORE'S KEY BASE
// (POS-341 part 4).
//
// The crossing's quest pass was `node tools/quest-progress.mjs --snapshot`, run
// in the town clone. It groups households (the daily cap's bars, the leaderboard,
// the budding friendships) by householdKeys over the printouts: the pins file,
// the ADDRESS cards and the ledger's sealed dates. This runner hands the town's
// own renderSnapshot the store's key base instead (src/mint-inputs.mjs §
// keyBaseVia: household_pins, town_rooms, stamp_lines), the base the mint
// already decides from (world2/tools/stamp-mint-run.mjs). The law stays the
// town's: the bytes are the town's renderSnapshot, written where --snapshot
// writes them (TOWN_BULLETIN/quests.md), and only when they moved.
//
//   node world2/tools/quest-snapshot-run.mjs [--clone <town clone>]
//
// The ferry runs it behind STAMP_LINES=store, exactly as it runs the mint
// runner; unset, it runs the town's own --snapshot, and unsetting it is the
// rollback. The caller commits the file. An empty store input, or a town
// checkout whose engine cannot take a base (town #3540), is a refusal by name,
// never a quiet fall back to the printouts. Exit 0 written or unchanged, 1 refused.

import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { keyBaseVia, takesKeyBase } from "../../src/mint-inputs.mjs";

/** The snapshot's bytes from the store's base, and whether they moved: `{ path, next, changed }`. Writes nothing. `today` is the town's day unless a test names one. */
export async function snapshotFromStore(clone, { env = process.env, today = null } = {}) {
  const engine = await import(pathToFileURL(join(clone, "tools", "stamp-mint.mjs")).href);
  if (!takesKeyBase(engine, clone)) throw new Error("this town checkout's engine takes no key base (town #3540): nothing written");
  const quests = await import(pathToFileURL(join(clone, "tools", "quest-progress.mjs")).href);
  const { officeRead } = await import("../../src/world2-pen.mjs");
  const base = await officeRead((q) => keyBaseVia(q, engine), { env });
  const path = join(clone, "TOWN_BULLETIN", "quests.md");
  const next = quests.renderSnapshot(clone, today ? { base, today } : { base });
  const prev = existsSync(path) ? readFileSync(path, "utf8") : null;
  return { path, next, changed: prev !== next };
}

function arg(name, fallback = null) { const i = process.argv.indexOf(`--${name}`); return i === -1 ? fallback : process.argv[i + 1]; }

async function main() {
  const clone = resolve(arg("clone", process.env.TOWN_CLONE ?? process.cwd()));
  if (!existsSync(join(clone, "tools", "quest-progress.mjs"))) { console.error(`no town clone with tools/quest-progress.mjs at ${clone}`); return 1; }
  try {
    const { path, next, changed } = await snapshotFromStore(clone);
    if (!changed) { console.log("quests.md: unchanged (the store's key base)"); return 0; }
    writeFileSync(path, next);
    console.log(`quests.md: written (${next.length} bytes, the store's key base)`);
    return 0;
  } catch (e) { console.error(`FATAL: ${e.message}`); return 1; }
}

// Entry guard: real paths, the junction lesson (town-index-ingest.mjs § entry guard).
const isMain = (() => {
  if (!process.argv[1]) return false;
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return pathToFileURL(process.argv[1]).href === import.meta.url; }
})();
if (isMain) process.exitCode = await main();
