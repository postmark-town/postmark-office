// No old owner (POS-499, GitHub #2946). The office, the world and the site moved
// to the postmark-town org (POS-115), and GitHub's redirect from the old
// keeminlee names lasts only while nobody creates a repo at an old name. So no
// tracked file of this repo may spell a postmark-* repo under the old owner,
// either as one string (`<old>/postmark-world`) or split into an owner field
// (`owner: "<old>", name: "postmark-site"`, the site sentinel's shape until
// POS-499). The exceptions are named below, each with its reason (Wright's
// Rung 0 verdict, 2026-10-10, and the gap read's G2, 2026-10-13).
//
// The old owner is assembled, never spelled whole, so this file is not a hit.

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const OLD = ["keemin", "lee"].join("");

// Generated data, not ours to re-spell: the GitHub traffic snapshots record
// what the API answered on their day.
const GENERATED = ["telemetry/"];

// path → the exact text that may stay there, and why.
const KEEPS = [
  { path: "deploy/postmark-world2-clearing.timer", text: `${OLD}/postmark-world#96`,
    why: "the 09-17 PR's name when it was written, kept as a historical name (gap read G2)" },
  { path: "deploy/world2-clearing.sh", text: `${OLD}/postmark-world#96`,
    why: "the same historical PR name; and the box's copy is byte-compared by the roll-call row world2-ops-scripts" },
  { path: "world2/tools/window-reanchor.mjs", text: `${OLD}/postmark-world#96`,
    why: "the same historical PR name, kept with its two siblings" },
  { path: "deploy/world2-backup.sh", text: `${OLD}/postmark-office-private-archive`,
    why: "a real private archive repo that stays under the old owner" },
];

const PATTERN = `${OLD}/postmark-|owner["']?[[:space:]]*:[[:space:]]*["']${OLD}["'][[:space:]]*,[[:space:]]*name["']?[[:space:]]*:[[:space:]]*["']postmark`;

function hits() {
  let out = "";
  try {
    out = execFileSync("git", ["-C", ROOT, "grep", "-n", "-I", "-E", PATTERN, "--", ".", ...GENERATED.map((p) => `:!${p}`)], { encoding: "utf8" });
  } catch (e) {
    if (e.status === 1) return [];   // git grep: no match
    throw e;
  }
  return out.split("\n").filter(Boolean).map((line) => {
    const [path, n, ...rest] = line.split(":");
    return { path, line: Number(n), text: rest.join(":") };
  });
}

test("no tracked file spells a postmark-* repo under the old owner, apart from the named keeps", () => {
  const offenders = hits().filter((h) => !KEEPS.some((k) => k.path === h.path && h.text.includes(k.text)));
  assert.deepEqual(offenders.map((h) => `${h.path}:${h.line}: ${h.text.trim()}`), [],
    "re-spell these to postmark-town (or name a keep here, with its reason)");
});

test("every named keep is still there, so the list cannot go stale silently", () => {
  const found = hits();
  for (const k of KEEPS) {
    assert.ok(found.some((h) => h.path === k.path && h.text.includes(k.text)), `${k.path} no longer carries ${k.text}: drop the keep`);
  }
});

test("the split owner form is caught too", () => {
  const sample = `  siteRepo: { owner: "${OLD}", name: "postmark-site" },`;
  const re = new RegExp(PATTERN.replaceAll("[[:space:]]", "\\s"));
  assert.match(sample, re);
  assert.doesNotMatch(`  { owner: "${OLD}", name: "starforge-atelier" },`, re, "the old owner's own repos are not postmark-*");
});
