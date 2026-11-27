#!/usr/bin/env node
// stamp-verify-pinned.mjs — THE TOWN'S VERIFIER, PINNED, WITH THE PINNED KEY (POS-994).
//
//   node src/stamp-verify-pinned.mjs --pinned <the pinned tools/ folder> --repo <clone> [--registry <file|url>]
//
// Wright, 2026-11-16: the stamp ledger's public key is a trust root, so the office
// pins it beside the code (tools/stamp-pubkey.pem in PINS.json, in stamp-verify's
// closure) and verifies with THAT key, not the clone's. The town's own CLI
// (tools/stamp-verify.mjs § main) reads the key from <repo>/tools/stamp-pubkey.pem,
// the clone's, and takes no key from outside; its library entry does
// (verifyStampLedger(repo, { pubkeyPem })). So this runner, the office's, imports
// the pinned verifier from the folder src/town-tool.mjs § townToolArgv checked
// against the clone and handed over, and calls it with the pinned key. The town's
// bytes are untouched. Its output and exit codes are the town CLI's own (callers
// read them: tools/stamp-verify-owed.mjs § owedOnly). A clone whose key was
// swapped is a pin stop before this runs; and were the swapped key ever let
// through, a ledger signed with it fails here, since the key here is the pin's.
//
// UAT only (POS-1214): with STAMP_UAT_TRUST set, the verifier is also handed
// UAT's handoff from src/stamp-trust.mjs (the base key through a trusted seal,
// UAT's key after it); a trust that can't be used is exit 2, NOT verified.
// Unset or empty (no file bound), as in production, the call is exactly what it was.
//
// Run only through townToolArgv(clone, "stamp-verify.mjs"), never by hand.

import { existsSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

async function main(argv) {
  const pi = argv.indexOf("--pinned"), ri = argv.indexOf("--repo");
  if (pi === -1 || !argv[pi + 1] || ri === -1 || !argv[ri + 1]) {
    console.error("usage: stamp-verify-pinned.mjs --pinned <pinned tools dir> --repo <clone> [--registry <file|url>] (run through src/town-tool.mjs § townToolArgv)");
    return 2;
  }
  const dir = argv[pi + 1];
  const repo = resolve(argv[ri + 1]);
  // the loader's own rule (tools/town-pins.mjs § outInsideTown): pinned code is
  // never read from inside the town it is checked against (Truey's re-read, finding 6)
  const rel = relative(repo, resolve(dir));
  if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) {
    console.error(`✗ stamp-ledger NOT verified: --pinned ${dir} is inside --repo ${repo}; the pinned verifier is never read from the town it checks`);
    return 2;
  }
  const town = [...argv.slice(0, pi), ...argv.slice(pi + 2)];
  // no pinned key, no verdict: the clone's key is never the fallback (it is what a forger would swap)
  const keyPath = join(dir, "stamp-pubkey.pem");
  if (!existsSync(keyPath)) {
    console.error(`✗ stamp-ledger NOT verified: the office's pins carry no public key (${keyPath}); re-pin with tools/town-pins.mjs --write`);
    return 2;
  }
  const pubkeyPem = readFileSync(keyPath, "utf8");
  // UAT's trust (POS-1214): asked for only by STAMP_UAT_TRUST in this process's
  // environment, and then loaded through the office's one policy
  // (src/stamp-trust.mjs). Unset or empty, nothing is imported or read here and the
  // verifier is called exactly as before. The import is lazy because prod's
  // town-tool sandbox binds only this file, src/town-tool.mjs and the pins; the
  // UAT drop-in binds src/stamp-trust.mjs beside them.
  let handoff = null;
  if (process.env.STAMP_UAT_TRUST) { // unset or empty: no file bound, production's path
    try {
      const { uatHandoff } = await import("./stamp-trust.mjs");
      handoff = uatHandoff({ env: process.env, clone: repo, base: pubkeyPem });
    } catch (e) {
      console.error(`✗ stamp-ledger NOT verified: ${e?.message ?? e}`);
      return 2;
    }
  }
  const { verifyStampLedger } = await import(pathToFileURL(join(dir, "stamp-verify.mjs")).href);
  // --registry is read by the pinned registry-source (in stamp-verify's closure), only when named
  const registrySource = town.includes("--registry")
    ? await (await import(pathToFileURL(join(dir, "registry-source.mjs")).href)).registryFromArgv(["node", "stamp-verify.mjs", ...town], { tool: "stamp-verify" })
    : null;
  const opts = { pubkeyPem, registry: registrySource?.registry ?? null };
  // the town's handoff (POS-1213): the base key through the trusted seal, UAT's key only after it
  const r = verifyStampLedger(repo, handoff ? { ...opts, handoff } : opts);
  // the town CLI's own words (tools/stamp-verify.mjs § main), so every reader of them reads the same
  if (r.ok) {
    console.log(`✓ stamp-ledger verifies — ${r.lines} line(s), ${r.minted} minted, chain + signatures + replay + conservation + lawful all green`);
    for (const n of r.notes ?? []) console.log(`  ! ${n}`);
    return 0;
  }
  console.error("✗ stamp-ledger verification FAILED:");
  for (const p of r.problems) console.error(`  - ${p}`);
  return 1;
}

const isMain = (() => {
  if (!process.argv[1]) return false;
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url)); }
})();
if (isMain) process.exit(await main(process.argv.slice(2)));
