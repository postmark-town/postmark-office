// dev-world-ref.test.mjs — dev may stand its World on one named head (POS-1256).
//
// LAW (team-lead, POS-1256, 2026-11-26, the go for this change): "deploy/postmark-dev-freshen.sh resets the
// world-clone to $(cat /srv/postmark-office-dev/dev-world-ref) when that meepo-owned file exists and is
// non-empty (validate it as a full sha or refs/tags/...), and to refs/tags/sandbox/seed otherwise."
// And Darko's frame (POS-1256): dev's World is moved without a tag move, and only on dev.
//
// The freshen runs here for real under bash, the way test/box-rollcall.test.mjs runs it (POS-192): a `flock`
// that execs its command, a `git` that logs every call, a `node` that succeeds. The root it runs against is a
// temp folder holding (or lacking) the ref file. Nothing reaches a box or GitHub.

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { tempDir } from "./helpers/temp-dir.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FRESHEN = join(ROOT, "deploy", "postmark-dev-freshen.sh");
const posix = (p) => p.replaceAll("\\", "/");
const noBash = spawnSync("bash", ["-c", "exit 0"]).status === 0 ? false : "no bash on this host: the freshen is a bash script";
const SEED = "refs/tags/sandbox/seed";
const SHA = "0123456789abcdef0123456789abcdef01234567";

/** Run the shipped freshen against a dev root, with `refFile` (a string, or null for no file) as dev-world-ref. */
function freshen(refFile) {
  const dir = tempDir("dev-world-ref-");
  const bin = join(dir, "bin");
  const dev = join(dir, "dev");
  mkdirSync(bin);
  mkdirSync(dev);
  if (refFile !== null) writeFileSync(join(dev, "dev-world-ref"), refFile);
  const log = join(dir, "git.log");
  writeFileSync(log, "");
  writeFileSync(join(bin, "git"), ["#!/usr/bin/env bash", 'echo "$*" >> "$FRESHEN_LOG"', "exit 0", ""].join("\n"), { mode: 0o755 });
  writeFileSync(join(bin, "flock"), ["#!/usr/bin/env bash", 'shift 4; exec "$@"', ""].join("\n"), { mode: 0o755 });
  writeFileSync(join(bin, "node"), ["#!/usr/bin/env bash", "exit 0", ""].join("\n"), { mode: 0o755 });
  const env = { ...process.env };
  const pathKey = Object.keys(env).find((k) => k.toUpperCase() === "PATH") ?? "PATH";
  env[pathKey] = `${bin}${delimiter}${env[pathKey] ?? ""}`;
  Object.assign(env, { FRESHEN_LOG: posix(log), POSTMARK_DEV_ROOT: posix(dev), POSTMARK_DEV_FLOCK: posix(join(bin, "flock")) });
  for (const k of ["POSTMARK_DEV_STAMP_KEY", "POSTMARK_PROD_PUBKEY"]) delete env[k];
  const r = spawnSync("bash", [posix(FRESHEN)], { encoding: "utf8", env });
  const calls = readFileSync(log, "utf8").split("\n").filter(Boolean).map((c) => c.replace(posix(dev), "<dev>"));
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, calls };
}
const resets = (r) => r.calls.filter((c) => / reset -q --hard /.test(c));
const STOOD_BACK = /dev clones stood back on sandbox\/seed/;

test("no ref file: the world and the town both reset to the seed, in the seven git calls the freshen always made", { skip: noBash }, () => {
  const r = freshen(null);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(resets(r), [`-C <dev>/world-clone reset -q --hard ${SEED}`, `-C <dev>/town-clone reset -q --hard ${SEED}`]);
  assert.equal(r.calls.length, 7, "no extra fetch");
  assert.doesNotMatch(r.stdout, /named by/);
  assert.match(r.stdout, STOOD_BACK);
});

test("an empty ref file, or one holding only whitespace, is the seed", { skip: noBash }, () => {
  for (const content of ["", "\n", "  \r\n\t \n"]) {
    const r = freshen(content);
    assert.equal(r.status, 0, JSON.stringify(content) + r.stderr);
    assert.deepEqual(resets(r), [`-C <dev>/world-clone reset -q --hard ${SEED}`, `-C <dev>/town-clone reset -q --hard ${SEED}`], JSON.stringify(content));
  }
});

test("a full sha: the world is fetched by that sha and reset to it; the town stays on the seed; the unit still succeeds", { skip: noBash }, () => {
  const r = freshen(`${SHA}\n`);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(resets(r), [`-C <dev>/world-clone reset -q --hard ${SHA}`, `-C <dev>/town-clone reset -q --hard ${SEED}`]);
  assert.ok(r.calls.includes(`-C <dev>/world-clone fetch -q origin ${SHA}`), "the head is fetched by name, so a non-branch commit can be reached");
  assert.equal(r.calls.filter((c) => c.includes(`origin ${SHA}`)).length, 1, "and only for the world");
  assert.match(r.stdout, new RegExp(`dev world-clone stands on ${SHA}, named by .*dev-world-ref, not on the seed`));
  assert.match(r.stdout, STOOD_BACK);
});

test("a tag name: the world resets to it with no extra fetch; the town stays on the seed", { skip: noBash }, () => {
  const r = freshen("refs/tags/settlement/S194\n");
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(resets(r), [`-C <dev>/world-clone reset -q --hard refs/tags/settlement/S194`, `-C <dev>/town-clone reset -q --hard ${SEED}`]);
  assert.equal(r.calls.length, 7);
});

test("anything else in the file stops the unit before a clone is touched, naming what it found", { skip: noBash }, () => {
  const bad = ["main", "refs/heads/main", "origin/main", SHA.slice(0, 12), SHA.toUpperCase(), `${SHA}0`, "refs/tags/", "refs/tags/../x", "refs/tags/a b",
    `${SHA}\n${SHA}`, "refs/tags/$(touch pwned)", "refs/tags/x;rm", "-C /etc"];
  for (const content of bad) {
    const r = freshen(content);
    assert.equal(r.status, 1, JSON.stringify(content));
    assert.match(r.stderr, /dev-world-ref names [\s\S]*neither a full sha nor refs\/tags\/<name>: nothing was reset/, JSON.stringify(content));
    assert.deepEqual(r.calls, [], `${JSON.stringify(content)}: no git call ran`);
    assert.doesNotMatch(r.stdout, STOOD_BACK);
  }
});

// TEXT PIN (the weakest instrument; the runs above are the behaviour). Dev only: the ref file is named in one
// script, the freshen, and in the docs. Nothing the office runs, and no prod script, reads it.
test("pin: dev-world-ref is read by the dev freshen alone; no src, tools, world2 or prod deploy file names it", () => {
  const files = spawnSync("git", ["-C", ROOT, "ls-files", "-z"], { encoding: "utf8" }).stdout.split("\0").filter(Boolean);
  const naming = files.filter((f) => !f.startsWith("test/") && /\.(mjs|js|sh|service|timer|conf|json|yml)$/.test(f) && readFileSync(join(ROOT, f), "utf8").includes("dev-world-ref"));
  assert.deepEqual(naming, ["deploy/postmark-dev-freshen.sh"]);
  const script = readFileSync(FRESHEN, "utf8");
  assert.ok(script.indexOf("' freshen") > script.indexOf("bash -c '"), "the body's end marker is found");
  const body = script.slice(script.indexOf("bash -c '") + "bash -c '".length, script.indexOf("' freshen"));
  assert.doesNotMatch(body, /'/, "the bash -c body is one single-quoted string: an apostrophe in it would end it");
});
