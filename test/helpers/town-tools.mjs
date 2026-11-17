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

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { relativeImports } from "../../src/town-tool.mjs";

/** The town's own modules in `<town>/tools`: every `*.mjs` but its tests, sorted. */
export function townToolModules(town) {
  return readdirSync(join(town, "tools"))
    .filter((f) => f.endsWith(".mjs") && !f.endsWith(".test.mjs"))
    .sort();
}

/**
 * Copy the town's modules into `<repo>/tools` (made if missing). Answers the names copied.
 *
 * AND THE CODE THEY IMPORT FROM OUTSIDE tools/ (POS-1035, at town e9cb5e87): a module may import by a relative path out of
 * tools/ — witness-chain.mjs reads ../PROJECTS/the-town-seal/seal.mjs — and the office's loader and a fixture's own pins
 * (pinned-town.mjs § pinTown) read a module's whole closure, so a fixture holding the module without it fails. Each copied
 * module's relative-import closure is walked (src/town-tool.mjs § relativeImports, as pinned-town.mjs § copyTownModule walks it)
 * and the code files it names are copied at their town paths. Only code (`.mjs`/`.js`) travels: the town's data stays the live
 * town's, and a fixture's own (its key, its rolls) is never overwritten.
 */
export function copyTownTools(town, repo) {
  const to = join(repo, "tools");
  mkdirSync(to, { recursive: true });
  const names = townToolModules(town);
  for (const f of names) copyFileSync(join(town, "tools", f), join(to, f));
  const seen = new Set(names.map((f) => `tools/${f}`));
  const walk = (p) => {
    for (const d of relativeImports(p, readFileSync(join(town, p), "utf8"))) {
      if (seen.has(d) || !/\.m?js$/.test(d) || !existsSync(join(town, d))) continue;
      seen.add(d);
      mkdirSync(dirname(join(repo, d)), { recursive: true });
      copyFileSync(join(town, d), join(repo, d));
      walk(d);
    }
  };
  for (const f of names) walk(`tools/${f}`);
  return names;
}
