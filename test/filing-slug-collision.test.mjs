// #2723 — an identity-shaped filing belongs only to its full id.
// A different household using the same leaf slug is a new mark, not a
// reference to the first household's published path.

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "./helpers/temp-dir.mjs";
import { filedPathOfAt, pathFor, resetPathIndex } from "../src/world-journal.mjs";

function git(repo, ...args) {
  return execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();
}

function repoWith(...paths) {
  const repo = tempDir("postmark-2723-");
  git(repo, "init", "-q");
  git(repo, "config", "user.name", "fixture");
  git(repo, "config", "user.email", "fixture@example.invalid");
  for (const path of paths) {
    mkdirSync(join(repo, path, ".."), { recursive: true });
    writeFileSync(join(repo, path), "---\nkind: sited\n---\nfixture\n");
  }
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "fixture");
  return { repo, sha: git(repo, "rev-parse", "HEAD"), cleanup: () => rmSync(repo, { recursive: true, force: true }) };
}

test("#2723 — another household's identity-shaped mark is never a slug fallback", (t) => {
  const w = repoWith("WORLD/marks/vermillion/the-quiet-room/mark.md");
  t.after(w.cleanup);
  resetPathIndex();
  const filed = filedPathOfAt(w.repo, w.sha);

  assert.equal(filed("vermillion/the-quiet-room"), "WORLD/marks/vermillion/the-quiet-room/mark.md");
  assert.equal(filed("sophia-familiaris/the-quiet-room"), null,
    "a new full id with the same slug must not borrow Vermillion's filing");

  const own = pathFor({
    id: "sophia-familiaris/the-quiet-room",
    by: "sophia-familiaris",
    slug: "the-quiet-room",
    kind: "sited",
  }, { publishedPathOf: filed });
  assert.equal(own, "WORLD/marks/sophia-familiaris/the-quiet-room/mark.md");
});

test("#2723 — genuine non-identity legacy fossils still have the slug fallback", (t) => {
  const legacy = "WORLD/marks/old-geography/the-hill/inside/the-old-lamp/mark.md";
  const w = repoWith(legacy);
  t.after(w.cleanup);
  resetPathIndex();
  const filed = filedPathOfAt(w.repo, w.sha);
  assert.equal(filed("legacy-author/the-old-lamp"), legacy);
});
