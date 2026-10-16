// sparse-guard.mjs — a read outside the sparse set is a loud failure, never a quiet
// "not there" (POS-652).
//
// THE CLASS. The pinned clones are sparse (test/clone-sparse.json). A path left out of
// the patterns does not exist on disk, so a suite that reads it would see ENOENT, and a
// suite that only PROBES it (`existsSync(marker) ? … : t.skip()`, a reader that answers
// [] for a missing directory) would quietly skip or read an emptier town, and pass. So
// this module wraps node:fs in the process that loads it: when a path under a pinned
// clone is missing but IS in the clone's commit, a listing of a directory there lacks an
// entry the commit has, or a copy or a glob there spans a path that is not checked out,
// it throws, naming the path and the file to add it to.
//
// A SWALLOWED MISS STILL REDS. Each miss is printed to stderr and appended to the file
// POSTMARK_SPARSE_MISSES names, which every child inherits. The first process to load
// the guard (the ROOT: `node --test`, a lane's one-off run) names that file when no one
// has, and exits 1 at the end if any process in its tree wrote to it, so a miss inside a
// spawned office server that a test never asks about still reds the run. On CI,
// .github/scripts/suite-shard.mjs names one file per test file and the verdict reads it.
// A process also exits 1 on a miss of its own, though a caller caught the throw.
//
// WHO LOADS IT. `npm test` and the lanes' local runs (`node --test --import
// ./test/helpers/sparse-guard.mjs …`, G:/Postmark/pool/README.md), test/fixture-paths.mjs
// as a belt, and on CI NODE_OPTIONS on the shard step (.github/workflows/suite.yml). It
// adds itself to NODE_OPTIONS, so a child node process it spawns (an office, a town tool)
// carries it too. Loading it twice installs it once.
//
// WHICH CLONES. The office's town-clone/ and world-clone/, whatever TOWN_CLONE and
// WORLD_CLONE name, and any link made (symlinkSync) to a path inside one of them, but only
// a clone whose git config says `postmark.sparse = town|world` (test/helpers/clone-sparse.mjs
// § applySparse). A full clone never misses; a stand-in (`standin-*`) is an office's
// runtime, judged by the suites that drive it. A clone whose config cannot be read is a
// miss of its own, never a silent pass.

import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const INSTALLED = Symbol.for("postmark.office.sparse-guard");
export const MISSES_ENV = "POSTMARK_SPARSE_MISSES";

if (!globalThis[INSTALLED]) {
  globalThis[INSTALLED] = true;
  install();
}

