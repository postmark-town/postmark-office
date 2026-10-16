// sparse-guard.mjs — a read outside the sparse set is a loud failure, never a quiet
// "not there" (POS-652).
//
// THE CLASS. The pinned clones are sparse (test/clone-sparse.json). A path left out of
// the patterns does not exist on disk, so a suite that reads it would see ENOENT, and a
// suite that only PROBES it (`existsSync(marker) ? … : t.skip()`, a reader that answers
// [] for a missing directory) would quietly skip or read an emptier town, and pass. So
// this module wraps node:fs in the process that loads it: when a path under a pinned
// clone is missing but IS in the clone's commit, or a listing of a directory there lacks
// an entry the commit has, it throws, naming the path and the file to add it to. Each
// such miss is also printed to stderr, and the process exits 1 even if a caller caught
// the throw, so a swallowed miss still reds the file.
//
// WHO LOADS IT. test/fixture-paths.mjs imports it (the suites that resolve a clone there),
// and it adds itself to NODE_OPTIONS, so a child node process it spawns (an office, a
// town tool) carries it too. CI loads it in every process through NODE_OPTIONS
// (.github/workflows/suite.yml). Loading it twice installs it once.
//
// WHICH CLONES. The office's town-clone/ and world-clone/, and whatever TOWN_CLONE and
// WORLD_CLONE name, but only a clone whose config says `postmark.sparse = town|world`
// (test/helpers/clone-sparse.mjs § applySparse). A full clone never misses; a stand-in
// (`standin-*`) is an office's runtime, judged by the suites that drive it.

import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const INSTALLED = Symbol.for("postmark.office.sparse-guard");

if (!globalThis[INSTALLED]) {
  globalThis[INSTALLED] = true;
  install();
}

