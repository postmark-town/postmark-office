// stamp-trust.mjs — UAT'S STAMP TRUST: ONE POLICY FOR EVERY VERIFIER IN THE OFFICE (POS-1214).
//
// Why (CORE-176, 2026-11-24): UAT signs its own mints with its own key, as it
// must (prod's keys stay out of UAT), and every UAT crossing was refused at its
// gate because the office verified the whole ledger with prod's public key. A
// UAT ledger is a prod-signed prefix followed by UAT-signed lines.
//
// The shape (Wright, 2026-11-24 14:32:35Z on POS-1213, paired with the town's
// handoff): the copied prefix verifies with the base key up to and including a
// trusted seal, then UAT's public key only, after it. Never either key on any
// line. The office's part: an operator-owned, read-only UAT file, named by
// STAMP_UAT_TRUST, gives the four verification paths
// (src/stamp-verify-pinned.mjs, world2/tools/stamp-mint-run.mjs,
// src/house-key.mjs, src/stamp-lines.mjs) the same trust, through this file:
//
//   { "pubkeyPem": "<UAT's public verification key, SPKI PEM>",
//     "afterSeal": "<the trusted seal of the copied prefix's last line, 64 hex>" }
//
// mapped to the town's `verifyStampLedger(repo, { pubkeyPem, handoff: { pubkeyPem, afterSeal } })`.
//
// THE WALL THAT DECIDES IT: with no STAMP_UAT_TRUST in the environment, or an
// empty one (an empty value names no file: no UAT file is bound; Rivet's
// settlement on POS-1214, 2026-11-24), this file answers null, reads nothing,
// and every path behaves exactly as before, byte for byte
// (test/stamp-trust.test.mjs holds the control).
//
// REQUESTED BUT UNUSABLE FAILS CLOSED: once STAMP_UAT_TRUST names a file (any
// non-empty value), a trust the office can't use is
// a thrown StampTrustUnusable that names why, never a quiet fall back to prod's
// key alone. The trust never comes from the clone, the ledger, a resident's
// request or a signing key: the file must sit outside the town clone, hold
// exactly the two fields, carry a PUBLIC key (a private key in it is refused),
// and that key must not be the base key.

import { createPublicKey } from "node:crypto";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, relative } from "node:path";

/** The one environment name. Unset is production. */
export const UAT_TRUST_ENV = "STAMP_UAT_TRUST";

/**
 * Where the UAT drop-in binds the trust file, read-only, for the town-tool
 * sandbox (deploy/postmark-town-tool@.service-dropin-uat-stamp-trust.conf). The
 * sandbox passes its verifier this path and no other (tools/town-tool-sandbox.mjs).
 */
export const UAT_TRUST_PATH = "/etc/postmark-uat/stamp-trust.json";

const MAX_BYTES = 64 * 1024;
const SEAL = /^[0-9a-f]{64}$/;

export class StampTrustUnusable extends Error {
  constructor(where, why) {
    super(`${where === null ? `the trust ${UAT_TRUST_ENV} names` : `${UAT_TRUST_ENV} names ${JSON.stringify(String(where)).slice(0, 300)}, and it`} can't be used: ${why}. ` +
      "UAT's stamp trust was asked for, so nothing is verified without it (POS-1214).");
    this.name = "StampTrustUnusable";
    this.code = "STAMP_UAT_TRUST_UNUSABLE";
  }
}

/** Was UAT trust asked for? Only a non-empty STAMP_UAT_TRUST asks: unset or empty is production (no file bound). */
export const uatTrustRequested = (env = process.env) => {
  const v = env?.[UAT_TRUST_ENV];
  return v !== undefined && v !== "";
};

/** The SPKI DER of a public key PEM, for comparing two keys by their bytes. */
const spki = (pem) => createPublicKey(pem).export({ type: "spki", format: "der" });

