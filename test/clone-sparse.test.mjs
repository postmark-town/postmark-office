// clone-sparse — the pinned clones check out only what the suite reads, and a read
// outside that set is a loud red (POS-652, Darko 2026-10-15 19:51: "sparse checkout
// 100% ... We should never be checking out the full town clone at this point").
//
// Four things, each against a real git repo in a temp dir:
//   · test/clone-sparse.json is well-formed: every pattern anchored and naming its reader;
//   · this tree's own clones (a pool tree's, CI's) hold exactly that set;
//   · test/helpers/sparse-guard.mjs throws on a read, a probe or a listing of a path that
//     is in the clone's commit but outside its patterns, names the path, and reds the
//     process even when the throw is caught; an `unlisted` absence passes;
//   · a stand-in (test/helpers/dev-target.mjs's scratch clones) leaves out only the older
//     letters and the older STATE/log metas, and its office can still `git add` a new letter.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

import { CLONES, OFFICE, applySparse, globMatch, patternsOf, readSparse, sparseProblem, standinClone, standinPatterns } from "./helpers/clone-sparse.mjs";
import { tempDir } from "./helpers/temp-dir.mjs";

const GUARD = pathToFileURL(join(OFFICE, "test", "helpers", "sparse-guard.mjs")).href;
const git = (repo, ...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8" }).trim();

/** A repo holding `files` (path → text), one commit. */
function repoWith(files, date = null) {
  const dir = tempDir("clone-sparse-src-");
  git(dir, "init", "-q");
  for (const [p, text] of Object.entries(files)) { mkdirSync(dirname(join(dir, p)), { recursive: true }); writeFileSync(join(dir, p), text); }
  git(dir, "add", "-A");
  execFileSync("git", ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@t.invalid", "commit", "-qm", "seed"],
    { env: { ...process.env, ...(date ? { GIT_COMMITTER_DATE: date, GIT_AUTHOR_DATE: date } : {}) }, windowsHide: true });
  return dir;
}

/** A sparse clone of `source` with `patterns`, its config naming `set`. */
function sparseCloneOf(source, patterns, set) {
  const dir = join(tempDir("clone-sparse-"), "clone");
  execFileSync("git", ["clone", "--quiet", "--no-checkout", source, dir]);
  applySparse(dir, patterns, set);
  git(dir, "-c", "advice.detachedHead=false", "checkout", "-q", "--detach", "HEAD");
  return dir;
}

/** Runs `body` (an ES module's text) in a child carrying the guard, with TOWN_CLONE at `clone`. */
function guarded(clone, body) {
  const r = spawnSync(process.execPath, ["--import", GUARD, "--input-type=module", "-e", body],
    // its own misses file (it is the root of its tree): these children miss on purpose,
    // and a miss must never reach the run this file is part of
    { encoding: "utf8", windowsHide: true, env: { ...process.env, NODE_OPTIONS: "", POSTMARK_SPARSE_MISSES: "", TOWN_CLONE: clone, WORLD_CLONE: "" } });
  return { code: r.status, out: r.stdout.trim(), err: r.stderr };
}

test("every pattern in test/clone-sparse.json is anchored and names who reads it", () => {
  const spec = readSparse();
  for (const which of CLONES) {
    const pats = spec[which].patterns;
    assert.ok(pats.length > 2, `${which}: a set`);
    assert.equal(pats[0].pattern, "/*", `${which}: the root files first`);
    for (const p of pats) {
      assert.match(p.pattern, /^!?\//, `${which}: ${p.pattern} is anchored at the clone's root`);
      assert.ok(typeof p.readers === "string" && p.readers.length > 10, `${which}: ${p.pattern} names its readers`);
    }
    for (const u of spec[which].unlisted ?? []) assert.ok(u.entry && u.readers?.length > 10, `${which}: unlisted ${u.entry} names its readers`);
  }
  assert.deepEqual(patternsOf("town").filter((p) => p.includes("inbox")), ["!/WHITE_PAGES/*/inbox/"], "the letters are out of the town's set");
});

for (const which of CLONES) {
  const clone = join(OFFICE, `${which}-clone`);
  test(`this tree's ${which}-clone is sparse per test/clone-sparse.json`, { skip: existsSync(join(clone, ".git")) ? false : `no ${which}-clone in ${OFFICE}` }, () => {
    assert.equal(sparseProblem(clone, which), null);
  });
}

test("the guard: a read, a probe or a listing outside the set throws and names the path", () => {
  const src = repoWith({ "tools/a.mjs": "export const a = 1;\n", "WHITE_PAGES/r/ADDRESS.md": "addr\n", "WHITE_PAGES/r/inbox/old-letter.md": "dear\n", "README.md": "hi\n" });
  const clone = sparseCloneOf(src, ["/*", "!/*/", "/tools/", "/WHITE_PAGES/", "!/WHITE_PAGES/*/inbox/"], "town");
  assert.ok(!existsSync(join(clone, "WHITE_PAGES", "r", "inbox")), "the letter is not checked out");
  const r = guarded(clone, `
    import fs, { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
    import { join } from "node:path";
    const C = process.env.TOWN_CLONE, out = [];
    const tryIt = (name, f) => { try { out.push(name + ":ok:" + JSON.stringify(f())); } catch (e) { out.push(name + ":" + (e.code ?? e.message)); } };
    tryIt("read-in", () => readFileSync(join(C, "tools", "a.mjs"), "utf8").includes("export"));
    tryIt("exists-absent-from-commit", () => existsSync(join(C, "WHITE_PAGES", "nobody")));
    tryIt("stat-absent-from-commit", () => statSync(join(C, "nope"), { throwIfNoEntry: false }) ?? null);
    tryIt("exists-out", () => existsSync(join(C, "WHITE_PAGES", "r", "inbox", "old-letter.md")));
    tryIt("read-out", () => readFileSync(join(C, "WHITE_PAGES", "r", "inbox", "old-letter.md"), "utf8"));
    tryIt("list-room", () => readdirSync(join(C, "WHITE_PAGES", "r")));
    tryIt("list-root", () => readdirSync(C).sort());
    await fs.promises.readFile(join(C, "WHITE_PAGES", "r", "inbox", "old-letter.md")).then(() => out.push("promise-out:ok"), (e) => out.push("promise-out:" + e.code));
    console.log(out.join("\\n"));
  `);
  const lines = r.out.split("\n");
  assert.deepEqual(lines, [
    "read-in:ok:true",
    "exists-absent-from-commit:ok:false",
    "stat-absent-from-commit:ok:null",
    "exists-out:ESPARSE",
    "read-out:ESPARSE",
    "list-room:ESPARSE",
    "list-root:ok:[\".git\",\"README.md\",\"WHITE_PAGES\",\"tools\"]",
    "promise-out:ESPARSE",
  ], r.err);
  assert.match(r.err, /town-clone\/WHITE_PAGES\/r\/inbox\/old-letter\.md is not checked out: in the town clone's commit \(\w{9}\) but outside test\/clone-sparse\.json's "town" patterns/);
  assert.match(r.err, /a listing of town-clone\/WHITE_PAGES\/r lacks 1 entry \(WHITE_PAGES\/r\/inbox\)/);
  assert.equal(r.code, 1, "a miss reds the process, though every throw above was caught");
});

test("the guard: a clean run exits 0, a full clone is never guarded, and an unlisted absence passes", () => {
  const src = repoWith({ "tools/a.mjs": "1\n", "STATE/log/1.jsonl": "{}\n", "STATE/log/1.meta.json": "{}\n", "LOGOS/x.md": "x\n" });
  // the world set's `unlisted`: STATE/log/*.meta.json may be missing from a listing of STATE/log
  const world = sparseCloneOf(src, ["/*", "!/*/", "/tools/", "/STATE/", "!/STATE/log/*.meta.json"], "world");
  const listing = guarded(world, `import { readdirSync } from "node:fs"; import { join } from "node:path"; console.log(readdirSync(join(process.env.TOWN_CLONE, "STATE", "log")).join(","));`);
  assert.deepEqual([listing.code, listing.out], [0, "1.jsonl"], listing.err);
  // the same clone's LOGOS is outside the set, and the world set has no unlisted for it
  const probe = guarded(world, `import { existsSync } from "node:fs"; import { join } from "node:path"; try { existsSync(join(process.env.TOWN_CLONE, "LOGOS", "x.md")); console.log("silent"); } catch (e) { console.log(e.code); }`);
  assert.deepEqual([probe.code, probe.out], [1, "ESPARSE"], probe.err);
  // a full clone (no postmark.sparse) reads as it always did: nothing missing, nothing guarded
  const full = join(tempDir("clone-sparse-full-"), "clone");
  execFileSync("git", ["clone", "--quiet", src, full]);
  const plain = guarded(full, `import { existsSync } from "node:fs"; import { join } from "node:path"; console.log(existsSync(join(process.env.TOWN_CLONE, "nope")));`);
  assert.deepEqual([plain.code, plain.out], [0, "false"], plain.err);
});

test("the guard carries itself into a child node process", () => {
  const src = repoWith({ "tools/a.mjs": "1\n", "MEEPS/m.md": "m\n" });
  const clone = sparseCloneOf(src, ["/*", "!/*/", "/tools/"], "town");
  const r = guarded(clone, `
    import { spawnSync } from "node:child_process";
    const c = spawnSync(process.execPath, ["--input-type=module", "-e", 'import { readFileSync } from "node:fs"; try { readFileSync(process.env.TOWN_CLONE + "/MEEPS/m.md"); console.log("read"); } catch (e) { console.log(e.code); }'], { encoding: "utf8", windowsHide: true });
    console.log(c.stdout.trim() + " " + c.status);
  `);
  assert.equal(r.out, "ESPARSE 1", r.err);
});

test("a miss in a spawned process the test never asks about still reds the root (an office server's)", () => {
  const src = repoWith({ "tools/a.mjs": "1\n", "MEEPS/m.md": "m\n" });
  const clone = sparseCloneOf(src, ["/*", "!/*/", "/tools/"], "town");
  // the child swallows its miss and exits 0; the parent never looks at it
  const r = guarded(clone, `
    import { spawnSync } from "node:child_process";
    spawnSync(process.execPath, ["--input-type=module", "-e", 'import { readFileSync } from "node:fs"; try { readFileSync(process.env.TOWN_CLONE + "/MEEPS/m.md"); } catch {} process.exit(0);'], { windowsHide: true, stdio: "ignore" });
    console.log("parent done");
  `);
  assert.equal(r.out, "parent done");
  assert.equal(r.code, 1, "the root reds on its tree's misses");
  assert.match(r.err, /1 miss\(es\) in child processes of this run:\n\[clone-sparse\] town-clone\/MEEPS\/m\.md is not checked out/);
});

test("the guard: a link into the clone, a copy, an opendir and a realpath are guarded too", () => {
  const src = repoWith({ "tools/a.mjs": "1\n", "WHITE_PAGES/r/ADDRESS.md": "a\n", "WHITE_PAGES/r/inbox/l.md": "l\n" });
  const clone = sparseCloneOf(src, ["/*", "!/*/", "/tools/", "/WHITE_PAGES/", "!/WHITE_PAGES/*/inbox/"], "town");
  const r = guarded(clone, `
    import { symlinkSync, readdirSync, cpSync, opendirSync, realpathSync, mkdtempSync, existsSync } from "node:fs";
    import { join } from "node:path";
    import { tmpdir } from "node:os";
    const C = process.env.TOWN_CLONE, out = [], scratch = mkdtempSync(join(tmpdir(), "guard-link-"));
    const tryIt = (name, f) => { try { f(); out.push(name + ":ok"); } catch (e) { out.push(name + ":" + (e.code ?? e.message)); } };
    tryIt("link-read-in", () => { symlinkSync(join(C, "WHITE_PAGES"), join(scratch, "wp"), process.platform === "win32" ? "junction" : undefined); readdirSync(join(scratch, "wp")); });
    tryIt("link-probe-out", () => existsSync(join(scratch, "wp", "r", "inbox", "l.md")));
    tryIt("copy-in", () => cpSync(join(C, "tools"), join(scratch, "tools"), { recursive: true }));
    tryIt("copy-out", () => cpSync(join(C, "WHITE_PAGES"), join(scratch, "wp-copy"), { recursive: true }));
    tryIt("opendir-out", () => opendirSync(join(C, "WHITE_PAGES", "r")).closeSync());
    tryIt("realpath-out", () => realpathSync(join(C, "WHITE_PAGES", "r", "inbox")));
    console.log(out.join("\\n"));
  `);
  assert.deepEqual(r.out.split("\n"), ["link-read-in:ok", "link-probe-out:ESPARSE", "copy-in:ok", "copy-out:ESPARSE", "opendir-out:ESPARSE", "realpath-out:ESPARSE"], r.err);
  assert.match(r.err, /a copy of town-clone\/WHITE_PAGES would leave out 1 file \(WHITE_PAGES\/r\/inbox\/l\.md\)/);
});

test("the guard: a clone whose git config cannot be read is a miss, never a silent pass", () => {
  const dir = tempDir("clone-sparse-gitfile-");
  const clone = join(dir, "clone");
  mkdirSync(clone);
  writeFileSync(join(clone, ".git"), "gitdir: ./no-such-git-dir\n"); // a gitfile that leads nowhere
  const r = guarded(clone, `import { existsSync } from "node:fs"; console.log(existsSync(process.env.TOWN_CLONE + "/x"));`);
  assert.equal(r.out, "false");
  assert.equal(r.code, 1);
  assert.match(r.err, /\[clone-sparse\] cannot read the git config of .*clone/);
});

test("globMatch keeps * within one path segment", () => {
  assert.ok(globMatch("STATE/log/*.meta.json", "STATE/log/118.meta.json"));
  assert.ok(globMatch("STATE/log/*.meta.json", "STATE/log/226.3619.journal.meta.json"));
  assert.ok(!globMatch("STATE/log/*.meta.json", "STATE/log/118.jsonl"));
  assert.ok(!globMatch("*", "MEEPS/x"));
  assert.ok(globMatch("*", "MEEPS"));
});

test("a town stand-in leaves out the letters older than its source's own last days, and its office can add a new one", () => {
  // the source's HEAD is dated 2026-10-10 (a pin days behind the wall): the cutoff is two
  // days before THAT, never before today, so a stand-in made today keeps the pin's last days
  const src = repoWith({
    "WHITE_PAGES/r/ADDRESS.md": "a\n",
    "WHITE_PAGES/r/inbox/x-2026-09-01-to-r-old.md": "old\n",
    "WHITE_PAGES/r/inbox/2026-07-24-to-r-dated-first.md": "old too\n",
    "WHITE_PAGES/r/inbox/w-2026-10-07-to-r-last-week.md": "older than the cutoff, in its month\n",
    "WHITE_PAGES/r/inbox/x-2026-10-09-to-r-recent.md": "the pin's last days\n",
    "WHITE_PAGES/r/inbox/.gitkeep": "",
    "WHITE_PAGES/r/outbox/x-2026-09-01-to-s.md": "outbox stays whole\n",
    "MEEPS/m/m.md": "m\n",
  }, "2026-10-10T14:12:55Z");
  assert.deepEqual(standinPatterns("town", src), ["/*", "!/WHITE_PAGES/*/inbox/2026-07-*", "!/WHITE_PAGES/*/inbox/w-2026-10-07-*", "!/WHITE_PAGES/*/inbox/x-2026-09-*"]);
  // a synthetic clock (tools/stamp-sandbox.mjs) names its own first day: only letters before it go
  assert.deepEqual(standinPatterns("town", src, { before: "2026-08-01" }), ["/*", "!/WHITE_PAGES/*/inbox/2026-07-*"]);
  const dest = join(tempDir("clone-sparse-standin-"), "town-clone");
  standinClone("town", src, dest);
  const inbox = join(dest, "WHITE_PAGES", "r", "inbox");
  assert.deepEqual(["x-2026-09-01-to-r-old.md", "2026-07-24-to-r-dated-first.md", "w-2026-10-07-to-r-last-week.md", "x-2026-10-09-to-r-recent.md", ".gitkeep"].map((f) => existsSync(join(inbox, f))), [false, false, false, true, true]);
  assert.ok(existsSync(join(dest, "MEEPS", "m", "m.md")) && existsSync(join(dest, "WHITE_PAGES", "r", "outbox", "x-2026-09-01-to-s.md")), "everything else is there");
  assert.equal(git(dest, "config", "--get", "postmark.sparse"), "standin-town", "a stand-in is not a guarded set");
  // a new letter, and a reply whose name carries its older parent's date: both add
  writeFileSync(join(inbox, "y-2026-10-15-to-r-new.md"), "new\n");
  writeFileSync(join(inbox, "z-2026-10-16-to-r-re-x-2026-09-01-to-r-old.md"), "a reply\n");
  git(dest, "add", "-A");
  assert.deepEqual(git(dest, "status", "--porcelain").split("\n"), ["A  WHITE_PAGES/r/inbox/y-2026-10-15-to-r-new.md", "A  WHITE_PAGES/r/inbox/z-2026-10-16-to-r-re-x-2026-09-01-to-r-old.md"]);
});

test("a world stand-in leaves out the metas of all but the newest two crossings", () => {
  const src = repoWith({
    "STATE/log/1.jsonl": "{}\n", "STATE/log/1.meta.json": "{}\n",
    "STATE/log/2.jsonl": "{}\n", "STATE/log/2.5.journal.meta.json": "{}\n",
    "STATE/log/3.meta.json": "{}\n", "STATE/log/4.meta.json": "{}\n",
    "tools/t.mjs": "1\n",
  });
  assert.deepEqual(standinPatterns("world", src), ["/*", "!/STATE/log/1.meta.json", "!/STATE/log/1.*.meta.json", "!/STATE/log/2.meta.json", "!/STATE/log/2.*.meta.json"]);
  const dest = join(tempDir("clone-sparse-standin-"), "world-clone");
  standinClone("world", src, dest);
  assert.deepEqual(["1.jsonl", "1.meta.json", "2.jsonl", "2.5.journal.meta.json", "3.meta.json", "4.meta.json"].map((f) => existsSync(join(dest, "STATE", "log", f))), [true, false, true, false, true, true]);
  writeFileSync(join(dest, "STATE", "log", "5.journal.meta.json"), "{}\n");
  git(dest, "add", "-A");
  assert.equal(git(dest, "status", "--porcelain"), "A  STATE/log/5.journal.meta.json");
});
