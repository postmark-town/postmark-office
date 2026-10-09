// static-keys.mjs (test helper) — a suite's static keys, as store rows.
//
// Until POS-352 a suite handed its office keys in OFFICE_KEYS and the server
// parsed them at boot. The office no longer reads that env var: a static key is
// a `static` row in the tokens table (src/static-keys.mjs). So a suite states
// the same spec, in the same format, and this writes it into the oauth.db the
// office under test opens (`--oauth-db <path>`), through the module's own parse
// and its own INSERT, so a suite's rows are the import's rows.
//
//   spawn(node, [server.mjs, ..., "--oauth-db", seedStaticKeys(join(tmp, "oauth.db"), `${KEY}=keemin:wright`)], ...)

import { DatabaseSync } from "node:sqlite";
import { oauthSchema } from "../../src/oauth.mjs";
import { parseOfficeKeys, INSERT_STATIC, staticRowArgs } from "../../src/static-keys.mjs";

/** Write `spec` (OFFICE_KEYS's format) into the oauth.db at `path` as static rows. Answers `path`. */
export function seedStaticKeys(path, spec) {
  const db = new DatabaseSync(path);
  try {
    oauthSchema(db);
    const now = Math.floor(Date.now() / 1000);
    for (const [token, entry] of parseOfficeKeys(spec).keys) {
      const args = staticRowArgs(token, entry, now);
      db.prepare("DELETE FROM tokens WHERE token_hash = ? AND kind = 'static'").run(args[0]);
      db.prepare(INSERT_STATIC).run(...args);
    }
  } finally { db.close(); }
  return path;
}
