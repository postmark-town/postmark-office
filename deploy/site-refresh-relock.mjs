#!/usr/bin/env node
// site-refresh-relock.mjs: name postmark-world@<sha> in the build tree's package.json and package-lock.json
// WITHOUT an install, when node_modules already carries that sha (POS-1191).
//
//   node deploy/site-refresh-relock.mjs --tree <build tree> --sha <40-hex>
//
// WHY. On an advance, site-refresh.sh ran `npm install postmark-world@github:…#<sha>` on EVERY tick, because the
// checkout of the release tag puts package.json and package-lock.json back at the tag's floor and the stamp reads
// the lockfile (the 2026-09-11 review, § 3). When node_modules already carries the sha, that install fetches and
// unpacks nothing new; it re-writes three lines, and it costs about 80 s. This writes the same three:
//   package.json                                   dependencies["postmark-world"] = "github:postmark-town/postmark-world#<sha>"
//   package-lock.json packages[""]                 dependencies["postmark-world"] = the same spec
//   package-lock.json packages["node_modules/postmark-world"] = npm's INSTALLED record's entry, verbatim
// (node_modules/.package-lock.json: version, resolved, integrity), which is what npm itself writes there.
// npm's install also drops a "peer": true flag from a couple of unrelated entries (an npm quirk, measured on
// UAT 2026-11-24). This leaves them as the tag has them; nothing reads them, and the result is the same on
// every tick, so the build's key is stable.
//
// IT REFUSES (exit 2, nothing written) unless the installed record names exactly <sha> and both files parse.
// The caller then runs the install, as before. Exit 0 means both files now name <sha>.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : undefined; };
const tree = opt("tree"), sha = opt("sha");
const refuse = (why) => { console.error(`[relock] refused: ${why}`); process.exit(2); };
if (!tree || !/^[0-9a-f]{40}$/.test(sha ?? "")) refuse("usage: --tree <dir> --sha <40-hex>");

const read = (f) => { try { return JSON.parse(readFileSync(join(tree, f), "utf8")); } catch (e) { refuse(`${f} unreadable (${e.message})`); } };
const installed = read("node_modules/.package-lock.json").packages?.["node_modules/postmark-world"];
if (!installed || !String(installed.resolved ?? "").endsWith(`#${sha}`)) refuse(`node_modules does not carry postmark-world#${sha} (it carries ${installed?.resolved ?? "nothing"})`);

const spec = `github:postmark-town/postmark-world#${sha}`;
const pkg = read("package.json");
const lock = read("package-lock.json");
if (!pkg.dependencies || !("postmark-world" in pkg.dependencies)) refuse("package.json names no postmark-world dependency");
if (!lock.packages?.[""]?.dependencies || !("postmark-world" in lock.packages[""].dependencies)) refuse("package-lock.json's root names no postmark-world");

pkg.dependencies["postmark-world"] = spec;
lock.packages[""].dependencies["postmark-world"] = spec;
lock.packages["node_modules/postmark-world"] = { ...installed };
writeFileSync(join(tree, "package.json"), JSON.stringify(pkg, null, 2) + "\n");
writeFileSync(join(tree, "package-lock.json"), JSON.stringify(lock, null, 2) + "\n");
console.log(`[relock] package.json and package-lock.json name postmark-world#${sha.slice(0, 8)} (from npm's installed record; no install)`);
