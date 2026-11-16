// town-pins-env.mjs — THE SUITE'S TOWN CLONE GETS PINS OF ITS OWN (POS-994).
//
// Loaded with --import beside sparse-guard.mjs (package.json's test script,
// NODE_OPTIONS on suite.yml's shard step), so every suite process and every
// child it spawns sees it.
//
// The office runs only the town code it pinned (src/town-tool.mjs), and its
// pins are read at the town commit the office ships with. The suite's town
// clone sits at test/clone-pins.json's sha, which moves on its own schedule. So
// here, before any test loads office code, the same pin writer
// (tools/town-pins.mjs § collect) reads the pinned modules from the suite
// clone's HEAD, writes them under the OS temp folder keyed by that sha (once;
// later processes reuse it), and names that folder in TOWN_PINS_DIR. A
// fixture that copies the clone's modules (test/helpers/town-tools.mjs) is then
// byte-equal to these pins, and a fixture that changes one is a mismatch, as on
// the box.
//
// The office's own pins (src/town-pins/) are held to their town commit by
// test/town-tool.test.mjs, not through here.
//
// No town clone (an operator's machine without one): nothing is set, and the
// suites that need the clone skip by their own names as before.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CLONE = join(ROOT, "town-clone");

if (!process.env.TOWN_PINS_DIR && existsSync(join(CLONE, ".git"))) {
  try {
    const git = (args) => execFileSync("git", ["-C", CLONE, ...args], { maxBuffer: 1 << 26, stdio: ["ignore", "pipe", "ignore"] });
    const head = git(["rev-parse", "HEAD"]).toString().trim();
    const dir = join(tmpdir(), "office-town-pins", head);
    if (!existsSync(join(dir, "PINS.json"))) {
      const { MODULES, collect, manifest } = await import("../../tools/town-pins.mjs");
      // Only the modules the clone's commit has: an older town lacks witness-chain.
      const present = MODULES.filter((m) => { try { git(["cat-file", "-e", `${head}:tools/${m}`]); return true; } catch { return false; } });
      const files = collect((p) => git(["show", `${head}:${p}`]), present);
      const tmp = `${dir}.${process.pid}`;
      rmSync(tmp, { recursive: true, force: true });
      for (const [p, { bytes }] of files) {
        mkdirSync(dirname(join(tmp, p)), { recursive: true });
        writeFileSync(join(tmp, p), bytes);
      }
      writeFileSync(join(tmp, "PINS.json"), JSON.stringify(manifest(files, { townCommit: head, readAt: new Date().toISOString() }), null, 2));
      mkdirSync(dirname(dir), { recursive: true });
      // Another process may have won the race: theirs is the same bytes.
      try { renameSync(tmp, dir); } catch { rmSync(tmp, { recursive: true, force: true }); }
    }
    process.env.TOWN_PINS_DIR = dir;
  } catch (e) {
    process.stderr.write(`town-pins-env: could not pin the suite's town clone (${e.message}); office code that reaches town modules will refuse\n`);
  }
}