function install() {
  const OFFICE = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const SELF = pathToFileURL(fileURLToPath(import.meta.url)).href;
  const WIN = process.platform === "win32";
  const fold = (p) => (WIN ? p.toLowerCase() : p);
  const run = (args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  const orig = {};
  for (const n of ["readFileSync", "existsSync", "statSync", "lstatSync", "accessSync", "openSync", "readdirSync", "opendirSync", "realpathSync", "cpSync", "globSync", "symlinkSync",
    "stat", "lstat", "access", "readFile", "open", "readdir", "opendir", "realpath", "cp", "glob", "symlink"]) orig[n] = fs[n];
  const origNative = fs.realpathSync.native;
  const origP = {};
  for (const n of ["stat", "lstat", "access", "readFile", "open", "readdir", "opendir", "realpath", "cp", "symlink", "glob"]) origP[n] = fs.promises[n];

  // ── the misses file ──
  const isRoot = !process.env[MISSES_ENV];
  if (isRoot) process.env[MISSES_ENV] = join(tmpdir(), `sparse-misses-${process.pid}-${Date.now().toString(36)}.txt`);
  const missesFile = process.env[MISSES_ENV];

  // ── the clones ──
  const rootPaths = [process.env.TOWN_CLONE, process.env.WORLD_CLONE, join(OFFICE, "town-clone"), join(OFFICE, "world-clone")]
    .filter((p) => p && p.trim()).map((p) => resolve(p));
  const roots = [...new Map(rootPaths.map((p) => [fold(p), { path: p, key: fold(p) }])).values()];
  const aliases = []; // { key, path, root, prefix }: a link to a path inside a guarded clone

  // Read once, lazily: is this clone a guarded one. Through git, so a gitfile or a worktree
  // config reads as the clone itself would; unreadable is loud.
  function stateOf(root) {
    if (root.state !== undefined) return root.state;
    root.state = null;
    if (!orig.existsSync(join(root.path, ".git"))) return null;
    let out = "";
    try { out = run(["-C", root.path, "config", "--get-regexp", "^(postmark\\.sparse|core\\.sparsecheckout)$"]); }
    catch (e) {
      if (e.status === 1) return null; // neither key: a full clone
      record(`[clone-sparse] cannot read the git config of ${root.path} (${String(e.stderr ?? e.message).trim().split("\n")[0]}); its reads are not guarded. POS-652.`);
      return null;
    }
    const set = /^postmark\.sparse (\S+)/m.exec(out)?.[1];
    if ((set === "town" || set === "world") && /^core\.sparsecheckout true$/mi.test(out)) root.state = { which: set };
    return root.state;
  }
  function treeOf(root) {
    const st = root.state;
    if (st.paths) return st;
    const list = run(["-C", root.path, "ls-tree", "-r", "-t", "-z", "--name-only", "HEAD"]).split("\0").filter(Boolean);
    st.head = run(["-C", root.path, "rev-parse", "--short=9", "HEAD"]).trim();
    st.paths = new Map(list.map((p) => [fold(p), p]));
    st.kids = new Map();
    for (const p of list) {
      const i = p.lastIndexOf("/");
      const dir = fold(i < 0 ? "" : p.slice(0, i));
      if (!st.kids.has(dir)) st.kids.set(dir, []);
      st.kids.get(dir).push(p.slice(i + 1));
    }
    try {
      const spec = JSON.parse(orig.readFileSync(join(OFFICE, "test", "clone-sparse.json"), "utf8"));
      st.unlisted = (spec[st.which]?.unlisted ?? []).map((u) => new RegExp(`^${u.entry.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join("[^/]*")}$`));
    } catch { st.unlisted = []; }
    return st;
  }
  // The tracked files not in the working tree (git ls-files -t: S), for a copy or a glob.
  function skippedOf(st, root) {
    if (!st.skipped) st.skipped = run(["-C", root.path, "ls-files", "-t", "-z"]).split("\0").filter((l) => l.startsWith("S ")).map((l) => l.slice(2));
    return st.skipped;
  }

  const under = (key, base) => key === base || key.startsWith(base + (WIN ? "\\" : "/"));
  // The guarded clone a path is under, and the path within it ("" for the clone itself), or null.
  function locate(p) {
    if (typeof p === "number" || p == null) return null;
    let s;
    try { s = p instanceof URL ? fileURLToPath(p) : Buffer.isBuffer(p) ? p.toString() : String(p); } catch { return null; }
    const abs = resolve(s);
    const key = fold(abs);
    for (const root of roots) {
      if (!under(key, root.key)) continue;
      const rel = relative(root.path, abs).replaceAll("\\", "/");
      if (rel.startsWith("..") || isAbsolute(rel) || rel === ".git" || rel.startsWith(".git/")) return null;
      return stateOf(root) ? { root, rel } : null;
    }
    for (const a of aliases) {
      if (!under(key, a.key)) continue;
      const rest = relative(a.path, abs).replaceAll("\\", "/");
      return { root: a.root, rel: [a.prefix, rest].filter(Boolean).join("/") };
    }
    return null;
  }

  const mine = [];
  function record(text) {
    mine.push(text);
    try { process.stderr.write(`${text}\n`); } catch {}
    try { fs.appendFileSync(missesFile, `${text}\n`); } catch {}
  }
  function report(root, what) {
    const st = root.state;
    const text = `[clone-sparse] ${what}: in the ${st.which} clone's commit (${st.head}) but outside test/clone-sparse.json's "${st.which}" patterns. ` +
      `Add a pattern for it there, naming who reads it; the pool trees then convert in place (node G:/Postmark/pool/claim.mjs sparse office-N). POS-652.`;
    record(text);
    const e = new Error(text);
    e.code = "ESPARSE";
    return e;
  }
  // A missing path: a miss when the commit holds it.
  function missed(p) {
    const at = locate(p);
    if (!at) return null;
    const st = treeOf(at.root);
    const have = st.paths.get(fold(at.rel));
    return have ? report(at.root, `${at.root.state.which}-clone/${have} is not checked out`) : null;
  }
  // A listing: a miss when the commit holds an entry the disk lacks, unless it is `unlisted`.
  function listed(p, entries) {
    const at = locate(p);
    if (!at || !Array.isArray(entries)) return null;
    const st = treeOf(at.root);
    const kids = st.kids.get(fold(at.rel)) ?? [];
    if (!kids.length) return null;
    const on = new Set(entries.map((e) => fold(typeof e === "string" ? e : Buffer.isBuffer(e) ? e.toString() : e?.name ?? "")));
    const lacking = kids.filter((k) => !on.has(fold(k)) && !st.unlisted.some((re) => re.test(at.rel ? `${at.rel}/${k}` : k)));
    if (!lacking.length) return null;
    const shown = lacking.slice(0, 5).map((k) => (at.rel ? `${at.rel}/${k}` : k)).join(", ");
    return report(at.root, `a listing of ${at.root.state.which}-clone/${at.rel || "."} lacks ${lacking.length} entr${lacking.length === 1 ? "y" : "ies"} (${shown}${lacking.length > 5 ? ", ..." : ""})`);
  }
  // A copy or a glob over a directory: a miss when a tracked file beneath it is not checked out.
  function spanned(p, verb) {
    const at = locate(p);
    if (!at) return null;
    const st = treeOf(at.root);
    if (!orig.existsSync(p)) return missed(p);
    const prefix = at.rel ? `${fold(at.rel)}/` : "";
    const lacking = skippedOf(st, at.root).filter((f) => fold(f).startsWith(prefix));
    if (!lacking.length) return null;
    return report(at.root, `a ${verb} of ${at.root.state.which}-clone/${at.rel || "."} would leave out ${lacking.length} file${lacking.length === 1 ? "" : "s"} (${lacking.slice(0, 3).join(", ")}${lacking.length > 3 ? ", ..." : ""})`);
  }
  // The directory a glob pattern starts from: its segments before the first wildcard.
  function globBase(pattern, cwd) {
    const segs = resolve(cwd ?? process.cwd(), String(pattern)).split(/[\\/]/);
    const i = segs.findIndex((s) => /[*?[{]/.test(s));
    return (i < 0 ? segs : segs.slice(0, i)).join("/") || "/";
  }
  const globCheck = (pattern, opts) => {
    for (const pat of Array.isArray(pattern) ? pattern : [pattern]) { const e = spanned(globBase(pat, opts?.cwd), "glob"); if (e) return e; }
    return null;
  };
  // A link into a guarded clone is guarded at the link's own path too (src/world-snapshot.mjs § householdsAt's overlay).
  function linked(target, path) {
    const t = typeof target === "string" && !isAbsolute(target) ? resolve(dirname(resolve(String(path))), target) : target;
    const at = locate(t);
    if (at) { const abs = resolve(String(path)); aliases.push({ key: fold(abs), path: abs, root: at.root, prefix: at.rel }); }
  }
  const gone = (e) => e && (e.code === "ENOENT" || e.code === "ENOTDIR");

  // ── the wrappers ──
  fs.existsSync = function existsSync(p) {
    const r = orig.existsSync(p);
    if (!r) { const e = missed(p); if (e) throw e; }
    return r;
  };
  const syncWrap = (name, impl) => function (p, ...rest) {
    let r;
    try { r = impl.call(this, p, ...rest); }
    catch (err) { if (gone(err)) { const e = missed(p); if (e) throw e; } throw err; }
    if (r === undefined && (name === "statSync" || name === "lstatSync")) { const e = missed(p); if (e) throw e; } // { throwIfNoEntry: false }
    if (name === "readdirSync") { const e = listed(p, r); if (e) throw e; }
    if (name === "opendirSync") { const e = listed(p, orig.readdirSync(p)); if (e) { r.closeSync(); throw e; } }
    return r;
  };
  for (const name of ["statSync", "lstatSync", "accessSync", "readFileSync", "openSync", "readdirSync", "opendirSync", "realpathSync"]) fs[name] = syncWrap(name, orig[name]);
  fs.realpathSync.native = syncWrap("realpathSync", origNative);
  fs.cpSync = function cpSync(src, dest, ...rest) { const e = spanned(src, "copy"); if (e) throw e; return orig.cpSync.call(this, src, dest, ...rest); };
  fs.symlinkSync = function symlinkSync(target, path, ...rest) { const r = orig.symlinkSync.call(this, target, path, ...rest); linked(target, path); return r; };
  if (orig.globSync) fs.globSync = function globSync(pattern, opts) { const e = globCheck(pattern, opts); if (e) throw e; return orig.globSync.call(this, pattern, opts); };

  for (const name of ["stat", "lstat", "access", "readFile", "open", "readdir", "opendir", "realpath"]) {
    fs[name] = function (p, ...rest) {
      const cb = rest.at(-1);
      if (typeof cb !== "function") return orig[name].call(this, p, ...rest);
      return orig[name].call(this, p, ...rest.slice(0, -1), (err, r, ...more) => {
        if (gone(err)) { const e = missed(p); if (e) return cb(e); }
        if (!err && name === "readdir") { const e = listed(p, r); if (e) return cb(e); }
        if (!err && name === "opendir") { const e = listed(p, orig.readdirSync(p)); if (e) { r.closeSync(); return cb(e); } }
        return cb(err, r, ...more);
      });
    };
  }
  fs.cp = function cp(src, dest, ...rest) {
    const cb = rest.at(-1); const e = spanned(src, "copy");
    if (e && typeof cb === "function") return process.nextTick(cb, e);
    if (e) throw e;
    return orig.cp.call(this, src, dest, ...rest);
  };
  fs.symlink = function symlink(target, path, ...rest) {
    const cb = rest.at(-1);
    return orig.symlink.call(this, target, path, ...rest.slice(0, -1), (err, ...more) => { if (!err) linked(target, path); cb(err, ...more); });
  };
  if (orig.glob) fs.glob = function glob(pattern, ...rest) {
    const cb = rest.at(-1); const e = globCheck(pattern, typeof rest[0] === "object" ? rest[0] : undefined);
    if (e && typeof cb === "function") return process.nextTick(cb, e);
    return orig.glob.call(this, pattern, ...rest);
  };

  for (const name of ["stat", "lstat", "access", "readFile", "open", "readdir", "opendir", "realpath"]) {
    fs.promises[name] = async function (p, ...rest) {
      let r;
      try { r = await origP[name].call(this, p, ...rest); }
      catch (err) { if (gone(err)) { const e = missed(p); if (e) throw e; } throw err; }
      if (name === "readdir") { const e = listed(p, r); if (e) throw e; }
      if (name === "opendir") { const e = listed(p, orig.readdirSync(p)); if (e) { await r.close(); throw e; } }
      return r;
    };
  }
  fs.promises.cp = async function cp(src, dest, ...rest) { const e = spanned(src, "copy"); if (e) throw e; return origP.cp.call(this, src, dest, ...rest); };
  fs.promises.symlink = async function symlink(target, path, ...rest) { const r = await origP.symlink.call(this, target, path, ...rest); linked(target, path); return r; };
  if (origP.glob) fs.promises.glob = function glob(pattern, opts) { const e = globCheck(pattern, opts); if (e) throw e; return origP.glob.call(this, pattern, opts); };
  syncBuiltinESMExports();

  // A swallowed miss still reds: this process on its own misses; the root on any in its tree.
  process.on("exit", (code) => {
    let all = [];
    if (isRoot) {
      try { all = orig.readFileSync(missesFile, "utf8").split("\n").filter(Boolean); } catch {}
      try { fs.rmSync(missesFile, { force: true }); } catch {}
      const theirs = all.filter((l) => !mine.includes(l));
      if (theirs.length) try { process.stderr.write(`[clone-sparse] ${theirs.length} miss(es) in child processes of this run:\n${theirs.join("\n")}\n`); } catch {}
    }
    if ((mine.length || all.length) && !code) process.exitCode = 1;
  });

  // Children carry it (an office, a town tool spawned with this env).
  const flag = `--import="${SELF}"`;
  const opts = process.env.NODE_OPTIONS ?? "";
  if (!opts.includes(SELF) && !opts.includes(fileURLToPath(import.meta.url))) process.env.NODE_OPTIONS = `${opts} ${flag}`.trim();
}
