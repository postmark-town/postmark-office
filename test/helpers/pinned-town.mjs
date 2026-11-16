// pinned-town.mjs — a town folder whose pinned modules ARE the office's pins (POS-994).
//
// The office runs only the town code it pinned (src/town-tool.mjs): an argv
// builder or an engine load checks the clone's copy against the pins first, so a
// test that names a made-up town ("/town") or writes its own stub stamp-mint.mjs
// now meets TownPinMismatch, as the box would. A test that is about something
// else (an argv's shape, a plan's arithmetic) takes a town from here instead:
// every file the pins name, copied from the pins in force (TOWN_PINS_DIR when
// the suite's helper set it, else src/town-pins), and nothing else.

import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { PIN_ROOT } from "../../src/town-tool.mjs";

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
 * `<town>-pins` (never inside it: the loader refuses that), for a test whose
 * point is the office's control flow around a stub, not the town's code. Name
 * the result in TOWN_PINS_DIR for the code under test (a child's env, or
 * process.env around an in-process call). Only the modules the office pins and
 * the town holds are pinned, with their relative-import closures.
 */
export async function pinTown(town) {
  const { MODULES, collect, manifest } = await import("../../tools/town-pins.mjs");
  const { existsSync, writeFileSync } = await import("node:fs");
  const root = `${town}-pins`;
  const present = MODULES.filter((m) => existsSync(join(town, "tools", m)));
  const files = collect((p) => readFileSync(join(town, p)), present);
  for (const [p, { bytes }] of files) {
    mkdirSync(dirname(join(root, p)), { recursive: true });
    writeFileSync(join(root, p), bytes);
  }
  writeFileSync(join(root, "PINS.json"), JSON.stringify(manifest(files, { townCommit: "0".repeat(40), readAt: new Date(0).toISOString() })));
  return root;
}

/** The pinned path of a town module, as townTool returns it. */
export const pinnedPath = (name) => join(pinRootNow(), "tools", name);
