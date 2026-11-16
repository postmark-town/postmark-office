// pinned-town.mjs — a town folder whose pinned modules ARE the office's pins (POS-994).
//
// The office runs only the town code it pinned (src/town-tool.mjs): an argv
// builder or an engine load checks the clone's copy against the pins first, so a
// test that names a made-up town ("/town") or writes its own stub stamp-mint.mjs
// now meets TownPinMismatch, as the box would. A test that is about something
// else (an argv's shape, a plan's arithmetic) takes a town from here instead:
// every file the pins name, copied from the pins in force (TOWN_PINS_DIR when
// the suite's helper set it, else src/town-pins), and nothing else.

import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { PIN_ROOT, relativeImports } from "../../src/town-tool.mjs";
import { MODULES, collect, manifest } from "../../tools/town-pins.mjs";

/** The pin root the loader reads in this process. */
export const pinRootNow = () => process.env.TOWN_PINS_DIR || PIN_ROOT;

/** A fresh temp folder holding exactly the pinned files at their town paths, removed when the process exits. Returns its path. */
export function pinnedTown(into = null) {
  if (!into) {
    into = mkdtempSync(join(tmpdir(), "pinned-town-"));
    const made = into;
    process.on("exit", () => { try { rmSync(made, { recursive: true, force: true }); } catch { /* litter */ } });
  }
  const root = pinRootNow();
  const pins = JSON.parse(readFileSync(join(root, "PINS.json"), "utf8"));
  for (const p of Object.keys(pins.files)) {
    mkdirSync(dirname(join(into, p)), { recursive: true });
    copyFileSync(join(root, p), join(into, p));
  }
  return into;
}

/**
 * Pins of a FIXTURE town's own files (its stubs), written beside it at
 * a fresh `<town>-pins-<pid>-<n>` (the loader caches a pin root per process, so a
 * re-pin after a rewrite gets a new one), or at `root`; never inside the town (the
 * loader refuses that). For a test whose
 * point is the office's control flow around a stub, not the town's code. Name
 * the result in TOWN_PINS_DIR for the code under test (a child's env, or
 * process.env around an in-process call). Only the modules the office pins and
 * the town holds are pinned, with their relative-import closures.
 */
let pinSeq = 0;
export function pinTown(town, root = `${town}-pins-${process.pid}-${++pinSeq}`) {
  mkdirSync(root, { recursive: true }); // a town holding no pinned module still gets its (empty) pins
  const present = MODULES.filter((m) => existsSync(join(town, "tools", m)));
  const files = collect((p) => readFileSync(join(town, p)), present);
  for (const [p, { bytes }] of files) {
    mkdirSync(dirname(join(root, p)), { recursive: true });
    writeFileSync(join(root, p), bytes);
  }
  writeFileSync(join(root, "PINS.json"), JSON.stringify(manifest(files, { townCommit: "0".repeat(40), readAt: new Date(0).toISOString() })));
  process.on("exit", () => { try { rmSync(root, { recursive: true, force: true }); } catch { /* litter */ } });
  return root;
}

/**
 * Copy a town module AND its relative-import closure from one town to another
 * (a fixture that used to copy stamp-mint.mjs alone now also needs
 * registry-source.mjs: the loader checks the whole closure).
 */
export function copyTownModule(fromTown, toTown, name) {
  const seen = new Set();
  const walk = (p) => {
    if (seen.has(p) || !existsSync(join(fromTown, p))) return;
    seen.add(p);
    mkdirSync(dirname(join(toTown, p)), { recursive: true });
    copyFileSync(join(fromTown, p), join(toTown, p));
    for (const d of relativeImports(p, readFileSync(join(fromTown, p), "utf8"))) walk(d);
  };
  walk(`tools/${name}`);
}

/**
 * A throwaway clone that carried no tools/ used to borrow a town's engine by
 * folder (STAMP_ENGINE_DIR, gone with POS-994). Now the clone carries the town's
 * own modules (with their closures), copied from `town`, so the office's pin
 * check reads them in the clone as it does on the box. In a git clone the copies
 * are listed in .git/info/exclude, so they never read as dirt to the pen.
 */
export function stageTownTools(clone, town, names = ["stamp-mint.mjs", "stamp-verify.mjs", "household-keys.mjs"]) {
  const before = new Set(existsSync(join(clone, "tools")) ? readdirSyncSafe(join(clone, "tools")) : []);
  for (const n of names) if (existsSync(join(town, "tools", n))) copyTownModule(town, clone, n);
  const exclude = join(clone, ".git", "info", "exclude");
  if (existsSync(join(clone, ".git"))) {
    mkdirSync(dirname(exclude), { recursive: true });
    const added = readdirSyncSafe(join(clone, "tools")).filter((n) => !before.has(n)).map((n) => `/tools/${n}`);
    if (added.length) writeFileSync(exclude, (existsSync(exclude) ? readFileSync(exclude, "utf8") : "") + added.join("\n") + "\n");
  }
  return clone;
}
function readdirSyncSafe(d) { try { return readdirSync(d); } catch { return []; } }

/** The pinned path of a town module, as townTool returns it. */
export const pinnedPath = (name) => join(pinRootNow(), "tools", name);
