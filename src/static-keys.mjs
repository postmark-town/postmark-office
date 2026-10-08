// static-keys.mjs — the office's static keys, in the store (POS-352 part 2).
//
// A static key is a bearer key an OPERATOR issued by hand, not one a human
// minted at the key desk: the founder's own household key, the Bug Catcher's,
// and the keys the Meeps Come Home moves will add. Until this file they lived
// in one env var, `OFFICE_KEYS`, which the office parsed at boot:
//
//   <key>=<household>[#<gh_id>]:<handle>[,<handle>...][;<key>=...]
//
// RULED (Darko, 2026-10-06, 2a): static office keys become a `static` kind
// with an explicit handles column and an explicit household column, imported
// from OFFICE_KEYS by hash, nothing re-issued, no token printed. So a static
// key is now a row in the tokens table (`oauth_tokens` in the store, 031 and
// 070), and the env var is read only by the import (tools/static-keys-import.mjs).
//
// ── WHY THE COLUMNS ARE EXPLICIT ────────────────────────────────────────────
//
// A minted household key resolves its handles by gh_id: every handle pinned to
// that account (oauth.mjs § householdFor). A static row does NOT. It names its
// household and its handles itself, exactly as the env row did, so a row that
// holds two handles out of a house (a Meep's key on the founder's account)
// stays two handles. Re-minting such a row as a household key would widen it to
// the whole house; the explicit columns are what keep it the size it was.
//
// ── THE gh_id, AND WHAT IT IS FOR ───────────────────────────────────────────
//
// A static key's household is a string an operator chose. There is no GitHub
// sign-in behind it and therefore no verified account id, which is fine for
// everything these keys have ever done and NOT fine for holding a role: the
// role registry keys on the immutable gh_id (src/roles.mjs). So the household
// field may carry a pinned id, `keemin#583231`. Founder-ruled shape
// (2026-08-26): a static key resolves for role purposes ONLY if its row carries
// an explicit gh_id. Without one the key works exactly as it always has and
// simply holds no roles. The row keeps that: `gh_id` is set only when the env
// row had one.
//
// ── THE RESOLUTION IS THE ONE IT ALWAYS WAS ─────────────────────────────────
//
// `staticLookup` answers `{ household, handles: Set, ghId? }`, the object the
// boot parse put in its map, field for field: no login, no key kind, no harbor
// stamp, no expiry. Everything downstream (identityOf's key_kind, the role
// gate, the key desk's `key.ghId` gate) reads the same object it read before.
// test/static-keys.test.mjs pins it against the old parse for every shape.
//
// ── NOTHING SECRET LEAVES ───────────────────────────────────────────────────
//
// A row holds sha256(key), base64url, as every other token row does; the key
// itself is never stored. Nothing here returns or prints a key or any part of
// its hash: the import reports counts and household names only.

import { createHash } from "node:crypto";
import { asPaper } from "./paperwork.mjs";

/** sha256(token), base64url: the hash every tokens row is keyed on (oauth.mjs § sha256). */
const sha256 = (s) => createHash("sha256").update(s).digest("base64url");

/** The kind a static row carries in the tokens table. */
export const STATIC_KIND = "static";

/**
 * OFFICE_KEYS -> one entry per key, in the boot parse's exact semantics (the
 * parse server.mjs ran until POS-352): entries split on `;`, each trimmed and
 * matched as `<key>=<household>[#<gh_id>]:<handles>`; a malformed entry is
 * skipped; a later entry for the same key replaces an earlier one; handles are
 * split on `,` and trimmed, in their written order. A `#` with no numeric id
 * after it pins nothing (the row holds no roles), and is named in `warnings`.
 * `skipped` counts the malformed entries the boot parse passed over silently.
 */
export function parseOfficeKeys(spec) {
  const keys = new Map(); // key -> { household, handles: [..], ghId: number|null }
  const warnings = [];
  let skipped = 0;
  for (const entry of String(spec ?? "").split(";").filter(Boolean)) {
    const m = /^([^=]+)=([^:]+):(.+)$/.exec(entry.trim());
    if (!m) { skipped += 1; continue; }
    const [, token, householdField, handleList] = m;
    const hash = householdField.lastIndexOf("#");
    const household = hash === -1 ? householdField : householdField.slice(0, hash);
    const idPart = hash === -1 ? "" : householdField.slice(hash + 1).trim();
    const ghId = /^[1-9][0-9]*$/.test(idPart) ? Number(idPart) : null;
    if (hash !== -1 && ghId === null)
      warnings.push(`the entry for "${household}" has a "#" but no numeric gh_id after it, so it holds no roles`);
    keys.set(token, { household, handles: handleList.split(",").map((s) => s.trim()), ghId });
  }
  return { keys, warnings, skipped };
}