function install() {
  const OFFICE = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const SELF = pathToFileURL(fileURLToPath(import.meta.url)).href;
  const WIN = process.platform === "win32";
  const fold = (p) => (WIN ? p.toLowerCase() : p);
  const orig = {
    readFileSync: fs.readFileSync, existsSync: fs.existsSync,
    statSync: fs.statSync, lstatSync: fs.lstatSync, accessSync: fs.accessSync, openSync: fs.openSync, readdirSync: fs.readdirSync,
    stat: fs.stat, lstat: fs.lstat, access: fs.access, readFile: fs.readFile, open: fs.open, readdir: fs.readdir,
  };
  const origP = { stat: fs.promises.stat, lstat: fs.promises.lstat, access: fs.promises.access, readFile: fs.promises.readFile, open: fs.promises.open, readdir: fs.promises.readdir };

  // ── the clones ──
  const rootPaths = [process.env.TOWN_CLONE, process.env.WORLD_CLONE, join(OFFICE, "town-clone"), join(OFFICE, "world-clone")]
    .filter((p) => p && p.trim()).map((p) => resolve(p));
  const roots = [...new Map(rootPaths.map((p) => [fold(p), { path: p, key: fold(p) }])).values()];

  // Read once, lazily, with the unwrapped fs: is this clone a guarded one, and what does its commit hold.
  function stateOf(root) {
    if (root.state !== undefined) return root.state;
    root.state = null;
    try {
      // `git sparse-checkout` writes core.sparseCheckout to config.worktree (extensions.worktreeConfig)
      let config = orig.readFileSync(join(root.path, ".git", "config"), "utf8");
      try { config += `\n${orig.readFileSync(join(root.path, ".git", "config.worktree"), "utf8")}`; } catch { /* none */ }
      const set = /\[postmark\][^[]*?\bsparse\s*=\s*(\S+)/i.exec(config)?.[1];
      if ((set === "town" || set === "world") && /\bsparsecheckout\s*=\s*true\b/i.test(config)) root.state = { which: set };
    } catch { /* no clone there */ }
    return root.state;
  }
  function treeOf(root) {
    const st = root.state;
    if (st.paths) return st;
    const list = execFileSync("git", ["-C", root.path, "ls-tree", "-r", "-t", "-z", "--name-only", "HEAD"], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 })
      .split("\0").filter(Boolean);
    st.head = execFileSync("git", ["-C", root.path, "rev-parse", "--short=9", "HEAD"], { encoding: "utf8" }).trim();
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

  // The guarded clone a path is under, and the path within it ("" for the clone itself), or null.
  function locate(p) {
    if (typeof p === "number" || p == null) return null;
    let s;
    try { s = p instanceof URL ? fileURLToPath(p) : Buffer.isBuffer(p) ? p.toString() : String(p); } catch { return null; }
    const abs = resolve(s);
    const key = fold(abs);
    for (const root of roots) {
      if (key !== root.key && !key.startsWith(root.key + (WIN ? "\\" : "/"))) continue;
      const rel = relative(root.path, abs).replaceAll("\\", "/");
      if (rel.startsWith("..") || isAbsolute(rel) || rel === ".git" || rel.startsWith(".git/")) return null;
      return stateOf(root) ? { root, rel } : null;
    }
    return null;
  }

  const misses = [];
  function report(root, what) {
    const st = root.state;
    const text = `[clone-sparse] ${what}: in the ${st.which} clone's commit (${st.head}) but outside test/clone-sparse.json's "${st.which}" patterns. ` +
      `Add a pattern for it there, naming who reads it; the pool trees then convert in place (node G:/Postmark/pool/claim.mjs sparse office-N). POS-652.`;
    misses.push(text);
    try { process.stderr.write(`${text}\n`); } catch {}
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
  const gone = (e) => e && (e.code === "ENOENT" || e.code === "ENOTDIR");

  // ── the wrappers ──
  fs.existsSync = function existsSync(p) {
    const r = orig.existsSync(p);
    if (!r) { const e = missed(p); if (e) throw e; }
    return r;
  };
  for (const name of ["statSync", "lstatSync", "accessSync", "readFileSync", "openSync", "readdirSync"]) {
    fs[name] = function (p, ...rest) {
      let r;
      try { r = orig[name].call(this, p, ...rest); }
      catch (err) { if (gone(err)) { const e = missed(p); if (e) throw e; } throw err; }
      if (r === undefined && (name === "statSync" || name === "lstatSync")) { const e = missed(p); if (e) throw e; } // { throwIfNoEntry: false }
      if (name === "readdirSync") { const e = listed(p, r); if (e) throw e; }
      return r;
    };
  }
  for (const name of ["stat", "lstat", "access", "readFile", "open", "readdir"]) {
    fs[name] = function (p, ...rest) {
      const cb = rest.at(-1);
      if (typeof cb !== "function") return orig[name].call(this, p, ...rest);
      return orig[name].call(this, p, ...rest.slice(0, -1), (err, r, ...more) => {
        if (gone(err)) { const e = missed(p); if (e) return cb(e); }
        if (!err && name === "readdir") { const e = listed(p, r); if (e) return cb(e); }
        return cb(err, r, ...more);
      });
    };
  }
  for (const name of Object.keys(origP)) {
    fs.promises[name] = async function (p, ...rest) {
      let r;
      try { r = await origP[name].call(this, p, ...rest); }
      catch (err) { if (gone(err)) { const e = missed(p); if (e) throw e; } throw err; }
      if (name === "readdir") { const e = listed(p, r); if (e) throw e; }
      return r;
    };
  }
  syncBuiltinESMExports();

  // A swallowed miss still reds the process.
  process.on("exit", (code) => { if (misses.length && !code) process.exitCode = 1; });

  // Children carry it (an office, a town tool spawned with this env).
  const flag = `--import="${SELF}"`;
  const opts = process.env.NODE_OPTIONS ?? "";
  if (!opts.includes(SELF) && !opts.includes(fileURLToPath(import.meta.url))) process.env.NODE_OPTIONS = `${opts} ${flag}`.trim();
}
