#!/usr/bin/env node
// static-keys-import.mjs — OFFICE_KEYS into the store, by hash (POS-352 part 2).
//
//   node tools/static-keys-import.mjs --dry      # what it would write; writes nothing
//   node tools/static-keys-import.mjs            # one static row per key, one transaction
//
//   --oauth-db <path>  the office's sign-in file (default: oauth.db at the repo
//                      root, the server's own default)
//   --json             machine-readable output
//
// It reads OFFICE_KEYS from THIS PROCESS'S ENVIRONMENT, in the format the
// office parsed at boot until POS-352, and writes one `static` row per key into
// the tokens table (src/static-keys.mjs § importStaticKeys). On the box, run it
// with the office's own env file loaded, so it reads the same OFFICE_KEYS and
// writes the same book the office reads:
//
//   sudo bash -c 'set -a; . /etc/postmark-office.env; set +a; cd /srv/postmark-office && node tools/static-keys-import.mjs --dry'
//
// ── NOTHING SECRET IS PRINTED ───────────────────────────────────────────────
//
// Counts, and the households the keys name. Never a key, never any part of a
// hash. An entry the parse skips (malformed) is counted, not shown, because the
// line holds a key.
//
// ── IDEMPOTENT, AND IT NEVER REVOKES ────────────────────────────────────────
//
// A second run with the same OFFICE_KEYS writes nothing ("unchanged"). An entry
// whose row says something else is replaced. A key whose hash already belongs
// to another kind of token is refused, and then nothing at all is written. A
// static row the env no longer names is counted ("not in OFFICE_KEYS") and left
// in place: removing a key is a decision, not a side effect of an import.
//
// ── A RETIRED KEY IS NOT WRITTEN BACK (POS-604) ─────────────────────────────
//
// tools/static-keys-retire.mjs leaves a `retired` row on the key's hash. An
// OFFICE_KEYS entry that hashes to one is REFUSED BY NAME ("household:handles",
// never the key), counted apart, and every other eligible entry still imports.
// The first line of output says which of three things happened, and the exit
// status matches:
//
//   complete     exit 0   every entry was written or already right
//   partial      exit 3   the rest COMMITTED; N entries were refused as retired
//   rolled_back  exit 1   a foreign kind (access, refresh, household) owns a
//                         hash, so NOTHING was written, even when a retired
//                         entry is also named
//   (exit 2: OFFICE_KEYS is not set)
//
// A dry run follows the same words and codes and writes nothing.
//
// A key the owner deleted by hand BEFORE retirement existed has no row, so there
// is no hash to refuse: remove its entry from the OFFICE_KEYS you import from.
//
// ── WHICH BOOK (POS-271) ────────────────────────────────────────────────────
//
// With OFFICE_PAPERWORK_STORE=1 and the store's WORLD2_PG / WORLD2_PG_URL in
// the environment, the rows go to the store's oauth_tokens (070 must have run)
// and then to the file, as the office's own mirror does. Without them, to the
// file only. The first line says which.

import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { oauthSchema } from "../src/oauth.mjs";
import { openPaper, paperworkStoreOn, closePaperworkPools } from "../src/paperwork.mjs";
import { importStaticKeys } from "../src/static-keys.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argOf = (name, fallback = null) => {
  const i = process.argv.indexOf(name);
  return i !== -1 ? process.argv[i + 1] : fallback;
};
const flag = (name) => process.argv.includes(name);

const DRY = flag("--dry");
const JSON_OUT = flag("--json");
const OAUTH_DB = resolve(argOf("--oauth-db", resolve(ROOT, "oauth.db")));

const die = (code, msg) => { console.error(msg); process.exit(code); };

async function main() {
  const spec = process.env.OFFICE_KEYS ?? "";
  if (!spec.trim())
    die(2, "static-keys-import: OFFICE_KEYS is not set in this environment, so there is nothing to import.\n"
      + "On the box: sudo bash -c 'set -a; . /etc/postmark-office.env; set +a; cd /srv/postmark-office && node tools/static-keys-import.mjs --dry'");

  let paper;
  try {
    paper = await openPaper(OAUTH_DB, { schema: oauthSchema });
  } catch (e) {
    die(1, paperworkStoreOn()
      ? `static-keys-import: could not reach the store (OFFICE_PAPERWORK_STORE=1): ${String(e?.message ?? e)}`
      : `static-keys-import: could not open ${OAUTH_DB}: ${String(e?.message ?? e)}`);
  }
  const book = paper.onStore
    ? `the store (oauth_tokens)${paper.file ? `, mirrored to ${OAUTH_DB}` : ""}`
    : OAUTH_DB;

  let out;
  try { out = await importStaticKeys(paper, spec, { dry: DRY }); }
  finally { paper.close(); await closePaperworkPools(); }

  if (JSON_OUT) { console.log(JSON.stringify({ book, dry: DRY, ...out }, null, 1)); }
  else {
    console.log(`${DRY ? "DRY RUN, nothing written. " : ""}book: ${book}`);
    console.log(`outcome: ${out.outcome}${out.outcome === "partial" ? ` (the rest ${DRY ? "would commit" : "COMMITTED"}; ${out.retired_refused} refused as retired)` : out.outcome === "rolled_back" ? ` (${DRY ? "a real run would write" : "the import wrote"} nothing)` : ""}`);
    console.log(`OFFICE_KEYS: ${out.entries} key${out.entries === 1 ? "" : "s"}${out.skipped ? `, ${out.skipped} malformed entr${out.skipped === 1 ? "y" : "ies"} skipped` : ""}`);
    console.log(`  ${DRY ? "would add" : "added"} ${out.added} · ${DRY ? "would replace" : "replaced"} ${out.replaced} · unchanged ${out.unchanged} · refused ${out.refused}`);
    console.log(`  static rows not in OFFICE_KEYS (left alone): ${out.not_in_spec}`);
    for (const n of out.retired) console.log(`  RETIRED, refused by name: ${n}`);
    console.log(`  households: ${out.households.join(", ") || "(none)"}`);
    for (const w of out.warnings) console.log(`  WARN: ${w}`);
  }
  if (out.refused > 0)
    die(1, `static-keys-import: ${out.refused} key${out.refused === 1 ? "" : "s"} already belong${out.refused === 1 ? "s" : ""} to another kind of token, so ${DRY ? "a real run would write" : "the import wrote"} nothing. Find the entry by its household and issue it a new key.`);
  if (out.entries === 0) die(1, "static-keys-import: no entry in OFFICE_KEYS parsed, so nothing was imported.");
  return out.outcome === "partial" ? 3 : 0;
}

main().then((code) => process.exit(code), (e) => die(1, `static-keys-import: ${String(e?.message ?? e)}`));
