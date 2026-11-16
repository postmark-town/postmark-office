// stamp-pubkey-pin.test.mjs — the stamp ledger's public key is a TRUST ROOT, pinned (POS-994).
//
// Wright, 2026-11-16, on #1065: the office pins tools/stamp-pubkey.pem beside the
// verifier's code (in stamp-verify's closure in src/town-pins/PINS.json) and
// verifies with the PINNED key, not the clone's. Two guards, each proved here
// against a forger who swaps the clone's key and signs a ledger with their own:
//
//   1. THE PIN: the clone's key is held to the pinned one like a module, so a
//      swapped key is a pin stop, by name, before any verifier runs (townToolArgv,
//      and the shell's door, exit 3 naming tools/stamp-pubkey.pem);
//   2. THE ROOT: were the swapped key ever let through, the office's runner
//      (src/stamp-verify-pinned.mjs) verifies with the pinned key, so the forged
//      signatures fail, where the town's own CLI, reading the clone's key, passes them.
//
// THE CAN-FAIL FLIPS:
//   · drop tools/stamp-pubkey.pem from DATA_DEPS in tools/town-pins.mjs (and re-pin):
//     test 1 goes red, the swapped key is no longer a stop;
//   · make the runner read the key from --repo instead of --pinned: test 2 goes red,
//     the forged ledger verifies.
import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isPinStop, townToolArgv } from "../src/town-tool.mjs";
import { pinnedTown, pinRootNow } from "./helpers/pinned-town.mjs";

const OFFICE = join(dirname(fileURLToPath(import.meta.url)), "..");
const PINNED_TOOLS = join(pinRootNow(), "tools");
const KEY = "tools/stamp-pubkey.pem";
const skip = existsSync(join(pinRootNow(), KEY)) ? false : `the pins in force carry no ${KEY}`;
const ENGINE = skip ? null : await import(pathToFileURL(join(PINNED_TOOLS, "stamp-mint.mjs")).href);

const BASE = [
  "- 2026-06-12 · rules: stamps-v1",
  "- 2026-06-13 · MINT → ada · 1 · for: letter-a (sent)",
  "- 2026-06-13 · MINT → bea · 1 · for: letter-a (received)",
];

/** A town holding exactly the pinned files, its ledger signed by a forger, and the forger's public key put in for the town's. */
function forgedTown() {
  const forger = generateKeyPairSync("ed25519");
  const dir = pinnedTown();
  const seals = ENGINE.sealChain(BASE);
  const pem = forger.privateKey.export({ type: "pkcs8", format: "pem" });
  mkdirSync(join(dir, "WHITE_PAGES"), { recursive: true });
  writeFileSync(join(dir, "WHITE_PAGES", "stamp-ledger.md"),
    `# the stamp ledger\n\n${BASE.map((c, i) => `${c} · sig: ${ENGINE.signSeal(seals[i], pem)}`).join("\n")}\n`);
  writeFileSync(join(dir, KEY), forger.publicKey.export({ type: "spki", format: "pem" }));
  return dir;
}

test("THE PIN: a clone whose public key was swapped is a pin stop that names the key, before any verifier runs", { skip }, () => {
  const town = forgedTown();
  let stop = null;
  try { townToolArgv(town, "stamp-verify.mjs"); } catch (e) { stop = e; }
  assert.ok(stop && isPinStop(stop), `a pin stop, not ${stop?.message ?? "a verifier argv"}`);
  assert.equal(stop.file, KEY, "it names the key, the file that differs");
  // the shell's door says the same, with the pin stop's exit
  const r = spawnSync(process.execPath, [join(OFFICE, "src", "town-tool.mjs"), "run", "stamp-verify.mjs", "--clone", town, "--"], { encoding: "utf8" });
  assert.equal(r.status, 3, r.stderr);
  assert.match(r.stderr, /tools\/stamp-pubkey\.pem/);
});

test("THE ROOT: the office's runner verifies with the PINNED key, so a forger-signed ledger fails where the clone's own key would pass it", { skip }, () => {
  const town = forgedTown();
  // the town's own CLI reads the clone's key, the forger's: the signatures pass under it
  const own = spawnSync(process.execPath, [join(town, "tools", "stamp-verify.mjs"), "--repo", town], { encoding: "utf8" });
  assert.match(own.stdout + own.stderr, /stamp-ledger/, "the town CLI ran");
  assert.doesNotMatch(own.stderr, /SIGNATURE FAILS/, "under the clone's (forged) key no signature is a problem (what else it finds is not this test's)");
  // the office's runner, handed the pinned folder (as townToolArgv hands it), uses the pinned key
  const r = spawnSync(process.execPath, [join(OFFICE, "src", "stamp-verify-pinned.mjs"), "--pinned", PINNED_TOOLS, "--repo", town], { encoding: "utf8" });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /✗ stamp-ledger verification FAILED/);
  assert.match(r.stderr, /line 1: SIGNATURE FAILS/, "the forged signatures fail under the pinned key, from the first line");
});

test("the runner refuses by name when the pins carry no key: the clone's is never the fallback", { skip }, () => {
  const empty = join(pinnedTown(), "no-key-tools");
  mkdirSync(empty, { recursive: true });
  writeFileSync(join(empty, "stamp-verify.mjs"), readFileSync(join(PINNED_TOOLS, "stamp-verify.mjs")));
  const r = spawnSync(process.execPath, [join(OFFICE, "src", "stamp-verify-pinned.mjs"), "--pinned", empty, "--repo", forgedTown()], { encoding: "utf8" });
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /NOT verified: the office's pins carry no public key/);
});
