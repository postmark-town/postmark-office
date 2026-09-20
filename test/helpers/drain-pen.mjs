// #2040: the drain signs its ledger appends now, so every fixture that settles
// a join needs a pen. These bridge/journal tests are not tests of the town's
// stamp engine itself; they need the REAL office signing path to run without
// depending on a developer's separate town checkout.
//
// So the fixture supplies two per-run things:
//   1. a throwaway ed25519 private key, and
//   2. the narrow stamp-engine surface town-drain calls: parseStampLedger +
//      sealChain, using the town engine's published seal grammar verbatim.
//
// The dedicated drain-signs suite is the place that intentionally exercises the
// town's real stamp-mint + stamp-verify as its oracle. Keeping that distinction
// here makes these tests portable without pretending a fixture engine proves
// the town's cryptographic implementation.
import { generateKeyPairSync } from "node:crypto";
import { mkdirSync, writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const { privateKey } = generateKeyPairSync("ed25519");
const dir = mkdtempSync(join(tmpdir(), "pm-drainpen-"));
const keyFile = join(dir, "stamp-key.pem");
writeFileSync(keyFile, privateKey.export({ type: "pkcs8", format: "pem" }));

const engineDir = join(dir, "engine");
const engineFile = join(engineDir, "stamp-mint.mjs");
mkdirSync(engineDir, { recursive: true });
writeFileSync(engineFile, `
import { createHash } from "node:crypto";

const sha256hex = (s) => createHash("sha256").update(s, "utf8").digest("hex");
const GENESIS_SEAL_SEED = "postmark-stamps-v1";

// Transcribed from the town engine, not paraphrased — the raw line is tested,
// never a trimmed copy, and the signature must run to the end of the line with
// no whitespace in it. A fixture that is MORE permissive than the law reads a
// malformed line as signed, which is the class the drain-signs suite exists for.
// test/drain-pen-fixture.test.mjs pins every one of those shapes.
export function parseStampLedger(text) {
  const out = [];
  for (const raw of text.replace(/\\r\\n/g, "\\n").split("\\n")) {
    if (!raw.startsWith("- ")) continue;
    const m = /^(.*) · sig: (\\S+)$/.exec(raw);
    if (m) out.push({ canonical: m[1], sig: m[2], raw });
    else out.push({ canonical: raw, sig: null, raw });
  }
  return out;
}

export function sealChain(canonicals) {
  let seal = sha256hex(GENESIS_SEAL_SEED);
  const seals = [];
  for (const canonical of canonicals) {
    seal = sha256hex(seal + canonical);
    seals.push(seal);
  }
  return seals;
}
`);

process.env.STAMP_KEY = keyFile;
process.env.STAMP_ENGINE_DIR = engineDir;
