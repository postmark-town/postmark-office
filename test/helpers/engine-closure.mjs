// engine-closure.mjs — copy world engine modules into a fixture clone WITH what they import.
//
// A fixture that copies a named list of `tools/` modules goes stale the day an
// engine module gains an import. LOGOS v2 part 2's W2 world gave
// `tools/enter-exit.mjs` its first one (`./mark-kind.mjs`, which imports
// `./class-properties.mjs`), and the fixtures that copied enter-exit.mjs alone
// had an engine that could not load: every aboard read answered ashore, and the
// pen answered 501. The office materializes the whole `tools/` tree at a ref
// (src/world-branches.mjs § materializeAtRef), so the closure is what it loads.

import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, posix } from "node:path";

/**
 * Copy each named module (a path under `tools/`) from the world checkout `from`
 * into `to`, with every module it imports or re-exports by a relative path,
 * transitively. Answers the paths copied, under `tools/`.
 */
export function copyEngineFiles(from, to, names) {
  const seen = new Set();
  const queue = [...names];
  while (queue.length) {
    const rel = posix.normalize(queue.shift());
    if (seen.has(rel)) continue;
    seen.add(rel);
    const src = join(from, "tools", rel);
    mkdirSync(dirname(join(to, "tools", rel)), { recursive: true });
    copyFileSync(src, join(to, "tools", rel));
    for (const m of readFileSync(src, "utf8").matchAll(/(?:^|\n)\s*(?:import|export)\b[^;'"]*?\bfrom\s*["'](\.\.?\/[^"']+)["']/g))
      queue.push(posix.join(posix.dirname(rel), m[1]));
  }
  return [...seen];
}
