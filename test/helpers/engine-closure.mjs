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

// Every way a module names another by a relative path: `import … from`,
// `export … from`, a side-effect `import "./x.mjs"` and a dynamic
// `import("./x.mjs")`. A static one starts a statement (a line's start, or
// after a `;`, so two can share a line), which keeps a comment that mentions
// one out; a dynamic one stands wherever an expression can.
const RELATIVE_SPECIFIERS = [
  /(?:^|;)[ \t]*(?:import|export)\b[^;'"]*?\bfrom\s*["'](\.\.?\/[^"']+)["']/gm,
  /(?:^|;)[ \t]*import\s*["'](\.\.?\/[^"']+)["']/gm,
  /\bimport\s*\(\s*["'](\.\.?\/[^"']+)["']\s*\)/g,
];

/** The relative specifiers `text` imports or re-exports, in source order. PURE. */
export function relativeSpecifiers(text) {
  const found = [];
  for (const re of RELATIVE_SPECIFIERS) for (const m of text.matchAll(re)) found.push([m.index, m[1]]);
  return found.sort((a, b) => a[0] - b[0]).map(([, s]) => s);
}

/**
 * Copy each named module (a path under `tools/`) from the world checkout `from`
 * into `to`, with every module it imports or re-exports by a relative path,
 * transitively. Answers the paths copied, under `tools/`. A specifier that
 * leaves `tools/` (`../spectator/…`) throws: the fixture would load a module
 * this copy never made, and fail far from here.
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
    for (const spec of relativeSpecifiers(readFileSync(src, "utf8"))) {
      const next = posix.join(posix.dirname(rel), spec);
      if (next === ".." || next.startsWith("../"))
        throw new Error(`engine-closure: tools/${rel} imports "${spec}", which leaves tools/; copy what it names by hand`);
      queue.push(next);
    }
  }
  return [...seen];
}
