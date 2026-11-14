// pos619-lossy-ingest.test.mjs — POS-619: the law ingest never stores a value
// the world's parser would silently lose.
//
// The parser keeps what it can read and drops the rest without a word, so the
// heist's spelling `dials: { stolen: true, clue: "…" }` (bare keys) reads as {}.
// World #200/#204 name each loss from the raw text (marks-fold.mjs §
// lossyValues, § lossyMessage) and the lint errs on it in the PR lane. A commit
// that reaches main past the lane is caught here:
//   · law-ingest REFUSES the whole sha (class marks are law), so the law stays
//     where it was. The candy class carries the heist's dial: its lossy spelling
//     is refused, its strict JSON goes through.
//
// marks-ingest's half (it HELD a changed mark with a loss) retired with the pen
// at the settlement printout's cutover (POS-1025): the store is the marks' record,
// and the world's files are printed from it, never read back into it.
//
// The world side is the pinned world clone (test/clone-pins.json), which must
// carry world #204: the helper is read from the checkout being ingested.
//
//   WORLD_CLONE=<a world clone at or after #204> node --test test/pos619-lossy-ingest.test.mjs

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { deriveLaw, lossyRefusal } from "../world2/tools/law-ingest.mjs";
import { WORLD_CLONE } from "../src/world-store.mjs";

const OFFICE = join(dirname(fileURLToPath(import.meta.url)), "..");
const git = (repo, ...args) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

const LOSSY = 'dials: { stolen: true, clue: "No such thing as candy exists" }';
const STRICT = 'dials: {"stolen": true, "clue": "No such thing as candy exists"}';
const LINT_SENTENCE = 'dials: { stolen: true, clue: "No such thing as candy exists" } is not strict JSON, so the record keeps only its number pairs and silently drops stolen, clue (it reads as {}) — write it as strict JSON, every key quoted: dials: { "stolen": true, "clue": "No such thing as candy exists" }';

const FM = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
function setLine(text, key, value) {
  const m = text.match(FM);
  const lines = m[1].split(/\r?\n/).filter((l) => !l.startsWith(`${key}:`));
  lines.push(`${key}: ${value}`);
  return `---\n${lines.join("\n")}\n---\n${text.slice(m[0].length)}`;
}

let dir = null;
const clones = [];
function cloneAt(sha, label) {
  const at = join(dir, `${label}-${clones.length}`);
  execFileSync("git", ["clone", "-q", "--shared", "--no-checkout", WORLD_CLONE, at], { stdio: "ignore" });
  git(at, "-c", "advice.detachedHead=false", "checkout", "-q", sha);
  git(at, "config", "user.name", "pos619-fixture");
  git(at, "config", "user.email", "fixture@postmark.invalid");
  clones.push(at);
  return at;
}
const commitAll = (repo, msg) => { git(repo, "add", "-A"); git(repo, "commit", "-q", "-m", msg); return git(repo, "rev-parse", "HEAD"); };

let PIN = null;
before(() => {
  dir = mkdtempSync(join(tmpdir(), "pos619-"));
  PIN = git(WORLD_CLONE, "rev-parse", "HEAD");
  const mf = readFileSync(join(WORLD_CLONE, "tools", "marks-fold.mjs"), "utf8");
  assert.match(mf, /export function lossyMessage/,
    `the pinned world clone (${WORLD_CLONE} @ ${PIN.slice(0, 9)}) must carry world #204 (lossyValues + lossyMessage) — move test/clone-pins.json`);
});
after(() => { if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });

// ── the law pen: the heist's own mark ───────────────────────────────────────

