// drafts-not-canon.test.mjs — a draft is described as what it is, never as private (POS-752).
//
// The doors told residents a draft was "private", "yours alone", "in no export, in no
// archive and in no public answer", and "nobody can see you are working on it". That
// overclaimed: drafts were written to public draft/<household> branches of the world
// repository until 2026-09-11, and live in the office's store since; either way "private"
// was not the accurate word. Darko's ruling, 2026-10-21: "say the accurate thing that matters: they
// are not the town's canon and live only in your own reading of the world". Wording only;
// no behaviour changed.
//
// This holds two things: no string a door can say (code outside comments, and the
// roster and sandbox docs built from it) makes the old privacy claim, and the main
// surfaces say Darko's sentence.
//
//   node --import ./test/helpers/sparse-guard.mjs --test test/drafts-not-canon.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

// The claims the ruling retires. Each is a phrase that only ever described a draft.
const RETIRED = [
  /private drafts?/i,
  /no public answer/i,
  /in no archive/i,
  /YOURS AND PRIVATE/,
  /private sketchbook/i,
  /draft stays private/i,
  /drafts are yours alone/i,
  /sketchbook is (yours|theirs)/i,
  /private\/public (line|boundary)/i,
  /nobody can see you are working on it/i,
  // the review of #726: two the first pass missed, and one softer overclaim
  /private compose/i,
  /invisible to everyone else/i,
  /nobody else can ask this question about you/i,
  /makes it public/i,
  // the train takes main (w43.20): one more the hotfix's sweep missed
  /draft only your household sees/i,
];

/** The lines of a source a resident can be told: comment lines dropped (the reasoning there names the old wording on purpose). */
function sayableLines(text) {
  return text.split("\n").map((line, i) => ({ line, n: i + 1 })).filter(({ line }) => !/^\s*(\/\/|\*|\/\*)/.test(line));
}

test("no door says a draft is private: src/, the MCP roster and the sandbox guide", () => {
  const files = [
    ...readdirSync(join(ROOT, "src")).filter((f) => f.endsWith(".mjs")).map((f) => `src/${f}`),
    "docs/MCP-ROSTER.md", "tools/SANDBOX.md",
  ];
  const found = [];
  for (const f of files)
    for (const { line, n } of sayableLines(read(f)))
      for (const re of RETIRED) if (re.test(line)) found.push(`${f}:${n} ${re}`);
  assert.deepEqual(found, [], `a retired privacy claim is back (POS-752):\n${found.join("\n")}`);
});

test("the main draft surfaces say Darko's sentence: not the town's canon, living only in your own reading of the world", async () => {
  process.env.WORLD_APEX = "";
  const { TOOLS } = await import("../src/mcp.mjs");
  const desc = (name) => JSON.stringify(TOOLS.find((t) => t.name === name));
  const CANON = "not the town's canon";
  const READING = /lives? only in (your|its) own (household's )?reading of the world/;

  assert.ok(desc("read_marks").includes(CANON) && READING.test(desc("read_marks")), "read_marks says what drafts_mine is");
  assert.ok(desc("world_leave_mark").includes(CANON) && READING.test(desc("world_leave_mark")), "leave-mark's stamps field says what an unstaked mark is");
  assert.ok(desc("world_stake").includes("the line between your drafts and the town's canon"), "the stake door names the line by canon, not privacy");

  for (const f of ["src/town-marks.mjs", "src/mark-receipt.mjs", "src/world.mjs", "src/world2-serve.mjs", "src/world-hold.mjs"]) {
    const text = sayableLines(read(f)).map(({ line }) => line).join("\n");
    assert.ok(text.includes(CANON) && READING.test(text), `${f} carries the ruled sentence`);
  }
});
