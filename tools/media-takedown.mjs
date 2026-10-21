#!/usr/bin/env node
// media-takedown — an operator takes one media file down at once (POS-737).
//
// Moderation: the original and its -96/-256 copies are deleted from storage
// now, whatever hangs them, and the ledger row keeps the receipt (who, why,
// when). The upload door then refuses the same bytes in every household. The
// law is src/media-sweep.mjs § takedown; this is its CLI.
//
//   node tools/media-takedown.mjs --url <media url> --reason "<why>" --by <operator>            DRY: names what it would do
//   node tools/media-takedown.mjs --url <media url> --reason "<why>" --by <operator> --apply    takes it down
//
//   --oauth-db <path>   the office's paper (default ./oauth.db)
//
// Env: the office's own (/etc/postmark-office.env): the store switch and the R2_* keys.
//
// Exit 0 done (or the dry answer) · 1 refused · 2 usage · 3 storage failed (the
// row is taken down and the next sweep retries the DELETE).

import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const USAGE = 'usage: node tools/media-takedown.mjs --url <media url> --reason "<why>" --by <operator> [--apply] [--oauth-db <path>]';

function isMain() {
  if (!process.argv[1]) return false;
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return pathToFileURL(process.argv[1]).href === import.meta.url; }
}

async function main() {
  const argv = process.argv.slice(2);
  const opt = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
  const url = opt("--url");
  if (!url) { console.error(`media-takedown: which file? --url\n${USAGE}`); process.exit(2); }
  const { openPaper, closePaperworkPools } = await import("../src/paperwork.mjs");
  const { oauthSchema } = await import("../src/oauth.mjs");
  const { takedown } = await import("../src/media-sweep.mjs");
  const odb = await openPaper(resolve(opt("--oauth-db") ?? "oauth.db"), { schema: oauthSchema });
  let out;
  try {
    out = await takedown({ odb, url, reason: opt("--reason"), by: opt("--by"), apply: argv.includes("--apply") });
  } finally {
    await closePaperworkPools();
    odb.close();
  }
  console.log(JSON.stringify(out, null, 2));
  process.exit(out.refused ? 1 : out.storage_failed ? 3 : 0);
}

if (isMain()) main().catch((e) => { console.error(e?.stack ?? e); process.exit(1); });