// The candy class is world #195's (unmerged at the pin: it lands with the 10-18
// candy settlement, with its parent class `consumable`). Where the pinned law
// does not declare it yet, the fixture files it as #195 writes it, under
// `consumable` when the law has it and under `thing` (consumable's own parent)
// when it does not, so the heist's edit lands on a candy class either way.
const CANDY_195 = `---
kind: class
by: the-town
tier: constitution
date: 2026-10-13
class: candy
version: 1
extends: EXTENDS
dials: {}
labels: []
implements: []
source: LOGOS/classes.md
---

Candy is a consumable that comes in labels, each with its name and its creator; a label marks a count, never a class of its own.
`;
async function candyWith(dials, label) {
  const repo = cloneAt(PIN, label);
  const { rows } = await deriveLaw({ lawRepo: repo });
  let path = rows.find((r) => r.kind === "class" && r.key === "candy")?.path;
  if (!path) {
    const parent = rows.find((r) => r.kind === "class" && r.key === "consumable") ?? rows.find((r) => r.kind === "class" && r.key === "thing");
    assert.ok(parent, "the law declares consumable or thing, candy's ancestry");
    path = `${dirname(parent.path)}/candy/mark.md`;
    mkdirSync(join(repo, dirname(path)), { recursive: true });
    writeFileSync(join(repo, path), CANDY_195.replace("EXTENDS", parent.key));
    commitAll(repo, "world #195's candy class (pos619 fixture)");
    assert.ok((await deriveLaw({ lawRepo: repo })).rows.some((r) => r.kind === "class" && r.key === "candy"), "the fixture's candy class is declared");
  }
  const file = join(repo, path);
  writeFileSync(file, setLine(readFileSync(file, "utf8"), "dials", dials.slice("dials: ".length)));
  const sha = commitAll(repo, `the heist's edit, ${label} (pos619 fixture)`);
  return { repo, sha, path };
}

test("POS-619 · LAW: the heist's lossy spelling on the candy class is REFUSED whole, in the lint's words", async () => {
  const { repo, sha, path } = await candyWith(LOSSY, "law-lossy");
  const { lossy, lossyChecked } = await deriveLaw({ lawRepo: repo });
  assert.ok(lossyChecked);
  assert.deepEqual(lossy, [{ path, sentences: [LINT_SENTENCE] }]);
  const refusal = lossyRefusal(sha, lossy);
  assert.match(refusal, /^REFUSED: the law at [0-9a-f]{40} carries 1 mark\(s\) with a value the parser would silently lose[^\n]*Nothing was written; the law stays where it was \(POS-619\)\./);
  assert.ok(refusal.includes(`  ${path}: ${LINT_SENTENCE}`), refusal);

  const cli = spawnSync(process.execPath, ["world2/tools/law-ingest.mjs", "--law-repo", repo, "--sha", sha, "--dry-run"], { cwd: OFFICE, encoding: "utf8" });
  assert.equal(cli.status, 1, `the pen refuses: ${cli.stdout}\n${cli.stderr}`);
  assert.ok(cli.stderr.includes(refusal), cli.stderr);
  assert.doesNotMatch(cli.stdout, /law_projection:/, "no census: nothing was derived to write");
});

test("POS-619 · LAW: the strict-JSON spelling goes through, and the candy class carries the whole dial", async () => {
  const { repo, sha } = await candyWith(STRICT, "law-strict");
  const { rows, lossy } = await deriveLaw({ lawRepo: repo });
  assert.deepEqual(lossy, []);
  assert.equal(lossyRefusal(sha, lossy), null);
  assert.deepEqual(rows.find((r) => r.kind === "class" && r.key === "candy").data.dials, { stolen: true, clue: "No such thing as candy exists" });
  const cli = spawnSync(process.execPath, ["world2/tools/law-ingest.mjs", "--law-repo", repo, "--sha", sha, "--dry-run"], { cwd: OFFICE, encoding: "utf8" });
  assert.equal(cli.status, 0, cli.stderr);
  assert.match(cli.stdout, new RegExp(`^dry-run · ${sha}\\n  law_projection: \\d+`));
  assert.doesNotMatch(cli.stderr, /REFUSED|NOT CHECKED/);
});