/**
 * The UAT handoff `{ pubkeyPem, afterSeal }`, frozen, or null when no trust was
 * asked for (production: nothing is read). Throws StampTrustUnusable when it was
 * asked for and can't be used. `clone`, when named, is the town the trust must
 * not come from. `base`, when named (a PEM, or a function returning one, called
 * only when trust was asked for), is the key that verifies the prefix: UAT's key
 * equal to it is refused.
 */
export function uatHandoff({ env = process.env, clone = null, base = null } = {}) {
  if (!uatTrustRequested(env)) return null;
  const where = env[UAT_TRUST_ENV];
  if (typeof where !== "string" || !where || !isAbsolute(where)) throw new StampTrustUnusable(where, "it is not an absolute path");
  let real, st;
  try {
    real = realpathSync(where);
    st = statSync(real);
  } catch (e) { throw new StampTrustUnusable(where, `it can't be read (${e?.code ?? "no error code"})`); }
  if (!st.isFile()) throw new StampTrustUnusable(where, "it is not a regular file");
  if (st.size > MAX_BYTES) throw new StampTrustUnusable(where, `it holds ${st.size} bytes, more than a trust file's ${MAX_BYTES}`);
  // Who owns the file and that it is read-only are the binding's and its install's to hold (the UAT
  // drop-in binds it read-only); no file-mode policy was ruled here (Rivet's settlement, 2026-11-24).
  if (clone) {
    let town;
    try { town = realpathSync(clone); } catch { town = clone; }
    const rel = relative(town, real);
    if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) throw new StampTrustUnusable(where, "it is inside the town clone, and trust never comes from the town it checks");
  }
  let text, doc;
  try { text = readFileSync(real, "utf8"); } catch (e) { throw new StampTrustUnusable(where, `it can't be read (${e?.code ?? "no error code"})`); }
  try { doc = JSON.parse(text); } catch { throw new StampTrustUnusable(where, "it is not JSON"); }
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) throw new StampTrustUnusable(where, "it is not a JSON object");
  const keys = Object.keys(doc).sort();
  if (keys.join(",") !== "afterSeal,pubkeyPem") throw new StampTrustUnusable(where, `it must hold exactly pubkeyPem and afterSeal, and holds ${keys.join(", ") || "nothing"}`);
  const { pubkeyPem, afterSeal } = doc;
  if (typeof afterSeal !== "string" || !SEAL.test(afterSeal)) throw new StampTrustUnusable(where, "afterSeal is not a seal (64 lowercase hex)");
  if (typeof pubkeyPem !== "string" || /PRIVATE KEY/.test(pubkeyPem) || !/^-----BEGIN PUBLIC KEY-----\r?\n/.test(pubkeyPem.trimStart()))
    throw new StampTrustUnusable(where, "pubkeyPem is not a public key PEM (a private key is never trust)");
  let key;
  try { key = createPublicKey(pubkeyPem); } catch { throw new StampTrustUnusable(where, "pubkeyPem is not a readable public key"); }
  if (key.asymmetricKeyType !== "ed25519") throw new StampTrustUnusable(where, `pubkeyPem is a ${key.asymmetricKeyType} key, not ed25519`);
  const uat = key.export({ type: "spki", format: "der" });
  const basePem = typeof base === "function" ? base() : base;
  if (basePem != null) {
    let same;
    try { same = spki(basePem).equals(uat); } catch { throw new StampTrustUnusable(where, "the base key it hands off from isn't a readable public key"); }
    if (same) throw new StampTrustUnusable(where, "its key is the base key: a handoff to the same key is no boundary");
  }
  return Object.freeze({ pubkeyPem, afterSeal });
}

/**
 * The town verifier's options with the handoff added, or the very same object
 * when there is none (production passes exactly what it passed before).
 */
export const withHandoff = (opts, handoff) => (handoff ? { ...opts, handoff } : opts);

// Which key verifies which line is NOT decided here: it is the town's one rule,
// the pinned stamp-verify.mjs § stampKeyPlan (POS-1213), which the town verifier
// runs on the handoff this file hands it, and which src/stamp-lines.mjs asks for
// its own signature checks.
