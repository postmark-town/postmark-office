// media-ledger.mjs — a test's media ledger: the rows a hanging door checks
// against (POS-738), registered the way the server registers its own paper.
//
//   const ledger = holdMedia(URL_A, URL_B);   // these are held; nothing else is
//   seedMediaRows(db, URL_A);                 // rows into a ledger a spawned office opens
//
// Each URL must be one the media door mints (media.mjs § mediaUrlParts); a
// fixture URL that is not throws here, so a test can never "hold" an address
// the door itself would refuse. Returns the in-memory paper, for a test that
// wants to add rows later or read them back.

import { DatabaseSync } from "node:sqlite";
import { ensureMediaTable, mediaUrlParts, useMediaLedger } from "../../src/media.mjs";

export function seedMediaRows(db, ...urls) {
  ensureMediaTable(db);
  for (const url of urls) {
    const p = mediaUrlParts(url);
    if (!p || p.size) throw new Error(`holdMedia: ${url} is not an original the media door mints`);
    db.prepare("INSERT INTO media (household, sha, ext, bytes, by_handle, created) VALUES (?, ?, ?, ?, ?, ?)")
      .run(p.household, p.sha, p.ext, 1, "fixture", Date.now());
  }
  return db;
}

export function holdMedia(...urls) {
  const db = seedMediaRows(new DatabaseSync(":memory:"), ...urls);
  useMediaLedger(db);
  return db;
}
