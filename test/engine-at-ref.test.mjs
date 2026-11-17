// The engine must come from a REF, not the working tree.
//
// The tree belongs to the write pen: the office tick fetches the world clone and
// never pulls, and a draft exec parks the checkout on a household branch — it sat
// on `draft/FluffUPando` the day this was written, one commit behind main and
// missing a module the office had just been taught to import. Before this, engine
// code reached the running office only when somebody's next write happened to
// rebase onto a newer main.
//
// The red control below is exactly that situation: a module that exists at main
// and does NOT exist in the checked-out tree.

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tempDir } from "./helpers/temp-dir.mjs";
import { pathToFileURL } from "node:url";
import { freshestMainRef, materializeAtRef } from "../src/world-branches.mjs";

const repo = tempDir("postmark-engine-ref-");
const cache = tempDir("postmark-engine-cache-");
after(() => { rmSync(repo, { recursive: true, force: true }); rmSync(cache, { recursive: true, force: true }); });
const git = (...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const put = (p, t) => { const f = join(repo, p); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, t); };

put("tools/thing.mjs", "export const answer = 'from the ref';\nexport { helper } from './helper.mjs';\n");
put("tools/helper.mjs", "export const helper = 'relative imports survive';\n");
git("init", "-q", "-b", "main");
git("add", "-A");
git("-c", "user.name=f", "-c", "user.email=f@t.invalid", "commit", "-q", "-m", "engine at main");

// Now do what the write pen does: park the checkout on a draft branch whose tree
// does NOT contain the module. main still has it; the working tree does not.
git("switch", "-q", "-c", "draft/somebody");
rmSync(join(repo, "tools/thing.mjs"));
git("add", "-A");
git("-c", "user.name=f", "-c", "user.email=f@t.invalid", "commit", "-q", "-m", "a draft branch without the module");

test("RED CONTROL: the tree is missing the module — importing from the tree would fail", () => {
  assert.equal(existsSync(join(repo, "tools/thing.mjs")), false,
    "fixture must reproduce the box: checked out on a draft branch, module absent");
});

test("materializeAtRef serves the module from main regardless of what is checked out", async () => {
  const dir = materializeAtRef(repo, "refs/heads/main", "tools", cache);
  const mod = await import(pathToFileURL(join(dir, "tools", "thing.mjs")));
  assert.equal(mod.answer, "from the ref");
  assert.equal(mod.helper, "relative imports survive",
    "the whole subtree is written out together, so ./helper.mjs still resolves");
});

test("it is cached by sha — a second call does not re-extract", () => {
  const a = materializeAtRef(repo, "refs/heads/main", "tools", cache);
  const b = materializeAtRef(repo, "refs/heads/main", "tools", cache);
  assert.equal(a, b);
  assert.match(a, /[0-9a-f]{40}/, "the cache key is the commit sha, so a new revision gets a new dir");
});

test("freshestMainRef prefers origin/main when the local branch lags", () => {
  // no remote configured yet → local main
  assert.equal(freshestMainRef(repo), "refs/heads/main");

  // give it a remote ref that is AHEAD of local main, the box's actual state
  git("switch", "-q", "main");
  put("tools/newer.mjs", "export const x = 1;\n");
  git("add", "-A");
  git("-c", "user.name=f", "-c", "user.email=f@t.invalid", "commit", "-q", "-m", "newer");
  git("update-ref", "refs/remotes/origin/main", "refs/heads/main");
  git("reset", "-q", "--hard", "HEAD~1"); // local main falls behind origin
  assert.equal(freshestMainRef(repo), "refs/remotes/origin/main",
    "the tick fetches and never pulls, so origin is the published truth");
});
