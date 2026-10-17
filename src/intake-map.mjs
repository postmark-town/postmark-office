// intake-map.mjs — which pot an intake address names, read once for the whole office.
//
// WHY THIS FILE EXISTS AT ALL. An ERC-20 transfer carries no memo, so the only
// way the chain itself can name a pot is for the pot to have its own intake
// address. deploy/intake-addresses.json is that map, and it was born inside
// tools/usdc-watch.mjs because the watch was the only thing that needed it.
//
// It is not any more. The /fund DOOR needs the same map — to accept a payment
// at the pot's own address, and to publish that address in the pot's money
// moment — and a door and a watch that each parse the same file are two things
// that can disagree about where a stranger's money went. So the reader moved
// here, verbatim, and tools/usdc-watch.mjs re-exports it: one function, two
// callers, one answer.
//
// The map is address -> pot. Publication needs the other direction, and that
// direction is where the interesting refusal lives — see addressForPot.

import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { INTAKE } from "./usdc-witness.mjs";
import { plainReason } from "./fault-words.mjs"; // POS-657: a read's plain reason, the raw error to the log

const HERE = dirname(fileURLToPath(import.meta.url));
const lower = (a) => String(a).toLowerCase();

export const INTAKE_MAP_FILE = join(HERE, "..", "deploy", "intake-addresses.json");

/**
 * deploy/intake-addresses.json, read into a Map(lowercased address -> pot).
 *
 * A file that will not parse is SURFACED, not silently treated as empty: an
 * empty map and a broken map produce identical behaviour (everything ambiguous)
 * and only one of them is a bug.
 */
export function readIntakeMap(file = INTAKE_MAP_FILE) {
  const map = new Map();
  const invalid = [];
  if (!existsSync(file)) return { map, invalid };
  let d;
  try { d = JSON.parse(readFileSync(file, "utf8")); }
  catch (e) {
    invalid.push({ kind: "invalid", row_kind: "intake-map", line: "deploy/intake-addresses.json", reason: `unparseable JSON (${plainReason(e, "parse", "deploy/intake-addresses.json")}) — every arrival stays pot-ambiguous until this parses` });
    return { map, invalid };
  }
  for (const [addr, pot] of Object.entries(d?.addresses ?? {})) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) { invalid.push({ kind: "invalid", row_kind: "intake-map", line: `addresses["${addr.slice(0, 60)}"]`, reason: "not a Base address (0x + 40 hex)" }); continue; }
    if (!/^[a-z0-9][a-z0-9-]*$/.test(String(pot))) { invalid.push({ kind: "invalid", row_kind: "intake-map", line: `addresses["${addr}"]`, reason: `"${pot}" is not a pot id (lowercase letters, digits, hyphens)` }); continue; }
    map.set(lower(addr), String(pot));
  }
  return { map, invalid };
}

/** Every address the watch should scan: the standing intake plus every mapped one. */
export function intakeAddresses(map, standing = INTAKE) {
  return [...new Set([lower(standing), ...map.keys()])];
}

/** Which pot an address names, or null for the standing shared address. */
export function potForAddress(addr, map) {
  return map.get(lower(addr)) ?? null;
}

/** Every address mapped to this pot. More than one is a mistake, not a feature. */
export function addressesForPot(pot, map) {
  return [...map].filter(([, p]) => p === String(pot)).map(([a]) => a);
}

/**
 * THE ADDRESS A POT PUBLISHES.
 *
 *   one mapped address  -> that address. The chain names the pot from here on.
 *   none                -> the standing shared intake. A pot with no address of
 *                          its own is not broken; it is every pot before
 *                          2026-08-25, and the shared address is where its
 *                          patrons have always been told to send.
 *   more than one       -> null, and the caller must publish NO address rather
 *                          than pick one. Two addresses for one pot cannot
 *                          happen from the file's own instructions ("add one
 *                          row per pot here"), which is exactly why silently
 *                          choosing between them would be the wrong answer if
 *                          it ever did: `the-town/the-disclosure` — refuse or
 *                          disclose, never quietly substitute.
 */
export function addressForPot(pot, map, standing = INTAKE) {
  const own = addressesForPot(pot, map);
  if (own.length === 1) return own[0];
  if (own.length === 0) return lower(standing);
  return null;
}

/**
 * THE ADDRESSES A CLAIM ON THIS POT MAY HAVE PAID — the grandfather rule,
 * stated once so the door and its falsifiers read the same sentence:
 *
 *   A claim naming pot P verifies against P's own mapped address AND against
 *   the standing shared intake, because the shared address was the published
 *   answer for every pot up to the moment P's own address was minted. Refusing
 *   a tx that paid the shared address would strand an honest payer who
 *   followed yesterday's instructions, and yesterday's instructions were the
 *   town's own.
 *
 * The union is deliberate and it is not symmetric: paying P's address while
 * claiming pot Q is NOT grandfathered, because the chain named P out loud and
 * no published instruction ever pointed a Q-payer at P's address.
 */
export function acceptedForPot(pot, map, standing = INTAKE) {
  const own = addressForPot(pot, map, standing);
  return [...new Set([lower(standing), ...(own ? [own] : [])])];
}
