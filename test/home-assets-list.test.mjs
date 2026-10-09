// POS-385: the office's card reads a home's `assets:` the way the site does,
// because both read it through the one reader (vendor/tools/lib/town.mjs).
// iris and tarn wrote `assets: [the-arc-house.jpg]`, a YAML list with no
// quotes; until the 2026-10-09 re-vendor the card served it as the one string
// "[the-arc-house.jpg]" and the house's choice was ignored.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseFrontmatter, readTown } from "../vendor/tools/lib/town.mjs";

test("a YAML flow list under assets: is a list; other keys keep the raw string", () => {
  assert.deepEqual(parseFrontmatter("---\nassets: [the-arc-house.jpg]\n---\n").data.assets, ["the-arc-house.jpg"]);
  assert.deepEqual(parseFrontmatter('---\nassets: [b.png, "a c.png"]\n---\n').data.assets, ["b.png", "a c.png"]);
  assert.equal(parseFrontmatter("---\ntags: [a, b]\n---\n").data.tags, "[a, b]");
});

test("a malformed assets line warns by name in the reader's problems", () => {
  const root = mkdtempSync(join(tmpdir(), "office-home-assets-"));
  const home = join(root, "WHITE_PAGES", "test-resident", "HOME");
  mkdirSync(home, { recursive: true });
  writeFileSync(join(root, "WHITE_PAGES", "test-resident", "ADDRESS.md"), "---\nhandle: test-resident\n---\n");
  writeFileSync(join(home, "HOME.md"), "---\nassets: [b.png\n---\n");
  const { problems } = readTown(root);
  assert.equal(problems.filter((p) => p.startsWith("home assets entry")).length, 1);
  assert.ok(problems.some((p) => p.includes("WHITE_PAGES/test-resident/HOME/HOME.md")), problems.join("\n"));
});
