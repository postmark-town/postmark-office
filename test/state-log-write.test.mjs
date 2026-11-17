// state-log-write.test.mjs — the writer, and the refusal my own diff would have caused.
//
// THE DEFECT THIS FILE EXISTS BECAUSE OF, and it was mine. Lap 1 proposed a
// wiring diff that wrote the photograph into the sweep clone's working tree and
// left it UNCOMMITTED, citing `world-drain.mjs`'s "committing it is the
// settlement pass's act" note. Two things wrong, either fatal:
//
//   `tools/settlement-sweep.mjs:892` classifies the tree before doing anything —
//   `worktreeDirt` runs `git status --porcelain --untracked-files=all`, so an
//   UNTRACKED STATE file is REAL dirt — and `:893` throws "settlement sweep
//   needs a clean checkout". Every store crossing would have refused, by name,
//   on a file the diff itself wrote.
//
//   And the note I cited describes a DEFAULT-OFF flag. `deploy/settlement-auto.
//   sh:219` overrides it: `--commit-state` "is required, not optional". On prod
//   the drain commits STATE itself; I quoted its off-by-default caveat as the
//   practice.
//
// W1 is the repair and W1-CONTROL is the defect, asserted rather than described.
//
//   node --test test/state-log-write.test.mjs

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "./helpers/temp-dir.mjs";

import { MERGE_HAZARD } from "../src/state-log-from-store.mjs";
import { writeStateLog } from "../world2/tools/state-log-write.mjs";

const sweep = (d) => { try { rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); } catch { /* litter */ } };
const scratch = tempDir("postmark-statelog-write-");
after(() => sweep(scratch));

const git = (repo, ...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

/** A world checkout on `main` with one commit, the shape the sweep clone is in. */
function world(name) {
  const repo = join(scratch, name);
  mkdirSync(join(repo, "WORLD"), { recursive: true });
  mkdirSync(join(repo, "STATE", "log"), { recursive: true });
  writeFileSync(join(repo, "WORLD", "world-state.json"), "{}\n");
  git(repo === repo ? scratch : scratch, "--version");  // cheap guard that git exists
  execFileSync("git", ["init", "-q", "-b", "main", repo], { stdio: ["ignore", "pipe", "pipe"] });
  git(repo, "config", "user.name", "test");
  git(repo, "config", "user.email", "test@invalid");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "genesis");
  return repo;
}

/** The register's answer for one window. */
const act = (id, actor, at) => ({
  id, at, crossing: 178, actor, action: "say", object: null,
  at_anchor: null, at_dx: null, at_dy: null, witnesses: null,
  class: "voice", payload: { text: "hello" }, effect: "spoken", household: `solo:${actor}`,
});

const clientFor = (rows) => ({ async query() { return { rows }; } });

const NL = "\n";

/** What the sweep's own check sees: real dirt, untracked included. */
const realDirt = (repo) =>
  git(repo, "status", "--porcelain", "--untracked-files=all").split(NL).filter((l) => l.trim());

// ── W1: the repair ───────────────────────────────────────────────────────────

test("W1 · the writer COMMITS its own paths, and leaves everything else exactly as it found it", async () => {
  const repo = world("w1");

  // MY REVIEWER'S NOTE (b). The first version of this fixture carried no
  // unrelated dirt, so W1 would have passed on a writer that ran `git add -A`
  // and swept the whole tree into its commit — a settlement clone belongs to
  // whoever else is using it, and a photograph writer that committed their
  // half-finished work would be the worst kind of helpful. The scope has to be
  // asserted, and it cannot be asserted against an empty tree.
  //
  // BOTH KINDS OF DIRT, because `git add <path>` and `git add -A` differ on them
  // differently. An UNTRACKED file is what an over-broad add would newly stage;
  // a MODIFIED TRACKED file is what it would stage as a change — and a writer
  // that passed `-u` rather than `-A` would sweep the second while leaving the
  // first, which a fixture carrying only the untracked one would call clean.
  // `worktreeDirt` classifies both as real (`--untracked-files=all`), so the
  // sweep refuses on either and this writer must leave both alone.
  writeFileSync(join(repo, "WORLD", "somebody-elses-work.json"), JSON.stringify({ midEdit: true }));
  writeFileSync(join(repo, "WORLD", "world-state.json"), JSON.stringify({ midEdit: "a tracked file, edited" }));
  const unrelated = realDirt(repo);
  assert.equal(unrelated.length, 2, "the fixture carries two unrelated dirty files");
  assert.ok(unrelated.some((l) => l.startsWith("??")), "one untracked");
  assert.ok(unrelated.some((l) => l.trim().startsWith("M")), "one modified-tracked");

  const out = await writeStateLog(clientFor([act(5001, "neth", "2026-09-09T01:00:00.000Z")]),
    { world: repo, windows: [178] });

  assert.equal(out.refused, undefined);
  assert.ok(out.state_commit, "a commit sha, not null");
  assert.equal(out.windows[0].lines, 1);
  assert.ok(existsSync(join(repo, "STATE", "log", "178.journal.jsonl")), "the window is on disk");

  // THE COMMIT'S SCOPE: STATE and nothing else.
  const committed = git(repo, "show", "--name-only", "--format=", "HEAD").split(NL).filter(Boolean);
  assert.deepEqual(committed, ["STATE/log/178.journal.jsonl", "STATE/log/178.journal.meta.json"],
    "only STATE — a writer that swept the tree would carry somebody-elses-work.json in here");
  assert.equal(git(repo, "log", "-1", "--format=%s"), "photograph: windows 178 from the register");

  // AND THE UNRELATED DIRT SURVIVES, untouched. `settlement-sweep.mjs:893` will
  // refuse this crossing on it — correctly, because somebody has uncommitted
  // work in the clone — and that refusal must name THEIR file, not be silently
  // prevented by this writer having committed it for them.
  assert.deepEqual(realDirt(repo), unrelated, "the other dirt is exactly as it was");
});

