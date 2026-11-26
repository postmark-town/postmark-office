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
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gitBlobSha } from "../../src/town-tool.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CLONE = join(ROOT, "town-clone");

// Only an UNSET name is filled. A fixture that sets TOWN_PINS_DIR="" means "the
// pins beside the office under test" (a fixture office's own src/town-pins), and
// this helper rides NODE_OPTIONS into that fixture's children too, so it must
// never read "" as "unset" and point them at the suite clone's pins.
if (process.env.TOWN_PINS_DIR === undefined && existsSync(join(CLONE, ".git"))) {
  try {
    const git = (args) => execFileSync("git", ["-C", CLONE, ...args], { maxBuffer: 1 << 26, stdio: ["ignore", "pipe", "ignore"] });
    const head = git(["rev-parse", "HEAD"]).toString().trim();
    const dir = join(tmpdir(), "office-town-pins", head);
    const { MODULES, checkPins, collect, manifest } = await import("../../tools/town-pins.mjs");
    // A MODULE THE SUITE'S TOWN CLONE PREDATES (POS-1165: tools/letter-fields.mjs, which test/clone-pins.json's town does not hold yet) is LENT from the
    // office's own reviewed pins (src/town-pins/), so the suite's pins hold every module the office's code reaches. Lending pins does NOT let a named
    // clone omit the file: the loader still holds a clone to the pin, so a fixture clone that stands for the town carries the reviewed file
    // (test/fixture.mjs § seedLetterFields) and a clone without it stops 503 town-pin-mismatch. Nothing here moves test/clone-pins.json.
    const inClone = (m) => { try { git(["cat-file", "-e", `${git(["rev-parse", "HEAD"]).toString().trim()}:tools/${m}`]); return true; } catch { return false; } };
    const lent = MODULES.filter((m) => !inClone(m) && existsSync(join(ROOT, "src", "town-pins", "tools", m)) && m === "letter-fields.mjs");
    const lentPaths = new Set(lent.map((m) => `tools/${m}`));
    // A cached folder is reused only when its bytes are the town's at that commit
    // (a shared /tmp can hold anyone's folder of that name; Truey's review of #1065).
    const holds = () => {
      try {
        const pins = JSON.parse(readFileSync(join(dir, "PINS.json"), "utf8"));
        // a LENT file is held to the reviewed Office artifact's own bytes (src/town-pins/), never to this cache's manifest (a self-oracle): an altered cache
        // file, or a changed Office module, fails the comparison and the folder is rebuilt
        const townBlob = (c, p) => lentPaths.has(p) ? gitBlobSha(readFileSync(join(ROOT, "src", "town-pins", p))) : (() => { try { return git(["rev-parse", `${c}:${p}`]).toString().trim(); } catch { return null; } })();
        return pins.town_commit === head && [...lentPaths].every((p) => pins.files[p]) && checkPins(dir, { townBlob, complete: false }).length === 0;
      } catch { return false; }
    };
    if (!holds()) {
      rmSync(dir, { recursive: true, force: true });
      // Only the modules the clone's commit has: an older town lacks witness-chain.
      const present = MODULES.filter((m) => { try { git(["cat-file", "-e", `${head}:tools/${m}`]); return true; } catch { return false; } });
      const files = collect((p) => git(["show", `${head}:${p}`]), present.filter((m) => !lent.includes(m)));
      for (const [p, v] of collect((p) => readFileSync(join(ROOT, "src", "town-pins", p)), lent)) if (!files.has(p)) files.set(p, v);
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
