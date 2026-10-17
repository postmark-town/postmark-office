// registry-public.mjs — the household registry as a PUBLIC read may show it (POS-394).
//
// RULED (Darko, 2026-10-05): household and resident pages print the household's
// display name, NEVER the private human name. Wright, 2026-10-12, on the same
// issue: the office's public /households, and any public read that carries a
// registry row, omit `human` first.
//
// So a registry row has two faces. The PRIVATE one is the store's: `human` stays
// in the rows, the fold (`registryFromRows`), the private render
// (`renderRegistry`, the round trip), the ceremonies that write it and the
// deriver that resolves a house by it. This file is the PUBLIC one: the same
// row with the `human` KEY gone (not nulled: a null still says "there is a field
// here"), every other key in its own order. The public reads use it, and so does
// the drain that prints the town's files (`renderPublicRegistry`, POS-394): the
// printout in the town repo is public, so it carries no `human` either.
//
// It copies; it never mutates. The objects handed in are the private record's
// (a caller may hold them, a memo may share them), so a projection that deleted
// a key in place would take the name out of the PRIVATE answer too.

/** The keys a public read never carries from a registry row. */
export const PRIVATE_HOUSE_KEYS = Object.freeze(["human"]);

/** One house row, without its private keys; key order kept. Non-objects pass through. */
export function publicHouse(rec) {
  if (rec === null || typeof rec !== "object" || Array.isArray(rec)) return rec;
  const out = {};
  for (const [k, v] of Object.entries(rec)) if (!PRIVATE_HOUSE_KEYS.includes(k)) out[k] = v;
  return out;
}

/** `{ ...meta, households: { slug: rec } }` -> the same, every house public. A new object. */
export function publicRegistry(registry) {
  if (registry === null || typeof registry !== "object") return registry;
  const out = {};
  for (const [k, v] of Object.entries(registry)) {
    if (k !== "households") { out[k] = v; continue; }
    const houses = {};
    for (const [slug, rec] of Object.entries(v ?? {})) houses[slug] = publicHouse(rec);
    out[k] = houses;
  }
  return out;
}