test("W1b · with no unrelated dirt, the tree the sweep classifies is CLEAN", async () => {
  // The half W1 used to be: the photograph's own files must not be what the
  // sweep trips on. `worktreeDirt` reads `--untracked-files=all`, so an
  // uncommitted STATE file is real dirt and `:893` throws by name.
  const repo = world("w1b");
  await writeStateLog(clientFor([act(5001, "neth", "2026-09-09T01:00:00.000Z")]),
    { world: repo, windows: [178] });
  assert.deepEqual(realDirt(repo), [], "the sweep's own clean-check would pass");
});

test("W1-CONTROL · THE DEFECT ITSELF — with the commit skipped, the tree carries dirt the sweep refuses on", async () => {
  // This is what my lap-1 diff would have produced. Asserted rather than
  // described, so the repair cannot be quietly undone.
  const repo = world("w1c");
  const out = await writeStateLog(clientFor([act(5001, "neth", "2026-09-09T01:00:00.000Z")]),
    { world: repo, windows: [178], commit: false });

  assert.equal(out.state_commit, null);
  const dirt = realDirt(repo);
  assert.ok(dirt.length > 0, "the tree is dirty");
  assert.ok(dirt.some((l) => l.startsWith("??") && l.includes("STATE/log")),
    "and it is UNTRACKED STATE — exactly what worktreeDirt classifies as real and the sweep throws on");
});

// ── W2-W3: the refusals ──────────────────────────────────────────────────────

test("W2 · off `main`, it refuses rather than committing STATE onto somebody else's branch", async () => {
  const repo = world("w2");
  git(repo, "checkout", "-q", "-b", "draft/somebody");
  const out = await writeStateLog(clientFor([act(5001, "neth", "2026-09-09T01:00:00.000Z")]),
    { world: repo, windows: [178] });
  assert.equal(out.refused, "not-on-main");
  assert.match(out.detail, /stands on "draft\/somebody"/);
  assert.deepEqual(realDirt(repo), [], "and it wrote nothing before refusing");
});

test("W3 · a window the drain already photographed is REFUSED, and nothing is written", async () => {
  const repo = world("w3");
  await assert.rejects(
    () => writeStateLog(clientFor([act(5001, "neth", "2026-09-09T01:00:00.000Z")]),
      { world: repo, windows: [178], lastDrainedWindow: 178 }),
    (e) => e.message.includes(MERGE_HAZARD));
  assert.deepEqual(realDirt(repo), [], "the refusal happens before any file is written");
});

test("W4 · a directory that is not a world checkout is refused by name", async () => {
  const plain = join(scratch, "notaworld");
  mkdirSync(plain, { recursive: true });
  const out = await writeStateLog(clientFor([]), { world: plain, windows: [178] });
  assert.equal(out.refused, "world-clone");
});

// ── W5: the reuse ────────────────────────────────────────────────────────────

test("W5 · it writes through the DRAIN's writeJournalWindow — merge-by-seq, not overwrite", async () => {
  // Not a second serializer. The drain's function owns the merge and the
  // temp-file rename, and a reimplementation here is how the two come to
  // disagree about what a half-written window looks like.
  const repo = world("w5");
  await writeStateLog(clientFor([act(5001, "neth", "2026-09-09T01:00:00.000Z")]), { world: repo, windows: [178] });
  await writeStateLog(clientFor([
    act(5001, "neth", "2026-09-09T01:00:00.000Z"),
    act(5002, "nyx", "2026-09-09T02:00:00.000Z"),
  ]), { world: repo, windows: [178] });

  const lines = readFileSync(join(repo, "STATE", "log", "178.journal.jsonl"), "utf8")
    .split("\n").filter(Boolean).map((l) => JSON.parse(l));
  assert.equal(lines.length, 2, "the second run MERGED rather than replacing — seq 5001 survived");
  assert.deepEqual(lines.map((l) => l.seq), [5001, 5002], "and the file is in seq order");
  assert.ok(existsSync(join(repo, "STATE", "log", "178.journal.meta.json")), "the meta rides along");
  assert.deepEqual(realDirt(repo), [], "and both runs left a clean tree");
});

test("W5-CONTROL · a second run that changes nothing makes no second commit", async () => {
  // `penCommit` returns null when nothing staged. Without this, W5's "it
  // committed" could be passing on a writer that commits unconditionally and
  // fills main with empty commits every crossing.
  const repo = world("w5c");
  const rows = [act(5001, "neth", "2026-09-09T01:00:00.000Z")];
  const first = await writeStateLog(clientFor(rows), { world: repo, windows: [178] });
  const before = git(repo, "rev-parse", "HEAD");
  const second = await writeStateLog(clientFor(rows), { world: repo, windows: [178] });
  assert.ok(first.state_commit);
  assert.equal(second.state_commit, null, "identical bytes, no commit");
  assert.match(second.state_note, /nothing to commit/);
  assert.equal(git(repo, "rev-parse", "HEAD"), before, "main did not move");
});

test("W6 · dryRun writes nothing and commits nothing", async () => {
  const repo = world("w6");
  const out = await writeStateLog(clientFor([act(5001, "neth", "2026-09-09T01:00:00.000Z")]),
    { world: repo, windows: [178], dryRun: true });
  assert.equal(out.state_commit, null);
  assert.equal(out.windows[0].lines, 1, "the plan is still computed");
  assert.equal(existsSync(join(repo, "STATE", "log", "178.journal.jsonl")), false);
  assert.deepEqual(realDirt(repo), []);
});