/** The resolved credential, from a row: the boot parse's object, field for field. */
const credentialOf = (row) => ({
  household: row.household,
  handles: new Set(JSON.parse(row.handles)),
  ...(row.gh_id == null ? {} : { ghId: Number(row.gh_id) }),
});

/**
 * A bearer token -> its static credential, or null. One read of the tokens
 * table by hash. A static key never expires: it ends when its row is deleted.
 */
export async function staticLookup(odb, token) {
  const row = await asPaper(odb).get(
    "SELECT household, handles, gh_id FROM tokens WHERE token_hash = ? AND kind = 'static'", sha256(token));
  return row ? credentialOf(row) : null;
}

/** The one statement a static row is written by (the import, and the suite's seed). */
export const INSERT_STATIC =
  "INSERT INTO tokens (token_hash, kind, gh_id, gh_login, client_id, expires, created, household, handles)"
  + " VALUES (?, 'static', ?, NULL, NULL, NULL, ?, ?, ?)";

/** One parsed entry -> the INSERT_STATIC arguments. `created` is epoch seconds. */
export const staticRowArgs = (token, { household, handles, ghId }, created) =>
  [sha256(token), ghId, created, household, JSON.stringify(handles)];

const sameRow = (row, { household, handles, ghId }) =>
  row.household === household && row.handles === JSON.stringify(handles)
  && (row.gh_id == null ? null : Number(row.gh_id)) === ghId;

/**
 * Write OFFICE_KEYS into the tokens table, one static row per key, by hash, in
 * one transaction. Idempotent: an entry whose row already says the same thing
 * is left alone; an entry whose row says something else (the env row was
 * edited) is REPLACED, delete then insert, because office_api may not UPDATE a
 * token (031). A key whose hash is held by a row of another kind is refused,
 * never overwritten, and a refusal writes NOTHING: the transaction is rolled
 * back and the counts come back with `refused` > 0.
 * Static rows the spec does not name are counted and left alone: the import
 * never revokes.
 *
 * `dry` reads and counts and writes nothing. Answers counts and the households
 * named, never a key or a hash.
 */
export async function importStaticKeys(odb, spec, { dry = false, now = Math.floor(Date.now() / 1000) } = {}) {
  const { keys, warnings, skipped } = parseOfficeKeys(spec);
  const P = asPaper(odb);
  const plan = async (t) => {
    const out = { entries: keys.size, skipped, added: 0, replaced: 0, unchanged: 0, refused: 0, not_in_spec: 0, households: [], warnings };
    const named = new Set();
    for (const [token, entry] of keys) {
      const args = staticRowArgs(token, entry, now);
      named.add(args[0]);
      const row = await t.get("SELECT kind, household, handles, gh_id FROM tokens WHERE token_hash = ?", args[0]);
      if (row && row.kind !== STATIC_KIND) { out.refused += 1; continue; }
      if (row && sameRow(row, entry)) { out.unchanged += 1; continue; }
      if (row) { out.replaced += 1; if (!dry) await t.run("DELETE FROM tokens WHERE token_hash = ? AND kind = 'static'", args[0]); }
      else out.added += 1;
      if (!dry) await t.run(INSERT_STATIC, ...args);
    }
    for (const r of await t.all("SELECT token_hash FROM tokens WHERE kind = 'static'"))
      if (!named.has(r.token_hash)) out.not_in_spec += 1;
    out.households = [...new Set([...keys.values()].map((e) => e.household))].sort();
    return out;
  };
  // A dry run reads through the paper and opens no transaction: it holds no pen.
  if (dry) return plan(P);
  const REFUSED = Symbol("refused");
  let refusedOut = null;
  try {
    return await P.tx(async (t) => {
      const out = await plan(t);
      if (out.refused > 0) { refusedOut = out; throw REFUSED; }
      return out;
    });
  } catch (e) {
    if (e === REFUSED) return refusedOut;
    throw e;
  }
}
