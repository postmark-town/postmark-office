#!/usr/bin/env node
// static-keys-retire.mjs — retire ONE static key by household and handle (POS-604).
//
//   node tools/static-keys-retire.mjs --household <slug> --handle <h> --dry
//   node tools/static-keys-retire.mjs --household <slug> --handle <h>
//   node tools/static-keys-retire.mjs --household <slug> --handle <h> --mirror-only
//
//   --oauth-db <path>  the office's sign-in file, the mirror (default: oauth.db
//                      at the repo root, as the import's)
//   --json             machine-readable output
//
// It takes NO key and NO hash, on the command line or anywhere else, and prints
// none. It needs the store: OFFICE_PAPERWORK_STORE=1, WORLD2_PG=1 and
// WORLD2_PG_URL in this process's environment, as the import does (on the box:
// the office's own env file, run as meepo; deploy/DEPLOY.md § Static keys leave
// the env file, "Retiring a static key"). src/static-keys-retire.mjs says how.
//
// --dry is ADVISORY: it names what an apply would do from the store as it is
// now, writes nothing, and binds nothing. The apply decides again, under locks.
//
// EXIT: 0 retired and the file verified, or repaired (--mirror-only), or a dry
//          run that would proceed
//       1 refused (no match, ambiguous, widened, no other working key, nothing
//          recorded to repair): NOTHING was written to the store
//       2 cannot run (usage, no store in this environment)
//       4 THE STORE COMMITTED but the file is not verified (missing, failed,
//          or reads back wrong): rerun the printed --mirror-only command
//       6 TABLE BUSY: another writer held oauth_tokens for the whole 2 s wait; the
//          lock was never taken, NOTHING changed: run it again
//       5 COMMIT was not acknowledged: the store may or may not hold the
//          retirement; check with --dry

import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { paperworkStoreOn, paperworkPoolTypes } from "../src/paperwork.mjs";
import { storePoolOptions } from "../src/store-pool.mjs";
import { planRetire, retireStaticKey, mirrorOnly } from "../src/static-keys-retire.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const argOf = (name) => { const i = argv.indexOf(name); return i !== -1 ? argv[i + 1] : null; };
const flag = (name) => argv.includes(name);
const die = (code, msg) => { console.error(msg); process.exit(code); };

const KNOWN = new Set(["--household", "--handle", "--dry", "--mirror-only", "--oauth-db", "--json"]);
for (const a of argv.filter((x) => x.startsWith("--")))
  if (!KNOWN.has(a)) die(2, `static-keys-retire: unknown option ${a}. It takes --household, --handle, --dry, --mirror-only, --oauth-db, --json: never a key or a hash.`);

const household = argOf("--household");
const handle = argOf("--handle");
if (!household || !handle || household.startsWith("--") || handle.startsWith("--"))
  die(2, "static-keys-retire: --household <slug> and --handle <h> are both required.");
if (flag("--dry") && flag("--mirror-only")) die(2, "static-keys-retire: --dry and --mirror-only do not combine.");

const JSON_OUT = flag("--json");
const FILE = resolve(argOf("--oauth-db") ?? resolve(ROOT, "oauth.db"));

async function main() {
  if (!paperworkStoreOn() || process.env.WORLD2_PG !== "1" || !process.env.WORLD2_PG_URL)
    die(2, "static-keys-retire: this needs the store (OFFICE_PAPERWORK_STORE=1, WORLD2_PG=1, WORLD2_PG_URL). Load the office's env file as the DEPLOY section says.");
  const { default: pg } = await import("pg");
  const pool = new pg.Pool(storePoolOptions(process.env, { name: "static-keys-retire", max: 2, connectionString: process.env.WORLD2_PG_URL, types: paperworkPoolTypes(pg) }));
  pool.on("error", () => { /* an idle client; the verbs below carry their own failures */ });
  let out;
  try {
    out = flag("--mirror-only") ? await mirrorOnly(pool, { household, handle, file: FILE })
      : flag("--dry") ? await planRetire(pool, { household, handle, file: FILE })
      : await retireStaticKey(pool, { household, handle, file: FILE });
  } finally { await pool.end().catch(() => {}); }

  if (JSON_OUT) console.log(JSON.stringify(out, null, 1));
  else report(out);
  return { dry: 0, retired: 0, repaired: 0, refused: 1, mirror_failed: 4, commit_unknown: 5, busy: 6 }[out.status] ?? 1;
}

function report(out) {
  const where = `${household}/${handle}`;
  switch (out.status) {
    case "dry":
      console.log(`DRY RUN, nothing written. ${where}: would retire 1 static key (cover: ${out.cover}, ${out.cover_count} standing).`);
      console.log(`  the key: imported ${out.target_created ?? "at an unrecorded time"}, ${out.target_has_gh_id ? "pinned to a gh_id" : "no gh_id"}; static keys in this household: ${out.household_static_keys_now} now, ${out.household_static_keys_left} after`);
      console.log(`  file ${FILE}: ${out.file}`);
      if (out.retired_recorded) console.log(`  ${out.retired_recorded} earlier retirement${out.retired_recorded === 1 ? "" : "s"} already recorded for this selector.`);
      console.log("  advisory only: the real run decides again, under locks.");
      break;
    case "retired":
      console.log(`${out.message} (cover: ${out.cover}; oauth_tokens was write-locked for ${out.lock_held_ms} ms)`);
      console.log(`  the key: imported ${out.target_created ?? "at an unrecorded time"} (the tombstone keeps that), ${out.target_has_gh_id ? "pinned to a gh_id" : "no gh_id"}; retired ${out.retired_at}; static keys left in this household: ${out.household_static_keys_left}`);
      break;
    case "repaired": console.log(out.message); break;
    case "refused":
      console.error(`static-keys-retire: refused ${where}: ${out.reason}. ${out.dry ? "(dry run)" : "Nothing was written to the store."}`);
      if (out.hint) console.error(`  ${out.hint}`);
      break;
    case "mirror_failed": console.error(`static-keys-retire: ${out.message}`); break;
    case "busy": console.error(`static-keys-retire: ${out.message}`); break;
    case "commit_unknown": console.error(`static-keys-retire: ${out.message}`); break;
    default: console.error(`static-keys-retire: ${JSON.stringify(out)}`);
  }
}

main().then((code) => process.exit(code), (e) => die(1, `static-keys-retire: ${String(e?.message ?? e).replace(/\([^)]*\)=\([^)]*\)/g, "(…)").slice(0, 200)}`));
