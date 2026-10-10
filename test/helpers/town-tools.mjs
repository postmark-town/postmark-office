// town-tools.mjs — a fixture town carries the town's tools/ code whole (POS-419).
//
// Office tests build small towns in a scratch folder and run the town's own
// stamp-mint, stamp-verify or ballot-pass in them. Each test used to copy those
// tools BY NAME, so a town tool that gained an import broke every fixture that
// did not also name the new file: town #3439 makes stamp-mint, stamp-verify and
// settle import ./registry-source.mjs, and 40 office tests went red with
// ERR_MODULE_NOT_FOUND though nothing in the office had changed (measured
// 2026-10-09; the same miss had already bitten ballot-pass's envelope.mjs).
//
// So the fixture gets every module in the town's tools/: each `*.mjs` that is not
// a test. The town's DATA there (github-ids.json, households.json,
// meep-accounts.json, stamp-pubkey.pem) is not copied: it is the live town's,
// and a fixture writes its own or reads as a town without it.
//
//   import { copyTownTools } from "./helpers/town-tools.mjs";
//   copyTownTools(townClone(), repo);   // <repo>/tools/ now has the town's code

import { copyFileSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";

/** The town's own modules in `<town>/tools`: every `*.mjs` but its tests, sorted. */
export function townToolModules(town) {
  return readdirSync(join(town, "tools"))
    .filter((f) => f.endsWith(".mjs") && !f.endsWith(".test.mjs"))
    .sort();
}

/** Copy the town's modules into `<repo>/tools` (made if missing). Answers the names copied. */
export function copyTownTools(town, repo) {
  const to = join(repo, "tools");
  mkdirSync(to, { recursive: true });
  const names = townToolModules(town);
  for (const f of names) copyFileSync(join(town, "tools", f), join(to, f));
  return names;
}
